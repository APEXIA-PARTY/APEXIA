import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, getCurrentUser } from '@/lib/auth/helpers'
import { caseFormSchema, caseFilterSchema } from '@/lib/validations/case'
import { CaseStatus } from '@/types/database'

/**
 * GET /api/cases
 * 案件一覧取得（検索・フィルター・ページング対応）
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  // クエリパラメータをパース
  const filter = caseFilterSchema.parse({
    search: searchParams.get('search') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    media_id: searchParams.get('media_id') ?? undefined,
    floor_id: searchParams.get('floor_id') ?? undefined,
    event_category_id: searchParams.get('event_category_id') ?? undefined,
    contact_method_id: searchParams.get('contact_method_id') ?? undefined,
    year: searchParams.get('year') ?? undefined,
    month: searchParams.get('month') ?? undefined,
    page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
    pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : 20,
    sortBy: (searchParams.get('sortBy') as any) ?? 'inquiry_date',
    sortOrder: (searchParams.get('sortOrder') as any) ?? 'desc',
  })

  // ベースクエリ（マスタをJOIN）
  let query = supabase
    .from('cases')
    .select(
      `
      *,
      media_master (id, name),
      contact_method_master (id, name),
      floor_master (id, name),
      event_category_master (id, name),
      event_subcategory_master (id, name),
      cancel_reason_master (id, name, is_auto_cancel)
    `,
      { count: 'exact' }
    )

  // 検索（会社名・担当者・イベント名）
  if (filter.search) {
    query = query.or(
      `company.ilike.%${filter.search}%,contact.ilike.%${filter.search}%,event_name.ilike.%${filter.search}%`
    )
  }

  // フィルター
  if (filter.status) {
    query = query.eq('status', filter.status as CaseStatus)
  }
  if (filter.media_id) {
    query = query.eq('media_id', filter.media_id)
  }
  if (filter.floor_id) {
    query = query.eq('floor_id', filter.floor_id)
  }
  if (filter.event_category_id) {
    query = query.eq('event_category_id', filter.event_category_id)
  }
  if (filter.contact_method_id) {
    query = query.eq('contact_method_id', filter.contact_method_id)
  }

  // 年・月フィルター（inquiry_date ベース）
  if (filter.year) {
    query = query
      .gte('inquiry_date', `${filter.year}-01-01`)
      .lte('inquiry_date', `${filter.year}-12-31`)
  }
  if (filter.month) {
    // YYYY-MM 形式で受け取る
    const [y, m] = filter.month.split('-')
    const lastDay = new Date(Number(y), Number(m), 0).getDate()
    query = query
      .gte('inquiry_date', `${filter.month}-01`)
      .lte('inquiry_date', `${filter.month}-${lastDay}`)
  }

  // ソート
  query = query.order(filter.sortBy, { ascending: filter.sortOrder === 'asc' })

  // ページング
  const from = (filter.page - 1) * filter.pageSize
  const to = from + filter.pageSize - 1
  query = query.range(from, to)

  const { data, error: dbError, count } = await query

  if (dbError) {
    console.error('[GET /api/cases]', dbError)
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  })
}

/**
 * POST /api/cases
 * 案件新規作成
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const user = await getCurrentUser()
  const supabase = await createClient()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 })
  }

  // バリデーション
  const parsed = caseFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'バリデーションエラー', errors: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const values = parsed.data

  // 空文字は null に変換
  const cleanedValues = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v === '' ? null : v])
  )

  const { data, error: dbError } = await supabase
    .from('cases')
    .insert({
      ...cleanedValues,
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (dbError) {
    console.error('[POST /api/cases]', dbError)
    return NextResponse.json({ message: '案件の作成に失敗しました' }, { status: 500 })
  }

  // 作成履歴を記録
  await supabase.from('case_history').insert({
    case_id: data.id,
    action_type: 'create',
    message: '案件を作成しました',
    changed_by: user?.id ?? null,
  })

  return NextResponse.json(data, { status: 201 })
}
