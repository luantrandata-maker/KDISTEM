# Hệ thống Quản trị STEM

Giai đoạn 1–2: nền tảng + vận hành trường. React + TypeScript + Vite, Supabase.

## Chạy trên máy
1. Sao chép `.env.example` thành `.env` (đã điền sẵn project Supabase demo).
2. `npm install && npm run dev`
3. Đăng ký tài khoản. Từ migration 012, tài khoản mới **không** tự thành quản trị: mọi tài khoản ở trạng thái chờ, quản trị gán vào trường, gán vai trò và liên kết hồ sơ giáo viên/học sinh trong mục Tài khoản.
   Cấp quản trị đầu tiên cho một trường (chạy trong Supabase SQL Editor, thay email và mã trường):
   ```sql
   update profiles set org_id = (select id from organizations where code = 'THCS-PH') where email = 'ban@truong.edu.vn';
   insert into user_roles (user_id, role_id)
   select p.id, r.id from profiles p, roles r where p.email = 'ban@truong.edu.vn' and r.key = 'principal' and r.org_id is null
   on conflict do nothing;
   ```

## Cơ sở dữ liệu
Chạy lần lượt các file trong `supabase/migrations/` theo số thứ tự (001 schema, 002 dữ liệu mẫu, 003 trigger demo, 004 thời khóa biểu và đăng ký STEM, 005 học sinh và phân quyền, 006 gói STEM/tập huấn/PPCT, 007 ticket bảo hành mẫu, 008 gán tài khoản và vai trò, 009–010 mở rộng và dữ liệu mẫu theo video thứ hai, 011 đường dẫn phòng họp tập huấn, 012 siết phân quyền RLS, 013 nền học tập: chủ đề/buổi học, bài tập, bài nộp, nhóm, phiên lớp có mã PIN). Các file dữ liệu mẫu chỉ chạy khi chưa có dữ liệu.

## Phân quyền (từ migration 012)

- **Đọc**: nhân sự đọc dữ liệu trong phạm vi tổ chức (Sở đọc được các trường trực thuộc). Học sinh chỉ đọc danh mục cơ bản và dữ liệu của lớp mình.
- **Ghi**: theo ma trận Xem / Chi tiết / Tạo / Sửa / Xoá (`has_perm(module, action)`). Hiệu trưởng và QTV CNTT có toàn quyền trong trường.
- Ma trận mặc định (`role_permissions`) dùng chung, chỉ sửa bằng SQL. Mỗi trường tự chỉnh trong mục *Vai trò và phân quyền*, lưu vào `org_role_permissions` và chỉ áp dụng cho trường đó.
- Giáo viên tự gửi đăng ký dạy STEM, phiếu mượn, báo hỏng thiết bị, điểm danh tập huấn của chính mình; giao bài, chấm bài, mở phiên lớp (PIN) cho lớp mình dạy.
- Học sinh nộp bài của mình/nhóm mình, cập nhật tiến độ, thảo luận trong chủ đề lớp mình, vào lớp bằng PIN (`join_class_session`). Học sinh không thể tự chấm điểm (trigger `guard_submission`).

## Triển khai Cloudflare (Workers Builds, kết nối GitHub)
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (đọc cấu hình trong `wrangler.jsonc`; tên Worker phải trùng tên project trên Cloudflare)
- Biến môi trường (đặt trước khi build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (giá trị như `.env.example`)
- Sau khi có địa chỉ `*.workers.dev`, thêm vào Supabase → Authentication → URL Configuration (Site URL / Redirect URLs).
- Không dùng file `_redirects` cho kiểu này: quy tắc `/* /index.html 200` bị Cloudflare từ chối vì lặp vô hạn. Việc trả về `index.html` cho đường dẫn con đã do `not_found_handling` trong `wrangler.jsonc` đảm nhiệm.
