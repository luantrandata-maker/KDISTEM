-- Gói STEM, tập huấn giáo viên, phân phối chương trình, giáo viên dạy STEM theo chương trình
create table stem_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text, name text not null, tier text not null default 'basic' check (tier in ('premium','basic','advanced')),
  provider text, programs text, grades text,
  starts_on date, ends_on date, contract_no text, order_no text,
  topics int default 0, devices int default 0, sessions int default 0
);
create table training_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null, program text, provider text,
  mode text not null default 'online' check (mode in ('online','offline','hybrid')),
  status text not null default 'ongoing' check (status in ('planned','ongoing','done')),
  hours int
);
create table training_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  plan_id uuid not null references training_plans(id) on delete cascade,
  title text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  mode text not null default 'online' check (mode in ('online','offline')), location text
);
create table training_lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  plan_id uuid references training_plans(id) on delete set null,
  title text not null, grades text, subject text, author text,
  status text not null default 'published' check (status in ('published','draft')),
  created_on date default current_date
);
create table certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  teacher_id uuid not null references teachers(id) on delete cascade,
  plan_id uuid not null references training_plans(id) on delete cascade,
  code text unique, issued_on date
);
create table curriculum_books (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  grade int not null, subject text not null, title text not null, total_periods int
);
create table stem_teacher_programs (
  org_id uuid not null references organizations(id),
  teacher_id uuid not null references teachers(id) on delete cascade,
  program text not null check (program in ('CT1','CT2','CT3','CT4','CT5')),
  primary key (teacher_id, program)
);

do $$
declare t text;
begin
  foreach t in array array['stem_packages','training_plans','training_sessions','training_lessons','certificates','curriculum_books','stem_teacher_programs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (public.can_access_org(org_id)) with check (public.can_access_org(org_id))', t||'_org_scope', t);
  end loop;
end $$;

