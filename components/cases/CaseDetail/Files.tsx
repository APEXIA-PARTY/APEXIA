'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload,
  Trash2,
  Download,
  FileText,
  ImageIcon,
  File,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils/cn'
import { formatDateTime } from '@/lib/utils/format'

type FileType = '見積書' | '請求書' | '進行表' | 'レイアウト図' | 'その他'
const FILE_TYPES: FileType[] = ['見積書', '請求書', '進行表', 'レイアウト図', 'その他']
const MAX_FILE_SIZE_MB = 50

interface CaseFileMeta {
  id: string
  case_id: string
  file_type: FileType
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  label: string | null
  sort_order: number
  created_at: string
}

interface FileWithUrl extends CaseFileMeta {
  signedUrl?: string
  urlLoading?: boolean
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function FileTypeIcon({ mimeType }: { mimeType: string | null }) {
  if (mimeType?.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-blue-500" />
  if (mimeType === 'application/pdf') return <FileText className="h-5 w-5 text-red-500" />
  return <File className="h-5 w-5 text-muted-foreground" />
}

interface Props {
  caseId: string
  isEditable: boolean
}

export function CaseFilesSection({ caseId, isEditable }: Props) {
  const [files, setFiles] = useState<FileWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [previewFile, setPreviewFile] = useState<FileWithUrl | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const layoutInputRef = useRef<HTMLInputElement>(null)

  const fetchFiles = useCallback(async () => {
    const res = await fetch(`/api/cases/${caseId}/files`)
    if (!res.ok) return
    const data: CaseFileMeta[] = await res.json()
    setFiles(data.map((f) => ({ ...f })))
    setLoading(false)
  }, [caseId])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const fetchSignedUrl = useCallback(
    async (fileId: string): Promise<string | null> => {
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, urlLoading: true } : f)))
      try {
        const res = await fetch(`/api/cases/${caseId}/files/${fileId}/url`)
        if (!res.ok) {
          toast.error('URLの取得に失敗しました')
          return null
        }
        const { url } = await res.json()
        setFiles((prev) =>
          prev.map((f) => (f.id === fileId ? { ...f, signedUrl: url, urlLoading: false } : f))
        )
        return url
      } catch {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, urlLoading: false } : f)))
        return null
      }
    },
    [caseId]
  )

  const openPreview = async (file: FileWithUrl) => {
    let url = file.signedUrl
    if (!url) url = (await fetchSignedUrl(file.id)) ?? undefined
    if (url) setPreviewFile({ ...file, signedUrl: url })
    else toast.error('プレビューURLの取得に失敗しました')
  }

  const handleDownload = async (file: FileWithUrl) => {
    let url = file.signedUrl
    if (!url) url = (await fetchSignedUrl(file.id)) ?? undefined
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = file.file_name
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const openInNewTab = async (file: FileWithUrl) => {
    let url = file.signedUrl
    if (!url) url = (await fetchSignedUrl(file.id)) ?? undefined
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const uploadFiles = async (fileList: FileList, forceType?: FileType) => {
    setUploading(true)
    const errors: string[] = []

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        errors.push(`${file.name}: ${MAX_FILE_SIZE_MB}MB を超えています`)
        continue
      }

      const guessType = (): FileType => {
        if (forceType) return forceType
        const n = file.name.toLowerCase()
        if (n.includes('見積')) return '見積書'
        if (n.includes('請求')) return '請求書'
        if (n.includes('進行') || n.includes('タイムテーブル')) return '進行表'
        if (n.includes('レイアウト') || n.includes('平面')) return 'レイアウト図'
        return 'その他'
      }

      const form = new FormData()
      form.append('file', file)
      form.append('file_type', guessType())
      form.append('sort_order', String(files.length))

      const res = await fetch(`/api/cases/${caseId}/files`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        errors.push(`${file.name}: ${err.message ?? 'アップロード失敗'}`)
      }
    }

    if (errors.length > 0) errors.forEach((e) => toast.error(e))
    else toast.success('アップロードしました')

    await fetchFiles()
    setUploading(false)
  }

  const updateFileType = async (id: string, fileType: FileType) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, file_type: fileType } : f)))
    await fetch(`/api/cases/${caseId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, file_type: fileType }),
    })
  }

  const updateLabel = async (id: string, label: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, label: label || null } : f)))
    await fetch(`/api/cases/${caseId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label: label || null }),
    })
  }

  const deleteFile = async (file: FileWithUrl) => {
    if (!window.confirm(`「${file.file_name}」を削除しますか？`)) return
    const res = await fetch(`/api/cases/${caseId}/files/${file.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('削除に失敗しました')
      return
    }
    setFiles((prev) => prev.filter((f) => f.id !== file.id))
    if (previewFile?.id === file.id) setPreviewFile(null)
    toast.success('削除しました')
  }

  const layoutFiles = files.filter((f) => f.file_type === 'レイアウト図')
  const otherFiles = files.filter((f) => f.file_type !== 'レイアウト図')

  if (loading) return <div className="h-24 animate-pulse rounded-lg bg-muted/40" />

  return (
    <div className="space-y-4">
      {/* ⑦ 添付ファイル */}
      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="text-sm font-semibold">⑦ 添付ファイル</h2>
          <span className="text-xs text-muted-foreground">{otherFiles.length} 件</span>
        </div>

        <div className="p-5 space-y-4">
          {isEditable && (
            <div
              ref={dropRef}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-7 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5',
                uploading && 'pointer-events-none opacity-50'
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                dropRef.current?.classList.add('border-primary', 'bg-primary/5')
              }}
              onDragLeave={() => {
                dropRef.current?.classList.remove('border-primary', 'bg-primary/5')
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropRef.current?.classList.remove('border-primary', 'bg-primary/5')
                if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadFiles(e.target.files)}
              />
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>アップロード中...</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span>クリックまたはドラッグ＆ドロップ</span>
                  <span className="text-xs">
                    PDF・画像・Excel・Word など（最大 {MAX_FILE_SIZE_MB}MB）
                  </span>
                </>
              )}
            </div>
          )}

          {otherFiles.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-2">ファイルがありません</p>
          ) : (
            <div className="space-y-2">
              {otherFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
                >
                  <button
                    onClick={() => openPreview(f)}
                    className="shrink-0 hover:opacity-70"
                    title="プレビュー"
                  >
                    <FileTypeIcon mimeType={f.mime_type} />
                  </button>

                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => openPreview(f)}
                      className="block text-sm font-medium truncate hover:underline text-left"
                    >
                      {f.file_name}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(f.created_at)}
                      {f.file_size ? ` · ${formatSize(f.file_size)}` : ''}
                    </p>
                  </div>

                  {isEditable ? (
                    <select
                      value={f.file_type}
                      onChange={(e) => updateFileType(f.id, e.target.value as FileType)}
                      className="rounded border border-input bg-background px-2 py-1 text-xs"
                    >
                      {FILE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                      {f.file_type}
                    </span>
                  )}

                  <button
                    onClick={() => handleDownload(f)}
                    disabled={f.urlLoading}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary disabled:opacity-50"
                    title="ダウンロード"
                  >
                    {f.urlLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>

                  {isEditable && (
                    <button
                      onClick={() => deleteFile(f)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                      title="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ⑧ レイアウト図 */}
      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="text-sm font-semibold">⑧ レイアウト図</h2>
          <span className="text-xs text-muted-foreground">{layoutFiles.length} 件</span>
        </div>

        <div className="p-5 space-y-4">
          {isEditable && (
            <>
              <input
                ref={layoutInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => e.target.files && uploadFiles(e.target.files, 'レイアウト図')}
              />
              <button
                onClick={() => layoutInputRef.current?.click()}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
              >
                <ImageIcon className="h-4 w-4" />
                レイアウト図を追加（画像・PDF対応）
              </button>
            </>
          )}

          {layoutFiles.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-2">レイアウト図がありません</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {layoutFiles.map((f) => (
                <LayoutCard
                  key={f.id}
                  file={f}
                  isEditable={isEditable}
                  onPreview={() => openPreview(f)}
                  onDownload={() => handleDownload(f)}
                  onOpenNewTab={() => openInNewTab(f)}
                  onLabelChange={(label) => updateLabel(f.id, label)}
                  onDelete={() => deleteFile(f)}
                  onFetchUrl={() => fetchSignedUrl(f.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* プレビューモーダル */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <p className="text-sm font-medium truncate">{previewFile.label || previewFile.file_name}</p>
              <div className="flex shrink-0 items-center gap-2 ml-4">
                <button
                  onClick={() => handleDownload(previewFile)}
                  className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1 text-xs hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                  DL
                </button>

                {previewFile.signedUrl && (
                  <a
                    href={previewFile.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1 text-xs hover:bg-muted"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    新しいタブ
                  </a>
                )}

                <button
                  onClick={() => setPreviewFile(null)}
                  className="rounded-md border border-input px-3 py-1 text-xs hover:bg-muted"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-muted/20">
              {!previewFile.signedUrl ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : previewFile.mime_type?.startsWith('image/') ? (
                <img
                  src={previewFile.signedUrl}
                  alt={previewFile.file_name}
                  className="max-h-[75vh] w-full object-contain"
                />
              ) : previewFile.mime_type === 'application/pdf' ? (
                <iframe
                  src={previewFile.signedUrl}
                  className="h-[80vh] w-full bg-white"
                  title={previewFile.file_name}
                />
              ) : (
                <div className="flex h-48 flex-col items-center justify-center gap-3">
                  <File className="h-12 w-12 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{previewFile.file_name}</p>
                  <button
                    onClick={() => handleDownload(previewFile)}
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
                  >
                    ダウンロード
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LayoutCard({
  file,
  isEditable,
  onPreview,
  onDownload,
  onOpenNewTab,
  onLabelChange,
  onDelete,
  onFetchUrl,
}: {
  file: FileWithUrl
  isEditable: boolean
  onPreview: () => void
  onDownload: () => void
  onOpenNewTab: () => void
  onLabelChange: (l: string) => void
  onDelete: () => void
  onFetchUrl: () => Promise<string | null>
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(file.signedUrl ?? null)
  const [thumbLoading, setThumbLoading] = useState(false)

  const isImage = file.mime_type?.startsWith('image/')
  const isPdf = file.mime_type === 'application/pdf'

  useEffect(() => {
    if (!thumbUrl) {
      setThumbLoading(true)
      onFetchUrl().then((url) => {
        setThumbUrl(url)
        setThumbLoading(false)
      })
    }
  }, []) // eslint-disable-line

  const thumb = () => {
    if (thumbLoading) {
      return (
        <div className="flex h-40 items-center justify-center bg-muted/40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }

    if (isImage) {
      return thumbUrl ? (
        <img src={thumbUrl} alt={file.label ?? file.file_name} className="h-40 w-full object-cover" />
      ) : (
        <div className="flex h-40 items-center justify-center bg-muted/40">
          <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )
    }

    if (isPdf) {
      return thumbUrl ? (
        <iframe
          src={thumbUrl}
          className="h-40 w-full bg-white"
          title={file.file_name}
        />
      ) : (
        <div className="flex h-40 items-center justify-center bg-muted/40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }

    return (
      <div className="flex h-40 items-center justify-center bg-muted/40">
        <File className="h-8 w-8 text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/20">
      <button onClick={onPreview} className="block w-full text-left" title="クリックしてプレビュー">
        {thumb()}
      </button>

      <div className="space-y-2 px-3 py-2">
        {isEditable ? (
          <input
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            defaultValue={file.label ?? ''}
            placeholder="ラベル（例: 7F用）"
            onBlur={(e) => onLabelChange(e.target.value)}
          />
        ) : (
          <p className="text-xs font-medium break-all">
            {file.label || <span className="text-muted-foreground/50">{file.file_name}</span>}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onPreview}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            開く
          </button>

          <button
            onClick={onDownload}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            DL
          </button>

          <button
            onClick={onOpenNewTab}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            新しいタブ
          </button>
        </div>
      </div>

      {isEditable && (
        <button
          onClick={onDelete}
          className="absolute right-1.5 top-1.5 rounded bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
          title="削除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}