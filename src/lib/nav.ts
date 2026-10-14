export type RoleKey = 'school_admin' | 'teacher' | 'student' | 'department'
export type NavGroup = { title: string; items: string[] }

export const ROLE_LABEL: Record<RoleKey, string> = {
  school_admin: 'Trường · Quản trị', teacher: 'Giáo viên',
  student: 'Học sinh', department: 'Sở GD&ĐT',
}

export const NAV: Record<RoleKey, NavGroup[]> = {
  school_admin: [
    { title: 'Tổng quan', items: ['Dashboard Trường', 'Hồ sơ Trường học'] },
    { title: 'Mua sắm gói STEM', items: ['Gói STEM'] },
    { title: 'Nhân sự & Đồng bộ K12', items: ['Giáo viên', 'Phân công giảng dạy', 'Lớp học', 'Học sinh'] },
    { title: 'Phòng STEM', items: ['Quản lý Phòng STEM', 'Quản lý Thiết bị', 'Bảo hành thiết bị'] },
    { title: 'Kế hoạch GD & TKB', items: ['Kế hoạch GD toàn trường', 'Duyệt đăng ký dạy STEM', 'Thời khóa biểu', 'Phân công GV dạy STEM'] },
    { title: 'Tập huấn GV', items: ['Kế hoạch tập huấn', 'Lịch tập huấn', 'Bài giảng', 'Lớp học ảo', 'Chứng chỉ'] },
    { title: 'Quản lý khai báo', items: ['Tòa nhà & Tầng', 'Cấu hình tiết học', 'Phân phối chương trình'] },
    { title: 'Quản trị', items: ['Tài khoản', 'Vai trò và phân quyền'] },
  ],
  teacher: [
    { title: 'Giảng dạy', items: ['Tổng quan', 'Kế hoạch giáo dục', 'Lớp giảng dạy', 'Bài tập', 'Chấm bài'] },
    { title: 'Hoạt động STEM', items: ['Giáo dục STEM', 'Đặt phòng STEM'] },
    { title: 'Soạn giảng', items: ['Soạn bài giảng', 'Kho hoạt động & Bài giảng', 'Thư viện STEM'] },
    { title: 'Khác', items: ['Học trước & tự học', 'Lịch tập huấn', 'Bài giảng tập huấn'] },
  ],
  student: [
    { title: 'Học tập', items: ['Tổng quan', 'Bài tập', 'Lịch học', 'Giáo dục STEM', 'Chủ đề'] },
  ],
  department: [
    { title: 'Tổng quan', items: ['Dashboard toàn Sở', 'KPI & Xếp hạng Xã/Phường', 'Danh sách Trường'] },
    { title: 'Theo dõi STEM', items: ['Chương trình CT1–CT5', 'Theo dõi Môn học STEM', 'Giám sát Tập huấn GV'] },
    { title: 'Tập huấn STEM', items: ['Kế hoạch tập huấn', 'Lịch tập huấn'] },
    { title: 'Phòng & Thiết bị STEM', items: ['Hiệu quả Phòng STEM'] },
    { title: 'Báo cáo & Điều hành', items: ['Báo cáo Bộ GD&ĐT', 'Điều hành & Cấu hình'] },
  ],
}
