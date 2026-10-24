-- 084. Phân hệ 1 — Kế hoạch tập huấn (đợt 2)
--  Kế hoạch tập huấn theo khuôn Phân hệ 2: Soạn → Phát hành → Gán trường → Trường chọn giáo viên → Duyệt danh sách.
--  • training_plans (bảng cũ) thêm: mã KHTH-xxx (plan_code), trạng thái bản (pub_status: Nháp / Đã phát hành / Ngừng dùng),
--    năm học, đợt (hè, HK1, HK2), thời gian dự kiến, kinh phí dự kiến, ghi chú. Cột status cũ giữ nghĩa tiến độ
--    (Dự kiến / Đang thực hiện / Hoàn thành). Kế hoạch cũ coi như đã phát hành nên các trang cũ vẫn chạy.
--  • training_plan_items: các chương trình tập huấn (083, đã phát hành) trong kế hoạch, chỉ tiêu GV, giảng viên.
--  • training_plan_orgs: trường được gán, chỉ tiêu của trường, trạng thái danh sách GV
--    (Đã gán → Chờ duyệt → Đã duyệt / Trả lại). Ghi danh GV dùng lại training_enrollments.
--    GV tính theo trường của GV (teachers.org_id). Danh sách đã gửi hoặc đã duyệt thì trường không thêm / bớt GV
--    được nữa (đơn vị lập kế hoạch vẫn sửa được).
--  • RPC: training_plan_assign / training_plan_unassign (đơn vị lập kế hoạch), training_plan_submit (trường),
--    training_plan_review (đơn vị lập kế hoạch duyệt hoặc trả lại).
--  • Chuyển dữ liệu cũ: trường có GV đã ghi danh vào kế hoạch của cấp trên → gán sẵn, danh sách Đã duyệt.
-- Cần chạy sau 083.

