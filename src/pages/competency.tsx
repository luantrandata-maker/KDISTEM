import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAllMode } from '../components/OrgScope'
import { downloadXlsx } from '../lib/sheet'
import { schoolYear } from './department/Governance'

// Đánh giá năng lực (migration 042): khung năng lực, hồ sơ năng lực HS (từ chấm theo tiêu chí), đánh giá năng lực GV.
export type Comp = { key: string; audience: 'student' | 'teacher'; grp: string; name: string; description: string | null; levels: string[]; sort: number }
let compCache: Comp[] | null = null
const compSubs = new Set<(l: Comp[]) => void>()
function fetchCompetencies() {
  return supabase.from('competencies').select('*').order('sort').then(({ data }) => { compCache = (data as Comp[]) ?? []; compSubs.forEach(f => f(compCache!)) })
}
export function useCompetencies(audience: 'student' | 'teacher') {
  const [list, setList] = useState<Comp[]>(compCache ?? [])
  useEffect(() => {
    compSubs.add(setList)
    if (!compCache) fetchCompetencies()
    return () => { compSubs.delete(setList) }
  }, [])
  return list.filter(c => c.audience === audience)
}
// Gọi sau khi KDI sửa khung năng lực: tải lại và cập nhật mọi ô chọn năng lực đang mở
export const resetCompetencies = () => { compCache = null; return fetchCompetencies() }
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
const EV_LABEL: [string, string][] = [['training_completed', 'Khoá tập huấn hoàn thành'], ['training_present', 'Buổi tập huấn có mặt'], ['certificates', 'Chứng chỉ'], ['test_avg', 'Điểm kiểm tra tập huấn TB'],
  ['stem_taught_12m', 'Tiết STEM đã dạy (12 tháng)'], ['lesson_plans', 'Giáo án / bài giảng tự soạn'], ['rubric_assignments', 'Bài giao có chấm theo tiêu chí']]

