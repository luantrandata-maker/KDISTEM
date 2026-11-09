-- 138: Chương trình giáo dục › Gán & triển khai báo "canceling statement due to statement timeout" (09/11/2026).
-- edu_program_coverage (058) chạy chậm khi hệ thống có vài nghìn trường (135):
--   - tính tiết của MỌI lớp toàn hệ thống (curriculum_lesson_rows(null, null)) rồi mới lọc theo chương trình;
--   - gọi curriculum_outcome_status cho TỪNG trường trong phạm vi (quản trị nền tảng: mọi trường);
--   - dò ngược cây đơn vị cho từng trường để biết trường có được gán qua Phòng / Sở không.
-- Bản mới cho kết quả như cũ: tiết và yêu cầu cần đạt chỉ có ở trường đã tạo PPCT từ chương trình (PPCT của lớp luôn
-- thuộc chính trường), nên chỉ tính cho các trường đó; trường được gán qua Phòng / Sở tìm bằng một lần đi xuống cây.
create or replace function public.edu_program_coverage(p_program uuid)
returns table (org_id uuid, school text, area text, assigned boolean, grades int[], books int, classes int,
               lessons int, done int, missed int, outcomes int, outcomes_done int)
language sql stable security definer set search_path = public
set jit = off as $$
  with fam as materialized (
    select p.id from edu_programs p where p.family_id = (select family_id from edu_programs where id = p_program)
  ), tree as materialized (
    select t.id from public.my_org_tree() t(id) where public.is_staff()
  ), dn as materialized (   -- đơn vị được gán và mọi đơn vị trực thuộc (gán cho Phòng / Sở = mọi trường trực thuộc)
    with recursive d as (
      select a.org_id as id, a.grades, 0 as depth from edu_program_assignments a where a.program_id in (select id from fam)
      union all
      select o.id, d.grades, d.depth + 1 from organizations o join d on o.parent_id = d.id where d.depth < 10
    ) select distinct on (d.id) d.id, d.grades from d order by d.id, d.depth
  ), bk as materialized (
    select b.org_id, count(*)::int as n from curriculum_books b
     where b.program_id in (select id from fam) and b.org_id in (select id from tree) group by 1
  ), sch as materialized (
    select o.id, o.name, (select p.name from organizations p where p.id = o.parent_id) as area,
           dn.id is not null as assigned, dn.grades, bk.n as books
      from organizations o left join dn on dn.id = o.id left join bk on bk.org_id = o.id
     where o.type = 'school' and o.id in (select id from tree) and (dn.id is not null or bk.n is not null)
  ), lrows as materialized (
    select r.org_id, r.class_id, r.state from sch cross join lateral public.curriculum_lesson_rows(sch.id, null) r
     where sch.books is not null and r.program_id in (select id from fam)
  ), lr as (
    select r.org_id, count(distinct r.class_id)::int as classes, count(*)::int as lessons,
           count(*) filter (where r.state in ('done', 'before'))::int as done,
           count(*) filter (where r.state in ('skipped', 'late'))::int as missed
      from lrows r group by 1
  ), oc as (
    select o.org_id, count(*)::int as n, count(*) filter (where o.state = 'done')::int as d
      from sch cross join lateral public.curriculum_outcome_status(null, sch.id) o
     where sch.books is not null
       and o.book_id in (select b.id from curriculum_books b where b.program_id in (select id from fam)) group by 1
  )
  select s.id, s.name, s.area, s.assigned, s.grades, coalesce(s.books, 0),
         coalesce(lr.classes, 0), coalesce(lr.lessons, 0), coalesce(lr.done, 0), coalesce(lr.missed, 0),
         coalesce(oc.n, 0), coalesce(oc.d, 0)
    from sch s left join lr on lr.org_id = s.id left join oc on oc.org_id = s.id
   order by s.area nulls last, s.name
$$;
revoke all on function public.edu_program_coverage(uuid) from public, anon;
grant execute on function public.edu_program_coverage(uuid) to authenticated;

notify pgrst, 'reload schema';
