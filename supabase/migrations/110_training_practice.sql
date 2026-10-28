-- 110. Phân hệ 1 — Kiểm tra & luyện tập
--  • Đề luyện tập huấn (training_practice_exams): đề tự luyện cho giáo viên, không tính vào kết quả tập huấn.
--    Gắn với một chương trình tập huấn (mọi phiên bản cùng họ): giáo viên có tên trong kế hoạch đã phát hành
--    có chương trình đó thì thấy đề khi đề ở trạng thái "đang mở". Câu hỏi lấy từ Ngân hàng câu hỏi (053):
--    câu chọn sẵn + ma trận chủ đề × mức độ (109). Tuỳ chọn hiện đáp án và lời giải sau khi nộp.
--  • Lượt làm (training_practice_attempts) chỉ ghi qua RPC.
--  • Thống kê cho người quản lý: training_exam_stats() gom bài test nội dung, đề cuối khoá và đề luyện;
--    training_exam_hard() liệt kê câu hay sai của một đề.
-- Cần chạy sau 109.

-- ===== 1. Bảng =====
create table if not exists training_practice_exams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  program_id uuid not null references training_programs(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  subject text not null check (length(btrim(subject)) between 1 and 80),
  grade int check (grade between 1 and 12),
  matrix jsonb not null default '[]'::jsonb,
  qids uuid[] not null default '{}',
  minutes int check (minutes between 1 and 300),
  attempts int not null default 0 check (attempts between 0 and 50),
  pass numeric(3,1) check (pass between 0 and 10),
  shuffle boolean not null default true,
  show_answers boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  note text check (length(note) <= 2000),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_practice_exams_prog on training_practice_exams (program_id, status);

create table if not exists training_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references training_practice_exams(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  questions uuid[] not null,
  answers jsonb,
  started_at timestamptz not null default now(),
  deadline timestamptz,
  submitted_at timestamptz,
  correct int,
  total int,
  score numeric(4,1) check (score is null or score between 0 and 10)
);
create index if not exists training_practice_attempts_k on training_practice_attempts (exam_id, teacher_id, started_at desc);

-- Kiểm tra đề: ma trận hợp lệ, 1–200 câu; giữ người tạo và đơn vị
create or replace function public.training_practice_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_n int;
begin
  if not public.exam_matrix_ok(new.matrix) then raise exception 'Ma trận đề không hợp lệ' using errcode = '22023'; end if;
  v_n := public.exam_matrix_count(new.matrix) + coalesce(cardinality(new.qids), 0);
  if v_n < 1 or v_n > 200 then raise exception 'Đề luyện cần từ 1 đến 200 câu' using errcode = '22023'; end if;
  new.title := btrim(new.title); new.subject := btrim(new.subject); new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid());
  else new.created_by := old.created_by; new.org_id := old.org_id; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists training_practice_guard on training_practice_exams;
create trigger training_practice_guard before insert or update on training_practice_exams
  for each row execute function public.training_practice_guard();

-- ===== 2. Quyền =====
create or replace function public.training_practice_can_manage(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or public.training_can_write(p_org)
$$;

-- GV có tên trong kế hoạch đã phát hành có chương trình cùng họ với đề
create or replace function public.training_practice_visible(p_exam uuid, p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_teacher is not null and exists (
    select 1 from training_practice_exams x
      join training_programs g0 on g0.id = x.program_id
      join training_programs g on g.family_id = g0.family_id
      join training_plan_items i on i.program_id = g.id
      join training_plans k on k.id = i.plan_id and k.pub_status = 'published'
      join training_enrollments e on e.plan_id = k.id and e.teacher_id = p_teacher
     where x.id = p_exam and x.status = 'published')
$$;

-- Người quản lý xem được lượt làm: quản trị nền tảng, đơn vị tổ chức kế hoạch, cán bộ có GV trong cây đơn vị
create or replace function public.training_attempt_can_see(p_plan uuid, p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (p_plan is not null and public.training_plan_can_manage(p_plan))
      or (public.is_staff() and public.training_teacher_in_my_tree(p_teacher))
$$;

alter table training_practice_exams enable row level security;
alter table training_practice_attempts enable row level security;
drop policy if exists training_practice_exams_read on training_practice_exams;
create policy training_practice_exams_read on training_practice_exams for select to authenticated using (
  public.training_practice_can_manage(org_id) or public.training_practice_visible(id, public.my_teacher_id()));
drop policy if exists training_practice_exams_write on training_practice_exams;
create policy training_practice_exams_write on training_practice_exams for all to authenticated
  using (public.training_practice_can_manage(org_id)) with check (public.training_practice_can_manage(org_id));
drop policy if exists training_practice_attempts_read on training_practice_attempts;
create policy training_practice_attempts_read on training_practice_attempts for select to authenticated using (
  teacher_id = public.my_teacher_id()
  or exists (select 1 from training_practice_exams x where x.id = exam_id and public.training_practice_can_manage(x.org_id))
  or public.training_attempt_can_see(null, teacher_id));
grant select, insert, update, delete on training_practice_exams to authenticated;
grant select on training_practice_attempts to authenticated;

-- ===== 3. Giáo viên luyện tập =====
-- Các đề luyện GV thấy, kèm số lượt đã làm, điểm cao nhất, lượt đang dở
create or replace function public.training_practice_mine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id();
begin
  if v_teacher is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'subject', x.subject, 'grade', x.grade,
      'program', g.title, 'program_code', g.code, 'note', x.note,
      'count', public.exam_matrix_count(x.matrix) + cardinality(x.qids), 'minutes', x.minutes, 'attempts', x.attempts, 'pass', x.pass,
      'show_answers', x.show_answers,
      'used', (select count(*) from training_practice_attempts a where a.exam_id = x.id and a.teacher_id = v_teacher and a.submitted_at is not null),
      'best', (select max(a.score) from training_practice_attempts a where a.exam_id = x.id and a.teacher_id = v_teacher and a.submitted_at is not null),
      'last', (select a.score from training_practice_attempts a where a.exam_id = x.id and a.teacher_id = v_teacher and a.submitted_at is not null order by a.submitted_at desc limit 1),
      'open', (select a.id from training_practice_attempts a where a.exam_id = x.id and a.teacher_id = v_teacher and a.submitted_at is null
                 and (a.deadline is null or a.deadline > now()) order by a.started_at desc limit 1)) order by g.title, x.title), '[]'::jsonb)
    from training_practice_exams x join training_programs g on g.id = x.program_id
   where x.status = 'published' and public.training_practice_visible(x.id, v_teacher));
