-- 122. Quản trị KDI chọn được mọi trường trong hệ thống (ô "Trường" ở menu tài khoản)
--  • platform_school_list(): quản trị nền tảng thấy mọi trường đang hoạt động (kể cả trường thử nghiệm);
--    người khác nhận danh sách rỗng (giao diện dùng các trường mình có vai trò).
--  • platform_enter_school(trường): quản trị nền tảng vào trường với vai trò Hiệu trưởng
--    (gán một lần, ghi nhật ký qua audit_memberships), rồi chuyển sang làm việc tại trường đó.
--  • Kiểm tra quyền không phụ thuộc đơn vị đang làm việc: đang ở trường A vẫn chuyển sang trường B được.
-- Cần chạy sau 121.

-- Người dùng có vai trò quản trị nền tảng (ở đơn vị KDI), bất kể đang làm việc ở đâu
create or replace function public.platform_staff_anywhere() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                   join roles r on r.id = m.role_id
                   join organizations o on o.id = m.org_id
                   join profiles p on p.id = m.user_id
                  where m.user_id = auth.uid() and p.locked_at is null
                    and r.key = 'platform_admin' and r.org_id is null and o.is_platform)
     and (public.jwt_aal() = 'aal2' or not coalesce((select enforce_mfa_db from security_settings where id = 1), false))
$$;

create or replace function public.platform_school_list()
returns table(org_id uuid, name text, parent_name text, member boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, par.name,
         exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = o.id)
    from organizations o
    left join organizations par on par.id = o.parent_id
   where public.platform_staff_anywhere() and o.type = 'school' and o.status = 'active'
   order by par.name nulls last, o.name
$$;

create or replace function public.platform_enter_school(p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_staff_anywhere() then
    raise exception 'Chỉ quản trị KDI chọn được mọi trường' using errcode = '42501';
  end if;
  if not exists (select 1 from organizations where id = p_org and type = 'school' and status = 'active') then
    raise exception 'Không tìm thấy trường đang hoạt động' using errcode = '22023';
  end if;
  if not exists (select 1 from memberships where user_id = auth.uid() and org_id = p_org) then
    insert into memberships (user_id, org_id, role_id, created_by)
      select auth.uid(), p_org, r.id, auth.uid() from roles r where r.key = 'principal' and r.org_id is null
    on conflict do nothing;
  end if;
  update profiles set org_id = p_org where id = auth.uid();
  return p_org;
end $$;

revoke all on function public.platform_staff_anywhere(), public.platform_school_list(), public.platform_enter_school(uuid) from public, anon;
grant execute on function public.platform_staff_anywhere(), public.platform_school_list(), public.platform_enter_school(uuid) to authenticated;

notify pgrst, 'reload schema';
