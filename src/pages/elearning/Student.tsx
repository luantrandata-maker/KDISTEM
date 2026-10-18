import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { md } from '../ai'
import { embedUrl, errText, letter, LKIND, type Course, type Exam, type Lesson } from './common'

// Học sinh: E-learning & luyện thi — khoá học, đề luyện (có giờ), lịch sử và xem lại bài.
type Paper = { attempt: string; deadline: string | null; title: string; questions: { id: string; stem: string; options: string[]; kind: string }[]; answers: Record<string, number[]> | null }
type Result = { attempt: string; exam: string; score: number | null; correct: number | null; total: number | null; late: boolean; revealed: boolean; submitted_at: string | null
  answers: Record<string, number[]> | null; questions: { id: string; stem: string; options: string[]; kind: string; answer?: number[]; explain?: string | null }[] }
type Hist = { id: string; exam_id: string; score: number | null; correct: number | null; total: number | null; submitted_at: string | null; status: string; practice_exams: { title: string } | null }
const KEY = (a: string) => 'exam.answers.' + a

export default function StudentElearning({ studentId }: { studentId: string | null }) {
  const [tab, setTab] = useState<'course' | 'exam' | 'hist'>('course')
  const [paper, setPaper] = useState<Paper | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [err, setErr] = useState('')
  async function start(examId: string) {
    setErr(''); setResult(null)
    const { data, error } = await supabase.rpc('exam_start', { p_exam: examId })
    if (error) return setErr(errText(error.message))
    setPaper(data as Paper); window.scrollTo(0, 0)
  }
  async function review(attempt: string) {
    const { data, error } = await supabase.rpc('exam_result', { p_attempt: attempt })
    if (error) return setErr(errText(error.message))
    setPaper(null); setResult(data as Result); window.scrollTo(0, 0)
  }
  if (!studentId) return <p className="sub">Trang dành cho tài khoản học sinh.</p>
  if (paper) return <TakeExam paper={paper} onDone={r => { setPaper(null); setResult(r) }} onExit={() => setPaper(null)} />
  if (result) return <ResultView r={result} onBack={() => setResult(null)} />
  return <>
    <Tabs value={tab} onChange={setTab} items={[['course', 'Khoá học'], ['exam', 'Luyện thi'], ['hist', 'Bài đã làm']]} />
    {err && <p className="msg">{err}</p>}
    {tab === 'course' ? <CourseList studentId={studentId} onExam={start} /> : tab === 'exam' ? <ExamList onStart={start} /> : <History onReview={review} />}
  </>
}

