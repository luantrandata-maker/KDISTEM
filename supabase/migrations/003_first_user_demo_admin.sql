-- DEMO: người đăng ký đầu tiên trở thành quản trị Trường THCS Phố Hiến.
-- Xoá trigger này trước khi dùng thật.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare school uuid; admin_role uuid;
begin
  if not exists (select 1 from profiles) then
    select id into school from organizations where code = 'THCS-PH';
    select id into admin_role from roles where key = 'principal' and org_id is null;
    insert into profiles (id, org_id, full_name, email)
      values (new.id, school, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email);
    insert into user_roles (user_id, role_id) values (new.id, admin_role);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
