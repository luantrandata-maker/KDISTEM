import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Ent = { id: string; weekday: number; period_id: string; subject: string; kind: string; classes: { name: string } | null; stem_rooms: { name: string } | null }
type Period = { id: string; name: string; starts_at: string; ends_at: string; session: string }
type Props = { teacherId: string | null; orgId: string | null }
const hm = (t: string) => t.slice(0, 5)
const todayWeekday = () => { const d = new Date().getDay(); return d === 0 ? 0 : d + 1 } // Thứ 2 = 2 … Thứ 7 = 7, Chủ nhật = 0
const NoTeacher = () => <p className="sub">Tài khoản này chưa được liên kết với hồ sơ giáo viên. Quản trị trường liên kết trong mục Tài khoản.</p>

function useMySchedule(teacherId: string | null) {
  const [entries, setEntries] = useState<Ent[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  useEffect(() => {
    if (!teacherId) return
    Promise.all([
      supabase.from('timetable_entries').select('id, weekday, period_id, subject, kind, classes(name), stem_rooms(name)').eq('teacher_id', teacherId),
      supabase.from('period_configs').select('*').order('starts_at'),
    ]).then(([e, p]) => { setEntries((e.data as unknown as Ent[]) ?? []); setPeriods((p.data as Period[]) ?? []) })
  }, [teacherId])
  return { entries, periods }
}

export function TeacherHome({ teacherId }: Props) {
  const { entries, periods } = useMySchedule(teacherId)
  const [regs, setRegs] = useState<{ status: string }[]>([])
  useEffect(() => { if (teacherId) supabase.from('stem_registrations').select('status').eq('teacher_id', teacherId).then(({ data }) => setRegs(data ?? [])) }, [teacherId])
  if (!teacherId) return <NoTeacher />
  const wd = todayWeekday()
  const today = entries.filter(e => e.weekday === wd).sort((a, b) => periods.findIndex(p => p.id === a.period_id) - periods.findIndex(p => p.id === b.period_id))
  const pr = (id: string) => periods.find(p => p.id === id)
  const n = (s: string) => regs.filter(r => r.status === s).length
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{entries.length}</strong><span>Tiết/tuần</span></div>
        <div className="card"><strong>{entries.filter(e => e.kind === 'stem').length}</strong><span>Tiết STEM/tuần</span></div>
        <div className="card"><strong>{n('pending')}</strong><span>Đăng ký chờ duyệt</span></div>
        <div className="card"><strong>{n('approved')}</strong><span>Đăng ký đã duyệt</span></div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Lịch dạy hôm nay</h3>
        {wd === 0 && <small>Hôm nay là Chủ nhật, không có tiết dạy.</small>}
        {wd !== 0 && today.length === 0 && <small>Hôm nay bạn không có tiết dạy.</small>}
        {today.map(e => (
          <div className="roomrow" key={e.id}>
            <div><b>{e.subject}</b>{e.kind === 'stem' && <span className="badge">STEM</span>}<br /><small>{e.classes?.name}{e.stem_rooms ? ` · ${e.stem_rooms.name}` : ''}</small></div>
            <small>{pr(e.period_id)?.name} · {pr(e.period_id) && `${hm(pr(e.period_id)!.starts_at)}–${hm(pr(e.period_id)!.ends_at)}`}</small>
          </div>
        ))}
      </div>
    </>
  )
}

