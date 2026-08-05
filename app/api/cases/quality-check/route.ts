import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'

export type Priority = 'high' | 'medium' | 'low'

export interface QualityCase {
  id: string
  company: string
  event_name: string | null
  event_date: string | null
  status: string
}

export interface QualityCheck {
  id: string
  label: string
  description: string
  priority: Priority
  count: number
  cases: QualityCase[]
}

export interface QualityCheckResult {
  totalIssues: number
  checkedAt: string
  checks: QualityCheck[]
}

const UNPROCESSED_STATUSES = ['inquiry', 'preview_adj', 'previewed', 'tentative']

export async function GET() {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = await createClient()

  const { data: cases, error } = await supabase
    .from('cases')
    .select(
      'id,company,contact,event_date,status,media_id,event_category_id,estimate_amount,cancel_reason_id,event_name'
    )
    .order('event_date', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = cases ?? []
  const todayStr = new Date().toISOString().split('T')[0]

  const toCase = (c: (typeof rows)[0]): QualityCase => ({
    id: c.id,
    company: c.company || '（未入力）',
    event_name: c.event_name,
    event_date: c.event_date,
    status: c.status,
  })

  const rawChecks = [
    {
      id: 'missing_company',
      label: '会社名が空欄',
      description: '会社名が入力されていない案件',
      priority: 'high' as Priority,
      cases: rows.filter(c => !c.company || c.company.trim() === '').map(toCase),
    },
    {
      id: 'missing_contact',
      label: '担当者名が空欄',
      description: '担当者名が入力されていない案件',
      priority: 'medium' as Priority,
      cases: rows.filter(c => !c.contact || (c.contact as string).trim() === '').map(toCase),
    },
    {
      id: 'missing_event_date',
      label: '開催日が空欄',
      description: '開催日が設定されていない案件',
      priority: 'high' as Priority,
      cases: rows.filter(c => !c.event_date).map(toCase),
    },
    {
      id: 'missing_status',
      label: 'ステータスが未設定',
      description: 'ステータスが設定されていない案件',
      priority: 'medium' as Priority,
      cases: rows.filter(c => !c.status).map(toCase),
    },
    {
      id: 'missing_media',
      label: '認知経路が未設定',
      description: '認知経路（媒体）が設定されていない案件',
      priority: 'low' as Priority,
      cases: rows.filter(c => !c.media_id).map(toCase),
    },
    {
      id: 'missing_category',
      label: 'イベント分類が未設定',
      description: 'イベント分類が設定されていない案件',
      priority: 'low' as Priority,
      cases: rows.filter(c => !c.event_category_id).map(toCase),
    },
    {
      id: 'missing_estimate',
      label: '見積金額が0円または未入力',
      description: '見積金額が未入力または0円の案件',
      priority: 'medium' as Priority,
      cases: rows
        .filter(c => !c.estimate_amount || (c.estimate_amount as number) === 0)
        .map(toCase),
    },
    {
      id: 'confirmed_no_revenue',
      label: '確定なのに見積金額が0円',
      description: 'ステータスが「確定」なのに見積金額が0円または未入力の案件',
      priority: 'high' as Priority,
      cases: rows
        .filter(
          c =>
            c.status === 'confirmed' &&
            (!c.estimate_amount || (c.estimate_amount as number) === 0)
        )
        .map(toCase),
    },
    {
      id: 'cancelled_no_reason',
      label: 'キャンセルなのにキャンセル理由が空欄',
      description: 'ステータスが「キャンセル」なのにキャンセル理由が未設定の案件',
      priority: 'high' as Priority,
      cases: rows.filter(c => c.status === 'cancelled' && !c.cancel_reason_id).map(toCase),
    },
    {
      id: 'past_unprocessed',
      label: '開催日が過去なのにステータスが未処理',
      description:
        '開催日が今日より前なのに、ステータスが確定・キャンセル・終了になっていない案件',
      priority: 'high' as Priority,
      cases: rows
        .filter(
          c =>
            c.event_date &&
            c.event_date < todayStr &&
            UNPROCESSED_STATUSES.includes(c.status)
        )
        .map(toCase),
    },
  ]

  const checks: QualityCheck[] = rawChecks.map(check => ({
    ...check,
    count: check.cases.length,
  }))

  const totalIssues = checks.reduce((sum, c) => sum + c.count, 0)

  return NextResponse.json({
    totalIssues,
    checkedAt: new Date().toISOString(),
    checks,
  } satisfies QualityCheckResult)
}
