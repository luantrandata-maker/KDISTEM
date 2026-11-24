import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { StemTrack } from '../lib/stemTracks'
import { gradeName, useEduLevels } from '../lib/eduLevels'
import { frameErr, type ProgramModule, type ProgramTopic } from '../lib/programFrame'
import { SubjectMulti, SubjectPicker } from '../components/Pickers'

// Thông tin chung của một chủ đề (v71): phần xem (thẻ Học phần → Khối → Số tiết → Thứ tự bài → Mã, môn, sản phẩm, yêu cầu cần đạt)
// và form sửa. Dùng ở Khung chương trình (thêm / sửa chủ đề) và đầu trang chi tiết chủ đề (bấm ✎ để sửa tại chỗ).

export type TopicDraft = Omit<ProgramTopic, 'id'> & { id?: string }

export function TopicOverview({ t, module, textbook }: { t: ProgramTopic; module?: string; textbook?: boolean }) {
  const req = (t.objectives ?? '').split(/\n+/).map(x => x.replace(/^\s*[-–•*+]\s*/, '').trim()).filter(Boolean)
  const none = <span className="tcnone">Chưa nhập</span>
  return <div className="tcov">
    <div className="tctags">
      {module && <span>Học phần <b>{module}</b>{t.part ? ` · HP${t.part}` : ''}</span>}
      <span><b>{gradeName(t.grade)}</b></span><span><b>{t.periods}</b> tiết</span><span>Thứ tự bài <b>{t.seq}</b></span>
      {t.code && <span>Mã <b>{t.code}</b></span>}</div>
    <div className="tccards">
      <div><small>Môn chủ trì</small><b>{t.main_subject || none}</b></div>
      <div><small>Môn phối hợp</small>{t.subjects.length ? <span>{t.subjects.map(x => <i key={x} className="tcpill">{x}</i>)}</span> : none}</div>
      <div><small>Sản phẩm</small>{t.product ? <b style={{ whiteSpace: 'pre-line' }}>{t.product}</b> : none}</div>
    </div>
    <div className="tcreq"><small>Yêu cầu cần đạt{req.length ? ` (${req.length})` : ''}</small>
      {req.length ? <ul>{req.map((x, k) => <li key={k}>{x}</li>)}</ul> : none}</div>
    {textbook && t.textbook_ref && <div className="tcreq"><small>Bài SGK liên quan</small><p style={{ whiteSpace: 'pre-line' }}>{t.textbook_ref}</p></div>}
  </div>
}

