import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { today, addDays, weekStart, dayLabel, shortDay } from '../../lib/attendance'
import { downloadXlsx } from '../../lib/sheet'
import { Tiles, HBars } from '../department/charts'

// Phòng STEM & lịch phòng, Thiết bị, vật tư & kho — cổng Quản trị nền tảng (migration 029).
// Số liệu theo phạm vi người xem: nền tảng thấy mọi trường; Sở/Phòng thấy trường trực thuộc.

const nf = (n: number) => n.toLocaleString('vi-VN')
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
const short = (n: string) => n.replace(/^Trường\s+/, '')
const ROOM_ST: Record<string, [string, string]> = { active: ['Hoạt động', 'active'], maintenance: ['Bảo trì', 'maintenance'], inactive: ['Ngừng dùng', 'inactive'] }
const SRC: Record<string, string> = { teaching_session: 'Tiết theo TKB / dạy bù', stem_registration: 'Đăng ký dạy STEM', borrow_request: 'Phiếu mượn tại phòng' }

// tstzrange từ PostgREST: ["2026-10-12 00:30:00+00","2026-10-12 01:15:00+00") → giờ địa phương
function rangeStart(r: string): Date { const m = r.match(/^[[(]"?([^",]+)"?,/); return new Date(m ? m[1].replace(' ', 'T') : NaN) }
function rangeEnd(r: string): Date { const m = r.match(/,"?([^",)\]]+)"?[)\]]$/); return new Date(m ? m[1].replace(' ', 'T') : NaN) }
const hm = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const vnRange = (from: string, to: string) => `[${from} 00:00:00+07,${addDays(to, 1)} 00:00:00+07)`

// ================= Phòng STEM & lịch phòng =================
type RoomRow = {
  room_id: string; org_id: string; school: string; parent_name: string | null; room: string; code: string | null; status: string
  capacity: number | null; tier: string | null; slots: number; booked: number; from_sessions: number; from_registrations: number
  from_borrows: number; conflicts: number; tkb_periods: number
}
type Booking = { id: string; during: string; source: string; label: string | null }
type Conflict = { id: string; org_id: string; room_id: string; during: string; source: string; label: string | null; blocking_label: string | null; stem_rooms: { name: string } | null }

const PERIODS: [string, string][] = [['week', 'Tuần này'], ['next', 'Tuần sau'], ['30', '30 ngày qua']]
function periodRange(k: string): [string, string] {
  const mon = weekStart(today())
  if (k === 'week') return [mon, addDays(mon, 5)]
  if (k === 'next') return [addDays(mon, 7), addDays(mon, 12)]
  return [addDays(today(), -29), today()]
}

