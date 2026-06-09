'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils/cn'

// ─── 型定義 ──────────────────────────────────────────────────
type FoodPlanState = '未確認' | '質問中' | '検討中' | '確定' | '不要'
const FOOD_PLAN_STATES: FoodPlanState[] = ['未確認', '質問中', '検討中', '確定', '不要']

const STATE_STYLE: Record<FoodPlanState, string> = {
  '未確認': 'bg-gray-50 text-gray-600',
  '質問中': 'bg-yellow-50 text-yellow-700',
  '検討中': 'bg-blue-50 text-blue-700',
  '確定':   'bg-green-50 text-green-700',
  '不要':   'bg-muted text-muted-foreground',
}

interface FoodPlanItem {
  id: string
  case_id: string
  food_plan_id: string | null
  name: string
  qty: number
  unit_price: number
  amount: number
  state: FoodPlanState
  sort_order: number
  food_plan_master?: { id: string; name: string } | null
}

interface FoodPlanMasterItem {
  id: string
  name: string
  display_order: number
  is_active: boolean
}

/** API 取得失敗時のフォールバック候補 */
const FALLBACK_MASTER: FoodPlanMasterItem[] = [
  '5,000ビュッフェ',
  '6,000ビュッフェ',
  '8,000ビュッフェ',
  '7F 飲み放題3,000',
  '8F飲み放題4,000',
  '4,500ビュッフェ',
  '4,200ビュッフェ',
  '4,000ビュッフェ',
].map((name, i) => ({ id: `fallback-${i}`, name, display_order: i * 10, is_active: true }))

// ─── スタイル定数 ─────────────────────────────────────────────
const INP =
  'w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
const SEL = `${INP} cursor-pointer`
const TAX_RATE = 1.1

// ─── コンポーネント ───────────────────────────────────────────
interface CaseFoodPlansSectionProps {
  caseId: string
  isEditable?: boolean
}

/**
 * ④ 飲食プラン セクション
 * case_food_plans 中間テーブルを使用
 * Options.tsx と同仕様: 行形式 / 数量 / 単価 / 小計 / 状態 / 削除 / 候補ボタン / 手入力
 */
