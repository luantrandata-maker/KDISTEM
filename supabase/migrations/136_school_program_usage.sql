-- 136: Trường đang dùng những chương trình giáo dục nào (xem ở KDI, Sở / Phòng và chính trường đó).
-- Một dòng cho mỗi chương trình: được gán trực tiếp cho trường, gán cho Phòng / Sở cấp trên (áp dụng cho trường trực thuộc),
-- hoặc trường đã có PPCT theo chương trình. Kèm số PPCT, số lớp đang học theo và tiến độ bài dạy.

create or replace function public.school_program_usage(p_org uuid)
returns table (program_id uuid, code text, title text, version_no int, status text, owner text,
               assigned boolean, via text, grades int[], books int, books_published int,
               classes int, lessons int, done int, missed int)
language sql stable security definer set search_path = public
set jit = off as $$
  with ok as (select 1 where public.is_staff() and p_org in (select public.my_org_tree())),
  up as (   -- trường và các cấp trên của trường
    with recursive u as (select o.id, o.parent_id, 0 as d from organizations o where o.id = p_org
                         union all select o.id, o.parent_id, u.d + 1 from organizations o join u on o.id = u.parent_id where u.d < 20)
    select id, d from u
  ),
  asg as (  -- bản gán gần trường nhất cho mỗi chương trình
    select distinct on (a.program_id) a.program_id, a.grades, up.d, a.org_id
      from edu_program_assignments a join up on up.id = a.org_id
     order by a.program_id, up.d
  ),
  bk as (
    select b.program_id, count(*)::int as n, count(*) filter (where b.status = 'published')::int as pub
      from curriculum_books b where b.org_id = p_org and b.program_id is not null group by 1
  ),
  lr as (select r.program_id, r.class_id, r.state from public.curriculum_lesson_rows(p_org, null) r where r.program_id is not null),
  ids as (select program_id from asg union select program_id from bk)
  select p.id, p.code, p.title, p.version_no, p.status, ow.name,
         asg.program_id is not null, case when asg.d > 0 then (select o.name from organizations o where o.id = asg.org_id) end,
         asg.grades, coalesce(bk.n, 0), coalesce(bk.pub, 0),
         (select count(distinct lr.class_id)::int from lr where lr.program_id = p.id),
         (select count(*)::int from lr where lr.program_id = p.id),
         (select count(*) filter (where lr.state in ('done', 'before'))::int from lr where lr.program_id = p.id),
         (select count(*) filter (where lr.state in ('skipped', 'late'))::int from lr where lr.program_id = p.id)
    from ids join edu_programs p on p.id = ids.program_id
    left join organizations ow on ow.id = p.org_id
    left join asg on asg.program_id = p.id
    left join bk on bk.program_id = p.id
   where exists (select 1 from ok)
   order by p.title
$$;
revoke all on function public.school_program_usage(uuid) from public, anon;
grant execute on function public.school_program_usage(uuid) to authenticated;
