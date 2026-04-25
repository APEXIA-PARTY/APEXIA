import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireAdmin } from '@/lib/auth/helpers'
import { reorderSchema } from '@/lib/validations/master'
import { ZodSchema } from 'zod'

function getAllowedKeys(schema: ZodSchema): Set<string> | null {
  let s: any = schema

  while (s && s._def) {
    const shape = s._def.shape

    if (shape && typeof shape === 'object') {
      return new Set(Object.keys(shape))
    }

    if (typeof shape === 'function') {
      return new Set(Object.keys(shape()))
    }

    if (s._def.schema) {
      s = s._def.schema
      continue
    }

    if (s._def.innerType) {
      s = s._def.innerType
      continue
    }

    break
  }

  return null
}

export function createMasterHandlers({
  tableName,
  schema,
  defaultOrder = 'display_order',
}: {
  tableName: string
  schema: ZodSchema
  defaultOrder?: string
}) {

  async function GET(request: NextRequest) {
    const { error } = await requireAuth()
    if (error) return error

    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const showAll = searchParams.get('all') === 'true'

    let query = supabase.from(tableName).select('*')

    if (defaultOrder) {
      query = query.order(defaultOrder, { ascending: true })
    }

    if (!showAll) {
      query = query.eq('is_active', true)
    }

    const { data, error: dbError } = await query

    if (dbError) {
      console.error(dbError)
      return NextResponse.json({ message: 'データ取得失敗' }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  }

  async function POST(request: NextRequest) {
    const { error } = await requireAdmin()
    if (error) return error

    const supabase = await createClient()
    const body = await request.json()

    const allowedKeys = getAllowedKeys(schema)

    const filtered = allowedKeys
      ? Object.fromEntries(Object.entries(body).filter(([k]) => allowedKeys.has(k)))
      : body

    const parsed = schema.safeParse(filtered)

    if (!parsed.success) {
      return NextResponse.json(parsed.error, { status: 422 })
    }

    const { data, error: dbError } = await supabase
      .from(tableName)
      .insert(parsed.data)
      .select()
      .single()

    if (dbError) {
      console.error(dbError)
      return NextResponse.json({ message: '追加失敗' }, { status: 500 })
    }

    return NextResponse.json(data)
  }

  return { GET, POST }
}

export function createMasterItemHandlers({
  tableName,
  schema,
}: {
  tableName: string
  schema: ZodSchema
}) {

  async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin()
  if (error) return error

  const supabase = await createClient()
  const body = await request.json()

  const allowedKeys = getAllowedKeys(schema)

  const filtered = allowedKeys
    ? Object.fromEntries(
        Object.entries(body).filter(([k]) =>
          allowedKeys.has(k) && k !== 'id'
        )
      )
    : body

  // 既存データ取得
  const { data: current, error: currentError } = await supabase
    .from(tableName)
    .select('*')
    .eq('id', params.id)
    .single()

  if (currentError || !current) {
    return NextResponse.json({ message: '対象データが見つかりません' }, { status: 404 })
  }

  // 既存 + 差分 を合成して検証
  const merged = { ...current, ...filtered }

  const parsed = schema.safeParse(merged)

  if (!parsed.success) {
    return NextResponse.json(parsed.error, { status: 422 })
  }

  const { data, error: dbError } = await supabase
    .from(tableName)
    .update(filtered) // 実際に更新するのは差分だけ
    .eq('id', params.id)
    .select()
    .single()

  if (dbError) {
    console.error(dbError)
    return NextResponse.json({ message: '更新失敗' }, { status: 500 })
  }

  return NextResponse.json(data)
}

  async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireAdmin()
    if (error) return error

    const supabase = await createClient()

    const { error: dbError } = await supabase
      .from(tableName)
      .update({ is_active: false })
      .eq('id', params.id)

    if (dbError) {
      console.error(dbError)
      return NextResponse.json({ message: '削除失敗' }, { status: 500 })
    }

    return new NextResponse(null, { status: 204 })
  }

  return { PUT, DELETE }
}

export async function handleReorder(request: NextRequest, tableName: string) {
  const { error } = await requireAdmin()
  if (error) return error

  const supabase = await createClient()
  const body = await request.json()

  const parsed = reorderSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(parsed.error, { status: 422 })
  }

  const updates = parsed.data.items.map(({ id, display_order }) =>
    supabase.from(tableName).update({ display_order }).eq('id', id)
  )

  await Promise.all(updates)

  return NextResponse.json({ ok: true })
}