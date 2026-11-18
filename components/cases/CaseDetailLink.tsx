'use client'

import type { MouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DETAIL_NAV_STORAGE_KEY,
  buildDetailHref,
  createDetailNavRecord,
  serializeDetailNavRecord,
  shouldInterceptClick,
  type DetailNavFrom,
} from '@/lib/utils/detailNavigation'

interface CaseDetailLinkProps {
  caseId: string
  from: DetailNavFrom
  className?: string
  children: ReactNode
}

/**
 * 案件詳細へのリンク（案件一覧・日別問合せ用）。
 *
 * 通常の左クリック／Enter のときだけ、同じタブの sessionStorage へ
 * 「一時番号・案件ID・遷移元種別・元画面の相対URL」を直前の1件だけ保存（既存は上書き）し、
 * /cases/{id}?from=...&nav=... へ移動する。
 * Ctrl・Cmd・Shift・Alt、中・右クリック、target=_blank、ダウンロードでは介入せず、
 * 従来どおり /cases/{id} を開く（新しい戻るボタンは出ない）。
 * 一時番号が作れない・保存に失敗した場合も介入せず、通常どおり移動する。
 */
export function CaseDetailLink({ caseId, from, className, children }: CaseDetailLinkProps) {
  const router = useRouter()

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const anchor = e.currentTarget
    const intercept = shouldInterceptClick(
      {
        button: e.button,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
      },
      { target: anchor.getAttribute('target'), download: anchor.hasAttribute('download') }
    )
    if (!intercept) return

    try {
      const nav = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : ''
      const record = createDetailNavRecord({
        nav,
        caseId,
        from,
        returnUrl: window.location.pathname + window.location.search,
      })
      if (!record) return
      window.sessionStorage.setItem(DETAIL_NAV_STORAGE_KEY, serializeDetailNavRecord(record))
      e.preventDefault()
      router.push(buildDetailHref(caseId, from, nav))
    } catch {
      // 保存できない場合は介入せず、通常のリンクとして移動する
    }
  }

  return (
    <Link href={`/cases/${caseId}`} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
