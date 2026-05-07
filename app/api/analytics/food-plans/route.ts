/**
 * GET /api/analytics/food-plans
 * 飲食プラン利用件数集計
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'

export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()

  const { data, error: dbError } = await supabase
    .from('cases')
    .select('food_plans')
    .not('food_plans', 'eq', '{}')

  if (dbError) {
    console.error(dbError)
    return NextResponse.json({ message: 'データ取得失敗' }, { status: 500 })
  }

  const countMap: Record<string, number> = {}
  for (const row of (data ?? [])) {
    const plans: string[] = Array.isArray(row.food_plans) ? row.food_plans : []
    for (const plan of plans) {
      if (plan) countMap[plan] = (countMap[plan] ?? 0) + 1
    }
  }

  const result = Object.entries(countMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json(result)
}
