/**
 * POST /api/import/batch/[batchId]/classify
 *
 * staging 行に対してマスター照合と重複チェックを実行し、分類結果を保存する。
 * 照合キー: company（完全一致・大文字小文字無視） + event_date（完全一致）
 *
 * 【安全保証】
 * - casesテーブルへの INSERT / UPDATE / DELETE は行わない（SELECT のみ）
 * - cases_import_staging と cases_import_batch のみ更新する
 * - 個人情報をログに出力しない
 * - admin ロール必須
 * - 未反映バッチ（applied=false）のみ対象
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import type { ClassifyResponse, StagingClassification } from '@/types/import'

interface RouteParams {
  params: { batchId: string }
}

interface MasterRow { id: string; name: string }

/** マスター名から ID を解決（大文字小文字無視・前後空白除去） */
function resolveId(raw: string | null, masters: MasterRow[]): string | null {
  if (!raw || !raw.trim()) return null
  const normalized = raw.trim().toLowerCase()
  return masters.find(m => m.name.trim().toLowerCase() === normalized)?.id ?? null
}

export async function POST(_req: Request, { params }: RouteParams) {
  const { batchId } = params

  // ── 認証・権限チェック ──────────────────────────────────────
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }

  // ── バッチ確認 ──────────────────────────────────────────────
  const { data: batch, error: batchError } = await supabase
    .from('cases_import_batch')
    .select('id, applied, created_by')
    .eq('id', batchId)
    .single()

  if (batchError || !batch) {
    return NextResponse.json({ message: 'バッチが見つかりません' }, { status: 404 })
  }
  if (batch.created_by !== user.id) {
    return NextResponse.json({ message: 'アクセス権限がありません' }, { status: 403 })
  }
  if (batch.applied) {
    return NextResponse.json({ message: 'このバッチはすでに反映済みです' }, { status: 409 })
  }

  // ── staging 行取得 ──────────────────────────────────────────
  const { data: stagingRows, error: stagingError } = await supabase
    .from('cases_import_staging')
    .select('id, company, event_date, floor_raw, media_raw, event_category_raw, contact_method_raw, cancel_reason_raw')
    .eq('batch_id', batchId)
    .eq('created_by', user.id)

  if (stagingError || !stagingRows) {
    console.error('[classify] staging取得エラー:', stagingError?.code)
    return NextResponse.json({ message: 'データの取得に失敗しました' }, { status: 500 })
  }

  // ── マスターテーブル一括取得 ──────────────────────────────────
  const [floorRes, mediaRes, eventCatRes, contactRes, cancelRes] = await Promise.all([
    supabase.from('floor_master').select('id, name').eq('is_active', true),
    supabase.from('media_master').select('id, name').eq('is_active', true),
    supabase.from('event_category_master').select('id, name').eq('is_active', true),
    supabase.from('contact_method_master').select('id, name').eq('is_active', true),
    supabase.from('cancel_reason_master').select('id, name').eq('is_active', true),
  ])

  const floorMasters:    MasterRow[] = floorRes.data    ?? []
  const mediaMasters:    MasterRow[] = mediaRes.data    ?? []
  const eventCatMasters: MasterRow[] = eventCatRes.data ?? []
  const contactMasters:  MasterRow[] = contactRes.data  ?? []
  const cancelMasters:   MasterRow[] = cancelRes.data   ?? []

  // ── 既存 cases から重複チェック用データを取得 ──────────────────
  // company + event_date の一致のみ確認（SELECT のみ、cases は変更しない）
  const validPairs = stagingRows.filter(r => r.company && r.event_date)

  // 重複チェック: 照合対象の event_date 範囲で cases を取得
  const eventDatesSet = new Set(validPairs.map(r => r.event_date as string))
  const eventDates = Array.from(eventDatesSet)

  let existingCaseMap = new Map<string, string>() // "company_lower|event_date" → case_id

  if (eventDates.length > 0) {
    const { data: existingCases } = await supabase
      .from('cases')
      .select('id, company, event_date')
      .in('event_date', eventDates)

    if (existingCases) {
      for (const c of existingCases) {
        if (c.company && c.event_date) {
          const key = `${c.company.trim().toLowerCase()}|${c.event_date}`
          existingCaseMap.set(key, c.id)
        }
      }
    }
  }

  // ── 各 staging 行を分類 ───────────────────────────────────────
  let newCount = 0, dupCount = 0, reviewCount = 0

  const updates = stagingRows.map(row => {
    const floor_id            = resolveId(row.floor_raw,          floorMasters)
    const media_id            = resolveId(row.media_raw,          mediaMasters)
    const event_category_id   = resolveId(row.event_category_raw, eventCatMasters)
    const contact_method_id   = resolveId(row.contact_method_raw, contactMasters)
    const cancel_reason_id    = resolveId(row.cancel_reason_raw,  cancelMasters)

    // 重複チェック（company + event_date 両方ある行のみ）
    const key = row.company && row.event_date
      ? `${row.company.trim().toLowerCase()}|${row.event_date}`
      : null
    const matched_case_id = key ? (existingCaseMap.get(key) ?? null) : null
    const isDuplicate = matched_case_id !== null

    // マスター未解決フィールドの収集
    const unresolved: string[] = []
    if (row.floor_raw          && !floor_id)          unresolved.push(`フロア「${row.floor_raw}」`)
    if (row.media_raw          && !media_id)          unresolved.push(`認知経路「${row.media_raw}」`)
    if (row.event_category_raw && !event_category_id) unresolved.push(`イベント内容「${row.event_category_raw}」`)
    if (row.contact_method_raw && !contact_method_id) unresolved.push(`連絡方法「${row.contact_method_raw}」`)
    if (row.cancel_reason_raw  && !cancel_reason_id)  unresolved.push(`キャンセル理由「${row.cancel_reason_raw}」`)

    // 分類決定（優先順位: company欠損 > 重複候補 > マスター未解決 > 新規追加）
    let classification: StagingClassification
    let review_notes: string

    const noCompany = !row.company || !row.company.trim()

    if (noCompany) {
      // company が null/空 → 最優先で要確認（apply でサイレントスキップされるため UI で止める）
      classification = '要確認'
      review_notes   = unresolved.length > 0
        ? `会社名なし（担当者のみ） / マスター未登録: ${unresolved.join('、')}`
        : '会社名なし（担当者のみ）'
      reviewCount++
    } else if (isDuplicate) {
      classification = '重複候補'
      review_notes   = `既存案件（${matched_case_id}）と会社名・開催日が一致`
      dupCount++
    } else if (unresolved.length > 0) {
      classification = '要確認'
      review_notes   = `マスター未登録: ${unresolved.join('、')}`
      reviewCount++
    } else {
      classification = '新規追加'
      review_notes   = '照合問題なし'
      newCount++
    }

    return {
      id: row.id,
      floor_id,
      media_id,
      event_category_id,
      contact_method_id,
      cancel_reason_id,
      classification,
      matched_case_id,
      match_score:  isDuplicate ? 90 : null,
      review_notes,
      updated_at:   new Date().toISOString(),
    }
  })

  // ── staging 行を並列更新 ──────────────────────────────────────
  const updateResults = await Promise.all(
    updates.map(u =>
      supabase
        .from('cases_import_staging')
        .update({
          floor_id:          u.floor_id,
          media_id:          u.media_id,
          event_category_id: u.event_category_id,
          contact_method_id: u.contact_method_id,
          cancel_reason_id:  u.cancel_reason_id,
          classification:    u.classification,
          matched_case_id:   u.matched_case_id,
          match_score:       u.match_score,
          review_notes:      u.review_notes,
          updated_at:        u.updated_at,
        })
        .eq('id', u.id)
        .eq('created_by', user.id)
    )
  )

  const failedUpdates = updateResults.filter(r => r.error)
  if (failedUpdates.length > 0) {
    console.error('[classify] staging更新エラー件数:', failedUpdates.length,
      'code:', failedUpdates[0].error?.code)
    return NextResponse.json({ message: '分類結果の保存中にエラーが発生しました' }, { status: 500 })
  }

  // ── バッチのカウントを更新 ───────────────────────────────────
  await supabase
    .from('cases_import_batch')
    .update({
      new_count:       newCount,
      duplicate_count: dupCount,
      review_count:    reviewCount,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', batchId)
    .eq('created_by', user.id)

  const response: ClassifyResponse = {
    batch_id:    batchId,
    total_rows:  stagingRows.length,
    new_count:   newCount,
    duplicate_count: dupCount,
    review_count: reviewCount,
    message:     `照合完了: 新規${newCount}件、重複候補${dupCount}件、要確認${reviewCount}件`,
  }

  return NextResponse.json(response)
}
