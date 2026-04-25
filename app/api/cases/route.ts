import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error) {
    return NextResponse.json({ message: '取得失敗' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// PUT
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()

    const { error } = await supabase
      .from('cases')
      .update(body)
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ message: '更新失敗' }, { status: 500 })
  }
}