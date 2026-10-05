import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { readAdminClientConfig } from '@/lib/cron/adminEnv'

/**
 * cron の GET（/api/auto-cancel, /api/auto-complete）専用の Supabase クライアント（service role）。
 *
 * 重要:
 * ・server-only。ブラウザ側のコードから import できない（import するとビルドエラーになる）
 * ・使ってよいのは、CRON_SECRET の認証に成功した後の cron GET だけ。通常のユーザー操作では使わない
 * ・service role は RLS を迂回する。呼び出し側は UPDATE 文にも対象条件を必ず付けること
 * ・SUPABASE_SERVICE_ROLE_KEY が未設定ならエラー（匿名キーへのフォールバックはしない）
 * ・キーの値をログ・レスポンスに出さない
 */
export function createCronAdminClient() {
  const { url, serviceRoleKey } = readAdminClientConfig(process.env)
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
