-- 095. Thiết lập chung: năm học & ngày nghỉ chuẩn chung, quy tắc vận hành (theo video 26/10)
--  • Lịch "chuẩn chung" (toàn hệ thống) = năm học và ngày nghỉ khai báo ở đơn vị nền tảng KDI.
--    Mọi trường đọc được; quản trị nền tảng sửa.
--  • Ngày nghỉ thêm: loại (lễ nhà nước, Tết, nghỉ giữa kỳ, của trường, khác), trạng thái (chính thức / dự kiến), nguồn.
--    Năm học thêm trạng thái và nguồn (vd QĐ 2308/QĐ-BGDĐT).
--  • Trường dùng lịch chuẩn chung, có thể: khai báo năm học riêng (ghi đè ngày), thêm ngày nghỉ riêng,
--    bỏ ngày nghỉ chuẩn chung không áp dụng (holiday_skips).
--  • is_holiday() (sinh buổi dạy, 035) và curriculum_calendar() (lịch tuần PPCT, 072) tính cả ngày nghỉ chuẩn chung
--    trừ ngày trường đã bỏ; trường chưa có năm học riêng thì lấy ngày của năm học chuẩn chung.
--  • org_settings: quy tắc vận hành (mặc định của KDI, trường ghi đè). "Cho phép sửa điểm danh trong N ngày"
--    áp vào mark_teaching_session (trước cố định 7 ngày).
-- Cần chạy sau 094.

-- ===== 1. Cột mới =====
alter table school_holidays add column if not exists kind text not null default 'other',
  add column if not exists status text not null default 'official',
  add column if not exists source text;
alter table school_holidays drop constraint if exists school_holidays_kind_check;
alter table school_holidays add constraint school_holidays_kind_check check (kind in ('state', 'tet', 'break', 'school', 'other'));
alter table school_holidays drop constraint if exists school_holidays_status_check;
alter table school_holidays add constraint school_holidays_status_check check (status in ('official', 'expected'));
alter table school_holidays drop constraint if exists school_holidays_source_check;
alter table school_holidays add constraint school_holidays_source_check check (source is null or length(source) <= 300);

alter table academic_years add column if not exists status text not null default 'official',
  add column if not exists source text;
alter table academic_years drop constraint if exists academic_years_status_check;
alter table academic_years add constraint academic_years_status_check check (status in ('official', 'expected'));
alter table academic_years drop constraint if exists academic_years_source_check;
alter table academic_years add constraint academic_years_source_check check (source is null or length(source) <= 300);

-- ===== 2. Lịch chuẩn chung: mọi người đăng nhập đọc, quản trị nền tảng ghi =====
drop policy if exists academic_years_std_read on academic_years;
create policy academic_years_std_read on academic_years for select to authenticated using (public.is_platform_org(org_id));
drop policy if exists academic_years_platform_write on academic_years;
create policy academic_years_platform_write on academic_years for all to authenticated
  using (org_id = public.my_org_id() and public.is_platform_admin())
  with check (org_id = public.my_org_id() and public.is_platform_admin());

drop policy if exists school_holidays_std_read on school_holidays;
create policy school_holidays_std_read on school_holidays for select to authenticated using (public.is_platform_org(org_id));
drop policy if exists school_holidays_platform_write on school_holidays;
create policy school_holidays_platform_write on school_holidays for all to authenticated
  using (org_id = public.my_org_id() and public.is_platform_admin())
  with check (org_id = public.my_org_id() and public.is_platform_admin());

