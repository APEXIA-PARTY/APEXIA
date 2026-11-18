/**
 * 日別問合せ（lib/utils/dailyInquiry.ts）の自動テスト。node:test、追加の依存関係なし。
 * 実行: node --test lib/utils/dailyInquiry.test.ts
 * 架空データのみ。Supabase・ネットワークには一切接続しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DAILY_UNASSIGNED_TARGET,
  aggregateByDay,
  buildDailyUrl,
  calcMonthRange,
  calcTotalPages,
  compareValues,
  fetchAllPages,
  formatAmountDiff,
  formatCountDiff,
  formatDayLabel,
  formatRatio,
  formatSubcategoryLabel,
  getJstTodayString,
  isDayInMonth,
  isMonthInProgress,
  isValidDailySummaryResponse,
  isValidDailyCasesResponse,
  isValidDayString,
  isValidMonthString,
  mapDailyCaseRow,
  parseCasesRequest,
  parseDailyParams,
  parseSummaryRequest,
  pickMasterName,
  shiftMonth,
  totalsFromDays,
  type DailyRow,
  type PageResult,
} from './dailyInquiry.ts'

const UUID_A = '11111111-2222-4333-8444-555555555555'

function params(obj: Record<string, string>) {
  return new URLSearchParams(obj)
}

describe('月の計算', () => {
  test('shiftMonth: 1月の前月は前年12月、12月の翌月は翌年1月', () => {
    assert.equal(shiftMonth('2026-01', -1), '2025-12')
    assert.equal(shiftMonth('2026-12', 1), '2027-01')
    assert.equal(shiftMonth('2026-10', -1), '2026-09')
    assert.equal(shiftMonth('2026-10', -12), '2025-10')
  })

  test('calcMonthRange: 月末日とうるう年', () => {
    assert.deepEqual(calcMonthRange('2026-10'), { gte: '2026-10-01', lte: '2026-10-31' })
    assert.deepEqual(calcMonthRange('2026-02'), { gte: '2026-02-01', lte: '2026-02-28' })
    assert.deepEqual(calcMonthRange('2024-02'), { gte: '2024-02-01', lte: '2024-02-29' })
    assert.deepEqual(calcMonthRange('2026-04'), { gte: '2026-04-01', lte: '2026-04-30' })
  })

  test('形式検証: 月・日', () => {
    assert.equal(isValidMonthString('2026-10'), true)
    assert.equal(isValidMonthString('2026-13'), false)
    assert.equal(isValidMonthString('2026-1'), false)
    assert.equal(isValidMonthString('2026-10-01'), false)
    assert.equal(isValidMonthString(null), false)
    assert.equal(isValidDayString('2026-10-31'), true)
    assert.equal(isValidDayString('2026-02-30'), false)
    assert.equal(isValidDayString('2024-02-29'), true)
    assert.equal(isValidDayString('2026-02-29'), false)
    assert.equal(isDayInMonth('2026-10-08', '2026-10'), true)
    assert.equal(isDayInMonth('2026-11-08', '2026-10'), false)
  })

  test('getJstTodayString / isMonthInProgress: JST基準（UTC前日15時はJSTの翌日）', () => {
    const now = new Date('2026-10-31T15:30:00.000Z') // JST 2026-11-01 00:30
    assert.equal(getJstTodayString(now), '2026-11-01')
    assert.equal(isMonthInProgress('2026-11', now), true)
    assert.equal(isMonthInProgress('2026-12', now), true)
    assert.equal(isMonthInProgress('2026-10', now), false)
  })

  test('formatDayLabel: 曜日付き', () => {
    assert.equal(formatDayLabel('2026-10-08'), '10月8日（木）')
    assert.equal(formatDayLabel('2026-10-01'), '10月1日（木）')
  })
})

describe('URLの条件（view / tab / kind / target / month / day / page）', () => {
  test('正常なURLを読み取る', () => {
    const p = parseDailyParams(
      params({ view: 'inquiry', tab: 'daily', kind: 'media', target: UUID_A, month: '2026-10', day: '2026-10-08', page: '2' })
    )
    assert.deepEqual(p, {
      requested: true,
      kind: 'media',
      target: UUID_A,
      month: '2026-10',
      day: '2026-10-08',
      page: 2,
    })
  })

  test('日別問合せタブを指していないURLは requested=false で他の値を無視する', () => {
    const p = parseDailyParams(params({ view: 'event', tab: 'daily', kind: 'media', month: '2026-10' }))
    assert.equal(p.requested, false)
    assert.equal(p.kind, '')
    assert.equal(p.month, '')
    assert.equal(parseDailyParams(params({ view: 'inquiry', tab: 'monthly' })).requested, false)
    assert.equal(parseDailyParams(params({})).requested, false)
  })

  test('不正な値は無視する', () => {
    const base = { view: 'inquiry', tab: 'daily' }
    assert.equal(parseDailyParams(params({ ...base, kind: 'floor' })).kind, '')
    assert.equal(parseDailyParams(params({ ...base, kind: 'media', target: 'abc' })).target, '')
    assert.equal(parseDailyParams(params({ ...base, kind: 'media', target: '<script>' })).target, '')
    assert.equal(parseDailyParams(params({ ...base, month: '2026-13' })).month, '')
    // kind が無ければ target は無効
    assert.equal(parseDailyParams(params({ ...base, target: UUID_A })).target, '')
    // 月が無ければ day は無効 / 別の月の day は無効
    assert.equal(parseDailyParams(params({ ...base, kind: 'media', target: UUID_A, day: '2026-10-08' })).day, '')
    assert.equal(
      parseDailyParams(params({ ...base, kind: 'media', target: UUID_A, month: '2026-10', day: '2026-11-08' })).day,
      ''
    )
    // page は day があるときだけ・正の整数だけ
    const withDay = { ...base, kind: 'media', target: UUID_A, month: '2026-10', day: '2026-10-08' }
    assert.equal(parseDailyParams(params({ ...withDay, page: '0' })).page, 1)
    assert.equal(parseDailyParams(params({ ...withDay, page: '-3' })).page, 1)
    assert.equal(parseDailyParams(params({ ...withDay, page: '1.5' })).page, 1)
    assert.equal(parseDailyParams(params({ ...withDay, page: 'x' })).page, 1)
    assert.equal(parseDailyParams(params({ ...withDay, page: '99999' })).page, 1)
  })

  test('「（未設定）」の仮想IDを target として受け付ける', () => {
    const p = parseDailyParams(
      params({ view: 'inquiry', tab: 'daily', kind: 'category', target: DAILY_UNASSIGNED_TARGET })
    )
    assert.equal(p.target, DAILY_UNASSIGNED_TARGET)
  })

  test('buildDailyUrl: 空の条件は含めず、page は2以上のときだけ', () => {
    assert.equal(
      buildDailyUrl({ kind: '', target: '', month: '', day: '', page: 1 }),
      '/analytics?view=inquiry&tab=daily'
    )
    assert.equal(
      buildDailyUrl({ kind: 'category', target: UUID_A, month: '2026-10', day: '', page: 3 }),
      `/analytics?view=inquiry&tab=daily&kind=category&target=${UUID_A}&month=2026-10`
    )
    assert.equal(
      buildDailyUrl({ kind: 'category', target: UUID_A, month: '2026-10', day: '2026-10-08', page: 1 }),
      `/analytics?view=inquiry&tab=daily&kind=category&target=${UUID_A}&month=2026-10&day=2026-10-08`
    )
    assert.equal(
      buildDailyUrl({ kind: 'media', target: UUID_A, month: '2026-10', day: '2026-10-08', page: 2 }),
      `/analytics?view=inquiry&tab=daily&kind=media&target=${UUID_A}&month=2026-10&day=2026-10-08&page=2`
    )
  })

  test('buildDailyUrl → parseDailyParams で往復できる', () => {
    const state = { kind: 'media' as const, target: UUID_A, month: '2026-10', day: '2026-10-08', page: 2 }
    const url = new URL(buildDailyUrl(state), 'http://localhost')
    const parsed = parseDailyParams(url.searchParams)
    assert.deepEqual({ ...parsed, requested: undefined }, { ...state, requested: undefined })
    assert.equal(parsed.requested, true)
  })
})

describe('APIリクエストの検証', () => {
  test('parseSummaryRequest', () => {
    assert.deepEqual(parseSummaryRequest(params({ kind: 'media', target: UUID_A, month: '2026-10' })), {
      kind: 'media',
      target: UUID_A,
      month: '2026-10',
    })
    assert.equal(parseSummaryRequest(params({ kind: 'media', target: UUID_A })), null)
    assert.equal(parseSummaryRequest(params({ kind: 'x', target: UUID_A, month: '2026-10' })), null)
    assert.equal(parseSummaryRequest(params({ kind: 'media', target: "1' or 1=1", month: '2026-10' })), null)
  })

  test('parseCasesRequest: page の既定は1、不正値は拒否', () => {
    assert.deepEqual(parseCasesRequest(params({ kind: 'category', target: UUID_A, date: '2026-10-08' })), {
      kind: 'category',
      target: UUID_A,
      date: '2026-10-08',
      page: 1,
    })
    assert.equal(parseCasesRequest(params({ kind: 'category', target: UUID_A, date: '2026-10-08', page: '0' })), null)
    assert.equal(parseCasesRequest(params({ kind: 'category', target: UUID_A, date: '2026-02-30' })), null)
    assert.equal(parseCasesRequest(params({ kind: 'category', target: UUID_A })), null)
  })
})

describe('日別集計', () => {
  const rows: DailyRow[] = [
    { inquiry_date: '2026-10-08', status: 'inquiry', estimate_amount: 100000 },
    { inquiry_date: '2026-10-08', status: 'cancelled', estimate_amount: 50000 },
    { inquiry_date: '2026-10-08', status: 'confirmed', estimate_amount: 200000 },
    { inquiry_date: '2026-10-03', status: 'done', estimate_amount: 300000 },
    { inquiry_date: '2026-10-03', status: 'tentative', estimate_amount: 0 },
    { inquiry_date: '2026-10-15', status: 'previewed', estimate_amount: null },
  ]

  test('件数は全ステータス、見込額はキャンセル除外、確定額は確定+開催終了、日付昇順', () => {
    const days = aggregateByDay(rows)
    assert.deepEqual(days, [
      { date: '2026-10-03', count: 2, estimateTotal: 300000, confirmedTotal: 300000 },
      { date: '2026-10-08', count: 3, estimateTotal: 300000, confirmedTotal: 200000 },
      { date: '2026-10-15', count: 1, estimateTotal: 0, confirmedTotal: 0 },
    ])
  })

  test('金額0円・NULL・数値文字列・不正値は0または数値として扱い、件数には含める', () => {
    const days = aggregateByDay([
      { inquiry_date: '2026-10-01', status: 'inquiry', estimate_amount: null },
      { inquiry_date: '2026-10-01', status: 'inquiry', estimate_amount: '12000' },
      { inquiry_date: '2026-10-01', status: 'inquiry', estimate_amount: 'abc' },
    ])
    assert.deepEqual(days, [{ date: '2026-10-01', count: 3, estimateTotal: 12000, confirmedTotal: 0 }])
  })

  test('キャンセルのみの日は、件数に含まれ金額は0', () => {
    const days = aggregateByDay([{ inquiry_date: '2026-10-02', status: 'cancelled', estimate_amount: 80000 }])
    assert.deepEqual(days, [{ date: '2026-10-02', count: 1, estimateTotal: 0, confirmedTotal: 0 }])
  })

  test('対象月に0件でも例外にならない', () => {
    assert.deepEqual(aggregateByDay([]), [])
    assert.deepEqual(totalsFromDays([]), { count: 0, estimateTotal: 0, confirmedTotal: 0 })
  })

  test('totalsFromDays: 日別の合計が月合計と一致する', () => {
    assert.deepEqual(totalsFromDays(aggregateByDay(rows)), { count: 6, estimateTotal: 600000, confirmedTotal: 500000 })
  })
})

describe('前月比・前年同月比', () => {
  test('比較対象が0のとき、比率は null（表示は —）、差分は出す', () => {
    const c = compareValues(5, 0)
    assert.equal(c.ratio, null)
    assert.equal(c.diff, 5)
    assert.equal(formatRatio(c.ratio), '—')
  })

  test('両方0 → 比率 —、差分 ±0', () => {
    const c = compareValues(0, 0)
    assert.equal(c.ratio, null)
    assert.equal(formatCountDiff(c.diff), '±0件')
    assert.equal(formatAmountDiff(c.diff), '±0')
  })

  test('通常の比率（小数点1桁）と差分の符号', () => {
    assert.deepEqual(compareValues(12, 10), { diff: 2, ratio: 120 })
    assert.deepEqual(compareValues(1, 3), { diff: -2, ratio: 33.3 })
    assert.equal(formatRatio(33.3), '33.3%')
    assert.equal(formatCountDiff(2), '+2件')
    assert.equal(formatCountDiff(-2), '-2件')
    assert.equal(formatAmountDiff(1500000), '+1,500,000')
    assert.equal(formatAmountDiff(-3000), '-3,000')
  })

  test('現在が0で前月がある → 0.0%', () => {
    assert.deepEqual(compareValues(0, 4), { diff: -4, ratio: 0 })
  })
})

describe('fetchAllPages（取得上限への対処）', () => {
  function makeFetch(total: number, opts: { countOverride?: (call: number) => number | null; fail?: number } = {}) {
    let call = 0
    return async (from: number, to: number): Promise<PageResult<number>> => {
      const n = call++
      if (opts.fail === n) return { data: null, count: null, error: new Error('x') }
      const data: number[] = []
      for (let i = from; i <= to && i < total; i++) data.push(i)
      const count = opts.countOverride ? opts.countOverride(n) : total
      return { data, count, error: null }
    }
  }

  test('1,000行を超えても全件を集める（2,500件 → 3ページ）', async () => {
    const res = await fetchAllPages(makeFetch(2500))
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.rows.length, 2500)
      assert.equal(res.rows[0], 0)
      assert.equal(res.rows[2499], 2499)
    }
  })

  test('ちょうど1,000件・0件・1件', async () => {
    for (const total of [0, 1, 999, 1000, 1001]) {
      const res = await fetchAllPages(makeFetch(total))
      assert.equal(res.ok, true, `total=${total}`)
      if (res.ok) assert.equal(res.rows.length, total)
    }
  })

  test('途中のページが error → 失敗（0件として扱わない）', async () => {
    const res = await fetchAllPages(makeFetch(2500, { fail: 1 }))
    assert.equal(res.ok, false)
  })

  test('count が取れない（null）→ 失敗', async () => {
    const res = await fetchAllPages(makeFetch(10, { countOverride: () => null }))
    assert.equal(res.ok, false)
  })

  test('ページ間で count が変わった → 失敗', async () => {
    const res = await fetchAllPages(makeFetch(2500, { countOverride: (n) => (n === 0 ? 2500 : 2400) }))
    assert.equal(res.ok, false)
  })

  test('集めた件数が count と一致しない（欠落）→ 失敗', async () => {
    const short = async (): Promise<PageResult<number>> => ({ data: [1, 2, 3], count: 10, error: null })
    const res = await fetchAllPages(short)
    assert.equal(res.ok, false)
  })

  test('ページ数の上限を超える場合は失敗', async () => {
    const res = await fetchAllPages(makeFetch(5000), 1000, 2)
    assert.equal(res.ok, false)
  })

  test('data が配列でない → 失敗', async () => {
    const res = await fetchAllPages(async () => ({ data: null, count: 0, error: null }))
    assert.equal(res.ok, false)
  })
})

describe('選択日の案件一覧', () => {
  test('calcTotalPages', () => {
    assert.equal(calcTotalPages(0), 0)
    assert.equal(calcTotalPages(1), 1)
    assert.equal(calcTotalPages(20), 1)
    assert.equal(calcTotalPages(21), 2)
  })

  test('pickMasterName: オブジェクト・配列・null', () => {
    assert.equal(pickMasterName({ name: '撮影' }), '撮影')
    assert.equal(pickMasterName([{ name: '撮影' }]), '撮影')
    assert.equal(pickMasterName(null), null)
    assert.equal(pickMasterName([]), null)
    assert.equal(pickMasterName({ id: 1 }), null)
  })

  test('formatSubcategoryLabel: 「その他」は自由入力を併記する', () => {
    assert.equal(formatSubcategoryLabel('その他', 'ドラマ撮影'), 'その他（ドラマ撮影）')
    assert.equal(formatSubcategoryLabel('その他', '  '), 'その他')
    assert.equal(formatSubcategoryLabel('その他', null), 'その他')
    assert.equal(formatSubcategoryLabel('雑誌', 'メモ'), '雑誌')
    assert.equal(formatSubcategoryLabel(null, 'メモ'), null)
  })

  test('mapDailyCaseRow: 表示に必要な項目だけを返し、個人情報の項目は含めない', () => {
    const item = mapDailyCaseRow({
      id: UUID_A,
      company: '架空株式会社',
      event_name: '架空イベント',
      status: 'confirmed',
      auto_cancel: false,
      estimate_amount: 120000,
      event_subcategory_note: '架空の自由入力',
      event_category_master: { name: '撮影' },
      event_subcategory_master: { name: 'その他' },
      // 以下は返してはいけない項目（万一取得しても出力に含まれないこと）
      contact: '架空担当',
      phone: '000-0000-0000',
      email: 'dummy@example.invalid',
      notes: '架空の備考',
    })
    assert.deepEqual(item, {
      id: UUID_A,
      company: '架空株式会社',
      eventName: '架空イベント',
      status: 'confirmed',
      autoCancel: false,
      estimateAmount: 120000,
      categoryName: '撮影',
      subcategoryLabel: 'その他（架空の自由入力）',
    })
    const json = JSON.stringify(item)
    assert.doesNotMatch(json, /架空担当|000-0000|example\.invalid|架空の備考/)
  })

  test('mapDailyCaseRow: 不正な行は null、欠損はnull・0', () => {
    assert.equal(mapDailyCaseRow(null), null)
    assert.equal(mapDailyCaseRow({ status: 'inquiry' }), null)
    assert.deepEqual(mapDailyCaseRow({ id: UUID_A, status: 'inquiry' }), {
      id: UUID_A,
      company: null,
      eventName: null,
      status: 'inquiry',
      autoCancel: false,
      estimateAmount: 0,
      categoryName: null,
      subcategoryLabel: null,
    })
  })
})

describe('APIレスポンスの検証（画面側）', () => {
  const days = [
    { date: '2026-10-03', count: 2, estimateTotal: 300000, confirmedTotal: 300000 },
    { date: '2026-10-08', count: 1, estimateTotal: 100000, confirmedTotal: 0 },
  ]
  const valid = {
    kind: 'media',
    target: UUID_A,
    month: '2026-10',
    previousMonth: '2026-09',
    previousYearMonth: '2025-10',
    current: { count: 3, estimateTotal: 400000, confirmedTotal: 300000, inquiryDays: 2, days },
    previous: { count: 0, estimateTotal: 0, confirmedTotal: 0 },
    previousYear: { count: 1, estimateTotal: 1, confirmedTotal: 0 },
  }

  test('正常なレスポンスを受け付ける', () => {
    assert.equal(isValidDailySummaryResponse(valid), true)
  })

  test('日別の合計が月合計と一致しない場合は不正', () => {
    assert.equal(isValidDailySummaryResponse({ ...valid, current: { ...valid.current, count: 4 } }), false)
    assert.equal(
      isValidDailySummaryResponse({ ...valid, current: { ...valid.current, estimateTotal: 1 } }),
      false
    )
    assert.equal(
      isValidDailySummaryResponse({ ...valid, current: { ...valid.current, inquiryDays: 5 } }),
      false
    )
  })

  test('構造が壊れている・対象月外の日付・負の値は不正', () => {
    assert.equal(isValidDailySummaryResponse(null), false)
    assert.equal(isValidDailySummaryResponse({}), false)
    assert.equal(isValidDailySummaryResponse({ ...valid, previous: null }), false)
    assert.equal(
      isValidDailySummaryResponse({
        ...valid,
        current: { ...valid.current, days: [{ date: '2026-11-01', count: 3, estimateTotal: 400000, confirmedTotal: 300000 }], inquiryDays: 1 },
      }),
      false
    )
    assert.equal(isValidDailySummaryResponse({ ...valid, previousYear: { count: -1, estimateTotal: 0, confirmedTotal: 0 } }), false)
  })

  test('isValidDailyCasesResponse', () => {
    const ok = {
      date: '2026-10-08',
      page: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
      cases: [{ id: UUID_A, status: 'inquiry', estimateAmount: 0 }],
    }
    assert.equal(isValidDailyCasesResponse(ok), true)
    assert.equal(isValidDailyCasesResponse({ ...ok, cases: [{ id: 1, status: 'inquiry', estimateAmount: 0 }] }), false)
    assert.equal(isValidDailyCasesResponse({ ...ok, date: 'x' }), false)
    assert.equal(isValidDailyCasesResponse({ ...ok, pageSize: 0 }), false)
    assert.equal(isValidDailyCasesResponse(null), false)
  })
})
