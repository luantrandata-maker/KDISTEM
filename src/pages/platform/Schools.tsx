// Quản trị chung → Cơ sở triển khai (migration 032)
// Sổ quản lý mọi trường đang triển khai trên toàn hệ thống: giai đoạn, tiến độ, hợp đồng, mức sử dụng, sức khoẻ, người phụ trách KDI.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, norm } from '../../lib/sheet'
import ImportExcel from '../../components/ImportExcel'
import SchoolLocationImport from '../../components/SchoolLocationImport'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { LEVEL, PROGRAMS, type SchoolStat } from '../department/data'
import { CUSTOMER_STATUS } from './Commerce'
import { STEPS, autoDone } from './Rollout'

type Health = 'good' | 'watch' | 'risk' | 'na'
type Stage = 'prospect' | 'setup' | 'rollout' | 'operating' | 'paused' | 'ended'
export type Reg = {
  org_id: string; code: string | null; name: string; level: string | null; ward: string | null; address: string | null
  parent_id: string | null; parent_name: string | null; province_id: string | null; province_name: string | null
  status: string; activated: boolean; customer_status: string | null
  contact_name: string | null; contact_phone: string | null; contact_email: string | null
  kdi_owner: string | null; kdi_owner_name: string | null; go_live_on: string | null; created_at: string
  ent_state: 'open' | 'active' | 'expired'; plan_name: string | null; contract_code: string | null; contract_ends_on: string | null; contract_source: string | null
  users: number; admins: number; pending_invites: number; last_login: string | null; last_activity: string | null
  active_teachers_7d: number; planned_4w: number; taught_4w: number; taught_14d: number
  rollout_done: number; rollout_total: number; kickoff_at: string | null; accepted_at: string | null
  open_tickets: number; urgent_tickets: number
  stage: Stage; health: Health; reasons: string[]; stats: SchoolStat | null
}
type Trend = { week_start: string; planned: number; taught: number; cancelled: number; present: number; absent: number; active_teachers: number }
type Staff = { id: string; full_name: string; email: string }

export const STAGE: Record<Stage, [string, string]> = {
  prospect: ['Tiềm năng', ''], setup: ['Khởi tạo', 'new'], rollout: ['Đang triển khai', 'info'],
  operating: ['Vận hành', 'ok'], paused: ['Tạm dừng', 'warn'], ended: ['Đã kết thúc', ''],
}
const HEALTH: Record<Health, [string, string, string]> = {
  good: ['Tốt', 'good', '✓'], watch: ['Cần chú ý', 'warn', '!'], risk: ['Nguy cơ', 'bad', '×'], na: ['—', '', ''],
}
const ENT: Record<string, [string, string]> = { active: ['Hiệu lực', 'ok'], expired: ['Hết hạn', 'bad'], open: ['Chưa có HĐ', ''] }
const nf = (n: number) => n.toLocaleString('vi-VN')
const day = (d: string | null) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('vi-VN') : '—'
const daysLeft = (d: string | null) => d ? Math.ceil((new Date(d + 'T23:59:59').getTime() - Date.now()) / 86400000) : null
const ago = (iso: string | null) => {
  if (!iso) return 'chưa có'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'hôm nay' : d === 1 ? 'hôm qua' : `${d} ngày trước`
}
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : null
const short = (n: string) => n.replace(/^Trường\s+/, '')
function errText(m: string) {
  return /schema cache|does not exist|function/i.test(m) ? 'Hãy chạy migration 032_platform_school_registry.sql trên Supabase.' : m
}
const HealthPill = ({ h }: { h: Health }) => h === 'na' ? <small>—</small>
  : <span className={'gpill ' + HEALTH[h][1]}><i aria-hidden="true">{HEALTH[h][2]}</i>{HEALTH[h][0]}</span>