export function RoomsOverview() {
  const [period, setPeriod] = useState('week')
  const [rows, setRows] = useState<RoomRow[] | null>(null)
  const [conf, setConf] = useState<Conflict[]>([])
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'conflict' | 'idle' | 'busy'>('all')
  const [sel, setSel] = useState<RoomRow | null>(null)
  const [from, to] = periodRange(period)

  useEffect(() => {
    setRows(null); setSel(null)
    Promise.all([
      supabase.rpc('room_overview', { p_from: from, p_to: to }),
      supabase.from('booking_conflicts').select('id, org_id, room_id, during, source, label, blocking_label, stem_rooms(name)')
        .overlaps('during', vnRange(from, to)).order('during').limit(500),
    ]).then(([a, b]) => {
      const e = a.error ?? b.error
      if (e) setErr(/schema cache|does not exist|function/i.test(e.message) ? 'Hãy chạy migration 029_schedule_guard.sql trên Supabase.' : e.message)
      else setErr('')
      setRows((a.data as RoomRow[]) ?? []); setConf((b.data as unknown as Conflict[]) ?? [])
    })
  }, [period])

  if (!rows) return <p className="sub">{err || 'Đang tổng hợp lịch phòng STEM…'}</p>
  if (err) return <p className="msg">{err}</p>
  const active = rows.filter(r => r.status === 'active')
  const slots = active.reduce((a, r) => a + r.slots, 0), booked = active.reduce((a, r) => a + r.booked, 0)
  const use = pct(booked, slots)
  const idle = active.filter(r => r.booked === 0)
  const util = (r: RoomRow) => pct(r.booked, r.slots)
  const school = (id: string) => short(rows.find(r => r.org_id === id)?.school ?? '')
  const list = rows.filter(r => (short(r.school) + ' ' + r.room + ' ' + (r.code ?? '')).toLowerCase().includes(q.toLowerCase())
    && (only === 'all' || (only === 'conflict' ? r.conflicts > 0 : only === 'idle' ? r.status === 'active' && r.booked === 0 : (util(r) ?? 0) >= 80)))
  const busiest = [...active].filter(r => r.slots > 0).sort((a, b) => (util(b) ?? 0) - (util(a) ?? 0)).slice(0, 8)

  function exportXlsx() {
    downloadXlsx(`phong-stem-${from}-${to}.xlsx`, [
      { key: 'school', label: 'Trường', width: 34 }, { key: 'parent', label: 'Đơn vị quản lý', width: 24 }, { key: 'room', label: 'Phòng', width: 22 },
      { key: 'code', label: 'Mã phòng' }, { key: 'status', label: 'Trạng thái' }, { key: 'slots', label: 'Số tiết có thể dùng' },
      { key: 'booked', label: 'Số tiết đã giữ' }, { key: 'use', label: 'Công suất (%)' }, { key: 's', label: 'Từ tiết dạy' },
      { key: 'r', label: 'Từ đăng ký STEM' }, { key: 'b', label: 'Từ phiếu mượn' }, { key: 'tkb', label: 'Tiết TKB/tuần' }, { key: 'c', label: 'Chỗ trùng chờ xử lý' },
    ], list.map(r => [r.school, r.parent_name, r.room, r.code, ROOM_ST[r.status]?.[0] ?? r.status, r.slots, r.booked, util(r),
      r.from_sessions, r.from_registrations, r.from_borrows, r.tkb_periods, r.conflicts]))
  }

  return (
    <>
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}>{PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        <button onClick={exportXlsx} disabled={!list.length}>Xuất Excel</button>
      </div>
      <Tiles items={[
        { label: 'Phòng STEM đang hoạt động', value: `${active.length}/${rows.length}`, sub: rows.length > active.length ? `${rows.length - active.length} phòng bảo trì / ngừng dùng` : 'Không có phòng bảo trì' },
        { label: 'Công suất sử dụng', value: use === null ? '—' : use + '%', sub: `${nf(booked)} / ${nf(slots)} tiết` },
        { label: 'Phòng chưa có lịch', value: idle.length, sub: 'đang hoạt động nhưng không có tiết nào', tone: idle.length ? 'warn' : '' },
        { label: 'Chỗ trùng chờ xử lý', value: conf.length, sub: 'dữ liệu cũ; lịch mới bị chặn ngay khi gửi', tone: conf.length ? 'bad' : 'good' },
      ]} />
      {busiest.length > 1 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Phòng dùng nhiều nhất</h3>
          <HBars data={busiest.map(r => ({ label: `${r.room} · ${short(r.school)}`, value: util(r) ?? 0, sub: `${r.booked}/${r.slots} tiết` }))} />
        </div>
      )}
      {conf.length > 0 && (
        <div className="panel warnbox" style={{ marginTop: 16 }}>
          <h3>Trùng lịch phòng cần xử lý ({conf.length})</h3>
          <div className="wrap"><table>
            <thead><tr><th>Trường</th><th>Phòng</th><th>Thời gian</th><th>Lịch bị trùng</th><th>Đang giữ phòng</th></tr></thead>
            <tbody>{conf.slice(0, 50).map(c => { const s = rangeStart(c.during), e = rangeEnd(c.during); return (
              <tr key={c.id}><td>{school(c.org_id)}</td><td><b>{c.stem_rooms?.name}</b></td>
                <td>{dayLabel(dayOf(s))}<br /><small>{hm(s)}–{hm(e)}</small></td>
                <td>{c.label}<br /><small>{SRC[c.source]}</small></td><td>{c.blocking_label ?? '—'}</td></tr>
            ) })}</tbody>
          </table></div>
          <small>Phát sinh từ dữ liệu có trước khi bật chống trùng (thường là TKB cũ). Trường đổi phòng ở Thời khoá biểu hoặc huỷ tiết; khi lịch đang giữ phòng được huỷ, lịch chờ tự được xếp vào.{conf.length > 50 ? ` Đang hiện 50/${conf.length} — xuất Excel để xem đủ theo phòng.` : ''}</small>
        </div>
      )}
      <div className="bar" style={{ margin: '16px 0 8px' }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm trường, phòng, mã phòng…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="segmented" style={{ margin: 0 }}>
          {([['all', 'Tất cả'], ['busy', 'Gần kín (≥ 80%)'], ['idle', 'Chưa có lịch'], ['conflict', 'Có trùng']] as const).map(([k, l]) =>
            <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}
        </div>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Phòng</th><th>Trường</th><th>Trạng thái</th><th>Công suất</th><th>Nguồn lịch</th><th>TKB/tuần</th><th>Trùng</th><th></th></tr></thead>
        <tbody>
          {list.map(r => { const u = util(r); return (
            <tr key={r.room_id}>
              <td><b>{r.room}</b>{r.code && <><br /><small>{r.code}{r.capacity ? ` · ${r.capacity} chỗ` : ''}</small></>}</td>
              <td>{short(r.school)}<br /><small>{r.parent_name}</small></td>
              <td><span className={'pill ' + (ROOM_ST[r.status]?.[1] ?? '')}>{ROOM_ST[r.status]?.[0] ?? r.status}</span></td>
              <td>{u === null ? <small>Chưa cấu hình tiết</small> : <>{r.booked}/{r.slots} · {u}%<div className="track"><div className="fill g" style={{ width: Math.min(100, u) + '%' }} /></div></>}</td>
              <td><small>{[r.from_sessions && `${r.from_sessions} tiết dạy`, r.from_registrations && `${r.from_registrations} đăng ký`, r.from_borrows && `${r.from_borrows} phiếu mượn`].filter(Boolean).join(' · ') || '—'}</small></td>
              <td>{r.tkb_periods}</td>
              <td>{r.conflicts ? <span className="pill inactive">{r.conflicts}</span> : <small>0</small>}</td>
              <td><button onClick={() => setSel(sel?.room_id === r.room_id ? null : r)}>{sel?.room_id === r.room_id ? 'Đóng' : 'Lịch phòng'}</button></td>
            </tr>
          ) })}
          {list.length === 0 && <tr><td colSpan={8}>Không có phòng phù hợp.</td></tr>}
        </tbody>
      </table></div>
      {sel && <RoomCalendar room={sel} from={from} to={to} />}
      <p className="sub" style={{ marginTop: 8 }}>
        Công suất = số tiết đã giữ / (số ngày học Thứ 2–7 × số tiết trong ngày của trường). Tiết theo TKB chỉ được tính sau khi trường đã sinh buổi dạy cho tuần đó
        (mở mục Buổi dạy & điểm danh), nên tuần sau có thể thấp hơn thực tế.
      </p>
    </>
  )
}

function RoomCalendar({ room, from, to }: { room: RoomRow; from: string; to: string }) {
  const [items, setItems] = useState<Booking[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setItems(null)
    supabase.from('resource_bookings').select('id, during, source, label').eq('room_id', room.room_id)
      .overlaps('during', vnRange(from, to)).order('during').limit(1000)
      .then(({ data, error }) => { if (error) setErr(error.message); setItems((data as Booking[]) ?? []) })
  }, [room.room_id, from, to])
  if (!items) return <p className="sub">{err || 'Đang tải lịch phòng…'}</p>
  const days = new Map<string, Booking[]>()
  items.forEach(b => { const d = dayOf(rangeStart(b.during)); days.set(d, [...(days.get(d) ?? []), b]) })
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Lịch {room.room} · {short(room.school)} <small>({shortDay(from)}–{shortDay(to)})</small></h3>
      {items.length === 0 && <p className="sub" style={{ margin: 0 }}>Phòng chưa có lịch trong khoảng này.</p>}
      {[...days.entries()].map(([d, list]) => (
        <div key={d} style={{ marginBottom: 10 }}>
          <b>{dayLabel(d)}</b>
          <div className="wrap"><table><tbody>
            {list.map(b => { const s = rangeStart(b.during), e = rangeEnd(b.during); return (
              <tr key={b.id}><td style={{ width: 120 }}>{hm(s)}–{hm(e)}</td><td>{b.label}</td><td><small>{SRC[b.source]}</small></td></tr>
            ) })}
          </tbody></table></div>
        </div>
      ))}
    </div>
  )
}

