/**
 * 日別問合せのPC用案件表で、「行のリンク外」を押したときに、その行の既存リンクを起動するかの判定。
 * 遷移処理そのもの（from/nav の付与・sessionStorage の記録・戻る機能）は CaseDetailLink が唯一の入口で、
 * ここでは判定だけを行う（DOM・ブラウザAPI非依存の純粋関数）。
 *
 * 起動するのは、次をすべて満たす通常クリックだけ。
 *  ・主ボタン（button=0）で、Ctrl・Cmd・Shift・Alt のいずれも押していない
 *  ・クリック位置が、リンク・ボタン・入力欄などの操作要素の中ではない（リンク自身のクリックは、リンク側の処理に任せる）
 *  ・文字の選択（ドラッグ）が残っていない（選択目的のドラッグでは遷移させない）
 */

export interface RowClickInput {
  button: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented?: boolean
  /** クリック位置が a / button / input / select / textarea の中 */
  insideInteractive: boolean
  /** 文字が選択されている（折りたたまれていない選択範囲があり、空白以外の文字を含む） */
  hasTextSelection: boolean
}

export function shouldActivateRowLink(input: RowClickInput): boolean {
  if (input.defaultPrevented) return false
  if (input.button !== 0) return false
  if (input.ctrlKey || input.metaKey || input.shiftKey || input.altKey) return false
  if (input.insideInteractive) return false
  if (input.hasTextSelection) return false
  return true
}
