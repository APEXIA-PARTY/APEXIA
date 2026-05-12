/**
 * POST /api/import/batch/[batchId]/apply
 *
 * 管理者が承認した staging 行を cases テーブルに反映する。
 * cases_import_log に操作記録を残す。
 *
 * 【安全保証】
 * - batch.applied = false の場合のみ実行可能（二重反映防止）
 * - admin_decision = 'approve' の行のみ cases に INSERT する
 * - UPDATE は行わない（新規 INSERT のみ）
 * - INSERT 失敗時は挿入済みの cases を DELETE してロールバック
 * - 個人情報をログに出力しない
 * - admin ロール必須
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import type { ApplyResponse } from '@/types/import'

interface RouteParams {
  params: { batchId: string }
}

interface ApplyRequestBody {
  // staging_id → 'approve' | 'skip'
  decisions: Record<string, 'approve' | 'skip'>
}

/** payment_method 文字列を導出（007_update_payment_method.sql 適用後の新値） */
function toPaymentMethod(cash: boolean, prepaid: boolean): string | null {
  if (cash && prepaid) return '当日キャッシュレス+現金'
  if (cash)           return '当日現金'
  if (prepaid)        return '当日キャッシュレス'
  return null
}

/** status_raw が cases.status の CHECK 制約に合うか検証 */
const VALID_STATUSES = ['inquiry', 'preview_adj', 'previewed', 'tentative', 'confirmed', 'cancelled', 'done']
function toValidStatus(raw: string): string {
  return VALID_STATUSES.includes(raw) ? raw : 'inquiry'
}

