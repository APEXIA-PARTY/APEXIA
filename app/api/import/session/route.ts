/**
 * POST /api/import/session
 *
 * Excelファイルを受け取り、シート一覧を取得して cases_import_session に保存する。
 *
 * 【安全保証】
 * - casesテーブルには一切 INSERT / UPDATE / DELETE しない
 * - cases_import_session のみ操作する
 * - 個人情報・APIキーをログに出力しない
 * - .env.local は参照しない（既存のSupabaseクライアントを使用）
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/helpers'
import { getSheetNames, suggestJanuaryInquirySheets } from '@/lib/import/excel-parser'
import type { ImportSessionResponse } from '@/types/import'

export async function POST(req: Request) {
  // ── 認証・権限チェック ──────────────────────────────────────
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ message: 'ログインが必要です' }, { status: 401 })
  }

  // ── ファイル受け取り ────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ message: 'ファイルの読み取りに失敗しました' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ message: 'ファイルが見つかりません' }, { status: 400 })
  }

  // ファイル種別チェック
  const filename = file.name
  if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
    return NextResponse.json(
      { message: 'Excelファイル（.xlsx / .xls）のみ対応しています' },
      { status: 400 }
    )
  }

  // ── Excel解析（シート名のみ）─────────────────────────────────
  let sheetNames: string[]
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    sheetNames = getSheetNames(buffer)
  } catch {
    // エラー詳細にはファイル内容が含まれる可能性があるためログに出さない
    return NextResponse.json(
      { message: 'Excelファイルの読み取りに失敗しました。ファイルが破損していないか確認してください。' },
      { status: 400 }
    )
  }

  if (sheetNames.length === 0) {
    return NextResponse.json(
      { message: 'シートが見つかりませんでした' },
      { status: 400 }
    )
  }

  const suggestedSheets = suggestJanuaryInquirySheets(sheetNames)

  // ── cases_import_session に保存 ──────────────────────────────
  // ※ casesテーブルは一切操作しない
  const { data: session, error: dbError } = await supabase
    .from('cases_import_session')
    .insert({
      filename,
      file_size_bytes: file.size,
      available_sheets: sheetNames,
      suggested_sheets: suggestedSheets,
      selected_sheet: null,
      parsed_rows: null,
      total_rows: null,
      error_rows: [],
      status: 'uploaded',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (dbError || !session) {
    console.error('[import/session] DB保存エラー:', dbError?.code)
    return NextResponse.json(
      { message: 'セッションの保存に失敗しました' },
      { status: 500 }
    )
  }

  const response: ImportSessionResponse = {
    session_id: session.id,
    filename,
    available_sheets: sheetNames,
    suggested_sheets: suggestedSheets,
  }

  return NextResponse.json(response)
}
