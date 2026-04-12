import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  TrendingUp,
  Users,
  CheckCircle,
  XCircle,
  DollarSign,
  BarChart2,
  AlertTriangle,
  Calendar,
} from 'lucide-react'

import { PageHeader } from '@/components/layout/PageHeader'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { StatusBadge } from '@/components/cases/StatusBadge'
import { AutoCancelButton } from '@/components/dashboard/AutoCancelButton'
import { getCurrentUserRole } from '@/lib/auth/helpers'
import {
  formatDate,
  formatCurrency,
  formatCurrencyShort,
  formatDateTime,
} from '@/lib/utils/format'
import {
  calcKpi,
  filterByMonth,
  filterByYear,
  CaseRow,
  REVENUE_STATUSES,
} from '@/lib/utils/analytics'
import { CaseStatus } from '@/types/database'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const role = await getCurrentUserRole()
  const isAdmin = role === 'admin'
  const now = new Date()
  const thisMonth = format(now, 'yyyy-MM')
  const thisYear = format(now, 'yyyy')
  const today = format(now, 'yyyy-MM-dd')

  // 全案件取得（軽量）
  const { data: allCases = [] } = await supabase
    .from('cases')
    .select(
      'id,status,auto_cancel,has_previewed,estimate_amount,inquiry_date,event_date,company,event_name,media_id,event_category_id,event_subcategory_id,contact_method_id,floor_id,updated_at,cancel_reason_id,cancel_note'
    )

  const rows = (allCases as CaseRow[]) ?? []
  const monthRows = filterByMonth(rows, thisMonth)
  const yearRows = filterByYear(rows, thisYear)
  const mk = calcKpi(monthRows)
  const yk = calcKpi(yearRows)
  const autoTotal = rows.filter((c) => c.status === 'cancelled' && c.auto_cancel).length

  // 月別推移（当年）
  const monthlyTrend = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    const key = `${thisYear}-${m}`
    const mc = filterByMonth(rows, key)
    const kpi = calcKpi(mc)

    return {
      label: `${i + 1}月`,
      inquiry: kpi.inquiry,
      confirmed: kpi.confirmed,
      revenue: kpi.revenue,
    }
  })

  const maxInquiry = Math.max(...monthlyTrend.map((m) => m.inquiry), 1)

  // 直近の確定・仮押さえ
  const { data: upcomingCases = [] } = await supabase
    .from('cases')
    .select('id,company,event_name,event_date,start_time,status')
    .in('status', ['confirmed', 'tentative'])
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(5)

  // 最近の更新
  const { data: recentCases = [] } = await supabase
    .from('cases')
    .select('id,company,event_name,event_date,status,auto_cancel,estimate_amount,updated_at')
    .order('updated_at', { ascending: false })
    .limit(8)

  // ランキング
  const { data: mediaList = [] } = await supabase
    .from('media_master')
    .select('id,name')
    .eq('is_active', true)

  const mediaRank = ((mediaList ?? []) as any[])
    .map((m) => ({
      id: m.id,
      name: m.name,
      revenue: rows
        .filter((c) => c.media_id === m.id && REVENUE_STATUSES.includes(c.status))
        .reduce((sum, c) => sum + (c.estimate_amount ?? 0), 0),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)
    .filter((m) => m.revenue > 0)

  const { data: categoryList = [] } = await supabase
    .from('event_category_master')
    .select('id,name')
    .eq('is_active', true)

  const categoryRank = ((categoryList ?? []) as any[])
    .map((c) => ({
      id: c.id,
      name: c.name,
      revenue: rows
        .filter((r) => r.event_category_id === c.id && REVENUE_STATUSES.includes(r.status))
        .reduce((sum, r) => sum + (r.estimate_amount ?? 0), 0),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)
    .filter((c) => c.revenue > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="ダッシュボード"
        description={`${format(now, 'yyyy年M月d日')} 現在`}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && <AutoCancelButton />}
            <Link
              href="/cases/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              + 新規問合せ
            </Link>
          </div>
        }
      />

      {/* KPIカード（当月） */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          当月実績（{format(now, 'M月')}）
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-12">
          <KpiCard label="問合せ件数" value={mk.inquiry} icon={Users} color="blue" />
          <KpiCard label="下見件数" value={mk.preview} icon={Calendar} color="purple" />
          <KpiCard label="→下見率" value={`${mk.previewRate}%`} icon={TrendingUp} color="purple" />
          <KpiCard label="確定件数" value={mk.confirmed} icon={CheckCircle} color="green" />
          <KpiCard label="キャンセル" value={mk.cancelManual + mk.cancelAuto} icon={XCircle} color="red" />
          <KpiCard label="下見前ｷｬﾝ" value={mk.cancelBeforePreview} icon={XCircle} color="red" />
          <KpiCard label="下見後ｷｬﾝ" value={mk.cancelAfterPreview} icon={XCircle} color="red" />
          <KpiCard label="確定売上" value={formatCurrencyShort(mk.revenue)} icon={DollarSign} color="green" />
          <KpiCard
            label="平均単価"
            value={mk.avgPrice > 0 ? formatCurrencyShort(mk.avgPrice) : '—'}
            icon={BarChart2}
            color="blue"
          />
          <KpiCard label="→確定率" value={`${mk.cvRate}%`} icon={TrendingUp} color="orange" />
          <KpiCard
            label="年間売上"
            value={formatCurrencyShort(yk.revenue)}
            sub={`確定${yk.confirmed}件`}
            icon={TrendingUp}
            color="green"
          />
          <KpiCard label="自動ｷｬﾝ累計" value={autoTotal} icon={AlertTriangle} color="red" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 月別推移グラフ */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">月別 問合せ・確定件数推移（{thisYear}年）</h2>
          <div className="flex h-36 items-end gap-1.5">
            {monthlyTrend.map((m) => (
              <div key={m.label} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="flex w-full flex-col-reverse gap-0.5">
                  <div
                    className="min-h-[2px] w-full rounded-t bg-blue-200"
                    style={{ height: `${(m.inquiry / maxInquiry) * 120}px` }}
                    title={`問合せ ${m.inquiry}件`}
                  />
                  <div
                    className="min-h-[2px] w-full rounded-t bg-primary/80"
                    style={{ height: `${(m.confirmed / maxInquiry) * 120}px` }}
                    title={`確定 ${m.confirmed}件`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-blue-200" />
              問合せ
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded bg-primary/80" />
              確定
            </span>
          </div>
        </div>

        {/* 直近の確定案件 */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">直近の確定・仮押さえ</h2>
          {(upcomingCases as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">該当案件なし</p>
          ) : (
            <ul className="space-y-2">
              {((upcomingCases ?? []) as any[]).map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className="block rounded-md p-2 hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.company}</span>
                      <StatusBadge status={c.status as CaseStatus} size="sm" />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(c.event_date)}
                      {c.start_time ? ` ${c.start_time.slice(0, 5)}〜` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/cases?status=confirmed" className="mt-3 block text-xs text-primary hover:underline">
            全件を見る →
          </Link>
        </div>
      </div>

      {/* ランキング */}
      {(mediaRank.length > 0 || categoryRank.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { title: '認知経路別 売上 TOP3', data: mediaRank },
            { title: 'イベント分類別 売上 TOP3', data: categoryRank },
          ].map(({ title, data }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-4">
              <p className="mb-3 text-sm font-semibold">{title}</p>
              {data.length === 0 ? (
                <p className="text-sm text-muted-foreground">データなし</p>
              ) : (
                data.map((r, i) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between border-b border-border py-1.5 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                          }`}
                      >
                        {i + 1}
                      </span>
                      <span className="max-w-[140px] truncate text-sm">{r.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-green-700">
                      {formatCurrencyShort(r.revenue)}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {/* 最近の更新案件 */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">最近の更新案件</h2>
          <Link href="/cases" className="text-xs text-primary hover:underline">
            一覧を見る →
          </Link>
        </div>
        <div className="divide-y divide-border">
          {(recentCases as any[]).length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">案件がありません</p>
          ) : (
            ((recentCases ?? []) as any[]).map((c) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.company}</span>
                    <StatusBadge status={c.status as CaseStatus} autoCancel={c.auto_cancel} size="sm" />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.event_name || '—'} · 開催: {formatDate(c.event_date)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {c.estimate_amount > 0 && (
                    <p className="text-sm font-semibold text-green-700">
                      {formatCurrency(c.estimate_amount)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDateTime(c.updated_at)}</p>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}