-- 056: Phòng STEM, phòng học, kho — và vật tư theo từng phòng.
--   1. Loại phòng stem_rooms.room_kind: 'stem' (Phòng STEM, mặc định — mọi phòng đang có giữ nguyên), 'classroom' (Phòng học),
--      'storage' (Kho). Cùng một bảng nên thiết bị, kiểm kê, sự kiện, toà nhà/tầng dùng chung cho mọi loại phòng.
--      • Chỉ phòng STEM được xếp vào TKB, đăng ký dạy STEM, phiếu mượn tại phòng, buổi dạy (chặn ở CSDL) → sổ giữ chỗ,
--        chống trùng phòng (029) và mọi thống kê "Phòng STEM" của Sở/KDI không bị phòng học, kho làm lệch.
--      • Thống kê lọc theo loại: dept_school_stats (rooms, rooms_active) và room_overview chỉ đếm phòng STEM.
--      • Phòng học gắn với lớp: classes.room_id (phòng học của lớp, chỉ nhận phòng loại 'classroom' cùng trường).
--      • Đổi loại phòng: STEM → loại khác bị chặn khi phòng còn TKB / đăng ký / buổi dạy sắp tới / phiếu mượn đang mở;
--        Phòng học → loại khác bị chặn khi còn lớp dùng phòng.
--      • Xoá phòng (người dùng): chặn khi còn thiết bị hoặc vật tư trong phòng, hoặc còn TKB / lịch sắp tới.
--   2. Tồn vật tư theo vị trí (supply_stocks): mỗi vật tư có tồn ở từng phòng/kho, cộng với phần "chưa xếp phòng" (room_id null).
--      Tổng các vị trí luôn bằng supplies.qty. Phiếu nhập/xuất/điều chỉnh có thể ghi phòng; phiếu mới 'move' chuyển vật tư
--      giữa hai vị trí (không đổi tổng tồn). Xuất/điều chỉnh giảm không ghi phòng (vận chuyển 045, kiểm kê 044) lấy phần
--      chưa xếp phòng trước, rồi tới phòng nhiều nhất. Tồn từng vị trí chỉ đổi qua phiếu (không có quyền ghi trực tiếp).

-- ===== 1. Loại phòng =====
alter table stem_rooms add column if not exists room_kind text not null default 'stem';
alter table stem_rooms drop constraint if exists stem_rooms_room_kind_check;
alter table stem_rooms add constraint stem_rooms_room_kind_check check (room_kind in ('stem', 'classroom', 'storage'));
alter table stem_rooms add column if not exists note text;
create index if not exists stem_rooms_org_kind on stem_rooms (org_id, room_kind);

alter table classes add column if not exists room_id uuid references stem_rooms(id) on delete set null;
create index if not exists classes_room on classes (room_id) where room_id is not null;

-- Kiểm tra khi thêm / sửa phòng
create or replace function public.guard_room() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_n int;
begin
  if coalesce(btrim(new.name), '') = '' then raise exception 'Cần tên phòng' using errcode = '23514'; end if;
  new.name := btrim(new.name); new.code := nullif(btrim(coalesce(new.code, '')), '');
  if new.floor_id is not null and not exists (select 1 from floors f join buildings b on b.id = f.building_id
                                              where f.id = new.floor_id and b.org_id = new.org_id) then
    raise exception 'Tầng không thuộc trường' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then raise exception 'Không chuyển phòng sang đơn vị khác' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and new.room_kind <> old.room_kind then
    if old.room_kind = 'stem' then
      v_n := (select count(*) from timetable_entries where room_id = old.id)
           + (select count(*) from stem_registrations where room_id = old.id and status in ('pending', 'approved') and on_date >= v_today)
           + (select count(*) from teaching_sessions where room_id = old.id and session_date >= v_today and status <> 'cancelled')
           + (select count(*) from borrow_requests where room_id = old.id and status in ('pending', 'approved', 'lent'));
      if v_n > 0 then
        raise exception 'Phòng "%" đang có % lịch dạy / đăng ký / phiếu mượn STEM — gỡ khỏi TKB và xử lý phiếu trước khi đổi loại phòng', old.name, v_n
          using errcode = '23514';
      end if;
    elsif old.room_kind = 'classroom' and exists (select 1 from classes where room_id = old.id) then
      raise exception 'Phòng "%" đang là phòng học của lớp % — đổi phòng học của lớp trước', old.name,
        (select string_agg(name, ', ' order by name) from classes where room_id = old.id) using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists stem_rooms_guard on stem_rooms;
