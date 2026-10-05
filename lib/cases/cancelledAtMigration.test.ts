/**
 * cancelled_at の migration・API 保護・取得列の静的確認（node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/cancelledAtMigration.test.ts
 * migration とソースは文字列として読むだけで、実行・適用はしない。DB・Supabase・ネットワーク接続は一切使用しない。
 *
 * DB トリガーの実際の動作（打刻・履歴・原子性・RLS・updated_at との共存）は、ここでは静的に確認する。
 * 実 DB エンジンでの動作確認は、リポジトリ外のメモリ上 DB（PGlite）で別途行っている（依存関係は追加しない）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const COL = 'supabase/migrations/20261005_add_cases_cancelled_at.sql'
const TRG = 'supabase/migrations/20261005_cases_status_change_trigger.sql'
/** コメント行（-- ）を除いた実行される SQL だけ */
const code = (rel: string) => read(rel).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
/** $$ ... $$ の本体を取り出す。[0] = 前提チェックの DO ブロック、[1] = 打刻関数、[2] = 履歴関数 */
const bodies = (sql: string) => Array.from(sql.matchAll(/\$\$([\s\S]*?)\$\$/g), (m) => m[1])

describe('migration A: cancelled_at 列の追加（CASE 29）', () => {
  const sql = () => code(COL)

  test('列は timestamptz・NULL 可・default なし。IF NOT EXISTS で冪等', () => {
    assert.match(sql(), /ALTER TABLE public\.cases\s+ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;/)
    assert.doesNotMatch(sql(), /DEFAULT/i)
    assert.doesNotMatch(sql(), /NOT NULL/i)
  })

  test('既存データの変更・index・破壊的操作がない（backfill なし）', () => {
    const s = sql()
    assert.doesNotMatch(s, /\bUPDATE\b/i, 'UPDATE（backfill）がない')
    assert.doesNotMatch(s, /\bINSERT\b/i)
    assert.doesNotMatch(s, /\bDELETE\b/i)
    assert.doesNotMatch(s, /\bTRUNCATE\b/i)
    assert.doesNotMatch(s, /\bDROP\b/i)
    assert.doesNotMatch(s, /CREATE\s+(UNIQUE\s+)?INDEX/i, 'index を追加しない')
    assert.doesNotMatch(s, /\bPOLICY\b|\bGRANT\b|ENABLE ROW LEVEL SECURITY/i, 'RLS・権限は変更しない')
  })

  test('適用状況・適用順・rollback がヘッダーに明記されている', () => {
    const h = read(COL)
    assert.match(h, /未適用/)
    assert.match(h, /rollback/)
    assert.match(h, /DROP COLUMN IF EXISTS cancelled_at/)
  })
})

