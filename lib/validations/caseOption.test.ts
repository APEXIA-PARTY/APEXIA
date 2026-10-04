/**
 * case_options API の数量バリデーション（小数対応）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/validations/caseOption.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。
 * route.ts / migration は文字列として読み取るだけで、実行・適用はしない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optionItemSchema, optionUpdateSchema, optionQtySchema } from './caseOption.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const ID = '11111111-1111-4111-8111-111111111111'
const base = { name: '音響オペレーター', category: 'machine', machine_category: '音響' }

describe('optionQtySchema', () => {
  test('0.1 / 0.5 / 1 / 1.2 / 1.5 / 2.5 / 10.9 を許可し、値は変換されない', () => {
    for (const v of [0.1, 0.5, 1, 1.2, 1.5, 2, 2.5, 10.9]) {
      const r = optionQtySchema.safeParse(v)
      assert.ok(r.success, String(v))
      assert.equal(r.data, v)
    }
  })

  test('0・負数・小数第2位以下・極端に大きい値・数値以外は不可', () => {
    for (const v of [0, -1, -0.5, -0.1, 1.23, 1.234, 0.25, 0.05, 0.001, 1000000, '1.5', null, NaN]) {
      assert.equal(optionQtySchema.safeParse(v).success, false, String(v))
    }
  })
})

describe('POST スキーマ（optionItemSchema）', () => {
  test('機材・オペレーター: qty 0.1 / 1.2 / 1.5 / 10.9 の追加を許可し、小数のまま渡す', () => {
    for (const q of [0.1, 1.2, 1.5, 10.9]) {
      const r = optionItemSchema.safeParse({ ...base, qty: q, unit_price: 120000 })
      assert.ok(r.success, String(q))
      assert.equal(r.data.qty, q)
    }
  })

  test('機材・オペレーター: 小数第2位以下（1.23 / 1.234）は不可', () => {
    for (const q of [1.23, 1.234]) {
      assert.equal(optionItemSchema.safeParse({ ...base, qty: q }).success, false, String(q))
    }
  })

  test('備品・設備（equipment）は整数のみ: 整数は可、小数は不可', () => {
    const eq = { name: '長机', category: 'equipment' }
    assert.ok(optionItemSchema.safeParse({ ...eq, qty: 5 }).success)
    assert.equal(optionItemSchema.safeParse({ ...eq, qty: 1.5 }).success, false)
    assert.equal(optionItemSchema.safeParse({ ...eq, qty: 0.1 }).success, false)
  })

  test('qty 省略時の既定値は従来どおり 1', () => {
    const r = optionItemSchema.safeParse(base)
    assert.ok(r.success)
    assert.equal(r.data.qty, 1)
  })

  test('整数 qty は従来どおり許可', () => {
    for (const q of [1, 2, 10]) {
      assert.ok(optionItemSchema.safeParse({ ...base, qty: q }).success)
    }
  })

  test('qty 0 は従来どおり不可', () => {
    assert.equal(optionItemSchema.safeParse({ ...base, qty: 0 }).success, false)
  })

  test('unit_price は従来どおり整数のみ（変更していない）', () => {
    assert.equal(optionItemSchema.safeParse({ ...base, unit_price: 100.5 }).success, false)
  })
})

describe('PUT スキーマ（optionUpdateSchema）', () => {
  test('qty 0.1 / 0.5 / 1.2 / 1.5 / 2.5 / 10.9 の更新を許可', () => {
    for (const q of [0.1, 0.5, 1.2, 1.5, 2.5, 10.9, 1, 2]) {
      const r = optionUpdateSchema.safeParse({ id: ID, qty: q })
      assert.ok(r.success, String(q))
      assert.equal(r.data.qty, q)
    }
  })

  test('qty 以外の更新（状態・単価）は従来どおり', () => {
    assert.ok(optionUpdateSchema.safeParse({ id: ID, state: '確定' }).success)
    assert.ok(optionUpdateSchema.safeParse({ id: ID, unit_price: 120000 }).success)
    assert.equal(optionUpdateSchema.safeParse({ id: ID, unit_price: 1.5 }).success, false)
  })

  test('qty 0 / 負数 / 小数第2位以下は不可', () => {
    for (const q of [0, -1, 1.23, 1.234]) {
      assert.equal(optionUpdateSchema.safeParse({ id: ID, qty: q }).success, false, String(q))
    }
  })
})

describe('route.ts / migration の整合（文字列確認のみ）', () => {
  test('options route は共通スキーマを使い、qty の .int() 制約が残っていない', () => {
    const route = read('app/api/cases/[id]/options/route.ts')
    assert.ok(route.includes("from '@/lib/validations/caseOption'"))
    assert.ok(!/qty:\s*z\.number\(\)\.int\(\)/.test(route))
  })

  test('options route は備品・設備への小数数量を API でも拒否する（PUT は保存済み category を確認）', () => {
    const route = read('app/api/cases/[id]/options/route.ts')
    assert.ok(route.includes("target?.category === 'equipment'"))
    assert.ok(route.includes('!Number.isInteger(updates.qty)'))
  })

  test('migration は DB でも「数量 > 0 かつ小数第1位まで」を CHECK で保証する', () => {
    const sql = read('supabase/migrations/20261004_case_options_qty_numeric.sql')
    assert.ok(sql.includes('CHECK (qty > 0 AND qty = ROUND(qty, 1))'))
    assert.ok(sql.includes('NUMERIC(10,2)'))
  })

  test('migration は qty を NUMERIC(10,2) に変更し、生成列 amount を四捨五入付きで作り直す', () => {
    const sql = read('supabase/migrations/20261004_case_options_qty_numeric.sql')
    assert.ok(sql.includes('ALTER COLUMN qty TYPE NUMERIC(10,2)'))
    assert.ok(sql.includes('DROP COLUMN amount'))
    assert.ok(sql.includes('GENERATED ALWAYS AS (ROUND(qty * unit_price)::BIGINT) STORED'))
    assert.ok(sql.includes('未適用'))
  })

  test('migration は case_options 以外のテーブルを変更しない', () => {
    const sql = read('supabase/migrations/20261004_case_options_qty_numeric.sql')
    const statements = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    const tables = Array.from(statements.matchAll(/ALTER TABLE\s+(\w+)/g), (m) => m[1])
    assert.ok(tables.length >= 4)
    assert.ok(tables.every((t) => t === 'case_options'))
    assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/.test(statements))
  })
})
