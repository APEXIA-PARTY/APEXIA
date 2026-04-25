'use client'

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'

interface Props {
  caseId: string
  className?: string
}

/**
 * PDF ダウンロードボタン
 *
 * fetch + blob 方式を使う理由:
 *   - <a download> はブラウザによって Cookie が送信されないケースがある
 *   - fetch は credentials: 'include' を指定できるため必ず Cookie を送れる
 *
 * ファイル名の取得:
 *   - サーバーが返す X-Filename ヘッダー（URL エンコード済み）を読んで
 *     anchor.download に設定する
 *   - X-Filename が取れない場合は fallback 名を使う
 */
export function PdfDownloadButton({ caseId, className }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleDownload = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/cases/${caseId}/pdf`, {
        method:      'GET',
        credentials: 'include',
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg  = body?.message ?? `エラーが発生しました（HTTP ${res.status}）`
        setError(msg)
        return
      }

      // X-Filename ヘッダーからファイル名を取得（URL エンコード済み）
      const encodedFilename = res.headers.get('X-Filename')
      const filename = encodedFilename
        ? decodeURIComponent(encodedFilename)
        : `event-confirmation-${caseId}.pdf`

      const blob   = await res.blob()
      const url    = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href     = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch {
      setError('通信エラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleDownload}
        disabled={loading}
        className={
          className ??
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50'
        }
      >
        {loading
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <FileDown className="h-3.5 w-3.5" />
        }
        {loading ? 'PDF生成中...' : 'PDF'}
      </button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}