import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'

// Hỗ trợ khách hàng (migration 024)
//  • mode 'platform': KDI xem mọi phiếu, đổi trạng thái / mức ưu tiên / người xử lý, ghi chú nội bộ, xử lý phiếu bảo hành thiết bị.
//  • mode 'customer': trường / Sở gửi yêu cầu, trao đổi với KDI, đóng hoặc mở lại phiếu.

type Ticket = {
  id: string; code: string; org_id: string; category: string; priority: string; subject: string; description: string | null
  status: string; reported_by: string | null; assignee: string | null; due_at: string | null; first_response_at: string | null
  resolved_at: string | null; created_at: string; updated_at: string
  organizations: { name: string } | null
  reporter: { full_name: string | null; email: string | null } | null
}
type Msg = { id: string; body: string; internal: boolean; created_at: string; author: string | null; profiles: { full_name: string | null; email: string | null } | null }
type Warranty = { id: string; code: string | null; description: string | null; status: string; provider_status: string; technician: string | null; created_at: string
  organizations: { name: string } | null; equipment_units: { serial: string | null; equipment_types: { name: string } | null } | null }
type Person = { id: string; full_name: string | null; email: string | null }

export const CATEGORY: Record<string, string> = { technical: 'Lỗi kỹ thuật', account: 'Tài khoản & đăng nhập', content: 'Nội dung, học liệu', equipment: 'Thiết bị', billing: 'Hợp đồng, thanh toán', other: 'Khác' }
export const PRIORITY: Record<string, string> = { urgent: 'Khẩn cấp (4 giờ)', high: 'Cao (1 ngày)', normal: 'Bình thường (3 ngày)', low: 'Thấp (7 ngày)' }
const PRIORITY_SHORT: Record<string, string> = { urgent: 'Khẩn cấp', high: 'Cao', normal: 'Bình thường', low: 'Thấp' }
export const STATUS: Record<string, string> = { new: 'Mới', in_progress: 'Đang xử lý', waiting_customer: 'Chờ khách hàng', resolved: 'Đã xử lý', closed: 'Đã đóng' }
const W_STATUS: Record<string, string> = { new: 'Mới', accepted: 'Đã tiếp nhận', waiting_parts: 'Chờ phụ kiện', processing: 'Đang xử lý', resolved: 'Đã xử lý', rejected: 'Từ chối', closed: 'Đóng' }
const OPEN = ['new', 'in_progress', 'waiting_customer']
const tone = (s: string) => s === 'new' ? 'info' : s === 'in_progress' ? 'warn' : s === 'waiting_customer' ? 'new' : s === 'resolved' ? 'ok' : 'mute'
const pTone = (p: string) => p === 'urgent' ? 'bad' : p === 'high' ? 'warn' : p === 'normal' ? 'info' : 'mute'
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const name = (p: { full_name: string | null; email: string | null } | null | undefined) => p ? p.full_name || p.email || '—' : '—'
const overdue = (t: Ticket) => OPEN.includes(t.status) && !!t.due_at && new Date(t.due_at) < new Date()
function dueText(t: Ticket) {
  if (!t.due_at || !OPEN.includes(t.status)) return '—'
  const h = Math.round((new Date(t.due_at).getTime() - Date.now()) / 3600000)
  if (h < 0) return `Quá hạn ${-h < 48 ? -h + ' giờ' : Math.round(-h / 24) + ' ngày'}`
  return h < 48 ? `Còn ${h} giờ` : `Còn ${Math.round(h / 24)} ngày`
}
function errText(m: string) {
  if (/schema cache|does not exist|relation/i.test(m)) return 'Hãy chạy migration 024_platform_commerce_security_support.sql trên Supabase.'
  if (/row-level security|Chỉ KDI/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.'
  return m
}

type F = 'open' | 'overdue' | 'done' | 'warranty'

export function SupportPage({ mode, orgId }: { mode: 'platform' | 'customer'; orgId: string | null }) {
  const kdi = mode === 'platform'
  const [rows, setRows] = useState<Ticket[]>([])
  const [staff, setStaff] = useState<Person[]>([])
  const [f, setF] = useState<F>('open')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')

  async function load() {
    const { data, error } = await supabase.from('support_tickets')
      .select('*, organizations(name), reporter:profiles!support_tickets_reported_by_fkey(full_name, email)')
      .order('created_at', { ascending: false }).limit(1000)
    if (error) return setMsg(errText(error.message))
    setRows((data as Ticket[]) ?? [])
  }
  useEffect(() => {
    load()
    if (kdi) (async () => {
      const p = await supabase.from('organizations').select('id').eq('is_platform', true).maybeSingle()
      if (!p.data) return
      const m = await supabase.from('memberships').select('user_id').eq('org_id', p.data.id)
      const ids = [...new Set((m.data ?? []).map((x: any) => x.user_id))]
      if (ids.length) {
        const pr = await supabase.from('profiles').select('id, full_name, email').in('id', ids).order('full_name')
        setStaff((pr.data as Person[]) ?? [])
      }
    })()
  }, [])

  const shown = rows.filter(t => (f === 'open' ? OPEN.includes(t.status) : f === 'overdue' ? overdue(t) : !OPEN.includes(t.status))
    && (!q.trim() || [t.code, t.subject, t.organizations?.name, t.description].join(' ').toLowerCase().includes(q.trim().toLowerCase())))
  const cur = rows.find(t => t.id === open) ?? null

  const openRows = rows.filter(t => OPEN.includes(t.status))
  const responded = rows.filter(t => t.first_response_at)
  const avgH = responded.length ? responded.reduce((s, t) => s + (new Date(t.first_response_at!).getTime() - new Date(t.created_at).getTime()), 0) / responded.length / 3600000 : null

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const { error } = await supabase.from('support_tickets').insert({
      org_id: orgId, category: fd.get('category'), priority: fd.get('priority'),
      subject: String(fd.get('subject') ?? '').trim(), description: String(fd.get('description') ?? '').trim() || null,
    })
    if (error) return setMsg(errText(error.message))
    setMsg(''); setInfo('Đã gửi yêu cầu. KDI sẽ phản hồi trong thời hạn theo mức ưu tiên.'); setCreating(false); load()
  }

  return (
    <>
      {kdi && <Tiles items={[
        { label: 'Đang mở', value: openRows.length },
        { label: 'Quá hạn', value: rows.filter(overdue).length, tone: rows.some(overdue) ? 'bad' : 'good' },
        { label: 'Chưa phản hồi', value: openRows.filter(t => !t.first_response_at).length, tone: openRows.some(t => !t.first_response_at) ? 'warn' : '' },
        { label: 'Phản hồi đầu tiên TB', value: avgH === null ? '—' : avgH < 1 ? `${Math.round(avgH * 60)} phút` : `${avgH.toFixed(1)} giờ` },
      ]} />}
      <div className="bar">
        <Tabs items={[['open', 'Đang mở', openRows.length], ['overdue', 'Quá hạn', rows.filter(overdue).length], ['done', 'Đã xử lý / đóng', rows.length - openRows.length],
          ...(kdi ? [['warranty', 'Bảo hành thiết bị'] as [F, string]] : [])]} value={f} onChange={v => { setF(v); setOpen(null) }} />
        <div className="plactions">
          {f !== 'warranty' && <input className="search" type="search" placeholder="Tìm mã, tiêu đề, đơn vị…" aria-label="Tìm phiếu" value={q} onChange={e => setQ(e.target.value)} />}
          {!kdi && <button className="primary" type="button" onClick={() => setCreating(true)}>+ Gửi yêu cầu hỗ trợ</button>}
        </div>
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}

      {creating && (
        <form className="panel formgrid" onSubmit={create}>
          <label className="field"><span>Loại yêu cầu</span><select name="category">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Mức ưu tiên</span><select name="priority" defaultValue="normal">{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field spanall"><span>Tiêu đề *</span><input name="subject" required maxLength={200} placeholder="Ví dụ: Giáo viên không đăng nhập được" /></label>
          <label className="field spanall"><span>Mô tả chi tiết</span><textarea name="description" rows={4} placeholder="Mô tả vấn đề, các bước đã thử, ảnh chụp màn hình (dán đường dẫn)…" /></label>
          <div className="formactions"><button className="primary" type="submit">Gửi</button> <button type="button" onClick={() => setCreating(false)}>Huỷ</button></div>
        </form>
      )}

      {f === 'warranty' ? <WarrantyList /> : (
        <div className={cur ? 'supgrid' : ''}>
          <div className="wrap">
            <table>
              <thead><tr><th>Phiếu</th>{!cur && <>{kdi && <th>Đơn vị</th>}<th>Ưu tiên</th><th>Trạng thái</th><th>Hạn xử lý</th>{kdi && <th>Người xử lý</th>}</>}</tr></thead>
              <tbody>
                {shown.map(t => (
                  <tr key={t.id} className={t.id === open ? 'selrow' : ''}>
                    <td><button type="button" className="linkbtn" onClick={() => setOpen(t.id === open ? null : t.id)}><b>{t.code}</b> · {t.subject}</button><br /><small>{CATEGORY[t.category]} · {fmt(t.created_at)}</small>
                      {cur && <p className="supmeta">{kdi && <small>{t.organizations?.name}</small>}<span className={'plbadge ' + pTone(t.priority)}>{PRIORITY_SHORT[t.priority]}</span>
                        <span className={'plbadge ' + tone(t.status)}>{STATUS[t.status]}</span><small className={overdue(t) ? 'late' : ''}>{dueText(t)}</small></p>}</td>
                    {!cur && <>{kdi && <td>{t.organizations?.name ?? '—'}<br /><small>{name(t.reporter)}</small></td>}
                    <td><span className={'plbadge ' + pTone(t.priority)}>{PRIORITY_SHORT[t.priority]}</span></td>
                    <td><span className={'plbadge ' + tone(t.status)}>{STATUS[t.status]}</span></td>
                    <td className={overdue(t) ? 'late' : ''}>{dueText(t)}</td>
                    {kdi && <td>{name(staff.find(s => s.id === t.assignee)) === '—' ? <small>Chưa giao</small> : name(staff.find(s => s.id === t.assignee))}</td>}</>}
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={cur ? 1 : kdi ? 6 : 4}>{rows.length === 0 ? (kdi ? 'Chưa có phiếu hỗ trợ nào.' : 'Bạn chưa gửi yêu cầu hỗ trợ nào.') : 'Không có phiếu nào trong mục này.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {cur && <TicketDetail key={cur.id} t={cur} kdi={kdi} staff={staff} onChange={load} onClose={() => setOpen(null)} />}
        </div>
      )}
    </>
  )
}

function TicketDetail({ t, kdi, staff, onChange, onClose }: { t: Ticket; kdi: boolean; staff: Person[]; onChange: () => void; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [err, setErr] = useState('')
  const load = () => supabase.from('support_messages').select('id, body, internal, created_at, author, profiles(full_name, email)').eq('ticket_id', t.id).order('created_at')
    .then(({ data, error }) => error ? setErr(errText(error.message)) : setMsgs((data as any) ?? []))
  useEffect(() => { load() }, [t.id])

  async function patch(v: Partial<Ticket>) {
    const { error } = await supabase.from('support_tickets').update(v).eq('id', t.id)
    if (error) setErr(errText(error.message)); else { setErr(''); onChange() }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!body.trim()) return
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('support_messages').insert({ ticket_id: t.id, body: body.trim(), internal: kdi && internal, author: u.user?.id })
    if (error) return setErr(errText(error.message))
    setBody(''); setInternal(false); setErr(''); load(); onChange()
  }

  return (
    <section className="panel supdetail" aria-label={'Phiếu ' + t.code}>
      <div className="bar"><h3>{t.code} · {t.subject}</h3><button type="button" className="linkbtn" onClick={onClose}>Đóng ✕</button></div>
      <p className="sub">{t.organizations?.name} · {name(t.reporter)} · gửi {fmt(t.created_at)} · {CATEGORY[t.category]}</p>
      {t.description && <p className="supdesc">{t.description}</p>}
      {kdi ? (
        <div className="formgrid">
          <label className="field"><span>Trạng thái</span><select value={t.status} onChange={e => patch({ status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Mức ưu tiên</span><select value={t.priority} onChange={e => patch({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Người xử lý</span><select value={t.assignee ?? ''} onChange={e => patch({ assignee: e.target.value || null })}>
            <option value="">Chưa giao</option>{staff.map(s => <option key={s.id} value={s.id}>{name(s)}</option>)}</select></label>
        </div>
      ) : (
        <p className="plactions">
          <span className={'plbadge ' + tone(t.status)}>{STATUS[t.status]}</span>
          {OPEN.includes(t.status) || t.status === 'resolved'
            ? <button type="button" onClick={() => patch({ status: 'closed' })}>Đóng phiếu</button>
            : <button type="button" onClick={() => patch({ status: 'in_progress' })}>Mở lại</button>}
        </p>
      )}
      <p className="sub">Hạn xử lý: <b className={overdue(t) ? 'late' : ''}>{fmt(t.due_at)}</b>{t.first_response_at && <> · phản hồi đầu tiên {fmt(t.first_response_at)}</>}{t.resolved_at && <> · xử lý xong {fmt(t.resolved_at)}</>}</p>
      <ul className="thread">
        {msgs.map(m => (
          <li key={m.id} className={m.internal ? 'internal' : ''}>
            <small><b>{name(m.profiles)}</b> · {fmt(m.created_at)}{m.internal && ' · Ghi chú nội bộ (khách hàng không thấy)'}</small>
            <p>{m.body}</p>
          </li>
        ))}
        {msgs.length === 0 && <li><small>Chưa có trao đổi.</small></li>}
      </ul>
      <form onSubmit={send} className="replybox">
        <textarea rows={3} value={body} onChange={e => setBody(e.target.value)} placeholder={kdi ? 'Trả lời khách hàng…' : 'Bổ sung thông tin cho KDI…'} aria-label="Nội dung trả lời" />
        <div className="bar">
          {kdi ? <label className="field inline"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Ghi chú nội bộ</label> : <span />}
          <button className="primary" type="submit" disabled={!body.trim()}>{kdi && internal ? 'Lưu ghi chú' : 'Gửi'}</button>
        </div>
      </form>
      {err && <p className="msg">{err}</p>}
    </section>
  )
}

// KDI xử lý phiếu bảo hành thiết bị của mọi trường
function WarrantyList() {
  const [rows, setRows] = useState<Warranty[]>([])
  const [err, setErr] = useState('')
  const [show, setShow] = useState<'open' | 'all'>('open')
  const load = () => supabase.from('warranty_tickets')
    .select('id, code, description, status, provider_status, technician, created_at, organizations(name), equipment_units(serial, equipment_types(name))')
    .neq('status', 'draft').order('created_at', { ascending: false }).limit(1000)
    .then(({ data, error }) => error ? setErr(errText(error.message)) : setRows((data as any) ?? []))
  useEffect(() => { load() }, [])
  async function patch(w: Warranty, v: Partial<Warranty>) {
    const { error } = await supabase.from('warranty_tickets').update(v).eq('id', w.id)
    if (error) setErr(errText(error.message)); else { setErr(''); load() }
  }
  const openSet = ['new', 'accepted', 'waiting_parts', 'processing']
  const shown = useMemo(() => rows.filter(w => show === 'all' || openSet.includes(w.status)), [rows, show])
  return (
    <>
      <div className="bar">
        <Tabs items={[['open', 'Cần xử lý', rows.filter(w => openSet.includes(w.status)).length], ['all', 'Tất cả', rows.length]]} value={show} onChange={setShow} />
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Phiếu</th><th>Trường</th><th>Thiết bị</th><th>KDI tiếp nhận</th><th>Kỹ thuật viên</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {shown.map(w => (
              <tr key={w.id}>
                <td><b>{w.code ?? '—'}</b><br /><small>{w.description}</small></td>
                <td>{w.organizations?.name ?? '—'}<br /><small>{fmt(w.created_at)}</small></td>
                <td>{w.equipment_units?.equipment_types?.name ?? '—'}<br /><small>{w.equipment_units?.serial}</small></td>
                <td><select aria-label="KDI tiếp nhận" value={w.provider_status} onChange={e => patch(w, { provider_status: e.target.value })}><option value="pending">Chờ tiếp nhận</option><option value="accepted">Đã tiếp nhận</option></select></td>
                <td><input className="cellinput" aria-label="Kỹ thuật viên" defaultValue={w.technician ?? ''} onBlur={e => e.target.value !== (w.technician ?? '') && patch(w, { technician: e.target.value || null })} placeholder="Tên kỹ thuật viên" /></td>
                <td><select aria-label="Trạng thái bảo hành" value={w.status} onChange={e => patch(w, { status: e.target.value })}>{Object.entries(W_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}>Không có phiếu bảo hành cần xử lý.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function PlatformSupport({ orgId }: { orgId: string | null }) { return <SupportPage mode="platform" orgId={orgId} /> }
export function CustomerSupport({ orgId }: { orgId: string | null }) { return <SupportPage mode="customer" orgId={orgId} /> }
