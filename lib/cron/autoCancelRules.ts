/**
 * 自動キャンセルの業務ルール（DB に依存しない純関数）。
 *
 * ルール（PHASE 1）:
 *   inquiry      開催日から7日を超えて経過   （event_date < 今日 − 7日）
 *   preview_adj  開催日から7日を超えて経過   （event_date < 今日 − 7日）
 *   previewed    開催日から14日を超えて経過  （event_date < 今日 − 14日）
 *   tentative    自動キャンセルの対象外（dry-run では「要確認」として件数だけ返す）
 *   confirmed / done / cancelled  対象外
 *   event_date が空の案件は対象外
 *
 * 遡り上限（ローリング窓）: 今日（日本時間）から30日前の日付以降の案件だけが対象。
 *   → 古い滞留案件を cron が突然処理しない。固定の日付はコードに持たない。
 *
 * 1回の書込み上限: 対象が MAX_WRITE_COUNT 件を超える場合は、1件も書き込まず中止する（全件中止）。
 *
 * 日付はすべて event_date（DATE型。タイムゾーンなしの暦日）の文字列 YYYY-MM-DD で比較する。
 * 「今日」は日本時間（Asia/Tokyo）の暦日（getJstTodayDateString）。
 * ※ preview_datetime の JST 壁時計処理とは別の話で、ここでは使わない（下見の集計は呼び出し側で isPreviewDone を使う）。
 */
import { isPreviewDone } from '../utils/analytics.ts'

/** 自動キャンセルの対象 status と、開催日からの猶予日数（この日数を「超えて」経過したら対象） */
export const AUTO_CANCEL_GRACE_DAYS = {
  inquiry: 7,
  preview_adj: 7,
  previewed: 14,
} as const
export type AutoCancelStatus = keyof typeof AUTO_CANCEL_GRACE_DAYS
export const AUTO_CANCEL_STATUSES = Object.keys(AUTO_CANCEL_GRACE_DAYS) as AutoCancelStatus[]

/** 自動キャンセルの対象外で、dry-run で「要確認」として数える status */
export const MANUAL_REVIEW_STATUS = 'tentative'

/** 遡り上限（日）: 今日からこの日数前の日付以降の案件だけを対象にする */
export const AUTO_CANCEL_LOOKBACK_DAYS = 30

/** 1回の本処理の書込み上限。対象がこの件数を超えたら、1件も書き込まず中止する */
export const AUTO_CANCEL_MAX_WRITE_COUNT = 30

/**
 * 自動キャンセル専用のキャンセル理由マスタの名称。
 * 既存の「連絡不通」は人の操作・取込みで47件使われており、意味が混ざるため代用しない。
 * この名称・自動専用・有効 の理由がちょうど1件ある場合だけ、本処理（live）を許可する。
 */
export const AUTO_CANCEL_REASON_NAME = '開催日経過（自動）'
export const AUTO_CANCEL_NOTE = '開催予定日経過による自動キャンセル'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** YYYY-MM-DD に日数を足す（UTC基準の暦日計算。夏時間の影響を受けない） */
export function addDaysToDate(date: string, days: number): string {
  const m = DATE_PATTERN.exec(date)
  if (!m) throw new Error(`invalid date: ${date}`)
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export interface AutoCancelWindow {
  todayJst: string
  /** この日付以降（含む）の案件だけが対象 */
  lookbackStart: string
  /** status ごとの上限。event_date がこの日付より前（含まない）なら猶予を超えている */
  cutoffs: Record<AutoCancelStatus, string>
}

export function getAutoCancelWindow(todayJst: string): AutoCancelWindow {
  return {
    todayJst,
    lookbackStart: addDaysToDate(todayJst, -AUTO_CANCEL_LOOKBACK_DAYS),
    cutoffs: {
      inquiry: addDaysToDate(todayJst, -AUTO_CANCEL_GRACE_DAYS.inquiry),
      preview_adj: addDaysToDate(todayJst, -AUTO_CANCEL_GRACE_DAYS.preview_adj),
      previewed: addDaysToDate(todayJst, -AUTO_CANCEL_GRACE_DAYS.previewed),
    },
  }
}

/** 1件の案件が、今この時点で自動キャンセルの対象か */
export function isAutoCancelTarget(
  row: { status: string; event_date: string | null | undefined },
  todayJst: string
): boolean {
  const eventDate = typeof row.event_date === 'string' ? row.event_date.slice(0, 10) : null
  if (!eventDate) return false
  const grace = (AUTO_CANCEL_GRACE_DAYS as Record<string, number | undefined>)[row.status]
  if (grace === undefined) return false
  const window = getAutoCancelWindow(todayJst)
  return eventDate >= window.lookbackStart && eventDate < addDaysToDate(todayJst, -grace)
}

export interface AutoCancelCandidateRow {
  id: string
  status: string
  event_date: string
  preview_datetime: string | null
  estimate_amount: number | null
}

/** 開催日（YYYY-MM-DD）の月別件数と、最古・最新の開催日 */
export function summarizeEventDates(dates: string[]): {
  byEventMonth: Record<string, number>
  oldestEventDate: string | null
  newestEventDate: string | null
} {
  const byEventMonth: Record<string, number> = {}
  let oldest: string | null = null
  let newest: string | null = null
  for (const raw of dates) {
    const d = raw.slice(0, 10)
    const month = d.slice(0, 7)
    byEventMonth[month] = (byEventMonth[month] ?? 0) + 1
    if (oldest === null || d < oldest) oldest = d
    if (newest === null || d > newest) newest = d
  }
  const sorted = Object.fromEntries(Object.entries(byEventMonth).sort(([a], [b]) => (a < b ? -1 : 1)))
  return { byEventMonth: sorted, oldestEventDate: oldest, newestEventDate: newest }
}

/**
 * dry-run 用の集計。個人情報は一切含めない（件数・日付・月のみ）。
 * candidates: 自動キャンセルの対象として取得した案件（猶予と遡り上限の条件を満たすもの）
 */
export function summarizeAutoCancelCandidates(args: {
  candidates: AutoCancelCandidateRow[]
  tentativeEventDates: string[]
  outsideLookbackCount: number
  todayJst: string
  now: Date
}) {
  const { candidates, tentativeEventDates, outsideLookbackCount, todayJst, now } = args
  const window = getAutoCancelWindow(todayJst)

  const byStatus: Record<AutoCancelStatus, number> = { inquiry: 0, preview_adj: 0, previewed: 0 }
  let previewDone = 0
  let previewFuture = 0
  let noPreview = 0
  let withEstimate = 0
  for (const c of candidates) {
    if (c.status in byStatus) byStatus[c.status as AutoCancelStatus]++
    if (!c.preview_datetime) noPreview++
    else if (isPreviewDone(c.preview_datetime, now)) previewDone++
    else previewFuture++
    if ((c.estimate_amount ?? 0) > 0) withEstimate++
  }

  const dates = summarizeEventDates(candidates.map((c) => c.event_date))
  return {
    totalCandidates: candidates.length,
    byStatus,
    preview: { done: previewDone, none: noPreview, future: previewFuture },
    withEstimate,
    byEventMonth: dates.byEventMonth,
    oldestEventDate: dates.oldestEventDate,
    newestEventDate: dates.newestEventDate,
    tentativeManualReview: {
      total: tentativeEventDates.length,
      withinLookbackWindow: tentativeEventDates.filter((d) => d.slice(0, 10) >= window.lookbackStart).length,
    },
    outsideLookbackWindow: outsideLookbackCount,
  }
}
