import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { norm, downloadXlsx, type Column } from '../../lib/sheet'
import ImportExcel from '../../components/ImportExcel'
import AssistantQuiz from './AiQuiz'
import { LEVEL, QKIND, letter, errText, type Level, type QKind, type Question } from './common'

// Ngân hàng câu hỏi: soạn tay, nhập Excel, tạo bằng Trợ lý AI; duyệt (Nháp → Sẵn sàng), dùng chung cho đơn vị trực thuộc.
const COLS: Column[] = [
  { key: 'subject', label: 'Môn', required: true }, { key: 'grade', label: 'Khối' }, { key: 'topic', label: 'Chủ đề', width: 24 },
  { key: 'level', label: 'Mức độ', aliases: ['Mức'] }, { key: 'stem', label: 'Câu hỏi', required: true, width: 50 },
  { key: 'a', label: 'A', width: 20 }, { key: 'b', label: 'B', width: 20 }, { key: 'c', label: 'C', width: 20 }, { key: 'd', label: 'D', width: 20 },
  { key: 'e', label: 'E' }, { key: 'f', label: 'F' },
  { key: 'answer', label: 'Đáp án', required: true, aliases: ['Đáp án đúng'] }, { key: 'explain', label: 'Giải thích', width: 40 },
]
const LV_IN: Record<string, Level> = { 'nhan biet': 'nhan_biet', 'thong hieu': 'thong_hieu', 'van dung': 'van_dung', 'van dung cao': 'van_dung_cao', nb: 'nhan_biet', th: 'thong_hieu', vd: 'van_dung', vdc: 'van_dung_cao' }
type Form = { id?: string; subject: string; grade: string; topic: string; level: Level; kind: QKind; stem: string; options: string[]; answer: number[]; explain: string; shared: boolean; status: Question['status'] }
const EMPTY: Form = { subject: '', grade: '', topic: '', level: 'thong_hieu', kind: 'single', stem: '', options: ['', '', '', ''], answer: [0], explain: '', shared: false, status: 'ready' }

