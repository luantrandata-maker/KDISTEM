-- 085. Phân hệ 1 — Lịch tập huấn & điểm danh (đợt 3)
--  • training_sessions thêm: nội dung tập huấn của buổi (unit_id), giảng viên, ghi chú, thời điểm chốt điểm danh (closed_at).
--    Mã điểm danh 6 số để ở bảng riêng training_session_codes, chỉ đơn vị tổ chức đọc được (GV không xem trước được mã). Buổi chỉ xếp cho kế hoạch đã phát hành; nội dung phải thuộc chương trình của kế hoạch.
--  • Danh sách điểm danh tự tạo theo giáo viên ghi danh: thêm buổi → thêm dòng cho GV đã ghi danh;
--    ghi danh thêm / bỏ GV → thêm / bỏ dòng ở các buổi chưa diễn ra.
--  • training_attendance thêm: giờ điểm danh, cách điểm danh (tự điểm danh / nhập mã / quản lý ghi), xin vắng (lý do, trạng thái).
--  • RPC:
--      training_plan_schedule   xếp lịch tự động từ kế hoạch: mỗi nội dung tập huấn một buổi, theo thứ tự chương trình › môn › nội dung,
--                               gom vào ngày theo số giờ mỗi ngày, bỏ qua thứ Bảy, Chủ nhật nếu chọn; bỏ qua nội dung đã có buổi.
--      training_check_in        GV điểm danh trong giờ buổi học; buổi trực tiếp có mã thì phải nhập đúng mã.
--      training_check_in_code   GV chỉ nhập mã (hoặc quét QR), hệ thống tìm buổi đang mở có tên GV.
--      training_request_excuse  GV xin vắng (có lý do) trước khi buổi kết thúc; training_excuse_review: đơn vị tổ chức duyệt / từ chối.
--      training_attendance_mark đơn vị tổ chức ghi có mặt / vắng; training_session_close: chốt điểm danh (chưa ghi = vắng), mở lại.
--      training_session_remind  gửi thông báo nhắc lịch cho GV trong danh sách.
--      training_plan_conflicts  GV bị trùng lịch: trùng tiết dạy trên thời khoá biểu hoặc trùng buổi tập huấn khác.
--  • Bỏ quyền GV tự ghi thẳng bảng điểm danh (chỉ qua RPC, để không bỏ qua mã điểm danh).
--  • Trường xem được buổi của kế hoạch được gán và điểm danh của GV trường mình.
-- Cần chạy sau 084.

-- ===== 1. Cột mới =====
alter table training_sessions
  add column if not exists unit_id uuid references training_program_units(id) on delete set null,
  add column if not exists trainer text,
  add column if not exists note text,
  add column if not exists closed_at timestamptz,
  add column if not exists created_at timestamptz not null default now();
alter table training_sessions alter column org_id set default public.my_org_id();
do $$ begin
  alter table training_sessions add constraint training_sessions_v3_check check (
    (trainer is null or length(trainer) <= 200) and (note is null or length(note) <= 1000));
exception when duplicate_object then null; end $$;
create index if not exists training_sessions_plan on training_sessions (plan_id, starts_at);

create table if not exists training_session_codes (
  session_id uuid primary key references training_sessions(id) on delete cascade,
  code text not null check (code ~ '^\d{6}$')
);
insert into training_session_codes (session_id, code)
select id, lpad((floor(random() * 1000000))::int::text, 6, '0') from training_sessions on conflict do nothing;

alter table training_attendance
  add column if not exists checked_in_at timestamptz,
  add column if not exists method text,
  add column if not exists excuse_status text,
  add column if not exists excuse_reason text,
  add column if not exists updated_by uuid references profiles(id) on delete set null;
do $$ begin
  alter table training_attendance add constraint training_attendance_v3_check check (
    (method is null or method in ('self', 'code', 'manual'))
    and (excuse_status is null or excuse_status in ('pending', 'approved', 'rejected'))
    and (excuse_reason is null or length(excuse_reason) <= 500));
exception when duplicate_object then null; end $$;

