// Giám sát tập huấn (088, 113): một màn duy nhất — bộ lọc, số tổng quan, cảnh báo và một bảng đổi cách xem (trường / phòng / tỉnh / kế hoạch).
// Bấm một trường mở chi tiết: từng kế hoạch, từng GV, và việc cần làm (chọn GV, duyệt / trả lại danh sách).
// KDI / Sở / Phòng thấy các trường trong phạm vi, trường thấy dòng của mình.
// Cảnh báo: trường chưa chọn đủ GV theo chỉ tiêu, GV vắng nhiều, khoá sắp kết thúc mà còn GV chưa đủ điều kiện. Hiệu quả: mức năng lực trước / sau.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { Chip } from '../dist/Editor'
import { Bar } from './Competency'
import { Drawer } from '../../components/Drawer'
import { useAllOrgs, type ScopeOrg } from '../../components/OrgScope'
import { SchoolPlanWork } from './Plans'
import { FB_CRIT, FeedbackComments, score } from './Feedback'

type Row = { plan_id: string; plan_code: string | null; plan_name: string; plan_org: string | null; year_name: string | null; starts_on: string | null; ends_on: string | null
  org_id: string; org_name: string; quota: number | null; org_status: string; enrolled: number; sessions: number; sessions_closed: number
  att_pct: number | null; low_att: number; online_done: number; passed: number; failed: number; not_ready: number; certs: number }
type Eff = { competency: string; competency_name: string; teachers: number; before_avg: number | null; after_avg: number | null }
// Phiếu đánh giá sau khoá (114): theo kế hoạch × trường
type Fb = { plan_id: string; org_id: string; enrolled: number; responses: number; comments: number } & Record<typeof FB_CRIT[number][0], number | null>
type FbAgg = { n: number; enrolled: number; comments: number } & Record<typeof FB_CRIT[number][0], number | null>
function fbAgg(list: (Fb | undefined)[]): FbAgg {
  const xs = list.filter((x): x is Fb => !!x)
  const n = xs.reduce((t, x) => t + x.responses, 0)
  const avg = (k: typeof FB_CRIT[number][0]) => n ? xs.reduce((t, x) => t + Number(x[k] ?? 0) * x.responses, 0) / n : null
  return { n, enrolled: xs.reduce((t, x) => t + x.enrolled, 0), comments: xs.reduce((t, x) => t + x.comments, 0),
    ...Object.fromEntries(FB_CRIT.map(([k]) => [k, avg(k)])) } as FbAgg
}
const chipTone = (n: number | null) => n == null ? '' : n >= 4 ? 'good' : n >= 3 ? 'warn' : 'bad'
function FbCell({ a }: { a: FbAgg }) {
  if (!a.n) return <small className="sub">Chưa có phiếu</small>
  return <><Chip tone={chipTone(a.overall)}>{score(a.overall)}★</Chip><br /><small className="sub">{a.n}/{a.enrolled} phiếu</small></>
}
type Alert = { kind: 'quota' | 'att' | 'ready'; row: Row; text: string }

const ORG_ST: Record<string, [string, string]> = { assigned: ['Chưa gửi DS', 'warn'], submitted: ['Chờ duyệt DS', ''], returned: ['Bị trả lại', 'bad'], approved: ['Đã duyệt DS', 'good'] }
const vnDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 088 trên Supabase.' : m
const today = () => new Date().toISOString().slice(0, 10)

function alertsOf(r: Row): Alert[] {
  const a: Alert[] = []
  if (r.quota != null && r.enrolled < r.quota && (!r.ends_on || r.ends_on >= today()))
    a.push({ kind: 'quota', row: r, text: `${r.org_name} mới chọn ${r.enrolled}/${r.quota} GV theo chỉ tiêu` })
  if (r.low_att > 0) a.push({ kind: 'att', row: r, text: `${r.org_name}: ${r.low_att} GV vắng nhiều, dưới mức chuyên cần` })
  if (r.not_ready > 0) a.push({ kind: 'ready', row: r, text: `${r.org_name}: khoá kết thúc ${vnDate(r.ends_on)}, ${r.not_ready} GV chưa đủ điều kiện hoàn thành` })
  return a
}
const ALERT_ICON = { quota: '👥', att: '⏱', ready: '⚑' }
const KINDS: [Alert['kind'], string][] = [['quota', 'Chưa đủ GV theo chỉ tiêu'], ['att', 'GV vắng nhiều'], ['ready', 'Sắp kết thúc, GV chưa đủ ĐK']]
const OPEN_KEY = 'training.monitor.alerts'
const SCHOOL_OPEN_KEY = 'training.monitor.schoolAlerts'

