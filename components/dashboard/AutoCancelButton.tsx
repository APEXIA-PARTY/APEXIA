'use client'

import { useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 自動キャンセル手動実行ボタン（admin のみ）
 * POST /api/auto-cancel を呼び出す
 */
export function AutoCancelButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<string | null>(null)

  const handleRun = async () => {
    if (!window.confirm('開催日が過ぎた未確定案件を自動キャンセルします。よろしいですか？')) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/auto-cancel', { method: 'POST' })
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
        自動キャンセル実行
      </button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </div>
  )
}
