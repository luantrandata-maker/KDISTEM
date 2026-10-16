-- 030: Hoàn thiện cổng Giáo viên, Học sinh, Trường, Sở (S6a)
--   • activities: kho hoạt động tương tác của giáo viên, 8 mẫu (trắc nghiệm, đúng/sai, ghép đôi, sắp xếp,
--     điền khuyết, phân loại, thẻ ghi nhớ, phiếu học tập).
--   • self_study_items: "Học trước & tự học" — giáo viên giao hoạt động / bài giảng / đường dẫn cho lớp.
--     Nội dung được chụp lại lúc giao (self_study_content) và HỌC SINH KHÔNG ĐỌC ĐƯỢC bảng này:
--     học sinh lấy đề qua self_study_open() (đã bỏ đáp án, xáo thứ tự) và nộp qua self_study_submit()
--     (chấm trên CSDL) — không tự chấm, không xem đáp án trước.
--   • school_holidays: ngày nghỉ & lễ của trường hoặc của Sở/Tỉnh (áp dụng cho trường trực thuộc);
--     generate_teaching_sessions() không sinh tiết vào ngày nghỉ.
-- Cần chạy sau 029.

-- ===== 1. Kho hoạt động tương tác =====
-- content theo loại (kind):
--   quiz       {"items":[{"q":"...","options":["A","B"],"answer":0}]}
--   truefalse  {"items":[{"q":"...","answer":true}]}
--   match      {"pairs":[{"left":"...","right":"..."}]}
--   order      {"steps":["bước 1","bước 2", ...]}                     (đúng thứ tự)
--   fill       {"text":"Nước sôi ở [100|một trăm] °C"}                 ([đáp án|đáp án khác])
--   group      {"groups":[{"name":"Vật dẫn điện","items":["Đồng","Nhôm"]}]}
--   flashcard  {"cards":[{"front":"...","back":"..."}]}                 (không chấm)
--   worksheet  {"intro":"...","fields":[{"label":"...","type":"text|long|number"}]}   (GV xem, nhận xét)
create table if not exists activities (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  teacher_id   uuid references teachers(id) on delete set null,
  kind         text not null check (kind in ('quiz','truefalse','match','order','fill','group','flashcard','worksheet')),
  title        text not null check (length(btrim(title)) between 1 and 200),
  instructions text,
  subject      text,
  grades       text,
  program      text check (program in ('CT1','CT2','CT3','CT4','CT5')),
  content      jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  is_template  boolean not null default false,
  status       text not null default 'draft' check (status in ('draft','published')),
  source_id    uuid references activities(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists activities_org_teacher on activities (org_id, teacher_id);
drop trigger if exists activities_touch on activities;
create trigger activities_touch before update on activities for each row execute function public.touch_updated_at();

-- Chuẩn hoá câu trả lời dạng chữ: bỏ khoảng trắng thừa, không phân biệt hoa thường
create or replace function public.act_norm(t text) returns text
language sql immutable as $$ select lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))) $$;

