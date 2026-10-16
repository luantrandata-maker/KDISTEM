import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/time'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { useBackClose } from '../lib/history'

type Pkg = { id: string; code: string | null; name: string; tier: string; provider: string | null; programs: string | null; grades: string | null; starts_on: string | null; ends_on: string | null; contract_no: string | null; order_no: string | null; topics: number; devices: number; sessions: number }
type Topic = { id: string; seq: number; program: string; title: string; minutes: number; grade_assigned: number | null; package_topic_sessions: { id: string; seq: number; title: string; minutes: number }[] }
type Unit = { id: string; serial: string | null; status: string; equipment_types: { name: string } | null; stem_rooms: { name: string } | null }
type Plan = { id: string; name: string; program: string | null; provider: string | null; hours: number | null }
const TIER: Record<string, string> = { premium: 'Premium', basic: 'Cơ bản', advanced: 'Nâng cao' }
const DAY = 86400000
const UNIT_ST: Record<string, string> = { available: 'Sẵn sàng', in_use: 'Đang dùng', broken: 'Hỏng', maintenance: 'Bảo trì', in_stock: 'Tồn kho' }

export default function Packages({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Pkg[]>([])
  const [form, setForm] = useState<Pkg | 'new' | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  useBackClose(!!detail, () => setDetail(null))
  const [filter, setFilter] = useState<'all' | 'active' | 'expired'>('all')
  const [q, setQ] = useState('')
  const load = () => supabase.from('stem_packages').select('*').order('starts_on').then(({ data }) => setRows((data as Pkg[]) ?? []))
  useEffect(() => { load() }, [])

  const state = (p: Pkg) => { const end = p.ends_on ? new Date(p.ends_on).getTime() : Infinity; return end < Date.now() ? 'expired' : end - Date.now() < 90 * DAY ? 'soon' : 'active' }
  async function save(v: Record<string, string>) {
    const body = { code: v.code || null, name: v.name, tier: v.tier, provider: v.provider || null, programs: v.programs || null, grades: v.grades || null,
      starts_on: v.starts_on || null, ends_on: v.ends_on || null, contract_no: v.contract_no || null, order_no: v.order_no || null,
      topics: Number(v.topics || 0), devices: Number(v.devices || 0), sessions: Number(v.sessions || 0) }
    const { error } = form && form !== 'new' ? await supabase.from('stem_packages').update(body).eq('id', form.id) : await supabase.from('stem_packages').insert({ ...body, org_id: orgId })
    if (error) return error.message
    setForm(null); load()
  }
  async function remove(p: Pkg) { if (confirm(`Xoá ${p.name}?`)) { await supabase.from('stem_packages').delete().eq('id', p.id); load() } }

  if (detail) { const p = rows.find(x => x.id === detail); if (p) return <PackageDetail pkg={p} state={state(p)} onBack={() => setDetail(null)} /> }

  const n = (s: string) => rows.filter(p => (s === 'active' ? state(p) !== 'expired' : state(p) === s)).length
  const shown = rows.filter(p => (filter === 'all' || (filter === 'active' ? state(p) !== 'expired' : state(p) === 'expired')) && (p.name + (p.contract_no ?? '') + (p.order_no ?? '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{n('active')}</strong><span>Đang hoạt động</span></div>
        <div className="card"><strong>{rows.filter(p => state(p) === 'soon').length}</strong><span>Sắp hết hạn (90 ngày)</span></div>
        <div className="card"><strong>{n('expired')}</strong><span>Chưa hoàn tất / đã hết hạn</span></div>
      </div>
      <div className="bar" style={{ margin: '16px 0' }}>
        <div className="tools"><input className="search" style={{ margin: 0 }} placeholder="Tìm tên gói, mã đơn…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="segmented" style={{ margin: 0 }}>{([['all', 'Tất cả'], ['active', 'Đang hoạt động'], ['expired', 'Đã hết hạn']] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
        <div className="tools"><small style={{ alignSelf: 'center' }}>{shown.length}/{rows.length} gói</small><button className="primary" onClick={() => setForm('new')}>Thêm gói STEM</button></div>
      </div>
      {form && <FormPanel fields={[
        { key: 'name', label: 'Tên gói', required: true }, { key: 'code', label: 'Mã gói' },
        { key: 'tier', label: 'Hạng', type: 'select', required: true, options: [{ value: 'basic', label: 'Cơ bản' }, { value: 'advanced', label: 'Nâng cao' }, { value: 'premium', label: 'Premium' }] },
        { key: 'provider', label: 'Nhà cung cấp' }, { key: 'programs', label: 'Chương trình (VD: CT1,CT2)' }, { key: 'grades', label: 'Khối (VD: 6–9)' },
        { key: 'starts_on', label: 'Bắt đầu', type: 'date' }, { key: 'ends_on', label: 'Kết thúc', type: 'date' },
        { key: 'contract_no', label: 'Số hợp đồng' }, { key: 'order_no', label: 'Số đơn hàng' },
        { key: 'topics', label: 'Số chủ đề', type: 'number' }, { key: 'devices', label: 'Số thiết bị', type: 'number' }, { key: 'sessions', label: 'Số buổi học', type: 'number' },
      ]} initial={form === 'new' ? undefined : { name: form.name, code: form.code ?? '', tier: form.tier, provider: form.provider ?? '', programs: form.programs ?? '', grades: form.grades ?? '',
        starts_on: form.starts_on ?? '', ends_on: form.ends_on ?? '', contract_no: form.contract_no ?? '', order_no: form.order_no ?? '', topics: String(form.topics), devices: String(form.devices), sessions: String(form.sessions) }}
        onSubmit={save} onCancel={() => setForm(null)} />}
      <div className="reggrid">
        {shown.map(p => (
          <div className={'panel regcard pkg ' + p.tier} key={p.id}>
            <div className="bar"><span className="badge">{TIER[p.tier]}</span>
              <span className={'pill ' + (state(p) === 'expired' ? 'inactive' : state(p) === 'soon' ? 'maintenance' : 'active')}>{state(p) === 'expired' ? 'Hết hạn' : state(p) === 'soon' ? 'Sắp hết hạn' : 'Đang hoạt động'}</span></div>
            <b>{p.name}</b><small>{p.provider} · Khối {p.grades}</small><div><ProgChips programs={p.programs} /></div>
            <div className="pkgstats"><div><b>{p.topics}</b><small>Chủ đề</small></div><div><b>{p.devices}</b><small>Thiết bị</small></div><div><b>{p.sessions}</b><small>Buổi học</small></div></div>
            <small>{p.contract_no} · {p.order_no}</small><small>{p.starts_on && fmtDate(p.starts_on)} → {p.ends_on && fmtDate(p.ends_on)}</small>
            <div className="actions"><button className="primary" onClick={() => setDetail(p.id)}>Chi tiết</button><button onClick={() => setForm(p)}>Sửa</button><button onClick={() => remove(p)}>Xoá</button></div>
          </div>))}
        {shown.length === 0 && <p className="sub">Không có gói phù hợp.</p>}
      </div>
    </>
  )
}

function PackageDetail({ pkg, state, onBack }: { pkg: Pkg; state: string; onBack: () => void }) {
  const [tab, setTab] = useState<'units' | 'topics' | 'training'>('topics')
  const [topics, setTopics] = useState<Topic[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [open, setOpen] = useState<string | null>(null)

  async function load() {
    const [t, u, p] = await Promise.all([
      supabase.from('package_topics').select('id, seq, program, title, minutes, grade_assigned, package_topic_sessions(id, seq, title, minutes)').eq('package_id', pkg.id).order('seq'),
      supabase.from('equipment_units').select('id, serial, status, equipment_types(name), stem_rooms(name)').eq('package_id', pkg.id).order('serial'),
      supabase.from('training_plans').select('id, name, program, provider, hours'),
    ])
    setTopics((t.data as unknown as Topic[]) ?? []); setUnits((u.data as unknown as Unit[]) ?? [])
    const progs = (pkg.programs ?? '').split(',').map(s => s.trim()); setPlans(((p.data as Plan[]) ?? []).filter(x => x.program && progs.includes(x.program)))
  }
  useEffect(() => { load() }, [pkg.id])

  async function assignAll() {
    const g = prompt('Gán tất cả chủ đề cho khối (6–9):'); if (!g) return
    const n = Number(g); if (!(n >= 1 && n <= 12)) return alert('Khối không hợp lệ.')
    await supabase.from('package_topics').update({ grade_assigned: n }).eq('package_id', pkg.id); load()
  }
  async function assignOne(t: Topic, v: string) { await supabase.from('package_topics').update({ grade_assigned: v ? Number(v) : null }).eq('id', t.id); load() }

  const totalSessions = topics.reduce((s, t) => s + t.package_topic_sessions.length, 0)
  const totalMin = topics.reduce((s, t) => s + t.package_topic_sessions.reduce((a, x) => a + x.minutes, 0), 0)
  return (
    <>
      <button onClick={onBack} style={{ marginBottom: 12 }}>← Quay lại</button>
      <div className="roomhero">
        <div><ProgChips programs={pkg.programs} /></div><h2>{pkg.name}</h2><small>{pkg.provider}</small>
        <div style={{ marginTop: 8 }}><span className="tag">{state === 'expired' ? 'Hết hạn' : 'Đang hoạt động'}</span><span className="tag">{TIER[pkg.tier]}</span><span className="tag">Khối {pkg.grades}</span></div>
      </div>
      <div className="cards">
        <div className="card"><span>Nhà cung cấp</span><b>{pkg.provider}</b></div>
        <div className="card"><span>Ngày kích hoạt</span><b>{pkg.starts_on && fmtDate(pkg.starts_on)}</b></div>
        <div className="card"><span>Mã hợp đồng</span><b>{pkg.contract_no}</b></div>
        <div className="card"><span>Đơn hàng</span><b>{pkg.order_no}</b></div>
      </div>
      <div className="bar" style={{ margin: '16px 0 12px' }}>
        <div className="segmented" style={{ margin: 0 }}>
          <button className={tab === 'units' ? 'on' : ''} onClick={() => setTab('units')}>Thiết bị {units.length}</button>
          <button className={tab === 'topics' ? 'on' : ''} onClick={() => setTab('topics')}>Chương trình {topics.length}</button>
          <button className={tab === 'training' ? 'on' : ''} onClick={() => setTab('training')}>Tập huấn {plans.length}</button></div>
        {tab === 'topics' && <div className="tools"><small style={{ alignSelf: 'center' }}>{topics.length} chủ đề · {totalSessions} buổi · {totalMin} phút</small><button className="primary" onClick={assignAll}>Gán khối</button></div>}
      </div>
      {tab === 'topics' && topics.map(t => (
        <div className="panel" key={t.id} style={{ marginBottom: 10 }}>
          <div className="bar" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div><span style={{ marginRight: 8 }}>{t.seq}</span><ProgChips programs={t.program} /><b>{t.title}</b><br />
              <small style={{ color: t.grade_assigned ? 'var(--ok)' : 'var(--orange)' }}>{t.grade_assigned ? `Đã gán khối ${t.grade_assigned}` : 'Chưa gán khối'}</small></div>
            <div className="tools" onClick={e => e.stopPropagation()}><small>{t.package_topic_sessions.length} buổi · {t.package_topic_sessions.reduce((a, x) => a + x.minutes, 0)} phút</small>
              <select value={t.grade_assigned ?? ''} onChange={e => assignOne(t, e.target.value)} aria-label="Gán khối"><option value="">Khối…</option>{[6, 7, 8, 9].map(g => <option key={g} value={g}>Khối {g}</option>)}</select></div></div>
          {open === t.id && [...t.package_topic_sessions].sort((a, b) => a.seq - b.seq).map(s => <div className="roomrow" key={s.id}><span>{s.seq}. {s.title}</span><small>{s.minutes} phút</small></div>)}
        </div>))}
      {tab === 'topics' && topics.length === 0 && <p className="sub">Gói này chưa có nội dung chương trình chi tiết.</p>}
      {tab === 'units' && <table><thead><tr><th>Thiết bị</th><th>Số seri</th><th>Phòng</th><th>Tình trạng</th></tr></thead><tbody>
        {units.map(u => <tr key={u.id}><td><b>{u.equipment_types?.name}</b></td><td>{u.serial}</td><td>{u.stem_rooms?.name ?? 'Tồn kho'}</td><td><span className={'dot ' + u.status} />{UNIT_ST[u.status]}</td></tr>)}
        {units.length === 0 && <tr><td colSpan={4}>Chưa có thiết bị thuộc gói này.</td></tr>}</tbody></table>}
      {tab === 'training' && <table><thead><tr><th>Khóa tập huấn</th><th>Chương trình</th><th>Đơn vị</th><th>Số giờ</th></tr></thead><tbody>
        {plans.map(p => <tr key={p.id}><td><b>{p.name}</b></td><td><ProgChips programs={p.program} /></td><td>{p.provider}</td><td>{p.hours}</td></tr>)}
        {plans.length === 0 && <tr><td colSpan={4}>Chưa có khóa tập huấn liên quan.</td></tr>}</tbody></table>}
    </>
  )
}
