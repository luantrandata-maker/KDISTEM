-- 118. Tập huấn: đơn vị xây dựng chương trình; trợ giảng; kết thúc kế hoạch; báo cáo thống kê.
--  • training_programs.builder: đơn vị xây dựng (không bắt buộc, chữ tự do hoặc chọn từ danh sách đơn vị). Phiên bản mới giữ nguyên.
--  • Trợ giảng: training_plan_items.assistant_ids / training_sessions.assistant_ids (chọn từ danh sách giảng viên của đơn vị),
--    cột assistant là tên hiển thị tự ghép, đổi tên giảng viên thì cập nhật theo.
--  • Kết thúc kế hoạch: training_plan_close / training_plan_reopen. Kết thúc = chốt điểm danh các buổi đã diễn ra, đóng tự đăng ký,
--    không ghi danh / đăng ký thêm, báo cho giáo viên có tên; trả về số liệu hoàn thành. Còn buổi chưa diễn ra thì chưa kết thúc được.
--  • training_report(p_year): số liệu theo kế hoạch × trường (dựa trên training_monitor) kèm đợt, số giờ, trạng thái kết thúc.
-- Cần chạy sau 117.

-- ===== 1. Đơn vị xây dựng =====
alter table training_programs add column if not exists builder text;
alter table training_programs drop constraint if exists training_programs_builder_check;
alter table training_programs add constraint training_programs_builder_check check (builder is null or length(builder) <= 200);

create or replace function public.training_programs_builder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.builder := nullif(btrim(regexp_replace(coalesce(new.builder, ''), '\s+', ' ', 'g')), '');
  -- Phiên bản mới / bản sao: giữ đơn vị xây dựng của bản nguồn
  if tg_op = 'INSERT' and new.builder is null and new.source_id is not null then
    select builder into new.builder from training_programs where id = new.source_id;
  end if;
  return new;
end $$;
revoke all on function public.training_programs_builder() from public, anon, authenticated;
drop trigger if exists training_programs_builder on training_programs;
create trigger training_programs_builder before insert or update on training_programs for each row execute function public.training_programs_builder();

-- ===== 2. Trợ giảng =====
alter table training_plan_items add column if not exists assistant_ids uuid[] not null default '{}';
alter table training_plan_items add column if not exists assistant text;
alter table training_sessions add column if not exists assistant_ids uuid[] not null default '{}';
alter table training_sessions add column if not exists assistant text;
alter table training_plan_items drop constraint if exists training_plan_items_assistants_check;
alter table training_plan_items add constraint training_plan_items_assistants_check check (cardinality(assistant_ids) <= 20);
alter table training_sessions drop constraint if exists training_sessions_assistants_check;
alter table training_sessions add constraint training_sessions_assistants_check check (cardinality(assistant_ids) <= 20);

create or replace function public.training_assistants_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if tg_op = 'UPDATE' and new.assistant_ids is not distinct from old.assistant_ids and new.assistant is not distinct from old.assistant then return new; end if;
  select org_id into v_org from training_plans where id = new.plan_id;
  if v_org is not null then
    new.assistant_ids := public.training_trainers_check(new.assistant_ids, v_org);
  end if;
  if exists (select 1 from unnest(new.assistant_ids) a where a = any(coalesce(new.trainer_ids, '{}'))) then
    raise exception 'Một người không vừa là giảng viên vừa là trợ giảng' using errcode = '22023';
  end if;
  new.assistant := case when cardinality(new.assistant_ids) > 0 then public.trainer_names(new.assistant_ids) end;
  return new;
end $$;
revoke all on function public.training_assistants_sync() from public, anon, authenticated;
drop trigger if exists training_plan_items_assistants on training_plan_items;
create trigger training_plan_items_assistants before insert or update on training_plan_items for each row execute function public.training_assistants_sync();
drop trigger if exists training_sessions_assistants on training_sessions;
create trigger training_sessions_assistants before insert or update on training_sessions for each row execute function public.training_assistants_sync();

create or replace function public.trainers_rename_assistant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.full_name, new.title) is distinct from (old.full_name, old.title) then
    perform set_config('app.training_trainer_sync', 'on', true);
    update training_plan_items set assistant = public.trainer_names(assistant_ids) where new.id = any(assistant_ids);
    update training_sessions set assistant = public.trainer_names(assistant_ids) where new.id = any(assistant_ids);
    perform set_config('app.training_trainer_sync', 'off', true);
  end if;
  return null;
end $$;
revoke all on function public.trainers_rename_assistant() from public, anon, authenticated;
drop trigger if exists trainers_rename_assistant on trainers;
create trigger trainers_rename_assistant after update on trainers for each row execute function public.trainers_rename_assistant();

-- ===== 3. Kết thúc kế hoạch =====
alter table training_plans add column if not exists closed_at timestamptz;
alter table training_plans add column if not exists closed_by uuid references profiles(id) on delete set null;
alter table training_plans add column if not exists close_note text;
alter table training_plans drop constraint if exists training_plans_close_note_check;
alter table training_plans add constraint training_plans_close_note_check check (close_note is null or length(close_note) <= 1000);

