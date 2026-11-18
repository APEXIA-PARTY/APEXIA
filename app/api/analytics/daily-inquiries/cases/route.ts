import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserAndRole } from '@/lib/auth/helpers'
import {
  DAILY_CASES_PAGE_SIZE,
  DAILY_UNASSIGNED_TARGET,
  calcTotalPages,
  mapDailyCaseRow,
  parseCasesRequest,
  type DailyCaseItem,
  type DailyInquiryKind,
} from '@/lib/utils/dailyInquiry'

/**
 * GET /api/analytics/daily-inquiries/cases?kind=category|media&target=<マスタID|__none__>&date=YYYY-MM-DD&page=N
 *
 * 日別問合せで選択した「1日分」の案件一覧（ページ送り）。読み取り専用（SELECTのみ）。
 * ・指定した問い合わせ日・分類（または認知経路）の案件だけをDB側の条件で絞り込む
 * ・案件詳細の閲覧と同じ水準（ログイン済み）で、ロールが取得できない場合は返さない
 * ・取得するのは表示に必要な項目だけ。担当者名・電話・メール・備考・添付・履歴は取得も返却もしない
 * ・並び順は created_at, id の固定順（ページ間の重複・欠落を防ぐ）
 * ・失敗時は詳細を含めない固定メッセージで 500 を返す
 */

const TARGET_COLUMN: Record<DailyInquiryKind, string> = {
  category: 'event_category_id',
  media: 'media_id',
}

export async function GET(request: NextRequest) {
  const { user, role } = await getCurrentUserAndRole()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }
  if (!role) {
    return NextResponse.json({ message: '権限を確認できません' }, { status: 403 })
  }

  const parsed = parseCasesRequest(new URL(request.url).searchParams)
  if (!parsed) {
    return NextResponse.json({ message: '指定が不正です' }, { status: 400 })
  }
  const { kind, target, date, page } = parsed

  const supabase = await createClient()
  const column = TARGET_COLUMN[kind]
  const from = (page - 1) * DAILY_CASES_PAGE_SIZE
  const to = from + DAILY_CASES_PAGE_SIZE - 1

  let query = supabase
    .from('cases')
    .select(
      'id,company,event_name,status,auto_cancel,estimate_amount,event_subcategory_note,event_category_master(name),event_subcategory_master(name)',
      { count: 'exact' }
    )
    .eq('inquiry_date', date)
  query = target === DAILY_UNASSIGNED_TARGET ? query.is(column, null) : query.eq(column, target)

  const { data, count, error } = await query
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)

  if (error || !Array.isArray(data) || typeof count !== 'number') {
    console.error('[daily-inquiries/cases] 案件一覧の取得に失敗しました')
    return NextResponse.json({ message: '案件一覧の取得に失敗しました' }, { status: 500 })
  }

  const cases: DailyCaseItem[] = []
  for (const row of data) {
    const item = mapDailyCaseRow(row)
    if (!item) {
      console.error('[daily-inquiries/cases] 想定外の行を検出しました')
      return NextResponse.json({ message: '案件一覧の取得に失敗しました' }, { status: 500 })
    }
    cases.push(item)
  }

  return NextResponse.json({
    date,
    page,
    pageSize: DAILY_CASES_PAGE_SIZE,
    totalCount: count,
    totalPages: calcTotalPages(count),
    cases,
  })
}
