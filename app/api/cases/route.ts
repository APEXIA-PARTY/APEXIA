import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { shouldSetConfirmedAt } from '@/lib/cases/statusTransition'
import { validateEventPairForSave } from '@/lib/cases/eventCategory'
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

    // 中分類が大分類の配下であること（不整合は400で保存を拒否）
    const invalidEvent = await validateEventPairForSave(supabase, body as Record<string, unknown>)
    if (invalidEvent) {
      return NextResponse.json({ message: invalidEvent.message }, { status: invalidEvent.status })
    }

    // confirmed_at はクライアントから直接指定不可（サーバー側でのみセットする）
    // cancelled_at もクライアントから直接指定不可。新規作成時は常に NULL（打刻は UPDATE で cancelled へ遷移したとき DB トリガーだけが行う）
    const {
      confirmed_at: _ignoredConfirmedAt,
      cancelled_at: _ignoredCancelledAt,
      ...insertData
    } = body as Record<string, unknown>

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