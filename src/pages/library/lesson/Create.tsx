// "Tạo giáo án" theo video demo: 3 cách — tải giáo án từ nguồn (Word, PowerPoint) · tự tạo giáo án trống · dùng file mẫu Excel 4 sheet.
import { useState, type ReactNode } from 'react'
import { downloadWorkbook } from '../../../lib/sheet'
import { templateSheets, type KitDraft } from '../../../lib/kitImport'
import { kitCounts, type ParseResult } from './model'
import { parseFile, fileDoc, saveNewKit, type KitRow } from './save'

export type ProgRef = { id: string; code: string | null; title: string; ct_code: string | null }
type Parsed = { file: File; draft: KitDraft; res: ParseResult }

export function Modal({ title, sub, onClose, children, foot, wide }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  return (
    <div className="modalbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal lmodal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modalhead"><div><h3>{title}</h3>{sub && <small>{sub}</small>}</div>
          <button type="button" className="x linkbtn" aria-label="Đóng" onClick={onClose}>✕</button></div>
        <div className="modalbody">{children}</div>
        {foot && <div className="modalfoot">{foot}</div>}
      </div>
    </div>
  )
}

/** Tóm tắt phần đọc được của một giáo án (thẻ ở modal "Tài liệu bài học") */
function ParsedCard({ p }: { p: Parsed }) {
  const { res, draft } = p
  const c = kitCounts(res.kit)
  if (draft.source === 'pptx') {
    const d = draft.deck
    const tiet = (d?.outline ?? []).filter(x => /^tiết \d/i.test(x)).length || res.periods
    return <div className="lparsed"><b>{p.file.name}</b>
      <small>{[d && `${d.slides} slide`, tiet && `${tiet} tiết`, d?.outline.length && `${d.outline.length} mốc dàn ý`, d?.notes && `${d.notes} slide có lời dẫn`].filter(Boolean).join(' · ')}</small></div>
  }
  const head = [res.subject, res.grades && `Khối ${res.grades}`, res.periods && `${res.periods} tiết`, c.sessions && `${c.sessions} buổi`].filter(Boolean).join(' · ')
  const nums: [number, string][] = [[c.acts, 'hoạt động'], [c.reqs, 'yêu cầu'], [c.supplies, 'vật liệu'], [c.tools, 'thiết bị'], [c.docs, 'tài liệu']]
  return <div className="lparsed"><b>{(res.title ?? p.file.name).toUpperCase()}</b>{head && <small>{head}</small>}
    <div className="lnums">{nums.map(([n, l]) => <span key={l}><b>{n}</b> {l}</span>)}</div></div>
}

/** Văn bản gốc đã đọc (các mục và hoạt động), để đối chiếu */
function RawText({ d }: { d: KitDraft }) {
  const parts: [string, string][] = [
    ...Object.entries(d.info).filter(([, v]) => v).map(([k, v]) => [k, String(v)] as [string, string]),
    ...Object.entries(d.plan?.sections ?? {}),
    ...(d.plan?.steps ?? []).map(s => [`${s.phase ? s.phase + ' · ' : ''}${s.title}${s.minutes ? ` (${s.minutes} phút)` : ''}`, s.note ?? ''] as [string, string]),
    ...(d.slides ?? []).map((s, i) => [`Slide ${i + 1}: ${s.title}`, s.body] as [string, string]),
  ]
  return <div className="lraw">{parts.map(([h, t], i) => <div key={i}><b>{h}</b>{t && <p className="pre">{t}</p>}</div>)}</div>
}

