-- 027: Buổi dạy & điểm danh theo tiết (S2)
-- Trước đây chỉ có thời khoá biểu (lịch lặp theo thứ) và phiên trình chiếu PIN (class_sessions):
-- không biết tiết nào đã thực dạy, tiết nào bị huỷ/dạy bù, học sinh nào vắng tiết nào.
--   • teaching_sessions: mỗi tiết cụ thể theo ngày, sinh từ TKB của học kỳ (generate_teaching_sessions).
--   • lesson_attendance: điểm danh học sinh theo tiết; số có mặt/vắng/muộn/có phép giữ sẵn trên buổi dạy.
--   • Giáo viên điểm danh tiết của mình từ lúc vào tiết đến 7 ngày sau (mark_teaching_session);
--     quản trị trường (quyền sửa Thời khoá biểu) huỷ tiết, thêm tiết dạy bù, sửa điểm danh bất kỳ lúc nào.
--   • attendance_summary: tổng hợp theo trường cho Dashboard điểm danh (trường, Phòng/Sở, nền tảng).
--   • timetable_overview / timetable_conflicts: TKB toàn hệ thống và các chỗ trùng GV/phòng.

-- ===== 1. Bảng =====
create table if not exists teaching_sessions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  year_id            uuid references academic_years(id) on delete set null,
  timetable_entry_id uuid references timetable_entries(id) on delete set null,
  class_id           uuid not null references classes(id) on delete cascade,
  teacher_id         uuid references teachers(id) on delete set null,
  period_id          uuid not null references period_configs(id) on delete cascade,
  room_id            uuid references stem_rooms(id) on delete set null,
  session_date       date not null,
  subject            text not null,
  kind               text not null default 'regular' check (kind in ('regular', 'stem')),
  status             text not null default 'scheduled' check (status in ('scheduled', 'taught', 'cancelled')),
  is_makeup          boolean not null default false,
  makeup_of          uuid references teaching_sessions(id) on delete set null,
  note               text,
  cancel_reason      text,
  present_count      int not null default 0,
  absent_count       int not null default 0,
  late_count         int not null default 0,
  excused_count      int not null default 0,
  marked_by          uuid references profiles(id) on delete set null,
  marked_at          timestamptz,
  created_at         timestamptz not null default now(),
  unique (class_id, session_date, period_id)
);
create index if not exists teaching_sessions_org_date on teaching_sessions (org_id, session_date);
create index if not exists teaching_sessions_teacher_date on teaching_sessions (teacher_id, session_date);
create index if not exists teaching_sessions_room_date on teaching_sessions (room_id, session_date) where room_id is not null;

create table if not exists lesson_attendance (
  session_id uuid not null references teaching_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  status     text not null check (status in ('present', 'absent', 'late', 'excused')),
  note       text,
  marked_by  uuid references profiles(id) on delete set null,
  marked_at  timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index if not exists lesson_attendance_student on lesson_attendance (student_id);

-- Điểm danh phải khớp buổi dạy: cùng đơn vị, học sinh thuộc lớp của tiết đó
create or replace function public.lesson_attendance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_class uuid;
begin
  select org_id, class_id into v_org, v_class from teaching_sessions where id = new.session_id;
  new.org_id := v_org;
  if not exists (select 1 from students where id = new.student_id and class_id = v_class) then
    raise exception 'Học sinh không thuộc lớp của tiết này' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists lesson_attendance_guard on lesson_attendance;
create trigger lesson_attendance_guard before insert or update on lesson_attendance
  for each row execute function public.lesson_attendance_guard();

-- Giữ số liệu tổng trên buổi dạy (dashboard đọc thẳng, không phải đếm lại hàng triệu dòng)
create or replace function public.lesson_attendance_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.session_id, old.session_id);
begin
  update teaching_sessions s set
    present_count = c.p, absent_count = c.a, late_count = c.l, excused_count = c.e
  from (select count(*) filter (where status = 'present') p, count(*) filter (where status = 'absent') a,
               count(*) filter (where status = 'late') l, count(*) filter (where status = 'excused') e
          from lesson_attendance where session_id = v_id) c
  where s.id = v_id;
  return null;
end $$;
drop trigger if exists lesson_attendance_count on lesson_attendance;
create trigger lesson_attendance_count after insert or update or delete on lesson_attendance
  for each row execute function public.lesson_attendance_count();

