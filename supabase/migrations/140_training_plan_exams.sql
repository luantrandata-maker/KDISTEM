-- 140: Đề kiểm tra riêng của kế hoạch đào tạo (09/11/2026).
--  • Chương trình giữ nguyên; kế hoạch có thể dùng đề riêng thay cho đề của chương trình, đổi được cả khi đang học
--    (VD lộ đề). Bài đã nộp giữ nguyên điểm vì mỗi lượt làm đã lưu danh sách câu của lượt đó.
--  • training_plan_exams (một dòng cho mỗi chương trình trong kế hoạch):
--      final: đề cuối khoá riêng (cùng cấu trúc training_programs.final_exam); null = dùng đề của chương trình.
--      tests: {unit_id: {...}} thay câu hỏi bài kiểm tra từng nội dung: qids / count / minutes (làm trong hệ thống)
--             hoặc url / note / due (làm qua link). Cách làm, điểm đạt, số lượt vẫn theo chương trình.
--  • Chỉ đơn vị lập kế hoạch được đổi (training_plan_can_manage). Không cần duyệt.
--  • Đã có nhà giáo nộp đề cuối khoá thì không đổi được điểm đạt và số lượt của đề đó.
--  • Mỗi lần đổi ghi vào training_plan_exam_log (ai, lúc nào, lý do).
-- Cần chạy sau 139.

create table if not exists training_plan_exams (
  plan_id uuid not null references training_plans(id) on delete cascade,
  program_id uuid not null references training_programs(id) on delete cascade,
  final jsonb,
  tests jsonb not null default '{}',
  reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (plan_id, program_id)
);
create table if not exists training_plan_exam_log (
  id bigint generated always as identity primary key,
  plan_id uuid not null references training_plans(id) on delete cascade,
  program_id uuid not null,
  op text not null,
  final jsonb,
  tests jsonb,
  reason text,
  at timestamptz not null default now(),
  by uuid
);
create index if not exists training_plan_exam_log_plan on training_plan_exam_log (plan_id, at desc);

alter table training_plan_exams enable row level security;
alter table training_plan_exam_log enable row level security;
drop policy if exists training_plan_exams_rw on training_plan_exams;
create policy training_plan_exams_rw on training_plan_exams for all to authenticated
  using (public.training_plan_can_manage(plan_id)) with check (public.training_plan_can_manage(plan_id));
drop policy if exists training_plan_exam_log_read on training_plan_exam_log;
create policy training_plan_exam_log_read on training_plan_exam_log for select to authenticated
  using (public.training_plan_can_manage(plan_id));
grant select, insert, update, delete on training_plan_exams to authenticated;
grant select on training_plan_exam_log to authenticated;

-- Đề cuối khoá đang dùng của chương trình trong kế hoạch: đề riêng của kế hoạch, không có thì đề của chương trình
create or replace function public.training_plan_final(p_plan uuid, p_program uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select e.final from training_plan_exams e where e.plan_id = p_plan and e.program_id = p_program),
                  (select g.final_exam from training_programs g where g.id = p_program))
$$;
grant execute on function public.training_plan_final(uuid, uuid) to authenticated;

-- Phần kế hoạch được thay trong bài kiểm tra nội dung
create or replace function public.training_test_patch(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_object_agg(k, v) from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) x(k, v)
                    where k in ('qids', 'count', 'minutes', 'url', 'note', 'due')), '{}'::jsonb)
$$;

