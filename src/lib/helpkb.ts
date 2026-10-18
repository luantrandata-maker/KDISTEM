import { norm } from './sheet'
import type { RoleKey } from './nav'

// Câu hỏi thường gặp cho nút trợ giúp (055). Dùng cả khi tắt AI (tìm theo từ khoá) và làm ngữ cảnh cho AI trả lời.
// portals: chỉ hiện cho các cổng này (bỏ trống = mọi cổng). Tên mục menu viết đúng như trên thanh menu.
export type Faq = { id: string; cat: string; q: string; a: string; keys?: string; portals?: RoleKey[] }
const STAFF: RoleKey[] = ['school_admin', 'teacher', 'department', 'platform']

export const FAQ: Faq[] = [
  // ---- Giới thiệu ----
  { id: 'about', cat: 'Giới thiệu', q: 'KSCHOOL STEM là gì? Ai cung cấp nền tảng này?', keys: 'đơn vị cung cấp nhà cung cấp nền tảng hệ thống là gì của ai công ty kdi education giới thiệu phần mềm',
    a: 'KSCHOOL STEM (Hệ thống Quản trị STEM) là nền tảng web quản lý giáo dục STEM do **KDI Education** cung cấp cho trường phổ thông, Phòng / Sở GD&ĐT: lịch dạy, điểm danh, bài tập, năng lực, phòng và thiết bị STEM, tập huấn giáo viên, học liệu, e-learning, báo cáo cho Sở. Mỗi Sở / trường có thể dùng tên và logo riêng.' },
  { id: 'contact', cat: 'Giới thiệu', q: 'Liên hệ KDI để được hỗ trợ', keys: 'liên hệ hotline số điện thoại email hỗ trợ kdi gặp ai tư vấn',
    a: 'Cách nhanh nhất: mở tab **Yêu cầu hỗ trợ** trong khung này → **Gửi yêu cầu hỗ trợ mới**. KDI trả lời ngay trong phiếu và báo qua chuông thông báo. Cán bộ trường / Sở còn xem được mọi phiếu của đơn vị ở mục **"Hỗ trợ từ KDI"**.' },
  { id: 'privacy', cat: 'Giới thiệu', q: 'Dữ liệu của trường, học sinh được bảo vệ thế nào?', keys: 'bảo mật dữ liệu quyền riêng tư an toàn thông tin cá nhân lộ dữ liệu',
    a: 'Dữ liệu tách riêng theo từng đơn vị: mỗi trường chỉ thấy dữ liệu của mình, Sở thấy các trường trực thuộc. Điều khoản sử dụng và chính sách dữ liệu cá nhân hiện khi đăng nhập lần đầu; cha mẹ xác nhận đồng ý cho dữ liệu học sinh. Xuất / xoá dữ liệu học sinh do quản trị trường thực hiện và được ghi nhật ký.' },
  // ---- Đăng nhập & tài khoản ----
  { id: 'login', cat: 'Tài khoản', q: 'Không đăng nhập được', keys: 'đăng nhập sai mật khẩu login không vào được bị khoá',
    a: '1. Kiểm tra ô "Email hoặc tên đăng nhập": học sinh / phụ huynh dùng **tên đăng nhập** in trên phiếu tài khoản (dạng `mãtrường.mãhọcsinh`; phụ huynh `mãtrường.ph<số điện thoại>`), không phải email.\n2. Mật khẩu phân biệt chữ hoa / thường.\n3. Quên mật khẩu: tài khoản có email bấm **Quên mật khẩu?** ở trang đăng nhập; tài khoản không có email nhờ quản trị trường đặt lại.\n4. Báo "tài khoản bị khoá": liên hệ quản trị trường hoặc gửi yêu cầu hỗ trợ.' },
  { id: 'password', cat: 'Tài khoản', q: 'Đổi mật khẩu', keys: 'đổi mật khẩu password',
    a: 'Bấm vào tên của bạn ở góc trên bên phải → **Đổi mật khẩu**. Tài khoản do trường cấp nên đổi mật khẩu ngay ở lần đăng nhập đầu.' },
  { id: 'reset-student', cat: 'Tài khoản', q: 'Cấp / đặt lại tài khoản cho học sinh, giáo viên không có email', portals: ['school_admin', 'platform'], keys: 'tài khoản mã cấp tài khoản đặt lại mật khẩu học sinh in phiếu',
    a: 'Vào **"Tài khoản"** → tab **Tài khoản học sinh, giáo viên (không cần email)** → chọn lớp / người → **Tạo tài khoản** rồi in phiếu. Đặt lại mật khẩu ở cùng màn, mật khẩu mới chỉ hiện một lần để in.' },
  { id: 'mfa', cat: 'Tài khoản', q: 'Yêu cầu xác thực 2 lớp (mã 6 số)', keys: '2fa xác thực hai lớp otp mã 6 số authenticator',
    a: 'Một số vai trò quản trị bắt buộc xác thực 2 lớp. Cài ứng dụng Google Authenticator hoặc Microsoft Authenticator, quét mã QR hệ thống hiện ra, rồi nhập mã 6 số. Mất điện thoại: gửi yêu cầu hỗ trợ để KDI đặt lại.' },
  { id: 'portal', cat: 'Bắt đầu', q: 'Chuyển giữa các vai trò / đơn vị (ví dụ vừa là giáo viên vừa là quản trị)', keys: 'chuyển vai trò cổng đơn vị trường khác chế độ xem',
    a: 'Bấm vào tên ở góc trên bên phải: mục **Chế độ xem** để đổi cổng (Trường, Giáo viên…), mục **Đang làm việc tại** để chuyển trường / đơn vị nếu bạn thuộc nhiều nơi.' },
  { id: 'search', cat: 'Bắt đầu', q: 'Tìm nhanh một chức năng', keys: 'tìm chức năng ctrl k menu ở đâu không thấy',
    a: 'Gõ vào ô **Tìm chức năng…** ở thanh trên cùng (phím tắt Ctrl + K) rồi chọn. Mục mờ có biểu tượng khoá là phân hệ chưa có trong gói dịch vụ của đơn vị.' },
  { id: 'year', cat: 'Bắt đầu', q: 'Dữ liệu không đúng năm học / học kỳ', keys: 'năm học học kỳ không thấy lớp dữ liệu cũ',
    a: 'Kiểm tra ô **Năm học · học kỳ** ở đầu thanh menu bên trái. Nếu thấy dòng "Đang xem học kỳ không phải hiện tại", chọn lại học kỳ hiện tại.', portals: ['school_admin', 'teacher', 'student'] },
  { id: 'locked', cat: 'Bắt đầu', q: 'Mục menu bị mờ "Chưa có trong gói"', keys: 'chưa có trong gói khoá mờ phân hệ',
    a: 'Phân hệ đó chưa thuộc gói dịch vụ của đơn vị. Quản trị trường / Sở liên hệ KDI (gửi yêu cầu hỗ trợ, loại "Hợp đồng, thanh toán") để nâng gói.', portals: ['school_admin', 'department'] },
  { id: 'perm', cat: 'Bắt đầu', q: 'Báo "Bạn không có quyền"', keys: 'không có quyền permission bị chặn 403',
    a: 'Vai trò của bạn chưa được cấp chức năng này. Quản trị trường cấp quyền tại **"Vai trò và phân quyền"**. Nếu bạn là quản trị mà vẫn bị chặn, gửi yêu cầu hỗ trợ kèm tên màn hình.' },
  // ---- Giảng dạy ----
  { id: 'attendance', cat: 'Giảng dạy', q: 'Điểm danh một tiết học', portals: ['teacher'], keys: 'điểm danh vắng muộn có phép tiết',
    a: '1. Vào **"Điểm danh"**, chọn ngày ở dải tuần.\n2. Bấm **Điểm danh** ở tiết cần điểm danh (mở từ 10 phút trước giờ học).\n3. Mặc định tất cả có mặt — chỉ chọn học sinh Vắng / Muộn / Có phép, rồi **Lưu điểm danh**.\nGiáo viên sửa được trong 7 ngày; quá hạn nhờ quản trị trường.' },
  { id: 'attendance-offline', cat: 'Giảng dạy', q: 'Điểm danh khi mất mạng', portals: ['teacher'], keys: 'mất mạng ngoại tuyến offline wifi',
    a: 'Mở trang **"Điểm danh"** của ngày khi còn mạng (danh sách lớp được lưu sẵn). Khi mất mạng vẫn điểm danh và bấm Lưu — dữ liệu chờ trên máy và tự gửi khi có mạng (thanh cuối màn hình báo số điểm danh chờ gửi).' },
  { id: 'attendance-missing', cat: 'Giảng dạy', q: 'Không thấy tiết dạy để điểm danh', portals: ['teacher', 'school_admin'], keys: 'không thấy tiết thời khoá biểu buổi dạy trống',
    a: 'Tiết dạy được sinh từ **Thời khóa biểu** của trường. Nếu trống: kiểm tra đúng ngày / học kỳ, ngày đó có phải ngày nghỉ, và quản trị trường đã xếp thời khoá biểu, phân công giảng dạy cho bạn chưa.' },
  { id: 'assignment', cat: 'Giảng dạy', q: 'Giao bài tập và chấm bài', portals: ['teacher'], keys: 'bài tập giao bài chấm bài nộp bài',
    a: 'Vào **"Bài tập"** → tạo bài, chọn lớp, hạn nộp, (tuỳ chọn) mẫu tiêu chí. Học sinh nộp trong cổng học sinh. Chấm ở **"Chấm bài"**; chấm theo tiêu chí có gắn năng lực sẽ tự cập nhật **"Năng lực học sinh"**.' },
  { id: 'competency', cat: 'Giảng dạy', q: 'Xem năng lực học sinh theo lớp', portals: ['teacher', 'school_admin'], keys: 'năng lực m1 m4 đánh giá',
    a: 'Vào **"Năng lực học sinh"**, chọn **Khối** rồi **Lớp**. Mức M1–M4 là trung bình các bài đã chấm theo tiêu chí có gắn năng lực; bấm tên học sinh để xem hồ sơ. Có nút Xuất Excel.' },
  { id: 'elearning', cat: 'Giảng dạy', q: 'Tạo đề luyện / khoá học e-learning', portals: ['teacher', 'school_admin', 'department', 'platform'], keys: 'đề luyện luyện thi e-learning khoá học ngân hàng câu hỏi trắc nghiệm',
    a: '1. Thêm câu hỏi ở **"Ngân hàng câu hỏi"** (soạn tay, Nhập Excel theo file mẫu, hoặc Tạo bằng Trợ lý AI → duyệt sang "Sẵn sàng").\n2. Vào **"E-learning & luyện thi"** → tab Đề luyện → **Tạo đề luyện** (ngẫu nhiên theo mức độ hoặc chọn từng câu) → **Công bố**.\n3. Tab Khoá học: tạo khoá, thêm bài (video, bài đọc, liên kết, đề luyện) → Công bố.' },
  { id: 'ai', cat: 'Giảng dạy', q: 'Dùng Trợ lý AI soạn giáo án, câu hỏi, nhận xét', portals: STAFF, keys: 'trợ lý ai giáo án kế hoạch bài dạy nhận xét văn bản',
    a: 'Vào **"Trợ lý AI"**, chọn việc cần làm (kế hoạch bài dạy, câu hỏi trắc nghiệm, nhận xét năng lực, văn bản hành chính, hỏi đáp), điền thông tin → **Tạo bằng AI**. Kết quả chép hoặc tải về Word. Không nhập tên, ngày sinh… của học sinh. Báo "chưa được KDI bật" hoặc "hết lượt": liên hệ quản trị.' },
  // ---- Học sinh & phụ huynh ----
  { id: 'student-homework', cat: 'Học sinh', q: 'Nộp bài tập', portals: ['student'], keys: 'nộp bài bài tập hạn nộp',
    a: 'Vào **"Bài tập"**, chọn bài → làm / đính kèm → **Nộp bài**. Bài đã quá hạn hoặc thầy cô đã đóng thì liên hệ thầy cô.' },
  { id: 'student-exam', cat: 'Học sinh', q: 'Làm đề luyện có tính giờ', portals: ['student'], keys: 'luyện thi đề luyện tính giờ làm bài nộp bài',
    a: 'Vào **"E-learning & luyện thi"** → tab Luyện thi → **Bắt đầu**. Bài làm tự lưu trên máy; tạm rời vẫn làm tiếp được nhưng đồng hồ vẫn chạy, hết giờ tự nộp. Xem lại ở tab Bài đã làm.' },
  { id: 'parent-link', cat: 'Phụ huynh', q: 'Không thấy thông tin của con', portals: ['parent'], keys: 'không thấy con liên kết phụ huynh',
    a: 'Tài khoản phụ huynh được nhà trường liên kết theo **số điện thoại** đã khai báo. Nếu thiếu con hoặc sai, liên hệ giáo viên chủ nhiệm / nhà trường để cập nhật số điện thoại.' },
  { id: 'parent-alert', cat: 'Phụ huynh', q: 'Nhận / tắt thông báo con vắng học', portals: ['parent'], keys: 'thông báo vắng cảnh báo',
    a: 'Vào **"Cài đặt & đồng ý"** để bật / tắt thông báo khi con vắng hoặc đi muộn. Thông báo hiện ở chuông góc trên bên phải.' },
  // ---- Quản trị trường ----
  { id: 'import', cat: 'Quản trị', q: 'Nhập danh sách giáo viên / học sinh / lớp từ Excel', portals: ['school_admin'], keys: 'nhập excel import danh sách file mẫu',
    a: 'Ở màn **"Giáo viên"**, **"Học sinh"** hoặc **"Lớp học"**: bấm **Tải file mẫu**, điền đúng cột rồi **Nhập Excel**. Hệ thống báo dòng nào bị bỏ qua và lý do (trùng email, thiếu cột…).' },
  { id: 'timetable', cat: 'Quản trị', q: 'Xếp thời khoá biểu và phân công giảng dạy', portals: ['school_admin'], keys: 'thời khoá biểu phân công tkb',
    a: 'Thứ tự: **"Năm học & học kỳ"** → **"Cấu hình tiết học"** → **"Lớp học"** → **"Phân công giảng dạy"** → **"Thời khóa biểu"**. Buổi dạy để điểm danh được sinh tự động từ thời khoá biểu.' },
  { id: 'approval', cat: 'Quản trị', q: 'Duyệt đề xuất, đăng ký (Hộp phê duyệt)', portals: STAFF, keys: 'phê duyệt duyệt đề xuất quy trình',
    a: 'Mọi việc chờ bạn duyệt nằm ở **"Hộp phê duyệt"**. Các bước duyệt (ai duyệt, mấy cấp) cấu hình ở **"Quy trình phê duyệt"**.' },
  { id: 'equipment', cat: 'Quản trị', q: 'Báo hỏng thiết bị, bảo hành', portals: ['school_admin', 'teacher'], keys: 'thiết bị hỏng bảo hành sửa chữa',
    a: 'Vào **"Bảo hành thiết bị"** → **Báo lỗi thiết bị**, chọn thiết bị (theo serial / tem QR) và mô tả sự cố. KDI tiếp nhận, phân công kỹ thuật viên và cập nhật trạng thái tại đó.' },
  { id: 'export', cat: 'Quản trị', q: 'Xuất / sao lưu dữ liệu của trường', portals: ['school_admin', 'department', 'platform'], keys: 'xuất dữ liệu sao lưu backup excel',
    a: 'Vào **"Sao lưu & xuất dữ liệu"**, chọn nhóm dữ liệu → tải tệp Excel. Mỗi lần xuất được ghi nhật ký.' },
  // ---- Lỗi thường gặp ----
  { id: 'slow', cat: 'Lỗi thường gặp', q: 'Trang trắng, không tải, hiển thị sai sau khi cập nhật', keys: 'trang trắng lỗi tải chậm không hiện cập nhật cache',
    a: '1. Tải lại trang bằng **Ctrl + F5** (điện thoại: kéo xuống để tải lại).\n2. Thử trình duyệt Chrome / Edge mới nhất.\n3. Vẫn lỗi: gửi yêu cầu hỗ trợ, ghi rõ màn hình và thao tác — hệ thống tự gửi kèm trang đang mở.' },
  { id: 'excel-error', cat: 'Lỗi thường gặp', q: 'Nhập Excel báo "Không tìm thấy cột"', keys: 'excel không tìm thấy cột nhập lỗi file mẫu',
    a: 'Tiêu đề cột phải giống file mẫu (không cần đúng thứ tự). Bấm **Tải file mẫu**, chép dữ liệu sang, giữ nguyên dòng tiêu đề; lưu dạng .xlsx hoặc .csv.' },
  { id: 'migration', cat: 'Lỗi thường gặp', q: 'Báo "Hãy chạy migration … trên Supabase"', keys: 'migration supabase chạy',
    a: 'Máy chủ dữ liệu chưa được cập nhật bản mới cho chức năng này. Đây là việc của KDI — gửi yêu cầu hỗ trợ kèm thông báo lỗi.' },
  { id: 'install', cat: 'Lỗi thường gặp', q: 'Cài ứng dụng lên điện thoại', keys: 'cài ứng dụng điện thoại app mobile pwa màn hình chính',
    a: 'Mở **"Ứng dụng di động"** và làm theo hướng dẫn: Android (Chrome) → menu ⋮ → Cài đặt ứng dụng; iPhone (Safari) → Chia sẻ → Thêm vào MH chính.' },
  { id: 'notify', cat: 'Lỗi thường gặp', q: 'Không nhận được email mời / đặt lại mật khẩu', keys: 'email không nhận được thư mời spam',
    a: 'Kiểm tra thư mục Spam / Quảng cáo. Thư có thể đến chậm vài phút. Vẫn không có: nhờ quản trị gửi lại lời mời, hoặc dùng tài khoản đăng nhập bằng mã (không cần email).' },
]