-- Kiểm tra cấu trúc nội dung; trả về câu lỗi (null = hợp lệ)
create or replace function public.activity_problem(p_kind text, c jsonb) returns text
language plpgsql immutable as $$
declare e jsonb; i int := 0; n int;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return 'Nội dung không hợp lệ'; end if;
  case p_kind
  when 'quiz' then
    if jsonb_typeof(c->'items') <> 'array' or jsonb_array_length(c->'items') not between 1 and 50 then return 'Cần 1–50 câu hỏi'; end if;
    for e in select * from jsonb_array_elements(c->'items') loop
      i := i + 1;
      if public.act_norm(e->>'q') = '' then return format('Câu %s chưa có nội dung', i); end if;
      if jsonb_typeof(e->'options') <> 'array' or jsonb_array_length(e->'options') not between 2 and 6 then return format('Câu %s cần 2–6 phương án', i); end if;
      if exists (select 1 from jsonb_array_elements_text(e->'options') o where public.act_norm(o) = '') then return format('Câu %s có phương án trống', i); end if;
      if jsonb_typeof(e->'answer') <> 'number' or (e->>'answer')::int not between 0 and jsonb_array_length(e->'options') - 1 then return format('Câu %s chưa chọn đáp án', i); end if;
    end loop;
  when 'truefalse' then
    if jsonb_typeof(c->'items') <> 'array' or jsonb_array_length(c->'items') not between 1 and 50 then return 'Cần 1–50 nhận định'; end if;
    for e in select * from jsonb_array_elements(c->'items') loop
      i := i + 1;
      if public.act_norm(e->>'q') = '' then return format('Nhận định %s chưa có nội dung', i); end if;
      if jsonb_typeof(e->'answer') <> 'boolean' then return format('Nhận định %s chưa chọn Đúng/Sai', i); end if;
    end loop;
  when 'match' then
    if jsonb_typeof(c->'pairs') <> 'array' or jsonb_array_length(c->'pairs') not between 2 and 20 then return 'Cần 2–20 cặp'; end if;
    for e in select * from jsonb_array_elements(c->'pairs') loop
      i := i + 1;
      if public.act_norm(e->>'left') = '' or public.act_norm(e->>'right') = '' then return format('Cặp %s còn trống', i); end if;
    end loop;
    if (select count(distinct public.act_norm(x->>'right')) from jsonb_array_elements(c->'pairs') x) < jsonb_array_length(c->'pairs') then
      return 'Vế phải của các cặp phải khác nhau'; end if;
  when 'order' then
    if jsonb_typeof(c->'steps') <> 'array' or jsonb_array_length(c->'steps') not between 2 and 20 then return 'Cần 2–20 bước'; end if;
    if exists (select 1 from jsonb_array_elements_text(c->'steps') s where public.act_norm(s) = '') then return 'Có bước còn trống'; end if;
    if (select count(distinct public.act_norm(s)) from jsonb_array_elements_text(c->'steps') s) < jsonb_array_length(c->'steps') then
      return 'Các bước phải khác nhau'; end if;
  when 'fill' then
    if public.act_norm(c->>'text') = '' then return 'Chưa có đoạn văn'; end if;
    select count(*) into n from regexp_matches(c->>'text', '\[([^\]]*)\]', 'g') m;
    if n = 0 then return 'Đánh dấu chỗ trống bằng [đáp án]'; end if;
    if n > 30 then return 'Tối đa 30 chỗ trống'; end if;
    if exists (select 1 from regexp_matches(c->>'text', '\[([^\]]*)\]', 'g') m where public.act_norm(m[1]) = '') then return 'Có chỗ trống chưa ghi đáp án'; end if;
  when 'group' then
    if jsonb_typeof(c->'groups') <> 'array' or jsonb_array_length(c->'groups') not between 2 and 6 then return 'Cần 2–6 nhóm'; end if;
    for e in select * from jsonb_array_elements(c->'groups') loop
      i := i + 1;
      if public.act_norm(e->>'name') = '' then return format('Nhóm %s chưa có tên', i); end if;
      if jsonb_typeof(e->'items') <> 'array' or jsonb_array_length(e->'items') = 0 then return format('Nhóm %s chưa có thẻ', i); end if;
      if exists (select 1 from jsonb_array_elements_text(e->'items') s where public.act_norm(s) = '') then return format('Nhóm %s có thẻ trống', i); end if;
    end loop;
    select count(*) into n from jsonb_array_elements(c->'groups') g, jsonb_array_elements_text(g->'items') s;
    if n > 40 then return 'Tối đa 40 thẻ'; end if;
    if (select count(distinct public.act_norm(s)) from jsonb_array_elements(c->'groups') g, jsonb_array_elements_text(g->'items') s) < n then
      return 'Các thẻ phải khác nhau'; end if;
  when 'flashcard' then
    if jsonb_typeof(c->'cards') <> 'array' or jsonb_array_length(c->'cards') not between 1 and 60 then return 'Cần 1–60 thẻ'; end if;
    if exists (select 1 from jsonb_array_elements(c->'cards') x where public.act_norm(x->>'front') = '' or public.act_norm(x->>'back') = '') then return 'Có thẻ còn trống mặt trước hoặc mặt sau'; end if;
  when 'worksheet' then
    if jsonb_typeof(c->'fields') <> 'array' or jsonb_array_length(c->'fields') not between 1 and 30 then return 'Cần 1–30 mục trả lời'; end if;
    if exists (select 1 from jsonb_array_elements(c->'fields') x where public.act_norm(x->>'label') = '' or coalesce(x->>'type', 'text') not in ('text','long','number')) then
      return 'Có mục trả lời chưa đặt tên'; end if;
  else return 'Loại hoạt động không hợp lệ';
  end case;
  return null;
end $$;

-- Bản xuất bản phải đầy đủ; bản nháp lưu tự do
create or replace function public.activities_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_err text;
begin
  if new.status = 'published' then
    v_err := public.activity_problem(new.kind, new.content);
    if v_err is not null then raise exception 'Chưa xuất bản được: %', v_err using errcode = '23514'; end if;
  end if;
  return new;
end $$;
drop trigger if exists activities_guard on activities;
create trigger activities_guard before insert or update on activities for each row execute function public.activities_guard();

