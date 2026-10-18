import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, norm } from '../../lib/sheet'
import { Tabs } from '../teacher/common'

// Màn xem toàn hệ thống cho cổng Quản trị nền tảng (KDI): gom dữ liệu của mọi trường trên một trang,
// lọc theo Sở / tỉnh → trường, có bảng tổng hợp theo trường và danh sách chi tiết. Chỉ đọc
// (trừ phiếu bảo hành: KDI là bên tiếp nhận). Dữ liệu do RLS giới hạn trong cây tổ chức của người xem.

type Org = { id: string; name: string; code: string | null; type: string; parent_id: string | null; is_platform: boolean }
export type Row = Record<string, any> & { id: string; org_id: string }
type Col = { label: string; get: (r: Row) => ReactNode; text?: (r: Row) => string | number | null; wrap?: boolean }
type Stat = { label: string; get: (rows: Row[]) => number | string }
export type Spec = {
  table: string; select: string; order: string; asc?: boolean
  where?: (q: any) => any
  cols: Col[]; stats: Stat[]
  search: (r: Row) => string; searchHint: string
  status?: { get: (r: Row) => string; labels: Record<string, string>; tone?: Record<string, string> }
  noun: string; file: string; empty: string
  detail?: (r: Row, reload: () => void) => ReactNode
}

const PAGE = 1000, CAP = 20000, SHOW = 500
const REGION_TYPES = new Set(['department', 'province'])
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('vi-VN') : '')
const fmtTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '')
const maskPhone = (p: string | null | undefined) => (p ? p.replace(/^(\d{3})\d+(\d{3})$/, '$1••••$2') : '')
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—')
const KEY = 'sysview.scope'

// ---------- Cây tổ chức: Sở / tỉnh của từng đơn vị ----------
export function useOrgs() {
  const [orgs, setOrgs] = useState<Org[]>([])
  useEffect(() => {
    supabase.from('organizations').select('id, name, code, type, parent_id, is_platform').order('name')
      .then(({ data }) => setOrgs((data as Org[]) ?? []))
  }, [])
  return useMemo(() => {
    const byId = new Map(orgs.map(o => [o.id, o]))
    const regionOf = (id: string): Org | null => {
      for (let o = byId.get(id), n = 0; o && n < 10; o = o.parent_id ? byId.get(o.parent_id) : undefined, n++) if (REGION_TYPES.has(o.type)) return o
      return null
    }
    const regions = orgs.filter(o => REGION_TYPES.has(o.type) && !(o.parent_id && byId.get(o.parent_id) && REGION_TYPES.has(byId.get(o.parent_id)!.type)))
    return { orgs, byId, regionOf, regions, schools: orgs.filter(o => o.type === 'school') }
  }, [orgs])
}

async function fetchAll(spec: Spec, ids: string[] | null) {
  const out: Row[] = []
  for (let from = 0; from < CAP; from += PAGE) {
    let q: any = supabase.from(spec.table).select(spec.select).order(spec.order, { ascending: spec.asc ?? true }).range(from, from + PAGE - 1)
    if (ids) q = ids.length === 1 ? q.eq('org_id', ids[0]) : q.in('org_id', ids)
    if (spec.where) q = spec.where(q)
    const { data, error } = await q
    if (error) throw new Error(/schema cache|does not exist/i.test(error.message) ? 'Chưa có bảng dữ liệu này trên hệ thống.' : error.message)
    out.push(...((data as Row[]) ?? []))
    if (!data || data.length < PAGE) return { rows: out, capped: false }
  }
  return { rows: out, capped: true }
}

