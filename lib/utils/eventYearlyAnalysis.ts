/**
 * 開催月分析（年間、event_date 基準）専用のユーティリティ。
 *
 * 既存の lib/utils/analytics.ts（inquiry_date 基準の分析ロジック）とも、
 * lib/utils/eventDateSummary.ts（案件一覧の「開催サマリー」、1ヶ月単位の集計）とも
 * 別軸・別ファイルであり、双方の既存エクスポートはここから一切変更しない。
 *
 * 前年比（%）・前年差（件数）のフォーマットは、既存の
 * formatEventMonthYoYPercent / formatEventMonthYoYDiff（eventDateSummary.ts）を
 * そのまま再利用する想定（呼び出し側でimportする）。ここでは再定義しない。
 */

/** 1ヶ月分の開催案件数（当年・前年）。month は "01"〜"12"。 */
export interface EventYearlyMonthCount {
  month: string
  current: number
  previous: number
}

/** COUNTクエリ1本分の生の結果（Supabaseのレスポンス相当。型を絞って受け取る） */
export interface EventYearlyQueryResult {
  count: number | null | undefined
  error: unknown
}

/**
 * 24本（12ヶ月×当年/前年）の exact count クエリ結果に、
 * error または count===null/undefined が1本でも含まれるかを判定する。
 * true の場合、呼び出し側は部分的な数字を正常値として扱ってはいけない
 * （count===0 は「本当に0件」の正常値であり、null/undefined とは区別する）。
 */
export function hasEventYearlyQueryProblem(results: EventYearlyQueryResult[]): boolean {
  return results.some((r) => r.error || r.count === null || r.count === undefined)
}

/** 12ヶ月分から当年合計・前年合計を算出する */
export function calcEventYearlyTotals(
  months: EventYearlyMonthCount[]
): { currentTotal: number; previousTotal: number } {
  return months.reduce(
    (acc, m) => ({
      currentTotal: acc.currentTotal + m.current,
      previousTotal: acc.previousTotal + m.previous,
    }),
    { currentTotal: 0, previousTotal: 0 }
  )
}

export type EventMonthTiming = 'past' | 'current' | 'future'

/**
 * 指定した開催年月が、基準日（省略時は現在日時）から見て
 * 過去/当月/未来のどれかを判定する。「集計中」表示の対象判定に使う。
 * 選択年が未来年なら常に 'future'、過去年なら常に 'past' になる。
 */
export function classifyEventMonthTiming(
  year: string,
  month: string,
  today: Date = new Date()
): EventMonthTiming {
  const y = Number(year)
  const m = Number(month)
  const ty = today.getFullYear()
  const tm = today.getMonth() + 1

  if (y < ty) return 'past'
  if (y > ty) return 'future'
  if (m < tm) return 'past'
  if (m > tm) return 'future'
  return 'current'
}

/**
 * API から受け取った months が、12ヶ月分・"01"〜"12"が重複なく揃っており、
 * 件数がいずれも非負整数であるという想定通りのデータ構造か検証する。
 * クライアント側で不正な形のレスポンスを正常値として描画しないための安全確認。
 */
export function isValidEventYearlyMonths(months: unknown): months is EventYearlyMonthCount[] {
  if (!Array.isArray(months) || months.length !== 12) return false

  const seen = new Set<string>()
  for (const m of months) {
    if (typeof m !== 'object' || m === null) return false
    const { month, current, previous } = m as Record<string, unknown>

    if (typeof month !== 'string' || !/^(0[1-9]|1[0-2])$/.test(month)) return false
    if (seen.has(month)) return false
    seen.add(month)

    if (typeof current !== 'number' || !Number.isInteger(current) || current < 0) return false
    if (typeof previous !== 'number' || !Number.isInteger(previous) || previous < 0) return false
  }

  return seen.size === 12
}
