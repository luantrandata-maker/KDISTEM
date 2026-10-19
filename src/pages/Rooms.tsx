import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { PROG, isoDate, mondayOf, addDays } from '../lib/programs'
import { UNIT_STATUS } from './Equipment'
import { decideText, approvalError } from './approvals/common'
import { useBackClose } from '../lib/history'
import { RoomContents, contentSummary } from '../components/RoomContents'
import { loadRoomContents, moveUnitTo, roomError, sortRooms, ROOM_KIND, ROOM_KINDS, ROOM_STATUS, ROOM_TIER, type RoomKind, type RoomLite, type RoomStock, type RoomUnit } from '../lib/rooms'
import ImportExcel from '../components/ImportExcel'
import { downloadXlsx, importSummary, norm, type Column } from '../lib/sheet'

type Room = { id: string; name: string; code: string | null; capacity: number | null; status: string; area_m2: number | null; tier: string; programs: string | null; floors: { name: string; buildings: { name: string } | null } | null }
type Unit = RoomUnit
type Borrow = { id: string; title: string; items: string | null; on_date: string; mode: string; status: string; room_id: string | null; teachers: { full_name: string } | null; period_configs: { name: string } | null }
type Reg = { id: string; on_date: string; topic: string; program: string | null; status: string; room_id: string; period_id: string; classes: { name: string } | null; teachers: { full_name: string } | null }
type TT = { id: string; weekday: number; period_id: string; subject: string; room_id: string | null; classes: { name: string } | null; teachers: { full_name: string } | null }
type Period = { id: string; name: string; starts_at: string; ends_at: string }
const BSTATUS: Record<string, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', lent: 'Đã giao', returned: 'Đã trả', rejected: 'Từ chối' }
type View = 'hub' | 'schedule' | 'equipment' | 'borrow' | 'loaned' | 'repair'
const hm = (t: string) => t.slice(0, 5)
const fmt = (d: string) => new Date(d).toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' })

