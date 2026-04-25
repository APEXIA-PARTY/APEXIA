import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import { getSignedUrl } from '@/lib/supabase/storage'
import { generatePdfThumbnail, saveThumbnailPath } from '@/lib/utils/pdf-thumbnail'

export const maxDuration = 60

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export async function POST(req: NextRequest) {
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()

  const url = new URL(req.url)
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT)

  const dryRunParam = url.searchParams.get('dry_run')
  const dryRun = dryRunParam === '1' || dryRunParam === 'true'

  const { data: targets, error } = await supabase
    .from('case_files')
    .select('id, case_id, storage_path, file_name, file_type, mime_type')
    .eq('file_type', 'レイアウト図')
    .eq('mime_type', 'application/pdf')
    .is('thumbnail_path', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      { message: '対象レコードの取得に失敗しました', detail: error.message },
      { status: 500 }
    )
  }

  if (!targets || targets.length === 0) {
    return NextResponse.json({
      total: 0,
      picked: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failedIds: [],
      dryRun,
      limit,
      message: '対象はありません',
    })
  }

  const picked = targets.length

  if (dryRun) {
    return NextResponse.json({
      total: picked,
      picked,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failedIds: [],
      dryRun: true,
      limit,
      message: `dry_run: 対象 ${picked} 件`,
    })
  }

  let succeeded = 0
  let failed = 0
  let skipped = 0
  const failedIds: string[] = []

  for (const file of targets) {
    try {
      if (!file.storage_path) {
        skipped++
        continue
      }

      const signedUrl = await getSignedUrl(file.storage_path, 600)
      if (!signedUrl) {
        failed++
        failedIds.push(file.id)
        continue
      }

      const thumbPath = await generatePdfThumbnail(
  signedUrl,
  file.case_id,
  file.id
)

if (!thumbPath) {
  failed++
  failedIds.push(file.id)
  continue
}

const ok = await saveThumbnailPath(file.id, thumbPath)

if (!ok) {
  failed++
  failedIds.push(file.id)
  continue
}

succeeded++

      
    } catch (e) {
      console.error(e)
      failed++
      failedIds.push(file.id)
    }
  }

  const result = {
    total: picked,
    picked,
    succeeded,
    failed,
    skipped,
    failedIds,
    dryRun: false,
    limit,
    message: `${picked} 件処理: ${succeeded} 成功 / ${failed} 失敗`,
  }

  return NextResponse.json(result, { status: 200 })
}