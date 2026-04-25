import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { getSignedUrl } from '@/lib/supabase/storage'
import { mergePdfs } from '@/lib/utils/mergePdfs'

// Vercel Function タイムアウト（PDF結合を考慮して最大値）
export const maxDuration = 60

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  // ─── 1. 認証確認 ─────────────────────────────────────────
  const { error: authError } = await requireAuth()
  if (authError) return authError

  // ─── 2. 案件取得（SELECT のみ・書き込みなし）──────────────
  const supabase = await createClient()
  const { data: c, error: dbError } = await supabase
    .from('cases')
    .select('id, company, event_date')
    .eq('id', params.id)
    .single()

  if (dbError || !c) {
    return NextResponse.json({ message: '案件が見つかりません' }, { status: 404 })
  }

  // ─── 3. URL 組み立て ─────────────────────────────────────
  const origin   = request.nextUrl.origin
  const printUrl = `${origin}/cases/${params.id}/print?export=1`

  // ─── 4. Cookie パース ────────────────────────────────────
  // Supabase JWT は値に '=' を含むため indexOf で最初の '=' だけで分割する
  const cookieHeader  = request.headers.get('cookie') ?? ''
  const parsedCookies = cookieHeader
    .split(';')
    .flatMap(pair => {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) return []
      const name  = pair.slice(0, eqIdx).trim()
      const value = pair.slice(eqIdx + 1).trim()
      if (!name) return []
      return [{ name, value, url: origin }]
    })

  console.log('[PDF] target URL:', printUrl)
  console.log('[PDF] cookie count:', parsedCookies.length)
  console.log('[PDF] cookie names:', parsedCookies.map(ck => ck.name).join(', '))

  // ─── 5. Playwright 起動（ローカル / 本番で分岐）──────────
  let browser: import('playwright-core').Browser

  try {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      const chromium               = (await import('@sparticuz/chromium')).default
      const { chromium: pwChrome } = await import('playwright-core')
      browser = await pwChrome.launch({
        args:           chromium.args,
        executablePath: await chromium.executablePath(),
        headless:       true,
      })
    } else {
      const { chromium } = await import('playwright-core')
      browser = await chromium.launch({ headless: true })
    }
  } catch (err) {
    console.error('[PDF] browser launch failed:', err)
    return NextResponse.json(
      { message: 'ブラウザの起動に失敗しました。npx playwright install chromium を実行してください。' },
      { status: 500 }
    )
  }

  try {
    // ─── 6. print ページを開いて PDF 生成 ────────────────────
    const context = await browser.newContext()
    await context.addCookies(parsedCookies)
    const page = await context.newPage()

    await page.goto(printUrl, { waitUntil: 'networkidle', timeout: 30_000 })

    const finalUrl = page.url()
    console.log('[PDF] final URL after goto:', finalUrl)

    if (
      finalUrl.includes('/login')  ||
      finalUrl.includes('/auth')   ||
      finalUrl.includes('/sign-in')
    ) {
      await browser.close()
      return NextResponse.json(
        { message: 'セッションが無効です。再ログインして再度お試しください。' },
        { status: 401 }
      )
    }

    await page.waitForTimeout(1500)

    const mainPdfBuffer = await page.pdf({
      format:           'A4',
      printBackground:   true,
      preferCSSPageSize: true,
      margin: { top: '10mm', bottom: '10mm', left: '12mm', right: '12mm' },
    })

    await browser.close()

    // ─── 7. レイアウト図 PDF を取得（SELECT のみ）────────────
    const { data: layoutFiles } = await supabase
      .from('case_files')
      .select('id, storage_path, file_name')
      .eq('case_id', params.id)
      .eq('file_type', 'レイアウト図')
      .eq('mime_type', 'application/pdf')
      .order('created_at', { ascending: true })

    // ─── 8. 各レイアウト PDF を fetch して Buffer 化 ─────────
    const layoutBuffers: Buffer[] = []

    if (layoutFiles && layoutFiles.length > 0) {
      for (const lf of layoutFiles) {
        try {
          const signedUrl = await getSignedUrl(lf.storage_path, 300)
          if (!signedUrl) {
            console.warn(`[PDF] signedURL 取得失敗: ${lf.id}`)
            continue
          }
          const res = await fetch(signedUrl)
          if (!res.ok) {
            console.warn(`[PDF] fetch 失敗: ${lf.id} status=${res.status}`)
            continue
          }
          const buf = Buffer.from(await res.arrayBuffer())
          layoutBuffers.push(buf)
          console.log(`[PDF] layout loaded: ${lf.file_name}`)
        } catch (err) {
          console.warn(`[PDF] layout スキップ: ${lf.id}`, err)
        }
      }
    }

    // ─── 9. PDF 結合 ─────────────────────────────────────────
    let finalPdfBytes: Uint8Array

    if (layoutBuffers.length === 0) {
      console.log('[PDF] レイアウトPDF なし。案件確認票のみ返す')
      finalPdfBytes = mainPdfBuffer
    } else {
      console.log(`[PDF] ${layoutBuffers.length} 件を結合`)
      try {
        finalPdfBytes = await mergePdfs(mainPdfBuffer, layoutBuffers)
      } catch (err) {
        console.error('[PDF] 結合失敗。案件確認票のみ返す', err)
        finalPdfBytes = mainPdfBuffer
      }
    }

    // ─── 10. ファイル名生成 ───────────────────────────────────
    // Windows NG 文字を除去して 20 文字でトリム
    const safeCompany = (c.company ?? 'no-name')
      .replace(/[/\\:*?"<>|]/g, '')
      .trim()
      .slice(0, 20) || 'no-name'

    const safeDate = c.event_date
      ? new Date(c.event_date).toISOString().slice(0, 10)
      : 'no-date'

    // 例: "2026-04-30_株式会社サンプル_イベント確認表.pdf"
    const displayName = `${safeDate}_${safeCompany}_イベント確認表.pdf`

    // ─── 11. Content-Disposition の組み立て ──────────────────
    //
    // 【重要】fetch + blob 方式では Content-Disposition ヘッダーのファイル名は
    // ブラウザの anchor.download に上書きされるため、
    // このヘッダーだけ変えても Finder のファイル名は変わらない。
    //
    // ここでは X-Filename ヘッダーも追加で返す。
    // → PdfDownloadButton.tsx 側で res.headers.get('X-Filename') を読んで
    //   anchor.download に設定することでファイル名を反映できる。
    //
    // Content-Disposition も RFC 5987 形式で正しく組む（直リンクアクセス時の対応）。
    const encodedName   = encodeURIComponent(displayName)
    const contentDispos = `attachment; filename="event-confirmation.pdf"; filename*=UTF-8''${encodedName}`

    console.log('[PDF] filename:', displayName)

    // ─── 12. レスポンス ──────────────────────────────────────
    return new NextResponse(
  finalPdfBytes.buffer.slice(
    finalPdfBytes.byteOffset,
    finalPdfBytes.byteOffset + finalPdfBytes.byteLength
  ) as ArrayBuffer,
  {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition,
    },
  }
)

  } catch (err) {
    console.error('[PDF] generation error:', err)
    await browser.close().catch(() => {})
    return NextResponse.json(
      { message: 'PDF の生成に失敗しました。しばらくして再度お試しください。' },
      { status: 500 }
    )
  }
}