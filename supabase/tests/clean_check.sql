-- Kiểm tra CSDL dựng KHÔNG bật cờ app.seed_demo (như production) không chứa dữ liệu mẫu.
-- Chỉ được phép có danh mục hệ thống ở các bảng dưới đây; bảng nào khác có dữ liệu → FAIL.
-- Thêm bảng danh mục mới thì bổ sung vào danh sách cho phép, kèm lý do.
do $$
declare
  allowed text[] := array[
    'approval_bypass',      -- loại hồ sơ đang tạm tắt duyệt (068)
    'ai_settings',          -- cấu hình trợ lý AI mặc định (052, một dòng, tắt)
    'audit_log',            -- nhật ký do chính migration ghi khi cập nhật danh mục gói
    'competencies',         -- khung năng lực HS/GV (042)
    'integrations',         -- danh mục kết nối tích hợp (K12Online, VNeID, email, Zalo, Excel)
    'lesson_templates',     -- mẫu giáo án hệ thống của KDI: 5512, STEM 5E, dự án STEM (060)
    'organizations',        -- chỉ đơn vị cung cấp KDI Education (kiểm tra riêng bên dưới)
    'role_permissions',     -- ma trận quyền mặc định
    'rubrics',              -- mẫu tiêu chí đánh giá hệ thống (041)
    'roles',                -- vai trò hệ thống
    'security_settings',    -- cấu hình bảo mật mặc định
    'service_modules',      -- danh mục phân hệ PH1–PH5
    'service_plans',        -- danh mục gói dịch vụ
    'service_plans_legacy', -- bản ghi gói cũ trước 033
    'stem_tracks',          -- danh mục chương trình STEM CT1–CT5 (062, 5 dòng cố định)
    'subjects',             -- danh mục môn học hệ thống của KDI (064)
    'edu_levels',           -- danh mục cấp học & khối (065)
    'dist_tiers',           -- danh mục mức độ của bản phân phối (078)
    'dist_cls_levels',      -- cấp phân loại bản phân phối: Cấp học › Khối lớp › Mức độ (082)
    'dist_nodes'            -- cây phân loại dựng từ danh mục cấp học, khối, mức độ (082)
  ];
  r record; n bigint; bad text := '';
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    if n > 0 and not r.tablename = any(allowed) then bad := bad || format(' %s(%s)', r.tablename, n); end if;
  end loop;
  if exists (select 1 from organizations where type <> 'provider') then
    bad := bad || ' organizations(có đơn vị không phải provider)';
  end if;
  if bad <> '' then raise exception 'CLEAN FAIL: có dữ liệu mẫu trong CSDL production:%', bad; end if;
  raise notice 'CLEAN PASS';
end $$;
