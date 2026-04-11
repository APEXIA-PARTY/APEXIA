'use client'

/**
 * オプションマスタ管理ページ
 * - 備品（equipment）/ 機材（machine）タブ切り替え
 * - 機材タブ内は音響 / 照明 / 映像 のサブフィルター
 * - 追加フォームでは category 選択後に machine_category が動的表示
 */

import { useState, useEffect, useMemo } from 'react'
import { Plus, Lock } from 'lucide-react'
import { MasterTable } from '@/components/master/MasterTable'
import { MasterFormDialog } from '@/components/master/MasterFormDialog'
import { useMasterData, MasterItem } from '@/lib/hooks/useMasterData'
import { optionSchema } from '@/lib/validations/master'
import { cn } from '@/lib/utils/cn'

type OptionItem = MasterItem & {
  category: 'equipment' | 'machine'
  machine_category: '音響' | '照明' | '映像' | null
  default_price: number
  unit: string
}

type MachineTab = '全て' | '音響' | '照明' | '映像'
type MainTab = 'equipment' | 'machine'

const MACHINE_TABS: MachineTab[] = ['全て', '音響', '照明', '映像']

const CATEGORY_LABEL: Record<MainTab, string> = {
  equipment: '備品・設備',
  machine:   '機材・オペレーター',
}

export default function OptionsPage() {
  const [isAdmin, setIsAdmin]       = useState(false)
  const [mainTab, setMainTab]       = useState<MainTab>('equipment')
  const [machineTab, setMachineTab] = useState<MachineTab>('全て')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OptionItem | null>(null)

  // ロール取得
  useEffect(() => {
    fetch('/api/auth/role').then(r => r.ok ? r.json() : {role:null}).then((d) => setIsAdmin(d?.role === 'admin')).catch(() => setIsAdmin(false))
  }, [])

  // 全オプション取得（タブ切り替えはクライアントフィルタリング）
  const { items, loading, create, update, toggleActive, reorder } =
    useMasterData<OptionItem>({ apiPath: '/api/master/options' })

  // タブに合わせてフィルタリング
  const filtered = useMemo(() => {
    let result = items.filter((i) => i.category === mainTab)
    if (mainTab === 'machine' && machineTab !== '全て') {
      result = result.filter((i) => i.machine_category === machineTab)
    }
    return result
  }, [items, mainTab, machineTab])

  const handleSubmit = async (values: any): Promise<boolean> => {
    // machine でない場合は machine_category を null にする
    const cleaned = {
      ...values,
      machine_category: values.category === 'machine' ? values.machine_category : null,
    }
    if (editTarget) return update(editTarget.id, cleaned)
    return create(cleaned)
  }

  const openCreate = () => { setEditTarget(null); setDialogOpen(true) }
  const openEdit   = (item: OptionItem) => { setEditTarget(item); setDialogOpen(true) }

  const columns = [
    { key: 'name', label: '名称' },
    ...(mainTab === 'machine' ? [{
      key: 'machine_category' as const,
      label: 'カテゴリ',
      render: (item: OptionItem) => (
        <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {item.machine_category ?? '—'}
        </span>
      ),
    }] : []),
    {
      key: 'default_price' as const,
      label: '単価',
      render: (item: OptionItem) => (
        <span className="tabular-nums">¥{item.default_price.toLocaleString()}</span>
      ),
    },
    { key: 'unit' as const, label: '単位' },
    {
      key: 'is_active' as const,
      label: '状態',
      render: (item: OptionItem) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          item.is_active ? 'bg-green-50 text-green-700' : 'bg-muted text-muted-foreground'
        }`}>
          {item.is_active ? '有効' : '無効'}
        </span>
      ),
    },
  ]

  const fields = [
    {
      name: 'category',
      label: '種別',
      type: 'select' as const,
      required: true,
      options: [
        { value: 'equipment', label: '備品・設備' },
        { value: 'machine',   label: '機材・オペレーター' },
      ],
    },
    {
      name: 'machine_category',
      label: '機材カテゴリ',
      type: 'select' as const,
      dependsOn: 'category',
      dependsValue: 'machine',
      required: true,
      options: [
        { value: '音響', label: '音響' },
        { value: '照明', label: '照明' },
        { value: '映像', label: '映像' },
      ],
    },
    { name: 'name',          label: '名称',   type: 'text'   as const, required: true, placeholder: 'プロジェクター' },
    { name: 'default_price', label: '単価',   type: 'number' as const, placeholder: '0' },
    { name: 'unit',          label: '単位',   type: 'text'   as const, placeholder: '台' },
    { name: 'display_order', label: '表示順', type: 'number' as const },
    { name: 'is_active',     label: '有効',   type: 'toggle' as const },
  ]

  const initialValues = editTarget
    ? { ...editTarget }
    : { category: mainTab, machine_category: mainTab === 'machine' ? machineTab !== '全て' ? machineTab : '' : null, is_active: true, default_price: 0, unit: '式', display_order: 0 }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">オプションマスタ</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            備品・設備および機材・オペレーターのオプションを管理します。
          </p>
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

      {/* メインタブ（備品 / 機材） */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {(['equipment', 'machine'] as MainTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setMainTab(tab); setMachineTab('全て') }}
            className={cn(
              'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
              mainTab === tab
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {CATEGORY_LABEL[tab]}
            <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
              {items.filter((i) => i.category === tab && i.is_active).length}
            </span>
          </button>
        ))}
      </div>

      {/* 機材タブのサブフィルター */}
      {mainTab === 'machine' && (
        <div className="flex gap-1">
          {MACHINE_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setMachineTab(tab)}
              className={cn(
                'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                machineTab === tab
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* 件数 */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {filtered.length} 件表示（有効: {filtered.filter((i) => i.is_active).length} 件）
        </span>
        {isAdmin && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
            薄い行 = 無効
          </span>
        )}
      </div>

      {/* テーブル */}
      <MasterTable
        items={filtered}
        columns={columns as any}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onToggleActive={toggleActive}
        onReorder={reorder}
        loading={loading}
      />

      {/* 追加/編集ダイアログ */}
      <MasterFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
        schema={optionSchema}
        fields={fields}
        initialValues={initialValues}
        title={editTarget ? 'オプションを編集' : 'オプションを追加'}
      />
    </div>
  )
}
