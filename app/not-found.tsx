import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        {/* ステータスコード */}
        <p className="text-6xl font-bold tabular-nums text-muted-foreground/30">404</p>

        {/* メッセージ */}
        <h1 className="mt-4 text-xl font-bold text-foreground">
          ページが見つかりません
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          お探しのページは存在しないか、削除された可能性があります。
        </p>

        {/* アクション */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            ダッシュボードへ戻る
          </Link>
          <Link
            href="/cases"
            className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm text-muted-foreground hover:bg-muted"
          >
            案件一覧へ
          </Link>
        </div>
      </div>
    </div>
  )
}
