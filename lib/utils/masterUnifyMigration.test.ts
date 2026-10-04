/**
 * マスタ統合 migration とシードの静的確認（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/masterUnifyMigration.test.ts
 * migration は文字列として読むだけで、実行・適用はしない。DB・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const FILE = 'supabase/migrations/20261004_unify_media_cancel_reason_event_category.sql'
const code = () => read(FILE).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('マスタ統合 migration（20261004_unify_media_cancel_reason_event_category.sql）', () => {
  test('未適用の注記があり、BEGIN / COMMIT で囲まれている', () => {
    assert.ok(read(FILE).includes('未適用'))
    assert.ok(/^BEGIN;$/m.test(code()))
    assert.ok(/^COMMIT;$/m.test(code()))
  })

  test('DELETE / TRUNCATE / DROP TABLE を含まない（マスタ行も案件も削除しない）', () => {
    assert.ok(!/\bDELETE\b/i.test(code()))
    assert.ok(!/\bTRUNCATE\b/i.test(code()))
    assert.ok(!/\bDROP\s+TABLE\b/i.test(code()))
    assert.ok(!/\bDROP\s+(COLUMN|CONSTRAINT)\b/i.test(code()))
  })

  test('cases の UPDATE は対象4カラム以外を SET しない', () => {
    // 直接書かれた UPDATE（動的 SQL のテンプレート %I は、付け替えヘルパー。対象列は下の呼び出しとバックアップ表の CHECK で4カラムに限定）
    const updates = Array.from(code().matchAll(/UPDATE\s+public\.cases\s+SET\s+([^;]*?)\s+WHERE/gi), (m) => m[1]).filter((s) => !s.includes('%'))
    assert.ok(updates.length >= 1)
    for (const set of updates) {
      const cols = Array.from(set.matchAll(/(\w+)\s*=/g), (m) => m[1])
      for (const c of cols) assert.ok(['event_category_id', 'event_subcategory_id'].includes(c), `SET ${c}`)
    }
    // 動的 UPDATE（付け替えヘルパー）は4カラムのみ
    assert.ok(code().includes("'media_id', v_web_src"))
    const dyn = Array.from(code().matchAll(/pg_temp\.unify_repoint\([^,]+,\s*'(\w+)'/g), (m) => m[1])
    for (const c of dyn) assert.ok(['media_id', 'cancel_reason_id', 'event_category_id'].includes(c), c)
  })

  test('旧マスタは is_active=false にするだけ（名称の改名は正規マスタ2つのみ）', () => {
    const c = code()
    assert.ok(/UPDATE public\.media_master SET is_active = false/.test(c))
    assert.ok(/UPDATE public\.cancel_reason_master SET is_active = false/.test(c))
    assert.ok(/UPDATE public\.event_category_master SET is_active = false/.test(c))
    assert.ok(c.includes("SET name = 'WEB要件検索'"))
    assert.ok(c.includes("SET name = '他会場で開催'"))
    assert.ok(!c.includes('他会場にで開催'))
  })

  test('中断条件: 件数不一致・特定不能・名称衝突・トリガー状態・不変条件で RAISE EXCEPTION する', () => {
    const c = code()
    assert.ok((c.match(/RAISE EXCEPTION/g) ?? []).length >= 8)
    for (const kw of ['unify_assert_count', 'unify_one_id', 'unify_assert_name_free', 'tgenabled', 'v_fp_before', 'v_total_before', 'v_rev_before', 'v_status_before']) {
      assert.ok(c.includes(kw), kw)
    }
  })

  test('バックアップ表は個人情報を持たない（ID・カラム名・旧新ID・マスタ名称・状態のみ）、RLS 有効', () => {
    const c = code()
    const tables = Array.from(c.matchAll(/CREATE TABLE public\.(\w+)\s*\(([\s\S]*?)\n\);/g))
    assert.equal(tables.length, 2)
    for (const [, name, body] of tables) {
      assert.ok(name.startsWith('master_unify_'), name)
      const cols = Array.from(body.matchAll(/^\s{2}(\w+)\s/gm), (m) => m[1])
      for (const col of cols) assert.ok(!/company|contact|phone|email|memo|notes|event_name|guest/.test(col), col)
    }
    assert.ok(c.includes('ENABLE ROW LEVEL SECURITY'))
    assert.ok(c.includes('REVOKE ALL'))
  })

  test('旧企業飲食8件の最終ルール: 懇親会→社内懇親会 / 立食パーティー→企業飲食 / その他(展示会)→企業イベントの「その他」', () => {
    const c = code()
    assert.ok(c.includes("'中分類 懇親会 → 社内懇親会', v_cat_inshoku, v_sub_konshinkai, v_sub_shanai, EXP_KONSHINKAI"))
    assert.ok(c.includes("'中分類 立食パーティー → 企業飲食', v_cat_inshoku, v_sub_tachishoku, v_sub_inshoku, EXP_TACHISHOKU"))
    assert.ok(c.includes("'中分類 その他（展示会） → その他（企業イベント）', v_cat_inshoku, v_sub_sonota_tenji, v_sub_ev_sonota, EXP_SONOTA_TENJI"))
    // 旧企業飲食の案件に限定して更新する（同じ中分類を持つ他の大分類の案件には触れない）
    assert.ok(/WHERE event_category_id = p_cat AND event_subcategory_id = p_from_sub/.test(c))
    // 移行先は企業イベント配下の有効な1行に特定できなければ中断（STRICT）
    assert.ok(/INTO STRICT v_sub_shanai/.test(c) && /INTO STRICT v_sub_ev_sonota/.test(c))
    // 保留用の変数は残っていない
    assert.ok(!c.includes('v_map_'))
  })

  test('移行後の検証: 内訳 企業飲食88 / 社内懇親会6 / 表彰式1 / その他1、親大分類不一致・中分類未設定が0件', () => {
    const c = code()
    assert.ok(c.includes('EXP_SUB_INSHOKU_AFTER   CONSTANT INTEGER := 88'))
    for (const label of ['旧企業飲食 → 中分類=企業飲食', '旧企業飲食 → 中分類=社内懇親会', '旧企業飲食 → 中分類=表彰式', '旧企業飲食 → 中分類=その他（企業イベント）', '旧企業飲食で親大分類が不一致の中分類参照', '旧企業飲食で中分類が未設定の案件']) {
      assert.ok(c.includes(label), label)
    }
    assert.ok(c.includes('s.category_id <> c.event_category_id'))
  })

  test('event_subcategory_note / cancel_note には触れない', () => {
    assert.ok(!/event_subcategory_note|cancel_note/.test(code()))
  })

  test('rollback SQL がコメント内に記載されている', () => {
    const s = read(FILE)
    assert.ok(s.includes('ROLLBACK-BEGIN') && s.includes('ROLLBACK-END'))
    assert.ok(s.includes('ENABLE TRIGGER trg_cases_updated_at'))
  })

  test('過去の migration（適用済み）は編集されていない', () => {
    // 内容の一部を確認（履歴として残っていること）
    assert.ok(read('supabase/migrations/20261004_remaining_payment_add_invoice_sent.sql').includes('cases_remaining_payment_status_check'))
  })
})

describe('シード・スクリプトが旧名称を作らない', () => {
  const stripComments = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const LEGACY = ['WEBで要件入力', 'insragram営業', 'instagramのDM', '他会場に決定', '他店舗で開催', '空いてなかった', '企業飲食']

  test('scripts/import-master-seed.sql は旧名称を INSERT しない', () => {
    const s = stripComments(read('scripts/import-master-seed.sql'))
    for (const n of LEGACY) assert.ok(!s.includes(n), n)
    for (const n of ['WEB要件検索', '他会場で開催', '空き枠なし', 'instagram DM営業']) assert.ok(s.includes(n), n)
  })

  test('supabase/seed/01_initial_master_data.sql は旧名称を作らず正規名称を使う', () => {
    const s = stripComments(read('supabase/seed/01_initial_master_data.sql'))
    for (const n of LEGACY) assert.ok(!s.includes(n), n)
    assert.ok(s.includes("'WEB要件検索'") && s.includes("'instagram DM営業'") && s.includes("'他会場で開催'"))
  })

  test('取込みの分類 API は共通の名称解決（別名つき）を使う', () => {
    const src = read('app/api/import/batch/[batchId]/classify/route.ts')
    assert.ok(src.includes("from '@/lib/import/masterAliases'"))
    assert.ok(src.includes('MEDIA_ALIASES') && src.includes('CANCEL_REASON_ALIASES') && src.includes('EVENT_CATEGORY_ALIASES'))
    // 反映（apply）では、旧「企業飲食」に中分類「企業飲食」も設定する
    const apply = read('app/api/import/batch/[batchId]/apply/route.ts')
    assert.ok(apply.includes('resolveEventSubcategoryId'))
  })
})
