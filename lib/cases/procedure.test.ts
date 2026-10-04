/**
 * ③ 確認手続き（詳細画面インライン編集・申込みフォーム3値）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/procedure.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。
 * ソース / migration は文字列として読み取るだけで、実行・適用はしない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatPreviewDateTime,
  toPreviewInputValue,
  validatePreviewDateTime,
  validateProcedureSelect,
} from './procedure.ts'
import { caseFormSchema } from '../validations/case.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('formatPreviewDateTime', () => {
  test('DB の timestamptz 文字列を、タイムゾーン変換なしで yyyy/MM/dd HH:mm にする', () => {
    assert.equal(formatPreviewDateTime('2026-05-01T10:00:00+00:00'), '2026/05/01 10:00')
    assert.equal(formatPreviewDateTime('2026-05-01T10:15:00Z'), '2026/05/01 10:15')
    assert.equal(formatPreviewDateTime('2026-05-01T23:45'), '2026/05/01 23:45')
    assert.equal(formatPreviewDateTime('2026-12-31 09:30:00+00'), '2026/12/31 09:30')
  })

  test('編集フォームの入力値（slice(0,16)）と同じ日時になる', () => {
    const db = '2026-05-01T10:15:00+00:00'
    const input = toPreviewInputValue(db)
    assert.equal(input, '2026-05-01T10:15')
    assert.equal(formatPreviewDateTime(input), formatPreviewDateTime(db))
  })

  test('日付のみは 00:00 として表示（DB は日付のみでも 00:00 で保存されるため）', () => {
    assert.equal(formatPreviewDateTime('2026-05-01'), '2026/05/01 00:00')
  })

  test('null / undefined / 空 / 不正値 → —', () => {
    assert.equal(formatPreviewDateTime(null), '—')
    assert.equal(formatPreviewDateTime(undefined), '—')
    assert.equal(formatPreviewDateTime(''), '—')
    assert.equal(formatPreviewDateTime('not-a-date'), '—')
  })
})

describe('toPreviewInputValue', () => {
  test('null → 空文字', () => {
    assert.equal(toPreviewInputValue(null), '')
    assert.equal(toPreviewInputValue(undefined), '')
  })
})

describe('validatePreviewDateTime', () => {
  test('日付+時刻 / 日付のみを許可（編集フォームと同じ形式のまま返す）', () => {
    assert.deepEqual(validatePreviewDateTime('2026-05-01T10:15'), { ok: true, value: '2026-05-01T10:15' })
    assert.deepEqual(validatePreviewDateTime('2026-05-01'), { ok: true, value: '2026-05-01' })
  })

  test('空・不正形式は不可', () => {
    assert.equal(validatePreviewDateTime('').ok, false)
    assert.equal(validatePreviewDateTime('2026/05/01').ok, false)
    assert.equal(validatePreviewDateTime('2026-05-01T10').ok, false)
  })
})

describe('validateProcedureSelect', () => {
  test('申込みフォーム: 未対応 / 済み の 2 値のみ許可（請求書送付済みは不可）', () => {
    for (const v of ['未対応', '済み']) {
      assert.deepEqual(validateProcedureSelect('application_form_status', v), { ok: true, value: v })
    }
    assert.equal(validateProcedureSelect('application_form_status', '請求書送付済み').ok, false)
  })

  test('申込みフォーム: 2 値以外（空・他項目の値）は不可', () => {
    for (const v of ['', '請求書送付済み', '発行依頼', '送付済み', '振り込み済み', '済']) {
      assert.equal(validateProcedureSelect('application_form_status', v).ok, false, v)
    }
  })

  test('申込み金: 未対応 / 請求書送付済み / 済み の 3 値を許可', () => {
    for (const v of ['未対応', '請求書送付済み', '済み']) {
      assert.deepEqual(validateProcedureSelect('deposit_status', v), { ok: true, value: v })
    }
  })

  test('申込み金: 3 値以外（空・他項目の値）は不可', () => {
    for (const v of ['', '発行依頼', '送付済み', '振り込み済み', '済']) {
      assert.equal(validateProcedureSelect('deposit_status', v).ok, false, v)
    }
  })

  test('搬入出届 / 残額支払いは従来どおり 未対応・済み のみ（請求書送付済みは不可）', () => {
    for (const f of ['delivery_notice_status', 'remaining_payment_status'] as const) {
      assert.equal(validateProcedureSelect(f, '未対応').ok, true)
      assert.equal(validateProcedureSelect(f, '済み').ok, true)
      assert.equal(validateProcedureSelect(f, '請求書送付済み').ok, false, f)
    }
  })

  test('請求書は従来の 4 値', () => {
    for (const v of ['未対応', '発行依頼', '送付済み', '振り込み済み']) {
      assert.equal(validateProcedureSelect('invoice_status', v).ok, true, v)
    }
    assert.equal(validateProcedureSelect('invoice_status', '済み').ok, false)
  })

  test('支払い方法: 既存の選択肢を許可、空は null（未設定）、不正値は不可', () => {
    assert.deepEqual(validateProcedureSelect('payment_method', '当日現金'), { ok: true, value: '当日現金' })
    assert.deepEqual(validateProcedureSelect('payment_method', ''), { ok: true, value: null })
    assert.equal(validateProcedureSelect('payment_method', 'ビットコイン').ok, false)
  })
})

describe('「請求書送付済み」は申込み金（deposit_status）のみ（Zod / 定数 / 型 / 画面 / migration）', () => {
  test('案件フォームの Zod: 申込みフォームは 2 値（請求書送付済みは不可）、既定値は 未対応', () => {
    const f = caseFormSchema.shape.application_form_status
    for (const v of ['未対応', '済み']) {
      const r = f.safeParse(v)
      assert.ok(r.success, v)
      assert.equal(r.data, v)
    }
    assert.equal(f.safeParse('請求書送付済み').success, false)
    assert.equal(f.safeParse(undefined).data, '未対応')
  })

  test('案件フォームの Zod: 申込み金は 3 値、既定値は 未対応', () => {
    const f = caseFormSchema.shape.deposit_status
    for (const v of ['未対応', '請求書送付済み', '済み']) {
      const r = f.safeParse(v)
      assert.ok(r.success, v)
      assert.equal(r.data, v)
    }
    assert.equal(f.safeParse('不明').success, false)
    assert.equal(f.safeParse(undefined).data, '未対応')
  })

  test('他の確認手続き項目（搬入出届・残額支払い）は 2 値のまま', () => {
    for (const k of ['delivery_notice_status', 'remaining_payment_status'] as const) {
      assert.equal(caseFormSchema.shape[k].safeParse('請求書送付済み').success, false, k)
      assert.equal(caseFormSchema.shape[k].safeParse('済み').success, true, k)
    }
  })

  test('定数・型・案件編集フォーム: 申込み金だけが 3 値で、APPLICATION_FORM_STATUS_OPTIONS は存在しない', () => {
    const status = read('lib/constants/status.ts')
    assert.ok(status.includes("DEPOSIT_STATUS_OPTIONS = ['未対応', '請求書送付済み', '済み']"))
    assert.ok(!status.includes('APPLICATION_FORM_STATUS_OPTIONS'))
    const types = read('types/database.ts')
    assert.ok(types.includes("ApplicationFormStatus = '未対応' | '済み'"))
    assert.ok(types.includes("DepositStatus = '未対応' | '請求書送付済み' | '済み'"))
    const form = read('components/cases/CaseForm.tsx')
    assert.ok(form.includes('DEPOSIT_STATUS_OPTIONS.map'))
    assert.ok(!form.includes('APPLICATION_FORM_STATUS_OPTIONS'))
  })

  test('詳細画面: 青いピル（progressValues）は申込み金の行だけに付く', () => {
    const src = read('components/cases/CaseDetail/Procedure.tsx')
    const lines = src.split('\n').filter((l) => l.includes('progressValues: ['))
    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes("field: 'deposit_status'"))
    assert.ok(!src.includes('APPLICATION_FORM_STATUS_OPTIONS'))
  })

  test('過去の migration（適用済み）は履歴として残っている（編集されていない）', () => {
    const old = read('supabase/migrations/20261004_add_application_form_invoice_sent.sql')
    assert.ok(old.includes("CHECK (application_form_status IN ('未対応', '請求書送付済み', '済み'))"))
  })
})

describe('訂正 migration（20261004_move_invoice_sent_to_deposit_status.sql）の静的確認', () => {
  const file = 'supabase/migrations/20261004_move_invoice_sent_to_deposit_status.sql'
  const body = () =>
    read(file)
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')

  test('未適用の注記があり、BEGIN / COMMIT で囲まれている', () => {
    const sql = read(file)
    assert.ok(sql.includes('未適用'))
    assert.ok(/^BEGIN;$/m.test(body()))
    assert.ok(/^COMMIT;$/m.test(body()))
  })

  test('データ変更文（INSERT / UPDATE / DELETE / TRUNCATE）を含まない', () => {
    assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(body()))
  })

  test('安全チェック: 申込みフォームが 未対応/済み 以外・申込み金が 未対応/済み 以外なら RAISE EXCEPTION で中断', () => {
    const b = body()
    assert.ok(b.includes("application_form_status NOT IN ('未対応', '済み')"))
    assert.ok(b.includes("deposit_status NOT IN ('未対応', '済み')"))
    assert.equal((b.match(/RAISE EXCEPTION/g) ?? []).length, 2)
  })

  test('安全チェックは制約変更より前にある', () => {
    const b = body()
    assert.ok(b.indexOf('RAISE EXCEPTION') < b.indexOf('ALTER TABLE'))
  })

  test('制約名は固定指定（動的検索なし）で、cases の2制約だけを変更する', () => {
    const b = body()
    assert.ok(!b.includes('pg_constraint'))
    const drops = Array.from(b.matchAll(/DROP CONSTRAINT\s+(\w+)/g), (m) => m[1])
    assert.deepEqual(drops, ['cases_application_form_status_check', 'cases_deposit_status_check'])
    assert.ok(!/DROP CONSTRAINT IF EXISTS/i.test(b))
    const tables = Array.from(b.matchAll(/ALTER TABLE\s+(\w+)/g), (m) => m[1])
    assert.ok(tables.length === 4 && tables.every((t) => t === 'cases'))
  })

  test('最終的な CHECK は 申込みフォーム=2値 / 申込み金=3値', () => {
    const b = body()
    assert.ok(b.includes("CHECK (application_form_status IN ('未対応', '済み'))"))
    assert.ok(b.includes("CHECK (deposit_status IN ('未対応', '請求書送付済み', '済み'))"))
  })
})

describe('詳細画面の保存は既存の案件更新 API を再利用する', () => {
  test('Procedure.tsx は PUT /api/cases/[id] を使い、新しい API ルートを追加していない', () => {
    const src = read('components/cases/CaseDetail/Procedure.tsx')
    assert.ok(src.includes('`/api/cases/${caseId}`'))
    assert.ok(src.includes("method: 'PUT'"))
  })

  test('下見日時の入力は案件編集フォームと同じ共通コンポーネントを使う（コピーしていない）', () => {
    const procedure = read('components/cases/CaseDetail/Procedure.tsx')
    const form = read('components/cases/CaseForm.tsx')
    assert.ok(procedure.includes("from '@/components/cases/PreviewDateTimeSelect'"))
    assert.ok(form.includes("from '@/components/cases/PreviewDateTimeSelect'"))
    assert.ok(!form.includes('function PreviewDateTimeSelect'))
  })
})