export function CaseFoodPlansSection({ caseId, isEditable = true }: CaseFoodPlansSectionProps) {
  const [items, setItems] = useState<FoodPlanItem[]>([])
  const [masterPlans, setMasterPlans] = useState<FoodPlanMasterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchItems = async () => {
    const res = await fetch(`/api/cases/${caseId}/food-plans`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  useEffect(() => {
    fetchItems()
    fetch('/api/master/food-plans')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: unknown) => {
        const arr = Array.isArray(d) ? (d as FoodPlanMasterItem[]) : []
        setMasterPlans(arr.length > 0 ? arr : FALLBACK_MASTER)
      })
      .catch(() => setMasterPlans(FALLBACK_MASTER))
  }, [caseId])

  // ─── CRUD ─────────────────────────────────────────────────
  const addItem = async (preset?: FoodPlanMasterItem) => {
    const body = preset
      ? {
          food_plan_id: preset.id.startsWith('fallback-') ? null : preset.id,
          name: preset.name,
          qty: 1,
          unit_price: 0,
        }
      : { name: '新規プラン', qty: 1, unit_price: 0 }

    const res = await fetch(`/api/cases/${caseId}/food-plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      await fetchItems()
    } else {
      toast.error('追加に失敗しました')
    }
  }

  const updateItem = async (id: string, field: string, value: unknown) => {
    setSaving(id)

    const res = await fetch(`/api/cases/${caseId}/food-plans`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    })

    if (res.ok) {
      const updated = await res.json()
      setItems(prev => prev.map(i => (i.id === id ? { ...i, ...updated } : i)))
    } else {
      toast.error('保存に失敗しました')
    }

    setSaving(null)
  }

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/cases/${caseId}/food-plans?item_id=${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id))
    } else {
      toast.error('削除に失敗しました')
    }
  }

  // ─── 派生値 ───────────────────────────────────────────────
  // 既追加のプラン名セット → 候補ボタンから除外
  const existingNames = new Set(items.map(i => i.name))
  const unaddedMaster = masterPlans.filter(p => !existingNames.has(p.name))

  // 合計（不要除く、税込）
  const subtotalExTax = items
    .filter(i => i.state !== '不要')
    .reduce((sum, i) => sum + (i.qty ?? 1) * (i.unit_price ?? 0), 0)

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-muted/40" />

  const colClass = isEditable
    ? 'grid-cols-[1fr_60px_90px_90px_90px_28px]'
    : 'grid-cols-[1fr_60px_90px_90px_90px]'

  // ─── 行コンポーネント ──────────────────────────────────────
  const ItemRow = ({ item }: { item: FoodPlanItem }) => {
    const subtotalInclTax = Math.round((item.qty ?? 1) * (item.unit_price ?? 0) * TAX_RATE)

    return (
      <>
        {/* ── スマホ用コンパクトカード (sm未満) ── */}
        <div
          className={cn(
            'sm:hidden border-b border-border py-2.5 last:border-0',
            item.state === '不要' && 'opacity-50'
          )}
        >
          {/* 上段：名称 + 状態 + 削除 */}
          <div className="flex items-center gap-2">
            {isEditable ? (
              <input
                className={cn(INP, 'flex-1 min-w-0')}
                defaultValue={item.name}
                onBlur={e => updateItem(item.id, 'name', e.target.value)}
              />
            ) : (
              <span className="flex-1 min-w-0 text-sm font-medium truncate">{item.name}</span>
            )}
            {isEditable ? (
              <select
                className={cn(SEL, 'text-xs shrink-0 w-[5.5rem]', STATE_STYLE[item.state])}
                value={item.state}
                onChange={e => updateItem(item.id, 'state', e.target.value)}
              >
                {FOOD_PLAN_STATES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLE[item.state])}>
                {item.state}
              </span>
            )}
            {isEditable && (
              <button
                onClick={() => deleteItem(item.id)}
                disabled={saving === item.id}
                className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* 下段：数量 × 単価 = 小計 */}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {isEditable ? (
              <input
                className={cn(INP, 'w-14 text-center')}
                type="number"
                min="1"
                defaultValue={item.qty}
                onBlur={e => updateItem(item.id, 'qty', Number(e.target.value))}
              />
            ) : (
              <span className="tabular-nums">{item.qty}</span>
            )}
            <span>×</span>
            {isEditable ? (
              <input
                className={cn(INP, 'w-24 text-right')}
                type="number"
                min="0"
                defaultValue={item.unit_price}
                onBlur={e => updateItem(item.id, 'unit_price', Number(e.target.value))}
              />
            ) : (
              <span className="tabular-nums">¥{item.unit_price.toLocaleString()}</span>
            )}
            <span>=</span>
            <span className="tabular-nums font-medium text-foreground">
              ¥{subtotalInclTax.toLocaleString()}
              <span className="text-muted-foreground font-normal">（税込）</span>
            </span>
          </div>
        </div>

        {/* ── PC用グリッド行 (sm以上) ── */}
        <div
          className={cn(
            'hidden sm:grid items-center gap-2 border-b border-border py-2 text-sm last:border-0',
            colClass,
            item.state === '不要' && 'opacity-50'
          )}
        >
          {/* 名称 */}
          {isEditable ? (
            <input
              className={INP}
              defaultValue={item.name}
              onBlur={e => updateItem(item.id, 'name', e.target.value)}
            />
          ) : (
            <span className="truncate text-sm">{item.name}</span>
          )}

          {/* 数量 */}
          {isEditable ? (
            <input
              className={INP}
              type="number"
              min="1"
              defaultValue={item.qty}
              onBlur={e => updateItem(item.id, 'qty', Number(e.target.value))}
            />
          ) : (
            <span className="text-center text-sm">{item.qty}</span>
          )}

          {/* 単価（税抜） */}
          {isEditable ? (
            <input
              className={INP}
              type="number"
              min="0"
              defaultValue={item.unit_price}
              onBlur={e => updateItem(item.id, 'unit_price', Number(e.target.value))}
            />
          ) : (
            <span className="text-sm tabular-nums">¥{item.unit_price.toLocaleString()}</span>
          )}

          {/* 小計（税込） */}
          <span className="text-right text-xs tabular-nums text-muted-foreground">
            ¥{subtotalInclTax.toLocaleString()}
          </span>

          {/* 状態 */}
          {isEditable ? (
            <select
              className={cn(SEL, 'text-xs', STATE_STYLE[item.state])}
              value={item.state}
              onChange={e => updateItem(item.id, 'state', e.target.value)}
            >
              {FOOD_PLAN_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <span className={cn('rounded-full px-2 py-0.5 text-center text-xs font-medium', STATE_STYLE[item.state])}>
              {item.state}
            </span>
          )}

          {/* 削除 */}
          {isEditable && (
            <button
              onClick={() => deleteItem(item.id)}
              disabled={saving === item.id}
              className="rounded p-0.5 text-muted-foreground/50 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </>
    )
  }

  // PC用テーブルヘッダー（スマホ=カード表示のため sm未満は非表示）
  const TableHeader = () => (
    <div
      className={cn(
        'hidden sm:grid gap-2 border-b border-border pb-1.5 text-xs font-medium text-muted-foreground',
        colClass
      )}
    >
      <span>内容</span>
      <span>数量</span>
      <span>単価</span>
      <span className="text-right">小計(税込)</span>
      <span>状態</span>
      {isEditable && <span />}
    </div>
  )

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">④ 飲食プラン</h2>
        <span className="text-xs text-muted-foreground">{items.length} 件</span>
      </div>

      <div className="px-5 py-4">
        {/* 行テーブル */}
        {items.length > 0 && <TableHeader />}
        {items.map(item => (
          <ItemRow key={item.id} item={item} />
        ))}

        {/* 候補ボタン + 手入力追加（編集時のみ） */}
        {isEditable && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {unaddedMaster.map(m => (
              <button
                key={m.id}
                onClick={() => addItem(m)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/5"
              >
                <Plus className="h-3 w-3" /> {m.name}
              </button>
            ))}
            <button
              onClick={() => addItem()}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> 手入力で追加
            </button>
          </div>
        )}

        {/* 合計（不要除く・税込）*/}
        {subtotalExTax > 0 && (
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">飲食合計（不要除く・税込）</span>
            <span className="text-sm font-bold tabular-nums text-foreground">
              ¥{Math.round(subtotalExTax * TAX_RATE).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
