'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, CheckCircle2, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils/cn'

type CheckState = '確認中' | '確定'

interface CheckItem {
  id: string
  item: string
  state: CheckState
  sort_order: number
}

interface CaseChecklistSectionProps {
  caseId: string
  isEditable?: boolean
}

export function CaseChecklistSection({ caseId, isEditable = true }: CaseChecklistSectionProps) {
  const [items, setItems]   = useState<CheckItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newItem, setNewItem] = useState('')
  const [adding, setAdding]   = useState(false)

  const fetchItems = async () => {
    const res = await fetch(`/api/cases/${caseId}/checklist`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchItems() }, [caseId])

  const addItem = async () => {
    if (!newItem.trim()) return
    setAdding(true)
    const res = await fetch(`/api/cases/${caseId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: newItem.trim(), sort_order: items.length }),
    })
    if (res.ok) {
      await fetchItems()
      setNewItem('')
    } else {
      toast.error('追加に失敗しました')
    }
    setAdding(false)
  }

  const toggleState = async (item: CheckItem) => {
    const next: CheckState = item.state === '確認中' ? '確定' : '確認中'
    const res = await fetch(`/api/cases/${caseId}/checklist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, state: next }),
    })
    if (res.ok) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, state: next } : i))
    } else {
      toast.error('更新に失敗しました')
    }
  }

  const updateText = async (id: string, text: string) => {
    if (!text.trim()) return
    await fetch(`/api/cases/${caseId}/checklist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, item: text }),
    })
  }

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/cases/${caseId}/checklist?item_id=${id}`, { method: 'DELETE' })
    if (res.ok) setItems(prev => prev.filter(i => i.id !== id))
    else toast.error('削除に失敗しました')
  }

  const confirmed = items.filter(i => i.state === '確定').length
  const total = items.length

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-muted/40" />

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">⑥ 確認事項</h2>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            確定 {confirmed} / 全 {total} 件
          </span>
        )}
      </div>
      <div className="px-5 py-4 space-y-2">
        {/* 進捗バー */}
        {total > 0 && (
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${Math.round((confirmed / total) * 100)}%` }}
            />
          </div>
        )}

        {/* 確認中 */}
        {items.filter(i => i.state === '確認中').length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-orange-600">確認中</p>
            {items.filter(i => i.state === '確認中').map(item => (
              <div key={item.id} className="flex items-center gap-2 group">
                {/* トグル: admin/staff のみクリック可 */}
                {isEditable ? (
                  <button onClick={() => toggleState(item)} className="shrink-0 text-orange-400 hover:text-orange-600">
                    <Circle className="h-4 w-4" />
                  </button>
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-orange-300" />
                )}
                {/* テキスト: admin/staff のみ編集可 */}
                {isEditable ? (
                  <input
                    className="flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    defaultValue={item.item}
                    onBlur={e => updateText(item.id, e.target.value)}
                  />
                ) : (
                  <span className="flex-1 text-sm">{item.item}</span>
                )}
                {/* 削除: admin/staff のみ */}
                {isEditable && (
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="invisible shrink-0 text-muted-foreground/40 hover:text-destructive group-hover:visible"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 確定 */}
        {items.filter(i => i.state === '確定').length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-green-700">確定</p>
            {items.filter(i => i.state === '確定').map(item => (
              <div key={item.id} className="flex items-center gap-2 group opacity-70">
                {/* トグル（確定→確認中）: admin/staff のみ */}
                {isEditable ? (
                  <button onClick={() => toggleState(item)} className="shrink-0 text-green-500 hover:text-green-700">
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
                )}
                {/* テキスト: admin/staff のみ編集可 */}
                {isEditable ? (
                  <input
                    className="flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-sm line-through text-muted-foreground focus:no-underline focus:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    defaultValue={item.item}
                    onBlur={e => updateText(item.id, e.target.value)}
                  />
                ) : (
                  <span className="flex-1 text-sm line-through text-muted-foreground">{item.item}</span>
                )}
                {/* 削除: admin/staff のみ */}
                {isEditable && (
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="invisible shrink-0 text-muted-foreground/40 hover:text-destructive group-hover:visible"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">確認事項がありません</p>
        )}

        {/* 追加フォーム: admin/staff のみ表示 */}
        {isEditable && (
          <div className="flex gap-2 pt-2 border-t border-border">
            <input
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="確認事項を入力して Enter"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
            />
            <button
              onClick={addItem}
              disabled={adding || !newItem.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              追加
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
