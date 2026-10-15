import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { PROG, isoDate, mondayOf, addDays } from '../lib/programs'
import { UNIT_STATUS } from './Equipment'
import { decideText, approvalError } from './approvals/common'

type Room = { id: string; name: string; code: string | null; capacity: number | null; status: string; area_m2: number | null; tier: string; programs: string | null; floors: { name: string; buildings: { name: string } | null } | null }
type Unit = { id: string; serial: string | null; status: string; room_id: string | null; equipment_types: { name: string } | null }
type Borrow = { id: string; title: string; items: string | null; on_date: string; mode: string; status: string; room_id: string | null; teachers: { full_name: string } | null; period_configs: { name: string } | null }
type Reg = { id: string; on_date: string; topic: string; program: string | null; status: string; room_id: string; period_id: string; classes: { name: string } | null; teachers: { full_name: string } | null }
type TT = { id: string; weekday: number; period_id: string; subject: string; room_id: string | null; classes: { name: string } | null; teachers: { full_name: string } | null }
type Period = { id: string; name: string; starts_at: string; ends_at: string }
const BSTATUS: Record<string, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', lent: 'Đã giao', returned: 'Đã trả', rejected: 'Từ chối' }
const ROOM_STATUS: Record<string, string> = { active: 'Hoạt động', maintenance: 'Bảo trì', inactive: 'Ngừng' }
type View = 'hub' | 'schedule' | 'equipment' | 'borrow' | 'loaned' | 'repair'
const hm = (t: string) => t.slice(0, 5)
const fmt = (d: string) => new Date(d).toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' })

