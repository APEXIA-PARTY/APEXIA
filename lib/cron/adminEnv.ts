/**
 * cron GET 専用の Supabase 管理クライアント（service role）に必要な環境変数の検証。
 *
 * ・SUPABASE_SERVICE_ROLE_KEY は NEXT_PUBLIC_ を付けない（ブラウザに出さない）
 * ・未設定なら明示的にエラーにする。匿名キー（anon）へのフォールバックはしない
 * ・エラーメッセージに環境変数の「値」は含めない
 *
 * 実際のクライアント生成は lib/supabase/admin.ts（server-only）で行う。
 * この関数は server-only に依存しないため、node:test で単体テストできる。
 */

export class AdminClientConfigError extends Error {
  readonly code: 'missing_url' | 'missing_service_role_key'
  constructor(code: 'missing_url' | 'missing_service_role_key') {
    super(
      code === 'missing_url'
        ? 'Supabase の URL が設定されていません（NEXT_PUBLIC_SUPABASE_URL）。'
        : 'SUPABASE_SERVICE_ROLE_KEY が設定されていません。cron の DB 接続を作成できません。'
    )
    this.name = 'AdminClientConfigError'
    this.code = code
  }
}

const present = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== ''

export function readAdminClientConfig(env: Record<string, string | undefined>): { url: string; serviceRoleKey: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!present(url)) throw new AdminClientConfigError('missing_url')
  if (!present(serviceRoleKey)) throw new AdminClientConfigError('missing_service_role_key')
  return { url: url.trim(), serviceRoleKey: serviceRoleKey.trim() }
}
