/**
 * 自動キャンセルの実行部分（HTTP / 認証に依存しない）。
 *
 * ・dry : 候補を SELECT して集計を返すだけ。UPDATE / INSERT は一切しない
 * ・live: 次をすべて満たす場合のみ書込む
 *     1. 対象が AUTO_CANCEL_MAX_WRITE_COUNT 件以下（超えたら1件も書かず中止）
 *     2. 専用の自動キャンセル理由（AUTO_CANCEL_REASON_NAME・自動専用・有効）がちょうど1件ある
 *        （無い・複数なら中止。「連絡不通」などの代用はしない。理由なしでキャンセルもしない）
 *   書込みは status ごとに、「id ＋ 期待する旧 status ＋ event_date の条件」を UPDATE 文にも付けて行う。
 *   SELECT の後でスタッフが status を変えた案件は条件に一致せず、上書きされない。
 *   履歴（case_history）は、実際に更新された案件についてだけ書く。2回目の実行は対象が0件になる（冪等）。
 *
 * DB クライアントは呼び出し側が渡す。cron の GET は service role（RLS 迂回のため UPDATE 条件を必ず付ける）、
 * 管理者の POST はログイン済みセッションのクライアント。
 */
import { getJstTodayDateString } from '../utils/autoComplete.ts'
import type { CronMode } from './mode.ts'
import {
  AUTO_CANCEL_LOOKBACK_DAYS,
  AUTO_CANCEL_MAX_WRITE_COUNT,
  AUTO_CANCEL_NOTE,
  AUTO_CANCEL_REASON_NAME,
  AUTO_CANCEL_STATUSES,
  AUTO_CANCEL_GRACE_DAYS,
  MANUAL_REVIEW_STATUS,
  getAutoCancelWindow,
  summarizeAutoCancelCandidates,
  type AutoCancelCandidateRow,
  type AutoCancelStatus,
} from './autoCancelRules.ts'
import { CRON_FETCH_LIMIT, type CronDbClient, type CronRunResult } from './types.ts'

/** 候補の取得列。個人情報（会社名・担当者・連絡先・備考）は取得しない */
const CANDIDATE_COLUMNS = 'id,status,event_date,preview_datetime,estimate_amount'

const failure = (stage: string, error: unknown): CronRunResult => {
  // エラー内容はサーバーログにのみ出す。レスポンスには詳細を含めない
  console.error(`[auto-cancel] ${stage} 失敗:`, error)
  return { status: 500, body: { message: '自動キャンセルの処理に失敗しました', stage } }
}

