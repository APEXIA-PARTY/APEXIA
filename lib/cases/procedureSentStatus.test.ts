/**
 * 確認手続き「申込みフォーム・搬入出届 = 送付済み追加」「請求書 = 発行依頼を新規選択不可」の自動テスト
 * （node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/procedureSentStatus.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。ソース / migration は文字列として読むだけで、実行・適用はしない。
 *
 * 仕様:
 *  ・申込みフォーム / 搬入出届: 未対応 / 送付済み / 済み（遷移の強制はしない）
 *  ・請求書: 通常の選択肢は 未対応 / 送付済み / 振り込み済み。「発行依頼」は新規に選べない。
 *            ただし DB の CHECK と Zod は当面 4 値のまま（本番に「発行依頼」の既存案件があるため）。
 *            既存値が「発行依頼」の案件だけ、その値を「（既存値）」として表示し、別の値へ変更できる。変更後は戻せない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSelectOptions, legacyOptionLabel, validateProcedureSelect } from './procedure.ts'
import { caseFormSchema } from '../validations/case.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

/** status.ts から `export const NAME = [...] as const` の値を取り出す（@/ エイリアスを含む status.ts は node では import できないため） */
function constArray(name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(read('lib/constants/status.ts'))
  assert.ok(m, `${name} が見つかる`)
  return Array.from(m![1].matchAll(/'([^']+)'/g), (x) => x[1])
}

describe('申込みフォーム / 搬入出届: 未対応 / 送付済み / 済み', () => {
  test('定数は 3 値で、順序は 未対応 → 送付済み → 済み', () => {
    assert.deepEqual(constArray('FORM_STATUS_OPTIONS'), ['未対応', '送付済み', '済み'])
    assert.deepEqual(constArray('DELIVERY_STATUS_OPTIONS'), ['未対応', '送付済み', '済み'])
  })

  for (const field of ['application_form_status', 'delivery_notice_status'] as const) {
    test(`${field}: 未対応 / 送付済み / 済み は OK、不正値は NG（Zod・保存前検証）`, () => {
      for (const v of ['未対応', '送付済み', '済み']) {
        assert.equal(caseFormSchema.shape[field].safeParse(v).success, true, v)
        assert.deepEqual(validateProcedureSelect(field, v), { ok: true, value: v })
      }
      for (const v of ['', '請求書送付済み', '発行依頼', '振り込み済み', '済', 'sent', ' 送付済み']) {
        assert.equal(caseFormSchema.shape[field].safeParse(v).success, false, `Zod: ${v}`)
        assert.equal(validateProcedureSelect(field, v).ok, false, `検証: ${v}`)
      }
      assert.equal(caseFormSchema.shape[field].safeParse(undefined).data, '未対応', '既定値は 未対応')
    })
  }

  test('状態遷移の強制はない: 済み → 未対応、送付済み → 未対応 など任意の値へ保存できる', () => {
    for (const to of ['未対応', '送付済み', '済み']) {
      assert.equal(validateProcedureSelect('application_form_status', to).ok, true)
      assert.equal(validateProcedureSelect('delivery_notice_status', to).ok, true)
    }
  })

  test('申込み金・残額支払いは巻き込まれない（引き続き 未対応 / 請求書送付済み / 済み。「送付済み」は不可）', () => {
    for (const f of ['deposit_status', 'remaining_payment_status'] as const) {
      assert.equal(validateProcedureSelect(f, '請求書送付済み').ok, true, f)
      assert.equal(validateProcedureSelect(f, '送付済み').ok, false, f)
    }
    assert.deepEqual(constArray('DEPOSIT_STATUS_OPTIONS'), ['未対応', '請求書送付済み', '済み'])
    assert.deepEqual(constArray('REMAINING_PAYMENT_STATUS_OPTIONS'), ['未対応', '請求書送付済み', '済み'])
  })

  test('型・案件編集フォーム: 型は 3 値。フォームは直書きをやめて共通定数を使う', () => {
    const types = read('types/database.ts')
    assert.ok(types.includes("ApplicationFormStatus = '未対応' | '送付済み' | '済み'"))
    assert.ok(types.includes("DeliveryNoticeStatus = '未対応' | '送付済み' | '済み'"))
    const form = read('components/cases/CaseForm.tsx')
    assert.ok(form.includes('FORM_STATUS_OPTIONS.map'))
    assert.ok(form.includes('DELIVERY_STATUS_OPTIONS.map'))
    assert.doesNotMatch(form, /<option value="済み">済み<\/option>/, '選択肢を直書きしていない')
  })

  test('詳細画面: 送付済み は進行中（青いピル）として扱う', () => {
    const src = read('components/cases/CaseDetail/Procedure.tsx')
    assert.match(src, /field: 'application_form_status', okValues: \['済み'\], progressValues: \['送付済み'\]/)
    assert.match(src, /field: 'delivery_notice_status', okValues: \['済み'\], progressValues: \['送付済み'\]/)
  })
})

