import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/time'
import { loadRooms } from '../lib/rooms'

type Pkg = { id: string; code: string | null; name: string; tier: string; provider: string | null; programs: string | null; grades: string | null; starts_on: string | null; ends_on: string | null; contract_no: string | null; order_no: string | null; topics: number; devices: number; sessions: number }
export function EduPlan() {
  const [tt, setTt] = useState<any[]>([])
  const [regs, setRegs] = useState<any[]>([])
  useEffect(() => {
    supabase.from('timetable_entries').select('kind, subject, teachers(id, full_name), classes(name, grade)').eq('kind', 'stem').then(({ data }) => setTt(data ?? []))
    supabase.from('stem_registrations').select('status, teachers(id, full_name, subject), classes(grade)').then(({ data }) => setRegs(data ?? []))
  }, [])
  const key = (t: any, g: number) => `${t?.id}|${g}`
  const rows = new Map<string, { name: string; subject: string; grade: number; stem: number; pending: number; approved: number }>()
  tt.forEach(e => { const k = key(e.teachers, e.classes?.grade); const r = rows.get(k) ?? { name: e.teachers?.full_name, subject: e.subject, grade: e.classes?.grade, stem: 0, pending: 0, approved: 0 }; r.stem++; rows.set(k, r) })
  regs.forEach(e => { const k = key(e.teachers, e.classes?.grade); const r = rows.get(k) ?? { name: e.teachers?.full_name, subject: e.teachers?.subject, grade: e.classes?.grade, stem: 0, pending: 0, approved: 0 }; if (e.status === 'pending') r.pending++; if (e.status === 'approved') r.approved++; rows.set(k, r) })
  const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{new Set(list.map(r => r.name)).size}</strong><span>Giáo viên có kế hoạch STEM</span></div>
        <div className="card"><strong>{list.reduce((s, r) => s + r.stem, 0)}</strong><span>Tiết STEM trong TKB</span></div>
        <div className="card"><strong>{list.reduce((s, r) => s + r.pending, 0)}</strong><span>Đăng ký chờ duyệt</span></div>
        <div className="card"><strong>{list.reduce((s, r) => s + r.approved, 0)}</strong><span>Đăng ký đã duyệt</span></div>
      </div>
      <table style={{ marginTop: 16 }}>
        <thead><tr><th>Giáo viên</th><th>Môn · Khối</th><th>Tiết STEM (TKB)</th><th>Chờ duyệt</th><th>Đã duyệt</th></tr></thead>
        <tbody>
          {list.map((r, i) => <tr key={i}><td><b>{r.name}</b></td><td>{r.subject} · Khối {r.grade}</td><td>{r.stem}</td><td>{r.pending}</td><td>{r.approved}</td></tr>)}
          {list.length === 0 && <tr><td colSpan={5}>Chưa có kế hoạch STEM nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}

const PROGRAMS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5']
export function StemTeachers() {
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; subject: string | null }[]>([])
  const [links, setLinks] = useState<{ teacher_id: string; program: string }[]>([])
  const [orgId, setOrgId] = useState('')
  async function load() {
    const [t, l, u] = await Promise.all([
      supabase.from('teachers').select('id, full_name, subject, org_id').order('full_name'),
      supabase.from('stem_teacher_programs').select('teacher_id, program'),
      supabase.auth.getUser(),
    ])
    setTeachers((t.data as any) ?? []); setLinks((l.data as any) ?? [])
    if (t.data?.[0]) setOrgId((t.data[0] as any).org_id)
    void u
  }
  useEffect(() => { load() }, [])
  const has = (id: string, p: string) => links.some(l => l.teacher_id === id && l.program === p)
  async function toggle(id: string, p: string) {
    if (has(id, p)) {
      setLinks(links.filter(l => !(l.teacher_id === id && l.program === p)))
      await supabase.from('stem_teacher_programs').delete().eq('teacher_id', id).eq('program', p)
    } else {
      setLinks([...links, { teacher_id: id, program: p }])
      await supabase.from('stem_teacher_programs').insert({ org_id: orgId, teacher_id: id, program: p })
    }
  }
  const none = teachers.filter(t => !links.some(l => l.teacher_id === t.id))
  return (
    <>
      {none.length > 0 && <div className="panel warnbox">{none.length} giáo viên chưa được phân công dạy STEM: {none.map(t => t.full_name).join(', ')}</div>}
      <table>
        <thead><tr><th>Giáo viên</th>{PROGRAMS.map(p => <th key={p}>{p}</th>)}</tr></thead>
        <tbody>
          {teachers.map(t => (
            <tr key={t.id}><td><b>{t.full_name}</b><br /><small>{t.subject}</small></td>
              {PROGRAMS.map(p => <td key={p}><input type="checkbox" checked={has(t.id, p)} onChange={() => toggle(t.id, p)} aria-label={`${t.full_name} dạy ${p}`} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function Curriculum() {
  const [rows, setRows] = useState<{ id: string; grade: number; subject: string; title: string; total_periods: number | null }[]>([])
  const [grade, setGrade] = useState(0)
  const [subject, setSubject] = useState('')
  useEffect(() => { supabase.from('curriculum_books').select('*').order('grade').then(({ data }) => setRows((data as any) ?? [])) }, [])
  const subjects = [...new Set(rows.map(r => r.subject))]
  const shown = rows.filter(r => (!grade || r.grade === grade) && (!subject || r.subject === subject))
  return (
    <>
      <div className="bar">
        <div className="segmented">
          {[0, 6, 7, 8, 9].map(g => <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g ? `Lớp ${g}` : 'Tất cả'}</button>)}
        </div>
        <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Môn học"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
      </div>
      <div className="reggrid">
        {shown.map(b => (
          <div className="panel regcard" key={b.id}><b>{b.title}</b><small>{b.subject} · Khối {b.grade}</small><small>{b.total_periods} tiết/năm</small></div>
        ))}
        {shown.length === 0 && <p className="sub">Không có sách phù hợp.</p>}
      </div>
    </>
  )
}

export function SchoolProfile() {
  const [org, setOrg] = useState<any>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: u }) => {
      const { data: p } = await supabase.from('profiles').select('org_id, organizations(name, code, level, parent:parent_id(name))').eq('id', u.user!.id).single()
      setOrg((p as any)?.organizations)
    })
    Promise.all(['teachers', 'classes', 'students', 'equipment_units'].map(t => supabase.from(t).select('*', { count: 'exact', head: true }).then(r => [t, r.count ?? 0] as const)))
      .then(async r => setCounts({ ...Object.fromEntries(r), stem_rooms: (await loadRooms('stem')).length }))
  }, [])
  const LEVEL: Record<string, string> = { mamnon: 'Mầm non', tieuhoc: 'Tiểu học', thcs: 'THCS', thpt: 'THPT' }
  if (!org) return <p className="sub">Đang tải…</p>
  return (
    <>
      <div className="panel">
        <h3>{org.name}</h3>
        <table style={{ border: 0 }}><tbody>
          <tr><td>Mã đơn vị</td><td><b>{org.code}</b></td></tr>
          <tr><td>Cấp học</td><td><b>{LEVEL[org.level] ?? org.level ?? '—'}</b></td></tr>
          <tr><td>Cơ quan quản lý</td><td><b>{org.parent?.name ?? '—'}</b></td></tr>
        </tbody></table>
      </div>
      <div className="cards">
        {([['teachers', 'Giáo viên'], ['classes', 'Lớp học'], ['students', 'Học sinh'], ['stem_rooms', 'Phòng STEM'], ['equipment_units', 'Thiết bị']] as const).map(([k, l]) => (
          <div className="card" key={k}><strong>{counts[k] ?? 0}</strong><span>{l}</span></div>
        ))}
      </div>
    </>
  )
}
