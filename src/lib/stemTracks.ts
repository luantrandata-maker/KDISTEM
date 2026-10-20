import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Danh mục chương trình STEM CT1–CT5 (migration 062): tên, mô tả, môn học, cấp học áp dụng — KDI sửa ở
// "Chương trình giáo dục → Danh mục CT1–CT5". Chưa chạy migration thì dùng nội dung mặc định dưới đây.
export type StemLevel = 'mamnon' | 'tieuhoc' | 'thcs' | 'thpt' | 'thpt_nghe'
export type StemTrack = { code: string; name: string; title: string; description: string; subjects: string[]; levels: StemLevel[]; updated_at?: string }

export const STEM_LEVELS: [StemLevel, string][] = [['mamnon', 'Mầm non'], ['tieuhoc', 'Tiểu học'], ['thcs', 'THCS'], ['thpt', 'THPT'], ['thpt_nghe', 'THPT Nghề']]
export const STEM_LEVEL_NAME = Object.fromEntries(STEM_LEVELS) as Record<StemLevel, string>

export const DEFAULT_TRACKS: StemTrack[] = [
  { code: 'CT1', name: 'Tích hợp nội môn', title: 'STEM Tích hợp nội môn', description: 'Giảng dạy từng môn theo hướng thực tiễn, ứng dụng sáng tạo.',
    subjects: ['Toán STEM', 'Lý STEM', 'Hóa STEM', 'Sinh STEM', 'Khoa học TN STEM', 'Tin học STEM'], levels: ['mamnon', 'tieuhoc', 'thcs', 'thpt', 'thpt_nghe'] },
  { code: 'CT2', name: 'Liên môn', title: 'STEM Liên môn', description: 'Vận dụng kiến thức liên môn để giải quyết vấn đề thực tiễn.',
    subjects: ['Toán STEM', 'Lý STEM', 'Hóa STEM', 'Sinh STEM', 'Công nghệ STEM'], levels: ['thcs', 'thpt'] },
  { code: 'CT3', name: 'Đổi mới sáng tạo', title: 'STEM Đổi mới sáng tạo', description: 'Hoạt động sáng tạo, làm sản phẩm cụ thể.',
    subjects: ['CLB Sáng tạo', 'Ngoại khóa STEM', 'Làm sản phẩm'], levels: ['tieuhoc', 'thcs', 'thpt'] },
  { code: 'CT4', name: 'Robotic / AI', title: 'STEM Robotic · AI · Trải nghiệm', description: 'STEM định hướng đổi mới sáng tạo: Robotic, AI, Trải nghiệm.',
    subjects: ['Robotic', 'AI & Lập trình', 'IoT'], levels: ['thcs', 'thpt', 'thpt_nghe'] },
  { code: 'CT5', name: 'Nghiên cứu khoa học', title: 'STEM Nghiên cứu khoa học', description: 'Tập trung nghiên cứu khoa học độc lập.',
    subjects: ['NCKH', 'Dự án Nghiên cứu'], levels: ['thcs', 'thpt'] },
]

let cache: StemTrack[] | null = null
let pending: Promise<StemTrack[]> | null = null
const subs = new Set<(t: StemTrack[]) => void>()

function fetchTracks(force = false): Promise<StemTrack[]> {
  if (cache && !force) return Promise.resolve(cache)
  if (!pending || force) {
    pending = Promise.resolve(supabase.from('stem_tracks').select('*').order('code')).then(({ data, error }) => {
      cache = !error && data?.length ? (data as StemTrack[]) : DEFAULT_TRACKS
      pending = null
      subs.forEach(f => f(cache!))
      return cache
    })
  }
  return pending
}

/** Danh mục CT1–CT5 dùng chung trong phiên; `reload()` sau khi sửa để mọi màn cập nhật. */
export function useStemTracks() {
  const [tracks, setTracks] = useState<StemTrack[]>(cache ?? DEFAULT_TRACKS)
  useEffect(() => {
    subs.add(setTracks)
    fetchTracks().then(setTracks)
    return () => { subs.delete(setTracks) }
  }, [])
  const byCode = Object.fromEntries(tracks.map(t => [t.code, t])) as Record<string, StemTrack | undefined>
  return { tracks, byCode, reload: () => fetchTracks(true) }
}
