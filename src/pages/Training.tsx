import { Fragment, Suspense, lazy, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAllMode } from '../components/OrgScope'
import { sessionState, STATE_LABEL, fmtDate, fmtTime } from '../lib/time'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { useStemTracks } from '../lib/stemTracks'

type Plan = { id: string; code: string | null; year_no: number | null; module_no: number | null; name: string; program: string | null; provider: string | null; mode: string; status: string; hours: number | null }
type Sess = { id: string; plan_id: string; title: string; starts_at: string; ends_at: string; mode: string; location: string | null; meeting_url: string | null; training_plans: { name: string; provider: string | null } | null }
type Att = { session_id: string; teacher_id: string; present: boolean | null }
type Enr = { plan_id: string; teacher_id: string; completed: boolean }
type Teacher = { id: string; full_name: string; subject: string | null }
const MODE: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const PSTATUS: Record<string, string> = { planned: 'Dự kiến', ongoing: 'Đang thực hiện', done: 'Hoàn thành' }

function usePlanOptions() {
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([])
  useEffect(() => { supabase.from('training_plans').select('id, name').order('name').then(({ data }) => setOpts((data ?? []).map((p: any) => ({ value: p.id, label: p.name })))) }, [])
  return opts
}
function useTeachers() {
  const [t, setT] = useState<Teacher[]>([])
  useEffect(() => { supabase.from('teachers').select('id, full_name, subject').order('full_name').then(({ data }) => setT((data as Teacher[]) ?? [])) }, [])
  return t
}

