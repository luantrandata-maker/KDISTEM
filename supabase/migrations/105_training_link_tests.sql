-- 105. Bài test tập huấn làm qua link ngoài (Google Forms, Microsoft Forms, Azota…) và nhập điểm bài test.
--  • detail.test.kind: 'bank' (mặc định, câu hỏi từ ngân hàng, chấm tự động) hoặc 'link' (url, điểm đạt, hạn làm, ghi chú).
--  • Giáo viên bấm "Làm bài" thì mở link và hệ thống ghi lúc mở (training_progress.test_opened_at). Mở link là đủ để học tiếp
--    nội dung sau; điểm do người tổ chức nhập rồi mới tính vào điều kiện đạt.
--  • Người tổ chức nhập điểm bài test (thang 10) cho mọi loại bài test: nhập tay hoặc từ Excel (training_test_scores_set).
--    Ô để trống thì bỏ điểm nhập tay, quay về điểm cao nhất giáo viên tự làm (nếu có).
--  • Bài giảng tập huấn: Kho hoạt động thành thẻ tuỳ chọn, phát hành chỉ cần chốt 4 thẻ còn lại.
-- Cần chạy sau 104.

alter table training_progress
  add column if not exists test_opened_at timestamptz,
  add column if not exists score_manual boolean not null default false,
  add column if not exists scored_by uuid references profiles(id) on delete set null,
  add column if not exists scored_at timestamptz;

-- Loại bài test của nội dung
create or replace function public.training_unit_test_kind(p_detail jsonb) returns text
language sql immutable as $$
  select case when p_detail #>> '{test,kind}' = 'link' then 'link' else 'bank' end
$$;

