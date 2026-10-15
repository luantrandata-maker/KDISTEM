-- 013. Nền dữ liệu học tập dùng chung cho cổng Giáo viên, Học sinh và Sở:
--   chủ đề STEM của lớp → buổi học → tài liệu / thảo luận / tiến độ học sinh
--   bài tập (cá nhân hoặc nhóm) → bài nộp → chấm điểm
--   phiên lớp học trực tiếp có mã PIN để học sinh vào lớp
-- Cần chạy sau 012 (dùng is_staff, my_teacher_id, my_student_id, my_class_id).

-- ===== 1. Nhóm học sinh =====
create table student_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  class_id uuid not null references classes(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create table student_group_members (
  org_id uuid not null references organizations(id),
  group_id uuid not null references student_groups(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (group_id, student_id)
);

-- ===== 2. Chủ đề STEM của lớp và buổi học =====
create table class_topics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid references teachers(id) on delete set null,
  package_topic_id uuid references package_topics(id) on delete set null,
  title text not null,
  subject text,
  program text check (program in ('CT1','CT2','CT3','CT4','CT5')),
  summary text,
  cover_url text,
  status text not null default 'planned' check (status in ('planned','active','done')),
  starts_on date,
  created_at timestamptz not null default now()
);
create table topic_lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  topic_id uuid not null references class_topics(id) on delete cascade,
  seq int not null,
  title text not null,
  minutes int not null default 45,
  scheduled_on date,
  room_id uuid references stem_rooms(id) on delete set null,
  bring_items text,                         -- "Mang theo buổi N", mỗi dòng một mục
  unique (topic_id, seq)
);
create table topic_materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  topic_id uuid not null references class_topics(id) on delete cascade,
  lesson_id uuid references topic_lessons(id) on delete cascade,
  title text not null,
  kind text not null default 'doc' check (kind in ('doc','slide','video','link','worksheet')),
  url text,
  created_at timestamptz not null default now()
);
create table lesson_progress (
  org_id uuid not null references organizations(id),
  lesson_id uuid not null references topic_lessons(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','done')),
  updated_at timestamptz not null default now(),
  primary key (lesson_id, student_id)
);
create table topic_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  topic_id uuid not null references class_topics(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

-- ===== 3. Bài tập và bài nộp =====
create table assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  teacher_id uuid references teachers(id) on delete set null,
  class_id uuid not null references classes(id) on delete cascade,
  topic_id uuid references class_topics(id) on delete set null,
  lesson_id uuid references topic_lessons(id) on delete set null,
  title text not null,
  kind text not null default 'worksheet' check (kind in ('worksheet','product','quiz','report','homework','self_review')),
  subject text,
  instructions text,
  max_score numeric(5,2) not null default 10,
  group_mode boolean not null default false,  -- true: nộp theo nhóm
  opens_at timestamptz not null default now(),
  due_at timestamptz,
  status text not null default 'open' check (status in ('draft','open','closed')),
  created_at timestamptz not null default now()
);
create table submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  group_id uuid references student_groups(id) on delete cascade,
  content text,
  attachment_url text,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','graded','returned')),
  score numeric(5,2),
  feedback text,
  graded_at timestamptz,
  graded_by uuid references teachers(id) on delete set null,
  check (num_nonnulls(student_id, group_id) = 1),
  unique (assignment_id, student_id),
  unique (assignment_id, group_id)
);
create index on assignments (class_id, due_at);
create index on submissions (assignment_id);