describe('migration B: status 変更トリガー（CASE 29, 30）', () => {
  const sql = () => code(TRG)

  test('cases / case_history のデータを書き換える文がない（backfill・UPDATE cases・DELETE・DROP なし）', () => {
    const s = sql()
    assert.doesNotMatch(s, /\bUPDATE\s+(public\.)?cases\b/i, 'UPDATE cases がない')
    assert.doesNotMatch(s, /\bUPDATE\s+(public\.)?case_history\b/i)
    assert.doesNotMatch(s, /\bDELETE\b/i)
    assert.doesNotMatch(s, /\bTRUNCATE\b/i)
    assert.doesNotMatch(s, /\bDROP\b/i, '実行される SQL に DROP がない（rollback 手順はコメントのみ）')
    assert.doesNotMatch(s, /\bALTER\s+TABLE\b/i)
    assert.doesNotMatch(s, /INSERT\s+INTO\s+(public\.)?cases\b/i)
    // INSERT は case_history だけ。関数本体の中にだけ存在する
    const inserts = Array.from(s.matchAll(/INSERT\s+INTO\s+([\w.]+)/gi), (m) => m[1])
    assert.deepEqual(inserts, ['public.case_history'])
    const outside = s.replace(/\$\$[\s\S]*?\$\$/g, '')
    assert.doesNotMatch(outside, /\bINSERT\b/i, '関数の外（migration 実行時）には INSERT がない')
  })

  test('CASE 30: 打刻は「OLD.status <> cancelled かつ NEW.status = cancelled」の遷移だけ', () => {
    const fn = bodies(sql())[1]
    assert.match(fn, /IF\s+OLD\.status IS DISTINCT FROM NEW\.status\s+AND\s+NEW\.status = 'cancelled'\s+AND\s+OLD\.status <> 'cancelled'\s+THEN\s+NEW\.cancelled_at := now\(\);\s+END IF;/)
    assert.equal((sql().match(/cancelled_at\s*:=/g) ?? []).length, 1, '代入は1か所だけ')
    assert.doesNotMatch(sql(), /cancelled_at\s*:=\s*(NULL|OLD)/i, 'cancelled から離れても cancelled_at を消さない・戻さない')
    assert.doesNotMatch(sql(), /cancelled_at\s*=\s*NULL/i)
  })

  test('トリガーは UPDATE OF status のみ。WHEN で status が実際に変わった行だけ。INSERT では発火しない（取込は NULL のまま）', () => {
    const s = sql()
    const triggers = Array.from(s.matchAll(/CREATE OR REPLACE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+([\s\S]*?)EXECUTE FUNCTION\s+([\w.]+)\(\)/g))
    assert.equal(triggers.length, 2)
    for (const t of triggers) {
      assert.match(t[3], /^UPDATE OF status ON public\.cases\s+FOR EACH ROW\s+WHEN \(OLD\.status IS DISTINCT FROM NEW\.status\)\s*$/, t[1])
    }
    assert.deepEqual(triggers.map((t) => [t[1], t[2], t[4]]), [
      ['trg_cases_stamp_cancelled_at', 'BEFORE', 'public.cases_stamp_cancelled_at'],
      ['trg_cases_record_status_history', 'AFTER', 'public.cases_record_status_history'],
    ])
    assert.doesNotMatch(s, /\bINSERT\s+OR\b|\b(BEFORE|AFTER)\s+INSERT\b/i)
  })

  test('既存の trg_cases_updated_at と衝突しない（名前が別・触らない）', () => {
    assert.doesNotMatch(sql(), /trg_cases_updated_at/)
    assert.doesNotMatch(sql(), /DISABLE TRIGGER|ENABLE TRIGGER/i, 'migration 自体は既存トリガーを無効化しない')
    const names = Array.from(sql().matchAll(/CREATE OR REPLACE TRIGGER\s+(\w+)/g), (m) => m[1])
    assert.ok(!names.includes('trg_cases_updated_at'))
    // BEFORE 同士は名前順に発火: stamp_cancelled_at < updated_at。触る列が別（cancelled_at / updated_at）
    assert.ok('trg_cases_stamp_cancelled_at' < 'trg_cases_updated_at')
  })

  test('SECURITY DEFINER の関数は search_path を固定し、参照をスキーマ修飾している。実行権限を絞る', () => {
    const s = sql()
    const defs = Array.from(s.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)\(\)[\s\S]*?\$\$/g), (m) => m[0])
    assert.equal(defs.length, 2)
    for (const d of defs) assert.match(d, /SET search_path = ''/, d.slice(0, 80))
    const history = defs.find((d) => d.includes('cases_record_status_history'))!
    assert.match(history, /SECURITY DEFINER/)
    assert.doesNotMatch(defs.find((d) => d.includes('cases_stamp_cancelled_at'))!, /SECURITY DEFINER/, '打刻関数は DEFINER にしない')
    const fn = bodies(s)[2]
    assert.match(fn, /INSERT INTO public\.case_history/)
    assert.match(fn, /auth\.uid\(\)/)
    // 修飾なしのテーブル参照がない
    assert.doesNotMatch(fn, /(FROM|INTO|UPDATE|JOIN)\s+(?!public\.|auth\.)\w+/i)
    assert.match(s, /REVOKE ALL ON FUNCTION public\.cases_record_status_history\(\) FROM anon, authenticated;/)
  })

  test('CASE 28: 履歴の action_type は既存 CHECK に適合（status_change / auto_cancel）。既存の列だけ使い、列・制約は追加しない', () => {
    const schema = read('supabase/migrations/003_create_case_related_tables.sql')
    const check = /action_type TEXT NOT NULL CHECK \(action_type IN \(([\s\S]*?)\)\)/.exec(schema)![1]
    const allowed = Array.from(check.matchAll(/'(\w+)'/g), (m) => m[1])
    const fn = bodies(sql())[2]
    const used = Array.from(fn.matchAll(/'(status_change|auto_cancel)'/g), (m) => m[1])
    assert.ok(used.includes('status_change') && used.includes('auto_cancel'))
    for (const a of used) assert.ok(allowed.includes(a), a)
    // INSERT する列は case_history に実在する
    const cols = /INSERT INTO public\.case_history \(([^)]*)\)/.exec(fn)![1].split(',').map((c) => c.trim())
    const table = /CREATE TABLE case_history \(([\s\S]*?)\n\);/.exec(schema)![1]
    for (const c of cols) assert.match(table, new RegExp(`\\b${c}\\b`), c)
    assert.deepEqual(cols, ['case_id', 'action_type', 'message', 'old_value', 'new_value', 'changed_by'])
    assert.doesNotMatch(sql(), /ALTER TABLE|ADD COLUMN|ADD CONSTRAINT/i)
  })

  test('履歴: old_value/new_value に status、new_value に auto_cancel。source は自動キャンセルのときだけ（偽の source を入れない）', () => {
    const fn = bodies(sql())[2]
    assert.match(fn, /jsonb_build_object\('status', OLD\.status\)/)
    assert.match(fn, /jsonb_build_object\('status', NEW\.status, 'auto_cancel', NEW\.auto_cancel, 'source', 'auto_cancel'\)/)
    assert.match(fn, /jsonb_build_object\('status', NEW\.status, 'auto_cancel', NEW\.auto_cancel\)\s+END/)
    assert.equal((fn.match(/'source'/g) ?? []).length, 1, 'source を入れるのは自動キャンセルの1か所だけ')
    // 自動キャンセル判定: cancelled への遷移かつ auto_cancel が新たに true
    assert.match(fn, /NEW\.status = 'cancelled'\s+AND NEW\.auto_cancel IS TRUE\s+AND OLD\.auto_cancel IS NOT TRUE/)
  })

  test('前提チェック（cancelled_at 列が無ければ中断）と、適用状況・rollback の記載がある', () => {
    assert.match(sql(), /RAISE EXCEPTION 'cases\.cancelled_at がありません/)
    const h = read(TRG)
    assert.match(h, /未適用/)
    assert.match(h, /DROP TRIGGER IF EXISTS trg_cases_record_status_history ON public\.cases;/)
    assert.match(h, /DROP FUNCTION IF EXISTS public\.cases_stamp_cancelled_at\(\);/)
  })

  test('Production の UUID・個人情報・秘密情報を含まない', () => {
    for (const f of [COL, TRG]) {
      const t = read(f)
      assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, f)
      assert.doesNotMatch(t, /@[\w-]+\.(com|jp)|service_role_key|CRON_SECRET|eyJ[\w-]{20,}/i, f)
      assert.doesNotMatch(t, /\b[a-z]{20}\b\.supabase\.(co|com)|supabase\.co/i, f)
    }
  })
})