-- ===== 2. Kiểm tra buổi, tự tạo danh sách điểm danh =====
create or replace function public.training_sessions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pub text;
begin
  new.title := btrim(new.title); new.trainer := nullif(btrim(new.trainer), ''); new.note := nullif(btrim(new.note), '');
  new.location := nullif(btrim(new.location), ''); new.meeting_url := nullif(btrim(new.meeting_url), '');
  if new.ends_at <= new.starts_at then raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '22023'; end if;
  if tg_op = 'INSERT' or new.plan_id <> old.plan_id then
    select pub_status into v_pub from training_plans where id = new.plan_id;
    if v_pub = 'draft' then raise exception 'Kế hoạch còn nháp: phát hành trước khi xếp lịch' using errcode = '22023'; end if;
  end if;
  if new.unit_id is not null and (tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id or new.plan_id <> old.plan_id)
     and not exists (select 1 from training_program_units u join training_plan_items i on i.program_id = u.program_id
                      where u.id = new.unit_id and u.kind = 'content' and i.plan_id = new.plan_id) then
    raise exception 'Nội dung tập huấn không thuộc chương trình của kế hoạch' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists training_sessions_guard on training_sessions;
create trigger training_sessions_guard before insert or update on training_sessions for each row execute function public.training_sessions_guard();

create or replace function public.training_sessions_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into training_session_codes (session_id, code) values (new.id, lpad((floor(random() * 1000000))::int::text, 6, '0'))
  on conflict do nothing;
  insert into training_attendance (org_id, session_id, teacher_id, present)
  select new.org_id, new.id, e.teacher_id, null from training_enrollments e where e.plan_id = new.plan_id
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists training_sessions_roster on training_sessions;
create trigger training_sessions_roster after insert on training_sessions for each row execute function public.training_sessions_roster();

create or replace function public.training_enrollments_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into training_attendance (org_id, session_id, teacher_id, present)
    select s.org_id, s.id, new.teacher_id, null from training_sessions s
     where s.plan_id = new.plan_id and s.ends_at > now() and s.closed_at is null
    on conflict do nothing;
    return null;
  end if;
  delete from training_attendance a using training_sessions s
   where s.id = a.session_id and s.plan_id = old.plan_id and a.teacher_id = old.teacher_id
     and s.starts_at > now() and a.present is null and a.excuse_status is null;
  return null;
end $$;
drop trigger if exists training_enrollments_roster on training_enrollments;
create trigger training_enrollments_roster after insert or delete on training_enrollments for each row execute function public.training_enrollments_roster();

-- ===== 3. Quyền =====
-- Đơn vị tổ chức buổi (hoặc đơn vị lập kế hoạch) quản lý lịch và điểm danh
create or replace function public.training_session_can_manage(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_sessions s where s.id = p_session
                   and (public.training_can_write(s.org_id) or public.training_plan_can_manage(s.plan_id)))
$$;
-- Giáo viên thuộc trường mình (hoặc đơn vị trực thuộc)
create or replace function public.training_teacher_in_my_tree(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teachers t where t.id = p_teacher and t.org_id in (select public.my_org_tree()))
$$;
revoke all on function public.training_session_can_manage(uuid) from public, anon;
revoke all on function public.training_teacher_in_my_tree(uuid) from public, anon;
grant execute on function public.training_session_can_manage(uuid) to authenticated;
grant execute on function public.training_teacher_in_my_tree(uuid) to authenticated;

drop policy if exists training_sessions_manage on training_sessions;
create policy training_sessions_manage on training_sessions for all to authenticated
  using (public.training_can_write(org_id)) with check (public.training_can_write(org_id));
drop policy if exists training_sessions_assigned_read on training_sessions;
create policy training_sessions_assigned_read on training_sessions for select to authenticated
  using (public.is_staff() and public.training_plan_assigned_to_me(plan_id));
drop policy if exists training_attendance_manage on training_attendance;
create policy training_attendance_manage on training_attendance for all to authenticated
  using (public.training_can_write(org_id)) with check (public.training_can_write(org_id));
drop policy if exists training_attendance_school_read on training_attendance;
create policy training_attendance_school_read on training_attendance for select to authenticated
  using (public.is_staff() and public.training_teacher_in_my_tree(teacher_id));
alter table training_session_codes enable row level security;
drop policy if exists training_session_codes_manage on training_session_codes;
create policy training_session_codes_manage on training_session_codes for all to authenticated
  using (public.training_session_can_manage(session_id)) with check (public.training_session_can_manage(session_id));
grant select, insert, update, delete on training_session_codes to authenticated;
-- GV không ghi thẳng bảng nữa (đi qua training_check_in để kiểm tra mã)
drop policy if exists training_att_self on training_attendance;
drop policy if exists training_att_self_update on training_attendance;