function ExamList({ onStart }: { onStart: (id: string) => void }) {
  const [rows, setRows] = useState<Exam[] | null>(null)
  const [mine, setMine] = useState<Hist[]>([])
  useEffect(() => {
    supabase.from('practice_exams').select('*').neq('status', 'draft').order('opens_at', { ascending: false }).then(({ data }) => setRows((data as Exam[]) ?? []))
    supabase.from('exam_attempts').select('id, exam_id, score, correct, total, submitted_at, status').order('started_at', { ascending: false }).then(({ data }) => setMine((data as Hist[]) ?? []))
  }, [])
  if (!rows) return <p className="sub">Đang tải…</p>
  const now = Date.now()
  return (
    <div className="examcards">
      {rows.map(x => {
        const tries = mine.filter(m => m.exam_id === x.id && m.status === 'submitted'), doing = mine.find(m => m.exam_id === x.id && m.status === 'in_progress')
        const best = tries.reduce((b, t) => Math.max(b, Number(t.score ?? 0)), -1)
        const closed = x.status === 'closed' || (x.closes_at && +new Date(x.closes_at) < now)
        const left = x.max_attempts ? x.max_attempts - tries.length : null
        return <section key={x.id} className="panel examcard">
          <b>{x.title}</b>
          <small>{[x.subject, x.grade ? 'Khối ' + x.grade : null, x.mode === 'random' ? `${x.criteria.count} câu` : `${x.question_ids.length} câu`, x.duration_min ? `${x.duration_min} phút` : 'Không giới hạn giờ'].filter(Boolean).join(' · ')}</small>
          {x.description && <p className="sub">{x.description}</p>}
          <div className="bar">
            <span>{best >= 0 ? <>Điểm cao nhất: <b>{best}</b> · {tries.length} lượt</> : <small>Chưa làm</small>}{x.closes_at && <><br /><small>Hạn: {new Date(x.closes_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</small></>}</span>
            {closed ? <span className="pill inactive">Đã đóng</span> : left === 0 && !doing ? <span className="pill">Hết lượt</span>
              : <button className="primary" onClick={() => onStart(x.id)}>{doing ? 'Làm tiếp' : tries.length ? 'Làm lại' : 'Bắt đầu'}</button>}
          </div>
        </section>
      })}
      {!rows.length && <p className="sub">Chưa có đề luyện nào dành cho em.</p>}
    </div>
  )
}

function TakeExam({ paper, onDone, onExit }: { paper: Paper; onDone: (r: Result) => void; onExit: () => void }) {
  const [ans, setAns] = useState<Record<string, number[]>>(() => {
    try { return JSON.parse(localStorage.getItem(KEY(paper.attempt)) ?? 'null') ?? paper.answers ?? {} } catch { return paper.answers ?? {} }
  })
  const [left, setLeft] = useState<number | null>(paper.deadline ? +new Date(paper.deadline) - Date.now() : null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sent = useRef(false)
  useEffect(() => { try { localStorage.setItem(KEY(paper.attempt), JSON.stringify(ans)) } catch { /* bỏ qua */ } }, [ans])
  async function submit(auto = false) {
    if (sent.current) return
    if (!auto && paper.questions.some(q => !ans[q.id]?.length) && !confirm('Còn câu chưa trả lời. Nộp bài?')) return
    sent.current = true; setBusy(true)
    const { data, error } = await supabase.rpc('exam_submit', { p_attempt: paper.attempt, p_answers: ans })
    setBusy(false)
    if (error) { sent.current = false; return setErr(/Failed to fetch|network/i.test(error.message) ? 'Mất mạng — bài làm vẫn lưu trên máy, bấm Nộp bài lại khi có mạng.' : errText(error.message)) }
    try { localStorage.removeItem(KEY(paper.attempt)) } catch { /* bỏ qua */ }
    onDone(data as Result)
  }
  useEffect(() => {
    if (!paper.deadline) return
    const t = setInterval(() => { const l = +new Date(paper.deadline!) - Date.now(); setLeft(l); if (l <= 0) { clearInterval(t); submit(true) } }, 1000)
    return () => clearInterval(t)
  }, [])
  const done = paper.questions.filter(q => ans[q.id]?.length).length
  const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
  return (
    <div className="takeexam">
      <div className="examhead">
        <div><b>{paper.title}</b><small>Đã trả lời {done}/{paper.questions.length}</small></div>
        {left !== null && <span className={'timer' + (left < 60000 ? ' hot' : '')} role="timer" aria-live="off">⏱ {mmss(left)}</span>}
        <span className="tools"><button onClick={onExit}>Tạm rời</button><button className="primary" onClick={() => submit()} disabled={busy}>{busy ? 'Đang nộp…' : 'Nộp bài'}</button></span>
      </div>
      {err && <p className="msg">{err}</p>}
      <ol className="paper">{paper.questions.map((q, i) => <li key={q.id} id={'q' + i}>
        <p className="stem">{q.stem}{q.kind === 'multi' && <small> (chọn tất cả đáp án đúng)</small>}</p>
        <div className="choices">{q.options.map((o, k) => {
          const on = ans[q.id]?.includes(k)
          return <label key={k} className={on ? 'on' : ''}>
            <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={q.id} checked={!!on} onChange={() => setAns(a => ({ ...a, [q.id]: q.kind === 'multi' ? (on ? a[q.id].filter(x => x !== k) : [...(a[q.id] ?? []), k]) : [k] }))} />
            <b>{letter(k)}</b><span>{o}</span></label>
        })}</div>
      </li>)}</ol>
      <div className="formactions"><button className="primary" onClick={() => submit()} disabled={busy}>{busy ? 'Đang nộp…' : 'Nộp bài'}</button></div>
      <p className="sub">Bài làm tự lưu trên máy; tạm rời rồi vào lại vẫn làm tiếp được{paper.deadline ? ' (đồng hồ vẫn chạy)' : ''}.</p>
    </div>
  )
}

function ResultView({ r, onBack }: { r: Result; onBack: () => void }) {
  return (
    <div className="takeexam">
      <div className="examhead"><div><b>{r.exam}</b><small>{r.submitted_at ? 'Nộp lúc ' + new Date(r.submitted_at).toLocaleString('vi-VN') : ''}{r.late ? ' · quá giờ' : ''}</small></div>
        <span className="bigscore">{r.score ?? '—'}<small>/10</small></span><button onClick={onBack}>Quay lại</button></div>
      <p>Đúng <b>{r.correct}</b>/{r.total} câu.{!r.revealed && ' Thầy cô chưa cho xem đáp án của đề này.'}</p>
      <ol className="paper">{r.questions.map(q => {
        const mine = r.answers?.[q.id] ?? [], right = q.answer ?? []
        const ok = r.revealed && mine.length === right.length && mine.every(x => right.includes(x))
        return <li key={q.id} className={r.revealed ? (ok ? 'qok' : 'qbad') : ''}>
          <p className="stem">{r.revealed && <span className={'pill ' + (ok ? 'active' : 'inactive')}>{ok ? 'Đúng' : 'Chưa đúng'}</span>} {q.stem}</p>
          <div className="choices">{q.options.map((o, k) => <label key={k} className={(mine.includes(k) ? 'on ' : '') + (r.revealed && right.includes(k) ? 'right' : '')}>
            <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} checked={mine.includes(k)} readOnly disabled /><b>{letter(k)}</b><span>{o}</span></label>)}</div>
          {r.revealed && q.explain && <p className="sub">💡 {q.explain}</p>}
        </li>
      })}</ol>
    </div>
  )
}

function History({ onReview }: { onReview: (a: string) => void }) {
  const [rows, setRows] = useState<Hist[] | null>(null)
  useEffect(() => { supabase.from('exam_attempts').select('id, exam_id, score, correct, total, submitted_at, status, practice_exams(title)').eq('status', 'submitted').order('submitted_at', { ascending: false }).then(({ data }) => setRows((data as any[]) ?? [])) }, [])
  if (!rows) return <p className="sub">Đang tải…</p>
  return <div className="wrap"><table className="systable"><thead><tr><th>Đề</th><th className="num">Điểm</th><th>Nộp lúc</th><th /></tr></thead><tbody>
    {rows.map(h => <tr key={h.id}><td>{h.practice_exams?.title}</td><td className="num"><b>{h.score}</b> <small>({h.correct}/{h.total})</small></td><td>{h.submitted_at && new Date(h.submitted_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><button onClick={() => onReview(h.id)}>Xem lại</button></td></tr>)}
    {!rows.length && <tr><td colSpan={4}>Em chưa làm đề nào.</td></tr>}
  </tbody></table></div>
}

function CourseList({ studentId, onExam }: { studentId: string; onExam: (id: string) => void }) {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [done, setDone] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  async function load() {
    const [c, l, p] = await Promise.all([supabase.from('courses').select('*').eq('status', 'published').order('created_at', { ascending: false }),
      supabase.from('course_lessons').select('*').order('position'), supabase.from('course_progress').select('lesson_id').eq('student_id', studentId)])
    setCourses((c.data as Course[]) ?? []); setLessons((l.data as Lesson[]) ?? []); setDone(new Set(((p.data as any[]) ?? []).map(x => x.lesson_id)))
  }
  useEffect(() => { load() }, [])
  async function mark(l: Lesson, on: boolean) {
    if (on) await supabase.from('course_progress').insert({ lesson_id: l.id, student_id: studentId })
    else await supabase.from('course_progress').delete().eq('lesson_id', l.id).eq('student_id', studentId)
    load()
  }
  if (!courses) return <p className="sub">Đang tải…</p>
  const c = courses.find(x => x.id === open)
  if (c) {
    const ls = lessons.filter(l => l.course_id === c.id), n = ls.filter(l => done.has(l.id)).length
    const cur = lesson ?? ls.find(l => !done.has(l.id)) ?? ls[0]
    return (
      <div className="courseview">
        <div className="bar"><div><b>{c.title}</b><br /><small>Đã học {n}/{ls.length} bài</small></div><button onClick={() => { setOpen(null); setLesson(null) }}>Tất cả khoá học</button></div>
        <div className="progress"><i style={{ width: (ls.length ? (100 * n) / ls.length : 0) + '%' }} /></div>
        <div className="coursebody">
          <ol className="lessonnav">{ls.map(l => <li key={l.id}><button className={cur?.id === l.id ? 'on' : ''} onClick={() => setLesson(l)}>
            <span className={'chk' + (done.has(l.id) ? ' yes' : '')} aria-label={done.has(l.id) ? 'Đã học' : 'Chưa học'}>{done.has(l.id) ? '✓' : ''}</span>
            <span>{l.title}<small>{LKIND[l.kind]}{l.duration_min ? ` · ${l.duration_min} phút` : ''}</small></span></button></li>)}</ol>
          {cur && <article className="panel lessonbody">
            <h3>{cur.title}</h3>
            {cur.kind === 'video' && (embedUrl(cur.url) ? <div className="video"><iframe src={embedUrl(cur.url)!} title={cur.title} allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
              : <p><a href={cur.url!} target="_blank" rel="noreferrer">Mở video ↗</a></p>)}
            {cur.kind === 'link' && <p><a className="primary btnlink" href={cur.url!} target="_blank" rel="noreferrer">Mở tài liệu ↗</a></p>}
            {cur.kind === 'exam' && cur.exam_id && <p><button className="primary" onClick={() => onExam(cur.exam_id!)}>Làm đề luyện</button></p>}
            {cur.body && <div className="mdbody" dangerouslySetInnerHTML={{ __html: md(cur.body) }} />}
            <div className="formactions"><label className="field inline"><input type="checkbox" checked={done.has(cur.id)} onChange={e => mark(cur, e.target.checked)} /> Em đã học xong bài này</label>
              {ls[ls.indexOf(cur) + 1] && <button onClick={() => setLesson(ls[ls.indexOf(cur) + 1])}>Bài tiếp →</button>}</div>
          </article>}
        </div>
      </div>
    )
  }
  return (
    <div className="coursegrid">
      {courses.map(x => { const ls = lessons.filter(l => l.course_id === x.id), n = ls.filter(l => done.has(l.id)).length
        return <button key={x.id} className="panel coursecard pick" onClick={() => setOpen(x.id)}>
          {x.cover_url && <img src={x.cover_url} alt="" loading="lazy" />}
          <b>{x.title}</b><small>{[x.subject, x.grade ? 'Khối ' + x.grade : null, `${ls.length} bài`].filter(Boolean).join(' · ')}</small>
          <div className="progress"><i style={{ width: (ls.length ? (100 * n) / ls.length : 0) + '%' }} /></div><small>{n ? `Đã học ${n}/${ls.length}` : 'Chưa bắt đầu'}</small>
        </button> })}
      {!courses.length && <p className="sub">Chưa có khoá học nào dành cho em.</p>}
    </div>
  )
}
