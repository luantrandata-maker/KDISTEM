# Hệ thống Quản trị STEM

Giai đoạn 1–2: nền tảng + vận hành trường. React + TypeScript + Vite, Supabase.

## Chạy trên máy
1. Sao chép `.env.example` thành `.env` (đã điền sẵn project Supabase demo).
2. `npm install && npm run dev`
3. Tài khoản: tài khoản mới **không** tự thành quản trị. Quản trị trường vào *Tài khoản → Mời người dùng*, nhập email (một hoặc nhiều dòng), chọn vai trò và hồ sơ giáo viên/học sinh cần liên kết. Người được mời bấm liên kết trong email (hoặc tự đăng ký đúng email đó và xác nhận) là vào thẳng trường với đúng vai trò.
   Cấp quản trị đầu tiên cho một trường (chạy trong Supabase SQL Editor, thay email và mã trường):
   ```sql
   update profiles set org_id = (select id from organizations where code = 'THCS-PH') where email = 'ban@truong.edu.vn';
   insert into user_roles (user_id, role_id)
   select p.id, r.id from profiles p, roles r where p.email = 'ban@truong.edu.vn' and r.key = 'principal' and r.org_id is null
   on conflict do nothing;
   ```

## Cơ sở dữ liệu
Chạy lần lượt các file trong `supabase/migrations/` theo số thứ tự (001 schema, 002 dữ liệu mẫu, 003 trigger demo, 004 thời khóa biểu và đăng ký STEM, 005 học sinh và phân quyền, 006 gói STEM/tập huấn/PPCT, 007 ticket bảo hành mẫu, 008 gán tài khoản và vai trò, 009–010 mở rộng và dữ liệu mẫu theo video thứ hai, 011 đường dẫn phòng họp tập huấn, 012 siết phân quyền RLS, 013 nền học tập: chủ đề/buổi học, bài tập, bài nộp, nhóm, phiên lớp có mã PIN, 014 vai trò tuỳ chỉnh và mời người dùng qua email, 015 soạn bài giảng tương tác, trình chiếu trên lớp và phiếu mượn thiết bị của giáo viên, 016 thông báo trong ứng dụng, học kỳ hiện tại và TKB theo học kỳ, 017 cổng học sinh: biểu quyết trong tiết học, tên người viết thảo luận, 018 cổng Sở: xã/phường, thống kê toàn Sở, tập huấn cấp Sở, lịch sử báo cáo, dữ liệu mẫu 21 trường, 019 lõi đa tổ chức: cây Bộ → Tỉnh → Sở → Phòng → Trường + Đơn vị cung cấp, bảng `memberships`, chọn đơn vị đang làm việc, tăng tốc RLS, đổi Geleximco → KDI Education, 020 dữ liệu mẫu tỉnh thứ hai Bắc Ninh và đơn vị cung cấp KDI Education, 021 cổng Quản trị nền tảng: trạng thái hoạt động/tạm dừng, ràng buộc cấp đơn vị, nhật ký thay đổi, thống kê theo cây, 022 công cụ phê duyệt nhiều bước: quy trình theo đơn vị, hộp phê duyệt, đề xuất mua gói, kế hoạch giáo dục có trạng thái duyệt, 023 kho chương trình, bài giảng, học liệu dùng chung, 024 cổng Quản trị nền tảng đợt 1: khách hàng, gói dịch vụ & hợp đồng (quyền dùng phân hệ), bảo mật tài khoản, hỗ trợ khách hàng, 025 đợt 2: triển khai khách hàng, danh mục gói STEM của KDI, xử lý đơn đặt gói, thông báo hàng loạt, kết nối tích hợp, 026 cổng giáo viên: lịch tập huấn và bài giảng tập huấn của tôi, giáo viên chỉ tự điểm danh "có mặt" trong giờ buổi tập huấn, 027 buổi dạy & điểm danh theo tiết: sinh tiết từ TKB, điểm danh học sinh, huỷ tiết/dạy bù, dashboard điểm danh, TKB toàn hệ thống và trùng lịch, 028 dữ liệu mẫu buổi dạy 2 tuần gần nhất, 029 chống trùng lịch phòng STEM/giáo viên/thiết bị ở CSDL, phòng STEM & thiết bị toàn hệ thống). Các file dữ liệu mẫu chỉ chạy khi chưa có dữ liệu.

## Cấu hình Supabase cho đăng nhập và lời mời