-- ===== 2. Phân quyền =====
alter table teaching_sessions enable row level security;
alter table lesson_attendance enable row level security;

-- Viết sẵn dạng "nhanh" (xem 019 mục 11): hàm không tham số bọc (select …), phạm vi dùng org_id in (select my_org_tree())
-- để Postgres tính một lần mỗi câu lệnh thay vì cho từng dòng (bảng điểm danh có hàng triệu dòng).
create policy teaching_sessions_read on teaching_sessions for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
create policy teaching_sessions_student_read on teaching_sessions for select to authenticated
  using ((select public.is_student()) and class_id = (select public.my_class_id()));
-- Ghi trực tiếp: chỉ người có quyền Thời khoá biểu tại chính trường đó (huỷ tiết, dạy bù, sửa).
-- Giáo viên điểm danh qua mark_teaching_session().
create policy teaching_sessions_insert on teaching_sessions for insert to authenticated
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('timetable', 'create')));
create policy teaching_sessions_update on teaching_sessions for update to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('timetable', 'edit')))
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('timetable', 'edit')));
create policy teaching_sessions_delete on teaching_sessions for delete to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('timetable', 'delete')));

create policy lesson_attendance_read on lesson_attendance for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
create policy lesson_attendance_student_read on lesson_attendance for select to authenticated
  using ((select public.is_student()) and student_id = (select public.my_student_id()));
create policy lesson_attendance_write on lesson_attendance for all to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('timetable', 'edit')))
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('timetable', 'edit')));

-- ===== 3. Thời gian & trạng thái =====
-- Giờ Việt Nam: ngày + giờ tiết → mốc thời gian
create or replace function public.vn_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace view teaching_session_view with (security_invoker = true) as
select s.id, s.org_id, s.year_id, s.timetable_entry_id, s.class_id, s.teacher_id, s.period_id, s.room_id,
       s.session_date, s.subject, s.kind, s.status, s.is_makeup, s.makeup_of, s.note, s.cancel_reason,
       s.present_count, s.absent_count, s.late_count, s.excused_count, s.marked_by, s.marked_at,
       p.name as period_name, p.session as period_session,
       (s.session_date + p.starts_at) at time zone 'Asia/Ho_Chi_Minh' as starts_at,
       (s.session_date + p.ends_at) at time zone 'Asia/Ho_Chi_Minh' as ends_at,
       c.name as class_name, c.grade, t.full_name as teacher_name, r.name as room_name,
       case when s.status = 'cancelled' then 'cancelled'
            when s.status = 'taught' then 'taught'
            when now() < (s.session_date + p.starts_at) at time zone 'Asia/Ho_Chi_Minh' then 'upcoming'
            when now() <= (s.session_date + p.ends_at) at time zone 'Asia/Ho_Chi_Minh' then 'live'
            else 'not_marked' end as state
from teaching_sessions s
join period_configs p on p.id = s.period_id
left join classes c on c.id = s.class_id
left join teachers t on t.id = s.teacher_id
left join stem_rooms r on r.id = s.room_id;
grant select on teaching_session_view to authenticated;

