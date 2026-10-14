import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type Ticket = { id: string; unit_id: string | null; code: string | null; description: string | null; status: string; created_at: string; equipment_units: { serial: string | null; equipment_types: { name: string } | null } | null }
type Unit = { id: string; serial: string | null; equipment_types: { name: string } | null }
const STATUS: Record<string, string> = { new: 'Mới', accepted: 'Đã tiếp nhận', processing: 'Đang xử lý', resolved: 'Đã xử lý', rejected: 'Từ chối', closed: 'Đóng' }

export default function Warranty() {
  const [rows, setRows] = useState<Ticket[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [form, setForm] = useState<{ unit_id: string; description: string } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const [t, u] = await Promise.all([
      supabase.from('warranty_tickets')
        .select('id, unit_id, code, description, status, created_at, equipment_units(serial, equipment_types(name))')
        .order('created_at', { ascending: false }),
      supabase.from('equipment_units').select('id, serial, equipment_types(name)').order('serial'),
    ])
    setRows((t.data as unknown as Ticket[]) ?? [])
    setUnits((u.data as unknown as Unit[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function setStatus(t: Ticket, status: string) {
    await supabase.from('warranty_tickets').update({ status }).eq('id', t.id)
    if (t.unit_id && status === 'resolved') await supabase.from('equipment_units').update({ status: 'available' }).eq('id', t.unit_id)
    if (t.unit_id && status === 'processing') await supabase.from('equipment_units').update({ status: 'maintenance' }).eq('id', t.unit_id)
    load()
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const { data: u } = await supabase.auth.getUser()
    const code = `WT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    const { error } = await supabase.from('warranty_tickets').insert({
      org_id: await myOrgId(), code, unit_id: form.unit_id, description: form.description, reported_by: u.user!.id,
    })
    if (error) return setErr(error.message)
    await supabase.from('equipment_units').update({ status: 'broken' }).eq('id', form.unit_id)
    setForm(null); setErr(''); load()
  }

  return (
    <>
      <div className="bar">
        <p className="sub">{rows.length} ticket</p>
        <button className="primary" onClick={() => setForm({ unit_id: units[0]?.id ?? '', description: '' })}>Báo lỗi thiết bị</button>
      </div>
      {form && (
        <form className="panel formgrid" onSubmit={create}>
          <select required value={form.unit_id} onChange={e => setForm({ ...form, unit_id: e.target.value })}>
            {units.map(u => <option key={u.id} value={u.id}>{u.equipment_types?.name} — {u.serial}</option>)}
          </select>
          <input required placeholder="Mô tả sự cố" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <div><button className="primary" type="submit">Gửi báo lỗi</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Mã ticket</th><th>Thiết bị</th><th>Mô tả sự cố</th><th>Ngày báo</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id}>
              <td><b>{t.code}</b></td>
              <td>{t.equipment_units?.equipment_types?.name}<br /><small>{t.equipment_units?.serial}</small></td>
              <td>{t.description}</td>
              <td>{new Date(t.created_at).toLocaleDateString('vi-VN')}</td>
              <td><select value={t.status} onChange={e => setStatus(t, e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5}>Chưa có ticket bảo hành nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
