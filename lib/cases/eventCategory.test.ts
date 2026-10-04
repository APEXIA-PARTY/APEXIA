/**
 * 大分類・中分類の親子整合性（再発防止）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/eventCategory.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。ID・名称は架空。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EVENT_SUBCATEGORY_MISMATCH_MESSAGE,
  normalizeEventId,
  shouldClearSubcategoryOnCategoryChange,
  checkSubcategoryParent,
  validateEventSubcategory,
  validateEventPairForSave,
  type EventLookupClient,
} from './eventCategory.ts'
import { resolveEventSubcategoryId } from '../import/masterAliases.ts'
import { buildDuplicateInsertData } from './duplicate.ts'

const CAT_A = 'cat-a'
const CAT_B = 'cat-b'
const SUB_OF_A = 'sub-of-a'
const SUB_OF_B = 'sub-of-b'

/** 中分類マスタ（id → 親）と案件（id → {大分類, 中分類}）を持つ偽クライアント。呼び出しを記録する */
function fakeClient(opts: {
  subs?: Record<string, string>
  cases?: Record<string, { event_category_id: string | null; event_subcategory_id: string | null }>
  subError?: boolean
  caseError?: boolean
} = {}) {
  const calls: string[] = []
  const client: EventLookupClient = {
    from(table: string) {
      return {
        select(cols: string) {
          return {
            eq(_col: string, value: string) {
              return {
                async maybeSingle() {
                  calls.push(`${table}:${cols}:${value}`)
                  if (table === 'event_subcategory_master') {
                    if (opts.subError) return { data: null, error: { message: 'boom' } }
                    const parent = opts.subs?.[value]
                    return { data: parent ? { category_id: parent } : null, error: null }
                  }
                  if (table === 'cases') {
                    if (opts.caseError) return { data: null, error: { message: 'boom' } }
                    return { data: opts.cases?.[value] ?? null, error: null }
                  }
                  throw new Error('想定外のテーブル: ' + table)
                },
              }
            },
          }
        },
      }
    },
  }
  return { client, calls }
}
const SUBS = { [SUB_OF_A]: CAT_A, [SUB_OF_B]: CAT_B }

describe('CASE 1〜3: 親子整合性の検証（保存時）', () => {
  test('CASE 1: 大分類A + A配下の中分類 → 保存成功', async () => {
    const { client } = fakeClient({ subs: SUBS })
    assert.equal(await validateEventPairForSave(client, { event_category_id: CAT_A, event_subcategory_id: SUB_OF_A }), null)
    assert.deepEqual(await validateEventSubcategory(client, CAT_A, SUB_OF_A), { ok: true })
  })

  test('CASE 2: 大分類A + B配下の中分類 → 保存拒否（400・日本語メッセージ）', async () => {
    const { client } = fakeClient({ subs: SUBS })
    const result = await validateEventPairForSave(client, { event_category_id: CAT_A, event_subcategory_id: SUB_OF_B })
    assert.deepEqual(result, { status: 400, message: EVENT_SUBCATEGORY_MISMATCH_MESSAGE })
    assert.equal(
      EVENT_SUBCATEGORY_MISMATCH_MESSAGE,
      '選択された中分類は、選択された大分類に属していません。大分類または中分類を選び直してください。'
    )
  })

  test('CASE 3: 大分類あり + 中分類NULL（null / 空文字 / 未指定 / 空白）→ 保存成功、マスタへの問い合わせもしない', async () => {
    for (const sub of [null, '', undefined, '   ']) {
      const { client, calls } = fakeClient({ subs: SUBS })
      assert.equal(await validateEventPairForSave(client, { event_category_id: CAT_A, event_subcategory_id: sub }), null)
      assert.deepEqual(calls, [], `sub=${JSON.stringify(sub)} は問い合わせ不要`)
    }
  })

  test('中分類あり + 大分類なし（null / 空文字）→ 拒否', async () => {
    const { client } = fakeClient({ subs: SUBS })
    for (const cat of [null, '', undefined]) {
      const result = await validateEventPairForSave(client, { event_category_id: cat, event_subcategory_id: SUB_OF_A })
      assert.equal(result?.status, 400)
    }
  })

  test('存在しない中分類 → 400（DBエラー・500にしない）', async () => {
    const { client } = fakeClient({ subs: SUBS })
    const result = await validateEventPairForSave(client, { event_category_id: CAT_A, event_subcategory_id: 'unknown-sub' })
    assert.equal(result?.status, 400)
    assert.match(result!.message, /中分類が見つかりません/)
  })

  test('ID の前後の空白は無視して比較する', () => {
    assert.deepEqual(checkSubcategoryParent(` ${CAT_A} `, ` ${SUB_OF_A} `, CAT_A), { ok: true })
    assert.equal(normalizeEventId('  x '), 'x')
    assert.equal(normalizeEventId(''), null)
    assert.equal(normalizeEventId(123), null)
  })

  test('中分類マスタの確認に失敗した場合は、不整合として扱わず 500 を返す（原因が違うことを区別する）', async () => {
    const { client } = fakeClient({ subError: true })
    const result = await validateEventPairForSave(client, { event_category_id: CAT_A, event_subcategory_id: SUB_OF_A })
    assert.equal(result?.status, 500)
    assert.notEqual(result?.message, EVENT_SUBCATEGORY_MISMATCH_MESSAGE)
  })
})

