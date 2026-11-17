import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { HeadAction, HeadTabs } from '../../components/PageFrame'
import { TryButton, type TrySpec } from '../../components/ExamTryout'
import { useEffect, useMemo, useState } from 'react'
import { DataTable, SideSplit, type Col } from '../../components/DataTable'
import { gridKey, gridPaste, gridMouseDown } from '../../components/sheetGrid'
import { LongCell } from '../../components/LongCell'
import { InfoTip } from '../../components/InfoTip'
import { Icon } from '../../components/Icon'
import ImportExcel from '../../components/ImportExcel'
import { Drawer } from '../../components/Drawer'
import { useGradeTree } from '../../components/GradeTree'
import { MultiSelect } from '../../components/MultiSelect'
import { GradeChecks, GradeMulti, SubjectMulti } from '../../components/Pickers'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, importSummary, type Column } from '../../lib/sheet'
import { OrgPick, useAllMode, useOrgName } from '../../components/OrgScope'
import { uploadLearningFile, openFile, MAX_FILE_MB } from '../../lib/files'
import { Tabs } from '../teacher/common'
import QuestionBank from './Bank'
import Analytics from './Analytics'
import { ElView } from '../../components/ElView'
import { DetailHead } from '../../components/DetailHead'
import { ActionBar, type Act } from '../../components/ActionBar'
import { useOrgFilter } from '../../components/OrgFilters'
import { StatCards } from '../../components/StatCards'
import { useSubjects } from '../subjects'
import { ExamMatrix, matrixTotal, type MRow } from '../../components/ExamMatrix'
import { QuestionPicker } from '../../components/QuestionPicker'
import { ESTATUS, LEVEL, LKIND, SHOW, courseGrades, courseMeta, courseSubjects, dueBadge, errText, gradesText, qGrades, pathName, type Attempt, type Course, type Exam, type Lesson, type Level, type Question, type Topic, groupLessons } from './common'

// E-learning & luyện thi (GV, trường, Sở, KDI): đề luyện, khoá học, phân tích kết quả, ngân hàng câu hỏi.
type Cls = { id: string; name: string; grade: number | null }
type Grp = { id: string; name: string; class_id: string }
type Stu = { id: string; full_name: string; student_code: string | null; classes: { name: string } | null }
type Aud = { class_ids: string[] | null; group_ids: string[] | null; student_ids: string[] | null }
const some = (a: string[] | null | undefined) => (a?.length ? a : null)
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '')
const NOT_OWNER = 'Chỉ người tạo hoặc quản trị đơn vị được sửa nội dung này.'
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

type OrgF = ReturnType<typeof useOrgFilter>
export default function ElearningManage({ orgId }: { orgId: string | null }) {
  const [tab, setTab] = useState<'exam' | 'course' | 'hard' | 'review' | 'bank'>('course')
  // Bộ lọc Tỉnh / trường dùng chung cho tab Đề luyện và Khoá học, để số trên thẻ chạy theo bộ lọc
  const ofl = useOrgFilter()
  return <>
    <HeadTabs><Tabs value={tab} onChange={setTab} items={[['course', 'Khoá học e-learning'], ['exam', 'Đề luyện'], ['hard', 'Câu hỏi khó'], ['review', 'Nội dung cần ôn'], ['bank', 'Ngân hàng câu hỏi']]} /></HeadTabs>
    {(tab === 'course' || tab === 'exam') && <ElCards orgId={orgId} ofl={ofl} tab={tab} />}
    {tab === 'exam' ? <Exams orgId={orgId} ofl={ofl} /> : tab === 'course' ? <Courses orgId={orgId} ofl={ofl} /> : tab === 'hard' || tab === 'review' ? <Analytics key={tab} orgId={orgId} kind={tab} />
      : <QuestionBank orgId={orgId} />}
  </>
}

// Thẻ tổng hợp riêng của từng tab (theo bộ lọc Tỉnh / trường). Câu hỏi khó, Nội dung cần ôn, Ngân hàng câu hỏi có thẻ riêng trong tab.
function ElCards({ orgId, ofl, tab }: { orgId: string | null; ofl: OrgF; tab: 'course' | 'exam' }) {
  const [d, setD] = useState<{ courses: { org_id: string; status: string }[]; exams: { id: string; org_id: string; status: string }[]; att: { exam_id: string; student_id: string; score: number | null }[] } | null>(null)
  useEffect(() => {
    Promise.all([supabase.from('courses').select('org_id, status'), supabase.from('practice_exams').select('id, org_id, status'),
      supabase.from('exam_attempts').select('exam_id, student_id, score').eq('status', 'submitted').limit(20000)])
      .then(([c, e, a]) => setD({ courses: (c.data as any[]) ?? [], exams: (e.data as any[]) ?? [], att: (a.data as any[]) ?? [] }))
  }, [orgId])
  const cs = (d?.courses ?? []).filter(c => ofl.fit(c.org_id)), es = (d?.exams ?? []).filter(x => ofl.fit(x.org_id))
  const ids = new Set(es.map(x => x.id)), at = (d?.att ?? []).filter(x => ids.has(x.exam_id))
  const pub = cs.filter(c => c.status === 'published').length, draft = cs.filter(c => c.status === 'draft').length
  const avg = at.length ? at.reduce((n, x) => n + Number(x.score ?? 0), 0) / at.length : null
  const w = (v: number | string) => (d ? v : '…')
  if (tab === 'course') return <StatCards items={[
    { icon: 'book', value: w(cs.length), label: 'Khoá học' },
    { icon: 'eye', tone: 'good', value: w(pub), label: 'Đang mở' },
    { icon: 'edit', value: w(draft), label: 'Nháp' },
    { icon: 'inbox', value: w(cs.filter(c => c.status === 'archived').length), label: 'Đã lưu trữ' },
  ]} />
  return <StatCards items={[
    { icon: 'clipboard', value: w(es.length), label: 'Đề luyện', sub: d ? `${es.filter(x => x.status === 'published').length} đang mở` : undefined },
    { icon: 'users', value: w(at.length.toLocaleString('vi-VN')), label: 'Lượt học sinh làm bài', sub: d ? `${new Set(at.map(x => x.student_id)).size} học sinh` : undefined },
    { icon: 'trophy', tone: avg == null ? '' : avg >= 5 ? 'good' : 'warn', value: w(avg == null ? '—' : avg.toFixed(1)), label: 'Điểm trung bình', sub: 'Thang 10, các bài đã nộp' },
  ]} />
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
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Stu[]>([])
  const [known, setKnown] = useState<Map<string, Stu>>(new Map())
  const cls = value.class_ids ?? [], grp = value.group_ids ?? [], st = value.student_ids ?? []
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
        <label className="field inline"><input type="radio" checked={!targeted} onChange={() => { setTargeted(false); onChange({ class_ids: null, group_ids: null, student_ids: null }) }} /> Tất cả học sinh của trường</label>
        <label className="field inline"><input type="radio" checked={targeted} onChange={() => setTargeted(true)} /> Chọn lớp, nhóm hoặc học sinh</label>
      </div>
      {targeted && <div className="audience">
        <div><small>Lớp</small>
          <MultiSelect value={cls} onChange={v => set({ class_ids: v })} options={classes.map(c => [c.id, c.name])} placeholder="Chọn lớp…" ariaLabel="Lớp" empty="Trường chưa có lớp." /></div>
        <div><small>Nhóm học sinh</small>
          {withGroups.length ? <MultiSelect value={grp} onChange={v => set({ group_ids: v })} placeholder="Chọn nhóm…" ariaLabel="Nhóm học sinh"
            options={withGroups.flatMap(c => groups.filter(g => g.class_id === c.id).map(g => ({ value: g.id, label: `${g.name} · ${c.name}`, group: c.name })))} />
            : <small> — chưa lớp nào chia nhóm (chia nhóm trong mục Bài tập).</small>}
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
        {!cls.length && !grp.length && !st.length && <p className="msg">Chưa chọn lớp, nhóm hay học sinh nào — nội dung sẽ dành cho tất cả học sinh của trường.</p>}
      </div>}
    </div>
  )
}

// ================= Đề luyện =================
// Cấu hình làm thử theo cách ra đề: ma trận / ngẫu nhiên theo mức độ / cố định
const examSpec = (x: Pick<Exam, 'mode' | 'subject' | 'grade' | 'subjects' | 'grades' | 'question_ids' | 'criteria' | 'shuffle'>): TrySpec =>
  x.mode === 'fixed' ? { kind: 'pick', qids: x.question_ids, shuffle: !!x.shuffle }
  : x.criteria.matrix ? { kind: 'pick', subjects: courseSubjects(x), grades: courseGrades(x), matrix: x.criteria.matrix, qids: x.question_ids ?? [], shuffle: !!x.shuffle }
  : { kind: 'levels', subjects: courseSubjects(x), grades: courseGrades(x), count: x.criteria.count ?? 10, topics: x.criteria.topics ?? [],
      levels: Object.fromEntries(Object.entries(x.criteria.levels ?? {}).filter(([, v]) => v != null)) as Record<string, number> }
type EForm = Omit<Exam, 'id' | 'org_id' | 'created_by' | 'created_at'> & { id?: string; org?: string }
const EEMPTY: EForm = { title: '', description: '', subject: '', grade: null, subjects: [], grades: [], mode: 'fixed', question_ids: [], criteria: { count: 0, levels: {}, topics: [], matrix: [] },
  duration_min: 15, max_attempts: 0, show_answers: 'after_submit', class_ids: null, group_ids: null, student_ids: null, shared: false, opens_at: new Date().toISOString(), closes_at: null, status: 'draft', shuffle: true }
const howText = (x: Exam) => {
  const fixed = x.question_ids?.length ?? 0
  if (x.mode === 'fixed') return `${fixed} câu cố định`
  const rnd = x.criteria.matrix?.length ? matrixTotal(x.criteria.matrix) : x.criteria.count ?? 0
  return [fixed ? `${fixed} câu cố định` : '', `${rnd} câu rút ngẫu nhiên`].filter(Boolean).join(' + ')
}
// Đề cũ "ngẫu nhiên theo mức độ" → ma trận (chủ đề trống = mọi chủ đề)
function toMatrix(c: Exam['criteria']): MRow[] {
  if (c.matrix) return [...c.matrix]
  const topic = c.topics?.length === 1 ? c.topics[0] : ''
  const rows: MRow[] = Object.entries(c.levels ?? {}).filter(([, v]) => v != null && Number(v) > 0).map(([level, v]) => ({ topic, level, count: Number(v) }))
  const rest = (c.count ?? 0) - matrixTotal(rows)
  if (rest > 0) rows.push({ topic, level: '', count: rest })
  return rows
}

/** Đề kiểm tra của một môn học (109): danh sách đề của môn, tạo đề có sẵn môn */
export function SubjectExams({ orgId, subject }: { orgId: string | null; subject: string }) { return <Exams orgId={orgId} subject={subject} /> }

