'use client'

/**
 * インポート画面
 *
 * 【安全保証】
 * - casesテーブルへの書き込みは行わない（staging/session/batchのみ）
 * - 本番反映ボタンはこの画面にない（第2フェーズで実装）
 * - 個人情報をconsole.logに出力しない
 */

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/PageHeader'
import { Upload, FileSpreadsheet, ChevronRight, AlertCircle, CheckCircle2, Info, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { ImportSessionResponse, ParseSheetResponse, StageResponse, ParsedRow, ImportErrorRow } from '@/types/import'

// ─── ステップ定義 ──────────────────────────────────────────────────────────────
type Step = 'upload' | 'sheet_select' | 'preview' | 'done'

// ─── メインコンポーネント ──────────────────────────────────────────────────────
export default function ImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [session, setSession] = useState<ImportSessionResponse | null>(null)
  const [selectedSheet, setSelectedSheet] = useState<string>('')
  const [preview, setPreview] = useState<ParseSheetResponse | null>(null)
  const [stageResult, setStageResult] = useState<StageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── STEP 1: Excelアップロード ───────────────────────────────────────────────
  const handleUpload = useCallback(async (targetFile: File) => {
    setErrorMsg(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', targetFile)

      const res = await fetch('/api/import/session', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.message ?? 'アップロードに失敗しました')
        return
      }

      const sessionData = data as ImportSessionResponse
      setFile(targetFile)
      setSession(sessionData)
      // 提案シートがあれば最初の1件を初期選択
      if (sessionData.suggested_sheets.length > 0) {
        setSelectedSheet(sessionData.suggested_sheets[0])
      }
      setStep('sheet_select')
    } catch {
      setErrorMsg('ネットワークエラーが発生しました。再度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleUpload(f)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleUpload(f)
  }

  // ── STEP 2: シート解析 ─────────────────────────────────────────────────────
  const handleParse = async () => {
    if (!session || !selectedSheet || !file) return
    setErrorMsg(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('sheet_name', selectedSheet)

      const res = await fetch(`/api/import/session/${session.session_id}/parse`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.message ?? '解析に失敗しました')
        return
      }

      setPreview(data as ParseSheetResponse)
      setStep('preview')
    } catch {
      setErrorMsg('ネットワークエラーが発生しました。再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  // ── STEP 3: Staging保存 ─────────────────────────────────────────────────────
  const handleStage = async () => {
    if (!session) return
    setErrorMsg(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/import/session/${session.session_id}/stage`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.message ?? 'Staging保存に失敗しました')
        return
      }

      setStageResult(data as StageResponse)
      setStep('done')
    } catch {
      setErrorMsg('ネットワークエラーが発生しました。再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  // ── リセット ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep('upload')
    setFile(null)
    setSession(null)
    setSelectedSheet('')
    setPreview(null)
    setStageResult(null)
    setErrorMsg(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── ステップインジケーター ───────────────────────────────────────────────────
  const STEPS = [
    { key: 'upload',       label: 'アップロード' },
    { key: 'sheet_select', label: 'シート選択' },
    { key: 'preview',      label: 'プレビュー確認' },
    { key: 'done',         label: 'Staging保存完了' },
  ] as const

  const stepIndex = STEPS.findIndex(s => s.key === step)

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="データインポート"
        description="Excelから案件データをstagingに取り込みます。casesテーブルへの反映はこの画面では行いません。"
      />

      {/* ステップインジケーター */}
      <div className="flex items-center gap-2 text-sm">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
              i < stepIndex  ? 'bg-green-500 text-white' :
              i === stepIndex ? 'bg-primary text-primary-foreground' :
                               'bg-muted text-muted-foreground'
            )}>
              {i < stepIndex ? '✓' : i + 1}
            </div>
            <span className={cn(
              'hidden sm:inline',
              i === stepIndex ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      {/* エラーメッセージ */}
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── STEP 1: アップロード ────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">安全なインポート手順</p>
              <p className="mt-1 text-xs">アップロードしたデータはstagingに保存されます。casesテーブル（本番データ）は変更されません。</p>
            </div>
          </div>

          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors cursor-pointer',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-base font-medium text-foreground">
              Excelファイルをドロップ
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              または クリックしてファイルを選択
            </p>
            <p className="text-xs text-muted-foreground mt-2">.xlsx / .xls</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Upload className="h-4 w-4 animate-bounce" />
              シート一覧を取得中...
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2: シート選択 ──────────────────────────────────────────────── */}
      {step === 'sheet_select' && session && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-5">
          <div>
            <p className="text-sm text-muted-foreground">
              ファイル: <span className="font-medium text-foreground">{session.filename}</span>
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              シート数: {session.available_sheets.length}件
            </p>
          </div>

          {/* 提案シート */}
          {session.suggested_sheets.length > 0 && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3">
              <p className="text-sm font-medium text-green-800 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                1月問合せ系シートを自動検出しました
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {session.suggested_sheets.map(s => (
                  <button
                    key={s}
                    onClick={() => setSelectedSheet(s)}
                    className={cn(
                      'rounded-md px-3 py-1 text-sm font-medium border transition-colors',
                      selectedSheet === s
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 全シート一覧 */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">全シート一覧</p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {session.available_sheets.map(s => {
                const isSuggested = session.suggested_sheets.includes(s)
                return (
                  <label
                    key={s}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                      selectedSheet === s ? 'bg-primary/5' : 'hover:bg-muted/40'
                    )}
                  >
                    <input
                      type="radio"
                      name="sheet"
                      value={s}
                      checked={selectedSheet === s}
                      onChange={() => setSelectedSheet(s)}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground flex-1">{s}</span>
                    {isSuggested && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 font-medium">
                        推奨
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          {/* 警告 */}
          {selectedSheet && !session.suggested_sheets.includes(selectedSheet) && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>「1月問合せ」系以外のシートが選択されています。内容をよく確認してください。</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleParse}
              disabled={!selectedSheet || loading}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '解析中...' : 'このシートを読み込む'}
            </button>
            <button onClick={handleReset} className="text-sm text-muted-foreground hover:underline">
              最初からやり直す
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: プレビュー確認 ──────────────────────────────────────────── */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* サマリー */}
          <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">対象シート</span>
              <p className="font-medium text-foreground mt-0.5">{preview.sheet_name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">読み取り件数</span>
              <p className="font-semibold text-foreground mt-0.5 text-lg">{preview.total_rows}件</p>
            </div>
            {preview.error_rows.length > 0 && (
              <div>
                <span className="text-muted-foreground">エラー行</span>
                <p className="font-semibold text-red-600 mt-0.5 text-lg">{preview.error_rows.length}件</p>
              </div>
            )}
            <div className="flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0" />
              casesテーブルはまだ変更されていません
            </div>
          </div>

          {/* エラー行 */}
          {preview.error_rows.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-700 mb-2">
                解析エラー行（{preview.error_rows.length}件）
              </p>
              <div className="space-y-1">
                {preview.error_rows.map((e: ImportErrorRow) => (
                  <p key={e.row} className="text-xs text-red-600">
                    行 {e.row}: {e.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* プレビューテーブル */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {[
                      '行', '会社名', '担当者名', '電話番号', 'メール',
                      '問合せ日', '開催日', 'イベント内容', 'フロア',
                      '認知経路', '連絡方法', '見込み金額', 'ステータス', '備考',
                    ].map(h => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((row: ParsedRow) => (
                    <tr key={row.row} className="hover:bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground">{row.row}</td>
                      <td className="px-3 py-2 max-w-[140px] truncate font-medium">{row.company ?? '—'}</td>
                      <td className="px-3 py-2 max-w-[100px] truncate">{row.contact ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.phone ?? '—'}</td>
                      <td className="px-3 py-2 max-w-[120px] truncate">{row.email ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.inquiry_date ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.event_date ?? '—'}</td>
                      <td className="px-3 py-2 max-w-[100px] truncate">{row.event_category_raw ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.floor_raw ?? '—'}</td>
                      <td className="px-3 py-2 max-w-[120px] truncate">{row.media_raw ?? '—'}</td>
                      <td className="px-3 py-2 max-w-[100px] truncate">{row.contact_method_raw ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
                        {row.estimate_amount != null
                          ? `¥${row.estimate_amount.toLocaleString()}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusBadge status={row.status_raw} />
                      </td>
                      <td className="px-3 py-2 max-w-[150px] truncate text-muted-foreground">
                        {row.notes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 操作ボタン */}
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
            <p className="text-sm font-medium text-orange-800">Staging保存の確認</p>
            <p className="text-xs text-orange-700">
              上記 {preview.total_rows}件 を staging に保存します。
              <strong>casesテーブル（本番データ）は変更されません。</strong>
              保存後、次のフェーズで行ごとに承認/スキップを選んでから本番反映します。
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleStage}
                disabled={loading}
                className="rounded-md bg-orange-600 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '保存中...' : `Staging保存（${preview.total_rows}件）`}
              </button>
              <button onClick={handleReset} className="text-sm text-muted-foreground hover:underline">
                最初からやり直す
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: 完了 ────────────────────────────────────────────────────── */}
      {step === 'done' && stageResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-6 w-6" />
            <p className="text-lg font-semibold">Staging保存が完了しました</p>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-28">Batch ID</span>
              <code className="rounded bg-white border border-green-200 px-2 py-0.5 text-xs font-mono text-green-800 break-all">
                {stageResult.batch_id}
              </code>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-28">保存件数</span>
              <span className="font-medium text-foreground">{stageResult.total_rows}件</span>
            </div>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            <p className="font-medium">次のステップ</p>
            <p className="text-xs mt-1">照合・承認画面で既存データとの重複チェックを行い、反映する行を選んでください。casesテーブルへの反映はその画面で行います。</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href={`/import/batch/${stageResult.batch_id}`}
              className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              照合・承認画面へ
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              onClick={handleReset}
              className="rounded-md border border-green-300 bg-white px-4 py-2 text-sm text-green-700 hover:bg-green-50"
            >
              別のファイルをインポートする
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ステータスバッジ（ローカルコンポーネント）─────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { label: string; className: string }> = {
    inquiry:     { label: '新規問合せ', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    preview_adj: { label: '下見調整中', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    previewed:   { label: '下見済み',   className: 'bg-purple-50 text-purple-700 border-purple-200' },
    tentative:   { label: '仮押さえ',   className: 'bg-orange-50 text-orange-700 border-orange-200' },
    confirmed:   { label: '確定',       className: 'bg-green-50 text-green-700 border-green-200' },
    cancelled:   { label: 'キャンセル', className: 'bg-red-50 text-red-700 border-red-200' },
    done:        { label: '開催終了',   className: 'bg-gray-50 text-gray-600 border-gray-200' },
  }
  const cfg = MAP[status] ?? { label: status, className: 'bg-gray-50 text-gray-600 border-gray-200' }
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-xs whitespace-nowrap', cfg.className)}>
      {cfg.label}
    </span>
  )
}
