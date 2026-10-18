import { supabase } from '../../lib/supabase'
import type { QuizItem } from '../ai'

// E-learning & luyện thi (migration 053) — kiểu dữ liệu và hàm dùng chung
export type Level = 'nhan_biet' | 'thong_hieu' | 'van_dung' | 'van_dung_cao'
export type QKind = 'single' | 'multi' | 'truefalse'
export type Question = { id: string; org_id: string; created_by: string | null; subject: string; grade: number | null; topic: string | null; level: Level; kind: QKind
  stem: string; options: string[]; answer: number[]; explain: string | null; source: string; shared: boolean; status: 'draft' | 'ready' | 'retired'; created_at: string }
export type Exam = { id: string; org_id: string; created_by: string | null; title: string; description: string | null; subject: string | null; grade: number | null
  mode: 'fixed' | 'random'; question_ids: string[]; criteria: { count?: number; topics?: string[]; levels?: Partial<Record<Level, number>> }
  duration_min: number | null; max_attempts: number; show_answers: 'after_submit' | 'after_close' | 'never'; class_ids: string[] | null; shared: boolean
  opens_at: string; closes_at: string | null; status: 'draft' | 'published' | 'closed'; created_at: string }
export type Course = { id: string; org_id: string; created_by: string | null; title: string; description: string | null; subject: string | null; grade: number | null
  cover_url: string | null; class_ids: string[] | null; shared: boolean; status: 'draft' | 'published' | 'archived'; created_at: string }
export type Lesson = { id: string; course_id: string; position: number; title: string; kind: 'video' | 'reading' | 'link' | 'exam'; url: string | null; body: string | null; exam_id: string | null; duration_min: number | null }
export type Attempt = { id: string; exam_id: string; student_id: string; org_id: string; started_at: string; submitted_at: string | null; status: string; correct: number | null; total: number | null; score: number | null; late: boolean }

export const LEVEL: Record<Level, string> = { nhan_biet: 'Nhận biết', thong_hieu: 'Thông hiểu', van_dung: 'Vận dụng', van_dung_cao: 'Vận dụng cao' }
export const QKIND: Record<QKind, string> = { single: 'Một đáp án', multi: 'Nhiều đáp án', truefalse: 'Đúng / sai' }
export const SHOW: Record<Exam['show_answers'], string> = { after_submit: 'Ngay sau khi nộp', after_close: 'Sau khi đóng đề', never: 'Không hiện' }
export const ESTATUS: Record<string, [string, string]> = { draft: ['Nháp', ''], published: ['Đang mở', 'active'], closed: ['Đã đóng', 'inactive'], archived: ['Lưu trữ', 'inactive'] }
export const LKIND: Record<Lesson['kind'], string> = { video: 'Video', reading: 'Bài đọc', link: 'Liên kết', exam: 'Đề luyện' }
export const letter = (i: number) => String.fromCharCode(65 + i)
export const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 053 trên Supabase.' : /row-level|42501/i.test(m) ? 'Bạn không có quyền với nội dung này.' : m)

// Mức độ AI trả về (chữ) → mã
export function levelOf(s: string | null | undefined): Level {
  const t = (s ?? '').toLowerCase()
  return t.includes('cao') ? 'van_dung_cao' : t.includes('vận dụng') || t.includes('van dung') ? 'van_dung' : t.includes('nhận biết') || t.includes('nhan biet') ? 'nhan_biet' : 'thong_hieu'
}

// Lưu câu hỏi do Trợ lý AI tạo vào ngân hàng của đơn vị
export async function saveQuizToBank(orgId: string | null, items: QuizItem[], meta: { subject: string; grade: string; topic: string }) {
  if (!orgId) throw new Error('Chưa xác định đơn vị')
  const grade = Number(String(meta.grade).replace(/\D/g, '')) || null
  const rows = items.map(it => ({ org_id: orgId, subject: meta.subject.trim() || 'STEM', grade: grade && grade <= 12 ? grade : null, topic: meta.topic.trim().slice(0, 200) || null,
    level: levelOf(it.level), kind: 'single', stem: it.q, options: it.options, answer: [it.answer], explain: it.explain || null, source: 'ai', status: 'draft' }))
  const { error } = await supabase.from('question_bank').insert(rows)
  if (error) throw new Error(errText(error.message))
  return `Đã lưu ${rows.length} câu vào ngân hàng (trạng thái Nháp — duyệt lại rồi chuyển "Sẵn sàng" để đưa vào đề).`
}

// Đường dẫn video → bản nhúng (YouTube / Vimeo / Google Drive); khác → null (mở tab mới)
export function embedUrl(url: string | null) {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  const gd = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)
  if (gd) return `https://drive.google.com/file/d/${gd[1]}/preview`
  return null
}
