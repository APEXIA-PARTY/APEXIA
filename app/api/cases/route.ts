import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 一覧取得
export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    return NextResponse.json({ message: '取得失敗' }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// 新規作成
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const body = await req.json()

    const { data, error } = await supabase
      .from('cases')
      .insert(body)
      .select()
      .single()

    if (error) {
      console.error(error)
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ message: '作成失敗' }, { status: 500 })
  }
}