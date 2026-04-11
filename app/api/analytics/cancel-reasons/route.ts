import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { filterByYear, filterByMonth, CaseRow, calcPercent } from '@/lib/utils/analytics'

export async function GET(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year'); const month = searchParams.get('month')

  const [{ data: masters }, { data: cases }] = await Promise.all([
    supabase.from('cancel_reason_master').select('id,name,is_auto_cancel').eq('is_active', true).order('display_order'),
    supabase.from('cases').select('id,status,auto_cancel,estimate_amount,inquiry_date,event_date,company,cancel_reason_id,cancel_note')
      .eq('status', 'cancelled'),
  ])

  if (!cases) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  let rows = cases as CaseRow[]
  if (month) rows = filterByMonth(rows, month); else if (year) rows = filterByYear(rows, year)

  const totalCancel = rows.length

  const result = (masters ?? []).map(m => {
    const mc = rows.filter(c => c.cancel_reason_id === m.id)
    const notes = mc.map(c => ({
      company:    c.company,
      date:       c.inquiry_date,
      event_date: c.event_date,
      note:       c.cancel_note,
    })).filter(n => n.note)

    return {
      id: m.id, name: m.name, is_auto_cancel: m.is_auto_cancel,
      count:  mc.length,
      share:  calcPercent(mc.length, totalCancel),
      notes,
    }
  })

  // 理由未設定
  const noReason = rows.filter(c => !c.cancel_reason_id)
  if (noReason.length > 0) {
    result.push({
      id: '__none__', name: '（未設定）', is_auto_cancel: false,
      count: noReason.length,
      share: calcPercent(noReason.length, totalCancel),
      notes: [],
    })
  }

  return NextResponse.json({
    period:      month ?? year ?? 'all',
    totalCancel,
    manualCancel: rows.filter(c => !c.auto_cancel).length,
    autoCancel:   rows.filter(c => c.auto_cancel).length,
    rows:         result.sort((a, b) => b.count - a.count),
  })
}
