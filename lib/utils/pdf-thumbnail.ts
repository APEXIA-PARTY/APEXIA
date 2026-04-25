import { createClient } from '@/lib/supabase/server'

export async function generatePdfThumbnail(
  pdfUrl: string,
  caseId: string,
  fileId: string
): Promise<string | null> {
  let browser: import('playwright-core').Browser | null = null

  try {
    console.log('[thumbnail] fetch pdf')
    const res = await fetch(pdfUrl)

    if (!res.ok) return null

    const arrayBuffer = await res.arrayBuffer()
    const pdfBase64 = Buffer.from(arrayBuffer).toString('base64')
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`

    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({ headless: true })

    const page = await browser.newPage()

    await page.goto('about:blank')

    await page.setContent(`
      <html>
        <body style="margin:0">
          <embed src="${pdfDataUrl}" type="application/pdf" width="794" height="1123" />
        </body>
      </html>
    `)

    await page.waitForTimeout(1500)

    const buffer = await page.screenshot({
      type: 'png',
      fullPage: false,
    })

    const filePath = `cases/${caseId}/thumbnails/${fileId}.png`

    const supabase = await createClient()

    const { error } = await supabase.storage
      .from('case-files')
      .upload(filePath, buffer, {
        contentType: 'image/png',
        upsert: true,
      })

    if (error) {
      console.error(error)
      return null
    }

    return filePath
  } catch (e) {
    console.error(e)
    return null
  } finally {
    if (browser) await browser.close()
  }
}

export async function saveThumbnailPath(
  fileId: string,
  path: string
): Promise<boolean> {
  try {
    const supabase = await createClient()

    const { error } = await supabase
      .from('case_files')
      .update({ thumbnail_path: path })
      .eq('id', fileId)

    if (error) return false

    return true
  } catch {
    return false
  }
}