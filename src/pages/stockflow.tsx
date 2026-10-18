import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx } from '../lib/sheet'
import { Tabs } from './teacher/common'
import { StepTrail, useLatestRequests, decideText, approvalError } from './approvals/common'

// Đề xuất mua vật tư & Vận chuyển vật tư (migration 045). Duyệt đi qua engine phê duyệt (Hộp phê duyệt) — ở đây có nút duyệt nhanh.
const money = (v: number) => Math.round(v).toLocaleString('vi-VN') + ' đ'
const num = (v: number) => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 045 trên Supabase.' : /row-level/i.test(m) ? 'Bạn không có quyền với kho của đơn vị này.' : approvalError(m))
const STATUS: Record<string, [string, string]> = {
  draft: ['Nháp', 'mute'], pending: ['Chờ duyệt', 'bad'], approved: ['Đã duyệt', 'ok'], rejected: ['Bị từ chối', 'bad'],
  received: ['Đã nhận hàng', 'ok'], shipped: ['Đang vận chuyển', 'bad'], cancelled: ['Đã huỷ', 'mute'],
}
const Pill = ({ s }: { s: string }) => <span className={'plbadge ' + (STATUS[s]?.[1] ?? 'mute')}>{STATUS[s]?.[0] ?? s}</span>
type Sup = { id: string; name: string; unit: string; qty: number; sku: string | null }

// ================= Đề xuất mua vật tư =================
type RLine = { id?: string; supply_id: string | null; name: string; unit: string; qty: number; est_price: number | null; received_qty?: number | null }
type Rq = { id: string; org_id: string; title: string; reason: string | null; needed_by: string | null; status: string; created_at: string; received_at: string | null
  supply_request_lines: RLine[]; organizations?: { name: string } | null }