-- ===== 3. Trường bỏ ngày nghỉ chuẩn chung =====
create table if not exists holiday_skips (
  org_id     uuid not null references organizations(id) on delete cascade,
  holiday_id uuid not null references school_holidays(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (org_id, holiday_id)
);
alter table holiday_skips enable row level security;
drop policy if exists holiday_skips_read on holiday_skips;
create policy holiday_skips_read on holiday_skips for select to authenticated
  using (org_id in (select public.my_org_tree()) or public.is_platform_admin());
drop policy if exists holiday_skips_insert on holiday_skips;
create policy holiday_skips_insert on holiday_skips for insert to authenticated
  with check (org_id = public.my_org_id() and ((select public.has_perm('periods', 'edit')) or (select public.is_authority()))
              and exists (select 1 from school_holidays h where h.id = holiday_id and public.is_platform_org(h.org_id)));
drop policy if exists holiday_skips_delete on holiday_skips;
create policy holiday_skips_delete on holiday_skips for delete to authenticated
  using (org_id = public.my_org_id() and ((select public.has_perm('periods', 'edit')) or (select public.is_authority())));

-- Bỏ / dùng lại ngày nghỉ chuẩn chung → đồng bộ buổi dạy của trường trong khoảng đó (như 035)
create or replace function public.holiday_skip_resync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_today date := public.vn_today(); h school_holidays; v_org uuid := coalesce(new.org_id, old.org_id);
begin
  select * into h from school_holidays where id = coalesce(new.holiday_id, old.holiday_id);
  if h.id is null or (select type from organizations where id = v_org) is distinct from 'school'
     or not public.org_has_module(v_org, 'timetable') then return null; end if;
  if least(h.ends_on, v_today + 62) >= greatest(h.starts_on, v_today) then
    begin
      perform public.sync_teaching_sessions(v_org, greatest(h.starts_on, v_today), least(h.ends_on, v_today + 62));
    exception when others then raise warning 'Ngày nghỉ: không đồng bộ được buổi dạy: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists holiday_skips_resync on holiday_skips;
create trigger holiday_skips_resync after insert or delete on holiday_skips for each row execute function public.holiday_skip_resync();

-- ===== 4. Ngày nghỉ hiệu lực của một đơn vị =====
-- Của đơn vị + các cấp trên + chuẩn chung (trừ ngày đơn vị đã bỏ). d: 0 = của đơn vị, 1.. = cấp trên, 100 = chuẩn chung.
create or replace function public.org_holiday_set(p_org uuid)
returns table (id uuid, org_id uuid, name text, starts_on date, ends_on date, note text, kind text, status text, source text,
               d int, std boolean, skipped boolean)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select o.id, o.parent_id, 0 as d from organizations o where o.id = p_org
    union all select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  )
  select h.id, h.org_id, h.name, h.starts_on, h.ends_on, h.note, h.kind, h.status, h.source, up.d,
         coalesce(o.is_platform, false), false
    from school_holidays h join up on up.id = h.org_id join organizations o on o.id = h.org_id
  union all
  select h.id, h.org_id, h.name, h.starts_on, h.ends_on, h.note, h.kind, h.status, h.source, 100, true,
         exists (select 1 from holiday_skips k where k.org_id = p_org and k.holiday_id = h.id)
    from school_holidays h join organizations o on o.id = h.org_id and o.is_platform
   where not exists (select 1 from up where up.id = h.org_id)
$$;
revoke all on function public.org_holiday_set(uuid) from public, anon, authenticated;

