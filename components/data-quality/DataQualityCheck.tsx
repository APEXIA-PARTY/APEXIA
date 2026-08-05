'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { QualityCheck, QualityCheckResult, Priority } from '@/app/api/cases/quality-check/route'

// ─── ステータス表示 ─────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  inquiry:     '新規問合せ',
  preview_adj: '下見調整中',
  previewed:   '下見済み',
  tentative:   '仮押さえ',
  confirmed:   '確定',
  cancelled:   'キャンセル',
  done:        '終了',
}

const STATUS_COLOR: Record<string, string> = {
  inquiry:     'bg-blue-100 text-blue-700',
  preview_adj: 'bg-purple-100 text-purple-700',
  previewed:   'bg-indigo-100 text-indigo-700',
  tentative:   'bg-yellow-100 text-yellow-700',
  confirmed:   'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
  done:        'bg-gray-100 text-gray-600',
}

// ─── 優先度設定 ────────────────────────────────────────────────
const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string; border: string; Icon: React.ElementType }> = {
  high:   { label: '高', color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',   Icon: AlertTriangle },
  medium: { label: '中', color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200', Icon: AlertCircle },
  low:    { label: '低', color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200',  Icon: Info },
}

// ─── 日付フォーマット ──────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '―'
  const [y, m, d] = dateStr.split('-')
  return `${y}/${m}/${d}`
}

// ─── 案件テーブル ──────────────────────────────────────────────
function CaseTable({ cases }: { cases: QualityCheck['cases'] }) {
  if (cases.length === 0) return null
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">会社名</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">イベント名</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">開催日</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">ステータス</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground"></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => (
            <tr
              key={c.id}
              className={cn('border-b border-border last:border-0', i % 2 === 0 ? 'bg-card' : 'bg-muted/20')}
            >
              <td className="px-3 py-2 font-medium">{c.company}</td>
              <td className="px-3 py-2 text-muted-foreground">{c.event_name || '―'}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatDate(c.event_date)}</td>
              <td className="px-3 py-2">
                <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-600')}>
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <Link
                  href={`/cases/${c.id}`}
                  className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline"
                >
                  詳細
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── チェック行 ────────────────────────────────────────────────
function CheckRow({ check }: { check: QualityCheck }) {
  const [open, setOpen] = useState(false)
  const cfg = PRIORITY_CONFIG[check.priority]
  const Icon = cfg.Icon

  return (
    <div className={cn('rounded-lg border', cfg.border, cfg.bg)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Icon className={cn('h-4 w-4 shrink-0', cfg.color)} />
        <span className="flex-1 text-sm font-medium text-foreground">{check.label}</span>
        <span className="text-xs text-muted-foreground">{check.description}</span>
        <span
          className={cn(
            'ml-2 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums',
            check.count > 0 ? `${cfg.color} bg-white/70` : 'text-muted-foreground'
          )}
        >
          {check.count}
        </span>
        <span className={cn('ml-1 text-xs font-medium px-1.5 py-0.5 rounded', cfg.color, 'bg-white/60')}>
          優先度：{cfg.label}
        </span>
        {check.count > 0 ? (
          open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        )}
      </button>
      {open && check.count > 0 && (
        <div className="border-t border-border/50 px-4 pb-4">
          <CaseTable cases={check.cases} />
        </div>
      )}
    </div>
  )
}

// ─── メインコンポーネント ────────────────────────────────────────
export function DataQualityCheck() {
  const [result, setResult] = useState<QualityCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/cases/quality-check')
      if (!res.ok) throw new Error(`サーバーエラー: ${res.status}`)
      const data: QualityCheckResult = await res.json()
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'チェックに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  // 優先度別カウント
  const highCount   = result?.checks.filter(c => c.priority === 'high'   && c.count > 0).reduce((s, c) => s + c.count, 0) ?? 0
  const mediumCount = result?.checks.filter(c => c.priority === 'medium' && c.count > 0).reduce((s, c) => s + c.count, 0) ?? 0
  const lowCount    = result?.checks.filter(c => c.priority === 'low'    && c.count > 0).reduce((s, c) => s + c.count, 0) ?? 0

  const checkedAt = result?.checkedAt
    ? new Date(result.checkedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">データ品質チェック</h1>
            {checkedAt && (
              <p className="text-xs text-muted-foreground">最終チェック: {checkedAt}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          {loading ? 'チェック中...' : 'チェックを実行'}
        </button>
      </div>

      {/* エラー */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 未実行の案内 */}
      {!result && !loading && !error && (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">「チェックを実行」ボタンを押すと、全案件のデータ品質を確認します。</p>
          <p className="mt-1 text-xs text-muted-foreground">既存データの読み取りのみ行います。変更は一切行いません。</p>
        </div>
      )}

      {/* 結果 */}
      {result && (
        <>
          {/* サマリーカード */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">問題件数（延べ）</p>
              <p className={cn('mt-1 text-3xl font-bold tabular-nums', result.totalIssues > 0 ? 'text-red-600' : 'text-green-600')}>
                {result.totalIssues}
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs text-red-600">優先度：高</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-red-700">{highCount}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs text-amber-600">優先度：中</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-amber-700">{mediumCount}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-xs text-blue-600">優先度：低</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-blue-700">{lowCount}</p>
            </div>
          </div>

          {/* 問題なし */}
          {result.totalIssues === 0 && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
              <p className="font-medium text-green-700">すべてのチェックを通過しました</p>
              <p className="mt-1 text-sm text-green-600">データ品質に問題は見つかりませんでした。</p>
            </div>
          )}

          {/* チェック一覧 */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">チェック項目一覧（クリックで該当案件を展開）</h2>
            {(['high', 'medium', 'low'] as Priority[]).map(priority => {
              const group = result.checks.filter(c => c.priority === priority)
              if (group.length === 0) return null
              const cfg = PRIORITY_CONFIG[priority]
              return (
                <div key={priority} className="space-y-2">
                  <p className={cn('text-xs font-semibold uppercase tracking-wide', cfg.color)}>
                    優先度：{cfg.label}
                  </p>
                  {group.map(check => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
