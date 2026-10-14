-- Học sinh mẫu, ma trận phân quyền mẫu, quyền ghi cho quản trị
create policy rp_write on role_permissions for all to authenticated
  using (exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key in ('principal','it_admin')))
  with check (exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key in ('principal','it_admin')));

create policy ur_org_read on user_roles for select to authenticated
  using (exists (select 1 from profiles p where p.id = user_roles.user_id and public.can_access_org(p.org_id)));

insert into role_permissions (role_id, module, can_view, can_detail, can_create, can_edit, can_delete)
select r.id, m.module,
  r.key in ('principal','it_admin') or (r.key = 'teacher' and m.module in ('classes','students','timetable','stem_rooms')) or (r.key = 'office_staff' and m.module in ('teachers','classes','students')),
  r.key in ('principal','it_admin') or (r.key = 'teacher' and m.module in ('classes','students','timetable','stem_rooms')) or (r.key = 'office_staff' and m.module in ('teachers','classes','students')),
  r.key in ('principal','it_admin'), r.key in ('principal','it_admin'), r.key in ('principal','it_admin')
from roles r
cross join (values ('teachers'),('classes'),('students'),('assignments'),('stem_rooms'),('equipment'),('warranty'),
                   ('timetable'),('stem_registrations'),('buildings'),('periods'),('accounts'),('roles')) as m(module)
where r.org_id is null and r.key in ('principal','it_admin','teacher','office_staff')
on conflict do nothing;

do $$
declare sch uuid; c record; names text[] := array['Nguyễn Minh Anh','Trần Gia Bảo','Lê Khánh Chi','Phạm Đức Dũng','Hoàng Thu Hà','Vũ Quang Huy','Đặng Ngọc Lan','Bùi Tuấn Kiệt'];
        i int;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from students where org_id = sch) then return; end if;
  for c in select id, name, grade from classes where org_id = sch loop
    for i in 1..8 loop
      insert into students (org_id, class_id, student_code, full_name)
      values (sch, c.id, 'HS' || c.grade || upper(right(c.name,1)) || lpad(i::text, 3, '0'), names[i]);
    end loop;
  end loop;
end $$;
