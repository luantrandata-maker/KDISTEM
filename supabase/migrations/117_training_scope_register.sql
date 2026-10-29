-- 117. Tập huấn: phạm vi áp dụng của chương trình tập huấn; đăng ký của giáo viên (mời đăng ký, tuỳ chọn cần duyệt).
--  • Chương trình tập huấn có phạm vi áp dụng như chương trình giáo dục:
--      scope = 'all'      → mọi đơn vị (như trước),
--      scope = 'selected' → chỉ các đơn vị được chọn (training_program_targets) và đơn vị trực thuộc của chúng.
--    Thêm thời gian hiệu lực (effective_from / effective_to). Sửa được cả khi đã phát hành. Phiên bản mới chép phạm vi.
--    Đơn vị ngoài phạm vi không thấy chương trình (trừ khi đã dùng trong kế hoạch của mình), không chọn được khi lập kế hoạch;
--    kế hoạch không gán được cho trường ngoài phạm vi. Ngoài thời gian hiệu lực thì không chọn được cho kế hoạch mới.
--  • Kế hoạch tập huấn: register_approval (mặc định có) — tắt thì giáo viên đăng ký là có tên ngay, không chờ duyệt.
--  • Mời đăng ký: đơn vị lập kế hoạch (mọi trường được gán) hoặc trường (giáo viên của trường) gửi thông báo cho
--    giáo viên chưa đăng ký. training_plan_orgs.invited_at ghi lần gửi gần nhất.
--  • Thông báo kết quả xét đăng ký cho giáo viên: được duyệt / không được duyệt (kèm lý do).
-- Cần chạy sau 113.

-- ===== 1. Phạm vi áp dụng của chương trình tập huấn =====
alter table training_programs add column if not exists scope text not null default 'all';
alter table training_programs add column if not exists effective_from date;
alter table training_programs add column if not exists effective_to date;
alter table training_programs drop constraint if exists training_programs_scope_check;
alter table training_programs add constraint training_programs_scope_check check (scope in ('all', 'selected'));
alter table training_programs drop constraint if exists training_programs_effective_check;
alter table training_programs add constraint training_programs_effective_check check (effective_to is null or effective_from is null or effective_to >= effective_from);

create table if not exists training_program_targets (
  program_id uuid not null references training_programs(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (program_id, org_id)
);
create index if not exists training_program_targets_org on training_program_targets (org_id);

-- Chương trình áp dụng cho đơn vị: phạm vi mọi đơn vị, hoặc đơn vị nằm trong cây của một đơn vị được chọn
create or replace function public.training_program_applies(p_program uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select g.scope = 'all' or exists (select 1 from training_program_targets t
                                                     where t.program_id = g.id and public.org_in_tree(p_org, t.org_id))
                     from training_programs g where g.id = p_program), false)
$$;

-- Đơn vị dùng được chương trình khi lập kế hoạch: đơn vị soạn / KDI, trong phạm vi, hoặc là cấp trên của một đơn vị được chọn
create or replace function public.training_program_usable_by(p_program uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org = public.platform_org_id()
      or exists (select 1 from training_programs g where g.id = p_program and g.org_id = p_org)
      or public.training_program_applies(p_program, p_org)
      or exists (select 1 from training_program_targets t where t.program_id = p_program and public.org_in_tree(t.org_id, p_org))
$$;

-- Người dùng hiện tại thấy chương trình đã phát hành không: trong phạm vi (đơn vị mình, cấp trên, cấp dưới),
-- hoặc chương trình đã dùng trong kế hoạch của đơn vị mình / kế hoạch giao cho trường mình
create or replace function public.training_program_visible(p_program uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_programs g where g.id = p_program and g.scope = 'all')
      or exists (select 1 from training_program_targets t where t.program_id = p_program
                  and (t.org_id in (select public.my_scope_orgs()) or t.org_id in (select public.my_org_tree())))
      or exists (select 1 from training_plan_items i join training_plans pl on pl.id = i.plan_id
                  where i.program_id = p_program
                    and (pl.org_id in (select public.my_org_tree())
                         or exists (select 1 from training_plan_orgs o where o.plan_id = pl.id and o.org_id in (select public.my_org_tree()))))
$$;
revoke all on function public.training_program_applies(uuid, uuid), public.training_program_usable_by(uuid, uuid),
  public.training_program_visible(uuid) from public, anon;
grant execute on function public.training_program_applies(uuid, uuid), public.training_program_usable_by(uuid, uuid),
  public.training_program_visible(uuid) to authenticated;

drop policy if exists training_programs_read on training_programs;
create policy training_programs_read on training_programs for select to authenticated
  using (org_id = public.my_org_id() or public.is_platform_admin()
         or (status in ('published', 'superseded') and public.training_program_visible(id)));

alter table training_program_targets enable row level security;
drop policy if exists training_program_targets_read on training_program_targets;
create policy training_program_targets_read on training_program_targets for select to authenticated
  using (exists (select 1 from training_programs g where g.id = program_id));
drop policy if exists training_program_targets_write on training_program_targets;
create policy training_program_targets_write on training_program_targets for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, delete on training_program_targets to authenticated;

create or replace function public.training_program_targets_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from training_programs g where g.id = new.program_id and g.org_id = new.org_id) then
    raise exception 'Đơn vị soạn chương trình luôn dùng được chương trình, không cần chọn' using errcode = '22023';
  end if;
  if (select count(*) from training_program_targets where program_id = new.program_id) >= 500 then
    raise exception 'Tối đa 500 đơn vị áp dụng cho một chương trình' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.training_program_targets_guard() from public, anon, authenticated;
