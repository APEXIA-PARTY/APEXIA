/**
 * 集計ロジック共通ユーティリティ
 * 0除算ガード・割合計算・前年比などを一元管理
 */

import type { CaseStatus } from '@/types/database'

// ─── ステータス定義 ────────────────────────────────────────────
/** 売上集計対象ステータス */
export const REVENUE_STATUSES: CaseStatus[] = ['confirmed', 'done']

/** 下見以上のステータス（旧ロジック用定数。互換のため残すが、calcKpi では使用しない） */
export const PREVIEWED_STATUSES: CaseStatus[] = ['previewed', 'tentative', 'confirmed', 'done']

/** キャンセルステータス */
export const CANCEL_STATUS: CaseStatus = 'cancelled'

// ─── 計算ユーティリティ ────────────────────────────────────────

/** 安全な除算（0除算で NaN を返さない） */
export function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return numerator / denominator
}

/** パーセント表示用の割合計算（0〜100の整数） */
export function calcPercent(part: number, total: number): number {
  return Math.round(safeDivide(part, total) * 100)
}

/** 平均単価 = 確定売上 ÷ 確定件数 */
export function calcAvgPrice(revenue: number, confirmedCount: number): number {
  if (confirmedCount === 0) return 0
  return Math.round(safeDivide(revenue, confirmedCount))
}

/** 前年比（百分率） */
export function calcYoY(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(safeDivide(current, previous) * 100)
}

// ─── 型定義 ────────────────────────────────────────────────────

export interface CaseRow {
  id: string
  status: CaseStatus
  auto_cancel: boolean
  /** 下見日時（TIMESTAMPTZ）。null = 下見なし。has_previewed は廃止し preview_datetime で判定 */
  preview_datetime: string | null
  estimate_amount: number
  inquiry_date: string | null
  event_date: string | null
  media_id: string | null
  contact_method_id: string | null
  floor_id: string | null
  event_category_id: string | null
  event_subcategory_id: string | null
  cancel_reason_id: string | null
  cancel_note: string | null
  company: string
  /** 収益ステータス(confirmed/done)へ新規突入した日時。イベント日方式の月別確定集計でのみ使用。
   *  select() で明示的に取得したルートのみ実際の値が入る（それ以外は undefined） */
  confirmed_at?: string | null
}

export interface KpiResult {
  inquiry: number              // 問合せ件数
  preview: number              // 下見件数
  confirmed: number            // 確定件数
  cancelManual: number         // 手動キャンセル
  cancelAuto: number           // 自動キャンセル
  cancelBeforePreview: number  // 下見前キャンセル
  cancelAfterPreview: number   // 下見後キャンセル
  estimateTotal: number        // 見積合計（キャンセル除く）
  revenue: number              // 確定売上
  avgPrice: number             // 平均単価
  previewRate: number          // 問合せ→下見率(%)
  confirmRate: number          // 下見→確定率(%)
  cvRate: number               // 問合せ→確定率(%)
}

/** cases の配列からKPIを計算する */
export function calcKpi(cases: CaseRow[]): KpiResult {
  const inquiry = cases.length

  // 下見件数は preview_datetime（下見日時）が存在するかで判定する（status 不問）
  const preview = cases.filter((c) => !!c.preview_datetime).length

  const confirmed = cases.filter((c) => REVENUE_STATUSES.includes(c.status)).length

  const cancelManual = cases.filter(
    (c) => c.status === CANCEL_STATUS && !c.auto_cancel
  ).length

  const cancelAuto = cases.filter(
    (c) => c.status === CANCEL_STATUS && c.auto_cancel
  ).length

  const cancelBeforePreview = cases.filter(
    (c) => c.status === CANCEL_STATUS && !c.preview_datetime
  ).length

  const cancelAfterPreview = cases.filter(
    (c) => c.status === CANCEL_STATUS && !!c.preview_datetime
  ).length

  const estimateTotal = cases
    .filter((c) => c.status !== CANCEL_STATUS)
    .reduce((sum, c) => sum + (c.estimate_amount ?? 0), 0)

  const revenue = cases
    .filter((c) => REVENUE_STATUSES.includes(c.status))
    .reduce((sum, c) => sum + (c.estimate_amount ?? 0), 0)

  const avgPrice = calcAvgPrice(revenue, confirmed)
  const previewRate = calcPercent(preview, inquiry)
  const confirmRate = calcPercent(confirmed, preview)
  const cvRate = calcPercent(confirmed, inquiry)

  return {
    inquiry,
    preview,
    confirmed,
    cancelManual,
    cancelAuto,
    cancelBeforePreview,
    cancelAfterPreview,
    estimateTotal,
    revenue,
    avgPrice,
    previewRate,
    confirmRate,
    cvRate,
  }
}

