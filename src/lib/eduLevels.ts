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

/** Các khối từ – đến */
export const gradeRange = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)

/** Danh mục cấp học dùng chung trong phiên; `reload()` sau khi sửa để mọi màn cập nhật.
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
  /** Khối 1–12 có trong các cấp đang dùng (sắp tăng dần) */
  const grades = [...new Set(levels.flatMap(l => gradeRange(l.grade_from, l.grade_to)))].sort((a, b) => a - b)
  return { levels, all, byCode, name, grades, reload: () => fetchLevels(true) }
}