-- detail của nội dung sau khi áp bài kiểm tra riêng của kế hoạch
create or replace function public.training_plan_unit_detail(p_plan uuid, p_unit uuid, p_detail jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when e.tests ? p_unit::text
              then jsonb_set(coalesce(p_detail, '{}'::jsonb), '{test}', coalesce(p_detail -> 'test', '{}'::jsonb) || public.training_test_patch(e.tests -> p_unit::text))
              else p_detail end
    from (select (select x.tests from training_plan_exams x join training_program_units u on u.program_id = x.program_id
                   where x.plan_id = p_plan and u.id = p_unit) tests) e
$$;

-- Kiểm tra cấu hình đề cuối khoá (dùng chung cho chương trình và kế hoạch)
create or replace function public.training_final_exam_check(f jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if f is null then return; end if;
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
end $$;

create or replace function public.training_plan_exams_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g training_programs; k text; v jsonb; u training_program_units; n int; o jsonb; nf jsonb;
begin
  if not public.training_plan_can_manage(new.plan_id) then
    raise exception 'Chỉ đơn vị lập kế hoạch được đổi đề của kế hoạch' using errcode = '42501';
  end if;
  select * into g from training_programs where id = new.program_id;
  if not exists (select 1 from training_plan_items i where i.plan_id = new.plan_id and i.program_id = new.program_id) then
    raise exception 'Chương trình không có trong kế hoạch' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.plan_id, new.program_id) is distinct from (old.plan_id, old.program_id) then
    raise exception 'Không đổi được kế hoạch, chương trình của đề' using errcode = '22023';
  end if;
  if new.final is not null and jsonb_typeof(new.final) = 'null' then new.final := null; end if;
  perform public.training_final_exam_check(new.final);
  -- Bài kiểm tra nội dung: chỉ thay câu hỏi / link
  if new.tests is null or jsonb_typeof(new.tests) <> 'object' then new.tests := '{}'::jsonb; end if;
  for k, v in select * from jsonb_each(new.tests) loop
    if k !~ '^[0-9a-f-]{36}$' then raise exception 'Bài kiểm tra không hợp lệ' using errcode = '22023'; end if;
    select * into u from training_program_units where id = k::uuid and program_id = new.program_id and kind = 'content';
    if u.id is null or not u.has_test then raise exception 'Nội dung không có bài kiểm tra trong chương trình' using errcode = '22023'; end if;
    v := public.training_test_patch(v);
    if public.training_unit_test_kind(u.detail) = 'link' then
      v := v - 'qids' - 'count' - 'minutes';
      if coalesce(btrim(v ->> 'url'), '') !~* '^https?://' or length(v ->> 'url') > 1000 then
        raise exception 'Link bài kiểm tra "%" không hợp lệ', u.title using errcode = '22023';
      end if;
      if length(coalesce(v ->> 'note', '')) > 500 or (v ? 'due' and jsonb_typeof(v -> 'due') <> 'null' and coalesce(v ->> 'due', '') !~ '^\d{4}-\d{2}-\d{2}$') then
        raise exception 'Hướng dẫn hoặc hạn làm bài "%" không hợp lệ', u.title using errcode = '22023';
      end if;
    else
      v := v - 'url' - 'note' - 'due';
      if jsonb_typeof(v -> 'qids') is distinct from 'array' then raise exception 'Chọn câu hỏi cho bài kiểm tra "%"', u.title using errcode = '22023'; end if;
      n := jsonb_array_length(v -> 'qids');
      if n < 1 or n > 200 then raise exception 'Bài kiểm tra "%" cần từ 1 đến 200 câu', u.title using errcode = '22023'; end if;
      if exists (select 1 from jsonb_array_elements_text(v -> 'qids') q
                  where q !~ '^[0-9a-f-]{36}$' or not exists (select 1 from question_bank b where b.id = q::uuid)) then
        raise exception 'Có câu hỏi không còn trong ngân hàng' using errcode = '22023';
      end if;
      if (v ? 'count' and jsonb_typeof(v -> 'count') <> 'null' and ((v ->> 'count')::numeric < 1 or (v ->> 'count')::numeric > n))
         or (v ? 'minutes' and jsonb_typeof(v -> 'minutes') <> 'null' and ((v ->> 'minutes')::numeric < 1 or (v ->> 'minutes')::numeric > 300)) then
        raise exception 'Số câu mỗi lượt hoặc thời gian của "%" không hợp lệ', u.title using errcode = '22023';
      end if;
    end if;
    new.tests := jsonb_set(new.tests, array[k], v);
  end loop;
  -- Đã có người nộp đề cuối khoá: giữ điểm đạt và số lượt
  o := case when tg_op = 'UPDATE' then coalesce(old.final, g.final_exam) else g.final_exam end;
  nf := coalesce(new.final, g.final_exam);
  if ((o ->> 'pass') is distinct from (nf ->> 'pass') or coalesce((o ->> 'attempts')::int, 0) <> coalesce((nf ->> 'attempts')::int, 0))
     and exists (select 1 from training_final_attempts a where a.plan_id = new.plan_id and a.program_id = new.program_id and a.submitted_at is not null) then
    raise exception 'Đã có nhà giáo nộp đề cuối khoá: không đổi được điểm đạt và số lượt làm' using errcode = '22023';
  end if;
  new.reason := nullif(btrim(left(new.reason, 500)), '');
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists training_plan_exams_guard on training_plan_exams;
create trigger training_plan_exams_guard before insert or update on training_plan_exams
  for each row execute function public.training_plan_exams_guard();

create or replace function public.training_plan_exams_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from training_plans where id = old.plan_id) then
      insert into training_plan_exam_log (plan_id, program_id, op, reason, by) values (old.plan_id, old.program_id, 'reset', null, auth.uid());
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.final, new.tests) is not distinct from (old.final, old.tests) then return new; end if;
  insert into training_plan_exam_log (plan_id, program_id, op, final, tests, reason, by)
  values (new.plan_id, new.program_id, lower(tg_op), new.final, new.tests, new.reason, auth.uid());
  return new;
end $$;
drop trigger if exists training_plan_exams_log on training_plan_exams;
create trigger training_plan_exams_log after insert or update or delete on training_plan_exams
  for each row execute function public.training_plan_exams_log();

