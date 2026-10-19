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
Chạy lần lượt các file trong `supabase/migrations/` theo số thứ tự (001 schema, 002 dữ liệu mẫu, 003 trigger demo, 004 thời khóa biểu và đăng ký STEM, 005 học sinh và phân quyền, 006 gói STEM/tập huấn/PPCT, 007 ticket bảo hành mẫu, 008 gán tài khoản và vai trò, 009–010 mở rộng và dữ liệu mẫu theo video thứ hai, 011 đường dẫn phòng họp tập huấn, 012 siết phân quyền RLS, 013 nền học tập: chủ đề/buổi học, bài tập, bài nộp, nhóm, phiên lớp có mã PIN, 014 vai trò tuỳ chỉnh và mời người dùng qua email, 015 soạn bài giảng tương tác, trình chiếu trên lớp và phiếu mượn thiết bị của giáo viên, 016 thông báo trong ứng dụng, học kỳ hiện tại và TKB theo học kỳ, 017 cổng học sinh: biểu quyết trong tiết học, tên người viết thảo luận, 018 cổng Sở: xã/phường, thống kê toàn Sở, tập huấn cấp Sở, lịch sử báo cáo, dữ liệu mẫu 21 trường, 019 lõi đa tổ chức: cây Bộ → Tỉnh → Sở → Phòng → Trường + Đơn vị cung cấp, bảng `memberships`, chọn đơn vị đang làm việc, tăng tốc RLS, đổi Geleximco → KDI Education, 020 dữ liệu mẫu tỉnh thứ hai Bắc Ninh và đơn vị cung cấp KDI Education, 021 cổng Quản trị nền tảng: trạng thái hoạt động/tạm dừng, ràng buộc cấp đơn vị, nhật ký thay đổi, thống kê theo cây, 022 công cụ phê duyệt nhiều bước: quy trình theo đơn vị, hộp phê duyệt, đề xuất mua gói, kế hoạch giáo dục có trạng thái duyệt, 023 kho chương trình, bài giảng, học liệu dùng chung, 024 cổng Quản trị nền tảng đợt 1: khách hàng, gói dịch vụ & hợp đồng (quyền dùng phân hệ), bảo mật tài khoản, hỗ trợ khách hàng, 025 đợt 2: triển khai khách hàng, danh mục gói STEM của KDI, xử lý đơn đặt gói, thông báo hàng loạt, kết nối tích hợp, 026 cổng giáo viên: lịch tập huấn và bài giảng tập huấn của tôi, giáo viên chỉ tự điểm danh "có mặt" trong giờ buổi tập huấn, 027 buổi dạy & điểm danh theo tiết: sinh tiết từ TKB, điểm danh học sinh, huỷ tiết/dạy bù, dashboard điểm danh, TKB toàn hệ thống và trùng lịch, 028 dữ liệu mẫu buổi dạy 2 tuần gần nhất, 029 chống trùng lịch phòng STEM/giáo viên/thiết bị ở CSDL, phòng STEM & thiết bị toàn hệ thống, 030 kho hoạt động tương tác 8 mẫu, học trước & tự học (chấm trên CSDL), ngày nghỉ & lễ, 031 dữ liệu mẫu hoạt động/tự học/ngày nghỉ, 032 Cơ sở triển khai: sổ quản lý mọi trường đang triển khai của KDI, 033 gói dịch vụ theo 5 phân hệ PH1–PH5, mức sử dụng theo phân hệ, quyền mặc định sửa trên giao diện, 034 đưa CSDL Supabase thật và repo về cùng trạng thái: bỏ cột thừa `role_permissions.org_id`, quyền thừa `borrow`/`edu_plans`, policy thừa trên `floors` và `roles`; quyền mặc định Giáo viên theo bản đang dùng, 035 sinh buổi dạy tự động 4 tuần tới cho mọi trường (pg_cron 02:15 hằng đêm), ngày nghỉ khai báo ở bất kỳ cấp nào áp ngay cho trường trực thuộc, 036 vị trí trường (lat/lng, `set_school_location`) cho bản đồ độ phủ STEM theo xã/phường ở Dashboard toàn Sở, 037 tài khoản học sinh/giáo viên đăng nhập bằng mã, không cần email, 038 nhập toạ độ trường hàng loạt từ Excel, 039 điều khoản sử dụng & chính sách quyền riêng tư theo phiên bản, đồng ý của cha mẹ, xuất/xoá dữ liệu học sinh, 040 Sở/Phòng giao chỉ tiêu STEM theo năm học, cảnh báo trường cần chú ý và gửi nhắc tới trường, 041 chấm bài theo tiêu chí (rubric): kho mẫu tiêu chí, mức 1–4, điểm tính trên CSDL, tổng hợp lớp theo tiêu chí, 042 đánh giá năng lực: khung năng lực HS/GV, hồ sơ năng lực HS từ chấm theo tiêu chí, GV tự đánh giá + trường đánh giá kèm minh chứng tự động, 043 khảo sát: Sở/Phòng, trường, KDI khảo sát GV/HS/cán bộ của đơn vị và đơn vị trực thuộc, kết quả tổng hợp, 044 kho & kiểm kê: vật tư tiêu hao có sổ nhập/cấp phát/điều chỉnh (tồn kho tính trên CSDL, không âm), đợt kiểm kê thiết bị bằng tem QR hoặc serial, duyệt kết quả cập nhật tình trạng/phòng thiết bị, 045 đề xuất mua vật tư và vận chuyển/điều chuyển vật tư–thiết bị giữa các đơn vị qua quy trình phê duyệt, kho tổng KDI, 046 nghiệm thu & doanh thu theo đợt của hợp đồng, sao lưu & xuất dữ liệu theo đơn vị có nhật ký, 047 giao diện & thương hiệu riêng theo khách hàng — tên hệ thống, logo, màu, tên miền, áp cho đơn vị trực thuộc, 048 cổng phụ huynh: thông tin phụ huynh, tài khoản theo SĐT, xem lịch học / chuyên cần / bài tập / năng lực của con, báo vắng, đồng ý dữ liệu trực tuyến, khảo sát phụ huynh, 049 chỉ số STEM (STEM Index) và bộ chỉ số của Sở: trọng số, mục tiêu, ngưỡng xếp mức, 050 sự kiện STEM: tạo – công bố – đăng ký – điểm danh cho HS, GV, phụ huynh, cán bộ, 051 dự án STEM của học sinh và cuộc thi — KHKT theo mẫu Bộ GD&ĐT, STEM/Robotics, tự cấu hình; nhiều vòng, ban giám khảo, chấm ẩn danh, lệ phí). Dữ liệu mẫu (002, 020 và các khối phụ thuộc trường demo THCS-PH) **chỉ chạy khi bật cờ `app.seed_demo=on`** — CSDL production dựng từ đầu không có trường, giáo viên, học sinh hay tài khoản demo; xem mục *Dữ liệu mẫu & chạy migration tự động*.

## Cấu hình Supabase cho đăng nhập và lời mời

- Authentication → Providers → Email: **bật "Confirm email"**. Lời mời chỉ được áp dụng sau khi email được xác nhận, để không ai nhận vai trò bằng cách đăng ký trùng email người khác.
- Authentication → URL Configuration: Site URL và Redirect URLs gồm địa chỉ `*.workers.dev` (và `http://localhost:5173` khi chạy máy).
- Máy chủ email mặc định của Supabase chỉ gửi vài thư mỗi giờ. Khi mời nhiều người, cấu hình SMTP riêng (Authentication → Emails → SMTP Settings). Nếu thư không gửi được, lời mời vẫn có hiệu lực khi người đó tự đăng ký bằng đúng email.
- Có thể Việt hoá mẫu thư "Magic Link" và "Confirm signup" ở Authentication → Emails → Templates.

