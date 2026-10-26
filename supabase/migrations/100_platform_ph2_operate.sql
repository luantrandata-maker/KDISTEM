-- 100. Quản trị hệ thống thao tác được mọi chức năng của Phân hệ 2 (Chương trình & học liệu), phương án B (26/10):
--  ở từng mục menu Quản trị, chọn đơn vị (trường / Sở / Phòng) rồi thao tác như người quản lý của đơn vị đó.
--  • curriculum_can_write, library_can_write: Quản trị hệ thống ghi được dữ liệu của mọi đơn vị (trước đây chỉ của KDI).
--    Kéo theo: chương trình giáo dục, môn học, yêu cầu cần đạt, gán chương trình, bản phân phối, định mức vật tư, mẫu giáo án.
--  • PPCT (curriculum_books / lessons), học liệu (library_items / targets), giáo án và kho hoạt động: policy cho Quản trị ở mọi đơn vị.
--  • Các hàm "sao chép / tạo về đơn vị" trước đây luôn ghi vào đơn vị của người dùng: thêm tham số p_org (đơn vị đang thao tác).
--    Người khác truyền p_org khác đơn vị của mình → báo lỗi quyền; chỉ Quản trị hệ thống được thao tác thay.
--  • Phát hành / thu hồi / khôi phục học liệu, ban hành chương trình của trường: Quản trị làm thay được.
--  Dữ liệu ngoài Phân hệ 2 (học sinh, lớp…) vẫn giữ như cũ: Quản trị chỉ xem.
-- Cần chạy sau 099.

create or replace function public.curriculum_can_write(p_org uuid, p_action text default 'edit') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((p_org = public.my_org_id() and public.is_staff() and (public.has_perm('curriculum', p_action) or public.is_authority()))
      or (p_org is not null and public.is_platform_admin()), false)
$$;

create or replace function public.library_can_write(p_org uuid, p_action text default 'edit') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((p_org = public.my_org_id() and public.is_staff()
                   and (public.is_admin() or public.is_authority() or public.has_role(array['provider']) or public.has_perm('library', p_action)))
      or (p_org is not null and public.is_platform_admin()), false)
$$;

-- Đơn vị đang thao tác: mặc định đơn vị của người dùng; đơn vị khác chỉ dành cho Quản trị hệ thống
create or replace function public.acting_org(p_org uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org is null or p_org = public.my_org_id() then return public.my_org_id(); end if;
  if not public.is_platform_admin() then raise exception 'Bạn không thao tác được cho đơn vị này' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = p_org) then raise exception 'Không tìm thấy đơn vị' using errcode = '22023'; end if;
  return p_org;
end $$;
revoke all on function public.acting_org(uuid) from public, anon;
grant execute on function public.acting_org(uuid) to authenticated;

-- Policy cho Quản trị ở mọi đơn vị (thay policy cũ chỉ cho dữ liệu của KDI)
drop policy if exists curriculum_books_platform on curriculum_books;
create policy curriculum_books_platform on curriculum_books for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
drop policy if exists curriculum_lessons_platform on curriculum_lessons;
create policy curriculum_lessons_platform on curriculum_lessons for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
drop policy if exists lesson_plans_platform_write on lesson_plans;
create policy lesson_plans_platform_write on lesson_plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists activities_platform_write on activities;
create policy activities_platform_write on activities for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
do $$ declare t text; begin
  foreach t in array array['library_items', 'library_targets', 'lesson_plan_reviews'] loop
    execute format('drop policy if exists %I on %I', t || '_platform_write', t);
    execute format('create policy %I on %I for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()))', t || '_platform_write', t);
  end loop;
end $$;

-- Hàm sao chép / tạo về đơn vị: thêm p_org (đơn vị đang thao tác). Bỏ hàm cũ để không có hai bản cùng tên.
do $$
declare f text; o oid; d text; args text; n int;
begin
  foreach f in array array['curriculum_copy', 'curriculum_from_program', 'curriculum_rollover', 'edu_program_copy', 'material_norm_copy'] loop
    select p.oid into o from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace order by p.pronargs limit 1;
    if position('p_org' in pg_get_function_arguments(o)) > 0 then continue; end if;
    d := pg_get_functiondef(o);
    args := pg_get_function_arguments(o);
    n := length(d);
    d := replace(d, 'public.' || f || '(' || args || ')', 'public.' || f || '(' || args || ', p_org uuid DEFAULT NULL::uuid)');
    if length(d) = n then raise exception '100: không sửa được chữ ký %', f; end if;
    d := replace(d, 'public.my_org_id()', 'public.acting_org(p_org)');
    if f = 'edu_program_copy' then
      d := replace(d, '(p.org_id = public.platform_org_id() or', '(public.is_platform_admin() or p.org_id = public.platform_org_id() or');
    end if;
    execute format('drop function public.%I(%s)', f, pg_get_function_identity_arguments(o));
    execute d;
    execute format('revoke all on function public.%I from public, anon', f);
    execute format('grant execute on function public.%I to authenticated', f);
  end loop;
end $$;

-- Phát hành / thu hồi / khôi phục học liệu; ban hành thẳng chương trình của trường
do $$
declare d text;
begin
  d := pg_get_functiondef('public.library_publish(uuid,text)'::regprocedure);
  if position('is_platform_admin' in d) = 0 then
    d := replace(d, 'i.owner_org_id is distinct from public.my_org_id() or', '(i.owner_org_id is distinct from public.my_org_id() and not public.is_platform_admin()) or');
    if position('is_platform_admin' in d) = 0 then raise exception '100: không sửa được library_publish'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.library_unpublish(uuid)'::regprocedure);
  if position('is_platform_admin' in d) = 0 then
    d := replace(d, 'owner_org_id = public.my_org_id() and', '(owner_org_id = public.my_org_id() or public.is_platform_admin()) and');
    if position('is_platform_admin' in d) = 0 then raise exception '100: không sửa được library_unpublish'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.library_restore_version(uuid,integer)'::regprocedure);
  if position('is_platform_admin' in d) = 0 then
    d := replace(d, 'owner_org_id = public.my_org_id())', '(owner_org_id = public.my_org_id() or public.is_platform_admin()))');
    if position('is_platform_admin' in d) = 0 then raise exception '100: không sửa được library_restore_version'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.edu_program_set_status(uuid,text,text)'::regprocedure);
  if position('is_platform_admin' in d) = 0 then
    d := replace(d, '= ''school'' and not public.is_admin() then', '= ''school'' and not (public.is_admin() or public.is_platform_admin()) then');
    if position('is_platform_admin' in d) = 0 then raise exception '100: không sửa được edu_program_set_status'; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
