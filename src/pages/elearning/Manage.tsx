import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { Tabs } from '../teacher/common'
import QuestionBank from './Bank'
import { ESTATUS, LEVEL, LKIND, SHOW, errText, type Attempt, type Course, type Exam, type Lesson, type Level, type Question } from './common'

// E-learning & luyện thi (GV, trường, Sở, KDI): đề luyện, khoá học, ngân hàng câu hỏi.
type Cls = { id: string; name: string; grade: number | null }
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '')
const NOT_OWNER = 'Chỉ người tạo hoặc quản trị đơn vị được sửa nội dung này.'
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

export default function ElearningManage({ orgId }: { orgId: string | null }) {
  const [tab, setTab] = useState<'exam' | 'course' | 'bank'>('exam')
  return <>
    <Tabs value={tab} onChange={setTab} items={[['exam', 'Đề luyện'], ['course', 'Khoá học e-learning'], ['bank', 'Ngân hàng câu hỏi']]} />
    {tab === 'exam' ? <Exams orgId={orgId} /> : tab === 'course' ? <Courses orgId={orgId} /> : <QuestionBank orgId={orgId} />}
  </>
}

function useOrgCtx(orgId: string | null) {
  const [classes, setClasses] = useState<Cls[]>([])
  const [type, setType] = useState('school')
  const [me, setMe] = useState<string | null>(null)
  useEffect(() => {
    if (!orgId) return
    supabase.from('classes').select('id, name, grade').eq('org_id', orgId).order('grade').order('name').then(({ data }) => setClasses((data as Cls[]) ?? []))
    supabase.from('organizations').select('type').eq('id', orgId).maybeSingle().then(({ data }) => setType((data as any)?.type ?? 'school'))
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null))
  }, [orgId])
  return { classes, isSchool: type === 'school', me }
}

function ClassPicker({ classes, value, onChange }: { classes: Cls[]; value: string[] | null; onChange: (v: string[] | null) => void }) {
  const all = !value || value.length === 0
  return (
    <div className="field wide"><span>Giao cho</span>
      <div className="tools">
        <label className="field inline"><input type="checkbox" checked={all} onChange={e => onChange(e.target.checked ? null : classes.slice(0, 1).map(c => c.id))} /> Mọi học sinh của trường</label>
        {!all && classes.map(c => <label key={c.id} className="field inline"><input type="checkbox" checked={value!.includes(c.id)}
          onChange={e => onChange(e.target.checked ? [...value!, c.id] : value!.filter(x => x !== c.id))} /> {c.name}</label>)}
      </div>
    </div>
  )
}

// ================= Đề luyện =================
type EForm = Omit<Exam, 'id' | 'org_id' | 'created_by' | 'created_at'> & { id?: string }
const EEMPTY: EForm = { title: '', description: '', subject: '', grade: null, mode: 'random', question_ids: [], criteria: { count: 10, levels: {}, topics: [] },
  duration_min: 15, max_attempts: 0, show_answers: 'after_submit', class_ids: null, shared: false, opens_at: new Date().toISOString(), closes_at: null, status: 'draft' }

