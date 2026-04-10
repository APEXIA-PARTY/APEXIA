'use client'

import { useState } from 'react'
import { GripVertical, Pencil, EyeOff, Eye, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { MasterItem } from '@/lib/hooks/useMasterData'

export interface ColumnDef<T> {
  key: string
  label: string
  render?: (item: T) => React.ReactNode
  className?: string
}

interface MasterTableProps<T extends MasterItem> {
  items: T[]
  columns: ColumnDef<T>[]
  isAdmin: boolean
  onEdit: (item: T) => void
  onToggleActive: (item: T) => void
  onReorder: (items: T[]) => void
  loading?: boolean
  rowWarning?: (item: T) => string | null  // 行に警告バッジを出す場合
}

/**
 * マスタ管理共通テーブル
 * - ドラッグ&ドロップで並び替え（マウスイベントベース）
 * - 無効/有効トグル
 * - 編集ボタン
 * - admin のみ操作系を表示
 */
export function MasterTable<T extends MasterItem>({
  items,
  columns,
  isAdmin,
  onEdit,
  onToggleActive,
  onReorder,
  loading = false,
  rowWarning,
}: MasterTableProps<T>) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const handleDragStart = (idx: number) => setDraggingIdx(idx)
  const handleDragEnter = (idx: number) => setDragOverIdx(idx)
  const handleDragEnd = () => {
    if (draggingIdx === null || dragOverIdx === null || draggingIdx === dragOverIdx) {
      setDraggingIdx(null); setDragOverIdx(null); return
    }
    const next = [...items]
    const [moved] = next.splice(draggingIdx, 1)
    next.splice(dragOverIdx, 0, moved)
    onReorder(next)
    setDraggingIdx(null); setDragOverIdx(null)
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground animate-pulse">
        読み込み中...
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        データがありません
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* ヘッダー */}
      <div className="border-b border-border bg-muted/40 px-4 py-2.5 grid gap-3 text-xs font-semibold text-muted-foreground"
        style={{ gridTemplateColumns: isAdmin ? `28px ${columns.map(() => '1fr').join(' ')} 100px` : `${columns.map(() => '1fr').join(' ')}` }}>
        {isAdmin && <div />}
        {columns.map((col) => (
          <div key={col.key} className={col.className}>{col.label}</div>
        ))}
        {isAdmin && <div className="text-right">操作</div>}
      </div>

      {/* 行 */}
      <div className="divide-y divide-border">
        {items.map((item, idx) => {
          const warning = rowWarning?.(item)
          return (
            <div
              key={item.id}
              draggable={isAdmin}
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className={cn(
                'grid gap-3 px-4 py-3 items-center text-sm transition-colors',
                !item.is_active && 'opacity-50',
                dragOverIdx === idx && draggingIdx !== idx && 'bg-primary/5 border-t-2 border-primary',
                isAdmin ? `grid` : `grid`
              )}
              style={{ gridTemplateColumns: isAdmin ? `28px ${columns.map(() => '1fr').join(' ')} 100px` : `${columns.map(() => '1fr').join(' ')}` }}
            >
              {/* ドラッグハンドル */}
              {isAdmin && (
                <div className="flex items-center cursor-grab text-muted-foreground/40 hover:text-muted-foreground">
                  <GripVertical className="h-4 w-4" />
                </div>
              )}

              {/* データセル */}
              {columns.map((col) => (
                <div key={col.key} className={cn('min-w-0', col.className)}>
                  {col.render ? col.render(item) : String(item[col.key] ?? '—')}
                </div>
              ))}

              {/* 操作ボタン */}
              {isAdmin && (
                <div className="flex items-center justify-end gap-1.5">
                  {warning && (
                    <span title={warning}>
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                    </span>
                  )}
                  <button
                    onClick={() => onEdit(item)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="編集"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onToggleActive(item)}
                    className={cn(
                      'rounded p-1 hover:bg-muted',
                      item.is_active
                        ? 'text-muted-foreground hover:text-destructive'
                        : 'text-green-600 hover:text-green-700'
                    )}
                    title={item.is_active ? '無効にする' : '有効にする'}
                  >
                    {item.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
