-- 033: Quản trị chung quản lý 5 phân hệ
--   1. Danh mục phân hệ bán (service_modules) đổi sang 5 phân hệ của menu: PH1 Đào tạo & đánh giá năng lực nhà giáo,
--      PH2 Chương trình & học liệu, PH3 Vật tư, thiết bị dạy & học, PH4 Vận hành giảng dạy & đánh giá người học,
--      PH5 Hệ thống quản lý vận hành (điều hành & báo cáo của Sở).
--      Gói cũ được chuyển sang khung mới mà KHÔNG đơn vị nào mất chức năng đang dùng:
--        stem_rooms → PH3 · timetable → PH4 + PH2 (vì gói cũ có phân phối chương trình) · packages, library → PH2 · training → PH1.
--      Phê duyệt nhiều bước thành phần lõi (xuyên suốt mọi phân hệ, theo file rà soát) — không còn khoá theo gói.
--      Thêm gói cho Sở: Sở – Điều hành (PH2–PH5), Sở – Toàn diện (PH1–PH5).
--   2. platform_module_usage(): mỗi phân hệ — số trường được bật, số trường đang dùng thật (28 ngày), số lượt dùng.
--      platform_module_usage_detail(ph): theo từng trường.
--   3. Vai trò & quyền mặc định: quản trị nền tảng sửa ma trận role_permissions trên giao diện (trước chỉ sửa bằng SQL), có nhật ký.
-- Cần chạy sau 032.

-- ===== 1. Danh mục phân hệ =====
insert into service_modules (key, name, description, perm_modules, sort) values
  ('ph1', 'PH1. Đào tạo & đánh giá năng lực nhà giáo', 'Kế hoạch, lịch, bài giảng, lớp học ảo, chứng chỉ tập huấn; giám sát tập huấn; đánh giá năng lực giáo viên', '{training}', 1),
  ('ph2', 'PH2. Chương trình & học liệu', 'Chương trình CT1–CT5, gói STEM, phân phối chương trình, kho học liệu dùng chung, soạn bài giảng & kho hoạt động', '{library,packages,curriculum}', 2),
  ('ph3', 'PH3. Vật tư, thiết bị dạy & học', 'Phòng STEM & lịch phòng, thiết bị, mượn – trả, bảo hành, kho, kiểm kê, vận chuyển', '{stem_rooms,equipment,warranty}', 3),
  ('ph4', 'PH4. Vận hành giảng dạy & đánh giá người học', 'Kế hoạch giáo dục, thời khoá biểu, đăng ký & phân công dạy STEM, buổi dạy & điểm danh, đánh giá người học', '{timetable,edu_plan,stem_registrations,stem_assign}', 4),
  ('ph5', 'PH5. Hệ thống quản lý vận hành', 'Dashboard, KPI & xếp hạng, báo cáo cấp trên, điều hành & chỉ tiêu của Sở', '{governance}', 5)
on conflict (key) do update set name = excluded.name, description = excluded.description, perm_modules = excluded.perm_modules, sort = excluded.sort;

-- Ghi lại bản cũ để tra cứu (chỉ lần đầu)
create table if not exists service_plans_legacy as select id, code, modules, now() as saved_at from service_plans where false;
insert into service_plans_legacy (id, code, modules, saved_at)
  select id, code, modules, now() from service_plans p
   where exists (select 1 from unnest(p.modules) m where m in ('stem_rooms','timetable','packages','library','training','approvals'))
     and not exists (select 1 from service_plans_legacy l where l.id = p.id);
alter table service_plans_legacy enable row level security;
drop policy if exists service_plans_legacy_read on service_plans_legacy;
create policy service_plans_legacy_read on service_plans_legacy for select to authenticated using ((select public.is_platform_admin()));

update service_plans set modules = array(
  select distinct x from unnest(modules) m, unnest(case m
      when 'stem_rooms' then '{ph3}'::text[] when 'timetable' then '{ph4,ph2}'::text[]
      when 'packages' then '{ph2}'::text[] when 'library' then '{ph2}'::text[] when 'training' then '{ph1}'::text[]
      when 'approvals' then '{}'::text[] else array[m] end) x order by 1)
 where exists (select 1 from unnest(modules) m where m in ('stem_rooms','timetable','packages','library','training','approvals'));

delete from service_modules where key in ('stem_rooms','timetable','packages','library','training','approvals');