// Gộp các dòng kế hoạch × trường thành một dòng mỗi trường
type School = { org_id: string; org_name: string; rows: Row[]; enrolled: number; quota: number; att: number | null; low_att: number; passed: number; certs: number; alerts: Alert[] }
function bySchool(rows: Row[]): School[] {
  const m = new Map<string, Row[]>()
  rows.forEach(r => m.set(r.org_id, [...(m.get(r.org_id) ?? []), r]))
  return [...m.values()].map(rs => {
    const enrolled = rs.reduce((s, r) => s + r.enrolled, 0)
    const withAtt = rs.filter(r => r.att_pct != null && r.enrolled)
    const attN = withAtt.reduce((s, r) => s + r.enrolled, 0)
    return { org_id: rs[0].org_id, org_name: rs[0].org_name, rows: rs, enrolled, quota: rs.reduce((s, r) => s + (r.quota ?? r.enrolled), 0),
      att: attN ? Math.round(withAtt.reduce((s, r) => s + Number(r.att_pct) * r.enrolled, 0) / attN) : null,
      low_att: rs.reduce((s, r) => s + r.low_att, 0), passed: rs.reduce((s, r) => s + r.passed, 0), certs: rs.reduce((s, r) => s + r.certs, 0), alerts: rs.flatMap(alertsOf) }
  }).sort((a, b) => b.alerts.length - a.alerts.length || a.org_name.localeCompare(b.org_name, 'vi'))
}
function AlertCounts({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <small className="tlok">Không có</small>
  return <span className="monkindmini">{KINDS.map(([k]) => { const n = alerts.filter(a => a.kind === k).length
    return n ? <span key={k} className={k} title={KINDS.find(x => x[0] === k)?.[1]}>{ALERT_ICON[k]} {n}</span> : null })}</span>
}

type View = 'school' | 'unit' | 'province' | 'plan'
const VIEWS: [View, string][] = [['school', 'Trường'], ['unit', 'Phòng / đơn vị quản lý'], ['province', 'Tỉnh'], ['plan', 'Kế hoạch']]
type St = '' | 'todo' | 'submitted' | 'approved'
const ST_OPTS: [St, string][] = [['', 'Mọi trạng thái danh sách'], ['todo', 'Cần chọn GV / bị trả lại'], ['submitted', 'Chờ duyệt danh sách'], ['approved', 'Đã duyệt danh sách']]
function ancestors(orgs: ScopeOrg[] | null) {
  const byId = new Map((orgs ?? []).map(o => [o.id, o]))
  return (id: string) => {
    let unit: ScopeOrg | null = null, prov: ScopeOrg | null = null
    const start = byId.get(id)
    for (let o = start?.parent_id ? byId.get(start.parent_id) : undefined, k = 0; o && k < 20; o = o.parent_id ? byId.get(o.parent_id) : undefined, k++) {
      if (o.type === 'province') { prov = o; break }
      if (!unit && o.type !== 'school' && !o.is_platform) unit = o
    }
    return { unit, prov }
  }
}
const uniq = (xs: [string, string][]) => [...new Map(xs).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))

