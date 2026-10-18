-- 046: S5 — Nghiệm thu & doanh thu; Sao lưu & xuất dữ liệu.
--   1. contract_milestones: các đợt nghiệm thu / thanh toán của hợp đồng (024). Trạng thái
--      planned → accepted (nghiệm thu, có biên bản) → invoiced (xuất hoá đơn) → paid (đã thu); ngày tự điền.
--      KDI (quản trị nền tảng) ghi; khách hàng (quản trị đơn vị có hợp đồng) xem tiến độ như xem hợp đồng.
--      revenue_overview(): tổng hợp theo hợp đồng (giá trị, nghiệm thu, hoá đơn, đã thu, còn phải thu, quá hạn).
--   2. data_exports: nhật ký mỗi lần xuất / sao lưu dữ liệu của một đơn vị (ai, lúc nào, bảng nào, bao nhiêu dòng).
--      Dữ liệu được xuất ngay trên trình duyệt theo đúng quyền đọc (RLS) của người xuất; hàm log_data_export ghi nhật ký.
--      backup_overview(): dung lượng CSDL, số dòng ước tính các bảng lớn, lần xuất gần nhất — cho KDI.

-- ===== 1. Nghiệm thu & thanh toán =====
create table if not exists contract_milestones (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  seq int not null default 1,
  name text not null,
  due_on date,
  amount numeric(14,0) not null default 0 check (amount >= 0),
  status text not null default 'planned' check (status in ('planned', 'accepted', 'invoiced', 'paid', 'cancelled')),
  accepted_on date,
  acceptance_note text,            -- số / nội dung biên bản nghiệm thu
  invoice_no text,
  invoiced_on date,
  paid_on date,
  paid_amount numeric(14,0) check (paid_amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid()
);
create index if not exists contract_milestones_contract on contract_milestones (contract_id, seq);
create index if not exists contract_milestones_due on contract_milestones (due_on) where status not in ('paid', 'cancelled');

create or replace function public.guard_contract_milestone() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if new.status in ('accepted', 'invoiced', 'paid') and new.accepted_on is null then new.accepted_on := current_date; end if;
  if new.status in ('invoiced', 'paid') and new.invoiced_on is null and new.invoice_no is not null then new.invoiced_on := current_date; end if;
  if new.status = 'invoiced' and new.invoiced_on is null then new.invoiced_on := current_date; end if;
  if new.status = 'paid' then
    if new.paid_on is null then new.paid_on := current_date; end if;
    if new.paid_amount is null then new.paid_amount := new.amount; end if;
  end if;
  if new.status in ('planned', 'cancelled') then new.paid_on := null; new.paid_amount := null; end if;
  if new.status = 'planned' then new.accepted_on := null; new.invoiced_on := null; end if;
  return new;
end $$;
drop trigger if exists contract_milestones_guard on contract_milestones;
create trigger contract_milestones_guard before insert or update on contract_milestones for each row execute function public.guard_contract_milestone();

alter table contract_milestones enable row level security;
drop policy if exists contract_milestones_read on contract_milestones;
create policy contract_milestones_read on contract_milestones for select to authenticated
  using (exists (select 1 from contracts c where c.id = contract_id));          -- theo quyền xem hợp đồng (024)
drop policy if exists contract_milestones_platform on contract_milestones;
create policy contract_milestones_platform on contract_milestones for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
grant select, insert, update, delete on contract_milestones to authenticated;

-- Tổng hợp doanh thu theo hợp đồng (p_year: hợp đồng còn hiệu lực trong năm đó; null = tất cả)
create or replace function public.revenue_overview(p_year int default null)
returns table (contract_id uuid, code text, org_id uuid, org_name text, plan_name text, status text, starts_on date, ends_on date,
               value numeric, planned numeric, accepted numeric, invoiced numeric, paid numeric, outstanding numeric,
               milestones int, overdue int, next_due date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query
  select c.id, c.code, c.org_id, o.name, p.name, c.status, c.starts_on, c.ends_on, coalesce(c.value, 0),
         coalesce(sum(m.amount) filter (where m.status <> 'cancelled'), 0),
         coalesce(sum(m.amount) filter (where m.status in ('accepted', 'invoiced', 'paid')), 0),
         coalesce(sum(m.amount) filter (where m.status in ('invoiced', 'paid')), 0),
         coalesce(sum(m.paid_amount) filter (where m.status = 'paid'), 0),
         greatest(coalesce(c.value, 0) - coalesce(sum(m.paid_amount) filter (where m.status = 'paid'), 0), 0),
         count(m.id) filter (where m.status <> 'cancelled')::int,
         count(m.id) filter (where m.status not in ('paid', 'cancelled') and m.due_on < current_date)::int,
         min(m.due_on) filter (where m.status not in ('paid', 'cancelled') and m.due_on >= current_date)
    from contracts c join organizations o on o.id = c.org_id join service_plans p on p.id = c.plan_id
    left join contract_milestones m on m.contract_id = c.id
   where p_year is null or (c.starts_on <= make_date(p_year, 12, 31) and (c.ends_on is null or c.ends_on >= make_date(p_year, 1, 1)))
   group by c.id, o.name, p.name
   order by c.starts_on desc, c.code;
end $$;
revoke all on function public.revenue_overview(int) from public, anon;
grant execute on function public.revenue_overview(int) to authenticated;

-- ===== 2. Nhật ký xuất / sao lưu dữ liệu =====
create table if not exists data_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,     -- đơn vị được xuất dữ liệu
  user_id uuid references profiles(id) on delete set null default auth.uid(),
  format text not null check (format in ('xlsx', 'json')),
  tables text[] not null default '{}',
  row_count int not null default 0 check (row_count >= 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists data_exports_org on data_exports (org_id, created_at desc);
alter table data_exports enable row level security;
drop policy if exists data_exports_read on data_exports;
create policy data_exports_read on data_exports for select to authenticated
  using ((select public.is_platform_admin()) or user_id = auth.uid()
         or (public.can_access_org(org_id) and public.is_staff()
             and (public.is_admin() or (select type from organizations where id = public.my_org_id()) <> 'school')));
grant select on data_exports to authenticated;

-- Ghi nhật ký: người xuất phải là quản trị đơn vị (trong cây) hoặc quản trị nền tảng
create or replace function public.log_data_export(p_org uuid, p_format text, p_tables text[], p_rows int, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not (public.is_platform_admin() or (public.can_access_org(p_org) and public.is_staff() and public.is_admin())
          or (public.my_org_id() = p_org and (select type from organizations where id = p_org) <> 'school' and public.is_staff())) then
    raise exception 'Không có quyền xuất dữ liệu đơn vị này' using errcode = '42501';
  end if;
  insert into data_exports (org_id, format, tables, row_count, note)
    values (p_org, p_format, coalesce(p_tables, '{}'), greatest(coalesce(p_rows, 0), 0), nullif(btrim(p_note), '')) returning id into v;
  return v;
end $$;
revoke all on function public.log_data_export(uuid, text, text[], int, text) from public, anon;
grant execute on function public.log_data_export(uuid, text, text[], int, text) to authenticated;

-- Tình trạng dữ liệu cho KDI: dung lượng, các bảng lớn nhất (ước tính), lần xuất gần nhất
create or replace function public.backup_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(t order by t.bytes desc), '[]'::jsonb) from (
        select c.relname as name, greatest(c.reltuples, 0)::bigint as rows, pg_total_relation_size(c.oid) as bytes
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' order by pg_total_relation_size(c.oid) desc limit 15) t),
    'exports_30d', (select count(*) from data_exports where created_at > now() - interval '30 days'),
    'orgs_exported_90d', (select count(distinct org_id) from data_exports where created_at > now() - interval '90 days'),
    'last_export', (select max(created_at) from data_exports)
  );
end $$;
revoke all on function public.backup_overview() from public, anon;
grant execute on function public.backup_overview() to authenticated;

notify pgrst, 'reload schema';
