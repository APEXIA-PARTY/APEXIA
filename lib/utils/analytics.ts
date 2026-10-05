/**
 * 集計ロジック共通ユーティリティ
 * 0除算ガード・割合計算・前年比などを一元管理
 */

import type { CaseStatus } from '@/types/database'

// ─── ステータス定義 ────────────────────────────────────────────
/** 売上集計対象ステータス */
export const REVENUE_STATUSES: CaseStatus[] = ['confirmed', 'done']

/** 売上集計の対象（確定・開催終了）の案件だけを残す */
export function filterRevenueStatuses<T extends { status: CaseStatus }>(rows: T[]): T[] {
  return rows.filter((row) => REVENUE_STATUSES.includes(row.status))
}

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

// ─── 下見の実施判定（preview_datetime と現在日時の比較）──────────────
//
// 下見日時（preview_datetime）の保存規約: スタッフが入力した日付・時刻（日本時間の壁時計）を、
// タイムゾーン変換せずそのまま TIMESTAMPTZ の日付・時刻欄に保存している（DB の TimeZone は UTC。
// 編集フォーム・詳細画面の表示も、文字列の日付・時刻部分をそのまま使う: formatPreviewDateTime 参照）。
// 実データでも、保存値の時刻部分は営業時間帯（11〜19時）に集中している。
// そのため「下見日時を迎えたか」は、保存値の日付・時刻を日本時間の壁時計として、
// 日本時間の現在時刻と比較して判定する（Date.parse して瞬間として比較すると9時間ずれる）。
// 日本は夏時間がないため、固定の +9時間で変換できる。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 現在日時 → 日本時間の壁時計 'YYYY-MM-DDTHH:mm:ss'（下見日時の壁時計と文字列で比較できる） */
export function toJstWallClock(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 19)
}

/** 保存された下見日時 → 壁時計 'YYYY-MM-DDTHH:mm:ss'（オフセット・小数秒は無視。日付のみは 00:00:00）。不正なら null */
function previewWallClock(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (!m) return null
  return `${m[1]}T${m[2] ?? '00'}:${m[3] ?? '00'}:${m[4] ?? '00'}`
}

/**
 * 下見実施済みか。preview_datetime があり、かつ現在日時（日本時間）以前であること。
 * 未来の下見予定は実施済みに含めない。ちょうど現在日時のものは実施済みとして扱う。
 */
export function isPreviewDone(previewDatetime: string | null | undefined, now: Date = new Date()): boolean {
  const wall = previewWallClock(previewDatetime)
  return wall !== null && wall <= toJstWallClock(now)
}

export interface KpiResult {
  inquiry: number              // 問合せ件数
  preview: number              // 下見件数（下見実施済み = preview_datetime が現在日時以前。未来の予定は含めない）
  confirmed: number            // 確定件数（confirmed + done の全件。下見を経由しない直接確定も含む）
  cancelManual: number         // 手動キャンセル
  cancelAuto: number           // 自動キャンセル
  cancelBeforePreview: number  // 下見前キャンセル
  cancelAfterPreview: number   // 下見後キャンセル
  estimateTotal: number        // 見積合計（キャンセル除く）
  revenue: number              // 確定売上
  avgPrice: number             // 平均単価
  previewConfirmed: number     // 下見経由確定（下見実施済み かつ confirmed/done）。confirmed = previewConfirmed + 下見なし確定
  previewRate: number          // 問合せ→下見率(%) = 下見実施済み ÷ 問合せ
  confirmRate: number          // 下見→確定率(%) = 下見経由確定 ÷ 下見実施済み（preview → confirmed の転換率。全確定 ÷ 下見ではない）
  cvRate: number               // 問合せ→確定率(%) = 全確定 ÷ 問合せ
}

/**
 * cases の配列からKPIを計算する。
 * now: 下見実施済みの判定に使う現在日時（省略時は実行時点。テストでは固定日時を渡す）。
 *      下見の実施判定は isPreviewDone を参照（日本時間の壁時計で比較する）。
 */
export function calcKpi(cases: CaseRow[], now: Date = new Date()): KpiResult {
  const inquiry = cases.length

  // 下見件数 = 下見実施済み（preview_datetime が現在日時以前。status 不問。未来の下見予定は含めない）
  const nowWall = toJstWallClock(now)
  const isDone = (c: CaseRow): boolean => {
    const wall = previewWallClock(c.preview_datetime)
    return wall !== null && wall <= nowWall
  }
  const preview = cases.filter(isDone).length

  const confirmed = cases.filter((c) => REVENUE_STATUSES.includes(c.status)).length

  // 下見経由確定 = 下見実施済み かつ 確定/開催終了
  const previewConfirmed = cases.filter((c) => isDone(c) && REVENUE_STATUSES.includes(c.status)).length

  const cancelManual = cases.filter(
    (c) => c.status === CANCEL_STATUS && !c.auto_cancel
  ).length

  const cancelAuto = cases.filter(
    (c) => c.status === CANCEL_STATUS && c.auto_cancel
  ).length

  // 下見前/下見後キャンセルは、従来どおり preview_datetime の有無（予定を含む）で判定する
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
  const confirmRate = calcPercent(previewConfirmed, preview)
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
    previewConfirmed,
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

/**
 * 月別内訳から、「無効なマスタ（is_active=false）で、対象年の実績が全月0件」の行だけを除外する。
 * ・有効なマスタは0件でも残す（従来どおり）
 * ・無効なマスタでも、対象年に問合せ・下見・確定のいずれかが1件でもあれば残す（履歴確認のため）
 * ・集計値そのものは変更しない（行を取り除くだけ。残った行の months は calcMediaMonthly の結果のまま）
 * ・is_active が不明（未取得）のマスタは有効として扱う。（未設定）行はマスタではないので常に残す
 */
export function excludeInactiveEmptyMediaRows(
  rows: MediaMonthlyRow[],
  masters: { id: string; is_active?: boolean | null }[]
): MediaMonthlyRow[] {
  const inactiveIds = new Set(masters.filter((m) => m.is_active === false).map((m) => m.id))
  return rows.filter(
    (row) =>
      !inactiveIds.has(row.id) ||
      row.months.some((m) => m.inquiry > 0 || m.preview > 0 || m.confirmed > 0)
  )
}
