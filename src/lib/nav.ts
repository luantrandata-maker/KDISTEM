export type RoleKey = 'school_admin' | 'teacher' | 'student' | 'department' | 'platform'
export type NavGroup = { title: string; items: string[] }

export const ROLE_LABEL: Record<RoleKey, string> = {
  school_admin: 'Trường · Quản trị', teacher: 'Giáo viên',
  student: 'Học sinh', department: 'Sở GD&ĐT', platform: 'Quản trị nền tảng',
}

export const NAV: Record<RoleKey, NavGroup[]> = {
  // Cổng Quản trị nền tảng, theo phương án C (16/10): Vận hành KDI · Lõi · 5 phân hệ nghiệp vụ (đơn vị bán) · Nền tảng kỹ thuật.
  // Mục chưa có trang thật hiện khung giao diện (pages/platform/Planned.tsx).
  platform: [
    { title: 'Tổng quan', items: ['Tổng quan hệ thống', 'Sơ đồ hệ thống', 'Thuật ngữ chuẩn'] },
    { title: 'Vận hành KDI', items: ['Thông tin khách hàng', 'Gói dịch vụ & hợp đồng', 'Đơn đặt gói STEM', 'Triển khai khách hàng', 'Vấn đề & phản hồi', 'Nghiệm thu & doanh thu'] },
    { title: 'Lõi · Tổ chức & quy trình', items: ['Cây tổ chức', 'Cơ sở giáo dục', 'Người dùng & vai trò', 'Lời mời', 'Hộp phê duyệt', 'Quy trình phê duyệt', 'Thông báo'] },
    { title: 'PH1. Đào tạo & năng lực nhà giáo', items: ['Kế hoạch tập huấn', 'Lịch tập huấn', 'Giám sát tập huấn nhà giáo', 'Nhà giáo & trợ giảng', 'Đánh giá năng lực giáo viên', 'Hồ sơ năng lực, đào tạo'] },
    { title: 'PH2. Chương trình & học liệu', items: ['Chương trình giáo dục', 'Phát hành học liệu', 'Kho học liệu dùng chung', 'Theo dõi chương trình CT1–CT5', 'Theo dõi môn học STEM', 'E-learning & luyện thi'] },
    { title: 'PH3. Vật tư, thiết bị & phòng STEM', items: ['Phòng STEM & lịch phòng', 'Hiệu quả phòng STEM', 'Thiết bị, vật tư & kho', 'Mua hàng & đề xuất vật tư', 'Kiểm kê', 'Vận chuyển vật tư'] },
    { title: 'PH4. Vận hành giảng dạy & đánh giá người học', items: ['Thời khoá biểu & xếp lịch', 'Buổi dạy & điểm danh', 'Đánh giá kết quả học tập', 'Người học', 'Cổng người học & phụ huynh', 'Sự kiện'] },
    { title: 'PH5. Điều hành & báo cáo', items: ['Dashboard điểm danh', 'Báo cáo vận hành', 'KPI & xếp hạng', 'Báo cáo cấp trên (Bộ/Sở)', 'Chỉ tiêu & bộ chỉ số', 'Cảnh báo & so sánh trường', 'Khảo sát'] },
    { title: 'Nền tảng kỹ thuật', items: ['Tích hợp & dữ liệu', 'Ứng dụng di động & ngoại tuyến', 'Sao lưu & xuất dữ liệu', 'Bảo mật tài khoản', 'Nhật ký hệ thống', 'Cấu hình chung (năm học)', 'Giao diện & thương hiệu', 'Trợ lý AI'] },
  ],
  school_admin: [
    { title: 'Tổng quan', items: ['Dashboard Trường', 'Hồ sơ Trường học'] },
    { title: 'Phê duyệt', items: ['Hộp phê duyệt', 'Quy trình phê duyệt'] },
    { title: 'Mua sắm gói STEM', items: ['Gói STEM', 'Đề xuất mua gói'] },
    { title: 'Học liệu', items: ['Kho học liệu dùng chung', 'Phát hành học liệu'] },
    { title: 'Nhân sự & Đồng bộ K12', items: ['Giáo viên', 'Phân công giảng dạy', 'Lớp học', 'Học sinh'] },
    { title: 'Phòng STEM', items: ['Quản lý Phòng STEM', 'Quản lý Thiết bị', 'Bảo hành thiết bị'] },
    { title: 'Kế hoạch GD & TKB', items: ['Kế hoạch GD toàn trường', 'Duyệt đăng ký dạy STEM', 'Thời khóa biểu', 'Phân công GV dạy STEM', 'Buổi dạy & điểm danh', 'Dashboard điểm danh'] },
    { title: 'Tập huấn GV', items: ['Kế hoạch tập huấn', 'Lịch tập huấn', 'Bài giảng', 'Lớp học ảo', 'Chứng chỉ'] },
    { title: 'Quản lý khai báo', items: ['Năm học & học kỳ', 'Tòa nhà & Tầng', 'Cấu hình tiết học', 'Phân phối chương trình'] },
    { title: 'Quản trị', items: ['Tài khoản', 'Vai trò và phân quyền', 'Hỗ trợ từ KDI'] },
  ],
  teacher: [
    { title: 'Giảng dạy', items: ['Tổng quan', 'Kế hoạch giáo dục', 'Lớp giảng dạy', 'Điểm danh', 'Bài tập', 'Chấm bài'] },
    { title: 'Hoạt động STEM', items: ['Giáo dục STEM', 'Đặt phòng STEM'] },
    { title: 'Soạn giảng', items: ['Soạn bài giảng', 'Kho hoạt động & Bài giảng', 'Thư viện STEM'] },
    { title: 'Khác', items: ['Hộp phê duyệt', 'Học trước & tự học', 'Lịch tập huấn', 'Bài giảng tập huấn', 'Hỗ trợ từ KDI'] },
  ],
  student: [
    { title: 'Học tập', items: ['Tổng quan', 'Bài tập', 'Lịch học', 'Giáo dục STEM', 'Chủ đề'] },
  ],
  department: [
    { title: 'Tổng quan', items: ['Dashboard toàn Sở', 'KPI & Xếp hạng Xã/Phường', 'Danh sách Trường', 'Dashboard điểm danh'] },
    { title: 'Theo dõi STEM', items: ['Chương trình CT1–CT5', 'Theo dõi Môn học STEM', 'Giám sát Tập huấn GV'] },
    { title: 'Tập huấn STEM', items: ['Kế hoạch tập huấn', 'Lịch tập huấn'] },
    { title: 'Học liệu STEM', items: ['Phát hành học liệu', 'Kho học liệu dùng chung'] },
    { title: 'Phòng & Thiết bị STEM', items: ['Hiệu quả Phòng STEM'] },
    { title: 'Báo cáo & Điều hành', items: ['Hộp phê duyệt', 'Quy trình phê duyệt', 'Báo cáo Bộ GD&ĐT', 'Điều hành & Cấu hình', 'Hỗ trợ từ KDI'] },
  ],
}

