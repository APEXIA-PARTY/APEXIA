import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'

/**
 * POST /api/auto-cancel
 * 自動キャンセル処理を実行する
 *
 * 対象条件:
 *   - event_date < 今日
 *   - status NOT IN ('confirmed', 'done', 'cancelled')
 *
 * 呼び出し元:
 *   - 管理者による手動実行（ダッシュボードのボタン）
 *   - Vercel Cron Jobs（vercel.json で GET を設定）
 *   - 将来的な Supabase Edge Function
 */

// GET: Vercel Cron Jobs から呼び出される
export async function GET(request: NextRequest) {
  // Vercel Cron からのリクエストのみ許可（本番環境）
  const authHeader = request.headers.get('authorization')
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }
  return runAutoCancel()
}

// POST: 管理者による手動実行
export async function POST(_request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error
  return runAutoCancel()
}

async function runAutoCancel(): Promise<NextResponse> {
  const supabase = await createClient()
  const today    = new Date().toISOString().slice(0, 10)

  // 自動キャンセル専用理由を取得
  const { data: reasonRow } = await supabase
    .from('cancel_reason_master')
    .select('id')
    .eq('is_auto_cancel', true)
    .eq('is_active', true)
    .single()

  if (!reasonRow) {
    console.warn('[auto-cancel] is_auto_cancel=true のキャンセル理由が見つかりません')
  }

  // 対象案件を取得
  const { data: targets, error: fetchError } = await supabase
    .from('cases')
    .select('id, company, event_date, status')
    .lt('event_date', today)
    .not('status', 'in', '("confirmed","done","cancelled")')
    .not('event_date', 'is', null)

  if (fetchError) {
    console.error('[auto-cancel] 対象取得失敗:', fetchError)
    return NextResponse.json({ message: '対象案件の取得に失敗しました' }, { status: 500 })
  }

  const targetCases = targets ?? []
  if (targetCases.length === 0) {
    return NextResponse.json({ processed: 0, message: '対象案件はありません' })
  }

  const targetIds = targetCases.map(c => c.id)

  // 一括更新
  const { error: updateError } = await supabase
    .from('cases')
    .update({
      status:           'cancelled',
      auto_cancel:      true,
      cancel_reason_id: reasonRow?.id ?? null,
      cancel_note:      '開催予定日経過による自動キャンセル',
    })
    .in('id', targetIds)

  if (updateError) {
    console.error('[auto-cancel] 更新失敗:', updateError)
    return NextResponse.json({ message: '自動キャンセル処理に失敗しました' }, { status: 500 })
  }

  // 履歴を一括 INSERT
  const historyRows = targetCases.map(c => ({
    case_id:     c.id,
    action_type: 'auto_cancel' as const,
    message:     `開催予定日（${c.event_date}）経過による自動キャンセル`,
    old_value:   { status: c.status },
    new_value:   { status: 'cancelled', auto_cancel: true },
    changed_by:  null, // システム実行
  }))

  const { error: historyError } = await supabase
    .from('case_history')
    .insert(historyRows)

  if (historyError) {
    // 履歴挿入失敗はキャンセル処理自体に影響しないためログのみ
    console.error('[auto-cancel] 履歴挿入失敗:', historyError)
  }

  console.log(`[auto-cancel] ${targetCases.length}件を自動キャンセルしました`)

  return NextResponse.json({
    processed: targetCases.length,
    cases: targetCases.map(c => ({ id: c.id, company: c.company, event_date: c.event_date, prevStatus: c.status })),
    message: `${targetCases.length}件を自動キャンセルしました`,
  })
}
