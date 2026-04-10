import { createClient } from '@/lib/supabase/server'

const BUCKET = 'case-files'

/**
 * ファイルを Supabase Storage にアップロードする
 * @returns storage_path（DB保存用）
 */
export async function uploadFile(
  caseId: string,
  file: File
): Promise<{ storagePath: string; error?: string }> {
  const supabase = await createClient()

  // パス: cases/{caseId}/{timestamp}_{sanitized_filename}
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const storagePath = `cases/${caseId}/${timestamp}_${safeName}`

  const arrayBuffer = await file.arrayBuffer()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    console.error('[Storage Upload]', error)
    return { storagePath: '', error: error.message }
  }

  return { storagePath }
}

/**
 * 署名付きURLを生成する（有効期限 1時間）
 * 表示時にサーバー側で呼ぶ
 */
export async function getSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)

  if (error || !data) {
    console.error('[Storage SignedUrl]', error)
    return null
  }
  return data.signedUrl
}

/**
 * ファイルを Storage から削除する
 */
export async function deleteFile(storagePath: string): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (error) {
    console.error('[Storage Delete]', error)
    return false
  }
  return true
}

/**
 * ファイルサイズを人間が読みやすい形式に変換
 */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
