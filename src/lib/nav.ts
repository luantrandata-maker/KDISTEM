export type RoleKey = 'school_admin' | 'teacher' | 'student' | 'department' | 'platform' | 'parent' | 'judge'
// section: tên phân hệ khi phân hệ chia nhiều nhóm (menu hiện tiêu đề phân hệ phía trên các nhóm con)
export type NavGroup = { title: string; items: string[]; section?: string }

export const ROLE_LABEL: Record<RoleKey, string> = {
  school_admin: 'Trường · Quản trị', teacher: 'Giáo viên',
  student: 'Học sinh', department: 'Sở GD&ĐT', platform: 'Quản trị nền tảng', parent: 'Phụ huynh', judge: 'Giám khảo',
}

// MÃ TRANG = tên mục lúc tạo trang. Mã được dùng làm khoá ở nhiều nơi: bảng trang (App.tsx PAGES), ánh xạ quyền/gói
// (MODULE_OF, ENT_MODULE_OF), liên kết giữa các màn (go('…')), cột notifications.page trong CSDL (trigger ghi sẵn),
// lịch sử trình duyệt. Vì vậy KHÔNG sửa chuỗi mã trong NAV/PAGES.
//   • Đổi nhóm, thứ tự, chuyển mục sang nhóm/cổng khác, đổi tên nhóm: chỉ sửa NAV — không ảnh hưởng gì khác.
//   • Đổi TÊN HIỂN THỊ của một mục: thêm vào LABEL (theo cổng, hoặc '*' cho mọi cổng) — menu, tiêu đề trang,
//     ô Tìm chức năng, Sơ đồ hệ thống đều đọc qua labelOf().
export const LABEL: Partial<Record<RoleKey | '*', Record<string, string>>> = {
  // ví dụ: department: { 'Dashboard toàn Sở': 'Tổng quan toàn Sở' },
  school_admin: { 'Quản lý Phòng STEM': 'Quản lý phòng' },   // 056: phòng STEM, phòng học, kho
}
export const labelOf = (role: RoleKey, id: string) => LABEL[role]?.[id] ?? LABEL['*']?.[id] ?? id

