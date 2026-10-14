-- Quản trị gán tài khoản mới vào trường, gán vai trò và liên kết giáo viên.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key in ('principal','it_admin'))
$$;

-- Mọi tài khoản đăng ký đều có hồ sơ; người đầu tiên được gán Trường THCS Phố Hiến + Hiệu trưởng (chỉ demo).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare school uuid; admin_role uuid; first_user boolean;
begin
  first_user := not exists (select 1 from profiles);
  if first_user then
    select id into school from organizations where code = 'THCS-PH';
    select id into admin_role from roles where key = 'principal' and org_id is null;
  end if;
  insert into profiles (id, org_id, full_name, email)
    values (new.id, school, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email);
  if first_user then insert into user_roles (user_id, role_id) values (new.id, admin_role); end if;
  return new;
end $$;

create policy profiles_admin_unassigned on profiles for select to authenticated
  using (org_id is null and public.is_admin());
create policy profiles_admin_update on profiles for update to authenticated
  using (public.is_admin() and (org_id is null or public.can_access_org(org_id)))
  with check (public.is_admin() and org_id is not null and public.can_access_org(org_id));
create policy ur_admin_write on user_roles for all to authenticated
  using (public.is_admin() and exists (select 1 from profiles p where p.id = user_roles.user_id and (p.org_id is null or public.can_access_org(p.org_id))))
  with check (public.is_admin() and exists (select 1 from profiles p where p.id = user_roles.user_id and (p.org_id is null or public.can_access_org(p.org_id))));
