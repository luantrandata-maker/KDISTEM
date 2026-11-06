-- 137: Dự tính giáo viên theo chương trình giáo dục cho một trường (06/11).
-- Mỗi họ chương trình giáo dục: số GV đang dạy ở trường đã đáp ứng (theo teacher_edu_met của 124 / 132) và tên các GV đó.
-- Số lớp và số GV cần do màn hình tính (số lớp ÷ số lớp tối đa mỗi GV dạy).

create or replace function public.school_edu_met(p_org uuid)
returns table (edu_family uuid, met int, names text[])
language sql stable security definer set search_path = public
set jit = off as $$
  with ok as (select 1 where public.is_platform_admin() or (public.is_staff() and p_org in (select public.my_org_tree()))),
  tch as (select t.id, t.full_name from teachers t
           where t.org_id = p_org and coalesce(t.status, 'active') = 'active' and exists (select 1 from ok)),
  met as (select m.teacher_id, m.edu_family from public.teacher_edu_met(array(select id from tch)) m)
  select m.edu_family, count(distinct m.teacher_id)::int, array_agg(distinct t.full_name order by t.full_name)
    from met m join tch t on t.id = m.teacher_id
   group by m.edu_family
$$;
revoke all on function public.school_edu_met(uuid) from public, anon;
grant execute on function public.school_edu_met(uuid) to authenticated;

notify pgrst, 'reload schema';