export const NAV: Record<RoleKey, NavGroup[]> = {
  // Cổng Quản trị nền tảng (16/10): Tổng quan · Vận hành KDI · Lõi · Quản trị chung · Kỹ thuật & bảo mật · 5 phân hệ nghiệp vụ (đơn vị bán).
  // Mục chưa có trang thật hiện khung giao diện (pages/platform/Planned.tsx).
  platform: [
    { title: 'Tổng quan', items: ['Tổng quan hệ thống', 'Phân hệ & mức sử dụng', 'Sơ đồ hệ thống', 'Thuật ngữ chuẩn'] },
    { title: 'Vận hành KDI', items: ['Thông tin khách hàng', 'Gói dịch vụ & hợp đồng', 'Đơn đặt gói STEM', 'Triển khai khách hàng', 'Vấn đề & phản hồi', 'Nghiệm thu & doanh thu'] },
    { title: 'Lõi · Tổ chức & quy trình', items: ['Cây tổ chức', 'Cơ sở triển khai', 'Người dùng & vai trò', 'Vai trò & quyền mặc định', 'Lời mời', 'Hộp phê duyệt', 'Quy trình phê duyệt', 'Thông báo'] },
    { title: 'Quản trị chung · Kỹ thuật & bảo mật', items: ['Tích hợp & dữ liệu', 'Ứng dụng di động & ngoại tuyến', 'Sao lưu & xuất dữ liệu', 'Bảo mật tài khoản', 'Điều khoản & dữ liệu cá nhân', 'Nhật ký hệ thống', 'Cấu hình chung (năm học)', 'Giao diện & thương hiệu', 'Trợ lý AI'] },
    // 5 phân hệ nghiệp vụ theo file rà soát menu (16/10, "Menu_STEM_ra_soat_chinh_sua.xlsx")
    { title: '1. Đào tạo & đánh giá năng lực nhà giáo', items: ['Đánh giá năng lực giáo viên', 'Kế hoạch tập huấn', 'Lịch tập huấn', 'Bài giảng tập huấn & lớp học ảo', 'Chứng chỉ tập huấn', 'Giám sát tập huấn nhà giáo'] },
    { title: '2. Chương trình & học liệu', items: ['Chương trình giáo dục', 'Học liệu', 'Phân phối chương trình', 'Soạn bài giảng & kho hoạt động', 'Theo dõi chương trình CT1–CT5 (Môn học)', 'E-learning & luyện thi'] },
    { section: '3. Vật tư, thiết bị dạy & học', title: '3.1. Thiết bị, vật tư & kho', items: ['Thiết bị & vật tư', 'Kho & tồn kho', 'Mua hàng & đề xuất vật tư', 'Cấp phát & bàn giao', 'Kiểm kê', 'Vận chuyển vật tư', 'Bảo hành & bảo trì thiết bị'] },
    { section: '3. Vật tư, thiết bị dạy & học', title: '3.2. Phòng STEM & cơ sở vật chất', items: ['Tòa nhà, tầng & tiết học', 'Phòng STEM & lịch phòng', 'Hiệu quả sử dụng phòng STEM'] },
    { section: '4. Vận hành giảng dạy & đánh giá người học', title: '4.1. Nhà giáo, người học & lớp học', items: ['Cơ sở giáo dục', 'Nhà giáo & trợ giảng', 'Phân công giảng dạy', 'Người học', 'Công cụ người học & phụ huynh'] },
    { section: '4. Vận hành giảng dạy & đánh giá người học', title: '4.2. Kế hoạch, lịch dạy & sự kiện', items: ['Thời khóa biểu & xếp lịch', 'Kế hoạch giáo dục toàn trường', 'Duyệt đăng ký dạy STEM', 'Sự kiện'] },
    { section: '4. Vận hành giảng dạy & đánh giá người học', title: '4.3. Buổi dạy & điểm danh', items: ['Buổi dạy & điểm danh'] },
    { section: '4. Vận hành giảng dạy & đánh giá người học', title: '4.4. Đánh giá & phản hồi', items: ['Đánh giá năng lực người học', 'Bài tập & chấm bài', 'Dự án STEM', 'Cuộc thi STEM', 'Chấm thi', 'Vấn đề & phản hồi'] },
    { section: '5. Hệ thống quản lý vận hành', title: '5.1. Dashboard & báo cáo', items: ['Báo cáo vận hành', 'KPI & xếp hạng', 'Chỉ số STEM (STEM Index)', 'Báo cáo cấp trên (Bộ GD&ĐT)', 'Khảo sát', 'Dashboard tổng hợp'] },
    { section: '5. Hệ thống quản lý vận hành', title: '5.2. Điều hành & chỉ tiêu (Sở)', items: ['Điều hành toàn tỉnh', 'Điều hành & cấu hình (Sở)', 'Cảnh báo & trường cần chú ý', 'So sánh trường / địa bàn', 'Bộ chỉ số', 'Giao chỉ tiêu'] },
    // 5.3–5.6: trường / Sở quản lý riêng phần của mình; phần chung toàn hệ thống vẫn ở Vận hành KDI, Lõi, Quản trị chung · Kỹ thuật & bảo mật
    { section: '5. Hệ thống quản lý vận hành', title: '5.3. Tích hợp & dữ liệu', items: ['Tích hợp & dữ liệu', 'Ứng dụng di động & ngoại tuyến', 'Sao lưu & xuất dữ liệu'] },
    { section: '5. Hệ thống quản lý vận hành', title: '5.4. Khách hàng & thương mại', items: ['Thông tin khách hàng', 'Gói dịch vụ & hợp đồng'] },
    { section: '5. Hệ thống quản lý vận hành', title: '5.5. Tổ chức, tài khoản & phân quyền', items: ['Tổ chức & phân quyền'] },
    { section: '5. Hệ thống quản lý vận hành', title: '5.6. Quản trị nền tảng', items: ['Giao diện & thương hiệu', 'Trợ lý AI', 'Nhật ký hoạt động', 'Lộ trình triển khai', 'Bảo mật tài khoản', 'Cấu hình chung (kỳ học...)'] },
  ],
  // Cổng Trường và Sở (17/10): nhóm theo phân hệ (không ghi số PH). Dữ liệu lõi (nhân sự, lớp, năm học, khai báo)
  // luôn có, nằm ở nhóm riêng. Mục thuộc phân hệ chưa có trong gói vẫn hiện, mờ, kèm "Chưa có trong gói" (UPSELL_PORTALS).
  school_admin: [
    { title: 'Tổng quan', items: ['Dashboard Trường', 'Hồ sơ Trường học', 'Hộp phê duyệt', 'Trợ lý AI'] },
    { title: 'Nhân sự & lớp học', items: ['Giáo viên', 'Phân công giảng dạy', 'Lớp học', 'Học sinh', 'Phụ huynh'] },
    { title: 'Tập huấn giáo viên', items: ['Kế hoạch tập huấn', 'Lịch tập huấn', 'Bài giảng', 'Lớp học ảo', 'Chứng chỉ', 'Đánh giá năng lực GV'] },
    { title: 'Chương trình & học liệu', items: ['Gói STEM', 'Đề xuất mua gói', 'Phân phối chương trình', 'Kho học liệu dùng chung', 'Phát hành học liệu', 'E-learning & luyện thi', 'Ngân hàng câu hỏi'] },
    { title: 'Phòng & thiết bị STEM', items: ['Quản lý Phòng STEM', 'Quản lý Thiết bị', 'Vật tư tiêu hao', 'Đề xuất mua vật tư', 'Vận chuyển vật tư', 'Kiểm kê', 'Bảo hành thiết bị'] },
    { title: 'Dự án & cuộc thi', items: ['Dự án STEM', 'Cuộc thi'] },
    { title: 'Giảng dạy', items: ['Kế hoạch GD toàn trường', 'Duyệt đăng ký dạy STEM', 'Thời khóa biểu', 'Phân công GV dạy STEM', 'Buổi dạy & điểm danh', 'Dashboard điểm danh', 'Năng lực học sinh', 'Sự kiện'] },
    { title: 'Quản trị', items: ['Năm học & học kỳ', 'Ngày nghỉ & lễ', 'Tòa nhà & Tầng', 'Cấu hình tiết học', 'Tài khoản', 'Vai trò và phân quyền', 'Quy trình phê duyệt', 'Khảo sát', 'Sao lưu & xuất dữ liệu', 'Giao diện & thương hiệu', 'Ứng dụng di động', 'Hỗ trợ từ KDI'] },
  ],
  teacher: [
    { title: 'Giảng dạy', items: ['Tổng quan', 'Kế hoạch giáo dục', 'Lớp giảng dạy', 'Điểm danh', 'Bài tập', 'Chấm bài', 'Năng lực học sinh', 'Học trước & tự học', 'E-learning & luyện thi'] },
    { title: 'Hoạt động STEM', items: ['Giáo dục STEM', 'Đặt phòng STEM', 'Dự án STEM', 'Cuộc thi', 'Chấm thi', 'Sự kiện'] },
    { title: 'Soạn giảng', items: ['Soạn bài giảng', 'Kho hoạt động & Bài giảng', 'Thư viện STEM', 'Ngân hàng câu hỏi', 'Trợ lý AI'] },
    { title: 'Khác', items: ['Hộp phê duyệt', 'Lịch tập huấn', 'Bài giảng tập huấn', 'Hồ sơ năng lực', 'Khảo sát', 'Ứng dụng di động', 'Hỗ trợ từ KDI'] },
  ],
  judge: [
    { title: 'Giám khảo', items: ['Chấm thi'] },
  ],
  parent: [
    { title: 'Con của tôi', items: ['Tổng quan', 'Lịch học', 'Chuyên cần của con', 'Bài tập & điểm', 'Năng lực của con', 'Dự án STEM', 'Sự kiện', 'Khảo sát', 'Cài đặt & đồng ý', 'Ứng dụng di động'] },
  ],
  student: [
    { title: 'Học tập', items: ['Tổng quan', 'Bài tập', 'Học trước & tự học', 'Lịch học', 'Chuyên cần', 'Năng lực của em', 'Giáo dục STEM', 'Chủ đề', 'E-learning & luyện thi', 'Dự án STEM', 'Sự kiện', 'Khảo sát'] },
  ],
  department: [
    { title: 'Tổng quan', items: ['Dashboard toàn Sở', 'Danh sách Trường', 'Hộp phê duyệt', 'Trợ lý AI'] },
    { title: 'Điều hành & báo cáo', items: ['Chỉ số STEM', 'So sánh trường / địa bàn', 'KPI & Xếp hạng Xã/Phường', 'Cảnh báo & trường cần chú ý', 'Giao chỉ tiêu', 'Bộ chỉ số', 'Sự kiện', 'Khảo sát', 'Báo cáo Bộ GD&ĐT', 'Điều hành & Cấu hình'] },
    { title: 'Dự án & cuộc thi', items: ['Cuộc thi', 'Dự án STEM', 'Chấm thi'] },
    { title: 'Tập huấn giáo viên', items: ['Giám sát Tập huấn GV', 'Kế hoạch tập huấn', 'Lịch tập huấn'] },
    { title: 'Chương trình & học liệu', items: ['Chương trình CT1–CT5', 'Theo dõi Môn học STEM', 'Phát hành học liệu', 'Kho học liệu dùng chung', 'E-learning & luyện thi', 'Ngân hàng câu hỏi'] },
    { title: 'Phòng & thiết bị STEM', items: ['Hiệu quả Phòng STEM', 'Phòng STEM & lịch phòng', 'Thiết bị & kho'] },
    { title: 'Giảng dạy', items: ['Dashboard điểm danh'] },
    { title: 'Quản trị', items: ['Quy trình phê duyệt', 'Ngày nghỉ & lễ', 'Sao lưu & xuất dữ liệu', 'Giao diện & thương hiệu', 'Hỗ trợ từ KDI'] },
  ],
}

