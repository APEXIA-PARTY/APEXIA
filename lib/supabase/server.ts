import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * サーバーコンポーネント・Route Handler 用 Supabase クライアント
 * Cookie ベースのセッション管理
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component からの呼び出しでは set できない場合があるが無視してよい
          }
        },
      },
    }
  )
}

/**
 * Service Role クライアント（管理者操作・自動キャンセルバッチ用）
 * RLS をバイパスするため、サーバーサイドのみで使用すること
 */
export function createServiceClient() {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