## Phòng STEM, phòng học, kho — thiết bị & vật tư theo phòng (từ migration 056)

- **Loại phòng** `stem_rooms.room_kind`: `stem` (Phòng STEM — mặc định, mọi phòng cũ giữ nguyên), `classroom` (Phòng học), `storage` (Kho). Trường → Phòng & thiết bị STEM → **Quản lý phòng**: thêm / sửa / xoá, lọc theo loại, nhập / xuất Excel (tự tạo tòa nhà, tầng còn thiếu), gắn lớp cho phòng học; trường chưa có phòng thấy hướng dẫn thay vì "Đang tải…". Phòng STEM mở tiếp *Lịch & mượn trả* như trước.
- **Chặn ở CSDL**: chỉ phòng STEM được xếp vào TKB, đăng ký dạy STEM, phiếu mượn, buổi dạy (`guard_stem_room_ref`) → sổ giữ chỗ và mọi thống kê "Phòng STEM" của Sở/KDI (`dept_school_stats`, `room_overview`) không tính phòng học, kho. Phòng học của lớp (`classes.room_id`) chỉ nhận phòng loại Phòng học. Không đổi loại phòng STEM đang có lịch, phòng học đang có lớp; người dùng không xoá được phòng còn thiết bị / vật tư / lịch (`guard_room`, `guard_room_delete`).
- **Vật tư theo vị trí** `supply_stocks`: tồn từng vật tư ở từng phòng/kho + phần "chưa xếp phòng" (tồn cũ chuyển vào đây); tổng luôn bằng `supplies.qty`, chỉ đổi qua phiếu. Phiếu Nhập / Cấp phát / Điều chỉnh có thể ghi phòng; phiếu mới **Chuyển vị trí** (`kind = 'move'`, `room_id` → `to_room_id`). Xuất không ghi phòng (vận chuyển 045, kiểm kê 044) lấy phần chưa xếp phòng trước rồi tới phòng nhiều nhất.
- **Bung chi tiết theo phòng**: Quản lý phòng và Quản lý Thiết bị → *Theo phòng / kho* — mỗi phòng một dòng tóm tắt, bấm để xem thiết bị theo loại → từng chiếc (seri, tình trạng, bảo hành, chuyển phòng ngay tại chỗ) và vật tư tiêu hao đang ở phòng đó. Thiết bị chuyển vào kho tự thành "Tồn kho", ra khỏi kho thành "Sẵn sàng".

## Kho & kiểm kê (từ migration 044)

- **Vật tư tiêu hao** (Trường → Phòng & thiết bị STEM; KDI → 3.1 Kho & tồn kho / Cấp phát & bàn giao): danh mục vật tư, mức tồn tối thiểu (cảnh báo "Sắp hết"), phiếu *Nhập* / *Cấp phát* (cho giáo viên, lớp) / *Điều chỉnh*. Số tồn chỉ đổi qua phiếu — trigger `apply_supply_move` khoá dòng, chặn xuất quá tồn; không sửa/xoá phiếu đã ghi.
- **Tem QR**: Quản lý Thiết bị → *In tem QR* in tem A4 (4 cột) cho các thiết bị đang lọc, mã `KDI:U:<id>`.
- **Kiểm kê**: mở đợt toàn trường (thiết bị + vật tư) hoặc theo phòng (`stocktake_start` chụp sổ tại thời điểm mở; mỗi phạm vi chỉ một đợt đang mở). Quét bằng camera, máy đọc mã hoặc gõ serial (`stocktake_scan`), đánh dấu hỏng/không thấy, đếm vật tư → *Nộp* → quản trị trường *Duyệt* (`stocktake_approve`): không thấy → *Thất lạc*, hỏng → *Hỏng*, sai phòng → cập nhật phòng, vật tư lệch → phiếu điều chỉnh; mọi thay đổi ghi vào lịch sử thiết bị.

## Dự án STEM & cuộc thi (từ migration 051)

- **Dự án STEM** (Trường, GV, HS; phụ huynh và Sở xem): nhóm HS + GV hướng dẫn (+ người hướng dẫn ngoài), lĩnh vực, vấn đề, tóm tắt (đếm từ), tài liệu dạng đường link; nháp → *Gửi duyệt* (Hộp phê duyệt, loại "Dự án STEM") → Đang thực hiện → Hoàn thành; nhật ký tiến độ và nhận xét của GV.
- **Cuộc thi** (Trường, Sở/Phòng, KDI — cấp cuộc thi theo đơn vị tổ chức): mẫu **KHKT** (22 lĩnh vực, hồ sơ, tiêu chí theo hướng dẫn của Bộ — chỉnh theo văn bản năm hiện hành), **STEM / Robotics**, hoặc tự cấu hình; cấp học, số HS/dự án, số dự án/trường, giới hạn từ tóm tắt, nhiều vòng, lệ phí, chấm ẩn danh (tuỳ chọn).
- Trường nộp dự án đã duyệt (`competition_submit` kiểm tra phạm vi, cấp học, lĩnh vực, số HS, hồ sơ bắt buộc, số từ). **Ban giám khảo**: người có tài khoản (theo email) hoặc chuyên gia ngoài — cấp tài khoản mã `<mã đơn vị>.gk<n>` (hàm máy chủ `school-accounts`, `kind: 'judge'`; vai trò *Giám khảo* chỉ thấy mục *Chấm thi*). Phân công tự động theo lĩnh vực, chấm theo tiêu chí (`judge_score`), cảnh báo chênh ≥ 15 điểm, hạng theo lĩnh vực, chọn vào vòng sau, trao giải, in giấy chứng nhận. Lệ phí: theo dõi đã nộp / chưa / miễn; KDI xem tổng hợp ở *Nghiệm thu & doanh thu*.

## Sự kiện STEM (từ migration 050)

- Trường (Giảng dạy → *Sự kiện*), Sở (Điều hành & báo cáo → *Sự kiện*), KDI (4.2 *Sự kiện*): tạo sự kiện (ngày hội, triển lãm, cuộc thi, hội thảo, tham quan), chọn đối tượng (HS, GV, phụ huynh, cán bộ), mở cho đơn vị trực thuộc, cần đăng ký (số lượng, hạn) → *Công bố* (sự kiện của trường gửi thông báo cho đối tượng) → xem đăng ký, điểm danh, xuất Excel.
- GV, HS, phụ huynh: mục *Sự kiện* — xem sự kiện sắp tới dành cho mình, đăng ký / huỷ (phụ huynh đăng ký cho từng con). Kiểm tra đối tượng, hạn, sức chứa ở CSDL (`event_register`).

## Chỉ số STEM, Bộ chỉ số, So sánh trường / địa bàn (từ migration 049)

