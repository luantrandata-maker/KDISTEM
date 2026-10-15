-- 024: Cổng Quản trị nền tảng — đợt 1
--  1. Khách hàng: thông tin thương mại trên organizations (đầu mối, trạng thái).
--  2. Gói dịch vụ & hợp đồng: phân hệ bán được (service_modules), gói (service_plans), hợp đồng (contracts).
--     Quyền dùng phân hệ tính theo cây đơn vị: hợp đồng gần nhất đi từ đơn vị lên cấp trên (Sở mua → trường trực thuộc dùng).
--       • Không có hợp đồng nào trên cây  → không giới hạn (giữ hành vi cũ cho dữ liệu đang chạy).
--       • Có hợp đồng còn hiệu lực        → chỉ các phân hệ trong gói.
--       • Có hợp đồng nhưng đã hết hạn/tạm dừng → chỉ phần lõi (giáo viên, lớp, học sinh, tài khoản…).
--     has_perm() kiểm tra quyền dùng phân hệ → mọi lệnh ghi qua RLS bị chặn khi đơn vị chưa mua phân hệ.
--  3. Bảo mật tài khoản: xác thực 2 lớp bắt buộc theo vai trò, khoá tài khoản, xem/thu hồi phiên đăng nhập.
--  4. Hỗ trợ khách hàng: phiếu hỗ trợ có hạn xử lý theo mức ưu tiên + trao đổi; KDI xử lý phiếu bảo hành thiết bị.

-- ===== 1. Khách hàng =====
alter table organizations add column if not exists customer_status text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists customer_note text;
alter table organizations drop constraint if exists organizations_customer_status_check;
alter table organizations add constraint organizations_customer_status_check
  check (customer_status is null or customer_status in ('prospect','negotiating','active','paused','ended'));
comment on column organizations.customer_status is 'Khách hàng của KDI: prospect=tiềm năng, negotiating=đàm phán, active=đang dùng, paused=tạm dừng, ended=đã kết thúc; null=không phải khách hàng trực tiếp';

-- ===== 2. Gói dịch vụ & hợp đồng =====
create table if not exists service_modules (
  key text primary key,
  name text not null,
  description text,
  perm_modules text[] not null,          -- các chức năng trong ma trận phân quyền thuộc phân hệ này
  sort int not null default 0
);
comment on table service_modules is 'Phân hệ bán được. Chức năng không thuộc phân hệ nào (tài khoản, vai trò, giáo viên, lớp, học sinh, phân công, năm học, toà nhà) là phần lõi, luôn dùng được.';
insert into service_modules (key, name, description, perm_modules, sort) values
  ('stem_rooms', 'Phòng STEM & thiết bị', 'Quản lý phòng STEM, thiết bị, mượn trả, bảo hành', '{stem_rooms,equipment,warranty}', 1),
  ('timetable', 'Kế hoạch giáo dục & TKB', 'Thời khoá biểu, kế hoạch giáo dục, đăng ký và phân công dạy STEM, phân phối chương trình', '{timetable,edu_plan,stem_registrations,stem_assign,curriculum}', 2),
  ('packages', 'Gói STEM', 'Danh mục gói STEM, đề xuất mua gói', '{packages}', 3),
  ('library', 'Kho học liệu dùng chung', 'Chương trình, bài giảng, học liệu phát hành và dùng chung', '{library}', 4),
  ('training', 'Tập huấn giáo viên', 'Kế hoạch, lịch, bài giảng, chứng chỉ tập huấn', '{training}', 5),
  ('approvals', 'Phê duyệt nhiều bước', 'Quy trình phê duyệt và hộp phê duyệt', '{approvals}', 6)
on conflict (key) do update set name = excluded.name, description = excluded.description, perm_modules = excluded.perm_modules, sort = excluded.sort;

create table if not exists service_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  modules text[] not null default '{}',   -- khoá trong service_modules
  price_per_year numeric(14,0) check (price_per_year is null or price_per_year >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  org_id uuid not null references organizations(id) on delete restrict,
  plan_id uuid not null references service_plans(id) on delete restrict,
  starts_on date not null,
  ends_on date,
  value numeric(14,0) check (value is null or value >= 0),
  status text not null default 'draft' check (status in ('draft','active','suspended','ended')),
  include_children boolean not null default true,   -- áp dụng cho đơn vị trực thuộc
  note text,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists contracts_org_idx on contracts (org_id);

-- Gói chỉ chứa phân hệ có thật
create or replace function public.guard_service_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from unnest(new.modules) m where m not in (select key from service_modules)) then
    raise exception 'Gói có phân hệ không tồn tại' using errcode = '23514';
  end if;
  new.modules := array(select distinct m from unnest(new.modules) m order by 1);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists service_plans_guard on service_plans;
