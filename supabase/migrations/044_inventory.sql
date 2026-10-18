-- 044: Kho & kiểm kê (S3b).
--   1. Vật tư tiêu hao (supplies) với sổ nhập/xuất (supply_moves): tồn kho chỉ thay đổi qua phiếu nhập/xuất/điều chỉnh,
--      không xuất quá tồn; cấp phát cho GV/lớp ghi người nhận.
--   2. Kiểm kê thiết bị và vật tư (stocktakes): mở đợt (toàn trường hoặc một phòng) → danh sách thiết bị dự kiến được chụp lại;
--      quét QR / nhập số serial để đánh dấu "có", ghi tình trạng; đếm vật tư → nộp → quản trị duyệt:
--      thiết bị không thấy → "Thất lạc", hỏng → "Hỏng", sai phòng → chuyển phòng; vật tư lệch → phiếu điều chỉnh. Ghi lịch sử thiết bị.
--   3. Trạng thái thiết bị mới: lost (Thất lạc).
-- Quyền theo chức năng "equipment" (Quản lý Thiết bị) như các bảng thiết bị khác; Sở/KDI đọc theo cây đơn vị.

alter table equipment_units drop constraint if exists equipment_units_status_check;
alter table equipment_units add constraint equipment_units_status_check
  check (status in ('available', 'in_use', 'broken', 'maintenance', 'in_stock', 'lost'));

-- ===== 1. Vật tư tiêu hao =====
create table if not exists supplies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sku text,
  name text not null,
  unit text not null default 'cái',
  category text,
  min_qty numeric(12,2) not null default 0 check (min_qty >= 0),
  qty numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists supplies_sku on supplies (org_id, lower(sku)) where sku is not null;
create table if not exists supply_moves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  supply_id uuid not null references supplies(id) on delete cascade,
  kind text not null check (kind in ('in', 'out', 'adjust')),
  qty numeric(12,2) not null check (qty <> 0),                       -- in/out: số dương; adjust: âm hoặc dương
  reason text,
  teacher_id uuid references teachers(id) on delete set null,        -- người nhận khi cấp phát
  class_id uuid references classes(id) on delete set null,
  stocktake_id uuid,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind = 'adjust' or qty > 0)
);
create index if not exists supply_moves_supply on supply_moves (supply_id, created_at desc);

-- Tồn kho chỉ đổi qua phiếu: tạo mới luôn = 0; sửa trực tiếp cột qty bị bỏ qua
create or replace function public.guard_supply_qty() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() < 2 then
    if tg_op = 'INSERT' then new.qty := 0; else new.qty := old.qty; end if;
  end if;
  return new;
end $$;
drop trigger if exists supplies_guard_qty on supplies;
create trigger supplies_guard_qty before insert or update on supplies for each row execute function public.guard_supply_qty();

create or replace function public.apply_supply_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_qty numeric; v_delta numeric := case new.kind when 'out' then -new.qty else new.qty end;
begin
  select qty into v_qty from supplies where id = new.supply_id and org_id = new.org_id for update;
  if v_qty is null then raise exception 'Vật tư không thuộc đơn vị' using errcode = '23514'; end if;
  if v_qty + v_delta < 0 then raise exception 'Không đủ tồn kho (còn %)', v_qty using errcode = '23514'; end if;
  update supplies set qty = qty + v_delta where id = new.supply_id;
  return new;
end $$;
drop trigger if exists supply_moves_apply on supply_moves;
create trigger supply_moves_apply before insert on supply_moves for each row execute function public.apply_supply_move();

