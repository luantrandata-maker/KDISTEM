-- 111. Phân hệ 1 — Số lượng tối đa của kế hoạch tập huấn, danh sách chờ, thông báo khi đầy
--  • training_plans.max_learners: số giáo viên tối đa của cả kế hoạch (cộng mọi trường), để trống = không giới hạn.
--    Sửa được cả khi kế hoạch đã phát hành. Chỉ tiêu từng trường (training_plan_orgs.quota, 084) vẫn giữ nguyên.
--  • Số đã dùng = giáo viên có tên (ghi danh) + đăng ký đang chờ xét. GV chỉ đăng ký được khi cả kế hoạch và trường còn chỗ.
--  • Hết chỗ: GV vẫn gửi được "đăng ký chờ" (training_registrations.status = 'waitlist'), xếp theo thời gian gửi.
--    Đơn vị lập kế hoạch hoặc trường nhận người trong danh sách chờ khi có chỗ (training_registration_review).
--    Trường gửi danh sách duyệt → đăng ký chờ của trường chuyển thành "không được nhận" (GV nhận thông báo).
--  • Ghi danh (trường chọn GV, đơn vị lập kế hoạch thêm) không vượt quá số lượng tối đa của kế hoạch (tính cả đăng ký chờ xét).
--  • Thông báo: đơn vị lập kế hoạch khi kế hoạch đạt 90% và 100%, khi có chỗ trống mà còn người chờ;
--    cán bộ trường khi trường đủ chỉ tiêu, khi có chỗ trống mà còn người chờ.
-- Viết lại training_register_check, training_register, training_registration_review, training_plan_submit (giữ phần sửa của 099).
-- Cần chạy sau 110.

-- ===== 1. Cột, trạng thái mới =====
alter table training_plans add column if not exists max_learners int;
do $$ begin
  alter table training_plans add constraint training_plans_max_learners_check check (max_learners is null or max_learners between 1 and 100000);
exception when duplicate_object then null; end $$;

alter table training_registrations drop constraint if exists training_registrations_status_check;
alter table training_registrations add constraint training_registrations_status_check
  check (status in ('pending', 'waitlist', 'accepted', 'rejected', 'cancelled'));
create index if not exists training_registrations_wait on training_registrations (plan_id, created_at) where status = 'waitlist';

-- Mức đã báo (để không báo lặp): org_id = 0000… là mức của cả kế hoạch
create table if not exists training_capacity_alerts (
  plan_id uuid not null references training_plans(id) on delete cascade,
  org_id uuid not null,
  level int not null default 0,
  primary key (plan_id, org_id)
);
alter table training_capacity_alerts enable row level security;
revoke all on training_capacity_alerts from anon, authenticated;

-- ===== 2. Đếm chỗ =====
-- Số đã dùng của kế hoạch (p_org null) hoặc của một trường: GV có tên + đăng ký chờ xét (trừ p_except)
create or replace function public.training_seats_used(p_plan uuid, p_org uuid default null, p_except uuid default null) returns int
language sql stable security definer set search_path = public as $$
  select ((select count(*) from training_enrollments e join teachers t on t.id = e.teacher_id
            where e.plan_id = p_plan and (p_org is null or t.org_id = p_org) and e.teacher_id is distinct from p_except)
        + (select count(*) from training_registrations r
            where r.plan_id = p_plan and r.status = 'pending' and (p_org is null or r.org_id = p_org) and r.teacher_id is distinct from p_except))::int
$$;
revoke all on function public.training_seats_used(uuid, uuid, uuid) from public, anon, authenticated;

