/**
 * 集計ロジック共通ユーティリティ
 * 0除算ガード・割合計算・前年比などを一元管理
 */

import { CaseStatus } from '@/types/database'

// ─── ステータス定義 ────────────────────────────────────────────
/** 売上集計対象ステータス */
export const REVENUE_STATUSES: CaseStatus[] = ['confirmed', 'done']

/** 下見以上のステータス（下見件数カウント用） */
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
  if (previous === 0) return null  // 前年データなしは null
  return Math.round(safeDivide(current, previous) * 100)
}

// ─── 型定義 ────────────────────────────────────────────────────

export interface CaseRow {
  id: string
  status: CaseStatus
  auto_cancel: boolean
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
}

export interface KpiResult {
  inquiry: number   // 問合せ件数
  preview: number   // 下見件数
  confirmed: number   // 確定件数
  cancelManual: number   // 手動キャンセル
  cancelAuto: number   // 自動キャンセル
  estimateTotal: number   // 見積合計（キャンセル除く）
  revenue: number   // 確定売上
  avgPrice: number   // 平均単価
  previewRate: number   // 問合せ→下見率(%)
  confirmRate: number   // 下見→確定率(%)
  cvRate: number   // 問合せ→確定率(%)
}

/** cases の配列からKPIを計算する */
export function calcKpi(cases: CaseRow[]): KpiResult {
  const inquiry = cases.length
  const preview = cases.filter(c => PREVIEWED_STATUSES.includes(c.status)).length
  const confirmed = cases.filter(c => REVENUE_STATUSES.includes(c.status)).length
  const cancelManual = cases.filter(c => c.status === CANCEL_STATUS && !c.auto_cancel).length
  const cancelAuto = cases.filter(c => c.status === CANCEL_STATUS && c.auto_cancel).length
  const estimateTotal = cases
    .filter(c => c.status !== CANCEL_STATUS)
    .reduce((s, c) => s + (c.estimate_amount ?? 0), 0)
  const revenue = cases
    .filter(c => REVENUE_STATUSES.includes(c.status))
    .reduce((s, c) => s + (c.estimate_amount ?? 0), 0)
  const avgPrice = calcAvgPrice(revenue, confirmed)
  const previewRate = calcPercent(preview, inquiry)
  const confirmRate = calcPercent(confirmed, preview)
  const cvRate = calcPercent(confirmed, inquiry)

  return {
    inquiry, preview, confirmed, cancelManual, cancelAuto,
    estimateTotal, revenue, avgPrice, previewRate, confirmRate, cvRate
  }
}

/** 対象期間の cases をフィルタリング（inquiry_date ベース） */
export function filterByYear(cases: CaseRow[], year: string): CaseRow[] {
  return cases.filter(c => c.inquiry_date?.startsWith(year))
}

export function filterByMonth(cases: CaseRow[], yearMonth: string): CaseRow[] {
  return cases.filter(c => c.inquiry_date?.startsWith(yearMonth))
}

/** cases から inquiry_date の年リストを取得 */
export function getAvailableYears(cases: CaseRow[]) {
  const years = new Set(
    cases
      .filter((c) => c.inquiry_date)
      .map((c) => c.inquiry_date!.slice(0, 4))
  )

  return Array.from(years).sort().reverse()
}
