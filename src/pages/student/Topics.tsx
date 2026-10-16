import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { KIND_LABEL, PROGRAM_COLOR, dueLabel, handoff, Tabs } from '../teacher/common'
import { SProps, NoStudent, useMe, useTopics, tint, vnDate, type Topic } from './common'
import { useMyWork } from './Assignments'
import { useBackClose } from '../../lib/history'

type Material = { id: string; title: string; kind: string; url: string | null; lesson_id: string | null }
type Post = { id: string; body: string; author_name: string | null; author_role: string | null; created_at: string; author_id: string }
const MAT: Record<string, string> = { doc: 'Tài liệu', slide: 'Slide', video: 'Video', link: 'Liên kết', worksheet: 'Phiếu học tập' }
type F = 'all' | 'planned' | 'active' | 'done'
const ST: Record<Topic['status'], string> = { planned: 'Chưa học', active: 'Đang học', done: 'Hoàn thành' }

export function StudentTopics({ studentId, orgId, go }: SProps) {
  const me = useMe(studentId)
  const t = useTopics(me)
  const [f, setF] = useState<F>('all')
  const [open, setOpen] = useState<string | null>(() => handoff.take('student.topic'))
  useBackClose(!!open, () => setOpen(null))
  if (!studentId) return <NoStudent />
  if (open) {
    const topic = t.topics.find(x => x.id === open)
    return topic ? <TopicDetail topic={topic} t={t} me={me} orgId={orgId} go={go} onBack={() => setOpen(null)} /> : <p className="sub">Đang tải…</p>
  }
  const shown = f === 'all' ? t.topics : t.topics.filter(x => x.status === f)
  return (
    <>
      <p className="sub">Các chủ đề STEM thầy cô đã giao cho lớp {me?.class_name}.</p>
      <Tabs<F> value={f} onChange={setF} items={[['all', 'Tất cả', t.topics.length], ['planned', 'Chưa học', t.topics.filter(x => x.status === 'planned').length],
        ['active', 'Đang học', t.topics.filter(x => x.status === 'active').length], ['done', 'Hoàn thành', t.topics.filter(x => x.status === 'done').length]]} />
      <div className="topicgrid">{shown.map(x => <TopicCard key={x.id} topic={x} pct={t.progress(x.id)} onOpen={() => setOpen(x.id)} />)}</div>
      {shown.length === 0 && <p className="sub">Chưa có chủ đề nào.</p>}
    </>
  )
}

export function TopicCard({ topic, pct, onOpen }: { topic: Topic; pct: number; onOpen: () => void }) {
  return (
    <button className="topiccard" onClick={onOpen}>
      <div className="topiccover" style={{ background: tint(topic.subject) }}>
        <span className={'pill ' + (topic.status === 'active' ? 'active' : topic.status === 'planned' ? 'maintenance' : '')}>{ST[topic.status]}</span>
        {topic.program && <span className="progchip" style={{ background: PROGRAM_COLOR[topic.program], color: '#fff' }}>{topic.program}</span>}
      </div>
      <small className="subj">{topic.subject}</small>
      <b>{topic.title}</b>
      <div className="track" aria-label={`Tiến độ ${pct}%`}><div className="fill g" style={{ width: pct + '%' }} /></div>
      <small>{pct}% · {topic.teachers?.full_name ?? ''}{topic.starts_on ? ` · từ ${vnDate(topic.starts_on)}` : ''}</small>
    </button>
  )
}

