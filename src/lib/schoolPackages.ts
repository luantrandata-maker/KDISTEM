import { supabase } from './supabase'

// Trường dùng gói STEM nào (156): mỗi trường, mỗi năm học một gói, áp dụng cho một số khối. Trường có thể chỉ áp dụng
// một phần của gói: các phần không áp dụng ghi ở school_package_skips (cả học phần ở một vị trí, hoặc một chủ đề).
export type SchoolPkgRow = {
  org_id: string; name: string; code: string | null; level: string | null; province_id: string | null; province_name: string | null
  sp_id: string | null; package_id: string | null; grades: number[] | null; full_package: boolean | null; note: string | null; updated_at: string | null
}
export type PkgSkip = { id?: string; school_package_id: string; track_code: string; grade: number; slot: number | null; topic_id: string | null }

export const spErr = (m: string) => (/school_package|schema cache|does not exist/i.test(m) && !/row-level/i.test(m) ? 'Hãy chạy migration 156 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI gán được gói cho trường.'
  : /23505|duplicate|school_packages_org_id_school_year/i.test(m) ? 'Trường này đã có gói trong năm học này.'
  : /Chỉ gán gói cho trường/i.test(m) ? 'Chỉ gán gói cho trường.'
  : m)

/** Năm học hiện tại: từ tháng 8 tính sang năm học mới */
export function currentYear(d = new Date()) {
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${y + 1}`
}
export const yearLabel = (y: string) => y.replace('-', '–')
export const shiftYear = (y: string, n: number) => { const a = Number(y.slice(0, 4)) + n; return `${a}-${a + 1}` }

/** Khối mặc định theo cấp học của trường */
export const LEVEL_GRADES: Record<string, number[]> = {
  tieuhoc: [1, 2, 3, 4, 5], thcs: [6, 7, 8, 9], thpt: [10, 11, 12],
}

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
    supabase.rpc('school_package_schools', { p_year: year }),
    supabase.from('school_package_skips').select('id, school_package_id, track_code, grade, slot, topic_id'),
  ])
  const error = r.error ?? s.error
  return { rows: (r.data ?? []) as SchoolPkgRow[], skips: (s.data ?? []) as PkgSkip[], error: error ? spErr(error.message + ' ' + (error.code ?? '')) : '' }
}
