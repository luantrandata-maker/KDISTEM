import { Icon } from '../components/Icon'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/time'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { useBackClose } from '../lib/history'

type Pkg = { id: string; org_id: string; code: string | null; name: string; tier: string; provider: string | null; programs: string | null; grades: string | null; starts_on: string | null; ends_on: string | null; contract_no: string | null; order_no: string | null; topics: number; devices: number; sessions: number }
type Sess = { id: string; seq: number; title: string; minutes: number }
type Topic = { id: string; seq: number; program: string; title: string; minutes: number; grade_assigned: number | null; package_topic_sessions: Sess[] }
type Unit = { id: string; serial: string | null; status: string; equipment_types: { name: string } | null; stem_rooms: { name: string } | null }
type Plan = { id: string; name: string; program: string | null; provider: string | null; hours: number | null }
type Device = { id: string; org_id: string; package_id: string; seq: number; supplier: string | null; name: string; spec: string | null; unit: string; qty: number; unit_price: number; serials: string[]; image_url: string | null }
const TIER: Record<string, string> = { premium: 'Premium', basic: 'Cơ bản', advanced: 'Nâng cao' }
const TIER_BG: Record<string, string> = {
  premium: 'linear-gradient(120deg,#7c2d12,#ea580c)', basic: 'linear-gradient(120deg,#1e3a8a,#2e95f2)', advanced: 'linear-gradient(120deg,#4c1d95,#a855f7)',
}
const DAY = 86400000
const UNIT_ST: Record<string, string> = { available: 'Sẵn sàng', in_use: 'Đang dùng', broken: 'Hỏng', maintenance: 'Bảo trì', in_stock: 'Tồn kho' }
const money = (n: number) => Number(n || 0).toLocaleString('vi-VN') + '\u00a0₫'

// Khối theo phạm vi ghi ở gói: "6–9", "6-7", "10–12", "6,7"; không đọc được thì 1–12
export function gradeOptions(grades: string | null): number[] {
  const s = (grades ?? '').replace(/\s/g, '')
  const m = s.match(/^(\d{1,2})[–\-→](\d{1,2})$/)
  if (m) { const a = Number(m[1]), b = Number(m[2]); if (a >= 1 && b <= 12 && a <= b) return Array.from({ length: b - a + 1 }, (_, i) => a + i) }
  const list = s.split(',').map(Number).filter(n => n >= 1 && n <= 12)
  if (list.length) return [...new Set(list)].sort((a, b) => a - b)
  return Array.from({ length: 12 }, (_, i) => i + 1)
}
const gradeSummary = (topics: Topic[]) => {
  const g = [...new Set(topics.map(t => t.grade_assigned).filter((x): x is number => x != null))].sort((a, b) => a - b)
  return g.length ? 'Khối ' + g.join(', ') : 'Chưa phân'
}

