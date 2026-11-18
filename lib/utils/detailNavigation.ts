/**
 * 案件詳細の「← 前の画面に戻る」用の純粋関数群（DB・ネットワーク・ブラウザAPI非依存）。
 *
 * 案件一覧／日別問合せから案件詳細を通常クリック（または Enter）で開く直前に、
 * 同じタブの sessionStorage へ「直前の1件だけ」を保存し、詳細側で検証してから戻る。
 * 保存内容は 一時番号・案件ID・遷移元種別・元画面の相対URL だけ。
 * 元画面URL（会社名の検索語を含み得る）は、読み出すたびに検証して作り直す。
 *
 * node --test から読み込めるよう、他ファイルへの値importは持たない自己完結のファイル。
 */

export const DETAIL_NAV_STORAGE_KEY = 'apexia:detail-nav'

export type DetailNavFrom = 'cases' | 'analytics'

export interface DetailNavRecord {
  nav: string
  caseId: string
  from: DetailNavFrom
  returnUrl: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YEAR_RE = /^(?:19|20)\d{2}$/
const CASES_MONTH_RE = /^(?:0?[1-9]|1[0-2])$/
const ANALYTICS_MONTH_RE = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/
const ANALYTICS_DAY_RE = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PAGE_RE = /^[1-9]\d{0,3}$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/

const MAX_URL_LENGTH = 2000
const PLACEHOLDER_ORIGIN = 'http://apexia.invalid'

const CASE_STATUSES = ['inquiry', 'preview_adj', 'previewed', 'tentative', 'confirmed', 'cancelled', 'done']
const CASE_SORT_KEYS = ['inquiry_date', 'event_date', 'updated_at', 'estimate_amount']

export function isDetailNavFrom(value: unknown): value is DetailNavFrom {
  return value === 'cases' || value === 'analytics'
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function hasControlChar(value: string): boolean {
  return CONTROL_RE.test(value)
}

function isRealDay(value: string): boolean {
  const m = ANALYTICS_DAY_RE.exec(value)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

type ParamRule = (value: string, all: URLSearchParams) => boolean

/** 案件一覧（/cases）が使うキー。既存の buildUrl と同じキー構成 */
const CASES_RULES: [string, ParamRule][] = [
  ['search', (v) => !hasControlChar(v)],
  ['status', (v) => CASE_STATUSES.includes(v)],
  ['media_id', (v) => UUID_RE.test(v)],
  ['floor_id', (v) => UUID_RE.test(v)],
  ['year', (v) => YEAR_RE.test(v)],
  ['month', (v) => CASES_MONTH_RE.test(v)],
  ['page', (v) => PAGE_RE.test(v)],
  ['sortBy', (v) => CASE_SORT_KEYS.includes(v)],
  ['sortOrder', (v) => v === 'asc' || v === 'desc'],
]

/** 分析画面（/analytics）が使うキー（日別問合せタブの条件だけ） */
const ANALYTICS_RULES: [string, ParamRule][] = [
  ['view', (v) => v === 'inquiry'],
  ['tab', (v) => v === 'daily'],
  ['kind', (v) => v === 'category' || v === 'media'],
  ['target', (v) => v === '__none__' || UUID_RE.test(v)],
  ['month', (v) => ANALYTICS_MONTH_RE.test(v)],
  [
    'day',
    (v, all) => {
      const month = all.get('month')
      return isRealDay(v) && typeof month === 'string' && v.startsWith(`${month}-`)
    },
  ],
  ['page', (v) => PAGE_RE.test(v)],
]

/**
 * 元画面URLを検証し、許可した部分から作り直して返す。不正なら null。
 * ・先頭が `/` で、`//`・`\`・`#`・制御文字・過長を拒否
 * ・パス名は完全一致で /cases（from=cases）または /analytics（from=analytics）のみ
 * ・クエリは既知のキーだけを残し、値の形式を検証する（未知のキーは捨てる。空の値は未設定として捨てる）
 * ・既知のキーで形式が不正な値があれば、全体を拒否する
 */
export function sanitizeReturnUrl(from: unknown, raw: unknown): string | null {
  if (!isDetailNavFrom(from)) return null
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return null
  if (raw[0] !== '/' || raw.startsWith('//')) return null
  if (raw.includes('\\') || raw.includes('#') || hasControlChar(raw)) return null

  let url: URL
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null

  const path = from === 'cases' ? '/cases' : '/analytics'
  if (url.pathname !== path) return null

  const rules = from === 'cases' ? CASES_RULES : ANALYTICS_RULES
  const out = new URLSearchParams()
  for (const [key, isValid] of rules) {
    const value = url.searchParams.get(key)
    if (value === null || value === '') continue
    if (!isValid(value, url.searchParams)) return null
    out.set(key, value)
  }
  const query = out.toString()
  return query ? `${path}?${query}` : path
}

/** 保存する記録を作る。元画面URLは検証済みの値に作り直す。不正なら null */
export function createDetailNavRecord(input: {
  nav: string
  caseId: string
  from: DetailNavFrom
  returnUrl: string
}): DetailNavRecord | null {
  if (!isUuid(input.nav) || !isUuid(input.caseId) || !isDetailNavFrom(input.from)) return null
  const returnUrl = sanitizeReturnUrl(input.from, input.returnUrl)
  if (!returnUrl) return null
  return { nav: input.nav, caseId: input.caseId, from: input.from, returnUrl }
}

export function serializeDetailNavRecord(record: DetailNavRecord): string {
  return JSON.stringify({
    nav: record.nav,
    caseId: record.caseId,
    from: record.from,
    returnUrl: record.returnUrl,
  })
}

/** sessionStorage の文字列を記録として読む。形式が違う・余計な項目がある場合は null */
export function parseDetailNavRecord(raw: string | null | undefined): DetailNavRecord | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH + 500) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const keys = Object.keys(r).sort()
  if (keys.join(',') !== 'caseId,from,nav,returnUrl') return null
  if (typeof r.nav !== 'string' || typeof r.caseId !== 'string' || typeof r.returnUrl !== 'string') return null
  if (!isDetailNavFrom(r.from) || !isUuid(r.nav) || !isUuid(r.caseId)) return null
  return { nav: r.nav, caseId: r.caseId, from: r.from, returnUrl: r.returnUrl }
}

/** 案件詳細へのURL。顧客情報は含まない（from と nav は意味のない固定値・乱数） */
export function buildDetailHref(caseId: string, from: DetailNavFrom, nav: string): string {
  return `/cases/${caseId}?from=${from}&nav=${nav}`
}

/**
 * 詳細画面で、戻り先として使ってよいURLを返す。次がすべて成り立つときだけ。
 *  1. URLの from が cases/analytics、nav がUUID形式
 *  2. 保存された記録の nav が URL の nav と一致
 *  3. 記録の案件ID が表示中の案件IDと一致
 *  4. 記録の遷移元種別が URL の from と一致
 *  5. 記録の元画面URLの検証に合格（作り直したURLを返す）
 * 満たさなければ null（新しい戻るボタンは出さない）。
 */
export function resolveBackTarget(input: {
  urlFrom: unknown
  urlNav: unknown
  pageCaseId: unknown
  rawRecord: string | null | undefined
}): string | null {
  const { urlFrom, urlNav, pageCaseId, rawRecord } = input
  if (!isDetailNavFrom(urlFrom) || !isUuid(urlNav) || !isUuid(pageCaseId)) return null
  const record = parseDetailNavRecord(rawRecord)
  if (!record) return null
  if (record.nav.toLowerCase() !== urlNav.toLowerCase()) return null
  if (record.caseId.toLowerCase() !== pageCaseId.toLowerCase()) return null
  if (record.from !== urlFrom) return null
  return sanitizeReturnUrl(record.from, record.returnUrl)
}

export interface ClickLike {
  button: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented?: boolean
}

export interface AnchorLike {
  target?: string | null
  download?: boolean
}

/**
 * 通常の左クリック／Enter（ブラウザ上は button=0 の click）だけ介入する。
 * Ctrl・Cmd・Shift・Alt、中・右クリック、target=_blank、ダウンロードでは介入しない。
 */
export function shouldInterceptClick(click: ClickLike, anchor: AnchorLike = {}): boolean {
  if (click.defaultPrevented) return false
  if (click.button !== 0) return false
  if (click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return false
  if (anchor.download) return false
  const target = anchor.target
  if (target && target !== '_self') return false
  return true
}
