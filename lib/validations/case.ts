import { z } from 'zod'

/**
 * 空文字を null に変える
 */
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === '' ? null : val), schema)

/**
 * 空文字を undefined に変える
 */
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (val === '' ? undefined : val), schema)

/**
 * 数字入力用
 * '' → undefined
 * 数字文字列 → number
 */
const optionalNumber = z.preprocess((val) => {
  if (val === '' || val === null || val === undefined) return undefined

  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '')
    const num = Number(cleaned)
    return Number.isNaN(num) ? undefined : num
  }

  return val
}, z.number().int().min(0).optional())

/**
 * UUID項目用
 * '' → null
 */
const optionalUuid = emptyToNull(z.string().uuid().nullable().optional())

/**
 * 時間項目用
 * '' → null
 * "HH:MM:SS" → "HH:MM"
 * HH:MM 以外は弾く
 * ただし空はOK
 */
const optionalTime = z.preprocess(
  (val) => {
    if (val === '' || val === undefined || val === null) return null

    if (typeof val === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(val)) {
      return val.slice(0, 5)
    }

    return val
  },
  z.union([
    z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    z.null(),
  ]).optional()
)

/**
 * 案件フォームのバリデーションスキーマ
 * 未入力でも登録できる方針
 */
export const caseFormSchema = z.object({
  // 基本情報
  company: z.string().min(1, '会社名は必須です').max(200),
  contact: emptyToUndefined(z.string().max(100).optional()),
  phone: emptyToUndefined(z.string().max(20).optional()),
  email: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined
      return val
    },
    z.string().email('メールアドレスの形式が正しくありません').optional()
  ),

  inquiry_date: z.string().min(1, '問合せ日は必須です'),
  event_date: emptyToUndefined(z.string().optional()),
  event_name: emptyToUndefined(z.string().max(200).optional()),
  guest_count: optionalNumber,
  notes: emptyToUndefined(z.string().max(2000).optional()),
  estimate_amount: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return 0

    if (typeof val === 'string') {
      const cleaned = val.replace(/,/g, '')
      const num = Number(cleaned)
      return Number.isNaN(num) ? 0 : num
    }

    return val
  }, z.number().int().min(0)).default(0),

  // マスタFK
  media_id: optionalUuid,
  contact_method_id: optionalUuid,
  floor_id: optionalUuid,
  event_category_id: optionalUuid,
  event_subcategory_id: optionalUuid,
  event_subcategory_note: emptyToUndefined(z.string().max(200).optional()),

  // タイムスケジュール
  load_in_time: optionalTime,
  setup_time: optionalTime,
  rehearsal_time: optionalTime,
  start_time: optionalTime,
  end_time: optionalTime,
  strike_time: optionalTime,
  full_exit_time: optionalTime,

  // 確認手続き
  preview_datetime: emptyToUndefined(z.string().optional()),
  application_form_status: z.enum(['未対応', '済み']).optional().default('未対応'),
  delivery_notice_status: z.enum(['未対応', '済み']).optional().default('未対応'),
  invoice_status: z
    .enum(['未対応', '発行依頼', '送付済み', '振り込み済み'])
    .optional()
    .default('未対応'),
  payment_method: emptyToNull(
    z.enum(['キャッシュレス', '現金', '現金+キャッシュレス']).nullable().optional()
  ),

  // ステータス
  status: z
    .enum(['inquiry', 'preview_adj', 'previewed', 'tentative', 'confirmed', 'cancelled', 'done'])
    .optional()
    .default('inquiry'),

  // Google Calendar
  gcal_event_id: emptyToNull(z.string().max(200).nullable().optional()),

  // 自動キャンセル
  auto_cancel: z.boolean().optional(),

  // キャンセル関連
  cancel_reason_id: optionalUuid,
  cancel_note: emptyToUndefined(z.string().max(500).optional()),
})

export type CaseFormValues = z.infer<typeof caseFormSchema>

/**
 * キャンセル処理専用スキーマ
 * これはキャンセル時だけ使うので厳しめ
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
  sortBy: z
    .enum(['event_date', 'inquiry_date', 'updated_at', 'estimate_amount'])
    .default('inquiry_date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type CaseFilterValues = z.infer<typeof caseFilterSchema>