export function CreateLesson({ orgId, programs, subjectsOf, program, subject, preset, kits, onClose, onCreated }: {
  orgId: string; programs: ProgRef[]; subjectsOf: (pid: string) => string[]
  program: ProgRef; subject: string
  /** Bài trong chương trình chưa có bộ học liệu: tạo bộ cho bài này */
  preset?: { title: string; unitId: string } | null
  kits: KitRow[]; onClose: () => void; onCreated: (id: string, msg: string) => void
}) {
  const [step, setStep] = useState<'menu' | 'upload' | 'blank' | 'template' | 'check'>('menu')
  const [pid, setPid] = useState(program.id)
  const [subj, setSubj] = useState(subject)
  const [docx, setDocx] = useState<Parsed | null>(null)
  const [pptx, setPptx] = useState<Parsed | null>(null)
  const [xlsx, setXlsx] = useState<Parsed | null>(null)
  const [name, setName] = useState(preset?.title ?? '')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const prog = programs.find(p => p.id === pid) ?? program
  const subs = subjectsOf(pid)
  const crumb = `${prog.code ? prog.code + ' · ' : ''}${prog.title} › ${subj}`
  const same = (t: string | undefined) => {
    const n = (t ?? '').trim().toLowerCase(); if (!n) return null
    return kits.find(k => k.program_id === pid && k.title.trim().toLowerCase() === n && (kitSubject(k) ?? '').toLowerCase() === subj.toLowerCase()) ?? null
  }

  async function read(f: File, set: (p: Parsed) => void) {
    setErr(''); setBusy('Đang đọc ' + f.name + '…')
    try { const { draft, res } = await parseFile(f); set({ file: f, draft, res }) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  async function save(parsed: Parsed[], title: string) {
    if (!title.trim()) return setErr('Nhập tên bài học.')
    setErr(''); setBusy('Đang lưu…')
    try {
      const docs = []
      for (const p of parsed.filter(p => p.draft.source !== 'xlsx')) { setBusy('Đang tải lên ' + p.file.name + '…'); docs.push(await fileDoc(orgId, p.file, p.draft)) }
      const existing = same(title)
      const r = await saveNewKit({ orgId, program: { id: prog.id, ct_code: prog.ct_code }, progSubject: subj, title, unitId: preset?.unitId ?? null,
        parsed: parsed.map(p => p.res), docs, existing })
      setBusy('')
      if (r.error) return setErr(r.error)
      const big = docs.filter(d => !d.file).map(d => d.file_name)
      onCreated(r.id!, (existing ? `Đã cập nhật bài “${title}”.` : `Đã tạo bài “${title}”.`)
        + (big.length ? ` Tệp ${big.join(', ')} lớn hơn giới hạn tải lên nên chưa đính kèm: thêm đường dẫn Drive ở thẻ 03.` : ''))
    } catch (e) { setBusy(''); setErr(e instanceof Error ? e.message : String(e)) }
  }
  const fileBtn = (accept: string, label: string, on: (f: File) => void, chosen?: string) => (
    <label className="lfile"><span className="filebtn">{label}</span><small>{chosen ?? 'Chưa chọn tệp'}</small>
      <input type="file" hidden accept={accept} disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; if (f) on(f); e.target.value = '' }} /></label>
  )
  const status = <>{busy && <p className="sub" role="status">{busy}</p>}{err && <p className="msg">{err}</p>}</>

  if (step === 'menu') return (
    <Modal title="Tạo giáo án" sub={crumb} onClose={onClose} foot={<button type="button" onClick={onClose}>Hủy</button>}>
      <div className="lways">
        {([['upload', 'Tải giáo án từ nguồn', 'Tệp Word (.docx), bài giảng PowerPoint. Hệ thống tách thành bộ học liệu 4 thẻ.'],
           ['blank', 'Tự tạo giáo án', 'Mở trang giáo án trống: có sẵn khung 4 thẻ để điền trực tiếp.'],
           ['template', 'Không có giáo án? Dùng file mẫu', 'Tải file Excel mẫu (4 sheet), điền rồi tải lên để hệ thống tự điền 4 thẻ.']] as const).map(([k, t, d], i) =>
          <button key={k} type="button" className="lway" onClick={() => setStep(k)}><i>{i + 1}</i><span><b>{t}</b><small>{d}</small></span></button>)}
      </div>
    </Modal>
  )

  if (step === 'blank') return (
    <Modal title="Tạo giáo án" sub={crumb} onClose={onClose}
      foot={<><button type="button" onClick={() => setStep('menu')}>← Quay lại</button>
        <button type="button" className="primary" disabled={!!busy} onClick={() => save([], name)}>Tạo giáo án trống</button></>}>
      <label className="field"><span>Tên bài học</span><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Cột đèn giao thông xoay"
        onKeyDown={e => { if (e.key === 'Enter') save([], name) }} /></label>
      {same(name) && <p className="sub">Đã có bài học cùng tên trong môn này: tạo sẽ mở lại bài đó, không tạo bản trùng.</p>}
      {status}
    </Modal>
  )

  if (step === 'template' || step === 'check') {
    if (step === 'check' && xlsx) {
      const k = xlsx.res.kit, c = kitCounts(k), t = xlsx.res.title || preset?.title || ''
      const infoN = [xlsx.res.title, xlsx.res.subject, xlsx.res.grades, xlsx.res.periods, k.info.reqs.length, k.info.description].filter(Boolean).length
      const rows: [string, string, string][] = [
        ['Thẻ 01', 'Thông tin bài học', `${infoN} mục thông tin`],
        ['Thẻ 02', 'Nội dung bài học', `${c.sessions} buổi · ${c.acts} hoạt động · ${c.steps} bước`],
        ['Thẻ 03', 'Link học liệu', `${c.docs} tài liệu`],
        ['Thẻ 04', 'Định mức vật tư', `${c.supplies} nguyên vật liệu · ${c.tools} công cụ, thiết bị`]]
      return (
        <Modal title="Kiểm tra file" sub={xlsx.file.name} onClose={onClose}
          foot={<><button type="button" onClick={() => { setXlsx(null); setStep('template') }}>Hủy</button>
            <button type="button" className="primary" disabled={!!busy || !t} onClick={() => save([xlsx], t)}>Tạo giáo án và điền</button></>}>
          <div className="lcheck">{rows.map(([a, b, n]) => <div key={a}><span><b>{a}</b> · {b}</span><span className="distchip2 good">{n}</span></div>)}</div>
          {!t && <p className="lwarn">Sheet “01 Thông tin” chưa có tên bài học. Điền dòng “Tên bài học” rồi tải lại.</p>}
          {k.issues.length > 0 && <ul className="lwarn">{k.issues.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {same(t) && <p className="sub">Đã có bài học cùng tên: lưu sẽ cập nhật bài đó, không tạo bản trùng.</p>}
          {status}
        </Modal>
      )
    }
    const tpl = () => downloadWorkbook(`Mau-giao-an${preset?.title ? '-' + preset.title.slice(0, 40) : ''}.xlsx`,
      templateSheets(preset?.title ?? '').map(s => ({ name: s.name, columns: s.header.map(h => ({ key: h, label: h, width: Math.max(14, h.length + 6) })), rows: s.rows })))
    return (
      <Modal title="Tạo giáo án" sub={crumb} onClose={onClose} foot={<button type="button" onClick={() => setStep('menu')}>← Quay lại</button>}>
        <div className="lways">
          <button type="button" className="lway" onClick={tpl}><i>1</i><span><b>Tải file mẫu giáo án</b>
            <small>Excel 4 sheet đúng 4 thẻ: Thông tin, Nội dung bài học, Link học liệu, Định mức vật tư. Dòng bắt đầu bằng “VD:” là ví dụ.</small></span></button>
          <label className="lway"><i>2</i><span><b>Tải file đã điền lên</b><small>Hệ thống kiểm tra file và cho xem trước số mục của từng thẻ trước khi tạo.</small></span>
            <input type="file" hidden accept=".xlsx" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; if (f) read(f, p => { setXlsx(p); setStep('check') }); e.target.value = '' }} /></label>
        </div>
        {status}
      </Modal>
    )
  }

  // Tải giáo án từ nguồn
  const title = docx?.res.title || pptx?.res.title || preset?.title || ''
  const issues = [...(docx?.res.kit.issues ?? []), ...(pptx?.res.kit.issues ?? [])]
  const dup = same(title)
  return (
    <Modal wide title="Tài liệu bài học" sub="Tải giáo án Word để hệ thống tách thành bộ học liệu 4 thẻ. Dữ liệu chỉ lưu khi bấm lưu, không tự phát hành." onClose={onClose}
      foot={<><button type="button" onClick={onClose}>Hủy</button>
        <button type="button" className="primary" disabled={!!busy || !(docx || pptx)} onClick={() => save([docx, pptx].filter(Boolean) as Parsed[], title)}>Lưu bản tách nháp</button></>}>
      <div className="lsrc" role="tablist">
        <button type="button" role="tab" aria-selected="true" className="on"><b>Tệp giáo án (.docx)</b><small>Đọc theo mẫu giáo án KDI, không dùng AI</small></button>
        <button type="button" role="tab" aria-selected="false" disabled><b>Google Sheet / Drive</b><small>Sắp có</small></button>
        <button type="button" role="tab" aria-selected="false" disabled><b>Kohota LMS</b><small>Sắp có</small></button>
      </div>
      <div className="formgrid lgrid2">
        <label className="field"><span>Chương trình</span>
          <select value={pid} onChange={e => { setPid(e.target.value); setSubj(subjectsOf(e.target.value)[0] ?? '') }}>
            {programs.map(p => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.title}</option>)}</select></label>
        <label className="field"><span>Môn học trong chương trình</span>
          <select value={subj} onChange={e => setSubj(e.target.value)}>{(subs.includes(subj) ? subs : [subj, ...subs]).map(s => <option key={s}>{s}</option>)}</select></label>
        <div className="field"><span>Giáo án (.docx)</span>{fileBtn('.docx', 'Chọn tệp', f => read(f, setDocx), docx?.file.name)}</div>
        <div className="field"><span>Bài giảng (.pptx) · không bắt buộc</span>{fileBtn('.pptx', 'Chọn tệp', f => read(f, setPptx), pptx?.file.name)}</div>
      </div>
      {docx && <ParsedCard p={docx} />}
      {pptx && <ParsedCard p={pptx} />}
      {issues.length > 0 && <div className="lwarn"><b>{issues.length} điểm cần kiểm tra</b><ul>{issues.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {dup && <p className="sub">Đã có bài học cùng tên: <b>{dup.title}</b>. Lưu sẽ cập nhật bài học đó, không tạo bản trùng.</p>}
      {(docx || pptx) && <details className="lrawwrap"><summary>Xem toàn bộ văn bản gốc đã đọc</summary>{docx && <RawText d={docx.draft} />}{pptx && <RawText d={pptx.draft} />}</details>}
      {status}
    </Modal>
  )
}

/** Môn trong chương trình của một bộ học liệu */
export const kitSubject = (k: KitRow) => {
  const c = k.content.kit as { info?: { prog_subject?: string } } | undefined
  return c?.info?.prog_subject || k.subject
}
