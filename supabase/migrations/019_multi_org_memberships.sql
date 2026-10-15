-- 019. Lõi đa tổ chức
--  • Cây tổ chức 6 cấp: Bộ → Tỉnh → Sở → Phòng → Trường, cộng Đơn vị cung cấp (vẫn một cây parent_id).
--  • Bảng memberships (người dùng – tổ chức – vai trò): một người có thể giữ nhiều vai trò ở nhiều tổ chức.
--    profiles.org_id trở thành "tổ chức đang làm việc"; đổi bằng RPC switch_org().
--    Mọi hàm quyền (is_admin, has_role, my_permissions...) chỉ tính vai trò tại tổ chức đang làm việc,
--    nên quyền quản trị ở trường A không mang sang trường B.
--  • Bảng user_roles cũ được thay bằng view tương thích (đọc/ghi qua memberships, vẫn chịu RLS).
--  • Sửa dữ liệu cũ: Geleximco → KDI Education.
-- Cần chạy sau 018. Chạy một lần trong SQL Editor; cuối file có lệnh nạp lại schema cho API.

-- ===== 1. Loại tổ chức =====
alter table organizations drop constraint if exists organizations_type_check;
alter table organizations add constraint organizations_type_check
  check (type in ('ministry','province','department','district','school','provider'));
comment on column organizations.type is 'ministry=Bộ GD&ĐT, province=UBND tỉnh, department=Sở GD&ĐT, district=Phòng GD&ĐT, school=Trường, provider=Đơn vị cung cấp';

-- Vai trò hệ thống cho các cấp quản lý (dùng chung giao diện cổng quản lý)
insert into roles (key, name, is_system, portal, description)
select v.key, v.name, true, 'department', v.description from (values
  ('ministry', 'Bộ GD&ĐT', 'Cán bộ Bộ: xem số liệu toàn quốc'),
  ('province', 'UBND tỉnh', 'Cán bộ tỉnh: xem số liệu các Sở, trường trong tỉnh'),
  ('district', 'Phòng GD&ĐT', 'Cán bộ Phòng: xem số liệu các trường trực thuộc')) v(key, name, description)
where not exists (select 1 from roles r where r.key = v.key and r.org_id is null);
update roles set description = coalesce(description, 'Cán bộ Sở: xem số liệu, quản lý tập huấn và kích hoạt trường trực thuộc')
 where key = 'department' and org_id is null;
-- Các vai trò quản lý mới có cùng ma trận quyền mặc định như vai trò Sở
insert into role_permissions (role_id, module, can_view, can_detail, can_create, can_edit, can_delete)
select n.id, d.module, d.can_view, d.can_detail, d.can_create, d.can_edit, d.can_delete
from role_permissions d
join roles s on s.id = d.role_id and s.key = 'department' and s.org_id is null
cross join roles n where n.org_id is null and n.key in ('ministry','province','district')
on conflict do nothing;

-- ===== 2. Bảng memberships + chuyển dữ liệu =====
create table if not exists memberships (
  user_id uuid not null references profiles(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  primary key (user_id, org_id, role_id)
);
create index if not exists memberships_org_idx on memberships(org_id);
create index if not exists memberships_role_idx on memberships(role_id);
alter table memberships enable row level security;

do $$
declare n_moved int; n_lost int;
begin
  if to_regclass('public.user_roles') is not null and (select relkind from pg_class where oid = 'public.user_roles'::regclass) = 'r' then
    insert into memberships (user_id, org_id, role_id, created_by)
    select ur.user_id, p.org_id, ur.role_id, null
      from user_roles ur join profiles p on p.id = ur.user_id
     where p.org_id is not null
    on conflict do nothing;
    get diagnostics n_moved = row_count;
    select count(*) into n_lost from user_roles ur join profiles p on p.id = ur.user_id where p.org_id is null;
    raise notice 'memberships: chuyển % dòng; % vai trò của tài khoản chưa thuộc tổ chức nào bị bỏ qua', n_moved, n_lost;
    drop table user_roles cascade;
  end if;
end $$;

-- ===== 3. Hàm ngữ cảnh =====
-- Tổ chức đang làm việc: chỉ hợp lệ khi người dùng là thành viên của tổ chức đó
create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.org_id from profiles p
   where p.id = auth.uid()
     and exists (select 1 from memberships m where m.user_id = p.id and m.org_id = p.org_id)
$$;

-- Tổ chức đang làm việc và toàn bộ cấp dưới
create or replace function public.my_org_tree() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select id from organizations where id = public.my_org_id()
    union all
    select o.id from organizations o join tree t on o.parent_id = t.id
  ) select id from tree