describe('部分更新（PUT）: 保存後の（大分類, 中分類）の組で検証する', () => {
  const cases = { 'case-1': { event_category_id: CAT_A, event_subcategory_id: SUB_OF_A } }

  test('大分類・中分類を含まない更新（ステータス変更など）→ 何も問い合わせない', async () => {
    const { client, calls } = fakeClient({ subs: SUBS, cases })
    assert.equal(await validateEventPairForSave(client, { status: 'confirmed', deposit_status: '済み' }, { caseId: 'case-1' }), null)
    assert.deepEqual(calls, [])
  })

  test('大分類だけを別の大分類へ変更 → 既存の中分類が配下でなくなるため拒否', async () => {
    const { client } = fakeClient({ subs: SUBS, cases })
    const result = await validateEventPairForSave(client, { event_category_id: CAT_B }, { caseId: 'case-1' })
    assert.equal(result?.status, 400)
  })

  test('中分類だけを変更 → 既存の大分類で検証する（配下なら成功 / 他の大分類の配下なら拒否）', async () => {
    const { client } = fakeClient({ subs: SUBS, cases })
    assert.equal(await validateEventPairForSave(client, { event_subcategory_id: SUB_OF_A }, { caseId: 'case-1' }), null)
    assert.equal((await validateEventPairForSave(client, { event_subcategory_id: SUB_OF_B }, { caseId: 'case-1' }))?.status, 400)
  })

  test('大分類だけを変更し、同時に中分類を NULL にする → 成功', async () => {
    const { client } = fakeClient({ subs: SUBS, cases })
    assert.equal(await validateEventPairForSave(client, { event_category_id: CAT_B, event_subcategory_id: null }, { caseId: 'case-1' }), null)
  })

  test('既存案件を確認できない場合は 500（不整合かもしれない保存を通さない）', async () => {
    const { client } = fakeClient({ subs: SUBS, cases: {}, caseError: false })
    assert.equal((await validateEventPairForSave(client, { event_category_id: CAT_B }, { caseId: 'missing' }))?.status, 500)
  })
})

