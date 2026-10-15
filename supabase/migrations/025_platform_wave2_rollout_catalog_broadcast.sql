-- 025: Cổng Quản trị nền tảng — đợt 2 (vận hành khách hàng)
--  1. Triển khai khách hàng: các bước KDI đánh dấu thủ công (rollout_checks); các bước tự động tính từ dữ liệu sẵn có ở giao diện.
--  2. Danh mục gói STEM của KDI = stem_packages thuộc đơn vị chủ nền tảng (catalog_active = true).
--     Trường xem danh mục qua package_catalog(); bảng stem_packages của trường không lẫn gói danh mục.
--  3. Đơn đặt gói STEM: KDI xác nhận / giao / huỷ đơn đã duyệt; "Đã giao" tự sao chép gói (chủ đề, buổi học) vào trường.
--  4. Thông báo hàng loạt theo đơn vị, loại đơn vị, vai trò (broadcasts) + thống kê đã đọc.
--  5. Danh sách kết nối tích hợp (integrations): trạng thái, lần đồng bộ, lỗi. Không lưu khoá bí mật trong bảng.

create or replace function public.platform_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from organizations where is_platform limit 1
$$;

create or replace function public.require_platform() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
end $$;

-- ===== 1. Triển khai khách hàng =====
create table if not exists rollout_checks (
  org_id uuid not null references organizations(id) on delete cascade,
  step text not null check (step in ('kickoff','admin_training','teacher_training','handover','acceptance')),
  done_at timestamptz not null default now(),
  done_by uuid references profiles(id) default auth.uid(),
  note text,
  primary key (org_id, step)
);
alter table rollout_checks enable row level security;
drop policy if exists rollout_checks_read on rollout_checks;
create policy rollout_checks_read on rollout_checks for select to authenticated
  using ((select public.is_platform_admin()) or (public.can_access_org(org_id) and public.is_staff()));
drop policy if exists rollout_checks_platform on rollout_checks;
create policy rollout_checks_platform on rollout_checks for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- ===== 2. Danh mục gói STEM của KDI =====
alter table stem_packages add column if not exists catalog_active boolean,
  add column if not exists list_price numeric(14,0) check (list_price is null or list_price >= 0),
  add column if not exists description text,
  add column if not exists source_package_id uuid references stem_packages(id) on delete set null;
comment on column stem_packages.catalog_active is 'Chỉ dùng cho gói thuộc đơn vị chủ nền tảng (danh mục KDI): true = đang bán, false = ngừng bán. Gói của trường để null.';

-- Quản trị nền tảng quản lý gói, chủ đề, buổi học của đơn vị chủ nền tảng
do $$
declare t text;
begin
  foreach t in array array['stem_packages', 'package_topics', 'package_topic_sessions'] loop
    execute format('drop policy if exists %I on %I', t || '_platform', t);
    execute format('create policy %I on %I for all to authenticated using ((select public.is_platform_admin()) and org_id = public.platform_org_id()) with check ((select public.is_platform_admin()) and org_id = public.platform_org_id())', t || '_platform', t);
  end loop;
end $$;

