/**
 * calcMediaMonthly の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/analytics.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcMediaMonthly, calcKpi, isPreviewDone, filterRevenueStatuses, REVENUE_STATUSES, UNASSIGNED_MEDIA_ID, UNASSIGNED_MEDIA_LABEL, type CaseRow } from './analytics.ts'

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

// 認知経路 月別内訳の「下見」は、calcKpi と同じ「下見実施済み」（preview_datetime が現在日時以前）だけを数える。
// 集計軸（下見日時の月に数える）は変えない。現在日時は固定して決定論的にテストする。
describe('calcMediaMonthly: 下見は実施済みのみ（未来の下見予定を数えない）', () => {
  // 固定の現在日時: 2026-10-05 12:00:00 JST（= 03:00:00 UTC）。保存値は日本時間の壁時計
  const NOW = new Date('2026-10-05T03:00:00Z')
  const withPreview = (preview: string | null, over: Partial<CaseRow> = {}) =>
    makeCase({ media_id: 'media-a', inquiry_date: '2026-09-20', preview_datetime: preview, ...over })
  const previewByMonth = (cases: CaseRow[], now: Date = NOW) =>
    calcMediaMonthly(cases, [MEDIA_A], '2026', now).find((r) => r.id === 'media-a')!.months.map((m) => m.preview)
  const sumPreview = (cases: CaseRow[], now: Date = NOW) => previewByMonth(cases, now).reduce((a, b) => a + b, 0)

  test('CASE 1: 過去の preview_datetime は下見に含む（下見日時の月に数える）', () => {
    const m = previewByMonth([withPreview('2026-09-25T10:00:00+00:00')])
    assert.equal(m[8], 1) // 9月
    assert.equal(sumPreview([withPreview('2026-09-25T10:00:00+00:00')]), 1)
  })

  test('CASE 2: 現在日時ちょうどは下見に含む', () => {
    assert.equal(previewByMonth([withPreview('2026-10-05T12:00:00+00:00')])[9], 1) // 10月
  })

  test('CASE 3: 現在日時の1秒後は下見に含まない', () => {
    assert.equal(sumPreview([withPreview('2026-10-05T12:00:01+00:00')]), 0)
  })

  test('CASE 4: 未来日は下見に含まない（未来の月にも数えない）', () => {
    const m = previewByMonth([withPreview('2026-10-11T00:00:00+00:00'), withPreview('2026-12-20T15:00:00+00:00')])
    assert.deepEqual(m, new Array(12).fill(0))
  })

  test('CASE 5: preview_datetime が null は下見に含まない', () => {
    assert.equal(sumPreview([withPreview(null)]), 0)
  })

  test('CASE 6〜8: 未来の下見予定を除外しても、問合せ・確定件数は変わらない（売上の元になる確定の判定も同じ）', () => {
    const base = [
      withPreview('2026-09-25T10:00:00+00:00', { status: 'confirmed', confirmed_at: '2026-09-28T00:00:00Z', estimate_amount: 100000 }),
      withPreview('2026-10-11T00:00:00+00:00', { status: 'confirmed', confirmed_at: '2026-10-02T00:00:00Z', estimate_amount: 200000 }), // 未来の下見予定を持つ確定
      withPreview('2026-10-06T17:00:00+00:00', { inquiry_date: '2026-10-01' }),                                                          // 未来の下見予定のみ
      withPreview(null, { inquiry_date: '2026-10-02' }),
    ]
    const withoutFuture = base.map((c) => ({ ...c, preview_datetime: isPreviewDone(c.preview_datetime, NOW) ? c.preview_datetime : null }))
    const a = calcMediaMonthly(base, [MEDIA_A], '2026', NOW).find((r) => r.id === 'media-a')!
    const b = calcMediaMonthly(withoutFuture, [MEDIA_A], '2026', NOW).find((r) => r.id === 'media-a')!
    // 下見の列は、未来の予定を事前に取り除いた入力と同じになる
    assert.deepEqual(a.months, b.months)
    // 問合せ・確定（月別）は、下見の有無・予定の有無で変わらない
    const inq = (r: typeof a) => r.months.map((m) => m.inquiry)
    const cf = (r: typeof a) => r.months.map((m) => m.confirmed)
    const noPreviewAtAll = calcMediaMonthly(base.map((c) => ({ ...c, preview_datetime: null })), [MEDIA_A], '2026', NOW).find((r) => r.id === 'media-a')!
    assert.deepEqual(inq(a), inq(noPreviewAtAll))
    assert.deepEqual(cf(a), cf(noPreviewAtAll))
    assert.equal(inq(a).reduce((x, y) => x + y, 0), 4)
    assert.equal(cf(a).reduce((x, y) => x + y, 0), 2)
    // 売上（calcKpi）も、下見予定の有無で変わらない
    assert.equal(calcKpi(base, NOW).revenue, calcKpi(base.map((c) => ({ ...c, preview_datetime: null })), NOW).revenue)
    assert.equal(calcKpi(base, NOW).revenue, 300000)
  })

  test('CASE 12: JST の日付境界 — 保存値の壁時計を日本時間として判定する', () => {
    // 2026-10-05 15:30 UTC = 2026-10-06 00:30 JST
    const now = new Date('2026-10-05T15:30:00Z')
    assert.equal(sumPreview([withPreview('2026-10-06T00:00:00+00:00')], now), 1, '10-06 00:00（日本時間）は実施済み')
    assert.equal(sumPreview([withPreview('2026-10-06T01:00:00+00:00')], now), 0, '10-06 01:00 はまだ未来')
    assert.equal(previewByMonth([withPreview('2026-10-06T00:00:00+00:00')], now)[9], 1)
    // 月またぎ: 2026-09-30 15:00 UTC = 10-01 00:00 JST
    const monthEnd = new Date('2026-09-30T15:00:00Z')
    assert.equal(previewByMonth([withPreview('2026-10-01T00:00:00+00:00')], monthEnd)[9], 1)
    assert.equal(sumPreview([withPreview('2026-10-01T00:00:01+00:00')], monthEnd), 0)
  })

  test('CASE 13: 実行環境のタイムゾーン（process.env.TZ）を変えても結果は同じ', () => {
    const cases = [withPreview('2026-09-25T10:00:00+00:00'), withPreview('2026-10-05T12:00:00+00:00'), withPreview('2026-10-05T12:00:01+00:00'), withPreview(null)]
    const original = process.env.TZ
    const results: string[] = []
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Auckland']) {
        process.env.TZ = tz
        results.push(JSON.stringify(previewByMonth(cases)))
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
    for (const r of results) assert.equal(r, results[0])
    assert.deepEqual(JSON.parse(results[0]), [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0])
  })

  test('CASE 14: calcKpi と media-monthly で、同一案件の「下見実施済み / 未実施」の判定が一致する', () => {
    const previews = [null, '2026-04-01T10:00:00+00:00', '2026-10-05T11:59:59+00:00', '2026-10-05T12:00:00+00:00', '2026-10-05T12:00:01+00:00', '2026-10-11T00:00:00+00:00', '2026-12-31T23:59:59+00:00']
    for (const now of [NOW, new Date('2026-10-05T02:59:59Z'), new Date('2026-10-05T15:30:00Z'), new Date('2027-01-01T00:00:00Z')]) {
      for (const p of previews) {
        const c = withPreview(p, { inquiry_date: '2026-03-01' })
        const kpiDone = calcKpi([c], now).preview === 1
        const monthlyDone = sumPreview([c], now) === 1
        assert.equal(monthlyDone, kpiDone, `preview=${p} now=${now.toISOString()}`)
        assert.equal(kpiDone, isPreviewDone(p, now))
      }
    }
    // まとめて集計しても、実施済み件数（対象年のもの）の合計が一致する
    const all = previews.map((p) => withPreview(p))
    assert.equal(sumPreview(all, NOW), calcKpi(all, NOW).preview)
  })

  test('CASE 15: 現在時刻を固定すれば再現でき、now を省略した場合は実行時点（未来の予定は数えない）', () => {
    const cases = [withPreview('2026-09-25T10:00:00+00:00'), withPreview('2026-10-11T00:00:00+00:00')]
    assert.equal(sumPreview(cases, new Date('2026-10-05T03:00:00Z')), 1)
    assert.equal(sumPreview(cases, new Date('2026-10-12T03:00:00Z')), 2, '時間が進めば同じ入力でも実施済みになる')
    assert.equal(sumPreview(cases, new Date('2026-09-01T00:00:00Z')), 0)
    // now 省略: 十分に未来の予定だけが 0 件になる（実行日に依存しない確認）
    const farFuture = [withPreview('2099-01-01T00:00:00+00:00'), withPreview('2000-01-01T00:00:00+00:00', { inquiry_date: '2000-01-01' })]
    const rows = calcMediaMonthly(farFuture, [MEDIA_A], '2099')
    assert.equal(rows.find((r) => r.id === 'media-a')!.months.reduce((s, m) => s + m.preview, 0), 0)
  })
})

// REVENUE_STATUSES は /api/analytics/options が対象案件を絞り込む際にも使用される。
// 「確定のみ」への変更を誤って混入させないための回帰テスト。
describe('REVENUE_STATUSES（オプション分析・確定売上集計の対象ステータス）', () => {
  test('confirmed と done の2つのみが対象である', () => {
    assert.deepEqual(REVENUE_STATUSES, ['confirmed', 'done'])
  })

  test('calcKpi の confirmed件数・revenueは confirmed と done の両方を含み、それ以外のステータスは含まない', () => {
    const cases = [
      makeCase({ id: 'c1', status: 'confirmed', estimate_amount: 100000 }),
      makeCase({ id: 'c2', status: 'done', estimate_amount: 50000 }),
      makeCase({ id: 'c3', status: 'tentative', estimate_amount: 999999 }),
      makeCase({ id: 'c4', status: 'cancelled', estimate_amount: 999999 }),
    ]
    const kpi = calcKpi(cases)
    assert.equal(kpi.confirmed, 2)
    assert.equal(kpi.revenue, 150000)
  })

  test('filterRevenueStatuses は確定と開催終了だけを残す', () => {
    const rows = [
      makeCase({ id: 'confirmed', status: 'confirmed' }),
      makeCase({ id: 'done', status: 'done' }),
      makeCase({ id: 'tentative', status: 'tentative' }),
      makeCase({ id: 'cancelled', status: 'cancelled' }),
    ]
    assert.deepEqual(filterRevenueStatuses(rows).map((row) => row.id), ['confirmed', 'done'])
  })
})
