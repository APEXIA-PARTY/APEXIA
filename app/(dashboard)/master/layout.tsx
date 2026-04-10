import { getCurrentUserRole } from '@/lib/auth/helpers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

const MASTER_NAV = [
  { href: '/master/media',               label: '認知経路' },
  { href: '/master/contact-methods',     label: '連絡方法' },
  { href: '/master/event-categories',    label: 'イベント大分類' },
  { href: '/master/event-subcategories', label: 'イベント中分類' },
  { href: '/master/floors',              label: 'フロア' },
  { href: '/master/cancel-reasons',      label: 'キャンセル理由' },
  { href: '/master/options',             label: 'オプション' },
]

export default async function MasterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = await getCurrentUserRole()
  const isAdmin = role === 'admin'

  return (
    <div className="space-y-5">
      {/* マスタ管理ヘッダー */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">マスタ管理</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isAdmin
              ? '各マスタの追加・編集・並び替えができます'
              : '閲覧のみ（編集は管理者のみ）'}
          </p>
        </div>
        {!isAdmin && (
          <span className="rounded-md border border-orange-200 bg-orange-50 px-3 py-1 text-xs text-orange-700">
            閲覧専用モード
          </span>
        )}
      </div>

      {/* サブナビゲーション */}
      <nav className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1.5">
        {MASTER_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* isAdmin を hidden input で子に渡す（Server→Client の橋渡し） */}
      {/* 実際は各ページで getCurrentUserRole を再度呼ぶ方がシンプルなため各ページで取得する */}
      {children}
    </div>
  )
}
