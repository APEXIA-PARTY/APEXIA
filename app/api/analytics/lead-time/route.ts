import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { buildLeadTimeResponse } from '@/lib/utils/leadTime'

/**
 * GET /api/analytics/lead-time?year=2025
 *
 * 開催月別 平均問合せ先行期間
 * - event_date と inquiry_date が両方ある案件を対象
 * - event_date の月（開催月）でグループ化
 * - リード日数 = event_date - inquiry_date（日数）。負（問合せが開催後）は除外
 * - 平均リード月数 = 平均日数 ÷ 30（小数1桁）
 * - 追加: medianDays / medianMonths（中央値）、isPartial（開催年月が現在（日本時間）の年月以上＝集計途中）
 * 集計ロジックは lib/utils/leadTime.ts（純粋関数。既存の対象・平均の計算は変更していない）
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

  return NextResponse.json(buildLeadTimeResponse(cases, year))
}
