'use client'

import { useState } from 'react'

interface EventDateFilterFieldsProps {
  yearOptions: string[]
  defaultYear: string
  defaultMonth: string
}

/**
 * 案件一覧の「開催年」「開催月」フィルター。
 * 開催年が未選択（全年）の間は開催月を選択できないようにする
 * （全年＋月指定という紛らわしい組み合わせでの検索を防ぐため）。
 */
export function EventDateFilterFields({
  yearOptions,
  defaultYear,
  defaultMonth,
}: EventDateFilterFieldsProps) {
  const [year, setYear] = useState(defaultYear)

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] leading-none text-muted-foreground">開催年</span>
        <select
          name="year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[100px]"
        >
          <option value="">全年</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] leading-none text-muted-foreground">開催月</span>
        <select
          name="month"
          defaultValue={defaultMonth}
          disabled={!year}
          title={!year ? '開催年を選択すると指定できます' : undefined}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[90px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">全月</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={String(m).padStart(2, '0')}>{m}月</option>
          ))}
        </select>
      </div>
    </>
  )
}
