import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, getCurrentUser } from '@/lib/auth/helpers'
import { z } from 'zod'

type Params = { params: { id: string } }

const holdSchema = z.object({
  hold_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  memo:         z.string().max(500).optional().or(z.literal('')),
})

/** GET /api/cases/[id]/hold — 仮押さえログ取得 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('case_hold_logs')
    .select('*')
    .eq('case_id', params.id)
    .maybeSingle()

  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? null)
}

/** POST /api/cases/[id]/hold — 仮押さえ作成（1案件1件制約） */
export async function POST(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const user = await getCurrentUser()
  const supabase = await createClient()

  // 既存チェック（UNIQUE 制約によりDBでも保護されているが事前確認）
  const { data: existing } = await supabase
    .from('case_hold_logs')
    .select('id')
    .eq('case_id', params.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ message: 'この案件には既に仮押さえが登録されています' }, { status: 409 })
  }

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const parsed = holdSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })

  const { data, error: dbError } = await supabase
    .from('case_hold_logs')
    .insert({
      case_id:    params.id,
      hold_date:  parsed.data.hold_date ?? null,
      memo:       parsed.data.memo ?? null,
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (dbError) {
    // UNIQUE 制約違反
    if (dbError.code === '23505') {
      return NextResponse.json({ message: 'この案件には既に仮押さえが登録されています' }, { status: 409 })
    }
    return NextResponse.json({ message: '仮押さえの登録に失敗しました' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

/** PUT /api/cases/[id]/hold — 仮押さえ更新（解除日・メモ） */
export async function PUT(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const parsed = holdSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ message: 'バリデーションエラー' }, { status: 422 })

  const { data, error: dbError } = await supabase
    .from('case_hold_logs')
    .update({
      hold_date:    parsed.data.hold_date ?? null,
      release_date: parsed.data.release_date ?? null,
      memo:         parsed.data.memo ?? null,
    })
    .eq('case_id', params.id)
    .select()
    .single()

  if (dbError) {
    if (dbError.code === 'PGRST116') {
      return NextResponse.json({ message: '仮押さえが見つかりません' }, { status: 404 })
    }
    return NextResponse.json({ message: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json(data)
}
