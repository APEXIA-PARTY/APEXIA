import { CaseStatus } from '@/types/database'

/**
 * ステータスの表示設定
 * ハードコーディングを避けるため、ここで一元管理する
 */
export const STATUS_CONFIG: Record<
  CaseStatus,
  { label: string; color: string; bgColor: string; description: string }
> = {
  inquiry: {
    label: '新規問合せ',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 border-blue-200',
    description: '問合せを受け付けた初期状態',
  },
  preview_adj: {
    label: '下見調整中',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50 border-yellow-200',
    description: '下見日程を調整中',
  },
  previewed: {
    label: '下見済み',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50 border-purple-200',
    description: '下見が完了した状態',
  },
  tentative: {
    label: '仮押さえ',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50 border-orange-200',
    description: '仮予約として押さえた状態',
  },
  confirmed: {
    label: '確定',
    color: 'text-green-700',
    bgColor: 'bg-green-50 border-green-200',
    description: '正式に確定した案件',
  },
  cancelled: {
    label: 'キャンセル',
    color: 'text-red-700',
    bgColor: 'bg-red-50 border-red-200',
    description: 'キャンセルされた案件（手動・自動共通）',
  },
  done: {
    label: '開催終了',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 border-gray-200',
    description: 'イベントが終了した状態',
  },
}

/**
 * ステータスの一覧（表示順）
 */
export const STATUS_LIST = Object.entries(STATUS_CONFIG).map(([key, value]) => ({
  value: key as CaseStatus,
  ...value,
}))

/**
 * 確定売上の対象ステータス
 */
export const REVENUE_STATUSES: CaseStatus[] = ['confirmed', 'done']

/**
 * 下見以上と見なすステータス（下見件数集計用）
 */
export const PREVIEWED_STATUSES: CaseStatus[] = [
  'previewed',
  'tentative',
  'confirmed',
  'done',
]

/**
 * 自動キャンセル対象ステータス
 * event_date < today のときにキャンセルする
 */
export const AUTO_CANCEL_TARGET_STATUSES: CaseStatus[] = [
  'inquiry',
  'preview_adj',
  'previewed',
  'tentative',
]

/**
 * 確認手続きの選択肢
 */
export const FORM_STATUS_OPTIONS = ['未対応', '済み'] as const
export const DELIVERY_STATUS_OPTIONS = ['未対応', '済み'] as const
export const INVOICE_STATUS_OPTIONS = ['未対応', '発行依頼', '送付済み', '振り込み済み'] as const
export const PAYMENT_METHOD_OPTIONS = ['キャッシュレス', '現金', '現金+キャッシュレス'] as const

/**
 * ファイル種別
 */
export const FILE_TYPE_OPTIONS = ['見積書', '請求書', '進行表', 'レイアウト図', 'その他'] as const

/**
 * 確認事項の状態
 */
export const CHECKLIST_STATE_OPTIONS = ['確認中', '確定'] as const

/**
 * オプション（備品・機材）の状態
 */
export const OPTION_STATE_OPTIONS = ['未確認', '質問中', '検討中', '確定', '不要'] as const

/**
 * 機材カテゴリ
 */
export const MACHINE_CATEGORIES = ['音響', '照明', '映像'] as const