-- ===== 4. Phiên lớp học trực tiếp (mã PIN) =====
create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  teacher_id uuid references teachers(id) on delete set null,
  class_id uuid not null references classes(id) on delete cascade,
  lesson_id uuid references topic_lessons(id) on delete set null,
  title text not null,
  pin text not null check (pin ~ '^[0-9]{6}$'),
  status text not null default 'live' check (status in ('live','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index class_sessions_live_pin on class_sessions (pin) where status = 'live';
create table class_session_attendance (
  org_id uuid not null references organizations(id),
  session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, student_id)
);

-- ===== 5. Hàm phân quyền =====
create or replace function public.teaches_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and exists (select 1 from classes c where c.id = p_class and public.can_access_org(c.org_id))
      or exists (select 1 from teaching_assignments ta where ta.class_id = p_class and ta.teacher_id = public.my_teacher_id())
      or exists (select 1 from classes c where c.id = p_class and c.homeroom_teacher_id = public.my_teacher_id())
$$;

create or replace function public.can_manage_topic(p_topic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_topics t where t.id = p_topic
                 and (t.teacher_id = public.my_teacher_id() or public.teaches_class(t.class_id)))
$$;

-- Học sinh thấy chủ đề / bài tập của lớp mình (không thấy bản nháp)
create or replace function public.student_sees_topic(p_topic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_topics t where t.id = p_topic and t.class_id = public.my_class_id())
$$;

create or replace function public.my_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select group_id from student_group_members where student_id = public.my_student_id()
$$;

-- ===== 6. RLS =====
do $$
declare t text;
begin
  foreach t in array array['student_groups','student_group_members','class_topics','topic_lessons','topic_materials',
                           'lesson_progress','topic_posts','assignments','submissions','class_sessions','class_session_attendance']
  loop
    execute format('alter table %I enable row level security', t);
    -- Nhân sự trong phạm vi tổ chức (trường, Sở cấp trên) được đọc
    execute format('create policy %I on %I for select to authenticated using (public.can_access_org(org_id) and public.is_staff())', t||'_staff_read', t);
  end loop;
end $$;

-- Nhóm học sinh: giáo viên dạy lớp quản lý; học sinh xem nhóm trong lớp mình
create policy groups_teacher_write on student_groups for all to authenticated
  using (public.teaches_class(class_id)) with check (public.can_access_org(org_id) and public.teaches_class(class_id));
create policy groups_student_read on student_groups for select to authenticated
  using (public.is_student() and class_id = public.my_class_id());
create policy group_members_teacher_write on student_group_members for all to authenticated
  using (exists (select 1 from student_groups g where g.id = group_id and public.teaches_class(g.class_id)))
  with check (exists (select 1 from student_groups g join students s on s.id = student_id
                      where g.id = group_id and s.class_id = g.class_id and public.teaches_class(g.class_id)));
create policy group_members_student_read on student_group_members for select to authenticated
  using (public.is_student() and exists (select 1 from student_groups g where g.id = group_id and g.class_id = public.my_class_id()));

-- Chủ đề, buổi học, tài liệu
create policy topics_teacher_write on class_topics for all to authenticated
  using (public.teaches_class(class_id)) with check (public.can_access_org(org_id) and public.teaches_class(class_id));
create policy topics_student_read on class_topics for select to authenticated
  using (public.is_student() and class_id = public.my_class_id());

create policy lessons_teacher_write on topic_lessons for all to authenticated
  using (public.can_manage_topic(topic_id)) with check (public.can_access_org(org_id) and public.can_manage_topic(topic_id));
create policy lessons_student_read on topic_lessons for select to authenticated
  using (public.is_student() and public.student_sees_topic(topic_id));

create policy materials_teacher_write on topic_materials for all to authenticated
  using (public.can_manage_topic(topic_id)) with check (public.can_access_org(org_id) and public.can_manage_topic(topic_id));
create policy materials_student_read on topic_materials for select to authenticated
  using (public.is_student() and public.student_sees_topic(topic_id));

-- Tiến độ: học sinh tự cập nhật của mình
create policy progress_student_all on lesson_progress for all to authenticated
  using (student_id = public.my_student_id())
  with check (student_id = public.my_student_id() and org_id = public.my_org_id()
              and exists (select 1 from topic_lessons l where l.id = lesson_id and public.student_sees_topic(l.topic_id)));

-- Thảo luận: ai thấy chủ đề thì đọc và viết; chỉ tác giả hoặc giáo viên phụ trách được xoá
create policy posts_student_read on topic_posts for select to authenticated
  using (public.is_student() and public.student_sees_topic(topic_id));
create policy posts_insert on topic_posts for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_org(org_id)
              and (public.can_manage_topic(topic_id) or (public.is_student() and public.student_sees_topic(topic_id))));
