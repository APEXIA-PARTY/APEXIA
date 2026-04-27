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
  year?: string
  month?: string
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const page        = Number(searchParams.page ?? 1)
  const pageSize    = 20
  const sortBy      = (searchParams.sortBy as string) || 'inquiry_date'
  const sortOrder   = searchParams.sortOrder === 'asc'
  const from        = (page - 1) * pageSize
  const to          = from + pageSize - 1

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
  if (searchParams.status)   query = query.eq('status', searchParams.status as CaseStatus)
  if (searchParams.media_id) query = query.eq('media_id', searchParams.media_id)
  if (searchParams.floor_id) query = query.eq('floor_id', searchParams.floor_id)
  // inquiry_date が null のレコードを除外（年フィルターが機能するように）
  // month 単独指定は year がないと無効なので、year がある場合のみ除外する
  if (searchParams.year) {
    query = query.not('inquiry_date', 'is', null)
  }

  // 年・月フィルター（inquiry_date ベース）
  // month は year が選択されている場合のみ有効。year 未選択の month は無視する。
  if (searchParams.year) {
    const y = searchParams.year
    if (searchParams.month) {
      const m = searchParams.month.padStart(2, '0')
      const lastDay = new Date(Number(y), Number(searchParams.month), 0).getDate()
      query = query
        .gte('inquiry_date', `${y}-${m}-01`)
        .lte('inquiry_date', `${y}-${m}-${String(lastDay).padStart(2, '0')}`)
    } else {
      query = query
        .gte('inquiry_date', `${y}-01-01`)
        .lte('inquiry_date', `${y}-12-31`)
    }
  }

  // ソート・ページング
  query = query.order(sortBy, { ascending: sortOrder }).range(from, to)

  const { data, count } = await query
const cases = data ?? []

  // マスタ（フィルター用）
  const [{ data: mediaList = [] }, { data: floorList = [] }] = await Promise.all([
    supabase.from('media_master').select('id, name').eq('is_active', true).order('display_order'),
    supabase.from('floor_master').select('id, name').eq('is_active', true).order('display_order'),
  ])

  // 年選択肢: 現在年から過去5年を固定生成（DB全件取得しない）
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 5 }, (_, i) => String(currentYear - i))

  const totalPages = Math.ceil((count ?? 0) / pageSize)

  // URL 生成ヘルパー
  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    const merged = {
      search:   searchParams.search,
      status:   searchParams.status,
      media_id: searchParams.media_id,
      floor_id: searchParams.floor_id,
      year:     searchParams.year,
      month:    searchParams.month,
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
        description={(() => {
          const filterLabel = [
            searchParams.year   ? `${searchParams.year}年`           : '',
            searchParams.month  ? `${Number(searchParams.month)}月`  : '',
            searchParams.status ?? '',
            searchParams.media_id
              ? ((mediaList as any[]).find((m: any) => m.id === searchParams.media_id)?.name ?? '')
              : '',
          ].filter(Boolean).join(' / ')
          return filterLabel
            ? `${filterLabel}：${count ?? 0}件`
            : `全 ${count ?? 0} 件`
        })()}
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
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="search"
              defaultValue={searchParams.search}
              placeholder="会社名・担当者・イベント名"
              className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {/* 年 */}
          <select
            name="year"
            defaultValue={searchParams.year ?? ''}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[100px]"
          >
            <option value="">全年</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          {/* 月 */}
          <select
            name="month"
            defaultValue={searchParams.month ?? ''}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[90px]"
          >
            <option value="">全月</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={String(m).padStart(2, '0')}>{m}月</option>
            ))}
          </select>
          {/* ステータス */}
          <select
            name="status"
            defaultValue={searchParams.status ?? ''}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[130px]"
          >
            <option value="">全ステータス</option>
            {STATUS_LIST.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {/* 認知経路 */}
          <select
            name="media_id"
            defaultValue={searchParams.media_id ?? ''}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[140px]"
          >
            <option value="">全認知経路</option>
            {(mediaList as any[]).map((m: any) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {/* フロア */}
          <select
            name="floor_id"
            defaultValue={searchParams.floor_id ?? ''}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">全フロア</option>
            {(floorList ?? []).map((f: any) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
          >
            <SlidersHorizontal className="h-4 w-4" />
            絞り込み
          </button>
          <Link href="/cases" className="text-sm text-muted-foreground hover:underline py-2">
            クリア
          </Link>
        </form>
      </div>

      {/* ソートバー */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>並び替え:</span>
        {[
          { key: 'inquiry_date', label: '問合せ日' },
          { key: 'event_date',   label: '開催日' },
          { key: 'updated_at',   label: '更新日' },
          { key: 'estimate_amount', label: '見積金額' },
        ].map((s) => {
          const isActive = sortBy === s.key
          const nextOrder = isActive && !sortOrder ? 'asc' : 'desc'
          return (
            <a
              key={s.key}
              href={buildUrl({ sortBy: s.key, sortOrder: nextOrder, page: '1' })}
              className={`rounded px-2 py-1 transition-colors hover:bg-muted ${
                isActive ? 'bg-muted font-medium text-foreground' : ''
              }`}
            >
              {s.label}
              {isActive && (sortOrder ? ' ↑' : ' ↓')}
            </a>
          )
        })}
      </div>

      {/* テーブル */}
      {/* スマホ: カード表示 / PC: テーブル表示 */}

      {/* ── スマホ用カードリスト (sm未満) ── */}
      <div className="sm:hidden">
        {cases.length === 0 ? (
          <div className="rounded-lg border border-border bg-card py-16 text-center text-muted-foreground">
            <p className="text-sm">条件に合う案件がありません</p>
            <Link href="/cases/new" className="mt-2 inline-block text-sm text-primary hover:underline">
              新規案件を登録する →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {cases.map((c: any) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="block rounded-lg border border-border bg-card p-4 active:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-foreground leading-snug">{c.company}</p>
                  <StatusBadge status={c.status as CaseStatus} autoCancel={c.auto_cancel} size="sm" />
                </div>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-1">{c.event_name || '—'}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">開催: {formatDate(c.event_date)}</p>
                  <p className="text-xs font-medium tabular-nums">
                    {c.estimate_amount > 0 ? formatCurrency(c.estimate_amount) : '—'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── PC用テーブル (sm以上) ── */}
      <div className="hidden sm:block rounded-lg border border-border bg-card overflow-hidden">
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
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/cases/${c.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {c.company}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.event_name || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(c.event_date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.contact || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status as CaseStatus} autoCancel={c.auto_cancel} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.media_master?.name || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {c.estimate_amount > 0 ? formatCurrency(c.estimate_amount) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
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
            <Link href={buildUrl({ page: String(page - 1) })} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted">
              前へ
            </Link>
          )}
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link href={buildUrl({ page: String(page + 1) })} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted">
              次へ
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