create or replace function public.training_unit_test_on(p_unit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select u.has_test and case when public.training_unit_test_kind(u.detail) = 'link'
                       then coalesce(btrim(u.detail #>> '{test,url}'), '') <> ''
                       else jsonb_array_length(coalesce(u.detail #> '{test,qids}', '[]'::jsonb)) > 0 end
                     from training_program_units u where u.id = p_unit), false)
$$;

-- Kiểm tra cấu hình bài test
create or replace function public.training_units_test_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare t jsonb := new.detail -> 'test'; n int;
begin
  if t is null or jsonb_typeof(t) <> 'object' then return new; end if;
  if t ? 'kind' and jsonb_typeof(t -> 'kind') <> 'null' and t ->> 'kind' not in ('bank', 'link') then
    raise exception 'Loại bài kiểm tra không hợp lệ' using errcode = '22023';
  end if;
  if t ->> 'kind' = 'link' then
    if coalesce(btrim(t ->> 'url'), '') <> '' and (t ->> 'url' !~* '^https?://[^\s]+$' or length(t ->> 'url') > 1000) then
      raise exception 'Link bài kiểm tra phải bắt đầu bằng http:// hoặc https://' using errcode = '22023';
    end if;
    if t ? 'due' and jsonb_typeof(t -> 'due') <> 'null' and (t ->> 'due') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Hạn làm bài không hợp lệ' using errcode = '22023';
    end if;
    if length(coalesce(t ->> 'note', '')) > 500 then raise exception 'Ghi chú bài kiểm tra tối đa 500 ký tự' using errcode = '22023'; end if;
  end if;
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

create or replace function public.training_programs_test_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status <> 'published' and exists (
       select 1 from training_program_units u where u.program_id = new.id and u.kind = 'content' and u.has_test
          and not public.training_unit_test_on(u.id)) then
    raise exception 'Chưa phát hành được: có nội dung "có bài kiểm tra" nhưng chưa chọn câu hỏi hoặc chưa nhập link bài kiểm tra' using errcode = '22023';
  end if;
  return new;
end $$;

-- Hoàn thành nội dung: bài test qua link chỉ cần đã mở link (hoặc đã có điểm đạt)
create or replace function public.training_progress_refresh(p_plan uuid, p_unit uuid, p_teacher uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare u training_program_units; pr training_progress; v_ok boolean;
begin
  select * into u from training_program_units where id = p_unit;
  select * into pr from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = p_teacher;
  if pr.plan_id is null then return public.training_unit_done(p_plan, p_unit, p_teacher); end if;
  if pr.completed_at is not null then return true; end if;
  v_ok := public.training_unit_keys(u.detail) <@ pr.seen
      and (not public.training_unit_test_on(p_unit)
           or coalesce(pr.best_score, -1) >= public.training_unit_pass(p_unit)
           or (public.training_unit_test_kind(u.detail) = 'link' and pr.test_opened_at is not null));
  if v_ok then
    update training_progress set completed_at = now(), updated_at = now()
     where plan_id = p_plan and unit_id = p_unit and teacher_id = p_teacher;
  end if;
  return v_ok;
end $$;

-- Giáo viên mở bài test qua link: ghi lúc mở, trả về link
create or replace function public.training_test_link_open(p_plan uuid, p_unit uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); u training_program_units;
begin
  select * into u from training_program_units where id = p_unit;
  if u.id is null or not exists (select 1 from public.training_teacher_units(p_plan, v_teacher) x where x.unit_id = p_unit) then
    raise exception 'Nội dung không thuộc kế hoạch tập huấn của bạn' using errcode = '22023';
  end if;
  if not public.training_unit_test_on(p_unit) or public.training_unit_test_kind(u.detail) <> 'link' then
    raise exception 'Nội dung này không có bài kiểm tra qua link' using errcode = '22023';
  end if;
  if not public.training_unit_unlocked(p_plan, p_unit, v_teacher) then
    raise exception 'Hoàn thành nội dung trước rồi mới làm bài kiểm tra này' using errcode = '22023';
  end if;
  if not (public.training_unit_keys(u.detail) <@ coalesce((select seen from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher), '{}')) then
    raise exception 'Mở hết bài giảng và tài liệu trước khi làm bài kiểm tra' using errcode = '22023';
  end if;
  insert into training_progress (plan_id, unit_id, teacher_id, test_opened_at) values (p_plan, p_unit, v_teacher, now())
  on conflict (plan_id, unit_id, teacher_id) do update
    set test_opened_at = coalesce(training_progress.test_opened_at, now()), updated_at = now();
  perform public.training_progress_refresh(p_plan, p_unit, v_teacher);
  return btrim(u.detail #>> '{test,url}');
end $$;

-- Bài test trong hệ thống: không mở cho bài làm qua link
do $$
declare d text;
begin
  d := pg_get_functiondef('public.training_test_start(uuid,uuid)'::regprocedure);
  if position('training_unit_test_kind' in d) = 0 then
    d := replace(d, 'if not public.training_unit_test_on(p_unit) then raise exception ''Nội dung này không có bài kiểm tra'' using errcode = ''22023''; end if;',
      'if not public.training_unit_test_on(p_unit) then raise exception ''Nội dung này không có bài kiểm tra'' using errcode = ''22023''; end if;
  if public.training_unit_test_kind(u.detail) = ''link'' then raise exception ''Bài kiểm tra này làm qua link'' using errcode = ''22023''; end if;');
    if position('training_unit_test_kind' in d) = 0 then raise exception '105: không sửa được training_test_start'; end if;
    execute d;
  end if;
end $$;

-- Khoá học của giáo viên: thêm thông tin bài test qua link
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
              'test', case when not public.training_unit_test_on(x.unit_id) then null
                when public.training_unit_test_kind(x.detail) = 'link' then jsonb_build_object(
                  'kind', 'link', 'url', btrim(x.detail #>> '{test,url}'), 'due', x.detail #>> '{test,due}', 'note', x.detail #>> '{test,note}',
                  'pass', public.training_unit_pass(x.unit_id), 'opened', pr.test_opened_at, 'count', 0, 'minutes', null, 'attempts', 0, 'used', 0, 'open', null)
                else jsonb_build_object(
                  'kind', 'bank',
                  'count', least(coalesce((x.detail #>> '{test,count}')::int, jsonb_array_length(x.detail #> '{test,qids}')), jsonb_array_length(x.detail #> '{test,qids}')),
                  'minutes', (x.detail #>> '{test,minutes}')::int, 'attempts', case when coalesce((x.detail #>> '{test,attempts}')::int, 0) > 0 then (x.detail #>> '{test,attempts}')::int
                    + coalesce((select r.extra_attempts from training_results r where r.plan_id = p_plan and r.teacher_id = v_teacher), 0) else 0 end,
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
            from public.training_teacher_units(p_plan, v_teacher) x
            left join training_progress pr on pr.plan_id = p_plan and pr.unit_id = x.unit_id and pr.teacher_id = v_teacher),
    'attendance', (select jsonb_build_object('present', count(*) filter (where a.present), 'total', count(*))
                     from training_attendance a join training_sessions s on s.id = a.session_id
                    where s.plan_id = p_plan and a.teacher_id = v_teacher),
    'result', (select jsonb_build_object('result', r.result, 'reason', r.reason, 'product_score', r.product_score, 'comment', r.comment)
                 from training_results r where r.plan_id = p_plan and r.teacher_id = v_teacher),
    'cert', (select jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status) from certificates c
              where c.plan_id = p_plan and c.teacher_id = v_teacher and c.status <> 'revoked' order by c.created_at desc limit 1),
    'product', (select to_jsonb(d) - 'reviewed_by' from training_products d where d.plan_id = p_plan and d.teacher_id = v_teacher)
  ) into v;
  return v;
end $$;

-- Bảng điểm bài test của kế hoạch: các bài test và điểm từng giáo viên
create or replace function public.training_plan_test_scores(p_plan uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', x.unit_id, 'ord', x.ord, 'subject', x.subject, 'title', x.title,
                'kind', public.training_unit_test_kind(x.detail), 'pass', public.training_unit_pass(x.unit_id),
                'url', case when public.training_unit_test_kind(x.detail) = 'link' then btrim(x.detail #>> '{test,url}') end) order by x.ord), '[]'::jsonb)
              from public.training_plan_units(p_plan) x where public.training_unit_test_on(x.unit_id)),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('teacher_id', e.teacher_id, 'teacher_name', t.full_name, 'email', t.email, 'org_name', o.name,
                'units', (select coalesce(jsonb_agg(us.unit_id), '[]'::jsonb) from public.training_teacher_units(p_plan, e.teacher_id) us
                           where public.training_unit_test_on(us.unit_id)),
                'scores', (select coalesce(jsonb_object_agg(pr.unit_id, jsonb_build_object('score', pr.best_score, 'manual', pr.score_manual, 'opened', pr.test_opened_at,
                             'attempts', (select count(*) from training_test_attempts a where a.plan_id = p_plan and a.unit_id = pr.unit_id
                                            and a.teacher_id = e.teacher_id and a.submitted_at is not null))), '{}'::jsonb)
                           from training_progress pr where pr.plan_id = p_plan and pr.teacher_id = e.teacher_id
                             and (pr.best_score is not null or pr.test_opened_at is not null))
              ) order by o.name, t.full_name), '[]'::jsonb)
              from training_enrollments e join teachers t on t.id = e.teacher_id left join organizations o on o.id = t.org_id
             where e.plan_id = p_plan
               and (public.training_plan_can_manage(p_plan) or public.training_can_view_teacher(e.teacher_id))))
$$;

-- Nhập điểm bài test hàng loạt: p_rows = [{teacher_id, unit_id, score}], score null = bỏ điểm nhập tay
create or replace function public.training_test_scores_set(p_plan uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_t uuid; v_u uuid; v_s numeric; v_auto numeric; n int := 0;
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không quản lý kế hoạch này' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Dữ liệu điểm không hợp lệ' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Mỗi lần nhập tối đa 20000 điểm' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_t := (r ->> 'teacher_id')::uuid; v_u := (r ->> 'unit_id')::uuid;
    exception when others then raise exception 'Dữ liệu điểm không hợp lệ' using errcode = '22023';
    end;
    if jsonb_typeof(r -> 'score') = 'number' then v_s := (r ->> 'score')::numeric;
    elsif r -> 'score' is null or jsonb_typeof(r -> 'score') = 'null' then v_s := null;
    else raise exception 'Điểm phải là số từ 0 đến 10' using errcode = '22023';
    end if;
    if v_s is not null and (v_s < 0 or v_s > 10) then raise exception 'Điểm bài kiểm tra từ 0 đến 10' using errcode = '22023'; end if;
    v_s := round(v_s, 1);
    perform public.training_result_check(p_plan, v_t);
    if not exists (select 1 from public.training_teacher_units(p_plan, v_t) x where x.unit_id = v_u) or not public.training_unit_test_on(v_u) then
      raise exception 'Bài kiểm tra không thuộc nội dung giáo viên học' using errcode = '22023';
    end if;
    if v_s is null then
      select max(a.score) into v_auto from training_test_attempts a
       where a.plan_id = p_plan and a.unit_id = v_u and a.teacher_id = v_t and a.submitted_at is not null;
      update training_progress set best_score = v_auto, score_manual = false, scored_by = auth.uid(), scored_at = now(), updated_at = now()
       where plan_id = p_plan and unit_id = v_u and teacher_id = v_t and score_manual;
    else
      insert into training_progress (plan_id, unit_id, teacher_id, best_score, score_manual, scored_by, scored_at)
      values (p_plan, v_u, v_t, v_s, true, auth.uid(), now())
      on conflict (plan_id, unit_id, teacher_id) do update
        set best_score = excluded.best_score, score_manual = true, scored_by = auth.uid(), scored_at = now(), updated_at = now();
      perform public.training_progress_refresh(p_plan, v_u, v_t);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.training_test_link_open(uuid, uuid) from public, anon;
revoke all on function public.training_plan_test_scores(uuid) from public, anon;
revoke all on function public.training_test_scores_set(uuid, jsonb) from public, anon;
grant execute on function public.training_test_link_open(uuid, uuid) to authenticated;
grant execute on function public.training_plan_test_scores(uuid) to authenticated;
grant execute on function public.training_test_scores_set(uuid, jsonb) to authenticated;

-- Bài giảng tập huấn: Kho hoạt động tuỳ chọn, chốt đủ 4 thẻ còn lại là phát hành được
create or replace function public.training_lesson_publish(p_id uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare v int; c jsonb; n int;
begin
  select coalesce(content -> 'checked', '[]'::jsonb) into c from training_lessons where id = p_id;
  if c is null then raise exception 'Không tìm thấy bài giảng' using errcode = '22023'; end if;
  select count(*) into n from (values ('info'), ('content'), ('links'), ('norms')) k(x) where c ? k.x;
  if n < 4 then raise exception 'Chốt đủ 4 thẻ Thông tin, Nội dung, Link tài liệu, Định mức vật tư trước khi phát hành (đang %/4)', n using errcode = '22023'; end if;
  update training_lessons set status = 'published', version = version + 1 where id = p_id returning version into v;
  if v is null then raise exception 'Bạn không có quyền phát hành bài giảng này' using errcode = '42501'; end if;
  return v;
end $$;
grant execute on function public.training_lesson_publish(uuid) to authenticated;

notify pgrst, 'reload schema';
