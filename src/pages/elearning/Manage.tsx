import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { uploadLearningFile, openFile, MAX_FILE_MB } from '../../lib/files'
import { Tabs } from '../teacher/common'
import QuestionBank from './Bank'
import Analytics from './Analytics'
import { ElView } from './View'
import { ESTATUS, LEVEL, LKIND, SHOW, dueBadge, errText, pathName, type Attempt, type Course, type Exam, type Lesson, type Level, type Question } from './common'

// E-learning & luyện thi (GV, trường, Sở, KDI): đề luyện, khoá học, phân tích kết quả, ngân hàng câu hỏi.
type Cls = { id: string; name: string; grade: number | null }
type Grp = { id: string; name: string; class_id: string }
type Stu = { id: string; full_name: string; student_code: string | null; classes: { name: string } | null }
type Aud = { class_ids: string[] | null; group_ids: string[] | null; student_ids: string[] | null }
const some = (a: string[] | null | undefined) => (a?.length ? a : null)
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '')
const NOT_OWNER = 'Chỉ người tạo hoặc quản trị đơn vị được sửa nội dung này.'
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

export default function ElearningManage({ orgId }: { orgId: string | null }) {
  const [tab, setTab] = useState<'exam' | 'course' | 'hard' | 'review' | 'bank'>('exam')
  return <>
    <Tabs value={tab} onChange={setTab} items={[['exam', 'Đề luyện'], ['course', 'Khoá học e-learning'], ['hard', 'Câu hỏi khó'], ['review', 'Nội dung cần ôn'], ['bank', 'Ngân hàng câu hỏi']]} />
    {tab === 'exam' ? <Exams orgId={orgId} /> : tab === 'course' ? <Courses orgId={orgId} /> : tab === 'hard' || tab === 'review' ? <Analytics key={tab} orgId={orgId} kind={tab} />
      : <QuestionBank orgId={orgId} />}
  </>
}

function useOrgCtx(orgId: string | null) {
  const [classes, setClasses] = useState<Cls[]>([])
  const [groups, setGroups] = useState<Grp[]>([])
  const [type, setType] = useState('school')
  const [me, setMe] = useState<string | null>(null)
  useEffect(() => {
    if (!orgId) return
    supabase.from('classes').select('id, name, grade').eq('org_id', orgId).order('grade').order('name').then(({ data }) => setClasses((data as Cls[]) ?? []))
    supabase.from('student_groups').select('id, name, class_id').eq('org_id', orgId).order('name').then(({ data }) => setGroups((data as Grp[]) ?? []))
    supabase.from('organizations').select('type').eq('id', orgId).maybeSingle().then(({ data }) => setType((data as any)?.type ?? 'school'))
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null))
  }, [orgId])
  return { classes, groups, isSchool: type === 'school', me }
}

// Tóm tắt đối tượng giao trong danh sách: "Lớp 6A, Lớp 7B · Nhóm 1 (Lớp 9A) · 2 học sinh"
function audienceText(x: Aud & { shared: boolean }, classes: Cls[], groups: Grp[]) {
  if (x.shared) return 'dùng chung'
  const cn = (id: string) => classes.find(c => c.id === id)?.name ?? '?'
  const parts = [
    x.class_ids?.length ? (x.class_ids.length > 3 ? `${x.class_ids.length} lớp` : x.class_ids.map(cn).join(', ')) : null,
    x.group_ids?.length ? (x.group_ids.length > 3 ? `${x.group_ids.length} nhóm` : x.group_ids.map(id => { const g = groups.find(y => y.id === id); return g ? `${g.name} (${cn(g.class_id)})` : 'nhóm' }).join(', ')) : null,
    x.student_ids?.length ? `${x.student_ids.length} học sinh` : null,
  ].filter(Boolean)
  return parts.length ? 'Giao: ' + parts.join(' · ') : 'Cả trường'
}

