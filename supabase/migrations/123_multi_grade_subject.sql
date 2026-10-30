-- 123. Chọn nhiều khối, nhiều môn cho đề, khoá học và câu hỏi
--  • question_bank.grades (nhiều khối; vẫn một môn).
--  • practice_exams, courses, training_practice_exams: grades + subjects (nhiều khối, nhiều môn).
--  • Cột cũ grade / subject vẫn giữ (= khối / môn đầu tiên) để phần chưa đổi vẫn chạy; trigger đồng bộ hai chiều:
--    ứng dụng cũ ghi grade / subject thì grades / subjects đổi theo.
--  • Ma trận đề (đề cuối khoá, đề luyện tập huấn, đề luyện e-learning theo ma trận): mỗi dòng có thể ghi môn riêng
--    {subject, topic, level, count}; dòng không ghi môn rút từ mọi môn của đề.
--  • final_exam (jsonb) nhận thêm subjects / grades; exam_pick_multi rút câu theo nhiều môn, nhiều khối.
-- Cần chạy sau 122.

-- ===== 1. Cột mới + dữ liệu cũ =====
alter table question_bank add column if not exists grades int[] not null default '{}';
alter table practice_exams add column if not exists grades int[] not null default '{}',
  add column if not exists subjects text[] not null default '{}';
alter table courses add column if not exists grades int[] not null default '{}',
  add column if not exists subjects text[] not null default '{}';
alter table training_practice_exams add column if not exists grades int[] not null default '{}',
  add column if not exists subjects text[] not null default '{}';

update question_bank set grades = array[grade] where grade is not null and grades = '{}';
update practice_exams set grades = array[grade] where grade is not null and grades = '{}';
update practice_exams set subjects = array[btrim(subject)] where nullif(btrim(subject), '') is not null and subjects = '{}';
update courses set grades = array[grade] where grade is not null and grades = '{}';
update courses set subjects = array[btrim(subject)] where nullif(btrim(subject), '') is not null and subjects = '{}';
update training_practice_exams set grades = array[grade] where grade is not null and grades = '{}';
update training_practice_exams set subjects = array[btrim(subject)] where nullif(btrim(subject), '') is not null and subjects = '{}';

do $$ declare t text; begin
  foreach t in array array['question_bank', 'practice_exams', 'courses', 'training_practice_exams'] loop
    begin
      execute format('alter table %I add constraint %I check (grades <@ array[1,2,3,4,5,6,7,8,9,10,11,12] and cardinality(grades) <= 12)', t, t || '_grades_check');
    exception when duplicate_object then null; end;
  end loop;
  foreach t in array array['practice_exams', 'courses', 'training_practice_exams'] loop
    begin
      execute format('alter table %I add constraint %I check (cardinality(subjects) <= 20)', t, t || '_subjects_check');
    exception when duplicate_object then null; end;
  end loop;
end $$;
create index if not exists question_bank_grades on question_bank using gin (grades);

-- ===== 2. Đồng bộ cột cũ ↔ cột mới =====
-- Danh sách khối: bỏ trùng, sắp tăng dần. Danh sách môn: bỏ trống, bỏ trùng, giữ thứ tự chọn.
create or replace function public.norm_grades(p int[]) returns int[]
language sql immutable as $$ select coalesce(array(select distinct g from unnest(p) g where g is not null order by g), '{}') $$;
create or replace function public.norm_subjects(p text[]) returns text[]
language sql immutable as $$
  select coalesce(array(select s from (select btrim(x) s, min(n) n from unnest(p) with ordinality u(x, n) where nullif(btrim(x), '') is not null group by 1) z order by n), '{}')
$$;

create or replace function public.sync_grades() returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and cardinality(coalesce(new.grades, '{}')) = 0 and new.grade is not null)
     or (tg_op = 'UPDATE' and new.grades is not distinct from old.grades and new.grade is distinct from old.grade) then
    new.grades := case when new.grade is null then '{}' else array[new.grade] end;
  end if;
  new.grades := public.norm_grades(coalesce(new.grades, '{}'));
  new.grade := new.grades[1];
  return new;