function Exams({ orgId, subject, ofl: shared }: { orgId: string | null; subject?: string; ofl?: OrgF }) {
  const { classes, groups, isSchool } = useOrgCtx(orgId)
  // Quản trị hệ thống: thấy đề của tất cả đơn vị, sửa thẳng; thêm mới thì chọn đơn vị ra đề
  const every = useAllMode(), orgName = useOrgName()
  const schoolOf = (id?: string | null) => every ? every.find(o => o.id === id)?.type === 'school' : isSchool
  const [rows, setRows] = useState<Exam[]>([])
  const [counts, setCounts] = useState<Map<string, { n: number; students: Set<string>; sum: number }>>(new Map())
  const own = useOrgFilter(), ofl = shared ?? own
  const [form, setForm] = useState<EForm | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [e, a] = await Promise.all([supabase.from('practice_exams').select('*').order('created_at', { ascending: false }),
      supabase.from('exam_attempts').select('exam_id, student_id, score, status').eq('status', 'submitted').limit(20000)])
    if (e.error) setMsg([errText(e.error.message), true])
    setRows(((e.data as Exam[]) ?? []).filter(x => !subject || x.subject === subject))
    const m = new Map<string, { n: number; students: Set<string>; sum: number }>()
    ;((a.data as any[]) ?? []).forEach(x => { const v = m.get(x.exam_id) ?? { n: 0, students: new Set(), sum: 0 }; v.n++; v.students.add(x.student_id); v.sum += Number(x.score ?? 0); m.set(x.exam_id, v) })
    setCounts(m)
  }
  useEffect(() => { load() }, [orgId, subject])
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const mx = (form.criteria.matrix ?? []).filter(r => Number(r.count) > 0)
    if (!form.question_ids.length && !matrixTotal(mx)) return setMsg(['Đề cần ít nhất 1 câu: thêm câu hỏi hoặc đặt ma trận.', true])
    const { id, org, ...body0 } = form; const sch = schoolOf(org || orgId)
    const body = { ...body0, mode: (mx.length ? 'random' : 'fixed') as Exam['mode'], criteria: { levels: {}, topics: [], matrix: mx, count: matrixTotal(mx) } }
    const subs = courseSubjects(body), grs = courseGrades(body)
    const payload = { ...body, subjects: subs, grades: grs, subject: subs[0] ?? null, grade: grs[0] ?? null, description: body.description?.trim() || null, shared: sch ? false : body.shared,
      class_ids: sch ? some(body.class_ids) : null, group_ids: sch ? some(body.group_ids) : null, student_ids: sch ? some(body.student_ids) : null }
    const { data, error } = id ? await supabase.from('practice_exams').update(payload).eq('id', id).select('id') : await supabase.from('practice_exams').insert({ ...payload, org_id: org || orgId }).select('id')
    if (error) return setMsg([errText(error.message), true])
    if (!data?.length) return setMsg([NOT_OWNER, true])
    setMsg([id ? 'Đã lưu đề.' : 'Đã tạo đề.', false]); setForm(null); load()
  }
  async function setStatus(x: Exam, status: Exam['status']) {
    if (status === 'published' && x.replaces_id && !confirm('Công bố bản mới này? Bản đang dùng sẽ tự đóng; kết quả làm bài cũ vẫn giữ ở bản cũ.')) return
    const { data, error } = await supabase.from('practice_exams').update({ status }).eq('id', x.id).select('id')
    if (error) setMsg([errText(error.message), true]); else if (!data?.length) setMsg([NOT_OWNER, true]); else load()
  }
  const editable = (x: Exam) => x.org_id === orgId || !!every
  /** Đề đã công bố / đã đóng không sửa trực tiếp: tạo bản nháp mới (sao chép), sửa rồi công bố để thay bản cũ */
  const draftOf = (x: Exam) => rows.find(r => r.replaces_id === x.id && r.status === 'draft')
  async function newVersion(x: Exam) {
    const d = draftOf(x); if (d) { setMsg(null); setOpen(d.id); return }
    const { id: _i, created_at: _c, created_by: _b, ...rest } = x
    const nid = crypto.randomUUID()
    const { error } = await supabase.from('practice_exams').insert({ ...rest, id: nid, status: 'draft', replaces_id: x.id })
    if (error) return setMsg([errText(error.message), true])
    await load(); setOpen(nid); setMsg(['Đã tạo bản nháp mới từ đề này. Sửa xong bấm Công bố, bản cũ sẽ tự đóng.', false])
  }
  const editForm = (x: Exam) => { const { id, title, description, subject, grade, mode, question_ids, criteria, duration_min, max_attempts, show_answers, class_ids, group_ids, student_ids, shared, opens_at, closes_at, status, shuffle } = x
    setMsg(null); setForm({ id, org: x.org_id, title, description, subject, grade, subjects: courseSubjects(x), grades: courseGrades(x), mode, question_ids, criteria: { levels: {}, topics: [], ...criteria, matrix: toMatrix(criteria) }, duration_min, max_attempts, show_answers, class_ids, group_ids: group_ids ?? null, student_ids: student_ids ?? null, shared, opens_at, closes_at, status, shuffle: !!shuffle }) }
  const statusBtns = (x: Exam) => <>
    {x.status === 'draft' && <button className="primary" onClick={() => setStatus(x, 'published')}>Công bố</button>}
    {x.status === 'published' && <button onClick={() => setStatus(x, 'closed')}>Đóng</button>}
    {x.status === 'closed' && <button onClick={() => setStatus(x, 'published')}>Mở lại</button>}</>
  const note = msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>
  const fitRows = rows.filter(x => ofl.fit(x.org_id))
  const gt = useGradeTree('elearning-exams', fitRows, courseGrades, 'bài thi')
  // Thêm / sửa đề: trang riêng
  if (form) return <ElView back={open ? 'Chi tiết đề luyện' : 'Danh sách đề luyện'} onBack={() => setForm(null)} title={form.id ? 'Sửa đề luyện' : 'Tạo đề luyện'} sub={form.id ? form.title : undefined}>
    {note}<ExamForm form={form} setForm={setForm} onSubmit={save} orgId={orgId} classes={classes} groups={groups} isSchool={isSchool} /></ElView>
  // Chi tiết đề: trang riêng
  const cur = rows.find(x => x.id === open)
  if (cur) return <ElView back="Danh sách đề luyện" onBack={() => { setOpen(null); setMsg(null) }} title={cur.title}
    sub={<>{[courseSubjects(cur).join(', '), gradesText(courseGrades(cur)), howText(cur), cur.duration_min ? `${cur.duration_min} phút` : null,
      `${dt(cur.opens_at)}${cur.closes_at ? ' → ' + dt(cur.closes_at) : ''}`].filter(Boolean).join(' · ')} <span className={'pill ' + ESTATUS[cur.status][1]}>{ESTATUS[cur.status][0]}</span></>}
    actions={<><TryButton orgId={cur.org_id} spec={examSpec(cur)} title={cur.title} minutes={cur.duration_min} />{editable(cur) && <>{statusBtns(cur)}{cur.status === 'draft'
      ? <button onClick={() => editForm(cur)}>Sửa</button>
      : <button onClick={() => newVersion(cur)} title="Đề đã công bố không sửa trực tiếp: tạo bản nháp mới để sửa, công bố bản mới thì bản cũ tự đóng">{draftOf(cur) ? 'Mở bản nháp mới' : 'Phát hành bản mới'}</button>}</>}</>}>
    {note}{cur.replaces_id && cur.status === 'draft' && <p className="sub">Bản nháp mới thay cho đề <b>{rows.find(r => r.id === cur.replaces_id)?.title ?? 'cũ'}</b>. Công bố bản này thì đề cũ tự đóng.</p>}<ExamResults exam={cur} roster={schoolOf(cur.org_id) && editable(cur)} /></ElView>
  return (
    <>
      {note}
      <DataTable id="elearning-exams" rows={gt.filter(fitRows)} rowKey={x => x.id} aside={fitRows.length ? gt.tree : undefined} onRow={x => { setMsg(null); setOpen(x.id) }}
        empty={<small className="sub">{subject ? `Môn ${subject} chưa có đề. ` : ''}Chưa có đề luyện. Bấm “+ Tạo đề luyện”: chọn câu từ ngân hàng, thêm câu mới hoặc đặt ma trận rút ngẫu nhiên.</small>}
        left={ofl.node(rows.map(x => x.org_id))}
        right={<HeadAction><button type="button" className="primary ttadd" onClick={() => { setMsg(null); setForm({ ...EEMPTY, subject: subject ?? '', subjects: subject ? [subject] : [], title: subject ? `Đề kiểm tra ${subject}` : '', shared: !isSchool && !every }) }}>+ {subject ? 'Tạo đề kiểm tra' : 'Tạo đề luyện'}</button></HeadAction>}
        cols={[
          { key: 'title', label: 'Đề luyện', fixed: true, values: x => [x.title], text: x => [x.title, ...courseSubjects(x)].join(' '),
            cell: x => <><b>{x.title}</b><br /><small>{[courseSubjects(x).join(', '), gradesText(courseGrades(x)), !editable(x) ? 'của cấp trên' : every ? orgName(x.org_id) : isSchool ? audienceText(x, classes, groups) : x.shared ? 'dùng chung' : null].filter(Boolean).join(' · ')}</small></> },
          { key: 'subj', label: 'Môn', off: true, values: x => courseSubjects(x), text: x => courseSubjects(x).join(', '), cell: x => courseSubjects(x).join(', ') || '—' },
          { key: 'grade', label: 'Khối', off: true, values: x => courseGrades(x).map(g => 'Khối ' + g), text: x => courseGrades(x).join(', '), cell: x => courseGrades(x).join(', ') || '—' },
          { key: 'how', label: 'Câu hỏi', text: x => howText(x), cell: x => <>{howText(x)}{x.shuffle ? <><br /><small>trộn câu</small></> : null}</> },
          { key: 'time', label: 'Thời gian', text: x => x.duration_min ? `${x.duration_min} phút` : 'Không giới hạn', cell: x => <>{x.duration_min ? `${x.duration_min} phút` : 'Không giới hạn'}{x.max_attempts ? <><br /><small>{x.max_attempts} lượt</small></> : null}</> },
          { key: 'open', label: 'Mở', cell: x => <small>{dt(x.opens_at)}{x.closes_at ? ` → ${dt(x.closes_at)}` : ''}</small> },
          { key: 'n', label: 'Lượt nộp', thClass: 'num', cell: x => { const c = counts.get(x.id); return <>{c?.n ?? 0}<br /><small>{c?.students.size ?? 0} HS</small></> } },
          { key: 'avg', label: 'Điểm TB', thClass: 'num', cell: x => { const c = counts.get(x.id); return c?.n ? (c.sum / c.n).toFixed(1) : '—' } },
          { key: 'st', label: 'Trạng thái', text: x => ESTATUS[x.status][0], cell: x => <span className={'pill ' + ESTATUS[x.status][1]}>{ESTATUS[x.status][0]}</span> },
        ] as Col<Exam>[]} />
    </>
  )
}

