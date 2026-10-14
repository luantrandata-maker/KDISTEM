import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sessionState, STATE_LABEL, fmtDate, fmtTime } from '../lib/time'

type Plan = { id: string; name: string; program: string | null; provider: string | null; mode: string; status: string; hours: number | null }
type Sess = { id: string; plan_id: string; title: string; starts_at: string; ends_at: string; mode: string; location: string | null; training_plans: { name: string } | null }
const MODE: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const PSTATUS: Record<string, string> = { planned: 'Dự kiến', ongoing: 'Đang thực hiện', done: 'Hoàn thành' }

function useSessions() {
  const [rows, setRows] = useState<Sess[]>([])
  useEffect(() => {
    supabase.from('training_sessions').select('*, training_plans(name)').order('starts_at')
      .then(({ data }) => setRows((data as unknown as Sess[]) ?? []))
  }, [])
  return rows
}

export function TrainingPlans() {
  const [plans, setPlans] = useState<Plan[]>([])
  const sessions = useSessions()
  useEffect(() => { supabase.from('training_plans').select('*').order('name').then(({ data }) => setPlans((data as Plan[]) ?? [])) }, [])
  return (
    <div className="reggrid">
      {plans.map(p => {
        const ss = sessions.filter(s => s.plan_id === p.id)
        const done = ss.filter(s => sessionState(s.starts_at, s.ends_at) === 'done').length
        const pct = ss.length ? Math.round((done / ss.length) * 100) : 0
        return (
          <div className="panel regcard" key={p.id}>
            <span className={'pill ' + (p.status === 'done' ? 'active' : p.status === 'ongoing' ? 'maintenance' : '')}>{PSTATUS[p.status]}</span>
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
  )
}

export function TrainingSchedule({ onlineOnly = false }: { onlineOnly?: boolean }) {
  const all = useSessions()
  const [mode, setMode] = useState('all')
  const [state, setState] = useState('all')
  const rows = all.filter(s => (onlineOnly ? s.mode === 'online' : mode === 'all' || s.mode === mode) && (state === 'all' || sessionState(s.starts_at, s.ends_at) === state))
  const n = (st: string) => all.filter(s => (!onlineOnly || s.mode === 'online') && sessionState(s.starts_at, s.ends_at) === st).length
  return (
    <>
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
export const VirtualClass = () => <TrainingSchedule onlineOnly />

type Lesson = { id: string; title: string; grades: string | null; subject: string | null; author: string | null; status: string; created_on: string; training_plans: { name: string } | null }
export function TrainingLessons() {
  const [rows, setRows] = useState<Lesson[]>([])
  const [tab, setTab] = useState('all')
  useEffect(() => { supabase.from('training_lessons').select('*, training_plans(name)').order('created_on', { ascending: false }).then(({ data }) => setRows((data as unknown as Lesson[]) ?? [])) }, [])
  const shown = rows.filter(r => tab === 'all' || r.status === tab)
  return (
    <>
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
              <td><span className={'pill ' + (l.status === 'published' ? 'active' : 'maintenance')}>{l.status === 'published' ? 'Xuất bản' : 'Biên soạn'}</span></td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

type Cert = { id: string; code: string | null; issued_on: string | null; teachers: { full_name: string; subject: string | null } | null; training_plans: { name: string } | null }
export function Certificates() {
  const [rows, setRows] = useState<Cert[]>([])
  useEffect(() => { supabase.from('certificates').select('id, code, issued_on, teachers(full_name, subject), training_plans(name)').order('code').then(({ data }) => setRows((data as unknown as Cert[]) ?? [])) }, [])
  return (
    <>
      <p className="sub">{rows.length} chứng chỉ đã cấp</p>
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
