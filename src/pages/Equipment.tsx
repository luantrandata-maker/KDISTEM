import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import { useBackClose } from '../lib/history'
import { printUnitLabels } from './inventory'
import { RoomContentsList } from '../components/RoomContents'
import { loadRooms, loadRoomContents, moveUnitTo, roomLabel, unitStatusAt, type RoomLite, type RoomStock } from '../lib/rooms'

type Unit = { id: string; type_id: string; serial: string | null; status: string; room_id: string | null; source: string; warranty_until: string | null; equipment_types: { name: string; brand: string | null; sku: string | null } | null; stem_rooms: { name: string } | null }
type Type = { id: string; sku: string | null; name: string; brand: string | null }
type Ev = { id: string; kind: string; title: string; note: string | null; created_at: string }
export const UNIT_STATUS: Record<string, string> = { available: 'Sẵn sàng', in_use: 'Đang dùng', broken: 'Hỏng', maintenance: 'Bảo trì', in_stock: 'Tồn kho', lost: 'Thất lạc', in_transit: 'Đang vận chuyển' }
const ORDER = ['available', 'in_use', 'maintenance', 'broken', 'in_stock', 'in_transit', 'lost']
const soon = (d: string | null) => !!d && new Date(d).getTime() - Date.now() < 60 * 86400000 && new Date(d).getTime() > Date.now()

