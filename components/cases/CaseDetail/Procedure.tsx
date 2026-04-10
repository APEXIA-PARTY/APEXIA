import { Case } from '@/types/database'
import { formatDateTime, formatCurrency } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

interface Props { caseData: Case }

const StatusPill = ({ value, okValues }: { value: string; okValues: string[] }) => {
  const isOk = okValues.includes(value)
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
      isOk
        ? 'border-green-200 bg-green-50 text-green-700'
        : 'border-orange-200 bg-orange-50 text-orange-700'
    )}>
      {value}
    </span>
  )
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border last:border-0">
    <span className="text-sm text-muted-foreground shrink-0 w-40">{label}</span>
    <div className="text-sm font-medium text-right">{children}</div>
  </div>
)

export function CaseDetailProcedure({ caseData: c }: Props) {
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">③ 確認手続き</h2>
      </div>
      <div className="px-5 py-1">
        <Row label="下見日時">
          <span>{c.preview_datetime ? formatDateTime(c.preview_datetime) : '—'}</span>
        </Row>
        <Row label="見積金額（税込）">
          <span className={c.estimate_amount > 0 ? 'text-green-700 font-bold' : ''}>
            {c.estimate_amount > 0 ? formatCurrency(c.estimate_amount) : '—'}
          </span>
        </Row>
        <Row label="申込みフォーム">
          <StatusPill value={c.application_form_status} okValues={['済み']} />
        </Row>
        <Row label="搬入出届">
          <StatusPill value={c.delivery_notice_status} okValues={['済み']} />
        </Row>
        <Row label="請求書">
          <StatusPill value={c.invoice_status} okValues={['振り込み済み', '送付済み']} />
        </Row>
        <Row label="支払い方法">
          <span>{c.payment_method ?? '—'}</span>
        </Row>
      </div>
    </section>
  )
}