drop trigger if exists training_program_targets_guard on training_program_targets;
create trigger training_program_targets_guard before insert on training_program_targets for each row execute function public.training_program_targets_guard();

-- Phiên bản mới / bản sao chép phạm vi và thời gian hiệu lực của bản nguồn
create or replace function public.training_programs_scope_copy() returns trigger
language plpgsql security definer set search_path = public as $$
declare s training_programs;
begin
  if new.source_id is null then return new; end if;
  select * into s from training_programs where id = new.source_id;
  if s.id is null then return new; end if;
  if tg_when = 'BEFORE' then
    new.scope := s.scope; new.effective_from := s.effective_from; new.effective_to := s.effective_to;
    return new;
  end if;
  insert into training_program_targets (program_id, org_id, created_by)
  select new.id, t.org_id, t.created_by from training_program_targets t where t.program_id = s.id
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.training_programs_scope_copy() from public, anon, authenticated;
drop trigger if exists training_programs_scope_copy on training_programs;
create trigger training_programs_scope_copy before insert on training_programs for each row execute function public.training_programs_scope_copy();
drop trigger if exists training_programs_scope_copy_after on training_programs;
create trigger training_programs_scope_copy_after after insert on training_programs for each row execute function public.training_programs_scope_copy();

-- Kế hoạch chọn chương trình: phải trong phạm vi của đơn vị lập kế hoạch, đang hiệu lực,
-- và mọi trường đã gán kế hoạch phải nằm trong phạm vi
create or replace function public.training_plan_items_scope() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; g training_programs; v_bad text; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if tg_op = 'UPDATE' and new.program_id = old.program_id then return new; end if;
  select org_id into v_org from training_plans where id = new.plan_id;
  select * into g from training_programs where id = new.program_id;
  if g.id is null or v_org is null then return new; end if;
  if not public.training_program_usable_by(g.id, v_org) then
    raise exception 'Chương trình "%" không thuộc phạm vi áp dụng của đơn vị lập kế hoạch', g.title using errcode = '22023';
  end if;
  if g.effective_from is not null and g.effective_from > v_today then
    raise exception 'Chương trình "%" có hiệu lực từ %', g.title, to_char(g.effective_from, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if g.effective_to is not null and g.effective_to < v_today then
    raise exception 'Chương trình "%" đã hết hiệu lực (%)', g.title, to_char(g.effective_to, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select string_agg(og.name, ', ' order by og.name) into v_bad
    from training_plan_orgs o join organizations og on og.id = o.org_id
   where o.plan_id = new.plan_id and not public.training_program_applies(g.id, o.org_id);
  if v_bad is not null then
    raise exception 'Trường ngoài phạm vi áp dụng của chương trình "%": %', g.title, v_bad using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.training_plan_items_scope() from public, anon, authenticated;
drop trigger if exists training_plan_items_scope on training_plan_items;
create trigger training_plan_items_scope before insert or update of program_id on training_plan_items
  for each row execute function public.training_plan_items_scope();

-- Gán trường: trường phải trong phạm vi áp dụng của mọi chương trình trong kế hoạch
create or replace function public.training_plan_orgs_scope() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bad text; v_name text;
begin
  select string_agg('"' || g.title || '"', ', ' order by g.title) into v_bad
    from training_plan_items i join training_programs g on g.id = i.program_id
   where i.plan_id = new.plan_id and not public.training_program_applies(g.id, new.org_id);
  if v_bad is not null then
    select name into v_name from organizations where id = new.org_id;
    raise exception '% không thuộc phạm vi áp dụng của chương trình %', coalesce(v_name, 'Trường'), v_bad using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.training_plan_orgs_scope() from public, anon, authenticated;
drop trigger if exists training_plan_orgs_scope on training_plan_orgs;
create trigger training_plan_orgs_scope before insert on training_plan_orgs for each row execute function public.training_plan_orgs_scope();

-- Trường nào (trong danh sách) nằm ngoài phạm vi của kế hoạch: để màn gán trường làm mờ sẵn
create or replace function public.training_plan_out_of_scope(p_plan uuid, p_orgs uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select o from unnest(coalesce(p_orgs, '{}')) o
   where public.training_plan_can_manage(p_plan)
     and exists (select 1 from training_plan_items i where i.plan_id = p_plan and not public.training_program_applies(i.program_id, o))
$$;
revoke all on function public.training_plan_out_of_scope(uuid, uuid[]) from public, anon;
grant execute on function public.training_plan_out_of_scope(uuid, uuid[]) to authenticated;

-- ===== 2. Kế hoạch: tuỳ chọn cần duyệt khi giáo viên đăng ký; lần mời đăng ký gần nhất =====
alter table training_plans add column if not exists register_approval boolean not null default true;
alter table training_plan_orgs add column if not exists invited_at timestamptz;

-- GV gửi đăng ký. Kế hoạch không cần duyệt: còn chỗ thì có tên ngay (trả về 'accepted').
create or replace function public.training_register(p_plan uuid, p_units uuid[] default null, p_exempt uuid[] default '{}', p_note text default null,
                                                    p_wait boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare v_t uuid := public.my_teacher_id(); t teachers; c jsonb; p training_plans; r training_registrations; v_st text := 'pending';
        u uuid;
begin
  if v_t is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  select * into t from teachers where id = v_t;
  select * into p from training_plans where id = p_plan;
  select * into r from training_registrations where plan_id = p_plan and teacher_id = v_t for update;
  if r.status = 'accepted' then raise exception 'Đăng ký của bạn đã được duyệt' using errcode = '22023'; end if;
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
    created_at = case when training_registrations.status = 'waitlist' and excluded.status = 'waitlist' then training_registrations.created_at else now() end,
    decided_at = null, decided_by = null;
  if v_st = 'pending' and not p.register_approval then
    -- Không cần duyệt: ghi danh luôn (guard ghi danh chép nội dung đăng ký và chuyển đăng ký sang "đã nhận")
    insert into training_enrollments (org_id, plan_id, teacher_id) values (t.org_id, p_plan, v_t) on conflict do nothing;
    return 'accepted';
  end if;
  if v_st = 'pending' and (r.plan_id is null or r.status <> 'pending') then
    perform public.notify_staff(t.org_id, 'training', 'training_registration',
      left('Giáo viên đăng ký tập huấn: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
      left(t.full_name || ' đăng ký tham gia. Mở kế hoạch ở mục Kế hoạch tập huấn để duyệt hoặc từ chối.', 1000),
      'Kế hoạch tập huấn', p_plan);
    -- Kế hoạch của cấp trên: đơn vị tổ chức cũng duyệt được → báo cho cả đơn vị lập kế hoạch
    -- (gộp vào một thông báo theo kế hoạch, đếm số lượt)
    if p.org_id <> t.org_id then
      for u in select distinct m.user_id from memberships m join roles ro on ro.id = m.role_id
                where m.org_id = p.org_id and (public.user_has_perm(m.user_id, 'training', 'edit', p.org_id) or (ro.key = 'platform_admin' and ro.org_id is null)) loop
        perform public.notify_user(u, p.org_id, 'training_registration',
          left('Giáo viên đăng ký tập huấn chờ duyệt: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
          left('Mới nhất: ' || t.full_name || ' (' || coalesce((select name from organizations where id = t.org_id), '') || '). Mở kế hoạch để duyệt hoặc từ chối.', 1000),
          'Kế hoạch tập huấn', 'school_admin', p_plan, true);
      end loop;
    end if;
  end if;
  return v_st;
end $$;

-- Thông báo cho GV khi đăng ký được duyệt / không được duyệt (người duyệt là trường hoặc đơn vị tổ chức)
create or replace function public.notify_training_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare t teachers; p training_plans;
begin
  if new.status = old.status or new.status not in ('accepted', 'rejected') then return null; end if;
  select * into t from teachers where id = new.teacher_id;
  select * into p from training_plans where id = new.plan_id;
  if t.profile_id is null then return null; end if;
  perform public.notify_user(t.profile_id, t.org_id, 'training_registration',
    left(case when new.status = 'accepted' then 'Đăng ký tập huấn đã được duyệt: ' else 'Đăng ký tập huấn không được duyệt: ' end || p.name, 200),
    left(case when new.status = 'accepted' then 'Bạn đã có tên trong danh sách tham gia. Xem lịch ở mục Lịch tập huấn.'
              else 'Lý do: ' || coalesce(new.reason, '—') end, 1000),
    'Đăng ký tập huấn', 'teacher', new.plan_id);
  return null;
end $$;
revoke all on function public.notify_training_registration() from public, anon, authenticated;

-- Mời giáo viên đăng ký: gửi thông báo cho GV (đang làm việc, có tài khoản) chưa đăng ký / chưa có tên.
-- Đơn vị lập kế hoạch: mọi trường được gán (hoặc p_org); trường: giáo viên của trường mình. Trả về số GV được mời.
create or replace function public.training_register_invite(p_plan uuid, p_org uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare p training_plans; v_mgr boolean; v_n int := 0; x record; v_orgs uuid[]; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  select * into p from training_plans where id = p_plan;
  if p.id is null then raise exception 'Không tìm thấy kế hoạch' using errcode = '22023'; end if;
  v_mgr := public.is_platform_admin() or public.training_plan_can_manage(p_plan);
  if not v_mgr and not (public.is_staff() and (public.has_perm('training', 'edit') or public.has_perm('training', 'create'))) then
    raise exception 'Bạn không gửi được lời mời cho kế hoạch này' using errcode = '42501';
  end if;
  if p.pub_status <> 'published' or not p.self_register then
    raise exception 'Kế hoạch chưa mở cho giáo viên tự đăng ký' using errcode = '22023';
  end if;
  if p.register_until is not null and p.register_until < v_today then
    raise exception 'Đã hết hạn đăng ký (%)', to_char(p.register_until, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_orgs := array(select o.org_id from training_plan_orgs o
                   where o.plan_id = p_plan and o.status in ('assigned', 'returned')
                     and (p_org is null or o.org_id = p_org)
                     and (v_mgr or o.org_id in (select public.my_org_tree())));
  if cardinality(v_orgs) = 0 then
    raise exception 'Không có trường nào đang nhận đăng ký để mời' using errcode = '22023';
  end if;
  for x in select t.profile_id, t.org_id from teachers t
            where t.org_id = any(v_orgs) and t.profile_id is not null and coalesce(t.status, 'active') = 'active'
              and not exists (select 1 from training_enrollments e where e.plan_id = p_plan and e.teacher_id = t.id)
              and not exists (select 1 from training_registrations r where r.plan_id = p_plan and r.teacher_id = t.id
                                and r.status in ('pending', 'waitlist', 'accepted')) loop
    perform public.notify_user(x.profile_id, x.org_id, 'training_invite',
      left('Mời đăng ký tập huấn: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
      left(concat_ws(' ', case when p.register_until is not null then 'Hạn đăng ký ' || to_char(p.register_until, 'DD/MM/YYYY') || '.' end,
        'Mở mục Đăng ký tập huấn để chọn nội dung và gửi đăng ký.',
        case when p.register_approval then 'Đăng ký cần được duyệt.' else 'Đăng ký xong là có tên tham gia.' end), 1000),
      'Đăng ký tập huấn', 'teacher', p_plan, true);
    v_n := v_n + 1;
  end loop;
  update training_plan_orgs set invited_at = now() where plan_id = p_plan and org_id = any(v_orgs);
  return v_n;
end $$;

-- Kế hoạch GV đăng ký được: thêm "cần duyệt" (giữ cột cũ)
drop function if exists public.training_open_plans();
create or replace function public.training_open_plans()
returns table (plan_id uuid, plan_code text, name text, org_name text, year_name text, starts_on date, ends_on date, mode text, provider text,
               register_until date, programs text, hours numeric, quota int, taken int, list_status text,
               reg_status text, reg_reason text, reg_units uuid[], reg_exempt uuid[], reg_warnings text[], reg_at timestamptz, enrolled boolean,
               max_learners int, plan_taken int, wait_pos int, register_approval boolean)
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
                                               where w.plan_id = p.id and w.status = 'waitlist' and w.created_at <= r.created_at) end,
         p.register_approval
    from me
    join training_plan_orgs o on o.org_id = me.org_id
    join training_plans p on p.id = o.plan_id and p.pub_status = 'published'
    left join organizations og on og.id = p.org_id
    left join training_registrations r on r.plan_id = p.id and r.teacher_id = me.id
   where p.self_register or r.plan_id is not null
   order by (p.register_until is null or p.register_until >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) desc, p.starts_on nulls last, p.name
$$;

do $$ declare f text; begin
  foreach f in array array['training_open_plans()', 'training_register(uuid, uuid[], uuid[], text, boolean)', 'training_register_invite(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
