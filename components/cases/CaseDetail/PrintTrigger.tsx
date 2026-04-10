'use client'

import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'

/**
 * 印刷専用ページのトリガーコンポーネント
 * URL に ?print=1 が付いていれば自動で window.print() を実行する
 */
export function PrintTrigger() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
    // ?print=1 パラメータがあれば自動印刷
    const params = new URLSearchParams(window.location.search)
    if (params.get('print') === '1') {
      // レンダリング完了を待ってから印刷
      const timer = setTimeout(() => window.print(), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
    >
      <Printer className="h-4 w-4" />
      印刷 / PDF保存
    </button>
  )
}
