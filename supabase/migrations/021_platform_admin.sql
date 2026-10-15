-- 021. Cổng Quản trị nền tảng (KDI Education – chủ nền tảng)
--  • Đơn vị chủ nền tảng: organizations.is_platform (đơn vị cung cấp KDI). Vai trò hệ thống platform_admin chỉ gán ở đây.
--  • Quản trị nền tảng: ĐỌC mọi dữ liệu của mọi đơn vị; tạo/sửa/chuyển/tạm dừng đơn vị; gán vai trò và mời người ở mọi đơn vị.
--    Dữ liệu chuyên môn của trường (học sinh, điểm, bài nộp...) vẫn chỉ nhà trường sửa.
--  • Trạng thái đơn vị: active / suspended (tạm dừng → thành viên của đơn vị đó không vào làm việc được).
--  • Ràng buộc cấp: Bộ → Tỉnh → Sở → Phòng → Trường; không tạo vòng lặp.
--  • Nhật ký thay đổi audit_log cho đơn vị, vai trò, lời mời, vai trò tuỳ chỉnh.
--  • Hàm thống kê: platform_overview() (kèm kiểm tra cấu trúc), org_tree_stats().
-- Cần chạy sau 020. Sau khi chạy, cấp quyền cho tài khoản của bạn (một lần, trong SQL Editor):
--     select public.grant_platform_admin('email-cua-ban@kdi.edu.vn');

-- ===== 1. Đơn vị chủ nền tảng, trạng thái =====
alter table organizations add column if not exists is_platform boolean not null default false,
  add column if not exists status text not null default 'active';
alter table organizations drop constraint if exists organizations_status_check;
alter table organizations add constraint organizations_status_check check (status in ('active', 'suspended'));
create unique index if not exists organizations_one_platform on organizations (is_platform) where is_platform;

do $$
begin
  if not exists (select 1 from organizations where code = 'KDI') then
    insert into organizations (type, code, name) values ('provider', 'KDI', 'KDI Education');
  end if;
  update organizations set is_platform = true where code = 'KDI' and not exists (select 1 from organizations where is_platform);
end $$;

-- ===== 2. Vai trò Quản trị nền tảng =====
alter table roles drop constraint if exists roles_portal;
alter table roles add constraint roles_portal
  check (portal is null or portal in ('school_admin', 'teacher', 'student', 'department', 'platform'));
insert into roles (key, name, is_system, portal, description)
select 'platform_admin', 'Quản trị nền tảng', true, 'platform', 'KDI Education: quản lý đơn vị, người dùng, vai trò trên toàn hệ thống'
where not exists (select 1 from roles where key = 'platform_admin' and org_id is null);

create or replace function public.role_fits_org(p_role uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r, organizations o
     where r.id = p_role and o.id = p_org
       and case
             when r.org_id is not null then r.org_id = o.id
             when r.key = 'platform_admin' then o.is_platform
             when o.type = 'school' then r.key in ('principal','it_admin','teacher','office_staff','student')
             else r.key = o.type
           end)
$$;

-- ===== 3. Ngữ cảnh: đơn vị tạm dừng, quản trị nền tảng thấy toàn bộ cây =====
create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.org_id from profiles p
    join organizations o on o.id = p.org_id
   where p.id = auth.uid()
     and (o.status = 'active' or o.is_platform)
     and exists (select 1 from memberships m where m.user_id = p.id and m.org_id = p.org_id)
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                   join roles r on r.id = m.role_id
                   join organizations o on o.id = m.org_id
                  where m.user_id = auth.uid() and m.org_id = public.my_org_id()
                    and r.key = 'platform_admin' and r.org_id is null and o.is_platform)
$$;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.my_org_tree() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive pa as (select public.is_platform_admin() as yes),
  tree as (
    select id from organizations where id = public.my_org_id() and not (select yes from pa)
    union all
    select o.id from organizations o join tree t on o.parent_id = t.id
  )
  select id from tree
  union all
  select id from organizations where (select yes from pa)
$$;

-- ===== 4. Ràng buộc cấp đơn vị =====
create or replace function public.org_parent_ok(p_type text, p_parent_type text) returns boolean
language sql immutable as $$
  select case p_type
    when 'ministry'   then p_parent_type is null
    when 'provider'   then p_parent_type is null
    when 'province'   then p_parent_type is null or p_parent_type = 'ministry'
    when 'department' then p_parent_type is null or p_parent_type = 'province'
    when 'district'   then p_parent_type = 'department'
    when 'school'     then p_parent_type in ('department', 'district')
    else false end
$$;

