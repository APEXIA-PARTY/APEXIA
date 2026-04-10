import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { CaseForm } from '@/components/cases/CaseForm'

export default async function NewCasePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="space-y-6">
      <PageHeader
        title="新規問合せ登録"
        description="案件情報を入力して登録します"
      />

      <CaseForm />
    </div>
  )
}