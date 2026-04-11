import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcKpi, filterByYear, filterByMonth, CaseRow, calcPercent, REVENUE_STATUSES } from '@/lib/utils/analytics'

/**
 * GET /api/analytics/event-categories?year=2025
 * イベント分類別集計（大分類 / 中分類）
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const month = searchParams.get('month')

  const [{ data: categories }, { data: subcategories }, { data: cases }] = await Promise.all([
    supabase.from('event_category_master').select('id,name').eq('is_active', true).order('display_order'),
    supabase.from('event_subcategory_master').select('id,name,category_id').eq('is_active', true).order('display_order'),
    supabase.from('cases').select('id,status,auto_cancel,estimate_amount,inquiry_date,company,event_category_id,event_subcategory_id,event_subcategory_note,cancel_reason_id'),
  ])

  if (!cases) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })

  let rows = cases as (CaseRow & { event_subcategory_note?: string | null })[]
  if (month) rows = filterByMonth(rows, month) as any
  else if (year) rows = filterByYear(rows, year) as any

  const totalInquiry = rows.length
  const totalConfirmed = rows.filter(c => REVENUE_STATUSES.includes(c.status)).length

  // 大分類ごと集計
  const categoryRows = (categories ?? []).map(cat => {
    const mc = rows.filter(c => c.event_category_id === cat.id)
    const kpi = calcKpi(mc)

    // 中分類ごと集計
    const subRows = (subcategories ?? [])
      .filter(s => s.category_id === cat.id)
      .map(sub => {
        const sc = mc.filter(c => c.event_subcategory_id === sub.id)
        const sk = calcKpi(sc)
        // 「その他」中分類の場合は自由入力一覧も返す
        const otherNotes =
          sub.name === 'その他'
            ? Array.from(
              new Set(
                sc
                  .map((c) => c.event_subcategory_note)
                  .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
              )
            )
            : []
        return {
          id: sub.id, name: sub.name, category_id: cat.id,
          ...sk,
          inquiryShare: calcPercent(sk.inquiry, totalInquiry),
          confirmShare: calcPercent(sk.confirmed, totalConfirmed),
          otherNotes,
        }
      })

    return {
      id: cat.id, name: cat.name,
      ...kpi,
      inquiryShare: calcPercent(kpi.inquiry, totalInquiry),
      confirmShare: calcPercent(kpi.confirmed, totalConfirmed),
      subcategories: subRows,
    }
  })

  // 未設定
  const noCategory = rows.filter(c => !c.event_category_id)
  if (noCategory.length > 0) {
    const kpi = calcKpi(noCategory)
    categoryRows.push({
      id: '__none__', name: '（未設定）',
      ...kpi,
      inquiryShare: calcPercent(kpi.inquiry, totalInquiry),
      confirmShare: calcPercent(kpi.confirmed, totalConfirmed),
      subcategories: [],
    })
  }

  return NextResponse.json({
    period: month ?? year ?? 'all',
    total: calcKpi(rows),
    rows: categoryRows.sort((a, b) => b.inquiry - a.inquiry),
  })
}
