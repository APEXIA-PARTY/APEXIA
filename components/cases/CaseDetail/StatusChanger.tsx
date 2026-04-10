'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, ChevronDown } from 'lucide-react'
import { CaseStatus } from '@/types/database'
import { STATUS_LIST, STATUS_CONFIG } from '@/lib/constants/status'
import { cn } from '@/lib/utils/cn'

interface CancelReasonItem {
  id: string
  name: string
  is_auto_cancel: boolean
}

interface Props {
  caseId: string
  currentStatus: CaseStatus
  autoCancel: boolean
  currentCancelReasonId: string | null
  currentCancelNote: string | null
}

/**
 * 案件詳細画面のインラインステータス変更コンポーネント
 * - プルダウンでステータスを選択して即時 PUT 更新
 * - cancelled 選択時はキャンセル理由・備考の入力欄を展開
 * - auto_cancel は変更不可（表示のみ）
 */
export function CaseStatusChanger({
  caseId,
  currentStatus,
  autoCancel,
  currentCancelReasonId,
  currentCancelNote,
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<CaseStatus>(currentStatus)
  const [cancelReasonId, setCancelReasonId] = useState<string>(currentCancelReasonId ?? '')
  const [cancelNote, setCancelNote] = useState<string>(currentCancelNote ?? '')
  const [reasons, setReasons] = useState<CancelReasonItem[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // キャンセル理由マスタを取得
  useEffect(() => {
    fetch('/api/master/cancel-reasons')
      .then((r) => r.ok ? r.json() : [])
      .then((data: CancelReasonItem[]) =>
        // 自動キャンセル専用理由は手動選択から除外
        setReasons(Array.isArray(data) ? data.filter((r: any) => !r.is_auto_cancel) : [])
      )
  }, [])

  const isCancelled = status === 'cancelled'
  const config = STATUS_CONFIG[status]

  const handleSave = async () => {
    // cancelled の場合はキャンセル理由必須
    if (isCancelled && !cancelReasonId) {
      toast.error('キャンセル理由を選択してください')
      return
    }

    setLoading(true)
    try {
      // PUT は CaseForm と同じエンドポイントを使う
      // ステータス・キャンセル関連フィールドのみ送るためにパッチ相当の処理
      // ※ API 側は full update なので現在の case データを取得してマージする
      const currentRes = await fetch(`/api/cases/${caseId}`)
      if (!currentRes.ok) throw new Error('案件の取得に失敗しました')
      const current = await currentRes.json()

      const payload = {
        ...current,
        // リレーションオブジェクトを除去（PUT は FK のみ送る）
        media_master: undefined,
        contact_method_master: undefined,
        floor_master: undefined,
        event_category_master: undefined,
        event_subcategory_master: undefined,
        cancel_reason_master: undefined,
        case_options: undefined,
        case_checklist: undefined,
        case_files: undefined,
        case_hold_logs: undefined,
        case_history: undefined,
        // 変更フィールド
        status,
        cancel_reason_id: isCancelled ? cancelReasonId || null : null,
        cancel_note: isCancelled ? cancelNote : null,
      }

      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? 'ステータスの更新に失敗しました')
        return
      }

      toast.success(`ステータスを「${STATUS_CONFIG[status].label}」に変更しました`)
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error('更新に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    // 変更を破棄してリセット
    setStatus(currentStatus)
    setCancelReasonId(currentCancelReasonId ?? '')
    setCancelNote(currentCancelNote ?? '')
    setOpen(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* 現在のステータスバッジ + 変更ボタン */}
      <div className="flex items-center gap-2">
        <span className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
          config.bgColor, config.color
        )}>
          {config.label}
          {autoCancel && ' （自動）'}
        </span>

        {/* auto_cancel でなければ変更ボタンを表示 */}
        {!autoCancel && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            変更
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* 変更パネル */}
      {open && (
        <div className="w-full rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm">
          <p className="text-sm font-medium text-foreground">ステータスを変更</p>

          {/* ステータス選択 */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">新しいステータス</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CaseStatus)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-52"
            >
              {STATUS_LIST
                // 自動キャンセルは手動で選択不可
                .filter((s) => s.value !== 'auto_cancel')
                .map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
            </select>
          </div>

          {/* キャンセル選択時のみ追加入力 */}
          {isCancelled && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-3">
              <p className="text-xs font-medium text-destructive">キャンセル情報を入力してください</p>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  キャンセル理由 <span className="text-destructive">*</span>
                </label>
                <select
                  value={cancelReasonId}
                  onChange={(e) => setCancelReasonId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">選択してください</option>
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">キャンセル備考</label>
                <textarea
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  placeholder="任意"
                />
              </div>
            </div>
          )}

          {/* ボタン */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="rounded-md border border-input px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
