'use client'

/**
 * イベント中分類マスタ管理ページ
 * - Client Component として実装（大分類一覧の動的取得が必要なため）
 * - ロールは /api/auth/role から取得
 * - 大分類一覧は /api/master/event-categories から取得し、フォームの選択肢に使用
 */

import { useState, useEffect } from 'react'
import { MasterPageShell } from '@/components/master/MasterPageShell'
import { MasterPageConfig } from '@/components/master/MasterPageShell'
import { eventSubcategorySchema } from '@/lib/validations/master'
import { MasterItem } from '@/lib/hooks/useMasterData'

type SubcategoryItem = MasterItem & {
  category_id: string
  event_category_master?: { id: string; name: string }
}

type CategoryItem = { id: string; name: string }

export default function EventSubcategoriesPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [categories, setCategories] = useState<CategoryItem[]>([])

  useEffect(() => {
    // ロール取得
    fetch('/api/auth/role').then(r => r.ok ? r.json() : {role:null}).then((d) => setIsAdmin(d?.role === 'admin')).catch(() => setIsAdmin(false))

    // 有効な大分類一覧を取得（フォームの選択肢用）
    fetch('/api/master/event-categories').then(r => r.ok ? r.json() : []).then((data: CategoryItem[]) => setCategories(Array.isArray(data) ? data : [])).catch(() => setCategories([]))
  }, [])

  const config: MasterPageConfig<SubcategoryItem> = {
    title: 'イベント中分類マスタ',
    description: '大分類に紐づく中カテゴリを管理します。大分類を先に登録してください。',
    apiPath: '/api/master/event-subcategories',
    schema: eventSubcategorySchema,
    columns: [
      {
        key: 'event_category_master',
        label: '大分類',
        render: (item) => (
          <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {item.event_category_master?.name ?? '—'}
          </span>
        ),
      },
      { key: 'name', label: '中分類名称' },
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
      {
        name: 'category_id',
        label: '大分類',
        type: 'select',
        required: true,
        options: categories.map((c) => ({ value: c.id, label: c.name })),
      },
      {
        name: 'name',
        label: '中分類名称',
        type: 'text',
        required: true,
        placeholder: '社内パーティー',
      },
      { name: 'display_order', label: '表示順', type: 'number' },
      { name: 'is_active',     label: '有効',   type: 'toggle' },
    ],
  }

  return <MasterPageShell config={config} isAdmin={isAdmin} />
}
