import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
    const { data, error } = await supabase
        .from('media_master')
        .select('id, name')
        .eq('is_active', true)
        .order('display_order')

    if (error) return NextResponse.json([], { status: 500 })
    return NextResponse.json(data ?? [])
}