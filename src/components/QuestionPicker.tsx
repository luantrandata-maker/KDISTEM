// Câu hỏi của đề (bài test nội dung, đề cuối khoá, đề luyện): làm giống "Thêm bài" của chương trình giáo dục.
// Bảng câu đã chọn; thêm câu bằng 3 cách: chọn từ ngân hàng (lọc sẵn theo môn, chủ đề của đề), gõ câu mới ở dòng cuối
// (hoặc soạn chi tiết), nhập Excel theo file mẫu. Câu mới / nhập Excel được lưu vào ngân hàng câu hỏi rồi đưa vào đề.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'
import { Drawer } from './Drawer'
import ImportExcel from './ImportExcel'
import { COLS, EMPTY, SAMPLE, QuestionForm, formBody, toBankRows, type Form } from '../pages/elearning/Bank'
import { LEVEL, QKIND, errText, letter, qGrades, type Level, type Question } from '../pages/elearning/common'

type Q = Question
const short = (s: string, n = 180) => (s.length > n ? s.slice(0, n) + '…' : s)
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

export function QuestionPicker({ value, onChange, subjects = [], grades = [], topic = '', edit = true, title = 'Câu hỏi của đề', note }: {
  value: string[]; onChange: (ids: string[]) => void; subjects?: string[]; grades?: number[]; topic?: string; edit?: boolean; title?: string; note?: string
}) {
  const [bank, setBank] = useState<Q[] | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [pick, setPick] = useState(false)
  const [full, setFull] = useState<Form | null>(null)
  const [nd, setNd] = useState({ subject: subjects[0] ?? '', stem: '', opts: '', ans: '', level: 'thong_hieu' as Level })
  const [busy, setBusy] = useState(false)
  const load = () => supabase.from('question_bank').select('*').neq('status', 'retired').order('subject').order('created_at', { ascending: false }).limit(3000)
    .then(({ data, error }) => { if (error) setErr(errText(error.message)); else setBank((data as Q[]) ?? []) })
  useEffect(() => { load() }, [])
  useEffect(() => { if (!nd.subject && subjects[0]) setNd(x => ({ ...x, subject: subjects[0] })) }, [subjects.join('|')])
  const byId = useMemo(() => new Map((bank ?? []).map(b => [b.id, b])), [bank])
  const rows = value.map(id => byId.get(id)).filter(Boolean) as Q[]
  const missing = bank ? value.length - rows.length : 0
  const add = (ids: string[]) => onChange([...value, ...ids.filter(id => !value.includes(id))])

  // Lưu câu mới vào ngân hàng rồi đưa vào đề
  async function insert(recs: Record<string, unknown>[]) {
    const org = await myOrgId().catch(() => null)
    const { data, error } = await supabase.from('question_bank').insert(recs.map(r => ({ org_id: org, ...r }))).select('*')
    if (error) { setMsg([errText(error.message), true]); return null }
    const qs = (data as Q[]) ?? []
    setBank(b => [...qs, ...(b ?? [])]); add(qs.map(q => q.id))
    return qs
  }
  async function addInline() {
    const opts = nd.opts.split(/\s*[;\n]\s*/).map(x => x.trim()).filter(Boolean)
    const tf = !opts.length && /^(đ|đúng|dung|s|sai)$/i.test(nd.ans.trim())
    const ans = [...nd.ans.toUpperCase().replace(/[^A-H]/g, '')].map(c => c.charCodeAt(0) - 65)
    if (!nd.subject.trim()) return setMsg(['Nhập môn của câu hỏi.', true])
    if (!tf && opts.length < 2) return setMsg(['Nhập ít nhất 2 lựa chọn, ngăn cách bằng dấu chấm phẩy (;).', true])
    if (!tf && (!ans.length || ans.some(i => i >= opts.length))) return setMsg(['Đáp án là chữ cái của lựa chọn đúng, VD: B hoặc AC.', true])
    setBusy(true); setMsg(null)
    const ok = await insert([{ subject: nd.subject.trim(), grades, topic: topic.trim() || null, level: nd.level, kind: tf ? 'truefalse' : ans.length > 1 ? 'multi' : 'single',
      stem: nd.stem.trim(), options: tf ? ['Đúng', 'Sai'] : opts, answer: tf ? [/^s/i.test(nd.ans.trim()) ? 1 : 0] : [...new Set(ans)], explain: null, source: 'manual', status: 'ready', shared: false }])
    setBusy(false)
    if (ok) { setNd({ ...nd, stem: '', opts: '', ans: '' }); setMsg(['Đã thêm câu hỏi vào đề và ngân hàng câu hỏi.', false]); document.getElementById('qp-new-stem')?.focus() }
  }
  async function saveFull(e: React.FormEvent) {
    e.preventDefault(); if (!full) return
    const body = formBody(full)
    if (typeof body === 'string') return setMsg([body, true])
    if (await insert([{ ...body, source: 'manual' }])) { setFull(null); setMsg(['Đã thêm câu hỏi vào đề và ngân hàng câu hỏi.', false]) }
  }
  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    const { ins, bad } = toBankRows(recs.map(r => ({ ...r, subject: r.subject || subjects[0] || "", topic: r.topic || topic }) as unknown as typeof r), null)
    const qs = ins.length ? await insert(ins.map(({ org_id: _, ...r }) => r)) : []
    if (qs === null) return 'Không nhập được.'
    return `Đã thêm ${qs.length} câu vào đề và ngân hàng câu hỏi.` + (bad.length ? ` Bỏ qua ${bad.length}: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '…' : ''}` : '')
  }
  const move = (i: number, d: number) => { const x = [...value]; const j = i + d; if (j < 0 || j >= x.length) return; [x[i], x[j]] = [x[j], x[i]]; onChange(x) }

  return <div className="qpick">
    <div className="bar" style={{ margin: 0 }}>
      <b>{title} ({value.length})</b>
      {edit && <span className="tools">
        <button type="button" onClick={() => { setPick(true); setMsg(null) }}>Chọn từ ngân hàng</button>
        <button type="button" onClick={() => { setFull({ ...EMPTY, subject: nd.subject || subjects[0] || '', grades, topic }); setMsg(null) }}>Soạn câu chi tiết</button>
        <ImportExcel label="⇪ Nhập Excel" columns={COLS} template="Mau-cau-hoi-cua-de" sample={SAMPLE} onRecords={importRecords} onMessage={(m, bad) => setMsg([m, !!bad])} />
      </span>}
    </div>
    {note && <p className="sub" style={{ margin: 0 }}>{note}</p>}
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status" style={{ margin: 0 }}><b>{msg[0]}</b></p>}
    {missing > 0 && <p className="warnline">{missing} câu đã chọn không còn trong ngân hàng (đã xoá hoặc ngừng dùng).</p>}
    {err ? <p className="sub" role="alert">{err}</p> : !bank ? <p className="sub">Đang tải câu hỏi…</p> : <div className="wrap"><table className="libtable qptable">
      <thead><tr><th style={{ width: 44 }}>#</th><th>Câu hỏi</th><th style={{ width: 160 }}>Môn · chủ đề</th><th style={{ width: 110 }}>Mức độ</th>{edit && <th style={{ width: 96 }} />}</tr></thead>
      <tbody>{rows.map((b, i) => <tr key={b.id}>
        <td className="num">{i + 1}</td>
        <td style={{ whiteSpace: 'normal' }}>{short(b.stem, 220)}<br /><small className="sub">{b.options.map((o, k) => <span key={k} className={b.answer.includes(k) ? 'qpok' : ''}>{letter(k)}. {short(o, 40)}{k < b.options.length - 1 ? '  ' : ''}</span>)}</small></td>
        <td style={{ whiteSpace: 'normal' }}>{b.subject}{qGrades(b).length ? ` · khối ${qGrades(b).join(', ')}` : ''}{b.topic && <><br /><small className="sub">{b.topic}</small></>}</td>
        <td>{LEVEL[b.level] ?? b.level}</td>
        {edit && <td><span className="qprow">
          <button type="button" className="iconbtn" title="Lên" aria-label="Đưa câu lên" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="iconbtn" title="Xuống" aria-label="Đưa câu xuống" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="iconbtn abdanger" title="Bỏ khỏi đề" aria-label="Bỏ câu khỏi đề" onClick={() => onChange(value.filter(x => x !== b.id))}>✕</button></span></td>}
      </tr>)}
        {!rows.length && <tr><td colSpan={edit ? 5 : 4}><small className="sub">Đề chưa có câu hỏi.{edit ? ' Bấm “Chọn từ ngân hàng”, gõ câu mới ở dòng dưới, hoặc Nhập Excel theo file mẫu.' : ''}</small></td></tr>}</tbody>
      {edit && <tfoot><tr className="slnew"><td colSpan={5}><div className="slnewrow qpnew">
        <input className="qpsubj" value={nd.subject} list="qp-subjects" placeholder="Môn" aria-label="Môn của câu mới" onChange={e => setNd({ ...nd, subject: e.target.value })} />
        <input id="qp-new-stem" className="slnt" value={nd.stem} disabled={busy} placeholder="+ Câu hỏi mới" aria-label="Nội dung câu hỏi mới" onChange={e => setNd({ ...nd, stem: e.target.value })} />
        <input className="qpopts" value={nd.opts} disabled={busy} placeholder="Lựa chọn: A; B; C; D" aria-label="Các lựa chọn, ngăn cách bằng dấu chấm phẩy" onChange={e => setNd({ ...nd, opts: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInline() } }} />
        <input className="qpans" value={nd.ans} disabled={busy} placeholder="Đáp án" title="Chữ cái của lựa chọn đúng (VD: B, hoặc AC nếu nhiều đáp án); câu đúng/sai: gõ Đúng hoặc Sai và để trống lựa chọn" aria-label="Đáp án đúng"
          onChange={e => setNd({ ...nd, ans: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInline() } }} />
        <select value={nd.level} onChange={e => setNd({ ...nd, level: e.target.value as Level })} aria-label="Mức độ câu mới">{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="button" className="primary" disabled={busy || !nd.stem.trim()} onClick={addInline}>+ Thêm</button>
      </div><datalist id="qp-subjects">{[...new Set([...subjects, ...(bank ?? []).map(b => b.subject)])].map(s => <option key={s} value={s} />)}</datalist></td></tr></tfoot>}
    </table></div>}
    {pick && bank && <BankPick bank={bank} chosen={value} subjects={subjects} grades={grades} topic={topic} onClose={() => setPick(false)}
      onAdd={ids => { add(ids); setPick(false); setMsg([`Đã thêm ${ids.length} câu từ ngân hàng.`, false]) }} />}
    {full && <Drawer wide title="Soạn câu hỏi mới" onClose={() => setFull(null)} closeOnOutside={false}>
      <p className="sub" style={{ marginTop: 0 }}>Câu hỏi được lưu vào ngân hàng câu hỏi và đưa vào đề.</p>
      <QuestionForm form={full} setForm={setFull} onSubmit={saveFull} canShare={false} subjects={subjects} />
    </Drawer>}
  </div>
}

