import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import {
  DAILY_UNASSIGNED_TARGET,
  aggregateByDay,
  calcMonthRange,
  fetchAllPages,
  parseSummaryRequest,
  shiftMonth,
  totalsFromDays,
  type DailyInquiryKind,
  type DailyRow,
  type DaySummary,
  type MonthTotals,
} from '@/lib/utils/dailyInquiry'

/**
 * GET /api/analytics/daily-inquiries?kind=category|media&target=<マスタID|__none__>&month=YYYY-MM
 *
 * 日別問合せ（計上日 = inquiry_date）の月間サマリー・日別集計・前月・前年同月。読み取り専用（SELECTのみ）。
 * ・月と、イベント大分類または認知経路で、DB側の条件で絞り込む
 * ・取得は1,000行ずつ、決まった並び順で全件を集め、件数が一致しなければ失敗にする
 *   （取得上限による欠落を0件として返さない）
 * ・1つでも取得に失敗した場合は、部分的な数字を返さず 500 を返す
 * ・返すのは集計値のみ。会社名などの案件情報は含めない
 */

const TARGET_COLUMN: Record<DailyInquiryKind, string> = {
  category: 'event_category_id',
  media: 'media_id',
}

export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const parsed = parseSummaryRequest(new URL(request.url).searchParams)
  if (!parsed) {
    return NextResponse.json({ message: '指定が不正です' }, { status: 400 })
  }
  const { kind, target, month } = parsed

  const supabase = await createClient()
  const column = TARGET_COLUMN[kind]

  const fetchMonth = (targetMonth: string) => {
    const { gte, lte } = calcMonthRange(targetMonth)
    return fetchAllPages<DailyRow>(async (from, to) => {
      let query = supabase
        .from('cases')
        .select('inquiry_date,status,estimate_amount', { count: 'exact' })
        .gte('inquiry_date', gte)
        .lte('inquiry_date', lte)
      query = target === DAILY_UNASSIGNED_TARGET ? query.is(column, null) : query.eq(column, target)
      const { data, count, error } = await query
        .order('inquiry_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
      return { data: (data as DailyRow[] | null) ?? null, count, error }
    })
  }

  const previousMonth = shiftMonth(month, -1)
  const previousYearMonth = shiftMonth(month, -12)

  const [current, previous, previousYear] = await Promise.all([
    fetchMonth(month),
    fetchMonth(previousMonth),
    fetchMonth(previousYearMonth),
  ])

  if (!current.ok || !previous.ok || !previousYear.ok) {
    console.error('[daily-inquiries] 集計データの取得に失敗しました')
    return NextResponse.json({ message: '集計データの取得に失敗しました' }, { status: 500 })
  }

  const days: DaySummary[] = aggregateByDay(current.rows)
  const currentTotals: MonthTotals = totalsFromDays(days)
  const previousTotals: MonthTotals = totalsFromDays(aggregateByDay(previous.rows))
  const previousYearTotals: MonthTotals = totalsFromDays(aggregateByDay(previousYear.rows))

  return NextResponse.json({
    kind,
    target,
    month,
    previousMonth,
    previousYearMonth,
    current: { ...currentTotals, inquiryDays: days.length, days },
    previous: previousTotals,
    previousYear: previousYearTotals,
  })
}