update service_plans set description = 'PH3 Vật tư, thiết bị dạy & học — trường mới có phòng STEM' where code = 'CO-BAN';
update service_plans set description = 'PH2 + PH3 + PH4 — trường dạy STEM thường xuyên' where code = 'TIEU-CHUAN';
update service_plans set description = 'PH1–PH4 — trường tự tập huấn, đánh giá giáo viên' where code = 'TOAN-DIEN';
insert into service_plans (code, name, description, modules) values
  ('SO-DIEU-HANH', 'Sở – Điều hành', 'PH5 cho Sở + PH2–PH4 cho mọi trường trực thuộc (bật "Áp dụng cho đơn vị trực thuộc")', '{ph2,ph3,ph4,ph5}'),
  ('SO-TOAN-DIEN', 'Sở – Toàn diện', 'PH1–PH5 cho Sở và mọi trường trực thuộc', '{ph1,ph2,ph3,ph4,ph5}')
on conflict (code) do nothing;

-- ===== 2. Mức sử dụng theo phân hệ =====
-- Một trường "đang dùng" một phân hệ khi có lượt dùng trong 28 ngày:
--   PH1: giáo viên của trường được điểm danh có mặt ở buổi tập huấn · PH2: bài giảng/hoạt động được sửa, học liệu được dùng
--   PH3: phiếu mượn thiết bị, tiết đã dạy tại phòng STEM · PH4: tiết đã điểm danh · PH5: (Sở) xuất báo cáo, (trường) không tính
create or replace function public.school_module_events(p_days int default 28)
returns table (org_id uuid, ph1 int, ph2 int, ph3 int, ph4 int)
language sql stable security definer set search_path = public as $$
  with sc as (select id from organizations where type = 'school'),
  t1 as (select t.org_id, count(*)::int n from training_attendance a join training_sessions s on s.id = a.session_id
          join teachers t on t.id = a.teacher_id where a.present and s.starts_at >= now() - make_interval(days => p_days) group by t.org_id),
  t2 as (select org_id, sum(n)::int n from (
           select org_id, count(*) n from lesson_plans where updated_at >= now() - make_interval(days => p_days) group by org_id
           union all select org_id, count(*) from activities where updated_at >= now() - make_interval(days => p_days) group by org_id
           union all select org_id, count(*) from self_study_items where created_at >= now() - make_interval(days => p_days) group by org_id) x group by org_id),
  t3 as (select org_id, sum(n)::int n from (
           select org_id, count(*) n from borrow_requests where created_at >= now() - make_interval(days => p_days) group by org_id
           union all select org_id, count(*) from teaching_sessions where status = 'taught' and room_id is not null
             and session_date >= current_date - p_days group by org_id) x group by org_id),
  t4 as (select org_id, count(*)::int n from teaching_sessions where status = 'taught' and session_date >= current_date - p_days group by org_id)
  select sc.id, coalesce(t1.n, 0), coalesce(t2.n, 0), coalesce(t3.n, 0), coalesce(t4.n, 0)
  from sc left join t1 on t1.org_id = sc.id left join t2 on t2.org_id = sc.id left join t3 on t3.org_id = sc.id left join t4 on t4.org_id = sc.id
$$;
revoke all on function public.school_module_events(int) from public, authenticated;

