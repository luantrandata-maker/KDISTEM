# Hệ thống Quản trị STEM

Giai đoạn 1–2: nền tảng + vận hành trường. React + TypeScript + Vite, Supabase.

## Chạy trên máy
1. Sao chép `.env.example` thành `.env` (đã điền sẵn project Supabase demo).
2. `npm install && npm run dev`
3. Đăng ký tài khoản đầu tiên: tài khoản này tự trở thành quản trị Trường THCS Phố Hiến (chỉ cho demo).

## Cơ sở dữ liệu
Chạy lần lượt các file trong `supabase/migrations/` theo số thứ tự (001 schema, 002 dữ liệu mẫu, 003 trigger demo, 004 thời khóa biểu và đăng ký STEM, 005 học sinh và phân quyền, 006 gói STEM/tập huấn/PPCT, 007 ticket bảo hành mẫu). Các file dữ liệu mẫu chỉ chạy khi chưa có dữ liệu.

## Triển khai Cloudflare (Workers Builds, kết nối GitHub)
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (đọc cấu hình trong `wrangler.jsonc`; tên Worker phải trùng tên project trên Cloudflare)
- Biến môi trường (đặt trước khi build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (giá trị như `.env.example`)
- Sau khi có địa chỉ `*.workers.dev`, thêm vào Supabase → Authentication → URL Configuration (Site URL / Redirect URLs).
- Không dùng file `_redirects` cho kiểu này: quy tắc `/* /index.html 200` bị Cloudflare từ chối vì lặp vô hạn. Việc trả về `index.html` cho đường dẫn con đã do `not_found_handling` trong `wrangler.jsonc` đảm nhiệm.