/** Chọn câu từ ngân hàng: lọc sẵn theo môn, khối, chủ đề của đề; tick nhiều câu rồi thêm vào đề */
function BankPick({ bank, chosen, subjects, grades, topic, onClose, onAdd }: {
  bank: Q[]; chosen: string[]; subjects: string[]; grades: number[]; topic: string; onClose: () => void; onAdd: (ids: string[]) => void
}) {
  const allSubj = useMemo(() => [...new Set(bank.map(b => b.subject))].sort((a, b) => a.localeCompare(b, 'vi')), [bank])
  const [subj, setSubj] = useState(subjects.find(s => allSubj.includes(s)) ?? '')
  const topics = useMemo(() => [...new Set(bank.filter(b => !subj || b.subject === subj).map(b => b.topic ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [bank, subj])
  const [top, setTop] = useState(topic && topics.includes(topic) ? topic : '')
  const [lv, setLv] = useState('')
  const [gOnly, setGOnly] = useState(grades.length > 0)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const taken = new Set(chosen)
  const shown = bank.filter(b => !taken.has(b.id) && (!subj || b.subject === subj) && (!top || b.topic === top) && (!lv || b.level === lv)
    && (!gOnly || !qGrades(b).length || qGrades(b).some(g => grades.includes(g))) && (!q || fold(b.stem + ' ' + (b.topic ?? '')).includes(fold(q)))).slice(0, 400)
  const allOn = shown.length > 0 && shown.every(b => sel.has(b.id))
  const tog = (id: string) => setSel(x => { const y = new Set(x); y.has(id) ? y.delete(id) : y.add(id); return y })
  return <Drawer wide title="Chọn câu hỏi từ ngân hàng" onClose={onClose} closeOnOutside={false}
    actions={<><button type="button" className="primary" disabled={!sel.size} onClick={() => onAdd([...sel])}>Thêm {sel.size || ''} câu vào đề</button><button type="button" onClick={onClose}>Huỷ</button></>}>
    <div className="tools" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
      <input placeholder="Tìm câu hỏi, chủ đề…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm câu hỏi" />
      <select value={subj} onChange={e => { setSubj(e.target.value); setTop('') }} aria-label="Môn"><option value="">Tất cả môn</option>{allSubj.map(s => <option key={s}>{s}</option>)}</select>
      <select value={top} onChange={e => setTop(e.target.value)} aria-label="Chủ đề"><option value="">Tất cả chủ đề</option>{topics.map(s => <option key={s}>{s}</option>)}</select>
      <select value={lv} onChange={e => setLv(e.target.value)} aria-label="Mức độ"><option value="">Tất cả mức độ</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {grades.length > 0 && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={gOnly} onChange={e => setGOnly(e.target.checked)} />Chỉ khối {grades.join(', ')}</label>}
      <small className="sub">{shown.length} câu{sel.size ? ` · đã tick ${sel.size}` : ''}</small>
    </div>
    <div className="wrap"><table className="libtable">
      <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={allOn} disabled={!shown.length} aria-label="Chọn tất cả câu đang hiện"
        onChange={() => setSel(x => { const y = new Set(x); shown.forEach(b => allOn ? y.delete(b.id) : y.add(b.id)); return y })} /></th>
        <th>Câu hỏi</th><th style={{ width: 160 }}>Môn · chủ đề</th><th style={{ width: 110 }}>Mức độ</th></tr></thead>
      <tbody>{shown.map(b => <tr key={b.id} className={sel.has(b.id) ? 'on' : ''} onClick={() => tog(b.id)} style={{ cursor: 'pointer' }}>
        <td><input type="checkbox" checked={sel.has(b.id)} onChange={() => tog(b.id)} onClick={e => e.stopPropagation()} aria-label="Chọn câu hỏi" /></td>
        <td style={{ whiteSpace: 'normal' }}>{short(b.stem, 220)}<br /><small className="sub">{QKIND[b.kind] ?? b.kind}{b.shared ? ' · dùng chung' : ''}</small></td>
        <td style={{ whiteSpace: 'normal' }}>{b.subject}{qGrades(b).length ? ` · khối ${qGrades(b).join(', ')}` : ''}{b.topic && <><br /><small className="sub">{b.topic}</small></>}</td>
        <td>{LEVEL[b.level] ?? b.level}</td></tr>)}
        {!shown.length && <tr><td colSpan={4}><small className="sub">{bank.length ? 'Không có câu nào khớp bộ lọc (câu đã có trong đề không hiện lại).' : 'Ngân hàng câu hỏi chưa có câu nào.'}</small></td></tr>}</tbody>
    </table></div>
  </Drawer>
}