type QuickF = 'all' | 'watch' | 'expiring' | 'noowner' | 'rollout'
const IMPORT_COLS = [
  { key: 'code', label: 'Mã trường', required: true, aliases: ['ma', 'ma truong'] },
  { key: 'name', label: 'Tên trường', required: true, aliases: ['ten', 'ten truong'] },
  { key: 'level', label: 'Cấp học', aliases: ['cap'] },
  { key: 'parent_code', label: 'Mã Sở/Phòng quản lý', required: true, aliases: ['ma so', 'ma don vi quan ly', 'don vi quan ly'] },
  { key: 'ward', label: 'Xã/phường', aliases: ['xa', 'phuong'] },
  { key: 'address', label: 'Địa chỉ' },
  { key: 'contact_name', label: 'Đầu mối', aliases: ['nguoi lien he'] },
  { key: 'contact_phone', label: 'Điện thoại', aliases: ['sdt', 'so dien thoai'] },
  { key: 'contact_email', label: 'Email' },
  { key: 'lat', label: 'Vĩ độ', aliases: ['vi do', 'lat'] },
  { key: 'lng', label: 'Kinh độ', aliases: ['kinh do', 'lng', 'lon'] },
  { key: 'coord', label: 'Toạ độ (dán từ Google Maps)', aliases: ['toa do', 'tọa độ'] },
]

