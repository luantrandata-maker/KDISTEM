-- 014. Vai trò tuỳ chỉnh của trường và mời người dùng qua email.
-- Cần chạy sau 012.
--
-- Vai trò tuỳ chỉnh: quản trị trường tạo vai trò riêng (vd "Tổ trưởng chuyên môn", "Thủ kho thiết bị"),
--   chọn giao diện (Quản trị trường hoặc Giáo viên) và chỉnh quyền như vai trò hệ thống.
-- Lời mời: quản trị nhập email + vai trò (+ hồ sơ GV/HS cần liên kết). Khi người được mời xác nhận email
--   (bấm liên kết đăng nhập, hoặc tự đăng ký đúng email đó), tài khoản tự được gán trường, vai trò, hồ sơ.
-- LƯU Ý: giữ bật "Confirm email" trong Supabase → Authentication → Providers → Email.
--   Lời mời chỉ được áp dụng khi email đã xác nhận, để không ai nhận vai trò bằng cách đăng ký trùng email người khác.

-- ===== 1. Vai trò =====
alter table roles add column if not exists portal text, add column if not exists description text,
  add column if not exists created_at timestamptz not null default now();
update roles set portal = case key
  when 'principal' then 'school_admin' when 'it_admin' then 'school_admin' when 'office_staff' then 'school_admin'
  when 'teacher' then 'teacher' when 'student' then 'student' when 'department' then 'department' end
where org_id is null and portal is null;

alter table roles alter column key set default ('custom_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
-- Vai trò tuỳ chỉnh không được dùng khoá của vai trò hệ thống (tránh leo quyền qua is_admin / has_role)
alter table roles add constraint roles_custom_key check (is_system or (key like 'custom\_%' and org_id is not null));
alter table roles add constraint roles_portal check (portal is null or portal in ('school_admin','teacher','student','department'));
alter table roles add constraint roles_custom_portal check (is_system or portal in ('school_admin','teacher'));

-- Chỉ vai trò hệ thống (org_id null) mới mang quyền quản trị / học sinh / Sở
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.org_id is null and r.key in ('principal','it_admin'))
$$;
create or replace function public.has_role(keys text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key = any(keys) and (r.org_id is null or r.key like 'custom\_%'))
$$;

create policy roles_admin_insert on roles for insert to authenticated
  with check (public.is_admin() and not is_system and org_id = public.my_org_id());
create policy roles_admin_update on roles for update to authenticated
  using (public.is_admin() and not is_system and org_id = public.my_org_id())
  with check (public.is_admin() and not is_system and org_id = public.my_org_id());
create policy roles_admin_delete on roles for delete to authenticated
  using (public.is_admin() and not is_system and org_id = public.my_org_id());

-- Không đổi khoá / trường / cờ hệ thống của vai trò sau khi tạo
create or replace function public.guard_role_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.key <> old.key or new.org_id is distinct from old.org_id or new.is_system <> old.is_system then
    raise exception 'Không được đổi mã, trường hoặc loại của vai trò';
  end if;
  return new;
end $$;
create trigger roles_guard_update before update on roles for each row execute function public.guard_role_update();

-- Quyền ghi đè chỉ áp cho vai trò hệ thống hoặc vai trò tuỳ chỉnh của chính trường đó
drop policy if exists orp_write on org_role_permissions;
create policy orp_write on org_role_permissions for all to authenticated
  using (public.is_admin() and public.can_access_org(org_id))
  with check (public.is_admin() and public.can_access_org(org_id)
    and exists (select 1 from roles r where r.id = role_id
                and ((r.org_id is null and r.key not in ('department','provider','student')) or r.org_id = org_role_permissions.org_id)));

-- Trước đây mọi quản trị trường thấy và "nhận" được mọi tài khoản chưa thuộc trường nào (lộ email giữa các trường).
-- Từ nay người mới vào trường qua lời mời; quản trị chỉ thấy và sửa hồ sơ trong trường mình.
drop policy if exists profiles_admin_unassigned on profiles;
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update to authenticated
  using (public.is_admin() and public.can_access_org(org_id))
  with check (public.is_admin() and public.can_access_org(org_id));
