/**
 * ⑧ レイアウト図へのファイル追加（ドラッグ＆ドロップ）の判定ロジック。
 * components/cases/CaseDetail/Files.tsx から使う純粋関数のみ（React / Next.js / Supabase に依存しない）。
 *
 * レイアウト図に追加できるのは「画像」と「PDF」だけ。
 * ・クリックで選ぶ場合は <input accept="image/*,application/pdf"> がブラウザ側で絞り込む
 * ・ドラッグ＆ドロップでは accept が効かないため、ここで判定する
 * アップロード自体は既存の uploadFiles（POST /api/cases/[id]/files）をそのまま使う。API / Storage は変更しない。
 */

export const LAYOUT_FILE_TYPE = 'レイアウト図' as const

/** MIME が空のときだけ拡張子で判定する（OS / ブラウザによって HEIC などの MIME が空になることがあるため） */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg']
const PDF_EXTENSIONS = ['pdf']

interface FileLike {
  name: string
  type: string
}

const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/**
 * レイアウト図として受け付けるか。
 *  ・image/*（HEIC を含む）と application/pdf は許可
 *  ・MIME が空の場合だけ、拡張子（画像・PDF）で判定。既存の運用（HEIC の保存実績）を壊さない
 *  ・それ以外の MIME（Excel・Word・zip・テキストなど）は不許可。
 *    application/octet-stream も許可しない（サーバー側の許可 MIME と同じ扱い）
 */
export function isLayoutFileAcceptable(file: FileLike): boolean {
  const type = (file.type ?? '').toLowerCase()
  if (type === '') {
    const ext = extensionOf(file.name)
    return IMAGE_EXTENSIONS.includes(ext) || PDF_EXTENSIONS.includes(ext)
  }
  return type.startsWith('image/') || type === 'application/pdf'
}

export function partitionLayoutFiles<T extends FileLike>(files: ArrayLike<T>): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = []
  const rejected: T[] = []
  for (const f of Array.from(files)) (isLayoutFileAcceptable(f) ? accepted : rejected).push(f)
  return { accepted, rejected }
}

/** 対象外ファイルをドロップしたときの通知文 */
export function layoutRejectedMessage(rejected: FileLike[]): string {
  const names = rejected.map((f) => f.name).join('、')
  return `レイアウト図は画像・PDFのみ対応しています（${names}）`
}

/**
 * ドロップされたファイルの処理。
 *  ・画像・PDF だけを upload(files, 'レイアウト図') へ渡す（既存のアップロード処理を再利用）
 *  ・対象外のファイルがあれば notifyRejected で通知し、そのファイルはアップロードしない
 *  ・対象が 1 つも無ければ upload を呼ばない
 */
export function processLayoutDrop<T extends FileLike>(
  files: ArrayLike<T>,
  deps: {
    upload: (files: T[], fileType: typeof LAYOUT_FILE_TYPE) => unknown
    notifyRejected: (message: string) => void
  }
): { accepted: number; rejected: number } {
  const { accepted, rejected } = partitionLayoutFiles(files)
  if (rejected.length > 0) deps.notifyRejected(layoutRejectedMessage(rejected))
  if (accepted.length > 0) deps.upload(accepted, LAYOUT_FILE_TYPE)
  return { accepted: accepted.length, rejected: rejected.length }
}
