-- 017. Cổng Học sinh: biểu quyết trong tiết học, tên người viết thảo luận, tài khoản demo.
-- Cần chạy sau 016.

-- ===== 1. Biểu quyết theo slide câu hỏi trong phiên lớp =====
create table session_responses (
  org_id uuid not null references organizations(id),
  session_id uuid not null references class_sessions(id) on delete cascade,
  slide_id text not null,
  student_id uuid not null references students(id) on delete cascade,
  answer int not null check (answer between 0 and 9),
  answered_at timestamptz not null default now(),
  primary key (session_id, slide_id, student_id)
);
alter table session_responses enable row level security;
-- Giáo viên dạy lớp (và nhân sự trường) xem kết quả
create policy responses_staff_read on session_responses for select to authenticated
  using (public.can_access_org(org_id) and public.is_staff());
-- Học sinh xem / gửi / đổi câu trả lời của mình khi phiên còn mở và đã vào lớp
create policy responses_student_read on session_responses for select to authenticated
  using (student_id = public.my_student_id());
create policy responses_student_insert on session_responses for insert to authenticated
  with check (student_id = public.my_student_id() and org_id = public.my_org_id()
    and exists (select 1 from class_sessions s join class_session_attendance a on a.session_id = s.id and a.student_id = public.my_student_id()
                where s.id = session_id and s.status = 'live'));
create policy responses_student_update on session_responses for update to authenticated
  using (student_id = public.my_student_id()
    and exists (select 1 from class_sessions s where s.id = session_id and s.status = 'live'))
  with check (student_id = public.my_student_id());

-- Học sinh xem điểm danh của chính mình cho phiên đang mở (đã có), và đếm sĩ số lớp trong phiên
create or replace function public.session_tally(p_session uuid, p_slide text)
returns table (answer int, n bigint)
language sql stable security definer set search_path = public as $$
  select r.answer, count(*) from session_responses r join class_sessions s on s.id = r.session_id
   where r.session_id = p_session and r.slide_id = p_slide
     and (public.teaches_class(s.class_id) or (public.is_staff() and public.can_access_org(s.org_id)))
   group by r.answer
$$;
grant execute on function public.session_tally(uuid, text) to authenticated;

-- ===== 2. Tên người viết trong thảo luận (học sinh không đọc được hồ sơ người khác) =====
alter table topic_posts add column if not exists author_name text, add column if not exists author_role text;
create or replace function public.fill_post_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_name := coalesce((select full_name from profiles where id = new.author_id), 'Người dùng');
  new.author_role := case when public.is_student() then 'student' else 'teacher' end;
  return new;
end $$;
create trigger topic_posts_author before insert on topic_posts for each row execute function public.fill_post_author();

-- Thảo luận mẫu cho chủ đề đang học của Lớp 9A
do $$
declare t uuid; sch uuid;
begin
  select id into sch from organizations where code = 'THCS-PH';
  select id into t from class_topics where org_id = sch and title = 'Hệ thống tưới cây thông minh';
  if t is null or exists (select 1 from topic_posts where topic_id = t) then return; end if;
  -- author_id bắt buộc là hồ sơ thật; chỉ tạo khi trường đã có tài khoản giáo viên Phạm Anh Tuấn
  if exists (select 1 from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn' and profile_id is not null) then
    insert into topic_posts (org_id, topic_id, author_id, body)
    select sch, t, profile_id, 'Buổi 2 các nhóm nhớ mang theo cảm biến độ ẩm và bơm mini. Nhóm nào thiếu thiết bị báo thầy trước thứ Sáu nhé.'
      from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn';
  end if;
end $$;