-- ===== 4. Sinh buổi dạy từ TKB =====
-- Idempotent: gọi lại bao nhiêu lần cũng được. Với khoảng ngày [p_from, p_to] của trường đang làm việc:
--   • thêm tiết còn thiếu (kể cả ngày đã qua, để bổ sung lịch sử);
--   • tiết tương lai chưa điểm danh: cập nhật GV/phòng/môn theo TKB mới, xoá tiết không còn trong TKB;
--   • không đụng tiết đã dạy, đã huỷ, tiết dạy bù.
-- Chỉ ngày thuộc một học kỳ (academic_years.starts_on..ends_on), Thứ 2–Thứ 7.
-- Mọi cán bộ của trường gọi được (giao diện giáo viên tự gọi khi mở tuần mới); kết quả chỉ phụ thuộc TKB.
create or replace function public.generate_teaching_sessions(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_ins int; v_upd int; v_del int; v_today date := public.vn_today();
begin
  if v_org is null or not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if (select type from organizations where id = v_org) is distinct from 'school' then
    raise exception 'Chỉ sinh buổi dạy cho trường học' using errcode = '22023';
  end if;
  if not public.org_has_module(v_org, 'timetable') then raise exception 'Đơn vị chưa dùng phân hệ Thời khoá biểu' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 63 ngày)' using errcode = '22023';
  end if;

  create temp table if not exists _ts_src (entry_id uuid, class_id uuid, teacher_id uuid, period_id uuid, room_id uuid,
    day date, year_id uuid, subject text, kind text) on commit drop;
  truncate _ts_src;
  insert into _ts_src
  select distinct on (e.class_id, d.day, e.period_id)
         e.id, e.class_id, e.teacher_id, e.period_id, e.room_id, d.day, d.year_id, e.subject, e.kind
  from (select g::date as day, y.id as year_id
          from generate_series(p_from, p_to, interval '1 day') g
          join academic_years y on y.org_id = v_org and g::date between y.starts_on and y.ends_on
         where extract(isodow from g) between 1 and 6) d
  join timetable_entries e on e.org_id = v_org
   and e.weekday = extract(isodow from d.day)::int + 1
   and (e.year_id is null or e.year_id = d.year_id)
  order by e.class_id, d.day, e.period_id, (e.year_id is null), e.id;   -- ưu tiên TKB riêng của học kỳ

  delete from teaching_sessions s
   where s.org_id = v_org and s.session_date between greatest(p_from, v_today) and p_to
     and s.status = 'scheduled' and not s.is_makeup
     and not exists (select 1 from lesson_attendance a where a.session_id = s.id)
     and not exists (select 1 from _ts_src x where x.class_id = s.class_id and x.day = s.session_date and x.period_id = s.period_id);
  get diagnostics v_del = row_count;

  with up as (
    insert into teaching_sessions (org_id, year_id, timetable_entry_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind)
    select v_org, year_id, entry_id, class_id, teacher_id, period_id, room_id, day, subject, kind from _ts_src
    on conflict (class_id, session_date, period_id) do update set
      year_id = excluded.year_id, timetable_entry_id = excluded.timetable_entry_id, teacher_id = excluded.teacher_id,
      room_id = excluded.room_id, subject = excluded.subject, kind = excluded.kind
    where teaching_sessions.status = 'scheduled' and not teaching_sessions.is_makeup and teaching_sessions.session_date >= v_today
      and (teaching_sessions.timetable_entry_id, teaching_sessions.teacher_id, teaching_sessions.room_id, teaching_sessions.subject, teaching_sessions.kind)
          is distinct from (excluded.timetable_entry_id, excluded.teacher_id, excluded.room_id, excluded.subject, excluded.kind)
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  return jsonb_build_object('created', v_ins, 'updated', v_upd, 'removed', v_del);
end $$;
revoke all on function public.generate_teaching_sessions(date, date) from public;
grant execute on function public.generate_teaching_sessions(date, date) to authenticated;

-- ===== 5. Điểm danh một tiết =====
-- p_marks: [{"student_id": "...", "status": "present|absent|late|excused", "note": "..."}]
-- Học sinh không có trong p_marks giữ nguyên điểm danh cũ (lần đầu: không có dòng).
create or replace function public.mark_teaching_session(p_session uuid, p_marks jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v teaching_sessions; v_admin boolean; v_start timestamptz; v_bad int; v_today date := public.vn_today();
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
    if v.session_date < v_today - 7 then
      raise exception 'Quá 7 ngày, nhờ quản trị trường sửa điểm danh' using errcode = '22023';
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

-- ===== 6. Tổng hợp cho Dashboard điểm danh =====
-- Mỗi trường trong phạm vi người xem (trường mình; Phòng/Sở/Tỉnh/Bộ: trường trực thuộc; nền tảng: tất cả).
-- Chỉ tính tiết đã bắt đầu (tiết tương lai không làm giảm tỉ lệ).
create or replace function public.attendance_summary(p_from date, p_to date)
returns table (org_id uuid, school text, ward text, parent_name text,
               planned int, taught int, not_marked int, cancelled int, makeup int,
               stem_planned int, stem_taught int, stem_room_periods int,
               present int, absent int, late int, excused int, teachers_not_marked int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Khoảng ngày không hợp lệ' using errcode = '22023';
  end if;
  return query
  with sc as (
    select o.id, o.name, o.ward, par.name as parent_name from organizations o
    left join organizations par on par.id = o.parent_id
    where o.type = 'school' and o.id in (select public.my_org_tree())
  ), s as (
    select ts.*, (ts.session_date + p.starts_at) at time zone 'Asia/Ho_Chi_Minh' as starts_at
    from teaching_sessions ts join period_configs p on p.id = ts.period_id
    where ts.org_id in (select id from sc) and ts.session_date between p_from and p_to
  )
  select sc.id, sc.name, sc.ward, sc.parent_name,
    count(s.id) filter (where s.status <> 'cancelled' and s.starts_at <= now())::int,
    count(s.id) filter (where s.status = 'taught')::int,
    count(s.id) filter (where s.status = 'scheduled' and s.starts_at <= now())::int,
    count(s.id) filter (where s.status = 'cancelled')::int,
    count(s.id) filter (where s.is_makeup and s.status <> 'cancelled')::int,
    count(s.id) filter (where s.kind = 'stem' and s.status <> 'cancelled' and s.starts_at <= now())::int,
    count(s.id) filter (where s.kind = 'stem' and s.status = 'taught')::int,
    count(s.id) filter (where s.room_id is not null and s.status = 'taught')::int,
    coalesce(sum(s.present_count), 0)::int, coalesce(sum(s.absent_count), 0)::int,
    coalesce(sum(s.late_count), 0)::int, coalesce(sum(s.excused_count), 0)::int,
    count(distinct s.teacher_id) filter (where s.status = 'scheduled' and s.starts_at <= now())::int
  from sc left join s on s.org_id = sc.id
  group by sc.id, sc.name, sc.ward, sc.parent_name
  order by sc.name;
end $$;
grant execute on function public.attendance_summary(date, date) to authenticated;

-- ===== 7. TKB toàn hệ thống & chỗ trùng =====
-- Hai tiết cùng thứ, cùng tiết, cùng học kỳ (hoặc áp dụng mọi học kỳ) dùng chung một GV hoặc một phòng
create or replace function public.timetable_conflicts()
returns table (org_id uuid, kind text, weekday int, period_name text, resource text, classes text)
language sql stable security definer set search_path = public as $$
  with e as (
    select e.*, p.name as period_name from timetable_entries e join period_configs p on p.id = e.period_id
    where e.org_id in (select public.my_org_tree()) and public.is_staff()
  )
  select a.org_id, 'teacher', a.weekday, a.period_name, t.full_name, string_agg(distinct c.name, ', ')
  from e a join e b on b.org_id = a.org_id and b.weekday = a.weekday and b.period_id = a.period_id
       and b.teacher_id = a.teacher_id and b.class_id <> a.class_id
       and (a.year_id is null or b.year_id is null or a.year_id = b.year_id)
  join teachers t on t.id = a.teacher_id join classes c on c.id in (a.class_id, b.class_id)
  group by a.org_id, a.weekday, a.period_name, t.full_name
  union all
  select a.org_id, 'room', a.weekday, a.period_name, r.name, string_agg(distinct c.name, ', ')
  from e a join e b on b.org_id = a.org_id and b.weekday = a.weekday and b.period_id = a.period_id
       and b.room_id = a.room_id and b.class_id <> a.class_id
       and (a.year_id is null or b.year_id is null or a.year_id = b.year_id)
  join stem_rooms r on r.id = a.room_id join classes c on c.id in (a.class_id, b.class_id)
  group by a.org_id, a.weekday, a.period_name, r.name
$$;
create or replace function public.timetable_overview()
returns table (org_id uuid, school text, parent_name text, classes int, classes_with_tkb int, entries int,
               stem_entries int, teachers int, conflicts int, current_term text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return query
  with sc as (select o.id, o.name, par.name as parent_name from organizations o left join organizations par on par.id = o.parent_id
               where o.type = 'school' and o.id in (select public.my_org_tree())),
       cf as (select x.org_id, count(*)::int as n from public.timetable_conflicts() x group by x.org_id)
  select sc.id, sc.name, sc.parent_name,
    (select count(*) from classes c where c.org_id = sc.id)::int,
    (select count(distinct e.class_id) from timetable_entries e where e.org_id = sc.id)::int,
    (select count(*) from timetable_entries e where e.org_id = sc.id)::int,
    (select count(*) from timetable_entries e where e.org_id = sc.id and e.kind = 'stem')::int,
    (select count(distinct e.teacher_id) from timetable_entries e where e.org_id = sc.id)::int,
    coalesce((select cf.n from cf where cf.org_id = sc.id), 0),
    (select y.name || ' · ' || y.term from academic_years y where y.org_id = sc.id and y.is_current limit 1)
  from sc order by sc.name;
end $$;

grant execute on function public.timetable_conflicts() to authenticated;
grant execute on function public.timetable_overview() to authenticated;