describe('請求書: 発行依頼を新規選択不可（既存値の互換は維持）', () => {
  test('通常の選択肢は 未対応 / 送付済み / 振り込み済み の 3 値で、発行依頼を含まない', () => {
    const opts = constArray('INVOICE_STATUS_OPTIONS')
    assert.deepEqual(opts, ['未対応', '送付済み', '振り込み済み'])
    assert.ok(!opts.includes('発行依頼'))
    assert.deepEqual(constArray('INVOICE_STATUS_LEGACY_VALUES'), ['発行依頼'])
  })

  test('新規案件（既定値 未対応）: 発行依頼は選択肢に出ない', () => {
    const { values, legacy } = buildSelectOptions(constArray('INVOICE_STATUS_OPTIONS'), '未対応')
    assert.deepEqual(values, ['未対応', '送付済み', '振り込み済み'])
    assert.equal(legacy, null)
  })

  test('既存値が 発行依頼 でない案件（送付済み・振り込み済み・未対応）も、発行依頼は選べない', () => {
    for (const cur of ['未対応', '送付済み', '振り込み済み']) {
      const { values, legacy } = buildSelectOptions(constArray('INVOICE_STATUS_OPTIONS'), cur)
      assert.ok(!values.includes('発行依頼'), cur)
      assert.equal(legacy, null, cur)
    }
  })

  test('既存値が 発行依頼 の案件: その値が「（既存値）」として認識できる。通常の 3 値は選べる', () => {
    const { values, legacy } = buildSelectOptions(constArray('INVOICE_STATUS_OPTIONS'), '発行依頼')
    assert.equal(legacy, '発行依頼')
    assert.equal(legacyOptionLabel(legacy!), '発行依頼（既存値）')
    for (const v of ['未対応', '送付済み', '振り込み済み']) assert.ok(values.includes(v), v)
  })

  test('別の値へ変更した後は 発行依頼 に戻せない（選択中の値が変わると既存値の選択肢が消える）', () => {
    const opts = constArray('INVOICE_STATUS_OPTIONS')
    // 画面の操作列: 発行依頼 → 送付済み → （戻そうとしても選択肢にない）→ 振り込み済み
    const steps = ['発行依頼', '送付済み', '振り込み済み', '未対応']
    const offered = steps.map((cur) => {
      const { values, legacy } = buildSelectOptions(opts, cur)
      return [...values, ...(legacy ? [legacy] : [])]
    })
    assert.ok(offered[0].includes('発行依頼'), '最初だけ（現在値として）見える')
    for (const o of offered.slice(1)) assert.ok(!o.includes('発行依頼'), '変更後は選択肢にない')
  })

  test('保存の検証（DB CHECK / Zod）は当面 4 値のまま: 発行依頼のまま他の項目を保存しても失敗しない', () => {
    for (const v of ['未対応', '発行依頼', '送付済み', '振り込み済み']) {
      assert.equal(caseFormSchema.shape.invoice_status.safeParse(v).success, true, v)
      assert.equal(validateProcedureSelect('invoice_status', v).ok, true, v)
    }
    assert.equal(caseFormSchema.shape.invoice_status.safeParse('済み').success, false)
    const types = read('types/database.ts')
    assert.ok(types.includes("InvoiceStatus = '未対応' | '発行依頼' | '送付済み' | '振り込み済み'"))
  })

  test('画面: 案件編集フォームと詳細画面の両方が buildSelectOptions で既存値を扱う（詳細は編集中の選択値 draft を基準）', () => {
    const detail = read('components/cases/CaseDetail/Procedure.tsx')
    assert.match(detail, /const \{ values: options, legacy \} = buildSelectOptions\(SELECT_OPTIONS\[field\], draft\)/)
    assert.match(detail, /legacyOptionLabel\(legacy\)/)
    const form = read('components/cases/CaseForm.tsx')
    assert.match(form, /buildSelectOptions\(INVOICE_STATUS_OPTIONS, watch\('invoice_status'\)\)/)
    assert.match(form, /invoiceLegacy && <option value=\{invoiceLegacy\}>\{legacyOptionLabel\(invoiceLegacy\)\}<\/option>/)
    assert.ok(!form.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').includes('発行依頼'), 'フォームのコードに「発行依頼」を直書きしていない（コメント以外）')
  })

  test('PDF・印刷ページは請求書の値をそのまま出す（限定した選択肢に依存しない → 既存の「発行依頼」も表示できる）', () => {
    assert.match(read('app/api/cases/[id]/pdf/route.ts'), /drawRow\('請求書',\s+d\(c\.invoice_status\)\)/)
    assert.match(read('app/cases/[id]/print/page.tsx'), /<td>\{c\.invoice_status\}<\/td>/)
  })
})

describe('migration 20261005_form_delivery_add_sent_status.sql（CHECK 拡張のみ）の静的確認', () => {
  const file = 'supabase/migrations/20261005_form_delivery_add_sent_status.sql'
  const body = () => read(file).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

  test('未適用の注記・適用順・rollback がヘッダーにあり、BEGIN / COMMIT で囲まれている', () => {
    const h = read(file)
    assert.ok(h.includes('未適用'))
    assert.ok(h.includes('適用順'))
    assert.ok(h.includes('rollback'))
    assert.ok(h.includes('0 件の場合に限り'))
    assert.ok(h.includes('データを自動変換しない'))
    assert.match(body(), /^BEGIN;$/m)
    assert.match(body(), /^COMMIT;$/m)
  })

  test('データ変更文（INSERT / UPDATE / DELETE / TRUNCATE）がない。backfill がない', () => {
    assert.doesNotMatch(body(), /\b(INSERT|UPDATE|DELETE|TRUNCATE|COPY|MERGE)\b/i)
  })

  test('CHECK 拡張以外のDDLがない（列・型・default・NULL・トリガー・関数・RLS・ポリシー・index・invoice_status に触れない）', () => {
    const b = body()
    assert.doesNotMatch(b, /DROP\s+COLUMN|ALTER\s+COLUMN|ADD\s+COLUMN|SET\s+DEFAULT|SET\s+NOT\s+NULL|DROP\s+NOT\s+NULL/i)
    assert.doesNotMatch(b, /\bTRIGGER\b|\bFUNCTION\b|\bPOLICY\b|ROW LEVEL SECURITY|\bINDEX\b|\bGRANT\b|\bREVOKE\b|\bDROP\s+TABLE\b/i)
    assert.ok(!b.includes('invoice_status'))
    assert.ok(!b.includes('deposit_status') && !b.includes('remaining_payment_status'))
    const alters = Array.from(b.matchAll(/ALTER TABLE\s+(\w+)\s+(DROP CONSTRAINT|ADD\s+CONSTRAINT)\s+(\w+)/g), (m) => `${m[1]} ${m[2].replace(/\s+/g, ' ')} ${m[3]}`)
    assert.deepEqual(alters, [
      'cases DROP CONSTRAINT cases_application_form_status_check',
      'cases ADD CONSTRAINT cases_application_form_status_check',
      'cases DROP CONSTRAINT cases_delivery_notice_status_check',
      'cases ADD CONSTRAINT cases_delivery_notice_status_check',
    ])
    assert.equal((b.match(/ALTER TABLE/g) ?? []).length, 4, 'ALTER TABLE はこの 4 文だけ')
    assert.ok(!b.includes('pg_constraint'), '制約名は固定指定（動的検索なし）')
    assert.doesNotMatch(b, /IF EXISTS \(\s*SELECT 1 FROM pg_/i)
    assert.doesNotMatch(b, /DROP CONSTRAINT IF EXISTS/i)
  })

  test('新しい CHECK は 未対応 / 送付済み / 済み の 3 値', () => {
    const b = body()
    assert.ok(b.includes("CHECK (application_form_status IN ('未対応', '送付済み', '済み'))"))
    assert.ok(b.includes("CHECK (delivery_notice_status IN ('未対応', '送付済み', '済み'))"))
  })

  test('安全チェック（想定外の値で中断）は制約変更より前にある', () => {
    const b = body()
    assert.equal((b.match(/RAISE EXCEPTION/g) ?? []).length, 2)
    assert.ok(b.indexOf('RAISE EXCEPTION') < b.indexOf('ALTER TABLE'))
    assert.ok(b.includes("application_form_status NOT IN ('未対応', '送付済み', '済み')"))
    assert.ok(b.includes("delivery_notice_status NOT IN ('未対応', '送付済み', '済み')"))
  })

  test('Production の UUID・個人情報・秘密情報・project ref を含まない', () => {
    const t = read(file)
    assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    assert.doesNotMatch(t, /@[\w-]+\.(com|jp)|service_role_key|CRON_SECRET|eyJ[\w-]{20,}|supabase\.co/i)
  })

  test('今回追加した migration は 1 本だけで、cron・cancelled_at・case_history の migration を変更していない', () => {
    const mine = readdirSync(resolve(ROOT, 'supabase/migrations')).filter((n) => n.includes('form_delivery_add_sent_status'))
    assert.deepEqual(mine, ['20261005_form_delivery_add_sent_status.sql'])
    const cancelled = read('supabase/migrations/20261005_add_cases_cancelled_at.sql')
    assert.ok(cancelled.includes('cancelled_at timestamptz'))
    assert.ok(!cancelled.includes('application_form_status'))
  })
})
