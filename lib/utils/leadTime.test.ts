/**
 * 分析「先行期間」（中央値・件数・集計途中）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/leadTime.test.ts
 * DB・ネットワーク接続は一切使用しない。案件はすべて架空。
 *
 * 方針: 既存の集計（対象・平均日数・平均月数）は変えず、中央値・件数・集計途中だけを追加する。
 *       そのため、旧実装（このファイル内に写した参照実装）と平均が完全一致することを確認する。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLeadTimeResponse, calcLeadDays, getJstYearMonth, isPartialMonth, medianOf } from './leadTime.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

// ── 架空データのヘルパー ─────────────────────────────────────
const DAY = 86400000
const addDays = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
/** 開催日と先行日数から、問合せ日が決まる案件 */
const caseOf = (event_date: string, lead: number, extra: Record<string, unknown> = {}) => ({ event_date, inquiry_date: addDays(event_date, -lead), ...extra })
/** 同じ開催月にまとめて作る（開催日は月の 10 日） */
const monthCases = (year: number, month: number, leads: number[], extra: Record<string, unknown> = {}) =>
  leads.map((l) => caseOf(`${year}-${String(month).padStart(2, '0')}-10`, l, extra))

/** 旧実装（app/api/analytics/lead-time/route.ts の集計部分をそのまま写したもの。実行環境が UTC のときの結果） */
function legacy(cases: { inquiry_date: string; event_date: string }[]) {
  const byMonth: Record<number, number[]> = {}
  for (let m = 1; m <= 12; m++) byMonth[m] = []
  for (const c of cases) {
    const eventDate = new Date(c.event_date)
    const inquiryDate = new Date(c.inquiry_date)
    const leadDays = Math.round((eventDate.getTime() - inquiryDate.getTime()) / (1000 * 60 * 60 * 24))
    if (leadDays < 0) continue
    byMonth[eventDate.getMonth() + 1].push(leadDays)
  }
  const rows = Object.entries(byMonth).map(([m, days]) => {
    const count = days.length
    const avgDays = count > 0 ? Math.round(days.reduce((s, d) => s + d, 0) / count) : 0
    return { month: Number(m), label: `${Number(m)}月`, count, avgDays, avgMonths: count > 0 ? Math.round((avgDays / 30) * 10) / 10 : 0 }
  })
  const all = Object.values(byMonth).flat()
  const n = all.length
  const ad = n > 0 ? Math.round(all.reduce((s, d) => s + d, 0) / n) : 0
  return { rows, total: { count: n, avgDays: ad, avgMonths: n > 0 ? Math.round((ad / 30) * 10) / 10 : 0 } }
}

// 現在 = 2026-10-05 12:00 JST
const NOW = new Date('2026-10-05T03:00:00Z')
const row = (res: ReturnType<typeof buildLeadTimeResponse>, month: number) => res.rows.find((r) => r.month === month)!

describe('中央値（medianOf）', () => {
  test('CASE 1: 奇数件 → 中央の 1 値', () => {
    assert.equal(medianOf([10, 20, 30]), 20)
    assert.equal(medianOf([30, 10, 20]), 20, '順不同でも')
    assert.equal(medianOf([5, 1, 9, 3, 7]), 5)
  })
  test('CASE 2: 偶数件 → 中央 2 値の平均', () => {
    assert.equal(medianOf([10, 20, 30, 40]), 25)
    assert.equal(medianOf([40, 10, 30, 20]), 25)
  })
  test('CASE 3: 1 件だけ → その値', () => {
    assert.equal(medianOf([42]), 42)
  })
  test('CASE 4: 0 件 → null（0 ではない）', () => {
    assert.equal(medianOf([]), null)
  })
  test('CASE 5: 中央値が .5 になる（丸めない）', () => {
    assert.equal(medianOf([10, 21]), 15.5)
    assert.equal(medianOf([1, 2, 3, 4]), 2.5)
    assert.equal(medianOf([38, 39]), 38.5)
  })
  test('元の配列を並べ替えない（副作用なし）', () => {
    const a = [3, 1, 2]
    medianOf(a)
    assert.deepEqual(a, [3, 1, 2])
  })
  test('外れ値に引っ張られない（平均との違い）', () => {
    const v = [10, 11, 12, 13, 400]
    assert.equal(medianOf(v), 12)
    assert.ok(v.reduce((s, x) => s + x, 0) / v.length > 80, '平均は 89.2 まで引っ張られる')
  })
})