export function TrainingPlans({ orgId }: { orgId: string }) {
  const PROGRAMS = useStemTracks().codes.map(p => ({ value: p, label: p }))
  const [plans, setPlans] = useState<Plan[]>([])
  const [enr, setEnr] = useState<Enr[]>([])
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [adding, setAdding] = useState(false)
  const [assign, setAssign] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const teachers = useTeachers()

  async function load() {
    const [p, e, l] = await Promise.all([
      supabase.from('training_plans').select('*').order('year_no').order('module_no'),
      supabase.from('training_enrollments').select('plan_id, teacher_id, completed'),
      supabase.from('stem_teacher_programs').select('program'),
    ])
    setPlans((p.data as Plan[]) ?? []); setEnr((e.data as Enr[]) ?? [])
    const m: Record<string, number> = {}; (l.data ?? []).forEach((x: any) => { m[x.program] = (m[x.program] ?? 0) + 1 }); setTargets(m)
  }
  useEffect(() => { load() }, [])

  async function add(v: Record<string, string>) {
    const { error } = await supabase.from('training_plans').insert({ org_id: orgId, name: v.name, code: v.program || null, program: v.program || null, year_no: v.year_no ? Number(v.year_no) : null, module_no: v.module_no ? Number(v.module_no) : null,
      provider: v.provider || null, mode: v.mode, status: v.status, hours: v.hours ? Number(v.hours) : null })
    if (error) return error.message
    setAdding(false); load()
  }
  async function toggleEnroll(plan: string, teacher: string, on: boolean) {
    if (on) await supabase.from('training_enrollments').insert({ org_id: orgId, plan_id: plan, teacher_id: teacher })
    else await supabase.from('training_enrollments').delete().eq('plan_id', plan).eq('teacher_id', teacher)
    load()
  }
  async function toggleDone(plan: string, teacher: string, completed: boolean) {
    await supabase.from('training_enrollments').update({ completed }).eq('plan_id', plan).eq('teacher_id', teacher); load()
  }
  async function setStatus(p: Plan, status: string) { await supabase.from('training_plans').update({ status }).eq('id', p.id); load() }

  const cell = (y: number, m: number) => plans.filter(p => p.year_no === y && p.module_no === m)
  const open = plans.filter(p => p.status !== 'done')
  const list = (id: string) => enr.filter(e => e.plan_id === id)

  return (
    <>
      <div className="bar"><p className="sub">Lộ trình tập huấn giáo viên theo năm và module</p><button className="primary" onClick={() => setAdding(true)}>Thêm kế hoạch</button></div>
      {adding && <FormPanel fields={[
        { key: 'name', label: 'Tên khóa tập huấn', required: true }, { key: 'program', label: 'Chương trình', type: 'select', options: PROGRAMS },
        { key: 'year_no', label: 'Năm (1–5)', type: 'number' }, { key: 'module_no', label: 'Module (1–3)', type: 'number' },
        { key: 'provider', label: 'Đơn vị tập huấn' }, { key: 'hours', label: 'Số giờ', type: 'number' },
        { key: 'mode', label: 'Hình thức', type: 'select', required: true, options: [{ value: 'online', label: 'Trực tuyến' }, { value: 'offline', label: 'Trực tiếp' }, { value: 'hybrid', label: 'Kết hợp' }] },
        { key: 'status', label: 'Trạng thái', type: 'select', required: true, options: [{ value: 'planned', label: 'Dự kiến' }, { value: 'ongoing', label: 'Đang thực hiện' }, { value: 'done', label: 'Hoàn thành' }] },
      ]} initial={{ mode: 'online', status: 'ongoing' }} onSubmit={add} onCancel={() => setAdding(false)} />}
      <div className="wrap"><table className="tkb"><tbody>
        {[1, 2, 3, 4, 5].map(y => <tr key={y}><td style={{ width: 90 }}><b>Năm {y}</b></td>
          {[1, 2, 3].map(m => <td key={m}><small>Module {m}</small>{cell(y, m).map(p => <div className="slot stem" key={p.id}><ProgChips programs={p.code} /><b style={{ fontSize: 12 }}>{p.name}</b></div>)}
            {cell(y, m).length === 0 && <div><small style={{ color: 'var(--muted)' }}>Chưa có kế hoạch</small></div>}</td>)}</tr>)}
      </tbody></table></div>
      <h3 style={{ margin: '18px 0 8px' }}>Khóa đang mở ({open.length})</h3>
      <div className="wrap"><table>
        <thead><tr><th>Khóa tập huấn</th><th>Hình thức</th><th>GV trường</th><th>Tiến độ</th><th>Thao tác</th></tr></thead>
        <tbody>{open.map(p => {
          const e = list(p.id); const done = e.filter(x => x.completed).length; const target = Math.max(targets[p.program ?? ''] ?? 0, e.length); const pct = target ? Math.round((e.length / target) * 100) : 0
          return (<Fragment key={p.id}>
            <tr><td><ProgChips programs={p.code} /><small>Năm {p.year_no} · M{p.module_no}</small><br /><b>{p.name}</b><br /><small>{p.provider} · {p.hours}h</small></td>
              <td><span className={'pill ' + (p.mode === 'hybrid' ? 'maintenance' : 'active')}>{MODE[p.mode]}</span></td>
              <td><b>{e.length}</b> ghi danh<br /><small>{done} hoàn thành</small></td>
              <td style={{ minWidth: 150 }}><div className="track"><div className={'fill ' + (pct >= 60 ? 'g' : 'o')} style={{ width: pct + '%' }} /></div><small>{pct}% · {e.length}/{target} GV</small></td>
              <td><button className="primary" onClick={() => setAssign(assign === p.id ? null : p.id)}>Gán GV</button> <button onClick={() => setDetail(detail === p.id ? null : p.id)}>Chi tiết</button>
                <select value={p.status} onChange={ev => setStatus(p, ev.target.value)} aria-label="Trạng thái">{Object.entries(PSTATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td></tr>
            {assign === p.id && <tr><td colSpan={5}><b>Chọn giáo viên tham gia</b><div className="reggrid" style={{ marginTop: 8 }}>
              {teachers.map(t => <label className="roomrow" key={t.id}><span>{t.full_name} <small>{t.subject}</small></span><input type="checkbox" checked={e.some(x => x.teacher_id === t.id)} onChange={ev => toggleEnroll(p.id, t.id, ev.target.checked)} /></label>)}</div></td></tr>}
            {detail === p.id && <tr><td colSpan={5}><b>Giáo viên ghi danh ({e.length})</b>
              {e.map(x => <div className="roomrow" key={x.teacher_id}><span>{teachers.find(t => t.id === x.teacher_id)?.full_name}</span>
                <label><input type="checkbox" checked={x.completed} onChange={ev => toggleDone(p.id, x.teacher_id, ev.target.checked)} /> Hoàn thành</label></div>)}
              {e.length === 0 && <small>Chưa có giáo viên nào ghi danh.</small>}</td></tr>}
          </Fragment>)
        })}
        {open.length === 0 && <tr><td colSpan={5}>Chưa có khóa đang mở.</td></tr>}</tbody></table></div>
    </>
  )
}

function useSessionData(version: number) {
  const [rows, setRows] = useState<Sess[]>([]); const [att, setAtt] = useState<Att[]>([])
  useEffect(() => {
    supabase.from('training_sessions').select('*, training_plans(name, provider)').order('starts_at').then(({ data }) => setRows((data as unknown as Sess[]) ?? []))
    supabase.from('training_attendance').select('session_id, teacher_id, present').then(({ data }) => setAtt((data as Att[]) ?? []))
  }, [version])
  return { rows, att }
}

export function TrainingSchedule({ onlineOnly = false, orgId }: { onlineOnly?: boolean; orgId: string }) {
  const [version, setVersion] = useState(0)
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState('all'); const [state, setState] = useState('all'); const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'cal'>('list'); const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [roll, setRoll] = useState<string | null>(null)
  const planOpts = usePlanOptions(); const teachers = useTeachers()
  const { rows: all, att } = useSessionData(version)
  // Quản trị hệ thống: buổi thuộc đơn vị lập kế hoạch
  const every = useAllMode()

  async function add(v: Record<string, string>) {
    if (new Date(v.ends_at) <= new Date(v.starts_at)) return 'Giờ kết thúc phải sau giờ bắt đầu.'
    const m = onlineOnly ? 'online' : v.mode
    const org = every ? ((await supabase.from('training_plans').select('org_id').eq('id', v.plan_id).maybeSingle()).data as { org_id: string } | null)?.org_id ?? orgId : orgId
    const { data, error } = await supabase.from('training_sessions').insert({ org_id: org, plan_id: v.plan_id, title: v.title, starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(), mode: m, location: v.location || null, meeting_url: v.meeting_url || null }).select('id').single()
    if (error) return error.message
    const { data: en } = await supabase.from('training_enrollments').select('teacher_id').eq('plan_id', v.plan_id)
    const ids = (en ?? []).length ? (en ?? []).map((x: any) => x.teacher_id) : teachers.map(t => t.id)
    // Từ 085 GV đã ghi danh tự có dòng điểm danh; bỏ qua dòng đã có
    if (ids.length) await supabase.from('training_attendance').upsert(ids.map((t: string) => ({ org_id: org, session_id: data.id, teacher_id: t, present: null })), { onConflict: 'session_id,teacher_id', ignoreDuplicates: true })
    setAdding(false); setVersion(x => x + 1)
  }
  async function mark(sid: string, tid: string, present: boolean) {
    await supabase.from('training_attendance').upsert({ org_id: orgId, session_id: sid, teacher_id: tid, present }); setVersion(x => x + 1)
  }

  const base = all.filter(s => !onlineOnly || s.mode === 'online')
  const st = (s: Sess) => sessionState(s.starts_at, s.ends_at)
  const n = (k: string) => base.filter(s => st(s) === k).length
  const rows = base.filter(s => (mode === 'all' || s.mode === mode) && (state === 'all' || st(s) === state) && (s.title + (s.training_plans?.name ?? '')).toLowerCase().includes(q.toLowerCase()))
  const info = (id: string) => { const a = att.filter(x => x.session_id === id); return { total: a.length, present: a.filter(x => x.present).length } }
  const Join = ({ s }: { s: Sess }) => st(s) === 'live' ? (s.meeting_url ? <a className="filebtn" style={{ background: 'var(--bad)', color: '#fff', textDecoration: 'none' }} href={s.meeting_url} target="_blank" rel="noreferrer">Tham gia</a> : <button disabled title="Chưa nhập đường dẫn phòng họp">Tham gia</button>) : null

  const firstDow = month.getDay(); const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((firstDow + days) / 7) * 7 }, (_, i) => i - firstDow + 1)
  return (
    <>
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}><button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>Danh sách</button><button className={view === 'cal' ? 'on' : ''} onClick={() => setView('cal')}>Lịch</button></div>
        <button className="primary" onClick={() => setAdding(true)} disabled={planOpts.length === 0}>Thêm buổi {onlineOnly ? 'online' : 'tập huấn'}</button>
      </div>
      {adding && <FormPanel fields={[
        { key: 'plan_id', label: 'Kế hoạch', type: 'select', required: true, options: planOpts }, { key: 'title', label: 'Tên buổi', required: true },
        { key: 'starts_at', label: 'Bắt đầu', type: 'datetime-local', required: true }, { key: 'ends_at', label: 'Kết thúc', type: 'datetime-local', required: true },
        ...(onlineOnly ? [] : [{ key: 'mode', label: 'Hình thức', type: 'select' as const, required: true, options: [{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }] }]),
        { key: 'location', label: 'Địa điểm (offline)' }, { key: 'meeting_url', label: 'Đường dẫn phòng họp (online)' },
      ]} initial={{ mode: 'online' }} onSubmit={add} onCancel={() => setAdding(false)} />}
      <div className="cards" style={{ marginTop: 14 }}>
        <div className="card"><strong>{n('upcoming')}</strong><span>Chưa diễn ra</span></div><div className="card"><strong>{n('live')}</strong><span>Đang diễn ra</span></div><div className="card"><strong>{n('done')}</strong><span>Kết thúc</span></div>
      </div>
      <div className="bar" style={{ margin: '14px 0' }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm tiêu đề buổi tập huấn…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="tools">
          {[['all', 'Tất cả'], ['upcoming', 'Chưa diễn ra'], ['live', 'Đang diễn ra'], ['done', 'Kết thúc']].map(([k, l]) => <button key={k} className={'chipbtn' + (state === k ? ' on' : '')} onClick={() => setState(k)}>{l}</button>)}
          {!onlineOnly && <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Hình thức"><option value="all">Tất cả</option><option value="online">Online</option><option value="offline">Offline</option></select>}
        </div>
      </div>
      {view === 'list' ? (
        <div className="wrap"><table>
          <thead><tr><th>#</th>{onlineOnly ? <th>Buổi học / Kế hoạch</th> : <th>Buổi tập huấn</th>}<th>Ngày & giờ</th><th>Điểm danh</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>{rows.map((s, i) => { const a = info(s.id); const stt = st(s); return (<Fragment key={s.id}>
            <tr><td>{i + 1}</td><td><b>{s.title}</b><br /><small>{s.training_plans?.name} · {s.mode === 'online' ? 'Online' : `Offline · ${s.location ?? ''}`}</small></td>
              <td>{fmtDate(s.starts_at)}<br /><small>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</small></td>
              <td style={{ minWidth: 130 }}>{a.total ? <><small>{a.present}/{a.total} có mặt</small><div className="track"><div className="fill g" style={{ width: (a.present / a.total) * 100 + '%' }} /></div></> : <small>—</small>}</td>
              <td><span className={'pill ' + (stt === 'live' ? 'inactive' : stt === 'done' ? '' : 'maintenance')}>{STATE_LABEL[stt]}</span></td>
              <td><Join s={s} /> <button onClick={() => setRoll(roll === s.id ? null : s.id)}>Điểm danh</button></td></tr>
            {roll === s.id && <tr><td colSpan={6}><div className="reggrid">{att.filter(x => x.session_id === s.id).map(x => <label className="roomrow" key={x.teacher_id}><span>{teachers.find(t => t.id === x.teacher_id)?.full_name}</span>
              <select value={x.present === null ? '' : x.present ? '1' : '0'} onChange={e => mark(s.id, x.teacher_id, e.target.value === '1')}><option value="" disabled>Chưa điểm danh</option><option value="1">Có mặt</option><option value="0">Vắng</option></select></label>)}</div></td></tr>}
          </Fragment>) })}
          {rows.length === 0 && <tr><td colSpan={6}>Không có buổi phù hợp.</td></tr>}</tbody></table></div>
      ) : (
        <div className="panel"><div className="bar"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><b>Tháng {month.getMonth() + 1}/{month.getFullYear()}</b><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
          <table className="sched"><thead><tr>{['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map(d => <th key={d}>{d}</th>)}</tr></thead><tbody>
            {Array.from({ length: cells.length / 7 }, (_, w) => <tr key={w}>{cells.slice(w * 7, w * 7 + 7).map((d, i) => {
              const inM = d >= 1 && d <= days; const ev = inM ? rows.filter(s => { const x = new Date(s.starts_at); return x.getFullYear() === month.getFullYear() && x.getMonth() === month.getMonth() && x.getDate() === d }) : []
              return <td key={i} style={inM ? undefined : { background: 'var(--soft)', borderStyle: 'solid' }}>{inM && <b>{d}</b>}{ev.map(s => <div key={s.id} className="evt" style={{ background: st(s) === 'live' ? '#fde8ea' : st(s) === 'done' ? '#eef1f6' : '#e6f1fd' }}>{s.title.slice(0, 26)}{s.title.length > 26 ? '…' : ''}</div>)}</td>
            })}</tr>)}</tbody></table>
          <small>Màu: xanh = chưa diễn ra · đỏ = đang diễn ra · xám = kết thúc</small></div>
      )}
    </>
  )
}
export const VirtualClass = ({ orgId }: { orgId: string }) => <TrainingSchedule onlineOnly orgId={orgId} />