-- ===== 2. Kiểm kê =====
create table if not exists stocktakes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  room_id uuid references stem_rooms(id) on delete set null,          -- null = toàn trường
  include_supplies boolean not null default true,
  status text not null default 'open' check (status in ('open', 'submitted', 'approved', 'cancelled')),
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references profiles(id) on delete set null
);
create table if not exists stocktake_items (
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  unit_id uuid not null references equipment_units(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  expected_room_id uuid references stem_rooms(id) on delete set null,
  expected_status text,
  result text check (result in ('ok', 'broken', 'missing')),          -- null = chưa kiểm
  found_room_id uuid references stem_rooms(id) on delete set null,
  note text,
  checked_by uuid references profiles(id) on delete set null,
  checked_at timestamptz,
  primary key (stocktake_id, unit_id)
);
create table if not exists stocktake_supplies (
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  supply_id uuid not null references supplies(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  expected_qty numeric(12,2) not null,
  counted_qty numeric(12,2) check (counted_qty >= 0),
  primary key (stocktake_id, supply_id)
);

-- Quyền: như bảng thiết bị (012) — đọc trong cây đơn vị (nhân sự), ghi theo quyền "equipment"
do $$
declare t text;
begin
  foreach t in array array['supplies', 'supply_moves', 'stocktakes', 'stocktake_items', 'stocktake_supplies'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (public.can_access_org(org_id) and public.is_staff())', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert to authenticated with check (org_id = public.my_org_id() and public.has_perm(''equipment'', ''create''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    if t <> 'supply_moves' then   -- phiếu nhập/xuất không sửa được (muốn sửa: lập phiếu điều chỉnh)
      execute format('create policy %I on %I for update to authenticated using (org_id = public.my_org_id() and public.has_perm(''equipment'', ''edit'')) with check (org_id = public.my_org_id() and public.has_perm(''equipment'', ''edit''))', t || '_update', t);
    end if;
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    if t in ('supplies', 'stocktakes') then
      execute format('create policy %I on %I for delete to authenticated using (org_id = public.my_org_id() and public.has_perm(''equipment'', ''delete''))', t || '_delete', t);
    end if;
  end loop;
end $$;
-- Nhân sự khác trường không gắn được vật tư của trường khác vào phiếu
create or replace function public.guard_inventory_refs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'supply_moves' then
    if (new.teacher_id is not null and not exists (select 1 from teachers where id = new.teacher_id and org_id = new.org_id))
       or (new.class_id is not null and not exists (select 1 from classes where id = new.class_id and org_id = new.org_id)) then
      raise exception 'Người nhận / lớp không thuộc trường' using errcode = '23514';
    end if;
  elsif new.room_id is not null and not exists (select 1 from stem_rooms where id = new.room_id and org_id = new.org_id) then
    raise exception 'Phòng không thuộc trường' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists supply_moves_refs on supply_moves;
create trigger supply_moves_refs before insert on supply_moves for each row execute function public.guard_inventory_refs();
drop trigger if exists stocktakes_refs on stocktakes;
create trigger stocktakes_refs before insert or update on stocktakes for each row execute function public.guard_inventory_refs();

-- Mở đợt kiểm kê: chụp danh sách thiết bị (và vật tư) dự kiến
create or replace function public.stocktake_start(p_name text, p_room uuid default null, p_supplies boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_id uuid;
begin
  if not public.has_perm('equipment', 'create') then raise exception 'Không có quyền kiểm kê' using errcode = '42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Cần tên đợt kiểm kê' using errcode = '22023'; end if;
  if exists (select 1 from stocktakes where org_id = v_org and status = 'open' and room_id is not distinct from p_room) then
    raise exception 'Đang có đợt kiểm kê mở cho phạm vi này' using errcode = '23505';
  end if;
  insert into stocktakes (org_id, name, room_id, include_supplies) values (v_org, btrim(p_name), p_room, p_supplies and p_room is null) returning id into v_id;
  insert into stocktake_items (stocktake_id, unit_id, org_id, expected_room_id, expected_status)
    select v_id, u.id, v_org, u.room_id, u.status from equipment_units u
     where u.org_id = v_org and u.status <> 'lost' and (p_room is null or u.room_id = p_room);
  if p_supplies and p_room is null then
    insert into stocktake_supplies (stocktake_id, supply_id, org_id, expected_qty) select v_id, s.id, v_org, s.qty from supplies s where s.org_id = v_org;
  end if;
  return v_id;
end $$;

-- Quét mã: id thiết bị (từ QR) hoặc số serial → đánh dấu đã thấy
create or replace function public.stocktake_scan(p_stocktake uuid, p_code text, p_room uuid default null, p_result text default 'ok')
returns table (unit_id uuid, name text, serial text, expected_room text, status text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare st stocktakes; v_unit uuid; v_code text := btrim(coalesce(p_code, ''));
begin
  select * into st from stocktakes where id = p_stocktake;
  if st.id is null or st.org_id <> public.my_org_id() or not public.has_perm('equipment', 'edit') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if st.status <> 'open' then raise exception 'Đợt kiểm kê đã nộp/đóng' using errcode = '22023'; end if;
  if p_result not in ('ok', 'broken', 'missing') then raise exception 'Kết quả không hợp lệ' using errcode = '22023'; end if;
  v_code := regexp_replace(v_code, '^KDI:U:', '', 'i');
  if v_code ~* '^[0-9a-f-]{36}$' then select id into v_unit from equipment_units where id = v_code::uuid and org_id = st.org_id; end if;
  if v_unit is null then
    select id into v_unit from equipment_units where org_id = st.org_id and lower(serial) = lower(v_code) order by id limit 1;
  end if;
  if v_unit is null then raise exception 'Không tìm thấy thiết bị "%" ở trường', v_code using errcode = 'P0002'; end if;
  -- Thiết bị ngoài danh sách dự kiến (vd ở phòng khác) vẫn được ghi nhận
  insert into stocktake_items (stocktake_id, unit_id, org_id, expected_room_id, expected_status)
    select st.id, u.id, st.org_id, u.room_id, u.status from equipment_units u where u.id = v_unit
  on conflict (stocktake_id, unit_id) do nothing;
  update stocktake_items i set result = p_result, found_room_id = coalesce(p_room, st.room_id, i.expected_room_id),
         checked_by = auth.uid(), checked_at = now()
   where i.stocktake_id = st.id and i.unit_id = v_unit;
  return query select u.id, t.name, u.serial, r.name, p_result from equipment_units u join equipment_types t on t.id = u.type_id
                left join stem_rooms r on r.id = u.room_id where u.id = v_unit;
end $$;

-- Duyệt kết quả: áp vào sổ thiết bị và kho vật tư
create or replace function public.stocktake_approve(p_stocktake uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st stocktakes; r record; n_lost int := 0; n_broken int := 0; n_moved int := 0; n_adj int := 0; d numeric;
begin
  select * into st from stocktakes where id = p_stocktake for update;
  if st.id is null or st.org_id <> public.my_org_id() or not (public.is_admin() or public.has_perm('equipment', 'delete')) then
    raise exception 'Chỉ quản trị trường duyệt được kết quả kiểm kê' using errcode = '42501';
  end if;
  if st.status <> 'submitted' then raise exception 'Đợt kiểm kê chưa nộp' using errcode = '22023'; end if;
  for r in select i.*, u.status as cur_status, u.room_id as cur_room from stocktake_items i join equipment_units u on u.id = i.unit_id where i.stocktake_id = st.id loop
    if r.result is null or r.result = 'missing' then
      update equipment_units set status = 'lost' where id = r.unit_id;
      insert into equipment_events (org_id, unit_id, kind, title, note) values (st.org_id, r.unit_id, 'stocktake', 'Kiểm kê: không tìm thấy → Thất lạc', st.name);
      n_lost := n_lost + 1;
    else
      if r.result = 'broken' and r.cur_status <> 'broken' then
        update equipment_units set status = 'broken' where id = r.unit_id;
        insert into equipment_events (org_id, unit_id, kind, title, note) values (st.org_id, r.unit_id, 'stocktake', 'Kiểm kê: hỏng', coalesce(r.note, st.name));
        n_broken := n_broken + 1;
      elsif r.cur_status = 'lost' then
        update equipment_units set status = 'available' where id = r.unit_id;
        insert into equipment_events (org_id, unit_id, kind, title, note) values (st.org_id, r.unit_id, 'stocktake', 'Kiểm kê: tìm thấy lại', st.name);
      end if;
      if r.found_room_id is distinct from r.cur_room and r.found_room_id is not null then
        update equipment_units set room_id = r.found_room_id where id = r.unit_id;
        insert into equipment_events (org_id, unit_id, kind, title, note) values (st.org_id, r.unit_id, 'transfer', 'Kiểm kê: cập nhật phòng', st.name);
        n_moved := n_moved + 1;
      end if;
    end if;
  end loop;
  for r in select * from stocktake_supplies where stocktake_id = st.id and counted_qty is not null loop
    select r.counted_qty - qty into d from supplies where id = r.supply_id;
    if d <> 0 then
      insert into supply_moves (org_id, supply_id, kind, qty, reason, stocktake_id) values (st.org_id, r.supply_id, 'adjust', d, 'Kiểm kê: ' || st.name, st.id);
      n_adj := n_adj + 1;
    end if;
  end loop;
  update stocktakes set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = st.id;
  return jsonb_build_object('lost', n_lost, 'broken', n_broken, 'moved', n_moved, 'adjusted', n_adj);
end $$;
revoke all on function public.stocktake_start(text, uuid, boolean), public.stocktake_scan(uuid, text, uuid, text), public.stocktake_approve(uuid) from public, anon;
grant execute on function public.stocktake_start(text, uuid, boolean), public.stocktake_scan(uuid, text, uuid, text), public.stocktake_approve(uuid) to authenticated;

-- Trạng thái đợt kiểm kê: người dùng chỉ mở → nộp / huỷ (hoặc nộp → mở lại); duyệt chỉ qua stocktake_approve.
-- Sau khi nộp không sửa được kết quả từng dòng.
create or replace function public.guard_stocktake() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status and not (old.status, new.status) in (('open', 'submitted'), ('open', 'cancelled'), ('submitted', 'open')) then
      raise exception 'Không chuyển được trạng thái đợt kiểm kê' using errcode = '42501';
    end if;
    if old.status in ('approved', 'cancelled') then raise exception 'Đợt kiểm kê đã đóng' using errcode = '42501'; end if;
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  end if;
  if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now(); end if;
  return new;
end $$;
drop trigger if exists stocktakes_guard on stocktakes;
create trigger stocktakes_guard before update on stocktakes for each row execute function public.guard_stocktake();

create or replace function public.guard_stocktake_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select status from stocktakes where id = new.stocktake_id) <> 'open' then
    raise exception 'Đợt kiểm kê đã nộp — không sửa kết quả được' using errcode = '42501';
  end if;
  if tg_table_name = 'stocktake_items' then new.checked_by := auth.uid(); new.checked_at := now(); end if;
  return new;
end $$;
drop trigger if exists stocktake_items_guard on stocktake_items;
create trigger stocktake_items_guard before update on stocktake_items for each row execute function public.guard_stocktake_lines();
drop trigger if exists stocktake_supplies_guard on stocktake_supplies;
create trigger stocktake_supplies_guard before update on stocktake_supplies for each row execute function public.guard_stocktake_lines();