/** 対象期間の cases をフィルタリング（inquiry_date ベース） */
export function filterByYear(cases: CaseRow[], year: string): CaseRow[] {
  return cases.filter((c) => c.inquiry_date?.startsWith(year))
}

export function filterByMonth(cases: CaseRow[], yearMonth: string): CaseRow[] {
  return cases.filter((c) => c.inquiry_date?.startsWith(yearMonth))
}

/** cases から inquiry_date の年リストを取得 */
export function getYears(cases: CaseRow[]): string[] {
  const years = new Set(
    cases.filter((c) => c.inquiry_date).map((c) => c.inquiry_date!.slice(0, 4))
  )
  return Array.from(years).sort().reverse()
}

// ─── 月別×媒体別集計（イベント日方式） ─────────────────────────
// 問合せ・下見・確定を、それぞれ「実際にその出来事が起きた月」でカウントする。
// ・問合せ：inquiry_date の月（現ステータス問わず）
// ・下見　：preview_datetime の月（現ステータス問わず。過去にキャンセルされても訪問の事実は残る）
// ・確定　：confirmed_at の月。ただし「現ステータスが confirmed/done であること」も必須条件にする
//   （confirmed_at は confirmed→cancelled でもクリアしないため、これがないと後でキャンセルされた
//    案件まで確定件数に混入してしまう）

export interface MediaMonthlyCell {
  inquiry: number
  preview: number
  confirmed: number
}

export interface MediaMonthlyRow {
  id: string
  name: string
  /** 12ヶ月分。months[0] = 1月 ... months[11] = 12月 */
  months: MediaMonthlyCell[]
}

function emptyMonths(): MediaMonthlyCell[] {
  return Array.from({ length: 12 }, () => ({ inquiry: 0, preview: 0, confirmed: 0 }))
}

/** "YYYY-MM-DD..." 形式の文字列から、指定した年に属する場合のみ月インデックス(0-11)を返す */
function monthIndexInYear(dateStr: string | null | undefined, year: string): number | null {
  if (!dateStr || !dateStr.startsWith(year)) return null
  const m = Number(dateStr.slice(5, 7)) - 1
  return m >= 0 && m < 12 ? m : null
}

/** UNASSIGNED_MEDIA_ID: media_id が NULL（マスタ未設定）の案件をまとめる仮想ID */
export const UNASSIGNED_MEDIA_ID = '__none__'
export const UNASSIGNED_MEDIA_LABEL = '（未設定）'

/**
 * 案件配列を「媒体 × 月」でグルーピングし、問合せ・下見・確定の各件数を集計する。
 * mediaList には media_id が NULL の案件をまとめる行は含めない（このAPI呼び出し側の責務ではなく、
 * この関数が自動的に __none__ 行を末尾に追加する）。
 */
export function calcMediaMonthly(
  cases: CaseRow[],
  mediaList: { id: string; name: string }[],
  year: string
): MediaMonthlyRow[] {
  const monthsByMediaId = new Map<string, MediaMonthlyCell[]>()

  const ensure = (mediaId: string): MediaMonthlyCell[] => {
    let months = monthsByMediaId.get(mediaId)
    if (!months) {
      months = emptyMonths()
      monthsByMediaId.set(mediaId, months)
    }
    return months
  }

  for (const c of cases) {
    const mediaId = c.media_id ?? UNASSIGNED_MEDIA_ID
    const months = ensure(mediaId)

    const inquiryMonth = monthIndexInYear(c.inquiry_date, year)
    if (inquiryMonth !== null) months[inquiryMonth].inquiry++

    const previewMonth = monthIndexInYear(c.preview_datetime, year)
    if (previewMonth !== null) months[previewMonth].preview++

    if (REVENUE_STATUSES.includes(c.status)) {
      const confirmedMonth = monthIndexInYear(c.confirmed_at, year)
      if (confirmedMonth !== null) months[confirmedMonth].confirmed++
    }
  }

  const result: MediaMonthlyRow[] = mediaList.map((m) => ({
    id: m.id,
    name: m.name,
    months: monthsByMediaId.get(m.id) ?? emptyMonths(),
  }))

  const unassigned = monthsByMediaId.get(UNASSIGNED_MEDIA_ID)
  if (unassigned) {
    result.push({ id: UNASSIGNED_MEDIA_ID, name: UNASSIGNED_MEDIA_LABEL, months: unassigned })
  }

  return result
}