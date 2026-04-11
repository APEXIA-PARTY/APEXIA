import { NextResponse } from 'next/server'
import { getCurrentUserRole } from '@/lib/auth/helpers'

/**
 * GET /api/auth/role
 * クライアントコンポーネントからロールを取得するための軽量エンドポイント
 */
export async function GET() {
  const role = await getCurrentUserRole()
  if (!role) {
    return NextResponse.json({ role: null }, { status: 401 })
  }
  return NextResponse.json({ role })
}
