'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
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

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CaseFormValues>({
    resolver: zodResolver(caseFormSchema),
    defaultValues: {
      company:                  initialData?.company ?? '',
      contact:                  initialData?.contact ?? '',
      phone:                    initialData?.phone ?? '',
      email:                    initialData?.email ?? '',
      inquiry_date:             initialData?.inquiry_date ?? new Date().toISOString().slice(0, 10),
      event_date:               initialData?.event_date ?? '',
      event_name:               initialData?.event_name ?? '',
      guest_count:              initialData?.guest_count ?? undefined,
      notes:                    initialData?.notes ?? '',
      estimate_amount:          initialData?.estimate_amount ?? 0,
      media_id:                 initialData?.media_id ?? null,
      contact_method_id:        initialData?.contact_method_id ?? null,
      floor_id:                 initialData?.floor_id ?? null,
      event_category_id:        initialData?.event_category_id ?? null,
      event_subcategory_id:     initialData?.event_subcategory_id ?? null,
      event_subcategory_note:   initialData?.event_subcategory_note ?? '',
      load_in_time:             initialData?.load_in_time ?? null,
      setup_time:               initialData?.setup_time ?? null,
      rehearsal_time:           initialData?.rehearsal_time ?? null,
      start_time:               initialData?.start_time ?? null,
      end_time:                 initialData?.end_time ?? null,
      strike_time:              initialData?.strike_time ?? null,
      full_exit_time:           initialData?.full_exit_time ?? null,
      preview_datetime:         initialData?.preview_datetime?.slice(0, 16) ?? '',
      application_form_status:  initialData?.application_form_status ?? '未対応',
      delivery_notice_status:   initialData?.delivery_notice_status ?? '未対応',
      invoice_status:           initialData?.invoice_status ?? '未対応',
      payment_method:           initialData?.payment_method ?? null,
      status:                   (initialData?.status as any) ?? 'inquiry',
      cancel_reason_id:         initialData?.cancel_reason_id ?? null,
      cancel_note:              initialData?.cancel_note ?? '',
    },
  })

  const watchStatus        = watch('status')
  const watchCategoryId    = watch('event_category_id')
  const watchSubcategoryId = watch('event_subcategory_id')

  // 選択中の中分類が「その他」かどうか
  const isSubcategoryOther =
    watchSubcategoryId !== null &&
    watchSubcategoryId !== '' &&
    eventSubcategories.find((s) => s.id === watchSubcategoryId)?.name === 'その他'

  // マスタ取得
  useEffect(() => {
    const fetchMasters = async () => {
      const safeJson = async (res: Response) => {
        if (!res.ok) return []
        const d = await res.json().catch(() => [])
        return Array.isArray(d) ? d : []
      }
      const [media, contact, categories, floors, reasons] = await Promise.all([
        fetch('/api/master/media').then(safeJson).catch(() => []),
        fetch('/api/master/contact-methods').then(safeJson).catch(() => []),
        fetch('/api/master/event-categories').then(safeJson).catch(() => []),
        fetch('/api/master/floors').then(safeJson).catch(() => []),
        fetch('/api/master/cancel-reasons').then(safeJson).catch(() => []),
      ])
      setMediaList(media)
      setContactMethods(contact)
      setEventCategories(categories)
      setFloors(floors)
      setCancelReasons(reasons)
    }
    fetchMasters()
  }, [])

  // 大分類変更時に中分類を取得
  useEffect(() => {
    if (!watchCategoryId) { setEventSubcategories([]); return }
    fetch(`/api/master/event-subcategories?category_id=${watchCategoryId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setEventSubcategories(Array.isArray(d) ? d : []))
      .catch(() => setEventSubcategories([]))
  }, [watchCategoryId])

  const onSubmit = async (values: CaseFormValues) => {
    setLoading(true)
    try {
      const url    = isEdit ? `/api/cases/${initialData?.id}` : '/api/cases'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.message ?? '保存に失敗しました')
        return
      }
      const data = await res.json()
      toast.success(isEdit ? '案件を更新しました' : '案件を登録しました')
      router.push(`/cases/${data.id}`)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  // ─── スタイル定義 ───────────────────────────────────────────
  const inp = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const sel = `${inp} cursor-pointer`
  const lbl = 'block text-sm font-medium text-foreground mb-1'
  const err = 'mt-1 text-xs text-destructive'
  const sec = 'rounded-lg border border-border bg-card p-5 space-y-4'
  const grid2 = 'grid grid-cols-1 gap-4 sm:grid-cols-2'
  const grid3 = 'grid grid-cols-1 gap-4 sm:grid-cols-3'

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

      {/* ① 基本情報 */}
      <section className={sec}>
        <h2 className="font-semibold text-foreground">① 基本情報</h2>
        <div>
          <label className={lbl}>会社名 / 団体名 <span className="text-destructive">*</span></label>
          <input {...register('company')} className={inp} placeholder="株式会社〇〇" />
          {errors.company && <p className={err}>{errors.company.message}</p>}
        </div>
        <div className={grid2}>
          <div>
            <label className={lbl}>担当者名</label>
            <input {...register('contact')} className={inp} />
          </div>
          <div>
            <label className={lbl}>電話番号</label>
            <input {...register('phone')} type="tel" className={inp} />
          </div>
        </div>
        <div>
          <label className={lbl}>メールアドレス</label>
          <input {...register('email')} type="email" className={inp} />
          {errors.email && <p className={err}>{errors.email.message}</p>}
        </div>
        <div className={grid3}>
          <div>
            <label className={lbl}>問合せ日 <span className="text-destructive">*</span></label>
            <input {...register('inquiry_date')} type="date" className={inp} />
            {errors.inquiry_date && <p className={err}>{errors.inquiry_date.message}</p>}
          </div>
          <div>
            <label className={lbl}>開催日</label>
            <input {...register('event_date')} type="date" className={inp} />
          </div>
          <div>
            <label className={lbl}>予定参加人数</label>
            <input {...register('guest_count', { valueAsNumber: true })} type="number" min="0" className={inp} placeholder="名" />
          </div>
        </div>
        <div>
          <label className={lbl}>イベント名</label>
          <input {...register('event_name')} className={inp} />
        </div>
        <div className={grid2}>
          <div>
            <label className={lbl}>フロア</label>
            <select {...register('floor_id')} className={sel}>
              <option value="">選択してください</option>
              {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>認知経路</label>
            <select {...register('media_id')} className={sel}>
              <option value="">選択してください</option>
              {mediaList.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div className={grid2}>
          <div>
            <label className={lbl}>連絡方法</label>
            <select {...register('contact_method_id')} className={sel}>
              <option value="">選択してください</option>
              {contactMethods.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>見積金額（税込）</label>
            <input {...register('estimate_amount', { valueAsNumber: true })} type="number" min="0" className={inp} />
          </div>
        </div>
        <div className={grid2}>
          <div>
            <label className={lbl}>イベント大分類</label>
            <select {...register('event_category_id')} className={sel}>
              <option value="">選択してください</option>
              {eventCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>イベント中分類</label>
            <select {...register('event_subcategory_id')} className={sel} disabled={!watchCategoryId}>
              <option value="">選択してください</option>
              {eventSubcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* 中分類「その他」選択時のみ自由入力欄を表示 */}
        {isSubcategoryOther && (
          <div>
            <label className={lbl}>
              中分類その他 — 詳細入力
              <span className="ml-1 text-xs font-normal text-muted-foreground">（「その他」を選択した場合に入力）</span>
            </label>
            <input
              {...register('event_subcategory_note')}
              className={inp}
              placeholder="例: 音楽ライブ、コスプレイベントなど"
            />
          </div>
        )}
        <div>
          <label className={lbl}>備考</label>
          <textarea {...register('notes')} rows={3} className={inp} />
        </div>
        <div className={grid2}>
          <div>
            <label className={lbl}>ステータス</label>
            <select {...register('status')} className={sel}>
              {STATUS_LIST.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {/* キャンセル時のみ表示 */}
        {watchStatus === 'cancelled' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <p className="text-sm font-medium text-destructive">キャンセル情報</p>
            <div>
              <label className={lbl}>キャンセル理由 <span className="text-destructive">*</span></label>
              <select {...register('cancel_reason_id')} className={sel}>
                <option value="">選択してください</option>
                {cancelReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { name: 'load_in_time',   label: '入り' },
            { name: 'setup_time',     label: '搬入 / 準備' },
            { name: 'rehearsal_time', label: 'リハ' },
            { name: 'start_time',     label: '開始' },
            { name: 'end_time',       label: '終了' },
            { name: 'strike_time',    label: '片付け / 撤収' },
            { name: 'full_exit_time', label: '完全撤収' },
          ].map((f) => (
            <div key={f.name}>
              <label className={lbl}>{f.label}</label>
              <input
                {...register(f.name as keyof CaseFormValues)}
                type="time"
                className={inp}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ③ 確認手続き */}
      <section className={sec}>
        <h2 className="font-semibold text-foreground">③ 確認手続き</h2>
        <div className={grid2}>
          <div>
            <label className={lbl}>下見日時</label>
            <input {...register('preview_datetime')} type="datetime-local" className={inp} />
          </div>
          <div>
            <label className={lbl}>支払い方法</label>
            <select {...register('payment_method')} className={sel}>
              <option value="">選択してください</option>
              {PAYMENT_METHOD_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
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
              {INVOICE_STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* ボタン */}
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
