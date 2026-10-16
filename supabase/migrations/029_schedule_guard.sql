-- 029: Chống trùng lịch phòng STEM, giáo viên và thiết bị ngay ở CSDL (S3)
-- Trước đây hai phiếu có thể đặt cùng một phòng, cùng giờ; TKB mẫu có 75 chỗ trùng phòng STEM.
--   • resource_bookings: sổ giữ chỗ phòng STEM, gom từ buổi dạy, đăng ký dạy STEM và phiếu mượn dùng tại phòng.
--     Ràng buộc loại trừ (btree_gist): cùng phòng, khung giờ chồng nhau, khác lớp → bị chặn, kể cả hai lệnh ghi đồng thời.
--     Cùng một lớp dùng lại phòng của chính tiết mình (vd: GV đăng ký dạy STEM đúng tiết TKB của lớp đó) không tính là trùng.
--   • booking_conflicts: chỗ trùng có sẵn từ trước (dữ liệu cũ, TKB cũ) — không chặn, ghi lại để trường xử lý.
--     Khi tiết/phiếu đang giữ chỗ bị huỷ hoặc đổi, hệ thống tự thử xếp lại các tiết đang chờ.
--   • Thời khoá biểu: chặn thêm/sửa tiết làm trùng phòng hoặc trùng GV (kể cả TKB "mọi học kỳ" đè TKB riêng học kỳ).
--   • Giáo viên: chặn tiết dạy bù / tiết sửa tay và đăng ký dạy STEM trùng giờ với tiết khác của chính GV đó.
--   • Thiết bị: phiếu mượn được gửi tự do (như trước), nhưng chỉ duyệt/giao được khi còn đủ thiết bị dùng được
--     trong khung giờ đó (trừ các phiếu đã duyệt/đang mượn chồng giờ). equipment_availability() cho giao diện.
--   • room_overview(): phòng STEM toàn hệ thống — công suất, số tiết đã giữ, chỗ trùng (cổng nền tảng, Sở, trường).
--   • equipment_overview() / equipment_type_summary(): thiết bị theo trường và theo loại (cổng nền tảng, Sở).
-- Quy tắc "mềm/cứng": tiết sinh từ TKB giữ đúng phòng/GV của TKB → trùng thì ghi lại (không làm hỏng việc sinh buổi dạy);
-- mọi thao tác người dùng làm tay (dạy bù, đổi phòng, đăng ký, mượn phòng, sửa TKB) → trùng thì báo lỗi 23P01.

-- ===== 1. Tiện ích =====
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    create extension if not exists btree_gist with schema extensions;
  else
    create extension if not exists btree_gist;
  end if;
end $$;