// Mục menu của vai trò Trường – Quản trị → chức năng trong ma trận phân quyền
export const MODULE_OF: Record<string, string> = {
  'Giáo viên': 'teachers', 'Lớp học': 'classes', 'Học sinh': 'students', 'Phân công giảng dạy': 'assignments',
  'Quản lý Phòng STEM': 'stem_rooms', 'Quản lý Thiết bị': 'equipment', 'Bảo hành thiết bị': 'warranty',
  'Thời khóa biểu': 'timetable', 'Duyệt đăng ký dạy STEM': 'stem_registrations', 'Tòa nhà & Tầng': 'buildings',
  'Cấu hình tiết học': 'periods', 'Năm học & học kỳ': 'periods', 'Tài khoản': 'accounts', 'Vai trò và phân quyền': 'roles',
  'Kế hoạch GD toàn trường': 'edu_plan', 'Phân công GV dạy STEM': 'stem_assign', 'Phân phối chương trình': 'curriculum',
  'Gói STEM': 'packages', 'Kế hoạch tập huấn': 'training', 'Lịch tập huấn': 'training', 'Bài giảng': 'training',
  'Lớp học ảo': 'training', 'Chứng chỉ': 'training',
  'Kho học liệu dùng chung': 'library', 'Phát hành học liệu': 'library',
  'Hộp phê duyệt': 'approvals', 'Quy trình phê duyệt': 'roles', 'Đề xuất mua gói': 'packages',
  'Buổi dạy & điểm danh': 'timetable', 'Dashboard điểm danh': 'timetable',
}
// Vai trò → giao diện: lưu ở cột roles.portal (vai trò hệ thống và vai trò tuỳ chỉnh của trường).

// Mục menu (mọi giao diện trừ Quản trị nền tảng) → chức năng dùng để kiểm tra gói dịch vụ (migration 024).
// Mục không có ở đây là phần lõi, luôn hiện.
export const ENT_MODULE_OF: Record<string, string> = {
  ...MODULE_OF, 'Quy trình phê duyệt': 'approvals',
  'Đặt phòng STEM': 'stem_rooms', 'Thư viện STEM': 'library', 'Kho hoạt động & Bài giảng': 'library',
  'Lịch tập huấn': 'training', 'Bài giảng tập huấn': 'training', 'Kế hoạch tập huấn': 'training', 'Giám sát Tập huấn GV': 'training',
  'Kế hoạch giáo dục': 'edu_plan', 'Hiệu quả Phòng STEM': 'stem_rooms',
  'Điểm danh': 'timetable',
}
