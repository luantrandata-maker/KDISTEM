-- 032: Cơ sở triển khai — sổ quản lý mọi trường đang triển khai (cổng Quản trị nền tảng)
--   • organizations.kdi_owner (người phụ trách KDI), go_live_on (ngày bắt đầu vận hành).
--     Chỉ quản trị nền tảng đổi được hai trường này và trạng thái khách hàng (Sở sửa thông tin trường vẫn như cũ).
--   • Giai đoạn: Tạm dừng / Kết thúc / Tiềm năng (theo trạng thái khách hàng của trường hoặc Sở) → Vận hành (đã nghiệm thu,
--     đến ngày vận hành, hoặc có tiết được điểm danh trong 14 ngày) → Đang triển khai (đã khởi động, đã kích hoạt hoặc ≥ 3 bước) → Khởi tạo.
--   • platform_school_registry(): mỗi trường một dòng — tỉnh/Sở, giai đoạn, tiến độ triển khai (14 bước như màn
--     Triển khai khách hàng), hợp đồng, người dùng, lần đăng nhập gần nhất, buổi dạy & điểm danh, phiếu hỗ trợ,
--     sức khoẻ (tốt / cần chú ý / nguy cơ) kèm lý do.
--   • platform_school_trend(): 8 tuần gần nhất của một trường; platform_update_school(); platform_import_schools();
--     platform_staff() (danh sách người phụ trách).
-- Cần chạy sau 031.

-- ===== 1. Cột mới =====
alter table organizations add column if not exists kdi_owner uuid references profiles(id) on delete set null,
  add column if not exists go_live_on date;
comment on column organizations.kdi_owner is 'Nhân viên KDI phụ trách triển khai/chăm sóc đơn vị này';
comment on column organizations.go_live_on is 'Ngày đơn vị bắt đầu vận hành chính thức';

create or replace function public.guard_org_kdi_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_platform_admin()
     and (new.kdi_owner is distinct from old.kdi_owner or new.go_live_on is distinct from old.go_live_on
          or new.customer_status is distinct from old.customer_status) then
    raise exception 'Chỉ KDI Education đổi người phụ trách, ngày vận hành, trạng thái khách hàng' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists organizations_kdi_fields on organizations;
create trigger organizations_kdi_fields before update on organizations for each row execute function public.guard_org_kdi_fields();

