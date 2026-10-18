// Từ điển dữ liệu dùng chung ngành GDĐT — QĐ 2768/QĐ-BGDĐT ngày 18/9/2026 (Phiên bản 1.0).
// Nội dung từ điển (41 miền dữ liệu, 892 thuật ngữ) nằm ở public/standards/qd2768-v1.json — trích từ Phụ lục 01, 02 của quyết định.
// Bảng đối chiếu bên dưới: trường dữ liệu của KSCHOOL STEM ↔ mã thuật ngữ của Bộ. Cập nhật khi thêm trường dữ liệu mới.

export type Domain = { code: string; level: number; group: string | null; name: string; parent: string | null; desc: string; unit: string; owner: string }
export type Term = { code: string; name: string; def: string; ctx: string; dom: string[]; tech: string; tvi: string; type: string; len: number | null; cde: string | null }
export type Dictionary = { source: string; version: string; decision: { no: string; date: string; signer: string; title: string }; domains: Domain[]; terms: Term[] }

let cache: Promise<Dictionary> | null = null
export function loadDictionary(): Promise<Dictionary> {
  cache ??= fetch('/standards/qd2768-v1.json').then(r => { if (!r.ok) throw new Error('Không tải được từ điển dữ liệu'); return r.json() })
  cache.catch(() => { cache = null })
  return cache
}

// khop: cùng nghĩa, cùng kiểu · gan: cùng nghĩa, khác định dạng / danh mục (cần chuyển đổi khi trao đổi)
// tinh: suy ra được từ dữ liệu hệ thống (tổng hợp) · thieu: thuật ngữ quan trọng hệ thống chưa lưu · rieng: dữ liệu riêng, Bộ chưa có thuật ngữ
export type MapStatus = 'khop' | 'gan' | 'tinh' | 'thieu' | 'rieng'
export type Mapping = { entity: string; field: string; source: string; term: string | null; status: MapStatus; note?: string }

export const MAP_STATUS: Record<MapStatus, [string, string]> = {
  khop: ['Khớp', 'active'], gan: ['Tương đương', 'maintenance'], tinh: ['Tính được', 'active'],
  thieu: ['Chưa lưu', 'inactive'], rieng: ['Riêng hệ thống', ''],
}

const NO_PII = 'Chưa thu thập, theo nguyên tắc tối thiểu hoá dữ liệu cá nhân của trẻ em. Bổ sung khi liên thông CSDL ngành.'

