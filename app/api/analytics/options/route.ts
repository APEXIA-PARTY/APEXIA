import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { filterByYear, filterByMonth, REVENUE_STATUSES } from '@/lib/utils/analytics'

export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const month = searchParams.get('month')
  const category = searchParams.get('category') ?? 'equipment'

  const [{ data: masters }, { data: optionRows }, { data: cases }] = await Promise.all([
    supabase.from('option_master').select('id,name,category,machine_category').eq('is_active', true).eq('category', category).order('display_order'),
    supabase.from('case_options').select('id,case_id,option_id,name,category,amount,qty'),
    supabase.from('cases').select('id,status,inquiry_date').filter('status', 'in', `(${REVENUE_STATUSES.map(s => `"${s}"`).join(',')})`),
  ])

  if (!cases || !optionRows) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })

  // 期間フィルター（案件ベース）
  let filteredCases = cases as { id: string; status: string; inquiry_date: string | null }[]
  if (month) filteredCases = filteredCases.filter(c => c.inquiry_date?.startsWith(month))
  else if (year) filteredCases = filteredCases.filter(c => c.inquiry_date?.startsWith(year))

  const caseIdSet = new Set(filteredCases.map(c => c.id))

  // 対象オプション行をフィルタリング
  const filteredOptions = (optionRows ?? []).filter(o => caseIdSet.has(o.case_id) && o.category === category)

  // option_id でグルーピング
  const result = (masters ?? []).map(m => {
    const mOpts = filteredOptions.filter(o => o.option_id === m.id)
    const caseIds = Array.from(
      new Set(
        mOpts
          .map((o) => o.case_id)
          .filter((v): v is string => typeof v === 'string' && v !== '')
      )
    )
    const revenue = mOpts.reduce((s, o) => s + (o.amount ?? 0), 0)
    return {
      id: m.id,
      name: m.name,
      machine_category: m.machine_category,
      useCount: caseIds.length,
      revenue,
    }
  })

  // マスタなし（手入力）
  const manualOpts = filteredOptions.filter(o => !o.option_id)
  if (manualOpts.length > 0) {
    // 名称ごとにまとめる
    const nameMap = new Map<string, { caseIds: Set<string>; revenue: number }>()
    manualOpts.forEach(o => {
      const key = o.name ?? '（名称なし）'
      if (!nameMap.has(key)) nameMap.set(key, { caseIds: new Set(), revenue: 0 })
      nameMap.get(key)!.caseIds.add(o.case_id)
      nameMap.get(key)!.revenue += o.amount ?? 0
    })
    nameMap.forEach((val, name) => {
      result.push({ id: `manual_${name}`, name: `${name}（手入力）`, machine_category: null, useCount: val.caseIds.size, revenue: val.revenue })
    })
  }

  return NextResponse.json({
    period: month ?? year ?? 'all',
    category,
    rows: result.filter(r => r.useCount > 0).sort((a, b) => b.useCount - a.useCount),
  })
}
