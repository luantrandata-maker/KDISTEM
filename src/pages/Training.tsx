import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sessionState, STATE_LABEL, fmtDate, fmtTime } from '../lib/time'
import FormPanel from '../components/FormPanel'

type Plan = { id: string; name: string; program: string | null; provider: string | null; mode: string; status: string; hours: number | null }
type Sess = { id: string; plan_id: string; title: string; starts_at: string; ends_at: string; mode: string; location: string | null; training_plans: { name: string } | null }
const MODE: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const PSTATUS: Record<string, string> = { planned: 'Dự kiến', ongoing: 'Đang thực hiện', done: 'Hoàn thành' }

function usePlanOptions() {
  const [opts, setOpts] = useState<{ value: string; label: string }[]>([])
  useEffect(() => { supabase.from('training_plans').select('id, name').order('name').then(({ data }) => setOpts((data ?? []).map((p: any) => ({ value: p.id, label: p.name })))) }, [])
  return opts
}
const PROGRAMS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5'].map(p => ({ value: p, label: p }))

function useSessions(version = 0) {
  const [rows, setRows] = useState<Sess[]>([])
  useEffect(() => {
    supabase.from('training_sessions').select('*, training_plans(name)').order('starts_at')
      .then(({ data }) => setRows((data as unknown as Sess[]) ?? []))
  }, [version])
  return rows
}

