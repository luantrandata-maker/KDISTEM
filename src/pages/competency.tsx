import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx } from '../lib/sheet'
import { schoolYear } from './department/Governance'

// Đánh giá năng lực (migration 042): khung năng lực, hồ sơ năng lực HS (từ chấm theo tiêu chí), đánh giá năng lực GV.
export type Comp = { key: string; audience: 'student' | 'teacher'; grp: string; name: string; description: string | null; levels: string[]; sort: number }
let compCache: Comp[] | null = null
export function useCompetencies(audience: 'student' | 'teacher') {
  const [list, setList] = useState<Comp[]>(compCache ?? [])
  useEffect(() => {
    if (compCache) return
    supabase.from('competencies').select('*').order('sort').then(({ data }) => { compCache = (data as Comp[]) ?? []; setList(compCache) })
  }, [])
  return list.filter(c => c.audience === audience)
}
const LV = ['#f6d5d3', '#fbe7c2', '#d7ebdb', '#a9d8b8']   // nền mức 1–4 (luôn kèm số và chữ)
const lvIdx = (v: number) => Math.max(1, Math.min(4, Math.round(v)))
export const LevelChip = ({ v, comp }: { v: number | null; comp?: Comp }) => v == null
  ? <small className="sub">chưa có</small>
  : <span className="lvchip" style={{ background: LV[lvIdx(v) - 1] }} title={comp ? comp.levels[lvIdx(v) - 1] : undefined}>M{v.toFixed(v % 1 ? 1 : 0)}</span>

// ================= Hồ sơ năng lực một học sinh =================
type SC = { competency: string; name: string; grp: string; evidences: number; avg_level: number | null; last_level: number | null; last_at: string | null }
type Ev = { competency: string; level: number; assignment_id: string; title: string; graded_at: string | null }
export function StudentCompetencyProfile({ studentId, title }: { studentId: string; title?: string }) {
  const comps = useCompetencies('student')
  const [rows, setRows] = useState<SC[] | null>(null)
  const [ev, setEv] = useState<Ev[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    Promise.all([supabase.rpc('student_competencies', { p_student: studentId }), supabase.rpc('student_competency_evidence', { p_student: studentId })])
      .then(([a, b]) => {
        if (a.error) setErr(/schema cache|does not exist/i.test(a.error.message) ? 'Hãy chạy migration 042 trên Supabase.' : a.error.message)
        setRows((a.data as SC[]) ?? []); setEv((b.data as Ev[]) ?? [])
      })
  }, [studentId])
  if (err) return <p className="msg">{err}</p>
  if (!rows) return <p className="sub">Đang tải…</p>
  const groups = [...new Set(rows.map(r => r.grp))]
  return (
    <div className="compprofile">
      {title && <h3>{title}</h3>}
      {!rows.some(r => r.evidences) && <p className="sub">Chưa có bài nào được chấm theo tiêu chí có gắn năng lực. Năng lực được tổng hợp từ các bài thầy cô chấm theo tiêu chí (rubric).</p>}
      {groups.map(g => (
        <div key={g}>
          <h4>{g}</h4>
          <div className="compcards">
            {rows.filter(r => r.grp === g).map(r => { const c = comps.find(x => x.key === r.competency); return (
              <div key={r.competency} className="compcard" style={{ borderTopColor: r.avg_level != null ? LV[lvIdx(r.avg_level) - 1] : 'var(--line)' }}>
                <div className="bar"><b>{r.name}</b><LevelChip v={r.avg_level} comp={c} /></div>
                <small>{r.avg_level != null && c ? c.levels[lvIdx(r.avg_level) - 1] : c?.description}</small>
                <small className="sub">{r.evidences ? `${r.evidences} lần đánh giá` : 'chưa có bằng chứng'}</small>
              </div>) })}
          </div>
        </div>
      ))}
      {ev.length > 0 && <details><summary>Bằng chứng ({ev.length})</summary>
        <div className="wrap"><table><thead><tr><th>Bài</th><th>Năng lực</th><th>Mức</th><th>Ngày chấm</th></tr></thead>
          <tbody>{ev.slice(0, 200).map((e, i) => <tr key={i}><td>{e.title}</td><td>{comps.find(c => c.key === e.competency)?.name ?? e.competency}</td>
            <td><LevelChip v={e.level} /></td><td>{e.graded_at ? new Date(e.graded_at).toLocaleDateString('vi-VN') : '—'}</td></tr>)}</tbody></table></div></details>}
    </div>
  )
}