type DT = 'lessons' | 'tasks' | 'docs' | 'talk'
function TopicDetail({ topic, t, me, orgId, go, onBack }: {
  topic: Topic; t: ReturnType<typeof useTopics>; me: ReturnType<typeof useMe>; orgId: string | null; go?: (p: string) => void; onBack: () => void
}) {
  const [tab, setTab] = useState<DT>('lessons')
  const [mats, setMats] = useState<Material[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const work = useMyWork(me)
  const lessons = t.lessons.filter(l => l.topic_id === topic.id)
  const next = t.nextLesson(topic.id)
  const tasks = work.assigns.filter(a => a.topic_id === topic.id)

  async function loadPosts() {
    const { data } = await supabase.from('topic_posts').select('id, body, author_name, author_role, created_at, author_id').eq('topic_id', topic.id).order('created_at')
    setPosts((data as Post[]) ?? [])
  }
  useEffect(() => {
    supabase.from('topic_materials').select('id, title, kind, url, lesson_id').eq('topic_id', topic.id).order('created_at').then(({ data }) => setMats((data as Material[]) ?? []))
    loadPosts()
  }, [topic.id])

  async function mark(lessonId: string, done: boolean) {
    if (!me) return
    const { error } = done
      ? await supabase.from('lesson_progress').upsert({ org_id: orgId, lesson_id: lessonId, student_id: me.id, status: 'done', updated_at: new Date().toISOString() })
      : await supabase.from('lesson_progress').delete().eq('lesson_id', lessonId).eq('student_id', me.id)
    if (error) setErr(error.message); else { setErr(''); t.reload() }
  }
  async function post(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('topic_posts').insert({ org_id: orgId, topic_id: topic.id, author_id: u.user?.id, body: text.trim() })
    if (error) return setErr('Chưa gửi được: ' + error.message)
    setText(''); setErr(''); loadPosts()
  }

  return (
    <>
      <button onClick={onBack}>← Tất cả chủ đề</button>
      <div className="topichero" style={{ background: tint(topic.subject) }}>
        <div>
          <span className={'pill ' + (topic.status === 'active' ? 'active' : '')}>{ST[topic.status]}</span>
          <h2>{topic.title}</h2>
          <small>{topic.teachers?.full_name} hướng dẫn · {lessons.length} buổi · đã học {lessons.filter(l => t.done.has(l.id)).length}/{lessons.length}</small>
          {topic.summary && <p>{topic.summary}</p>}
        </div>
        <div className="ringbox"><div className="ring" style={{ ['--p' as any]: t.progress(topic.id) + '%' }}><span>{t.progress(topic.id)}%</span></div></div>
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="twocol">
        <div>
          <Tabs<DT> value={tab} onChange={setTab} items={[['lessons', 'Bài học', lessons.length], ['tasks', 'Nhiệm vụ', tasks.length], ['docs', 'Tài liệu', mats.length], ['talk', 'Thảo luận', posts.length]]} />
          {tab === 'lessons' && lessons.map(l => {
            const isDone = t.done.has(l.id); const isNext = next?.id === l.id
            return (
              <div className={'lessonrow' + (isNext ? ' next' : '')} key={l.id}>
                <span className={'seq' + (isDone ? ' done' : '')}>{isDone ? '✓' : l.seq}</span>
                <div><b>{l.title}</b>{isNext && <span className="badge">Đang học</span>}<br />
                  <small>{l.minutes} phút{l.scheduled_on ? ` · ${vnDate(l.scheduled_on)}` : ''}{l.stem_rooms ? ` · ${l.stem_rooms.name}` : ''}</small></div>
                <button className={isNext ? 'primary' : ''} onClick={() => mark(l.id, !isDone)}>{isDone ? 'Bỏ đánh dấu' : 'Đã học xong'}</button>
              </div>
            )
          })}
          {tab === 'tasks' && (tasks.length ? tasks.map(a => {
            const s = work.subOf(a)
            return (
              <div className="workrow" key={a.id}>
                <div><b>{a.title}</b><br /><small><span className={'kind ' + a.kind}>{KIND_LABEL[a.kind]}</span> {dueLabel(a.due_at).text}</small></div>
                {s?.status === 'graded' ? <span className="pill active">{s.score}/{a.max_score}</span> : s ? <span className="pill maintenance">Đã nộp</span> : null}
                <button className={!s ? 'primary' : ''} onClick={() => { handoff.set('student.assignment', a.id); go?.('Bài tập') }}>{s ? 'Xem' : 'Làm bài →'}</button>
              </div>
            )
          }) : <p className="sub">Chủ đề chưa có nhiệm vụ.</p>)}
          {tab === 'docs' && (mats.length ? mats.map(m => (
            <div className="workrow" key={m.id}><div><b>{m.title}</b><br /><small>{MAT[m.kind] ?? m.kind}</small></div>
              {m.url ? <a className="filebtn" href={m.url} target="_blank" rel="noreferrer">Mở ↗</a> : <small>Thầy cô chưa đính kèm tệp</small>}</div>
          )) : <p className="sub">Chưa có tài liệu.</p>)}
          {tab === 'talk' && (
            <div className="talk">
              {posts.map(p => (
                <div key={p.id} className={'post' + (p.author_role === 'teacher' ? ' teacher' : '')}>
                  <b>{p.author_name}</b>{p.author_role === 'teacher' && <span className="badge">Thầy cô</span>}
                  <small> · {new Date(p.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
                  <p>{p.body}</p>
                </div>
              ))}
              {posts.length === 0 && <p className="sub">Chưa có thảo luận. Em hãy đặt câu hỏi đầu tiên!</p>}
              <form className="addrow" onSubmit={post}>
                <input value={text} onChange={e => setText(e.target.value)} maxLength={4000} placeholder="Đặt câu hỏi hoặc chia sẻ với cả lớp…" aria-label="Viết thảo luận" />
                <button className="primary" type="submit" disabled={!text.trim()}>Gửi</button>
              </form>
            </div>
          )}
        </div>
        <div className="panel">
          <h3>{next ? `Mang theo buổi ${next.seq}` : 'Chủ đề đã hoàn thành'}</h3>
          {next ? (
            <>
              <small>{next.title}{next.scheduled_on ? ` · ${vnDate(next.scheduled_on)}` : ''}</small>
              {next.bring_items
                ? <ul className="checklist">{next.bring_items.split('\n').filter(Boolean).map(i => <li key={i}>{i}</li>)}</ul>
                : <p className="sub">Thầy cô chưa dặn mang gì thêm. Nhớ mang vở ghi và bút.</p>}
            </>
          ) : <p className="sub">Em đã học hết các buổi của chủ đề này. 🎉</p>}
        </div>
      </div>
    </>
  )
}