- Authentication → Providers → Email: **bật "Confirm email"**. Lời mời chỉ được áp dụng sau khi email được xác nhận, để không ai nhận vai trò bằng cách đăng ký trùng email người khác.
- Authentication → URL Configuration: Site URL và Redirect URLs gồm địa chỉ `*.workers.dev` (và `http://localhost:5173` khi chạy máy).
- Máy chủ email mặc định của Supabase chỉ gửi vài thư mỗi giờ. Khi mời nhiều người, cấu hình SMTP riêng (Authentication → Emails → SMTP Settings). Nếu thư không gửi được, lời mời vẫn có hiệu lực khi người đó tự đăng ký bằng đúng email.
- Có thể Việt hoá mẫu thư "Magic Link" và "Confirm signup" ở Authentication → Emails → Templates.

## Phân quyền (từ migration 012)

- **Đọc**: nhân sự đọc dữ liệu trong phạm vi tổ chức (Sở đọc được các trường trực thuộc). Học sinh chỉ đọc danh mục cơ bản và dữ liệu của lớp mình.
- **Ghi**: theo ma trận Xem / Chi tiết / Tạo / Sửa / Xoá (`has_perm(module, action)`). Hiệu trưởng và QTV CNTT có toàn quyền trong trường.
- **Vai trò tuỳ chỉnh** (migration 014): quản trị bấm *Thêm vai trò*, đặt tên, chọn giao diện (Quản trị trường hoặc Giáo viên), sao chép quyền từ vai trò có sẵn rồi chỉnh. Vai trò tuỳ chỉnh chỉ thuộc trường tạo ra nó.
- Ma trận mặc định (`role_permissions`) dùng chung, chỉ sửa bằng SQL. Mỗi trường tự chỉnh trong mục *Vai trò và phân quyền*, lưu vào `org_role_permissions` và chỉ áp dụng cho trường đó.
- Giáo viên tự gửi đăng ký dạy STEM, phiếu mượn, báo hỏng thiết bị, điểm danh tập huấn của chính mình (từ 026: chỉ đánh "có mặt", chỉ trong giờ buổi tập huấn ±15 phút; đánh vắng/sửa buổi đã qua do người có quyền sửa Tập huấn hoặc đơn vị tổ chức); giao bài, chấm bài, mở phiên lớp (PIN) cho lớp mình dạy.
- Học sinh nộp bài của mình/nhóm mình, cập nhật tiến độ, thảo luận trong chủ đề lớp mình, vào lớp bằng PIN (`join_class_session`). Học sinh không thể tự chấm điểm (trigger `guard_submission`).

## Đa tổ chức (từ migration 019)

- Cây tổ chức một bảng `organizations(parent_id)` với 6 loại: `ministry` Bộ, `province` Tỉnh, `department` Sở, `district` Phòng, `school` Trường, `provider` Đơn vị cung cấp. Từ 01/07/2025 không còn cấp huyện: giao diện không cho tạo thêm Phòng; Phòng đã có vẫn dùng bình thường. Xã/phường của trường lưu ở `organizations.ward`. Cấp trên đọc được dữ liệu cấp dưới; ngang cấp (tỉnh A và tỉnh B, trường A và trường B) không thấy nhau.
- `memberships(user_id, org_id, role_id)`: một người có nhiều vai trò ở nhiều đơn vị (vd: giáo viên dạy ở hai trường). `profiles.org_id` là **đơn vị đang làm việc**, đổi qua ô *Đang làm việc tại* trên thanh tiêu đề (RPC `switch_org`). Mọi quyền chỉ tính theo vai trò tại đơn vị đang làm việc — hiệu trưởng trường A không có quyền quản trị ở trường B.
- Vai trò phải hợp loại đơn vị (`role_fits_org`): trường dùng Hiệu trưởng/QTV/GV/NV/HS và vai trò tuỳ chỉnh; Bộ, Tỉnh, Sở, Phòng, Đơn vị cung cấp dùng vai trò cùng tên.
- Mời người đã có tài khoản ở đơn vị khác: hệ thống thêm vai trò ở đơn vị mới, không chuyển họ khỏi đơn vị cũ.
- `user_roles` còn lại dưới dạng view tương thích (vai trò tại đơn vị đang làm việc).

## Quản trị nền tảng (từ migration 021)

Cổng dành cho KDI Education (chủ nền tảng), mở bằng vai trò **Quản trị nền tảng** tại đơn vị KDI Education.