-- Chương trình: dùng chung hàm kiểm tra đề
do $$
declare d text; f text := 'public.training_programs_exam_guard()';
begin
  d := pg_get_functiondef(f::regprocedure);
  if position('training_final_exam_check' in d) = 0 then
    d := regexp_replace(d, '  if f is not null then\n    if jsonb_typeof\(f\) <> ''object''.*?raise exception ''Cấu hình đề cuối khoá không hợp lệ \(thời gian, số lượt, điểm đạt, môn, khối\)'' using errcode = ''22023'';\n    end if;\n  end if;\n',
                        '  perform public.training_final_exam_check(f);' || chr(10));
    if position('training_final_exam_check' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;
end $$;

-- Nội dung của kế hoạch: áp bài kiểm tra riêng của kế hoạch (bài học, khoá học của nhà giáo, mở đề… dùng hàm này)
create or replace function public.training_plan_units(p_plan uuid)
returns table(unit_id uuid, ord integer, subject text, title text, hours numeric, mode text, has_test boolean, detail jsonb, program_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id, (row_number() over (order by i.seq, sj.seq, u.seq))::int, sj.title, u.title, u.hours, u.mode, u.has_test,
         case when pe.tests ? u.id::text
              then jsonb_set(coalesce(u.detail, '{}'::jsonb), '{test}', coalesce(u.detail -> 'test', '{}'::jsonb) || public.training_test_patch(pe.tests -> u.id::text))
              else u.detail end,
         u.program_id
    from training_plan_items i
    join training_program_units sj on sj.program_id = i.program_id and sj.kind = 'subject'
    join training_program_units u on u.parent_id = sj.id and u.kind = 'content'
    left join training_plan_exams pe on pe.plan_id = i.plan_id and pe.program_id = i.program_id
   where i.plan_id = p_plan and (i.units is null or u.id = any(i.units))
   order by i.seq, sj.seq, u.seq
$$;

-- Các hàm đọc đề: sửa tại chỗ bản đang chạy
do $$
declare d text; f text;
begin
  f := 'public.training_final_programs(uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_final' in d) = 0 then
    d := replace(d, 'g.final_exam', 'public.training_plan_final(p_plan, g.id)');
    if position('training_plan_final' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_final_start(uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_exams' in d) = 0 then
    -- Đề riêng của kế hoạch rút câu theo ngân hàng của đơn vị lập kế hoạch
    d := replace(d, 'v_q := public.exam_pick_multi(g.org_id,',
      'v_q := public.exam_pick_multi(case when exists (select 1 from training_plan_exams e where e.plan_id = p_plan and e.program_id = p_program and e.final is not null)
                                          then (select org_id from training_plans where id = p_plan) else g.org_id end,');
    if position('training_plan_exams' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_final_submit(uuid,jsonb)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_final' in d) = 0 then
    d := replace(d, 'select (final_exam ->> ''pass'')::numeric into v_pass from training_programs where id = a.program_id;',
                    'v_pass := (public.training_plan_final(a.plan_id, a.program_id) ->> ''pass'')::numeric;');
    if position('training_plan_final' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_exam_attempts_seen()';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_final' in d) = 0 then
    d := replace(d, 'g.final_exam', 'public.training_plan_final(a.plan_id, g.id)');
    if position('training_plan_final' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_exam_mode(uuid,uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_final' in d) = 0 then
    d := replace(d, '(select g.final_exam ->> ''mode'' from training_programs g where g.id = p_program)',
                    '(public.training_plan_final(p_plan, p_program) ->> ''mode'')');
    if position('training_plan_final' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_exam_open(uuid,uuid,uuid,uuid,text,integer)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_final' in d) = 0 then
    d := replace(d, 'g.final_exam is not null', 'public.training_plan_final(p_plan, g.id) is not null');
    if position('training_plan_final' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_exam_board(uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_final' in d) = 0 then
    d := replace(d, 'g.final_exam', 'public.training_plan_final(p_plan, g.id)');
    if position('training_plan_final' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  -- Bài kiểm tra nội dung: đọc câu hỏi / link sau khi áp đề riêng của kế hoạch
  f := 'public.training_test_start(uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_unit_detail' in d) = 0 then
    d := replace(d, '  if not public.training_unit_test_on(p_unit) then raise exception',
                    '  u.detail := public.training_plan_unit_detail(p_plan, p_unit, u.detail);' || chr(10) || '  if not public.training_unit_test_on(p_unit) then raise exception');
    if position('training_plan_unit_detail' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;

  f := 'public.training_test_link_open(uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_plan_unit_detail' in d) = 0 then
    d := replace(d, '  if not public.training_unit_test_on(p_unit) or public.training_unit_test_kind(u.detail) <> ''link'' then',
                    '  u.detail := public.training_plan_unit_detail(p_plan, p_unit, u.detail);' || chr(10) || '  if not public.training_unit_test_on(p_unit) or public.training_unit_test_kind(u.detail) <> ''link'' then');
    if position('training_plan_unit_detail' in d) = 0 then raise exception '140: không sửa được %', f; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
