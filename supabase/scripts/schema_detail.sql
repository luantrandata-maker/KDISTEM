-- Nội dung đầy đủ của hàm và policy trong schema public (đi kèm schema_fingerprint.sql).
-- Dùng để đọc chi tiết chỗ lệch giữa CSDL thật và repo. Mỗi đối tượng mở đầu bằng dòng "-- ##### <khoá>".
select line from (
  select format('-- ##### func %s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as k,
         format(E'-- ##### func %s(%s)\n%s;', p.proname, pg_get_function_identity_arguments(p.oid),
                replace(pg_get_functiondef(p.oid), chr(13), '')) as line
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select format('-- ##### policy %s.%s', tablename, policyname),
         format(E'-- ##### policy %s.%s\ncreate policy %I on public.%I as %s for %s to %s%s%s;',
                tablename, policyname, policyname, tablename, permissive, cmd, array_to_string(roles, ', '),
                coalesce(E'\n  using (' || qual || ')', ''), coalesce(E'\n  with check (' || with_check || ')', ''))
    from pg_policies where schemaname = 'public'
) x order by k;