describe('CASE 18, 19: Excel取込・クライアント入力から cancelled_at を設定させない', () => {
  test('PUT /api/cases/[id]: cancelled_at はサーバー管理（STRIP_FIELDS）で、クライアント値を送らない', () => {
    const src = read('app/api/cases/[id]/route.ts')
    const strip = /const STRIP_FIELDS = \[([\s\S]*?)\] as const/.exec(src)![1]
    assert.match(strip, /'cancelled_at'/)
    assert.match(strip, /'confirmed_at'/, '既存の保護も維持')
    // STRIP されたキーは updateData に入らない（ループが STRIP_FIELDS を参照している）
    assert.match(src, /if \(!\(STRIP_FIELDS as readonly string\[\]\)\.includes\(key\)\)\s*\{\s*updateData\[key\] = value/)
    // アプリ側で cancelled_at を代入しない（打刻は DB トリガーだけ）
    assert.doesNotMatch(src.replace(/'cancelled_at',.*\n/, ''), /cancelled_at/)
  })

  test('POST /api/cases: ボディの cancelled_at を取り除いて INSERT する。アプリ側で打刻しない', () => {
    const src = read('app/api/cases/route.ts')
    assert.match(src, /cancelled_at:\s*_ignoredCancelledAt/)
    assert.match(src, /confirmed_at:\s*_ignoredConfirmedAt/)
    assert.match(src, /\.\.\.insertData\s*\}\s*=\s*body as Record<string, unknown>/)
    assert.doesNotMatch(src, /insertData\.cancelled_at/)
  })

  test('Excel 取込（apply）は cancelled_at を一切指定しない → 最初から cancelled の取込は NULL（取込時刻を入れない）', () => {
    const src = read('app/api/import/batch/[batchId]/apply/route.ts')
    assert.doesNotMatch(src, /cancelled_at/)
    assert.match(src, /status:\s+toValidStatus\(row\.status_raw\)/, 'status は取込どおり（cancelled になり得る）')
  })

  test('複製は cancelled_at を引き継がない・設定しない', () => {
    const src = read('lib/cases/duplicate.ts')
    assert.doesNotMatch(src, /cancelled_at/)
    assert.match(src, /status: 'inquiry'/)
  })

  test('型 Case に cancelled_at（string | null）がある', () => {
    assert.match(read('types/database.ts'), /cancelled_at: string \| null/)
  })
})

