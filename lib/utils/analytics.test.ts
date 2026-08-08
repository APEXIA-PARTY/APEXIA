/**
 * calcMediaMonthly の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/analytics.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcMediaMonthly, UNASSIGNED_MEDIA_ID, UNASSIGNED_MEDIA_LABEL, type CaseRow } from './analytics.ts'

// テスト用の最小限のダミー案件を作るヘルパー
function makeCase(overrides: Partial<CaseRow>): CaseRow {
  return {
    id: overrides.id ?? 'case-1',
    status: overrides.status ?? 'inquiry',
    auto_cancel: overrides.auto_cancel ?? false,
    preview_datetime: overrides.preview_datetime ?? null,
    estimate_amount: overrides.estimate_amount ?? 0,
    inquiry_date: overrides.inquiry_date ?? null,
    event_date: overrides.event_date ?? null,
    media_id: overrides.media_id ?? null,
    contact_method_id: null,
    floor_id: null,
    event_category_id: null,
    event_subcategory_id: null,
    cancel_reason_id: null,
    cancel_note: null,
    company: 'テスト株式会社',
    confirmed_at: overrides.confirmed_at ?? null,
  }
}

const MEDIA_A = { id: 'media-a', name: '媒体A' }
const MEDIA_B = { id: 'media-b', name: '媒体B' }

describe('calcMediaMonthly', () => {
  test('問合せは inquiry_date の月でカウントされる', () => {
    const cases = [
      makeCase({ media_id: 'media-a', inquiry_date: '2026-01-15' }),
      makeCase({ media_id: 'media-a', inquiry_date: '2026-01-20' }),
      makeCase({ media_id: 'media-a', inquiry_date: '2026-02-01' }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const row = result.find((r) => r.id === 'media-a')!
    assert.equal(row.months[0].inquiry, 2) // 1月
    assert.equal(row.months[1].inquiry, 1) // 2月
  })

  test('下見は preview_datetime の月でカウントされ、問合せ月とは独立する', () => {
    // 1月に問合せ、2月に下見
    const cases = [
      makeCase({ media_id: 'media-a', inquiry_date: '2026-01-10', preview_datetime: '2026-02-05T10:00:00Z' }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const row = result.find((r) => r.id === 'media-a')!
    assert.equal(row.months[0].inquiry, 1) // 1月＝問合せ
    assert.equal(row.months[0].preview, 0)
    assert.equal(row.months[1].preview, 1) // 2月＝下見
  })

  test('確定は confirmed_at の月でカウントされ、問合せ・下見月とは独立する（例：1月問合せ→2月下見→3月確定）', () => {
    const cases = [
      makeCase({
        media_id: 'media-a',
        status: 'confirmed',
        inquiry_date: '2026-01-10',
        preview_datetime: '2026-02-05T10:00:00Z',
        confirmed_at: '2026-03-12T09:00:00Z',
      }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const row = result.find((r) => r.id === 'media-a')!
    assert.equal(row.months[0].inquiry, 1)
    assert.equal(row.months[1].preview, 1)
    assert.equal(row.months[2].confirmed, 1)
  })

  test('confirmed_atはあるが現ステータスが確定/終了でない（後でキャンセルされた）場合は確定件数に含めない', () => {
    const cases = [
      makeCase({
        media_id: 'media-a',
        status: 'cancelled', // 確定後にキャンセルされた
        confirmed_at: '2026-03-12T09:00:00Z', // confirmed_at は史実として残っている
      }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const row = result.find((r) => r.id === 'media-a')!
    assert.equal(row.months[2].confirmed, 0, 'キャンセル済みなので確定件数にカウントしない')
  })

  test('現ステータスが done でも confirmed_at の月でカウントされる', () => {
    const cases = [
      makeCase({ media_id: 'media-a', status: 'done', confirmed_at: '2026-05-01T00:00:00Z' }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const row = result.find((r) => r.id === 'media-a')!
    assert.equal(row.months[4].confirmed, 1)
  })

  test('対象年以外の日付は集計対象外', () => {
    const cases = [
      makeCase({ media_id: 'media-a', inquiry_date: '2025-12-31' }),
      makeCase({ media_id: 'media-a', inquiry_date: '2027-01-01' }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const row = result.find((r) => r.id === 'media-a')!
    const totalInquiry = row.months.reduce((s, m) => s + m.inquiry, 0)
    assert.equal(totalInquiry, 0)
  })

  test('media_id が NULL の案件は（未設定）行にまとまる', () => {
    const cases = [
      makeCase({ media_id: null, inquiry_date: '2026-04-01' }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A], '2026')
    const unassignedRow = result.find((r) => r.id === UNASSIGNED_MEDIA_ID)
    assert.ok(unassignedRow, '（未設定）行が存在する')
    assert.equal(unassignedRow!.name, UNASSIGNED_MEDIA_LABEL)
    assert.equal(unassignedRow!.months[3].inquiry, 1)
  })

  test('該当案件が0件の媒体も、全月0件の行としてそのまま出力される（媒体一覧から消えない）', () => {
    const result = calcMediaMonthly([], [MEDIA_A, MEDIA_B], '2026')
    assert.equal(result.length, 2)
    for (const row of result) {
      assert.equal(row.months.length, 12)
      for (const cell of row.months) {
        assert.deepEqual(cell, { inquiry: 0, preview: 0, confirmed: 0 })
      }
    }
  })

  test('媒体ごとに独立して集計される（他媒体の件数が混ざらない）', () => {
    const cases = [
      makeCase({ media_id: 'media-a', inquiry_date: '2026-06-01' }),
      makeCase({ media_id: 'media-b', inquiry_date: '2026-06-01' }),
      makeCase({ media_id: 'media-b', inquiry_date: '2026-06-15' }),
    ]
    const result = calcMediaMonthly(cases, [MEDIA_A, MEDIA_B], '2026')
    const rowA = result.find((r) => r.id === 'media-a')!
    const rowB = result.find((r) => r.id === 'media-b')!
    assert.equal(rowA.months[5].inquiry, 1)
    assert.equal(rowB.months[5].inquiry, 2)
  })
})