create or replace function public.guard_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ptype text;
begin
  if new.parent_id is not null then
    select type into v_ptype from organizations where id = new.parent_id;
    if tg_op = 'UPDATE' and exists (
      with recursive d as (select id from organizations where id = new.id
                           union all select o.id from organizations o join d on o.parent_id = d.id)
      select 1 from d where id = new.parent_id) then
      raise exception 'Không thể đặt đơn vị dưới chính đơn vị con của nó' using errcode = '23514';
    end if;
  end if;
  if not public.org_parent_ok(new.type, v_ptype) then
    raise exception 'Đơn vị loại % không thể nằm dưới %', new.type, coalesce(v_ptype, 'gốc') using errcode = '23514';
  end if;
  if new.is_platform and new.status <> 'active' then
    raise exception 'Không tạm dừng đơn vị chủ nền tảng' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists organizations_guard on organizations;
create trigger organizations_guard before insert or update of parent_id, type, status, is_platform on organizations
  for each row execute function public.guard_org();

-- Không gỡ quản trị nền tảng cuối cùng
create or replace function public.guard_last_platform_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from roles where id = old.role_id and key = 'platform_admin' and org_id is null)
     and (select count(*) from memberships m join roles r on r.id = m.role_id
           where r.key = 'platform_admin' and r.org_id is null) <= 1
     and exists (select 1 from profiles where id = old.user_id) then
    raise exception 'Phải còn ít nhất một quản trị nền tảng' using errcode = '23514';
  end if;
  return old;
end $$;
drop trigger if exists memberships_last_platform_admin on memberships;
create trigger memberships_last_platform_admin before delete on memberships
  for each row execute function public.guard_last_platform_admin();

-- ===== 5. Quyền của quản trị nền tảng =====
-- Đọc trực tiếp (cần cho RETURNING khi vừa tạo đơn vị: cây my_org_tree() tính trước lúc chèn)
create policy org_platform_read on organizations for select to authenticated using ((select public.is_platform_admin()));
create policy org_platform_insert on organizations for insert to authenticated with check ((select public.is_platform_admin()));
create policy org_platform_update on organizations for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy org_platform_delete on organizations for delete to authenticated
  using ((select public.is_platform_admin()) and not is_platform);

create policy memberships_platform_insert on memberships for insert to authenticated
  with check ((select public.is_platform_admin()) and public.role_fits_org(role_id, org_id));
create policy memberships_platform_delete on memberships for delete to authenticated
  using ((select public.is_platform_admin()));

create policy profiles_platform_read on profiles for select to authenticated using ((select public.is_platform_admin()));
create policy profiles_platform_update on profiles for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy invitations_platform_read on invitations for select to authenticated using ((select public.is_platform_admin()));
create policy invitations_platform_insert on invitations for insert to authenticated
  with check ((select public.is_platform_admin()) and invited_by = auth.uid() and status = 'pending'
              and public.role_fits_org(role_id, org_id));
create policy invitations_platform_update on invitations for update to authenticated
  using ((select public.is_platform_admin()) and status = 'pending')
  with check ((select public.is_platform_admin()) and status in ('pending', 'cancelled'));
create policy invitations_platform_delete on invitations for delete to authenticated
  using ((select public.is_platform_admin()) and status <> 'accepted');