create policy posts_delete on topic_posts for delete to authenticated
  using (author_id = auth.uid() or public.can_manage_topic(topic_id));

-- Bài tập
create policy assignments_teacher_write on assignments for all to authenticated
  using (public.teaches_class(class_id)) with check (public.can_access_org(org_id) and public.teaches_class(class_id));
create policy assignments_student_read on assignments for select to authenticated
  using (public.is_student() and class_id = public.my_class_id() and status <> 'draft');

-- Bài nộp: giáo viên dạy lớp chấm; học sinh nộp / sửa bài của mình hoặc nhóm mình khi chưa chấm
create policy submissions_teacher_update on submissions for update to authenticated
  using (exists (select 1 from assignments a where a.id = assignment_id and public.teaches_class(a.class_id)))
  with check (exists (select 1 from assignments a where a.id = assignment_id and public.teaches_class(a.class_id)));
create policy submissions_teacher_delete on submissions for delete to authenticated
  using (exists (select 1 from assignments a where a.id = assignment_id and public.teaches_class(a.class_id)));
create policy submissions_student_read on submissions for select to authenticated
  using (public.is_student() and (student_id = public.my_student_id() or group_id in (select public.my_group_ids())));
create policy submissions_student_insert on submissions for insert to authenticated
  with check (public.is_student() and org_id = public.my_org_id()
    and exists (select 1 from assignments a where a.id = assignment_id and a.class_id = public.my_class_id()
                and a.status = 'open' and a.opens_at <= now()
                and ((not a.group_mode and student_id = public.my_student_id())
                  or (a.group_mode and group_id in (select public.my_group_ids())))));
create policy submissions_student_update on submissions for update to authenticated
  using (public.is_student() and status <> 'graded'
         and (student_id = public.my_student_id() or group_id in (select public.my_group_ids())))
  with check (public.is_student() and (student_id = public.my_student_id() or group_id in (select public.my_group_ids())));

-- Học sinh không tự chấm điểm: giữ nguyên các trường chấm, đặt lại thời điểm nộp
create or replace function public.guard_submission() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_student() then
    if tg_op = 'INSERT' then
      new.status := 'submitted'; new.score := null; new.feedback := null; new.graded_at := null; new.graded_by := null;
      new.submitted_at := now();
    else
      new.assignment_id := old.assignment_id; new.student_id := old.student_id; new.group_id := old.group_id;
      new.status := 'submitted'; new.score := old.score; new.feedback := old.feedback;
      new.graded_at := old.graded_at; new.graded_by := old.graded_by; new.submitted_at := now();
    end if;
  elsif tg_op = 'UPDATE' and new.score is distinct from old.score and new.score is not null then
    new.status := 'graded'; new.graded_at := now(); new.graded_by := coalesce(public.my_teacher_id(), new.graded_by);
  end if;
  return new;
end $$;
create trigger submissions_guard before insert or update on submissions
  for each row execute function public.guard_submission();

-- Phiên lớp học: giáo viên mở/đóng qua hàm; học sinh thấy phiên của lớp mình
create policy sessions_teacher_update on class_sessions for update to authenticated
  using (public.teaches_class(class_id)) with check (public.teaches_class(class_id));
create policy sessions_student_read on class_sessions for select to authenticated
  using (public.is_student() and class_id = public.my_class_id());
create policy attendance_student_read on class_session_attendance for select to authenticated
  using (student_id = public.my_student_id());

-- ===== 7. Mở lớp bằng PIN / vào lớp bằng PIN =====
create or replace function public.start_class_session(p_class uuid, p_title text, p_lesson uuid default null)
returns class_sessions
language plpgsql security definer set search_path = public as $$
declare s class_sessions; v_pin text; v_org uuid; tries int := 0;
begin
  if not public.teaches_class(p_class) then raise exception 'Bạn không dạy lớp này'; end if;
  select org_id into v_org from classes where id = p_class;
  -- Mỗi lớp chỉ có một phiên đang mở
  update class_sessions set status = 'ended', ended_at = now() where class_id = p_class and status = 'live';
  loop
    v_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into class_sessions (org_id, teacher_id, class_id, lesson_id, title, pin)
        values (v_org, public.my_teacher_id(), p_class, p_lesson, coalesce(nullif(p_title,''), 'Tiết học STEM'), v_pin)
        returning * into s;
      return s;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then raise; end if;
    end;
  end loop;