export function SystemList({ spec }: { spec: Spec }) {
  const { byId, regionOf, regions, orgs } = useOrgs()
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { region?: string; org?: string } } catch { return {} } })()
  const [region, setRegion] = useState(saved.region ?? '')
  const [org, setOrg] = useState(saved.org ?? '')
  const [q, setQ] = useState('')
  const [st, setSt] = useState('all')
  const [view, setView] = useState<'sum' | 'list'>(saved.org ? 'list' : 'sum')
  const [rows, setRows] = useState<Row[]>([])
  const [capped, setCapped] = useState(false)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ region, org })) } catch { /* bỏ qua */ } }, [region, org])

  // Đơn vị trong phạm vi lọc (trường, và cả Sở/Phòng nếu dữ liệu thuộc cấp đó)
  const inRegion = useMemo(() => orgs.filter(o => !o.is_platform && (!region || regionOf(o.id)?.id === region)), [orgs, region, regionOf])
  const schoolsInRegion = inRegion.filter(o => o.type === 'school')

  useEffect(() => {
    if (!orgs.length) return
    const ids = org ? [org] : region && inRegion.length <= 150 ? inRegion.map(o => o.id) : null
    setBusy(true); setErr('')
    fetchAll(spec, ids).then(r => {
      const keep = region && !org && !ids ? r.rows.filter(x => regionOf(x.org_id)?.id === region) : r.rows
      setRows(keep); setCapped(r.capped)
    }).catch(e => { setErr(e.message); setRows([]) }).finally(() => setBusy(false))
  }, [orgs.length, region, org, tick])

  const reload = () => setTick(t => t + 1)
  const nameOf = (id: string) => byId.get(id)?.name ?? '—'
  const needle = norm(q.trim().toLowerCase())
  const shown = rows.filter(r => (st === 'all' || spec.status?.get(r) === st) && (!needle || norm((spec.search(r) + ' ' + nameOf(r.org_id)).toLowerCase()).includes(needle)))
  const groups = [...shown.reduce((m, r) => m.set(r.org_id, [...(m.get(r.org_id) ?? []), r]), new Map<string, Row[]>())]
    .sort((a, b) => b[1].length - a[1].length || nameOf(a[0]).localeCompare(nameOf(b[0]), 'vi'))
  const empty = schoolsInRegion.filter(s => !groups.some(([id]) => id === s.id))
  const count = (k: string) => rows.filter(r => spec.status?.get(r) === k).length
  const regionName = (id: string) => regionOf(id)?.name ?? ''

  async function excel() {
    const cols = [{ key: 'org', label: 'Đơn vị', width: 30 }, { key: 'region', label: 'Sở / tỉnh', width: 24 },
      ...spec.cols.map((c, i) => ({ key: 'c' + i, label: c.label, width: 22 }))]
    await downloadXlsx(spec.file + '.xlsx', cols, shown.map(r => [nameOf(r.org_id), regionName(r.org_id),
      ...spec.cols.map(c => { const v = c.text ? c.text(r) : c.get(r); return typeof v === 'string' || typeof v === 'number' ? v : null })]))
  }
  const pickOrg = (id: string) => { setOrg(id); setView(id ? 'list' : 'sum'); setOpen(null) }

  return (
    <>
      <div className="bar sysbar">
        <span className="tools">
          <label className="pickfield"><span>Sở / tỉnh</span>
            <select value={region} onChange={e => { setRegion(e.target.value); pickOrg('') }} aria-label="Chọn Sở hoặc tỉnh">
              <option value="">Toàn hệ thống</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
          <label className="pickfield"><span>Đơn vị</span>
            <select value={org} onChange={e => pickOrg(e.target.value)} aria-label="Chọn trường hoặc đơn vị">
              <option value="">Tất cả ({schoolsInRegion.length} trường)</option>
              {inRegion.map(o => <option key={o.id} value={o.id}>{o.type === 'school' ? '' : '◆ '}{o.name}</option>)}
            </select></label>
          <input className="search" style={{ margin: 0, minWidth: 220 }} type="search" placeholder={spec.searchHint} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm kiếm" />
        </span>
        <span className="tools">
          {!org && <Tabs value={view} onChange={setView} items={[['sum', 'Theo đơn vị'], ['list', 'Danh sách']]} />}
          <button onClick={excel} disabled={!shown.length}>Xuất Excel</button>
        </span>
      </div>

      <div className="cards syscards">
        <div className="card"><strong>{busy ? '…' : shown.length.toLocaleString('vi-VN')}</strong><span>{spec.noun}</span></div>
        {spec.stats.map(s => <div key={s.label} className="card"><strong>{busy ? '…' : typeof s.get(shown) === 'number' ? (s.get(shown) as number).toLocaleString('vi-VN') : s.get(shown)}</strong><span>{s.label}</span></div>)}
        {!org && <div className="card"><strong>{busy ? '…' : `${groups.length}/${schoolsInRegion.length}`}</strong><span>Trường có dữ liệu</span></div>}
      </div>

      {spec.status && <div className="tools" style={{ margin: '14px 0 4px' }}>
        <button className={'chipbtn' + (st === 'all' ? ' on' : '')} onClick={() => setSt('all')}>Tất cả ({rows.length})</button>
        {Object.entries(spec.status.labels).map(([k, l]) => count(k) > 0 && <button key={k} className={'chipbtn' + (st === k ? ' on' : '')} onClick={() => setSt(k)}>{l} ({count(k)})</button>)}
      </div>}

      {err && <p className="msg">{err}</p>}
      {capped && <p className="msg">Đang hiện {CAP.toLocaleString('vi-VN')} dòng đầu. Chọn Sở / tỉnh hoặc trường để xem đủ.</p>}
      {busy && <p className="sub">Đang tải…</p>}

      {!busy && !org && view === 'sum' && <div className="wrap"><table className="systable">
        <thead><tr><th>Đơn vị</th><th>Sở / tỉnh</th><th className="num">{spec.noun}</th>{spec.stats.map(s => <th key={s.label} className="num">{s.label}</th>)}</tr></thead>
        <tbody>
          {groups.map(([id, list]) => (
            <tr key={id}><td><button className="linkbtn" onClick={() => pickOrg(id)}>{nameOf(id)}</button></td><td><small>{regionName(id)}</small></td>
              <td className="num"><b>{list.length.toLocaleString('vi-VN')}</b></td>
              {spec.stats.map(s => { const v = s.get(list); return <td key={s.label} className="num">{typeof v === 'number' ? v.toLocaleString('vi-VN') : v}</td> })}</tr>
          ))}
          {empty.map(s => <tr key={s.id} className="dim"><td><button className="linkbtn" onClick={() => pickOrg(s.id)}>{s.name}</button></td><td><small>{regionName(s.id)}</small></td>
            <td className="num">0</td>{spec.stats.map(x => <td key={x.label} className="num">—</td>)}</tr>)}
          {!groups.length && !empty.length && <tr><td colSpan={spec.stats.length + 3}>{spec.empty}</td></tr>}
        </tbody>
      </table></div>}

      {!busy && (org || view === 'list') && <>
        <div className="wrap"><table className="systable">
          <thead><tr>{!org && <th>Đơn vị</th>}{spec.cols.map(c => <th key={c.label}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.slice(0, SHOW).map(r => <Fragment key={r.id}>
              <tr className={spec.detail ? 'clickrow' : ''} onClick={spec.detail ? () => setOpen(open === r.id ? null : r.id) : undefined}>
                {!org && <td><small>{nameOf(r.org_id)}</small></td>}
                {spec.cols.map(c => <td key={c.label} style={c.wrap ? { whiteSpace: 'normal', maxWidth: 320 } : undefined}>{c.get(r)}</td>)}
              </tr>
              {open === r.id && spec.detail && <tr><td colSpan={spec.cols.length + (org ? 0 : 1)}>{spec.detail(r, reload)}</td></tr>}
            </Fragment>)}
            {!shown.length && <tr><td colSpan={spec.cols.length + (org ? 0 : 1)}>{rows.length ? 'Không có dòng phù hợp bộ lọc.' : spec.empty}</td></tr>}
          </tbody>
        </table></div>
        {shown.length > SHOW && <p className="sub">Hiện {SHOW}/{shown.length.toLocaleString('vi-VN')} dòng. Xuất Excel để có đủ, hoặc lọc thêm.</p>}
      </>}
    </>
  )
}

