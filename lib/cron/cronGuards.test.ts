/**
 * cron の安全基盤（認証・動作モード・service role の扱い）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cron/cronGuards.test.ts
 * DB・ネットワーク接続は一切使用しない。秘密の値は架空のダミー文字列のみ。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCronSecretConfigured, verifyCronAuth } from './auth.ts'
import { decideExecution, parseDryRunBody, parseDryRunParam, resolveCronMode } from './mode.ts'
import { AdminClientConfigError, readAdminClientConfig } from './adminEnv.ts'

const SECRET = 'dummy-secret-for-tests-only'

describe('CASE 1〜5: cron 認証（フェイルクローズ）', () => {
  test('CASE 1: CRON_SECRET 未設定 → 常に拒否（"Bearer undefined" でも通らない）', () => {
    for (const header of [null, undefined, '', 'Bearer undefined', 'Bearer null', 'Bearer ', `Bearer ${SECRET}`]) {
      const r = verifyCronAuth(header, undefined)
      assert.deepEqual(r, { ok: false, reason: 'secret_not_configured' }, `header=${JSON.stringify(header)}`)
    }
  })

  test('CASE 2: CRON_SECRET が空文字・空白・"undefined"/"null" の文字列 → 常に拒否', () => {
    for (const secret of ['', '   ', 'undefined', 'null', 'UNDEFINED']) {
      for (const header of ['Bearer ', 'Bearer undefined', 'Bearer null', `Bearer ${secret}`, null]) {
        assert.equal(verifyCronAuth(header, secret).ok, false, `secret=${JSON.stringify(secret)} header=${JSON.stringify(header)}`)
      }
    }
    assert.equal(isCronSecretConfigured(''), false)
    assert.equal(isCronSecretConfigured(undefined), false)
    assert.equal(isCronSecretConfigured(SECRET), true)
  })

  test('CASE 3: Authorization ヘッダなし → 拒否', () => {
    assert.deepEqual(verifyCronAuth(null, SECRET), { ok: false, reason: 'missing_header' })
    assert.deepEqual(verifyCronAuth(undefined, SECRET), { ok: false, reason: 'missing_header' })
    assert.deepEqual(verifyCronAuth('', SECRET), { ok: false, reason: 'missing_header' })
  })

  test('CASE 4: 誤った Bearer / 形式不正 → 拒否', () => {
    assert.deepEqual(verifyCronAuth('Bearer wrong-secret', SECRET), { ok: false, reason: 'mismatch' })
    assert.deepEqual(verifyCronAuth(`Bearer ${SECRET}x`, SECRET), { ok: false, reason: 'mismatch' })
    assert.deepEqual(verifyCronAuth(`Bearer ${SECRET.slice(0, -1)}`, SECRET), { ok: false, reason: 'mismatch' })
    assert.equal(verifyCronAuth(SECRET, SECRET).ok, false, 'Bearer なし')
    assert.equal(verifyCronAuth(`Basic ${SECRET}`, SECRET).ok, false, 'Basic')
    assert.equal(verifyCronAuth(`Bearer ${SECRET} extra`, SECRET).ok, false, '余分な語')
  })

  test('CASE 5: 正しい secret → 認証通過（前後の空白は許容）', () => {
    assert.deepEqual(verifyCronAuth(`Bearer ${SECRET}`, SECRET), { ok: true })
    assert.deepEqual(verifyCronAuth(`bearer ${SECRET}`, SECRET), { ok: true })
    assert.deepEqual(verifyCronAuth(` Bearer ${SECRET} `, SECRET), { ok: true })
  })

  test('失敗の理由・戻り値に secret の値が含まれない', () => {
    const results = [verifyCronAuth('Bearer wrong', SECRET), verifyCronAuth(null, SECRET), verifyCronAuth('x', undefined)]
    for (const r of results) assert.ok(!JSON.stringify(r).includes(SECRET))
  })
})

describe('CASE 8〜11: 動作モード', () => {
  test('CASE 8: mode 未設定・空・不正な値 → dry（live にならない）', () => {
    for (const raw of [undefined, null, '', '   ', 'DRYRUN', 'true', '1', 'liv', 'on', 'enable']) {
      assert.equal(resolveCronMode(raw as string | undefined), 'dry', `raw=${JSON.stringify(raw)}`)
    }
  })

  test('off / dry / live は明示した場合のみ（大文字小文字・空白は許容）', () => {
    assert.equal(resolveCronMode('off'), 'off')
    assert.equal(resolveCronMode('dry'), 'dry')
    assert.equal(resolveCronMode('live'), 'live')
    assert.equal(resolveCronMode(' LIVE '), 'live')
  })

  test('CASE 9: mode=off → 書込みなし（cron も管理者も disabled）', () => {
    for (const trigger of ['cron', 'admin'] as const) {
      for (const dryRunRequested of [false, true]) {
        assert.equal(decideExecution({ trigger, mode: 'off', dryRunRequested }), 'disabled')
      }
    }
  })

  test('CASE 10: mode=dry → cron は dry（SELECT のみ）。管理者の本実行は blocked', () => {
    assert.equal(decideExecution({ trigger: 'cron', mode: 'dry', dryRunRequested: false }), 'dry')
    assert.equal(decideExecution({ trigger: 'cron', mode: 'dry', dryRunRequested: true }), 'dry')
    assert.equal(decideExecution({ trigger: 'admin', mode: 'dry', dryRunRequested: true }), 'dry')
    assert.equal(decideExecution({ trigger: 'admin', mode: 'dry', dryRunRequested: false }), 'blocked')
  })

  test('CASE 11: mode=live → 本実行は live のみ。dryRun 指定があれば live でも dry', () => {
    assert.equal(decideExecution({ trigger: 'cron', mode: 'live', dryRunRequested: false }), 'live')
    assert.equal(decideExecution({ trigger: 'admin', mode: 'live', dryRunRequested: false }), 'live')
    assert.equal(decideExecution({ trigger: 'cron', mode: 'live', dryRunRequested: true }), 'dry')
    assert.equal(decideExecution({ trigger: 'admin', mode: 'live', dryRunRequested: true }), 'dry')
  })

  test('既定（環境変数なし）の cron GET も管理者 POST も、書込み（live）にならない', () => {
    const mode = resolveCronMode(undefined)
    for (const trigger of ['cron', 'admin'] as const) {
      for (const dryRunRequested of [false, true]) {
        assert.notEqual(decideExecution({ trigger, mode, dryRunRequested }), 'live')
      }
    }
  })

  test('dryRun の指定方法: GET ?dryRun=1|true / POST { dryRun: true }。本文が空・不正でも例外にしない', () => {
    assert.equal(parseDryRunParam('1'), true)
    assert.equal(parseDryRunParam('true'), true)
    assert.equal(parseDryRunParam('TRUE'), true)
    for (const v of [null, undefined, '', '0', 'false', 'yes']) assert.equal(parseDryRunParam(v as string | null), false)
    assert.equal(parseDryRunBody({ dryRun: true }), true)
    for (const b of [null, undefined, {}, { dryRun: false }, { dryRun: 'true' }, 'dryRun', 1, []]) assert.equal(parseDryRunBody(b), false)
  })
})

describe('CASE 6: service role クライアントは anon にフォールバックしない', () => {
  test('SUPABASE_SERVICE_ROLE_KEY が未設定・空 → 例外（anon キーがあっても使わない）', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dummy-anon' }
    for (const key of [undefined, '', '   ']) {
      assert.throws(
        () => readAdminClientConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: key }),
        (e: unknown) => e instanceof AdminClientConfigError && e.code === 'missing_service_role_key'
      )
    }
  })

  test('URL が未設定 → 例外', () => {
    assert.throws(
      () => readAdminClientConfig({ SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role' }),
      (e: unknown) => e instanceof AdminClientConfigError && e.code === 'missing_url'
    )
  })

  test('設定がそろっていれば値を返す。エラーメッセージに値は含まれない', () => {
    const cfg = readAdminClientConfig({ NEXT_PUBLIC_SUPABASE_URL: ' https://example.supabase.co ', SUPABASE_SERVICE_ROLE_KEY: ' dummy-service-role ' })
    assert.deepEqual(cfg, { url: 'https://example.supabase.co', serviceRoleKey: 'dummy-service-role' })
    try {
      readAdminClientConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://leak-check.example.co' })
    } catch (e) {
      assert.ok(!String((e as Error).message).includes('leak-check'))
    }
  })
})

// ─── ソースの静的確認 ───────────────────────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const ROUTES = ['app/api/auto-cancel/route.ts', 'app/api/auto-complete/route.ts']

/** ディレクトリ配下の .ts/.tsx を再帰的に列挙する */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...walk(rel))
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel)
  }
  return out
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('CASE 7, 37: service role は cron GET だけ。クライアントに露出しない', () => {
  const getPart = (src: string) => src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  const postPart = (src: string) => src.slice(src.indexOf('export async function POST'))

  test('CASE 7: 管理者 POST（通常ユーザー経路）は service role を使わず、既存の管理者認証を維持する', () => {
    for (const rel of ROUTES) {
      const post = stripComments(postPart(read(rel)))
      assert.doesNotMatch(post, /createCronAdminClient|SERVICE_ROLE/, rel)
      assert.match(post, /await requireAdmin\(\)/, rel)
      assert.match(post, /await createClient\(\)/, `${rel}: ログイン済みセッションのクライアント`)
    }
  })

  test('GET: 認証（verifyCronAuth）を先に行い、失敗したら DB クライアントを作る前に終了する', () => {
    for (const rel of ROUTES) {
      const get = stripComments(getPart(read(rel)))
      const iAuth = get.indexOf('verifyCronAuth(')
      const iReturn401 = get.indexOf('status: 401')
      const iClient = get.indexOf('createCronAdminClient(')
      assert.ok(iAuth >= 0 && iReturn401 > iAuth && iClient > iReturn401, `${rel}: 認証 → 401 → クライアント生成 の順`)
      assert.match(get, /verifyCronAuth\(request\.headers\.get\('authorization'\), process\.env\.CRON_SECRET\)/, rel)
      assert.doesNotMatch(get, /Bearer \$\{/, `${rel}: 旧実装の直接比較が残っていない`)
    }
  })

  test('GET: 動作モードは CRON_MODE から解決され（未設定は dry）、off は DB クライアント生成前に終了する', () => {
    for (const rel of ROUTES) {
      const get = stripComments(getPart(read(rel)))
      assert.match(get, /resolveCronMode\(process\.env\.CRON_MODE\)/, rel)
      assert.ok(get.indexOf("decision === 'disabled'") < get.indexOf('createCronAdminClient('), `${rel}: off はクライアント生成前に終了`)
    }
  })

  test('createCronAdminClient を import しているのは、cron の2ルートだけ', () => {
    const importers = [...walk('app'), ...walk('components'), ...walk('lib'), 'middleware.ts']
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => /from\s+['"]@\/lib\/supabase\/admin['"]/.test(read(f)))
      .sort()
    assert.deepEqual(importers, [...ROUTES].sort())
  })

  test('CASE 37: admin.ts は server-only で、NEXT_PUBLIC を鍵に使わず、anon キーを使わない', () => {
    const admin = stripComments(read('lib/supabase/admin.ts'))
    assert.match(admin, /^\s*import 'server-only'/m)
    assert.match(admin, /readAdminClientConfig\(process\.env\)/)
    assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SERVICE|NEXT_PUBLIC_.*SERVICE_ROLE/)
    assert.doesNotMatch(admin, /ANON/i, 'anon へのフォールバックがない')
    const env = stripComments(read('lib/cron/adminEnv.ts'))
    assert.match(env, /SUPABASE_SERVICE_ROLE_KEY/)
    assert.doesNotMatch(env, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/)
  })

  test("CASE 37: 'use client' のファイル・middleware に service role の参照がなく、鍵は NEXT_PUBLIC_ 変数にならない", () => {
    const all = [...walk('app'), ...walk('components'), ...walk('lib'), 'middleware.ts']
    for (const f of all.filter((f) => !f.endsWith('.test.ts'))) {
      const src = read(f)
      if (/^\s*['"]use client['"]/m.test(src) || f === 'middleware.ts') {
        assert.doesNotMatch(src, /SERVICE_ROLE|supabase\/admin|createCronAdminClient/, `${f} に service role の参照がある`)
      }
      assert.doesNotMatch(src, /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/, `${f}: 鍵を NEXT_PUBLIC_ にしてはいけない`)
    }
  })

  test('secret / service role key の値を出力しない（console / レスポンスに process.env を渡さない）', () => {
    for (const rel of [...ROUTES, 'lib/supabase/admin.ts', 'lib/cron/auth.ts', 'lib/cron/autoCancelRunner.ts', 'lib/cron/autoCompleteRunner.ts']) {
      const src = stripComments(read(rel))
      assert.doesNotMatch(src, /console\.\w+\([^)]*process\.env\.(CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY)/, rel)
      assert.doesNotMatch(src, /json\([^)]*process\.env\./, rel)
    }
  })
})

describe('管理者ボタン: 対象の確認（dry-run）→ 明示的な確認 → 本実行', () => {
  const button = read('components/dashboard/AutoCancelButton.tsx')

  test('最初の POST は dryRun: true。本実行は確認ダイアログの後だけ', () => {
    assert.match(button, /const dryRes = await post\(true\)/)
    assert.match(button, /window\.confirm\(/)
    assert.ok(button.indexOf('post(true)') < button.indexOf('window.confirm(') && button.indexOf('window.confirm(') < button.indexOf('post(false)'))
  })

  test('モードが live でない場合（liveEnabled=false）は、本実行（post(false)）に進まない', () => {
    assert.ok(button.indexOf('if (!dry.liveEnabled)') >= 0 && button.indexOf('if (!dry.liveEnabled)') < button.indexOf('post(false)'))
    assert.match(button, /現在は確認のみのモード（dry）/)
  })

  test('件数上限超過・実行不可（liveBlockers）の場合も本実行に進まない', () => {
    assert.ok(button.indexOf('dry.exceedsWriteLimit') < button.indexOf('post(false)'))
    assert.ok(button.indexOf('dry.liveBlockers') < button.indexOf('post(false)'))
  })
})

describe('vercel.json の cron 設定は変更しない', () => {
  test('スケジュールは従来どおり（UTC 15:00 / 15:10 = JST 00:00 / 00:10）', () => {
    const cfg = JSON.parse(read('vercel.json'))
    assert.deepEqual(cfg.crons, [
      { path: '/api/auto-cancel', schedule: '0 15 * * *' },
      { path: '/api/auto-complete', schedule: '10 15 * * *' },
    ])
  })
})
