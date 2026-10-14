import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Period = { id: string; name: string; starts_at: string; ends_at: string; session: string }
type Entry = { id: string; weekday: number; period_id: string; subject: string; kind: string; class_id: string; classes: { name: string } | null; teachers: { full_name: string } | null; stem_rooms: { name: string } | null }
type Cls = { id: string; name: string }
const DAYS = [2, 3, 4, 5, 6, 7]
const hm = (t: string) => t.slice(0, 5)

export default function Timetable() {
  const [periods, setPeriods] = useState<Period[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState('')
  const [kind, setKind] = useState<'all' | 'stem' | 'regular'>('all')

  useEffect(() => {
    Promise.all([
      supabase.from('period_configs').select('*').order('starts_at'),
      supabase.from('timetable_entries').select('id, weekday, period_id, subject, kind, class_id, classes(name), teachers(full_name), stem_rooms(name)'),
      supabase.from('classes').select('id, name').order('name'),
    ]).then(([p, e, c]) => {
      setPeriods((p.data as Period[]) ?? []); setEntries((e.data as unknown as Entry[]) ?? [])
      const cs = (c.data as Cls[]) ?? []; setClasses(cs); if (cs[0]) setCls(cs[0].id)
    })
  }, [])

  const cell = (p: Period, d: number) =>
    entries.filter(e => e.class_id === cls && e.period_id === p.id && e.weekday === d && (kind === 'all' || e.kind === kind))
  const total = entries.filter(e => e.class_id === cls).length

  return (
    <>
      <div className="bar">
        <div className="segmented" role="tablist">
          {([['all', 'Tất cả'], ['stem', 'Tiết STEM'], ['regular', 'Tiết thường']] as const).map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <div>
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Chọn lớp">
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select> <small>{total} tiết/tuần</small>
        </div>
      </div>
      <div className="wrap">
        <table className="tkb">
          <thead><tr><th>Tiết</th>{DAYS.map(d => <th key={d}>Thứ {d}</th>)}</tr></thead>
          <tbody>
            {periods.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && p.session !== periods[i - 1].session && (
                  <tr><td colSpan={7} className="break">Nghỉ buổi sáng — buổi chiều</td></tr>
                )}
                <tr>
                  <td><b>{p.name}</b><br /><small>{hm(p.starts_at)}–{hm(p.ends_at)}</small></td>
                  {DAYS.map(d => (
                    <td key={d}>
                      {cell(p, d).map(e => (
                        <div key={e.id} className={'slot' + (e.kind === 'stem' ? ' stem' : '')}>
                          <b>{e.subject}</b>{e.kind === 'stem' && <span className="badge">STEM</span>}<br />
                          <small>{e.teachers?.full_name}{e.stem_rooms ? ` · ${e.stem_rooms.name}` : ''}</small>
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