export default function Packages({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Pkg[]>([])
  const [devSum, setDevSum] = useState<Record<string, number>>({})
  const [form, setForm] = useState<Pkg | 'new' | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [assign, setAssign] = useState<Pkg | null>(null)
  useBackClose(!!detail, () => setDetail(null))
  const [filter, setFilter] = useState<'all' | 'active' | 'expired'>('all')
  const [q, setQ] = useState('')
  const load = () => {
    supabase.from('stem_packages').select('*').order('starts_on').then(({ data }) => setRows((data as Pkg[]) ?? []))
    supabase.from('package_devices').select('package_id, qty').then(({ data }) => {
      const m: Record<string, number> = {}; ((data as { package_id: string; qty: number }[]) ?? []).forEach(d => { m[d.package_id] = (m[d.package_id] ?? 0) + d.qty }); setDevSum(m)
    })
  }
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

  if (detail) { const p = rows.find(x => x.id === detail); if (p) return <PackageDetail pkg={p} state={state(p)} onBack={() => { setDetail(null); load() }} /> }

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
        {shown.map(p => {
          const st = state(p)
          return (
            <div className="panel pkgcard" key={p.id}>
              <div className={'pkghead ' + p.tier}>
                <div className="bar" style={{ margin: 0 }}><b>{TIER[p.tier] ?? p.tier}</b>
                  <span className={'pill ' + (st === 'expired' ? 'inactive' : st === 'soon' ? 'maintenance' : 'active')}>{st === 'expired' ? 'Hết hạn' : st === 'soon' ? 'Sắp hết hạn' : 'Đang hoạt động'}</span></div>
                <div className="bar" style={{ margin: 0 }}><span><ProgChips programs={p.programs} /></span>{p.grades && <small style={{ color: '#fff', opacity: .9 }}>Khối {p.grades}</small>}</div>
              </div>
              <div className="pkgbody">
                <b>{p.name}</b><small className="sub">{p.provider}</small>
                <div className="pkgstats"><div><b>{p.topics}</b><small>Chủ đề</small></div><div><b>{devSum[p.id] ?? p.devices}</b><small>Thiết bị</small></div><div><b>{p.sessions}</b><small>Buổi học</small></div></div>
                <small>{p.order_no ?? p.contract_no ?? '—'}</small><small>{p.starts_on ? fmtDate(p.starts_on) : '…'} → {p.ends_on ? fmtDate(p.ends_on) : '…'}</small>
                <div className="actions" style={{ flexWrap: 'wrap' }}><button className="primary" onClick={() => setDetail(p.id)}>Chi tiết ›</button><button onClick={() => setAssign(p)}>Gán khối</button>
                  <button onClick={() => setForm(p)}>Sửa</button><button onClick={() => remove(p)}>Xoá</button></div>
              </div>
            </div>)
        })}
        {shown.length === 0 && <p className="sub">Không có gói phù hợp.</p>}
      </div>
      {assign && <AssignModal pkg={assign} onClose={() => setAssign(null)} onSaved={() => { setAssign(null); load() }} />}
    </>
  )
}

