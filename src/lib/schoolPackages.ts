import { fetchAll, supabase } from './supabase'

// Trường dùng gói STEM nào (156, 158): trường dùng một hoặc nhiều gói trong năm học, mỗi khối một gói. Trường có thể chỉ áp dụng
// một phần của gói: các phần không áp dụng ghi ở school_package_skips (cả học phần ở một vị trí, hoặc một chủ đề).
// Nâng cấp gói: bản gán cũ kết thúc (ends_on), bản mới bắt đầu từ ngày áp dụng (starts_on, prev_id = bản cũ).
export type SchoolPkgRow = {
  org_id: string; name: string; code: string | null; level: string | null; province_id: string | null; province_name: string | null
  sp_id: string | null; package_id: string | null; grades: number[] | null; full_package: boolean | null; note: string | null; updated_at: string | null
  starts_on: string | null; ends_on: string | null; prev_id: string | null
}
export type PkgSkip = { id?: string; school_package_id: string; track_code: string; grade: number; slot: number | null; topic_id: string | null }

export const spErr = (m: string) => (/school_package|schema cache|does not exist|starts_on|ends_on|prev_id/i.test(m) && !/row-level/i.test(m) ? 'Hãy chạy migration 158 trên Supabase.'
  : /row-level|42501|permission|Chỉ quản trị/i.test(m) ? 'Chỉ quản trị nền tảng KDI gán, nâng cấp được gói cho trường.'
  : /Khối đã có gói khác/i.test(m) ? 'Khối đã có gói khác trong năm học này. Mỗi khối chỉ dùng một gói.'
  : /Chỉ gán gói cho trường|Chọn ít nhất một khối|Chọn gói khác|Ngày áp dụng phải sau|đã kết thúc/i.test(m) ? m.replace(/\s*\S*$/, '') + '.'
  : m)

/** Ngày hôm nay theo giờ máy, dạng 2026-11-19 */
export const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
/** 2027-01-05 → 05/01/2027 */
export const fmtDay = (d: string | null | undefined) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''
/** Trạng thái một bản gán theo ngày hôm nay: đang dùng, sắp áp dụng (nâng cấp từ ngày sau), đã kết thúc (lịch sử) */
export function spState(r: Pick<SchoolPkgRow, 'starts_on' | 'ends_on'>, today = todayIso()): 'live' | 'next' | 'ended' {
  if (r.ends_on && r.ends_on < today) return 'ended'
  if (r.starts_on && r.starts_on > today) return 'next'
  return 'live'
}

/** Năm học hiện tại: từ tháng 8 tính sang năm học mới */
export function currentYear(d = new Date()) {
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${y + 1}`
}
export const yearLabel = (y: string) => y.replace('-', '–')
export const shiftYear = (y: string, n: number) => { const a = Number(y.slice(0, 4)) + n; return `${a}-${a + 1}` }

/** Khối theo cấp học của trường; trường chưa ghi cấp học (VD liên cấp) chọn được cả 12 khối */
export const LEVEL_GRADES: Record<string, number[]> = {
  tieuhoc: [1, 2, 3, 4, 5], thcs: [6, 7, 8, 9], thpt: [10, 11, 12],
}
export const ALL_GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
export const gradesOfLevel = (level: string | null | undefined) => level ? LEVEL_GRADES[level] ?? [] : ALL_GRADES

/** K1–K5, K6, K8 */
export function kRange(gs: number[]) {
  const xs = [...gs].filter(g => g > 0).sort((a, b) => a - b)
  if (!xs.length) return '—'
  const parts: string[] = []; let a = xs[0], b = xs[0]
  for (const g of [...xs.slice(1), NaN]) {
    if (g === b + 1) { b = g; continue }
    parts.push(a === b ? `K${a}` : b === a + 1 ? `K${a}, K${b}` : `K${a}–K${b}`); a = b = g
  }
  return parts.join(', ')
}

export async function loadSchoolPkgs(year: string) {
  const [r, s] = await Promise.all([
    // Chỉ trường đã có gói trong năm học (159); trường để chọn khi gán gói tải theo tỉnh ở ô Gán gói
    fetchAll<SchoolPkgRow>(() => supabase.rpc('school_package_schools', { p_year: year }) as any),
    fetchAll<PkgSkip>(() => supabase.from('school_package_skips').select('id, school_package_id, track_code, grade, slot, topic_id, school_packages!inner(school_year)').eq('school_packages.school_year', year).order('id')),
  ])
  const error = r.error ?? s.error
  return { rows: (r.data ?? []) as SchoolPkgRow[], skips: (s.data ?? []) as PkgSkip[], error: error ? spErr(error.message + ' ' + ((error as { code?: string }).code ?? '')) : '' }
}