describe('件数・除外条件（既存仕様のまま）', () => {
  test('CASE 11: 件数 = 計算に実際に採用した案件数（月ごと・年間）', () => {
    const res = buildLeadTimeResponse([...monthCases(2026, 3, [10, 20, 30]), ...monthCases(2026, 4, [5, 15])], '2026', NOW)
    assert.equal(row(res, 3).count, 3)
    assert.equal(row(res, 4).count, 2)
    assert.equal(row(res, 5).count, 0)
    assert.equal(res.total.count, 5)
  })

  test('CASE 6: 負のリード日数（問合せが開催後）は除外。件数にも中央値にも入らない', () => {
    const res = buildLeadTimeResponse([...monthCases(2026, 3, [10, 20, 30]), caseOf('2026-03-10', -5), caseOf('2026-03-10', -100)], '2026', NOW)
    assert.equal(row(res, 3).count, 3)
    assert.equal(row(res, 3).medianDays, 20)
    assert.equal(row(res, 3).avgDays, 20)
  })

  test('リード日数 0（問合せ日 = 開催日）は採用する', () => {
    const res = buildLeadTimeResponse(monthCases(2026, 3, [0, 10]), '2026', NOW)
    assert.equal(row(res, 3).count, 2)
    assert.equal(row(res, 3).medianDays, 5)
  })

  test('CASE 7, 8: inquiry_date なし / event_date なしは除外', () => {
    const res = buildLeadTimeResponse(
      [
        ...monthCases(2026, 3, [10, 30]),
        { inquiry_date: null, event_date: '2026-03-10' },
        { inquiry_date: '2026-01-01', event_date: null },
        { inquiry_date: '', event_date: '2026-03-10' },
        { inquiry_date: null, event_date: null },
      ],
      '2026',
      NOW
    )
    assert.equal(row(res, 3).count, 2)
    assert.equal(res.total.count, 2)
  })

  test('CASE 9: cancelled も従来どおり含める（status で除外しない）', () => {
    const res = buildLeadTimeResponse(
      [...monthCases(2026, 3, [10, 20], { status: 'cancelled' }), ...monthCases(2026, 3, [30], { status: 'confirmed' }), ...monthCases(2026, 3, [40], { status: 'inquiry' })],
      '2026',
      NOW
    )
    assert.equal(row(res, 3).count, 4)
    assert.equal(row(res, 3).medianDays, 25)
    assert.equal(row(res, 3).avgDays, 25)
  })

  test('route は status で絞り込まない（cancelled を含める従来仕様）', () => {
    const route = read('app/api/analytics/lead-time/route.ts')
    assert.doesNotMatch(route, /['"]status['"]/)
    assert.doesNotMatch(route, /\.neq\(|\.in\(|\.eq\('status/)
    assert.match(route, /\.not\('inquiry_date', 'is', null\)/)
    assert.match(route, /\.not\('event_date',\s+'is', null\)/)
    assert.match(route, /\.gte\('event_date', `\$\{year\}-01-01`\)/)
    assert.match(route, /\.lte\('event_date', `\$\{year\}-12-31`\)/)
  })
})

describe('既存の平均は変わらない（旧実装との一致）', () => {
  /** 決定的な疑似乱数（再現性のため） */
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

  test('CASE 10: 月ごとの件数・平均日数・平均月数・年間が、旧実装と完全に一致する（2000 件・負・欠損を含む）', () => {
    const r = rng(7)
    const cases: { inquiry_date: string; event_date: string }[] = []
    for (let i = 0; i < 2000; i++) {
      const month = 1 + Math.floor(r() * 12)
      const day = 1 + Math.floor(r() * 28)
      const event = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      cases.push({ event_date: event, inquiry_date: addDays(event, Math.floor(r() * 400) - 20) }) // 一部は負のリード日数
    }
    const mine = buildLeadTimeResponse(cases, '2026', NOW)
    const old = legacy(cases)
    assert.deepEqual(mine.rows.map(({ month, label, count, avgDays, avgMonths }) => ({ month, label, count, avgDays, avgMonths })), old.rows)
    assert.deepEqual({ count: mine.total.count, avgDays: mine.total.avgDays, avgMonths: mine.total.avgMonths }, old.total)
  })

  test('CASE 18: 基準値の形（394 件 / 平均 83 日 / 中央値 71 日 / 2.8 ヶ月）を架空データで再現し、維持される', () => {
    // 196 件 = 40 日、2 件 = 71 日、196 件 = 126 日 → 中央値は 197・198 番目の 71 日、平均は 82.94 → 83 日
    const leads = [...Array(196).fill(40), 71, 71, ...Array(196).fill(126)]
    const events = ['2026-03-10', '2026-06-10', '2026-09-10', '2026-12-10']
    const cases = leads.map((l, i) => caseOf(events[i % 4], l))
    const res = buildLeadTimeResponse(cases, '2026', NOW)
    assert.equal(res.total.count, 394)
    assert.equal(res.total.avgDays, 83)
    assert.equal(res.total.medianDays, 71)
    assert.equal(res.total.avgMonths, 2.8)
    assert.equal(res.total.medianMonths, 2.4)
    const old = legacy(cases)
    assert.deepEqual({ count: res.total.count, avgDays: res.total.avgDays, avgMonths: res.total.avgMonths }, old.total)
  })

  test('平均月数は「丸めた平均日数 ÷ 30」の従来式のまま（中央値の月数も ÷ 30・小数 1 桁）', () => {
    const res = buildLeadTimeResponse(monthCases(2026, 3, [14, 16]), '2026', NOW) // 平均 15 日 → 0.5、中央値 15 → 0.5
    assert.equal(row(res, 3).avgDays, 15)
    assert.equal(row(res, 3).avgMonths, 0.5)
    const r2 = buildLeadTimeResponse(monthCases(2026, 12, [124]), '2026', NOW)
    assert.equal(row(r2, 12).medianDays, 124)
    assert.equal(row(r2, 12).medianMonths, 4.1) // 124 / 30 = 4.13
    assert.equal(row(r2, 12).avgMonths, 4.1)
  })

  test('CASE 17: 年間中央値（全月をまとめた日数配列から計算する。月の中央値の中央値ではない）', () => {
    const res = buildLeadTimeResponse([...monthCases(2026, 3, [10, 20, 30]), ...monthCases(2026, 6, [100, 200])], '2026', NOW)
    assert.equal(res.total.medianDays, 30) // [10,20,30,100,200]
    assert.equal(res.total.count, 5)
  })

  test('0 件: 平均は 0（従来どおり）、中央値は null', () => {
    const res = buildLeadTimeResponse([], '2026', NOW)
    assert.equal(res.total.count, 0)
    assert.equal(res.total.avgDays, 0)
    assert.equal(res.total.avgMonths, 0)
    assert.equal(res.total.medianDays, null)
    assert.equal(res.total.medianMonths, null)
    assert.equal(res.rows.length, 12)
    assert.equal(row(res, 5).avgDays, 0)
    assert.equal(row(res, 5).medianDays, null)
  })

  test('CASE 19: 既存の API フィールドを削除・改名していない（追加のみ）', () => {
    const res = buildLeadTimeResponse(monthCases(2026, 3, [10]), '2026', NOW)
    assert.deepEqual(Object.keys(res).sort(), ['rows', 'total', 'year'])
    for (const k of ['month', 'label', 'count', 'avgDays', 'avgMonths']) assert.ok(k in res.rows[0], k)
    for (const k of ['count', 'avgDays', 'avgMonths']) assert.ok(k in res.total, k)
    for (const k of ['medianDays', 'medianMonths', 'isPartial']) assert.ok(k in res.rows[0], `追加: ${k}`)
    assert.equal(res.year, '2026')
    assert.equal(buildLeadTimeResponse([], null, NOW).year, 'all')
  })
})

describe('集計途中（isPartial）— 現在の年月は日本時間で判定', () => {
  test('CASE 12〜14: 過去月は false、当月と未来月は true（現在 = 2026-10-05 JST）', () => {
    const cases = [9, 10, 11, 12].flatMap((m) => monthCases(2026, m, [30, 60]))
    const res = buildLeadTimeResponse(cases, '2026', NOW)
    assert.equal(row(res, 9).isPartial, false, '9 月（過去）')
    assert.equal(row(res, 10).isPartial, true, '10 月（当月）')
    assert.equal(row(res, 11).isPartial, true, '11 月（未来）')
    assert.equal(row(res, 12).isPartial, true, '12 月（未来）')
    for (let m = 1; m <= 9; m++) assert.equal(row(res, m).isPartial, false, `${m} 月`)
    assert.equal(res.total.isPartial, true, '当年は集計途中を含む')
  })

  test('過去の年は全月 false（年間も false）／未来の年は全月 true', () => {
    const past = buildLeadTimeResponse(monthCases(2025, 12, [30]), '2025', NOW)
    assert.ok(past.rows.every((r) => r.isPartial === false))
    assert.equal(past.total.isPartial, false)
    const future = buildLeadTimeResponse(monthCases(2027, 1, [30]), '2027', NOW)
    assert.ok(future.rows.every((r) => r.isPartial === true))
    assert.equal(future.total.isPartial, true)
  })

  test('全期間（year 指定なし）は年が混ざるため集計途中の判定はしない', () => {
    const res = buildLeadTimeResponse(monthCases(2026, 12, [30]), null, NOW)
    assert.ok(res.rows.every((r) => r.isPartial === false))
    assert.equal(res.total.isPartial, false)
  })

  test('CASE 15: JST 0:00〜8:59 でも現在月がずれない（UTC ではまだ前月の時刻）', () => {
    // UTC 2026-10-31 15:30 = JST 2026-11-01 00:30。UTC の月は 10 月、JST の月は 11 月
    const t = new Date('2026-10-31T15:30:00Z')
    assert.deepEqual(getJstYearMonth(t), { year: 2026, month: 11 })
    assert.equal(isPartialMonth(2026, 10, t), false, '10 月は日本時間ではもう過去（UTC 判定だと当月扱いになる）')
    assert.equal(isPartialMonth(2026, 11, t), true)
    // UTC 2026-10-31 14:59 = JST 10-31 23:59 → まだ 10 月
    const before = new Date('2026-10-31T14:59:00Z')
    assert.deepEqual(getJstYearMonth(before), { year: 2026, month: 10 })
    assert.equal(isPartialMonth(2026, 10, before), true)
    // JST 08:59（UTC 前日 23:59）も同日
    assert.deepEqual(getJstYearMonth(new Date('2026-10-31T23:59:00Z')), { year: 2026, month: 11 })
    assert.deepEqual(getJstYearMonth(new Date('2026-11-01T00:00:00Z')), { year: 2026, month: 11 })
  })

  test('CASE 16: 年またぎ（2026-12 → 2027-01）', () => {
    const jan1 = new Date('2026-12-31T15:00:00Z') // JST 2027-01-01 00:00
    assert.deepEqual(getJstYearMonth(jan1), { year: 2027, month: 1 })
    assert.equal(isPartialMonth(2026, 12, jan1), false)
    assert.equal(isPartialMonth(2027, 1, jan1), true)
    const dec31 = new Date('2026-12-31T14:59:59Z') // JST 2026-12-31 23:59:59
    assert.deepEqual(getJstYearMonth(dec31), { year: 2026, month: 12 })
    assert.equal(isPartialMonth(2026, 12, dec31), true)
    assert.equal(isPartialMonth(2027, 1, dec31), true)
    assert.equal(isPartialMonth(2026, 11, dec31), false)
  })

  test('実行環境のタイムゾーンを変えても、月別の件数・平均・中央値・集計途中は同じ', () => {
    const cases = [3, 6, 10, 11, 12].flatMap((m) => monthCases(2026, m, [20, 45, 90, 130]))
    const snapshot = () => JSON.stringify(buildLeadTimeResponse(cases, '2026', new Date('2026-10-31T15:30:00Z')))
    const original = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      const base = snapshot()
      for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/London']) {
        process.env.TZ = tz
        assert.equal(snapshot(), base, tz)
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  test('月の判定は new Date().getMonth() を使わない（静的検査）', () => {
    const src = read('lib/utils/leadTime.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(src, /\.getMonth\(|\.getFullYear\(|getUTCMonth|new Date\(\)\.toISOString/)
    assert.match(src, /toJstWallClock/)
  })
})

describe('calcLeadDays', () => {
  test('日数差（UTC 0 時どうし）。月またぎ・うるう日・年またぎ', () => {
    assert.equal(calcLeadDays('2026-01-01', '2026-01-31'), 30)
    assert.equal(calcLeadDays('2028-02-28', '2028-03-01'), 2)
    assert.equal(calcLeadDays('2025-12-31', '2026-01-01'), 1)
    assert.equal(calcLeadDays('2026-05-01', '2026-04-01'), -30)
  })
  test('日付として読めない値は NaN（集計で除外される）', () => {
    assert.ok(Number.isNaN(calcLeadDays('not-a-date', '2026-01-01')))
    const res = buildLeadTimeResponse([{ inquiry_date: 'x', event_date: '2026-03-10' }, ...monthCases(2026, 3, [10])], '2026', NOW)
    assert.equal(res.total.count, 1)
  })
})

describe('CASE 20: 他の分析・画面への影響なし', () => {
  test('lead-time の応答を使うのは先行期間タブ（LeadTimeTab）だけ。他の API はこの集計を使わない', () => {
    const page = read('app/(dashboard)/analytics/page.tsx')
    assert.equal((page.match(/\/api\/analytics\/lead-time/g) ?? []).length, 1)
    for (const f of ['dashboard', 'monthly', 'yearly', 'media', 'contact-methods', 'floors', 'event-categories', 'cancel-reasons', 'media-monthly']) {
      assert.ok(!read(`app/api/analytics/${f}/route.ts`).includes('leadTime'), f)
    }
  })

  test('route は集計を buildLeadTimeResponse に委ね、leadTime.ts は analytics.ts の JST 変換だけに依存する', () => {
    assert.match(read('app/api/analytics/lead-time/route.ts'), /buildLeadTimeResponse\(cases, year\)/)
    const src = read('lib/utils/leadTime.ts')
    assert.deepEqual(Array.from(src.matchAll(/^import .* from '(.*)'$/gm), (m) => m[1]), ['./analytics.ts'])
  })

  test('画面: 既存の列・カードを残し、中央値・件数・集計途中を追加している（平均の系列は変更しない）', () => {
    const page = read('app/(dashboard)/analytics/page.tsx')
    const tab = page.slice(page.indexOf('function LeadTimeTab()'), page.indexOf('// ─── 飲食プランタブ'))
    for (const s of ['年間対象件数', '年間平均リード日数', '年間平均先行月数', '開催月別 平均先行月数', '<TH right>平均日数</TH>', '<TH right>平均先行月数</TH>', '<TH>開催月</TH>', '<TH right>件数</TH>']) {
      assert.ok(tab.includes(s), s)
    }
    assert.ok(tab.includes('年間中央値') && tab.includes('<TH right>中央値</TH>'))
    assert.ok(tab.includes('集計途中：今後、開催日に近い問い合わせが追加されるため、平均値が変動する可能性があります。'))
    assert.match(tab, /r\.isPartial && r\.count > 0 && <PartialBadge \/>/)
    // 現在月の判定は API（日本時間）が返す isPartial のみ。画面側で月を計算しない
    assert.doesNotMatch(tab.replace(/new Date\(\)\.getFullYear\(\)/g, ''), /getMonth\(|new Date\(\)\.getTime|Date\.now/)
  })
})