- Cấp quyền lần đầu: đăng nhập ứng dụng một lần bằng email của bạn, rồi chạy trong SQL Editor
  `select public.grant_platform_admin('email-cua-ban@kdi.edu.vn');` (hàm này không gọi được từ ứng dụng).
- **Tổng quan hệ thống**: số đơn vị theo cấp, trường đang hoạt động, người dùng, vai trò, lời mời; bảng theo tỉnh; **kiểm tra cấu trúc** (đơn vị sai cấp, Sở chưa gắn tỉnh, đơn vị chưa có cán bộ, tài khoản trỏ sai đơn vị, tài khoản chờ cấp quyền...).
- **Cây tổ chức**: Bộ → Tỉnh → Sở → Phòng → Trường và đơn vị cung cấp; thêm đơn vị trực thuộc, sửa, chuyển đơn vị cha (CSDL chặn sai cấp và vòng lặp), kích hoạt trường, tạm dừng/mở lại (tạm dừng → thành viên đơn vị đó không vào làm việc được), gán người phụ trách hoặc mời qua email.
- **Người dùng & vai trò**: ai giữ vai trò gì ở đơn vị nào trên toàn hệ thống; gán/gỡ vai trò. **Lời mời**: mọi lời mời, gửi lại, huỷ.
- **Nhật ký hệ thống** (`audit_log`): mọi thay đổi đơn vị, vai trò, lời mời, vai trò tuỳ chỉnh — ai làm, lúc nào, đổi gì. Quản trị trường xem được nhật ký của trường mình.
- Quyền dữ liệu: quản trị nền tảng **đọc** mọi dữ liệu (kể cả xem cổng Sở trên toàn hệ thống) nhưng không sửa dữ liệu chuyên môn của trường.

## Phê duyệt nhiều bước (từ migration 022)

- Loại hồ sơ: **đăng ký dạy STEM, phiếu mượn thiết bị, đề xuất mua gói STEM, kế hoạch giáo dục**, dự án STEM (dùng khi có chức năng dự án).
- **Quy trình phê duyệt** (quản trị trường, cán bộ Sở/Phòng): mỗi loại hồ sơ gồm 1–10 bước. Người duyệt mỗi bước là *người có quyền sửa chức năng đó* (theo ma trận phân quyền) hoặc *một vai trò cụ thể* (kể cả vai trò tuỳ chỉnh như Tổ trưởng), ở tại trường hoặc ở cấp trên (Phòng, Sở, Tỉnh, Bộ).
- Sở/Phòng bật *Áp dụng cho đơn vị trực thuộc* → trường chưa có quy trình riêng dùng theo. Không có quy trình nào → 1 bước như trước.
- Hồ sơ chụp lại quy trình lúc gửi: sửa quy trình không ảnh hưởng hồ sơ đang duyệt. Đủ bước mới thành *Đã duyệt*; Ban giám hiệu của trường gửi luôn từ chối được ở bất kỳ bước nào; người gửi rút được hồ sơ.
- **Hộp phê duyệt** (trường, giáo viên, Sở): hồ sơ chờ tôi duyệt, tôi đã gửi, đang xử lý, đã xong; xem tiến trình từng bước và lịch sử ý kiến. Chuông thông báo báo đúng người duyệt của từng bước.
- Các màn cũ (Duyệt đăng ký dạy STEM, Mượn – trả thiết bị, Kế hoạch GD) vẫn dùng như trước, nhưng việc duyệt đi qua quy trình; đổi trạng thái trực tiếp bằng API cũng bị buộc đi qua quy trình.

## Kho học liệu dùng chung (từ migration 023)

- **Phát hành học liệu** (Sở/Phòng/Tỉnh/Bộ, KDI Education ở cổng nền tảng, quản trị trường): 3 loại — *chương trình* (các chủ đề, số tiết, mục tiêu, gắn bài giảng trong kho), *bài giảng* (slide cùng định dạng trình soạn bài giảng; có thể sao chép từ bài giảng có sẵn), *học liệu* (video, tài liệu, đường dẫn).
- Phạm vi: mọi đơn vị trực thuộc · đơn vị được chọn (gồm cấp dưới của chúng) · công khai toàn hệ thống (chỉ đơn vị cung cấp). Phát hành bản cập nhật tăng phiên bản; thu hồi để ẩn khỏi đơn vị nhận.
- **Thư viện STEM** (giáo viên) / **Kho học liệu dùng chung** (trường): lọc theo nguồn, chương trình, khối; xem trước; *Dùng bài này* tạo bản nháp của giáo viên, *Thêm làm bài mẫu của trường* tạo bài mẫu cho cả trường; dùng chương trình → tạo mọi bài giảng được gắn. Bản đã dùng là của trường, chỉnh sửa tự do; khi kho có bản mới, người đã dùng được thông báo và thấy nhãn *Có bản mới*, nhưng bản của họ không bị ghi đè.
- Trình soạn bài giảng hiện nhãn *Từ kho vN* và nút mở Thư viện STEM. Đơn vị phát hành thấy số trường đã dùng và số bản đang dùng phiên bản cũ.

