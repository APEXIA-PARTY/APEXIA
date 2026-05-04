/**
 * Excel解析ロジック
 *
 * 【安全保証】
 * - このモジュールはcasesテーブルに一切アクセスしない
 * - DBへの書き込みは行わない（純粋な変換ロジックのみ）
 * - console.log に個人情報・キーを出力しない
 */

import * as XLSX from 'xlsx'
import type { ParsedRow, ImportErrorRow } from '@/types/import'

export const PARSER_VERSION = '1.0.0'

// ─── シート提案 ──────────────────────────────────────────────────────────────

/**
 * 「1月問合せ」系シートを自動提案する
 * 条件: 「問合せ」または「問い合わせ」を含み、かつ「1月」または「01月」を含む
 */
export function suggestJanuaryInquirySheets(sheetNames: string[]): string[] {
  return sheetNames.filter(name => {
    const hasInquiry = name.includes('問合せ') || name.includes('問い合わせ')
    const hasJan = name.includes('1月') || name.includes('01月')
    return hasInquiry && hasJan
  })
}

/**
 * Excelバッファからシート名一覧を取得する
 */
export function getSheetNames(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  return workbook.SheetNames
}

// ─── 内部ユーティリティ ──────────────────────────────────────────────────────

/**
 * 値を YYYY-MM-DD 文字列に変換する
 * Excel日付（Date オブジェクト）、数値、文字列に対応
 */
function toDateString(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, '0')
    const d = String(val.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (!trimmed) return null
    // YYYY/MM/DD や YYYY-MM-DD 形式に対応
    const normalized = trimmed.replace(/\//g, '-')
    const d = new Date(normalized)
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const dy = String(d.getDate()).padStart(2, '0')
      return `${y}-${mo}-${dy}`
    }
  }

  return null
}

/**
 * 時刻を HH:mm:ss 形式の文字列に変換する
 * Excelの「開始時(h)」「開始分(m)」列から組み立てる
 */
function buildTimeString(h: unknown, m: unknown): string | null {
  if (h === null || h === undefined || h === '') return null
  const hh = Math.floor(Number(h))
  if (isNaN(hh) || hh < 0 || hh > 23) return null
  const mm = Math.floor(Number(m ?? 0))
  const safeMm = isNaN(mm) ? 0 : Math.max(0, Math.min(59, mm))
  return `${String(hh).padStart(2, '0')}:${String(safeMm).padStart(2, '0')}:00`
}

/**
 * 数値に変換する（変換できない場合はnull）
 */
function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  // カンマ区切りの数値文字列にも対応
  const cleaned = typeof val === 'string' ? val.replace(/,/g, '').trim() : val
  const n = Number(cleaned)
  return isNaN(n) ? null : n
}

/**
 * boolean に変換する
 * Excel のチェックボックスは TRUE/FALSE またはboolean値で入る
 */
function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val !== 0
  if (typeof val === 'string') {
    const s = val.trim().toUpperCase()
    return s === 'TRUE' || s === '1' || s === 'YES' || s === 'はい'
  }
  return false
}

/**
 * 文字列に変換し、空の場合はnullを返す
 */
function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

/**
 * 集計行かどうかを判定する
 *
 * 以下のいずれかに該当する行は集計行とみなす：
 * - いずれかのセルが "3.8%" のような割合文字列（数字のみ + %）
 * - いずれかのセルに "件数" / "割合" / "集計" を含む
 *
 * 集計行を検出したらループを break（以降のすべての行を読み込まない）。
 * ※ 電話番号（例: "090-1234-5678"）はパターン不一致のため誤判定しない。
 */
function isSummaryRow(row: unknown[]): boolean {
  const SUMMARY_KEYWORDS = ['件数', '割合', '集計']
  const PCT_PATTERN = /^\d+(\.\d+)?%$/   // "3.8%", "100.0%" のみマッチ

  for (const cell of row) {
    if (cell === null || cell === undefined) continue
    const s = String(cell).trim()
    if (!s) continue
    if (PCT_PATTERN.test(s)) return true
    for (const kw of SUMMARY_KEYWORDS) {
      if (s.includes(kw)) return true
    }
  }
  return false
}

/**
 * 実案件として必要な主要フィールドがすべて空かを判定する
 *
 * company / contact / inquiryDate / eventDate / eventCategory / media / floor / notes
 * が全部 null/空白 の場合に true を返す（空テンプレート行の除外用）。
 */
function isEmptyCaseRow(row: unknown[], col: ColumnIndex): boolean {
  const mainIndices = [
    col.company, col.contact, col.inquiryDate, col.eventDate,
    col.eventCategory, col.media, col.floor, col.notes,
  ]
  return mainIndices.every(idx => {
    if (idx < 0) return true
    const v = row[idx]
    return v === null || v === undefined || String(v).trim() === ''
  })
}

