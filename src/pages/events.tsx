import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx } from '../lib/sheet'
import { Tabs } from './teacher/common'

// Sự kiện STEM (migration 050): đơn vị tổ chức (trường / Sở / KDI) tạo – công bố – nhận đăng ký – điểm danh;
// học sinh, giáo viên, phụ huynh xem và đăng ký.
type Ev = { id: string; org_id: string; title: string; kind: string; description: string | null; starts_at: string; ends_at: string | null; location: string | null; room_id: string | null
  audience: string[]; include_children: boolean; registration: boolean; capacity: number | null; reg_deadline: string | null; status: 'draft' | 'published' | 'cancelled'; organizations?: { name: string } | null }
type Reg = { id: string; event_id: string; full_name: string; role: string; status: string; note: string | null; created_at: string; student_id: string | null; organizations: { name: string } | null; students: { student_code: string | null; classes: { name: string } | null } | null }
type Mine = { id: string; title: string; kind: string; description: string | null; starts_at: string; ends_at: string | null; location: string | null; organizer: string; audience: string[]
  registration: boolean; capacity: number | null; reg_deadline: string | null; registered: number; my_regs: { student_id: string | null; status: string; name: string }[] }
export const KIND: Record<string, string> = { festival: 'Ngày hội', exhibition: 'Triển lãm', competition: 'Cuộc thi', workshop: 'Hội thảo / tập huấn', field_trip: 'Tham quan, trải nghiệm', other: 'Khác' }
const AUD: Record<string, string> = { student: 'Học sinh', teacher: 'Giáo viên', parent: 'Phụ huynh', staff: 'Cán bộ' }
const ST: Record<string, [string, string]> = { draft: ['Nháp', 'mute'], published: ['Đã công bố', 'ok'], cancelled: ['Đã huỷ', 'bad'] }
const RS: Record<string, [string, string]> = { registered: ['Đã đăng ký', 'mute'], attended: ['Có mặt', 'ok'], absent: ['Vắng', 'bad'], cancelled: ['Đã huỷ', 'mute'] }
const when = (d: string | null) => (d ? new Date(d).toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const local = (d: string | null) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const iso = (v: string) => (v ? new Date(v).toISOString() : null)
const val = (d: string | null | undefined) => (!d ? '' : /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(d) ? d : local(d))
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 050 trên Supabase.' : /row-level/i.test(m) ? 'Chỉ quản trị đơn vị tổ chức sửa được sự kiện.' : m)

// ================= Quản lý (trường / Sở / KDI) =================
export function EventManager({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Ev[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState<Partial<Ev> | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [regs, setRegs] = useState<Reg[]>([])
  const [tab, setTab] = useState<'up' | 'past' | 'all'>('up')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  async function load() {
    const [e, r, c] = await Promise.all([
      supabase.from('events').select('*, organizations(name)').order('starts_at', { ascending: false }),
      orgId ? supabase.from('stem_rooms').select('id, name').eq('org_id', orgId).order('name') : Promise.resolve({ data: [] }),
      supabase.from('event_registrations').select('event_id').in('status', ['registered', 'attended']),
    ])
    if (e.error) setMsg([errText(e.error.message), true])
    setRows((e.data as Ev[]) ?? []); setRooms(((r as any).data as any[]) ?? [])
    const m: Record<string, number> = {}; (((c as any).data as { event_id: string }[]) ?? []).forEach(x => (m[x.event_id] = (m[x.event_id] ?? 0) + 1)); setCounts(m)
  }
  async function loadRegs(id: string) {
    const { data } = await supabase.from('event_registrations').select('*, organizations(name), students(student_code, classes(name))').eq('event_id', id).order('created_at')
    setRegs((data as unknown as Reg[]) ?? [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (open) loadRegs(open) }, [open])
  const now = Date.now()
  const shown = rows.filter(e => tab === 'all' || (tab === 'up' ? new Date(e.ends_at ?? e.starts_at).getTime() >= now - 86400000 : new Date(e.ends_at ?? e.starts_at).getTime() < now - 86400000))
  const mine = (e: Ev) => e.org_id === orgId
  async function save(publish: boolean) {
    if (!form || !orgId) return
    if (!form.title?.trim() || !form.starts_at) return setMsg(['Cần tên và thời gian bắt đầu.', true])
    if (!form.audience?.length) return setMsg(['Chọn ít nhất một đối tượng.', true])
    const row = { org_id: orgId, title: form.title.trim(), kind: form.kind ?? 'festival', description: form.description?.trim() || null, starts_at: iso(form.starts_at), ends_at: form.ends_at ? iso(form.ends_at) : null,
      location: form.location?.trim() || null, room_id: form.room_id || null, audience: form.audience, include_children: !!form.include_children, registration: !!form.registration,
      capacity: form.registration && form.capacity ? Number(form.capacity) : null, reg_deadline: form.registration && form.reg_deadline ? iso(form.reg_deadline) : null,
      status: publish ? 'published' : form.status ?? 'draft' }
    const { error } = form.id ? await supabase.from('events').update(row).eq('id', form.id) : await supabase.from('events').insert(row)
    if (error) return setMsg([errText(error.message), true])
    setForm(null); setMsg([publish ? 'Đã công bố — người thuộc đối tượng ở trường nhận thông báo.' : 'Đã lưu.', false]); load()
  }
  async function setStatus(e: Ev, status: Ev['status']) {
    if (status === 'cancelled' && !confirm(`Huỷ sự kiện "${e.title}"?`)) return
    const { error } = await supabase.from('events').update({ status }).eq('id', e.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function mark(r: Reg, status: string) {
    const { error } = await supabase.from('event_registrations').update({ status }).eq('id', r.id)
    if (error) return setMsg([errText(error.message), true]); loadRegs(r.event_id); load()
  }
  function excel(e: Ev) {
    downloadXlsx(`dang-ky-${e.title}`, [{ key: 'n', label: 'Họ tên', width: 26 }, { key: 'r', label: 'Đối tượng' }, { key: 'c', label: 'Lớp' }, { key: 'o', label: 'Đơn vị', width: 26 }, { key: 's', label: 'Trạng thái' }, { key: 't', label: 'Đăng ký lúc', width: 18 }],
      regs.map(r => [r.full_name, AUD[r.role === 'parent' ? 'student' : r.role], r.students?.classes?.name, r.organizations?.name, RS[r.status][0], when(r.created_at)]), 'Đăng ký')
  }
  const aud = (k: string) => setForm({ ...form!, audience: form!.audience?.includes(k) ? form!.audience.filter(x => x !== k) : [...(form!.audience ?? []), k] })
  return (
    <>
      <div className="bar">
        <Tabs<'up' | 'past' | 'all'> value={tab} onChange={setTab} items={[['up', 'Sắp diễn ra'], ['past', 'Đã qua'], ['all', 'Tất cả', rows.length]]} />
        {orgId && <button className="primary" onClick={() => setForm({ kind: 'festival', audience: ['student'], registration: true, status: 'draft' })}>+ Tạo sự kiện</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={e => { e.preventDefault(); save(false) }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên sự kiện *</span><input required value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Ngày hội STEM 2026 — Sáng tạo vì cộng đồng" /></label>
          <label className="field"><span>Loại</span><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Bắt đầu *</span><input type="datetime-local" required value={val(form.starts_at)} onChange={e => setForm({ ...form, starts_at: e.target.value })} /></label>
          <label className="field"><span>Kết thúc</span><input type="datetime-local" value={val(form.ends_at)} onChange={e => setForm({ ...form, ends_at: e.target.value })} /></label>
          <label className="field"><span>Địa điểm</span><input value={form.location ?? ''} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Sân trường, nhà đa năng…" /></label>
          {rooms.length > 0 && <label className="field"><span>Phòng STEM</span><select value={form.room_id ?? ''} onChange={e => setForm({ ...form, room_id: e.target.value || null })}><option value="">—</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
          <div className="field" style={{ gridColumn: '1 / -1' }}><span>Đối tượng *</span><span className="tools">{Object.entries(AUD).map(([k, v]) => <label key={k} className={'chipbtn' + (form.audience?.includes(k) ? ' on' : '')}><input type="checkbox" checked={!!form.audience?.includes(k)} onChange={() => aud(k)} style={{ marginRight: 6 }} />{v}</label>)}</span></div>
          <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={!!form.include_children} onChange={e => setForm({ ...form, include_children: e.target.checked })} /> Mở cho cả đơn vị trực thuộc (Sở / Phòng tổ chức cho các trường)</label>
          <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={!!form.registration} onChange={e => setForm({ ...form, registration: e.target.checked })} /> Cần đăng ký tham gia</label>
          {form.registration && <>
            <label className="field"><span>Số lượng tối đa</span><input type="number" min={1} value={form.capacity ?? ''} onChange={e => setForm({ ...form, capacity: e.target.value ? +e.target.value : null })} placeholder="không giới hạn" /></label>
            <label className="field"><span>Hạn đăng ký</span><input type="datetime-local" value={val(form.reg_deadline)} onChange={e => setForm({ ...form, reg_deadline: e.target.value })} /></label>
          </>}
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả, nội dung, chuẩn bị</span><textarea rows={4} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <div className="formactions"><button type="submit">Lưu nháp</button> <button type="button" className="primary" onClick={() => save(true)}>{form.status === 'published' ? 'Lưu' : 'Công bố'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Sự kiện</th><th>Thời gian</th><th>Đối tượng</th><th>Đăng ký</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{shown.flatMap(e => [
          <tr key={e.id}><td><b>{e.title}</b><br /><small>{KIND[e.kind]}{e.location ? ' · ' + e.location : ''}{!mine(e) ? ' · ' + (e.organizations?.name ?? '') : ''}</small></td><td className="nowrap">{when(e.starts_at)}</td>
            <td><small>{e.audience.map(a => AUD[a]).join(', ')}{e.include_children ? ' · cả đơn vị trực thuộc' : ''}</small></td>
            <td>{e.registration ? `${counts[e.id] ?? 0}${e.capacity ? '/' + e.capacity : ''}` : <small className="sub">không cần</small>}</td>
            <td><span className={'plbadge ' + ST[e.status][1]}>{ST[e.status][0]}</span></td>
            <td className="nowrap">{e.registration && <button onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Đóng' : 'Đăng ký'}</button>}
              {mine(e) && e.status !== 'cancelled' && <> <button onClick={() => setForm(e)}>Sửa</button></>}
              {mine(e) && e.status === 'draft' && <> <button className="primary" onClick={() => setStatus(e, 'published')}>Công bố</button></>}
              {mine(e) && e.status !== 'cancelled' && <> <button onClick={() => setStatus(e, 'cancelled')}>Huỷ</button></>}</td></tr>,
          open === e.id && <tr key={e.id + 'r'}><td colSpan={6}>
            <div className="bar"><b>{regs.filter(r => r.status !== 'cancelled').length} đăng ký</b><button onClick={() => excel(e)}>Xuất Excel</button></div>
            <table><thead><tr><th>Họ tên</th><th>Lớp / đơn vị</th><th>Người đăng ký</th><th>Trạng thái</th><th>Điểm danh</th></tr></thead>
              <tbody>{regs.map(r => <tr key={r.id}><td>{r.full_name}</td><td><small>{[r.students?.classes?.name, r.organizations?.name].filter(Boolean).join(' · ')}</small></td>
                <td><small>{r.role === 'parent' ? 'Phụ huynh đăng ký' : AUD[r.role]}</small></td><td><span className={'plbadge ' + RS[r.status][1]}>{RS[r.status][0]}</span></td>
                <td className="nowrap">{r.status !== 'cancelled' && mine(e) && <><button onClick={() => mark(r, 'attended')}>Có mặt</button> <button onClick={() => mark(r, 'absent')}>Vắng</button></>}</td></tr>)}
                {!regs.length && <tr><td colSpan={5}>Chưa có ai đăng ký.</td></tr>}</tbody></table>
          </td></tr>])}
          {!shown.length && <tr><td colSpan={6}>Chưa có sự kiện.</td></tr>}</tbody>
      </table></div>
    </>
  )
}

// ================= Xem & đăng ký (HS, GV, phụ huynh) =================
export function MyEvents() {
  const [list, setList] = useState<Mine[] | null>(null)
  const [kids, setKids] = useState<{ student_id: string; full_name: string }[]>([])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [e, k] = await Promise.all([supabase.rpc('my_events'), supabase.rpc('parent_children')])
    if (e.error) setMsg([errText(e.error.message), true])
    setList((e.data as Mine[]) ?? []); setKids(((k.data as any[]) ?? []))
  }
  useEffect(() => { load() }, [])
  async function reg(ev: Mine, student: string | null, on: boolean) {
    const { error } = on ? await supabase.rpc('event_register', { p_event: ev.id, p_student: student }) : await supabase.rpc('event_unregister', { p_event: ev.id, p_student: student })
    if (error) return setMsg([error.message, true]); setMsg([on ? 'Đã đăng ký.' : 'Đã huỷ đăng ký.', false]); load()
  }
  if (!list) return <p className="sub">Đang tải…</p>
  const forKid = (ev: Mine) => kids.length > 0 && (ev.audience.includes('parent') || ev.audience.includes('student'))
  const isReg = (ev: Mine, sid: string | null) => ev.my_regs.some(r => r.student_id === sid && r.status !== 'cancelled')
  const closed = (ev: Mine) => (!!ev.reg_deadline && Date.now() > new Date(ev.reg_deadline).getTime()) || (!!ev.capacity && ev.registered >= ev.capacity)
  return (
    <>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!list.length && <p className="sub">Chưa có sự kiện sắp tới dành cho bạn.</p>}
      <div className="evlist">{list.map(ev => (
        <article key={ev.id} className="panel evcard">
          <div className="evdate"><b>{new Date(ev.starts_at).getDate()}</b><small>Th{new Date(ev.starts_at).getMonth() + 1}</small></div>
          <div>
            <h3 style={{ margin: '0 0 4px' }}>{ev.title}</h3>
            <p className="sub" style={{ margin: 0 }}>{KIND[ev.kind]} · {when(ev.starts_at)}{ev.location ? ' · ' + ev.location : ''} · {ev.organizer}</p>
            {ev.description && <p style={{ whiteSpace: 'pre-line', margin: '8px 0' }}>{ev.description}</p>}
            {ev.registration ? <div className="tools" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <small className="sub">{ev.registered}{ev.capacity ? '/' + ev.capacity : ''} đã đăng ký{ev.reg_deadline ? ` · hạn ${when(ev.reg_deadline)}` : ''}</small>
              {forKid(ev) ? kids.map(k => isReg(ev, k.student_id)
                  ? <button key={k.student_id} onClick={() => reg(ev, k.student_id, false)}>✓ {k.full_name} — huỷ</button>
                  : <button key={k.student_id} className="primary" disabled={closed(ev)} onClick={() => reg(ev, k.student_id, true)}>Đăng ký cho {k.full_name}</button>)
                : isReg(ev, ev.my_regs.find(r => r.status !== 'cancelled')?.student_id ?? null) || ev.my_regs.some(r => r.status !== 'cancelled')
                  ? <button onClick={() => reg(ev, null, false)}>✓ Đã đăng ký — huỷ</button>
                  : <button className="primary" disabled={closed(ev)} onClick={() => reg(ev, null, true)}>{closed(ev) ? 'Đã đóng đăng ký' : 'Đăng ký tham gia'}</button>}
            </div> : <small className="sub">Không cần đăng ký.</small>}
          </div>
        </article>))}</div>
    </>
  )
}
