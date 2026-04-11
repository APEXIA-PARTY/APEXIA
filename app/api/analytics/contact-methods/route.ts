import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcKpi, filterByYear, filterByMonth, CaseRow, calcPercent, REVENUE_STATUSES } from '@/lib/utils/analytics'

export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year'); const month = searchParams.get('month')

  const [{ data: masters }, { data: cases }] = await Promise.all([
    supabase.from('contact_method_master').select('id,name').eq('is_active', true).order('display_order'),
    supabase.from('cases').select('id,status,auto_cancel,estimate_amount,inquiry_date,company,contact_method_id,cancel_reason_id'),
  ])

  if (!cases) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  let rows = cases as CaseRow[]
  if (month) rows = filterByMonth(rows, month); else if (year) rows = filterByYear(rows, year)

  const totalInquiry = rows.length; const totalPreview = rows.filter(c => ['previewed','tentative','confirmed','done'].includes(c.status)).length; const totalConfirmed = rows.filter(c => REVENUE_STATUSES.includes(c.status)).length

  const result = (masters ?? []).map(m => {
    const mc = rows.filter(c => c.contact_method_id === m.id); const kpi = calcKpi(mc)
    return { id: m.id, name: m.name, ...kpi, inquiryShare: calcPercent(kpi.inquiry, totalInquiry), previewShare: calcPercent(kpi.preview, totalPreview), confirmShare: calcPercent(kpi.confirmed, totalConfirmed) }
  })

  const none = rows.filter(c => !c.contact_method_id)
  if (none.length > 0) { const kpi = calcKpi(none); result.push({ id: '__none__', name: '（未設定）', ...kpi, inquiryShare: calcPercent(kpi.inquiry, totalInquiry), previewShare: calcPercent(kpi.preview, totalPreview), confirmShare: calcPercent(kpi.confirmed, totalConfirmed) }) }

  return NextResponse.json({ period: month ?? year ?? 'all', total: calcKpi(rows), rows: result.sort((a, b) => b.inquiry - a.inquiry) })
}