// ---------- Định nghĩa từng màn ----------
const pill = (label: string, tone = '') => <span className={'pill ' + tone}>{label}</span>
const stPill = (labels: Record<string, string>, tone: Record<string, string>) => (s: string) => pill(labels[s] ?? s, tone[s] ?? '')

const W_ST: Record<string, string> = { draft: 'Nháp', new: 'Mới', accepted: 'Đã tiếp nhận', waiting_parts: 'Chờ phụ kiện', processing: 'Đang xử lý', resolved: 'Đã xử lý', rejected: 'Từ chối', closed: 'Đóng' }
const W_TONE: Record<string, string> = { new: 'maintenance', accepted: 'maintenance', waiting_parts: 'maintenance', processing: 'maintenance', resolved: 'active', rejected: 'inactive', closed: '' }
const W_OPEN = ['new', 'accepted', 'waiting_parts', 'processing']

function WarrantyDetail({ r, reload }: { r: Row; reload: () => void }) {
  const [msg, setMsg] = useState('')
  async function patch(v: Record<string, unknown>) {
    const { error } = await supabase.from('warranty_tickets').update(v).eq('id', r.id)
    if (error) setMsg(error.message); else { setMsg(''); reload() }
  }
  return <div className="formgrid">
    <label className="field"><span>Trạng thái</span><select value={r.status} onChange={e => patch({ status: e.target.value })}>{Object.entries(W_ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="field"><span>KDI tiếp nhận</span><select value={r.provider_status ?? 'pending'} onChange={e => patch({ provider_status: e.target.value })}><option value="pending">Chờ tiếp nhận</option><option value="accepted">Đã tiếp nhận</option></select></label>
    <label className="field"><span>Kỹ thuật viên phụ trách</span><input defaultValue={r.technician ?? ''} onBlur={e => e.target.value !== (r.technician ?? '') && patch({ technician: e.target.value || null })} /></label>
    {msg && <p className="msg">{msg}</p>}
  </div>
}

export const WARRANTY: Spec = {
  table: 'warranty_tickets', order: 'created_at', asc: false,
  select: 'id, org_id, code, description, status, created_at, provider_status, technician, equipment_units(serial, equipment_types(name))',
  where: q => q.neq('status', 'draft'),
  cols: [
    { label: 'Mã phiếu', get: r => <b>{r.code}</b>, text: r => r.code },
    { label: 'Thiết bị', get: r => <>{r.equipment_units?.equipment_types?.name}<br /><small>{r.equipment_units?.serial}</small></>, text: r => `${r.equipment_units?.equipment_types?.name ?? ''} ${r.equipment_units?.serial ?? ''}`.trim() },
    { label: 'Mô tả sự cố', get: r => r.description, wrap: true },
    { label: 'KDI tiếp nhận', get: r => pill(r.provider_status === 'accepted' ? 'Đã tiếp nhận' : 'Chờ tiếp nhận', r.provider_status === 'accepted' ? 'active' : 'maintenance'), text: r => (r.provider_status === 'accepted' ? 'Đã tiếp nhận' : 'Chờ tiếp nhận') },
    { label: 'KTV', get: r => r.technician ?? <small>Chưa phân công</small>, text: r => r.technician },
    { label: 'Ngày báo', get: r => fmtDate(r.created_at) },
    { label: 'Trạng thái', get: r => stPill(W_ST, W_TONE)(r.status), text: r => W_ST[r.status] },
  ],
  stats: [
    { label: 'Chờ KDI tiếp nhận', get: rs => rs.filter(r => r.provider_status !== 'accepted' && W_OPEN.includes(r.status)).length },
    { label: 'Chưa xử lý xong', get: rs => rs.filter(r => W_OPEN.includes(r.status)).length },
    { label: 'Đã xử lý', get: rs => rs.filter(r => r.status === 'resolved' || r.status === 'closed').length },
  ],
  status: { get: r => r.status, labels: W_ST }, search: r => `${r.code} ${r.description} ${r.equipment_units?.serial ?? ''} ${r.technician ?? ''}`,
  searchHint: 'Mã phiếu, sự cố, serial, KTV…', noun: 'Phiếu bảo hành', file: 'bao-hanh-toan-he-thong', empty: 'Chưa có phiếu bảo hành nào.',
  detail: (r, reload) => <WarrantyDetail r={r} reload={reload} />,
}

export const BUILDINGS: Spec = {
  table: 'buildings', order: 'name', select: 'id, org_id, name, note, floors(id, name)',
  cols: [
    { label: 'Tòa nhà', get: r => <b>{r.name}</b>, text: r => r.name },
    { label: 'Số tầng', get: r => r.floors?.length ?? 0 },
    { label: 'Các tầng', get: r => (r.floors ?? []).map((f: any) => f.name).join(', '), wrap: true },
    { label: 'Ghi chú', get: r => r.note ?? '', wrap: true },
  ],
  stats: [{ label: 'Tầng', get: rs => rs.reduce((s, r) => s + (r.floors?.length ?? 0), 0) }],
  search: r => `${r.name} ${r.note ?? ''}`, searchHint: 'Tên tòa nhà…', noun: 'Tòa nhà', file: 'toa-nha-toan-he-thong', empty: 'Chưa có trường nào khai báo tòa nhà.',
}
const SESSION: Record<string, string> = { morning: 'Sáng', afternoon: 'Chiều', evening: 'Tối' }
export const PERIODS: Spec = {
  table: 'period_configs', order: 'starts_at', select: 'id, org_id, name, session, starts_at, ends_at',
  cols: [
    { label: 'Tiết', get: r => <b>{r.name}</b>, text: r => r.name },
    { label: 'Buổi', get: r => SESSION[r.session] ?? r.session ?? '' },
    { label: 'Bắt đầu', get: r => (r.starts_at ?? '').slice(0, 5) },
    { label: 'Kết thúc', get: r => (r.ends_at ?? '').slice(0, 5) },
  ],
  stats: [{ label: 'Tiết buổi sáng', get: rs => rs.filter(r => r.session === 'morning').length }, { label: 'Tiết buổi chiều', get: rs => rs.filter(r => r.session === 'afternoon').length }],
  search: r => r.name, searchHint: 'Tên tiết…', noun: 'Tiết học', file: 'tiet-hoc-toan-he-thong', empty: 'Chưa có trường nào cấu hình tiết học.',
}

export const TEACHERS: Spec = {
  table: 'teachers', order: 'full_name', select: 'id, org_id, full_name, email, subject, grade, status, profile_id',
  cols: [
    { label: 'Họ tên', get: r => <b>{r.full_name}</b>, text: r => r.full_name },
    { label: 'Email', get: r => r.email ?? '' },
    { label: 'Bộ môn', get: r => r.subject ?? '' },
    { label: 'Khối', get: r => r.grade ?? '' },
    { label: 'Tài khoản', get: r => pill(r.profile_id ? 'Đã kích hoạt' : 'Chưa có', r.profile_id ? 'active' : ''), text: r => (r.profile_id ? 'Đã kích hoạt' : 'Chưa có') },
    { label: 'Trạng thái', get: r => pill(r.status === 'active' ? 'Đang dạy' : 'Ngừng', r.status === 'active' ? 'active' : 'inactive'), text: r => (r.status === 'active' ? 'Đang dạy' : 'Ngừng') },
  ],
  stats: [
    { label: 'Đang dạy', get: rs => rs.filter(r => r.status === 'active').length },
    { label: 'Đã có tài khoản', get: rs => pct(rs.filter(r => r.profile_id).length, rs.length) },
  ],
  status: { get: r => r.status, labels: { active: 'Đang dạy', inactive: 'Ngừng' } },
  search: r => `${r.full_name} ${r.email ?? ''} ${r.subject ?? ''}`, searchHint: 'Tên, email, bộ môn…', noun: 'Giáo viên', file: 'giao-vien-toan-he-thong', empty: 'Chưa có giáo viên.',
}

export const TEACHING: Spec = {
  table: 'teaching_assignments', order: 'subject',
  select: 'id, org_id, subject, teacher_id, class_id, teachers(full_name), classes(name, grade), academic_years(name, term)',
  cols: [
    { label: 'Giáo viên', get: r => <b>{r.teachers?.full_name}</b>, text: r => r.teachers?.full_name },
    { label: 'Môn', get: r => r.subject ?? '' },
    { label: 'Lớp', get: r => r.classes?.name ?? '' },
    { label: 'Năm học', get: r => (r.academic_years ? `${r.academic_years.name} · ${r.academic_years.term}` : '') },
  ],
  stats: [
    { label: 'Giáo viên được phân công', get: rs => new Set(rs.map(r => r.teacher_id)).size },
    { label: 'Lớp có phân công', get: rs => new Set(rs.map(r => r.class_id)).size },
  ],
  search: r => `${r.teachers?.full_name ?? ''} ${r.subject ?? ''} ${r.classes?.name ?? ''}`, searchHint: 'Giáo viên, môn, lớp…', noun: 'Phân công', file: 'phan-cong-toan-he-thong', empty: 'Chưa có phân công giảng dạy.',
}

const S_ST: Record<string, string> = { studying: 'Đang học', transferred: 'Chuyển trường', graduated: 'Đã tốt nghiệp' }
export const STUDENTS: Spec = {
  table: 'students', order: 'full_name', select: 'id, org_id, full_name, student_code, status, profile_id, classes(name, grade)',
  cols: [
    { label: 'Mã HS', get: r => r.student_code ?? '' },
    { label: 'Họ tên', get: r => <b>{r.full_name}</b>, text: r => r.full_name },
    { label: 'Lớp', get: r => r.classes?.name ?? '' },
    { label: 'Tài khoản', get: r => pill(r.profile_id ? 'Đã có' : 'Chưa có', r.profile_id ? 'active' : ''), text: r => (r.profile_id ? 'Đã có' : 'Chưa có') },
    { label: 'Trạng thái', get: r => stPill(S_ST, { studying: 'active', transferred: 'maintenance', graduated: '' })(r.status), text: r => S_ST[r.status] ?? r.status },
  ],
  stats: [
    { label: 'Đang học', get: rs => rs.filter(r => r.status === 'studying').length },
    { label: 'Đã có tài khoản', get: rs => pct(rs.filter(r => r.profile_id).length, rs.length) },
  ],
  status: { get: r => r.status, labels: S_ST },
  search: r => `${r.full_name} ${r.student_code ?? ''} ${r.classes?.name ?? ''}`, searchHint: 'Tên, mã học sinh, lớp…', noun: 'Học sinh', file: 'hoc-sinh-toan-he-thong', empty: 'Chưa có học sinh.',
}

export const GUARDIANS: Spec = {
  table: 'guardians', order: 'created_at', asc: false,
  select: 'id, org_id, full_name, relation, phone, profile_id, receive_alerts, students(full_name, student_code, classes(name))',
  cols: [
    { label: 'Phụ huynh', get: r => <b>{r.full_name}</b>, text: r => r.full_name },
    { label: 'Quan hệ', get: r => r.relation ?? '' },
    { label: 'Điện thoại', get: r => maskPhone(r.phone) },
    { label: 'Học sinh', get: r => <>{r.students?.full_name}<br /><small>{r.students?.classes?.name}</small></>, text: r => r.students?.full_name },
    { label: 'Cổng phụ huynh', get: r => pill(r.profile_id ? 'Đã kích hoạt' : 'Chưa', r.profile_id ? 'active' : ''), text: r => (r.profile_id ? 'Đã kích hoạt' : 'Chưa') },
    { label: 'Nhận cảnh báo', get: r => (r.receive_alerts ? 'Có' : 'Tắt') },
  ],
  stats: [
    { label: 'Đã kích hoạt cổng PH', get: rs => pct(rs.filter(r => r.profile_id).length, rs.length) },
    { label: 'Nhận cảnh báo vắng', get: rs => rs.filter(r => r.receive_alerts).length },
    { label: 'Học sinh có PH', get: rs => new Set(rs.map(r => r.students?.student_code ?? r.id)).size },
  ],
  search: r => `${r.full_name} ${r.students?.full_name ?? ''} ${r.students?.student_code ?? ''}`, searchHint: 'Tên phụ huynh, học sinh…', noun: 'Phụ huynh', file: 'phu-huynh-toan-he-thong', empty: 'Chưa có phụ huynh nào được khai báo.',
}

const AP_ST: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }
const AP_TONE: Record<string, string> = { pending: 'maintenance', approved: 'active', rejected: 'inactive' }
export const EDUPLAN: Spec = {
  table: 'education_plans', order: 'grade', select: 'id, org_id, subject, grade, stem_periods, status, teachers(full_name)',
  cols: [
    { label: 'Giáo viên', get: r => <b>{r.teachers?.full_name}</b>, text: r => r.teachers?.full_name },
    { label: 'Môn', get: r => r.subject ?? '' },
    { label: 'Khối', get: r => r.grade ?? '' },
    { label: 'Tiết STEM', get: r => r.stem_periods ?? 0 },
    { label: 'Trạng thái', get: r => stPill(AP_ST, AP_TONE)(r.status), text: r => AP_ST[r.status] },
  ],
  stats: [
    { label: 'Tổng tiết STEM', get: rs => rs.reduce((s, r) => s + (r.stem_periods ?? 0), 0) },
    { label: 'Chờ duyệt', get: rs => rs.filter(r => r.status === 'pending').length },
    { label: 'Đã duyệt', get: rs => pct(rs.filter(r => r.status === 'approved').length, rs.length) },
  ],
  status: { get: r => r.status, labels: AP_ST },
  search: r => `${r.teachers?.full_name ?? ''} ${r.subject ?? ''}`, searchHint: 'Giáo viên, môn…', noun: 'Kế hoạch', file: 'ke-hoach-giao-duc-toan-he-thong', empty: 'Chưa có kế hoạch giáo dục.',
}

const R_ST: Record<string, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }
export const REGISTRATIONS: Spec = {
  table: 'stem_registrations', order: 'on_date', asc: false,
  select: 'id, org_id, on_date, topic, program, status, created_at, teachers(full_name), classes(name), stem_rooms(name), period_configs(name)',
  cols: [
    { label: 'Ngày dạy', get: r => <><b>{fmtDate(r.on_date)}</b><br /><small>{r.period_configs?.name}</small></>, text: r => fmtDate(r.on_date) },
    { label: 'Giáo viên', get: r => r.teachers?.full_name ?? '' },
    { label: 'Lớp', get: r => r.classes?.name ?? '' },
    { label: 'Chủ đề', get: r => <>{r.topic}{r.program && <><br /><small>{r.program}</small></>}</>, text: r => r.topic, wrap: true },
    { label: 'Phòng', get: r => r.stem_rooms?.name ?? '' },
    { label: 'Trạng thái', get: r => stPill(R_ST, AP_TONE)(r.status), text: r => R_ST[r.status] },
  ],
  stats: [
    { label: 'Chờ duyệt', get: rs => rs.filter(r => r.status === 'pending').length },
    { label: 'Chờ quá 3 ngày', get: rs => rs.filter(r => r.status === 'pending' && Date.now() - +new Date(r.created_at) > 3 * 864e5).length },
    { label: 'Tỉ lệ duyệt', get: rs => pct(rs.filter(r => r.status === 'approved').length, rs.filter(r => r.status !== 'pending').length) },
  ],
  status: { get: r => r.status, labels: R_ST },
  search: r => `${r.topic ?? ''} ${r.teachers?.full_name ?? ''} ${r.classes?.name ?? ''}`, searchHint: 'Chủ đề, giáo viên, lớp…', noun: 'Đăng ký', file: 'dang-ky-day-stem-toan-he-thong', empty: 'Chưa có đăng ký dạy STEM.',
}

