import { useState } from 'react'
import { downloadWorkbook } from '../../lib/sheet'
import { readKitFile, kitTouched, kitSummary, templateSheets, MAT_LABEL, KIND_LABEL, type KitDraft } from '../../lib/kitImport'
import { KIT, type KitCard } from './common'

// Ba cách tạo bộ học liệu của bài (đợt 4b): tự soạn từng thẻ · tải giáo án Word / PowerPoint để tách tự động ·
// điền file mẫu Excel 5 sheet. File được đọc trên trình duyệt; người soạn xem trước, chọn thẻ rồi mới áp dụng vào form.
export type KitApply = (d: KitDraft, cards: KitCard[], file: File | null) => Promise<string | null>

export function KitImport({ title, fresh, onApply, onClose }: { title: string; fresh: boolean; onApply: KitApply; onClose: () => void }) {
  const [draft, setDraft] = useState<{ d: KitDraft; file: File } | null>(null)
  const [cards, setCards] = useState<KitCard[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function read(f: File) {
    setErr(''); setBusy(true)
    try {
      const d = await readKitFile(f)
      const t = kitTouched(d)
      if (!t.length) setErr(['Không đọc được nội dung nào cho các thẻ từ file này.', ...d.warnings].join(' '))
      else { setDraft({ d, file: f }); setCards(t) }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }
  async function template() {
    await downloadWorkbook(`Mau-bo-hoc-lieu${title ? '-' + title.slice(0, 40) : ''}.xlsx`,
      templateSheets(title).map(s => ({ name: s.name, columns: s.header.map(h => ({ key: h, label: h, width: Math.max(14, h.length + 6) })), rows: s.rows })))
  }
  async function apply() {
    if (!draft) return
    setBusy(true); setErr('')
    const e = await onApply(draft.d, cards, draft.d.source === 'xlsx' ? null : draft.file)
    setBusy(false)
    if (e) setErr(e); else { setDraft(null); onClose() }
  }
  const pickFile = (accept: string, label: string, primary = false) => (
    <label className={'filebtn' + (primary ? ' primary' : '') + (busy ? ' busy' : '')}>{busy ? 'Đang đọc file…' : label}
      <input type="file" hidden accept={accept} disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = '' }} /></label>
  )

  if (draft) {
    const { d } = draft, s = kitSummary(d)
    const has: Record<KitCard, string> = { info: s.info.join(' · '), content: s.content, links: s.links, norms: s.norms, bank: d.activities?.length ? `${d.activities.length} hoạt động` : '' }
    return (
      <div className="kitimport" style={{ gridColumn: '1 / -1' }}>
        <div className="bar small"><b>Xem trước: {draft.file.name}</b>
          <span className="sub">Chọn thẻ muốn áp dụng. Thẻ được áp dụng chuyển về “Cần kiểm tra” để anh/chị rà lại rồi chốt.</span></div>
        <div className="kitbar">
          {KIT.map(([k, l]) => {
            const ok = !!has[k], on = cards.includes(k)
            return <label key={k} className={'kitcard' + (on ? ' on' : '')} style={!ok ? { opacity: 0.55 } : undefined}>
              <span><input type="checkbox" disabled={!ok} checked={on} onChange={e => setCards(e.target.checked ? [...cards, k] : cards.filter(x => x !== k))} /> <b>{l}</b></span>
              <small>{has[k] || 'Không có trong file'}</small>
            </label>
          })}
        </div>
        {cards.includes('info') && d.info.objectives && <details><summary>Mục tiêu</summary><p className="pre">{d.info.objectives}</p></details>}
        {cards.includes('content') && d.plan && (d.plan.steps.length > 0 || Object.keys(d.plan.sections).length > 0) && (
          <details open><summary>Giáo án sẽ tạo ({d.plan.steps.length} hoạt động)</summary>
            {Object.keys(d.plan.sections).length > 0 && <p className="sub">Các mục: {Object.keys(d.plan.sections).join(' · ')}</p>}
            {d.plan.steps.length > 0 && <div className="wrap"><table><thead><tr><th>#</th><th>Giai đoạn</th><th>Hoạt động</th><th>Phút</th></tr></thead>
              <tbody>{d.plan.steps.map((x, i) => <tr key={i}><td>{i + 1}</td><td>{x.phase ?? ''}</td><td>{x.title}{x.goal && <><br /><small className="sub">Mục tiêu: {x.goal}</small></>}</td><td>{x.minutes ?? ''}</td></tr>)}</tbody></table></div>}
          </details>)}
        {cards.includes('content') && d.slides && d.slides.length > 0 && (
          <details open><summary>Bài giảng sẽ tạo ({d.slides.length} slide)</summary>
            <ol className="kitslides">{d.slides.map((x, i) => <li key={i}><b>{x.title || '(không tiêu đề)'}</b>{x.body && <small className="sub"> — {x.body.replace(/\n/g, ' ').slice(0, 120)}</small>}</li>)}</ol>
          </details>)}
        {cards.includes('links') && d.links.length > 0 && (
          <details open><summary>Học liệu sẽ thêm ({d.links.length})</summary>
            <div className="wrap"><table><thead><tr><th>Tên</th><th>Loại</th><th>Đường dẫn</th></tr></thead>
              <tbody>{d.links.map((x, i) => <tr key={i}><td>{x.title}</td><td>{MAT_LABEL[x.type] ?? x.type}</td><td><small className="sub">{x.url}</small></td></tr>)}</tbody></table></div>
          </details>)}
        {cards.includes('norms') && d.norms.rows.length > 0 && (
          <details open><summary>Vật tư sẽ thêm ({d.norms.rows.length})</summary>
            <div className="wrap"><table><thead><tr><th>Vật tư</th><th>Loại</th><th>Số lượng</th><th>Đơn vị</th></tr></thead>
              <tbody>{d.norms.rows.map((x, i) => <tr key={i}><td>{x.name}</td><td>{KIND_LABEL[x.kind]}</td><td>{x.qty}</td><td>{x.unit}</td></tr>)}</tbody></table></div>
          </details>)}
        {d.warnings.length > 0 && <ul className="kitwarn">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        {err && <p className="msg">{err}</p>}
        <div className="formactions">
          <button type="button" className="primary" disabled={busy || !cards.length} onClick={apply}>{busy ? 'Đang áp dụng…' : `Áp dụng ${cards.length} thẻ`}</button>
          {' '}<button type="button" disabled={busy} onClick={() => { setDraft(null); setErr('') }}>Chọn file khác</button>
          {' '}<button type="button" disabled={busy} onClick={onClose}>Huỷ</button>
        </div>
      </div>
    )
  }

  return (
    <div className="kitimport" style={{ gridColumn: '1 / -1' }}>
      <div className="bar small"><b>{fresh ? 'Tạo bộ học liệu' : 'Nhập vào bộ học liệu từ file'}</b>
        {!fresh && <button type="button" className="linkbtn" onClick={onClose}>Đóng</button>}</div>
      <div className="kitways">
        {fresh && <div className="kitway"><b>1. Tự soạn từng thẻ</b><small className="sub">Điền thông tin, giáo án, học liệu và vật tư ngay trong form bên dưới.</small>
          <div><button type="button" onClick={onClose}>Soạn trong form</button></div></div>}
        <div className="kitway"><b>{fresh ? '2. ' : ''}Tải giáo án Word / PowerPoint để tách tự động</b>
          <small className="sub">Giáo án .docx được tách thành mục tiêu, hoạt động dạy học, vật tư (dòng như “Dây thun: 4 sợi” hoặc bảng có cột số lượng) và đường dẫn. Bài giảng .pptx thành slide. Tệp gốc dưới 50 MB được đính kèm.</small>
          <div>{pickFile('.docx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Chọn file .docx / .pptx', true)}</div></div>
        <div className="kitway"><b>{fresh ? '3. Không có giáo án? ' : ''}Dùng file mẫu Excel</b>
          <small className="sub">File mẫu có 5 sheet đúng 5 thẻ. Dòng bắt đầu bằng “VD:” là ví dụ, được bỏ qua khi đọc.</small>
          <div className="tools"><button type="button" onClick={template}>Tải file mẫu</button>{pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Tải file đã điền')}</div></div>
      </div>
      {err && <p className="msg">{err}</p>}
    </div>
  )
}
