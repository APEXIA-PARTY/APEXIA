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

export function CaseForm({ initialData, isEdit = false }: CaseFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

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
    setValue,
    formState: { errors },
  } = useForm<CaseFormValues>({
    resolver: zodResolver(caseFormSchema),
    defaultValues: {
      company: initialData?.company ?? '',
      inquiry_date: initialData?.inquiry_date ?? new Date().toISOString().slice(0, 10),
      estimate_amount: initialData?.estimate_amount ?? 0,
      payment_method: initialData?.payment_method ?? null,
      status: (initialData?.status as any) ?? 'inquiry',
    },
  })

  const watchAmount = watch('estimate_amount')

  useEffect(() => {
    Promise.all([
      fetch('/api/master/media').then(r => r.json()).catch(() => []),
      fetch('/api/master/contact-methods').then(r => r.json()).catch(() => []),
      fetch('/api/master/event-categories').then(r => r.json()).catch(() => []),
      fetch('/api/master/floors').then(r => r.json()).catch(() => []),
      fetch('/api/master/cancel-reasons').then(r => r.json()).catch(() => []),
    ]).then(([media, contact, categories, flr, reasons]) => {
      setMediaList(media || [])
      setContactMethods(contact || [])
      setEventCategories(categories || [])
      setFloors(flr || [])
      setCancelReasons(reasons || [])
      setMastersLoading(false)
    })
  }, [])

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
        toast.error('保存に失敗しました')
        return
      }

      const data = await res.json()
      toast.success('保存しました')
      router.push(`/cases/${data.id}`)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full rounded-md border px-3 py-2'
  const sel = `${inp} cursor-pointer`
  const lbl = 'block text-sm mb-1'
  const sec = 'space-y-4 border p-5 rounded-lg'

  const loadingOpt = mastersLoading
    ? <option value="">読み込み中...</option>
    : <option value="">選択してください</option>

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

      {/* 基本情報 */}
      <section className={sec}>
        <h2>基本情報</h2>

        <div>
          <label className={lbl}>会社名 *</label>
          <input {...register('company')} className={inp} />
        </div>

        <div>
          <label className={lbl}>フロア</label>
          <select {...register('floor_id')} className={sel}>
            {loadingOpt}
            {floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        <div>
          <label className={lbl}>認知経路</label>
          <select {...register('media_id')} className={sel}>
            {loadingOpt}
            {mediaList.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div>
          <label className={lbl}>連絡方法</label>
          <select {...register('contact_method_id')} className={sel}>
            {loadingOpt}
            {contactMethods.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* ★ここが修正ポイント */}
        <div>
          <label className={lbl}>見積金額（税込）</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm">¥</span>

            <input
              type="text"
              value={
                watchAmount
                  ? Number(watchAmount).toLocaleString()
                  : ''
              }
              onChange={(e) => {
                const raw = e.target.value.replace(/,/g, '')
                const num = raw === '' ? 0 : Number(raw)
                if (!isNaN(num)) {
                  setValue('estimate_amount', num)
                }
              }}
              className={`${inp} pl-7`}
            />
          </div>
        </div>

      </section>

      <div className="flex justify-end">
        <button type="submit" disabled={loading}>
          {loading ? '送信中...' : '登録'}
        </button>
      </div>
    </form>
  )
}