drop policy if exists ur_admin_write on user_roles;
create policy ur_admin_write on user_roles for all to authenticated
  using (public.is_admin() and exists (select 1 from profiles p where p.id = user_roles.user_id and public.can_access_org(p.org_id)))
  with check (public.is_admin()
    and exists (select 1 from roles r join profiles p on p.id = user_roles.user_id where r.id = user_roles.role_id
                and public.can_access_org(p.org_id)
                and ((r.org_id is null and r.key not in ('department','provider')) or r.org_id = p.org_id)));

-- Vai trò của người dùng hiện tại kèm giao diện tương ứng (dùng cho menu)
create or replace function public.my_roles()
returns table (role_id uuid, key text, name text, portal text)
language sql stable security definer set search_path = public as $$
  select r.id, r.key, r.name, r.portal from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = auth.uid()
$$;

-- ===== 2. Lời mời =====
create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text,
  role_id uuid not null references roles(id) on delete cascade,
  teacher_id uuid references teachers(id) on delete set null,
  student_id uuid references students(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  note text,
  invited_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_user uuid references profiles(id) on delete set null
);
create unique index invitations_pending_email on invitations (org_id, lower(email)) where status = 'pending';

alter table invitations enable row level security;
create policy invitations_admin_read on invitations for select to authenticated
  using (public.is_admin() and public.can_access_org(org_id));
create policy invitations_admin_insert on invitations for insert to authenticated
  with check (public.is_admin() and org_id = public.my_org_id() and invited_by = auth.uid() and status = 'pending'
    and exists (select 1 from roles r where r.id = role_id
                and ((r.org_id is null and r.key not in ('department','provider')) or r.org_id = invitations.org_id))
    and (teacher_id is null or exists (select 1 from teachers t where t.id = teacher_id and t.org_id = invitations.org_id))
    and (student_id is null or exists (select 1 from students s where s.id = student_id and s.org_id = invitations.org_id)));
-- Quản trị chỉ huỷ lời mời hoặc ghi lại lần gửi email; việc chấp nhận do hệ thống làm
create policy invitations_admin_update on invitations for update to authenticated
  using (public.is_admin() and public.can_access_org(org_id) and status = 'pending')
  with check (public.is_admin() and public.can_access_org(org_id) and status in ('pending','cancelled'));
create policy invitations_admin_delete on invitations for delete to authenticated
  using (public.is_admin() and public.can_access_org(org_id) and status <> 'accepted');

create or replace function public.guard_invitation_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.email := old.email; new.org_id := old.org_id; new.role_id := old.role_id; new.invited_by := old.invited_by;
    new.accepted_at := old.accepted_at; new.accepted_user := old.accepted_user;
  end if;
  return new;
end $$;
create trigger invitations_guard_update before update on invitations for each row execute function public.guard_invitation_update();

-- Áp dụng các lời mời đang chờ cho một tài khoản đã xác nhận email
create or replace function public.apply_invitations(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_email text; v_confirmed timestamptz; inv invitations; n int := 0; v_org uuid;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = p_user;
  if v_email is null or v_confirmed is null then return 0; end if;
  for inv in select * from invitations where lower(email) = lower(v_email) and status = 'pending' order by created_at loop
    select org_id into v_org from profiles where id = p_user;
    if v_org is not null and v_org <> inv.org_id then
      update invitations set note = 'Tài khoản đã thuộc trường khác' where id = inv.id;
      continue;
    end if;
    update profiles set org_id = inv.org_id,
                        full_name = coalesce(nullif(trim(inv.full_name), ''), full_name)
     where id = p_user;
    insert into user_roles (user_id, role_id) values (p_user, inv.role_id) on conflict do nothing;
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
revoke execute on function public.apply_invitations(uuid) from public, anon, authenticated;

-- Tài khoản mới: tạo hồ sơ, áp lời mời nếu email đã xác nhận ngay (vd đăng nhập bằng liên kết OTP đã xác minh)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  perform public.apply_invitations(new.id);
  return new;
end $$;

-- Khi người dùng xác nhận email (bấm liên kết trong thư mời / thư xác nhận đăng ký)
create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.apply_invitations(new.id);
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- Mời một người đã có tài khoản (đã xác nhận, chưa thuộc trường nào): áp dụng ngay
create or replace function public.handle_invitation_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(new.email) and email_confirmed_at is not null limit 1;
  if v_user is not null then perform public.apply_invitations(v_user); end if;
  return null;
end $$;
create trigger invitations_apply_existing after insert on invitations for each row execute function public.handle_invitation_created();

grant execute on function public.my_roles() to authenticated;
