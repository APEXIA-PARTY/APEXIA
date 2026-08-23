'use client'

import { useState, useEffect } from 'react'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { DualLineChart } from './DualLineChart'
import {
  formatEventMonthYoYPercent,
  formatEventMonthYoYDiff,
} from '@/lib/utils/eventDateSummary'
import {
  calcEventYearlyTotals,
  classifyEventMonthTiming,
  isValidEventYearlyMonths,
  type EventYearlyMonthCount,
} from '@/lib/utils/eventYearlyAnalysis'

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`)

function buildYearOptions(): string[] {
  const currentYear = new Date().getFullYear()
  // 案件一覧の開催年フィルタと同じ範囲（現在年+2 〜 現在年-4、7年分）
  return Array.from({ length: 7 }, (_, i) => String(currentYear + 2 - i))
}

/**
 * 「開催月分析」（event_date 基準、年間）の表示コンポーネント。
 * 既存の inquiry_date 基準タブ（MonthlyTab 等）とは完全に分離しており、
 * それらのコンポーネント・APIには一切依存しない。
 */
export function EventYearlyAnalysis() {
  const [year, setYear] = useState(() => String(new Date().getFullYear()))
  const [months, setMonths] = useState<EventYearlyMonthCount[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const yearOptions = buildYearOptions()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setHasError(false)
    setMonths(null)

    fetch(`/api/analytics/event-yearly?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return
        if (!isValidEventYearlyMonths(d?.months)) {
          setHasError(true)
        } else {
          setMonths(d.months)
        }
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setHasError(true)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [year])

  const currentYearNum = new Date().getFullYear()
  const showTimingNote = Number(year) >= currentYearNum
  const previousYear = String(Number(year) - 1)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">対象年:</span>
        <select
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        ※ステータスを問わず、開催日が登録された全案件を含みます（キャンセル・開催終了を含む）。
      </p>

      {showTimingNote && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ※{year}年は現時点の登録状況です。今後の開催案件追加により数値は変動します。
        </div>
      )}

      {loading && <div className="h-40 animate-pulse rounded-lg bg-muted/40" />}

      {!loading && hasError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">開催月分析を取得できませんでした</p>
        </div>
      )}

      {!loading && !hasError && months && (() => {
        const { currentTotal, previousTotal } = calcEventYearlyTotals(months)
        const maxY = Math.max(...months.map((m) => Math.max(m.current, m.previous)), 1)
        const chartData = months.map((m, i) => ({
          label: MONTH_LABELS[i],
          current: m.current,
          previous: m.previous,
        }))

        // 未来年選択時のみ「開催予定案件数」に表示ラベルを変える（集計値・ロジックは変更しない）
        const kpiLabel = Number(year) > currentYearNum ? '開催予定案件数' : '開催案件数'

        return (
          <>
            {/* KPI: PC=横4列 / スマホ=2列×2段 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label={kpiLabel} value={`${currentTotal}件`} />
              <KpiCard label="前年開催案件数" value={`${previousTotal}件`} />
              <KpiCard label="前年比" value={formatEventMonthYoYPercent(currentTotal, previousTotal)} />
              <KpiCard label="前年差" value={formatEventMonthYoYDiff(currentTotal, previousTotal)} />
            </div>

            {/* 月別推移グラフ（2系列折れ線） */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">開催案件数 月別推移</span>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded bg-blue-200" />{previousYear}年
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-3 rounded bg-primary" />{year}年
                  </span>
                </div>
              </div>
              <DualLineChart data={chartData} maxY={maxY} />
            </div>

            {/* 月別比較一覧 */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">月</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">{year}年</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">{previousYear}年</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">前年差</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">前年比</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {months.map((m, i) => {
                      const timing = classifyEventMonthTiming(year, m.month)
                      const isPending = timing !== 'past'
                      return (
                        <tr key={m.month} className="hover:bg-muted/20">
                          <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold">{MONTH_LABELS[i]}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">
                            {m.current}件
                            {isPending && (
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                                集計中
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{m.previous}件</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">
                            {formatEventMonthYoYDiff(m.current, m.previous)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">
                            {formatEventMonthYoYPercent(m.current, m.previous)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