// Lịch phòng, thiết bị, mượn – trả, hỏng – bảo trì của từng phòng STEM
function StemRoomHub({ orgId, initial, onBack }: { orgId: string; initial: string; onBack: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [sel, setSel] = useState(initial)
  const [view, setView] = useState<View>('hub')
  useBackClose(view !== 'hub', () => setView('hub'))   // Back của trình duyệt = "← Quay lại phòng"
  const [units, setUnits] = useState<Unit[]>([])
  const [stocks, setStocks] = useState<RoomStock[]>([])
  const [borrows, setBorrows] = useState<Borrow[]>([])
  const [regs, setRegs] = useState<Reg[]>([])
  const [tt, setTt] = useState<TT[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [adding, setAdding] = useState(false)
  const [week, setWeek] = useState(mondayOf(new Date()))

  async function load() {
    const [r, u, b, g, t, p] = await Promise.all([
      supabase.from('stem_rooms').select('*, floors(name, buildings(name))').order('code'),
      supabase.from('equipment_units').select('id, type_id, serial, status, room_id, warranty_until, equipment_types(name, brand, sku)').order('serial'),
      supabase.from('borrow_requests').select('id, title, items, on_date, mode, status, room_id, teachers(full_name), period_configs(name)').order('on_date'),
      supabase.from('stem_registrations').select('id, on_date, topic, program, status, room_id, period_id, classes(name), teachers(full_name)'),
      supabase.from('timetable_entries').select('id, weekday, period_id, subject, room_id, classes(name), teachers(full_name)').eq('kind', 'stem'),
      supabase.from('period_configs').select('*').order('starts_at'),
    ])
    const rs = ((r.data as unknown as (Room & { room_kind?: string })[]) ?? []).filter(x => (x.room_kind ?? 'stem') === 'stem')
    setRooms(rs); setSel(v => v || rs[0]?.id || '')
    setUnits((u.data as unknown as Unit[]) ?? []); setBorrows((b.data as unknown as Borrow[]) ?? [])
    setRegs((g.data as unknown as Reg[]) ?? []); setTt((t.data as unknown as TT[]) ?? []); setPeriods((p.data as Period[]) ?? [])
  }
  useEffect(() => { load(); loadRoomContents().then(c => setStocks(c.stocks)) }, [])

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
      <button onClick={onBack} style={{ marginBottom: 12 }}>← Danh sách phòng</button>
      <div className="tabsrow">
        {rooms.map(r => <button key={r.id} className={'roomtab' + (r.id === sel ? ' on' : '')} onClick={() => { setSel(r.id); setView('hub') }}>{r.name}</button>)}
      </div>
      {view !== 'hub' && <button onClick={() => setView('hub')} style={{ marginBottom: 12 }}>← Quay lại {room.name}</button>}

      {view === 'hub' && (<>
        <div className="roomhero">
          <span className="tag">{ROOM_TIER[room.tier] ?? 'Cơ bản'}</span><span className="tag">{ROOM_STATUS[room.status]}</span>
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
          {([['schedule', 'Lịch phòng', `${weekCount} tiết/tuần`], ['equipment', 'Thiết bị & vật tư', `${ru.length - bad.length} khả dụng · ${stocks.filter(x => x.room_id === room.id).length} loại vật tư`],
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

      {view === 'equipment' && <RoomContents units={ru} stocks={stocks.filter(x => x.room_id === room.id)} />}

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

// ================= Quản lý phòng: Phòng STEM · Phòng học · Kho (migration 056) =================
type RoomRow = { id: string; org_id: string; name: string; code: string | null; room_kind: RoomKind; capacity: number | null; status: string; area_m2: number | null
  tier: string; programs: string | null; note: string | null; floor_id: string | null; floors: { name: string; buildings: { name: string } | null } | null }
type FloorOpt = { id: string; name: string; building: string }
type ClassLite = { id: string; name: string; room_id: string | null }
type RoomForm = { id?: string; room_kind: RoomKind; name: string; code: string; floor_id: string; capacity: string; area_m2: string; status: string; tier: string; programs: string[]; note: string; classes: string[] }
const PROGS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5']
const KIND_HINT: Record<RoomKind, string> = {
  stem: 'Xếp được vào TKB STEM, nhận đăng ký dạy STEM, phiếu mượn tại phòng; có lịch phòng và chống trùng lịch.',
  classroom: 'Phòng học thường của lớp: gắn lớp học tại phòng, để thiết bị và vật tư dùng ở lớp. Không xếp lịch STEM.',
  storage: 'Nơi cất thiết bị và vật tư tiêu hao. Thiết bị chuyển vào kho tự chuyển sang "Tồn kho".',
}
const IMPORT_COLS: Column[] = [
  { key: 'name', label: 'Tên phòng', required: true, aliases: ['Phòng', 'Tên'], width: 24 }, { key: 'code', label: 'Mã phòng', aliases: ['Mã'] },
  { key: 'kind', label: 'Loại phòng', aliases: ['Loại'] }, { key: 'building', label: 'Tòa nhà', aliases: ['Toà nhà', 'Nhà'] }, { key: 'floor', label: 'Tầng' },
  { key: 'capacity', label: 'Sức chứa (HS)', aliases: ['Sức chứa'] }, { key: 'area', label: 'Diện tích (m²)', aliases: ['Diện tích'] },
  { key: 'tier', label: 'Mức phòng STEM', aliases: ['Mức'] }, { key: 'programs', label: 'Chương trình', aliases: ['CT STEM'] },
  { key: 'status', label: 'Trạng thái' }, { key: 'classes', label: 'Lớp học tại phòng', aliases: ['Lớp'] }, { key: 'note', label: 'Ghi chú', width: 26 },
]
const kindOf = (v: string): RoomKind | null => { const k = norm(v); return !k ? 'stem' : /kho/.test(k) ? 'storage' : /hoc|lop/.test(k) ? 'classroom' : /stem/.test(k) ? 'stem' : null }
const pick = <T extends string>(map: Record<T, string>, v: string, dflt: T): T => (Object.entries(map) as [T, string][]).find(([k, l]) => norm(l) === norm(v) || k === v)?.[0] ?? dflt
const blankForm = (kind: RoomKind): RoomForm => ({ room_kind: kind, name: '', code: '', floor_id: '', capacity: '', area_m2: '', status: 'active', tier: 'basic', programs: [], note: '', classes: [] })

export default function Rooms({ orgId }: { orgId: string }) {
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [floors, setFloors] = useState<FloorOpt[]>([])
  const [classes, setClasses] = useState<ClassLite[]>([])
  const [tkb, setTkb] = useState<Record<string, number>>({})
  const [units, setUnits] = useState<RoomUnit[]>([])
  const [stocks, setStocks] = useState<RoomStock[]>([])
  const [kind, setKind] = useState<RoomKind | ''>('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<RoomForm | null>(null)
  const [hub, setHub] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [needMigration, setNeedMigration] = useState(false)
  useBackClose(!!hub, () => setHub(null))

  async function load() {
    const [r, f, c, t, rc] = await Promise.all([
      supabase.from('stem_rooms').select('*, floors(name, buildings(name))'),
      supabase.from('floors').select('id, name, buildings!inner(name, org_id)').eq('buildings.org_id', orgId),
      supabase.from('classes').select('*').eq('org_id', orgId).order('name'),
      supabase.from('timetable_entries').select('room_id').not('room_id', 'is', null),
      loadRoomContents(),
    ])
    if (r.error) setMsg([roomError(r.error.message), true])
    const rs = ((r.data as any[]) ?? []).filter(x => x.org_id === orgId)
    setNeedMigration(rs.length > 0 && rs[0].room_kind === undefined)
    setRooms(sortRooms(rs.map(x => ({ ...x, room_kind: x.room_kind ?? 'stem' })) as RoomRow[]))
    setFloors(((f.data as any[]) ?? []).map(x => ({ id: x.id, name: x.name, building: x.buildings?.name ?? '' }))
      .sort((a, b) => (a.building + a.name).localeCompare(b.building + b.name, 'vi', { numeric: true })))
    setClasses(((c.data as any[]) ?? []).map(x => ({ id: x.id, name: x.name, room_id: x.room_id ?? null })))
    const m: Record<string, number> = {}; ((t.data as any[]) ?? []).forEach(x => { m[x.room_id] = (m[x.room_id] ?? 0) + 1 }); setTkb(m)
    setUnits(rc.units.filter(u => rs.some(x => x.id === u.room_id) || !u.room_id)); setStocks(rc.stocks)
    setLoaded(true)
  }
  useEffect(() => { load() }, [orgId])

  const lite: RoomLite[] = rooms
  const count = (k: RoomKind) => rooms.filter(r => r.room_kind === k).length
  const shown = rooms.filter(r => (!kind || r.room_kind === kind) && (!q || norm([r.name, r.code, r.floors?.buildings?.name, r.note].join(' ')).includes(norm(q))))
  const classesIn = (id: string) => classes.filter(c => c.room_id === id)
  const usOf = (id: string) => units.filter(u => u.room_id === id)
  const ssOf = (id: string) => stocks.filter(s => s.room_id === id)
  const unplaced = { us: units.filter(u => !u.room_id), ss: stocks.filter(s => !s.room_id) }

  function edit(r: RoomRow) {
    setForm({ id: r.id, room_kind: r.room_kind, name: r.name, code: r.code ?? '', floor_id: r.floor_id ?? '', capacity: r.capacity?.toString() ?? '', area_m2: r.area_m2?.toString() ?? '',
      status: r.status, tier: r.tier ?? 'basic', programs: (r.programs ?? '').split(',').map(x => x.trim()).filter(Boolean), note: r.note ?? '', classes: classesIn(r.id).map(c => c.id) })
    setMsg(null)
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const dup = rooms.find(r => r.id !== form.id && form.code.trim() && (r.code ?? '').toLowerCase() === form.code.trim().toLowerCase())
    if (dup) return setMsg([`Mã ${form.code} đã dùng cho ${dup.name}.`, true])
    const old = rooms.find(r => r.id === form.id)
    if (old && old.room_kind !== form.room_kind && !confirm(`Đổi "${old.name}" từ ${ROOM_KIND[old.room_kind]} sang ${ROOM_KIND[form.room_kind]}?`)) return
    const stem = form.room_kind === 'stem'
    const body: Record<string, unknown> = { name: form.name.trim(), code: form.code.trim() || null, room_kind: form.room_kind, floor_id: form.floor_id || null,
      capacity: form.capacity ? Number(form.capacity) : null, area_m2: form.area_m2 ? Math.round(Number(form.area_m2)) : null, status: form.status,
      tier: stem ? form.tier : 'basic', programs: stem && form.programs.length ? form.programs.join(',') : null, note: form.note.trim() || null }
    // Phòng học → loại khác: gỡ lớp khỏi phòng trước (CSDL chặn đổi loại khi còn lớp)
    if (old?.room_kind === 'classroom' && form.room_kind !== 'classroom') await supabase.from('classes').update({ room_id: null }).eq('room_id', old.id)
    const res = form.id ? await supabase.from('stem_rooms').update(body).eq('id', form.id).select('id').single()
      : await supabase.from('stem_rooms').insert({ ...body, org_id: orgId }).select('id').single()
    if (res.error) return setMsg([roomError(res.error.message), true])
    if (form.room_kind === 'classroom') {
      const id = res.data.id; const before = classesIn(id).map(c => c.id)
      const add = form.classes.filter(c => !before.includes(c)); const rm = before.filter(c => !form.classes.includes(c))
      if (rm.length) await supabase.from('classes').update({ room_id: null }).in('id', rm)
      if (add.length) { const { error } = await supabase.from('classes').update({ room_id: id }).in('id', add); if (error) return setMsg([roomError(error.message), true]) }
    }
    setMsg([`Đã lưu ${ROOM_KIND[form.room_kind].toLowerCase()} ${form.name.trim()}.`, false]); setForm(null); load()
  }
  async function remove(r: RoomRow) {
    if (!confirm(`Xoá ${ROOM_KIND[r.room_kind].toLowerCase()} "${r.name}"?`)) return
    const { error } = await supabase.from('stem_rooms').delete().eq('id', r.id)
    if (error) setMsg([roomError(error.message), true]); else { setMsg([`Đã xoá ${r.name}.`, false]); load() }
  }
  async function moveUnit(u: RoomUnit, roomId: string) {
    const err = await moveUnitTo(orgId, u, lite, roomId); if (err) setMsg([roomError(err), true]); load()
  }

  // Nhập Excel: phòng đã có (trùng mã, hoặc trùng tên khi không ghi mã) → cập nhật; tòa nhà / tầng chưa có → tạo mới
  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = []; let created = 0, updated = 0
    const fl = [...floors]; const bld = new Map<string, string>()
    const { data: bs } = await supabase.from('buildings').select('id, name').eq('org_id', orgId)
    ;(bs ?? []).forEach((b: any) => bld.set(norm(b.name), b.id))
    async function floorId(b: string, f: string, line: number) {
      if (!b.trim() && !f.trim()) return null
      const bn = b.trim() || 'Nhà chính', fn = f.trim() || 'Tầng 1'
      const hit = fl.find(x => norm(x.building) === norm(bn) && norm(x.name) === norm(fn)); if (hit) return hit.id
      let bid = bld.get(norm(bn))
      if (!bid) { const { data, error } = await supabase.from('buildings').insert({ org_id: orgId, name: bn }).select('id').single(); if (error) { bad.push(`dòng ${line}: không tạo được tòa nhà (${error.message})`); return null } bid = data.id as string; bld.set(norm(bn), bid) }
      const { data, error } = await supabase.from('floors').insert({ building_id: bid, name: fn }).select('id').single()
      if (error) { bad.push(`dòng ${line}: không tạo được tầng (${error.message})`); return null }
      fl.push({ id: data.id, name: fn, building: bn }); return data.id as string
    }
    const cur = [...rooms]
    for (const r of recs) {
      const name = r.name.trim(); if (!name) { bad.push(`dòng ${r._line}: thiếu tên phòng`); continue }
      const k = kindOf(r.kind); if (!k) { bad.push(`dòng ${r._line}: loại phòng "${r.kind}" không rõ (STEM / Phòng học / Kho)`); continue }
      const progs = [...new Set((r.programs ?? '').toUpperCase().split(/[,;\s]+/).filter(x => /^CT[1-5]$/.test(x)))]
      const body: Record<string, unknown> = { name, code: r.code.trim() || null, room_kind: k, capacity: Number(r.capacity) || null, area_m2: Math.round(Number(r.area.replace(',', '.'))) || null,
        status: pick(ROOM_STATUS as Record<string, string>, r.status, 'active'), tier: k === 'stem' ? pick(ROOM_TIER as Record<string, string>, r.tier, 'basic') : 'basic',
        programs: k === 'stem' && progs.length ? progs.join(',') : null, note: r.note.trim() || null }
      if (r.building.trim() || r.floor.trim()) body.floor_id = await floorId(r.building, r.floor, r._line)
      const old = cur.find(x => body.code ? (x.code ?? '').toLowerCase() === String(body.code).toLowerCase() : norm(x.name) === norm(name))
      const res = old ? await supabase.from('stem_rooms').update(body).eq('id', old.id).select('id').single() : await supabase.from('stem_rooms').insert({ ...body, org_id: orgId }).select('id').single()
      if (res.error) { bad.push(`dòng ${r._line}: ${roomError(res.error.message)}`); continue }
      if (old) updated++; else { created++; cur.push({ ...(body as any), id: res.data.id }) }
      if (k === 'classroom' && r.classes.trim()) {
        const ids = r.classes.split(/[,;]+/).map(x => classes.find(c => norm(c.name) === norm(x))?.id).filter(Boolean) as string[]
        if (ids.length) await supabase.from('classes').update({ room_id: res.data.id }).in('id', ids)
        if (ids.length < r.classes.split(/[,;]+/).filter(x => x.trim()).length) bad.push(`dòng ${r._line}: có lớp không tìm thấy (${r.classes})`)
      }
    }
    load()
    return importSummary(created, 'phòng mới', bad) + (updated ? ` Cập nhật ${updated} phòng đã có.` : '')
  }
  function exportXlsx() {
    downloadXlsx('danh-sach-phong', [...IMPORT_COLS, { key: 'u', label: 'Số thiết bị' }, { key: 's', label: 'Số loại vật tư' }],
      shown.map(r => [r.name, r.code, ROOM_KIND[r.room_kind], r.floors?.buildings?.name, r.floors?.name, r.capacity, r.area_m2, r.room_kind === 'stem' ? ROOM_TIER[r.tier] ?? '' : '',
        r.programs, ROOM_STATUS[r.status], classesIn(r.id).map(c => c.name).join(', '), r.note, usOf(r.id).length, ssOf(r.id).length]), 'Phòng')
  }

  if (hub) return <StemRoomHub orgId={orgId} initial={hub} onBack={() => { setHub(null); load() }} />
  if (!loaded) return <p className="sub">Đang tải…</p>
  const free = classes.filter(c => !c.room_id || (form?.id && c.room_id === form.id))
  return (
    <>
      <div className="cards">
        {ROOM_KINDS.map(k => <div className="card" key={k}><strong>{count(k)}</strong><span>{ROOM_KIND[k]}{k === 'classroom' ? ` · ${classes.filter(c => c.room_id).length}/${classes.length} lớp đã có phòng` : k === 'stem' ? ` · ${rooms.filter(r => r.room_kind === 'stem' && r.status === 'active').length} đang hoạt động` : ''}</span></div>)}
        <div className="card"><strong>{units.length}</strong><span>Thiết bị · {units.filter(u => !u.room_id).length} chưa xếp phòng</span></div>
      </div>
      {needMigration && <p className="msg">CSDL chưa có migration 056: mọi phòng đang được coi là phòng STEM, chưa thêm được phòng học / kho.</p>}
      <div className="bar" style={{ marginTop: 16 }}>
        <div className="segmented" style={{ margin: 0 }}>
          <button className={kind === '' ? 'on' : ''} onClick={() => setKind('')}>Tất cả<span className="count">{rooms.length}</span></button>
          {ROOM_KINDS.map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{ROOM_KIND[k]}<span className="count">{count(k)}</span></button>)}
        </div>
        <div className="tools">
          <input className="search" style={{ margin: 0 }} placeholder="Tìm tên, mã, tòa nhà…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm phòng" />
          <ImportExcel columns={IMPORT_COLS} template="mau-nhap-phong" sample={[['Phòng STEM 1', 'P-STEM-01', 'Phòng STEM', 'Nhà A', 'Tầng 2', '40', '72', 'Nâng cao', 'CT1, CT3', 'Hoạt động', '', ''],
            ['Phòng học 6A1', 'P-101', 'Phòng học', 'Nhà A', 'Tầng 1', '45', '54', '', '', 'Hoạt động', '6A1', ''], ['Kho thiết bị', 'KHO-01', 'Kho', 'Nhà B', 'Tầng 1', '', '30', '', '', 'Hoạt động', '', 'Kho chung']]}
            onRecords={importRows} onMessage={(m, e) => setMsg([m, !!e])} />
          <button onClick={exportXlsx} disabled={!rooms.length}>Xuất Excel</button>
          <button className="primary" disabled={needMigration} onClick={() => { setForm(blankForm(kind || 'stem')); setMsg(null) }}>+ Thêm phòng</button>
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}

      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>{form.id ? `Sửa ${form.name}` : 'Thêm phòng'}</h3>
          <div className="field" style={{ gridColumn: '1 / -1' }}><span>Loại phòng *</span>
            <div className="segmented" style={{ margin: 0 }}>{ROOM_KINDS.map(k => <button type="button" key={k} className={form.room_kind === k ? 'on' : ''} onClick={() => setForm({ ...form, room_kind: k })}>{ROOM_KIND[k]}</button>)}</div>
            <small className="sub">{KIND_HINT[form.room_kind]}</small></div>
          <label className="field"><span>Tên phòng *</span><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder={form.room_kind === 'stem' ? 'VD: Phòng STEM 1' : form.room_kind === 'classroom' ? 'VD: Phòng 101' : 'VD: Kho thiết bị tầng 1'} /></label>
          <label className="field"><span>Mã phòng</span><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VD: P-101" /></label>
          <label className="field"><span>Tòa nhà · Tầng</span><select value={form.floor_id} onChange={e => setForm({ ...form, floor_id: e.target.value })}>
            <option value="">—</option>{floors.map(f => <option key={f.id} value={f.id}>{f.building} · {f.name}</option>)}</select>
            {!floors.length && <small className="sub">Chưa có tòa nhà/tầng — khai báo ở Quản trị → Tòa nhà & Tầng.</small>}</label>
          {form.room_kind !== 'storage' && <label className="field"><span>Sức chứa (học sinh)</span><input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} /></label>}
          <label className="field"><span>Diện tích (m²)</span><input type="number" min={0} value={form.area_m2} onChange={e => setForm({ ...form, area_m2: e.target.value })} /></label>
          <label className="field"><span>Trạng thái</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {Object.entries(ROOM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {form.room_kind === 'stem' && <>
            <label className="field"><span>Mức phòng STEM</span><select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>
              {Object.entries(ROOM_TIER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <div className="field"><span>Chương trình hỗ trợ</span><div>{PROGS.map(p => <button type="button" key={p} className={'chipbtn' + (form.programs.includes(p) ? ' on' : '')} style={{ marginRight: 6 }}
              onClick={() => setForm({ ...form, programs: form.programs.includes(p) ? form.programs.filter(x => x !== p) : [...form.programs, p].sort() })}>{p}</button>)}</div></div>
          </>}
          {form.room_kind === 'classroom' && <div className="field" style={{ gridColumn: '1 / -1' }}><span>Lớp học tại phòng</span>
            <div>{free.map(c => <button type="button" key={c.id} className={'chipbtn' + (form.classes.includes(c.id) ? ' on' : '')} style={{ margin: '0 6px 6px 0' }}
              onClick={() => setForm({ ...form, classes: form.classes.includes(c.id) ? form.classes.filter(x => x !== c.id) : [...form.classes, c.id] })}>{c.name}</button>)}
              {!free.length && <small className="sub">Mọi lớp đã có phòng học.</small>}</div></div>}
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}

      {rooms.length === 0 ? (
        <div className="panel"><h3>Trường chưa có phòng nào</h3>
          <p className="sub">Thêm phòng STEM, phòng học và kho để xếp lịch dạy STEM, gắn phòng học cho lớp và theo dõi thiết bị, vật tư theo từng phòng. Có thể nhập nhiều phòng một lần bằng Excel (dùng "Tải file mẫu").</p>
          <button className="primary" disabled={needMigration} onClick={() => setForm(blankForm('stem'))}>+ Thêm phòng đầu tiên</button></div>
      ) : (
        <div className="wrap"><table className="roomtable">
          <thead><tr><th>Phòng</th><th>Loại</th><th>Vị trí</th><th>Sức chứa · DT</th><th>Sử dụng</th><th>Thiết bị & vật tư</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {shown.map(r => (
              <Fragment key={r.id}>
                <tr className={'roomtable-row' + (open[r.id] ? ' on' : '')} onClick={() => setOpen({ ...open, [r.id]: !open[r.id] })}>
                  <td><span className="caret">{open[r.id] ? '▾' : '▸'}</span> <b>{r.name}</b>{r.code && <><br /><small>{r.code}</small></>}</td>
                  <td><span className={'rkind ' + r.room_kind}>{ROOM_KIND[r.room_kind]}</span>{r.room_kind === 'stem' && <><br /><small>{ROOM_TIER[r.tier] ?? ''}</small></>}</td>
                  <td>{r.floors ? <>{r.floors.buildings?.name}<br /><small>{r.floors.name}</small></> : <small>—</small>}</td>
                  <td>{r.capacity ? `${r.capacity} HS` : '—'}<br /><small>{r.area_m2 ? `${r.area_m2} m²` : ''}</small></td>
                  <td>{r.room_kind === 'stem' ? <>{tkb[r.id] ?? 0} tiết TKB/tuần{r.programs && <div><ProgChips programs={r.programs} /></div>}</>
                    : r.room_kind === 'classroom' ? (classesIn(r.id).map(c => c.name).join(', ') || <small>Chưa gắn lớp</small>) : <small>Kho</small>}</td>
                  <td><small>{contentSummary(usOf(r.id), ssOf(r.id))}</small></td>
                  <td><span className={'pill ' + r.status}>{ROOM_STATUS[r.status]}</span></td>
                  <td className="rowactions" onClick={e => e.stopPropagation()}>
                    {r.room_kind === 'stem' && <button onClick={() => setHub(r.id)} title="Lịch phòng, mượn – trả, hỏng – bảo trì">Lịch & mượn trả</button>}
                    <button onClick={() => edit(r)}>Sửa</button> <button onClick={() => remove(r)}>Xoá</button></td>
                </tr>
                {open[r.id] && <tr className="roomtable-exp"><td colSpan={8}><RoomContents units={usOf(r.id)} stocks={ssOf(r.id)} rooms={lite} onMoveUnit={moveUnit} /></td></tr>}
              </Fragment>))}
            {(unplaced.us.length > 0 || unplaced.ss.length > 0) && !kind && <>
              <tr className={'roomtable-row' + (open.none ? ' on' : '')} onClick={() => setOpen({ ...open, none: !open.none })}>
                <td><span className="caret">{open.none ? '▾' : '▸'}</span> <b>Chưa xếp phòng</b></td><td><span className="rkind none">—</span></td><td colSpan={3}><small>Thiết bị, vật tư chưa gắn phòng / kho nào</small></td>
                <td><small>{contentSummary(unplaced.us, unplaced.ss)}</small></td><td /><td /></tr>
              {open.none && <tr className="roomtable-exp"><td colSpan={8}><RoomContents units={unplaced.us} stocks={unplaced.ss} rooms={lite} onMoveUnit={moveUnit} /></td></tr>}
            </>}
            {shown.length === 0 && <tr><td colSpan={8}>Không có phòng phù hợp.</td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  )
}
