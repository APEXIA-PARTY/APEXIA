import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/helpers'
import { getSignedUrl } from '@/lib/supabase/storage'

type Params = { params: { id: string; fileId: string } }

/**
 * GET /api/cases/[id]/files/[fileId]/url
 * 署名付きURLを返す（有効期限 1時間）
 * ファイルの表示・ダウンロードに使用する
 * storage_path は DB に保存されているが、表示用URLはここで生成する
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()

  // storage_path を DB から取得（クライアントから storage_path を直接受け取らない）
  const { data: fileRow, error: fetchError } = await supabase
    .from('case_files')
    .select('storage_path, file_name, mime_type')
    .eq('id', params.fileId)
    .eq('case_id', params.id)
    .single()

  if (fetchError || !fileRow) {
    return NextResponse.json({ message: 'ファイルが見つかりません' }, { status: 404 })
  }

  const signedUrl = await getSignedUrl(fileRow.storage_path)
  if (!signedUrl) {
    return NextResponse.json({ message: '署名付きURLの生成に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({
    url:       signedUrl,
    file_name: fileRow.file_name,
    mime_type: fileRow.mime_type,
  })
}
