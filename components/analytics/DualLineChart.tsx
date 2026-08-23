'use client'

import { useEffect, useRef } from 'react'

interface DualLineChartProps {
  /** 12ヶ月分。data[0] = 1月 ... data[11] = 12月 */
  data: { label: string; current: number; previous: number }[]
  maxY: number
}

/**
 * 開催月分析専用の2系列折れ線グラフ（当年・前年）。
 * 既存の app/(dashboard)/analytics/page.tsx 内の BarLineChart / RevenueLineChart は
 * 一切変更せず、それらと同じ Canvas 直描画パターンを踏襲した別コンポーネントとして新規作成。
 * 新しいグラフライブラリは追加していない。
 */
export function DualLineChart({ data, maxY }: DualLineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    canvas.width = W
    canvas.height = H
    ctx.clearRect(0, 0, W, H)
    if (data.length === 0) return

    const pad = { top: 20, right: 20, bottom: 32, left: 44 }
    const cW = W - pad.left - pad.right
    const cH = H - pad.top - pad.bottom
    const gap = cW / (data.length - 1 || 1)
    const scale = maxY > 0 ? cH / maxY : 1

    // Y軸ガイドライン
    ctx.strokeStyle = '#f0efec'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + cH - (cH / 4) * i
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(pad.left + cW, y)
      ctx.stroke()
    }

    const drawLine = (key: 'current' | 'previous', color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      data.forEach((d, i) => {
        const x = pad.left + gap * i
        const y = pad.top + cH - d[key] * scale
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()

      data.forEach((d, i) => {
        const x = pad.left + gap * i
        const y = pad.top + cH - d[key] * scale
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      })
    }

    // 前年（薄い色）を先に、当年（濃い色）を後に重ねて描画
    drawLine('previous', '#93c5fd')
    drawLine('current', '#4472C4')

    // X軸ラベル
    ctx.fillStyle = '#888'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    data.forEach((d, i) => {
      ctx.fillText(d.label, pad.left + gap * i, H - 6)
    })

    // Y軸ラベル（件数）
    ctx.textAlign = 'right'
    ctx.fillStyle = '#aaa'
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((maxY / 4) * i)
      const y = pad.top + cH - (cH / 4) * i
      ctx.fillText(String(v), pad.left - 6, y + 4)
    }
  }, [data, maxY])

  return <canvas ref={canvasRef} className="w-full" style={{ height: 200 }} />
}
