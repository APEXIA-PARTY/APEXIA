import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { shouldSetConfirmedAt } from '@/lib/cases/statusTransition'
import type { CaseStatus } from '@/types/database'

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

    // confirmed_at はクライアントから直接指定不可（サーバー側でのみセットする）
    const { confirmed_at: _ignoredConfirmedAt, ...insertData } = body as Record<string, unknown>

    // 新規作成時点で収益ステータス（confirmed/done）で登録された場合はここでセットする
    // （旧ステータスは存在しない＝undefinedとして判定する）
    if (shouldSetConfirmedAt(undefined, insertData.status as CaseStatus | undefined)) {
      insertData.confirmed_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('cases')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error(error)
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    revalidatePath(`/cases/${data.id}`)
    revalidatePath('/cases')

    return NextResponse.json(data)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ message: '作成失敗' }, { status: 500 })
  }
}