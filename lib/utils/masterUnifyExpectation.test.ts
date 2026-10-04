/**
 * マスタ統合後の分析値が「元の案件から再計算」されることの自動テスト（node:test）
 * 実行: node --test lib/utils/masterUnifyExpectation.test.ts
 * 本番の集計値（2026-10-04 時点の件数・売上）を再現した架空の案件データを使う。
 * 実データ・個人情報・DB・ネットワーク接続は一切使用しない。
 *
 * 統合後の値は、画面の割合・平均の足し算ではなく、アプリの既存の calcKpi / calcPercent で求める。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcKpi, calcPercent, type CaseRow } from './analytics.ts'

let seq = 0
function make(n: number, o: { confirmed?: number; cancelled?: number; preview?: number; revenue?: number; media?: string; category?: string; sub?: string; cancel?: string }): CaseRow[] {
  const out: CaseRow[] = []
  const confirmed = o.confirmed ?? 0
  for (let i = 0; i < n; i++) {
    const isConfirmed = i < confirmed
    const isCancelled = !isConfirmed && i < confirmed + (o.cancelled ?? 0)
    out.push({
      id: `c${++seq}`, status: isConfirmed ? (i % 2 ? 'done' : 'confirmed') : isCancelled ? 'cancelled' : 'inquiry', auto_cancel: false,
      preview_datetime: i < (o.preview ?? 0) ? '2026-04-01T10:00:00Z' : null,
      estimate_amount: isConfirmed ? (i < confirmed - 1 ? Math.floor((o.revenue ?? 0) / confirmed) : (o.revenue ?? 0) - Math.floor((o.revenue ?? 0) / confirmed) * (confirmed - 1)) : 0,
      inquiry_date: '2026-03-15', event_date: null, media_id: o.media ?? null, contact_method_id: null, floor_id: null,
      event_category_id: o.category ?? null, event_subcategory_id: o.sub ?? null, cancel_reason_id: o.cancel ?? null, cancel_note: null, company: 'dummy',
    })
  }
  return out
}

const TOTAL = 531, TOTAL_CONFIRMED = 92, TOTAL_CANCEL = 144
const share = (part: number, whole: number) => calcPercent(part, whole)

describe('認知経路: 元の案件から再集計', () => {
  const webOld = make(44, { confirmed: 7, cancelled: 14, preview: 9, revenue: 9711530, media: 'old' })
  const webNew = make(37, { confirmed: 6, cancelled: 10, preview: 15, revenue: 8113511, media: 'new' })
  const merged = [...webOld, ...webNew].map((c) => ({ ...c, media_id: 'WEB要件検索' }))

  test('統合前（画面の現在値と一致）', () => {
    const a = calcKpi(webOld), b = calcKpi(webNew)
    assert.deepEqual([a.inquiry, a.confirmed, a.revenue, a.avgPrice, a.cvRate], [44, 7, 9711530, 1387361, 16])
    assert.deepEqual([b.inquiry, b.confirmed, b.revenue, b.avgPrice, b.cvRate], [37, 6, 8113511, 1352252, 16])
  })

  test('WEB要件検索（統合後）: 問合せ81 下見24 確定13 売上17,825,041 平均1,371,157 CV16% 下見率30% 確定率54%', () => {
    const k = calcKpi(merged)
    assert.deepEqual([k.inquiry, k.preview, k.confirmed, k.revenue, k.avgPrice, k.cvRate, k.previewRate, k.confirmRate], [81, 24, 13, 17825041, 1371157, 16, 30, 54])
    assert.equal(share(k.inquiry, TOTAL), 15)
    assert.equal(share(k.confirmed, TOTAL_CONFIRMED), 14)
  })

  test('平均単価・CV率・割合は足し算ではなく再計算（足し算の値とは一致しない）', () => {
    const k = calcKpi(merged)
    assert.notEqual(k.avgPrice, 1387361 + 1352252)
    assert.notEqual(k.cvRate, 16 + 16)
    assert.notEqual(share(k.inquiry, TOTAL), share(44, TOTAL) + share(37, TOTAL) + 1) // 8% + 7% = 15%（偶然一致しうる）に依存しない確認
    assert.equal(k.avgPrice, Math.round(17825041 / 13))
  })

  test('instagram DM営業（insragram営業2 + instagram DM営業2 + instagramのDM1）: 問合せ5 下見3 確定0 下見率60%', () => {
    const ig = [...make(2, { preview: 2 }), ...make(2, { preview: 1 }), ...make(1, {})]
    const k = calcKpi(ig)
    assert.deepEqual([k.inquiry, k.preview, k.confirmed, k.revenue, k.avgPrice, k.cvRate, k.previewRate], [5, 3, 0, 0, 0, 0, 60])
    assert.equal(share(k.inquiry, TOTAL), 1)
  })
})

describe('キャンセル理由: 分母は期間内のキャンセル総数（144）', () => {
  test('他会場で開催 29件=20% / 空き枠なし 18件=13%', () => {
    assert.equal(16 + 13, 29)
    assert.equal(calcPercent(29, TOTAL_CANCEL), 20)
    assert.equal(11 + 7, 18)
    assert.equal(calcPercent(18, TOTAL_CANCEL), 13) // 12.5% の四捨五入
    // 統合前の割合の足し算（11% + 9% = 20%、8% + 5% = 13%）に頼らず、件数から求めた値
    assert.equal(calcPercent(16, TOTAL_CANCEL) + calcPercent(13, TOTAL_CANCEL), 20)
  })
})

describe('イベント分類: 企業イベント（企業飲食を統合）', () => {
  const ev = make(157, { confirmed: 28, preview: 33, revenue: 41171121, category: 'ev' })
  const ins = make(96, { confirmed: 16, cancelled: 43, preview: 11, revenue: 18031030, category: 'ins' })
  const merged = [...ev, ...ins].map((c) => ({ ...c, event_category_id: '企業イベント' }))

  test('統合後: 問合せ253 割合48% 下見44 下見率17% 確定44 確定割合48% 売上59,202,151 平均1,345,503 CV17% 確定率100%', () => {
    const k = calcKpi(merged)
    assert.deepEqual([k.inquiry, k.preview, k.previewRate, k.confirmed, k.revenue, k.avgPrice, k.cvRate, k.confirmRate], [253, 44, 17, 44, 59202151, 1345503, 17, 100])
    assert.equal(share(k.inquiry, TOTAL), 48)
    assert.equal(share(k.confirmed, TOTAL_CONFIRMED), 48)
  })

  test('中分類「企業飲食」(旧NULL 87件 + 立食パーティー1件 = 88件): 問合せ88 割合17% 下見9 下見率10% 確定14 確定割合15% 売上14,162,330 平均1,011,595 CV16%', () => {
    const sub = [
      ...make(87, { confirmed: 13, cancelled: 39, preview: 8, revenue: 13700330, sub: 'ins-sub' }),
      ...make(1, { confirmed: 1, preview: 1, revenue: 462000, sub: 'ins-sub' }), // 立食パーティー
    ]
    const k = calcKpi(sub)
    assert.deepEqual([k.inquiry, k.preview, k.previewRate, k.confirmed, k.revenue, k.avgPrice, k.cvRate], [88, 9, 10, 14, 14162330, 1011595, 16])
    assert.equal(share(k.inquiry, TOTAL), 17)
    assert.equal(share(k.confirmed, TOTAL_CONFIRMED), 15)
  })

  test('旧「87件」の値（売上13,700,330・確定13・CV15%）はそのまま使えない', () => {
    const only87 = calcKpi(make(87, { confirmed: 13, cancelled: 39, preview: 8, revenue: 13700330 }))
    assert.deepEqual([only87.confirmed, only87.revenue, only87.cvRate], [13, 13700330, 15])
    const with88 = calcKpi([...make(87, { confirmed: 13, preview: 8, revenue: 13700330 }), ...make(1, { confirmed: 1, preview: 1, revenue: 462000 })])
    assert.notEqual(with88.revenue, only87.revenue)
    assert.notEqual(with88.confirmed, only87.confirmed)
  })

  test('統合前の平均単価・CV率の足し算では求めない', () => {
    const k = calcKpi(merged)
    assert.notEqual(k.avgPrice, 1470397 + 1126939)
    assert.notEqual(k.cvRate, 18 + 17)
  })
})