// Bài giảng tập huấn: bộ 5 thẻ như bài học (102), tải khi mở
const LessonsPage = lazy(() => import('./training/Lessons').then(m => ({ default: m.TrainingLessonsPage })))
export const TrainingLessons = ({ orgId }: { orgId: string }) => <Suspense fallback={<p className="sub">Đang tải…</p>}><LessonsPage orgId={orgId} /></Suspense>

type Cert = { id: string; code: string | null; issued_on: string | null; teachers: { full_name: string; subject: string | null } | null; training_plans: { name: string } | null }
export function Certificates({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Cert[]>([])
  const [adding, setAdding] = useState(false)
  const [teachers, setTeachers] = useState<{ value: string; label: string }[]>([])
  const planOpts = usePlanOptions()
  const load = () => supabase.from('certificates').select('id, code, issued_on, teachers(full_name, subject), training_plans(name)').order('code').then(({ data }) => setRows((data as unknown as Cert[]) ?? []))
  useEffect(() => { load(); supabase.from('teachers').select('id, full_name').order('full_name').then(({ data }) => setTeachers((data ?? []).map((t: any) => ({ value: t.id, label: t.full_name })))) }, [])
  async function add(v: Record<string, string>) {
    const code = `CC-${new Date(v.issued_on).getFullYear()}-${String(Date.now()).slice(-5)}`
    const { error } = await supabase.from('certificates').insert({ org_id: orgId, teacher_id: v.teacher_id, plan_id: v.plan_id, code, issued_on: v.issued_on })
    if (error) return error.message
    setAdding(false); load()
  }
  return (
    <>
      <div className="bar"><p className="sub">{rows.length} chứng chỉ đã cấp</p><button className="primary" onClick={() => setAdding(true)}>Cấp chứng chỉ</button></div>
      {adding && <FormPanel submitLabel="Cấp" fields={[
        { key: 'teacher_id', label: 'Giáo viên', type: 'select', required: true, options: teachers }, { key: 'plan_id', label: 'Khóa tập huấn', type: 'select', required: true, options: planOpts },
        { key: 'issued_on', label: 'Ngày cấp', type: 'date', required: true },
      ]} initial={{ issued_on: new Date().toISOString().slice(0, 10) }} onSubmit={add} onCancel={() => setAdding(false)} />}
      <table>
        <thead><tr><th>Mã chứng chỉ</th><th>Giáo viên</th><th>Khóa tập huấn</th><th>Ngày cấp</th></tr></thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.id}><td><b>{c.code}</b></td><td>{c.teachers?.full_name}<br /><small>{c.teachers?.subject}</small></td>
              <td>{c.training_plans?.name}</td><td>{c.issued_on ? fmtDate(c.issued_on) : '—'}</td></tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4}>Chưa có chứng chỉ nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
