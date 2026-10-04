import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff } from '@/lib/auth/helpers'
import { optionItemSchema, optionUpdateSchema } from '@/lib/validations/caseOption'

type Params = { params: { id: string } }

/**
 * amount は DB の GENERATED ALWAYS AS (ROUND(qty * unit_price)::BIGINT) STORED カラムのため
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

  const parsed = optionUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })
  }

  const { id, ...updates } = parsed.data

  // 小数数量は機材・オペレーター（machine）のみ。備品・設備（equipment）は整数のみ
  if (updates.qty !== undefined && !Number.isInteger(updates.qty)) {
    const { data: target } = await supabase
      .from('case_options')
      .select('category')
      .eq('id', id)
      .eq('case_id', params.id)
      .maybeSingle()
    if (target?.category === 'equipment') {
      return NextResponse.json({ message: '備品・設備の数量は整数で入力してください' }, { status: 422 })
    }
  }
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
