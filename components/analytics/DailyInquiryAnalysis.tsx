'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { StatusBadge } from '@/components/cases/StatusBadge'
import { CaseDetailLink } from '@/components/cases/CaseDetailLink'
import { formatYenFull } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import { shouldActivateRowLink } from '@/lib/utils/rowLinkClick'
import type { CaseStatus } from '@/types/database'
import {
  DAILY_UNASSIGNED_TARGET,
  buildDailyUrl,
  compareValues,
  formatAmountDiff,
  formatCountDiff,
  formatDayLabel,
  formatRatio,
  getJstTodayString,
  isDayInMonth,
  isMonthInProgress,
  isValidDailyCasesResponse,
  isValidDailySummaryResponse,
  parseDailyParams,
  type DailyCasesResponse,
  type DailyInquiryKind,
  type DailySummaryResponse,
  type MonthTotals,
} from '@/lib/utils/dailyInquiry'

interface MasterOption {
  id: string
  name: string
  is_active?: boolean
  display_order?: number
}

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1)

const KIND_TABS: { key: DailyInquiryKind; label: string }[] = [
  { key: 'category', label: 'イベント分類' },
  { key: 'media', label: '認知経路' },
]

const SELECT_CLASS = 'rounded-md border border-input bg-background px-3 py-1.5 text-sm'

function buildYearOptions(extra: string): string[] {
  const currentYear = Number(getJstTodayString().slice(0, 4))
  // 案件一覧の開催年フィルタと同じ範囲（現在年+2 〜 現在年-4、7年分）
  const years = Array.from({ length: 7 }, (_, i) => String(currentYear + 2 - i))
  if (extra && !years.includes(extra)) years.push(extra)
  return years.sort().reverse()
}

