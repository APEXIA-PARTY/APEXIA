/**
 * 確定案件の自動「開催終了」化（status: confirmed → done）専用のユーティリティ。
 *
 * 既存の app/api/auto-cancel/route.ts（開催日超過による自動キャンセル）とは
 * 完全に独立した別機能であり、auto-cancel のロジック・ファイルには一切触れない。
 *
 * 対象条件（実際のDB UPDATE文にも同じ条件を必ず付与すること）:
 *   - status = 'confirmed'
 *   - event_date IS NOT NULL
 *   - event_date < JST基準の今日
 */

import type { CaseStatus } from '../../types/database.ts'

/**
 * サーバーの実行タイムゾーン設定に依存せず、Asia/Tokyo基準の「今日」を
 * YYYY-MM-DD形式の文字列で返す。
 *
 * 既存 auto-cancel の `new Date().toISOString().slice(0, 10)`（UTC基準）は
 * JST 0:00付近で日付が1日ずれる問題があるため使用しない。
 * Intl.DateTimeFormat の timeZone を明示することで、実行環境の
 * システムタイムゾーン設定（Vercel等はUTC）に関わらず正しいJST暦日を得る。
 *
 * now を引数で受け取れるため、テストから任意の日時を渡して検証できる。
 */
export function getJstTodayDateString(now: Date = new Date()): string {
  // 'sv-SE'（スウェーデン語）ロケールは YYYY-MM-DD 形式で日付を返すため採用
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })
  return formatter.format(now)
}

export interface AutoCompleteCandidate {
  status: CaseStatus
  event_date: string | null
}

/**
 * 1件の案件が、自動「開催終了」化の対象かどうかを判定する純粋関数。
 *
 * 注意: これは判定ロジックの可読性・テストのためのものであり、
 * 実際のDB更新はこの関数の結果でIDを絞り込んでUPDATEするのではなく、
 * UPDATE文自体に同じ条件（.eq('status','confirmed') 等）を直接付与すること。
 * そうすることで、Cron実行直前にスタッフが別ステータスへ変更した案件を
 * 誤って上書きしない設計になる。
 */
export function isAutoCompleteTarget(caseRow: AutoCompleteCandidate, jstToday: string): boolean {
  if (caseRow.status !== 'confirmed') return false
  if (!caseRow.event_date) return false
  return caseRow.event_date < jstToday
}
