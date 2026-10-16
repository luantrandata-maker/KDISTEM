// Học sinh → Học trước & tự học (migration 030)
// Đề lấy qua self_study_open() (không có đáp án), nộp qua self_study_submit() — CSDL chấm.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs, dueLabel, fmtDateTime, handoff } from '../teacher/common'
import { ACT, ActivityPlayer, emptyAnswers, answered, type ActKind, type Grade } from '../teacher/activity'
import { SS_COLS, MODE, ssKindLabel, type SSItem } from '../teacher/SelfStudy'
import { SProps, NoStudent, useMe } from './common'

type MyProg = { item_id: string; status: 'started' | 'done'; attempts: number; score: number | null; best_score: number | null; teacher_comment: string | null; late: boolean }
type Opened = {
  kind: ActKind | 'lesson' | 'link'; content: any
  progress: { status: string; attempts: number; score: number | null; best_score: number | null; correct: number | null; total: number | null; answers: any; teacher_comment: string | null; completed_at: string | null }
  attempts_left: number | null; can_submit: boolean; solution: any | null; grade: Grade | null
}

// Bài tự học của lớp + tiến độ của học sinh (dùng cả ở Tổng quan)
export function useSelfStudy(classId: string | null | undefined, studentId: string | null | undefined) {
  const [items, setItems] = useState<SSItem[]>([])
  const [prog, setProg] = useState<Record<string, MyProg>>({})
  async function reload() {
    if (!classId || !studentId) return
    const [i, p] = await Promise.all([
      supabase.from('self_study_items').select(SS_COLS).eq('class_id', classId).neq('status', 'draft').lte('opens_at', new Date().toISOString())
        .order('due_at', { ascending: true, nullsFirst: false }),
      supabase.from('self_study_progress').select('item_id, status, attempts, score, best_score, teacher_comment, late').eq('student_id', studentId),
    ])
    setItems((i.data as unknown as SSItem[]) ?? [])
    setProg(Object.fromEntries(((p.data as MyProg[]) ?? []).map(x => [x.item_id, x])))
  }
  useEffect(() => { reload() }, [classId, studentId])
  const todo = items.filter(i => i.status === 'open' && prog[i.id]?.status !== 'done')
  return { items, prog, todo, reload }
}

type T = 'todo' | 'done' | 'all'

export function StudentSelfStudy({ studentId }: SProps) {
  const me = useMe(studentId)
  const ss = useSelfStudy(me?.class_id, me?.id)
  const [tab, setTab] = useState<T>('todo')
  const [open, setOpen] = useState<SSItem | null>(null)
  const want = useState(() => handoff.take('student.selfstudy'))[0]
  useEffect(() => { if (want && !open) { const i = ss.items.find(x => x.id === want); if (i) setOpen(i) } }, [ss.items.length])

  if (!studentId) return <NoStudent />
  if (open) return <Work item={open} onBack={() => { setOpen(null); ss.reload() }} />

  const lists: Record<T, SSItem[]> = {
    todo: ss.todo,
    done: ss.items.filter(i => ss.prog[i.id]?.status === 'done'),
    all: ss.items,
  }
  const shown = lists[tab]
  return (
    <>
      <div className="bar">
        <Tabs<T> value={tab} onChange={setTab} items={[['todo', 'Cần làm', lists.todo.length], ['done', 'Đã xong', lists.done.length], ['all', 'Tất cả', lists.all.length]]} />
      </div>
      {shown.map(i => {
        const p = ss.prog[i.id]; const due = dueLabel(i.due_at)
        return (
          <div className="workrow" key={i.id}>
            <div><b>{i.title}</b><br />
              <small><span className="kind">{ssKindLabel(i)}</span> {MODE[i.mode]}{i.teachers ? ` · ${i.teachers.full_name}` : ''} · </small>
              <small className={'due ' + (p?.status === 'done' ? '' : due.tone)}>{i.status === 'closed' ? 'Đã khoá' : due.text}</small>
              {i.note && <><br /><small>💬 {i.note}</small></>}
            </div>
            {p?.status === 'done'
              ? (p.best_score != null ? <span className="pill active">{Number(p.best_score).toFixed(1)} điểm</span> : <span className="pill active">Đã xong</span>)
              : p ? <span className="pill maintenance">Đang làm</span> : <span />}
            <button className={p?.status !== 'done' ? 'primary' : ''} onClick={() => setOpen(i)}>{p?.status === 'done' ? 'Xem lại' : p ? 'Làm tiếp →' : 'Bắt đầu →'}</button>
          </div>
        )
      })}
      {shown.length === 0 && <p className="sub">{tab === 'todo' ? 'Em đã hoàn thành mọi bài học trước và tự học. Tuyệt vời! 🎉' : 'Chưa có bài nào.'}</p>}
    </>
  )
}

