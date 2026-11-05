-- 135: Hệ thống có vài nghìn trường (nhập 2.189 trường TP.HCM ngày 05/11/2026) thì Triển khai khách hàng, Cơ sở triển khai,
-- Cây tổ chức báo "canceling statement due to statement timeout" (Supabase dừng truy vấn quá 8 giây).
--   1. Chỉ mục org_id / parent_id còn thiếu: các hàm thống kê đếm theo từng trường đang quét cả bảng cho mỗi trường.
--   2. dept_school_stats: tính gộp theo trường (mỗi bảng quét một lần) thay cho ~30 truy vấn con mỗi trường, và lọc phạm vi
--      bằng một lần my_org_tree() thay cho can_access_org() từng dòng (mỗi lần gọi lại dựng cả cây). Kết quả giữ nguyên như 056.
--   3. Tắt JIT cho các hàm thống kê lớn: ước lượng chi phí của hàm trả bảng rất cao nên Postgres bật JIT, riêng bước biên dịch
--      mất 2–3 giây mà truy vấn thật chỉ ~0,1 giây.
create index if not exists organizations_parent_id_idx on organizations (parent_id);
create index if not exists teachers_org_id_idx on teachers (org_id);
create index if not exists stem_teacher_programs_org_id_idx on stem_teacher_programs (org_id);
create index if not exists students_org_id_idx on students (org_id);
create index if not exists classes_org_id_idx on classes (org_id);
create index if not exists class_programs_org_id_idx on class_programs (org_id);
create index if not exists timetable_entries_org_id_idx on timetable_entries (org_id);
create index if not exists assignments_org_id_idx on assignments (org_id);
create index if not exists equipment_units_org_id_idx on equipment_units (org_id);
create index if not exists submissions_org_id_idx on submissions (org_id);
create index if not exists stem_registrations_org_id_idx on stem_registrations (org_id);
create index if not exists class_sessions_org_id_idx on class_sessions (org_id);
create index if not exists academic_years_org_id_idx on academic_years (org_id);
create index if not exists training_enrollments_teacher_id_idx on training_enrollments (teacher_id);
create index if not exists training_attendance_teacher_id_idx on training_attendance (teacher_id);

