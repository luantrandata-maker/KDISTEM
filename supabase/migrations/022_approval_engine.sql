-- 022. Công cụ phê duyệt cấu hình được (Bước 2)
--  • approval_workflows + approval_steps: mỗi đơn vị tự đặt quy trình nhiều bước cho từng loại hồ sơ.
--    Sở/Phòng đặt quy trình "áp dụng cho đơn vị trực thuộc" → trường chưa có quy trình riêng sẽ dùng theo.
--  • Mỗi bước: người duyệt là "người có quyền sửa chức năng" (như trước đây) hoặc một vai trò cụ thể
--    (vd: Tổ trưởng – vai trò tuỳ chỉnh), ở tại đơn vị hoặc ở cấp trên (Phòng / Sở / Tỉnh / Bộ).
--  • approval_requests: hồ sơ đang duyệt, chụp lại quy trình lúc gửi (sửa quy trình không ảnh hưởng hồ sơ cũ).
--    approval_actions: lịch sử duyệt / từ chối / ghi chú.
--  • Loại hồ sơ: đăng ký dạy STEM, phiếu mượn, đề xuất mua gói (bảng mới package_orders),
--    kế hoạch giáo dục (education_plans có trạng thái), dự án STEM (bảng sẽ có ở bước dự án).
--  • Luồng cũ chuyển sang công cụ này: màn duyệt cũ vẫn chạy — đổi trạng thái sẽ đi qua quy trình
--    (đủ bước mới thành "Đã duyệt"). Không có quy trình riêng → 1 bước như trước.
-- Cần chạy sau 021.

-- ===== 1. Bảng =====
create table if not exists approval_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('stem_registration','borrow_request','package_purchase','edu_plan','project')),
  name text not null,
  applies_to_children boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (org_id, kind)
);
create table if not exists approval_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references approval_workflows(id) on delete cascade,
  step_no int not null check (step_no between 1 and 10),
  name text not null,
  approver text not null check (approver in ('perm', 'role')),
  role_id uuid references roles(id) on delete cascade,
  org_type text check (org_type in ('ministry','province','department','district','school')),  -- null = tại đơn vị gửi
  unique (workflow_id, step_no),
  check (approver = 'perm' or role_id is not null)
);
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  ref_table text not null,
  ref_id uuid not null,
  title text not null,
  summary text,
  requested_by uuid references profiles(id) on delete set null,
  workflow_id uuid references approval_workflows(id) on delete set null,
  steps jsonb not null,            -- [{no, name, approver, role_id, role_name, org_id, org_name}]
  current_step int not null default 1,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists approval_requests_one_pending on approval_requests (ref_table, ref_id) where status = 'pending';
create index if not exists approval_requests_org_idx on approval_requests (org_id, status, created_at desc);
create index if not exists approval_requests_ref_idx on approval_requests (ref_table, ref_id);
create table if not exists approval_actions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references approval_requests(id) on delete cascade,
  step_no int not null,
  actor uuid references profiles(id) on delete set null,
  decision text not null check (decision in ('approve','reject','comment','cancel')),
  note text,
  at timestamptz not null default now()
);
create index if not exists approval_actions_req_idx on approval_actions (request_id, at);

-- Đề xuất mua gói STEM (trường đề xuất → duyệt theo quy trình, vd: Hiệu trưởng → Sở)
create table if not exists package_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  tier text not null default 'basic' check (tier in ('basic','advanced','premium')),
  programs text,
  grades text,
  quantity int not null default 1 check (quantity > 0),
  budget numeric(14,0),
  note text,
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected')),
  created_by uuid default auth.uid() references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table package_orders enable row level security;
create policy package_orders_read on package_orders for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
create policy package_orders_insert on package_orders for insert to authenticated
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('packages', 'create')) and status in ('draft','pending'));
create policy package_orders_update on package_orders for update to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('packages', 'edit')))
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('packages', 'edit')));
create policy package_orders_delete on package_orders for delete to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('packages', 'delete')) and status in ('draft','rejected'));
grant select, insert, update, delete on package_orders to authenticated;

-- Kế hoạch giáo dục có trạng thái duyệt (kế hoạch cũ coi như đã duyệt)
alter table education_plans add column if not exists status text not null default 'approved';
alter table education_plans drop constraint if exists education_plans_status_check;
alter table education_plans add constraint education_plans_status_check check (status in ('draft','pending','approved','rejected'));
alter table education_plans alter column status set default 'draft';

