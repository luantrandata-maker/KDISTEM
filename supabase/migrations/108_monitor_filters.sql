-- 108. Bộ lọc chọn nhiều ở các màn theo dõi Phân hệ 2 (27/10)
--  • dept_subject_school_stats(): số tiết / lớp / học sinh STEM theo từng trường × môn (năm học hiện tại), để lọc theo tỉnh, xã/phường,
--    cấp học, trường rồi cộng lại ở giao diện. Cùng phạm vi đọc với dept_subject_stats (018).
--  • curriculum_weekly_f(): như curriculum_weekly (074) nhưng lọc nhiều trường / khối / môn / chương trình / lớp cùng lúc.

create or replace function public.dept_subject_school_stats()
returns table (org_id uuid, subject text, total int, stem int, classes int, students int)
language sql stable security definer set search_path = public as $$
  select e.org_id, e.subject, count(*)::int, count(*) filter (where e.kind = 'stem')::int,
    count(distinct e.class_id) filter (where e.kind = 'stem')::int,
    (select count(*) from students st where st.class_id in (select x.class_id from timetable_entries x
       where x.org_id = e.org_id and x.subject = e.subject and x.kind = 'stem'))::int
  from timetable_entries e
  where public.is_staff() and public.can_access_org(e.org_id)
    and (e.year_id is null or e.year_id in (select id from academic_years where is_current))
  group by e.org_id, e.subject
$$;
revoke all on function public.dept_subject_school_stats() from public, anon;
grant execute on function public.dept_subject_school_stats() to authenticated;

create or replace function public.curriculum_weekly_f(p_orgs uuid[] default null, p_grades int[] default null, p_subjects text[] default null, p_programs uuid[] default null, p_classes uuid[] default null)
returns table (week int, month text, term int, planned int, taught int)
language sql stable security definer set search_path = public as $$
  with r as materialized (
    select x.org_id, x.plan_week, x.taught_on from public.curriculum_lesson_rows(null, null) x
     where (p_orgs is null or x.org_id = any(p_orgs)) and (p_grades is null or x.grade = any(p_grades))
       and (p_subjects is null or x.subject = any(p_subjects)) and (p_programs is null or x.program_id = any(p_programs)) and (p_classes is null or x.class_id = any(p_classes))
  ), yr as (
    select o.org_id, (select a.name from academic_years a where a.org_id = o.org_id and a.is_current limit 1) as name
      from (select distinct r.org_id from r) o
  ), cal as materialized (
    select yr.org_id, c.week, c.term, c.starts_on from yr cross join lateral public.curriculum_calendar(yr.org_id, yr.name) c where c.week is not null
  ), t as (
    select (select max(c.week) from cal c where c.org_id = r.org_id and c.starts_on <= r.taught_on) as w from r where r.taught_on is not null
  ), wk as (
    select generate_series(1, least(52, greatest(coalesce((select max(plan_week) from r), 0), coalesce((select max(cal.week) from cal), 0)))) as w
  )
  select wk.w,
         (select to_char(min(c.starts_on) + 2, 'YYYY-MM') from cal c where c.week = wk.w),
         (select min(c.term) from cal c where c.week = wk.w),
         (select count(*) from r where r.plan_week = wk.w)::int,
         (select count(*) from t where t.w = wk.w)::int
    from wk order by 1
$$;
revoke all on function public.curriculum_weekly_f(uuid[], int[], text[], uuid[], uuid[]) from public, anon;
grant execute on function public.curriculum_weekly_f(uuid[], int[], text[], uuid[], uuid[]) to authenticated;

notify pgrst, 'reload schema';
