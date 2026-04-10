import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/cases/StatusBadge'
import { formatDate, formatCurrency, formatDateTime } from '@/lib/utils/format'
import { STATUS_LIST } from '@/lib/constants/status'
import { CaseStatus } from '@/types/database'
import { Search, Plus, SlidersHorizontal } from 'lucide-react'

interface SearchParams {
  search?: string
  status?: string
  media_id?: string
  floor_id?: string
  page?: string
  sortBy?: string
  sortOrder?: string
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const page = Number(searchParams.page ?? 1)
  const pageSize = 20
  const sortBy = (searchParams.sortBy as string) || 'inquiry_date'
  const sortOrder = searchParams.sortOrder === 'asc'
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // ベースクエリ
  let query = supabase
    .from('cases')
    .select(
      `id, company, contact, event_name, event_date, inquiry_date,
       status, auto_cancel, estimate_amount, updated_at,
       media_master(name), floor_master(name)`,
      { count: 'exact' }
    )

  // フィルター
  if (searchParams.search) {
    const s = searchParams.search
    query = query.or(`company.ilike.%${s}%,contact.ilike.%${s}%,event_name.ilike.%${s}%`)
  }

  if (searchParams.status) query = query.eq('status', searchParams.status as CaseStatus)
  if (searchParams.media_id) query = query.eq('media_id', searchParams.media_id)
  if (searchParams.floor_id) query = query.eq('floor_id', searchParams.floor_id)

  // ソート・ページング
  query = query.order(sortBy, { ascending: sortOrder }).range(from, to)

  const { data: casesRaw, count } = await query

  // マスタ（フィルター用）
  const [{ data: mediaListRaw }, { data: floorListRaw }] = await Promise.all([
    supabase.from('media_master').select('id, name').eq('is_active', true).order('display_order'),
    supabase.from('floor_master').select('id, name').eq('is_active', true).order('display_order'),
  ])

  // null安全化
  const cases = Array.isArray(casesRaw) ? casesRaw : []
  const mediaList = Array.isArray(mediaListRaw) ? mediaListRaw : []
  const floorList = Array.isArray(floorListRaw) ? floorListRaw : []

  const totalPages = Math.ceil((count ?? 0) / pageSize)

  // URL 生成ヘルパー
  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    const merged = {
      search: searchParams.search,
      status: searchParams.status,
      media_id: searchParams.media_id,
      floor_id: searchParams.floor_id,
      sortBy,
      sortOrder: sortOrder ? 'asc' : 'desc',
      ...overrides,
    }

    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v)
    })

    return `/cases?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="案件一覧"
        description={`全 ${count ?? 0} 件`}
        actions={
          <Link
            href="/cases/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            新規登録
          </Link>
        }
      />

      {/* フィルターバー */}
      <div className="rounded-lg border border-border bg-card p-4">
        <form method="GET" action="/cases" className="flex flex-wrap items-end gap-3">
          {/* 検索 */}
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="search"
              defaultValue={searchParams.search}
              placeholder="会社名・担当者・イベント名"
              className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* ステータス */}
          <select
            name="status"
            defaultValue={searchParams.status ?? ''}
            className="min-w-[130px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">全ステータス</option>
            {STATUS_LIST.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* 媒体 */}
          <select
            name="media_id"
            defaultValue={searchParams.media_id ?? ''}
            className="min-w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">全認知経路</option>
            {mediaList.map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          {/* フロア */}
          <select
            name="floor_id"
            defaultValue={searchParams.floor_id ?? ''}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">全フロア</option>
            {floorList.map((f: any) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
          >
            <SlidersHorizontal className="h-4 w-4" />
            絞り込み
          </button>

          <a href="/cases" className="py-2 text-sm text-muted-foreground hover:underline">
            クリア
          </a>
        </form>
      </div>

      {/* ソートバー */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>並び替え:</span>
        {[
          { key: 'inquiry_date', label: '問合せ日' },
          { key: 'event_date', label: '開催日' },
          { key: 'updated_at', label: '更新日' },
          { key: 'estimate_amount', label: '見積金額' },
        ].map((s) => {
          const isActive = sortBy === s.key
          const nextOrder = isActive && !sortOrder ? 'asc' : 'desc'

          return (
            <a
              key={s.key}
              href={buildUrl({ sortBy: s.key, sortOrder: nextOrder, page: '1' })}
              className={`rounded px-2 py-1 transition-colors hover:bg-muted ${isActive ? 'bg-muted font-medium text-foreground' : ''
                }`}
            >
              {s.label}
              {isActive && (sortOrder ? ' ↑' : ' ↓')}
            </a>
          )
        })}
      </div>

      {/* テーブル */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {cases.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <p className="text-sm">条件に合う案件がありません</p>
            <Link href="/cases/new" className="mt-2 inline-block text-sm text-primary hover:underline">
              新規案件を登録する →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">会社名</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">イベント名</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">開催日</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">担当者</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">ステータス</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">認知経路</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-muted-foreground">見積金額</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">最終更新</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cases.map((c: any) => (
                  <tr key={c.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cases/${c.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {c.company}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.event_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDate(c.event_date)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.contact || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status as CaseStatus} autoCancel={c.auto_cancel} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.media_master?.name || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {c.estimate_amount > 0 ? formatCurrency(c.estimate_amount) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(c.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <a
              href={buildUrl({ page: String(page - 1) })}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              前へ
            </a>
          )}
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={buildUrl({ page: String(page + 1) })}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              次へ
            </a>
          )}
        </div>
      )}
    </div>
  )
}