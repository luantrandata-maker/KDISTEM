import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sessionState, STATE_LABEL, fmtDate, fmtTime, type SessionState } from '../../lib/time'
import { NoTeacher, Tabs, PROGRAM_COLOR, type TProps } from './common'

// Cổng giáo viên › Khác › Lịch tập huấn & Bài giảng tập huấn (migration 026)

type Sess = {
  id: string; plan_id: string | null; plan_name: string | null; program: string | null; provider: string | null; title: string
  starts_at: string; ends_at: string; mode: string; location: string | null; meeting_url: string | null; present: boolean | null; org_name: string | null
}
const MODE: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const OPEN_MS = 15 * 60000   // khớp training_session_open(): sớm/muộn 15 phút

const canCheckIn = (s: Sess, now = Date.now()) =>
  now >= new Date(s.starts_at).getTime() - OPEN_MS && now <= new Date(s.ends_at).getTime() + OPEN_MS

function Attendance({ s, st }: { s: Sess; st: SessionState }) {
  if (s.present === true) return <span className="pill active">Có mặt</span>
  if (s.present === false) return <span className="pill inactive">Vắng</span>
  return <span className="pill maintenance">{st === 'done' ? 'Chưa ghi nhận' : 'Chưa điểm danh'}</span>
}

export function TeacherTrainingSchedule({ teacherId }: TProps) {
  const [rows, setRows] = useState<Sess[] | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'all' | SessionState>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [, tick] = useState(0)

  const load = () => supabase.rpc('my_training_sessions').then(({ data, error }) => {
    if (error) setErr(error.message); else { setErr(''); setRows((data as Sess[]) ?? []) }
  })
  useEffect(() => { if (teacherId) load() }, [teacherId])
  // Cập nhật trạng thái "đang diễn ra" mỗi phút
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 60000); return () => clearInterval(t) }, [])

  async function checkIn(s: Sess, openLink: boolean) {
    // Mở cửa sổ trước khi chờ phản hồi để trình duyệt không chặn popup
    // (không dùng tham số 'noopener' vì khi đó window.open luôn trả null; tự cắt opener thay vào đó)
    const win = openLink && s.meeting_url ? window.open(s.meeting_url, '_blank') : null
    if (win) win.opener = null
    setBusy(s.id)
    const { error } = await supabase.rpc('training_check_in', { p_session: s.id })
    setBusy(null)
    if (error) { setErr(error.message); return }
    if (openLink && s.meeting_url && !win) setErr('Trình duyệt đã chặn cửa sổ mới. Bấm lại "Tham gia" hoặc cho phép cửa sổ bật lên.')
    load()
  }

  if (!teacherId) return <NoTeacher />
  if (!rows) return err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải…</p>

  const st = (s: Sess) => sessionState(s.starts_at, s.ends_at)
  const n = (k: SessionState) => rows.filter(s => st(s) === k).length
  const attended = rows.filter(s => s.present === true).length
  const shown = rows.filter(s => tab === 'all' || st(s) === tab)
    .sort((a, b) => {   // đang diễn ra → sắp tới (gần nhất trước) → đã qua (mới nhất trước)
      const order = { live: 0, upcoming: 1, done: 2 } as const
      const d = order[st(a)] - order[st(b)]
      if (d) return d
      const ta = new Date(a.starts_at).getTime(), tb = new Date(b.starts_at).getTime()
      return st(a) === 'done' ? tb - ta : ta - tb
    })

  return (
    <>
      <div className="cards">
        <div className="card"><strong>{rows.length}</strong><span>Tổng buổi</span></div>
        <div className="card"><strong>{n('upcoming')}</strong><span>Sắp diễn ra</span></div>
        <div className="card"><strong>{n('live')}</strong><span>Đang diễn ra</span></div>
        <div className="card"><strong>{attended}</strong><span>Đã có mặt</span></div>
      </div>
      {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
      <div style={{ margin: '14px 0' }}>
        <Tabs value={tab} onChange={setTab} items={[
          ['all', 'Tất cả', rows.length], ['live', STATE_LABEL.live, n('live')],
          ['upcoming', 'Sắp diễn ra', n('upcoming')], ['done', STATE_LABEL.done, n('done')],
        ]} />
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Buổi tập huấn</th><th>Thời gian</th><th>Hình thức</th><th>Điểm danh</th><th></th></tr></thead>
        <tbody>
          {shown.map(s => {
            const state = st(s); const open = canCheckIn(s)
            return (
              <tr key={s.id}>
                <td>
                  <b>{s.title}</b>{s.program && <span className="badge" style={{ background: PROGRAM_COLOR[s.program] ?? undefined, color: '#fff' }}>{s.program}</span>}
                  <br /><small>{s.plan_name ?? '—'}{s.org_name ? ` · ${s.org_name}` : ''}{s.provider ? ` · ${s.provider}` : ''}</small>
                </td>
                <td>{fmtDate(s.starts_at)}<br /><small>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</small></td>
                <td>{MODE[s.mode] ?? s.mode}{s.mode !== 'online' && s.location && <><br /><small>{s.location}</small></>}</td>
                <td><Attendance s={s} st={state} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {open && s.present !== true && (s.meeting_url
                    ? <button className="primary" disabled={busy === s.id} onClick={() => checkIn(s, true)}>Tham gia</button>
                    : <button className="primary" disabled={busy === s.id} onClick={() => checkIn(s, false)}>Điểm danh</button>)}
                  {open && s.present === true && s.meeting_url && <a className="filebtn" href={s.meeting_url} target="_blank" rel="noreferrer">Vào lại phòng họp</a>}
                  {!open && state === 'upcoming' && <small>Mở điểm danh 15 phút trước giờ học</small>}
                </td>
              </tr>
            )
          })}
          {shown.length === 0 && <tr><td colSpan={5}>{rows.length === 0 ? 'Bạn chưa được ghi danh vào buổi tập huấn nào.' : 'Không có buổi phù hợp.'}</td></tr>}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 10 }}>Bạn tự điểm danh "có mặt" trong giờ buổi tập huấn. Ghi nhận vắng hoặc sửa điểm danh buổi đã qua do quản trị trường hoặc đơn vị tổ chức thực hiện.</p>
    </>
  )
}

