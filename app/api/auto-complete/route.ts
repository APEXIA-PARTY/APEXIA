import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import { getJstTodayDateString } from '@/lib/utils/autoComplete'

/**
 * POST/GET /api/auto-complete
 * 確定(confirmed)案件のうち、開催日(event_date)を過ぎたものを
 * 自動的に「開催終了(done)」へ変更する。
 *
 * 対象条件:
 *   - status = 'confirmed'
 *   - event_date IS NOT NULL
 *   - event_date < JST基準の今日（開催日当日は対象外、翌日以降が対象）
 *
 * 既存の app/api/auto-cancel/route.ts（開催日超過による自動キャンセル）とは
 * 完全に独立した別ルート。auto-cancel のコード・設定には一切触れない。
 *
 * 呼び出し元:
 *   - 管理者による手動実行（POST）
 *   - Vercel Cron Jobs（vercel.json で GET を設定）
 */

// GET: Vercel Cron Jobs から呼び出される
export async function GET(request: NextRequest) {
  // Vercel Cron からのリクエストのみ許可（本番環境）。既存 auto-cancel と同じ認証パターン。
  const authHeader = request.headers.get('authorization')
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }
  return runAutoComplete()
}

// POST: 管理者による手動実行
export async function POST(_request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error
  return runAutoComplete()
}

async function runAutoComplete(): Promise<NextResponse> {
  const supabase = await createClient()
  const jstToday = getJstTodayDateString()

  // UPDATE文そのものに status='confirmed' 等の条件を必ず含める
  // （事前にSELECTで対象IDを確定させてからUPDATEする方式は採らない）。
  // これにより、Cron実行の直前にスタッフが別ステータス（キャンセル等）へ
  // 変更していた場合、その案件はこのWHERE条件に一致しなくなり上書きされない。
  // updated_at は cases テーブルの既存トリガー（trg_cases_updated_at）が
  // 自動更新するため、ここで明示的にセットする必要はない。
  const { data: updated, error: updateError } = await supabase
    .from('cases')
    .update({ status: 'done' })
    .eq('status', 'confirmed')
    .not('event_date', 'is', null)
    .lt('event_date', jstToday)
    .select('id, company, event_date')

  if (updateError) {
    console.error('[auto-complete] 更新失敗:', updateError)
    return NextResponse.json({ message: '自動開催終了処理に失敗しました' }, { status: 500 })
  }

  const updatedCases = updated ?? []
  if (updatedCases.length === 0) {
    return NextResponse.json({ processed: 0, message: '対象案件はありません' })
  }

  // 履歴を一括 INSERT する。新しい action_type は追加せず、既存の
  // CHECK制約に含まれる 'status_change' を使用する（migration不要）。
  const historyRows = updatedCases.map((c) => ({
    case_id: c.id,
    action_type: 'status_change' as const,
    message: `開催日（${c.event_date}）経過による自動開催終了（確定→開催終了）`,
    old_value: { status: 'confirmed' },
    new_value: { status: 'done' },
    changed_by: null, // システム実行
  }))

  const { error: historyError } = await supabase.from('case_history').insert(historyRows)

  if (historyError) {
    // status の更新自体は既に成功しているため、ここでロールバックはしない
    // （案件を誤ってconfirmedへ巻き戻すような処理は行わない）。ログにのみ残す。
    console.error('[auto-complete] 履歴挿入失敗（status更新は成功済み）:', historyError)
  }

  console.log(`[auto-complete] ${updatedCases.length}件を自動的に開催終了へ変更しました`)

  return NextResponse.json({
    processed: updatedCases.length,
    cases: updatedCases.map((c) => ({ id: c.id, company: c.company, event_date: c.event_date })),
    message: `${updatedCases.length}件を開催終了へ変更しました`,
    historyRecorded: !historyError,
  })
}
