/**
 * 開催月別集計（event_date 基準）専用のユーティリティ。
 *
 * 既存の lib/utils/analytics.ts（inquiry_date 基準の分析ロジック：
 * filterByYear / filterByMonth / calcMediaMonthly 等）とは完全に独立している。
 * 既存分析機能を保護するため、このファイルから既存ロジックへは一切触れない。
 */

import type { CaseStatus } from '../../types/database.ts'

/**
 * cases.status の正式な7種類（DB CHECK制約・types/database.ts の CaseStatus と一致）。
 * lib/constants/status.ts の STATUS_LIST は値を実行時 import する必要があり、
 * node --test（ネイティブTS実行、@/ エイリアス非対応）から呼ぶと解決に失敗するため、
 * ここではキーの配列だけを自己完結で保持する（表示用ラベル・色は持たない）。
 */
const KNOWN_STATUS_KEYS: CaseStatus[] = [
  'inquiry',
  'preview_adj',
  'previewed',
  'tentative',
  'confirmed',
  'cancelled',
  'done',
]

/** 指定した開催年・開催月（YYYY, "01"〜"12"）の event_date 範囲（YYYY-MM-01 〜 月末日）を返す */
export function calcEventMonthRange(year: string, month: string): { gte: string; lte: string } {
  const m = month.padStart(2, '0')
  const lastDay = new Date(Number(year), Number(month), 0).getDate()
  return {
    gte: `${year}-${m}-01`,
    lte: `${year}-${m}-${String(lastDay).padStart(2, '0')}`,
  }
}

/**
 * 前年比（百分率、小数点1桁）を文字列で返す。
 * 前年が0件の場合は比率として意味を持たないため "—" を返す（∞%等は表示しない）。
 * 既存の calcYoY（lib/utils/analytics.ts）は整数丸めのため、小数点1桁表示が必要な
 * 本機能専用にここで計算する。
 */
export function formatEventMonthYoYPercent(current: number, previous: number): string {
  if (previous === 0) return '—'
  return `${((current / previous) * 100).toFixed(1)}%`
}

/** 前年差（件数）を符号付きで文字列で返す。0件のときは "±0件"。 */
export function formatEventMonthYoYDiff(current: number, previous: number): string {
  const diff = current - previous
  if (diff > 0) return `+${diff}件`
  if (diff < 0) return `${diff}件`
  return '±0件'
}

/** 当月クエリの生の結果（Supabaseのレスポンス相当。型を絞って受け取る） */
export interface EventMonthCurrentQueryResult {
  data: { status: string }[] | null
  count: number | null
  error: unknown
}

export interface EventMonthSummaryData {
  currentTotal: number
  previousTotal: number
  breakdown: Record<CaseStatus, number>
}

/**
 * 当月・前年同月の生クエリ結果から、安全に表示可能なサマリーを組み立てる。
 * 以下のいずれかに該当する場合は null を返し、呼び出し側は
 * 「取得できなかった」ものとして扱う（0件として表示してはいけない）。
 *
 *  - 当月または前年同月のクエリで error が返っている
 *  - count が null / undefined（取得失敗の可能性）
 *  - 取得した status 行数（rows.length）が exact count と一致しない
 *    （Supabase/PostgREST 側の返却行数上限等でステータス内訳が不完全な可能性）
 *  - ステータス内訳の合計（未知の status を含む）が count と一致しない
 *  - 既知の7ステータス以外の値が1件でも存在する
 *
 * DB データそのものを修正する処理は一切含まない（読み取り結果の検証のみ）。
 */
export function buildEventMonthSummary(
  current: EventMonthCurrentQueryResult,
  previousCount: number | null | undefined,
  previousError: unknown
): EventMonthSummaryData | null {
  if (current.error || previousError) return null
  if (current.count === null || current.count === undefined) return null
  if (previousCount === null || previousCount === undefined) return null

  const rows = current.data ?? []

  // exact count と実際に取得できた行数が食い違う = 内訳が不完全な可能性
  if (rows.length !== current.count) return null

  const breakdown = KNOWN_STATUS_KEYS.reduce((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as Record<CaseStatus, number>)

  let unknownCount = 0
  for (const row of rows) {
    const status = row.status as CaseStatus
    if (status in breakdown) breakdown[status]++
    else unknownCount++
  }

  if (unknownCount > 0) return null

  const breakdownSum = Object.values(breakdown).reduce((sum, n) => sum + n, 0)
  if (breakdownSum !== current.count) return null

  return {
    currentTotal: current.count,
    previousTotal: previousCount,
    breakdown,
  }
}