alter table activities enable row level security;
-- Giống bài giảng (015): nhân sự đọc bài đã xuất bản, bài mẫu, bài của mình; quản trị đọc tất cả trong trường.
-- Sở / cấp trên đọc được (theo can_access_org) để thống kê.
create policy activities_staff_read on activities for select to authenticated
  using (public.can_access_org(org_id) and public.is_staff()
         and (status = 'published' or is_template or teacher_id = public.my_teacher_id() or public.is_admin() or public.is_authority()));
create policy activities_owner_insert on activities for insert to authenticated
  with check (org_id = public.my_org_id() and public.is_staff()
    and ((teacher_id = public.my_teacher_id() and not is_template) or public.is_admin()));
create policy activities_owner_update on activities for update to authenticated
  using (org_id = public.my_org_id() and (teacher_id = public.my_teacher_id() or public.is_admin()))
  with check (org_id = public.my_org_id() and ((teacher_id = public.my_teacher_id() and not is_template) or public.is_admin()));
create policy activities_owner_delete on activities for delete to authenticated
  using (org_id = public.my_org_id() and (teacher_id = public.my_teacher_id() or public.is_admin()));

-- Xáo trộn ổn định (cùng hạt giống → cùng thứ tự); không bao giờ trả lại đúng thứ tự gốc nếu có ≥ 2 phần tử
create or replace function public.act_shuffle(arr jsonb, seed text) returns jsonb
language plpgsql immutable as $$
declare r jsonb;
begin
  if arr is null or jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) < 2 then return coalesce(arr, '[]'::jsonb); end if;
  select jsonb_agg(v order by md5(seed || ':' || v::text || ':' || o)) into r from jsonb_array_elements(arr) with ordinality x(v, o);
  if r = arr then
    select jsonb_agg(v order by o desc) into r from jsonb_array_elements(arr) with ordinality x(v, o);
  end if;
  return r;
end $$;

-- Đề cho học sinh: bỏ đáp án, xáo thứ tự
create or replace function public.activity_playable(p_kind text, c jsonb, seed text) returns jsonb
language plpgsql immutable as $$
begin
  return case p_kind
    when 'quiz' then jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_build_object('q', e->'q', 'options', e->'options') order by o), '[]') from jsonb_array_elements(c->'items') with ordinality x(e, o)))
    when 'truefalse' then jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_build_object('q', e->'q') order by o), '[]') from jsonb_array_elements(c->'items') with ordinality x(e, o)))
    when 'match' then jsonb_build_object(
      'left', (select coalesce(jsonb_agg(e->'left' order by o), '[]') from jsonb_array_elements(c->'pairs') with ordinality x(e, o)),
      'right', public.act_shuffle((select coalesce(jsonb_agg(e->'right' order by o), '[]') from jsonb_array_elements(c->'pairs') with ordinality x(e, o)), seed))
    when 'order' then jsonb_build_object('steps', public.act_shuffle(c->'steps', seed))
    when 'fill' then jsonb_build_object('pieces', to_jsonb(regexp_split_to_array(c->>'text', '\[[^\]]*\]')))
    when 'group' then jsonb_build_object(
      'groups', (select coalesce(jsonb_agg(g->'name' order by o), '[]') from jsonb_array_elements(c->'groups') with ordinality x(g, o)),
      'items', public.act_shuffle((select coalesce(jsonb_agg(to_jsonb(s)), '[]') from jsonb_array_elements(c->'groups') g, jsonb_array_elements_text(g->'items') s), seed))
    when 'flashcard' then jsonb_build_object('cards', c->'cards')
    when 'worksheet' then jsonb_build_object('intro', c->'intro', 'fields', c->'fields')
    when 'lesson' then jsonb_build_object('slides', (select coalesce(jsonb_agg(e - 'answer' order by o), '[]') from jsonb_array_elements(c->'slides') with ordinality x(e, o)))
    else c end;
end $$;

