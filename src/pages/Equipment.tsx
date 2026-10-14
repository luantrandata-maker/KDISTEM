import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'

type Unit = { id: string; serial: string | null; status: string; warranty_until: string | null; equipment_types: { name: string; brand: string | null } | null; stem_rooms: { name: string } | null }
type Type = { id: string; sku: string | null; name: string }
export const UNIT_STATUS: Record<string, string> = { available: 'Sẵn sàng', in_use: 'Đang dùng', broken: 'Hỏng', maintenance: 'Bảo trì', in_stock: 'Tồn kho' }

export default function Equipment({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Unit[]>([])
  const [types, setTypes] = useState<Type[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [panel, setPanel] = useState<'type' | 'units' | null>(null)

  async function load() {
    const [u, t, r] = await Promise.all([
      supabase.from('equipment_units').select('id, serial, status, warranty_until, equipment_types(name, brand), stem_rooms(name)').order('serial'),
      supabase.from('equipment_types').select('id, sku, name').order('name'),
      supabase.from('stem_rooms').select('id, name').order('name'),
    ])
    setRows((u.data as unknown as Unit[]) ?? []); setTypes((t.data as Type[]) ?? []); setRooms((r.data as any) ?? [])
  }
  useEffect(() => { load() }, [])

  async function change(u: Unit, s: string) { await supabase.from('equipment_units').update({ status: s }).eq('id', u.id); load() }
  async function addType(v: Record<string, string>) {
    const { error } = await supabase.from('equipment_types').insert({ org_id: orgId, sku: v.sku || null, name: v.name, brand: v.brand || null, category: v.category || null })
    if (error) return error.message
    setPanel(null); load()
  }
  async function addUnits(v: Record<string, string>) {
    const type = types.find(t => t.id === v.type_id)!
    const qty = Math.max(1, Math.min(200, Number(v.qty)))
    const prefix = (type.sku ?? type.name).replace(/\s+/g, '-').toUpperCase()
    const start = rows.filter(r => r.serial?.startsWith(prefix + '-')).length
    const list = Array.from({ length: qty }, (_, i) => ({
      org_id: orgId, type_id: v.type_id, room_id: v.room_id || null, status: v.room_id ? 'available' : 'in_stock',
      serial: `${prefix}-${String(start + i + 1).padStart(4, '0')}`, warranty_until: v.warranty_until || null,
    }))
    const { error } = await supabase.from('equipment_units').insert(list)
    if (error) return error.message
    setPanel(null); load()
  }

  const counts = Object.keys(UNIT_STATUS).map(k => [k, rows.filter(r => r.status === k).length] as const)
  const shown = rows.filter(r => (!status || r.status === status) && ((r.serial ?? '') + (r.equipment_types?.name ?? '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="cards">
        <div className="card"><strong>{rows.length}</strong><span>Tổng thiết bị</span></div>
        {counts.map(([k, n]) => <div className="card" key={k}><strong>{n}</strong><span>{UNIT_STATUS[k]}</span></div>)}
      </div>
      <div className="bar" style={{ marginTop: 16 }}>
        <div className="tools">
          <input className="search" placeholder="Tìm theo tên hoặc số seri…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Lọc trạng thái">
            <option value="">Mọi trạng thái</option>{Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="tools"><button onClick={() => setPanel('type')}>Thêm loại thiết bị</button><button className="primary" onClick={() => setPanel('units')} disabled={types.length === 0}>Nhập thiết bị</button></div>
      </div>
      {panel === 'type' && (
        <FormPanel fields={[
          { key: 'name', label: 'Tên thiết bị', required: true }, { key: 'sku', label: 'Mã SKU' },
          { key: 'brand', label: 'Hãng' }, { key: 'category', label: 'Nhóm' },
        ]} onSubmit={addType} onCancel={() => setPanel(null)} />
      )}
      {panel === 'units' && (
        <FormPanel submitLabel="Nhập kho" fields={[
          { key: 'type_id', label: 'Loại thiết bị', type: 'select', required: true, options: types.map(t => ({ value: t.id, label: t.name })) },
          { key: 'qty', label: 'Số lượng', type: 'number', required: true },
          { key: 'room_id', label: 'Phòng (để trống = tồn kho)', type: 'select', options: rooms.map(r => ({ value: r.id, label: r.name })) },
          { key: 'warranty_until', label: 'Bảo hành đến', type: 'date' },
        ]} initial={{ qty: '1' }} onSubmit={addUnits} onCancel={() => setPanel(null)} />
      )}
      <table>
        <thead><tr><th>Thiết bị</th><th>Số seri</th><th>Phòng</th><th>Bảo hành đến</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {shown.map(u => (
            <tr key={u.id}>
              <td><b>{u.equipment_types?.name}</b><br /><small>{u.equipment_types?.brand}</small></td>
              <td>{u.serial}</td><td>{u.stem_rooms?.name ?? 'Kho'}</td>
              <td>{u.warranty_until ? new Date(u.warranty_until).toLocaleDateString('vi-VN') : '—'}</td>
              <td><select value={u.status} onChange={e => change(u, e.target.value)}>{Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={5}>Không có thiết bị phù hợp.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
