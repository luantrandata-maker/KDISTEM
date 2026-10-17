import { useState } from 'react'
import { Tiles } from '../department/charts'
import { Tabs } from '../teacher/common'
import { NAV, labelOf } from '../../lib/nav'

// Khung giao diện cho các phân hệ của cổng Quản trị nền tảng chưa có chức năng thật.
// Dữ liệu dưới đây là MINH HOẠ để duyệt bố cục; khi build phân hệ, thay trang này bằng trang thật trong App.tsx.

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'new'
type Kpi = [label: string, value: string, sub?: string, tone?: 'good' | 'warn' | 'bad']
type Card = [tone: Tone, title: string, body: string, meta: string]
type Cfg = {
  desc: string; primary?: string; action?: string
  kpis?: Kpi[]; cards?: Card[]; tabs?: string[]; cols: string[]; rows: string[][]
}

const S = ['THCS Lê Quý Đôn', 'TH Kim Đồng', 'THCS Nguyễn Trãi', 'TH&THCS Hoà Bình']

// Ô bảng: "~tone:Nhãn" → nhãn trạng thái; "%72" → thanh phần trăm; còn lại là chữ
export const PLANNED: Record<string, Cfg> = {
  'Thuật ngữ chuẩn': { desc: 'Từ điển dùng chung để mọi phân hệ, báo cáo và trợ lý AI hiểu cùng một nghĩa.', primary: 'Thêm thuật ngữ',
    tabs: ['Tất cả', 'Đào tạo', 'Thiết bị', 'Kinh doanh'], cols: ['Thuật ngữ', 'Định nghĩa', 'Mã', 'Phân hệ dùng'],
    rows: [['Buổi dạy', 'Một lần lên lớp theo TKB, gắn với lớp, GV, phòng và chủ đề', 'SESSION', 'Lịch dạy, Điểm danh'], ['Chủ đề STEM', 'Đơn vị nội dung gồm nhiều buổi, thuộc 1 chương trình CT1–CT5', 'TOPIC', 'Chương trình, Học liệu'], ['Tỉ lệ chuyên cần', 'Số lượt có mặt / số lượt phải có mặt trong kỳ', 'ATT_RATE', 'Dashboard, KPI'], ['Phiếu mượn', 'Yêu cầu mượn thiết bị/phòng có thời hạn trả', 'LOAN', 'Thiết bị, Phòng STEM'], ['Nghiệm thu', 'Xác nhận hoàn thành một đợt dịch vụ theo hợp đồng', 'ACCEPT', 'Thương mại']] },

  'Giao diện & thương hiệu': { desc: 'Logo, màu chủ đạo và tên miền riêng cho từng đơn vị khách hàng.', primary: 'Lưu thay đổi',
    cards: [['info', 'Logo & favicon', 'PNG/SVG nền trong, tối thiểu 256px', 'Đã tải lên'], ['warn', 'Màu chủ đạo', 'Navy #152E5D · nhấn cam #F2A53F', 'Áp dụng toàn hệ thống'], ['ok', 'Tên miền', '[TÊN MIỀN]', 'SSL hợp lệ']],
    tabs: ['Theo đơn vị'], cols: ['Đơn vị', 'Tên miền', 'Giao diện', 'Trạng thái'],
    rows: [['KDI Education', '[TÊN MIỀN]', 'Mặc định', '~ok:Hoạt động'], [S[0], '[TÊN MIỀN TRƯỜNG]', 'Theo trường', '~ok:Hoạt động'], [S[1], '—', 'Mặc định', '~mute:Chưa cấu hình']] },
  'Trợ lý AI': { desc: 'Trợ lý AI trả lời theo dữ liệu và quyền của người hỏi.', kpis: [['Lượt hỏi tuần', '412', '+18% so với tuần trước', 'good'], ['Người dùng', '57', 'trên 4 cơ sở'], ['Câu trả lời bị đánh giá thấp', '9', 'cần xem lại', 'warn']],
    tabs: ['Nhật ký hỏi đáp', 'Nguồn tri thức', 'Cấu hình'], cols: ['Câu hỏi', 'Vai trò', 'Phân hệ', 'Thời gian', 'Đánh giá'], action: 'Xem',
    rows: [['Lớp nào chưa điểm danh hôm nay?', 'Quản trị trường', 'Điểm danh', '09:12', '~ok:Hữu ích'], ['Gợi ý thiết bị cho chủ đề Robot dò line', 'Giáo viên', 'Học liệu', '08:47', '~ok:Hữu ích'], ['Tổng thiết bị quá hạn trả tháng 10', 'Kho', 'Thiết bị', 'Hôm qua', '~warn:Chưa đúng']] },
  'E-learning & luyện thi': { desc: 'Khoá học trực tuyến và đề luyện thi cho học sinh, có theo dõi hoàn thành.', primary: 'Tạo khoá học',
    tabs: ['Khoá học', 'Đề luyện thi', 'Kết quả'], cols: ['Khoá học', 'Đối tượng', 'Bài học', 'Học viên', 'Hoàn thành', 'Trạng thái'], action: 'Mở',
    rows: [['Lập trình Scratch cơ bản', 'Khối 6', '12', '214', '%62', '~ok:Đang mở'], ['Ôn thi KHKT cấp tỉnh', 'Khối 8–9', '8', '46', '%35', '~ok:Đang mở'], ['Robot & cảm biến', 'Khối 7', '10', '0', '%0', '~mute:Nháp']] },

  'Nhà giáo & trợ giảng': { desc: 'Hồ sơ giáo viên và trợ giảng trên toàn hệ thống: môn dạy, cơ sở, lớp phụ trách.', primary: 'Thêm giáo viên',
    tabs: ['Giáo viên', 'Trợ giảng'], cols: ['Họ tên', 'Cơ sở', 'Môn', 'Lớp phụ trách', 'Chứng chỉ STEM', 'Trạng thái'], action: 'Xem',
    rows: [['Nguyễn Thu Hà', S[0], 'KHTN', '7A, 7B, 8B', '~ok:Có', '~ok:Đang dạy'], ['Trần Minh Đức', S[0], 'Tin học', '6A, 9A', '~ok:Có', '~ok:Đang dạy'], ['Lê Thị Lan', S[1], 'Công nghệ', '4A, 5B', '~warn:Đang học', '~ok:Đang dạy'], ['Phạm Quốc Huy', S[2], 'Toán', '8A', '~mute:Chưa', '~ok:Đang dạy']] },
  'Người học': { desc: 'Hồ sơ học sinh, lớp, chương trình tham gia, chuyên cần và liên hệ phụ huynh. Nhập nhanh từ Excel hoặc CSDL ngành.', primary: 'Nhập từ Excel',
    kpis: [['Tổng học sinh', '1.284', 'HK I 2026–2027'], ['Đã liên kết phụ huynh', '71%', '912 tài khoản', 'warn'], ['Chuyên cần TB', '94%', '4 tuần gần nhất', 'good'], ['Thiếu thông tin', '23', 'cần bổ sung', 'bad']],
    tabs: ['Tất cả', 'Thiếu thông tin', 'Đã chuyển trường'], cols: ['Mã HS', 'Họ tên', 'Lớp', 'Cơ sở', 'Chuyên cần', 'Phụ huynh', 'Trạng thái'], action: 'Xem',
    rows: [['HS0712', 'Đỗ Minh Khoa', '7A', S[0], '%97', '~ok:Đã liên kết', '~ok:Đang học'], ['HS0713', 'Ngô Bảo Anh', '7A', S[0], '%88', '~mute:Chưa', '~ok:Đang học'], ['HS0521', 'Vũ Gia Huy', '5B', S[1], '%95', '~ok:Đã liên kết', '~ok:Đang học'], ['HS0804', 'Hoàng Thảo My', '8A', S[2], '%72', '~ok:Đã liên kết', '~warn:Cần theo dõi']] },
  'Hồ sơ năng lực, đào tạo': { desc: 'Chứng chỉ, giờ tập huấn và cấp độ năng lực STEM của từng giáo viên.', tabs: ['Năng lực', 'Chứng chỉ sắp hết hạn'],
    cols: ['Giáo viên', 'Cơ sở', 'Giờ tập huấn', 'Cấp độ', 'Chứng chỉ hết hạn'],
    rows: [['Nguyễn Thu Hà', S[0], '%100', '~ok:Nâng cao', '06/2028'], ['Trần Minh Đức', S[0], '%80', '~info:Thành thạo', '12/2026'], ['Lê Thị Lan', S[1], '%45', '~warn:Cơ bản', '—'], ['Phạm Quốc Huy', S[2], '%10', '~mute:Mới', '—']] },
  'Cổng người học & phụ huynh': { desc: 'Quản lý tài khoản và nội dung hiển thị cho học sinh và phụ huynh.', primary: 'Gửi thông báo',
    kpis: [['Phụ huynh đã kích hoạt', '912', '71% số HS', 'warn'], ['HS đăng nhập tuần này', '1.036', '81%', 'good'], ['Tin nhắn chưa trả lời', '7', 'quá 24 giờ', 'bad']],
    tabs: ['Thông báo gửi phụ huynh', 'Tài khoản'], cols: ['Nội dung', 'Đối tượng', 'Kênh', 'Gửi lúc', 'Đã đọc'],
    rows: [['Lịch Ngày hội STEM 25/10', 'Toàn bộ PH', 'App · Zalo', '14/10 16:00', '%68'], ['Kết quả chủ đề Xe dò line', 'PH lớp 7A', 'App', '13/10 20:10', '%82'], ['Nhắc mang dụng cụ buổi 3', 'PH lớp 8B', 'App', '12/10 19:00', '%74']] },

  'Sự kiện': { desc: 'Ngày hội STEM, cuộc thi, tham quan — có đăng ký, phân công và tổng kết.', primary: 'Tạo sự kiện',
    tabs: ['Sắp diễn ra', 'Đã kết thúc'], cols: ['Sự kiện', 'Loại', 'Ngày', 'Địa điểm', 'Đăng ký', 'Trạng thái'], action: 'Mở',
    rows: [['Ngày hội STEM khối THCS', 'Ngày hội', '25/10/2026', S[0], '214', '~ok:Mở đăng ký'], ['Vòng loại cuộc thi Robot', 'Cuộc thi', '08/11/2026', 'Nhà văn hoá tỉnh', '18 đội', '~warn:Chờ duyệt'], ['Tham quan nhà máy điện mặt trời', 'Tham quan', '20/11/2026', 'Ngoài trường', '0', '~mute:Nháp']] },
  'Buổi dạy & điểm danh': { desc: 'Buổi dạy sinh từ TKB; giáo viên điểm danh trên điện thoại, hệ thống cảnh báo buổi chưa điểm danh.',
    kpis: [['Buổi hôm nay', '2', '1 đã điểm danh'], ['Chuyên cần tuần', '94%', '+1 điểm', 'good'], ['Chưa điểm danh', '1', 'quá 30 phút', 'bad']],
    tabs: ['Hôm nay', 'Tuần này', 'Chưa điểm danh'], cols: ['Ngày · Tiết', 'Lớp', 'Chủ đề', 'Giáo viên', 'Có mặt', 'Trạng thái'], action: 'Mở',
    rows: [['15/10 · Tiết 3', '7A', 'Xe tự hành – buổi 3', 'Nguyễn Thu Hà', '34/35', '~ok:Đã điểm danh'], ['15/10 · Tiết 5', '6A', 'Scratch – vòng lặp', 'Trần Minh Đức', '—', '~bad:Chưa điểm danh'], ['14/10 · Tiết 2', '8B', 'Lọc nước – buổi 1', 'Nguyễn Thu Hà', '30/32', '~ok:Đã điểm danh']] },

  'Đánh giá kết quả học tập': { desc: 'Chấm theo rubric STEM (ý tưởng, thiết kế, sản phẩm, trình bày) cho cá nhân hoặc nhóm.', primary: 'Tạo rubric',
    tabs: ['Kết quả', 'Rubric', 'Chưa chấm'], cols: ['Học sinh / Nhóm', 'Chủ đề', 'Ý tưởng', 'Thiết kế', 'Sản phẩm', 'Trình bày', 'Xếp loại'], action: 'Chi tiết',
    rows: [['Nhóm 1 – 7A', 'Xe tự hành dò line', '9', '8', '9', '8', '~ok:Tốt'], ['Nhóm 2 – 7A', 'Xe tự hành dò line', '7', '7', '6', '8', '~info:Khá'], ['Nhóm 3 – 7A', 'Xe tự hành dò line', '6', '5', '5', '6', '~warn:Đạt'], ['Nhóm 1 – 8B', 'Lọc nước sinh hoạt', '—', '—', '—', '—', '~mute:Chưa chấm']] },
  'Đánh giá năng lực giáo viên': { desc: 'Đánh giá năng lực dạy STEM của giáo viên theo khung tiêu chí: tự đánh giá, tổ chuyên môn và Ban giám hiệu đánh giá, gắn với kết quả tập huấn và giờ dạy STEM thực tế.', primary: 'Mở đợt đánh giá',
    kpis: [['Đã đánh giá', '68%', '87 / 128 giáo viên', 'warn'], ['Đạt mức Thành thạo trở lên', '54%', ''], ['Cần bồi dưỡng', '12', 'đề xuất tập huấn', 'bad']],
    tabs: ['Đợt HK I', 'Khung tiêu chí', 'Đề xuất bồi dưỡng'], cols: ['Giáo viên', 'Cơ sở', 'Tự đánh giá', 'Tổ chuyên môn', 'BGH', 'Mức', 'Trạng thái'], action: 'Chi tiết',
    rows: [['Nguyễn Thu Hà', S[0], 'Tốt', 'Tốt', 'Tốt', '~ok:Nâng cao', '~ok:Hoàn thành'], ['Trần Minh Đức', S[0], 'Khá', 'Tốt', '—', '~info:Thành thạo', '~warn:Chờ BGH'], ['Lê Thị Lan', S[1], 'Khá', '—', '—', '—', '~mute:Chờ tổ CM'], ['Phạm Quốc Bảo', S[2], 'Đạt', 'Đạt', 'Đạt', '~warn:Cơ bản', '~ok:Hoàn thành']] },
  'Mua hàng & đề xuất vật tư': { desc: 'Trường đề xuất mua thiết bị, vật tư tiêu hao theo chủ đề STEM; duyệt theo quy trình, KDI báo giá, giao hàng và nhập kho cơ sở.', primary: 'Tạo đề xuất',
    kpis: [['Đề xuất chờ duyệt', '5', ''], ['Đang giao', '3', 'đơn hàng'], ['Giá trị năm học', '486 tr', 'đã duyệt', 'good']],
    tabs: ['Đề xuất', 'Đơn hàng', 'Nhập kho'], cols: ['Mã', 'Đơn vị', 'Nội dung', 'Giá trị', 'Bước duyệt', 'Trạng thái'], action: 'Mở',
    rows: [['DX-0142', S[0], 'Bộ cảm biến Arduino × 20', '18,4 tr', 'Hiệu trưởng', '~warn:Chờ duyệt'], ['DX-0139', S[1], 'Vật tư chủ đề Lọc nước', '3,2 tr', 'KDI báo giá', '~info:Đang báo giá'], ['DX-0131', S[2], 'Robot mBot × 10', '42,0 tr', '—', '~ok:Đã giao'], ['DX-0128', S[3], 'Máy in 3D', '25,5 tr', 'Sở GD&ĐT', '~warn:Chờ duyệt']] },
  'Chỉ tiêu & bộ chỉ số': { desc: 'Sở giao chỉ tiêu STEM theo năm học cho trường/xã (số chủ đề, tiết STEM, GV đạt tập huấn, sử dụng phòng); bộ chỉ số và STEM Index tính tự động từ dữ liệu vận hành.', primary: 'Giao chỉ tiêu',
    kpis: [['Trường đạt chỉ tiêu', '14/21', 'HK I', 'warn'], ['STEM Index toàn tỉnh', '72', '+5 so với năm trước', 'good'], ['Chỉ số dưới ngưỡng', '3', 'cần can thiệp', 'bad']],
    tabs: ['Chỉ tiêu', 'Bộ chỉ số', 'STEM Index'], cols: ['Chỉ số', 'Đơn vị nhận', 'Chỉ tiêu', 'Thực hiện', 'Tiến độ', 'Trạng thái'], action: 'Chi tiết',
    rows: [['Tiết STEM / lớp / tháng', 'Toàn tỉnh', '4', '3,6', '%90', '~ok:Đúng tiến độ'], ['GV đạt tập huấn STEM', 'Toàn tỉnh', '80%', '68%', '%85', '~warn:Chậm'], ['Công suất phòng STEM', S[1], '60%', '31%', '%52', '~bad:Dưới ngưỡng'], ['Chủ đề CT1–CT5 / năm', S[0], '5', '4', '%80', '~ok:Đúng tiến độ']] },
  'Cảnh báo & so sánh trường': { desc: 'Tự phát hiện trường cần chú ý (không dạy STEM, chưa điểm danh, phòng bỏ trống, thiết bị hỏng nhiều) và so sánh giữa trường, xã/phường, cùng cấp học.', primary: 'Cấu hình cảnh báo',
    kpis: [['Trường cần chú ý', '4', 'tuần này', 'bad'], ['Cảnh báo mới', '7', ''], ['Đã xử lý', '11', '30 ngày qua', 'good']],
    tabs: ['Cảnh báo', 'So sánh trường', 'So sánh xã/phường'], cols: ['Trường', 'Cảnh báo', 'Từ ngày', 'Mức', 'Người phụ trách', 'Trạng thái'], action: 'Xem',
    rows: [[S[1], 'Không có tiết STEM 14 ngày', '02/10', '~bad:Cao', 'Chuyên viên Sở', '~warn:Đang xử lý'], [S[2], '35% tiết chưa điểm danh', '09/10', '~warn:Trung bình', 'Hiệu trưởng', '~mute:Mới'], [S[3], 'Phòng STEM dùng < 20%', '01/10', '~warn:Trung bình', 'KDI', '~ok:Đã xử lý']] },
  'Khảo sát': { desc: 'Phiếu khảo sát gửi giáo viên, học sinh, phụ huynh, cán bộ quản lý: hài lòng sau chủ đề STEM, chất lượng tập huấn, nhu cầu thiết bị. Gửi theo đơn vị/vai trò, ẩn danh tuỳ chọn, tổng hợp theo trường và Sở.', primary: 'Tạo khảo sát',
    kpis: [['Đang mở', '3', 'phiếu khảo sát'], ['Tỉ lệ phản hồi', '64%', '1.812 / 2.830 người nhận', 'warn'], ['Hài lòng TB', '4,3/5', 'chủ đề STEM HK I', 'good'], ['Sắp đóng', '1', 'trong 3 ngày', 'warn']],
    tabs: ['Đang mở', 'Đã đóng', 'Mẫu phiếu'], cols: ['Khảo sát', 'Đối tượng', 'Phạm vi', 'Hạn', 'Phản hồi', 'Trạng thái'], action: 'Kết quả',
    rows: [['Mức độ hài lòng sau chủ đề Xe tự hành', 'Học sinh khối 7', 'Sở GD&ĐT Hưng Yên', '30/10/2026', '%71', '~ok:Đang mở'], ['Đánh giá đợt tập huấn GV mô-đun 2', 'Giáo viên STEM', 'Toàn hệ thống', '20/10/2026', '%86', '~warn:Sắp đóng'], ['Nhu cầu thiết bị năm học 2027–2028', 'Cán bộ quản lý', 'Toàn hệ thống', '15/11/2026', '%22', '~ok:Đang mở'], ['Ý kiến phụ huynh về Ngày hội STEM', 'Phụ huynh', S[0], '05/10/2026', '%58', '~mute:Đã đóng']] },
  'Thiết bị, vật tư & kho': { desc: 'Danh mục thiết bị, tồn kho theo cơ sở, phiếu mượn – trả và tình trạng trên toàn hệ thống.', primary: 'Nhập kho',
    kpis: [['Tổng thiết bị', '31', 'mã quản lý'], ['Đang mượn', '12', '39%'], ['Quá hạn trả', '3', 'cần nhắc', 'bad'], ['Hỏng / bảo trì', '2', '', 'warn']],
    tabs: ['Thiết bị', 'Phiếu mượn', 'Vật tư tiêu hao'], cols: ['Mã', 'Tên thiết bị', 'Kho', 'Tồn', 'Đang mượn', 'Tình trạng'], action: 'Xem',
    rows: [['A-014', 'Bộ robot giáo dục', S[0], '10', '6', '~ok:Tốt'], ['B-102', 'Kit Arduino Uno + cảm biến', S[0], '8', '4', '~warn:Quá hạn trả 2'], ['C-033', 'Máy in 3D', S[1], '1', '0', '~bad:Bảo trì'], ['D-210', 'Bộ thí nghiệm lọc nước', S[2], '8', '2', '~ok:Tốt']] },
  'Kiểm kê': { desc: 'Tạo đợt kiểm kê, quét QR thiết bị trên điện thoại, tự đối chiếu sổ sách và chênh lệch.', primary: 'Tạo đợt kiểm kê',
    tabs: ['Đợt kiểm kê'], cols: ['Đợt', 'Kho', 'Ngày', 'Số mục', 'Khớp', 'Lệch', 'Trạng thái'], action: 'Mở',
    rows: [['KK-2026-10', S[0], '20/10/2026', '18', '—', '—', '~mute:Lên lịch'], ['KK-2026-09', S[1], '28/09/2026', '9', '8', '1', '~warn:Chờ giải trình'], ['KK-2026-06', S[0], '25/06/2026', '17', '17', '0', '~ok:Hoàn tất']] },
  'Vận chuyển vật tư': { desc: 'Điều chuyển thiết bị/vật tư giữa kho tổng và các cơ sở, có xác nhận giao – nhận.', primary: 'Tạo phiếu chuyển',
    tabs: ['Đang vận chuyển', 'Đã nhận'], cols: ['Mã', 'Từ', 'Đến', 'Số kiện', 'Ngày gửi', 'Trạng thái'], action: 'Xem',
    rows: [['VC-0045', 'Kho tổng KDI', S[3], '4', '14/10', '~info:Đang giao'], ['VC-0044', S[0], S[2], '1', '10/10', '~ok:Đã nhận'], ['VC-0043', 'Kho tổng KDI', S[1], '2', '08/10', '~ok:Đã nhận']] },
  'Phòng STEM & lịch phòng': { desc: 'Danh sách phòng STEM và phiếu đặt phòng; đặt trùng sẽ bị chặn ngay khi gửi.', primary: 'Đặt phòng',
    tabs: ['Phiếu đặt phòng', 'Danh sách phòng'], cols: ['Ngày · Giờ', 'Phòng', 'Lớp', 'Nội dung', 'Người đặt', 'Trạng thái'], action: 'Duyệt',
    rows: [['16/10 · 08:00–09:30', 'Phòng STEM 1', '7B', 'Xe tự hành – buổi 4', 'Nguyễn Thu Hà', '~warn:Chờ duyệt'], ['16/10 · 14:00–15:30', 'Phòng STEM 2', '9A', 'Nhà kính thông minh', 'Trần Minh Đức', '~ok:Đã duyệt'], ['15/10 · 09:00–10:30', 'Phòng STEM 1', '7A', 'Xe tự hành – buổi 3', 'Nguyễn Thu Hà', '~mute:Đã trả phòng']] },

  'Dashboard điểm danh': { desc: 'Chuyên cần theo cơ sở, lớp và tuần; cảnh báo học sinh vắng nhiều.',
    kpis: [['Chuyên cần tuần', '94%', '+1 điểm', 'good'], ['HS vắng ≥3 buổi', '17', 'cần liên hệ PH', 'bad'], ['Buổi chưa điểm danh', '1', 'hôm nay', 'warn']],
    tabs: ['Theo lớp', 'HS vắng nhiều'], cols: ['Lớp', 'Cơ sở', 'Sĩ số', 'Chuyên cần', 'Vắng có phép', 'Vắng không phép'],
    rows: [['7A', S[0], '35', '%97', '2', '0'], ['8B', S[0], '32', '%94', '3', '1'], ['5B', S[1], '30', '%95', '2', '1'], ['8A', S[2], '33', '%86', '3', '4']] },
  'Nghiệm thu & doanh thu': { desc: 'Nghiệm thu theo đợt, đối chiếu công nợ và ghi nhận doanh thu.',
    kpis: [['Doanh thu ghi nhận', '[SỐ TIỀN]', 'năm học 2026–27'], ['Chờ nghiệm thu', '2', 'đợt'], ['Công nợ quá hạn', '1', 'khách hàng', 'bad']],
    tabs: ['Đợt nghiệm thu', 'Công nợ'], cols: ['Hợp đồng', 'Đợt', 'Giá trị', 'Ngày nghiệm thu', 'Đã thu', 'Trạng thái'], action: 'Mở',
    rows: [['HĐ-2026-014', 'Đợt 1 – Triển khai', '[GIÁ TRỊ]', '30/09', '%100', '~ok:Đã thu'], ['HĐ-2026-011', 'Đợt 1 – Triển khai', '[GIÁ TRỊ]', '05/10', '%50', '~warn:Thu một phần'], ['HĐ-2025-006', 'Đợt 3 – Kết thúc', '[GIÁ TRỊ]', '—', '%0', '~mute:Chờ nghiệm thu']] },

  'Ứng dụng di động & ngoại tuyến': { desc: 'Ứng dụng cho giáo viên điểm danh, mượn thiết bị khi mất mạng; tự đồng bộ khi có mạng lại.',
    kpis: [['Thiết bị đang dùng', '52', 'iOS 21 · Android 31'], ['Dữ liệu chờ đồng bộ', '3', 'bản ghi', 'warn'], ['Phiên bản mới nhất', '0.9.2', '87% đã cập nhật']],
    tabs: ['Thiết bị', 'Phiên bản'], cols: ['Người dùng', 'Thiết bị', 'Phiên bản', 'Chờ đồng bộ', 'Online lần cuối'],
    rows: [['Nguyễn Thu Hà', 'iPhone 13', '0.9.2', '0', '5 phút trước'], ['Lê Thị Lan', 'Galaxy A54', '0.9.1', '3', '2 giờ trước'], ['kho.lqd', 'Redmi Note 12', '0.9.2', '0', '1 giờ trước']] },
  'Sao lưu & xuất dữ liệu': { desc: 'Sao lưu tự động mỗi đêm, khôi phục theo thời điểm và xuất dữ liệu theo yêu cầu của khách hàng.', primary: 'Sao lưu ngay',
    tabs: ['Bản sao lưu', 'Yêu cầu xuất dữ liệu'], cols: ['Thời điểm', 'Loại', 'Dung lượng', 'Lưu tới', 'Trạng thái'], action: 'Khôi phục',
    rows: [['15/10 02:00', 'Tự động', '1,8 GB', '14/11/2026', '~ok:Thành công'], ['14/10 02:00', 'Tự động', '1,8 GB', '13/11/2026', '~ok:Thành công'], ['10/10 21:30', 'Thủ công', '1,7 GB', '10/01/2027', '~ok:Thành công']] },
}