-- Chấm: {correct, total, results:[bool]}; loại không chấm trả total = 0
--   quiz: [chỉ số phương án] · truefalse: [true/false] · match: [vế phải cho từng vế trái]
--   order: [các bước theo thứ tự học sinh xếp] · fill: [chữ điền từng chỗ trống] · group: {"thẻ": "tên nhóm"}
create or replace function public.activity_grade(p_kind text, c jsonb, a jsonb) returns jsonb
language plpgsql immutable as $$
declare res boolean[] := '{}'; e jsonb; s text; o int; by_item jsonb := '{}'::jsonb;
begin
  a := coalesce(a, 'null'::jsonb);
  case p_kind
  when 'quiz' then
    for e, o in select x, n from jsonb_array_elements(c->'items') with ordinality t(x, n) loop
      res := res || (jsonb_typeof(a->(o::int - 1)) = 'number' and (a->>(o::int - 1))::int = (e->>'answer')::int);
    end loop;
  when 'truefalse' then
    for e, o in select x, n from jsonb_array_elements(c->'items') with ordinality t(x, n) loop
      res := res || (jsonb_typeof(a->(o::int - 1)) = 'boolean' and (a->>(o::int - 1))::boolean = (e->>'answer')::boolean);
    end loop;
  when 'match' then
    for e, o in select x, n from jsonb_array_elements(c->'pairs') with ordinality t(x, n) loop
      res := res || coalesce(public.act_norm(a->>(o::int - 1)) = public.act_norm(e->>'right') and a->>(o::int - 1) is not null, false);
    end loop;
  when 'order' then
    for s, o in select x, n from jsonb_array_elements_text(c->'steps') with ordinality t(x, n) loop
      res := res || coalesce(public.act_norm(a->>(o::int - 1)) = public.act_norm(s) and a->>(o::int - 1) is not null, false);
    end loop;
  when 'fill' then
    for s, o in select m[1], n from regexp_matches(c->>'text', '\[([^\]]*)\]', 'g') with ordinality t(m, n) loop
      res := res || coalesce(a->>(o::int - 1) is not null and public.act_norm(a->>(o::int - 1)) in
        (select public.act_norm(alt) from unnest(string_to_array(s, '|')) alt), false);
    end loop;
  when 'group' then
    for e in select * from jsonb_array_elements(c->'groups') loop
      for s in select * from jsonb_array_elements_text(e->'items') loop
        res := res || coalesce(jsonb_typeof(a) = 'object' and public.act_norm(a->>s) = public.act_norm(e->>'name'), false);
        by_item := by_item || jsonb_build_object(s, res[array_length(res, 1)]);
      end loop;
    end loop;
  else
    return jsonb_build_object('correct', 0, 'total', 0, 'results', '[]'::jsonb);
  end case;
  return jsonb_build_object('correct', (select count(*) from unnest(res) r where r), 'total', coalesce(array_length(res, 1), 0), 'results', to_jsonb(res))
    || case when p_kind = 'group' then jsonb_build_object('by_item', by_item) else '{}'::jsonb end;
end $$;
grant execute on function public.activity_grade(text, jsonb, jsonb), public.activity_playable(text, jsonb, text),
  public.activity_problem(text, jsonb), public.act_norm(text), public.act_shuffle(jsonb, text) to authenticated;

-- ===== 2. Học trước & tự học =====
create table if not exists self_study_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  class_id       uuid not null references classes(id) on delete cascade,
  teacher_id     uuid references teachers(id) on delete set null,
  kind           text not null check (kind in ('activity','lesson','link')),
  activity_id    uuid references activities(id) on delete set null,
  lesson_plan_id uuid references lesson_plans(id) on delete set null,
  topic_id       uuid references class_topics(id) on delete set null,
  url            text,
  title          text not null check (length(btrim(title)) between 1 and 200),
  note           text,
  mode           text not null default 'before' check (mode in ('before','practice')),   -- học trước tiết / tự luyện
  for_date       date,                       -- học trước cho tiết ngày nào
  opens_at       timestamptz not null default now(),
  due_at         timestamptz,
  max_attempts   int not null default 0 check (max_attempts between 0 and 20),   -- 0 = không giới hạn
  status         text not null default 'open' check (status in ('draft','open','closed')),
  activity_kind  text,                       -- loại hoạt động lúc giao (đọc nhanh, không lộ đáp án)
  created_at     timestamptz not null default now(),
  check (kind <> 'link' or coalesce(url, '') ~* '^https?://'),
  check (due_at is null or due_at > opens_at)
);
create index if not exists self_study_items_class on self_study_items (class_id, opens_at desc);
create index if not exists self_study_items_teacher on self_study_items (teacher_id);

-- Nội dung chụp lúc giao (có đáp án) — học sinh KHÔNG có policy đọc bảng này
create table if not exists self_study_content (
  item_id uuid primary key references self_study_items(id) on delete cascade,
  org_id  uuid not null references organizations(id) on delete cascade,
  kind    text not null,
  content jsonb not null
);

