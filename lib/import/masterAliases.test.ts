/**
 * Excel 取込みの旧名称 → 正規名称の別名解決の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/import/masterAliases.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveMasterId,
  resolveEventSubcategoryId,
  MEDIA_ALIASES,
  CANCEL_REASON_ALIASES,
  EVENT_CATEGORY_ALIASES,
  type MasterRow,
  type SubcategoryRow,
} from './masterAliases.ts'

// 統合後の有効マスタ（旧マスタは is_active=false のため一覧に含まれない）
const media: MasterRow[] = [
  { id: 'm-web', name: 'WEB要件検索' },
  { id: 'm-ig', name: 'instagram DM営業' },
  { id: 'm-repeat', name: 'リピート' },
]
const cancel: MasterRow[] = [
  { id: 'c-venue', name: '他会場で開催' },
  { id: 'c-slot', name: '空き枠なし' },
  { id: 'c-other', name: 'その他' },
]
const category: MasterRow[] = [
  { id: 'k-event', name: '企業イベント' },
  { id: 'k-live', name: 'ライブ' },
]

describe('正規名称の取込みは従来どおり（壊していない）', () => {
  test('正規名称そのもの（大文字小文字・前後空白は無視）', () => {
    assert.equal(resolveMasterId('WEB要件検索', media, MEDIA_ALIASES), 'm-web')
    assert.equal(resolveMasterId('  web要件検索  ', media, MEDIA_ALIASES), 'm-web')
    assert.equal(resolveMasterId('INSTAGRAM DM営業', media, MEDIA_ALIASES), 'm-ig')
    assert.equal(resolveMasterId('リピート', media, MEDIA_ALIASES), 'm-repeat')
    assert.equal(resolveMasterId('他会場で開催', cancel, CANCEL_REASON_ALIASES), 'c-venue')
    assert.equal(resolveMasterId('空き枠なし', cancel, CANCEL_REASON_ALIASES), 'c-slot')
    assert.equal(resolveMasterId('企業イベント', category, EVENT_CATEGORY_ALIASES), 'k-event')
  })

  test('別名表なしでも従来どおり動く（第3引数は省略可）', () => {
    assert.equal(resolveMasterId('リピート', media), 'm-repeat')
    assert.equal(resolveMasterId('WEBで要件入力', media), null)
  })

  test('空・空白・null・未知の値は null（従来どおり未解決）', () => {
    for (const v of [null, undefined, '', '   ']) assert.equal(resolveMasterId(v, media, MEDIA_ALIASES), null)
    assert.equal(resolveMasterId('存在しない媒体', media, MEDIA_ALIASES), null)
  })
})

describe('旧名称は正規名称へ解決される', () => {
  test('認知経路', () => {
    assert.equal(resolveMasterId('WEBで要件入力', media, MEDIA_ALIASES), 'm-web')
    assert.equal(resolveMasterId('web要件検索', media, MEDIA_ALIASES), 'm-web')
    assert.equal(resolveMasterId('insragram営業', media, MEDIA_ALIASES), 'm-ig')
    assert.equal(resolveMasterId('instagramのDM', media, MEDIA_ALIASES), 'm-ig')
    assert.equal(resolveMasterId(' INSRAGRAM営業 ', media, MEDIA_ALIASES), 'm-ig')
  })

  test('キャンセル理由', () => {
    assert.equal(resolveMasterId('他会場に決定', cancel, CANCEL_REASON_ALIASES), 'c-venue')
    assert.equal(resolveMasterId('他店舗で開催', cancel, CANCEL_REASON_ALIASES), 'c-venue')
    assert.equal(resolveMasterId('空いてなかった', cancel, CANCEL_REASON_ALIASES), 'c-slot')
  })

  test('イベント大分類: 企業飲食 → 企業イベント', () => {
    assert.equal(resolveMasterId('企業飲食', category, EVENT_CATEGORY_ALIASES), 'k-event')
  })

  test('「他会場にで開催」のような誤記には解決しない（正しい表記は「他会場で開催」）', () => {
    assert.equal(resolveMasterId('他会場にで開催', cancel, CANCEL_REASON_ALIASES), null)
  })
})

describe('別名の読み替え先が有効マスタに無い場合は未解決（誤った行へ解決しない）', () => {
  test('正規マスタが無効・未作成なら null', () => {
    assert.equal(resolveMasterId('WEBで要件入力', [{ id: 'x', name: 'リピート' }], MEDIA_ALIASES), null)
    assert.equal(resolveMasterId('企業飲食', [{ id: 'k-live', name: 'ライブ' }], EVENT_CATEGORY_ALIASES), null)
  })

  test('旧マスタがまだ有効な環境（統合前）では、同名の旧マスタへ従来どおり直接解決する', () => {
    const preMerge: MasterRow[] = [{ id: 'old-web', name: 'WEBで要件入力' }, { id: 'old-web2', name: 'web要件検索' }]
    assert.equal(resolveMasterId('WEBで要件入力', preMerge, MEDIA_ALIASES), 'old-web')
    assert.equal(resolveMasterId('web要件検索', preMerge, MEDIA_ALIASES), 'old-web2')
  })
})

// ─── 旧大分類「企業飲食」→ 大分類「企業イベント」＋ 中分類「企業飲食」 ─────────────────
const subs: SubcategoryRow[] = [
  { id: 's-shanai', name: '社内懇親会', category_id: 'k-event' },
  { id: 's-inshoku', name: '企業飲食', category_id: 'k-event' },
  { id: 's-live-other', name: '企業飲食', category_id: 'k-live' }, // 別の大分類の同名中分類（選ばれてはいけない）
]

describe('Excel の旧「企業飲食」 → 企業イベント > 企業飲食', () => {
  test('大分類は企業イベントに解決され、中分類「企業飲食」も設定される', () => {
    const categoryId = resolveMasterId('企業飲食', category, EVENT_CATEGORY_ALIASES)
    assert.equal(categoryId, 'k-event')
    assert.equal(resolveEventSubcategoryId('企業飲食', categoryId, category, subs), 's-inshoku')
  })

  test('前後空白・大文字小文字の揺れがあっても同じ結果', () => {
    const categoryId = resolveMasterId('  企業飲食 ', category, EVENT_CATEGORY_ALIASES)
    assert.equal(resolveEventSubcategoryId('  企業飲食 ', categoryId, category, subs), 's-inshoku')
  })

  test('他の大分類の同名中分類は選ばない（企業イベント配下の中分類だけ）', () => {
    assert.equal(resolveEventSubcategoryId('企業飲食', 'k-event', category, subs), 's-inshoku')
    assert.notEqual(resolveEventSubcategoryId('企業飲食', 'k-event', category, subs), 's-live-other')
  })

  test('正規の「企業イベント」を取込んだ場合は中分類を設定しない（従来どおり）', () => {
    assert.equal(resolveEventSubcategoryId('企業イベント', 'k-event', category, subs), null)
  })

  test('他の大分類（ライブ等）を取込んだ場合も設定しない', () => {
    assert.equal(resolveEventSubcategoryId('ライブ', 'k-live', category, subs), null)
  })

  test('統合前（旧大分類「企業飲食」が有効で、そこへ解決された）は中分類を設定しない', () => {
    const preMerge: MasterRow[] = [{ id: 'k-event', name: '企業イベント' }, { id: 'k-old-inshoku', name: '企業飲食' }]
    const categoryId = resolveMasterId('企業飲食', preMerge, EVENT_CATEGORY_ALIASES)
    assert.equal(categoryId, 'k-old-inshoku')
    assert.equal(resolveEventSubcategoryId('企業飲食', categoryId, preMerge, subs), null)
  })

  test('中分類「企業飲食」が未作成・重複している場合は設定しない（誤った行を選ばない）', () => {
    assert.equal(resolveEventSubcategoryId('企業飲食', 'k-event', category, [{ id: 's-shanai', name: '社内懇親会', category_id: 'k-event' }]), null)
    assert.equal(resolveEventSubcategoryId('企業飲食', 'k-event', category, [
      { id: 'a', name: '企業飲食', category_id: 'k-event' }, { id: 'b', name: '企業飲食', category_id: 'k-event' },
    ]), null)
  })

  test('大分類が未解決（null）・取込み値が空の場合は設定しない', () => {
    assert.equal(resolveEventSubcategoryId('企業飲食', null, category, subs), null)
    assert.equal(resolveEventSubcategoryId('', 'k-event', category, subs), null)
    assert.equal(resolveEventSubcategoryId(null, 'k-event', category, subs), null)
  })
})

describe('apply 処理が中分類を保存する', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const src = readFileSync(resolve(ROOT, 'app/api/import/batch/[batchId]/apply/route.ts'), 'utf8')

  test('INSERT に event_subcategory_id を含め、解決は共通関数で行う', () => {
    assert.ok(src.includes('resolveEventSubcategoryId('))
    assert.ok(/event_subcategory_id:\s+resolveEventSubcategoryId\(/.test(src))
  })

  test('今回追加したブロックは SELECT のみ（マスタ取得）で、INSERT / UPDATE / DELETE を含まない', () => {
    assert.ok(src.includes(".from('event_subcategory_master').select('id, name, category_id').eq('is_active', true)"))
    const a = src.indexOf('中分類の解決用マスタ')
    const b = src.indexOf('cases へ INSERT（承認行のみ）')
    assert.ok(a > 0 && b > a)
    const block = src.slice(a, b)
    assert.ok(!/\.(insert|update|delete|upsert)\(/.test(block))
  })
})