const H_ST: Record<string, string> = { draft: 'Nháp', open: 'Đang mở', closed: 'Đã đóng' }
export const HOMEWORK: Spec = {
  table: 'assignment_overview', order: 'created_at', asc: false,
  select: 'id, org_id, title, kind, subject, class_name, due_at, status, target_count, submitted_count, graded_count, late_count',
  cols: [
    { label: 'Bài tập', get: r => <b>{r.title}</b>, text: r => r.title, wrap: true },
    { label: 'Lớp', get: r => r.class_name ?? '' },
    { label: 'Môn', get: r => r.subject ?? '' },
    { label: 'Hạn nộp', get: r => fmtTime(r.due_at) },
    { label: 'Đã nộp', get: r => `${r.submitted_count ?? 0}/${r.target_count ?? 0}` },
    { label: 'Đã chấm', get: r => `${r.graded_count ?? 0}/${r.submitted_count ?? 0}` },
    { label: 'Trạng thái', get: r => stPill(H_ST, { open: 'active', closed: '' })(r.status), text: r => H_ST[r.status] },
  ],
  stats: [
    { label: 'Tỉ lệ nộp', get: rs => pct(rs.reduce((s, r) => s + Number(r.submitted_count ?? 0), 0), rs.reduce((s, r) => s + Number(r.target_count ?? 0), 0)) },
    { label: 'Tỉ lệ đã chấm', get: rs => pct(rs.reduce((s, r) => s + Number(r.graded_count ?? 0), 0), rs.reduce((s, r) => s + Number(r.submitted_count ?? 0), 0)) },
    { label: 'Bài nộp chờ chấm', get: rs => rs.reduce((s, r) => s + Math.max(0, Number(r.submitted_count ?? 0) - Number(r.graded_count ?? 0)), 0) },
  ],
  status: { get: r => r.status, labels: H_ST },
  search: r => `${r.title} ${r.class_name ?? ''} ${r.subject ?? ''}`, searchHint: 'Tên bài, lớp, môn…', noun: 'Bài tập', file: 'bai-tap-toan-he-thong', empty: 'Chưa có bài tập.',
}