// Mục menu của vai trò Trường – Quản trị → chức năng trong ma trận phân quyền
export const MODULE_OF: Record<string, string> = {
  'Giáo viên': 'teachers', 'Lớp học': 'classes', 'Học sinh': 'students', 'Phụ huynh': 'students', 'Phân công giảng dạy': 'assignments',
  'Quản lý Phòng STEM': 'stem_rooms', 'Quản lý Thiết bị': 'equipment', 'Vật tư tiêu hao': 'equipment', 'Đề xuất mua vật tư': 'equipment', 'Vận chuyển vật tư': 'equipment', 'Kiểm kê': 'equipment', 'Bảo hành thiết bị': 'warranty',
  'Thời khóa biểu': 'timetable', 'Duyệt đăng ký dạy STEM': 'stem_registrations', 'Tòa nhà & Tầng': 'buildings',
  'Cấu hình tiết học': 'periods', 'Năm học & học kỳ': 'periods', 'Tài khoản': 'accounts', 'Sao lưu & xuất dữ liệu': 'accounts', 'Giao diện & thương hiệu': 'accounts', 'Vai trò và phân quyền': 'roles',
  'Kế hoạch GD toàn trường': 'edu_plan', 'Phân công GV dạy STEM': 'stem_assign', 'Phân phối chương trình': 'curriculum',
  'Gói STEM': 'packages', 'Kế hoạch tập huấn': 'training', 'Lịch tập huấn': 'training', 'Bài giảng': 'training',
  'Lớp học ảo': 'training', 'Chứng chỉ': 'training',
  'Kho học liệu dùng chung': 'library', 'Phát hành học liệu': 'library',
  'Hộp phê duyệt': 'approvals', 'Quy trình phê duyệt': 'roles', 'Đề xuất mua gói': 'packages',
  'Buổi dạy & điểm danh': 'timetable', 'Dashboard điểm danh': 'timetable', 'Ngày nghỉ & lễ': 'periods',
  'Đánh giá năng lực GV': 'training', 'Năng lực học sinh': 'students',
}
// Vai trò → giao diện: lưu ở cột roles.portal (vai trò hệ thống và vai trò tuỳ chỉnh của trường).

