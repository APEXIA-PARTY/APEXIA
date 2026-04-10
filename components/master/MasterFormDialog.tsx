'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ZodSchema } from 'zod'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface FieldDef {
  name: string
  label: string
  type: 'text' | 'number' | 'textarea' | 'select' | 'toggle' | 'hidden'
  placeholder?: string
  options?: { value: string | number | boolean; label: string }[]
  dependsOn?: string         // この field が truthy なら表示
  dependsValue?: string      // dependsOn の値がこれと一致するときに表示
  required?: boolean
  hint?: string
}

interface MasterFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: any) => Promise<boolean>
  schema: ZodSchema
  fields: FieldDef[]
  initialValues?: Record<string, any>
  title: string
  submitLabel?: string
}

const INP = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const LBL = 'block text-sm font-medium text-foreground mb-1'
const ERR = 'mt-1 text-xs text-destructive'

/**
 * マスタ追加/編集共通ダイアログ
 * fields 定義に従って動的にフォームを生成する
 */
export function MasterFormDialog({
  open, onClose, onSubmit, schema, fields, initialValues, title, submitLabel = '保存',
}: MasterFormDialogProps) {
  const {
    register, handleSubmit, watch, reset, setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: initialValues ?? {} })

  // initialValues が変わったらフォームをリセット
  useEffect(() => {
    if (open) reset(initialValues ?? {})
  }, [open, initialValues])  // eslint-disable-line

  if (!open) return null

  const watchValues = watch()

  const isFieldVisible = (field: FieldDef): boolean => {
    if (!field.dependsOn) return true
    const depVal = watchValues[field.dependsOn]
    if (field.dependsValue !== undefined) return String(depVal) === field.dependsValue
    return !!depVal
  }

  const handleFormSubmit = async (values: any) => {
    const ok = await onSubmit(values)
    if (ok) { reset(); onClose() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 px-5 py-5">
          {fields.map((field) => {
            if (!isFieldVisible(field)) return null
            if (field.type === 'hidden') return (
              <input key={field.name} type="hidden" {...register(field.name)} />
            )

            const error = errors[field.name]?.message as string | undefined

            return (
              <div key={field.name}>
                {field.type !== 'toggle' && (
                  <label className={LBL}>
                    {field.label}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </label>
                )}

                {field.type === 'text' && (
                  <input {...register(field.name)} className={INP} placeholder={field.placeholder} />
                )}

                {field.type === 'number' && (
                  <input {...register(field.name, { valueAsNumber: true })} type="number" min="0" className={INP} placeholder={field.placeholder} />
                )}

                {field.type === 'textarea' && (
                  <textarea {...register(field.name)} rows={3} className={cn(INP, 'resize-none')} placeholder={field.placeholder} />
                )}

                {field.type === 'select' && (
                  <select {...register(field.name)} className={cn(INP, 'cursor-pointer')}>
                    <option value="">選択してください</option>
                    {field.options?.map((opt) => (
                      <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
                    ))}
                  </select>
                )}

                {field.type === 'toggle' && (
                  <label className="flex cursor-pointer items-center gap-3">
                    <div className="relative">
                      <input
                        {...register(field.name)}
                        type="checkbox"
                        className="sr-only peer"
                      />
                      <div className="h-5 w-9 rounded-full bg-muted peer-checked:bg-primary transition-colors" />
                      <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                    </div>
                    <span className="text-sm font-medium">{field.label}</span>
                    {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
                  </label>
                )}

                {error && <p className={ERR}>{error}</p>}
                {field.hint && field.type !== 'toggle' && (
                  <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
                )}
              </div>
            )
          })}

          {/* ボタン */}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-input px-4 py-2 text-sm hover:bg-muted">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
