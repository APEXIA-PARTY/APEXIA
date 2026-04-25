import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { formatDate, formatDateTime, formatTime, formatCurrency, emptyToDash } from '@/lib/utils/format'
import { getSignedUrl } from '@/lib/supabase/storage'
import { PdfDownloadButton } from '@/components/cases/PdfDownloadButton'

/** レイアウト図の表示用データ型 */
interface LayoutFileWithUrl {
  id: string
  file_name: string
  mime_type: string | null
  storage_path: string
  label: string | null
  displayUrl: string | null
  isPdf: boolean
}

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { export?: string }
}) {
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

  const rawLayouts = ((c.case_files as any[]) ?? []).filter(f => f.file_type === 'レイアウト図')
  const layouts: LayoutFileWithUrl[] = await Promise.all(
    rawLayouts.map(async (f): Promise<LayoutFileWithUrl> => {
      const isPdf = f.mime_type === 'application/pdf'
      let displayUrl: string | null = null
      if (!isPdf) {
        if (f.storage_path?.startsWith('data:')) {
          displayUrl = f.storage_path
        } else if (f.storage_path) {
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

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const detailUrl = `${appUrl}/cases/${params.id}`
  const issueDate = formatDate(new Date().toISOString())
  const isExport  = searchParams.export === '1'

  const printStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: 'Noto Sans JP', 'Hiragino Sans', 'Meiryo', sans-serif;
      font-size: 9pt; color: #1a1a1a; background: #fff;
    }

    .page {
  width: 100%;
  max-width: 186mm;
  min-height: 297mm;
  padding: 0;
  margin: 0 auto;
  background: #fff;
}
    .no-print-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      background: #f9fafb; border-bottom: 1px solid #e5e7eb;
      padding: 10px 20px; display: flex; align-items: center; gap: 10px;
    }
    .page-offset { padding-top: 52px; }

    @media print {
      .page {
  width: 100%;
  max-width: none;
  min-height: auto;
  padding: 0;
  margin: 0;
}
      html, body {
        width: 210mm; background: #fff;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .no-print-bar, .page-offset { display: none !important; }
      .page { width: 100%; min-height: auto; padding: 0; margin: 0; }
      .section { break-inside: avoid; }
      tr { break-inside: avoid; }
    }

    .header {
      border-bottom: 2pt solid #1a1a1a; padding-bottom: 5pt; margin-bottom: 10pt;
      display: flex; justify-content: space-between; align-items: flex-end;
    }
    .logo { font-size: 20pt; font-weight: 700; letter-spacing: 2pt; }
    .doc-title { font-size: 13pt; font-weight: 700; margin-top: 2pt; }
    .issue-date { font-size: 8pt; color: #666; }
    .detail-url { font-size: 7pt; color: #4472C4; word-break: break-all; }

    .section { margin-bottom: 10pt; }
    .section-title {
      font-size: 8.5pt; font-weight: 700; background: #1a1a1a; color: #fff;
      padding: 2.5pt 7pt; margin-bottom: 5pt;
    }

    table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    th, td { border: 0.5pt solid #bbb; padding: 3pt 5pt; vertical-align: middle; }
    table:not(.opt-table) th {
      background: #f0f0ee; font-weight: 600; text-align: left; white-space: nowrap;
    }
    table:not(.opt-table) td.num { text-align: right; font-variant-numeric: tabular-nums; }
    table:not(.opt-table) td.center { text-align: center; }
    .total-row td { background: #f7f6f2; font-weight: 600; }

    .opt-table {
      width: 100%; table-layout: fixed;
      border-collapse: collapse; font-size: 7.5pt;
    }
    .opt-table th,
    .opt-table td {
      border: 0.5pt solid #bbb; padding: 2.5pt 3pt; vertical-align: middle;
    }
    .opt-table th { background: #f0f0ee; font-weight: 600; text-align: left; }
    .opt-table col.c-qty   { width: 30pt; }
    .opt-table col.c-price { width: 52pt; }
    .opt-table col.c-state { width: 36pt; }
    .opt-table .c-name  { word-break: break-all; white-space: normal; }
    .opt-table .c-qty   { text-align: center; white-space: nowrap; }
    .opt-table .c-price { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .opt-table .c-state { text-align: center; white-space: nowrap; }
    .opt-table .total-row td { background: #f7f6f2; font-weight: 600; }
    .tax-note { font-size: 5.5pt; color: #999; font-weight: 400; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4pt; }
    .info-item { border: 0.5pt solid #ddd; padding: 3pt 5pt; }
    .info-label { font-size: 7pt; color: #888; margin-bottom: 1.5pt; }
    .info-value { font-size: 8.5pt; font-weight: 500; }

    .timeline { display: flex; flex-wrap: wrap; gap: 4pt; }
    .time-item { border: 0.5pt solid #ddd; padding: 3pt 6pt; text-align: center; min-width: 58pt; }
    .time-label { font-size: 7pt; color: #888; }
    .time-value { font-size: 10pt; font-weight: 600; font-variant-numeric: tabular-nums; }

    .check-list { list-style: none; }
    .check-list li { padding: 1.5pt 0; border-bottom: 0.3pt solid #eee; font-size: 8pt; }
    .check-list li::before { content: '□ '; color: #888; }
    .check-list li.confirmed::before { content: '✓ '; color: #375623; }

    .layout-item img {
      width: 100%; height: auto; object-fit: contain;
      border: 0.5pt solid #ddd; display: block;
    }
    .layout-pdf-row {
      padding: 5pt 0; font-size: 8pt; color: #555; border-bottom: 0.3pt solid #eee;
    }
  `

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />

      {!isExport && (
        <>
          <div className="no-print-bar">
  <a
    href={`/cases/${params.id}`}
    style={{
      padding: '6px 14px',
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: 6,
      textDecoration: 'none',
      fontSize: 13,
      color: '#333',
    }}
  >
    ← 詳細に戻る
  </a>

  <PdfDownloadButton
    caseId={params.id}
    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
  />
</div>
          <div className="page-offset" />
        </>
      )}

      <div className="page">

        {/* ヘッダー */}
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
            <div className="info-item">
              <div className="info-label">会社名 / 団体名</div>
              <div className="info-value">{emptyToDash(c.company)}</div>
            </div>
            <div className="info-item">
              <div className="info-label">担当者名</div>
              <div className="info-value">{emptyToDash(c.contact)}</div>
            </div>
            <div className="info-item">
              <div className="info-label">電話番号</div>
              <div className="info-value">{emptyToDash(c.phone)}</div>
            </div>
            <div className="info-item">
              <div className="info-label">メール</div>
              <div className="info-value" style={{ fontSize: '7.5pt', wordBreak: 'break-all' }}>
                {emptyToDash(c.email)}
              </div>
            </div>
            <div className="info-item">
              <div className="info-label">問合せ日</div>
              <div className="info-value">{formatDate(c.inquiry_date)}</div>
            </div>
            <div className="info-item">
              <div className="info-label">開催日</div>
              <div className="info-value">{formatDate(c.event_date)}</div>
            </div>
            <div className="info-item" style={{ gridColumn: 'span 2' }}>
              <div className="info-label">イベント名</div>
              <div className="info-value">{emptyToDash(c.event_name)}</div>
            </div>
            <div className="info-item">
              <div className="info-label">予定参加人数</div>
              <div className="info-value">{c.guest_count ? `${c.guest_count} 名` : '—'}</div>
            </div>
            <div className="info-item">
              <div className="info-label">フロア</div>
              <div className="info-value">{(c.floor_master as any)?.name ?? '—'}</div>
            </div>
            <div className="info-item">
              <div className="info-label">イベント大分類</div>
              <div className="info-value">{(c.event_category_master as any)?.name ?? '—'}</div>
            </div>
            <div className="info-item">
              <div className="info-label">イベント中分類</div>
              <div className="info-value">
                {(c.event_subcategory_master as any)?.name === 'その他' && c.event_subcategory_note
                  ? `その他（${c.event_subcategory_note}）`
                  : ((c.event_subcategory_master as any)?.name ?? '—')}
              </div>
            </div>
            <div className="info-item">
              <div className="info-label">認知経路</div>
              <div className="info-value">{(c.media_master as any)?.name ?? '—'}</div>
            </div>
            <div className="info-item">
              <div className="info-label">連絡方法</div>
              <div className="info-value">{(c.contact_method_master as any)?.name ?? '—'}</div>
            </div>
          </div>
        </div>

        {/* ② タイムスケジュール */}
        <div className="section">
          <div className="section-title">② タイムスケジュール</div>
          <div className="timeline">
            {[
              ['入り',          c.load_in_time],
              ['搬入 / 準備',  c.setup_time],
              ['リハ',          c.rehearsal_time],
              ['開始',          c.start_time],
              ['終了',          c.end_time],
              ['片付け / 撤収', c.strike_time],
              ['完全撤収',      c.full_exit_time],
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
                <th style={{ width: '22%' }}>下見日時</th>
                <td>{c.preview_datetime ? formatDateTime(c.preview_datetime) : '—'}</td>
                <th style={{ width: '18%' }}>見積金額（税込）</th>
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

        {/* ④ 備品・設備明細 */}
        {equipment.length > 0 && (
          <div className="section">
            <div className="section-title">④ 備品・設備明細</div>
            <table className="opt-table">
              <colgroup>
                <col className="c-name" />
                <col className="c-qty" />
                <col className="c-price" />
                <col className="c-price" />
                <col className="c-state" />
              </colgroup>
              <thead>
                <tr>
                  <th className="c-name">内容</th>
                  <th className="c-qty">数量</th>
                  <th className="c-price">単価<span className="tax-note">（税抜）</span></th>
                  <th className="c-price">金額<span className="tax-note">（税抜）</span></th>
                  <th className="c-state">状態</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((e: any) => (
                  <tr key={e.id}>
                    <td className="c-name">{e.name}</td>
                    <td className="c-qty">{e.qty} {e.unit}</td>
                    <td className="c-price">{e.unit_price > 0 ? formatCurrency(e.unit_price) : '—'}</td>
                    <td className="c-price">
                      {(e.amount ?? e.qty * e.unit_price) > 0
                        ? formatCurrency(e.amount ?? e.qty * e.unit_price)
                        : '—'}
                    </td>
                    <td className="c-state">{e.state}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td className="c-name" colSpan={3}>合計（税抜）</td>
                  <td className="c-price">
                    {formatCurrency(
                      equipment.reduce((s: number, e: any) => s + (e.amount ?? e.qty * e.unit_price), 0)
                    )}
                  </td>
                  <td className="c-state" />
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
              <div key={cat} style={{ marginBottom: '5pt' }}>
                <div style={{ fontWeight: 600, fontSize: '7.5pt', marginBottom: '2pt', color: '#555' }}>
                  {cat}
                </div>
                <table className="opt-table">
                  <colgroup>
                    <col className="c-name" />
                    <col className="c-qty" />
                    <col className="c-price" />
                    <col className="c-price" />
                    <col className="c-state" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="c-name">内容</th>
                      <th className="c-qty">数量</th>
                      <th className="c-price">単価<span className="tax-note">（税抜）</span></th>
                      <th className="c-price">金額<span className="tax-note">（税抜）</span></th>
                      <th className="c-state">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e: any) => (
                      <tr key={e.id}>
                        <td className="c-name">{e.name}</td>
                        <td className="c-qty">{e.qty} {e.unit}</td>
                        <td className="c-price">{e.unit_price > 0 ? formatCurrency(e.unit_price) : '—'}</td>
                        <td className="c-price">
                          {(e.amount ?? e.qty * e.unit_price) > 0
                            ? formatCurrency(e.amount ?? e.qty * e.unit_price)
                            : '—'}
                        </td>
                        <td className="c-state">{e.state}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td className="c-name" colSpan={3}>合計（税抜）</td>
                      <td className="c-price">
                        {formatCurrency(
                          items.reduce((s: number, e: any) => s + (e.amount ?? e.qty * e.unit_price), 0)
                        )}
                      </td>
                      <td className="c-state" />
                    </tr>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8pt' }}>
              {pending.length > 0 && (
                <div>
                  <div style={{ fontSize: '7.5pt', fontWeight: 600, color: '#b45309', marginBottom: '2pt' }}>
                    確認中
                  </div>
                  <ul className="check-list">
                    {pending.map((i: any) => <li key={i.id}>{i.item}</li>)}
                  </ul>
                </div>
              )}
              {confirmed.length > 0 && (
                <div>
                  <div style={{ fontSize: '7.5pt', fontWeight: 600, color: '#375623', marginBottom: '2pt' }}>
                    確定済み
                  </div>
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
          <>
            <div style={{ pageBreakBefore: 'always' }} />
            <div className="section">
              <div className="section-title">⑦ レイアウト図</div>
              {layouts.map((f) => (
                <div key={f.id} style={{ marginBottom: '6pt' }}>
                  {f.isPdf ? (
                    <div className="layout-pdf-row">
                      📄 {f.label || f.file_name}（PDF保存時に結合されます）
                    </div>
                  ) : f.displayUrl ? (
                    <div className="layout-item">
                      <img src={f.displayUrl} alt={f.label ?? f.file_name} />
                      <div style={{ fontSize: '7.5pt', textAlign: 'center', marginTop: '3pt', fontWeight: 500 }}>
                        {f.label || f.file_name}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '8pt', color: '#aaa' }}>
                      {f.file_name}（表示できません）
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ⑧ 備考・注意事項 */}
        <div className="section">
          <div className="section-title">⑧ 備考・注意事項</div>
          <table>
            <tbody>
              {c.notes && (
                <tr>
                  <th style={{ width: '14%', verticalAlign: 'top' }}>備考</th>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</td>
                </tr>
              )}
              <tr>
                <th style={{ verticalAlign: 'top' }}>注意事項</th>
                <td style={{ fontSize: '7.5pt', color: '#444', lineHeight: 1.6 }}>
                  ・お荷物や機材の搬入出は必ず搬入出届をご提出ください。<br />
                  ・開始時間・終了時間は厳守をお願いします。完全撤収時間までに退出してください。<br />
                  ・ゴミは必ずお持ち帰りください。施設内の備品の破損・紛失は弁償していただく場合があります。<br />
                  ・進行変更がある場合は事前にご連絡ください。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </>
  )
}