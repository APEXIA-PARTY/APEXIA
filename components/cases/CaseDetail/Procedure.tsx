'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Case } from '@/types/database'
import { formatCurrency } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import {
  DEPOSIT_STATUS_OPTIONS,
  FORM_STATUS_OPTIONS,
  DELIVERY_STATUS_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  REMAINING_PAYMENT_STATUS_OPTIONS,
} from '@/lib/constants/status'
import {
  formatPreviewDateTime,
  toPreviewInputValue,
  validatePreviewDateTime,
  validateProcedureSelect,
  type ProcedureField,
  type ProcedureSelectField,
} from '@/lib/cases/procedure'
import { PreviewDateTimeSelect } from '@/components/cases/PreviewDateTimeSelect'

interface Props {
  caseData: Case
  /** PUT /api/cases/[id] を呼ぶために必要 */
  caseId: string
  /** admin / staff のみ true。viewer は従来どおり表示のみ */
  isEditable?: boolean
}

type Values = Pick<Case, ProcedureField | 'estimate_amount'>

const pickValues = (c: Case): Values => ({
  preview_datetime: c.preview_datetime ?? null,
  application_form_status: c.application_form_status,
  delivery_notice_status: c.delivery_notice_status,
  deposit_status: (c as any).deposit_status ?? '未対応',
  remaining_payment_status: (c as any).remaining_payment_status ?? '未対応',
  invoice_status: c.invoice_status,
  payment_method: c.payment_method ?? null,
  estimate_amount: c.estimate_amount,
})

const FIELD_LABEL: Record<ProcedureField, string> = {
  preview_datetime: '下見日時',
  application_form_status: '申込みフォーム',
  delivery_notice_status: '搬入出届',
  deposit_status: '申込み金',
  remaining_payment_status: '残額支払い',
  invoice_status: '請求書',
  payment_method: '支払い方法',
}

const SELECT_OPTIONS: Record<ProcedureSelectField, readonly string[]> = {
  application_form_status: FORM_STATUS_OPTIONS,
  delivery_notice_status: DELIVERY_STATUS_OPTIONS,
  deposit_status: DEPOSIT_STATUS_OPTIONS,
  remaining_payment_status: REMAINING_PAYMENT_STATUS_OPTIONS,
  invoice_status: INVOICE_STATUS_OPTIONS,
  payment_method: PAYMENT_METHOD_OPTIONS,
}

const StatusPill = ({
  value,
  okValues,
  progressValues = [],
}: {
  value: string
  okValues: string[]
  progressValues?: string[]
}) => {
  const isOk = okValues.includes(value)
  const isProgress = progressValues.includes(value)
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
      isOk
        ? 'border-green-200 bg-green-50 text-green-700'
        : isProgress
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-orange-200 bg-orange-50 text-orange-700'
    )}>
      {value}
    </span>
  )
}

const Row = ({
  label,
  editing = false,
  children,
}: {
  label: string
  /** 編集中は label の下に編集欄を全幅で出す（スマホ）。sm 以上は従来どおり横並び */
  editing?: boolean
  children: React.ReactNode
}) => (
  <div className={cn(
    'flex justify-between gap-2 py-2.5 border-b border-border last:border-0',
    editing ? 'flex-col items-stretch sm:flex-row sm:items-center' : 'items-center'
  )}>
    {/* スマホ: w-24、PC(sm以上): w-40 */}
    <span className="text-sm text-muted-foreground shrink-0 w-24 sm:w-40">{label}</span>
    <div className={cn(
      'text-sm font-medium',
      editing
        ? 'flex flex-wrap items-center gap-2 sm:justify-end'
        : 'flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right'
    )}>
      {children}
    </div>
  </div>
)

const INP = 'rounded-md border border-input bg-background px-3 py-1.5 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-ring'
const SMALL_BTN = 'inline-flex items-center rounded-md border border-input bg-background px-2.5 py-1 text-xs font-normal text-muted-foreground hover:bg-muted disabled:opacity-50'