end $$;

create or replace function public.sync_grades_subjects() returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and cardinality(coalesce(new.grades, '{}')) = 0 and new.grade is not null)
     or (tg_op = 'UPDATE' and new.grades is not distinct from old.grades and new.grade is distinct from old.grade) then
    new.grades := case when new.grade is null then '{}' else array[new.grade] end;
  end if;
  if (tg_op = 'INSERT' and cardinality(coalesce(new.subjects, '{}')) = 0 and nullif(btrim(new.subject), '') is not null)
     or (tg_op = 'UPDATE' and new.subjects is not distinct from old.subjects and new.subject is distinct from old.subject) then
    new.subjects := case when nullif(btrim(new.subject), '') is null then '{}' else array[btrim(new.subject)] end;
  end if;
  new.grades := public.norm_grades(coalesce(new.grades, '{}'));
  new.subjects := public.norm_subjects(coalesce(new.subjects, '{}'));
  new.grade := new.grades[1];
  -- Đề luyện tập huấn bắt buộc có môn: giữ môn cũ nếu danh sách trống
  new.subject := coalesce(new.subjects[1], case when tg_table_name = 'training_practice_exams' then new.subject end);
  return new;
end $$;

drop trigger if exists a_sync_grades on question_bank;
create trigger a_sync_grades before insert or update on question_bank for each row execute function public.sync_grades();
drop trigger if exists a_sync_grades_subjects on practice_exams;
create trigger a_sync_grades_subjects before insert or update on practice_exams for each row execute function public.sync_grades_subjects();
drop trigger if exists a_sync_grades_subjects on courses;
create trigger a_sync_grades_subjects before insert or update on courses for each row execute function public.sync_grades_subjects();
drop trigger if exists a_sync_grades_subjects on training_practice_exams;
create trigger a_sync_grades_subjects before insert or update on training_practice_exams for each row execute function public.sync_grades_subjects();

-- ===== 3. Câu hỏi có hợp môn / khối của đề không =====
create or replace function public.q_fits(q_subject text, q_grades int[], p_subjects text[], p_grades int[]) returns boolean
language sql immutable as $$
  select (coalesce(cardinality(p_subjects), 0) = 0 or q_subject = any(p_subjects))
     and (coalesce(cardinality(p_grades), 0) = 0 or coalesce(q_grades, '{}') && p_grades)
$$;

-- Môn / khối của cấu hình đề dạng jsonb ({subjects:[..]} hoặc {subject:".."}; {grades:[..]} hoặc {grade:n})
create or replace function public.exam_spec_subjects(p jsonb) returns text[]
language sql immutable as $$
  select case when jsonb_typeof(p -> 'subjects') = 'array' and jsonb_array_length(p -> 'subjects') > 0
              then public.norm_subjects(array(select left(x, 80) from jsonb_array_elements_text(p -> 'subjects') x limit 20))
              when nullif(btrim(p ->> 'subject'), '') is not null then array[btrim(p ->> 'subject')]
              else '{}'::text[] end
$$;
create or replace function public.exam_spec_grades(p jsonb) returns int[]
language sql immutable as $$
  select case when jsonb_typeof(p -> 'grades') = 'array' and jsonb_array_length(p -> 'grades') > 0
              then public.norm_grades(array(select x::int from jsonb_array_elements_text(p -> 'grades') x where x ~ '^\d{1,2}$' and x::int between 1 and 12))
              when (p ->> 'grade') ~ '^\d{1,2}$' then array[(p ->> 'grade')::int]
              else '{}'::int[] end
$$;

