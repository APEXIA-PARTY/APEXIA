'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'

type Variant = 'thumb' | 'modal' | 'print'

interface Props {
  url: string
  fileName?: string
  variant?: Variant
}

export function PdfPageCanvas({ url, fileName, variant = 'thumb' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let loadingTask: any = null

    const render = async () => {
      try {
        setLoading(true)
        setError(false)

        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()

        loadingTask = pdfjsLib.getDocument(url)
        const pdf = await loadingTask.promise
        const page = await pdf.getPage(1)

        const baseViewport = page.getViewport({ scale: 1 })

        const targetWidth =
          variant === 'thumb' ? 320 : variant === 'modal' ? 1400 : 1100

        const scale = targetWidth / baseViewport.width
        const viewport = page.getViewport({ scale })

        if (cancelled || !canvasRef.current) return

        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) return

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({
          canvasContext: context,
          viewport,
        }).promise

        if (!cancelled) setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    void render()

    return () => {
      cancelled = true
      try {
        loadingTask?.destroy?.()
      } catch { }
    }
  }, [url, variant])

  if (loading) {
    return (
      <div
        className={
          variant === 'thumb'
            ? 'flex h-56 w-full items-center justify-center bg-white'
            : 'flex min-h-[60vh] w-full items-center justify-center bg-white p-4'
        }
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={
          variant === 'thumb'
            ? 'flex h-56 w-full flex-col items-center justify-center gap-2 bg-white px-4 text-center'
            : 'flex min-h-[60vh] w-full flex-col items-center justify-center gap-2 bg-white p-6 text-center'
        }
      >
        <FileText className="h-10 w-10 text-red-500" />
        <p className="text-sm text-muted-foreground">PDFを表示できません</p>
        {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
      </div>
    )
  }

  return (
    <div
      className={
        variant === 'thumb'
          ? 'flex h-56 w-full items-center justify-center bg-white p-2'
          : 'flex w-full items-center justify-center bg-white p-4'
      }
    >
      <canvas
        ref={canvasRef}
        className={
          variant === 'thumb'
            ? 'block max-h-full max-w-full object-contain border border-border bg-white'
            : 'block h-auto max-w-full border border-border bg-white'
        }
      />
    </div>
  )
}