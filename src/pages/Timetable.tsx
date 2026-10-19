import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import { type Year, sameSchoolYear, yearLabel } from '../lib/year'
import ImportExcel from '../components/ImportExcel'
import { norm, importSummary, downloadXlsx, type Column } from '../lib/sheet'
import { loadRooms } from '../lib/rooms'

const COLS: Column[] = [
  { key: 'cls', label: 'Lớp', required: true },
  { key: 'day', label: 'Thứ', required: true },
  { key: 'period', label: 'Tiết', required: true },
  { key: 'subject', label: 'Môn', aliases: ['Môn học'], required: true },
  { key: 'teacher', label: 'Giáo viên', width: 24 },
  { key: 'kind', label: 'Loại', aliases: ['Loại tiết'] },
  { key: 'room', label: 'Phòng', aliases: ['Phòng STEM'], width: 18 },
]

type Period = { id: string; name: string; starts_at: string; ends_at: string; session: string }
type Entry = { id: string; year_id: string | null; weekday: number; period_id: string; subject: string; kind: string; class_id: string; classes: { name: string } | null; teachers: { full_name: string } | null; stem_rooms: { name: string } | null }
type Opt = { id: string; name: string; year_id?: string | null }
const DAYS = [2, 3, 4, 5, 6, 7]
const hm = (t: string) => t.slice(0, 5)

export default function Timetable({ orgId, year, years = [] }: { orgId: string; year?: Year | null; years?: Year[] }) {
  const [periods, setPeriods] = useState<Period[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [classes, setClasses] = useState<Opt[]>([])
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([])
  const [rooms, setRooms] = useState<Opt[]>([])
  const [cls, setCls] = useState('')
  const [kind, setKind] = useState<'all' | 'stem' | 'regular'>('all')
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const [p, e, c, t, r] = await Promise.all([
      supabase.from('period_configs').select('*').order('starts_at'),
      supabase.from('timetable_entries').select('id, year_id, weekday, period_id, subject, kind, class_id, classes(name), teachers(full_name), stem_rooms(name)'),
      supabase.from('classes').select('id, name, year_id').order('name'),
      supabase.from('teachers').select('id, full_name').order('full_name'),
      loadRooms('stem'),
    ])
    setPeriods((p.data as Period[]) ?? []); setEntries(((e.data as unknown as Entry[]) ?? []).filter(x => !year || !x.year_id || x.year_id === year.id))
    const cs = ((c.data as Opt[]) ?? []).filter(x => sameSchoolYear(years, x.year_id, year ?? null)); setClasses(cs); setCls(v => v || cs[0]?.id || '')
    setTeachers((t.data as any) ?? []); setRooms(r)
  }
  useEffect(() => { load() }, [])

  async function add(v: Record<string, string>) {
    const { error } = await supabase.from('timetable_entries').insert({
      org_id: orgId, year_id: year?.id ?? null, class_id: v.class_id, weekday: Number(v.weekday), period_id: v.period_id,
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
  function exportXlsx() {
    const pIdx = (id: string) => periods.findIndex(p => p.id === id)
    const rows = [...entries].sort((a, b) => (a.classes?.name ?? '').localeCompare(b.classes?.name ?? '', 'vi') || a.weekday - b.weekday || pIdx(a.period_id) - pIdx(b.period_id))
      .map(e => [e.classes?.name, e.weekday, periods.find(p => p.id === e.period_id)?.name, e.subject, e.teachers?.full_name, e.kind === 'stem' ? 'STEM' : 'Thường', e.stem_rooms?.name])
    downloadXlsx(`thoi-khoa-bieu-${(year ? `${year.name}-${year.term}` : 'tat-ca').replace(/\s+/g, '')}`, COLS, rows)
  }
  // Nhập TKB vào học kỳ đang chọn; tiết trùng lớp/giáo viên được báo lại, không ghi đè
  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    if (!year) return 'Chưa chọn học kỳ ở đầu menu.'
    const cMap = new Map(classes.flatMap(c => [[norm(c.name), c.id], [norm(c.name.replace(/^lớp\s*/i, '')), c.id]] as [string, string][]))
    const pMap = new Map(periods.flatMap(p => [[norm(p.name), p.id], [norm(p.name.replace(/^tiết\s*/i, '')), p.id]] as [string, string][]))
    const tMap = new Map(teachers.map(t => [norm(t.full_name), t.id])); const rMap = new Map(rooms.map(r => [norm(r.name), r.id]))
    const bad: string[] = []; let ok = 0
    const list = recs.flatMap(r => {
      const class_id = cMap.get(norm(r.cls)) ?? cMap.get(norm(r.cls.replace(/^lớp\s*/i, '')))
      const weekday = Number(norm(r.day).replace(/^thu /, '').replace(/\D/g, ''))
      const period_id = pMap.get(norm(r.period)) ?? pMap.get(norm(r.period.replace(/^tiết\s*/i, '')))
      const teacher_id = r.teacher ? tMap.get(norm(r.teacher)) : undefined
      if (!class_id) { bad.push(`dòng ${r._line}: không có lớp "${r.cls}"`); return [] }
      if (!(weekday >= 2 && weekday <= 7)) { bad.push(`dòng ${r._line}: thứ "${r.day}"`); return [] }
      if (!period_id) { bad.push(`dòng ${r._line}: không có tiết "${r.period}"`); return [] }
      if (r.teacher && !teacher_id) { bad.push(`dòng ${r._line}: không có GV "${r.teacher}"`); return [] }
      return [{ line: r._line, row: { org_id: orgId, year_id: year.id, class_id, weekday, period_id, subject: r.subject, teacher_id: teacher_id ?? null,
        kind: norm(r.kind).includes('stem') ? 'stem' : 'regular', room_id: r.room ? rMap.get(norm(r.room)) ?? null : null } }]
    })
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200)
      const { error } = await supabase.from('timetable_entries').insert(chunk.map(x => x.row))
      if (!error) { ok += chunk.length; continue }
      for (const x of chunk) {   // có tiết trùng: nhập từng dòng để báo đúng dòng lỗi
        const r = await supabase.from('timetable_entries').insert(x.row)
        if (!r.error) ok++
        else bad.push(`dòng ${x.line}: ${r.error.message.includes('class_id_weekday') ? 'lớp đã có tiết giờ này' : r.error.message.includes('teacher_id_weekday') ? 'GV trùng giờ' : r.error.message}`)
      }
    }
    load(); return importSummary(ok, `tiết vào ${yearLabel(year)}`, bad)
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
          <ImportExcel columns={COLS} template="mau-thoi-khoa-bieu" sample={[['Lớp 9A', '2', 'Tiết 1', 'Toán', teachers[0]?.full_name ?? '', 'Thường', ''], ['Lớp 9A', '3', 'Tiết 2', 'Công nghệ', '', 'STEM', rooms[0]?.name ?? '']]}
            onRecords={importRecords} onMessage={setMsg} />
          <button onClick={exportXlsx} disabled={!entries.length}>Xuất Excel</button>
          <button className="primary" onClick={() => setAdding(true)}>Thêm tiết</button>
        </div>
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}
      <p className="sub">{yearLabel(year)} · {total} tiết/tuần</p>
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