-- ===== 2. Hàm tra cứu =====
create or replace function public.approval_kind_module(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'stem_registrations' when 'borrow_request' then 'stem_rooms'
    when 'package_purchase' then 'packages' when 'edu_plan' then 'edu_plan' when 'project' then 'projects' end
$$;
create or replace function public.approval_kind_label(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'Đăng ký dạy STEM' when 'borrow_request' then 'Phiếu mượn thiết bị'
    when 'package_purchase' then 'Đề xuất mua gói STEM' when 'edu_plan' then 'Kế hoạch giáo dục' when 'project' then 'Dự án STEM' end
$$;

-- Đơn vị gần nhất có loại p_type, tính từ p_org trở lên (gồm chính nó)
create or replace function public.org_ancestor_of_type(p_org uuid, p_type text) returns uuid
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, type, 0 as d from organizations where id = p_org
    union all
    select o.id, o.parent_id, o.type, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  ) select id from up where type = p_type order by d limit 1
$$;

-- Quy trình hiệu lực của một đơn vị: của chính nó, hoặc của cấp trên gần nhất có "áp dụng cho đơn vị trực thuộc"
create or replace function public.approval_effective_workflow(p_org uuid, p_kind text) returns uuid
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, 0 as d from organizations where id = p_org
    union all
    select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  )
  select w.id from up join approval_workflows w on w.org_id = up.id and w.kind = p_kind and w.is_active
   where up.d = 0 or w.applies_to_children
   order by up.d limit 1
$$;