create table if not exists self_study_progress (
  item_id         uuid not null references self_study_items(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  status          text not null default 'started' check (status in ('started','done')),
  attempts        int not null default 0,
  score           numeric(4,1) check (score between 0 and 10),
  best_score      numeric(4,1) check (best_score between 0 and 10),
  correct         int,
  total           int,
  answers         jsonb,
  late            boolean not null default false,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  submitted_at    timestamptz,
  teacher_comment text,
  reviewed_at     timestamptz,
  primary key (item_id, student_id)
);
create index if not exists self_study_progress_student on self_study_progress (student_id);

-- Chụp nội dung khi giao / đổi nguồn
create or replace function public.self_study_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_content jsonb; v_org uuid; v_status text; v_owner uuid; v_tpl boolean; v_err text;
begin
  select org_id into v_org from classes where id = new.class_id;
  new.org_id := v_org;
  if new.kind = 'activity' then
    if new.activity_id is null then raise exception 'Chọn hoạt động cần giao' using errcode = '23514'; end if;
    select kind, content, org_id, status, teacher_id, is_template into v_kind, v_content, v_org, v_status, v_owner, v_tpl
      from activities where id = new.activity_id;
    if v_org is distinct from new.org_id then raise exception 'Hoạt động không thuộc trường này' using errcode = '42501'; end if;
    if v_status <> 'published' and not v_tpl and v_owner is distinct from new.teacher_id then
      raise exception 'Chỉ giao được hoạt động đã xuất bản hoặc của chính mình' using errcode = '42501'; end if;
    v_err := public.activity_problem(v_kind, v_content);
    if v_err is not null then raise exception 'Hoạt động chưa hoàn chỉnh: %', v_err using errcode = '23514'; end if;
    new.activity_kind := v_kind;
  elsif new.kind = 'lesson' then
    if new.lesson_plan_id is null then raise exception 'Chọn bài giảng cần giao' using errcode = '23514'; end if;
    select 'lesson', jsonb_build_object('slides', slides), org_id into v_kind, v_content, v_org from lesson_plans where id = new.lesson_plan_id;
    if v_org is distinct from new.org_id then raise exception 'Bài giảng không thuộc trường này' using errcode = '42501'; end if;
    new.activity_kind := null;
  else
    v_kind := 'link'; v_content := jsonb_build_object('url', new.url); new.activity_kind := null;
  end if;
  if tg_op = 'INSERT' or new.activity_id is distinct from old.activity_id or new.lesson_plan_id is distinct from old.lesson_plan_id
     or new.url is distinct from old.url or new.kind is distinct from old.kind then
    -- Bảng nội dung có khoá ngoại tới item → ghi sau khi item đã có (trigger AFTER bên dưới)
    perform set_config('app.ss_kind', v_kind, true);
    perform set_config('app.ss_content', v_content::text, true);
  else
    perform set_config('app.ss_kind', '', true);
  end if;
  return new;
end $$;
create or replace function public.self_study_snapshot_save() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.ss_kind', true), '') <> '' then
    insert into self_study_content (item_id, org_id, kind, content)
      values (new.id, new.org_id, current_setting('app.ss_kind', true), current_setting('app.ss_content', true)::jsonb)
    on conflict (item_id) do update set kind = excluded.kind, content = excluded.content, org_id = excluded.org_id;
    perform set_config('app.ss_kind', '', true);
  end if;
  return null;
end $$;
drop trigger if exists self_study_snapshot on self_study_items;
create trigger self_study_snapshot before insert or update on self_study_items for each row execute function public.self_study_snapshot();
drop trigger if exists self_study_snapshot_save on self_study_items;
create trigger self_study_snapshot_save after insert or update on self_study_items for each row execute function public.self_study_snapshot_save();

-- Giáo viên chỉ chấm/nhận xét; không sửa câu trả lời, số lần làm của học sinh
create or replace function public.self_study_progress_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.item_id := old.item_id; new.student_id := old.student_id; new.org_id := old.org_id; new.answers := old.answers;
    new.attempts := old.attempts; new.started_at := old.started_at; new.submitted_at := old.submitted_at;
    new.completed_at := old.completed_at; new.late := old.late; new.correct := old.correct; new.total := old.total;
    if new.score is distinct from old.score then new.best_score := greatest(coalesce(old.best_score, 0), coalesce(new.score, 0)); end if;
    if new.teacher_comment is distinct from old.teacher_comment or new.score is distinct from old.score then new.reviewed_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists self_study_progress_guard on self_study_progress;
create trigger self_study_progress_guard before update on self_study_progress for each row execute function public.self_study_progress_guard();

alter table self_study_items enable row level security;
alter table self_study_content enable row level security;
alter table self_study_progress enable row level security;

create policy self_study_items_staff_read on self_study_items for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
create policy self_study_items_student_read on self_study_items for select to authenticated
  using ((select public.is_student()) and class_id = (select public.my_class_id()) and status <> 'draft' and opens_at <= now());
create policy self_study_items_teacher_insert on self_study_items for insert to authenticated
  with check (org_id = (select public.my_org_id()) and public.teaches_class(class_id)
              and (teacher_id = (select public.my_teacher_id()) or (select public.is_admin())));
create policy self_study_items_teacher_update on self_study_items for update to authenticated
  using (org_id = (select public.my_org_id()) and public.teaches_class(class_id))
  with check (org_id = (select public.my_org_id()) and public.teaches_class(class_id));
create policy self_study_items_teacher_delete on self_study_items for delete to authenticated
  using (org_id = (select public.my_org_id()) and public.teaches_class(class_id));

create policy self_study_content_staff_read on self_study_content for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));

