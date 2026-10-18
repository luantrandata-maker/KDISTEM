-- 045: Đề xuất mua vật tư & Vận chuyển / điều chuyển (phần còn lại của S3b).
--   1. Kho tổng KDI: quản trị nền tảng ghi được kho vật tư của đơn vị mình (can_stock).
--   2. Đề xuất mua vật tư (supply_requests + dòng): nháp → gửi duyệt (engine phê duyệt 022, loại "supply_purchase")
--      → đã duyệt → nhận hàng: tự lập phiếu nhập kho, vật tư mới tự thêm vào danh mục.
--   3. Vận chuyển / điều chuyển (stock_transfers + dòng): vật tư và thiết bị từ đơn vị xuất sang đơn vị nhận,
--      duyệt qua engine (loại "stock_transfer", tại đơn vị xuất) → xuất hàng (trừ kho, thiết bị "Đang vận chuyển")
--      → đơn vị nhận xác nhận (cộng kho bên nhận, thiết bị đổi đơn vị; thiết bị không tới → Thất lạc).
--      Ai lập phiếu: đơn vị xuất; nơi nhận phải trong cây đơn vị của mình, cùng Sở/Tỉnh, hoặc KDI xuất cho mọi đơn vị.
--   4. Trạng thái thiết bị mới: in_transit (Đang vận chuyển); thiết bị Thất lạc / Đang vận chuyển không tính là dùng được.

alter table equipment_units drop constraint if exists equipment_units_status_check;
alter table equipment_units add constraint equipment_units_status_check
  check (status in ('available', 'in_use', 'broken', 'maintenance', 'in_stock', 'lost', 'in_transit'));

-- ===== 1. Quyền kho =====
create or replace function public.can_stock(p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm('equipment', p_action) or public.is_platform_admin()
$$;
grant execute on function public.can_stock(text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['supplies', 'supply_moves'] loop
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert to authenticated with check (org_id = public.my_org_id() and public.can_stock(''create''))', t || '_insert', t);
  end loop;
  drop policy if exists supplies_update on supplies;
  create policy supplies_update on supplies for update to authenticated
    using (org_id = public.my_org_id() and public.can_stock('edit')) with check (org_id = public.my_org_id() and public.can_stock('edit'));
  drop policy if exists supplies_delete on supplies;
  create policy supplies_delete on supplies for delete to authenticated using (org_id = public.my_org_id() and public.can_stock('delete'));
end $$;

-- ===== 2. Đề xuất mua vật tư =====
create table if not exists supply_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  reason text,
  needed_by date,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'received')),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index if not exists supply_requests_org on supply_requests (org_id, created_at desc);
create table if not exists supply_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references supply_requests(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  supply_id uuid references supplies(id) on delete set null,
  name text not null,
  unit text not null default 'cái',
  qty numeric(12,2) not null check (qty > 0),
  est_price numeric(14,0) check (est_price >= 0),
  received_qty numeric(12,2) check (received_qty >= 0)
);
create index if not exists supply_request_lines_req on supply_request_lines (request_id);

-- ===== 3. Vận chuyển / điều chuyển =====
create table if not exists stock_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,     -- đơn vị xuất
  to_org uuid not null references organizations(id) on delete cascade,     -- đơn vị nhận
  title text not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'shipped', 'received', 'cancelled')),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  shipped_at timestamptz, shipped_by uuid references profiles(id) on delete set null,
  received_at timestamptz, received_by uuid references profiles(id) on delete set null,
  receive_note text,
  check (to_org <> org_id)
);
create index if not exists stock_transfers_from on stock_transfers (org_id, created_at desc);
create index if not exists stock_transfers_to on stock_transfers (to_org, created_at desc);
create table if not exists stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,     -- = đơn vị xuất
  supply_id uuid references supplies(id) on delete cascade,
  unit_id uuid references equipment_units(id) on delete cascade,
  name text,                                                               -- chụp tên lúc lập phiếu (bên nhận không đọc được kho bên xuất)
  unit text,
  qty numeric(12,2) not null default 1 check (qty > 0),
  received_qty numeric(12,2) check (received_qty >= 0),
  check ((supply_id is null) <> (unit_id is null)),
  check (unit_id is null or qty = 1)
);
create unique index if not exists stock_transfer_items_unit on stock_transfer_items (transfer_id, unit_id) where unit_id is not null;
create unique index if not exists stock_transfer_items_supply on stock_transfer_items (transfer_id, supply_id) where supply_id is not null;

