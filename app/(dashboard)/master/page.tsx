import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const MASTERS = [
  { href: '/master/media',               label: '認知経路マスタ',         desc: '媒体・認知経路の管理（月額費用も設定可）' },
  { href: '/master/contact-methods',     label: '連絡方法マスタ',         desc: '問合せ経路の管理' },
  { href: '/master/event-categories',    label: 'イベント大分類マスタ',   desc: 'イベントの大カテゴリ管理' },
  { href: '/master/event-subcategories', label: 'イベント中分類マスタ',   desc: '大分類に紐づく中カテゴリ管理' },
  { href: '/master/floors',              label: 'フロアマスタ',           desc: '会場フロアの管理（7F / 8F / 両方）' },
  { href: '/master/cancel-reasons',      label: 'キャンセル理由マスタ',   desc: 'キャンセル理由の管理（自動キャンセル用含む）' },
  { href: '/master/options',             label: 'オプションマスタ',       desc: '備品・機材オプションの管理' },
]

export default function MasterTopPage() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MASTERS.map((m) => (
        <Link
          key={m.href}
          href={m.href}
          className="flex items-center justify-between rounded-lg border border-border bg-card px-5 py-4 hover:bg-muted/40 transition-colors group"
        >
          <div>
            <p className="font-medium text-foreground">{m.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{m.desc}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-3" />
        </Link>
      ))}
    </div>
  )
}
