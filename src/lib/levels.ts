// Tên hiển thị các mức (Thiết lập chung › Danh mục, hoặc ngay trong Khung năng lực): KDI đổi tên, số mức cố định là 4
// vì dữ liệu đã lưu theo mã (mức độ câu hỏi) và theo số 1–4 (mức năng lực).
// Các bảng tên dùng chung trong mã được cập nhật tại chỗ khi thiết lập tải xong, nên mọi trang đang dùng chúng đổi theo.
import { codedCatalog, type Settings } from './settings'
import { LEVEL } from '../pages/elearning/common'
import { LEVELS } from '../components/ExamMatrix'
import { LV_NAME, SLV_NAME } from '../pages/competency'

export const Q_LEVEL_BASE: Record<string, string> = { nhan_biet: 'Nhận biết', thong_hieu: 'Thông hiểu', van_dung: 'Vận dụng', van_dung_cao: 'Vận dụng cao' }
export const T_LEVEL_BASE: Record<string, string> = { '1': 'Chưa đạt', '2': 'Đạt', '3': 'Khá', '4': 'Tốt' }
export const S_LEVEL_BASE: Record<string, string> = { '1': 'Mức 1', '2': 'Mức 2', '3': 'Mức 3', '4': 'Mức 4' }
export const LEVEL_CATALOGS = [
  { key: 'q_level', name: 'Mức độ câu hỏi', note: 'Đổi tên 4 mức độ của câu hỏi, đề và ma trận đề (mức độ gắn với dữ liệu nên không thêm / xoá).', coded: Q_LEVEL_BASE },
  { key: 'comp_level_teacher', name: 'Mức năng lực giáo viên', note: 'Tên 4 mức của khung năng lực giáo viên (đánh giá, năng lực đích của tập huấn).', coded: T_LEVEL_BASE },
  { key: 'comp_level_student', name: 'Mức năng lực học sinh', note: 'Tên 4 mức của khung năng lực học sinh.', coded: S_LEVEL_BASE },
]

/** Áp tên mức theo thiết lập (gọi ở gốc ứng dụng mỗi lần thiết lập đổi). */
export function applyLevelLabels(s: Settings) {
  const q = Object.fromEntries(codedCatalog(s, 'q_level', Q_LEVEL_BASE))
  Object.assign(LEVEL, q)
  LEVELS.forEach(l => { l[1] = q[l[0]] ?? l[1] })
  const lab = (key: string, base: Record<string, string>) => { const m = Object.fromEntries(codedCatalog(s, key, base)); return ['1', '2', '3', '4'].map(k => m[k] ?? base[k]) }
  lab('comp_level_teacher', T_LEVEL_BASE).forEach((x, i) => { LV_NAME[i] = x })
  lab('comp_level_student', S_LEVEL_BASE).forEach((x, i) => { SLV_NAME[i] = x })
}
