'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { TrendingUp, BarChart2, Users, Calendar, XCircle, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// ─── フォーマットユーティリティ ────────────────────────────────
const fmtYen  = (v: number) => v >= 10000 ? `¥${Math.round(v / 10000)}万` : `¥${v.toLocaleString()}`
const fmtNum  = (v: number) => v.toLocaleString()
const fmtPct  = (v: number) => `${v}%`
const fmtYoY  = (v: number | null) => v === null ? '—' : v >= 100 ? `▲${v - 100}%` : `▼${100 - v}%`

// ─── 共通テーブルスタイル ──────────────────────────────────────
const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={cn('whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-muted-foreground', right ? 'text-right' : 'text-left')}>
    {children}
  </th>
)
const TD = ({ children, right, bold, color }: { children: React.ReactNode; right?: boolean; bold?: boolean; color?: string }) => (
  <td className={cn('whitespace-nowrap px-3 py-2.5 text-sm', right ? 'text-right tabular-nums' : '', bold ? 'font-semibold' : '', color ?? '')}>
    {children}
  </td>
)

// ─── シンプル棒グラフ（Canvas不要） ───────────────────────────
function MiniBar({ value, max, color = 'bg-primary' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  )
}

// ─── タブ ──────────────────────────────────────────────────────
const TABS = [
  { key: 'monthly',         label: '月別' },
  { key: 'yearly',          label: '年別' },
  { key: 'media',           label: '認知経路' },
  { key: 'event-categories',label: 'イベント分類' },
  { key: 'floors',          label: 'フロア' },
  { key: 'contact-methods', label: '連絡方法' },
  { key: 'cancel-reasons',  label: 'キャンセル理由' },
  { key: 'options',         label: 'オプション' },
] as const
type TabKey = typeof TABS[number]['key']

// ─── グラフコンポーネント（Canvas） ───────────────────────────
function BarLineChart({ data, maxY }: {
  data: { label: string; bar: number; line: number }[]
  maxY: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.offsetWidth; const H = canvas.offsetHeight
    canvas.width = W; canvas.height = H
    ctx.clearRect(0, 0, W, H)
    if (data.length === 0) return

    const pad = { top: 20, right: 20, bottom: 32, left: 52 }
    const cW = W - pad.left - pad.right
    const cH = H - pad.top  - pad.bottom
    const bW = (cW / data.length) * 0.5
    const bGap = cW / data.length

    const scale = maxY > 0 ? cH / maxY : 1

    // Y軸ガイドライン
    ctx.strokeStyle = '#f0efec'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + cH - (cH / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
    }

    // 棒グラフ（問合せ件数）
    data.forEach((d, i) => {
      const x = pad.left + bGap * i + (bGap - bW) / 2
      const h = d.bar * scale
      ctx.fillStyle = '#93c5fd'
      ctx.beginPath(); ctx.roundRect(x, pad.top + cH - h, bW, h, [3, 3, 0, 0]); ctx.fill()
    })

    // 折れ線グラフ（確定件数）
    ctx.strokeStyle = '#4472C4'; ctx.lineWidth = 2; ctx.beginPath()
    data.forEach((d, i) => {
      const x = pad.left + bGap * i + bGap / 2
      const y = pad.top + cH - d.line * scale
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    // 点
    data.forEach((d, i) => {
      const x = pad.left + bGap * i + bGap / 2
      const y = pad.top + cH - d.line * scale
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#4472C4'; ctx.fill()
    })

    // X軸ラベル
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    data.forEach((d, i) => {
      ctx.fillText(d.label, pad.left + bGap * i + bGap / 2, H - 6)
    })

    // Y軸ラベル（件数）
    ctx.textAlign = 'right'; ctx.fillStyle = '#aaa'
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((maxY / 4) * i)
      const y = pad.top + cH - (cH / 4) * i
      ctx.fillText(String(v), pad.left - 6, y + 4)
    }
  }, [data, maxY])

  return <canvas ref={canvasRef} className="w-full" style={{ height: 180 }} />
}

