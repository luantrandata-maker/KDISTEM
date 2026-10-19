import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import FormPanel from '../../components/FormPanel'
import {
  SESSION_COLS, STATE, MARK, ensureWeek, today, addDays, weekStart, dayLabel, shortDay, attendRate, parseDay,
  type SessionRow, type Mark,
} from '../../lib/attendance'
import { NoTeacher, Tabs } from '../teacher/common'
import { loadRooms } from '../../lib/rooms'

// ================= Bảng điểm danh một tiết =================
type Stu = { id: string; full_name: string; student_code: string | null }
// Cùng một câu truy vấn cho bảng điểm danh và tải trước (để lớp lưu sẵn trên máy, điểm danh được khi mất mạng)
const loadRoll = (session: Pick<SessionRow, 'id' | 'class_id'>) => Promise.all([
  supabase.from('students').select('id, full_name, student_code').eq('class_id', session.class_id).eq('status', 'studying').order('full_name'),
  supabase.from('lesson_attendance').select('student_id, status, note').eq('session_id', session.id),
])

export function RollPanel({ session, onDone, onClose }: { session: SessionRow; onDone: () => void; onClose: () => void }) {
  const [students, setStudents] = useState<Stu[] | null>(null)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [note, setNote] = useState(session.note ?? '')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadRoll(session).then(([s, a]) => {
      const list = (s.data as Stu[]) ?? []
      const old = new Map(((a.data as { student_id: string; status: Mark; note: string | null }[]) ?? []).map(x => [x.student_id, x]))
      // Lần đầu điểm danh: mặc định mọi học sinh có mặt, giáo viên chỉ chỉnh người vắng/muộn
      setMarks(Object.fromEntries(list.map(x => [x.id, old.get(x.id)?.status ?? 'present'])))
      setNotes(Object.fromEntries(list.map(x => [x.id, old.get(x.id)?.note ?? ''])))
      setStudents(list)
    })
  }, [session.id])

  async function save() {
    setBusy(true); setErr('')
    const payload = (students ?? []).map(s => ({ student_id: s.id, status: marks[s.id], note: notes[s.id] || null }))
    const { error } = await supabase.rpc('mark_teaching_session', { p_session: session.id, p_marks: payload, p_note: note || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone()
  }

  const count = (m: Mark) => Object.values(marks).filter(x => x === m).length
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="bar">
        <div><b>{session.subject} · {session.class_name}</b><br /><small>{dayLabel(session.session_date)} · {session.period_name}{session.room_name ? ` · ${session.room_name}` : ''}</small></div>
        <div className="tools">
          {(Object.keys(MARK) as Mark[]).map(m => <span key={m} className="chip">{MARK[m]} {count(m)}</span>)}
        </div>
      </div>
      {!students ? <p className="sub">Đang tải danh sách lớp…</p> : students.length === 0 ? <p className="sub">Lớp chưa có học sinh.</p> : (
        <>
          <div className="bar" style={{ margin: '8px 0' }}>
            <button type="button" onClick={() => setMarks(Object.fromEntries(students.map(s => [s.id, 'present'])))}>Tất cả có mặt</button>
          </div>
          <div className="wrap"><table>
            <thead><tr><th>#</th><th>Học sinh</th><th>Điểm danh</th><th>Ghi chú</th></tr></thead>
            <tbody>{students.map((s, i) => (
              <tr key={s.id}>
                <td>{i + 1}</td><td><b>{s.full_name}</b><br /><small>{s.student_code}</small></td>
                <td><div className="segmented" role="radiogroup" aria-label={'Điểm danh ' + s.full_name} style={{ margin: 0 }}>
                  {(Object.keys(MARK) as Mark[]).map(m => (
                    <button type="button" key={m} role="radio" aria-checked={marks[s.id] === m} className={marks[s.id] === m ? 'on' : ''}
                      onClick={() => setMarks(v => ({ ...v, [s.id]: m }))}>{MARK[m]}</button>
                  ))}
                </div></td>
                <td><input value={notes[s.id] ?? ''} onChange={e => setNotes(v => ({ ...v, [s.id]: e.target.value }))} aria-label={'Ghi chú ' + s.full_name} placeholder={marks[s.id] === 'present' ? '' : 'Lý do…'} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      <label className="field" style={{ marginTop: 10 }}><span>Nội dung / ghi chú tiết dạy</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: Bài 5 — Lắp mạch điện đơn giản" /></label>
      {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
      <div className="formactions" style={{ marginTop: 10 }}>
        <button className="primary" onClick={save} disabled={busy || !students?.length}>{busy ? 'Đang lưu…' : 'Lưu điểm danh'}</button>
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  )
}

const StatePill = ({ s }: { s: SessionRow }) => (
  <span className={'pill ' + STATE[s.state].pill} title={s.cancel_reason ?? undefined}>{STATE[s.state].label}{s.is_makeup ? ' · dạy bù' : ''}</span>
)
const Counts = ({ s }: { s: SessionRow }) => s.status !== 'taught' ? <small>—</small> : (
  <small>{s.present_count + s.late_count}/{s.present_count + s.late_count + s.absent_count + s.excused_count} có mặt
    {s.absent_count ? ` · ${s.absent_count} vắng` : ''}{s.excused_count ? ` · ${s.excused_count} có phép` : ''}</small>
)
const canTeacherMark = (s: SessionRow) =>
  s.status !== 'cancelled' && Date.now() >= new Date(s.starts_at).getTime() - 10 * 60000 && s.session_date >= addDays(today(), -7)

// ================= Giáo viên: Điểm danh =================
export function TeacherAttendance({ teacherId, orgId }: { teacherId: string | null; orgId: string | null }) {
  const [day, setDay] = useState(today())
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [pending, setPending] = useState<SessionRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    if (!teacherId) return
    const e = await ensureWeek(orgId, day)
    // Tuần trước cũng cần có buổi dạy để nhắc tiết chưa điểm danh
    await ensureWeek(orgId, addDays(today(), -7))
    if (typeof e === 'string') setErr(e)
    const [d, p] = await Promise.all([
      supabase.from('teaching_session_view').select(SESSION_COLS).eq('teacher_id', teacherId).eq('session_date', day).order('starts_at'),
      supabase.from('teaching_session_view').select(SESSION_COLS).eq('teacher_id', teacherId).eq('state', 'not_marked')
        .gte('session_date', addDays(today(), -7)).order('starts_at', { ascending: false }),
    ])
    if (d.error) setErr(d.error.message)
    const list = (d.data as unknown as SessionRow[]) ?? []
    setRows(list); setPending((p.data as unknown as SessionRow[]) ?? [])
    // Có mạng: tải trước danh sách lớp của các tiết trong ngày để điểm danh được cả khi mất mạng
    if (navigator.onLine) list.filter(s => s.status !== 'cancelled').forEach(s => { loadRoll(s).catch(() => {}) })
  }
  useEffect(() => { load() }, [teacherId, day])

  if (!teacherId) return <NoTeacher />
  const opened = [...(rows ?? []), ...pending].find(s => s.id === open)
  return (
    <>
      {pending.length > 0 && (
        <div className="panel warnbox" style={{ marginBottom: 14 }}>
          <h3>Tiết chưa điểm danh ({pending.length})</h3>
          {pending.map(s => (
            <button key={s.id} className="todo hi" onClick={() => { setDay(s.session_date); setOpen(s.id) }}>
              <span>{dayLabel(s.session_date)} · {s.period_name} · {s.subject} {s.class_name}</span><span className="n go">Điểm danh</span>
            </button>
          ))}
          <small>Giáo viên điểm danh được trong 7 ngày; quá hạn nhờ quản trị trường.</small>
        </div>
      )}
      <DayNav day={day} onChange={setDay} count={rows?.length ?? null} />
      {err && <p className="sub" role="alert">{err}</p>}
      {!rows ? <p className="sub">Đang tải…</p> : (
        <div className="wrap" style={{ marginTop: 12 }}><table>
          <thead><tr><th>Tiết</th><th>Môn · Lớp</th><th>Phòng</th><th>Trạng thái</th><th>Sĩ số</th><th></th></tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id}>
                <td><b>{s.period_name}</b><br /><small>{new Date(s.starts_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></td>
                <td>{s.subject}{s.kind === 'stem' && <span className="badge">STEM</span>}<br /><small>{s.class_name}</small></td>
                <td>{s.room_name ?? '—'}</td>
                <td><StatePill s={s} /></td>
                <td><Counts s={s} /></td>
                <td>{canTeacherMark(s) && <button className={s.state === 'taught' ? '' : 'primary'} onClick={() => setOpen(open === s.id ? null : s.id)}>{s.state === 'taught' ? 'Sửa' : 'Điểm danh'}</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}>{parseDay(day).getDay() === 0 ? 'Chủ nhật, không có tiết dạy.' : 'Không có tiết dạy trong ngày này.'}</td></tr>}
          </tbody>
        </table></div>
      )}
      {opened && <RollPanel key={opened.id} session={opened} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load() }} />}
    </>
  )
}

// Chọn ngày: dải tuần (T2–T7, CN), lùi / tiến tuần, lịch, về hôm nay
const DOWS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
export function DayNav({ day, onChange, count }: { day: string; onChange: (d: string) => void; count?: number | null }) {
  const ws = weekStart(day), t = today()
  return (
    <div className="daynav">
      <div className="dn-title">
        <b>{dayLabel(day)}{day === t && <span className="dn-today">Hôm nay</span>}</b>
        {count != null && <small>{count ? `${count} tiết dạy` : 'Không có tiết'}</small>}
      </div>
      <div className="dn-ctrl">
        <span className="dn-weekwrap"><button className="dn-arrow" onClick={() => onChange(addDays(day, -7))} aria-label="Tuần trước" title="Tuần trước">‹</button>
        <div className="dn-week" role="tablist" aria-label="Ngày trong tuần">
          {DOWS.map((w, i) => { const d = addDays(ws, i); return (
            <button key={d} role="tab" aria-selected={d === day} className={(d === day ? 'on' : '') + (d === t ? ' is-today' : '') + (i === 6 ? ' sun' : '')} onClick={() => onChange(d)}>
              <small>{w}</small><b>{shortDay(d).slice(0, 2)}</b></button>) })}
        </div>
        <button className="dn-arrow" onClick={() => onChange(addDays(day, 7))} aria-label="Tuần sau" title="Tuần sau">›</button></span>
        <label className="dn-pick" title="Chọn ngày khác"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
          <input type="date" value={day} onChange={e => e.target.value && onChange(e.target.value)} aria-label="Chọn ngày" /></label>
        <button className="dn-todaybtn" disabled={day === t} onClick={() => onChange(t)}>Hôm nay</button>
      </div>
    </div>
  )
}

// ================= Trường: Buổi dạy & điểm danh =================
type Opt = { id: string; name: string }
export function SchoolSessions({ orgId }: { orgId: string }) {
  const [week, setWeek] = useState(weekStart(today()))
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [periods, setPeriods] = useState<Opt[]>([]); const [rooms, setRooms] = useState<Opt[]>([])
  const [cls, setCls] = useState(''); const [teacher, setTeacher] = useState(''); const [tab, setTab] = useState<'all' | SessionRow['state']>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [makeup, setMakeup] = useState<SessionRow | null>(null)
  const [msg, setMsg] = useState('')

  async function load(force = false) {
    const g = await ensureWeek(orgId, week, force)
    if (typeof g === 'string') setMsg(g)
    else if (g && force) setMsg(`Đã đồng bộ với TKB: thêm ${g.created}, cập nhật ${g.updated}, bỏ ${g.removed} tiết.`)
    const { data, error } = await supabase.from('teaching_session_view').select(SESSION_COLS).eq('org_id', orgId)
      .gte('session_date', week).lte('session_date', addDays(week, 6)).order('session_date').order('starts_at').limit(5000)
    if (error) setMsg(error.message)
    setRows((data as unknown as SessionRow[]) ?? [])
  }
  useEffect(() => { load() }, [week])
  useEffect(() => {
    supabase.from('period_configs').select('id, name').order('starts_at').then(({ data }) => setPeriods((data as Opt[]) ?? []))
    loadRooms('stem').then(rs => setRooms(rs))
  }, [])

  async function cancel(s: SessionRow) {
    const reason = prompt(`Huỷ tiết ${s.subject} ${s.class_name} (${dayLabel(s.session_date)}, ${s.period_name}). Lý do:`)
    if (reason === null) return
    const { error } = await supabase.from('teaching_sessions').update({ status: 'cancelled', cancel_reason: reason || null }).eq('id', s.id)
    if (error) setMsg(error.message); else load()
  }
  async function restore(s: SessionRow) {
    const { error } = await supabase.from('teaching_sessions').update({ status: 'scheduled', cancel_reason: null }).eq('id', s.id)
    if (error) setMsg(error.message); else load()
  }
  async function addMakeup(v: Record<string, string>) {
    if (!makeup) return
    const { error } = await supabase.from('teaching_sessions').insert({
      org_id: orgId, class_id: makeup.class_id, teacher_id: makeup.teacher_id, subject: makeup.subject, kind: makeup.kind,
      session_date: v.date, period_id: v.period_id, room_id: v.room_id || null, is_makeup: true, makeup_of: makeup.id,
    })
    if (error) return error.message.includes('class_id_session_date_period_id') ? 'Lớp đã có tiết ở khung giờ này.' : error.message
    setMakeup(null); setWeek(weekStart(v.date)); load()
  }

  const all = rows ?? []
  const classes = useMemo(() => [...new Map(all.map(s => [s.class_id, s.class_name ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi')), [rows])
  const teachers = useMemo(() => [...new Map(all.filter(s => s.teacher_id).map(s => [s.teacher_id!, s.teacher_name ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi')), [rows])
  const scoped = all.filter(s => (!cls || s.class_id === cls) && (!teacher || s.teacher_id === teacher))
  const n = (k: SessionRow['state']) => scoped.filter(s => s.state === k).length
  const shown = scoped.filter(s => tab === 'all' || s.state === tab)
  const att = scoped.reduce((a, s) => ({ present: a.present + s.present_count, late: a.late + s.late_count, absent: a.absent + s.absent_count, excused: a.excused + s.excused_count }), { present: 0, late: 0, absent: 0, excused: 0 })
  const rate = attendRate(att)
  const due = n('taught') + n('not_marked')
  const opened = all.find(s => s.id === open)

  return (
    <>
      <div className="bar">
        <div className="tools">
          <button onClick={() => setWeek(addDays(week, -7))} aria-label="Tuần trước">‹</button>
          <b>Tuần {shortDay(week)} – {shortDay(addDays(week, 5))}</b>
          <button onClick={() => setWeek(addDays(week, 7))} aria-label="Tuần sau">›</button>
          {week !== weekStart(today()) && <button onClick={() => setWeek(weekStart(today()))}>Tuần này</button>}
        </div>
        <button onClick={() => load(true)}>Đồng bộ lại với TKB</button>
      </div>
      {msg && <p className="sub" role="status">{msg}</p>}
      <div className="cards" style={{ marginTop: 12 }}>
        <div className="card"><strong>{scoped.filter(s => s.state !== 'cancelled').length}</strong><span>Tiết theo lịch</span></div>
        <div className="card"><strong>{n('taught')}</strong><span>Đã dạy{due ? ` · ${Math.round((n('taught') / due) * 100)}%` : ''}</span></div>
        <div className="card"><strong style={n('not_marked') ? { color: 'var(--bad)' } : undefined}>{n('not_marked')}</strong><span>Chưa điểm danh</span></div>
        <div className="card"><strong>{rate === null ? '—' : rate + '%'}</strong><span>Chuyên cần học sinh</span></div>
      </div>
      <div className="bar" style={{ margin: '14px 0' }}>
        <Tabs value={tab} onChange={setTab} items={[['all', 'Tất cả', scoped.length], ['not_marked', 'Chưa điểm danh', n('not_marked')], ['taught', 'Đã dạy', n('taught')], ['upcoming', 'Sắp diễn ra', n('upcoming')], ['cancelled', 'Đã huỷ', n('cancelled')]]} />
        <div className="tools">
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lớp"><option value="">Tất cả lớp</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select value={teacher} onChange={e => setTeacher(e.target.value)} aria-label="Giáo viên"><option value="">Tất cả giáo viên</option>{teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </div>
      </div>
      {makeup && <FormPanel submitLabel="Thêm tiết dạy bù" fields={[
        { key: 'date', label: `Ngày dạy bù cho ${makeup.subject} ${makeup.class_name}`, type: 'date', required: true },
        { key: 'period_id', label: 'Tiết', type: 'select', required: true, options: periods.map(p => ({ value: p.id, label: p.name })) },
        { key: 'room_id', label: 'Phòng STEM (nếu có)', type: 'select', options: [{ value: '', label: '—' }, ...rooms.map(r => ({ value: r.id, label: r.name }))] },
      ]} initial={{ date: today(), room_id: makeup.room_id ?? '' }} onSubmit={addMakeup} onCancel={() => setMakeup(null)} />}
      {!rows ? <p className="sub">Đang tải…</p> : (
        <div className="wrap"><table>
          <thead><tr><th>Ngày · Tiết</th><th>Môn · Lớp</th><th>Giáo viên</th><th>Trạng thái</th><th>Sĩ số</th><th></th></tr></thead>
          <tbody>
            {shown.map(s => (
              <tr key={s.id}>
                <td>{dayLabel(s.session_date)}<br /><small>{s.period_name}</small></td>
                <td>{s.subject}{s.kind === 'stem' && <span className="badge">STEM</span>}<br /><small>{s.class_name}{s.room_name ? ` · ${s.room_name}` : ''}</small></td>
                <td>{s.teacher_name ?? '—'}</td>
                <td><StatePill s={s} />{s.cancel_reason && <><br /><small>{s.cancel_reason}</small></>}</td>
                <td><Counts s={s} /></td>
                <td className="nowrap">
                  {s.status !== 'cancelled' && s.state !== 'upcoming' && <button onClick={() => setOpen(open === s.id ? null : s.id)}>{s.state === 'taught' ? 'Sửa điểm danh' : 'Điểm danh'}</button>}
                  {s.status === 'scheduled' && <button onClick={() => cancel(s)}>Huỷ</button>}
                  {s.status === 'cancelled' && <><button onClick={() => setMakeup(s)}>Dạy bù</button> <button onClick={() => restore(s)}>Khôi phục</button></>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}>{all.length === 0 ? 'Tuần này chưa có tiết nào. Kiểm tra Thời khoá biểu và ngày bắt đầu/kết thúc học kỳ.' : 'Không có tiết phù hợp.'}</td></tr>}
          </tbody>
        </table></div>
      )}
      {opened && <RollPanel key={opened.id} session={opened} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load() }} />}
    </>
  )
}
