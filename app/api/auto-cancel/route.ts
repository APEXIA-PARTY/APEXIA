import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCronAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, getCurrentUser } from '@/lib/auth/helpers'
import { verifyCronAuth } from '@/lib/cron/auth'
import { decideExecution, parseDryRunBody, parseDryRunParam, resolveCronMode } from '@/lib/cron/mode'
import { runAutoCancel } from '@/lib/cron/autoCancelRunner'

/**
 * /api/auto-cancel — 開催日を過ぎた未確定案件の自動キャンセル
 *
 * 対象・猶予・遡り上限・件数上限・理由の扱いは lib/cron/autoCancelRules.ts / autoCancelRunner.ts を参照。
 *   inquiry / preview_adj: 開催日から7日を超えて経過 / previewed: 14日を超えて経過
 *   tentative・confirmed・done・cancelled は対象外 / 今日（日本時間）から30日より古い案件は対象外
 *   対象が30件を超えたら、1件も書き込まず中止
 *
 * 動作モード（環境変数 CRON_MODE）: off / dry / live。未設定・不正は dry（書込みなし）。
 *
 * 呼び出し元:
 *   GET  : Vercel Cron Jobs。CRON_SECRET の認証後、service role で実行（RLS を迂回するため UPDATE にも条件を付ける）
 *          ?dryRun=1 で、モードに関わらず集計のみ（書込みなし）
 *   POST : 管理者がダッシュボードから実行。ログイン済み管理者のセッション（RLS 有効）で実行
 *          本文 { "dryRun": true } で集計のみ。本実行は CRON_MODE=live のときだけ可能
 */
export const dynamic = 'force-dynamic'

// GET: Vercel Cron Jobs から呼び出される
export async function GET(request: NextRequest) {
  // 認証に失敗したら、DB クライアントを作る前に終了する（CRON_SECRET 未設定・空も失敗。フェイルクローズ）
  const auth = verifyCronAuth(request.headers.get('authorization'), process.env.CRON_SECRET)
  if (!auth.ok) {
    console.error(`[auto-cancel] cron 認証失敗: ${auth.reason}`)
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  const mode = resolveCronMode(process.env.CRON_MODE)
  const dryRunRequested = parseDryRunParam(new URL(request.url).searchParams.get('dryRun'))
  const decision = decideExecution({ trigger: 'cron', mode, dryRunRequested })

  if (decision === 'disabled') {
    return NextResponse.json({ mode, disabled: true, message: 'CRON_MODE=off のため何も実行していません' })
  }
  if (decision === 'blocked') {
    // trigger=cron では発生しない（防御的に何もしない）
    return NextResponse.json({ mode, blocked: true, message: '実行できません' }, { status: 403 })
  }

  let client
  try {
    client = createCronAdminClient() // service role。未設定なら例外（anon へのフォールバックはしない）
  } catch (e) {
    console.error('[auto-cancel] cron 用 DB クライアントを作成できません:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ message: 'cron の DB 接続が設定されていません' }, { status: 500 })
  }

  const result = await runAutoCancel({ client, decision, mode, actorUserId: null })
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
    body = null // 本文なしは「本実行の要求」として扱う（CRON_MODE=live でなければ blocked になる）
  }

  const mode = resolveCronMode(process.env.CRON_MODE)
  const decision = decideExecution({ trigger: 'admin', mode, dryRunRequested: parseDryRunBody(body) })

  if (decision === 'disabled') {
    return NextResponse.json({ mode, disabled: true, liveEnabled: false, message: 'CRON_MODE=off のため自動キャンセルは無効です' })
  }
  if (decision === 'blocked') {
    return NextResponse.json(
      { mode, blocked: true, liveEnabled: false, message: 'CRON_MODE が live ではないため、本処理は実行できません（対象の確認 dryRun のみ可能です）' },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const user = await getCurrentUser()
  const result = await runAutoCancel({ client: supabase, decision, mode, actorUserId: user?.id ?? null })
  return NextResponse.json(result.body, { status: result.status })
}
