import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type Room = { id: string; name: string; capacity: number | null; status: string; floors: { name: string; buildings: { name: string } | null } | null; equipment_units: { id: string }[] }
const STATUS: Record<string, string> = { active: 'Hoạt động', maintenance: 'Bảo trì', inactive: 'Ngừng' }

export default function Rooms() {
  const [rows, setRows] = useState<Room[]>([])
  const [form, setForm] = useState<{ name: string; capacity: string } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('stem_rooms')
      .select('id, name, capacity, status, floors(name, buildings(name)), equipment_units(id)').order('name')
    setRows((data as unknown as Room[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const { error } = await supabase.from('stem_rooms').insert({
      org_id: await myOrgId(), name: form.name, capacity: form.capacity ? Number(form.capacity) : null,
    })
    if (error) return setErr(error.message)
    setForm(null); setErr(''); load()
  }

  async function setStatus(r: Room, status: string) {
    await supabase.from('stem_rooms').update({ status }).eq('id', r.id)
    load()
  }

  return (
    <>
      <div className="bar">
        <p className="sub">{rows.length} phòng</p>
        <button className="primary" onClick={() => setForm({ name: '', capacity: '' })}>Thêm phòng</button>
      </div>
      {form && (
        <form className="panel formgrid" onSubmit={add}>
          <input required placeholder="Tên phòng" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input type="number" min={1} placeholder="Sức chứa (học sinh)" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Phòng</th><th>Vị trí</th><th>Sức chứa</th><th>Thiết bị</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><b>{r.name}</b></td>
              <td>{r.floors ? `${r.floors.buildings?.name ?? ''} · ${r.floors.name}` : '—'}</td>
              <td>{r.capacity ?? '—'}</td>
              <td>{r.equipment_units.length}</td>
              <td>
                <select value={r.status} onChange={e => setStatus(r, e.target.value)}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5}>Chưa có phòng STEM nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
