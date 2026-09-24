/**
 * formatCurrencyShort の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/format.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 *
 * Phase 2B: toFixed(1) 後に結果が整数になる場合だけ、
 * 不要な末尾「.0」を表示しない仕様を固定するためのテスト。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatCurrencyShort } from './format.ts'

describe('formatCurrencyShort', () => {
  test('null / undefined → —', () => {
    assert.equal(formatCurrencyShort(null), '—')
    assert.equal(formatCurrencyShort(undefined), '—')
  })

  test('0 → 0円', () => {
    assert.equal(formatCurrencyShort(0), '0円')
  })

  test('1万円未満は円表示（カンマ区切り）', () => {
    assert.equal(formatCurrencyShort(1), '1円')
    assert.equal(formatCurrencyShort(999), '999円')
    assert.equal(formatCurrencyShort(9999), '9,999円')
  })

  test('1万円ちょうど → 1万円', () => {
    assert.equal(formatCurrencyShort(10000), '1万円')
  })

  test('回帰テスト: 末尾の不要な.0が表示されない', () => {
    assert.equal(formatCurrencyShort(10001), '1万円')
    assert.equal(formatCurrencyShort(99999), '10万円')
    assert.equal(formatCurrencyShort(9999999), '1000万円')
    assert.equal(formatCurrencyShort(10000000), '1000万円')
  })

  test('通常の小数第1位表示は維持される', () => {
    assert.equal(formatCurrencyShort(1124000), '112.4万円')
    assert.equal(formatCurrencyShort(1310000), '131万円')
    assert.equal(formatCurrencyShort(7041000), '704.1万円')
    assert.equal(formatCurrencyShort(21371000), '2137.1万円')
  })

  test('大きな値（12372万円付近）で.0が発生しない', () => {
    assert.equal(formatCurrencyShort(123719999), '12372万円')
    assert.equal(formatCurrencyShort(123720000), '12372万円')
    assert.equal(formatCurrencyShort(123720001), '12372万円')
  })

  test('四捨五入の境界値（.5への丸め）は従来どおり', () => {
    assert.equal(formatCurrencyShort(14950), '1.5万円')
    assert.equal(formatCurrencyShort(123724999), '12372.5万円')
    assert.equal(formatCurrencyShort(123725000), '12372.5万円')
  })
})