export const MAPPINGS: Mapping[] = [
  // ---- Cơ sở giáo dục ----
  { entity: 'Cơ sở giáo dục', field: 'Tên trường', source: 'organizations.name', term: 'BG_00421', status: 'khop' },
  { entity: 'Cơ sở giáo dục', field: 'Mã trường', source: 'organizations.code', term: 'BG_00419', status: 'gan', note: 'Mã nội bộ do KDI cấp. Nên nhập đúng mã định danh cơ sở giáo dục (15 ký tự) trên CSDL ngành để liên thông.' },
  { entity: 'Cơ sở giáo dục', field: 'Cấp học', source: 'organizations.level', term: 'BG_00422', status: 'khop', note: 'Mầm non / Tiểu học / THCS / THPT.' },
  { entity: 'Cơ sở giáo dục', field: 'Sở GD&ĐT quản lý', source: 'organizations.parent_id', term: 'BG_00417', status: 'gan', note: 'Lấy từ cây tổ chức (đơn vị cha cấp Sở).' },
  { entity: 'Cơ sở giáo dục', field: 'Xã / phường', source: 'organizations.ward', term: 'BG_00427', status: 'gan', note: 'Đang lưu tên; chuẩn yêu cầu mã đơn vị hành chính theo QĐ 19/2025/QĐ-TTg.' },
  { entity: 'Cơ sở giáo dục', field: 'Địa chỉ', source: 'organizations.address', term: 'BG_00428', status: 'khop' },
  { entity: 'Cơ sở giáo dục', field: 'Toạ độ bản đồ', source: 'organizations.lat, lng', term: 'BG_00439', status: 'gan', note: 'Lưu hai cột số; chuẩn là một chuỗi vị trí.' },
  { entity: 'Cơ sở giáo dục', field: 'Điện thoại liên hệ', source: 'organizations.contact_phone', term: 'BG_00435', status: 'gan', note: 'Là số người liên hệ với KDI, chưa chắc là số của trường.' },
  { entity: 'Cơ sở giáo dục', field: 'Email liên hệ', source: 'organizations.contact_email', term: 'BG_00436', status: 'gan', note: 'Như trên.' },
  { entity: 'Cơ sở giáo dục', field: 'Loại hình (công lập / tư thục)', source: '—', term: 'BG_00429', status: 'thieu' },
  { entity: 'Cơ sở giáo dục', field: 'Tỉnh / thành phố', source: 'organizations (Sở cha)', term: 'BG_00426', status: 'tinh', note: 'Suy ra từ Sở / tỉnh quản lý.' },
  // ---- Lớp & năm học ----
  { entity: 'Lớp & năm học', field: 'Tên lớp', source: 'classes.name', term: 'BG_00505', status: 'khop' },
  { entity: 'Lớp & năm học', field: 'Khối', source: 'classes.grade', term: 'BG_00506', status: 'gan', note: 'Lưu số (1–12); chuẩn là danh mục khối.' },
  { entity: 'Lớp & năm học', field: 'Giáo viên chủ nhiệm', source: 'classes.homeroom_teacher_id', term: 'BG_00311', status: 'gan', note: 'Lưu liên kết tới giáo viên; chuẩn là tên giáo viên.' },
  { entity: 'Lớp & năm học', field: 'Năm học', source: 'academic_years.name', term: 'BG_00821', status: 'khop', note: 'Dạng 2026-2027.' },
  { entity: 'Lớp & năm học', field: 'Mã lớp', source: '—', term: 'BG_00504', status: 'thieu', note: 'Hệ thống dùng tên lớp làm định danh trong trường.' },
  // ---- Người học ----
  { entity: 'Người học', field: 'Họ và tên', source: 'students.full_name', term: 'BG_00007', status: 'khop' },
  { entity: 'Người học', field: 'Trạng thái học tập', source: 'students.status', term: 'BG_00090', status: 'gan', note: 'Đang học / Chuyển trường / Đã tốt nghiệp — cần ánh xạ sang danh mục trạng thái của Bộ.' },
  { entity: 'Người học', field: 'Mã học sinh', source: 'students.student_code', term: null, status: 'rieng', note: 'Mã do trường đặt. Bộ dùng số định danh cá nhân / mã hồ sơ học tập suốt đời.' },
  { entity: 'Người học', field: 'Số buổi nghỉ có phép', source: 'lesson_attendance (excused)', term: 'BG_00106', status: 'tinh', note: 'Đếm từ điểm danh buổi học STEM, không phải toàn bộ ngày học.' },
  { entity: 'Người học', field: 'Số buổi nghỉ không phép', source: 'lesson_attendance (absent)', term: 'BG_00107', status: 'tinh', note: 'Như trên.' },
  { entity: 'Người học', field: 'Năng lực tự chủ và tự học', source: 'competencies: tu_chu', term: 'BG_00115', status: 'gan', note: 'Thang M1–M4 của KDI; Bộ dùng mức đánh giá theo thông tư đánh giá.' },
  { entity: 'Người học', field: 'Năng lực giao tiếp và hợp tác', source: 'competencies: giao_tiep', term: 'BG_00116', status: 'gan', note: 'Như trên.' },
  { entity: 'Người học', field: 'Năng lực giải quyết vấn đề và sáng tạo', source: 'competencies: gqvd', term: 'BG_00117', status: 'gan', note: 'Như trên.' },
  { entity: 'Người học', field: 'Năng lực toán học', source: 'competencies: toan_hoc', term: 'BG_00119', status: 'gan', note: 'Bộ gọi là "năng lực tính toán".' },
  { entity: 'Người học', field: 'Năng lực khoa học', source: 'competencies: khoa_hoc', term: 'BG_00120', status: 'gan' },
  { entity: 'Người học', field: 'Năng lực công nghệ', source: 'competencies: cong_nghe', term: 'BG_00121', status: 'gan' },
  { entity: 'Người học', field: 'Năng lực tin học', source: 'competencies: tin_hoc', term: 'BG_00122', status: 'gan' },
  { entity: 'Người học', field: 'Kết quả cuộc thi', source: 'competition_entries.award, rank', term: 'BG_00134', status: 'gan', note: 'Ghép tên cuộc thi + giải.' },
  { entity: 'Người học', field: 'Tên dự án / đề tài', source: 'student_projects.title', term: 'BG_00148', status: 'gan', note: 'Dự án STEM ~ đề tài nghiên cứu của người học.' },
  { entity: 'Người học', field: 'Mã hồ sơ dự thi', source: 'competition_entries.code', term: 'BG_00149', status: 'gan' },
  { entity: 'Người học', field: 'Ngày sinh', source: '—', term: 'BG_00009', status: 'thieu', note: NO_PII },
  { entity: 'Người học', field: 'Giới tính', source: '—', term: 'BG_00010', status: 'thieu', note: NO_PII + ' Khi thêm: dùng mã ISO/IEC 5218.' },
  { entity: 'Người học', field: 'Số định danh cá nhân', source: '—', term: 'BG_00011', status: 'thieu', note: NO_PII },
  { entity: 'Người học', field: 'Dân tộc', source: '—', term: 'BG_00027', status: 'thieu', note: NO_PII },
  // ---- Phụ huynh ----
  { entity: 'Phụ huynh', field: 'Họ tên cha / mẹ / người giám hộ', source: 'guardians.full_name + relation', term: 'BG_00031', status: 'gan', note: 'Bộ tách Tên cha (BG_00031), Tên mẹ (BG_00034), Tên người đỡ đầu (BG_00037); hệ thống lưu một danh sách kèm quan hệ.' },
  { entity: 'Phụ huynh', field: 'Số điện thoại phụ huynh', source: 'guardians.phone', term: null, status: 'rieng', note: 'Dùng để kích hoạt cổng phụ huynh và báo vắng.' },
  // ---- Nhà giáo ----
  { entity: 'Nhà giáo', field: 'Họ và tên', source: 'teachers.full_name', term: 'BG_00238', status: 'khop' },
  { entity: 'Nhà giáo', field: 'Email', source: 'teachers.email', term: 'BG_00257', status: 'khop' },
  { entity: 'Nhà giáo', field: 'Số điện thoại', source: 'profiles.phone', term: 'BG_00243', status: 'khop' },
  { entity: 'Nhà giáo', field: 'Bộ môn / môn dạy', source: 'teachers.subject, teaching_assignments.subject', term: 'BG_00297', status: 'gan', note: 'Lưu tên môn; chuẩn là mã môn dạy.' },
  { entity: 'Nhà giáo', field: 'Trạng thái', source: 'teachers.status', term: 'BG_00256', status: 'gan', note: 'Đang dạy / Ngừng — danh mục của Bộ chi tiết hơn (thai sản, đi học, biệt phái…).' },
  { entity: 'Nhà giáo', field: 'Mã định danh cán bộ / nhà giáo', source: '—', term: 'BG_00240', status: 'thieu', note: 'Có thể lấy khi đồng bộ K12 / CSDL ngành.' },
  { entity: 'Nhà giáo', field: 'Đánh giá năng lực dạy STEM', source: 'teacher_assessments', term: null, status: 'rieng', note: 'Khung năng lực STEM của KDI, khác đánh giá chuẩn nghề nghiệp (BG_00389).' },
  // ---- Tập huấn ----
  { entity: 'Tập huấn nhà giáo', field: 'Tên khoá tập huấn', source: 'training_plans.name', term: 'BG_00346', status: 'khop' },
  { entity: 'Tập huấn nhà giáo', field: 'Đơn vị tổ chức', source: 'training_plans.provider', term: 'BG_00347', status: 'khop' },
  { entity: 'Tập huấn nhà giáo', field: 'Hình thức', source: 'training_plans.mode', term: 'BG_00335', status: 'gan', note: 'Trực tuyến / trực tiếp / kết hợp.' },
  { entity: 'Tập huấn nhà giáo', field: 'Ngày bắt đầu', source: 'training_sessions.starts_at (buổi đầu)', term: 'BG_00333', status: 'tinh' },
  { entity: 'Tập huấn nhà giáo', field: 'Ngày kết thúc', source: 'training_sessions.ends_at (buổi cuối)', term: 'BG_00334', status: 'tinh' },
  { entity: 'Tập huấn nhà giáo', field: 'Chứng chỉ được cấp', source: 'certificates.code', term: 'BG_00350', status: 'khop' },
  { entity: 'Tập huấn nhà giáo', field: 'Ngày cấp chứng chỉ', source: 'certificates.issued_on', term: 'BG_00351', status: 'khop' },
  // ---- Cơ sở vật chất ----
  { entity: 'Phòng & thiết bị STEM', field: 'Tên phòng STEM', source: 'stem_rooms.name', term: 'BG_00575', status: 'gan', note: 'Phòng STEM xếp vào nhóm phòng / xưởng thực hành.' },
  { entity: 'Phòng & thiết bị STEM', field: 'Diện tích phòng', source: 'stem_rooms.area_m2', term: 'BG_00579', status: 'gan', note: 'Lưu số thập phân; chuẩn là số nguyên.' },
  { entity: 'Phòng & thiết bị STEM', field: 'Tên thiết bị', source: 'equipment_types.name', term: 'BG_00584', status: 'khop' },
  { entity: 'Phòng & thiết bị STEM', field: 'Hãng sản xuất', source: 'equipment_types.brand', term: 'BG_00588', status: 'khop' },
  { entity: 'Phòng & thiết bị STEM', field: 'Số lượng thiết bị', source: 'equipment_units (đếm)', term: 'BG_00585', status: 'tinh' },
  // ---- Chương trình ----
  { entity: 'Chương trình & học liệu', field: 'Môn học', source: 'curriculum_books.subject', term: 'BG_00818', status: 'gan', note: 'Lưu tên môn; chuẩn là danh mục môn học.' },
  { entity: 'Chương trình & học liệu', field: 'Gói / chương trình STEM (CT1–CT5)', source: 'stem_packages, class_programs', term: null, status: 'rieng' },
]
