import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Unit = { id: string; serial: string | null; status: string; warranty_until: string | null; equipment_types: { name: string; brand: string | null } | null; stem_rooms: { name: string } | null }
export const UNIT_STATUS: Record<string, string> = { available: 'Sẵn sàng', in_use: 'Đang dùng', broken: 'Hỏng', maintenance: 'Bảo trì', in_stock: 'Tồn kho' }

export default function Equipment() {
  const [rows, setRows] = useState<Unit[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  async function load() {
    const { data } = await supabase.from('equipment_units')
      .select('id, serial, status, warranty_until, equipment_types(name, brand), stem_rooms(name)').order('serial')
    setRows((data as unknown as Unit[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function change(u: Unit, s: string) {
    await supabase.from('equipment_units').update({ status: s }).eq('id', u.id)
    load()
  }

  const counts = Object.keys(UNIT_STATUS).map(k => [k, rows.filter(r => r.status === k).length] as const)
  const shown = rows.filter(r =>
    (!status || r.status === status) &&
    ((r.serial ?? '') + (r.equipment_types?.name ?? '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="cards">
        <div className="card"><strong>{rows.length}</strong><span>Tổng thiết bị</span></div>
        {counts.map(([k, n]) => <div className="card" key={k}><strong>{n}</strong><span>{UNIT_STATUS[k]}</span></div>)}
      </div>
      <div className="bar" style={{ marginTop: 16 }}>
        <input className="search" placeholder="Tìm theo tên hoặc số seri…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Lọc trạng thái">
          <option value="">Mọi trạng thái</option>
          {Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <table>
        <thead><tr><th>Thiết bị</th><th>Số seri</th><th>Phòng</th><th>Bảo hành đến</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {shown.map(u => (
            <tr key={u.id}>
              <td><b>{u.equipment_types?.name}</b><br /><small>{u.equipment_types?.brand}</small></td>
              <td>{u.serial}</td>
              <td>{u.stem_rooms?.name ?? 'Kho'}</td>
              <td>{u.warranty_until ? new Date(u.warranty_until).toLocaleDateString('vi-VN') : '—'}</td>
              <td>
                <select value={u.status} onChange={e => change(u, e.target.value)}>
                  {Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={5}>Không có thiết bị phù hợp.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
