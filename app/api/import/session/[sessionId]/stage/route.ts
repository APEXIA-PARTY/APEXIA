/**
 * POST /api/import/session/[sessionId]/stage
 *
 * セッションの解析済みデータを cases_import_batch と cases_import_staging に保存する。
 *
 * 【安全保証】
 * - casesテーブルには一切 INSERT / UPDATE / DELETE しない
 * - cases_import_batch と cases_import_staging のみ操作する
 * - cases_import_session の status を 'staged' に更新する
 * - 個人情報をログに出力しない
 * - admin ロール必須
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import { PARSER_VERSION } from '@/lib/import/excel-parser'
import type { ParsedRow, StageResponse } from '@/types/import'

const IMPORT_VERSION = '1.0.0'

interface RouteParams {
  params: { sessionId: string }
}

export async function POST(_req: Request, { params }: RouteParams) {
  const { sessionId } = params

  // ── 認証・権限チェック ──────────────────────────────────────
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }

  // ── セッション確認 ──────────────────────────────────────────
  const { data: session, error: sessionError } = await supabase
    .from('cases_import_session')
    .select('id, filename, selected_sheet, parsed_rows, total_rows, status, expires_at, created_by')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ message: 'セッションが見つかりません' }, { status: 404 })
  }
  if (session.created_by !== user.id) {
    return NextResponse.json({ message: 'アクセス権限がありません' }, { status: 403 })
  }
  if (new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ message: 'セッションの有効期限が切れています' }, { status: 410 })
  }

  // ── status チェック：parsed のみ保存可能 ────────────────────
  if (session.status !== 'parsed') {
    if (session.status === 'staged') {
      return NextResponse.json(
        { message: 'このセッションはすでにstagingに保存済みです' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { message: 'シートの解析が完了していません。先にシートを選択して解析してください。' },
      { status: 400 }
    )
  }

  const parsedRows = (session.parsed_rows ?? []) as ParsedRow[]
  if (parsedRows.length === 0) {
    return NextResponse.json(
      { message: '保存対象のデータがありません' },
      { status: 400 }
    )
  }

  // ── cases_import_batch を作成 ────────────────────────────────
  // ※ casesテーブルは一切操作しない
  const { data: batch, error: batchError } = await supabase
    .from('cases_import_batch')
    .insert({
      session_id:     sessionId,
      filename:       session.filename,
      sheet_name:     session.selected_sheet,
      total_rows:     parsedRows.length,
      new_count:      0,   // 分類は次フェーズで実施
      duplicate_count: 0,
      review_count:   parsedRows.length,  // 初期は全件「要確認」
      skip_count:     0,
      import_version: IMPORT_VERSION,
      parser_version: PARSER_VERSION,
      applied:        false,
      created_by:     user.id,
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    console.error('[import/stage] batch作成エラー:', batchError?.code)
    return NextResponse.json(
      { message: 'バッチの作成に失敗しました' },
      { status: 500 }
    )
  }

  const batchId = batch.id

  // ── cases_import_staging に行ごと保存 ───────────────────────
  // ※ casesテーブルは一切操作しない
  // ※ classification は全件「要確認」（分類は次フェーズ）
  // ※ admin_decision は null（管理者がプレビュー画面で判断）
  const stagingRows = parsedRows.map((row) => ({
    batch_id:              batchId,
    row_number:            row.row,
    raw_payload:           row.raw_payload,

    company:               row.company,
    contact:               row.contact,
    phone:                 row.phone,
    email:                 row.email,
    inquiry_date:          row.inquiry_date,
    event_date:            row.event_date,
    event_name:            row.event_name,
    guest_count:           row.guest_count,
    notes:                 row.notes,
    estimate_amount:       row.estimate_amount,
    start_time:            row.start_time,
    end_time:              row.end_time,
    preview_date:          row.preview_date,
    has_previewed:         row.has_previewed,
    application_form_done: row.application_form_done,
    invoice_done:          row.invoice_done,
    payment_cash:          row.payment_cash,
    payment_prepaid:       row.payment_prepaid,

    floor_raw:             row.floor_raw,
    media_raw:             row.media_raw,
    event_category_raw:    row.event_category_raw,
    contact_method_raw:    row.contact_method_raw,
    cancel_reason_raw:     row.cancel_reason_raw,
    status_raw:            row.status_raw,

    // マスターID は次フェーズで照合
    floor_id:              null,
    media_id:              null,
    event_category_id:     null,
    contact_method_id:     null,
    cancel_reason_id:      null,

    // 初期分類は全件「要確認」
    classification:        '要確認',
    matched_case_id:       null,
    match_score:           null,
    review_notes:          '初期取込。分類は未実施。',
    admin_decision:        null,

    created_by:            user.id,
  }))

  // 大量データを一括 insert（Supabase は 1000件/回 まで）
  const CHUNK_SIZE = 500
  for (let i = 0; i < stagingRows.length; i += CHUNK_SIZE) {
    const chunk = stagingRows.slice(i, i + CHUNK_SIZE)
    const { error: stagingError } = await supabase
      .from('cases_import_staging')
      .insert(chunk)

    if (stagingError) {
      console.error('[import/stage] staging保存エラー:', stagingError.code, 'chunk:', i)
      // バッチを削除してロールバック（stagingはCASCADE削除される）
      const { error: deleteError } = await supabase
        .from('cases_import_batch')
        .delete()
        .eq('id', batchId)
      if (deleteError) {
        // ロールバック自体が失敗した場合: batch_id を明示してオペレーターに通知
        console.error('[import/stage] ロールバック失敗 batch_id:', batchId, 'code:', deleteError.code)
        return NextResponse.json(
          {
            message: `データ保存に失敗し、ロールバックも完了できませんでした。管理者に連絡してください。(batch_id: ${batchId})`,
          },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { message: 'データの保存中にエラーが発生しました。再度お試しください。' },
        { status: 500 }
      )
    }
  }

  // ── セッションを 'staged' に更新 ─────────────────────────────
  await supabase
    .from('cases_import_session')
    .update({ status: 'staged', updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('created_by', user.id)

  const response: StageResponse = {
    batch_id:   batchId,
    total_rows: parsedRows.length,
    message:    `${parsedRows.length}件を staging に保存しました。本番反映はまだ行われていません。`,
  }

  return NextResponse.json(response)
}
