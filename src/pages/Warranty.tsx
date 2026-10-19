import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'

type Ticket = { id: string; unit_id: string | null; code: string | null; description: string | null; status: string; created_at: string; provider: string | null; provider_status: string; technician: string | null; equipment_units: { serial: string | null; equipment_types: { name: string } | null } | null }
type Unit = { id: string; serial: string | null; equipment_types: { name: string } | null }
const STATUS: Record<string, string> = { draft: 'Nháp', new: 'Mới', accepted: 'Đã tiếp nhận', waiting_parts: 'Chờ phụ kiện', processing: 'Đang xử lý', resolved: 'Đã xử lý', rejected: 'Từ chối', closed: 'Đóng' }
const PILL: Record<string, string> = { draft: '', new: 'maintenance', accepted: '', waiting_parts: 'maintenance', processing: 'maintenance', resolved: 'active', rejected: 'inactive', closed: '' }

export default function Warranty({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Ticket[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [form, setForm] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  async function load() {
    const [t, u] = await Promise.all([
      supabase.from('warranty_tickets').select('id, unit_id, code, description, status, created_at, provider, provider_status, technician, equipment_units(serial, equipment_types(name))').order('code'),
      supabase.from('equipment_units').select('id, serial, equipment_types(name)').order('serial'),
    ])
    setRows((t.data as unknown as Ticket[]) ?? []); setUnits((u.data as unknown as Unit[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function create(v: Record<string, string>, status: 'draft' | 'new') {
    const code = `WT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('warranty_tickets').insert({ org_id: orgId, code, unit_id: v.unit_id, description: v.description, status, reported_by: u.user!.id, provider: 'KDI Education' })
    if (error) return error.message
    if (status === 'new') { await supabase.from('equipment_units').update({ status: 'broken' }).eq('id', v.unit_id); await supabase.from('equipment_events').insert({ org_id: orgId, unit_id: v.unit_id, kind: 'report', title: 'Báo hỏng', note: `${code}: ${v.description}` }) }
    setForm(false); load()
  }
  async function patch(t: Ticket, body: Record<string, unknown>) {
    await supabase.from('warranty_tickets').update(body).eq('id', t.id)
    if (t.unit_id && body.status === 'resolved') await supabase.from('equipment_units').update({ status: 'available' }).eq('id', t.unit_id)
    if (t.unit_id && body.status === 'processing') await supabase.from('equipment_units').update({ status: 'maintenance' }).eq('id', t.unit_id)
    load()
  }

  const n = (s: string) => rows.filter(r => r.status === s).length
  const shown = rows.filter(r => (filter === 'all' || r.status === filter) && ((r.code ?? '') + (r.description ?? '') + (r.equipment_units?.serial ?? '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{rows.length}</strong><span>Tổng ticket</span></div>
        <div className="card"><strong>{rows.filter(r => ['accepted', 'waiting_parts', 'processing'].includes(r.status)).length}</strong><span>Đang xử lý</span></div>
        <div className="card"><strong>{n('resolved')}</strong><span>Đã xử lý</span></div>
        <div className="card"><strong>{n('rejected')}</strong><span>Từ chối</span></div>
      </div>
      <div className="bar" style={{ margin: '16px 0 12px' }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm theo mã ticket, mô tả sự cố…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="primary" onClick={() => setForm(true)} disabled={units.length === 0}>Báo lỗi thiết bị</button>
      </div>
      <div className="tools" style={{ marginBottom: 12 }}>
        <button className={'chipbtn' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>Tất cả</button>
        {Object.entries(STATUS).map(([k, l]) => <button key={k} className={'chipbtn' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l} ({n(k)})</button>)}
      </div>
      {form && <TicketForm units={units} onSubmit={create} onCancel={() => setForm(false)} />}
      <div className="wrap"><table>
        <thead><tr><th>Mã ticket</th><th>Thiết bị</th><th>Mô tả sự cố</th><th>Nhà cung cấp</th><th>KTV phụ trách</th><th>Ngày báo</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {shown.map(t => (<Fragment key={t.id}>
            <tr key={t.id} onClick={() => setOpen(open === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
              <td><b>{t.code}</b></td><td>{t.equipment_units?.equipment_types?.name}<br /><small>{t.equipment_units?.serial}</small></td>
              <td style={{ whiteSpace: 'normal', maxWidth: 300 }}>{t.description}</td>
              <td><span className={'pill ' + (t.provider_status === 'accepted' ? 'active' : 'maintenance')}>{t.provider_status === 'accepted' ? 'Đã tiếp nhận' : 'Chờ tiếp nhận'}</span></td>
              <td>{t.technician ?? <small>Chưa phân công</small>}</td><td>{new Date(t.created_at).toLocaleDateString('vi-VN')}</td>
              <td><span className={'pill ' + PILL[t.status]}>{STATUS[t.status]}</span></td></tr>
            {open === t.id && <tr key={t.id + 'd'}><td colSpan={7}><div className="formgrid">
              <label className="field"><span>Trạng thái</span><select value={t.status} onChange={e => patch(t, { status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field"><span>Nhà cung cấp tiếp nhận</span><select value={t.provider_status} onChange={e => patch(t, { provider_status: e.target.value })}><option value="pending">Chờ tiếp nhận</option><option value="accepted">Đã tiếp nhận</option></select></label>
              <label className="field"><span>KTV phụ trách</span><input defaultValue={t.technician ?? ''} onBlur={e => e.target.value !== (t.technician ?? '') && patch(t, { technician: e.target.value || null })} /></label>
            </div></td></tr>}
          </Fragment>))}
          {shown.length === 0 && <tr><td colSpan={7}>Không có ticket phù hợp.</td></tr>}
        </tbody></table></div>
    </>
  )
}

function TicketForm({ units, onSubmit, onCancel }: { units: Unit[]; onSubmit: (v: Record<string, string>, s: 'draft' | 'new') => Promise<string | void>; onCancel: () => void }) {
  const [mode, setMode] = useState<'draft' | 'new'>('new')
  return (<>
    <FormPanel submitLabel="Lưu" fields={[
      { key: 'unit_id', label: 'Thiết bị', type: 'select', required: true, options: units.map(u => ({ value: u.id, label: `${u.equipment_types?.name} — ${u.serial}` })) },
      { key: 'description', label: 'Mô tả sự cố', required: true },
    ]} onSubmit={v => onSubmit(v, mode)} onCancel={onCancel} />
    <div className="segmented"><button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>Gửi ngay cho nhà cung cấp</button><button className={mode === 'draft' ? 'on' : ''} onClick={() => setMode('draft')}>Lưu nháp</button></div>
  </>)
}