end $$;

create or replace function public.end_class_session(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update class_sessions set status = 'ended', ended_at = now()
   where id = p_session and status = 'live' and public.teaches_class(class_id);
  if not found then raise exception 'Không tìm thấy phiên đang mở của lớp bạn dạy'; end if;
end $$;

create or replace function public.join_class_session(p_pin text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s class_sessions; v_student uuid := public.my_student_id();
begin
  if v_student is null then raise exception 'Tài khoản chưa được liên kết với học sinh'; end if;
  select * into s from class_sessions where pin = trim(p_pin) and status = 'live';
  if s.id is null then raise exception 'Mã PIN không đúng hoặc tiết học đã kết thúc'; end if;
  if s.class_id is distinct from public.my_class_id() then raise exception 'Mã PIN này dành cho lớp khác'; end if;
  insert into class_session_attendance (org_id, session_id, student_id) values (s.org_id, s.id, v_student)
    on conflict do nothing;
  return s.id;
end $$;

-- ===== 8. Tổng hợp bài tập cho danh sách của giáo viên =====
-- security_invoker: view áp dụng RLS của người gọi
create or replace view assignment_overview with (security_invoker = true) as
select a.*,
  c.name as class_name,
  case when a.group_mode then (select count(*) from student_groups g where g.class_id = a.class_id)
       else (select count(*) from students s where s.class_id = a.class_id and coalesce(s.status,'studying') = 'studying') end as target_count,
  (select count(*) from submissions x where x.assignment_id = a.id) as submitted_count,
  (select count(*) from submissions x where x.assignment_id = a.id and x.status = 'graded') as graded_count,
  (select count(*) from submissions x where x.assignment_id = a.id and a.due_at is not null and x.submitted_at > a.due_at) as late_count
from assignments a join classes c on c.id = a.class_id;

grant execute on function public.teaches_class(uuid), public.can_manage_topic(uuid), public.student_sees_topic(uuid),
  public.my_group_ids(), public.start_class_session(uuid, text, uuid), public.end_class_session(uuid),
  public.join_class_session(text) to authenticated;
grant select on assignment_overview to authenticated;

-- ===== 9. Dữ liệu mẫu: Lớp 9A – thầy Phạm Anh Tuấn (ngày tính theo hôm nay để demo luôn "đang diễn ra") =====
do $$
declare sch uuid; cls uuid; tch uuid; room uuid; t uuid; g1 uuid; g2 uuid; g3 uuid; a uuid;
        topic record; i int; st record; n int;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from class_topics where org_id = sch) then return; end if;
  select id into cls from classes where org_id = sch and name = 'Lớp 9A';
  select id into tch from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn';
  select id into room from stem_rooms where org_id = sch and name = 'Phòng STEM 1';
  if cls is null or tch is null then return; end if;

  -- Nhóm
  insert into student_groups (org_id, class_id, name) values (sch, cls, 'Nhóm 1') returning id into g1;
  insert into student_groups (org_id, class_id, name) values (sch, cls, 'Nhóm 2') returning id into g2;
  insert into student_groups (org_id, class_id, name) values (sch, cls, 'Nhóm 3') returning id into g3;
  n := 0;
  for st in select id from students where class_id = cls order by student_code loop
    insert into student_group_members (org_id, group_id, student_id)
      values (sch, case n % 3 when 0 then g1 when 1 then g2 else g3 end, st.id);
    n := n + 1;
  end loop;

  -- Chủ đề + 5 buổi mỗi chủ đề
  for topic in select * from (values
    (1,'Hệ thống tưới cây thông minh','Công nghệ','CT4','active', -14,
       array['Khám phá vấn đề & kiến thức nền','Lắp ráp & lập trình mạch','Lập trình ngưỡng độ ẩm','Thử nghiệm & hiệu chỉnh','Báo cáo & đánh giá sản phẩm']),
    (2,'Robot tránh vật cản tự động','Tin học','CT4','active', -7,
       array['Làm quen robot mBot','Cảm biến siêu âm','Thuật toán tránh vật cản','Thi đấu mê cung','Trình bày & cải tiến']),
    (3,'Mô hình hệ Mặt Trời tỉ lệ','Khoa học tự nhiên','CT2','active', -3,
       array['Tỉ lệ & khoảng cách','Thiết kế mô hình','Chế tạo','Thuyết minh chuyển động','Trưng bày']),
    (4,'Máy lọc nước từ vật liệu tự nhiên','Hoá học','CT3','planned', 10,
       array['Đặt vấn đề nước sạch','Tìm hiểu vật liệu lọc','Thiết kế bộ lọc','Thử nghiệm độ đục','Báo cáo']),
    (5,'Trạm đo thời tiết mini IoT','Công nghệ','CT4','done', -60,
       array['Cảm biến DHT22','Kết nối gateway','Dashboard dữ liệu','Lắp đặt ngoài trời','Báo cáo']),
    (6,'Đèn báo giao thông lập trình','Tin học','CT1','done', -45,
       array['Mạch LED','Lập trình chu kỳ đèn','Nút ưu tiên người đi bộ','Hoàn thiện mô hình','Trình bày'])
  ) as v(seq, title, subject, program, status, start_offset, lessons) loop
    insert into class_topics (org_id, class_id, teacher_id, title, subject, program, status, starts_on, summary)
      values (sch, cls, tch, topic.title, topic.subject, topic.program, topic.status, current_date + topic.start_offset,
              'Dự án STEM theo nhóm, ' || array_length(topic.lessons,1) || ' buổi')
      returning id into t;
    for i in 1..array_length(topic.lessons,1) loop
      insert into topic_lessons (org_id, topic_id, seq, title, minutes, scheduled_on, room_id, bring_items)
        values (sch, t, i, topic.lessons[i], case when i in (2,3) then 90 else 45 end,
                current_date + topic.start_offset + (i - 1) * 7, room,
                case when i = 2 then E'Bộ Arduino Uno R3 và cảm biến độ ẩm đất\nRelay 5V và bơm mini 5V\nPhiếu ghi kết quả test & debug của nhóm' end);
    end loop;
    insert into topic_materials (org_id, topic_id, title, kind, url) values
      (sch, t, 'Slide giới thiệu chủ đề', 'slide', null),
      (sch, t, 'Phiếu học tập buổi 1', 'worksheet', null),
      (sch, t, 'Video hướng dẫn lắp ráp', 'video', null);

    -- Tiến độ học sinh cho chủ đề đang học / đã xong
    if topic.status <> 'planned' then
      insert into lesson_progress (org_id, lesson_id, student_id, status)
      select sch, l.id, s.id, 'done'
        from topic_lessons l cross join students s
       where l.topic_id = t and s.class_id = cls and l.scheduled_on < current_date;
    end if;
  end loop;

  -- Bài tập (hạn nộp tương đối so với hôm nay)
  select id into t from class_topics where class_id = cls and title = 'Hệ thống tưới cây thông minh';
  insert into assignments (org_id, teacher_id, class_id, topic_id, title, kind, subject, group_mode, opens_at, due_at, status) values
    (sch, tch, cls, null, 'Bài kiểm tra nhanh: An toàn phòng thí nghiệm', 'quiz', 'Công nghệ', false, now() - interval '5 days', now() - interval '1 day', 'open'),
    (sch, tch, cls, t,    'Phiếu quan sát: Nhật ký sinh trưởng của cây', 'worksheet', 'Khoa học tự nhiên', false, now() - interval '10 days', now() - interval '4 days', 'open'),
    (sch, tch, cls, null, 'Phiếu học tập: Đo nhiệt độ nước', 'worksheet', 'Khoa học tự nhiên', false, now() - interval '6 days', now() - interval '3 days', 'open'),
    (sch, tch, cls, null, 'Phiếu tự đánh giá: Kỹ năng nhóm', 'self_review', 'STEM', false, now() - interval '4 days', now() - interval '2 days', 'open'),
    (sch, tch, cls, null, 'Bài tập về nhà: Giải hệ phương trình bậc nhất', 'homework', 'Toán', false, now() - interval '2 days', (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') + interval '23 hours 59 minutes') at time zone 'Asia/Ho_Chi_Minh', 'open'),
    (sch, tch, cls, null, 'Bài thực hành: Lắp mạch cảm biến ánh sáng', 'worksheet', 'Công nghệ', false, now() - interval '1 day', (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 day 23 hours 59 minutes') at time zone 'Asia/Ho_Chi_Minh', 'open'),
    (sch, tch, cls, t,    'Dự án: Vườn rau thông minh IoT', 'product', 'Công nghệ', true, now() - interval '7 days', now() + interval '6 days', 'open'),
    (sch, tch, cls, null, 'Báo cáo: Tìm hiểu năng lượng tái tạo', 'report', 'STEM', true, now() - interval '3 days', now() + interval '2 days', 'open'),
    (sch, tch, cls, null, 'Dự án: Trạm quan trắc thời tiết mini', 'product', 'Công nghệ', true, now() - interval '20 days', now() - interval '10 days', 'closed'),
    (sch, tch, cls, null, 'Phiếu ôn tập: Định luật bảo toàn năng lượng', 'worksheet', 'Vật lý', false, now(), now() + interval '9 days', 'draft');

  -- Bài nộp mẫu
  -- Bài kiểm tra nhanh: gần hết lớp đã nộp, đã chấm phần lớn
  select id into a from assignments where class_id = cls and title like 'Bài kiểm tra nhanh%';
  n := 0;
  for st in select id from students where class_id = cls order by student_code loop
    n := n + 1;
    if n <= 7 then
      insert into submissions (org_id, assignment_id, student_id, content, submitted_at, status, score, graded_at, graded_by)
        values (sch, a, st.id, 'Bài làm trắc nghiệm', now() - interval '2 days', case when n <= 6 then 'graded' else 'submitted' end,
                case when n <= 6 then 6 + (n % 4) end, case when n <= 6 then now() - interval '1 day' end, case when n <= 6 then tch end);
    end if;
  end loop;
  -- Phiếu quan sát: một nửa nộp, 1 bài nộp trễ
  select id into a from assignments where class_id = cls and title like 'Phiếu quan sát%';
  n := 0;
  for st in select id from students where class_id = cls order by student_code loop
    n := n + 1;
    if n <= 4 then
      insert into submissions (org_id, assignment_id, student_id, content, submitted_at)
        values (sch, a, st.id, 'Nhật ký 7 ngày kèm ảnh', case when n = 4 then now() - interval '1 day' else now() - interval '5 days' end);
    end if;
  end loop;
  -- Dự án nhóm đã đóng: cả 3 nhóm nộp, đã chấm
  select id into a from assignments where class_id = cls and title = 'Dự án: Trạm quan trắc thời tiết mini';
  insert into submissions (org_id, assignment_id, group_id, content, submitted_at, status, score, feedback, graded_at, graded_by) values
    (sch, a, g1, 'Sản phẩm + báo cáo', now() - interval '11 days', 'graded', 9, 'Mô hình chạy ổn định, trình bày tốt.', now() - interval '8 days', tch),
    (sch, a, g2, 'Sản phẩm + báo cáo', now() - interval '11 days', 'graded', 8, 'Cần hiệu chỉnh cảm biến.', now() - interval '8 days', tch),
    (sch, a, g3, 'Sản phẩm + báo cáo', now() - interval '9 days', 'graded', 7.5, 'Nộp trễ 1 ngày.', now() - interval '8 days', tch);
  -- Dự án vườn rau: 1 nhóm đã nộp bản nháp
  select id into a from assignments where class_id = cls and title = 'Dự án: Vườn rau thông minh IoT';
  insert into submissions (org_id, assignment_id, group_id, content) values (sch, a, g1, 'Bản thiết kế sơ bộ');
end $$;
