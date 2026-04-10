import Link from 'next/link'

export default function NewCasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">新規問合せ登録</h1>
        <p className="text-sm text-muted-foreground mt-1">
          このページは作成中です。
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-foreground">
          新規登録フォームは次の修正で追加します。
        </p>
        <div className="mt-4">
          <Link
            href="/cases"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            案件一覧へ戻る
          </Link>
        </div>
      </div>
    </div>
  )
}