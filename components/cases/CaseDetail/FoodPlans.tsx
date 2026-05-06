'use client'

import { useState } from 'react'
import { toast } from 'sonner'

/** 初期選択肢（マスターテーブル不使用・ハードコード） */
const FOOD_PLAN_OPTIONS = [
  '5,000ビュッフェ',
  '6,000ビュッフェ',
  '8,000ビュッフェ',
  '7F 飲み放題3,000',
  '8F飲み放題4,000',
  '4,500ビュッフェ',
  '4,200ビュッフェ',
  '4,000ビュッフェ',
] as const

interface CaseFoodPlansSectionProps {
  caseId: string
  /** cases.food_plans の現在値 */
  initialPlans: string[]
  isEditable?: boolean
}

/**
 * ④ 飲食プラン セクション
 * 定義済みプランのトグル選択 → PUT /api/cases/[id] で即時保存
 */
export function CaseFoodPlansSection({
  caseId,
  initialPlans,
  isEditable = true,
}: CaseFoodPlansSectionProps) {
  const [selected, setSelected] = useState<string[]>(initialPlans ?? [])
  const [saving, setSaving] = useState(false)

  const toggle = async (plan: string) => {
    if (!isEditable || saving) return

    const next = selected.includes(plan)
      ? selected.filter((p) => p !== plan)
      : [...selected, plan]

    // 楽観的 UI 更新
    setSelected(next)
    setSaving(true)

    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food_plans: next }),
      })

      if (!res.ok) {
        // ロールバック
        setSelected(selected)
        toast.error('保存に失敗しました')
      }
    } catch {
      setSelected(selected)
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

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
          /* 編集モード: トグルチップ */
          <div className="flex flex-wrap gap-2">
            {FOOD_PLAN_OPTIONS.map((plan) => {
              const isActive = selected.includes(plan)
              return (
                <button
                  key={plan}
                  onClick={() => toggle(plan)}
                  disabled={saving}
                  className={[
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted',
                  ].join(' ')}
                >
                  {plan}
                </button>
              )
            })}
          </div>
        ) : selected.length === 0 ? (
          /* 閲覧モード: 未設定 */
          <p className="text-sm text-muted-foreground">未設定</p>
        ) : (
          /* 閲覧モード: 選択済みリスト */
          <ul className="space-y-1">
            {selected.map((plan) => (
              <li key={plan} className="text-sm">
                ・{plan}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
