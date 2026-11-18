import { supabase } from './supabase'

// Khung chương trình mới (migration 147): Loại chương trình (stem_tracks) → Học phần (program_modules, dùng chung cho
// nhiều gói, nhiều khối) → Chủ đề (program_topics, mỗi chủ đề thuộc một khối). Nội dung của chủ đề (kế hoạch giảng dạy,
// bài giảng, phiếu học tập, bài kiểm tra, vật tư, kho học liệu) và phiên bản làm ở bước sau. Chỉ KDI sửa; mọi người xem.
export type ProgramModule = { id: string; track_code: string; name: string; description: string; sort: number; active: boolean; updated_at?: string }
export type ProgramTopic = {
  id: string; module_id: string; grade: number; seq: number; code: string | null; title: string; periods: number
  objectives: string; main_subject: string | null; subjects: string[]; textbook_ref: string; active: boolean; updated_at?: string
}
export type MaterialGroup = { id: string; name: string; description: string; sort: number; active: boolean; updated_at?: string }

export const frameErr = (m: string) => (/schema cache|does not exist|relation .* does not exist/i.test(m) ? 'Hãy chạy migration 147 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được khung chương trình.'
  : /23503|foreign key/i.test(m) ? 'Mục này còn dữ liệu bên trong (học phần còn chủ đề) nên chưa xoá được — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Tên này đã có.'
  : /check/i.test(m) ? 'Dữ liệu chưa hợp lệ (tên quá dài, số tiết 0–200, thứ tự 1–999).' : m)

export async function loadFrame() {
  const [m, t] = await Promise.all([
    supabase.from('program_modules').select('*').order('track_code').order('sort').order('name'),
    supabase.from('program_topics').select('*').order('grade').order('seq'),
  ])
  const error = m.error ?? t.error
  return { modules: (m.data ?? []) as ProgramModule[], topics: (t.data ?? []) as ProgramTopic[], error: error ? frameErr(error.message + ' ' + (error.code ?? '')) : '' }
}