function Cell({ v }: { v: string }) {
  if (v.startsWith('~')) { const [t, ...l] = v.slice(1).split(':'); return <span className={'plbadge ' + t}>{l.join(':')}</span> }
  if (v.startsWith('%')) {
    const n = Number(v.slice(1))
    return <span className="plbar"><span className="track"><span className={'fill ' + (n >= 75 ? 'g' : n >= 50 ? 'b' : 'o')} style={{ width: n + '%' }} /></span><small>{n}%</small></span>
  }
  return <>{v}</>
}

function Notice() {
  return (
    <p className="plnote" role="note"><b>Bản đề xuất</b> Phân hệ này mới có khung giao diện, số liệu là minh hoạ. Các nút thao tác chưa hoạt động.</p>
  )
}

// Trang khung cho một mục menu chưa có chức năng thật
// Tên mục theo menu rà soát (16/10) dùng lại khung của tên cũ
const ALIAS: Record<string, string> = {
  'Đánh giá năng lực người học': 'Đánh giá kết quả học tập', 'Công cụ người học & phụ huynh': 'Cổng người học & phụ huynh',
  'Bộ chỉ số': 'Chỉ tiêu & bộ chỉ số', 'Giao chỉ tiêu': 'Chỉ tiêu & bộ chỉ số',
  'Cảnh báo & trường cần chú ý': 'Cảnh báo & so sánh trường', 'So sánh trường / địa bàn': 'Cảnh báo & so sánh trường',
}
// Mục mới chưa có khung minh hoạ: mô tả phạm vi để họp team
const DESC: Record<string, string> = {
  'Bài giảng tập huấn & lớp học ảo': 'Bài giảng và phòng học trực tuyến của các đợt tập huấn trên toàn hệ thống (trường đã có ở cổng Trường).',
  'Chứng chỉ tập huấn': 'Chứng chỉ cấp sau tập huấn: tra cứu, thu hồi, thống kê theo Sở/trường (trường đã có ở cổng Trường).',
  'Phân phối chương trình': 'Phân phối chương trình CT1–CT5 theo khối, số tiết; mẫu chung để trường áp dụng (trường đã có ở cổng Trường).',
  'Soạn bài giảng & kho hoạt động': 'Thống kê bài giảng và 8 mẫu hoạt động tương tác trên toàn hệ thống; quản lý mẫu dùng chung (giáo viên đã có ở cổng Giáo viên).',
  'Kho & tồn kho': 'Kho tổng KDI và kho từng cơ sở: tồn kho thiết bị, vật tư tiêu hao, cảnh báo dưới mức tối thiểu.',
  'Cấp phát & bàn giao': 'Cấp phát thiết bị/vật tư cho trường, lớp; biên bản bàn giao có ký xác nhận.',
  'Bảo hành & bảo trì thiết bị': 'Phiếu bảo hành, lịch bảo trì định kỳ và thiết bị sắp hết bảo hành trên toàn hệ thống (trường đã có ở cổng Trường).',
  'Tòa nhà, tầng & tiết học': 'Khai báo toà nhà, tầng, cấu hình tiết học của từng trường; mẫu chung cho trường mới (trường đã có ở cổng Trường).',
  'Phân công giảng dạy': 'Phân công giáo viên dạy lớp, môn trên toàn hệ thống; phát hiện lớp chưa có GV (trường đã có ở cổng Trường).',
  'Kế hoạch giáo dục toàn trường': 'Kế hoạch giáo dục của các trường và trạng thái duyệt (trường đã có ở cổng Trường).',
  'Duyệt đăng ký dạy STEM': 'Đăng ký dạy STEM chờ duyệt trên toàn hệ thống (trường đã có ở cổng Trường).',
  'Bài tập & chấm bài': 'Thống kê bài tập, bài nộp, tỉ lệ đã chấm theo trường/lớp (giáo viên đã có ở cổng Giáo viên).',
  'Chỉ số STEM (STEM Index)': 'Chỉ số tổng hợp mức độ triển khai STEM của trường/xã/tỉnh từ chương trình, tập huấn, phòng, buổi dạy.',
  'Dashboard tổng hợp': 'Màn tổng hợp các chỉ số chính của mọi phân hệ cho lãnh đạo, theo phạm vi quyền.',
  'Điều hành toàn tỉnh': 'Bảng điều hành của Sở: tiến độ 5 bước đề án, việc cần chỉ đạo, trường chậm tiến độ.',
}

