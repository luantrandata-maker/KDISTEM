-- Dán vào SQL Editor của Supabase để biết CSDL đã chạy tới migration nào (khi migration được chạy tay).
-- Một bảng kết quả duy nhất (SQL Editor chỉ hiện kết quả câu lệnh cuối):
--   · các dòng 024–033: dấu hiệu migration đã chạy (true/false)
--   · dòng "lịch sử": nội dung bảng supabase_migrations.schema_migrations (lịch sử mà Supabase CLI dựa vào)
-- Migration chỉ chứa dữ liệu mẫu (028, 031) không có đối tượng riêng nên không liệt kê.
select version, marker, ket_qua
from (values
  ('024', 'bảng service_plans',                 (to_regclass('public.service_plans') is not null)::text),
  ('025', 'hàm platform_org_id()',              (to_regprocedure('public.platform_org_id()') is not null)::text),
  ('026', 'hàm training_check_in',              (exists (select 1 from pg_proc where proname = 'training_check_in'))::text),
  ('027', 'bảng teaching_sessions',             (to_regclass('public.teaching_sessions') is not null)::text),
  ('029', 'hàm period_slot',                    (exists (select 1 from pg_proc where proname = 'period_slot'))::text),
  ('030', 'bảng activities',                    (to_regclass('public.activities') is not null)::text),
  ('032', 'hàm platform_staff',                 (exists (select 1 from pg_proc where proname = 'platform_staff'))::text),
  ('033', 'bảng service_plans_legacy',          (to_regclass('public.service_plans_legacy') is not null)::text),
  ('033', 'phân hệ ph1 trong service_modules',  (exists (select 1 from service_modules where key = 'ph1'))::text),
  ('lịch sử', 'các version trong supabase_migrations.schema_migrations',
    case when to_regclass('supabase_migrations.schema_migrations') is null then '(chưa có bảng)'
         else coalesce((xpath('/row/v/text()', query_to_xml(
                'select count(*) || '' bản ghi: '' || coalesce(string_agg(version, '' '' order by version), '''') as v from supabase_migrations.schema_migrations',
                false, true, '')))[1]::text, '(trống)') end)
) as v(version, marker, ket_qua);