type Lesson = { id: string; title: string; grades: string | null; subject: string | null; author: string | null; created_on: string
  blocks: number; materials: number; videos: number; docs: number; plan_id: string; plan_name: string; program: string | null }

export function TeacherTrainingLessons({ teacherId }: TProps) {
  const [rows, setRows] = useState<Lesson[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState(''); const [plan, setPlan] = useState('')
  useEffect(() => {
    if (!teacherId) return
    supabase.rpc('my_training_lessons').then(({ data, error }) => { if (error) setErr(error.message); else setRows((data as Lesson[]) ?? []) })
  }, [teacherId])
  if (!teacherId) return <NoTeacher />
  if (!rows) return err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải…</p>

  const plans = [...new Map(rows.map(r => [r.plan_id, r.plan_name])).entries()]
  const shown = rows.filter(r => (!plan || r.plan_id === plan) && (r.title + (r.subject ?? '') + (r.author ?? '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="bar">
        <input className="search" style={{ margin: 0 }} placeholder="Tìm bài giảng, môn, tác giả…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="tools">
          <select value={plan} onChange={e => setPlan(e.target.value)} aria-label="Khoá tập huấn">
            <option value="">Tất cả khoá tập huấn</option>
            {plans.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>
      <div className="wrap" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Bài giảng</th><th>Khoá tập huấn</th><th>Nội dung</th><th>Tác giả</th></tr></thead>
        <tbody>
          {shown.map(l => (
            <tr key={l.id}>
              <td><b>{l.title}</b><br /><small>{[l.grades, l.subject].filter(Boolean).join(' · ') || '—'}</small></td>
              <td>{l.plan_name}{l.program && <span className="badge" style={{ background: PROGRAM_COLOR[l.program] ?? undefined, color: '#fff' }}>{l.program}</span>}</td>
              <td>{l.blocks} khối · {l.materials} học liệu<br /><small>Video {l.videos} · Tài liệu {l.docs}</small></td>
              <td>{l.author ?? '—'}<br /><small>{fmtDate(l.created_on)}</small></td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4}>{rows.length === 0 ? 'Chưa có bài giảng tập huấn nào được xuất bản cho các khoá bạn tham gia.' : 'Không có bài giảng phù hợp.'}</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}
