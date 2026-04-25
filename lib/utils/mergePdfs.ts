/**
 * lib/utils/mergePdfs.ts
 *
 * pdf-lib を使って複数の PDF Buffer を1つに結合するユーティリティ。
 *
 * 設計:
 *   - appendBuffers が空でも落ちない（baseBuffer をそのまま返す）
 *   - 1件の結合失敗でも全体を止めない（スキップして次へ）
 *   - DB・Storage への書き込みは一切しない（変換のみ）
 */

import { PDFDocument } from 'pdf-lib'

/**
 * baseBuffer の後ろに appendBuffers を順番に結合して返す。
 *
 * @param baseBuffer    メインのPDF（案件確認票）
 * @param appendBuffers 後ろに追加するPDF配列（レイアウト図など）
 * @returns             結合済みPDFの Uint8Array
 */
export async function mergePdfs(
  baseBuffer: Buffer | Uint8Array,
  appendBuffers: (Buffer | Uint8Array)[],
): Promise<Uint8Array> {
  const merged = await PDFDocument.load(baseBuffer)

  for (const buf of appendBuffers) {
    try {
      const doc   = await PDFDocument.load(buf)
      // getPageIndices() で全ページのインデックス配列を取得し copyPages でコピー
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } catch (err) {
      // 1件失敗しても残りを続ける
      console.error('[mergePdfs] PDF結合スキップ', err)
    }
  }

  return merged.save()
}