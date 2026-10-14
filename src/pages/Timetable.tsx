import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'

type Period = { id: string; name: string; starts_at: string; ends_at: string; session: string }
type Entry = { id: string; weekday: number; period_id: string; subject: string; kind: string; class_id: string; classes: { name: string } | null; teachers: { full_name: string } | null; stem_rooms: { name: string } | null }
type Opt = { id: string; name: string }
const DAYS = [2, 3, 4, 5, 6, 7]
const hm = (t: string) => t.slice(0, 5)

export default function Timetable({ orgId }: { orgId: string }) {
  const [periods, setPeriods] = useState<Period[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [classes, setClasses] = useState<Opt[]>([])
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([])
  const [rooms, setRooms] = useState<Opt[]>([])
  const [cls, setCls] = useState('')
  const [kind, setKind] = useState<'all' | 'stem' | 'regular'>('all')
  const [adding, setAdding] = useState(false)

  async function load() {
    const [p, e, c, t, r] = await Promise.all([
      supabase.from('period_configs').select('*').order('starts_at'),
      supabase.from('timetable_entries').select('id, weekday, period_id, subject, kind, class_id, classes(name), teachers(full_name), stem_rooms(name)'),
      supabase.from('classes').select('id, name').order('name'),
      supabase.from('teachers').select('id, full_name').order('full_name'),
      supabase.from('stem_rooms').select('id, name').order('name'),
    ])
    setPeriods((p.data as Period[]) ?? []); setEntries((e.data as unknown as Entry[]) ?? [])
    const cs = (c.data as Opt[]) ?? []; setClasses(cs); setCls(v => v || cs[0]?.id || '')
    setTeachers((t.data as any) ?? []); setRooms((r.data as Opt[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function add(v: Record<string, string>) {
    const { data: y } = await supabase.from('academic_years').select('id').eq('is_current', true).limit(1)
    const { error } = await supabase.from('timetable_entries').insert({
      org_id: orgId, year_id: y?.[0]?.id ?? null, class_id: v.class_id, weekday: Number(v.weekday), period_id: v.period_id,
      subject: v.subject, teacher_id: v.teacher_id || null, kind: v.kind, room_id: v.room_id || null,
    })
    if (error) {
      if (error.message.includes('class_id_weekday')) return 'Lớp này đã có tiết ở khung giờ đã chọn.'
      if (error.message.includes('teacher_id_weekday')) return 'Giáo viên này đã có tiết khác ở khung giờ đã chọn.'
      return error.message
    }
    setAdding(false); load()
  }
  async function remove(e: Entry) {
    if (!confirm(`Xoá tiết ${e.subject} của ${e.classes?.name}?`)) return
    await supabase.from('timetable_entries').delete().eq('id', e.id); load()
  }
  function exportCsv() {
    const lines = ['Lớp,Thứ,Tiết,Môn,Giáo viên,Loại,Phòng']
    entries.forEach(e => lines.push([e.classes?.name, e.weekday, periods.find(p => p.id === e.period_id)?.name, e.subject, e.teachers?.full_name ?? '', e.kind === 'stem' ? 'STEM' : 'Thường', e.stem_rooms?.name ?? ''].map(x => `"${x ?? ''}"`).join(',')))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = 'thoi-khoa-bieu.csv'; a.click()
  }

  const cell = (p: Period, d: number) => entries.filter(e => e.class_id === cls && e.period_id === p.id && e.weekday === d && (kind === 'all' || e.kind === kind))
  const total = entries.filter(e => e.class_id === cls).length

  return (
    <>
      <div className="bar">
        <div className="segmented">
          {([['all', 'Tất cả'], ['stem', 'Tiết STEM'], ['regular', 'Tiết thường']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <div className="tools">
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Chọn lớp">{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button onClick={exportCsv}>Xuất CSV</button>
          <button className="primary" onClick={() => setAdding(true)}>Thêm tiết</button>
        </div>
      </div>
      <p className="sub">{total} tiết/tuần</p>
      {adding && (
        <FormPanel
          fields={[
            { key: 'class_id', label: 'Lớp', type: 'select', required: true, options: classes.map(c => ({ value: c.id, label: c.name })) },
            { key: 'weekday', label: 'Thứ', type: 'select', required: true, options: DAYS.map(d => ({ value: String(d), label: `Thứ ${d}` })) },
            { key: 'period_id', label: 'Tiết', type: 'select', required: true, options: periods.map(p => ({ value: p.id, label: `${p.name} (${hm(p.starts_at)})` })) },
            { key: 'subject', label: 'Môn', required: true },
            { key: 'teacher_id', label: 'Giáo viên', type: 'select', options: teachers.map(t => ({ value: t.id, label: t.full_name })) },
            { key: 'kind', label: 'Loại tiết', type: 'select', required: true, options: [{ value: 'regular', label: 'Tiết thường' }, { value: 'stem', label: 'Tiết STEM' }] },
            { key: 'room_id', label: 'Phòng STEM', type: 'select', options: rooms.map(r => ({ value: r.id, label: r.name })) },
          ]}
          initial={{ class_id: cls }} onSubmit={add} onCancel={() => setAdding(false)} />
      )}
      <div className="wrap">
        <table className="tkb">
          <thead><tr><th>Tiết</th>{DAYS.map(d => <th key={d}>Thứ {d}</th>)}</tr></thead>
          <tbody>
            {periods.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && p.session !== periods[i - 1].session && <tr><td colSpan={7} className="break">Nghỉ buổi sáng — buổi chiều</td></tr>}
                <tr>
                  <td><b>{p.name}</b><br /><small>{hm(p.starts_at)}–{hm(p.ends_at)}</small></td>
                  {DAYS.map(d => (
                    <td key={d}>{cell(p, d).map(e => (
                      <div key={e.id} className={'slot' + (e.kind === 'stem' ? ' stem' : '')}>
                        <button className="x" onClick={() => remove(e)} aria-label={`Xoá tiết ${e.subject}`}>×</button>
                        <b>{e.subject}</b>{e.kind === 'stem' && <span className="badge">STEM</span>}<br />
                        <small>{e.teachers?.full_name}{e.stem_rooms ? ` · ${e.stem_rooms.name}` : ''}</small>
                      </div>
                    ))}</td>
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
