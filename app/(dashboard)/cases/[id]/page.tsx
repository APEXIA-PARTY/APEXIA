import { createClient } from '@/lib/supabase/server'
import { getCurrentUserRole } from '@/lib/auth/helpers'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { CaseDetailBasicInfo } from '@/components/cases/CaseDetail/BasicInfo'
import { CaseDetailTimeline } from '@/components/cases/CaseDetail/Timeline'
import { CaseDetailProcedure } from '@/components/cases/CaseDetail/Procedure'
import { CaseDetailHistory } from '@/components/cases/CaseDetail/History'
import { CaseDeleteButton } from '@/components/cases/CaseDetail/DeleteButton'
import { CaseStatusChanger } from '@/components/cases/CaseDetail/StatusChanger'
import { CaseOptionsSection } from '@/components/cases/CaseDetail/Options'
import { CaseChecklistSection } from '@/components/cases/CaseDetail/Checklist'
import { CaseFilesSection } from '@/components/cases/CaseDetail/Files'
import { CaseHoldLogSection } from '@/components/cases/CaseDetail/HoldLog'
import { formatDate, formatCurrency } from '@/lib/utils/format'
import { CaseStatus } from '@/types/database'
import { GCalButton } from '@/components/cases/CaseDetail/GCalButton'
import Link from 'next/link'
import { Pencil, Lock, FileDown, AlertTriangle } from 'lucide-react'

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 権限取得: admin/staff は編集可、viewer は閲覧のみ
  const role = await getCurrentUserRole()
  const isEditable = role === 'admin' || role === 'staff'
  const appBaseUrl  = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const { data: c, error } = await supabase
    .from('cases')
    .select(`
      *,
      media_master(id, name),
      contact_method_master(id, name),
      floor_master(id, name),
      event_category_master(id, name),
      event_subcategory_master(id, name),
      cancel_reason_master(id, name, is_auto_cancel),
      case_history(*)
    `)
    .eq('id', params.id)
    .single()

  if (error || !c) notFound()

  return (
    <div className="space-y-4 max-w-4xl">
      {/* ヘッダー */}
      <PageHeader
        title={c.company}
        description={`${c.event_name ?? '—'} · 開催: ${formatDate(c.event_date)}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/cases" className="text-sm text-muted-foreground hover:underline">
              ← 一覧
            </Link>
            {/* PDF出力（全ロール） */}
            <Link
              href={`/cases/${params.id}/print`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              <FileDown className="h-3.5 w-3.5" />
              PDF
            </Link>

            {isEditable ? (
              <>
                {/* Googleカレンダー */}
                <GCalButton
                  caseId={params.id}
                  company={c.company}
                  eventName={c.event_name}
                  contact={c.contact}
                  eventDate={c.event_date}
                  startTime={c.start_time}
                  endTime={c.end_time}
                  notes={c.notes}
                  gcalEventId={c.gcal_event_id}
                  appBaseUrl={appBaseUrl}
                  isEditable={isEditable}
                />
                <Link
                  href={`/cases/${params.id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  編集
                </Link>
                <CaseDeleteButton caseId={params.id} company={c.company} />
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />閲覧のみ
              </span>
            )}
          </div>
        }
      />

      {/* ステータス変更 + 金額バー */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4">
        {isEditable ? (
          <CaseStatusChanger
            caseId={params.id}
            currentStatus={c.status as CaseStatus}
            autoCancel={c.auto_cancel}
            currentCancelReasonId={c.cancel_reason_id}
            currentCancelNote={c.cancel_note}
          />
        ) : (
          <div className="flex items-center gap-2">
            {/* viewer は変更ボタンなし、表示のみ */}
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold`}>
              {c.status}
            </span>
          </div>
        )}
        {c.estimate_amount > 0 && (
          <span className="text-lg font-bold text-green-700">
            {formatCurrency(c.estimate_amount)}
          </span>
        )}
      </div>

      {/* キャンセル情報バナー */}
      {c.status === 'cancelled' && (
        <div className={`rounded-lg border px-5 py-3 ${c.auto_cancel ? 'border-orange-300 bg-orange-50' : 'border-destructive/30 bg-destructive/5'}`}>
          <div className="flex items-start gap-2">
            {c.auto_cancel && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />}
            <div>
              <p className={`text-sm font-medium ${c.auto_cancel ? 'text-orange-800' : 'text-destructive'}`}>
                {c.auto_cancel ? '【自動キャンセル】' : 'キャンセル'}
                {' '}理由: {(c.cancel_reason_master as any)?.name ?? '—'}
              </p>
              {c.cancel_note && (
                <p className="mt-1 text-sm text-muted-foreground">{c.cancel_note}</p>
              )}
              {c.auto_cancel && (
                <p className="mt-1 text-xs text-orange-600">
                  開催予定日（{formatDate(c.event_date)}）を過ぎたため自動的にキャンセルされました
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* viewer 向け閲覧専用バナー */}
      {!isEditable && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-xs text-orange-700">
          閲覧専用モードです。編集・追加・削除はできません。
        </div>
      )}

      {/* ① 基本情報 */}
      <CaseDetailBasicInfo caseData={c as any} />

      {/* ② タイムスケジュール */}
      <CaseDetailTimeline caseData={c as any} />

      {/* ③ 確認手続き */}
      <CaseDetailProcedure caseData={c as any} />

      {/* ④ 備品・設備 / ⑤ 機材・オペレーター */}
      <CaseOptionsSection caseId={params.id} isEditable={isEditable} />

      {/* ⑥ 確認事項 */}
      <CaseChecklistSection caseId={params.id} isEditable={isEditable} />

      {/* ⑦ 添付ファイル / ⑧ レイアウト図 */}
      <CaseFilesSection caseId={params.id} isEditable={isEditable} />

      {/* 仮押さえ管理 */}
      <CaseHoldLogSection caseId={params.id} currentStatus={c.status} isEditable={isEditable} />

      {/* 案件履歴 */}
      <CaseDetailHistory history={(c.case_history as any) ?? []} />
    </div>
  )
}