// Từ không mang nghĩa khi tìm (đã bỏ dấu)
const STOP = new Set('toi em minh ban can biet muon hoi cho xin la gi nao the sao lam co khong duoc va voi cua cac nhung mot nay do o tai thi ma de vao ra nhu bi da se roi nhe a oi a nhi vay cung'.split(' '))

// Câu hỏi phù hợp: theo cổng + từ khoá (bỏ dấu). Phải khớp đủ nhiều từ có nghĩa — câu hỏi không liên quan trả về rỗng.
export function searchFaq(q: string, portal: RoleKey, limit = 6) {
  const words = [...new Set(norm(q.toLowerCase()).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)))]
  const fit = FAQ.filter(f => !f.portals || f.portals.includes(portal))
  if (!words.length) return q.trim() ? [] : fit.slice(0, limit)
  const need = words.length <= 2 ? words.length : Math.ceil(words.length * 0.5)
  const toks = (t: string) => ' ' + norm(t.toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' '
  return fit.map(f => {
    const hay = toks(`${f.q} ${f.keys ?? ''}`), body = toks(f.a)
    const hit = words.filter(w => hay.includes(' ' + w + ' ')).length
    // cụm 2 từ liền nhau (vd "don vi", "diem danh") khớp được cộng thêm
    const pairs = words.slice(1).filter((w, i) => hay.includes(' ' + words[i] + ' ' + w + ' ')).length
    return { f, hit, s: hit * 3 + pairs * 4 + words.filter(w => body.includes(' ' + w + ' ')).length }
  }).filter(x => x.hit >= need).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.f)
}
