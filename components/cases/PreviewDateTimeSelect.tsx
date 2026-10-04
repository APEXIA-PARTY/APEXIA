'use client'

import { useEffect, useState } from 'react'

// 時・分を別セレクトで実装する 15 分刻みセレクタ共通定数（CaseForm の TimeSelect と共用）
export const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
export const MINUTES = ['00', '15', '30', '45']

// ─── 下見日時セレクタ（日付 + 時・分15分刻み） ────────────────────
interface DateTimeSelectProps {
  value: string | undefined
  onChange: (v: string) => void
}

export function PreviewDateTimeSelect({ value, onChange }: DateTimeSelectProps) {
  const datePart = value?.slice(0, 10) ?? ''
  const timePart = value?.slice(11, 16) ?? ''
  const timeH = timePart.slice(0, 2) || ''
  const timeM = timePart.slice(3, 5) || '00'

  const [localH, setLocalH] = useState(timeH)
  const [localM, setLocalM] = useState(MINUTES.includes(timeM) ? timeM : '00')

  useEffect(() => {
    const h = value?.slice(11, 13) ?? ''
    const m = value?.slice(14, 16) ?? '00'
    setLocalH(h)
    setLocalM(MINUTES.includes(m) ? m : '00')
  }, [value])

  const emit = (d: string, h: string, mi: string) => {
    if (!d) { onChange(''); return }
    if (!h) { onChange(d); return }
    onChange(`${d}T${h}:${mi}`)
  }

  const inp = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
  const sel = `${inp} cursor-pointer`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={datePart}
        onChange={(e) => { emit(e.target.value, localH, localM) }}
        className={`${inp} w-40`}
      />
      <div className="flex items-center gap-1">
        <select value={localH} onChange={(e) => { setLocalH(e.target.value); emit(datePart, e.target.value, localM) }} className={`${sel} w-20`}>
          <option value="">--時</option>
          {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="text-muted-foreground text-sm">:</span>
        <select value={localM} onChange={(e) => { setLocalM(e.target.value); emit(datePart, localH, e.target.value) }} disabled={!localH} className={`${sel} w-16`}>
          {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  )
}
