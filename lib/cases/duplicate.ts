/**
 * 案件複製機能のロジック（純粋関数のみ）。
 * app/api/cases/[id]/duplicate/route.ts から使用される。
 * Supabase / Next.js に依存しないため、node:test で単体テスト可能。
 */

// ─── 複製時に引き継ぐカラム（許可リスト方式）───────────────────
// ここに書かれていない列は引き継がない（推測で追加しない）
export const CARRY_OVER_FIELDS = [
  'company',
  'contact',
  'phone',
  'email',
  'event_name',
  'guest_count',
  'notes',
  'payment_method',
  'media_id',
  'contact_method_id',
  'floor_id',
  'event_category_id',
  'event_subcategory_id',
  'event_subcategory_note',
  'load_in_time',
  'rehearsal_time',
  'start_time',
  'end_time',
  'full_exit_time',
  'event_date_note',
] as const

// 複製先で必ず初期化される列と、その固定値（event_name / created_by / inquiry_date を除く）
export const RESET_FIELDS = {
  event_date: null,
  status: 'inquiry',
  deposit_status: '未対応',
  remaining_payment_status: '未対応',
  invoice_status: '未対応',
  application_form_status: '未対応',
  delivery_notice_status: '未対応',
  gcal_event_id: null,
  estimate_amount: 0,
  preview_datetime: null,
  has_previewed: false,
  auto_cancel: false,
  cancel_reason_id: null,
  cancel_note: null,
} as const

// 複製しない関連テーブル（このAPIはこれらを一切SELECT/INSERTしない）
export const EXCLUDED_RELATED_TABLES = [
  'case_checklist',
  'case_files',
  'case_hold_logs',
  'case_history',
] as const

// 元案件名の末尾の「（コピー）」「（コピーN）」を取り除く
export function stripCopySuffix(name: string): string {
  return name.replace(/（コピー\d*）$/, '')
}

// 複製元の案件名から基準名を決める（空欄・null・空白のみは「案件名未設定」扱い）
export function resolveBaseName(eventName: string | null | undefined): string {
  const hasName = !!eventName && eventName.trim() !== ''
  return stripCopySuffix(hasName ? (eventName as string) : '案件名未設定')
}

// baseName と既存の案件名一覧から、まだ使われていない最小の「（コピー）」名を決める
export function nextCopyName(baseName: string, existingNames: string[]): string {
  const usedNumbers = new Set<number>()
  for (const n of existingNames) {
    if (n === `${baseName}（コピー）`) {
      usedNumbers.add(1)
      continue
    }
    const m = n.match(/^(.*)（コピー(\d+)）$/)
    if (m && m[1] === baseName) {
      usedNumbers.add(Number(m[2]))
    }
  }
  let candidate = 1
  while (usedNumbers.has(candidate)) candidate++
  return candidate === 1 ? `${baseName}（コピー）` : `${baseName}（コピー${candidate}）`
}

/**
 * 複製元の案件レコード（source）から、cases への INSERT 用 payload を組み立てる。
 * ・CARRY_OVER_FIELDS にある列だけを source からコピーする
 * ・RESET_FIELDS を上書きする
 * ・event_name / inquiry_date / created_by は呼び出し側で決定した値を使う
 * ・id / created_at / updated_at は含めない（DB側で新規生成させる）
 */
export function buildDuplicateInsertData(
  source: Record<string, unknown>,
  opts: { newEventName: string; inquiryDate: string; userId: string }
): Record<string, unknown> {
  const insertData: Record<string, unknown> = {}

  for (const field of CARRY_OVER_FIELDS) {
    insertData[field] = source[field]
  }

  insertData.event_name = opts.newEventName
  Object.assign(insertData, RESET_FIELDS)
  insertData.inquiry_date = opts.inquiryDate
  insertData.created_by = opts.userId

  return insertData
}

/**
 * 複製先案件のロールバック（削除）を実行し、削除自体が失敗した場合は
 * 孤立した案件IDとエラー内容を必ずログに残す。
 * deleteFn は実際の Supabase 呼び出しを外側から注入する（テスト時はモックを渡す）。
 */
export async function deleteCaseAndLogFailure(
  deleteFn: () => PromiseLike<{ error: { message: string } | null }>,
  newCaseId: string,
  log: (message: string, meta: unknown) => void = console.error
): Promise<void> {
  const { error } = await deleteFn()
  if (error) {
    log('[POST /api/cases/:id/duplicate] ロールバック失敗: 複製先案件が孤立した可能性があります', {
      orphanedCaseId: newCaseId,
      rollbackError: error,
    })
  }
}
