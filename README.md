# Hệ thống Quản trị STEM

Giai đoạn 1–2: nền tảng + vận hành trường. React + TypeScript + Vite, Supabase.

## Chạy trên máy
1. Sao chép `.env.example` thành `.env` (đã điền sẵn project Supabase demo).
2. `npm install && npm run dev`
3. Đăng ký tài khoản đầu tiên: tài khoản này tự trở thành quản trị Trường THCS Phố Hiến (chỉ cho demo).

## Cơ sở dữ liệu
Chạy lần lượt các file trong `supabase/migrations/` (001 schema, 002 dữ liệu mẫu, 003 trigger demo).

## Triển khai Cloudflare Pages
1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git, chọn repo này.
2. Build command: `npm run build` · Build output directory: `dist`
3. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (giá trị như trong `.env.example`).
4. File `public/_redirects` đã có sẵn để các đường dẫn con luôn trả về `index.html`.
5. Trong Supabase → Authentication → URL Configuration, thêm địa chỉ `*.pages.dev` (hoặc tên miền riêng) vào Site URL / Redirect URLs.
