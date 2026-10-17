-- 040: Điều hành của Sở/Phòng — giao chỉ tiêu STEM theo năm học và cảnh báo trường cần chú ý.
--   • dept_targets: Sở/Phòng giao chỉ tiêu (% bao phủ STEM, GV tập huấn, HS học STEM, phòng STEM hoạt động, chuyên cần,
--     % trường đạt Mức 3) cho toàn bộ trường trực thuộc hoặc theo cấp học. Trường đọc được chỉ tiêu của cấp trên.
--     Tiến độ tính ở giao diện từ dept_school_stats (018).
--   • Cảnh báo tính ở giao diện theo quy tắc (chưa kích hoạt, chưa triển khai STEM, GV tập huấn thấp, phòng STEM không dùng,
--     chuyên cần thấp, không hoạt động 14 ngày, chưa có năm học, dưới chỉ tiêu). Sở ghi nhận xử lý ở dept_alert_actions
--     và gửi nhắc tới quản trị trường bằng dept_notify_school (thông báo trong ứng dụng).

create table if not exists dept_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,    -- đơn vị giao (Sở/Phòng/Tỉnh)
  school_year text not null check (school_year ~ '^\d{4}-\d{4}$'),
  metric text not null check (metric in ('stem_coverage', 'teacher_trained', 'stem_students', 'rooms_active', 'attendance', 'level3')),
  level text check (level in ('mamnon', 'tieuhoc', 'thcs', 'thpt')),      -- null = mọi cấp học
  target numeric(5,1) not null check (target between 0 and 100),
  due_on date,
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists dept_targets_one on dept_targets (org_id, school_year, metric, coalesce(level, ''));
alter table dept_targets enable row level security;
drop policy if exists dept_targets_read on dept_targets;
create policy dept_targets_read on dept_targets for select to authenticated using (
  (select public.is_platform_admin())
  or org_id in (select public.my_ancestor_orgs())                                   -- trường / Phòng xem chỉ tiêu cấp trên giao
  or ((select public.is_authority()) and org_id in (select public.my_org_tree())));
drop policy if exists dept_targets_write on dept_targets;
create policy dept_targets_write on dept_targets for all to authenticated
  using ((select public.is_authority()) and org_id = (select public.my_org_id()))
  with check ((select public.is_authority()) and org_id = (select public.my_org_id()));
drop trigger if exists dept_targets_touch on dept_targets;
create trigger dept_targets_touch before update on dept_targets for each row execute function public.touch_updated_at();

create table if not exists dept_alert_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,     -- Sở/Phòng ghi nhận
  school_id uuid not null references organizations(id) on delete cascade,
  rule text not null,
  status text not null check (status in ('acknowledged', 'resolved', 'notified')),
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists dept_alert_actions_school on dept_alert_actions (school_id, created_at desc);
alter table dept_alert_actions enable row level security;
drop policy if exists dept_alert_actions_read on dept_alert_actions;
create policy dept_alert_actions_read on dept_alert_actions for select to authenticated using (
  (select public.is_platform_admin()) or ((select public.is_authority()) and school_id in (select public.my_org_tree())));
drop policy if exists dept_alert_actions_insert on dept_alert_actions;
create policy dept_alert_actions_insert on dept_alert_actions for insert to authenticated with check (
  (select public.is_authority()) and org_id = (select public.my_org_id()) and school_id in (select public.my_org_tree())
  and exists (select 1 from organizations o where o.id = school_id and o.type = 'school'));

-- Gửi nhắc tới quản trị trường (Hiệu trưởng, QTV) của một trường trực thuộc. Trả về số người nhận.
create or replace function public.dept_notify_school(p_school uuid, p_title text, p_body text, p_rule text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_from text;
begin
  if not public.is_authority() or p_school not in (select public.my_org_tree())
     or (select type from organizations where id = p_school) is distinct from 'school' then
    raise exception 'Chỉ gửi được cho trường trực thuộc' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'Thiếu nội dung' using errcode = '22023'; end if;
  select name into v_from from organizations where id = public.my_org_id();
  insert into notifications (org_id, user_id, kind, title, body, page, portal)
    select distinct p_school, m.user_id, 'status', left(btrim(p_title), 200), left(coalesce(v_from || ': ', '') || coalesce(p_body, ''), 1000), 'Dashboard Trường', 'school_admin'
      from memberships m join roles r on r.id = m.role_id
     where m.org_id = p_school and r.key in ('principal', 'it_admin');
  get diagnostics n = row_count;
  insert into dept_alert_actions (org_id, school_id, rule, status, note)
    values (public.my_org_id(), p_school, coalesce(p_rule, 'nhắc'), 'notified', left(btrim(p_title), 200));
  return n;
end $$;
revoke all on function public.dept_notify_school(uuid, text, text, text) from public, anon;
grant execute on function public.dept_notify_school(uuid, text, text, text) to authenticated;