-- Khung giờ của một tiết trong ngày (giờ Việt Nam). Không có tiết → cả ngày.
create or replace function public.period_slot(p_day date, p_period uuid) returns tstzrange
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tstzrange((p_day + p.starts_at) at time zone 'Asia/Ho_Chi_Minh', (p_day + p.ends_at) at time zone 'Asia/Ho_Chi_Minh', '[)')
       from period_configs p where p.id = p_period),
    tstzrange(p_day::timestamp at time zone 'Asia/Ho_Chi_Minh', (p_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh', '[)'))
$$;

create or replace function public.slot_text(p_during tstzrange) returns text
language sql immutable as $$
  select to_char(lower(p_during) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') || '–' ||
         to_char(upper(p_during) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI')
$$;

-- ===== 2. Sổ giữ chỗ phòng STEM =====
create table if not exists resource_bookings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  room_id     uuid not null references stem_rooms(id) on delete cascade,
  holder_id   uuid not null,                 -- lớp (hoặc GV nếu phiếu không gắn lớp)
  during      tstzrange not null,
  source      text not null check (source in ('teaching_session', 'stem_registration', 'borrow_request')),
  source_id   uuid not null,
  label       text,
  created_at  timestamptz not null default now(),
  unique (source, source_id),
  constraint resource_bookings_no_overlap exclude using gist (room_id with =, during with &&, holder_id with <>)
);
create index if not exists resource_bookings_org_during on resource_bookings using gist (org_id, during);

create table if not exists booking_conflicts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  room_id         uuid not null references stem_rooms(id) on delete cascade,
  holder_id       uuid not null,
  during          tstzrange not null,
  source          text not null,
  source_id       uuid not null,
  label           text,
  blocking_source text,
  blocking_id     uuid,
  blocking_label  text,
  detected_at     timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists booking_conflicts_blocking on booking_conflicts (blocking_source, blocking_id);
create index if not exists booking_conflicts_org on booking_conflicts (org_id, during);

alter table resource_bookings enable row level security;
alter table booking_conflicts enable row level security;
-- Chỉ đọc (cán bộ trong phạm vi; giáo viên xem lịch phòng của trường). Ghi chỉ qua trigger.
create policy resource_bookings_read on resource_bookings for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
create policy booking_conflicts_read on booking_conflicts for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));

-- Ghi một chỗ giữ phòng. Trùng: p_soft → ghi vào booking_conflicts; ngược lại báo lỗi 23P01 kèm tiết đang giữ phòng.
create or replace function public.booking_put(p_org uuid, p_room uuid, p_holder uuid, p_during tstzrange,
  p_source text, p_source_id uuid, p_label text, p_soft boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare b resource_bookings; v_room text;
begin
  begin
    insert into resource_bookings (org_id, room_id, holder_id, during, source, source_id, label)
    values (p_org, p_room, p_holder, p_during, p_source, p_source_id, p_label);
    delete from booking_conflicts where source = p_source and source_id = p_source_id;
    return true;
  exception when exclusion_violation then
    select * into b from resource_bookings
     where room_id = p_room and during && p_during and holder_id <> p_holder
     order by lower(during) limit 1;
    if p_soft then
      insert into booking_conflicts (org_id, room_id, holder_id, during, source, source_id, label, blocking_source, blocking_id, blocking_label)
      values (p_org, p_room, p_holder, p_during, p_source, p_source_id, p_label, b.source, b.source_id, b.label)
      on conflict (source, source_id) do update set room_id = excluded.room_id, holder_id = excluded.holder_id,
        during = excluded.during, label = excluded.label, blocking_source = excluded.blocking_source,
        blocking_id = excluded.blocking_id, blocking_label = excluded.blocking_label, detected_at = now();
      return false;
    end if;
    select name into v_room from stem_rooms where id = p_room;
    raise exception '% đã có lịch lúc %: %', coalesce(v_room, 'Phòng'), public.slot_text(b.during), coalesce(b.label, 'tiết khác')
      using errcode = '23P01', hint = 'Chọn phòng hoặc tiết khác, hoặc huỷ lịch đang giữ phòng.';
  end;
end $$;
revoke all on function public.booking_put(uuid, uuid, uuid, tstzrange, text, uuid, text, boolean) from public, authenticated;

-- Thử xếp lại các chỗ đang chờ do một nguồn chặn (sau khi nguồn đó huỷ/đổi/xoá)
create or replace function public.booking_retry(p_source text, p_source_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c booking_conflicts;
begin
  for c in select * from booking_conflicts where blocking_source = p_source and blocking_id = p_source_id order by detected_at loop
    perform public.booking_put(c.org_id, c.room_id, c.holder_id, c.during, c.source, c.source_id, c.label, true);
  end loop;
end $$;
revoke all on function public.booking_retry(text, uuid) from public, authenticated;

-- ===== 3. Đồng bộ từ từng nguồn =====
-- Buổi dạy: giữ phòng khi chưa huỷ. Phòng đúng như TKB của tiết đó → trùng thì ghi lại (mềm).
create or replace function public.booking_refresh_session(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s teaching_sessions; v_soft boolean; v_label text;
begin
  delete from resource_bookings where source = 'teaching_session' and source_id = p_id;
  delete from booking_conflicts where source = 'teaching_session' and source_id = p_id;
  select * into s from teaching_sessions where id = p_id;
  if found and s.room_id is not null and s.status <> 'cancelled' then
    v_soft := s.timetable_entry_id is not null and not s.is_makeup
      and s.room_id is not distinct from (select e.room_id from timetable_entries e where e.id = s.timetable_entry_id);
    select concat_ws(' · ', p.name, c.name, s.subject) into v_label
      from period_configs p, classes c where p.id = s.period_id and c.id = s.class_id;
    perform public.booking_put(s.org_id, s.room_id, s.class_id, public.period_slot(s.session_date, s.period_id),
      'teaching_session', s.id, coalesce(v_label, s.subject), v_soft);
  end if;
  perform public.booking_retry('teaching_session', p_id);
end $$;

create or replace function public.booking_refresh_registration(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r stem_registrations; v_label text;
begin
  delete from resource_bookings where source = 'stem_registration' and source_id = p_id;
  delete from booking_conflicts where source = 'stem_registration' and source_id = p_id;
  select * into r from stem_registrations where id = p_id;
  if found and r.room_id is not null and r.status in ('pending', 'approved') then
    select concat_ws(' · ', 'Đăng ký dạy STEM', c.name, r.topic) into v_label from classes c where c.id = r.class_id;
    perform public.booking_put(r.org_id, r.room_id, r.class_id, public.period_slot(r.on_date, r.period_id),
      'stem_registration', r.id, v_label, coalesce(current_setting('kdi.booking_soft', true), '') = 'on');
  end if;
  perform public.booking_retry('stem_registration', p_id);
end $$;

create or replace function public.booking_refresh_borrow(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b borrow_requests; v_label text;
begin
  delete from resource_bookings where source = 'borrow_request' and source_id = p_id;
  delete from booking_conflicts where source = 'borrow_request' and source_id = p_id;
  select * into b from borrow_requests where id = p_id;
  if found and b.mode = 'in_room' and b.room_id is not null and b.status in ('pending', 'approved', 'lent') then
    select concat_ws(' · ', 'Phiếu mượn', c.name, b.title) into v_label from (select 1) x left join classes c on c.id = b.class_id;
    perform public.booking_put(b.org_id, b.room_id, coalesce(b.class_id, b.teacher_id, b.id), public.period_slot(b.on_date, b.period_id),
      'borrow_request', b.id, v_label, coalesce(current_setting('kdi.booking_soft', true), '') = 'on');
  end if;
  perform public.booking_retry('borrow_request', p_id);
end $$;
revoke all on function public.booking_refresh_session(uuid) from public, authenticated;
revoke all on function public.booking_refresh_registration(uuid) from public, authenticated;
revoke all on function public.booking_refresh_borrow(uuid) from public, authenticated;

create or replace function public.booking_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'UPDATE' then
    -- Chỉ đồng bộ lại khi đổi thứ liên quan đến lịch (điểm danh, ghi chú… không đụng sổ giữ chỗ)
    -- (IF lồng nhau: mỗi bảng có cột khác nhau, PL/pgSQL không được đọc cột của bảng khác)
    if tg_table_name = 'teaching_sessions' then
      if (old.room_id, old.class_id, old.session_date, old.period_id, old.status = 'cancelled', old.is_makeup, old.timetable_entry_id)
         is not distinct from (new.room_id, new.class_id, new.session_date, new.period_id, new.status = 'cancelled', new.is_makeup, new.timetable_entry_id) then return null; end if;
    elsif tg_table_name = 'stem_registrations' then
      if (old.room_id, old.class_id, old.on_date, old.period_id, old.status in ('pending', 'approved'))
         is not distinct from (new.room_id, new.class_id, new.on_date, new.period_id, new.status in ('pending', 'approved')) then return null; end if;
    else
      if (old.room_id, old.class_id, old.on_date, old.period_id, old.mode, old.status in ('pending', 'approved', 'lent'))
         is not distinct from (new.room_id, new.class_id, new.on_date, new.period_id, new.mode, new.status in ('pending', 'approved', 'lent')) then return null; end if;
    end if;
  end if;
  if tg_table_name = 'teaching_sessions' then perform public.booking_refresh_session(v_id);
  elsif tg_table_name = 'stem_registrations' then perform public.booking_refresh_registration(v_id);
  else perform public.booking_refresh_borrow(v_id); end if;
  return null;
end $$;

drop trigger if exists booking_sync on teaching_sessions;
create trigger booking_sync after insert or update or delete on teaching_sessions for each row execute function public.booking_sync();
drop trigger if exists booking_sync on stem_registrations;
create trigger booking_sync after insert or update or delete on stem_registrations for each row execute function public.booking_sync();
drop trigger if exists booking_sync on borrow_requests;
create trigger booking_sync after insert or update or delete on borrow_requests for each row execute function public.booking_sync();

-- ===== 4. Giáo viên không dạy hai lớp cùng lúc =====
-- Buổi dạy làm tay (dạy bù, đổi GV/ngày/tiết) và đăng ký dạy STEM. Tiết sinh đúng từ TKB đã được TKB bảo vệ.
create or replace function public.teacher_slot_busy(p_teacher uuid, p_day date, p_period uuid, p_class uuid,
  p_skip_session uuid, p_skip_reg uuid) returns text
language sql stable security definer set search_path = public as $$
  select x.label from (
    select concat_ws(' · ', p.name, c.name, s.subject) as label
      from teaching_sessions s join period_configs p on p.id = s.period_id join classes c on c.id = s.class_id
     where s.teacher_id = p_teacher and s.session_date = p_day and s.status <> 'cancelled'
       and s.class_id <> p_class and s.id is distinct from p_skip_session
       and public.period_slot(s.session_date, s.period_id) && public.period_slot(p_day, p_period)
    union all
    select concat_ws(' · ', 'Đăng ký dạy STEM', c.name, r.topic)
      from stem_registrations r join classes c on c.id = r.class_id
     where r.teacher_id = p_teacher and r.on_date = p_day and r.status in ('pending', 'approved')
       and r.class_id <> p_class and r.id is distinct from p_skip_reg
       and public.period_slot(r.on_date, r.period_id) && public.period_slot(p_day, p_period)
  ) x limit 1
$$;
revoke all on function public.teacher_slot_busy(uuid, date, uuid, uuid, uuid, uuid) from public, authenticated;

create or replace function public.teacher_slot_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_busy text; v_name text;
begin
  if coalesce(current_setting('kdi.booking_soft', true), '') = 'on' then return new; end if;
  if tg_table_name = 'teaching_sessions' then
    if new.teacher_id is null or new.status = 'cancelled' then return new; end if;
    if tg_op = 'UPDATE' and (old.teacher_id, old.session_date, old.period_id, old.class_id, old.status = 'cancelled')
       is not distinct from (new.teacher_id, new.session_date, new.period_id, new.class_id, new.status = 'cancelled') then return new; end if;
    -- Tiết sinh từ TKB, đúng GV của TKB: TKB đã chặn trùng
    if new.timetable_entry_id is not null and not new.is_makeup
       and new.teacher_id is not distinct from (select e.teacher_id from timetable_entries e where e.id = new.timetable_entry_id) then return new; end if;
    v_busy := public.teacher_slot_busy(new.teacher_id, new.session_date, new.period_id, new.class_id, new.id, null);
  else
    if new.status not in ('pending', 'approved') then return new; end if;
    if tg_op = 'UPDATE' and (old.teacher_id, old.on_date, old.period_id, old.class_id, old.status in ('pending', 'approved'))
       is not distinct from (new.teacher_id, new.on_date, new.period_id, new.class_id, true) then return new; end if;
    v_busy := public.teacher_slot_busy(new.teacher_id, new.on_date, new.period_id, new.class_id, null, new.id);
  end if;
  if v_busy is not null then
    select full_name into v_name from teachers where id = new.teacher_id;
    raise exception 'Giáo viên % đã có tiết trùng giờ: %', coalesce(v_name, ''), v_busy
      using errcode = '23P01', hint = 'Chọn tiết khác hoặc đổi giáo viên.';
  end if;
  return new;
end $$;
drop trigger if exists teacher_slot_guard on teaching_sessions;
create trigger teacher_slot_guard before insert or update on teaching_sessions for each row execute function public.teacher_slot_guard();
drop trigger if exists teacher_slot_guard on stem_registrations;
create trigger teacher_slot_guard before insert or update on stem_registrations for each row execute function public.teacher_slot_guard();

-- ===== 5. Thời khoá biểu: chặn tiết mới làm trùng phòng / GV =====
-- Hai tiết "chồng nhau" khi cùng thứ, cùng tiết và cùng học kỳ (tiết áp dụng mọi học kỳ chồng với mọi học kỳ).
-- Chỗ trùng đã có từ trước vẫn giữ nguyên (xem timetable_conflicts()); chỉ chặn khi thêm hoặc sửa.
create or replace function public.timetable_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if tg_op = 'UPDATE' and (old.room_id, old.teacher_id, old.weekday, old.period_id, old.year_id, old.class_id)
     is not distinct from (new.room_id, new.teacher_id, new.weekday, new.period_id, new.year_id, new.class_id) then return new; end if;
  if new.room_id is not null then
    select r.name || ' đã có lớp ' || c.name || ' (' || e.subject || ')' into v
      from timetable_entries e join stem_rooms r on r.id = e.room_id join classes c on c.id = e.class_id
     where e.id <> new.id and e.org_id = new.org_id and e.weekday = new.weekday and e.period_id = new.period_id
       and e.room_id = new.room_id and e.class_id <> new.class_id
       and (e.year_id is null or new.year_id is null or e.year_id = new.year_id)
     limit 1;
    if v is not null then raise exception 'Trùng phòng: % ở cùng thứ, cùng tiết', v using errcode = '23P01'; end if;
  end if;
  if new.teacher_id is not null then
    select t.full_name || ' đã dạy lớp ' || c.name || ' (' || e.subject || ')' into v
      from timetable_entries e join teachers t on t.id = e.teacher_id join classes c on c.id = e.class_id
     where e.id <> new.id and e.org_id = new.org_id and e.weekday = new.weekday and e.period_id = new.period_id
       and e.teacher_id = new.teacher_id and e.class_id <> new.class_id
       and (e.year_id is null or new.year_id is null or e.year_id = new.year_id)
     limit 1;
    if v is not null then raise exception 'Trùng giáo viên: % ở cùng thứ, cùng tiết', v using errcode = '23P01'; end if;
  end if;
  return new;
end $$;
drop trigger if exists timetable_guard on timetable_entries;
create trigger timetable_guard before insert or update on timetable_entries for each row execute function public.timetable_guard();

-- ===== 6. Thiết bị: chỉ duyệt/giao khi còn đủ =====
-- Thiết bị dùng được = mọi đơn vị thiết bị trừ hỏng / bảo trì. Đã giữ = phiếu đã duyệt hoặc đang mượn, chồng giờ.
-- Phiếu chờ duyệt không giữ thiết bị (GV vẫn gửi được khi thiếu, như trước — người duyệt quyết định).
create or replace function public.equipment_shortage(p_org uuid, p_day date, p_period uuid, p_items jsonb, p_skip uuid)
returns table (type_id uuid, name text, need int, usable int, held int)
language sql stable security definer set search_path = public as $$
  with want as (
    select (i->>'type_id')::uuid as type_id, sum(greatest(coalesce((i->>'qty')::int, 0), 0))::int as qty
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where (i->>'type_id') is not null group by 1
  ), held as (
    select (i->>'type_id')::uuid as type_id, sum(greatest(coalesce((i->>'qty')::int, 0), 0))::int as qty
      from borrow_requests b, jsonb_array_elements(b.item_list) i
     where b.org_id = p_org and b.id is distinct from p_skip and b.status in ('approved', 'lent')
       and b.on_date = p_day and public.period_slot(b.on_date, b.period_id) && public.period_slot(p_day, p_period)
     group by 1
  )
  select w.type_id, t.name, w.qty,
         (select count(*) from equipment_units u where u.type_id = w.type_id and u.org_id = p_org and u.status not in ('broken', 'maintenance'))::int,
         coalesce(h.qty, 0)
    from want w join equipment_types t on t.id = w.type_id left join held h on h.type_id = w.type_id
$$;
revoke all on function public.equipment_shortage(uuid, date, uuid, jsonb, uuid) from public, authenticated;

create or replace function public.borrow_stock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_msg text;
begin
  if new.status not in ('approved', 'lent') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('approved', 'lent')
     and (old.on_date, old.period_id, old.item_list) is not distinct from (new.on_date, new.period_id, new.item_list) then return new; end if;
  -- Xếp hàng theo trường: hai người duyệt cùng lúc không cùng lấy một thiết bị
  perform pg_advisory_xact_lock(hashtext('borrow_stock'), hashtext(new.org_id::text));
  select string_agg(format('%s: cần %s, dùng được %s, đã cho mượn %s', s.name, s.need, s.usable, s.held), '; ') into v_msg
    from public.equipment_shortage(new.org_id, new.on_date, new.period_id, new.item_list, new.id) s
   where s.need > s.usable - s.held;
  if v_msg is not null then
    raise exception 'Không đủ thiết bị cho khung giờ này — %', v_msg
      using errcode = '23P01', hint = 'Đổi ngày/tiết, giảm số lượng hoặc chờ phiếu khác trả thiết bị.';
  end if;
  return new;
end $$;
drop trigger if exists borrow_stock_guard on borrow_requests;
create trigger borrow_stock_guard before insert or update on borrow_requests for each row execute function public.borrow_stock_guard();

-- Cho giao diện: còn bao nhiêu thiết bị mỗi loại trong một khung giờ (trường đang làm việc)
create or replace function public.equipment_availability(p_day date, p_period uuid default null)
returns table (type_id uuid, usable int, held int, free int)
language sql stable security definer set search_path = public as $$
  select t.id,
         count(u.id) filter (where u.status not in ('broken', 'maintenance'))::int,
         coalesce(h.qty, 0)::int,
         greatest(count(u.id) filter (where u.status not in ('broken', 'maintenance')) - coalesce(h.qty, 0), 0)::int
    from equipment_types t
    left join equipment_units u on u.type_id = t.id and u.org_id = t.org_id
    left join (
      select (i->>'type_id')::uuid as type_id, sum(greatest(coalesce((i->>'qty')::int, 0), 0)) as qty
        from borrow_requests b, jsonb_array_elements(b.item_list) i
       where b.org_id = public.my_org_id() and b.status in ('approved', 'lent') and b.on_date = p_day
         and public.period_slot(b.on_date, b.period_id) && public.period_slot(p_day, p_period)
       group by 1) h on h.type_id = t.id
   where t.org_id = public.my_org_id() and public.is_staff()
   group by t.id, h.qty
$$;
grant execute on function public.equipment_availability(date, uuid) to authenticated;

-- ===== 7. Ghi sổ cho dữ liệu đã có =====
-- Thứ tự ưu tiên giữ phòng: tiết đã dạy → đăng ký/phiếu đã duyệt → tiết theo lịch → còn lại. Phần trùng ghi vào booking_conflicts.
do $$
declare x record;
begin
  perform set_config('kdi.booking_soft', 'on', true);
  for x in
    select 'teaching_session' as src, s.id, case s.status when 'taught' then 0 else 2 end as prio, s.session_date as d
      from teaching_sessions s where s.room_id is not null and s.status <> 'cancelled'
    union all
    select 'stem_registration', r.id, case r.status when 'approved' then 1 else 3 end, r.on_date
      from stem_registrations r where r.status in ('pending', 'approved')
    union all
    select 'borrow_request', b.id, case when b.status in ('approved', 'lent') then 1 else 3 end, b.on_date
      from borrow_requests b where b.mode = 'in_room' and b.room_id is not null and b.status in ('pending', 'approved', 'lent')
    order by prio, d, id
  loop
    if x.src = 'teaching_session' then
      -- Ghi mềm cho mọi buổi dạy cũ (kể cả dạy bù) — dữ liệu đã có không bị chặn
      perform public.booking_put(s.org_id, s.room_id, s.class_id, public.period_slot(s.session_date, s.period_id),
        'teaching_session', s.id, concat_ws(' · ', p.name, c.name, s.subject), true)
        from teaching_sessions s join period_configs p on p.id = s.period_id join classes c on c.id = s.class_id where s.id = x.id;
    elsif x.src = 'stem_registration' then perform public.booking_refresh_registration(x.id);
    else perform public.booking_refresh_borrow(x.id); end if;
  end loop;
  perform set_config('kdi.booking_soft', 'off', true);
end $$;

-- ===== 8. Phòng STEM toàn hệ thống =====
-- Công suất = số ngày học (Thứ 2–7) trong khoảng × số tiết trong ngày của trường. Đã giữ = số tiết/phiếu đang giữ phòng.
-- Buổi dạy chỉ có khi trường đã mở tuần đó (giao diện sinh từ TKB) — trường chưa sinh buổi dạy có thể thấp hơn thực tế.
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
     where r.org_id in (select public.my_org_tree())
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
grant execute on function public.room_overview(date, date) to authenticated;

-- ===== 9. Thiết bị toàn hệ thống =====
create or replace function public.equipment_overview()
returns table (org_id uuid, school text, parent_name text, types int, units int, available int, in_use int,
               in_stock int, broken int, maintenance int, warranty_expiring int, warranty_expired int,
               open_tickets int, borrow_pending int, borrow_lent int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return query
  with sc as (select o.id, o.name, par.name as parent_name from organizations o left join organizations par on par.id = o.parent_id
               where o.type = 'school' and o.id in (select public.my_org_tree())),
       u as (select * from equipment_units where equipment_units.org_id in (select id from sc))
  select sc.id, sc.name, sc.parent_name,
    (select count(*) from equipment_types t where t.org_id = sc.id)::int,
    (select count(*) from u where u.org_id = sc.id)::int,
    (select count(*) from u where u.org_id = sc.id and u.status = 'available')::int,
    (select count(*) from u where u.org_id = sc.id and u.status = 'in_use')::int,
    (select count(*) from u where u.org_id = sc.id and u.status = 'in_stock')::int,
    (select count(*) from u where u.org_id = sc.id and u.status = 'broken')::int,
    (select count(*) from u where u.org_id = sc.id and u.status = 'maintenance')::int,
    (select count(*) from u where u.org_id = sc.id and u.warranty_until between current_date and current_date + 60)::int,
    (select count(*) from u where u.org_id = sc.id and u.warranty_until < current_date)::int,
    (select count(*) from warranty_tickets w where w.org_id = sc.id and w.status not in ('resolved', 'rejected', 'closed'))::int,
    (select count(*) from borrow_requests b where b.org_id = sc.id and b.status = 'pending')::int,
    (select count(*) from borrow_requests b where b.org_id = sc.id and b.status = 'lent')::int
  from sc order by sc.name;
end $$;
grant execute on function public.equipment_overview() to authenticated;

-- Theo loại thiết bị (gộp theo tên + nhóm trên các trường trong phạm vi)
create or replace function public.equipment_type_summary()
returns table (name text, category text, brand text, schools int, units int, usable int, broken int, maintenance int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return query
  select t.name, t.category, min(t.brand), count(distinct t.org_id)::int, count(u.id)::int,
         count(u.id) filter (where u.status not in ('broken', 'maintenance'))::int,
         count(u.id) filter (where u.status = 'broken')::int, count(u.id) filter (where u.status = 'maintenance')::int
    from equipment_types t join organizations o on o.id = t.org_id and o.type = 'school'
    left join equipment_units u on u.type_id = t.id
   where t.org_id in (select public.my_org_tree())
   group by t.name, t.category
   order by count(u.id) desc, t.name;
end $$;
grant execute on function public.equipment_type_summary() to authenticated;
