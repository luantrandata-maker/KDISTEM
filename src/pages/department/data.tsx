import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type SchoolStat = {
  school_id: string; code: string; name: string; level: string | null; ward: string | null; activated: boolean
  teachers: number; stem_teachers: number; students: number; classes: number; stem_classes: number; stem_students: number
  programs: string[]; rooms: number; rooms_active: number; stem_periods: number; total_periods: number; room_periods: number
  lesson_plans: number; products: number; trained: number; training_done: number; attendance_rate: number | null
  units: number; units_broken: number; units_maintenance: number; units_available: number
  graded: number; avg_score: number | null; k12_synced: boolean; has_year: boolean; last_activity: string | null; kpi: number
}
export type SubjectStat = { subject: string; total: number; stem: number; classes: number; schools: number; students: number }

export const LEVEL: Record<string, string> = { mamnon: 'Mầm non', tieuhoc: 'Tiểu học', thcs: 'THCS', thpt: 'THPT' }
export const PROGRAMS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5'] as const
export const PROGRAM_NAME: Record<string, string> = { CT1: 'Tích hợp nội môn', CT2: 'Liên môn', CT3: 'Đổi mới sáng tạo', CT4: 'Robotic / AI', CT5: 'Nghiên cứu khoa học' }

// Một lần tải cho mọi màn của Sở (cache 60 giây trong phiên)
let cache: { at: number; schools: SchoolStat[]; subjects: SubjectStat[] } | null = null
export function useDeptStats() {
  const [data, setData] = useState<{ schools: SchoolStat[]; subjects: SubjectStat[] } | null>(cache)
  const [err, setErr] = useState('')
  async function load(force = false) {
    if (!force && cache && Date.now() - cache.at < 60000) return setData(cache)
    const [s, u] = await Promise.all([supabase.rpc('dept_school_stats'), supabase.rpc('dept_subject_stats')])
    if (s.error) return setErr(/schema cache|does not exist/i.test(s.error.message)
      ? 'Cơ sở dữ liệu chưa có các hàm thống kê của Sở. Hãy chạy migration 018_department_portal.sql trên Supabase (sau 012–017).'
      : s.error.message)
    cache = { at: Date.now(), schools: (s.data as SchoolStat[]) ?? [], subjects: (u.data as SubjectStat[]) ?? [] }
    setData(cache)
  }
  useEffect(() => { load() }, [])
  return { schools: data?.schools ?? [], subjects: data?.subjects ?? [], loading: !data && !err, err, reload: () => load(true) }
}

// Xếp loại theo KPI (màu trạng thái luôn đi kèm biểu tượng + chữ)
export function grade(kpi: number): { label: string; tone: 'good' | 'warn' | 'bad'; icon: string } {
  if (kpi >= 70) return { label: 'Đạt', tone: 'good', icon: '✓' }
  if (kpi >= 45) return { label: 'Cần cải thiện', tone: 'warn', icon: '!' }
  return { label: 'Chưa đạt', tone: 'bad', icon: '✕' }
}
export const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
export const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
export const nf = (n: number) => n.toLocaleString('vi-VN')

// Gộp theo xã/phường
export function byWard(schools: SchoolStat[]) {
  const m = new Map<string, SchoolStat[]>()
  schools.forEach(s => { const k = s.ward ?? 'Chưa cập nhật'; m.set(k, [...(m.get(k) ?? []), s]) })
  return [...m.entries()].map(([ward, list]) => ({
    ward, list,
    schools: list.length,
    deployed: list.filter(s => s.programs.length > 0).length,
    teachers: sum(list.map(s => s.teachers)), trained: sum(list.map(s => s.training_done)),
    students: sum(list.map(s => s.students)),
    kpi: Math.round(avg(list.map(s => s.kpi))),
  })).sort((a, b) => b.kpi - a.kpi)
}

// Chỉ số trường dùng chung cho bản đồ nhiệt và bản đồ độ phủ STEM (max = mục tiêu, tô đậm nhất)
export const HEAT: { key: string; label: string; get: (s: SchoolStat) => number; fmt: (v: number) => string; max: number }[] = [
  { key: 'kpi', label: 'KPI', get: s => s.kpi, fmt: v => String(v), max: 100 },
  { key: 'ct', label: 'Phủ CT1–CT5', get: s => s.programs.length, fmt: v => `${v}/5`, max: 5 },
  { key: 'room', label: 'Phòng STEM', get: s => s.rooms_active, fmt: v => String(v), max: 4 },
  { key: 'per', label: 'Tiết STEM/lớp', get: s => (s.classes ? s.stem_periods / s.classes : 0), fmt: v => v.toFixed(1), max: 3 },
  { key: 'train', label: 'GV tập huấn', get: s => pct(s.training_done, s.teachers), fmt: v => v + '%', max: 100 },
  { key: 'lp', label: 'Giáo án/GV', get: s => (s.teachers ? s.lesson_plans / s.teachers : 0), fmt: v => v.toFixed(2), max: 0.8 },
  { key: 'stu', label: 'HS học STEM', get: s => pct(s.stem_students, s.students), fmt: v => v + '%', max: 100 },
]