$$;

create or replace function public.can_access_org(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target is not null and exists (select 1 from public.my_org_tree() as t(id) where t.id = target)
$$;

-- Các cấp trên của tổ chức đang làm việc (Sở, Tỉnh, Bộ của một trường)
create or replace function public.my_ancestor_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select parent_id as id from organizations where id = public.my_org_id()
    union all
    select o.parent_id from organizations o join up on o.id = up.id where o.parent_id is not null
  ) select id from up where id is not null
$$;

create or replace function public.my_parent_org() returns uuid
language sql stable security definer set search_path = public as $$
  select parent_id from organizations where id = public.my_org_id()
$$;

-- Vai trò tại tổ chức đang làm việc
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                 where m.user_id = auth.uid() and m.org_id = public.my_org_id()
                   and r.org_id is null and r.key in ('principal','it_admin'))
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                 where m.user_id = auth.uid() and m.org_id = public.my_org_id() and r.key <> 'student')
$$;

create or replace function public.has_role(keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                 where m.user_id = auth.uid() and m.org_id = public.my_org_id()
                   and r.key = any(keys) and (r.org_id is null or r.key like 'custom\_%'))
$$;

-- Cán bộ quản lý (Bộ, Tỉnh, Sở, Phòng) tại tổ chức đang làm việc
create or replace function public.is_authority() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(array['ministry','province','department','district'])
$$;

create or replace function public.my_roles()
returns table(role_id uuid, key text, name text, portal text)
language sql stable security definer set search_path = public as $$
  select r.id, r.key, r.name, r.portal from memberships m join roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.org_id = public.my_org_id()
$$;

create or replace function public.my_permissions()
returns table(module text, can_view boolean, can_detail boolean, can_create boolean, can_edit boolean, can_delete boolean)
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.role_id from memberships m where m.user_id = auth.uid() and m.org_id = public.my_org_id()
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

