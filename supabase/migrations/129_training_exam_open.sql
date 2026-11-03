-- 129. Tập huấn: hai cách làm bài kiểm tra.
--  • Tự học: giáo viên học nội dung có sẵn rồi tự làm bài, nộp bài lúc nào cũng được (như trước).
--  • Giảng viên mở đề: đề đã có trong chương trình, nhưng giáo viên chỉ vào làm được khi giảng viên (đơn vị tổ chức) bấm "Mở đề",
--    thường trong hoặc sau buổi dạy. Mở cho tất cả học viên của kế hoạch hoặc chỉ học viên có mặt ở buổi đó; đặt giờ đóng hoặc bấm "Đóng đề".
--    Khi đề đang mở, giáo viên không cần mở hết bài giảng / học xong nội dung trước (giảng viên đã dạy trên lớp).
--  • Chọn cách làm bài theo từng bài: detail.test.mode của nội dung, final_exam.mode của đề cuối khoá ('trainer' = giảng viên mở đề).
--    Hoặc cho cả khoá: training_plans.exam_mode = 'self' (tất cả tự làm) / 'trainer' (tất cả do giảng viên mở) / 'content' (theo từng bài, mặc định).
--  • Bảng training_exam_windows lưu mỗi lần mở đề. RPC:
--      training_exam_open / training_exam_close   mở, đóng đề (đơn vị lập kế hoạch hoặc đơn vị tổ chức buổi)
--      training_exam_board                         giảng viên xem các đề của kế hoạch, đề nào đang mở, ai đang làm, đã nộp, điểm
--      training_exam_gates                         giáo viên xem bài nào của mình do giảng viên mở và đang mở hay chưa
-- Cần chạy sau 128.

-- ===== 1. Cách làm bài của kế hoạch =====
alter table training_plans add column if not exists exam_mode text not null default 'content';
do $$ begin
  alter table training_plans add constraint training_plans_exam_mode_check check (exam_mode in ('content', 'self', 'trainer'));
exception when duplicate_object then null; end $$;

-- ===== 2. Các lần mở đề =====
create table if not exists training_exam_windows (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references training_plans(id) on delete cascade,
  unit_id uuid references training_program_units(id) on delete cascade,     -- bài kiểm tra của nội dung
  program_id uuid references training_programs(id) on delete cascade,       -- hoặc đề cuối khoá của chương trình
  session_id uuid references training_sessions(id) on delete cascade,       -- buổi mở đề (nếu mở từ buổi)
  audience text not null default 'all' check (audience in ('all', 'session')),
  opened_by uuid default auth.uid() references profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closes_at timestamptz,
  closed_at timestamptz,
  check ((unit_id is null) <> (program_id is null)),
  check (audience = 'all' or session_id is not null),
  check (closes_at is null or closes_at > opened_at)
);
create index if not exists training_exam_windows_plan on training_exam_windows (plan_id, opened_at desc);
alter table training_exam_windows enable row level security;
drop policy if exists training_exam_windows_read on training_exam_windows;
create policy training_exam_windows_read on training_exam_windows for select to authenticated
  using (public.training_plan_can_manage(plan_id) or (session_id is not null and public.training_session_can_manage(session_id)));
revoke all on training_exam_windows from anon;
grant select on training_exam_windows to authenticated;   -- ghi chỉ qua RPC

