import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcMediaMonthly, CaseRow } from '@/lib/utils/analytics'

/**
 * GET /api/analytics/media-monthly?year=2026
 * 認知経路（媒体）×月別の問合せ・下見・確定件数集計（イベント日方式）
 * ・問合せ：inquiry_date の月
 * ・下見　：preview_datetime の月
 * ・確定　：confirmed_at の月（かつ現ステータスが confirmed/done であること）
 * ・読み取り専用（SELECTのみ）
 * ・year は必須
 * ・過去に無効化された媒体も含む（is_active フィルタなし。履歴の欠落を防ぐため）
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')

  if (!year) {
    return NextResponse.json({ message: 'year は必須です' }, { status: 400 })
  }

  // マスタは is_active を問わず全件取得（過去データの欠落を防ぐため）
  const [{ data: masters, error: mastersError }, { data: cases, error: casesError }] = await Promise.all([
    supabase.from('media_master').select('id,name').order('display_order'),
    supabase
      .from('cases')
      .select('id,status,auto_cancel,preview_datetime,estimate_amount,inquiry_date,event_date,media_id,contact_method_id,floor_id,event_category_id,event_subcategory_id,cancel_reason_id,cancel_note,company,confirmed_at'),
  ])

  if (mastersError || casesError || !masters || !cases) {
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  const rows = calcMediaMonthly(cases as CaseRow[], masters, year)

  return NextResponse.json({ year, rows })
}
