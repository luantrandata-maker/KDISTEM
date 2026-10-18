-- 050: Sự kiện STEM (ngày hội, triển lãm, cuộc thi, hội thảo, tham quan…).
--   events: đơn vị tổ chức (trường / Phòng / Sở / KDI), thời gian, địa điểm, đối tượng (HS, GV, phụ huynh, cán bộ),
--   phạm vi (chỉ đơn vị mình hoặc cả đơn vị trực thuộc), đăng ký (sức chứa, hạn đăng ký), trạng thái nháp / công bố / huỷ.
--   event_registrations: HS tự đăng ký, phụ huynh đăng ký cho con, GV / cán bộ tự đăng ký; ban tổ chức điểm danh.
--   Công bố sự kiện của trường → thông báo cho người thuộc đối tượng có tài khoản ở trường.

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(btrim(title)) >= 3),
  kind text not null default 'festival' check (kind in ('festival', 'exhibition', 'competition', 'workshop', 'field_trip', 'other')),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  room_id uuid references stem_rooms(id) on delete set null,
  audience text[] not null default '{student}' check (audience <@ array['student', 'teacher', 'parent', 'staff'] and cardinality(audience) > 0),
  include_children boolean not null default false,
  registration boolean not null default false,
  capacity int check (capacity is null or capacity > 0),
  reg_deadline timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_org on events (org_id, starts_at desc);
create index if not exists events_time on events (starts_at) where status = 'published';

