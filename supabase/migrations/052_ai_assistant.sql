-- 052: Trợ lý AI — cấu hình, hạn mức và nhật ký sử dụng.
-- Lời gọi mô hình chạy trong hàm máy chủ ai-assistant (khoá API là secret ANTHROPIC_API_KEY của Supabase, không nằm trong CSDL).
-- Hệ thống KHÔNG lưu nội dung câu hỏi / câu trả lời — chỉ lưu tác vụ, số token, kết quả (để tính hạn mức và chi phí).
-- Học sinh, phụ huynh, giám khảo không dùng trợ lý (mặc định chỉ GV, quản trị trường, Sở, KDI).

create table if not exists ai_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  model text not null default 'claude-sonnet-5-5' check (model ~ '^claude-[a-z0-9.-]+$'),
  org_monthly_quota int not null default 300 check (org_monthly_quota between 0 and 100000),
  user_daily_quota int not null default 30 check (user_daily_quota between 0 and 1000),
  portals text[] not null default '{teacher,school_admin,department,platform}'
    check (portals <@ array['teacher','school_admin','department','platform']),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);
insert into ai_settings (id) values (1) on conflict do nothing;

-- Hạn mức riêng theo đơn vị (gói dịch vụ / hợp đồng): ghi đè hạn mức chung, hoặc tắt trợ lý cho đơn vị đó
create table if not exists ai_org_limits (
  org_id uuid primary key references organizations(id) on delete cascade,
  enabled boolean not null default true,
  monthly_quota int check (monthly_quota between 0 and 100000),
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  task text not null check (task in ('lesson','quiz','comment','document','chat')),
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_org_time on ai_usage (org_id, created_at);
create index if not exists ai_usage_user_time on ai_usage (user_id, created_at);

alter table ai_settings enable row level security;
alter table ai_org_limits enable row level security;
alter table ai_usage enable row level security;

drop policy if exists ai_settings_read on ai_settings;
create policy ai_settings_read on ai_settings for select to authenticated using (true);
drop policy if exists ai_settings_write on ai_settings;
create policy ai_settings_write on ai_settings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists ai_org_limits_read on ai_org_limits;
create policy ai_org_limits_read on ai_org_limits for select to authenticated using (public.can_access_org(org_id) or public.is_platform_admin());
drop policy if exists ai_org_limits_write on ai_org_limits;
create policy ai_org_limits_write on ai_org_limits for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Nhật ký: người dùng xem dòng của mình; quản trị đơn vị xem dòng của đơn vị trong cây; KDI xem tất cả. Không ai ghi qua API
-- (hàm máy chủ ghi bằng khoá service_role).
drop policy if exists ai_usage_read on ai_usage;
create policy ai_usage_read on ai_usage for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin() or (public.is_org_admin() and public.can_access_org(org_id)));

grant select on ai_settings, ai_org_limits, ai_usage to authenticated;
grant update on ai_settings to authenticated;
grant insert, update, delete on ai_org_limits to authenticated;

create or replace function public.touch_ai_settings() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); new.id := 1; return new; end $$;
drop trigger if exists ai_settings_touch on ai_settings;
create trigger ai_settings_touch before update on ai_settings for each row execute function public.touch_ai_settings();

-- Giao diện (cổng) của người dùng tại đơn vị đang làm việc
create or replace function public.my_portals() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r.portal) filter (where r.portal is not null), '{}')
    from memberships m join roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.org_id = public.my_org_id()
$$;

-- Trạng thái trợ lý cho người đang đăng nhập (giao diện dùng để hiện / ẩn và báo hạn mức)
create or replace function public.ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s ai_settings; l ai_org_limits; v_org uuid := public.my_org_id(); v_quota int; v_used_org int; v_used_me int; v_allowed boolean;
begin
  select * into s from ai_settings where id = 1;
  select * into l from ai_org_limits where org_id = v_org;
  v_quota := coalesce(l.monthly_quota, s.org_monthly_quota);
  select count(*) into v_used_org from ai_usage where org_id = v_org and ok and created_at >= date_trunc('month', now());
  select count(*) into v_used_me from ai_usage where user_id = auth.uid() and ok and created_at >= date_trunc('day', now());
  v_allowed := public.is_platform_admin() or public.my_portals() && s.portals;
  return jsonb_build_object(
    'enabled', s.enabled and coalesce(l.enabled, true), 'allowed', v_allowed, 'model', s.model,
    'org_quota', v_quota, 'org_used', v_used_org, 'user_quota', s.user_daily_quota, 'user_used', v_used_me,
    'reason', case when not s.enabled then 'Trợ lý AI chưa được KDI bật.'
                   when not coalesce(l.enabled, true) then 'Trợ lý AI đang tắt cho đơn vị của bạn.'
                   when not v_allowed then 'Vai trò của bạn không dùng trợ lý AI.'
                   when v_used_org >= v_quota then 'Đơn vị đã dùng hết lượt của tháng này.'
                   when v_used_me >= s.user_daily_quota then 'Bạn đã dùng hết lượt hôm nay.'
              end);
end $$;

-- Hàm máy chủ gọi bằng JWT của người dùng trước khi gọi mô hình: kiểm tra quyền và hạn mức.
create or replace function public.ai_begin(p_task text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st jsonb;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập' using errcode = '42501'; end if;
  if p_task is null or p_task not in ('lesson','quiz','comment','document','chat') then raise exception 'Tác vụ không hợp lệ' using errcode = '22023'; end if;
  st := public.ai_status();
  if st ->> 'reason' is not null then
    raise exception '%', st ->> 'reason' using errcode = case when (st ->> 'allowed')::boolean then 'P0001' else '42501' end;
  end if;
  return st || jsonb_build_object('org_id', public.my_org_id(), 'user_id', auth.uid());
end $$;

revoke all on function public.ai_status(), public.ai_begin(text), public.my_portals() from public, anon;
grant execute on function public.ai_status(), public.ai_begin(text), public.my_portals() to authenticated;
