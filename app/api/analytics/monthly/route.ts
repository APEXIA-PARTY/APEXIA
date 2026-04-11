import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcKpi, filterByMonth, CaseRow } from '@/lib/utils/analytics'

/**
 * GET /api/analytics/monthly?year=2025
 * 月別集計（12ヶ月分）
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year') ?? new Date().getFullYear().toString()

  // 対象年の案件を取得
  const { data: cases, error: dbError } = await supabase
    .from('cases')
    .select('id,status,auto_cancel,estimate_amount,inquiry_date,event_date,company,media_id,contact_method_id,floor_id,event_category_id,event_subcategory_id,cancel_reason_id,cancel_note')
    .gte('inquiry_date', `${year}-01-01`)
    .lte('inquiry_date', `${year}-12-31`)

  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })

  const rows = (cases ?? []) as CaseRow[]

  // 12ヶ月分の集計
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, '0')
    const key   = `${year}-${month}`
    const mc    = filterByMonth(rows, key)
    return { month: key, label: `${i + 1}月`, ...calcKpi(mc) }
  })

  // 年合計
  const total = { month: `${year}-total`, label: '合計', ...calcKpi(rows) }

  return NextResponse.json({ year, monthly, total })
}
