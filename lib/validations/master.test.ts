/**
 * 機材区分（machine_category）「その他オペ」対応の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/validations/master.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。ソースファイルの文字列読み取りのみ行う。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optionSchema } from './master.ts'

const EXPECTED = ['音響', '照明', '映像', 'その他オペ']
const LEGACY = ['音響', '照明', '映像']

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

// 文字列内の '...' をすべて取り出す
function quotedStrings(text: string): string[] {
  const out: string[] = []
  const re = /'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

// 正規表現の最初のキャプチャ内にある '...' の文字列をすべて取り出す
function quoted(source: string, re: RegExp): string[] {
  const m = source.match(re)
  assert.ok(m, `パターンが見つかりません: ${re}`)
  return quotedStrings(m[1])
}

const machineItem = (machine_category: string | null) => ({
  name: 'テスト項目',
  category: 'machine',
  machine_category,
  default_price: 1000,
  unit: '式',
})

describe('optionSchema（オプションマスタの検証）の machine_category', () => {
  for (const cat of EXPECTED) {
    test(`機材区分「${cat}」を許可する`, () => {
      assert.equal(optionSchema.safeParse(machineItem(cat)).success, true)
    })
  }

  test('既存3区分（音響・照明・映像）は引き続き許可される', () => {
    for (const cat of LEGACY) {
      assert.equal(optionSchema.safeParse(machineItem(cat)).success, true, cat)
    }
  })

  test('不正な区分は拒否される', () => {
    for (const bad of ['その他', 'オペ', 'その他オペ ', 'sound', '']) {
      assert.equal(optionSchema.safeParse(machineItem(bad)).success, false, JSON.stringify(bad))
    }
  })

  test('category=machine で machine_category が null / 未指定なら拒否される（既存仕様）', () => {
    assert.equal(optionSchema.safeParse(machineItem(null)).success, false)
    const { machine_category: _omit, ...withoutCat } = machineItem('音響')
    assert.equal(optionSchema.safeParse(withoutCat).success, false)
  })

  test('category=equipment では machine_category が null でも許可される（既存仕様）', () => {
    const r = optionSchema.safeParse({ name: '備品', category: 'equipment', machine_category: null, default_price: 0, unit: '台' })
    assert.equal(r.success, true)
  })
})

describe('機材区分リストの整合性（ソース内の各定義が同じ4値・同じ順序であること）', () => {
  test('lib/validations/master.ts の enum', () => {
    assert.deepEqual(quoted(read('lib/validations/master.ts'), /machine_category:\s*z\.enum\(\[([^\]]*)\]\)/), EXPECTED)
  })

  test('app/api/cases/[id]/options/route.ts の enum（案件オプションAPI）', () => {
    assert.deepEqual(quoted(read('app/api/cases/[id]/options/route.ts'), /machine_category:\s*z\.enum\(\[([^\]]*)\]\)/), EXPECTED)
  })

  test('lib/constants/status.ts の MACHINE_CATEGORIES', () => {
    assert.deepEqual(quoted(read('lib/constants/status.ts'), /MACHINE_CATEGORIES\s*=\s*\[([^\]]*)\]/), EXPECTED)
  })

  test('types/database.ts の MachineCategory 型', () => {
    assert.deepEqual(quoted(read('types/database.ts'), /type MachineCategory\s*=\s*([^\n]+)/), EXPECTED)
  })

  test('components/cases/CaseDetail/Options.tsx の MACHINE_CATS（案件詳細）', () => {
    assert.deepEqual(quoted(read('components/cases/CaseDetail/Options.tsx'), /MACHINE_CATS\s*=\s*\[([^\]]*)\]/), EXPECTED)
  })

  test('app/cases/[id]/print/page.tsx の区分配列（印刷画面）', () => {
    assert.deepEqual(quoted(read('app/cases/[id]/print/page.tsx'), /const machines\s*=\s*\[([^\]]*)\]/), EXPECTED)
  })

  test('app/(dashboard)/master/options/page.tsx の MACHINE_TABS（先頭は「全て」）', () => {
    const tabs = quoted(read('app/(dashboard)/master/options/page.tsx'), /MACHINE_TABS:\s*MachineTab\[\]\s*=\s*\[([^\]]*)\]/)
    assert.deepEqual(tabs, ['全て', ...EXPECTED])
  })
})

describe('migration（20260918_add_other_operator_machine_category.sql）の許可値', () => {
  const sql = read('supabase/migrations/20260918_add_other_operator_machine_category.sql')
  const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

  test('option_master と case_options の CHECK 制約が、どちらも4値になっている', () => {
    const lists: string[][] = []
    const re = /CHECK\s*\(machine_category IN \(([^)]*)\)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) lists.push(quotedStrings(m[1]))
    assert.equal(lists.length, 2)
    for (const list of lists) assert.deepEqual(list, EXPECTED)
  })

  test('データ変更文（INSERT / UPDATE / DELETE / TRUNCATE）を含まない', () => {
    assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(body), false)
  })

  test('BEGIN と COMMIT で囲まれている', () => {
    const stmts = body.split(';').map((s) => s.trim()).filter(Boolean)
    assert.equal(stmts[0], 'BEGIN')
    assert.equal(stmts[stmts.length - 1], 'COMMIT')
  })
})