- **Chỉ số STEM** (Sở → Điều hành & báo cáo; KDI → 5.1 *Chỉ số STEM*, *Điều hành toàn tỉnh* gom theo Sở): 11 chỉ số trong 5 nhóm (Hạ tầng, Nhân lực, Triển khai, Kết quả học sinh, Quản trị dữ liệu), mỗi chỉ số 0–100 tính từ số liệu thật (`dept_school_stats`); chỉ số tổng = bình quân có trọng số, xếp Mức 3 Tiên tiến / Mức 2 Đạt / Mức 1 Cần hỗ trợ; xếp hạng trường, gom theo xã/phường, xem chi tiết từng chỉ số, xuất Excel.
- **Bộ chỉ số** (`stem_index_configs`): Sở/Phòng bật/tắt chỉ số, đặt trọng số, mục tiêu, ngưỡng xếp mức, xem trước số trường mỗi mức; trường trực thuộc dùng bộ của cấp trên gần nhất; bộ của KDI là mặc định toàn hệ thống (`stem_index_config()`).
- **So sánh trường / địa bàn**: chọn 2–5 trường hoặc xã/phường, so theo nhóm và từng chỉ số, có cột bình quân toàn đơn vị.

## Cổng Phụ huynh (từ migration 048)

- Trường → Nhân sự & lớp học → **Phụ huynh**: thêm / nhập Excel (mã HS, họ tên, quan hệ, SĐT, email), lọc HS chưa có phụ huynh, xuất Excel.
- Tài khoản: Tài khoản → Tài khoản mã → **Phụ huynh** — tên đăng nhập `<mã trường>.ph<SĐT>`, một tài khoản cho các con cùng trường (cùng SĐT); in phiếu, đặt lại mật khẩu như HS/GV. Hàm máy chủ `school-accounts` nhận `kind: 'parent'`.
- Cổng phụ huynh: Tổng quan, Lịch học 7 ngày, Chuyên cần 30 ngày, Bài tập & điểm, Năng lực của con, Khảo sát, Cài đặt & đồng ý (bật/tắt báo vắng, xác nhận / rút đồng ý dữ liệu trực tuyến). Chọn con khi có nhiều con.
- Bảo mật: vai trò `parent` không là nhân sự (`is_staff` loại trừ) nên không đọc được bảng nào của trường; chỉ đọc dữ liệu con mình qua `parent_children`, `parent_child`, `student_competencies`. Sở / trường khác không xem được SĐT phụ huynh.
- Điểm danh vắng / đi muộn (trong ngày) → thông báo cho phụ huynh có tài khoản (gộp theo con). Khảo sát có thêm đối tượng *Phụ huynh*.

## Giao diện & thương hiệu theo khách hàng (từ migration 047)

- KDI → Quản trị chung → *Giao diện & thương hiệu*: chọn Sở / Phòng / khách hàng → tên hệ thống, logo (nền sáng, nền tối), màu chủ đạo / thanh menu / màu nhấn (có cảnh báo độ tương phản), lời chào và thông tin hỗ trợ trên trang đăng nhập, tên miền riêng; *Áp dụng cho đơn vị trực thuộc* để mọi trường trong tỉnh dùng chung; *Cho đơn vị tự sửa* để Sở tự chỉnh (không đổi được tên miền).
- Ứng dụng tự đổi giao diện theo đơn vị đang làm việc (`my_branding`: đơn vị gần nhất có thương hiệu); cổng KDI luôn giữ giao diện gốc. Trang đăng nhập đổi theo tên miền đang mở (`login_branding`, chỉ trả thông tin công khai).
- Tên miền riêng: thêm *Custom domain* cho Worker `lms` trên Cloudflare và thêm tên miền vào *Redirect URLs* của Supabase Auth.

## Nghiệm thu & doanh thu, sao lưu & xuất dữ liệu (từ migration 046)

- **Nghiệm thu & doanh thu** (KDI → Vận hành KDI): mỗi hợp đồng chia thành các đợt (`contract_milestones`; nút *Chia đều giá trị*), đi qua Kế hoạch → Đã nghiệm thu (biên bản) → Đã xuất hoá đơn → Đã thu; ngày và số tiền thu tự điền. `revenue_overview(năm)` tổng hợp giá trị, đã nghiệm thu, đã xuất HĐ, đã thu, còn phải thu, đợt quá hạn; biểu đồ dòng tiền theo tháng; xuất Excel 2 trang. Khách hàng (quản trị đơn vị có hợp đồng) xem được tiến độ, không sửa.
- **Sao lưu & xuất dữ liệu** (Trường, Sở → Quản trị; KDI → Quản trị chung): chọn nhóm dữ liệu → tải Excel (mỗi bảng một trang) hoặc JSON đầy đủ, gồm cả đơn vị trực thuộc; đọc theo đúng quyền của người xuất, mỗi lần xuất ghi `data_exports` (`log_data_export`). KDI xem dung lượng CSDL, bảng lớn nhất, nhật ký xuất của mọi đơn vị (`backup_overview`). Sao lưu toàn hệ thống do Supabase làm hằng ngày — nên bật Point-in-Time Recovery trước khi chạy chính thức.

## Đề xuất mua vật tư & vận chuyển (từ migration 045)

- **Đề xuất mua vật tư** (Trường → Phòng & thiết bị STEM; KDI → 3.1 Mua hàng & đề xuất vật tư): nháp → *Gửi duyệt* (Hộp phê duyệt, loại "Đề xuất mua vật tư", cấu hình được nhiều bước ở *Quy trình phê duyệt*) → *Nhận hàng* ghi số thực nhận: `supply_request_receive` lập phiếu nhập kho, vật tư chưa có tự thêm vào danh mục.
- **Vận chuyển vật tư**: đơn vị gửi lập phiếu (vật tư + thiết bị) → duyệt tại đơn vị gửi → *Xuất hàng* (`stock_transfer_ship`: trừ kho, thiết bị "Đang vận chuyển", báo đơn vị nhận) → in biên bản giao nhận → đơn vị nhận *Xác nhận nhận* (`stock_transfer_receive`: cộng kho bên nhận theo mã/tên vật tư, thiết bị đổi sang đơn vị nhận vào "Tồn kho"; thiết bị không tới → "Thất lạc"). Gửi được trong cây đơn vị, cùng Sở/Tỉnh; quản trị nền tảng (kho tổng KDI) gửi được mọi đơn vị.
- Thiết bị *Thất lạc* / *Đang vận chuyển* không tính là dùng được khi duyệt phiếu mượn và ở bảng thiết bị toàn hệ thống.

## Khảo sát (từ migration 043)

- **Tạo**: Sở → Điều hành & báo cáo → *Khảo sát*; Trường → Quản trị → *Khảo sát*; Quản trị nền tảng → 5.1 *Khảo sát* (chọn Sở/Tỉnh phát hành). Câu hỏi một lựa chọn, nhiều lựa chọn, thang 1–5, trả lời ngắn; bắt buộc hoặc không; thời gian mở/hạn; ẩn danh. Đối tượng: giáo viên / học sinh / mọi cán bộ, giáo viên — **của đơn vị phát hành và các đơn vị trực thuộc**.
- **Trả lời**: GV và HS ở mục *Khảo sát*; cán bộ quản lý thấy ở đầu trang Khảo sát. Mỗi người một phiếu, sửa được khi khảo sát còn mở. Gửi qua `survey_submit` (kiểm tra đối tượng, thời gian, câu bắt buộc, giá trị hợp lệ) — không ai ghi/đọc thẳng câu trả lời của người khác.
- **Kết quả** (`survey_results`, đơn vị tạo và cấp trên): số phiếu, biểu đồ từng câu, điểm trung bình thang 1–5, danh sách ý kiến (kèm đơn vị; kèm tên nếu không ẩn danh), số phiếu theo đơn vị, xuất Excel. Đã có người trả lời thì không sửa câu hỏi / chế độ ẩn danh được.

## Đánh giá năng lực (từ migration 042)