create trigger service_plans_guard before insert or update on service_plans for each row execute function public.guard_service_plan();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists contracts_touch on contracts;
create trigger contracts_touch before update on contracts for each row execute function public.touch_updated_at();

insert into service_plans (code, name, description, modules) values
  ('CO-BAN', 'Cơ bản', 'Phòng STEM & thiết bị', '{stem_rooms}'),
  ('TIEU-CHUAN', 'Tiêu chuẩn', 'Cơ bản + kế hoạch giáo dục & TKB, gói STEM, kho học liệu', '{stem_rooms,timetable,packages,library}'),
  ('TOAN-DIEN', 'Toàn diện', 'Tất cả phân hệ', '{stem_rooms,timetable,packages,library,training,approvals}')
on conflict (code) do nothing;

-- Quyền dùng phân hệ của một đơn vị
--   state: open (chưa có hợp đồng trên cây) | active | expired (có hợp đồng nhưng hết hạn/tạm dừng/kết thúc)
create or replace function public.org_entitlement(p_org uuid)
returns table (state text, source_org uuid, contract_id uuid, contract_code text, plan_name text, modules text[], ends_on date)
language plpgsql stable security definer set search_path = public as $$
declare v_depth int;
begin
  with recursive up as (
    select o.id, o.parent_id, 0 as d from organizations o where o.id = p_org
    union all
    select o.id, o.parent_id, u.d + 1 from organizations o join up u on o.id = u.parent_id where u.d < 10
  )
  select min(u.d) into v_depth from up u join contracts c on c.org_id = u.id
   where c.status <> 'draft' and (u.d = 0 or c.include_children);
  if v_depth is null then
    return query select 'open'::text, null::uuid, null::uuid, null::text, null::text, null::text[], null::date;
    return;
  end if;
  return query
  with recursive up as (
    select o.id, o.parent_id, 0 as d from organizations o where o.id = p_org
    union all
    select o.id, o.parent_id, u.d + 1 from organizations o join up u on o.id = u.parent_id where u.d < 10
  ), lvl as (
    select c.*, (c.status = 'active' and current_date >= c.starts_on and (c.ends_on is null or current_date <= c.ends_on)) as live
      from up u join contracts c on c.org_id = u.id
     where u.d = v_depth and c.status <> 'draft' and (u.d = 0 or c.include_children)
  ), pick as (
    select * from lvl order by live desc, starts_on desc limit 1
  )
  select case when k.live then 'active' else 'expired' end, k.org_id, k.id, k.code, p.name,
         case when k.live then p.modules else '{}'::text[] end, k.ends_on
    from pick k join service_plans p on p.id = k.plan_id;
end $$;

-- Đơn vị có được dùng chức năng (theo ma trận phân quyền) này không
create or replace function public.org_has_module(p_org uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e record;
begin
  if not exists (select 1 from service_modules where p_perm = any(perm_modules)) then return true; end if;  -- phần lõi
  if p_org is null then return false; end if;
  select * into e from public.org_entitlement(p_org) limit 1;
  if e.state = 'open' then return true; end if;
  return exists (select 1 from service_modules s where s.key = any(e.modules) and p_perm = any(s.perm_modules));
end $$;

-- Cho giao diện: quyền dùng của đơn vị đang làm việc (ẩn menu theo gói)
create or replace function public.my_entitlement() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', e.state, 'plan', e.plan_name, 'contract', e.contract_code, 'ends_on', e.ends_on,
           'source_org', (select name from organizations where id = e.source_org),
           'gated', (select coalesce(jsonb_agg(distinct pm), '[]'::jsonb) from service_modules s, unnest(s.perm_modules) pm),
           'perm_modules', case when e.state = 'open' then null else
             (select coalesce(jsonb_agg(distinct pm), '[]'::jsonb) from service_modules s, unnest(s.perm_modules) pm where s.key = any(e.modules)) end)
    from public.org_entitlement(public.my_org_id()) e
$$;

