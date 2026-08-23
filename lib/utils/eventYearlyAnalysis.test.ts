/**
 * 開催月分析（年間、event_date 基準）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/eventYearlyAnalysis.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 *
 * lib/utils/analytics.ts（inquiry_date 基準の既存分析）・
 * lib/utils/eventDateSummary.ts（案件一覧の開催サマリー）とは無関係。
 * このテストは lib/utils/eventYearlyAnalysis.ts のみを対象とする。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcEventYearlyTotals,
  classifyEventMonthTiming,
  isValidEventYearlyMonths,
  hasEventYearlyQueryProblem,
  type EventYearlyMonthCount,
} from './eventYearlyAnalysis.ts'

function makeMonths(counts: [string, number, number][]): EventYearlyMonthCount[] {
  return counts.map(([month, current, previous]) => ({ month, current, previous }))
}

describe('calcEventYearlyTotals', () => {
  test('12ヶ月分の当年合計・前年合計を算出する', () => {
    const months = makeMonths([
      ['01', 10, 8], ['02', 5, 3], ['03', 0, 0], ['04', 2, 1],
      ['05', 1, 0], ['06', 0, 2], ['07', 3, 3], ['08', 4, 4],
      ['09', 0, 0], ['10', 0, 0], ['11', 0, 0], ['12', 0, 0],
    ])
    const result = calcEventYearlyTotals(months)
    assert.equal(result.currentTotal, 25)
    assert.equal(result.previousTotal, 21)
  })

  test('前年が全月0件のとき、前年合計は0になる', () => {
    const months = makeMonths(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), i + 1, 0] as [string, number, number]))
    const result = calcEventYearlyTotals(months)
    assert.equal(result.previousTotal, 0)
    assert.equal(result.currentTotal, 78) // 1+2+...+12
  })

  test('月ごとの差は個別に計算できる（合計関数自体は個別差を返さないが、値から算出可能）', () => {
    const months = makeMonths([['10', 23, 18], ['11', 19, 21]])
    const diffs = months.map((m) => m.current - m.previous)
    assert.deepEqual(diffs, [5, -2])
  })
})

describe('classifyEventMonthTiming', () => {
  const today = new Date(2026, 7, 23) // 2026-08-23（月は0始まりなので7=8月）

  test('過去年 → すべて past', () => {
    assert.equal(classifyEventMonthTiming('2025', '01', today), 'past')
    assert.equal(classifyEventMonthTiming('2025', '12', today), 'past')
  })

  test('未来年 → すべて future', () => {
    assert.equal(classifyEventMonthTiming('2027', '01', today), 'future')
    assert.equal(classifyEventMonthTiming('2027', '12', today), 'future')
  })

  test('当年・過去月 → past', () => {
    assert.equal(classifyEventMonthTiming('2026', '07', today), 'past')
  })

  test('当年・当月 → current', () => {
    assert.equal(classifyEventMonthTiming('2026', '08', today), 'current')
  })

  test('当年・未来月 → future', () => {
    assert.equal(classifyEventMonthTiming('2026', '09', today), 'future')
    assert.equal(classifyEventMonthTiming('2026', '12', today), 'future')
  })
})

describe('isValidEventYearlyMonths', () => {
  test('正常な12ヶ月分のAPIレスポンス構造 → true', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: String(i + 1).padStart(2, '0'),
      current: i,
      previous: i,
    }))
    assert.equal(isValidEventYearlyMonths(months), true)
  })

  test('12ヶ月に満たない → false', () => {
    const months = Array.from({ length: 11 }, (_, i) => ({
      month: String(i + 1).padStart(2, '0'),
      current: 0,
      previous: 0,
    }))
    assert.equal(isValidEventYearlyMonths(months), false)
  })

  test('月が重複している → false', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: '01', // 全部同じ月にしてしまう不正データ
      current: 0,
      previous: 0,
    }))
    assert.equal(isValidEventYearlyMonths(months), false)
  })

  test('件数が負の数 → false', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: String(i + 1).padStart(2, '0'),
      current: i === 0 ? -1 : 0,
      previous: 0,
    }))
    assert.equal(isValidEventYearlyMonths(months), false)
  })

  test('配列でない・nullの場合 → false', () => {
    assert.equal(isValidEventYearlyMonths(null), false)
    assert.equal(isValidEventYearlyMonths(undefined), false)
    assert.equal(isValidEventYearlyMonths('not an array'), false)
  })
})

describe('hasEventYearlyQueryProblem', () => {
  test('全24本が正常（0件を含む）→ false（0件を正常値として扱う）', () => {
    const results = Array.from({ length: 24 }, (_, i) => ({ count: i === 0 ? 0 : i, error: null }))
    assert.equal(hasEventYearlyQueryProblem(results), false)
  })

  test('1本でも error があれば → true', () => {
    const results: { count: number | null; error: unknown }[] =
      Array.from({ length: 24 }, () => ({ count: 5, error: null }))
    results[10] = { count: null, error: { message: 'db error' } }
    assert.equal(hasEventYearlyQueryProblem(results), true)
  })

  test('1本でも count が null なら → true（0件と決めつけない）', () => {
    const results: { count: number | null; error: unknown }[] =
      Array.from({ length: 24 }, () => ({ count: 5, error: null }))
    results[5] = { count: null, error: null }
    assert.equal(hasEventYearlyQueryProblem(results), true)
  })

  test('1本でも count が undefined なら → true', () => {
    const results: { count: number | null | undefined; error: unknown }[] =
      Array.from({ length: 24 }, () => ({ count: 5, error: null }))
    results[0] = { count: undefined, error: null }
    assert.equal(hasEventYearlyQueryProblem(results), true)
  })
})