export const CURRICULUM: Spec = {
  table: 'curriculum_books', order: 'grade', select: 'id, org_id, grade, subject, title, total_periods',
  cols: [
    { label: 'Khối', get: r => r.grade ?? '' },
    { label: 'Môn', get: r => r.subject ?? '' },
    { label: 'Sách / tài liệu', get: r => <b>{r.title}</b>, text: r => r.title, wrap: true },
    { label: 'Số tiết', get: r => r.total_periods ?? 0 },
  ],
  stats: [{ label: 'Tổng số tiết', get: rs => rs.reduce((s, r) => s + (r.total_periods ?? 0), 0) }, { label: 'Môn', get: rs => new Set(rs.map(r => r.subject)).size }],
  search: r => `${r.title} ${r.subject ?? ''}`, searchHint: 'Tên sách, môn…', noun: 'Đầu sách', file: 'phan-phoi-chuong-trinh-toan-he-thong', empty: 'Chưa có phân phối chương trình.',
}

const L_ST: Record<string, string> = { draft: 'Nháp', editing: 'Đang soạn', published: 'Đã xuất bản' }
export const LESSONS: Spec = {
  table: 'lesson_plans', order: 'updated_at', asc: false,
  select: 'id, org_id, title, subject, grades, program, status, is_template, from_package, updated_at, teachers(full_name)',
  cols: [
    { label: 'Bài giảng', get: r => <><b>{r.title}</b>{r.is_template && <> {pill('Mẫu')}</>}</>, text: r => r.title, wrap: true },
    { label: 'Giáo viên', get: r => r.teachers?.full_name ?? <small>—</small>, text: r => r.teachers?.full_name },
    { label: 'Môn · khối', get: r => [r.subject, r.grades].filter(Boolean).join(' · ') },
    { label: 'Chương trình', get: r => r.program ?? '' },
    { label: 'Cập nhật', get: r => fmtDate(r.updated_at) },
    { label: 'Trạng thái', get: r => stPill(L_ST, { published: 'active', editing: 'maintenance' })(r.status), text: r => L_ST[r.status] },
  ],
  stats: [
    { label: 'Đã xuất bản', get: rs => rs.filter(r => r.status === 'published').length },
    { label: 'Từ gói STEM', get: rs => rs.filter(r => r.from_package).length },
    { label: 'Giáo viên soạn', get: rs => new Set(rs.map(r => r.teachers?.full_name).filter(Boolean)).size },
  ],
  status: { get: r => r.status, labels: L_ST },
  search: r => `${r.title} ${r.subject ?? ''} ${r.teachers?.full_name ?? ''}`, searchHint: 'Tên bài, môn, giáo viên…', noun: 'Bài giảng', file: 'bai-giang-toan-he-thong', empty: 'Chưa có bài giảng.',
}
const A_KIND: Record<string, string> = { quiz: 'Trắc nghiệm', truefalse: 'Đúng / sai', match: 'Nối cặp', order: 'Sắp xếp', fill: 'Điền khuyết', group: 'Phân nhóm', flashcard: 'Thẻ ghi nhớ', worksheet: 'Phiếu học tập' }
export const ACTIVITIES: Spec = {
  table: 'activities', order: 'updated_at', asc: false,
  select: 'id, org_id, kind, title, subject, grades, status, is_template, updated_at, teachers(full_name)',
  cols: [
    { label: 'Hoạt động', get: r => <><b>{r.title}</b>{r.is_template && <> {pill('Mẫu')}</>}</>, text: r => r.title, wrap: true },
    { label: 'Loại', get: r => A_KIND[r.kind] ?? r.kind },
    { label: 'Giáo viên', get: r => r.teachers?.full_name ?? <small>—</small>, text: r => r.teachers?.full_name },
    { label: 'Môn · khối', get: r => [r.subject, r.grades].filter(Boolean).join(' · ') },
    { label: 'Cập nhật', get: r => fmtDate(r.updated_at) },
    { label: 'Trạng thái', get: r => stPill({ draft: 'Nháp', published: 'Đã xuất bản' }, { published: 'active' })(r.status), text: r => (r.status === 'published' ? 'Đã xuất bản' : 'Nháp') },
  ],
  stats: [
    { label: 'Đã xuất bản', get: rs => rs.filter(r => r.status === 'published').length },
    { label: 'Trắc nghiệm', get: rs => rs.filter(r => r.kind === 'quiz').length },
  ],
  status: { get: r => r.kind, labels: A_KIND },
  search: r => `${r.title} ${r.subject ?? ''} ${r.teachers?.full_name ?? ''}`, searchHint: 'Tên hoạt động, môn, giáo viên…', noun: 'Hoạt động', file: 'kho-hoat-dong-toan-he-thong', empty: 'Chưa có hoạt động.',
}

