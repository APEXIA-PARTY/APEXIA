/**
 * 案件フォームの備考（notes）の保存内容に関する自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/validations/case.test.ts
 * DB・ネットワーク接続は一切使用しない。値はすべて架空。
 *
 * 背景: 備考を空欄にして更新しても、既存の備考が消えなかった。
 *   旧: notes は空欄で undefined になり、JSON の保存内容から notes が落ちる
 *       → PUT /api/cases/[id]（送られたキーだけ更新する部分更新）が notes を更新せず、DB は旧値のまま
 *   新: 空欄は null で送る（キーが残る）→ notes = NULL に更新され、既存の備考を消せる
 * 空白だけの文字列（"   "）の扱いは従来どおり（trim などの正規化は追加していない）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { caseFormSchema } from './case.ts'
import { buildDuplicateInsertData } from '../cases/duplicate.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// 必須項目（inquiry_date）だけ指定した最小のフォーム値
const parse = (notes: unknown) => {
  const r = caseFormSchema.safeParse({ inquiry_date: '2026-10-07', notes })
  return r.success ? { ok: true as const, data: r.data } : { ok: false as const, issues: r.error.issues.map((i) => i.path.join('.')) }
}

describe('備考（notes）の validation', () => {
  test('CASE 1: 通常の備考はそのまま通る', () => {
    const r = parse('通常の備考')
    assert.ok(r.ok)
    assert.equal(r.data.notes, '通常の備考')
    assert.ok(has(r.data, 'notes'))
  })

  test('CASE 2: 空欄 "" は null になり、結果に notes キーが残る（undefined ではない）', () => {
    const r = parse('')
    assert.ok(r.ok)
    assert.equal(has(r.data, 'notes'), true, 'notes プロパティが存在する')
    assert.equal(r.data.notes, null)
    assert.notEqual(r.data.notes, undefined)
  })

  test('CASE 2b: 空欄の備考は、JSON.stringify（フォーム送信）後も "notes": null として残る', () => {
    const r = parse('')
    assert.ok(r.ok)
    const sent = JSON.parse(JSON.stringify(r.data))
    assert.equal(has(sent, 'notes'), true)
    assert.equal(sent.notes, null)
  })

  test('CASE 3: 空白だけの "   " は従来どおり（trim しない・そのまま通る）', () => {
    const r = parse('   ')
    assert.ok(r.ok)
    assert.equal(r.data.notes, '   ')
    const full = parse('　　')
    assert.ok(full.ok)
    assert.equal(full.data.notes, '　　', '全角空白も変換しない')
  })

  test('CASE 4: 2000 文字は成功（既存仕様）', () => {
    const r = parse('あ'.repeat(2000))
    assert.ok(r.ok)
    assert.equal((r.data.notes as string).length, 2000)
  })

  test('CASE 5: 2001 文字は validation error（既存仕様）', () => {
    const r = parse('あ'.repeat(2001))
    assert.equal(r.ok, false)
    assert.ok(!r.ok && r.issues.includes('notes'))
  })

  test('notes を指定しない（undefined）場合は、従来どおりキーが現れない（部分的な送信を壊さない）', () => {
    const r = caseFormSchema.safeParse({ inquiry_date: '2026-10-07' })
    assert.ok(r.success)
    assert.equal(has(r.data, 'notes'), false)
  })

  test('null をそのまま渡しても通る（既存の備考が NULL の案件の再保存）', () => {
    const r = parse(null)
    assert.ok(r.ok)
    assert.equal(r.data.notes, null)
  })
})

describe('複製 → 備考を削除 → 保存 の流れ（架空データ・DB なし）', () => {
  test('複製は備考を引き継ぐ。編集画面で空欄にして保存すると、更新内容に notes: null が入る', () => {
    const source = { event_name: '架空イベント', notes: '複製元から引き継がれる備考' }
    const dup = buildDuplicateInsertData(source, { newEventName: '架空イベント（コピー）', inquiryDate: '2026-10-07', userId: 'u1' })
    assert.equal(dup.notes, '複製元から引き継がれる備考', '複製仕様: 備考は引き継ぐ（変更しない）')

    // 編集画面: 初期値は引き継いだ備考 → ユーザーが全部消す → ''
    const edited = parse('')
    assert.ok(edited.ok)
    const body = JSON.parse(JSON.stringify(edited.data))

    // PUT /api/cases/[id] と同じ手順で updateData を作る（STRIP_FIELDS 以外のキーをそのまま採用）
    const route = read('app/api/cases/[id]/route.ts')
    const strip = Array.from(/const STRIP_FIELDS = \[([\s\S]*?)\] as const/.exec(route)![1].matchAll(/'(\w+)'/g), (m) => m[1])
    assert.ok(!strip.includes('notes'), 'notes は STRIP_FIELDS に入っていない')
    const updateData = Object.fromEntries(Object.entries(body).filter(([k]) => !strip.includes(k)))
    assert.equal(has(updateData, 'notes'), true)
    assert.equal(updateData.notes, null)
  })
})

describe('今回の変更範囲（notes だけ）', () => {
  const src = read('lib/validations/case.ts')

  test('notes は emptyToNull(...nullable().optional())。trim などの新しい変換は追加していない', () => {
    assert.match(src, /notes: emptyToNull\(z\.string\(\)\.max\(2000\)\.nullable\(\)\.optional\(\)\),/)
    const line = src.split('\n').find((l) => l.trim().startsWith('notes:'))!
    assert.doesNotMatch(line, /trim|transform|preprocess/)
  })

  test('他の項目は従来どおり emptyToUndefined のまま（今回は変更しない）', () => {
    for (const f of ['contact', 'event_date', 'event_name', 'event_subcategory_note', 'preview_datetime', 'event_date_note', 'cancel_note']) {
      assert.match(src, new RegExp(`\\n  ${f}: emptyToUndefined\\(`), `${f} は emptyToUndefined のまま`)
    }
    assert.match(src, /guest_count: optionalNumber,/)
  })

  test('複製の引き継ぎ列に notes が残っている / DB の notes は NULL 可 / 型は string | null', () => {
    assert.match(read('lib/cases/duplicate.ts'), /'notes',/)
    assert.match(read('supabase/migrations/002_create_cases_table.sql'), /\n  notes\s+TEXT,/)
    assert.match(read('types/database.ts'), /notes: string \| null/)
  })

  test('詳細画面は備考が空（null）なら備考ブロックを出さない', () => {
    assert.match(read('components/cases/CaseDetail/BasicInfo.tsx'), /\{c\.notes && \(/)
  })
})