-- ===== 4. Điểm danh của giáo viên =====
create or replace function public.training_session_open(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_sessions s where s.id = p_session and s.closed_at is null
    and now() between s.starts_at - interval '15 minutes' and s.ends_at + interval '15 minutes')
$$;

drop function if exists public.training_check_in(uuid);
create or replace function public.training_check_in(p_session uuid, p_code text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id(); v_row training_attendance; s training_sessions; v_code text;
begin
  if v_teacher is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  select * into v_row from training_attendance where session_id = p_session and teacher_id = v_teacher;
  if not found then raise exception 'Bạn không có tên trong danh sách buổi tập huấn này' using errcode = '42501'; end if;
  select * into s from training_sessions where id = p_session;
  select code into v_code from training_session_codes where session_id = p_session;
  if not public.training_session_open(p_session) then
    raise exception 'Chỉ điểm danh được trong giờ buổi tập huấn' using errcode = '22023';
  end if;
  if s.mode = 'offline' and v_code is not null and coalesce(btrim(p_code), '') <> v_code then
    raise exception 'Buổi trực tiếp: nhập đúng mã điểm danh do giảng viên đưa' using errcode = '22023';
  end if;
  if v_row.present is true then return 'already'; end if;
  update training_attendance set present = true, checked_in_at = now(), method = case when p_code is null then 'self' else 'code' end,
         excuse_status = case when excuse_status = 'pending' then null else excuse_status end
   where session_id = p_session and teacher_id = v_teacher;
  return 'ok';
end $$;
revoke all on function public.training_check_in(uuid, text) from public, anon;
grant execute on function public.training_check_in(uuid, text) to authenticated;

-- Chỉ nhập mã (hoặc quét QR): tìm buổi đang mở có tên GV
create or replace function public.training_check_in_code(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id(); s training_sessions;
begin
  if v_teacher is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  select x.* into s from training_sessions x join training_attendance a on a.session_id = x.id and a.teacher_id = v_teacher
   join training_session_codes k on k.session_id = x.id
   where k.code = btrim(p_code) and public.training_session_open(x.id) order by x.starts_at limit 1;
  if s.id is null then raise exception 'Mã điểm danh không đúng hoặc buổi chưa mở điểm danh' using errcode = '22023'; end if;
  perform public.training_check_in(s.id, btrim(p_code));
  return s.title;
end $$;
revoke all on function public.training_check_in_code(text) from public, anon;
grant execute on function public.training_check_in_code(text) to authenticated;

create or replace function public.training_request_excuse(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id(); v_row training_attendance; s training_sessions;
begin
  select * into v_row from training_attendance where session_id = p_session and teacher_id = v_teacher;
  if v_teacher is null or not found then raise exception 'Bạn không có tên trong danh sách buổi tập huấn này' using errcode = '42501'; end if;
  select * into s from training_sessions where id = p_session;
  if s.closed_at is not null or now() > s.ends_at then raise exception 'Buổi đã kết thúc, không xin vắng được nữa' using errcode = '22023'; end if;
  if v_row.present is true then raise exception 'Bạn đã điểm danh có mặt' using errcode = '22023'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Nhập lý do xin vắng' using errcode = '22023'; end if;
  update training_attendance set excuse_status = 'pending', excuse_reason = left(btrim(p_reason), 500)
   where session_id = p_session and teacher_id = v_teacher;
end $$;

create or replace function public.training_excuse_review(p_session uuid, p_teacher uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.training_session_can_manage(p_session) then raise exception 'Bạn không duyệt được xin vắng của buổi này' using errcode = '42501'; end if;
  update training_attendance set excuse_status = case when p_approve then 'approved' else 'rejected' end,
         present = case when p_approve then false else present end, updated_by = auth.uid()
   where session_id = p_session and teacher_id = p_teacher and excuse_status = 'pending';
  if not found then raise exception 'Không có đơn xin vắng đang chờ duyệt' using errcode = '22023'; end if;
end $$;

create or replace function public.training_attendance_mark(p_session uuid, p_teacher uuid, p_present boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.training_session_can_manage(p_session) then raise exception 'Bạn không điểm danh được buổi này' using errcode = '42501'; end if;
  update training_attendance set present = p_present, method = case when p_present is null then null else 'manual' end,
         checked_in_at = case when p_present then coalesce(checked_in_at, now()) else null end, updated_by = auth.uid()
   where session_id = p_session and teacher_id = p_teacher;
  if not found then raise exception 'Giáo viên không có trong danh sách buổi này' using errcode = '22023'; end if;
end $$;

create or replace function public.training_session_close(p_session uuid, p_close boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare s training_sessions; n int := 0;
begin
  if not public.training_session_can_manage(p_session) then raise exception 'Bạn không chốt được điểm danh buổi này' using errcode = '42501'; end if;
  select * into s from training_sessions where id = p_session for update;
  if p_close then
    if now() < s.starts_at then raise exception 'Buổi chưa diễn ra nên chưa chốt điểm danh được' using errcode = '22023'; end if;
    update training_attendance set present = false, updated_by = auth.uid() where session_id = p_session and present is null;
    get diagnostics n = row_count;
    update training_sessions set closed_at = now() where id = p_session;
  else
    update training_sessions set closed_at = null where id = p_session;
  end if;
  return n;
end $$;

-- Nhắc lịch: thông báo cho GV có tài khoản trong danh sách buổi (không gửi lặp trong 10 phút)
create or replace function public.training_session_remind(p_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s training_sessions; n int;
begin
  if not public.training_session_can_manage(p_session) then raise exception 'Bạn không gửi nhắc lịch được' using errcode = '42501'; end if;
  select * into s from training_sessions where id = p_session;
  if exists (select 1 from notifications where ref_id = p_session and kind = 'training_remind' and created_at > now() - interval '10 minutes') then return 0; end if;
  insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
  select t.org_id, t.profile_id, 'training_remind', left('Nhắc lịch tập huấn: ' || s.title, 200),
         left(to_char(s.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY') || ' – ' || to_char(s.ends_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI')
              || case when s.mode = 'online' then ' · Trực tuyến' else ' · ' || coalesce(s.location, 'Trực tiếp') end, 1000),
         'Lịch tập huấn', 'teacher', s.id
    from training_attendance a join teachers t on t.id = a.teacher_id
   where a.session_id = p_session and t.profile_id is not null and coalesce(a.excuse_status, '') <> 'approved';
  get diagnostics n = row_count;
  return n;
end $$;

-- ===== 5. Xếp lịch tự động từ kế hoạch =====
create or replace function public.training_plan_schedule(p_plan uuid, p_start date, p_time time default '08:00',
  p_hours_per_day numeric default 4, p_skip_weekend boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare p training_plans; r record; d date := p_start; used numeric := 0; h numeric; n int := 0; v_mode text; v_start timestamptz;
begin
  select * into p from training_plans where id = p_plan;
  if p.id is null or not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không xếp lịch được kế hoạch này' using errcode = '42501'; end if;
  if p.pub_status <> 'published' then raise exception 'Chỉ xếp lịch cho kế hoạch đã phát hành' using errcode = '22023'; end if;
  if p_start is null or p_hours_per_day is null or p_hours_per_day <= 0 or p_hours_per_day > 12 then
    raise exception 'Ngày bắt đầu hoặc số giờ mỗi ngày không hợp lệ' using errcode = '22023';
  end if;
  for r in select u.id, u.title, u.hours, u.mode, i.trainer
             from training_plan_items i
             join training_program_units sj on sj.program_id = i.program_id and sj.kind = 'subject'
             join training_program_units u on u.parent_id = sj.id and u.kind = 'content'
            where i.plan_id = p_plan
              and not exists (select 1 from training_sessions s where s.plan_id = p_plan and s.unit_id = u.id)
            order by i.seq, sj.seq, u.seq loop
    h := least(greatest(coalesce(r.hours, 0), 0.5), 12);
    if used > 0 and used + h > p_hours_per_day then d := d + 1; used := 0; end if;
    while p_skip_weekend and extract(isodow from d) in (6, 7) loop d := d + 1; end loop;
    v_mode := coalesce(r.mode, case when p.mode in ('online', 'offline') then p.mode else 'offline' end);
    v_start := ((d + p_time)::timestamp + make_interval(mins => (used * 60)::int)) at time zone 'Asia/Ho_Chi_Minh';
    insert into training_sessions (org_id, plan_id, unit_id, title, starts_at, ends_at, mode, trainer)
    values (p.org_id, p_plan, r.id, r.title, v_start, v_start + make_interval(mins => (h * 60)::int), v_mode, r.trainer);
    used := used + h; n := n + 1;
  end loop;
  return n;
end $$;

-- ===== 6. Trùng lịch =====
create or replace function public.training_plan_conflicts(p_plan uuid)
returns table (session_id uuid, teacher_id uuid, teacher_name text, kind text, detail text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select s.id sid, s.starts_at, s.ends_at, a.teacher_id
      from training_sessions s join training_attendance a on a.session_id = s.id
     where s.plan_id = p_plan and s.ends_at > now() - interval '1 day'
       and coalesce(a.excuse_status, '') <> 'approved'
       and (public.training_plan_can_manage(p_plan) or public.training_teacher_in_my_tree(a.teacher_id))
  )
  select distinct on (m.sid, m.teacher_id) m.sid, m.teacher_id, t.full_name, 'timetable',
         'Dạy ' || te.subject || coalesce(' lớp ' || c.name, '') || ' (' || pc.name || ', ' || to_char(pc.starts_at, 'HH24:MI') || ')'
    from mine m
    join teachers t on t.id = m.teacher_id
    join timetable_entries te on te.teacher_id = m.teacher_id
     and te.weekday = extract(isodow from m.starts_at at time zone 'Asia/Ho_Chi_Minh')::int + 1
     and (te.year_id is null or te.year_id in (select y.id from academic_years y where y.is_current))
    join period_configs pc on pc.id = te.period_id
     and (m.starts_at at time zone 'Asia/Ho_Chi_Minh')::time < pc.ends_at
     and (m.ends_at at time zone 'Asia/Ho_Chi_Minh')::time > pc.starts_at
    left join classes c on c.id = te.class_id
  union all
  select distinct on (m.sid, m.teacher_id) m.sid, m.teacher_id, t.full_name, 'training',
         'Trùng buổi tập huấn "' || s2.title || '"'
    from mine m
    join teachers t on t.id = m.teacher_id
    join training_attendance a2 on a2.teacher_id = m.teacher_id and a2.session_id <> m.sid and coalesce(a2.excuse_status, '') <> 'approved'
    join training_sessions s2 on s2.id = a2.session_id and s2.starts_at < m.ends_at and s2.ends_at > m.starts_at
$$;

revoke all on function public.training_request_excuse(uuid, text) from public, anon;
revoke all on function public.training_excuse_review(uuid, uuid, boolean) from public, anon;
revoke all on function public.training_attendance_mark(uuid, uuid, boolean) from public, anon;
revoke all on function public.training_session_close(uuid, boolean) from public, anon;
revoke all on function public.training_session_remind(uuid) from public, anon;
revoke all on function public.training_plan_schedule(uuid, date, time, numeric, boolean) from public, anon;
revoke all on function public.training_plan_conflicts(uuid) from public, anon;
grant execute on function public.training_request_excuse(uuid, text) to authenticated;
grant execute on function public.training_excuse_review(uuid, uuid, boolean) to authenticated;
grant execute on function public.training_attendance_mark(uuid, uuid, boolean) to authenticated;
grant execute on function public.training_session_close(uuid, boolean) to authenticated;
grant execute on function public.training_session_remind(uuid) to authenticated;
grant execute on function public.training_plan_schedule(uuid, date, time, numeric, boolean) to authenticated;
grant execute on function public.training_plan_conflicts(uuid) to authenticated;

-- ===== 7. Lịch của giáo viên: thêm mã, xin vắng, chốt =====
drop function if exists public.my_training_sessions();
create or replace function public.my_training_sessions()
returns table (id uuid, plan_id uuid, plan_name text, program text, provider text, title text,
               starts_at timestamptz, ends_at timestamptz, mode text, location text, meeting_url text,
               present boolean, org_name text, trainer text, need_code boolean, closed boolean,
               checked_in_at timestamptz, excuse_status text, excuse_reason text)
language sql stable security definer set search_path = public as $$
  select s.id, s.plan_id, p.name, p.program, p.provider, s.title, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url,
         a.present, o.name, s.trainer, (s.mode = 'offline' and exists (select 1 from training_session_codes k where k.session_id = s.id)), s.closed_at is not null,
         a.checked_in_at, a.excuse_status, a.excuse_reason
  from training_attendance a
  join training_sessions s on s.id = a.session_id
  left join training_plans p on p.id = s.plan_id
  left join organizations o on o.id = s.org_id
  where a.teacher_id = public.my_teacher_id()
  order by s.starts_at
$$;
revoke all on function public.my_training_sessions() from public, anon;
grant execute on function public.my_training_sessions() to authenticated;

notify pgrst, 'reload schema';
