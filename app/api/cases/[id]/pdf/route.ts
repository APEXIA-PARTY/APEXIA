import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { formatDate, formatTime, formatCurrency } from '@/lib/utils/format'

// Vercel Function タイムアウト
export const maxDuration = 30

type Params = { params: { id: string } }

// ─── ヘルパー: null/undefined を '—' に変換 ─────────────────
function d(v: string | null | undefined): string {
  return v && v.trim() ? v.trim() : '—'
}

// ─── ヘルパー: 長いテキストを指定幅で折り返す ───────────────
function wrapText(text: string, maxChars: number): string[] {
  if (!text || text === '—') return [text || '—']
  const lines: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    lines.push(remaining.slice(0, maxChars))
    remaining = remaining.slice(maxChars)
  }
  return lines
}

export async function GET(request: NextRequest, { params }: Params) {
  // ─── 1. 認証 ─────────────────────────────────────────────
  const { error: authError } = await requireAuth()
  if (authError) return authError

  // ─── 2. 案件データ取得（SELECT のみ・書き込みなし）──────────
  const supabase = await createClient()
  const { data: c, error: dbError } = await supabase
    .from('cases')
    .select(`
      id, company, contact, phone, email,
      inquiry_date, event_date, event_name, guest_count, notes,
      estimate_amount, preview_datetime,
      load_in_time, start_time, end_time, full_exit_time,
      event_subcategory_note,
      media_master(name),
      contact_method_master(name),
      floor_master(name),
      event_category_master(name),
      event_subcategory_master(name)
    `)
    .eq('id', params.id)
    .single()

  if (dbError || !c) {
    return NextResponse.json({ message: '案件が見つかりません' }, { status: 404 })
  }

  // ─── 3. PDF 生成 ─────────────────────────────────────────
  try {
    const pdfDoc = await PDFDocument.create()

    // fontkit を登録して日本語フォントを埋め込む
    pdfDoc.registerFontkit(fontkit)
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf')
    const fontBytes = fs.readFileSync(fontPath)
    const jpFont = await pdfDoc.embedFont(fontBytes)
    const jpFontBold = await pdfDoc.embedFont(fontBytes) // 同フォントを太字代わりに使用

    // ─── 4. ページ設定 ────────────────────────────────────────
    const page   = pdfDoc.addPage([595.28, 841.89]) // A4
    const { width, height } = page.getSize()
    const margin = 50
    const colW   = 130  // ラベル列幅
    const valW   = width - margin * 2 - colW  // 値列幅

    // カラー定義
    const black  = rgb(0.1, 0.1, 0.1)
    const gray   = rgb(0.5, 0.5, 0.5)
    const white  = rgb(1, 1, 1)
    const bgDark = rgb(0.1, 0.1, 0.1)
    const bgGray = rgb(0.94, 0.94, 0.93)
    const border = rgb(0.73, 0.73, 0.73)

    let y = height - margin

    // ─── 5. タイトルヘッダー ──────────────────────────────────
    page.drawRectangle({ x: margin, y: y - 28, width: width - margin * 2, height: 28, color: bgDark })
    page.drawText('APEXIA  イベント確認表', { x: margin + 10, y: y - 20, size: 14, font: jpFont, color: white })
    const issueDate = `発行日: ${formatDate(new Date().toISOString())}`
    page.drawText(issueDate, { x: width - margin - 120, y: y - 20, size: 8, font: jpFont, color: rgb(0.7, 0.7, 0.7) })
    y -= 40

    // ─── 6. セクション描画ヘルパー ───────────────────────────
    const sectionTitle = (title: string) => {
      page.drawRectangle({ x: margin, y: y - 16, width: width - margin * 2, height: 16, color: bgDark })
      page.drawText(title, { x: margin + 6, y: y - 12, size: 8.5, font: jpFont, color: white })
      y -= 20
    }

    // 1行 (label + value) を描画。複数行になる場合は高さを自動拡張
    const drawRow = (label: string, value: string, isLast = false) => {
      const lines = wrapText(value, 36)
      const rowH  = Math.max(18, lines.length * 14)

      // 背景
      page.drawRectangle({ x: margin, y: y - rowH, width: width - margin * 2, height: rowH, color: bgGray })
      // ラベル列区切り線
      page.drawLine({ start: { x: margin + colW, y: y }, end: { x: margin + colW, y: y - rowH }, thickness: 0.5, color: border })
      // 枠線（上）
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: border })
      if (isLast) {
        page.drawLine({ start: { x: margin, y: y - rowH }, end: { x: width - margin, y: y - rowH }, thickness: 0.5, color: border })
      }
      // 左右枠線
      page.drawLine({ start: { x: margin, y }, end: { x: margin, y: y - rowH }, thickness: 0.5, color: border })
      page.drawLine({ start: { x: width - margin, y }, end: { x: width - margin, y: y - rowH }, thickness: 0.5, color: border })

      // ラベルテキスト
      page.drawText(label, { x: margin + 5, y: y - 12, size: 7.5, font: jpFont, color: gray })
      // 値テキスト（複数行）
      lines.forEach((line, i) => {
        page.drawText(line, { x: margin + colW + 5, y: y - 12 - i * 13, size: 8.5, font: jpFont, color: black })
      })

      y -= rowH
    }

    const drawRowLast = (label: string, value: string) => drawRow(label, value, true)

    // ─── 7. ① 基本情報 ────────────────────────────────────────
    sectionTitle('① 基本情報')
    drawRow('会社名 / 団体名', d(c.company))
    drawRow('担当者名', d(c.contact))
    drawRow('電話番号', d(c.phone))
    drawRow('メール', d(c.email))
    drawRow('問合せ日', formatDate(c.inquiry_date))
    drawRow('開催日', formatDate(c.event_date))
    drawRow('イベント名', d(c.event_name))
    drawRow('予定参加人数', c.guest_count ? `${c.guest_count} 名` : '—')
    drawRow('フロア', d((c.floor_master as any)?.name))
    drawRow('イベント大分類', d((c.event_category_master as any)?.name))
    const subName = (c.event_subcategory_master as any)?.name
    const subLabel = subName === 'その他' && c.event_subcategory_note
      ? `その他（${c.event_subcategory_note}）`
      : d(subName)
    drawRow('イベント中分類', subLabel)
    drawRow('認知経路', d((c.media_master as any)?.name))
    drawRowLast('連絡方法', d((c.contact_method_master as any)?.name))

    y -= 8

    // ─── 8. ② タイムスケジュール ─────────────────────────────
    sectionTitle('② タイムスケジュール')
    drawRow('入り時間', c.load_in_time ? formatTime(c.load_in_time) : '—')
    drawRow('開始時間', c.start_time   ? formatTime(c.start_time)   : '—')
    drawRow('終了時間', c.end_time     ? formatTime(c.end_time)     : '—')
    drawRowLast('完全撤収時間', c.full_exit_time ? formatTime(c.full_exit_time) : '—')

    y -= 8

    // ─── 9. ③ 確認手続き ─────────────────────────────────────
    sectionTitle('③ 確認手続き')
    drawRow('下見日時', c.preview_datetime ? c.preview_datetime : '—')
    drawRowLast('見積金額（税込）', c.estimate_amount > 0 ? formatCurrency(c.estimate_amount) : '—')

    y -= 8

    // ─── 10. ④ 備考・注意事項 ────────────────────────────────
    sectionTitle('④ 備考・注意事項')
    if (c.notes) {
      drawRow('備考', c.notes)
    }
    drawRowLast(
      '注意事項',
      'お荷物や機材の搬入出は必ず搬入出届をご提出ください。開始・終了時間は厳守をお願いします。ゴミは必ずお持ち帰りください。'
    )

    // ─── 11. フッター ─────────────────────────────────────────
    const footerY = margin - 10
    const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const caseUrl = `${appUrl}/cases/${c.id}`
    page.drawText(`案件URL: ${caseUrl}`, { x: margin, y: footerY, size: 7, font: jpFont, color: gray })
    page.drawLine({
      start: { x: margin, y: footerY + 10 },
      end:   { x: width - margin, y: footerY + 10 },
      thickness: 0.5,
      color: border,
    })

    // ─── 12. PDF バイト列を取得 ───────────────────────────────
    const pdfBytes = await pdfDoc.save()

    // ─── 13. ファイル名生成 ───────────────────────────────────
    const safeCompany = (c.company ?? 'no-name')
      .replace(/[\/\\:*?"<>|]/g, '')
      .trim()
      .slice(0, 20) || 'no-name'
    const safeDate = c.event_date
      ? new Date(c.event_date).toISOString().slice(0, 10)
      : 'no-date'
    const displayName   = `${safeDate}_${safeCompany}_イベント確認表.pdf`
    const encodedName   = encodeURIComponent(displayName)
    const contentDispos = `attachment; filename="event-confirmation.pdf"; filename*=UTF-8''${encodedName}`

    console.log('[PDF] generated:', displayName, `${pdfBytes.length} bytes`)

    // ─── 14. レスポンス ──────────────────────────────────────
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': contentDispos,
        'Content-Length':      String(pdfBytes.length),
        'Cache-Control':       'no-store',
        'X-Filename':          encodedName,
      },
    })

  } catch (err) {
    console.error('[PDF] generation error:', err)
    return NextResponse.json(
      { message: 'PDF の生成に失敗しました。' },
      { status: 500 }
    )
  }
}
