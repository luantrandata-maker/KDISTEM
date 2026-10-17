-- "Dấu vân tay" cấu trúc schema public + quyền mặc định, mỗi dòng một đối tượng, đã sắp xếp.
-- Chạy trên hai CSDL rồi diff để biết CSDL thật lệch repo ở đâu (job schema_diff trong CI).
-- Thân hàm và điều kiện policy so bằng md5 cho gọn; khác md5 = nội dung khác.
-- Thân hàm được chuẩn hoá trước khi băm (bỏ \r, gộp khoảng trắng) để không báo lệch chỉ vì xuống dòng/thụt lề.
with rows(line) as (
  -- Cột
  select format('column  %s.%s %s%s%s', c.table_name, c.column_name, c.data_type,
                case when c.is_nullable = 'NO' then ' not null' else '' end,
                coalesce(' default ' || c.column_default, ''))
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  union all
  -- View
  select format('view    %s md5:%s', v.table_name, md5(v.view_definition))
    from information_schema.views v where v.table_schema = 'public'
  union all
  -- Hàm
  select format('func    %s(%s)%s md5:%s', p.proname, pg_get_function_identity_arguments(p.oid),
                case when p.prosecdef then ' secdef' else '' end,
                md5(btrim(regexp_replace(replace(p.prosrc, chr(13), ''), '\s+', ' ', 'g'))))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  -- Policy (RLS)
  select format('policy  %s.%s %s to %s using:%s check:%s', tablename, policyname, cmd, array_to_string(roles, ','),
                coalesce(md5(qual), '-'), coalesce(md5(with_check), '-'))
    from pg_policies where schemaname = 'public'
  union all
  -- Bật RLS
  select format('rls     %s %s', c.relname, c.relrowsecurity)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  -- Trigger
  select format('trigger %s.%s %s', c.relname, t.tgname, md5(pg_get_triggerdef(t.oid)))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  union all
  -- Ràng buộc (khoá, unique, check, exclusion)
  select format('constr  %s.%s %s', c.relname, k.conname, pg_get_constraintdef(k.oid))
    from pg_constraint k join pg_class c on c.oid = k.conrelid
   where c.relnamespace = 'public'::regnamespace
  union all
  -- Chỉ mục
  select format('index   %s %s', i.indexname, md5(i.indexdef))
    from pg_indexes i where i.schemaname = 'public'
  union all
  -- Quyền mặc định của vai trò hệ thống (dữ liệu, nhưng quyết định hành vi)
  select format('perm    %s.%s view:%s detail:%s create:%s edit:%s delete:%s', r.key, rp.module,
                rp.can_view, rp.can_detail, rp.can_create, rp.can_edit, rp.can_delete)
    from role_permissions rp join roles r on r.id = rp.role_id where r.org_id is null
)
select line from rows order by line;
