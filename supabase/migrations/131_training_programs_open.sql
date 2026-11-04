-- 131. Mở Chương trình đào tạo cho Sở, Phòng, Trường (04/11).
--  • Đơn vị có quyền đào tạo (training_can_write: cán bộ quản lý hoặc quyền "Đào tạo – sửa") tự soạn, duyệt, phát hành,
--    làm phiên bản mới, đặt phạm vi áp dụng và gắn chương trình giáo dục cho chương trình của đơn vị mình. KDI vẫn làm được mọi chương trình.
--  • Phạm vi: chương trình KDI "Tất cả" vẫn dùng chung toàn hệ thống. Chương trình của Sở / Phòng / Trường "Tất cả" nghĩa là
--    đơn vị soạn và các đơn vị trực thuộc; chọn đơn vị áp dụng thì chỉ chọn được đơn vị trực thuộc.

-- Quyền soạn: dùng cho giao diện
create or replace function public.training_program_can_edit(p_program uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.training_can_write(g.org_id) from training_programs g where g.id = p_program), false)
$$;
create or replace function public.training_program_can_create() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_org_id() is not null and public.training_can_write(public.my_org_id())
$$;
revoke all on function public.training_program_can_edit(uuid), public.training_program_can_create() from public, anon;
grant execute on function public.training_program_can_edit(uuid), public.training_program_can_create() to authenticated;

drop policy if exists training_programs_write on training_programs;
create policy training_programs_write on training_programs for all to authenticated
  using (public.training_can_write(org_id)) with check (public.training_can_write(org_id));
drop policy if exists training_units_write on training_program_units;
create policy training_units_write on training_program_units for all to authenticated
  using (exists (select 1 from training_programs g where g.id = program_id and public.training_can_write(g.org_id)))
  with check (exists (select 1 from training_programs g where g.id = program_id and public.training_can_write(g.org_id)));
drop policy if exists training_program_targets_write on training_program_targets;
create policy training_program_targets_write on training_program_targets for all to authenticated
  using (exists (select 1 from training_programs g where g.id = program_id and public.training_can_write(g.org_id)))
  with check (exists (select 1 from training_programs g where g.id = program_id and public.training_can_write(g.org_id)));
drop policy if exists training_program_edu_write on training_program_edu;
create policy training_program_edu_write on training_program_edu for all to authenticated
  using (exists (select 1 from training_programs g where g.family_id = training_family and public.training_can_write(g.org_id)))
  with check (exists (select 1 from training_programs g where g.family_id = training_family and public.training_can_write(g.org_id)));

