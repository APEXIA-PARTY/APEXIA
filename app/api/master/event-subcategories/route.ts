import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const category_id = searchParams.get('category_id')

  const { data } = await supabase
    .from('event_subcategory_master')
    .select('id, name, category_id')
    .eq('is_active', true)
    .eq('category_id', category_id)
    .order('display_order')

  return NextResponse.json(data ?? [])
}