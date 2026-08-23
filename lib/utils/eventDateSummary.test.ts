/**
 * 開催月別集計（event_date 基準）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/eventDateSummary.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 *
 * lib/utils/analytics.ts（inquiry_date 基準の既存分析）とは無関係。
 * このテストは lib/utils/eventDateSummary.ts のみを対象とする。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcEventMonthRange,
  formatEventMonthYoYPercent,
  formatEventMonthYoYDiff,
  buildEventMonthSummary,
  type EventMonthCurrentQueryResult,
} from './eventDateSummary.ts'

// テスト用: ステータス配列から { status } の行配列を作るヘルパー
function makeStatusRows(counts: Record<string, number>): { status: string }[] {
  const rows: { status: string }[] = []
  for (const [status, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) rows.push({ status })
  }
  return rows
}

describe('calcEventMonthRange', () => {
  test('2026年10月 → 2026-10-01 〜 2026-10-31', () => {
    assert.deepEqual(calcEventMonthRange('2026', '10'), { gte: '2026-10-01', lte: '2026-10-31' })
  })

  test('2028年2月（うるう年） → 2028-02-01 〜 2028-02-29', () => {
    assert.deepEqual(calcEventMonthRange('2028', '02'), { gte: '2028-02-01', lte: '2028-02-29' })
  })

  test('前年レンジ: 2026年10月の前年 → 2025-10-01 〜 2025-10-31', () => {
    const previous = calcEventMonthRange(String(Number('2026') - 1), '10')
    assert.deepEqual(previous, { gte: '2025-10-01', lte: '2025-10-31' })
  })
})

describe('formatEventMonthYoYPercent', () => {
  test('28 / 24 → 116.7%', () => {
    assert.equal(formatEventMonthYoYPercent(28, 24), '116.7%')
  })

  test('5 / 0 → 前年0件は比率として意味を持たないため "—"', () => {
    assert.equal(formatEventMonthYoYPercent(5, 0), '—')
  })

  test('0 / 5 → 0.0%', () => {
    assert.equal(formatEventMonthYoYPercent(0, 5), '0.0%')
  })
})

describe('formatEventMonthYoYDiff', () => {
  test('28 / 24 → +4件', () => {
    assert.equal(formatEventMonthYoYDiff(28, 24), '+4件')
  })

  test('21 / 24 → -3件', () => {
    assert.equal(formatEventMonthYoYDiff(21, 24), '-3件')
  })

  test('24 / 24 → ±0件', () => {
    assert.equal(formatEventMonthYoYDiff(24, 24), '±0件')
  })
})

describe('buildEventMonthSummary', () => {
  test('正常ケース: count28・rows28（内訳合計28）・previous24 → 正常な summary を返す', () => {
    const rows = makeStatusRows({
      inquiry: 10,
      preview_adj: 2,
      previewed: 3,
      tentative: 4,
      confirmed: 5,
      cancelled: 3,
      done: 1,
    })
    const current: EventMonthCurrentQueryResult = { data: rows, count: 28, error: null }
    const result = buildEventMonthSummary(current, 24, null)

    assert.notEqual(result, null)
    assert.equal(result?.currentTotal, 28)
    assert.equal(result?.previousTotal, 24)
    assert.deepEqual(result?.breakdown, {
      inquiry: 10,
      preview_adj: 2,
      previewed: 3,
      tentative: 4,
      confirmed: 5,
      cancelled: 3,
      done: 1,
    })
  })

  test('当月クエリが error を返した場合 → null', () => {
    const current: EventMonthCurrentQueryResult = { data: null, count: null, error: { message: 'db error' } }
    assert.equal(buildEventMonthSummary(current, 24, null), null)
  })

  test('前年クエリが error を返した場合 → null', () => {
    const rows = makeStatusRows({ inquiry: 28 })
    const current: EventMonthCurrentQueryResult = { data: rows, count: 28, error: null }
    assert.equal(buildEventMonthSummary(current, 24, { message: 'db error' }), null)
  })

  test('当月 count が null → null（0件と決めつけない）', () => {
    const rows = makeStatusRows({ inquiry: 28 })
    const current: EventMonthCurrentQueryResult = { data: rows, count: null, error: null }
    assert.equal(buildEventMonthSummary(current, 24, null), null)
  })

  test('前年 count が null → null（0件と決めつけない）', () => {
    const rows = makeStatusRows({ inquiry: 28 })
    const current: EventMonthCurrentQueryResult = { data: rows, count: 28, error: null }
    assert.equal(buildEventMonthSummary(current, null, null), null)
  })

  test('exact count(1200) と rows.length(1000) が不一致 → null（行数上限による内訳不完全の可能性）', () => {
    const rows = makeStatusRows({ inquiry: 1000 })
    const current: EventMonthCurrentQueryResult = { data: rows, count: 1200, error: null }
    assert.equal(buildEventMonthSummary(current, 24, null), null)
  })

  test('exact count(28) に対しステータス内訳合計が27（未知のstatusが1件混在） → null', () => {
    const rows = makeStatusRows({
      inquiry: 9,
      preview_adj: 2,
      previewed: 3,
      tentative: 4,
      confirmed: 5,
      cancelled: 3,
      done: 1,
    })
    rows.push({ status: 'unknown_status' })
    const current: EventMonthCurrentQueryResult = { data: rows, count: 28, error: null }
    assert.equal(buildEventMonthSummary(current, 24, null), null)
  })

  test('前年0件・今年5件の場合も正常な summary を返す（前年0件はエラーではない）', () => {
    const rows = makeStatusRows({ inquiry: 5 })
    const current: EventMonthCurrentQueryResult = { data: rows, count: 5, error: null }
    const result = buildEventMonthSummary(current, 0, null)
    assert.notEqual(result, null)
    assert.equal(result?.currentTotal, 5)
    assert.equal(result?.previousTotal, 0)
  })
})
