-- 157: danh sách trường của Trường dùng gói đọc theo trang (mỗi lần 1.000 dòng):
-- thêm o.id vào thứ tự để các trang không trùng / sót khi nhiều trường cùng tên.

create or replace function public.school_package_schools(p_year text)
returns table (org_id uuid, name text, code text, level text, province_id uuid, province_name text,
               sp_id uuid, package_id uuid, grades int[], full_package boolean, note text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.code, o.level, pv.id, pv.name, sp.id, sp.package_id, sp.grades, sp.full_package, sp.note, sp.updated_at
    from organizations o
    left join organizations pv on pv.id = public.org_ancestor_of_type(o.id, 'province')
    left join school_packages sp on sp.org_id = o.id and sp.school_year = p_year
   where o.type = 'school'
     and (public.is_platform_admin() or (public.is_staff() and o.id in (select public.my_org_tree())))
   order by pv.name nulls last, o.name, o.id
$$;
revoke all on function public.school_package_schools(text) from public, anon;
grant execute on function public.school_package_schools(text) to authenticated;

notify pgrst, 'reload schema';