export function TopicForm({ t, track, modules, nextSeq, onCancel, onSaved }: {
  t: TopicDraft; track?: StemTrack; modules?: ProgramModule[]; nextSeq?: (mod: string, g: number) => number; onCancel: () => void; onSaved: (next?: boolean) => void
}) {
  const [f, setFS] = useState<TopicDraft>({ ...t, subjects: [...t.subjects] })
  const [seqTouched, setSeqTouched] = useState(false)
  const [added, setAdded] = useState(0)   // số chủ đề đã lưu khi bấm "Lưu và thêm tiếp"
  // Thêm mới: đổi học phần / khối thì thứ tự bài tự lấy bài tiếp theo (trừ khi đã gõ tay)
  const setF = (x: TopicDraft) => setFS(!f.id && nextSeq && !seqTouched && (x.module_id !== f.module_id || x.grade !== f.grade) ? { ...x, seq: nextSeq(x.module_id, x.grade) } : x)
  const { grades } = useEduLevels()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const gradeList = useMemo(() => [...new Set([...grades, f.grade])].sort((a, b) => a - b), [grades, f.grade])
  async function save(next?: boolean) {
    if (!f.title.trim()) return setErr('Nhập tên chủ đề.')
    setBusy(true); setErr('')
    const row = { module_id: f.module_id, grade: f.grade, seq: Number(f.seq) || 1, code: f.code, title: f.title, periods: Number(f.periods) || 0,
      objectives: f.objectives, product: f.product ?? '', main_subject: f.main_subject, subjects: f.subjects, textbook_ref: f.textbook_ref, active: f.active, part: track?.use_modules === false ? null : (f.part ?? null) }
    const { data, error } = f.id ? await supabase.from('program_topics').update(row).eq('id', f.id).select('id')
      : await supabase.from('program_topics').insert(row).select('id')
    setBusy(false)
    if (error) return setErr(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(frameErr('row-level'))
    if (next) { setAdded(added + 1); setSeqTouched(false); setFS({ ...f, title: '', code: '', objectives: '', product: '', seq: (Number(f.seq) || 0) + 1 }) }
    onSaved(next)
  }
  return <section className="panel">
    {added > 0 && <p className="msg" role="status" style={{ marginTop: 0 }}>Đã thêm {added} chủ đề. Nhập chủ đề tiếp theo.</p>}
    <div className="formgrid">
      {modules && <label className="field wide"><span>Học phần *</span><select value={f.module_id} onChange={e => setF({ ...f, module_id: e.target.value })}>
        {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      <label className="field"><span>Khối *</span><select value={f.grade} onChange={e => setF({ ...f, grade: Number(e.target.value) })}>
        {gradeList.map(g => <option key={g} value={g}>{gradeName(g)}</option>)}</select></label>
      <label className="field"><span>Thứ tự bài</span><input type="number" min={1} max={999} value={f.seq} onChange={e => { setSeqTouched(true); setF({ ...f, seq: Number(e.target.value) }) }} /></label>
      <label className="field"><span>Mã chủ đề</span><input value={f.code ?? ''} maxLength={40} placeholder="VD: G1-01" onChange={e => setF({ ...f, code: e.target.value })} /></label>
      <label className="field"><span>Số tiết</span><input type="number" min={0} max={200} value={f.periods} onChange={e => setF({ ...f, periods: Number(e.target.value) })} /></label>
      <label className="field wide"><span>Tên chủ đề *</span><input value={f.title} maxLength={200} onChange={e => setF({ ...f, title: e.target.value })} /></label>
      <label className="field"><span>Môn chủ trì</span><SubjectPicker value={f.main_subject} onChange={v => setF({ ...f, main_subject: v || null })} emptyLabel="— Không —" /></label>
      <div className="field" style={{ gridColumn: 'span 2' }}><span>Môn phối hợp</span>
        <SubjectMulti value={f.subjects} onChange={v => setF({ ...f, subjects: v })} exclude={f.main_subject ? [f.main_subject] : []} ariaLabel="Môn phối hợp" /></div>
      {track?.use_modules !== false && <label className="field"><span>Phần</span><select value={f.part ?? ''} onChange={e => setF({ ...f, part: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Dùng chung (cả HP1 và HP2)</option><option value="1">Học phần 1 (HP1)</option><option value="2">Học phần 2 (HP2)</option></select></label>}
      <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
        <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
      {track?.schedule_mode === 'subject' && <label className="field wide"><span>Bài SGK liên quan / được thay</span>
        <input value={f.textbook_ref} onChange={e => setF({ ...f, textbook_ref: e.target.value })} placeholder="VD: Toán 1 – Bài 12: Hình vuông, hình tròn" /></label>}
      <label className="field wide"><span>Mục tiêu, yêu cầu cần đạt</span><textarea rows={3} value={f.objectives} onChange={e => setF({ ...f, objectives: e.target.value })} /></label>
      <label className="field wide"><span>Sản phẩm</span><input value={f.product ?? ''} maxLength={300} placeholder="VD: Mô hình ngôi nhà mơ ước bằng bìa giấy" onChange={e => setF({ ...f, product: e.target.value })} /></label>
    </div>
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={() => save()} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      {!f.id && <button onClick={() => save(true)} disabled={busy}>Lưu và thêm tiếp</button>}
      <button onClick={onCancel} disabled={busy}>{added ? 'Đóng' : 'Huỷ'}</button>
    </div>
  </section>
}