export function PlatformSchools({ go }: { go?: (p: string) => void }) {
  const [rows, setRows] = useState<Reg[] | null>(null)
  const [staff, setStaff] = useState<Staff[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [q, setQ] = useState('')
  const [prov, setProv] = useState('')
  const [stage, setStage] = useState('')
  const [level, setLevel] = useState('')
  const [owner, setOwner] = useState('')
  const [quick, setQuick] = useState<QuickF>('all')
  const [sort, setSort] = useState<'health' | 'name' | 'usage' | 'progress'>('health')
  const [open, setOpen] = useState<string | null>(null)

  async function load() {
    const [r, s] = await Promise.all([supabase.rpc('platform_school_registry'), supabase.rpc('platform_staff')])
    if (r.error) { setErr(errText(r.error.message)); setRows([]); return }
    setErr(''); setRows((r.data as Reg[]) ?? []); setStaff((s.data as Staff[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const all = rows ?? []
  const provinces = useMemo(() => [...new Map(all.filter(r => r.province_id).map(r => [r.province_id!, r.province_name ?? ''])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'vi')), [rows])
  const n = norm(q)
  const filtered = all.filter(r => (!n || norm(`${r.name} ${r.code ?? ''} ${r.parent_name ?? ''} ${r.ward ?? ''}`).includes(n))
    && (!prov || r.province_id === prov) && (!stage || r.stage === stage) && (!level || r.level === level)
    && (!owner || (owner === '-' ? !r.kdi_owner : r.kdi_owner === owner))
    && (quick === 'all' || (quick === 'watch' && (r.health === 'watch' || r.health === 'risk'))
      || (quick === 'expiring' && r.ent_state === 'active' && (daysLeft(r.contract_ends_on) ?? 999) <= 60)
      || (quick === 'noowner' && !r.kdi_owner && r.stage !== 'ended')
      || (quick === 'rollout' && (r.stage === 'setup' || r.stage === 'rollout'))))
  const rank: Record<Health, number> = { risk: 0, watch: 1, good: 2, na: 3 }
  const shown = [...filtered].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name, 'vi')
    : sort === 'usage' ? (pct(b.taught_4w, b.planned_4w) ?? -1) - (pct(a.taught_4w, a.planned_4w) ?? -1)
    : sort === 'progress' ? b.rollout_done - a.rollout_done
    : rank[a.health] - rank[b.health] || a.name.localeCompare(b.name, 'vi'))
  const cur = all.find(r => r.org_id === open)

  if (rows === null) return <p className="sub">Đang tổng hợp các cơ sở…</p>
  if (cur) return <Profile r={cur} staff={staff} onBack={() => setOpen(null)} onSaved={load} go={go} />

  const cnt = (f: (r: Reg) => boolean) => all.filter(f).length
  function exportXlsx() {
    downloadXlsx('Co-so-trien-khai', [
      { key: 'a', label: 'Mã' }, { key: 'b', label: 'Trường', width: 34 }, { key: 'c', label: 'Cấp' }, { key: 'd', label: 'Tỉnh', width: 18 },
      { key: 'e', label: 'Sở/Phòng quản lý', width: 26 }, { key: 'f', label: 'Xã/phường', width: 18 }, { key: 'g', label: 'Giai đoạn' },
      { key: 'h', label: 'Sức khoẻ' }, { key: 'i', label: 'Lý do', width: 40 }, { key: 'j', label: 'Tiến độ (bước)' },
      { key: 'k', label: 'Hợp đồng' }, { key: 'l', label: 'Gói' }, { key: 'm', label: 'Hết hạn' }, { key: 'n', label: 'Tiết điểm danh / kế hoạch 4 tuần' },
      { key: 'o', label: 'GV hoạt động 7 ngày' }, { key: 'p', label: 'Tài khoản' }, { key: 'q', label: 'Đăng nhập gần nhất' },
      { key: 'r', label: 'Phiếu hỗ trợ mở' }, { key: 's', label: 'Phụ trách KDI', width: 22 }, { key: 't', label: 'Ngày vận hành' },
      { key: 'u', label: 'Đầu mối', width: 22 }, { key: 'v', label: 'Điện thoại' }, { key: 'w', label: 'Email', width: 26 },
    ], shown.map(r => [r.code, r.name, LEVEL[r.level ?? ''] ?? '', r.province_name, r.parent_name, r.ward, STAGE[r.stage][0], HEALTH[r.health][0],
      r.reasons.join('; '), `${r.rollout_done}/${r.rollout_total}`, ENT[r.ent_state][0], r.plan_name, r.contract_ends_on ? day(r.contract_ends_on) : '',
      `${r.taught_4w}/${r.planned_4w}`, r.active_teachers_7d, r.users, r.last_login ? day(r.last_login) : '', r.open_tickets,
      r.kdi_owner_name, r.go_live_on ? day(r.go_live_on) : '', r.contact_name, r.contact_phone, r.contact_email]), 'Cơ sở triển khai')
  }
  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const { data, error } = await supabase.rpc('platform_import_schools', { p_rows: recs.map(r => ({ ...r, line: r._line })) })
    if (error) throw new Error(errText(error.message))
    const d = data as { created: number; skipped: { line: number; code: string; reason: string }[] }
    await load()
    return `Đã tạo ${d.created} trường.` + (d.skipped.length ? ` Bỏ qua ${d.skipped.length} dòng: ${d.skipped.slice(0, 4).map(s => `dòng ${s.line} (${s.reason})`).join('; ')}${d.skipped.length > 4 ? '…' : ''}` : '')
  }

  return (
    <>
      <p className="sub">Mọi trường trên hệ thống: giai đoạn triển khai, hợp đồng, mức sử dụng thực tế và các điểm cần chú ý. Bấm một trường để xem hồ sơ.</p>
      <Tiles items={[
        { label: 'Tổng số trường', value: nf(all.length), sub: `${provinces.length} tỉnh` },
        { label: 'Đang vận hành', value: cnt(r => r.stage === 'operating'), tone: 'good' },
        { label: 'Đang triển khai', value: cnt(r => r.stage === 'rollout' || r.stage === 'setup'), sub: `${cnt(r => r.stage === 'setup')} mới khởi tạo` },
        { label: 'Cần chú ý', value: cnt(r => r.health === 'watch' || r.health === 'risk'), sub: `${cnt(r => r.health === 'risk')} nguy cơ`, tone: cnt(r => r.health === 'risk') ? 'bad' : 'warn' },
        { label: 'HĐ hết hạn ≤ 60 ngày', value: cnt(r => r.ent_state === 'active' && (daysLeft(r.contract_ends_on) ?? 999) <= 60), tone: 'warn' },
        { label: 'Tạm dừng', value: cnt(r => r.stage === 'paused') },
      ]} />
      <div className="bar">
        <Tabs<QuickF> value={quick} onChange={setQuick} items={[['all', 'Tất cả', all.length], ['watch', 'Cần chú ý', cnt(r => r.health === 'watch' || r.health === 'risk')],
          ['rollout', 'Đang triển khai', cnt(r => r.stage === 'setup' || r.stage === 'rollout')],
          ['expiring', 'HĐ sắp hết hạn', cnt(r => r.ent_state === 'active' && (daysLeft(r.contract_ends_on) ?? 999) <= 60)],
          ['noowner', 'Chưa có phụ trách', cnt(r => !r.kdi_owner && r.stage !== 'ended')]]} />
        <span className="tools">
          <ImportExcel label="Nhập trường từ Excel" columns={IMPORT_COLS} template="Mau-nhap-truong"
            sample={[['THCS-ABC', 'Trường THCS ABC', 'THCS', 'SO-HY', 'Phường Hiến Nam', '', 'Nguyễn Văn A', '0912345678', 'a@truong.edu.vn', '', '', '20.6560, 106.0560']]}
            onRecords={importRows} onMessage={(m, e) => setMsg([m, !!e])} />
          <button onClick={exportXlsx}>Xuất Excel</button>
          <SchoolLocationImport onDone={load} onMessage={(m, e) => setMsg([m, !!e])} />
        </span>
      </div>
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm tên, mã, Sở, xã/phường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" />
        <select value={prov} onChange={e => setProv(e.target.value)} aria-label="Tỉnh"><option value="">Mọi tỉnh</option>{provinces.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}</select>
        <select value={stage} onChange={e => setStage(e.target.value)} aria-label="Giai đoạn"><option value="">Mọi giai đoạn</option>{(Object.keys(STAGE) as Stage[]).map(k => <option key={k} value={k}>{STAGE[k][0]}</option>)}</select>
        <select value={level} onChange={e => setLevel(e.target.value)} aria-label="Cấp học"><option value="">Mọi cấp học</option>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={owner} onChange={e => setOwner(e.target.value)} aria-label="Người phụ trách"><option value="">Mọi người phụ trách</option><option value="-">Chưa gán</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp">
          <option value="health">Cần chú ý trước</option><option value="usage">Điểm danh cao trước</option><option value="progress">Tiến độ cao trước</option><option value="name">Theo tên</option></select>
        <small>{shown.length} trường</small>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {err && <p className="msg">{err}</p>}
      <div className="wrap"><table>
        <thead><tr><th>Trường</th><th>Tỉnh · Sở</th><th>Giai đoạn</th><th>Sức khoẻ</th><th>Tiến độ</th><th>Hợp đồng</th>
          <th>Điểm danh 4 tuần</th><th>Hoạt động</th><th>Phụ trách KDI</th></tr></thead>
        <tbody>{shown.map(r => {
          const dl = daysLeft(r.contract_ends_on); const u = pct(r.taught_4w, r.planned_4w)
          return (
            <tr key={r.org_id} className="rowlink" onClick={() => setOpen(r.org_id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setOpen(r.org_id) }}>
              <td><b>{short(r.name)}</b><br /><small>{[r.code, LEVEL[r.level ?? ''], r.ward].filter(Boolean).join(' · ')}</small></td>
              <td><small>{r.province_name ?? '—'}<br />{r.parent_name}</small></td>
              <td><span className={'plbadge ' + STAGE[r.stage][1]}>{STAGE[r.stage][0]}</span></td>
              <td><HealthPill h={r.health} />{r.reasons.length > 0 && <><br /><small title={r.reasons.join('\n')}>{r.reasons[0]}{r.reasons.length > 1 ? ` (+${r.reasons.length - 1})` : ''}</small></>}</td>
              <td style={{ minWidth: 90 }}><small>{r.rollout_done}/{r.rollout_total}</small>
                <div className="track"><div className={'fill ' + (r.rollout_done >= r.rollout_total ? 'g' : 'o')} style={{ width: (r.rollout_done / r.rollout_total) * 100 + '%' }} /></div></td>
              <td><span className={'plbadge ' + ENT[r.ent_state][1]}>{ENT[r.ent_state][0]}</span>
                {r.ent_state === 'active' && dl !== null && <><br /><small className={dl <= 60 ? 'due warn' : ''}>còn {dl} ngày</small></>}</td>
              <td>{r.planned_4w ? <>{u}% <small>({r.taught_4w}/{r.planned_4w})</small></> : <small>chưa có tiết</small>}</td>
              <td><small>{r.active_teachers_7d} GV dạy 7 ngày<br />đăng nhập: {ago(r.last_login)}</small>{r.open_tickets > 0 && <><br /><small className={r.urgent_tickets ? 'due bad' : ''}>{r.open_tickets} phiếu mở</small></>}</td>
              <td>{r.kdi_owner_name ?? <small>Chưa gán</small>}</td>
            </tr>
          )
        })}
        {shown.length === 0 && <tr><td colSpan={9}>Không có trường phù hợp.</td></tr>}</tbody>
      </table></div>
    </>
  )
}

// ================= Hồ sơ một trường =================
type PT = 'overview' | 'contract' | 'rollout' | 'usage' | 'users' | 'stem' | 'support'
type Contract = { id: string; code: string; org_id: string; starts_on: string; ends_on: string | null; status: string; include_children: boolean; service_plans: { name: string } | null }
type Ticket = { id: string; code: string | null; subject: string; priority: string; status: string; created_at: string }
type Audit = { id: number; at: string; summary: string }
type Member = { user_id: string; roles: { name: string } | null; profiles: { full_name: string; email: string | null } | null }
type Check = { step: string; done_at: string; note: string | null }
const TICKET_ST: Record<string, string> = { new: 'Mới', in_progress: 'Đang xử lý', waiting_customer: 'Chờ khách', resolved: 'Đã xử lý', closed: 'Đã đóng' }

function Profile({ r, staff, onBack, onSaved, go }: { r: Reg; staff: Staff[]; onBack: () => void; onSaved: () => Promise<void>; go?: (p: string) => void }) {
  const [tab, setTab] = useState<PT>('overview')
  const [trend, setTrend] = useState<Trend[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [audit, setAudit] = useState<Audit[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [checks, setChecks] = useState<Check[]>([])
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ kdi_owner: r.kdi_owner ?? '', go_live_on: r.go_live_on ?? '', customer_status: r.customer_status ?? '',
    contact_name: r.contact_name ?? '', contact_phone: r.contact_phone ?? '', contact_email: r.contact_email ?? '', address: r.address ?? '', ward: r.ward ?? '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function loadChecks() {
    const { data } = await supabase.from('rollout_checks').select('step, done_at, note').eq('org_id', r.org_id)
    setChecks((data as Check[]) ?? [])
  }
  useEffect(() => {
    supabase.rpc('platform_school_trend', { p_org: r.org_id }).then(({ data }) => setTrend((data as Trend[]) ?? []))
    supabase.from('contracts').select('id, code, org_id, starts_on, ends_on, status, include_children, service_plans(name)')
      .in('org_id', [r.org_id, r.parent_id, r.province_id].filter(Boolean) as string[]).order('starts_on', { ascending: false })
      .then(({ data }) => setContracts((data as unknown as Contract[]) ?? []))
    supabase.from('support_tickets').select('id, code, subject, priority, status, created_at').eq('org_id', r.org_id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setTickets((data as Ticket[]) ?? []))
    supabase.from('audit_log').select('id, at, summary').eq('org_id', r.org_id).order('at', { ascending: false }).limit(30)
      .then(({ data }) => setAudit((data as Audit[]) ?? []))
    supabase.from('memberships').select('user_id, roles(name), profiles(full_name, email)').eq('org_id', r.org_id).limit(500)
      .then(({ data }) => setMembers((data as unknown as Member[]) ?? []))
    loadChecks()
  }, [r.org_id])

  async function save() {
    setErr('')
    if (f.contact_email && !/^\S+@\S+\.\S+$/.test(f.contact_email)) return setErr('Email đầu mối không hợp lệ.')
    const { error } = await supabase.rpc('platform_update_school', { p_org: r.org_id, p_patch: f })
    if (error) return setErr(errText(error.message))
    setEdit(false); setMsg('Đã lưu.'); await onSaved()
  }
  async function toggleStep(step: string, on: boolean) {
    const q = on ? await supabase.from('rollout_checks').insert({ org_id: r.org_id, step })
      : await supabase.from('rollout_checks').delete().eq('org_id', r.org_id).eq('step', step)
    if (q.error) return setErr(q.error.message)
    await loadChecks(); await onSaved()
  }
  async function setStatus(status: 'active' | 'suspended') {
    if (status === 'suspended' && !confirm(`Tạm dừng ${r.name}? Thành viên của trường sẽ không vào làm việc được.`)) return
    const { error } = await supabase.from('organizations').update({ status }).eq('id', r.org_id)
    if (error) return setErr(error.message)
    setMsg(status === 'active' ? 'Đã mở lại trường.' : 'Đã tạm dừng trường.'); await onSaved()
  }

  const s = r.stats
  const dl = daysLeft(r.contract_ends_on)
  const maxW = Math.max(1, ...trend.map(t => t.planned))
  const roleCount = members.reduce<Record<string, number>>((m, x) => { const k = x.roles?.name ?? '?'; m[k] = (m[k] ?? 0) + 1; return m }, {})
  const openT = tickets.filter(t => !['resolved', 'closed'].includes(t.status))

  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={onBack}>← Danh sách</button>
          <b style={{ fontSize: 18 }}>{r.name}</b><span className={'plbadge ' + STAGE[r.stage][1]}>{STAGE[r.stage][0]}</span><HealthPill h={r.health} /></span>
        <span className="tools">
          {r.status === 'active' ? <button onClick={() => setStatus('suspended')}>Tạm dừng</button> : <button onClick={() => setStatus('active')}>Mở lại</button>}
          {go && <button onClick={() => go('Cây tổ chức')}>Mở trong Cây tổ chức</button>}
        </span>
      </div>
      <p className="sub">{[r.code, LEVEL[r.level ?? ''], r.ward, r.parent_name, r.province_name].filter(Boolean).join(' · ')}</p>
      {r.reasons.length > 0 && <div className={'panel ' + (r.health === 'risk' ? 'warnbox' : '')}><b>Cần chú ý:</b> {r.reasons.join(' · ')}</div>}
      {msg && <p className="sub"><b>{msg}</b></p>}
      {err && <p className="msg">{err}</p>}
      <Tabs<PT> value={tab} onChange={setTab} items={[['overview', 'Tổng quan'], ['contract', 'Hợp đồng & gói'], ['rollout', 'Triển khai', r.rollout_done],
        ['usage', 'Sử dụng'], ['users', 'Người dùng', r.users], ['stem', 'Chuyên môn STEM'], ['support', 'Hỗ trợ & nhật ký', openT.length]]} />

      {tab === 'overview' && (
        <>
          <Tiles items={[
            { label: 'Tiến độ triển khai', value: `${r.rollout_done}/${r.rollout_total}`, sub: r.accepted_at ? `nghiệm thu ${day(r.accepted_at)}` : r.kickoff_at ? `khởi động ${day(r.kickoff_at)}` : 'chưa khởi động' },
            { label: 'Hợp đồng', value: ENT[r.ent_state][0], sub: r.ent_state === 'active' ? `${r.plan_name ?? ''}${dl !== null ? ` · còn ${dl} ngày` : ''}` : r.contract_code ?? '', tone: r.ent_state === 'expired' ? 'bad' : dl !== null && dl <= 60 ? 'warn' : '' },
            { label: 'Điểm danh 4 tuần', value: r.planned_4w ? `${pct(r.taught_4w, r.planned_4w)}%` : '—', sub: `${r.taught_4w}/${r.planned_4w} tiết` },
            { label: 'GV hoạt động 7 ngày', value: r.active_teachers_7d, sub: s ? `trên ${s.teachers} GV` : '' },
            { label: 'Đăng nhập gần nhất', value: ago(r.last_login), sub: `${r.users} tài khoản` },
            { label: 'Phiếu hỗ trợ mở', value: r.open_tickets, sub: r.urgent_tickets ? `${r.urgent_tickets} khẩn` : '', tone: r.urgent_tickets ? 'bad' : '' },
          ]} />
          <div className="panel">
            <div className="bar"><h3>Thông tin quản lý</h3>{!edit && <button onClick={() => setEdit(true)}>Sửa</button>}</div>
            {edit ? (
              <div className="formgrid">
                <label className="field"><span>Người phụ trách KDI</span>
                  <select value={f.kdi_owner} onChange={e => setF({ ...f, kdi_owner: e.target.value })}><option value="">— Chưa gán —</option>
                    {staff.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></label>
                <label className="field"><span>Ngày vận hành chính thức</span><input type="date" value={f.go_live_on} onChange={e => setF({ ...f, go_live_on: e.target.value })} /></label>
                <label className="field"><span>Trạng thái khách hàng</span>
                  <select value={f.customer_status} onChange={e => setF({ ...f, customer_status: e.target.value })}><option value="">Theo Sở / chưa đặt</option>
                    {Object.entries(CUSTOMER_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="field"><span>Đầu mối của trường</span><input value={f.contact_name} onChange={e => setF({ ...f, contact_name: e.target.value })} /></label>
                <label className="field"><span>Điện thoại</span><input value={f.contact_phone} onChange={e => setF({ ...f, contact_phone: e.target.value })} /></label>
                <label className="field"><span>Email</span><input type="email" value={f.contact_email} onChange={e => setF({ ...f, contact_email: e.target.value })} /></label>
                <label className="field"><span>Xã/phường</span><input value={f.ward} onChange={e => setF({ ...f, ward: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Địa chỉ</span><input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></label>
                <div className="formactions" style={{ gridColumn: '1 / -1' }}><button className="primary" onClick={save}>Lưu</button> <button onClick={() => setEdit(false)}>Huỷ</button></div>
              </div>
            ) : (
              <dl className="kv">
                <dt>Người phụ trách KDI</dt><dd>{r.kdi_owner_name ?? <i>Chưa gán</i>}</dd>
                <dt>Ngày vận hành</dt><dd>{day(r.go_live_on)}</dd>
                <dt>Trạng thái khách hàng</dt><dd>{r.customer_status ? CUSTOMER_STATUS[r.customer_status] : '—'}</dd>
                <dt>Đầu mối</dt><dd>{[r.contact_name, r.contact_phone, r.contact_email].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>Địa chỉ</dt><dd>{[r.address, r.ward].filter(Boolean).join(', ') || '—'}</dd>
                <dt>Ngày tạo trên hệ thống</dt><dd>{day(r.created_at)}</dd>
              </dl>
            )}
          </div>
        </>
      )}

      {tab === 'contract' && (
        <>
          <p className="sub">Quyền dùng hiện tại: <b>{ENT[r.ent_state][0]}</b>{r.plan_name ? ` · gói ${r.plan_name}` : ''}{r.contract_source && r.contract_source !== r.name ? ` · theo hợp đồng của ${r.contract_source}` : ''}.
            {r.ent_state === 'open' && ' Chưa có hợp đồng nào trên cây — dùng không giới hạn.'}</p>
          <div className="wrap"><table>
            <thead><tr><th>Mã HĐ</th><th>Đơn vị ký</th><th>Gói</th><th>Hiệu lực</th><th>Trạng thái</th><th>Áp dụng trực thuộc</th></tr></thead>
            <tbody>{contracts.map(c => (
              <tr key={c.id}><td>{c.code}</td><td>{c.org_id === r.org_id ? 'Trường' : c.org_id === r.parent_id ? r.parent_name : r.province_name}</td>
                <td>{c.service_plans?.name}</td><td>{day(c.starts_on)} – {day(c.ends_on)}</td><td>{c.status}</td><td>{c.include_children ? 'Có' : 'Không'}</td></tr>
            ))}{contracts.length === 0 && <tr><td colSpan={6}>Chưa có hợp đồng.</td></tr>}</tbody>
          </table></div>
          {go && <p><button onClick={() => go('Gói dịch vụ & hợp đồng')}>Quản lý hợp đồng →</button></p>}
        </>
      )}

      {tab === 'rollout' && (
        <div className="panel">
          <p className="sub">Bước tự động tính từ dữ liệu trường; bước có ô đánh dấu do KDI xác nhận.</p>
          <ol className="checklist">
            {STEPS.map(st => {
              const c = checks.find(x => x.step === st.key)
              const done = st.manual ? !!c : !!s && autoDone(st.key, s, { org_id: r.org_id, state: r.ent_state })
              return (
                <li key={st.key} className={done ? 'done' : ''}>
                  {st.manual
                    ? <label><input type="checkbox" checked={done} onChange={e => toggleStep(st.key, e.target.checked)} /> {st.label}</label>
                    : <span>{done ? '✓' : '○'} {st.label}</span>}
                  {c && <small> · {day(c.done_at)}</small>}{!done && st.hint && <small> · {st.hint}</small>}
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {tab === 'usage' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Buổi dạy 8 tuần gần nhất</h3>
          {trend.every(t => !t.planned) ? <p className="sub">Chưa có buổi dạy nào trong 8 tuần (trường chưa có TKB hoặc chưa mở màn Buổi dạy).</p> : (
            <div className="trendbars">
              {trend.map(t => (
                <div key={t.week_start} title={`Tuần ${day(t.week_start)}: ${t.taught}/${t.planned} tiết đã điểm danh, ${t.cancelled} huỷ, ${t.active_teachers} GV`}>
                  <div className="tb"><span className="tbp" style={{ height: (t.planned / maxW) * 100 + '%' }} /><span className="tbt" style={{ height: (t.taught / maxW) * 100 + '%' }} /></div>
                  <small>{t.week_start.slice(8, 10)}/{t.week_start.slice(5, 7)}</small><small>{pct(t.taught, t.planned) ?? 0}%</small>
                </div>
              ))}
            </div>
          )}
          <p className="sub" style={{ marginTop: 8 }}><span className="legend p" /> tiết theo kế hoạch · <span className="legend t" /> tiết đã điểm danh. Hoạt động gần nhất trên hệ thống: {ago(r.last_activity)}.</p>
        </div>
      )}

      {tab === 'users' && (
        <>
          <Tiles items={[{ label: 'Tài khoản', value: r.users }, { label: 'Quản trị trường', value: r.admins, tone: r.admins ? '' : 'warn' },
            { label: 'Lời mời chưa nhận', value: r.pending_invites }, ...Object.entries(roleCount).slice(0, 3).map(([k, v]) => ({ label: k, value: v }))]} />
          <div className="wrap"><table>
            <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th></tr></thead>
            <tbody>{members.filter(m => m.roles?.name !== 'Học sinh').slice(0, 200).map((m, i) => (
              <tr key={m.user_id + i}><td>{m.profiles?.full_name}</td><td>{m.profiles?.email}</td><td>{m.roles?.name}</td></tr>
            ))}{members.length === 0 && <tr><td colSpan={3}>Chưa có tài khoản nào. Mời quản trị trường ở Người dùng & vai trò.</td></tr>}</tbody>
          </table></div>
          {go && <p><button onClick={() => go('Người dùng & vai trò')}>Quản lý người dùng & lời mời →</button></p>}
        </>
      )}

      {tab === 'stem' && (s ? (
        <>
          <Tiles items={[
            { label: 'KPI STEM', value: s.kpi }, { label: 'Giáo viên', value: s.teachers, sub: `${s.stem_teachers} dạy STEM · ${s.training_done} hoàn thành tập huấn` },
            { label: 'Học sinh', value: nf(s.students), sub: `${s.stem_students} học STEM · ${s.classes} lớp` },
            { label: 'Phòng STEM', value: `${s.rooms_active}/${s.rooms}`, sub: `${s.room_periods} tiết/tuần dùng phòng` },
            { label: 'Thiết bị', value: s.units, sub: `${s.units_broken} hỏng · ${s.units_maintenance} bảo trì` },
            { label: 'Giáo án tự soạn', value: s.lesson_plans, sub: `${s.products} dự án đã giao` },
          ]} />
          <p className="sub">Chương trình đang dạy: {PROGRAMS.filter(p => s.programs?.includes(p)).join(', ') || 'chưa có'}.</p>
        </>
      ) : <p className="sub">Chưa có số liệu chuyên môn.</p>)}

      {tab === 'support' && (
        <div className="twocol">
          <div className="panel">
            <div className="bar"><h3>Phiếu hỗ trợ</h3>{go && <button onClick={() => go('Vấn đề & phản hồi')}>Mở màn hỗ trợ →</button>}</div>
            {tickets.map(t => (
              <div className="roomrow" key={t.id}><span><b>{t.subject}</b><br /><small>{t.code} · {day(t.created_at)}</small></span>
                <span className={'plbadge ' + (t.priority === 'urgent' ? 'bad' : ['resolved', 'closed'].includes(t.status) ? 'ok' : 'warn')}>{TICKET_ST[t.status] ?? t.status}</span></div>
            ))}
            {tickets.length === 0 && <small>Chưa có phiếu nào.</small>}
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Nhật ký thay đổi</h3>
            {audit.map(a => <div className="roomrow" key={a.id}><span>{a.summary}</span><small>{day(a.at)}</small></div>)}
            {audit.length === 0 && <small>Chưa có thay đổi nào được ghi.</small>}
          </div>
        </div>
      )}
    </>
  )
}
