import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireAdmin } from '@/lib/auth/helpers'
import { reorderSchema } from '@/lib/validations/master'
import { ZodSchema } from 'zod'

interface MasterApiOptions {
  tableName: string
  schema: ZodSchema                      // 追加/更新用 Zod スキーマ
  defaultOrder?: string                  // デフォルトソートカラム
  extraSelectColumns?: string            // JOIN など追加 SELECT
  extraFilters?: (query: any, params: URLSearchParams) => any  // 追加フィルター
}

/**
 * マスタテーブル共通 CRUD ハンドラファクトリ
 * 各マスタの route.ts から呼び出して使う
 */
export function createMasterHandlers({
  tableName,
  schema,
  defaultOrder = 'display_order',
  extraSelectColumns = '',
  extraFilters,
}: MasterApiOptions) {

  // GET: 一覧取得
  // ?all=true で無効レコードも含む（マスタ管理画面用）
  // ?all=false or 省略で is_active=true のみ（案件フォーム用）
  async function GET(request: NextRequest) {
    const { error } = await requireAuth()
    if (error) return error

    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const showAll = searchParams.get('all') === 'true'

    const selectCols = extraSelectColumns ? `*, ${extraSelectColumns}` : '*'
    let query = supabase
      .from(tableName)
      .select(selectCols)
      .order(defaultOrder, { ascending: true })

    if (!showAll) {
      query = query.eq('is_active', true)
    }

    if (extraFilters) {
      query = extraFilters(query, searchParams)
    }

    const { data, error: dbError } = await query
    if (dbError) {
      console.error(`[GET /api/master/${tableName}]`, dbError)
      return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
    }
    return NextResponse.json(data ?? [])
  }

  // POST: 新規追加
  async function POST(request: NextRequest) {
    const { error } = await requireAdmin()
    if (error) return error

    const supabase = await createClient()
    let body: unknown
    try { body = await request.json() }
    catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'バリデーションエラー', errors: parsed.error.flatten() },
        { status: 422 }
      )
    }

    // display_order が未指定の場合は末尾に追加
    const values = parsed.data as any
    if (values.display_order === undefined || values.display_order === 0) {
      const { count } = await supabase
        .from(tableName).select('*', { count: 'exact', head: true })
      values.display_order = count ?? 0
    }

    const { data, error: dbError } = await supabase
      .from(tableName).insert(values).select().single()
    if (dbError) {
      console.error(`[POST /api/master/${tableName}]`, dbError)
      return NextResponse.json({ message: '追加に失敗しました' }, { status: 500 })
    }
    return NextResponse.json(data, { status: 201 })
  }

  return { GET, POST }
}

/**
 * 単件操作ハンドラファクトリ（PUT / DELETE）
 */
export function createMasterItemHandlers({
  tableName,
  schema,
}: Pick<MasterApiOptions, 'tableName' | 'schema'>) {

  async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireAdmin()
    if (error) return error

    const supabase = await createClient()
    let body: unknown
    try { body = await request.json() }
    catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

    // 部分更新対応: partial() で全フィールド省略可
    const parsed = (schema as any).partial().safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'バリデーションエラー', errors: parsed.error.flatten() },
        { status: 422 }
      )
    }

    const { data, error: dbError } = await supabase
      .from(tableName)
      .update(parsed.data)
      .eq('id', params.id)
      .select()
      .single()

    if (dbError) {
      if (dbError.code === 'PGRST116') {
        return NextResponse.json({ message: '対象が見つかりません' }, { status: 404 })
      }
      console.error(`[PUT /api/master/${tableName}/${params.id}]`, dbError)
      return NextResponse.json({ message: '更新に失敗しました' }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  // 物理削除はせず is_active=false にするが、
  // DELETEメソッドとして受け取り論理削除を実行する
  async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireAdmin()
    if (error) return error

    const supabase = await createClient()
    const { error: dbError } = await supabase
      .from(tableName)
      .update({ is_active: false })
      .eq('id', params.id)

    if (dbError) {
      console.error(`[DELETE /api/master/${tableName}/${params.id}]`, dbError)
      return NextResponse.json({ message: '無効化に失敗しました' }, { status: 500 })
    }
    return new NextResponse(null, { status: 204 })
  }

  return { PUT, DELETE }
}

/**
 * 並び替えハンドラ（PATCH /api/master/[table]）
 */
export async function handleReorder(
  request: NextRequest,
  tableName: string
): Promise<NextResponse> {
  const { error } = await requireAdmin()
  if (error) return error as NextResponse

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const parsed = reorderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'バリデーションエラー', errors: parsed.error.flatten() },
      { status: 422 }
    )
  }

  // 各行の display_order を一括更新
  const updates = parsed.data.items.map(({ id, display_order }) =>
    supabase.from(tableName).update({ display_order }).eq('id', id)
  )

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    console.error(`[PATCH /api/master/${tableName}]`, failed.error)
    return NextResponse.json({ message: '並び替えの保存に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