-- ===== 2. Nhân viên KDI (để chọn người phụ trách) =====
create or replace function public.platform_staff() returns table (id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query select distinct p.id, p.full_name, p.email from memberships m join profiles p on p.id = m.user_id
    join organizations o on o.id = m.org_id where o.is_platform order by p.full_name;
end $$;

-- ===== 3. Sổ cơ sở triển khai =====
-- Lần đăng nhập gần nhất của thành viên mỗi trường (bảng phiên của Supabase Auth; không có thì rỗng)
create or replace function public.school_last_login() returns table (org_id uuid, last_login timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if to_regclass('auth.sessions') is null then return; end if;
  return query execute $q$select m.org_id, max(coalesce(s.updated_at, s.created_at)) from memberships m
    join auth.sessions s on s.user_id = m.user_id join organizations o on o.id = m.org_id where o.type = 'school' group by m.org_id$q$;
end $$;
revoke all on function public.school_last_login() from public, authenticated;

create or replace function public.platform_school_registry()
returns table (
  org_id uuid, code text, name text, level text, ward text, address text,
  parent_id uuid, parent_name text, province_id uuid, province_name text,
  status text, activated boolean, customer_status text,
  contact_name text, contact_phone text, contact_email text,
  kdi_owner uuid, kdi_owner_name text, go_live_on date, created_at timestamptz,
  ent_state text, plan_name text, contract_code text, contract_ends_on date, contract_source text,
  users int, admins int, pending_invites int, last_login timestamptz, last_activity timestamptz,
  active_teachers_7d int, planned_4w int, taught_4w int, taught_14d int,
  rollout_done int, rollout_total int, kickoff_at timestamptz, accepted_at timestamptz,
  open_tickets int, urgent_tickets int,
  stage text, health text, reasons text[], stats jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_today date := public.vn_today();
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;

  return query
  with st as (select * from public.dept_school_stats()),
  sc as (
    select o.*, par.name as par_name,
      public.org_ancestor_of_type(o.id, 'province') as prov_id,
      coalesce(o.customer_status, par.customer_status, gp.customer_status) as eff_cs
    from organizations o left join organizations par on par.id = o.parent_id left join organizations gp on gp.id = par.parent_id
    where o.type = 'school'
  ),
  ent as (select sc.id, e.* from sc cross join lateral public.org_entitlement(sc.id) e),
  chk as (select c.org_id, count(*) filter (where c.step in ('kickoff','admin_training','handover','teacher_training','acceptance'))::int as manual,
                 max(c.done_at) filter (where c.step = 'kickoff') as kickoff_at, max(c.done_at) filter (where c.step = 'acceptance') as accepted_at
            from rollout_checks c group by c.org_id),
  mem as (select m.org_id, count(distinct m.user_id)::int as users,
                 count(distinct m.user_id) filter (where r.key in ('principal','it_admin') and r.org_id is null)::int as admins
            from memberships m join roles r on r.id = m.role_id group by m.org_id),
  inv as (select i.org_id, count(*)::int as n from invitations i where i.status = 'pending' group by i.org_id),
  ses as (
    select ts.org_id,
      count(*) filter (where ts.status <> 'cancelled' and ts.session_date between v_today - 27 and v_today
                         and (ts.session_date + p.starts_at) at time zone 'Asia/Ho_Chi_Minh' <= now())::int as planned,
      count(*) filter (where ts.status = 'taught' and ts.session_date between v_today - 27 and v_today)::int as taught,
      count(*) filter (where ts.status = 'taught' and ts.session_date between v_today - 13 and v_today)::int as taught14,
      count(distinct ts.teacher_id) filter (where ts.status = 'taught' and ts.marked_at >= now() - interval '7 days')::int as act7
    from teaching_sessions ts join period_configs p on p.id = ts.period_id
    where ts.session_date >= v_today - 27 group by ts.org_id),
  tk as (select t.org_id, count(*) filter (where t.status not in ('resolved','closed'))::int as open_n,
                count(*) filter (where t.status not in ('resolved','closed') and t.priority = 'urgent')::int as urgent_n
           from support_tickets t group by t.org_id),
  base as (
    select sc.*, coalesce(st.activated, false) as activated, st.total_periods, st.last_activity, ent.state as e_state, ent.plan_name as e_plan, ent.contract_code as e_code, ent.ends_on as e_ends,
      (select name from organizations where id = ent.source_org) as e_src,
      coalesce(mem.users, 0) as n_users, coalesce(mem.admins, 0) as n_admins, coalesce(inv.n, 0) as n_inv,
      lg.last_login as ll, coalesce(ses.planned, 0) as s_planned, coalesce(ses.taught, 0) as s_taught,
      coalesce(ses.taught14, 0) as s_taught14, coalesce(ses.act7, 0) as s_act7,
      coalesce(tk.open_n, 0) as t_open, coalesce(tk.urgent_n, 0) as t_urgent,
      chk.kickoff_at as k_at, chk.accepted_at as a_at,
      coalesce(chk.manual, 0)
        + (ent.state = 'active')::int + coalesce(st.activated, false)::int + coalesce(st.has_year, false)::int
        + (coalesce(st.teachers, 0) > 0)::int + (coalesce(st.students, 0) > 0)::int + (coalesce(st.rooms_active, 0) > 0)::int
        + (coalesce(st.units, 0) > 0)::int + (coalesce(st.total_periods, 0) > 0)::int
        + (st.last_activity >= now() - interval '7 days')::int as r_done,
      to_jsonb(st) as st_json
    from sc
    left join st on st.school_id = sc.id
    left join ent on ent.id = sc.id
    left join chk on chk.org_id = sc.id
    left join mem on mem.org_id = sc.id
    left join inv on inv.org_id = sc.id
    left join public.school_last_login() lg on lg.org_id = sc.id
    left join ses on ses.org_id = sc.id
    left join tk on tk.org_id = sc.id
  ),
  staged as (
    select b.*,
      case when b.status = 'suspended' or b.eff_cs = 'paused' then 'paused'
           when b.eff_cs = 'ended' then 'ended'
           when b.eff_cs in ('prospect','negotiating') and b.e_state is distinct from 'active' then 'prospect'
           when b.a_at is not null or (b.go_live_on is not null and b.go_live_on <= v_today) or b.s_taught14 > 0 then 'operating'
           when b.k_at is not null or b.activated or b.r_done >= 3 then 'rollout'
           else 'setup' end as stg,
      case when b.e_ends is null then null else b.e_ends - v_today end as days_left
    from base b
  ),
  why as (
    select s.*,
      array_remove(array[
        case when s.e_state = 'expired' then 'R:Hợp đồng đã hết hạn' end,
        case when s.e_state = 'active' and s.days_left between 0 and 30 then 'R:Hợp đồng còn ' || s.days_left || ' ngày' end,
        case when s.stg = 'operating' and coalesce(s.total_periods, 0) > 0 and s.s_taught14 = 0 then 'R:Không có tiết nào được điểm danh trong 14 ngày' end,
        case when s.t_urgent > 0 then 'R:Có ' || s.t_urgent || ' phiếu hỗ trợ khẩn chưa xử lý' end,
        case when s.e_state = 'active' and s.days_left between 31 and 60 then 'W:Hợp đồng còn ' || s.days_left || ' ngày' end,
        case when s.stg = 'operating' and s.s_planned >= 10 and s.s_taught * 2 < s.s_planned then 'W:Điểm danh dưới 50% số tiết (4 tuần)' end,
        case when s.stg = 'rollout' and s.k_at < now() - interval '60 days' then 'W:Triển khai quá 60 ngày chưa nghiệm thu' end,
        case when s.stg in ('rollout','operating') and s.n_admins = 0 then 'W:Chưa có quản trị trường' end,
        case when s.stg in ('rollout','operating') and s.n_users > 0 and (s.ll is null or s.ll < now() - interval '14 days')
             then 'W:Không ai đăng nhập trong 14 ngày' end
      ], null) as rs
    from staged s
  )
  select w.id, w.code, w.name, w.level, w.ward, w.address, w.parent_id, w.par_name, w.prov_id,
    (select name from organizations where id = w.prov_id),
    w.status, coalesce(w.activated, false), w.eff_cs, w.contact_name, w.contact_phone, w.contact_email,
    w.kdi_owner, (select full_name from profiles where id = w.kdi_owner), w.go_live_on, w.created_at,
    coalesce(w.e_state, 'open'), w.e_plan, w.e_code, w.e_ends, w.e_src,
    w.n_users, w.n_admins, w.n_inv, w.ll, w.last_activity,
    w.s_act7, w.s_planned, w.s_taught, w.s_taught14,
    w.r_done, 14, w.k_at, w.a_at, w.t_open, w.t_urgent,
    w.stg,
    case when w.stg in ('paused','ended','prospect') then 'na'
         when exists (select 1 from unnest(w.rs) x where x like 'R:%') then 'risk'
         when cardinality(w.rs) > 0 then 'watch' else 'good' end,
    array(select substr(x, 3) from unnest(w.rs) x order by x),
    w.st_json
  from why w
  order by w.name;
end $$;

-- ===== 4. Xu hướng 8 tuần của một trường =====
create or replace function public.platform_school_trend(p_org uuid)
returns table (week_start date, planned int, taught int, cancelled int, present int, absent int, active_teachers int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_mon date := date_trunc('week', public.vn_today())::date;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return query
  select w::date,
    count(ts.id) filter (where ts.status <> 'cancelled' and (ts.session_date + p.starts_at) at time zone 'Asia/Ho_Chi_Minh' <= now())::int,
    count(ts.id) filter (where ts.status = 'taught')::int,
    count(ts.id) filter (where ts.status = 'cancelled')::int,
    coalesce(sum(ts.present_count + ts.late_count), 0)::int, coalesce(sum(ts.absent_count), 0)::int,
    count(distinct ts.teacher_id) filter (where ts.status = 'taught')::int
  from generate_series(v_mon - 49, v_mon, interval '7 days') w
  left join teaching_sessions ts on ts.org_id = p_org and ts.session_date between w::date and w::date + 6
  left join period_configs p on p.id = ts.period_id
  group by w order by w;
end $$;

-- ===== 5. Cập nhật thông tin quản lý của một trường =====
-- p_patch: kdi_owner, go_live_on, customer_status, contact_name, contact_phone, contact_email, address, ward (khoá nào có thì đổi)
create or replace function public.platform_update_school(p_org uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = p_org and type = 'school') then raise exception 'Không tìm thấy trường' using errcode = '22023'; end if;
  if p_patch ? 'kdi_owner' and nullif(p_patch->>'kdi_owner', '') is not null and not exists (
       select 1 from memberships m join organizations o on o.id = m.org_id where o.is_platform and m.user_id = (p_patch->>'kdi_owner')::uuid) then
    raise exception 'Người phụ trách phải là nhân viên KDI Education' using errcode = '22023';
  end if;
  update organizations set
    kdi_owner = case when p_patch ? 'kdi_owner' then nullif(p_patch->>'kdi_owner', '')::uuid else kdi_owner end,
    go_live_on = case when p_patch ? 'go_live_on' then nullif(p_patch->>'go_live_on', '')::date else go_live_on end,
    customer_status = case when p_patch ? 'customer_status' then nullif(p_patch->>'customer_status', '') else customer_status end,
    contact_name = case when p_patch ? 'contact_name' then nullif(btrim(p_patch->>'contact_name'), '') else contact_name end,
    contact_phone = case when p_patch ? 'contact_phone' then nullif(btrim(p_patch->>'contact_phone'), '') else contact_phone end,
    contact_email = case when p_patch ? 'contact_email' then nullif(btrim(p_patch->>'contact_email'), '') else contact_email end,
    address = case when p_patch ? 'address' then nullif(btrim(p_patch->>'address'), '') else address end,
    ward = case when p_patch ? 'ward' then nullif(btrim(p_patch->>'ward'), '') else ward end
  where id = p_org;
end $$;

-- ===== 6. Nhập nhiều trường từ Excel =====
-- p_rows: [{line, code, name, level, ward, address, parent_code, contact_name, contact_phone, contact_email}]
-- Mỗi dòng lưu riêng: dòng lỗi bị bỏ qua, các dòng khác vẫn được tạo.
create or replace function public.platform_import_schools(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_parent uuid; v_level text; created int := 0; bad jsonb := '[]'::jsonb; v_msg text;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Tối đa 2000 dòng một lần' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      if nullif(btrim(r->>'code'), '') is null or nullif(btrim(r->>'name'), '') is null then raise exception 'Thiếu mã hoặc tên trường'; end if;
      if exists (select 1 from organizations where code = btrim(r->>'code')) then raise exception 'Mã % đã có', btrim(r->>'code'); end if;
      select id into v_parent from organizations where code = btrim(r->>'parent_code') and type in ('department','district','province');
      if v_parent is null then raise exception 'Không tìm thấy Sở/Phòng có mã %', coalesce(r->>'parent_code', '(trống)'); end if;
      v_level := case lower(public.act_norm(r->>'level'))
        when 'mamnon' then 'mamnon' when 'mầm non' then 'mamnon' when 'tieuhoc' then 'tieuhoc' when 'tiểu học' then 'tieuhoc' when 'th' then 'tieuhoc'
        when 'thcs' then 'thcs' when 'trung học cơ sở' then 'thcs' when 'thpt' then 'thpt' when 'trung học phổ thông' then 'thpt'
        when '' then null else 'x' end;
      if v_level = 'x' then raise exception 'Cấp học "%" không hợp lệ (Mầm non / Tiểu học / THCS / THPT)', r->>'level'; end if;
      insert into organizations (type, parent_id, code, name, level, ward, address, contact_name, contact_phone, contact_email)
        values ('school', v_parent, btrim(r->>'code'), btrim(r->>'name'), v_level, nullif(btrim(r->>'ward'), ''), nullif(btrim(r->>'address'), ''),
                nullif(btrim(r->>'contact_name'), ''), nullif(btrim(r->>'contact_phone'), ''), nullif(btrim(r->>'contact_email'), ''));
      created := created + 1;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      bad := bad || jsonb_build_object('line', r->'line', 'code', r->>'code', 'reason', v_msg);
    end;
  end loop;
  return jsonb_build_object('created', created, 'skipped', bad);
end $$;

revoke all on function public.platform_school_registry(), public.platform_school_trend(uuid), public.platform_update_school(uuid, jsonb),
  public.platform_import_schools(jsonb), public.platform_staff() from public;
grant execute on function public.platform_school_registry(), public.platform_school_trend(uuid), public.platform_update_school(uuid, jsonb),
  public.platform_import_schools(jsonb), public.platform_staff() to authenticated;
