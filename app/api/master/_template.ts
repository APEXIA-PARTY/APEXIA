/**
 * このファイルは各マスタAPIの共通パターンを示すテンプレートです。
 * 以下の各ファイルを同じパターンで作成してください：
 *
 * app/api/master/contact-methods/route.ts  → contact_method_master
 * app/api/master/event-categories/route.ts → event_category_master
 * app/api/master/floors/route.ts           → floor_master
 * app/api/master/cancel-reasons/route.ts   → cancel_reason_master
 * app/api/master/options/route.ts          → option_master
 *
 * event-subcategories は category_id フィルターが必要なため別実装
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'

// ─── 連絡方法マスタ ─────────────────────────────────────────
export async function GET_contact_methods() {
  const { error } = await requireAuth()
  if (error) return error
  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('contact_method_master')
    .select('*')
    .eq('is_active', true)
    .order('display_order')
  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// ─── イベント中分類（category_id フィルター対応）──────────────
export async function GET_event_subcategories(request: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('category_id')

  let query = supabase
    .from('event_subcategory_master')
    .select('*, event_category_master(id, name)')
    .eq('is_active', true)
    .order('display_order')

  if (categoryId) {
    query = query.eq('category_id', categoryId)
  }

  const { data, error: dbError } = await query
  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? [])
}
