import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { SProps, NoStudent, useMe, useTopics } from './common'

type Period = { id: string; name: string; starts_at: string; ends_at: string; session: string }
type Entry = { id: string; year_id: string | null; weekday: number; period_id: string; subject: string; kind: string; teachers: { full_name: string } | null; stem_rooms: { name: string } | null }
const DAYS = [2, 3, 4, 5, 6, 7]
const p2 = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const monday = (d: Date) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x }

// Thời khóa biểu tuần của lớp + các buổi chủ đề STEM có lịch trong tuần
export function StudentSchedule({ studentId, year }: SProps) {
  const me = useMe(studentId)
  const t = useTopics(me)
  const [periods, setPeriods] = useState<Period[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [week, setWeek] = useState(() => monday(new Date()))
  const [kind, setKind] = useState<'all' | 'stem' | 'regular'>('all')

  useEffect(() => {
    if (!me?.class_id) return
    Promise.all([
      supabase.from('period_configs').select('*').order('starts_at'),
      supabase.from('timetable_entries').select('id, year_id, weekday, period_id, subject, kind, teachers(full_name), stem_rooms(name)').eq('class_id', me.class_id),
    ]).then(([p, e]) => {
      setPeriods((p.data as Period[]) ?? [])
      setEntries(((e.data as unknown as Entry[]) ?? []).filter(x => !year || !x.year_id || x.year_id === year.id))
    })
  }, [me?.class_id, year?.id])

  if (!studentId) return <NoStudent />
  const dates = DAYS.map((_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return d })
  const todayIso = iso(new Date())
  const cell = (p: Period, wd: number) => entries.filter(e => e.period_id === p.id && e.weekday === wd && (kind === 'all' || e.kind === kind))
  const stemOn = (d: Date) => t.lessons.filter(l => l.scheduled_on === iso(d))
  const shift = (n: number) => { const d = new Date(week); d.setDate(d.getDate() + 7 * n); setWeek(d) }
  const nStem = entries.filter(e => e.kind === 'stem').length

  return (
    <>
      <div className="bar">
        <Tabs value={kind} onChange={setKind} items={[['all', 'Tất cả', entries.length], ['stem', 'Tiết STEM', nStem], ['regular', 'Tiết thường', entries.length - nStem]]} />
        <span className="tools">
          <button onClick={() => setWeek(monday(new Date()))}>Hôm nay</button>
          <button onClick={() => shift(-1)} aria-label="Tuần trước">‹</button>
          <b>Tháng {week.getMonth() + 1}, {week.getFullYear()} · {p2(dates[0].getDate())}/{p2(dates[0].getMonth() + 1)} – {p2(dates[5].getDate())}/{p2(dates[5].getMonth() + 1)}</b>
          <button onClick={() => shift(1)} aria-label="Tuần sau">›</button>
        </span>
      </div>
      <div className="wrap">
        <table className="tkb weektkb">
          <thead><tr><th>Tiết</th>{dates.map((d, i) => (
            <th key={i} className={iso(d) === todayIso ? 'today' : ''}>T{DAYS[i]}<br /><span className="daynum">{d.getDate()}</span></th>
          ))}</tr></thead>
          <tbody>
            {dates.some(d => stemOn(d).length) && (
              <tr><td><b>Chủ đề STEM</b></td>{dates.map((d, i) => (
                <td key={i}>{stemOn(d).map(l => (
                  <div key={l.id} className="slot stem"><b>{t.topics.find(x => x.id === l.topic_id)?.title}</b><br /><small>Buổi {l.seq}: {l.title}{l.stem_rooms ? ` · ${l.stem_rooms.name}` : ''}</small></div>
                ))}</td>
              ))}</tr>
            )}
            {periods.map((p, idx) => (
              <Fragment key={p.id}>
                {idx > 0 && periods[idx - 1].session !== p.session && <tr><td colSpan={7} className="break">Buổi chiều</td></tr>}
                <tr>
                  <td><b>{p.name}</b><br /><small>{p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}</small></td>
                  {DAYS.map((wd, i) => (
                    <td key={wd} className={iso(dates[i]) === todayIso ? 'today' : ''}>{cell(p, wd).map(e => (
                      <div key={e.id} className={'slot' + (e.kind === 'stem' ? ' stem' : '')}><b>{e.subject}</b>{e.kind === 'stem' && <span className="badge">STEM</span>}<br />
                        <small>{[e.stem_rooms?.name, e.teachers?.full_name].filter(Boolean).join(' · ')}</small></div>
                    ))}</td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 && <p className="sub">Lớp chưa có thời khóa biểu cho học kỳ đang chọn.</p>}
    </>
  )
}
