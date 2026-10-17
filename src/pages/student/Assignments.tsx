import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { KIND_LABEL, dueLabel, fmtDateTime, handoff, Tabs } from '../teacher/common'
import { SProps, NoStudent, useMe, type Me } from './common'
import { RubricView, type Rubric } from '../teacher/rubric'

export type Assign = {
  id: string; title: string; kind: string; subject: string | null; instructions: string | null; max_score: number; group_mode: boolean
  opens_at: string; due_at: string | null; status: string; topic_id: string | null; teachers: { full_name: string } | null; rubric?: Rubric | null
}
export type Sub = { id: string; assignment_id: string; student_id: string | null; group_id: string | null; content: string | null; attachment_url: string | null
  submitted_at: string; status: string; score: number | null; feedback: string | null; rubric_scores?: (number | null)[] | null }

// Bài tập của lớp + bài nộp của học sinh (cá nhân hoặc nhóm)
export function useMyWork(me: Me | null) {
  const [assigns, setAssigns] = useState<Assign[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  async function reload() {
    if (!me?.class_id) return
    const gids = me.groups.map(g => g.id)
    const [a, s] = await Promise.all([
      supabase.from('assignments').select('id, title, kind, subject, instructions, max_score, group_mode, opens_at, due_at, status, topic_id, rubric, teachers(full_name)')
        .eq('class_id', me.class_id).neq('status', 'draft').order('due_at', { ascending: true, nullsFirst: false }),
      supabase.from('submissions').select('id, assignment_id, student_id, group_id, content, attachment_url, submitted_at, status, score, feedback, rubric_scores')
        .or([`student_id.eq.${me.id}`, ...(gids.length ? [`group_id.in.(${gids.join(',')})`] : [])].join(',')),
    ])
    setAssigns((a.data as unknown as Assign[]) ?? []); setSubs((s.data as Sub[]) ?? [])
  }
  useEffect(() => { reload() }, [me?.id, me?.groups.length])
  const subOf = (a: Assign) => subs.find(s => s.assignment_id === a.id && (a.group_mode ? me?.groups.some(g => g.id === s.group_id) : s.student_id === me?.id))
  return { assigns, subs, subOf, reload }
}

const DAY = 86400000
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
type Bucket = 'now' | 'tomorrow' | 'week' | 'later'
const BUCKET: Record<Bucket, string> = { now: 'Cần làm ngay', tomorrow: 'Ngày mai', week: 'Tuần này', later: 'Sắp tới' }
function bucketOf(due: string | null): Bucket {
  if (!due) return 'later'
  const d = startOfDay(new Date(due)), today = startOfDay(new Date())
  if (d <= today) return 'now'
  if (d === today + DAY) return 'tomorrow'
  if (d <= today + 7 * DAY) return 'week'
  return 'later'
}
type T = 'todo' | 'done' | 'late'

export function StudentAssignments({ studentId, orgId }: SProps) {
  const me = useMe(studentId)
  const { assigns, subOf, reload } = useMyWork(me)
  const [tab, setTab] = useState<T>('todo')
  const [subject, setSubject] = useState('')
  const [open, setOpen] = useState<string | null>(() => handoff.take('student.assignment'))
  const [form, setForm] = useState({ content: '', url: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const cur = assigns.find(a => a.id === open)
  const curSub = cur ? subOf(cur) : undefined
  useEffect(() => { setForm({ content: curSub?.content ?? '', url: curSub?.attachment_url ?? '' }); setErr('') }, [open, curSub?.id])

  if (!studentId) return <NoStudent />
  const now = Date.now()
  const isLate = (a: Assign) => !subOf(a) && a.status === 'open' && !!a.due_at && new Date(a.due_at).getTime() < now
  const base = assigns.filter(a => !subject || a.subject === subject)
  const lists: Record<T, Assign[]> = {
    todo: base.filter(a => !subOf(a) && a.status === 'open'),
    done: base.filter(a => !!subOf(a)),
    late: base.filter(isLate),
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!cur || !me) return
    if (!form.content.trim() && !form.url.trim()) return setErr('Hãy nhập bài làm hoặc dán đường dẫn tệp.')
    if (form.url && !/^https?:\/\//i.test(form.url.trim())) return setErr('Đường dẫn tệp phải bắt đầu bằng http:// hoặc https://')
    const body = { content: form.content.trim() || null, attachment_url: form.url.trim() || null }
    const group = cur.group_mode ? me.groups[0] : null
    if (cur.group_mode && !group) return setErr('Bạn chưa thuộc nhóm nào. Hãy báo thầy cô chia nhóm.')
    const { error } = curSub
      ? await supabase.from('submissions').update(body).eq('id', curSub.id)
      : await supabase.from('submissions').insert({ ...body, org_id: orgId, assignment_id: cur.id, ...(group ? { group_id: group.id } : { student_id: me.id }) })
    if (error) return setErr('Chưa nộp được: ' + error.message)
    setMsg(curSub ? 'Đã cập nhật bài nộp.' : 'Đã nộp bài. Thầy cô sẽ chấm và em sẽ nhận thông báo.'); setOpen(null); reload()
  }

  const subjects = [...new Set(assigns.map(a => a.subject).filter(Boolean))] as string[]
  const shown = lists[tab]
  const grouped = tab === 'todo'
    ? (Object.keys(BUCKET) as Bucket[]).map(b => [b, shown.filter(a => bucketOf(a.due_at) === b)] as const).filter(([, l]) => l.length)
    : [['all', shown] as const]

  return (
    <>
      <div className="bar">
        <Tabs<T> value={tab} onChange={setTab} items={[['todo', 'Cần làm', lists.todo.length], ['done', 'Đã nộp', lists.done.length], ['late', 'Quá hạn', lists.late.length]]} />
        <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Lọc môn"><option value="">Tất cả môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}

      {cur && (
        <form className="panel workbox" onSubmit={submit}>
          <div className="bar"><span><span className={'kind ' + cur.kind}>{KIND_LABEL[cur.kind]}</span> <b>{cur.title}</b></span>
            <button type="button" onClick={() => setOpen(null)}>Đóng</button></div>
          <small>{cur.subject}{cur.teachers ? ` · ${cur.teachers.full_name}` : ''} · {dueLabel(cur.due_at).text}{cur.group_mode && me?.groups[0] ? ` · Nộp chung ${me.groups[0].name}` : ''}</small>
          {cur.instructions && <div className="answer">{cur.instructions}</div>}
          {cur.rubric && <RubricView rubric={cur.rubric} levels={curSub?.status === 'graded' ? curSub.rubric_scores : null} />}
          {curSub?.status === 'graded' ? (
            <div className="graded">
              <div className="scorebig">{curSub.score}<small>/{cur.max_score}</small></div>
              <div><b>Nhận xét của thầy cô</b><p>{curSub.feedback || 'Không có nhận xét.'}</p>
                <small>Bài em đã nộp lúc {fmtDateTime(curSub.submitted_at)}</small>
                {curSub.content && <div className="answer">{curSub.content}</div>}</div>
            </div>
          ) : (
            <div className="formgrid">
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>Bài làm</span>
                <textarea rows={6} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="Viết câu trả lời, kết quả đo, nhận xét của nhóm…" /></label>
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>Đường dẫn tệp / ảnh sản phẩm (Google Drive, OneDrive…)</span>
                <input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></label>
              <div className="formactions"><button className="primary" type="submit">{curSub ? 'Nộp lại' : 'Nộp bài'}</button>
                {curSub && <small> Đã nộp lúc {fmtDateTime(curSub.submitted_at)} — có thể sửa đến khi thầy cô chấm.</small>}</div>
              {err && <p className="msg">{err}</p>}
            </div>
          )}
        </form>
      )}

      {grouped.map(([b, list]) => (
        <section key={b} className="worksec">
          {tab === 'todo' && <h3 className={b === 'now' ? 'hot' : ''}>{BUCKET[b as Bucket]} <span className="count">{list.length}</span></h3>}
          {list.map(a => {
            const s = subOf(a); const due = dueLabel(a.due_at)
            return (
              <div className="workrow" key={a.id}>
                <div><b>{a.title}</b><br />
                  <small><span className={'kind ' + a.kind}>{KIND_LABEL[a.kind]}</span> {a.subject}{a.group_mode ? ' · Bài nhóm' : ''} · </small>
                  <small className={'due ' + (s ? '' : due.tone)}>{due.text}</small></div>
                {s?.status === 'graded' ? <span className="pill active">{s.score}/{a.max_score}</span>
                  : s ? <span className="pill maintenance">Đã nộp</span> : null}
                <button className={!s ? 'primary' : ''} onClick={() => { setMsg(''); setOpen(a.id) }}>{s?.status === 'graded' ? 'Xem điểm' : s ? 'Xem / sửa' : 'Làm bài →'}</button>
              </div>
            )
          })}
        </section>
      ))}
      {shown.length === 0 && <p className="sub">{tab === 'todo' ? 'Em đã làm hết bài tập. Giỏi lắm! 🎉' : 'Không có bài nào.'}</p>}
    </>
  )
}
