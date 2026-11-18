/**
 * 分析「日別問合せ」タブ用の純粋関数群（DB・ネットワーク非依存）。
 *
 * 計上日は inquiry_date（DATE型・時刻なし）。
 * ・問い合わせ件数   : 全ステータスを含む
 * ・見込額           : cancelled 以外の estimate_amount 合計
 * ・確定額           : confirmed / done の estimate_amount 合計
 *
 * node --test（ネイティブTS実行、@/ エイリアス非対応）から読み込めるよう、
 * 他ファイルへの値importは持たない自己完結のファイルにしている。
 */

export type DailyInquiryKind = 'category' | 'media'

/** マスタ未設定（NULL）の案件をまとめる仮想ID（既存の分析と同じ値） */
export const DAILY_UNASSIGNED_TARGET = '__none__'

/** 選択日の案件一覧の1ページあたり件数 */
export const DAILY_CASES_PAGE_SIZE = 20

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTH_RE = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/
const DAY_RE = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PAGE_RE = /^[1-9]\d{0,3}$/

// ─── 形式検証 ──────────────────────────────────────────────────

export function isDailyKind(value: unknown): value is DailyInquiryKind {
  return value === 'category' || value === 'media'
}

export function isValidDailyTarget(value: unknown): value is string {
  return typeof value === 'string' && (value === DAILY_UNASSIGNED_TARGET || UUID_RE.test(value))
}

export function isValidMonthString(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value)
}

/** 'YYYY-MM-DD' かつ実在する日付 */
export function isValidDayString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DAY_RE.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export function isDayInMonth(day: string, month: string): boolean {
  return isValidDayString(day) && isValidMonthString(month) && day.startsWith(`${month}-`)
}

export function isValidPageString(value: unknown): value is string {
  return typeof value === 'string' && PAGE_RE.test(value)
}

// ─── 月の計算 ──────────────────────────────────────────────────

/** 'YYYY-MM' を delta か月ずらす（1月の前月は前年12月） */
export function shiftMonth(month: string, delta: number): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error('invalid month')
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const year = Math.floor(index / 12)
  const mon = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`
}

/** 月の初日〜末日（YYYY-MM-DD）。うるう年を考慮する */
export function calcMonthRange(month: string): { gte: string; lte: string } {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error('invalid month')
  const lastDay = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return { gte: `${month}-01`, lte: `${month}-${String(lastDay).padStart(2, '0')}` }
}

/** 実行環境のタイムゾーンに依存せず、Asia/Tokyo の今日（YYYY-MM-DD）を返す */
export function getJstTodayString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now)
}

/** 当月または未来の月か（集計中の注記用） */
export function isMonthInProgress(month: string, now: Date = new Date()): boolean {
  if (!isValidMonthString(month)) return false
  return month >= getJstTodayString(now).slice(0, 7)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** '2026-10-08' → '10月8日（木）' */
export function formatDayLabel(day: string): string {
  const m = DAY_RE.exec(day)
  if (!m) return day
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${Number(m[2])}月${Number(m[3])}日（${WEEKDAYS[weekday]}）`
}

// ─── URL の条件（view / tab / kind / target / month / day / page のみ）──────

export interface DailyInquiryState {
  kind: DailyInquiryKind | ''
  target: string
  month: string
  day: string
  page: number
}

export interface DailyInquiryParsed extends DailyInquiryState {
  /** URL が「日別問合せタブ」を指している（view=inquiry かつ tab=daily） */
  requested: boolean
}

/** URL のクエリから条件を読む。不正な値は無視（空）にする。重複キーは先頭のみ */
export function parseDailyParams(params: { get(name: string): string | null }): DailyInquiryParsed {
  const empty: DailyInquiryParsed = { requested: false, kind: '', target: '', month: '', day: '', page: 1 }
  if (params.get('view') !== 'inquiry' || params.get('tab') !== 'daily') return empty

  const kindRaw = params.get('kind')
  const kind: DailyInquiryKind | '' = isDailyKind(kindRaw) ? kindRaw : ''

  const targetRaw = params.get('target')
  const target = kind && isValidDailyTarget(targetRaw) ? targetRaw : ''

  const monthRaw = params.get('month')
  const month = isValidMonthString(monthRaw) ? monthRaw : ''

  const dayRaw = params.get('day')
  const day = target && month && typeof dayRaw === 'string' && isDayInMonth(dayRaw, month) ? dayRaw : ''

  const pageRaw = params.get('page')
  const page = day && isValidPageString(pageRaw) ? Number(pageRaw) : 1

  return { requested: true, kind, target, month, day, page }
}

/** 条件から分析画面のURL（相対）を作る。空の条件は含めない */
export function buildDailyUrl(state: DailyInquiryState): string {
  const q = new URLSearchParams()
  q.set('view', 'inquiry')
  q.set('tab', 'daily')
  if (state.kind) q.set('kind', state.kind)
  if (state.kind && state.target) q.set('target', state.target)
  if (state.month) q.set('month', state.month)
  if (state.target && state.month && state.day) {
    q.set('day', state.day)
    if (state.page > 1) q.set('page', String(state.page))
  }
  return `/analytics?${q.toString()}`
}

