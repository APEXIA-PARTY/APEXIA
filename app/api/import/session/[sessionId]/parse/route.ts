/**
 * POST /api/import/session/[sessionId]/parse
 *
 * 選択したシートを解析し、プレビュー用データを返す。
 * 解析結果を cases_import_session に保存する。
 *
 * 【安全保証】
 * - casesテーブルには一切 INSERT / UPDATE / DELETE しない
 * - cases_import_session の parsed_rows / status のみ更新する
 * - 個人情報をログに出力しない
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import { parseSheet } from '@/lib/import/excel-parser'
import type { ParseSheetResponse } from '@/types/import'

interface RouteParams {
  params: { sessionId: string }
}

export async function POST(req: Request, { params }: RouteParams) {
  const { sessionId } = params

  // ── 認証・権限チェック ──────────────────────────────────────
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }

  // ── セッション確認（自分のセッションか・有効期限内か）────────
  const { data: session, error: sessionError } = await supabase
    .from('cases_import_session')
    .select('id, status, expires_at, created_by')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ message: 'セッションが見つかりません' }, { status: 404 })
  }
  // RLSにより自分のセッションしか取得できないが、念のため確認
  if (session.created_by !== user.id) {
    return NextResponse.json({ message: 'アクセス権限がありません' }, { status: 403 })
  }
  if (new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ message: 'セッションの有効期限が切れています' }, { status: 410 })
  }
  if (session.status === 'staged') {
    return NextResponse.json(
      { message: 'このセッションはすでにstagingに保存済みです' },
      { status: 409 }
    )
  }

  // ── リクエスト受け取り ──────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ message: 'リクエストの読み取りに失敗しました' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const sheetName = formData.get('sheet_name') as string | null

  if (!file) {
    return NextResponse.json({ message: 'ファイルが見つかりません' }, { status: 400 })
  }
  if (!sheetName || !sheetName.trim()) {
    return NextResponse.json({ message: 'シート名が指定されていません' }, { status: 400 })
  }

  // ── Excel解析 ──────────────────────────────────────────────
  let parseResult: Awaited<ReturnType<typeof parseSheet>>
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    parseResult = parseSheet(buffer, sheetName.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : '解析エラー'
    return NextResponse.json(
      { message: `シートの解析に失敗しました: ${msg}` },
      { status: 400 }
    )
  }

  const { rows, errorRows } = parseResult

  // ── cases_import_session を更新（status='parsed'）──────────
  // ※ casesテーブルは一切操作しない
  const { error: updateError } = await supabase
    .from('cases_import_session')
    .update({
      selected_sheet: sheetName.trim(),
      parsed_rows: rows,           // ParsedRow[] を jsonb として保存
      total_rows: rows.length,
      error_rows: errorRows,
      status: 'parsed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('created_by', user.id)    // 二重チェック

  if (updateError) {
    console.error('[import/parse] セッション更新エラー:', updateError.code)
    return NextResponse.json(
      { message: 'セッションの更新に失敗しました' },
      { status: 500 }
    )
  }

  const response: ParseSheetResponse = {
    session_id: sessionId,
    sheet_name: sheetName.trim(),
    total_rows: rows.length,
    error_rows: errorRows,
    rows,
  }

  return NextResponse.json(response)
}