export async function runAutoCancel(opts: {
  client: CronDbClient
  decision: 'dry' | 'live'
  mode: CronMode
  now?: Date
  /** 履歴の実行者。cron は null（システム） */
  actorUserId?: string | null
}): Promise<CronRunResult> {
  const { client, mode } = opts
  // 多重防御: mode が live でなければ、呼び出し側が live を指定しても書込みは一切しない（dry として扱う）
  const decision: 'dry' | 'live' = opts.decision === 'live' && mode === 'live' ? 'live' : 'dry'
  const now = opts.now ?? new Date()
  const todayJst = getJstTodayDateString(now)
  const window = getAutoCancelWindow(todayJst)

  // ── 候補の取得（SELECT のみ）────────────────────────────────
  const candidates: AutoCancelCandidateRow[] = []
  let truncated = false
  for (const status of AUTO_CANCEL_STATUSES) {
    const { data, error } = await client
      .from('cases')
      .select(CANDIDATE_COLUMNS)
      .eq('status', status)
      .not('event_date', 'is', null)
      .lt('event_date', window.cutoffs[status])
      .gte('event_date', window.lookbackStart)
      .limit(CRON_FETCH_LIMIT)
    if (error) return failure('候補取得', error)
    const rows = (data ?? []) as AutoCancelCandidateRow[]
    if (rows.length >= CRON_FETCH_LIMIT) truncated = true
    candidates.push(...rows)
  }

  // 要確認（tentative: 自動キャンセルしない。開催日が過ぎているものの件数だけ）
  const tentative = await client
    .from('cases')
    .select('id,event_date')
    .eq('status', MANUAL_REVIEW_STATUS)
    .not('event_date', 'is', null)
    .lt('event_date', todayJst)
    .limit(CRON_FETCH_LIMIT)
  if (tentative.error) return failure('要確認(tentative)取得', tentative.error)
  const tentativeEventDates = ((tentative.data ?? []) as { event_date: string }[]).map((r) => r.event_date)

  // 遡り上限より古い滞留案件（自動処理の対象外）の件数
  const outside = await client
    .from('cases')
    .select('id,status,event_date')
    .in('status', AUTO_CANCEL_STATUSES)
    .not('event_date', 'is', null)
    .lt('event_date', window.lookbackStart)
    .limit(CRON_FETCH_LIMIT)
  if (outside.error) return failure('遡り上限外の件数取得', outside.error)
  const outsideLookbackCount = (outside.data ?? []).length

  // 自動キャンセル専用理由の有無（SELECT のみ。dry-run でも「本処理が可能か」を知らせるために確認する）
  const reasonQuery = await client
    .from('cancel_reason_master')
    .select('id,name')
    .eq('name', AUTO_CANCEL_REASON_NAME)
    .eq('is_auto_cancel', true)
    .eq('is_active', true)
  if (reasonQuery.error) return failure('キャンセル理由の確認', reasonQuery.error)
  const reasonRows = (reasonQuery.data ?? []) as { id: string }[]

  const total = candidates.length
  const exceedsWriteLimit = truncated || total > AUTO_CANCEL_MAX_WRITE_COUNT

  const liveBlockers: string[] = []
  if (mode !== 'live') liveBlockers.push('mode_not_live')
  if (exceedsWriteLimit) liveBlockers.push('write_limit_exceeded')
  if (reasonRows.length !== 1) liveBlockers.push('auto_cancel_reason_unavailable')

  const summary = summarizeAutoCancelCandidates({ candidates, tentativeEventDates, outsideLookbackCount, todayJst, now })
  const base = {
    mode,
    dryRun: decision !== 'live',
    todayJst,
    rules: {
      graceDays: AUTO_CANCEL_GRACE_DAYS,
      lookbackDays: AUTO_CANCEL_LOOKBACK_DAYS,
      lookbackStart: window.lookbackStart,
    },
    writeLimit: AUTO_CANCEL_MAX_WRITE_COUNT,
    exceedsWriteLimit,
    truncated,
    liveEnabled: mode === 'live',
    liveBlockers,
    ...summary,
  }

  if (decision === 'dry') {
    return { status: 200, body: { ...base, message: 'dry-run: 何も変更していません' } }
  }

  // ── live ───────────────────────────────────────────────────
  if (exceedsWriteLimit) {
    return {
      status: 409,
      body: { ...base, dryRun: false, aborted: true, abortReason: 'write_limit_exceeded', processed: 0, message: `対象が上限（${AUTO_CANCEL_MAX_WRITE_COUNT}件）を超えるため、1件も処理せず中止しました` },
    }
  }
  if (reasonRows.length !== 1) {
    return {
      status: 409,
      body: { ...base, dryRun: false, aborted: true, abortReason: 'auto_cancel_reason_unavailable', processed: 0, message: '自動キャンセル専用の理由が1件に特定できないため、1件も処理せず中止しました' },
    }
  }
  if (total === 0) {
    return { status: 200, body: { ...base, dryRun: false, processed: 0, message: '対象案件はありません' } }
  }

  const reasonId = reasonRows[0].id
  const idsByStatus: Record<AutoCancelStatus, string[]> = { inquiry: [], preview_adj: [], previewed: [] }
  for (const c of candidates) idsByStatus[c.status as AutoCancelStatus].push(c.id)

  const updated: { id: string; event_date: string; fromStatus: AutoCancelStatus }[] = []
  for (const status of AUTO_CANCEL_STATUSES) {
    const ids = idsByStatus[status]
    if (ids.length === 0) continue
    // UPDATE 自体に「id・旧 status・event_date の範囲」を付ける（service role は RLS を迂回するため）。
    // SELECT 後に別 status へ変更された案件は一致せず、更新されない。
    const { data, error } = await client
      .from('cases')
      .update({
        status: 'cancelled',
        auto_cancel: true,
        cancel_reason_id: reasonId,
        cancel_note: AUTO_CANCEL_NOTE,
      })
      .eq('status', status)
      .in('id', ids)
      .not('event_date', 'is', null)
      .lt('event_date', window.cutoffs[status])
      .gte('event_date', window.lookbackStart)
      .select('id,event_date')
    if (error) {
      return {
        status: 500,
        body: { ...base, dryRun: false, message: '自動キャンセルの更新に失敗しました（一部は更新済みの可能性があります）', stage: '更新', processedBeforeError: updated.length },
      }
    }
    for (const r of (data ?? []) as { id: string; event_date: string }[]) {
      updated.push({ id: r.id, event_date: r.event_date, fromStatus: status })
    }
  }

  // 履歴は「実際に更新された案件」についてだけ書く（二重実行・競合で更新されなかった案件は書かない）
  let historyRecorded = true
  if (updated.length > 0) {
    const { error } = await client.from('case_history').insert(
      updated.map((u) => ({
        case_id: u.id,
        action_type: 'auto_cancel' as const,
        message: `開催日（${u.event_date}）から所定の猶予日数を経過したため自動キャンセル`,
        old_value: { status: u.fromStatus },
        new_value: { status: 'cancelled', auto_cancel: true },
        changed_by: opts.actorUserId ?? null,
      }))
    )
    if (error) {
      historyRecorded = false
      // status の更新は成功済みのため、ロールバックはしない。ログにのみ残す
      console.error('[auto-cancel] 履歴挿入失敗（status更新は成功済み）:', error)
    }
  }

  const processedByStatus: Record<string, number> = {}
  for (const u of updated) processedByStatus[u.fromStatus] = (processedByStatus[u.fromStatus] ?? 0) + 1
  console.log(`[auto-cancel] ${updated.length}件を自動キャンセルしました`)
  return {
    status: 200,
    body: { ...base, dryRun: false, processed: updated.length, processedByStatus, historyRecorded, message: `${updated.length}件を自動キャンセルしました` },
  }
}