-- Dựng danh sách bước cho hồ sơ (bỏ bước không có đơn vị duyệt tương ứng; không có gì → 1 bước mặc định)
create or replace function public.approval_build_steps(p_org uuid, p_kind text, p_workflow uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; v jsonb := '[]'::jsonb; v_org uuid; n int := 0;
begin
  if p_workflow is not null then
    for s in select st.*, r.name as role_name from approval_steps st left join roles r on r.id = st.role_id
              where st.workflow_id = p_workflow order by st.step_no loop
      v_org := case when s.org_type is null then p_org else public.org_ancestor_of_type(p_org, s.org_type) end;
      continue when v_org is null;
      n := n + 1;
      v := v || jsonb_build_object('no', n, 'name', s.name, 'approver', s.approver, 'role_id', s.role_id, 'role_name', s.role_name,
                                   'org_id', v_org, 'org_name', (select name from organizations where id = v_org));
    end loop;
  end if;
  if n = 0 then
    v := jsonb_build_array(jsonb_build_object('no', 1, 'name', 'Duyệt', 'approver', 'perm', 'role_id', null, 'role_name', null,
                                              'org_id', p_org, 'org_name', (select name from organizations where id = p_org)));
  end if;
  return v;
end $$;

-- Người dùng hiện tại có duyệt được bước đang chờ của hồ sơ không
create or replace function public.approval_can_act(p_request uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r approval_requests; st jsonb; v_org uuid;
begin
  select * into r from approval_requests where id = p_request;
  if r.id is null or r.status <> 'pending' then return false; end if;
  st := r.steps -> (r.current_step - 1);
  v_org := (st->>'org_id')::uuid;
  if v_org is distinct from public.my_org_id() then return false; end if;
  if st->>'approver' = 'role' then
    return exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = v_org and m.role_id = (st->>'role_id')::uuid);
  end if;
  return public.has_perm(public.approval_kind_module(r.kind), 'edit');
end $$;
grant execute on function public.approval_can_act(uuid) to authenticated;

-- ===== 3. Thông báo cho người duyệt bước hiện tại =====
create or replace function public.approval_notify_step(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_requests; st jsonb; v_org uuid; v_portal text; u uuid;
begin
  select * into r from approval_requests where id = p_request;
  st := r.steps -> (r.current_step - 1);
  v_org := (st->>'org_id')::uuid;
  v_portal := case when (select type from organizations where id = v_org) = 'school'
                   then coalesce((select portal from roles where id = (st->>'role_id')::uuid), 'school_admin') else 'department' end;
  for u in select distinct m.user_id from memberships m
            where m.org_id = v_org
              and case when st->>'approver' = 'role' then m.role_id = (st->>'role_id')::uuid
                       else public.user_has_perm(m.user_id, public.approval_kind_module(r.kind), 'edit', v_org) end loop
    perform public.notify_user(u, v_org, 'approval', public.approval_kind_label(r.kind) || ' chờ duyệt'
      || case when jsonb_array_length(r.steps) > 1 then format(' (bước %s/%s)', r.current_step, jsonb_array_length(r.steps)) else '' end,
      r.title, 'Hộp phê duyệt', v_portal, r.id);
  end loop;
end $$;

-- ===== 4. Tạo hồ sơ khi bản ghi chuyển sang "chờ duyệt" =====
create or replace function public.approval_open(p_org uuid, p_kind text, p_table text, p_ref uuid, p_title text, p_summary text, p_by uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_wf uuid; v_id uuid;
begin
  update approval_requests set status = 'cancelled', decided_at = now() where ref_table = p_table and ref_id = p_ref and status = 'pending';
  v_wf := public.approval_effective_workflow(p_org, p_kind);
  insert into approval_requests (org_id, kind, ref_table, ref_id, title, summary, requested_by, workflow_id, steps)
    values (p_org, p_kind, p_table, p_ref, p_title, p_summary, p_by, v_wf, public.approval_build_steps(p_org, p_kind, v_wf))
    returning id into v_id;
  perform public.approval_notify_step(v_id);
  return v_id;
end $$;

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
  end if;
  perform public.approval_open(new.org_id, v_kind, tg_table_name, new.id, v_title, v_sum, v_by);
  return null;
end $$;

-- Xoá bản ghi → huỷ hồ sơ đang chờ
create or replace function public.approval_source_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update approval_requests set status = 'cancelled', decided_at = now() where ref_table = tg_table_name and ref_id = old.id and status = 'pending';
  return null;
end $$;

-- ===== 5. Duyệt / từ chối =====
-- p_sync: cập nhật trạng thái bản ghi gốc (false khi được gọi từ trigger của chính bản ghi đó)
create or replace function public.approval_apply(p_request uuid, p_decision text, p_note text, p_sync boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r approval_requests; n int; v_final text; st jsonb;
begin
  select * into r from approval_requests where id = p_request for update;
  if r.id is null then raise exception 'Không tìm thấy hồ sơ'; end if;
  if r.status <> 'pending' then raise exception 'Hồ sơ đã được xử lý' using errcode = '55000'; end if;
  if p_decision not in ('approve', 'reject', 'comment') then raise exception 'Quyết định không hợp lệ'; end if;
  n := jsonb_array_length(r.steps);
  st := r.steps -> (r.current_step - 1);
  -- Người duyệt bước hiện tại; riêng TỪ CHỐI thì Ban giám hiệu / quản trị của đơn vị gửi luôn làm được
  if not public.approval_can_act(r.id)
     and not (p_decision = 'reject' and public.my_org_id() = r.org_id and public.is_admin()) then
    raise exception 'Bạn không phải người duyệt bước "%"', st->>'name' using errcode = '42501';
  end if;
  insert into approval_actions (request_id, step_no, actor, decision, note) values (r.id, r.current_step, auth.uid(), p_decision, nullif(trim(p_note), ''));
  if p_decision = 'comment' then return jsonb_build_object('status', 'pending', 'step', r.current_step, 'steps', n); end if;

  if p_decision = 'approve' and r.current_step < n then
    update approval_requests set current_step = current_step + 1 where id = r.id;
    perform public.approval_notify_step(r.id);
    return jsonb_build_object('status', 'pending', 'step', r.current_step + 1, 'steps', n,
                              'next', r.steps -> r.current_step ->> 'name', 'next_org', r.steps -> r.current_step ->> 'org_name');
  end if;

  v_final := case p_decision when 'approve' then 'approved' else 'rejected' end;
  update approval_requests set status = v_final, decided_at = now() where id = r.id;
  if p_sync then
    perform set_config('app.approval_engine', 'on', true);
    execute format('update %I set status = $1 where id = $2', r.ref_table) using v_final, r.ref_id;
    perform set_config('app.approval_engine', 'off', true);
  end if;
  -- Báo người gửi (đăng ký STEM, phiếu mượn đã có thông báo riêng khi đổi trạng thái)
  if r.kind not in ('stem_registration', 'borrow_request') then
    perform public.notify_user(r.requested_by, r.org_id, 'status',
      public.approval_kind_label(r.kind) || case v_final when 'approved' then ' đã được duyệt' else ' bị từ chối' end,
      r.title || coalesce(' — ' || nullif(trim(p_note), ''), ''), 'Hộp phê duyệt', null, r.id);
  end if;
  return jsonb_build_object('status', v_final, 'step', r.current_step, 'steps', n);
end $$;
revoke execute on function public.approval_apply(uuid, text, text, boolean) from public, anon, authenticated;

create or replace function public.approval_decide(p_request uuid, p_decision text, p_note text default null)
returns jsonb language sql security definer set search_path = public as $$
  select public.approval_apply(p_request, p_decision, p_note, true)
$$;
-- Theo bản ghi gốc (dùng ở các màn cũ: Duyệt đăng ký, Mượn – Trả...)
create or replace function public.approval_decide_ref(p_table text, p_ref uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from approval_requests where ref_table = p_table and ref_id = p_ref and status = 'pending';
  if v is null then raise exception 'Không có hồ sơ chờ duyệt' using errcode = '55000'; end if;
  return public.approval_apply(v, p_decision, p_note, true);
end $$;
-- Người gửi rút hồ sơ
create or replace function public.approval_cancel(p_request uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_requests;
begin
  select * into r from approval_requests where id = p_request for update;
  if r.requested_by is distinct from auth.uid() or r.status <> 'pending' then raise exception 'Không rút được hồ sơ này' using errcode = '42501'; end if;
  insert into approval_actions (request_id, step_no, actor, decision, note) values (r.id, r.current_step, auth.uid(), 'cancel', p_note);
  update approval_requests set status = 'cancelled', decided_at = now() where id = r.id;
  perform set_config('app.approval_engine', 'on', true);
  -- Đề xuất, kế hoạch: về nháp để sửa và gửi lại; đăng ký dạy, phiếu mượn: coi như huỷ (không còn kẹt ở "chờ duyệt")
  execute format('update %I set status = $1 where id = $2', r.ref_table)
    using case when r.ref_table in ('package_orders', 'education_plans') then 'draft' else 'rejected' end, r.ref_id;
  perform set_config('app.approval_engine', 'off', true);
end $$;
grant execute on function public.approval_decide(uuid, text, text), public.approval_decide_ref(text, uuid, text, text),
  public.approval_cancel(uuid, text) to authenticated;

-- Đổi trạng thái trực tiếp trên bản ghi gốc (màn cũ, API) → đi qua quy trình
create or replace function public.approval_source_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_req uuid; res jsonb;
begin
  if coalesce(current_setting('app.approval_engine', true), 'off') = 'on' then return new; end if;
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then return new; end if;
  select id into v_req from approval_requests where ref_table = tg_table_name and ref_id = new.id and status = 'pending';
  if v_req is null then
    if old.status in ('approved', 'lent', 'returned') and new.status = 'rejected' and tg_table_name = 'borrow_requests' then return new; end if;
    raise exception 'Bản ghi phải được gửi duyệt và duyệt theo quy trình' using errcode = '42501';
  end if;
  res := public.approval_apply(v_req, case new.status when 'approved' then 'approve' else 'reject' end, null, false);
  new.status := case res->>'status' when 'pending' then 'pending' else res->>'status' end;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['stem_registrations', 'borrow_requests', 'package_orders', 'education_plans'] loop
    execute format('drop trigger if exists %I on %I', t || '_approval_open', t);
    execute format('create trigger %I after insert or update of status on %I for each row execute function public.approval_source_opened()', t || '_approval_open', t);
    execute format('drop trigger if exists %I on %I', t || '_approval_guard', t);
    execute format('create trigger %I before update of status on %I for each row execute function public.approval_source_guard()', t || '_approval_guard', t);
    execute format('drop trigger if exists %I on %I', t || '_approval_deleted', t);
    execute format('create trigger %I after delete on %I for each row execute function public.approval_source_deleted()', t || '_approval_deleted', t);
  end loop;
end $$;

-- Thông báo "chờ duyệt" nay do công cụ phê duyệt gửi cho đúng người duyệt từng bước
create or replace function public.notify_stem_registration() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected') then
    perform public.notify_user(public.teacher_profile(new.teacher_id), new.org_id, 'status',
      case new.status when 'approved' then 'Đăng ký dạy STEM đã được duyệt' else 'Đăng ký dạy STEM bị từ chối' end,
      new.topic || ' · ' || public.vn_date(new.on_date), 'Đặt phòng STEM', 'teacher', new.id);
  end if;
  return null;
end $$;
create or replace function public.notify_borrow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.notify_user(public.teacher_profile(new.teacher_id), new.org_id, 'status',
      'Phiếu mượn: ' || case new.status when 'approved' then 'đã được duyệt' when 'lent' then 'đã giao thiết bị'
        when 'returned' then 'đã trả' when 'rejected' then 'bị từ chối' else new.status end,
      new.title || ' · ' || public.vn_date(new.on_date), 'Đặt phòng STEM', 'teacher', new.id);
  end if;
  return null;
end $$;

-- ===== 6. Lưu quy trình (một lần gọi, thay toàn bộ bước) =====
create or replace function public.approval_save_workflow(p_kind text, p_name text, p_applies boolean, p_steps jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_wf uuid; s jsonb; i int := 0; v_type text;
begin
  if not (public.is_admin() or public.is_authority()) then raise exception 'Chỉ quản trị đơn vị được đặt quy trình' using errcode = '42501'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then raise exception 'Quy trình cần ít nhất một bước'; end if;
  select type into v_type from organizations where id = v_org;
  insert into approval_workflows (org_id, kind, name, applies_to_children, updated_at, updated_by)
    values (v_org, p_kind, coalesce(nullif(trim(p_name), ''), public.approval_kind_label(p_kind)), coalesce(p_applies, false) and v_type <> 'school', now(), auth.uid())
    on conflict (org_id, kind) do update set name = excluded.name, applies_to_children = excluded.applies_to_children,
      is_active = true, updated_at = now(), updated_by = auth.uid()
    returning id into v_wf;
  delete from approval_steps where workflow_id = v_wf;
  for s in select * from jsonb_array_elements(p_steps) loop
    i := i + 1;
    if s->>'approver' = 'role' and not exists (
         select 1 from roles r where r.id = (s->>'role_id')::uuid and (r.org_id is null or r.org_id = v_org)) then
      raise exception 'Vai trò ở bước % không hợp lệ', i;
    end if;
    insert into approval_steps (workflow_id, step_no, name, approver, role_id, org_type)
      values (v_wf, i, coalesce(nullif(trim(s->>'name'), ''), 'Bước ' || i), s->>'approver',
              case when s->>'approver' = 'role' then (s->>'role_id')::uuid end, nullif(s->>'org_type', ''));
  end loop;
  return v_wf;
end $$;
create or replace function public.approval_reset_workflow(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_authority()) then raise exception 'Chỉ quản trị đơn vị được đặt quy trình' using errcode = '42501'; end if;
  delete from approval_workflows where org_id = public.my_org_id() and kind = p_kind;
end $$;
grant execute on function public.approval_save_workflow(text, text, boolean, jsonb), public.approval_reset_workflow(text),
  public.approval_effective_workflow(uuid, text) to authenticated;

-- Hộp phê duyệt: hồ sơ tôi duyệt được ngay bây giờ
create or replace function public.approval_inbox()
returns setof approval_requests language sql stable security definer set search_path = public as $$
  select r.* from approval_requests r
   where r.status = 'pending'
     and (r.steps -> (r.current_step - 1) ->> 'org_id')::uuid = public.my_org_id()
     and public.approval_can_act(r.id)
   order by r.created_at
$$;
grant execute on function public.approval_inbox() to authenticated;

-- Hàm nội bộ: chỉ trigger / hàm khác gọi, không mở cho ứng dụng
revoke execute on function public.approval_open(uuid, text, text, uuid, text, text, uuid), public.approval_notify_step(uuid),
  public.approval_build_steps(uuid, text, uuid), public.org_ancestor_of_type(uuid, text),
  public.approval_source_opened(), public.approval_source_deleted(), public.approval_source_guard()
  from public, anon, authenticated;

-- ===== 7. RLS =====
alter table approval_workflows enable row level security;
alter table approval_steps enable row level security;
alter table approval_requests enable row level security;
alter table approval_actions enable row level security;
create policy approval_workflows_read on approval_workflows for select to authenticated
  using ((select public.is_staff()) and (org_id in (select public.my_org_tree()) or org_id in (select public.my_ancestor_orgs())));
create policy approval_steps_read on approval_steps for select to authenticated
  using (exists (select 1 from approval_workflows w where w.id = workflow_id));
create policy approval_requests_read on approval_requests for select to authenticated
  using (((select public.is_staff()) and org_id in (select public.my_org_tree()))
         or requested_by = auth.uid()
         or (steps -> (current_step - 1) ->> 'org_id')::uuid = (select public.my_org_id()));
create policy approval_actions_read on approval_actions for select to authenticated
  using (exists (select 1 from approval_requests r where r.id = request_id));
grant select on approval_workflows, approval_steps, approval_requests, approval_actions to authenticated;

-- Quyền module mới (mặc định: quản trị toàn quyền, giáo viên xem)
insert into role_permissions (role_id, module, can_view, can_detail, can_create, can_edit, can_delete)
select r.id, 'approvals', r.key in ('principal','it_admin','teacher','office_staff'), r.key in ('principal','it_admin','teacher','office_staff'),
       r.key in ('principal','it_admin'), r.key in ('principal','it_admin'), r.key in ('principal','it_admin')
  from roles r where r.org_id is null and r.key in ('principal','it_admin','teacher','office_staff')
on conflict do nothing;

-- ===== 8. Chuyển dữ liệu cũ: hồ sơ cho các đăng ký / phiếu mượn đang chờ =====
do $$
declare x record;
begin
  for x in select * from stem_registrations s where status = 'pending'
            and not exists (select 1 from approval_requests a where a.ref_table = 'stem_registrations' and a.ref_id = s.id and a.status = 'pending') loop
    insert into approval_requests (org_id, kind, ref_table, ref_id, title, summary, requested_by, steps, created_at)
      values (x.org_id, 'stem_registration', 'stem_registrations', x.id, x.topic,
              public.teacher_name(x.teacher_id) || ' · ' || coalesce((select name from classes where id = x.class_id), '') || ' · ' || public.vn_date(x.on_date),
              public.teacher_profile(x.teacher_id), public.approval_build_steps(x.org_id, 'stem_registration', null), x.created_at);
  end loop;
  for x in select * from borrow_requests b where status = 'pending'
            and not exists (select 1 from approval_requests a where a.ref_table = 'borrow_requests' and a.ref_id = b.id and a.status = 'pending') loop
    insert into approval_requests (org_id, kind, ref_table, ref_id, title, summary, requested_by, steps, created_at)
      values (x.org_id, 'borrow_request', 'borrow_requests', x.id, x.title,
              coalesce(public.teacher_name(x.teacher_id), '') || ' · ' || public.vn_date(x.on_date),
              public.teacher_profile(x.teacher_id), public.approval_build_steps(x.org_id, 'borrow_request', null), x.created_at);
  end loop;
end $$;

-- Ví dụ: Sở GD&ĐT Hưng Yên đặt quy trình đề xuất mua gói cho các trường trực thuộc: Hiệu trưởng → Sở
do $$
declare v_so uuid; v_wf uuid;
begin
  select id into v_so from organizations where code = 'SO-HY';
  if v_so is null or exists (select 1 from approval_workflows where org_id = v_so and kind = 'package_purchase') then return; end if;
  insert into approval_workflows (org_id, kind, name, applies_to_children, updated_by)
    values (v_so, 'package_purchase', 'Đề xuất mua gói STEM — trường trực thuộc Sở', true, null) returning id into v_wf;
  insert into approval_steps (workflow_id, step_no, name, approver, role_id, org_type) values
    (v_wf, 1, 'Hiệu trưởng xác nhận', 'role', (select id from roles where key = 'principal' and org_id is null), null),
    (v_wf, 2, 'Sở GD&ĐT phê duyệt', 'role', (select id from roles where key = 'department' and org_id is null), 'department');
end $$;

-- Việc chờ xử lý: thêm số hồ sơ tôi cần duyệt
create or replace function public.my_pending_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'stem_registrations', case when public.has_perm('stem_registrations','edit')
      then (select count(*) from stem_registrations where org_id = public.my_org_id() and status = 'pending') else 0 end,
    'borrow_requests', case when public.has_perm('stem_rooms','edit')
      then (select count(*) from borrow_requests where org_id = public.my_org_id() and status = 'pending') else 0 end,
    'warranty_tickets', case when public.has_perm('warranty','edit')
      then (select count(*) from warranty_tickets where org_id = public.my_org_id() and status in ('new','accepted','waiting_parts','processing')) else 0 end,
    'to_grade', coalesce((select count(*) from submissions s join assignments a on a.id = s.assignment_id
      where a.teacher_id = public.my_teacher_id() and s.status <> 'graded'), 0),
    'approvals', (select count(*) from public.approval_inbox()),
    'unread', (select count(*) from notifications where user_id = auth.uid() and org_id = public.my_org_id() and read_at is null)
  )
$$;

notify pgrst, 'reload schema';
