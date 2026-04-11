import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff } from '@/lib/auth/helpers'
import { z } from 'zod'

type Params = { params: { id: string } }

const optionItemSchema = z.object({
  option_id:        z.string().uuid().nullable().optional(),
  name:             z.string().min(1, '名称は必須です').max(200),
  category:         z.enum(['equipment', 'machine']),
  machine_category: z.enum(['音響', '照明', '映像']).nullable().optional(),
  qty:              z.number().int().min(1).default(1),
  unit_price:       z.number().int().min(0).default(0),
  unit:             z.string().max(20).default('式'),
  state:            z.enum(['未確認', '質問中', '検討中', '確定', '不要']).default('未確認'),
  note:             z.string().max(500).optional().or(z.literal('')),
  sort_order:       z.number().int().min(0).default(0),
})

/**
 * amount は DB の GENERATED ALWAYS AS (qty * unit_price) STORED カラムのため
 * クライアントから送信されても無視する（DB側で自動計算される）
 */

/** GET /api/cases/[id]/options */
export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('case_options')
    .select('*, option_master(id, name)')
    .eq('case_id', params.id)
    .order('sort_order')

  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** POST /api/cases/[id]/options — オプション追加 */
export async function POST(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const parsed = optionItemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })
  }

  const vals = parsed.data

  // option_id が指定されている場合、マスタの default_price を unit_price として使用
  // クライアントから送られた unit_price も上書きせず、明示的に指定されたものを尊重する
  // ただし unit_price が 0 でかつ option_id がある場合はマスタから補完する
  if (vals.option_id && vals.unit_price === 0) {
    const { data: master } = await supabase
      .from('option_master')
      .select('default_price, unit')
      .eq('id', vals.option_id)
      .single()
    if (master) {
      vals.unit_price = master.default_price
      if (vals.unit === '式') vals.unit = master.unit
    }
  }

  // amount は GENERATED カラムなので送らない
  const { amount: _drop, ...insertData } = vals as any
  const { data, error: dbError } = await supabase
    .from('case_options')
    .insert({ ...insertData, case_id: params.id })
    .select()
    .single()

  if (dbError) return NextResponse.json({ message: '追加に失敗しました' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

/** PUT /api/cases/[id]/options — オプション単件更新 */
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
    unit:       z.string().max(20).optional(),
    state:      z.enum(['未確認', '質問中', '検討中', '確定', '不要']).optional(),
    note:       z.string().max(500).nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })
  }

  const { id, ...updates } = parsed.data
  // amount は GENERATED カラムなので送らない（Supabaseが自動計算）
  const { amount: _drop, ...safeUpdates } = updates as any

  const { data, error: dbError } = await supabase
    .from('case_options')
    .update(safeUpdates)
    .eq('id', id)
    .eq('case_id', params.id)
    .select()
    .single()

  if (dbError) {
    if (dbError.code === 'PGRST116') {
      return NextResponse.json({ message: '対象オプションが見つかりません' }, { status: 404 })
    }
    return NextResponse.json({ message: '更新に失敗しました' }, { status: 500 })
  }
  return NextResponse.json(data)
}

/** DELETE /api/cases/[id]/options?item_id=xxx */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('item_id')
  if (!itemId) return NextResponse.json({ message: 'item_id が必要です' }, { status: 400 })

  const { error: dbError } = await supabase
    .from('case_options')
    .delete()
    .eq('id', itemId)
    .eq('case_id', params.id)

  if (dbError) return NextResponse.json({ message: '削除に失敗しました' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