function Evidence({ teacherId }: { teacherId: string }) {
  const [ev, setEv] = useState<Evd | null>(null)
  useEffect(() => { supabase.rpc('teacher_evidence', { p_teacher: teacherId }).then(({ data }) => setEv(data as Evd)) }, [teacherId])
  if (!ev) return null
  return <div className="evgrid">{EV_LABEL.map(([k, l]) => <div key={k}><b>{k === 'test_avg' ? (ev[k] == null ? '—' : String(ev[k]).replace('.', ',')) : ev[k] ?? 0}</b><small>{l}{k === 'stem_taught_12m' && ev.stem_planned_12m ? ` / ${ev.stem_planned_12m} theo TKB` : ''}</small></div>)}</div>
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
// Mức đạt qua tập huấn: chứng chỉ đã cấp, còn hiệu lực → mức đích của chương trình ở năng lực đích (088)
type TLv = { competency: string; level: number; program: string; cert_code: string; issued_on: string | null }
function TrainingLevels({ teacherId, comps }: { teacherId: string; comps: Comp[] }) {
  const [rows, setRows] = useState<TLv[] | null>(null)
  useEffect(() => { supabase.rpc('teacher_training_levels', { p_teacher: teacherId }).then(({ data }) => setRows((data as TLv[]) ?? [])) }, [teacherId])
  if (!rows) return null
  if (!rows.length) return <p className="sub" style={{ margin: 0 }}>Chưa có chứng chỉ tập huấn nào gắn năng lực. Khi giáo viên Đạt khoá tập huấn và được cấp chứng chỉ, mức đích của chương trình được tính vào hồ sơ.</p>
  return <div className="wrap"><table className="libtable"><thead><tr><th>Năng lực</th><th>Mức đạt</th><th>Chương trình tập huấn</th><th>Chứng chỉ</th></tr></thead>
    <tbody>{rows.map((r, i) => { const c = comps.find(x => x.key === r.competency); return <tr key={i}><td>{c?.name ?? r.competency}</td><td><LevelChip v={r.level} comp={c} /></td><td>{r.program}</td>
      <td>{r.cert_code}{r.issued_on && <small className="sub"> · {new Date(r.issued_on).toLocaleDateString('vi-VN')}</small>}</td></tr> })}</tbody></table></div>
}

// ===== Chương trình giáo dục giáo viên đáp ứng (124): Đạt một khoá tập huấn có chương trình gắn với chương trình giáo dục =====
type EduMetRow = { edu_family: string; code: string | null; title: string; kind: string; ct_code: string | null; level: string; grade_from: number; grade_to: number
  main_subject: string; met_on: string | null; via: { plan: string; program: string; date: string | null; cert: string | null }[]; competencies: Record<string, number> }
const EDU_KIND: Record<string, string> = { subject: 'Môn học', stem: 'STEM', school: 'Nhà trường' }
export function EduProgramsMet({ teacherId, comps }: { teacherId: string; comps: Comp[] }) {
  const [rows, setRows] = useState<EduMetRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setRows(null)
    supabase.rpc('teacher_edu_programs', { p_teacher: teacherId }).then(({ data, error }) => {
      if (error) setErr(/schema cache|does not exist|not find/i.test(error.message) ? 'Hãy chạy migration 124 trên Supabase.' : error.message)
      setRows((data as EduMetRow[]) ?? [])
    })
  }, [teacherId])
  if (err) return <p className="msg">{err}</p>
  if (!rows) return <p className="sub">Đang tải…</p>
  if (!rows.length) return <p className="sub" style={{ margin: 0 }}>Chưa đáp ứng chương trình giáo dục nào. Giáo viên Đạt khoá tập huấn có chương trình tập huấn gắn với chương trình giáo dục thì được tính đáp ứng chương trình đó.</p>
  const compOf = (k: string) => comps.find(c => c.key === k)
  return <div className="wrap"><table className="libtable">
    <thead><tr><th>Chương trình giáo dục</th><th>Khối · môn</th><th>Qua khoá tập huấn</th><th>Năng lực đạt</th><th>Từ ngày</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.edu_family}>
      <td><b>{r.title}</b>{r.code && <><br /><small className="sub">{r.code}</small></>} <small className="sub">· {EDU_KIND[r.kind] ?? r.kind}{r.ct_code ? ' ' + r.ct_code : ''}</small></td>
      <td><small>Khối {r.grade_from === r.grade_to ? r.grade_from : `${r.grade_from}–${r.grade_to}`} · {r.main_subject}</small></td>
      <td><small>{r.via.map((v, i) => <span key={i}>{v.program} <span className="sub">({v.plan}{v.cert ? ` · ${v.cert}` : ''})</span>{i < r.via.length - 1 ? <br /> : null}</span>)}</small></td>
      <td>{Object.keys(r.competencies).length ? Object.entries(r.competencies).map(([k, lv]) => <span key={k} style={{ display: 'inline-flex', gap: 4, marginRight: 8, alignItems: 'center' }}>
        <small>{compOf(k)?.name ?? k}</small><LevelChip v={lv} comp={compOf(k)} /></span>) : <small className="sub">—</small>}</td>
      <td><small>{r.met_on ? new Date(r.met_on).toLocaleDateString('vi-VN') : ''}</small></td>
    </tr>)}</tbody></table></div>
}

// ===== Lịch sử tập huấn + tiến bộ qua các năm (124) =====
type HProg = { code: string | null; title: string; competencies: string[]; target_level: number | null }
type Hist = { plan_id: string; plan_code: string | null; plan_name: string; plan_org: string | null; year_name: string | null; term: string | null
  starts_on: string | null; ends_on: string | null; hours: number | null; closed: boolean; programs: HProg[]; sessions: number; present: number; excused: number
  att_pct: number | null; result: 'pending' | 'pass' | 'fail'; total_score: number | null; grade: string | null
  cert_code: string | null; cert_issued_on: string | null; cert_status: string | null; cert_valid: boolean | null }
const TERM_NAME: Record<string, string> = { summer: 'Dịp hè', hk1: 'Học kỳ I', hk2: 'Học kỳ II', other: 'Khác' }
const RES: Record<Hist['result'], [string, string]> = { pass: ['Đạt', 'ok'], fail: ['Chưa đạt', 'bad'], pending: ['Chưa kết luận', 'mute'] }
const dvn = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : ''
const num = (v: number | null, d = 1) => v == null ? '—' : String(Math.round(Number(v) * 10 ** d) / 10 ** d).replace('.', ',')
function useTrainingHistory(teacherId: string) {
  const [rows, setRows] = useState<Hist[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setRows(null)
    supabase.rpc('teacher_training_history', { p_teacher: teacherId }).then(({ data, error }) => {
      if (error) setErr(/schema cache|does not exist|not found/i.test(error.message) ? 'Hãy chạy migration 124 trên Supabase.' : error.message)
      setRows((data as Hist[]) ?? [])
    })
  }, [teacherId])
  return [rows, err] as const
}