create or replace function public.dept_school_stats()
returns table (
  school_id uuid, code text, name text, level text, ward text, activated boolean,
  teachers int, stem_teachers int, students int, classes int, stem_classes int, stem_students int,
  programs text[], rooms int, rooms_active int, stem_periods int, total_periods int, room_periods int,
  lesson_plans int, products int, trained int, training_done int, attendance_rate numeric,
  units int, units_broken int, units_maintenance int, units_available int,
  graded int, avg_score numeric, k12_synced boolean, has_year boolean, last_activity timestamptz, kpi int
)
language sql stable security definer set search_path = public set jit = off as $$
  -- Tính gộp theo trường (mỗi bảng quét một lần, group by org_id) thay vì ~30 truy vấn con cho từng trường:
  -- bản cũ quá 8 giây (statement timeout) khi hệ thống có vài nghìn trường. Kết quả giữ nguyên như 056.
  with s as (
    select o.* from organizations o
    where o.type = 'school' and public.is_staff() and o.id in (select t from public.my_org_tree() t)
  ),
  cur as (select org_id, id from academic_years where is_current),
  tch as (select t.org_id, count(*) filter (where t.status = 'active') as n,
                 bool_or(t.k12_synced_at is not null) as k12
            from teachers t where t.org_id in (select id from s) group by t.org_id),
  stp as (select x.org_id, count(distinct x.teacher_id) as n from stem_teacher_programs x where x.org_id in (select id from s) group by x.org_id),
  stu as (select x.org_id, count(*) as n,
                 count(*) filter (where exists (select 1 from class_programs cp where cp.org_id = x.org_id and cp.class_id = x.class_id)) as stem
            from students x where x.org_id in (select id from s) and coalesce(x.status, 'studying') = 'studying' group by x.org_id),
  cls as (select c.org_id, count(*) as n from classes c where c.org_id in (select id from s) group by c.org_id),
  cpg as (select cp.org_id, count(distinct cp.class_id) as n, array_agg(distinct cp.program order by cp.program) as progs
            from class_programs cp where cp.org_id in (select id from s) group by cp.org_id),
  rms as (select r.org_id, count(*) filter (where r.room_kind = 'stem') as n,
                 count(*) filter (where r.room_kind = 'stem' and r.status = 'active') as act
            from stem_rooms r where r.org_id in (select id from s) group by r.org_id),
  tte as (select e.org_id, count(*) filter (where e.kind = 'stem') as stem, count(*) as total, count(*) filter (where e.room_id is not null) as room
            from timetable_entries e
           where e.org_id in (select id from s)
             and (e.year_id is null or exists (select 1 from cur where cur.org_id = e.org_id and cur.id = e.year_id))
           group by e.org_id),
  lps as (select lp.org_id, count(*) filter (where not lp.is_template and lp.status = 'published') as n, max(lp.updated_at) as last
            from lesson_plans lp where lp.org_id in (select id from s) group by lp.org_id),
  asg as (select a.org_id, count(*) as n from assignments a where a.org_id in (select id from s) and a.kind = 'product' group by a.org_id),
  trn as (select t.org_id, count(distinct en.teacher_id) as n, count(distinct en.teacher_id) filter (where en.completed) as done
            from training_enrollments en join teachers t on t.id = en.teacher_id where t.org_id in (select id from s) group by t.org_id),
  att as (select t.org_id, round(100.0 * count(*) filter (where ta.present) / nullif(count(*) filter (where ta.present is not null), 0), 1) as rate
            from training_attendance ta join teachers t on t.id = ta.teacher_id where t.org_id in (select id from s) group by t.org_id),
  equ as (select u.org_id, count(*) as n, count(*) filter (where u.status = 'broken') as broken,
                 count(*) filter (where u.status = 'maintenance') as maint, count(*) filter (where u.status = 'available') as avail
            from equipment_units u where u.org_id in (select id from s) group by u.org_id),
  sub as (select x.org_id, count(*) filter (where x.status = 'graded') as graded,
                 round(avg(x.score / nullif(a.max_score, 0) * 10) filter (where x.status = 'graded' and a.id is not null), 2) as avg_score,
                 max(x.submitted_at) as last
            from submissions x left join assignments a on a.id = x.assignment_id where x.org_id in (select id from s) group by x.org_id),
  yrs as (select distinct y.org_id from academic_years y where y.org_id in (select id from s)),
  reg as (select x.org_id, max(x.created_at) as last from stem_registrations x where x.org_id in (select id from s) group by x.org_id),
  ses as (select x.org_id, max(x.started_at) as last from class_sessions x where x.org_id in (select id from s) group by x.org_id),
  base as (
    select s.id as school_id, s.code, s.name, s.level, s.ward, s.activated_at is not null as activated,
      coalesce(tch.n, 0)::int as teachers, coalesce(stp.n, 0)::int as stem_teachers, coalesce(stu.n, 0)::int as students,
      coalesce(cls.n, 0)::int as classes, coalesce(cpg.n, 0)::int as stem_classes, coalesce(stu.stem, 0)::int as stem_students,
      coalesce(cpg.progs, '{}') as programs, coalesce(rms.n, 0)::int as rooms, coalesce(rms.act, 0)::int as rooms_active,
      coalesce(tte.stem, 0)::int as stem_periods, coalesce(tte.total, 0)::int as total_periods, coalesce(tte.room, 0)::int as room_periods,
      coalesce(lps.n, 0)::int as lesson_plans, coalesce(asg.n, 0)::int as products,
      coalesce(trn.n, 0)::int as trained, coalesce(trn.done, 0)::int as training_done, att.rate as attendance_rate,
      coalesce(equ.n, 0)::int as units, coalesce(equ.broken, 0)::int as units_broken,
      coalesce(equ.maint, 0)::int as units_maintenance, coalesce(equ.avail, 0)::int as units_available,
      coalesce(sub.graded, 0)::int as graded, sub.avg_score,
      coalesce(tch.k12, false) as k12_synced, yrs.org_id is not null as has_year,
      greatest(reg.last, sub.last, ses.last, lps.last) as last_activity
    from s
    left join tch on tch.org_id = s.id left join stp on stp.org_id = s.id left join stu on stu.org_id = s.id
    left join cls on cls.org_id = s.id left join cpg on cpg.org_id = s.id left join rms on rms.org_id = s.id
    left join tte on tte.org_id = s.id left join lps on lps.org_id = s.id left join asg on asg.org_id = s.id
    left join trn on trn.org_id = s.id left join att on att.org_id = s.id left join equ on equ.org_id = s.id
    left join sub on sub.org_id = s.id left join yrs on yrs.org_id = s.id left join reg on reg.org_id = s.id
    left join ses on ses.org_id = s.id
  )
  -- KPI tổng hợp 0–100: độ phủ CT (25) + phòng STEM (15) + tiết STEM/lớp (20) + tập huấn (20) + giáo án (10) + đồng bộ K12 (10)
  select b.*,
    round(
      25 * least(coalesce(array_length(b.programs, 1), 0), 5) / 5.0
    + 15 * least(b.rooms_active, 2) / 2.0
    + 20 * least(b.stem_periods::numeric / nullif(b.classes, 0), 2) / 2.0
    + 20 * coalesce(b.training_done::numeric / nullif(b.teachers, 0), 0)
    + 10 * least(b.lesson_plans::numeric / nullif(b.teachers, 0) * 2, 1)
    + 10 * (case when b.k12_synced then 1 else 0 end)
    )::int as kpi
  from base b
  order by b.name
$$;

alter function public.platform_school_registry() set jit = off;
alter function public.org_tree_stats() set jit = off;

notify pgrst, 'reload schema';
