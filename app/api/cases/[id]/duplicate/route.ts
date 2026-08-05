import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth/helpers'
import {
  resolveBaseName,
  nextCopyName,
  buildDuplicateInsertData,
  deleteCaseAndLogFailure,
} from '@/lib/cases/duplicate'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // ─── 権限確認: スタッフ以上のみ実行可（未ログイン・viewerは拒否） ───
  const { error: authError } = await requireStaff()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: '認証が必要です' }, { status: 401 })
  }

  // ─── 複製元の取得（SELECTのみ、UPDATEしない） ───────────────
  const { data: source, error: fetchError } = await supabase
    .from('cases')
    .select('*')
    .eq('id', params.id)
    .single()

  if (fetchError || !source) {
    return NextResponse.json({ message: '複製元の案件が見つかりません' }, { status: 404 })
  }

  // ─── 案件名の重複回避（DB照合で最小の空き番号を採用） ────────
  const baseName = resolveBaseName(source.event_name)
  const { data: existingRows } = await supabase
    .from('cases')
    .select('event_name')
    .not('event_name', 'is', null)
    .ilike('event_name', `${baseName}%`)
  const existingNames = (existingRows ?? [])
    .map((r) => r.event_name)
    .filter((n): n is string => !!n)
  const newEventName = nextCopyName(baseName, existingNames)

  // ─── 引き継ぐ列・初期化する列の詰め替え ──────────────────────
  const insertData = buildDuplicateInsertData(source, {
    newEventName,
    inquiryDate: new Date().toISOString().slice(0, 10),
    userId: user.id,
  })
  // id / created_at / updated_at は指定しない（DB側で新規生成させる）

  // ─── 複製先の作成（INSERTのみ） ──────────────────────────────
  const { data: newCase, error: insertError } = await supabase
    .from('cases')
    .insert(insertData)
    .select()
    .single()

  if (insertError || !newCase) {
    console.error('[POST /api/cases/:id/duplicate] cases insert error:', insertError)
    return NextResponse.json(
      { message: `複製に失敗しました: ${insertError?.message ?? '不明なエラー'}` },
      { status: 500 }
    )
  }

  // ロールバック用ヘルパー: 作成済みの複製先案件を削除し、元案件には触れない
  const rollbackAndFail = async (message: string) => {
    await deleteCaseAndLogFailure(
      () => supabase.from('cases').delete().eq('id', newCase.id),
      newCase.id
    )
    return NextResponse.json({ message }, { status: 500 })
  }

  // ─── 関連データの複製: case_options / case_food_plans ─────────
  // checklist / files / hold_logs / history はここで一切SELECT/INSERTしない（複製対象外）
  const [{ data: options, error: optionsFetchError }, { data: foodPlans, error: foodPlansFetchError }] =
    await Promise.all([
      supabase.from('case_options').select('*').eq('case_id', params.id),
      supabase.from('case_food_plans').select('*').eq('case_id', params.id),
    ])

  if (optionsFetchError || foodPlansFetchError) {
    console.error('[POST /api/cases/:id/duplicate] related fetch error:', {
      optionsFetchError,
      foodPlansFetchError,
    })
    return rollbackAndFail('関連データの取得に失敗したため、複製を中止しました')
  }

  if (options && options.length > 0) {
    const optionRows = options.map((o) => ({
      case_id: newCase.id,
      option_id: o.option_id,
      name: o.name,
      category: o.category,
      machine_category: o.machine_category,
      qty: o.qty,
      unit_price: o.unit_price,
      unit: o.unit,
      state: o.state,
      note: o.note,
      sort_order: o.sort_order,
    }))
    const { error: optionsInsertError } = await supabase.from('case_options').insert(optionRows)
    if (optionsInsertError) {
      console.error('[POST /api/cases/:id/duplicate] case_options insert error:', optionsInsertError)
      return rollbackAndFail(`オプションの複製に失敗しました: ${optionsInsertError.message}`)
    }
  }

  if (foodPlans && foodPlans.length > 0) {
    const foodPlanRows = foodPlans.map((f) => ({
      case_id: newCase.id,
      food_plan_id: f.food_plan_id,
      name: f.name,
      qty: f.qty,
      unit_price: f.unit_price,
      state: f.state,
      sort_order: f.sort_order,
    }))
    const { error: foodPlansInsertError } = await supabase.from('case_food_plans').insert(foodPlanRows)
    if (foodPlansInsertError) {
      console.error('[POST /api/cases/:id/duplicate] case_food_plans insert error:', foodPlansInsertError)
      return rollbackAndFail(`飲食プランの複製に失敗しました: ${foodPlansInsertError.message}`)
    }
  }

  return NextResponse.json(newCase)
}