end $$;

create or replace function public.training_practice_start(p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id(); x training_practice_exams; a training_practice_attempts; v_q uuid[];
begin
  if v_teacher is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  if not public.training_practice_visible(p_exam, v_teacher) then raise exception 'Bạn không làm được đề luyện này' using errcode = '42501'; end if;
  select * into x from training_practice_exams where id = p_exam;
  select * into a from training_practice_attempts where exam_id = p_exam and teacher_id = v_teacher and submitted_at is null
     and (deadline is null or deadline > now()) order by started_at desc limit 1;
  if a.id is null then
    if x.attempts > 0 and (select count(*) from training_practice_attempts where exam_id = p_exam and teacher_id = v_teacher and submitted_at is not null) >= x.attempts then
      raise exception 'Bạn đã hết số lượt làm đề luyện này' using errcode = '22023';
    end if;
    v_q := public.exam_pick(x.org_id, x.subject, x.grade, x.matrix, x.qids, x.shuffle);
    if coalesce(cardinality(v_q), 0) = 0 then raise exception 'Đề luyện chưa có câu hỏi dùng được' using errcode = '22023'; end if;
    insert into training_practice_attempts (exam_id, teacher_id, questions, deadline)
    values (p_exam, v_teacher, v_q, case when x.minutes is not null then now() + make_interval(mins => x.minutes) end)
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
end $$;

-- Nộp bài: chấm; nếu đề cho hiện đáp án thì trả kèm đáp án và lời giải từng câu
create or replace function public.training_practice_submit(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a training_practice_attempts; x training_practice_exams; v_correct int; v_total int; v_score numeric;
begin
  select * into a from training_practice_attempts where id = p_attempt for update;
  if a.id is null or a.teacher_id is distinct from public.my_teacher_id() then
    raise exception 'Không tìm thấy bài làm của bạn' using errcode = '42501';
  end if;
  if a.submitted_at is not null then raise exception 'Bài này đã nộp' using errcode = '22023'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then p_answers := '{}'::jsonb; end if;
  if length(p_answers::text) > 50000 then raise exception 'Bài làm không hợp lệ' using errcode = '22023'; end if;
  select * into x from training_practice_exams where id = a.exam_id;
  select count(*) filter (where public.training_answer_ok(p_answers -> q.id::text, q.answer)), count(*)
    into v_correct, v_total
    from unnest(a.questions) o(qid) join question_bank q on q.id = o.qid;
  v_score := case when v_total > 0 then round(v_correct * 10.0 / v_total, 1) else 0 end;
  update training_practice_attempts set answers = p_answers, submitted_at = now(), correct = v_correct, total = v_total, score = v_score where id = p_attempt;
  return jsonb_build_object('correct', v_correct, 'total', v_total, 'score', v_score, 'pass', x.pass, 'passed', x.pass is null or v_score >= x.pass,
    'review', case when x.show_answers then (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'answer', q.answer,
        'chosen', coalesce(p_answers -> q.id::text, '[]'::jsonb), 'ok', public.training_answer_ok(p_answers -> q.id::text, q.answer), 'explain', q.explain) order by o.n), '[]'::jsonb)
      from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid) end);
end $$;