create trigger stem_rooms_guard before insert or update on stem_rooms for each row execute function public.guard_room();

-- Xoá phòng: người dùng không xoá được phòng còn đồ hoặc còn lịch (thông báo rõ thay vì lỗi khoá ngoại)
create or replace function public.guard_room_delete() returns trigger
language plpgsql set search_path = public as $$   -- không security definer: cần current_user thật của người xoá
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_units int; v_sup int; v_sched int;
begin
  if current_user not in ('authenticated', 'anon') then return old; end if;   -- migration, dọn dữ liệu thử
  v_units := (select count(*) from equipment_units where room_id = old.id);
  v_sup := (select count(*) from supply_stocks where room_id = old.id and qty > 0);
  if v_units + v_sup > 0 then
    raise exception 'Phòng "%" còn % thiết bị và % loại vật tư — chuyển sang phòng/kho khác trước khi xoá', old.name, v_units, v_sup using errcode = '23514';
  end if;
  v_sched := (select count(*) from timetable_entries where room_id = old.id)
           + (select count(*) from teaching_sessions where room_id = old.id and session_date >= v_today and status <> 'cancelled')
           + (select count(*) from stem_registrations where room_id = old.id and status in ('pending', 'approved') and on_date >= v_today);
  if v_sched > 0 then
    raise exception 'Phòng "%" còn % tiết / đăng ký trên lịch — gỡ khỏi TKB trước khi xoá', old.name, v_sched using errcode = '23514';
  end if;
  return old;
end $$;

-- Chỉ phòng STEM được xếp lịch dạy STEM, đăng ký dạy, mượn tại phòng, buổi dạy (sổ giữ chỗ 029 chỉ dành cho phòng STEM)
create or replace function public.guard_stem_room_ref() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.room_id is not null and not exists (select 1 from stem_rooms where id = new.room_id and org_id = new.org_id and room_kind = 'stem') then
    raise exception 'Chỉ chọn được phòng STEM của trường (phòng học và kho không xếp lịch STEM)' using errcode = '23514';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['timetable_entries', 'stem_registrations', 'borrow_requests', 'teaching_sessions'] loop
    execute format('drop trigger if exists %I on %I', t || '_stem_room', t);
    execute format('create trigger %I before insert or update of room_id on %I for each row execute function public.guard_stem_room_ref()', t || '_stem_room', t);
  end loop;
end $$;

-- Phòng học của lớp: phòng loại 'classroom' cùng trường
create or replace function public.guard_class_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.room_id is not null and not exists (select 1 from stem_rooms where id = new.room_id and org_id = new.org_id and room_kind = 'classroom') then
    raise exception 'Phòng học của lớp phải là phòng loại "Phòng học" của trường' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists classes_room_guard on classes;
create trigger classes_room_guard before insert or update of room_id on classes for each row execute function public.guard_class_room();

-- ===== 2. Tồn vật tư theo vị trí =====
create table if not exists supply_stocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  supply_id uuid not null references supplies(id) on delete cascade,
  room_id uuid references stem_rooms(id) on delete cascade,           -- null = chưa xếp phòng
  qty numeric(12,2) not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  constraint supply_stocks_loc unique nulls not distinct (supply_id, room_id)
);
create index if not exists supply_stocks_room on supply_stocks (room_id) where room_id is not null;
alter table supply_stocks enable row level security;
drop policy if exists supply_stocks_read on supply_stocks;
create policy supply_stocks_read on supply_stocks for select to authenticated using (public.can_access_org(org_id) and public.is_staff());
-- Không có policy ghi: tồn từng vị trí chỉ đổi qua phiếu (trigger apply_supply_move)

