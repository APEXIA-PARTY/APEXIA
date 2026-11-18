'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DETAIL_NAV_STORAGE_KEY, resolveBackTarget } from '@/lib/utils/detailNavigation'

interface BackToPreviousButtonProps {
  caseId: string
  from: string | undefined
  nav: string | undefined
}

/**
 * 「← 前の画面に戻る」。案件一覧／日別問合せから通常クリック・Enter で開いた場合だけ表示する。
 *
 * URL の from・nav、sessionStorage の記録（一時番号・案件ID・遷移元種別）がすべて一致し、
 * 記録の元画面URLが検証に合格したときだけ表示する。押すと記録を削除してから、
 * 検証済みのURLへ router.replace() で直接戻る（router.back() は使わない）。
 * 条件を満たさない場合・保存を読み取れない場合は何も表示しない（既存の「← 一覧」だけが残る）。
 * 判定失敗の内容や元画面URLは、画面にもログにも出さない。
 */
export function BackToPreviousButton({ caseId, from, nav }: BackToPreviousButtonProps) {
  const router = useRouter()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    let raw: string | null = null
    try {
      raw = window.sessionStorage.getItem(DETAIL_NAV_STORAGE_KEY)
    } catch {
      raw = null
    }
    setTarget(resolveBackTarget({ urlFrom: from, urlNav: nav, pageCaseId: caseId, rawRecord: raw }))
  }, [caseId, from, nav])

  if (!target) return null

  const handleClick = () => {
    try {
      window.sessionStorage.removeItem(DETAIL_NAV_STORAGE_KEY)
    } catch {
      // 削除できなくても戻る動作は続ける
    }
    router.replace(target)
  }

  return (
    <button type="button" onClick={handleClick} className="text-sm text-muted-foreground hover:underline">
      ← 前の画面に戻る
    </button>
  )
}
