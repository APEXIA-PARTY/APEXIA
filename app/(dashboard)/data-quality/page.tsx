import { redirect } from 'next/navigation'
import { getCurrentUserAndRole } from '@/lib/auth/helpers'
import { DataQualityCheck } from '@/components/data-quality/DataQualityCheck'

export default async function DataQualityPage() {
  // 他のダッシュボード配下ページ（cases等）と同じ認証ガード。
  // ロール制限はなし（admin/staff/viewer全員が利用可能）。
  const { user } = await getCurrentUserAndRole()
  if (!user) redirect('/login')

  return <DataQualityCheck />
}