-- Một câu trả lời đúng khi tập chỉ số chọn trùng đáp án
create or replace function public.training_answer_ok(p_chosen jsonb, p_answer jsonb) returns boolean
language sql immutable set search_path = public as $$
  select coalesce((select array_agg(v::int order by v::int) from jsonb_array_elements_text(
            case when jsonb_typeof(p_chosen) = 'array' then p_chosen else '[]'::jsonb end) v where v ~ '^\d+$')
         = (select array_agg(v::int order by v::int) from jsonb_array_elements_text(p_answer) v), false)
$$;

-- ===== 4. Thống kê cho người quản lý =====
-- Mọi lượt đã nộp mà người gọi được xem: bài test nội dung (unit), đề cuối khoá (final), đề luyện (practice)
create or replace function public.training_exam_attempts_seen()
returns table (kind text, ref uuid, program_id uuid, title text, teacher_id uuid, questions uuid[], answers jsonb, score numeric, pass numeric)
language sql stable security definer set search_path = public as $$
  select 'unit', a.unit_id, u.program_id, u.title, a.teacher_id, a.questions, a.answers, a.score, public.training_unit_pass(a.unit_id)
    from training_test_attempts a join training_program_units u on u.id = a.unit_id
   where a.submitted_at is not null and public.training_attempt_can_see(a.plan_id, a.teacher_id)
  union all
  select 'final', a.program_id, a.program_id, coalesce(nullif(g.final_exam ->> 'title', ''), 'Đề cuối khoá'), a.teacher_id, a.questions, a.answers, a.score,
         (g.final_exam ->> 'pass')::numeric
    from training_final_attempts a join training_programs g on g.id = a.program_id
   where a.submitted_at is not null and public.training_attempt_can_see(a.plan_id, a.teacher_id)
  union all
  select 'practice', a.exam_id, x.program_id, x.title, a.teacher_id, a.questions, a.answers, a.score, x.pass
    from training_practice_attempts a join training_practice_exams x on x.id = a.exam_id
   where a.submitted_at is not null and (public.training_practice_can_manage(x.org_id) or public.training_attempt_can_see(null, a.teacher_id))
$$;

create or replace function public.training_exam_stats()
returns table (kind text, ref uuid, program_id uuid, title text, attempts int, teachers int, avg_score numeric, best_avg numeric, pass numeric, passed int)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.training_exam_attempts_seen()),
  b as (select s.kind, s.ref, s.teacher_id, max(s.score) as best from s group by 1, 2, 3)
  select s.kind, s.ref, min(s.program_id::text)::uuid, min(s.title), count(*)::int, count(distinct s.teacher_id)::int, round(avg(s.score), 2),
         (select round(avg(b.best), 2) from b where b.kind = s.kind and b.ref = s.ref), max(s.pass),
         (select count(*)::int from b where b.kind = s.kind and b.ref = s.ref and b.best >= coalesce(max(s.pass), 0))
    from s group by s.kind, s.ref
$$;

-- Câu hay sai của một đề: số lượt gặp, số lượt sai, tỉ lệ sai
create or replace function public.training_exam_hard(p_kind text, p_ref uuid)
returns table (question_id uuid, stem text, topic text, level text, seen int, wrong int, wrong_rate numeric)
language sql stable security definer set search_path = public as $$
  select q.id, q.stem, q.topic, q.level, count(*)::int,
         count(*) filter (where not public.training_answer_ok(s.answers -> q.id::text, q.answer))::int,
         round(100.0 * count(*) filter (where not public.training_answer_ok(s.answers -> q.id::text, q.answer)) / count(*), 1)
    from public.training_exam_attempts_seen() s cross join lateral unnest(s.questions) o(qid) join question_bank q on q.id = o.qid
   where s.kind = p_kind and s.ref = p_ref
   group by q.id, q.stem, q.topic, q.level
   order by 7 desc, 5 desc
$$;

-- ===== 5. Quyền gọi hàm =====
do $$ declare f text; begin
  foreach f in array array['training_practice_guard()', 'training_practice_can_manage(uuid)', 'training_practice_visible(uuid, uuid)',
    'training_attempt_can_see(uuid, uuid)', 'training_practice_mine()', 'training_practice_start(uuid)', 'training_practice_submit(uuid, jsonb)',
    'training_answer_ok(jsonb, jsonb)', 'training_exam_attempts_seen()', 'training_exam_stats()', 'training_exam_hard(text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  revoke all on function public.training_practice_guard() from authenticated;
  revoke all on function public.training_exam_attempts_seen() from authenticated;
  foreach f in array array['training_practice_can_manage(uuid)', 'training_practice_visible(uuid, uuid)', 'training_attempt_can_see(uuid, uuid)',
    'training_practice_mine()', 'training_practice_start(uuid)', 'training_practice_submit(uuid, jsonb)', 'training_answer_ok(jsonb, jsonb)',
    'training_exam_stats()', 'training_exam_hard(text, uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