create or replace function public.training_plan_close(p_plan uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p training_plans; v_future int; v_absent int := 0; v_n int; s record; t record; r jsonb;
begin
  select * into p from training_plans where id = p_plan for update;
  if p.id is null then raise exception 'Không tìm thấy kế hoạch' using errcode = '22023'; end if;
  if not (public.is_platform_admin() or public.training_plan_can_manage(p_plan)) then
    raise exception 'Bạn không kết thúc được kế hoạch này' using errcode = '42501';
  end if;
  if p.pub_status <> 'published' then raise exception 'Chỉ kết thúc được kế hoạch đã phát hành' using errcode = '22023'; end if;
  if p.closed_at is not null then raise exception 'Kế hoạch đã kết thúc' using errcode = '22023'; end if;
  select count(*) into v_future from training_sessions where plan_id = p_plan and starts_at > now();
  if v_future > 0 then
    raise exception 'Còn % buổi chưa diễn ra: xoá hoặc dời lịch các buổi này trước khi kết thúc kế hoạch', v_future using errcode = '22023';
  end if;
  -- Chốt điểm danh các buổi chưa chốt (chưa điểm danh = vắng)
  for s in select id from training_sessions where plan_id = p_plan and closed_at is null loop
    update training_attendance set present = false, updated_by = auth.uid() where session_id = s.id and present is null;
    get diagnostics v_n = row_count; v_absent := v_absent + v_n;
    update training_sessions set closed_at = now() where id = s.id;
  end loop;
  update training_plans set closed_at = now(), closed_by = auth.uid(), close_note = left(nullif(btrim(p_note), ''), 1000), self_register = false
   where id = p_plan;
  -- Đăng ký chưa xử lý: kết thúc
  update training_registrations set status = 'rejected', reason = 'Kế hoạch đã kết thúc', decided_at = now(), decided_by = auth.uid()
   where plan_id = p_plan and status in ('pending', 'waitlist');
  -- Báo cho giáo viên có tên
  for t in select te.profile_id, te.org_id from training_enrollments e join teachers te on te.id = e.teacher_id
            where e.plan_id = p_plan and te.profile_id is not null loop
    perform public.notify_user(t.profile_id, t.org_id, 'training_closed',
      left('Đợt tập huấn đã kết thúc: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
      'Kết quả và chứng chỉ được cập nhật ở mục Chứng chỉ tập huấn.', 'Chứng chỉ tập huấn', 'teacher', p_plan);
  end loop;
  select jsonb_build_object(
    'enrolled', count(*),
    'passed', count(*) filter (where r.result = 'pass'),
    'failed', count(*) filter (where r.result = 'fail'),
    'pending', count(*) filter (where r.result is null or r.result = 'pending'),
    'absent_marked', v_absent)
    into r
    from training_enrollments e left join training_results r on r.plan_id = e.plan_id and r.teacher_id = e.teacher_id
   where e.plan_id = p_plan;
  return r;
end $$;

create or replace function public.training_plan_reopen(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or public.training_plan_can_manage(p_plan)) then
    raise exception 'Bạn không mở lại được kế hoạch này' using errcode = '42501';
  end if;
  update training_plans set closed_at = null, closed_by = null, close_note = null where id = p_plan and closed_at is not null;
  if not found then raise exception 'Kế hoạch chưa kết thúc' using errcode = '22023'; end if;
end $$;

-- Kế hoạch đã kết thúc: không ghi danh, không đăng ký thêm
create or replace function public.training_plan_closed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'training_registrations' then
    if new.status not in ('pending', 'waitlist') then return new; end if;
  end if;
  if exists (select 1 from training_plans where id = new.plan_id and closed_at is not null) then
    raise exception 'Kế hoạch đã kết thúc: không ghi danh hoặc đăng ký thêm' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.training_plan_closed_guard() from public, anon, authenticated;
drop trigger if exists training_enrollments_closed on training_enrollments;
create trigger training_enrollments_closed before insert on training_enrollments for each row execute function public.training_plan_closed_guard();
drop trigger if exists training_registrations_closed on training_registrations;
create trigger training_registrations_closed before insert or update of status on training_registrations for each row execute function public.training_plan_closed_guard();

-- ===== 4. Báo cáo thống kê =====
create or replace function public.training_report(p_year text default null)
returns table (plan_id uuid, plan_code text, plan_name text, plan_org text, year_name text, term text, starts_on date, ends_on date, hours int,
               closed boolean, org_id uuid, org_name text, quota int, enrolled int, att_pct numeric, passed int, failed int, certs int)
language sql stable security definer set search_path = public as $$
  select m.plan_id, m.plan_code, m.plan_name, m.plan_org, m.year_name, p.term, m.starts_on, m.ends_on, p.hours,
         p.closed_at is not null, m.org_id, m.org_name, m.quota, m.enrolled, m.att_pct, m.passed, m.failed, m.certs
    from public.training_monitor(p_year) m join training_plans p on p.id = m.plan_id
$$;

do $$ declare f text; begin
  foreach f in array array['training_plan_close(uuid, text)', 'training_plan_reopen(uuid)', 'training_report(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