const TL_ST: Record<string, string> = { published: 'Đang dùng', draft: 'Nháp', inactive: 'Ngừng dùng' }
export const TRAINING_LESSONS: Spec = {
  table: 'training_lessons', order: 'created_on', asc: false,
  select: 'id, org_id, title, subject, grades, author, status, created_on, videos, docs, training_plans(name)',
  cols: [
    { label: 'Bài giảng tập huấn', get: r => <b>{r.title}</b>, text: r => r.title, wrap: true },
    { label: 'Kế hoạch', get: r => r.training_plans?.name ?? '' },
    { label: 'Môn · khối', get: r => [r.subject, r.grades].filter(Boolean).join(' · ') },
    { label: 'Tác giả', get: r => r.author ?? '' },
    { label: 'Video / tài liệu', get: r => `${r.videos ?? 0} / ${r.docs ?? 0}` },
    { label: 'Ngày tạo', get: r => fmtDate(r.created_on) },
    { label: 'Trạng thái', get: r => stPill(TL_ST, { published: 'active', inactive: 'inactive' })(r.status), text: r => TL_ST[r.status] },
  ],
  stats: [{ label: 'Đang dùng', get: rs => rs.filter(r => r.status === 'published').length }, { label: 'Video', get: rs => rs.reduce((s, r) => s + (r.videos ?? 0), 0) }],
  status: { get: r => r.status, labels: TL_ST },
  search: r => `${r.title} ${r.author ?? ''} ${r.training_plans?.name ?? ''}`, searchHint: 'Tên bài, tác giả, kế hoạch…', noun: 'Bài giảng', file: 'bai-giang-tap-huan-toan-he-thong', empty: 'Chưa có bài giảng tập huấn.',
}
export const VIRTUAL: Spec = {
  table: 'training_sessions', order: 'starts_at', asc: false, where: q => q.eq('mode', 'online'),
  select: 'id, org_id, title, starts_at, ends_at, location, meeting_url, training_plans(name, provider)',
  cols: [
    { label: 'Buổi học ảo', get: r => <b>{r.title}</b>, text: r => r.title, wrap: true },
    { label: 'Kế hoạch', get: r => r.training_plans?.name ?? '' },
    { label: 'Bắt đầu', get: r => fmtTime(r.starts_at) },
    { label: 'Kết thúc', get: r => fmtTime(r.ends_at) },
    { label: 'Liên kết', get: r => (r.meeting_url ? <a href={r.meeting_url} target="_blank" rel="noreferrer">Mở phòng</a> : <small>Chưa có</small>), text: r => r.meeting_url },
    { label: 'Tình trạng', get: r => (new Date(r.starts_at) > new Date() ? pill('Sắp diễn ra', 'maintenance') : pill('Đã diễn ra')), text: r => (new Date(r.starts_at) > new Date() ? 'Sắp diễn ra' : 'Đã diễn ra') },
  ],
  stats: [
    { label: 'Sắp diễn ra', get: rs => rs.filter(r => new Date(r.starts_at) > new Date()).length },
    { label: 'Chưa có liên kết', get: rs => rs.filter(r => !r.meeting_url).length },
  ],
  search: r => `${r.title} ${r.training_plans?.name ?? ''}`, searchHint: 'Tên buổi, kế hoạch…', noun: 'Buổi học ảo', file: 'lop-hoc-ao-toan-he-thong', empty: 'Chưa có buổi tập huấn trực tuyến.',
}

