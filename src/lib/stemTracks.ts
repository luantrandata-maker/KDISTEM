import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Danh mục loại chương trình (migration 062, 064, 147): 4 loại CT1–CT4 (Bài học STEM, Trải nghiệm STEM cơ bản / nâng cao,
// Nghiên cứu khoa học kĩ thuật) và các loại KDI thêm sau — tên, mô tả, môn học, cấp học, hình thức, đối tượng, thời lượng
// và các thiết lập KDI cấu hình cho trường. KDI sửa ở "Chương trình giáo dục → Danh mục → Loại chương trình".
export type StemLevel = 'mamnon' | 'tieuhoc' | 'thcs' | 'thpt' | 'thpt_nghe'
export type EduActivity = '' | 'chinh_khoa' | 'tang_cuong' | 'theo_nhu_cau'
export type ScheduleMode = 'subject' | 'timetable' | 'register'
export type StemTrack = {
  code: string; name: string; title: string; description: string; subjects: string[]; levels: StemLevel[]; sort?: number; active?: boolean; updated_at?: string
  // 147: thông tin chung theo sheet Overview và thiết lập cho trường
  form?: string; edu_activity?: EduActivity; teachers?: string; audience?: string; duration?: string; notes?: string
  school_pick_topics?: boolean; school_arrange_ppct?: boolean; schedule_mode?: ScheduleMode
}

export const STEM_LEVELS: [StemLevel, string][] = [['mamnon', 'Mầm non'], ['tieuhoc', 'Tiểu học'], ['thcs', 'THCS'], ['thpt', 'THPT'], ['thpt_nghe', 'THPT Nghề']]
export const STEM_LEVEL_NAME = Object.fromEntries(STEM_LEVELS) as Record<StemLevel, string>
export const EDU_ACTIVITIES: [EduActivity, string][] = [['', 'Chưa chọn'], ['chinh_khoa', 'Chính khóa'], ['tang_cuong', 'Tăng cường'], ['theo_nhu_cau', 'Theo nhu cầu']]
export const EDU_ACTIVITY_NAME = Object.fromEntries(EDU_ACTIVITIES) as Record<EduActivity, string>
export const SCHEDULE_MODES: [ScheduleMode, string][] = [
  ['subject', 'Dạy trong tiết môn học (thay bài SGK)'], ['timetable', 'Xếp vào thời khóa biểu (tiết riêng)'], ['register', 'Học sinh đăng ký, xếp lớp riêng']]
export const SCHEDULE_MODE_NAME = Object.fromEntries(SCHEDULE_MODES) as Record<ScheduleMode, string>

const ALL3: StemLevel[] = ['tieuhoc', 'thcs', 'thpt']
export const DEFAULT_TRACKS: StemTrack[] = [
  { code: 'CT1', name: 'Bài học STEM', title: 'Bài học STEM', description: 'Dạy bài học của một hoặc nhiều môn theo phương thức STEM, xuất phát từ yêu cầu cần đạt của môn và SGK.',
    subjects: ['Toán', 'Tự nhiên và Xã hội', 'Khoa học', 'Khoa học tự nhiên', 'Vật lí', 'Hóa học', 'Sinh học'], levels: ALL3, sort: 1,
    edu_activity: 'chinh_khoa', school_pick_topics: true, school_arrange_ppct: true, schedule_mode: 'subject' },
  { code: 'CT2', name: 'Trải nghiệm STEM cơ bản', title: 'Trải nghiệm STEM cơ bản', description: 'Chủ đề, dự án trải nghiệm STEM tiếp nối, mở rộng bài học STEM ở mức vận dụng.',
    subjects: [], levels: ALL3, sort: 2, edu_activity: 'tang_cuong', school_pick_topics: false, school_arrange_ppct: true, schedule_mode: 'timetable' },
  { code: 'CT3', name: 'Trải nghiệm STEM nâng cao', title: 'Trải nghiệm STEM nâng cao', description: 'Giáo dục STEM về lập trình, robot, AI, IoT và giáo dục STEM ngoài nhà trường.',
    subjects: [], levels: ALL3, sort: 3, edu_activity: 'theo_nhu_cau', school_pick_topics: false, school_arrange_ppct: true, schedule_mode: 'register' },
  { code: 'CT4', name: 'Nghiên cứu khoa học, kĩ thuật', title: 'Nghiên cứu khoa học, kĩ thuật', description: 'Đề tài, dự án nghiên cứu khoa học của cá nhân hoặc nhóm, có giáo viên / nhà khoa học hướng dẫn.',
    subjects: [], levels: ALL3, sort: 4, edu_activity: 'theo_nhu_cau', school_pick_topics: false, school_arrange_ppct: true, schedule_mode: 'subject' },
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

// Màu của từng loại: CT1–CT4 giữ màu cũ (CT5 cũ để màu cho dữ liệu chưa chuyển), loại thêm sau lấy màu theo mã (ổn định giữa các lần mở)
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

/** Danh mục loại chương trình dùng chung trong phiên; `reload()` sau khi sửa để tất cả màn cập nhật.
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