-- has_perm: thêm điều kiện quyền dùng phân hệ theo hợp đồng
create or replace function public.has_perm(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.org_has_module(public.my_org_id(), p_module) and (public.is_admin() or exists (
    select 1 from public.my_permissions() p
    where p.module = p_module and case p_action
      when 'view' then p.can_view when 'detail' then p.can_detail when 'create' then p.can_create
      when 'edit' then p.can_edit when 'delete' then p.can_delete else false end))
$$;

-- Tổng hợp cho màn Khách hàng: mỗi đơn vị → trạng thái quyền dùng
create or replace function public.platform_entitlements() returns table (
  org_id uuid, state text, source_org uuid, contract_code text, plan_name text, modules text[], ends_on date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query select o.id, e.state, e.source_org, e.contract_code, e.plan_name, e.modules, e.ends_on
    from organizations o cross join lateral public.org_entitlement(o.id) e
   where o.type <> 'provider';
end $$;

alter table service_modules enable row level security;
alter table service_plans enable row level security;
alter table contracts enable row level security;
drop policy if exists service_modules_read on service_modules;
create policy service_modules_read on service_modules for select to authenticated using (true);
drop policy if exists service_plans_read on service_plans;
create policy service_plans_read on service_plans for select to authenticated using (true);
drop policy if exists service_plans_platform on service_plans;
create policy service_plans_platform on service_plans for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
drop policy if exists contracts_read on contracts;
create policy contracts_read on contracts for select to authenticated
  using ((select public.is_platform_admin()) or (public.can_access_org(org_id) and public.is_staff()
         and (public.is_admin() or (select type from organizations where id = public.my_org_id()) <> 'school')));
drop policy if exists contracts_platform on contracts;
create policy contracts_platform on contracts for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- ===== 3. Bảo mật tài khoản =====
create table if not exists security_settings (
  id int primary key default 1 check (id = 1),
  mfa_roles text[] not null default '{platform_admin}',   -- vai trò bắt buộc xác thực 2 lớp
  enforce_mfa_db boolean not null default false,          -- bật: quyền quản trị nền tảng chỉ có hiệu lực ở phiên đã xác thực 2 lớp (aal2)
  idle_minutes int not null default 0 check (idle_minutes between 0 and 1440),   -- tự đăng xuất khi không thao tác (0 = tắt)
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
insert into security_settings (id) values (1) on conflict do nothing;
alter table security_settings enable row level security;
drop policy if exists security_settings_read on security_settings;
create policy security_settings_read on security_settings for select to authenticated using (true);
drop policy if exists security_settings_update on security_settings;
create policy security_settings_update on security_settings for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

alter table profiles add column if not exists locked_at timestamptz,
  add column if not exists locked_reason text,
  add column if not exists locked_by uuid references profiles(id);

-- Mức xác thực của phiên hiện tại (Supabase đặt claim aal = aal1 | aal2)
create or replace function public.jwt_aal() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'aal', 'aal1')
$$;

-- Tài khoản bị khoá: không còn đơn vị đang làm việc → mọi RLS theo đơn vị đều chặn
-- (giữ điều kiện của 021: đơn vị đang hoạt động hoặc là đơn vị chủ nền tảng, và còn vai trò tại đơn vị)
create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.org_id from profiles p
    join organizations o on o.id = p.org_id
   where p.id = auth.uid()
     and p.locked_at is null
     and (o.status = 'active' or o.is_platform)
     and exists (select 1 from memberships m where m.user_id = p.id and m.org_id = p.org_id)
$$;

-- Quản trị nền tảng: khi bật enforce_mfa_db, chỉ phiên aal2 mới có quyền
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                   join roles r on r.id = m.role_id
                   join organizations o on o.id = m.org_id
                  where m.user_id = auth.uid() and m.org_id = public.my_org_id()
                    and r.key = 'platform_admin' and r.org_id is null and o.is_platform)
     and (public.jwt_aal() = 'aal2' or not coalesce((select enforce_mfa_db from security_settings where id = 1), false))
$$;

-- Người dùng hiện tại có vai trò bắt buộc xác thực 2 lớp không (ở bất kỳ đơn vị nào)
create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                  where m.user_id = auth.uid() and r.key = any(coalesce((select mfa_roles from security_settings where id = 1), '{}'::text[])))
$$;

