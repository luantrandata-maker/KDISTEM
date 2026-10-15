import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SlideView, type Plan } from '../teacher/Lessons'
import { SProps, NoStudent, useMe } from './common'

type Session = { id: string; title: string; status: string; current_slide: number; lesson_plan_id: string | null; started_at: string; teachers: { full_name: string } | null }

// Phòng học STEM của học sinh: nhập PIN → xem slide thầy cô đang chiếu → trả lời câu hỏi (biểu quyết)
export function StudentClassroom({ studentId, orgId }: SProps) {
  const me = useMe(studentId)
  const [pin, setPin] = useState('')
  const [sid, setSid] = useState<string | null>(() => { try { return sessionStorage.getItem('stem.session') } catch { return null } })
  const [s, setS] = useState<Session | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [mine, setMine] = useState<Record<string, number>>({})
  const [liveTitle, setLiveTitle] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const planId = useRef<string | null>(null)

  useEffect(() => {
    if (!me?.class_id || sid) return
    supabase.from('class_sessions').select('title').eq('class_id', me.class_id).eq('status', 'live').limit(1).then(({ data }) => setLiveTitle(data?.[0]?.title ?? null))
  }, [me?.class_id, sid])

  // Theo dõi phiên: slide hiện tại, trạng thái (làm mới mỗi 3 giây)
  useEffect(() => {
    if (!sid) return
    let stop = false
    const tick = async () => {
      const { data } = await supabase.from('class_sessions').select('id, title, status, current_slide, lesson_plan_id, started_at, teachers(full_name)').eq('id', sid).maybeSingle()
      if (stop) return
      const cur = data as unknown as Session | null
      setS(cur)
      if (cur?.lesson_plan_id && cur.lesson_plan_id !== planId.current) {
        planId.current = cur.lesson_plan_id
        const p = await supabase.from('lesson_plans').select('*').eq('id', cur.lesson_plan_id).maybeSingle()
        setPlan((p.data as Plan) ?? null)
        const r = await supabase.from('session_responses').select('slide_id, answer').eq('session_id', sid)
        setMine(Object.fromEntries(((r.data as { slide_id: string; answer: number }[]) ?? []).map(x => [x.slide_id, x.answer])))
      }
    }
    tick(); const h = setInterval(tick, 3000)
    return () => { stop = true; clearInterval(h) }
  }, [sid])

  async function join(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('join_class_session', { p_pin: pin.replace(/\D/g, '') })
    setBusy(false)
    if (error) return setErr(error.message)
    try { sessionStorage.setItem('stem.session', data as string) } catch { /* bỏ qua */ }
    setSid(data as string); setPin('')
  }
  function leave() {
    try { sessionStorage.removeItem('stem.session') } catch { /* bỏ qua */ }
    setSid(null); setS(null); setPlan(null); planId.current = null; setMine({})
  }
  async function vote(slideId: string, answer: number) {
    if (!me || !sid) return
    const prev = mine[slideId]; setMine({ ...mine, [slideId]: answer })
    const { error } = await supabase.from('session_responses').upsert({ org_id: orgId, session_id: sid, slide_id: slideId, student_id: me.id, answer, answered_at: new Date().toISOString() })
    if (error) { setErr('Chưa gửi được câu trả lời: ' + error.message); setMine({ ...mine, [slideId]: prev }) }
  }

  if (!studentId) return <NoStudent />
  if (!sid || !s) {
    return (
      <div className="pinjoin">
        <div className="panel">
          <h2>Phòng học STEM</h2>
          <p className="sub">Nhập mã PIN 6 số thầy cô hiển thị trên màn chiếu để vào lớp.</p>
          {liveTitle && <p className="livehint">🔴 Lớp {me?.class_name} đang có tiết: <b>{liveTitle}</b></p>}
          <form onSubmit={join} className="pinform">
            <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
              placeholder="••••••" aria-label="Mã PIN 6 số" autoFocus />
            <button className="primary" type="submit" disabled={pin.length !== 6 || busy}>{busy ? 'Đang vào…' : 'Vào lớp'}</button>
          </form>
          {err && <p className="msg">{err}</p>}
        </div>
      </div>
    )
  }

  const slide = plan?.slides[s.current_slide]
  const ended = s.status !== 'live'
  return (
    <div className="studentlive">
      <div className="bar">
        <span><b>{s.title}</b> <small>· {s.teachers?.full_name}</small></span>
        <span className="tools">{ended ? <span className="pill inactive">Tiết học đã kết thúc</span> : <span className="pill active">● Đang học</span>}
          <button onClick={leave}>Rời lớp</button></span>
      </div>
      {ended ? (
        <div className="panel"><h3>Tiết học đã kết thúc</h3><p className="sub">Cảm ơn em đã tham gia. Bài tập (nếu có) sẽ hiện ở mục Bài tập.</p></div>
      ) : plan ? (
        <>
          <SlideView slide={slide} hideOptions />
          {slide?.kind === 'question' && (
            <div className="panel votebox">
              <b>Chọn câu trả lời của em</b>
              <div className="voteopts">
                {(slide.options ?? []).map((o, i) => (
                  <button key={i} className={mine[slide.id] === i ? 'on' : ''} onClick={() => vote(slide.id, i)} aria-pressed={mine[slide.id] === i}>
                    <b>{String.fromCharCode(65 + i)}</b> {o}
                  </button>
                ))}
              </div>
              <small>{mine[slide.id] !== undefined ? 'Đã gửi — em có thể đổi đáp án đến khi thầy cô chuyển slide.' : 'Chưa trả lời.'}</small>
            </div>
          )}
          <p className="sub">Slide {s.current_slide + 1}/{plan.slides.length} · màn hình tự chuyển theo thầy cô</p>
        </>
      ) : (
        <div className="panel"><h3>Em đã vào lớp ✓</h3><p className="sub">Hãy theo dõi màn chiếu của thầy cô.</p></div>
      )}
      {err && <p className="msg">{err}</p>}
    </div>
  )
}
