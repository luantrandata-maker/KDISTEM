import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { KIND_LABEL, dueLabel, handoff } from '../teacher/common'
import { SProps, NoStudent, useMe, useTopics, vnDate } from './common'
import { useMyWork } from './Assignments'
import { TopicCard } from './Topics'
import { useSelfStudy } from './SelfStudy'
import { ssKindLabel } from '../teacher/SelfStudy'

type Slot = { id: string; subject: string; kind: string; period_configs: { name: string; starts_at: string } | null; teachers: { full_name: string } | null; stem_rooms: { name: string } | null }
const todayWd = () => { const d = new Date().getDay(); return d === 0 ? 0 : d + 1 }
const localISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }

export function StudentHome({ studentId, go, year }: SProps) {
  const me = useMe(studentId)
  const t = useTopics(me)
  const work = useMyWork(me)
  const ss = useSelfStudy(me?.class_id, me?.id)
  const [today, setToday] = useState<Slot[]>([])
  const [live, setLive] = useState<{ title: string } | null>(null)

  useEffect(() => {
    if (!me?.class_id) return
    supabase.from('timetable_entries').select('id, subject, kind, year_id, period_configs(name, starts_at), teachers(full_name), stem_rooms(name)')
      .eq('class_id', me.class_id).eq('weekday', todayWd())
      .then(({ data }) => setToday(((data as any[]) ?? []).filter(x => !year || !x.year_id || x.year_id === year.id)
        .sort((a, b) => (a.period_configs?.starts_at ?? '').localeCompare(b.period_configs?.starts_at ?? ''))))
    supabase.from('class_sessions').select('title').eq('class_id', me.class_id).eq('status', 'live').limit(1).then(({ data }) => setLive(data?.[0] ?? null))
  }, [me?.class_id, year?.id])

  if (!studentId) return <NoStudent />
  const active = t.topics.filter(x => x.status === 'active').sort((a, b) => t.progress(b.id) - t.progress(a.id))
  const hero = active.find(x => t.progress(x.id) < 100) ?? active[0]
  const next = hero ? t.nextLesson(hero.id) : undefined
  const todo = work.assigns.filter(a => a.status === 'open' && !work.subOf(a))
  const stemToday = t.lessons.filter(l => l.scheduled_on === localISO())
  const first = (me?.full_name ?? '').split(' ').slice(-2).join(' ')

  return (
    <>
      <div className="kidhero">
        <div><h2>Chào {first} 👋</h2><small>Lớp {me?.class_name.replace(/^Lớp\s*/i, '')} · Học STEM — khám phá điều kỳ diệu</small></div>
      </div>
      {live && (
        <button className="todo hi livebanner" onClick={() => go?.('Giáo dục STEM')}>
          <span><b>Lớp đang có tiết học: {live.title}</b><br /><small>Nhập mã PIN trên màn chiếu để vào lớp</small></span><span className="n">→</span>
        </button>
      )}
      {hero && (
        <div className="panel herotopic">
          <div>
            <small>{next ? `Buổi ${next.seq}${next.scheduled_on ? ` · ${vnDate(next.scheduled_on)}` : ''}${next.stem_rooms ? ` · ${next.stem_rooms.name}` : ''}` : 'Đã học xong'} · {hero.teachers?.full_name}</small>
            <h3>{hero.title} <span className="pill active">Đang học</span></h3>
            {next && <small>Tiếp theo: {next.title}</small>}
            <div className="track"><div className="fill g" style={{ width: t.progress(hero.id) + '%' }} /></div>
            <small>Tiến độ chủ đề {t.progress(hero.id)}%</small>
          </div>
          <div className="tools">
            <button className="primary" onClick={() => { handoff.set('student.topic', hero.id); go?.('Chủ đề') }}>Học tiếp</button>
          </div>
        </div>
      )}
      <div className="twocol">
        <div className="panel">
          <div className="bar"><h3>Hôm nay</h3><button className="linkbtn" onClick={() => go?.('Lịch học')}>Lịch học →</button></div>
          {today.map(s => (
            <div className="roomrow" key={s.id}>
              <span><b>{s.subject}</b>{s.kind === 'stem' && <span className="badge">STEM</span>}<br /><small>{[s.stem_rooms?.name, s.teachers?.full_name].filter(Boolean).join(' · ')}</small></span>
              <small>{s.period_configs?.name} · {s.period_configs?.starts_at.slice(0, 5)}</small>
            </div>
          ))}
          {stemToday.map(l => <div className="roomrow" key={l.id}><span><b>{l.title}</b><span className="badge">Chủ đề STEM</span><br /><small>{l.stem_rooms?.name}</small></span><small>{l.minutes} phút</small></div>)}
          {today.length + stemToday.length === 0 && <small>Hôm nay không có tiết học.</small>}
        </div>
        <div className="panel">
          <div className="bar"><h3>Bài tập cần làm · {todo.length}</h3><button className="linkbtn" onClick={() => go?.('Bài tập')}>Xem tất cả →</button></div>
          {todo.slice(0, 5).map(a => {
            const d = dueLabel(a.due_at)
            return (
              <button key={a.id} className={'todo' + (d.tone === 'bad' ? ' hi' : '')} onClick={() => { handoff.set('student.assignment', a.id); go?.('Bài tập') }}>
                <span><b>{a.title}</b><br /><small>{KIND_LABEL[a.kind]} · {a.subject}</small></span><small className={'due ' + d.tone}>{d.text.split(' · ')[0]}</small>
              </button>
            )
          })}
          {todo.length === 0 && <small>Em đã hoàn thành mọi bài tập. 🎉</small>}
        </div>
        {ss.items.length > 0 && <div className="panel">
          <div className="bar"><h3>Học trước & tự học · {ss.todo.length}</h3><button className="linkbtn" onClick={() => go?.('Học trước & tự học')}>Xem tất cả →</button></div>
          {ss.todo.slice(0, 5).map(i => {
            const d = dueLabel(i.due_at)
            return (
              <button key={i.id} className={'todo' + (d.tone === 'bad' ? ' hi' : '')} onClick={() => { handoff.set('student.selfstudy', i.id); go?.('Học trước & tự học') }}>
                <span><b>{i.title}</b><br /><small>{ssKindLabel(i)}{i.mode === 'before' ? ' · Học trước tiết' : ' · Tự luyện'}</small></span><small className={'due ' + d.tone}>{d.text.split(' · ')[0]}</small>
              </button>
            )
          })}
          {ss.todo.length === 0 && <small>Em đã làm hết bài học trước và tự học. 🎉</small>}
        </div>}
      </div>
      <div className="bar" style={{ marginTop: 6 }}><h3>Chủ đề của em</h3><button className="linkbtn" onClick={() => go?.('Chủ đề')}>Xem tất cả →</button></div>
      <div className="topicgrid">
        {t.topics.filter(x => x.status !== 'done').slice(0, 4).map(x => <TopicCard key={x.id} topic={x} pct={t.progress(x.id)} onOpen={() => { handoff.set('student.topic', x.id); go?.('Chủ đề') }} />)}
      </div>
    </>
  )
}