export async function POST(req: Request, { params }: RouteParams) {
  const { batchId } = params

  // ── 認証・権限チェック ──────────────────────────────────────
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }

  // ── リクエスト解析 ──────────────────────────────────────────
  let body: ApplyRequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ message: 'リクエストの読み取りに失敗しました' }, { status: 400 })
  }

  const { decisions } = body
  if (!decisions || typeof decisions !== 'object') {
    return NextResponse.json({ message: 'decisions が不正です' }, { status: 400 })
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

  // ── 承認対象の staging 行を取得 ─────────────────────────────
  const approvedIds = Object.entries(decisions)
    .filter(([, d]) => d === 'approve')
    .map(([id]) => id)

  const skippedIds = Object.entries(decisions)
    .filter(([, d]) => d === 'skip')
    .map(([id]) => id)

  if (approvedIds.length === 0 && skippedIds.length === 0) {
    return NextResponse.json({ message: '対象行がありません' }, { status: 400 })
  }

  // 承認行の詳細を取得
  const { data: approvedRows, error: rowsError } = approvedIds.length > 0
    ? await supabase
        .from('cases_import_staging')
        .select('*')
        .in('id', approvedIds)
        .eq('batch_id', batchId)
        .eq('created_by', user.id)
    : { data: [], error: null }

  if (rowsError) {
    console.error('[apply] staging取得エラー:', rowsError.code)
    return NextResponse.json({ message: 'データの取得に失敗しました' }, { status: 500 })
  }

  // ── cases へ INSERT（承認行のみ） ─────────────────────────────
  const insertedCaseIds: string[] = []
  let provisionalCompany = 0  // company空→担当者名（仮）で仮反映した件数
  let skippedNullCompany = 0  // company・contact両方空でスキップした件数

  for (const row of (approvedRows ?? [])) {
    // ── company 決定 ──────────────────────────────────────────
    // company空 + contact有り → 担当者名（仮）で仮反映（後から案件詳細で修正前提）
    // company空 + contact空   → 照合不能のためスキップ
    let insertCompany = row.company?.trim() ?? ''
    if (!insertCompany) {
      const contactName = row.contact?.trim() ?? ''
      if (contactName) {
        insertCompany = `${contactName}（仮）`
        provisionalCompany++
        console.warn('[apply] company空→仮会社名で仮反映 row_number:', row.row_number)
      } else {
        skippedNullCompany++
        console.warn('[apply] company・contact両方空のためスキップ row_number:', row.row_number)
        continue
      }
    }

    // ── master ID: 未解決（null）はそのまま通す ───────────────
    // classify 時点で未登録マスターは null のまま staging に保存済み。
    // apply では null を cases に INSERT し、後から案件詳細で修正する運用を前提とする。
    // cases テーブル側の FK カラムはすべて nullable のため DB エラーにはならない。

    const { data: newCase, error: insertError } = await supabase
      .from('cases')
      .insert({
        company:                insertCompany,
        contact:                row.contact,
        phone:                  row.phone,
        email:                  row.email,
        inquiry_date:           row.inquiry_date ?? new Date().toISOString().slice(0, 10),
        event_date:             row.event_date,
        event_name:             row.event_name,
        guest_count:            row.guest_count,
        notes:                  row.notes,
        estimate_amount:        row.estimate_amount ?? 0,
        floor_id:               row.floor_id,
        media_id:               row.media_id,
        event_category_id:      row.event_category_id,
        contact_method_id:      row.contact_method_id,
        cancel_reason_id:       row.cancel_reason_id,
        start_time:             row.start_time,
        end_time:               row.end_time,
        // preview_date (DATE) → preview_datetime (TIMESTAMPTZ)
        preview_datetime:       row.preview_date
                                  ? new Date(row.preview_date + 'T00:00:00').toISOString()
                                  : null,
        application_form_status: row.application_form_done ? '済み' : '未対応',
        delivery_notice_status: '未対応',
        invoice_status:         row.invoice_done ? '送付済み' : '未対応',
        payment_method:         toPaymentMethod(row.payment_cash, row.payment_prepaid),
        status:                 toValidStatus(row.status_raw),
        created_by:             user.id,
      })
      .select('id')
      .single()

    if (insertError || !newCase) {
      // INSERT 失敗 → 挿入済みの cases をロールバック
      console.error('[apply] cases INSERT失敗:', insertError?.code, '挿入済み件数:', insertedCaseIds.length)

      if (insertedCaseIds.length > 0) {
        const { error: rollbackError } = await supabase
          .from('cases')
          .delete()
          .in('id', insertedCaseIds)

        if (rollbackError) {
          console.error('[apply] ロールバック失敗 case_ids件数:', insertedCaseIds.length, 'code:', rollbackError.code)
          return NextResponse.json(
            {
              message: `cases の反映中にエラーが発生し、ロールバックにも失敗しました。管理者に連絡してください。(batch_id: ${batchId})`,
            },
            { status: 500 }
          )
        }
      }

      return NextResponse.json(
        {
          message: 'cases への反映中にエラーが発生しました。再度お試しください。',
          db_error: insertError?.message ?? null,
          db_code:  insertError?.code    ?? null,
          db_hint:  (insertError as any)?.hint    ?? null,
          db_details: (insertError as any)?.details ?? null,
          row_number: row.row_number ?? null,
        },
        { status: 500 }
      )
    }

    insertedCaseIds.push(newCase.id)
  }

  const appliedAt = new Date().toISOString()

  // ── cases_import_log に記録 ──────────────────────────────────
  // created_by = バッチ作成者（RLS の継続性を保つため）
  if (insertedCaseIds.length > 0) {
    const logRows = insertedCaseIds.map((caseId, idx) => ({
      batch_id:       batchId,
      staging_id:     (approvedRows ?? [])[idx]?.id ?? null,
      action:         'insert' as const,
      case_id:        caseId,
      snapshot_before: null,
      created_by:     user.id,            // apply実行者（RLS: created_by = auth.uid() と一致させる）
      applied_by:     user.id,            // 反映実行者
    }))

    const { error: logError } = await supabase
      .from('cases_import_log')
      .insert(logRows)

    if (logError) {
      // log INSERT 失敗 → rollback 証跡が残せないため cases を DELETE してロールバック
      console.error('[apply] log INSERT失敗 batch_id:', batchId, 'inserted件数:', insertedCaseIds.length, 'code:', logError.code)

      const { error: rollbackError } = await supabase
        .from('cases')
        .delete()
        .in('id', insertedCaseIds)

      if (rollbackError) {
        // rollback も失敗: 管理者が手動で対応が必要
        console.error('[apply] ロールバック失敗 batch_id:', batchId, 'inserted件数:', insertedCaseIds.length, 'code:', rollbackError.code)
        return NextResponse.json(
          {
            message: `ログ保存に失敗し、ロールバックにも失敗しました。管理者に連絡してください。(batch_id: ${batchId}, 挿入済み件数: ${insertedCaseIds.length})`,
          },
          { status: 500 }
        )
      }

      // rollback 成功
      return NextResponse.json(
        { message: 'ログ保存に失敗したため、反映済みの cases を取り消しました。再度お試しください。' },
        { status: 500 }
      )
    }
  }

  // ── staging の admin_decision を更新 ────────────────────────
  if (approvedIds.length > 0) {
    await supabase
      .from('cases_import_staging')
      .update({ admin_decision: 'approve', updated_at: appliedAt })
      .in('id', approvedIds)
      .eq('created_by', user.id)
  }
  if (skippedIds.length > 0) {
    await supabase
      .from('cases_import_staging')
      .update({ admin_decision: 'skip', updated_at: appliedAt })
      .in('id', skippedIds)
      .eq('created_by', user.id)
  }

  // ── バッチを反映済みに更新 ────────────────────────────────────
  await supabase
    .from('cases_import_batch')
    .update({
      applied:    true,
      applied_at: appliedAt,
      applied_by: user.id,
      new_count:  insertedCaseIds.length,
      skip_count: skippedIds.length + (approvedIds.length - insertedCaseIds.length),
      updated_at: appliedAt,
    })
    .eq('id', batchId)
    .eq('created_by', user.id)

  const messageParts: string[] = [`${insertedCaseIds.length}件を cases に反映しました。`]
  if (provisionalCompany > 0) {
    messageParts.push(`（会社名未入力 ${provisionalCompany}件は担当者名（仮）で反映）`)
  }
  if (skippedNullCompany > 0) {
    messageParts.push(`（会社名・担当者名両方未入力 ${skippedNullCompany}件はスキップ）`)
  }

  const response: ApplyResponse = {
    batch_id:                 batchId,
    approved_count:           insertedCaseIds.length,
    skipped_count:            Object.keys(decisions).length - insertedCaseIds.length,
    provisional_company_count: provisionalCompany,
    skipped_null_company:     skippedNullCompany,
    message:                  messageParts.join(''),
  }

  return NextResponse.json(response)
}