## Buổi dạy & điểm danh theo tiết (từ migration 027)

- **Buổi dạy** (`teaching_sessions`): mỗi tiết cụ thể theo ngày, sinh từ Thời khoá biểu của học kỳ chứa ngày đó (Thứ 2–7, trong khoảng ngày bắt đầu/kết thúc học kỳ). Không cần lịch chạy nền: giao diện tự gọi `generate_teaching_sessions(từ, đến)` khi mở một tuần. Gọi lại an toàn: chỉ thêm tiết thiếu; tiết tương lai chưa điểm danh được cập nhật theo TKB mới hoặc bỏ đi nếu TKB không còn tiết đó; tiết đã dạy, đã huỷ, dạy bù giữ nguyên.
- **Trạng thái tiết**: Sắp diễn ra → Đang diễn ra → **Chưa điểm danh** (đã qua mà chưa ai điểm danh) / Đã dạy / Đã huỷ. Tính theo giờ Việt Nam từ Cấu hình tiết học (view `teaching_session_view`).
- **Giáo viên** (mục *Điểm danh*): điểm danh tiết mình dạy từ 10 phút trước giờ vào tiết đến 7 ngày sau (`mark_teaching_session`); mặc định cả lớp có mặt, chỉnh người muộn/vắng/có phép, ghi nội dung tiết. Tổng quan nhắc *Tiết chưa điểm danh (7 ngày)*.
- **Quản trị trường** (quyền sửa Thời khoá biểu; mục *Buổi dạy & điểm danh*): xem theo tuần, lọc lớp/GV/trạng thái, huỷ tiết (lý do), thêm tiết dạy bù, sửa điểm danh bất kỳ lúc nào, đồng bộ lại với TKB.
- **Dashboard điểm danh** (trường, Sở/Phòng/Tỉnh/Bộ, nền tảng): theo trường trong phạm vi người xem — tỉ lệ tiết đã điểm danh, tiết chưa điểm danh và số GV cần đôn đốc, chuyên cần học sinh, tiết STEM đã dạy và tiết dùng phòng STEM, huỷ/dạy bù; xuất Excel (`attendance_summary`).
- **Thời khoá biểu & xếp lịch** (nền tảng): độ phủ TKB từng trường và các chỗ trùng giáo viên/phòng STEM (`timetable_overview`, `timetable_conflicts`).
- Học sinh chỉ đọc tiết của lớp mình và điểm danh của chính mình. Số có mặt/vắng lưu sẵn trên buổi dạy (trigger) để dashboard không phải đếm lại bảng điểm danh.

## Chống trùng lịch phòng, giáo viên, thiết bị (từ migration 029)

