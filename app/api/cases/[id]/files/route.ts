import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, requireStaff } from '@/lib/auth/helpers'
import { uploadFile } from '@/lib/supabase/storage'
import { z } from 'zod'

type Params = { params: { id: string } }

const FILE_TYPES = ['見積書', '請求書', '進行表', 'レイアウト図', 'その他'] as const
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * GET /api/cases/[id]/files
 * case_files のメタ情報一覧を返す
 * storage_path のみ保存・返却し、表示用URLは /files/[fileId]/url で別途取得する
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createClient()
  const { data, error: dbError } = await supabase
    .from('case_files')
    .select('id, case_id, file_type, file_name, mime_type, file_size, label, sort_order, storage_path, created_at')
    .eq('case_id', params.id)
    .order('sort_order')

  if (dbError) return NextResponse.json({ message: 'データ取得に失敗しました' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/**
 * POST /api/cases/[id]/files
 * multipart/form-data: file + file_type + label
 * → Supabase Storage にアップロード → storage_path を DB に INSERT
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ message: 'フォームデータの解析に失敗しました' }, { status: 400 }) }

  const file      = formData.get('file') as File | null
  const fileType  = (formData.get('file_type') as string) || 'その他'
  const label     = (formData.get('label') as string) || ''
  const sortOrder = Number(formData.get('sort_order') ?? 0)

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ message: 'ファイルが指定されていません' }, { status: 400 })
  }
  if (!FILE_TYPES.includes(fileType as any)) {
    return NextResponse.json({ message: '無効なファイル種別です' }, { status: 400 })
  }

  // ─── サーバー側サイズ検証 ────────────────────────────────
  if (file.size > MAX_FILE_SIZE) {
    const limitMB = MAX_FILE_SIZE / 1024 / 1024
    return NextResponse.json(
      { message: `ファイルサイズが上限（${limitMB}MB）を超えています。ファイルサイズ: ${(file.size / 1024 / 1024).toFixed(1)}MB` },
      { status: 400 }
    )
  }

  // ─── 許可 MIME type 検証 ──────────────────────────────────
  // 画像: jpeg / png / gif / webp / svg
  // ドキュメント: pdf / word / excel / powerpoint / text / csv / zip
  const ALLOWED_MIME_PREFIXES = ['image/']
  const ALLOWED_MIME_EXACT = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
  ]
  const mimeType = file.type || ''
  const isAllowedMime =
    mimeType === '' || // MIME が取得できない場合は通す（ファイル名拡張子で判断）
    ALLOWED_MIME_PREFIXES.some(p => mimeType.startsWith(p)) ||
    ALLOWED_MIME_EXACT.includes(mimeType)

  if (!isAllowedMime) {
    return NextResponse.json(
      { message: `許可されていないファイル形式です（${mimeType}）。PDF・画像・Office ドキュメント・テキストファイルをアップロードしてください。` },
      { status: 400 }
    )
  }

  // Supabase Storage にアップロード
  const { storagePath, error: uploadError } = await uploadFile(params.id, file)
  if (uploadError || !storagePath) {
    return NextResponse.json({ message: 'ストレージへのアップロードに失敗しました: ' + (uploadError ?? '') }, { status: 500 })
  }

  // DB に storage_path のみ保存（data URL は保存しない）
  const { data, error: dbError } = await supabase
    .from('case_files')
    .insert({
      case_id:      params.id,
      file_type:    fileType,
      file_name:    file.name,
      storage_path: storagePath,
      mime_type:    file.type || null,
      file_size:    file.size,
      label:        label || null,
      sort_order:   sortOrder,
    })
    .select('id, case_id, file_type, file_name, mime_type, file_size, label, sort_order, storage_path, created_at')
    .single()

  if (dbError) {
    // DB 失敗時は Storage から削除して孤立ファイルを防ぐ
    const { deleteFile } = await import('@/lib/supabase/storage')
    await deleteFile(storagePath)
    return NextResponse.json({ message: 'ファイル情報の保存に失敗しました' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

/**
 * PUT /api/cases/[id]/files
 * label / file_type の更新（メタ情報のみ）
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { error } = await requireStaff()
  if (error) return error

  const supabase = await createClient()
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ message: 'リクエストボディが不正です' }, { status: 400 }) }

  const schema = z.object({
    id:        z.string().uuid(),
    file_type: z.enum(FILE_TYPES).optional(),
    label:     z.string().max(100).optional().nullable(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'バリデーションエラー', errors: parsed.error.flatten() }, { status: 422 })
  }

  const { id, ...updates } = parsed.data
  const { data, error: dbError } = await supabase
    .from('case_files')
    .update(updates)
    .eq('id', id)
    .eq('case_id', params.id)
    .select('id, file_type, file_name, label')
    .single()

  if (dbError) return NextResponse.json({ message: '更新に失敗しました' }, { status: 500 })
  return NextResponse.json(data)
}
