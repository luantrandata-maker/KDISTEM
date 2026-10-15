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
    if (s.error) return setErr(s.error.message)
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