-- Nơi nhận hợp lệ: trong cây của tôi; cùng Sở / Tỉnh với đơn vị xuất; hoặc KDI xuất đi mọi nơi
create or replace function public.stock_target_ok(p_from uuid, p_to uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare a uuid;
begin
  if p_to is null or p_to = p_from then return false; end if;
  if public.is_platform_admin() or public.can_access_org(p_to) then return true; end if;
  foreach a in array array[public.org_ancestor_of_type(p_from, 'department'), public.org_ancestor_of_type(p_from, 'province')] loop
    if a is not null and public.org_ancestor_of_type(p_to, (select type from organizations where id = a)) = a then return true; end if;
  end loop;
  return false;
end $$;
grant execute on function public.stock_target_ok(uuid, uuid) to authenticated;

-- Danh sách đơn vị nhận được (cho ô chọn ở giao diện)
create or replace function public.stock_targets() returns table (id uuid, name text, type text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.type from organizations o
   where public.is_staff() and o.status is distinct from 'suspended' and public.stock_target_ok(public.my_org_id(), o.id)
   order by o.type <> 'school', o.name
$$;
grant execute on function public.stock_targets() to authenticated;

-- ===== 4. Quyền (RLS) =====
alter table supply_requests enable row level security;
alter table supply_request_lines enable row level security;
alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;
do $$
declare t text;
begin
  foreach t in array array['supply_requests', 'supply_request_lines', 'stock_transfers', 'stock_transfer_items'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for insert to authenticated with check (org_id = public.my_org_id() and public.can_stock(''create''))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (org_id = public.my_org_id() and public.can_stock(''edit'')) with check (org_id = public.my_org_id() and public.can_stock(''edit''))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (org_id = public.my_org_id() and public.can_stock(''create''))', t || '_delete', t);
  end loop;
end $$;
create policy supply_requests_read on supply_requests for select to authenticated using (public.can_access_org(org_id) and public.is_staff());
create policy supply_request_lines_read on supply_request_lines for select to authenticated using (public.can_access_org(org_id) and public.is_staff());
-- Đơn vị nhận cũng đọc được phiếu vận chuyển gửi tới mình
create policy stock_transfers_read on stock_transfers for select to authenticated
  using (public.is_staff() and (public.can_access_org(org_id) or public.can_access_org(to_org)));
create policy stock_transfer_items_read on stock_transfer_items for select to authenticated
  using (exists (select 1 from stock_transfers t where t.id = transfer_id));
grant select, insert, update, delete on supply_requests, supply_request_lines, stock_transfers, stock_transfer_items to authenticated;

-- ===== 5. Ràng buộc nghiệp vụ =====
create or replace function public.guard_stock_docs() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_engine boolean := coalesce(current_setting('app.approval_engine', true), 'off') = 'on'
                            or coalesce(current_setting('app.stock_engine', true), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending') then raise exception 'Phiếu mới phải ở trạng thái nháp hoặc gửi duyệt' using errcode = '22023'; end if;
    if tg_table_name = 'stock_transfers' then
      if not public.stock_target_ok(new.org_id, new.to_org) then raise exception 'Đơn vị nhận không hợp lệ' using errcode = '42501'; end if;
    end if;
    return new;
  end if;
  if v_engine then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'rejected', 'cancelled') then raise exception 'Chỉ xoá được phiếu nháp / bị từ chối / đã huỷ' using errcode = '22023'; end if;
    return old;
  end if;
  if tg_table_name = 'stock_transfers' then
    if new.to_org is distinct from old.to_org and not public.stock_target_ok(new.org_id, new.to_org) then
      raise exception 'Đơn vị nhận không hợp lệ' using errcode = '42501';
    end if;
  end if;
  if new.status is not distinct from old.status then
    if old.status not in ('draft', 'rejected') then raise exception 'Phiếu đã gửi duyệt, không sửa được' using errcode = '22023'; end if;
    return new;
  end if;
  -- Đổi trạng thái do người dùng: gửi duyệt; huỷ phiếu chưa xuất. Duyệt/từ chối đi qua engine (approval_source_guard);
  -- nhận hàng / xuất hàng chỉ qua hàm.
  if (old.status in ('draft', 'rejected') and new.status = 'pending')
     or (old.status = 'pending' and new.status in ('approved', 'rejected'))
     or (tg_table_name = 'stock_transfers' and old.status in ('draft', 'rejected', 'approved') and new.status = 'cancelled') then
    return new;
  end if;
  raise exception 'Không chuyển được trạng thái % → %', old.status, new.status using errcode = '22023';
end $$;
drop trigger if exists supply_requests_status_guard on supply_requests;
create trigger supply_requests_status_guard before insert or update or delete on supply_requests for each row execute function public.guard_stock_docs();
drop trigger if exists stock_transfers_status_guard on stock_transfers;
create trigger stock_transfers_status_guard before insert or update or delete on stock_transfers for each row execute function public.guard_stock_docs();

-- Dòng phiếu: chỉ sửa khi phiếu cha còn nháp / bị từ chối; vật tư, thiết bị phải của đơn vị xuất
create or replace function public.guard_stock_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_parent text; v_org uuid; r record;
begin
  if coalesce(current_setting('app.stock_engine', true), 'off') = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'supply_request_lines' then
    select status, org_id into v_parent, v_org from supply_requests where id = coalesce(new.request_id, old.request_id);
  else
    select status, org_id into v_parent, v_org from stock_transfers where id = coalesce(new.transfer_id, old.transfer_id);
  end if;
  if v_parent is null then return coalesce(new, old); end if;            -- phiếu cha đang bị xoá (cascade)
  if v_parent not in ('draft', 'rejected') then raise exception 'Phiếu đã gửi duyệt, không sửa dòng được' using errcode = '22023'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.org_id <> v_org then raise exception 'Dòng không cùng đơn vị với phiếu' using errcode = '23514'; end if;
  if tg_table_name = 'supply_request_lines' then
    new.received_qty := null;
    if new.supply_id is not null and not exists (select 1 from supplies where id = new.supply_id and org_id = v_org) then
      raise exception 'Vật tư không thuộc đơn vị' using errcode = '23514';
    end if;
  else
    new.received_qty := null;
    if new.supply_id is not null then
      select name, unit into r from supplies where id = new.supply_id and org_id = v_org;
      if r is null then raise exception 'Vật tư không thuộc đơn vị xuất' using errcode = '23514'; end if;
      new.name := r.name; new.unit := r.unit;
    else
      select t.name, u.serial, u.status into r from equipment_units u join equipment_types t on t.id = u.type_id where u.id = new.unit_id and u.org_id = v_org;
      if r is null then raise exception 'Thiết bị không thuộc đơn vị xuất' using errcode = '23514'; end if;
      if r.status in ('lost', 'in_transit') then raise exception 'Thiết bị đang thất lạc / vận chuyển' using errcode = '23514'; end if;
      new.name := r.name || coalesce(' · ' || r.serial, ''); new.unit := 'cái'; new.qty := 1;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists supply_request_lines_guard on supply_request_lines;
create trigger supply_request_lines_guard before insert or update or delete on supply_request_lines for each row execute function public.guard_stock_lines();
drop trigger if exists stock_transfer_items_guard on stock_transfer_items;
create trigger stock_transfer_items_guard before insert or update or delete on stock_transfer_items for each row execute function public.guard_stock_lines();

-- ===== 6. Nối vào engine phê duyệt (022) =====
alter table approval_workflows drop constraint if exists approval_workflows_kind_check;
alter table approval_workflows add constraint approval_workflows_kind_check
  check (kind in ('stem_registration', 'borrow_request', 'package_purchase', 'edu_plan', 'project', 'supply_purchase', 'stock_transfer'));

create or replace function public.approval_kind_module(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'stem_registrations' when 'borrow_request' then 'stem_rooms'
    when 'package_purchase' then 'packages' when 'edu_plan' then 'edu_plan' when 'project' then 'projects'
    when 'supply_purchase' then 'equipment' when 'stock_transfer' then 'equipment' end
$$;
create or replace function public.approval_kind_label(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'Đăng ký dạy STEM' when 'borrow_request' then 'Phiếu mượn thiết bị'
    when 'package_purchase' then 'Đề xuất mua gói STEM' when 'edu_plan' then 'Kế hoạch giáo dục' when 'project' then 'Dự án STEM'
    when 'supply_purchase' then 'Đề xuất mua vật tư' when 'stock_transfer' then 'Phiếu vận chuyển' end
$$;

create or replace function public.approval_source_opened() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_title text; v_sum text; v_by uuid;
begin
  if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then return null; end if;
  if tg_table_name = 'stem_registrations' then
    v_kind := 'stem_registration'; v_title := new.topic;
    v_sum := public.teacher_name(new.teacher_id) || ' · ' || coalesce((select name from classes where id = new.class_id), '') || ' · ' || public.vn_date(new.on_date);
    v_by := public.teacher_profile(new.teacher_id);
  elsif tg_table_name = 'borrow_requests' then
    v_kind := 'borrow_request'; v_title := new.title;
    v_sum := coalesce(public.teacher_name(new.teacher_id), '') || ' · ' || public.vn_date(new.on_date);
    v_by := coalesce(public.teacher_profile(new.teacher_id), auth.uid());
  elsif tg_table_name = 'package_orders' then
    v_kind := 'package_purchase'; v_title := new.name;
    v_sum := concat_ws(' · ', 'Số lượng ' || new.quantity, nullif(new.programs, ''), 'Khối ' || nullif(new.grades, ''),
                       case when new.budget is not null then replace(to_char(new.budget, 'FM999,999,999,999'), ',', '.') || ' đ' end);
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'education_plans' then
    v_kind := 'edu_plan';
    v_title := public.teacher_name(new.teacher_id) || ' · ' || new.subject || ' · Khối ' || new.grade;
    v_sum := new.stem_periods || ' tiết STEM';
    v_by := auth.uid();
  elsif tg_table_name = 'supply_requests' then
    v_kind := 'supply_purchase'; v_title := new.title;
    select concat_ws(' · ', count(*) || ' mặt hàng',
                     case when sum(qty * est_price) > 0 then 'dự kiến ' || replace(to_char(sum(qty * est_price), 'FM999,999,999,999'), ',', '.') || ' đ' end,
                     case when new.needed_by is not null then 'cần trước ' || public.vn_date(new.needed_by) end)
      into v_sum from supply_request_lines where request_id = new.id;
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'stock_transfers' then
    v_kind := 'stock_transfer'; v_title := new.title;
    select (select name from organizations where id = new.org_id) || ' → ' || (select name from organizations where id = new.to_org)
           || ' · ' || count(*) || ' dòng' into v_sum from stock_transfer_items where transfer_id = new.id;
    v_by := coalesce(new.created_by, auth.uid());
  end if;
  perform public.approval_open(new.org_id, v_kind, tg_table_name, new.id, v_title, v_sum, v_by);
  return null;
end $$;

-- Rút hồ sơ: đề xuất, kế hoạch, phiếu kho về nháp
create or replace function public.approval_cancel(p_request uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_requests;
begin
  select * into r from approval_requests where id = p_request for update;
  if r.requested_by is distinct from auth.uid() or r.status <> 'pending' then raise exception 'Không rút được hồ sơ này' using errcode = '42501'; end if;
  insert into approval_actions (request_id, step_no, actor, decision, note) values (r.id, r.current_step, auth.uid(), 'cancel', p_note);
  update approval_requests set status = 'cancelled', decided_at = now() where id = r.id;
  perform set_config('app.approval_engine', 'on', true);
  execute format('update %I set status = $1 where id = $2', r.ref_table)
    using case when r.ref_table in ('package_orders', 'education_plans', 'supply_requests', 'stock_transfers') then 'draft' else 'rejected' end, r.ref_id;
  perform set_config('app.approval_engine', 'off', true);
end $$;

do $$
declare t text;
begin
  foreach t in array array['supply_requests', 'stock_transfers'] loop
    execute format('drop trigger if exists %I on %I', t || '_approval_open', t);
    execute format('create trigger %I after insert or update of status on %I for each row execute function public.approval_source_opened()', t || '_approval_open', t);
    execute format('drop trigger if exists %I on %I', t || '_approval_guard', t);
    execute format('create trigger %I before update of status on %I for each row execute function public.approval_source_guard()', t || '_approval_guard', t);
    execute format('drop trigger if exists %I on %I', t || '_approval_deleted', t);
    execute format('create trigger %I after delete on %I for each row execute function public.approval_source_deleted()', t || '_approval_deleted', t);
  end loop;
end $$;

-- ===== 7. Nhận hàng theo đề xuất =====
-- p_lines: [{id, qty}] — bỏ trống = nhận đủ số đề xuất. Vật tư chưa có trong danh mục được thêm mới.
create or replace function public.supply_request_receive(p_request uuid, p_lines jsonb default null) returns int
language plpgsql security definer set search_path = public as $$
declare rq supply_requests; l record; v_qty numeric; v_supply uuid; n int := 0;
begin
  select * into rq from supply_requests where id = p_request for update;
  if rq.id is null or rq.org_id <> public.my_org_id() or not public.can_stock('create') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if rq.status <> 'approved' then raise exception 'Đề xuất chưa được duyệt hoặc đã nhận hàng' using errcode = '22023'; end if;
  perform set_config('app.stock_engine', 'on', true);
  for l in select * from supply_request_lines where request_id = rq.id order by name loop
    v_qty := coalesce((select (x->>'qty')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where x->>'id' = l.id::text), l.qty);
    if v_qty < 0 then raise exception 'Số lượng nhận không hợp lệ' using errcode = '22023'; end if;
    v_supply := l.supply_id;
    if v_supply is null or not exists (select 1 from supplies where id = v_supply and org_id = rq.org_id) then
      select id into v_supply from supplies where org_id = rq.org_id and lower(btrim(name)) = lower(btrim(l.name)) and lower(unit) = lower(l.unit) order by created_at limit 1;
      if v_supply is null then
        insert into supplies (org_id, name, unit) values (rq.org_id, btrim(l.name), l.unit) returning id into v_supply;
      end if;
    end if;
    if v_qty > 0 then
      insert into supply_moves (org_id, supply_id, kind, qty, reason) values (rq.org_id, v_supply, 'in', v_qty, 'Nhận hàng theo đề xuất: ' || rq.title);
      n := n + 1;
    end if;
    update supply_request_lines set received_qty = v_qty, supply_id = v_supply where id = l.id;
  end loop;
  update supply_requests set status = 'received', received_at = now() where id = rq.id;
  perform set_config('app.stock_engine', 'off', true);
  return n;
end $$;

-- ===== 8. Xuất hàng / nhận hàng vận chuyển =====
create or replace function public.stock_transfer_ship(p_transfer uuid) returns int
language plpgsql security definer set search_path = public as $$
declare tr stock_transfers; it record; v_to text; n int := 0;
begin
  select * into tr from stock_transfers where id = p_transfer for update;
  if tr.id is null or tr.org_id <> public.my_org_id() or not public.can_stock('edit') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if tr.status <> 'approved' then raise exception 'Phiếu chưa được duyệt hoặc đã xuất' using errcode = '22023'; end if;
  if not exists (select 1 from stock_transfer_items where transfer_id = tr.id) then raise exception 'Phiếu chưa có dòng nào' using errcode = '22023'; end if;
  v_to := (select name from organizations where id = tr.to_org);
  perform set_config('app.stock_engine', 'on', true);
  for it in select * from stock_transfer_items where transfer_id = tr.id loop
    if it.supply_id is not null then
      insert into supply_moves (org_id, supply_id, kind, qty, reason) values (tr.org_id, it.supply_id, 'out', it.qty, 'Xuất vận chuyển tới ' || v_to || ': ' || tr.title);
    else
      update equipment_units set status = 'in_transit', room_id = null where id = it.unit_id and org_id = tr.org_id and status not in ('lost', 'in_transit');
      if not found then raise exception 'Thiết bị % không còn ở đơn vị hoặc đang thất lạc / vận chuyển', it.name using errcode = '23514'; end if;
      insert into equipment_events (org_id, unit_id, kind, title, note) values (tr.org_id, it.unit_id, 'transfer', 'Xuất vận chuyển tới ' || v_to, tr.title);
    end if;
    n := n + 1;
  end loop;
  update stock_transfers set status = 'shipped', shipped_at = now(), shipped_by = auth.uid() where id = tr.id;
  perform set_config('app.stock_engine', 'off', true);
  perform public.notify_user(m.user_id, tr.to_org, 'status', 'Có hàng đang vận chuyển tới đơn vị', tr.title || ' — từ ' || (select name from organizations where id = tr.org_id),
                             'Vận chuyển vật tư', null, tr.id)
     from (select distinct m.user_id from memberships m where m.org_id = tr.to_org and public.user_has_perm(m.user_id, 'equipment', 'edit', tr.to_org)) m;
  return n;
end $$;

-- p_lines: [{id, qty}] cho vật tư (bỏ trống = nhận đủ); [{id, ok:false}] cho thiết bị không tới (→ Thất lạc ở đơn vị xuất)
create or replace function public.stock_transfer_receive(p_transfer uuid, p_lines jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr stock_transfers; it record; src supplies; u record; x jsonb; v_qty numeric; v_supply uuid; v_type uuid; v_from text;
        n_sup int := 0; n_unit int := 0; n_lost int := 0; n_short int := 0;
begin
  select * into tr from stock_transfers where id = p_transfer for update;
  if tr.id is null or tr.to_org <> public.my_org_id() or not public.can_stock('create') then raise exception 'Chỉ đơn vị nhận xác nhận được' using errcode = '42501'; end if;
  if tr.status <> 'shipped' then raise exception 'Phiếu chưa xuất hàng hoặc đã nhận' using errcode = '22023'; end if;
  v_from := (select name from organizations where id = tr.org_id);
  perform set_config('app.stock_engine', 'on', true);
  for it in select * from stock_transfer_items where transfer_id = tr.id loop
    select e into x from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e where e->>'id' = it.id::text;
    if it.supply_id is not null then
      v_qty := coalesce((x->>'qty')::numeric, it.qty);
      if v_qty < 0 then raise exception 'Số lượng nhận không hợp lệ' using errcode = '22023'; end if;
      select * into src from supplies where id = it.supply_id;
      select id into v_supply from supplies s where s.org_id = tr.to_org
         and ((src.sku is not null and lower(s.sku) = lower(src.sku)) or (lower(btrim(s.name)) = lower(btrim(coalesce(src.name, it.name))) and lower(s.unit) = lower(coalesce(src.unit, it.unit, 'cái'))))
       order by (src.sku is not null and lower(s.sku) = lower(src.sku)) desc, s.created_at limit 1;
      if v_supply is null then
        insert into supplies (org_id, sku, name, unit, category)
          values (tr.to_org, case when src.sku is not null and not exists (select 1 from supplies where org_id = tr.to_org and lower(sku) = lower(src.sku)) then src.sku end,
                  coalesce(src.name, it.name), coalesce(src.unit, it.unit, 'cái'), src.category)
          returning id into v_supply;
      end if;
      if v_qty > 0 then
        insert into supply_moves (org_id, supply_id, kind, qty, reason) values (tr.to_org, v_supply, 'in', v_qty, 'Nhận vận chuyển từ ' || v_from || ': ' || tr.title);
      end if;
      if v_qty < it.qty then n_short := n_short + 1; end if;
      update stock_transfer_items set received_qty = v_qty where id = it.id;
      n_sup := n_sup + 1;
    else
      select un.*, t.sku as t_sku, t.name as t_name, t.brand as t_brand, t.category as t_cat into u
        from equipment_units un join equipment_types t on t.id = un.type_id where un.id = it.unit_id;
      if coalesce((x->>'ok')::boolean, true) then
        select id into v_type from equipment_types et where et.org_id = tr.to_org
           and ((u.t_sku is not null and lower(et.sku) = lower(u.t_sku)) or lower(btrim(et.name)) = lower(btrim(u.t_name)))
         order by (u.t_sku is not null and lower(et.sku) = lower(u.t_sku)) desc limit 1;
        if v_type is null then
          insert into equipment_types (org_id, sku, name, brand, category) values (tr.to_org, u.t_sku, u.t_name, u.t_brand, u.t_cat) returning id into v_type;
        end if;
        update equipment_units set org_id = tr.to_org, type_id = v_type, room_id = null, status = 'in_stock' where id = it.unit_id;
        insert into equipment_events (org_id, unit_id, kind, title, note) values (tr.to_org, it.unit_id, 'transfer', 'Nhận vận chuyển từ ' || v_from, tr.title);
        update stock_transfer_items set received_qty = 1 where id = it.id;
        n_unit := n_unit + 1;
      else
        update equipment_units set status = 'lost' where id = it.unit_id;
        insert into equipment_events (org_id, unit_id, kind, title, note) values (u.org_id, it.unit_id, 'transfer', 'Thất lạc khi vận chuyển', tr.title);
        update stock_transfer_items set received_qty = 0 where id = it.id;
        n_lost := n_lost + 1;
      end if;
    end if;
  end loop;
  update stock_transfers set status = 'received', received_at = now(), received_by = auth.uid(), receive_note = nullif(btrim(p_note), '') where id = tr.id;
  perform set_config('app.stock_engine', 'off', true);
  perform public.notify_user(tr.created_by, tr.org_id, 'status', 'Đơn vị nhận đã xác nhận phiếu vận chuyển',
    tr.title || case when n_lost + n_short > 0 then format(' — %s dòng thiếu / thất lạc', n_lost + n_short) else '' end, 'Vận chuyển vật tư', null, tr.id);
  return jsonb_build_object('supplies', n_sup, 'units', n_unit, 'lost', n_lost, 'short', n_short);
end $$;

revoke all on function public.supply_request_receive(uuid, jsonb), public.stock_transfer_ship(uuid), public.stock_transfer_receive(uuid, jsonb, text) from public, anon;
grant execute on function public.supply_request_receive(uuid, jsonb), public.stock_transfer_ship(uuid), public.stock_transfer_receive(uuid, jsonb, text) to authenticated;

-- ===== 9. Thiết bị Thất lạc / Đang vận chuyển không tính là dùng được =====
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
         (select count(*) from equipment_units u where u.type_id = w.type_id and u.org_id = p_org and u.status not in ('broken', 'maintenance', 'lost', 'in_transit'))::int,
         coalesce(h.qty, 0)
    from want w join equipment_types t on t.id = w.type_id left join held h on h.type_id = w.type_id
$$;
revoke all on function public.equipment_shortage(uuid, date, uuid, jsonb, uuid) from public, authenticated;

create or replace function public.equipment_availability(p_day date, p_period uuid default null)
returns table (type_id uuid, usable int, held int, free int)
language sql stable security definer set search_path = public as $$
  select t.id,
         count(u.id) filter (where u.status not in ('broken', 'maintenance', 'lost', 'in_transit'))::int,
         coalesce(h.qty, 0)::int,
         greatest(count(u.id) filter (where u.status not in ('broken', 'maintenance', 'lost', 'in_transit')) - coalesce(h.qty, 0), 0)::int
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

create or replace function public.equipment_type_summary()
returns table (name text, category text, brand text, schools int, units int, usable int, broken int, maintenance int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return query
  select t.name, t.category, min(t.brand), count(distinct t.org_id)::int, count(u.id)::int,
         count(u.id) filter (where u.status not in ('broken', 'maintenance', 'lost', 'in_transit'))::int,
         count(u.id) filter (where u.status = 'broken')::int, count(u.id) filter (where u.status = 'maintenance')::int
    from equipment_types t join organizations o on o.id = t.org_id and o.type = 'school'
    left join equipment_units u on u.type_id = t.id
   where t.org_id in (select public.my_org_tree())
   group by t.name, t.category
   order by count(u.id) desc, t.name;
end $$;

notify pgrst, 'reload schema';
