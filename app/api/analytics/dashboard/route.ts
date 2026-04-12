import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcKpi, filterByMonth, filterByYear, CaseRow, REVENUE_STATUSES } from '@/lib/utils/analytics'
import { format } from 'date-fns'

export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const now = new Date()
  const thisMonth = format(now, 'yyyy-MM')
  const thisYear = format(now, 'yyyy')
  const today = format(now, 'yyyy-MM-dd')

  const { data: allCases } = await supabase
    .from('cases')
    .select('id,status,auto_cancel,has_previewed,estimate_amount,inquiry_date,event_date,company,event_name,media_id,event_category_id,event_subcategory_id,contact_method_id,floor_id,updated_at,cancel_reason_id,cancel_note')

  const rows: CaseRow[] = Array.isArray(allCases) ? (allCases as CaseRow[]) : []
  const monthRows = filterByMonth(rows, thisMonth)
  const yearRows = filterByYear(rows, thisYear)
  const mkpi = calcKpi(monthRows)
  const ykpi = calcKpi(yearRows)

  const monthlyTrend = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    const key = `${thisYear}-${m}`
    const mc = filterByMonth(rows, key)
    const kpi = calcKpi(mc)
    return { month: key, label: `${i + 1}月`, inquiry: kpi.inquiry, confirmed: kpi.confirmed, revenue: kpi.revenue }
  })

  const { data: mediaList } = await supabase.from('media_master').select('id,name').eq('is_active', true)
  const mediaRevenue = (mediaList ?? []).map(m => ({
    id: m.id, name: m.name,
    revenue: rows.filter(c => c.media_id === m.id && REVENUE_STATUSES.includes(c.status)).reduce((s, c) => s + (c.estimate_amount ?? 0), 0),
  })).sort((a, b) => b.revenue - a.revenue).slice(0, 3)

  const { data: categoryList } = await supabase.from('event_category_master').select('id,name').eq('is_active', true)
  const categoryRevenue = (categoryList ?? []).map(c => ({
    id: c.id, name: c.name,
    revenue: rows.filter(r => r.event_category_id === c.id && REVENUE_STATUSES.includes(r.status)).reduce((s, r) => s + (r.estimate_amount ?? 0), 0),
  })).sort((a, b) => b.revenue - a.revenue).slice(0, 3)

  const { data: upcomingCases } = await supabase
    .from('cases').select('id,company,event_name,event_date,start_time,status')
    .in('status', ['confirmed', 'tentative']).gte('event_date', today)
    .order('event_date', { ascending: true }).limit(5)

  const { data: recentCases } = await supabase
    .from('cases').select('id,company,event_name,event_date,status,auto_cancel,estimate_amount,updated_at')
    .order('updated_at', { ascending: false }).limit(8)

  return NextResponse.json({
    kpi: {
      thisMonth: { ...mkpi, autoCancelTotal: rows.filter(c => c.status === 'cancelled' && c.auto_cancel).length },
      thisYear: ykpi,
    },
    monthlyTrend,
    rankings: { mediaRevenue, categoryRevenue },
    upcomingCases: upcomingCases ?? [],
    recentCases: recentCases ?? [],
  })
}
