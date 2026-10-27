-- 104. Đơn vị lập kế hoạch (Quản trị hệ thống, Sở, Phòng) thêm thẳng giáo viên vào kế hoạch tập huấn, không cần chờ trường chọn.
--  • training_plan_add_teachers(): thêm giáo viên của bất kỳ trường nào trong phạm vi. Trường chưa được gán thì tự gán.
--    p_approve = true: danh sách của trường đó thành "Đã duyệt" luôn. false: thành "Chờ duyệt", duyệt sau ở bước Gán trường.
--  • training_plan_add_me(): người lập kế hoạch tự ghi danh mình. Tài khoản chưa có hồ sơ giáo viên thì tạo hồ sơ ở đơn vị đang làm việc,
--    để điểm danh QR, học khoá tập huấn và nhận chứng chỉ như giáo viên.
--  • training_plan_teacher_pool(): giáo viên của một trường để chọn, kèm cờ đã có tên trong kế hoạch.
--  • Ghi danh có nguồn mới 'admin' (đơn vị lập kế hoạch thêm).
-- Cần chạy sau 103.

alter table training_enrollments drop constraint if exists training_enrollments_v6_check;
alter table training_enrollments add constraint training_enrollments_v6_check check (
  source in ('school', 'self', 'admin') and (units is null or cardinality(units) between 1 and 500) and cardinality(exempt_units) <= 500);

-- Trường để chọn giáo viên: Quản trị hệ thống thấy mọi trường, đơn vị khác thấy trường trong phạm vi
create or replace function public.training_plan_schools(p_plan uuid)
returns table (org_id uuid, name text, assigned boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, exists (select 1 from training_plan_orgs po where po.plan_id = p_plan and po.org_id = o.id)
    from organizations o
   where o.type = 'school' and public.training_plan_can_manage(p_plan)
     and (public.is_platform_admin() or o.id in (select public.my_org_tree()))
   order by 3 desc, o.name
$$;

create or replace function public.training_plan_teacher_pool(p_plan uuid, p_org uuid)
returns table (id uuid, full_name text, subject text, enrolled boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.full_name, t.subject, exists (select 1 from training_enrollments e where e.plan_id = p_plan and e.teacher_id = t.id)
    from teachers t
   where t.org_id = p_org and coalesce(t.status, 'active') = 'active' and public.training_plan_can_manage(p_plan)
     and (public.is_platform_admin() or p_org in (select public.my_org_tree()))
   order by t.full_name
$$;

create or replace function public.training_plan_add_teachers(p_plan uuid, p_teachers uuid[], p_approve boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare p training_plans; n int; v_ids uuid[];
begin
  select * into p from training_plans where id = p_plan;
  if p.id is null or not public.training_plan_can_manage(p_plan) then
    raise exception 'Bạn không thêm được giáo viên vào kế hoạch này' using errcode = '42501';
  end if;
  if p.pub_status <> 'published' then raise exception 'Phát hành kế hoạch trước khi thêm giáo viên' using errcode = '22023'; end if;
  v_ids := array(select distinct x from unnest(coalesce(p_teachers, '{}')) x where x is not null);
  if cardinality(v_ids) = 0 then raise exception 'Chọn ít nhất một giáo viên' using errcode = '22023'; end if;
  if cardinality(v_ids) > 2000 then raise exception 'Mỗi lần thêm tối đa 2000 giáo viên' using errcode = '22023'; end if;
  if (select count(*) from teachers where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'Không tìm thấy giáo viên' using errcode = '22023';
  end if;
  if not public.is_platform_admin() and exists (select 1 from teachers t where t.id = any(v_ids)
       and not (t.org_id in (select public.my_org_tree()) or t.profile_id = auth.uid())) then
    raise exception 'Giáo viên không thuộc phạm vi quản lý' using errcode = '42501';
  end if;
  -- Trường chưa được gán thì gán (không đặt chỉ tiêu)
  insert into training_plan_orgs (plan_id, org_id)
  select distinct p_plan, t.org_id from teachers t join organizations o on o.id = t.org_id and o.type = 'school'
   where t.id = any(v_ids)
  on conflict (plan_id, org_id) do nothing;
  perform set_config('app.training_unassign', 'on', true);
  insert into training_enrollments (org_id, plan_id, teacher_id, source)
  select t.org_id, p_plan, t.id, 'admin' from teachers t
   where t.id = any(v_ids) and not exists (select 1 from training_enrollments e where e.plan_id = p_plan and e.teacher_id = t.id);
  get diagnostics n = row_count;
  perform set_config('app.training_unassign', 'off', true);
  -- Trạng thái danh sách của các trường vừa thêm
  update training_plan_orgs o
     set status = case when p_approve then 'approved' else 'submitted' end,
         submitted_at = coalesce(o.submitted_at, now()),
         decided_at = case when p_approve then now() end,
         decided_by = case when p_approve then auth.uid() end,
         note = null
   where o.plan_id = p_plan and o.org_id in (select t.org_id from teachers t where t.id = any(v_ids))
     and not (p_approve and o.status = 'approved');
  return n;
end $$;

create or replace function public.training_plan_add_me(p_plan uuid, p_approve boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_t uuid := public.my_teacher_id(); pr profiles;
begin
  if not public.training_plan_can_manage(p_plan) then
    raise exception 'Bạn không ghi danh được vào kế hoạch này: dùng mục Đăng ký tập huấn' using errcode = '42501';
  end if;
  if v_t is null then
    select * into pr from profiles where id = auth.uid();
    if pr.id is null or public.my_org_id() is null then raise exception 'Tài khoản chưa có đơn vị làm việc' using errcode = '22023'; end if;
    insert into teachers (org_id, profile_id, full_name, email) values (public.my_org_id(), pr.id, pr.full_name, pr.email)
    returning id into v_t;
  end if;
  perform public.training_plan_add_teachers(p_plan, array[v_t], p_approve);
  return v_t;
end $$;

revoke all on function public.training_plan_schools(uuid) from public, anon;
revoke all on function public.training_plan_teacher_pool(uuid, uuid) from public, anon;
revoke all on function public.training_plan_add_teachers(uuid, uuid[], boolean) from public, anon;
revoke all on function public.training_plan_add_me(uuid, boolean) from public, anon;
grant execute on function public.training_plan_schools(uuid) to authenticated;
grant execute on function public.training_plan_teacher_pool(uuid, uuid) to authenticated;
grant execute on function public.training_plan_add_teachers(uuid, uuid[], boolean) to authenticated;
grant execute on function public.training_plan_add_me(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