export function CaseDetailProcedure({ caseData: c, caseId, isEditable = false }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<Values>(() => pickValues(c))
  // 編集中の項目は常に 1 つだけ（別項目の編集を始めると前の入力は破棄される）
  const [editing, setEditing] = useState<{ field: ProcedureField; mode: 'edit' | 'clear' } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // サーバーから再取得された値（router.refresh 後など）を反映する
  const serverKey = JSON.stringify(pickValues(c))
  useEffect(() => {
    setValues(JSON.parse(serverKey))
  }, [serverKey])

  const startEdit = (field: ProcedureField) => {
    if (saving) return
    if (field === 'preview_datetime') setDraft(toPreviewInputValue(values.preview_datetime))
    else setDraft(String(values[field] ?? ''))
    setEditing({ field, mode: 'edit' })
  }

  const cancelEdit = () => {
    if (saving) return
    setEditing(null)
  }

  /** 既存の案件更新 API（PUT /api/cases/[id]・部分更新）で 1 項目だけ保存する */
  const save = async (field: ProcedureField, value: string | null) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? `${FIELD_LABEL[field]}の更新に失敗しました`, { duration: 6000 })
        return
      }
      const updated = await res.json().catch(() => null)
      // 画面はその場で更新する（保存後のDB値を優先、取れない場合は送信値）
      setValues((prev) => ({ ...prev, [field]: updated && field in updated ? updated[field] : value }))
      setEditing(null)
      toast.success(
        field === 'preview_datetime' && value === null
          ? '下見日時を解除しました'
          : `${FIELD_LABEL[field]}を更新しました`
      )
      router.refresh()
    } catch {
      toast.error(`${FIELD_LABEL[field]}の更新に失敗しました`)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSelect = (field: ProcedureSelectField) => {
    const result = validateProcedureSelect(field, draft)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    save(field, result.value)
  }

  const handleSavePreview = () => {
    const result = validatePreviewDateTime(draft)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    save('preview_datetime', result.value)
  }

  const saveCancelButtons = (onSave: () => void) => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground sm:text-xs hover:opacity-90 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        保存
      </button>
      <button type="button" onClick={cancelEdit} disabled={saving} className={cn(SMALL_BTN, 'py-1.5 text-sm sm:text-xs')}>
        キャンセル
      </button>
    </div>
  )

  /** プルダウン項目 1 行（通常: 値表示 + 変更ボタン / 編集: select + 保存・キャンセル） */
  const SelectRow = ({
    field,
    okValues,
    progressValues,
  }: {
    field: ProcedureSelectField
    okValues?: string[]
    progressValues?: string[]
  }) => {
    const label = FIELD_LABEL[field]
    const current = (values[field] ?? '') as string
    const isEditing = editing?.field === field

    if (isEditing) {
      const options = SELECT_OPTIONS[field]
      // 旧データ（選択肢に無い現在値）も選べるように残す
      const legacy = current && !options.includes(current) ? current : null
      return (
        <Row label={label} editing>
          <select
            aria-label={`${label}を選択`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className={cn(INP, 'cursor-pointer min-w-0 max-w-full sm:w-64')}
          >
            {field === 'payment_method' && <option value="">選択してください</option>}
            {options.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
            {legacy && <option value={legacy}>{legacy}（旧）</option>}
          </select>
          {saveCancelButtons(() => handleSaveSelect(field))}
        </Row>
      )
    }

    return (
      <Row label={label}>
        {field === 'payment_method' ? (
          <span>{current || '—'}</span>
        ) : (
          <StatusPill value={current} okValues={okValues ?? ['済み']} progressValues={progressValues} />
        )}
        {isEditable && (
          <button type="button" onClick={() => startEdit(field)} disabled={saving} className={SMALL_BTN}>
            変更
          </button>
        )}
      </Row>
    )
  }

  const previewEditing = editing?.field === 'preview_datetime'

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">③ 確認手続き</h2>
      </div>
      <div className="px-5 py-1">
        {/* 下見日時：未設定なら「設定」、設定済みなら「変更」「解除」 */}
        {previewEditing && editing?.mode === 'edit' ? (
          <Row label="下見日時" editing>
            <PreviewDateTimeSelect value={draft} onChange={setDraft} />
            {saveCancelButtons(handleSavePreview)}
          </Row>
        ) : previewEditing && editing?.mode === 'clear' ? (
          <Row label="下見日時" editing>
            <span className="text-sm font-normal text-muted-foreground">
              {formatPreviewDateTime(values.preview_datetime)} の下見日時を解除しますか？
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => save('preview_datetime', null)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground sm:text-xs hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                解除する
              </button>
              <button type="button" onClick={cancelEdit} disabled={saving} className={cn(SMALL_BTN, 'py-1.5 text-sm sm:text-xs')}>
                キャンセル
              </button>
            </div>
          </Row>
        ) : (
          <Row label="下見日時">
            <span>{formatPreviewDateTime(values.preview_datetime)}</span>
            {isEditable && (
              <>
                <button type="button" onClick={() => startEdit('preview_datetime')} disabled={saving} className={SMALL_BTN}>
                  {values.preview_datetime ? '変更' : '設定'}
                </button>
                {values.preview_datetime && (
                  <button
                    type="button"
                    onClick={() => !saving && setEditing({ field: 'preview_datetime', mode: 'clear' })}
                    disabled={saving}
                    className={SMALL_BTN}
                  >
                    解除
                  </button>
                )}
              </>
            )}
          </Row>
        )}
        <Row label="見積金額（税込）">
          <span className={values.estimate_amount > 0 ? 'text-green-700 font-bold' : ''}>
            {values.estimate_amount > 0 ? formatCurrency(values.estimate_amount) : '—'}
          </span>
        </Row>
        {SelectRow({ field: 'application_form_status', okValues: ['済み'] })}
        {SelectRow({ field: 'delivery_notice_status', okValues: ['済み'] })}
        {SelectRow({ field: 'deposit_status', okValues: ['済み'], progressValues: ['請求書送付済み'] })}
        {SelectRow({ field: 'remaining_payment_status', okValues: ['済み'], progressValues: ['請求書送付済み'] })}
        {SelectRow({ field: 'invoice_status', okValues: ['振り込み済み', '送付済み'] })}
        {SelectRow({ field: 'payment_method' })}
      </div>
    </section>
  )
}