// HS: Năng lực của em
export function StudentMyCompetencies({ studentId }: { studentId: string | null }) {
  if (!studentId) return <p className="sub">Tài khoản chưa liên kết hồ sơ học sinh.</p>
  return <StudentCompetencyProfile studentId={studentId} />
}

// ================= Năng lực học sinh theo lớp (GV, quản trị trường) =================
type CC = { student_id: string; full_name: string; student_code: string | null; competency: string; evidences: number; avg_level: number }
export function ClassCompetencies({ teacherId }: { teacherId: string | null }) {
  const comps = useCompetencies('student')
  const [classes, setClasses] = useState<{ id: string; name: string; grade: number | null }[]>([])
  const [grade, setGrade] = useState<number | ''>('')
  const [cls, setCls] = useState('')
  const [rows, setRows] = useState<CC[]>([])
  const [students, setStudents] = useState<{ id: string; full_name: string; student_code: string | null }[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    (teacherId
      ? supabase.from('teaching_assignments').select('classes(id, name, grade)').eq('teacher_id', teacherId).then(({ data }) =>
          [...new Map(((data as any[]) ?? []).filter(r => r.classes).map(r => [r.classes.id, r.classes])).values()])
      : supabase.from('classes').select('id, name, grade').order('name').then(({ data }) => (data as { id: string; name: string; grade: number | null }[]) ?? [])
    ).then(list => { const l = (list as { id: string; name: string; grade: number | null }[]).sort((a, b) => (a.grade ?? 0) - (b.grade ?? 0) || a.name.localeCompare(b.name, 'vi', { numeric: true })); setClasses(l); setGrade(g => g || l[0]?.grade || ''); setCls(c => c || l[0]?.id || '') })
  }, [teacherId])
  useEffect(() => {
    if (!cls) return
    setSel(null)
    Promise.all([supabase.rpc('class_competencies', { p_class: cls }),
      supabase.from('students').select('id, full_name, student_code').eq('class_id', cls).eq('status', 'studying').order('student_code')])
      .then(([a, b]) => { setErr(a.error ? a.error.message : ''); setRows((a.data as CC[]) ?? []); setStudents((b.data as any[]) ?? []) })
  }, [cls])
  const cell = useMemo(() => new Map(rows.map(r => [r.student_id + '|' + r.competency, r])), [rows])
  const used = comps.filter(c => rows.some(r => r.competency === c.key))
  const shownComps = used.length ? used : comps
  const avgOf = (k: string) => { const xs = rows.filter(r => r.competency === k); return xs.length ? xs.reduce((s, r) => s + Number(r.avg_level), 0) / xs.length : null }
  function excel() {
    downloadXlsx(`nang-luc-${classes.find(c => c.id === cls)?.name ?? 'lop'}`, [{ key: 'c', label: 'Mã HS' }, { key: 'n', label: 'Họ tên', width: 26 },
      ...shownComps.map(c => ({ key: c.key, label: c.name, width: 16 }))],
      students.map(s => [s.student_code, s.full_name, ...shownComps.map(c => { const v = cell.get(s.id + '|' + c.key); return v ? Number(v.avg_level) : '' })]), 'Năng lực')
  }
  const cur = students.find(s => s.id === sel)
  const grades = [...new Set(classes.map(c => c.grade).filter((g): g is number => g != null))].sort((a, b) => a - b)
  const inGrade = classes.filter(c => grade === '' || c.grade === grade || c.grade == null)
  return (
    <>
      <div className="bar">
        <span className="tools">
          {grades.length > 0 && <label className="pickfield"><span>Khối</span><select value={grade} onChange={e => { const g = e.target.value ? +e.target.value : ''; setGrade(g); setCls(classes.find(c => !g || c.grade === g)?.id ?? '') }} aria-label="Chọn khối">
            {grades.map(g => <option key={g} value={g}>Khối {g}</option>)}</select></label>}
          <label className="pickfield"><span>Lớp</span><select value={cls} onChange={e => setCls(e.target.value)} aria-label="Chọn lớp">
            {inGrade.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </span>
        <span style={{ flex: 1 }} /><button onClick={excel} disabled={!students.length}>Xuất Excel</button>
      </div>
      <p className="sub" style={{ margin: '0 0 10px' }}>Mức trung bình M1–M4 từ các bài đã chấm theo tiêu chí có gắn năng lực. Bấm tên học sinh để xem hồ sơ.</p>
      {err && <p className="msg">{err}</p>}
      {!classes.length && <p className="sub">Chưa có lớp.</p>}
      {cur && <div className="panel"><div className="bar"><b>{cur.full_name}</b><button onClick={() => setSel(null)}>Đóng</button></div><StudentCompetencyProfile studentId={cur.id} /></div>}
      {cls && <div className="wrap"><table className="compmatrix">
        <thead><tr><th>Học sinh</th>{shownComps.map(c => <th key={c.key} title={c.description ?? ''}>{c.name}</th>)}</tr></thead>
        <tbody>
          <tr className="avgrow"><td><b>Trung bình lớp</b></td>{shownComps.map(c => <td key={c.key}><LevelChip v={avgOf(c.key)} comp={c} /></td>)}</tr>
          {students.map(s => (
            <tr key={s.id}><td><button className="linkbtn" onClick={() => setSel(s.id)}>{s.full_name}</button> <small>{s.student_code}</small></td>
              {shownComps.map(c => { const v = cell.get(s.id + '|' + c.key); return <td key={c.key}>{v ? <><LevelChip v={Number(v.avg_level)} comp={c} /> <small className="sub">×{v.evidences}</small></> : <small className="sub">—</small>}</td> })}</tr>
          ))}
          {!students.length && <tr><td colSpan={shownComps.length + 1}>Lớp chưa có học sinh.</td></tr>}
        </tbody>
      </table></div>}
      {cls && !rows.length && students.length > 0 && <p className="sub covhint">Lớp chưa có bài nào được chấm theo tiêu chí có gắn năng lực. Khi giao bài, chọn mẫu tiêu chí (mỗi tiêu chí gắn một năng lực) rồi chấm theo mức.</p>}
    </>
  )
}