// ─── 列インデックス解決 ──────────────────────────────────────────────────────

interface ColumnIndex {
  no: number
  company: number
  contact: number
  inquiryDate: number
  previewDate: number
  eventDate: number
  startH: number
  startM: number
  endH: number
  endM: number
  contactMethod: number
  phone: number
  email: number
  media: number
  eventCategory: number
  floor: number
  cancelReasonText: number   // キャンセル理由（テキスト）
  notes: number
  estimateAmount: number
  hasPreviewed: number
  applicationForm: number
  invoice: number
  paymentCash: number
  paymentPrepaid: number
  cancelCheck: number        // キャンセル（チェックボックス）
  tentativeCheck: number     // 仮押さえ（チェックボックス）
  confirmedCheck: number     // 確定（チェックボックス）
  previewWaitCheck: number   // 下見待ち（チェックボックス）
}

/**
 * ヘッダー行から列インデックスを解決する（柔軟マッチング）
 */
function resolveColumns(headers: string[]): ColumnIndex {
  const find = (...keywords: string[]): number => {
    for (const kw of keywords) {
      const idx = headers.findIndex(h => h !== '' && h.includes(kw))
      if (idx >= 0) return idx
    }
    return -1
  }

  // キャンセル理由 と キャンセルチェック を区別する
  // 「キャンセル理由」を先に特定し、単独「キャンセル」はチェックボックス
  const cancelReasonIdx = headers.findIndex(h =>
    h.includes('キャンセル理由') || h.includes('キャンセル理由')
  )
  const cancelCheckIdx = headers.findIndex((h, i) =>
    i !== cancelReasonIdx &&
    (h === 'キャンセル' || (h.includes('キャンセル') && !h.includes('理由')))
  )

  return {
    no:               find('No', 'no', 'NO'),           // '番号'は除外（'電話番号'に誤マッチするため）
    company:          find('会社名', '団体名'),
    contact:          find('担当者名', '担当者'),
    inquiryDate:      find('問い合わせ日', '問合せ日', '問合わせ日'),
    previewDate:      find('下見日'),
    eventDate:        find('開催日'),
    startH:           find('開始時'),
    startM:           find('開始分'),
    endH:             find('終了時'),
    endM:             find('終了分'),
    contactMethod:    find('連絡方法'),
    phone:            find('電話'),
    email:            find('メール'),
    media:            find('認知経路'),
    eventCategory:    find('イベント内容', 'イベント'),
    floor:            find('階数', 'フロア'),
    cancelReasonText: cancelReasonIdx,
    notes:            find('備考メモ', '備考'),
    estimateAmount:   find('見込み金額', '見込金額'),
    hasPreviewed:     find('下見済み'),
    applicationForm:  find('申込フォーム', '申し込みフォーム'),
    invoice:          find('請求書'),
    paymentCash:      find('当日支払い', '現金'),
    paymentPrepaid:   find('事前支払い'),
    cancelCheck:      cancelCheckIdx,
    tentativeCheck:   find('仮押さえ'),
    confirmedCheck:   find('確定'),
    previewWaitCheck: find('下見待ち'),
  }
}

// ─── メイン解析処理 ──────────────────────────────────────────────────────────

export interface ParseSheetResult {
  rows: ParsedRow[]
  errorRows: ImportErrorRow[]
}

/**
 * 指定したシートを解析して ParsedRow[] を返す
 *
 * 【安全保証】
 * - casesテーブルには一切アクセスしない
 * - DBへの書き込みは行わない
 */
