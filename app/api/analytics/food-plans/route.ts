/**
 * GET /api/analytics/food-plans
 * 飲食プラン利用件数・金額集計
 * - case_food_plans 中間テーブルを集計対象とする
 * - state = '不要' は除外
 * - マスタから削除済みでも case_food_plans.name は履歴として集計
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { REVENUE_STATUSES, type CaseRow } from '@/lib/utils/analytics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()

  const [{ data: foodPlans, error: foodPlansError }, { data: cases, error: casesError }] = await Promise.all([
    supabase
      .from('case_food_plans')
      .select('case_id, name, qty, unit_price, amount, state')
      .neq('state', '不要'),
    supabase
      .from('cases')
      .select('id, status')
      .in('status', REVENUE_STATUSES),
  ])

  if (foodPlansError || casesError) {
    console.error(foodPlansError ?? casesError)
    return NextResponse.json({ message: 'データ取得失敗' }, { status: 500 })
  }

  const eligibleCaseIds = new Set(
    ((cases ?? []) as Pick<CaseRow, 'id' | 'status'>[]).map((c) => c.id)
  )

  // name ごとに件数・金額合計を集計
  const aggMap: Record<string, { count: number; total_amount: number }> = {}
  for (const row of (foodPlans ?? [])) {
    if (!eligibleCaseIds.has(row.case_id)) continue
    const name = row.name
    if (!name) continue
    if (!aggMap[name]) aggMap[name] = { count: 0, total_amount: 0 }
    aggMap[name].count += 1
    // amount は GENERATED (qty * unit_price)。null の場合は手計算でフォールバック
    aggMap[name].total_amount += (row.amount ?? (row.qty ?? 1) * (row.unit_price ?? 0))
  }

  const result = Object.entries(aggMap)
    .map(([name, { count, total_amount }]) => ({ name, count, total_amount }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json(result)
}