export const CERTIFICATES: Spec = {
  table: 'certificates', order: 'issued_on', asc: false,
  select: 'id, org_id, code, issued_on, teacher_id, teachers(full_name, subject), training_plans(name)',
  cols: [
    { label: 'Số chứng chỉ', get: r => <b>{r.code}</b>, text: r => r.code },
    { label: 'Giáo viên', get: r => <>{r.teachers?.full_name}<br /><small>{r.teachers?.subject}</small></>, text: r => r.teachers?.full_name },
    { label: 'Khoá tập huấn', get: r => r.training_plans?.name ?? '', wrap: true },
    { label: 'Ngày cấp', get: r => fmtDate(r.issued_on) },
  ],
  stats: [
    { label: 'Giáo viên được cấp', get: rs => new Set(rs.map(r => r.teacher_id)).size },
    { label: 'Cấp trong 30 ngày', get: rs => rs.filter(r => r.issued_on && Date.now() - +new Date(r.issued_on) < 30 * 864e5).length },
  ],
  search: r => `${r.code} ${r.teachers?.full_name ?? ''} ${r.training_plans?.name ?? ''}`, searchHint: 'Số chứng chỉ, giáo viên, khoá…', noun: 'Chứng chỉ', file: 'chung-chi-tap-huan-toan-he-thong', empty: 'Chưa cấp chứng chỉ nào.',
}

