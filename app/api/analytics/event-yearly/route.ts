import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { calcEventMonthRange } from '@/lib/utils/eventDateSummary'
import { hasEventYearlyQueryProblem, type EventYearlyQueryResult } from '@/lib/utils/eventYearlyAnalysis'

/**
 * GET /api/analytics/event-yearly?year=2026
 *
 * 開催月分析（event_date 基準）専用の集計API。
 * 既存の inquiry_date 基準の analytics API（monthly / yearly 等）とは完全に独立しており、
 * それらのファイル・ロジックには一切触れない。
 *
 * 開催案件数の定義: 指定月に event_date が入っている全案件（ステータス問わず、
 * cancelled・done を含む）。event_date が NULL の案件は自然に除外される。
 *
 * 安全性のため、案件データ本体は一切取得しない。取得するのは
 * count: 'exact', head: true による「件数のみ」で、12ヶ月×当年/前年の
 * 合計24本のクエリを並列実行する。1本でも error または count===null/undefined
 * があれば、部分的な数字を返さず 500 を返す（0件として誤魔化さない）。
 */
export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year') ?? new Date().getFullYear().toString()
  const previousYear = String(Number(year) - 1)

  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))

  const queries = months.flatMap((month) => {
    const current = calcEventMonthRange(year, month)
    const previous = calcEventMonthRange(previousYear, month)
    return [
      supabase
        .from('cases')
        .select('id', { count: 'exact', head: true })
        .gte('event_date', current.gte)
        .lte('event_date', current.lte),
      supabase
        .from('cases')
        .select('id', { count: 'exact', head: true })
        .gte('event_date', previous.gte)
        .lte('event_date', previous.lte),
    ]
  })

  const results = await Promise.all(queries)

  const queryResults: EventYearlyQueryResult[] = results.map((r) => ({ count: r.count, error: r.error }))
  if (hasEventYearlyQueryProblem(queryResults)) {
    return NextResponse.json({ message: '集計データの取得に失敗しました' }, { status: 500 })
  }

  const monthsData = months.map((month, i) => ({
    month,
    current: results[i * 2].count as number,
    previous: results[i * 2 + 1].count as number,
  }))

  return NextResponse.json({ year, previousYear, months: monthsData })
}
