/**
 * インポート機能 型定義
 * casesテーブルとは独立した型。casesテーブルを直接変更する処理は含まない。
 */

// ─── Session ────────────────────────────────────────────────────────────────

export type ImportSessionStatus = 'uploaded' | 'parsed' | 'staged'

/** アップロード直後のレスポンス */
export interface ImportSessionResponse {
  session_id: string
  filename: string
  available_sheets: string[]   // Excel内の全シート名
  suggested_sheets: string[]   // 1月問合せ系として自動提案したシート名
}

// ─── Parsed Row ──────────────────────────────────────────────────────────────

/** Excelから読み取った1行分のデータ */
export interface ParsedRow {
  row: number                    // Excel行番号（2始まり）

  // 基本情報
  company: string | null
  contact: string | null
  phone: string | null
  email: string | null
  inquiry_date: string | null    // YYYY-MM-DD
  event_date: string | null      // YYYY-MM-DD
  event_name: string | null      // Excelにイベント名列がない場合はnull
  guest_count: number | null
  notes: string | null
  estimate_amount: number | null

  // 時刻（HH:mm:ss 形式）
  start_time: string | null
  end_time: string | null

  // 下見・手続き
  preview_date: string | null    // YYYY-MM-DD
  has_previewed: boolean
  application_form_done: boolean
  invoice_done: boolean
  payment_cash: boolean
  payment_prepaid: boolean

  // マスター照合前の生の値（文字列）
  floor_raw: string | null
  media_raw: string | null
  event_category_raw: string | null
  contact_method_raw: string | null
  cancel_reason_raw: string | null

  // Excelのチェック列から導出したステータス
  status_raw: string

  // Excel元行をそのまま保持（復元・デバッグ用）
  raw_payload: Record<string, unknown>
}

/** 解析エラーが発生した行 */
export interface ImportErrorRow {
  row: number
  reason: string
}

// ─── Parse Response ──────────────────────────────────────────────────────────

/** シート解析後のレスポンス */
export interface ParseSheetResponse {
  session_id: string
  sheet_name: string
  total_rows: number
  error_rows: ImportErrorRow[]
  rows: ParsedRow[]
}

// ─── Stage Response ──────────────────────────────────────────────────────────

/** staging保存後のレスポンス */
export interface StageResponse {
  batch_id: string
  total_rows: number
  message: string
}

// ─── API Error ───────────────────────────────────────────────────────────────

export interface ImportApiError {
  message: string
  code?: string
}

// ─── Phase 2: Staging Row ────────────────────────────────────────────────────

export type StagingClassification = '新規追加' | '重複候補' | '要確認' | 'スキップ'
export type AdminDecision = 'approve' | 'skip'

/** cases_import_staging の1行（照合・承認UI用） */
export interface StagingRow {
  id: string
  batch_id: string
  row_number: number
  raw_payload: Record<string, unknown>

  company: string | null
  contact: string | null
  phone: string | null
  email: string | null
  inquiry_date: string | null
  event_date: string | null
  event_name: string | null
  guest_count: number | null
  notes: string | null
  estimate_amount: number | null
  start_time: string | null
  end_time: string | null
  preview_date: string | null
  has_previewed: boolean
  application_form_done: boolean
  invoice_done: boolean
  payment_cash: boolean
  payment_prepaid: boolean

  floor_raw: string | null
  media_raw: string | null
  event_category_raw: string | null
  contact_method_raw: string | null
  cancel_reason_raw: string | null
  status_raw: string

  floor_id: string | null
  media_id: string | null
  event_category_id: string | null
  contact_method_id: string | null
  cancel_reason_id: string | null

  classification: StagingClassification
  matched_case_id: string | null
  match_score: number | null
  review_notes: string | null
  admin_decision: AdminDecision | null
  created_at: string
}

// ─── Phase 2: Batch Detail ───────────────────────────────────────────────────

export interface BatchDetail {
  id: string
  session_id: string | null
  filename: string
  sheet_name: string
  total_rows: number
  new_count: number
  duplicate_count: number
  review_count: number
  skip_count: number
  applied: boolean
  applied_at: string | null
  applied_by: string | null
  created_at: string
  staging_rows: StagingRow[]
}

// ─── Phase 2: API Responses ──────────────────────────────────────────────────

export interface ClassifyResponse {
  batch_id: string
  total_rows: number
  new_count: number
  duplicate_count: number
  review_count: number
  message: string
}

export interface ApplyResponse {
  batch_id: string
  approved_count: number
  skipped_count: number
  skipped_null_company: number
  message: string
}