export default function QuestionBank({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Question[]>([])
  const [orgType, setOrgType] = useState('school')
  const [orgNames, setOrgNames] = useState<Map<string, string>>(new Map())
  const [me, setMe] = useState<string | null>(null)
  const [f, setF] = useState({ q: '', subject: '', grade: '', level: '', status: '' })
  const [form, setForm] = useState<Form | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [ai, setAi] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)

  async function load() {
    const [q, o, u] = await Promise.all([supabase.from('question_bank').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('organizations').select('id, name, type'), supabase.auth.getUser()])
    if (q.error) setMsg([errText(q.error.message), true])
    setRows((q.data as Question[]) ?? []); setMe(u.data.user?.id ?? null)
    const os = (o.data as any[]) ?? []; setOrgNames(new Map(os.map(x => [x.id, x.name]))); setOrgType(os.find(x => x.id === orgId)?.type ?? 'school')
  }
  useEffect(() => { load() }, [orgId])

  const subjects = [...new Set(rows.map(r => r.subject))].sort((a, b) => a.localeCompare(b, 'vi'))
  const needle = norm(f.q.trim().toLowerCase())
  const list = rows.filter(r => (!f.subject || r.subject === f.subject) && (!f.grade || String(r.grade) === f.grade) && (!f.level || r.level === f.level)
    && (!f.status || r.status === f.status) && (!needle || norm(`${r.stem} ${r.topic ?? ''}`.toLowerCase()).includes(needle)))
  const mine = (r: Question) => r.org_id === orgId

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const options = form.kind === 'truefalse' ? ['Đúng', 'Sai'] : form.options.map(o => o.trim()).filter(Boolean)
    if (options.length < 2) return setMsg(['Cần ít nhất 2 lựa chọn.', true])
    const answer = form.answer.filter(i => i < options.length)
    if (!answer.length) return setMsg(['Chọn đáp án đúng.', true])
    const body = { subject: form.subject.trim(), grade: form.grade ? Number(form.grade) : null, topic: form.topic.trim() || null, level: form.level, kind: form.kind,
      stem: form.stem.trim(), options, answer: form.kind === 'multi' ? answer : [answer[0]], explain: form.explain.trim() || null, shared: form.shared, status: form.status }
    const { error } = form.id ? await supabase.from('question_bank').update(body).eq('id', form.id) : await supabase.from('question_bank').insert({ ...body, org_id: orgId })
    if (error) return setMsg([errText(error.message), true])
    setMsg([form.id ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi.', false]); setForm(null); load()
  }
  async function setStatus(ids: string[], status: Question['status']) {
    const { error } = await supabase.from('question_bank').update({ status }).in('id', ids)
    setMsg(error ? [errText(error.message), true] : [`Đã chuyển ${ids.length} câu sang "${status === 'ready' ? 'Sẵn sàng' : status === 'retired' ? 'Ngừng dùng' : 'Nháp'}".`, false]); load()
  }
  async function remove(r: Question) {
    if (!confirm('Xoá câu hỏi này? Đề cố định đang dùng câu này sẽ bỏ qua nó.')) return
    const { error } = await supabase.from('question_bank').delete().eq('id', r.id)
    if (error) setMsg([errText(error.message), true]); else load()
  }
  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = []
    const ins = recs.flatMap(r => {
      const opts = [r.a, r.b, r.c, r.d, r.e, r.f].map(x => (x ?? '').trim()).filter(Boolean)
      const ans = [...(r.answer ?? '').toUpperCase().replace(/[^A-F]/g, '')].map(c => c.charCodeAt(0) - 65)
      const tf = opts.length === 0 && /^(Đ|ĐÚNG|S|SAI|DUNG)$/i.test((r.answer ?? '').trim())
      if (!tf && (opts.length < 2 || !ans.length || ans.some(i => i >= opts.length))) { bad.push(`dòng ${r._line}: thiếu lựa chọn hoặc đáp án`); return [] }
      const g = Number((r.grade ?? '').replace(/\D/g, ''))
      return [{ org_id: orgId, subject: r.subject.trim(), grade: g >= 1 && g <= 12 ? g : null, topic: r.topic?.trim() || null,
        level: LV_IN[norm((r.level ?? '').toLowerCase().trim())] ?? 'thong_hieu', kind: tf ? 'truefalse' : ans.length > 1 ? 'multi' : 'single',
        stem: r.stem.trim(), options: tf ? ['Đúng', 'Sai'] : opts, answer: tf ? [/^S/i.test(r.answer.trim()) ? 1 : 0] : [...new Set(ans)],
        explain: r.explain?.trim() || null, source: 'import', status: 'ready' }]
    })
    if (ins.length) { const { error } = await supabase.from('question_bank').insert(ins); if (error) return 'Lỗi: ' + errText(error.message) }
    load()
    return `Đã nhập ${ins.length} câu.` + (bad.length ? ` Bỏ qua ${bad.length}: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '…' : ''}` : '')
  }
  function exportExcel() {
    downloadXlsx('ngan-hang-cau-hoi', COLS, list.map(r => [r.subject, r.grade, r.topic, LEVEL[r.level], r.stem, ...Array.from({ length: 6 }, (_, i) => r.options[i] ?? ''),
      r.kind === 'truefalse' ? (r.answer[0] === 0 ? 'Đúng' : 'Sai') : r.answer.map(letter).join(''), r.explain]))
  }

  const drafts = list.filter(r => r.status === 'draft' && mine(r))
  return (
    <>
      <div className="cards syscards">
        <div className="card"><strong>{rows.length}</strong><span>Câu hỏi dùng được</span></div>
        <div className="card"><strong>{rows.filter(r => r.status === 'ready').length}</strong><span>Sẵn sàng đưa vào đề</span></div>
        <div className="card"><strong>{rows.filter(r => r.status === 'draft').length}</strong><span>Nháp (chờ duyệt)</span></div>
        <div className="card"><strong>{rows.filter(r => !mine(r)).length}</strong><span>Dùng chung từ cấp trên</span></div>
      </div>
      <div className="bar" style={{ marginTop: 14 }}>
        <span className="tools">
          <button className="primary" onClick={() => { setForm({ ...EMPTY, shared: orgType !== 'school' }); setAi(false) }}>Thêm câu hỏi</button>
          <button onClick={() => { setAi(!ai); setForm(null) }}>{ai ? 'Đóng Trợ lý AI' : 'Tạo bằng Trợ lý AI'}</button>
          <ImportExcel columns={COLS} template="mau-ngan-hang-cau-hoi" onRecords={importRecords} onMessage={(m, bad) => setMsg([m, !!bad])}
            sample={[['Khoa học tự nhiên', '7', 'Mạch điện', 'Nhận biết', 'Đơn vị đo cường độ dòng điện là gì?', 'Vôn', 'Ampe', 'Ôm', 'Oát', '', '', 'B', 'Cường độ dòng điện đo bằng ampe (A).'],
              ['Công nghệ', '8', 'An toàn điện', 'Thông hiểu', 'Chọn các việc làm an toàn khi sửa điện', 'Ngắt cầu dao', 'Dùng tay ướt', 'Đi dép cao su', 'Chạm dây trần', '', '', 'AC', '']]} />
          <button onClick={exportExcel} disabled={!list.length}>Xuất Excel</button>
        </span>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {ai && <div className="panel"><AssistantQuiz orgId={orgId} onSaved={load} /></div>}
      {form && <QuestionForm form={form} setForm={setForm} onSubmit={save} canShare={orgType !== 'school'} />}
      <div className="bar" style={{ margin: '12px 0' }}>
        <span className="tools">
          <input className="search" style={{ margin: 0, minWidth: 220 }} type="search" placeholder="Tìm câu hỏi, chủ đề…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} aria-label="Tìm câu hỏi" />
          <select value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
          <select value={f.grade} onChange={e => setF({ ...f, grade: e.target.value })} aria-label="Khối"><option value="">Mọi khối</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Khối {i + 1}</option>)}</select>
          <select value={f.level} onChange={e => setF({ ...f, level: e.target.value })} aria-label="Mức độ"><option value="">Mọi mức độ</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} aria-label="Trạng thái"><option value="">Mọi trạng thái</option><option value="ready">Sẵn sàng</option><option value="draft">Nháp</option><option value="retired">Ngừng dùng</option></select>
        </span>
        {drafts.length > 0 && <button onClick={() => setStatus(drafts.map(d => d.id), 'ready')}>Duyệt {drafts.length} câu nháp đang lọc</button>}
      </div>
      <div className="wrap"><table className="systable">
        <thead><tr><th>Câu hỏi</th><th>Môn · khối</th><th>Mức độ</th><th>Loại</th><th>Nguồn</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {list.slice(0, 300).map(r => <Fragment key={r.id}>
            <tr className="clickrow" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <td style={{ whiteSpace: 'normal', maxWidth: 460 }}><b>{r.stem.length > 140 ? r.stem.slice(0, 140) + '…' : r.stem}</b>{r.topic && <><br /><small>{r.topic}</small></>}</td>
              <td>{r.subject}{r.grade ? ` · ${r.grade}` : ''}</td><td>{LEVEL[r.level]}</td><td>{QKIND[r.kind]}</td>
              <td><small>{!mine(r) ? orgNames.get(r.org_id) ?? 'Cấp trên' : r.source === 'ai' ? 'Trợ lý AI' : r.source === 'import' ? 'Nhập Excel' : 'Soạn tay'}{r.shared && mine(r) ? ' · dùng chung' : ''}</small></td>
              <td><span className={'pill ' + (r.status === 'ready' ? 'active' : r.status === 'draft' ? 'maintenance' : 'inactive')}>{r.status === 'ready' ? 'Sẵn sàng' : r.status === 'draft' ? 'Nháp' : 'Ngừng dùng'}</span></td>
            </tr>
            {open === r.id && <tr><td colSpan={6}>
              <ol className="qopts" type="A">{r.options.map((o, i) => <li key={i} className={r.answer.includes(i) ? 'right' : ''}>{o}</li>)}</ol>
              {r.explain && <p className="sub">Giải thích: {r.explain}</p>}
              {mine(r) && <div className="tools">
                <button onClick={() => setForm({ id: r.id, subject: r.subject, grade: r.grade ? String(r.grade) : '', topic: r.topic ?? '', level: r.level, kind: r.kind, stem: r.stem,
                  options: [...r.options, ...Array(Math.max(0, 4 - r.options.length)).fill('')], answer: r.answer, explain: r.explain ?? '', shared: r.shared, status: r.status })}>Sửa</button>
                {r.status !== 'ready' && <button onClick={() => setStatus([r.id], 'ready')}>Duyệt — Sẵn sàng</button>}
                {r.status !== 'retired' && <button onClick={() => setStatus([r.id], 'retired')}>Ngừng dùng</button>}
                {(r.created_by === me) && <button className="xbtn" onClick={() => remove(r)}>Xoá</button>}
              </div>}
            </td></tr>}
          </Fragment>)}
          {!list.length && <tr><td colSpan={6}>Chưa có câu hỏi. Thêm tay, nhập Excel theo file mẫu, hoặc tạo bằng Trợ lý AI.</td></tr>}
        </tbody>
      </table></div>
      {list.length > 300 && <p className="sub">Hiện 300/{list.length} câu — lọc để thu hẹp.</p>}
    </>
  )
}

