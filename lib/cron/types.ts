/**
 * 自動処理（自動キャンセル・自動完了）の実行部分で共有する型と定数。
 */

/** Supabase クライアントの最小限の形（テストで差し替えられるようにゆるく型付けする）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CronDbClient = { from: (table: string) => any }

/** ルート側で HTTP レスポンスに変換する、実行結果。個人情報は含めない。 */
export interface CronRunResult {
  status: number
  body: Record<string, unknown>
}

/** 候補の SELECT で取得する行数の上限（PostgREST の既定上限と同じ。到達したら「取りこぼしあり」として中止側に倒す） */
export const CRON_FETCH_LIMIT = 1000

/** 自動完了の1回の書込み上限。対象がこの件数を超えたら、1件も書き込まず中止する */
export const AUTO_COMPLETE_MAX_WRITE_COUNT = 30