- **Khung năng lực** (`competencies`, danh mục hệ thống): HS — 3 năng lực chung (tự chủ & tự học; giao tiếp & hợp tác; giải quyết vấn đề & sáng tạo) và 4 năng lực đặc thù STEM (khoa học tự nhiên, công nghệ, tin học, toán học); GV STEM — 5 năng lực, 4 mức Chưa đạt / Đạt / Khá / Tốt (như chuẩn nghề nghiệp GV, TT 20/2018).
- **Năng lực học sinh lấy từ bằng chứng**: mỗi tiêu chí rubric gắn một năng lực (3 mẫu KDI đã gắn sẵn; khi soạn tiêu chí chọn ở ô *Năng lực*). Mức đạt ở các bài đã chấm → **Năng lực học sinh** (GV, Trường: ma trận HS × năng lực theo lớp, trung bình lớp, xuất Excel, bấm HS xem hồ sơ) và **Năng lực của em** (HS). Sở cấp trên xem được.
- **Năng lực giáo viên**: GV → *Hồ sơ năng lực*: tự đánh giá theo năm học (lưu nháp / nộp), xem đánh giá của trường. Trường → Tập huấn giáo viên → *Đánh giá năng lực GV*: xem tự đánh giá, đánh giá của trường, nhận xét, kế hoạch bồi dưỡng, mở lại cho GV sửa, xuất Excel. **Minh chứng tự động** (`teacher_evidence`): khoá/buổi tập huấn, chứng chỉ, tiết STEM đã dạy 12 tháng, giáo án, bài có chấm theo tiêu chí.

## Chấm theo tiêu chí — rubric (từ migration 041)

- **Giao bài** (Giáo viên → Bài tập): ô *Chấm theo tiêu chí* — chọn mẫu của KDI (Sản phẩm STEM theo quy trình thiết kế kỹ thuật; Báo cáo thực hành/thí nghiệm; Thuyết trình dự án nhóm), mẫu của trường, hoặc soạn mới (tên, điểm từng tiêu chí, mô tả 4 mức). *Lưu thành mẫu của trường* để GV khác dùng. Tiêu chí được chụp vào bài lúc giao — sửa mẫu sau không đổi bài đã giao.
- **Chấm bài**: bấm mức 1–4 cho từng tiêu chí; **điểm do CSDL tính** = Σ(điểm tiêu chí × mức/4) / Σ điểm tiêu chí × thang điểm, làm tròn 0,25. Học sinh không tự đặt mức. Lọc theo một đề → bảng *Kết quả lớp theo tiêu chí* (mức trung bình, phân bố M1–M4, tiêu chí cần củng cố) — `rubric_class_summary`, Sở/Phòng cấp trên cũng xem được.
- **Học sinh** thấy tiêu chí khi làm bài và mức đạt từng tiêu chí sau khi được chấm.

## Điều hành của Sở: chỉ tiêu và cảnh báo (từ migration 040)

- **Giao chỉ tiêu** (Sở → Điều hành & báo cáo): theo năm học, cho mọi cấp hoặc từng cấp học — % trường triển khai STEM, % GV đã tập huấn, % HS học STEM, % phòng STEM hoạt động, chuyên cần, % trường đạt KPI ≥ 70. Tiến độ tính từ số liệu thật (`dept_school_stats`), bấm để xem trường chưa đạt. Trường đọc được chỉ tiêu cấp trên giao.
- **Cảnh báo & trường cần chú ý**: chưa kích hoạt, không hoạt động 14 ngày, chưa có chương trình STEM (mức cao); chưa khai báo năm học, GV tập huấn < 50%, có phòng STEM mà không dùng, chuyên cần < 70%, dưới chỉ tiêu. **Nhắc trường** gửi thông báo trong ứng dụng tới Hiệu trưởng/QTV (`dept_notify_school`); **Ghi nhận** lưu ghi chú xử lý. Xuất Excel. Hai màn này thuộc phân hệ *Hệ thống quản lý vận hành* (khoá theo gói như KPI & Báo cáo Bộ).

## Dữ liệu cá nhân (từ migration 039)

- **Điều khoản sử dụng & Chính sách quyền riêng tư**: Quản trị nền tảng → *Điều khoản & dữ liệu cá nhân* → *Phiên bản mới* (nội dung khởi đầu là **bản nháp mẫu, cần luật sư rà soát**) → *Công bố*. Từ đó mọi người dùng phải đọc và đồng ý ở lần vào hệ thống tiếp theo; công bố phiên bản mới thì đồng ý lại. Bản đã công bố không sửa/xoá được. Chưa công bố bản nào thì không ai bị chặn.
- **Đồng ý của cha mẹ**: Trường → *Học sinh*: lọc lớp → *In giấy đồng ý* (mỗi HS nửa trang A4) → thu lại → *Nhập đồng ý PH* (file mẫu có sẵn HS chưa có đồng ý) hoặc ghi nhận từng em ở *Đồng ý & dữ liệu*; ghi nhận rút lại đồng ý. Sở/KDI chỉ xem tỉ lệ theo trường (`consent_summary`), không xem thông tin phụ huynh. Tuỳ chọn **bắt buộc có đồng ý trước khi tạo tài khoản HS** ở trang của Quản trị nền tảng.
- **Xuất / xoá dữ liệu của một học sinh** (*Đồng ý & dữ liệu*): *Xuất dữ liệu* tải JSON (thông tin, đồng ý, điểm danh, bài nộp, tự học). *Xoá dữ liệu cá nhân* (chỉ Hiệu trưởng/QTV, phải ghi lý do và gõ lại mã HS): xoá họ tên, mã, nội dung bài làm, đồng ý, lời mời; khoá tài khoản; email/tên trong Supabase Auth được hàm máy chủ thay bằng giá trị ẩn danh và cấm đăng nhập. Điểm danh, điểm số giữ ở dạng không định danh. Cả hai đều ghi nhật ký.

## Nhập dữ liệu đầu năm

Thứ tự gợi ý cho một trường mới: **Giáo viên** (Nhập Excel) → **Lớp học** (Nhập Excel: tên lớp, khối, GVCN theo họ tên hoặc email, chương trình STEM) → **Học sinh** (Nhập Excel: mã HS, họ tên, lớp) → **Thời khóa biểu** → **Tài khoản** (tạo tài khoản HS/GV bằng mã, in phiếu).
- Nhập học sinh: lớp chưa có được **tự tạo** trong năm học đang chọn (khối lấy từ tên lớp, vd `6A1` → 6); học sinh đã có (trùng mã) được **cập nhật họ tên và lớp** — dùng khi lên lớp đầu năm.
- Nhập lớp: lớp đã có (trùng tên trong năm học đang chọn) chỉ cập nhật GVCN, khối, chương trình nếu file có ghi.
- **Toạ độ trường** (bản đồ độ phủ STEM, migration 038): Sở → *Danh sách Trường* hoặc Quản trị nền tảng → *Cơ sở triển khai* → **Nhập toạ độ từ Excel**. "Tải file mẫu" tải sẵn danh sách trường trong phạm vi kèm toạ độ hiện có; điền cột Vĩ độ/Kinh độ hoặc dán ô *Toạ độ* từ Google Maps (chuột phải vào vị trí → bấm dòng số `20.65…, 106.05…`). Toạ độ ngoài Việt Nam (thường do đảo cột) bị từ chối theo dòng.

## Tài khoản học sinh, giáo viên không cần email (từ migration 037)

