import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { getSignedUrl } from '@/lib/supabase/storage'
import { mergePdfs } from '@/lib/utils/mergePdfs'

// Vercel Function タイムアウト（PDF結合を考慮して最大値）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const supabase = await createClient()

  const { data: c, error: dbError } = await supabase
    .from('cases')
    .select('id, company, event_date')
    .eq('id', params.id)
    .single()

  if (dbError || !c) {
    return NextResponse.json({ message: '案件が見つかりません' }, { status: 404 })
  }

  const origin = request.nextUrl.origin
  const printUrl = `${origin}/cases/${params.id}/print?export=1`

  const cookieHeader = request.headers.get('cookie') ?? ''
  const parsedCookies = cookieHeader
    .split(';')
    .flatMap((pair) => {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) return []
      const name = pair.slice(0, eqIdx).trim()
      const value = pair.slice(eqIdx + 1).trim()
      if (!name) return []
      return [{ name, value, url: origin }]
    })

  let browser: import('playwright-core').Browser | null = null

  try {
    // 1. browser 起動
    if (process.env.VERCEL) {
      const chromium = (await import('@sparticuz/chromium')).default
      const { chromium: pwChrome } = await import('playwright-core')

      browser = await pwChrome.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: await chromium.executablePath(),
        headless: true,
      })
    } else {
      const { chromium } = await import('playwright')
      browser = await chromium.launch({ headless: true })
    }

    // 2. print画面をPDF化
    const context = await browser.newContext()
    await context.addCookies(parsedCookies)
    const page = await context.newPage()

    await page.goto(printUrl, { waitUntil: 'networkidle', timeout: 30000 })

    const finalUrl = page.url()
    if (
      finalUrl.includes('/login') ||
      finalUrl.includes('/auth') ||
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
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', bottom: '10mm', left: '12mm', right: '12mm' },
    })

    await browser.close()
    browser = null

    // 3. レイアウトPDF取得
    const { data: layoutFiles } = await supabase
      .from('case_files')
      .select('id, storage_path, file_name')
      .eq('case_id', params.id)
      .eq('file_type', 'レイアウト図')
      .eq('mime_type', 'application/pdf')
      .order('created_at', { ascending: true })

    const layoutBuffers: Buffer[] = []

    if (layoutFiles?.length) {
      for (const lf of layoutFiles) {
        try {
          const signedUrl = await getSignedUrl(lf.storage_path, 300)
          if (!signedUrl) continue

          const res = await fetch(signedUrl)
          if (!res.ok) continue

          layoutBuffers.push(Buffer.from(await res.arrayBuffer()))
        } catch {
          continue
        }
      }
    }

    // 4. PDF結合
    let finalPdfBytes: Uint8Array

    if (layoutBuffers.length === 0) {
      finalPdfBytes = mainPdfBuffer
    } else {
      try {
        finalPdfBytes = await mergePdfs(mainPdfBuffer, layoutBuffers)
      } catch {
        finalPdfBytes = mainPdfBuffer
      }
    }

    // 5. ファイル名
    const safeCompany =
      (c.company ?? 'no-name').replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 20) || 'no-name'

    const safeDate = c.event_date
      ? new Date(c.event_date).toISOString().slice(0, 10)
      : 'no-date'

    const displayName = `${safeDate}_${safeCompany}_イベント確認表.pdf`
    const encodedName = encodeURIComponent(displayName)
    const contentDispos = `attachment; filename="event-confirmation.pdf"; filename*=UTF-8''${encodedName}`

    const pdfBuffer = finalPdfBytes.buffer.slice(
  finalPdfBytes.byteOffset,
  finalPdfBytes.byteOffset + finalPdfBytes.byteLength
) as ArrayBuffer

const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' })

    return new NextResponse(pdfBlob, {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': contentDispos,
    'X-Filename': encodeURIComponent(displayName),
  },
})
  } catch (err) {
    console.error('[PDF] generation error:', err)
    await browser?.close().catch(() => {})

    return NextResponse.json(
      { message: 'PDF の生成に失敗しました。しばらくして再度お試しください。' },
      { status: 500 }
    )
  }
}