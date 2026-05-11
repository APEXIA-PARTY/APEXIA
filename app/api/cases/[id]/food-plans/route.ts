import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff } from '@/lib/auth/helpers'
import { z } from 'zod'

type Params = { params: { id: string } }

const foodPlanItemSchema = z.object({
  food_plan_id: z.string().uuid().nullable().optional(),
  name:         z.string().min(1, '名称は必須です').max(200),
  qty:          z.number().int().min(1).default(1),
  unit_price:   z.number().int().min(0).default(0),
  state:        z.enum(['未確認', '質問中', '検討中', '確定', '不要']).default('未確認'),
  sort_order:   z.number().int().min(0).default(0),
})

/** GET /api/cases/[id]/food-plans */
export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('case_food_plans')
    .select('*, food_plan_master(id, name)')
    .eq('case_id', params.id)
    .order('sort_order')

  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** POST /api/cases/[id]/food-plans — 飲食プラン追加 */
export async function POST(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const parsed = foodPlanItemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })
  }

  // amount は GENERATED ALWAYS AS (qty * unit_price) STORED なので送らない
  const { data, error: dbError } = await supabase
    .from('case_food_plans')
    .insert({ ...parsed.data, case_id: params.id })
    .select()
    .single()

  if (dbError) return NextResponse.json({ message: '追加に失敗しました' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

/** PUT /api/cases/[id]/food-plans — 単件更新 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const schema = z.object({
    id:         z.string().uuid(),
    name:       z.string().min(1).max(200).optional(),
    qty:        z.number().int().min(1).optional(),
    unit_price: z.number().int().min(0).optional(),
    state:      z.enum(['未確認', '質問中', '検討中', '確定', '不要']).optional(),
    sort_order: z.number().int().min(0).optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })
  }

  const { id, ...updates } = parsed.data

  const { data, error: dbError } = await supabase
    .from('case_food_plans')
    .update(updates)
    .eq('id', id)
    .eq('case_id', params.id)
    .select()
    .single()

  if (dbError) {
    if (dbError.code === 'PGRST116') {
      return NextResponse.json({ message: '対象レコードが見つかりません' }, { status: 404 })
    }
    return NextResponse.json({ message: '更新に失敗しました' }, { status: 500 })
  }
  return NextResponse.json(data)
}

/** DELETE /api/cases/[id]/food-plans?item_id=xxx */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('item_id')
  if (!itemId) return NextResponse.json({ message: 'item_id が必要です' }, { status: 400 })

  const { error: dbError } = await supabase
    .from('case_food_plans')
    .delete()
    .eq('id', itemId)
    .eq('case_id', params.id)

  if (dbError) return NextResponse.json({ message: '削除に失敗しました' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
