import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Danh mục loại chương trình (migration 062, 064): CT1–CT5 ban đầu và các loại KDI thêm sau — tên, mô tả, môn học,
// cấp học áp dụng; KDI sửa ở "Chương trình giáo dục → Loại chương trình". Chưa chạy migration thì dùng nội dung mặc định dưới đây.
export type StemLevel = 'mamnon' | 'tieuhoc' | 'thcs' | 'thpt' | 'thpt_nghe'
export type StemTrack = { code: string; name: string; title: string; description: string; subjects: string[]; levels: StemLevel[]; sort?: number; active?: boolean; updated_at?: string }

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
    pending = Promise.resolve(supabase.from('stem_tracks').select('*').order('sort').order('code')).then(({ data, error }) => {
      cache = !error && data?.length ? (data as StemTrack[]) : DEFAULT_TRACKS
      pending = null
      subs.forEach(f => f(cache!))
      return cache
    })
  }
  return pending
}

// Màu của từng loại: CT1–CT5 giữ màu cũ, loại thêm sau lấy màu theo mã (ổn định giữa các lần mở)
const BASE_COLOR: Record<string, string> = { CT1: '#64748b', CT2: '#2e95f2', CT3: '#7c3aed', CT4: '#dc2626', CT5: '#16a34a' }
const EXTRA_COLOR = ['#0f766e', '#b45309', '#be185d', '#4338ca', '#15803d', '#a21caf', '#0369a1', '#9a3412']
export function trackColor(code: string): string {
  if (BASE_COLOR[code]) return BASE_COLOR[code]
  let h = 0
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return EXTRA_COLOR[h % EXTRA_COLOR.length]
}
/** Bảng màu tra theo mã, có màu cho cả mã chưa biết: PROGRAM_COLOR[code] */
export const TRACK_COLOR: Record<string, string> = new Proxy(BASE_COLOR, { get: (_t, k) => (typeof k === 'string' ? trackColor(k) : undefined) })

/** Danh mục loại chương trình dùng chung trong phiên; `reload()` sau khi sửa để mọi màn cập nhật.
 *  `codes`: mã các loại đang dùng (để chọn khi soạn mới); `allCodes`: gồm cả loại đã ngừng dùng (để lọc dữ liệu cũ). */
export function useStemTracks() {
  const [tracks, setTracks] = useState<StemTrack[]>(cache ?? DEFAULT_TRACKS)
  useEffect(() => {
    subs.add(setTracks)
    fetchTracks().then(setTracks)
    return () => { subs.delete(setTracks) }
  }, [])
  const byCode = Object.fromEntries(tracks.map(t => [t.code, t])) as Record<string, StemTrack | undefined>
  const allCodes = tracks.map(t => t.code)
  const codes = tracks.filter(t => t.active !== false).map(t => t.code)
  return { tracks, byCode, codes, allCodes, reload: () => fetchTracks(true) }
}
