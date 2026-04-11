'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { caseFormSchema, CaseFormValues } from '@/lib/validations/case'
import { STATUS_LIST, INVOICE_STATUS_OPTIONS, PAYMENT_METHOD_OPTIONS } from '@/lib/constants/status'
import { Case } from '@/types/database'

interface CaseFormProps {
  initialData?: Partial<Case>
  isEdit?: boolean
}

type MasterItem = { id: string; name: string }
type SubcategoryItem = MasterItem & { category_id: string }

// ─── 15分刻み時刻セレクタ ─────────────────────────────────────────
// input[type=time] + step属性だとブラウザ依存になるため、
// 時・分を別セレクトで実装し HH:MM 文字列に組み立てる

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

interface TimeSelectProps {
  value: string | null | undefined
  onChange: (v: string | null) => void
  disabled?: boolean
}

function TimeSelect({ value, onChange, disabled }: TimeSelectProps) {
  const [h, setH] = useState('')
  const [m, setM] = useState('00')

  // 外部値 → ローカル state に反映
  useEffect(() => {
    if (value && /^\d{2}:\d{2}$/.test(value)) {
      setH(value.slice(0, 2))
      setM(value.slice(3, 5))
    } else {
      setH('')
      setM('00')
    }
  }, [value])

  const handleHour = (newH: string) => {
    setH(newH)
    if (newH === '') {
      onChange(null)
    } else {
      const newM = MINUTES.includes(m) ? m : '00'
      setM(newM)
      onChange(`${newH}:${newM}`)
    }
  }

  const handleMinute = (newM: string) => {
    setM(newM)
    if (h !== '') onChange(`${h}:${newM}`)
  }

  const sel = 'rounded-md border border-input bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer disabled:opacity-50'

  return (
    <div className="flex items-center gap-1">
      <select
        value={h}
        onChange={(e) => handleHour(e.target.value)}
        disabled={disabled}
        className={`${sel} w-20`}
      >
        <option value="">--</option>
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>{hh}</option>
        ))}
      </select>
      <span className="text-muted-foreground text-sm font-medium">:</span>
      <select
        value={m}
        onChange={(e) => handleMinute(e.target.value)}
        disabled={disabled || h === ''}
        className={`${sel} w-16`}
      >
        {MINUTES.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
      </select>
      {h !== '' && (
        <button
          type="button"
          onClick={() => { setH(''); setM('00'); onChange(null) }}
          className="ml-1 text-xs text-muted-foreground hover:text-destructive"
          tabIndex={-1}
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ─── 下見日時セレクタ（日付 + 時・分15分刻み） ────────────────────
interface DateTimeSelectProps {
  value: string | undefined
  onChange: (v: string) => void
}

function PreviewDateTimeSelect({ value, onChange }: DateTimeSelectProps) {
  const datePart = value?.slice(0, 10) ?? ''
  const timePart = value?.slice(11, 16) ?? ''
  const timeH = timePart.slice(0, 2) || ''
  const timeM = timePart.slice(3, 5) || '00'

  const [localH, setLocalH] = useState(timeH)
  const [localM, setLocalM] = useState(MINUTES.includes(timeM) ? timeM : '00')

  useEffect(() => {
    const h = value?.slice(11, 13) ?? ''
    const m = value?.slice(14, 16) ?? '00'
    setLocalH(h)
    setLocalM(MINUTES.includes(m) ? m : '00')
  }, [value])

  const emit = (d: string, h: string, mi: string) => {
    if (!d) { onChange(''); return }
    if (!h) { onChange(d); return }
    onChange(`${d}T${h}:${mi}`)
  }

  const inp = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const sel = `${inp} cursor-pointer`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={datePart}
        onChange={(e) => { emit(e.target.value, localH, localM) }}
        className={`${inp} w-40`}
      />
      <div className="flex items-center gap-1">
        <select value={localH} onChange={(e) => { setLocalH(e.target.value); emit(datePart, e.target.value, localM) }} className={`${sel} w-20`}>
          <option value="">--時</option>
          {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="text-muted-foreground text-sm">:</span>
        <select value={localM} onChange={(e) => { setLocalM(e.target.value); emit(datePart, localH, e.target.value) }} disabled={!localH} className={`${sel} w-16`}>
          {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── メインフォーム ───────────────────────────────────────────────
export function CaseForm({ initialData, isEdit = false }: CaseFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // マスタデータ
  const [mediaList, setMediaList] = useState<MasterItem[]>([])
  const [contactMethods, setContactMethods] = useState<MasterItem[]>([])
  const [eventCategories, setEventCategories] = useState<MasterItem[]>([])
  const [eventSubcategories, setEventSubcategories] = useState<SubcategoryItem[]>([])
  const [floors, setFloors] = useState<MasterItem[]>([])
  const [cancelReasons, setCancelReasons] = useState<MasterItem[]>([])
  const [mastersLoading, setMastersLoading] = useState(true)

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<CaseFormValues>({
    resolver: zodResolver(caseFormSchema),
    defaultValues: {
      company: initialData?.company ?? '',
      contact: initialData?.contact ?? '',
      phone: initialData?.phone ?? '',
      email: initialData?.email ?? '',
      inquiry_date: initialData?.inquiry_date ?? new Date().toISOString().slice(0, 10),
      event_date: initialData?.event_date ?? '',
      event_name: initialData?.event_name ?? '',
      guest_count: initialData?.guest_count ?? undefined,
      notes: initialData?.notes ?? '',
      estimate_amount: initialData?.estimate_amount ?? 0,
      media_id: initialData?.media_id ?? '',
      contact_method_id: initialData?.contact_method_id ?? '',
      floor_id: initialData?.floor_id ?? '',
      event_category_id: initialData?.event_category_id ?? '',
      event_subcategory_id: initialData?.event_subcategory_id ?? '',
      event_subcategory_note: initialData?.event_subcategory_note ?? '',
      // 時刻フィールド: DB値（HH:MM）をそのまま初期値に。空の場合は空文字
      load_in_time: initialData?.load_in_time ?? '',
      setup_time: initialData?.setup_time ?? '',
      rehearsal_time: initialData?.rehearsal_time ?? '',
      start_time: initialData?.start_time ?? '',
      end_time: initialData?.end_time ?? '',
      strike_time: initialData?.strike_time ?? '',
      full_exit_time: initialData?.full_exit_time ?? '',
      preview_datetime: initialData?.preview_datetime?.slice(0, 16) ?? '',
      application_form_status: initialData?.application_form_status ?? '未対応',
      delivery_notice_status: initialData?.delivery_notice_status ?? '未対応',
      invoice_status: initialData?.invoice_status ?? '未対応',
      payment_method: initialData?.payment_method ?? null,
      status: (initialData?.status as any) ?? 'inquiry',
      cancel_reason_id: initialData?.cancel_reason_id ?? '',
      cancel_note: initialData?.cancel_note ?? '',
    },
  })

  const watchStatus = watch('status')
  const watchCategoryId = watch('event_category_id')
  const watchSubcategoryId = watch('event_subcategory_id')

  const isSubcategoryOther =
    !!watchSubcategoryId &&
    watchSubcategoryId !== '' &&
    eventSubcategories.find((s) => s.id === watchSubcategoryId)?.name === 'その他'

  // ─── マスタ取得 ─────────────────────────────────────────────────
  useEffect(() => {
    const safeJson = async (res: Response) => {
      if (!res.ok) return []
      const d = await res.json().catch(() => [])
      return Array.isArray(d) ? d : []
    }
    Promise.all([
      fetch('/api/master/media').then(safeJson).catch(() => []),
      fetch('/api/master/contact-methods').then(safeJson).catch(() => []),
      fetch('/api/master/event-categories').then(safeJson).catch(() => []),
      fetch('/api/master/floors').then(safeJson).catch(() => []),
      fetch('/api/master/cancel-reasons').then(safeJson).catch(() => []),
    ]).then(([media, contact, categories, flr, reasons]) => {
      setMediaList(media)
      setContactMethods(contact)
      setEventCategories(categories)
      setFloors(flr)
      setCancelReasons(reasons)
      setMastersLoading(false)
    })
  }, [])

  // 大分類変更時に中分類を取得
  useEffect(() => {
    if (!watchCategoryId || watchCategoryId === '') {
      setEventSubcategories([])
      return
    }
    fetch(`/api/master/event-subcategories?category_id=${watchCategoryId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setEventSubcategories(Array.isArray(d) ? d : []))
      .catch(() => setEventSubcategories([]))
  }, [watchCategoryId])

  // ─── 送信 ────────────────────────────────────────────────────────
  const onSubmit = async (values: CaseFormValues) => {
    setLoading(true)
    try {
      const url = isEdit ? `/api/cases/${initialData?.id}` : '/api/cases'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        toast.error(errBody.message ?? '保存に失敗しました')
        return
      }
      const data = await res.json().catch(() => ({}))
      toast.success(isEdit ? '案件を更新しました' : '案件を登録しました')
      // data.id が取れない場合は一覧にフォールバック
      router.push(data?.id ? `/cases/${data.id}` : '/cases')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  // ─── スタイル ────────────────────────────────────────────────────
  const inp = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const sel = `${inp} cursor-pointer`
  const lbl = 'block text-sm font-medium text-foreground mb-1'
  const errCls = 'mt-1 text-xs text-destructive'
  const sec = 'rounded-lg border border-border bg-card p-5 space-y-4'
  const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2'
  const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-3'

  // マスタ読み込み中のプレースホルダーオプション
  const loadingOpt = mastersLoading
    ? <option value="" disabled>読み込み中...</option>
    : <option value="">選択してください</option>

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>

      {/* ① 基本情報 */}
      <section className={sec}>
        <h2 className="font-semibold text-foreground">① 基本情報</h2>

        {/* 会社名（必須） */}
        <div>
          <label className={lbl}>
            会社名 / 団体名 <span className="text-destructive">*</span>
          </label>
          <input {...register('company')} className={inp} placeholder="株式会社〇〇" />
          {errors.company && <p className={errCls}>{errors.company.message}</p>}
        </div>

        {/* 担当者・電話 */}
        <div className={grid2}>
          <div>
            <label className={lbl}>担当者名</label>
            <input {...register('contact')} className={inp} placeholder="山田 太郎" />
          </div>
          <div>
            <label className={lbl}>電話番号</label>
            <input {...register('phone')} type="tel" className={inp} placeholder="03-0000-0000" />
          </div>
        </div>

        {/* メール */}
        <div>
          <label className={lbl}>メールアドレス</label>
          <input {...register('email')} type="email" className={inp} placeholder="example@company.com" />
          {errors.email && <p className={errCls}>{errors.email.message}</p>}
        </div>

        {/* 問合せ日・開催日・参加人数 */}
        <div className={grid3}>
          <div>
            <label className={lbl}>
              問合せ日 <span className="text-destructive">*</span>
            </label>
            <input {...register('inquiry_date')} type="date" className={inp} />
            {errors.inquiry_date && <p className={errCls}>{errors.inquiry_date.message}</p>}
          </div>
          <div>
            <label className={lbl}>開催日</label>
            <input {...register('event_date')} type="date" className={inp} />
          </div>
          <div>
            <label className={lbl}>予定参加人数</label>
            <div className="relative">
              <input
                {...register('guest_count', {
                  setValueAs: (v: string) => v === '' ? undefined : Number(v),
                })}
                type="number"
                min="0"
                className={`${inp} pr-8`}
                placeholder="0"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">名</span>
            </div>
          </div>
        </div>

        {/* イベント名 */}
        <div>
          <label className={lbl}>イベント名</label>
          <input {...register('event_name')} className={inp} placeholder="例: 〇〇社創立30周年パーティー" />
        </div>

        {/* フロア・認知経路 */}
        <div className={grid2}>
          <div>
            <label className={lbl}>フロア</label>
            <select {...register('floor_id')} className={sel}>
              {loadingOpt}
              {floors.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {floors.length === 0 && !mastersLoading && (
              <p className="mt-1 text-xs text-orange-500">※ マスタ未投入（seed SQL実行が必要）</p>
            )}
          </div>
          <div>
            <label className={lbl}>認知経路</label>
            <select {...register('media_id')} className={sel}>
              {loadingOpt}
              {mediaList.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {mediaList.length === 0 && !mastersLoading && (
              <p className="mt-1 text-xs text-orange-500">※ マスタ未投入（seed SQL実行が必要）</p>
            )}
          </div>
        </div>

        {/* 連絡方法・見積金額 */}
        <div className={grid2}>
          <div>
            <label className={lbl}>連絡方法</label>
            <select {...register('contact_method_id')} className={sel}>
              {loadingOpt}
              {contactMethods.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {contactMethods.length === 0 && !mastersLoading && (
              <p className="mt-1 text-xs text-orange-500">※ マスタ未投入（seed SQL実行が必要）</p>
            )}
          </div>
          <div>
            {/* B. 見積金額: ¥ + 3桁カンマ表示、DB保存は数値 */}
            <label className={lbl}>見積金額（税込）</label>
            <Controller
              name="estimate_amount"
              control={control}
              render={({ field }) => {
                // 表示用: 数値 → カンマ区切り文字列
                const displayValue =
                  field.value !== undefined && field.value !== null && !isNaN(Number(field.value))
                    ? Number(field.value).toLocaleString('ja-JP')
                    : ''
                return (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">¥</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={displayValue}
                      onChange={(e) => {
                        // カンマ・空白を除去して数値化
                        const raw = e.target.value.replace(/[,，\s]/g, '')
                        if (raw === '') {
                          field.onChange(0)
                        } else {
                          const n = Number(raw)
                          if (!isNaN(n) && n >= 0) field.onChange(n)
                        }
                      }}
                      className={`${inp} pl-7`}
                      placeholder="0"
                    />
                  </div>
                )
              }}
            />
          </div>
        </div>

        {/* イベント大分類・中分類 */}
        <div className={grid2}>
          <div>
            <label className={lbl}>イベント大分類</label>
            <select {...register('event_category_id')} className={sel}>
              {loadingOpt}
              {eventCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {eventCategories.length === 0 && !mastersLoading && (
              <p className="mt-1 text-xs text-orange-500">※ マスタ未投入（seed SQL実行が必要）</p>
            )}
          </div>
          <div>
            <label className={lbl}>
              イベント中分類
              {!watchCategoryId && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">（大分類を先に選択）</span>
              )}
            </label>
            <select
              {...register('event_subcategory_id')}
              className={sel}
              disabled={!watchCategoryId || watchCategoryId === ''}
            >
              <option value="">選択してください</option>
              {eventSubcategories.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 中分類「その他」のみ: 自由入力欄 */}
        {isSubcategoryOther && (
          <div>
            <label className={lbl}>
              中分類その他 — 詳細
              <span className="ml-1 text-xs font-normal text-muted-foreground">（「その他」を選択した場合に入力）</span>
            </label>
            <input
              {...register('event_subcategory_note')}
              className={inp}
              placeholder="例: 音楽ライブ、コスプレイベントなど"
            />
          </div>
        )}

        {/* 備考 */}
        <div>
          <label className={lbl}>備考</label>
          <textarea {...register('notes')} rows={3} className={inp} placeholder="その他の情報・連絡事項など" />
        </div>

        {/* ステータス */}
        <div className={grid2}>
          <div>
            <label className={lbl}>ステータス</label>
            <select {...register('status')} className={sel}>
              {STATUS_LIST.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* キャンセル時のみ表示 */}
        {watchStatus === 'cancelled' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <p className="text-sm font-medium text-destructive">キャンセル情報</p>
            <div>
              <label className={lbl}>
                キャンセル理由 <span className="text-destructive">*</span>
              </label>
              <select {...register('cancel_reason_id')} className={sel}>
                <option value="">選択してください</option>
                {cancelReasons.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>キャンセル備考</label>
              <textarea {...register('cancel_note')} rows={2} className={inp} />
            </div>
          </div>
        )}
      </section>

      {/* ② タイムスケジュール */}
      <section className={sec}>
        <h2 className="font-semibold text-foreground">② タイムスケジュール</h2>
        <p className="text-xs text-muted-foreground">
          時間は 00・15・30・45 分単位で選択できます。未定の場合は空欄のままでOKです。
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            { name: 'load_in_time', label: '入り' },
            { name: 'setup_time', label: '搬入 / 準備' },
            { name: 'rehearsal_time', label: 'リハ' },
            { name: 'start_time', label: '開始' },
            { name: 'end_time', label: '終了' },
            { name: 'strike_time', label: '片付け / 撤収' },
            { name: 'full_exit_time', label: '完全撤収' },
          ] as const).map((f) => (
            <div key={f.name}>
              <label className={lbl}>{f.label}</label>
              {/* C. 分を15分刻みにするカスタムセレクタ */}
              <Controller
                name={f.name}
                control={control}
                render={({ field }) => (
                  <TimeSelect
                    value={field.value as string | null | undefined}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors[f.name] && (
                <p className={errCls}>{String(errors[f.name]?.message)}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ③ 確認手続き */}
      <section className={sec}>
        <h2 className="font-semibold text-foreground">③ 確認手続き</h2>
        <div className={grid2}>
          <div>
            {/* C. 下見日時も15分刻み */}
            <label className={lbl}>下見日時</label>
            <Controller
              name="preview_datetime"
              control={control}
              render={({ field }) => (
                <PreviewDateTimeSelect
                  value={field.value as string | undefined}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div>
            <label className={lbl}>支払い方法</label>
            <select {...register('payment_method')} className={sel}>
              <option value="">選択してください</option>
              {PAYMENT_METHOD_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={grid3}>
          <div>
            <label className={lbl}>申込みフォーム</label>
            <select {...register('application_form_status')} className={sel}>
              <option value="未対応">未対応</option>
              <option value="済み">済み</option>
            </select>
          </div>
          <div>
            <label className={lbl}>搬入出届</label>
            <select {...register('delivery_notice_status')} className={sel}>
              <option value="未対応">未対応</option>
              <option value="済み">済み</option>
            </select>
          </div>
          <div>
            <label className={lbl}>請求書</label>
            <select {...register('invoice_status')} className={sel}>
              {INVOICE_STATUS_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 送信ボタン */}
      <div className="flex items-center justify-end gap-3 rounded-lg border border-border bg-card p-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-input px-4 py-2 text-sm hover:bg-muted"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? '更新する' : '登録する'}
        </button>
      </div>
    </form>
  )
}
