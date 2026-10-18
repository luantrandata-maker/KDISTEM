-- 043: Khảo sát (S4). Sở/Phòng khảo sát GV hoặc HS các trường trực thuộc; trường khảo sát GV/HS của mình; KDI khảo sát toàn hệ thống.
--   • surveys: câu hỏi dạng jsonb [{ id, type: single|multi|scale|text, text, options[], required }], đối tượng (teacher|student|staff),
--     thời gian mở, ẩn danh. Đơn vị tạo = org_id; người trả lời thuộc đơn vị đó hoặc đơn vị cấp dưới.
--   • survey_responses: mỗi người trả lời một lần (sửa được khi khảo sát còn mở). Ghi qua survey_submit (kiểm tra đối tượng,
--     thời gian, câu bắt buộc, giá trị hợp lệ). Không ai đọc trực tiếp câu trả lời của người khác:
--     đơn vị tạo xem kết quả tổng hợp qua survey_results (khảo sát ẩn danh không lộ người trả lời).

create table if not exists surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  description text,
  audience text not null check (audience in ('teacher', 'student', 'staff')),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  anonymous boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists surveys_org on surveys (org_id, created_at desc);

create table if not exists survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  org_id uuid references organizations(id) on delete set null,     -- đơn vị của người trả lời (thống kê theo trường)
  respondent uuid not null references profiles(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  submitted_at timestamptz not null default now(),
  unique (survey_id, respondent)
);
alter table surveys enable row level security;
alter table survey_responses enable row level security;

-- Đơn vị p_org có nằm trong cây của p_root (kể cả chính nó)
create or replace function public.org_in_tree(p_org uuid, p_root uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id from organizations where id = p_org
    union all
    select o.id, o.parent_id from organizations o join up on o.id = up.parent_id
  ) select exists (select 1 from up where id = p_root)
$$;

-- Khảo sát này có dành cho người dùng hiện tại không
create or replace function public.survey_for_me(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from surveys s where s.id = p_survey and s.status = 'open'
    and (s.opens_at is null or s.opens_at <= now()) and (s.closes_at is null or s.closes_at > now())
    and public.my_org_id() is not null and public.org_in_tree(public.my_org_id(), s.org_id)
    and case s.audience when 'student' then public.is_student()
                        when 'teacher' then public.my_teacher_id() is not null
                        else public.is_staff() end)
$$;

