import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { fmtTime } from './data'

// Danh mục gói STEM của KDI + xử lý đơn đặt gói (migration 025)
// Gói danh mục = stem_packages thuộc đơn vị chủ nền tảng. "Đã giao" sao chép gói (chủ đề, buổi học) vào trường.

type Pkg = { id: string; org_id: string; code: string | null; name: string; tier: string; programs: string | null; grades: string | null
  topics: number | null; devices: number | null; sessions: number | null; catalog_active: boolean | null; list_price: number | null; description: string | null; source_package_id: string | null }
type Topic = { id: string; seq: number; program: string | null; title: string; minutes: number | null; package_topic_sessions: { id: string; seq: number; title: string; minutes: number | null }[] }
type Order = { id: string; org_id: string; name: string; tier: string; programs: string | null; grades: string | null; quantity: number; budget: number | null; note: string | null
  status: string; created_at: string; catalog_package_id: string | null; fulfillment: string | null; kdi_note: string | null; quoted_value: number | null
  delivered_at: string | null; delivered_package_id: string | null; organizations: { name: string } | null }

export const TIER: Record<string, string> = { basic: 'Cơ bản', advanced: 'Nâng cao', premium: 'Premium' }
const PROGRAMS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5']
const money = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('vi-VN') + ' đ'
const num = (v: FormDataEntryValue | null) => { const s = String(v ?? '').replace(/\D/g, ''); return s ? Number(s) : null }
function errText(m: string) {
  if (/schema cache|does not exist|column|function/i.test(m)) return 'Hãy chạy migration 025_platform_wave2_rollout_catalog_broadcast.sql trên Supabase.'
  if (/row-level security/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.'
  return m
}
function usePlatformOrg() {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => { supabase.from('organizations').select('id').eq('is_platform', true).maybeSingle().then(({ data }) => setId((data as any)?.id ?? null)) }, [])
  return id
}

