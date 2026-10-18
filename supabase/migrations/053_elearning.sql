-- 053: E-learning & luyện thi.
--  • Ngân hàng câu hỏi (question_bank): trường / Sở / KDI soạn, nhập Excel hoặc lưu từ Trợ lý AI. Học sinh KHÔNG đọc được bảng
--    này (có đáp án). Câu hỏi "dùng chung" của Sở / KDI hiện cho các đơn vị trực thuộc.
--  • Đề luyện (practice_exams): cố định (chọn câu) hoặc ngẫu nhiên theo môn / khối / chủ đề / mức độ; giới hạn thời gian,
--    số lượt; giao cho cả trường hoặc một số lớp; đề "dùng chung" của Sở / KDI hiện cho học sinh các trường trực thuộc.
--  • Lượt làm (exam_attempts): CSDL chọn câu, ẩn đáp án khi phát đề, chấm khi nộp; thống kê tỉ lệ đúng từng câu.
--  • Khoá học e-learning (courses, course_lessons, course_progress): bài video / đọc / liên kết / đề luyện, theo dõi tiến độ.

-- ===== 1. Ngân hàng câu hỏi =====
create table if not exists question_bank (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  created_by  uuid references profiles(id) on delete set null,
  subject     text not null check (length(btrim(subject)) between 1 and 80),
  grade       int check (grade between 1 and 12),
  topic       text check (length(topic) <= 200),
  level       text not null default 'thong_hieu' check (level in ('nhan_biet','thong_hieu','van_dung','van_dung_cao')),
  kind        text not null default 'single' check (kind in ('single','multi','truefalse')),
  stem        text not null check (length(btrim(stem)) between 3 and 4000),
  options     jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  answer      jsonb not null check (jsonb_typeof(answer) = 'array' and jsonb_array_length(answer) >= 1),
  explain     text check (length(explain) <= 4000),
  source      text not null default 'manual' check (source in ('manual','ai','import')),
  shared      boolean not null default false,
  status      text not null default 'ready' check (status in ('draft','ready','retired')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists question_bank_lookup on question_bank (org_id, subject, grade, level);

-- Đáp án phải là chỉ số hợp lệ của các lựa chọn; câu một đáp án / đúng–sai chỉ có một đáp án
create or replace function public.guard_question() returns trigger
language plpgsql set search_path = public as $$
declare v jsonb; n int := jsonb_array_length(new.options);
begin
  if new.kind = 'truefalse' then new.options := '["Đúng","Sai"]'::jsonb; n := 2; end if;
  for v in select * from jsonb_array_elements(new.answer) loop
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) or (v #>> '{}')::int < 0 or (v #>> '{}')::int >= n then
      raise exception 'Đáp án không khớp với các lựa chọn' using errcode = '22023';
    end if;
  end loop;
  if new.kind in ('single','truefalse') and jsonb_array_length(new.answer) <> 1 then raise exception 'Câu một đáp án chỉ có một đáp án đúng' using errcode = '22023'; end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.org_id := old.org_id; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists question_bank_guard on question_bank;
create trigger question_bank_guard before insert or update on question_bank for each row execute function public.guard_question();

-- Câu hỏi đơn vị p_org được dùng: của chính đơn vị, hoặc "dùng chung" của cấp trên
create or replace function public.bank_usable(p_q_org uuid, p_shared boolean, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_q_org = p_org or (p_shared and p_q_org in (
    with recursive up as (select parent_id as id from organizations where id = p_org
      union all select o.parent_id from organizations o join up on o.id = up.id where o.parent_id is not null)
    select id from up where id is not null))
$$;

-- Người soạn được sửa câu của mình; quản trị đơn vị / Sở / KDI sửa mọi câu của đơn vị
create or replace function public.can_edit_bank(p_org uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org)
    and (p_creator = auth.uid() or public.is_org_admin()))
$$;

alter table question_bank enable row level security;
drop policy if exists question_bank_read on question_bank;
create policy question_bank_read on question_bank for select to authenticated
  using (public.is_staff() and (public.can_access_org(org_id) or (shared and org_id in (select public.my_ancestor_orgs()))));
drop policy if exists question_bank_insert on question_bank;
create policy question_bank_insert on question_bank for insert to authenticated
  with check (public.is_staff() and public.can_access_org(org_id));
drop policy if exists question_bank_update on question_bank;
create policy question_bank_update on question_bank for update to authenticated
  using (public.can_edit_bank(org_id, created_by)) with check (public.can_edit_bank(org_id, created_by));
drop policy if exists question_bank_delete on question_bank;
create policy question_bank_delete on question_bank for delete to authenticated using (public.can_edit_bank(org_id, created_by));
grant select, insert, update, delete on question_bank to authenticated;

-- ===== 2. Đề luyện =====
create table if not exists practice_exams (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  created_by    uuid references profiles(id) on delete set null,
  title         text not null check (length(btrim(title)) between 1 and 200),
  description   text check (length(description) <= 2000),
  subject       text,
  grade         int check (grade between 1 and 12),
  mode          text not null default 'random' check (mode in ('fixed','random')),
  question_ids  uuid[] not null default '{}',
  criteria      jsonb not null default '{}'::jsonb,   -- {count, topics: [], levels: {nhan_biet: n, ...}}
  duration_min  int check (duration_min between 1 and 300),
  max_attempts  int not null default 0 check (max_attempts between 0 and 50),   -- 0 = không giới hạn
  show_answers  text not null default 'after_submit' check (show_answers in ('after_submit','after_close','never')),
  class_ids     uuid[],                             -- null = mọi học sinh của đơn vị (đề của trường)
  shared        boolean not null default false,     -- đề của Sở / KDI cho học sinh các trường trực thuộc
  opens_at      timestamptz not null default now(),
  closes_at     timestamptz,
  status        text not null default 'draft' check (status in ('draft','published','closed')),
  created_at    timestamptz not null default now(),
  check (closes_at is null or closes_at > opens_at),
  check (mode = 'random' or cardinality(question_ids) between 1 and 200)
);
create index if not exists practice_exams_org on practice_exams (org_id, status);

create or replace function public.guard_exam() returns trigger
language plpgsql set search_path = public as $$
declare v_count int;
begin
  if new.mode = 'random' then
    v_count := coalesce((new.criteria ->> 'count')::int, 0);
    if v_count < 1 or v_count > 200 then raise exception 'Đề ngẫu nhiên cần số câu từ 1 đến 200' using errcode = '22023'; end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); else new.created_by := old.created_by; new.org_id := old.org_id; end if;
  return new;
end $$;
drop trigger if exists practice_exams_guard on practice_exams;
create trigger practice_exams_guard before insert or update on practice_exams for each row execute function public.guard_exam();

-- Đề / khoá học có dành cho học sinh hiện tại không (đơn vị, lớp, dùng chung từ cấp trên)
create or replace function public.content_for_student(p_org uuid, p_shared boolean, p_class_ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_student() and public.my_student_id() is not null and (
    (p_org = public.my_org_id() and (p_class_ids is null or cardinality(p_class_ids) = 0 or public.my_class_id() = any(p_class_ids)))
    or (p_shared and p_org in (select public.my_ancestor_orgs())))
$$;

create or replace function public.can_manage_content(p_org uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org) and (p_creator = auth.uid() or public.is_org_admin()))
$$;

alter table practice_exams enable row level security;
drop policy if exists practice_exams_read on practice_exams;
create policy practice_exams_read on practice_exams for select to authenticated using (
  (public.is_staff() and (public.can_access_org(org_id) or (shared and org_id in (select public.my_ancestor_orgs()))))
  or (status <> 'draft' and opens_at <= now() and public.content_for_student(org_id, shared, class_ids)));
drop policy if exists practice_exams_insert on practice_exams;
create policy practice_exams_insert on practice_exams for insert to authenticated with check (public.is_staff() and public.can_access_org(org_id));
drop policy if exists practice_exams_update on practice_exams;
create policy practice_exams_update on practice_exams for update to authenticated
  using (public.can_manage_content(org_id, created_by)) with check (public.can_manage_content(org_id, created_by));
drop policy if exists practice_exams_delete on practice_exams;
create policy practice_exams_delete on practice_exams for delete to authenticated using (public.can_manage_content(org_id, created_by));
grant select, insert, update, delete on practice_exams to authenticated;

-- ===== 3. Lượt làm bài =====
create table if not exists exam_attempts (
  id            uuid primary key default gen_random_uuid(),
  exam_id       uuid not null references practice_exams(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,   -- trường của học sinh
  questions     uuid[] not null,
  answers       jsonb,
  started_at    timestamptz not null default now(),
  deadline      timestamptz,
  submitted_at  timestamptz,
  status        text not null default 'in_progress' check (status in ('in_progress','submitted')),
  correct       int,
  total         int,
  score         numeric(4,1) check (score between 0 and 10),
  late          boolean not null default false
);
create index if not exists exam_attempts_exam on exam_attempts (exam_id, student_id);
create index if not exists exam_attempts_student on exam_attempts (student_id, started_at desc);

alter table exam_attempts enable row level security;
-- Học sinh / phụ huynh / GV dạy lớp / quản lý trường xem (can_view_student); người ra đề xem lượt làm đề của mình.
-- Không ai ghi trực tiếp: chỉ qua exam_start / exam_submit.
drop policy if exists exam_attempts_read on exam_attempts;
create policy exam_attempts_read on exam_attempts for select to authenticated using (
  public.can_view_student(student_id)
  or exists (select 1 from practice_exams e where e.id = exam_id and public.is_staff() and public.can_access_org(e.org_id)));
grant select on exam_attempts to authenticated;

-- Câu hỏi phát cho học sinh: không kèm đáp án
create or replace function public.exam_paper(p_attempt exam_attempts) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
    from unnest(p_attempt.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid
$$;

create or replace function public.exam_reveal(e practice_exams) returns boolean
language sql stable as $$
  select e.show_answers = 'after_submit' or (e.show_answers = 'after_close' and (e.status = 'closed' or (e.closes_at is not null and now() > e.closes_at)))
$$;

-- Bắt đầu (hoặc làm tiếp) một lượt
create or replace function public.exam_start(p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e practice_exams; a exam_attempts; v_st uuid := public.my_student_id(); v_org uuid := public.my_org_id(); v_q uuid[]; v_n int; k text; v_need int;
begin
  if not public.is_student() or v_st is null then raise exception 'Chỉ học sinh làm đề luyện' using errcode = '42501'; end if;
  select * into e from practice_exams where id = p_exam and status = 'published' and opens_at <= now() and public.content_for_student(org_id, shared, class_ids);
  if not found then raise exception 'Không tìm thấy đề luyện dành cho em' using errcode = '42501'; end if;
  if e.closes_at is not null and now() > e.closes_at then raise exception 'Đề luyện đã đóng' using errcode = '22023'; end if;
  -- Lượt đang làm còn hạn: làm tiếp
  select * into a from exam_attempts where exam_id = e.id and student_id = v_st and status = 'in_progress' order by started_at desc limit 1;
  if found and (a.deadline is null or now() < a.deadline) then
    return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions', public.exam_paper(a), 'answers', a.answers, 'title', e.title);
  elsif found then
    perform public.exam_submit(a.id, a.answers);
  end if;
  if e.max_attempts > 0 and (select count(*) from exam_attempts where exam_id = e.id and student_id = v_st) >= e.max_attempts then
    raise exception 'Em đã hết lượt làm đề này' using errcode = '22023';
  end if;
  if e.mode = 'fixed' then
    select array_agg(q.id order by o.n) into v_q from unnest(e.question_ids) with ordinality o(qid, n) join question_bank q on q.id = o.qid where q.status <> 'retired';
  else
    v_n := (e.criteria ->> 'count')::int;
    v_q := '{}';
    -- Theo số câu từng mức độ (nếu có), phần còn lại lấy ngẫu nhiên
    for k, v_need in select key, value::int from jsonb_each_text(coalesce(e.criteria -> 'levels', '{}'::jsonb)) where value ~ '^\d+$' loop
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and q.level = k and public.bank_usable(q.org_id, q.shared, e.org_id)
          and (e.subject is null or q.subject = e.subject) and (e.grade is null or q.grade = e.grade)
          and (jsonb_array_length(coalesce(e.criteria -> 'topics', '[]')) = 0 or q.topic in (select jsonb_array_elements_text(e.criteria -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_need);
    end loop;
    if cardinality(v_q) < v_n then
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, e.org_id)
          and (e.subject is null or q.subject = e.subject) and (e.grade is null or q.grade = e.grade)
          and (jsonb_array_length(coalesce(e.criteria -> 'topics', '[]')) = 0 or q.topic in (select jsonb_array_elements_text(e.criteria -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_n - cardinality(v_q));
    end if;
    v_q := v_q[1:v_n];
  end if;
  if coalesce(cardinality(v_q), 0) = 0 then raise exception 'Đề chưa có câu hỏi phù hợp — báo thầy cô' using errcode = '22023'; end if;
  insert into exam_attempts (exam_id, student_id, org_id, questions, deadline)
    values (e.id, v_st, v_org, v_q, case when e.duration_min is not null then now() + make_interval(mins => e.duration_min) end)
    returning * into a;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions', public.exam_paper(a), 'answers', null, 'title', e.title);
end $$;

-- Nộp bài: chấm theo đáp án trong ngân hàng. p_answers: {"<id câu>": [chỉ số lựa chọn]}
create or replace function public.exam_submit(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a exam_attempts; e practice_exams; v_ok int := 0; v_total int; r record; v_given jsonb;
begin
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.student_id is distinct from public.my_student_id() then
    raise exception 'Không tìm thấy lượt làm bài' using errcode = '42501';
  end if;
  if a.status = 'submitted' then return public.exam_result(a.id); end if;
  if p_answers is not null and (jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 50000) then raise exception 'Bài làm không hợp lệ' using errcode = '22023'; end if;
  select * into e from practice_exams where id = a.exam_id;
  v_total := cardinality(a.questions);
  for r in select q.id, q.answer from question_bank q where q.id = any(a.questions) loop
    v_given := coalesce(p_answers -> r.id::text, '[]'::jsonb);
    if jsonb_typeof(v_given) = 'array'
       and (select coalesce(array_agg(x::int order by x::int), '{}') from jsonb_array_elements_text(v_given) x where x ~ '^\d+$')
         = (select array_agg(x::int order by x::int) from jsonb_array_elements_text(r.answer) x) then
      v_ok := v_ok + 1;
    end if;
  end loop;
  update exam_attempts set answers = p_answers, status = 'submitted', submitted_at = now(), correct = v_ok, total = v_total,
    score = case when v_total > 0 then round(10.0 * v_ok / v_total, 1) end,
    late = a.deadline is not null and now() > a.deadline + interval '2 minutes'
  where id = a.id;
  return public.exam_result(a.id);
end $$;

-- Kết quả một lượt (đáp án / giải thích theo chế độ của đề)
create or replace function public.exam_result(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a exam_attempts; e practice_exams; v_reveal boolean;
begin
  select * into a from exam_attempts where id = p_attempt;
  if not found or not (public.can_view_student(a.student_id) or (public.is_staff() and exists (select 1 from practice_exams x where x.id = a.exam_id and public.can_access_org(x.org_id)))) then raise exception 'Không tìm thấy lượt làm bài' using errcode = '42501'; end if;
  select * into e from practice_exams where id = a.exam_id;
  v_reveal := a.status = 'submitted' and (public.exam_reveal(e) or (public.is_staff() and public.can_access_org(e.org_id)));
  return jsonb_build_object('attempt', a.id, 'exam', e.title, 'status', a.status, 'score', a.score, 'correct', a.correct, 'total', a.total,
    'submitted_at', a.submitted_at, 'late', a.late, 'answers', a.answers, 'revealed', v_reveal,
    'questions', case when v_reveal then (select jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind,
        'answer', q.answer, 'explain', q.explain) order by o.n) from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid)
      else public.exam_paper(a) end);
end $$;

-- Thống kê đề: số học sinh, điểm TB, tỉ lệ đúng từng câu (để chỉnh câu quá dễ / quá khó)
create or replace function public.exam_stats(p_exam uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e practice_exams;
begin
  select * into e from practice_exams where id = p_exam;
  if not found or not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(e.org_id))) then
    raise exception 'Không có quyền xem thống kê đề này' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'attempts', (select count(*) from exam_attempts where exam_id = e.id and status = 'submitted'),
    'students', (select count(distinct student_id) from exam_attempts where exam_id = e.id and status = 'submitted'),
    'avg', (select round(avg(score), 2) from exam_attempts where exam_id = e.id and status = 'submitted'),
    'schools', (select count(distinct org_id) from exam_attempts where exam_id = e.id),
    'items', (select coalesce(jsonb_agg(x order by (x ->> 'rate')::numeric), '[]'::jsonb) from (
      select jsonb_build_object('id', q.id, 'stem', left(q.stem, 160), 'level', q.level, 'shown', count(*),
        'rate', round(100.0 * count(*) filter (where (select coalesce(array_agg(v::int order by v::int), '{}') from jsonb_array_elements_text(coalesce(t.answers -> q.id::text, '[]')) v where v ~ '^\d+$')
                                         = (select array_agg(v::int order by v::int) from jsonb_array_elements_text(q.answer) v)) / count(*), 0)) as x
        from exam_attempts t cross join lateral unnest(t.questions) qid join question_bank q on q.id = qid
       where t.exam_id = e.id and t.status = 'submitted' group by q.id) s));
end $$;

revoke all on function public.exam_start(uuid), public.exam_submit(uuid, jsonb), public.exam_result(uuid), public.exam_stats(uuid),
  public.exam_paper(exam_attempts), public.bank_usable(uuid, boolean, uuid), public.content_for_student(uuid, boolean, uuid[]),
  public.can_edit_bank(uuid, uuid), public.can_manage_content(uuid, uuid) from public, anon;
grant execute on function public.exam_start(uuid), public.exam_submit(uuid, jsonb), public.exam_result(uuid), public.exam_stats(uuid),
  public.bank_usable(uuid, boolean, uuid), public.content_for_student(uuid, boolean, uuid[]),
  public.can_edit_bank(uuid, uuid), public.can_manage_content(uuid, uuid) to authenticated;

-- ===== 4. Khoá học e-learning =====
create table if not exists courses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  created_by  uuid references profiles(id) on delete set null,
  title       text not null check (length(btrim(title)) between 1 and 200),
  description text check (length(description) <= 4000),
  subject     text,
  grade       int check (grade between 1 and 12),
  cover_url   text check (cover_url is null or cover_url ~* '^https://'),
  class_ids   uuid[],
  shared      boolean not null default false,
  status      text not null default 'draft' check (status in ('draft','published','archived')),
  created_at  timestamptz not null default now()
);
create table if not exists course_lessons (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete cascade,
  position     int not null default 0,
  title        text not null check (length(btrim(title)) between 1 and 200),
  kind         text not null check (kind in ('video','reading','link','exam')),
  url          text check (url is null or url ~* '^https?://'),
  body         text check (length(body) <= 20000),
  exam_id      uuid references practice_exams(id) on delete set null,
  duration_min int check (duration_min between 1 and 600),
  check (kind <> 'exam' or exam_id is not null),
  check (kind not in ('video','link') or url is not null)
);
create index if not exists course_lessons_course on course_lessons (course_id, position);
create table if not exists course_progress (
  lesson_id  uuid not null references course_lessons(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (lesson_id, student_id)
);

create or replace function public.guard_course() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); else new.created_by := old.created_by; new.org_id := old.org_id; end if;
  return new;
end $$;
drop trigger if exists courses_guard on courses;
create trigger courses_guard before insert or update on courses for each row execute function public.guard_course();

create or replace function public.course_visible(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = p_course and (
    (public.is_staff() and (public.can_access_org(c.org_id) or (c.shared and c.org_id in (select public.my_ancestor_orgs()))))
    or (c.status = 'published' and public.content_for_student(c.org_id, c.shared, c.class_ids))
    or (c.status = 'published' and exists (select 1 from students s where public.is_guardian_of(s.id)
          and (s.org_id = c.org_id or (c.shared and c.org_id in (with recursive up as (select parent_id as id from organizations where id = s.org_id
             union all select o.parent_id from organizations o join up on o.id = up.id where o.parent_id is not null) select id from up)))))))
$$;
create or replace function public.course_manageable(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = p_course and public.can_manage_content(c.org_id, c.created_by))
$$;
grant execute on function public.course_visible(uuid), public.course_manageable(uuid) to authenticated;

alter table courses enable row level security;
alter table course_lessons enable row level security;
alter table course_progress enable row level security;
drop policy if exists courses_read on courses;
create policy courses_read on courses for select to authenticated using (public.course_visible(id));
drop policy if exists courses_insert on courses;
create policy courses_insert on courses for insert to authenticated with check (public.is_staff() and public.can_access_org(org_id));
drop policy if exists courses_update on courses;
create policy courses_update on courses for update to authenticated using (public.can_manage_content(org_id, created_by)) with check (public.can_manage_content(org_id, created_by));
drop policy if exists courses_delete on courses;
create policy courses_delete on courses for delete to authenticated using (public.can_manage_content(org_id, created_by));
drop policy if exists course_lessons_read on course_lessons;
create policy course_lessons_read on course_lessons for select to authenticated using (public.course_visible(course_id));
drop policy if exists course_lessons_write on course_lessons;
create policy course_lessons_write on course_lessons for all to authenticated using (public.course_manageable(course_id)) with check (public.course_manageable(course_id));
-- Học sinh tự đánh dấu đã học bài của khoá mình xem được; GV / phụ huynh xem tiến độ (can_view_student)
drop policy if exists course_progress_read on course_progress;
create policy course_progress_read on course_progress for select to authenticated using (public.can_view_student(student_id));
drop policy if exists course_progress_mark on course_progress;
create policy course_progress_mark on course_progress for insert to authenticated
  with check (student_id = public.my_student_id() and exists (select 1 from course_lessons l where l.id = lesson_id and public.course_visible(l.course_id)));
drop policy if exists course_progress_unmark on course_progress;
create policy course_progress_unmark on course_progress for delete to authenticated using (student_id = public.my_student_id());
grant select, insert, update, delete on courses, course_lessons to authenticated;
grant select, insert, delete on course_progress to authenticated;

-- Thông báo học sinh khi đề luyện / khoá học của trường được công bố (đề dùng chung của Sở / KDI: không gửi hàng loạt)
create or replace function public.notify_elearning() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid; v_page text := 'E-learning & luyện thi';
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and (select type from organizations where id = new.org_id) = 'school' then
    for v in select s.profile_id from students s where s.org_id = new.org_id and s.profile_id is not null and s.status = 'studying'
               and (new.class_ids is null or cardinality(new.class_ids) = 0 or s.class_id = any(new.class_ids)) loop
      perform public.notify_user(v, new.org_id, 'elearning',
        case tg_table_name when 'practice_exams' then 'Đề luyện mới: ' else 'Khoá học mới: ' end || new.title, coalesce(new.subject, ''), v_page, 'student', new.id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists practice_exams_notify on practice_exams;
create trigger practice_exams_notify after insert or update of status on practice_exams for each row execute function public.notify_elearning();
drop trigger if exists courses_notify on courses;
create trigger courses_notify after insert or update of status on courses for each row execute function public.notify_elearning();
