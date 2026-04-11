import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { CaseForm } from '@/components/cases/CaseForm'
import Link from 'next/link'

export default async function EditCasePage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: caseData, error } = await supabase
    .from('cases')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !caseData) notFound()

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title={`案件編集: ${caseData.company}`}
        actions={
          <Link href={`/cases/${params.id}`} className="text-sm text-muted-foreground hover:underline">
            ← 詳細に戻る
          </Link>
        }
      />
      <CaseForm initialData={caseData} isEdit />
    </div>
  )
}
