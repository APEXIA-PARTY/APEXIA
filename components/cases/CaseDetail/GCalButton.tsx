'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatTime } from '@/lib/utils/format'

interface Props {
  caseId:        string
  company:       string
  eventName:     string | null
  contact:       string | null
  eventDate:     string | null
  startTime:     string | null
  endTime:       string | null
  notes:         string | null
  gcalEventId:   string | null   // 登録済みの場合はイベントID
  appBaseUrl:    string           // 案件詳細URL生成用
  isEditable:    boolean          // admin/staff のみ操作可
}

/**
 * Google Calendar 登録 / 再登録ボタン
 *
 * 実装方式: Google Calendar URL スキーム
 * - OAuth 認証不要
 * - ユーザーのカレンダーに直接登録（確認ダイアログあり）
 * - gcal_event_id の「登録済みフラグ」を手動で設定可能
 */
export function GCalButton({
  caseId, company, eventName, contact, eventDate,
  startTime, endTime, notes, gcalEventId, appBaseUrl, isEditable,
}: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Google Calendar URL を構築
  const buildGCalUrl = (): string => {
    const title = [company, eventName].filter(Boolean).join(' ')

    // 日付・時間を Google Calendar 形式に変換 (YYYYMMDDTHHmmss)
    let dates = ''
    if (eventDate && startTime && endTime) {
      const d  = eventDate.replace(/-/g, '')
      const st = startTime.replace(':', '').slice(0, 4).padEnd(4, '0') + '00'
      const et = endTime.replace(':', '').slice(0, 4).padEnd(4, '0') + '00'
      dates = `${d}T${st}/${d}T${et}`
    } else if (eventDate) {
      const d = eventDate.replace(/-/g, '')
      dates = `${d}/${d}`
    }

    // 案件詳細URL（カレンダーの説明欄に記載）
    const detailUrl = `${appBaseUrl}/cases/${caseId}`

    const description = [
      `会社名: ${company}`,
      contact    ? `担当者: ${contact}` : null,
      eventName  ? `イベント名: ${eventName}` : null,
      startTime  ? `時間: ${formatTime(startTime)}〜${formatTime(endTime)}` : null,
      notes      ? `備考: ${notes}` : null,
      '',
      '▼ 案件詳細（APEXIA）',
      detailUrl,
    ].filter(s => s !== null).join('\n')

    return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + `&text=${encodeURIComponent(title)}`
      + `&dates=${dates}`
      + `&details=${encodeURIComponent(description)}`
  }

  // カレンダーを開く
  const handleOpen = () => {
    const url = buildGCalUrl()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // 登録済みフラグをDBに保存（URL を開いた後にユーザーが登録したことを記録）
  const handleMarkAsRegistered = async () => {
    setSaving(true)
    try {
      // gcal_event_id に "registered" をセット（実際のイベントIDは取得不可）
      const caseRes = await fetch(`/api/cases/${caseId}`)
      if (!caseRes.ok) { toast.error('案件情報の取得に失敗しました'); return }
      const currentData = await caseRes.json().catch(() => null)
      if (!currentData) { toast.error('案件情報の取得に失敗しました'); return }
      const { media_master, contact_method_master, floor_master, event_category_master,
              event_subcategory_master, cancel_reason_master, case_options, case_checklist,
              case_files, case_hold_logs, case_history, ...caseFields } = currentData
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...caseFields, gcal_event_id: 'registered' }),
      })
      if (!res.ok) { toast.error('登録状態の保存に失敗しました'); return }
      toast.success('Googleカレンダーへの登録を記録しました')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const handleClearFlag = async () => {
    if (!window.confirm('カレンダー登録済みフラグを解除しますか？')) return
    setSaving(true)
    try {
      const caseRes2 = await fetch(`/api/cases/${caseId}`)
      if (!caseRes2.ok) { toast.error('案件情報の取得に失敗しました'); return }
      const currentData2 = await caseRes2.json().catch(() => null)
      if (!currentData2) { toast.error('案件情報の取得に失敗しました'); return }
      const { media_master: _m, contact_method_master: _c, floor_master: _f,
              event_category_master: _ec, event_subcategory_master: _es,
              cancel_reason_master: _cr, case_options: _co, case_checklist: _cl,
              case_files: _cf, case_hold_logs: _ch, case_history: _hi, ...caseFields2 } = currentData2
      await fetch(`/api/cases/${caseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...caseFields2, gcal_event_id: null }),
      })
      toast.success('登録済みフラグを解除しました')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (!isEditable) return null

  return (
    <div className="flex items-center gap-2">
      {/* Googleカレンダーを開くボタン */}
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-md bg-[#4285F4] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        title={gcalEventId ? 'Googleカレンダーに再登録' : 'Googleカレンダーに登録'}
      >
        <Calendar className="h-3.5 w-3.5" />
        {gcalEventId ? '再登録' : 'Gカレンダー'}
      </button>

      {/* 登録済みフラグ */}
      {gcalEventId ? (
        <button
          onClick={handleClearFlag}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-50"
          title="登録済みフラグを解除"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          登録済み
        </button>
      ) : (
        <button
          onClick={handleMarkAsRegistered}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          title="登録済みとしてマーク"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          登録済みにする
        </button>
      )}
    </div>
  )
}
