/**
 * 下見前/後キャンセルの判定（cancelled_at 対応）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/cancelTiming.test.ts
 * DB・ネットワーク接続は一切使用しない。案件は架空。
 *
 * 仕様:
 *  ・cancelled_at あり（正確）: キャンセルの瞬間までに下見が実施済みなら「下見後」（ちょうど同時刻も下見後）、
 *      下見なし／キャンセル時点では未来なら「下見前」。
 *  ・cancelled_at なし（旧データ・Excel取込）: 従来どおり preview_datetime の有無で推定（あり=下見後 / なし=下見前）。
 *      推定した件数は *Estimated で別に数える。
 *  ・preview_datetime は「JST の壁時計値が UTC 欄に入っている」特殊な保存。cancelled_at は正しい瞬間（timestamptz）。
 *      比較は isPreviewDone(preview, new Date(cancelled_at)) 経由で、JST 壁時計どうしで行う。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcKpi, classifyCancelTiming, type CaseRow } from './analytics.ts'

const NOW = new Date('2026-10-05T03:00:00Z')
let seq = 0
const mk = (over: Partial<CaseRow> & Record<string, unknown> = {}): CaseRow =>
  ({
    id: `c${++seq}`, status: 'cancelled', auto_cancel: false, preview_datetime: null, cancelled_at: null,
    estimate_amount: 0, inquiry_date: '2026-10-01', event_date: null, media_id: null, contact_method_id: null,
    floor_id: null, event_category_id: null, event_subcategory_id: null, cancel_reason_id: null, cancel_note: null, company: '架空',
    ...over,
  }) as CaseRow

// 下見日時 = 2026-10-05 14:00（JST の壁時計）→ DB には '2026-10-05T14:00:00+00:00' と入っている
const PREVIEW_1400 = '2026-10-05T14:00:00+00:00'
// 同じ瞬間 = UTC 05:00（JST 14:00）
const CANCEL_AT_PREVIEW = '2026-10-05T05:00:00.000Z'

const kind = (c: Partial<CaseRow>) => {
  const r = classifyCancelTiming(mk(c))
  return r ? `${r.timing}${r.estimated ? '(推定)' : ''}` : null
}

describe('CASE 1〜7: cancelled_at あり（正確な判定）', () => {
  test('CASE 1: 下見なし → 手動キャンセル → 下見前（手動として数える）', () => {
    assert.equal(kind({ preview_datetime: null, cancelled_at: '2026-10-05T01:00:00Z' }), 'before')
    const k = calcKpi([mk({ preview_datetime: null, cancelled_at: '2026-10-05T01:00:00Z' })], NOW)
    assert.equal(k.cancelManual, 1)
    assert.equal(k.cancelBeforePreview, 1)
    assert.equal(k.cancelBeforePreviewEstimated, 0, '正確な判定は推定に数えない')
  })

  test('CASE 2: 下見済み（過去）→ 手動キャンセル → 下見後', () => {
    assert.equal(kind({ preview_datetime: '2026-10-03T11:00:00+00:00', cancelled_at: '2026-10-05T01:00:00Z' }), 'after')
  })

  test('CASE 3, 7: キャンセル時点で下見予定が未来 → 下見前（後から予定日を過ぎても変わらない）', () => {
    // 下見予定 2026-10-10 14:00 JST、キャンセルは 10-05 → 下見前。今が 10-20 になっても判定は同じ（now を使わない）
    const c = mk({ preview_datetime: '2026-10-10T14:00:00+00:00', cancelled_at: '2026-10-05T01:00:00Z' })
    assert.equal(classifyCancelTiming(c)?.timing, 'before')
    assert.equal(calcKpi([c], new Date('2026-10-20T00:00:00Z')).cancelBeforePreview, 1)
    assert.equal(calcKpi([c], new Date('2026-10-20T00:00:00Z')).cancelAfterPreview, 0)
  })

  test('CASE 4: 下見日時とキャンセル日時が同時刻 → 下見後（1秒前は下見前）', () => {
    assert.equal(kind({ preview_datetime: PREVIEW_1400, cancelled_at: CANCEL_AT_PREVIEW }), 'after')
    assert.equal(kind({ preview_datetime: PREVIEW_1400, cancelled_at: '2026-10-05T04:59:59.000Z' }), 'before')
    assert.equal(kind({ preview_datetime: PREVIEW_1400, cancelled_at: '2026-10-05T05:00:01.000Z' }), 'after')
  })

  test('CASE 5: cancelled_at あり + 下見なし → 下見前', () => {
    assert.equal(kind({ preview_datetime: null, cancelled_at: '2026-10-05T05:00:00Z' }), 'before')
  })

  test('CASE 6: cancelled_at あり + 下見が過去 → 下見後', () => {
    assert.equal(kind({ preview_datetime: '2026-09-01T10:00:00+00:00', cancelled_at: '2026-10-05T05:00:00Z' }), 'after')
  })

  test('cancelled でない案件は対象外（null）', () => {
    for (const status of ['inquiry', 'preview_adj', 'previewed', 'tentative', 'confirmed', 'done'] as const) {
      assert.equal(classifyCancelTiming(mk({ status, preview_datetime: PREVIEW_1400, cancelled_at: CANCEL_AT_PREVIEW })), null, status)
    }
  })
})

describe('CASE 8〜10: cancelled_at なし（旧データ・Excel取込 → 従来ルールで推定）', () => {
  test('CASE 8: cancelled_at なし + 下見なし → 下見前（推定）', () => {
    assert.equal(kind({ preview_datetime: null, cancelled_at: null }), 'before(推定)')
    assert.equal(kind({ preview_datetime: null, cancelled_at: undefined }), 'before(推定)', 'select していない（undefined）場合も旧データ扱い')
  })

  test('CASE 9: cancelled_at なし + 下見あり → 下見後（推定）。下見が未来でも従来どおり「あり」で判定', () => {
    assert.equal(kind({ preview_datetime: PREVIEW_1400, cancelled_at: null }), 'after(推定)')
    assert.equal(kind({ preview_datetime: '2099-01-01T10:00:00+00:00', cancelled_at: null }), 'after(推定)')
  })

  test('不正な cancelled_at は旧データ扱い（例外にならない）', () => {
    assert.equal(kind({ preview_datetime: PREVIEW_1400, cancelled_at: 'not-a-date' }), 'after(推定)')
    assert.equal(kind({ preview_datetime: null, cancelled_at: '' }), 'before(推定)')
  })

  test('CASE 10: 推定件数が別カウントされる（合計は従来の件数と同じ意味を保つ）', () => {
    const rows = [
      // 旧データ（本番の 129 / 15 に相当する構成を縮小したもの）
      mk({ preview_datetime: null }), mk({ preview_datetime: null }), mk({ preview_datetime: null }),
      mk({ preview_datetime: '2026-05-01T10:00:00+00:00' }), mk({ preview_datetime: '2026-05-02T10:00:00+00:00' }),
      // 新データ（正確）
      mk({ preview_datetime: null, cancelled_at: '2026-10-05T01:00:00Z' }),
      mk({ preview_datetime: '2026-10-03T10:00:00+00:00', cancelled_at: '2026-10-05T01:00:00Z' }),
      mk({ preview_datetime: '2026-10-09T10:00:00+00:00', cancelled_at: '2026-10-05T01:00:00Z' }), // 未来予定 → 下見前
    ]
    const k = calcKpi(rows, NOW)
    assert.equal(k.cancelBeforePreview, 3 + 1 + 1)
    assert.equal(k.cancelAfterPreview, 2 + 1)
    assert.equal(k.cancelBeforePreviewEstimated, 3)
    assert.equal(k.cancelAfterPreviewEstimated, 2)
    assert.ok(k.cancelBeforePreviewEstimated <= k.cancelBeforePreview)
    assert.ok(k.cancelAfterPreviewEstimated <= k.cancelAfterPreview)
  })

  test('旧データだけなら、従来の計算（preview_datetime の有無）と同じ数字になる（129 / 15 を崩さない）', () => {
    const legacy = [...Array(129)].map(() => mk({ preview_datetime: null })).concat([...Array(15)].map(() => mk({ preview_datetime: '2026-05-01T10:00:00+00:00' })))
    const k = calcKpi(legacy, NOW)
    assert.equal(k.cancelBeforePreview, 129)
    assert.equal(k.cancelAfterPreview, 15)
    assert.equal(k.cancelBeforePreviewEstimated, 129)
    assert.equal(k.cancelAfterPreviewEstimated, 15)
  })
})

describe('CASE 20〜22: JST / UTC・日付またぎ・環境 TZ', () => {
  test('CASE 20: JST と UTC の 9 時間差 — 単純な Date 比較では誤判定になる組を正しく判定する', () => {
    // 下見 JST 14:00（保存値 14:00Z）、キャンセル UTC 06:00 = JST 15:00 → 下見後。
    // 保存値を瞬間として比較すると 14:00Z > 06:00Z で「下見前」と誤判定する
    const preview = '2026-10-05T14:00:00+00:00'
    const cancelledAt = '2026-10-05T06:00:00.000Z'
    assert.ok(Date.parse(preview) > Date.parse(cancelledAt), '素朴な比較では下見の方が後に見える（誤り）')
    assert.equal(kind({ preview_datetime: preview, cancelled_at: cancelledAt }), 'after')
    // 逆に、キャンセル UTC 04:00 = JST 13:00 は下見（JST 14:00）より前 → 下見前
    assert.equal(kind({ preview_datetime: preview, cancelled_at: '2026-10-05T04:00:00.000Z' }), 'before')
  })

  test('CASE 21: JST の日付またぎ — UTC では前日でも、JST の暦日・時刻で判定する', () => {
    // キャンセル UTC 2026-10-04 15:30 = JST 2026-10-05 00:30。下見 JST 2026-10-05 00:10（保存値 00:10Z）→ 下見後
    assert.equal(kind({ preview_datetime: '2026-10-05T00:10:00+00:00', cancelled_at: '2026-10-04T15:30:00.000Z' }), 'after')
    // 下見 JST 2026-10-05 00:40 は、同じキャンセルより後 → 下見前
    assert.equal(kind({ preview_datetime: '2026-10-05T00:40:00+00:00', cancelled_at: '2026-10-04T15:30:00.000Z' }), 'before')
    // JST 2026-10-04 23:59 のキャンセル（UTC 14:59）と下見 JST 2026-10-05 00:00 → 下見前
    assert.equal(kind({ preview_datetime: '2026-10-05T00:00:00+00:00', cancelled_at: '2026-10-04T14:59:59.000Z' }), 'before')
    // 日付のみの下見（00:00 扱い）
    assert.equal(kind({ preview_datetime: '2026-10-05', cancelled_at: '2026-10-04T15:00:00.000Z' }), 'after')
  })

  test('CASE 22: 実行環境のタイムゾーンを変えても分類結果は同じ', () => {
    const cases: [Partial<CaseRow>, string][] = [
      [{ preview_datetime: PREVIEW_1400, cancelled_at: CANCEL_AT_PREVIEW }, 'after'],
      [{ preview_datetime: PREVIEW_1400, cancelled_at: '2026-10-05T04:59:59.000Z' }, 'before'],
      [{ preview_datetime: '2026-10-05T00:10:00+00:00', cancelled_at: '2026-10-04T15:30:00.000Z' }, 'after'],
      [{ preview_datetime: null, cancelled_at: '2026-10-04T15:30:00.000Z' }, 'before'],
      [{ preview_datetime: PREVIEW_1400, cancelled_at: null }, 'after(推定)'],
    ]
    const original = process.env.TZ
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/London']) {
        process.env.TZ = tz
        for (const [c, expected] of cases) assert.equal(kind(c), expected, `${tz}: ${JSON.stringify(c)}`)
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})

describe('CASE 23, 24, 26: 恒等式と回帰', () => {
  const mixed = (): CaseRow[] => [
    mk({ auto_cancel: false, preview_datetime: null }),
    mk({ auto_cancel: false, preview_datetime: PREVIEW_1400 }),
    mk({ auto_cancel: true, preview_datetime: null, cancelled_at: '2026-10-05T01:00:00Z' }),
    mk({ auto_cancel: true, preview_datetime: '2026-10-09T10:00:00+00:00', cancelled_at: '2026-10-05T01:00:00Z' }),
    mk({ auto_cancel: false, preview_datetime: PREVIEW_1400, cancelled_at: CANCEL_AT_PREVIEW }),
    mk({ auto_cancel: false, preview_datetime: '2026-09-01T10:00:00+00:00', cancelled_at: '2026-10-05T01:00:00Z' }),
    mk({ status: 'inquiry' }), mk({ status: 'confirmed', preview_datetime: PREVIEW_1400 }), mk({ status: 'done' }),
  ]

  test('CASE 23: 手動 + 自動 = 下見前 + 下見後（cancelled_at のあるデータだけ）', () => {
    const rows = mixed().filter((c) => c.status !== 'cancelled' || c.cancelled_at)
    const k = calcKpi(rows, NOW)
    assert.equal(k.cancelManual + k.cancelAuto, k.cancelBeforePreview + k.cancelAfterPreview)
  })

  test('CASE 24: legacy を含めても 手動 + 自動 = 下見前 + 下見後（3分類にしなくても成立）', () => {
    const k = calcKpi(mixed(), NOW)
    assert.equal(k.cancelManual + k.cancelAuto, 6)
    assert.equal(k.cancelBeforePreview + k.cancelAfterPreview, 6)
    assert.equal(k.cancelManual + k.cancelAuto, k.cancelBeforePreview + k.cancelAfterPreview)
    // うち推定 = cancelled_at が無い2件
    assert.equal(k.cancelBeforePreviewEstimated + k.cancelAfterPreviewEstimated, 2)
  })

  test('CASE 26: cancelled_at を持たせても、キャンセル以外の分析値（確定率・下見率・売上など）は変わらない', () => {
    const base = mixed().map((c) => ({ ...c, cancelled_at: null }))
    const withAt = mixed()
    const a = calcKpi(base, NOW)
    const b = calcKpi(withAt, NOW)
    for (const key of ['inquiry', 'preview', 'confirmed', 'previewConfirmed', 'previewRate', 'confirmRate', 'cvRate', 'revenue', 'avgPrice', 'estimateTotal', 'cancelManual', 'cancelAuto'] as const) {
      assert.equal(b[key], a[key], key)
    }
  })

  test('既存の結果項目（cancelBeforePreview / cancelAfterPreview）は同じ名前・数値型のまま（後方互換）', () => {
    const k = calcKpi([], NOW)
    assert.equal(typeof k.cancelBeforePreview, 'number')
    assert.equal(typeof k.cancelAfterPreview, 'number')
    assert.equal(k.cancelBeforePreviewEstimated, 0)
    assert.equal(k.cancelAfterPreviewEstimated, 0)
  })
})