// ================= Thiết bị, vật tư & kho =================
type EqRow = {
  org_id: string; school: string; parent_name: string | null; types: number; units: number; available: number; in_use: number
  in_stock: number; broken: number; maintenance: number; warranty_expiring: number; warranty_expired: number
  open_tickets: number; borrow_pending: number; borrow_lent: number
}
type TypeRow = { name: string; category: string | null; brand: string | null; schools: number; units: number; usable: number; broken: number; maintenance: number }

export function EquipmentOverview() {
  const [rows, setRows] = useState<EqRow[] | null>(null)
  const [types, setTypes] = useState<TypeRow[]>([])
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'school' | 'type'>('school')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'bad' | 'warranty' | 'none'>('all')

  useEffect(() => {
    Promise.all([supabase.rpc('equipment_overview'), supabase.rpc('equipment_type_summary')]).then(([a, b]) => {
      const e = a.error ?? b.error
      if (e) setErr(/schema cache|does not exist|function/i.test(e.message) ? 'Hãy chạy migration 029_schedule_guard.sql trên Supabase.' : e.message)
      setRows((a.data as EqRow[]) ?? []); setTypes((b.data as TypeRow[]) ?? [])
    })
  }, [])

  if (!rows) return <p className="sub">Đang tổng hợp thiết bị…</p>
  if (err) return <p className="msg">{err}</p>
  const sum = (k: keyof EqRow) => rows.reduce((a, r) => a + (r[k] as number), 0)
  const units = sum('units'), bad = sum('broken') + sum('maintenance')
  const usable = units - bad
  const none = rows.filter(r => r.units === 0)
  const badPct = (r: EqRow) => pct(r.broken + r.maintenance, r.units)
  const sl = rows.filter(r => short(r.school).toLowerCase().includes(q.toLowerCase())
    && (only === 'all' || (only === 'bad' ? r.broken + r.maintenance > 0 : only === 'warranty' ? r.warranty_expiring > 0 : r.units === 0)))
    .sort((a, b) => only === 'bad' ? (badPct(b) ?? 0) - (badPct(a) ?? 0) : a.school.localeCompare(b.school, 'vi'))
  const tl = types.filter(t => (t.name + ' ' + (t.category ?? '') + ' ' + (t.brand ?? '')).toLowerCase().includes(q.toLowerCase()))
  const worst = rows.filter(r => r.units >= 5).sort((a, b) => (badPct(b) ?? 0) - (badPct(a) ?? 0)).filter(r => (badPct(r) ?? 0) > 0).slice(0, 8)

  function exportXlsx() {
    if (tab === 'school') downloadXlsx('thiet-bi-theo-truong.xlsx', [
      { key: 'school', label: 'Trường', width: 34 }, { key: 'parent', label: 'Đơn vị quản lý', width: 24 }, { key: 'types', label: 'Loại thiết bị' },
      { key: 'units', label: 'Tổng thiết bị' }, { key: 'available', label: 'Sẵn sàng' }, { key: 'in_use', label: 'Đang dùng' }, { key: 'in_stock', label: 'Trong kho' },
      { key: 'broken', label: 'Hỏng' }, { key: 'maintenance', label: 'Bảo trì' }, { key: 'we', label: 'Hết bảo hành ≤ 60 ngày' },
      { key: 'wx', label: 'Đã hết bảo hành' }, { key: 'tk', label: 'Phiếu bảo hành mở' }, { key: 'bp', label: 'Phiếu mượn chờ duyệt' }, { key: 'bl', label: 'Đang cho mượn' },
    ], sl.map(r => [r.school, r.parent_name, r.types, r.units, r.available, r.in_use, r.in_stock, r.broken, r.maintenance, r.warranty_expiring, r.warranty_expired, r.open_tickets, r.borrow_pending, r.borrow_lent]))
    else downloadXlsx('thiet-bi-theo-loai.xlsx', [
      { key: 'name', label: 'Thiết bị', width: 34 }, { key: 'cat', label: 'Nhóm', width: 18 }, { key: 'brand', label: 'Hãng', width: 16 },
      { key: 'schools', label: 'Số trường có' }, { key: 'units', label: 'Tổng' }, { key: 'usable', label: 'Dùng được' }, { key: 'broken', label: 'Hỏng' }, { key: 'm', label: 'Bảo trì' },
    ], tl.map(t => [t.name, t.category, t.brand, t.schools, t.units, t.usable, t.broken, t.maintenance]))
  }

  return (
    <>
      <Tiles items={[
        { label: 'Tổng thiết bị', value: nf(units), sub: `${nf(types.length)} loại · ${rows.length - none.length}/${rows.length} trường có thiết bị` },
        { label: 'Dùng được', value: pct(usable, units) === null ? '—' : pct(usable, units) + '%', sub: `${nf(sum('available'))} sẵn sàng · ${nf(sum('in_use'))} đang dùng · ${nf(sum('in_stock'))} trong kho` },
        { label: 'Hỏng / bảo trì', value: nf(bad), sub: `${nf(sum('open_tickets'))} phiếu bảo hành đang mở`, tone: bad ? 'warn' : '' },
        { label: 'Bảo hành sắp hết', value: nf(sum('warranty_expiring')), sub: `trong 60 ngày · ${nf(sum('warranty_expired'))} đã hết`, tone: sum('warranty_expiring') ? 'warn' : '' },
        { label: 'Phiếu mượn', value: `${nf(sum('borrow_pending'))} / ${nf(sum('borrow_lent'))}`, sub: 'chờ duyệt / đang cho mượn' },
      ]} />
      {worst.length > 1 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Trường có tỉ lệ thiết bị hỏng / bảo trì cao nhất</h3>
          <HBars data={worst.map(r => ({ label: short(r.school), value: badPct(r) ?? 0, sub: `${r.broken + r.maintenance}/${r.units} thiết bị` }))} />
        </div>
      )}
      <div className="bar" style={{ margin: '16px 0 8px' }}>
        <div className="segmented" style={{ margin: 0 }}>
          <button className={tab === 'school' ? 'on' : ''} onClick={() => setTab('school')}>Theo trường</button>
          <button className={tab === 'type' ? 'on' : ''} onClick={() => setTab('type')}>Theo loại thiết bị</button>
        </div>
        <button onClick={exportXlsx}>Xuất Excel</button>
      </div>
      <div className="bar" style={{ margin: '0 0 8px' }}>
        <input className="search" style={{ margin: 0 }} placeholder={tab === 'school' ? 'Tìm trường…' : 'Tìm thiết bị, nhóm, hãng…'} value={q} onChange={e => setQ(e.target.value)} />
        {tab === 'school' && <div className="segmented" style={{ margin: 0 }}>
          {([['all', 'Tất cả'], ['bad', 'Có hỏng/bảo trì'], ['warranty', 'Sắp hết bảo hành'], ['none', 'Chưa có thiết bị']] as const).map(([k, l]) =>
            <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}
        </div>}
      </div>
      {tab === 'school' ? (
        <div className="wrap"><table>
          <thead><tr><th>Trường</th><th>Thiết bị</th><th>Sẵn sàng · Đang dùng · Kho</th><th>Hỏng · Bảo trì</th><th>Bảo hành</th><th>Mượn</th></tr></thead>
          <tbody>
            {sl.map(r => { const b = badPct(r); return (
              <tr key={r.org_id}>
                <td><b>{short(r.school)}</b><br /><small>{r.parent_name}</small></td>
                <td>{nf(r.units)}<br /><small>{r.types} loại</small></td>
                <td>{r.available} · {r.in_use} · {r.in_stock}</td>
                <td>{r.broken + r.maintenance ? <span className="pill inactive">{r.broken} · {r.maintenance}</span> : <small>0</small>}{b ? <><br /><small>{b}%</small></> : null}</td>
                <td>{r.warranty_expiring ? <span className="pill maintenance">{r.warranty_expiring} sắp hết</span> : <small>—</small>}{r.open_tickets > 0 && <><br /><small>{r.open_tickets} phiếu mở</small></>}</td>
                <td>{r.borrow_pending} chờ · {r.borrow_lent} đang mượn</td>
              </tr>
            ) })}
            {sl.length === 0 && <tr><td colSpan={6}>Không có trường phù hợp.</td></tr>}
          </tbody>
        </table></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr><th>Thiết bị</th><th>Nhóm</th><th>Số trường</th><th>Tổng</th><th>Dùng được</th><th>Hỏng · Bảo trì</th></tr></thead>
          <tbody>
            {tl.slice(0, 300).map(t => (
              <tr key={t.name + '|' + t.category}>
                <td><b>{t.name}</b>{t.brand && <><br /><small>{t.brand}</small></>}</td>
                <td>{t.category ?? '—'}</td><td>{t.schools}</td><td>{nf(t.units)}</td>
                <td>{nf(t.usable)}{t.units > 0 && <div className="track"><div className="fill g" style={{ width: (t.usable / t.units) * 100 + '%' }} /></div>}</td>
                <td>{t.broken + t.maintenance ? <span className="pill inactive">{t.broken} · {t.maintenance}</span> : <small>0</small>}</td>
              </tr>
            ))}
            {tl.length === 0 && <tr><td colSpan={6}>Không có thiết bị phù hợp.</td></tr>}
          </tbody>
        </table></div>
      )}
      <p className="sub" style={{ marginTop: 8 }}>
        Phiếu mượn chỉ duyệt/giao được khi còn đủ thiết bị dùng được trong khung giờ đó (CSDL chặn). Vật tư tiêu hao, kho tổng của KDI,
        kiểm kê và điều chuyển giữa đơn vị chưa có — làm ở đợt tiếp theo.
      </p>
    </>
  )
}
