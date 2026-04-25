import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error) {
    console.error(error)
    return NextResponse.json({ message: '案件取得失敗' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('cases')
    .update(body)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    console.error(error)
    return NextResponse.json({ message: '更新失敗' }, { status: 500 })
  }

  return NextResponse.json(data)
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const caseId = params.id

  try {
    // 子テーブルを先に削除（外部キー対策）
    await supabase.from('case_history').delete().eq('case_id', caseId)
    await supabase.from('case_options').delete().eq('case_id', caseId)
    await supabase.from('case_checklist').delete().eq('case_id', caseId)
    await supabase.from('case_files').delete().eq('case_id', caseId)
    await supabase.from('case_hold_logs').delete().eq('case_id', caseId)

    // 最後に親
    const { error } = await supabase
      .from('cases')
      .delete()
      .eq('id', caseId)

    if (error) {
      console.error(error)
      return NextResponse.json({ message: '削除失敗' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ message: '削除失敗' }, { status: 500 })
  }
}