-- Quyền của một người dùng tại một tổ chức (dùng khi gửi thông báo)
create or replace function public.user_has_perm(p_user uuid, p_module text, p_action text, p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with mine as (select r.id as role_id, r.key, r.org_id from memberships m join roles r on r.id = m.role_id
                where m.user_id = p_user and m.org_id = p_org)
  select exists (select 1 from mine where org_id is null and key in ('principal','it_admin'))
      or exists (
        select 1 from mine m
        left join org_role_permissions o on o.role_id = m.role_id and o.module = p_module and o.org_id = p_org
        left join role_permissions d on d.role_id = m.role_id and d.module = p_module
        where case p_action
          when 'view' then coalesce(o.can_view, d.can_view, false)
          when 'edit' then coalesce(o.can_edit, d.can_edit, false)
          when 'create' then coalesce(o.can_create, d.can_create, false)
          when 'delete' then coalesce(o.can_delete, d.can_delete, false)
          else false end)
$$;
create or replace function public.user_has_perm(p_user uuid, p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_perm(p_user, p_module, p_action, (select org_id from profiles where id = p_user))
$$;

create or replace function public.notify_staff(p_org uuid, p_module text, p_kind text, p_title text, p_body text, p_page text, p_ref uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct m.user_id from memberships m
            where m.org_id = p_org and public.user_has_perm(m.user_id, p_module, 'edit', p_org) loop
    perform public.notify_user(u, p_org, p_kind, p_title, p_body, p_page, 'school_admin', p_ref);
  end loop;
end $$;
revoke execute on function public.user_has_perm(uuid, text, text), public.user_has_perm(uuid, text, text, uuid),
  public.notify_staff(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;

-- Hồ sơ giáo viên / học sinh tại tổ chức đang làm việc (một người có thể dạy ở hai trường)
create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from teachers where profile_id = auth.uid() and org_id = public.my_org_id() order by id limit 1
$$;
create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from students where profile_id = auth.uid() and org_id = public.my_org_id() order by id limit 1
$$;
create or replace function public.my_class_id() returns uuid
language sql stable security definer set search_path = public as $$
  select class_id from students where profile_id = auth.uid() and org_id = public.my_org_id() order by id limit 1
$$;

-- Vai trò có hợp với loại tổ chức không
create or replace function public.role_fits_org(p_role uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r, organizations o
     where r.id = p_role and o.id = p_org
       and case
             when r.org_id is not null then r.org_id = o.id
             when o.type = 'school' then r.key in ('principal','it_admin','teacher','office_staff','student')
             else r.key = o.type
           end)
$$;

-- ===== 4. Chọn tổ chức đang làm việc =====
create or replace function public.my_orgs()
returns table(org_id uuid, name text, type text, parent_name text, roles text[], active boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.type, par.name,
         array_agg(r.name order by r.name), o.id = (select org_id from profiles where id = auth.uid())
    from memberships m
    join organizations o on o.id = m.org_id
    join roles r on r.id = m.role_id
    left join organizations par on par.id = o.parent_id
   where m.user_id = auth.uid()
   group by o.id, o.name, o.type, par.name
   order by o.name
$$;

create or replace function public.switch_org(p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and org_id = p_org) then
    raise exception 'Bạn không thuộc tổ chức này' using errcode = '42501';
  end if;
  update profiles set org_id = p_org where id = auth.uid();
  return p_org;
end $$;
grant execute on function public.my_orgs(), public.switch_org(uuid), public.is_authority(),
  public.my_org_tree(), public.my_ancestor_orgs(), public.role_fits_org(uuid, uuid) to authenticated;

-- ===== 5. Ràng buộc =====
-- Vai trò phải hợp loại tổ chức (vd: không gán "Sở GD&ĐT" trong một trường)
create or replace function public.guard_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.role_fits_org(new.role_id, new.org_id) then
    raise exception 'Vai trò không áp dụng cho loại tổ chức này' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists memberships_guard on memberships;
create trigger memberships_guard before insert or update on memberships
  for each row execute function public.guard_membership();

-- Tài khoản chưa có tổ chức đang làm việc → lấy tổ chức đầu tiên được gán
create or replace function public.membership_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set org_id = new.org_id where id = new.user_id and org_id is null;
  return null;
end $$;
drop trigger if exists memberships_added on memberships;
create trigger memberships_added after insert on memberships
  for each row execute function public.membership_added();

-- Người dùng đã thuộc phạm vi của tôi chưa (dùng trong chính sách của memberships, tránh đệ quy RLS)
create or replace function public.in_my_tree(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = p_user and m.org_id in (select public.my_org_tree()))
$$;
grant execute on function public.in_my_tree(uuid) to authenticated;

-- Rời hết vai trò ở tổ chức đang làm việc → chuyển sang tổ chức khác còn vai trò (hoặc để trống)
create or replace function public.membership_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where user_id = old.user_id and org_id = old.org_id) then
    update profiles set org_id = (select org_id from memberships where user_id = old.user_id order by created_at limit 1)
     where id = old.user_id and org_id = old.org_id;
  end if;
  return null;
end $$;
drop trigger if exists memberships_removed on memberships;
create trigger memberships_removed after delete on memberships
  for each row execute function public.membership_removed();

-- Tổ chức đang làm việc chỉ được trỏ tới nơi người dùng là thành viên
create or replace function public.guard_profile_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is distinct from old.org_id and new.org_id is not null
     and not exists (select 1 from memberships where user_id = new.id and org_id = new.org_id) then
    raise exception 'Người dùng chưa thuộc tổ chức này. Hãy mời qua mục Tài khoản.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_org on profiles;
create trigger profiles_guard_org before update of org_id on profiles
  for each row execute function public.guard_profile_org();

-- ===== 6. RLS =====
-- memberships
create policy memberships_self on memberships for select to authenticated using (user_id = auth.uid());
create policy memberships_org_read on memberships for select to authenticated
  using (public.is_staff() and org_id in (select public.my_org_tree()));
-- Quản trị trường gán / gỡ vai trò cho người đã thuộc trường mình (người mới vào bằng lời mời)
create policy memberships_admin_insert on memberships for insert to authenticated
  with check (public.is_admin() and org_id in (select public.my_org_tree())
              and public.role_fits_org(role_id, org_id)
              and public.in_my_tree(user_id));
create policy memberships_admin_delete on memberships for delete to authenticated
  using (public.is_admin() and org_id in (select public.my_org_tree()));

-- profiles: thấy người cùng tổ chức (theo memberships, không theo tổ chức đang làm việc của họ)
drop policy if exists profile_self_or_org on profiles;
create policy profile_self_or_org on profiles for select to authenticated using (
  id = auth.uid()
  or (public.is_staff() and exists (select 1 from memberships m where m.user_id = profiles.id
                                                          and m.org_id in (select public.my_org_tree()))));
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update to authenticated
  using (public.is_admin() and exists (select 1 from memberships m where m.user_id = profiles.id
                                                               and m.org_id in (select public.my_org_tree())))
  with check (public.is_admin() and exists (select 1 from memberships m where m.user_id = profiles.id
                                                                    and m.org_id in (select public.my_org_tree())));

-- Lời mời: vai trò phải hợp loại tổ chức
drop policy if exists invitations_admin_insert on invitations;
create policy invitations_admin_insert on invitations for insert to authenticated with check (
  public.is_admin() and org_id = public.my_org_id() and invited_by = auth.uid() and status = 'pending'
  and public.role_fits_org(role_id, org_id)
  and (teacher_id is null or exists (select 1 from teachers t where t.id = teacher_id and t.org_id = invitations.org_id))
  and (student_id is null or exists (select 1 from students s where s.id = student_id and s.org_id = invitations.org_id)));

-- Cấp trên: trường thấy tên Sở/Tỉnh/Bộ chủ quản
drop policy if exists org_read_parent on organizations;
create policy org_read_parent on organizations for select to authenticated
  using (id in (select public.my_ancestor_orgs()));
-- Cán bộ quản lý cập nhật / kích hoạt các đơn vị cấp dưới (không đưa ra ngoài phạm vi)
drop policy if exists org_department_update on organizations;
create policy org_department_update on organizations for update to authenticated
  using (public.is_authority() and id <> public.my_org_id() and id in (select public.my_org_tree()))
  with check (public.is_authority() and id <> public.my_org_id() and parent_id in (select public.my_org_tree()));

-- Tập huấn: mọi cấp quản lý (không chỉ Sở) tạo được; trường thấy kế hoạch của mọi cấp trên
do $$
declare t text;
begin
  foreach t in array array['training_plans','training_sessions','training_lessons','training_enrollments','training_attendance','certificates'] loop
    execute format('drop policy if exists %I on %I', t||'_dept_write', t);
    execute format('create policy %I on %I for all to authenticated using (public.is_authority() and org_id = public.my_org_id()) with check (public.is_authority() and org_id = public.my_org_id())', t||'_dept_write', t);
  end loop;
  foreach t in array array['training_plans','training_sessions','training_lessons'] loop
    execute format('drop policy if exists %I on %I', t||'_from_department', t);
    execute format('create policy %I on %I for select to authenticated using (public.is_staff() and org_id in (select public.my_ancestor_orgs()))', t||'_from_department', t);
  end loop;
end $$;

-- ===== 7. Lời mời → memberships (người đã thuộc trường khác vẫn được thêm, không bị chặn như trước) =====
create or replace function public.apply_invitations(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_email text; v_confirmed timestamptz; inv invitations; n int := 0;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = p_user;
  if v_email is null or v_confirmed is null then return 0; end if;
  for inv in select * from invitations where lower(email) = lower(v_email) and status = 'pending' order by created_at loop
    insert into memberships (user_id, org_id, role_id, created_by)
      values (p_user, inv.org_id, inv.role_id, inv.invited_by) on conflict do nothing;
    update profiles set full_name = coalesce(nullif(trim(inv.full_name), ''), full_name)
     where id = p_user and (org_id = inv.org_id or full_name is null or full_name = split_part(v_email, '@', 1));
    if inv.teacher_id is not null then
      update teachers set profile_id = p_user where id = inv.teacher_id and (profile_id is null or profile_id = p_user);
    end if;
    if inv.student_id is not null then
      update students set profile_id = p_user where id = inv.student_id and (profile_id is null or profile_id = p_user);
    end if;
    update invitations set status = 'accepted', accepted_at = now(), accepted_user = p_user, note = null where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== 8. View tương thích user_roles (vai trò tại tổ chức đang làm việc của từng người) =====
create or replace view user_roles with (security_invoker = true) as
  select m.user_id, m.role_id
    from memberships m join profiles p on p.id = m.user_id and p.org_id = m.org_id;

create or replace function public.user_roles_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into memberships (user_id, org_id, role_id)
      values (new.user_id, coalesce((select org_id from profiles where id = new.user_id), public.my_org_id()), new.role_id);
    return new;
  else
    delete from memberships m where m.user_id = old.user_id and m.role_id = old.role_id
      and m.org_id = (select org_id from profiles where id = old.user_id);
    return old;
  end if;
end $$;
drop trigger if exists user_roles_write on user_roles;
create trigger user_roles_write instead of insert or delete on user_roles
  for each row execute function public.user_roles_write();
grant select, insert, delete on user_roles to authenticated;
grant select, insert, delete on memberships to authenticated;

-- Việc chờ xử lý + thông báo chưa đọc: chỉ tính ở đơn vị đang làm việc
create or replace function public.my_pending_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'stem_registrations', case when public.has_perm('stem_registrations','edit')
      then (select count(*) from stem_registrations where org_id = public.my_org_id() and status = 'pending') else 0 end,
    'borrow_requests', case when public.has_perm('stem_rooms','edit')
      then (select count(*) from borrow_requests where org_id = public.my_org_id() and status = 'pending') else 0 end,
    'warranty_tickets', case when public.has_perm('warranty','edit')
      then (select count(*) from warranty_tickets where org_id = public.my_org_id() and status in ('new','accepted','waiting_parts','processing')) else 0 end,
    'to_grade', coalesce((select count(*) from submissions s join assignments a on a.id = s.assignment_id
      where a.teacher_id = public.my_teacher_id() and s.status <> 'graded'), 0),
    'unread', (select count(*) from notifications where user_id = auth.uid() and org_id = public.my_org_id() and read_at is null)
  )
$$;

-- ===== 9. Cây tổ chức mẫu: Bộ → Tỉnh Hưng Yên → Sở GD&ĐT Hưng Yên =====
do $$
declare v_bo uuid; v_tinh uuid;
begin
  if not exists (select 1 from organizations where code = 'SO-HY') then return; end if;
  insert into organizations (type, code, name) values ('ministry', 'BO-GDDT', 'Bộ Giáo dục và Đào tạo')
    on conflict (code) do update set type = excluded.type returning id into v_bo;
  insert into organizations (type, parent_id, code, name) values ('province', v_bo, 'TINH-HY', 'Tỉnh Hưng Yên')
    on conflict (code) do update set parent_id = excluded.parent_id returning id into v_tinh;
  update organizations set parent_id = v_tinh where code = 'SO-HY' and parent_id is null;
end $$;

-- ===== 10. Thương hiệu: Geleximco → KDI Education trong mọi cột chữ =====
do $$
declare c record; n int;
begin
  for c in select table_name, column_name from information_schema.columns col
            where table_schema = 'public' and data_type in ('text', 'character varying')
              and exists (select 1 from information_schema.tables t where t.table_schema = 'public'
                           and t.table_name = col.table_name and t.table_type = 'BASE TABLE') loop
    begin
      execute format($q$update %I set %I = regexp_replace(%I, 'Geleximco( Education)?', 'KDI Education', 'gi') where %I ~* 'geleximco'$q$,
                     c.table_name, c.column_name, c.column_name, c.column_name);
      get diagnostics n = row_count;
      if n > 0 then raise notice 'KDI Education: %.% (% dòng)', c.table_name, c.column_name, n; end if;
    exception when others then raise notice 'Bỏ qua %.%: %', c.table_name, c.column_name, sqlerrm;
    end;
  end loop;
end $$;

-- ===== 11. Tăng tốc RLS =====
-- Các hàm không tham số (is_staff(), is_admin(), my_org_id()...) và can_access_org(org_id) trước đây được gọi
-- lại cho TỪNG DÒNG. Bọc thành (SELECT f()) và "org_id IN (SELECT my_org_tree())" để Postgres tính một lần
-- mỗi câu lệnh (khuyến nghị của Supabase). Logic quyền không đổi. Chạy lại an toàn (không bọc hai lần).
create or replace function public._fast_rls(e text) returns text language plpgsql immutable as $f$
begin
  if e is null then return null; end if;
  e := regexp_replace(e, '(?<!\.)\mcan_access_org\(([A-Za-z0-9_\.]+)\)', '(\1 IN ( SELECT my_org_tree() AS my_org_tree))', 'g');
  e := regexp_replace(e, '(?<!SELECT )\m(is_staff|is_admin|is_student|is_authority|my_org_id|my_teacher_id|my_student_id|my_class_id|my_parent_org)\(\)',
                      '( SELECT \1() AS \1)', 'g');
  e := regexp_replace(e, $r$(?<!SELECT )\mhas_perm\(('[a-z_]+'::text), ('[a-z]+'::text)\)$r$, '( SELECT has_perm(\1, \2) AS has_perm)', 'g');
  return e;
end $f$;

do $$
declare p record; q text; c text; n int := 0;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := public._fast_rls(p.qual); c := public._fast_rls(p.with_check);
    if q is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q); n := n + 1;
    end if;
    if c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c); n := n + 1;
    end if;
  end loop;
  raise notice 'Tăng tốc RLS: cập nhật % biểu thức chính sách', n;
end $$;
drop function public._fast_rls(text);

notify pgrst, 'reload schema';
