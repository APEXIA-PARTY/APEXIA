import { Case } from '@/types/database'
import { formatTime } from '@/lib/utils/format'

interface Props { caseData: Case }

const TIMELINE_ITEMS = [
  { key: 'load_in_time',   label: '入り' },
  { key: 'setup_time',     label: '搬入 / 準備' },
  { key: 'rehearsal_time', label: 'リハ' },
  { key: 'start_time',     label: '開始' },
  { key: 'end_time',       label: '終了' },
  { key: 'strike_time',    label: '片付け / 撤収' },
  { key: 'full_exit_time', label: '完全撤収' },
] as const

export function CaseDetailTimeline({ caseData: c }: Props) {
  const hasAny = TIMELINE_ITEMS.some((item) => c[item.key])

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">② タイムスケジュール</h2>
      </div>
      <div className="p-5">
        {!hasAny ? (
          <p className="text-sm text-muted-foreground">未入力</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {TIMELINE_ITEMS.map((item) => (
              <div
                key={item.key}
                className={`flex flex-col items-center rounded-md border px-4 py-2.5 min-w-[90px] ${
                  c[item.key]
                    ? 'border-border bg-background'
                    : 'border-dashed border-muted-foreground/30 bg-muted/20'
                }`}
              >
                <span className="text-xs text-muted-foreground mb-1">{item.label}</span>
                <span className={`text-sm font-mono font-medium ${c[item.key] ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                  {c[item.key] ? formatTime(c[item.key]) : '——'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