// ================= Đánh giá năng lực giáo viên =================
type TA = { id: string; org_id: string; teacher_id: string; school_year: string; kind: 'self' | 'manager'; levels: Record<string, number>; comment: string | null; plan: string | null; status: 'draft' | 'submitted'; submitted_at: string | null }
type Evd = Record<string, number>
const EV_LABEL: [string, string][] = [['training_completed', 'Khoá tập huấn hoàn thành'], ['training_present', 'Buổi tập huấn có mặt'], ['certificates', 'Chứng chỉ'],
  ['stem_taught_12m', 'Tiết STEM đã dạy (12 tháng)'], ['lesson_plans', 'Giáo án / bài giảng tự soạn'], ['rubric_assignments', 'Bài giao có chấm theo tiêu chí']]

function Evidence({ teacherId }: { teacherId: string }) {
  const [ev, setEv] = useState<Evd | null>(null)
  useEffect(() => { supabase.rpc('teacher_evidence', { p_teacher: teacherId }).then(({ data }) => setEv(data as Evd)) }, [teacherId])
  if (!ev) return null
  return <div className="evgrid">{EV_LABEL.map(([k, l]) => <div key={k}><b>{ev[k] ?? 0}</b><small>{l}{k === 'stem_taught_12m' && ev.stem_planned_12m ? ` / ${ev.stem_planned_12m} theo TKB` : ''}</small></div>)}</div>
}

