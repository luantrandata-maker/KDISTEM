-- 109. Đề kiểm tra và Khung đánh giá
--  • Đề cuối khoá của chương trình tập huấn (training_programs.final_exam): rút câu từ Ngân hàng câu hỏi theo ma trận
--    chủ đề × mức độ × số câu (kèm câu chọn sẵn), thời gian, số lượt, điểm đạt, trộn câu. Giáo viên làm sau khi học xong
--    mọi nội dung của chương trình; lượt làm lưu ở training_final_attempts, điểm là lượt cao nhất.
--  • Khung đánh giá (training_programs.eval_frame): trọng số chuyên cần / bài test nội dung / đề cuối khoá / sản phẩm,
--    điều kiện bắt buộc để đạt, thang xếp loại (mặc định Xuất sắc ≥ 9, Giỏi ≥ 8, Khá ≥ 6,5, Đạt ≥ 5, còn lại Chưa đạt).
--    Chưa cấu hình thì dùng khung mặc định theo điều kiện đạt cũ (chuyên cần, bài test, sản phẩm).
--  • training_result_metrics tính thêm điểm từng thành phần, tổng điểm, xếp loại; gợi ý Đạt theo khung.
--    Kết luận lưu tổng điểm và xếp loại (training_results, certificates); chứng chỉ in được xếp loại.
--  • Đề kiểm tra môn học (Phân hệ 2, practice_exams): ma trận chủ đề × mức độ (criteria.matrix) và trộn câu (shuffle).
-- Cần chạy sau 108.

-- ===== 1. Cột mới =====
alter table training_programs add column if not exists final_exam jsonb, add column if not exists eval_frame jsonb;
alter table training_results add column if not exists total_score numeric(4,2), add column if not exists grade text;
alter table certificates add column if not exists total_score numeric(4,2), add column if not exists grade text;
alter table practice_exams add column if not exists shuffle boolean not null default false;
do $$ begin
  alter table training_results add constraint training_results_grade_check check (grade is null or length(grade) <= 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table certificates add constraint certificates_grade_check check (grade is null or length(grade) <= 40);
exception when duplicate_object then null; end $$;

-- ===== 2. Kiểm tra cấu hình =====
-- Ma trận đề: [{topic, level, count}]; topic / level trống = mọi chủ đề / mọi mức độ
create or replace function public.exam_matrix_ok(p jsonb) returns boolean
language sql immutable as $$
  select p is null or (jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 50 and not exists (
    select 1 from jsonb_array_elements(p) r
     where jsonb_typeof(r) <> 'object'
        or jsonb_typeof(r -> 'count') <> 'number' or (r ->> 'count')::numeric <> floor((r ->> 'count')::numeric)
        or (r ->> 'count')::int < 1 or (r ->> 'count')::int > 200
        or length(coalesce(r ->> 'topic', '')) > 200
        or coalesce(r ->> 'level', '') not in ('', 'nhan_biet', 'thong_hieu', 'van_dung', 'van_dung_cao')))
$$;
create or replace function public.exam_matrix_count(p jsonb) returns int
language sql immutable as $$
  select coalesce((select sum((r ->> 'count')::int) from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) r), 0)::int
$$;