function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`
}

/** 金額0は「—」（未入力と0円は区別できないため） */
function yen(amount: number): string {
  return amount > 0 ? formatYenFull(amount) : '—'
}

function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn('whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground', right ? 'text-right' : 'text-left')}>
      {children}
    </th>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-destructive">{message}</p>
    </div>
  )
}

function Skeleton() {
  return <div className="h-32 animate-pulse rounded-lg bg-muted/40" />
}

interface ComparisonRowProps {
  label: string
  current: number
  previous: number
  previousYear: number
  isAmount: boolean
}

function ComparisonRow({ label, current, previous, previousYear, isAmount }: ComparisonRowProps) {
  const show = (v: number) => (isAmount ? yen(v) : `${v}件`)
  const diff = (d: number) => (isAmount ? `${formatAmountDiff(d)}${d === 0 ? '' : '円'}` : formatCountDiff(d))
  const m = compareValues(current, previous)
  const y = compareValues(current, previousYear)
  return (
    <tr className="hover:bg-muted/20">
      <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold">{label}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{show(current)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{show(previous)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{diff(m.diff)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{formatRatio(m.ratio)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{show(previousYear)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{diff(y.diff)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{formatRatio(y.ratio)}</td>
    </tr>
  )
}

/**
 * 分析「日別問合せ」タブ（計上日 = inquiry_date）。
 * イベント大分類または認知経路と対象月を選び、月間サマリー・前月/前年同月との比較・
 * 問い合わせがあった日の一覧・選択日の案件一覧を表示する。
 * 条件は URL（view / tab / kind / target / month / day / page）に保持し、不正な値は無視する。
 * 既存の分析タブ・APIには依存しない。
 */
export function DailyInquiryAnalysis() {
  const searchParams = useSearchParams()
  const [initial] = useState(() => parseDailyParams(searchParams))

  const [kind, setKind] = useState<DailyInquiryKind | ''>(initial.kind)
  const [target, setTarget] = useState(initial.target)
  const [yearSel, setYearSel] = useState(initial.month.slice(0, 4))
  const [monthSel, setMonthSel] = useState(initial.month.slice(5, 7))
  const [day, setDay] = useState(initial.day)
  const [page, setPage] = useState(initial.page)

  const month = yearSel && monthSel ? `${yearSel}-${monthSel}` : ''
  const ready = Boolean(kind && target && month)

  const [targets, setTargets] = useState<MasterOption[] | null>(null)
  const [targetsError, setTargetsError] = useState(false)
  const [summary, setSummary] = useState<DailySummaryResponse | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState(false)
  const [casesData, setCasesData] = useState<DailyCasesResponse | null>(null)
  const [casesLoading, setCasesLoading] = useState(false)
  const [casesError, setCasesError] = useState(false)

  // 条件をURLへ保持（履歴は増やさない）。詳細へ進む時点の現在URLがそのまま戻り先になる
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', buildDailyUrl({ kind, target, month, day, page }))
    } catch {
      // URLを更新できなくても画面の動作は続ける
    }
  }, [kind, target, month, day, page])

  // 対象マスタ（無効なマスタも含める。過去データの確認のため）
  useEffect(() => {
    if (!kind) {
      setTargets(null)
      setTargetsError(false)
      return
    }
    let cancelled = false
    setTargets(null)
    setTargetsError(false)
    const path = kind === 'category' ? '/api/master/event-categories?all=true' : '/api/master/media?all=true'
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return
        if (!Array.isArray(d)) throw new Error('invalid')
        const list: MasterOption[] = d
          .filter((m: unknown): m is MasterOption => {
            const x = m as MasterOption
            return Boolean(x) && typeof x.id === 'string' && typeof x.name === 'string'
          })
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        setTargets(list)
      })
      .catch(() => {
        if (!cancelled) setTargetsError(true)
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  // URLの対象が一覧に存在しない場合は無視する
  useEffect(() => {
    if (!targets || !target || target === DAILY_UNASSIGNED_TARGET) return
    if (!targets.some((t) => t.id === target)) {
      setTarget('')
      setDay('')
      setPage(1)
    }
  }, [targets, target])

  // 月間サマリー・日別・前月・前年同月
  useEffect(() => {
    if (!ready || !kind) {
      setSummary(null)
      setSummaryError(false)
      setSummaryLoading(false)
      return
    }
    let cancelled = false
    setSummary(null)
    setSummaryError(false)
    setSummaryLoading(true)
    const qs = new URLSearchParams({ kind, target, month })
    fetch(`/api/analytics/daily-inquiries?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return
        if (!isValidDailySummaryResponse(d) || d.kind !== kind || d.target !== target || d.month !== month) {
          setSummaryError(true)
        } else {
          setSummary(d)
        }
        setSummaryLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setSummaryError(true)
        setSummaryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ready, kind, target, month])

  // 選択日の案件一覧（ページ送り）
  useEffect(() => {
    if (!ready || !kind || !day) {
      setCasesData(null)
      setCasesError(false)
      setCasesLoading(false)
      return
    }
    let cancelled = false
    setCasesData(null)
    setCasesError(false)
    setCasesLoading(true)
    const qs = new URLSearchParams({ kind, target, date: day, page: String(page) })
    fetch(`/api/analytics/daily-inquiries/cases?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return
        if (!isValidDailyCasesResponse(d) || d.date !== day) {
          setCasesError(true)
        } else if (d.totalPages > 0 && page > d.totalPages) {
          setPage(d.totalPages)
          return
        } else {
          setCasesData(d)
        }
        setCasesLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setCasesError(true)
        setCasesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ready, kind, target, day, page])

  const changeKind = (k: DailyInquiryKind) => {
    if (k === kind) return
    setKind(k)
    setTarget('')
    setDay('')
    setPage(1)
  }

  const changeTarget = (t: string) => {
    setTarget(t)
    setDay('')
    setPage(1)
  }

  const applyMonth = (y: string, m: string) => {
    setYearSel(y)
    setMonthSel(m)
    const next = y && m ? `${y}-${m}` : ''
    if (!next || (day && !isDayInMonth(day, next))) setDay('')
    setPage(1)
  }

  const selectDay = (d: string) => {
    setDay(d === day ? '' : d)
    setPage(1)
  }

  // PC用案件表: 行のリンク外を通常クリックしたとき、その行の既存リンク（CaseDetailLink）を起動する。
  // 遷移・from/nav・記録・戻る機能は CaseDetailLink が唯一の入口。リンク自身のクリックや文字選択では何もしない。
  const handleCaseRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null
    const activate = shouldActivateRowLink({
      button: e.button,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      defaultPrevented: e.defaultPrevented,
      insideInteractive: !!(e.target as Element).closest('a, button, input, select, textarea'),
      hasTextSelection: !!selection && !selection.isCollapsed && selection.toString().trim() !== '',
    })
    if (!activate) return
    e.currentTarget.querySelector<HTMLAnchorElement>('a[href^="/cases/"]')?.click()
  }

  const yearOptions = buildYearOptions(yearSel)
  const inProgress = month ? isMonthInProgress(month) : false

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        ※問い合わせ日ごとの件数・金額です。件数はキャンセルを含む全ステータス、見込額はキャンセル以外、確定額は確定・開催終了の見積金額の合計です。金額が0円または未入力の場合は「—」と表示します。
      </p>

      {/* 絞り込み */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">分析種別</span>
          <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-1">
            {KIND_TABS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => changeKind(k.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  kind === k.key
                    ? 'bg-white shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{kind === 'media' ? '認知経路' : 'イベント大分類'}</span>
          <select
            className={cn(SELECT_CLASS, 'min-w-[180px] disabled:cursor-not-allowed disabled:opacity-50')}
            value={target}
            disabled={!kind || !targets}
            onChange={(e) => changeTarget(e.target.value)}
          >
            <option value="">{kind ? (targets ? '選択してください' : '読み込み中…') : '分析種別を選択'}</option>
            {targets && <option value={DAILY_UNASSIGNED_TARGET}>（未設定）</option>}
            {(targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_active === false ? '（無効）' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">対象年</span>
          <select className={SELECT_CLASS} value={yearSel} onChange={(e) => applyMonth(e.target.value, monthSel)}>
            <option value="">年を選択</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">対象月</span>
          <select className={SELECT_CLASS} value={monthSel} onChange={(e) => applyMonth(yearSel, e.target.value)}>
            <option value="">月を選択</option>
            {MONTH_NUMBERS.map((m) => (
              <option key={m} value={String(m).padStart(2, '0')}>
                {m}月
              </option>
            ))}
          </select>
        </div>
      </div>

      {targetsError && <ErrorBox message="対象の一覧を取得できませんでした" />}

      {!ready && !targetsError && (
        <p className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          分析種別・対象・年月を選ぶと、問い合わせがあった日を表示します。
        </p>
      )}

      {ready && summaryLoading && <Skeleton />}
      {ready && summaryError && <ErrorBox message="集計データを取得できませんでした" />}

      {ready && summary && (
        <>
          {inProgress && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ※{monthLabel(month)}は集計中です（現時点の登録状況）。前月・前年同月との比較は、月全体との比較です。
            </div>
          )}

          {/* 月間サマリー */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="問い合わせ件数" value={`${summary.current.count}件`} />
            <KpiCard label="問い合わせがあった日数" value={`${summary.current.inquiryDays}日`} />
            <KpiCard label="見込額" value={yen(summary.current.estimateTotal)} />
            <KpiCard label="確定額" value={yen(summary.current.confirmedTotal)} color="green" />
          </div>

          {/* 前月・前年同月との比較 */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <TH>項目</TH>
                    <TH right>{monthLabel(summary.month)}</TH>
                    <TH right>前月（{monthLabel(summary.previousMonth)}）</TH>
                    <TH right>前月差</TH>
                    <TH right>前月比</TH>
                    <TH right>前年同月（{monthLabel(summary.previousYearMonth)}）</TH>
                    <TH right>前年差</TH>
                    <TH right>前年比</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(
                    [
                      ['問い合わせ件数', 'count', false],
                      ['見込額', 'estimateTotal', true],
                      ['確定額', 'confirmedTotal', true],
                    ] as [string, keyof MonthTotals, boolean][]
                  ).map(([label, key, isAmount]) => (
                    <ComparisonRow
                      key={key}
                      label={label}
                      current={summary.current[key]}
                      previous={summary.previous[key]}
                      previousYear={summary.previousYear[key]}
                      isAmount={isAmount}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              比較対象が0件・0円の場合、比率は「—」と表示します。
            </p>
          </div>

          {/* 問い合わせがあった日 */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">問い合わせがあった日（{monthLabel(summary.month)}）</h3>
            {summary.current.days.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
                この月の問い合わせはありません。
              </p>
            ) : (
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <TH>日付（クリックで案件を表示）</TH>
                        <TH right>件数</TH>
                        <TH right>見込額</TH>
                        <TH right>確定額</TH>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {summary.current.days.map((d) => (
                        <tr
                          key={d.date}
                          onClick={() => selectDay(d.date)}
                          className={cn('cursor-pointer hover:bg-muted/30', d.date === day && 'bg-primary/5')}
                        >
                          <td className="whitespace-nowrap px-3 py-2.5 text-sm font-medium">
                            <button type="button" aria-pressed={d.date === day} className="text-left hover:underline">
                              {formatDayLabel(d.date)}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{d.count}件</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{yen(d.estimateTotal)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-green-700">
                            {yen(d.confirmedTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/40 font-semibold">
                        <td className="whitespace-nowrap px-3 py-2.5 text-sm">合計</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">{summary.current.count}件</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">
                          {yen(summary.current.estimateTotal)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-green-700">
                          {yen(summary.current.confirmedTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* 選択日の案件一覧 */}
          {day && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                {formatDayLabel(day)}の問い合わせ{casesData ? `（${casesData.totalCount}件）` : ''}
              </h3>
              {casesLoading && <Skeleton />}
              {casesError && <ErrorBox message="案件一覧を取得できませんでした" />}
              {casesData && casesData.cases.length === 0 && (
                <p className="rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
                  この日の案件はありません。
                </p>
              )}
              {casesData && casesData.cases.length > 0 && (
                <>
                  {/* スマホ幅（640px未満）: カード全体を1つの詳細リンクにする（表だと列が潰れてリンクが押しにくいため） */}
                  <div className="space-y-2 sm:hidden">
                    {casesData.cases.map((c) => (
                      <CaseDetailLink
                        key={c.id}
                        caseId={c.id}
                        from="analytics"
                        className="block min-h-[64px] rounded-lg border border-border bg-card p-4 active:opacity-70"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 break-words font-semibold leading-snug text-foreground">
                            {c.company ?? '—'}
                          </p>
                          <StatusBadge
                            status={c.status as CaseStatus}
                            autoCancel={c.autoCancel}
                            size="sm"
                            className="shrink-0 whitespace-nowrap"
                          />
                        </div>
                        <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{c.eventName || '—'}</p>
                        <div className="mt-1.5 flex items-start justify-between gap-2">
                          <p className="min-w-0 break-words text-xs text-muted-foreground">
                            {[c.categoryName, c.subcategoryLabel].filter(Boolean).join(' / ') || '—'}
                          </p>
                          <p className="shrink-0 text-xs font-medium tabular-nums">{yen(c.estimateAmount)}</p>
                        </div>
                      </CaseDetailLink>
                    ))}
                  </div>

                  {/* 640px以上: 従来の表（変更なし） */}
                  <div className="hidden sm:block rounded-lg border border-border bg-card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <TH>会社名</TH>
                            <TH>案件名</TH>
                            <TH>イベント分類</TH>
                            <TH>ステータス</TH>
                            <TH right>見積金額</TH>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {casesData.cases.map((c) => (
                            <tr key={c.id} onClick={handleCaseRowClick} className="cursor-pointer hover:bg-muted/20">
                              <td className="px-3 py-2.5 text-sm">
                                <CaseDetailLink
                                  caseId={c.id}
                                  from="analytics"
                                  className="font-medium text-foreground hover:text-primary hover:underline"
                                >
                                  {c.company ?? '—'}
                                </CaseDetailLink>
                              </td>
                              <td className="px-3 py-2.5 text-sm text-muted-foreground">{c.eventName || '—'}</td>
                              <td className="px-3 py-2.5 text-sm text-muted-foreground">
                                {[c.categoryName, c.subcategoryLabel].filter(Boolean).join(' / ') || '—'}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5">
                                <StatusBadge status={c.status as CaseStatus} autoCancel={c.autoCancel} size="sm" />
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums">
                                {yen(c.estimateAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {casesData.totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        前へ
                      </button>
                      <span className="text-sm text-muted-foreground">
                        {page} / {casesData.totalPages}
                      </span>
                      <button
                        type="button"
                        disabled={page >= casesData.totalPages}
                        onClick={() => setPage(page + 1)}
                        className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        次へ
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
