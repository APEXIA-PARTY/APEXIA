/**
 * 自動キャンセル・自動完了の実行部分の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cron/cronRunners.test.ts
 * 本物の DB・ネットワーク接続は一切使用しない。インメモリの偽 DB と架空の案件のみ。
 *
 * 偽 DB は、実際のコードが使うクエリ（select / eq / in / not / lt / gte / limit / update / insert）を
 * 再現し、書込みの記録・SELECT と UPDATE の間の競合（beforeWrite）・エラー注入ができる。
 *
 * DB トリガー（supabase/migrations/20261005_cases_status_change_trigger.sql）は hooks.trigger=true（既定）で模擬する:
 *   cases の UPDATE で status が変わった行に対し、cancelled への遷移なら cancelled_at を打刻し、
 *   case_history へ 1 行（自動キャンセルは auto_cancel、それ以外は status_change）を追加する。
 *   模擬が SQL と一致していることは、実 DB エンジン（PGlite・メモリ上）での検証と migration の静的テストで別途確認している。
 *   ランナー自身が case_history に書いた場合は db.log に残る（トリガー模擬の書込みは db.log に残らない）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { runAutoCancel } from './autoCancelRunner.ts'
import { runAutoComplete } from './autoCompleteRunner.ts'
import { AUTO_CANCEL_MAX_WRITE_COUNT, AUTO_CANCEL_REASON_NAME, addDaysToDate } from './autoCancelRules.ts'
import { AUTO_COMPLETE_MAX_WRITE_COUNT } from './types.ts'

type Row = Record<string, unknown>

function makeDb(seed: { cases?: Row[]; cancel_reason_master?: Row[]; case_history?: Row[] }) {
  const tables: Record<string, Row[]> = {
    cases: seed.cases ?? [],
    cancel_reason_master: seed.cancel_reason_master ?? [],
    case_history: seed.case_history ?? [],
  }
  const log: { table: string; op: 'select' | 'update' | 'insert'; cols?: string; payload?: unknown }[] = []
  const hooks: { beforeWrite: (() => void) | null; failOn: { table: string; op: string } | null; trigger: boolean } = { beforeWrite: null, failOn: null, trigger: true }
  const TRIGGER_NOW = '2026-10-05T03:00:00.000Z'

  class Query implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
    private op: 'select' | 'update' | 'insert' = 'select'
    private filters: ((r: Row) => boolean)[] = []
    private payload: unknown
    private cols = ''
    private returning = false
    private limitN = Infinity
    private table: string
    constructor(table: string) { this.table = table }
    select(cols: string) { if (this.op === 'select') this.cols = cols; else { this.returning = true; this.cols = cols } return this }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this }
    not(c: string, _op: string, _v: unknown) { this.filters.push((r) => r[c] !== null && r[c] !== undefined); return this }
    lt(c: string, v: string) { this.filters.push((r) => typeof r[c] === 'string' && (r[c] as string) < v); return this }
    gte(c: string, v: string) { this.filters.push((r) => typeof r[c] === 'string' && (r[c] as string) >= v); return this }
    limit(n: number) { this.limitN = n; return this }
    update(values: Row) { this.op = 'update'; this.payload = values; return this }
    insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this }
    private project(r: Row): Row {
      const keys = this.cols.split(',').map((k) => k.trim()).filter(Boolean)
      return Object.fromEntries(keys.map((k) => [k, r[k]]))
    }
    private run() {
      log.push({ table: this.table, op: this.op, cols: this.cols, payload: this.payload })
      if (hooks.failOn && hooks.failOn.table === this.table && hooks.failOn.op === this.op) {
        return { data: null, error: { message: 'injected failure' } }
      }
      const rows = tables[this.table]
      if (this.op === 'insert') {
        rows.push(...((Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]))
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        hooks.beforeWrite?.() // SELECT と UPDATE の間に、別の操作で状態が変わった場合を再現する
        const matched = rows.filter((r) => this.filters.every((f) => f(r)))
        for (const r of matched) {
          const oldStatus = r.status
          const oldAuto = r.auto_cancel
          Object.assign(r, this.payload as Row)
          if (hooks.trigger && this.table === 'cases' && oldStatus !== r.status) {
            // BEFORE トリガー: OLD.status <> cancelled かつ NEW.status = cancelled のときだけ打刻
            if (r.status === 'cancelled' && oldStatus !== 'cancelled') r.cancelled_at = TRIGGER_NOW
            // AFTER トリガー: status が変わった行ごとに履歴を1行
            const isAuto = r.status === 'cancelled' && r.auto_cancel === true && oldAuto !== true
            tables.case_history.push({
              case_id: r.id, action_type: isAuto ? 'auto_cancel' : 'status_change',
              old_value: { status: oldStatus },
              new_value: isAuto ? { status: r.status, auto_cancel: r.auto_cancel, source: 'auto_cancel' } : { status: r.status, auto_cancel: r.auto_cancel },
              changed_by: null,
            })
          }
        }
        return { data: this.returning ? matched.map((r) => this.project(r)) : null, error: null }
      }
      const matched = rows.filter((r) => this.filters.every((f) => f(r))).slice(0, this.limitN)
      return { data: matched.map((r) => this.project(r)), error: null }
    }
    then<T1, T2>(onF?: ((v: { data: Row[] | null; error: { message: string } | null }) => T1 | PromiseLike<T1>) | null, onR?: ((e: unknown) => T2 | PromiseLike<T2>) | null) {
      return Promise.resolve(this.run()).then(onF, onR)
    }
  }
  return {
    client: { from: (t: string) => new Query(t) },
    tables,
    log,
    hooks,
    writes: () => log.filter((l) => l.op !== 'select'),
  }
}

// 固定の現在日時: 2026-10-05 12:00 JST。窓: 2026-09-05 〜（inquiry/preview_adj < 09-28, previewed < 09-21）
const NOW = new Date('2026-10-05T03:00:00Z')
const TODAY = '2026-10-05'
const ago = (d: number) => addDaysToDate(TODAY, -d)

let seq = 0
const mk = (status: string, daysAgo: number | null, over: Row = {}): Row => ({
  id: `case-${++seq}`, status, event_date: daysAgo === null ? null : ago(daysAgo),
  preview_datetime: null, estimate_amount: 0, auto_cancel: false, cancel_reason_id: null, cancel_note: null, cancelled_at: null,
  // 個人情報（取得・返却してはいけない）
  company: 'PII会社名', contact: 'PII担当者', phone: '090-0000-0000', email: 'pii@example.com', notes: 'PII備考',
  ...over,
})
const REASON_OK: Row = { id: 'reason-auto', name: AUTO_CANCEL_REASON_NAME, is_auto_cancel: true, is_active: true }
const many = (n: number, f: () => Row) => Array.from({ length: n }, f)
const cancelArgs = (db: ReturnType<typeof makeDb>, o: { decision?: 'dry' | 'live'; mode?: 'off' | 'dry' | 'live' } = {}) => ({
  client: db.client, decision: o.decision ?? 'dry', mode: o.mode ?? 'live', now: NOW,
})

describe('自動キャンセル: dry-run（CASE 10, 27, 28, 33, 36）', () => {
  const seedCases = () => [
    mk('inquiry', 8), mk('inquiry', 20), mk('inquiry', 7), mk('inquiry', 31),
    mk('preview_adj', 9), mk('previewed', 15), mk('previewed', 14),
    mk('tentative', 10), mk('tentative', 60), mk('confirmed', 10), mk('done', 10), mk('cancelled', 10), mk('inquiry', null),
  ]

  test('CASE 10, 28: dry は SELECT のみ。案件を1件も更新しない', async () => {
    const db = makeDb({ cases: seedCases(), cancel_reason_master: [REASON_OK] })
    const before = JSON.stringify(db.tables.cases)
    const r = await runAutoCancel(cancelArgs(db, { decision: 'dry', mode: 'dry' }))
    assert.equal(r.status, 200)
    assert.equal(r.body.dryRun, true)
    assert.deepEqual(db.writes(), [], 'UPDATE / INSERT がない')
    assert.equal(JSON.stringify(db.tables.cases), before)
  })

  test('CASE 27: dry では case_history を書かない', async () => {
    const db = makeDb({ cases: seedCases(), cancel_reason_master: [REASON_OK] })
    await runAutoCancel(cancelArgs(db, { decision: 'dry', mode: 'dry' }))
    assert.equal(db.tables.case_history.length, 0)
    assert.ok(!db.log.some((l) => l.table === 'case_history'), 'case_history に触れない')
  })

  test('集計: 対象は ルールに合う4件（inquiry 8日/20日, preview_adj 9日, previewed 15日）。tentative は要確認として別集計', async () => {
    const db = makeDb({ cases: seedCases(), cancel_reason_master: [REASON_OK] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'dry', mode: 'dry' }))
    const b = r.body as Record<string, any>
    assert.equal(b.mode, 'dry')
    assert.equal(b.todayJst, TODAY)
    assert.equal(b.totalCandidates, 4)
    assert.deepEqual(b.byStatus, { inquiry: 2, preview_adj: 1, previewed: 1 })
    assert.equal(b.writeLimit, AUTO_CANCEL_MAX_WRITE_COUNT)
    assert.equal(b.exceedsWriteLimit, false)
    assert.deepEqual(b.tentativeManualReview, { total: 2, withinLookbackWindow: 1 })
    assert.equal(b.outsideLookbackWindow, 1, '31日前の inquiry は窓の外（自動処理しない）')
    assert.equal(b.oldestEventDate, ago(20))
    assert.equal(b.newestEventDate, ago(8))
  })

  test('CASE 33: dry では、自動理由マスタが未整備でも案件は更新せず、live が不可能な理由を知らせる', async () => {
    const db = makeDb({ cases: seedCases(), cancel_reason_master: [{ id: 'r', name: '連絡不通', is_auto_cancel: true, is_active: true }] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'dry', mode: 'live' }))
    assert.equal(r.status, 200)
    assert.deepEqual(db.writes(), [])
    assert.ok((r.body.liveBlockers as string[]).includes('auto_cancel_reason_unavailable'))
  })

  test('CASE 36: レスポンスに個人情報を含まず、個人情報の列を取得しない', async () => {
    const db = makeDb({ cases: seedCases(), cancel_reason_master: [REASON_OK] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'dry', mode: 'dry' }))
    const text = JSON.stringify(r.body)
    for (const pii of ['PII会社名', 'PII担当者', '090-0000-0000', 'pii@example.com', 'PII備考']) assert.ok(!text.includes(pii), pii)
    assert.ok(!/case-\d+/.test(text), '案件IDも返さない')
    const selected = db.log.filter((l) => l.op === 'select').map((l) => l.cols).join(',')
    assert.doesNotMatch(selected, /company|contact|phone|email|notes|cancel_note/)
  })
})

describe('自動キャンセル: 件数上限（CASE 25, 26）', () => {
  test(`CASE 25: 候補ちょうど ${AUTO_CANCEL_MAX_WRITE_COUNT} 件 → 上限内で処理できる`, async () => {
    const db = makeDb({ cases: many(AUTO_CANCEL_MAX_WRITE_COUNT, () => mk('inquiry', 10)), cancel_reason_master: [REASON_OK] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 200)
    assert.equal(r.body.exceedsWriteLimit, false)
    assert.equal(r.body.processed, AUTO_CANCEL_MAX_WRITE_COUNT)
    assert.ok(db.tables.cases.every((c) => c.status === 'cancelled' && c.auto_cancel === true))
  })

  test(`CASE 26: 候補 ${AUTO_CANCEL_MAX_WRITE_COUNT + 1} 件 → 1件も書込まず全件中止`, async () => {
    const db = makeDb({ cases: many(AUTO_CANCEL_MAX_WRITE_COUNT + 1, () => mk('inquiry', 10)), cancel_reason_master: [REASON_OK] })
    const before = JSON.stringify(db.tables.cases)
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 409)
    assert.equal(r.body.aborted, true)
    assert.equal(r.body.abortReason, 'write_limit_exceeded')
    assert.equal(r.body.exceedsWriteLimit, true)
    assert.equal(r.body.processed, 0)
    assert.deepEqual(db.writes(), [], '31件目以降だけ止めるのではなく、全件中止')
    assert.equal(JSON.stringify(db.tables.cases), before)
    assert.equal(db.tables.case_history.length, 0)
  })

  test('dry-run でも上限超過（exceedsWriteLimit）を返す', async () => {
    const db = makeDb({ cases: many(40, () => mk('inquiry', 12)), cancel_reason_master: [REASON_OK] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'dry', mode: 'dry' }))
    assert.equal(r.body.totalCandidates, 40)
    assert.equal(r.body.exceedsWriteLimit, true)
    assert.deepEqual(db.writes(), [])
  })
})

describe('自動キャンセル: live の書込み（CASE 11, 29, 30, 31, 32）', () => {
  test('CASE 11: live で条件を満たす場合のみ書込む。更新内容・履歴・対象外が正しい', async () => {
    const db = makeDb({
      cases: [mk('inquiry', 10, { id: 'a' }), mk('previewed', 20, { id: 'b' }), mk('previewed', 10, { id: 'c' }), mk('tentative', 10, { id: 'd' }), mk('inquiry', 40, { id: 'e' })],
      cancel_reason_master: [REASON_OK],
    })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.body.processed, 2)
    const byId = Object.fromEntries(db.tables.cases.map((c) => [c.id as string, c]))
    assert.equal(byId.a.status, 'cancelled'); assert.equal(byId.a.auto_cancel, true); assert.equal(byId.a.cancel_reason_id, 'reason-auto')
    assert.equal(byId.b.status, 'cancelled')
    assert.equal(byId.c.status, 'previewed', 'previewed 10日前は猶予内')
    assert.equal(byId.d.status, 'tentative', 'tentative は対象外')
    assert.equal(byId.e.status, 'inquiry', '40日前は遡り上限の外')
    // 履歴は DB トリガー（模擬）が記録する。ランナーは case_history に書かない（二重履歴の防止）
    assert.deepEqual(db.tables.case_history.map((h) => [h.case_id, h.action_type, h.old_value, h.changed_by]).sort(), [
      ['a', 'auto_cancel', { status: 'inquiry' }, null],
      ['b', 'auto_cancel', { status: 'previewed' }, null],
    ])
    assert.ok(!db.log.some((l) => l.table === 'case_history'), 'ランナーは case_history に触れない')
    assert.deepEqual(db.tables.cases.filter((c) => c.cancelled_at).map((c) => c.id).sort(), ['a', 'b'], '打刻は更新された2件だけ')
  })

  test('多重防御: decision=live でも mode が live でなければ書込まない', async () => {
    const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [REASON_OK] })
    for (const mode of ['dry', 'off'] as const) {
      const r = await runAutoCancel({ ...cancelArgs(db, { decision: 'live', mode }) })
      assert.equal(r.body.dryRun, true)
    }
    assert.deepEqual(db.writes(), [])
  })

  test('CASE 29: SELECT の後でスタッフが status を変えた案件は、UPDATE されない（履歴も書かない）', async () => {
    const db = makeDb({
      cases: [mk('inquiry', 10, { id: 'a' }), mk('inquiry', 11, { id: 'b' }), mk('previewed', 20, { id: 'c' })],
      cancel_reason_master: [REASON_OK],
    })
    db.hooks.beforeWrite = () => {
      db.hooks.beforeWrite = null
      const raced = db.tables.cases.find((c) => c.id === 'b')!
      raced.status = 'confirmed' // 取得後・更新前に確定へ
    }
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    const status = Object.fromEntries(db.tables.cases.map((c) => [c.id as string, c.status]))
    assert.equal(status.b, 'confirmed', '確定に変えられた案件は上書きしない')
    assert.equal(status.a, 'cancelled')
    assert.equal(status.c, 'cancelled')
    assert.equal(r.body.processed, 2)
    assert.deepEqual(db.tables.case_history.map((h) => h.case_id).sort(), ['a', 'c'], '更新された案件だけ履歴を書く')
    assert.equal(db.tables.cases.find((c) => c.id === 'b')!.auto_cancel, false)
  })

  test('CASE 30: 二重実行 → 2回目は0件。重複した更新・履歴がない', async () => {
    const db = makeDb({ cases: many(5, () => mk('inquiry', 12)), cancel_reason_master: [REASON_OK] })
    const first = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    const snapshot = JSON.stringify(db.tables.cases)
    const historyCount = db.tables.case_history.length
    const second = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(first.body.processed, 5)
    assert.equal(second.body.processed, 0)
    assert.equal(JSON.stringify(db.tables.cases), snapshot)
    assert.equal(db.tables.case_history.length, historyCount)
    assert.equal(historyCount, 5)
  })

  test('CASE 31: 自動理由が0件 → live は1件も書込まず中止（理由なしでキャンセルしない）', async () => {
    const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 409)
    assert.equal(r.body.abortReason, 'auto_cancel_reason_unavailable')
    assert.deepEqual(db.writes(), [])
  })

  test('CASE 32: 自動理由が複数件 → live は中止', async () => {
    const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [REASON_OK, { ...REASON_OK, id: 'reason-auto-2' }] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 409)
    assert.equal(r.body.abortReason, 'auto_cancel_reason_unavailable')
    assert.deepEqual(db.writes(), [])
  })

  test('既存の自動専用理由「連絡不通」を代用しない（47件が人の操作・取込みで使用中のため）', async () => {
    const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [{ id: 'old', name: '連絡不通', is_auto_cancel: true, is_active: true }] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 409)
    assert.deepEqual(db.writes(), [])
    assert.notEqual(db.tables.cases[0].cancel_reason_id, 'old')
  })

  test('無効な専用理由・自動フラグのない同名理由は使わない', async () => {
    for (const reason of [{ ...REASON_OK, is_active: false }, { ...REASON_OK, is_auto_cancel: false }]) {
      const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [reason] })
      const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
      assert.equal(r.status, 409)
      assert.deepEqual(db.writes(), [])
    }
  })

  test('更新が失敗したら 500。履歴は書かず、詳細（個人情報）を返さない', async () => {
    const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [REASON_OK] })
    db.hooks.failOn = { table: 'cases', op: 'update' }
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 500)
    assert.equal(db.tables.case_history.length, 0)
    assert.ok(!JSON.stringify(r.body).includes('PII'))
  })

  test('CASE 14, 16: 自動キャンセルの履歴は action_type=auto_cancel。件数が一致し、ランナーは case_history に1回も書かない', async () => {
    const db = makeDb({ cases: many(7, () => mk('inquiry', 12)), cancel_reason_master: [REASON_OK] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.body.processed, 7)
    assert.equal(db.tables.case_history.length, 7, '更新件数 = 履歴件数（二重にならない）')
    assert.ok(db.tables.case_history.every((h) => h.action_type === 'auto_cancel'))
    assert.equal(db.tables.cases.filter((c) => c.cancelled_at).length, 7, '更新件数 = 打刻件数')
    assert.equal(r.body.stampedCancelledAt, 7)
    assert.equal(r.body.triggerWarning, undefined)
    assert.ok(!db.log.some((l) => l.table === 'case_history'), 'ランナーの case_history への操作は 0 回')
    assert.equal('historyRecorded' in r.body, false)
  })

  test('DB トリガーが無い（cancelled_at が打刻されない）環境では triggerWarning を返す。status 更新は巻き戻さない', async () => {
    const db = makeDb({ cases: [mk('inquiry', 10)], cancel_reason_master: [REASON_OK] })
    db.hooks.trigger = false
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 200)
    assert.equal(r.body.triggerWarning, true)
    assert.equal(r.body.stampedCancelledAt, 0)
    assert.equal(db.tables.case_history.length, 0, 'トリガーが無ければ履歴も無い（ランナーが代わりに書くことはしない）')
  })

  test('候補が0件なら、何も書かない', async () => {
    const db = makeDb({ cases: [mk('inquiry', 2), mk('tentative', 20)], cancel_reason_master: [REASON_OK] })
    const r = await runAutoCancel(cancelArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.body.processed, 0)
    assert.deepEqual(db.writes(), [])
  })
})

describe('自動完了（CASE 34, 35）', () => {
  const completeArgs = (db: ReturnType<typeof makeDb>, o: { decision?: 'dry' | 'live'; mode?: 'off' | 'dry' | 'live' } = {}) => ({
    client: db.client, decision: o.decision ?? 'dry', mode: o.mode ?? 'live', now: NOW,
  })

  test('CASE 34: dry-run → 更新も履歴もなし。集計だけ返す（個人情報なし）', async () => {
    const db = makeDb({ cases: [mk('confirmed', 1, { id: 'a' }), mk('confirmed', 40, { id: 'b' }), mk('confirmed', 0), mk('confirmed', null), mk('done', 5), mk('inquiry', 5)] })
    const before = JSON.stringify(db.tables.cases)
    const r = await runAutoComplete(completeArgs(db, { decision: 'dry', mode: 'dry' }))
    const b = r.body as Record<string, any>
    assert.equal(r.status, 200)
    assert.equal(b.dryRun, true)
    assert.equal(b.totalCandidates, 2, '開催日当日・日付なしは対象外（翌日0時以降に対象）')
    assert.equal(b.oldestEventDate, ago(40))
    assert.equal(b.newestEventDate, ago(1))
    assert.equal(b.writeLimit, AUTO_COMPLETE_MAX_WRITE_COUNT)
    assert.deepEqual(db.writes(), [])
    assert.equal(JSON.stringify(db.tables.cases), before)
    const text = JSON.stringify(b)
    for (const pii of ['PII会社名', 'pii@example.com']) assert.ok(!text.includes(pii))
    assert.doesNotMatch(db.log.map((l) => l.cols).join(','), /company|contact|phone|email|notes/)
  })

  test('live: confirmed → done。confirmed_at と cancelled_at には触れず、履歴(status_change)はトリガーが記録する (CASE 15)', async () => {
    const db = makeDb({ cases: [mk('confirmed', 3, { id: 'a', confirmed_at: '2026-08-01T00:00:00Z' }), mk('confirmed', 0, { id: 'b' })] })
    const r = await runAutoComplete(completeArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(r.body.processed, 1)
    assert.equal(db.tables.cases[0].status, 'done')
    assert.equal(db.tables.cases[0].confirmed_at, '2026-08-01T00:00:00Z')
    assert.equal(db.tables.cases[1].status, 'confirmed')
    const updates = db.log.filter((l) => l.op === 'update')
    assert.deepEqual(updates.map((u) => u.payload), [{ status: 'done' }], '更新するのは status のみ')
    assert.equal(db.tables.cases[0].cancelled_at, null, '自動完了は cancelled_at に触れない')
    assert.ok(!db.log.some((l) => l.table === 'case_history'), 'ランナーは case_history に触れない')
    assert.deepEqual(db.tables.case_history.map((h) => [h.case_id, h.action_type, h.old_value, h.new_value]), [['a', 'status_change', { status: 'confirmed' }, { status: 'done', auto_cancel: false }]])
  })

  test('CASE 35: SELECT の後で別 status（キャンセル等）に変えられた案件は、done に上書きされない', async () => {
    const db = makeDb({ cases: [mk('confirmed', 3, { id: 'a' }), mk('confirmed', 4, { id: 'b' }), mk('confirmed', 5, { id: 'c' })] })
    db.hooks.beforeWrite = () => {
      db.hooks.beforeWrite = null
      db.tables.cases.find((c) => c.id === 'b')!.status = 'cancelled'
    }
    const r = await runAutoComplete(completeArgs(db, { decision: 'live', mode: 'live' }))
    const status = Object.fromEntries(db.tables.cases.map((c) => [c.id as string, c.status]))
    assert.deepEqual(status, { a: 'done', b: 'cancelled', c: 'done' })
    assert.equal(r.body.processed, 2)
    assert.deepEqual(db.tables.case_history.map((h) => h.case_id).sort(), ['a', 'c'])
  })

  test('二重実行 → 2回目は0件。重複しない', async () => {
    const db = makeDb({ cases: many(4, () => mk('confirmed', 3)) })
    const first = await runAutoComplete(completeArgs(db, { decision: 'live', mode: 'live' }))
    const second = await runAutoComplete(completeArgs(db, { decision: 'live', mode: 'live' }))
    assert.equal(first.body.processed, 4)
    assert.equal(second.body.processed, 0)
    assert.equal(db.tables.case_history.length, 4)
  })

  test(`書込み上限: ${AUTO_COMPLETE_MAX_WRITE_COUNT} 件は処理、${AUTO_COMPLETE_MAX_WRITE_COUNT + 1} 件は1件も書込まず中止`, async () => {
    const ok = makeDb({ cases: many(AUTO_COMPLETE_MAX_WRITE_COUNT, () => mk('confirmed', 3)) })
    assert.equal((await runAutoComplete(completeArgs(ok, { decision: 'live', mode: 'live' }))).body.processed, AUTO_COMPLETE_MAX_WRITE_COUNT)
    const over = makeDb({ cases: many(AUTO_COMPLETE_MAX_WRITE_COUNT + 1, () => mk('confirmed', 3)) })
    const r = await runAutoComplete(completeArgs(over, { decision: 'live', mode: 'live' }))
    assert.equal(r.status, 409)
    assert.equal(r.body.aborted, true)
    assert.deepEqual(over.writes(), [])
  })

  test('多重防御: mode が live でなければ、decision=live でも書込まない', async () => {
    const db = makeDb({ cases: [mk('confirmed', 3)] })
    for (const mode of ['dry', 'off'] as const) await runAutoComplete(completeArgs(db, { decision: 'live', mode }))
    assert.deepEqual(db.writes(), [])
    assert.equal(db.tables.cases[0].status, 'confirmed')
  })

  test('本番の想定: 過去の滞留 25 件（上限 30 以下）も、dry では一切更新しない', async () => {
    const db = makeDb({ cases: many(25, () => mk('confirmed', 100)) })
    const r = await runAutoComplete(completeArgs(db, { decision: 'dry', mode: 'dry' }))
    assert.equal(r.body.totalCandidates, 25)
    assert.deepEqual(db.writes(), [])
    assert.ok(db.tables.cases.every((c) => c.status === 'confirmed'))
  })
})