// ===== Hộp thoại gán khối cho từng chủ đề =====
function AssignModal({ pkg, topics: given, onClose, onSaved }: { pkg: Pkg; topics?: Topic[]; onClose: () => void; onSaved: () => void }) {
  const [topics, setTopics] = useState<Topic[] | null>(given ?? null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const opts = gradeOptions(pkg.grades)
  useEffect(() => {
    if (given) return
    supabase.from('package_topics').select('id, seq, program, title, minutes, grade_assigned, package_topic_sessions(id, seq, title, minutes)').eq('package_id', pkg.id).order('seq')
      .then(({ data, error }) => { if (error) setErr('Không tải được dữ liệu: ' + error.message); setTopics((data as unknown as Topic[]) ?? []) })
  }, [pkg.id])
  useEffect(() => { if (topics) setPick(Object.fromEntries(topics.map(t => [t.id, t.grade_assigned ? String(t.grade_assigned) : '']))) }, [topics])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
  const list = topics ?? []
  const chosen = list.filter(t => pick[t.id]).length
  async function save() {
    setBusy(true); setErr('')
    const changed = list.filter(t => (pick[t.id] || '') !== (t.grade_assigned ? String(t.grade_assigned) : ''))
    for (const t of changed) {
      const { error } = await supabase.from('package_topics').update({ grade_assigned: pick[t.id] ? Number(pick[t.id]) : null }).eq('id', t.id)
      if (error) { setBusy(false); return setErr(`Không lưu được "${t.title}": ${error.message}`) }
    }
    setBusy(false); onSaved()
  }
  return (
    <div className="modalbg" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Gán khối">
        <div className="modalhead"><div><h3>Gán khối</h3><small>Chọn khối áp dụng cho từng chương trình học · {pkg.name}</small></div>
          <button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button></div>
        <div className="modalbody">
          {topics === null && <p className="sub">Đang tải…</p>}
          {topics && list.length === 0 && <p className="sub">Gói này chưa có chủ đề chương trình để gán khối.</p>}
          {list.length > 0 && <label className="bar" style={{ margin: 0 }}><b>Áp dụng cho tất cả</b>
            <select value="" onChange={e => { const v = e.target.value; if (v !== '') setPick(Object.fromEntries(list.map(t => [t.id, v === 'none' ? '' : v]))) }} aria-label="Áp dụng cho tất cả">
              <option value="">Chọn khối…</option>{opts.map(g => <option key={g} value={g}>Khối {g}</option>)}<option value="none">Bỏ gán tất cả</option></select></label>}
          {list.map(t => (
            <div className="roomrow" key={t.id}>
              <span><small style={{ marginRight: 8 }}>{t.seq}</small><ProgChips programs={t.program} /> <b>{t.title}</b><br />
                <small className="sub">{t.package_topic_sessions.length} buổi · {t.package_topic_sessions.reduce((a, x) => a + x.minutes, 0)} phút</small></span>
              <select value={pick[t.id] ?? ''} onChange={e => setPick({ ...pick, [t.id]: e.target.value })} aria-label={`Khối cho ${t.title}`}>
                <option value="">Khối…</option>{opts.map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
            </div>
          ))}
          {err && <p className="warnline">{err}</p>}
        </div>
        <div className="modalfoot"><small style={{ marginRight: 'auto' }} className="sub">{chosen ? `Đã chọn ${chosen}/${list.length} chủ đề` : 'Chưa chọn khối nào'}</small>
          <button type="button" onClick={onClose} disabled={busy}>Hủy</button>
          <button type="button" className="primary" onClick={save} disabled={busy || !list.length}>{busy ? 'Đang lưu…' : 'Lưu tất cả'}</button></div>
      </div>
    </div>
  )
}

const EMPTY_DEV = { supplier: '', name: '', spec: '', unit: 'chiếc', qty: '1', unit_price: '0', serials: '', image_url: '' }

function PackageDetail({ pkg, state, onBack }: { pkg: Pkg; state: string; onBack: () => void }) {
  const [tab, setTab] = useState<'units' | 'topics' | 'training'>('units')
  const [topics, setTopics] = useState<Topic[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [devs, setDevs] = useState<Device[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [assign, setAssign] = useState(false)
  const [dform, setDform] = useState<(typeof EMPTY_DEV & { id?: string }) | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    const [t, u, p, d] = await Promise.all([
      supabase.from('package_topics').select('id, seq, program, title, minutes, grade_assigned, package_topic_sessions(id, seq, title, minutes)').eq('package_id', pkg.id).order('seq'),
      supabase.from('equipment_units').select('id, serial, status, equipment_types(name), stem_rooms(name)').eq('package_id', pkg.id).order('serial'),
      supabase.from('training_plans').select('id, name, program, provider, hours'),
      supabase.from('package_devices').select('*').eq('package_id', pkg.id).order('seq'),
    ])
    setTopics((t.data as unknown as Topic[]) ?? []); setUnits((u.data as unknown as Unit[]) ?? []); setDevs((d.data as Device[]) ?? [])
    const progs = (pkg.programs ?? '').split(',').map(s => s.trim()); setPlans(((p.data as Plan[]) ?? []).filter(x => x.program && progs.includes(x.program)))
  }
  useEffect(() => { load() }, [pkg.id])

  async function assignOne(t: Topic, v: string) {
    const { error } = await supabase.from('package_topics').update({ grade_assigned: v ? Number(v) : null }).eq('id', t.id)
    if (error) setMsg('Không gán được khối: ' + error.message); else load()
  }
  async function saveDev(e: React.FormEvent) {
    e.preventDefault(); if (!dform) return
    const row = {
      supplier: dform.supplier.trim() || null, name: dform.name.trim(), spec: dform.spec.trim() || null, unit: dform.unit.trim() || 'chiếc',
      qty: Math.max(0, Math.round(Number(dform.qty) || 0)), unit_price: Math.max(0, Math.round(Number(dform.unit_price) || 0)),
      serials: dform.serials.split(/[,;\n]/).map(s => s.trim()).filter(Boolean), image_url: dform.image_url.trim() || null,
    }
    if (!row.name) return setMsg('Nhập tên thiết bị.')
    const r = dform.id ? await supabase.from('package_devices').update(row).eq('id', dform.id)
      : await supabase.from('package_devices').insert({ ...row, org_id: pkg.org_id, package_id: pkg.id, seq: (devs.reduce((m, x) => Math.max(m, x.seq), 0) || 0) + 1 })
    if (r.error) return setMsg('Không lưu được thiết bị: ' + (/row-level|42501|permission/i.test(r.error.message) ? 'bạn chưa có quyền sửa gói STEM.' : r.error.message))
    setMsg(''); setDform(null); load()
  }
  async function delDev(d: Device) {
    if (!confirm(`Xoá "${d.name}" khỏi gói?`)) return
    const { error } = await supabase.from('package_devices').delete().eq('id', d.id)
    if (error) setMsg('Không xoá được: ' + error.message); else load()
  }

  const totalSessions = topics.reduce((s, t) => s + t.package_topic_sessions.length, 0)
  const totalMin = topics.reduce((s, t) => s + t.package_topic_sessions.reduce((a, x) => a + x.minutes, 0), 0)
  const devQty = devs.reduce((s, d) => s + d.qty, 0)
  const devTotal = devs.reduce((s, d) => s + d.qty * Number(d.unit_price), 0)
  const groups = [...new Set(devs.map(d => d.supplier ?? pkg.provider ?? 'Khác'))].map(s => ({ s, rows: devs.filter(d => (d.supplier ?? pkg.provider ?? 'Khác') === s) }))
  const hours = plans.reduce((s, p) => s + (p.hours ?? 0), 0)
  let stt = 0
  return (
    <>
      <div className="pkgbanner" style={{ background: TIER_BG[pkg.tier] ?? TIER_BG.basic }}>
        <div><button type="button" onClick={onBack} style={{ background: 'rgba(255,255,255,.15)', color: '#fff', borderColor: 'transparent' }}>← Quay lại</button></div>
        <div><ProgChips programs={pkg.programs} /></div>
        <h2 style={{ margin: 0 }}>{pkg.name}</h2><small style={{ color: '#fff', opacity: .85 }}>{pkg.provider}</small>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[state === 'expired' ? 'Hết hạn' : '● Đang hoạt động', TIER[pkg.tier] ?? pkg.tier, pkg.grades && `Khối ${pkg.grades}`].filter(Boolean).map(x =>
            <span key={x as string} className="pill" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>{x}</span>)}
        </div>
      </div>
      <div className="infostrip">
        <div><small>Nhà cung cấp</small><b>{pkg.provider ?? '—'}</b></div>
        <div><small>Lớp học</small><b>{gradeSummary(topics)}</b></div>
        <div><small>Ngày kích hoạt</small><b>{pkg.starts_on ? fmtDate(pkg.starts_on) : '—'}</b></div>
        <div><small>Mã hợp đồng</small><b>{pkg.contract_no ?? '—'}</b></div>
        <div><small>Đơn hàng</small><b>{pkg.order_no ?? '—'}</b></div>
      </div>
      <div className="bar" style={{ margin: '0 0 12px' }}>
        <div className="segmented" style={{ margin: 0 }}>
          <button className={tab === 'units' ? 'on' : ''} onClick={() => setTab('units')}>Thiết bị {devs.length || units.length}</button>
          <button className={tab === 'topics' ? 'on' : ''} onClick={() => setTab('topics')}>Chương trình {topics.length}</button>
          <button className={tab === 'training' ? 'on' : ''} onClick={() => setTab('training')}>Tập huấn {plans.length}</button></div>
        <div className="tools">
          {tab === 'units' && <><small style={{ alignSelf: 'center' }}>{devQty} thiết bị · {devs.length} loại</small>{!dform && <button onClick={() => setDform({ ...EMPTY_DEV, supplier: pkg.provider ?? '' })}>+ Thêm thiết bị</button>}</>}
          {tab === 'topics' && <><small style={{ alignSelf: 'center' }}>{topics.length} chương trình · {totalSessions} buổi học · {totalMin} phút</small><button className="primary" onClick={() => setAssign(true)} disabled={!topics.length}>Gán khối</button></>}
          {tab === 'training' && <small style={{ alignSelf: 'center' }}>{plans.length} đợt · {hours} giờ</small>}
        </div>
      </div>
      {msg && <p className="warnline">{msg}</p>}

      {tab === 'units' && <>
        {dform && (
          <form className="panel formgrid" onSubmit={saveDev} style={{ marginBottom: 12 }}>
            <label className="field"><span>Tên thiết bị *</span><input value={dform.name} onChange={e => setDform({ ...dform, name: e.target.value })} /></label>
            <label className="field"><span>Nhà cung cấp</span><input value={dform.supplier} onChange={e => setDform({ ...dform, supplier: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Thông số kỹ thuật</span><input value={dform.spec} onChange={e => setDform({ ...dform, spec: e.target.value })} /></label>
            <label className="field"><span>Đơn vị</span><input value={dform.unit} onChange={e => setDform({ ...dform, unit: e.target.value })} /></label>
            <label className="field"><span>Số lượng</span><input type="number" min={0} value={dform.qty} onChange={e => setDform({ ...dform, qty: e.target.value })} /></label>
            <label className="field"><span>Đơn giá (₫)</span><input type="number" min={0} value={dform.unit_price} onChange={e => setDform({ ...dform, unit_price: e.target.value })} /></label>
            <label className="field"><span>Ảnh (đường dẫn)</span><input value={dform.image_url} onChange={e => setDform({ ...dform, image_url: e.target.value })} placeholder="https://…" /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Số seri (cách nhau dấu phẩy hoặc xuống dòng)</span><textarea rows={2} value={dform.serials} onChange={e => setDform({ ...dform, serials: e.target.value })} /></label>
            <div className="formactions"><button className="primary" type="submit">Lưu thiết bị</button> <button type="button" onClick={() => setDform(null)}>Huỷ</button></div>
          </form>
        )}
        <div className="wrap"><table>
          <thead><tr><th>STT</th><th>Ảnh</th><th>Tên thiết bị</th><th>Đơn vị</th><th>Số lượng</th><th>Danh sách số seri</th><th style={{ textAlign: 'right' }}>Đơn giá</th><th style={{ textAlign: 'right' }}>Thành tiền</th><th></th></tr></thead>
          <tbody>
            {groups.map(g => [
              <tr key={'g' + g.s} style={{ background: 'var(--soft)' }}><td colSpan={7}><b>{g.s}</b><br /><small className="sub">{g.rows.length} loại thiết bị</small></td>
                <td style={{ textAlign: 'right', color: 'var(--primary)', fontWeight: 700 }}>{money(g.rows.reduce((s, d) => s + d.qty * Number(d.unit_price), 0))}</td><td /></tr>,
              ...g.rows.map(d => (
                <tr key={d.id}>
                  <td>{++stt}</td>
                  <td>{d.image_url ? <img className="devimg" src={d.image_url} alt={d.name} /> : <span className="devimg" aria-hidden="true"><Icon n="package" size={22} /></span>}</td>
                  <td><b>{d.name}</b>{d.spec && <><br /><small className="sub">{d.spec}</small></>}</td>
                  <td>{d.unit}</td><td>{d.qty}</td>
                  <td style={{ maxWidth: 220 }}>{d.serials.length ? d.serials.map(s => <span key={s} className="serial">{s}</span>) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(Number(d.unit_price))}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{money(d.qty * Number(d.unit_price))}</b></td>
                  <td style={{ whiteSpace: 'nowrap' }}><button type="button" onClick={() => setDform({ id: d.id, supplier: d.supplier ?? '', name: d.name, spec: d.spec ?? '', unit: d.unit, qty: String(d.qty), unit_price: String(d.unit_price), serials: d.serials.join(', '), image_url: d.image_url ?? '' })}>Sửa</button>
                    <button type="button" className="x" onClick={() => delDev(d)} aria-label={`Xoá ${d.name}`}>×</button></td>
                </tr>)),
            ])}
            {devs.length === 0 && <tr><td colSpan={9}>Chưa có danh sách thiết bị trong hợp đồng gói. Bấm "Thêm thiết bị" để nhập.</td></tr>}
          </tbody>
          {devs.length > 0 && <tfoot><tr><td colSpan={7}><b>Tổng cộng</b><br /><small className="sub">{devQty} thiết bị · {devs.length} loại</small></td>
            <td style={{ textAlign: 'right', color: 'var(--primary)', fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap' }}>{money(devTotal)}</td><td /></tr></tfoot>}
        </table></div>
        {units.length > 0 && <>
          <h3 style={{ marginTop: 18 }}>Thiết bị đã nhập kho theo gói ({units.length})</h3>
          <table><thead><tr><th>Thiết bị</th><th>Số seri</th><th>Phòng</th><th>Tình trạng</th></tr></thead><tbody>
            {units.map(u => <tr key={u.id}><td><b>{u.equipment_types?.name}</b></td><td>{u.serial}</td><td>{u.stem_rooms?.name ?? 'Tồn kho'}</td><td><span className={'dot ' + u.status} />{UNIT_ST[u.status]}</td></tr>)}</tbody></table>
        </>}
      </>}

      {tab === 'topics' && topics.map(t => (
        <div className="panel" key={t.id} style={{ marginBottom: 10 }}>
          <div className="bar" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div><span style={{ marginRight: 8 }}>{t.seq}</span><ProgChips programs={t.program} /><b>{t.title}</b><br />
              <small style={{ color: t.grade_assigned ? 'var(--ok)' : 'var(--orange)' }}>{t.grade_assigned ? `Đã gán khối ${t.grade_assigned}` : 'Chưa gán khối'}</small></div>
            <div className="tools" onClick={e => e.stopPropagation()}><small>{t.package_topic_sessions.length} buổi · {t.package_topic_sessions.reduce((a, x) => a + x.minutes, 0)} phút</small>
              <select value={t.grade_assigned ?? ''} onChange={e => assignOne(t, e.target.value)} aria-label="Gán khối"><option value="">Khối…</option>{gradeOptions(pkg.grades).map(g => <option key={g} value={g}>Khối {g}</option>)}</select></div></div>
          {open === t.id && [...t.package_topic_sessions].sort((a, b) => a.seq - b.seq).map(s => <div className="roomrow" key={s.id}><span>{s.seq}. {s.title}</span><small>{s.minutes} phút</small></div>)}
        </div>))}
      {tab === 'topics' && topics.length === 0 && <p className="sub">Gói này chưa có nội dung chương trình chi tiết.</p>}
      {tab === 'training' && <table><thead><tr><th>Khóa tập huấn</th><th>Chương trình</th><th>Đơn vị</th><th>Số giờ</th></tr></thead><tbody>
        {plans.map(p => <tr key={p.id}><td><b>{p.name}</b></td><td><ProgChips programs={p.program} /></td><td>{p.provider}</td><td>{p.hours}</td></tr>)}
        {plans.length === 0 && <tr><td colSpan={4}>Chưa có kế hoạch tập huấn.</td></tr>}</tbody></table>}
      {assign && <AssignModal pkg={pkg} topics={topics} onClose={() => setAssign(false)} onSaved={() => { setAssign(false); load() }} />}
    </>
  )
}