export default function Rooms({ orgId }: { orgId: string }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [sel, setSel] = useState('')
  const [view, setView] = useState<View>('hub')
  const [units, setUnits] = useState<Unit[]>([])
  const [borrows, setBorrows] = useState<Borrow[]>([])
  const [regs, setRegs] = useState<Reg[]>([])
  const [tt, setTt] = useState<TT[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [adding, setAdding] = useState(false)
  const [week, setWeek] = useState(mondayOf(new Date()))

  async function load() {
    const [r, u, b, g, t, p] = await Promise.all([
      supabase.from('stem_rooms').select('id, name, code, capacity, status, area_m2, tier, programs, floors(name, buildings(name))').order('code'),
      supabase.from('equipment_units').select('id, serial, status, room_id, equipment_types(name)').order('serial'),
      supabase.from('borrow_requests').select('id, title, items, on_date, mode, status, room_id, teachers(full_name), period_configs(name)').order('on_date'),
      supabase.from('stem_registrations').select('id, on_date, topic, program, status, room_id, period_id, classes(name), teachers(full_name)'),
      supabase.from('timetable_entries').select('id, weekday, period_id, subject, room_id, classes(name), teachers(full_name)').eq('kind', 'stem'),
      supabase.from('period_configs').select('*').order('starts_at'),
    ])
    const rs = (r.data as unknown as Room[]) ?? []
    setRooms(rs); setSel(v => v || rs[0]?.id || '')
    setUnits((u.data as unknown as Unit[]) ?? []); setBorrows((b.data as unknown as Borrow[]) ?? [])
    setRegs((g.data as unknown as Reg[]) ?? []); setTt((t.data as unknown as TT[]) ?? []); setPeriods((p.data as Period[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const room = rooms.find(r => r.id === sel)
  if (!room) return <p className="sub">Đang tải…</p>

  const ru = units.filter(u => u.room_id === room.id)
  const bad = ru.filter(u => u.status === 'broken' || u.status === 'maintenance')
  const rb = borrows.filter(b => b.room_id === room.id)
  const todayIso = isoDate(new Date()); const wd = new Date().getDay() === 0 ? 0 : new Date().getDay() + 1
  const weekIso = [0, 1, 2, 3, 4, 5, 6].map(i => isoDate(addDays(week, i)))
  const approvedRegs = regs.filter(r => r.room_id === room.id && r.status === 'approved')
  const roomTt = tt.filter(e => e.room_id === room.id)
  const lessonsToday = [...roomTt.filter(e => e.weekday === wd).map(e => ({ k: e.id, t: e.subject, s: e.classes?.name ?? '', p: e.period_id })),
    ...approvedRegs.filter(r => r.on_date === todayIso).map(r => ({ k: r.id, t: r.topic, s: r.classes?.name ?? '', p: r.period_id }))]
  const weekCount = roomTt.length + approvedRegs.filter(r => weekIso.includes(r.on_date)).length
  const todo = [...rb.filter(b => b.status === 'pending').map(b => ({ k: b.id, title: b.title, sub: `${fmt(b.on_date)} · ${b.teachers?.full_name ?? ''}`, tag: 'Chờ duyệt' })),
    ...regs.filter(r => r.room_id === room.id && r.status === 'pending').map(r => ({ k: r.id, title: r.topic, sub: `${fmt(r.on_date)} · ${r.teachers?.full_name ?? ''}`, tag: 'Đăng ký dạy' }))]
  const pr = (id: string) => periods.find(p => p.id === id)

  async function setBorrow(b: Borrow, status: string) {
    // Duyệt / từ chối đi qua công cụ phê duyệt (022); giao, trả thiết bị cập nhật trực tiếp
    if (b.status === 'pending' && (status === 'approved' || status === 'rejected')) {
      const { data, error } = await supabase.rpc('approval_decide_ref', { p_table: 'borrow_requests', p_ref: b.id, p_decision: status === 'approved' ? 'approve' : 'reject', p_note: null })
      if (error) alert(approvalError(error.message)); else if ((data as { status: string }).status === 'pending') alert(decideText(data as never))
    } else {
      const { error } = await supabase.from('borrow_requests').update({ status }).eq('id', b.id)
      if (error) alert(approvalError(error.message))
    }
    load()
  }
  async function addBorrow(v: Record<string, string>) {
    const { error } = await supabase.from('borrow_requests').insert({ org_id: orgId, room_id: room!.id, teacher_id: v.teacher_id || null, title: v.title, items: v.items || null, on_date: v.on_date, period_id: v.period_id || null, mode: v.mode })
    if (error) return error.message
    setAdding(false); load()
  }
  async function toMaintenance(u: Unit, status: string) {
    await supabase.from('equipment_units').update({ status }).eq('id', u.id)
    await supabase.from('equipment_events').insert({ org_id: orgId, unit_id: u.id, kind: status, title: status === 'maintenance' ? 'Chuyển bảo trì' : 'Đã sửa xong', note: `${room!.name}` })
    load()
  }
  async function reportTicket(u: Unit) {
    const description = prompt(`Mô tả sự cố của ${u.equipment_types?.name} (${u.serial}):`)
    if (!description) return
    const code = `WT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    await supabase.from('warranty_tickets').insert({ org_id: orgId, code, unit_id: u.id, description, status: 'new', provider: 'KDI Education' })
    await supabase.from('equipment_units').update({ status: 'broken' }).eq('id', u.id)
    await supabase.from('equipment_events').insert({ org_id: orgId, unit_id: u.id, kind: 'report', title: 'Báo hỏng', note: `${code}: ${description}` })
    load()
  }

  const BorrowTable = ({ list }: { list: Borrow[] }) => (
    <table>
      <thead><tr><th>Phiếu mượn</th><th>Người mượn</th><th>Ngày · Tiết</th><th>Hình thức</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>
        {list.map(b => (
          <tr key={b.id}><td><b>{b.title}</b><br /><small>{b.items}</small></td><td>{b.teachers?.full_name}</td>
            <td>{fmt(b.on_date)}<br /><small>{b.period_configs?.name ?? 'Tiết 0'}</small></td>
            <td>{b.mode === 'in_room' ? 'Dùng tại phòng' : 'Mang về lớp'}</td>
            <td><span className={'pill ' + (b.status === 'lent' ? 'maintenance' : b.status === 'rejected' ? 'inactive' : b.status === 'pending' ? '' : 'active')}>{BSTATUS[b.status]}</span></td>
            <td>
              {b.status === 'pending' && <><button className="primary" onClick={() => setBorrow(b, 'approved')}>Duyệt</button> <button onClick={() => setBorrow(b, 'rejected')}>Từ chối</button></>}
              {b.status === 'approved' && <button className="primary" onClick={() => setBorrow(b, 'lent')}>Giao thiết bị</button>}
              {b.status === 'lent' && <button className="primary" onClick={() => setBorrow(b, 'returned')}>Nhận trả</button>}
            </td></tr>
        ))}
        {list.length === 0 && <tr><td colSpan={6}>Không có phiếu nào.</td></tr>}
      </tbody>
    </table>
  )

  return (
    <>
      <div className="tabsrow">
        {rooms.map(r => <button key={r.id} className={'roomtab' + (r.id === sel ? ' on' : '')} onClick={() => { setSel(r.id); setView('hub') }}>{r.name}</button>)}
      </div>
      {view !== 'hub' && <button onClick={() => setView('hub')} style={{ marginBottom: 12 }}>← Quay lại {room.name}</button>}

      {view === 'hub' && (<>
        <div className="roomhero">
          <span className="tag">{room.tier === 'advanced' ? 'Nâng cao' : 'Cơ bản'}</span><span className="tag">{ROOM_STATUS[room.status]}</span>
          <h2>{room.name}</h2>
          <small>Mã {room.code} · Sức chứa {room.capacity ?? '—'} HS · {room.floors?.buildings?.name} · {room.floors?.name} · {room.area_m2 ?? '—'} m²</small>
          <div style={{ marginTop: 10 }}><small>Chương trình hỗ trợ: </small><ProgChips programs={room.programs} /></div>
        </div>
        <div className="cards">
          <div className="card"><strong>{ru.length - bad.length}/{ru.length}</strong><span>Thiết bị khả dụng ({bad.length} hỏng/bảo trì)</span></div>
          <div className="card"><strong>{lessonsToday.length}</strong><span>Tiết hôm nay ({weekCount} tiết tuần này)</span></div>
          <div className="card"><strong>{rb.filter(b => b.status === 'lent').length}</strong><span>Đã giao (phiếu đang mượn)</span></div>
          <div className="card"><strong>{todo.length + bad.length}</strong><span>Việc cần xử lý</span></div>
        </div>
        <div className="tiles">
          {([['schedule', 'Lịch phòng', `${weekCount} tiết/tuần`], ['equipment', 'Thiết bị của phòng', `${ru.length - bad.length} khả dụng`],
            ['borrow', 'Mượn – Trả', `${rb.filter(b => b.status === 'pending' || b.status === 'approved').length} cần xử lý`],
            ['loaned', 'Mượn thiết bị', `${rb.filter(b => b.status === 'lent').length} đã giao`], ['repair', 'Hỏng – Bảo trì', `${bad.length} cần xử lý`]] as [View, string, string][]).map(([v, l, s]) => (
            <button className="tile" key={v} onClick={() => setView(v)}><b>{l}</b><small>{s}</small></button>))}
        </div>
        <div className="twocol">
          <div className="panel"><h3>Việc cần xử lý ({todo.length + bad.length})</h3>
            {todo.slice(0, 5).map(t => <div className="roomrow" key={t.k}><div><b>{t.title}</b><br /><small>{t.sub}</small></div><span className="pill maintenance">{t.tag}</span></div>)}
            {bad.slice(0, 3).map(u => <div className="roomrow" key={u.id}><div><b>{u.equipment_types?.name}</b><br /><small>{u.serial}</small></div><span className="pill inactive">{UNIT_STATUS[u.status]}</span></div>)}
            {todo.length + bad.length === 0 && <small>Không có việc cần xử lý.</small>}</div>
          <div className="panel"><h3>Lịch hôm nay ({lessonsToday.length})</h3>
            {lessonsToday.map(l => <div className="roomrow" key={l.k}><div><b>{l.t}</b><br /><small>{l.s}</small></div><small>{pr(l.p)?.name} {pr(l.p) && `· ${hm(pr(l.p)!.starts_at)}–${hm(pr(l.p)!.ends_at)}`}</small></div>)}
            {lessonsToday.length === 0 && <small>Hôm nay phòng chưa có tiết.</small>}
            <p><small>Tuần này: {weekCount} tiết · Sức chứa {room.capacity ?? '—'} HS/tiết</small></p></div>
        </div>
      </>)}

      {view === 'schedule' && (<>
        <div className="bar"><div className="tools"><button onClick={() => setWeek(addDays(week, -7))}>‹</button><button onClick={() => setWeek(mondayOf(new Date()))}>Tuần này</button><button onClick={() => setWeek(addDays(week, 7))}>›</button>
          <b style={{ alignSelf: 'center' }}>{addDays(week, 0).toLocaleDateString('vi-VN')} – {addDays(week, 6).toLocaleDateString('vi-VN')}</b></div></div>
        <div className="wrap"><table className="sched"><thead><tr><th />{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d, i) => <th key={d} style={weekIso[i] === todayIso ? { color: 'var(--primary)' } : undefined}>{d}<br /><small>{weekIso[i].slice(8)}/{weekIso[i].slice(5, 7)}</small></th>)}</tr></thead>
          <tbody>{periods.map(p => (
            <tr key={p.id}><td className="lbl">{p.name}<br /><small>{hm(p.starts_at)}</small></td>
              {weekIso.map((iso, i) => {
                const wdy = i + 2 > 7 ? 0 : i + 2
                const a = roomTt.filter(e => e.weekday === wdy && e.period_id === p.id).map(e => ({ k: e.id, c: e.classes?.name, t: e.subject, p: null as string | null }))
                const b = approvedRegs.filter(r => r.on_date === iso && r.period_id === p.id).map(r => ({ k: r.id, c: r.classes?.name, t: r.topic, p: r.program }))
                return <td key={iso}>{[...a, ...b].map(e => <div key={e.k} className="evt" style={{ background: PROG[e.p ?? 'CT1']?.bg, color: PROG[e.p ?? 'CT1']?.fg }}><b>{e.c}</b><br />{e.t}</div>)}</td>
              })}</tr>))}</tbody></table></div>
        <p className="sub">Màu theo chương trình: {Object.entries(PROG).map(([k, v]) => <span key={k} className="progchip" style={{ background: v.bg, color: v.fg }}>{k} {v.label}</span>)}. Chỉ hiển thị tiết dạy tại phòng; mượn thiết bị về lớp xem ở Mượn – Trả.</p>
      </>)}

      {view === 'equipment' && (
        <table><thead><tr><th>Thiết bị</th><th>Số seri</th><th>Tình trạng</th></tr></thead><tbody>
          {ru.map(u => <tr key={u.id}><td><b>{u.equipment_types?.name}</b></td><td>{u.serial}</td><td><span className={'dot ' + u.status} />{UNIT_STATUS[u.status]}</td></tr>)}
          {ru.length === 0 && <tr><td colSpan={3}>Phòng chưa có thiết bị.</td></tr>}</tbody></table>
      )}

      {view === 'borrow' && (<>
        <div className="bar"><span /><button className="primary" onClick={() => setAdding(true)}>Tạo phiếu mượn</button></div>
        {adding && <BorrowForm orgId={orgId} periods={periods} onSubmit={addBorrow} onCancel={() => setAdding(false)} />}
        <BorrowTable list={rb} />
      </>)}
      {view === 'loaned' && <BorrowTable list={rb.filter(b => b.status === 'lent')} />}

      {view === 'repair' && (
        <table><thead><tr><th>Thiết bị</th><th>Số seri</th><th>Tình trạng</th><th></th></tr></thead><tbody>
          {bad.map(u => <tr key={u.id}><td><b>{u.equipment_types?.name}</b></td><td>{u.serial}</td><td><span className={'dot ' + u.status} />{UNIT_STATUS[u.status]}</td>
            <td>{u.status === 'broken' && <><button onClick={() => reportTicket(u)}>Tạo ticket bảo hành</button> </>}
              {u.status === 'maintenance' ? <button className="primary" onClick={() => toMaintenance(u, 'available')}>Đã sửa xong</button> : <button onClick={() => toMaintenance(u, 'maintenance')}>Chuyển bảo trì</button>}</td></tr>)}
          {bad.length === 0 && <tr><td colSpan={4}>Không có thiết bị hỏng hoặc bảo trì.</td></tr>}</tbody></table>
      )}
    </>
  )
}

function BorrowForm({ orgId, periods, onSubmit, onCancel }: { orgId: string; periods: Period[]; onSubmit: (v: Record<string, string>) => Promise<string | void>; onCancel: () => void }) {
  const [teachers, setTeachers] = useState<{ value: string; label: string }[]>([])
  useEffect(() => { supabase.from('teachers').select('id, full_name').order('full_name').then(({ data }) => setTeachers((data ?? []).map((t: any) => ({ value: t.id, label: t.full_name })))) }, [orgId])
  return <FormPanel submitLabel="Tạo phiếu" fields={[
    { key: 'title', label: 'Mục đích mượn', required: true }, { key: 'items', label: 'Thiết bị mượn (VD: Robot Mbot x6)' },
    { key: 'teacher_id', label: 'Người mượn', type: 'select', options: teachers },
    { key: 'on_date', label: 'Ngày', type: 'date', required: true },
    { key: 'period_id', label: 'Tiết', type: 'select', options: periods.map(p => ({ value: p.id, label: p.name })) },
    { key: 'mode', label: 'Hình thức', type: 'select', required: true, options: [{ value: 'in_room', label: 'Dùng tại phòng' }, { value: 'take_to_class', label: 'Mang về lớp' }] },
  ]} initial={{ on_date: new Date().toISOString().slice(0, 10), mode: 'in_room' }} onSubmit={onSubmit} onCancel={onCancel} />
}
