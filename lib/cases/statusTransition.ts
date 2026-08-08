/**
 * 案件ステータス遷移に関する純粋関数。
 * app/api/cases/route.ts（POST）・app/api/cases/[id]/route.ts（PUT）から使用される。
 * Supabase / Next.js に依存しないため、node:test で単体テスト可能。
 */
import type { CaseStatus } from '../../types/database.ts'
import { REVENUE_STATUSES } from '../utils/analytics.ts'

/**
 * confirmed_at をセットすべきかどうかを判定する。
 *
 * ルール：新しいステータスが収益ステータス（confirmed / done）に「新規突入」した場合のみ true。
 * ・旧ステータスが未指定（新規作成時）で、新ステータスが収益ステータス → true
 * ・旧ステータスが収益ステータスでなく、新ステータスが収益ステータス → true（confirmedを飛ばして
 *   直接doneになるケースも含む）
 * ・旧ステータスが既に収益ステータスで、新ステータスも収益ステータス（例: confirmed→done、
 *   confirmed→confirmedの再保存） → false（再スタンプしない）
 * ・新ステータスが収益ステータスでない（例: confirmed→cancelled） → false
 *   （confirmed_at は消さない＝史実として残す。呼び出し側で confirmed_at に触れないこと）
 * ・キャンセル→再確定のように、収益ステータスへ再度突入した場合 → true
 *   （呼び出し側で confirmed_at を最新の日時で上書きする）
 * ・新ステータスが未指定（ステータスに触れない更新） → false
 */
export function shouldSetConfirmedAt(
  oldStatus: CaseStatus | null | undefined,
  newStatus: CaseStatus | null | undefined
): boolean {
  if (!newStatus) return false

  const wasRevenue = !!oldStatus && REVENUE_STATUSES.includes(oldStatus)
  const willBeRevenue = REVENUE_STATUSES.includes(newStatus)

  return willBeRevenue && !wasRevenue
}
