import { z } from 'zod'

/**
 * 案件フォームのバリデーションスキーマ
 */
export const caseFormSchema = z.object({
  // 基本情報
  company: z.string().min(1, '会社名 / 団体名は必須です').max(200),
  contact: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('メールアドレスの形式が正しくありません').optional().or(z.literal('')),
  inquiry_date: z.string().min(1, '問合せ日は必須です'),
  event_date: z.string().optional().or(z.literal('')),
  event_name: z.string().max(200).optional().or(z.literal('')),
  guest_count: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(2000).optional().or(z.literal('')),
  estimate_amount: z.number().int().min(0).default(0),

  // マスタFK
  media_id: z.string().uuid().nullable().optional(),
  contact_method_id: z.string().uuid().nullable().optional(),
  floor_id: z.string().uuid().nullable().optional(),
  event_category_id: z.string().uuid().nullable().optional(),
  event_subcategory_id: z.string().uuid().nullable().optional(),
  event_subcategory_note: z.string().max(200).optional().or(z.literal('')),

  // タイムスケジュール（HH:MM 形式）
  load_in_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  setup_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  rehearsal_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  start_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  end_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  strike_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  full_exit_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),

  // 確認手続き
  preview_datetime: z.string().optional().or(z.literal('')),
  application_form_status: z.enum(['未対応', '済み']).default('未対応'),
  delivery_notice_status: z.enum(['未対応', '済み']).default('未対応'),
  invoice_status: z.enum(['未対応', '発行依頼', '送付済み', '振り込み済み']).default('未対応'),
  payment_method: z.enum(['キャッシュレス', '現金', '現金+キャッシュレス']).nullable().optional(),

  // ステータス
  status: z.enum(['inquiry', 'preview_adj', 'previewed', 'tentative', 'confirmed', 'cancelled', 'done']).default('inquiry'),

  // Google Calendar
  gcal_event_id: z.string().max(200).nullable().optional(),

  // 自動キャンセル
  auto_cancel: z.boolean().optional(),

  // キャンセル関連（キャンセル時のみ必須）
  cancel_reason_id: z.string().uuid().nullable().optional(),
  cancel_note: z.string().max(500).optional().or(z.literal('')),
})

export type CaseFormValues = z.infer<typeof caseFormSchema>

/**
 * キャンセル処理専用スキーマ
 */
export const cancelCaseSchema = z.object({
  cancel_reason_id: z.string().uuid('キャンセル理由を選択してください'),
  cancel_note: z.string().max(500).optional().or(z.literal('')),
})

export type CancelCaseValues = z.infer<typeof cancelCaseSchema>

/**
 * 案件一覧フィルタースキーマ
 */
export const caseFilterSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  media_id: z.string().optional(),
  floor_id: z.string().optional(),
  event_category_id: z.string().optional(),
  contact_method_id: z.string().optional(),
  year: z.string().optional(),
  month: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['event_date', 'inquiry_date', 'updated_at', 'estimate_amount']).default('inquiry_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type CaseFilterValues = z.infer<typeof caseFilterSchema>
