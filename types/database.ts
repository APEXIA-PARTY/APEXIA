/**
 * Supabase データベース型定義
 * supabase gen types typescript コマンドで自動生成可能
 * Phase 1 では手動で定義
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── ステータス定義 ───────────────────────────────────────────
export type CaseStatus =
  | 'inquiry'       // 新規問合せ
  | 'preview_adj'   // 下見調整中
  | 'previewed'     // 下見済み
  | 'tentative'     // 仮押さえ
  | 'confirmed'     // 確定
  | 'cancelled'     // キャンセル（手動・自動共通）
  | 'done'          // 開催終了

export type UserRole = 'admin' | 'staff' | 'viewer'

export type OptionCategory = 'equipment' | 'machine'
export type MachineCategory = '音響' | '照明' | '映像'

export type ApplicationFormStatus = '未対応' | '済み'
export type DeliveryNoticeStatus = '未対応' | '済み'
export type InvoiceStatus = '未対応' | '発行依頼' | '送付済み' | '振り込み済み'
export type PaymentMethod = 'キャッシュレス' | '現金' | '現金+キャッシュレス'

export type FileType = '見積書' | '請求書' | '進行表' | 'レイアウト図' | 'その他'

export type ChecklistState = '確認中' | '確定'
export type OptionState = '未確認' | '質問中' | '検討中' | '確定' | '不要'

export type CaseHistoryActionType =
  | 'create'
  | 'update'
  | 'status_change'
  | 'auto_cancel'
  | 'file_upload'
  | 'gcal_sync'

// ─── マスタテーブル ────────────────────────────────────────────
export interface MediaMaster {
  id: string
  name: string
  monthly_cost: number | null
  note: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ContactMethodMaster {
  id: string
  name: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EventCategoryMaster {
  id: string
  name: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EventSubcategoryMaster {
  id: string
  category_id: string
  name: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  // JOIN
  event_category_master?: EventCategoryMaster
}

export interface FloorMaster {
  id: string
  name: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CancelReasonMaster {
  id: string
  name: string
  is_auto_cancel: boolean
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OptionMaster {
  id: string
  name: string
  category: OptionCategory
  machine_category: MachineCategory | null
  default_price: number
  unit: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── 案件テーブル ──────────────────────────────────────────────
export interface Case {
  id: string
  // 基本情報
  company: string
  contact: string | null
  phone: string | null
  email: string | null
  inquiry_date: string
  event_date: string | null
  event_name: string | null
  guest_count: number | null
  notes: string | null
  estimate_amount: number

  // マスタFK
  media_id: string | null
  contact_method_id: string | null
  floor_id: string | null
  event_category_id: string | null
  event_subcategory_id: string | null
  event_subcategory_note: string | null

  // タイムスケジュール
  load_in_time: string | null
  setup_time: string | null
  rehearsal_time: string | null
  start_time: string | null
  end_time: string | null
  strike_time: string | null
  full_exit_time: string | null

  // 確認手続き
  preview_datetime: string | null
  application_form_status: ApplicationFormStatus
  delivery_notice_status: DeliveryNoticeStatus
  invoice_status: InvoiceStatus
  payment_method: PaymentMethod | null

  // ステータス・キャンセル
  status: CaseStatus
  auto_cancel: boolean
  cancel_reason_id: string | null
  cancel_note: string | null

  // Google Calendar
  gcal_event_id: string | null

  // システム
  created_by: string | null
  created_at: string
  updated_at: string

  // JOIN（任意）
  media_master?: MediaMaster | null
  contact_method_master?: ContactMethodMaster | null
  floor_master?: FloorMaster | null
  event_category_master?: EventCategoryMaster | null
  event_subcategory_master?: EventSubcategoryMaster | null
  cancel_reason_master?: CancelReasonMaster | null
}

// ─── 案件関連テーブル ──────────────────────────────────────────
export interface CaseOption {
  id: string
  case_id: string
  option_id: string | null
  name: string
  category: OptionCategory
  machine_category: MachineCategory | null
  qty: number
  unit_price: number
  amount: number // generated
  unit: string
  state: OptionState
  note: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CaseChecklist {
  id: string
  case_id: string
  item: string
  state: ChecklistState
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CaseFile {
  id: string
  case_id: string
  file_type: FileType
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  label: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CaseHoldLog {
  id: string
  case_id: string
  hold_date: string | null
  release_date: string | null
  memo: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CaseHistory {
  id: string
  case_id: string
  action_type: CaseHistoryActionType
  message: string
  old_value: Json | null
  new_value: Json | null
  changed_by: string | null
  created_at: string
}

// ─── API レスポンス型 ─────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiError {
  message: string
  code?: string
}
