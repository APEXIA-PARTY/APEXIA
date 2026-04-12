import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff, getCurrentUser } from '@/lib/auth/helpers'
import { caseFormSchema } from '@/lib/validations/case'
import { CaseStatus } from '@/types/database'
import { STATUS_CONFIG } from '@/lib/constants/status'

type Params = { params: { id: string } }

/**
 * GET /api/cases/[id]
 * 案件1件取得（関連データを含む）
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()

  const { data, error: dbError } = await supabase
    .from('cases')
    .select(
      `
      *,
      media_master (id, name, monthly_cost),
      contact_method_master (id, name),
      floor_master (id, name),
      event_category_master (id, name),
      event_subcategory_master (id, name, category_id),
      cancel_reason_master (id, name, is_auto_cancel),
      case_options (*, option_master (id, name)),
      case_checklist (*),
      case_files (*),
      case_hold_logs (*),
      case_history (*)
    `
    )
    .eq('id', params.id)
    .single()

  if (dbError) {
    if (dbError.code === 'PGRST116') {
      return NextResponse.json({ message: '案件が見つかりません' }, { status: 404 })
    }
    console.error('[GET /api/cases/[id]]', dbError)
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  return NextResponse.json(data)
}

/**
 * PUT /api/cases/[id]
 * 案件更新
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { error: authError } = await requireStaff()
  if (authError) return authError

  const user = await getCurrentUser()
  const supabase = await createClient()

  // 更新前の状態を取得（履歴記録用）
  const { data: existing } = await supabase
    .from('cases')
    .select('status, has_previewed')
    .eq('id', params.id)
    .single()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 })
  }

  const parsed = caseFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'バリデーションエラー', errors: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const values = parsed.data
  const cleanedValues = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v === '' ? null : v])
  ) as Record<string, unknown>

  // フロントから送られてきた has_previewed は信用しない
  delete cleanedValues.has_previewed

  const newStatus = values.status
  const currentHasPreviewed = existing?.has_previewed ?? false

  // has_previewed は previewed になった時だけ true にする
  if (newStatus === 'previewed') {
    cleanedValues.has_previewed = true
  } else if (currentHasPreviewed) {
    // 一度 true になったら、その後のステータス変更でも維持する
    cleanedValues.has_previewed = true
  }

  const { data, error: dbError } = await supabase
    .from('cases')
    .update(cleanedValues)
    .eq('id', params.id)
    .select()
    .single()

  if (dbError) {
    if (dbError.code === 'PGRST116') {
      return NextResponse.json({ message: '案件が見つかりません' }, { status: 404 })
    }
    console.error('[PUT /api/cases/[id]]', dbError)
    return NextResponse.json({ message: '案件の更新に失敗しました' }, { status: 500 })
  }

  // ステータス変更の場合は専用の履歴を記録
  const oldStatus = existing?.status as CaseStatus

  if (oldStatus && newStatus !== oldStatus) {
    await supabase.from('case_history').insert({
      case_id: params.id,
      action_type: 'status_change',
      message: `ステータスを「${STATUS_CONFIG[oldStatus]?.label}」から「${STATUS_CONFIG[newStatus]?.label}」に変更しました`,
      old_value: { status: oldStatus },
      new_value: { status: newStatus },
      changed_by: user?.id ?? null,
    })
  } else {
    await supabase.from('case_history').insert({
      case_id: params.id,
      action_type: 'update',
      message: '案件情報を更新しました',
      changed_by: user?.id ?? null,
    })
  }

  return NextResponse.json(data)
}

/**
 * DELETE /api/cases/[id]
 * 案件削除（staff 以上）
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { error: authError } = await requireStaff()
  if (authError) return authError

  const supabase = await createClient()

  const { error: dbError } = await supabase
    .from('cases')
    .delete()
    .eq('id', params.id)

  if (dbError) {
    console.error('[DELETE /api/cases/[id]]', dbError)
    return NextResponse.json({ message: '案件の削除に失敗しました' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}