function Exams({ orgId }: { orgId: string | null }) {
  const { classes, isSchool } = useOrgCtx(orgId)
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
    const payload = { ...body, subject: body.subject?.trim() || null, description: body.description?.trim() || null, class_ids: isSchool ? body.class_ids : null, shared: isSchool ? false : body.shared }
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
  return (
    <>
      <div className="bar"><button className="primary" onClick={() => setForm({ ...EEMPTY, shared: !isSchool })}>Tạo đề luyện</button></div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && <ExamForm form={form} setForm={setForm} onSubmit={save} classes={classes} isSchool={isSchool} />}
      <div className="wrap"><table className="systable">
        <thead><tr><th>Đề luyện</th><th>Cách ra đề</th><th>Thời gian</th><th>Mở</th><th className="num">Lượt nộp</th><th className="num">Điểm TB</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{rows.map(x => { const c = counts.get(x.id); return <Fragment key={x.id}>
          <tr className="clickrow" onClick={() => setOpen(open === x.id ? null : x.id)}>
            <td><b>{x.title}</b><br /><small>{[x.subject, x.grade ? 'Khối ' + x.grade : null, !editable(x) ? 'của cấp trên' : x.shared ? 'dùng chung' : x.class_ids?.length ? `${x.class_ids.length} lớp` : null].filter(Boolean).join(' · ')}</small></td>
            <td>{x.mode === 'random' ? `Ngẫu nhiên ${x.criteria.count} câu` : `Cố định ${x.question_ids.length} câu`}</td>
            <td>{x.duration_min ? `${x.duration_min} phút` : 'Không giới hạn'}{x.max_attempts ? <><br /><small>{x.max_attempts} lượt</small></> : null}</td>
            <td><small>{dt(x.opens_at)}{x.closes_at ? ` → ${dt(x.closes_at)}` : ''}</small></td>
            <td className="num">{c?.n ?? 0}<br /><small>{c?.students.size ?? 0} HS</small></td>
            <td className="num">{c?.n ? (c.sum / c.n).toFixed(1) : '—'}</td>
            <td><span className={'pill ' + ESTATUS[x.status][1]}>{ESTATUS[x.status][0]}</span></td>
            <td onClick={e => e.stopPropagation()}>{editable(x) && <span className="tools">
              {x.status === 'draft' && <button className="primary" onClick={() => setStatus(x, 'published')}>Công bố</button>}
              {x.status === 'published' && <button onClick={() => setStatus(x, 'closed')}>Đóng</button>}
              {x.status === 'closed' && <button onClick={() => setStatus(x, 'published')}>Mở lại</button>}
              <button onClick={() => { const { id, title, description, subject, grade, mode, question_ids, criteria, duration_min, max_attempts, show_answers, class_ids, shared, opens_at, closes_at, status } = x
                setForm({ id, title, description, subject, grade, mode, question_ids, criteria: { levels: {}, topics: [], ...criteria }, duration_min, max_attempts, show_answers, class_ids, shared, opens_at, closes_at, status }) }}>Sửa</button>
            </span>}</td>
          </tr>
          {open === x.id && <tr><td colSpan={8}><ExamResults exam={x} /></td></tr>}
        </Fragment> })}
          {!rows.length && <tr><td colSpan={8}>Chưa có đề luyện. Tạo đề ngẫu nhiên từ ngân hàng câu hỏi (theo môn, khối, mức độ) hoặc chọn từng câu.</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}

function ExamForm({ form, setForm, onSubmit, classes, isSchool }: { form: EForm; setForm: (f: EForm | null) => void; onSubmit: (e: React.FormEvent) => void; classes: Cls[]; isSchool: boolean }) {
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
      {isSchool ? <ClassPicker classes={classes} value={form.class_ids} onChange={v => set({ class_ids: v })} />
        : <label className="field inline wide"><input type="checkbox" checked={form.shared} onChange={e => set({ shared: e.target.checked })} /> Giao cho học sinh mọi trường trực thuộc</label>}
      <label className="field wide"><span>Hướng dẫn cho học sinh</span><textarea rows={2} value={form.description ?? ''} onChange={e => set({ description: e.target.value })} /></label>
      <div className="actions wide"><button className="primary">{form.id ? 'Lưu đề' : 'Tạo đề (nháp)'}</button><button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
    </form>
  )
}