-- Dữ liệu mẫu cho trường THCS Phố Hiến
do $$
declare sch uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; g int; s record;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from stem_packages where org_id = sch) then return; end if;

  insert into stem_packages (org_id, code, name, tier, provider, programs, grades, starts_on, ends_on, contract_no, order_no, topics, devices, sessions) values
   (sch,'GOI-001','Gói STEM THCS Toàn diện — Khối 6→9','premium','KDI Education','CT1,CT2,CT3,CT4,CT5','6–9','2025-09-05','2028-08-31','HDKT-2025-004','DDBH-2025-004',21,119,52),
   (sch,'GOI-002','Gói STEM Cơ bản','basic','KDI Education','CT1,CT2,CT3','6–7','2025-09-01','2027-08-31','HDKT-2025-005','DDBH-2025-005',4,62,12),
   (sch,'GOI-003','Gói STEM Nâng cao — IoT & Môi trường','advanced','KDI Education','CT3,CT4,CT5','8–9','2025-09-01','2026-08-15','HDKT-2025-002','DDBH-2025-002',2,62,7);

  insert into training_plans (org_id, name, program, provider, mode, status, hours) values (sch,'Tập huấn STEM Robotics học kỳ 1 2026-2027','CT4','Nexta','online','ongoing',12) returning id into p1;
  insert into training_plans (org_id, name, program, provider, mode, status, hours) values (sch,'Tập huấn Lập trình Scratch nâng cao','CT2','KDI Education','hybrid','ongoing',16) returning id into p2;
  insert into training_plans (org_id, name, program, provider, mode, status, hours) values (sch,'Bồi dưỡng IoT cho trường học','CT5','Nexta','offline','planned',10) returning id into p3;
  insert into training_plans (org_id, name, program, provider, mode, status, hours) values (sch,'Tập huấn STEM cơ bản năm học 2025-2026','CT1','KDI Education','online','done',8) returning id into p4;

  insert into training_sessions (org_id, plan_id, title, starts_at, ends_at, mode, location) values
   (sch,p1,'Buổi 1: Giới thiệu robot và bộ thiết bị','2026-09-15 08:00+07','2026-09-15 11:00+07','online',null),
   (sch,p1,'Buổi 2: Lập trình robot cơ bản','2026-10-14 08:00+07','2026-10-14 11:00+07','online',null),
   (sch,p1,'Buổi 3: Cảm biến và tránh vật cản','2026-10-28 08:00+07','2026-10-28 11:00+07','online',null),
   (sch,p1,'Buổi 4: Dự án robot cuối khóa','2026-11-11 08:00+07','2026-11-11 11:00+07','online',null),
   (sch,p2,'Buổi 1: Vòng lặp và biến trong Scratch','2026-10-05 13:30+07','2026-10-05 16:30+07','offline','Phòng STEM 1'),
   (sch,p2,'Buổi 2: Thiết kế trò chơi tương tác','2026-10-21 13:30+07','2026-10-21 16:30+07','offline','Phòng STEM 1'),
   (sch,p3,'Buổi 1: Giới thiệu IoT và cảm biến','2026-11-18 08:00+07','2026-11-18 11:00+07','offline','Phòng IoT & AI'),
   (sch,p3,'Buổi 2: Kết nối gateway','2026-11-25 08:00+07','2026-11-25 11:00+07','offline','Phòng IoT & AI'),
   (sch,p4,'Buổi 1: Phương pháp dạy học STEM 5E','2025-10-10 08:00+07','2025-10-10 11:00+07','online',null),
   (sch,p4,'Buổi 2: Thiết kế bài học tích hợp','2025-10-24 08:00+07','2025-10-24 11:00+07','online',null);

  insert into training_lessons (org_id, plan_id, title, grades, subject, author, status, created_on) values
   (sch,p4,'Tổng quan phương pháp 5E trong STEM','Lớp 6–9','Liên môn','Nguyễn Quang Dũng','published','2025-10-02'),
   (sch,p4,'Thiết kế bài học tích hợp STEM','Lớp 6–9','Liên môn','Đỗ Thu Trang','published','2025-10-08'),
   (sch,p1,'Robotics cơ bản với mBot','Lớp 6–7','Công nghệ','Nguyễn Quang Dũng','published','2026-09-01'),
   (sch,p1,'Lập trình cảm biến siêu âm','Lớp 8–9','Tin học','Lê Hồng Phúc','draft','2026-10-12'),
   (sch,p2,'Scratch nâng cao: trò chơi tương tác','Lớp 6–8','Tin học','Đỗ Thu Trang','published','2026-09-20'),
   (sch,p3,'IoT cho trường học','Lớp 8–9','Công nghệ','Lê Hồng Phúc','draft','2026-10-10');

  insert into certificates (org_id, teacher_id, plan_id, code, issued_on)
  select sch, t.id, p4, 'CC-2025-' || lpad(row_number() over (order by t.full_name)::text, 3, '0'), date '2025-11-05'
  from teachers t where t.org_id = sch and t.full_name in ('Phạm Anh Tuấn','Trần Văn Hùng','Lê Minh Trang','Nguyễn Thị Lan');

  for g in 6..9 loop
    for s in select * from (values ('Toán',140),('Khoa học tự nhiên',140),('Tin học',35),('Công nghệ',35)) as v(subject, periods) loop
      insert into curriculum_books (org_id, grade, subject, title, total_periods) values (sch, g, s.subject, s.subject || ' ' || g, s.periods);
    end loop;
  end loop;

  insert into stem_teacher_programs (org_id, teacher_id, program)
  select sch, t.id, p.program from teachers t
  join (values ('Công nghệ','CT1'),('Công nghệ','CT4'),('Tin học','CT2'),('Tin học','CT4'),('Toán','CT1'),('Khoa học tự nhiên','CT3')) as p(subject, program) on p.subject = t.subject
  where t.org_id = sch;
end $$;