-- Cấp quyền lần đầu (chỉ chạy được trong SQL Editor, không gọi được từ ứng dụng)
create or replace function public.grant_platform_admin(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_org uuid; v_role uuid;
begin
  select id into v_uid from profiles where lower(email) = lower(trim(p_email));
  if v_uid is null then return 'Chưa có tài khoản ' || p_email || ' — hãy đăng ký/đăng nhập một lần rồi chạy lại.'; end if;
  select id into v_org from organizations where is_platform;
  select id into v_role from roles where key = 'platform_admin' and org_id is null;
  insert into memberships (user_id, org_id, role_id, created_by) values (v_uid, v_org, v_role, null) on conflict do nothing;
  return 'Đã cấp Quản trị nền tảng cho ' || p_email || '. Chọn "KDI Education" ở ô Đang làm việc tại (nếu có nhiều đơn vị).';
end $$;
revoke execute on function public.grant_platform_admin(text) from public, anon, authenticated;

-- ===== 6. Nhật ký thay đổi =====
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,                 -- người thực hiện (null = hệ thống / SQL)
  org_id uuid,                -- đơn vị liên quan (không ràng buộc khoá ngoại để giữ lịch sử khi xoá)
  entity text not null,       -- organizations | memberships | invitations | roles
  entity_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  summary text not null,
  detail jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_org_idx on audit_log (org_id, at desc);
alter table audit_log enable row level security;
create policy audit_platform_read on audit_log for select to authenticated using ((select public.is_platform_admin()));
create policy audit_admin_read on audit_log for select to authenticated
  using ((select public.is_admin()) and org_id in (select public.my_org_tree()));
grant select on audit_log to authenticated;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_org uuid; v_sum text; v_detail jsonb; v_name text; v_user text; v_role text; k text;
  act text := lower(tg_op);
begin
  if tg_table_name = 'roles' and r->>'org_id' is null then return null; end if;   -- chỉ vai trò tuỳ chỉnh
  if tg_table_name = 'organizations' then
    v_org := (r->>'id')::uuid;
    v_sum := case tg_op when 'INSERT' then 'Tạo đơn vị ' when 'DELETE' then 'Xoá đơn vị ' else 'Sửa đơn vị ' end || (r->>'name');
  else
    v_org := (r->>'org_id')::uuid;
    select name into v_name from organizations where id = v_org;
    select name into v_role from roles where id = (r->>'role_id')::uuid;
    if tg_table_name = 'memberships' then
      select coalesce(full_name, email) into v_user from profiles where id = (r->>'user_id')::uuid;
      v_sum := case tg_op when 'INSERT' then 'Gán vai trò ' else 'Gỡ vai trò ' end || coalesce(v_role, '?')
               || ' cho ' || coalesce(v_user, 'tài khoản đã xoá') || ' tại ' || coalesce(v_name, '?');
    elsif tg_table_name = 'invitations' then
      v_sum := case when tg_op = 'INSERT' then 'Mời ' when tg_op = 'DELETE' then 'Xoá lời mời ' else
                 case r->>'status' when 'accepted' then 'Đã nhận lời mời: ' when 'cancelled' then 'Huỷ lời mời ' else 'Cập nhật lời mời ' end end
               || (r->>'email') || ' · ' || coalesce(v_role, '?') || ' tại ' || coalesce(v_name, '?');
    else
      v_sum := case tg_op when 'INSERT' then 'Tạo vai trò ' when 'DELETE' then 'Xoá vai trò ' else 'Sửa vai trò ' end
               || (r->>'name') || coalesce(' tại ' || v_name, '');
    end if;
  end if;
  if tg_op = 'UPDATE' then
    v_detail := '{}'::jsonb;
    for k in select jsonb_object_keys(r) loop
      if r->k is distinct from o->k and k not in ('updated_at') then
        v_detail := v_detail || jsonb_build_object(k, jsonb_build_object('from', o->k, 'to', r->k));
      end if;
    end loop;
    if v_detail = '{}'::jsonb then return null; end if;
    -- lời mời: chỉ ghi khi đổi trạng thái
    if tg_table_name = 'invitations' and not v_detail ? 'status' then return null; end if;
  else
    v_detail := r;
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), v_org, tg_table_name, coalesce(r->>'id', (r->>'user_id') || '/' || (r->>'role_id')), act, v_sum, v_detail);
  return null;
end $$;

drop trigger if exists audit_organizations on organizations;
create trigger audit_organizations after insert or update or delete on organizations for each row execute function public.audit_row();
drop trigger if exists audit_memberships on memberships;
create trigger audit_memberships after insert or delete on memberships for each row execute function public.audit_row();
drop trigger if exists audit_invitations on invitations;
create trigger audit_invitations after insert or update or delete on invitations for each row execute function public.audit_row();
drop trigger if exists audit_roles on roles;
create trigger audit_roles after insert or update or delete on roles for each row execute function public.audit_row();

-- ===== 7. Thống kê theo cây (dùng cho cổng nền tảng, sau này cho dashboard Phòng → Tỉnh → Bộ) =====
create or replace function public.org_tree_stats()
returns table(org_id uuid, members int, schools int, schools_active int, teachers int, students int)
language sql stable security definer set search_path = public as $$
  with recursive vis as (select t as id from public.my_org_tree() t where public.is_staff()),
  clos as (
    select id as anc, id as des from organizations where id in (select id from vis)
    union all
    select c.anc, o.id from clos c join organizations o on o.parent_id = c.des
  ),
  sch as (
    select o.id, o.activated_at is not null and o.status = 'active' as act,
      (select count(*) from teachers t where t.org_id = o.id and coalesce(t.status, 'active') = 'active') as tc,
      (select count(*) from students s where s.org_id = o.id and coalesce(s.status, 'studying') = 'studying') as sc
    from organizations o where o.type = 'school' and o.id in (select id from vis)
  ),
  mem as (select m.org_id, count(distinct m.user_id) as n from memberships m group by m.org_id)
  select v.id,
         coalesce((select n from mem where mem.org_id = v.id), 0)::int,
         count(s.id)::int, (count(s.id) filter (where s.act))::int,
         coalesce(sum(s.tc), 0)::int, coalesce(sum(s.sc), 0)::int
    from vis v left join clos c on c.anc = v.id left join sch s on s.id = c.des
   group by v.id
