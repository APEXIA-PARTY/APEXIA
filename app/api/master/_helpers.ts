import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'

/**
 * 共通マスタ取得ハンドラ
 * is_active=true のレコードのみ display_order 順に返す
 */
async function getMasterData(tableName: string) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = await createClient()

  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (error) {
    console.error(`[GET /api/master/${tableName}]`, error)
    return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

export { getMasterData }