-- Ma trận: thêm kiểm tra môn của từng dòng
create or replace function public.exam_matrix_ok(p jsonb) returns boolean
language sql immutable as $$
  select p is null or (jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 50 and not exists (
    select 1 from jsonb_array_elements(p) r
     where jsonb_typeof(r) <> 'object'
        or jsonb_typeof(r -> 'count') <> 'number' or (r ->> 'count')::numeric <> floor((r ->> 'count')::numeric)
        or (r ->> 'count')::int < 1 or (r ->> 'count')::int > 200
        or length(coalesce(r ->> 'topic', '')) > 200
        or length(coalesce(r ->> 'subject', '')) > 80
        or coalesce(r ->> 'level', '') not in ('', 'nhan_biet', 'thong_hieu', 'van_dung', 'van_dung_cao')))
$$;

-- ===== 4. Rút câu theo nhiều môn, nhiều khối =====
create or replace function public.exam_pick_multi(p_org uuid, p_subjects text[], p_grades int[], p_matrix jsonb, p_qids uuid[], p_shuffle boolean)
returns uuid[] language plpgsql volatile security definer set search_path = public as $$
declare r jsonb; v uuid[] := '{}'; s text[];
begin
  if p_qids is not null and cardinality(p_qids) > 0 then
    v := array(select q.id from unnest(p_qids) with ordinality o(id, n) join question_bank q on q.id = o.id where q.status <> 'retired' order by o.n);
  end if;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_matrix) = 'array' then p_matrix else '[]'::jsonb end) loop
    s := case when nullif(btrim(r ->> 'subject'), '') is not null then array[btrim(r ->> 'subject')] else p_subjects end;
    v := v || array(select q.id from question_bank q
      where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
        and public.q_fits(q.subject, q.grades, s, p_grades)
        and (coalesce(r ->> 'topic', '') = '' or q.topic = r ->> 'topic')
        and (coalesce(r ->> 'level', '') = '' or q.level = r ->> 'level')
        and not q.id = any(v)
      order by random() limit (r ->> 'count')::int);
  end loop;
  if p_shuffle then v := array(select x from unnest(v) x order by random()); end if;
  return v;
end $$;

-- Hàm cũ (một môn, một khối) chuyển sang hàm mới
create or replace function public.exam_pick(p_org uuid, p_subject text, p_grade int, p_matrix jsonb, p_qids uuid[], p_shuffle boolean)
returns uuid[] language sql volatile security definer set search_path = public as $$
  select public.exam_pick_multi(p_org, case when nullif(btrim(p_subject), '') is null then '{}'::text[] else array[btrim(p_subject)] end,
                                case when p_grade is null then '{}'::int[] else array[p_grade] end, p_matrix, p_qids, p_shuffle)
$$;

-- Số câu sẵn có theo môn × chủ đề × mức độ (soạn ma trận nhiều môn)
create or replace function public.exam_bank_stats_multi(p_org uuid, p_subjects text[], p_grades int[] default '{}')
returns table (subject text, topic text, level text, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org))) then
    raise exception 'Không có quyền xem ngân hàng câu hỏi của đơn vị này' using errcode = '42501';
  end if;
  return query select q.subject, coalesce(q.topic, ''), q.level, count(*)::int from question_bank q
    where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
      and public.q_fits(q.subject, q.grades, p_subjects, p_grades)
    group by 1, 2, 3 order by 1, 2, 3;
end $$;

-- Hàm cũ: một khối = câu hỏi có khối đó trong danh sách khối
create or replace function public.exam_bank_stats(p_org uuid, p_subject text, p_grade int default null)
returns table (topic text, level text, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org))) then
    raise exception 'Không có quyền xem ngân hàng câu hỏi của đơn vị này' using errcode = '42501';
  end if;
  return query select coalesce(q.topic, ''), q.level, count(*)::int from question_bank q
    where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
      and (nullif(p_subject, '') is null or q.subject = p_subject) and (p_grade is null or p_grade = any(q.grades))
    group by 1, 2 order by 1, 2;
end $$;

