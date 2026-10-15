-- 012. Siết bảo mật: quyền ghi theo ma trận phân quyền, quyền mặc định theo từng trường, tắt admin demo.
--
-- Trước đây mọi bảng nghiệp vụ dùng policy `for all using (can_access_org(org_id))`: bất kỳ tài khoản nào
-- thuộc trường (kể cả học sinh) đều thêm/sửa/xoá được qua API. Ma trận Xem/Tạo/Sửa/Xoá chỉ ẩn menu ở UI.
--
-- Sau migration này:
--   * Đọc  : nhân sự trong phạm vi tổ chức (Sở thấy các trường con). Học sinh chỉ đọc danh mục cơ bản
--            và dữ liệu của lớp mình.
--   * Ghi  : theo ma trận (has_perm). Hiệu trưởng / QTV CNTT luôn có toàn quyền trong trường của mình.
--   * Ngoại lệ cho giáo viên: tự gửi đăng ký dạy STEM, phiếu mượn, báo hỏng thiết bị của chính mình.
--   * Ma trận quyền của vai trò hệ thống được ghi đè theo từng trường (org_role_permissions),
--     không còn sửa chung cho mọi trường.
--   * Tài khoản đăng ký mới không còn tự thành quản trị.

-- ===== 1. Hàm tiện ích =====
create or replace function public.has_role(keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key = any(keys))
$$;

-- Nhân sự = có ít nhất một vai trò không phải học sinh
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key <> 'student')
$$;

create or replace function public.is_student() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(array['student']) and not public.is_staff()
$$;

create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from teachers where profile_id = auth.uid() order by id limit 1
$$;

create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from students where profile_id = auth.uid() order by id limit 1
$$;

create or replace function public.my_class_id() returns uuid
language sql stable security definer set search_path = public as $$
  select class_id from students where profile_id = auth.uid() order by id limit 1
$$;

