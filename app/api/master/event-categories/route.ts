import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
    const { data } = await supabase
        .from('event_category_master')
        .select('id, name')
        .eq('is_active', true)
        .order('display_order')

    return NextResponse.json(data ?? [])
}