-- ===== 5. Các chỗ rút câu dùng danh sách môn / khối =====
create or replace function public.training_final_start(p_plan uuid, p_program uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); f record; g training_programs; a training_final_attempts; v_max int; v_q uuid[];
begin
  select * into f from public.training_final_programs(p_plan, v_teacher) x where x.program_id = p_program;
  if f.program_id is null then raise exception 'Chương trình này không có đề cuối khoá cho bạn' using errcode = '22023'; end if;
  if not f.ready then raise exception 'Học xong mọi nội dung của chương trình rồi mới làm đề cuối khoá' using errcode = '22023'; end if;
  select * into g from training_programs where id = p_program;
  select * into a from training_final_attempts where plan_id = p_plan and program_id = p_program and teacher_id = v_teacher
     and submitted_at is null and (deadline is null or deadline > now()) order by started_at desc limit 1;
  if a.id is null then
    v_max := coalesce((f.exam ->> 'attempts')::int, 0);
    if v_max > 0 then v_max := v_max + coalesce((select extra_attempts from training_results where plan_id = p_plan and teacher_id = v_teacher), 0); end if;
    if v_max > 0 and (select count(*) from training_final_attempts where plan_id = p_plan and program_id = p_program and teacher_id = v_teacher
                        and submitted_at is not null) >= v_max then
      raise exception 'Bạn đã hết số lượt làm đề cuối khoá' using errcode = '22023';
    end if;
    v_q := public.exam_pick_multi(g.org_id, public.exam_spec_subjects(f.exam), public.exam_spec_grades(f.exam), f.exam -> 'matrix',
             array(select x::uuid from jsonb_array_elements_text(coalesce(f.exam -> 'qids', '[]'::jsonb)) x), coalesce((f.exam ->> 'shuffle')::boolean, true));
    if coalesce(cardinality(v_q), 0) = 0 then raise exception 'Đề cuối khoá chưa có câu hỏi dùng được' using errcode = '22023'; end if;
    insert into training_final_attempts (plan_id, program_id, teacher_id, questions, deadline)
    values (p_plan, p_program, v_teacher, v_q, case when f.exam ->> 'minutes' is not null then now() + make_interval(mins => (f.exam ->> 'minutes')::int) end)
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
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
    v_q := public.exam_pick_multi(x.org_id, x.subjects, x.grades, x.matrix, x.qids, x.shuffle);
    if coalesce(cardinality(v_q), 0) = 0 then raise exception 'Đề luyện chưa có câu hỏi dùng được' using errcode = '22023'; end if;
    insert into training_practice_attempts (exam_id, teacher_id, questions, deadline)
    values (p_exam, v_teacher, v_q, case when x.minutes is not null then now() + make_interval(mins => x.minutes) end)
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
end $$;

