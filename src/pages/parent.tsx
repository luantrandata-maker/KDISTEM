import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { StudentCompetencyProfile } from './competency'
import { MySurveys } from './surveys'

// Cổng Phụ huynh (migration 048): xem lịch học, chuyên cần, bài tập & điểm, năng lực của con; đồng ý dữ liệu; cảnh báo vắng.
type Child = { student_id: string; full_name: string; student_code: string | null; class_id: string | null; class_name: string | null; school: string; relation: string; receive_alerts: boolean }
type Data = {
  student: { id: string; full_name: string; code: string | null; class: string | null; school: string }
  homeroom: { name: string; email: string | null } | null
  schedule: { date: string; period: string; start: string; subject: string; kind: string; room: string | null; teacher: string | null; status: string }[]
  attendance: { present: number; absent: number; late: number; excused: number; recent: { date: string; subject: string; status: string; note: string | null }[] }
  assignments: { title: string; subject: string | null; kind: string; due_at: string | null; max_score: number; status: string; score: number | null; feedback: string | null; submitted_at: string | null }[]
  consent: { guardian: string; method: string; on: string; scope: string[] } | null
}
const ATT: Record<string, [string, string]> = { present: ['Có mặt', 'ok'], absent: ['Vắng', 'bad'], late: ['Đi muộn', 'bad'], excused: ['Vắng có phép', 'mute'] }
const AS: Record<string, [string, string]> = { submitted: ['Đã nộp, chờ chấm', 'mute'], graded: ['Đã chấm', 'ok'], returned: ['Trả lại để sửa', 'bad'], missing: ['Chưa nộp (quá hạn)', 'bad'], todo: ['Chưa nộp', 'mute'] }
const dayName = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })
const when = (d: string | null) => (d ? new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const KEY = 'kdi.parent.child'

function useChildren() {
  const [kids, setKids] = useState<Child[] | null>(null)
  const [sel, setSel] = useState<string>(() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })
  const [err, setErr] = useState('')
  async function load() {
    const { data, error } = await supabase.rpc('parent_children')
    if (error) setErr(/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 048 trên Supabase.' : error.message)
    const list = (data as Child[]) ?? []; setKids(list)
    if (list.length && !list.some(k => k.student_id === sel)) setSel(list[0].student_id)
  }
  useEffect(() => { load() }, [])
  const pick = (id: string) => { setSel(id); try { localStorage.setItem(KEY, id) } catch { /* bỏ qua */ } }
  return { kids, sel, pick, err, reload: load }
}

function Picker({ kids, sel, pick }: { kids: Child[]; sel: string; pick: (id: string) => void }) {
  if (kids.length < 2) return null
  return <div className="segmented" role="tablist" aria-label="Chọn con" style={{ marginBottom: 12 }}>
    {kids.map(k => <button key={k.student_id} role="tab" aria-selected={k.student_id === sel} className={k.student_id === sel ? 'on' : ''} onClick={() => pick(k.student_id)}>{k.full_name}{k.class_name ? ` · ${k.class_name}` : ''}</button>)}
  </div>
}

type View = 'home' | 'schedule' | 'attendance' | 'assignments' | 'competency' | 'settings'
export function ParentPage({ view, go }: { view: View; go?: (p: string) => void }) {
  const { kids, sel, pick, err, reload } = useChildren()
  const [d, setD] = useState<Data | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [scope, setScope] = useState<{ photo: boolean }>({ photo: false })
  useEffect(() => {
    if (!sel) return; setD(null)
    supabase.rpc('parent_child', { p_student: sel }).then(({ data, error }) => { if (error) setMsg([error.message, true]); setD(data as Data) })
  }, [sel])
  if (err) return <p className="msg">{err}</p>
  if (!kids) return <p className="sub">Đang tải…</p>
  if (!kids.length) return <div className="panel"><h3 style={{ marginTop: 0 }}>Chưa gắn với học sinh nào</h3>
    <p className="sub" style={{ margin: 0 }}>Tài khoản phụ huynh được nhà trường tạo theo số điện thoại đã khai báo. Nếu chưa thấy con, liên hệ giáo viên chủ nhiệm để kiểm tra số điện thoại.</p></div>
  const kid = kids.find(k => k.student_id === sel)
  const head = <><Picker kids={kids} sel={sel} pick={pick} />{msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}</>
  if (!d) return <>{head}<p className="sub">Đang tải…</p></>
  const a = d.attendance, total = a.present + a.absent + a.late + a.excused
  const todo = d.assignments.filter(x => ['todo', 'missing', 'returned'].includes(x.status))
  const today = new Date().toISOString().slice(0, 10)
  const days = [...new Set(d.schedule.map(s => s.date))]

  async function consent(agree: boolean) {
    if (!agree && !confirm('Rút đồng ý? Nhà trường có thể phải tạm khoá tài khoản học tập của con trên hệ thống.')) return
    const { error } = await supabase.rpc('parent_consent', { p_student: sel, p_agree: agree, p_scope: ['learning', ...(scope.photo ? ['photo'] : [])] })
    if (error) return setMsg([error.message, true])
    setMsg([agree ? 'Đã ghi nhận đồng ý của phụ huynh.' : 'Đã rút đồng ý.', false])
    const r = await supabase.rpc('parent_child', { p_student: sel }); setD(r.data as Data)
  }
  async function alerts(on: boolean) {
    const { error } = await supabase.rpc('parent_set_alerts', { p_on: on })
    if (error) return setMsg([error.message, true]); setMsg([on ? 'Đã bật thông báo khi con vắng / đi muộn.' : 'Đã tắt thông báo vắng.', false]); reload()
  }

  if (view === 'schedule') return (<>{head}
    <h3>Lịch học 7 ngày tới · {d.student.full_name}</h3>
    {!days.length && <p className="sub">Chưa có lịch trong 7 ngày tới.</p>}
    {days.map(day => <div key={day} className="panel"><b>{dayName(day)}{day === today ? ' · hôm nay' : ''}</b>
      <div className="wrap"><table><tbody>{d.schedule.filter(s => s.date === day).map((s, i) => (
        <tr key={i}><td className="nowrap">{s.period}<br /><small>{s.start?.slice(0, 5)}</small></td><td><b>{s.subject}</b>{s.kind === 'stem' && <span className="plbadge ok" style={{ marginLeft: 6 }}>STEM</span>}<br /><small>{[s.teacher, s.room].filter(Boolean).join(' · ')}</small></td>
          <td>{s.status === 'cancelled' ? <span className="plbadge bad">Nghỉ</span> : ''}</td></tr>))}</tbody></table></div></div>)}
  </>)

  if (view === 'attendance') return (<>{head}
    <div className="cards">
      <div className="card"><strong>{total ? Math.round((100 * (a.present + a.late)) / total) + '%' : '—'}</strong><span>Có mặt (30 ngày)</span></div>
      <div className="card"><strong>{a.absent}</strong><span>Buổi vắng</span></div>
      <div className="card"><strong>{a.late}</strong><span>Đi muộn</span></div>
      <div className="card"><strong>{a.excused}</strong><span>Vắng có phép</span></div>
    </div>
    <h3>Các buổi vắng / muộn gần đây</h3>
    <div className="wrap"><table><thead><tr><th>Ngày</th><th>Môn / hoạt động</th><th>Tình trạng</th><th>Ghi chú</th></tr></thead>
      <tbody>{a.recent.map((r, i) => <tr key={i}><td className="nowrap">{dayName(r.date)}</td><td>{r.subject}</td><td><span className={'plbadge ' + ATT[r.status][1]}>{ATT[r.status][0]}</span></td><td><small>{r.note}</small></td></tr>)}
        {!a.recent.length && <tr><td colSpan={4}>Không có buổi vắng hay đi muộn trong 30 ngày qua.</td></tr>}</tbody></table></div>
    <p className="sub">{kid?.receive_alerts ? 'Phụ huynh nhận thông báo ngay khi con được điểm danh vắng / đi muộn.' : 'Thông báo vắng đang tắt — bật lại ở mục Cài đặt & đồng ý.'}</p>
  </>)

  if (view === 'assignments') return (<>{head}
    <div className="wrap"><table><thead><tr><th>Bài</th><th>Hạn nộp</th><th>Tình trạng</th><th>Điểm</th><th>Nhận xét</th></tr></thead>
      <tbody>{d.assignments.map((x, i) => <tr key={i}><td><b>{x.title}</b>{x.subject && <><br /><small>{x.subject}</small></>}</td><td className="nowrap">{when(x.due_at)}</td>
        <td><span className={'plbadge ' + (AS[x.status]?.[1] ?? 'mute')}>{AS[x.status]?.[0] ?? x.status}</span></td>
        <td>{x.score != null ? `${Number(x.score)}/${Number(x.max_score)}` : '—'}</td><td><small>{x.feedback}</small></td></tr>)}
        {!d.assignments.length && <tr><td colSpan={5}>Chưa có bài tập trong 60 ngày qua.</td></tr>}</tbody></table></div>
  </>)

  if (view === 'competency') return (<>{head}<StudentCompetencyProfile studentId={sel} title={`Năng lực của ${d.student.full_name}`} /></>)

  if (view === 'settings') return (<>{head}
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Thông báo</h3>
      <label><input type="checkbox" checked={!!kid?.receive_alerts} onChange={e => alerts(e.target.checked)} /> Nhận thông báo khi con vắng mặt hoặc đi muộn</label>
    </div>
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Đồng ý xử lý dữ liệu cá nhân của con</h3>
      {d.consent ? <p>Đã đồng ý ngày {new Date(d.consent.on + 'T00:00:00').toLocaleDateString('vi-VN')} ({d.consent.method === 'online' ? 'trên hệ thống' : 'bằng giấy'}, {d.consent.guardian}) —
        phạm vi: {d.consent.scope.map(s => s === 'photo' ? 'ảnh/sản phẩm có hình con' : 'học tập trên hệ thống').join(', ')}.</p>
        : <p className="msg">Nhà trường chưa ghi nhận đồng ý của phụ huynh cho {d.student.full_name}.</p>}
      <p className="sub">Dữ liệu dùng cho học tập STEM: họ tên, lớp, điểm danh, bài làm, kết quả đánh giá. Xem đầy đủ ở Chính sách quyền riêng tư.</p>
      <label style={{ display: 'block', marginBottom: 8 }}><input type="checkbox" checked={scope.photo} onChange={e => setScope({ photo: e.target.checked })} /> Đồng ý cả việc dùng ảnh / sản phẩm có hình của con trong hoạt động STEM của trường</label>
      <div className="tools"><button className="primary" onClick={() => consent(true)}>{d.consent ? 'Cập nhật đồng ý' : 'Tôi đồng ý'}</button>{d.consent && <button onClick={() => consent(false)}>Rút đồng ý</button>}</div>
    </div>
  </>)

  // Tổng quan
  const next = d.schedule.filter(s => s.date >= today && s.status !== 'cancelled').slice(0, 4)
  return (<>{head}
    <h2 style={{ margin: '0 0 4px' }}>{d.student.full_name}</h2>
    <p className="sub" style={{ marginTop: 0 }}>{d.student.class ? `Lớp ${d.student.class} · ` : ''}{d.student.school}{d.homeroom ? ` · GVCN: ${d.homeroom.name}${d.homeroom.email ? ` (${d.homeroom.email})` : ''}` : ''}</p>
    <div className="cards">
      <button className="card" onClick={() => go?.('Chuyên cần của con')}><strong>{total ? Math.round((100 * (a.present + a.late)) / total) + '%' : '—'}</strong><span>Chuyên cần 30 ngày · {a.absent} buổi vắng</span></button>
      <button className="card" onClick={() => go?.('Bài tập & điểm')}><strong>{todo.length}</strong><span>Bài chưa nộp / cần sửa</span></button>
      <button className="card" onClick={() => go?.('Bài tập & điểm')}><strong>{d.assignments.filter(x => x.status === 'graded').length}</strong><span>Bài đã chấm (60 ngày)</span></button>
      <button className="card" onClick={() => go?.('Cài đặt & đồng ý')}><strong>{d.consent ? '✓' : '!'}</strong><span>{d.consent ? 'Đã đồng ý dữ liệu' : 'Chưa xác nhận đồng ý dữ liệu'}</span></button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginTop: 16 }}>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Sắp tới</h3>
        {next.map((s, i) => <p key={i} style={{ margin: '6px 0' }}><b>{s.subject}</b>{s.kind === 'stem' && <span className="plbadge ok" style={{ marginLeft: 6 }}>STEM</span>}<br /><small className="sub">{dayName(s.date)} · {s.period} {s.start?.slice(0, 5)}{s.room ? ' · ' + s.room : ''}</small></p>)}
        {!next.length && <p className="sub">Chưa có lịch.</p>}</div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Bài cần làm</h3>
        {todo.slice(0, 5).map((x, i) => <p key={i} style={{ margin: '6px 0' }}><b>{x.title}</b> <span className={'plbadge ' + AS[x.status][1]}>{AS[x.status][0]}</span><br /><small className="sub">Hạn {when(x.due_at)}</small></p>)}
        {!todo.length && <p className="sub">Không có bài nào đang chờ.</p>}</div>
    </div>
    <MySurveys compact />
  </>)
}
export const ParentHome = (p: any) => <ParentPage {...p} view="home" />
export const ParentSchedule = (p: any) => <ParentPage {...p} view="schedule" />
export const ParentAttendance = (p: any) => <ParentPage {...p} view="attendance" />
export const ParentAssignments = (p: any) => <ParentPage {...p} view="assignments" />
export const ParentCompetency = (p: any) => <ParentPage {...p} view="competency" />
export const ParentSettings = (p: any) => <ParentPage {...p} view="settings" />
