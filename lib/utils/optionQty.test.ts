/**
 * 機材・オペレーター数量（小数対応）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/optionQty.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  qtyStep,
  qtyMin,
  parseQtyInput,
  hasAtMostOneDecimal,
  formatQty,
  calcOptionAmount,
  calcOptionSubtotalInclTax,
} from './optionQty.ts'

describe('parseQtyInput（機材・オペレーター）', () => {
  test('0.1 / 0.5 / 1 / 1.2 / 1.5 / 2 / 2.5 / 10.9 は小数のまま number で返る（切り捨て・丸めされない）', () => {
    for (const [raw, expected] of [
      ['0.1', 0.1], ['0.5', 0.5], ['1', 1], ['1.2', 1.2], ['1.5', 1.5], ['2', 2], ['2.5', 2.5], ['10.9', 10.9],
    ] as const) {
      assert.deepEqual(parseQtyInput(raw, 'machine'), { ok: true, value: expected })
    }
  })

  test('末尾ゼロ付きの入力（1.0 / 1.20）も値として正しく扱う', () => {
    assert.deepEqual(parseQtyInput('1.0', 'machine'), { ok: true, value: 1 })
    assert.deepEqual(parseQtyInput('1.20', 'machine'), { ok: true, value: 1.2 })
  })

  test('小数第2位以下は不可（1.23 / 1.234 / 0.25 / 0.05 / 2.01）', () => {
    for (const raw of ['1.23', '1.234', '0.25', '0.05', '2.01', '0.001']) {
      assert.equal(parseQtyInput(raw, 'machine').ok, false, raw)
    }
  })

  test('空・0・負数・数値でない値は不可', () => {
    for (const raw of ['', '  ', '0', '0.0', '-1', '-0.5', '-0.1', 'abc', 'NaN', 'Infinity']) {
      assert.equal(parseQtyInput(raw, 'machine').ok, false, raw)
    }
  })

  test('整数は従来どおり（大きな整数も可）', () => {
    for (const n of [1, 2, 3, 10, 100, 9999]) {
      assert.deepEqual(parseQtyInput(String(n), 'machine'), { ok: true, value: n })
    }
  })
})

describe('parseQtyInput（備品・設備は従来どおり整数のみ）', () => {
  test('整数は可、小数は不可', () => {
    assert.deepEqual(parseQtyInput('3', 'equipment'), { ok: true, value: 3 })
    assert.equal(parseQtyInput('1.5', 'equipment').ok, false)
    assert.equal(parseQtyInput('0', 'equipment').ok, false)
  })
})

describe('qtyStep / qtyMin', () => {
  test('機材・オペレーターは 0.1 刻み、備品・設備は 1 刻み', () => {
    assert.equal(qtyStep('machine'), 0.1)
    assert.equal(qtyMin('machine'), 0.1)
    assert.equal(qtyStep('equipment'), 1)
    assert.equal(qtyMin('equipment'), 1)
  })
})

describe('hasAtMostOneDecimal', () => {
  test('小数第1位まで true（浮動小数の誤差があっても）', () => {
    for (const v of [0.1, 0.5, 1, 1.2, 1.5, 2.5, 10.9, 0.7, 3.3, 99999.9]) {
      assert.equal(hasAtMostOneDecimal(v), true, String(v))
    }
  })

  test('小数第2位以下は false', () => {
    for (const v of [1.23, 1.234, 0.25, 0.05, 0.01, 2.001]) {
      assert.equal(hasAtMostOneDecimal(v), false, String(v))
    }
  })
})

describe('formatQty', () => {
  test('不要な小数点を出さない', () => {
    assert.equal(formatQty(1), '1')
    assert.equal(formatQty(1.5), '1.5')
    assert.equal(formatQty(2.5), '2.5')
    assert.equal(formatQty(0.5), '0.5')
    assert.equal(formatQty(0.1), '0.1')
    assert.equal(formatQty(1.2), '1.2')
    assert.equal(formatQty(10.9), '10.9')
    // PostgREST が NUMERIC を "2.00" ではなく数値で返す前提だが、文字列でも崩れない
    assert.equal(formatQty('2.00' as unknown as number), '2')
  })

  test('null / undefined → —', () => {
    assert.equal(formatQty(null), '—')
    assert.equal(formatQty(undefined), '—')
  })
})

describe('小計計算', () => {
  test('単価 ¥120,000 × 1.5 = ¥180,000（税抜）/ ¥198,000（税込表示）', () => {
    assert.equal(calcOptionAmount(1.5, 120000), 180000)
    assert.equal(calcOptionSubtotalInclTax(1.5, 120000), 198000)
  })

  test('単価 ¥120,000 × 1.2 = ¥144,000（税抜）/ ¥158,400（税込表示）', () => {
    assert.equal(calcOptionAmount(1.2, 120000), 144000)
    assert.equal(calcOptionSubtotalInclTax(1.2, 120000), 158400)
  })

  test('単価 ¥120,000 × 0.1 = ¥12,000（税抜）/ ¥13,200（税込表示）', () => {
    assert.equal(calcOptionAmount(0.1, 120000), 12000)
    assert.equal(calcOptionSubtotalInclTax(0.1, 120000), 13200)
  })

  test('10.9 の小計（浮動小数の誤差が出ない）', () => {
    assert.equal(calcOptionAmount(10.9, 120000), 1308000)
    assert.equal(calcOptionSubtotalInclTax(10.9, 120000), 1438800)
  })

  test('0.5 / 2.5 / 1 / 2 の小計', () => {
    assert.equal(calcOptionAmount(0.5, 120000), 60000)
    assert.equal(calcOptionAmount(2.5, 120000), 300000)
    assert.equal(calcOptionAmount(1, 120000), 120000)
    assert.equal(calcOptionAmount(2, 120000), 240000)
    assert.equal(calcOptionSubtotalInclTax(2.5, 120000), 330000)
  })

  test('円未満は四捨五入（DB の ROUND(qty * unit_price) と同じ）', () => {
    assert.equal(calcOptionAmount(0.5, 12345), 6173) // 6172.5 → 6173
    assert.equal(calcOptionAmount(1.5, 3333), 5000) // 4999.5 → 5000
  })

  test('回帰: 整数数量の結果は従来の計算式 Math.round(qty * unit_price * 1.1) と完全に一致する', () => {
    for (const qty of [1, 2, 3, 5, 10, 24]) {
      for (const price of [0, 1, 999, 1000, 8000, 12345, 120000, 333333]) {
        assert.equal(calcOptionSubtotalInclTax(qty, price), Math.round(qty * price * 1.1))
        assert.equal(calcOptionAmount(qty, price), qty * price)
      }
    }
  })

  test('qty / unit_price が null・undefined でも落ちない（従来の ?? フォールバックを維持）', () => {
    assert.equal(calcOptionAmount(null, 1000), 1000)
    assert.equal(calcOptionAmount(2, undefined), 0)
    assert.equal(calcOptionSubtotalInclTax(undefined, null), 0)
  })
})
