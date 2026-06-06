'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { createClient } from '@/lib/supabase/client'
import {
  Menu, X, LayoutDashboard, FileText,
  BarChart2, Settings, LogOut, Building2, ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { href: '/',             label: 'ダッシュボード',       icon: LayoutDashboard },
  { href: '/cases',        label: '案件一覧',             icon: FileText },
  { href: '/analytics',    label: '分析・集計',           icon: BarChart2 },
  // { href: '/data-quality', label: 'データ品質チェック', icon: ShieldAlert },  // 将来利用予定のため非表示
  { href: '/master',       label: 'マスタ管理',           icon: Settings },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()

  // ページ遷移でメニューを閉じる
  useEffect(() => { setMenuOpen(false) }, [pathname])

  // メニュー開閉時のスクロールロック
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const handleLogout = async () => {
    setMenuOpen(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/20">

      {/* ── PC用サイドバー (md以上のみ表示) ── */}
      <div className="hidden md:flex md:h-full md:flex-col md:shrink-0">
        <Sidebar />
      </div>

      {/* ── コンテンツ列 ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* ── スマホ用ヘッダー (md未満のみ表示) ── */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:hidden">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="text-base font-bold tracking-wide text-foreground">APEXIA</span>
          </div>
          <button
            onClick={() => setMenuOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="メニューを開く"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        {/* ── メインコンテンツ ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>

      {/* ── スマホ用ドロワーメニュー ── */}
      {/* オーバーレイ */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ドロワー本体 */}
      <div className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-card shadow-xl transition-transform duration-300 md:hidden',
        menuOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* ドロワーヘッダー */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="text-base font-bold tracking-wide text-foreground">APEXIA</span>
          </div>
          <button
            onClick={() => setMenuOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="メニューを閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ナビゲーション */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* ログアウト */}
        <div className="border-t border-border p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-5 w-5" />
            <span>ログアウト</span>
          </button>
        </div>
      </div>

    </div>
  )
}