create or replace function public.platform_lock_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Không tự khoá tài khoản của mình' using errcode = '23514'; end if;
  if exists (select 1 from memberships m join roles r on r.id = m.role_id where m.user_id = p_user and r.key = 'platform_admin' and r.org_id is null) then
    raise exception 'Không khoá quản trị nền tảng. Gỡ vai trò trước.' using errcode = '23514';
  end if;
  update profiles set locked_at = now(), locked_reason = nullif(trim(p_reason), ''), locked_by = auth.uid()
   where id = p_user and locked_at is null returning coalesce(full_name, email) into v_who;
  if v_who is null then return; end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), null, 'profiles', p_user::text, 'update', 'Khoá tài khoản ' || v_who, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.platform_unlock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  update profiles set locked_at = null, locked_reason = null, locked_by = null
   where id = p_user and locked_at is not null returning coalesce(full_name, email) into v_who;
  if v_who is null then return; end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary)
    values (auth.uid(), null, 'profiles', p_user::text, 'update', 'Mở khoá tài khoản ' || v_who);
end $$;

-- Không cho người dùng tự sửa trạng thái khoá qua API (chỉ qua hàm của quản trị nền tảng)
create or replace function public.guard_profile_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.locked_at, new.locked_reason, new.locked_by) is distinct from (old.locked_at, old.locked_reason, old.locked_by)
     and current_setting('role', true) = 'authenticated' and not public.is_platform_admin() then
    raise exception 'Không được đổi trạng thái khoá' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_lock on profiles;
create trigger profiles_guard_lock before update of locked_at, locked_reason, locked_by on profiles
  for each row execute function public.guard_profile_lock();

-- Tổng quan bảo mật cho quản trị nền tảng. Bảng auth.* của Supabase đọc được thì có số liệu phiên/2FA, không thì để null.
create or replace function public.platform_security_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb; v_sessions jsonb; v_factors jsonb; v_note text;
  v_roles text[] := (select mfa_roles from security_settings where id = 1);
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  begin
    if to_regclass('auth.sessions') is not null then
      execute $q$select coalesce(jsonb_agg(x order by x->>'updated_at' desc nulls last), '[]'::jsonb) from (
        select to_jsonb(s) - 'factor_id' - 'tag' || jsonb_build_object('email', p.email, 'full_name', p.full_name) as x
          from auth.sessions s left join public.profiles p on p.id = s.user_id
         order by coalesce(s.updated_at, s.created_at) desc limit 300) t$q$ into v_sessions;
    end if;
    if to_regclass('auth.mfa_factors') is not null then
      execute $q$select coalesce(jsonb_agg(distinct user_id), '[]'::jsonb) from auth.mfa_factors where status = 'verified'$q$ into v_factors;
    end if;
  exception when insufficient_privilege then
    v_note := 'Chưa đọc được dữ liệu phiên/2FA của Supabase Auth (thiếu quyền trên schema auth).';
  end;
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from security_settings s where id = 1),
    'users', (select count(*) from profiles),
    'locked', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name, 'locked_at', p.locked_at,
                 'reason', p.locked_reason, 'by', (select coalesce(full_name, email) from profiles b where b.id = p.locked_by)) order by p.locked_at desc), '[]'::jsonb)
                 from profiles p where p.locked_at is not null),
    'mfa_users', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name,
                    'roles', (select jsonb_agg(distinct r.name) from memberships m join roles r on r.id = m.role_id where m.user_id = p.id and r.key = any(v_roles)),
                    'enrolled', case when v_factors is null then null else v_factors ? p.id::text end) order by p.full_name), '[]'::jsonb)
                   from profiles p where exists (select 1 from memberships m join roles r on r.id = m.role_id where m.user_id = p.id and r.key = any(v_roles))),
    'sessions', v_sessions,
    'note', v_note) into v;
  return v;
end $$;

