import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'

/**
 * GET /api/analytics/lead-time?year=2025
 *
 * 開催月別 平均問合せ先行期間
 * - event_date と inquiry_date が両方ある案件を対象
 * - event_date の月（開催月）でグループ化
 * - リード日数 = event_date - inquiry_date（日数）
 * - 平均リード月数 = 平均日数 ÷ 30（小数1桁）
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')

  // event_date・inquiry_date が両方ある案件のみ取得
  let query = supabase
    .from('cases')
    .select('id, inquiry_date, event_date')
    .not('inquiry_date', 'is', null)
    .not('event_date',   'is', null)

  // year 指定がある場合は event_date（開催日）の年で絞る
  if (year) {
    query = query
      .gte('event_date', `${year}-01-01`)
      .lte('event_date', `${year}-12-31`)
  }

  const { data: cases, error: dbError } = await query

  if (dbError || !cases) {
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  // 開催月ごとにリード日数を集計
  const byMonth: Record<number, number[]> = {}
  for (let m = 1; m <= 12; m++) byMonth[m] = []

  for (const c of cases) {
    const eventDate   = new Date(c.event_date as string)
    const inquiryDate = new Date(c.inquiry_date as string)
    const leadDays    = Math.round(
      (eventDate.getTime() - inquiryDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    // リード日数が負（問合せが開催後）は除外
    if (leadDays < 0) continue
    const month = eventDate.getMonth() + 1  // 1-12
    byMonth[month].push(leadDays)
  }

  const rows = Object.entries(byMonth).map(([m, days]) => {
    const month   = Number(m)
    const count   = days.length
    const avgDays = count > 0 ? Math.round(days.reduce((s, d) => s + d, 0) / count) : 0
    const avgMonths = count > 0
      ? Math.round((avgDays / 30) * 10) / 10   // 小数1桁
      : 0
    return { month, label: `${month}月`, count, avgDays, avgMonths }
  })

  // 年間集計（件数0の月は除外して平均を計算）
  const allDays        = Object.values(byMonth).flat()
  const totalCount     = allDays.length
  const totalAvgDays   = totalCount > 0
    ? Math.round(allDays.reduce((s, d) => s + d, 0) / totalCount)
    : 0
  const totalAvgMonths = totalCount > 0
    ? Math.round((totalAvgDays / 30) * 10) / 10
    : 0

  return NextResponse.json({
    year: year ?? 'all',
    rows,   // 1月〜12月の全行（件数0の月も含む）
    total: {
      count:     totalCount,
      avgDays:   totalAvgDays,
      avgMonths: totalAvgMonths,
    },
  })
}