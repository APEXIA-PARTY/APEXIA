import { createClient } from '@/lib/supabase/server'
import { STATUS_LIST } from '@/lib/constants/status'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { cn } from '@/lib/utils/cn'
import {
  calcEventMonthRange,
  formatEventMonthYoYPercent,
  formatEventMonthYoYDiff,
  buildEventMonthSummary,
} from '@/lib/utils/eventDateSummary'

interface EventMonthSummaryProps {
  supabase: Awaited<ReturnType<typeof createClient>>
  year: string
  month: string
}

/**
 * 案件一覧の「開催月別サマリー」。
 * 開催年・開催月が両方指定されているときだけ表示される（呼び出し側で判定）。
 * ステータス・認知経路・フロア・検索フィルタには一切連動しない
 * （常に「その開催月全体」を集計する）。
 * inquiry_date 基準の既存分析（lib/utils/analytics.ts）とは独立した、
 * event_date 基準の集計のみを行う。
 */
export async function EventMonthSummary({ supabase, year, month }: EventMonthSummaryProps) {
  const current = calcEventMonthRange(year, month)
  const previous = calcEventMonthRange(String(Number(year) - 1), month)

  // クエリは2本のみ：
  // ①当月分は status 列 + exact count を同時に取得する（合計は rows.length ではなく count を使う）
  // ②前年同月分は件数のみ（head: true）で取得し、本文データは取得しない
  const [currentRes, previousRes] = await Promise.all([
    supabase
      .from('cases')
      .select('status', { count: 'exact' })
      .gte('event_date', current.gte)
      .lte('event_date', current.lte),
    supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .gte('event_date', previous.gte)
      .lte('event_date', previous.lte),
  ])

  // エラー・count欠落・行数不一致・内訳不一致のいずれかがあれば null になる。
  // 0件として誤表示しないよう、その場合は集計を一切表示しない。
  const summary = buildEventMonthSummary(
    { data: currentRes.data, count: currentRes.count, error: currentRes.error },
    previousRes.count,
    previousRes.error
  )

  if (!summary) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">開催サマリーを取得できませんでした</p>
      </div>
    )
  }

  const { currentTotal, previousTotal, breakdown } = summary

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-3 text-sm font-semibold text-foreground">
        {year}年{Number(month)}月 開催サマリー
      </p>

      {/* KPI: PC=横4列 / スマホ=2列×2段 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="開催希望案件" value={`${currentTotal}件`} />
        <KpiCard label="前年同月" value={`${previousTotal}件`} />
        <KpiCard label="前年比" value={formatEventMonthYoYPercent(currentTotal, previousTotal)} />
        <KpiCard label="前年差" value={formatEventMonthYoYDiff(currentTotal, previousTotal)} />
      </div>

      {/* ステータス内訳: 7種すべてを常に表示（0件も表示） */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        {STATUS_LIST.map((s) => (
          <span
            key={s.value}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
              s.bgColor,
              s.color
            )}
          >
            {s.label} {breakdown[s.value]}件
          </span>
        ))}
      </div>
    </div>
  )
}