create or replace function public.training_programs_exam_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare f jsonb := new.final_exam; e jsonb := new.eval_frame; n int; k text; w numeric := 0; x jsonb;
begin
  if tg_op = 'UPDATE' and old.status not in ('draft', 'rejected')
     and (new.final_exam, new.eval_frame) is distinct from (old.final_exam, old.eval_frame) then
    raise exception 'Chương trình tập huấn đã gửi duyệt / phát hành: tạo phiên bản mới để sửa đề kiểm tra, khung đánh giá' using errcode = '22023';
  end if;
  if f is not null and jsonb_typeof(f) = 'null' then new.final_exam := null; f := null; end if;
  if f is not null then
    if jsonb_typeof(f) <> 'object' or not public.exam_matrix_ok(f -> 'matrix')
       or jsonb_typeof(coalesce(f -> 'qids', '[]'::jsonb)) <> 'array' then
      raise exception 'Cấu hình đề cuối khoá không hợp lệ' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(f -> 'qids', '[]'::jsonb)) q
                where q !~ '^[0-9a-f-]{36}$' or not exists (select 1 from question_bank b where b.id = q::uuid)) then
      raise exception 'Có câu hỏi không còn trong ngân hàng' using errcode = '22023';
    end if;
    n := public.exam_matrix_count(f -> 'matrix') + jsonb_array_length(coalesce(f -> 'qids', '[]'::jsonb));
    if n < 1 or n > 200 then raise exception 'Đề cuối khoá cần từ 1 đến 200 câu' using errcode = '22023'; end if;
    if (f ? 'minutes' and jsonb_typeof(f -> 'minutes') <> 'null' and ((f ->> 'minutes')::numeric < 1 or (f ->> 'minutes')::numeric > 300))
       or (f ? 'attempts' and jsonb_typeof(f -> 'attempts') <> 'null' and ((f ->> 'attempts')::numeric < 0 or (f ->> 'attempts')::numeric > 50))
       or (f ? 'pass' and jsonb_typeof(f -> 'pass') <> 'null' and ((f ->> 'pass')::numeric < 0 or (f ->> 'pass')::numeric > 10))
       or (f ? 'grade' and jsonb_typeof(f -> 'grade') <> 'null' and ((f ->> 'grade')::numeric < 1 or (f ->> 'grade')::numeric > 12))
       or length(coalesce(f ->> 'subject', '')) > 80 or length(coalesce(f ->> 'title', '')) > 200 then
      raise exception 'Cấu hình đề cuối khoá không hợp lệ (thời gian, số lượt, điểm đạt, môn, khối)' using errcode = '22023';
    end if;
  end if;
  if e is not null and jsonb_typeof(e) = 'null' then new.eval_frame := null; e := null; end if;
  if e is not null then
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(coalesce(e -> 'weights', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(e -> 'req', '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(e -> 'grades', '[]'::jsonb)) <> 'array' then
      raise exception 'Khung đánh giá không hợp lệ' using errcode = '22023';
    end if;
    foreach k in array array['att', 'tests', 'final', 'product'] loop
      if e -> 'weights' ? k then
        if jsonb_typeof(e #> array['weights', k]) <> 'number' or (e #>> array['weights', k])::numeric not between 0 and 100 then
          raise exception 'Trọng số từ 0 đến 100' using errcode = '22023';
        end if;
        w := w + (e #>> array['weights', k])::numeric;
      end if;
    end loop;
    if w <= 0 then raise exception 'Khung đánh giá cần ít nhất một thành phần có trọng số' using errcode = '22023'; end if;
    if (e #> '{req,att}' is not null and jsonb_typeof(e #> '{req,att}') <> 'null' and (jsonb_typeof(e #> '{req,att}') <> 'number' or (e #>> '{req,att}')::numeric not between 0 and 100))
       or exists (select 1 from unnest(array['final', 'product', 'total']) z
                   where e #> array['req', z] is not null and jsonb_typeof(e #> array['req', z]) <> 'null'
                     and (jsonb_typeof(e #> array['req', z]) <> 'number' or (e #>> array['req', z])::numeric not between 0 and 10))
       or exists (select 1 from unnest(array['tests', 'units']) z
                   where e #> array['req', z] is not null and jsonb_typeof(e #> array['req', z]) not in ('boolean', 'null')) then
      raise exception 'Điều kiện bắt buộc không hợp lệ (chuyên cần 0–100%%, điểm 0–10)' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(e -> 'grades', '[]'::jsonb)) not between 1 and 8 then
      raise exception 'Thang xếp loại cần từ 1 đến 8 mức' using errcode = '22023';
    end if;
    for x in select * from jsonb_array_elements(e -> 'grades') loop
      if jsonb_typeof(x) <> 'object' or length(btrim(coalesce(x ->> 'label', ''))) not between 1 and 40
         or jsonb_typeof(x -> 'min') <> 'number' or (x ->> 'min')::numeric not between 0 and 10 then
        raise exception 'Mỗi mức xếp loại cần tên (tối đa 40 ký tự) và điểm từ 0 đến 10' using errcode = '22023';
      end if;
    end loop;
    if (select count(distinct (gg ->> 'min')::numeric) from jsonb_array_elements(e -> 'grades') gg) <> jsonb_array_length(e -> 'grades') then
      raise exception 'Các mức xếp loại phải có điểm khác nhau' using errcode = '22023';
    end if;
    if length(coalesce(e ->> 'fail_label', '')) > 40 then raise exception 'Tên mức chưa đạt tối đa 40 ký tự' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists training_programs_exam_guard on training_programs;
create trigger training_programs_exam_guard before insert or update on training_programs for each row execute function public.training_programs_exam_guard();

-- Phiên bản mới / nhân bản chép cả đề cuối khoá và khung đánh giá
do $$
declare d text;
begin
  d := pg_get_functiondef('public.training_program_clone(uuid,uuid,int,text)'::regprocedure);
  if position('final_exam' in d) = 0 then
    d := replace(d, 'outcomes, prereq_families)
  values', 'outcomes, prereq_families, final_exam, eval_frame)
  values');
    d := replace(d, 'v_src.outcomes, v_src.prereq_families);', 'v_src.outcomes, v_src.prereq_families, v_src.final_exam, v_src.eval_frame);');
    if position('v_src.final_exam' in d) = 0 then raise exception '109: không sửa được training_program_clone'; end if;
    execute d;
  end if;
end $$;

-- ===== 3. Rút câu theo ma trận =====
-- Câu chọn sẵn trước, rồi mỗi dòng ma trận rút ngẫu nhiên đủ số câu; trộn thứ tự nếu p_shuffle
create or replace function public.exam_pick(p_org uuid, p_subject text, p_grade int, p_matrix jsonb, p_qids uuid[], p_shuffle boolean)
returns uuid[] language plpgsql volatile security definer set search_path = public as $$
declare r jsonb; v uuid[] := '{}';
begin
  if p_qids is not null and cardinality(p_qids) > 0 then
    v := array(select q.id from unnest(p_qids) with ordinality o(id, n) join question_bank q on q.id = o.id where q.status <> 'retired' order by o.n);
  end if;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p_matrix) = 'array' then p_matrix else '[]'::jsonb end) loop
    v := v || array(select q.id from question_bank q
      where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
        and (nullif(p_subject, '') is null or q.subject = p_subject) and (p_grade is null or q.grade = p_grade)
        and (coalesce(r ->> 'topic', '') = '' or q.topic = r ->> 'topic')
        and (coalesce(r ->> 'level', '') = '' or q.level = r ->> 'level')
        and not q.id = any(v)
      order by random() limit (r ->> 'count')::int);
  end loop;
  if p_shuffle then v := array(select x from unnest(v) x order by random()); end if;
  return v;
end $$;

-- Số câu sẵn có theo chủ đề × mức độ (để soạn ma trận). Chỉ cán bộ của đơn vị.
create or replace function public.exam_bank_stats(p_org uuid, p_subject text, p_grade int default null)
returns table (topic text, level text, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org))) then
    raise exception 'Không có quyền xem ngân hàng câu hỏi của đơn vị này' using errcode = '42501';
  end if;
  return query select coalesce(q.topic, ''), q.level, count(*)::int from question_bank q
    where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
      and (nullif(p_subject, '') is null or q.subject = p_subject) and (p_grade is null or q.grade = p_grade)
    group by 1, 2 order by 1, 2;
end $$;

-- Các môn có câu hỏi dùng được (để chọn môn của đề)
create or replace function public.exam_bank_subjects(p_org uuid)
returns table (subject text, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org))) then
    raise exception 'Không có quyền xem ngân hàng câu hỏi của đơn vị này' using errcode = '42501';
  end if;
  return query select q.subject, count(*)::int from question_bank q
    where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org) group by 1 order by 1;
end $$;

-- ===== 4. Đề cuối khoá: giáo viên làm bài =====
create table if not exists training_final_attempts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references training_plans(id) on delete cascade,
  program_id uuid not null references training_programs(id) on delete cascade,
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
create index if not exists training_final_attempts_k on training_final_attempts (plan_id, program_id, teacher_id, started_at desc);
alter table training_final_attempts enable row level security;
drop policy if exists training_final_attempts_read on training_final_attempts;
create policy training_final_attempts_read on training_final_attempts for select to authenticated using (
  teacher_id = public.my_teacher_id() or public.training_plan_can_manage(plan_id)
  or (public.is_staff() and public.training_teacher_in_my_tree(teacher_id)));
grant select on training_final_attempts to authenticated;

-- Điểm đề cuối khoá (lượt cao nhất) của một GV cho một chương trình
create or replace function public.training_final_best(p_plan uuid, p_program uuid, p_teacher uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select max(score) from training_final_attempts where plan_id = p_plan and program_id = p_program and teacher_id = p_teacher and submitted_at is not null
$$;

-- Các chương trình có đề cuối khoá mà GV phải làm (GV có học ít nhất một nội dung của chương trình)
create or replace function public.training_final_programs(p_plan uuid, p_teacher uuid)
returns table (program_id uuid, title text, exam jsonb, ready boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.title, g.final_exam,
         not exists (select 1 from public.training_teacher_units(p_plan, p_teacher) x
                      where x.program_id = g.id and not public.training_unit_done(p_plan, x.unit_id, p_teacher))
    from training_plan_items i join training_programs g on g.id = i.program_id
   where i.plan_id = p_plan and g.final_exam is not null
     and exists (select 1 from public.training_teacher_units(p_plan, p_teacher) x where x.program_id = g.id)
   order by i.seq
$$;

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
    v_q := public.exam_pick(g.org_id, f.exam ->> 'subject', (f.exam ->> 'grade')::int, f.exam -> 'matrix',
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

create or replace function public.training_final_submit(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a training_final_attempts; v_correct int; v_total int; v_score numeric; v_pass numeric;
begin
  select * into a from training_final_attempts where id = p_attempt for update;
  if a.id is null or a.teacher_id is distinct from public.my_teacher_id() then
    raise exception 'Không tìm thấy bài làm của bạn' using errcode = '42501';
  end if;
  if a.submitted_at is not null then raise exception 'Bài này đã nộp' using errcode = '22023'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then p_answers := '{}'::jsonb; end if;
  if length(p_answers::text) > 50000 then raise exception 'Bài làm không hợp lệ' using errcode = '22023'; end if;
  select count(*) filter (where (select array_agg(v::int order by v::int) from jsonb_array_elements_text(
                                    case when jsonb_typeof(p_answers -> q.id::text) = 'array' then p_answers -> q.id::text else '[]'::jsonb end) v
                                  where v ~ '^\d+$')
                                 = (select array_agg(v::int order by v::int) from jsonb_array_elements_text(q.answer) v)),
         count(*)
    into v_correct, v_total
    from unnest(a.questions) o(qid) join question_bank q on q.id = o.qid;
  v_score := case when v_total > 0 then round(v_correct * 10.0 / v_total, 1) else 0 end;
  update training_final_attempts set answers = p_answers, submitted_at = now(), correct = v_correct, total = v_total, score = v_score where id = p_attempt;
  select (final_exam ->> 'pass')::numeric into v_pass from training_programs where id = a.program_id;
  return jsonb_build_object('correct', v_correct, 'total', v_total, 'score', v_score, 'pass', v_pass, 'passed', v_pass is null or v_score >= v_pass);
end $$;

-- ===== 5. Khung đánh giá =====
create or replace function public.eval_frame_default(p_att int, p_need boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'weights', jsonb_build_object('att', 20, 'tests', 30, 'final', 30, 'product', 20),
    'req', jsonb_build_object('att', p_att, 'tests', true, 'units', true, 'final', null, 'product', case when p_need then 5 end, 'total', null),
    'grades', '[{"label":"Xuất sắc","min":9},{"label":"Giỏi","min":8},{"label":"Khá","min":6.5},{"label":"Đạt","min":5}]'::jsonb,
    'fail_label', 'Chưa đạt', 'default', true)
$$;

-- Khung của kế hoạch: khung của chương trình đầu tiên (theo thứ tự) có cấu hình, không có thì khung mặc định
create or replace function public.training_eval_frame(p_plan uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select g.eval_frame from training_plan_items i join training_programs g on g.id = i.program_id
      where i.plan_id = p_plan and g.eval_frame is not null order by i.seq limit 1),
    (select public.eval_frame_default(coalesce(max(g.pass_attendance), 0), coalesce(bool_or(g.need_product), false))
       from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan))
$$;

-- Chỉ số kết quả của một GV (thay bản 087/098): giữ các khoá cũ, thêm điểm thành phần, tổng điểm, xếp loại
create or replace function public.training_result_metrics(p_plan uuid, p_teacher uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s int; v_p int; v_ex int; v_units int; v_done int; v_tests int; v_tp int; v_avg numeric; v_tavg numeric; v_pst text; v_ps numeric;
        v_att_req int; v_score_req numeric; v_need boolean; v_att numeric; ok_att boolean; ok_tests boolean; ok_units boolean; ok_prod boolean;
        fr jsonb; v_nf int; v_final numeric; v_fmin numeric; ok_final boolean; ok_total boolean;
        s_att numeric; s_tests numeric; s_prod numeric; w_att numeric; w_tests numeric; w_final numeric; w_prod numeric; w numeric; v_total numeric;
        v_grade text; v_gpass text; v_fail text; v_req jsonb; v_low text;
begin
  select count(*), count(*) filter (where a.present), count(*) filter (where a.present is not true and a.excuse_status = 'approved')
    into v_s, v_p, v_ex
    from training_attendance a join training_sessions s on s.id = a.session_id where s.plan_id = p_plan and a.teacher_id = p_teacher;
  select count(*), count(*) filter (where public.training_unit_done(p_plan, x.unit_id, p_teacher)),
         count(*) filter (where public.training_unit_test_on(x.unit_id)),
         count(*) filter (where public.training_unit_test_on(x.unit_id) and pr.best_score >= public.training_unit_pass(x.unit_id)),
         round(avg(pr.best_score) filter (where public.training_unit_test_on(x.unit_id)), 1),
         round(avg(coalesce(pr.best_score, 0)) filter (where public.training_unit_test_on(x.unit_id)), 2)
    into v_units, v_done, v_tests, v_tp, v_avg, v_tavg
    from public.training_teacher_units(p_plan, p_teacher) x
    left join training_progress pr on pr.plan_id = p_plan and pr.unit_id = x.unit_id and pr.teacher_id = p_teacher;
  select max(g.pass_attendance), max(g.pass_score), coalesce(bool_or(g.need_product), false) into v_att_req, v_score_req, v_need
    from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan;
  select d.status into v_pst from training_products d where d.plan_id = p_plan and d.teacher_id = p_teacher;
  select r.product_score into v_ps from training_results r where r.plan_id = p_plan and r.teacher_id = p_teacher;
  select count(*), round(avg(coalesce(public.training_final_best(p_plan, f.program_id, p_teacher), 0)), 2)
    into v_nf, v_final from public.training_final_programs(p_plan, p_teacher) f;
  fr := public.training_eval_frame(p_plan);
  v_req := coalesce(fr -> 'req', '{}'::jsonb);
  v_fail := coalesce(nullif(btrim(fr ->> 'fail_label'), ''), 'Chưa đạt');

  -- Vắng có phép không tính vào mẫu số
  v_att := case when v_s - v_ex > 0 then round(v_p * 100.0 / (v_s - v_ex), 1) end;
  ok_att := v_att is null or v_att >= coalesce((v_req ->> 'att')::numeric, 0);
  ok_tests := coalesce((v_req ->> 'tests')::boolean, true) is false or v_tp = v_tests;
  ok_units := coalesce((v_req ->> 'units')::boolean, true) is false or v_done = v_units;
  ok_prod := not v_need or (v_pst = 'accepted' and (v_ps is null or v_ps >= coalesce((v_req ->> 'product')::numeric, 5)));
  v_fmin := (v_req ->> 'final')::numeric;
  ok_final := v_nf = 0 or v_fmin is null or (select bool_and(coalesce(public.training_final_best(p_plan, f.program_id, p_teacher), -1) >= v_fmin)
                                               from public.training_final_programs(p_plan, p_teacher) f);

  -- Điểm thành phần (thang 10), chỉ tính thành phần có trong kế hoạch
  s_att := case when v_att is not null then round(v_att / 10, 2) end;
  s_tests := case when v_tests > 0 then v_tavg end;
  s_prod := case when v_need or v_ps is not null then coalesce(v_ps, 0) end;
  w_att := case when s_att is not null then coalesce((fr #>> '{weights,att}')::numeric, 0) else 0 end;
  w_tests := case when s_tests is not null then coalesce((fr #>> '{weights,tests}')::numeric, 0) else 0 end;
  w_final := case when v_nf > 0 then coalesce((fr #>> '{weights,final}')::numeric, 0) else 0 end;
  w_prod := case when s_prod is not null then coalesce((fr #>> '{weights,product}')::numeric, 0) else 0 end;
  w := w_att + w_tests + w_final + w_prod;
  v_total := case when w > 0 then round((w_att * coalesce(s_att, 0) + w_tests * coalesce(s_tests, 0) + w_final * coalesce(v_final, 0)
                                         + w_prod * coalesce(s_prod, 0)) / w, 2) end;
  ok_total := (v_req ->> 'total') is null or (v_total is not null and v_total >= (v_req ->> 'total')::numeric);

  -- Xếp loại theo tổng điểm; đạt mà dưới mức thấp nhất thì lấy mức thấp nhất
  select x ->> 'label' into v_gpass from jsonb_array_elements(coalesce(fr -> 'grades', '[]'::jsonb)) x
   where v_total is not null and (x ->> 'min')::numeric <= v_total order by (x ->> 'min')::numeric desc limit 1;
  select x ->> 'label' into v_low from jsonb_array_elements(coalesce(fr -> 'grades', '[]'::jsonb)) x order by (x ->> 'min')::numeric limit 1;
  v_gpass := coalesce(v_gpass, v_low, 'Đạt');
  v_grade := case when ok_att and ok_tests and ok_units and ok_prod and ok_final and ok_total then v_gpass else v_fail end;

  return jsonb_build_object('sessions', v_s, 'present', v_p, 'excused', v_ex, 'att_pct', v_att, 'att_req', coalesce((v_req ->> 'att')::numeric, 0),
    'units', v_units, 'done', v_done, 'tests', v_tests, 'tests_passed', v_tp, 'avg_score', v_avg, 'score_req', v_score_req,
    'need_product', v_need, 'product_status', v_pst,
    'finals', v_nf, 'final_score', case when v_nf > 0 then v_final end, 'final_req', v_fmin,
    'scores', jsonb_build_object('att', s_att, 'tests', s_tests, 'final', case when v_nf > 0 then v_final end, 'product', s_prod),
    'weights', jsonb_build_object('att', w_att, 'tests', w_tests, 'final', w_final, 'product', w_prod),
    'total', v_total, 'total_req', (v_req ->> 'total')::numeric, 'grade', v_grade, 'grade_if_pass', v_gpass, 'fail_label', v_fail,
    'ok_att', ok_att, 'ok_tests', ok_tests, 'ok_units', ok_units, 'ok_product', ok_prod, 'ok_final', ok_final, 'ok_total', ok_total,
    'suggest', case when ok_att and ok_tests and ok_units and ok_prod and ok_final and ok_total then 'pass' else 'fail' end);
end $$;

-- Kết luận: lưu tổng điểm và xếp loại; chứng chỉ mang theo
create or replace function public.training_cert_sync(p_plan uuid, p_teacher uuid, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tpl uuid; r training_results;
begin
  select * into r from training_results where plan_id = p_plan and teacher_id = p_teacher;
  if p_result = 'pass' then
    if not exists (select 1 from certificates where plan_id = p_plan and teacher_id = p_teacher and status <> 'revoked') then
      select t.org_id into v_org from teachers t where t.id = p_teacher;
      select coalesce((select g.cert_template_id from training_plan_items i join training_programs g on g.id = i.program_id
                        where i.plan_id = p_plan and g.cert_template_id is not null order by i.seq limit 1),
                      (select id from certificate_templates where is_default limit 1)) into v_tpl;
      insert into certificates (org_id, teacher_id, plan_id, status, template_id, hours, program_titles, total_score, grade)
      select v_org, p_teacher, p_plan, 'pending', v_tpl, p.hours,
             (select string_agg(g.title, ' · ' order by i.seq) from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan),
             r.total_score, r.grade
        from training_plans p where p.id = p_plan;
    else
      update certificates set total_score = r.total_score, grade = r.grade
       where plan_id = p_plan and teacher_id = p_teacher and status <> 'revoked';
    end if;
  else
    delete from certificates where plan_id = p_plan and teacher_id = p_teacher and status = 'pending';
    update certificates set status = 'revoked', revoked_at = now(), revoked_reason = 'Kết quả tập huấn đổi thành chưa đạt'
     where plan_id = p_plan and teacher_id = p_teacher and status = 'issued';
  end if;
end $$;

create or replace function public.training_result_set(p_plan uuid, p_teacher uuid, p_result text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_m jsonb;
begin
  perform public.training_result_check(p_plan, p_teacher);
  if p_result not in ('pending', 'pass', 'fail') then raise exception 'Kết luận không hợp lệ' using errcode = '22023'; end if;
  p_reason := nullif(btrim(p_reason), '');
  v_m := public.training_result_metrics(p_plan, p_teacher);
  if p_result = 'fail' and p_reason is null then raise exception 'Chưa đạt thì ghi lý do' using errcode = '22023'; end if;
  if p_result = 'pass' and v_m ->> 'suggest' <> 'pass' and p_reason is null then
    raise exception 'Giáo viên chưa đủ điều kiện: ghi lý do nếu vẫn kết luận Đạt' using errcode = '22023';
  end if;
  insert into training_results (plan_id, teacher_id, result, reason, decided_by, decided_at, total_score, grade)
  values (p_plan, p_teacher, p_result, p_reason, case when p_result <> 'pending' then auth.uid() end, case when p_result <> 'pending' then now() end,
          case when p_result <> 'pending' then (v_m ->> 'total')::numeric end,
          case p_result when 'pass' then v_m ->> 'grade_if_pass' when 'fail' then v_m ->> 'fail_label' end)
  on conflict (plan_id, teacher_id) do update set result = excluded.result, reason = excluded.reason,
    decided_by = excluded.decided_by, decided_at = excluded.decided_at, total_score = excluded.total_score, grade = excluded.grade, updated_at = now();
  perform public.training_cert_sync(p_plan, p_teacher, p_result);
  if p_result <> 'pending' then
    insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
    select t.org_id, t.profile_id, 'training_result',
           case when p_result = 'pass' then 'Bạn đạt khoá tập huấn' || coalesce(' · xếp loại ' || (v_m ->> 'grade_if_pass'), '') else 'Kết quả tập huấn: chưa đạt' end,
           (select name from training_plans where id = p_plan) || coalesce(': ' || p_reason, ''),
           'Bài giảng tập huấn', 'teacher', p_plan
      from teachers t where t.id = p_teacher and t.profile_id is not null;
  end if;
end $$;

create or replace function public.training_cert_payload(c certificates) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status, 'issued_on', c.issued_on, 'expires_on', c.expires_on,
    'revoked_reason', c.revoked_reason, 'token', c.verify_token, 'hours', c.hours, 'programs', c.program_titles,
    'score', c.total_score, 'grade', c.grade,
    'teacher', t.full_name, 'school', o.name, 'plan', p.name, 'plan_code', p.plan_code, 'plan_org', po.name,
    'template', (select to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' from certificate_templates x where x.id = c.template_id))
  from teachers t
  left join organizations o on o.id = t.org_id
  left join training_plans p on p.id = c.plan_id
  left join organizations po on po.id = p.org_id
  where t.id = c.teacher_id
$$;

-- Khoá học của GV: đề cuối khoá và kết quả theo khung (gọi kèm training_course)
create or replace function public.training_course_finals(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); v_extra int;
begin
  v_extra := coalesce((select extra_attempts from training_results where plan_id = p_plan and teacher_id = v_teacher), 0);
  return jsonb_build_object(
    'finals', (select coalesce(jsonb_agg(jsonb_build_object('program_id', f.program_id, 'title', coalesce(nullif(f.exam ->> 'title', ''), 'Đề cuối khoá · ' || f.title),
        'count', public.exam_matrix_count(f.exam -> 'matrix') + jsonb_array_length(coalesce(f.exam -> 'qids', '[]'::jsonb)),
        'minutes', (f.exam ->> 'minutes')::int, 'pass', (f.exam ->> 'pass')::numeric,
        'attempts', case when coalesce((f.exam ->> 'attempts')::int, 0) > 0 then (f.exam ->> 'attempts')::int + v_extra else 0 end,
        'used', (select count(*) from training_final_attempts a where a.plan_id = p_plan and a.program_id = f.program_id and a.teacher_id = v_teacher and a.submitted_at is not null),
        'best', public.training_final_best(p_plan, f.program_id, v_teacher), 'ready', f.ready,
        'open', (select a.id from training_final_attempts a where a.plan_id = p_plan and a.program_id = f.program_id and a.teacher_id = v_teacher
                    and a.submitted_at is null and (a.deadline is null or a.deadline > now()) order by a.started_at desc limit 1))), '[]'::jsonb)
      from public.training_final_programs(p_plan, v_teacher) f),
    'frame', public.training_eval_frame(p_plan),
    'metrics', public.training_result_metrics(p_plan, v_teacher));
end $$;

-- Bảng điểm đề cuối khoá của kế hoạch (người tổ chức)
create or replace function public.training_plan_final_scores(p_plan uuid)
returns table (teacher_id uuid, program_id uuid, best numeric, attempts int)
language sql stable security definer set search_path = public as $$
  select a.teacher_id, a.program_id, max(a.score), count(*)::int from training_final_attempts a
   where a.plan_id = p_plan and a.submitted_at is not null
     and (public.training_plan_can_manage(p_plan) or public.training_can_view_teacher(a.teacher_id))
   group by 1, 2
$$;

-- ===== 6. Đề kiểm tra môn học (Phân hệ 2): ma trận + trộn câu =====
create or replace function public.guard_exam() returns trigger
language plpgsql set search_path = public as $$
declare v_count int;
begin
  if not public.exam_matrix_ok(new.criteria -> 'matrix') then raise exception 'Ma trận đề không hợp lệ' using errcode = '22023'; end if;
  if jsonb_typeof(new.criteria -> 'matrix') = 'array' and jsonb_array_length(new.criteria -> 'matrix') > 0 then
    new.criteria := jsonb_set(new.criteria, '{count}', to_jsonb(public.exam_matrix_count(new.criteria -> 'matrix')));
  end if;
  if new.mode = 'random' then
    v_count := coalesce((new.criteria ->> 'count')::int, 0);
    if v_count < 1 or v_count > 200 then raise exception 'Đề ngẫu nhiên cần số câu từ 1 đến 200' using errcode = '22023'; end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); else new.created_by := old.created_by; new.org_id := old.org_id; end if;
  return new;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.exam_start(uuid)'::regprocedure);
  if position('exam_pick' in d) = 0 then
    d := replace(d, '  else
    v_n := (e.criteria ->> ''count'')::int;
    v_q := ''{}'';',
'  elsif jsonb_typeof(e.criteria -> ''matrix'') = ''array'' and jsonb_array_length(e.criteria -> ''matrix'') > 0 then
    v_q := public.exam_pick(e.org_id, e.subject, e.grade, e.criteria -> ''matrix'', null, false);
  else
    v_n := (e.criteria ->> ''count'')::int;
    v_q := ''{}'';');
    d := replace(d, '  if coalesce(cardinality(v_q), 0) = 0 then raise exception ''Đề chưa có câu hỏi phù hợp',
'  if e.shuffle then v_q := array(select x from unnest(v_q) x order by random()); end if;
  if coalesce(cardinality(v_q), 0) = 0 then raise exception ''Đề chưa có câu hỏi phù hợp');
    if position('exam_pick' in d) = 0 or position('e.shuffle' in d) = 0 then raise exception '109: không sửa được exam_start'; end if;
    execute d;
  end if;
end $$;

-- ===== 7. Quyền gọi hàm =====
do $$ declare f text; begin
  foreach f in array array['exam_pick(uuid, text, integer, jsonb, uuid[], boolean)', 'exam_bank_stats(uuid, text, integer)', 'exam_bank_subjects(uuid)',
    'training_final_best(uuid, uuid, uuid)', 'training_final_programs(uuid, uuid)', 'training_final_start(uuid, uuid)', 'training_final_submit(uuid, jsonb)',
    'training_eval_frame(uuid)', 'training_course_finals(uuid)', 'training_plan_final_scores(uuid)', 'training_programs_exam_guard()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  revoke all on function public.exam_pick(uuid, text, integer, jsonb, uuid[], boolean) from authenticated;
  revoke all on function public.training_final_programs(uuid, uuid) from authenticated;
  revoke all on function public.training_final_best(uuid, uuid, uuid) from authenticated;
  revoke all on function public.training_programs_exam_guard() from authenticated;
  foreach f in array array['exam_bank_stats(uuid, text, integer)', 'exam_bank_subjects(uuid)', 'training_final_start(uuid, uuid)',
    'training_final_submit(uuid, jsonb)', 'training_eval_frame(uuid)', 'training_course_finals(uuid)', 'training_plan_final_scores(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
