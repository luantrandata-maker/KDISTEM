import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, useMyClasses } from './common'
import { SlideView, type Plan } from './Lessons'

type Session = { id: string; class_id: string; title: string; pin: string; status: string; lesson_plan_id: string | null; current_slide: number; started_at: string }
type Student = { id: string; full_name: string }
type Borrow = { id: string; title: string; items: string | null; item_list: { name: string; qty: number }[]; status: string; on_date: string }
type TodayEntry = { id: string; subject: string; kind: string; class_id: string; classes: { name: string } | null; period_configs: { name: string; starts_at: string } | null; stem_rooms: { name: string } | null }

const todayWeekday = () => { const d = new Date().getDay(); return d === 0 ? 0 : d + 1 }
const localDate = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }

// Giáo dục STEM trên lớp: chọn lớp + bài giảng → mở phiên có mã PIN → trình chiếu với công cụ lớp học
export function TeacherClassroom({ teacherId, orgId }: TProps) {
  const classes = useMyClasses(teacherId)
  const [plans, setPlans] = useState<Plan[]>([])
  const [today, setToday] = useState<TodayEntry[]>([])
  const [borrows, setBorrows] = useState<Borrow[]>([])
  const [live, setLive] = useState<Session | null>(null)
  const [pick, setPick] = useState({ class_id: '', plan_id: '', title: '' })
  const [err, setErr] = useState('')

  async function load() {
    if (!teacherId) return
    const [p, t, b, s] = await Promise.all([
      supabase.from('lesson_plans').select('*').or(`teacher_id.eq.${teacherId},is_template.eq.true,status.eq.published`).order('updated_at', { ascending: false }),
      supabase.from('timetable_entries').select('id, subject, kind, class_id, classes(name), period_configs(name, starts_at), stem_rooms(name)')
        .eq('teacher_id', teacherId).eq('weekday', todayWeekday()),
      supabase.from('borrow_requests').select('id, title, items, item_list, status, on_date').eq('teacher_id', teacherId).eq('on_date', localDate()).in('status', ['approved', 'lent']),
      supabase.from('class_sessions').select('*').eq('teacher_id', teacherId).eq('status', 'live').order('started_at', { ascending: false }).limit(1),
    ])
    setPlans((p.data as Plan[]) ?? [])
    setToday(((t.data as unknown as TodayEntry[]) ?? []).sort((a, b) => (a.period_configs?.starts_at ?? '').localeCompare(b.period_configs?.starts_at ?? '')))
    setBorrows((b.data as Borrow[]) ?? [])
    const cur = (s.data as Session[])?.[0]
    if (cur) setLive(cur)
  }
  useEffect(() => { load() }, [teacherId])
  useEffect(() => { if (!pick.class_id && classes[0]) setPick(v => ({ ...v, class_id: classes[0].id })) }, [classes.length])

  async function start(e: React.FormEvent) {
    e.preventDefault()
    const plan = plans.find(p => p.id === pick.plan_id)
    const { data, error } = await supabase.rpc('start_class_session', {
      p_class: pick.class_id, p_title: pick.title || plan?.title || 'Tiết học STEM', p_lesson: null, p_plan: pick.plan_id || null,
    })
    if (error) return setErr(error.message)
    setErr(''); setLive(data as Session)
  }

  if (!teacherId) return <NoTeacher />
  if (live) return <LiveClass session={live} plan={plans.find(p => p.id === live.lesson_plan_id) ?? null} orgId={orgId} teacherId={teacherId}
    borrows={borrows} className={classes.find(c => c.id === live.class_id)?.name ?? ''} onEnd={() => { setLive(null); load() }} />

  const myPlans = plans.filter(p => p.teacher_id === teacherId)
  const others = plans.filter(p => p.teacher_id !== teacherId)
  return (
    <>
      <div className="twocol">
        <form className="panel formgrid" onSubmit={start}>
          <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>Bắt đầu tiết học STEM</h3>
          <label className="field"><span>Lớp *</span>
            <select required value={pick.class_id} onChange={e => setPick({ ...pick, class_id: e.target.value })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Bài giảng</span>
            <select value={pick.plan_id} onChange={e => setPick({ ...pick, plan_id: e.target.value })}>
              <option value="">Không dùng bài giảng (chỉ mở lớp)</option>
              {myPlans.length > 0 && <optgroup label="Bài của tôi">{myPlans.map(p => <option key={p.id} value={p.id}>{p.title}{p.status !== 'published' ? ' (chưa xuất bản)' : ''}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Kho mẫu & đồng nghiệp">{others.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>}
            </select></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên tiết học</span>
            <input value={pick.title} onChange={e => setPick({ ...pick, title: e.target.value })} placeholder="Mặc định: tên bài giảng" /></label>
          <div className="formactions"><button className="primary" type="submit" disabled={!classes.length}>Mở lớp & lấy mã PIN</button></div>
          {err && <p className="msg">{err}</p>}
          <small style={{ gridColumn: '1 / -1' }}>Học sinh vào lớp bằng mã PIN 6 số hiển thị trên màn chiếu. Mỗi lớp chỉ có một phiên mở cùng lúc.</small>
        </form>
        <div className="panel">
          <h3>Tiết dạy hôm nay</h3>
          {today.length === 0 && <small>Hôm nay bạn không có tiết trong thời khóa biểu.</small>}
          {today.map(t => (
            <button key={t.id} className="todo" type="button" onClick={() => setPick({ ...pick, class_id: t.class_id })}>
              <span><b>{t.period_configs?.name}</b> · {t.subject}{t.kind === 'stem' && <span className="badge">STEM</span>}<br />
                <small>{t.classes?.name}{t.stem_rooms ? ` · ${t.stem_rooms.name}` : ''}</small></span>
              <small>Chọn lớp</small>
            </button>
          ))}
          <h3 style={{ marginTop: 14 }}>Thiết bị mượn hôm nay</h3>
          <BorrowList items={borrows} />
        </div>
      </div>
    </>
  )
}

function BorrowList({ items }: { items: Borrow[] }) {
  if (!items.length) return <small>Không có thiết bị mượn được duyệt cho hôm nay. Gửi phiếu ở mục Đặt phòng STEM → Mượn thiết bị.</small>
  return (
    <>{items.map(b => (
      <div className="roomrow" key={b.id}>
        <span><b>{b.title}</b><br /><small>{b.item_list?.length ? b.item_list.map(x => `${x.name} × ${x.qty}`).join(', ') : b.items}</small></span>
        <span className={'pill ' + (b.status === 'lent' ? 'active' : 'maintenance')}>{b.status === 'lent' ? 'Đã nhận' : 'Đã duyệt'}</span>
      </div>
    ))}</>
  )
}

type Tool = '' | 'random' | 'timer' | 'board' | 'notes' | 'assign' | 'devices'

function LiveClass({ session, plan, className, orgId, teacherId, borrows, onEnd }: {
  session: Session; plan: Plan | null; className: string; orgId: string | null; teacherId: string; borrows: Borrow[]; onEnd: () => void
}) {
  const [i, setI] = useState(session.current_slide ?? 0)
  const [joined, setJoined] = useState<Student[]>([])
  const [roster, setRoster] = useState<Student[]>([])
  const [tool, setTool] = useState<Tool>('')
  const [reveal, setReveal] = useState(false)
  const [msg, setMsg] = useState('')
  const stage = useRef<HTMLDivElement>(null)
  const slides = plan?.slides ?? []

  // Điểm danh: học sinh vào lớp bằng PIN (làm mới mỗi 5 giây)
  useEffect(() => {
    supabase.from('students').select('id, full_name').eq('class_id', session.class_id).order('student_code').then(({ data }) => setRoster(data ?? []))
    const tick = () => supabase.from('class_session_attendance').select('students(id, full_name)').eq('session_id', session.id)
      .then(({ data }) => setJoined(((data as any[]) ?? []).map(x => x.students).filter(Boolean)))
    tick(); const h = setInterval(tick, 5000); return () => clearInterval(h)
  }, [session.id])

  async function goto(n: number) {
    const j = Math.max(0, Math.min(slides.length - 1, n)); setI(j); setReveal(false)
    await supabase.from('class_sessions').update({ current_slide: j }).eq('id', session.id)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goto(i + 1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goto(i - 1)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [i, slides.length])

  async function end() {
    if (!confirm('Kết thúc tiết học? Học sinh sẽ không vào lớp bằng mã PIN này được nữa.')) return
    const { error } = await supabase.rpc('end_class_session', { p_session: session.id })
    if (error) return setMsg(error.message)
    onEnd()
  }
  const fullscreen = () => { const el = stage.current; if (!el) return; document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.() }
  const cur = slides[i]

  return (
    <div className="liveclass">
      <div className="bar">
        <span><b>{session.title}</b> · {className} <small>· bắt đầu {new Date(session.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></span>
        <span className="tools">
          <span className="pinbox" title="Học sinh nhập mã này để vào lớp">Mã vào lớp <b>{session.pin}</b></span>
          <span className="pill active">{joined.length}/{roster.length} đã vào</span>
          <button onClick={end}>Kết thúc tiết</button>
        </span>
      </div>
      {msg && <p className="msg">{msg}</p>}
      <div className="stage" ref={stage}>
        {plan ? <SlideView slide={cur} reveal={reveal} /> : (
          <div className="slide title"><span className="slidekind">Lớp học STEM</span><h2>{session.title}</h2>
            <div className="slidebody"><p>Mã vào lớp: <b className="bigpin">{session.pin}</b></p><p>Mở ứng dụng → Giáo dục STEM → nhập mã PIN</p></div></div>
        )}
        {tool === 'board' && <Whiteboard onClose={() => setTool('')} />}
        <div className="stagebar">
          {plan && <>
            <button onClick={() => goto(i - 1)} disabled={i === 0} aria-label="Slide trước">‹</button>
            <span>{i + 1}/{slides.length || 1}</span>
            <button onClick={() => goto(i + 1)} disabled={i >= slides.length - 1} aria-label="Slide sau">›</button>
            {cur?.kind === 'question' && <button onClick={() => setReveal(!reveal)}>{reveal ? 'Ẩn đáp án' : 'Hiện đáp án'}</button>}
          </>}
          <span className="pinsmall">PIN {session.pin}</span>
          <button onClick={fullscreen}>Toàn màn hình</button>
        </div>
      </div>
      <div className="toolbar" role="toolbar" aria-label="Công cụ lớp học">
        {([['assign', 'Giao bài cả lớp'], ['board', 'Bảng trắng'], ['notes', 'Ghi chú'], ['random', 'Gọi ngẫu nhiên'], ['timer', 'Hẹn giờ'], ['devices', 'Thiết bị']] as [Tool, string][])
          .map(([k, l]) => <button key={k} className={tool === k ? 'on' : ''} onClick={() => setTool(tool === k ? '' : k)}>{l}</button>)}
      </div>
      {cur?.kind === 'question' && <VoteTally sessionId={session.id} slide={cur} reveal={reveal} joined={joined.length} />}
      {tool === 'random' && <RandomCall pool={joined.length ? joined : roster} fromJoined={joined.length > 0} />}
      {tool === 'timer' && <Timer preset={cur?.kind === 'task' ? cur.minutes : undefined} />}
      {tool === 'notes' && <Notes sessionId={session.id} />}
      {tool === 'devices' && <div className="panel"><BorrowList items={borrows} /></div>}
      {tool === 'assign' && <QuickAssign classId={session.class_id} orgId={orgId} teacherId={teacherId} suggestion={cur?.kind === 'task' ? cur.title : session.title} onDone={m => { setMsg(m); setTool('') }} />}
      <div className="panel">
        <b>Đã vào lớp ({joined.length})</b>{' '}
        {joined.length ? joined.map(s => <span className="chip" key={s.id} style={{ paddingRight: 12 }}>{s.full_name}</span>)
          : <small>Chưa có học sinh nào nhập mã PIN.</small>}
      </div>
    </div>
  )
}

// Kết quả biểu quyết của học sinh cho slide câu hỏi đang chiếu (làm mới mỗi 3 giây)
function VoteTally({ sessionId, slide, reveal, joined }: { sessionId: string; slide: { id: string; options?: string[]; answer?: number }; reveal: boolean; joined: number }) {
  const [tally, setTally] = useState<Record<number, number>>({})
  useEffect(() => {
    const tick = () => supabase.rpc('session_tally', { p_session: sessionId, p_slide: slide.id })
      .then(({ data }) => setTally(Object.fromEntries(((data as { answer: number; n: number }[]) ?? []).map(x => [x.answer, Number(x.n)]))))
    tick(); const h = setInterval(tick, 3000); return () => clearInterval(h)
  }, [sessionId, slide.id])
  const total = Object.values(tally).reduce((a, b) => a + b, 0)
  return (
    <div className="panel">
      <b>Biểu quyết: {total}/{joined} học sinh đã trả lời</b>
      <div className="bars" style={{ marginTop: 8 }}>
        {(slide.options ?? []).map((o, i) => {
          const n = tally[i] ?? 0; const pct = total ? Math.round(100 * n / total) : 0
          return (
            <div className="barrow" key={i}>
              <span><b>{String.fromCharCode(65 + i)}</b> {o}</span>
              <div className="track"><div className={'fill ' + (reveal && slide.answer === i ? 'g' : 'o')} style={{ width: pct + '%', background: reveal || slide.answer === undefined ? undefined : 'var(--accent)' }} /></div>
              <span>{n}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RandomCall({ pool, fromJoined }: { pool: Student[]; fromJoined: boolean }) {
  const [picked, setPicked] = useState<Student | null>(null)
  const [called, setCalled] = useState<string[]>([])
  const [rolling, setRolling] = useState(false)
  function roll() {
    const left = pool.filter(s => !called.includes(s.id)); const src = left.length ? left : pool
    if (!src.length) return
    setRolling(true); let n = 0
    const h = setInterval(() => {
      setPicked(src[Math.floor(Math.random() * src.length)]); n++
      if (n > 12) { clearInterval(h); const final = src[Math.floor(Math.random() * src.length)]; setPicked(final); setCalled(c => left.length ? [...c, final.id] : [final.id]); setRolling(false) }
    }, 70)
  }
  return (
    <div className="panel toolpanel">
      <div className="bigname" aria-live="polite">{picked?.full_name ?? '—'}</div>
      <div className="tools"><button className="primary" onClick={roll} disabled={rolling || !pool.length}>Gọi ngẫu nhiên</button>
        <small>{fromJoined ? 'Trong số học sinh đã vào lớp' : 'Trong danh sách lớp'} · không lặp lại đến khi gọi hết ({called.length}/{pool.length})</small></div>
    </div>
  )
}

function Timer({ preset }: { preset?: number }) {
  const [total, setTotal] = useState((preset ?? 5) * 60)
  const [left, setLeft] = useState(total)
  const [run, setRun] = useState(false)
  useEffect(() => { if (!run) return; const h = setInterval(() => setLeft(l => { if (l <= 1) { setRun(false); return 0 } return l - 1 }), 1000); return () => clearInterval(h) }, [run])
  const set = (m: number) => { setTotal(m * 60); setLeft(m * 60); setRun(false) }
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0')
  return (
    <div className="panel toolpanel">
      <div className={'bigname timer' + (left === 0 ? ' done' : left <= 30 ? ' warn' : '')} aria-live="polite">{mm}:{ss}</div>
      <div className="tools">
        {[1, 3, 5, 10, 15].map(m => <button key={m} className={total === m * 60 ? 'on' : ''} onClick={() => set(m)}>{m} phút</button>)}
        <button className="primary" onClick={() => setRun(!run)} disabled={left === 0}>{run ? 'Tạm dừng' : 'Bắt đầu'}</button>
        <button onClick={() => { setLeft(total); setRun(false) }}>Đặt lại</button>
      </div>
    </div>
  )
}

function Notes({ sessionId }: { sessionId: string }) {
  const key = 'notes.' + sessionId
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) ?? '' } catch { return '' } })
  useEffect(() => { try { localStorage.setItem(key, text) } catch { /* bỏ qua */ } }, [text])
  return (
    <div className="panel toolpanel">
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Ghi chú riêng cho tiết này (lưu trên máy này)…" aria-label="Ghi chú tiết học" style={{ width: '100%' }} />
    </div>
  )
}

function QuickAssign({ classId, orgId, teacherId, suggestion, onDone }: { classId: string; orgId: string | null; teacherId: string; suggestion: string; onDone: (msg: string) => void }) {
  const end = () => { const d = new Date(); d.setHours(23, 59, 0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
  const [f, setF] = useState({ title: suggestion, kind: 'worksheet', due: end(), group_mode: false })
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('assignments').insert({
      org_id: orgId, teacher_id: teacherId, class_id: classId, title: f.title.trim(), kind: f.kind, group_mode: f.group_mode,
      due_at: f.due ? new Date(f.due).toISOString() : null, status: 'open',
    })
    if (error) return setErr(error.message)
    onDone(`Đã giao “${f.title}” cho cả lớp.`)
  }
  return (
    <form className="panel formgrid toolpanel" onSubmit={submit}>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Đề bài</span><input required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
      <label className="field"><span>Loại</span><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
        <option value="worksheet">Phiếu học tập</option><option value="product">Sản phẩm</option><option value="quiz">Kiểm tra</option><option value="report">Báo cáo</option></select></label>
      <label className="field"><span>Hạn nộp</span><input type="datetime-local" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></label>
      <label className="field"><span>Hình thức</span><span><input type="checkbox" checked={f.group_mode} onChange={e => setF({ ...f, group_mode: e.target.checked })} /> Nộp theo nhóm</span></label>
      <div className="formactions"><button className="primary" type="submit">Giao bài</button></div>
      {err && <p className="msg">{err}</p>}
    </form>
  )
}

// Bảng trắng phủ lên slide: bút, tẩy, xoá hết
function Whiteboard({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#d64545')
  const [erase, setErase] = useState(false)
  const drawing = useRef(false)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const fit = () => { const r = c.getBoundingClientRect(); const img = c.toDataURL(); c.width = r.width; c.height = r.height; const im = new Image(); im.onload = () => c.getContext('2d')?.drawImage(im, 0, 0); im.src = img }
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit)
  }, [])
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = (e: React.PointerEvent) => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return
    drawing.current = true; ref.current!.setPointerCapture(e.pointerId)
    const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y)
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color; ctx.lineWidth = erase ? 28 : 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  }
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current?.getContext('2d'); const [x, y] = pos(e); ctx?.lineTo(x, y); ctx?.stroke() }
  const clear = () => { const c = ref.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height) }
  return (
    <div className="board">
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false }} aria-label="Bảng trắng" />
      <div className="boardtools">
        {['#d64545', '#1c63bb', '#2c965d', '#141f32'].map(c => <button key={c} className={'swatch' + (!erase && color === c ? ' on' : '')} style={{ background: c }} onClick={() => { setColor(c); setErase(false) }} aria-label={'Bút màu ' + c} />)}
        <button className={erase ? 'on' : ''} onClick={() => setErase(!erase)}>Tẩy</button>
        <button onClick={clear}>Xoá hết</button>
        <button onClick={onClose}>Đóng bảng</button>
      </div>
    </div>
  )
}