-- Sao chép một gói (kèm chủ đề, buổi học) sang đơn vị khác. Nội bộ: không cấp quyền gọi trực tiếp.
create or replace function public.copy_stem_package(p_src uuid, p_org uuid, p_catalog boolean default null, p_order_no text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new uuid; t record; v_topic uuid;
begin
  insert into stem_packages (org_id, code, name, tier, provider, programs, grades, starts_on, ends_on, contract_no, order_no, topics, devices, sessions,
                             catalog_active, list_price, description, source_package_id)
    select p_org, code, name, tier, coalesce(provider, 'KDI Education'), programs, grades,
           case when p_catalog is null then current_date else starts_on end, case when p_catalog is null then null else ends_on end,
           contract_no, coalesce(p_order_no, order_no), topics, devices, sessions,
           p_catalog, case when p_catalog is null then null else list_price end, description, p_src
      from stem_packages where id = p_src
    returning id into v_new;
  if v_new is null then raise exception 'Không tìm thấy gói nguồn' using errcode = 'P0002'; end if;
  for t in select * from package_topics where package_id = p_src order by seq loop
    insert into package_topics (org_id, package_id, seq, program, title, minutes, grade_assigned)
      values (p_org, v_new, t.seq, t.program, t.title, t.minutes, case when p_catalog is null then null else t.grade_assigned end)
      returning id into v_topic;
    insert into package_topic_sessions (org_id, topic_id, seq, title, minutes)
      select p_org, v_topic, seq, title, minutes from package_topic_sessions where topic_id = t.id;
  end loop;
  return v_new;
end $$;
revoke all on function public.copy_stem_package(uuid, uuid, boolean, text) from public, anon, authenticated;

-- Danh mục cho trường/Sở chọn khi đặt gói
create or replace function public.package_catalog() returns table (
  id uuid, code text, name text, tier text, programs text, grades text, topics int, devices int, sessions int, list_price numeric, description text)
language sql stable security definer set search_path = public as $$
  select p.id, p.code, p.name, p.tier, p.programs, p.grades, p.topics, p.devices, p.sessions, p.list_price, p.description
    from stem_packages p
   where p.org_id = public.platform_org_id() and p.catalog_active and public.is_staff()
   order by p.name
$$;

-- Dữ liệu mẫu: danh mục KDI lấy từ các gói mẫu đang có (chỉ khi danh mục trống)
do $$
declare s record; v_kdi uuid := public.platform_org_id();
begin
  if v_kdi is null or exists (select 1 from stem_packages where org_id = v_kdi) then return; end if;
  for s in select distinct on (code) id from stem_packages where code like 'GOI-%' and org_id <> v_kdi order by code loop
    perform public.copy_stem_package(s.id, v_kdi, true);
  end loop;
  update stem_packages set source_package_id = null where org_id = v_kdi;
  -- số chủ đề / buổi theo nội dung thật (gói mẫu có thể chỉ ghi số mà chưa có chủ đề)
  update stem_packages p set topics = (select count(*) from package_topics y where y.package_id = p.id),
         sessions = (select count(*) from package_topic_sessions x join package_topics y on y.id = x.topic_id where y.package_id = p.id)
   where p.org_id = v_kdi;
end $$;

-- ===== 3. Đơn đặt gói STEM: KDI xử lý =====
alter table package_orders add column if not exists catalog_package_id uuid references stem_packages(id) on delete set null,
  add column if not exists fulfillment text,
  add column if not exists kdi_note text,
  add column if not exists quoted_value numeric(14,0) check (quoted_value is null or quoted_value >= 0),
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_package_id uuid references stem_packages(id) on delete set null;
alter table package_orders drop constraint if exists package_orders_fulfillment_check;
alter table package_orders add constraint package_orders_fulfillment_check
  check (fulfillment is null or fulfillment in ('confirmed','delivering','delivered','cancelled'));

-- Trường không tự sửa phần xử lý của KDI
create or replace function public.guard_order_fulfillment() returns trigger
language plpgsql security definer set search_path = public as $$   -- definer: đọc được danh mục KDI để kiểm tra
begin
  if current_setting('role', true) <> 'authenticated' or public.is_platform_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.fulfillment := null; new.kdi_note := null; new.quoted_value := null; new.delivered_at := null; new.delivered_package_id := null;
  elsif (new.fulfillment, new.kdi_note, new.quoted_value, new.delivered_at, new.delivered_package_id)
        is distinct from (old.fulfillment, old.kdi_note, old.quoted_value, old.delivered_at, old.delivered_package_id) then
    raise exception 'Chỉ KDI cập nhật được phần xử lý đơn' using errcode = '42501';
  end if;
  if new.catalog_package_id is not null
     and (tg_op = 'INSERT' or new.catalog_package_id is distinct from old.catalog_package_id)
     and not exists (select 1 from stem_packages where id = new.catalog_package_id and org_id = public.platform_org_id() and catalog_active) then
    raise exception 'Gói không có trong danh mục đang bán' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists package_orders_guard_fulfillment on package_orders;
create trigger package_orders_guard_fulfillment before insert or update on package_orders
  for each row execute function public.guard_order_fulfillment();

create or replace function public.platform_fulfill_order(p_order uuid, p_fulfillment text, p_catalog uuid default null,
  p_note text default null, p_value numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o package_orders; v_cat uuid; v_pkg uuid; v_label text;
begin
  perform public.require_platform();
  select * into o from package_orders where id = p_order for update;
  if o.id is null then raise exception 'Không tìm thấy đơn' using errcode = 'P0002'; end if;
  if p_fulfillment not in ('confirmed','delivering','delivered','cancelled') then raise exception 'Trạng thái không hợp lệ' using errcode = '23514'; end if;
  if o.status <> 'approved' and p_fulfillment <> 'cancelled' then raise exception 'Đơn chưa được duyệt theo quy trình của khách hàng' using errcode = '23514'; end if;
  if o.delivered_package_id is not null and p_fulfillment <> 'delivered' then raise exception 'Đơn đã giao, không đổi trạng thái được' using errcode = '23514'; end if;
  v_cat := coalesce(p_catalog, o.catalog_package_id);
  if v_cat is not null and not exists (select 1 from stem_packages where id = v_cat and org_id = public.platform_org_id()) then
    raise exception 'Gói không thuộc danh mục KDI' using errcode = '23514';
  end if;
  v_pkg := o.delivered_package_id;
  if p_fulfillment = 'delivered' and v_pkg is null then
    if v_cat is null then raise exception 'Chọn gói trong danh mục để giao' using errcode = '23514'; end if;
    v_pkg := public.copy_stem_package(v_cat, o.org_id, null, 'DH-' || left(o.id::text, 8));
  end if;
  update package_orders set fulfillment = p_fulfillment, catalog_package_id = v_cat,
         kdi_note = coalesce(nullif(trim(p_note), ''), kdi_note), quoted_value = coalesce(p_value, quoted_value),
         delivered_at = case when p_fulfillment = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         delivered_package_id = v_pkg
   where id = o.id;
  v_label := case p_fulfillment when 'confirmed' then 'KDI đã xác nhận' when 'delivering' then 'KDI đang giao' when 'delivered' then 'KDI đã giao gói' else 'KDI huỷ đơn' end;
  if o.created_by is not null then
    insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
      values (o.org_id, o.created_by, 'package_order', v_label || ': ' || o.name, nullif(trim(p_note), ''),
              case when p_fulfillment = 'delivered' then 'Gói STEM' else 'Đề xuất mua gói' end, 'school_admin', o.id);
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), o.org_id, 'package_orders', o.id::text, 'update',
            v_label || ': ' || o.name || ' · ' || coalesce((select name from organizations where id = o.org_id), '?'),
            jsonb_build_object('fulfillment', p_fulfillment, 'catalog_package_id', v_cat, 'delivered_package_id', v_pkg));
  return v_pkg;