export function SupplyRequestsPage({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Rq[]>([])
  const [sup, setSup] = useState<Sup[]>([])
  const [form, setForm] = useState<{ id?: string; title: string; reason: string; needed_by: string; lines: RLine[] } | null>(null)
  const [recv, setRecv] = useState<{ rq: Rq; qty: Record<string, string> } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const { map: reqs, reload: reloadReqs } = useLatestRequests('supply_requests', rows.map(r => r.id))
  async function load() {
    const [r, s] = await Promise.all([
      supabase.from('supply_requests').select('*, supply_request_lines(*), organizations(name)').order('created_at', { ascending: false }),
      orgId ? supabase.from('supplies').select('id, name, unit, qty, sku').eq('org_id', orgId).order('name') : Promise.resolve({ data: [] as Sup[], error: null }),
    ])
    if (r.error) setMsg([errText(r.error.message), true])
    setRows((r.data as Rq[]) ?? []); setSup((s.data as Sup[]) ?? [])
  }
  useEffect(() => { load() }, [])
  const multi = new Set(rows.map(r => r.org_id)).size > 1
  const total = (ls: RLine[]) => ls.reduce((a, l) => a + Number(l.qty) * Number(l.est_price ?? 0), 0)
  const shown = rows.filter(r => tab === 'all' || (tab === 'open' ? !['received', 'cancelled'].includes(r.status) : r.status === 'received'))
  const mine = (r: Rq) => !!orgId && r.org_id === orgId

  async function save(submit: boolean) {
    if (!form || !orgId) return
    const lines = form.lines.filter(l => l.name.trim() && Number(l.qty) > 0)
    if (!form.title.trim()) return setMsg(['Cần tên đề xuất.', true])
    if (submit && !lines.length) return setMsg(['Thêm ít nhất một mặt hàng.', true])
    const head = { title: form.title.trim(), reason: form.reason.trim() || null, needed_by: form.needed_by || null }
    let id = form.id
    if (id) { const { error } = await supabase.from('supply_requests').update(head).eq('id', id); if (error) return setMsg([errText(error.message), true]) }
    else {
      const { data, error } = await supabase.from('supply_requests').insert({ org_id: orgId, ...head }).select('id').single()
      if (error) return setMsg([errText(error.message), true]); id = data.id
    }
    await supabase.from('supply_request_lines').delete().eq('request_id', id!)
    if (lines.length) {
      const { error } = await supabase.from('supply_request_lines').insert(lines.map(l => ({ request_id: id, org_id: orgId, supply_id: l.supply_id || null, name: l.name.trim(), unit: l.unit.trim() || 'cái', qty: Number(l.qty), est_price: l.est_price == null || Number.isNaN(Number(l.est_price)) ? null : Number(l.est_price) })))
      if (error) return setMsg([errText(error.message), true])
    }
    if (submit) { const { error } = await supabase.from('supply_requests').update({ status: 'pending' }).eq('id', id!); if (error) return setMsg([errText(error.message), true]) }
    setForm(null); setMsg([submit ? 'Đã gửi duyệt — người duyệt nhận thông báo ở Hộp phê duyệt.' : 'Đã lưu nháp.', false]); await load(); reloadReqs()
  }
  async function decide(r: Rq, d: 'approve' | 'reject') {
    const note = d === 'reject' ? prompt('Lý do từ chối:') : null
    if (d === 'reject' && note === null) return
    const { data, error } = await supabase.rpc('approval_decide_ref', { p_table: 'supply_requests', p_ref: r.id, p_decision: d, p_note: note })
    if (error) return setMsg([errText(error.message), true]); setMsg([decideText(data as any), false]); await load(); reloadReqs()
  }
  async function remove(r: Rq) {
    if (!confirm(`Xoá đề xuất "${r.title}"?`)) return
    const { error } = await supabase.from('supply_requests').delete().eq('id', r.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function receive() {
    if (!recv) return
    const lines = Object.entries(recv.qty).map(([id, q]) => ({ id, qty: Number(q.replace(',', '.')) || 0 }))
    const { data, error } = await supabase.rpc('supply_request_receive', { p_request: recv.rq.id, p_lines: lines })
    if (error) return setMsg([errText(error.message), true])
    setRecv(null); setMsg([`Đã nhận hàng: lập ${data} phiếu nhập kho.`, false]); load()
  }
  function excel() {
    downloadXlsx('de-xuat-vat-tu', [...(multi ? [{ key: 'o', label: 'Đơn vị', width: 26 }] : []), { key: 't', label: 'Đề xuất', width: 30 }, { key: 'n', label: 'Mặt hàng', width: 26 }, { key: 'u', label: 'ĐVT' },
      { key: 'q', label: 'Số lượng' }, { key: 'p', label: 'Đơn giá dự kiến' }, { key: 'r', label: 'Thực nhận' }, { key: 's', label: 'Trạng thái' }, { key: 'd', label: 'Ngày lập' }],
      shown.flatMap(r => r.supply_request_lines.map(l => [...(multi ? [r.organizations?.name ?? ''] : []), r.title, l.name, l.unit, Number(l.qty), l.est_price, l.received_qty, STATUS[r.status]?.[0], day(r.created_at)])), 'Đề xuất')
  }
  const blank = (): RLine => ({ supply_id: null, name: '', unit: 'cái', qty: 1, est_price: null })
  return (
    <>
      <div className="bar">
        <Tabs<'open' | 'done' | 'all'> value={tab} onChange={setTab} items={[['open', 'Đang xử lý', rows.filter(r => !['received', 'cancelled'].includes(r.status)).length], ['done', 'Đã nhận hàng', rows.filter(r => r.status === 'received').length], ['all', 'Tất cả', rows.length]]} />
        <span className="tools"><button onClick={excel}>Xuất Excel</button>
          {orgId && <button className="primary" onClick={() => setForm({ title: '', reason: '', needed_by: '', lines: [blank()] })}>+ Đề xuất mua vật tư</button>}</span>
      </div>
      <p className="sub">Đề xuất → duyệt theo quy trình (Hộp phê duyệt) → khi hàng về bấm <b>Nhận hàng</b>: hệ thống tự lập phiếu nhập kho, vật tư mới tự thêm vào danh mục.</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel" onSubmit={e => { e.preventDefault(); save(false) }}>
          <div className="formgrid">
            <label className="field"><span>Tên đề xuất *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Vật tư chủ đề Mạch điện HK1" /></label>
            <label className="field"><span>Cần trước ngày</span><input type="date" value={form.needed_by} onChange={e => setForm({ ...form, needed_by: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lý do / mục đích</span><input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
          </div>
          <div className="wrap"><table>
            <thead><tr><th>Mặt hàng</th><th>ĐVT</th><th>Số lượng</th><th>Đơn giá dự kiến (đ)</th><th>Thành tiền</th><th /></tr></thead>
            <tbody>{form.lines.map((l, i) => {
              const set = (p: Partial<RLine>) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, ...p } : x)) })
              return (
                <tr key={i}>
                  <td><input list="sup-names" value={l.name} aria-label="Mặt hàng" onChange={e => { const s = sup.find(x => x.name === e.target.value); set({ name: e.target.value, supply_id: s?.id ?? null, unit: s?.unit ?? l.unit }) }} placeholder="Chọn vật tư có sẵn hoặc gõ tên mới" style={{ minWidth: 220 }} />
                    {l.supply_id && <small className="sub"> · tồn {num(sup.find(s => s.id === l.supply_id)?.qty ?? 0)}</small>}</td>
                  <td><input value={l.unit} onChange={e => set({ unit: e.target.value })} style={{ width: 70 }} aria-label="Đơn vị tính" disabled={!!l.supply_id} /></td>
                  <td><input type="number" min={0} step="any" value={l.qty} onChange={e => set({ qty: Number(e.target.value) })} style={{ width: 90 }} aria-label="Số lượng" /></td>
                  <td><input type="number" min={0} value={l.est_price ?? ''} onChange={e => set({ est_price: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 120 }} aria-label="Đơn giá" /></td>
                  <td>{l.est_price ? money(l.qty * l.est_price) : '—'}</td>
                  <td><button type="button" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })} aria-label="Bỏ dòng">✕</button></td>
                </tr>)
            })}</tbody>
          </table></div>
          <datalist id="sup-names">{sup.map(s => <option key={s.id} value={s.name} />)}</datalist>
          <div className="formactions"><button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, blank()] })}>+ Dòng</button>
            <span className="sub" style={{ alignSelf: 'center' }}>Tổng dự kiến: <b>{money(total(form.lines))}</b></span><span style={{ flex: 1 }} />
            <button type="submit">Lưu nháp</button> <button type="button" className="primary" onClick={() => save(true)}>Gửi duyệt</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {recv && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Nhận hàng: {recv.rq.title}</h3>
          <p className="sub">Ghi số thực nhận (để 0 nếu chưa về). Sau khi xác nhận, tồn kho được cộng và đề xuất chuyển sang "Đã nhận hàng".</p>
          <div className="wrap"><table><thead><tr><th>Mặt hàng</th><th>Đề xuất</th><th>Thực nhận</th></tr></thead>
            <tbody>{recv.rq.supply_request_lines.map(l => <tr key={l.id}><td>{l.name}</td><td>{num(l.qty)} {l.unit}</td>
              <td><input inputMode="decimal" value={recv.qty[l.id!] ?? ''} onChange={e => setRecv({ ...recv, qty: { ...recv.qty, [l.id!]: e.target.value } })} style={{ width: 100 }} aria-label={`Thực nhận ${l.name}`} /> {l.unit}</td></tr>)}</tbody></table></div>
          <div className="formactions"><button className="primary" onClick={receive}>Xác nhận nhận hàng</button> <button onClick={() => setRecv(null)}>Huỷ</button></div>
        </div>
      )}
      <div className="wrap"><table>
        <thead><tr>{multi && <th>Đơn vị</th>}<th>Đề xuất</th><th>Mặt hàng</th><th>Dự kiến</th><th>Ngày lập</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{shown.map(r => {
          const req = reqs.get(r.id)
          return [
            <tr key={r.id}>{multi && <td>{r.organizations?.name}</td>}
              <td><b>{r.title}</b>{r.needed_by && <><br /><small>Cần trước {day(r.needed_by)}</small></>}</td>
              <td>{r.supply_request_lines.length}</td><td>{total(r.supply_request_lines) ? money(total(r.supply_request_lines)) : '—'}</td><td>{day(r.created_at)}</td><td><Pill s={r.status} /></td>
              <td className="nowrap"><button onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Đóng' : 'Xem'}</button>
                {mine(r) && ['draft', 'rejected'].includes(r.status) && <> <button onClick={() => setForm({ id: r.id, title: r.title, reason: r.reason ?? '', needed_by: r.needed_by ?? '', lines: r.supply_request_lines.map(l => ({ ...l })) })}>Sửa</button> <button onClick={() => remove(r)}>Xoá</button></>}
                {mine(r) && r.status === 'pending' && <> <button className="primary" onClick={() => decide(r, 'approve')}>Duyệt</button> <button onClick={() => decide(r, 'reject')}>Từ chối</button></>}
                {mine(r) && r.status === 'approved' && <> <button className="primary" onClick={() => setRecv({ rq: r, qty: Object.fromEntries(r.supply_request_lines.map(l => [l.id!, String(l.qty)])) })}>Nhận hàng</button></>}</td></tr>,
            open === r.id && <tr key={r.id + 'd'}><td colSpan={multi ? 7 : 6}>
              {r.reason && <p className="sub">Lý do: {r.reason}</p>}
              <table><thead><tr><th>Mặt hàng</th><th>Số lượng</th><th>Đơn giá</th><th>Thực nhận</th></tr></thead>
                <tbody>{r.supply_request_lines.map(l => <tr key={l.id}><td>{l.name}</td><td>{num(l.qty)} {l.unit}</td><td>{l.est_price ? money(Number(l.est_price)) : '—'}</td><td>{l.received_qty == null ? '—' : num(l.received_qty)}</td></tr>)}</tbody></table>
              {req && <StepTrail req={req} />}
            </td></tr>,
          ]
        })}
          {!shown.length && <tr><td colSpan={7}>Chưa có đề xuất.</td></tr>}</tbody>
      </table></div>
    </>
  )
}