-- Cách làm bài của một đề trong kế hoạch: 'trainer' hoặc 'self'
create or replace function public.training_exam_mode(p_plan uuid, p_unit uuid, p_program uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p.exam_mode when 'self' then 'self' when 'trainer' then 'trainer'
    else case when (case when p_unit is not null then (select u.detail #>> '{test,mode}' from training_program_units u where u.id = p_unit)
                         else (select g.final_exam ->> 'mode' from training_programs g where g.id = p_program) end) = 'trainer'
              then 'trainer' else 'self' end end
    from training_plans p where p.id = p_plan
$$;

-- Lần mở đề đang hiệu lực mà giáo viên vào được (mở cho cả kế hoạch, hoặc GV có mặt ở buổi mở đề)
create or replace function public.training_exam_window_for(p_plan uuid, p_unit uuid, p_program uuid, p_teacher uuid)
returns training_exam_windows
language sql stable security definer set search_path = public as $$
  select w.* from training_exam_windows w
   where w.plan_id = p_plan and w.unit_id is not distinct from p_unit and w.program_id is not distinct from p_program
     and w.closed_at is null and (w.closes_at is null or w.closes_at > now())
     and (w.audience = 'all' or exists (select 1 from training_attendance a where a.session_id = w.session_id and a.teacher_id = p_teacher and a.present))
   order by w.opened_at desc limit 1
$$;

-- Kiểm tra trước khi giáo viên vào làm: true = đề do giảng viên mở và đang mở cho GV này (bỏ qua điều kiện học trước);
-- false = tự học (giữ điều kiện cũ); báo lỗi nếu đề do giảng viên mở mà chưa mở.
create or replace function public.training_exam_gate(p_plan uuid, p_unit uuid, p_program uuid, p_teacher uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare w training_exam_windows;
begin
  if public.training_exam_mode(p_plan, p_unit, p_program) <> 'trainer' then return false; end if;
  w := public.training_exam_window_for(p_plan, p_unit, p_program, p_teacher);
  if w.id is null then
    if exists (select 1 from training_exam_windows x where x.plan_id = p_plan and x.unit_id is not distinct from p_unit and x.program_id is not distinct from p_program
                  and x.closed_at is null and (x.closes_at is null or x.closes_at > now()) and x.audience = 'session') then
      raise exception 'Đề đang mở cho học viên có mặt ở buổi học. Hãy điểm danh buổi đó trước' using errcode = '22023';
    end if;
    raise exception 'Bài này do giảng viên mở đề. Chờ giảng viên mở đề rồi vào làm' using errcode = '22023';
  end if;
  return true;
end $$;

-- ===== 3. Vào làm bài: thêm kiểm tra mở đề =====
create or replace function public.training_test_start(p_plan uuid, p_unit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); u training_program_units; a training_test_attempts;
        v_n int; v_max int; v_min int; v_q uuid[]; v_led boolean; w training_exam_windows;
begin
  select * into u from training_program_units where id = p_unit;
  if u.id is null or not exists (select 1 from public.training_plan_units(p_plan) x where x.unit_id = p_unit) then
    raise exception 'Nội dung không thuộc kế hoạch tập huấn này' using errcode = '22023';
  end if;
  if not public.training_unit_test_on(p_unit) then raise exception 'Nội dung này không có bài kiểm tra' using errcode = '22023'; end if;
  if public.training_unit_test_kind(u.detail) = 'link' then raise exception 'Bài kiểm tra này làm qua link' using errcode = '22023'; end if;
  v_led := public.training_exam_gate(p_plan, p_unit, null, v_teacher);
  if not v_led and not public.training_unit_unlocked(p_plan, p_unit, v_teacher) then
    raise exception 'Hoàn thành nội dung trước rồi mới làm bài kiểm tra này' using errcode = '22023';
  end if;
  if not v_led and not (public.training_unit_keys(u.detail) <@ coalesce((select seen from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher), '{}')) then
    raise exception 'Mở hết bài giảng và tài liệu trước khi làm bài kiểm tra' using errcode = '22023';
  end if;
  select * into a from training_test_attempts where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher
     and submitted_at is null and (deadline is null or deadline > now()) order by started_at desc limit 1;
  if a.id is null then
    v_max := coalesce((u.detail #>> '{test,attempts}')::int, 0);
    if v_max > 0 then v_max := v_max + coalesce((select extra_attempts from training_results where plan_id = p_plan and teacher_id = v_teacher), 0); end if;
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
    if v_led then w := public.training_exam_window_for(p_plan, p_unit, null, v_teacher); end if;
    insert into training_test_attempts (plan_id, unit_id, teacher_id, questions, deadline)
    values (p_plan, p_unit, v_teacher, v_q,
            nullif(least(coalesce(now() + make_interval(mins => v_min), 'infinity'::timestamptz), coalesce(w.closes_at, 'infinity'::timestamptz)), 'infinity'::timestamptz))
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
end $$;

create or replace function public.training_test_link_open(p_plan uuid, p_unit uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); u training_program_units; v_led boolean;
begin
  select * into u from training_program_units where id = p_unit;
  if u.id is null or not exists (select 1 from public.training_teacher_units(p_plan, v_teacher) x where x.unit_id = p_unit) then
    raise exception 'Nội dung không thuộc kế hoạch tập huấn của bạn' using errcode = '22023';
  end if;
  if not public.training_unit_test_on(p_unit) or public.training_unit_test_kind(u.detail) <> 'link' then
    raise exception 'Nội dung này không có bài kiểm tra qua link' using errcode = '22023';
  end if;
  v_led := public.training_exam_gate(p_plan, p_unit, null, v_teacher);
  if not v_led and not public.training_unit_unlocked(p_plan, p_unit, v_teacher) then
    raise exception 'Hoàn thành nội dung trước rồi mới làm bài kiểm tra này' using errcode = '22023';
  end if;
  if not v_led and not (public.training_unit_keys(u.detail) <@ coalesce((select seen from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher), '{}')) then
    raise exception 'Mở hết bài giảng và tài liệu trước khi làm bài kiểm tra' using errcode = '22023';
  end if;
  insert into training_progress (plan_id, unit_id, teacher_id, test_opened_at) values (p_plan, p_unit, v_teacher, now())
  on conflict (plan_id, unit_id, teacher_id) do update
    set test_opened_at = coalesce(training_progress.test_opened_at, now()), updated_at = now();
  perform public.training_progress_refresh(p_plan, p_unit, v_teacher);
  return btrim(u.detail #>> '{test,url}');
end $$;

create or replace function public.training_final_start(p_plan uuid, p_program uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); f record; g training_programs; a training_final_attempts; v_max int; v_q uuid[];
        v_led boolean; w training_exam_windows;
begin
  select * into f from public.training_final_programs(p_plan, v_teacher) x where x.program_id = p_program;
  if f.program_id is null then raise exception 'Chương trình này không có đề cuối khoá cho bạn' using errcode = '22023'; end if;
  v_led := public.training_exam_gate(p_plan, null, p_program, v_teacher);
  if not v_led and not f.ready then raise exception 'Học xong mọi nội dung của chương trình rồi mới làm đề cuối khoá' using errcode = '22023'; end if;
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
    if v_led then w := public.training_exam_window_for(p_plan, null, p_program, v_teacher); end if;
    insert into training_final_attempts (plan_id, program_id, teacher_id, questions, deadline)
    values (p_plan, p_program, v_teacher, v_q,
            nullif(least(coalesce(now() + make_interval(mins => (f.exam ->> 'minutes')::int), 'infinity'::timestamptz), coalesce(w.closes_at, 'infinity'::timestamptz)), 'infinity'::timestamptz))
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
end $$;

-- Bài do giảng viên mở đề: làm đạt là xong nội dung, không cần mở hết bài giảng trực tuyến (giảng viên đã dạy trên lớp)
create or replace function public.training_progress_refresh(p_plan uuid, p_unit uuid, p_teacher uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare u training_program_units; pr training_progress; v_ok boolean;
begin
  select * into u from training_program_units where id = p_unit;
  select * into pr from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = p_teacher;
  if pr.plan_id is null then return public.training_unit_done(p_plan, p_unit, p_teacher); end if;
  if pr.completed_at is not null then return true; end if;
  v_ok := (public.training_unit_keys(u.detail) <@ pr.seen
           or (public.training_unit_test_on(p_unit) and public.training_exam_mode(p_plan, p_unit, null) = 'trainer'))
      and (not public.training_unit_test_on(p_unit)
           or coalesce(pr.best_score, -1) >= public.training_unit_pass(p_unit)
           or (public.training_unit_test_kind(u.detail) = 'link' and pr.test_opened_at is not null));
  if v_ok then
    update training_progress set completed_at = now(), updated_at = now()
     where plan_id = p_plan and unit_id = p_unit and teacher_id = p_teacher;
  end if;
  return v_ok;
end $$;

-- ===== 4. Giảng viên mở / đóng đề =====
create or replace function public.training_exam_can(p_plan uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.training_plan_can_manage(p_plan)
      or (p_session is not null and exists (select 1 from training_sessions s where s.id = p_session and s.plan_id = p_plan)
          and public.training_session_can_manage(p_session))
$$;

create or replace function public.training_exam_open(p_plan uuid, p_unit uuid, p_program uuid, p_session uuid default null,
  p_audience text default 'all', p_minutes int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_pub text;
begin
  if not public.training_exam_can(p_plan, p_session) then raise exception 'Bạn không có quyền mở đề của kế hoạch này' using errcode = '42501'; end if;
  select pub_status into v_pub from training_plans where id = p_plan;
  if v_pub is distinct from 'published' then raise exception 'Kế hoạch chưa phát hành' using errcode = '22023'; end if;
  if (p_unit is null) = (p_program is null) then raise exception 'Chọn một đề để mở' using errcode = '22023'; end if;
  if p_unit is not null and not exists (select 1 from public.training_plan_units(p_plan) x where x.unit_id = p_unit and public.training_unit_test_on(x.unit_id)) then
    raise exception 'Nội dung này không có bài kiểm tra trong kế hoạch' using errcode = '22023';
  end if;
  if p_program is not null and not exists (select 1 from training_plan_items i join training_programs g on g.id = i.program_id
                                             where i.plan_id = p_plan and g.id = p_program and g.final_exam is not null) then
    raise exception 'Chương trình này không có đề cuối khoá trong kế hoạch' using errcode = '22023';
  end if;
  if public.training_exam_mode(p_plan, p_unit, p_program) <> 'trainer' then
    raise exception 'Đề này để giáo viên tự làm, không cần mở đề' using errcode = '22023';
  end if;
  if coalesce(p_audience, 'all') not in ('all', 'session') then raise exception 'Đối tượng làm bài không hợp lệ' using errcode = '22023'; end if;
  if p_audience = 'session' and p_session is null then raise exception 'Chọn buổi học để mở đề cho học viên có mặt' using errcode = '22023'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 10080) then raise exception 'Thời gian mở đề không hợp lệ' using errcode = '22023'; end if;
  -- Mở lại thì đóng lần mở trước của đề này
  update training_exam_windows set closed_at = now()
   where plan_id = p_plan and unit_id is not distinct from p_unit and program_id is not distinct from p_program
     and closed_at is null and (closes_at is null or closes_at > now());
  insert into training_exam_windows (plan_id, unit_id, program_id, session_id, audience, closes_at)
  values (p_plan, p_unit, p_program, p_session, coalesce(p_audience, 'all'), case when p_minutes is not null then now() + make_interval(mins => p_minutes) end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.training_exam_close(p_window uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w training_exam_windows;
begin
  select * into w from training_exam_windows where id = p_window for update;
  if w.id is null or not public.training_exam_can(w.plan_id, w.session_id) then raise exception 'Không tìm thấy lần mở đề' using errcode = '42501'; end if;
  if w.closed_at is null and (w.closes_at is null or w.closes_at > now()) then
    update training_exam_windows set closed_at = now() where id = p_window;
  end if;
end $$;

-- Bảng theo dõi của giảng viên: các đề của kế hoạch, lần mở gần nhất, và từng học viên (đã vào làm, đã nộp, điểm trong lần mở đó)
create or replace function public.training_exam_board(p_plan uuid, p_session uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_unit uuid;
begin
  if not public.training_exam_can(p_plan, p_session) then raise exception 'Bạn không có quyền xem đề của kế hoạch này' using errcode = '42501'; end if;
  if p_session is not null then select unit_id into v_unit from training_sessions where id = p_session; end if;
  return (with ex as (
      select 'unit'::text kind, x.unit_id id, x.unit_id, null::uuid program_id, x.title, x.subject sub, x.ord,
             public.training_unit_test_kind(x.detail) tkind, (x.detail #>> '{test,minutes}')::int minutes
        from public.training_plan_units(p_plan) x where public.training_unit_test_on(x.unit_id)
      union all
      select 'final', g.id, null, g.id, coalesce(nullif(g.final_exam ->> 'title', ''), 'Đề cuối khoá · ' || g.title), g.title, 100000 + i.seq,
             'bank', (g.final_exam ->> 'minutes')::int
        from training_plan_items i join training_programs g on g.id = i.program_id
       where i.plan_id = p_plan and g.final_exam is not null),
    wl as (
      select ex.*, public.training_exam_mode(p_plan, ex.unit_id, ex.program_id) mode,
             (select w from training_exam_windows w where w.plan_id = p_plan and w.unit_id is not distinct from ex.unit_id
                 and w.program_id is not distinct from ex.program_id order by w.opened_at desc limit 1) w
        from ex)
    select coalesce(jsonb_agg(jsonb_build_object(
        'kind', wl.kind, 'unit_id', wl.unit_id, 'program_id', wl.program_id, 'title', wl.title, 'sub', wl.sub, 'test_kind', wl.tkind,
        'minutes', wl.minutes, 'mode', wl.mode, 'this_session', wl.unit_id is not null and wl.unit_id = v_unit,
        'window', case when (wl.w).id is not null then jsonb_build_object('id', (wl.w).id, 'session_id', (wl.w).session_id, 'audience', (wl.w).audience,
            'opened_at', (wl.w).opened_at, 'closes_at', (wl.w).closes_at, 'closed_at', (wl.w).closed_at,
            'open', (wl.w).closed_at is null and ((wl.w).closes_at is null or (wl.w).closes_at > now())) end,
        'rows', case when (wl.w).id is null then '[]'::jsonb else (
          select coalesce(jsonb_agg(jsonb_build_object('teacher_id', t.id, 'name', t.full_name, 'school', o.name,
                   'started_at', st.started_at, 'submitted_at', st.submitted_at, 'score', st.score, 'opened', st.opened) order by t.full_name), '[]'::jsonb)
            from teachers t left join organizations o on o.id = t.org_id
            left join lateral (
              select min(a.started_at) started_at, max(a.submitted_at) submitted_at, max(a.score) filter (where a.submitted_at is not null) score, null::timestamptz opened
                from training_test_attempts a where wl.kind = 'unit' and a.plan_id = p_plan and a.unit_id = wl.unit_id and a.teacher_id = t.id and a.started_at >= (wl.w).opened_at
              union all
              select min(a.started_at), max(a.submitted_at), max(a.score) filter (where a.submitted_at is not null), null
                from training_final_attempts a where wl.kind = 'final' and a.plan_id = p_plan and a.program_id = wl.program_id and a.teacher_id = t.id and a.started_at >= (wl.w).opened_at
              union all
              select null, null, pr.best_score, pr.test_opened_at
                from training_progress pr where wl.kind = 'unit' and wl.tkind = 'link' and pr.plan_id = p_plan and pr.unit_id = wl.unit_id and pr.teacher_id = t.id
            ) st on (st.started_at is not null or st.opened is not null or st.score is not null)
           where t.id in (select e.teacher_id from training_enrollments e where e.plan_id = p_plan
                            and (wl.kind = 'final' or exists (select 1 from public.training_teacher_units(p_plan, e.teacher_id) y where y.unit_id = wl.unit_id))
                            and ((wl.w).audience = 'all' or exists (select 1 from training_attendance a where a.session_id = (wl.w).session_id and a.teacher_id = e.teacher_id and a.present))))
          end) order by (wl.unit_id is not null and wl.unit_id = v_unit) desc, wl.ord), '[]'::jsonb)
      from wl);
end $$;

-- Giáo viên: bài nào do giảng viên mở đề, đang mở cho mình hay chưa
create or replace function public.training_exam_gates(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan);
begin
  return (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select x.unit_id::text k, jsonb_build_object('mode', public.training_exam_mode(p_plan, x.unit_id, null),
             'open', w.id is not null, 'closes_at', w.closes_at) v
      from public.training_teacher_units(p_plan, v_teacher) x
      left join lateral (select * from public.training_exam_window_for(p_plan, x.unit_id, null, v_teacher)) w on true
     where public.training_unit_test_on(x.unit_id)
    union all
    select f.program_id::text, jsonb_build_object('mode', public.training_exam_mode(p_plan, null, f.program_id),
             'open', w.id is not null, 'closes_at', w.closes_at)
      from public.training_final_programs(p_plan, v_teacher) f
      left join lateral (select * from public.training_exam_window_for(p_plan, null, f.program_id, v_teacher)) w on true) s);
end $$;

-- ===== 5. Quyền gọi hàm =====
do $$ declare f text; begin
  foreach f in array array['training_exam_mode(uuid, uuid, uuid)', 'training_exam_window_for(uuid, uuid, uuid, uuid)', 'training_exam_gate(uuid, uuid, uuid, uuid)',
    'training_exam_can(uuid, uuid)', 'training_exam_open(uuid, uuid, uuid, uuid, text, integer)', 'training_exam_close(uuid)',
    'training_exam_board(uuid, uuid)', 'training_exam_gates(uuid)', 'training_test_start(uuid, uuid)', 'training_test_link_open(uuid, uuid)',
    'training_final_start(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  revoke all on function public.training_exam_window_for(uuid, uuid, uuid, uuid) from authenticated;
  revoke all on function public.training_exam_gate(uuid, uuid, uuid, uuid) from authenticated;
  foreach f in array array['training_exam_mode(uuid, uuid, uuid)', 'training_exam_can(uuid, uuid)', 'training_exam_open(uuid, uuid, uuid, uuid, text, integer)',
    'training_exam_close(uuid)', 'training_exam_board(uuid, uuid)', 'training_exam_gates(uuid)', 'training_test_start(uuid, uuid)',
    'training_test_link_open(uuid, uuid)', 'training_final_start(uuid, uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