// ---------- Trang cho từng mục menu ----------
const one = (spec: Spec) => () => <SystemList key={spec.table} spec={spec} />
function TwoTabs({ tabs }: { tabs: [string, Spec][] }) {
  const [i, setI] = useState('0')
  const spec = tabs[Number(i)][1]
  return <><Tabs value={i} onChange={setI} items={tabs.map(([l], k) => [String(k), l] as [string, string])} /><SystemList key={spec.table} spec={spec} /></>
}

export const SysWarranty = one(WARRANTY)
export const SysBuildings = () => <TwoTabs tabs={[['Tòa nhà & tầng', BUILDINGS], ['Tiết học', PERIODS]]} />
export const SysTeachers = one(TEACHERS)
export const SysTeaching = one(TEACHING)
export const SysStudents = one(STUDENTS)
export const SysGuardians = one(GUARDIANS)
export const SysEduPlan = one(EDUPLAN)
export const SysRegistrations = one(REGISTRATIONS)
export const SysHomework = one(HOMEWORK)
export const SysCurriculum = one(CURRICULUM)
export const SysLessons = () => <TwoTabs tabs={[['Bài giảng', LESSONS], ['Kho hoạt động', ACTIVITIES]]} />
export const SysTrainingLessons = () => <TwoTabs tabs={[['Bài giảng tập huấn', TRAINING_LESSONS], ['Lớp học ảo', VIRTUAL]]} />
export const SysCertificates = one(CERTIFICATES)
