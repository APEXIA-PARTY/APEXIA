import { NextRequest, NextResponse } from 'next/server'

// Vercel Function タイムアウト（Hobby: 10s / Pro: 60s）
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/pdf-image?url=<署名付きPDF URL>
 *
 * 指定された PDF URL の1ページ目をスクリーンショットして
 * base64 エンコードした PNG 文字列を返す。
 *
 * 認証について:
 *   このエンドポイントは print/page.tsx の SSR（Server Component）から
 *   loopback fetch で呼ばれる。SSR からは Cookie を引き継げないため
 *   セッション認証は行わない。
 *   代わりに URL を Supabase Storage ドメインに限定することで
 *   外部 URL へのプロキシ悪用を防ぐ。
 *   （print ページ自体は Supabase Auth で保護されているため二重保護は不要）
 *
 * DB への読み書きは一切行わない。
 */
export async function GET(request: NextRequest) {
  // ─── 1. クエリパラメータから PDF URL を取得 ───────────────
  const pdfUrl = request.nextUrl.searchParams.get('url')
  if (!pdfUrl) {
    return NextResponse.json({ message: 'url パラメータが必要です' }, { status: 400 })
  }

  // ─── 2. URL を Supabase Storage ドメインに限定 ────────────
  // 任意の外部 URL をプロキシするリスクを防ぐため
  // *.supabase.co または同一オリジンのみ許可する
  const origin = request.nextUrl.origin
  let parsedUrl: URL
  try {
    parsedUrl = new URL(pdfUrl)
  } catch {
    return NextResponse.json({ message: '無効な URL です' }, { status: 400 })
  }

  const isSupabaseStorage = parsedUrl.hostname.includes('.supabase.co')
  const isSameOrigin      = parsedUrl.origin === origin
  if (!isSupabaseStorage && !isSameOrigin) {
    return NextResponse.json({ message: '許可されていない URL です' }, { status: 403 })
  }

  // ─── 3. Playwright Chromium を起動 ───────────────────────
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
    console.error('[pdf-image] browser launch failed:', err)
    return NextResponse.json(
      { message: 'ブラウザの起動に失敗しました' },
      { status: 500 }
    )
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 794, height: 1123 },
    })
    const page = await context.newPage()

    // PDF を開く（Chromium は PDF をネイティブでレンダリングする）
    await page.goto(pdfUrl, {
      waitUntil: 'networkidle',
      timeout:   20_000,
    })

    // PDF ビューアとして描画されるまで待機
    await page.waitForTimeout(800)

    // ─── 4. スクリーンショット → base64 PNG ─────────────────
    const screenshotBuffer = await page.screenshot({
      type:     'png',
      fullPage: false,
    })

    await browser.close()

    const base64 = screenshotBuffer.toString('base64')
    return NextResponse.json({ base64 }, { status: 200 })

  } catch (err) {
    console.error('[pdf-image] screenshot failed:', err)
    await browser.close().catch(() => {})
    return NextResponse.json(
      { message: 'スクリーンショットの取得に失敗しました' },
      { status: 500 }
    )
  }
}
