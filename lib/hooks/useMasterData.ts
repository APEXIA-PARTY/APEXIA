'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

export interface MasterItem {
  id: string
  name: string
  display_order: number
  is_active: boolean
  [key: string]: unknown
}

interface UseMasterDataOptions {
  apiPath: string          // 例: '/api/master/media'
  queryParams?: string     // 例: '?category_id=xxx'
}

/**
 * マスタデータの取得・追加・更新・並び替え・無効化を扱う共通フック
 */
export function useMasterData<T extends MasterItem>({ apiPath, queryParams = '' }: UseMasterDataOptions) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── 取得（有効・無効すべて取得） ─────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // マスタ管理画面では無効レコードも表示するため all=true
      const res = await fetch(`${apiPath}?all=true${queryParams ? '&' + queryParams.replace(/^\?/, '') : ''}`)
      if (!res.ok) throw new Error('データ取得に失敗しました')
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiPath, queryParams])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ─── 追加 ─────────────────────────────────────────────────
  const create = async (values: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<boolean> => {
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '追加に失敗しました')
        return false
      }
      toast.success('追加しました')
      await fetchAll()
      return true
    } catch {
      toast.error('追加に失敗しました')
      return false
    }
  }

  // ─── 更新 ─────────────────────────────────────────────────
  const update = async (id: string, values: Partial<T>): Promise<boolean> => {
    try {
      const res = await fetch(`${apiPath}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '更新に失敗しました')
        return false
      }
      toast.success('更新しました')
      await fetchAll()
      return true
    } catch {
      toast.error('更新に失敗しました')
      return false
    }
  }

  // ─── 無効化トグル ─────────────────────────────────────────
  const toggleActive = async (item: T): Promise<void> => {
    const next = !item.is_active
    const ok = await update(item.id, { is_active: next } as Partial<T>)
    if (ok) {
      toast.success(next ? '有効にしました' : '無効にしました')
    }
  }

  // ─── 並び替え（ドラッグ後に呼ぶ） ─────────────────────────
  const reorder = async (reordered: T[]): Promise<void> => {
    // 楽観的更新
    setItems(reordered)
    try {
      // PATCH /api/master/{table} で並び替えを送信
      // （PUT は /api/master/{table}/{id} の単件更新に使うため PATCH を使用）
      const res = await fetch(apiPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: reordered.map((it, idx) => ({ id: it.id, display_order: idx })),
        }),
      })
      if (!res.ok) {
        toast.error('並び替えの保存に失敗しました')
        await fetchAll() // ロールバック
      }
    } catch {
      toast.error('並び替えの保存に失敗しました')
      await fetchAll()
    }
  }

  return { items, loading, error, fetchAll, create, update, toggleActive, reorder }
}
