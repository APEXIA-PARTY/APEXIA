/**
 * GET /api/import/batch/[batchId]
 *
 * バッチ情報と staging 行一覧を返す。
 *
 * 【安全保証】
 * - casesテーブルには一切 INSERT / UPDATE / DELETE しない（SELECT のみ）
 * - 自分が作成したバッチのみ参照可能（RLS + created_by チェック）
 * - admin ロール必須
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import type { BatchDetail } from '@/types/import'

interface RouteParams {
  params: { batchId: string }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { batchId } = params

  // ── 認証・権限チェック ──────────────────────────────────────
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }

  // ── バッチ取得 ──────────────────────────────────────────────
  const { data: batch, error: batchError } = await supabase
    .from('cases_import_batch')
    .select('id, session_id, filename, sheet_name, total_rows, new_count, duplicate_count, review_count, skip_count, applied, applied_at, applied_by, created_at, created_by')
    .eq('id', batchId)
    .single()

  if (batchError || !batch) {
    return NextResponse.json({ message: 'バッチが見つかりません' }, { status: 404 })
  }
  if (batch.created_by !== user.id) {
    return NextResponse.json({ message: 'アクセス権限がありません' }, { status: 403 })
  }

  // ── staging 行取得 ──────────────────────────────────────────
  const { data: stagingRows, error: stagingError } = await supabase
    .from('cases_import_staging')
    .select('*')
    .eq('batch_id', batchId)
    .eq('created_by', user.id)
    .order('row_number', { ascending: true })

  if (stagingError) {
    console.error('[import/batch/get] staging取得エラー:', stagingError.code)
    return NextResponse.json({ message: 'データの取得に失敗しました' }, { status: 500 })
  }

  const response: BatchDetail = {
    id:             batch.id,
    session_id:     batch.session_id,
    filename:       batch.filename,
    sheet_name:     batch.sheet_name,
    total_rows:     batch.total_rows,
    new_count:      batch.new_count,
    duplicate_count: batch.duplicate_count,
    review_count:   batch.review_count,
    skip_count:     batch.skip_count,
    applied:        batch.applied,
    applied_at:     batch.applied_at,
    applied_by:     batch.applied_by,
    created_at:     batch.created_at,
    staging_rows:   stagingRows ?? [],
  }

  return NextResponse.json(response)
}
