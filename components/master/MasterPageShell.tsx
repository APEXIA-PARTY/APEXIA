'use client'

import { useState } from 'react'
import { Plus, Lock, AlertTriangle, RefreshCw } from 'lucide-react'
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
  prepareCreate?: () => Record<string, any>
}

interface MasterPageShellProps<T extends MasterItem> {
  config: MasterPageConfig<T>
  isAdmin: boolean
}

export function MasterPageShell<T extends MasterItem>({
  config, isAdmin,
}: MasterPageShellProps<T>) {
  const { items, loading, error, fetchAll, create, update, toggleActive, reorder } =
    useMasterData<T>({ apiPath: config.apiPath, queryParams: config.queryParams })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<T | null>(null)

  const openCreate = () => { setEditTarget(null); setDialogOpen(true) }
  const openEdit = (item: T) => { setEditTarget(item); setDialogOpen(true) }

  const handleSubmit = async (values: any): Promise<boolean> => {
    return editTarget ? update(editTarget.id, values) : create(values)
  }

  const initialValues = editTarget ? { ...editTarget } : config.prepareCreate?.() ?? {}

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

      {/* エラー表示: APIエラー時に再取得ボタン付きで明示 */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="flex-1 text-sm text-destructive">
            データの取得に失敗しました: {error}
          </p>
          <button
            onClick={fetchAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            <RefreshCw className="h-3 w-3" />
            再取得
          </button>
        </div>
      )}

      {/* 件数・凡例（エラーがなければ表示） */}
      {!error && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>全 {items.length} 件（有効: {items.filter((i) => i.is_active).length} 件）</span>
          {isAdmin && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
              薄い行 = 無効
            </span>
          )}
        </div>
      )}

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