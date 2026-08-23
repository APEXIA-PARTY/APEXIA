/**
 * 確定案件の自動「開催終了」化の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/utils/autoComplete.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。DBへは一切接続しない。
 *
 * 既存の app/api/auto-cancel/route.ts・lib/utils/analytics.ts とは無関係。
 * このテストは lib/utils/autoComplete.ts のみを対象とする。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getJstTodayDateString, isAutoCompleteTarget } from './autoComplete.ts'

describe('getJstTodayDateString', () => {
  test('UTCでは前日23時台でも、JSTでは翌日になっている境界時刻を正しく返す', () => {
    // UTC 2026-08-23T15:05:00Z = JST 2026-08-24 00:05
    const now = new Date('2026-08-23T15:05:00.000Z')
    assert.equal(getJstTodayDateString(now), '2026-08-24')
  })

  test('UTCとJSTで日付が同じ時刻（JST日中）は、そのままの日付を返す', () => {
    // UTC 2026-08-23T05:00:00Z = JST 2026-08-23 14:00
    const now = new Date('2026-08-23T05:00:00.000Z')
    assert.equal(getJstTodayDateString(now), '2026-08-23')
  })

  test('JST 0:00ちょうど（UTC前日15:00）でも正しく当日の日付を返す', () => {
    const now = new Date('2026-08-23T15:00:00.000Z')
    assert.equal(getJstTodayDateString(now), '2026-08-24')
  })

  test('JST 23:59（UTC同日14:59）でも日付がずれない', () => {
    // UTC 2026-08-23T14:59:00Z = JST 2026-08-23 23:59
    const now = new Date('2026-08-23T14:59:00.000Z')
    assert.equal(getJstTodayDateString(now), '2026-08-23')
  })
})

describe('isAutoCompleteTarget', () => {
  const jstToday = '2026-08-24'

  test('1. confirmed + 昨日（event_date < 今日） → 対象', () => {
    assert.equal(isAutoCompleteTarget({ status: 'confirmed', event_date: '2026-08-23' }, jstToday), true)
  })

  test('2. confirmed + 今日（event_date = 今日） → 対象外（当日は変更しない）', () => {
    assert.equal(isAutoCompleteTarget({ status: 'confirmed', event_date: '2026-08-24' }, jstToday), false)
  })

  test('3. confirmed + 明日（event_date > 今日） → 対象外', () => {
    assert.equal(isAutoCompleteTarget({ status: 'confirmed', event_date: '2026-08-25' }, jstToday), false)
  })

  test('4. cancelled + 昨日 → 対象外', () => {
    assert.equal(isAutoCompleteTarget({ status: 'cancelled', event_date: '2026-08-23' }, jstToday), false)
  })

  test('5. done + 昨日 → 対象外（既に開催終了）', () => {
    assert.equal(isAutoCompleteTarget({ status: 'done', event_date: '2026-08-23' }, jstToday), false)
  })

  test('6. tentative + 昨日 → 対象外', () => {
    assert.equal(isAutoCompleteTarget({ status: 'tentative', event_date: '2026-08-23' }, jstToday), false)
  })

  test('6b. inquiry / preview_adj / previewed も対象外（confirmed以外は一切変更しない）', () => {
    assert.equal(isAutoCompleteTarget({ status: 'inquiry', event_date: '2026-08-23' }, jstToday), false)
    assert.equal(isAutoCompleteTarget({ status: 'preview_adj', event_date: '2026-08-23' }, jstToday), false)
    assert.equal(isAutoCompleteTarget({ status: 'previewed', event_date: '2026-08-23' }, jstToday), false)
  })

  test('7. event_date が NULL → 対象外', () => {
    assert.equal(isAutoCompleteTarget({ status: 'confirmed', event_date: null }, jstToday), false)
  })

  test('9. 対象0件でもエラーではない（判定関数はfalseを返すだけで例外を投げない）', () => {
    const cases = [
      { status: 'cancelled' as const, event_date: '2026-08-23' },
      { status: 'done' as const, event_date: '2026-08-23' },
    ]
    const targets = cases.filter((c) => isAutoCompleteTarget(c, jstToday))
    assert.equal(targets.length, 0)
  })

  test('10. 二重実行を想定: 1回目でdoneになった案件は、2回目の判定で対象から外れる', () => {
    const caseRow = { status: 'confirmed' as const, event_date: '2026-08-23' }
    assert.equal(isAutoCompleteTarget(caseRow, jstToday), true)

    // 1回目の実行で done に変わった後の状態を模した2回目の判定
    const afterFirstRun = { ...caseRow, status: 'done' as const }
    assert.equal(isAutoCompleteTarget(afterFirstRun, jstToday), false)
  })
})
