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
Chạy lần lượt các file trong `supabase/migrations/` theo số thứ tự (001 schema, 002 dữ liệu mẫu, 003 trigger demo, 004 thời khóa biểu và đăng ký STEM, 005 học sinh và phân quyền, 006 gói STEM/tập huấn/PPCT, 007 ticket bảo hành mẫu, 008 gán tài khoản và vai trò, 009–010 mở rộng và dữ liệu mẫu theo video thứ hai, 011 đường dẫn phòng họp tập huấn, 012 siết phân quyền RLS, 013 nền học tập: chủ đề/buổi học, bài tập, bài nộp, nhóm, phiên lớp có mã PIN, 014 vai trò tuỳ chỉnh và mời người dùng qua email, 015 soạn bài giảng tương tác, trình chiếu trên lớp và phiếu mượn thiết bị của giáo viên). Các file dữ liệu mẫu chỉ chạy khi chưa có dữ liệu.

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
- Giáo viên tự gửi đăng ký dạy STEM, phiếu mượn, báo hỏng thiết bị, điểm danh tập huấn của chính mình; giao bài, chấm bài, mở phiên lớp (PIN) cho lớp mình dạy.
- Học sinh nộp bài của mình/nhóm mình, cập nhật tiến độ, thảo luận trong chủ đề lớp mình, vào lớp bằng PIN (`join_class_session`). Học sinh không thể tự chấm điểm (trigger `guard_submission`).

## Triển khai Cloudflare (Workers Builds, kết nối GitHub)
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (đọc cấu hình trong `wrangler.jsonc`; tên Worker phải trùng tên project trên Cloudflare)
- Biến môi trường (đặt trước khi build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (giá trị như `.env.example`)
- Sau khi có địa chỉ `*.workers.dev`, thêm vào Supabase → Authentication → URL Configuration (Site URL / Redirect URLs).
- Không dùng file `_redirects` cho kiểu này: quy tắc `/* /index.html 200` bị Cloudflare từ chối vì lặp vô hạn. Việc trả về `index.html` cho đường dẫn con đã do `not_found_handling` trong `wrangler.jsonc` đảm nhiệm.
