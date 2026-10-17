-- 034: Đưa CSDL Supabase thật và repo về cùng một trạng thái.
-- Bối cảnh: 14–15/10/2026 một số migration chạy qua Supabase MCP theo bản cũ hơn repo, kèm bản sửa
-- "fix_teacher_default_permissions" không có trong repo. Job schema-diff (17/10) tìm ra đúng các chỗ lệch dưới đây;
-- 181 hàm và mọi bảng khác khớp repo. Dữ kiện tra trên CSDL thật (live_facts.sql, chỉ đọc):
-- role_permissions.org_id tồn tại nhưng cả 85 dòng đều null, không có (role_id, module) trùng.
-- Migration chạy được trên cả CSDL thật (sửa lệch) lẫn CSDL dựng từ repo (không đổi gì ngoài mục 4).

-- 1. role_permissions: bỏ cột org_id thừa (quyền riêng theo trường nằm ở org_role_permissions), trả lại khoá chính.
drop policy if exists rp_read on role_permissions;                -- bản trên CSDL thật tham chiếu org_id
create policy rp_read on role_permissions for select to authenticated using (true);
drop index if exists role_permissions_uniq;                       -- unique (role_id, module, coalesce(org_id, …))
alter table role_permissions drop column if exists org_id;        -- kéo theo khoá ngoại role_permissions_org_id_fkey
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.role_permissions'::regclass and contype = 'p') then
    alter table role_permissions add constraint role_permissions_pkey primary key (role_id, module);
  end if;
end $$;

-- 2. Quyền của chức năng không tồn tại ('borrow', 'edu_plans'; chức năng thật là equipment/edu_plan).
delete from role_permissions where module in ('borrow', 'edu_plans');
delete from org_role_permissions where module in ('borrow', 'edu_plans');

-- 3. Policy thừa.
-- floors_del/ins/sel/upd: trùng điều kiện với floors_write/floors_read, không thêm quyền — chỉ dọn.
drop policy if exists floors_del on floors;
drop policy if exists floors_ins on floors;
drop policy if exists floors_sel on floors;
drop policy if exists floors_upd on floors;
-- roles_admin_write: cho quản trị sửa/xoá vai trò của MỌI đơn vị trong cây của mình (kể cả is_system).
-- Thiết kế đúng (roles_admin_insert/update/delete): chỉ vai trò tuỳ chỉnh (not is_system) của chính đơn vị mình.
drop policy if exists roles_admin_write on roles;

-- 4. Quyền mặc định của Giáo viên: lấy theo CSDL thật (bản sửa đang dùng). Giáo viên xem được danh sách
--    giáo viên, bài tập, toà nhà, thiết bị, tiết học (cần cho đặt phòng, mượn thiết bị, kế hoạch giáo dục)
--    và tạo được phiếu đăng ký dạy STEM. Không cấp sửa/xoá. Trường đã chỉnh riêng (org_role_permissions) không bị ảnh hưởng.
update role_permissions rp set can_view = true, can_detail = true,
       can_create = (rp.module = 'stem_registrations') or rp.can_create
  from roles r
 where rp.role_id = r.id and r.key = 'teacher' and r.org_id is null
   and rp.module in ('teachers', 'assignments', 'buildings', 'equipment', 'periods', 'stem_registrations');