create or replace function public.platform_module_usage()
returns table (key text, name text, description text, sort int, perm_modules text[],
               plans int, contracts_active int, schools_total int, schools_enabled int, schools_active int, events_28d int,
               depts_enabled int, depts_active int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query
  with ent as (select o.id, o.type, e.state, e.modules from organizations o cross join lateral public.org_entitlement(o.id) e
                where o.type in ('school','department')),
       ev as (select * from public.school_module_events(28)),
       rep as (select org_id, count(*)::int n from report_exports where created_at >= now() - interval '28 days' group by org_id)
  select m.key, m.name, m.description, m.sort, m.perm_modules,
    (select count(*) from service_plans p where m.key = any(p.modules) and p.active)::int,
    (select count(*) from contracts c join service_plans p on p.id = c.plan_id where m.key = any(p.modules) and c.status = 'active'
       and current_date between c.starts_on and coalesce(c.ends_on, current_date))::int,
    (select count(*) from ent where ent.type = 'school')::int,
    (select count(*) from ent where ent.type = 'school' and (ent.state = 'open' or (ent.state = 'active' and m.key = any(ent.modules))))::int,
    (select count(*) from ent join ev on ev.org_id = ent.id where ent.type = 'school'
       and (ent.state = 'open' or (ent.state = 'active' and m.key = any(ent.modules)))
       and case m.key when 'ph1' then ev.ph1 when 'ph2' then ev.ph2 when 'ph3' then ev.ph3 when 'ph4' then ev.ph4 else 0 end > 0)::int,
    coalesce((select sum(case m.key when 'ph1' then ev.ph1 when 'ph2' then ev.ph2 when 'ph3' then ev.ph3 when 'ph4' then ev.ph4 else 0 end) from ev), 0)::int
      + case when m.key = 'ph5' then coalesce((select sum(n) from rep), 0)::int else 0 end,
    (select count(*) from ent where ent.type = 'department' and (ent.state = 'open' or (ent.state = 'active' and m.key = any(ent.modules))))::int,
    case when m.key = 'ph5' then (select count(*) from rep join organizations o on o.id = rep.org_id where o.type = 'department')::int else null end
  from service_modules m order by m.sort;
end $$;

create or replace function public.platform_module_usage_detail(p_key text)
returns table (org_id uuid, name text, code text, parent_name text, province_name text, state text, plan_name text, enabled boolean, events int, last_activity timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query
  with ev as (select * from public.school_module_events(28))
  select o.id, o.name, o.code, par.name, (select name from organizations where id = public.org_ancestor_of_type(o.id, 'province')),
    e.state, e.plan_name, (e.state = 'open' or (e.state = 'active' and p_key = any(e.modules))),
    case when o.type = 'department' then (select count(*)::int from report_exports r where r.org_id = o.id and r.created_at >= now() - interval '28 days')
         else case p_key when 'ph1' then ev.ph1 when 'ph2' then ev.ph2 when 'ph3' then ev.ph3 when 'ph4' then ev.ph4 else 0 end end,
    (select max(r.created_at) from report_exports r where r.org_id = o.id)
  from organizations o
  left join organizations par on par.id = o.parent_id
  cross join lateral public.org_entitlement(o.id) e
  left join ev on ev.org_id = o.id
  where (p_key = 'ph5' and o.type = 'department') or (p_key <> 'ph5' and o.type = 'school')
  order by 8 desc, 9 desc, o.name;
end $$;

revoke all on function public.platform_module_usage(), public.platform_module_usage_detail(text) from public;
grant execute on function public.platform_module_usage(), public.platform_module_usage_detail(text) to authenticated;

-- ===== 3. Vai trò & quyền mặc định =====
-- Quản trị nền tảng sửa ma trận mặc định (dùng cho mọi trường chưa chỉnh riêng). Trường vẫn chỉnh bằng org_role_permissions.
drop policy if exists rp_platform_write on role_permissions;
create policy rp_platform_write on role_permissions for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin())
    and exists (select 1 from roles r where r.id = role_id and r.org_id is null));

create or replace function public.audit_role_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end; v_role text; a text;
begin
  select name into v_role from roles where id = (r->>'role_id')::uuid;
  a := concat_ws(', ', case when (r->>'can_view')::boolean then 'xem' end, case when (r->>'can_detail')::boolean then 'chi tiết' end,
                 case when (r->>'can_create')::boolean then 'tạo' end, case when (r->>'can_edit')::boolean then 'sửa' end,
                 case when (r->>'can_delete')::boolean then 'xoá' end);
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), public.platform_org_id(), 'role_permissions', (r->>'role_id') || '/' || (r->>'module'), lower(tg_op),
            'Quyền mặc định: ' || coalesce(v_role, '?') || ' · ' || (r->>'module') || ' → ' || case when tg_op = 'DELETE' or a = '' then 'không có quyền' else a end,
            case when tg_op = 'UPDATE' then jsonb_build_object('from', to_jsonb(old), 'to', to_jsonb(new)) else r end);
  return null;
end $$;
drop trigger if exists role_permissions_audit on role_permissions;
create trigger role_permissions_audit after insert or update or delete on role_permissions
  for each row when (current_setting('role', true) = 'authenticated') execute function public.audit_role_permissions();

-- Số trường đang chỉnh riêng quyền cho từng vai trò/chức năng (để KDI biết thay đổi mặc định ảnh hưởng ai)
create or replace function public.platform_permission_overrides()
returns table (role_id uuid, module text, orgs int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query select p.role_id, p.module, count(distinct p.org_id)::int from org_role_permissions p group by p.role_id, p.module;
end $$;
revoke all on function public.platform_permission_overrides() from public;
grant execute on function public.platform_permission_overrides() to authenticated;
