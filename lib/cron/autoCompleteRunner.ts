/**
 * 自動完了（confirmed → done）の実行部分（HTTP / 認証に依存しない）。
 *
 * 対象: status = 'confirmed' かつ event_date が「日本時間の今日」より前（開催日の翌日の0時以降）。
 *
 * ・dry : 候補を SELECT して集計を返すだけ。UPDATE / INSERT は一切しない
 * ・live: 対象が AUTO_COMPLETE_MAX_WRITE_COUNT 件以下の場合のみ書込む（超えたら1件も書かず中止）。
 *   UPDATE 文にも「id ＋ 旧 status = confirmed ＋ event_date 条件」を付ける（service role は RLS を迂回するため）。
 *   SELECT の後で別 status に変えられた案件は上書きしない。
 *   case_history への履歴（status_change）は DB トリガーが UPDATE と同一トランザクションで記録する。
 *   ランナーは case_history に一切書かない（二重履歴の防止）。
 *   confirmed_at と cancelled_at には触れない（confirmed → done で確定日時を書き換えない。トリガーも cancelled への遷移でしか打刻しない）。
 */
import { getJstTodayDateString } from '../utils/autoComplete.ts'
import type { CronMode } from './mode.ts'
import { summarizeEventDates } from './autoCancelRules.ts'
import { AUTO_COMPLETE_MAX_WRITE_COUNT, CRON_FETCH_LIMIT, type CronDbClient, type CronRunResult } from './types.ts'

const failure = (stage: string, error: unknown): CronRunResult => {
  console.error(`[auto-complete] ${stage} 失敗:`, error)
  return { status: 500, body: { message: '自動開催終了の処理に失敗しました', stage } }
}

export async function runAutoComplete(opts: {
  client: CronDbClient
  decision: 'dry' | 'live'
  mode: CronMode
  now?: Date
}): Promise<CronRunResult> {
  const { client, mode } = opts
  // 多重防御: mode が live でなければ、呼び出し側が live を指定しても書込みは一切しない（dry として扱う）
  const decision: 'dry' | 'live' = opts.decision === 'live' && mode === 'live' ? 'live' : 'dry'
  const now = opts.now ?? new Date()
  const todayJst = getJstTodayDateString(now)

  // 個人情報（会社名など）は取得しない
  const { data, error } = await client
    .from('cases')
    .select('id,event_date')
    .eq('status', 'confirmed')
    .not('event_date', 'is', null)
    .lt('event_date', todayJst)
    .limit(CRON_FETCH_LIMIT)
  if (error) return failure('候補取得', error)

  const rows = (data ?? []) as { id: string; event_date: string }[]
  const truncated = rows.length >= CRON_FETCH_LIMIT
  const total = rows.length
  const exceedsWriteLimit = truncated || total > AUTO_COMPLETE_MAX_WRITE_COUNT

  const liveBlockers: string[] = []
  if (mode !== 'live') liveBlockers.push('mode_not_live')
  if (exceedsWriteLimit) liveBlockers.push('write_limit_exceeded')

  const dates = summarizeEventDates(rows.map((r) => r.event_date))
  const base = {
    mode,
    dryRun: decision !== 'live',
    todayJst,
    writeLimit: AUTO_COMPLETE_MAX_WRITE_COUNT,
    exceedsWriteLimit,
    truncated,
    liveEnabled: mode === 'live',
    liveBlockers,
    totalCandidates: total,
    byEventMonth: dates.byEventMonth,
    oldestEventDate: dates.oldestEventDate,
    newestEventDate: dates.newestEventDate,
  }

  if (decision === 'dry') {
    return { status: 200, body: { ...base, message: 'dry-run: 何も変更していません' } }
  }

  // ── live ───────────────────────────────────────────────────
  if (exceedsWriteLimit) {
    return {
      status: 409,
      body: { ...base, dryRun: false, aborted: true, abortReason: 'write_limit_exceeded', processed: 0, message: `対象が上限（${AUTO_COMPLETE_MAX_WRITE_COUNT}件）を超えるため、1件も処理せず中止しました` },
    }
  }
  if (total === 0) {
    return { status: 200, body: { ...base, dryRun: false, processed: 0, message: '対象案件はありません' } }
  }

  const { data: updatedRows, error: updateError } = await client
    .from('cases')
    .update({ status: 'done' })
    .eq('status', 'confirmed')
    .in('id', rows.map((r) => r.id))
    .not('event_date', 'is', null)
    .lt('event_date', todayJst)
    .select('id,event_date')
  if (updateError) {
    return { status: 500, body: { ...base, dryRun: false, message: '自動開催終了の更新に失敗しました', stage: '更新' } }
  }

  const updated = (updatedRows ?? []) as { id: string; event_date: string }[]
  // 履歴（case_history）は DB トリガーが UPDATE と同一トランザクションで記録する。ここでは何も書かない

  console.log(`[auto-complete] ${updated.length}件を自動的に開催終了へ変更しました`)
  return {
    status: 200,
    body: { ...base, dryRun: false, processed: updated.length, message: `${updated.length}件を開催終了へ変更しました` },
  }
}
