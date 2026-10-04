/**
 * ③ 確認手続き（案件詳細画面のインライン編集）用の共通ロジック。
 * 画面コンポーネント（components/cases/CaseDetail/Procedure.tsx）から使う純粋関数のみ。
 * 保存は既存の PUT /api/cases/[id]（部分更新）をそのまま使う。
 */
import { caseFormSchema } from '../validations/case.ts'

/** プルダウンで編集する項目（保存値は表示ラベルと同じ文字列） */
export type ProcedureSelectField =
  | 'application_form_status'
  | 'delivery_notice_status'
  | 'deposit_status'
  | 'remaining_payment_status'
  | 'invoice_status'
  | 'payment_method'

/** インライン編集できる項目（日時入力の preview_datetime を含む） */
export type ProcedureField = ProcedureSelectField | 'preview_datetime'

/**
 * 下見日時（TIMESTAMPTZ）の表示用文字列。
 * 編集フォーム（CaseForm: value.slice(0, 16)）が見せる日時と常に同じになるよう、
 * タイムゾーン変換をせず文字列の日付・時刻部分をそのまま整形する。
 * 例: '2026-05-01T10:00:00+00:00' → '2026/05/01 10:00'
 */
export function formatPreviewDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value)
  if (!m) return '—'
  return `${m[1]}/${m[2]}/${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}`
}

/** DB の値 → PreviewDateTimeSelect の入力値（'YYYY-MM-DDTHH:MM'）。編集フォームと同じ変換 */
export function toPreviewInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 16) : ''
}

const PREVIEW_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

export type PatchResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string }

/**
 * 下見日時の保存値を検証する。PreviewDateTimeSelect の出力（日付のみ or 日付+時刻）を受け付け、
 * 編集フォームと同じ形式のまま返す。日付が空の場合は不可。
 */
export function validatePreviewDateTime(input: string): PatchResult {
  if (!input) return { ok: false, message: '下見日の日付を入力してください' }
  if (!PREVIEW_INPUT_PATTERN.test(input)) return { ok: false, message: '下見日時の形式が正しくありません' }
  return { ok: true, value: input }
}

/**
 * プルダウン項目の保存値を、既存の案件フォームと同じ Zod スキーマで検証する。
 * 支払い方法の空選択は null（未設定）として保存する。
 */
export function validateProcedureSelect(field: ProcedureSelectField, input: string): PatchResult {
  if (field === 'payment_method' && input === '') return { ok: true, value: null }
  const parsed = caseFormSchema.shape[field].safeParse(input)
  if (!parsed.success) return { ok: false, message: '選択した値が正しくありません' }
  return { ok: true, value: input }
}
