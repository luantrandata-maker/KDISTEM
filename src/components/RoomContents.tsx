import { Fragment, useState } from 'react'
import { UNIT_STATUS } from '../pages/Equipment'
import { ROOM_KIND, ROOM_STATUS, roomLabel, type RoomLite, type RoomStock, type RoomUnit } from '../lib/rooms'

const ORDER = ['available', 'in_use', 'maintenance', 'broken', 'in_stock', 'in_transit', 'lost']
const num = (v: number) => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const day = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'

/** Tóm tắt một phòng: "12 thiết bị (2 hỏng) · 3 loại vật tư" */
export function contentSummary(units: RoomUnit[], stocks: RoomStock[]) {
  const bad = units.filter(u => u.status === 'broken' || u.status === 'maintenance' || u.status === 'lost').length
  return [units.length ? `${units.length} thiết bị${bad ? ` (${bad} hỏng/bảo trì/thất lạc)` : ''}` : 'Chưa có thiết bị',
    stocks.length ? `${stocks.length} loại vật tư` : null].filter(Boolean).join(' · ')
}

/** Chi tiết mọi thiết bị (theo loại → từng chiếc) và vật tư tiêu hao đang ở một phòng / kho */
export function RoomContents({ units, stocks, rooms, onMoveUnit }: {
  units: RoomUnit[]; stocks: RoomStock[]
  rooms?: RoomLite[]; onMoveUnit?: (u: RoomUnit, roomId: string) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const types = [...new Map(units.map(u => [u.type_id, u.equipment_types])).entries()]
    .map(([id, t]) => ({ id, t, us: units.filter(u => u.type_id === id) }))
    .sort((a, b) => (a.t?.name ?? '').localeCompare(b.t?.name ?? '', 'vi'))
  const allOpen = types.length > 0 && types.every(g => open[g.id])
  return (
    <div className="roomexp">
      <div className="bar"><h4>Thiết bị · {units.length} chiếc, {types.length} loại</h4>
        {types.length > 0 && <button className="linkbtn" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(types.map(g => [g.id, true])))}>{allOpen ? 'Thu gọn' : 'Xem từng chiếc'}</button>}</div>
      {types.length ? (
        <div className="wrap"><table className="roomexp-t">
          <thead><tr><th>Loại thiết bị</th><th>Số lượng</th><th>Tình trạng</th><th /></tr></thead>
          <tbody>{types.map(g => (
            <Fragment key={g.id}>
              <tr className="roomexp-type" onClick={() => setOpen({ ...open, [g.id]: !open[g.id] })}>
                <td><span className="caret">{open[g.id] ? '▾' : '▸'}</span> <b>{g.t?.name ?? '—'}</b>{(g.t?.brand || g.t?.sku) && <small> · {[g.t?.brand, g.t?.sku].filter(Boolean).join(' · ')}</small>}</td>
                <td><b>{g.us.length}</b></td>
                <td>{ORDER.map(s => { const n = g.us.filter(u => u.status === s).length; return n ? <span key={s} className="nowrap" style={{ marginRight: 10 }}><span className={'dot ' + s} />{UNIT_STATUS[s]} ×{n}</span> : null })}</td>
                <td><button className="linkbtn" aria-expanded={!!open[g.id]}>{open[g.id] ? 'Ẩn' : 'Chi tiết'}</button></td>
              </tr>
              {open[g.id] && g.us.map(u => (
                <tr key={u.id} className="roomexp-unit">
                  <td><span className="mono">{u.serial ?? '(chưa có seri)'}</span></td>
                  <td><span className={'dot ' + u.status} />{UNIT_STATUS[u.status] ?? u.status}</td>
                  <td><small>Bảo hành đến {day(u.warranty_until)}</small></td>
                  <td>{onMoveUnit && rooms && <select value={u.room_id ?? ''} onChange={e => onMoveUnit(u, e.target.value)} aria-label={`Chuyển ${u.serial ?? ''} sang phòng khác`}>
                    <option value="">Chưa xếp phòng</option>{rooms.map(r => <option key={r.id} value={r.id}>{roomLabel(r)}</option>)}</select>}</td>
                </tr>))}
            </Fragment>))}</tbody>
        </table></div>
      ) : <p className="sub">Không có thiết bị trong phòng.</p>}

      <h4>Vật tư tiêu hao · {stocks.length} loại</h4>
      {stocks.length ? (
        <div className="wrap"><table className="roomexp-t">
          <thead><tr><th>Vật tư</th><th>Nhóm</th><th>Số lượng tại phòng</th></tr></thead>
          <tbody>{[...stocks].sort((a, b) => (a.supplies?.name ?? '').localeCompare(b.supplies?.name ?? '', 'vi')).map(s => (
            <tr key={s.id}><td><b>{s.supplies?.name}</b>{s.supplies?.sku && <small> · {s.supplies.sku}</small>}</td><td>{s.supplies?.category ?? '—'}</td>
              <td><b>{num(s.qty)}</b> {s.supplies?.unit}</td></tr>))}</tbody>
        </table></div>
      ) : <p className="sub">Không có vật tư tiêu hao trong phòng. Chuyển vật tư tới phòng ở <i>Vật tư tiêu hao → Chuyển vị trí</i>.</p>}
    </div>
  )
}