export function TrainingHistory({ teacherId, comps, name }: { teacherId: string; comps: Comp[]; name?: string }) {
  const [rows, err] = useTrainingHistory(teacherId)
  const [year, setYear] = useState('')
  if (!rows) return <p className="sub">Đang tải…</p>
  if (err) return <p className="msg">{err}</p>
  if (!rows.length) return <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa tham gia đợt tập huấn nào. Khi được ghi danh vào kế hoạch tập huấn, các đợt sẽ hiện ở đây cùng chuyên cần, kết quả và chứng chỉ.</p></div>
  const years = [...new Set(rows.map(r => r.year_name).filter(Boolean) as string[])].sort().reverse()
  const shown = rows.filter(r => !year || r.year_name === year)
  const passed = shown.filter(r => r.result === 'pass')
  const hours = passed.reduce((a, r) => a + (r.hours ?? 0), 0)
  const certs = shown.filter(r => r.cert_valid).length
  const compName = (k: string) => comps.find(c => c.key === k)?.name ?? k
  function excel() {
    downloadXlsx(`lich-su-tap-huan${name ? '-' + name : ''}`, [{ key: 'y', label: 'Năm học', width: 12 }, { key: 't', label: 'Đợt', width: 12 }, { key: 'k', label: 'Mã KH', width: 12 },
      { key: 'n', label: 'Kế hoạch', width: 36 }, { key: 'o', label: 'Đơn vị tổ chức', width: 24 }, { key: 'p', label: 'Chương trình', width: 36 }, { key: 'nl', label: 'Năng lực (mức đích)', width: 30 },
      { key: 'd', label: 'Thời gian', width: 22 }, { key: 'h', label: 'Số giờ' }, { key: 'a', label: 'Chuyên cần (%)' }, { key: 'r', label: 'Kết quả' }, { key: 's', label: 'Tổng điểm' },
      { key: 'g', label: 'Xếp loại' }, { key: 'c', label: 'Chứng chỉ', width: 18 }, { key: 'ci', label: 'Ngày cấp' }],
      shown.map(r => [r.year_name ?? '', TERM_NAME[r.term ?? 'other'], r.plan_code ?? '', r.plan_name, r.plan_org ?? '', r.programs.map(g => g.title).join('; '),
        [...new Set(r.programs.flatMap(g => g.competencies.map(c => compName(c) + (g.target_level ? ` (M${g.target_level})` : ''))))].join('; '),
        [dvn(r.starts_on), dvn(r.ends_on)].filter(Boolean).join(' – '), r.hours ?? '', r.att_pct ?? '', RES[r.result][0], r.total_score ?? '', r.grade ?? '',
        r.cert_code ?? '', dvn(r.cert_issued_on)]), 'Lịch sử tập huấn')
  }
  return <>
    <div className="bar">
      <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học"><option value="">Mọi năm học</option>{years.map(y => <option key={y}>{y}</option>)}</select>
      <span style={{ flex: 1 }} /><button type="button" onClick={excel}>Xuất Excel</button>
    </div>
    <div className="evgrid histcards">
      <div><b>{shown.length}</b><small>Đợt tập huấn tham gia</small></div>
      <div><b>{passed.length}</b><small>Đạt · {shown.filter(r => r.result === 'fail').length} chưa đạt · {shown.filter(r => r.result === 'pending').length} chưa kết luận</small></div>
      <div><b>{hours.toLocaleString('vi-VN')}</b><small>Giờ bồi dưỡng (các đợt Đạt)</small></div>
      <div><b>{certs}</b><small>Chứng chỉ còn hiệu lực</small></div>
    </div>
    <div className="wrap"><table className="libtable histtable">
      <thead><tr><th>Năm học · đợt</th><th>Kế hoạch tập huấn</th><th>Chương trình · năng lực</th><th>Số giờ</th><th>Chuyên cần</th><th>Kết quả</th><th>Chứng chỉ</th></tr></thead>
      <tbody>{shown.map(r => <tr key={r.plan_id}>
        <td><b>{r.year_name ?? '—'}</b><br /><small className="sub">{TERM_NAME[r.term ?? 'other']}</small></td>
        <td style={{ whiteSpace: 'normal' }}><b>{r.plan_name}</b>{r.closed && <> <span className="plbadge mute">Đã kết thúc</span></>}<br />
          <small className="sub">{[r.plan_code, r.plan_org, [dvn(r.starts_on), dvn(r.ends_on)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}</small></td>
        <td style={{ whiteSpace: 'normal' }}>{r.programs.map((g, i) => <div key={i}>{g.title}
          {g.competencies.length > 0 && <small className="sub"><br />{g.competencies.map(compName).join(', ')}{g.target_level ? ` · mức đích M${g.target_level}` : ''}</small>}</div>)}
          {!r.programs.length && <small className="sub">—</small>}</td>
        <td>{r.hours ?? '—'}</td>
        <td>{r.sessions ? <>{num(r.att_pct)}%<br /><small className="sub">{r.present}/{r.sessions - r.excused} buổi{r.excused ? ` · ${r.excused} có phép` : ''}</small></> : <small className="sub">chưa có buổi</small>}</td>
        <td><span className={'plbadge ' + RES[r.result][1]}>{RES[r.result][0]}</span>{(r.total_score != null || r.grade) && <><br /><small className="sub">{[r.total_score != null ? num(r.total_score, 2) + ' điểm' : '', r.grade].filter(Boolean).join(' · ')}</small></>}</td>
        <td>{r.cert_code ? <>{r.cert_code}<br /><small className="sub">{dvn(r.cert_issued_on)}{r.cert_status === 'revoked' ? ' · đã thu hồi' : r.cert_valid === false ? ' · hết hiệu lực' : ''}</small></> : <small className="sub">—</small>}</td>
      </tr>)}</tbody>
    </table></div>
  </>
}

// Tiến bộ: mức năng lực theo năm học (trường đánh giá / tự đánh giá / mức đạt qua tập huấn, cộng dồn) + số đợt, giờ bồi dưỡng
type YearPt = { year: string; self: number | null; mgr: number | null; train: number | null; plans: number; passed: number; hours: number }
const SERIES: { k: 'mgr' | 'self' | 'train'; label: string; cls: string }[] = [
  { k: 'mgr', label: 'Nhà trường đánh giá', cls: 'mgr' }, { k: 'self', label: 'Tự đánh giá', cls: 'self' }, { k: 'train', label: 'Mức đạt qua tập huấn', cls: 'train' }]
export function TrainingProgress({ teacherId, comps }: { teacherId: string; comps: Comp[] }) {
  const [hist, err] = useTrainingHistory(teacherId)
  const [ass, setAss] = useState<TA[] | null>(null)
  const [comp, setComp] = useState('')
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    supabase.from('teacher_assessments').select('*').eq('teacher_id', teacherId).eq('status', 'submitted').order('school_year')
      .then(({ data }) => setAss((data as TA[]) ?? []))
  }, [teacherId])
  const pts = useMemo(() => {
    if (!hist || !ass) return []
    const keys = comp ? [comp] : comps.map(c => c.key)
    const years = [...new Set([...ass.map(a => a.school_year), ...hist.map(h => h.year_name).filter(Boolean) as string[]])].sort()
    const avg = (l: Record<string, number> | undefined) => { if (!l) return null; const v = keys.map(k => l[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    const best: Record<string, number> = {}
    return years.map<YearPt>(y => {
      const hy = hist.filter(h => h.year_name === y)
      for (const h of hy) if (h.result === 'pass' && h.cert_code) for (const g of h.programs) for (const c of g.competencies)
        if (g.target_level && (best[c] ?? 0) < g.target_level) best[c] = g.target_level
      const tv = keys.map(k => best[k]).filter(x => x != null)
      return { year: y, self: avg(ass.find(a => a.school_year === y && a.kind === 'self')?.levels), mgr: avg(ass.find(a => a.school_year === y && a.kind === 'manager')?.levels),
        train: tv.length ? tv.reduce((a, b) => a + b, 0) / tv.length : null, plans: hy.length, passed: hy.filter(h => h.result === 'pass').length,
        hours: hy.filter(h => h.result === 'pass').reduce((a, h) => a + (h.hours ?? 0), 0) }
    })
  }, [hist, ass, comp, comps])
  if (!hist || !ass) return <p className="sub">Đang tải…</p>
  if (err) return <p className="msg">{err}</p>
  if (!pts.length) return <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có dữ liệu: biểu đồ hiện khi có bản đánh giá năng lực đã nộp hoặc đợt tập huấn đã tham gia.</p></div>
  const W = 640, H = 240, L = 34, R = 16, T = 14, B = 30
  const x = (i: number) => pts.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (pts.length - 1)
  const y = (v: number) => T + (4 - v) * (H - T - B) / 3
  const line = (k: YearPt[keyof YearPt] extends never ? never : 'mgr' | 'self' | 'train') => {
    const segs: string[][] = [[]]
    pts.forEach((p, i) => { const v = p[k]; if (v == null) { if (segs[segs.length - 1].length) segs.push([]) } else segs[segs.length - 1].push(`${x(i)},${y(v)}`) })
    return segs.filter(s => s.length > 1).map(s => 'M' + s.join('L'))
  }
  const first = (k: 'mgr' | 'self' | 'train') => pts.find(p => p[k] != null)?.[k] ?? null
  const last = (k: 'mgr' | 'self' | 'train') => [...pts].reverse().find(p => p[k] != null)?.[k] ?? null
  const delta = (k: 'mgr' | 'self' | 'train') => { const a = first(k), b = last(k); return a == null || b == null ? null : b - a }
  const sel = comps.find(c => c.key === comp)
  const hp = hover != null ? pts[hover] : null
  return <>
    <div className="bar">
      <select value={comp} onChange={e => setComp(e.target.value)} aria-label="Năng lực"><option value="">Trung bình các năng lực</option>{comps.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
    </div>
    <div className="evgrid histcards">
      {SERIES.map(s => { const d = delta(s.k); return <div key={s.k}><b>{last(s.k) == null ? '—' : 'M' + num(last(s.k))}</b>
        <small>{s.label} gần nhất{d != null && pts.filter(p => p[s.k] != null).length > 1 ? ` · ${d > 0 ? 'tăng' : d < 0 ? 'giảm' : 'giữ'} ${d ? num(Math.abs(d)) + ' mức' : 'nguyên'} so với năm đầu` : ''}</small></div> })}
      <div><b>{pts.reduce((a, p) => a + p.hours, 0).toLocaleString('vi-VN')}</b><small>Giờ bồi dưỡng qua {pts.length} năm học</small></div>
    </div>
    <div className="panel progpanel">
      <h4 style={{ marginTop: 0 }}>Mức năng lực qua các năm học{sel ? `: ${sel.name}` : ' (trung bình)'}</h4>
      <div className="progwrap" onMouseLeave={() => setHover(null)}>
        <svg className="planchart progchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Biểu đồ mức năng lực theo năm học">
          {[1, 2, 3, 4].map(v => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 6} y={y(v) + 4} textAnchor="end">M{v}</text></g>)}
          {pts.map((p, i) => <text key={p.year} x={x(i)} y={H - 8} textAnchor="middle">{p.year}</text>)}
          {hover != null && <line className="now" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} />}
          {SERIES.map(s => <g key={s.k} className={'ser ' + s.cls}>{line(s.k).map((d, i) => <path key={i} d={d} />)}
            {pts.map((p, i) => p[s.k] != null && <circle key={i} cx={x(i)} cy={y(p[s.k]!)} r={hover === i ? 6 : 4.5} />)}</g>)}
          {pts.map((p, i) => <rect key={i} className="hit" x={x(i) - (W - L - R) / Math.max(pts.length, 2) / 2} y={0} width={(W - L - R) / Math.max(pts.length, 2)} height={H}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`Năm học ${p.year}`} />)}
        </svg>
        {hp && <div className="progtip" style={{ left: `${x(hover!) / W * 100}%` }}>
          <b>Năm học {hp.year}</b>
          {SERIES.map(s => <div key={s.k}><i className={'k ' + s.cls} />{s.label}: <b>{hp[s.k] == null ? '—' : 'M' + num(hp[s.k])}</b></div>)}
          <div>{hp.plans} đợt tập huấn · {hp.passed} Đạt · {hp.hours} giờ</div>
        </div>}
      </div>
      <div className="chartlegend proglegend">{SERIES.map(s => <span key={s.k}><i className={'k ' + s.cls} />{s.label}</span>)}</div>
      <p className="sub" style={{ marginBottom: 0 }}>Mức đánh giá lấy từ bản đã nộp của từng năm học. Mức đạt qua tập huấn là mức đích của các chương trình đã Đạt và được cấp chứng chỉ, cộng dồn tới năm đó.</p>
    </div>
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Năm học</th><th>Đợt tập huấn</th><th>Đạt</th><th>Giờ bồi dưỡng</th>{SERIES.map(s => <th key={s.k}>{s.label}</th>)}</tr></thead>
      <tbody>{[...pts].reverse().map(p => <tr key={p.year}><td><b>{p.year}</b></td><td>{p.plans}</td><td>{p.passed}</td><td>{p.hours}</td>
        {SERIES.map(s => <td key={s.k}><LevelChip v={p[s.k]} comp={sel} /></td>)}</tr>)}</tbody>
    </table></div>
  </>
}

// Đợt đánh giá đang mở cho năm học (GV thấy hạn nộp)
type OpenRound = { id: string; name: string; due_on: string; target_level: number; note: string | null }
function useOpenRounds(year: string) {
  const [rows, setRows] = useState<OpenRound[]>([])
  useEffect(() => {
    supabase.from('assessment_rounds').select('id, name, due_on, target_level, note').eq('status', 'open').eq('school_year', year).order('due_on')
      .then(({ data }) => setRows((data as OpenRound[]) ?? []))
  }, [year])
  return rows
}
// Tên mức năng lực: KDI đổi tên trong Khung năng lực (lib/levels cập nhật tại chỗ)
export const LV_NAME = ['Chưa đạt', 'Đạt', 'Khá', 'Tốt']
export const SLV_NAME = ['Mức 1', 'Mức 2', 'Mức 3', 'Mức 4']
const avgLv = (l: Record<string, number>) => { const v = Object.values(l); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

// GV: Hồ sơ năng lực (tự đánh giá + xem đánh giá của quản lý)
export function TeacherCompetencyProfile({ teacherId, orgId }: { teacherId: string | null; orgId: string | null }) {
  const comps = useCompetencies('teacher')
  const year = schoolYear()
  const [mine, setMine] = useState<Partial<TA> | null>(null)
  const [mgr, setMgr] = useState<TA | null>(null)
  const rounds = useOpenRounds(year)
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
      {rounds.map(r => { const late = r.due_on < new Date().toISOString().slice(0, 10); return (
        <div key={r.id} className={'panel roundbanner' + (late && !locked ? ' late' : '')}>
          <b>{r.name}</b>
          <span>Hạn nộp tự đánh giá {new Date(r.due_on).toLocaleDateString('vi-VN')} · mức yêu cầu: Mức {r.target_level} ({LV_NAME[r.target_level - 1]})
            {locked ? ' · em đã nộp' : late ? ' · đã quá hạn, hãy nộp ngay' : ''}</span>
          {r.note && <small className="sub">{r.note}</small>}
        </div>) })}
      <p className="sub">Năm học {year}. Tự đánh giá theo {comps.length} năng lực của giáo viên STEM (mức như chuẩn nghề nghiệp: Chưa đạt / Đạt / Khá / Tốt). Minh chứng dưới đây hệ thống tự tổng hợp.</p>
      <div className="panel"><h4 style={{ marginTop: 0 }}>Minh chứng</h4><Evidence teacherId={teacherId} /></div>
      <div className="panel"><h4 style={{ marginTop: 0 }}>Mức đạt qua tập huấn</h4><TrainingLevels teacherId={teacherId} comps={comps} /></div>
      <div className="panel"><h4 style={{ marginTop: 0 }}>Chương trình giáo dục đáp ứng</h4><EduProgramsMet teacherId={teacherId} comps={comps} /></div>
      <div className="panel"><h4 style={{ marginTop: 0 }}>Lịch sử tập huấn</h4><TrainingHistory teacherId={teacherId} comps={comps} /></div>
      <div className="panel"><h4 style={{ marginTop: 0 }}>Tiến bộ qua các năm</h4><TrainingProgress teacherId={teacherId} comps={comps} /></div>
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
export function SchoolTeacherAssessments({ orgId, readOnly }: { orgId: string | null; readOnly?: boolean }) {
  const comps = useCompetencies('teacher')
  const year = schoolYear()
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; org_id: string; organizations?: { name: string } | null }[]>([])
  const [q, setQ] = useState('')
  const [list, setList] = useState<TA[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<TA> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  // Quản trị hệ thống: GV của mọi trường trong một danh sách, đánh giá thay trường
  const all = useAllMode()
  async function load() {
    const [t, a, adm] = await Promise.all([
      supabase.from('teachers').select('id, full_name, org_id, organizations(name)').eq('status', 'active').order('full_name'),
      supabase.from('teacher_assessments').select('*').eq('school_year', year),
      supabase.rpc('is_admin'),
    ])
    setTeachers(((t.data as any[]) ?? []).filter(x => !orgId || x.org_id === orgId)); setList((a.data as TA[]) ?? []); setCanEdit(!readOnly && (!!adm.data || !!all))
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
  const shownT = teachers.filter(t => !q || (t.full_name + ' ' + (t.organizations?.name ?? '')).toLowerCase().includes(q.toLowerCase())).slice(0, 500)
  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Năm học {year}: {selfDone}/{teachers.length} GV đã nộp tự đánh giá · {mgrDone}/{teachers.length} đã được trường đánh giá.</p>
        <span style={{ flex: 1 }} />{!orgId && <input placeholder="Tìm giáo viên, trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />}
        <button onClick={excel} disabled={!teachers.length}>Xuất Excel</button>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {cur && form && (
        <div className="panel">
          <div className="bar"><h3 style={{ margin: 0 }}>{cur.full_name}</h3><button onClick={() => setSel(null)}>Đóng</button></div>
          <h4>Minh chứng</h4><Evidence teacherId={cur.id} />
          <h4>Mức đạt qua tập huấn</h4><TrainingLevels teacherId={cur.id} comps={comps} />
          <h4>Chương trình giáo dục đáp ứng</h4><EduProgramsMet teacherId={cur.id} comps={comps} />
          <h4>Lịch sử tập huấn</h4><TrainingHistory teacherId={cur.id} comps={comps} name={cur.full_name} />
          <h4>Tiến bộ qua các năm</h4><TrainingProgress teacherId={cur.id} comps={comps} />
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
        <thead><tr><th>Giáo viên</th>{!orgId && <th>Trường</th>}<th>Tự đánh giá</th><th>Trường đánh giá</th>{comps.map(c => <th key={c.key} title={c.description ?? ''}>{c.name}</th>)}<th /></tr></thead>
        <tbody>{shownT.map(t => { const s = of(t.id, 'self'), m = of(t.id, 'manager'); const lv = m?.status === 'submitted' ? m.levels : s?.levels ?? {}; return (
          <tr key={t.id}><td><b>{t.full_name}</b></td>{!orgId && <td>{t.organizations?.name ?? '—'}</td>}
            <td>{s ? (s.status === 'submitted' ? <><LevelChip v={avgLv(s.levels)} /> <small>đã nộp</small></> : <small>nháp</small>) : <small className="sub">chưa</small>}</td>
            <td>{m?.status === 'submitted' ? <LevelChip v={avgLv(m.levels)} /> : <small className="sub">chưa</small>}</td>
            {comps.map(c => <td key={c.key}><LevelChip v={lv[c.key] ?? null} comp={c} /></td>)}
            <td><button className={s?.status === 'submitted' && m?.status !== 'submitted' && canEdit ? 'primary' : ''} onClick={() => open(t.id)}>{canEdit ? 'Đánh giá' : 'Xem'}</button></td></tr>) })}
          {!shownT.length && <tr><td colSpan={comps.length + 5}>{teachers.length ? 'Không có giáo viên nào khớp.' : 'Chưa có giáo viên.'}</td></tr>}</tbody>
      </table></div>
      <p className="sub covhint">Cột năng lực hiện mức trường đánh giá (nếu đã có), nếu chưa thì hiện mức GV tự đánh giá.</p>
    </>
  )
}