// Giao cho: cả trường, hoặc chọn lớp / nhóm học sinh / từng học sinh (học sinh thuộc một trong số đó thì thấy nội dung)
function AudiencePicker({ orgId, classes, groups, value, onChange }: { orgId: string | null; classes: Cls[]; groups: Grp[]; value: Aud; onChange: (v: Aud) => void }) {
  const [targeted, setTargeted] = useState(!!(value.class_ids?.length || value.group_ids?.length || value.student_ids?.length))
  const withGroups = classes.filter(c => groups.some(g => g.class_id === c.id))
  const [gClass, setGClass] = useState(() => groups.find(g => value.group_ids?.includes(g.id))?.class_id ?? withGroups[0]?.id ?? '')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Stu[]>([])
  const [known, setKnown] = useState<Map<string, Stu>>(new Map())
  const cls = value.class_ids ?? [], grp = value.group_ids ?? [], st = value.student_ids ?? []
  useEffect(() => { if (!gClass && withGroups.length) setGClass(withGroups[0].id) }, [withGroups.length])
  // Tên các học sinh đã chọn (khi sửa đề / khoá học)
  useEffect(() => {
    const miss = st.filter(id => !known.has(id))
    if (!miss.length) return
    supabase.from('students').select('id, full_name, student_code, classes(name)').in('id', miss)
      .then(({ data }) => setKnown(m => { const n = new Map(m); ((data as any[]) ?? []).forEach(x => n.set(x.id, x)); return n }))
  }, [st.join()])
  useEffect(() => {
    const t = q.replace(/[,()%*\\]/g, ' ').trim()
    if (t.length < 2 || !orgId) { setFound([]); return }
    const h = setTimeout(() => {
      supabase.from('students').select('id, full_name, student_code, classes(name)').eq('org_id', orgId).eq('status', 'studying')
        .or(`full_name.ilike.%${t}%,student_code.ilike.%${t}%`).order('full_name').limit(20).then(({ data }) => setFound((data as any[]) ?? []))
    }, 250)
    return () => clearTimeout(h)
  }, [q, orgId])
  const set = (p: Partial<Aud>) => onChange({ class_ids: some(p.class_ids ?? cls), group_ids: some(p.group_ids ?? grp), student_ids: some(p.student_ids ?? st) })
  const addStudent = (s: Stu) => { setKnown(m => new Map(m).set(s.id, s)); if (!st.includes(s.id)) set({ student_ids: [...st, s.id] }); setQ('') }
  const cn = (id: string) => classes.find(c => c.id === id)?.name ?? ''
  return (
    <div className="field wide"><span>Giao cho</span>
      <div className="tools">
        <label className="field inline"><input type="radio" checked={!targeted} onChange={() => { setTargeted(false); onChange({ class_ids: null, group_ids: null, student_ids: null }) }} /> Mọi học sinh của trường</label>
        <label className="field inline"><input type="radio" checked={targeted} onChange={() => setTargeted(true)} /> Chọn lớp, nhóm hoặc học sinh</label>
      </div>
      {targeted && <div className="audience">
        <div><small>Lớp</small><div className="tools">{classes.map(c => <label key={c.id} className="field inline"><input type="checkbox" checked={cls.includes(c.id)}
          onChange={e => set({ class_ids: e.target.checked ? [...cls, c.id] : cls.filter(x => x !== c.id) })} /> {c.name}</label>)}
          {!classes.length && <small>Trường chưa có lớp.</small>}</div></div>
        <div><small>Nhóm học sinh</small>
          {withGroups.length ? <div className="tools">
            <select value={gClass} onChange={e => setGClass(e.target.value)} aria-label="Nhóm của lớp">{withGroups.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            {groups.filter(g => g.class_id === gClass).map(g => <label key={g.id} className="field inline"><input type="checkbox" checked={grp.includes(g.id)}
              onChange={e => set({ group_ids: e.target.checked ? [...grp, g.id] : grp.filter(x => x !== g.id) })} /> {g.name}</label>)}
          </div> : <small> — chưa lớp nào chia nhóm (chia nhóm trong mục Bài tập).</small>}
          {grp.length > 0 && <div>{grp.map(id => { const g = groups.find(x => x.id === id)
            return <span className="chip" key={id}>{g ? `${g.name} · ${cn(g.class_id)}` : 'Nhóm'}<button type="button" className="x" onClick={() => set({ group_ids: grp.filter(x => x !== id) })} aria-label="Bỏ nhóm">×</button></span> })}</div>}
        </div>
        <div><small>Từng học sinh</small>
          <div className="stupick">
            <input type="search" className="search" style={{ margin: 0 }} placeholder="Gõ tên hoặc mã học sinh…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm học sinh" />
            {found.length > 0 && <ul className="stuhits">{found.map(s => <li key={s.id}><button type="button" onClick={() => addStudent(s)} disabled={st.includes(s.id)}>
              {s.full_name}<small>{[s.classes?.name, s.student_code].filter(Boolean).join(' · ')}</small></button></li>)}</ul>}
          </div>
          {st.length > 0 && <div>{st.map(id => { const s = known.get(id)
            return <span className="chip" key={id}>{s ? `${s.full_name}${s.classes ? ' · ' + s.classes.name : ''}` : 'Học sinh'}<button type="button" className="x" onClick={() => set({ student_ids: st.filter(x => x !== id) })} aria-label="Bỏ học sinh">×</button></span> })}</div>}
        </div>
        {!cls.length && !grp.length && !st.length && <p className="msg">Chưa chọn lớp, nhóm hay học sinh nào — nội dung sẽ dành cho mọi học sinh của trường.</p>}
      </div>}
    </div>
  )
}

// ================= Đề luyện =================
type EForm = Omit<Exam, 'id' | 'org_id' | 'created_by' | 'created_at'> & { id?: string }
const EEMPTY: EForm = { title: '', description: '', subject: '', grade: null, mode: 'random', question_ids: [], criteria: { count: 10, levels: {}, topics: [] },
  duration_min: 15, max_attempts: 0, show_answers: 'after_submit', class_ids: null, group_ids: null, student_ids: null, shared: false, opens_at: new Date().toISOString(), closes_at: null, status: 'draft' }

function Exams({ orgId }: { orgId: string | null }) {
  const { classes, groups, isSchool } = useOrgCtx(orgId)
  const [rows, setRows] = useState<Exam[]>([])
  const [counts, setCounts] = useState<Map<string, { n: number; students: Set<string>; sum: number }>>(new Map())
  const [form, setForm] = useState<EForm | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [e, a] = await Promise.all([supabase.from('practice_exams').select('*').order('created_at', { ascending: false }),
      supabase.from('exam_attempts').select('exam_id, student_id, score, status').eq('status', 'submitted').limit(20000)])
    if (e.error) setMsg([errText(e.error.message), true])
    setRows((e.data as Exam[]) ?? [])
    const m = new Map<string, { n: number; students: Set<string>; sum: number }>()
    ;((a.data as any[]) ?? []).forEach(x => { const v = m.get(x.exam_id) ?? { n: 0, students: new Set(), sum: 0 }; v.n++; v.students.add(x.student_id); v.sum += Number(x.score ?? 0); m.set(x.exam_id, v) })
    setCounts(m)
  }
  useEffect(() => { load() }, [orgId])
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const { id, ...body } = form
    const payload = { ...body, subject: body.subject?.trim() || null, description: body.description?.trim() || null, shared: isSchool ? false : body.shared,
      class_ids: isSchool ? some(body.class_ids) : null, group_ids: isSchool ? some(body.group_ids) : null, student_ids: isSchool ? some(body.student_ids) : null }
    const { data, error } = id ? await supabase.from('practice_exams').update(payload).eq('id', id).select('id') : await supabase.from('practice_exams').insert({ ...payload, org_id: orgId }).select('id')
    if (error) return setMsg([errText(error.message), true])
    if (!data?.length) return setMsg([NOT_OWNER, true])
    setMsg([id ? 'Đã lưu đề.' : 'Đã tạo đề.', false]); setForm(null); load()
  }
  async function setStatus(x: Exam, status: Exam['status']) {
    const { data, error } = await supabase.from('practice_exams').update({ status }).eq('id', x.id).select('id')
    if (error) setMsg([errText(error.message), true]); else if (!data?.length) setMsg([NOT_OWNER, true]); else load()
  }
  const editable = (x: Exam) => x.org_id === orgId
  const editForm = (x: Exam) => { const { id, title, description, subject, grade, mode, question_ids, criteria, duration_min, max_attempts, show_answers, class_ids, group_ids, student_ids, shared, opens_at, closes_at, status } = x
    setMsg(null); setForm({ id, title, description, subject, grade, mode, question_ids, criteria: { levels: {}, topics: [], ...criteria }, duration_min, max_attempts, show_answers, class_ids, group_ids: group_ids ?? null, student_ids: student_ids ?? null, shared, opens_at, closes_at, status }) }
  const statusBtns = (x: Exam) => <>
    {x.status === 'draft' && <button className="primary" onClick={() => setStatus(x, 'published')}>Công bố</button>}
    {x.status === 'published' && <button onClick={() => setStatus(x, 'closed')}>Đóng</button>}
    {x.status === 'closed' && <button onClick={() => setStatus(x, 'published')}>Mở lại</button>}</>
  const note = msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>
  // Thêm / sửa đề: trang riêng
  if (form) return <ElView back={open ? 'Chi tiết đề luyện' : 'Danh sách đề luyện'} onBack={() => setForm(null)} title={form.id ? 'Sửa đề luyện' : 'Tạo đề luyện'} sub={form.id ? form.title : undefined}>
    {note}<ExamForm form={form} setForm={setForm} onSubmit={save} orgId={orgId} classes={classes} groups={groups} isSchool={isSchool} /></ElView>
  // Chi tiết đề: trang riêng
  const cur = rows.find(x => x.id === open)
  if (cur) return <ElView back="Danh sách đề luyện" onBack={() => { setOpen(null); setMsg(null) }} title={cur.title}
    sub={<>{[cur.subject, cur.grade ? 'Khối ' + cur.grade : null, cur.mode === 'random' ? `Ngẫu nhiên ${cur.criteria.count} câu` : `Cố định ${cur.question_ids.length} câu`, cur.duration_min ? `${cur.duration_min} phút` : null,
      `${dt(cur.opens_at)}${cur.closes_at ? ' → ' + dt(cur.closes_at) : ''}`].filter(Boolean).join(' · ')} <span className={'pill ' + ESTATUS[cur.status][1]}>{ESTATUS[cur.status][0]}</span></>}
    actions={editable(cur) ? <>{statusBtns(cur)}<button onClick={() => editForm(cur)}>Sửa</button></> : undefined}>
    {note}<ExamResults exam={cur} roster={isSchool && editable(cur)} /></ElView>
  return (
    <>
      <div className="bar"><span /><button className="primary" onClick={() => { setMsg(null); setForm({ ...EEMPTY, shared: !isSchool }) }}>Tạo đề luyện</button></div>
      {note}
      <div className="wrap"><table className="systable">
        <thead><tr><th>Đề luyện</th><th>Cách ra đề</th><th>Thời gian</th><th>Mở</th><th className="num">Lượt nộp</th><th className="num">Điểm TB</th><th>Trạng thái</th></tr></thead>
        <tbody>{rows.map(x => { const c = counts.get(x.id); return <Fragment key={x.id}>
          <tr className="clickrow" onClick={() => { setMsg(null); setOpen(x.id) }}>
            <td><b>{x.title}</b><br /><small>{[x.subject, x.grade ? 'Khối ' + x.grade : null, !editable(x) ? 'của cấp trên' : isSchool ? audienceText(x, classes, groups) : x.shared ? 'dùng chung' : null].filter(Boolean).join(' · ')}</small></td>
            <td>{x.mode === 'random' ? `Ngẫu nhiên ${x.criteria.count} câu` : `Cố định ${x.question_ids.length} câu`}</td>
            <td>{x.duration_min ? `${x.duration_min} phút` : 'Không giới hạn'}{x.max_attempts ? <><br /><small>{x.max_attempts} lượt</small></> : null}</td>
            <td><small>{dt(x.opens_at)}{x.closes_at ? ` → ${dt(x.closes_at)}` : ''}</small></td>
            <td className="num">{c?.n ?? 0}<br /><small>{c?.students.size ?? 0} HS</small></td>
            <td className="num">{c?.n ? (c.sum / c.n).toFixed(1) : '—'}</td>
            <td><span className={'pill ' + ESTATUS[x.status][1]}>{ESTATUS[x.status][0]}</span></td>
          </tr>
        </Fragment> })}
          {!rows.length && <tr><td colSpan={7}>Chưa có đề luyện. Tạo đề ngẫu nhiên từ ngân hàng câu hỏi (theo môn, khối, mức độ) hoặc chọn từng câu.</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}

function ExamForm({ form, setForm, onSubmit, orgId, classes, groups, isSchool }: { form: EForm; setForm: (f: EForm | null) => void; onSubmit: (e: React.FormEvent) => void; orgId: string | null; classes: Cls[]; groups: Grp[]; isSchool: boolean }) {
  const [bank, setBank] = useState<Question[]>([])
  const [q, setQ] = useState('')
  useEffect(() => { supabase.from('question_bank').select('id, subject, grade, topic, level, stem, status').eq('status', 'ready').limit(5000).then(({ data }) => setBank((data as Question[]) ?? [])) }, [])
  const set = (p: Partial<EForm>) => setForm({ ...form, ...p })
  const pool = bank.filter(b => (!form.subject || b.subject === form.subject) && (!form.grade || b.grade === form.grade))
  const topics = [...new Set(pool.map(b => b.topic).filter(Boolean))] as string[]
  const inTopic = pool.filter(b => !form.criteria.topics?.length || form.criteria.topics.includes(b.topic ?? ''))
  const lvCount = (l: Level) => inTopic.filter(b => b.level === l).length
  const subjects = [...new Set(bank.map(b => b.subject))]
  return (
    <form className="panel formgrid" onSubmit={onSubmit}>
      <label className="field wide"><span>Tên đề *</span><input required value={form.title} onChange={e => set({ title: e.target.value })} placeholder="VD: Luyện tập chương Điện — Khoa học tự nhiên 7" /></label>
      <label className="field"><span>Môn</span><input list="el-subjects" value={form.subject ?? ''} onChange={e => set({ subject: e.target.value })} /><datalist id="el-subjects">{subjects.map(s => <option key={s} value={s} />)}</datalist></label>
      <label className="field"><span>Khối</span><input type="number" min={1} max={12} value={form.grade ?? ''} onChange={e => set({ grade: e.target.value ? Number(e.target.value) : null })} /></label>
      <label className="field"><span>Cách ra đề</span><select value={form.mode} onChange={e => set({ mode: e.target.value as EForm['mode'] })}><option value="random">Ngẫu nhiên từ ngân hàng (mỗi lượt khác nhau)</option><option value="fixed">Chọn từng câu (cố định)</option></select></label>
      {form.mode === 'random' ? <>
        <label className="field"><span>Số câu mỗi lượt</span><input type="number" min={1} max={200} value={form.criteria.count ?? 10} onChange={e => set({ criteria: { ...form.criteria, count: Number(e.target.value) } })} /></label>
        <div className="field wide"><span>Số câu theo mức độ (để trống = lấy ngẫu nhiên) — kho phù hợp: {inTopic.length} câu</span>
          <div className="tools">{(Object.keys(LEVEL) as Level[]).map(l => <label key={l} className="field inline">{LEVEL[l]} <input type="number" min={0} style={{ width: 70 }} value={form.criteria.levels?.[l] ?? ''}
            onChange={e => set({ criteria: { ...form.criteria, levels: { ...form.criteria.levels, [l]: e.target.value === '' ? undefined : Number(e.target.value) } } })} /> <small>/{lvCount(l)}</small></label>)}</div></div>
        {topics.length > 0 && <div className="field wide"><span>Chủ đề (để trống = mọi chủ đề)</span><div className="tools">{topics.map(t => <label key={t} className="field inline">
          <input type="checkbox" checked={form.criteria.topics?.includes(t) ?? false} onChange={e => set({ criteria: { ...form.criteria, topics: e.target.checked ? [...(form.criteria.topics ?? []), t] : (form.criteria.topics ?? []).filter(x => x !== t) } })} /> {t}</label>)}</div></div>}
        {inTopic.length < (form.criteria.count ?? 0) && <p className="msg">Kho chỉ có {inTopic.length} câu "Sẵn sàng" phù hợp — mỗi lượt sẽ ít hơn {form.criteria.count} câu.</p>}
      </> : <div className="field wide"><span>Chọn câu hỏi ({form.question_ids.length} đã chọn)</span>
        <input className="search" style={{ margin: '0 0 6px' }} placeholder="Lọc câu hỏi…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="pickq">{pool.filter(b => !q || b.stem.toLowerCase().includes(q.toLowerCase())).slice(0, 200).map(b => <label key={b.id}>
          <input type="checkbox" checked={form.question_ids.includes(b.id)} onChange={e => set({ question_ids: e.target.checked ? [...form.question_ids, b.id] : form.question_ids.filter(x => x !== b.id) })} />
          <span>{b.stem.slice(0, 160)}</span><small>{LEVEL[b.level]}</small></label>)}</div></div>}
      <label className="field"><span>Thời gian làm (phút)</span><input type="number" min={1} max={300} value={form.duration_min ?? ''} onChange={e => set({ duration_min: e.target.value ? Number(e.target.value) : null })} placeholder="Không giới hạn" /></label>
      <label className="field"><span>Số lượt tối đa (0 = không giới hạn)</span><input type="number" min={0} max={50} value={form.max_attempts} onChange={e => set({ max_attempts: Number(e.target.value) })} /></label>
      <label className="field"><span>Hiện đáp án</span><select value={form.show_answers} onChange={e => set({ show_answers: e.target.value as EForm['show_answers'] })}>{Object.entries(SHOW).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Mở từ</span><input type="datetime-local" value={toLocal(form.opens_at)} onChange={e => set({ opens_at: new Date(e.target.value).toISOString() })} /></label>
      <label className="field"><span>Đóng lúc</span><input type="datetime-local" value={toLocal(form.closes_at)} onChange={e => set({ closes_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
      {isSchool ? <AudiencePicker key={form.id ?? 'new'} orgId={orgId} classes={classes} groups={groups} value={form} onChange={v => set(v)} />
        : <label className="field inline wide"><input type="checkbox" checked={form.shared} onChange={e => set({ shared: e.target.checked })} /> Giao cho học sinh mọi trường trực thuộc</label>}
      <label className="field wide"><span>Hướng dẫn cho học sinh</span><textarea rows={2} value={form.description ?? ''} onChange={e => set({ description: e.target.value })} /></label>
      <div className="actions wide"><button className="primary">{form.id ? 'Lưu đề' : 'Tạo đề (nháp)'}</button><button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
    </form>
  )
}

function ExamResults({ exam, roster }: { exam: Exam; roster: boolean }) {
  const [rows, setRows] = useState<(Attempt & { students: { full_name: string; student_code: string | null; classes: { name: string } | null } | null })[]>([])
  const [stats, setStats] = useState<{ attempts: number; students: number; avg: number | null; schools: number; items: { id: string; stem: string; level: Level; shown: number; rate: number }[] } | null>(null)
  useEffect(() => {
    supabase.from('exam_attempts').select('*, students(full_name, student_code, classes(name))').eq('exam_id', exam.id).order('submitted_at', { ascending: false }).limit(5000)
      .then(({ data }) => setRows((data as any[]) ?? []))
    supabase.rpc('exam_stats', { p_exam: exam.id }).then(({ data }) => setStats(data as any))
  }, [exam.id])
  const best = useMemo(() => [...rows.filter(r => r.status === 'submitted').reduce((m, r) => { const c = m.get(r.student_id); if (!c || Number(r.score) > Number(c.score)) m.set(r.student_id, r); return m }, new Map<string, typeof rows[number]>()).values()], [rows])
  return (
    <div className="examres">
      <div className="cards syscards">
        <div className="card"><strong>{stats?.students ?? '…'}</strong><span>Học sinh đã nộp</span></div>
        <div className="card"><strong>{stats?.attempts ?? '…'}</strong><span>Lượt nộp</span></div>
        <div className="card"><strong>{stats?.avg ?? '—'}</strong><span>Điểm trung bình</span></div>
        {!!stats && stats.schools > 1 && <div className="card"><strong>{stats.schools}</strong><span>Trường tham gia</span></div>}
      </div>
      <div className={roster ? '' : 'appgrid'}>
        {roster ? <ExamRoster exam={exam} /> : <section className="panel"><div className="bar"><h3>Điểm cao nhất của từng học sinh</h3>
          <button onClick={() => downloadXlsx('ket-qua-' + exam.title.slice(0, 40), [{ key: 'a', label: 'Mã HS' }, { key: 'b', label: 'Họ tên', width: 26 }, { key: 'c', label: 'Lớp' }, { key: 'd', label: 'Điểm' }, { key: 'e', label: 'Đúng' }, { key: 'f', label: 'Nộp lúc', width: 18 }],
            best.map(r => [r.students?.student_code, r.students?.full_name, r.students?.classes?.name, r.score, `${r.correct}/${r.total}`, dt(r.submitted_at)]))} disabled={!best.length}>Xuất Excel</button></div>
          <div className="wrap"><table className="systable"><thead><tr><th>Học sinh</th><th>Lớp</th><th className="num">Điểm</th><th>Nộp lúc</th></tr></thead><tbody>
            {best.slice(0, 200).map(r => <tr key={r.id}><td>{r.students?.full_name ?? <small>Học sinh trường khác</small>}</td><td>{r.students?.classes?.name}</td><td className="num"><b>{r.score}</b> <small>({r.correct}/{r.total})</small></td><td><small>{dt(r.submitted_at)}{r.late ? ' · quá giờ' : ''}</small></td></tr>)}
            {!best.length && <tr><td colSpan={4}>Chưa có học sinh nộp bài.</td></tr>}
          </tbody></table></div></section>}
        <section className="panel"><h3>Tỉ lệ đúng từng câu</h3><p className="sub">Câu dưới 30% đúng: xem lại đáp án hoặc dạy lại; trên 95%: có thể quá dễ.</p>
          <div className="itemrates">{(stats?.items ?? []).map(it => <div key={it.id} title={it.stem}><span>{it.stem}</span>
            <span className="ibar"><i style={{ width: it.rate + '%', background: it.rate < 30 ? 'var(--bad)' : it.rate > 95 ? '#94a3b8' : 'var(--ok)' }} /><b>{it.rate}%</b></span><small>{LEVEL[it.level]} · {it.shown} lượt</small></div>)}
            {!stats?.items.length && <p className="sub">Chưa có dữ liệu.</p>}</div></section>
      </div>
    </div>
  )
}

// ================= Khoá học =================
type CForm = Omit<Course, 'id' | 'org_id' | 'created_by' | 'created_at'> & { id?: string }
const CEMPTY: CForm = { title: '', description: '', subject: '', grade: null, cover_url: null, class_ids: null, group_ids: null, student_ids: null, due_at: null, shared: false, status: 'draft' }

function Courses({ orgId }: { orgId: string | null }) {
  const { classes, groups, isSchool } = useOrgCtx(orgId)
  const [rows, setRows] = useState<Course[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  const [exams, setExams] = useState<Exam[]>([])
  const [form, setForm] = useState<CForm | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [c, l, p, e] = await Promise.all([supabase.from('courses').select('*').order('created_at', { ascending: false }), supabase.from('course_lessons').select('*').order('position'),
      supabase.from('course_progress').select('lesson_id').limit(50000), supabase.from('practice_exams').select('id, title, status').neq('status', 'draft')])
    if (c.error) setMsg([errText(c.error.message), true])
    setRows((c.data as Course[]) ?? []); setLessons((l.data as Lesson[]) ?? []); setExams((e.data as Exam[]) ?? [])
    const m = new Map<string, number>(); ((p.data as any[]) ?? []).forEach(x => m.set(x.lesson_id, (m.get(x.lesson_id) ?? 0) + 1)); setProgress(m)
  }
  useEffect(() => { load() }, [orgId])
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const { id, ...body } = form
    const payload = { ...body, subject: body.subject?.trim() || null, description: body.description?.trim() || null, cover_url: body.cover_url?.trim() || null, shared: isSchool ? false : body.shared,
      class_ids: isSchool ? some(body.class_ids) : null, group_ids: isSchool ? some(body.group_ids) : null, student_ids: isSchool ? some(body.student_ids) : null }
    // Thêm mới không đọc lại dòng vừa tạo: chính sách đọc courses (course_visible) chưa thấy dòng mới trong cùng câu lệnh
    const { data, error } = id ? await supabase.from('courses').update(payload).eq('id', id).select('id') : await supabase.from('courses').insert({ ...payload, org_id: orgId })
    if (error) return setMsg([errText(error.message), true])
    if (id && !data?.length) return setMsg([NOT_OWNER, true])
    setForm(null); setMsg(['Đã lưu khoá học.', false]); load()
  }
  async function setStatus(c: Course, status: Course['status']) {
    const { data, error } = await supabase.from('courses').update({ status }).eq('id', c.id).select('id')
    if (error) setMsg([errText(error.message), true]); else if (!data?.length) setMsg([NOT_OWNER, true]); else load()
  }
  const note = msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>
  const editCourse = (c: Course) => { const { id, title, description, subject, grade, cover_url, class_ids, group_ids, student_ids, due_at, shared, status } = c
    setMsg(null); setForm({ id, title, description, subject, grade, cover_url, class_ids, group_ids: group_ids ?? null, student_ids: student_ids ?? null, due_at: due_at ?? null, shared, status }) }
  const statusBtns = (c: Course, ls: Lesson[]) => <>
    {c.status === 'draft' && <button className="primary" onClick={() => setStatus(c, 'published')} disabled={!ls.length} title={ls.length ? undefined : 'Thêm ít nhất một bài học trước khi công bố'}>Công bố</button>}
    {c.status === 'published' && <button onClick={() => setStatus(c, 'archived')}>Lưu trữ</button>}
    {c.status === 'archived' && <button onClick={() => setStatus(c, 'published')}>Mở lại</button>}</>
  // Thêm / sửa khoá học: trang riêng
  if (form) return <ElView back={open ? 'Chi tiết khoá học' : 'Danh sách khoá học'} onBack={() => setForm(null)} title={form.id ? 'Sửa khoá học' : 'Tạo khoá học'} sub={form.id ? form.title : undefined}>
      {note}
      <form className="panel formgrid" onSubmit={save}>
        <label className="field wide"><span>Tên khoá học *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Lập trình Arduino cơ bản" /></label>
        <label className="field"><span>Môn</span><input value={form.subject ?? ''} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
        <label className="field"><span>Khối</span><input type="number" min={1} max={12} value={form.grade ?? ''} onChange={e => setForm({ ...form, grade: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field"><span>Ảnh bìa (https://…)</span><input value={form.cover_url ?? ''} onChange={e => setForm({ ...form, cover_url: e.target.value })} /></label>
        <label className="field"><span>Hạn hoàn thành</span><input type="datetime-local" value={toLocal(form.due_at)} onChange={e => setForm({ ...form, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
        <label className="field wide"><span>Giới thiệu</span><textarea rows={3} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        {isSchool ? <AudiencePicker key={form.id ?? 'new'} orgId={orgId} classes={classes} groups={groups} value={form} onChange={v => setForm({ ...form, ...v })} />
          : <label className="field inline wide"><input type="checkbox" checked={form.shared} onChange={e => setForm({ ...form, shared: e.target.checked })} /> Dành cho học sinh mọi trường trực thuộc</label>}
        <div className="actions wide"><button className="primary">Lưu khoá học</button><button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
      </form></ElView>
  // Chi tiết khoá học (bài học, tiến độ): trang riêng
  const cur = rows.find(c => c.id === open)
  if (cur) { const ls = lessons.filter(l => l.course_id === cur.id); const mine = cur.org_id === orgId
    return <ElView back="Danh sách khoá học" onBack={() => { setOpen(null); setMsg(null) }} title={cur.title}
      sub={<>{[cur.subject, cur.grade ? 'Khối ' + cur.grade : null, `${ls.length} bài`, !mine ? 'của cấp trên' : isSchool ? audienceText(cur, classes, groups) : cur.shared ? 'dùng chung' : null, cur.due_at ? 'Hạn hoàn thành: ' + dt(cur.due_at) : null].filter(Boolean).join(' · ')} <span className={'pill ' + ESTATUS[cur.status][1]}>{ESTATUS[cur.status][0]}</span></>}
      actions={mine ? <>{statusBtns(cur, ls)}<button onClick={() => editCourse(cur)}>Sửa</button></> : undefined}>
      {note}
      {cur.description && <p className="sub">{cur.description}</p>}
      <section className="panel"><h3>Bài học</h3><LessonEditor course={cur} lessons={ls} exams={exams} progress={progress} editable={mine} onChange={load} /></section>
      {mine && <CourseProgress key={ls.length} course={cur} />}
    </ElView> }
  return (
    <>
      <div className="bar"><span /><button className="primary" onClick={() => { setMsg(null); setForm({ ...CEMPTY, shared: !isSchool }) }}>Tạo khoá học</button></div>
      {note}
      <div className="coursegrid">
        {rows.map(c => { const ls = lessons.filter(l => l.course_id === c.id); const mine = c.org_id === orgId
          return <section key={c.id} className="panel coursecard">
            <header className="clickrow" onClick={() => { setMsg(null); setOpen(c.id) }}>
              <div><b>{c.title}</b><small>{[c.subject, c.grade ? 'Khối ' + c.grade : null, `${ls.length} bài`, !mine ? 'của cấp trên' : isSchool ? audienceText(c, classes, groups) : c.shared ? 'dùng chung' : null].filter(Boolean).join(' · ')}</small>
                {c.due_at && <small className={'due ' + (c.status === 'published' ? dueBadge(c.due_at, false)!.tone : '')}>Hạn hoàn thành: {dt(c.due_at)}</small>}</div>
              <span className={'pill ' + ESTATUS[c.status][1]}>{ESTATUS[c.status][0]}</span>
            </header>
            {c.description && <p className="sub">{c.description}</p>}
            <div className="tools">
              <button onClick={() => { setMsg(null); setOpen(c.id) }}>{mine ? 'Bài học & tiến độ' : 'Xem bài học'}</button>
              {mine && statusBtns(c, ls)}
              {mine && <button onClick={() => editCourse(c)}>Sửa</button>}
            </div>
          </section> })}
        {!rows.length && <p className="sub">Chưa có khoá học. Một khoá gồm nhiều bài: video (YouTube, Google Drive…), bài đọc, liên kết, tệp, học liệu từ Kho học liệu và đề luyện.</p>}
      </div>
    </>
  )
}

type LibOpt = { id: string; title: string; owner_name: string | null; content: { type?: string; file_name?: string } }
const MAT: Record<string, string> = { lesson_plan: 'Giáo án', worksheet: 'Phiếu học tập', image: 'Hình ảnh', video: 'Video', guide: 'Tài liệu hướng dẫn', document: 'Tài liệu', link: 'Đường dẫn' }

function LessonEditor({ course, lessons, exams, progress, editable, onChange }: { course: Course; lessons: Lesson[]; exams: Exam[]; progress: Map<string, number>; editable: boolean; onChange: () => void }) {
  const [f, setF] = useState<Partial<Lesson> | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [lib, setLib] = useState<LibOpt[] | null>(null)
  const [libQ, setLibQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Học liệu đã xuất bản trong Kho học liệu mà đơn vị thấy (chỉ loại "Học liệu": tệp / đường dẫn)
  useEffect(() => {
    if ((f?.kind === 'library' || lessons.some(l => l.kind === 'library')) && !lib)
      supabase.from('library_items').select('id, title, owner_name, content').eq('status', 'published').eq('kind', 'material').order('title').limit(2000)
        .then(({ data }) => setLib((data as LibOpt[]) ?? []))
  }, [f?.kind, lessons.length])
  function edit(l: Partial<Lesson> | null) { setF(l); setFile(null); setErr(''); setLibQ('') }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f) return
    setBusy(true); setErr('')
    try {
      let path = f.kind === 'file' ? f.path ?? null : null
      if (f.kind === 'file' && file) path = (await uploadLearningFile(course.org_id, 'courses', file)).path
      if (f.kind === 'file' && !path) throw new Error('Chọn tệp cho bài học.')
      if (f.kind === 'library' && !f.library_item_id) throw new Error('Chọn học liệu trong kho.')
      const body = { course_id: course.id, title: f.title, kind: f.kind, url: f.kind === 'video' || f.kind === 'link' ? f.url?.trim() || null : null, body: f.body?.trim() || null,
        exam_id: f.kind === 'exam' ? f.exam_id : null, path, library_item_id: f.kind === 'library' ? f.library_item_id : null,
        duration_min: f.duration_min || null, position: f.position ?? (lessons.length ? Math.max(...lessons.map(l => l.position)) + 1 : 1) }
      const { error } = f.id ? await supabase.from('course_lessons').update(body).eq('id', f.id) : await supabase.from('course_lessons').insert(body)
      if (error) throw new Error(errText(error.message, '061'))
      edit(null); onChange()
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  async function move(l: Lesson, d: number) {
    const i = lessons.findIndex(x => x.id === l.id), o = lessons[i + d]; if (!o) return
    await supabase.from('course_lessons').update({ position: o.position }).eq('id', l.id); await supabase.from('course_lessons').update({ position: l.position }).eq('id', o.id); onChange()
  }
  const libName = (id: string | null) => lib?.find(x => x.id === id)?.title
  const ln = libQ.trim().toLowerCase(), libList = (lib ?? []).filter(x => !ln || x.title.toLowerCase().includes(ln) || x.id === f?.library_item_id)
  return (
    <div className="lessons">
      <ol>{lessons.map((l, i) => <li key={l.id}>
        <span className="lk">{LKIND[l.kind] ?? l.kind}</span><b>{l.title}</b>{l.duration_min ? <small> · {l.duration_min} phút</small> : null}
        {l.kind === 'file' && l.path && <button className="xbtn" onClick={() => openFile(l.path!)} title="Mở tệp">{pathName(l.path)}</button>}
        {l.kind === 'library' && libName(l.library_item_id) !== l.title && <small>· {libName(l.library_item_id) ?? 'Học liệu trong kho'}</small>}
        <small className="done">{progress.get(l.id) ?? 0} HS đã học</small>
        {editable && <span className="tools"><button className="xbtn" disabled={!i} onClick={() => move(l, -1)} aria-label="Lên">↑</button><button className="xbtn" disabled={i === lessons.length - 1} onClick={() => move(l, 1)} aria-label="Xuống">↓</button>
          <button className="xbtn" onClick={() => edit(l)}>Sửa</button><button className="xbtn" onClick={async () => { if (confirm('Xoá bài này?')) { await supabase.from('course_lessons').delete().eq('id', l.id); onChange() } }}>Xoá</button></span>}
      </li>)}</ol>
      {!lessons.length && <p className="sub">Khoá chưa có bài học.</p>}
      {editable && !f && <button onClick={() => edit({ kind: 'video', title: '' })}>+ Thêm bài học</button>}
      {f && <form className="formgrid" onSubmit={save}>
        <label className="field"><span>Loại bài</span><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Lesson['kind'] })}>{Object.entries(LKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field wide"><span>Tên bài *</span><input required value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        {(f.kind === 'video' || f.kind === 'link') && <label className="field wide"><span>Đường dẫn *</span><input required type="url" value={f.url ?? ''} onChange={e => setF({ ...f, url: e.target.value })} placeholder={f.kind === 'video' ? 'https://www.youtube.com/watch?v=… hoặc Google Drive' : 'https://…'} /></label>}
        {f.kind === 'exam' && <label className="field wide"><span>Đề luyện *</span><select required value={f.exam_id ?? ''} onChange={e => setF({ ...f, exam_id: e.target.value })}><option value="">Chọn đề đã công bố…</option>{exams.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>}
        {f.kind === 'file' && <label className="field wide"><span>Tệp (PDF, Word, PowerPoint, hình ảnh… tối đa {MAX_FILE_MB} MB) *</span>
          <input type="file" required={!f.path} onChange={e => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title?.trim()) setF({ ...f, title: x.name.replace(/\.[^.]+$/, '') }) }} />
          {f.path && !file && <small>Tệp hiện tại: <button type="button" className="xbtn" onClick={() => openFile(f.path!)}>{pathName(f.path)}</button> — chọn tệp khác để thay.</small>}</label>}
        {f.kind === 'library' && <div className="field wide"><span>Học liệu trong Kho học liệu *</span>
          <input type="search" className="search" style={{ margin: '0 0 6px' }} placeholder="Lọc theo tên học liệu…" value={libQ} onChange={e => setLibQ(e.target.value)} aria-label="Lọc học liệu" />
          <select required value={f.library_item_id ?? ''} onChange={e => setF({ ...f, library_item_id: e.target.value, title: f.title || libName(e.target.value) || '' })} aria-label="Học liệu">
            <option value="">{lib ? `Chọn học liệu đã xuất bản (${libList.length})…` : 'Đang tải…'}</option>
            {libList.map(x => <option key={x.id} value={x.id}>{x.title}{x.content?.type ? ` — ${MAT[x.content.type] ?? x.content.type}` : ''}{x.owner_name ? ` · ${x.owner_name}` : ''}</option>)}
          </select>
          {lib && !lib.length && <small>Chưa có học liệu nào được xuất bản trong Kho học liệu.</small>}</div>}
        <label className="field wide"><span>{f.kind === 'reading' ? 'Nội dung bài đọc (Markdown) *' : 'Ghi chú cho học sinh'}</span><textarea rows={f.kind === 'reading' ? 8 : 2} required={f.kind === 'reading'} value={f.body ?? ''} onChange={e => setF({ ...f, body: e.target.value })} /></label>
        <label className="field"><span>Thời lượng (phút)</span><input type="number" min={1} max={600} value={f.duration_min ?? ''} onChange={e => setF({ ...f, duration_min: e.target.value ? Number(e.target.value) : null })} /></label>
        {err && <p className="msg">{err}</p>}
        <div className="actions wide"><button className="primary" disabled={busy}>{busy ? (file ? 'Đang tải tệp lên…' : 'Đang lưu…') : 'Lưu bài học'}</button><button type="button" onClick={() => edit(null)}>Huỷ</button></div>
      </form>}
    </div>
  )
}

// Tiến độ từng học sinh được giao khoá học (course_progress_summary, 061)
type Prog = { student_id: string; full_name: string; class_name: string | null; done: number; total: number; last_done_at: string | null; exam_avg: number | null; overdue: boolean }
function CourseProgress({ course }: { course: Course }) {
  const [rows, setRows] = useState<Prog[] | null>(null)
  const [err, setErr] = useState('')
  const [only, setOnly] = useState<'' | 'overdue' | 'todo'>('')
  useEffect(() => {
    supabase.rpc('course_progress_summary', { p_course: course.id }).then(({ data, error }) => { if (error) setErr(errText(error.message, '061')); setRows((data as Prog[]) ?? []) })
  }, [course.id])
  if (!rows) return <p className="sub">Đang tải tiến độ…</p>
  const fin = rows.filter(r => r.total > 0 && r.done >= r.total).length, late = rows.filter(r => r.overdue).length
  const list = rows.filter(r => only === 'overdue' ? r.overdue : only === 'todo' ? r.done < r.total : true)
  const state = (r: Prog) => (r.total > 0 && r.done >= r.total ? ['Hoàn thành', 'active'] : r.overdue ? ['Quá hạn', 'inactive'] : r.done ? ['Đang học', 'maintenance'] : ['Chưa bắt đầu', ''])
  return (
    <section className="courseprog">
      <div className="bar"><h3>Tiến độ học sinh</h3>
        <span className="tools">
          <select value={only} onChange={e => setOnly(e.target.value as typeof only)} aria-label="Lọc tiến độ"><option value="">Tất cả ({rows.length})</option><option value="todo">Chưa học xong ({rows.length - fin})</option><option value="overdue">Quá hạn ({late})</option></select>
          <button disabled={!rows.length} onClick={() => downloadXlsx('tien-do-' + course.title.slice(0, 40), [{ key: 'a', label: 'Họ tên', width: 26 }, { key: 'b', label: 'Lớp' }, { key: 'c', label: 'Đã học' }, { key: 'd', label: 'Số bài' },
            { key: 'e', label: 'Học gần nhất', width: 18 }, { key: 'f', label: 'Điểm TB đề' }, { key: 'g', label: 'Trạng thái', width: 14 }],
            rows.map(r => [r.full_name, r.class_name, r.done, r.total, dt(r.last_done_at), r.exam_avg, state(r)[0]]))}>Xuất Excel</button>
        </span></div>
      {err && <p className="msg">{err}</p>}
      <p className="sub">{rows.length} học sinh được giao · {fin} hoàn thành{course.due_at ? <> · hạn {dt(course.due_at)}{late ? <> · <b className="late">{late} quá hạn</b></> : null}</> : ' · không đặt hạn'}</p>
      <div className="wrap"><table className="systable"><thead><tr><th>Học sinh</th><th>Lớp</th><th>Đã học</th><th>Học gần nhất</th><th className="num">Điểm TB đề</th><th>Trạng thái</th></tr></thead><tbody>
        {list.slice(0, 500).map(r => { const [t, c] = state(r)
          return <tr key={r.student_id} className={r.overdue ? 'overdue' : ''}><td>{r.full_name}</td><td>{r.class_name}</td>
            <td><span className="ibar" title={`${r.done}/${r.total} bài`}><i style={{ width: (r.total ? (100 * r.done) / r.total : 0) + '%', background: r.overdue ? 'var(--bad)' : 'var(--ok)' }} /><b>{r.done}/{r.total}</b></span></td>
            <td><small>{dt(r.last_done_at) || '—'}</small></td><td className="num">{r.exam_avg ?? '—'}</td><td><span className={'pill ' + c}>{t}</span></td></tr> })}
        {!list.length && <tr><td colSpan={6}>{rows.length ? 'Không có học sinh nào.' : 'Chưa có học sinh nào được giao khoá học này.'}</td></tr>}
      </tbody></table></div>
    </section>
  )
}

// Danh sách làm bài theo học sinh được giao đề (exam_roster, 061) — gồm cả học sinh chưa làm
type Ros = { student_id: string; full_name: string; class_name: string | null; attempts: number; best: number | null; last_score: number | null; last_at: string | null }
function ExamRoster({ exam }: { exam: Exam }) {
  const [rows, setRows] = useState<Ros[] | null>(null)
  const [err, setErr] = useState('')
  const [only, setOnly] = useState<'' | 'none' | 'done'>('')
  useEffect(() => {
    supabase.rpc('exam_roster', { p_exam: exam.id }).then(({ data, error }) => { if (error) setErr(errText(error.message, '061')); setRows((data as Ros[]) ?? []) })
  }, [exam.id])
  if (!rows) return <p className="sub">Đang tải danh sách…</p>
  const done = rows.filter(r => r.attempts > 0).length
  const list = rows.filter(r => only === 'none' ? !r.attempts : only === 'done' ? r.attempts > 0 : true)
  return (
    <section className="panel">
      <div className="bar"><h3>Danh sách làm bài <small>· {done}/{rows.length} học sinh đã làm</small></h3>
        <span className="tools">
          <select value={only} onChange={e => setOnly(e.target.value as typeof only)} aria-label="Lọc danh sách"><option value="">Tất cả ({rows.length})</option><option value="none">Chưa làm ({rows.length - done})</option><option value="done">Đã làm ({done})</option></select>
          <button disabled={!rows.length} onClick={() => downloadXlsx('danh-sach-lam-bai-' + exam.title.slice(0, 40), [{ key: 'a', label: 'Họ tên', width: 26 }, { key: 'b', label: 'Lớp' }, { key: 'c', label: 'Số lượt' },
            { key: 'd', label: 'Điểm cao nhất' }, { key: 'e', label: 'Điểm lần cuối' }, { key: 'f', label: 'Nộp lần cuối', width: 18 }],
            rows.map(r => [r.full_name, r.class_name, r.attempts, r.best, r.last_score, dt(r.last_at)]))}>Xuất Excel</button>
        </span></div>
      {err && <p className="msg">{err}</p>}
      <div className="wrap"><table className="systable"><thead><tr><th>Học sinh</th><th>Lớp</th><th className="num">Số lượt</th><th className="num">Cao nhất</th><th className="num">Lần cuối</th><th>Nộp lần cuối</th></tr></thead><tbody>
        {list.slice(0, 500).map(r => <tr key={r.student_id} className={r.attempts ? '' : 'dim'}><td>{r.full_name}</td><td>{r.class_name}</td>
          <td className="num">{r.attempts || <span className="pill">Chưa làm</span>}</td><td className="num"><b>{r.best ?? '—'}</b></td><td className="num">{r.last_score ?? '—'}</td><td><small>{dt(r.last_at)}</small></td></tr>)}
        {!list.length && <tr><td colSpan={6}>{rows.length ? 'Không có học sinh nào.' : 'Đề chưa giao cho học sinh nào.'}</td></tr>}
      </tbody></table></div>
    </section>
  )
}