// ─── APIリクエストの検証 ───────────────────────────────────────

export interface DailySummaryRequest {
  kind: DailyInquiryKind
  target: string
  month: string
}

export function parseSummaryRequest(params: { get(name: string): string | null }): DailySummaryRequest | null {
  const kind = params.get('kind')
  const target = params.get('target')
  const month = params.get('month')
  if (!isDailyKind(kind) || !isValidDailyTarget(target) || !isValidMonthString(month)) return null
  return { kind, target, month }
}

export interface DailyCasesRequest {
  kind: DailyInquiryKind
  target: string
  date: string
  page: number
}

export function parseCasesRequest(params: { get(name: string): string | null }): DailyCasesRequest | null {
  const kind = params.get('kind')
  const target = params.get('target')
  const date = params.get('date')
  const pageRaw = params.get('page') ?? '1'
  if (!isDailyKind(kind) || !isValidDailyTarget(target) || !isValidDayString(date) || !isValidPageString(pageRaw)) {
    return null
  }
  return { kind, target, date, page: Number(pageRaw) }
}

// ─── 集計 ──────────────────────────────────────────────────────

export interface DailyRow {
  inquiry_date: string
  status: string
  estimate_amount: number | string | null
}

export interface MonthTotals {
  count: number
  estimateTotal: number
  confirmedTotal: number
}

export interface DaySummary extends MonthTotals {
  date: string
}

const CONFIRMED_STATUSES = ['confirmed', 'done']

function toAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

/** 見込額に含めるか（cancelled 以外） */
export function isEstimateStatus(status: string): boolean {
  return status !== 'cancelled'
}

/** 確定額に含めるか（confirmed / done） */
export function isConfirmedStatus(status: string): boolean {
  return CONFIRMED_STATUSES.includes(status)
}

/** 問い合わせ日ごとの件数・見込額・確定額（日付昇順。問い合わせのあった日だけ） */
export function aggregateByDay(rows: DailyRow[]): DaySummary[] {
  const map = new Map<string, DaySummary>()
  for (const row of rows) {
    const date = String(row.inquiry_date).slice(0, 10)
    let day = map.get(date)
    if (!day) {
      day = { date, count: 0, estimateTotal: 0, confirmedTotal: 0 }
      map.set(date, day)
    }
    const amount = toAmount(row.estimate_amount)
    day.count += 1
    if (isEstimateStatus(row.status)) day.estimateTotal += amount
    if (isConfirmedStatus(row.status)) day.confirmedTotal += amount
  }
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** 日別の集計から月合計を作る（日別一覧の合計行と必ず一致する） */
export function totalsFromDays(days: DaySummary[]): MonthTotals {
  return days.reduce<MonthTotals>(
    (sum, d) => ({
      count: sum.count + d.count,
      estimateTotal: sum.estimateTotal + d.estimateTotal,
      confirmedTotal: sum.confirmedTotal + d.confirmedTotal,
    }),
    { count: 0, estimateTotal: 0, confirmedTotal: 0 }
  )
}

// ─── 前月比・前年同月比 ─────────────────────────────────────────

export interface Comparison {
  diff: number
  /** 比率（%、小数点1桁）。比較対象が0のときは null */
  ratio: number | null
}

export function compareValues(current: number, previous: number): Comparison {
  return {
    diff: current - previous,
    ratio: previous === 0 ? null : Math.round((current / previous) * 1000) / 10,
  }
}

/** 比率の表示。比較対象が0（null）のときは '—' */
export function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : `${ratio.toFixed(1)}%`
}

/** 件数の差分。0 は '±0件' */
export function formatCountDiff(diff: number): string {
  if (diff > 0) return `+${diff}件`
  if (diff < 0) return `${diff}件`
  return '±0件'
}

/** 金額の差分（符号付き。円記号は付けない）。0 は '±0' */
export function formatAmountDiff(diff: number): string {
  if (diff > 0) return `+${diff.toLocaleString('ja-JP')}`
  if (diff < 0) return `-${Math.abs(diff).toLocaleString('ja-JP')}`
  return '±0'
}

// ─── 取得上限（1,000行）への対処 ───────────────────────────────

export interface PageResult<T> {
  data: T[] | null
  count: number | null
  error: unknown
}

export type FetchAllResult<T> = { ok: true; rows: T[] } | { ok: false }