create or replace function public.platform_revoke_session(p_session uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  if to_regclass('auth.sessions') is null then return 'Không có bảng phiên đăng nhập.'; end if;
  begin
    execute 'delete from auth.sessions where id = $1' using p_session;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    return 'Thiếu quyền xoá phiên trên schema auth. Hãy khoá tài khoản hoặc đăng xuất người dùng trong Supabase Dashboard.';
  end;
  if n > 0 then
    insert into audit_log (actor, entity, entity_id, action, summary) values (auth.uid(), 'sessions', p_session::text, 'delete', 'Thu hồi một phiên đăng nhập');
  end if;
  return null;
end $$;

-- ===== 4. Hỗ trợ khách hàng =====
create sequence if not exists support_ticket_seq;
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  org_id uuid not null references organizations(id),
  category text not null default 'technical' check (category in ('technical','account','content','equipment','billing','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  subject text not null check (length(trim(subject)) > 0),
  description text,
  status text not null default 'new' check (status in ('new','in_progress','waiting_customer','resolved','closed')),
  reported_by uuid references profiles(id) default auth.uid(),
  assignee uuid references profiles(id),
  due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  warranty_ticket_id uuid references warranty_tickets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_org_idx on support_tickets (org_id);
create index if not exists support_tickets_status_idx on support_tickets (status);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author uuid references profiles(id) default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  internal boolean not null default false,     -- ghi chú nội bộ KDI, khách hàng không thấy
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on support_messages (ticket_id);

-- Hạn xử lý theo mức ưu tiên
create or replace function public.support_sla(p_priority text) returns interval
language sql immutable as $$
  select case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '1 day'
                         when 'normal' then interval '3 days' else interval '7 days' end
$$;

create or replace function public.support_ticket_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_platform boolean := public.is_platform_admin();
begin
  if tg_op = 'INSERT' then
    new.code := 'HT-' || lpad(nextval('support_ticket_seq')::text, 5, '0');
    new.created_at := now();
    new.due_at := now() + public.support_sla(new.priority);
    if not v_platform then new.status := 'new'; new.assignee := null; new.reported_by := auth.uid(); end if;
  else
    if not v_platform and current_setting('role', true) = 'authenticated' then
      -- Khách hàng chỉ đóng phiếu hoặc mở lại; không đổi người xử lý, mức ưu tiên, hạn, đơn vị
      if (new.org_id, new.category, new.priority, new.assignee, new.due_at, new.reported_by, new.subject, new.warranty_ticket_id, new.first_response_at)
         is distinct from (old.org_id, old.category, old.priority, old.assignee, old.due_at, old.reported_by, old.subject, old.warranty_ticket_id, old.first_response_at)
         or (new.status is distinct from old.status and new.status not in ('closed','in_progress')) then
        raise exception 'Chỉ KDI cập nhật được phiếu hỗ trợ (bạn có thể đóng hoặc mở lại phiếu)' using errcode = '42501';
      end if;
    end if;
    if new.priority is distinct from old.priority and new.status not in ('resolved','closed') then
      new.due_at := old.created_at + public.support_sla(new.priority);
    end if;
    if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then new.resolved_at := now();
    elsif new.status not in ('resolved','closed') then new.resolved_at := null; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists support_tickets_before on support_tickets;
create trigger support_tickets_before before insert or update on support_tickets for each row execute function public.support_ticket_before();

-- Thông báo trong ứng dụng: phiếu mới → quản trị nền tảng; KDI trả lời → người gửi phiếu
create or replace function public.support_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t support_tickets; v_platform_org uuid := (select id from organizations where is_platform limit 1); v_is_kdi boolean;
begin
  if tg_table_name = 'support_tickets' then
    insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
      select v_platform_org, m.user_id, 'support', 'Phiếu hỗ trợ mới ' || new.code, new.subject || ' · ' || (select name from organizations where id = new.org_id),
             'Vấn đề & phản hồi', 'platform', new.id
        from memberships m join roles r on r.id = m.role_id
       where r.key = 'platform_admin' and r.org_id is null and m.org_id = v_platform_org and m.user_id is distinct from new.reported_by;
    return null;
  end if;
  select * into t from support_tickets where id = new.ticket_id;
  v_is_kdi := exists (select 1 from memberships m join organizations o on o.id = m.org_id where m.user_id = new.author and o.is_platform);
  if v_is_kdi and not new.internal then
    update support_tickets set first_response_at = coalesce(first_response_at, now()),
           status = case when status = 'new' then 'in_progress' else status end where id = t.id;
    if t.reported_by is not null and t.reported_by <> new.author then
      insert into notifications (org_id, user_id, kind, title, body, page, ref_id)
        values (t.org_id, t.reported_by, 'support', 'KDI đã trả lời phiếu ' || t.code, left(new.body, 200), 'Hỗ trợ từ KDI', t.id);
    end if;
  elsif not v_is_kdi then
    update support_tickets set status = 'in_progress' where id = t.id and status in ('waiting_customer','resolved');
    insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
      select v_platform_org, coalesce(t.assignee, m.user_id), 'support', 'Khách hàng phản hồi phiếu ' || t.code, left(new.body, 200), 'Vấn đề & phản hồi', 'platform', t.id
        from memberships m join roles r on r.id = m.role_id
       where r.key = 'platform_admin' and r.org_id is null and m.org_id = v_platform_org
         and (t.assignee is null or m.user_id = t.assignee);
  end if;
  return null;
end $$;
drop trigger if exists support_tickets_notify on support_tickets;
create trigger support_tickets_notify after insert on support_tickets for each row execute function public.support_notify();
drop trigger if exists support_messages_notify on support_messages;
create trigger support_messages_notify after insert on support_messages for each row execute function public.support_notify();

alter table support_tickets enable row level security;
alter table support_messages enable row level security;
drop policy if exists support_tickets_read on support_tickets;
create policy support_tickets_read on support_tickets for select to authenticated
  using ((select public.is_platform_admin()) or (public.can_access_org(org_id) and public.is_staff()));
drop policy if exists support_tickets_insert on support_tickets;
create policy support_tickets_insert on support_tickets for insert to authenticated
  with check ((select public.is_platform_admin()) or (org_id = public.my_org_id() and public.is_staff()));
drop policy if exists support_tickets_update on support_tickets;
create policy support_tickets_update on support_tickets for update to authenticated
  using ((select public.is_platform_admin()) or (public.can_access_org(org_id) and public.is_staff()))
  with check ((select public.is_platform_admin()) or (public.can_access_org(org_id) and public.is_staff()));
drop policy if exists support_messages_read on support_messages;
create policy support_messages_read on support_messages for select to authenticated
  using (exists (select 1 from support_tickets t where t.id = ticket_id) and (not internal or (select public.is_platform_admin())));
drop policy if exists support_messages_insert on support_messages;
create policy support_messages_insert on support_messages for insert to authenticated
  with check (author = auth.uid() and exists (select 1 from support_tickets t where t.id = ticket_id)
              and (not internal or (select public.is_platform_admin())));

-- KDI (đơn vị cung cấp) xử lý phiếu bảo hành của mọi trường
drop policy if exists warranty_tickets_platform_update on warranty_tickets;
create policy warranty_tickets_platform_update on warranty_tickets for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- ===== 5. Nhật ký: hợp đồng, gói dịch vụ, cài đặt bảo mật =====
create or replace function public.audit_commerce() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_detail jsonb; v_sum text; v_org uuid; k text;
begin
  if tg_op = 'UPDATE' then
    v_detail := '{}'::jsonb;
    for k in select jsonb_object_keys(r) loop
      if r->k is distinct from o->k and k not in ('updated_at') then
        v_detail := v_detail || jsonb_build_object(k, jsonb_build_object('from', o->k, 'to', r->k));
      end if;
    end loop;
    if v_detail = '{}'::jsonb then return null; end if;
  else v_detail := r; end if;
  if tg_table_name = 'contracts' then
    v_org := (r->>'org_id')::uuid;
    v_sum := case tg_op when 'INSERT' then 'Tạo hợp đồng ' when 'DELETE' then 'Xoá hợp đồng ' else 'Sửa hợp đồng ' end
             || (r->>'code') || ' · ' || coalesce((select name from organizations where id = v_org), '?');
  elsif tg_table_name = 'service_plans' then
    v_sum := case tg_op when 'INSERT' then 'Tạo gói dịch vụ ' when 'DELETE' then 'Xoá gói dịch vụ ' else 'Sửa gói dịch vụ ' end || (r->>'code') || ' · ' || (r->>'name');
  else
    v_sum := 'Đổi cài đặt bảo mật';
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), v_org, tg_table_name, r->>'id', lower(tg_op), v_sum, v_detail);
  return null;
end $$;
drop trigger if exists audit_contracts on contracts;
create trigger audit_contracts after insert or update or delete on contracts for each row execute function public.audit_commerce();
drop trigger if exists audit_service_plans on service_plans;
create trigger audit_service_plans after insert or update or delete on service_plans for each row execute function public.audit_commerce();
drop trigger if exists audit_security_settings on security_settings;
create trigger audit_security_settings after update on security_settings for each row execute function public.audit_commerce();

grant execute on function public.org_entitlement(uuid), public.org_has_module(uuid, text), public.my_entitlement(),
  public.platform_entitlements(), public.jwt_aal(), public.mfa_required(), public.platform_lock_user(uuid, text),
  public.platform_unlock_user(uuid), public.platform_security_overview(), public.platform_revoke_session(uuid) to authenticated;