$$;
grant execute on function public.org_tree_stats() to authenticated;

-- Tổng quan nền tảng + kiểm tra cấu trúc dữ liệu
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; checks jsonb := '[]'::jsonb;
  v_items jsonb; v_n int;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;

  -- 1. Đơn vị sai cấp
  select count(*), coalesce(jsonb_agg(o.name order by o.name), '[]') into v_n, v_items
    from organizations o left join organizations p on p.id = o.parent_id
   where not public.org_parent_ok(o.type, p.type);
  checks := checks || jsonb_build_object('level', 'bad', 'key', 'wrong_parent', 'title', 'Đơn vị đặt sai cấp (vd: trường nằm trực tiếp dưới Bộ)', 'count', v_n, 'items', v_items);
  -- 2. Sở chưa thuộc tỉnh
  select count(*), coalesce(jsonb_agg(name order by name), '[]') into v_n, v_items
    from organizations where type = 'department' and parent_id is null;
  checks := checks || jsonb_build_object('level', 'warn', 'key', 'dept_no_province', 'title', 'Sở chưa gắn vào Tỉnh', 'count', v_n, 'items', v_items);
  -- 3. Đơn vị chưa có ai phụ trách
  select count(*), coalesce(jsonb_agg(name order by name), '[]') into v_n, v_items
    from organizations o where o.type in ('province','department','district','school') and o.status = 'active'
     and not exists (select 1 from memberships m join roles r on r.id = m.role_id
                      where m.org_id = o.id and r.key <> 'student');
  checks := checks || jsonb_build_object('level', 'warn', 'key', 'no_staff', 'title', 'Đơn vị chưa có tài khoản cán bộ nào', 'count', v_n, 'items', v_items);
  -- 4. Tài khoản đang trỏ tới đơn vị mà họ không có vai trò
  select count(*), coalesce(jsonb_agg(coalesce(p.full_name, p.email) order by p.full_name), '[]') into v_n, v_items
    from profiles p where p.org_id is not null
     and not exists (select 1 from memberships m where m.user_id = p.id and m.org_id = p.org_id);
  checks := checks || jsonb_build_object('level', 'bad', 'key', 'stale_active_org', 'title', 'Tài khoản trỏ tới đơn vị không còn vai trò', 'count', v_n, 'items', v_items);
  -- 5. Tài khoản chưa thuộc đơn vị nào
  select count(*), coalesce(jsonb_agg(coalesce(p.full_name, p.email) order by p.full_name), '[]') into v_n, v_items
    from profiles p where not exists (select 1 from memberships m where m.user_id = p.id);
  checks := checks || jsonb_build_object('level', 'info', 'key', 'no_membership', 'title', 'Tài khoản chưa thuộc đơn vị nào (đang chờ cấp quyền)', 'count', v_n, 'items', v_items);
  -- 6. Trường chưa kích hoạt / đơn vị tạm dừng
  select count(*), coalesce(jsonb_agg(name order by name), '[]') into v_n, v_items
    from organizations where type = 'school' and activated_at is null;
  checks := checks || jsonb_build_object('level', 'info', 'key', 'not_activated', 'title', 'Trường chưa kích hoạt', 'count', v_n, 'items', v_items);
  select count(*), coalesce(jsonb_agg(name order by name), '[]') into v_n, v_items
    from organizations where status = 'suspended';
  checks := checks || jsonb_build_object('level', 'info', 'key', 'suspended', 'title', 'Đơn vị đang tạm dừng', 'count', v_n, 'items', v_items);

  select jsonb_build_object(
    'org_counts', (select coalesce(jsonb_object_agg(type, n), '{}') from (select type, count(*) n from organizations group by type) x),
    'schools_active', (select count(*) from organizations where type = 'school' and activated_at is not null and status = 'active'),
    'users', (select count(*) from profiles),
    'users_active_7d', (select count(distinct actor) from audit_log where at > now() - interval '7 days'),
    'memberships', (select count(*) from memberships),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc), '[]')
                  from (select r.name, count(*) n from memberships m join roles r on r.id = m.role_id group by r.name) x),
    'invitations_pending', (select count(*) from invitations where status = 'pending'),
    'teachers', (select count(*) from teachers where coalesce(status, 'active') = 'active'),
    'students', (select count(*) from students where coalesce(status, 'studying') = 'studying'),
    'checks', checks,
    'recent', (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
                 select a.at, a.summary, a.entity, coalesce(p.full_name, p.email, 'Hệ thống') as actor
                   from audit_log a left join profiles p on p.id = a.actor order by a.at desc limit 8) x)
  ) into res;
  return res;
end $$;
grant execute on function public.platform_overview() to authenticated;

notify pgrst, 'reload schema';
