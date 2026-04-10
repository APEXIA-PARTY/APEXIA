'use client'

import { useState, useEffect } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils/format'

interface HoldLog {
  id: string
  hold_date: string | null
  release_date: string | null
  memo: string | null
  created_at: string
}

interface CaseHoldLogSectionProps {
  caseId: string
  currentStatus: string
  isEditable?: boolean
}

const INP = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const LBL = 'block text-xs text-muted-foreground mb-1.5 font-medium'

export function CaseHoldLogSection({ caseId, currentStatus, isEditable = true }: CaseHoldLogSectionProps) {
  const [log, setLog]         = useState<HoldLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({ hold_date: '', release_date: '', memo: '' })

  const fetchLog = async () => {
    const res = await fetch(`/api/cases/${caseId}/hold`)
    if (res.ok) {
      const data = await res.json()
      setLog(data)
      if (data) setForm({
        hold_date:    data.hold_date    ?? '',
        release_date: data.release_date ?? '',
        memo:         data.memo         ?? '',
      })
    }
    setLoading(false)
  }

  useEffect(() => { fetchLog() }, [caseId])

  const handleCreate = async () => {
    if (!form.hold_date) { toast.error('仮押さえ日を入力してください'); return }
    setSaving(true)
    const res = await fetch(`/api/cases/${caseId}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hold_date: form.hold_date, memo: form.memo || null }),
    })
    if (res.ok) {
      await fetchLog()
      toast.success('仮押さえを登録しました')
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err.message ?? '登録に失敗しました')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    setSaving(true)
    const res = await fetch(`/api/cases/${caseId}/hold`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hold_date:    form.hold_date    || null,
        release_date: form.release_date || null,
        memo:         form.memo         || null,
      }),
    })
    if (res.ok) {
      await fetchLog()
      toast.success('仮押さえ情報を更新しました')
    } else {
      toast.error('更新に失敗しました')
    }
    setSaving(false)
  }

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-muted/40" />

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">仮押さえ管理</h2>
        {log && (
          <span className="ml-auto inline-flex items-center rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-xs text-orange-700">
            登録済み
          </span>
        )}
      </div>
      <div className="p-5">
        {/* 未登録 + 仮押さえステータス以外は注意文言 */}
        {!log && currentStatus !== 'tentative' && (
          <p className="mb-4 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            ステータスが「仮押さえ」の案件で仮押さえ日を記録できます
          </p>
        )}

        {/* viewer は表示のみ（登録・更新不可） */}
        {!isEditable && !log && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            仮押さえ情報はまだ登録されていません
          </p>
        )}

        {/* viewer かつ log がある場合: 表示のみ */}
        {!isEditable && log && (
          <dl className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className={LBL}>仮押さえ日</dt>
              <dd className="font-medium">{log.hold_date ? formatDate(log.hold_date) : '—'}</dd>
            </div>
            <div>
              <dt className={LBL}>解除日</dt>
              <dd className="font-medium">{log.release_date ? formatDate(log.release_date) : '—'}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className={LBL}>メモ</dt>
              <dd className="font-medium">{log.memo || '—'}</dd>
            </div>
          </dl>
        )}

        {/* admin/staff: 編集フォーム */}
        {isEditable && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={LBL}>仮押さえ日</label>
                <input
                  type="date"
                  className={INP}
                  value={form.hold_date}
                  onChange={e => setForm(p => ({ ...p, hold_date: e.target.value }))}
                  disabled={!!log && !!log.hold_date}
                />
              </div>
              <div>
                <label className={LBL}>解除日</label>
                <input
                  type="date"
                  className={INP}
                  value={form.release_date}
                  onChange={e => setForm(p => ({ ...p, release_date: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-3">
                <label className={LBL}>メモ</label>
                <input
                  className={INP}
                  value={form.memo}
                  onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
                  placeholder="メモ・備考"
                />
              </div>
            </div>

            {/* 制約説明 */}
            {log && (
              <p className="mt-2 text-xs text-muted-foreground">
                ※ 仮押さえ日は1案件につき1回のみ登録できます。登録後は変更できません。
              </p>
            )}

            <div className="mt-4 flex items-center gap-3">
              {!log ? (
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  仮押さえを登録
                </button>
              ) : (
                <button
                  onClick={handleUpdate}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  更新
                </button>
              )}

              {log && (
                <div className="text-xs text-muted-foreground">
                  登録日: {formatDate(log.created_at)}
                  {log.hold_date && ` · 仮押さえ: ${formatDate(log.hold_date)}`}
                  {log.release_date && ` · 解除: ${formatDate(log.release_date)}`}
                </div>
              )}
            </div>
          </>
        )}

        {/* viewer: 登録日などのメタ情報だけ表示 */}
        {!isEditable && log && (
          <p className="mt-3 text-xs text-muted-foreground">
            登録日: {formatDate(log.created_at)}
          </p>
        )}
      </div>
    </section>
  )
}
