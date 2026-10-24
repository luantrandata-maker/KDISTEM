-- 086. Phân hệ 1 — Bài giảng & lớp học ảo (đợt 4)
--  • Học trực tuyến theo kế hoạch: GV được ghi danh học lần lượt các nội dung tập huấn của chương trình
--    (thứ tự chương trình › môn › nội dung). Nội dung sau chỉ mở khi nội dung trước đã hoàn thành.
--    Hoàn thành một nội dung = đã mở hết bài giảng và tài liệu + đạt bài kiểm tra (nếu nội dung có bài kiểm tra).
--  • Bài kiểm tra lấy câu hỏi từ Ngân hàng câu hỏi E-learning (053). Cấu hình nằm trong detail.test của nội dung:
--    { qids: [...], count, minutes, attempts, pass }. Đề rút ngẫu nhiên, ẩn đáp án khi phát đề, chấm khi nộp.
--  • Nộp sản phẩm cuối khoá (một sản phẩm / GV / kế hoạch): đơn vị tổ chức nhận hoặc trả lại kèm nhận xét.
--  • Lớp học ảo: buổi trực tuyến có link phòng họp (đã có), bấm "Tham gia" là tự điểm danh (085);
--    thêm link bản ghi (recording_url) để GV xem lại.
--  • Bảng mới chỉ ghi qua RPC: training_progress, training_test_attempts, training_products.
-- Cần chạy sau 085.

-- ===== 1. Bảng =====
alter table training_sessions add column if not exists recording_url text;
do $$ begin
  alter table training_sessions add constraint training_sessions_rec_check check (recording_url is null or length(recording_url) <= 1000);
exception when duplicate_object then null; end $$;

create table if not exists training_progress (
  plan_id uuid not null references training_plans(id) on delete cascade,
  unit_id uuid not null references training_program_units(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  seen text[] not null default '{}',
  best_score numeric(4,1),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (plan_id, unit_id, teacher_id)
);
create index if not exists training_progress_teacher on training_progress (teacher_id, plan_id);

create table if not exists training_test_attempts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references training_plans(id) on delete cascade,
  unit_id uuid not null references training_program_units(id) on delete cascade,
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
create index if not exists training_test_attempts_k on training_test_attempts (plan_id, unit_id, teacher_id, started_at desc);

create table if not exists training_products (
  plan_id uuid not null references training_plans(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  url text check (url is null or length(url) <= 1000),
  note text check (note is null or length(note) <= 2000),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'returned')),
  feedback text check (feedback is null or length(feedback) <= 2000),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  primary key (plan_id, teacher_id)
);

