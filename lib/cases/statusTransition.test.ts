/**
 * shouldSetConfirmedAt の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/statusTransition.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shouldSetConfirmedAt } from './statusTransition.ts'

describe('shouldSetConfirmedAt', () => {
  test('問合せ→確定：収益ステータスへ新規突入 → true', () => {
    assert.equal(shouldSetConfirmedAt('inquiry', 'confirmed'), true)
  })

  test('新規作成時に旧ステータスがない（undefined）→ 新ステータスが確定なら true', () => {
    assert.equal(shouldSetConfirmedAt(undefined, 'confirmed'), true)
  })

  test('新規作成時に旧ステータスがない（null）→ 新ステータスが確定なら true', () => {
    assert.equal(shouldSetConfirmedAt(null, 'confirmed'), true)
  })

  test('確定を飛ばして直接「終了(done)」になるケース → true', () => {
    assert.equal(shouldSetConfirmedAt('inquiry', 'done'), true)
    assert.equal(shouldSetConfirmedAt(undefined, 'done'), true)
  })

  test('確定→確定（他項目だけ編集して再保存、実質変化なし）→ false（再スタンプしない）', () => {
    assert.equal(shouldSetConfirmedAt('confirmed', 'confirmed'), false)
  })

  test('確定→終了(done)：既に収益ステータス内の遷移 → false', () => {
    assert.equal(shouldSetConfirmedAt('confirmed', 'done'), false)
  })

  test('終了(done)→確定：既に収益ステータス内の遷移 → false', () => {
    assert.equal(shouldSetConfirmedAt('done', 'confirmed'), false)
  })

  test('確定→キャンセル：confirmed_atは消さない方針のためセットもしない → false', () => {
    assert.equal(shouldSetConfirmedAt('confirmed', 'cancelled'), false)
  })

  test('キャンセル→確定（再確定）：収益ステータスへ再突入 → true（呼び出し側で上書きする）', () => {
    assert.equal(shouldSetConfirmedAt('cancelled', 'confirmed'), true)
  })

  test('キャンセル→キャンセル（変化なし）→ false', () => {
    assert.equal(shouldSetConfirmedAt('cancelled', 'cancelled'), false)
  })

  test('新ステータスが指定されない（ステータスに触れない更新）→ false', () => {
    assert.equal(shouldSetConfirmedAt('inquiry', undefined), false)
    assert.equal(shouldSetConfirmedAt('confirmed', undefined), false)
    assert.equal(shouldSetConfirmedAt('inquiry', null), false)
  })

  test('問合せ→下見調整中・下見済み・仮押さえ：いずれも収益ステータスではない → false', () => {
    assert.equal(shouldSetConfirmedAt('inquiry', 'preview_adj'), false)
    assert.equal(shouldSetConfirmedAt('inquiry', 'previewed'), false)
    assert.equal(shouldSetConfirmedAt('inquiry', 'tentative'), false)
  })
})
