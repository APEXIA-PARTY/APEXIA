'use client'

import { useState, useEffect } from 'react'
import { MasterPageShell, MasterPageConfig } from '@/components/master/MasterPageShell'
import { mediaSchema } from '@/lib/validations/master'

type MediaItem = {
  id: string; name: string; monthly_cost: number | null
  note: string | null; display_order: number; is_active: boolean
}

const config: MasterPageConfig<MediaItem> = {
  title: '認知経路マスタ',
  description: '媒体・認知経路を管理します。月額費用を設定すると費用対効果を集計できます。',
  apiPath: '/api/master/media',
  schema: mediaSchema,
  columns: [
    { key: 'name', label: '名称' },
    {
      key: 'monthly_cost',
      label: '月額費用',
      render: (item) => item.monthly_cost
        ? `¥${item.monthly_cost.toLocaleString()}`
        : <span className="text-muted-foreground text-xs">未設定</span>,
    },
    {
      key: 'note',
      label: '備考',
      render: (item) => item.note
        ? <span className="text-xs text-muted-foreground">{item.note}</span>
        : <span className="text-muted-foreground/40 text-xs">—</span>,
    },
    {
      key: 'is_active',
      label: '状態',
      render: (item) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'
          }`}>
          {item.is_active ? '有効' : '無効'}
        </span>
      ),
    },
  ],
  fields: [
    { name: 'name', label: '名称', type: 'text', required: true, placeholder: 'instabase' },
    { name: 'monthly_cost', label: '月額費用', type: 'number', placeholder: '0', hint: '設定すると費用対効果の分析が可能になります' },
    { name: 'note', label: '備考', type: 'textarea', placeholder: '補足情報など' },
    { name: 'display_order', label: '表示順', type: 'number' },
    { name: 'is_active', label: '有効', type: 'toggle' },
  ],
}

export default function MediaMasterPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    fetch('/api/auth/role')
      .then(r => r.ok ? r.json() : { role: null })
      .then(d => setIsAdmin(d?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])
  return <MasterPageShell config={config} isAdmin={isAdmin} />
}