export function TrainingPlans({ orgId }: { orgId: string }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [adding, setAdding] = useState(false)
  const sessions = useSessions()
  const load = () => supabase.from('training_plans').select('*').order('name').then(({ data }) => setPlans((data as Plan[]) ?? []))
  useEffect(() => { load() }, [])
  async function add(v: Record<string, string>) {
    const { error } = await supabase.from('training_plans').insert({ org_id: orgId, name: v.name, program: v.program || null, provider: v.provider || null, mode: v.mode, status: v.status, hours: v.hours ? Number(v.hours) : null })
    if (error) return error.message
    setAdding(false); load()
  }
  async function setStatus(p: Plan, status: string) { await supabase.from('training_plans').update({ status }).eq('id', p.id); load() }
  return (
    <>
    <div className="bar"><span /><button className="primary" onClick={() => setAdding(true)}>Thêm kế hoạch</button></div>
    {adding && <FormPanel fields={[
      { key: 'name', label: 'Tên kế hoạch', required: true }, { key: 'program', label: 'Chương trình', type: 'select', options: PROGRAMS },
      { key: 'provider', label: 'Đơn vị tập huấn' }, { key: 'hours', label: 'Số giờ', type: 'number' },
      { key: 'mode', label: 'Hình thức', type: 'select', required: true, options: [{ value: 'online', label: 'Trực tuyến' }, { value: 'offline', label: 'Trực tiếp' }, { value: 'hybrid', label: 'Kết hợp' }] },
      { key: 'status', label: 'Trạng thái', type: 'select', required: true, options: [{ value: 'planned', label: 'Dự kiến' }, { value: 'ongoing', label: 'Đang thực hiện' }, { value: 'done', label: 'Hoàn thành' }] },
    ]} initial={{ mode: 'online', status: 'planned' }} onSubmit={add} onCancel={() => setAdding(false)} />}
    <div className="reggrid">
      {plans.map(p => {
        const ss = sessions.filter(s => s.plan_id === p.id)
        const done = ss.filter(s => sessionState(s.starts_at, s.ends_at) === 'done').length
        const pct = ss.length ? Math.round((done / ss.length) * 100) : 0
        return (
          <div className="panel regcard" key={p.id}>
            <select value={p.status} onChange={e => setStatus(p, e.target.value)} aria-label="Trạng thái kế hoạch">{Object.entries(PSTATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <b>{p.name}</b>
            <small>{p.program} · {p.provider} · {MODE[p.mode]} · {p.hours ?? '—'} giờ</small>
            <div className="barrow" style={{ gridTemplateColumns: '1fr 70px' }}>
              <div className="track"><div className="fill g" style={{ width: pct + '%' }} /></div><small>{done}/{ss.length} buổi</small>
            </div>
          </div>
        )
      })}
      {plans.length === 0 && <p className="sub">Chưa có kế hoạch tập huấn.</p>}
    </div>
    </>
  )
}

export function TrainingSchedule({ onlineOnly = false, orgId }: { onlineOnly?: boolean; orgId: string }) {
  const [version, setVersion] = useState(0)
  const [adding, setAdding] = useState(false)
  const planOpts = usePlanOptions()
  const all = useSessions(version)
  async function add(v: Record<string, string>) {
    if (new Date(v.ends_at) <= new Date(v.starts_at)) return 'Giờ kết thúc phải sau giờ bắt đầu.'
    const { error } = await supabase.from('training_sessions').insert({ org_id: orgId, plan_id: v.plan_id, title: v.title, starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(), mode: onlineOnly ? 'online' : v.mode, location: v.location || null })
    if (error) return error.message
    setAdding(false); setVersion(x => x + 1)
  }
  const [mode, setMode] = useState('all')
  const [state, setState] = useState('all')
  const rows = all.filter(s => (onlineOnly ? s.mode === 'online' : mode === 'all' || s.mode === mode) && (state === 'all' || sessionState(s.starts_at, s.ends_at) === state))
  const n = (st: string) => all.filter(s => (!onlineOnly || s.mode === 'online') && sessionState(s.starts_at, s.ends_at) === st).length
  return (
    <>
      <div className="bar"><span /><button className="primary" onClick={() => setAdding(true)} disabled={planOpts.length === 0}>Thêm buổi tập huấn</button></div>
      {adding && <FormPanel fields={[
        { key: 'plan_id', label: 'Kế hoạch', type: 'select', required: true, options: planOpts }, { key: 'title', label: 'Tên buổi', required: true },
        { key: 'starts_at', label: 'Bắt đầu', type: 'datetime-local', required: true }, { key: 'ends_at', label: 'Kết thúc', type: 'datetime-local', required: true },
        ...(onlineOnly ? [] : [{ key: 'mode', label: 'Hình thức', type: 'select' as const, required: true, options: [{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }] }]),
        { key: 'location', label: 'Địa điểm (nếu offline)' },
      ]} initial={{ mode: 'online' }} onSubmit={add} onCancel={() => setAdding(false)} />}
      <div className="cards">
        <div className="card"><strong>{n('upcoming')}</strong><span>Chưa diễn ra</span></div>
        <div className="card"><strong>{n('live')}</strong><span>Đang diễn ra</span></div>
        <div className="card"><strong>{n('done')}</strong><span>Đã kết thúc</span></div>
      </div>
      <div className="bar" style={{ margin: '16px 0' }}>
        <div className="segmented">
          {[['all', 'Tất cả'], ['upcoming', 'Chưa diễn ra'], ['live', 'Đang diễn ra'], ['done', 'Đã kết thúc']].map(([k, l]) => (
            <button key={k} className={state === k ? 'on' : ''} onClick={() => setState(k)}>{l}</button>
          ))}
        </div>
        {!onlineOnly && (
          <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Hình thức">
            <option value="all">Mọi hình thức</option><option value="online">Online</option><option value="offline">Offline</option>
          </select>
        )}
      </div>
      <table>
        <thead><tr><th>Buổi tập huấn</th><th>Kế hoạch</th><th>Thời gian</th><th>Hình thức</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {rows.map(s => {
            const st = sessionState(s.starts_at, s.ends_at)
            return (
              <tr key={s.id}><td><b>{s.title}</b></td><td>{s.training_plans?.name}</td>
                <td>{fmtDate(s.starts_at)}<br /><small>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</small></td>
                <td>{s.mode === 'online' ? 'Online' : `Offline · ${s.location ?? ''}`}</td>
                <td><span className={'pill ' + (st === 'live' ? 'maintenance' : st === 'done' ? 'active' : '')}>{STATE_LABEL[st]}</span></td></tr>
            )
          })}
          {rows.length === 0 && <tr><td colSpan={5}>Không có buổi tập huấn phù hợp.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
export const VirtualClass = ({ orgId }: { orgId: string }) => <TrainingSchedule onlineOnly orgId={orgId} />

type Lesson = { id: string; title: string; grades: string | null; subject: string | null; author: string | null; status: string; created_on: string; training_plans: { name: string } | null }
export function TrainingLessons({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Lesson[]>([])
  const [tab, setTab] = useState('all')
  const [adding, setAdding] = useState(false)
  const planOpts = usePlanOptions()
  const load = () => supabase.from('training_lessons').select('*, training_plans(name)').order('created_on', { ascending: false }).then(({ data }) => setRows((data as unknown as Lesson[]) ?? []))
  useEffect(() => { load() }, [])
  async function add(v: Record<string, string>) {
    const { error } = await supabase.from('training_lessons').insert({ org_id: orgId, plan_id: v.plan_id || null, title: v.title, grades: v.grades || null, subject: v.subject || null, author: v.author || null, status: v.status })
    if (error) return error.message
    setAdding(false); load()
  }
  async function toggle(l: Lesson) { await supabase.from('training_lessons').update({ status: l.status === 'published' ? 'draft' : 'published' }).eq('id', l.id); load() }
  const shown = rows.filter(r => tab === 'all' || r.status === tab)
  return (
    <>
      <div className="bar"><span /><button className="primary" onClick={() => setAdding(true)}>Thêm bài giảng</button></div>
      {adding && <FormPanel fields={[
        { key: 'title', label: 'Tên bài giảng', required: true }, { key: 'plan_id', label: 'Kế hoạch tập huấn', type: 'select', options: planOpts },
        { key: 'grades', label: 'Khối (VD: Lớp 6–9)' }, { key: 'subject', label: 'Môn' }, { key: 'author', label: 'Tác giả' },
        { key: 'status', label: 'Trạng thái', type: 'select', required: true, options: [{ value: 'draft', label: 'Biên soạn' }, { value: 'published', label: 'Xuất bản' }] },
      ]} initial={{ status: 'draft' }} onSubmit={add} onCancel={() => setAdding(false)} />}
      <div className="segmented">
        {[['all', 'Tất cả'], ['published', 'Xuất bản'], ['draft', 'Biên soạn']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({rows.filter(r => k === 'all' || r.status === k).length})</button>
        ))}
      </div>
      <table>
        <thead><tr><th>Bài giảng</th><th>Chương trình</th><th>Khối · Môn</th><th>Tác giả</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {shown.map(l => (
            <tr key={l.id}><td><b>{l.title}</b><br /><small>{fmtDate(l.created_on)}</small></td><td>{l.training_plans?.name ?? '—'}</td>
              <td>{l.grades} · {l.subject}</td><td>{l.author}</td>
              <td><span className={'pill ' + (l.status === 'published' ? 'active' : 'maintenance')}>{l.status === 'published' ? 'Xuất bản' : 'Biên soạn'}</span> <button onClick={() => toggle(l)}>{l.status === 'published' ? 'Gỡ xuất bản' : 'Xuất bản'}</button></td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

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
