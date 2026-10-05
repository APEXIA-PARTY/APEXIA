'use client'

import { useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 自動キャンセル手動実行ボタン（admin のみ）
 *
 * 2段階で実行する:
 *   1) POST /api/auto-cancel { dryRun: true } で、対象件数を確認する（何も変更しない）
 *   2) 件数を表示して、明示的に確認が取れた場合だけ POST /api/auto-cancel { dryRun: false } で本実行する
 *
 * サーバー側の CRON_MODE が live でない間（既定は dry）は、本実行はサーバーが拒否する。
 * このボタンは件数の確認だけが可能になる。
 */
export function AutoCancelButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<string | null>(null)

  const post = (dryRun: boolean) =>
    fetch('/api/auto-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    })

  const handleRun = async () => {
    setLoading(true)
    setResult(null)
    try {
      // ── 1) 対象の確認（dry-run: 何も変更しない）──
      const dryRes = await post(true)
      const dry = await dryRes.json()
      if (!dryRes.ok) {
        toast.error(dry.message ?? '対象の確認に失敗しました')
        return
      }
      if (dry.disabled) {
        toast.info(dry.message ?? '自動キャンセルは無効です')
        return
      }

      const s = dry.byStatus ?? {}
      const summary =
        `対象: ${dry.totalCandidates}件（新規問合せ ${s.inquiry ?? 0} / 下見調整中 ${s.preview_adj ?? 0} / 下見済み ${s.previewed ?? 0}）\n` +
        `仮押さえで要確認（自動キャンセルしません）: ${dry.tentativeManualReview?.total ?? 0}件`

      if (!dry.liveEnabled) {
        window.alert(`${summary}\n\n現在は確認のみのモード（dry）のため、実行できません。`)
        setResult(`確認のみ: 対象${dry.totalCandidates}件（実行はされていません）`)
        return
      }
      if (dry.exceedsWriteLimit) {
        window.alert(`${summary}\n\n対象が1回の上限（${dry.writeLimit}件）を超えているため、実行できません。`)
        return
      }
      if ((dry.liveBlockers ?? []).length > 0) {
        window.alert(`${summary}\n\n実行できない状態です（${(dry.liveBlockers as string[]).join(', ')}）。`)
        return
      }
      if (dry.totalCandidates === 0) {
        toast.success('対象の案件はありません')
        return
      }

      // ── 2) 明示的な確認のうえで本実行 ──
      if (!window.confirm(`${summary}\n\nこの${dry.totalCandidates}件を自動キャンセルします。よろしいですか？`)) return
      const res = await post(false)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.message ?? '実行に失敗しました')
        return
      }
      const msg = `自動キャンセル完了: ${data.processed}件処理しました`
      toast.success(msg)
      setResult(msg)
      // ページをリフレッシュして結果を反映
      if (data.processed > 0) {
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch {
      toast.error('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRun}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        自動キャンセル（対象を確認）
      </button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </div>
  )
}