-- ===== 3. Kiểm tra đăng ký: thêm "full" (hết chỗ, vẫn gửi được đăng ký chờ) =====
create or replace function public.training_register_check(p_plan uuid, p_units uuid[] default null, p_exempt uuid[] default '{}', p_teacher uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_t uuid := coalesce(p_teacher, public.my_teacher_id()); t teachers; p training_plans; o training_plan_orgs;
        e text[] := '{}'; w text[] := '{}'; f text[] := '{}'; v_units uuid[]; v_ex uuid[]; v_all uuid[]; v_used int; v_miss text;
begin
  if v_t is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  if p_teacher is not null and p_teacher is distinct from public.my_teacher_id()
     and not public.training_plan_can_manage(p_plan) and not public.training_teacher_in_my_tree(p_teacher) then
    raise exception 'Bạn không xem được đăng ký của giáo viên này' using errcode = '42501';
  end if;
  select * into t from teachers where id = v_t;
  select * into p from training_plans where id = p_plan;
  if p.id is null or p.pub_status <> 'published' or not p.self_register then
    return jsonb_build_object('errors', jsonb_build_array('Kế hoạch không mở cho giáo viên tự đăng ký'), 'warnings', '[]'::jsonb, 'full', '[]'::jsonb);
  end if;
  if p.register_until is not null and p.register_until < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    e := e || ('Đã hết hạn đăng ký (' || to_char(p.register_until, 'DD/MM/YYYY') || ')');
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = t.org_id;
  if o.plan_id is null then e := e || 'Kế hoạch chưa giao cho trường của bạn'::text;
  elsif o.status in ('submitted', 'approved') then e := e || 'Trường đã gửi danh sách giáo viên, không nhận thêm đăng ký'::text;
  end if;
  if exists (select 1 from training_enrollments where plan_id = p_plan and teacher_id = v_t) then
    e := e || 'Bạn đã có tên trong kế hoạch này'::text;
  end if;
  -- Nội dung
  v_all := array(select x.unit_id from public.training_plan_units(p_plan) x order by x.ord);
  if p_units is not null and exists (select 1 from unnest(p_units) x where not (x = any(v_all))) then
    e := e || 'Nội dung chọn không thuộc kế hoạch'::text;
  end if;
  v_units := case when p_units is null then null else array(select x from unnest(v_all) with ordinality a(x, k) where x = any(p_units) order by k) end;
  v_ex := array(select x from unnest(v_all) with ordinality a(x, k) where x = any(coalesce(p_exempt, '{}'))
                  and public.training_unit_in(v_units, null, x) order by k);
  if exists (select 1 from unnest(v_ex) x where x not in (select public.training_passed_units(p_plan, v_t))) then
    e := e || 'Chỉ đề nghị miễn nội dung đã đạt ở kế hoạch trước'::text;
  end if;
  if not exists (select 1 from unnest(v_all) x where public.training_unit_in(v_units, v_ex, x)) then
    e := e || 'Chọn ít nhất một nội dung để học'::text;
  end if;
  if v_units is not null and cardinality(v_units) = cardinality(v_all) then v_units := null; end if;
  -- Tiên quyết
  select string_agg('"' || m || '"', ', ') into v_miss from public.training_prereq_missing(p_plan, v_t) m;
  if v_miss is not null then e := e || ('Chưa đạt chương trình tiên quyết: ' || v_miss); end if;
  -- Số lượng tối đa của kế hoạch, chỉ tiêu của trường (trừ chính mình)
  if p.max_learners is not null and public.training_seats_used(p_plan, null, v_t) >= p.max_learners then
    f := f || ('Kế hoạch đã đủ số lượng ' || p.max_learners || ' giáo viên');
  end if;
  if o.quota is not null then
    v_used := public.training_seats_used(p_plan, t.org_id, v_t);
    if v_used >= o.quota then f := f || ('Trường đã đủ chỉ tiêu ' || o.quota || ' giáo viên'); end if;
  end if;
  -- Cảnh báo trùng lịch
  w := array(select public.training_register_conflicts(p_plan, v_t, v_units, v_ex));
  return jsonb_build_object('errors', to_jsonb(e), 'warnings', to_jsonb(w), 'full', to_jsonb(f), 'units', to_jsonb(v_units), 'exempt', to_jsonb(v_ex));
end $$;

-- ===== 4. GV gửi đăng ký; p_wait = true: hết chỗ thì vào danh sách chờ =====
drop function if exists public.training_register(uuid, uuid[], uuid[], text);
create or replace function public.training_register(p_plan uuid, p_units uuid[] default null, p_exempt uuid[] default '{}', p_note text default null,
                                                    p_wait boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare v_t uuid := public.my_teacher_id(); t teachers; c jsonb; p training_plans; r training_registrations; v_st text := 'pending';
begin
  if v_t is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  select * into t from teachers where id = v_t;
  select * into r from training_registrations where plan_id = p_plan and teacher_id = v_t for update;
  if r.status = 'accepted' then raise exception 'Trường đã nhận đăng ký của bạn' using errcode = '22023'; end if;
  c := public.training_register_check(p_plan, p_units, p_exempt);
  if jsonb_array_length(c -> 'errors') > 0 then
    raise exception '%', (select string_agg(x, '; ') from jsonb_array_elements_text(c -> 'errors') x) using errcode = '22023';
  end if;
  if jsonb_array_length(c -> 'full') > 0 then
    if not coalesce(p_wait, false) then
      raise exception '%', (select string_agg(x, '; ') from jsonb_array_elements_text(c -> 'full') x) || '. Bạn có thể gửi đăng ký chờ.' using errcode = '22023';
    end if;
    v_st := 'waitlist';
  end if;
  insert into training_registrations (plan_id, teacher_id, org_id, units, exempt_units, note, warnings, status, reason, created_at, decided_at, decided_by)
  values (p_plan, v_t, t.org_id,
          case when jsonb_typeof(c -> 'units') = 'array' then array(select jsonb_array_elements_text(c -> 'units')::uuid) end,
          array(select jsonb_array_elements_text(c -> 'exempt')::uuid),
          left(nullif(btrim(p_note), ''), 500), array(select jsonb_array_elements_text(c -> 'warnings')), v_st, null, now(), null, null)
  on conflict (plan_id, teacher_id) do update set units = excluded.units, exempt_units = excluded.exempt_units, note = excluded.note,
    warnings = excluded.warnings, status = excluded.status, reason = null,
    -- Sửa đăng ký chờ thì giữ thứ tự chờ
    created_at = case when training_registrations.status = 'waitlist' and excluded.status = 'waitlist' then training_registrations.created_at else now() end,
    decided_at = null, decided_by = null;
  if v_st = 'pending' and (r.plan_id is null or r.status <> 'pending') then
    select * into p from training_plans where id = p_plan;
    perform public.notify_staff(t.org_id, 'training', 'training_registration',
      left('Giáo viên đăng ký tập huấn: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
      left(t.full_name || ' đăng ký tham gia. Mở kế hoạch ở mục Kế hoạch tập huấn để nhận hoặc từ chối.', 1000),
      'Kế hoạch tập huấn', p_plan);
  end if;
  return v_st;
end $$;

create or replace function public.training_register_cancel(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update training_registrations set status = 'cancelled', decided_at = now()
   where plan_id = p_plan and teacher_id = public.my_teacher_id() and status in ('pending', 'waitlist');
  if not found then raise exception 'Không có đăng ký đang chờ để huỷ' using errcode = '22023'; end if;
end $$;

-- ===== 5. Nhận / từ chối: nhận được cả người trong danh sách chờ khi còn chỗ =====
create or replace function public.training_registration_review(p_plan uuid, p_teacher uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r training_registrations; o training_plan_orgs; v_n int; v_max int;
begin
  select * into r from training_registrations where plan_id = p_plan and teacher_id = p_teacher for update;
  if r.plan_id is null then raise exception 'Không tìm thấy đăng ký' using errcode = '22023'; end if;
  if not (public.is_platform_admin() or public.training_plan_can_manage(p_plan)
          or (r.org_id in (select public.my_org_tree()) and public.is_staff() and (public.has_perm('training', 'edit') or public.has_perm('training', 'create')))) then
    raise exception 'Bạn không xử lý được đăng ký này' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'waitlist') then raise exception 'Đăng ký đã được xử lý' using errcode = '22023'; end if;
  if not p_accept then
    if nullif(btrim(p_reason), '') is null then raise exception 'Nhập lý do từ chối' using errcode = '22023'; end if;
    update training_registrations set status = 'rejected', reason = left(btrim(p_reason), 500), decided_at = now(), decided_by = auth.uid()
     where plan_id = p_plan and teacher_id = p_teacher;
    return;
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = r.org_id;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if o.status in ('submitted', 'approved') and not public.training_plan_can_manage(p_plan) then
    raise exception 'Danh sách giáo viên đã gửi duyệt: chờ đơn vị lập kế hoạch trả lại để sửa' using errcode = '22023';
  end if;
  select count(*) into v_n from training_enrollments e join teachers t on t.id = e.teacher_id where e.plan_id = p_plan and t.org_id = r.org_id;
  if o.quota is not null and (v_n >= o.quota or (r.status = 'waitlist' and public.training_seats_used(p_plan, r.org_id, p_teacher) >= o.quota)) then
    raise exception 'Trường đã đủ chỉ tiêu % giáo viên', o.quota using errcode = '22023';
  end if;
  select max_learners into v_max from training_plans where id = p_plan;
  if v_max is not null and public.training_seats_used(p_plan, null, p_teacher) >= v_max then
    raise exception 'Kế hoạch đã đủ số lượng % giáo viên', v_max using errcode = '22023';
  end if;
  -- Đăng ký chờ → chờ xét để guard ghi danh chép nội dung đăng ký
  if r.status = 'waitlist' then update training_registrations set status = 'pending' where plan_id = p_plan and teacher_id = p_teacher; end if;
  insert into training_enrollments (org_id, plan_id, teacher_id) values (r.org_id, p_plan, p_teacher) on conflict do nothing;
  update training_registrations set status = 'accepted', reason = nullif(btrim(p_reason), ''), decided_at = now(), decided_by = auth.uid()
   where plan_id = p_plan and teacher_id = p_teacher;
end $$;

-- ===== 6. Ghi danh không vượt số lượng tối đa của kế hoạch =====
create or replace function public.training_enrollments_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max int; v_n int;
begin
  select max_learners into v_max from training_plans where id = new.plan_id;
  if v_max is null then return new; end if;
  perform 1 from training_plans where id = new.plan_id for update;   -- tránh hai người cùng lấy chỗ cuối
  v_n := public.training_seats_used(new.plan_id, null, new.teacher_id);   -- GV có tên + đăng ký chờ xét của người khác
  if v_n >= v_max then raise exception 'Kế hoạch đã đủ số lượng % giáo viên', v_max using errcode = '22023'; end if;
  return new;
end $$;
revoke all on function public.training_enrollments_capacity() from public, anon, authenticated;
drop trigger if exists training_enrollments_capacity on training_enrollments;
create trigger training_enrollments_capacity before insert on training_enrollments for each row execute function public.training_enrollments_capacity();

-- ===== 7. Trường gửi danh sách: đăng ký chờ của trường kết thúc =====
create or replace function public.training_plan_submit(p_plan uuid, p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare o training_plan_orgs; v_org uuid := coalesce(p_org, public.my_org_id()); v_n int;
begin
  if not public.is_platform_admin() and not (v_org in (select public.my_org_tree()) and public.is_staff() and (public.has_perm('training', 'edit') or public.has_perm('training', 'create'))) then
    raise exception 'Bạn không gửi được danh sách của trường này' using errcode = '42501';
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = v_org for update;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if o.status not in ('assigned', 'returned') then raise exception 'Danh sách đã gửi rồi' using errcode = '22023'; end if;
  select count(*) into v_n from training_registrations where plan_id = p_plan and org_id = v_org and status = 'pending';
  if v_n > 0 then raise exception 'Còn % đăng ký của giáo viên chưa xử lý: nhận hoặc từ chối trước khi gửi', v_n using errcode = '22023'; end if;
  select count(*) into v_n from training_enrollments e join teachers t on t.id = e.teacher_id where e.plan_id = p_plan and t.org_id = v_org;
  if v_n = 0 then raise exception 'Chưa chọn giáo viên nào' using errcode = '22023'; end if;
  if o.quota is not null and v_n > o.quota then
    raise exception 'Đã chọn % giáo viên, vượt chỉ tiêu % của trường', v_n, o.quota using errcode = '22023';
  end if;
  update training_plan_orgs set status = 'submitted', submitted_at = now() where plan_id = p_plan and org_id = v_org;
  update training_registrations set status = 'rejected', reason = 'Hết chỗ: trường đã gửi danh sách tham gia', decided_at = now(), decided_by = auth.uid()
   where plan_id = p_plan and org_id = v_org and status = 'waitlist';
end $$;

-- ===== 8. Thông báo khi đầy / có chỗ trống =====
-- Người nhận ở đơn vị lập kế hoạch: cán bộ có quyền sửa tập huấn, và Quản trị hệ thống (kế hoạch của KDI)
create or replace function public.training_notify_planners(p_org uuid, p_title text, p_body text, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select distinct m.user_id from memberships m join roles r on r.id = m.role_id
            where m.org_id = p_org and (public.user_has_perm(m.user_id, 'training', 'edit', p_org) or (r.key = 'platform_admin' and r.org_id is null)) loop
    perform public.notify_user(u, p_org, 'training_capacity', p_title, p_body, 'Kế hoạch tập huấn', 'school_admin', p_ref);
  end loop;
end $$;
revoke all on function public.training_notify_planners(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.training_capacity_alert(p_plan uuid, p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p training_plans; o training_plan_orgs; v_used int; v_lvl int; v_old int; v_wait int;
        v_nil constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  select * into p from training_plans where id = p_plan;
  if p.id is null then return; end if;
  -- Cả kế hoạch → đơn vị lập kế hoạch
  if p.max_learners is not null then
    v_used := public.training_seats_used(p_plan);
    v_lvl := case when v_used >= p.max_learners then 100 when v_used * 10 >= p.max_learners * 9 then 90 else 0 end;
    select level into v_old from training_capacity_alerts where plan_id = p_plan and org_id = v_nil;
    v_old := coalesce(v_old, 0);
    if v_lvl <> v_old then
      insert into training_capacity_alerts (plan_id, org_id, level) values (p_plan, v_nil, v_lvl)
      on conflict (plan_id, org_id) do update set level = excluded.level;
      if v_lvl > v_old then
        perform public.training_notify_planners(p.org_id,
          left(case when v_lvl = 100 then 'Kế hoạch tập huấn đã đủ số lượng: ' else 'Kế hoạch tập huấn sắp đủ số lượng: ' end || coalesce(p.plan_code || ' · ', '') || p.name, 200),
          'Đã có ' || v_used || '/' || p.max_learners || ' giáo viên (gồm đăng ký chờ xét). '
            || case when v_lvl = 100 then 'Giáo viên đăng ký thêm sẽ vào danh sách chờ.' else 'Còn ' || (p.max_learners - v_used) || ' chỗ.' end,
          p_plan);
      elsif v_old = 100 then
        select count(*) into v_wait from training_registrations where plan_id = p_plan and status = 'waitlist';
        if v_wait > 0 then
          perform public.training_notify_planners(p.org_id,
            left('Kế hoạch tập huấn có chỗ trống: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
            'Còn ' || (p.max_learners - v_used) || ' chỗ, ' || v_wait || ' giáo viên trong danh sách chờ. Mở kế hoạch để nhận theo thứ tự.',
            p_plan);
        end if;
      end if;
    end if;
  end if;
  -- Chỉ tiêu của trường → cán bộ trường
  if p_org is null then return; end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = p_org;
  if o.plan_id is null or o.quota is null then return; end if;
  v_used := public.training_seats_used(p_plan, p_org);
  v_lvl := case when v_used >= o.quota then 100 else 0 end;
  select level into v_old from training_capacity_alerts where plan_id = p_plan and org_id = p_org;
  v_old := coalesce(v_old, 0);
  if v_lvl = v_old then return; end if;
  insert into training_capacity_alerts (plan_id, org_id, level) values (p_plan, p_org, v_lvl)
  on conflict (plan_id, org_id) do update set level = excluded.level;
  if v_lvl > v_old then
    perform public.notify_staff(p_org, 'training', 'training_capacity',
      left('Trường đã đủ chỉ tiêu tập huấn: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
      'Trường đã có ' || v_used || '/' || o.quota || ' giáo viên (gồm đăng ký chờ xét). Giáo viên đăng ký thêm sẽ vào danh sách chờ.',
      'Kế hoạch tập huấn', p_plan);
  else
    select count(*) into v_wait from training_registrations where plan_id = p_plan and org_id = p_org and status = 'waitlist';
    if v_wait > 0 and o.status in ('assigned', 'returned') then
      perform public.notify_staff(p_org, 'training', 'training_capacity',
        left('Kế hoạch tập huấn có chỗ trống: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
        'Trường còn ' || (o.quota - v_used) || ' chỗ, ' || v_wait || ' giáo viên trong danh sách chờ. Mở kế hoạch để nhận theo thứ tự.',
        'Kế hoạch tập huấn', p_plan);
    end if;
  end if;
end $$;
revoke all on function public.training_capacity_alert(uuid, uuid) from public, anon, authenticated;

create or replace function public.training_capacity_watch() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_org uuid;
begin
  if tg_table_name = 'training_registrations' then
    if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
    v_org := r.org_id;
  else
    select org_id into v_org from teachers where id = r.teacher_id;
  end if;
  perform public.training_capacity_alert(r.plan_id, v_org);
  return null;
end $$;
revoke all on function public.training_capacity_watch() from public, anon, authenticated;
drop trigger if exists training_capacity_watch on training_enrollments;
create trigger training_capacity_watch after insert or delete on training_enrollments for each row execute function public.training_capacity_watch();
drop trigger if exists training_capacity_watch on training_registrations;
create trigger training_capacity_watch after insert or update of status on training_registrations for each row execute function public.training_capacity_watch();

-- Đổi số lượng tối đa → tính lại mức đã báo
create or replace function public.training_plans_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.max_learners is distinct from old.max_learners then perform public.training_capacity_alert(new.id, null); end if;
  return null;
end $$;
revoke all on function public.training_plans_capacity() from public, anon, authenticated;
drop trigger if exists training_plans_capacity on training_plans;
create trigger training_plans_capacity after update of max_learners on training_plans for each row execute function public.training_plans_capacity();

-- ===== 9. Kế hoạch GV đăng ký được: thêm số lượng tối đa, số đã dùng của kế hoạch, thứ tự chờ =====
drop function if exists public.training_open_plans();
create or replace function public.training_open_plans()
returns table (plan_id uuid, plan_code text, name text, org_name text, year_name text, starts_on date, ends_on date, mode text, provider text,
               register_until date, programs text, hours numeric, quota int, taken int, list_status text,
               reg_status text, reg_reason text, reg_units uuid[], reg_exempt uuid[], reg_warnings text[], reg_at timestamptz, enrolled boolean,
               max_learners int, plan_taken int, wait_pos int)
language sql stable security definer set search_path = public as $$
  with me as (select t.id, t.org_id from teachers t where t.id = public.my_teacher_id())
  select p.id, p.plan_code, p.name, og.name, p.year_name, p.starts_on, p.ends_on, p.mode, p.provider, p.register_until,
         (select string_agg(g.title, ' · ' order by i.seq) from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p.id),
         (select sum(x.hours) from public.training_plan_units(p.id) x),
         o.quota, public.training_seats_used(p.id, me.org_id),
         o.status, r.status, r.reason, r.units, r.exempt_units, r.warnings, r.created_at,
         exists (select 1 from training_enrollments en where en.plan_id = p.id and en.teacher_id = me.id),
         p.max_learners, public.training_seats_used(p.id),
         case when r.status = 'waitlist' then (select count(*)::int from training_registrations w
                                               where w.plan_id = p.id and w.status = 'waitlist' and w.created_at <= r.created_at) end
    from me
    join training_plan_orgs o on o.org_id = me.org_id
    join training_plans p on p.id = o.plan_id and p.pub_status = 'published'
    left join organizations og on og.id = p.org_id
    left join training_registrations r on r.plan_id = p.id and r.teacher_id = me.id
   where p.self_register or r.plan_id is not null
   order by (p.register_until is null or p.register_until >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) desc, p.starts_on nulls last, p.name
$$;

-- ===== 10. Quyền gọi hàm =====
do $$ declare f text; begin
  foreach f in array array['training_register_check(uuid, uuid[], uuid[], uuid)', 'training_open_plans()',
    'training_register(uuid, uuid[], uuid[], text, boolean)', 'training_register_cancel(uuid)',
    'training_registration_review(uuid, uuid, boolean, text)', 'training_plan_submit(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