-- ===== 2. Quyền theo từng trường =====
-- role_permissions = mặc định của hệ thống (chỉ service role sửa).
-- org_role_permissions = trường tự điều chỉnh cho vai trò; nếu có dòng ở đây thì dùng thay cho mặc định.
create table if not exists org_role_permissions (
  org_id uuid not null references organizations(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  module text not null,
  can_view boolean not null default false, can_detail boolean not null default false,
  can_create boolean not null default false, can_edit boolean not null default false,
  can_delete boolean not null default false,
  primary key (org_id, role_id, module)
);
alter table org_role_permissions enable row level security;
create policy orp_read on org_role_permissions for select to authenticated using (public.can_access_org(org_id));
create policy orp_write on org_role_permissions for all to authenticated
  using (public.is_admin() and public.can_access_org(org_id))
  with check (public.is_admin() and public.can_access_org(org_id));

drop policy if exists rp_write on role_permissions;   -- mặc định hệ thống không sửa từ client nữa

-- Quyền hiệu lực của người dùng hiện tại (gộp mặc định + ghi đè của trường)
create or replace function public.my_permissions()
returns table (module text, can_view boolean, can_detail boolean, can_create boolean, can_edit boolean, can_delete boolean)
language sql stable security definer set search_path = public as $$
  with mine as (
    select r.id as role_id from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = auth.uid()
  ), mods as (
    select d.role_id, d.module from role_permissions d join mine using (role_id)
    union
    select o.role_id, o.module from org_role_permissions o join mine using (role_id) where o.org_id = public.my_org_id()
  )
  select m.module,
    bool_or(coalesce(o.can_view,   d.can_view,   false)),
    bool_or(coalesce(o.can_detail, d.can_detail, false)),
    bool_or(coalesce(o.can_create, d.can_create, false)),
    bool_or(coalesce(o.can_edit,   d.can_edit,   false)),
    bool_or(coalesce(o.can_delete, d.can_delete, false))
  from mods m
  left join org_role_permissions o on o.role_id = m.role_id and o.module = m.module and o.org_id = public.my_org_id()
  left join role_permissions d on d.role_id = m.role_id and d.module = m.module
  group by m.module
$$;

-- action: view | detail | create | edit | delete
create or replace function public.has_perm(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.my_permissions() p
    where p.module = p_module and case p_action
      when 'view' then p.can_view when 'detail' then p.can_detail when 'create' then p.can_create
      when 'edit' then p.can_edit when 'delete' then p.can_delete else false end)
$$;

-- ===== 3. Thay policy "for all" bằng policy theo thao tác =====
do $$
declare
  m record; p record;
begin
  for m in select * from (values
    ('academic_years','periods'), ('period_configs','periods'), ('buildings','buildings'),
    ('teachers','teachers'), ('classes','classes'), ('class_programs','classes'), ('students','students'),
    ('teaching_assignments','assignments'), ('stem_rooms','stem_rooms'), ('borrow_requests','stem_rooms'),
    ('equipment_types','equipment'), ('equipment_units','equipment'), ('equipment_events','equipment'),
    ('warranty_tickets','warranty'), ('timetable_entries','timetable'), ('stem_registrations','stem_registrations'),
    ('education_plans','edu_plan'), ('stem_teacher_programs','stem_assign'), ('curriculum_books','curriculum'),
    ('stem_packages','packages'), ('package_topics','packages'), ('package_topic_sessions','packages'),
    ('training_plans','training'), ('training_sessions','training'), ('training_lessons','training'),
    ('training_enrollments','training'), ('training_attendance','training'), ('certificates','training')
  ) as v(tbl, module)
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = m.tbl loop
      execute format('drop policy %I on %I', p.policyname, m.tbl);
    end loop;
    execute format('create policy %I on %I for select to authenticated using (public.can_access_org(org_id) and public.is_staff())', m.tbl||'_read', m.tbl);
    execute format('create policy %I on %I for insert to authenticated with check (public.can_access_org(org_id) and public.has_perm(%L,''create''))', m.tbl||'_insert', m.tbl, m.module);
    execute format('create policy %I on %I for update to authenticated using (public.can_access_org(org_id) and public.has_perm(%L,''edit'')) with check (public.can_access_org(org_id) and public.has_perm(%L,''edit''))', m.tbl||'_update', m.tbl, m.module, m.module);
    execute format('create policy %I on %I for delete to authenticated using (public.can_access_org(org_id) and public.has_perm(%L,''delete''))', m.tbl||'_delete', m.tbl, m.module);
  end loop;
end $$;

-- Tầng: không có org_id, đi qua toà nhà
drop policy if exists floors_scope on floors;
create policy floors_read on floors for select to authenticated
  using (exists (select 1 from buildings b where b.id = building_id and public.can_access_org(b.org_id)));
create policy floors_write on floors for all to authenticated
  using (public.has_perm('buildings','edit') and exists (select 1 from buildings b where b.id = building_id and public.can_access_org(b.org_id)))
  with check (public.has_perm('buildings','edit') and exists (select 1 from buildings b where b.id = building_id and public.can_access_org(b.org_id)));

-- ===== 4. Ngoại lệ cho giáo viên (chỉ dữ liệu của chính mình) =====
create policy stem_reg_teacher_insert on stem_registrations for insert to authenticated
  with check (public.can_access_org(org_id) and teacher_id = public.my_teacher_id() and status = 'pending');
create policy stem_reg_teacher_delete on stem_registrations for delete to authenticated
  using (teacher_id = public.my_teacher_id() and status = 'pending');

create policy borrow_teacher_insert on borrow_requests for insert to authenticated
  with check (public.can_access_org(org_id) and teacher_id = public.my_teacher_id() and status = 'pending');
create policy borrow_teacher_delete on borrow_requests for delete to authenticated
  using (teacher_id = public.my_teacher_id() and status = 'pending');

create policy warranty_staff_report on warranty_tickets for insert to authenticated
  with check (public.can_access_org(org_id) and public.is_staff() and reported_by = auth.uid() and status in ('draft','new'));

-- Giáo viên tự điểm danh buổi tập huấn của mình
create policy training_att_self on training_attendance for insert to authenticated
  with check (public.can_access_org(org_id) and teacher_id = public.my_teacher_id());
create policy training_att_self_update on training_attendance for update to authenticated
  using (teacher_id = public.my_teacher_id()) with check (teacher_id = public.my_teacher_id());

-- ===== 5. Học sinh: chỉ đọc danh mục cơ bản và dữ liệu của lớp mình =====
do $$
declare t text;
begin
  foreach t in array array['academic_years','period_configs','buildings','classes','stem_rooms','teachers','package_topics','package_topic_sessions']
  loop
    execute format('create policy %I on %I for select to authenticated using (public.is_student() and org_id = public.my_org_id())', t||'_student_read', t);
  end loop;
end $$;
create policy floors_student_read on floors for select to authenticated
  using (public.is_student() and exists (select 1 from buildings b where b.id = building_id and b.org_id = public.my_org_id()));
create policy timetable_student_read on timetable_entries for select to authenticated
  using (public.is_student() and class_id = public.my_class_id());
create policy students_classmates_read on students for select to authenticated
  using (public.is_student() and class_id = public.my_class_id());

-- ===== 6. Hồ sơ, vai trò =====
-- Học sinh chỉ thấy hồ sơ của mình (trước đây thấy toàn trường)
drop policy if exists profile_self_or_org on profiles;
create policy profile_self_or_org on profiles for select to authenticated
  using (id = auth.uid() or (public.is_staff() and public.can_access_org(org_id)));

-- Quản trị trường không được cấp vai trò Sở / Nhà cung cấp
drop policy if exists ur_admin_write on user_roles;
create policy ur_admin_write on user_roles for all to authenticated
  using (public.is_admin() and exists (select 1 from profiles p where p.id = user_roles.user_id and (p.org_id is null or public.can_access_org(p.org_id))))
  with check (public.is_admin()
    and exists (select 1 from profiles p where p.id = user_roles.user_id and (p.org_id is null or public.can_access_org(p.org_id)))
    and exists (select 1 from roles r where r.id = user_roles.role_id and r.key not in ('department','provider')
                and (r.org_id is null or public.can_access_org(r.org_id))));

-- ===== 7. Tắt "người đăng ký đầu tiên thành Hiệu trưởng" =====
-- Tài khoản mới chỉ có hồ sơ, chờ quản trị gán trường và vai trò.
-- Cấp quản trị đầu tiên cho một trường mới: chạy bằng SQL Editor (xem README).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

-- ===== 8. Bổ sung module mới vào ma trận mặc định =====
-- Các trang đã có nhưng chưa nằm trong ma trận; mặc định chỉ quản trị (qua is_admin). Giáo viên được xem.
insert into role_permissions (role_id, module, can_view, can_detail, can_create, can_edit, can_delete)
select r.id, m.module,
  r.key in ('principal','it_admin','teacher'), r.key in ('principal','it_admin','teacher'),
  r.key in ('principal','it_admin'), r.key in ('principal','it_admin'), r.key in ('principal','it_admin')
from roles r
cross join (values ('edu_plan'),('stem_assign'),('curriculum'),('packages'),('training')) as m(module)
where r.org_id is null and r.key in ('principal','it_admin','teacher','office_staff')
on conflict do nothing;

grant execute on function public.has_role(text[]), public.is_staff(), public.is_student(), public.my_teacher_id(),
  public.my_student_id(), public.my_class_id(), public.my_permissions(), public.has_perm(text, text) to authenticated;