// ===== Chương trình giáo dục: danh mục gói STEM của KDI =====
export function PlatformCatalog() {
  const kdi = usePlatformOrg()
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [used, setUsed] = useState<Map<string, number>>(new Map())
  const [edit, setEdit] = useState<Pkg | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [f, setF] = useState<'active' | 'inactive' | 'all'>('active')
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')

  async function load() {
    if (!kdi) return
    const [p, u, t] = await Promise.all([
      supabase.from('stem_packages').select('*').eq('org_id', kdi).order('name'),
      supabase.from('stem_packages').select('source_package_id').not('source_package_id', 'is', null).neq('org_id', kdi),
      supabase.from('package_topics').select('package_id, package_topic_sessions(id)').eq('org_id', kdi),
    ])
    if (p.error) return setMsg(errText(p.error.message))
    // Đếm chủ đề / buổi theo nội dung thật thay vì số ghi trên gói
    const cnt = new Map<string, [number, number]>()
    ;((t.data as any[]) ?? []).forEach(x => { const c = cnt.get(x.package_id) ?? [0, 0]; cnt.set(x.package_id, [c[0] + 1, c[1] + (x.package_topic_sessions?.length ?? 0)]) })
    setPkgs(((p.data as Pkg[]) ?? []).map(x => t.error ? x : { ...x, topics: cnt.get(x.id)?.[0] ?? 0, sessions: cnt.get(x.id)?.[1] ?? 0 }))
    const m = new Map<string, number>(); ((u.data as any[]) ?? []).forEach(x => m.set(x.source_package_id, (m.get(x.source_package_id) ?? 0) + 1)); setUsed(m)
  }
  useEffect(() => { load() }, [kdi])

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!kdi) return
    const fd = new FormData(e.currentTarget)
    const v = (k: string) => String(fd.get(k) ?? '').trim() || null
    const row = { org_id: kdi, code: v('code'), name: v('name')!, tier: v('tier')!, programs: fd.getAll('programs').join(',') || null, grades: v('grades'),
      devices: num(fd.get('devices')), list_price: num(fd.get('price')), description: v('description'), catalog_active: fd.get('active') === 'on', provider: 'KDI Education' }
    const r = edit === 'new' ? await supabase.from('stem_packages').insert(row).select('id').single() : await supabase.from('stem_packages').update(row).eq('id', (edit as Pkg).id).select('id').single()
    if (r.error) return setMsg(errText(r.error.message))
    setMsg(''); setInfo(`Đã lưu gói ${row.name}.`); setEdit(null); if (edit === 'new') setOpen((r.data as any).id); load()
  }

  const shown = pkgs.filter(p => f === 'all' || (f === 'active' ? p.catalog_active : !p.catalog_active))
  const e0 = edit && edit !== 'new' ? edit : null
  return (
    <>
      <p className="plnote" role="note"><b>Danh mục gói</b> Các trường chọn gói ở đây khi lập đề xuất mua gói. Khi KDI chuyển đơn đã duyệt sang “Đã giao”, gói (kèm chủ đề, buổi học) được sao chép vào mục Gói STEM của trường.</p>
      <Tiles items={[
        { label: 'Gói đang bán', value: pkgs.filter(p => p.catalog_active).length, tone: 'good' },
        { label: 'Chủ đề', value: pkgs.reduce((s, p) => s + (p.topics ?? 0), 0), sub: `${pkgs.reduce((s, p) => s + (p.sessions ?? 0), 0)} buổi học` },
        { label: 'Lượt đã giao cho trường', value: [...used.values()].reduce((s, n) => s + n, 0) },
        { label: 'Gói chưa có chủ đề', value: pkgs.filter(p => p.catalog_active && !p.topics).length, sub: 'trường sẽ nhận gói rỗng', tone: pkgs.some(p => p.catalog_active && !p.topics) ? 'warn' : '' },
      ]} />
      <div className="bar">
        <Tabs items={[['active', 'Đang bán', pkgs.filter(p => p.catalog_active).length], ['inactive', 'Ngừng bán', pkgs.filter(p => !p.catalog_active).length], ['all', 'Tất cả', pkgs.length]]} value={f} onChange={setF} />
        <button className="primary" type="button" onClick={() => setEdit('new')} disabled={!kdi}>+ Thêm gói</button>
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      {edit && (
        <form className="panel formgrid" onSubmit={save} key={e0?.id ?? 'new'}>
          <label className="field"><span>Mã gói</span><input name="code" defaultValue={e0?.code ?? ''} placeholder="GOI-004" /></label>
          <label className="field spanall"><span>Tên gói *</span><input name="name" required defaultValue={e0?.name ?? ''} /></label>
          <label className="field"><span>Loại</span><select name="tier" defaultValue={e0?.tier ?? 'basic'}>{Object.entries(TIER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Khối</span><input name="grades" defaultValue={e0?.grades ?? ''} placeholder="6–9" /></label>
          <label className="field"><span>Số thiết bị</span><input name="devices" inputMode="numeric" defaultValue={e0?.devices ?? ''} /></label>
          <label className="field"><span>Giá niêm yết (đồng)</span><input name="price" inputMode="numeric" defaultValue={e0?.list_price ?? ''} /></label>
          <fieldset className="spanall modpick"><legend>Chương trình</legend>
            {PROGRAMS.map(c => <label key={c} className="field inline"><input type="checkbox" name="programs" value={c} defaultChecked={(e0?.programs ?? '').split(',').includes(c)} /> {c}</label>)}
          </fieldset>
          <label className="field spanall"><span>Mô tả</span><textarea name="description" rows={2} defaultValue={e0?.description ?? ''} /></label>
          <label className="field inline"><input name="active" type="checkbox" defaultChecked={e0?.catalog_active ?? true} /> Đang bán</label>
          <div className="formactions"><button className="primary" type="submit">Lưu gói</button> <button type="button" onClick={() => setEdit(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap">
        <table>
          <thead><tr><th>Gói</th><th>Chương trình · Khối</th><th>Nội dung</th><th>Giá niêm yết</th><th>Đã giao</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {shown.map(p => <Fragment key={p.id}>
              <tr className={open === p.id ? 'selrow' : ''}>
                <td><b>{p.name}</b><br /><small>{p.code ?? '—'} · {TIER[p.tier] ?? p.tier}</small></td>
                <td>{p.programs ?? '—'}<br /><small>Khối {p.grades ?? '—'}</small></td>
                <td>{p.topics ?? 0} chủ đề · {p.sessions ?? 0} buổi<br /><small>{p.devices ?? 0} thiết bị</small></td>
                <td>{money(p.list_price)}</td>
                <td>{used.get(p.id) ?? 0} trường</td>
                <td><span className={'plbadge ' + (p.catalog_active ? 'ok' : 'mute')}>{p.catalog_active ? 'Đang bán' : 'Ngừng bán'}</span></td>
                <td className="nowrap"><button type="button" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Đóng' : 'Chủ đề'}</button> <button type="button" onClick={() => setEdit(p)}>Sửa</button></td>
              </tr>
              {open === p.id && <tr><td colSpan={7}><TopicEditor pkg={p} onChange={load} /></td></tr>}
            </Fragment>)}
            {shown.length === 0 && <tr><td colSpan={7}>{pkgs.length ? 'Không có gói trong mục này.' : 'Danh mục trống. Bấm “Thêm gói”.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Chủ đề và buổi học của một gói danh mục; cập nhật lại số chủ đề/buổi trên gói
function TopicEditor({ pkg, onChange }: { pkg: Pkg; onChange: () => void }) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [err, setErr] = useState('')
  async function load() {
    const { data, error } = await supabase.from('package_topics').select('id, seq, program, title, minutes, package_topic_sessions(id, seq, title, minutes)').eq('package_id', pkg.id).order('seq')
    if (error) return setErr(errText(error.message))
    const t = ((data as Topic[]) ?? []).map(x => ({ ...x, package_topic_sessions: [...x.package_topic_sessions].sort((a, b) => a.seq - b.seq) }))
    setTopics(t); return t
  }
  useEffect(() => { load() }, [pkg.id])
  async function recount() {
    const t = await load(); if (!t) return
    await supabase.from('stem_packages').update({ topics: t.length, sessions: t.reduce((s, x) => s + x.package_topic_sessions.length, 0) }).eq('id', pkg.id)
    onChange()
  }
  async function addTopic(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const form = e.currentTarget
    const { error } = await supabase.from('package_topics').insert({ org_id: pkg.org_id, package_id: pkg.id, seq: (topics[topics.length - 1]?.seq ?? 0) + 1,
      program: String(fd.get('program')), title: String(fd.get('title')).trim(), minutes: num(fd.get('minutes')) ?? 90 })
    if (error) return setErr(errText(error.message))
    form.reset(); setErr(''); recount()
  }
  async function addSession(t: Topic, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const form = e.currentTarget
    const { error } = await supabase.from('package_topic_sessions').insert({ org_id: pkg.org_id, topic_id: t.id, seq: (t.package_topic_sessions[t.package_topic_sessions.length - 1]?.seq ?? 0) + 1,
      title: String(fd.get('title')).trim(), minutes: num(fd.get('minutes')) ?? 45 })
    if (error) return setErr(errText(error.message))
    form.reset(); setErr(''); recount()
  }
  async function del(table: 'package_topics' | 'package_topic_sessions', id: string, label: string) {
    if (!confirm(`Xoá ${label}?`)) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) return setErr(errText(error.message))
    recount()
  }
  return (
    <div className="topiced">
      {err && <p className="msg">{err}</p>}
      <ol>
        {topics.map(t => (
          <li key={t.id}>
            <div className="bar"><span><span className="plbadge info">{t.program ?? '—'}</span> <b>{t.title}</b> <small>{t.package_topic_sessions.length} buổi</small></span>
              <button type="button" className="linkbtn" onClick={() => del('package_topics', t.id, 'chủ đề ' + t.title)}>Xoá chủ đề</button></div>
            <ul>
              {t.package_topic_sessions.map(s => <li key={s.id}>Buổi {s.seq}: {s.title} <small>{s.minutes ?? 45} phút</small> <button type="button" className="linkbtn" onClick={() => del('package_topic_sessions', s.id, 'buổi ' + s.title)} aria-label={'Xoá buổi ' + s.title}>✕</button></li>)}
              <li><form className="inlineform" onSubmit={e => addSession(t, e)}><input name="title" required placeholder="Tên buổi học" aria-label="Tên buổi học" /><input name="minutes" inputMode="numeric" placeholder="45" aria-label="Số phút" style={{ width: 64 }} /><button type="submit">+ Buổi</button></form></li>
            </ul>
          </li>
        ))}
        {topics.length === 0 && <li><small>Gói chưa có chủ đề.</small></li>}
      </ol>
      <form className="inlineform" onSubmit={addTopic}>
        <select name="program" aria-label="Chương trình">{PROGRAMS.map(c => <option key={c}>{c}</option>)}</select>
        <input name="title" required placeholder="Tên chủ đề mới" aria-label="Tên chủ đề" />
        <input name="minutes" inputMode="numeric" placeholder="90" aria-label="Số phút" style={{ width: 64 }} />
        <button type="submit" className="primary">+ Chủ đề</button>
      </form>
    </div>
  )
}

// ===== Đơn đặt gói STEM: KDI xử lý đơn các trường đã duyệt =====
type OF = 'todo' | 'pending' | 'delivered' | 'closed' | 'all'
const FULFILL: Record<string, [string, string]> = { confirmed: ['Đã xác nhận', 'info'], delivering: ['Đang giao', 'warn'], delivered: ['Đã giao', 'ok'], cancelled: ['Đã huỷ', 'mute'] }
const APPROVAL: Record<string, [string, string]> = { pending: ['Khách đang duyệt', 'warn'], approved: ['Khách đã duyệt', 'ok'], rejected: ['Khách từ chối', 'bad'] }

export function PlatformOrders() {
  const kdi = usePlatformOrg()
  const [rows, setRows] = useState<Order[]>([])
  const [cat, setCat] = useState<Pkg[]>([])
  const [f, setF] = useState<OF>('todo')
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  async function load() {
    const { data, error } = await supabase.from('package_orders').select('*, organizations(name)').neq('status', 'draft').order('created_at', { ascending: false }).limit(1000)
    if (error) return setMsg(errText(error.message))
    setRows((data as Order[]) ?? [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (kdi) supabase.from('stem_packages').select('*').eq('org_id', kdi).order('name').then(({ data }) => setCat((data as Pkg[]) ?? [])) }, [kdi])
  const catName = useMemo(() => new Map(cat.map(c => [c.id, c.name])), [cat])

  const todo = (o: Order) => o.status === 'approved' && (!o.fulfillment || ['confirmed', 'delivering'].includes(o.fulfillment))
  const match = (o: Order, x: OF) => x === 'todo' ? todo(o) : x === 'pending' ? o.status === 'pending' : x === 'delivered' ? o.fulfillment === 'delivered'
    : x === 'closed' ? o.fulfillment === 'cancelled' || o.status === 'rejected' : true
  const s = q.trim().toLowerCase()
  const shown = rows.filter(o => match(o, f) && (!s || [o.name, o.organizations?.name, o.programs].join(' ').toLowerCase().includes(s)))

  async function act(o: Order, fulfillment: string, form: HTMLFormElement | null) {
    const fd = form ? new FormData(form) : null
    if (fulfillment === 'delivered' && !confirm(`Giao gói cho ${o.organizations?.name}? Gói sẽ được sao chép vào mục Gói STEM của trường.`)) return
    if (fulfillment === 'cancelled' && !confirm(`Huỷ đơn “${o.name}”?`)) return
    const { error } = await supabase.rpc('platform_fulfill_order', { p_order: o.id, p_fulfillment: fulfillment,
      p_catalog: fd ? String(fd.get('catalog') || '') || null : null, p_note: fd ? String(fd.get('note') ?? '') || null : null, p_value: fd ? num(fd.get('value')) : null })
    if (error) return setMsg(errText(error.message))
    setMsg(''); setInfo(`Đã cập nhật đơn “${o.name}”: ${FULFILL[fulfillment][0]}. Trường nhận được thông báo.`); setOpen(null); load()
  }

  const value = rows.filter(o => o.fulfillment === 'delivered').reduce((s, o) => s + (o.quoted_value ?? 0), 0)
  return (
    <>
      <Tiles items={[
        { label: 'Chờ KDI xử lý', value: rows.filter(todo).length, tone: rows.some(todo) ? 'warn' : 'good' },
        { label: 'Khách đang duyệt', value: rows.filter(o => o.status === 'pending').length, sub: 'theo quy trình của trường/Sở' },
        { label: 'Đã giao', value: rows.filter(o => o.fulfillment === 'delivered').length, sub: value ? money(value) : undefined },
        { label: 'Đơn tự đề xuất', value: rows.filter(o => !o.catalog_package_id && o.status !== 'rejected').length, sub: 'chưa gắn gói danh mục' },
      ]} />
      <div className="bar">
        <Tabs items={[['todo', 'Chờ KDI xử lý', rows.filter(todo).length], ['pending', 'Khách đang duyệt', rows.filter(o => o.status === 'pending').length],
          ['delivered', 'Đã giao', rows.filter(o => o.fulfillment === 'delivered').length], ['closed', 'Huỷ / từ chối', rows.filter(o => match(o, 'closed')).length], ['all', 'Tất cả', rows.length]]}
          value={f} onChange={v => { setF(v); setOpen(null) }} />
        <input className="search" type="search" placeholder="Tìm đơn, trường…" aria-label="Tìm đơn" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Đơn</th><th>Trường</th><th>Gói danh mục</th><th>Duyệt</th><th>KDI xử lý</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {shown.map(o => <Fragment key={o.id}>
              <tr className={open === o.id ? 'selrow' : ''}>
                <td><b>{o.name}</b><br /><small>{TIER[o.tier] ?? o.tier} · SL {o.quantity}{o.programs ? ' · ' + o.programs : ''}{o.grades ? ' · Khối ' + o.grades : ''}{o.budget ? ' · dự toán ' + money(o.budget) : ''}</small></td>
                <td>{o.organizations?.name ?? '—'}<br /><small>{fmtTime(o.created_at)}</small></td>
                <td>{o.catalog_package_id ? catName.get(o.catalog_package_id) ?? '—' : <small>Tự đề xuất</small>}</td>
                <td>{APPROVAL[o.status] ? <span className={'plbadge ' + APPROVAL[o.status][1]}>{APPROVAL[o.status][0]}</span> : o.status}</td>
                <td>{o.fulfillment ? <span className={'plbadge ' + FULFILL[o.fulfillment][1]}>{FULFILL[o.fulfillment][0]}</span> : o.status === 'approved' ? <span className="plbadge warn">Chưa xử lý</span> : <small>—</small>}
                  {o.quoted_value ? <><br /><small>{money(o.quoted_value)}</small></> : null}</td>
                <td>{todo(o) && <button type="button" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? 'Đóng' : 'Xử lý'}</button>}</td>
              </tr>
              {open === o.id && (
                <tr><td colSpan={6}>
                  <form className="formgrid" onSubmit={e => e.preventDefault()} id={'f-' + o.id}>
                    {o.note && <p className="spanall sub">Ghi chú của trường: {o.note}</p>}
                    <label className="field spanall"><span>Gói danh mục sẽ giao</span><select name="catalog" defaultValue={o.catalog_package_id ?? ''}>
                      <option value="">Chọn gói…</option>{cat.filter(c => c.catalog_active || c.id === o.catalog_package_id).map(c => <option key={c.id} value={c.id}>{c.name} · {c.topics ?? 0} chủ đề</option>)}</select></label>
                    <label className="field"><span>Giá KDI báo (đồng)</span><input name="value" inputMode="numeric" defaultValue={o.quoted_value ?? ''} /></label>
                    <label className="field spanall"><span>Ghi chú gửi trường</span><input name="note" defaultValue={o.kdi_note ?? ''} placeholder="Lịch giao, người liên hệ…" /></label>
                    <div className="formactions plactions spanall">
                      {!o.fulfillment && <button type="button" onClick={e => act(o, 'confirmed', e.currentTarget.form)}>Xác nhận đơn</button>}
                      {o.fulfillment !== 'delivering' && <button type="button" onClick={e => act(o, 'delivering', e.currentTarget.form)}>Đang giao</button>}
                      <button type="button" className="primary" onClick={e => act(o, 'delivered', e.currentTarget.form)}>Đã giao (tạo gói cho trường)</button>
                      <button type="button" onClick={e => act(o, 'cancelled', e.currentTarget.form)}>Huỷ đơn</button>
                    </div>
                  </form>
                </td></tr>
              )}
            </Fragment>)}
            {shown.length === 0 && <tr><td colSpan={6}>Không có đơn nào trong mục này.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