create or replace function public.exam_preview(p_org uuid, p_spec jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_kind text := coalesce(p_spec ->> 'kind', 'pick'); v_q uuid[] := '{}'; v_ids uuid[]; v_n int; k text; v_need int;
        v_subjects text[]; v_grades int[];
begin
  if not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org))) then
    raise exception 'Không có quyền làm thử đề của đơn vị này' using errcode = '42501';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or length(p_spec::text) > 50000 then
    raise exception 'Cấu hình đề không hợp lệ' using errcode = '22023';
  end if;
  v_subjects := public.exam_spec_subjects(p_spec); v_grades := public.exam_spec_grades(p_spec);
  v_ids := array(select x::uuid from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'qids') = 'array' then p_spec -> 'qids' else '[]'::jsonb end) x
                  where x ~* '^[0-9a-f-]{36}$' limit 500);
  if v_kind = 'sample' then
    v_n := least(coalesce(case when (p_spec ->> 'count') ~ '^\d+$' then (p_spec ->> 'count')::int end, 200), 200);
    v_q := array(select q.id from question_bank q where q.id = any(v_ids) and q.status <> 'retired' order by random() limit v_n);
  elsif v_kind = 'levels' then
    v_n := least(coalesce(case when (p_spec ->> 'count') ~ '^\d+$' then (p_spec ->> 'count')::int end, 0), 200);
    for k, v_need in select key, value::int from jsonb_each_text(case when jsonb_typeof(p_spec -> 'levels') = 'object' then p_spec -> 'levels' else '{}'::jsonb end)
                      where value ~ '^\d{1,3}$' loop
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and q.level = k and public.bank_usable(q.org_id, q.shared, p_org)
          and public.q_fits(q.subject, q.grades, v_subjects, v_grades)
          and (coalesce(jsonb_array_length(case when jsonb_typeof(p_spec -> 'topics') = 'array' then p_spec -> 'topics' end), 0) = 0
               or q.topic in (select jsonb_array_elements_text(p_spec -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_need);
    end loop;
    if cardinality(v_q) < v_n then
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
          and public.q_fits(q.subject, q.grades, v_subjects, v_grades)
          and (coalesce(jsonb_array_length(case when jsonb_typeof(p_spec -> 'topics') = 'array' then p_spec -> 'topics' end), 0) = 0
               or q.topic in (select jsonb_array_elements_text(p_spec -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_n - cardinality(v_q));
    end if;
    v_q := v_q[1:v_n];
  else
    if not public.exam_matrix_ok(p_spec -> 'matrix') then raise exception 'Ma trận đề không hợp lệ' using errcode = '22023'; end if;
    v_q := public.exam_pick_multi(p_org, v_subjects, v_grades, p_spec -> 'matrix', v_ids, coalesce((p_spec ->> 'shuffle')::boolean, false));
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind, 'answer', q.answer,
                                                       'explain', q.explain, 'topic', q.topic, 'level', q.level, 'subject', q.subject, 'grade', q.grade, 'grades', q.grades) order by o.n)
                     from unnest(v_q) with ordinality o(qid, n) join question_bank q on q.id = o.qid
                    where public.bank_usable(q.org_id, q.shared, p_org) or public.is_platform_admin() or public.can_access_org(q.org_id)), '[]'::jsonb);
end $$;

-- Đề luyện e-learning (học sinh): sửa đúng các điều kiện môn / khối trong exam_start
do $$
declare d text; d0 text;
begin
  d := pg_get_functiondef('public.exam_start(uuid)'::regprocedure); d0 := d;
  d := replace(d, '(e.subject is null or q.subject = e.subject) and (e.grade is null or q.grade = e.grade)',
                  'public.q_fits(q.subject, q.grades, e.subjects, e.grades)');
  d := replace(d, 'public.exam_pick(e.org_id, e.subject, e.grade,', 'public.exam_pick_multi(e.org_id, e.subjects, e.grades,');
  if position('e.grade is null' in d) > 0 or position('exam_pick(e.org_id, e.subject' in d) > 0 or d = d0 then
    raise exception '123: không sửa được exam_start';
  end if;
  execute d;
  -- Thống kê e-learning: lọc một khối = câu hỏi có khối đó
  d := pg_get_functiondef('public.elearning_answers(uuid, uuid, text, integer, integer)'::regprocedure); d0 := d;
  d := replace(d, '(p_grade is null or q.grade = p_grade)', '(p_grade is null or p_grade = any(q.grades))');
  if d = d0 then raise exception '123: không sửa được elearning_answers'; end if;
  execute d;
end $$;

-- ===== 6. Quyền gọi hàm =====
revoke all on function public.exam_pick_multi(uuid, text[], int[], jsonb, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.exam_pick(uuid, text, integer, jsonb, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.exam_bank_stats_multi(uuid, text[], int[]) from public, anon;
grant execute on function public.exam_bank_stats_multi(uuid, text[], int[]) to authenticated;
revoke all on function public.exam_bank_stats(uuid, text, integer) from public, anon;
grant execute on function public.exam_bank_stats(uuid, text, integer) to authenticated;
revoke all on function public.exam_preview(uuid, jsonb) from public, anon;
grant execute on function public.exam_preview(uuid, jsonb) to authenticated;
revoke all on function public.training_final_start(uuid, uuid) from public, anon;
grant execute on function public.training_final_start(uuid, uuid) to authenticated;
revoke all on function public.training_practice_start(uuid) from public, anon;
grant execute on function public.training_practice_start(uuid) to authenticated;

notify pgrst, 'reload schema';
