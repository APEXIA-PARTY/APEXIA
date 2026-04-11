import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { caseFormSchema } from '@/lib/validations/case'

function emptyToNull<T>(v: T | '' | undefined): T | null {
  return v === '' || v === undefined ? null : v
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()

  try {
    const body = await req.json()
    const parsed = caseFormSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: '入力内容に問題があります',
          issues: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const v = parsed.data

    const insertData = {
      // 基本情報
      company: emptyToNull(v.company),
      contact: emptyToNull(v.contact),
      phone: emptyToNull(v.phone),
      email: emptyToNull(v.email),
      inquiry_date: emptyToNull(v.inquiry_date),
      event_date: emptyToNull(v.event_date),
      event_name: emptyToNull(v.event_name),
      guest_count: v.guest_count ?? null,
      notes: emptyToNull(v.notes),
      estimate_amount: v.estimate_amount ?? 0,

      // FK
      media_id: emptyToNull(v.media_id),
      contact_method_id: emptyToNull(v.contact_method_id),
      floor_id: emptyToNull(v.floor_id),
      event_category_id: emptyToNull(v.event_category_id),
      event_subcategory_id: emptyToNull(v.event_subcategory_id),
      event_subcategory_note: emptyToNull(v.event_subcategory_note),

      // タイムスケジュール
      load_in_time: emptyToNull(v.load_in_time),
      setup_time: emptyToNull(v.setup_time),
      rehearsal_time: emptyToNull(v.rehearsal_time),
      start_time: emptyToNull(v.start_time),
      end_time: emptyToNull(v.end_time),
      strike_time: emptyToNull(v.strike_time),
      full_exit_time: emptyToNull(v.full_exit_time),

      // 確認手続き
      preview_datetime: emptyToNull(v.preview_datetime),
      application_form_status: v.application_form_status ?? '未対応',
      delivery_notice_status: v.delivery_notice_status ?? '未対応',
      invoice_status: v.invoice_status ?? '未対応',
      payment_method: emptyToNull(v.payment_method),

      // ステータス
      status: v.status ?? 'inquiry',

      // Google Calendar
      gcal_event_id: emptyToNull(v.gcal_event_id),

      // 自動キャンセル
      auto_cancel: v.auto_cancel ?? false,

      // キャンセル関連
      cancel_reason_id: emptyToNull(v.cancel_reason_id),
      cancel_note: emptyToNull(v.cancel_note),
    }

    const { data, error: insertError } = await supabase
      .from('cases')
      .insert(insertData)
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json(
        {
          message: insertError.message || '登録に失敗しました',
          details: insertError,
        },
        { status: 500 }
      )
    }

    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { message: '登録に失敗しました' },
      { status: 500 }
    )
  }
}