- **Sổ giữ chỗ phòng STEM** (`resource_bookings`): mọi tiết dạy (theo TKB, dạy bù), đăng ký dạy STEM (chờ duyệt/đã duyệt) và phiếu mượn dùng tại phòng (chờ duyệt/đã duyệt/đang mượn) đều giữ phòng theo khung giờ của tiết. Ràng buộc loại trừ (`btree_gist`) chặn hai lịch khác lớp cùng phòng, chồng giờ — kể cả hai người bấm gửi cùng lúc. Cùng một lớp dùng lại phòng của chính tiết mình không tính là trùng.
- **Lỗi trả về** mã `23P01`, câu báo tiếng Việt nêu rõ phòng/GV và lịch đang giữ (vd: *Phòng Robotics đã có lịch lúc 23/10/2026 09:30–10:15: Tiết 4 · Lớp 8A · Công nghệ*). Các màn cũ hiện nguyên câu này.
- **Thời khoá biểu**: không thêm/sửa được tiết làm trùng phòng hoặc trùng GV ở cùng thứ, cùng tiết, cùng học kỳ (tiết "mọi học kỳ" chồng với mọi học kỳ). **Giáo viên**: tiết dạy bù, tiết sửa tay và đăng ký dạy STEM không được trùng giờ với tiết khác của chính GV đó.
- **Dữ liệu cũ đã trùng** (TKB mẫu có 75 chỗ trùng phòng): không bị chặn, không bị sửa — được ghi vào `booking_conflicts` để trường xử lý. Tiết sinh từ TKB mà trùng cũng ghi vào đây thay vì làm hỏng việc sinh buổi dạy. Khi lịch đang giữ phòng bị huỷ/đổi/xoá, lịch đang chờ tự được xếp vào.
- **Thiết bị**: giáo viên vẫn gửi phiếu mượn khi thiếu (như trước), nhưng phiếu chỉ **duyệt/giao** được khi còn đủ thiết bị dùng được (trừ hỏng, bảo trì) sau khi trừ các phiếu đã duyệt/đang mượn chồng giờ. Màn mượn của giáo viên hiện *còn trống tiết này* (`equipment_availability`).
- **Quản trị nền tảng**: *Phòng STEM & lịch phòng* (`room_overview`: công suất, nguồn lịch, phòng chưa có lịch, chỗ trùng, lịch từng phòng; xuất Excel) và *Thiết bị, vật tư & kho* (`equipment_overview`, `equipment_type_summary`: theo trường và theo loại, hỏng/bảo trì, bảo hành sắp hết, phiếu mượn). Sở/Phòng gọi được cùng các hàm, chỉ thấy trường trực thuộc.
- Chưa có: vật tư tiêu hao và kho tổng, kiểm kê (quét QR), vận chuyển vật tư giữa đơn vị.
- Supabase: `btree_gist` được tạo trong schema `extensions` (có sẵn trên Supabase, không cần bật tay).

## Kiểm thử cách ly dữ liệu

- `supabase/tests/isolation_test.sql`: 248 phép thử "tỉnh A không đọc/ghi được dữ liệu tỉnh B", Phòng chỉ thấy trường trực thuộc, quyền quản trị không mang sang đơn vị khác, đổi đơn vị đang làm việc, quyền của quản trị nền tảng, tạm dừng đơn vị, quy trình phê duyệt nhiều bước (đúng người, đúng bước, Sở tỉnh khác không duyệt được), kho học liệu (đúng phạm vi phát hành, chỉ trường dùng được, báo bản cập nhật), chống trùng lịch phòng/GV/thiết bị (029). Chạy được trong **Supabase SQL Editor** (sau 020; phần nền tảng cần 021): tự tạo tài khoản thử `*@iso-test.local`, mọi lệnh thử bị huỷ, cuối cùng xoá sạch và in bảng PASS/FAIL.
- `supabase/tests/run.sh`: dựng CSDL Postgres trống, chạy toàn bộ migration rồi chạy bộ kiểm thử (GitHub Actions chạy tự động khi `supabase/` thay đổi).