describe('CASE 4〜6: フォームの大分類変更時のクリア', () => {
  test('CASE 4: 大分類を変更 → 旧中分類をクリアする', () => {
    assert.equal(shouldClearSubcategoryOnCategoryChange(CAT_A, CAT_B, SUB_OF_A), true)
    assert.equal(shouldClearSubcategoryOnCategoryChange(CAT_A, '', SUB_OF_A), true) // 大分類を未選択に戻した
    assert.equal(shouldClearSubcategoryOnCategoryChange('', CAT_B, SUB_OF_A), true)
  })

  test('同じ大分類の再選択 / 中分類が未選択 → クリアしない', () => {
    assert.equal(shouldClearSubcategoryOnCategoryChange(CAT_A, CAT_A, SUB_OF_A), false)
    assert.equal(shouldClearSubcategoryOnCategoryChange(CAT_A, CAT_B, ''), false)
    assert.equal(shouldClearSubcategoryOnCategoryChange(CAT_A, CAT_B, null), false)
  })

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const form = fs.readFileSync(path.join(root, 'components/cases/CaseForm.tsx'), 'utf8')
  /** 大分類 select（{...eventCategoryField}）から、その選択肢の先頭（{loadingOpt}）までの範囲 */
  const categoryHandler = (src: string) => {
    const start = src.indexOf('{...eventCategoryField}')
    assert.ok(start > 0, '大分類 select が見つかる')
    return src.slice(start, src.indexOf('{loadingOpt}', start))
  }

  test('CASE 5: 編集画面を開いただけでは中分類をクリアしない（クリアはユーザー操作の onChange の中だけ）', () => {
    // 中分類を空にする setValue は、大分類 select の onChange ハンドラ内に1箇所だけ
    const clears = form.match(/setValue\(\s*'event_subcategory_id'\s*,\s*''\s*\)/g) ?? []
    assert.equal(clears.length, 1)
    const handler = categoryHandler(form)
    assert.match(handler, /onChange=\{\(e\) => \{/)
    assert.match(handler, /shouldClearSubcategoryOnCategoryChange\(/)
    assert.match(handler, /setValue\('event_subcategory_id', ''\)/)
    // useEffect の中にクリア処理がない（初期表示・マスタ取得・option 再適用で消さない）
    const effects = form.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\)/g) ?? []
    assert.ok(effects.length >= 3)
    for (const eff of effects) assert.doesNotMatch(eff, /setValue\('event_subcategory_id', ''\)/)
    // 初期値の再適用は従来どおり残っている
    assert.match(form, /setValue\('event_subcategory_id', initialData\.event_subcategory_id\)/)
  })

  test('CASE 6: 中分類をクリアしても event_subcategory_note には触れない', () => {
    const handler = categoryHandler(form).replace(/\/\/.*$/gm, '') // コメントは除いて判定
    assert.doesNotMatch(handler, /event_subcategory_note/)
    assert.doesNotMatch(form, /setValue\(\s*'event_subcategory_note'/)
    assert.doesNotMatch(form, /resetField\(/)
  })

  test('大分類変更後に、旧中分類の初期値が option ロード後に復活しない', () => {
    const handler = categoryHandler(form)
    assert.match(handler, /initialSubcategorySet\.current = true/)
  })
})

describe('CASE 7〜8: API が検証を通している（POST / PUT / 複製）', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

  test('CASE 7: POST /api/cases は INSERT の前に検証し、不整合なら 400 系を返す', () => {
    const src = read('app/api/cases/route.ts')
    assert.match(src, /import \{ validateEventPairForSave \} from '@\/lib\/cases\/eventCategory'/)
    const iValidate = src.indexOf('validateEventPairForSave(supabase')
    const iInsert = src.indexOf('.insert(insertData)')
    assert.ok(iValidate > 0 && iInsert > iValidate, '検証が INSERT より前にある')
    assert.match(src, /NextResponse\.json\(\{ message: invalidEvent\.message \}, \{ status: invalidEvent\.status \}\)/)
  })

  test('CASE 8: PUT /api/cases/[id] は UPDATE の前に検証し、不整合なら 400 系を返す', () => {
    const src = read('app/api/cases/[id]/route.ts')
    assert.match(src, /import \{ validateEventPairForSave \} from '@\/lib\/cases\/eventCategory'/)
    const iValidate = src.indexOf('validateEventPairForSave(supabase, updateData')
    const iUpdate = src.indexOf('.update(updateData)')
    assert.ok(iValidate > 0 && iUpdate > iValidate, '検証が UPDATE より前にある')
    assert.match(src, /\{ caseId: params\.id \}/)
    assert.match(src, /NextResponse\.json\(\{ message: invalidEvent\.message \}, \{ status: invalidEvent\.status \}\)/)
  })

  test('POST と PUT で同じ共通関数を使い、検証ロジックをコピーしていない', () => {
    for (const rel of ['app/api/cases/route.ts', 'app/api/cases/[id]/route.ts']) {
      const src = read(rel)
      assert.doesNotMatch(src, /event_subcategory_master/, rel + ' に検証の実装が重複していない')
      assert.doesNotMatch(src, /category_id/, rel)
    }
  })

  test('複製: 不整合な中分類は複製先で空にし、大分類・メモは引き継ぐ。複製元は変更しない', async () => {
    const src = read('app/api/cases/[id]/duplicate/route.ts')
    assert.match(src, /validateEventSubcategory\(/)
    assert.match(src, /insertData\.event_subcategory_id = null/)
    assert.doesNotMatch(src, /\.update\(/)
    // 検証 → 空にする動作（ルートと同じ判定を、共通関数で再現）
    const source = { event_category_id: CAT_A, event_subcategory_id: SUB_OF_B, event_subcategory_note: 'メモ' }
    const insertData = buildDuplicateInsertData(source, { newEventName: 'x（コピー）', inquiryDate: '2026-01-01', userId: 'u' })
    const { client } = fakeClient({ subs: SUBS })
    const check = await validateEventSubcategory(client, insertData.event_category_id, insertData.event_subcategory_id)
    assert.equal(check.ok, false)
    if (!check.ok && check.reason !== 'lookup_failed') insertData.event_subcategory_id = null
    assert.equal(insertData.event_category_id, CAT_A)
    assert.equal(insertData.event_subcategory_id, null)
    assert.equal(insertData.event_subcategory_note, 'メモ')
    assert.equal(source.event_subcategory_id, SUB_OF_B, '複製元のオブジェクトは変更されない')
  })

  test('複製: 整合している案件はそのまま引き継ぐ', async () => {
    const { client } = fakeClient({ subs: SUBS })
    const insertData = buildDuplicateInsertData(
      { event_category_id: CAT_A, event_subcategory_id: SUB_OF_A },
      { newEventName: 'x（コピー）', inquiryDate: '2026-01-01', userId: 'u' }
    )
    assert.deepEqual(await validateEventSubcategory(client, insertData.event_category_id, insertData.event_subcategory_id), { ok: true })
    assert.equal(insertData.event_subcategory_id, SUB_OF_A)
  })
})

describe('CASE 9〜10: Excel 取込み・既存の正常案件', () => {
  const categories = [{ id: 'cat-event', name: '企業イベント' }, { id: 'cat-other', name: 'その他' }]
  const subcategories = [
    { id: 'sub-inshoku', name: '企業飲食', category_id: 'cat-event' },
    { id: 'sub-sonota', name: 'その他', category_id: 'cat-event' },
  ]

  test('CASE 9: Excel「企業飲食」→ 企業イベント / 企業飲食 が、新しい検証を通って保存できる', async () => {
    const subId = resolveEventSubcategoryId('企業飲食', 'cat-event', categories, subcategories)
    assert.equal(subId, 'sub-inshoku')
    const { client } = fakeClient({ subs: { 'sub-inshoku': 'cat-event', 'sub-sonota': 'cat-event' } })
    assert.equal(await validateEventPairForSave(client, { event_category_id: 'cat-event', event_subcategory_id: subId }), null)
  })

  test('取込みの中分類は、解決済みの大分類の配下からしか選ばれない（不整合を作らない）', () => {
    // 大分類が別のものに解決された場合は中分類を設定しない
    assert.equal(resolveEventSubcategoryId('企業飲食', 'cat-other', categories, subcategories), null)
    // 中分類が重複・未作成の場合も設定しない
    assert.equal(resolveEventSubcategoryId('企業飲食', 'cat-event', categories, []), null)
    // 別名の対象外の値は設定しない
    assert.equal(resolveEventSubcategoryId('ライブ', 'cat-event', categories, subcategories), null)
  })

  test('CASE 10: 既存の正常な案件（大分類のみ / 両方なし / 他フィールドのみ）は回帰なく保存できる', async () => {
    const { client, calls } = fakeClient({ subs: SUBS })
    assert.equal(await validateEventPairForSave(client, { event_category_id: CAT_A }), null)
    assert.equal(await validateEventPairForSave(client, { event_category_id: null, event_subcategory_id: null }), null)
    assert.equal(await validateEventPairForSave(client, { company: 'テスト', estimate_amount: 1000 }), null)
    assert.deepEqual(calls, [], 'いずれも中分類マスタへの問い合わせなし')
  })
})
