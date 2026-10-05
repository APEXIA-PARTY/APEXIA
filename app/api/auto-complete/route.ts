import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCronAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/helpers'
import { verifyCronAuth } from '@/lib/cron/auth'
import { decideExecution, parseDryRunBody, parseDryRunParam, resolveCronMode } from '@/lib/cron/mode'
import { runAutoComplete } from '@/lib/cron/autoCompleteRunner'

/**
 * /api/auto-complete — 確定(confirmed)案件のうち、開催日(event_date)を過ぎたものを「開催終了(done)」へ変更
 *
 * 対象条件:
 *   - status = 'confirmed'
 *   - event_date IS NOT NULL
 *   - event_date < JST基準の今日（開催日当日は対象外、翌日以降が対象）
 * 1回の書込み上限は30件。超える場合は、1件も書き込まず中止する。
 *
 * 動作モード（環境変数 CRON_MODE）: off / dry / live。未設定・不正は dry（書込みなし）。
 * 既存の auto-cancel とは独立した別ルート（認証・モード・dry-run・競合対策は同じ方針）。
 *
 * 呼び出し元:
 *   GET  : Vercel Cron Jobs。CRON_SECRET の認証後、service role で実行。?dryRun=1 で集計のみ
 *   POST : 管理者による手動実行（ログイン済み管理者のセッション）。{ "dryRun": true } で集計のみ
 */
export const dynamic = 'force-dynamic'

// GET: Vercel Cron Jobs から呼び出される
export async function GET(request: NextRequest) {
  // 認証に失敗したら、DB クライアントを作る前に終了する（CRON_SECRET 未設定・空も失敗。フェイルクローズ）
  const auth = verifyCronAuth(request.headers.get('authorization'), process.env.CRON_SECRET)
  if (!auth.ok) {
    console.error(`[auto-complete] cron 認証失敗: ${auth.reason}`)
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const mode = resolveCronMode(process.env.CRON_MODE)
  const dryRunRequested = parseDryRunParam(new URL(request.url).searchParams.get('dryRun'))
  const decision = decideExecution({ trigger: 'cron', mode, dryRunRequested })

  if (decision === 'disabled') {
    return NextResponse.json({ mode, disabled: true, message: 'CRON_MODE=off のため何も実行していません' })
  }
  if (decision === 'blocked') {
    return NextResponse.json({ mode, blocked: true, message: '実行できません' }, { status: 403 })
  }

  let client
  try {
    client = createCronAdminClient() // service role。未設定なら例外（anon へのフォールバックはしない）
  } catch (e) {
    console.error('[auto-complete] cron 用 DB クライアントを作成できません:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ message: 'cron の DB 接続が設定されていません' }, { status: 500 })
  }

  const result = await runAutoComplete({ client, decision, mode })
  return NextResponse.json(result.body, { status: result.status })
}

// POST: 管理者による手動実行（ログイン済み管理者のセッション。service role は使わない）
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const mode = resolveCronMode(process.env.CRON_MODE)
  const decision = decideExecution({ trigger: 'admin', mode, dryRunRequested: parseDryRunBody(body) })

  if (decision === 'disabled') {
    return NextResponse.json({ mode, disabled: true, liveEnabled: false, message: 'CRON_MODE=off のため自動開催終了は無効です' })
  }
  if (decision === 'blocked') {
    return NextResponse.json(
      { mode, blocked: true, liveEnabled: false, message: 'CRON_MODE が live ではないため、本処理は実行できません（対象の確認 dryRun のみ可能です）' },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const result = await runAutoComplete({ client: supabase, decision, mode })
  return NextResponse.json(result.body, { status: result.status })
}
