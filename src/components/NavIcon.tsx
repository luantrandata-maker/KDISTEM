// Biểu tượng cho đề mục menu (nét mảnh, theo màu chữ). Chọn theo từ khoá trong tên nhóm.
const P: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  briefcase: 'M3 7h18v13H3zM9 7V4h6v3',
  org: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-2h12v2',
  server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
  cap: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 10v5',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  box: 'M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8',
  calendar: 'M4 5h16v16H4zM16 3v4M8 3v4M4 10h16',
  chart: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  check: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  cart: 'M3 3h2l2.4 12h11l2-8H6M9 20h.01M18 20h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  flask: 'M9 3h6M10 3v6L4 19a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 19l-6-10V3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
}
const RULES: [RegExp, string][] = [
  [/tổng quan/i, 'grid'], [/vận hành kdi|khách hàng|thương mại/i, 'briefcase'], [/lõi|tổ chức|quản trị$/i, 'org'],
  [/kỹ thuật|tích hợp/i, 'server'], [/đào tạo|tập huấn/i, 'cap'], [/chương trình|học liệu|soạn giảng|học tập/i, 'book'],
  [/vật tư|thiết bị|phòng/i, 'box'], [/giảng dạy|kế hoạch|tkb|lịch/i, 'calendar'], [/báo cáo|điều hành|quản lý vận hành|theo dõi/i, 'chart'],
  [/phê duyệt/i, 'check'], [/mua sắm|gói/i, 'cart'], [/nhân sự|giáo viên/i, 'users'], [/stem|hoạt động/i, 'flask'], [/khai báo|cấu hình|khác/i, 'settings'],
]
export function NavIcon({ title }: { title: string }) {
  const d = P[RULES.find(([re]) => re.test(title))?.[1] ?? 'folder']
  return (
    <svg className="navicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