Trường · Quản trị → **Tài khoản** → tab *Tài khoản học sinh, giáo viên (không cần email)*: chọn HS (lọc theo lớp) hoặc GV chưa có tài khoản → **Tạo tài khoản** → **In phiếu tài khoản** (2 phiếu một hàng, khổ A4) hoặc **Tải Excel**. Mật khẩu chỉ hiện một lần.
- Tên đăng nhập: HS `<mã trường>.<mã HS>` (vd `thcsph.hs0012`), GV `<mã trường>.gv1, .gv2…` — chỉ chữ thường, số, dấu chấm. Trường phải có mã đơn vị; HS phải có mã HS.
- Ô đăng nhập nhận email **hoặc** tên đăng nhập. Lần đầu đăng nhập (và sau khi trường đặt lại mật khẩu) phải đặt mật khẩu mới.
- Quên mật khẩu: quản trị trường bấm **Đặt lại mật khẩu** (có ghi nhật ký). "Quên mật khẩu" qua email không dùng cho tài khoản mã.
- Bên trong: Supabase Auth cần email nên tài khoản dùng email nội bộ `<tên đăng nhập>@tk.kdi.edu.vn` (không có hộp thư, không gửi thư; đổi miền ở `security_settings.login_domain` **trước** khi tạo tài khoản đầu tiên). Tạo tài khoản/đặt mật khẩu cần quyền quản trị Auth nên chạy trong **hàm máy chủ** `supabase/functions/school-accounts`; quyền và phạm vi kiểm tra trong CSDL (`account_prepare`, `account_reset_target`) bằng JWT người bấm. Tài khoản được gán trường, vai trò, hồ sơ HS/GV qua cơ chế lời mời (014/019).
- **Đưa hàm máy chủ lên (một lần):** Supabase → Account → **Access Tokens** → *Generate new token* → GitHub → Settings → Secrets and variables → Actions → thêm `SUPABASE_ACCESS_TOKEN`. Từ đó job `deploy-functions` tự đưa mọi hàm trong `supabase/functions` lên sau khi migration chạy xong trên main (mã project đọc từ `SUPABASE_DB_URL`). Chưa có secret thì job bỏ qua; nút Tạo tài khoản báo "chưa kết nối được hàm".

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

Menu xếp theo phương án C: **Vận hành KDI** (khách hàng, hợp đồng, triển khai, hỗ trợ, nghiệm thu) · **Lõi** (tổ chức, tài khoản, phê duyệt, thông báo) · **5 phân hệ nghiệp vụ** là đơn vị bán (PH1 Đào tạo & năng lực nhà giáo, PH2 Chương trình & học liệu, PH3 Vật tư, thiết bị & phòng STEM, PH4 Vận hành giảng dạy & đánh giá người học, PH5 Điều hành & báo cáo) · **Nền tảng kỹ thuật**.

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

## Bản đồ độ phủ STEM theo xã/phường (Dashboard toàn Sở, từ migration 036)

