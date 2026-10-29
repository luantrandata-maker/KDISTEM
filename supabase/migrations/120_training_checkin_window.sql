-- 120. Khung giờ điểm danh theo từng buổi tập huấn.
--  • training_sessions.checkin_before: mở điểm danh trước giờ học bao nhiêu phút (0 – 1 ngày, mặc định 30).
--  • training_sessions.checkin_after: còn điểm danh được sau khi kết thúc bao nhiêu phút (0 – 7 ngày, mặc định 30).
--  • Giáo viên điểm danh được trước giờ, trong giờ và sau giờ học trong khung này, cho tới khi buổi được chốt.
--    Các buổi đã có cũng nhận khung mặc định 30 phút trước / 30 phút sau (trước đây cố định 15 phút).
--  • my_training_sessions() trả thêm checkin_from / checkin_to để cổng giáo viên hiện đúng giờ mở.
-- Cần chạy sau 119.

alter table training_sessions add column if not exists checkin_before int not null default 30;
alter table training_sessions add column if not exists checkin_after int not null default 30;
alter table training_sessions drop constraint if exists training_sessions_checkin_window_check;
alter table training_sessions add constraint training_sessions_checkin_window_check
  check (checkin_before between 0 and 1440 and checkin_after between 0 and 10080);

create or replace function public.training_session_open(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_sessions s where s.id = p_session and s.closed_at is null
    and now() between s.starts_at - make_interval(mins => s.checkin_before) and s.ends_at + make_interval(mins => s.checkin_after))
$$;

-- Thông báo lỗi nói rõ khung giờ điểm danh
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
    raise exception 'Ngoài khung giờ điểm danh của buổi tập huấn (hoặc buổi đã chốt điểm danh)' using errcode = '22023';
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

drop function if exists public.my_training_sessions();
create or replace function public.my_training_sessions()
returns table (id uuid, plan_id uuid, plan_name text, program text, provider text, title text,
               starts_at timestamptz, ends_at timestamptz, mode text, location text, meeting_url text,
               present boolean, org_name text, trainer text, need_code boolean, closed boolean,
               checked_in_at timestamptz, excuse_status text, excuse_reason text, recording_url text,
               checkin_from timestamptz, checkin_to timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.plan_id, p.name, p.program, p.provider, s.title, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url,
         a.present, o.name, s.trainer, (s.mode = 'offline' and exists (select 1 from training_session_codes k where k.session_id = s.id)), s.closed_at is not null,
         a.checked_in_at, a.excuse_status, a.excuse_reason, s.recording_url,
         s.starts_at - make_interval(mins => s.checkin_before), s.ends_at + make_interval(mins => s.checkin_after)
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