export function parseSheet(buffer: Buffer, sheetName: string): ParseSheetResult {
  // cellDates: true でExcel日付を Date オブジェクトとして取得
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new Error(`シート「${sheetName}」が見つかりません`)
  }

  // header:1 で配列の配列として取得（ヘッダー行含む）
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  })

  if (rawData.length < 2) {
    return { rows: [], errorRows: [] }
  }

  // 1行目をヘッダーとして取得・正規化
  const headerRow = (rawData[0] as unknown[]).map(h =>
    h == null ? '' : String(h).trim()
  )

  const col = resolveColumns(headerRow)

  const rows: ParsedRow[] = []
  const errorRows: ImportErrorRow[] = []

  for (let i = 1; i < rawData.length; i++) {
    const raw = rawData[i] as unknown[]
    const excelRowNum = i + 1 // Excel上の行番号（1行目がヘッダーなので2始まり）

    // ── スキップ判定 ──────────────────────────────────────────
    // 集計行（件数/割合/集計キーワード、割合%パターン）→ 以降を読み込まない
    if (isSummaryRow(raw)) break

    // 主要フィールドが全部空の行はスキップ（空テンプレート行など）
    if (isEmptyCaseRow(raw, col)) continue

    // No列が数値でない行はスキップ（空行・区切り行など）
    if (col.no >= 0) {
      const noVal = raw[col.no]
      if (noVal === null || noVal === undefined || noVal === '') continue
      if (isNaN(Number(String(noVal).replace(/[,\s]/g, '')))) continue
    }

    // 会社名・担当者名が両方空の行はスキップ（念押し）
    const company = col.company >= 0 ? toStr(raw[col.company]) : null
    const contact = col.contact >= 0 ? toStr(raw[col.contact]) : null
    if (!company && !contact) continue

    try {
      // ── raw_payload: Excel元行を丸ごと保存 ───────────────────
      const rawPayload: Record<string, unknown> = { _row: excelRowNum }
      headerRow.forEach((h, idx) => {
        if (!h) return
        const v = raw[idx]
        // Date オブジェクトは ISO 文字列に変換して保存
        rawPayload[h] = v instanceof Date ? v.toISOString() : (v ?? null)
      })

      // ── ステータス判定 ────────────────────────────────────────
      const isCancelled  = col.cancelCheck    >= 0 ? toBool(raw[col.cancelCheck])    : false
      const isConfirmed  = col.confirmedCheck >= 0 ? toBool(raw[col.confirmedCheck]) : false
      const isTentative  = col.tentativeCheck >= 0 ? toBool(raw[col.tentativeCheck]) : false
      const hasPreviewed = col.hasPreviewed   >= 0 ? toBool(raw[col.hasPreviewed])   : false
      const previewWait  = col.previewWaitCheck >= 0 ? toBool(raw[col.previewWaitCheck]) : false

      let statusRaw = 'inquiry'
      if (isCancelled) {
        statusRaw = 'cancelled'
      } else if (isConfirmed) {
        // 確定済みでも開催日が過去なら done に変換
        // YYYY-MM-DD 文字列同士の辞書比較（タイムゾーン影響なし）
        const eventDateStr = col.eventDate >= 0 ? toDateString(raw[col.eventDate]) : null
        const now = new Date()
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        statusRaw = (eventDateStr && eventDateStr < todayStr) ? 'done' : 'confirmed'
      } else if (isTentative) {
        statusRaw = 'tentative'
      } else if (hasPreviewed) {
        statusRaw = 'previewed'
      } else if (previewWait) {
        statusRaw = 'preview_adj'
      }

      // ── 各フィールドを解析 ────────────────────────────────────
      const parsed: ParsedRow = {
        row: excelRowNum,

        company,
        contact,
        phone:          col.phone >= 0 ? toStr(raw[col.phone]) : null,
        email:          col.email >= 0 ? toStr(raw[col.email]) : null,

        inquiry_date:   col.inquiryDate >= 0 ? toDateString(raw[col.inquiryDate]) : null,
        event_date:     col.eventDate   >= 0 ? toDateString(raw[col.eventDate])   : null,
        event_name:     null, // Excel の「イベント内容」は event_category_raw として扱う
        guest_count:    null,
        notes:          col.notes >= 0 ? toStr(raw[col.notes]) : null,
        estimate_amount: col.estimateAmount >= 0 ? toNumber(raw[col.estimateAmount]) : null,

        start_time: buildTimeString(
          col.startH >= 0 ? raw[col.startH] : null,
          col.startM >= 0 ? raw[col.startM] : null,
        ),
        end_time: buildTimeString(
          col.endH >= 0 ? raw[col.endH] : null,
          col.endM >= 0 ? raw[col.endM] : null,
        ),

        preview_date:          col.previewDate    >= 0 ? toDateString(raw[col.previewDate]) : null,
        has_previewed:         hasPreviewed,
        application_form_done: col.applicationForm >= 0 ? toBool(raw[col.applicationForm]) : false,
        invoice_done:          col.invoice         >= 0 ? toBool(raw[col.invoice])          : false,
        payment_cash:          col.paymentCash     >= 0 ? toBool(raw[col.paymentCash])      : false,
        payment_prepaid:       col.paymentPrepaid  >= 0 ? toBool(raw[col.paymentPrepaid])   : false,

        floor_raw:          col.floor           >= 0 ? toStr(raw[col.floor])            : null,
        media_raw:          col.media           >= 0 ? toStr(raw[col.media])            : null,
        event_category_raw: col.eventCategory   >= 0 ? toStr(raw[col.eventCategory])   : null,
        contact_method_raw: col.contactMethod   >= 0 ? toStr(raw[col.contactMethod])   : null,
        cancel_reason_raw:  col.cancelReasonText >= 0 ? toStr(raw[col.cancelReasonText]) : null,

        status_raw: statusRaw,
        raw_payload: rawPayload,
      }

      rows.push(parsed)
    } catch (err) {
      errorRows.push({
        row: excelRowNum,
        reason: err instanceof Error ? err.message : '不明な解析エラー',
      })
    }
  }

  return { rows, errorRows }
}