end $$;

-- ===== 4. Thông báo hàng loạt =====
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text,
  page text,
  target jsonb not null default '{}'::jsonb,
  recipients int not null default 0,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table broadcasts enable row level security;
drop policy if exists broadcasts_platform_read on broadcasts;
create policy broadcasts_platform_read on broadcasts for select to authenticated using ((select public.is_platform_admin()));

-- Người nhận: thành viên của các đơn vị chọn (kèm cấp dưới), lọc theo loại đơn vị và vai trò; bỏ tài khoản bị khoá và đơn vị tạm dừng
create or replace function public.broadcast_targets(p_org_ids uuid[], p_org_types text[], p_role_keys text[])
returns table (user_id uuid, org_id uuid)
language sql stable security definer set search_path = public as $$
  with recursive sub as (
    select o.id from organizations o where p_org_ids is null or o.id = any(p_org_ids)
    union
    select o.id from organizations o join sub s on o.parent_id = s.id where p_org_ids is not null
  )
  select distinct m.user_id, m.org_id
    from memberships m
    join organizations o on o.id = m.org_id
    join roles r on r.id = m.role_id
    join profiles p on p.id = m.user_id
   where m.org_id in (select id from sub)
     and (p_org_types is null or cardinality(p_org_types) = 0 or o.type = any(p_org_types))
     and (p_role_keys is null or cardinality(p_role_keys) = 0 or r.key = any(p_role_keys))
     and (o.status = 'active' or o.is_platform) and p.locked_at is null
$$;
revoke all on function public.broadcast_targets(uuid[], text[], text[]) from public, anon, authenticated;

