'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, Loader2 } from 'lucide-react'

interface Props {
  caseId: string
  eventName: string | null | undefined
  company?: string | null | undefined
  /** icon: 一覧の行内アイコンボタン / button: 詳細画面のテキスト付きボタン */
  variant?: 'icon' | 'button'
  className?: string
}

/**
 * 案件複製ボタン（一覧・詳細で共通使用）
 * 一覧の行が <Link> でラップされている場合があるため、
 * クリック時は必ず preventDefault + stopPropagation で親要素への伝播を止める。
 */
export function DuplicateCaseButton({ caseId, eventName, company, variant = 'button', className }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleDuplicate = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (loading) return

    const confirmed = window.confirm(
      'この案件を複製しますか？\n\n' +
        '開催日、ステータス、見積金額、支払い状況、\n' +
        '申込みフォーム状況、搬入出届状況、請求書状況、\n' +
        '下見情報、Googleカレンダー情報は引き継がれません。'
    )
    if (!confirmed) return

    setLoading(true)
    try {
      const res = await fetch(`/api/cases/${caseId}/duplicate`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '複製に失敗しました')
        return
      }
      const newCase = await res.json().catch(() => null)
      if (!newCase?.id) {
        toast.error('複製結果の取得に失敗しました')
        return
      }
      toast.success('案件を複製しました。案件名と開催日を確認してください。')
      router.push(`/cases/${newCase.id}/edit`)
    } finally {
      setLoading(false)
    }
  }

  const label = eventName || company || '（名称なし）'

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleDuplicate}
        disabled={loading}
        title="複製"
        aria-label={`「${label}」を複製`}
        className={
          className ??
          'inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50'
        }
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleDuplicate}
      disabled={loading}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50'
      }
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
      複製
    </button>
  )
}
