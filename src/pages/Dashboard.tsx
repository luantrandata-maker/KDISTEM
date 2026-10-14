import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Room = { id: string; name: string; capacity: number | null; status: string }
const pct = (a: number, b: number) => (b === 0 ? 100 : Math.round((a / b) * 100))
const DAY = ['', '', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
const ROOM_STATUS: Record<string, string> = { active: 'Hoạt động', maintenance: 'Bảo trì', inactive: 'Ngừng' }

export default function Dashboard() {
  const [d, setD] = useState<any>(null)
  useEffect(() => {
    Promise.all([
      supabase.from('teachers').select('id'),
      supabase.from('classes').select('id'),
      supabase.from('students').select('id'),
      supabase.from('stem_rooms').select('id, name, capacity, status'),
      supabase.from('equipment_units').select('status'),
      supabase.from('teaching_assignments').select('teacher_id'),
      supabase.from('timetable_entries').select('class_id, weekday, kind'),
      supabase.from('stem_registrations').select('status'),
      supabase.from('warranty_tickets').select('status'),
    ]).then(([t, c, s, r, u, a, tt, reg, w]) => setD({
      teachers: t.data ?? [], classes: c.data ?? [], students: s.data ?? [], rooms: (r.data ?? []) as Room[],
      units: u.data ?? [], assigns: a.data ?? [], tt: tt.data ?? [], regs: reg.data ?? [], tickets: w.data ?? [],
    }))
  }, [])

  if (!d) return <p className="sub">Đang tải số liệu…</p>

  const stemTt = d.tt.filter((e: any) => e.kind === 'stem')
  const assigned = new Set(d.assigns.map((x: any) => x.teacher_id)).size
  const criteria: [string, number][] = [
    ['Phòng STEM sẵn sàng', pct(d.rooms.filter((r: Room) => r.status === 'active').length, d.rooms.length)],
    ['Thiết bị hoạt động tốt', pct(d.units.filter((x: any) => ['available', 'in_use', 'in_stock'].includes(x.status)).length, d.units.length)],
    ['Giáo viên có phân công', pct(assigned, d.teachers.length)],
    ['Lớp có tiết STEM', pct(new Set(stemTt.map((e: any) => e.class_id)).size, d.classes.length)],
    ['Đăng ký đã xử lý', pct(d.regs.filter((x: any) => x.status !== 'pending').length, d.regs.length)],
    ['Bảo hành đã xử lý', pct(d.tickets.filter((x: any) => ['resolved', 'closed'].includes(x.status)).length, d.tickets.length)],
  ]
  const index = Math.round(criteria.reduce((s, [, v]) => s + v, 0) / criteria.length)
  const grade = index >= 85 ? 'A' : index >= 70 ? 'B' : index >= 55 ? 'C' : 'D'
  const perDay = [2, 3, 4, 5, 6, 7].map(n => [DAY[n], stemTt.filter((e: any) => e.weekday === n).length] as const)
  const maxDay = Math.max(1, ...perDay.map(x => x[1]))
  const pendingRegs = d.regs.filter((x: any) => x.status === 'pending').length

  const cards: [string, number][] = [
    ['Giáo viên', d.teachers.length], ['Lớp học', d.classes.length], ['Học sinh', d.students.length],
    ['Phòng STEM', d.rooms.length], ['Thiết bị', d.units.length],
    ['Chờ duyệt đăng ký', pendingRegs],
  ]

  return (
    <>
      <div className="cards">{cards.map(([l, n]) => <div className="card" key={l}><strong>{n}</strong><span>{l}</span></div>)}</div>
      <div className="dash2">
        <div className="panel">
          <div className="idxhead">
            <div><h3>STEM Index</h3><small>Tính từ dữ liệu vận hành, trung bình 6 tiêu chí</small></div>
            <div className="idxbadge"><b>{index}</b><span>/100 · Xếp loại {grade}</span></div>
          </div>
          <div className="bars">
            {criteria.map(([l, v]) => (
              <div className="barrow" key={l}><span>{l}</span>
                <div className="track"><div className={'fill ' + (v >= 80 ? 'g' : v >= 50 ? 'o' : 'r')} style={{ width: v + '%' }} /></div><b>{v}</b></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Phòng STEM</h3>
          <div className="roomlist">
            {d.rooms.map((r: Room) => (
              <div className="roomrow" key={r.id}><div><b>{r.name}</b><br /><small>{r.capacity ?? '—'} học sinh</small></div>
                <span className={'pill ' + r.status}>{ROOM_STATUS[r.status]}</span></div>
            ))}
            {d.rooms.length === 0 && <small>Chưa có phòng STEM.</small>}
          </div>
        </div>
        <div className="panel">
          <h3>Tiết STEM theo ngày trong tuần</h3>
          <div className="cols">
            {perDay.map(([l, n]) => (
              <div className="col" key={l}><div className="colbar" style={{ height: (n / maxDay) * 100 + '%' }}><span>{n}</span></div><small>{l}</small></div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