describe('CASE 25: calcKpi を使う API・画面はすべて cancelled_at を SELECT している', () => {
  const casesSelects = (src: string) =>
    Array.from(src.matchAll(/from\('cases'\)\s*\.select\(\s*(['"`])([\s\S]*?)\1/g), (m) => m[2])
  const kpiSelects = (src: string) => casesSelects(src).filter((s) => s.includes('estimate_amount') && s.includes('status') && s.includes('inquiry_date'))

  const ANALYTICS_DIR = 'app/api/analytics'
  const files = [
    ...readdirSync(resolve(ROOT, ANALYTICS_DIR)).map((d) => `${ANALYTICS_DIR}/${d}/route.ts`).filter((p) => existsSync(resolve(ROOT, p))),
    'app/(dashboard)/page.tsx',
  ].filter((p) => read(p).includes('calcKpi('))

  test('対象が見つかる（dashboard / monthly / yearly / media / contact-methods / floors / event-categories / ダッシュボード画面）', () => {
    for (const name of ['dashboard', 'monthly', 'yearly', 'media', 'contact-methods', 'floors', 'event-categories']) {
      assert.ok(files.includes(`${ANALYTICS_DIR}/${name}/route.ts`), name)
    }
    assert.ok(files.includes('app/(dashboard)/page.tsx'))
  })

  for (const f of ['dashboard', 'monthly', 'yearly', 'media', 'contact-methods', 'floors', 'event-categories'].map((n) => `${ANALYTICS_DIR}/${n}/route.ts`).concat('app/(dashboard)/page.tsx')) {
    test(`${f}: KPI 用の cases 取得に cancelled_at と preview_datetime が含まれる`, () => {
      const selects = kpiSelects(read(f))
      assert.ok(selects.length >= 1, 'KPI 用の select が見つかる')
      for (const s of selects) {
        assert.match(s, /\bcancelled_at\b/, s.slice(0, 60))
        assert.match(s, /\bpreview_datetime\b/, s.slice(0, 60))
      }
    })
  }

  test('calcKpi を呼ぶファイルが、上の一覧以外にも増えていないか（増えたら cancelled_at の取得を確認すること）', () => {
    const all = [
      ...readdirSync(resolve(ROOT, ANALYTICS_DIR)).map((d) => `${ANALYTICS_DIR}/${d}/route.ts`).filter((p) => existsSync(resolve(ROOT, p))),
      'app/(dashboard)/page.tsx',
    ].filter((p) => read(p).includes('calcKpi('))
    assert.equal(all.length, 8)
  })
})

describe('CASE 16, 15, 17: cron ランナーは case_history に書かない・cancelled_at に触れない（PHASE 1 の安全装置は維持）', () => {
  const stripComments = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*')).join('\n')

  test('autoCancelRunner / autoCompleteRunner のコードに case_history の操作がない（履歴は DB トリガーが記録）', () => {
    for (const f of ['lib/cron/autoCancelRunner.ts', 'lib/cron/autoCompleteRunner.ts']) {
      const src = stripComments(read(f))
      assert.doesNotMatch(src, /case_history/, f)
      assert.doesNotMatch(src, /actorUserId|historyRecorded/, f)
    }
  })

  test('自動完了は cancelled_at を更新しない・取得もしない', () => {
    const src = stripComments(read('lib/cron/autoCompleteRunner.ts'))
    assert.doesNotMatch(src, /cancelled_at/)
    assert.match(src, /\.update\(\{ status: 'done' \}\)/)
  })

  test('自動キャンセルは UPDATE で cancelled_at を指定しない（トリガーが打刻）。PHASE 1 の条件は維持', () => {
    const src = stripComments(read('lib/cron/autoCancelRunner.ts'))
    assert.doesNotMatch(src, /cancelled_at:\s*(new Date|now|')/)
    assert.match(src, /status: 'cancelled',\s+auto_cancel: true,\s+cancel_reason_id: reasonId,\s+cancel_note: AUTO_CANCEL_NOTE/)
    assert.match(src, /\.eq\('status', status\)\s+\.in\('id', ids\)/, 'id + 旧 status の条件付き UPDATE')
    assert.match(src, /opts\.decision === 'live' && mode === 'live'/, 'mode ガード')
    assert.match(src, /exceedsWriteLimit/)
    assert.match(src, /reasonRows\.length !== 1/)
  })

  test('route が actor を渡さず、service role / CRON_SECRET の構成も維持', () => {
    for (const r of ['auto-cancel', 'auto-complete']) {
      const src = read(`app/api/${r}/route.ts`)
      assert.doesNotMatch(src, /actorUserId|getCurrentUser/)
      assert.match(src, /verifyCronAuth\(/)
      assert.match(src, /createCronAdminClient\(\)/)
      assert.match(src, /resolveCronMode\(process\.env\.CRON_MODE\)/)
    }
  })
})

describe('UI は変更しない', () => {
  test('画面コンポーネント・案件詳細は cancelled_at を表示・参照しない（履歴欄に status_change が自然に増えるだけ）', () => {
    const uiFiles = [
      'components/cases/CaseDetail/History.tsx',
      'components/cases/CaseDetail/StatusChanger.tsx',
      'components/cases/CaseForm.tsx',
      'app/(dashboard)/cases/[id]/page.tsx',
      'app/(dashboard)/cases/page.tsx',
      'app/(dashboard)/analytics/page.tsx',
    ]
    for (const f of uiFiles) assert.doesNotMatch(read(f), /cancelled_at|Estimated/, f)
  })
})
