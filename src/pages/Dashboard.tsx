import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoDate, mondayOf, addDays } from '../lib/programs'
import { isStem } from '../lib/rooms'

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100))
const DAY = ['', '', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
const ROOM_STATUS: Record<string, string> = { active: 'Hoạt động', maintenance: 'Bảo trì', inactive: 'Ngừng' }

export default function Dashboard({ userName, go }: { userName?: string; go?: (page: string) => void }) {
  const [d, setD] = useState<any>(null)
  useEffect(() => {
    Promise.all([
      supabase.from('teachers').select('id, profile_id'),                                        // 0
      supabase.from('classes').select('id'),                                                     // 1
      supabase.from('students').select('id, class_id'),                                          // 2
      supabase.from('stem_rooms').select('*'),                                                   // 3 (lọc phòng STEM bên dưới)
      supabase.from('equipment_units').select('status'),                                         // 4
      supabase.from('timetable_entries').select('class_id, teacher_id, weekday, kind, room_id, classes(name), teachers(full_name), period_id'), // 5
      supabase.from('stem_registrations').select('status, on_date, teacher_id, room_id, period_id'), // 6
      supabase.from('warranty_tickets').select('status'),                                        // 7
      supabase.from('stem_packages').select('ends_on'),                                          // 8
      supabase.from('stem_teacher_programs').select('teacher_id'),                               // 9
      supabase.from('borrow_requests').select('status'),                                         // 10
      supabase.from('period_configs').select('id'),                                              // 11
    ]).then(r => setD(r.map(x => x.data ?? [])))
  }, [])

  if (!d) return <p className="sub">Đang tải số liệu…</p>
  const [teachers, classes, students, allRooms, units, tt, regs, tickets, pkgs, stemTeachers, borrows, periods] = d as any[][]
  const rooms = allRooms.filter(isStem)

  const now = new Date(); const wd = now.getDay() === 0 ? 0 : now.getDay() + 1
  const mon = mondayOf(now); const weekDates = [0, 1, 2, 3, 4].map(i => isoDate(addDays(mon, i)))
  const activeRooms = rooms.filter((r: any) => r.status === 'active')
  const stemTt = tt.filter((e: any) => e.kind === 'stem')
  const weekRegs = regs.filter((r: any) => r.status === 'approved' && weekDates.includes(r.on_date))
  const slots = new Set<string>([...stemTt.filter((e: any) => e.room_id && e.weekday >= 2 && e.weekday <= 6).map((e: any) => `${e.room_id}|${e.weekday}|${e.period_id}`),
    ...weekRegs.map((r: any) => `${r.room_id}|${weekDates.indexOf(r.on_date) + 2}|${r.period_id}`)])
  const capacity = activeRooms.length * 5 * periods.length
  const usage = pct(slots.size, capacity)
  const stemClasses = new Set(stemTt.map((e: any) => e.class_id))
  const teachersUsing = new Set([...stemTt.map((e: any) => e.teacher_id), ...regs.map((r: any) => r.teacher_id)].filter(Boolean))
  const stuInStem = students.filter((s: any) => stemClasses.has(s.class_id)).length
  const approved = regs.filter((r: any) => r.status === 'approved').length

  const criteria: [string, string, number][] = [
    ['A', 'Sẵn sàng', pct(activeRooms.length, rooms.length)],
    ['B', 'Vận hành', pct(units.filter((x: any) => ['available', 'in_use', 'in_stock'].includes(x.status)).length, units.length)],
    ['C', 'Giảng dạy', pct(stemClasses.size, classes.length)],
    ['D', 'Tài nguyên', pct(pkgs.filter((p: any) => !p.ends_on || new Date(p.ends_on) >= now).length, pkgs.length)],
    ['E', 'Số hóa', pct(teachers.filter((t: any) => t.profile_id).length, teachers.length)],
    ['F', 'Tác động', pct(stuInStem, students.length)],
  ]
  const index = Math.round(criteria.reduce((s, c) => s + c[2], 0) / criteria.length)
  const grade = index >= 85 ? ['A', 'Xuất sắc'] : index >= 70 ? ['B', 'Khá'] : index >= 55 ? ['C', 'Trung bình'] : ['D', 'Cần cải thiện']
  const today = stemTt.filter((e: any) => e.weekday === wd)
  const pendingRegs = regs.filter((r: any) => r.status === 'pending').length
  const pendingBorrow = borrows.filter((b: any) => b.status === 'pending').length
  const newTickets = tickets.filter((t: any) => ['draft', 'new'].includes(t.status)).length
  const todos = [
    ['Đơn đăng ký STEM chờ duyệt', pendingRegs, true, 'Duyệt đăng ký dạy STEM'],
    ['Phiếu mượn thiết bị chờ duyệt', pendingBorrow, false, 'Quản lý Phòng STEM'],
    ['Ticket bảo hành mới/nháp', newTickets, false, 'Bảo hành thiết bị'],
  ] as [string, number, boolean, string][]
  const todoTotal = todos.reduce((s, t) => s + t[1], 0)
  const perDay = [2, 3, 4, 5, 6, 7].map(n => [DAY[n], stemTt.filter((e: any) => e.weekday === n).length] as const)
  const maxDay = Math.max(1, ...perDay.map(x => x[1]))
  const stats: [string, string, string][] = [
    [String(stemTt.length), 'Tiết STEM trong TKB tuần', `${slots.size} lượt dùng phòng tuần này`],
    [`${activeRooms.length}/${rooms.length}`, 'Phòng hoạt động', 'phòng STEM sẵn sàng'],
    [String(pkgs.length), 'Gói STEM', `${pkgs.filter((p: any) => !p.ends_on || new Date(p.ends_on) >= now).length} gói còn hạn`],
    [String(new Set(stemTeachers.map((x: any) => x.teacher_id)).size), 'Giáo viên dạy STEM', `${teachers.length} giáo viên toàn trường`],
  ]

  return (
    <>
      <div className="hero">
        <div><small>Bảng điều hành nhà trường</small><h2>Xin chào{userName ? `, ${userName}` : ''} 👋</h2>
          <small>{now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })}</small></div>
        <div className="herobox"><b>{index}</b><span>/100 · {grade[0]} · STEM Index</span></div>
        <div className="herobox"><b>{usage}%</b><span>{slots.size}/{capacity} tiết · Sử dụng phòng</span></div>
        <div className="heroside"><b>Tiết STEM hôm nay ({today.length})</b>
          {today.slice(0, 2).map((e: any, i: number) => <span key={i}>{e.classes?.name} — {e.teachers?.full_name}</span>)}
          {today.length === 0 && <span>{wd === 0 ? 'Chủ nhật, không có tiết.' : 'Hôm nay chưa có tiết STEM.'}</span>}</div>
      </div>
      <div className="cards">{stats.map(([n, l, s]) => <div className="card" key={l}><strong>{n}</strong><b style={{ fontSize: 13 }}>{l}</b><span>{s}</span></div>)}</div>
      <div className="dash2">
        <div className="panel">
          <h3>Vận hành tuần này</h3>
          <div className="vh">
            <div className="ring" style={{ ['--p' as any]: usage + '%' }}><span>{usage}%</span></div>
            <div className="bars">
              {([['GV dùng phòng STEM', teachersUsing.size, teachers.length], ['HS tham gia', stuInStem, students.length], ['Đăng ký đã duyệt', approved, regs.length]] as [string, number, number][]).map(([l, a, b]) => (
                <div className="barrow" key={l} style={{ gridTemplateColumns: '150px 1fr 70px' }}><span>{l}</span>
                  <div className="track"><div className="fill g" style={{ width: pct(a, b) + '%' }} /></div><small>{a}/{b}</small></div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="bar"><h3>Cần làm</h3>{todoTotal > 0 && <span className="pill inactive">{todoTotal}</span>}</div>
          {todos.map(([l, n, hi, page]) => (
            <button className={'todo' + (hi ? ' hi' : '')} key={l} onClick={() => go?.(page)}><span><span className="n" style={{ display: 'inline-grid', marginRight: 8 }}>{n}</span>{l}{hi && <small style={{ color: 'var(--bad)' }}> · Ưu tiên cao</small>}</span>›</button>
          ))}
          <small>Thao tác nhanh</small>
          <div className="tools" style={{ marginTop: 6 }}>
            {[['Quản lý giáo viên', 'Giáo viên'], ['Kế hoạch giáo dục', 'Kế hoạch GD toàn trường'], ['Yêu cầu bảo hành', 'Bảo hành thiết bị']].map(([l, p]) => <button key={l} onClick={() => go?.(p)}>{l}</button>)}
          </div>
        </div>
        <div className="panel">
          <h3>Tiết STEM theo ngày trong tuần</h3>
          <div className="cols">{perDay.map(([l, n]) => <div className="col" key={l}><div className="colbar" style={{ height: (n / maxDay) * 100 + '%' }}><span>{n}</span></div><small>{l}</small></div>)}</div>
        </div>
        <div className="panel">
          <div className="idxhead"><div><h3>STEM Index</h3><small>6 trụ cột tính từ dữ liệu vận hành</small></div>
            <div className="idxbadge"><b>{index}</b><span>/100 · Xếp loại {grade[0]} · {grade[1]}</span></div></div>
          <div className="bars">{criteria.map(([k, l, v]) => (
            <div className="barrow" key={k}><span>{k}. {l}</span><div className="track"><div className={'fill ' + (v >= 80 ? 'g' : v >= 50 ? 'o' : 'r')} style={{ width: v + '%' }} /></div><b>{v}</b></div>
          ))}</div>
        </div>
        <div className="panel">
          <div className="bar"><h3>Phòng STEM</h3><button onClick={() => go?.('Quản lý Phòng STEM')}>Chi tiết</button></div>
          {rooms.map((r: any) => (
            <div className="roomrow" key={r.id}><div><b>{r.name}</b><br /><small>{r.code} · {r.capacity ?? '—'} HS</small></div>
              <span className={'pill ' + r.status}>{ROOM_STATUS[r.status]}</span></div>
          ))}
        </div>
      </div>
    </>
  )
}