-- ===== 1. Thêm cột cho kế hoạch =====
alter table training_plans
  add column if not exists plan_code text,
  add column if not exists pub_status text not null default 'published',
  add column if not exists year_name text,
  add column if not exists term text,
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists budget numeric(14,0),
  add column if not exists note text,
  add column if not exists published_at timestamptz,
  add column if not exists created_by uuid references profiles(id) on delete set null default auth.uid(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
do $$ begin
  alter table training_plans add constraint training_plans_pub_status_check check (pub_status in ('draft', 'published', 'archived'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table training_plans add constraint training_plans_v2_check check (
    (term is null or term in ('summer', 'hk1', 'hk2', 'other'))
    and (year_name is null or length(year_name) <= 20)
    and (budget is null or budget >= 0)
    and (note is null or length(note) <= 2000)
    and (ends_on is null or starts_on is null or ends_on >= starts_on));
exception when duplicate_object then null; end $$;
alter table training_plans alter column org_id set default public.my_org_id();

-- Mã KHTH-xxx cho kế hoạch cũ, theo đơn vị
with x as (select id, row_number() over (partition by org_id order by year_no nulls last, module_no nulls last, name) n
             from training_plans where plan_code is null)
update training_plans p set plan_code = 'KHTH-' || lpad((x.n + coalesce((select max(substring(q.plan_code from '^KHTH-(\d+)$')::int)
                                                     from training_plans q where q.org_id = p.org_id), 0))::text, 3, '0')
  from x where x.id = p.id;
create unique index if not exists training_plans_plan_code on training_plans (org_id, plan_code);

-- ===== 2. Chương trình trong kế hoạch, trường được gán =====
create table if not exists training_plan_items (
  plan_id uuid not null references training_plans(id) on delete cascade,
  program_id uuid not null references training_programs(id) on delete restrict,
  seq int not null default 1 check (seq between 1 and 99),
  quota int check (quota is null or quota between 0 and 100000),
  trainer text check (trainer is null or length(trainer) <= 200),
  note text check (note is null or length(note) <= 500),
  primary key (plan_id, program_id)
);

create table if not exists training_plan_orgs (
  plan_id uuid not null references training_plans(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  quota int check (quota is null or quota between 0 and 10000),
  status text not null default 'assigned' check (status in ('assigned', 'submitted', 'approved', 'returned')),
  note text check (note is null or length(note) <= 1000),
  assigned_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null,
  primary key (plan_id, org_id)
);
create index if not exists training_plan_orgs_org on training_plan_orgs (org_id);

-- ===== 3. Quyền =====
-- Đơn vị lập kế hoạch: nhân sự có quyền sửa tập huấn hoặc cơ quan quản lý của chính đơn vị đó; KDI với kế hoạch của KDI
create or replace function public.training_can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((p_org = public.my_org_id() and public.is_staff() and (public.has_perm('training', 'edit') or public.is_authority()))
      or (p_org = public.platform_org_id() and public.is_platform_admin()), false)
$$;
create or replace function public.training_plan_can_manage(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_plans p where p.id = p_plan and public.training_can_write(p.org_id))
$$;
-- Kế hoạch đã gán cho đơn vị mình (hoặc trường trực thuộc)
create or replace function public.training_plan_assigned_to_me(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_plan_orgs o where o.plan_id = p_plan and o.org_id in (select public.my_org_tree()))
$$;
revoke all on function public.training_can_write(uuid) from public, anon;
revoke all on function public.training_plan_can_manage(uuid) from public, anon;
revoke all on function public.training_plan_assigned_to_me(uuid) from public, anon;
grant execute on function public.training_can_write(uuid) to authenticated;
grant execute on function public.training_plan_can_manage(uuid) to authenticated;
grant execute on function public.training_plan_assigned_to_me(uuid) to authenticated;

drop policy if exists training_plans_manage on training_plans;
create policy training_plans_manage on training_plans for all to authenticated
  using (public.training_can_write(org_id)) with check (public.training_can_write(org_id));
-- Bản nháp của cấp trên không hiện ở trường
drop policy if exists training_plans_from_department on training_plans;
create policy training_plans_from_department on training_plans for select to authenticated
  using (public.is_staff() and pub_status <> 'draft' and org_id in (select public.my_ancestor_orgs()));
drop policy if exists training_plans_assigned_read on training_plans;
create policy training_plans_assigned_read on training_plans for select to authenticated
  using (public.is_staff() and pub_status <> 'draft' and public.training_plan_assigned_to_me(id));

alter table training_plan_items enable row level security;
alter table training_plan_orgs enable row level security;
drop policy if exists training_plan_items_read on training_plan_items;
create policy training_plan_items_read on training_plan_items for select to authenticated
  using (exists (select 1 from training_plans p where p.id = plan_id));
drop policy if exists training_plan_items_write on training_plan_items;
create policy training_plan_items_write on training_plan_items for all to authenticated
  using (public.training_plan_can_manage(plan_id)) with check (public.training_plan_can_manage(plan_id));
-- Gán / duyệt chỉ qua RPC; đọc: đơn vị lập kế hoạch và trường được gán (cùng cấp trên của trường)
drop policy if exists training_plan_orgs_read on training_plan_orgs;
create policy training_plan_orgs_read on training_plan_orgs for select to authenticated
  using (public.training_plan_can_manage(plan_id) or (public.is_staff() and public.can_access_org(org_id)));
grant select, insert, update, delete on training_plan_items to authenticated;
grant select on training_plan_orgs to authenticated;

-- ===== 4. Kiểm tra dữ liệu =====
create or replace function public.training_plan_errors(p_plan uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'chưa chọn năm học' from training_plans where id = p_plan and year_name is null),
    case when not exists (select 1 from training_plan_items where plan_id = p_plan) then 'chưa chọn chương trình tập huấn' end,
    (select 'chương trình "' || t.title || '" chưa phát hành' from training_plan_items i join training_programs t on t.id = i.program_id
      where i.plan_id = p_plan and t.status <> 'published' order by i.seq limit 1))
$$;
revoke all on function public.training_plan_errors(uuid) from public, anon;
grant execute on function public.training_plan_errors(uuid) to authenticated;

create or replace function public.training_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from training_plan_orgs where plan_id = old.id) then
      raise exception 'Kế hoạch đã gán cho trường: bỏ gán hết trường hoặc chuyển sang Ngừng dùng' using errcode = '22023';
    end if;
    return old;
  end if;
  new.name := btrim(new.name); new.updated_at := now();
  new.year_name := nullif(btrim(new.year_name), ''); new.note := nullif(btrim(new.note), '');
  if tg_op = 'INSERT' then
    if new.plan_code is null or btrim(new.plan_code) = '' then
      select 'KHTH-' || lpad((coalesce(max(substring(plan_code from '^KHTH-(\d+)$')::int), 0) + 1)::text, 3, '0') into new.plan_code
        from training_plans where org_id = new.org_id;
    end if;
    if new.pub_status = 'published' then new.published_at := now(); end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.plan_code is distinct from old.plan_code then
    raise exception 'Không đổi đơn vị hoặc mã của kế hoạch tập huấn' using errcode = '22023';
  end if;
  if old.pub_status <> 'draft' and new.pub_status <> 'draft'
     and (new.name, new.year_name, new.term, new.mode, new.provider, new.starts_on, new.ends_on, new.budget)
         is distinct from (old.name, old.year_name, old.term, old.mode, old.provider, old.starts_on, old.ends_on, old.budget) then
    raise exception 'Kế hoạch đã phát hành: chuyển về nháp để sửa' using errcode = '22023';
  end if;
  if new.pub_status = 'draft' and old.pub_status <> 'draft' and exists (select 1 from training_plan_orgs where plan_id = new.id) then
    raise exception 'Kế hoạch đã gán cho trường nên không chuyển về nháp được' using errcode = '22023';
  end if;
  if new.pub_status = 'published' and old.pub_status = 'draft' then
    v_err := public.training_plan_errors(new.id);
    if v_err is not null then raise exception 'Chưa phát hành được: %', v_err using errcode = '22023'; end if;
    -- Tóm tắt cho các trang cũ: loại chương trình (CT1–CT5) và tổng số giờ
    select string_agg(distinct t.ct_code, ',' order by t.ct_code) into new.program
      from training_plan_items i join training_programs t on t.id = i.program_id where i.plan_id = new.id and t.ct_code is not null;
    new.code := new.program;
    select round(coalesce(sum(u.hours), 0))::int into new.hours
      from training_plan_items i join training_program_units u on u.program_id = i.program_id and u.kind = 'content' where i.plan_id = new.id;
    new.published_at := now();
  end if;
  return new;
end $$;
drop trigger if exists training_plans_guard on training_plans;
create trigger training_plans_guard before insert or update or delete on training_plans for each row execute function public.training_plans_guard();

-- Chương trình trong kế hoạch chỉ sửa khi kế hoạch còn nháp; chỉ chọn chương trình đã phát hành
create or replace function public.training_plan_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_st text;
begin
  select pub_status into v_st from training_plans where id = r.plan_id;
  if v_st is null then return coalesce(new, old); end if;      -- xoá theo dây chuyền
  if v_st <> 'draft' then raise exception 'Kế hoạch đã phát hành: chuyển về nháp để sửa' using errcode = '22023'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if (tg_op = 'INSERT' or new.program_id <> old.program_id)
     and not exists (select 1 from training_programs t where t.id = new.program_id and t.status = 'published') then
    raise exception 'Chỉ chọn chương trình tập huấn đã phát hành' using errcode = '22023';
  end if;
  new.trainer := nullif(btrim(new.trainer), ''); new.note := nullif(btrim(new.note), '');
  return new;
end $$;
drop trigger if exists training_plan_items_guard on training_plan_items;
create trigger training_plan_items_guard before insert or update or delete on training_plan_items for each row execute function public.training_plan_items_guard();

-- Ghi danh theo kế hoạch đã gán (trường tính theo trường của GV): danh sách đã gửi / đã duyệt thì trường không thêm, bớt GV
create or replace function public.training_enrollments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_st text;
begin
  if tg_op = 'UPDATE' and new.teacher_id = old.teacher_id and new.plan_id = old.plan_id then return new; end if;
  select o.status into v_st from training_plan_orgs o join teachers t on t.org_id = o.org_id
   where o.plan_id = r.plan_id and t.id = r.teacher_id;
  if v_st is null then return coalesce(new, old); end if;      -- kế hoạch cũ / kế hoạch riêng của trường
  if v_st in ('submitted', 'approved') and not public.training_plan_can_manage(r.plan_id)
     and current_setting('app.training_unassign', true) is distinct from 'on' then
    raise exception 'Danh sách giáo viên đã gửi duyệt: chờ đơn vị lập kế hoạch trả lại để sửa' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists training_enrollments_guard on training_enrollments;
create trigger training_enrollments_guard before insert or update or delete on training_enrollments for each row execute function public.training_enrollments_guard();

-- ===== 5. Gán trường, gửi danh sách, duyệt =====
create or replace function public.training_plan_assign(p_plan uuid, p_orgs uuid[], p_quota int default null) returns int
language plpgsql security definer set search_path = public as $$
declare p training_plans; v_org uuid; n int := 0;
begin
  select * into p from training_plans where id = p_plan;
  if p.id is null or not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không gán được kế hoạch này' using errcode = '42501'; end if;
  if p.pub_status <> 'published' then raise exception 'Chỉ gán được kế hoạch đã phát hành' using errcode = '22023'; end if;
  if p_quota is not null and p_quota not between 0 and 10000 then raise exception 'Chỉ tiêu không hợp lệ' using errcode = '22023'; end if;
  foreach v_org in array coalesce(p_orgs, '{}') loop
    if v_org is null or not (v_org in (select public.my_org_tree()) or public.is_platform_admin()) then
      raise exception 'Trường không thuộc phạm vi quản lý' using errcode = '42501';
    end if;
    if not exists (select 1 from organizations o where o.id = v_org and o.type = 'school') then
      raise exception 'Chỉ gán kế hoạch tập huấn cho trường' using errcode = '22023';
    end if;
    insert into training_plan_orgs (plan_id, org_id, quota) values (p_plan, v_org, p_quota)
    on conflict (plan_id, org_id) do update set quota = coalesce(excluded.quota, training_plan_orgs.quota);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Bỏ gán: bỏ luôn GV trường đó đã ghi danh vào kế hoạch
create or replace function public.training_plan_unassign(p_plan uuid, p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không sửa được kế hoạch này' using errcode = '42501'; end if;
  perform set_config('app.training_unassign', 'on', true);
  delete from training_enrollments e using teachers t where e.plan_id = p_plan and t.id = e.teacher_id and t.org_id = p_org;
  perform set_config('app.training_unassign', 'off', true);
  delete from training_plan_orgs where plan_id = p_plan and org_id = p_org;
end $$;

-- Trường gửi danh sách GV để duyệt
create or replace function public.training_plan_submit(p_plan uuid, p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare o training_plan_orgs; v_org uuid := coalesce(p_org, public.my_org_id()); v_n int;
begin
  if not (v_org in (select public.my_org_tree()) and public.is_staff() and (public.has_perm('training', 'edit') or public.has_perm('training', 'create'))) then
    raise exception 'Bạn không gửi được danh sách của trường này' using errcode = '42501';
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = v_org for update;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if o.status not in ('assigned', 'returned') then raise exception 'Danh sách đã gửi rồi' using errcode = '22023'; end if;
  select count(*) into v_n from training_enrollments e join teachers t on t.id = e.teacher_id where e.plan_id = p_plan and t.org_id = v_org;
  if v_n = 0 then raise exception 'Chưa chọn giáo viên nào' using errcode = '22023'; end if;
  if o.quota is not null and v_n > o.quota then
    raise exception 'Đã chọn % giáo viên, vượt chỉ tiêu % của trường', v_n, o.quota using errcode = '22023';
  end if;
  update training_plan_orgs set status = 'submitted', submitted_at = now() where plan_id = p_plan and org_id = v_org;
end $$;

-- Đơn vị lập kế hoạch duyệt hoặc trả lại (kèm lý do)
create or replace function public.training_plan_review(p_plan uuid, p_org uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o training_plan_orgs;
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không duyệt được kế hoạch này' using errcode = '42501'; end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = p_org for update;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if p_approve and o.status <> 'submitted' then raise exception 'Trường chưa gửi danh sách' using errcode = '22023'; end if;
  if not p_approve and o.status not in ('submitted', 'approved') then raise exception 'Danh sách chưa gửi nên không trả lại được' using errcode = '22023'; end if;
  if not p_approve and nullif(btrim(p_note), '') is null then raise exception 'Nhập lý do trả lại' using errcode = '22023'; end if;
  update training_plan_orgs set status = case when p_approve then 'approved' else 'returned' end,
         note = left(nullif(btrim(p_note), ''), 1000), decided_at = now(), decided_by = auth.uid()
   where plan_id = p_plan and org_id = p_org;
end $$;

revoke all on function public.training_plan_assign(uuid, uuid[], int) from public, anon;
revoke all on function public.training_plan_unassign(uuid, uuid) from public, anon;
revoke all on function public.training_plan_submit(uuid, uuid) from public, anon;
revoke all on function public.training_plan_review(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.training_plan_assign(uuid, uuid[], int) to authenticated;
grant execute on function public.training_plan_unassign(uuid, uuid) to authenticated;
grant execute on function public.training_plan_submit(uuid, uuid) to authenticated;
grant execute on function public.training_plan_review(uuid, uuid, boolean, text) to authenticated;

-- ===== 6. Chuyển dữ liệu cũ: trường có GV ghi danh vào kế hoạch của cấp trên → gán sẵn, đã duyệt =====
insert into training_plan_orgs (plan_id, org_id, status, assigned_at, submitted_at, decided_at, note)
select distinct e.plan_id, t.org_id, 'approved', now(), now(), now(), 'Chuyển từ ghi danh cũ'
  from training_enrollments e
  join teachers t on t.id = e.teacher_id
  join training_plans p on p.id = e.plan_id
  join organizations o on o.id = t.org_id and o.type = 'school'
 where t.org_id <> p.org_id
on conflict do nothing;

notify pgrst, 'reload schema';