// Mục menu (mọi giao diện trừ Quản trị nền tảng) → chức năng dùng để kiểm tra gói dịch vụ (migration 024).
// Mục không có ở đây là phần lõi, luôn hiện.
export const ENT_MODULE_OF: Record<string, string> = {
  ...MODULE_OF, 'Quy trình phê duyệt': 'approvals',
  'Đặt phòng STEM': 'stem_rooms', 'Thư viện STEM': 'library', 'Kho hoạt động & Bài giảng': 'library',
  'Lịch tập huấn': 'training', 'Bài giảng tập huấn': 'training', 'Kế hoạch tập huấn': 'training', 'Giám sát Tập huấn GV': 'training',
  'Kế hoạch giáo dục': 'edu_plan', 'Hiệu quả Phòng STEM': 'stem_rooms',
  'Điểm danh': 'timetable', 'Phòng STEM & lịch phòng': 'stem_rooms', 'Thiết bị & kho': 'stem_rooms',
  // PH5 (migration 033): điều hành & báo cáo của Sở
  'KPI & Xếp hạng Xã/Phường': 'governance', 'Báo cáo Bộ GD&ĐT': 'governance',
  'Cảnh báo & trường cần chú ý': 'governance', 'Giao chỉ tiêu': 'governance',
  'Chỉ số STEM': 'governance', 'So sánh trường / địa bàn': 'governance', 'Bộ chỉ số': 'governance',
  // 042: năng lực GV thuộc PH1 (Đào tạo & đánh giá năng lực nhà giáo), năng lực HS thuộc PH4
  'Hồ sơ năng lực': 'training', 'Năng lực học sinh': 'timetable', 'Năng lực của em': 'timetable',
}

// Cổng hiện mục chưa có trong gói ở dạng mờ "Chưa có trong gói" (để giới thiệu phân hệ); các cổng khác ẩn hẳn.
export const UPSELL_PORTALS = new Set<RoleKey>(['school_admin', 'department'])
// Chức năng (perm module) → phân hệ bán (khớp service_modules.perm_modules, migration 033)
export const PHASE_OF: Record<string, string> = {
  training: 'Đào tạo & đánh giá năng lực nhà giáo',
  library: 'Chương trình & học liệu', packages: 'Chương trình & học liệu', curriculum: 'Chương trình & học liệu',
  stem_rooms: 'Vật tư, thiết bị dạy & học', equipment: 'Vật tư, thiết bị dạy & học', warranty: 'Vật tư, thiết bị dạy & học',
  timetable: 'Vận hành giảng dạy & đánh giá người học', edu_plan: 'Vận hành giảng dạy & đánh giá người học',
  stem_registrations: 'Vận hành giảng dạy & đánh giá người học', stem_assign: 'Vận hành giảng dạy & đánh giá người học',
  governance: 'Hệ thống quản lý vận hành',
}