CREATE OR REPLACE FUNCTION public.training_program_set_status(p_program uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s training_programs; ok boolean;
begin
  select * into s from training_programs where id = p_program for update;
  if not public.is_platform_admin() and not public.training_can_write(s.org_id) then raise exception 'Chỉ đơn vị soạn chương trình (hoặc KDI) mới duyệt / phát hành được chương trình đào tạo này' using errcode = '42501'; end if;
  if s.id is null then raise exception 'Không tìm thấy chương trình đào tạo' using errcode = '22023'; end if;
  ok := case p_status
    when 'pending'   then s.status in ('draft', 'rejected')
    when 'approved'  then s.status = 'pending'
    when 'rejected'  then s.status = 'pending'
    when 'published' then s.status in ('draft', 'approved', 'archived')
    when 'draft'     then s.status in ('approved', 'rejected')
    when 'archived'  then s.status in ('published', 'superseded', 'approved', 'rejected', 'draft')
    else false end;
  if not ok then raise exception 'Không chuyển được từ trạng thái hiện tại sang "%"', p_status using errcode = '22023'; end if;
  if p_status = 'pending' and not exists (select 1 from training_program_units where program_id = s.id and kind = 'content') then
    raise exception 'Chương trình chưa có nội dung đào tạo nào' using errcode = '22023';
  end if;
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'Nhập lý do trả lại' using errcode = '22023'; end if;
  perform set_config('app.tp_status_note', coalesce(p_note, ''), true);
  update training_programs set status = p_status where id = s.id;
  perform set_config('app.tp_status_note', '', true);
  return p_status;
end $function$;

CREATE OR REPLACE FUNCTION public.training_program_new_version(p_program uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s training_programs; v int;
begin
  select * into s from training_programs where id = p_program;
  if not public.is_platform_admin() and not public.training_can_write(s.org_id) then raise exception 'Chỉ đơn vị soạn chương trình (hoặc KDI) mới soạn được chương trình đào tạo này' using errcode = '42501'; end if;
  if s.id is null then raise exception 'Không tìm thấy chương trình đào tạo' using errcode = '22023'; end if;
  if exists (select 1 from training_programs where family_id = s.family_id and status in ('draft', 'pending', 'approved', 'rejected')) then
    raise exception 'Chương trình đã có một phiên bản đang soạn / chờ duyệt' using errcode = '22023';
  end if;
  select max(version_no) + 1 into v from training_programs where family_id = s.family_id;
  return public.training_program_clone(p_program, s.family_id, v, s.code);
end $function$;

CREATE OR REPLACE FUNCTION public.training_program_copy(p_program uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s training_programs;
begin
  select * into s from training_programs where id = p_program;
  if not public.is_platform_admin() and not public.training_can_write(s.org_id) then raise exception 'Chỉ đơn vị soạn chương trình (hoặc KDI) mới soạn được chương trình đào tạo này' using errcode = '42501'; end if;
  if s.id is null then raise exception 'Không tìm thấy chương trình đào tạo' using errcode = '22023'; end if;
  return public.training_program_clone(p_program, s.family_id, (select max(version_no) + 1 from training_programs where family_id = s.family_id), s.code);
end $function$;

CREATE OR REPLACE FUNCTION public.training_program_set_edu(p_program uuid, p_edu uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_fam uuid; v_org uuid; n int;
begin
  select family_id, org_id into v_fam, v_org from training_programs where id = p_program;
  if not public.is_platform_admin() and not public.training_can_write(v_org) then raise exception 'Chỉ đơn vị soạn chương trình (hoặc KDI) mới gắn được chương trình giáo dục' using errcode = '42501'; end if;
  if v_fam is null then raise exception 'Không tìm thấy chương trình đào tạo' using errcode = '22023'; end if;
  if cardinality(coalesce(p_edu, '{}')) > 200 then raise exception 'Quá nhiều chương trình giáo dục' using errcode = '22023'; end if;
  delete from training_program_edu where training_family = v_fam;
  insert into training_program_edu (training_family, edu_family)
    select distinct v_fam, coalesce(e.family_id, e.id) from edu_programs e where e.id = any(coalesce(p_edu, '{}'))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.training_program_targets_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from training_programs g where g.id = new.program_id and g.org_id = new.org_id) then
    raise exception 'Đơn vị soạn chương trình luôn dùng được chương trình, không cần chọn' using errcode = '22023';
  end if;
  -- Chương trình của Sở / Phòng / Trường chỉ áp dụng cho đơn vị trực thuộc của đơn vị soạn
  if exists (select 1 from training_programs g where g.id = new.program_id and g.org_id <> public.platform_org_id()
               and not public.org_in_tree(new.org_id, g.org_id)) then
    raise exception 'Chương trình của đơn vị chỉ áp dụng được cho đơn vị trực thuộc' using errcode = '22023';
  end if;
  if (select count(*) from training_program_targets where program_id = new.program_id) >= 500 then
    raise exception 'Tối đa 500 đơn vị áp dụng cho một chương trình' using errcode = '22023';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.training_program_applies(p_program uuid, p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select (g.scope = 'all' and (g.org_id = public.platform_org_id() or public.org_in_tree(p_org, g.org_id))) or exists (select 1 from training_program_targets t
                                                     where t.program_id = g.id and public.org_in_tree(p_org, t.org_id))
                     from training_programs g where g.id = p_program), false)
$function$;

CREATE OR REPLACE FUNCTION public.training_program_visible(p_program uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from training_programs g where g.id = p_program and g.scope = 'all'
                 and (g.org_id = public.platform_org_id() or g.org_id in (select public.my_scope_orgs())))
      or exists (select 1 from training_program_targets t where t.program_id = p_program
                  and (t.org_id in (select public.my_scope_orgs()) or t.org_id in (select public.my_org_tree())))
      or exists (select 1 from training_plan_items i join training_plans pl on pl.id = i.plan_id
                  where i.program_id = p_program
                    and (pl.org_id in (select public.my_org_tree())
                         or exists (select 1 from training_plan_orgs o where o.plan_id = pl.id and o.org_id in (select public.my_org_tree()))))
$function$;

-- Bản nháp chỉ đơn vị soạn (người có quyền đào tạo) xem; bản đã phát hành theo phạm vi áp dụng như cũ
drop policy if exists training_programs_read on training_programs;
create policy training_programs_read on training_programs for select to authenticated
  using (public.training_can_write(org_id) or public.is_platform_admin()
         or (org_id = public.my_org_id() and public.has_perm('training', 'view'))
         or (status in ('published', 'superseded') and public.training_program_visible(id)));
