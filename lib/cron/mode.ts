/**
 * 自動処理（自動キャンセル・自動完了）の動作モードと、実行可否の判定。
 *
 *   off  : 何もしない（DBにも接続しない）
 *   dry  : 対象を SELECT して件数だけ返す（書込みゼロ）
 *   live : 条件・件数上限・理由マスタ等をすべて満たす場合のみ書込み可能
 *
 * 環境変数 CRON_MODE で切り替える。未設定・不正な値は必ず dry（書込みなし）にする。
 * live は、明示的に "live" と設定した場合にだけ有効になる。
 *
 * Supabase / Next.js に依存しないため、node:test で単体テストできる。
 */

export type CronMode = 'off' | 'dry' | 'live'
export const DEFAULT_CRON_MODE: CronMode = 'dry'

export function resolveCronMode(raw: string | undefined | null): CronMode {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'off' || value === 'dry' || value === 'live') return value
  return DEFAULT_CRON_MODE
}

/** 呼び出し元: cron = Vercel Cron の GET（service role） / admin = 管理者の POST（ログインセッション） */
export type CronTrigger = 'cron' | 'admin'
export type CronDecision = 'disabled' | 'dry' | 'live' | 'blocked'

/**
 * 実行方法を決める。
 *   off                       → disabled（何もしない）
 *   dryRun が指定されている    → dry（モードに関わらず書込みなし）
 *   dry モード                 → cron は dry を実行 / admin の本実行は blocked（モードが live ではない）
 *   live モード                → live
 */
export function decideExecution(args: {
  trigger: CronTrigger
  mode: CronMode
  dryRunRequested: boolean
}): CronDecision {
  const { trigger, mode, dryRunRequested } = args
  if (mode === 'off') return 'disabled'
  if (dryRunRequested) return 'dry'
  if (mode === 'dry') return trigger === 'cron' ? 'dry' : 'blocked'
  return 'live'
}

/** GET の ?dryRun=1 / ?dryRun=true */
export function parseDryRunParam(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true'
}

/** POST の本文 { dryRun: true }。本文が空・不正でも例外にしない */
export function parseDryRunBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { dryRun?: unknown }).dryRun === true
}