-- Người quản lý khảo sát: cán bộ của đơn vị tạo (Sở/Phòng: cán bộ quản lý; trường: quản trị) và KDI
create or replace function public.can_manage_survey(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (p_org = public.my_org_id() and (public.is_authority() or public.is_admin()))
$$;

drop policy if exists surveys_read on surveys;
create policy surveys_read on surveys for select to authenticated using (
  (select public.can_manage_survey(org_id)) or (select public.survey_for_me(id))
  or ((select public.is_authority()) and org_id in (select public.my_org_tree())));
drop policy if exists surveys_write on surveys;
create policy surveys_write on surveys for all to authenticated
  using ((select public.can_manage_survey(org_id)))
  with check ((select public.can_manage_survey(org_id)));
drop policy if exists survey_responses_own on survey_responses;
create policy survey_responses_own on survey_responses for select to authenticated using (respondent = auth.uid());

-- Kiểm tra cấu trúc câu hỏi; đã có người trả lời thì không đổi câu hỏi (chỉ đổi trạng thái, thời gian, mô tả)
create or replace function public.guard_survey() returns trigger
language plpgsql security definer set search_path = public as $$   -- definer: đếm câu trả lời của mọi người (RLS chỉ cho xem của mình)
begin
  if exists (select 1 from jsonb_array_elements(new.questions) q
              where coalesce(q->>'id', '') = '' or coalesce(btrim(q->>'text'), '') = ''
                 or coalesce(q->>'type', '') not in ('single', 'multi', 'scale', 'text')
                 or (q->>'type' in ('single', 'multi') and (jsonb_typeof(q->'options') <> 'array' or jsonb_array_length(q->'options') < 2))) then
    raise exception 'Câu hỏi chưa hợp lệ (thiếu nội dung, loại, hoặc lựa chọn)' using errcode = '22023';
  end if;
  if (select count(distinct q->>'id') from jsonb_array_elements(new.questions) q) <> jsonb_array_length(new.questions) then
    raise exception 'Mã câu hỏi bị trùng' using errcode = '22023';
  end if;
  if new.status = 'open' and jsonb_array_length(new.questions) = 0 then raise exception 'Khảo sát chưa có câu hỏi' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.questions is distinct from old.questions and exists (select 1 from survey_responses where survey_id = old.id) then
    raise exception 'Đã có người trả lời — không sửa câu hỏi được (hãy tạo khảo sát mới)' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.anonymous is distinct from old.anonymous and exists (select 1 from survey_responses where survey_id = old.id) then
    raise exception 'Đã có người trả lời — không đổi chế độ ẩn danh được' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists surveys_guard on surveys;
create trigger surveys_guard before insert or update on surveys for each row execute function public.guard_survey();

-- Gửi / sửa câu trả lời
create or replace function public.survey_submit(p_survey uuid, p_answers jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s surveys; q jsonb; a jsonb; v_id uuid; n int;
begin
  if not public.survey_for_me(p_survey) then raise exception 'Khảo sát không dành cho bạn hoặc đã đóng' using errcode = '42501'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Câu trả lời không hợp lệ' using errcode = '22023'; end if;
  select * into s from surveys where id = p_survey;
  for q in select * from jsonb_array_elements(s.questions) loop
    a := p_answers -> (q->>'id');
    if a is null or a = 'null'::jsonb or a = '""'::jsonb or a = '[]'::jsonb then
      if coalesce((q->>'required')::boolean, false) then raise exception 'Chưa trả lời câu bắt buộc: %', q->>'text' using errcode = '22023'; end if;
      continue;
    end if;
    case q->>'type'
      when 'single' then
        if jsonb_typeof(a) <> 'number' or (a::text)::int not between 0 and jsonb_array_length(q->'options') - 1 then raise exception 'Lựa chọn không hợp lệ: %', q->>'text' using errcode = '22023'; end if;
      when 'multi' then
        if jsonb_typeof(a) <> 'array' or exists (select 1 from jsonb_array_elements(a) x where jsonb_typeof(x) <> 'number' or (x::text)::int not between 0 and jsonb_array_length(q->'options') - 1) then
          raise exception 'Lựa chọn không hợp lệ: %', q->>'text' using errcode = '22023'; end if;
      when 'scale' then
        if jsonb_typeof(a) <> 'number' or (a::text)::numeric not in (1, 2, 3, 4, 5) then raise exception 'Thang điểm 1–5: %', q->>'text' using errcode = '22023'; end if;
      else
        if jsonb_typeof(a) <> 'string' or length(a #>> '{}') > 4000 then raise exception 'Câu trả lời quá dài: %', q->>'text' using errcode = '22023'; end if;
    end case;
  end loop;
  -- Chỉ giữ câu trả lời cho các câu hỏi có trong khảo sát
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into p_answers
    from jsonb_each(p_answers) e(k, v) where exists (select 1 from jsonb_array_elements(s.questions) qq(x) where qq.x->>'id' = e.k);
  insert into survey_responses (survey_id, org_id, respondent, answers) values (p_survey, public.my_org_id(), auth.uid(), p_answers)
    on conflict (survey_id, respondent) do update set answers = excluded.answers, submitted_at = now(), org_id = excluded.org_id
    returning id into v_id;
  return v_id;
end $$;

-- Khảo sát đang mở dành cho tôi
create or replace function public.my_surveys()
returns table (id uuid, title text, description text, audience text, questions jsonb, anonymous boolean, closes_at timestamptz, from_org text, answered boolean, my_answers jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.description, s.audience, s.questions, s.anonymous, s.closes_at, o.name,
         r.id is not null, r.answers
    from surveys s join organizations o on o.id = s.org_id
    left join survey_responses r on r.survey_id = s.id and r.respondent = auth.uid()
   where public.survey_for_me(s.id)
   order by r.id is not null, s.closes_at nulls last, s.created_at desc
$$;

-- Kết quả tổng hợp cho đơn vị tạo (và cấp trên của đơn vị tạo)
create or replace function public.survey_results(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s surveys; q jsonb; out jsonb := '[]'::jsonb; item jsonb;
begin
  select * into s from surveys where id = p_survey;
  if s.id is null then raise exception 'Không có khảo sát' using errcode = 'P0002'; end if;
  if not (public.can_manage_survey(s.org_id) or (public.is_authority() and s.org_id in (select public.my_org_tree()))) then
    raise exception 'Không có quyền xem kết quả' using errcode = '42501';
  end if;
  for q in select * from jsonb_array_elements(s.questions) loop
    if q->>'type' in ('single', 'multi') then
      select jsonb_build_object('id', q->>'id', 'counts', coalesce(jsonb_agg(cnt order by i), '[]'::jsonb)) into item
        from (select i - 1 as i, (select count(*) from survey_responses r where r.survey_id = s.id
                and (r.answers -> (q->>'id') = to_jsonb(i - 1) or (jsonb_typeof(r.answers -> (q->>'id')) = 'array' and r.answers -> (q->>'id') @> to_jsonb(array[i - 1]))))::int as cnt
                from generate_series(1, jsonb_array_length(q->'options')) i) t;
    elsif q->>'type' = 'scale' then
      select jsonb_build_object('id', q->>'id',
               'counts', (select jsonb_agg((select count(*) from survey_responses r where r.survey_id = s.id and r.answers -> (q->>'id') = to_jsonb(v))::int order by v) from generate_series(1, 5) v),
               'avg', round(avg((r.answers ->> (q->>'id'))::numeric), 2)) into item
        from survey_responses r where r.survey_id = s.id and jsonb_typeof(r.answers -> (q->>'id')) = 'number';
    else
      select jsonb_build_object('id', q->>'id', 'texts', coalesce(jsonb_agg(jsonb_build_object(
               'text', r.answers ->> (q->>'id'),
               'who', case when s.anonymous then null else (select full_name from profiles p where p.id = r.respondent) end,
               'org', (select name from organizations o where o.id = r.org_id)) order by r.submitted_at desc), '[]'::jsonb)) into item
        from survey_responses r where r.survey_id = s.id and coalesce(r.answers ->> (q->>'id'), '') <> '';
    end if;
    out := out || item;
  end loop;
  return jsonb_build_object(
    'responses', (select count(*) from survey_responses where survey_id = s.id),
    'by_org', (select coalesce(jsonb_agg(jsonb_build_object('org', o.name, 'n', t.n) order by t.n desc), '[]'::jsonb)
                 from (select org_id, count(*) n from survey_responses where survey_id = s.id group by org_id) t left join organizations o on o.id = t.org_id),
    'questions', out,
    'rows', case when s.anonymous then null else (select coalesce(jsonb_agg(jsonb_build_object('who', p.full_name, 'org', o.name, 'at', r.submitted_at, 'answers', r.answers) order by r.submitted_at), '[]'::jsonb)
                 from survey_responses r join profiles p on p.id = r.respondent left join organizations o on o.id = r.org_id where r.survey_id = s.id) end);
end $$;
revoke all on function public.org_in_tree(uuid, uuid), public.survey_for_me(uuid), public.can_manage_survey(uuid), public.survey_submit(uuid, jsonb),
  public.my_surveys(), public.survey_results(uuid) from public, anon;
grant execute on function public.org_in_tree(uuid, uuid), public.survey_for_me(uuid), public.can_manage_survey(uuid), public.survey_submit(uuid, jsonb),
  public.my_surveys(), public.survey_results(uuid) to authenticated;
