'use client'

import { useState, useEffect } from 'react'
import { MasterPageShell, MasterPageConfig } from '@/components/master/MasterPageShell'
import { eventCategorySchema } from '@/lib/validations/master'
import { MasterItem } from '@/lib/hooks/useMasterData'

const config: MasterPageConfig<MasterItem> = {
  title: 'イベント大分類マスタ',
  description: 'イベントの大カテゴリを管理します。中分類はイベント中分類マスタで管理します。',
  apiPath: '/api/master/event-categories',
  schema: eventCategorySchema,
  columns: [
    { key: 'name', label: '名称' },
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
    { name: 'name', label: '名称', type: 'text', required: true, placeholder: '企業イベント' },
    { name: 'display_order', label: '表示順', type: 'number' },
    { name: 'is_active', label: '有効', type: 'toggle' },
  ],
}

export default function EventCategoriesPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    fetch('/api/auth/role')
      .then(r => r.ok ? r.json() : { role: null })
      .then(d => setIsAdmin(d?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])
  return <MasterPageShell config={config} isAdmin={isAdmin} />
}