/** work: được mở danh sách GV để chọn / gửi (KDI, trường). manage: được duyệt / trả lại danh sách (KDI). */
export function TrainingMonitorHub({ work = false, manage = false }: { work?: boolean; manage?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [eff, setEff] = useState<Eff[]>([])
  const [err, setErr] = useState('')
  const [rk, setRk] = useState(0)
  const [year, setYear] = useState('')
  const [prov, setProv] = useState('')
  const [unit, setUnit] = useState('')
  const [st, setSt] = useState<St>('')
  const [f, setF] = useState<'all' | 'alert' | 'running' | 'done'>('all')
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('school')
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true } })
  const [kind, setKind] = useState<'' | Alert['kind']>('')
  const [school, setSchool] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [doing, setDoing] = useState<{ plan: string; org: string } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [fb, setFb] = useState<Map<string, Fb>>(new Map())
  const [fbPlan, setFbPlan] = useState<string | null>(null)
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem(OPEN_KEY, v ? '1' : '0') } catch { /* bỏ qua */ } }
  const orgs = useAllOrgs()
  const anc = useMemo(() => ancestors(orgs), [orgs])
  useEffect(() => {
    supabase.rpc('training_monitor', { p_year: null }).then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows((data as Row[]) ?? []) })
  }, [rk])
  useEffect(() => {
    supabase.rpc('training_feedback_stats', { p_year: null }).then(({ data, error }) => { if (!error) setFb(new Map(((data as Fb[]) ?? []).map(x => [x.plan_id + '|' + x.org_id, x]))) })
  }, [rk])
  useEffect(() => { supabase.rpc('training_competency_effect').then(({ data }) => setEff((data as Eff[]) ?? [])) }, [])

  if (doing) return <SchoolPlanWork planId={doing.plan} orgId={doing.org} onBack={m => { setDoing(null); if (m) setMsg(m); setRk(k => k + 1) }} />

  const all = rows ?? []
  const yearOpts = uniq(all.map(r => r.year_name).filter((y): y is string => !!y).map(y => [y, `Năm học ${y}`] as [string, string])).reverse()
  const provOpts = uniq(all.map(r => anc(r.org_id).prov).filter((o): o is ScopeOrg => !!o).map(o => [o.id, o.name] as [string, string]))
  const unitOpts = uniq(all.filter(r => !prov || anc(r.org_id).prov?.id === prov).map(r => anc(r.org_id).unit).filter((o): o is ScopeOrg => !!o).map(o => [o.id, o.name] as [string, string]))
  const running = (r: Row) => (!r.starts_on || r.starts_on <= today()) && (!r.ends_on || r.ends_on >= today())
  const stOk = (r: Row) => !st || (st === 'todo' ? r.org_status === 'assigned' || r.org_status === 'returned' : r.org_status === st)
  // Phạm vi: mọi bộ lọc trừ nhóm nhanh (cảnh báo / đang diễn ra / đã kết thúc)
  const scope = all.filter(r => (!year || r.year_name === year) && (!prov || anc(r.org_id).prov?.id === prov) && (!unit || anc(r.org_id).unit?.id === unit) && stOk(r)
    && (!q || `${r.plan_code ?? ''} ${r.plan_name} ${r.org_name}`.toLowerCase().includes(q.toLowerCase())))
  const alerts = scope.flatMap(alertsOf)
  const hasAlert = new Set(alerts.map(a => a.row.plan_id + '|' + a.row.org_id))
  const shown = scope.filter(r => f === 'all' || (f === 'alert' ? hasAlert.has(r.plan_id + '|' + r.org_id) : f === 'running' ? running(r) : !!r.ends_on && r.ends_on < today()))
  const schools = bySchool(shown)
  const kindAlerts = alerts.filter(a => !kind || a.kind === kind)
  const sum = (k: keyof Row) => shown.reduce((t, r) => t + (Number(r[k]) || 0), 0)
  const quota = shown.reduce((t, r) => t + (r.quota ?? r.enrolled), 0)
  const attRows = shown.filter(r => r.att_pct != null && r.enrolled)
  const attN = attRows.reduce((t, r) => t + r.enrolled, 0)
  const attAvg = attN ? Math.round(attRows.reduce((t, r) => t + Number(r.att_pct) * r.enrolled, 0) / attN) : null
  const full = schools.filter(s => s.enrolled >= s.quota).length
  const nSt = (...xs: string[]) => shown.filter(r => xs.includes(r.org_status)).length
  const multi = new Set(all.map(r => r.org_id)).size > 1
  const fbOf = (rs: Row[]) => fbAgg(rs.map(r => fb.get(r.plan_id + '|' + r.org_id)))
  const fbAll = fbOf(shown)
  const fbPlans = [...new Map(shown.map(r => [r.plan_id, r])).values()].map(r => ({ r, a: fbOf(shown.filter(x => x.plan_id === r.plan_id)) }))
    .filter(x => x.a.enrolled > 0).sort((a, b) => b.a.n - a.a.n || a.r.plan_name.localeCompare(b.r.plan_name, 'vi'))
  const sel = school ? bySchool(all.filter(r => r.org_id === school && (!year || r.year_name === year)))[0] : null

  // Gộp theo phòng / tỉnh
  const groups = (by: 'unit' | 'province') => {
    const m = new Map<string, { key: string; name: string; list: School[] }>()
    schools.forEach(s => { const o = by === 'unit' ? anc(s.org_id).unit : anc(s.org_id).prov
      const k = o?.id ?? '-', g = m.get(k) ?? { key: k, name: o?.name ?? (by === 'unit' ? 'Chưa gắn đơn vị quản lý' : 'Chưa gắn tỉnh'), list: [] }; g.list.push(s); m.set(k, g) })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }
  const agg = (l: School[]) => { const e = l.reduce((t, s) => t + s.enrolled, 0), qq = l.reduce((t, s) => t + s.quota, 0), p = l.reduce((t, s) => t + s.passed, 0)
    const w = l.filter(s => s.att != null), wn = w.reduce((t, s) => t + s.enrolled, 0)
    return { e, qq, p, att: wn ? Math.round(w.reduce((t, s) => t + (s.att ?? 0) * s.enrolled, 0) / wn) : null, c: l.reduce((t, s) => t + s.certs, 0), al: l.flatMap(s => s.alerts) } }
  const pickGroup = (k: string) => { if (view === 'unit') setUnit(k === '-' ? '' : k); else { setProv(k === '-' ? '' : k); setUnit('') } setView('school') }

  async function review(r: Row, ok: boolean) {
    const note = ok ? null : prompt(`Lý do trả lại danh sách của ${r.org_name}:`)
    if (!ok && !note?.trim()) return
    const { error } = await supabase.rpc('training_plan_review', { p_plan: r.plan_id, p_org: r.org_id, p_approve: ok, p_note: note })
    setMsg(error ? [error.message, true] : [ok ? `Đã duyệt danh sách của ${r.org_name}.` : `Đã trả lại danh sách cho ${r.org_name}.`, false])
    setRk(k => k + 1)
  }
  function excel() {
    downloadXlsx(`giam-sat-tap-huan${year ? '-' + year : ''}`, [{ key: 'c', label: 'Mã KH' }, { key: 'p', label: 'Kế hoạch', width: 34 }, { key: 'u', label: 'Đơn vị lập', width: 22 },
      { key: 'y', label: 'Năm học' }, { key: 's', label: 'Bắt đầu' }, { key: 'e', label: 'Kết thúc' }, { key: 'o', label: 'Trường', width: 28 }, { key: 'ph', label: 'Phòng / đơn vị quản lý', width: 24 },
      { key: 'tn', label: 'Tỉnh', width: 16 }, { key: 'st', label: 'Danh sách' }, { key: 'q', label: 'Chỉ tiêu' }, { key: 'n', label: 'Đã chọn GV' }, { key: 'ss', label: 'Buổi đã chốt / tổng' },
      { key: 'a', label: 'Chuyên cần %' }, { key: 'la', label: 'GV vắng nhiều' }, { key: 'on', label: 'Hoàn thành học trực tuyến' }, { key: 'ps', label: 'Đạt' }, { key: 'fl', label: 'Chưa đạt' },
      { key: 'cr', label: 'Chứng chỉ' }, { key: 'w', label: 'Cảnh báo', width: 50 }],
      shown.map(r => [r.plan_code, r.plan_name, r.plan_org, r.year_name, vnDate(r.starts_on), vnDate(r.ends_on), r.org_name, anc(r.org_id).unit?.name ?? '', anc(r.org_id).prov?.name ?? '',
        ORG_ST[r.org_status]?.[0] ?? r.org_status, r.quota ?? '', r.enrolled, `${r.sessions_closed}/${r.sessions}`, r.att_pct ?? '', r.low_att, r.online_done, r.passed, r.failed, r.certs,
        alertsOf(r).map(a => a.text).join('; ')]), 'Giám sát')
  }
  const filtered = !!(year || prov || unit || st || q || f !== 'all')
  const schoolTable = (list: School[]) => <><div className="wrap"><table className="libtable">
    <thead><tr><th>Trường</th><th>Kế hoạch</th><th>GV / chỉ tiêu</th><th>Danh sách GV</th><th>Chuyên cần</th><th>Đạt</th><th>Chứng chỉ</th><th>Hài lòng</th><th>Cảnh báo</th></tr></thead>
    <tbody>{(more ? list : list.slice(0, 15)).map(s => { const todo = s.rows.filter(r => r.org_status === 'assigned' || r.org_status === 'returned').length, sub = s.rows.filter(r => r.org_status === 'submitted').length
      return <tr key={s.org_id} className="clickrow" tabIndex={0} onClick={() => setSchool(s.org_id)} onKeyDown={e => { if (e.key === 'Enter') setSchool(s.org_id) }}>
        <td><b>{s.org_name}</b>{(anc(s.org_id).unit || anc(s.org_id).prov) && <><br /><small className="sub">{[anc(s.org_id).unit?.name, anc(s.org_id).prov?.name].filter(Boolean).join(' · ')}</small></>}</td>
        <td>{s.rows.length}</td>
        <td style={{ whiteSpace: 'nowrap' }}><Bar v={pct(s.enrolled, s.quota)} warnBelow={100} /> {s.enrolled}/{s.quota}</td>
        <td>{todo ? <Chip tone="warn">{todo} cần chọn GV</Chip> : null}{sub ? <> <Chip>{sub} chờ duyệt</Chip></> : null}{!todo && !sub && <small className="tlok">Đã xong</small>}</td>
        <td>{s.att == null ? '—' : `${s.att}%`}{s.low_att > 0 && <><br /><small className="warnline">{s.low_att} GV vắng nhiều</small></>}</td>
        <td>{s.passed} <small className="sub">({pct(s.passed, s.enrolled)}%)</small></td><td>{s.certs}</td><td><FbCell a={fbOf(s.rows)} /></td><td><AlertCounts alerts={s.alerts} /></td></tr> })}
      {!list.length && <tr><td colSpan={9}><small className="sub">{all.length ? 'Không có trường nào khớp bộ lọc.' : 'Chưa có kế hoạch tập huấn đã phát hành được giao cho trường.'}</small></td></tr>}</tbody>
  </table></div>
    {list.length > 15 && <button type="button" className="linkbtn" onClick={() => setMore(!more)}>{more ? 'Thu gọn' : `Xem cả ${list.length} trường`}</button>}</>

  return <>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">📋</i><span><b>{rows ? new Set(shown.map(r => r.plan_id)).size : '…'}</b><small>Kế hoạch đang theo dõi</small><small>{shown.length} lượt giao · {schools.length} trường</small></span></div>
      <div className="panel"><i aria-hidden="true" className={pct(sum('enrolled'), quota) >= 90 ? 'good' : 'warn'}>👥</i><span><b>{sum('enrolled')}{quota ? `/${quota}` : ''}</b><small>GV đã chọn / chỉ tiêu</small><small>{full}/{schools.length} trường đủ chỉ tiêu</small></span></div>
      <div className="panel"><i aria-hidden="true" className={nSt('assigned', 'returned') ? 'warn' : 'good'}>📝</i><span><b>{nSt('assigned', 'returned')}</b><small>Lượt cần chọn GV · {nSt('returned')} bị trả lại</small><small>{nSt('submitted')} chờ duyệt · {nSt('approved')} đã duyệt</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{sum('passed')}</b><small>GV Đạt · {pct(sum('passed'), sum('enrolled'))}% · {sum('certs')} chứng chỉ</small><small>Chuyên cần {attAvg == null ? '—' : `${attAvg}%`} · {sum('low_att')} GV vắng nhiều</small></span></div>
    </div>
    {err && <p className="msg" role="alert">{err}</p>}
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      <div className="distfilter">
        <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học"><option value="">Mọi năm học</option>{yearOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {provOpts.length > 1 && <select value={prov} onChange={e => { setProv(e.target.value); setUnit('') }} aria-label="Tỉnh"><option value="">Mọi tỉnh</option>{provOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        {unitOpts.length > 1 && <select value={unit} onChange={e => setUnit(e.target.value)} aria-label="Phòng / đơn vị quản lý"><option value="">Mọi phòng / đơn vị</option>{unitOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        <select value={st} onChange={e => setSt(e.target.value as St)} aria-label="Trạng thái danh sách">{ST_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input placeholder="Tìm kế hoạch, trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm kế hoạch, trường" />
        {filtered && <button type="button" className="fclear" onClick={() => { setYear(''); setProv(''); setUnit(''); setSt(''); setQ(''); setF('all') }}>Bỏ lọc</button>}
        <button type="button" onClick={excel} disabled={!shown.length}>Xuất Excel</button>
      </div>
      <div className="distfilter">{([['all', 'Tất cả'], ['alert', 'Có cảnh báo'], ['running', 'Đang diễn ra'], ['done', 'Đã kết thúc']] as const)
        .map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l}{k === 'alert' ? ` (${hasAlert.size})` : ''}</button>)}</div>
    </section>
    {alerts.length > 0 && <section className="panel monalerts" style={{ marginTop: 14 }}>
      <div className="monhead">
        <h3 style={{ margin: 0 }}>Cảnh báo ({alerts.length})</h3>
        <div className="monkinds" role="group" aria-label="Lọc theo loại cảnh báo">{KINDS.map(([k, l]) => { const n = alerts.filter(a => a.kind === k).length
          return <button key={k} type="button" className={`monkind ${k}${kind === k ? ' on' : ''}`} aria-pressed={kind === k} disabled={!n}
            onClick={() => { setKind(kind === k ? '' : k); toggle(true) }}><span aria-hidden="true">{ALERT_ICON[k]}</span><b>{n}</b>{l}</button> })}</div>
        <button type="button" className="linkbtn" aria-expanded={open} onClick={() => toggle(!open)}>{open ? 'Thu gọn ▴' : 'Mở rộng ▾'}</button>
      </div>
      {open && <><ul>{kindAlerts.slice(0, 12).map((a, i) => <li key={i} className={a.kind}><button type="button" onClick={() => setSchool(a.row.org_id)} title="Xem chi tiết trường">
        <span aria-hidden="true">{ALERT_ICON[a.kind]}</span><span>{a.text}<br /><small className="sub">{a.row.plan_code} · {a.row.plan_name}</small></span></button></li>)}</ul>
      {kindAlerts.length > 12 && <button type="button" className="linkbtn" onClick={() => { setF('alert'); setView('plan') }}>Xem cả {kindAlerts.length} cảnh báo trong bảng</button>}</>}
    </section>}
    <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      <div className="monhead">
        {multi ? <div className="segmented viewtoggle" role="group" aria-label="Xem theo">{VIEWS.map(([k, l]) =>
          <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
          : <h3 style={{ margin: 0 }}>Theo kế hoạch</h3>}
        <small className="sub">{view === 'school' ? 'Bấm một trường để xem từng kế hoạch, từng giáo viên và việc cần làm' : view === 'plan' ? 'Bấm tên trường để xem chi tiết' : 'Bấm một dòng để xem các trường thuộc đơn vị đó'}</small>
      </div>
      {!rows ? <p className="sub">Đang tải…</p> : multi && view === 'school' ? schoolTable(schools)
        : multi && (view === 'unit' || view === 'province') ? <div className="wrap"><table className="libtable">
          <thead><tr><th>{view === 'unit' ? 'Phòng / đơn vị quản lý' : 'Tỉnh'}</th><th>Trường</th><th>GV / chỉ tiêu</th><th>Chuyên cần</th><th>Đạt</th><th>Chứng chỉ</th><th>Hài lòng</th><th>Cảnh báo</th></tr></thead>
          <tbody>{groups(view).map(g => { const a = agg(g.list)
            return <tr key={g.key} className="clickrow" tabIndex={0} onClick={() => pickGroup(g.key)} onKeyDown={e => { if (e.key === 'Enter') pickGroup(g.key) }}>
              <td><b>{g.name}</b></td><td>{g.list.length} <small className="sub">({g.list.filter(s => s.enrolled >= s.quota).length} đủ chỉ tiêu)</small></td>
              <td style={{ whiteSpace: 'nowrap' }}><Bar v={pct(a.e, a.qq)} warnBelow={100} /> {a.e}/{a.qq}</td><td>{a.att == null ? '—' : `${a.att}%`}</td>
              <td>{a.p} <small className="sub">({pct(a.p, a.e)}%)</small></td><td>{a.c}</td><td><FbCell a={fbOf(g.list.flatMap(s => s.rows))} /></td><td><AlertCounts alerts={a.al} /></td></tr> })}
            {!schools.length && <tr><td colSpan={8}><small className="sub">Không có số liệu khớp bộ lọc.</small></td></tr>}</tbody>
        </table></div>
        : <div className="wrap"><table className="libtable">
          <thead><tr><th>Kế hoạch</th><th>Trường</th><th>GV / chỉ tiêu</th><th>Buổi học</th><th>Chuyên cần</th><th>Học trực tuyến</th><th>Kết quả</th><th>Chứng chỉ</th><th>Hài lòng</th></tr></thead>
          <tbody>{shown.map(r => <tr key={r.plan_id + r.org_id}>
            <td><b>{r.plan_name}</b><br /><small className="sub">{r.plan_code} · {r.plan_org} · {vnDate(r.starts_on)} – {vnDate(r.ends_on)}</small></td>
            <td><button type="button" className="linkbtn" onClick={() => setSchool(r.org_id)}>{r.org_name}</button><br /><Chip tone={ORG_ST[r.org_status]?.[1]}>{ORG_ST[r.org_status]?.[0] ?? r.org_status}</Chip></td>
            <td style={{ whiteSpace: 'nowrap' }}>{r.quota != null ? <><Bar v={pct(r.enrolled, r.quota)} warnBelow={100} /> {r.enrolled}/{r.quota}</> : r.enrolled}</td>
            <td>{r.sessions_closed}/{r.sessions} <small className="sub">đã chốt</small></td>
            <td>{r.att_pct == null ? '—' : `${num(r.att_pct)}%`}{r.low_att > 0 && <><br /><small className="warnline">{r.low_att} GV vắng nhiều</small></>}</td>
            <td>{r.online_done}/{r.enrolled}</td>
            <td><span className="tlok">{r.passed} Đạt</span>{r.failed > 0 && <> · <span className="warnline">{r.failed} chưa đạt</span></>}
              {r.not_ready > 0 && <><br /><small className="warnline">{r.not_ready} GV chưa đủ ĐK, sắp kết thúc</small></>}</td>
            <td>{r.certs}</td><td><FbCell a={fbOf([r])} /></td></tr>)}
            {!shown.length && <tr><td colSpan={9}><small className="sub">{all.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có kế hoạch tập huấn đã phát hành được giao cho trường.'}</small></td></tr>}</tbody>
        </table></div>}
    </section>
    <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }} aria-label="Mức hài lòng sau tập huấn">
      <div className="monhead"><h3 style={{ margin: 0 }}>Mức hài lòng sau tập huấn</h3>
        <small className="sub">{fbAll.n ? <>Trung bình chung <b>{score(fbAll.overall)}★</b> · {fbAll.n}/{fbAll.enrolled} GV đã gửi phiếu ({pct(fbAll.n, fbAll.enrolled)}%) · {fbAll.comments} góp ý</> : 'Giáo viên gửi phiếu ở trang khoá học khi khoá kết thúc.'}</small></div>
      {fbPlans.length > 0 && <div className="wrap"><table className="libtable">
        <thead><tr><th>Kế hoạch</th><th>Phiếu</th>{FB_CRIT.map(([k, l]) => <th key={k}>{l}</th>)}<th>Góp ý</th></tr></thead>
        <tbody>{fbPlans.map(({ r, a }) => <FbPlanRow key={r.plan_id} r={r} a={a} open={fbPlan === r.plan_id} onToggle={() => setFbPlan(fbPlan === r.plan_id ? null : r.plan_id)} />)}</tbody>
      </table></div>}
    </section>
    <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      <h3 style={{ margin: 0 }}>Năng lực trước / sau tập huấn</h3>
      <p className="sub" style={{ margin: 0 }}>Giáo viên đã Đạt khoá tập huấn: mức trung bình ở đánh giá năng lực gần nhất trước năm học của khoá so với đánh giá từ năm học của khoá trở đi, theo năng lực đích của chương trình.</p>
      {eff.length ? <div className="wrap"><table className="libtable">
        <thead><tr><th>Năng lực</th><th>Số GV</th><th>Trước</th><th>Sau</th><th>Thay đổi</th></tr></thead>
        <tbody>{eff.map(e => { const d = e.before_avg != null && e.after_avg != null ? Number(e.after_avg) - Number(e.before_avg) : null
          return <tr key={e.competency}><td>{e.competency_name}</td><td>{e.teachers}</td><td>{num(e.before_avg)}</td><td>{num(e.after_avg)}</td>
            <td>{d == null ? <small className="sub">chưa đủ dữ liệu</small> : <Chip tone={d > 0 ? 'good' : d < 0 ? 'bad' : ''}>{d > 0 ? '+' : ''}{num(Math.round(d * 100) / 100)}</Chip>}</td></tr> })}</tbody>
      </table></div> : <small className="sub">Chưa có giáo viên Đạt khoá tập huấn có năng lực đích.</small>}
    </section>
    {sel && <SchoolDetail s={sel} year={year} fb={fb} onClose={() => setSchool(null)} work={work} manage={manage}
      onWork={r => { setSchool(null); setDoing({ plan: r.plan_id, org: r.org_id }) }} onReview={review} />}
  </>
}

// Chi tiết một trường: số tổng quan, cảnh báo, từng kế hoạch được giao kèm việc cần làm, từng giáo viên
function SchoolDetail({ s, year, fb, onClose, work, manage, onWork, onReview }: { s: School; year: string; fb: Map<string, Fb>; onClose: () => void; work: boolean; manage: boolean
  onWork: (r: Row) => void; onReview: (r: Row, ok: boolean) => void }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(SCHOOL_OPEN_KEY) !== '0' } catch { return true } })
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem(SCHOOL_OPEN_KEY, v ? '1' : '0') } catch { /* bỏ qua */ } }
  const [cm, setCm] = useState<string | null>(null)
  const fbOf = (r: Row) => fbAgg([fb.get(r.plan_id + '|' + r.org_id)])
  return <Drawer title={<><b>{s.org_name}</b><br /><small className="sub">{s.rows.length} kế hoạch tập huấn được giao</small></>} onClose={onClose}>
    <div className="diststatcards four">
      <div className="panel"><span><b>{s.enrolled}/{s.quota}</b><small>GV đã chọn / chỉ tiêu</small></span></div>
      <div className="panel"><span><b>{s.att == null ? '—' : `${s.att}%`}</b><small>Chuyên cần</small><small>{s.low_att} GV vắng nhiều</small></span></div>
      <div className="panel"><span><b>{s.passed}</b><small>GV Đạt · {pct(s.passed, s.enrolled)}%</small></span></div>
      <div className="panel"><span><b>{s.certs}</b><small>Chứng chỉ đã cấp</small></span></div>
    </div>
    {s.alerts.length > 0 && <section className="monalerts" style={{ marginTop: 14 }}>
      <div className="monhead"><h3 style={{ margin: 0 }}>Cảnh báo ({s.alerts.length})</h3><AlertCounts alerts={s.alerts} />
        <button type="button" className="linkbtn" aria-expanded={open} onClick={() => toggle(!open)}>{open ? 'Thu gọn ▴' : 'Mở rộng ▾'}</button></div>
      {open && <ul>{s.alerts.map((a, i) => <li key={i} className={a.kind}><span aria-hidden="true">{ALERT_ICON[a.kind]}</span>
        <span>{a.text}<br /><small className="sub">{a.row.plan_code} · {a.row.plan_name}</small></span></li>)}</ul>}
    </section>}
    <h3 style={{ margin: '16px 0 8px' }}>Theo từng kế hoạch</h3>
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Kế hoạch</th><th>GV / chỉ tiêu</th><th>Chuyên cần</th><th>Kết quả</th><th>Chứng chỉ</th><th>Hài lòng</th></tr></thead>
      <tbody>{s.rows.map(r => { const todo = r.org_status === 'assigned' || r.org_status === 'returned'
        return <tr key={r.plan_id}>
        <td><b>{r.plan_name}</b><br /><small className="sub">{r.plan_code} · {vnDate(r.starts_on)} – {vnDate(r.ends_on)}</small><br />
          <small className="sub">Buổi đã chốt {r.sessions_closed}/{r.sessions} · Học trực tuyến {r.online_done}/{r.enrolled}</small><br />
          <Chip tone={ORG_ST[r.org_status]?.[1]}>{ORG_ST[r.org_status]?.[0] ?? r.org_status}</Chip>
          {(work || (manage && r.org_status === 'submitted')) && <div className="tools" style={{ marginTop: 6 }}>
            {work && <button type="button" className={todo ? 'primary' : ''} onClick={() => onWork(r)}>{todo ? 'Chọn giáo viên' : 'Danh sách giáo viên'}</button>}
            {manage && r.org_status === 'submitted' && <><button type="button" className="primary" onClick={() => onReview(r, true)}>Duyệt DS</button>
              <button type="button" onClick={() => onReview(r, false)}>Trả lại</button></>}</div>}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{r.quota != null ? <><Bar v={pct(r.enrolled, r.quota)} warnBelow={100} /> {r.enrolled}/{r.quota}</> : r.enrolled}</td>
        <td>{r.att_pct == null ? '—' : `${num(r.att_pct)}%`}{r.low_att > 0 && <><br /><small className="warnline">{r.low_att} GV vắng nhiều</small></>}</td>
        <td><span className="tlok" style={{ whiteSpace: 'nowrap' }}>{r.passed} Đạt</span>{r.failed > 0 && <><br /><small className="warnline">{r.failed} chưa đạt</small></>}
          {r.not_ready > 0 && <><br /><small className="warnline">{r.not_ready} GV chưa đủ ĐK</small></>}</td>
        <td>{r.certs}</td><td><FbCell a={fbOf(r)} />{fbOf(r).comments > 0 && <><br /><button type="button" className="linkbtn" aria-expanded={cm === r.plan_id}
          onClick={() => setCm(cm === r.plan_id ? null : r.plan_id)}>{cm === r.plan_id ? 'Ẩn góp ý' : `${fbOf(r).comments} góp ý`}</button></>}</td></tr> })}</tbody>
    </table></div>
    {cm && <section className="panel" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
      <b>Góp ý của giáo viên · {s.rows.find(r => r.plan_id === cm)?.plan_name}</b>
      <FeedbackComments planId={cm} orgId={s.org_id} /></section>}
    <SchoolTeachers orgId={s.org_id} year={year} />
  </Drawer>
}

