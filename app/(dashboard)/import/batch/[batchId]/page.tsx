'use client'

/**
 * バッチ確認・承認画面
 *
 * 【安全保証】
 * - classify ボタンを押すまで cases への変更はない
 * - 「本番反映」ボタンを押すまで cases への変更はない
 * - 本番反映後は applied=true になり再実行不可
 * - 個人情報を console.log に出力しない
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { AlertCircle, CheckCircle2, Info, RefreshCw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'
import type { BatchDetail, StagingRow, ClassifyResponse, ApplyResponse } from '@/types/import'

// ─── 型 ────────────────────────────────────────────────────────────────────────
type PageState = 'loading' | 'ready' | 'classifying' | 'applying' | 'done' | 'error'

// ─── 分類バッジ ─────────────────────────────────────────────────────────────────
function ClassBadge({ cls }: { cls: string }) {
  const MAP: Record<string, string> = {
    '新規追加': 'bg-green-50 text-green-700 border-green-200',
    '重複候補': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    '要確認':   'bg-orange-50 text-orange-700 border-orange-200',
    'スキップ': 'bg-gray-50  text-gray-500  border-gray-200',
  }
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-xs whitespace-nowrap', MAP[cls] ?? 'bg-gray-50 text-gray-500 border-gray-200')}>
      {cls}
    </span>
  )
}

// ─── ステータスバッジ ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { label: string; cls: string }> = {
    inquiry:     { label: '問合せ',    cls: 'bg-blue-50   text-blue-700   border-blue-200'   },
    preview_adj: { label: '下見調整',  cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    previewed:   { label: '下見済み',  cls: 'bg-purple-50 text-purple-700 border-purple-200' },
    tentative:   { label: '仮押さえ',  cls: 'bg-orange-50 text-orange-700 border-orange-200' },
    confirmed:   { label: '確定',      cls: 'bg-green-50  text-green-700  border-green-200'  },
    cancelled:   { label: 'キャンセル',cls: 'bg-red-50    text-red-700    border-red-200'    },
    done:        { label: '終了',      cls: 'bg-gray-50   text-gray-500   border-gray-200'   },
  }
  const cfg = MAP[status] ?? { label: status, cls: 'bg-gray-50 text-gray-500 border-gray-200' }
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-xs whitespace-nowrap', cfg.cls)}>
      {cfg.label}
    </span>
  )
}

// ─── メイン ─────────────────────────────────────────────────────────────────────
export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>()

  const [pageState, setPageState] = useState<PageState>('loading')
  const [batch, setBatch]         = useState<BatchDetail | null>(null)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null)

  // チェック状態: staging_id → true(承認) / false(スキップ)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  // ── バッチデータ取得 ──────────────────────────────────────────────────────────
  const fetchBatch = useCallback(async () => {
    setErrorMsg(null)
    try {
      const res  = await fetch(`/api/import/batch/${batchId}`)
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.message ?? '取得に失敗しました'); setPageState('error'); return }

      const b = data as BatchDetail
      setBatch(b)

      // チェック初期値: 新規追加 → ON、それ以外 → OFF
      const initial: Record<string, boolean> = {}
      for (const row of b.staging_rows) {
        initial[row.id] = row.classification === '新規追加'
      }
      setChecked(initial)
      setPageState('ready')
    } catch {
      setErrorMsg('ネットワークエラーが発生しました')
      setPageState('error')
    }
  }, [batchId])

  useEffect(() => { fetchBatch() }, [fetchBatch])

  // ── 照合実行 ─────────────────────────────────────────────────────────────────
  const handleClassify = async () => {
    setErrorMsg(null)
    setPageState('classifying')
    try {
      const res  = await fetch(`/api/import/batch/${batchId}/classify`, { method: 'POST' })
      const data = await res.json() as ClassifyResponse
      if (!res.ok) {
        setErrorMsg((data as { message?: string }).message ?? '照合に失敗しました')
        setPageState('ready')
        return
      }
      // 照合完了 → 再フェッチして分類結果を反映
      await fetchBatch()
    } catch {
      setErrorMsg('ネットワークエラーが発生しました')
      setPageState('ready')
    }
  }

  // ── 本番反映 ─────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    if (!batch) return
    setErrorMsg(null)
    setPageState('applying')

    const decisions: Record<string, 'approve' | 'skip'> = {}
    for (const row of batch.staging_rows) {
      decisions[row.id] = checked[row.id] ? 'approve' : 'skip'
    }

    try {
      const res  = await fetch(`/api/import/batch/${batchId}/apply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decisions }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg((data as { message?: string }).message ?? '反映に失敗しました')
        setPageState('ready')
        return
      }
      setApplyResult(data as ApplyResponse)
      setPageState('done')
    } catch {
      setErrorMsg('ネットワークエラーが発生しました')
      setPageState('ready')
    }
  }

  // ── 一括操作 ─────────────────────────────────────────────────────────────────
  const checkAll      = () => setChecked(prev => Object.fromEntries(Object.keys(prev).map(k => [k, true])))
  const uncheckAll    = () => setChecked(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])))
  const uncheckNonNew = () => {
    if (!batch) return
    setChecked(prev => {
      const next = { ...prev }
      for (const row of batch.staging_rows) {
        if (row.classification !== '新規追加') next[row.id] = false
      }
      return next
    })
  }

  const approveCount = Object.values(checked).filter(Boolean).length

  // ── 分類済みかどうか ──────────────────────────────────────────────────────────
  const isClassified = batch?.staging_rows.some(r => r.classification !== '要確認') ?? false

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link href="/import" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          インポートに戻る
        </Link>
      </div>

      <PageHeader
        title="バッチ確認・本番反映"
        description="照合結果を確認し、反映する行にチェックを入れてから「本番反映」を実行してください。"
      />

      {/* エラー */}
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ローディング */}
      {pageState === 'loading' && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          読み込み中...
        </div>
      )}

      {/* 反映完了 */}
      {pageState === 'done' && applyResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 space-y-3">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-6 w-6" />
            <p className="text-lg font-semibold">本番反映が完了しました</p>
          </div>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground w-28 inline-block">反映件数</span><span className="font-medium">{applyResult.approved_count}件</span></p>
            <p><span className="text-muted-foreground w-28 inline-block">スキップ</span><span className="font-medium">{applyResult.skipped_count}件</span></p>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
            Batch ID: <code className="font-mono">{applyResult.batch_id}</code><br />
            このIDでロールバック可能です（第3フェーズで実装予定）。
          </div>
          <Link href="/import" className="inline-block rounded-md border border-green-300 bg-white px-4 py-2 text-sm text-green-700 hover:bg-green-50">
            インポートトップに戻る
          </Link>
        </div>
      )}

      {/* メインコンテンツ */}
      {batch && pageState !== 'done' && (
        <div className="space-y-5">
          {/* バッチ情報 */}
          <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">ファイル</p>
              <p className="font-medium mt-0.5">{batch.filename}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">シート</p>
              <p className="font-medium mt-0.5">{batch.sheet_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">全件数</p>
              <p className="font-semibold text-lg mt-0.5">{batch.total_rows}件</p>
            </div>
            {isClassified && (
              <>
                <div>
                  <p className="text-muted-foreground text-xs">新規追加</p>
                  <p className="font-semibold text-lg mt-0.5 text-green-600">{batch.new_count}件</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">重複候補</p>
                  <p className="font-semibold text-lg mt-0.5 text-yellow-600">{batch.duplicate_count}件</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">要確認</p>
                  <p className="font-semibold text-lg mt-0.5 text-orange-600">{batch.review_count}件</p>
                </div>
              </>
            )}

            {/* 反映済みバナー */}
            {batch.applied && (
              <div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                反映済み（{batch.applied_at ? new Date(batch.applied_at).toLocaleString('ja-JP') : ''}）
              </div>
            )}
          </div>

          {/* 照合ボタン */}
          {!batch.applied && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleClassify}
                disabled={pageState === 'classifying' || pageState === 'applying'}
                className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={cn('h-4 w-4', pageState === 'classifying' && 'animate-spin')} />
                {pageState === 'classifying' ? '照合中...' : isClassified ? '再照合する' : '照合を実行する'}
              </button>
              {!isClassified && (
                <p className="text-sm text-muted-foreground">
                  まず「照合を実行する」でマスター照合と重複チェックを行ってください。
                </p>
              )}
            </div>
          )}

          {/* 照合前の案内 */}
          {!isClassified && !batch.applied && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>照合を実行すると、既存 cases と会社名・開催日を照合し、マスターID を解決します。casesテーブルは変更されません。</span>
            </div>
          )}

          {/* テーブル＋操作ボタン */}
          {isClassified && !batch.applied && (
            <div className="space-y-3">
              {/* 一括操作 */}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={checkAll}      className="rounded border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted/40">全件チェック</button>
                <button onClick={uncheckAll}    className="rounded border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted/40">全件解除</button>
                <button onClick={uncheckNonNew} className="rounded border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted/40">重複・要確認を除外</button>
                <span className="text-sm text-muted-foreground ml-auto">
                  {approveCount}件選択中
                </span>
              </div>

              {/* テーブル */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="w-10 px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={approveCount === batch.staging_rows.length && batch.staging_rows.length > 0}
                            onChange={e => e.target.checked ? checkAll() : uncheckAll()}
                            className="accent-primary"
                          />
                        </th>
                        {['行', '会社名', '担当者名', '開催日', 'ステータス', '分類', '備考・照合結果'].map(h => (
                          <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {batch.staging_rows.map((row: StagingRow) => (
                        <tr
                          key={row.id}
                          className={cn(
                            'hover:bg-muted/20 transition-colors',
                            !checked[row.id] && 'opacity-50'
                          )}
                        >
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={!!checked[row.id]}
                              onChange={e => setChecked(prev => ({ ...prev, [row.id]: e.target.checked }))}
                              className="accent-primary"
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.row_number}</td>
                          <td className="px-3 py-2 max-w-[140px] truncate font-medium">{row.company ?? '—'}</td>
                          <td className="px-3 py-2 max-w-[100px] truncate">{row.contact ?? '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.event_date ?? '—'}</td>
                          <td className="px-3 py-2"><StatusBadge status={row.status_raw} /></td>
                          <td className="px-3 py-2"><ClassBadge cls={row.classification} /></td>
                          <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{row.review_notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 本番反映 */}
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                <p className="text-sm font-medium text-red-800">本番反映の確認</p>
                <p className="text-xs text-red-700">
                  チェックした <strong>{approveCount}件</strong> を cases テーブルに INSERT します。
                  この操作は元に戻せません（ロールバックは第3フェーズで実装予定）。
                  チェックなしの {batch.staging_rows.length - approveCount}件 はスキップされます。
                </p>
                <button
                  onClick={handleApply}
                  disabled={approveCount === 0 || pageState === 'applying' || pageState === 'classifying'}
                  className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pageState === 'applying' ? '反映中...' : `本番反映（${approveCount}件）`}
                </button>
              </div>
            </div>
          )}

          {/* 反映済みの場合はテーブルのみ表示（読み取り専用） */}
          {batch.applied && batch.staging_rows.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden opacity-75">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {['行', '会社名', '担当者名', '開催日', 'ステータス', '分類', '判断', '備考'].map(h => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {batch.staging_rows.map((row: StagingRow) => (
                      <tr key={row.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground">{row.row_number}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate font-medium">{row.company ?? '—'}</td>
                        <td className="px-3 py-2 max-w-[100px] truncate">{row.contact ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.event_date ?? '—'}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.status_raw} /></td>
                        <td className="px-3 py-2"><ClassBadge cls={row.classification} /></td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {row.admin_decision === 'approve'
                            ? <span className="text-green-600 font-medium">✓ 反映</span>
                            : <span className="text-gray-400">— スキップ</span>}
                        </td>
                        <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">{row.review_notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
