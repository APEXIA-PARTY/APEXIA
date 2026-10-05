/**
 * 自動キャンセルの業務ルール（猶予日数・遡り上限）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cron/autoCancelRules.test.ts
 * DB・ネットワーク接続は一切使用しない。日付は架空。
 *
 * ルール: inquiry / preview_adj は開催日から7日を超えて経過、previewed は14日を超えて経過。
 *         tentative / confirmed / done / cancelled は対象外。今日（日本時間）から30日より古い案件は対象外。
 *   「N日を超えて経過」 = event_date < 今日 − N日（経過日数が N+1 日以上）
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getJstTodayDateString } from '../utils/autoComplete.ts'
import {
  AUTO_CANCEL_GRACE_DAYS,
  AUTO_CANCEL_LOOKBACK_DAYS,
  AUTO_CANCEL_MAX_WRITE_COUNT,
  addDaysToDate,
  getAutoCancelWindow,
  isAutoCancelTarget,
  summarizeAutoCancelCandidates,
} from './autoCancelRules.ts'

const TODAY = '2026-10-05'
const ago = (days: number) => addDaysToDate(TODAY, -days)
const target = (status: string, daysAgo: number | null) =>
  isAutoCancelTarget({ status, event_date: daysAgo === null ? null : ago(daysAgo) }, TODAY)

describe('ルール定数（一目で確認できる）', () => {
  test('猶予日数・遡り上限・書込み上限', () => {
    assert.deepEqual(AUTO_CANCEL_GRACE_DAYS, { inquiry: 7, preview_adj: 7, previewed: 14 })
    assert.equal(AUTO_CANCEL_LOOKBACK_DAYS, 30)
    assert.equal(AUTO_CANCEL_MAX_WRITE_COUNT, 30)
  })

  test('addDaysToDate: 月またぎ・年またぎ・うるう日', () => {
    assert.equal(addDaysToDate('2026-10-05', -5), '2026-09-30')
    assert.equal(addDaysToDate('2026-01-03', -5), '2025-12-29')
    assert.equal(addDaysToDate('2028-03-01', -1), '2028-02-29')
    assert.equal(addDaysToDate('2026-10-05', 0), '2026-10-05')
    assert.throws(() => addDaysToDate('2026/10/05', 1))
  })

  test('getAutoCancelWindow: 今日から逆算した境界', () => {
    const w = getAutoCancelWindow(TODAY)
    assert.equal(w.lookbackStart, '2026-09-05')
    assert.deepEqual(w.cutoffs, { inquiry: '2026-09-28', preview_adj: '2026-09-28', previewed: '2026-09-21' })
  })
})

describe('CASE 12〜14: inquiry / preview_adj の7日', () => {
  test('CASE 12: inquiry 開催7日未満（経過1〜7日）→ 対象外', () => {
    for (const d of [0, 1, 3, 7]) assert.equal(target('inquiry', d), false, `${d}日前`)
  })
  test('CASE 13: inquiry 7日境界 — 7日前は対象外、8日前から対象', () => {
    assert.equal(target('inquiry', 7), false)
    assert.equal(target('inquiry', 8), true)
    assert.equal(target('inquiry', 20), true)
  })
  test('CASE 14: preview_adj も同じ7日境界', () => {
    assert.equal(target('preview_adj', 7), false)
    assert.equal(target('preview_adj', 8), true)
  })
  test('開催日が未来・当日は対象外', () => {
    assert.equal(isAutoCancelTarget({ status: 'inquiry', event_date: '2026-10-06' }, TODAY), false)
    assert.equal(isAutoCancelTarget({ status: 'inquiry', event_date: TODAY }, TODAY), false)
  })
})

describe('CASE 15〜16: previewed の14日', () => {
  test('CASE 15: previewed 14日未満（経過14日以下）→ 対象外', () => {
    for (const d of [0, 7, 8, 13, 14]) assert.equal(target('previewed', d), false, `${d}日前`)
  })
  test('CASE 16: previewed 14日境界 — 14日前は対象外、15日前から対象', () => {
    assert.equal(target('previewed', 14), false)
    assert.equal(target('previewed', 15), true)
  })
})

describe('CASE 17〜20: 対象外の status', () => {
  test('CASE 17: tentative は常に対象外（どれだけ古くても、新しくても）', () => {
    for (const d of [0, 8, 15, 30, 60, 400]) assert.equal(target('tentative', d), false, `${d}日前`)
  })
  test('CASE 18: confirmed は対象外', () => {
    for (const d of [8, 15, 30]) assert.equal(target('confirmed', d), false)
  })
  test('CASE 19: done は対象外', () => {
    for (const d of [8, 15, 30]) assert.equal(target('done', d), false)
  })
  test('CASE 20: cancelled は対象外', () => {
    for (const d of [8, 15, 30]) assert.equal(target('cancelled', d), false)
  })
  test('未知の status は対象外', () => {
    assert.equal(target('unknown', 10), false)
  })
})

describe('CASE 21〜23: 30日の遡り上限と event_date が空', () => {
  test('CASE 21: 30日遡り上限の境界 — 30日前は対象、31日前は対象外', () => {
    assert.equal(target('inquiry', 30), true)
    assert.equal(target('inquiry', 31), false)
    assert.equal(target('previewed', 30), true)
    assert.equal(target('previewed', 31), false)
    assert.equal(target('preview_adj', 30), true)
    assert.equal(target('preview_adj', 31), false)
  })
  test('CASE 22: 30日より古い案件は対象外（91件規模の滞留案件を cron が処理しない）', () => {
    for (const d of [31, 60, 90, 180, 240]) {
      assert.equal(target('inquiry', d), false)
      assert.equal(target('preview_adj', d), false)
      assert.equal(target('previewed', d), false)
    }
  })
  test('CASE 23: event_date が null / 空 → 対象外', () => {
    assert.equal(target('inquiry', null), false)
    assert.equal(isAutoCancelTarget({ status: 'inquiry', event_date: undefined }, TODAY), false)
    assert.equal(isAutoCancelTarget({ status: 'inquiry', event_date: '' }, TODAY), false)
  })
  test('窓の幅: inquiry/preview_adj は8〜30日前、previewed は15〜30日前', () => {
    const inq = Array.from({ length: 60 }, (_, d) => d).filter((d) => target('inquiry', d))
    const prev = Array.from({ length: 60 }, (_, d) => d).filter((d) => target('previewed', d))
    assert.deepEqual([Math.min(...inq), Math.max(...inq)], [8, 30])
    assert.deepEqual([Math.min(...prev), Math.max(...prev)], [15, 30])
  })
})

describe('CASE 24: JST 日付境界', () => {
  test('「今日」は日本時間の暦日。UTC では前日の時刻でも JST の日付で判定する', () => {
    // UTC 2026-10-04 15:00 = JST 2026-10-05 00:00
    const justAfterMidnightJst = new Date('2026-10-04T15:00:00Z')
    assert.equal(getJstTodayDateString(justAfterMidnightJst), '2026-10-05')
    // UTC 2026-10-04 14:59:59 = JST 2026-10-04 23:59:59（まだ前日）
    assert.equal(getJstTodayDateString(new Date('2026-10-04T14:59:59Z')), '2026-10-04')
    // 同じ案件（開催 2026-09-27）が、JST 日付が1日進んだ瞬間に対象になる
    const ev = { status: 'inquiry', event_date: '2026-09-27' }
    assert.equal(isAutoCancelTarget(ev, getJstTodayDateString(new Date('2026-10-04T14:59:59Z'))), false) // JST 10-04: 7日前
    assert.equal(isAutoCancelTarget(ev, getJstTodayDateString(new Date('2026-10-04T15:00:00Z'))), true) // JST 10-05: 8日前
  })

  test('旧実装（UTC 日付）との違い: cron の発火時刻（UTC 15:00）では JST の日付を使う', () => {
    const cronTime = new Date('2026-10-05T15:00:00Z') // JST 10-06 00:00
    assert.equal(getJstTodayDateString(cronTime), '2026-10-06')
    assert.equal(cronTime.toISOString().slice(0, 10), '2026-10-05', '旧実装はこちら（1日遅れ）')
  })
})

describe('dry-run の集計（個人情報を含まない）', () => {
  const NOW = new Date('2026-10-05T03:00:00Z') // JST 12:00
  const row = (id: string, status: string, daysAgo: number, preview: string | null, est: number | null) => ({
    id, status, event_date: ago(daysAgo), preview_datetime: preview, estimate_amount: est,
  })

  test('status 別・下見・見積・開催月・最古/最新を集計する', () => {
    const s = summarizeAutoCancelCandidates({
      candidates: [
        row('a', 'inquiry', 10, null, 0),
        row('b', 'inquiry', 12, '2026-09-20T10:00:00+00:00', 500000), // 下見実施済み
        row('c', 'previewed', 20, '2026-10-20T10:00:00+00:00', null), // 未来の下見
        row('d', 'preview_adj', 30, null, null),
      ],
      tentativeEventDates: [ago(3), ago(50)],
      outsideLookbackCount: 7,
      todayJst: TODAY,
      now: NOW,
    })
    assert.equal(s.totalCandidates, 4)
    assert.deepEqual(s.byStatus, { inquiry: 2, preview_adj: 1, previewed: 1 })
    assert.deepEqual(s.preview, { done: 1, none: 2, future: 1 })
    assert.equal(s.withEstimate, 1)
    assert.equal(s.oldestEventDate, ago(30))
    assert.equal(s.newestEventDate, ago(10))
    assert.deepEqual(s.byEventMonth, { '2026-09': 4 })
    assert.deepEqual(s.tentativeManualReview, { total: 2, withinLookbackWindow: 1 })
    assert.equal(s.outsideLookbackWindow, 7)
  })

  test('開催月が複数月にまたがる場合は月別に分かれ、昇順に並ぶ', () => {
    const s = summarizeAutoCancelCandidates({
      candidates: [
        { id: 'a', status: 'inquiry', event_date: '2026-09-30', preview_datetime: null, estimate_amount: 0 },
        { id: 'b', status: 'inquiry', event_date: '2026-09-12', preview_datetime: null, estimate_amount: 0 },
      ],
      tentativeEventDates: [], outsideLookbackCount: 0, todayJst: '2026-10-08', now: NOW,
    })
    assert.deepEqual(Object.keys(s.byEventMonth), ['2026-09'])
    const s2 = summarizeAutoCancelCandidates({
      candidates: [
        { id: 'a', status: 'inquiry', event_date: '2026-10-01', preview_datetime: null, estimate_amount: 0 },
        { id: 'b', status: 'inquiry', event_date: '2026-09-28', preview_datetime: null, estimate_amount: 0 },
      ],
      tentativeEventDates: [], outsideLookbackCount: 0, todayJst: '2026-10-15', now: NOW,
    })
    assert.deepEqual(s2.byEventMonth, { '2026-09': 1, '2026-10': 1 })
    assert.deepEqual(Object.keys(s2.byEventMonth), ['2026-09', '2026-10'])
  })

  test('候補0件でも例外にならない', () => {
    const s = summarizeAutoCancelCandidates({ candidates: [], tentativeEventDates: [], outsideLookbackCount: 0, todayJst: TODAY, now: NOW })
    assert.equal(s.totalCandidates, 0)
    assert.equal(s.oldestEventDate, null)
    assert.deepEqual(s.byEventMonth, {})
  })
})