export function TeacherSchedule({ teacherId }: Props) {
  const { entries, periods } = useMySchedule(teacherId)
  const [kind, setKind] = useState('all')
  if (!teacherId) return <NoTeacher />
  const cell = (p: Period, d: number) => entries.filter(e => e.period_id === p.id && e.weekday === d && (kind === 'all' || e.kind === kind))
  return (
    <>
      <div className="segmented">
        {[['all', 'Tất cả'], ['stem', 'Tiết STEM'], ['regular', 'Tiết thường']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <div className="wrap">
        <table className="tkb">
          <thead><tr><th>Tiết</th>{[2, 3, 4, 5, 6, 7].map(d => <th key={d} style={d === todayWeekday() ? { color: 'var(--primary)' } : undefined}>Thứ {d}</th>)}</tr></thead>
          <tbody>
            {periods.map(p => (
              <tr key={p.id}>
                <td><b>{p.name}</b><br /><small>{hm(p.starts_at)}–{hm(p.ends_at)}</small></td>
                {[2, 3, 4, 5, 6, 7].map(d => (
                  <td key={d}>{cell(p, d).map(e => (
                    <div key={e.id} className={'slot' + (e.kind === 'stem' ? ' stem' : '')}><b>{e.subject}</b>{e.kind === 'stem' && <span className="badge">STEM</span>}<br /><small>{e.classes?.name}{e.stem_rooms ? ` · ${e.stem_rooms.name}` : ''}</small></div>
                  ))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function TeacherClasses({ teacherId }: Props) {
  const [rows, setRows] = useState<{ id: string; subject: string; classes: { id: string; name: string; grade: number } | null }[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!teacherId) return
    supabase.from('teaching_assignments').select('id, subject, classes(id, name, grade)').eq('teacher_id', teacherId).then(({ data }) => setRows((data as any) ?? []))
    supabase.from('students').select('class_id').then(({ data }) => {
      const m: Record<string, number> = {}; (data ?? []).forEach((s: any) => { m[s.class_id] = (m[s.class_id] ?? 0) + 1 }); setCounts(m)
    })
  }, [teacherId])
  if (!teacherId) return <NoTeacher />
  return (
    <table>
      <thead><tr><th>Lớp</th><th>Khối</th><th>Môn dạy</th><th>Sĩ số</th></tr></thead>
      <tbody>
        {rows.map(r => <tr key={r.id}><td><b>{r.classes?.name}</b></td><td>Khối {r.classes?.grade}</td><td>{r.subject}</td><td>{r.classes ? counts[r.classes.id] ?? 0 : '—'}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={4}>Bạn chưa được phân công lớp nào.</td></tr>}
      </tbody>
    </table>
  )
}

type Reg = { id: string; topic: string; status: string; on_date: string; classes: { name: string } | null; stem_rooms: { name: string } | null; period_configs: { name: string } | null }
const ST: Record<string, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }

export function TeacherBooking({ teacherId, orgId }: Props) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string; status: string }[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [mine, setMine] = useState<Reg[]>([])
  const [taken, setTaken] = useState<Set<string>>(new Set())
  const [f, setF] = useState({ class_id: '', room_id: '', period_id: '', on_date: new Date().toISOString().slice(0, 10), topic: '' })
  const [err, setErr] = useState('')

  async function load() {
    if (!teacherId) return
    const [a, r, p, m, ap] = await Promise.all([
      supabase.from('teaching_assignments').select('classes(id, name)').eq('teacher_id', teacherId),
      supabase.from('stem_rooms').select('id, name, status').order('name'),
      supabase.from('period_configs').select('*').order('starts_at'),
      supabase.from('stem_registrations').select('id, topic, status, on_date, classes(name), stem_rooms(name), period_configs(name)').eq('teacher_id', teacherId).order('on_date', { ascending: false }),
      supabase.from('stem_registrations').select('room_id, period_id, on_date').eq('status', 'approved'),
    ])
    const cl = ((a.data as any[]) ?? []).map(x => x.classes).filter(Boolean)
    const uniq = [...new Map(cl.map((c: any) => [c.id, c])).values()] as { id: string; name: string }[]
    setClasses(uniq); setRooms(((r.data as any) ?? []).filter((x: any) => x.status === 'active')); setPeriods((p.data as Period[]) ?? [])
    setMine((m.data as unknown as Reg[]) ?? [])
    setTaken(new Set(((ap.data as any[]) ?? []).map(x => `${x.room_id}|${x.on_date}|${x.period_id}`)))
    setF(v => ({ ...v, class_id: v.class_id || uniq[0]?.id || '', room_id: v.room_id || (r.data as any)?.find((x: any) => x.status === 'active')?.id || '', period_id: v.period_id || (p.data as any)?.[0]?.id || '' }))
  }
  useEffect(() => { load() }, [teacherId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (taken.has(`${f.room_id}|${f.on_date}|${f.period_id}`)) return setErr('Phòng này đã có đăng ký được duyệt ở tiết và ngày đã chọn.')
    const { error } = await supabase.from('stem_registrations').insert({ ...f, teacher_id: teacherId, org_id: orgId })
    if (error) return setErr(error.message)
    setErr(''); setF({ ...f, topic: '' }); load()
  }

  if (!teacherId) return <NoTeacher />
  return (
    <>
      <form className="panel formgrid" onSubmit={submit}>
        <select required value={f.class_id} onChange={e => setF({ ...f, class_id: e.target.value })} aria-label="Lớp">
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select required value={f.room_id} onChange={e => setF({ ...f, room_id: e.target.value })} aria-label="Phòng STEM">
          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input type="date" required value={f.on_date} onChange={e => setF({ ...f, on_date: e.target.value })} aria-label="Ngày dạy" />
        <select required value={f.period_id} onChange={e => setF({ ...f, period_id: e.target.value })} aria-label="Tiết">
          {periods.map(p => <option key={p.id} value={p.id}>{p.name} ({hm(p.starts_at)}–{hm(p.ends_at)})</option>)}
        </select>
        <input required placeholder="Chủ đề bài dạy" value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} />
        <div><button className="primary" type="submit" disabled={classes.length === 0}>Gửi đăng ký</button></div>
        {classes.length === 0 && <p className="msg">Bạn cần được phân công lớp trước khi đăng ký phòng.</p>}
        {err && <p className="msg">{err}</p>}
      </form>
      <table>
        <thead><tr><th>Chủ đề</th><th>Lớp</th><th>Phòng</th><th>Ngày · Tiết</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {mine.map(r => (
            <tr key={r.id}><td><b>{r.topic}</b></td><td>{r.classes?.name}</td><td>{r.stem_rooms?.name}</td>
              <td>{new Date(r.on_date).toLocaleDateString('vi-VN')} · {r.period_configs?.name}</td>
              <td><span className={'pill ' + (r.status === 'approved' ? 'active' : r.status === 'pending' ? 'maintenance' : 'inactive')}>{ST[r.status]}</span></td></tr>
          ))}
          {mine.length === 0 && <tr><td colSpan={5}>Bạn chưa gửi đăng ký nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
