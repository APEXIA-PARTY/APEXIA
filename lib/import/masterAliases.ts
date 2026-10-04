/**
 * Excel 取込み時のマスタ名称解決（旧名称 → 正規名称の別名対応）。
 *
 * マスタ名称を統合した後（旧マスタは is_active=false）も、過去の Excel に旧名称が入っていれば
 * 正規名称のマスタへ解決できるようにする。
 *
 * 解決の順序（既存の挙動を壊さないため）:
 *   1. 取込み値と同じ名称のマスタ（有効なもの）を探す（大文字小文字無視・前後空白除去。従来どおり）
 *   2. 見つからなければ、別名表で正規名称に読み替えて、もう一度探す
 *
 * 別名表のキーは「前後空白除去 + 小文字化」済みの旧名称。
 */

export interface MasterRow {
  id: string
  name: string
}

/** 認知経路: 旧名称 → 正規名称 */
export const MEDIA_ALIASES: Readonly<Record<string, string>> = {
  'webで要件入力': 'WEB要件検索',
  'web要件検索': 'WEB要件検索',
  'insragram営業': 'instagram DM営業',
  'instagramのdm': 'instagram DM営業',
}

/** キャンセル理由: 旧名称 → 正規名称 */
export const CANCEL_REASON_ALIASES: Readonly<Record<string, string>> = {
  '他会場に決定': '他会場で開催',
  '他店舗で開催': '他会場で開催',
  '空いてなかった': '空き枠なし',
}

/**
 * イベント大分類: 旧名称 → 正規名称
 * 旧大分類「企業飲食」は、大分類「企業イベント」の中分類「企業飲食」へ移した。
 * 大分類の解決はここ（classify）、中分類の設定は EVENT_CATEGORY_SUBCATEGORY_ALIASES（apply）で行う。
 */
export const EVENT_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  '企業飲食': '企業イベント',
}

/**
 * 旧大分類を取込んだときに、あわせて設定する中分類（大分類は EVENT_CATEGORY_ALIASES で解決済みのもの）。
 * 例: Excel の「企業飲食」 → 大分類「企業イベント」＋ 中分類「企業飲食」
 * キーは「前後空白除去 + 小文字化」済みの旧名称。
 */
export const EVENT_CATEGORY_SUBCATEGORY_ALIASES: Readonly<Record<string, { category: string; subcategory: string }>> = {
  '企業飲食': { category: '企業イベント', subcategory: '企業飲食' },
}

const normalize = (s: string): string => s.trim().toLowerCase()

/**
 * マスタ名から ID を解決する。
 * 空・未解決は null（従来どおり。呼び出し側で未解決として扱う）。
 */
export function resolveMasterId(
  raw: string | null | undefined,
  masters: readonly MasterRow[],
  aliases: Readonly<Record<string, string>> = {}
): string | null {
  if (!raw || !raw.trim()) return null
  const key = normalize(raw)

  const direct = masters.find((m) => normalize(m.name) === key)
  if (direct) return direct.id

  const canonical = aliases[key]
  if (!canonical) return null

  const canonicalKey = normalize(canonical)
  return masters.find((m) => normalize(m.name) === canonicalKey)?.id ?? null
}

export interface SubcategoryRow {
  id: string
  name: string
  category_id: string
}

/**
 * 取込み値（旧大分類）に対応する中分類 ID を決める。設定できない場合は null（従来どおり中分類なし）。
 *
 * 次をすべて満たすときだけ中分類を返す:
 *   1. 取込み値が EVENT_CATEGORY_SUBCATEGORY_ALIASES の旧名称である
 *   2. 解決済みの大分類 ID（resolvedCategoryId）が、別名表の大分類（正規名称）の有効なマスタと一致する
 *      → 旧マスタがまだ有効で、旧大分類そのものに解決された環境（統合前）では何も設定しない
 *   3. その大分類の配下に、別名表の中分類名が有効な行としてちょうど 1 つある
 *      → 中分類が未作成・重複している場合は設定しない（誤った行を選ばない）
 */
export function resolveEventSubcategoryId(
  rawCategory: string | null | undefined,
  resolvedCategoryId: string | null | undefined,
  categories: readonly MasterRow[],
  subcategories: readonly SubcategoryRow[]
): string | null {
  if (!rawCategory || !rawCategory.trim() || !resolvedCategoryId) return null
  const rule = EVENT_CATEGORY_SUBCATEGORY_ALIASES[normalize(rawCategory)]
  if (!rule) return null

  const categoryKey = normalize(rule.category)
  const category = categories.filter((c) => normalize(c.name) === categoryKey)
  if (category.length !== 1 || category[0].id !== resolvedCategoryId) return null

  const subKey = normalize(rule.subcategory)
  const subs = subcategories.filter((s) => s.category_id === category[0].id && normalize(s.name) === subKey)
  return subs.length === 1 ? subs[0].id : null
}
