/**
 * 案件詳細「← 前の画面に戻る」（lib/utils/detailNavigation.ts）の自動テスト。node:test、追加の依存関係なし。
 * 実行: node --test lib/utils/detailNavigation.test.ts
 * 架空データのみ。ブラウザ・ネットワーク・DBには接続しない。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDetailHref,
  createDetailNavRecord,
  isDetailNavFrom,
  parseDetailNavRecord,
  resolveBackTarget,
  sanitizeReturnUrl,
  serializeDetailNavRecord,
  shouldInterceptClick,
} from './detailNavigation.ts'

const NAV = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CASE_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '99999999-2222-4333-8444-555555555555'
const MEDIA = '22222222-3333-4444-8555-666666666666'

describe('sanitizeReturnUrl: 許可するURL', () => {
  test('案件一覧: 既存の形式（空の値を含むフォーム送信）', () => {
    assert.equal(
      sanitizeReturnUrl('cases', '/cases?search=&year=&month=&status=&media_id=&floor_id='),
      '/cases'
    )
  })

  test('案件一覧: 2ページ目・検索・絞り込み・並び替えを保つ', () => {
    const out = sanitizeReturnUrl(
      'cases',
      `/cases?search=${encodeURIComponent('架空 株式会社')}&status=confirmed&media_id=${MEDIA}&year=2026&month=10&sortBy=estimate_amount&sortOrder=asc&page=2`
    )
    assert.ok(out)
    const url = new URL(out!, 'http://localhost')
    assert.equal(url.pathname, '/cases')
    assert.equal(url.searchParams.get('search'), '架空 株式会社')
    assert.equal(url.searchParams.get('status'), 'confirmed')
    assert.equal(url.searchParams.get('media_id'), MEDIA)
    assert.equal(url.searchParams.get('year'), '2026')
    assert.equal(url.searchParams.get('month'), '10')
    assert.equal(url.searchParams.get('sortBy'), 'estimate_amount')
    assert.equal(url.searchParams.get('sortOrder'), 'asc')
    assert.equal(url.searchParams.get('page'), '2')
  })

  test('案件一覧: クエリ無しの /cases', () => {
    assert.equal(sanitizeReturnUrl('cases', '/cases'), '/cases')
  })

  test('案件一覧: 月は 01 形式（既存フォーム）も 1 形式も受け付ける', () => {
    assert.equal(sanitizeReturnUrl('cases', '/cases?year=2026&month=01'), '/cases?year=2026&month=01')
    assert.equal(sanitizeReturnUrl('cases', '/cases?year=2026&month=1'), '/cases?year=2026&month=1')
  })

  test('分析: 日別問合せの全条件を保つ', () => {
    const raw = `/analytics?view=inquiry&tab=daily&kind=media&target=${MEDIA}&month=2026-10&day=2026-10-08&page=2`
    assert.equal(sanitizeReturnUrl('analytics', raw), raw)
  })

  test('分析: 「（未設定）」の仮想ID', () => {
    const raw = '/analytics?view=inquiry&tab=daily&kind=category&target=__none__&month=2026-10'
    assert.equal(sanitizeReturnUrl('analytics', raw), raw)
  })

  test('未知のキーは捨てて作り直す', () => {
    assert.equal(sanitizeReturnUrl('cases', '/cases?page=2&utm_source=x&foo=bar'), '/cases?page=2')
    assert.equal(
      sanitizeReturnUrl('analytics', '/analytics?view=inquiry&tab=daily&evil=1'),
      '/analytics?view=inquiry&tab=daily'
    )
  })

  test('重複キーは先頭のみ使う', () => {
    assert.equal(sanitizeReturnUrl('cases', '/cases?page=2&page=9'), '/cases?page=2')
  })
})

describe('sanitizeReturnUrl: 拒否するURL', () => {
  const rejectCases: [string, unknown][] = [
    ['外部URL', 'https://example.com/cases'],
    ['プロトコル相対 //', '//example.com/cases'],
    ['プロトコル相対 //（クエリ付き）', '//example.com/cases?page=2'],
    ['バックスラッシュ', '/\\example.com'],
    ['バックスラッシュ（パス内）', '/cases\\..\\x'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,x'],
    ['相対パス（先頭が / でない）', 'cases?page=2'],
    ['空文字', ''],
    ['null', null],
    ['数値', 123],
    ['改行を含む', '/cases?page=2\n'],
    ['タブを含む', '/cases?\tpage=2'],
    ['NUL を含む', '/cases?page=2\u0000'],
    ['ハッシュ付き', '/cases?page=2#x'],
    ['案件新規', '/cases/new'],
    ['案件詳細', `/cases/${CASE_ID}`],
    ['案件編集', `/cases/${CASE_ID}/edit`],
    ['/cases に似た別パス', '/casesxxx'],
    ['末尾スラッシュの下位パス', '/cases/'],
    ['/analytics の下位パス', '/analytics/x'],
    ['別のパス（トップ）', '/'],
    ['別のパス（マスタ）', '/master'],
    ['API パス', '/api/cases'],
    ['エンコードされたスラッシュ', '/cases%2Fnew'],
    ['2,000字超', `/cases?search=${'a'.repeat(2000)}`],
  ]
  for (const [name, raw] of rejectCases) {
    test(`拒否: ${name}`, () => {
      assert.equal(sanitizeReturnUrl('cases', raw), null)
    })
  }

  test('遷移元種別とパスが対応していない場合は拒否', () => {
    assert.equal(sanitizeReturnUrl('cases', '/analytics?view=inquiry&tab=daily'), null)
    assert.equal(sanitizeReturnUrl('analytics', '/cases?page=2'), null)
  })

  test('遷移元種別が不正な場合は拒否', () => {
    assert.equal(sanitizeReturnUrl('other', '/cases'), null)
    assert.equal(sanitizeReturnUrl(undefined, '/cases'), null)
    assert.equal(sanitizeReturnUrl('', '/cases'), null)
  })

  test('既知キーの値が不正なら全体を拒否（案件一覧）', () => {
    assert.equal(sanitizeReturnUrl('cases', '/cases?page=0'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?page=-1'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?page=abc'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?page=10000'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?status=hacked'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?media_id=not-a-uuid'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?floor_id=1'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?year=26'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?month=13'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?sortBy=password'), null)
    assert.equal(sanitizeReturnUrl('cases', '/cases?sortOrder=up'), null)
    // search に独自の文字数上限は設けない（URL全体の2,000字上限と制御文字の拒否だけ）
    assert.ok(sanitizeReturnUrl('cases', `/cases?search=${'a'.repeat(201)}`))
    assert.ok(sanitizeReturnUrl('cases', `/cases?search=${'a'.repeat(1500)}`))
    assert.equal(sanitizeReturnUrl('cases', '/cases?search=%0Aabc'), null)
  })

  test('既知キーの値が不正なら全体を拒否（分析）', () => {
    const base = '/analytics?view=inquiry&tab=daily'
    assert.equal(sanitizeReturnUrl('analytics', '/analytics?view=event&tab=daily'), null)
    assert.equal(sanitizeReturnUrl('analytics', '/analytics?view=inquiry&tab=monthly'), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&kind=floor`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&kind=media&target=abc`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&month=2026-13`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&month=2026-10&day=2026-10-32`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&month=2026-10&day=2026-02-30`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&month=2026-10&day=2026-11-08`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&day=2026-10-08`), null)
    assert.equal(sanitizeReturnUrl('analytics', `${base}&page=0`), null)
  })
})

describe('記録の作成・保存形式の検証', () => {
  const ok = {
    nav: NAV,
    caseId: CASE_ID,
    from: 'cases' as const,
    returnUrl: '/cases?page=2&search=%E6%9E%B6%E7%A9%BA',
  }

  test('createDetailNavRecord: 元画面URLは検証済みの値に作り直される', () => {
    const rec = createDetailNavRecord({ ...ok, returnUrl: '/cases?page=2&utm=x' })
    assert.deepEqual(rec, { nav: NAV, caseId: CASE_ID, from: 'cases', returnUrl: '/cases?page=2' })
  })

  test('createDetailNavRecord: 不正な値は null', () => {
    assert.equal(createDetailNavRecord({ ...ok, nav: 'x' }), null)
    assert.equal(createDetailNavRecord({ ...ok, caseId: 'x' }), null)
    assert.equal(createDetailNavRecord({ ...ok, from: 'other' as never }), null)
    assert.equal(createDetailNavRecord({ ...ok, returnUrl: 'https://example.com' }), null)
  })

  test('serialize → parse で往復できる。保存項目は4つだけ', () => {
    const rec = createDetailNavRecord(ok)!
    const raw = serializeDetailNavRecord(rec)
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['caseId', 'from', 'nav', 'returnUrl'])
    assert.deepEqual(parseDetailNavRecord(raw), rec)
  })

  test('parseDetailNavRecord: 壊れた・余計な項目付き・型違いは null', () => {
    assert.equal(parseDetailNavRecord(null), null)
    assert.equal(parseDetailNavRecord(undefined), null)
    assert.equal(parseDetailNavRecord(''), null)
    assert.equal(parseDetailNavRecord('{'), null)
    assert.equal(parseDetailNavRecord('[]'), null)
    assert.equal(parseDetailNavRecord('"x"'), null)
    assert.equal(parseDetailNavRecord('null'), null)
    const base = { nav: NAV, caseId: CASE_ID, from: 'cases', returnUrl: '/cases' }
    assert.ok(parseDetailNavRecord(JSON.stringify(base)))
    assert.equal(parseDetailNavRecord(JSON.stringify({ ...base, company: '架空株式会社' })), null)
    assert.equal(parseDetailNavRecord(JSON.stringify({ nav: NAV, caseId: CASE_ID, from: 'cases' })), null)
    assert.equal(parseDetailNavRecord(JSON.stringify({ ...base, nav: 1 })), null)
    assert.equal(parseDetailNavRecord(JSON.stringify({ ...base, from: 'other' })), null)
    assert.equal(parseDetailNavRecord(JSON.stringify({ ...base, nav: 'abc' })), null)
    assert.equal(parseDetailNavRecord('x'.repeat(10000)), null)
  })
})

describe('resolveBackTarget: 詳細画面での表示判定', () => {
  const rec = createDetailNavRecord({
    nav: NAV,
    caseId: CASE_ID,
    from: 'cases',
    returnUrl: '/cases?page=2&status=confirmed',
  })!
  const raw = serializeDetailNavRecord(rec)
  const input = { urlFrom: 'cases', urlNav: NAV, pageCaseId: CASE_ID, rawRecord: raw }

  test('すべて一致 → 検証済みの戻り先URLを返す', () => {
    assert.equal(resolveBackTarget(input), '/cases?status=confirmed&page=2')
  })

  test('分析画面から', () => {
    const r = createDetailNavRecord({
      nav: NAV,
      caseId: CASE_ID,
      from: 'analytics',
      returnUrl: `/analytics?view=inquiry&tab=daily&kind=media&target=${MEDIA}&month=2026-10&day=2026-10-08&page=2`,
    })!
    assert.equal(
      resolveBackTarget({ urlFrom: 'analytics', urlNav: NAV, pageCaseId: CASE_ID, rawRecord: serializeDetailNavRecord(r) }),
      `/analytics?view=inquiry&tab=daily&kind=media&target=${MEDIA}&month=2026-10&day=2026-10-08&page=2`
    )
  })

  test('記録なし（直接URL・新しいタブ・保存機能が使えない）→ null', () => {
    assert.equal(resolveBackTarget({ ...input, rawRecord: null }), null)
    assert.equal(resolveBackTarget({ ...input, rawRecord: undefined }), null)
  })

  test('URLの from / nav が無い・不正 → null', () => {
    assert.equal(resolveBackTarget({ ...input, urlFrom: undefined }), null)
    assert.equal(resolveBackTarget({ ...input, urlFrom: 'other' }), null)
    assert.equal(resolveBackTarget({ ...input, urlFrom: ['cases', 'cases'] }), null)
    assert.equal(resolveBackTarget({ ...input, urlNav: undefined }), null)
    assert.equal(resolveBackTarget({ ...input, urlNav: 'abc' }), null)
    assert.equal(resolveBackTarget({ ...input, urlNav: [NAV, NAV] }), null)
  })

  test('nav 不一致（別の詳細を開いて記録が上書きされた場合など）→ null', () => {
    assert.equal(resolveBackTarget({ ...input, urlNav: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee' }), null)
  })

  test('案件ID 不一致 → null', () => {
    assert.equal(resolveBackTarget({ ...input, pageCaseId: OTHER_ID }), null)
    assert.equal(resolveBackTarget({ ...input, pageCaseId: undefined }), null)
  })

  test('遷移元種別 不一致 → null', () => {
    assert.equal(resolveBackTarget({ ...input, urlFrom: 'analytics' }), null)
  })

  test('保存された元画面URLが改ざんされている → null（外部URL・許可外パス）', () => {
    const tamper = (returnUrl: string, from = 'cases') =>
      resolveBackTarget({
        ...input,
        urlFrom: from,
        rawRecord: JSON.stringify({ nav: NAV, caseId: CASE_ID, from, returnUrl }),
      })
    assert.equal(tamper('https://example.com/'), null)
    assert.equal(tamper('//example.com/cases'), null)
    assert.equal(tamper('/\\example.com'), null)
    assert.equal(tamper('/cases/new'), null)
    assert.equal(tamper(`/cases/${CASE_ID}`), null)
    assert.equal(tamper('javascript:alert(1)'), null)
    assert.equal(tamper('/cases?page=2\n'), null)
    assert.equal(tamper(`/cases?search=${'a'.repeat(2000)}`), null)
    assert.equal(tamper('/cases?page=abc'), null)
    assert.equal(tamper('/analytics?view=inquiry&tab=daily', 'cases'), null)
  })

  test('大文字・小文字の違いだけの UUID は同じものとして扱う', () => {
    assert.equal(
      resolveBackTarget({ ...input, urlNav: NAV.toUpperCase(), pageCaseId: CASE_ID.toUpperCase() }),
      '/cases?status=confirmed&page=2'
    )
  })
})

describe('buildDetailHref / isDetailNavFrom', () => {
  test('詳細URLには from と nav だけが付く', () => {
    assert.equal(buildDetailHref(CASE_ID, 'cases', NAV), `/cases/${CASE_ID}?from=cases&nav=${NAV}`)
    assert.equal(buildDetailHref(CASE_ID, 'analytics', NAV), `/cases/${CASE_ID}?from=analytics&nav=${NAV}`)
  })

  test('isDetailNavFrom', () => {
    assert.equal(isDetailNavFrom('cases'), true)
    assert.equal(isDetailNavFrom('analytics'), true)
    assert.equal(isDetailNavFrom('other'), false)
    assert.equal(isDetailNavFrom(undefined), false)
  })
})

describe('shouldInterceptClick: 介入する操作・しない操作', () => {
  const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

  test('通常の左クリック／Enter（button=0 の click）→ 介入する', () => {
    assert.equal(shouldInterceptClick(plain), true)
    assert.equal(shouldInterceptClick(plain, { target: null }), true)
    assert.equal(shouldInterceptClick(plain, { target: '' }), true)
    assert.equal(shouldInterceptClick(plain, { target: '_self' }), true)
  })

  test('Ctrl / Cmd / Shift / Alt（クリックでも Enter でも）→ 介入しない', () => {
    assert.equal(shouldInterceptClick({ ...plain, ctrlKey: true }), false)
    assert.equal(shouldInterceptClick({ ...plain, metaKey: true }), false)
    assert.equal(shouldInterceptClick({ ...plain, shiftKey: true }), false)
    assert.equal(shouldInterceptClick({ ...plain, altKey: true }), false)
  })

  test('中クリック・右クリック → 介入しない', () => {
    assert.equal(shouldInterceptClick({ ...plain, button: 1 }), false)
    assert.equal(shouldInterceptClick({ ...plain, button: 2 }), false)
  })

  test('target=_blank・ダウンロード → 介入しない', () => {
    assert.equal(shouldInterceptClick(plain, { target: '_blank' }), false)
    assert.equal(shouldInterceptClick(plain, { target: 'other' }), false)
    assert.equal(shouldInterceptClick(plain, { download: true }), false)
  })

  test('既に defaultPrevented の場合は介入しない', () => {
    assert.equal(shouldInterceptClick({ ...plain, defaultPrevented: true }), false)
  })
})
