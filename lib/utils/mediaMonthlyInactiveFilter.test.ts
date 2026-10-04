/**
 * 認知経路「月別内訳」: 無効マスタ かつ 対象年の実績0件の行だけを除外する仕様の自動テスト（node:test）
 * 実行: node --test lib/utils/mediaMonthlyInactiveFilter.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。架空データのみ。
 *
 * 仕様:
 *   有効マスタ                        → 0件でも表示（従来どおり）
 *   無効マスタ かつ 対象年の実績0件    → 表示しない
 *   無効マスタ かつ 対象年の実績1件以上 → 表示する（履歴確認のため）
 *   集計値そのものは変更しない（行を取り除くだけ）
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calcMediaMonthly,
  calcKpi,
  excludeInactiveEmptyMediaRows,
  UNASSIGNED_MEDIA_ID,
  type CaseRow,
} from './analytics.ts'

function makeCase(overrides: Partial<CaseRow>): CaseRow {
  return {
    id: overrides.id ?? 'case-1',
    status: overrides.status ?? 'inquiry',
    auto_cancel: false,
    preview_datetime: overrides.preview_datetime ?? null,
    estimate_amount: overrides.estimate_amount ?? 0,
    inquiry_date: overrides.inquiry_date ?? null,
    event_date: null,
    media_id: overrides.media_id ?? null,
    contact_method_id: null,
    floor_id: null,
    event_category_id: null,
    event_subcategory_id: null,
    cancel_reason_id: null,
    cancel_note: null,
    company: 'テスト株式会社',
    confirmed_at: overrides.confirmed_at ?? null,
  }
}

// 架空のマスタ。名称は本番の統合済み旧名称に合わせている（IDは架空）
const M_ACTIVE_ZERO = { id: 'm-active-zero', name: '有効・実績なし', is_active: true }
const M_ACTIVE_USED = { id: 'm-active-used', name: '有効・実績あり', is_active: true }
const M_INACTIVE_ZERO = { id: 'm-inactive-zero', name: 'test', is_active: false }
const M_INACTIVE_USED = { id: 'm-inactive-used', name: 'どの媒体か不明', is_active: false }
const M_OLD_WEB = { id: 'm-old-web', name: 'web要件検索', is_active: false }
const M_OLD_IG1 = { id: 'm-old-ig1', name: 'insragram営業', is_active: false }
const M_OLD_IG2 = { id: 'm-old-ig2', name: 'instagramのDM', is_active: false }
const M_WEB = { id: 'm-web', name: 'WEB要件検索', is_active: true }
const M_IG = { id: 'm-ig', name: 'instagram DM営業', is_active: true }

const names = (rows: { name: string }[]) => rows.map((r) => r.name)
const run = (cases: CaseRow[], masters: { id: string; name: string; is_active?: boolean }[], year = '2026') =>
  excludeInactiveEmptyMediaRows(calcMediaMonthly(cases, masters, year), masters)

describe('excludeInactiveEmptyMediaRows', () => {
  test('CASE 1: 有効マスタ・実績0件 → 表示される', () => {
    assert.deepEqual(names(run([], [M_ACTIVE_ZERO])), ['有効・実績なし'])
  })

  test('CASE 2: 有効マスタ・実績あり → 表示される', () => {
    const cases = [makeCase({ media_id: M_ACTIVE_USED.id, inquiry_date: '2026-03-01' })]
    assert.deepEqual(names(run(cases, [M_ACTIVE_USED])), ['有効・実績あり'])
  })

  test('CASE 3: 無効マスタ・実績0件 → 表示されない', () => {
    assert.deepEqual(names(run([], [M_INACTIVE_ZERO])), [])
  })

  test('CASE 4: 無効マスタ・実績あり → 表示される（問合せ / 下見のみ / 確定のみ のどれでも）', () => {
    const byInquiry = [makeCase({ media_id: M_INACTIVE_USED.id, inquiry_date: '2026-05-10' })]
    assert.deepEqual(names(run(byInquiry, [M_INACTIVE_USED])), ['どの媒体か不明'])

    // 問合せは前年、下見だけが対象年 → 下見タブで値が見えるので行を残す
    const byPreviewOnly = [makeCase({ media_id: M_INACTIVE_USED.id, inquiry_date: '2025-12-20', preview_datetime: '2026-01-05T10:00:00Z' })]
    assert.deepEqual(names(run(byPreviewOnly, [M_INACTIVE_USED])), ['どの媒体か不明'])

    // 確定だけが対象年（現ステータスが確定）
    const byConfirmedOnly = [makeCase({ media_id: M_INACTIVE_USED.id, status: 'confirmed', inquiry_date: '2025-11-01', confirmed_at: '2026-02-03T00:00:00Z' })]
    assert.deepEqual(names(run(byConfirmedOnly, [M_INACTIVE_USED])), ['どの媒体か不明'])
  })

  test('無効マスタの実績が対象年以外にしかない場合は、その年の月別内訳には表示しない（年ごとに判定）', () => {
    const cases = [makeCase({ media_id: M_INACTIVE_USED.id, inquiry_date: '2025-06-01' })]
    assert.deepEqual(names(run(cases, [M_INACTIVE_USED], '2026')), [])
    assert.deepEqual(names(run(cases, [M_INACTIVE_USED], '2025')), ['どの媒体か不明'])
  })

  test('確定日時はあるが現ステータスが確定/終了でない（キャンセル）だけの無効マスタは、確定としては実績にならない', () => {
    const cases = [makeCase({ media_id: M_INACTIVE_USED.id, status: 'cancelled', inquiry_date: '2025-01-01', confirmed_at: '2026-02-03T00:00:00Z' })]
    assert.deepEqual(names(run(cases, [M_INACTIVE_USED], '2026')), [])
  })

  test('CASE 5: 統合した旧名称（web要件検索 / insragram営業 / instagramのDM）は、参照案件0件なら表示されない', () => {
    const cases = [
      makeCase({ id: 'a', media_id: M_WEB.id, inquiry_date: '2026-01-10' }),
      makeCase({ id: 'b', media_id: M_IG.id, inquiry_date: '2026-02-10' }),
    ]
    const result = run(cases, [M_OLD_WEB, M_OLD_IG1, M_OLD_IG2, M_WEB, M_IG])
    assert.deepEqual(names(result), ['WEB要件検索', 'instagram DM営業'])
  })

  test('CASE 6: 無効マスタ「どの媒体か不明」は案件が残っていれば表示され、test のような実績0件の無効マスタは消える', () => {
    const cases = [
      makeCase({ id: 'a', media_id: M_INACTIVE_USED.id, inquiry_date: '2026-04-01' }),
      makeCase({ id: 'b', media_id: M_INACTIVE_USED.id, inquiry_date: '2026-04-02' }),
    ]
    const result = run(cases, [M_INACTIVE_ZERO, M_INACTIVE_USED, M_OLD_WEB])
    assert.deepEqual(names(result), ['どの媒体か不明'])
    assert.equal(result[0].months[3].inquiry, 2)
  })

  test('CASE 7: 正規名称（WEB要件検索 / instagram DM営業）の集計値は、除外の有無で変わらない', () => {
    const cases = [
      makeCase({ id: 'w1', media_id: M_WEB.id, status: 'confirmed', inquiry_date: '2026-01-10', preview_datetime: '2026-01-20T10:00:00Z', confirmed_at: '2026-02-01T00:00:00Z', estimate_amount: 100000 }),
      makeCase({ id: 'w2', media_id: M_WEB.id, inquiry_date: '2026-03-05' }),
      makeCase({ id: 'i1', media_id: M_IG.id, inquiry_date: '2026-05-05', preview_datetime: '2026-05-09T10:00:00Z' }),
    ]
    const masters = [M_OLD_WEB, M_OLD_IG1, M_OLD_IG2, M_WEB, M_IG]
    const unfiltered = calcMediaMonthly(cases, masters, '2026')
    const filtered = excludeInactiveEmptyMediaRows(unfiltered, masters)
    for (const m of [M_WEB, M_IG]) {
      assert.deepEqual(filtered.find((r) => r.id === m.id), unfiltered.find((r) => r.id === m.id))
    }
    const web = filtered.find((r) => r.id === M_WEB.id)!
    assert.equal(web.months.reduce((s, c) => s + c.inquiry, 0), 2)
    assert.equal(web.months.reduce((s, c) => s + c.preview, 0), 1)
    assert.equal(web.months.reduce((s, c) => s + c.confirmed, 0), 1)
    // 通常の認知経路集計（calcKpi）は今回の関数と無関係で、値が変わらない
    const kpi = calcKpi(cases.filter((c) => c.media_id === M_WEB.id))
    assert.equal(kpi.inquiry, 2)
    assert.equal(kpi.preview, 1)
    assert.equal(kpi.confirmed, 1)
    assert.equal(kpi.revenue, 100000)
  })

  test('CASE 8: 行を取り除くだけで、元の集計・総件数は変わらない（入力は変更されず、残った行は同一内容）', () => {
    const cases = [
      makeCase({ id: 'a', media_id: M_ACTIVE_USED.id, inquiry_date: '2026-01-10' }),
      makeCase({ id: 'b', media_id: M_INACTIVE_USED.id, inquiry_date: '2026-02-10' }),
      makeCase({ id: 'c', media_id: null, inquiry_date: '2026-03-10' }),
      makeCase({ id: 'd', media_id: M_OLD_WEB.id, inquiry_date: '2025-03-10' }), // 他の年 → 2026 では0件
    ]
    const masters = [M_ACTIVE_ZERO, M_ACTIVE_USED, M_INACTIVE_ZERO, M_INACTIVE_USED, M_OLD_WEB]
    const unfiltered = calcMediaMonthly(cases, masters, '2026')
    const snapshot = JSON.stringify(unfiltered)
    const filtered = excludeInactiveEmptyMediaRows(unfiltered, masters)

    assert.equal(JSON.stringify(unfiltered), snapshot, '入力の rows を変更しない')
    // 除外された行の実績は全て0 → 総件数は除外前後で一致
    const total = (rows: typeof unfiltered) => rows.reduce((s, r) => s + r.months.reduce((t, m) => t + m.inquiry + m.preview + m.confirmed, 0), 0)
    assert.equal(total(filtered), total(unfiltered))
    assert.equal(total(filtered), 3) // 2026 の問合せ3件（a, b, c）
    // 残った行は除外前と同一内容・同一順序
    assert.deepEqual(filtered, unfiltered.filter((r) => filtered.some((f) => f.id === r.id)))
    // 除外されたのは「無効 かつ 0件」の行（test / web要件検索）と、有効・0件は残る
    assert.deepEqual(names(filtered), ['有効・実績なし', '有効・実績あり', 'どの媒体か不明', '（未設定）'])
  })

  test('（未設定）行は常に残る。is_active が未取得のマスタは有効として扱う', () => {
    const cases = [makeCase({ media_id: null, inquiry_date: '2026-01-01' })]
    const result = run(cases, [{ id: 'm-x', name: 'is_active不明' }])
    assert.deepEqual(names(result), ['is_active不明', '（未設定）'])
    assert.ok(result.some((r) => r.id === UNASSIGNED_MEDIA_ID))
  })
})

// ─── 呼び出し側（API）の静的確認 ─────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const route = readFileSync(resolve(ROOT, 'app/api/analytics/media-monthly/route.ts'), 'utf8')

describe('media-monthly API の呼び出し', () => {
  test('マスタの is_active を取得し、除外関数を通している（SELECT のみ。書き込みなし）', () => {
    assert.match(route, /from\('media_master'\)\.select\('id,name,is_active'\)/)
    assert.match(route, /excludeInactiveEmptyMediaRows\(\s*calcMediaMonthly\(/)
    assert.doesNotMatch(route, /\.(insert|update|delete|upsert)\(/)
  })

  test('cases の取得項目は従来どおり（preview_datetime / confirmed_at を含む）', () => {
    const sel = route.match(/from\('cases'\)\s*\.select\(\s*'([^']*)'/)?.[1] ?? ''
    for (const col of ['preview_datetime', 'confirmed_at', 'inquiry_date', 'media_id', 'status']) {
      assert.ok(sel.split(',').includes(col), col)
    }
  })

  test('マスタは is_active で絞り込まない（有効マスタの0件行・実績のある無効マスタを取りこぼさない）', () => {
    const masterQuery = route.match(/from\('media_master'\)[^\n]*/)?.[0] ?? ''
    assert.doesNotMatch(masterQuery, /\.eq\(|\.neq\(|\.filter\(|\.is\(/)
  })
})