create or replace function public.platform_broadcast_preview(p_org_ids uuid[] default null, p_org_types text[] default null, p_role_keys text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_platform();
  return (select jsonb_build_object('users', count(distinct user_id), 'orgs', count(distinct org_id)) from public.broadcast_targets(p_org_ids, p_org_types, p_role_keys));
end $$;

create or replace function public.platform_broadcast(p_title text, p_body text default null, p_page text default null,
  p_org_ids uuid[] default null, p_org_types text[] default null, p_role_keys text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  perform public.require_platform();
  if coalesce(trim(p_title), '') = '' then raise exception 'Nhập tiêu đề thông báo' using errcode = '23514'; end if;
  insert into broadcasts (title, body, page, target)
    values (trim(p_title), nullif(trim(p_body), ''), nullif(trim(p_page), ''),
            jsonb_build_object('org_ids', p_org_ids, 'org_types', p_org_types, 'role_keys', p_role_keys))
    returning id into v_id;
  insert into notifications (org_id, user_id, kind, title, body, page, ref_id)
    select t.org_id, t.user_id, 'broadcast', trim(p_title), nullif(trim(p_body), ''), nullif(trim(p_page), ''), v_id
      from public.broadcast_targets(p_org_ids, p_org_types, p_role_keys) t;
  select count(distinct user_id) into v_n from notifications where ref_id = v_id and kind = 'broadcast';
  update broadcasts set recipients = v_n where id = v_id;
  insert into audit_log (actor, entity, entity_id, action, summary, detail)
    values (auth.uid(), 'broadcasts', v_id::text, 'insert', 'Gửi thông báo "' || trim(p_title) || '" tới ' || v_n || ' người',
            jsonb_build_object('org_ids', p_org_ids, 'org_types', p_org_types, 'role_keys', p_role_keys));
  return jsonb_build_object('id', v_id, 'recipients', v_n);
end $$;

create or replace function public.platform_broadcasts() returns table (
  id uuid, title text, body text, page text, target jsonb, recipients int, reads bigint, created_at timestamptz, created_by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_platform();
  return query select b.id, b.title, b.body, b.page, b.target, b.recipients,
      (select count(distinct n.user_id) from notifications n where n.ref_id = b.id and n.kind = 'broadcast' and n.read_at is not null),
      b.created_at, (select coalesce(p.full_name, p.email) from profiles p where p.id = b.created_by)
    from broadcasts b order by b.created_at desc limit 200;
end $$;

-- ===== 5. Kết nối tích hợp =====
create table if not exists integrations (
  key text primary key,
  name text not null,
  purpose text,
  direction text,
  status text not null default 'not_configured' check (status in ('not_configured','active','error','paused')),
  endpoint text,           -- địa chỉ API (không lưu khoá bí mật ở đây; khoá đặt trong Supabase secrets)
  owner text,              -- đơn vị/người phụ trách phía đối tác
  note text,
  last_sync_at timestamptz,
  last_error text,
  records int,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);
insert into integrations (key, name, purpose, direction, status, note) values
  ('k12', 'CSDL ngành giáo dục (K12Online)', 'Đồng bộ giáo viên, học sinh, lớp', 'Nhận vào', 'not_configured', 'Chưa có địa chỉ API và khoá truy cập từ đơn vị quản lý K12Online. Hiện các trường nhập thủ công hoặc từ Excel.'),
  ('vneid', 'Định danh điện tử VNeID', 'Đăng nhập bằng VNeID', 'Đăng nhập', 'not_configured', 'Cần đăng ký tích hợp với Bộ Công an.'),
  ('email', 'Email đăng nhập & lời mời (Supabase Auth)', 'Gửi email xác nhận, mời, đặt lại mật khẩu', 'Gửi đi', 'active', 'Máy chủ email mặc định của Supabase giới hạn vài thư mỗi giờ; nên cấu hình SMTP riêng.'),
  ('zalo', 'Zalo OA', 'Gửi thông báo cho phụ huynh, giáo viên', 'Gửi đi', 'not_configured', null),
  ('excel', 'Nhập / xuất Excel', 'Nhập giáo viên, học sinh, thời khoá biểu; xuất báo cáo', 'Hai chiều', 'active', 'Chạy trong trình duyệt, không cần cấu hình.')
on conflict (key) do nothing;
alter table integrations enable row level security;
drop policy if exists integrations_platform on integrations;
create policy integrations_platform on integrations for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- ===== Nhật ký =====
create or replace function public.audit_wave2() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end; v_sum text; v_org uuid;
begin
  if tg_table_name = 'rollout_checks' then
    v_org := (r->>'org_id')::uuid;
    v_sum := case when tg_op = 'DELETE' then 'Bỏ đánh dấu bước triển khai ' else 'Đánh dấu bước triển khai ' end || (r->>'step')
             || ' · ' || coalesce((select name from organizations where id = v_org), '?');
  elsif tg_table_name = 'integrations' then
    v_sum := 'Cập nhật kết nối ' || (r->>'name') || ' → ' || (r->>'status');
  else
    v_org := (r->>'org_id')::uuid;
    v_sum := case tg_op when 'INSERT' then 'Thêm gói vào danh mục ' when 'DELETE' then 'Xoá gói khỏi danh mục ' else 'Sửa gói danh mục ' end || (r->>'name');
    if v_org is distinct from public.platform_org_id() then return null; end if;
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), v_org, tg_table_name, coalesce(r->>'id', (r->>'org_id') || '/' || (r->>'step'), r->>'key'), lower(tg_op), v_sum, r);
  return null;
end $$;
drop trigger if exists audit_rollout_checks on rollout_checks;
create trigger audit_rollout_checks after insert or update or delete on rollout_checks for each row execute function public.audit_wave2();
drop trigger if exists audit_integrations on integrations;
create trigger audit_integrations after update on integrations for each row execute function public.audit_wave2();
drop trigger if exists audit_catalog_packages on stem_packages;
create trigger audit_catalog_packages after insert or update or delete on stem_packages for each row
  when (current_setting('role', true) = 'authenticated') execute function public.audit_wave2();

grant execute on function public.platform_org_id(), public.package_catalog(), public.platform_fulfill_order(uuid, text, uuid, text, numeric),
  public.platform_broadcast_preview(uuid[], text[], text[]), public.platform_broadcast(text, text, text, uuid[], text[], text[]),
  public.platform_broadcasts() to authenticated;
