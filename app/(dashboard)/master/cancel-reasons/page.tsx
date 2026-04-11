'use client'

import { useState, useEffect } from 'react'
import { MasterPageShell, MasterPageConfig } from '@/components/master/MasterPageShell'
import { cancelReasonSchema } from '@/lib/validations/master'

type CancelReasonItem = {
  id: string; name: string; is_auto_cancel: boolean; display_order: number; is_active: boolean
}

const config: MasterPageConfig<CancelReasonItem> = {
  title: 'キャンセル理由マスタ',
  description: 'キャンセル理由を管理します。「自動キャンセル用」フラグの理由は、開催日経過による自動キャンセル時に使用されます。',
  apiPath: '/api/master/cancel-reasons',
  schema: cancelReasonSchema,
  columns: [
    { key: 'name', label: '理由' },
    {
      key: 'is_auto_cancel',
      label: '自動キャンセル用',
      render: (item) => item.is_auto_cancel
        ? <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">自動キャンセル専用</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: 'is_active', label: '状態',
      render: (item) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'}`}>
          {item.is_active ? '有効' : '無効'}
        </span>
      ),
    },
  ],
  fields: [
    { name: 'name', label: '理由名', type: 'text', required: true, placeholder: '予算合わず' },
    { name: 'is_auto_cancel', label: '自動キャンセル用', type: 'toggle', hint: '有効にすると自動キャンセル処理で使用されます（原則1件のみ）' },
    { name: 'display_order', label: '表示順', type: 'number' },
    { name: 'is_active', label: '有効', type: 'toggle' },
  ],
  rowWarning: (item) =>
    item.is_auto_cancel
      ? '自動キャンセル処理で使用される理由です。削除・変更にはご注意ください'
      : null,
}

export default function CancelReasonsPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    fetch('/api/auth/role')
      .then(r => r.ok ? r.json() : { role: null })
      .then(d => setIsAdmin(d?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])
  return <MasterPageShell config={config} isAdmin={isAdmin} />
}