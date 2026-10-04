/**
 * 案件の「イベント大分類（event_category_id）」と「イベント中分類（event_subcategory_id）」の親子整合性。
 *
 * 中分類は必ず1つの大分類に属する（event_subcategory_master.category_id）。
 * 案件に保存する中分類は、案件の大分類の配下でなければならない。
 * DB にはこの整合性を保証する制約がないため、フォーム（大分類変更時のクリア）と
 * API（保存時の検証）で守る。
 *
 * Supabase / Next.js に依存しないため、node:test で単体テストできる。
 */

export const EVENT_SUBCATEGORY_MISMATCH_MESSAGE =
  '選択された中分類は、選択された大分類に属していません。大分類または中分類を選び直してください。'
export const EVENT_SUBCATEGORY_NOT_FOUND_MESSAGE =
  '選択された中分類が見つかりません。中分類を選び直してください。'
export const EVENT_SUBCATEGORY_LOOKUP_FAILED_MESSAGE =
  '中分類の確認に失敗しました。時間をおいて、もう一度お試しください。'

/** '' / 空白 / null / undefined / 文字列以外 → null。それ以外は前後の空白を除いた文字列 */
export function normalizeEventId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 大分類をユーザーが変更したときに、中分類をクリアすべきか。
 * 中分類は1つの大分類にしか属さないため、大分類が別のものに変わり、かつ中分類が選択されていれば、
 * その中分類は新しい大分類の配下ではない（クリアする）。
 * 大分類が変わっていない場合（同じ値の再選択など）はクリアしない。
 * ※ 編集画面を開いただけの初期表示では呼ばない（ユーザーの変更操作の中でだけ使う）。
 */
export function shouldClearSubcategoryOnCategoryChange(
  previousCategoryId: unknown,
  nextCategoryId: unknown,
  currentSubcategoryId: unknown
): boolean {
  if (normalizeEventId(currentSubcategoryId) === null) return false
  return normalizeEventId(previousCategoryId) !== normalizeEventId(nextCategoryId)
}

export type EventSubcategoryCheck =
  | { ok: true }
  | { ok: false; reason: 'mismatch' | 'not_found' | 'lookup_failed'; status: 400 | 500; message: string }

const OK: EventSubcategoryCheck = { ok: true }

/**
 * 中分類の親（category_id）と、保存しようとしている大分類が一致するか。
 * subcategoryParentId: 中分類マスタから取得した category_id（見つからなければ null / undefined）
 */
export function checkSubcategoryParent(
  categoryId: unknown,
  subcategoryId: unknown,
  subcategoryParentId: string | null | undefined
): EventSubcategoryCheck {
  if (normalizeEventId(subcategoryId) === null) return OK // 中分類なしは常に可
  if (subcategoryParentId == null) {
    return { ok: false, reason: 'not_found', status: 400, message: EVENT_SUBCATEGORY_NOT_FOUND_MESSAGE }
  }
  if (normalizeEventId(categoryId) !== subcategoryParentId) {
    return { ok: false, reason: 'mismatch', status: 400, message: EVENT_SUBCATEGORY_MISMATCH_MESSAGE }
  }
  return OK
}

/**
 * Supabase クライアントの最小限の形（テストで差し替えられるようにゆるく型付けする）。
 * 使うのは SELECT のみ。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventLookupClient = { from: (table: string) => any }

/** 中分類マスタを SELECT して、大分類との親子整合性を検証する（書き込みはしない） */
export async function validateEventSubcategory(
  client: EventLookupClient,
  categoryId: unknown,
  subcategoryId: unknown
): Promise<EventSubcategoryCheck> {
  const sub = normalizeEventId(subcategoryId)
  if (sub === null) return OK // 中分類なしは問い合わせ不要

  const { data, error } = await client
    .from('event_subcategory_master')
    .select('category_id')
    .eq('id', sub)
    .maybeSingle()
  if (error) {
    return { ok: false, reason: 'lookup_failed', status: 500, message: EVENT_SUBCATEGORY_LOOKUP_FAILED_MESSAGE }
  }
  return checkSubcategoryParent(categoryId, sub, (data as { category_id?: string | null } | null)?.category_id ?? null)
}

/**
 * 保存リクエスト（POST / PUT）の本文について、保存後の（大分類, 中分類）の組を検証する。
 * ・本文に大分類・中分類のどちらも含まれない更新（ステータス変更などの部分更新）は何も確認しない
 * ・片方だけが含まれる部分更新は、もう片方を既存の案件（caseId）から補って「保存後の組」で検証する
 * ・中分類が NULL なら常に可
 * 不整合なら { status: 400, message } を返す。問題なければ null。
 */
export async function validateEventPairForSave(
  client: EventLookupClient,
  body: Record<string, unknown>,
  options: { caseId?: string } = {}
): Promise<{ status: number; message: string } | null> {
  const hasCategory = 'event_category_id' in body
  const hasSubcategory = 'event_subcategory_id' in body
  if (!hasCategory && !hasSubcategory) return null

  let categoryId = hasCategory ? body.event_category_id : null
  let subcategoryId = hasSubcategory ? body.event_subcategory_id : null

  if (options.caseId && hasCategory !== hasSubcategory) {
    const { data, error } = await client
      .from('cases')
      .select('event_category_id,event_subcategory_id')
      .eq('id', options.caseId)
      .maybeSingle()
    if (error || !data) {
      return { status: 500, message: EVENT_SUBCATEGORY_LOOKUP_FAILED_MESSAGE }
    }
    if (!hasCategory) categoryId = data.event_category_id
    if (!hasSubcategory) subcategoryId = data.event_subcategory_id
  }

  const result = await validateEventSubcategory(client, categoryId, subcategoryId)
  return result.ok ? null : { status: result.status, message: result.message }
}