-- ===== 2. Thứ tự nội dung, điều kiện hoàn thành =====
-- Các nội dung tập huấn của kế hoạch theo thứ tự học
create or replace function public.training_plan_units(p_plan uuid)
returns table (unit_id uuid, ord int, subject text, title text, hours numeric, mode text, has_test boolean, detail jsonb, program_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id, (row_number() over (order by i.seq, sj.seq, u.seq))::int, sj.title, u.title, u.hours, u.mode, u.has_test, u.detail, u.program_id
    from training_plan_items i
    join training_program_units sj on sj.program_id = i.program_id and sj.kind = 'subject'
    join training_program_units u on u.parent_id = sj.id and u.kind = 'content'
   where i.plan_id = p_plan
   order by i.seq, sj.seq, u.seq
$$;

-- Bài kiểm tra có dùng được không (có câu hỏi) và điểm đạt
create or replace function public.training_unit_test_on(p_unit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.has_test and jsonb_array_length(coalesce(u.detail #> '{test,qids}', '[]'::jsonb)) > 0
                     from training_program_units u where u.id = p_unit), false)
$$;
create or replace function public.training_unit_pass(p_unit uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((u.detail #>> '{test,pass}')::numeric, p.pass_score, 5)
    from training_program_units u join training_programs p on p.id = u.program_id where u.id = p_unit
$$;
-- Các mục phải mở: l0, l1… (bài giảng) và d0, d1… (tài liệu)
create or replace function public.training_unit_keys(p_detail jsonb) returns text[]
language sql immutable as $$
  select coalesce(array(select 'l' || g from generate_series(0, jsonb_array_length(coalesce(p_detail -> 'lectures', '[]'::jsonb)) - 1) g), '{}')
      || coalesce(array(select 'd' || g from generate_series(0, jsonb_array_length(coalesce(p_detail -> 'docs', '[]'::jsonb)) - 1) g), '{}')
$$;

create or replace function public.training_unit_done(p_plan uuid, p_unit uuid, p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select pr.completed_at is not null from training_progress pr
                    where pr.plan_id = p_plan and pr.unit_id = p_unit and pr.teacher_id = p_teacher), false)
      or exists (select 1 from training_program_units u where u.id = p_unit
                   and cardinality(public.training_unit_keys(u.detail)) = 0 and not public.training_unit_test_on(u.id))
$$;

-- Nội dung mở khi mọi nội dung đứng trước đã hoàn thành
create or replace function public.training_unit_unlocked(p_plan uuid, p_unit uuid, p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with o as (select * from public.training_plan_units(p_plan))
  select exists (select 1 from o where o.unit_id = p_unit)
     and not exists (select 1 from o a join o b on b.unit_id = p_unit
                      where a.ord < b.ord and not public.training_unit_done(p_plan, a.unit_id, p_teacher))
$$;

-- Tính lại "hoàn thành" sau khi mở bài / làm bài kiểm tra
create or replace function public.training_progress_refresh(p_plan uuid, p_unit uuid, p_teacher uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare u training_program_units; pr training_progress; v_ok boolean;
begin
  select * into u from training_program_units where id = p_unit;
  select * into pr from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = p_teacher;
  if pr.plan_id is null then return public.training_unit_done(p_plan, p_unit, p_teacher); end if;
  if pr.completed_at is not null then return true; end if;
  v_ok := public.training_unit_keys(u.detail) <@ pr.seen
      and (not public.training_unit_test_on(p_unit) or coalesce(pr.best_score, -1) >= public.training_unit_pass(p_unit));
  if v_ok then
    update training_progress set completed_at = now(), updated_at = now()
     where plan_id = p_plan and unit_id = p_unit and teacher_id = p_teacher;
  end if;
  return v_ok;
end $$;

-- GV học được kế hoạch này không (được ghi danh, kế hoạch đã phát hành); trả về id hồ sơ GV
create or replace function public.training_learner(p_plan uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.my_teacher_id();
begin
  if v_teacher is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  if not exists (select 1 from training_enrollments e join training_plans p on p.id = e.plan_id
                  where e.plan_id = p_plan and e.teacher_id = v_teacher and p.pub_status = 'published') then
    raise exception 'Bạn không có tên trong kế hoạch tập huấn này' using errcode = '42501';
  end if;
  return v_teacher;
end $$;

-- Không phát hành chương trình có nội dung "có bài kiểm tra" mà chưa chọn câu hỏi
create or replace function public.training_programs_test_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status <> 'published' and exists (
       select 1 from training_program_units u where u.program_id = new.id and u.kind = 'content' and u.has_test
          and not public.training_unit_test_on(u.id)) then
    raise exception 'Chưa phát hành được: có nội dung "có bài kiểm tra" nhưng chưa chọn câu hỏi' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists training_programs_test_check on training_programs;
create trigger training_programs_test_check before update on training_programs for each row execute function public.training_programs_test_check();

-- Câu hỏi bài kiểm tra phải có trong ngân hàng; số câu, thời gian, số lượt, điểm đạt hợp lệ
create or replace function public.training_units_test_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t jsonb := new.detail -> 'test'; n int;
begin
  if t is null or jsonb_typeof(t) <> 'object' then return new; end if;
  if jsonb_typeof(coalesce(t -> 'qids', '[]'::jsonb)) <> 'array' then raise exception 'Danh sách câu hỏi không hợp lệ' using errcode = '22023'; end if;
  n := jsonb_array_length(coalesce(t -> 'qids', '[]'::jsonb));
  if n > 200 then raise exception 'Bài kiểm tra tối đa 200 câu' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(t -> 'qids', '[]'::jsonb)) x
              where x !~ '^[0-9a-f-]{36}$' or not exists (select 1 from question_bank q where q.id = x::uuid)) then
    raise exception 'Có câu hỏi không còn trong ngân hàng' using errcode = '22023';
  end if;
  if (t ? 'count' and jsonb_typeof(t -> 'count') <> 'null' and ((t ->> 'count')::numeric < 1 or (t ->> 'count')::numeric > greatest(n, 1)))
     or (t ? 'minutes' and jsonb_typeof(t -> 'minutes') <> 'null' and ((t ->> 'minutes')::numeric < 1 or (t ->> 'minutes')::numeric > 300))
     or (t ? 'attempts' and jsonb_typeof(t -> 'attempts') <> 'null' and ((t ->> 'attempts')::numeric < 0 or (t ->> 'attempts')::numeric > 50))
     or (t ? 'pass' and jsonb_typeof(t -> 'pass') <> 'null' and ((t ->> 'pass')::numeric < 0 or (t ->> 'pass')::numeric > 10)) then
    raise exception 'Cấu hình bài kiểm tra không hợp lệ (số câu, thời gian, số lượt hoặc điểm đạt)' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists training_units_test_guard on training_program_units;
create trigger training_units_test_guard before insert or update on training_program_units for each row execute function public.training_units_test_guard();

-- ===== 3. GV học =====
create or replace function public.training_my_courses()
returns table (plan_id uuid, plan_code text, name text, org_name text, starts_on date, ends_on date, programs text,
               units int, done int, need_product boolean, product_status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.plan_code, p.name, o.name, p.starts_on, p.ends_on,
         (select string_agg(g.title, ' · ' order by i.seq) from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p.id),
         (select count(*) from public.training_plan_units(p.id))::int,
         (select count(*) from public.training_plan_units(p.id) x where public.training_unit_done(p.id, x.unit_id, e.teacher_id))::int,
         exists (select 1 from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p.id and g.need_product),
         (select d.status from training_products d where d.plan_id = p.id and d.teacher_id = e.teacher_id)
    from training_enrollments e
    join training_plans p on p.id = e.plan_id and p.pub_status = 'published'
    left join organizations o on o.id = p.org_id
   where e.teacher_id = public.my_teacher_id()
   order by p.starts_on desc nulls last, p.name
$$;

-- Toàn bộ khoá học của GV: nội dung theo thứ tự, tiến độ, buổi học, sản phẩm. Ẩn danh sách câu hỏi.
create or replace function public.training_course(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); p training_plans; v jsonb;
begin
  select * into p from training_plans where id = p_plan;
  select jsonb_build_object(
    'plan', jsonb_build_object('id', p.id, 'code', p.plan_code, 'name', p.name, 'starts_on', p.starts_on, 'ends_on', p.ends_on,
              'org_name', (select name from organizations where id = p.org_id)),
    'programs', (select coalesce(jsonb_agg(jsonb_build_object('title', g.title, 'code', g.code, 'pass_attendance', g.pass_attendance,
              'pass_score', g.pass_score, 'need_product', g.need_product) order by i.seq), '[]'::jsonb)
              from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan),
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', x.unit_id, 'ord', x.ord, 'subject', x.subject, 'title', x.title, 'hours', x.hours, 'mode', x.mode,
              'detail', x.detail - 'test',
              'test', case when public.training_unit_test_on(x.unit_id) then jsonb_build_object(
                  'count', least(coalesce((x.detail #>> '{test,count}')::int, jsonb_array_length(x.detail #> '{test,qids}')), jsonb_array_length(x.detail #> '{test,qids}')),
                  'minutes', (x.detail #>> '{test,minutes}')::int, 'attempts', coalesce((x.detail #>> '{test,attempts}')::int, 0),
                  'pass', public.training_unit_pass(x.unit_id),
                  'used', (select count(*) from training_test_attempts a where a.plan_id = p_plan and a.unit_id = x.unit_id and a.teacher_id = v_teacher and a.submitted_at is not null),
                  'open', (select a.id from training_test_attempts a where a.plan_id = p_plan and a.unit_id = x.unit_id and a.teacher_id = v_teacher
                              and a.submitted_at is null and (a.deadline is null or a.deadline > now()) order by a.started_at desc limit 1)) end,
              'seen', coalesce(pr.seen, '{}'), 'best_score', pr.best_score,
              'done', public.training_unit_done(p_plan, x.unit_id, v_teacher),
              'unlocked', public.training_unit_unlocked(p_plan, x.unit_id, v_teacher),
              'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                  'mode', s.mode, 'location', s.location, 'meeting_url', s.meeting_url, 'recording_url', s.recording_url,
                  'closed', s.closed_at is not null, 'present', a.present) order by s.starts_at), '[]'::jsonb)
                  from training_sessions s left join training_attendance a on a.session_id = s.id and a.teacher_id = v_teacher
                 where s.plan_id = p_plan and s.unit_id = x.unit_id)
            ) order by x.ord), '[]'::jsonb)
            from public.training_plan_units(p_plan) x
            left join training_progress pr on pr.plan_id = p_plan and pr.unit_id = x.unit_id and pr.teacher_id = v_teacher),
    'attendance', (select jsonb_build_object('present', count(*) filter (where a.present), 'total', count(*))
                     from training_attendance a join training_sessions s on s.id = a.session_id
                    where s.plan_id = p_plan and a.teacher_id = v_teacher),
    'product', (select to_jsonb(d) - 'reviewed_by' from training_products d where d.plan_id = p_plan and d.teacher_id = v_teacher)
  ) into v;
  return v;
end $$;

-- Đánh dấu đã mở một bài giảng (lN) / tài liệu (dN)
create or replace function public.training_learn_mark(p_plan uuid, p_unit uuid, p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); u training_program_units;
begin
  select * into u from training_program_units where id = p_unit;
  if u.id is null or not exists (select 1 from public.training_plan_units(p_plan) x where x.unit_id = p_unit) then
    raise exception 'Nội dung không thuộc kế hoạch tập huấn này' using errcode = '22023';
  end if;
  if not (p_key = any(public.training_unit_keys(u.detail))) then raise exception 'Mục học không hợp lệ' using errcode = '22023'; end if;
  if not public.training_unit_unlocked(p_plan, p_unit, v_teacher) then
    raise exception 'Hoàn thành nội dung trước rồi mới học nội dung này' using errcode = '22023';
  end if;
  insert into training_progress (plan_id, unit_id, teacher_id, seen) values (p_plan, p_unit, v_teacher, array[p_key])
  on conflict (plan_id, unit_id, teacher_id) do update
    set seen = case when p_key = any(training_progress.seen) then training_progress.seen else training_progress.seen || p_key end, updated_at = now();
  return public.training_progress_refresh(p_plan, p_unit, v_teacher);
end $$;

-- Bắt đầu (hoặc làm tiếp) bài kiểm tra: phát đề không kèm đáp án
create or replace function public.training_test_start(p_plan uuid, p_unit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); u training_program_units; a training_test_attempts;
        v_n int; v_max int; v_min int; v_q uuid[];
begin
  select * into u from training_program_units where id = p_unit;
  if u.id is null or not exists (select 1 from public.training_plan_units(p_plan) x where x.unit_id = p_unit) then
    raise exception 'Nội dung không thuộc kế hoạch tập huấn này' using errcode = '22023';
  end if;
  if not public.training_unit_test_on(p_unit) then raise exception 'Nội dung này không có bài kiểm tra' using errcode = '22023'; end if;
  if not public.training_unit_unlocked(p_plan, p_unit, v_teacher) then
    raise exception 'Hoàn thành nội dung trước rồi mới làm bài kiểm tra này' using errcode = '22023';
  end if;
  if not (public.training_unit_keys(u.detail) <@ coalesce((select seen from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher), '{}')) then
    raise exception 'Mở hết bài giảng và tài liệu trước khi làm bài kiểm tra' using errcode = '22023';
  end if;
  select * into a from training_test_attempts where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher
     and submitted_at is null and (deadline is null or deadline > now()) order by started_at desc limit 1;
  if a.id is null then
    v_max := coalesce((u.detail #>> '{test,attempts}')::int, 0);
    if v_max > 0 and (select count(*) from training_test_attempts where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher
                        and submitted_at is not null) >= v_max then
      raise exception 'Bạn đã hết số lượt làm bài kiểm tra này' using errcode = '22023';
    end if;
    v_n := coalesce((u.detail #>> '{test,count}')::int, 200);
    v_min := (u.detail #>> '{test,minutes}')::int;
    select array_agg(q.id) into v_q from (
      select q.id from question_bank q join jsonb_array_elements_text(u.detail #> '{test,qids}') x on x::uuid = q.id
       where q.status <> 'retired' order by random() limit v_n) q;
    if v_q is null then raise exception 'Bài kiểm tra chưa có câu hỏi dùng được' using errcode = '22023'; end if;
    insert into training_test_attempts (plan_id, unit_id, teacher_id, questions, deadline)
    values (p_plan, p_unit, v_teacher, v_q, case when v_min is not null then now() + make_interval(mins => v_min) end)
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
end $$;

-- Nộp bài: chấm, lưu điểm cao nhất, tính lại hoàn thành. p_answers = { "<id câu>": [chỉ số lựa chọn] }
create or replace function public.training_test_submit(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a training_test_attempts; v_correct int; v_total int; v_score numeric; v_pass numeric; v_done boolean;
begin
  select * into a from training_test_attempts where id = p_attempt;
  if a.id is null or a.teacher_id is distinct from public.my_teacher_id() then
    raise exception 'Không tìm thấy bài làm của bạn' using errcode = '42501';
  end if;
  if a.submitted_at is not null then raise exception 'Bài này đã nộp' using errcode = '22023'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then p_answers := '{}'::jsonb; end if;
  select count(*) filter (where (select array_agg(v::int order by v::int) from jsonb_array_elements_text(
                                    case when jsonb_typeof(p_answers -> q.id::text) = 'array' then p_answers -> q.id::text else '[]'::jsonb end) v
                                  where v ~ '^\d+$')
                                 = (select array_agg(v::int order by v::int) from jsonb_array_elements_text(q.answer) v)),
         count(*)
    into v_correct, v_total
    from unnest(a.questions) o(qid) join question_bank q on q.id = o.qid;
  v_score := case when v_total > 0 then round(v_correct * 10.0 / v_total, 1) else 0 end;
  update training_test_attempts set answers = p_answers, submitted_at = now(), correct = v_correct, total = v_total, score = v_score
   where id = p_attempt;
  insert into training_progress (plan_id, unit_id, teacher_id, best_score) values (a.plan_id, a.unit_id, a.teacher_id, v_score)
  on conflict (plan_id, unit_id, teacher_id) do update
    set best_score = greatest(coalesce(training_progress.best_score, 0), v_score), updated_at = now();
  v_pass := public.training_unit_pass(a.unit_id);
  v_done := public.training_progress_refresh(a.plan_id, a.unit_id, a.teacher_id);
  return jsonb_build_object('correct', v_correct, 'total', v_total, 'score', v_score, 'pass', v_pass, 'passed', v_score >= v_pass, 'done', v_done);
end $$;

-- Nộp / nộp lại sản phẩm cuối khoá (khi chưa được nhận)
create or replace function public.training_product_submit(p_plan uuid, p_url text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan);
begin
  p_url := nullif(btrim(p_url), ''); p_note := nullif(btrim(p_note), '');
  if p_url is null and p_note is null then raise exception 'Nhập link sản phẩm hoặc mô tả' using errcode = '22023'; end if;
  if p_url is not null and p_url !~* '^https?://' then raise exception 'Link sản phẩm phải bắt đầu bằng http:// hoặc https://' using errcode = '22023'; end if;
  if exists (select 1 from training_products where plan_id = p_plan and teacher_id = v_teacher and status = 'accepted') then
    raise exception 'Sản phẩm đã được nhận, không nộp lại được' using errcode = '22023';
  end if;
  insert into training_products (plan_id, teacher_id, url, note) values (p_plan, v_teacher, p_url, p_note)
  on conflict (plan_id, teacher_id) do update
    set url = excluded.url, note = excluded.note, status = 'submitted', submitted_at = now(), reviewed_by = null, reviewed_at = null;
end $$;

-- ===== 4. Đơn vị tổ chức theo dõi =====
create or replace function public.training_product_review(p_plan uuid, p_teacher uuid, p_accept boolean, p_feedback text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không quản lý kế hoạch này' using errcode = '42501'; end if;
  if not p_accept and nullif(btrim(p_feedback), '') is null then raise exception 'Trả lại thì ghi nhận xét để GV sửa' using errcode = '22023'; end if;
  update training_products set status = case when p_accept then 'accepted' else 'returned' end, feedback = nullif(btrim(p_feedback), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where plan_id = p_plan and teacher_id = p_teacher;
  if not found then raise exception 'Giáo viên chưa nộp sản phẩm' using errcode = '22023'; end if;
  insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
  select t.org_id, t.profile_id, 'training_product',
         case when p_accept then 'Sản phẩm tập huấn đã được nhận' else 'Sản phẩm tập huấn bị trả lại' end,
         (select name from training_plans where id = p_plan) || coalesce(': ' || nullif(btrim(p_feedback), ''), ''),
         'Bài giảng tập huấn', 'teacher', p_plan
    from teachers t where t.id = p_teacher and t.profile_id is not null;
end $$;

-- Tiến độ học của từng GV trong kế hoạch: đơn vị tổ chức xem tất cả, trường xem GV của mình
create or replace function public.training_plan_progress(p_plan uuid)
returns table (teacher_id uuid, teacher_name text, org_name text, units int, done int, tests int, tests_passed int, avg_score numeric,
               present int, sessions int, product_status text, product_url text, product_note text, product_feedback text, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with us as (select * from public.training_plan_units(p_plan))
  select e.teacher_id, t.full_name, o.name,
         (select count(*) from us)::int,
         (select count(*) from us where public.training_unit_done(p_plan, us.unit_id, e.teacher_id))::int,
         (select count(*) from us where public.training_unit_test_on(us.unit_id))::int,
         (select count(*) from us join training_progress pr on pr.plan_id = p_plan and pr.unit_id = us.unit_id and pr.teacher_id = e.teacher_id
           where public.training_unit_test_on(us.unit_id) and pr.best_score >= public.training_unit_pass(us.unit_id))::int,
         (select round(avg(pr.best_score), 1) from training_progress pr where pr.plan_id = p_plan and pr.teacher_id = e.teacher_id and pr.best_score is not null),
         (select count(*) from training_attendance a join training_sessions s on s.id = a.session_id where s.plan_id = p_plan and a.teacher_id = e.teacher_id and a.present)::int,
         (select count(*) from training_attendance a join training_sessions s on s.id = a.session_id where s.plan_id = p_plan and a.teacher_id = e.teacher_id)::int,
         d.status, d.url, d.note, d.feedback,
         (select max(pr.updated_at) from training_progress pr where pr.plan_id = p_plan and pr.teacher_id = e.teacher_id)
    from training_enrollments e
    join teachers t on t.id = e.teacher_id
    left join organizations o on o.id = t.org_id
    left join training_products d on d.plan_id = p_plan and d.teacher_id = e.teacher_id
   where e.plan_id = p_plan
     and (public.training_plan_can_manage(p_plan) or (public.is_staff() and public.training_teacher_in_my_tree(e.teacher_id)))
   order by o.name, t.full_name
$$;

-- ===== 5. Quyền =====
alter table training_progress enable row level security;
alter table training_test_attempts enable row level security;
alter table training_products enable row level security;
drop policy if exists training_progress_read on training_progress;
create policy training_progress_read on training_progress for select to authenticated using (
  teacher_id = public.my_teacher_id() or public.training_plan_can_manage(plan_id)
  or (public.is_staff() and public.training_teacher_in_my_tree(teacher_id)));
drop policy if exists training_test_attempts_read on training_test_attempts;
create policy training_test_attempts_read on training_test_attempts for select to authenticated using (
  teacher_id = public.my_teacher_id() or public.training_plan_can_manage(plan_id)
  or (public.is_staff() and public.training_teacher_in_my_tree(teacher_id)));
drop policy if exists training_products_read on training_products;
create policy training_products_read on training_products for select to authenticated using (
  teacher_id = public.my_teacher_id() or public.training_plan_can_manage(plan_id)
  or (public.is_staff() and public.training_teacher_in_my_tree(teacher_id)));
grant select on training_progress, training_test_attempts, training_products to authenticated;

do $$ declare f text; begin
  foreach f in array array[
    'training_plan_units(uuid)', 'training_unit_test_on(uuid)', 'training_unit_pass(uuid)', 'training_unit_done(uuid, uuid, uuid)',
    'training_unit_unlocked(uuid, uuid, uuid)', 'training_progress_refresh(uuid, uuid, uuid)', 'training_learner(uuid)',
    'training_my_courses()', 'training_course(uuid)', 'training_learn_mark(uuid, uuid, text)', 'training_test_start(uuid, uuid)',
    'training_test_submit(uuid, jsonb)', 'training_product_submit(uuid, text, text)', 'training_product_review(uuid, uuid, boolean, text)',
    'training_plan_progress(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  -- Chỉ các RPC gọi từ giao diện; hàm nội bộ (refresh, done, unlocked…) không mở cho client
  foreach f in array array[
    'training_my_courses()', 'training_course(uuid)', 'training_learn_mark(uuid, uuid, text)', 'training_test_start(uuid, uuid)',
    'training_test_submit(uuid, jsonb)', 'training_product_submit(uuid, text, text)', 'training_product_review(uuid, uuid, boolean, text)',
    'training_plan_progress(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ===== 6. Lịch của GV: thêm link bản ghi =====
drop function if exists public.my_training_sessions();
create or replace function public.my_training_sessions()
returns table (id uuid, plan_id uuid, plan_name text, program text, provider text, title text,
               starts_at timestamptz, ends_at timestamptz, mode text, location text, meeting_url text,
               present boolean, org_name text, trainer text, need_code boolean, closed boolean,
               checked_in_at timestamptz, excuse_status text, excuse_reason text, recording_url text)
language sql stable security definer set search_path = public as $$
  select s.id, s.plan_id, p.name, p.program, p.provider, s.title, s.starts_at, s.ends_at, s.mode, s.location, s.meeting_url,
         a.present, o.name, s.trainer, (s.mode = 'offline' and exists (select 1 from training_session_codes k where k.session_id = s.id)), s.closed_at is not null,
         a.checked_in_at, a.excuse_status, a.excuse_reason, s.recording_url
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