drop trigger if exists stem_rooms_guard_delete on stem_rooms;
create trigger stem_rooms_guard_delete before delete on stem_rooms for each row execute function public.guard_room_delete();

-- Tồn hiện có → phần "chưa xếp phòng"
insert into supply_stocks (org_id, supply_id, room_id, qty)
  select s.org_id, s.id, null, s.qty from supplies s where s.qty > 0
  on conflict (supply_id, room_id) do nothing;

alter table supply_moves add column if not exists room_id uuid references stem_rooms(id) on delete set null;      -- nơi nhập / xuất / điều chỉnh; nơi đi khi chuyển
alter table supply_moves add column if not exists to_room_id uuid references stem_rooms(id) on delete set null;   -- nơi đến khi chuyển (null = chưa xếp phòng)
alter table supply_moves drop constraint if exists supply_moves_kind_check;
alter table supply_moves add constraint supply_moves_kind_check check (kind in ('in', 'out', 'adjust', 'move'));
create index if not exists supply_moves_room on supply_moves (room_id) where room_id is not null;

create or replace function public.supply_loc_add(p_org uuid, p_supply uuid, p_room uuid, p_qty numeric) returns void
language sql security definer set search_path = public as $$
  insert into supply_stocks (org_id, supply_id, room_id, qty) values (p_org, p_supply, p_room, p_qty)
  on conflict (supply_id, room_id) do update set qty = supply_stocks.qty + excluded.qty, updated_at = now();
$$;

