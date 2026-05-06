import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { formatDate, formatTime, formatCurrency } from '@/lib/utils/format'

export const maxDuration = 30

type Params = { params: { id: string } }

function d(v: string | null | undefined): string {
  return v && v.trim() ? v.trim() : '—'
}

// ─── テキストを折り返す（元の改行を尊重し、長い行のみ maxChars で折り返す）
function wrapText(text: string, maxChars: number): string[] {
  if (!text || text === '—') return [text || '—']
  const result: string[] = []
  // 元テキストの改行で分割
  const paragraphs = text.split(/\r?\n/)
  for (const para of paragraphs) {
    if (para.length === 0) {
      // 空行はそのまま保持
      result.push('')
      continue
    }
    // 段落が maxChars 以内なら1行
    if (para.length <= maxChars) {
      result.push(para)
    } else {
      // maxChars を超える場合だけ折り返す
      let rem = para
      while (rem.length > 0) {
        result.push(rem.slice(0, maxChars))
        rem = rem.slice(maxChars)
      }
    }
  }
  return result.length > 0 ? result : ['—']
}

export async function GET(request: NextRequest, { params }: Params) {
  // ─── 1. 認証 ───────────────────────────────────────────────
  const { error: authError } = await requireAuth()
  if (authError) return authError

  // ─── 2. 案件データ取得（SELECT のみ） ──────────────────────
  const supabase = await createClient()
  const { data: c, error: dbError } = await supabase
    .from('cases')
    .select(`
      id, company, contact, phone, email,
      inquiry_date, event_date, event_name, guest_count, notes,
      estimate_amount, preview_datetime, food_plans,
      load_in_time, start_time, end_time, full_exit_time,
      application_form_status, delivery_notice_status,
      invoice_status, payment_method,
      media_master(name),
      floor_master(name),
      case_options(
        id, name, category, machine_category,
        qty, unit_price, amount, unit, state, sort_order
      ),
      case_checklist(id, item, state, sort_order)
    `)
    .eq('id', params.id)
    .single()

  if (dbError || !c) {
    return NextResponse.json({ message: '案件が見つかりません' }, { status: 404 })
  }

  const allOptions   = ((c.case_options as any[]) ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
  const equipment    = allOptions.filter((o: any) => o.category === 'equipment')
  const machines     = allOptions.filter((o: any) => o.category === 'machine')
  const checklist    = ((c.case_checklist as any[]) ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)

  // ─── 3. PDF 生成 ───────────────────────────────────────────
  try {
    const pdfDoc = await PDFDocument.create()
    pdfDoc.registerFontkit(fontkit)
    const fontPath  = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf')
    const fontBytes = fs.readFileSync(fontPath)
    const jpFont    = await pdfDoc.embedFont(fontBytes)

    // ─── レイアウト定数 ──────────────────────────────────────
    const PAGE_W    = 595.28
    const PAGE_H    = 841.89
    const MARGIN    = 50
    const COL_W     = 130   // ラベル列幅
    const BODY_W    = PAGE_W - MARGIN * 2
    const FOOTER_H  = 30    // フッター確保分
    const MIN_Y     = MARGIN + FOOTER_H

    // カラー
    const black  = rgb(0.1, 0.1, 0.1)
    const gray   = rgb(0.5, 0.5, 0.5)
    const white  = rgb(1, 1, 1)
    const bgDark = rgb(0.1, 0.1, 0.1)
    const bgGray = rgb(0.94, 0.94, 0.93)
    const bgTh   = rgb(0.88, 0.88, 0.87)   // テーブルヘッダー背景
    const border = rgb(0.73, 0.73, 0.73)

    // ─── ページ管理 ──────────────────────────────────────────
    let pages = [pdfDoc.addPage([PAGE_W, PAGE_H])]
    let y = PAGE_H - MARGIN

    // 現在のページを返す
    const cur = () => pages[pages.length - 1]

    // 必要に応じてページを追加し y をリセット
    const ensureSpace = (needed: number) => {
      if (y - needed < MIN_Y) {
        drawFooter(cur())
        const newPage = pdfDoc.addPage([PAGE_W, PAGE_H])
        pages.push(newPage)
        y = PAGE_H - MARGIN
      }
    }

    // フッター描画（区切り線のみ・URL非表示）
    const drawFooter = (pg: ReturnType<typeof pdfDoc.addPage>) => {
      const fy = MARGIN - 10
      pg.drawLine({ start: { x: MARGIN, y: fy + 10 }, end: { x: PAGE_W - MARGIN, y: fy + 10 }, thickness: 0.5, color: border })
    }

    // ─── タイトルヘッダー ─────────────────────────────────────
    cur().drawRectangle({ x: MARGIN, y: y - 28, width: BODY_W, height: 28, color: bgDark })
    cur().drawText('APEXIA  イベント確認表', { x: MARGIN + 10, y: y - 20, size: 14, font: jpFont, color: white })
    cur().drawText(`発行日: ${formatDate(new Date().toISOString())}`, { x: PAGE_W - MARGIN - 120, y: y - 20, size: 8, font: jpFont, color: rgb(0.7, 0.7, 0.7) })
    y -= 40

    // ─── セクションタイトル ───────────────────────────────────
    const sectionTitle = (title: string) => {
      ensureSpace(20)
      cur().drawRectangle({ x: MARGIN, y: y - 16, width: BODY_W, height: 16, color: bgDark })
      cur().drawText(title, { x: MARGIN + 6, y: y - 12, size: 8.5, font: jpFont, color: white })
      y -= 20
    }

    // ─── ラベル+値 1行描画 ────────────────────────────────────
    const drawRow = (label: string, value: string, isLast = false) => {
      const lines      = wrapText(value, 36)
      const lineHeight = 16          // 1行あたりの高さ
      const paddingY   = 10          // 上下余白合計
      const rowH       = Math.max(24, lines.length * lineHeight + paddingY)
      ensureSpace(rowH)

      cur().drawRectangle({ x: MARGIN, y: y - rowH, width: BODY_W, height: rowH, color: bgGray })
      cur().drawLine({ start: { x: MARGIN + COL_W, y }, end: { x: MARGIN + COL_W, y: y - rowH }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: border })
      if (isLast) {
        cur().drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: PAGE_W - MARGIN, y: y - rowH }, thickness: 0.5, color: border })
      }
      cur().drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN, y: y - rowH }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: PAGE_W - MARGIN, y }, end: { x: PAGE_W - MARGIN, y: y - rowH }, thickness: 0.5, color: border })
      // ラベルは縦方向中央寄せ（1行固定）
      cur().drawText(label, { x: MARGIN + 5, y: y - rowH / 2 - 3, size: 7.5, font: jpFont, color: gray })
      // 値は上余白 5pt から lineHeight ごとに描画
      lines.forEach((line, i) => {
        cur().drawText(line, { x: MARGIN + COL_W + 5, y: y - 8 - i * lineHeight, size: 8.5, font: jpFont, color: black })
      })
      y -= rowH
    }

    const drawRowLast = (label: string, value: string) => drawRow(label, value, true)

    // ─── オプションテーブル描画 ───────────────────────────────
    // 列幅: [内容=auto, 数量=44, 状態=52, 単価(税抜)=76, 金額(税抜)=76]
    const TBL_W    = BODY_W
    const C_QTY    = 44
    const C_STATE  = 52
    const C_PRICE  = 76
    const C_AMT    = 76
    const C_NAME   = TBL_W - C_QTY - C_STATE - C_PRICE - C_AMT
    const TH_H    = 16
    const TR_H    = 16

    const drawOptionTable = (rows: any[]) => {
      // 5列: 内容 | 数量 | 状態 | 単価（税抜） | 金額（税抜）
      // 縦区切り位置 (MARGIN からのオフセット)
      const dividers = [C_NAME, C_NAME + C_QTY, C_NAME + C_QTY + C_STATE, C_NAME + C_QTY + C_STATE + C_PRICE]

      // ヘッダー行
      ensureSpace(TH_H + TR_H)
      cur().drawRectangle({ x: MARGIN, y: y - TH_H, width: TBL_W, height: TH_H, color: bgTh })
      const headers = [
        { text: '内容',        x: MARGIN + 4 },
        { text: '数量',        x: MARGIN + C_NAME + 4 },
        { text: '状態',        x: MARGIN + C_NAME + C_QTY + 4 },
        { text: '単価（税抜）', x: MARGIN + C_NAME + C_QTY + C_STATE + 4 },
        { text: '金額（税抜）', x: MARGIN + C_NAME + C_QTY + C_STATE + C_PRICE + 4 },
      ]
      headers.forEach(h => {
        cur().drawText(h.text, { x: h.x, y: y - 12, size: 7, font: jpFont, color: black })
      })
      // ヘッダー枠
      cur().drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + TBL_W, y }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: MARGIN, y: y - TH_H }, end: { x: MARGIN + TBL_W, y: y - TH_H }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN, y: y - TH_H }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: MARGIN + TBL_W, y }, end: { x: MARGIN + TBL_W, y: y - TH_H }, thickness: 0.5, color: border })
      dividers.forEach(cx => {
        cur().drawLine({ start: { x: MARGIN + cx, y }, end: { x: MARGIN + cx, y: y - TH_H }, thickness: 0.5, color: border })
      })
      y -= TH_H

      if (rows.length === 0) {
        // 「該当なし」行
        ensureSpace(TR_H)
        cur().drawRectangle({ x: MARGIN, y: y - TR_H, width: TBL_W, height: TR_H, color: bgGray })
        cur().drawText('該当なし', { x: MARGIN + 4, y: y - 12, size: 8, font: jpFont, color: gray })
        cur().drawLine({ start: { x: MARGIN, y: y - TR_H }, end: { x: MARGIN + TBL_W, y: y - TR_H }, thickness: 0.5, color: border })
        cur().drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN, y: y - TR_H }, thickness: 0.5, color: border })
        cur().drawLine({ start: { x: MARGIN + TBL_W, y }, end: { x: MARGIN + TBL_W, y: y - TR_H }, thickness: 0.5, color: border })
        y -= TR_H
        return
      }

      rows.forEach((row: any, idx: number) => {
        // 内容列を wrapText で折り返し（slice で切らない）
        const nameLines = wrapText(d(row.name), 24)
        const nameLH    = 14  // 内容列の行間
        const namePad   = 8   // 上下余白合計
        const rowH      = Math.max(20, nameLines.length * nameLH + namePad)

        ensureSpace(rowH)
        const bg = idx % 2 === 0 ? bgGray : white
        cur().drawRectangle({ x: MARGIN, y: y - rowH, width: TBL_W, height: rowH, color: bg })

        // 内容列: 複数行ブロック全体を縦中央寄せ
const textBlockH = nameLines.length * nameLH
const opticalAdjust = 4
const startY = y - (rowH - textBlockH) / 2 - 3 - opticalAdjust

nameLines.forEach((line, li) => {
  cur().drawText(line, {
    x: MARGIN + 4,
    y: startY - li * nameLH,
    size: 8,
    font: jpFont,
    color: black,
  })
})

        // 固定1行列: 行の中央に描画
        const midY = y - rowH / 2 - 3
        const qtyText   = row.qty ? `${row.qty} ${row.unit ?? ''}`.trim() : '—'
        const stateText = d(row.state)
        const priceText = row.unit_price > 0 ? formatCurrency(row.unit_price) : '—'
        const amtText   = (row.amount ?? row.qty * row.unit_price) > 0
          ? formatCurrency(row.amount ?? row.qty * row.unit_price) : '—'

        cur().drawText(qtyText,   { x: MARGIN + C_NAME + 4,                           y: midY, size: 8, font: jpFont, color: black })
        cur().drawText(stateText, { x: MARGIN + C_NAME + C_QTY + 4,                   y: midY, size: 8, font: jpFont, color: black })
        cur().drawText(priceText, { x: MARGIN + C_NAME + C_QTY + C_STATE + 4,         y: midY, size: 8, font: jpFont, color: black })
        cur().drawText(amtText,   { x: MARGIN + C_NAME + C_QTY + C_STATE + C_PRICE + 4, y: midY, size: 8, font: jpFont, color: black })

        // 行の枠・縦区切り（可変 rowH に合わせる）
        cur().drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: MARGIN + TBL_W, y: y - rowH }, thickness: 0.5, color: border })
        cur().drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN, y: y - rowH }, thickness: 0.5, color: border })
        cur().drawLine({ start: { x: MARGIN + TBL_W, y }, end: { x: MARGIN + TBL_W, y: y - rowH }, thickness: 0.5, color: border })
        dividers.forEach(cx => {
          cur().drawLine({ start: { x: MARGIN + cx, y }, end: { x: MARGIN + cx, y: y - rowH }, thickness: 0.5, color: border })
        })
        y -= rowH
      })
    }

    // ─── ① 基本情報 ──────────────────────────────────────────
    sectionTitle('① 基本情報')
    drawRow('会社名 / 団体名', d(c.company))
    drawRow('担当者名',         d(c.contact))
    drawRow('電話番号',         d(c.phone))
    drawRow('メール',           d(c.email))
    drawRow('問合せ日',         formatDate(c.inquiry_date))
    drawRow('開催日',           formatDate(c.event_date))
    drawRow('イベント名',       d(c.event_name))
    drawRow('予定参加人数',     c.guest_count ? `${c.guest_count} 名` : '—')
    drawRow('フロア',           d((c.floor_master as any)?.name))
    drawRowLast('認知経路',     d((c.media_master as any)?.name))
    y -= 6

    // ─── ② タイムスケジュール ────────────────────────────────
    sectionTitle('② タイムスケジュール')
    drawRow('入り時間',         c.load_in_time   ? formatTime(c.load_in_time)   : '—')
    drawRow('開始時間',         c.start_time     ? formatTime(c.start_time)     : '—')
    drawRow('終了時間',         c.end_time       ? formatTime(c.end_time)       : '—')
    drawRowLast('完全撤収時間', c.full_exit_time ? formatTime(c.full_exit_time) : '—')
    y -= 6

    // ─── ③ 確認手続き ────────────────────────────────────────
    sectionTitle('③ 確認手続き')
    drawRow('下見日時',         d(c.preview_datetime))
    drawRow('見積金額（税込）', (c.estimate_amount ?? 0) > 0 ? formatCurrency(c.estimate_amount) : '—')
    drawRow('申込みフォーム',   d(c.application_form_status))
    drawRow('搬入出届',         d(c.delivery_notice_status))
    drawRow('請求書',           d(c.invoice_status))
    drawRowLast('支払い方法',   d(c.payment_method))
    y -= 6

    // ─── ④ 飲食プラン ───────────────────────────────────────
    const foodPlans: string[] = Array.isArray((c as any).food_plans) ? (c as any).food_plans : []
    if (foodPlans.length > 0) {
      sectionTitle('④ 飲食プラン')
      foodPlans.forEach((plan: string, idx: number) => {
        const isLast = idx === foodPlans.length - 1
        drawRow('飲食プラン', `・${plan}`, isLast)
      })
      y -= 6
    }

    // ─── ⑤ 備品・設備明細 ────────────────────────────────────
    sectionTitle('⑤ 備品・設備明細')
    drawOptionTable(equipment)
    y -= 6

    // ─── ⑤ 機材・オペレーター ────────────────────────────────
    sectionTitle('⑥ 機材・オペレーター')
    drawOptionTable(machines)
    y -= 6

    // ─── ⑥ 確認事項 ─────────────────────────────────────────
    sectionTitle('⑦ 確認事項')
    if (checklist.length === 0) {
      ensureSpace(18)
      cur().drawRectangle({ x: MARGIN, y: y - 18, width: BODY_W, height: 18, color: bgGray })
      cur().drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: MARGIN, y: y - 18 }, end: { x: PAGE_W - MARGIN, y: y - 18 }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN, y: y - 18 }, thickness: 0.5, color: border })
      cur().drawLine({ start: { x: PAGE_W - MARGIN, y }, end: { x: PAGE_W - MARGIN, y: y - 18 }, thickness: 0.5, color: border })
      cur().drawText('確認事項はありません', { x: MARGIN + 5, y: y - 13, size: 8, font: jpFont, color: gray })
      y -= 18
    } else {
      checklist.forEach((item: any, idx: number) => {
        const stateLabel = item.state === '確定' ? '✓ 確定' : '□ 確認中'
        const isLast = idx === checklist.length - 1
        drawRow(stateLabel, d(item.item), isLast)
      })
    }
    y -= 6

    // ─── ⑦ 備考・注意事項 ────────────────────────────────────
    sectionTitle('⑧ 備考・注意事項')
    if (c.notes) {
      drawRow('備考', c.notes)
    }
    drawRowLast(
      '注意事項',
      'お荷物や機材の搬入出は必ず搬入出届をご提出ください。開始・終了時間は厳守をお願いします。ゴミは必ずお持ち帰りください。'
    )

    // ─── 最終ページのフッター ────────────────────────────────
    drawFooter(cur())

    // ─── PDF バイト列 ─────────────────────────────────────────
    const pdfBytes = await pdfDoc.save()

    // ─── ファイル名 ───────────────────────────────────────────
    const safeCompany = (c.company ?? 'no-name')
      .replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 20) || 'no-name'
    const safeDate = c.event_date
      ? new Date(c.event_date).toISOString().slice(0, 10)
      : 'no-date'
    const displayName = `${safeDate}_${safeCompany}_イベント確認表.pdf`
    const encodedName = encodeURIComponent(displayName)

    console.log('[PDF] generated:', displayName, `${pdfBytes.length} bytes`, `${pages.length} pages`)

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="event-confirmation.pdf"; filename*=UTF-8''${encodedName}`,
        'Content-Length':      String(pdfBytes.length),
        'Cache-Control':       'no-store',
        'X-Filename':          encodedName,
      },
    })

  } catch (err) {
    console.error('[PDF] generation error:', err)
    return NextResponse.json({ message: 'PDF の生成に失敗しました。' }, { status: 500 })
  }
}