/** Danh sách phòng bung ra được: mỗi phòng một dòng tóm tắt, bấm để xem toàn bộ thiết bị và vật tư trong phòng */
export function RoomContentsList({ rooms, units, stocks, onMoveUnit, showUnplaced = true }: {
  rooms: RoomLite[]; units: RoomUnit[]; stocks: RoomStock[]
  onMoveUnit?: (u: RoomUnit, roomId: string) => void; showUnplaced?: boolean
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const list: { id: string; room: RoomLite | null }[] = [...rooms.map(r => ({ id: r.id, room: r })), ...(showUnplaced ? [{ id: 'none', room: null }] : [])]
  const of = (id: string) => ({ us: units.filter(u => (u.room_id ?? 'none') === id), ss: stocks.filter(s => (s.room_id ?? 'none') === id) })
  const rows = list.map(x => ({ ...x, ...of(x.id) })).filter(x => x.room || x.us.length || x.ss.length)
  const allOpen = rows.length > 0 && rows.every(x => open[x.id])
  return (
    <>
      <div className="bar"><p className="sub" style={{ margin: 0 }}>Bấm một phòng để xem toàn bộ thiết bị (theo loại → từng chiếc) và vật tư tiêu hao đang ở phòng đó.</p>
        <button onClick={() => setOpen(allOpen ? {} : Object.fromEntries(rows.map(x => [x.id, true])))}>{allOpen ? 'Thu gọn tất cả' : 'Mở tất cả'}</button></div>
      <div className="roomacc">
        {rows.map(x => (
          <div className={'roomacc-item' + (open[x.id] ? ' on' : '')} key={x.id}>
            <button className="roomacc-head" aria-expanded={!!open[x.id]} onClick={() => setOpen({ ...open, [x.id]: !open[x.id] })}>
              <span className="caret">{open[x.id] ? '▾' : '▸'}</span>
              <span className="roomacc-name"><b>{x.room ? x.room.name : 'Chưa xếp phòng'}</b>{x.room?.code && <small> · {x.room.code}</small>}</span>
              {x.room ? <span className={'rkind ' + x.room.room_kind}>{ROOM_KIND[x.room.room_kind]}</span> : <span className="rkind none">Chưa xếp</span>}
              {x.room && x.room.status !== 'active' && <span className={'pill ' + x.room.status}>{ROOM_STATUS[x.room.status]}</span>}
              <small className="roomacc-sum">{contentSummary(x.us, x.ss)}</small>
            </button>
            {open[x.id] && <RoomContents units={x.us} stocks={x.ss} rooms={rooms} onMoveUnit={onMoveUnit} />}
          </div>))}
        {rows.length === 0 && <p className="sub">Chưa có phòng nào.</p>}
      </div>
    </>
  )
}
