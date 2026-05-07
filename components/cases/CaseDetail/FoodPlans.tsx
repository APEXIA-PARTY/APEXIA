'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'

interface FoodPlanMasterItem {
  id: string
  name: string
  display_order: number
  is_active: boolean
}

interface CaseFoodPlansSectionProps {
  caseId: string
  /** cases.food_plans の現在値 */
  initialPlans: string[]
  isEditable?: boolean
}

/**
 * ④ 飲食プラン セクション
 * - マスタ管理された定義済みプランをトグル選択
 * - 手入力でカスタムプランを追加可能
 * - 選択/追加/削除のたびに PUT /api/cases/[id] で即時保存
 */
export function CaseFoodPlansSection({
  caseId,
  initialPlans,
  isEditable = true,
}: CaseFoodPlansSectionProps) {
  const [selected, setSelected] = useState<string[]>(initialPlans ?? [])
  const [masterPlans, setMasterPlans] = useState<FoodPlanMasterItem[]>([])
  const [saving, setSaving] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const customInputRef = useRef<HTMLInputElement>(null)

  // マスタプラン取得
  useEffect(() => {
    fetch('/api/master/food-plans')
      .then(r => r.ok ? r.json() : [])
      .then(d => setMasterPlans(Array.isArray(d) ? d : []))
      .catch(() => setMasterPlans([]))
  }, [])

  // 手入力フォーム表示時にフォーカス
  useEffect(() => {
    if (showCustomInput) customInputRef.current?.focus()
  }, [showCustomInput])

  const save = async (next: string[]) => {
    setSaving(true)
    const prev = selected
    setSelected(next)
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_plans: next }),
      })
      if (!res.ok) {
        setSelected(prev)
        toast.error('保存に失敗しました')
      }
    } catch {
      setSelected(prev)
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const toggleMaster = (name: string) => {
    if (!isEditable || saving) return
    const next = selected.includes(name)
      ? selected.filter(p => p !== name)
      : [...selected, name]
    save(next)
  }

  const removeItem = (name: string) => {
    if (!isEditable || saving) return
    save(selected.filter(p => p !== name))
  }

  const addCustom = () => {
    const val = customValue.trim()
    if (!val) { setShowCustomInput(false); return }
    if (selected.includes(val)) {
      toast.error('同じプランがすでに選択されています')
      return
    }
    save([...selected, val])
    setCustomValue('')
    setShowCustomInput(false)
  }

  // マスタに含まれないカスタム項目
  const masterNames = new Set(masterPlans.map(p => p.name))
  const customItems = selected.filter(n => !masterNames.has(n))

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
        <h2 className="text-sm font-semibold">④ 飲食プラン</h2>
        <span className="text-xs text-muted-foreground">
          {selected.length > 0 ? `${selected.length} 件選択中` : '未設定'}
        </span>
      </div>

      <div className="px-5 py-4">
        {isEditable ? (
          <div className="space-y-3">
            {/* マスタ定義済みプランのトグルチップ */}
            <div className="flex flex-wrap gap-2">
              {masterPlans.map(plan => {
                const isActive = selected.includes(plan.name)
                return (
                  <button
                    key={plan.id}
                    onClick={() => toggleMaster(plan.name)}
                    disabled={saving}
                    className={[
                      'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted',
                    ].join(' ')}
                  >
                    {plan.name}
                    {isActive && (
                      <X className="h-3 w-3 opacity-70" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* カスタム項目（マスタ外）の表示 */}
            {customItems.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customItems.map(name => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  >
                    {name}
                    <button
                      onClick={() => removeItem(name)}
                      disabled={saving}
                      className="ml-0.5 rounded-full hover:opacity-70 disabled:opacity-50"
                      aria-label={`${name}を削除`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* 手入力エリア */}
            {showCustomInput ? (
              <div className="flex items-center gap-2">
                <input
                  ref={customInputRef}
                  type="text"
                  value={customValue}
                  onChange={e => setCustomValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addCustom() }
                    if (e.key === 'Escape') { setShowCustomInput(false); setCustomValue('') }
                  }}
                  placeholder="プラン名を入力"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={addCustom}
                  disabled={saving || !customValue.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  追加
                </button>
                <button
                  onClick={() => { setShowCustomInput(false); setCustomValue('') }}
                  className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
                >
                  キャンセル
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCustomInput(true)}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <Plus className="h-3 w-3" /> 手入力で追加
              </button>
            )}
          </div>
        ) : selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">未設定</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selected.map(plan => (
              <span
                key={plan}
                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary"
              >
                {plan}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
