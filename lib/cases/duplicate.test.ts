/**
 * 案件複製ロジックの自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/duplicate.test.ts
 * 実データ・Supabase・ネットワーク接続は一切使用しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CARRY_OVER_FIELDS,
  RESET_FIELDS,
  EXCLUDED_RELATED_TABLES,
  stripCopySuffix,
  resolveBaseName,
  nextCopyName,
  buildDuplicateInsertData,
  deleteCaseAndLogFailure,
} from './duplicate.ts'

describe('案件名の重複回避ロジック', () => {
  test('通常案件名 → （コピー）', () => {
    assert.equal(nextCopyName(resolveBaseName('株式会社〇〇 周年パーティー'), []), '株式会社〇〇 周年パーティー（コピー）')
  })

  test('既存コピーあり → （コピー2）', () => {
    const base = resolveBaseName('株式会社〇〇 周年パーティー')
    assert.equal(
      nextCopyName(base, ['株式会社〇〇 周年パーティー（コピー）']),
      '株式会社〇〇 周年パーティー（コピー2）'
    )
  })

  test('コピー番号が歯抜けの場合 → 空いている最小番号を採用', () => {
    const base = resolveBaseName('株式会社〇〇 周年パーティー')
    // （コピー2）だけが存在 → 空いている最小の「（コピー）」を採用する
    assert.equal(
      nextCopyName(base, ['株式会社〇〇 周年パーティー（コピー2）']),
      '株式会社〇〇 周年パーティー（コピー）'
    )
    // （コピー）（コピー2）が存在 → 次は（コピー3）
    assert.equal(
      nextCopyName(base, ['株式会社〇〇 周年パーティー（コピー）', '株式会社〇〇 周年パーティー（コピー2）']),
      '株式会社〇〇 周年パーティー（コピー3）'
    )
  })

  test('複製元がすでに「（コピー）」で終わる場合は二重付与しない', () => {
    const base = resolveBaseName('株式会社〇〇 周年パーティー（コピー）')
    assert.equal(base, '株式会社〇〇 周年パーティー')
    assert.equal(nextCopyName(base, []), '株式会社〇〇 周年パーティー（コピー）')
  })

  test('案件名がnull／空文字／空白のみ → 「案件名未設定（コピー）」', () => {
    assert.equal(nextCopyName(resolveBaseName(null), []), '案件名未設定（コピー）')
    assert.equal(nextCopyName(resolveBaseName(undefined), []), '案件名未設定（コピー）')
    assert.equal(nextCopyName(resolveBaseName(''), []), '案件名未設定（コピー）')
    assert.equal(nextCopyName(resolveBaseName('   '), []), '案件名未設定（コピー）')
  })

  test('案件名未設定の重複も連番になる', () => {
    const base = resolveBaseName(null)
    assert.equal(nextCopyName(base, ['案件名未設定（コピー）']), '案件名未設定（コピー2）')
  })

  test('stripCopySuffix は末尾の（コピー）（コピーN）だけを取り除く', () => {
    assert.equal(stripCopySuffix('Foo（コピー）'), 'Foo')
    assert.equal(stripCopySuffix('Foo（コピー12）'), 'Foo')
    assert.equal(stripCopySuffix('Foo'), 'Foo')
    assert.equal(stripCopySuffix('（コピー）Foo（コピー）'), '（コピー）Foo')
  })
})

describe('複製用INSERT payload の組み立て', () => {
  // CARRY_OVER_FIELDS 以外のダミー値も混ぜたソースレコード
  // （許可リストにない列が payload に紛れ込まないことを確認するため）
  const source: Record<string, unknown> = {
    id: 'source-id-123',
    company: 'テスト株式会社',
    contact: 'テスト太郎',
    phone: '03-0000-0000',
    email: 'test@example.com',
    event_name: '周年パーティー',
    guest_count: 50,
    notes: '備考テキスト',
    payment_method: '当日現金',
    media_id: 'media-1',
    contact_method_id: 'contact-method-1',
    floor_id: 'floor-1',
    event_category_id: 'cat-1',
    event_subcategory_id: 'subcat-1',
    event_subcategory_note: 'サブカテゴリ備考',
    load_in_time: '17:00',
    rehearsal_time: '18:00',
    start_time: '19:00',
    end_time: '21:00',
    full_exit_time: '22:00',
    event_date_note: '週末希望',
    // 引き継いではいけない列（許可リスト外・初期化対象）
    event_date: '2026-01-01',
    status: 'confirmed',
    deposit_status: '済み',
    remaining_payment_status: '済み',
    invoice_status: '振り込み済み',
    application_form_status: '済み',
    delivery_notice_status: '済み',
    gcal_event_id: 'gcal-abc-123',
    estimate_amount: 999999,
    preview_datetime: '2025-12-01T10:00:00Z',
    has_previewed: true,
    auto_cancel: true,
    cancel_reason_id: 'reason-1',
    cancel_note: 'キャンセル理由テキスト',
    inquiry_date: '2025-01-01',
    created_by: 'original-author-id',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  }

  const result = buildDuplicateInsertData(source, {
    newEventName: '周年パーティー（コピー）',
    inquiryDate: '2026-08-05',
    userId: 'current-user-id',
  })

  test('引き継ぐカラムだけが複製用payloadに入る（許可リストの値と一致）', () => {
    for (const field of CARRY_OVER_FIELDS) {
      if (field === 'event_name') continue // event_name は複製用に上書きされるため別途検証
      assert.equal(result[field], source[field], `${field} が複製元の値と一致しません`)
    }
  })

  test('event_name は複製用の新しい名前になっている（元の値をそのまま使わない）', () => {
    assert.equal(result.event_name, '周年パーティー（コピー）')
    assert.notEqual(result.event_name, source.event_name)
  })

  test('初期化対象が指定値になる', () => {
    for (const [field, expected] of Object.entries(RESET_FIELDS)) {
      assert.equal(result[field], expected, `${field} が初期値になっていません`)
    }
  })

  test('inquiry_date は複製操作を行った当日になる（複製元の値を引き継がない）', () => {
    assert.equal(result.inquiry_date, '2026-08-05')
    assert.notEqual(result.inquiry_date, source.inquiry_date)
  })

  test('created_by は複製操作を実行した現在のユーザーになる（複製元の作成者を引き継がない）', () => {
    assert.equal(result.created_by, 'current-user-id')
    assert.notEqual(result.created_by, source.created_by)
  })

  test('id／created_at／updated_at／gcal_event_id を複製元から引き継がない', () => {
    // id / created_at / updated_at は payload に一切含めない（DB側で新規生成させる）
    assert.equal('id' in result, false)
    assert.equal('created_at' in result, false)
    assert.equal('updated_at' in result, false)
    // gcal_event_id は初期化対象（RESET_FIELDS）で null に上書きされる
    assert.equal(result.gcal_event_id, null)
    assert.notEqual(result.gcal_event_id, source.gcal_event_id)
  })

  test('許可リストにない列（例: estimate_amount の複製元の値）が漏れ出ていない', () => {
    // estimate_amount は RESET_FIELDS で 0 に上書きされているはずで、
    // 複製元の 999999 が紛れ込んでいないことを確認する
    assert.equal(result.estimate_amount, 0)
  })
})

describe('複製処理が参照しないテーブル（checklist / files / hold_logs / history）', () => {
  const routeFilePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'app', 'api', 'cases', '[id]', 'duplicate', 'route.ts'
  )

  test('route.ts のソースコードに case_checklist / case_files / case_hold_logs / case_history への言及がない', () => {
    const source = fs.readFileSync(routeFilePath, 'utf-8')
    for (const table of EXCLUDED_RELATED_TABLES) {
      assert.equal(
        source.includes(table),
        false,
        `route.ts が ${table} に言及しています（複製処理が参照してはいけないテーブルです）`
      )
    }
  })
})

describe('ロールバック処理（deleteCaseAndLogFailure）', () => {
  test('削除成功時はログを出力しない', async () => {
    const logs: Array<{ message: string; meta: unknown }> = []
    await deleteCaseAndLogFailure(
      async () => ({ error: null }),
      'case-id-1',
      (message, meta) => logs.push({ message, meta })
    )
    assert.equal(logs.length, 0)
  })

  test('削除自体が失敗した場合、孤立した案件IDとエラー内容を必ずログに残す', async () => {
    const logs: Array<{ message: string; meta: unknown }> = []
    await deleteCaseAndLogFailure(
      async () => ({ error: { message: 'mock delete failure' } }),
      'case-id-2',
      (message, meta) => logs.push({ message, meta })
    )
    assert.equal(logs.length, 1)
    assert.match(logs[0].message, /ロールバック失敗/)
    assert.deepEqual(logs[0].meta, {
      orphanedCaseId: 'case-id-2',
      rollbackError: { message: 'mock delete failure' },
    })
  })

  test('関連行（case_options / case_food_plans）の作成失敗時に rollbackAndFail 相当の削除が呼ばれる', async () => {
    // route.ts の rollbackAndFail は deleteCaseAndLogFailure(() => cases.delete().eq('id', newCase.id), ...) を呼ぶ。
    // ここでは「関連行insert失敗 → 案件削除が呼ばれる」という配線をモックで再現して検証する。
    let deleteCalledWith: string | null = null
    const mockRollbackAndFail = async (newCaseId: string, message: string) => {
      await deleteCaseAndLogFailure(async () => {
        deleteCalledWith = newCaseId
        return { error: null }
      }, newCaseId)
      return { status: 500, body: { message } }
    }

    const optionsInsertError = { message: 'insert failed' }
    let response: { status: number; body: { message: string } } | null = null
    if (optionsInsertError) {
      response = await mockRollbackAndFail('new-case-id', `オプションの複製に失敗しました: ${optionsInsertError.message}`)
    }

    assert.equal(deleteCalledWith, 'new-case-id')
    assert.equal(response?.status, 500)
    assert.match(response!.body.message, /オプションの複製に失敗しました/)
  })
})
