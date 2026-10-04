/**
 * 分析 API の cases 取得項目に preview_datetime が含まれることの自動テスト（node:test）
 * 実行: node --test lib/utils/analyticsPreviewSelect.test.ts
 * DB・Supabase・ネットワーク接続は一切使用しない。ソースファイルの文字列読み取りのみ。
 *
 * 背景: calcKpi は下見件数を preview_datetime の有無で数える。取得項目に含めていない API では
 * 下見件数・下見率が常に 0 になっていた（認知経路・イベント分類・フロア・連絡方法）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calcKpi, type CaseRow } from './analytics.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const ANALYTICS_DIR = 'app/api/analytics'

/** cases を取得する select('...') 文字列を取り出す */
function casesSelects(src: string): string[] {
  return Array.from(src.matchAll(/from\('cases'\)\s*\.select\(\s*(['"`])([\s\S]*?)\1/g), (m) => m[2])
}

/** KPI 集計に渡す select（売上=estimate_amount・status・期間判定の inquiry_date を取得するもの）。一覧表示用の select は対象外 */
const kpiSelects = (src: string) =>
  casesSelects(src).filter((s) => s.includes('estimate_amount') && s.includes('status') && s.includes('inquiry_date'))

describe('calcKpi を使う分析 API は preview_datetime を取得している', () => {
  const routes = readdirSync(resolve(ROOT, ANALYTICS_DIR))
    .map((d) => `${ANALYTICS_DIR}/${d}/route.ts`)
    .filter((p) => existsSync(resolve(ROOT, p)))
    .filter((p) => read(p).includes('calcKpi('))

  test('calcKpi を呼ぶ分析 API が見つかる（認知経路・イベント分類・フロア・連絡方法 を含む）', () => {
    for (const name of ['media', 'event-categories', 'floors', 'contact-methods']) {
      assert.ok(routes.includes(`${ANALYTICS_DIR}/${name}/route.ts`), name)
    }
  })

  for (const p of ['media', 'event-categories', 'floors', 'contact-methods'].map((n) => `${ANALYTICS_DIR}/${n}/route.ts`)) {
    test(`${p}: cases の select に preview_datetime がある`, () => {
      const selects = casesSelects(read(p))
      assert.ok(selects.length >= 1, 'cases の select が見つからない')
      for (const s of selects) assert.ok(s.split(',').map((x) => x.trim()).includes('preview_datetime'), s)
    })
  }

  test('calcKpi を呼ぶすべての分析 API で、KPI 用の cases select に preview_datetime がある（今後の取りこぼしを防ぐ）', () => {
    for (const p of routes) {
      const selects = kpiSelects(read(p))
      assert.ok(selects.length >= 1, `${p}: KPI 用の select が見つからない`)
      for (const s of selects) {
        assert.ok(s.split(',').map((x) => x.trim()).includes('preview_datetime'), `${p}: ${s}`)
      }
    }
  })
})

describe('preview_datetime がある案件は下見件数・下見率に正しく反映される', () => {
  const row = (over: Partial<CaseRow>): CaseRow => ({
    id: 'x', status: 'inquiry', auto_cancel: false, preview_datetime: null, estimate_amount: 0,
    inquiry_date: '2026-03-15', event_date: null, media_id: null, contact_method_id: null, floor_id: null,
    event_category_id: null, event_subcategory_id: null, cancel_reason_id: null, cancel_note: null, company: 'dummy', ...over,
  })

  test('取得できていれば下見件数を数え、取得できていない（undefined）と 0 になる', () => {
    const withPreview = [row({ preview_datetime: '2026-04-01T10:00:00Z' }), row({}), row({ preview_datetime: '2026-04-02T10:00:00Z', status: 'confirmed', estimate_amount: 100000 })]
    const k = calcKpi(withPreview)
    assert.equal(k.preview, 2)
    assert.equal(k.previewRate, 67) // 2 / 3
    // 取得項目に含めなかった場合の再現（旧不具合）: preview_datetime が undefined だと 0
    const missing = withPreview.map(({ preview_datetime: _p, ...rest }) => rest as unknown as CaseRow)
    assert.equal(calcKpi(missing).preview, 0)
    assert.equal(calcKpi(missing).previewRate, 0)
  })
})