function Work({ item, onBack }: { item: SSItem; onBack: () => void }) {
  const [o, setO] = useState<Opened | null>(null)
  const [ans, setAns] = useState<any>(null)
  const [grade, setGrade] = useState<Grade | null>(null)
  const [solution, setSolution] = useState<any>(null)
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data, error } = await supabase.rpc('self_study_open', { p_item: item.id })
    if (error) return setErr(error.code === '42501' && /Chỉ học sinh/.test(error.message)
      ? 'Đây là chế độ xem thử của quản trị: chỉ tài khoản học sinh mới làm được bài.' : error.message)
    const d = data as Opened
    setO(d); setSolution(d.solution); setGrade(d.grade)
    setAns(d.progress.answers ?? emptyAnswers(d.kind as ActKind, d.content))
  }
  useEffect(() => { load() }, [item.id])

  async function submit() {
    if (!o) return
    setBusy(true); setErr('')
    const needs = o.kind !== 'lesson' && o.kind !== 'link' && o.kind !== 'flashcard'
    const { data, error } = await supabase.rpc('self_study_submit', { p_item: item.id, p_answers: needs ? ans : null })
    setBusy(false)
    if (error) return setErr(error.message)
    const r = data as { score: number | null; correct: number | null; total: number | null; grade: Grade; attempts_left: number | null; solution: any }
    setGrade(r.grade?.total ? r.grade : null); setSolution(r.solution)
    setInfo(r.total ? `Em đúng ${r.correct}/${r.total} — ${Number(r.score).toFixed(1)} điểm.${r.attempts_left === 0 ? ' Em đã dùng hết lượt.' : r.attempts_left ? ` Còn ${r.attempts_left} lượt.` : ''}`
      : o.kind === 'worksheet' ? 'Đã nộp phiếu. Thầy cô sẽ xem và nhận xét.' : 'Đã đánh dấu hoàn thành.')
    const again = await supabase.rpc('self_study_open', { p_item: item.id })
    if (!again.error) setO(again.data as Opened)
  }
  function retry() { if (!o) return; setAns(emptyAnswers(o.kind as ActKind, o.content)); setGrade(null); setInfo('') }

  const kind = o?.kind
  const graded = !!kind && kind in ACT && ACT[kind as ActKind].graded
  const prog = o && kind !== 'link' && kind !== 'lesson' ? answered(kind as ActKind, ans, o.content) : null
  const p = o?.progress
  const locked = !o?.can_submit

  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={onBack}>← Danh sách</button><b>{item.title}</b><span className="kind">{ssKindLabel(item)}</span></span>
        {p?.best_score != null && <span className="pill active">Điểm cao nhất {Number(p.best_score).toFixed(1)}</span>}
      </div>
      <p className="sub">{MODE[item.mode]}{item.teachers ? ` · ${item.teachers.full_name}` : ''} · {dueLabel(item.due_at).text}
        {o?.attempts_left != null ? ` · còn ${o.attempts_left} lượt` : ''}{p?.completed_at ? ` · hoàn thành lúc ${fmtDateTime(p.completed_at)}` : ''}</p>
      {item.note && <div className="panel warnbox">💬 {item.note}</div>}
      {p?.teacher_comment && <div className="panel"><b>Nhận xét của thầy cô:</b> {p.teacher_comment}</div>}
      {err && <p className="msg panel">{err}</p>}
      {!o && !err && <p className="sub">Đang mở bài…</p>}
      {o && (
        <>
          {kind === 'link' ? (
            <div className="panel">
              <p>Mở tài liệu thầy cô gửi, xem xong thì bấm <b>Đã xem xong</b>.</p>
              <a className="primary btnlink" href={o.content.url} target="_blank" rel="noopener noreferrer">Mở tài liệu ↗</a>
            </div>
          ) : (
            <div className="panel">
              <ActivityPlayer kind={kind as ActKind | 'lesson'} data={o.content} answers={ans} onChange={v => { setAns(v); setGrade(null); setInfo('') }}
                grade={grade} solution={solution} disabled={locked || (!!grade && graded)} />
            </div>
          )}
          <div className="bar">
            <small>{prog && graded ? `Đã trả lời ${prog.done}/${prog.total}` : ''}</small>
            <span className="tools">
              {info && <b className="actscore">{info}</b>}
              {graded && grade && !locked && <button onClick={retry}>Làm lại</button>}
              {!locked && !(graded && grade) && (
                <button className="primary" disabled={busy} onClick={() => {
                  if (graded && prog && prog.done < prog.total && !window.confirm(`Em mới trả lời ${prog.done}/${prog.total}. Vẫn nộp bài?`)) return
                  submit()
                }}>{graded ? 'Nộp bài' : kind === 'worksheet' ? (p?.status === 'done' ? 'Nộp lại phiếu' : 'Nộp phiếu') : 'Đã xem xong'}</button>
              )}
              {locked && <small>{item.status === 'closed' ? 'Thầy cô đã khoá bài này.' : 'Em đã dùng hết lượt làm.'}</small>}
            </span>
          </div>
          {solution && graded && <p className="sub">Đáp án đúng đã được tô xanh / ghi bên cạnh từng câu.</p>}
        </>
      )}
    </>
  )
}
