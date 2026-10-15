import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { usePlatform, pathOf, ORG_TYPE, type Org } from './data'

// Khách hàng, gói dịch vụ, hợp đồng (migration 024)

type Cust = { id: string; customer_status: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null; customer_note: string | null }
type Ent = { org_id: string; state: 'open' | 'active' | 'expired'; source_org: string | null; contract_code: string | null; plan_name: string | null; modules: string[] | null; ends_on: string | null }
type Module = { key: string; name: string; description: string | null; sort: number }
type Plan = { id: string; code: string; name: string; description: string | null; modules: string[]; price_per_year: number | null; active: boolean }
type Contract = { id: string; code: string; org_id: string; plan_id: string; starts_on: string; ends_on: string | null; value: number | null
  status: string; include_children: boolean; note: string | null; created_at: string }

export const CUSTOMER_STATUS: Record<string, string> = { prospect: 'Tiềm năng', negotiating: 'Đàm phán', active: 'Đang dùng', paused: 'Tạm dừng', ended: 'Đã kết thúc' }
const CS_TONE: Record<string, string> = { prospect: 'mute', negotiating: 'info', active: 'ok', paused: 'warn', ended: 'mute' }
const C_STATUS: Record<string, string> = { draft: 'Nháp', active: 'Hiệu lực', suspended: 'Tạm dừng', ended: 'Kết thúc' }
const money = (n: number | null) => n === null ? '—' : n.toLocaleString('vi-VN') + ' đ'
const day = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('vi-VN') : '—'
const daysLeft = (d: string | null) => d ? Math.ceil((new Date(d + 'T23:59:59').getTime() - Date.now()) / 86400000) : null
function errText(m: string) {
  if (/schema cache|does not exist|relation|column/i.test(m)) return 'Hãy chạy migration 024_platform_commerce_security_support.sql trên Supabase.'
  if (/contracts_code_key|service_plans_code_key/i.test(m)) return 'Mã đã tồn tại.'
  if (/row-level security/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.'
  if (/contracts_check|ends_on/i.test(m)) return 'Ngày kết thúc phải sau ngày bắt đầu.'
  return m
}
// Trạng thái thực tế của hợp đồng theo ngày
function liveState(c: Contract) {
  if (c.status !== 'active') return c.status
  const today = new Date().toISOString().slice(0, 10)
  if (today < c.starts_on) return 'upcoming'
  if (c.ends_on && today > c.ends_on) return 'expired'
  return 'active'
}
const LIVE: Record<string, [string, string]> = { active: ['Hiệu lực', 'ok'], upcoming: ['Chưa tới ngày', 'info'], expired: ['Hết hạn', 'bad'], draft: ['Nháp', 'mute'], suspended: ['Tạm dừng', 'warn'], ended: ['Kết thúc', 'mute'] }

function useCommerce() {
  const p = usePlatform()
  const [cust, setCust] = useState<Map<string, Cust>>(new Map())
  const [ents, setEnts] = useState<Map<string, Ent>>(new Map())
  const [mods, setMods] = useState<Module[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [err, setErr] = useState('')
  async function reload() {
    const [c, e, m, pl, k] = await Promise.all([
      supabase.from('organizations').select('id, customer_status, contact_name, contact_phone, contact_email, customer_note'),
      supabase.rpc('platform_entitlements'),
      supabase.from('service_modules').select('key, name, description, sort').order('sort'),
      supabase.from('service_plans').select('*').order('name'),
      supabase.from('contracts').select('*').order('created_at', { ascending: false }),
    ])
    const bad = [c, e, m, pl, k].find(x => x.error)
    setErr(bad ? errText(bad.error!.message) : '')
    setCust(new Map(((c.data as Cust[]) ?? []).map(x => [x.id, x])))
    setEnts(new Map(((e.data as Ent[]) ?? []).map(x => [x.org_id, x])))
    setMods((m.data as Module[]) ?? []); setPlans((pl.data as Plan[]) ?? []); setContracts((k.data as Contract[]) ?? [])
  }
  useEffect(() => { reload() }, [])
  const byId = useMemo(() => new Map(p.orgs.map(o => [o.id, o])), [p.orgs])
  const label = (id: string) => pathOf(id, byId).map(o => o.name).join(' › ')
  return { ...p, cust, ents, mods, plans, contracts, err: p.err || err, reloadAll: () => { p.reload(); reload() }, byId, label }
}

function EntBadge({ e, byId, self }: { e: Ent | undefined; byId: Map<string, Org>; self: string }) {
  if (!e) return <small>—</small>
  if (e.state === 'open') return <><span className="plbadge mute">Chưa có hợp đồng</span><br /><small>Đang dùng không giới hạn</small></>
  const left = daysLeft(e.ends_on)
  const src = e.source_org && e.source_org !== self ? byId.get(e.source_org)?.name : null
  return (
    <>
      <span className={'plbadge ' + (e.state === 'expired' ? 'bad' : left !== null && left <= 60 ? 'warn' : 'ok')}>
        {e.state === 'expired' ? 'Hết hiệu lực' : e.plan_name}</span>
      <br /><small>{e.contract_code}{src ? ` · theo ${src}` : ''}{e.state === 'active' && e.ends_on ? ` · đến ${day(e.ends_on)}` : ''}</small>
    </>
  )
}

// ===== Thông tin khách hàng =====
type CF = 'customers' | 'open' | 'soon' | 'expired' | 'all'
export function PlatformCustomers() {
  const d = useCommerce()
  const [f, setF] = useState<CF>('customers')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  if (d.loading) return <p className="sub">Đang tải…</p>
  if (d.err) return <p className="msg">{d.err}</p>

  const orgs = d.orgs.filter(o => o.type !== 'provider')
  const ownContract = new Set(d.contracts.map(c => c.org_id))
  const isCustomer = (o: Org) => !!d.cust.get(o.id)?.customer_status || ownContract.has(o.id)
  const ent = (o: Org) => d.ents.get(o.id)
  const soon = (o: Org) => { const e = ent(o); const l = daysLeft(e?.ends_on ?? null); return e?.state === 'active' && l !== null && l <= 60 }
  const match = (o: Org, x: CF) => x === 'customers' ? isCustomer(o) : x === 'open' ? ent(o)?.state === 'open' && ['school', 'department'].includes(o.type)
    : x === 'soon' ? soon(o) : x === 'expired' ? ent(o)?.state === 'expired' : true
  const s = q.trim().toLowerCase()
  const shown = orgs.filter(o => match(o, f) && (!s || d.label(o.id).toLowerCase().includes(s) || (o.code ?? '').toLowerCase().includes(s)
    || (d.cust.get(o.id)?.contact_name ?? '').toLowerCase().includes(s)))
    .sort((a, b) => d.label(a.id).localeCompare(d.label(b.id), 'vi'))
  const schools = orgs.filter(o => o.type === 'school')

  async function save(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const v = (k: string) => String(fd.get(k) ?? '').trim() || null
    const { error } = await supabase.from('organizations').update({ customer_status: v('customer_status'), contact_name: v('contact_name'),
      contact_phone: v('contact_phone'), contact_email: v('contact_email'), customer_note: v('customer_note') }).eq('id', id)
    if (error) return setMsg(errText(error.message))
    setMsg(''); setEdit(null); d.reloadAll()
  }

  return (
    <>
      <Tiles items={[
        { label: 'Khách hàng đang dùng', value: orgs.filter(o => d.cust.get(o.id)?.customer_status === 'active').length, sub: `${orgs.filter(isCustomer).length} khách hàng trong danh sách` },
        { label: 'Trường có hợp đồng', value: schools.filter(o => ent(o)?.state === 'active').length, sub: `/ ${schools.length} trường`, tone: 'good' },
        { label: 'Sắp hết hạn (≤ 60 ngày)', value: orgs.filter(soon).length, tone: orgs.some(soon) ? 'warn' : '' },
        { label: 'Hết hiệu lực', value: orgs.filter(o => ent(o)?.state === 'expired').length, sub: 'chỉ còn phần lõi', tone: orgs.some(o => ent(o)?.state === 'expired') ? 'bad' : '' },
        { label: 'Trường chưa có hợp đồng', value: schools.filter(o => ent(o)?.state === 'open').length, sub: 'đang dùng không giới hạn' },
      ]} />
      <div className="bar">
        <Tabs items={[['customers', 'Khách hàng', orgs.filter(isCustomer).length], ['soon', 'Sắp hết hạn', orgs.filter(soon).length],
          ['expired', 'Hết hiệu lực', orgs.filter(o => ent(o)?.state === 'expired').length], ['open', 'Chưa có hợp đồng', orgs.filter(o => match(o, 'open')).length],
          ['all', 'Tất cả đơn vị', orgs.length]]} value={f} onChange={setF} />
        <input className="search" type="search" placeholder="Tìm đơn vị, mã, đầu mối…" aria-label="Tìm khách hàng" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {f === 'customers' && orgs.filter(isCustomer).length === 0 && <p className="sub">Chưa có khách hàng nào. Chọn <b>Tất cả đơn vị</b> và bấm <b>Sửa</b> để đánh dấu một Sở hoặc trường là khách hàng, hoặc tạo hợp đồng ở mục Gói dịch vụ & hợp đồng.</p>}
      {msg && <p className="msg">{msg}</p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Đơn vị</th><th>Trạng thái khách hàng</th><th>Đầu mối</th><th>Quyền dùng phân hệ</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {shown.slice(0, 400).map(o => {
              const c = d.cust.get(o.id)
              return edit === o.id ? (
                <tr key={o.id}><td colSpan={5}>
                  <form className="formgrid" onSubmit={e => save(e, o.id)}>
                    <p className="spanall"><b>{d.label(o.id)}</b></p>
                    <label className="field"><span>Trạng thái khách hàng</span><select name="customer_status" defaultValue={c?.customer_status ?? ''}>
                      <option value="">Không phải khách hàng trực tiếp</option>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label className="field"><span>Người liên hệ</span><input name="contact_name" defaultValue={c?.contact_name ?? ''} /></label>
                    <label className="field"><span>Điện thoại</span><input name="contact_phone" type="tel" defaultValue={c?.contact_phone ?? ''} /></label>
                    <label className="field"><span>Email</span><input name="contact_email" type="email" defaultValue={c?.contact_email ?? ''} /></label>
                    <label className="field spanall"><span>Ghi chú</span><textarea name="customer_note" rows={2} defaultValue={c?.customer_note ?? ''} /></label>
                    <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setEdit(null)}>Huỷ</button></div>
                  </form>
                </td></tr>
              ) : (
                <tr key={o.id}>
                  <td><b>{o.name}</b><br /><small>{ORG_TYPE[o.type]}{o.code ? ' · ' + o.code : ''} · {pathOf(o.parent_id, d.byId).map(x => x.name).join(' › ') || 'Cấp cao nhất'}</small></td>
                  <td>{c?.customer_status ? <span className={'plbadge ' + CS_TONE[c.customer_status]}>{CUSTOMER_STATUS[c.customer_status]}</span> : <small>—</small>}</td>
                  <td>{c?.contact_name ?? <small>—</small>}{(c?.contact_phone || c?.contact_email) && <><br /><small>{[c?.contact_phone, c?.contact_email].filter(Boolean).join(' · ')}</small></>}</td>
                  <td><EntBadge e={ent(o)} byId={d.byId} self={o.id} /></td>
                  <td><button type="button" onClick={() => setEdit(o.id)}>Sửa</button></td>
                </tr>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={5}>Không có đơn vị nào trong mục này.</td></tr>}
          </tbody>
        </table>
      </div>
      {shown.length > 400 && <p className="sub">Đang hiện 400/{shown.length} đơn vị. Dùng ô tìm kiếm để thu hẹp.</p>}
    </>
  )
}

// ===== Gói dịch vụ & hợp đồng =====
export function PlatformContracts() {
  const d = useCommerce()
  const [tab, setTab] = useState<'contracts' | 'plans'>('contracts')
  const [editC, setEditC] = useState<Contract | 'new' | null>(null)
  const [editP, setEditP] = useState<Plan | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  if (d.loading) return <p className="sub">Đang tải…</p>
  if (d.err) return <p className="msg">{d.err}</p>

  const planOf = (id: string) => d.plans.find(p => p.id === id)
  const modName = (k: string) => d.mods.find(m => m.key === k)?.name ?? k
  const orgOpts = d.orgs.filter(o => o.type !== 'provider').map(o => ({ id: o.id, label: d.label(o.id) })).sort((a, b) => a.label.localeCompare(b.label, 'vi'))
  const s = q.trim().toLowerCase()
  const shownC = d.contracts.filter(c => !s || [c.code, d.label(c.org_id), planOf(c.plan_id)?.name].join(' ').toLowerCase().includes(s))
  const live = d.contracts.filter(c => liveState(c) === 'active')

  async function saveContract(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const v = (k: string) => String(fd.get(k) ?? '').trim()
    const row = { code: v('code'), org_id: v('org_id'), plan_id: v('plan_id'), starts_on: v('starts_on'), ends_on: v('ends_on') || null,
      value: v('value') ? Number(v('value').replace(/\D/g, '')) : null, status: v('status'), include_children: fd.get('include_children') === 'on', note: v('note') || null }
    const { error } = editC === 'new' ? await supabase.from('contracts').insert(row) : await supabase.from('contracts').update(row).eq('id', (editC as Contract).id)
    if (error) return setMsg(errText(error.message))
    setMsg(''); setInfo(editC === 'new' ? `Đã tạo hợp đồng ${row.code}.` : `Đã cập nhật hợp đồng ${row.code}.`); setEditC(null); d.reloadAll()
  }
  async function savePlan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const v = (k: string) => String(fd.get(k) ?? '').trim()
    const row = { code: v('code').toUpperCase(), name: v('name'), description: v('description') || null, modules: fd.getAll('modules').map(String),
      price_per_year: v('price') ? Number(v('price').replace(/\D/g, '')) : null, active: fd.get('active') === 'on' }
    const { error } = editP === 'new' ? await supabase.from('service_plans').insert(row) : await supabase.from('service_plans').update(row).eq('id', (editP as Plan).id)
    if (error) return setMsg(errText(error.message))
    setMsg(''); setInfo(`Đã lưu gói ${row.name}.`); setEditP(null); d.reloadAll()
  }

  const c0 = editC && editC !== 'new' ? editC : null
  const p0 = editP && editP !== 'new' ? editP : null
  const year = new Date().getFullYear()

  return (
    <>
      <p className="plnote" role="note"><b>Cách tính quyền dùng</b> Mỗi đơn vị dùng hợp đồng gần nhất đi từ chính nó lên cấp trên (Sở mua → các trường trực thuộc được dùng nếu bật “Áp dụng cho đơn vị trực thuộc”).
        Hợp đồng còn hiệu lực → chỉ dùng các phân hệ trong gói. Hết hạn hoặc tạm dừng → chỉ còn phần lõi (tài khoản, giáo viên, lớp, học sinh). Đơn vị chưa có hợp đồng nào → không giới hạn.</p>
      <Tiles items={[
        { label: 'Hợp đồng hiệu lực', value: live.length, tone: 'good' },
        { label: 'Giá trị hợp đồng hiệu lực', value: money(live.reduce((s, c) => s + (c.value ?? 0), 0)) },
        { label: 'Hết hạn trong 60 ngày', value: live.filter(c => { const l = daysLeft(c.ends_on); return l !== null && l <= 60 }).length, tone: 'warn' },
        { label: 'Gói đang bán', value: d.plans.filter(p => p.active).length, sub: `${d.mods.length} phân hệ` },
      ]} />
      <div className="bar">
        <Tabs items={[['contracts', 'Hợp đồng', d.contracts.length], ['plans', 'Gói dịch vụ', d.plans.length]]} value={tab} onChange={v => { setTab(v); setMsg(''); setInfo('') }} />
        <div className="plactions">
          {tab === 'contracts' && <input className="search" type="search" placeholder="Tìm số HĐ, khách hàng, gói…" aria-label="Tìm hợp đồng" value={q} onChange={e => setQ(e.target.value)} />}
          {tab === 'contracts' ? <button className="primary" type="button" onClick={() => setEditC('new')}>+ Tạo hợp đồng</button>
            : <button className="primary" type="button" onClick={() => setEditP('new')}>+ Tạo gói</button>}
        </div>
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}

      {tab === 'contracts' && editC && (
        <form className="panel formgrid" onSubmit={saveContract} key={c0?.id ?? 'new'}>
          <label className="field"><span>Số hợp đồng *</span><input name="code" required defaultValue={c0?.code ?? `HĐ-${year}-`} /></label>
          <label className="field spanall"><span>Khách hàng (đơn vị) *</span><select name="org_id" required defaultValue={c0?.org_id ?? ''}>
            <option value="" disabled>Chọn đơn vị…</option>{orgOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
          <label className="field"><span>Gói dịch vụ *</span><select name="plan_id" required defaultValue={c0?.plan_id ?? d.plans.find(p => p.active)?.id}>
            {d.plans.filter(p => p.active || p.id === c0?.plan_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field"><span>Trạng thái</span><select name="status" defaultValue={c0?.status ?? 'active'}>{Object.entries(C_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Từ ngày *</span><input name="starts_on" type="date" required defaultValue={c0?.starts_on ?? new Date().toISOString().slice(0, 10)} /></label>
          <label className="field"><span>Đến ngày</span><input name="ends_on" type="date" defaultValue={c0?.ends_on ?? ''} /></label>
          <label className="field"><span>Giá trị (đồng)</span><input name="value" inputMode="numeric" defaultValue={c0?.value ?? ''} /></label>
          <label className="field inline"><input name="include_children" type="checkbox" defaultChecked={c0?.include_children ?? true} /> Áp dụng cho đơn vị trực thuộc</label>
          <label className="field spanall"><span>Ghi chú</span><textarea name="note" rows={2} defaultValue={c0?.note ?? ''} /></label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setEditC(null)}>Huỷ</button></div>
        </form>
      )}

      {tab === 'contracts' && (
        <div className="wrap">
          <table>
            <thead><tr><th>Số HĐ</th><th>Khách hàng</th><th>Gói</th><th>Hiệu lực</th><th>Giá trị</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
            <tbody>
              {shownC.map(c => {
                const st = LIVE[liveState(c)]; const l = daysLeft(c.ends_on)
                return (
                  <tr key={c.id}>
                    <td><b>{c.code}</b>{c.note && <><br /><small>{c.note}</small></>}</td>
                    <td>{d.byId.get(c.org_id)?.name ?? '—'}<br /><small>{c.include_children ? 'Áp dụng cả đơn vị trực thuộc' : 'Chỉ đơn vị này'}</small></td>
                    <td>{planOf(c.plan_id)?.name ?? '—'}</td>
                    <td>{day(c.starts_on)} – {c.ends_on ? day(c.ends_on) : 'không thời hạn'}{liveState(c) === 'active' && l !== null && l <= 60 && <><br /><small className="late">Còn {l} ngày</small></>}</td>
                    <td>{money(c.value)}</td>
                    <td><span className={'plbadge ' + st[1]}>{st[0]}</span></td>
                    <td><button type="button" onClick={() => setEditC(c)}>Sửa</button></td>
                  </tr>
                )
              })}
              {shownC.length === 0 && <tr><td colSpan={7}>{d.contracts.length ? 'Không có hợp đồng khớp.' : 'Chưa có hợp đồng nào. Bấm “Tạo hợp đồng” để bắt đầu.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'plans' && editP && (
        <form className="panel formgrid" onSubmit={savePlan} key={p0?.id ?? 'new'}>
          <label className="field"><span>Mã gói *</span><input name="code" required defaultValue={p0?.code ?? ''} placeholder="VD: TIEU-CHUAN" /></label>
          <label className="field"><span>Tên gói *</span><input name="name" required defaultValue={p0?.name ?? ''} /></label>
          <label className="field"><span>Giá / năm (đồng)</span><input name="price" inputMode="numeric" defaultValue={p0?.price_per_year ?? ''} /></label>
          <label className="field inline"><input name="active" type="checkbox" defaultChecked={p0?.active ?? true} /> Đang bán</label>
          <label className="field spanall"><span>Mô tả</span><input name="description" defaultValue={p0?.description ?? ''} /></label>
          <fieldset className="spanall modpick"><legend>Phân hệ trong gói</legend>
            {d.mods.map(m => <label key={m.key} className="field inline"><input type="checkbox" name="modules" value={m.key} defaultChecked={p0?.modules.includes(m.key)} /> <span><b>{m.name}</b><br /><small>{m.description}</small></span></label>)}
            <p className="sub spanall">Phần lõi (tài khoản, vai trò, giáo viên, lớp, học sinh, phân công, năm học, toà nhà) luôn có trong mọi gói.</p>
          </fieldset>
          <div className="formactions"><button className="primary" type="submit">Lưu gói</button> <button type="button" onClick={() => setEditP(null)}>Huỷ</button></div>
        </form>
      )}

      {tab === 'plans' && (
        <div className="plcards">
          {d.plans.map(p => (
            <div className="panel plcard" key={p.id}>
              <div className="bar"><b>{p.name}</b><span className={'plbadge ' + (p.active ? 'ok' : 'mute')}>{p.active ? 'Đang bán' : 'Ngừng bán'}</span></div>
              <small>{p.code} · {p.price_per_year === null ? 'Chưa đặt giá' : money(p.price_per_year) + ' / năm'}</small>
              {p.description && <span>{p.description}</span>}
              <ul className="modlist">{d.mods.map(m => <li key={m.key} className={p.modules.includes(m.key) ? 'on' : ''}>{p.modules.includes(m.key) ? '✓' : '–'} {modName(m.key)}</li>)}</ul>
              <small>{d.contracts.filter(c => c.plan_id === p.id && liveState(c) === 'active').length} hợp đồng hiệu lực</small>
              <button type="button" onClick={() => setEditP(p)}>Sửa gói</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
