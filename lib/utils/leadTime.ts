/**
 * 分析「先行期間」（開催月別の平均先行期間）の集計ロジック。
 * app/api/analytics/lead-time/route.ts から使う純粋関数のみ（Supabase / Next.js に依存しない）。
 *
 * ■ 既存の集計仕様（変更しない）
 *   ・対象: inquiry_date と event_date が両方ある案件（status は問わない。cancelled も含む）
 *   ・開催年: event_date の年（year 指定時） / 開催月: event_date の月
 *   ・リード日数 = event_date − inquiry_date（日数）。負（問合せが開催後）は除外
 *   ・平均日数 = 平均を整数に丸める / 平均月数 = 丸めた平均日数 ÷ 30（小数1桁）
 *
 * ■ 追加した情報（既存フィールドは削除・改名しない）
 *   ・medianDays   : 採用したリード日数の中央値（奇数件=中央の値 / 偶数件=中央2値の平均。丸めない）。0件は null
 *   ・medianMonths : medianDays ÷ 30（小数1桁）。0件は null
 *   ・isPartial    : 集計途中か。開催年月が「現在（日本時間）の年月」以上なら true（当月・未来月）。
 *                    開催日が近い問合せは今後も追加されるため、平均値が変動する。
 */
import { toJstWallClock } from './analytics.ts'

export interface LeadTimeCase {
  inquiry_date: string | null
  event_date: string | null
}

export interface LeadTimeRow {
  month: number
  label: string
  /** 先行期間の計算に実際に採用した案件数（日付が揃い、リード日数が負でないもの） */
  count: number
  avgDays: number
  avgMonths: number
  medianDays: number | null
  medianMonths: number | null
  isPartial: boolean
}

export interface LeadTimeTotal {
  count: number
  avgDays: number
  avgMonths: number
  medianDays: number | null
  medianMonths: number | null
  /** 年間の集計に集計途中の月を含む（開催年が現在以降） */
  isPartial: boolean
}

export interface LeadTimeResponse {
  year: string
  rows: LeadTimeRow[]
  total: LeadTimeTotal
}

const DAY_MS = 1000 * 60 * 60 * 24

/** 'YYYY-MM-DD' → 日数（UTC 0時で比較するため、実行環境のタイムゾーンに依存しない） */
const dateToDayNumber = (value: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS
}

/** リード日数 = event_date − inquiry_date（日数）。どちらかが日付として読めなければ NaN */
export function calcLeadDays(inquiryDate: string, eventDate: string): number {
  return Math.round(dateToDayNumber(eventDate) - dateToDayNumber(inquiryDate))
}

/** 中央値。奇数件は中央の1値、偶数件は中央2値の平均。空配列は null。丸めない（.5 になり得る） */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const toMonths = (days: number): number => Math.round((days / 30) * 10) / 10

/**
 * 現在（日本時間）の年月 'YYYY-MM'。
 * Vercel は UTC で動くため、new Date().getMonth() 等は使わない（JST 0:00〜8:59 に前月になってしまう）。
 */
export function getJstYearMonth(now: Date = new Date()): { year: number; month: number } {
  const wall = toJstWallClock(now) // 'YYYY-MM-DDTHH:mm:ss'（日本時間の壁時計）
  return { year: Number(wall.slice(0, 4)), month: Number(wall.slice(5, 7)) }
}

/** 開催年月が「現在（日本時間）の年月」以上なら集計途中（当月・未来月）。過去月は確定した月 */
export function isPartialMonth(eventYear: number, eventMonth: number, now: Date = new Date()): boolean {
  const cur = getJstYearMonth(now)
  return eventYear * 12 + eventMonth >= cur.year * 12 + cur.month
}

/**
 * 先行期間の月別・年間集計。
 * year が数字でない（全期間）場合は、開催月（1〜12）だけでグループ化する従来の挙動のまま。
 * その場合は年が混ざるため、集計途中の判定はしない（isPartial = false）。
 */
export function buildLeadTimeResponse(
  cases: LeadTimeCase[],
  year: string | null,
  now: Date = new Date()
): LeadTimeResponse {
  const byMonth: Record<number, number[]> = {}
  for (let m = 1; m <= 12; m++) byMonth[m] = []

  for (const c of cases) {
    if (!c.event_date || !c.inquiry_date) continue
    const leadDays = calcLeadDays(c.inquiry_date, c.event_date)
    // 日付として読めない・リード日数が負（問合せが開催後）は除外
    if (!Number.isFinite(leadDays) || leadDays < 0) continue
    const month = Number(c.event_date.slice(5, 7)) // 1-12
    if (month >= 1 && month <= 12) byMonth[month].push(leadDays)
  }

  const yearNumber = year !== null && /^\d{4}$/.test(year) ? Number(year) : null

  const rows: LeadTimeRow[] = Object.entries(byMonth).map(([m, days]) => {
    const month = Number(m)
    const count = days.length
    const avgDays = count > 0 ? Math.round(days.reduce((s, d) => s + d, 0) / count) : 0
    const avgMonths = count > 0 ? toMonths(avgDays) : 0
    const median = medianOf(days)
    return {
      month,
      label: `${month}月`,
      count,
      avgDays,
      avgMonths,
      medianDays: median,
      medianMonths: median === null ? null : toMonths(median),
      isPartial: yearNumber !== null && isPartialMonth(yearNumber, month, now),
    }
  })

  const allDays = Object.values(byMonth).flat()
  const totalCount = allDays.length
  const totalAvgDays = totalCount > 0 ? Math.round(allDays.reduce((s, d) => s + d, 0) / totalCount) : 0
  const totalAvgMonths = totalCount > 0 ? toMonths(totalAvgDays) : 0
  const totalMedian = medianOf(allDays)

  return {
    year: year ?? 'all',
    rows,
    total: {
      count: totalCount,
      avgDays: totalAvgDays,
      avgMonths: totalAvgMonths,
      medianDays: totalMedian,
      medianMonths: totalMedian === null ? null : toMonths(totalMedian),
      isPartial: yearNumber !== null && rows.some((r) => r.isPartial),
    },
  }
}
