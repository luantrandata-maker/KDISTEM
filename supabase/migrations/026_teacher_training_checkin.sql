-- 026: Cổng giáo viên — Lịch tập huấn & Bài giảng tập huấn
-- Trước đây giáo viên tự ghi điểm danh tập huấn của mình bất kỳ lúc nào, kể cả tự đánh "có mặt" cho buổi đã qua
-- hoặc chưa diễn ra (policy training_att_self*, migration 012). Từ nay:
--   • giáo viên chỉ tự điểm danh "có mặt", và chỉ trong giờ buổi tập huấn (sớm/muộn tối đa 15 phút);
--   • đánh vắng, sửa điểm danh buổi đã qua: người có quyền sửa chức năng Tập huấn hoặc cán bộ cấp quản lý.

-- Buổi tập huấn đang mở để giáo viên tự điểm danh
create or replace function public.training_session_open(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_sessions s where s.id = p_session
    and now() between s.starts_at - interval '15 minutes' and s.ends_at + interval '15 minutes')
$$;

drop policy if exists training_att_self on training_attendance;
drop policy if exists training_att_self_update on training_attendance;
create policy training_att_self on training_attendance for insert to authenticated
  with check (org_id in (select public.my_org_tree()) and teacher_id = (select public.my_teacher_id())
              and present is true and public.training_session_open(session_id));
create policy training_att_self_update on training_attendance for update to authenticated
  using (teacher_id = (select public.my_teacher_id()) and public.training_session_open(session_id))
  with check (teacher_id = (select public.my_teacher_id()) and present is true and public.training_session_open(session_id));

-- Giáo viên bấm "Tham gia" / "Điểm danh": ghi có mặt cho buổi mình được ghi danh.
-- Dùng hàm (không ghi thẳng bảng) vì buổi của Sở/Phòng có dòng điểm danh thuộc đơn vị cấp trên.
create or replace function public.training_check_in(p_session uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id(); v_row training_attendance;
begin
  if v_teacher is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  select * into v_row from training_attendance where session_id = p_session and teacher_id = v_teacher;
  if not found then raise exception 'Bạn không có tên trong danh sách buổi tập huấn này' using errcode = '42501'; end if;
  if not public.training_session_open(p_session) then
    raise exception 'Chỉ điểm danh được trong giờ buổi tập huấn' using errcode = '22023';
  end if;
  if v_row.present is true then return 'already'; end if;
  update training_attendance set present = true where session_id = p_session and teacher_id = v_teacher;
  return 'ok';
end $$;
revoke all on function public.training_check_in(uuid) from public;
grant execute on function public.training_check_in(uuid) to authenticated;

-- Danh sách buổi tập huấn của giáo viên đang đăng nhập (mọi cấp tổ chức: trường, Phòng, Sở…)
create or replace function public.my_training_sessions()
returns table (id uuid, plan_id uuid, plan_name text, program text, provider text, title text,
               starts_at timestamptz, ends_at timestamptz, mode text, location text, meeting_url text,
               present boolean, org_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.plan_id, p.name, p.program, p.provider, s.title, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url,
         a.present, o.name
  from training_attendance a
  join training_sessions s on s.id = a.session_id
  left join training_plans p on p.id = s.plan_id
  left join organizations o on o.id = s.org_id
  where a.teacher_id = public.my_teacher_id()
  order by s.starts_at
$$;
grant execute on function public.my_training_sessions() to authenticated;

-- Bài giảng tập huấn của các khoá giáo viên được ghi danh hoặc có buổi trong danh sách (chỉ bản đã xuất bản)
create or replace function public.my_training_lessons()
returns table (id uuid, title text, grades text, subject text, author text, created_on date,
               blocks int, materials int, videos int, docs int, plan_id uuid, plan_name text, program text)
language sql stable security definer set search_path = public as $$
  with my_plans as (
    select plan_id from training_enrollments where teacher_id = public.my_teacher_id()
    union
    select s.plan_id from training_attendance a join training_sessions s on s.id = a.session_id
      where a.teacher_id = public.my_teacher_id()
  )
  select l.id, l.title, l.grades, l.subject, l.author, l.created_on::date,
         l.blocks, l.materials, l.videos, l.docs, l.plan_id, p.name, p.program
  from training_lessons l
  join training_plans p on p.id = l.plan_id
  where l.plan_id in (select plan_id from my_plans) and l.status = 'published'
  order by l.created_on desc
$$;
grant execute on function public.my_training_lessons() to authenticated;
