/**
 * 営業ファネル（問合せ → 下見 → 確定）の KPI 定義の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/previewConversion.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。件数・日時はすべて架空。
 *
 * 定義:
 *   下見              = 下見実施済み = preview_datetime が現在日時以前（未来の下見予定は含めない）
 *   問合せ→下見率     = 下見 ÷ 問合せ
 *   確定              = confirmed + done の全件（下見を経由しない直接確定も含む）
 *   問合せ→確定率     = 確定 ÷ 問合せ（cvRate）
 *   下見経由確定      = 下見実施済み かつ 確定/開催終了（previewConfirmed）
 *   下見→確定率      = 下見経由確定 ÷ 下見（confirmRate）。全確定 ÷ 下見ではない
 *
 * 日時: preview_datetime は「日本時間の壁時計」をそのまま UTC 欄に保存する規約のため、
 *       保存値の日付・時刻を日本時間として、日本時間の現在時刻と比較する。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calcKpi, isPreviewDone, toJstWallClock, type CaseRow } from './analytics.ts'
import type { CaseStatus } from '../../types/database.ts'

// 固定の現在日時: 2026-10-05 12:00:00 JST（= 03:00:00 UTC）
const NOW = new Date('2026-10-05T03:00:00Z')

// DB（PostgREST）から返る形式。時刻部分は日本時間の壁時計
const PAST = '2026-10-05T11:00:00+00:00'      // 今日 11:00（実施済み）
const EXACT = '2026-10-05T12:00:00+00:00'     // 今日 12:00:00（現在日時ちょうど）
const FUTURE = '2026-10-05T12:00:01+00:00'    // 1秒後（未来）
const FUTURE_DAY = '2026-10-11T00:00:00+00:00'
const OLD = '2026-04-01T10:00:00+00:00'

let seq = 0
function row(status: CaseStatus, preview: string | null = null, over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: `c${++seq}`, status, auto_cancel: false, preview_datetime: preview, estimate_amount: 0,
    inquiry_date: '2026-10-01', event_date: null, media_id: null, contact_method_id: null, floor_id: null,
    event_category_id: null, event_subcategory_id: null, cancel_reason_id: null, cancel_note: null, company: 'dummy', ...over,
  }
}
const many = (n: number, f: () => CaseRow) => Array.from({ length: n }, f)

describe('CASE 1〜2: 新しい定義の率', () => {
  test('CASE 1: 問合せ10 / 下見5 / 全確定4 / 下見経由確定3 → 下見率50% 問合せ→確定率40% 下見→確定率60%', () => {
    const cases = [
      row('confirmed', PAST), row('done', PAST), row('confirmed', OLD), // 下見経由確定 3
      row('confirmed', null),                                           // 直接確定 1
      row('inquiry', PAST), row('cancelled', PAST),                     // 下見したが未確定 2
      ...many(4, () => row('inquiry')),                                 // 下見なし 4
    ]
    assert.equal(cases.length, 10)
    const k = calcKpi(cases, NOW)
    assert.equal(k.inquiry, 10)
    assert.equal(k.preview, 5)
    assert.equal(k.previewRate, 50)
    assert.equal(k.confirmed, 4)
    assert.equal(k.cvRate, 40)
    assert.equal(k.previewConfirmed, 3)
    assert.equal(k.confirmRate, 60)
  })

  test('CASE 2: 下見なしの直接確定があっても、全確定を分子にしない（250%にならない）', () => {
    const cases = [
      row('confirmed', PAST),                       // 下見経由確定 1
      ...many(4, () => row('confirmed')),           // 直接確定 4
      row('inquiry', PAST),                         // 下見のみ 1
      ...many(4, () => row('inquiry')),
    ]
    assert.equal(cases.length, 10)
    const k = calcKpi(cases, NOW)
    assert.equal(k.preview, 2)
    assert.equal(k.previewRate, 20)
    assert.equal(k.confirmed, 5)
    assert.equal(k.cvRate, 50)
    assert.equal(k.previewConfirmed, 1)
    assert.equal(k.confirmRate, 50)
    assert.notEqual(k.confirmRate, 250, '旧定義（全確定 ÷ 下見）の値ではない')
  })
})

describe('CASE 3〜7, 10: 下見実施済みの判定', () => {
  test('CASE 3: 未来の preview_datetime は下見に含めない', () => {
    const k = calcKpi([row('inquiry', FUTURE), row('inquiry', FUTURE_DAY), row('inquiry', PAST)], NOW)
    assert.equal(k.preview, 1)
    assert.equal(k.previewRate, 33)
  })

  test('CASE 4: 未来の下見予定を持つ confirmed → 全確定には含めるが、下見・下見経由確定には含めない', () => {
    const k = calcKpi([row('confirmed', FUTURE_DAY)], NOW)
    assert.equal(k.confirmed, 1)
    assert.equal(k.preview, 0)
    assert.equal(k.previewConfirmed, 0)
    assert.equal(k.cvRate, 100)
    assert.equal(k.confirmRate, 0)
  })

  test('CASE 5: 過去の下見 + confirmed → 下見にも下見経由確定にも含める', () => {
    const k = calcKpi([row('confirmed', PAST)], NOW)
    assert.deepEqual([k.preview, k.previewConfirmed, k.confirmed, k.confirmRate], [1, 1, 1, 100])
  })

  test('CASE 6: 過去の下見 + done → 下見にも下見経由確定にも含める', () => {
    const k = calcKpi([row('done', OLD)], NOW)
    assert.deepEqual([k.preview, k.previewConfirmed, k.confirmed, k.confirmRate], [1, 1, 1, 100])
  })

  test('CASE 7: 過去の下見 + cancelled → 下見には含めるが、下見経由確定には含めない', () => {
    const k = calcKpi([row('cancelled', PAST)], NOW)
    assert.deepEqual([k.preview, k.previewConfirmed, k.confirmed, k.confirmRate], [1, 0, 0, 0])
    // キャンセルの下見前/後は従来どおり（今回変更しない）
    assert.deepEqual([k.cancelBeforePreview, k.cancelAfterPreview], [0, 1])
  })

  test('キャンセルの下見前/後の判定は従来どおり preview_datetime の有無（予定を含む）。下見件数とは別軸', () => {
    const k = calcKpi([row('cancelled', FUTURE_DAY), row('cancelled', null), row('cancelled', PAST)], NOW)
    assert.equal(k.preview, 1, '下見は実施済みのみ')
    assert.deepEqual([k.cancelBeforePreview, k.cancelAfterPreview], [1, 2], 'キャンセルの前後は従来の判定のまま')
    assert.equal(k.cancelBeforePreview + k.cancelAfterPreview, k.cancelManual + k.cancelAuto)
  })

  test('CASE 10: 現在日時ちょうどの preview_datetime は実施済み。1秒後は未来', () => {
    assert.equal(isPreviewDone(EXACT, NOW), true)
    assert.equal(isPreviewDone(FUTURE, NOW), false)
    assert.equal(calcKpi([row('inquiry', EXACT)], NOW).preview, 1)
    assert.equal(calcKpi([row('inquiry', FUTURE)], NOW).preview, 0)
    // 現在日時の小数秒は無視（12:00:00.999 でも 12:00:00 は実施済み、12:00:01 は未来）
    const justAfter = new Date('2026-10-05T03:00:00.999Z')
    assert.equal(isPreviewDone(EXACT, justAfter), true)
    assert.equal(isPreviewDone(FUTURE, justAfter), false)
  })

  test('日付のみ（時刻なし）の下見は、その日の 00:00 として扱う（当日から実施済み、翌日は未来）', () => {
    assert.equal(isPreviewDone('2026-10-05T00:00:00+00:00', NOW), true) // 取込み・日付のみ登録の保存形式
    assert.equal(isPreviewDone('2026-10-05', NOW), true)
    assert.equal(isPreviewDone('2026-10-06', NOW), false)
    assert.equal(isPreviewDone('2026-10-05 11:00:00+00', NOW), true, 'スペース区切りも読める')
  })

  test('null / 空 / 不正な文字列は下見なし（例外を出さない）', () => {
    for (const v of [null, undefined, '', 'abc', '2026/10/05']) assert.equal(isPreviewDone(v as string | null, NOW), false)
    assert.equal(calcKpi([row('inquiry', 'abc')], NOW).preview, 0)
  })
})

describe('CASE 11: タイムゾーン（JST/UTC）の境界', () => {
  test('日本時間の日付をまたぐ瞬間: 保存値の壁時計を日本時間として判定する', () => {
    // 2026-10-05 15:30 UTC = 2026-10-06 00:30 JST
    const now = new Date('2026-10-05T15:30:00Z')
    assert.equal(toJstWallClock(now), '2026-10-06T00:30:00')
    // 10-06 00:00（日本時間）の下見はもう実施済み。瞬間として比較すると 10-06 00:00Z は未来になってしまう
    assert.equal(isPreviewDone('2026-10-06T00:00:00+00:00', now), true)
    assert.ok(Date.parse('2026-10-06T00:00:00+00:00') > now.getTime(), '（参考）瞬間として比較すると未来になる＝使ってはいけない比較')
    // 10-06 01:00（日本時間）の下見はまだ未来
    assert.equal(isPreviewDone('2026-10-06T01:00:00+00:00', now), false)
  })

  test('UTC 日付ではまだ前日の時間帯（UTC 14:59 = JST 23:59）でも、日本時間の日付で判定する', () => {
    const now = new Date('2026-10-05T14:59:59Z') // JST 23:59:59
    assert.equal(isPreviewDone('2026-10-05T23:59:59+00:00', now), true)
    assert.equal(isPreviewDone('2026-10-06T00:00:00+00:00', now), false)
  })

  test('保存値の「今日 12:00」は、日本時間 12:00 を過ぎた時点で実施済み（UTC 03:00）', () => {
    // 本番で実際に起きた境界: 保存値 12:00 の下見は、UTC 03:00（JST 12:00）以降に実施済みになる
    assert.equal(isPreviewDone(EXACT, new Date('2026-10-05T02:59:59Z')), false)
    assert.equal(isPreviewDone(EXACT, new Date('2026-10-05T03:00:00Z')), true)
    // 真の瞬間として比較するなら 12:00Z まで未来扱いになる（9時間のずれ）
    assert.ok(Date.parse(EXACT) > new Date('2026-10-05T03:00:00Z').getTime())
  })

  test('実行環境のタイムゾーン（process.env.TZ）に結果が依存しない', () => {
    const cases = [row('confirmed', PAST), row('confirmed', FUTURE), row('inquiry', EXACT), row('inquiry')]
    const original = process.env.TZ
    const results: unknown[] = []
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Auckland']) {
        process.env.TZ = tz
        const k = calcKpi(cases, new Date('2026-10-05T03:00:00Z'))
        results.push([k.preview, k.previewConfirmed, k.confirmed, k.previewRate, k.cvRate, k.confirmRate])
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
    for (const r of results) assert.deepEqual(r, results[0])
    assert.deepEqual(results[0], [2, 1, 2, 50, 50, 50])
  })
})

describe('CASE 8, 9, 12: 0 件の扱い', () => {
  test('CASE 8: 下見が 0 件 → 下見→確定率は 0（NaN / Infinity にならない）', () => {
    const k = calcKpi([row('confirmed'), row('inquiry')], NOW)
    assert.equal(k.preview, 0)
    assert.equal(k.confirmRate, 0)
    for (const v of Object.values(k)) assert.ok(Number.isFinite(v as number), `${v}`)
  })

  test('CASE 9: 問合せ 0 件（空配列）→ すべての率が 0', () => {
    const k = calcKpi([], NOW)
    assert.deepEqual([k.inquiry, k.preview, k.confirmed, k.previewConfirmed, k.previewRate, k.cvRate, k.confirmRate], [0, 0, 0, 0, 0, 0, 0])
    for (const v of Object.values(k)) assert.ok(Number.isFinite(v as number))
  })

  test('CASE 12: 直接確定のみ → 問合せ→確定率は通常どおり、下見→確定率は 0', () => {
    const k = calcKpi([...many(3, () => row('confirmed')), ...many(7, () => row('inquiry'))], NOW)
    assert.equal(k.preview, 0)
    assert.equal(k.confirmed, 3)
    assert.equal(k.cvRate, 30)
    assert.equal(k.previewConfirmed, 0)
    assert.equal(k.confirmRate, 0)
  })
})

describe('整合性: 全確定 = 下見経由確定 + 下見なし確定', () => {
  test('あらゆる組合せで成り立ち、下見→確定率は 0〜100% に収まる', () => {
    const statuses: CaseStatus[] = ['inquiry', 'preview_adj', 'previewed', 'tentative', 'confirmed', 'cancelled', 'done']
    const previews: (string | null)[] = [null, OLD, PAST, EXACT, FUTURE, FUTURE_DAY]
    // 7 x 6 の全組合せを 3 回ずつ
    const cases: CaseRow[] = []
    for (const s of statuses) for (const p of previews) for (let i = 0; i < 3; i++) cases.push(row(s, p))
    const k = calcKpi(cases, NOW)
    const confirmedRows = cases.filter((c) => c.status === 'confirmed' || c.status === 'done')
    const direct = confirmedRows.filter((c) => !isPreviewDone(c.preview_datetime, NOW)).length
    assert.equal(k.confirmed, k.previewConfirmed + direct)
    assert.ok(k.previewConfirmed <= k.preview)
    assert.ok(k.previewConfirmed <= k.confirmed)
    assert.ok(k.confirmRate >= 0 && k.confirmRate <= 100)
    // 全組合せ: 下見実施済み = 4 種（OLD/PAST/EXACT 以外に null を除く）のうち 3 種
    assert.equal(k.preview, 7 * 3 * 3)
    assert.equal(k.previewConfirmed, 2 * 3 * 3)
  })

  test('2026年10月5日時点の本番に近い構成: 全確定92 = 下見経由37 + 直接55 → 下見→確定率 41%（旧定義の 100% ではない）', () => {
    // 件数構成のみを再現した架空データ（問合せ533 / 下見実施済み90 / 全確定92 / 下見経由確定37 / 未来の予定を持つ確定1）
    const cases: CaseRow[] = [
      ...many(37, () => row('confirmed', OLD)),          // 下見経由確定
      ...many(54, () => row('done', null)),               // 直接確定
      row('confirmed', FUTURE_DAY),                       // 未来の下見予定を持つ確定（直接確定側）
      ...many(53, () => row('inquiry', OLD)),             // 下見したが未確定
      ...many(533 - 37 - 54 - 1 - 53, () => row('inquiry')),
    ]
    assert.equal(cases.length, 533)
    const k = calcKpi(cases, NOW)
    assert.deepEqual([k.inquiry, k.preview, k.confirmed, k.previewConfirmed], [533, 90, 92, 37])
    assert.equal(k.previewRate, 17)
    assert.equal(k.cvRate, 17)
    assert.equal(k.confirmRate, 41)
  })

  test('既存の他の指標（確定売上・平均単価・キャンセル内訳・見積合計）は変わらない', () => {
    const k = calcKpi([
      row('confirmed', PAST, { estimate_amount: 100000 }), row('done', null, { estimate_amount: 50000 }),
      row('tentative', null, { estimate_amount: 30000 }), row('cancelled', null, { estimate_amount: 999 }),
      row('cancelled', PAST, { auto_cancel: true }),
    ], NOW)
    assert.equal(k.revenue, 150000)
    assert.equal(k.avgPrice, 75000)
    assert.equal(k.estimateTotal, 180000)
    assert.deepEqual([k.cancelManual, k.cancelAuto, k.cancelBeforePreview, k.cancelAfterPreview], [1, 1, 1, 1])
  })
})

describe('CASE 13〜15: 画面の表示（ダッシュボード・分析 年間KPI・月別表）', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
  const dashboard = read('app/(dashboard)/page.tsx')
  const analytics = read('app/(dashboard)/analytics/page.tsx')

  test('CASE 13: ダッシュボードが →下見率 / 問合せ→確定率 / 下見→確定率 を calcKpi の値で表示し、当月 KPI のまま', () => {
    assert.match(dashboard, /label="→下見率" value=\{`\$\{mk\.previewRate\}%`\}/)
    assert.match(dashboard, /label="問合せ→確定率" value=\{`\$\{mk\.cvRate\}%`\}/)
    assert.match(dashboard, /label="下見→確定率" value=\{`\$\{mk\.confirmRate\}%`\}/)
    assert.match(dashboard, /当月KPI/)
    assert.match(dashboard, /const mk = calcKpi\(monthRows, now\)/, '当月の KPI（now を共有）')
    assert.doesNotMatch(dashboard, /KPIカード（年間）/, '誤った「年間」コメントを直した')
  })

  test('分析 API（dashboard）も同じ now を calcKpi に渡し、新しい値（previewConfirmed / confirmRate）を返す', () => {
    const api = read('app/api/analytics/dashboard/route.ts')
    assert.match(api, /calcKpi\(monthRows, now\)/)
    assert.match(api, /calcKpi\(yearRows, now\)/)
    assert.match(api, /thisYear: ykpi/)
  })

  test('CASE 14: 分析 年間KPI に「問合せ→確定率」と「下見→確定率」の両方があり、旧「→確定率」はない', () => {
    assert.match(analytics, /<KPI label="問合せ→確定率"\s+value=\{fmtPct\(yk\.cvRate\)\}/)
    assert.match(analytics, /<KPI label="下見→確定率"\s+value=\{fmtPct\(yk\.confirmRate\)\}/)
    assert.match(analytics, /<KPI label="→下見率"\s+value=\{fmtPct\(yk\.previewRate\)\}/)
    assert.doesNotMatch(analytics, /<KPI label="→確定率"/)
  })

  test('CASE 15: 月別表に「問合せ→確定率」と「下見→確定率」の列があり、合計・平均は分子÷分母', () => {
    assert.match(analytics, /<TH right>→下見率<\/TH><TH right>問合せ→確定率<\/TH><TH right>下見→確定率<\/TH>/)
    assert.doesNotMatch(analytics, /<TH right>→確定率<\/TH>/)
    assert.match(analytics, /fmtPct\(m\.cvRate\)[\s\S]{0,80}fmtPct\(m\.confirmRate\)/, '各月の行')
    assert.match(analytics, /fmtPct\(data\.total\.cvRate\)[\s\S]{0,80}fmtPct\(data\.total\.confirmRate\)/, '合計行（年間の calcKpi 結果）')
    // 平均行: 月別率の平均ではなく 下見経由確定の合計 ÷ 下見の合計
    assert.match(analytics, /avgConfirmRate = totalPreview > 0 \? Math\.round\(\(totalPreviewConfirmed \/ totalPreview\) \* 100\)/)
  })

  test('年別表は今回変更しない（率の列を追加していない）', () => {
    const yearly = analytics.slice(analytics.indexOf('function YearlyTab'), analytics.indexOf('function GenericMasterTab'))
    assert.doesNotMatch(yearly, /confirmRate|cvRate|previewRate/)
  })

  test('認知経路などの集計 API は calcKpi の結果をそのまま返す（新しい下見・確定率が全タブに反映される）', () => {
    for (const rel of ['media', 'event-categories', 'floors', 'contact-methods', 'monthly', 'yearly']) {
      const src = read(`app/api/analytics/${rel}/route.ts`)
      assert.match(src, /calcKpi\(/, rel)
    }
  })
})