function QuestionForm({ form, setForm, onSubmit, canShare }: { form: Form; setForm: (f: Form | null) => void; onSubmit: (e: React.FormEvent) => void; canShare: boolean }) {
  const set = (p: Partial<Form>) => setForm({ ...form, ...p })
  const opts = form.kind === 'truefalse' ? ['Đúng', 'Sai'] : form.options
  const toggle = (i: number) => set({ answer: form.kind === 'multi' ? (form.answer.includes(i) ? form.answer.filter(x => x !== i) : [...form.answer, i]) : [i] })
  return (
    <form className="panel formgrid" onSubmit={onSubmit}>
      <label className="field"><span>Môn *</span><input required value={form.subject} onChange={e => set({ subject: e.target.value })} /></label>
      <label className="field"><span>Khối</span><input type="number" min={1} max={12} value={form.grade} onChange={e => set({ grade: e.target.value })} /></label>
      <label className="field"><span>Chủ đề</span><input value={form.topic} onChange={e => set({ topic: e.target.value })} /></label>
      <label className="field"><span>Mức độ</span><select value={form.level} onChange={e => set({ level: e.target.value as Level })}>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Loại câu</span><select value={form.kind} onChange={e => set({ kind: e.target.value as QKind, answer: [0] })}>{Object.entries(QKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Trạng thái</span><select value={form.status} onChange={e => set({ status: e.target.value as Form['status'] })}><option value="ready">Sẵn sàng</option><option value="draft">Nháp</option><option value="retired">Ngừng dùng</option></select></label>
      <label className="field wide"><span>Câu hỏi *</span><textarea required rows={3} value={form.stem} onChange={e => set({ stem: e.target.value })} /></label>
      <div className="field wide"><span>Lựa chọn — đánh dấu {form.kind === 'multi' ? 'các' : ''} đáp án đúng</span>
        <div className="optedit">{opts.map((o, i) => <label key={i}>
          <input type={form.kind === 'multi' ? 'checkbox' : 'radio'} name="ans" checked={form.answer.includes(i)} onChange={() => toggle(i)} aria-label={'Đáp án ' + letter(i)} />
          <b>{letter(i)}</b>
          <input value={o} disabled={form.kind === 'truefalse'} onChange={e => { const x = [...form.options]; x[i] = e.target.value; set({ options: x }) }} aria-label={'Lựa chọn ' + letter(i)} />
        </label>)}</div>
        {form.kind !== 'truefalse' && form.options.length < 8 && <button type="button" className="xbtn" onClick={() => set({ options: [...form.options, ''] })}>+ Thêm lựa chọn</button>}
      </div>
      <label className="field wide"><span>Giải thích (hiện cho học sinh khi xem đáp án)</span><textarea rows={2} value={form.explain} onChange={e => set({ explain: e.target.value })} /></label>
      {canShare && <label className="field inline wide"><input type="checkbox" checked={form.shared} onChange={e => set({ shared: e.target.checked })} /> Dùng chung cho các đơn vị trực thuộc</label>}
      <div className="actions wide"><button className="primary">{form.id ? 'Cập nhật' : 'Thêm câu hỏi'}</button><button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
    </form>
  )
}
