import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import {
  calcKpi, filterByYear, filterByMonth, CaseRow,
  calcPercent, calcAvgPrice, safeDivide, REVENUE_STATUSES,
} from '@/lib/utils/analytics'

/**
 * GET /api/analytics/media?year=2025&month=2025-03
 * 認知経路別集計
 * マスタ追加時に自動反映: media_master を先に取得してから cases とマッチング
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year  = searchParams.get('year')
  const month = searchParams.get('month')

  // マスタ全件取得（is_active=true のみ）
  const [{ data: masters }, { data: cases }] = await Promise.all([
    supabase.from('media_master').select('id,name,monthly_cost').eq('is_active', true).order('display_order'),
    supabase.from('cases').select('id,status,auto_cancel,estimate_amount,inquiry_date,company,media_id,cancel_reason_id,cancel_note'),
  ])

  if (!masters || !cases) {
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  let rows = cases as CaseRow[]
  if (month)      rows = filterByMonth(rows, month)
  else if (year)  rows = filterByYear(rows, year)

  const totalInquiry   = rows.length
  const totalPreview   = rows.filter(c => ['previewed','tentative','confirmed','done'].includes(c.status)).length
  const totalConfirmed = rows.filter(c => REVENUE_STATUSES.includes(c.status)).length

  // マスタごとに集計（マスタ追加で自動的に行が増える）
  const result = masters.map(m => {
    const mc        = rows.filter(c => c.media_id === m.id)
    const kpi       = calcKpi(mc)
    const monthlyCost = m.monthly_cost ?? 0
    const costPerConfirmed = kpi.confirmed > 0 && monthlyCost > 0
      ? Math.round(safeDivide(monthlyCost, kpi.confirmed))
      : null

    return {
      id:            m.id,
      name:          m.name,
      monthly_cost:  monthlyCost,
      ...kpi,
      inquiryShare:  calcPercent(kpi.inquiry,   totalInquiry),
      previewShare:  calcPercent(kpi.preview,   totalPreview),
      confirmShare:  calcPercent(kpi.confirmed, totalConfirmed),
      costPerConfirmed,
    }
  })

  // media_id が NULL (マスタ未設定) の案件も集計
  const noMedia = rows.filter(c => !c.media_id)
  if (noMedia.length > 0) {
    const kpi = calcKpi(noMedia)
    result.push({
      id: '__none__', name: '（未設定）', monthly_cost: 0,
      ...kpi,
      inquiryShare:  calcPercent(kpi.inquiry,   totalInquiry),
      previewShare:  calcPercent(kpi.preview,   totalPreview),
      confirmShare:  calcPercent(kpi.confirmed, totalConfirmed),
      costPerConfirmed: null,
    })
  }

  return NextResponse.json({
    period: month ?? year ?? 'all',
    total: calcKpi(rows),
    rows: result.sort((a, b) => b.inquiry - a.inquiry),
  })
}