function ExamForm({ form, setForm, onSubmit, orgId, classes, groups, isSchool }: { form: EForm; setForm: (f: EForm | null) => void; onSubmit: (e: React.FormEvent) => void; orgId: string | null; classes: Cls[]; groups: Grp[]; isSchool: boolean }) {
  // Quản trị hệ thống: lớp, nhóm và loại đơn vị theo đơn vị ra đề (không theo KDI)
  const every = useAllMode(), tctx = useOrgCtx(every ? form.org || null : null)
  if (every) { classes = tctx.classes; groups = tctx.groups; isSchool = !!form.org && tctx.isSchool; orgId = form.org || null }
  const set = (p: Partial<EForm>) => setForm({ ...form, ...p })
  const fs = courseSubjects(form), fg = courseGrades(form)
  const mx = form.criteria.matrix ?? []
  const total = form.question_ids.length + matrixTotal(mx)
  const S = (n: number) => ({ gridColumn: `span ${n}` })
  const spec = examSpec({ ...form, mode: mx.length ? 'random' : 'fixed', criteria: { ...form.criteria, matrix: mx } })
  return (
    <form className="pform pfwrap nonav noside" onSubmit={onSubmit}>
      <div className="pfmain">
        <section className="panel pfcard">
          <div className="pgrid">
            {!form.id && <div style={S(12)}><OrgPick kind="any" value={form.org ?? ''} onChange={org => set({ org, class_ids: null, group_ids: null, student_ids: null, shared: false })} title="Đơn vị ra đề" /></div>}
            <label className="field" style={S(12)}><span>Tên đề *</span><input required value={form.title} onChange={e => set({ title: e.target.value })} placeholder="VD: Luyện tập chương Điện — Khoa học tự nhiên 7" /></label>
            <div className="field" style={S(6)}><span>Môn (chọn được nhiều)</span><SubjectMulti value={fs} onChange={v => set({ subjects: v, subject: v[0] ?? null })} placeholder="Tất cả môn" ariaLabel="Môn của đề" /></div>
            <div className="field" style={S(6)}><span>Khối (chọn được nhiều)</span><GradeMulti value={fg} onChange={v => set({ grades: v, grade: v[0] ?? null })} /></div>
            <label className="field" style={S(3)}><span>Thời gian làm (phút)</span><input type="number" min={1} max={300} value={form.duration_min ?? ''} onChange={e => set({ duration_min: e.target.value ? Number(e.target.value) : null })} placeholder="Không giới hạn" /></label>
            <label className="field" style={S(3)}><span>Số lượt làm</span><input type="number" min={0} max={50} value={form.max_attempts} onChange={e => set({ max_attempts: Number(e.target.value) })} /><small className="sub">0 = không giới hạn</small></label>
            <label className="field" style={S(3)}><span>Hiện đáp án</span><select value={form.show_answers} onChange={e => set({ show_answers: e.target.value as EForm['show_answers'] })}>{Object.entries(SHOW).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <div className="field" style={S(3)}><span>Trộn câu</span><label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={!!form.shuffle} onChange={e => set({ shuffle: e.target.checked })} /> Trộn thứ tự câu mỗi lượt</label></div>
            <label className="field" style={S(6)}><span>Mở từ</span><input type="datetime-local" value={toLocal(form.opens_at)} onChange={e => set({ opens_at: new Date(e.target.value).toISOString() })} /></label>
            <label className="field" style={S(6)}><span>Đóng lúc</span><input type="datetime-local" value={toLocal(form.closes_at)} onChange={e => set({ closes_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
            <div className="field" style={S(12)}><span>Giao cho</span>{isSchool ? <AudiencePicker key={form.id ?? 'new'} orgId={orgId} classes={classes} groups={groups} value={form} onChange={v => set(v)} />
              : <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={form.shared} onChange={e => set({ shared: e.target.checked })} /> Học sinh tất cả trường trực thuộc</label>}</div>
            <label className="field" style={S(12)}><span>Hướng dẫn cho học sinh</span><textarea rows={2} value={form.description ?? ''} onChange={e => set({ description: e.target.value })} /></label>
          </div>
          <div className="bar" style={{ margin: '18px 0 8px', paddingTop: 14, borderTop: '1px solid var(--line)' }}><h4 style={{ margin: 0, fontSize: 'calc(15.5px * var(--fz,1))' }}>Câu hỏi của đề ({total} câu)</h4>
            <TryButton orgId={orgId} spec={spec} title={form.title || 'Đề luyện'} minutes={form.duration_min} disabled={!total} /></div>
          <QuestionPicker value={form.question_ids} onChange={ids => set({ question_ids: ids })} edit subjects={fs} grades={fg} title="Câu hỏi cố định"
            note="Câu chọn ở đây luôn có trong đề. Muốn rút ngẫu nhiên thêm từ ngân hàng theo chủ đề, mức độ thì đặt ma trận bên dưới." />
          <h4 className="libparthead" style={{ margin: '14px 0 6px' }}>Ma trận rút ngẫu nhiên (không bắt buộc)</h4>
          <ExamMatrix org={orgId} subjects={fs} grades={fg} rows={mx} onChange={m => set({ criteria: { ...form.criteria, matrix: m, count: matrixTotal(m) } })} />
          <div className="pfbtns">{!total ? <span className="pfmiss">Đề cần ít nhất 1 câu</span> : null}
            <button type="button" onClick={() => setForm(null)}>Huỷ</button>
            <button className="primary" type="submit" disabled={!total}>{form.id ? 'Lưu đề' : 'Tạo đề (nháp)'}</button></div>
        </section>
      </div>
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
type CForm = Omit<Course, 'id' | 'org_id' | 'created_by' | 'created_at'> & { id?: string; org?: string }
const CEMPTY: CForm = { title: '', description: '', subject: '', grade: null, subjects: [], grades: [], cover_url: null, class_ids: null, group_ids: null, student_ids: null, due_at: null, shared: false, status: 'draft' }

function Courses({ orgId, ofl: shared }: { orgId: string | null; ofl?: OrgF }) {
  const { classes, groups, isSchool } = useOrgCtx(orgId)
  const [rows, setRows] = useState<Course[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [progress, setProgress] = useState<Map<string, number>>(new Map())
  const [exams, setExams] = useState<Exam[]>([])
  const own = useOrgFilter(), ofl = shared ?? own
  const [form, setForm] = useState<CForm | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  // Khoá vừa tạo: mở thẳng trang chi tiết với ô thêm bài học sẵn sàng
  const [fresh, setFresh] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const subjList = useSubjects().subjects
  // Quản trị hệ thống: thấy khoá học của tất cả đơn vị, sửa thẳng; lớp/nhóm theo đơn vị của khoá đang soạn
  const every = useAllMode(), orgName = useOrgName(), tctx = useOrgCtx(every && form ? form.org || null : null)
  const fClasses = every ? tctx.classes : classes, fGroups = every ? tctx.groups : groups
  const fSchool = every ? !!form?.org && tctx.isSchool : isSchool, fOrg = every ? form?.org || null : orgId
  async function load() {
    const [c, l, p, e, t] = await Promise.all([supabase.from('courses').select('*').order('created_at', { ascending: false }), supabase.from('course_lessons').select('*').order('position'),
      supabase.from('course_progress').select('lesson_id').limit(50000), supabase.from('practice_exams').select('id, title, status').neq('status', 'draft'),
      supabase.from('course_topics').select('*').order('position')])
    setTopics((t.data as Topic[]) ?? [])
    if (c.error) setMsg([errText(c.error.message), true])
    setRows((c.data as Course[]) ?? []); setLessons((l.data as Lesson[]) ?? []); setExams((e.data as Exam[]) ?? [])
    const m = new Map<string, number>(); ((p.data as any[]) ?? []).forEach(x => m.set(x.lesson_id, (m.get(x.lesson_id) ?? 0) + 1)); setProgress(m)
  }
  useEffect(() => { load() }, [orgId])
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const { id, org, ...body } = form
    const subs = (body.subjects ?? []).map(x => x.trim()).filter(Boolean), grs = [...(body.grades ?? [])].sort((a, b) => a - b)
    const payload = { ...body, subjects: subs, grades: grs, subject: subs[0] ?? null, grade: grs[0] ?? null, description: body.description?.trim() || null, cover_url: body.cover_url?.trim() || null, shared: fSchool ? false : body.shared,
      class_ids: fSchool ? some(body.class_ids) : null, group_ids: fSchool ? some(body.group_ids) : null, student_ids: fSchool ? some(body.student_ids) : null }
    // Thêm mới không đọc lại dòng vừa tạo: chính sách đọc courses (course_visible) chưa thấy dòng mới trong cùng câu lệnh,
    // nên tạo sẵn id để mở thẳng khoá vừa tạo
    const newId = id ? null : crypto.randomUUID()
    const { data, error } = id ? await supabase.from('courses').update(payload).eq('id', id).select('id') : await supabase.from('courses').insert({ ...payload, id: newId, org_id: org || orgId })
    if (error) return setMsg([errText(error.message), true])
    if (id && !data?.length) return setMsg([NOT_OWNER, true])
    await load(); setForm(null)
    if (newId) { setOpen(newId); setFresh(newId); setMsg(['Đã tạo khoá học. Thêm bài học ngay bên dưới.', false]) }
    else setMsg(['Đã lưu khoá học.', false])
  }
  async function setStatus(c: Course, status: Course['status']) {
    if (status === 'published' && c.replaces_id && !confirm('Công bố bản mới này? Khoá đang dùng sẽ tự lưu trữ; tiến độ học của học sinh ở khoá cũ vẫn giữ ở khoá cũ.')) return
    const { data, error } = await supabase.from('courses').update({ status }).eq('id', c.id).select('id')
    if (error) setMsg([errText(error.message), true]); else if (!data?.length) setMsg([NOT_OWNER, true]); else load()
  }
  /** Khoá đã công bố / lưu trữ không sửa trực tiếp: sao chép thành bản nháp mới (cả chủ đề và bài học), công bố bản mới thì khoá cũ tự lưu trữ */
  const courseDraftOf = (c: Course) => rows.find(r => r.replaces_id === c.id && r.status === 'draft')
  async function newCourseVersion(c: Course) {
    const d = courseDraftOf(c); if (d) { setMsg(null); setOpen(d.id); return }
    const { id: _i, created_at: _c, created_by: _b, ...rest } = c
    const nid = crypto.randomUUID()
    const fail = (m: string) => setMsg([errText(m), true])
    const r1 = await supabase.from('courses').insert({ ...rest, id: nid, status: 'draft', replaces_id: c.id })
    if (r1.error) return fail(r1.error.message)
    const tmap = new Map<string, string>()
    const tps = topics.filter(t => t.course_id === c.id).map(t => { const id = crypto.randomUUID(); tmap.set(t.id, id); return { id, course_id: nid, position: t.position, title: t.title } })
    if (tps.length) { const r = await supabase.from('course_topics').insert(tps); if (r.error) return fail(r.error.message) }
    const ls = lessons.filter(l => l.course_id === c.id).map(l => { const { id: _l, course_id: _cc, ...lr } = l as Lesson & { topic_id?: string | null }
      return { ...lr, course_id: nid, topic_id: lr.topic_id ? tmap.get(lr.topic_id) ?? null : null } })
    if (ls.length) { const r = await supabase.from('course_lessons').insert(ls); if (r.error) return fail(r.error.message) }
    await load(); setOpen(nid); setMsg(['Đã tạo bản nháp mới từ khoá này (gồm chủ đề và bài học). Sửa xong bấm Công bố, khoá cũ sẽ tự lưu trữ.', false])
  }
  async function removeCourse(c: Course, done: () => void) {
    if (!confirm(`Xoá khoá học nháp "${c.title}"? Các bài học trong khoá cũng bị xoá.`)) return
    const { error } = await supabase.from('courses').delete().eq('id', c.id)
    if (error) return setMsg([errText(error.message), true])
    done(); setMsg(['Đã xoá khoá học.', false]); load()
  }
  const [side, setSide] = useState(() => { try { const v = localStorage.getItem('pd-side'); if (v) return v === '1' } catch { /* bỏ qua */ } return true })
  const toggleSide = () => setSide(v => { try { localStorage.setItem('pd-side', v ? '0' : '1') } catch { /* bỏ qua */ } return !v })
  const note = msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>
  const [view, setView] = useViewMode('el-courses')
  const fitC = rows.filter(c => ofl.fit(c.org_id))
  const gtc = useGradeTree('elearning-courses', fitC, courseGrades, 'khoá học')
  const shown = gtc.filter(fitC)
  const whom = (c: Course) => { const mine = c.org_id === orgId || !!every
    return !mine ? 'của cấp trên' : every ? orgName(c.org_id) : isSchool ? audienceText(c, classes, groups) : c.shared ? 'dùng chung' : null }
  const editCourse = (c: Course) => { const { id, title, description, subject, grade, cover_url, class_ids, group_ids, student_ids, due_at, shared, status } = c
    setMsg(null); setForm({ id, org: c.org_id, title, description, subject, grade, subjects: courseSubjects(c), grades: courseGrades(c), cover_url, class_ids, group_ids: group_ids ?? null, student_ids: student_ids ?? null, due_at: due_at ?? null, shared, status }) }
  const statusBtns = (c: Course, ls: Lesson[]) => <>
    {c.status === 'draft' && <button className="primary" onClick={() => setStatus(c, 'published')} disabled={!ls.length} title={ls.length ? undefined : 'Thêm ít nhất một bài học trước khi công bố'}>Công bố</button>}
    {c.status === 'published' && <button onClick={() => setStatus(c, 'archived')}>Lưu trữ</button>}
    {c.status === 'archived' && <button onClick={() => setStatus(c, 'published')}>Mở lại</button>}</>
  // Thêm / sửa khoá học: trang riêng
  if (form) {
    const fs = form.subjects ?? [], fg = form.grades ?? []
    const missing = [!form.title.trim() && 'Tên khoá học', !fs.length && 'Môn', !fg.length && 'Khối'].filter(Boolean) as string[]
    const S = (n: number) => ({ gridColumn: `span ${n}` })
    return <ElView back={open ? 'Chi tiết khoá học' : 'Khoá học e-learning'} onBack={() => setForm(null)} title={form.id ? 'Sửa khoá học' : 'Tạo khoá học'} sub={form.id ? form.title : undefined}>
      {note}
      <form className="pform pfwrap nonav noside" onSubmit={save}>
        <div className="pfmain">
          <section className="panel pfcard">
            <div className="pgrid">
              {!form.id && <div style={S(12)}><OrgPick kind="any" value={form.org ?? ''} onChange={org => setForm({ ...form, org, class_ids: null, group_ids: null, student_ids: null, shared: false })} title="Đơn vị mở khoá học" /></div>}
              <label className="field" style={S(12)}><span>Tên khoá học *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Lập trình Arduino cơ bản" /></label>
              <div className="field" style={S(6)}><span>Môn *</span>
                <SubjectMulti value={fs} onChange={v => setForm({ ...form, subjects: v, subject: v[0] ?? null })} placeholder="Chọn môn…" ariaLabel="Môn của khoá học" /></div>
              <div className="field" style={S(6)}><span>Khối *</span>
                <GradeChecks value={fg} onChange={v => setForm({ ...form, grades: v, grade: [...v].sort((a, b) => a - b)[0] ?? null })} ariaLabel="Khối của khoá học" /></div>
              <label className="field" style={S(6)}><span>Hạn hoàn thành</span><input type="datetime-local" value={toLocal(form.due_at)} onChange={e => setForm({ ...form, due_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
              <label className="field" style={S(6)}><span>Ảnh bìa (https://…)</span><input value={form.cover_url ?? ''} onChange={e => setForm({ ...form, cover_url: e.target.value })} placeholder="Không bắt buộc" /></label>
              <div className="field" style={S(12)}><span>Đối tượng</span>{fSchool ? <AudiencePicker key={(form.id ?? 'new') + fOrg} orgId={fOrg} classes={fClasses} groups={fGroups} value={form} onChange={v => setForm({ ...form, ...v })} />
                : <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={form.shared} onChange={e => setForm({ ...form, shared: e.target.checked })} /> Dành cho học sinh tất cả trường trực thuộc</label>}</div>
              <label className="field" style={S(12)}><span>Giới thiệu khoá học</span><textarea rows={4} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Học sinh thấy phần này khi mở khoá học" /></label>
            </div>
            <div className="pfbtns">{missing.length ? <span className="pfmiss">Còn thiếu: {missing.join(', ')}</span> : null}
              <button type="button" onClick={() => setForm(null)}>Huỷ</button>
              <button className="primary" type="submit" disabled={!!missing.length}>{form.id ? 'Lưu thay đổi' : 'Lưu & thêm bài học'}</button></div>
          </section>
        </div>
      </form></ElView>
  }
  // Chi tiết khoá học (bài học, tiến độ): trang riêng
  const cur = rows.find(c => c.id === open)
  if (cur) { const ls = lessons.filter(l => l.course_id === cur.id); const mine = cur.org_id === orgId || !!every
    const back = () => { setOpen(null); setFresh(null); setMsg(null) }
    const tps = topics.filter(t => t.course_id === cur.id)
    const learners = ls.reduce((m, l) => Math.max(m, progress.get(l.id) ?? 0), 0)
    const acts: (Act | false)[] = mine ? [
      cur.status === 'draft' && { key: 'pub', label: 'Công bố', kind: 'primary', disabled: !ls.length, title: ls.length ? undefined : 'Thêm ít nhất một bài học trước khi công bố', onClick: () => setStatus(cur, 'published') },
      cur.status === 'published' && { key: 'arch', label: 'Lưu trữ', onClick: () => setStatus(cur, 'archived') },
      cur.status === 'archived' && { key: 'reopen', label: 'Mở lại', onClick: () => setStatus(cur, 'published') },
      cur.status === 'draft' ? { key: 'edit', label: 'Sửa thông tin', icon: 'pencil', onClick: () => editCourse(cur) }
        : { key: 'newver', label: courseDraftOf(cur) ? 'Mở bản nháp mới' : 'Phát hành bản mới', title: 'Khoá đã công bố không sửa trực tiếp: tạo bản nháp mới để sửa, công bố bản mới thì khoá cũ tự lưu trữ', onClick: () => newCourseVersion(cur) },
      cur.status === 'draft' && { key: 'del', label: 'Xoá khoá học nháp', icon: 'trash', kind: 'danger', onClick: () => removeCourse(cur, back) },
    ] : []
    return <>
      <DetailHead back="Khoá học e-learning" onBack={back} title={cur.title} extra={<span className={'pill ' + ESTATUS[cur.status][1]}>{ESTATUS[cur.status][0]}</span>}
        sub={[...courseMeta(cur), !mine ? 'của cấp trên' : every ? orgName(cur.org_id) : null].filter(Boolean).join(' · ')}
        actions={<div className="tools"><ActionBar items={acts} /></div>} />
      {note}
      <div className={'pdgrid' + (side ? '' : ' pdnoside')}>
        <div className="pdmain">
          <div className="pdstats">
            <div><b>{tps.length}</b><span>chủ đề</span></div>
            <div><b>{ls.length}</b><span>bài học</span></div>
            <div><b>{ls.filter(l => l.kind === 'exam').length}</b><span>đề luyện</span></div>
            <div><b>{learners}</b><span>học sinh đã học</span></div>
            {!side && <button type="button" className="pdsidetg" onClick={toggleSide} title="Mở cột thông tin khoá học">‹ Thông tin</button>}
          </div>
          <div className="panel pdcard pdsl"><h4>Chủ đề & bài học
            {mine && cur.status !== 'draft' && <InfoTip label="Chỉ xem">Khoá đã công bố nên không sửa trực tiếp. Bấm <b>{courseDraftOf(cur) ? 'Mở bản nháp mới' : 'Phát hành bản mới'}</b> ở đầu trang để sửa trên bản sao.</InfoTip>}
            {cur.replaces_id && cur.status === 'draft' && <InfoTip label="Bản nháp mới">Bản nháp mới thay cho khoá <b>{rows.find(r => r.id === cur.replaces_id)?.title ?? 'cũ'}</b>. Công bố bản này thì khoá cũ tự lưu trữ.</InfoTip>}</h4><LessonEditor key={cur.id} autoAdd={mine && fresh === cur.id && !ls.length} course={cur} lessons={ls} topics={tps} exams={exams} progress={progress} editable={mine && cur.status === 'draft'} onChange={load} /></div>
          {mine && <CourseProgress key={ls.length} course={cur} />}
        </div>
        {side && <div className="pdside">
          <div className="panel pdcard"><h4 className="pdcardh">Thông tin chung<button type="button" className="pdsidetg incard" onClick={toggleSide} title="Thu cột thông tin để bảng rộng hơn">Thu gọn ›</button></h4>
            <dl className="pddl sm">
              <dt>Môn</dt><dd>{courseSubjects(cur).join(', ') || '—'}</dd>
              <dt>Khối</dt><dd>{courseGrades(cur).join(', ') || '—'}</dd>
              <dt>Đơn vị mở</dt><dd>{orgName(cur.org_id) || '—'}</dd>
              <dt>Ngày tạo</dt><dd>{new Date(cur.created_at).toLocaleDateString('vi-VN')}</dd>
            </dl>
          </div>
          <div className="panel pdcard"><h4>Đối tượng & thời hạn{mine && cur.status === 'draft' && <button type="button" className="linkbtn" onClick={() => editCourse(cur)}>Điều chỉnh ›</button>}</h4>
            <dl className="pddl sm">
              <dt>Đối tượng</dt><dd>{(isSchool ? audienceText(cur, classes, groups) : cur.shared ? 'Học sinh tất cả trường trực thuộc' : 'Chỉ đơn vị mình') || '—'}</dd>
              <dt>Hạn hoàn thành</dt><dd>{cur.due_at ? dt(cur.due_at) : <span className="sub">Không đặt</span>}</dd>
            </dl>
          </div>
          <div className="panel pdcard"><h4>Giới thiệu</h4>
            {cur.description ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{cur.description}</p> : <small className="sub">Chưa có giới thiệu{mine && cur.status === 'draft' ? ' · bấm biểu tượng bút ở đầu trang để thêm' : ''}</small>}
          </div>
        </div>}
      </div>
    </> }
  return (
    <>
      {note}
      {(() => {
        const left = ofl.node(rows.map(c => c.org_id)), right = <><ViewToggle value={view} onChange={setView} /><HeadAction><button type="button" className="primary ttadd" onClick={() => { setMsg(null); setForm({ ...CEMPTY, shared: !isSchool && !every }) }}>+ Tạo khoá học</button></HeadAction></>
        return view === 'list' ? <DataTable id="elearning-courses" rows={shown} rowKey={c => c.id} onRow={c => { setMsg(null); setOpen(c.id) }} left={left} right={right} aside={fitC.length ? gtc.tree : undefined}
          empty={rows.length ? <small className="sub">Không có khoá học nào khớp bộ lọc.</small> : null}
          cols={[
            { key: 'title', label: 'Tên khoá học', fixed: true, text: c => c.title, cell: c => <><b>{c.title}</b></> },
            { key: 'csubj', label: 'Môn', values: c => courseSubjects(c), text: c => courseSubjects(c).join(', '), cell: c => courseSubjects(c).join(', ') || '—' },
            { key: 'cgrade', label: 'Khối', values: c => courseGrades(c).map(g => 'Khối ' + g), text: c => courseGrades(c).join(', '), cell: c => courseGrades(c).join(', ') || '—' },
            { key: 'n', label: 'Số bài', text: c => String(lessons.filter(l => l.course_id === c.id).length), cell: c => lessons.filter(l => l.course_id === c.id).length },
            { key: 'who', label: 'Đối tượng', text: c => String(whom(c) || ''), cell: c => whom(c) || '—' },
            { key: 'due', label: 'Hạn hoàn thành', cell: c => c.due_at ? dt(c.due_at) : '—' },
            { key: 'st', label: 'Trạng thái', text: c => ESTATUS[c.status][0], cell: c => <span className={'pill ' + ESTATUS[c.status][1]}>{ESTATUS[c.status][0]}</span> },
          ] as Col<Course>[]} />
          : <div className="tttools">{left && <div className="ttleft">{left}</div>}{right}</div>
      })()}
      {view === 'cards' && fitC.length > 0 && <SideSplit aside={gtc.tree}><div className="gtcards"><div className="coursegrid">
        {shown.map(c => { const ls = lessons.filter(l => l.course_id === c.id)
          return <section key={c.id} className="panel coursecard clickrow" role="button" tabIndex={0} onClick={() => { setMsg(null); setOpen(c.id) }}
            onKeyDown={e => { if (e.key === 'Enter') { setMsg(null); setOpen(c.id) } }}>
            <header>
              <div><b>{c.title}</b><small>{[...courseMeta(c), `${ls.length} bài`, whom(c)].filter(Boolean).join(' · ')}</small>
                {c.due_at && <small className={'due ' + (c.status === 'published' ? dueBadge(c.due_at, false)!.tone : '')}>Hạn hoàn thành: {dt(c.due_at)}</small>}</div>
              <span className={'pill ' + ESTATUS[c.status][1]}>{ESTATUS[c.status][0]}</span>
            </header>
            {c.description && <p className="sub">{c.description}</p>}
          </section> })}
      </div></div></SideSplit>}
      <div className="coursegrid">
        {!rows.length && <p className="sub">Chưa có khoá học. Một khoá gồm nhiều bài: video (YouTube, Google Drive…), bài đọc, liên kết, tệp, học liệu từ Kho học liệu và đề luyện.</p>}
      </div>
    </>
  )
}

type LibOpt = { id: string; kind: 'material' | 'unit'; title: string; subject: string | null; grades: string | null; owner_name: string | null; content: { type?: string; file_name?: string; material_ids?: string[] } }
const EL_IMPORT: Column[] = [
  { key: 'topic', label: 'Chủ đề', width: 26 },
  { key: 'kind', label: 'Loại', aliases: ['Loại bài'], width: 12 },
  { key: 'title', label: 'Tên bài', required: true, aliases: ['Tên bài học', 'Bài học', 'Tên'], width: 40 },
  { key: 'url', label: 'Đường dẫn', aliases: ['Link', 'URL'], width: 40 },
  { key: 'dur', label: 'Thời lượng (phút)', aliases: ['Thời lượng', 'Phút'], width: 12 },
  { key: 'note', label: 'Ghi chú', aliases: ['Ghi chú cho người học'], width: 30 },
]
const normSub = (x: string | null | undefined) => (x ?? '').trim().toLowerCase()
const MAT: Record<string, string> = { lesson_plan: 'Giáo án', worksheet: 'Phiếu học tập', image: 'Hình ảnh', video: 'Video', guide: 'Tài liệu hướng dẫn', document: 'Tài liệu', link: 'Đường dẫn' }

function LessonEditor({ course, lessons, topics, exams, progress, editable, onChange, autoAdd }: { course: Course; lessons: Lesson[]; topics: Topic[]; exams: Exam[]; progress: Map<string, number>; editable: boolean; onChange: () => unknown; autoAdd?: boolean }) {
  const [f, setF] = useState<Partial<Lesson> | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  // "Lưu & thêm bài tiếp": lưu xong mở ngay ô thêm bài mới cùng loại
  const [more, setMore] = useState(false)
  const [round, setRound] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [lib, setLib] = useState<LibOpt[] | null>(null)
  const [libQ, setLibQ] = useState('')
  // Chọn từ Kho học liệu theo môn của khoá: một học liệu, hoặc cả bài học (thêm tất cả học liệu đã xuất bản của bài)
  const [pick, setPick] = useState<'material' | 'unit'>('material')
  const [anySub, setAnySub] = useState(!courseSubjects(course).length)
  const [unitId, setUnitId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Chủ đề đang thêm / đổi tên ngay trong cột trái
  const [tf, setTf] = useState<{ id?: string; title: string } | null>(null)
  // Bản sao tại chỗ để kéo thả / đổi thứ tự hiện ngay, không chờ tải lại
  const [loc, setLoc] = useState(lessons), [tloc, setTloc] = useState(topics)
  useEffect(() => setLoc(lessons), [lessons]); useEffect(() => setTloc(topics), [topics])
  const [drag, setDrag] = useState<string | null>(null), [over, setOver] = useState<string | null>(null)
  const [cur, setCur] = useState(''), [q, setQ] = useState('')
  const groups = groupLessons(loc, tloc)
  const lastTopic = groups.filter(g => g.topic).slice(-1)[0]?.topic?.id ?? null
  // Học liệu đã xuất bản trong Kho học liệu mà đơn vị thấy (chỉ loại "Học liệu": tệp / đường dẫn)
  useEffect(() => {
    if ((f?.kind === 'library' || lessons.some(l => l.kind === 'library')) && !lib)
      supabase.from('library_items').select('id, kind, title, subject, grades, owner_name, content').eq('status', 'published').in('kind', ['material', 'unit']).order('title').limit(3000)
        .then(({ data }) => setLib((data as LibOpt[]) ?? []))
  }, [f?.kind, lessons.length])
  function edit(l: Partial<Lesson> | null) { setTf(null); setF(l); setRound(n => n + 1); setFile(null); setErr(''); setLibQ(''); setPick('material'); setUnitId('') }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f) return
    setBusy(true); setErr('')
    try {
      if (f.kind === 'library' && pick === 'unit' && !f.id) {
        // Cả bài học: mỗi học liệu đã xuất bản của bài thành một bài trong khoá, theo thứ tự trong bài
        const u = lib?.find(x => x.id === unitId)
        if (!u) throw new Error('Chọn bài học trong kho.')
        const mats = (u.content.material_ids ?? []).map(id => lib?.find(x => x.id === id && x.kind === 'material')).filter((x): x is LibOpt => !!x)
        if (!mats.length) throw new Error('Bài học này chưa có học liệu đã xuất bản để đưa vào khoá.')
        const start = lessons.length ? Math.max(...lessons.map(l => l.position)) + 1 : 1
        const { error } = await supabase.from('course_lessons').insert(mats.map((m, i) => ({ course_id: course.id, title: `${u.title}: ${m.title}`.slice(0, 200), kind: 'library',
          library_item_id: m.id, body: f.body?.trim() || null, duration_min: f.duration_min || null, position: start + i, topic_id: f.topic_id || null })))
        if (error) throw new Error(errText(error.message, '061'))
        await done(); return
      }
      let path = f.kind === 'file' ? f.path ?? null : null
      if (f.kind === 'file' && file) path = (await uploadLearningFile(course.org_id, 'courses', file)).path
      if (f.kind === 'file' && !path) throw new Error('Chọn tệp cho bài học.')
      if (f.kind === 'library' && !f.library_item_id) throw new Error('Chọn học liệu trong kho.')
      const body = { course_id: course.id, title: f.title, kind: f.kind, url: f.kind === 'video' || f.kind === 'link' ? f.url?.trim() || null : null, body: f.body?.trim() || null,
        exam_id: f.kind === 'exam' ? f.exam_id : null, path, library_item_id: f.kind === 'library' ? f.library_item_id : null,
        duration_min: f.duration_min || null, position: f.position ?? (lessons.length ? Math.max(...lessons.map(l => l.position)) + 1 : 1), topic_id: f.topic_id || null }
      const { error } = f.id ? await supabase.from('course_lessons').update(body).eq('id', f.id) : await supabase.from('course_lessons').insert(body)
      if (error) throw new Error(errText(error.message, '061'))
      await done()
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  async function done() { const k = f?.kind, t = f?.topic_id ?? null; await onChange(); edit(more && k ? { kind: k, title: '', topic_id: t } : null) }
  // Đặt bài vào chủ đề topicId, trước bài beforeId (null = cuối chủ đề); đánh lại thứ tự các bài trong chủ đề đó
  async function place(id: string, topicId: string | null, beforeId: string | null) {
    const l = loc.find(x => x.id === id); if (!l || id === beforeId) return
    const g = (groups.find(x => (x.topic?.id ?? null) === topicId)?.lessons ?? []).filter(x => x.id !== id)
    const at = beforeId ? g.findIndex(x => x.id === beforeId) : -1
    g.splice(at < 0 ? g.length : at, 0, { ...l, topic_id: topicId })
    const next = g.map((x, i) => ({ ...x, position: i + 1 }))
    const changed = next.filter(x => { const o = loc.find(y => y.id === x.id)!; return o.position !== x.position || (o.topic_id ?? null) !== (x.topic_id ?? null) })
    if (!changed.length) return
    setLoc(loc.map(x => next.find(y => y.id === x.id) ?? x))
    const res = await Promise.all(changed.map(x => supabase.from('course_lessons').update({ position: x.position, topic_id: x.topic_id ?? null }).eq('id', x.id)))
    const bad = res.find(r => r.error); if (bad) alert(errText(bad.error!.message, '127'))
    onChange()
  }
  async function removeTopic(t: Topic, n: number) {
    if (!confirm(n ? `Xoá chủ đề "${t.title}"? ${n} bài trong chủ đề vẫn giữ, chuyển về "Chưa xếp chủ đề".` : `Xoá chủ đề "${t.title}"?`)) return
    await supabase.from('course_topics').delete().eq('id', t.id); if (tf?.id === t.id) setTf(null); onChange()
  }
  const libName = (id: string | null) => lib?.find(x => x.id === id)?.title
  const ln = libQ.trim().toLowerCase(), cs = courseSubjects(course).map(normSub)
  const subOk = (x: LibOpt) => anySub || !cs.length || cs.includes(normSub(x.subject))
  const libList = (lib ?? []).filter(x => x.kind === 'material' && ((subOk(x) && (!ln || x.title.toLowerCase().includes(ln))) || x.id === f?.library_item_id))
  const unitList = (lib ?? []).filter(x => x.kind === 'unit' && subOk(x) && (!ln || x.title.toLowerCase().includes(ln)))
  const unitMats = (u?: LibOpt) => (u?.content.material_ids ?? []).filter(id => lib?.some(x => x.id === id && x.kind === 'material')).length
  const subName = courseSubjects(course).join(', ')
  // ---- Dạng bảng như "Môn & bài học" của chương trình: chủ đề ở cột trái, bảng bài học phẳng bên phải ----
  // cur: '' = tất cả, 'none' = chưa xếp chủ đề, còn lại là id chủ đề
  const topicNo = new Map(groups.filter(g => g.topic).map((g, i) => [g.topic!.id, i + 1]))
  const topicOf = (l: Lesson) => (l.topic_id && topicNo.has(l.topic_id) ? l.topic_id : null)
  const flat = groups.flatMap(g => g.lessons)
  const selKey = cur && cur !== 'none' && !topicNo.has(cur) ? '' : cur
  const inSel = selKey === '' ? flat : flat.filter(l => (topicOf(l) ?? 'none') === selKey)
  const qq = q.trim().toLowerCase()
  const shown = qq ? inSel.filter(l => l.title.toLowerCase().includes(qq)) : inSel
  const mins = (ls: Lesson[]) => ls.reduce((t, l) => t + (l.duration_min || 0), 0)
  const cnt = (ls: Lesson[]) => `${ls.length} bài${mins(ls) ? ` · ${mins(ls)} phút` : ''}`
  const topicLabel = (id: string | null) => (id ? `Chủ đề ${topicNo.get(id)}: ${tloc.find(t => t.id === id)?.title ?? ''}` : 'Chưa xếp chủ đề')
  const newIn = () => (selKey === 'none' ? null : selKey || lastTopic)
  async function removeLesson(l: Lesson) {
    if (!confirm(`Xoá bài "${l.title}"?`)) return
    await supabase.from('course_lessons').delete().eq('id', l.id); if (f?.id === l.id) edit(null); onChange()
  }
  const say = (text: string, bad = false) => setMsg({ text, bad })
  const nextPos = () => (loc.length ? Math.max(...loc.map(l => l.position)) + 1 : 1)
  // Sửa thẳng một ô của bài (tên, loại, đường dẫn, thời lượng, ghi chú)
  async function patch(l: Lesson, p: Partial<Lesson>) {
    setLoc(ls => ls.map(x => (x.id === l.id ? { ...x, ...p } : x)))
    const { error } = await supabase.from('course_lessons').update(p).eq('id', l.id)
    if (error) { say(errText(error.message, '061'), true); setLoc(lessons); return false }
    onChange(); return true
  }
  const fixUrl = (v: string) => { const t = v.trim(); return !t ? '' : /^https?:\/\//i.test(t) ? t : 'https://' + t }
  const guessKind = (url: string): Lesson['kind'] => (/youtu\.?be|vimeo|drive\.google|\.mp4(\?|$)/i.test(url) ? 'video' : 'link')
  const minOf = (v: string) => { const n = Math.round(Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''))); return Number.isFinite(n) && n >= 1 ? Math.min(600, n) : null }
  // Đổi loại ngay trong bảng: Video ↔ Liên kết đổi luôn; loại cần chọn tệp / đề / học liệu thì mở chi tiết để chọn
  function setKind(l: Lesson, kind: Lesson['kind']) {
    if (kind === l.kind) return
    if ((kind === 'video' || kind === 'link') && l.url) return patch(l, { kind })
    if (kind === 'reading') return patch(l, { kind })
    edit({ ...l, kind })
  }
  // Thêm nhiều bài một lúc (dòng thêm mới, dán nhiều dòng, nhập Excel). Bài không có đường dẫn thành "Bài đọc" để soạn sau.
  type NewL = { title: string; kind?: Lesson['kind']; url?: string; dur?: number | null; body?: string | null; topic_id: string | null }
  async function insertMany(list: NewL[]) {
    if (!list.length) return 0
    let pos = nextPos()
    const rows = list.map(r => { const url = fixUrl(r.url ?? ''), kind = r.kind && (r.kind !== 'video' && r.kind !== 'link' || url) ? r.kind : url ? guessKind(url) : 'reading'
      return { course_id: course.id, title: r.title.slice(0, 200), kind, url: kind === 'video' || kind === 'link' ? url : null, body: r.body?.trim() || null, duration_min: r.dur ?? null, position: pos++, topic_id: r.topic_id } })
    const { error } = await supabase.from('course_lessons').insert(rows)
    if (error) { say(errText(error.message, '061'), true); return 0 }
    await onChange(); return rows.length
  }
  // ---- Dòng thêm bài cuối bảng ----
  const [nd, setNd] = useState<{ kind: Lesson['kind']; title: string; url: string; dur: string; topic: string }>({ kind: 'video', title: '', url: '', dur: '', topic: '' })
  const [paste, setPaste] = useState<string | null>(null)
  const ndTopic = () => (nd.topic ? (nd.topic === 'none' ? null : nd.topic) : newIn())
  const needsPick = (k: Lesson['kind']) => k === 'file' || k === 'exam' || k === 'library'
  async function addDraft() {
    const t = nd.title.trim(); if (!t || busy) return
    if (/\n/.test(t)) { setPaste(t); return }
    if (needsPick(nd.kind)) { edit({ kind: nd.kind, title: t, topic_id: ndTopic(), duration_min: minOf(nd.dur) }); setNd(d => ({ ...d, title: '', url: '', dur: '' })); return }
    if ((nd.kind === 'video' || nd.kind === 'link') && !nd.url.trim()) { say(`Bài ${LKIND[nd.kind]} cần đường dẫn. Dán đường dẫn vào ô "Nội dung".`, true); document.getElementById('el-new-url')?.focus(); return }
    setBusy(true)
    const n = await insertMany([{ title: t, kind: nd.kind, url: nd.url, dur: minOf(nd.dur), topic_id: ndTopic() }])
    setBusy(false)
    if (n) { setMsg(null); setNd(d => ({ ...d, title: '', url: '', dur: '' })); document.getElementById('el-new-title')?.focus() }
  }
  const parseLines = (text: string) => text.split(/\r?\n/).map(l => l.split('\t')).map(c => {
    const title = (c[0] ?? '').replace(/^\s*(bài|bai)?\s*\d+\s*[.:)\-–]\s*/i, '').trim()
    const url = (c.slice(1).find(x => /^\s*(https?:\/\/|www\.)/i.test(x)) ?? '').trim()
    const dur = minOf(c.slice(1).find(x => /^\s*\d+([.,]\d+)?\s*(phút|p|')?\s*$/i.test(x)) ?? '')
    return { title, url, dur }
  }).filter(r => r.title)
  const pasted = paste ? parseLines(paste) : []
  // ---- Lưới kiểu Excel ----
  const GC = ['title', 'url', 'dur', 'note'] as const
  const onGridKey = gridKey(GC)
  const byId = new Map(loc.map(l => [l.id, l]))
  const onGridPaste = async (e: React.ClipboardEvent) => {
    const lines = gridPaste(e, GC, ['note']); if (!lines) return
    const extra: NewL[] = []
    for (const { id, vals, fromFirst } of lines) {
      const l = id ? byId.get(id) : undefined
      if (!l) { if (fromFirst && vals.title) extra.push({ title: vals.title, url: vals.url, dur: minOf(vals.dur ?? ''), body: vals.note, topic_id: newIn() }); continue }
      const p: Partial<Lesson> = {}
      if (vals.title) p.title = vals.title.slice(0, 200)
      if ('url' in vals && (l.kind === 'video' || l.kind === 'link') && vals.url) p.url = fixUrl(vals.url)
      if ('dur' in vals) p.duration_min = minOf(vals.dur ?? '')
      if ('note' in vals && l.kind !== 'reading') p.body = vals.note?.trim() || null
      if (Object.keys(p).length) await patch(l, p)
    }
    if (extra.length) await insertMany(extra)
    say(`Đã dán ${lines.length} dòng${extra.length ? `, thêm mới ${extra.length} bài` : ''}.`)
  }
  // ---- Nhập Excel ----
  const KIND_OF = (s: string): Lesson['kind'] | undefined => { const t = s.trim().toLowerCase(); return (Object.entries(LKIND) as [Lesson['kind'], string][]).find(([k, v]) => v.toLowerCase() === t || k === t)?.[0] }
  async function importLessons(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = [], list: NewL[] = []
    const tByName = new Map(tloc.map(t => [t.title.trim().toLowerCase(), t.id]))
    let tpos = tloc.length ? Math.max(...tloc.map(t => t.position)) + 1 : 1
    for (const r of recs) {
      const title = (r.title ?? '').trim(); if (!title) { bad.push(`dòng ${r._line}: thiếu tên bài`); continue }
      const k = r.kind ? KIND_OF(r.kind) : undefined
      if (r.kind && !k) { bad.push(`dòng ${r._line}: loại "${r.kind}" không có`); continue }
      if (k && needsPick(k)) { bad.push(`dòng ${r._line}: bài ${LKIND[k]} thêm trong bảng rồi bấm › để chọn`); continue }
      if ((k === 'video' || k === 'link') && !(r.url ?? '').trim()) { bad.push(`dòng ${r._line}: thiếu đường dẫn`); continue }
      let tid: string | null = null; const tn = (r.topic ?? '').replace(/^\s*chủ đề\s*\d+\s*[:.\-–]\s*/i, '').trim()
      if (tn) {
        tid = tByName.get(tn.toLowerCase()) ?? null
        if (!tid) {
          const res = await supabase.from('course_topics').insert({ course_id: course.id, title: tn.slice(0, 200), position: tpos++ }).select('id').single()
          if (res.error) { bad.push(`dòng ${r._line}: ${errText(res.error.message, '127')}`); continue }
          tid = (res.data as { id: string }).id; tByName.set(tn.toLowerCase(), tid)
        }
      }
      list.push({ title, kind: k, url: r.url, dur: minOf(r.dur ?? ''), body: r.note, topic_id: tid })
    }
    const ok = await insertMany(list)
    if (!ok) await onChange()
    return importSummary(ok, 'bài', bad)
  }
  // Nhân bản: bài giống hệt ngay bên dưới
  async function duplicate(l: Lesson) {
    setBusy(true)
    const later = loc.filter(x => (x.topic_id ?? null) === (l.topic_id ?? null) && x.position > l.position)
    await Promise.all(later.map(x => supabase.from('course_lessons').update({ position: x.position + 1 }).eq('id', x.id)))
    const { id: _i, ...rest } = l; void _i
    const { error } = await supabase.from('course_lessons').insert({ ...rest, position: l.position + 1 })
    setBusy(false)
    if (error) return say(errText(error.message, '061'), true)
    await onChange(); say(`Đã nhân bản bài "${l.title}" ngay bên dưới.`)
  }
  // ---- Chủ đề ngay trong cột trái: thêm, đổi tên (bấm đúp), xoá, kéo đổi thứ tự ----
  async function saveTopicInline() {
    if (!tf) return
    const title = tf.title.trim(); if (!title) { setTf(null); return }
    const { error } = tf.id ? await supabase.from('course_topics').update({ title }).eq('id', tf.id)
      : await supabase.from('course_topics').insert({ course_id: course.id, title: title.slice(0, 200), position: tloc.length ? Math.max(...tloc.map(t => t.position)) + 1 : 1 })
    if (error) return say(errText(error.message, '127'), true)
    await onChange(); setTf(tf.id ? null : { title: '' })
  }
  async function dropTopic(dragId: string, onto: Topic) {
    const ts = groups.filter(g => g.topic).map(g => g.topic!), from = ts.findIndex(t => t.id === dragId), to = ts.findIndex(t => t.id === onto.id)
    if (from < 0 || to < 0 || from === to) return
    const [m] = ts.splice(from, 1); ts.splice(to, 0, m)
    const next = ts.map((x, k) => ({ ...x, position: k + 1 })); setTloc(next)
    await Promise.all(next.filter(x => tloc.find(y => y.id === x.id)?.position !== x.position).map(x => supabase.from('course_topics').update({ position: x.position }).eq('id', x.id)))
    onChange()
  }
  const examName = (id: string | null) => exams.find(x => x.id === id)?.title
  const srcView = (l: Lesson, plain = false) => {
    if (l.kind === 'file' && l.path && plain) return <span>{pathName(l.path)}</span>
    if (l.kind === 'file' && l.path) return <button type="button" className="slsubjlink" onClick={() => openFile(l.path!)} title="Mở tệp">{pathName(l.path)}</button>
    if ((l.kind === 'video' || l.kind === 'link') && l.url) return <a href={l.url} target="_blank" rel="noreferrer" className="elsrc" title={l.url}>{l.url.replace(/^https?:\/\/(www\.)?/, '')}</a>
    if (l.kind === 'exam') return <span>{examName(l.exam_id) ?? 'Đề luyện'}</span>
    if (l.kind === 'library') return <span>{libName(l.library_item_id) ?? 'Học liệu trong kho'}</span>
    if (l.kind === 'reading') return <span className="sub">{l.body ? 'Bài đọc' : 'Chưa soạn nội dung'}</span>
    return <span className="sub">—</span>
  }
  const srcText = (l: Lesson) => l.kind === 'file' ? pathName(l.path ?? '') : l.kind === 'exam' ? examName(l.exam_id) ?? '' : l.kind === 'library' ? libName(l.library_item_id) ?? '' : l.url ?? ''
  const srcEdit = (l: Lesson) => (l.kind === 'video' || l.kind === 'link')
    ? <input key={l.id + (l.url ?? '')} className="slcell" data-gc="url" data-gr={l.id} defaultValue={l.url ?? ''} placeholder="https://…" aria-label={`Đường dẫn bài ${l.title}`}
        onBlur={e => { const v = fixUrl(e.target.value); if (!v) { e.target.value = l.url ?? ''; return } if (v !== l.url) patch(l, { url: v }) }} />
    : <button type="button" className="slopen" onClick={() => edit(l)} title="Mở chi tiết để chọn">{srcView(l, true)}<span className="slmore">{l.kind === 'reading' ? 'Soạn ›' : 'Chọn ›'}</span></button>
  const kindSel = (l: Lesson) => <select className="slcell elkindsel" value={l.kind} aria-label={`Loại bài ${l.title}`} onChange={e => setKind(l, e.target.value as Lesson['kind'])}>
    {Object.entries(LKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
  const cols: Col<Lesson>[] = [
    { key: 'no', label: '#', thClass: 'c-no', fixed: true, cell: l => <span className="sub">{(groups.find(g => g.lessons.includes(l))?.lessons.indexOf(l) ?? 0) + 1}</span> },
    ...(selKey === '' && tloc.length ? [{ key: 'topic', label: 'Chủ đề', thClass: 'c-eltopic', text: (l: Lesson) => topicLabel(topicOf(l)),
      cell: (l: Lesson) => editable
        ? <select className="slcell eltopicsel" value={topicOf(l) ?? ''} title={topicLabel(topicOf(l))} aria-label={`Chủ đề của bài ${l.title}`} onChange={e => place(l.id, e.target.value || null, null)}>
            {tGroups.map((g, i) => <option key={g.topic!.id} value={g.topic!.id}>Chủ đề {i + 1}</option>)}<option value="">Chưa xếp</option></select>
        : <button type="button" className="slsubjlink" onClick={() => setCur(topicOf(l) ?? 'none')} title={topicLabel(topicOf(l))}>{topicOf(l) ? `Chủ đề ${topicNo.get(topicOf(l)!)}` : 'Chưa xếp'}</button> }] : []),
    { key: 'kind', label: 'Loại', thClass: 'c-elkind', text: l => LKIND[l.kind] ?? l.kind, cell: l => editable ? kindSel(l) : <span className="pill">{LKIND[l.kind] ?? l.kind}</span> },
    { key: 'title', label: 'Tên bài', thClass: 'c-title', fixed: true, text: l => l.title,
      cell: l => editable ? <input key={l.id + l.title} className="slcell" data-gc="title" data-gr={l.id} defaultValue={l.title} aria-label={`Tên bài ${l.title}`} maxLength={200}
        onBlur={e => { const v = e.target.value.trim(); if (!v) { e.target.value = l.title; return } if (v !== l.title) patch(l, { title: v }) }} /> : <b className="eltitle">{l.title}</b> },
    { key: 'src', label: 'Nội dung', thClass: 'c-mat', text: srcText, cell: l => editable ? srcEdit(l) : srcView(l) },
    { key: 'dur', label: 'Phút', thClass: 'c-elmin', text: l => l.duration_min ? String(l.duration_min) : '',
      cell: l => editable ? <input key={l.id + (l.duration_min ?? '')} className="slcell" data-gc="dur" data-gr={l.id} inputMode="numeric" defaultValue={l.duration_min ?? ''} aria-label={`Thời lượng bài ${l.title} (phút)`}
        onBlur={e => { const v = minOf(e.target.value); if (v !== (l.duration_min ?? null)) patch(l, { duration_min: v }) }} /> : l.duration_min ? `${l.duration_min}` : <span className="sub">—</span> },
    { key: 'note', label: 'Ghi chú cho người học', thClass: 'c-outs', off: true, text: l => l.kind === 'reading' ? '' : l.body ?? '',
      cell: l => l.kind === 'reading' ? <span className="sub">—</span> : editable
        ? <LongCell key={l.id + (l.body ?? '')} value={l.body ?? ''} gc="note" gr={l.id} placeholder="Ghi chú cho người học" label={`Ghi chú bài ${l.title}`} onSave={v => { if (v !== (l.body ?? '')) patch(l, { body: v.trim() || null }) }} />
        : l.body ? <small className="sub">{l.body}</small> : <span className="sub">—</span> },
    { key: 'done', label: 'Đã học', thClass: 'c-eldur', off: true, text: l => String(progress.get(l.id) ?? 0), cell: l => <span className={progress.get(l.id) ? undefined : 'sub'}>{progress.get(l.id) ?? 0}</span> },
    ...(editable ? [{ key: 'act', label: '', thClass: 'c-act', fixed: true, cell: (l: Lesson) =>
      <span className="slact"><span className="sldrag" draggable title="Kéo để đổi vị trí hoặc thả vào chủ đề ở cột trái" aria-label={`Kéo ${l.title} để đổi vị trí`}
        onDragStart={e => { setDrag(l.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); const tr = (e.target as HTMLElement).closest('tr'); if (tr) e.dataTransfer.setDragImage(tr, 20, 20) }}
        onDragEnd={() => { setDrag(null); setOver(null) }}>⠿</span>
        <button type="button" className="slgo" title="Mở chi tiết: loại bài, tệp, đề, học liệu, nội dung bài đọc" aria-label={`Mở chi tiết ${l.title}`} onClick={() => edit(l)}>›</button>
        <button type="button" disabled={busy} aria-label={`Nhân bản bài ${l.title}`} title="Nhân bản: tạo ngay một bài giống hệt bên dưới" onClick={() => duplicate(l)}>⧉</button>
        <button type="button" className="danger iconbtn" title="Xoá bài" aria-label={`Xoá ${l.title}`} onClick={() => removeLesson(l)}><Icon n="trash" size={15} /></button></span> }] : []),
  ]
  const navDrop = (topicId: string | null, t?: Topic) => editable ? {
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); setOver('nav:' + (topicId ?? 'none')) },
    onDragLeave: () => setOver(o => (o === 'nav:' + (topicId ?? 'none') ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const id = drag; setDrag(null); setOver(null); if (!id) return
      if (id.startsWith('t:')) { if (t) dropTopic(id.slice(2), t) } else place(id, topicId, null) },
  } : {}
  const tGroups = groups.filter(g => g.topic), rest = groups.find(g => !g.topic)?.lessons ?? []
  const navItem = (key: string, label: string, ls: Lesson[], t?: Topic) => <div key={key || '*'}
    className={'slnavrow' + (selKey === key ? ' on' : '') + (over === 'nav:' + key ? ' eldrop' : '') + (drag === 't:' + key ? ' sldragging' : '')} {...(key ? navDrop(key === 'none' ? null : key, t) : {})}
    draggable={editable && !!t && tf?.id !== t.id} onDragStart={t ? e => { setDrag('t:' + t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) } : undefined}
    onDragEnd={t ? () => { setDrag(null); setOver(null) } : undefined}>
    {t && tf?.id === t.id
      ? <input className="elnavin" autoFocus value={tf.title} maxLength={200} aria-label="Tên chủ đề" onChange={e => setTf({ ...tf, title: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveTopicInline() } if (e.key === 'Escape') setTf(null) }} onBlur={saveTopicInline} />
      : <button type="button" className={'slnavi' + (selKey === key ? ' on' : '')} onClick={() => setCur(key)}
          onDoubleClick={editable && t ? () => setTf({ id: t.id, title: t.title }) : undefined} title={editable && t ? 'Bấm đúp để đổi tên · kéo để đổi thứ tự' : undefined}>
          <span className="slnm">{label}</span><span className="slcnt">{key === '' && tloc.length ? `${tloc.length} chủ đề · ` : ''}{cnt(ls)}</span></button>}
    {editable && t && tf?.id !== t.id && <button type="button" className="slnavx" title={`Xoá chủ đề ${t.title}`} aria-label={`Xoá chủ đề ${t.title}`} onClick={() => removeTopic(t, ls.length)}><Icon n="trash" size={14} /></button>}
  </div>
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addDraft() } }
  return (<>
    <div className="slwrap ellessons">
      <nav className="slnav" aria-label="Chủ đề trong khoá học">
        {navItem('', 'Tất cả', flat)}
        {tGroups.map((g, i) => navItem(g.topic!.id, `${i + 1}. ${g.topic!.title}`, g.lessons, g.topic!))}
        {tGroups.length > 0 && rest.length > 0 && navItem('none', 'Chưa xếp chủ đề', rest)}
        {editable && (tf && !tf.id ? <div className="sladdbox">
            <input className="elnavin" autoFocus value={tf.title} maxLength={200} placeholder={`Tên chủ đề ${tloc.length + 1}`} aria-label="Tên chủ đề mới"
              onChange={e => setTf({ ...tf, title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveTopicInline() } if (e.key === 'Escape') setTf(null) }} />
            <small className="sub">Enter để thêm, thêm tiếp được ngay</small>
            <button type="button" className="linkbtn" onClick={() => setTf(null)}>Xong</button></div>
          : <button type="button" className="sladdsubj" onClick={() => setTf({ title: '' })}>+ Thêm chủ đề</button>)}
      </nav>
      <div className="slmain" onKeyDown={editable ? onGridKey : undefined} onPaste={editable ? onGridPaste : undefined} onMouseDown={editable ? gridMouseDown : undefined}>
        <DataTable id="el-lessons-v3" simple rows={shown} rowKey={l => l.id} className={editable ? 'slt slgrid' : 'slt'} cols={cols}
          rowProps={editable ? l => ({ className: drag === l.id ? 'sldragging' : over === l.id && drag ? 'slover' : undefined,
            onDragOver: e => { if (!drag || drag.startsWith('t:')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== l.id) setOver(l.id) },
            onDrop: e => { e.preventDefault(); const id = drag; setDrag(null); setOver(null); if (id && !id.startsWith('t:') && id !== l.id) place(id, topicOf(l), l.id) } }) : undefined}
          empty={<small className="sub">{inSel.length ? 'Không có bài nào khớp ô tìm.' : !lessons.length && !topics.length
            ? `Khoá chưa có bài học.${editable ? ' Gõ tên bài ở dòng dưới (dán nhiều dòng để thêm nhiều bài) hoặc Nhập Excel. Có thể tạo chủ đề trước ở cột trái.' : ''}`
            : selKey && selKey !== 'none' ? `Chủ đề chưa có bài.${editable ? ' Gõ tên bài ở dòng dưới hoặc kéo bài từ chủ đề khác thả vào chủ đề này ở cột trái.' : ''}` : 'Chưa có bài.'}</small>}
          left={<input placeholder={selKey && selKey !== 'none' ? `Tìm bài trong chủ đề ${topicNo.get(selKey)}…` : 'Tìm bài…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bài" />}
          right={editable ? <ImportExcel label="⇪ Nhập Excel" columns={EL_IMPORT} template="Mau-bai-hoc-e-learning" onRecords={importLessons} onMessage={(m, bad) => say(m, bad)}
            sample={[['Làm quen với lập trình', 'Video', 'Mở đầu', 'https://www.youtube.com/watch?v=…', '5', ''], ['Làm quen với lập trình', 'Liên kết', 'Tài liệu bài 1', 'https://…', '', 'Đọc trước khi lên lớp'], ['Cảm biến', 'Bài đọc', 'Cảm biến là gì', '', '10', '']]} /> : undefined}
          foot={editable ? (keys: string[]) => {
            const topicSel = <select value={nd.topic || (newIn() ?? 'none')} onChange={e => setNd({ ...nd, topic: e.target.value })} aria-label="Chủ đề của bài mới">
              {tGroups.map((g, i) => <option key={g.topic!.id} value={g.topic!.id}>Chủ đề {i + 1}</option>)}<option value="none">Chưa xếp</option></select>
            const linky = nd.kind === 'video' || nd.kind === 'link'
            const cellOf = (k: string) => k === 'topic' ? topicSel
              : k === 'kind' ? <select value={nd.kind} disabled={busy} onChange={e => setNd({ ...nd, kind: e.target.value as Lesson['kind'] })} aria-label="Loại bài mới">{Object.entries(LKIND).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select>
              : k === 'title' ? <div className="slnewrow">{!keys.includes('topic') && selKey === '' && tGroups.length > 0 ? topicSel : null}<input id="el-new-title" className="slnt" data-gc="title" value={nd.title} disabled={busy} autoFocus={autoAdd}
                  placeholder="+ Tên bài mới (dán nhiều dòng để thêm nhiều bài)" aria-label="Tên bài mới" maxLength={2000}
                  onChange={e => setNd({ ...nd, title: e.target.value })} onKeyDown={enter}
                  onPaste={e => { const t = e.clipboardData.getData('text'); if (/\n/.test(t.trim())) { e.preventDefault(); setPaste(t) } }} /></div>
              : k === 'src' ? (linky ? <input id="el-new-url" data-gc="url" value={nd.url} disabled={busy} placeholder="Đường dẫn https://…" aria-label="Đường dẫn bài mới" onChange={e => setNd({ ...nd, url: e.target.value })} onKeyDown={enter} />
                : <small className="sub">{nd.kind === 'reading' ? 'Soạn nội dung sau khi thêm (›)' : 'Thêm xong chọn trong chi tiết'}</small>)
              : k === 'dur' ? <input className="slnp" data-gc="dur" value={nd.dur} disabled={busy} placeholder="Phút" inputMode="numeric" aria-label="Thời lượng bài mới (phút)" onChange={e => setNd({ ...nd, dur: e.target.value })} onKeyDown={enter} />
              : k === 'act' ? <button type="button" className="primary" disabled={busy || !nd.title.trim()} onClick={addDraft}>+ Thêm</button>
              : null
            return <tfoot><tr className="slnew">{keys.map(k => <td key={k}>{cellOf(k)}</td>)}</tr></tfoot>
          } : undefined} />
        {msg && <small className={msg.bad ? 'msg' : 'sub'} role="status">{msg.text}</small>}
        {editable && <div className="infotiprow"><InfoTip up label="Cách nhập nhanh">Gõ thẳng vào ô như Excel: Enter hoặc ↑↓ để sang dòng, ←→ ở đầu/cuối ô để sang cột, Esc để huỷ sửa. Chép một vùng ô trong Excel (Tên bài · Đường dẫn · Phút) rồi dán vào ô bất kỳ để điền nhiều dòng, dòng thừa thành bài mới. Bài có đường dẫn YouTube / Google Drive tự là Video, đường dẫn khác là Liên kết, không có đường dẫn là Bài đọc. Kéo ⠿ để đổi thứ tự hoặc thả vào chủ đề ở cột trái; bấm đúp tên chủ đề để đổi tên, kéo chủ đề để đổi thứ tự.</InfoTip></div>}
      </div>
    </div>
    {paste !== null && <Drawer title="Dán danh sách bài" onClose={() => setPaste(null)} closeOnOutside={false}
      actions={<><button type="button" className="primary" disabled={!pasted.length || busy} onClick={async () => { setBusy(true); const n = await insertMany(pasted.map(r => ({ ...r, topic_id: ndTopic() }))); setBusy(false); if (n) { setPaste(null); setNd(d => ({ ...d, title: '' })); say(`Đã thêm ${n} bài.`) } }}>Thêm {pasted.length} bài</button>
        <button type="button" onClick={() => setPaste(null)}>Huỷ</button></>}>
      <p className="sub" style={{ marginTop: 0 }}>Mỗi dòng một bài, vào <b>{topicLabel(ndTopic())}</b>. Dán thẳng từ Excel / Word được, các cột: <b>Tên bài · Đường dẫn · Phút</b> (chỉ tên là bắt buộc). Có đường dẫn YouTube / Drive là Video, đường dẫn khác là Liên kết, không có là Bài đọc.</p>
      <textarea autoFocus rows={8} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Mở đầu\thttps://www.youtube.com/watch?v=…\t5\nTài liệu bài 1\thttps://…'} style={{ width: '100%', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'calc(13px * var(--fz,1))' }} aria-label="Danh sách bài" />
      {pasted.length > 0 && <div className="wrap" style={{ marginTop: 10 }}><table>
        <thead><tr><th>Tên bài</th><th>Loại</th><th>Đường dẫn</th><th>Phút</th></tr></thead>
        <tbody>{pasted.map((r, i) => <tr key={i}><td>{r.title}</td><td>{LKIND[r.url ? guessKind(fixUrl(r.url)) : 'reading']}</td><td><small>{r.url || '—'}</small></td><td>{r.dur ?? '—'}</td></tr>)}</tbody>
      </table></div>}
    </Drawer>}
    {f && <Drawer closeOnOutside={false} onClose={() => edit(null)} title={f.id ? 'Sửa bài: ' + (lessons.find(x => x.id === f.id)?.title ?? '') : (() => { const gi = groups.findIndex(g => (g.topic?.id ?? null) === (f.topic_id ?? null)), g = groups[gi]
        return `Bài mới${g?.topic ? ` · Chủ đề ${gi + 1}` : ''} (bài ${(g?.lessons.length ?? 0) + 1})` })()}><form key={round} className="formgrid" onSubmit={save}>
        <label className="field"><span>Loại bài</span><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Lesson['kind'] })}>{Object.entries(LKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {topics.length > 0 && <label className="field"><span>Chủ đề</span><select value={f.topic_id ?? ''} onChange={e => setF({ ...f, topic_id: e.target.value || null })}>
          {groups.filter(g => g.topic).map((g, i) => <option key={g.topic!.id} value={g.topic!.id}>Chủ đề {i + 1}: {g.topic!.title}</option>)}<option value="">Chưa xếp chủ đề</option></select></label>}
        {!(f.kind === 'library' && pick === 'unit' && !f.id) && <label className="field wide"><span>Tên bài *</span><input required autoFocus={!f.id} value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} /></label>}
        {(f.kind === 'video' || f.kind === 'link') && <label className="field wide"><span>Đường dẫn *</span><input required type="url" value={f.url ?? ''} onChange={e => setF({ ...f, url: e.target.value })} placeholder={f.kind === 'video' ? 'https://www.youtube.com/watch?v=… hoặc Google Drive' : 'https://…'} /></label>}
        {f.kind === 'exam' && <label className="field wide"><span>Đề luyện *</span><select required value={f.exam_id ?? ''} onChange={e => setF({ ...f, exam_id: e.target.value })}><option value="">Chọn đề đã công bố…</option>{exams.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>}
        {f.kind === 'file' && <label className="field wide"><span>Tệp (PDF, Word, PowerPoint, hình ảnh… tối đa {MAX_FILE_MB} MB) *</span>
          <input type="file" required={!f.path} onChange={e => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title?.trim()) setF({ ...f, title: x.name.replace(/\.[^.]+$/, '') }) }} />
          {f.path && !file && <small>Tệp hiện tại: <button type="button" className="xbtn" onClick={() => openFile(f.path!)}>{pathName(f.path)}</button> — chọn tệp khác để thay.</small>}</label>}
        {f.kind === 'library' && <div className="field wide"><span>Chọn từ Kho học liệu{subName && !anySub ? ` · môn ${subName}` : ''} *</span>
          {!f.id && <div className="segmented" role="group" aria-label="Chọn gì từ kho" style={{ margin: '0 0 6px', width: 'fit-content' }}>
            {([['material', 'Một học liệu'], ['unit', 'Cả bài học']] as const).map(([k, l]) => <button key={k} type="button" className={pick === k ? 'on' : ''} aria-pressed={pick === k} onClick={() => setPick(k)}>{l}</button>)}</div>}
          <div className="tools" style={{ margin: '0 0 6px' }}>
            <input type="search" className="search" style={{ margin: 0, flex: 1 }} placeholder={pick === 'unit' ? 'Lọc theo tên bài học…' : 'Lọc theo tên học liệu…'} value={libQ} onChange={e => setLibQ(e.target.value)} aria-label="Lọc theo tên" />
            {subName && <label className="field inline" style={{ margin: 0 }}><input type="checkbox" checked={anySub} onChange={e => setAnySub(e.target.checked)} /> Tất cả môn</label>}</div>
          {pick === 'unit' && !f.id ? <>
            <select required value={unitId} onChange={e => { setUnitId(e.target.value); const u = lib?.find(x => x.id === e.target.value); if (u && !f.title?.trim()) setF({ ...f, title: u.title }) }} aria-label="Bài học">
              <option value="">{lib ? `Chọn bài học đã xuất bản (${unitList.length})…` : 'Đang tải…'}</option>
              {unitList.map(x => <option key={x.id} value={x.id}>{x.title}{x.grades ? ` · khối ${x.grades}` : ''} — {unitMats(x)} học liệu{x.owner_name ? ` · ${x.owner_name}` : ''}</option>)}
            </select>
            <small>Mỗi học liệu đã xuất bản của bài học thành một bài trong khoá, theo thứ tự trong bài.{unitId ? ` Bài này có ${unitMats(lib?.find(x => x.id === unitId))} học liệu.` : ''}</small>
          </> : <select required value={f.library_item_id ?? ''} onChange={e => setF({ ...f, library_item_id: e.target.value, title: f.title || libName(e.target.value) || '' })} aria-label="Học liệu">
            <option value="">{lib ? `Chọn học liệu đã xuất bản (${libList.length})…` : 'Đang tải…'}</option>
            {libList.map(x => <option key={x.id} value={x.id}>{x.title}{x.content?.type ? ` — ${MAT[x.content.type] ?? x.content.type}` : ''}{x.owner_name ? ` · ${x.owner_name}` : ''}</option>)}
          </select>}
          {lib && !(pick === 'unit' ? unitList : libList).length && <small>{subName && !anySub ? `Kho chưa có ${pick === 'unit' ? 'bài học' : 'học liệu'} đã xuất bản của môn ${subName}. Tick "Tất cả môn" để xem cả các môn khác.` : `Chưa có ${pick === 'unit' ? 'bài học' : 'học liệu'} nào được xuất bản trong Kho học liệu.`}</small>}</div>}
        <label className="field wide"><span>{f.kind === 'reading' ? 'Nội dung bài đọc (Markdown) *' : 'Ghi chú cho người học'}</span><textarea rows={f.kind === 'reading' ? 8 : 2} required={f.kind === 'reading'} value={f.body ?? ''} onChange={e => setF({ ...f, body: e.target.value })} /></label>
        <label className="field"><span>Thời lượng (phút)</span><input type="number" min={1} max={600} value={f.duration_min ?? ''} onChange={e => setF({ ...f, duration_min: e.target.value ? Number(e.target.value) : null })} /></label>
        {err && <p className="msg">{err}</p>}
        <div className="actions wide"><button className="primary" disabled={busy} onClick={() => setMore(false)}>{busy ? (file ? 'Đang tải tệp lên…' : 'Đang lưu…') : 'Lưu bài học'}</button>
          {!f.id && <button disabled={busy} onClick={() => setMore(true)}>Lưu & thêm bài tiếp</button>}<button type="button" onClick={() => edit(null)}>Huỷ</button></div>
      </form></Drawer>}
  </>)
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