/**
 * 1,000行ずつ取得して全件を集める。
 * ・error / データ無し / count が取れない → 失敗
 * ・ページ間で count が変わった（読み取り中に件数が動いた）→ 失敗
 * ・集めた件数が count と一致しない → 失敗（欠落を0件扱いにしない）
 * fetchPage は「決まった並び順」でのページ取得であること（呼び出し側の責務）。
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize = 1000,
  maxPages = 50
): Promise<FetchAllResult<T>> {
  const rows: T[] = []
  let expected: number | null = null

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const res = await fetchPage(from, from + pageSize - 1)
    if (res.error || !Array.isArray(res.data)) return { ok: false }
    if (typeof res.count !== 'number' || !Number.isFinite(res.count) || res.count < 0) return { ok: false }
    if (expected === null) expected = res.count
    else if (res.count !== expected) return { ok: false }

    rows.push(...res.data)
    if (rows.length >= expected || res.data.length === 0) {
      return rows.length === expected ? { ok: true, rows } : { ok: false }
    }
  }
  return { ok: false }
}

export function calcTotalPages(totalCount: number, pageSize: number = DAILY_CASES_PAGE_SIZE): number {
  return totalCount <= 0 ? 0 : Math.ceil(totalCount / pageSize)
}

// ─── 選択日の案件一覧（返す項目を限定する）──────────────────────

export interface DailyCaseItem {
  id: string
  company: string | null
  eventName: string | null
  status: string
  autoCancel: boolean
  estimateAmount: number
  categoryName: string | null
  subcategoryLabel: string | null
}

/** 埋め込みの結合結果（オブジェクトまたは配列）から name を取り出す */
export function pickMasterName(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value
  if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') {
    return (v as { name: string }).name
  }
  return null
}

/** 中分類の表示名。「その他」で自由入力があれば併記する（案件詳細と同じ） */
export function formatSubcategoryLabel(name: string | null, note: string | null | undefined): string | null {
  if (name === 'その他' && typeof note === 'string' && note.trim() !== '') return `その他（${note}）`
  return name
}

/**
 * DBの行から、表示に必要な項目だけを取り出す。
 * 担当者名・電話・メール・備考・添付・履歴など、他の項目は一切含めない。
 */
export function mapDailyCaseRow(raw: unknown): DailyCaseItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.status !== 'string') return null
  return {
    id: r.id,
    company: typeof r.company === 'string' ? r.company : null,
    eventName: typeof r.event_name === 'string' ? r.event_name : null,
    status: r.status,
    autoCancel: r.auto_cancel === true,
    estimateAmount: toAmount(r.estimate_amount),
    categoryName: pickMasterName(r.event_category_master),
    subcategoryLabel: formatSubcategoryLabel(
      pickMasterName(r.event_subcategory_master),
      typeof r.event_subcategory_note === 'string' ? r.event_subcategory_note : null
    ),
  }
}

// ─── APIレスポンスの検証（画面側）──────────────────────────────

export interface DailySummaryResponse {
  kind: DailyInquiryKind
  target: string
  month: string
  previousMonth: string
  previousYearMonth: string
  current: MonthTotals & { inquiryDays: number; days: DaySummary[] }
  previous: MonthTotals
  previousYear: MonthTotals
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function isMonthTotals(v: unknown): v is MonthTotals {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  return isNonNegativeNumber(t.count) && isNonNegativeNumber(t.estimateTotal) && isNonNegativeNumber(t.confirmedTotal)
}

/** 構造と、日別の合計が月合計と一致することを確認する（不一致は不正として扱う） */
export function isValidDailySummaryResponse(d: unknown): d is DailySummaryResponse {
  if (!d || typeof d !== 'object') return false
  const r = d as Record<string, unknown>
  if (!isDailyKind(r.kind) || !isValidDailyTarget(r.target)) return false
  if (!isValidMonthString(r.month) || !isValidMonthString(r.previousMonth) || !isValidMonthString(r.previousYearMonth)) {
    return false
  }
  if (!isMonthTotals(r.previous) || !isMonthTotals(r.previousYear)) return false

  const cur = r.current as Record<string, unknown> | undefined
  if (!cur || !isMonthTotals(cur) || !isNonNegativeNumber(cur.inquiryDays) || !Array.isArray(cur.days)) return false

  const days = cur.days as unknown[]
  for (const day of days) {
    if (!day || typeof day !== 'object') return false
    const dd = day as Record<string, unknown>
    if (!isValidDayString(dd.date) || !isDayInMonth(dd.date as string, r.month as string)) return false
    if (!isMonthTotals(dd)) return false
  }
  const typedDays = days as DaySummary[]
  if (cur.inquiryDays !== typedDays.length) return false
  const sum = totalsFromDays(typedDays)
  return (
    sum.count === cur.count && sum.estimateTotal === cur.estimateTotal && sum.confirmedTotal === cur.confirmedTotal
  )
}

export interface DailyCasesResponse {
  date: string
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  cases: DailyCaseItem[]
}

export function isValidDailyCasesResponse(d: unknown): d is DailyCasesResponse {
  if (!d || typeof d !== 'object') return false
  const r = d as Record<string, unknown>
  if (!isValidDayString(r.date)) return false
  if (!isNonNegativeNumber(r.page) || !isNonNegativeNumber(r.pageSize) || !isNonNegativeNumber(r.totalCount)) {
    return false
  }
  if (!isNonNegativeNumber(r.totalPages) || !Array.isArray(r.cases)) return false
  if ((r.cases as unknown[]).length > (r.pageSize as number)) return false
  return (r.cases as unknown[]).every((c) => {
    if (!c || typeof c !== 'object') return false
    const x = c as Record<string, unknown>
    return typeof x.id === 'string' && typeof x.status === 'string' && isNonNegativeNumber(x.estimateAmount)
  })
}
