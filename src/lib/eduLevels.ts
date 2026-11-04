import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Danh mục cấp học & khối (migration 065): KDI sửa ở "Chương trình giáo dục → Cấp học & khối".
// Chưa chạy migration thì dùng 3 cấp mặc định dưới đây.
export type EduLevel = { code: string; name: string; grade_from: number; grade_to: number; sort?: number; active?: boolean; updated_at?: string }

export const DEFAULT_LEVELS: EduLevel[] = [
  { code: 'tieuhoc', name: 'Tiểu học', grade_from: 1, grade_to: 5, sort: 1, active: true },
  { code: 'thcs', name: 'THCS', grade_from: 6, grade_to: 9, sort: 2, active: true },
  { code: 'thpt', name: 'THPT', grade_from: 10, grade_to: 12, sort: 3, active: true },
]

let cache: EduLevel[] | null = null
let pending: Promise<EduLevel[]> | null = null
const subs = new Set<(l: EduLevel[]) => void>()

function fetchLevels(force = false): Promise<EduLevel[]> {
  if (cache && !force) return Promise.resolve(cache)
  if (!pending || force) {
    pending = Promise.resolve(supabase.from('edu_levels').select('*').order('sort').order('grade_from')).then(({ data, error }) => {
      cache = !error && data?.length ? (data as EduLevel[]) : DEFAULT_LEVELS
      pending = null
      subs.forEach(f => f(cache!))
      return cache
    })
  }
  return pending
}

/** Các khối từ – đến (bỏ số 0: mầm non -4…-1, phổ thông 1–12) */
export const gradeRange = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).filter(g => g !== 0)

// 128: khối mầm non lưu bằng số âm
export const PRESCHOOL: Record<number, [string, string]> = { [-4]: ['Nhà trẻ', 'Nhà trẻ'], [-3]: ['Mầm', 'Mầm (3–4 tuổi)'], [-2]: ['Chồi', 'Chồi (4–5 tuổi)'], [-1]: ['Lá', 'Lá (5–6 tuổi)'] }
/** Tên một khối: "Khối 6", "Chồi (4–5 tuổi)" */
export const gradeName = (g: number) => PRESCHOOL[g]?.[1] ?? `Khối ${g}`

/** Danh mục cấp học dùng chung trong phiên; `reload()` sau khi sửa để tất cả màn cập nhật.
 *  `levels`: cấp đang dùng (để chọn khi soạn mới); `all`: gồm cả cấp đã ngừng dùng (để hiện dữ liệu cũ). */
export function useEduLevels() {
  const [all, setAll] = useState<EduLevel[]>(cache ?? DEFAULT_LEVELS)
  useEffect(() => {
    subs.add(setAll)
    fetchLevels().then(setAll)
    return () => { subs.delete(setAll) }
  }, [])
  const byCode = Object.fromEntries(all.map(l => [l.code, l])) as Record<string, EduLevel | undefined>
  const name = (code: string | null | undefined) => (code ? byCode[code]?.name ?? code : '')
  const levels = all.filter(l => l.active !== false)
  /** Khối (mầm non -4…-1, phổ thông 1–12) có trong các cấp đang dùng (sắp tăng dần) */
  const grades = [...new Set(levels.flatMap(l => gradeRange(l.grade_from, l.grade_to)))].sort((a, b) => a - b)
  return { levels, all, byCode, name, grades, reload: () => fetchLevels(true) }
}

/** 091: khối áp dụng của chương trình (danh sách); bản ghi cũ chưa có danh sách thì lấy từ khối – đến khối. */
export const progGrades = (p: { grades?: number[] | null; grade_from?: number | null; grade_to?: number | null }) =>
  p.grades?.length ? [...p.grades].sort((a, b) => a - b) : p.grade_from ? gradeRange(p.grade_from, p.grade_to ?? p.grade_from) : []
/** "Khối 6–9", "Khối 6, 8", "Khối 6–7, 9"; mầm non: "Chồi, Lá" (ghép: "Lá · Khối 1–2") */
export const fmtGrades = (gs: number[], prefix = 'Khối ') => {
  const pre = gs.filter(g => g < 0).map(g => PRESCHOOL[g]?.[0] ?? String(g)).join(', ')
  const xs = gs.filter(g => g > 0)
  if (!xs.length) return pre
  const parts: string[] = []; let a = xs[0], b = xs[0]
  for (const g of [...xs.slice(1), NaN]) {
    if (g === b + 1) { b = g; continue }
    parts.push(a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`); a = b = g
  }
  return (pre ? pre + ' · ' : '') + prefix + parts.join(', ')
}
/** 092: khối của học phần / bài (danh sách); bản ghi cũ chỉ có grade. Rỗng = theo mục cha. */
export const unitGradesOf = (u: { grade?: number | null; grades?: number[] | null }) => u.grades?.length ? u.grades : u.grade ? [u.grade] : []