export default function Equipment({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Unit[]>([])
  const [types, setTypes] = useState<Type[]>([])
  const [rooms, setRooms] = useState<RoomLite[]>([])
  const [stocks, setStocks] = useState<RoomStock[]>([])
  const [view, setView] = useState<'grid' | 'room'>('grid')
  const [q, setQ] = useState(''); const [source, setSource] = useState(''); const [status, setStatus] = useState(''); const [room, setRoom] = useState('')
  const [quick, setQuick] = useState<'' | 'broken' | 'maintenance' | 'warranty'>('')
  const [panel, setPanel] = useState<'type' | 'units' | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  useBackClose(!!detail, () => setDetail(null))
  const [events, setEvents] = useState<Record<string, Ev[]>>({})
  const [open, setOpen] = useState<string | null>(null)

  async function load() {
    const [u, t, r, c] = await Promise.all([
      supabase.from('equipment_units').select('id, type_id, serial, status, room_id, source, warranty_until, equipment_types(name, brand, sku), stem_rooms(name)').order('serial'),
      supabase.from('equipment_types').select('id, sku, name, brand').order('name'),
      loadRooms(), loadRoomContents(),
    ])
    setRows((u.data as unknown as Unit[]) ?? []); setTypes((t.data as Type[]) ?? []); setRooms(r); setStocks(c.stocks)
  }
  useEffect(() => { load() }, [])

  async function printLabels() {
    const { data } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()
    if (!await printUnitLabels(data?.name ?? '', filtered.map(u => ({ id: u.id, serial: u.serial, name: u.equipment_types?.name ?? '', room: u.stem_rooms?.name ?? null })))) alert('Trình duyệt chặn cửa sổ in — hãy cho phép pop-up.')
  }
  async function log(unit_id: string, kind: string, title: string, note: string) {
    await supabase.from('equipment_events').insert({ org_id: orgId, unit_id, kind, title, note })
  }
  async function loadEvents(id: string) {
    const { data } = await supabase.from('equipment_events').select('id, kind, title, note, created_at').eq('unit_id', id).order('created_at', { ascending: false })
    setEvents(e => ({ ...e, [id]: (data as Ev[]) ?? [] }))
  }
  async function setUnitStatus(u: Unit, s: string) {
    await supabase.from('equipment_units').update({ status: s }).eq('id', u.id); await log(u.id, s, `Đổi tình trạng: ${UNIT_STATUS[s]}`, u.serial ?? ''); load(); if (open === u.id) loadEvents(u.id)
  }
  async function moveUnit(u: { id: string; status: string; room_id: string | null }, room_id: string) {
    const err = await moveUnitTo(orgId, u, rooms, room_id); if (err) alert(err)
    load(); if (open === u.id) loadEvents(u.id)
  }
  async function report(u: Unit) {
    const description = prompt(`Mô tả sự cố của ${u.equipment_types?.name} (${u.serial}):`); if (!description) return
    const code = `WT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    await supabase.from('warranty_tickets').insert({ org_id: orgId, code, unit_id: u.id, description, status: 'new', provider: 'KDI Education' })
    await supabase.from('equipment_units').update({ status: 'broken' }).eq('id', u.id)
    await log(u.id, 'report', 'Báo hỏng', `${code}: ${description}`); load(); if (open === u.id) loadEvents(u.id)
  }
  async function removeUnit(u: Unit) { if (confirm(`Xoá thiết bị ${u.serial}?`)) { await supabase.from('equipment_units').delete().eq('id', u.id); load() } }
  async function addType(v: Record<string, string>) {
    const { error } = await supabase.from('equipment_types').insert({ org_id: orgId, sku: v.sku || null, name: v.name, brand: v.brand || null, category: v.category || null })
    if (error) return error.message; setPanel(null); load()
  }
  async function addUnits(v: Record<string, string>) {
    const type = types.find(t => t.id === v.type_id)!; const qty = Math.max(1, Math.min(200, Number(v.qty)))
    const prefix = (type.sku ?? type.name).replace(/\s+/g, '-').toUpperCase(); const start = rows.filter(r => r.serial?.startsWith(prefix + '-')).length
    const list = Array.from({ length: qty }, (_, i) => ({ org_id: orgId, type_id: v.type_id, room_id: v.room_id || null, status: unitStatusAt(rooms.find(r => r.id === v.room_id)?.room_kind ?? null, 'available'), source: v.source,
      serial: `${prefix}-${String(start + i + 1).padStart(4, '0')}`, warranty_until: v.warranty_until || null }))
    const { data, error } = await supabase.from('equipment_units').insert(list).select('id')
    if (error) return error.message
    await supabase.from('equipment_events').insert((data ?? []).map((d: any) => ({ org_id: orgId, unit_id: d.id, kind: 'intake', title: 'Nhập kho / khai báo', note: v.source === 'package' ? 'Nhập kho từ gói STEM.' : 'Nhập kho từ mua sắm của trường.' })))
    setPanel(null); load()
  }

  const filtered = rows.filter(r => (!source || r.source === source) && (!status || r.status === status) && (!room || (room === 'none' ? !r.room_id : r.room_id === room))
    && (quick === '' || (quick === 'broken' && r.status === 'broken') || (quick === 'maintenance' && r.status === 'maintenance') || (quick === 'warranty' && soon(r.warranty_until)))
    && ((r.serial ?? '') + (r.equipment_types?.name ?? '')).toLowerCase().includes(q.toLowerCase()))
  const groups = types.map(t => ({ t, units: filtered.filter(u => u.type_id === t.id) })).filter(g => g.units.length)
  const cnt = (f: (u: Unit) => boolean) => rows.filter(f).length

  if (detail) {
    const g = types.find(t => t.id === detail); const us = rows.filter(u => u.type_id === detail)
    return (<>
      <button onClick={() => setDetail(null)} style={{ marginBottom: 12 }}>← Quay lại danh sách</button>
      <div className="panel"><h3>{g?.name}</h3><small>{g?.brand} · {g?.sku} · {us.length} đơn vị</small></div>
      <table><thead><tr><th>Mã đơn vị / Seri</th><th>Phòng / kho</th><th>Tình trạng</th><th>Bảo hành đến</th><th>Thao tác</th></tr></thead><tbody>
        {us.map(u => (<>
          <tr key={u.id}><td><b>{u.serial}</b></td>
            <td><select value={u.room_id ?? ''} onChange={e => moveUnit(u, e.target.value)} aria-label="Chuyển phòng"><option value="">Chưa xếp phòng</option>{rooms.map(r => <option key={r.id} value={r.id}>{roomLabel(r)}</option>)}</select></td>
            <td><select value={u.status} onChange={e => setUnitStatus(u, e.target.value)}>{Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td>{u.warranty_until ? new Date(u.warranty_until).toLocaleDateString('vi-VN') : '—'}</td>
            <td><button onClick={() => { const n = open === u.id ? null : u.id; setOpen(n); if (n) loadEvents(n) }}>Lịch sử</button> <button onClick={() => report(u)}>Báo hỏng</button> <button onClick={() => removeUnit(u)}>Xoá</button></td></tr>
          {open === u.id && <tr key={u.id + 'h'}><td colSpan={5}><b>Lịch sử thiết bị — {u.serial}</b>
            <div className="timeline" style={{ marginTop: 10 }}>{(events[u.id] ?? []).map(e => <div key={e.id}><b>{e.title}</b> <small>{new Date(e.created_at).toLocaleString('vi-VN')}</small><br /><small>{e.note}</small></div>)}
              {(events[u.id] ?? []).length === 0 && <small>Chưa có lịch sử.</small>}</div></td></tr>}
        </>))}</tbody></table>
    </>)
  }

  return (
    <>
      <div className="cards">
        <div className="card"><strong>{types.length}</strong><span>Loại thiết bị</span></div>
        <div className="card"><strong>{rows.length}</strong><span>Tổng đơn vị</span></div>
        <div className="card"><strong>{cnt(u => u.status === 'broken' || u.status === 'maintenance')}</strong><span>Hỏng / bảo trì</span></div>
        <div className="card"><strong>{cnt(u => u.status === 'in_stock')}</strong><span>Tồn kho · {rooms.filter(r => r.room_kind === 'storage').length} kho, {cnt(u => !u.room_id)} chưa xếp phòng</span></div>
        <div className="card"><strong>{cnt(u => soon(u.warranty_until))}</strong><span>Sắp hết BH (60 ngày)</span></div>
      </div>
      <div className="bar" style={{ marginTop: 16 }}>
        <div className="segmented"><button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Lưới thiết bị</button><button className={view === 'room' ? 'on' : ''} onClick={() => setView('room')}>Theo phòng / kho</button></div>
        <div className="tools"><button onClick={printLabels} disabled={!filtered.length} title="In tem QR cho các thiết bị đang lọc, dán lên thiết bị để kiểm kê bằng camera">In tem QR ({filtered.length})</button><button onClick={() => setPanel('type')}>Thêm loại thiết bị</button><button className="primary" onClick={() => setPanel('units')} disabled={types.length === 0}>Nhập thiết bị</button></div>
      </div>
      {panel === 'type' && <FormPanel fields={[{ key: 'name', label: 'Tên thiết bị', required: true }, { key: 'sku', label: 'Mã SKU' }, { key: 'brand', label: 'Hãng' }, { key: 'category', label: 'Nhóm' }]} onSubmit={addType} onCancel={() => setPanel(null)} />}
      {panel === 'units' && <FormPanel submitLabel="Nhập kho" fields={[
        { key: 'type_id', label: 'Loại thiết bị', type: 'select', required: true, options: types.map(t => ({ value: t.id, label: t.name })) }, { key: 'qty', label: 'Số lượng', type: 'number', required: true },
        { key: 'source', label: 'Nguồn', type: 'select', required: true, options: [{ value: 'package', label: 'Gói STEM' }, { value: 'purchase', label: 'Tự mua' }] },
        { key: 'room_id', label: 'Đặt tại phòng / kho', type: 'select', options: rooms.map(r => ({ value: r.id, label: roomLabel(r) })) }, { key: 'warranty_until', label: 'Bảo hành đến', type: 'date' },
      ]} initial={{ qty: '1', source: 'package' }} onSubmit={addUnits} onCancel={() => setPanel(null)} />}
      <div className="bar" style={{ margin: '12px 0' }}>
        <div className="tools">
          <input className="search" style={{ margin: 0 }} placeholder="Tìm tên / mã tài sản / số seri…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={source} onChange={e => setSource(e.target.value)} aria-label="Nguồn"><option value="">Tất cả nguồn</option><option value="package">Gói STEM</option><option value="purchase">Tự mua</option></select>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Tình trạng"><option value="">Mọi tình trạng</option>{Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={room} onChange={e => setRoom(e.target.value)} aria-label="Phòng"><option value="">Mọi phòng / kho</option><option value="none">Chưa xếp phòng</option>{rooms.map(r => <option key={r.id} value={r.id}>{roomLabel(r)}</option>)}</select>
        </div>
        <div className="tools"><small style={{ alignSelf: 'center' }}>Lọc nhanh:</small>
          {([['broken', 'Chỉ hỏng'], ['maintenance', 'Chỉ bảo trì'], ['warranty', 'Sắp hết BH']] as const).map(([k, l]) => <button key={k} className={'chipbtn' + (quick === k ? ' on' : '')} onClick={() => setQuick(quick === k ? '' : k)}>{l}</button>)}</div>
      </div>
      <p className="sub">{groups.length} loại · {filtered.length} đơn vị khớp</p>

      {view === 'grid' ? (
        <div className="reggrid">
          {groups.map(({ t, units }) => (
            <div className="panel typecard" key={t.id}>
              <div><b>{t.name}</b><br /><small>{t.brand} · {units.length} bộ</small></div>
              <div className="statusbar">{ORDER.map(s => { const n = units.filter(u => u.status === s).length; return n ? <div key={s} className={'dot ' + s} style={{ width: (n / units.length) * 100 + '%', margin: 0, borderRadius: 0, height: '100%' }} title={`${UNIT_STATUS[s]}: ${n}`} /> : null })}</div>
              <small>{ORDER.map(s => { const n = units.filter(u => u.status === s).length; return n ? `${UNIT_STATUS[s]} ×${n}` : null }).filter(Boolean).join(' · ')}</small>
              <div>{[...new Set(units.map(u => u.stem_rooms?.name ?? 'Chưa xếp phòng'))].map(n => <span className="chip" key={n}>{n} ×{units.filter(u => (u.stem_rooms?.name ?? 'Chưa xếp phòng') === n).length}</span>)}</div>
              <div className="actions"><button className="primary" onClick={() => setDetail(t.id)}>Chi tiết</button><button onClick={() => { const u = units.find(x => x.status !== 'broken') ?? units[0]; report(u) }}>Báo hỏng</button></div>
            </div>))}
          {groups.length === 0 && <p className="sub">Không có thiết bị phù hợp.</p>}
        </div>
      ) : (
        <RoomContentsList rooms={room === 'none' ? [] : room ? rooms.filter(r => r.id === room) : rooms} units={filtered as any} showUnplaced={!room || room === 'none'}
          stocks={stocks.filter(x => !q || (x.supplies?.name ?? '').toLowerCase().includes(q.toLowerCase()))} onMoveUnit={moveUnit} />
      )}
    </>
  )
}
