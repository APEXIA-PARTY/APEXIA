import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import { createMasterItemHandlers } from '../../_crud'
import { foodPlanSchema } from '@/lib/validations/master'

// DELETE は _crud.ts の汎用実装をそのまま使う。
// スキーマ検証を一切通らず is_active を false にするだけのため、
// 単価未設定の既存プランでも問題なく無効化できる。
const { DELETE } = createMasterItemHandlers({
  tableName: 'food_plan_master',
  schema: foodPlanSchema,
})
export { DELETE }

/**
 * PUT /api/master/food-plans/[id]
 *
 * food_plan_master 専用の更新処理。_crud.ts の汎用 PUT は使わない。
 *
 * - { is_active: boolean } だけを送る有効/無効切替は、単価チェックを行わず
 *   is_active のみを更新する（既存の単価未設定プランでも成功させるため）。
 * - それ以外（名称・単価・表示順を含む通常の編集保存）は、更新後の
 *   default_price が null になる場合は 422 で拒否する。
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin()
  if (error) return error

  const supabase = await createClient()

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 })
  }

  const bodyKeys = Object.keys(body as Record<string, unknown>)

  // ─── 有効/無効切替（is_active だけの送信）: 単価チェックをスキップ ──
  if (bodyKeys.length === 1 && bodyKeys[0] === 'is_active') {
    const { is_active } = body as { is_active: unknown }
    if (typeof is_active !== 'boolean') {
      return NextResponse.json({ message: 'is_active は真偽値である必要があります' }, { status: 422 })
    }

    const { data, error: dbError } = await supabase
      .from('food_plan_master')
      .update({ is_active })
      .eq('id', params.id)
      .select()
      .single()

    if (dbError) {
      console.error(dbError)
      return NextResponse.json({ message: '更新失敗' }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  // ─── 通常の編集保存: 単価を必須として検証 ──────────────────────
  const allowedKeys = new Set(['name', 'default_price', 'display_order', 'is_active'])
  const filtered = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([k]) => allowedKeys.has(k))
  )

  const { data: current, error: currentError } = await supabase
    .from('food_plan_master')
    .select('*')
    .eq('id', params.id)
    .single()

  if (currentError || !current) {
    return NextResponse.json({ message: '対象データが見つかりません' }, { status: 404 })
  }

  const merged = { ...current, ...filtered }

  const parsed = foodPlanSchema.safeParse(merged)
  if (!parsed.success) {
    // 単価が空欄（null/未指定）だった場合を分かりやすいメッセージにする
    const priceIssue = parsed.error.issues.some((i) => i.path[0] === 'default_price')
    if (priceIssue) {
      return NextResponse.json({ message: '単価を入力してください' }, { status: 422 })
    }
    return NextResponse.json(parsed.error, { status: 422 })
  }

  const { data, error: dbError } = await supabase
    .from('food_plan_master')
    .update(filtered)
    .eq('id', params.id)
    .select()
    .single()

  if (dbError) {
    console.error(dbError)
    return NextResponse.json({ message: '更新失敗' }, { status: 500 })
  }

  return NextResponse.json(data)
}