-- Lấy p_qty khỏi kho. p_strict: chỉ lấy đúng vị trí p_room; không thì lấy phần chưa xếp phòng trước, rồi phòng nhiều nhất.
create or replace function public.supply_loc_take(p_supply uuid, p_room uuid, p_qty numeric, p_strict boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_left numeric := p_qty; v_have numeric; v_take numeric; r record;
begin
  if p_strict then
    select qty into v_have from supply_stocks where supply_id = p_supply and room_id is not distinct from p_room for update;
    if coalesce(v_have, 0) < p_qty then
      raise exception 'Không đủ vật tư tại %: còn %', coalesce((select name from stem_rooms where id = p_room), 'phần chưa xếp phòng'),
        trim_scale(coalesce(v_have, 0)) using errcode = '23514';
    end if;
    update supply_stocks set qty = qty - p_qty, updated_at = now() where supply_id = p_supply and room_id is not distinct from p_room;
  else
    for r in select id, qty from supply_stocks where supply_id = p_supply and qty > 0
              order by (room_id is null) desc, qty desc, id for update loop
      v_take := least(r.qty, v_left);
      update supply_stocks set qty = qty - v_take, updated_at = now() where id = r.id;
      v_left := v_left - v_take;
      exit when v_left <= 0;
    end loop;
    if v_left > 0 then raise exception 'Không đủ tồn kho' using errcode = '23514'; end if;
  end if;
  delete from supply_stocks where supply_id = p_supply and qty = 0;
end $$;
revoke all on function public.supply_loc_add(uuid, uuid, uuid, numeric), public.supply_loc_take(uuid, uuid, numeric, boolean) from public, anon, authenticated;

create or replace function public.apply_supply_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_qty numeric; v_delta numeric := case new.kind when 'out' then -new.qty when 'move' then 0 else new.qty end;
begin
  select qty into v_qty from supplies where id = new.supply_id and org_id = new.org_id for update;
  if v_qty is null then raise exception 'Vật tư không thuộc đơn vị' using errcode = '23514'; end if;
  if new.kind = 'move' then
    if new.room_id is not distinct from new.to_room_id then raise exception 'Nơi chuyển đến phải khác nơi đi' using errcode = '22023'; end if;
    perform public.supply_loc_take(new.supply_id, new.room_id, new.qty, true);
    perform public.supply_loc_add(new.org_id, new.supply_id, new.to_room_id, new.qty);
    return new;
  end if;
  if new.to_room_id is not null then raise exception 'Chỉ phiếu chuyển vị trí có nơi đến' using errcode = '22023'; end if;
  if v_qty + v_delta < 0 then raise exception 'Không đủ tồn kho (còn %)', v_qty using errcode = '23514'; end if;
  update supplies set qty = qty + v_delta where id = new.supply_id;
  if v_delta > 0 then
    perform public.supply_loc_add(new.org_id, new.supply_id, new.room_id, v_delta);
  elsif v_delta < 0 then
    perform public.supply_loc_take(new.supply_id, new.room_id, -v_delta, new.room_id is not null);
  end if;
  return new;
end $$;

-- Phiếu vật tư / đợt kiểm kê chỉ gắn người nhận, lớp, phòng của chính trường (thêm nơi đi / nơi đến)
create or replace function public.guard_inventory_refs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'supply_moves' then
    if (new.teacher_id is not null and not exists (select 1 from teachers where id = new.teacher_id and org_id = new.org_id))
       or (new.class_id is not null and not exists (select 1 from classes where id = new.class_id and org_id = new.org_id)) then
      raise exception 'Người nhận / lớp không thuộc trường' using errcode = '23514';
    end if;
    if (new.room_id is not null and not exists (select 1 from stem_rooms where id = new.room_id and org_id = new.org_id))
       or (new.to_room_id is not null and not exists (select 1 from stem_rooms where id = new.to_room_id and org_id = new.org_id)) then
      raise exception 'Phòng không thuộc trường' using errcode = '23514';
    end if;
  elsif new.room_id is not null and not exists (select 1 from stem_rooms where id = new.room_id and org_id = new.org_id) then
    raise exception 'Phòng không thuộc trường' using errcode = '23514';
  end if;
  return new;
end $$;

-- ===== 3. Thống kê chỉ đếm phòng STEM =====
create or replace function public.dept_school_stats()
returns table (
  school_id uuid, code text, name text, level text, ward text, activated boolean,
  teachers int, stem_teachers int, students int, classes int, stem_classes int, stem_students int,
  programs text[], rooms int, rooms_active int, stem_periods int, total_periods int, room_periods int,
  lesson_plans int, products int, trained int, training_done int, attendance_rate numeric,
  units int, units_broken int, units_maintenance int, units_available int,
  graded int, avg_score numeric, k12_synced boolean, has_year boolean, last_activity timestamptz, kpi int
)
language sql stable security definer set search_path = public as $$
  with s as (
    select o.* from organizations o
    where o.type = 'school' and public.is_staff() and public.can_access_org(o.id)
  ),
  cur as (select org_id, id from academic_years where is_current),
  base as (
    select s.id as school_id, s.code, s.name, s.level, s.ward, s.activated_at is not null as activated,
      (select count(*) from teachers t where t.org_id = s.id and t.status = 'active')::int as teachers,
      (select count(distinct teacher_id) from stem_teacher_programs x where x.org_id = s.id)::int as stem_teachers,
      (select count(*) from students x where x.org_id = s.id and coalesce(x.status,'studying') = 'studying')::int as students,
      (select count(*) from classes c where c.org_id = s.id)::int as classes,
      (select count(distinct class_id) from class_programs cp where cp.org_id = s.id)::int as stem_classes,
      (select count(*) from students x where x.org_id = s.id and coalesce(x.status,'studying') = 'studying' and x.class_id in (select class_id from class_programs cp where cp.org_id = s.id))::int as stem_students,
      coalesce((select array_agg(distinct program order by program) from class_programs cp where cp.org_id = s.id), '{}') as programs,
      (select count(*) from stem_rooms r where r.org_id = s.id and r.room_kind = 'stem')::int as rooms,
      (select count(*) from stem_rooms r where r.org_id = s.id and r.room_kind = 'stem' and r.status = 'active')::int as rooms_active,
      (select count(*) from timetable_entries e where e.org_id = s.id and e.kind = 'stem'
         and (e.year_id is null or e.year_id in (select id from cur where cur.org_id = s.id)))::int as stem_periods,
      (select count(*) from timetable_entries e where e.org_id = s.id
         and (e.year_id is null or e.year_id in (select id from cur where cur.org_id = s.id)))::int as total_periods,
      (select count(*) from timetable_entries e where e.org_id = s.id and e.room_id is not null
         and (e.year_id is null or e.year_id in (select id from cur where cur.org_id = s.id)))::int as room_periods,
      (select count(*) from lesson_plans lp where lp.org_id = s.id and not lp.is_template and lp.status = 'published')::int as lesson_plans,
      (select count(*) from assignments a where a.org_id = s.id and a.kind = 'product')::int as products,
      (select count(distinct en.teacher_id) from training_enrollments en join teachers t on t.id = en.teacher_id where t.org_id = s.id)::int as trained,
      (select count(distinct en.teacher_id) from training_enrollments en join teachers t on t.id = en.teacher_id where t.org_id = s.id and en.completed)::int as training_done,
      (select round(100.0 * count(*) filter (where ta.present) / nullif(count(*) filter (where ta.present is not null), 0), 1)
         from training_attendance ta join teachers t on t.id = ta.teacher_id where t.org_id = s.id) as attendance_rate,
      (select count(*) from equipment_units u where u.org_id = s.id)::int as units,
      (select count(*) from equipment_units u where u.org_id = s.id and u.status = 'broken')::int as units_broken,
      (select count(*) from equipment_units u where u.org_id = s.id and u.status = 'maintenance')::int as units_maintenance,
      (select count(*) from equipment_units u where u.org_id = s.id and u.status = 'available')::int as units_available,
      (select count(*) from submissions x where x.org_id = s.id and x.status = 'graded')::int as graded,
      (select round(avg(x.score / nullif(a.max_score, 0) * 10), 2) from submissions x join assignments a on a.id = x.assignment_id
         where x.org_id = s.id and x.status = 'graded') as avg_score,
      exists (select 1 from teachers t where t.org_id = s.id and t.k12_synced_at is not null) as k12_synced,
      exists (select 1 from academic_years y where y.org_id = s.id) as has_year,
      greatest((select max(created_at) from stem_registrations x where x.org_id = s.id),
               (select max(submitted_at) from submissions x where x.org_id = s.id),
               (select max(started_at) from class_sessions x where x.org_id = s.id),
               (select max(updated_at) from lesson_plans x where x.org_id = s.id)) as last_activity
    from s
  )
  -- KPI tổng hợp 0–100: độ phủ CT (25) + phòng STEM (15) + tiết STEM/lớp (20) + tập huấn (20) + giáo án (10) + đồng bộ K12 (10)
  select b.*,
    round(
      25 * least(coalesce(array_length(b.programs, 1), 0), 5) / 5.0
    + 15 * least(b.rooms_active, 2) / 2.0
    + 20 * least(b.stem_periods::numeric / nullif(b.classes, 0), 2) / 2.0
    + 20 * coalesce(b.training_done::numeric / nullif(b.teachers, 0), 0)
    + 10 * least(b.lesson_plans::numeric / nullif(b.teachers, 0) * 2, 1)
    + 10 * (case when b.k12_synced then 1 else 0 end)
    )::int as kpi
  from base b
  order by b.name
$$;

create or replace function public.room_overview(p_from date, p_to date)
returns table (room_id uuid, org_id uuid, school text, parent_name text, room text, code text, status text,
               capacity int, tier text, slots int, booked int, from_sessions int, from_registrations int,
               from_borrows int, conflicts int, tkb_periods int)
language plpgsql stable security definer set search_path = public as $$
declare v_range tstzrange;
begin
  if not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Khoảng ngày không hợp lệ' using errcode = '22023';
  end if;
  v_range := tstzrange(p_from::timestamp at time zone 'Asia/Ho_Chi_Minh', (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh', '[)');
  return query
  with rm as (
    select r.*, o.name as school, par.name as parent_name from stem_rooms r
      join organizations o on o.id = r.org_id left join organizations par on par.id = o.parent_id
     where r.org_id in (select public.my_org_tree()) and r.room_kind = 'stem'
  ), days as (
    select count(*)::int as n from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) between 1 and 6
  ), bk as (
    select b.room_id, count(*) as n, count(*) filter (where b.source = 'teaching_session') as s,
           count(*) filter (where b.source = 'stem_registration') as r, count(*) filter (where b.source = 'borrow_request') as w
      from resource_bookings b where b.room_id in (select id from rm) and b.during && v_range group by b.room_id
  ), cf as (
    select c.room_id, count(*) as n from booking_conflicts c where c.room_id in (select id from rm) and c.during && v_range group by c.room_id
  )
  select rm.id, rm.org_id, rm.school, rm.parent_name, rm.name, rm.code, rm.status, rm.capacity, rm.tier,
    ((select n from days) * (select count(*) from period_configs p where p.org_id = rm.org_id))::int,
    coalesce(bk.n, 0)::int, coalesce(bk.s, 0)::int, coalesce(bk.r, 0)::int, coalesce(bk.w, 0)::int, coalesce(cf.n, 0)::int,
    (select count(*) from timetable_entries e where e.room_id = rm.id)::int
  from rm left join bk on bk.room_id = rm.id left join cf on cf.room_id = rm.id
  order by rm.school, rm.name;
end $$;

-- ===== 4. Dữ liệu mẫu: kho thiết bị và phòng học cho trường demo =====
do $$
declare sch uuid; v_kho uuid; v_stem uuid; c record; v_sup uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from stem_rooms where org_id = sch and room_kind <> 'stem') then return; end if;
  insert into stem_rooms (org_id, name, code, room_kind, status, tier, note)
    values (sch, 'Kho thiết bị STEM', 'KHO-01', 'storage', 'active', 'basic', 'Kho chung, tầng 1') returning id into v_kho;
  for c in select id, name from classes where org_id = sch order by name loop
    insert into stem_rooms (org_id, name, code, room_kind, capacity, status, tier)
      values (sch, 'Phòng ' || regexp_replace(c.name, '^Lớp\s*', ''), 'P-' || regexp_replace(c.name, '^Lớp\s*', ''), 'classroom', 45, 'active', 'basic') returning id into v_stem;
    update classes set room_id = v_stem where id = c.id;
  end loop;
  -- Thiết bị chưa xếp phòng → kho
  update equipment_units set room_id = v_kho, status = case when status = 'available' then 'in_stock' else status end
   where org_id = sch and room_id is null;
  -- Vật tư tiêu hao: nhập vào kho, chuyển một phần sang phòng STEM đầu tiên
  select id into v_stem from stem_rooms where org_id = sch and room_kind = 'stem' order by code nulls last, name limit 1;
  insert into supplies (org_id, sku, name, unit, category, min_qty) values
    (sch, 'PIN-AA', 'Pin AA', 'viên', 'Điện', 20), (sch, 'DAY-DIEN', 'Dây điện đơn 0,5 mm', 'm', 'Điện', 10),
    (sch, 'KEO-NEN', 'Keo nến', 'thanh', 'Vật liệu', 15)
    on conflict do nothing;
  for v_sup in select id from supplies where org_id = sch and sku in ('PIN-AA', 'DAY-DIEN', 'KEO-NEN') loop
    insert into supply_moves (org_id, supply_id, kind, qty, reason, room_id) values (sch, v_sup, 'in', 60, 'Tồn đầu kỳ (dữ liệu mẫu)', v_kho);
    if v_stem is not null then
      insert into supply_moves (org_id, supply_id, kind, qty, reason, room_id, to_room_id) values (sch, v_sup, 'move', 20, 'Đưa lên phòng STEM (dữ liệu mẫu)', v_kho, v_stem);
    end if;
  end loop;
end $$;
