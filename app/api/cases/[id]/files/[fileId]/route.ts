import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff } from '@/lib/auth/helpers'
import { deleteFile, getSignedUrl } from '@/lib/supabase/storage'

type Params = { params: { id: string; fileId: string } }

/**
 * DELETE /api/cases/[id]/files/[fileId]
 * Storage から物理削除 + case_files から削除
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()

  // storage_path を取得
  const { data: fileRow, error: fetchError } = await supabase
    .from('case_files')
    .select('storage_path')
    .eq('id', params.fileId)
    .eq('case_id', params.id)
    .single()

  if (fetchError || !fileRow) {
    return NextResponse.json({ message: 'ファイルが見つかりません' }, { status: 404 })
  }

  // DB から削除（先に行う）
  const { error: dbError } = await supabase
    .from('case_files')
    .delete()
    .eq('id', params.fileId)
    .eq('case_id', params.id)

  if (dbError) {
    return NextResponse.json({ message: '削除に失敗しました' }, { status: 500 })
  }

  // Storage から削除（DB成功後。失敗しても DB は消えているので続行）
  if (fileRow.storage_path) {
    await deleteFile(fileRow.storage_path)
  }

  return new NextResponse(null, { status: 204 })
}
