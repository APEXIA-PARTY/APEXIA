import { Case } from '@/types/database'
import { formatTime } from '@/lib/utils/format'

interface Props { caseData: Case }

/**
 * タイムスケジュール表示（UI統合版）
 *
 * DB カラムは変更なし。以下のように2カラムをUIで統合表示:
 *   load_in_time || setup_time     → "入り / 搬入 / 準備"
 *   strike_time  || full_exit_time → "片付け / 完全撤収"
 *
 * 既存データで片方のみ値がある場合も正しく表示される。
 */
const TIMELINE_ITEMS: {
  label: string
  getValue: (c: Case) => string | null | undefined
}[] = [
  {
    label: '入り / 搬入 / 準備',
    getValue: (c) => c.load_in_time ?? c.setup_time,
  },
  {
    label: 'リハ',
    getValue: (c) => c.rehearsal_time,
  },
  {
    label: '開始',
    getValue: (c) => c.start_time,
  },
  {
    label: '終了',
    getValue: (c) => c.end_time,
  },
  {
    label: '片付け / 完全撤収',
    getValue: (c) => c.strike_time ?? c.full_exit_time,
  },
]

export function CaseDetailTimeline({ caseData: c }: Props) {
  const hasAny = TIMELINE_ITEMS.some(item => !!item.getValue(c))

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
            {TIMELINE_ITEMS.map(item => {
              const val = item.getValue(c)
              return (
                <div
                  key={item.label}
                  className={`flex flex-col items-center rounded-md border px-4 py-2.5 min-w-[110px] ${
                    val
                      ? 'border-border bg-background'
                      : 'border-dashed border-muted-foreground/30 bg-muted/20'
                  }`}
                >
                  <span className="text-xs text-muted-foreground mb-1 text-center">{item.label}</span>
                  <span className={`text-sm font-mono font-medium ${val ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                    {val ? formatTime(val) : '——'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
