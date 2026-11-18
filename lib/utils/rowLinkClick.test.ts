/**
 * 日別問合せ PC用案件表の「行クリック」判定（lib/utils/rowLinkClick.ts）の自動テスト。node:test、追加の依存関係なし。
 * 実行: node --test lib/utils/rowLinkClick.test.ts
 * ブラウザ・ネットワーク・DB・顧客データには一切触れない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shouldActivateRowLink, type RowClickInput } from './rowLinkClick.ts'

const plainOutsideLink: RowClickInput = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  insideInteractive: false,
  hasTextSelection: false,
}

describe('shouldActivateRowLink', () => {
  test('リンク外（案件名・分類・ステータス・金額・会社名セルの余白）の通常クリック → 起動する', () => {
    assert.equal(shouldActivateRowLink(plainOutsideLink), true)
  })

  test('会社名リンク自身（操作要素の中）のクリック → 起動しない（リンク側の処理に任せる）', () => {
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, insideInteractive: true }), false)
  })

  test('文字選択（ドラッグ）が残っている → 起動しない', () => {
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, hasTextSelection: true }), false)
  })

  test('Ctrl / Cmd / Shift / Alt を押している → 起動しない', () => {
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, ctrlKey: true }), false)
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, metaKey: true }), false)
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, shiftKey: true }), false)
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, altKey: true }), false)
  })

  test('主ボタン以外（中・右クリック）→ 起動しない', () => {
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, button: 1 }), false)
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, button: 2 }), false)
  })

  test('既に defaultPrevented → 起動しない', () => {
    assert.equal(shouldActivateRowLink({ ...plainOutsideLink, defaultPrevented: true }), false)
  })

  test('複数の抑止条件が重なっても起動しない', () => {
    assert.equal(
      shouldActivateRowLink({ ...plainOutsideLink, insideInteractive: true, hasTextSelection: true, metaKey: true }),
      false
    )
  })
})