create policy self_study_progress_staff_read on self_study_progress for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
create policy self_study_progress_student_read on self_study_progress for select to authenticated
  using ((select public.is_student()) and student_id = (select public.my_student_id()));
create policy self_study_progress_teacher_update on self_study_progress for update to authenticated
  using (org_id = (select public.my_org_id()) and exists (select 1 from self_study_items i where i.id = item_id and public.teaches_class(i.class_id)))
  with check (org_id = (select public.my_org_id()));

-- Khi nào được xem đáp án: hết lượt làm, đã khoá, hoặc quá hạn
create or replace function public.self_study_reveal(i self_study_items, p self_study_progress) returns boolean
language sql stable as $$
  select i.status = 'closed' or (i.due_at is not null and i.due_at < now())
      or (i.max_attempts > 0 and coalesce(p.attempts, 0) >= i.max_attempts)
$$;

-- Học sinh mở bài: đề (không đáp án) + tiến độ của mình (+ đáp án nếu đã được xem)
create or replace function public.self_study_open(p_item uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i self_study_items; c self_study_content; p self_study_progress; v_st uuid := public.my_student_id();
begin
  if not public.is_student() or v_st is null then raise exception 'Chỉ học sinh làm bài tự học' using errcode = '42501'; end if;
  select * into i from self_study_items where id = p_item and class_id = public.my_class_id() and status <> 'draft' and opens_at <= now();
  if not found then raise exception 'Không tìm thấy bài tự học của lớp em' using errcode = '42501'; end if;
  select * into c from self_study_content where item_id = i.id;
  insert into self_study_progress (item_id, student_id, org_id) values (i.id, v_st, i.org_id) on conflict do nothing;
  select * into p from self_study_progress where item_id = i.id and student_id = v_st;
  return jsonb_build_object(
    'kind', c.kind,
    'content', public.activity_playable(c.kind, c.content, i.id::text || v_st::text),
    'progress', jsonb_build_object('status', p.status, 'attempts', p.attempts, 'score', p.score, 'best_score', p.best_score,
      'correct', p.correct, 'total', p.total, 'answers', p.answers, 'teacher_comment', p.teacher_comment, 'completed_at', p.completed_at),
    'attempts_left', case when i.max_attempts = 0 then null else greatest(0, i.max_attempts - p.attempts) end,
    'can_submit', i.status = 'open' and (i.max_attempts = 0 or p.attempts < i.max_attempts),
    'solution', case when public.self_study_reveal(i, p) then c.content end,
    'grade', case when p.answers is not null and c.kind not in ('lesson','link') then public.activity_grade(c.kind, c.content, p.answers) end);
end $$;

-- Học sinh nộp bài: CSDL chấm, ghi tiến độ. Bài giảng / đường dẫn / thẻ ghi nhớ: đánh dấu đã xem.
create or replace function public.self_study_submit(p_item uuid, p_answers jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i self_study_items; c self_study_content; p self_study_progress; v_st uuid := public.my_student_id(); g jsonb; v_score numeric;
begin
  if not public.is_student() or v_st is null then raise exception 'Chỉ học sinh làm bài tự học' using errcode = '42501'; end if;
  select * into i from self_study_items where id = p_item and class_id = public.my_class_id() and status <> 'draft' and opens_at <= now();
  if not found then raise exception 'Không tìm thấy bài tự học của lớp em' using errcode = '42501'; end if;
  if i.status = 'closed' then raise exception 'Thầy cô đã khoá bài này' using errcode = '22023'; end if;
  select * into c from self_study_content where item_id = i.id;
  insert into self_study_progress (item_id, student_id, org_id) values (i.id, v_st, i.org_id) on conflict do nothing;
  select * into p from self_study_progress where item_id = i.id and student_id = v_st for update;
  if i.max_attempts > 0 and p.attempts >= i.max_attempts then raise exception 'Em đã hết lượt làm bài này' using errcode = '22023'; end if;
  if p_answers is not null and length(p_answers::text) > 20000 then raise exception 'Câu trả lời quá dài' using errcode = '22023'; end if;
  g := public.activity_grade(c.kind, c.content, p_answers);
  v_score := case when (g->>'total')::int > 0 then round(10.0 * (g->>'correct')::int / (g->>'total')::int, 1) end;
  update self_study_progress set status = 'done', attempts = attempts + 1, answers = p_answers,
    score = v_score, best_score = case when v_score is null then best_score else greatest(coalesce(best_score, 0), v_score) end,
    correct = case when (g->>'total')::int > 0 then (g->>'correct')::int end, total = case when (g->>'total')::int > 0 then (g->>'total')::int end,
    late = late or (i.due_at is not null and now() > i.due_at),
    submitted_at = now(), completed_at = coalesce(completed_at, now())
  where item_id = i.id and student_id = v_st
  returning * into p;
  return jsonb_build_object('score', p.score, 'best_score', p.best_score, 'correct', p.correct, 'total', p.total,
    'grade', g, 'attempts', p.attempts,
    'attempts_left', case when i.max_attempts = 0 then null else greatest(0, i.max_attempts - p.attempts) end,
    'solution', case when public.self_study_reveal(i, p) then c.content end);
end $$;
revoke all on function public.self_study_open(uuid), public.self_study_submit(uuid, jsonb) from public;
grant execute on function public.self_study_open(uuid), public.self_study_submit(uuid, jsonb) to authenticated;

-- Tổng hợp theo bài: sĩ số, đã mở, đã xong, điểm trung bình (theo quyền đọc của người xem)
create or replace view self_study_stats with (security_invoker = true) as
select i.id as item_id, i.class_id,
  (select count(*) from students s where s.class_id = i.class_id)::int as students,
  count(p.student_id)::int as opened,
  count(p.student_id) filter (where p.status = 'done')::int as done,
  round(avg(p.best_score), 1) as avg_score,
  count(p.student_id) filter (where p.late)::int as late
from self_study_items i left join self_study_progress p on p.item_id = i.id
group by i.id, i.class_id;
grant select on self_study_stats to authenticated;

-- Thông báo học sinh khi bài được mở
create or replace function public.notify_self_study() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    for v in select profile_id from students where class_id = new.class_id and profile_id is not null loop
      perform public.notify_user(v, new.org_id, 'self_study',
        case new.mode when 'before' then 'Học trước: ' else 'Tự học: ' end || new.title,
        case when new.due_at is not null then 'Hạn ' || to_char(new.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') else 'Không giới hạn thời gian' end,
        'Học trước & tự học', 'student', new.id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists self_study_notify on self_study_items;
create trigger self_study_notify after insert or update of status on self_study_items
  for each row execute function public.notify_self_study();

-- ===== 3. Ngày nghỉ & lễ =====
-- org_id là trường (nghỉ riêng của trường) hoặc Sở/Tỉnh/Bộ (áp dụng cho mọi trường trực thuộc).
create table if not exists school_holidays (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 200),
  starts_on  date not null,
  ends_on    date not null,
  note       text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 60)
);
create index if not exists school_holidays_org on school_holidays (org_id, starts_on);
alter table school_holidays enable row level security;
-- Đọc: ngày nghỉ của đơn vị mình, cấp trên (áp xuống) và cấp dưới (để tổng hợp). Học sinh đọc của trường mình và cấp trên.
create policy school_holidays_read on school_holidays for select to authenticated
  using (org_id in (select public.my_org_tree()) or org_id in (select public.my_ancestor_orgs()));
-- Ghi: tại chính đơn vị đang làm việc — trường cần quyền "Năm học & học kỳ" (periods); Sở/Tỉnh/Bộ/Phòng là cán bộ cấp quản lý.
create policy school_holidays_insert on school_holidays for insert to authenticated
  with check (org_id = (select public.my_org_id()) and ((select public.has_perm('periods', 'create')) or (select public.is_authority())));
create policy school_holidays_update on school_holidays for update to authenticated
  using (org_id = (select public.my_org_id()) and ((select public.has_perm('periods', 'edit')) or (select public.is_authority())))
  with check (org_id = (select public.my_org_id()));
create policy school_holidays_delete on school_holidays for delete to authenticated
  using (org_id = (select public.my_org_id()) and ((select public.has_perm('periods', 'delete')) or (select public.is_authority())));

create or replace function public.is_holiday(p_org uuid, p_day date) returns text
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, 0 as d from organizations where id = p_org
    union all select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  ) select h.name from school_holidays h join up on up.id = h.org_id where p_day between h.starts_on and h.ends_on order by up.d limit 1
$$;
grant execute on function public.is_holiday(uuid, date) to authenticated;

-- Sinh buổi dạy (027) + bỏ qua ngày nghỉ của trường và của cấp trên.
-- Tiết tương lai chưa điểm danh rơi vào ngày nghỉ mới khai báo được xoá ở lần gọi kế tiếp (như tiết không còn trong TKB).
create or replace function public.generate_teaching_sessions(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_ins int; v_upd int; v_del int; v_today date := public.vn_today(); v_skip int;
begin
  if v_org is null or not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if (select type from organizations where id = v_org) is distinct from 'school' then
    raise exception 'Chỉ sinh buổi dạy cho trường học' using errcode = '22023';
  end if;
  if not public.org_has_module(v_org, 'timetable') then raise exception 'Đơn vị chưa dùng phân hệ Thời khoá biểu' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 63 ngày)' using errcode = '22023';
  end if;

  create temp table if not exists _ts_src (entry_id uuid, class_id uuid, teacher_id uuid, period_id uuid, room_id uuid,
    day date, year_id uuid, subject text, kind text) on commit drop;
  truncate _ts_src;
  insert into _ts_src
  select distinct on (e.class_id, d.day, e.period_id)
         e.id, e.class_id, e.teacher_id, e.period_id, e.room_id, d.day, d.year_id, e.subject, e.kind
  from (select g::date as day, y.id as year_id
          from generate_series(p_from, p_to, interval '1 day') g
          join academic_years y on y.org_id = v_org and g::date between y.starts_on and y.ends_on
         where extract(isodow from g) between 1 and 6
           and not exists (select 1 from school_holidays h
                            where (h.org_id = v_org or h.org_id in (select public.my_ancestor_orgs()))
                              and g::date between h.starts_on and h.ends_on)) d
  join timetable_entries e on e.org_id = v_org
   and e.weekday = extract(isodow from d.day)::int + 1
   and (e.year_id is null or e.year_id = d.year_id)
  order by e.class_id, d.day, e.period_id, (e.year_id is null), e.id;   -- ưu tiên TKB riêng của học kỳ

  delete from teaching_sessions s
   where s.org_id = v_org and s.session_date between greatest(p_from, v_today) and p_to
     and s.status = 'scheduled' and not s.is_makeup
     and not exists (select 1 from lesson_attendance a where a.session_id = s.id)
     and not exists (select 1 from _ts_src x where x.class_id = s.class_id and x.day = s.session_date and x.period_id = s.period_id);
  get diagnostics v_del = row_count;

  with up as (
    insert into teaching_sessions (org_id, year_id, timetable_entry_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind)
    select v_org, year_id, entry_id, class_id, teacher_id, period_id, room_id, day, subject, kind from _ts_src
    on conflict (class_id, session_date, period_id) do update set
      year_id = excluded.year_id, timetable_entry_id = excluded.timetable_entry_id, teacher_id = excluded.teacher_id,
      room_id = excluded.room_id, subject = excluded.subject, kind = excluded.kind
    where teaching_sessions.status = 'scheduled' and not teaching_sessions.is_makeup and teaching_sessions.session_date >= v_today
      and (teaching_sessions.timetable_entry_id, teaching_sessions.teacher_id, teaching_sessions.room_id, teaching_sessions.subject, teaching_sessions.kind)
          is distinct from (excluded.timetable_entry_id, excluded.teacher_id, excluded.room_id, excluded.subject, excluded.kind)
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  select count(*) into v_skip from generate_series(p_from, p_to, interval '1 day') g
   where extract(isodow from g) between 1 and 6 and public.is_holiday(v_org, g::date) is not null;

  return jsonb_build_object('created', v_ins, 'updated', v_upd, 'removed', v_del, 'holidays', v_skip);
end $$;
revoke all on function public.generate_teaching_sessions(date, date) from public;
grant execute on function public.generate_teaching_sessions(date, date) to authenticated;

-- ===== 4. Nhật ký thay đổi (021) cho ngày nghỉ và bài tự học =====
create or replace function public.audit_s6() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end; v_sum text;
begin
  if to_regclass('public.audit_log') is null then return null; end if;
  if tg_table_name = 'school_holidays' then
    v_sum := case tg_op when 'INSERT' then 'Thêm ngày nghỉ ' when 'DELETE' then 'Xoá ngày nghỉ ' else 'Sửa ngày nghỉ ' end
      || (r->>'name') || ' (' || to_char((r->>'starts_on')::date, 'DD/MM/YYYY')
      || case when r->>'ends_on' <> r->>'starts_on' then '–' || to_char((r->>'ends_on')::date, 'DD/MM/YYYY') else '' end || ')';
  else
    v_sum := case tg_op when 'INSERT' then 'Giao bài tự học ' when 'DELETE' then 'Xoá bài tự học ' else 'Sửa bài tự học ' end
      || (r->>'title') || ' · ' || coalesce((select name from classes where id = (r->>'class_id')::uuid), '?');
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), (r->>'org_id')::uuid, tg_table_name, r->>'id', lower(tg_op), v_sum, r);
  return null;
end $$;
drop trigger if exists school_holidays_audit on school_holidays;
create trigger school_holidays_audit after insert or update or delete on school_holidays for each row execute function public.audit_s6();
drop trigger if exists self_study_items_audit on self_study_items;
create trigger self_study_items_audit after insert or delete on self_study_items for each row execute function public.audit_s6();