function RevenueLineChart({ data, maxY }: { data: { label: string; value: number }[]; maxY: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.offsetWidth; const H = canvas.offsetHeight
    canvas.width = W; canvas.height = H; ctx.clearRect(0, 0, W, H)
    if (data.length === 0 || maxY === 0) return

    const pad = { top: 20, right: 20, bottom: 32, left: 68 }
    const cW = W - pad.left - pad.right; const cH = H - pad.top - pad.bottom
    const gap = cW / (data.length - 1 || 1); const scale = maxY > 0 ? cH / maxY : 1

    ctx.strokeStyle = '#f0efec'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) { const y = pad.top + cH - (cH / 4) * i; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke() }

    // グラデーション塗り
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH)
    grad.addColorStop(0, 'rgba(68,114,196,0.3)'); grad.addColorStop(1, 'rgba(68,114,196,0)')
    ctx.beginPath()
    data.forEach((d, i) => { const x = pad.left + gap * i; const y = pad.top + cH - d.value * scale; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.lineTo(pad.left + gap * (data.length - 1), pad.top + cH); ctx.lineTo(pad.left, pad.top + cH); ctx.closePath(); ctx.fillStyle = grad; ctx.fill()

    // 線
    ctx.strokeStyle = '#4472C4'; ctx.lineWidth = 2; ctx.beginPath()
    data.forEach((d, i) => { const x = pad.left + gap * i; const y = pad.top + cH - d.value * scale; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.stroke()

    // ラベル
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    data.forEach((d, i) => { ctx.fillText(d.label, pad.left + gap * i, H - 6) })

    ctx.textAlign = 'right'; ctx.fillStyle = '#aaa'
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((maxY / 4) * i); const y = pad.top + cH - (cH / 4) * i
      ctx.fillText(v >= 10000 ? `${Math.round(v / 10000)}万` : String(v), pad.left - 6, y + 4)
    }
  }, [data, maxY])
  return <canvas ref={canvasRef} className="w-full" style={{ height: 160 }} />
}

// ─── 各タブの集計テーブル ──────────────────────────────────────

