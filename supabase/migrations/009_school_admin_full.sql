-- Mở rộng giao diện Trường – Quản trị theo video thứ hai:
-- phòng STEM (mã, diện tích, chương trình), thiết bị (nguồn, lịch sử), mượn–trả, bảo hành (quy trình NCC),
-- kế hoạch giáo dục, chương trình lớp, nội dung gói STEM, tập huấn (lộ trình, ghi danh, điểm danh).

alter table stem_rooms add column if not exists code text, add column if not exists area_m2 int,
  add column if not exists tier text not null default 'basic', add column if not exists programs text;
alter table equipment_units add column if not exists source text not null default 'package',
  add column if not exists package_id uuid references stem_packages(id) on delete set null;
alter table students add column if not exists status text not null default 'studying';
alter table stem_registrations add column if not exists program text, add column if not exists lesson text,
  add column if not exists equipment_note text;
alter table warranty_tickets drop constraint if exists warranty_tickets_status_check;
alter table warranty_tickets add constraint warranty_tickets_status_check
  check (status in ('draft','new','accepted','waiting_parts','processing','resolved','rejected','closed'));
alter table warranty_tickets add column if not exists provider text, add column if not exists provider_status text not null default 'pending',
  add column if not exists technician text;
alter table training_plans add column if not exists code text, add column if not exists year_no int, add column if not exists module_no int;
alter table training_lessons drop constraint if exists training_lessons_status_check;
alter table training_lessons add constraint training_lessons_status_check check (status in ('published','draft','inactive'));
alter table training_lessons add column if not exists blocks int not null default 0, add column if not exists materials int not null default 0,
  add column if not exists videos int not null default 0, add column if not exists docs int not null default 0;

create table equipment_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id),
  unit_id uuid not null references equipment_units(id) on delete cascade,
  kind text not null, title text not null, note text, created_at timestamptz not null default now()
);
create table borrow_requests (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id),
  teacher_id uuid references teachers(id) on delete set null, room_id uuid references stem_rooms(id) on delete set null,
  period_id uuid references period_configs(id) on delete set null,
  title text not null, items text, on_date date not null,
  mode text not null default 'in_room' check (mode in ('in_room','take_to_class')),
  status text not null default 'pending' check (status in ('pending','approved','lent','returned','rejected')),
  created_at timestamptz not null default now()
);
create table education_plans (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id),
  teacher_id uuid not null references teachers(id) on delete cascade,
  subject text not null, grade int not null, stem_periods int not null default 0
);
create table class_programs (
  org_id uuid not null references organizations(id), class_id uuid not null references classes(id) on delete cascade,
  program text not null check (program in ('CT1','CT2','CT3','CT4','CT5')), primary key (class_id, program)
);
create table package_topics (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id),
  package_id uuid not null references stem_packages(id) on delete cascade,
  seq int not null, program text not null, title text not null, minutes int not null default 0, grade_assigned int
);
create table package_topic_sessions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id),
  topic_id uuid not null references package_topics(id) on delete cascade, seq int not null, title text not null, minutes int not null default 45
);
create table training_enrollments (
  org_id uuid not null references organizations(id), plan_id uuid not null references training_plans(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade, completed boolean not null default false,
  primary key (plan_id, teacher_id)
);
create table training_attendance (
  org_id uuid not null references organizations(id), session_id uuid not null references training_sessions(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade, present boolean,
  primary key (session_id, teacher_id)
);

do $$
declare t text;
begin
  foreach t in array array['equipment_events','borrow_requests','education_plans','class_programs','package_topics','package_topic_sessions','training_enrollments','training_attendance']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (public.can_access_org(org_id)) with check (public.can_access_org(org_id))', t||'_org_scope', t);
  end loop;
end $$;
