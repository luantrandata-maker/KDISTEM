import { supabase } from './supabase'

// Buổi dạy & điểm danh theo tiết (migration 027)

export type SessionState = 'upcoming' | 'live' | 'not_marked' | 'taught' | 'cancelled'
export type SessionRow = {
  id: string; org_id: string; class_id: string; teacher_id: string | null; period_id: string; room_id: string | null
  session_date: string; subject: string; kind: 'regular' | 'stem'; status: 'scheduled' | 'taught' | 'cancelled'
  is_makeup: boolean; makeup_of: string | null; note: string | null; cancel_reason: string | null
  present_count: number; absent_count: number; late_count: number; excused_count: number; marked_at: string | null
  period_name: string; starts_at: string; ends_at: string; class_name: string | null; grade: number | null
  teacher_name: string | null; room_name: string | null; state: SessionState
}
export const SESSION_COLS = 'id, org_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind, status, is_makeup, makeup_of, note, cancel_reason, present_count, absent_count, late_count, excused_count, marked_at, period_name, starts_at, ends_at, class_name, grade, teacher_name, room_name, state'

export const STATE: Record<SessionState, { label: string; pill: string }> = {
  upcoming: { label: 'Sắp diễn ra', pill: '' },
  live: { label: 'Đang diễn ra', pill: 'maintenance' },
  not_marked: { label: 'Chưa điểm danh', pill: 'inactive' },
  taught: { label: 'Đã dạy', pill: 'active' },
  cancelled: { label: 'Đã huỷ', pill: '' },
}
export type Mark = 'present' | 'late' | 'absent' | 'excused'
export const MARK: Record<Mark, string> = { present: 'Có mặt', late: 'Muộn', absent: 'Vắng', excused: 'Có phép' }

// Ngày theo giờ máy người dùng (người dùng ở Việt Nam), dạng YYYY-MM-DD
const p2 = (n: number) => String(n).padStart(2, '0')
export const isoDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (s: string, n: number) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d) }
export const today = () => isoDay(new Date())
// Thứ 2 của tuần chứa ngày s
export const weekStart = (s: string) => { const d = parseDay(s); const dow = (d.getDay() + 6) % 7; return addDays(s, -dow) }
const DOW = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
export const dayLabel = (s: string) => { const d = parseDay(s); return `${DOW[d.getDay()]}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}` }
export const shortDay = (s: string) => { const d = parseDay(s); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}` }

// Đảm bảo đã sinh buổi dạy từ TKB cho tuần (Thứ 2–Thứ 7). Nhớ các tuần đã sinh trong phiên làm việc.
const generated = new Set<string>()
export async function ensureWeek(orgId: string | null | undefined, anyDay: string, force = false) {
  const from = weekStart(anyDay), key = `${orgId}:${from}`
  if (!orgId || (!force && generated.has(key))) return null
  const { data, error } = await supabase.rpc('generate_teaching_sessions', { p_from: from, p_to: addDays(from, 5) })
  if (error) return error.message
  generated.add(key)
  return data as { created: number; updated: number; removed: number }
}

export const attendRate = (s: { present: number; late: number; absent: number; excused: number }) => {
  const t = s.present + s.late + s.absent + s.excused
  return t ? Math.round(((s.present + s.late) / t) * 1000) / 10 : null
}