function ExamResults({ exam }: { exam: Exam }) {
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
      <div className="appgrid">
        <section className="panel"><div className="bar"><h3>Điểm cao nhất của từng học sinh</h3>
          <button onClick={() => downloadXlsx('ket-qua-' + exam.title.slice(0, 40), [{ key: 'a', label: 'Mã HS' }, { key: 'b', label: 'Họ tên', width: 26 }, { key: 'c', label: 'Lớp' }, { key: 'd', label: 'Điểm' }, { key: 'e', label: 'Đúng' }, { key: 'f', label: 'Nộp lúc', width: 18 }],
            best.map(r => [r.students?.student_code, r.students?.full_name, r.students?.classes?.name, r.score, `${r.correct}/${r.total}`, dt(r.submitted_at)]))} disabled={!best.length}>Xuất Excel</button></div>
          <div className="wrap"><table className="systable"><thead><tr><th>Học sinh</th><th>Lớp</th><th className="num">Điểm</th><th>Nộp lúc</th></tr></thead><tbody>
            {best.slice(0, 200).map(r => <tr key={r.id}><td>{r.students?.full_name ?? <small>Học sinh trường khác</small>}</td><td>{r.students?.classes?.name}</td><td className="num"><b>{r.score}</b> <small>({r.correct}/{r.total})</small></td><td><small>{dt(r.submitted_at)}{r.late ? ' · quá giờ' : ''}</small></td></tr>)}
            {!best.length && <tr><td colSpan={4}>Chưa có học sinh nộp bài.</td></tr>}
          </tbody></table></div></section>
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
const CEMPTY: CForm = { title: '', description: '', subject: '', grade: null, cover_url: null, class_ids: null, shared: false, status: 'draft' }

function Courses({ orgId }: { orgId: string | null }) {
  const { classes, isSchool } = useOrgCtx(orgId)
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
    const payload = { ...body, subject: body.subject?.trim() || null, description: body.description?.trim() || null, cover_url: body.cover_url?.trim() || null, class_ids: isSchool ? body.class_ids : null, shared: isSchool ? false : body.shared }
    const { data, error } = id ? await supabase.from('courses').update(payload).eq('id', id).select('id') : await supabase.from('courses').insert({ ...payload, org_id: orgId }).select('id')
    if (error) return setMsg([errText(error.message), true])
    if (!data?.length) return setMsg([NOT_OWNER, true])
    setForm(null); setMsg(['Đã lưu khoá học.', false]); load()
  }
  async function setStatus(c: Course, status: Course['status']) {
    const { data, error } = await supabase.from('courses').update({ status }).eq('id', c.id).select('id')
    if (error) setMsg([errText(error.message), true]); else if (!data?.length) setMsg([NOT_OWNER, true]); else load()
  }
  return (
    <>
      <div className="bar"><button className="primary" onClick={() => setForm({ ...CEMPTY, shared: !isSchool })}>Tạo khoá học</button></div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && <form className="panel formgrid" onSubmit={save}>
        <label className="field wide"><span>Tên khoá học *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Lập trình Arduino cơ bản" /></label>
        <label className="field"><span>Môn</span><input value={form.subject ?? ''} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
        <label className="field"><span>Khối</span><input type="number" min={1} max={12} value={form.grade ?? ''} onChange={e => setForm({ ...form, grade: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field"><span>Ảnh bìa (https://…)</span><input value={form.cover_url ?? ''} onChange={e => setForm({ ...form, cover_url: e.target.value })} /></label>
        <label className="field wide"><span>Giới thiệu</span><textarea rows={3} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        {isSchool ? <ClassPicker classes={classes} value={form.class_ids} onChange={v => setForm({ ...form, class_ids: v })} />
          : <label className="field inline wide"><input type="checkbox" checked={form.shared} onChange={e => setForm({ ...form, shared: e.target.checked })} /> Dành cho học sinh mọi trường trực thuộc</label>}
        <div className="actions wide"><button className="primary">Lưu khoá học</button><button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
      </form>}
      <div className="coursegrid">
        {rows.map(c => { const ls = lessons.filter(l => l.course_id === c.id); const mine = c.org_id === orgId
          return <section key={c.id} className={'panel coursecard' + (open === c.id ? ' wide' : '')}>
            <header>
              <div><b>{c.title}</b><small>{[c.subject, c.grade ? 'Khối ' + c.grade : null, `${ls.length} bài`, !mine ? 'của cấp trên' : c.shared ? 'dùng chung' : c.class_ids?.length ? `${c.class_ids.length} lớp` : null].filter(Boolean).join(' · ')}</small></div>
              <span className={'pill ' + ESTATUS[c.status][1]}>{ESTATUS[c.status][0]}</span>
            </header>
            {c.description && <p className="sub">{c.description}</p>}
            <div className="tools">
              <button onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Thu gọn' : mine ? 'Bài học & tiến độ' : 'Xem bài học'}</button>
              {mine && c.status === 'draft' && <button className="primary" onClick={() => setStatus(c, 'published')} disabled={!ls.length}>Công bố</button>}
              {mine && c.status === 'published' && <button onClick={() => setStatus(c, 'archived')}>Lưu trữ</button>}
              {mine && c.status === 'archived' && <button onClick={() => setStatus(c, 'published')}>Mở lại</button>}
              {mine && <button onClick={() => { const { id, title, description, subject, grade, cover_url, class_ids, shared, status } = c; setForm({ id, title, description, subject, grade, cover_url, class_ids, shared, status }) }}>Sửa</button>}
            </div>
            {open === c.id && <LessonEditor course={c} lessons={ls} exams={exams} progress={progress} editable={mine} onChange={load} />}
          </section> })}
        {!rows.length && <p className="sub">Chưa có khoá học. Một khoá gồm nhiều bài: video (YouTube, Google Drive…), bài đọc, liên kết và đề luyện.</p>}
      </div>
    </>
  )
}

function LessonEditor({ course, lessons, exams, progress, editable, onChange }: { course: Course; lessons: Lesson[]; exams: Exam[]; progress: Map<string, number>; editable: boolean; onChange: () => void }) {
  const [f, setF] = useState<Partial<Lesson> | null>(null)
  const [err, setErr] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f) return
    const body = { course_id: course.id, title: f.title, kind: f.kind, url: f.url?.trim() || null, body: f.body?.trim() || null, exam_id: f.kind === 'exam' ? f.exam_id : null,
      duration_min: f.duration_min || null, position: f.position ?? (lessons.length ? Math.max(...lessons.map(l => l.position)) + 1 : 1) }
    const { error } = f.id ? await supabase.from('course_lessons').update(body).eq('id', f.id) : await supabase.from('course_lessons').insert(body)
    if (error) return setErr(errText(error.message))
    setF(null); setErr(''); onChange()
  }
  async function move(l: Lesson, d: number) {
    const i = lessons.findIndex(x => x.id === l.id), o = lessons[i + d]; if (!o) return
    await supabase.from('course_lessons').update({ position: o.position }).eq('id', l.id); await supabase.from('course_lessons').update({ position: l.position }).eq('id', o.id); onChange()
  }
  return (
    <div className="lessons">
      <ol>{lessons.map((l, i) => <li key={l.id}>
        <span className="lk">{LKIND[l.kind]}</span><b>{l.title}</b>{l.duration_min ? <small> · {l.duration_min} phút</small> : null}
        <small className="done">{progress.get(l.id) ?? 0} HS đã học</small>
        {editable && <span className="tools"><button className="xbtn" disabled={!i} onClick={() => move(l, -1)} aria-label="Lên">↑</button><button className="xbtn" disabled={i === lessons.length - 1} onClick={() => move(l, 1)} aria-label="Xuống">↓</button>
          <button className="xbtn" onClick={() => setF(l)}>Sửa</button><button className="xbtn" onClick={async () => { if (confirm('Xoá bài này?')) { await supabase.from('course_lessons').delete().eq('id', l.id); onChange() } }}>Xoá</button></span>}
      </li>)}</ol>
      {!lessons.length && <p className="sub">Khoá chưa có bài học.</p>}
      {editable && !f && <button onClick={() => setF({ kind: 'video', title: '' })}>+ Thêm bài học</button>}
      {f && <form className="formgrid" onSubmit={save}>
        <label className="field"><span>Loại bài</span><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Lesson['kind'] })}>{Object.entries(LKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field wide"><span>Tên bài *</span><input required value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        {(f.kind === 'video' || f.kind === 'link') && <label className="field wide"><span>Đường dẫn *</span><input required type="url" value={f.url ?? ''} onChange={e => setF({ ...f, url: e.target.value })} placeholder={f.kind === 'video' ? 'https://www.youtube.com/watch?v=… hoặc Google Drive' : 'https://…'} /></label>}
        {f.kind === 'exam' && <label className="field wide"><span>Đề luyện *</span><select required value={f.exam_id ?? ''} onChange={e => setF({ ...f, exam_id: e.target.value })}><option value="">Chọn đề đã công bố…</option>{exams.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>}
        <label className="field wide"><span>{f.kind === 'reading' ? 'Nội dung bài đọc (Markdown) *' : 'Ghi chú cho học sinh'}</span><textarea rows={f.kind === 'reading' ? 8 : 2} required={f.kind === 'reading'} value={f.body ?? ''} onChange={e => setF({ ...f, body: e.target.value })} /></label>
        <label className="field"><span>Thời lượng (phút)</span><input type="number" min={1} max={600} value={f.duration_min ?? ''} onChange={e => setF({ ...f, duration_min: e.target.value ? Number(e.target.value) : null })} /></label>
        {err && <p className="msg">{err}</p>}
        <div className="actions wide"><button className="primary">Lưu bài học</button><button type="button" onClick={() => setF(null)}>Huỷ</button></div>
      </form>}
    </div>
  )
}
