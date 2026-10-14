-- Thời khóa biểu và đăng ký dạy STEM
create table timetable_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  year_id uuid references academic_years(id),
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid references teachers(id) on delete set null,
  period_id uuid not null references period_configs(id) on delete cascade,
  weekday int not null check (weekday between 2 and 7),     -- 2 = Thứ 2 ... 7 = Thứ 7
  subject text not null,
  kind text not null default 'regular' check (kind in ('regular','stem')),
  room_id uuid references stem_rooms(id),
  unique (class_id, weekday, period_id),
  unique (teacher_id, weekday, period_id)
);

create table stem_registrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  teacher_id uuid not null references teachers(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  room_id uuid not null references stem_rooms(id),
  period_id uuid not null references period_configs(id),
  on_date date not null,
  topic text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);

alter table timetable_entries enable row level security;
create policy timetable_org_scope on timetable_entries for all to authenticated
  using (public.can_access_org(org_id)) with check (public.can_access_org(org_id));
alter table stem_registrations enable row level security;
create policy stem_reg_org_scope on stem_registrations for all to authenticated
  using (public.can_access_org(org_id)) with check (public.can_access_org(org_id));

-- Dữ liệu mẫu (chỉ khi trường mẫu tồn tại và chưa có thời khóa biểu)
do $$
declare sch uuid; yr uuid; room1 uuid; room2 uuid; p1 uuid; p2 uuid;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from timetable_entries where org_id = sch) then return; end if;
  select id into yr from academic_years where org_id = sch and is_current limit 1;
  select id into room1 from stem_rooms where org_id = sch and name = 'Phòng STEM 1';
  select id into room2 from stem_rooms where org_id = sch and name = 'Phòng Robotics';
  select id into p1 from period_configs where org_id = sch and name = 'Tiết 2';
  select id into p2 from period_configs where org_id = sch and name = 'Tiết 3';

  insert into timetable_entries (org_id, year_id, class_id, teacher_id, period_id, weekday, subject, kind, room_id)
  select sch, yr, ta.class_id, ta.teacher_id, pc.id, 1 + ta.rn, ta.subject,
         case when ta.subject in ('Công nghệ','Tin học') then 'stem' else 'regular' end,
         case when ta.subject in ('Công nghệ','Tin học') then room1 end
  from (select a.*, row_number() over (partition by a.class_id order by a.subject) as rn from teaching_assignments a where a.org_id = sch) ta
  join (select id, row_number() over (order by starts_at) as n from period_configs where org_id = sch) pc on pc.n = ta.rn;

  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic, status)
  select sch, t.id, c.id, room1, p1, date '2026-10-15', 'Thiết kế mạch điện điều khiển', 'pending'
    from teachers t, classes c where t.org_id = sch and t.full_name = 'Trần Văn Hùng' and c.org_id = sch and c.name = 'Lớp 7A';
  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic, status)
  select sch, t.id, c.id, room1, p1, date '2026-10-15', 'Mô hình nhà thông minh', 'pending'
    from teachers t, classes c where t.org_id = sch and t.full_name = 'Lê Minh Trang' and c.org_id = sch and c.name = 'Lớp 8A';
  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic, status)
  select sch, t.id, c.id, room2, p2, date '2026-10-16', 'Lập trình robot tránh vật cản', 'pending'
    from teachers t, classes c where t.org_id = sch and t.full_name = 'Phạm Anh Tuấn' and c.org_id = sch and c.name = 'Lớp 9A';
  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic, status)
  select sch, t.id, c.id, room2, p1, date '2026-10-14', 'Rút gọn biểu thức bằng máy tính', 'approved'
    from teachers t, classes c where t.org_id = sch and t.full_name = 'Đặng Tuấn Anh' and c.org_id = sch and c.name = 'Lớp 7A';
end $$;
