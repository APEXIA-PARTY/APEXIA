/**
 * 機材・オペレーター（case_options）の数量まわりの共通ロジック。
 * - 機材・オペレーター（category = 'machine'）のみ、小数第1位までの小数数量（0.1, 1.2, 10.9 など）を許可する
 * - 備品・設備（category = 'equipment'）は従来どおり整数のみ
 */

export type OptionCategory = 'equipment' | 'machine'

/** 税込小計の係数（Options.tsx の表示用。税抜単価 × 数量 × 1.1） */
export const OPTION_TAX_RATE = 1.1

/** 数量入力の step 属性値（機材・オペレーターは 0.1 刻み、備品・設備は整数） */
export function qtyStep(category: OptionCategory): number {
  return category === 'machine' ? 0.1 : 1
}

/** 数量入力の min 属性値 */
export function qtyMin(category: OptionCategory): number {
  return category === 'machine' ? 0.1 : 1
}

/** 小数第1位までか（浮動小数の誤差を許容: 10.9 * 10 = 109.00000000000001 など） */
export function hasAtMostOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
}

export type ParsedQty =
  | { ok: true; value: number }
  | { ok: false; message: string }

/**
 * 数量入力欄の文字列を数値に変換する。
 * - 空・数値でない・0以下は不可
 * - 備品・設備は整数のみ
 * - 機材・オペレーターは小数第1位まで
 */
export function parseQtyInput(raw: string, category: OptionCategory): ParsedQty {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, message: '数量を入力してください' }

  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, message: '数量は0より大きい数値で入力してください' }
  }

  if (category === 'equipment') {
    if (!Number.isInteger(value)) return { ok: false, message: '備品・設備の数量は整数で入力してください' }
  } else if (!hasAtMostOneDecimal(value)) {
    return { ok: false, message: '数量は小数第1位までで入力してください' }
  }

  return { ok: true, value }
}

/** 数量の表示用文字列（1.5 → "1.5"、2 → "2"。不要な小数点は出さない） */
export function formatQty(qty: number | null | undefined): string {
  if (qty === null || qty === undefined) return '—'
  return String(Number(qty))
}

/** 小計（税抜）。DB の amount（ROUND(qty * unit_price)）と同じ丸め */
export function calcOptionAmount(qty: number | null | undefined, unitPrice: number | null | undefined): number {
  return Math.round((qty ?? 1) * (unitPrice ?? 0))
}

/** 小計（税込・表示用）。整数数量では従来の計算結果と完全に一致する */
export function calcOptionSubtotalInclTax(
  qty: number | null | undefined,
  unitPrice: number | null | undefined
): number {
  return Math.round((qty ?? 1) * (unitPrice ?? 0) * OPTION_TAX_RATE)
}