// ================= Vận chuyển vật tư =================
type TItem = { id?: string; supply_id: string | null; unit_id: string | null; name: string | null; unit: string | null; qty: number; received_qty?: number | null }
type Tr = { id: string; org_id: string; to_org: string; title: string; note: string | null; status: string; created_at: string; shipped_at: string | null; received_at: string | null; receive_note: string | null
  stock_transfer_items: TItem[]; from: { name: string } | null; to: { name: string } | null }
type U = { id: string; serial: string | null; status: string; equipment_types: { name: string } | null; stem_rooms: { name: string } | null }

export function printTransfer(t: Tr) {
  const w = window.open('', '_blank'); if (!w) return false
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Biên bản giao nhận</title><style>
    body{font-family:system-ui,Arial,sans-serif;margin:16mm;font-size:11pt}h1{font-size:15pt;text-align:center;margin:0 0 4mm}table{width:100%;border-collapse:collapse;margin:4mm 0}
    td,th{border:1px solid #444;padding:2mm;text-align:left}.sig{display:grid;grid-template-columns:1fr 1fr;text-align:center;margin-top:10mm}.sig div{height:30mm}</style></head><body>
    <h1>BIÊN BẢN GIAO NHẬN VẬT TƯ, THIẾT BỊ</h1><p style="text-align:center">${esc(t.title)}</p>
    <p>Bên giao: <b>${esc(t.from?.name ?? '')}</b><br>Bên nhận: <b>${esc(t.to?.name ?? '')}</b><br>Ngày xuất: ${day(t.shipped_at)}${t.note ? '<br>Ghi chú: ' + esc(t.note) : ''}</p>
    <table><thead><tr><th>#</th><th>Tên vật tư / thiết bị</th><th>ĐVT</th><th>Số lượng giao</th><th>Số lượng nhận</th></tr></thead><tbody>
    ${t.stock_transfer_items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.name ?? '')}</td><td>${esc(i.unit ?? '')}</td><td>${num(i.qty)}</td><td>${i.received_qty == null ? '' : num(i.received_qty)}</td></tr>`).join('')}
    </tbody></table><div class="sig"><div><b>ĐẠI DIỆN BÊN GIAO</b><br><i>(Ký, ghi rõ họ tên)</i></div><div><b>ĐẠI DIỆN BÊN NHẬN</b><br><i>(Ký, ghi rõ họ tên)</i></div></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`)
  w.document.close(); return true
}