## Triển khai Cloudflare (Workers Builds, kết nối GitHub)
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (đọc cấu hình trong `wrangler.jsonc`; tên Worker phải trùng tên project trên Cloudflare)
- Biến môi trường (đặt trước khi build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (giá trị như `.env.example`)
- Sau khi có địa chỉ `*.workers.dev`, thêm vào Supabase → Authentication → URL Configuration (Site URL / Redirect URLs).
- Không dùng file `_redirects` cho kiểu này: quy tắc `/* /index.html 200` bị Cloudflare từ chối vì lặp vô hạn. Việc trả về `index.html` cho đường dẫn con đã do `not_found_handling` trong `wrangler.jsonc` đảm nhiệm.

## Gói dịch vụ, bảo mật, hỗ trợ (từ migration 024)

**Gói dịch vụ & hợp đồng** (Quản trị nền tảng → 12. Khách hàng & thương mại)
- Phân hệ bán được (`service_modules`): Phòng STEM & thiết bị, Kế hoạch giáo dục & TKB, Gói STEM, Kho học liệu, Tập huấn, Phê duyệt. Phần lõi (tài khoản, vai trò, giáo viên, lớp, học sinh, phân công, năm học, toà nhà) luôn dùng được.
- Gói (`service_plans`) gồm danh sách phân hệ; có sẵn 3 gói Cơ bản / Tiêu chuẩn / Toàn diện (chưa đặt giá).
- Hợp đồng (`contracts`) gắn một đơn vị với một gói, có thời hạn. Quyền dùng của một đơn vị = hợp đồng gần nhất đi từ chính nó lên cấp trên (Sở mua, bật *Áp dụng cho đơn vị trực thuộc* → mọi trường của Sở dùng theo):
  - **chưa có hợp đồng nào trên cây** → không giới hạn (giữ nguyên hành vi trước 024);
  - **hợp đồng còn hiệu lực** → chỉ các phân hệ trong gói;
  - **hết hạn / tạm dừng / kết thúc** → chỉ phần lõi.
- Kiểm tra nằm trong `has_perm()` nên mọi lệnh ghi qua RLS đều bị chặn khi đơn vị chưa mua phân hệ; menu các giao diện trường, giáo viên, Sở ẩn mục tương ứng.
- **Thông tin khách hàng**: trạng thái khách hàng, đầu mối, quyền dùng hiện tại của từng đơn vị, cảnh báo hợp đồng sắp hết hạn (≤ 60 ngày).

**Bảo mật tài khoản** (Quản trị nền tảng → 1. Quản trị nền tảng)
- Xác thực 2 lớp (ứng dụng TOTP) bắt buộc theo vai trò (mặc định: Quản trị nền tảng). Người thuộc vai trò bắt buộc phải quét mã QR và nhập mã 6 số sau khi đăng nhập. Cần bật **Authentication → Multi-Factor → TOTP** trong Supabase Dashboard.
- *Chặn ở cơ sở dữ liệu* (tắt mặc định): khi bật, quyền Quản trị nền tảng chỉ có hiệu lực ở phiên đã xác thực 2 lớp (`aal2`). Chỉ bật sau khi mọi quản trị nền tảng đã đăng ký ứng dụng xác thực.
- Khoá tài khoản: người bị khoá mất quyền đọc/ghi mọi dữ liệu ngay lập tức (`my_org_id()` trả về rỗng). Không khoá được quản trị nền tảng.
- Tự đăng xuất khi không thao tác (phút). Xem và thu hồi phiên đăng nhập (đọc `auth.sessions`; nếu thiếu quyền trên schema `auth`, trang báo rõ).

**Hỗ trợ khách hàng**
- Trường, Sở gửi yêu cầu ở mục **Hỗ trợ từ KDI**; KDI xử lý ở **Vấn đề & phản hồi** (nhóm 8). Mỗi phiếu có mã `HT-xxxxx`, hạn xử lý theo mức ưu tiên (khẩn cấp 4 giờ, cao 1 ngày, bình thường 3 ngày, thấp 7 ngày), người xử lý, trao đổi hai chiều và ghi chú nội bộ (khách hàng không thấy). Có thông báo trong ứng dụng cho cả hai phía.
- KDI xử lý phiếu bảo hành thiết bị của mọi trường ở tab *Bảo hành thiết bị*.

## Vận hành khách hàng (từ migration 025)

- **Triển khai khách hàng** (nhóm 1): checklist 14 bước cho từng trường. Bước tự động lấy từ dữ liệu (hợp đồng hiệu lực, kích hoạt, năm học, giáo viên, học sinh, phòng STEM, thiết bị, thời khoá biểu, hoạt động ≤ 7 ngày); bước KDI tự đánh dấu (họp khởi động, tập huấn quản trị, bàn giao thiết bị, tập huấn giáo viên, nghiệm thu). Cảnh báo trường đã kích hoạt nhưng không dùng 14 ngày.
- **Chương trình giáo dục** (nhóm 3): danh mục gói STEM của KDI (= `stem_packages` thuộc đơn vị chủ nền tảng, `catalog_active`), soạn chủ đề và buổi học. Trường xem danh mục qua `package_catalog()`; gói danh mục không lẫn vào mục Gói STEM của trường.
- **Đơn đặt gói STEM** (nhóm 12): trường chọn gói trong danh mục khi lập đề xuất mua gói → duyệt theo quy trình của trường/Sở → KDI xác nhận, báo giá, giao. **Đã giao** sao chép gói (chủ đề, buổi học) vào mục Gói STEM của trường và gửi thông báo cho người lập đơn. Trường không tự sửa được phần xử lý của KDI.
- **Thông báo** (nhóm 11): gửi vào chuông thông báo theo đơn vị (kèm cấp dưới), loại đơn vị, vai trò; xem trước số người nhận; thống kê đã đọc. Tài khoản bị khoá và đơn vị tạm dừng không nhận.
- **Tích hợp & dữ liệu** (nhóm 13): trạng thái từng kết nối (K12Online, VNeID, email, Zalo OA, Excel) và độ đầy đủ dữ liệu của từng trường. Khoá truy cập của đối tác đặt trong Supabase secrets, không lưu trong bảng.
