'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Supabase Storage の署名付きURL */
  pdfUrl: string
  alt: string
  /**
   * export=1（Playwright PDF出力時）は true を渡す。
   * useEffect はSSR→headlessでは実行されないため、
   * canvas描画を試みずに最初からフォールバック表示する。
   */
  isExport?: boolean
}

/**
 * PDFの1ページ目をcanvasに描画して表示するClient Component。
 * pdfjs-dist をブラウザ側でのみ動的importする。
 *
 * isExport=true のとき（PDF出力時）は canvas を使わず
 * ファイル名テキストのフォールバックを表示する。
 * これにより PDF出力時に空白になることを防ぐ。
 *
 * DB読み書きなし。既存データへの影響なし。
 */
export function LayoutPdfPreview({ pdfUrl, alt, isExport = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // export=1 のときは描画しない（headless では useEffect が実行されても
    // canvas が正しく機能しないケースがあるため最初から諦める）
    if (isExport) {
      setLoading(false)
      setError(true)
      return
    }

    let cancelled = false

    async function renderPdf() {
      try {
        // pdfjs-dist をブラウザ側でのみ動的 import
        const pdfjsLib = await import('pdfjs-dist')

        // CDN から worker を読み込む（public フォルダへの配置不要）
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        })

        const pdf = await loadingTask.promise
        if (cancelled) return

        // 1ページ目のみ取得・描画
        const page = await pdf.getPage(1)
        if (cancelled) return

        const canvas = canvasRef.current
        if (!canvas) return

        // A4 幅 (794px) に合わせてスケール計算
        const viewport = page.getViewport({ scale: 1 })
        const scale    = 794 / viewport.width
        const scaled   = page.getViewport({ scale })

        canvas.width  = scaled.width
        canvas.height = scaled.height

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise
        if (cancelled) return

        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.warn('[LayoutPdfPreview] render failed:', err)
          setError(true)
          setLoading(false)
        }
      }
    }

    renderPdf()
    return () => { cancelled = true }
  }, [pdfUrl, isExport])

  // フォールバック: エラー時 または isExport=true 時
  if (error) {
    return (
      <div style={{
        border: '0.5pt solid #bbb',
        padding: '10pt 12pt',
        fontSize: '8pt',
        color: '#555',
      }}>
        <div style={{
          display: 'inline-block',
          background: '#e8e8e8',
          color: '#333',
          fontSize: '7pt',
          fontWeight: 600,
          padding: '1pt 5pt',
          borderRadius: '2pt',
          marginBottom: '4pt',
        }}>
          PDF
        </div>
        <div style={{ fontWeight: 600, wordBreak: 'break-all', marginBottom: '2pt' }}>
          {alt}
        </div>
        <div style={{ fontSize: '7pt', color: '#888' }}>
          PDFレイアウト図はシステム上でご確認ください
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* ローディング中オーバーレイ */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f9fafb',
          fontSize: '8pt',
          color: '#888',
        }}>
          Loading PDF...
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          border: '0.5pt solid #ddd',
          display: 'block',
          opacity: loading ? 0 : 1,
        }}
        aria-label={alt}
      />
    </div>
  )
}