function MonthlyTab({ year, onYearChange, years }: { year: string; onYearChange: (y: string) => void; years: string[] }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics/monthly?year=${year}`)
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [year])

  if (loading || !data) return <LoadingBlock />

  const monthly = data.monthly ?? []
  const maxInquiry = Math.max(...monthly.map((m: any) => m.inquiry), 1)
  const maxRevenue = Math.max(...monthly.map((m: any) => m.revenue), 1)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">対象年:</span>
        <select className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={year} onChange={e => onYearChange(e.target.value)}>
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
          <option value={new Date().getFullYear().toString()}>{new Date().getFullYear()}年</option>
        </select>
      </div>

      {/* グラフ2つ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">月別 問合せ / 確定件数</span>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-blue-200" />問合せ</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded bg-primary" />確定</span>
            </div>
          </div>
          <BarLineChart data={monthly.map((m: any) => ({ label: m.label, bar: m.inquiry, line: m.confirmed }))} maxY={maxInquiry} />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="text-sm font-semibold">月別 確定売上推移</span>
          <RevenueLineChart data={monthly.map((m: any) => ({ label: m.label, value: m.revenue }))} maxY={maxRevenue} />
        </div>
      </div>

      {/* テーブル */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40">
              <TH>月</TH><TH right>問合せ</TH><TH right>下見</TH><TH right>確定</TH>
              <TH right>ｷｬﾝｾﾙ(手)</TH><TH right>ｷｬﾝｾﾙ(自)</TH>
              <TH right>見積合計</TH><TH right>確定売上</TH><TH right>平均単価</TH>
              <TH right>→下見率</TH><TH right>→確定率</TH>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {monthly.filter((m: any) => m.inquiry > 0 || m.cancelManual > 0 || m.cancelAuto > 0).map((m: any) => (
                <tr key={m.month} className="hover:bg-muted/20">
                  <TD bold>{m.label}</TD>
                  <TD right>{fmtNum(m.inquiry)}</TD>
                  <TD right color="text-purple-600">{fmtNum(m.preview)}</TD>
                  <TD right bold color="text-green-700">{fmtNum(m.confirmed)}</TD>
                  <TD right color="text-red-500">{m.cancelManual}</TD>
                  <TD right color="text-red-800">{m.cancelAuto}</TD>
                  <TD right color="text-orange-600">{m.estimateTotal > 0 ? fmtYen(m.estimateTotal) : '—'}</TD>
                  <TD right bold color="text-green-700">{m.revenue > 0 ? fmtYen(m.revenue) : '—'}</TD>
                  <TD right>{m.avgPrice > 0 ? fmtYen(m.avgPrice) : '—'}</TD>
                  <TD right>{fmtPct(m.previewRate)}</TD>
                  <TD right bold>{fmtPct(m.cvRate)}</TD>
                </tr>
              ))}
              {/* 合計行 */}
              {data.total && (<tr className="border-t-2 border-border bg-muted/40 font-semibold">
                <TD bold>合計</TD>
                <TD right>{fmtNum(data.total.inquiry)}</TD>
                <TD right color="text-purple-600">{fmtNum(data.total.preview)}</TD>
                <TD right color="text-green-700">{fmtNum(data.total.confirmed)}</TD>
                <TD right color="text-red-500">{data.total.cancelManual}</TD>
                <TD right color="text-red-800">{data.total.cancelAuto}</TD>
                <TD right color="text-orange-600">{fmtYen(data.total.estimateTotal)}</TD>
                <TD right bold color="text-green-700">{fmtYen(data.total.revenue)}</TD>
                <TD right>{data.total.avgPrice > 0 ? fmtYen(data.total.avgPrice) : '—'}</TD>
                <TD right>{fmtPct(data.total.previewRate)}</TD>
                <TD right bold>{fmtPct(data.total.cvRate)}</TD>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function YearlyTab() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch('/api/analytics/yearly').then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false) }).catch(() => setLoading(false)) }, [])
  if (loading || !data) return <LoadingBlock />
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-muted/40">
            <TH>年</TH><TH right>問合せ</TH><TH right>下見</TH><TH right>確定</TH>
            <TH right>ｷｬﾝ(手)</TH><TH right>ｷｬﾝ(自)</TH>
            <TH right>確定売上</TH><TH right>平均単価</TH>
            <TH right>前年比(件)</TH><TH right>前年比(売上)</TH>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {(data.yearly ?? []).map((y: any) => (
              <tr key={y.year} className="hover:bg-muted/20">
                <TD bold>{y.year}年</TD>
                <TD right>{fmtNum(y.inquiry)}</TD>
                <TD right color="text-purple-600">{fmtNum(y.preview)}</TD>
                <TD right bold color="text-green-700">{fmtNum(y.confirmed)}</TD>
                <TD right color="text-red-500">{y.cancelManual}</TD>
                <TD right color="text-red-800">{y.cancelAuto}</TD>
                <TD right bold color="text-green-700">{fmtYen(y.revenue)}</TD>
                <TD right>{y.avgPrice > 0 ? fmtYen(y.avgPrice) : '—'}</TD>
                <TD right color={y.yoyInquiry === null ? '' : y.yoyInquiry >= 100 ? 'text-green-600' : 'text-red-500'}>{fmtYoY(y.yoyInquiry)}</TD>
                <TD right color={y.yoyRevenue === null ? '' : y.yoyRevenue >= 100 ? 'text-green-600' : 'text-red-500'}>{fmtYoY(y.yoyRevenue)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GenericMasterTab({ apiPath, label, columns }: {
  apiPath: string
  label: string
  columns: { key: string; label: string; right?: boolean; fmt?: (v: any) => string; color?: string }[]
}) {
  const [data, setData]   = useState<any>(null)
  const [year, setYear]   = useState(new Date().getFullYear().toString())
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${apiPath}?year=${year}`).then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [apiPath, year])

  useEffect(() => { load() }, [load])

  if (loading || !data) return <LoadingBlock />

  const maxInquiry = Math.max(...(data.rows ?? []).map((r: any) => r.inquiry ?? r.count ?? 0), 1)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">年度:</span>
        <select className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={year} onChange={e => setYear(e.target.value)}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>

      {/* 横棒グラフ */}
      {(data.rows ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <span className="mb-3 block text-sm font-semibold">{label}別 問合せ件数</span>
          <div className="space-y-2">
            {(data.rows ?? []).slice(0, 12).map((r: any) => (
              <div key={r.id} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{r.name}</span>
                <MiniBar value={r.inquiry ?? r.count ?? 0} max={maxInquiry} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* テーブル */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40">
              <TH>{label}</TH>
              {columns.map(c => <TH key={c.key} right={c.right}>{c.label}</TH>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(data.rows ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <TD>{r.name}</TD>
                  {columns.map(c => (
                    <TD key={c.key} right={c.right} color={c.color}>
                      {c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? '—')}
                    </TD>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function EventCategoriesTab() {
  const [data, setData]     = useState<any>(null)
  const [year, setYear]     = useState(new Date().getFullYear().toString())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics/event-categories?year=${year}`)
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [year])

  if (loading || !data) return <LoadingBlock />

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">年度:</span>
        <select className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={year} onChange={e => setYear(e.target.value)}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40">
              <TH>分類</TH><TH right>問合せ</TH><TH right>割合</TH>
              <TH right>確定</TH><TH right>確定割合</TH><TH right>確定売上</TH><TH right>平均単価</TH><TH right>CV率</TH>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(data.rows ?? []).map((r: any) => (
                <>
                  <tr key={r.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => toggleExpand(r.id)}>
                    <TD><span className="flex items-center gap-1">{r.subcategories?.length > 0 && <span className="text-muted-foreground">{expanded.has(r.id) ? '▼' : '▶'}</span>}<span className="font-medium">{r.name}</span></span></TD>
                    <TD right>{fmtNum(r.inquiry)}</TD>
                    <TD right>{fmtPct(r.inquiryShare)}</TD>
                    <TD right bold color="text-green-700">{fmtNum(r.confirmed)}</TD>
                    <TD right>{fmtPct(r.confirmShare)}</TD>
                    <TD right color="text-green-700">{r.revenue > 0 ? fmtYen(r.revenue) : '—'}</TD>
                    <TD right>{r.avgPrice > 0 ? fmtYen(r.avgPrice) : '—'}</TD>
                    <TD right bold>{fmtPct(r.cvRate)}</TD>
                  </tr>
                  {expanded.has(r.id) && (r.subcategories ?? []).map((s: any) => (
                    <tr key={s.id} className="bg-muted/20">
                      <TD><span className="ml-6 text-muted-foreground">└ {s.name}</span></TD>
                      <TD right>{fmtNum(s.inquiry)}</TD><TD right>{fmtPct(s.inquiryShare)}</TD>
                      <TD right>{fmtNum(s.confirmed)}</TD><TD right>{fmtPct(s.confirmShare)}</TD>
                      <TD right>{s.revenue > 0 ? fmtYen(s.revenue) : '—'}</TD>
                      <TD right>{s.avgPrice > 0 ? fmtYen(s.avgPrice) : '—'}</TD>
                      <TD right>{fmtPct(s.cvRate)}</TD>
                    </tr>
                  ))}
                  {expanded.has(r.id) && (r.subcategories ?? []).some((s: any) => s.otherNotes?.length > 0) && (
                    <tr key={`${r.id}-notes`}><td colSpan={8} className="px-6 py-2 bg-yellow-50">
                      <span className="text-xs text-yellow-800 font-medium">「その他」自由入力: </span>
                      <span className="text-xs text-yellow-700">{(r.subcategories ?? []).flatMap((s: any) => s.otherNotes ?? []).join(' / ')}</span>
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CancelReasonsTab() {
  const [data, setData] = useState<any>(null)
  const [year, setYear] = useState(new Date().getFullYear().toString())
  const [loading, setLoading] = useState(true)
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics/cancel-reasons?year=${year}`)
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [year])

  if (loading || !data) return <LoadingBlock />
  const allNotes = (data.rows ?? []).flatMap((r: any) => (r.notes ?? []).map((n: any) => ({ ...n, reason: r.name })))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">年度:</span>
        <select className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={year} onChange={e => setYear(e.target.value)}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <span className="text-sm text-muted-foreground">合計キャンセル: {data.totalCancel}件（手動 {data.manualCancel} / 自動 {data.autoCancel}）</span>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40"><TH>理由</TH><TH right>件数</TH><TH right>割合</TH><TH>種別</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {(data.rows ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <TD>{r.name}</TD>
                  <TD right bold>{r.count}</TD>
                  <TD right>{fmtPct(r.share)}</TD>
                  <TD>{r.is_auto_cancel && <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700">自動専用</span>}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {allNotes.length > 0 && (
        <>
          <button onClick={() => setShowNotes(n => !n)} className="text-sm text-primary hover:underline">
            {showNotes ? '▲ 備考を閉じる' : `▼ キャンセル備考一覧を見る（${allNotes.length}件）`}
          </button>
          {showNotes && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border bg-muted/40"><TH>会社名</TH><TH>理由</TH><TH>問合せ日</TH><TH>備考</TH></tr></thead>
                  <tbody className="divide-y divide-border">
                    {allNotes.map((n: any, i: number) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <TD>{n.company}</TD><TD>{n.reason}</TD>
                        <TD>{n.date ?? '—'}</TD><TD>{n.note ?? '—'}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OptionsTab() {
  const [data, setData]   = useState<any>(null)
  const [year, setYear]   = useState(new Date().getFullYear().toString())
  const [category, setCat] = useState<'equipment' | 'machine'>('equipment')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics/options?year=${year}&category=${category}`)
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [year, category])

  if (loading || !data) return <LoadingBlock />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">年度:</span>
        <select className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" value={year} onChange={e => setYear(e.target.value)}>
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-1">
          {(['equipment', 'machine'] as const).map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', category === c ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {c === 'equipment' ? '備品・設備' : '機材・オペレーター'}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/40">
              <TH>オプション名</TH><TH right>使用件数</TH><TH right>売上合計</TH>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(data.rows ?? []).length === 0 ? (
                <tr><td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">データがありません</td></tr>
              ) : (data.rows ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <TD>{r.name}{r.machine_category && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">{r.machine_category}</span>}</TD>
                  <TD right bold>{r.useCount}</TD>
                  <TD right color="text-green-700">{r.revenue > 0 ? fmtYen(r.revenue) : '—'}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function LoadingBlock() {
  return <div className="h-48 animate-pulse rounded-lg bg-muted/40" />
}

// ─── メインページ ──────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tab, setTab]   = useState<TabKey>('monthly')
  const [year, setYear] = useState(new Date().getFullYear().toString())
  const [summary, setSummary] = useState<any>(null)

  // 全体KPI
  useEffect(() => {
    fetch('/api/analytics/dashboard').then(r => r.ok ? r.json() : null).then(d => { if (d) setSummary(d) }).catch(() => {})
  }, [])

  const mk = summary?.kpi?.thisMonth
  const yk = summary?.kpi?.thisYear

  const KPI = ({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className={cn('h-4 w-4 shrink-0', color)} />
      </div>
      <p className={cn('mt-2 text-xl font-bold tabular-nums', color)}>{value}</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader title="分析・集計" description="問合せ・売上・媒体・分類ごとの集計データ" />

      {/* KPIカード（当月） */}
      {mk && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">当月KPI（{new Date().getMonth() + 1}月）</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
            <KPI label="問合せ"    value={fmtNum(mk.inquiry)}   icon={Users}       color="text-blue-600" />
            <KPI label="下見"      value={fmtNum(mk.preview)}   icon={Calendar}    color="text-purple-600" />
            <KPI label="確定"      value={fmtNum(mk.confirmed)} icon={TrendingUp}  color="text-green-700" />
            <KPI label="キャンセル" value={fmtNum(mk.cancelManual + mk.cancelAuto)} icon={XCircle} color="text-red-500" />
            <KPI label="確定売上"  value={fmtYen(mk.revenue)}   icon={DollarSign}  color="text-green-700" />
            <KPI label="平均単価"  value={mk.avgPrice > 0 ? fmtYen(mk.avgPrice) : '—'} icon={BarChart2} color="text-blue-600" />
            <KPI label="→確定率"  value={fmtPct(mk.cvRate)}     icon={TrendingUp}  color="text-orange-600" />
            <KPI label="年間売上"  value={yk ? fmtYen(yk.revenue) : '—'} icon={DollarSign} color="text-green-700" />
            <KPI label="自動ｷｬﾝ累計" value={fmtNum(mk.autoCancelTotal ?? 0)} icon={XCircle} color="text-red-800" />
          </div>
        </div>
      )}

      {/* ランキング */}
      {summary?.rankings && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[{ key: 'mediaRevenue', title: '認知経路別 売上 TOP3' }, { key: 'categoryRevenue', title: 'イベント分類別 売上 TOP3' }].map(({ key, title }) => (
            <div key={key} className="rounded-lg border border-border bg-card p-4">
              <p className="mb-3 text-sm font-semibold">{title}</p>
              {(summary.rankings[key] ?? []).map((r: any, i: number) => (
                <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white', i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-400')}>{i + 1}</span>
                    <span className="text-sm">{r.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-green-700">{fmtYen(r.revenue)}</span>
                </div>
              ))}
              {(summary.rankings[key] ?? []).length === 0 && <p className="text-sm text-muted-foreground">データなし</p>}
            </div>
          ))}
        </div>
      )}

      {/* タブ集計 */}
      <div>
        <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-muted/20 p-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === t.key ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'monthly'          && <MonthlyTab year={year} onYearChange={setYear} years={Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i))} />}
        {tab === 'yearly'           && <YearlyTab />}
        {tab === 'media'            && <GenericMasterTab apiPath="/api/analytics/media" label="認知経路" columns={[
          { key: 'inquiry', label: '問合せ', right: true, fmt: fmtNum },
          { key: 'inquiryShare', label: '割合', right: true, fmt: fmtPct },
          { key: 'preview',  label: '下見', right: true, fmt: fmtNum },
          { key: 'confirmed', label: '確定', right: true, fmt: fmtNum, color: 'text-green-700' },
          { key: 'confirmShare', label: '確定割合', right: true, fmt: fmtPct },
          { key: 'revenue', label: '確定売上', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—', color: 'text-green-700' },
          { key: 'avgPrice', label: '平均単価', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—' },
          { key: 'cvRate', label: 'CV率', right: true, fmt: fmtPct },
          { key: 'monthly_cost', label: '月額費用', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—' },
          { key: 'costPerConfirmed', label: '1件コスト', right: true, fmt: (v: number | null) => v ? fmtYen(v) : '—' },
        ]} />}
        {tab === 'event-categories' && <EventCategoriesTab />}
        {tab === 'floors'           && <GenericMasterTab apiPath="/api/analytics/floors" label="フロア" columns={[
          { key: 'inquiry', label: '問合せ', right: true, fmt: fmtNum },
          { key: 'inquiryShare', label: '割合', right: true, fmt: fmtPct },
          { key: 'confirmed', label: '確定', right: true, fmt: fmtNum, color: 'text-green-700' },
          { key: 'confirmShare', label: '確定割合', right: true, fmt: fmtPct },
          { key: 'revenue', label: '確定売上', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—', color: 'text-green-700' },
          { key: 'avgPrice', label: '平均単価', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—' },
        ]} />}
        {tab === 'contact-methods'  && <GenericMasterTab apiPath="/api/analytics/contact-methods" label="連絡方法" columns={[
          { key: 'inquiry', label: '問合せ', right: true, fmt: fmtNum },
          { key: 'inquiryShare', label: '割合', right: true, fmt: fmtPct },
          { key: 'preview', label: '下見', right: true, fmt: fmtNum },
          { key: 'previewShare', label: '下見割合', right: true, fmt: fmtPct },
          { key: 'confirmed', label: '確定', right: true, fmt: fmtNum, color: 'text-green-700' },
          { key: 'confirmShare', label: '確定割合', right: true, fmt: fmtPct },
          { key: 'revenue', label: '確定売上', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—', color: 'text-green-700' },
          { key: 'avgPrice', label: '平均単価', right: true, fmt: (v: number) => v > 0 ? fmtYen(v) : '—' },
        ]} />}
        {tab === 'cancel-reasons'   && <CancelReasonsTab />}
        {tab === 'options'          && <OptionsTab />}
      </div>
    </div>
  )
}
