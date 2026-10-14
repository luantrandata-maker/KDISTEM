-- STEM Management System: Phase 1 (foundation) + Phase 2 (school operations)
create extension if not exists pgcrypto;

-- ===== Organizations (Sở GD&ĐT > Trường; Nhà cung cấp) =====
create table organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('department','school','provider')),
  parent_id uuid references organizations(id),
  code text unique,
  name text not null,
  level text check (level in ('mamnon','tieuhoc','thcs','thpt')),
  created_at timestamptz default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id),
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz default now()
);

-- ===== Roles & permission matrix (Xem / Chi tiết / Tạo / Sửa / Xoá) =====
create table roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),      -- null = system role
  key text not null,
  name text not null,
  is_system boolean default false,
  unique (org_id, key)
);
create table role_permissions (
  role_id uuid references roles(id) on delete cascade,
  module text not null,                           -- e.g. 'teachers','stem_rooms','equipment'
  can_view boolean default false, can_detail boolean default false,
  can_create boolean default false, can_edit boolean default false,
  can_delete boolean default false,
  primary key (role_id, module)
);
create table user_roles (
  user_id uuid references profiles(id) on delete cascade,
  role_id uuid references roles(id) on delete cascade,
  primary key (user_id, role_id)
);

-- ===== Academic calendar & school catalogs =====
create table academic_years (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,                             -- '2026-2027'
  term text not null,                             -- 'HK I' / 'HK II'
  starts_on date, ends_on date,
  is_current boolean default false
);
create table period_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,                             -- 'Tiết 1'
  starts_at time not null, ends_at time not null,
  session text not null check (session in ('morning','afternoon'))
);
create table buildings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null, note text
);
create table floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  name text not null
);

-- ===== People =====
create table teachers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  profile_id uuid references profiles(id),
  full_name text not null, email text,
  subject text, grade int,
  status text default 'active' check (status in ('active','inactive')),
  k12_synced_at timestamptz
);
create table classes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  year_id uuid references academic_years(id),
  name text not null, grade int not null,
  homeroom_teacher_id uuid references teachers(id)
);
create table students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  class_id uuid references classes(id),
  profile_id uuid references profiles(id),
  student_code text, full_name text not null
);
create table teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  year_id uuid references academic_years(id),
  teacher_id uuid not null references teachers(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject text not null,
  unique (year_id, teacher_id, class_id, subject)
);

-- ===== STEM rooms, equipment, warranty =====
create table stem_rooms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  floor_id uuid references floors(id),
  name text not null, capacity int,
  status text default 'active' check (status in ('active','maintenance','inactive'))
);
create table equipment_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  sku text, name text not null, brand text, category text
);
create table equipment_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  type_id uuid not null references equipment_types(id),
  room_id uuid references stem_rooms(id),
  serial text,
  status text default 'available'
    check (status in ('available','in_use','broken','maintenance','in_stock')),
  warranty_until date
);
create table warranty_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text unique, unit_id uuid references equipment_units(id),
  description text, reported_by uuid references profiles(id),
  status text default 'new'
    check (status in ('new','accepted','processing','resolved','rejected','closed')),
  created_at timestamptz default now()
);

-- ===== Row Level Security: scope by organization tree =====
create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as
$$ select org_id from profiles where id = auth.uid() $$;

create or replace function public.can_access_org(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select id from organizations where id = (select org_id from profiles where id = auth.uid())
    union all
    select o.id from organizations o join tree t on o.parent_id = t.id
  ) select exists (select 1 from tree where id = target)
$$;

do $$
declare t text;
begin
  foreach t in array array['academic_years','period_configs','buildings','teachers','classes',
    'students','teaching_assignments','stem_rooms','equipment_types','equipment_units','warranty_tickets']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (public.can_access_org(org_id)) with check (public.can_access_org(org_id))', t||'_org_scope', t);
  end loop;
end $$;

alter table organizations enable row level security;
create policy org_read on organizations for select to authenticated using (public.can_access_org(id));
alter table profiles enable row level security;
create policy profile_self_or_org on profiles for select to authenticated
  using (id = auth.uid() or public.can_access_org(org_id));
alter table roles enable row level security;
create policy roles_read on roles for select to authenticated using (org_id is null or public.can_access_org(org_id));
alter table role_permissions enable row level security;
create policy rp_read on role_permissions for select to authenticated using (true);
alter table user_roles enable row level security;
create policy ur_self on user_roles for select to authenticated using (user_id = auth.uid());
alter table floors enable row level security;
create policy floors_scope on floors for all to authenticated
  using (exists (select 1 from buildings b where b.id = building_id and public.can_access_org(b.org_id)));

-- ===== System roles =====
insert into roles (key, name, is_system) values
  ('it_admin','QTV CNTT',true), ('principal','Hiệu trưởng',true),
  ('teacher','Giáo viên',true), ('office_staff','Nhân viên văn phòng',true),
  ('student','Học sinh',true), ('department','Sở GD&ĐT',true), ('provider','Nhà cung cấp',true);
