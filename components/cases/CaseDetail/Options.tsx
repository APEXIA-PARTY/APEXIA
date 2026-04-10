'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils/cn'

type OptionState = '未確認' | '質問中' | '検討中' | '確定' | '不要'
const OPTION_STATES: OptionState[] = ['未確認', '質問中', '検討中', '確定', '不要']
const MACHINE_CATS = ['音響', '照明', '映像'] as const

const STATE_STYLE: Record<OptionState, string> = {
  '未確認': 'bg-gray-50 text-gray-600',
  '質問中': 'bg-yellow-50 text-yellow-700',
  '検討中': 'bg-blue-50 text-blue-700',
  '確定':   'bg-green-50 text-green-700',
  '不要':   'bg-muted text-muted-foreground',
}

interface OptionItem {
  id: string
  name: string
  category: 'equipment' | 'machine'
  machine_category: string | null
  qty: number
  unit_price: number
  amount: number
  unit: string
  state: OptionState
  note: string | null
  sort_order: number
  option_master?: { id: string; name: string } | null
}

interface OptionMasterItem {
  id: string
  name: string
  category: string
  machine_category: string | null
  default_price: number
  unit: string
}

interface CaseOptionsSectionProps {
  caseId: string
  isEditable?: boolean
}

const INP = 'w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
const SEL = `${INP} cursor-pointer`

/**
 * ④ 備品・設備 / ⑤ 機材・オペレーター セクション
 * equipmentとmachineを別セクションとして表示する
 */
