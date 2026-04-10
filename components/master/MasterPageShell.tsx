'use client'

import { useState } from 'react'
import { Plus, Lock } from 'lucide-react'
import { MasterTable, ColumnDef } from './MasterTable'
import { MasterFormDialog, FieldDef } from './MasterFormDialog'
import { useMasterData, MasterItem } from '@/lib/hooks/useMasterData'
import { ZodSchema } from 'zod'

export interface MasterPageConfig<T extends MasterItem> {
  title: string
  description?: string
  apiPath: string
  schema: ZodSchema
  columns: ColumnDef<T>[]
  fields: FieldDef[]
  queryParams?: string
  rowWarning?: (item: T) => string | null
  /** 追加ダイアログを開く前に外部で値を確定させたい場合（中分類の親ID連携など） */
  prepareCreate?: () => Record<string, any>
}

interface MasterPageShellProps<T extends MasterItem> {
  config: MasterPageConfig<T>
  isAdmin: boolean
}

/**
 * マスタ管理ページ共通シェル
 * フィールド設定オブジェクトを渡すだけで全マスタ画面を生成できる
 */
export function MasterPageShell<T extends MasterItem>({
  config, isAdmin,
}: MasterPageShellProps<T>) {
  const { items, loading, create, update, toggleActive, reorder } = useMasterData<T>({
    apiPath: config.apiPath,
    queryParams: config.queryParams,
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<T | null>(null)

  const openCreate = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }

  const openEdit = (item: T) => {
    setEditTarget(item)
    setDialogOpen(true)
  }

  const handleSubmit = async (values: any): Promise<boolean> => {
    if (editTarget) {
      return update(editTarget.id, values)
    } else {
      return create(values)
    }
  }

  const initialValues = editTarget
    ? { ...editTarget }
    : config.prepareCreate?.() ?? {}

  return (
    <div className="space-y-4">
      {/* ページヘッダー */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">{config.title}</h2>
          {config.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{config.description}</p>
          )}
        </div>
        {isAdmin ? (
          <button
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            追加
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            閲覧のみ
          </span>
        )}
      </div>

      {/* 件数・凡例 */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>全 {items.length} 件（有効: {items.filter((i) => i.is_active).length} 件）</span>
        {isAdmin && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
            薄い行 = 無効
          </span>
        )}
      </div>

      {/* テーブル */}
      <MasterTable
        items={items}
        columns={config.columns}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onToggleActive={toggleActive}
        onReorder={reorder}
        loading={loading}
        rowWarning={config.rowWarning}
      />

      {/* 追加/編集ダイアログ */}
      <MasterFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
        schema={config.schema}
        fields={config.fields}
        initialValues={initialValues}
        title={editTarget ? `${config.title}を編集` : `${config.title}を追加`}
      />
    </div>
  )
}
