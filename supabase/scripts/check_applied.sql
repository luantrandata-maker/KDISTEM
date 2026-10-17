-- Dán vào SQL Editor của Supabase để biết CSDL đã chạy tới migration nào (khi migration được chạy tay).
-- Kết quả dùng cho bước baseline: chỉ đánh dấu "đã chạy" những migration có dấu hiệu = true.
-- Migration chỉ chứa dữ liệu mẫu (028, 031) không có đối tượng riêng nên không liệt kê.
select v.version, v.marker, v.ok as da_chay
from (values
  ('024', 'bảng service_plans',                 to_regclass('public.service_plans') is not null),
  ('025', 'hàm platform_org_id()',              to_regprocedure('public.platform_org_id()') is not null),
  ('026', 'hàm training_check_in',              exists (select 1 from pg_proc where proname = 'training_check_in')),
  ('027', 'bảng teaching_sessions',             to_regclass('public.teaching_sessions') is not null),
  ('029', 'hàm period_slot',                    exists (select 1 from pg_proc where proname = 'period_slot')),
  ('030', 'bảng activities',                    to_regclass('public.activities') is not null),
  ('032', 'hàm platform_staff',                 exists (select 1 from pg_proc where proname = 'platform_staff')),
  ('033', 'bảng service_plans_legacy',          to_regclass('public.service_plans_legacy') is not null),
  ('033', 'phân hệ ph1 trong service_modules',  exists (select 1 from service_modules where key = 'ph1'))
) as v(version, marker, ok)
order by v.version;

-- Đã có lịch sử migration của Supabase CLI chưa (sau khi baseline sẽ có):
select to_regclass('supabase_migrations.schema_migrations') is not null as da_baseline;