function AssessForm({ comps, value, onChange, disabled }: { comps: Comp[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void; disabled?: boolean }) {
  return (
    <div className="rubricgrid"><table>
      <thead><tr><th>Năng lực</th>{['Mức 1 · Chưa đạt', 'Mức 2 · Đạt', 'Mức 3 · Khá', 'Mức 4 · Tốt'].map(l => <th key={l}>{l}</th>)}</tr></thead>
      <tbody>{comps.map(c => (
        <tr key={c.key}><td><b>{c.name}</b><br /><small>{c.description}</small></td>
          {c.levels.map((d, k) => <td key={k}><button type="button" disabled={disabled} className={'rlevel' + (value[c.key] === k + 1 ? ' on' : '')} aria-pressed={value[c.key] === k + 1}
            onClick={() => onChange({ ...value, [c.key]: k + 1 })}>{d}</button></td>)}</tr>
      ))}</tbody>
    </table></div>
  )
}
const avgLv = (l: Record<string, number>) => { const v = Object.values(l); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

// GV: Hồ sơ năng lực (tự đánh giá + xem đánh giá của quản lý)
export function TeacherCompetencyProfile({ teacherId, orgId }: { teacherId: string | null; orgId: string | null }) {
  const comps = useCompetencies('teacher')
  const year = schoolYear()
  const [mine, setMine] = useState<Partial<TA> | null>(null)
  const [mgr, setMgr] = useState<TA | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    if (!teacherId) return
    const { data } = await supabase.from('teacher_assessments').select('*').eq('teacher_id', teacherId).eq('school_year', year)
    const l = (data as TA[]) ?? []
    setMine(l.find(x => x.kind === 'self') ?? { levels: {}, comment: '', status: 'draft' }); setMgr(l.find(x => x.kind === 'manager' && x.status === 'submitted') ?? null)
  }
  useEffect(() => { load() }, [teacherId])
  if (!teacherId) return <p className="sub">Tài khoản chưa liên kết hồ sơ giáo viên.</p>
  if (!mine) return <p className="sub">Đang tải…</p>
  const locked = mine.status === 'submitted'
  async function save(submit: boolean) {
    if (submit && comps.some(c => !mine!.levels?.[c.key])) return setMsg([`Chọn mức cho đủ ${comps.length} năng lực trước khi nộp.`, true])
    if (submit && !confirm('Nộp bản tự đánh giá? Sau khi nộp, muốn sửa phải nhờ quản trị trường mở lại.')) return
    const row = { org_id: orgId, teacher_id: teacherId, school_year: year, kind: 'self', levels: mine!.levels ?? {}, comment: mine!.comment || null, status: submit ? 'submitted' : 'draft' }
    const { error } = mine!.id ? await supabase.from('teacher_assessments').update(row).eq('id', mine!.id) : await supabase.from('teacher_assessments').insert(row)
    if (error) return setMsg([error.message, true])
    setMsg([submit ? 'Đã nộp bản tự đánh giá.' : 'Đã lưu nháp.', false]); load()
  }
  return (
    <>
      <p className="sub">Năm học {year}. Tự đánh giá theo 5 năng lực của giáo viên STEM (mức như chuẩn nghề nghiệp: Chưa đạt / Đạt / Khá / Tốt). Minh chứng dưới đây hệ thống tự tổng hợp.</p>
      <div className="panel"><h4 style={{ marginTop: 0 }}>Minh chứng</h4><Evidence teacherId={teacherId} /></div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <div className="panel">
        <div className="bar"><h3 style={{ margin: 0 }}>Tự đánh giá {locked && <span className="plbadge ok">Đã nộp</span>}</h3></div>
        <AssessForm comps={comps} value={mine.levels ?? {}} disabled={locked} onChange={v => setMine({ ...mine, levels: v })} />
        <label className="field"><span>Tự nhận xét, nhu cầu bồi dưỡng</span>
          <textarea rows={3} disabled={locked} value={mine.comment ?? ''} onChange={e => setMine({ ...mine, comment: e.target.value })} /></label>
        {!locked && <div className="formactions"><button onClick={() => save(false)}>Lưu nháp</button> <button className="primary" onClick={() => save(true)}>Nộp</button></div>}
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Đánh giá của nhà trường</h3>
        {mgr ? <>
          <AssessForm comps={comps} value={mgr.levels} onChange={() => {}} disabled />
          {mgr.comment && <p><b>Nhận xét:</b> {mgr.comment}</p>}{mgr.plan && <p><b>Kế hoạch bồi dưỡng:</b> {mgr.plan}</p>}
        </> : <p className="sub">Nhà trường chưa đánh giá năm học này.</p>}
      </div>
    </>
  )
}

// Quản trị trường: Đánh giá năng lực GV (danh sách + đánh giá từng người). Quản trị nền tảng / Sở: chỉ xem.
export function SchoolTeacherAssessments({ orgId }: { orgId: string | null }) {
  const comps = useCompetencies('teacher')
  const year = schoolYear()
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; org_id: string }[]>([])
  const [list, setList] = useState<TA[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<TA> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  async function load() {
    const [t, a, adm] = await Promise.all([
      supabase.from('teachers').select('id, full_name, org_id').eq('status', 'active').order('full_name'),
      supabase.from('teacher_assessments').select('*').eq('school_year', year),
      supabase.rpc('is_admin'),
    ])
    setTeachers(((t.data as any[]) ?? []).filter(x => !orgId || x.org_id === orgId)); setList((a.data as TA[]) ?? []); setCanEdit(!!adm.data)
  }
  useEffect(() => { load() }, [orgId])
  const of = (id: string, k: 'self' | 'manager') => list.find(x => x.teacher_id === id && x.kind === k)
  function open(id: string) {
    setSel(id); setMsg(null)
    const m = of(id, 'manager'); setForm(m ?? { levels: { ...(of(id, 'self')?.levels ?? {}) }, comment: '', plan: '', status: 'draft' })
  }
  async function save(submit: boolean) {
    if (!sel || !form) return
    if (submit && comps.some(c => !form.levels?.[c.key])) return setMsg([`Chọn mức cho đủ ${comps.length} năng lực.`, true])
    const t = teachers.find(x => x.id === sel)!
    const row = { org_id: t.org_id, teacher_id: sel, school_year: year, kind: 'manager', levels: form.levels ?? {}, comment: form.comment || null, plan: form.plan || null, status: submit ? 'submitted' : 'draft' }
    const { error } = form.id ? await supabase.from('teacher_assessments').update(row).eq('id', form.id) : await supabase.from('teacher_assessments').insert(row)
    if (error) return setMsg([/row-level/i.test(error.message) ? 'Chỉ Hiệu trưởng / QTV của trường đánh giá được.' : error.message, true])
    setMsg([submit ? 'Đã lưu đánh giá.' : 'Đã lưu nháp.', false]); await load()
  }
  async function reopen() {
    const s = sel && of(sel, 'self'); if (!s) return
    const { error } = await supabase.from('teacher_assessments').update({ status: 'draft' }).eq('id', s.id)
    if (error) return setMsg([error.message, true]); setMsg(['Đã mở lại để giáo viên sửa bản tự đánh giá.', false]); load()
  }
  function excel() {
    downloadXlsx(`danh-gia-nang-luc-gv-${year}`, [{ key: 'n', label: 'Giáo viên', width: 26 }, ...comps.flatMap(c => [{ key: c.key + 's', label: c.name + ' (tự ĐG)', width: 14 }, { key: c.key + 'm', label: c.name + ' (trường)', width: 14 }]),
      { key: 'cm', label: 'Nhận xét của trường', width: 40 }, { key: 'pl', label: 'Kế hoạch bồi dưỡng', width: 40 }],
      teachers.map(t => { const s = of(t.id, 'self'), m = of(t.id, 'manager'); return [t.full_name, ...comps.flatMap(c => [s?.levels[c.key] ?? '', m?.status === 'submitted' ? m.levels[c.key] ?? '' : '']), m?.comment ?? '', m?.plan ?? ''] }), 'Năng lực GV')
  }
  const selfDone = teachers.filter(t => of(t.id, 'self')?.status === 'submitted').length
  const mgrDone = teachers.filter(t => of(t.id, 'manager')?.status === 'submitted').length
  const cur = teachers.find(t => t.id === sel)
  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Năm học {year}: {selfDone}/{teachers.length} GV đã nộp tự đánh giá · {mgrDone}/{teachers.length} đã được trường đánh giá.</p>
        <span style={{ flex: 1 }} /><button onClick={excel} disabled={!teachers.length}>Xuất Excel</button>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {cur && form && (
        <div className="panel">
          <div className="bar"><h3 style={{ margin: 0 }}>{cur.full_name}</h3><button onClick={() => setSel(null)}>Đóng</button></div>
          <h4>Minh chứng</h4><Evidence teacherId={cur.id} />
          {of(cur.id, 'self') ? <><h4>Tự đánh giá {of(cur.id, 'self')!.status === 'submitted' ? <span className="plbadge ok">Đã nộp</span> : <span className="plbadge mute">Nháp</span>}
            {canEdit && of(cur.id, 'self')!.status === 'submitted' && <button className="linkbtn" onClick={reopen}> · Mở lại cho GV sửa</button>}</h4>
            <AssessForm comps={comps} value={of(cur.id, 'self')!.levels} onChange={() => {}} disabled />
            {of(cur.id, 'self')!.comment && <p><b>GV tự nhận xét:</b> {of(cur.id, 'self')!.comment}</p>}</> : <p className="sub">Giáo viên chưa tự đánh giá.</p>}
          <h4>Đánh giá của nhà trường {form.status === 'submitted' && <span className="plbadge ok">Đã lưu</span>}</h4>
          <AssessForm comps={comps} value={form.levels ?? {}} disabled={!canEdit} onChange={v => setForm({ ...form, levels: v })} />
          <div className="formgrid">
            <label className="field"><span>Nhận xét</span><textarea rows={3} disabled={!canEdit} value={form.comment ?? ''} onChange={e => setForm({ ...form, comment: e.target.value })} /></label>
            <label className="field"><span>Kế hoạch bồi dưỡng</span><textarea rows={3} disabled={!canEdit} value={form.plan ?? ''} onChange={e => setForm({ ...form, plan: e.target.value })} placeholder="VD: tham gia khoá Thiết kế bài học STEM HK2; dự giờ tiết mẫu…" /></label>
          </div>
          {canEdit && <div className="formactions"><button onClick={() => save(false)}>Lưu nháp</button> <button className="primary" onClick={() => save(true)}>Lưu đánh giá</button></div>}
        </div>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Giáo viên</th><th>Tự đánh giá</th><th>Trường đánh giá</th>{comps.map(c => <th key={c.key} title={c.description ?? ''}>{c.name}</th>)}<th /></tr></thead>
        <tbody>{teachers.map(t => { const s = of(t.id, 'self'), m = of(t.id, 'manager'); const lv = m?.status === 'submitted' ? m.levels : s?.levels ?? {}; return (
          <tr key={t.id}><td><b>{t.full_name}</b></td>
            <td>{s ? (s.status === 'submitted' ? <><LevelChip v={avgLv(s.levels)} /> <small>đã nộp</small></> : <small>nháp</small>) : <small className="sub">chưa</small>}</td>
            <td>{m?.status === 'submitted' ? <LevelChip v={avgLv(m.levels)} /> : <small className="sub">chưa</small>}</td>
            {comps.map(c => <td key={c.key}><LevelChip v={lv[c.key] ?? null} comp={c} /></td>)}
            <td><button className={s?.status === 'submitted' && m?.status !== 'submitted' && canEdit ? 'primary' : ''} onClick={() => open(t.id)}>{canEdit ? 'Đánh giá' : 'Xem'}</button></td></tr>) })}
          {!teachers.length && <tr><td colSpan={comps.length + 4}>Chưa có giáo viên.</td></tr>}</tbody>
      </table></div>
      <p className="sub covhint">Cột năng lực hiện mức trường đánh giá (nếu đã có), nếu chưa thì hiện mức GV tự đánh giá.</p>
    </>
  )
}
