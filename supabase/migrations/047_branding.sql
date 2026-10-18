-- 047: S5 — Giao diện & thương hiệu theo khách hàng (white-label).
--   org_branding: tên hệ thống, logo (sáng / tối), màu chủ đạo, màu thanh menu, màu nhấn, lời chào trang đăng nhập,
--   thông tin hỗ trợ, tên miền riêng. Áp cho chính đơn vị và (tuỳ chọn) mọi đơn vị trực thuộc — Sở đặt một lần,
--   các trường trong tỉnh thấy cùng giao diện. Đơn vị gần nhất có thương hiệu thắng.
--   KDI (quản trị nền tảng) quản lý tất cả; đơn vị khách hàng tự sửa được khi KDI bật "self_edit"
--   (không tự đổi tên miền / quyền tự sửa).
--   my_branding(): thương hiệu hiệu lực của đơn vị đang làm việc. login_branding(host): cho trang đăng nhập (chưa đăng nhập)
--   theo tên miền — chỉ trả thông tin công khai.

create table if not exists org_branding (
  org_id uuid primary key references organizations(id) on delete cascade,
  display_name text check (display_name is null or length(display_name) between 2 and 80),
  short_name text check (short_name is null or length(short_name) <= 30),
  logo text check (logo is null or (logo ~ '^data:image/(png|jpeg|webp|svg\+xml);base64,' and length(logo) <= 300000)),
  logo_dark text check (logo_dark is null or (logo_dark ~ '^data:image/(png|jpeg|webp|svg\+xml);base64,' and length(logo_dark) <= 300000)),
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  sidebar_color text check (sidebar_color is null or sidebar_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  login_message text check (login_message is null or length(login_message) <= 500),
  support_text text check (support_text is null or length(support_text) <= 300),
  domains text[] not null default '{}',
  applies_to_children boolean not null default true,
  self_edit boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid()
);
create index if not exists org_branding_domains on org_branding using gin (domains);

-- Quản trị đơn vị: trường = Ban giám hiệu / quản trị; Sở, Phòng, Tỉnh = nhân sự của đơn vị
create or replace function public.is_org_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and (select type from organizations where id = public.my_org_id()) <> 'school')
$$;
grant execute on function public.is_org_admin() to authenticated;

create or replace function public.guard_org_branding() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.domains := array(select distinct lower(btrim(d)) from unnest(coalesce(new.domains, '{}')) d where btrim(d) <> '' order by 1);
  if exists (select 1 from unnest(new.domains) d where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
    raise exception 'Tên miền không hợp lệ' using errcode = '23514';
  end if;
  if exists (select 1 from org_branding b where b.org_id <> new.org_id and b.domains && new.domains) then
    raise exception 'Tên miền đã gắn với đơn vị khác' using errcode = '23505';
  end if;
  if not public.is_platform_admin() and auth.uid() is not null then
    -- đơn vị tự sửa: không đổi quyền tự sửa, tên miền, phạm vi áp dụng
    if tg_op = 'INSERT' then raise exception 'Chỉ KDI tạo thương hiệu cho đơn vị' using errcode = '42501'; end if;
    if new.self_edit is distinct from old.self_edit or new.domains is distinct from old.domains or new.org_id <> old.org_id then
      raise exception 'Tên miền và quyền tự sửa do KDI quản lý' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists org_branding_guard on org_branding;
create trigger org_branding_guard before insert or update on org_branding for each row execute function public.guard_org_branding();

alter table org_branding enable row level security;
drop policy if exists org_branding_read on org_branding;
create policy org_branding_read on org_branding for select to authenticated
  using ((select public.is_platform_admin()) or (public.can_access_org(org_id) and public.is_staff()));
drop policy if exists org_branding_platform on org_branding;
create policy org_branding_platform on org_branding for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
drop policy if exists org_branding_self on org_branding;
create policy org_branding_self on org_branding for update to authenticated
  using (org_id = public.my_org_id() and self_edit and public.is_org_admin())
  with check (org_id = public.my_org_id() and public.is_org_admin());
grant select, insert, update, delete on org_branding to authenticated;

-- Thương hiệu hiệu lực của một đơn vị (đơn vị gần nhất: chính nó, hoặc cấp trên có "áp dụng cho đơn vị trực thuộc")
create or replace function public.branding_of(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, 0 as d from organizations where id = p_org
    union all
    select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  )
  select jsonb_build_object('org_id', b.org_id, 'source', (select name from organizations where id = b.org_id), 'inherited', up.d > 0,
           'display_name', b.display_name, 'short_name', b.short_name, 'logo', b.logo, 'logo_dark', b.logo_dark,
           'primary_color', b.primary_color, 'sidebar_color', b.sidebar_color, 'accent_color', b.accent_color,
           'login_message', b.login_message, 'support_text', b.support_text, 'self_edit', b.self_edit and up.d = 0)
    from up join org_branding b on b.org_id = up.id
   where up.d = 0 or b.applies_to_children
   order by up.d limit 1
$$;
revoke all on function public.branding_of(uuid) from public, anon, authenticated;

create or replace function public.my_branding() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else public.branding_of(public.my_org_id()) end
$$;
grant execute on function public.my_branding() to authenticated;

-- Trang đăng nhập: chỉ thông tin công khai, theo tên miền đang mở
create or replace function public.login_branding(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('display_name', b.display_name, 'short_name', b.short_name, 'logo', b.logo,
           'primary_color', b.primary_color, 'sidebar_color', b.sidebar_color, 'accent_color', b.accent_color,
           'login_message', b.login_message, 'support_text', b.support_text)
    from org_branding b where lower(btrim(coalesce(p_host, ''))) = any(b.domains) limit 1
$$;
grant execute on function public.login_branding(text) to anon, authenticated;

notify pgrst, 'reload schema';
