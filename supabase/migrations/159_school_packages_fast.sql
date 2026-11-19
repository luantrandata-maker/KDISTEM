-- 159: Trường dùng gói tải nhanh hơn khi có hàng nghìn trường.
-- • school_package_schools(năm học) chỉ trả trường đã có bản gán gói trong năm học (danh sách + lịch sử), không trả mọi trường.
--   Tỉnh của trường tìm một lần cho các trường cần, không gọi hàm tìm cấp trên cho từng trường của cả nước.
-- • Ô Gán gói: school_package_provinces(năm học) trả các tỉnh kèm số trường còn khối chưa có gói;
--   school_package_pick(năm học, tỉnh) trả trường của một tỉnh (tỉnh để trống = trường chưa thuộc tỉnh nào) kèm khối đã có gói.

-- Tỉnh của mọi đơn vị: đi một lượt từ các tỉnh xuống
create or replace function public.org_province_map() returns table (org_id uuid, province_id uuid)
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select id, id as prov, 0 as d from organizations where type = 'province'
    union all
    select o.id, t.prov, t.d + 1 from organizations o join t on o.parent_id = t.id where o.type <> 'province' and t.d < 10
  ) select id, prov from t
$$;
revoke all on function public.org_province_map() from public, anon;

drop function if exists public.school_package_schools(text);
create function public.school_package_schools(p_year text)
returns table (org_id uuid, name text, code text, level text, province_id uuid, province_name text,
               sp_id uuid, package_id uuid, grades int[], full_package boolean, note text, updated_at timestamptz,
               starts_on date, ends_on date, prev_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.code, o.level, pv.id, pv.name, sp.id, sp.package_id, sp.grades, sp.full_package, sp.note, sp.updated_at,
         sp.starts_on, sp.ends_on, sp.prev_id
    from school_packages sp
    join organizations o on o.id = sp.org_id
    left join organizations pv on pv.id = public.org_ancestor_of_type(o.id, 'province')
   where sp.school_year = p_year
     and (public.is_platform_admin() or (public.is_staff() and o.id in (select public.my_org_tree())))
   order by pv.name nulls last, o.name, o.id, sp.starts_on nulls first, sp.id
$$;
revoke all on function public.school_package_schools(text) from public, anon;
grant execute on function public.school_package_schools(text) to authenticated;

-- Khối đã có gói (bản gán chưa kết thúc) của từng trường trong năm học
create or replace function public.school_package_taken(p_year text) returns table (org_id uuid, grades int[])
language sql stable security definer set search_path = public as $$
  select sp.org_id, array_agg(distinct g order by g)
    from school_packages sp, unnest(sp.grades) g
   where sp.school_year = p_year and (sp.ends_on is null or sp.ends_on >= current_date)
   group by sp.org_id
$$;
revoke all on function public.school_package_taken(text) from public, anon;

create or replace function public.school_package_provinces(p_year text)
returns table (province_id uuid, province_name text, schools int)
language sql stable security definer set search_path = public as $$
  select pm.province_id, pv.name, count(*)::int
    from organizations o
    left join public.org_province_map() pm on pm.org_id = o.id
    left join organizations pv on pv.id = pm.province_id
    left join public.school_package_taken(p_year) tk on tk.org_id = o.id
   where o.type = 'school' and public.is_platform_admin()
     and coalesce(cardinality(tk.grades), 0) < 12
   group by pm.province_id, pv.name
   order by pv.name nulls last
$$;
revoke all on function public.school_package_provinces(text) from public, anon;
grant execute on function public.school_package_provinces(text) to authenticated;

create or replace function public.school_package_pick(p_year text, p_province uuid)
returns table (org_id uuid, name text, code text, level text, taken int[])
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.code, o.level, coalesce(tk.grades, '{}')
    from organizations o
    left join public.org_province_map() pm on pm.org_id = o.id
    left join public.school_package_taken(p_year) tk on tk.org_id = o.id
   where o.type = 'school' and public.is_platform_admin()
     and pm.province_id is not distinct from p_province
     and coalesce(cardinality(tk.grades), 0) < 12
   order by o.name, o.id
$$;
revoke all on function public.school_package_pick(text, uuid) from public, anon;
grant execute on function public.school_package_pick(text, uuid) to authenticated;

notify pgrst, 'reload schema';
