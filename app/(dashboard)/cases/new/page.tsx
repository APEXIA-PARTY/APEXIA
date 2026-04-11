import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { CaseForm } from '@/components/cases/CaseForm'
import Link from 'next/link'

export default async function NewCasePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="新規問合せ登録"
        actions={
          <Link href="/cases" className="text-sm text-muted-foreground hover:underline">
            ← 一覧に戻る
          </Link>
        }
      />
      <CaseForm />
    </div>
  )
}