create or replace function public.is_holiday(p_org uuid, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select h.name from public.org_holiday_set(p_org) h
   where not h.skipped and p_day between h.starts_on and h.ends_on order by h.d limit 1
$$;
grant execute on function public.is_holiday(uuid, date) to authenticated;

-- Danh sách cho giao diện (kể cả ngày chuẩn chung đã bỏ, đánh dấu skipped)
create or replace function public.effective_holidays(p_org uuid, p_from date default null, p_to date default null)
returns table (id uuid, org_id uuid, org_name text, name text, starts_on date, ends_on date, note text, kind text, status text, source text,
               std boolean, skipped boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_org(p_org) or public.can_access_org(p_org) or p_org = public.my_org_id() or public.is_platform_admin()) then
    raise exception 'Không có quyền xem lịch của đơn vị này' using errcode = '42501';
  end if;
  return query select h.id, h.org_id, o.name, h.name, h.starts_on, h.ends_on, h.note, h.kind, h.status, h.source, h.std, h.skipped
    from public.org_holiday_set(p_org) h join organizations o on o.id = h.org_id
   where (p_from is null or h.ends_on >= p_from) and (p_to is null or h.starts_on <= p_to)
   order by h.starts_on, h.name;
end $$;
revoke all on function public.effective_holidays(uuid, date, date) from public, anon;
grant execute on function public.effective_holidays(uuid, date, date) to authenticated;

-- ===== 5. Lịch tuần học (072): năm học riêng của trường, không có thì chuẩn chung; ngày nghỉ hiệu lực =====
create or replace function public.curriculum_calendar(p_org uuid, p_year text)
returns table (cal int, week int, term int, starts_on date, ends_on date, off_days int, holiday text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_s1 date; v_e1 date; v_s2 date; v_e2 date; v_start date; v_hk2 date; r record; n int := 0; n2 int := 0; v_term int; v_src uuid := p_org;
begin
  if not exists (select 1 from academic_years a where a.org_id = p_org and a.name = p_year) then
    select id into v_src from organizations where is_platform limit 1;
  end if;
  select min(a.starts_on) filter (where a.term !~* '(ii|2)\s*$'), max(a.ends_on) filter (where a.term !~* '(ii|2)\s*$'),
         min(a.starts_on) filter (where a.term ~* '(ii|2)\s*$'), max(a.ends_on) filter (where a.term ~* '(ii|2)\s*$')
    into v_s1, v_e1, v_s2, v_e2
    from academic_years a where a.org_id = v_src and a.name = p_year;
  v_s1 := coalesce(v_s1, v_s2);
  if v_s1 is null then return; end if;
  v_start := case when extract(isodow from v_s1) <= 5 then v_s1 - (extract(isodow from v_s1)::int - 1)
                  else v_s1 + (8 - extract(isodow from v_s1)::int) end;
  v_hk2 := coalesce(v_s2, v_e1 + 1);
  for r in
    with hol as (
      select h.name, h.starts_on as s, h.ends_on as e from public.org_holiday_set(p_org) h
       where not h.skipped and h.ends_on >= v_start and h.starts_on <= v_start + 60 * 7
    ), wk as (
      select g::date as d, row_number() over (order by g)::int as c from generate_series(v_start, v_start + 59 * 7, interval '7 day') g
    )
    select wk.c, wk.d,
           (select count(*) from generate_series(wk.d, wk.d + 4, interval '1 day') x
             where exists (select 1 from hol where x::date between hol.s and hol.e))::int as off,
           (select string_agg(distinct hol.name, ', ') from hol where hol.s <= wk.d + 6 and hol.e >= wk.d) as names
      from wk order by wk.c
  loop
    exit when v_e2 is not null and r.d > v_e2;
    exit when v_e2 is null and n2 >= 17;
    exit when v_hk2 is null and n >= 35;
    v_term := case when v_hk2 is not null then (case when r.d + 2 >= v_hk2 then 2 else 1 end)
                   else (case when n >= 18 then 2 else 1 end) end;
    cal := r.c; term := v_term; starts_on := r.d; ends_on := r.d + 6; off_days := r.off; holiday := r.names;
    if r.off >= 5 then
      week := null;
    else
      n := n + 1; week := n;
      if v_term = 2 then n2 := n2 + 1; end if;
    end if;
    return next;
  end loop;
end $$;
revoke all on function public.curriculum_calendar(uuid, text) from public, anon;
grant execute on function public.curriculum_calendar(uuid, text) to authenticated;

-- Năm học có lịch: chuẩn chung + của đơn vị (cho ô chọn "Năm học tham chiếu")
create or replace function public.calendar_years(p_org uuid default null)
returns table (name text, std boolean, own boolean, status text, source text)
language sql stable security definer set search_path = public as $$
  select a.name, bool_or(o.is_platform), bool_or(a.org_id = p_org), min(a.status) filter (where o.is_platform), max(a.source) filter (where o.is_platform)
    from academic_years a join organizations o on o.id = a.org_id
   where (o.is_platform or a.org_id = p_org) and a.name ~ '^\d{4}-\d{4}$'
     and (p_org is null or public.is_platform_org(p_org) or public.can_access_org(p_org) or public.is_platform_admin())
   group by a.name order by a.name
$$;
revoke all on function public.calendar_years(uuid) from public, anon;
grant execute on function public.calendar_years(uuid) to authenticated;

-- Quản trị nền tảng: trường có lịch riêng trong một năm học (năm học riêng, ngày nghỉ riêng, ngày chuẩn chung đã bỏ)
create or replace function public.school_calendars(p_year text)
returns table (org_id uuid, name text, own_year boolean, starts_on date, ends_on date, own_holidays int, skipped int)
language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  v_from := (left(p_year, 4) || '-08-01')::date; v_to := (right(p_year, 4) || '-07-31')::date;
  return query
  select o.id, o.name,
         exists (select 1 from academic_years a where a.org_id = o.id and a.name = p_year),
         (select min(a.starts_on) from academic_years a where a.org_id = o.id and a.name = p_year),
         (select max(a.ends_on) from academic_years a where a.org_id = o.id and a.name = p_year),
         (select count(*)::int from school_holidays h where h.org_id = o.id and h.ends_on >= v_from and h.starts_on <= v_to),
         (select count(*)::int from holiday_skips k join school_holidays h on h.id = k.holiday_id
           where k.org_id = o.id and h.ends_on >= v_from and h.starts_on <= v_to)
    from organizations o
   where o.type = 'school' and o.status = 'active'
     and (exists (select 1 from academic_years a where a.org_id = o.id and a.name = p_year)
       or exists (select 1 from school_holidays h where h.org_id = o.id and h.ends_on >= v_from and h.starts_on <= v_to)
       or exists (select 1 from holiday_skips k where k.org_id = o.id))
   order by o.name;
end $$;
revoke all on function public.school_calendars(text) from public, anon;
grant execute on function public.school_calendars(text) to authenticated;

-- Đơn vị nền tảng (để chọn "Chuẩn chung")
create or replace function public.platform_org_id() returns uuid
language sql stable security definer set search_path = public as $$ select id from organizations where is_platform limit 1 $$;
revoke all on function public.platform_org_id() from public, anon;
grant execute on function public.platform_org_id() to authenticated;

-- ===== 6. Quy tắc vận hành =====
-- key 'rules': {"max_stem_periods_per_day": 3, "plan_remind_days": 7, "attendance_edit_days": 3}
-- key 'periods' (chỉ ở KDI): khung giờ tiết chuẩn chung [{"name":"Tiết 1","starts_at":"07:00","ends_at":"07:45"}] — trường lấy về Cấu hình tiết học
create table if not exists org_settings (
  org_id     uuid not null references organizations(id) on delete cascade,
  key        text not null check (key in ('rules', 'periods')),
  value      jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object' and length(value::text) <= 20000),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table org_settings enable row level security;
drop policy if exists org_settings_read on org_settings;
create policy org_settings_read on org_settings for select to authenticated
  using (public.is_platform_org(org_id) or org_id in (select public.my_org_tree()) or org_id in (select public.my_ancestor_orgs()));
drop policy if exists org_settings_write on org_settings;
create policy org_settings_write on org_settings for all to authenticated
  using (org_id = public.my_org_id() and (public.is_platform_admin() or public.is_admin() or public.has_perm('periods', 'edit')))
  with check (org_id = public.my_org_id() and (public.is_platform_admin() or public.is_admin() or public.has_perm('periods', 'edit')));

-- Giá trị số của một quy tắc: trường → cấp trên → KDI → mặc định
create or replace function public.org_rule(p_org uuid, p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select o.id, o.parent_id, 0 as d from organizations o where o.id = p_org
    union all select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  )
  select coalesce((select (s.value->>p_key)::int from (
      select s.value, up.d from org_settings s join up on up.id = s.org_id where s.key = 'rules' and s.value ? p_key
      union all select s.value, 100 from org_settings s join organizations o on o.id = s.org_id and o.is_platform
       where s.key = 'rules' and s.value ? p_key) s order by s.d limit 1), p_default)
$$;
revoke all on function public.org_rule(uuid, text, int) from public, anon;
grant execute on function public.org_rule(uuid, text, int) to authenticated;

-- Điểm danh (027): hạn giáo viên tự sửa theo quy tắc "attendance_edit_days" (mặc định 7 như trước)
create or replace function public.mark_teaching_session(p_session uuid, p_marks jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v teaching_sessions; v_admin boolean; v_start timestamptz; v_bad int; v_today date := public.vn_today(); v_days int;
begin
  select * into v from teaching_sessions where id = p_session;
  if not found or not public.can_access_org(v.org_id) then raise exception 'Không tìm thấy tiết dạy' using errcode = '42501'; end if;
  v_admin := v.org_id = public.my_org_id() and public.has_perm('timetable', 'edit');
  if not v_admin and (v.teacher_id is null or v.teacher_id is distinct from public.my_teacher_id()) then
    raise exception 'Chỉ giáo viên dạy tiết này hoặc quản trị trường được điểm danh' using errcode = '42501';
  end if;
  if v.status = 'cancelled' then raise exception 'Tiết đã huỷ, không điểm danh' using errcode = '22023'; end if;
  if not v_admin then
    select (v.session_date + p.starts_at) at time zone 'Asia/Ho_Chi_Minh' into v_start from period_configs p where p.id = v.period_id;
    if now() < v_start - interval '10 minutes' then raise exception 'Chưa đến giờ tiết học' using errcode = '22023'; end if;
    v_days := greatest(0, least(60, public.org_rule(v.org_id, 'attendance_edit_days', 7)));
    if v.session_date < v_today - v_days then
      raise exception 'Quá % ngày, nhờ quản trị trường sửa điểm danh', v_days using errcode = '22023';
    end if;
  end if;

  select count(*) into v_bad from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) m
   where (m->>'status') is null or (m->>'status') not in ('present', 'absent', 'late', 'excused')
      or not exists (select 1 from students s where s.id = (m->>'student_id')::uuid and s.class_id = v.class_id);
  if v_bad > 0 then raise exception 'Danh sách điểm danh có % dòng không hợp lệ', v_bad using errcode = '22023'; end if;

  insert into lesson_attendance (session_id, student_id, org_id, status, note, marked_by, marked_at)
  select p_session, (m->>'student_id')::uuid, v.org_id, m->>'status', nullif(m->>'note', ''), auth.uid(), now()
    from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) m
  on conflict (session_id, student_id) do update set
    status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at;

  update teaching_sessions set status = 'taught', note = coalesce(p_note, note), marked_by = auth.uid(), marked_at = now()
   where id = p_session;
  select * into v from teaching_sessions where id = p_session;
  return jsonb_build_object('present', v.present_count, 'absent', v.absent_count, 'late', v.late_count, 'excused', v.excused_count);
end $$;
revoke all on function public.mark_teaching_session(uuid, jsonb, text) from public;
grant execute on function public.mark_teaching_session(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