export function PlannedPage({ name }: { name: string }) {
  const cfg = PLANNED[name] ?? PLANNED[ALIAS[name] ?? '']
  const [tab, setTab] = useState('0')
  const [q, setQ] = useState('')
  if (name === 'Thời khóa biểu & xếp lịch') return <TimetableMock />
  if (!cfg) return <><Notice /><p className="sub">{DESC[name] ?? 'Màn hình này sẽ được xây dựng ở bước tiếp theo.'}</p></>
  const rows = cfg.rows.filter(r => !q || r.join(' ').toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <Notice />
      <div className="bar plhead">
        <p className="sub">{cfg.desc}</p>
        <div className="plactions">
          <button type="button" disabled title="Đang phát triển">Xuất Excel</button>
          {cfg.primary && <button type="button" className="primary" disabled title="Đang phát triển">+ {cfg.primary}</button>}
        </div>
      </div>
      {cfg.kpis && <Tiles items={cfg.kpis.map(([label, value, sub, tone]) => ({ label, value, sub, tone }))} />}
      {cfg.cards && (
        <div className="plcards">
          {cfg.cards.map(([t, title, body, meta]) => (
            <div className="panel plcard" key={title}><i className={'pldot ' + t} aria-hidden="true" /><b>{title}</b><span>{body}</span><small>{meta}</small></div>
          ))}
        </div>
      )}
      <div className="bar">
        <Tabs items={(cfg.tabs ?? ['Tất cả']).map((t, i) => [String(i), t] as [string, string])} value={tab} onChange={setTab} />
        <input className="search" type="search" placeholder="Tìm trong bảng…" aria-label="Tìm trong bảng" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="wrap">
        <table>
          <thead><tr>{cfg.cols.map(c => <th key={c}>{c}</th>)}{cfg.action && <th aria-label="Thao tác" />}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => <td key={j}>{j === 0 ? <b><Cell v={v} /></b> : <Cell v={v} />}</td>)}
                {cfg.action && <td><button type="button" disabled title="Đang phát triển">{cfg.action}</button></td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={cfg.cols.length + (cfg.action ? 1 : 0)}>Không có dòng nào khớp “{q}”.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Thời khoá biểu toàn hệ thống: lưới tuần có cảnh báo trùng phòng/giáo viên (minh hoạ)
const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6']
const PERIODS = [['Tiết 1', '07:15'], ['Tiết 2', '08:05'], ['Tiết 3', '09:05'], ['Tiết 4', '09:55'], ['Tiết 5', '10:45']]
const TKB: Record<string, [string, string, 's' | 'n' | 'c']> = {
  '0-0': ['7A · Xe tự hành – buổi 1', 'STEM 1 · Thu Hà', 's'], '0-2': ['6A · Scratch – biến', 'P.Tin · Minh Đức', 'n'],
  '1-1': ['8B · Lọc nước – buổi 1', 'STEM 1 · Thu Hà', 's'], '1-3': ['9A · Nhà kính – buổi 2', 'STEM 2 · Minh Đức', 's'],
  '2-2': ['7A + 8B · Trùng Phòng STEM 1', 'Thu Hà · Quốc Huy', 'c'], '2-4': ['7B · KHTN – Lực', 'P.204 · Thu Hà', 'n'],
  '3-2': ['7A · Xe tự hành – buổi 3', 'STEM 1 · Thu Hà', 's'], '3-4': ['6A · Scratch – vòng lặp', 'P.Tin · Minh Đức', 's'],
  '4-0': ['7B · Xe tự hành – buổi 4', 'STEM 1 · Thu Hà', 's'], '4-1': ['8A · Toán – Hàm số', 'P.302 · Quốc Huy', 'n'],
}
const KIND = { s: 'Tiết STEM', n: 'Tiết thường', c: 'Xung đột' }

function TimetableMock() {
  return (
    <>
      <Notice />
      <div className="bar plhead">
        <p className="sub">Xếp thời khoá biểu có kiểm tra trùng giáo viên, phòng STEM và thiết bị. TKB tự sinh buổi dạy để điểm danh.</p>
        <div className="plactions">
          <button type="button" disabled title="Đang phát triển">Kiểm tra trùng lịch</button>
          <button type="button" className="primary" disabled title="Đang phát triển">Tự xếp lịch STEM</button>
        </div>
      </div>
      <div className="panel plfilters">
        <label>Cơ sở<select>{S.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Xem theo<select><option>Phòng STEM 1</option><option>Lớp 7A</option><option>GV Nguyễn Thu Hà</option></select></label>
        <label>Tuần<select><option>Tuần 7 · 12/10 – 17/10</option><option>Tuần 8 · 19/10 – 24/10</option></select></label>
      </div>
      <p className="plconflict"><span className="plbadge bad">1 xung đột</span> Phòng STEM 1 — Thứ 4, tiết 3 đang xếp cho cả <b>7A</b> và <b>8B</b>. Gợi ý: chuyển 8B sang Phòng STEM 2 (trống).</p>
      <div className="wrap">
        <table className="pltkb">
          <thead><tr><th>Tiết</th>{DAYS.map(d => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>
            {PERIODS.map(([p, t], pi) => (
              <tr key={p}>
                <td><b>{p}</b><br /><small>{t}</small></td>
                {DAYS.map((d, di) => {
                  const e = TKB[di + '-' + pi]
                  return <td key={d}>{e && <div className={'plslot ' + e[2]}><b>{e[0]}</b><span>{e[1]}</span><small>{KIND[e[2]]}</small></div>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Sơ đồ hệ thống: tách 2 phần — (A) Quản trị hệ thống: phần chung KDI vận hành toàn nền tảng;
// (B) 5 phân hệ nghiệp vụ: đơn vị bán theo gói, trường / Sở sử dụng. Mục nào đã chạy thật, mục nào mới là khung.
const ADMIN_GROUPS = ['Vận hành KDI', 'Lõi · Tổ chức & quy trình', 'Quản trị chung · Kỹ thuật & bảo mật']
const ADMIN_NOTE: Record<string, string> = {
  'Vận hành KDI': 'Khách hàng, hợp đồng, triển khai',
  'Lõi · Tổ chức & quy trình': 'Tổ chức, tài khoản, quyền, phê duyệt',
  'Quản trị chung · Kỹ thuật & bảo mật': 'Dữ liệu, bảo mật, cấu hình toàn hệ thống',
}
const PH_NOTE: Record<string, string> = {
  '1': 'Năng lực và tập huấn giáo viên',
  '2': 'Chương trình, học liệu, bài giảng',
  '3': 'Thiết bị, kho, phòng STEM',
  '4': 'Lớp học, lịch dạy, điểm danh, đánh giá',
  '5': 'Báo cáo, điều hành và quản trị theo đơn vị',
}
type Sub = { title: string; items: string[] }
type Ph = { num: string; title: string; subs: Sub[] }

function MapItems({ items, live, go, shared }: { items: string[]; live: Set<string>; go?: (p: string) => void; shared?: Set<string> }) {
  return (
    <ul className="smitems">
      {items.map(i => {
        const on = live.has(i)
        return (
          <li key={i} className={on ? 'on' : 'off'}>
            <i aria-hidden="true" />
            <button type="button" className="linkbtn" onClick={() => go?.(i)}>{labelOf('platform', i)}</button>
            {shared?.has(i) && <small className="smshared" title="Cùng trang với mục ở Quản trị hệ thống">dùng chung</small>}
            {!on && <small className="smframe">Khung</small>}
          </li>
        )
      })}
    </ul>
  )
}

function Progress({ d, n }: { d: number; n: number }) {
  return (
    <div className="smprog">
      <div className="track"><div className={'fill ' + (d === n ? 'g' : 'o')} style={{ width: (n ? d / n * 100 : 0) + '%' }} /></div>
      <small><b>{d}</b>/{n} hoạt động</small>
    </div>
  )
}

export function SystemMap({ live, go }: { live: Set<string>; go?: (p: string) => void }) {
  const admin = NAV.platform.filter(g => ADMIN_GROUPS.includes(g.title))
  const phGroups = NAV.platform.filter(g => /^\d/.test(g.section ?? g.title))
  const phs: Ph[] = []
  for (const g of phGroups) {
    const head = g.section ?? g.title
    const num = head.match(/^(\d+)/)![1]
    let ph = phs.find(p => p.num === num)
    if (!ph) { ph = { num, title: head.replace(/^\d+\.\s*/, ''), subs: [] }; phs.push(ph) }
    ph.subs.push({ title: g.section ? g.title : '', items: g.items })
  }
  const adminItems = [...new Set(admin.flatMap(g => g.items))]
  const phItems = [...new Set(phGroups.flatMap(g => g.items))]
  const shared = new Set(phItems.filter(i => adminItems.includes(i)))
  const all = [...new Set([...adminItems, ...phItems])]
  const cnt = (xs: string[]) => xs.filter(i => live.has(i)).length
  const done = cnt(all)
  return (
    <>
      <p className="sub">Toàn bộ chức năng của nền tảng, chia theo hai phần. Bấm vào tên để mở. <span className="smlegend"><span className="on"><i />Đang hoạt động</span><span className="off"><i />Khung giao diện, chờ build</span></span></p>
      <Tiles items={[
        { label: 'Quản trị hệ thống', value: `${cnt(adminItems)}/${adminItems.length}`, sub: `chức năng hoạt động · ${admin.length} nhóm` },
        { label: '5 phân hệ nghiệp vụ', value: `${cnt(phItems)}/${phItems.length}`, sub: `chức năng hoạt động · ${phs.length} phân hệ` },
        { label: 'Tổng chức năng', value: all.length, sub: `${Math.round(done / all.length * 100)}% đã chạy thật · không tính trùng ${shared.size} mục dùng chung`, tone: 'good' },
        { label: 'Còn là khung', value: all.length - done, sub: 'chờ build tiếp', tone: 'warn' },
      ]} />

      <div className="smhead">
        <span className="smtag a">A</span>
        <div><h2>Quản trị hệ thống</h2><small>Phần chung KDI dùng để vận hành toàn nền tảng, áp dụng cho mọi trường và Sở.</small></div>
      </div>
      <div className="smadmin">
        {admin.map(g => (
          <section className="panel smcard" key={g.title}>
            <h3>{g.title}</h3>
            <small className="smnote">{ADMIN_NOTE[g.title]}</small>
            <Progress d={cnt(g.items)} n={g.items.length} />
            <MapItems items={g.items} live={live} go={go} />
          </section>
        ))}
      </div>

      <div className="smhead">
        <span className="smtag b">B</span>
        <div>
          <h2>5 phân hệ nghiệp vụ</h2>
          <small>Đơn vị bán theo gói dịch vụ; trường và Sở dùng trong phạm vi được cấp. <button type="button" className="linkbtn" onClick={() => go?.('Phân hệ & mức sử dụng')}>Xem mức sử dụng theo phân hệ →</button></small>
        </div>
      </div>
      <div className="smphs">
        {phs.map(ph => {
          const items = [...new Set(ph.subs.flatMap(s => s.items))]
          const multi = ph.subs.length > 1
          return (
            <section className={'panel smph' + (multi ? ' multi' : '')} key={ph.num}>
              <header>
                <span className="smnum">{ph.num}</span>
                <div className="smtitle"><h3>{ph.title}</h3><small className="smnote">{PH_NOTE[ph.num]}{multi ? ` · ${ph.subs.length} nhóm` : ''}</small></div>
                <Progress d={cnt(items)} n={items.length} />
              </header>
              <div className="smsubs" style={{ ['--cols' as string]: multi ? (ph.subs.length <= 4 ? ph.subs.length : 3) : 1 }}>
                {ph.subs.map(s => (
                  <div className="smsub" key={s.title || ph.num}>
                    {s.title && <h4>{s.title}</h4>}
                    {s.items.some(i => shared.has(i)) && /^5\.[3-6]/.test(s.title) && <small className="smnote">Trường / Sở quản lý phần của mình; phần toàn hệ thống ở mục A.</small>}
                    <MapItems items={s.items} live={live} go={go} shared={shared} />
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
