import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcKpi, filterByYear, calcYoY, CaseRow } from '@/lib/utils/analytics'

/**
 * GET /api/analytics/yearly
 * 年別集計（全期間）
 */
export async function GET(_req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { data: cases, error: dbError } = await supabase
    .from('cases')
    .select(
      'id,status,auto_cancel,estimate_amount,inquiry_date,event_date,company,media_id,contact_method_id,floor_id,event_category_id,event_subcategory_id,cancel_reason_id,cancel_note'
    )

  if (dbError) {
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  const rows: CaseRow[] = Array.isArray(cases) ? (cases as CaseRow[]) : []

  const years = Array.from(
    new Set(
      rows
        .map((r) => r.inquiry_date)
        .filter((v): v is string => typeof v === 'string' && v.length >= 4)
        .map((v) => v.slice(0, 4))
    )
  ).sort().reverse()

  const yearly = years.map((year, idx) => {
    const kpi = calcKpi(filterByYear(rows, year))
    const prevYear = years[idx + 1]
    const prevKpi = prevYear ? calcKpi(filterByYear(rows, prevYear)) : null

    return {
      year,
      ...kpi,
      yoyInquiry: prevKpi ? calcYoY(kpi.inquiry, prevKpi.inquiry) : null,
      yoyRevenue: prevKpi ? calcYoY(kpi.revenue, prevKpi.revenue) : null,
      yoyConfirmed: prevKpi ? calcYoY(kpi.confirmed, prevKpi.confirmed) : null,
    }
  })

  return NextResponse.json({ years, yearly })
}