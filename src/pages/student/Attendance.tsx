// Học sinh → Chuyên cần: điểm danh theo tiết của chính mình (migration 027) và ngày nghỉ của trường (030).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { MARK, today, addDays, dayLabel, attendRate, type Mark } from '../../lib/attendance'
import { Tiles } from '../department/charts'
import { Tabs } from '../teacher/common'
import { SProps, NoStudent, useMe } from './common'

type Row = { session_id: string; status: Mark; note: string | null; teaching_sessions: { session_date: string; subject: string; kind: string; status: string;
  period_configs: { name: string; starts_at: string } | null; teachers: { full_name: string } | null } | null }
type Holiday = { id: string; name: string; starts_on: string; ends_on: string; note: string | null; org_id: string }
type R = 'term' | '30' | '7'
const PILL: Record<Mark, string> = { present: 'active', late: 'maintenance', absent: 'inactive', excused: '' }

export function StudentAttendance({ studentId, year, orgId }: SProps) {
  const me = useMe(studentId)
  const [range, setRange] = useState<R>(year?.starts_on ? 'term' : '30')
  const [rows, setRows] = useState<Row[]>([])
  const [hol, setHol] = useState<Holiday[]>([])
  const [only, setOnly] = useState<'issues' | 'all'>('issues')
  const [err, setErr] = useState('')
  const from = range === 'term' && year?.starts_on ? year.starts_on : addDays(today(), range === '7' ? -6 : -29)
  const to = range === 'term' && year?.ends_on && year.ends_on < today() ? year.ends_on : today()

  useEffect(() => {
    if (!me?.id) return
    supabase.from('lesson_attendance')
      .select('session_id, status, note, teaching_sessions!inner(session_date, subject, kind, status, period_configs(name, starts_at), teachers(full_name))')
      .eq('student_id', me.id).gte('teaching_sessions.session_date', from).lte('teaching_sessions.session_date', to)
      .then(({ data, error }) => { if (error) setErr(error.message); setRows((data as unknown as Row[]) ?? []) })
    supabase.from('school_holidays').select('id, name, starts_on, ends_on, note, org_id').gte('ends_on', today()).order('starts_on').limit(10)
      .then(({ data }) => setHol((data as Holiday[]) ?? []))
  }, [me?.id, from, to])

  if (!studentId) return <NoStudent />
  const c = { present: 0, late: 0, absent: 0, excused: 0 }
  rows.forEach(r => { c[r.status]++ })
  const rate = attendRate(c)
  const sorted = [...rows].sort((a, b) => (b.teaching_sessions?.session_date ?? '').localeCompare(a.teaching_sessions?.session_date ?? '')
    || (b.teaching_sessions?.period_configs?.starts_at ?? '').localeCompare(a.teaching_sessions?.period_configs?.starts_at ?? ''))
  const shown = only === 'issues' ? sorted.filter(r => r.status !== 'present') : sorted

  return (
    <>
      <div className="bar">
        <Tabs<R> value={range} onChange={setRange} items={[...(year?.starts_on ? [['term', 'Học kỳ này'] as [R, string]] : []), ['30', '30 ngày'], ['7', '7 ngày']]} />
      </div>
      <Tiles items={[
        { label: 'Chuyên cần', value: rate == null ? '—' : rate + '%', sub: `${rows.length} tiết đã điểm danh`, tone: rate != null && rate < 90 ? 'warn' : '' },
        { label: 'Có mặt', value: c.present },
        { label: 'Đi muộn', value: c.late },
        { label: 'Vắng', value: c.absent, tone: c.absent ? 'warn' : '' },
        { label: 'Có phép', value: c.excused },
      ]} />
      {hol.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Ngày nghỉ sắp tới</h3>
          {hol.map(h => (
            <p key={h.id} style={{ margin: '4px 0' }}><b>{h.name}</b> · {dayLabel(h.starts_on)}{h.ends_on !== h.starts_on ? ` – ${dayLabel(h.ends_on)}` : ''}
              {h.org_id !== orgId && <small> · theo lịch của Sở</small>}{h.note ? <small> · {h.note}</small> : null}</p>
          ))}
        </div>
      )}
      <div className="bar"><Tabs value={only} onChange={setOnly} items={[['issues', 'Vắng, muộn, có phép', rows.length - c.present], ['all', 'Mọi tiết', rows.length]]} /></div>
      {err && <p className="msg">{err}</p>}
      <div className="wrap"><table>
        <thead><tr><th>Ngày</th><th>Tiết</th><th>Môn</th><th>Thầy cô</th><th>Điểm danh</th><th>Ghi chú</th></tr></thead>
        <tbody>
          {shown.map(r => (
            <tr key={r.session_id}>
              <td>{r.teaching_sessions ? dayLabel(r.teaching_sessions.session_date) : ''}</td>
              <td>{r.teaching_sessions?.period_configs?.name}</td>
              <td>{r.teaching_sessions?.subject}{r.teaching_sessions?.kind === 'stem' && <span className="kind">STEM</span>}</td>
              <td>{r.teaching_sessions?.teachers?.full_name}</td>
              <td><span className={'pill ' + PILL[r.status]}>{MARK[r.status]}</span></td>
              <td><small>{r.note}</small></td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={6}>{only === 'issues' ? 'Em không vắng, không muộn tiết nào. Giữ vững nhé! 👏' : 'Chưa có tiết nào được điểm danh.'}</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}
