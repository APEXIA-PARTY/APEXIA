import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff } from '@/lib/auth/helpers'
import { shouldSetConfirmedAt } from '@/lib/cases/statusTransition'
import type { CaseStatus } from '@/types/database'

// ─── レガシーカラム（UIで直接編集しない / Zodが undefined→null に変換してしまう）
// これらは body に含まれても Supabase に送らない
const STRIP_FIELDS = [
  'setup_time',    // load_in_time に統合済み（UIでは load_in_time を使用）
  'strike_time',   // full_exit_time に統合済み（UIでは full_exit_time を使用）
  'has_previewed', // 内部フラグ（API で別途管理）
  'id',            // 上書き不可
  'created_at',    // 上書き不可
  'updated_at',    // Supabase trigger で自動更新
  'created_by',    // 上書き不可
  'confirmed_at',  // クライアントから直接指定不可。ステータス遷移検知時にサーバー側でのみセットする
] as const

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error) {
    console.error('[GET /api/cases/:id]', error)
    return NextResponse.json({ message: '案件取得失敗' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireStaff()
  if (authError) return authError

  const supabase = await createClient()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 })
  }

  // レガシー / 不変カラムを除去
  const updateData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!(STRIP_FIELDS as readonly string[]).includes(key)) {
      updateData[key] = value
    }
  }

  // ─── confirmed_at の自動セット ────────────────────────────────
  // ステータスが収益ステータス（confirmed/done）へ新規突入した場合のみセットする。
  // それ以外（confirmed→cancelled等）は confirmed_at に一切触れない（史実として残す）。
  if ('status' in updateData) {
    const { data: current, error: currentFetchError } = await supabase
      .from('cases')
      .select('status')
      .eq('id', params.id)
      .single()

    if (currentFetchError || !current) {
      // 旧ステータスを確認できない場合は confirmed_at に一切触れない（安全側に倒す）。
      // ここで undefined 扱いにして進めると、既に確定済みの案件を再保存しただけで
      // confirmed_at が誤って上書きされる恐れがあるため。
      console.error('[PUT /api/cases/:id] confirmed_at判定用の現在ステータス取得に失敗:', currentFetchError)
    } else if (shouldSetConfirmedAt(current.status as CaseStatus, updateData.status as CaseStatus)) {
      updateData.confirmed_at = new Date().toISOString()
    }
  }

  const { data, error } = await supabase
    .from('cases')
    .update(updateData)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    // エラー詳細をサーバーログとレスポンスの両方に出す
    console.error('[PUT /api/cases/:id] Supabase error:', {
      message: error.message,
      code: error.code,
      hint: error.hint,
      details: error.details,
    })
    return NextResponse.json(
      {
        message: `更新失敗: ${error.message}`,
        code: error.code ?? null,
        hint: error.hint ?? null,
        details: error.details ?? null,
      },
      { status: 500 }
    )
  }

  return NextResponse.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireStaff()
  if (authError) return authError

  const supabase = await createClient()
  const caseId = params.id

  try {
    // 子テーブルを先に削除（外部キー対策）
    await supabase.from('case_history').delete().eq('case_id', caseId)
    await supabase.from('case_options').delete().eq('case_id', caseId)
    await supabase.from('case_checklist').delete().eq('case_id', caseId)
    await supabase.from('case_files').delete().eq('case_id', caseId)
    await supabase.from('case_hold_logs').delete().eq('case_id', caseId)

    // case_food_plans は ON DELETE CASCADE で自動削除されるが念のため
    await supabase.from('case_food_plans').delete().eq('case_id', caseId)

    // 最後に親
    const { error } = await supabase
      .from('cases')
      .delete()
      .eq('id', caseId)

    if (error) {
      console.error('[DELETE /api/cases/:id]', error)
      return NextResponse.json({ message: '削除失敗' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/cases/:id] unexpected error:', e)
    return NextResponse.json({ message: '削除失敗' }, { status: 500 })
  }
}
