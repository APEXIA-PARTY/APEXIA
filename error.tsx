'use client'

import { useEffect } from 'react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // 本番環境では Sentry などに送信する場合はここに追記
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        {/* アイコン */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <span className="text-3xl">⚠️</span>
        </div>

        {/* メッセージ */}
        <h1 className="text-xl font-bold text-foreground">
          エラーが発生しました
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          予期しないエラーが発生しました。
          <br />
          再試行しても解決しない場合は管理者にお問い合わせください。
        </p>

        {/* デバッグ情報（本番では非表示にする場合はここを削除） */}
        {process.env.NODE_ENV !== 'production' && error?.message && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-left text-xs font-mono text-muted-foreground break-all">
            {error.message}
          </p>
        )}

        {/* アクション */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            再試行する
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm text-muted-foreground hover:bg-muted"
          >
            ダッシュボードへ戻る
          </a>
        </div>
      </div>
    </div>
  )
}
