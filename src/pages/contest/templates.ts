// Mẫu cuộc thi (migration 051). KHKT: theo hướng dẫn cuộc thi Khoa học kỹ thuật dành cho học sinh trung học của Bộ GD&ĐT —
// đơn vị tổ chức đối chiếu và chỉnh lĩnh vực / hồ sơ / tiêu chí theo văn bản hướng dẫn của năm học hiện hành.
export type Doc = { key: string; label: string; required: boolean }
export type Crit = { key: string; label: string; max: number }
export type Template = { key: 'khkt' | 'stem' | 'custom'; label: string; fields: string[]; docs: Doc[]; criteria: Crit[]; max_members: number; abstract_words: number | null; grades: string[] }

export const KHKT_FIELDS = [
  'Khoa học động vật', 'Khoa học xã hội và hành vi', 'Hoá sinh', 'Y sinh và khoa học sức khoẻ', 'Kỹ thuật y sinh', 'Sinh học tế bào và phân tử',
  'Hoá học', 'Sinh học trên máy tính và Sinh – Tin', 'Khoa học Trái đất và môi trường', 'Hệ thống nhúng', 'Năng lượng: Vật lý', 'Kỹ thuật cơ khí',
  'Kỹ thuật môi trường', 'Khoa học vật liệu', 'Toán học', 'Vi sinh', 'Vật lý và thiên văn', 'Khoa học thực vật', 'Rô bốt và máy thông minh',
  'Phần mềm hệ thống', 'Y học chuyển dịch', 'Năng lượng: Hoá học',
]
export const STEM_FIELDS = ['Robotics & AI', 'Điện tử & IoT', 'Năng lượng & môi trường', 'Nông nghiệp thông minh', 'Đời sống & sức khoẻ', 'Lập trình & ứng dụng', 'Khác']

export const TEMPLATES: Record<string, Template> = {
  khkt: { key: 'khkt', label: 'Khoa học kỹ thuật (KHKT) — mẫu Bộ GD&ĐT', fields: KHKT_FIELDS, max_members: 2, abstract_words: 250, grades: ['thcs', 'thpt'],
    docs: [
      { key: 'register', label: 'Phiếu đăng ký dự thi', required: true },
      { key: 'plan', label: 'Kế hoạch nghiên cứu', required: true },
      { key: 'report', label: 'Báo cáo kết quả nghiên cứu', required: true },
      { key: 'logbook', label: 'Sổ tay nghiên cứu (nhật ký)', required: true },
      { key: 'mentor', label: 'Phiếu thông tin người hướng dẫn', required: true },
      { key: 'safety', label: 'Phiếu đánh giá rủi ro / an toàn (nếu có đối tượng con người, động vật, hoá chất…)', required: false },
      { key: 'poster', label: 'Poster trình bày', required: false },
    ],
    criteria: [
      { key: 'question', label: 'Câu hỏi / vấn đề nghiên cứu', max: 10 },
      { key: 'method', label: 'Kế hoạch & phương pháp nghiên cứu (thiết kế)', max: 15 },
      { key: 'execution', label: 'Tiến hành nghiên cứu: thu thập, phân tích, giải thích dữ liệu', max: 20 },
      { key: 'creativity', label: 'Tính sáng tạo', max: 20 },
      { key: 'poster', label: 'Trình bày poster', max: 10 },
      { key: 'interview', label: 'Phỏng vấn', max: 25 },
    ] },
  stem: { key: 'stem', label: 'STEM / Robotics (KDI)', fields: STEM_FIELDS, max_members: 5, abstract_words: 300, grades: [],
    docs: [
      { key: 'video', label: 'Video giới thiệu / chạy thử sản phẩm', required: true },
      { key: 'report', label: 'Bản thuyết minh sản phẩm', required: true },
      { key: 'slides', label: 'Slide thuyết trình', required: false },
      { key: 'code', label: 'Mã nguồn / bản vẽ thiết kế', required: false },
    ],
    criteria: [
      { key: 'idea', label: 'Ý tưởng & tính ứng dụng thực tế', max: 25 },
      { key: 'design', label: 'Thiết kế kỹ thuật & quy trình STEM', max: 25 },
      { key: 'product', label: 'Sản phẩm hoạt động, độ hoàn thiện', max: 25 },
      { key: 'pitch', label: 'Thuyết trình & làm việc nhóm', max: 25 },
    ] },
  custom: { key: 'custom', label: 'Tự cấu hình', fields: [], max_members: 3, abstract_words: null, grades: [],
    docs: [{ key: 'report', label: 'Báo cáo / thuyết minh', required: true }], criteria: [{ key: 'overall', label: 'Đánh giá chung', max: 100 }] },
}
export const LEVEL: Record<string, string> = { mamnon: 'Mầm non', tieuhoc: 'Tiểu học', thcs: 'THCS', thpt: 'THPT' }
export const ORG_LEVEL: Record<string, string> = { school: 'Cấp trường', district: 'Cấp Phòng', department: 'Cấp tỉnh (Sở)', province: 'Cấp tỉnh', ministry: 'Toàn quốc', provider: 'KDI' }
export const words = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/).filter(Boolean).length
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
