import { Case } from '@/types/database'
import { formatDate, formatTime, emptyToDash } from '@/lib/utils/format'

interface Props { caseData: Case & { [k: string]: any } }

const Item = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-muted/40 px-3 py-2.5">
    <dt className="text-xs text-muted-foreground mb-0.5">{label}</dt>
    <dd className="text-sm font-medium text-foreground break-all">{value}</dd>
  </div>
)

export function CaseDetailBasicInfo({ caseData: c }: Props) {
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">① 基本情報</h2>
      </div>
      <div className="p-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Item label="会社名 / 団体名" value={emptyToDash(c.company)} />
          <Item label="担当者名"        value={emptyToDash(c.contact)} />
          <Item label="電話番号"        value={emptyToDash(c.phone)} />
          <Item label="メール"          value={emptyToDash(c.email)} />
          <Item label="問合せ日"        value={formatDate(c.inquiry_date)} />
          <Item label="開催日"          value={formatDate(c.event_date)} />
          <Item label="利用時間"        value={`${formatTime(c.start_time)} 〜 ${formatTime(c.end_time)}`} />
          <Item label="予定参加人数"    value={c.guest_count ? `${c.guest_count} 名` : '—'} />
          <Item label="フロア"          value={c.floor_master?.name ?? '—'} />
          <Item label="認知経路"        value={c.media_master?.name ?? '—'} />
          <Item label="連絡方法"        value={c.contact_method_master?.name ?? '—'} />
          <Item label="イベント大分類"  value={c.event_category_master?.name ?? '—'} />
          <Item label="イベント中分類"  value={
            c.event_subcategory_master?.name === 'その他' && c.event_subcategory_note
              ? `その他（${c.event_subcategory_note}）`
              : (c.event_subcategory_master?.name ?? '—')
          } />
        </dl>
        {c.notes && (
          <div className="mt-3 rounded-md bg-muted/40 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground mb-1">備考</dt>
            <dd className="text-sm whitespace-pre-wrap">{c.notes}</dd>
          </div>
        )}
      </div>
    </section>
  )
}
