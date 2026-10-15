import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { StepTrail, StatusPill, useLatestRequests, fmt, approvalError } from './common'

type Order = { id: string; name: string; tier: string; programs: string | null; grades: string | null; quantity: number; budget: number | null; note: string | null; status: string; created_at: string }
const TIER: Record<string, string> = { basic: 'Cơ bản', advanced: 'Nâng cao', premium: 'Premium' }
const EMPTY = { name: '', tier: 'basic', programs: '', grades: '', quantity: '1', budget: '', note: '' }

// Đề xuất mua gói STEM: trường lập đề xuất → gửi duyệt theo quy trình (vd: Hiệu trưởng → Sở)
export function PackageOrders({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Order[]>([])
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const load = () => supabase.from('package_orders').select('*').eq('org_id', orgId ?? '').order('created_at', { ascending: false })
    .then(({ data, error }) => error ? setMsg(/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 022_approval_engine.sql trên Supabase.' : error.message) : setRows((data as Order[]) ?? []))
  useEffect(() => { load() }, [orgId])
  const { map, reload } = useLatestRequests('package_orders', rows.map(r => r.id))

  async function save(e: React.FormEvent, submit: boolean) {
    e.preventDefault(); if (!form || !orgId) return
    const { error } = await supabase.from('package_orders').insert({
      org_id: orgId, name: form.name.trim(), tier: form.tier, programs: form.programs.trim() || null, grades: form.grades.trim() || null,
      quantity: Number(form.quantity) || 1, budget: form.budget ? Number(form.budget.replace(/\D/g, '')) : null, note: form.note.trim() || null,
      status: submit ? 'pending' : 'draft',
    })
    if (error) return setMsg(error.message)
    setMsg(''); setInfo(submit ? 'Đã gửi đề xuất. Theo dõi tiến trình duyệt ngay dưới đây hoặc ở Hộp phê duyệt.' : 'Đã lưu nháp.'); setForm(null); await load(); reload()
  }
  async function submit(o: Order) {
    const { error } = await supabase.from('package_orders').update({ status: 'pending' }).eq('id', o.id)
    if (error) setMsg(approvalError(error.message)); else { setInfo(`Đã gửi duyệt “${o.name}”.`); await load(); reload() }
  }
  async function remove(o: Order) {
    if (!confirm(`Xoá đề xuất “${o.name}”?`)) return
    const { error } = await supabase.from('package_orders').delete().eq('id', o.id)
    if (error) setMsg(error.message); else load()
  }

  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Lập đề xuất mua gói, gửi duyệt và theo dõi từng bước. Quy trình đặt ở mục <b>Quy trình phê duyệt</b>.</p>
        <button className="primary" onClick={() => setForm({ ...EMPTY })}>+ Lập đề xuất</button>
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={e => save(e, true)}>
          <label className="field"><span>Tên gói đề xuất *</span><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Gói STEM Robotics khối 8–9" /></label>
          <label className="field"><span>Loại gói</span><select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>{Object.entries(TIER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Chương trình</span><input value={form.programs} onChange={e => setForm({ ...form, programs: e.target.value })} placeholder="CT3,CT4" /></label>
          <label className="field"><span>Khối</span><input value={form.grades} onChange={e => setForm({ ...form, grades: e.target.value })} placeholder="8–9" /></label>
          <label className="field"><span>Số lượng</span><input type="number" min={1} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
          <label className="field"><span>Dự toán (đồng)</span><input inputMode="numeric" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} placeholder="250000000" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lý do / ghi chú</span><textarea rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <div className="formactions">
            <button className="primary">Gửi duyệt</button> <button type="button" onClick={e => save(e as unknown as React.FormEvent, false)} disabled={!form.name.trim()}>Lưu nháp</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </form>
      )}
      <div className="reqlist">
        {rows.map(o => {
          const req = map.get(o.id)
          return (
            <article className="panel req" key={o.id}>
              <header className="bar">
                <div>
                  <h3>{o.name}</h3>
                  <p className="sub">{TIER[o.tier]} · SL {o.quantity}{o.programs ? ` · ${o.programs}` : ''}{o.grades ? ` · Khối ${o.grades}` : ''}
                    {o.budget ? ` · ${o.budget.toLocaleString('vi-VN')} đ` : ''} · lập {fmt(o.created_at)}</p>
                  {o.note && <p className="sub">{o.note}</p>}
                </div>
                <StatusPill status={o.status} />
              </header>
              {req && o.status !== 'draft' && <StepTrail req={req} />}
              <div className="actions">
                {(o.status === 'draft' || o.status === 'rejected') && <button className="primary" onClick={() => submit(o)}>{o.status === 'rejected' ? 'Gửi duyệt lại' : 'Gửi duyệt'}</button>}
                {(o.status === 'draft' || o.status === 'rejected') && <button onClick={() => remove(o)}>Xoá</button>}
              </div>
            </article>
          )
        })}
        {rows.length === 0 && !form && <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có đề xuất nào.</p></div>}
      </div>
    </>
  )
}
