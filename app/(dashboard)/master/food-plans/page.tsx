'use client'

import { useState, useEffect } from 'react'
import { MasterPageShell, MasterPageConfig } from '@/components/master/MasterPageShell'
import { foodPlanSchema } from '@/lib/validations/master'

type FoodPlanItem = {
  id: string; name: string
  display_order: number; is_active: boolean
}

const config: MasterPageConfig<FoodPlanItem> = {
  title: '飲食プランマスタ',
  description: '飲食プランの選択肢を管理します。案件の飲食プラン選択に使用されます。',
  apiPath: '/api/master/food-plans',
  schema: foodPlanSchema,
  columns: [
    { key: 'name', label: '名称' },
    {
      key: 'is_active',
      label: '状態',
      render: (item) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          item.is_active ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'
        }`}>
          {item.is_active ? '有効' : '無効'}
        </span>
      ),
    },
  ],
  fields: [
    { name: 'name',          label: '名称',   type: 'text',   required: true, placeholder: '例: 5,000ビュッフェ' },
    { name: 'display_order', label: '表示順', type: 'number' },
    { name: 'is_active',     label: '有効',   type: 'toggle' },
  ],
}

export default function FoodPlanMasterPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    fetch('/api/auth/role')
      .then(r => r.ok ? r.json() : { role: null })
      .then(d => setIsAdmin(d?.role === 'admin'))
      .catch(() => setIsAdmin(false))
  }, [])
  return <MasterPageShell config={config} isAdmin={isAdmin} />
}