- Tô màu xã/phường (Hưng Yên mới: 104) theo **Mức STEM** (Mức 3: bao phủ STEM ≥ 75% và GV tập huấn ≥ 80%; Mức 2: ≥ 50% và ≥ 50%; Mức 1: bao phủ ≥ 20%; còn lại Chưa xếp), **Bao phủ STEM** (% trường đã triển khai CT) hoặc **GV tập huấn**; lọc theo khối; chuyển Bản đồ / Danh sách. Bấm xã/phường → phóng to, hiện từng trường; bảng bên phải: Tổng quan · Xếp hạng · Cảnh báo.
- Trường được xếp vào xã/phường theo toạ độ (`organizations.lat/lng`) nằm trong ranh giới nào; chưa có toạ độ thì khớp theo tên xã/phường. Đặt vị trí: KDI, Sở/Phòng/Tỉnh cấp trên hoặc quản trị chính trường (`set_school_location`), hoặc ngay trên bản đồ.
- **Quản trị nền tảng → Tổng quan hệ thống**: cùng bản đồ ở cấp **cả nước** (34 tỉnh/thành, có Đặc khu Hoàng Sa – TP Đà Nẵng và Đặc khu Trường Sa – tỉnh Khánh Hòa kèm nhãn); bấm tỉnh → xã/phường → từng trường, thanh điều hướng Cả nước › Tỉnh › Xã/phường.
- Ranh giới: `public/geo/provinces.json` (34 tỉnh/thành) và `public/geo/<mã tỉnh>.json` (xã/phường của cả 34 tỉnh, 3.321 đơn vị, tải khi bấm vào tỉnh), rút gọn từ [vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database) (MIT), nguồn gốc [sapnhap.bando.com.vn](https://sapnhap.bando.com.vn); xem `public/geo/NGUON.txt`. Dựng lại: tải bộ dữ liệu rồi `node scripts/build-geo.mjs <đường dẫn json/geojson> all` — đảo nhỏ < 20 km² giữ nguyên (không rút gọn), script dừng nếu đơn vị nào mất vùng/đảo; tên đầy đủ (Tỉnh/Thành phố) lấy theo dữ liệu (từ 20/9/2026 có 9 TP trực thuộc TW). Không dùng nền bản đồ ngoài.

## Sinh buổi dạy tự động (từ migration 035)

- `generate_upcoming_sessions(28)`: sinh/đồng bộ tiết từ TKB cho **mọi trường** đang hoạt động có phân hệ TKB, từ hôm nay đến 28 ngày tới. Chạy hằng đêm 02:15 (giờ Việt Nam) bằng `pg_cron` (lịch `generate-upcoming-sessions`); một trường lỗi không chặn trường khác. Mỗi lần chạy ghi vào `system_job_runs` (chỉ quản trị nền tảng đọc). Quản trị nền tảng chạy tay: `select platform_generate_upcoming_sessions(28)`.
- Phần lõi `sync_teaching_sessions(trường, từ, đến)` dùng chung với màn Buổi dạy (`generate_teaching_sessions` giữ nguyên quyền và cách gọi).
- Ngày nghỉ thêm/sửa/xoá ở bất kỳ cấp nào (trường, Phòng, Sở, Tỉnh) → các trường thuộc cấp đó được đồng bộ ngay trong 63 ngày tới: tiết chưa điểm danh rơi vào ngày nghỉ bị bỏ, tiết đã điểm danh giữ nguyên, xoá ngày nghỉ thì tiết trở lại.
- Kiểm tra lịch và các lần chạy trên CSDL thật: Run workflow với `schema_diff` → `facts.txt` trên nhánh `ci/schema-diff`.
- Lưu ý: chạy `isolation_test.sql` trên CSDL thật sẽ sinh tiết 28 ngày tới cho các trường (như lịch nền).

## Chống trùng lịch phòng, giáo viên, thiết bị (từ migration 029)

- **Sổ giữ chỗ phòng STEM** (`resource_bookings`): mọi tiết dạy (theo TKB, dạy bù), đăng ký dạy STEM (chờ duyệt/đã duyệt) và phiếu mượn dùng tại phòng (chờ duyệt/đã duyệt/đang mượn) đều giữ phòng theo khung giờ của tiết. Ràng buộc loại trừ (`btree_gist`) chặn hai lịch khác lớp cùng phòng, chồng giờ — kể cả hai người bấm gửi cùng lúc. Cùng một lớp dùng lại phòng của chính tiết mình không tính là trùng.
- **Lỗi trả về** mã `23P01`, câu báo tiếng Việt nêu rõ phòng/GV và lịch đang giữ (vd: *Phòng Robotics đã có lịch lúc 23/10/2026 09:30–10:15: Tiết 4 · Lớp 8A · Công nghệ*). Các màn cũ hiện nguyên câu này.
- **Thời khoá biểu**: không thêm/sửa được tiết làm trùng phòng hoặc trùng GV ở cùng thứ, cùng tiết, cùng học kỳ (tiết "mọi học kỳ" chồng với mọi học kỳ). **Giáo viên**: tiết dạy bù, tiết sửa tay và đăng ký dạy STEM không được trùng giờ với tiết khác của chính GV đó.
- **Dữ liệu cũ đã trùng** (TKB mẫu có 75 chỗ trùng phòng): không bị chặn, không bị sửa — được ghi vào `booking_conflicts` để trường xử lý. Tiết sinh từ TKB mà trùng cũng ghi vào đây thay vì làm hỏng việc sinh buổi dạy. Khi lịch đang giữ phòng bị huỷ/đổi/xoá, lịch đang chờ tự được xếp vào.
- **Thiết bị**: giáo viên vẫn gửi phiếu mượn khi thiếu (như trước), nhưng phiếu chỉ **duyệt/giao** được khi còn đủ thiết bị dùng được (trừ hỏng, bảo trì) sau khi trừ các phiếu đã duyệt/đang mượn chồng giờ. Màn mượn của giáo viên hiện *còn trống tiết này* (`equipment_availability`).
- **Quản trị nền tảng**: *Phòng STEM & lịch phòng* (`room_overview`: công suất, nguồn lịch, phòng chưa có lịch, chỗ trùng, lịch từng phòng; xuất Excel) và *Thiết bị, vật tư & kho* (`equipment_overview`, `equipment_type_summary`: theo trường và theo loại, hỏng/bảo trì, bảo hành sắp hết, phiếu mượn). Sở/Phòng gọi được cùng các hàm, chỉ thấy trường trực thuộc.
- Chưa có: vật tư tiêu hao và kho tổng, kiểm kê (quét QR), vận chuyển vật tư giữa đơn vị.
- Supabase: `btree_gist` được tạo trong schema `extensions` (có sẵn trên Supabase, không cần bật tay).

## Kho hoạt động, học trước & tự học, ngày nghỉ (từ migration 030)

- **Kho hoạt động & Bài giảng** (giáo viên): 8 mẫu — *Trắc nghiệm, Đúng/Sai, Ghép đôi, Sắp xếp thứ tự, Điền khuyết* (`[đáp án|cách viết khác]`), *Phân loại, Thẻ ghi nhớ* (không chấm), *Phiếu học tập* (câu trả lời mở, GV chấm/nhận xét). Bản nháp lưu tự do; **xuất bản** chỉ được khi nội dung đầy đủ (CSDL kiểm tra `activity_problem`). Tab *Kho của trường*: mẫu của trường và bài đồng nghiệp đã xuất bản (*Dùng bài này* tạo bản của mình). *Chơi thử / Trình chiếu* chấm bằng đúng hàm của CSDL.
- **Học trước & tự học**: GV giao hoạt động, bài giảng (xem trước slide) hoặc đường dẫn cho một hay nhiều lớp mình dạy; mục đích *Học trước tiết* (ghi ngày tiết) hoặc *Tự luyện*; hạn, số lượt làm (0 = không giới hạn), nháp/mở/khoá. Nội dung **được chụp lại lúc giao** (`self_study_content`) — sửa/xoá hoạt động gốc không ảnh hưởng bài đã giao. Học sinh nhận thông báo.
- **Học sinh không đọc được đáp án**: không có quyền đọc `activities` hay `self_study_content`; đề lấy qua `self_study_open()` (bỏ đáp án, xáo thứ tự theo từng HS), nộp qua `self_study_submit()` — CSDL chấm, lưu điểm lần cuối và điểm cao nhất, đánh dấu trễ hạn. Đáp án chỉ hiện khi hết lượt, quá hạn hoặc GV khoá bài. HS không tự ghi/sửa tiến độ; GV chỉ sửa được nhận xét (và điểm phiếu học tập), không sửa câu trả lời/số lượt (trigger).
- GV xem tiến độ từng HS (đã mở / đang làm / đã xong, điểm, câu trả lời), nhận xét, xuất Excel; Tổng quan GV nhắc *phiếu học tập chờ nhận xét*. Sở/cấp trên đọc được tiến độ của trường trực thuộc (`self_study_stats`).
- **Học sinh**: *Học trước & tự học* (Cần làm / Đã xong), *Chuyên cần* (điểm danh của mình theo học kỳ / 30 ngày / 7 ngày, ngày nghỉ sắp tới). Tổng quan HS có thẻ bài tự học cần làm.
- **Ngày nghỉ & lễ** (`school_holidays`): trường (quyền *Năm học & học kỳ*) khai báo nghỉ riêng; Sở/Phòng/Tỉnh khai báo cho mọi trường trực thuộc. `generate_teaching_sessions` không sinh tiết vào ngày nghỉ của trường và của cấp trên; khi trường lưu/xoá ngày nghỉ, các tiết chưa diễn ra được bỏ/sinh lại ngay. Tiết dạy bù vẫn thêm được vào ngày nghỉ. Ghi nhật ký hệ thống.
- **Sở**: *Hiệu quả Phòng STEM* so sánh *theo TKB* với *thực dạy tại phòng* (tiết đã điểm danh, 4 tuần gần nhất), tỉ lệ lấp đầy lịch phòng, chỗ trùng, tiết STEM đã dạy/kế hoạch, cảnh báo trường có phòng nhưng không dùng; thêm mục *Phòng STEM & lịch phòng* và *Thiết bị & kho* (cùng màn với cổng nền tảng, chỉ thấy trường trực thuộc).

## Cơ sở triển khai (từ migration 032)

Quản trị nền tảng → Lõi → **Cơ sở triển khai**: mỗi trường trên toàn hệ thống một dòng (`platform_school_registry()`, chỉ quản trị nền tảng gọi được).

- **Giai đoạn**: Tiềm năng / Tạm dừng / Đã kết thúc (theo trạng thái khách hàng của trường, hoặc của Sở/Tỉnh nếu trường chưa đặt) → **Vận hành** (đã nghiệm thu, đến ngày vận hành, hoặc có tiết được điểm danh trong 14 ngày) → **Đang triển khai** (đã khởi động, đã kích hoạt hoặc ≥ 3 bước) → **Khởi tạo**.
- **Tiến độ**: 14 bước như màn Triển khai khách hàng (9 bước tự tính từ dữ liệu trường, 5 bước KDI đánh dấu).
- **Sức khoẻ**: *Nguy cơ* — hợp đồng hết hạn hoặc còn ≤ 30 ngày, đang vận hành mà 14 ngày không có tiết nào được điểm danh, có phiếu hỗ trợ khẩn; *Cần chú ý* — hợp đồng còn 31–60 ngày, điểm danh dưới 50% số tiết 4 tuần, triển khai quá 60 ngày chưa nghiệm thu, chưa có quản trị trường, không ai đăng nhập 14 ngày.
- Lọc theo tỉnh, giai đoạn, cấp học, người phụ trách KDI; lọc nhanh *Cần chú ý / Đang triển khai / HĐ sắp hết hạn / Chưa có phụ trách*; xuất Excel; **nhập nhiều trường từ Excel** (mã, tên, cấp học, mã Sở/Phòng quản lý, xã/phường, đầu mối — dòng lỗi bị bỏ qua và báo lý do).
- **Hồ sơ trường** 7 tab: Tổng quan (người phụ trách KDI, ngày vận hành, trạng thái khách hàng, đầu mối — `platform_update_school`), Hợp đồng & gói, Triển khai (đánh dấu bước), Sử dụng (buổi dạy 8 tuần — `platform_school_trend`), Người dùng, Chuyên môn STEM, Hỗ trợ & nhật ký; tạm dừng / mở lại trường.
- Cột mới `organizations.kdi_owner`, `go_live_on`: chỉ quản trị nền tảng đổi được (cùng với trạng thái khách hàng); Sở sửa thông tin trường trực thuộc như trước.

## Quản trị chung quản lý 5 phân hệ (từ migration 033)

- **Phân hệ bán = 5 phân hệ của menu** (`service_modules`): PH1 Đào tạo & đánh giá năng lực nhà giáo (`training`), PH2 Chương trình & học liệu (`library`, `packages`, `curriculum`), PH3 Vật tư, thiết bị dạy & học (`stem_rooms`, `equipment`, `warranty`), PH4 Vận hành giảng dạy & đánh giá người học (`timetable`, `edu_plan`, `stem_registrations`, `stem_assign`), PH5 Hệ thống quản lý vận hành (`governance` — KPI & xếp hạng, báo cáo Bộ ở cổng Sở).
- Gói cũ được chuyển tự động, **không đơn vị nào mất chức năng đang dùng**: Phòng STEM → PH3; KH GD & TKB → PH4 + PH2 (vì có phân phối chương trình); Gói STEM, Học liệu → PH2; Tập huấn → PH1. **Phê duyệt** thành phần lõi (xuyên suốt, không khoá theo gói). Bản cũ lưu ở `service_plans_legacy`. Gói sau chuyển: Cơ bản = PH3, Tiêu chuẩn = PH2–PH4, Toàn diện = PH1–PH4; thêm Sở – Điều hành (PH2–PH5), Sở – Toàn diện (PH1–PH5).
- **Tổng quan → Phân hệ & mức sử dụng** (`platform_module_usage`, `platform_module_usage_detail`): mỗi phân hệ — số gói, hợp đồng hiệu lực, trường được bật / đang dùng thật (có lượt dùng 28 ngày), số lượt, chức năng đã có màn / còn khung; bấm vào xem từng trường (đang dùng · bật nhưng chưa dùng · chưa mua), xuất Excel.
- **Lõi → Vai trò & quyền mặc định**: ma trận vai trò (Hiệu trưởng, QTV CNTT, Nhân viên văn phòng, Giáo viên) × chức năng, nhóm theo Lõi và PH1–PH4; quản trị nền tảng sửa trên giao diện (trước chỉ sửa bằng SQL), mỗi thay đổi ghi nhật ký; cột *Trường chỉnh riêng* cho biết bao nhiêu trường đang dùng quyền riêng (không bị ảnh hưởng).

## Kiểm thử cách ly dữ liệu

- `supabase/tests/isolation_test.sql`: 340 phép thử "tỉnh A không đọc/ghi được dữ liệu tỉnh B", Phòng chỉ thấy trường trực thuộc, quyền quản trị không mang sang đơn vị khác, đổi đơn vị đang làm việc, quyền của quản trị nền tảng, tạm dừng đơn vị, quy trình phê duyệt nhiều bước (đúng người, đúng bước, Sở tỉnh khác không duyệt được), kho học liệu (đúng phạm vi phát hành, chỉ trường dùng được, báo bản cập nhật), chống trùng lịch phòng/GV/thiết bị (029), kho hoạt động, học trước & tự học (HS không đọc được đáp án, không tự chấm), ngày nghỉ áp từ Sở xuống trường (030), sổ cơ sở triển khai chỉ KDI xem/sửa, nhập trường từ Excel (032), khoá theo 5 phân hệ, mức sử dụng chỉ KDI xem, quyền mặc định chỉ KDI sửa (033), vai trò tuỳ chỉnh chỉ do quản trị chính đơn vị sửa, quyền mặc định Giáo viên (034), chỉ hệ thống/KDI chạy sinh buổi dạy hàng loạt, ngày nghỉ của Sở bỏ tiết chưa điểm danh của trường trực thuộc và giữ tiết đã điểm danh (035), vị trí trường chỉ KDI, Sở cấp trên hoặc quản trị chính trường đặt được (036). Chạy được trong **Supabase SQL Editor** (sau 020; phần nền tảng cần 021): tự tạo tài khoản thử `*@iso-test.local`, mọi lệnh thử bị huỷ, cuối cùng xoá sạch và in bảng PASS/FAIL.
- `supabase/tests/run.sh`: chạy hai lượt trên CSDL Postgres trống (GitHub Actions chạy tự động khi `supabase/` thay đổi): (1) migration **không** dữ liệu mẫu rồi `tests/clean_check.sql` kiểm tra CSDL chỉ có danh mục hệ thống; (2) migration **có** dữ liệu mẫu rồi bộ kiểm thử cách ly.

## Dữ liệu mẫu & chạy migration tự động

**Cờ dữ liệu mẫu.** Khối dữ liệu mẫu trong migration chỉ chạy khi phiên kết nối có `app.seed_demo=on` (vd `PGOPTIONS="-c app.seed_demo=on" psql -f ...`). Không bật cờ (mặc định, gồm cả Supabase CLI và SQL Editor) thì migration chỉ tạo cấu trúc và danh mục hệ thống: đơn vị cung cấp KDI Education, vai trò & quyền mặc định, phân hệ PH1–PH5, 5 gói dịch vụ, danh mục tích hợp, cấu hình bảo mật. CSDL demo hiện tại đã có dữ liệu mẫu từ trước nên không bị ảnh hưởng.
- Migration mới: **không** chèn dữ liệu mẫu trong migration. Nếu cần dữ liệu mẫu, bọc khối `do $$` bằng `if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;`. Bảng danh mục mới phải thêm vào danh sách cho phép trong `tests/clean_check.sql`, nếu không CI sẽ báo `CLEAN FAIL`.
- Dựng CSDL demo mới từ đầu: chạy migration bằng psql với `PGOPTIONS="-c app.seed_demo=on"` (như `run.sh`).

**Chạy migration tự động (job `migrate` trong `.github/workflows/db-tests.yml`).** Khi main có thay đổi trong `supabase/`, sau khi kiểm thử xanh, CI chạy `supabase db push` lên CSDL trong secret `SUPABASE_DB_URL` — chỉ chạy migration chưa có trong lịch sử, không chèn dữ liệu mẫu. Chưa có secret thì job bỏ qua. Đổi CSDL (vd chuyển production về Việt Nam) chỉ cần đổi secret.

Thiết lập một lần cho project Supabase hiện tại (đã chạy tay migration qua SQL Editor):
1. Dán `supabase/scripts/check_applied.sql` vào SQL Editor để biết CSDL đã chạy tới migration nào (cột `ket_qua`). Migration nào `false` thì chạy tay trước cho đủ.
   Nếu dòng *lịch sử* có version 14 chữ số (vd `20261014083903`, do Supabase MCP/dashboard ghi), dán `supabase/scripts/clean_foreign_history.sql` để sao lưu rồi xoá các bản ghi đó khỏi lịch sử (không đụng dữ liệu, cấu trúc).
2. GitHub → Settings → Secrets and variables → Actions: thêm `SUPABASE_DB_URL` = chuỗi kết nối **Session pooler** (Supabase → Connect → Session pooler, dạng `postgresql://postgres.<project-ref>:<mật khẩu>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`). Không dùng Direct connection: máy chạy GitHub Actions không có IPv6.
3. GitHub → Actions → *Kiểm thử CSDL* → **Run workflow** với `baseline_upto` = số migration cuối đã chạy (vd `033`): chỉ ghi lịch sử "đã chạy", không chạy SQL nào.
4. Run workflow lần nữa với `dry_run` bật, `baseline_upto` để trống: phải báo *Remote database is up to date*.
- Nếu quên bước 3, job `migrate` dừng với lỗi *chưa baseline* chứ không chạy lại từ 001.
- Sau khi bật CI, **không** chạy migration qua SQL Editor hay Supabase MCP nữa: mọi migration đi qua PR → main → CI. Chạy ngoài luồng sẽ ghi version lạ vào lịch sử và CI từ chối chạy.
- Muốn duyệt tay trước mỗi lần chạy: Settings → Environments → `production` → *Required reviewers*.
- **So sánh cấu trúc CSDL thật với repo** (chỉ đọc): Run workflow với `schema_diff` bật. Job dựng CSDL từ repo, lấy dấu vân tay cột, hàm, policy, trigger, ràng buộc, chỉ mục và quyền mặc định của cả hai (`supabase/scripts/schema_fingerprint.sql`) rồi in chỗ khác nhau ở *Summary* của lần chạy (artifact `schema-diff`). Dùng sau khi CSDL bị sửa ngoài luồng migration.

## Triển khai Cloudflare (Workers Builds, kết nối GitHub)
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (đọc cấu hình trong `wrangler.jsonc`; tên Worker phải trùng tên project trên Cloudflare)
- Biến môi trường (đặt trước khi build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (giá trị như `.env.example`)
- Sau khi có địa chỉ `*.workers.dev`, thêm vào Supabase → Authentication → URL Configuration (Site URL / Redirect URLs).
- Không dùng file `_redirects` cho kiểu này: quy tắc `/* /index.html 200` bị Cloudflare từ chối vì lặp vô hạn. Việc trả về `index.html` cho đường dẫn con đã do `not_found_handling` trong `wrangler.jsonc` đảm nhiệm.

## Gói dịch vụ, bảo mật, hỗ trợ (từ migration 024)

**Gói dịch vụ & hợp đồng** (Quản trị nền tảng → Vận hành KDI)
- Phân hệ bán được (`service_modules`): từ 033 là 5 phân hệ PH1–PH5 (xem mục *Quản trị chung quản lý 5 phân hệ*). Phần lõi (tài khoản, vai trò, giáo viên, lớp, học sinh, phân công, năm học, toà nhà, phê duyệt) luôn dùng được.
- Gói (`service_plans`) gồm danh sách phân hệ; có sẵn gói Cơ bản / Tiêu chuẩn / Toàn diện / Sở – Điều hành / Sở – Toàn diện (chưa đặt giá).
- Hợp đồng (`contracts`) gắn một đơn vị với một gói, có thời hạn. Quyền dùng của một đơn vị = hợp đồng gần nhất đi từ chính nó lên cấp trên (Sở mua, bật *Áp dụng cho đơn vị trực thuộc* → mọi trường của Sở dùng theo):
  - **chưa có hợp đồng nào trên cây** → không giới hạn (giữ nguyên hành vi trước 024);
  - **hợp đồng còn hiệu lực** → chỉ các phân hệ trong gói;
  - **hết hạn / tạm dừng / kết thúc** → chỉ phần lõi.
- Kiểm tra nằm trong `has_perm()` nên mọi lệnh ghi qua RLS đều bị chặn khi đơn vị chưa mua phân hệ; menu các giao diện trường, giáo viên, Sở ẩn mục tương ứng.
- **Thông tin khách hàng**: trạng thái khách hàng, đầu mối, quyền dùng hiện tại của từng đơn vị, cảnh báo hợp đồng sắp hết hạn (≤ 60 ngày).

**Bảo mật tài khoản** (Quản trị nền tảng → Nền tảng kỹ thuật)
- Xác thực 2 lớp (ứng dụng TOTP) bắt buộc theo vai trò (mặc định: Quản trị nền tảng). Người thuộc vai trò bắt buộc phải quét mã QR và nhập mã 6 số sau khi đăng nhập. Cần bật **Authentication → Multi-Factor → TOTP** trong Supabase Dashboard.
- *Chặn ở cơ sở dữ liệu* (tắt mặc định): khi bật, quyền Quản trị nền tảng chỉ có hiệu lực ở phiên đã xác thực 2 lớp (`aal2`). Chỉ bật sau khi mọi quản trị nền tảng đã đăng ký ứng dụng xác thực.
- Khoá tài khoản: người bị khoá mất quyền đọc/ghi mọi dữ liệu ngay lập tức (`my_org_id()` trả về rỗng). Không khoá được quản trị nền tảng.
- Tự đăng xuất khi không thao tác (phút). Xem và thu hồi phiên đăng nhập (đọc `auth.sessions`; nếu thiếu quyền trên schema `auth`, trang báo rõ).

**Hỗ trợ khách hàng**
- Trường, Sở gửi yêu cầu ở mục **Hỗ trợ từ KDI**; KDI xử lý ở **Vấn đề & phản hồi** (Vận hành KDI). Mỗi phiếu có mã `HT-xxxxx`, hạn xử lý theo mức ưu tiên (khẩn cấp 4 giờ, cao 1 ngày, bình thường 3 ngày, thấp 7 ngày), người xử lý, trao đổi hai chiều và ghi chú nội bộ (khách hàng không thấy). Có thông báo trong ứng dụng cho cả hai phía.
- KDI xử lý phiếu bảo hành thiết bị của mọi trường ở tab *Bảo hành thiết bị*.

## Vận hành khách hàng (từ migration 025)

- **Triển khai khách hàng** (Vận hành KDI): checklist 14 bước cho từng trường. Bước tự động lấy từ dữ liệu (hợp đồng hiệu lực, kích hoạt, năm học, giáo viên, học sinh, phòng STEM, thiết bị, thời khoá biểu, hoạt động ≤ 7 ngày); bước KDI tự đánh dấu (họp khởi động, tập huấn quản trị, bàn giao thiết bị, tập huấn giáo viên, nghiệm thu). Cảnh báo trường đã kích hoạt nhưng không dùng 14 ngày.
- **Chương trình giáo dục** (PH2): danh mục gói STEM của KDI (= `stem_packages` thuộc đơn vị chủ nền tảng, `catalog_active`), soạn chủ đề và buổi học. Trường xem danh mục qua `package_catalog()`; gói danh mục không lẫn vào mục Gói STEM của trường.
- **Đơn đặt gói STEM** (Vận hành KDI): trường chọn gói trong danh mục khi lập đề xuất mua gói → duyệt theo quy trình của trường/Sở → KDI xác nhận, báo giá, giao. **Đã giao** sao chép gói (chủ đề, buổi học) vào mục Gói STEM của trường và gửi thông báo cho người lập đơn. Trường không tự sửa được phần xử lý của KDI.
- **Thông báo** (Lõi): gửi vào chuông thông báo theo đơn vị (kèm cấp dưới), loại đơn vị, vai trò; xem trước số người nhận; thống kê đã đọc. Tài khoản bị khoá và đơn vị tạm dừng không nhận.
- **Tích hợp & dữ liệu** (Nền tảng kỹ thuật): trạng thái từng kết nối (K12Online, VNeID, email, Zalo OA, Excel) và độ đầy đủ dữ liệu của từng trường. Khoá truy cập của đối tác đặt trong Supabase secrets, không lưu trong bảng.
