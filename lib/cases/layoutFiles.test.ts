/**
 * ⑧ レイアウト図のドラッグ＆ドロップ（判定ロジックと画面の接続）の自動テスト（node:test、追加の依存関係なし）
 * 実行: node --test lib/cases/layoutFiles.test.ts
 * DB・Supabase・Storage・ネットワーク接続は一切使用しない。ファイルは名前と MIME だけの架空オブジェクト。
 *
 * 背景: ⑦ 添付ファイルにはドロップ処理があるが、⑧ レイアウト図はクリックでファイル選択を開くだけで、
 *       ドラッグ＆ドロップしても何も起きなかった（ブラウザ標準の動作でファイルが別タブで開くこともあった）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isLayoutFileAcceptable,
  partitionLayoutFiles,
  layoutRejectedMessage,
  processLayoutDrop,
  LAYOUT_FILE_TYPE,
} from './layoutFiles.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const f = (name: string, type: string) => ({ name, type })

describe('許可ファイルの判定（画像・PDF のみ）', () => {
  test('image/* は許可（jpeg / png / gif / webp / svg / heic）', () => {
    for (const [n, t] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.gif', 'image/gif'], ['a.webp', 'image/webp'], ['a.svg', 'image/svg+xml'], ['a.heic', 'image/heic'], ['a.heif', 'image/heif']]) {
      assert.equal(isLayoutFileAcceptable(f(n, t)), true, t)
    }
  })

  test('PDF は許可', () => {
    assert.equal(isLayoutFileAcceptable(f('7Fレイアウト.pdf', 'application/pdf')), true)
    assert.equal(isLayoutFileAcceptable(f('X.PDF', 'application/pdf')), true)
  })

  test('Excel / Word / PowerPoint / zip / テキスト / csv は不許可', () => {
    for (const [n, t] of [
      ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['a.xls', 'application/vnd.ms-excel'],
      ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['a.doc', 'application/msword'],
      ['a.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      ['a.zip', 'application/zip'],
      ['a.txt', 'text/plain'],
      ['a.csv', 'text/csv'],
    ]) {
      assert.equal(isLayoutFileAcceptable(f(n, t)), false, t)
    }
  })

  test('MIME が空のとき: HEIC など画像と PDF は拡張子で許可（既存の保存実績を壊さない）', () => {
    for (const n of ['IMG_0001.HEIC', 'x.heif', 'x.jpg', 'x.JPEG', 'x.png', 'x.webp', 'plan.pdf', 'レイアウト図.PDF']) {
      assert.equal(isLayoutFileAcceptable(f(n, '')), true, n)
    }
  })

  test('MIME が空で、画像・PDF 以外の拡張子（または拡張子なし）は不許可', () => {
    for (const n of ['a.xlsx', 'a.docx', 'a.zip', 'a.txt', 'README', 'a.']) {
      assert.equal(isLayoutFileAcceptable(f(n, '')), false, n)
    }
  })

  test('application/octet-stream は拡張子が画像でも不許可（サーバー側の許可 MIME と同じ扱い）', () => {
    assert.equal(isLayoutFileAcceptable(f('a.heic', 'application/octet-stream')), false)
    assert.equal(isLayoutFileAcceptable(f('a.pdf', 'application/octet-stream')), false)
  })

  test('MIME が画像・PDF なら拡張子が変でも許可（MIME を優先）', () => {
    assert.equal(isLayoutFileAcceptable(f('noext', 'image/png')), true)
  })
})

describe('partitionLayoutFiles / 通知文', () => {
  test('許可と不許可に振り分ける（順序は維持）', () => {
    const files = [f('a.png', 'image/png'), f('b.xlsx', 'application/vnd.ms-excel'), f('c.pdf', 'application/pdf'), f('d.docx', 'application/msword')]
    const { accepted, rejected } = partitionLayoutFiles(files)
    assert.deepEqual(accepted.map((x) => x.name), ['a.png', 'c.pdf'])
    assert.deepEqual(rejected.map((x) => x.name), ['b.xlsx', 'd.docx'])
  })

  test('通知文: 画像・PDFのみ対応と、除外したファイル名を示す', () => {
    const msg = layoutRejectedMessage([f('b.xlsx', ''), f('d.docx', '')])
    assert.match(msg, /画像・PDFのみ対応/)
    assert.ok(msg.includes('b.xlsx') && msg.includes('d.docx'))
  })
})

describe('processLayoutDrop: 既存のアップロード処理へ category=レイアウト図 で渡す', () => {
  const harness = () => {
    const calls: { files: string[]; type: string }[] = []
    const notices: string[] = []
    return {
      calls, notices,
      deps: {
        upload: (files: { name: string }[], fileType: string) => { calls.push({ files: files.map((x) => x.name), type: fileType }) },
        notifyRejected: (m: string) => { notices.push(m) },
      },
    }
  }

  test('画像と PDF → 既存 upload に 1 回、種別「レイアウト図」で渡す。通知なし', () => {
    const h = harness()
    const r = processLayoutDrop([f('a.png', 'image/png'), f('b.pdf', 'application/pdf')], h.deps)
    assert.deepEqual(h.calls, [{ files: ['a.png', 'b.pdf'], type: 'レイアウト図' }])
    assert.equal(LAYOUT_FILE_TYPE, 'レイアウト図')
    assert.deepEqual(h.notices, [])
    assert.deepEqual(r, { accepted: 2, rejected: 0 })
  })

  test('Excel だけをドロップ → アップロードしない。「画像・PDFのみ対応」を通知', () => {
    const h = harness()
    const r = processLayoutDrop([f('見積.xlsx', 'application/vnd.ms-excel')], h.deps)
    assert.deepEqual(h.calls, [])
    assert.equal(h.notices.length, 1)
    assert.match(h.notices[0], /画像・PDFのみ対応/)
    assert.deepEqual(r, { accepted: 0, rejected: 1 })
  })

  test('混在 → 画像・PDF だけアップロードし、対象外は通知（対象外はアップロードしない）', () => {
    const h = harness()
    processLayoutDrop([f('a.heic', ''), f('b.docx', 'application/msword'), f('c.pdf', 'application/pdf')], h.deps)
    assert.deepEqual(h.calls, [{ files: ['a.heic', 'c.pdf'], type: 'レイアウト図' }])
    assert.equal(h.notices.length, 1)
    assert.ok(h.notices[0].includes('b.docx'))
  })

  test('0 件 → 何もしない', () => {
    const h = harness()
    processLayoutDrop([], h.deps)
    assert.deepEqual(h.calls, [])
    assert.deepEqual(h.notices, [])
  })
})

describe('画面（Files.tsx）の接続: ⑧ は ⑦ と同じ操作ができ、API / Storage は変えない', () => {
  const src = read('components/cases/CaseDetail/Files.tsx')
  const section7 = src.slice(src.indexOf('⑦ 添付ファイル'), src.indexOf('⑧ レイアウト図'))
  const section8 = src.slice(src.indexOf('⑧ レイアウト図'), src.indexOf('プレビューモーダル'))

  test('⑦（通常添付）: onClick / onDragOver / onDragLeave / onDrop があり、種別を強制しない（ファイル名から推定）', () => {
    for (const h of ['onClick', 'onDragOver', 'onDragLeave', 'onDrop']) assert.ok(section7.includes(h), h)
    assert.match(section7, /void uploadFiles\(e\.dataTransfer\.files\)/)
    assert.ok(!section7.includes("'レイアウト図'"))
  })

  test('⑧（レイアウト図）: 以前は無かった onDragOver / onDragLeave / onDrop があり、クリックでの選択も残っている', () => {
    for (const h of ['onClick={() => layoutInputRef.current?.click()}', 'onDragOver', 'onDragLeave', 'onDrop']) assert.ok(section8.includes(h), h)
  })

  test('⑧ のドロップは dragover / drop の両方で preventDefault する（ブラウザがファイルを別タブで開かない）', () => {
    const over = /onDragOver=\{\(e\) => \{\s*e\.preventDefault\(\)/
    const drop = /onDrop=\{\(e\) => \{\s*e\.preventDefault\(\)/
    assert.match(section8, over)
    assert.match(section8, drop)
    assert.match(section7, over)
    assert.match(section7, drop)
  })

  test('⑧ のドロップは processLayoutDrop 経由で、既存の uploadFiles(files, fileType) に渡す。通知は既存の toast', () => {
    assert.match(section8, /processLayoutDrop\(Array\.from\(e\.dataTransfer\.files\)/)
    assert.match(section8, /upload: \(files, fileType\) => void uploadFiles\(files, fileType\)/)
    assert.match(section8, /notifyRejected: \(message\) => toast\.error\(message\)/)
    assert.match(src, /import \{ processLayoutDrop \} from '@\/lib\/cases\/layoutFiles'/)
  })

  test('クリックでの選択（input accept="image/*,application/pdf"・種別=レイアウト図）は従来どおり', () => {
    assert.match(section8, /accept="image\/\*,application\/pdf"/)
    assert.match(section8, /uploadFiles\(e\.target\.files, 'レイアウト図'\)/)
  })

  test('uploadFiles は FileList と File[] の両方を受け取れる。アップロード先の API は同じ', () => {
    assert.match(src, /const uploadFiles = async \(fileList: FileList \| File\[\], forceType\?: FileType\)/)
    assert.equal((src.match(/fetch\(`\/api\/cases\/\$\{caseId\}\/files`, \{\s*method: 'POST'/g) ?? []).length, 1, 'POST はアップロード関数の 1 か所だけ')
  })

  test('API / Storage のコードは今回の変更対象ではない（レイアウト図専用の API を作っていない）', () => {
    const api = read('app/api/cases/[id]/files/route.ts')
    assert.ok(!api.includes('processLayoutDrop'))
    assert.ok(api.includes("const FILE_TYPES = ['見積書', '請求書', '進行表', 'レイアウト図', 'その他'] as const"))
    assert.ok(api.includes('const MAX_FILE_SIZE = 50 * 1024 * 1024'))
  })
})
