import { createClient } from '@/lib/supabase/server'
import { UserRole } from '@/types/database'

/**
 * 現在のログインユーザーを取得する
 * サーバーコンポーネント・Route Handler から呼び出す
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/**
 * ユーザーのロールを取得する
 * Supabase の user_metadata に role を格納している前提
 * 初期ユーザーは Supabase Dashboard から手動で role を設定する
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const user = await getCurrentUser()
  if (!user) return null

  // user_metadata.role を参照
  const role = user.user_metadata?.role as UserRole | undefined
  return role ?? 'viewer' // デフォルトは viewer
}

/**
 * 管理者のみ許可するガード
 * Route Handler 内で使用する
 */
export async function requireAdmin(): Promise<{ error: Response | null }> {
  const role = await getCurrentUserRole()
  if (role !== 'admin') {
    return {
      error: new Response(
        JSON.stringify({ message: '管理者権限が必要です' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }
  return { error: null }
}

/**
 * staff 以上の権限を要求するガード（admin + staff）
 */
export async function requireStaff(): Promise<{ error: Response | null }> {
  const role = await getCurrentUserRole()
  if (!role || role === 'viewer') {
    return {
      error: new Response(
        JSON.stringify({ message: 'スタッフ以上の権限が必要です' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }
  return { error: null }
}

/**
 * 認証済みかどうかのガード
 */
export async function requireAuth(): Promise<{ error: Response | null }> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      error: new Response(
        JSON.stringify({ message: 'ログインが必要です' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }
  return { error: null }
}
