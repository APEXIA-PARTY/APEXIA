import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth/helpers'
import { z } from 'zod'

type Params = { params: { id: string } }

const checklistItemSchema = z.object({
  item:       z.string().min(1, '確認事項を入力してください').max(500),
  state:      z.enum(['確認中', '確定']).default('確認中'),
  sort_order: z.number().int().min(0).default(0),
})

export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('case_checklist')
    .select('*')
    .eq('case_id', params.id)
    .order('sort_order')

  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const parsed = checklistItemSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })

  const { data, error: dbError } = await supabase
    .from('case_checklist')
    .insert({ ...parsed.data, case_id: params.id })
    .select()
    .single()

  if (dbError) return NextResponse.json({ message: '追加に失敗しました' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const schema = z.object({
    id:    z.string().uuid(),
    item:  z.string().min(1).max(500).optional(),
    state: z.enum(['確認中', '確定']).optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ message: 'バリデーションエラー' }, { status: 422 })

  const { id, ...updates } = parsed.data
  const { data, error: dbError } = await supabase
    .from('case_checklist')
    .update(updates)
    .eq('id', id)
    .eq('case_id', params.id)
    .select()
    .single()

  if (dbError) return NextResponse.json({ message: '更新に失敗しました' }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('item_id')
  if (!itemId) return NextResponse.json({ message: 'item_id が必要です' }, { status: 400 })

  const { error: dbError } = await supabase
    .from('case_checklist')
    .delete()
    .eq('id', itemId)
    .eq('case_id', params.id)

  if (dbError) return NextResponse.json({ message: '削除に失敗しました' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
