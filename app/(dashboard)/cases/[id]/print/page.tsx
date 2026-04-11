import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { formatDate, formatDateTime, formatTime, formatCurrency, emptyToDash } from '@/lib/utils/format'
import { CaseStatus } from '@/types/database'
import { PrintTrigger } from '@/components/cases/CaseDetail/PrintTrigger'
import { getSignedUrl } from '@/lib/supabase/storage'


/** レイアウト図に表示用URLを付与した型 */
interface LayoutFileWithUrl {
  id: string
  file_name: string
  mime_type: string | null
  storage_path: string
  label: string | null
  /** 印刷ページで <img src> に渡す表示用URL（画像のみ。PDF は null） */
  displayUrl: string | null
  isPdf: boolean
}

export default async function PrintPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: c, error } = await supabase
    .from('cases')
    .select(`
      *,
      media_master(id, name),
      contact_method_master(id, name),
      floor_master(id, name),
      event_category_master(id, name),
      event_subcategory_master(id, name),
      case_options(*),
      case_checklist(*),
      case_files(*)
    `)
    .eq('id', params.id)
    .single()

  if (error || !c) notFound()

  const equipment = ((c.case_options as any[]) ?? []).filter(o => o.category === 'equipment')
  const machines  = ['音響', '照明', '映像'].map(cat => ({
    cat,
    items: ((c.case_options as any[]) ?? []).filter(o => o.category === 'machine' && o.machine_category === cat),
  }))
  const checklist = ((c.case_checklist as any[]) ?? []).sort((a, b) => a.sort_order - b.sort_order)
  const pending   = checklist.filter(i => i.state === '確認中')
  const confirmed = checklist.filter(i => i.state === '確定')
  // ─── レイアウト図: SSR で表示用URLを解決する ─────────────────
  // storage_path が data: で始まる → base64 のままそのまま使用
  // storage_path が Storage パス  → getSignedUrl() で署名付きURLを取得
  // PDF ファイル                   → 画像表示不可のためファイル名のみ表示
  const rawLayouts = ((c.case_files as any[]) ?? []).filter(f => f.file_type === 'レイアウト図')
  const layouts: LayoutFileWithUrl[] = await Promise.all(
    rawLayouts.map(async (f): Promise<LayoutFileWithUrl> => {
      const isPdf    = f.mime_type === 'application/pdf'
      const isImage  = f.mime_type?.startsWith('image/') as boolean
      let displayUrl: string | null = null
      if (!isPdf && isImage) {
        if (f.storage_path?.startsWith('data:')) {
          // base64 データURL はそのまま使用
          displayUrl = f.storage_path
        } else if (f.storage_path) {
          // Supabase Storage パス → SSR で署名付きURL を取得（有効期限1時間）
          displayUrl = await getSignedUrl(f.storage_path)
        }
      }
      return {
        id: f.id, file_name: f.file_name, mime_type: f.mime_type,
        storage_path: f.storage_path, label: f.label,
        displayUrl, isPdf,
      }
    })
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const detailUrl = `${appUrl}/cases/${params.id}`

  // ─── CSS ────────────────────────────────────────────────────
  const printStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans JP', 'Hiragino Sans', Meiryo, sans-serif;
      font-size: 9pt;
      color: #1a1a1a;
      background: #fff;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 15mm 18mm;
      margin: 0 auto;
      background: #fff;
    }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body { width: 210mm; }
      .page { padding: 12mm 15mm; page-break-after: always; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
    /* ヘッダー */
    .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 6pt; margin-bottom: 12pt; display: flex; justify-content: space-between; align-items: flex-end; }
    .logo { font-size: 20pt; font-weight: 700; letter-spacing: 2pt; }
    .doc-title { font-size: 14pt; font-weight: 700; }
    .issue-date { font-size: 8pt; color: #666; }
    /* セクション */
    .section { margin-bottom: 12pt; }
    .section-title {
      font-size: 9pt; font-weight: 700; background: #1a1a1a; color: #fff;
      padding: 3pt 8pt; margin-bottom: 6pt;
    }
    /* テーブル */
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th, td { border: 0.5pt solid #bbb; padding: 3pt 5pt; }
    th { background: #f0f0ee; font-weight: 600; text-align: left; white-space: nowrap; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.center { text-align: center; }
    /* インフォグリッド */
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5pt; }
    .info-item { border: 0.5pt solid #ddd; padding: 4pt 6pt; }
    .info-label { font-size: 7pt; color: #888; margin-bottom: 2pt; }
    .info-value { font-size: 9pt; font-weight: 500; }
    /* タイムライン */
    .timeline { display: flex; flex-wrap: wrap; gap: 5pt; }
    .time-item { border: 0.5pt solid #ddd; padding: 4pt 8pt; text-align: center; min-width: 70pt; }
    .time-label { font-size: 7pt; color: #888; }
    .time-value { font-size: 10pt; font-weight: 600; font-variant-numeric: tabular-nums; }
    /* 確認チェック */
    .check-list { list-style: none; }
    .check-list li { padding: 2pt 0; border-bottom: 0.3pt solid #eee; font-size: 8.5pt; }
    .check-list li::before { content: '□ '; color: #888; }
    .check-list li.confirmed::before { content: '✓ '; color: #375623; }
    /* レイアウト図 */
    .layout-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; }
    .layout-item img { width: 100%; max-height: 120pt; object-fit: contain; border: 0.5pt solid #ddd; }
    .layout-label { font-size: 7.5pt; text-align: center; margin-top: 2pt; font-weight: 500; }
    /* フッター確認欄 */
    .footer { border-top: 0.5pt solid #bbb; margin-top: 16pt; padding-top: 10pt; }
    .signature-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10pt; }
    .signature-box { border: 0.5pt solid #bbb; padding: 6pt 8pt; min-height: 40pt; }
    .signature-label { font-size: 7pt; color: #888; margin-bottom: 4pt; }
    /* 合計行 */
    .total-row td { background: #f7f6f2; font-weight: 600; }
    /* URL */
    .detail-url { font-size: 7pt; color: #4472C4; word-break: break-all; }
  `

  const issueDate = formatDate(new Date().toISOString())

  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>イベント確認表 - {c.company}</title>
        <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      </head>
      <body>
        {/* 印刷ボタン（印刷時非表示） */}
        <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, zIndex: 100, display: 'flex', gap: 8 }}>
          <a href={`/cases/${params.id}`} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', fontSize: 13, color: '#333' }}>
            ← 詳細に戻る
          </a>
          <PrintTrigger />
        </div>

        <div className="page">
          {/* ── ヘッダー ─────────────────────────────────────── */}
          <div className="header">
            <div>
              <div className="logo">APEXIA</div>
              <div className="doc-title">イベント確認表</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="issue-date">発行日: {issueDate}</div>
              <div className="detail-url">案件URL: {detailUrl}</div>
            </div>
          </div>

          {/* ① 基本情報 */}
          <div className="section">
            <div className="section-title">① 基本情報</div>
            <div className="info-grid">
              <div className="info-item"><div className="info-label">会社名 / 団体名</div><div className="info-value">{emptyToDash(c.company)}</div></div>
              <div className="info-item"><div className="info-label">担当者名</div><div className="info-value">{emptyToDash(c.contact)}</div></div>
              <div className="info-item"><div className="info-label">電話番号</div><div className="info-value">{emptyToDash(c.phone)}</div></div>
              <div className="info-item"><div className="info-label">メール</div><div className="info-value" style={{ fontSize: '8pt', wordBreak: 'break-all' }}>{emptyToDash(c.email)}</div></div>
              <div className="info-item"><div className="info-label">問合せ日</div><div className="info-value">{formatDate(c.inquiry_date)}</div></div>
              <div className="info-item"><div className="info-label">開催日</div><div className="info-value">{formatDate(c.event_date)}</div></div>
              <div className="info-item" style={{ gridColumn: 'span 2' }}><div className="info-label">イベント名</div><div className="info-value">{emptyToDash(c.event_name)}</div></div>
              <div className="info-item"><div className="info-label">予定参加人数</div><div className="info-value">{c.guest_count ? `${c.guest_count} 名` : '—'}</div></div>
              <div className="info-item"><div className="info-label">フロア</div><div className="info-value">{(c.floor_master as any)?.name ?? '—'}</div></div>
              <div className="info-item"><div className="info-label">イベント大分類</div><div className="info-value">{(c.event_category_master as any)?.name ?? '—'}</div></div>
              <div className="info-item"><div className="info-label">イベント中分類</div><div className="info-value">
                {(c.event_subcategory_master as any)?.name === 'その他' && c.event_subcategory_note
                  ? `その他（${c.event_subcategory_note}）`
                  : ((c.event_subcategory_master as any)?.name ?? '—')}
              </div></div>
              <div className="info-item"><div className="info-label">認知経路</div><div className="info-value">{(c.media_master as any)?.name ?? '—'}</div></div>
              <div className="info-item"><div className="info-label">連絡方法</div><div className="info-value">{(c.contact_method_master as any)?.name ?? '—'}</div></div>
            </div>
            {c.notes && (
              <div style={{ marginTop: 6, border: '0.5pt solid #ddd', padding: '4pt 6pt', fontSize: '8.5pt' }}>
                <span style={{ color: '#888', fontSize: '7pt' }}>備考: </span>{c.notes}
              </div>
            )}
          </div>

          {/* ② タイムスケジュール */}
          <div className="section">
            <div className="section-title">② タイムスケジュール</div>
            <div className="timeline">
              {[
                ['入り',         c.load_in_time],
                ['搬入 / 準備', c.setup_time],
                ['リハ',         c.rehearsal_time],
                ['開始',         c.start_time],
                ['終了',         c.end_time],
                ['片付け / 撤収', c.strike_time],
                ['完全撤収',     c.full_exit_time],
              ].map(([label, time]) => (
                <div key={label as string} className="time-item">
                  <div className="time-label">{label}</div>
                  <div className="time-value">{time ? formatTime(time as string) : '——'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ③ 確認手続き */}
          <div className="section">
            <div className="section-title">③ 確認手続き</div>
            <table>
              <tbody>
                <tr>
                  <th style={{ width: '25%' }}>下見日時</th>
                  <td>{c.preview_datetime ? formatDateTime(c.preview_datetime) : '—'}</td>
                  <th style={{ width: '20%' }}>見積金額（税込）</th>
                  <td className="num">{c.estimate_amount > 0 ? formatCurrency(c.estimate_amount) : '—'}</td>
                </tr>
                <tr>
                  <th>申込みフォーム</th>
                  <td>{c.application_form_status}</td>
                  <th>搬入出届</th>
                  <td>{c.delivery_notice_status}</td>
                </tr>
                <tr>
                  <th>請求書</th>
                  <td>{c.invoice_status}</td>
                  <th>支払い方法</th>
                  <td>{c.payment_method ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ④ 備品・設備 */}
          {equipment.length > 0 && (
            <div className="section">
              <div className="section-title">④ 備品・設備明細</div>
              <table>
                <thead>
                  <tr><th>内容</th><th className="center" style={{ width: 40 }}>数量</th><th className="num" style={{ width: 70 }}>単価</th><th className="num" style={{ width: 70 }}>金額</th><th className="center" style={{ width: 55 }}>状態</th></tr>
                </thead>
                <tbody>
                  {equipment.map((e: any) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td className="center">{e.qty} {e.unit}</td>
                      <td className="num">{e.unit_price > 0 ? formatCurrency(e.unit_price) : '—'}</td>
                      <td className="num">{(e.amount ?? e.qty * e.unit_price) > 0 ? formatCurrency(e.amount ?? e.qty * e.unit_price) : '—'}</td>
                      <td className="center">{e.state}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3}>合計</td>
                    <td className="num">{formatCurrency(equipment.reduce((s: number, e: any) => s + (e.amount ?? e.qty * e.unit_price), 0))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ⑤ 機材・オペレーター */}
          {machines.some(m => m.items.length > 0) && (
            <div className="section">
              <div className="section-title">⑤ 機材・オペレーター</div>
              {machines.filter(m => m.items.length > 0).map(({ cat, items }) => (
                <div key={cat} style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: '8pt', marginBottom: 3, color: '#555' }}>{cat}</div>
                  <table>
                    <thead>
                      <tr><th>内容</th><th className="num" style={{ width: 80 }}>金額</th><th className="center" style={{ width: 55 }}>状態</th></tr>
                    </thead>
                    <tbody>
                      {items.map((e: any) => (
                        <tr key={e.id}>
                          <td>{e.name}</td>
                          <td className="num">{(e.amount ?? e.qty * e.unit_price) > 0 ? formatCurrency(e.amount ?? e.qty * e.unit_price) : '—'}</td>
                          <td className="center">{e.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* ⑥ 確認事項 */}
          {checklist.length > 0 && (
            <div className="section">
              <div className="section-title">⑥ 確認事項</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {pending.length > 0 && (
                  <div>
                    <div style={{ fontSize: '7.5pt', fontWeight: 600, color: '#b45309', marginBottom: 3 }}>確認中</div>
                    <ul className="check-list">
                      {pending.map((i: any) => <li key={i.id}>{i.item}</li>)}
                    </ul>
                  </div>
                )}
                {confirmed.length > 0 && (
                  <div>
                    <div style={{ fontSize: '7.5pt', fontWeight: 600, color: '#375623', marginBottom: 3 }}>確定済み</div>
                    <ul className="check-list">
                      {confirmed.map((i: any) => <li key={i.id} className="confirmed">{i.item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ⑦ レイアウト図 */}
          {layouts.length > 0 && (
            <div className="section page-break">
              <div className="section-title">⑦ レイアウト図</div>
              <div className="layout-grid">
                {layouts.map((f) => (
                  <div key={f.id} className="layout-item">
                    {f.displayUrl ? (
                      /* 画像: base64 または署名付きURL */
                      <img src={f.displayUrl} alt={f.label ?? f.file_name} />
                    ) : f.isPdf ? (
                      /* PDF: 画像表示不可のためファイル名と案内を表示 */
                      <div style={{ height: 80, border: '0.5pt solid #ddd', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 8, color: '#888' }}>
                        <span style={{ fontSize: 16 }}>📄</span>
                        <span style={{ fontWeight: 600 }}>{f.file_name}</span>
                        <span>PDFはシステム上で別途確認してください</span>
                      </div>
                    ) : (
                      /* 画像URLが取得できなかった場合（Storage未設定など） */
                      <div style={{ height: 80, border: '0.5pt solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#ccc' }}>
                        {f.file_name}
                      </div>
                    )}
                    <div className="layout-label">{f.label || f.file_name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ⑧ 備考・注意事項 */}
          <div className="section">
            <div className="section-title">⑧ 備考・注意事項</div>
            <table>
              <tbody>
                {c.notes && (
                  <tr>
                    <th style={{ width: '15%', verticalAlign: 'top' }}>備考</th>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</td>
                  </tr>
                )}
                <tr>
                  <th style={{ verticalAlign: 'top' }}>注意事項</th>
                  <td style={{ fontSize: '8pt', color: '#444', lineHeight: 1.6 }}>
                    ・お荷物や機材の搬入出は必ず搬入出届をご提出ください。<br />
                    ・開始時間・終了時間は厳守をお願いします。完全撤収時間までに退出してください。<br />
                    ・ゴミは必ずお持ち帰りください。施設内の備品の破損・紛失は弁償していただく場合があります。<br />
                    ・進行変更がある場合は事前にご連絡ください。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* フッター確認欄 */}
          <div className="footer">
            <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: 6 }}>確認欄</div>
            <div className="signature-row">
              <div className="signature-box"><div className="signature-label">お客様確認</div></div>
              <div className="signature-box"><div className="signature-label">担当スタッフ確認</div></div>
              <div className="signature-box">
                <div className="signature-label">APEXIA 管理</div>
                <div style={{ fontSize: '7pt', color: '#888', marginTop: 3 }}>確認日: _____ / _____</div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
