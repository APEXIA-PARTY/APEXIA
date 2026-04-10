import { CaseHistory } from '@/types/database'
import { formatDateTime } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

interface Props { history: CaseHistory[] }

const ACTION_STYLE: Record<string, string> = {
  create:        'bg-blue-50 text-blue-700 border-blue-200',
  update:        'bg-gray-50 text-gray-600 border-gray-200',
  status_change: 'bg-purple-50 text-purple-700 border-purple-200',
  auto_cancel:   'bg-red-50 text-red-700 border-red-200',
  file_upload:   'bg-green-50 text-green-700 border-green-200',
  gcal_sync:     'bg-orange-50 text-orange-700 border-orange-200',
}

const ACTION_LABEL: Record<string, string> = {
  create:        '作成',
  update:        '更新',
  status_change: 'ステータス変更',
  auto_cancel:   '自動キャンセル',
  file_upload:   'ファイル',
  gcal_sync:     'カレンダー',
}

export function CaseDetailHistory({ history }: Props) {
  const sorted = [...history].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">案件履歴・操作ログ</h2>
      </div>
      <div className="divide-y divide-border">
        {sorted.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">履歴がありません</p>
        ) : (
          sorted.map((h) => (
            <div key={h.id} className="flex items-start gap-3 px-5 py-3">
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  ACTION_STYLE[h.action_type] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                )}
              >
                {ACTION_LABEL[h.action_type] ?? h.action_type}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{h.message}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(h.created_at)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
