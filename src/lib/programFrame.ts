import { supabase } from './supabase'

// Khung chương trình mới (migration 147): Loại chương trình (stem_tracks) → Học phần (program_modules, dùng chung cho
// nhiều gói, nhiều khối) → Chủ đề (program_topics, mỗi chủ đề thuộc một khối). Nội dung của chủ đề (kế hoạch giảng dạy,
// bài giảng, phiếu học tập, bài kiểm tra, vật tư, kho học liệu) và phiên bản làm ở bước sau. Chỉ KDI sửa; mọi người xem.
export type ProgramModule = { id: string; track_code: string; name: string; description: string; sort: number; active: boolean; periods?: number | null; updated_at?: string }
export type ProgramTopic = {
  id: string; module_id: string; grade: number; seq: number; code: string | null; title: string; periods: number
  objectives: string; main_subject: string | null; subjects: string[]; textbook_ref: string; product?: string; active: boolean; updated_at?: string
  /** 160: chủ đề thuộc phần nào khi gói dùng học phần này ở nhiều vị trí (1 = HP1, 2 = HP2); trống = dùng chung */
  part?: number | null
}
export type MaterialGroup = { id: string; name: string; description: string; sort: number; active: boolean; updated_at?: string }

export const frameErr = (m: string) => (/schema cache|does not exist|relation .* does not exist/i.test(m) ? 'Hãy chạy migration 147–150 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được khung chương trình.'
  : /23503|foreign key/i.test(m) ? 'Mục này còn dữ liệu bên trong (học phần còn chủ đề) nên chưa xoá được — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Tên này đã có.'
  : /Học phần không thuộc/i.test(m) ? 'Học phần không thuộc loại chương trình này.'
  : /check/i.test(m) ? 'Dữ liệu chưa hợp lệ (tên quá dài, số tiết 0–200, thứ tự 1–999).' : m)

export async function loadFrame() {
  const [m, t] = await Promise.all([
    supabase.from('program_modules').select('*').order('track_code').order('sort').order('name'),
    supabase.from('program_topics').select('*').order('grade').order('seq'),
  ])
  const error = m.error ?? t.error
  return { modules: (m.data ?? []) as ProgramModule[], topics: (t.data ?? []) as ProgramTopic[], error: error ? frameErr(error.message + ' ' + (error.code ?? '')) : '' }
}

// Gói STEM theo khung chương trình (148): gói × loại chương trình × khối × vị trí học phần
export type ProgramPackage = { id: string; code: string; name: string; description: string; sort: number; active: boolean; updated_at?: string }
export type PackageItem = { package_id: string; track_code: string; grade: number; slot: number; module_id: string; note: string }

export async function loadPackages() {
  const [p, i] = await Promise.all([
    supabase.from('program_packages').select('*').order('sort').order('code'),
    supabase.from('program_package_items').select('package_id, track_code, grade, slot, module_id, note'),
  ])
  const error = p.error ?? i.error
  return { packages: (p.data ?? []) as ProgramPackage[], items: (i.data ?? []) as PackageItem[], error: error ? frameErr(error.message + ' ' + (error.code ?? '')) : '' }
}

/** Chủ đề của một vị trí học phần trong gói (160). Học phần dùng ở nhiều vị trí của cùng khối (VD Gói 1T: HP1 và HP2 đều là Sáng chế)
 *  thì vị trí thứ k lấy chủ đề ghi phần k; chủ đề không ghi phần (dùng chung) vị trí nào cũng lấy. Khối chưa chia phần thì lấy hết. */
export function slotTopics(topics: ProgramTopic[], items: PackageItem[], it: PackageItem | undefined): ProgramTopic[] {
  if (!it) return []
  const all = topics.filter(t => t.module_id === it.module_id && t.grade === it.grade && t.active).sort((a, b) => a.seq - b.seq)
  if (!all.some(t => t.part)) return all
  const k = items.filter(i => i.package_id === it.package_id && i.track_code === it.track_code && i.grade === it.grade && i.module_id === it.module_id && i.slot <= it.slot).length || 1
  return all.filter(t => !t.part || t.part === k)
}