// Từng giáo viên của trường: chuyên cần, bài học, bài kiểm tra, sản phẩm, kết quả, chứng chỉ (113)
type Metrics = { sessions: number; present: number; excused: number; att_pct: number | null; att_req: number; units: number; done: number
  tests: number; tests_passed: number; need_product: boolean; product_status: string | null
  ok_att: boolean; ok_tests: boolean; ok_units: boolean; ok_product: boolean; suggest: 'pass' | 'fail' }
type TRow = { plan_id: string; plan_code: string | null; plan_name: string; teacher_id: string; teacher_name: string; metrics: Metrics; result: string | null; cert: boolean }
const PROD: Record<string, string> = { submitted: 'đã nộp, chờ duyệt', accepted: 'đã duyệt', returned: 'bị trả lại' }
const missing = (m: Metrics) => [!m.ok_att && 'chuyên cần', !m.ok_units && 'bài học', !m.ok_tests && 'bài kiểm tra', !m.ok_product && 'sản phẩm'].filter(Boolean).join(', ')
function SchoolTeachers({ orgId, year }: { orgId: string; year: string }) {
  const [rows, setRows] = useState<TRow[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<'all' | 'att' | 'ready' | 'pass'>('all')
  useEffect(() => {
    supabase.rpc('training_monitor_teachers', { p_org: orgId, p_year: year || null }).then(({ data, error }) => {
      if (error) setErr(/schema cache|does not exist|Could not find/i.test(error.message) ? 'Hãy chạy migration 113 trên Supabase để xem từng giáo viên.' : error.message)
      setRows((data as TRow[]) ?? [])
    })
  }, [orgId, year])
  const lowAtt = (r: TRow) => !r.metrics.ok_att
  const notReady = (r: TRow) => r.result !== 'pass' && r.metrics.suggest !== 'pass'
  const shown = (rows ?? []).filter(r => f === 'all' || (f === 'att' ? lowAtt(r) : f === 'ready' ? notReady(r) : r.result === 'pass'))
  const n = (k: 'att' | 'ready' | 'pass') => (rows ?? []).filter(r => k === 'att' ? lowAtt(r) : k === 'ready' ? notReady(r) : r.result === 'pass').length
  return <>
    <h3 style={{ margin: '16px 0 8px' }}>Từng giáo viên{rows ? ` (${new Set(rows.map(r => r.teacher_id)).size})` : ''}</h3>
    {err && <p className="msg" role="alert">{err}</p>}
    {rows && rows.length > 0 && <div className="distfilter" style={{ marginBottom: 8 }}>{([['all', 'Tất cả', rows.length], ['att', 'Vắng nhiều', n('att')], ['ready', 'Chưa đủ điều kiện', n('ready')], ['pass', 'Đã Đạt', n('pass')]] as const)
      .map(([k, l, c]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} ({c})</button>)}</div>}
    {!rows ? <p className="sub">Đang tải…</p> : !rows.length ? <small className="sub">Trường chưa có giáo viên ghi danh.</small> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Giáo viên</th><th>Chuyên cần</th><th>Bài học</th><th>Kiểm tra</th><th>Kết quả</th></tr></thead>
      <tbody>{shown.map(r => { const m = r.metrics
        return <tr key={r.plan_id + r.teacher_id}>
          <td><b>{r.teacher_name}</b><br /><small className="sub">{r.plan_code} · {r.plan_name}</small></td>
          <td>{m.att_pct == null ? '—' : `${num(m.att_pct)}%`}<br /><small className={m.ok_att ? 'sub' : 'warnline'}>{m.present}/{m.sessions - m.excused} buổi · cần {m.att_req}%</small></td>
          <td className={m.ok_units ? '' : 'warnline'}>{m.done}/{m.units}</td>
          <td className={m.ok_tests ? '' : 'warnline'}>{m.tests ? `${m.tests_passed}/${m.tests}` : '—'}{m.need_product && <><br /><small className={m.ok_product ? 'sub' : 'warnline'}>Sản phẩm: {m.product_status ? PROD[m.product_status] ?? m.product_status : 'chưa nộp'}</small></>}</td>
          <td>{r.result === 'pass' ? <Chip tone="good">Đạt{r.cert ? ' · có chứng chỉ' : ''}</Chip> : r.result === 'fail' ? <Chip tone="bad">Chưa đạt</Chip>
            : m.suggest === 'pass' ? <Chip tone="good">Đủ điều kiện</Chip> : <small className="warnline">Thiếu: {missing(m)}</small>}</td>
        </tr> })}
        {!shown.length && <tr><td colSpan={5}><small className="sub">Không có giáo viên nào khớp.</small></td></tr>}</tbody>
    </table></div>}
  </>
}

// Một dòng kế hoạch trong bảng mức hài lòng, mở góp ý ngay bên dưới
function FbPlanRow({ r, a, open, onToggle }: { r: Row; a: FbAgg; open: boolean; onToggle: () => void }) {
  return <>
    <tr><td><b>{r.plan_name}</b><br /><small className="sub">{r.plan_code} · {vnDate(r.starts_on)} – {vnDate(r.ends_on)}</small></td>
      <td style={{ whiteSpace: 'nowrap' }}>{a.n}/{a.enrolled}<br /><small className="sub">{pct(a.n, a.enrolled)}%</small></td>
      {FB_CRIT.map(([k]) => <td key={k}>{a.n ? <Chip tone={chipTone(a[k])}>{score(a[k])}</Chip> : '—'}</td>)}
      <td>{a.comments ? <button type="button" className="linkbtn" aria-expanded={open} onClick={onToggle}>{open ? 'Ẩn' : `${a.comments} góp ý`}</button> : '—'}</td></tr>
    {open && <tr><td colSpan={FB_CRIT.length + 3}><FeedbackComments planId={r.plan_id} showOrg /></td></tr>}
  </>
}
