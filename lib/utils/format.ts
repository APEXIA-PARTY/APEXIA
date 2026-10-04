import { format, parseISO, isValid } from 'date-fns'
import { ja } from 'date-fns/locale'

/**
 * 日付を yyyy/MM/dd 形式にフォーマット
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return '—'
    return format(date, 'yyyy/MM/dd', { locale: ja })
  } catch {
    return '—'
  }
}

/**
 * 日時を yyyy/MM/dd HH:mm 形式にフォーマット
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return '—'
    return format(date, 'yyyy/MM/dd HH:mm', { locale: ja })
  } catch {
    return '—'
  }
}

/**
 * 日付を M月d日（曜日）形式にフォーマット
 */
export function formatDateJa(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return '—'
    return format(date, 'M月d日（E）', { locale: ja })
  } catch {
    return '—'
  }
}

/**
 * 金額を日本円表記にフォーマット
 * 例: 150000 → ¥150,000
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
  }).format(amount)
}

/**
 * 金額を万円表記にフォーマット（1万円以上の場合）
 * 例: 150000 → 15万円
 */
export function formatCurrencyShort(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  if (amount >= 10000) {
    const man = amount / 10000
    const manStr = man.toFixed(1)
    return `${manStr.endsWith('.0') ? manStr.slice(0, -2) : manStr}万円`
  }
  return `${amount.toLocaleString('ja-JP')}円`
}

/**
 * 金額を「¥ + 円単位 + 3桁カンマ」にフォーマット
 * 例: 93679000 → ¥93,679,000 / 8000 → ¥8,000
 */
export function formatYenFull(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  return `¥${amount.toLocaleString('ja-JP')}`
}

/**
 * 金額を万表記（¥なし・3桁カンマ・小数第1位まで、整数になる場合は .0 を省略）にフォーマット
 * 1万円未満は formatYenFull にフォールバック
 * 例: 93679000 → 9,367.9万 / 137870000 → 13,787万 / 8000 → ¥8,000
 */
export function formatManShort(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—'
  if (amount < 10000) return formatYenFull(amount)
  const man = Number((amount / 10000).toFixed(1))
  return `${man.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万`
}

/**
 * 数値をパーセント表示にフォーマット
 * 例: 0.456 → 45.6%
 */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(decimals)}%`
}

/**
 * 時刻文字列（HH:MM:SS）を HH:MM にフォーマット
 */
export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '—'
  return timeStr.slice(0, 5)
}

/**
 * null / undefined / 空文字 を '—' に変換
 */
export function emptyToDash(value: string | null | undefined): string {
  if (!value || value.trim() === '') return '—'
  return value
}

/**
 * 数値を丸めて表示（集計用）
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0'
  return value.toLocaleString('ja-JP')
}