export function TransfersPage({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Tr[]>([])
  const [sup, setSup] = useState<Sup[]>([])
  const [units, setUnits] = useState<U[]>([])
  const [targets, setTargets] = useState<{ id: string; name: string; type: string }[]>([])
  const [tab, setTab] = useState<'out' | 'in' | 'all'>('out')
  const [form, setForm] = useState<{ id?: string; to_org: string; title: string; note: string; items: TItem[] } | null>(null)
  const [pickUnit, setPickUnit] = useState('')
  const [recv, setRecv] = useState<{ t: Tr; qty: Record<string, string>; ok: Record<string, boolean>; note: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const { map: reqs, reload: reloadReqs } = useLatestRequests('stock_transfers', rows.map(r => r.id))
  async function load() {
    const [r, s, u, t] = await Promise.all([
      supabase.from('stock_transfers').select('*, stock_transfer_items(*), from:organizations!stock_transfers_org_id_fkey(name), to:organizations!stock_transfers_to_org_fkey(name)').order('created_at', { ascending: false }),
      orgId ? supabase.from('supplies').select('id, name, unit, qty, sku').eq('org_id', orgId).gt('qty', 0).order('name') : Promise.resolve({ data: [] as Sup[], error: null }),
      orgId ? supabase.from('equipment_units').select('id, serial, status, equipment_types(name), stem_rooms(name)').eq('org_id', orgId).not('status', 'in', '(lost,in_transit)').order('serial') : Promise.resolve({ data: [] as U[], error: null }),
      supabase.rpc('stock_targets'),
    ])
    if (r.error) setMsg([errText(r.error.message), true])
    setRows((r.data as unknown as Tr[]) ?? []); setSup((s.data as Sup[]) ?? []); setUnits((u.data as unknown as U[]) ?? []); setTargets((t.data as any[]) ?? [])
  }
  useEffect(() => { load() }, [])
  const out = rows.filter(r => r.org_id === orgId), inc = rows.filter(r => r.to_org === orgId)
  const shown = tab === 'out' ? out : tab === 'in' ? inc : rows
  async function save(submit: boolean) {
    if (!form || !orgId) return
    if (!form.to_org || !form.title.trim()) return setMsg(['Chọn đơn vị nhận và đặt tên phiếu.', true])
    if (submit && !form.items.length) return setMsg(['Thêm ít nhất một dòng.', true])
    const head = { to_org: form.to_org, title: form.title.trim(), note: form.note.trim() || null }
    let id = form.id
    if (id) { const { error } = await supabase.from('stock_transfers').update(head).eq('id', id); if (error) return setMsg([errText(error.message), true]) }
    else {
      const { data, error } = await supabase.from('stock_transfers').insert({ org_id: orgId, ...head }).select('id').single()
      if (error) return setMsg([errText(error.message), true]); id = data.id
    }
    await supabase.from('stock_transfer_items').delete().eq('transfer_id', id!)
    if (form.items.length) {
      const { error } = await supabase.from('stock_transfer_items').insert(form.items.map(i => ({ transfer_id: id, org_id: orgId, supply_id: i.supply_id, unit_id: i.unit_id, qty: i.unit_id ? 1 : Number(i.qty) })))
      if (error) return setMsg([errText(error.message), true])
    }
    if (submit) { const { error } = await supabase.from('stock_transfers').update({ status: 'pending' }).eq('id', id!); if (error) return setMsg([errText(error.message), true]) }
    setForm(null); setMsg([submit ? 'Đã gửi duyệt.' : 'Đã lưu nháp.', false]); await load(); reloadReqs()
  }
  async function decide(t: Tr, d: 'approve' | 'reject') {
    const note = d === 'reject' ? prompt('Lý do từ chối:') : null
    if (d === 'reject' && note === null) return
    const { data, error } = await supabase.rpc('approval_decide_ref', { p_table: 'stock_transfers', p_ref: t.id, p_decision: d, p_note: note })
    if (error) return setMsg([errText(error.message), true]); setMsg([decideText(data as any), false]); await load(); reloadReqs()
  }
  async function ship(t: Tr) {
    if (!confirm(`Xuất hàng "${t.title}" tới ${t.to?.name}? Kho sẽ bị trừ, thiết bị chuyển sang "Đang vận chuyển".`)) return
    const { error } = await supabase.rpc('stock_transfer_ship', { p_transfer: t.id })
    if (error) return setMsg([errText(error.message), true]); setMsg(['Đã xuất hàng — đơn vị nhận đã được thông báo. In biên bản giao nhận để ký.', false]); load()
  }
  async function cancel(t: Tr) {
    if (!confirm(`Huỷ phiếu "${t.title}"?`)) return
    const { error } = t.status === 'draft' ? await supabase.from('stock_transfers').delete().eq('id', t.id) : await supabase.from('stock_transfers').update({ status: 'cancelled' }).eq('id', t.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function receive() {
    if (!recv) return
    const lines = recv.t.stock_transfer_items.map(i => (i.unit_id ? { id: i.id, ok: recv.ok[i.id!] !== false } : { id: i.id, qty: Number((recv.qty[i.id!] ?? '').replace(',', '.')) || 0 }))
    const { data, error } = await supabase.rpc('stock_transfer_receive', { p_transfer: recv.t.id, p_lines: lines, p_note: recv.note || null })
    if (error) return setMsg([errText(error.message), true])
    const d = data as { supplies: number; units: number; lost: number; short: number }
    setRecv(null); setMsg([`Đã nhận: ${d.supplies} dòng vật tư, ${d.units} thiết bị vào kho${d.lost ? `, ${d.lost} thiết bị không tới (ghi Thất lạc)` : ''}${d.short ? `, ${d.short} dòng nhận thiếu` : ''}.`, false]); load()
  }
  function excel() {
    downloadXlsx('van-chuyen-vat-tu', [{ key: 't', label: 'Phiếu', width: 28 }, { key: 'f', label: 'Từ', width: 24 }, { key: 'o', label: 'Đến', width: 24 }, { key: 'n', label: 'Vật tư / thiết bị', width: 28 },
      { key: 'q', label: 'Số lượng giao' }, { key: 'r', label: 'Số lượng nhận' }, { key: 's', label: 'Trạng thái' }, { key: 'd', label: 'Ngày xuất' }],
      shown.flatMap(t => t.stock_transfer_items.map(i => [t.title, t.from?.name, t.to?.name, i.name, Number(i.qty), i.received_qty, STATUS[t.status]?.[0], day(t.shipped_at)])), 'Vận chuyển')
  }
  const addSupply = (id: string) => { const s = sup.find(x => x.id === id); if (!s || !form || form.items.some(i => i.supply_id === id)) return; setForm({ ...form, items: [...form.items, { supply_id: s.id, unit_id: null, name: s.name, unit: s.unit, qty: 1 }] }) }
  const addUnit = (id: string) => { const u = units.find(x => x.id === id); if (!u || !form || form.items.some(i => i.unit_id === id)) return; setForm({ ...form, items: [...form.items, { supply_id: null, unit_id: u.id, name: `${u.equipment_types?.name ?? ''}${u.serial ? ' · ' + u.serial : ''}`, unit: 'cái', qty: 1 }] }) }
  return (
    <>
      <div className="bar">
        <Tabs<'out' | 'in' | 'all'> value={tab} onChange={setTab} items={[['out', 'Gửi đi', out.length], ['in', 'Nhận về', inc.length], ['all', 'Tất cả', rows.length]]} />
        <span className="tools"><button onClick={excel}>Xuất Excel</button>
          {orgId && <button className="primary" onClick={() => setForm({ to_org: '', title: '', note: '', items: [] })} disabled={!targets.length} title={targets.length ? '' : 'Chưa có đơn vị nhận trong phạm vi'}>+ Phiếu vận chuyển</button>}</span>
      </div>
      <p className="sub">Lập phiếu → duyệt (đơn vị gửi) → <b>Xuất hàng</b> (trừ kho, in biên bản) → đơn vị nhận <b>Xác nhận nhận</b> (cộng kho bên nhận, thiết bị chuyển đơn vị). Gửi được trong cây đơn vị, cùng Sở/Tỉnh; KDI gửi được mọi đơn vị.</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel" onSubmit={e => { e.preventDefault(); save(false) }}>
          <div className="formgrid">
            <label className="field"><span>Tên phiếu *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Cấp vật tư gói STEM HK1" /></label>
            <label className="field"><span>Đơn vị nhận *</span><select required value={form.to_org} onChange={e => setForm({ ...form, to_org: e.target.value })}>
              <option value="">— chọn —</option>{targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Phương tiện, người giao, hẹn giờ…" /></label>
            <label className="field"><span>Thêm vật tư</span><select value="" onChange={e => addSupply(e.target.value)}><option value="">— chọn vật tư —</option>
              {sup.filter(s => !form.items.some(i => i.supply_id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name} (tồn {num(s.qty)} {s.unit})</option>)}</select></label>
            <label className="field"><span>Thêm thiết bị (gõ serial / tên)</span><span className="tools">
              <input list="unit-list" value={pickUnit} onChange={e => { const v = e.target.value; const u = units.find(x => `${x.equipment_types?.name} · ${x.serial ?? x.id.slice(0, 8)}` === v); if (u) { addUnit(u.id); setPickUnit('') } else setPickUnit(v) }} placeholder="VD: TB-101" aria-label="Thiết bị" /></span></label>
            <datalist id="unit-list">{units.filter(u => !form.items.some(i => i.unit_id === u.id)).map(u => <option key={u.id} value={`${u.equipment_types?.name} · ${u.serial ?? u.id.slice(0, 8)}`}>{u.stem_rooms?.name ?? 'Kho'}</option>)}</datalist>
          </div>
          <div className="wrap"><table><thead><tr><th>Vật tư / thiết bị</th><th>Số lượng</th><th /></tr></thead>
            <tbody>{form.items.map((i, k) => <tr key={k}><td>{i.unit_id ? '🔧 ' : ''}{i.name}</td>
              <td>{i.unit_id ? '1 cái' : <><input type="number" min={0} step="any" value={i.qty} style={{ width: 90 }} aria-label={`Số lượng ${i.name}`}
                onChange={e => setForm({ ...form, items: form.items.map((x, j) => (j === k ? { ...x, qty: Number(e.target.value) } : x)) })} /> {i.unit} <small className="sub">tồn {num(sup.find(s => s.id === i.supply_id)?.qty ?? 0)}</small></>}</td>
              <td><button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== k) })} aria-label="Bỏ dòng">✕</button></td></tr>)}
              {!form.items.length && <tr><td colSpan={3}>Chọn vật tư hoặc thiết bị ở trên.</td></tr>}</tbody></table></div>
          <div className="formactions"><button type="submit">Lưu nháp</button> <button type="button" className="primary" onClick={() => save(true)}>Gửi duyệt</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {recv && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Xác nhận nhận hàng: {recv.t.title} <small className="sub">từ {recv.t.from?.name}</small></h3>
          <div className="wrap"><table><thead><tr><th>Vật tư / thiết bị</th><th>Giao</th><th>Thực nhận</th></tr></thead>
            <tbody>{recv.t.stock_transfer_items.map(i => <tr key={i.id}><td>{i.name}</td><td>{num(i.qty)} {i.unit}</td>
              <td>{i.unit_id ? <label><input type="checkbox" checked={recv.ok[i.id!] !== false} onChange={e => setRecv({ ...recv, ok: { ...recv.ok, [i.id!]: e.target.checked } })} /> Đã nhận</label>
                : <><input inputMode="decimal" value={recv.qty[i.id!] ?? ''} onChange={e => setRecv({ ...recv, qty: { ...recv.qty, [i.id!]: e.target.value } })} style={{ width: 90 }} aria-label={`Thực nhận ${i.name}`} /> {i.unit}</>}</td></tr>)}</tbody></table></div>
          <label className="field"><span>Ghi chú khi nhận</span><input value={recv.note} onChange={e => setRecv({ ...recv, note: e.target.value })} placeholder="VD: 2 viên pin bị móp" /></label>
          <div className="formactions"><button className="primary" onClick={receive}>Xác nhận</button> <button onClick={() => setRecv(null)}>Huỷ</button></div>
        </div>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Phiếu</th><th>Từ → Đến</th><th>Dòng</th><th>Ngày lập</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{shown.map(t => {
          const sender = t.org_id === orgId, receiver = t.to_org === orgId, req = reqs.get(t.id)
          return [
            <tr key={t.id}><td><b>{t.title}</b></td><td>{t.from?.name} → {t.to?.name}</td><td>{t.stock_transfer_items.length}</td><td>{day(t.created_at)}</td><td><Pill s={t.status} /></td>
              <td className="nowrap"><button onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Đóng' : 'Xem'}</button>
                {sender && ['draft', 'rejected'].includes(t.status) && <> <button onClick={() => setForm({ id: t.id, to_org: t.to_org, title: t.title, note: t.note ?? '', items: t.stock_transfer_items.map(i => ({ ...i })) })}>Sửa</button></>}
                {sender && t.status === 'pending' && <> <button className="primary" onClick={() => decide(t, 'approve')}>Duyệt</button> <button onClick={() => decide(t, 'reject')}>Từ chối</button></>}
                {sender && t.status === 'approved' && <> <button className="primary" onClick={() => ship(t)}>Xuất hàng</button></>}
                {sender && ['draft', 'rejected', 'approved'].includes(t.status) && <> <button onClick={() => cancel(t)}>Huỷ</button></>}
                {receiver && t.status === 'shipped' && <> <button className="primary" onClick={() => setRecv({ t, qty: Object.fromEntries(t.stock_transfer_items.map(i => [i.id!, String(i.qty)])), ok: {}, note: '' })}>Xác nhận nhận</button></>}
                {['shipped', 'received'].includes(t.status) && <> <button onClick={() => printTransfer(t) || alert('Trình duyệt chặn cửa sổ in — hãy cho phép pop-up.')}>In biên bản</button></>}</td></tr>,
            open === t.id && <tr key={t.id + 'd'}><td colSpan={6}>
              {t.note && <p className="sub">Ghi chú: {t.note}</p>}{t.receive_note && <p className="sub">Khi nhận: {t.receive_note}</p>}
              <table><thead><tr><th>Vật tư / thiết bị</th><th>Giao</th><th>Nhận</th></tr></thead>
                <tbody>{t.stock_transfer_items.map(i => <tr key={i.id}><td>{i.unit_id ? '🔧 ' : ''}{i.name}</td><td>{num(i.qty)} {i.unit}</td>
                  <td className={i.received_qty != null && Number(i.received_qty) < Number(i.qty) ? 'due bad' : ''}>{i.received_qty == null ? '—' : num(i.received_qty)}</td></tr>)}</tbody></table>
              {req && <StepTrail req={req} />}
            </td></tr>,
          ]
        })}
          {!shown.length && <tr><td colSpan={6}>{tab === 'in' ? 'Chưa có phiếu gửi tới đơn vị.' : 'Chưa có phiếu vận chuyển.'}</td></tr>}</tbody>
      </table></div>
    </>
  )
}