export function CaseOptionsSection({ caseId, isEditable = true }: CaseOptionsSectionProps) {
  const [items, setItems]           = useState<OptionItem[]>([])
  const [masterOpts, setMasterOpts] = useState<OptionMasterItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState<string | null>(null) // saving item id

  const fetchItems = async () => {
    const res = await fetch(`/api/cases/${caseId}/options`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    fetchItems()
    fetch('/api/master/options').then(r => r.ok ? r.json() : []).then(d => setMasterOpts(Array.isArray(d) ? d : [])).catch(() => setMasterOpts([]))
  }, [caseId])

  // オプション追加（マスタから or 手入力）
  const addItem = async (
    category: 'equipment' | 'machine',
    machineCategory: string | null,
    preset?: OptionMasterItem
  ) => {
    const body = preset
      ? { option_id: preset.id, name: preset.name, category, machine_category: machineCategory, qty: 1, unit_price: preset.default_price, unit: preset.unit }
      : { name: '新規項目', category, machine_category: machineCategory, qty: 1, unit_price: 0, unit: '式' }

    const res = await fetch(`/api/cases/${caseId}/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) { await fetchItems() }
    else toast.error('追加に失敗しました')
  }

  // フィールド更新（デバウンスなし・blur時に保存）
  const updateItem = async (id: string, field: string, value: unknown) => {
    setSaving(id)
    const res = await fetch(`/api/cases/${caseId}/options`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    })
    if (res.ok) {
      const updated = await res.json()
      setItems(prev => prev.map(i => i.id === id ? { ...i, ...updated } : i))
    } else {
      toast.error('保存に失敗しました')
    }
    setSaving(null)
  }

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/cases/${caseId}/options?item_id=${id}`, { method: 'DELETE' })
    if (res.ok) setItems(prev => prev.filter(i => i.id !== id))
    else toast.error('削除に失敗しました')
  }

  const equipment = items.filter(i => i.category === 'equipment')
  const machines  = MACHINE_CATS.map(cat => ({
    cat,
    items: items.filter(i => i.category === 'machine' && i.machine_category === cat),
  }))

  const equipmentMaster = masterOpts.filter(m => m.category === 'equipment')

  const totalAmount = items
    .filter(i => i.state !== '不要')
    .reduce((s, i) => s + (i.amount ?? 0), 0)

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-muted/40" />

  const colClass = isEditable
    ? 'grid-cols-[1fr_60px_90px_70px_90px_28px]'
    : 'grid-cols-[1fr_60px_90px_70px_90px]'

  const ItemRow = ({ item }: { item: OptionItem }) => (
    <div className={cn(
      'grid items-center gap-2 py-2 text-sm border-b border-border last:border-0',
      colClass,
      item.state === '不要' && 'opacity-50'
    )}>
      {/* 名称: viewer は表示のみ */}
      {isEditable ? (
        <input
          className={INP}
          defaultValue={item.name}
          onBlur={e => updateItem(item.id, 'name', e.target.value)}
        />
      ) : (
        <span className="text-sm truncate">{item.name}</span>
      )}
      {/* 数量: viewer は表示のみ */}
      {isEditable ? (
        <input
          className={INP}
          type="number" min="1"
          defaultValue={item.qty}
          onBlur={e => updateItem(item.id, 'qty', Number(e.target.value))}
        />
      ) : (
        <span className="text-sm text-center">{item.qty}</span>
      )}
      {/* 単価: viewer は表示のみ */}
      {isEditable ? (
        <input
          className={INP}
          type="number" min="0"
          defaultValue={item.unit_price}
          onBlur={e => updateItem(item.id, 'unit_price', Number(e.target.value))}
        />
      ) : (
        <span className="text-sm tabular-nums">¥{item.unit_price.toLocaleString()}</span>
      )}
      {/* 小計: 常に表示 */}
      <span className="text-right tabular-nums text-xs text-muted-foreground">
        ¥{((item.qty ?? 1) * (item.unit_price ?? 0)).toLocaleString()}
      </span>
      {/* 状態: viewer は表示のみ */}
      {isEditable ? (
        <select
          className={cn(SEL, 'text-xs', STATE_STYLE[item.state])}
          value={item.state}
          onChange={e => updateItem(item.id, 'state', e.target.value)}
        >
          {OPTION_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : (
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium text-center', STATE_STYLE[item.state])}>
          {item.state}
        </span>
      )}
      {/* 削除: admin/staff のみ */}
      {isEditable && (
        <button
          onClick={() => deleteItem(item.id)}
          className="rounded p-0.5 text-muted-foreground/50 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  const TableHeader = () => (
    <div className={cn('grid gap-2 border-b border-border pb-1.5 text-xs font-medium text-muted-foreground', colClass)}>
      <span>内容</span><span>数量</span><span>単価</span><span className="text-right">小計</span><span>状態</span>
      {isEditable && <span />}
    </div>
  )

  const QuickAddBar = ({ category, machineCategory }: { category: 'equipment' | 'machine'; machineCategory: string | null }) => {
    if (!isEditable) return null
    const opts = masterOpts.filter(m =>
      m.category === category && (category === 'equipment' || m.machine_category === machineCategory)
    )
    return (
      <div className="flex flex-wrap gap-1.5 pt-2">
        {opts.map(m => (
          <button
            key={m.id}
            onClick={() => addItem(category, machineCategory, m)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/5"
          >
            <Plus className="h-3 w-3" /> {m.name}
          </button>
        ))}
        <button
          onClick={() => addItem(category, machineCategory)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> 手入力で追加
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ④ 備品・設備 */}
      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="text-sm font-semibold">④ 備品・設備</h2>
          <span className="text-xs text-muted-foreground">{equipment.length} 件</span>
        </div>
        <div className="px-5 py-4">
          {equipment.length > 0 && <TableHeader />}
          {equipment.map(item => <ItemRow key={item.id} item={item} />)}
          <QuickAddBar category="equipment" machineCategory={null} />
        </div>
      </section>

      {/* ⑤ 機材・オペレーター */}
      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="text-sm font-semibold">⑤ 機材・オペレーター</h2>
          <span className="text-xs text-muted-foreground">
            {items.filter(i => i.category === 'machine').length} 件
          </span>
        </div>
        <div className="divide-y divide-border">
          {machines.map(({ cat, items: catItems }) => (
            <div key={cat} className="px-5 py-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat}</p>
              {catItems.length > 0 && <TableHeader />}
              {catItems.map(item => <ItemRow key={item.id} item={item} />)}
              <QuickAddBar category="machine" machineCategory={cat} />
            </div>
          ))}
        </div>
      </section>

      {/* オプション合計 */}
      {items.filter(i => i.state !== '不要').length > 0 && (
        <div className="flex items-center justify-end gap-2 rounded-lg border border-border bg-card px-5 py-3">
          <span className="text-sm text-muted-foreground">オプション合計（不要除く）</span>
          <span className="text-base font-bold text-foreground tabular-nums">
            ¥{totalAmount.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}