create table if not exists event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,     -- đơn vị của người đăng ký
  profile_id uuid not null references profiles(id) on delete cascade,      -- người bấm đăng ký
  student_id uuid references students(id) on delete cascade,               -- HS tham gia (HS tự đăng ký / phụ huynh đăng ký cho con)
  role text not null check (role in ('student', 'teacher', 'parent', 'staff')),
  full_name text not null,
  status text not null default 'registered' check (status in ('registered', 'cancelled', 'attended', 'absent')),
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists event_reg_one on event_registrations (event_id, profile_id, coalesce(student_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists event_reg_event on event_registrations (event_id, status);

-- Người quản lý sự kiện của một đơn vị
create or replace function public.can_manage_event(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (p_org = public.my_org_id() and (public.is_admin() or public.is_authority()))
$$;
-- Vai trò tham gia của người dùng hiện tại (theo đơn vị đang làm việc)
create or replace function public.my_event_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when public.my_student_id() is not null then 'student' end,
    case when public.my_teacher_id() is not null then 'teacher' end,
    case when public.is_parent() then 'parent' end,
    case when public.is_staff() then 'staff' end], null)
$$;
create or replace function public.event_for_me(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events e where e.id = p_event and e.status = 'published'
    and public.my_org_id() is not null
    and (e.org_id = public.my_org_id() or (e.include_children and public.org_in_tree(public.my_org_id(), e.org_id)))
    and e.audience && public.my_event_roles())
$$;
grant execute on function public.can_manage_event(uuid), public.my_event_roles(), public.event_for_me(uuid) to authenticated;

create or replace function public.guard_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.room_id is not null and not exists (select 1 from stem_rooms where id = new.room_id and org_id = new.org_id) then
    raise exception 'Phòng không thuộc đơn vị tổ chức' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Sự kiện đã huỷ' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists events_guard on events;
create trigger events_guard before insert or update on events for each row execute function public.guard_event();

alter table events enable row level security;
alter table event_registrations enable row level security;
drop policy if exists events_read on events;
create policy events_read on events for select to authenticated
  using ((select public.can_manage_event(org_id)) or (select public.event_for_me(id))
         or ((select public.is_authority()) and org_id in (select public.my_org_tree())));
drop policy if exists events_write on events;
create policy events_write on events for all to authenticated
  using ((select public.can_manage_event(org_id))) with check ((select public.can_manage_event(org_id)));
drop policy if exists event_registrations_read on event_registrations;
create policy event_registrations_read on event_registrations for select to authenticated
  using (profile_id = auth.uid() or exists (select 1 from events e where e.id = event_id and public.can_manage_event(e.org_id)));
drop policy if exists event_registrations_manage on event_registrations;
create policy event_registrations_manage on event_registrations for update to authenticated
  using (exists (select 1 from events e where e.id = event_id and public.can_manage_event(e.org_id)))
  with check (exists (select 1 from events e where e.id = event_id and public.can_manage_event(e.org_id)));
grant select, insert, update, delete on events to authenticated;
grant select, update on event_registrations to authenticated;

-- Đăng ký: HS (chính mình), phụ huynh (cho con: p_student), GV / cán bộ (chính mình)
create or replace function public.event_register(p_event uuid, p_student uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e events; v_role text; v_name text; v_student uuid; v_id uuid; n int;
begin
  select * into e from events where id = p_event for update;
  if e.id is null or not public.event_for_me(p_event) then raise exception 'Sự kiện không dành cho bạn' using errcode = '42501'; end if;
  if not e.registration then raise exception 'Sự kiện không cần đăng ký' using errcode = '22023'; end if;
  if e.reg_deadline is not null and now() > e.reg_deadline then raise exception 'Đã hết hạn đăng ký' using errcode = '22023'; end if;
  if now() > coalesce(e.ends_at, e.starts_at) then raise exception 'Sự kiện đã diễn ra' using errcode = '22023'; end if;
  if p_student is not null then
    if not public.is_guardian_of(p_student) or not ('parent' = any(e.audience) or 'student' = any(e.audience)) then
      raise exception 'Chỉ đăng ký được cho con của mình' using errcode = '42501';
    end if;
    v_role := 'parent'; v_student := p_student; select full_name into v_name from students where id = p_student;
  elsif public.my_student_id() is not null and 'student' = any(e.audience) then
    v_role := 'student'; v_student := public.my_student_id(); select full_name into v_name from students where id = v_student;
  elsif public.my_teacher_id() is not null and 'teacher' = any(e.audience) then
    v_role := 'teacher'; select full_name into v_name from teachers where id = public.my_teacher_id();
  elsif public.is_staff() and 'staff' = any(e.audience) then
    v_role := 'staff'; select full_name into v_name from profiles where id = auth.uid();
  else raise exception 'Bạn không thuộc đối tượng đăng ký' using errcode = '42501'; end if;
  select id into v_id from event_registrations where event_id = e.id and profile_id = auth.uid() and student_id is not distinct from v_student;
  if v_id is not null then
    update event_registrations set status = 'registered' where id = v_id and status = 'cancelled';
  end if;
  select count(*) into n from event_registrations where event_id = e.id and status in ('registered', 'attended') and id is distinct from v_id;
  if e.capacity is not null and n >= e.capacity then raise exception 'Đã đủ số lượng đăng ký' using errcode = '22023'; end if;
  if v_id is null then
    insert into event_registrations (event_id, org_id, profile_id, student_id, role, full_name)
      values (e.id, public.my_org_id(), auth.uid(), v_student, v_role, coalesce(v_name, 'Người tham gia')) returning id into v_id;
  end if;
  return v_id;
end $$;
create or replace function public.event_unregister(p_event uuid, p_student uuid default null) returns void
language sql security definer set search_path = public as $$
  update event_registrations set status = 'cancelled'
   where event_id = p_event and profile_id = auth.uid() and status = 'registered'
     and student_id is not distinct from coalesce(p_student, public.my_student_id())
$$;
-- Danh sách sự kiện của tôi (kèm trạng thái đăng ký và số đã đăng ký)
create or replace function public.my_events(p_from timestamptz default now() - interval '1 day')
returns table (id uuid, title text, kind text, description text, starts_at timestamptz, ends_at timestamptz, location text, organizer text,
               audience text[], registration boolean, capacity int, reg_deadline timestamptz, registered int, my_regs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.kind, e.description, e.starts_at, e.ends_at, coalesce(e.location, r.name), o.name, e.audience, e.registration, e.capacity, e.reg_deadline,
         (select count(*)::int from event_registrations x where x.event_id = e.id and x.status in ('registered', 'attended')),
         (select coalesce(jsonb_agg(jsonb_build_object('student_id', x.student_id, 'status', x.status, 'name', x.full_name)), '[]'::jsonb)
            from event_registrations x where x.event_id = e.id and x.profile_id = auth.uid())
    from events e join organizations o on o.id = e.org_id left join stem_rooms r on r.id = e.room_id
   where public.event_for_me(e.id) and coalesce(e.ends_at, e.starts_at) >= p_from
   order by e.starts_at
$$;
revoke all on function public.event_register(uuid, uuid), public.event_unregister(uuid, uuid), public.my_events(timestamptz) from public, anon;
grant execute on function public.event_register(uuid, uuid), public.event_unregister(uuid, uuid), public.my_events(timestamptz) to authenticated;

-- Công bố sự kiện của trường → thông báo cho người thuộc đối tượng
create or replace function public.notify_event_published() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record; v_title text;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return null; end if;
  if (select type from organizations where id = new.org_id) <> 'school' then return null; end if;   -- sự kiện cấp Sở: xem trong danh sách
  v_title := 'Sự kiện mới: ' || new.title;
  for u in
    select distinct m.user_id, r.portal from memberships m join roles r on r.id = m.role_id
     where m.org_id = new.org_id and r.portal in ('student', 'teacher', 'school_admin', 'parent')
       and ((r.portal = 'student' and 'student' = any(new.audience)) or (r.portal = 'teacher' and ('teacher' = any(new.audience) or 'staff' = any(new.audience)))
            or (r.portal = 'school_admin' and 'staff' = any(new.audience)) or (r.portal = 'parent' and 'parent' = any(new.audience)))
  loop
    perform public.notify_user(u.user_id, new.org_id, 'status', v_title,
      to_char(new.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') || coalesce(' · ' || new.location, ''), 'Sự kiện', u.portal, new.id);
  end loop;
  return null;
end $$;
drop trigger if exists events_notify on events;
create trigger events_notify after insert or update of status on events for each row execute function public.notify_event_published();

notify pgrst, 'reload schema';
