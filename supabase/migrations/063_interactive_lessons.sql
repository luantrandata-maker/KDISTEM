-- 063. Bài giảng tương tác, kho hoạt động mở rộng, thiết bị trong gói STEM (Phân hệ 2)
--  • lesson_plans.lesson: bài giảng tương tác theo tiến trình CT1–CT5 — mỗi giai đoạn gồm các khối nội dung
--    (tiêu đề, đoạn văn, hình, video, tệp, mô phỏng 2D, giáo cụ ảo, kéo–thả, câu hỏi, code, hoạt động nhóm, game, rubric).
--    Có ảnh bìa (cover_url). Nằm trong nội dung giáo án: khoá khi chờ duyệt / đã xuất bản, lưu vào phiên bản.
--  • edu_program_units.lesson: nội dung từng buổi học của chương trình (Thư viện STEM → chủ đề → buổi học).
--  • activities: thêm 5 loại — đường đua tri thức (race, chấm như trắc nghiệm), vòng quay may mắn (wheel),
--    chia đội (teams), đồng hồ thử thách (timer), mô phỏng 2D / giáo cụ ảo (sim).
--  • package_devices: danh sách thiết bị trong hợp đồng gói STEM (đơn vị, số lượng, số seri, đơn giá, thành tiền).
-- Cần chạy sau 062.

-- ===== 1. Bài giảng tương tác trong giáo án =====
alter table lesson_plans add column if not exists lesson jsonb not null default '{}'::jsonb,
  add column if not exists cover_url text;
alter table lesson_plans drop constraint if exists lesson_plans_lesson_check;
alter table lesson_plans add constraint lesson_plans_lesson_check check (jsonb_typeof(lesson) = 'object'
  and (not lesson ? 'phases' or jsonb_typeof(lesson->'phases') = 'array'));
alter table lesson_plans drop constraint if exists lesson_plans_cover_check;
alter table lesson_plans add constraint lesson_plans_cover_check check (cover_url is null or cover_url ~ '^https?://' or cover_url ~ '^/');

-- Số khối của một bài giảng tương tác
create or replace function public.lesson_block_count(l jsonb) returns int
language sql immutable as $$
  select coalesce((select sum(jsonb_array_length(coalesce(p->'blocks', '[]'))) from jsonb_array_elements(
    case when jsonb_typeof(l->'phases') = 'array' then l->'phases' else '[]'::jsonb end) p), 0)::int
$$;

create or replace function public.lesson_plan_content(p lesson_plans) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', p.title, 'subject', p.subject, 'grades', p.grades, 'program', p.program, 'summary', p.summary,
    'slides', p.slides, 'template_id', p.template_id, 'doc', p.doc, 'steps', p.steps, 'program_id', p.program_id, 'unit_id', p.unit_id,
    'library_ids', to_jsonb(p.library_ids), 'rubric_ids', to_jsonb(p.rubric_ids), 'norm_id', p.norm_id, 'norm_adjust', p.norm_adjust, 'periods', p.periods,
    'lesson', p.lesson, 'cover_url', p.cover_url)
$$;

-- Kiểm tra cấu trúc bài giảng tương tác: tối đa 12 giai đoạn, 200 khối, mỗi khối có loại hợp lệ
create or replace function public.lesson_plans_lesson_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.lesson ? 'phases' then
    if jsonb_array_length(new.lesson->'phases') > 12 then raise exception 'Bài giảng tối đa 12 giai đoạn' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(new.lesson->'phases') p where jsonb_typeof(coalesce(p->'blocks', '[]')) <> 'array') then
      raise exception 'Giai đoạn bài giảng không hợp lệ' using errcode = '22023';
    end if;
    if public.lesson_block_count(new.lesson) > 200 then raise exception 'Bài giảng tối đa 200 khối nội dung' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(new.lesson->'phases') p, jsonb_array_elements(coalesce(p->'blocks', '[]')) b
                where coalesce(b->>'type', '') not in ('heading', 'text', 'image', 'video', 'file', 'link', 'sim', 'tool', 'order', 'quiz', 'code', 'group', 'game', 'activity', 'rubric')) then
      raise exception 'Bài giảng có khối nội dung không hợp lệ' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lesson_plans_lesson_guard on lesson_plans;
create trigger lesson_plans_lesson_guard before insert or update of lesson on lesson_plans for each row execute function public.lesson_plans_lesson_guard();

-- Xuất bản: chấp nhận giáo án chỉ có bài giảng tương tác
create or replace function public.lesson_plan_publish(p_plan uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; v int;
begin
  select * into p from lesson_plans where id = p_plan for update;
  if p.id is null or not public.lesson_plan_can_edit(p) then raise exception 'Bạn không xuất bản được giáo án này' using errcode = '42501'; end if;
  if p.status not in ('draft', 'editing', 'approved', 'rejected') then raise exception 'Giáo án không ở trạng thái xuất bản được' using errcode = '22023'; end if;
  if p.status <> 'approved' and not p.is_template and not public.is_admin() and public.lesson_review_required(p.org_id) then
    raise exception 'Trường yêu cầu duyệt giáo án — gửi duyệt trước khi xuất bản' using errcode = '42501';
  end if;
  if jsonb_array_length(p.slides) = 0 and jsonb_array_length(p.steps) = 0 and p.doc = '{}'::jsonb and public.lesson_block_count(p.lesson) = 0 then
    raise exception 'Giáo án chưa có nội dung' using errcode = '22023';
  end if;
  v := p.version_no + 1;
  perform set_config('app.lesson_engine', 'on', true);
  update lesson_plans set status = 'published', version_no = v, published_at = now() where id = p.id;
  perform set_config('app.lesson_engine', '', true);
  insert into lesson_plan_versions (plan_id, version_no, snapshot, note) values (p.id, v, public.lesson_plan_content(p), nullif(trim(p_note), ''));
  return v;
end $$;

create or replace function public.lesson_plan_restore(p_plan uuid, p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; s jsonb;
begin
  select * into p from lesson_plans where id = p_plan for update;
  if p.id is null or not public.lesson_plan_can_edit(p) then raise exception 'Bạn không sửa được giáo án này' using errcode = '42501'; end if;
  if p.status not in ('draft', 'editing', 'rejected') then raise exception 'Tạo phiên bản mới trước khi khôi phục' using errcode = '22023'; end if;
  select snapshot into s from lesson_plan_versions where plan_id = p_plan and version_no = p_version;
  if s is null then raise exception 'Không có phiên bản này' using errcode = '22023'; end if;
  update lesson_plans set title = s->>'title', subject = s->>'subject', grades = s->>'grades', program = s->>'program', summary = s->>'summary',
         slides = coalesce(s->'slides', '[]'), template_id = (s->>'template_id')::uuid, doc = coalesce(s->'doc', '{}'),
         steps = coalesce(s->'steps', '[]'), program_id = (s->>'program_id')::uuid, unit_id = (s->>'unit_id')::uuid,
         library_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(s->'library_ids') x), '{}'),
         rubric_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(s->'rubric_ids') x), '{}'),
         norm_id = (s->>'norm_id')::uuid, norm_adjust = coalesce(s->'norm_adjust', '[]'), periods = (s->>'periods')::smallint,
         lesson = coalesce(s->'lesson', '{}'), cover_url = s->>'cover_url'
   where id = p.id;
end $$;

create or replace function public.lesson_plan_clone(p_plan uuid, p_title text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; v_teacher uuid := public.my_teacher_id(); v_org uuid := public.my_org_id(); v_new uuid;
begin
  select * into p from lesson_plans where id = p_plan;
  if p.id is null or p.org_id <> v_org or not public.is_staff()
     or not (p.status = 'published' or p.is_template or p.teacher_id = v_teacher or public.is_admin()) then
    raise exception 'Không nhân bản được giáo án này' using errcode = '42501';
  end if;
  if v_teacher is null and not public.is_admin() then raise exception 'Chỉ giáo viên hoặc quản trị trường nhân bản giáo án' using errcode = '42501'; end if;
  if p.library_item_id is not null and (select usage_rights from library_items where id = p.library_item_id) = 'use' and p.teacher_id is distinct from v_teacher then
    raise exception 'Học liệu gốc chỉ được dùng nguyên bản, không nhân bản để chỉnh sửa' using errcode = '42501';
  end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, from_package, is_template, status, summary, slides, source_id,
                            library_item_id, library_version, template_id, doc, steps, program_id, unit_id, library_ids, rubric_ids, norm_id, norm_adjust, periods,
                            lesson, cover_url)
  values (p.org_id, v_teacher, coalesce(nullif(trim(p_title), ''), regexp_replace(p.title, '^Mẫu:\s*', '') || case when p.teacher_id = v_teacher then ' (bản sao)' else '' end),
          p.subject, p.grades, p.program, p.from_package, v_teacher is null, 'draft', p.summary, p.slides, p.id,
          p.library_item_id, p.library_version, p.template_id, p.doc, p.steps, p.program_id, p.unit_id, p.library_ids, p.rubric_ids, p.norm_id, p.norm_adjust, p.periods,
          p.lesson, p.cover_url)
  returning id into v_new;
  return v_new;
end $$;

-- ===== 2. Nội dung buổi học trong chương trình giáo dục =====
alter table edu_program_units add column if not exists lesson jsonb not null default '{}'::jsonb;
alter table edu_program_units drop constraint if exists edu_program_units_lesson_check;
alter table edu_program_units add constraint edu_program_units_lesson_check check (jsonb_typeof(lesson) = 'object'
  and (not lesson ? 'phases' or jsonb_typeof(lesson->'phases') = 'array'));

-- ===== 3. Hoạt động: đường đua, vòng quay, chia đội, đồng hồ, mô phỏng =====
--   race   {"items":[{"q":"...","options":["..."],"answer":0}],"seconds":20}   (chấm như trắc nghiệm)
--   wheel  {"names":["..."],"questions":["..."]}                              (không chấm)
--   teams  {"names":["..."],"teams":4}                                        (không chấm)
--   timer  {"seconds":300,"task":"..."}                                       (không chấm)
--   sim    {"model":"circuit_series|circuit_parallel|pendulum|lever|ruler|scale|thermometer","params":{},"task":"..."}
alter table activities drop constraint if exists activities_kind_check;
alter table activities add constraint activities_kind_check
  check (kind in ('quiz','truefalse','match','order','fill','group','flashcard','worksheet','race','wheel','teams','timer','sim'));

create or replace function public.activity_problem(p_kind text, c jsonb) returns text
language plpgsql immutable as $$
declare e jsonb; i int := 0; n int;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return 'Nội dung không hợp lệ'; end if;
  case p_kind
  when 'quiz', 'race' then
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
  when 'wheel' then
    if jsonb_typeof(c->'names') <> 'array' or (select count(*) from jsonb_array_elements_text(c->'names') s where public.act_norm(s) <> '') not between 2 and 60 then
      return 'Vòng quay cần 2–60 tên học sinh / nhóm'; end if;
  when 'teams' then
    if jsonb_typeof(c->'names') <> 'array' or (select count(*) from jsonb_array_elements_text(c->'names') s where public.act_norm(s) <> '') not between 2 and 60 then
      return 'Cần 2–60 tên học sinh'; end if;
    if jsonb_typeof(c->'teams') <> 'number' or (c->>'teams')::int not between 2 and 8 then return 'Số đội 2–8'; end if;
  when 'timer' then
    if jsonb_typeof(c->'seconds') <> 'number' or (c->>'seconds')::int not between 10 and 3600 then return 'Thời gian 10–3600 giây'; end if;
  when 'sim' then
    if coalesce(c->>'model', '') not in ('circuit_series','circuit_parallel','pendulum','lever','ruler','scale','thermometer') then return 'Chưa chọn mô phỏng'; end if;
  else return 'Loại hoạt động không hợp lệ';
  end case;
  return null;
end $$;

create or replace function public.activity_playable(p_kind text, c jsonb, seed text) returns jsonb
language plpgsql immutable as $$
begin
  return case p_kind
    when 'quiz' then jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_build_object('q', e->'q', 'options', e->'options') order by o), '[]') from jsonb_array_elements(c->'items') with ordinality x(e, o)))
    when 'race' then jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_build_object('q', e->'q', 'options', e->'options') order by o), '[]') from jsonb_array_elements(c->'items') with ordinality x(e, o)))
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

create or replace function public.activity_grade(p_kind text, c jsonb, a jsonb) returns jsonb
language plpgsql immutable as $$
declare res boolean[] := '{}'; e jsonb; s text; o int; by_item jsonb := '{}'::jsonb;
begin
  a := coalesce(a, 'null'::jsonb);
  case p_kind
  when 'quiz', 'race' then
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

-- ===== 4. Thiết bị trong gói STEM =====
create table if not exists package_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  package_id uuid not null references stem_packages(id) on delete cascade,
  seq int not null default 1,
  supplier text,                                   -- nhà cung cấp (nhóm dòng trong bảng)
  name text not null check (length(btrim(name)) between 1 and 200),
  spec text,                                       -- thông số kỹ thuật
  unit text not null default 'chiếc',
  qty int not null default 1 check (qty between 0 and 100000),
  unit_price numeric(14,0) not null default 0 check (unit_price >= 0),
  serials text[] not null default '{}',
  image_url text check (image_url is null or image_url ~ '^https?://' or image_url ~ '^/'),
  created_at timestamptz not null default now()
);
create index if not exists package_devices_pkg on package_devices (package_id, seq);

create or replace function public.package_devices_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id is distinct from (select org_id from stem_packages where id = new.package_id) then
    raise exception 'Thiết bị phải thuộc cùng đơn vị với gói' using errcode = '22023';
  end if;
  new.name := btrim(new.name); new.serials := array(select btrim(s) from unnest(new.serials) s where btrim(s) <> '');
  return new;
end $$;
drop trigger if exists package_devices_guard on package_devices;
create trigger package_devices_guard before insert or update on package_devices for each row execute function public.package_devices_guard();

-- Cập nhật số thiết bị của gói theo bảng thiết bị
create or replace function public.package_devices_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.package_id, old.package_id);
begin
  update stem_packages set devices = coalesce((select sum(qty) from package_devices where package_id = v), 0) where id = v;
  return null;
end $$;
drop trigger if exists package_devices_count on package_devices;
create trigger package_devices_count after insert or update or delete on package_devices for each row execute function public.package_devices_count();

alter table package_devices enable row level security;
drop policy if exists package_devices_read on package_devices;
create policy package_devices_read on package_devices for select to authenticated using (org_id in (select public.my_org_tree()) and (select public.is_staff()));
drop policy if exists package_devices_insert on package_devices;
create policy package_devices_insert on package_devices for insert to authenticated with check (org_id in (select public.my_org_tree()) and (select public.has_perm('packages', 'create')));
drop policy if exists package_devices_update on package_devices;
create policy package_devices_update on package_devices for update to authenticated using (org_id in (select public.my_org_tree()) and (select public.has_perm('packages', 'edit')))
  with check (org_id in (select public.my_org_tree()) and (select public.has_perm('packages', 'edit')));
drop policy if exists package_devices_delete on package_devices;
create policy package_devices_delete on package_devices for delete to authenticated using (org_id in (select public.my_org_tree()) and (select public.has_perm('packages', 'delete')));
drop policy if exists package_devices_platform on package_devices;
create policy package_devices_platform on package_devices for all to authenticated using ((select public.is_platform_admin()) and org_id = public.platform_org_id())
  with check ((select public.is_platform_admin()) and org_id = public.platform_org_id());
grant select, insert, update, delete on package_devices to authenticated;

-- Sao chép gói (đặt mua từ danh mục KDI) mang theo danh sách thiết bị
create or replace function public.copy_stem_package(p_src uuid, p_org uuid, p_catalog boolean default null, p_order_no text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new uuid; t record; v_topic uuid;
begin
  insert into stem_packages (org_id, code, name, tier, provider, programs, grades, starts_on, ends_on, contract_no, order_no, topics, devices, sessions,
                             catalog_active, list_price, description, source_package_id)
    select p_org, code, name, tier, coalesce(provider, 'KDI Education'), programs, grades,
           case when p_catalog is null then current_date else starts_on end, case when p_catalog is null then null else ends_on end,
           contract_no, coalesce(p_order_no, order_no), topics, devices, sessions,
           p_catalog, case when p_catalog is null then null else list_price end, description, p_src
      from stem_packages where id = p_src
    returning id into v_new;
  if v_new is null then raise exception 'Không tìm thấy gói nguồn' using errcode = 'P0002'; end if;
  for t in select * from package_topics where package_id = p_src order by seq loop
    insert into package_topics (org_id, package_id, seq, program, title, minutes, grade_assigned)
      values (p_org, v_new, t.seq, t.program, t.title, t.minutes, case when p_catalog is null then null else t.grade_assigned end)
      returning id into v_topic;
    insert into package_topic_sessions (org_id, topic_id, seq, title, minutes)
      select p_org, v_topic, seq, title, minutes from package_topic_sessions where topic_id = t.id;
  end loop;
  insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, image_url)
    select p_org, v_new, seq, supplier, name, spec, unit, qty, unit_price, image_url from package_devices where package_id = p_src;
  return v_new;
end $$;
revoke all on function public.copy_stem_package(uuid, uuid, boolean, text) from public, anon, authenticated;

-- Dữ liệu mẫu (chỉ khi bật app.seed_demo): thiết bị và chủ đề cho các gói mẫu, hoạt động tương tác mới,
-- bài giảng tương tác cho 3 bài mẫu của THCS Phố Hiến, nội dung từng buổi học của các chương trình STEM do KDI ban hành.
do $$
declare
  sch uuid; tuan uuid; pk record; t uuid; i int; u record; ct text; l jsonb; ph jsonb; flow jsonb; topic text; blocks jsonb; k int; sim jsonb; obj text;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into sch from organizations where code = 'THCS-PH';
  select id into tuan from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn' limit 1;

  -- ===== 1. Gói STEM: thiết bị trong hợp đồng =====
  for pk in select * from stem_packages p where not exists (select 1 from package_devices d where d.package_id = p.id) loop
    if pk.name like 'Gói STEM Cơ bản%' then
      insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, serials) values
        (pk.org_id, pk.id, 1, pk.provider, 'Laptop giáo viên Dell Inspiron 15', 'Intel Core i5-1335U / 8 GB RAM / 512 GB SSD / 15.6" FHD IPS / Win 11 Pro', 'chiếc', 1, 16490000, '{DL-INS-2025-001}'),
        (pk.org_id, pk.id, 2, pk.provider, 'Bộ kit lập trình Arduino Uno R3', 'Arduino Uno R3 + breadboard + LED + cảm biến nhiệt độ, ánh sáng, siêu âm (HC-SR04), còi buzzer, dây jumper', 'bộ', 30, 850000, '{}'),
        (pk.org_id, pk.id, 3, pk.provider, 'Máy tính bảng Samsung Galaxy Tab A9+', '11" TFT / Snapdragon 695 / 8 GB RAM / WiFi 6 / Android 13 / Bảo vệ mắt TÜV', 'chiếc', 30, 7490000, '{}'),
        (pk.org_id, pk.id, 4, pk.provider, 'Màn hình tương tác SMART Board MX275-V4', '75" 4K UHD / Multi-touch 20 điểm / iQ Built-in / Bút thông minh kèm theo', 'chiếc', 1, 48500000, '{SB-MX275-001}');
    elsif pk.name like 'Gói STEM Nâng cao%' then
      insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, serials) values
        (pk.org_id, pk.id, 1, pk.provider, 'Bộ cảm biến IoT Arduino MKR WiFi 1010', 'Arduino MKR WiFi 1010 + cảm biến nhiệt độ – độ ẩm DHT22 + cảm biến bụi PM2.5 + cảm biến CO2 MH-Z19B + module LCD 16×2', 'bộ', 30, 2850000, '{}'),
        (pk.org_id, pk.id, 2, pk.provider, 'Màn hình tương tác Promethean ActivePanel 65"', '65" 4K / Multi-touch 40 điểm / Android 11 / WiFi 6 / Bluetooth 5.0', 'chiếc', 2, 32000000, '{PA-65-2025-001,PA-65-2025-002}'),
        (pk.org_id, pk.id, 3, pk.provider, 'Máy tính bảng Lenovo Tab P11 Pro Gen 2', '11.2" OLED / Snapdragon 870 / 6 GB RAM / 128 GB / WiFi 6 / Android 12L', 'chiếc', 30, 8990000, '{}');
    elsif pk.name like 'Gói STEM THCS Toàn diện%' then
      insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, serials) values
        (pk.org_id, pk.id, 1, pk.provider, 'Robot lập trình mBot', 'mBot v1.1 Bluetooth, cảm biến dò line, siêu âm; lập trình mBlock (Scratch / Python)', 'bộ', 30, 2150000, '{}'),
        (pk.org_id, pk.id, 2, pk.provider, 'Robot Lego SPIKE Prime', 'Hub 6 cổng, 3 động cơ, cảm biến màu, khoảng cách, lực; 528 chi tiết', 'bộ', 10, 9800000, '{}'),
        (pk.org_id, pk.id, 3, pk.provider, 'Bộ mạch Arduino Starter', 'Arduino Uno R3, breadboard, 15 loại linh kiện và cảm biến cơ bản', 'bộ', 30, 850000, '{}'),
        (pk.org_id, pk.id, 4, pk.provider, 'Kit cảm biến IoT + Gateway', 'ESP32, DHT22, độ ẩm đất, ánh sáng, relay; gateway WiFi gửi dữ liệu lên ứng dụng', 'bộ', 15, 2850000, '{}'),
        (pk.org_id, pk.id, 5, pk.provider, 'Máy in 3D Creality Ender-3 V3', 'Khổ in 220×220×250 mm, đầu phun 0.4 mm, nhựa PLA', 'chiếc', 2, 8900000, '{CR-E3V3-001,CR-E3V3-002}'),
        (pk.org_id, pk.id, 6, pk.provider, 'Laptop giáo viên Dell Inspiron 15', 'Intel Core i5 / 8 GB RAM / 512 GB SSD / 15.6" FHD', 'chiếc', 2, 16490000, '{DL-INS-2025-011,DL-INS-2025-012}'),
        (pk.org_id, pk.id, 7, pk.provider, 'Màn hình tương tác SMART Board MX275-V4', '75" 4K UHD / Multi-touch 20 điểm', 'chiếc', 1, 48500000, '{SB-MX275-011}'),
        (pk.org_id, pk.id, 8, pk.provider, 'Máy bay không người lái EDU', 'Drone giáo dục lập trình được, camera 720p, khung bảo vệ cánh', 'chiếc', 10, 3200000, '{}'),
        (pk.org_id, pk.id, 9, pk.provider, 'Bộ thí nghiệm Hoá học cơ bản', 'Dụng cụ thuỷ tinh, đèn cồn, giá ống nghiệm, hoá chất an toàn cho THCS', 'bộ', 15, 1600000, '{}'),
        (pk.org_id, pk.id, 10, pk.provider, 'Bộ cảm biến đa năng STEM', 'Cảm biến nhiệt độ, pH, lực, chuyển động; kết nối máy tính bảng qua Bluetooth', 'bộ', 4, 6500000, '{}');
    end if;
  end loop;

  -- ===== 2. Gói STEM: nội dung chương trình cho gói chưa có chủ đề =====
  for pk in select * from stem_packages p where not exists (select 1 from package_topics x where x.package_id = p.id) and (p.name like 'Gói STEM Cơ bản%' or p.name like 'Gói STEM Nâng cao%') loop
    if pk.name like 'Gói STEM Cơ bản%' then
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 1, 'CT1', 'Lập trình khối Scratch cơ bản', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Làm quen giao diện Scratch 3.0', 45), (pk.org_id, t, 2, 'Chuyển động và hoạt hình nhân vật', 45), (pk.org_id, t, 3, 'Dự án mini: Trò chơi tránh vật cản', 90);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 2, 'CT2', 'Điện tử cơ bản với Arduino', 225) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Giới thiệu Arduino và mạch điện cơ bản', 45), (pk.org_id, t, 2, 'Điều khiển LED và nháy theo nhịp (Blink)', 45),
        (pk.org_id, t, 3, 'Cảm biến siêu âm HC-SR04 — Đo khoảng cách', 45), (pk.org_id, t, 4, 'Dự án: Đèn tự động theo cường độ ánh sáng', 90);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 3, 'CT3', 'Thiết kế 3D với Tinkercad', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Giới thiệu Tinkercad và tư duy thiết kế 3D', 45), (pk.org_id, t, 2, 'Tạo mô hình hộp đựng bút theo kích thước thật', 90), (pk.org_id, t, 3, 'In 3D và kiểm tra chất lượng sản phẩm', 45);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 4, 'CT1,CT2', 'Dự án STEM tích hợp — Nhà thông minh mini', 135) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Thiết kế mô hình và phân công nhóm', 45), (pk.org_id, t, 2, 'Lắp mạch cảm biến, hoàn thiện và trình bày', 90);
    else
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 1, 'CT4', 'Trạm quan trắc môi trường IoT', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Lắp trạm đo dữ liệu', 90), (pk.org_id, t, 2, 'Lập bảng tần số, vẽ biểu đồ', 45), (pk.org_id, t, 3, 'Báo cáo khuyến nghị thông gió lớp học', 45);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 2, 'CT5', 'Nghiên cứu chất lượng không khí lớp học', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Đặt câu hỏi và giả thuyết nghiên cứu', 45), (pk.org_id, t, 2, 'Đo CO2, bụi mịn theo giờ trong tuần', 90), (pk.org_id, t, 3, 'Phân tích số liệu và viết poster', 45);
    end if;
    update stem_packages p set topics = (select count(*) from package_topics y where y.package_id = p.id),
           sessions = (select count(*) from package_topic_sessions x join package_topics y on y.id = x.topic_id where y.package_id = p.id)
     where p.id = pk.id;
  end loop;

  -- ===== 3. Hoạt động tương tác mới của THCS Phố Hiến =====
  if sch is not null and not exists (select 1 from activities where org_id = sch and kind in ('race', 'wheel', 'sim')) then
    insert into activities (org_id, teacher_id, kind, title, instructions, subject, grades, program, content, status) values
      (sch, tuan, 'race', 'Đường đua tri thức — An toàn điện', 'Game đua trả lời nhanh 3 làn: học sinh thi cùng 2 đội máy, trả lời đúng thì xe tiến về đích.', 'Khoa học tự nhiên', '6,7,8,9', 'CT1',
       $j${"seconds":20,"items":[
         {"q":"Vật nào sau đây CÁCH ĐIỆN?","options":["Dây đồng","Nước muối","Găng tay cao su","Thanh nhôm"],"answer":2},
         {"q":"Khi tay ướt có được cắm, rút phích điện không?","options":["Được nếu nhanh tay","Không bao giờ","Được nếu điện yếu","Chỉ khi có người lớn"],"answer":1},
         {"q":"Thiết bị nào tự ngắt điện khi mạch bị quá tải?","options":["Aptomat","Bóng đèn","Quạt trần","Ổ cắm thường"],"answer":0},
         {"q":"Mưa bão ở Hưng Yên, thấy dây điện đứt rơi xuống đường em phải làm gì?","options":["Nhặt dây dẹp vào lề","Tránh xa và báo người lớn","Lấy que gỗ khều thử","Chụp ảnh đăng mạng"],"answer":1},
         {"q":"Đơn vị đo hiệu điện thế là gì?","options":["Ampe (A)","Vôn (V)","Oát (W)","Ôm (Ω)"],"answer":1},
         {"q":"Ổ cắm có nhiều thiết bị công suất lớn cùng lúc sẽ…","options":["Tiết kiệm điện","Dễ quá tải, cháy nổ","Không ảnh hưởng","Điện mạnh hơn"],"answer":1}]}$j$::jsonb, 'published'),
      (sch, tuan, 'race', 'Đường đua số — Phân số & tỉ lệ', 'Ôn phân số, tỉ lệ thức bằng đường đua; mỗi câu 20 giây.', 'Toán', '6,7', 'CT1',
       $j${"seconds":20,"items":[
         {"q":"3/4 của 20 là bao nhiêu?","options":["12","15","16","18"],"answer":1},
         {"q":"Phân số nào bằng 2/3?","options":["4/9","6/9","3/2","5/6"],"answer":1},
         {"q":"Tỉ lệ 1 : 100 000 trên bản đồ, 3 cm ứng với bao nhiêu km?","options":["0,3 km","3 km","30 km","300 km"],"answer":1},
         {"q":"0,25 viết dưới dạng phân số tối giản là","options":["25/100","1/4","2/5","1/25"],"answer":1}]}$j$::jsonb, 'published'),
      (sch, tuan, 'flashcard', 'Lật thẻ ghi nhớ — Linh kiện điện tử', 'Lật thẻ để ôn tên và công dụng linh kiện trước giờ lắp mạch.', 'Công nghệ', '8,9', 'CT4',
       $j${"cards":[{"front":"Điện trở","back":"Hạn chế dòng điện, bảo vệ LED"},{"front":"Tụ điện","back":"Tích và phóng điện, lọc nhiễu"},{"front":"Đi-ốt phát quang (LED)","back":"Phát sáng khi có dòng điện thuận chiều"},{"front":"Biến trở","back":"Thay đổi điện trở để chỉnh độ sáng, âm lượng"},{"front":"Cảm biến quang (LDR)","back":"Điện trở giảm khi ánh sáng mạnh"}]}$j$::jsonb, 'published'),
      (sch, tuan, 'flashcard', 'Lật thẻ ghi nhớ — Tế bào & cơ thể sống', 'Ôn khái niệm tế bào, mô, cơ quan.', 'Khoa học tự nhiên', '6,7', 'CT1',
       $j${"cards":[{"front":"Tế bào","back":"Đơn vị cấu trúc và chức năng của cơ thể sống"},{"front":"Màng tế bào","back":"Bao bọc, kiểm soát chất ra vào tế bào"},{"front":"Nhân tế bào","back":"Chứa vật chất di truyền, điều khiển hoạt động"},{"front":"Lục lạp","back":"Nơi quang hợp ở tế bào thực vật"}]}$j$::jsonb, 'published'),
      (sch, tuan, 'group', 'Nhiệm vụ phân loại — Dẫn điện hay cách điện?', 'Kéo từng vật liệu vào đúng nhóm.', 'Khoa học tự nhiên', '7,8', 'CT1',
       $j${"groups":[{"name":"Dẫn điện","items":["Đồng","Nhôm","Than chì","Nước muối"]},{"name":"Cách điện","items":["Nhựa","Sứ","Gỗ khô","Cao su"]}]}$j$::jsonb, 'published'),
      (sch, tuan, 'group', 'Nhiệm vụ phân loại — Rác tái chế xanh', 'Phân loại rác tại nguồn: tái chế, hữu cơ, còn lại.', 'Khoa học tự nhiên', '6,7', 'CT3',
       $j${"groups":[{"name":"Tái chế","items":["Chai nhựa","Lon nhôm","Giấy báo"]},{"name":"Hữu cơ","items":["Vỏ chuối","Lá cây","Bã chè"]},{"name":"Còn lại","items":["Túi ni lông bẩn","Khẩu trang","Pin cũ"]}]}$j$::jsonb, 'published'),
      (sch, tuan, 'match', 'Ghép cặp khái niệm — Máy cơ đơn giản', 'Ghép máy cơ với tác dụng của nó.', 'Vật lý', '8,9', 'CT2',
       $j${"pairs":[{"left":"Đòn bẩy","right":"Đổi điểm đặt, lợi về lực"},{"left":"Ròng rọc cố định","right":"Đổi hướng của lực kéo"},{"left":"Ròng rọc động","right":"Lợi hai lần về lực"},{"left":"Mặt phẳng nghiêng","right":"Đưa vật lên cao với lực nhỏ hơn"}]}$j$::jsonb, 'published'),
      (sch, tuan, 'wheel', 'Vòng quay may mắn — gọi tên học sinh', 'Quay để chọn ngẫu nhiên bạn lên bảng giải thích kết quả của nhóm.', 'STEM sáng tạo', '6,7,8,9', 'CT3',
       $j${"names":["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6"],"questions":["Vì sao nhóm em chọn vật liệu này?","Sản phẩm của nhóm cải tiến được điều gì?","Nếu làm lại, nhóm em sẽ thay đổi gì?"]}$j$::jsonb, 'published'),
      (sch, tuan, 'teams', 'Chia đội thi đấu STEM', 'Chia lớp thành các đội ngẫu nhiên trước khi thi.', 'STEM sáng tạo', '6,7,8,9', 'CT3',
       $j${"teams":4,"names":["An","Bình","Chi","Dũng","Giang","Hà","Khánh","Lan","Minh","Nam","Oanh","Phúc","Quân","Trang","Uyên","Vy"]}$j$::jsonb, 'published'),
      (sch, tuan, 'timer', 'Đồng hồ thử thách — đếm ngược', 'Đồng hồ lớn trên màn hình cho phần thi lắp ráp.', 'STEM sáng tạo', '6,7,8,9', 'CT4',
       $j${"seconds":300,"task":"Trong 5 phút, mỗi nhóm lắp xong mạch và bật được đèn LED."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng mạch điện nối tiếp', 'Học sinh kéo hiệu điện thế, tháo một bóng để thấy cả dãy cùng tắt.', 'Công nghệ', '7,8', 'CT4',
       $j${"model":"circuit_series","params":{"V":7.3,"R":5.8},"task":"Kéo thanh trượt hiệu điện thế và điện trở, bấm Ngắt công tắc để thấy cả hai bóng cùng tắt."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng mạch điện song song', 'So sánh độ sáng và dòng điện qua nguồn với mạch nối tiếp.', 'Công nghệ', '7,8', 'CT4',
       $j${"model":"circuit_parallel","params":{"V":6,"R":5.8},"task":"Cùng nguồn 6 V, hãy so sánh công suất mỗi bóng với mạch nối tiếp."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng con lắc đơn', 'Đổi chiều dài dây, bấm giờ 10 dao động.', 'Vật lý', '6,7,8,9', 'CT3',
       $j${"model":"pendulum","params":{"L":0.5},"task":"Đo thời gian 10 dao động với 3 chiều dài khác nhau, rút ra quy luật."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng đòn bẩy cân bằng', 'Đặt vật nặng hai bên điểm tựa để đòn bẩy nằm ngang.', 'Vật lý', '8,9', 'CT2',
       $j${"model":"lever","task":"Tìm 3 cách đặt vật để đòn bẩy cân bằng và ghi vào phiếu."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Giáo cụ ảo: Thước đo 20 cm', 'Kéo thanh đo đến đúng số đo yêu cầu.', 'Khoa học tự nhiên', '6', 'CT1',
       $j${"model":"ruler","params":{"target":12.5},"task":"Kéo mép phải thanh xanh sao cho chiều dài đúng 12,5 cm."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Giáo cụ ảo: Cân điện tử và TARE', 'Đặt quả cân cho đủ khối lượng, bấm TARE để hiểu ý nghĩa trừ bì.', 'Khoa học tự nhiên', '6', 'CT1',
       $j${"model":"scale","params":{"target":235},"task":"Đặt cốc lên cân, bấm TARE rồi thêm quả cân sao cho màn hình hiện đúng 235 g."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Giáo cụ ảo: Nhiệt kế', 'Đọc nhiệt độ, đổi sang °F và K.', 'Khoa học tự nhiên', '6', 'CT1',
       $j${"model":"thermometer","params":{"target":37},"task":"Đưa nhiệt kế về nhiệt độ cơ thể người bình thường."}$j$::jsonb, 'published');
  end if;

  -- ===== 4. Bài giảng tương tác cho 3 bài mẫu của THCS Phố Hiến =====
  if sch is not null then
    perform set_config('app.lesson_engine', 'on', true);
    update lesson_plans set program = coalesce(program, 'CT4'), lesson = $j${
      "goals":["Phân biệt mạch nối tiếp và mạch song song qua mô phỏng","Giải thích vì sao tắt một bóng mà cả dãy đèn cùng tắt","Lắp và đo được mạch 1 nối tiếp + 1 song song, ghi số liệu vào phiếu"],
      "tags":["Có mô phỏng 2D","Có game hoá","Có đoạn code"],
      "phases":[
        {"key":"khoi_dong","title":"Khởi động","minutes":8,"blocks":[
          {"id":"m1","type":"heading","text":"Vì sao tắt 1 bóng mà cả dây đèn cùng tắt?"},
          {"id":"m2","type":"text","text":"Dịp Tết, nhà nào cũng treo **dây đèn nháy**. Có dây chỉ cần hỏng 1 bóng là tắt cả dây, có dây hỏng 1 bóng các bóng khác vẫn sáng.\nHôm nay chúng ta sẽ tìm ra nguyên nhân bằng một **mô phỏng mạch điện** ngay trên màn hình."},
          {"id":"m3","type":"sim","model":"circuit_series","title":"Mô phỏng: Mạch điện nối tiếp","task":"Kéo thanh trượt hiệu điện thế và điện trở, bấm Ngắt công tắc, rồi thử Tháo bóng 2.","params":{"V":7.3,"R":5.8}}]},
        {"key":"ly_thuyet","title":"Lý thuyết","minutes":12,"blocks":[
          {"id":"m4","type":"heading","text":"So sánh hai cách mắc bóng đèn"},
          {"id":"m5","type":"sim","model":"circuit_parallel","title":"Mô phỏng: Mạch điện song song","task":"Cùng nguồn 6 V, hãy so sánh công suất mỗi bóng với mạch nối tiếp.","params":{"V":6,"R":5.8}},
          {"id":"m6","type":"order","title":"Phân loại: đặc điểm của từng loại mạch","prompt":"Sắp xếp các bước kiểm tra một mạch đèn bị tắt theo đúng thứ tự.","steps":["Ngắt nguồn điện","Quan sát bóng nào hỏng","Thay bóng hỏng","Đóng nguồn và kiểm tra lại"]}]},
        {"key":"lap_rap","title":"Lắp ráp & Lập trình","minutes":40,"blocks":[
          {"id":"m7","type":"code","lang":"arduino_c","code":"const int PIN_A0 = A0;   // cảm biến dòng\nconst int NGUONG = 520;  // ngưỡng cảnh báo\n\nvoid loop() {\n  int doc = analogRead(PIN_A0);\n  if (doc > NGUONG) {\n    digitalWrite(LED_DO, HIGH);   // quá tải\n    tone(COI, 1200, 300);\n  } else {\n    digitalWrite(LED_DO, LOW);\n  }\n  delay(200);\n}"},
          {"id":"m8","type":"group","title":"Lắp và đo được 1 mạch nối tiếp + 1 mạch song song, ghi số liệu vào bảng","size":4,"minutes":25,"goal":"Lắp và đo được 1 mạch nối tiếp + 1 mạch song song, ghi số liệu vào bảng.","steps":["Nhận bộ kit, kiểm tra đủ linh kiện theo phiếu","Lắp mạch nối tiếp 2 bóng, đo U và I, ghi kết quả","Chuyển thành mạch song song, đo lại và so sánh","Nạp chương trình cảnh báo quá tải, thử nghiệm"],"roles":[{"role":"Trưởng nhóm","task":"Điều phối, giữ đúng thời gian"},{"role":"Kỹ thuật viên","task":"Lắp mạch theo sơ đồ"},{"role":"Thư ký","task":"Ghi số liệu đo vào phiếu"}]}]},
        {"key":"test_debug","title":"Test & Debug","minutes":20,"blocks":[
          {"id":"m9","type":"game","game":"timer","title":"Trò chơi: Đếm ngược sửa lỗi mạch","seconds":300,"task":"Mỗi nhóm nhận 1 mạch có lỗi cài sẵn — tìm và sửa trong 5 phút."}]},
        {"key":"danh_gia","title":"Đánh giá","minutes":10,"blocks":[
          {"id":"m10","type":"quiz","q":"Trong mạch nối tiếp gồm 2 bóng giống nhau mắc vào nguồn 6 V, hiệu điện thế trên mỗi bóng là bao nhiêu?","options":["3 V","6 V","12 V","1,5 V"],"answer":0,"explain":"Trong mạch nối tiếp, hiệu điện thế nguồn được chia đều cho các bóng giống nhau: 6 V ÷ 2 = 3 V."},
          {"id":"m11","type":"game","game":"wheel","title":"Vòng quay: Ai trả lời câu hỏi tổng kết?","note":"Quay để chọn ngẫu nhiên bạn lên bảng giải thích kết quả đo của nhóm mình.","names":["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6","Nhóm 7","Nhóm 8"],"questions":["Vì sao dây đèn Tết nhà em tắt cả khi hỏng 1 bóng?","Ở nhà em, các ổ cắm được mắc nối tiếp hay song song? Vì sao?"]},
          {"id":"m12","type":"rubric","title":"Rubric đánh giá","criteria":[
            {"name":"Lắp mạch đúng sơ đồ","weight":30,"levels":["Chưa lắp được","Lắp được, còn sai sót","Lắp đúng, gọn gàng","Lắp đúng và tối ưu dây"]},
            {"name":"Số liệu đo chính xác","weight":30,"levels":["Không có số liệu","Số liệu thiếu","Đủ và hợp lý","Chính xác, có nhận xét"]},
            {"name":"Giải thích nguyên lý","weight":25,"levels":["Chưa giải thích được","Giải thích sơ sài","Giải thích đúng","Liên hệ thực tế tốt"]},
            {"name":"Hợp tác nhóm","weight":15,"levels":["Không tham gia","Tham gia ít","Tích cực","Dẫn dắt nhóm"]}]}]}]}$j$::jsonb
     where org_id = sch and title like 'Mạch điện thông minh%' and lesson = '{}'::jsonb;

    update lesson_plans set program = coalesce(program, 'CT1'), lesson = $j${
      "goals":["Nêu được giới hạn đo (GHĐ) và độ chia nhỏ nhất (ĐCNN) của thước, cân điện tử, nhiệt kế","Đọc và ghi đúng số đo kèm đơn vị","Sắp xếp đúng thứ tự các bước của một quy trình đo lường"],
      "tags":["Có giáo cụ ảo","Có kéo-thả","Có bài tập","Không cần thiết bị"],
      "phases":[
        {"key":"khoi_dong","title":"Khởi động","minutes":7,"blocks":[
          {"id":"d1","type":"heading","text":"Ước lượng trước — đo sau"},
          {"id":"d2","type":"text","text":"Người làm khoa học luôn **ước lượng** trước khi đo. Nếu số đo lệch quá xa ước lượng, gần như chắc chắn ta đã đọc sai thang đo hoặc chọn sai dụng cụ. Hãy ước lượng chiều dài chiếc bút của em, sau đó **thử đo** bên dưới để kiểm tra."},
          {"id":"d3","type":"tool","model":"ruler","title":"Giáo cụ ảo: Thước đo 20 cm","task":"Kéo mép phải của thanh màu xanh sao cho chiều dài đúng 12,5 cm — sai số cho phép 0,3 cm.","params":{"target":12.5}}]},
        {"key":"kien_thuc","title":"Kiến thức mới","minutes":12,"blocks":[
          {"id":"d4","type":"heading","text":"Giới hạn đo (GHĐ) và độ chia nhỏ nhất (ĐCNN)"},
          {"id":"d5","type":"text","text":"- **GHĐ** là giá trị lớn nhất dụng cụ đo được. Vượt GHĐ — dụng cụ sai hoặc hỏng.\n- **ĐCNN** là khoảng cách giữa hai vạch chia liên tiếp. ĐCNN quyết định số chữ số được ghi trong kết quả.\n- Kết quả đo phải **luôn kèm đơn vị**: 12,5 cm — không viết \"12,5\"."},
          {"id":"d6","type":"tool","model":"scale","title":"Giáo cụ ảo: Cân điện tử và thao tác TARE","task":"Đặt các quả cân sao cho tổng khối lượng đúng 235 g. Thử bấm TARE để hiểu ý nghĩa \"trừ bì\".","params":{"target":235}}]},
        {"key":"luyen_tap","title":"Luyện tập","minutes":18,"blocks":[
          {"id":"d7","type":"order","title":"Sắp xếp quy trình đo khối lượng bằng cân điện tử","prompt":"Kéo 5 bước về đúng thứ tự thực hiện, rồi bấm \"Kiểm tra kết quả\".","steps":["Đặt cân trên mặt phẳng nằm ngang, chắc chắn","Bật cân, chờ màn hình hiện đúng số 0","Đặt vật cần cân vào giữa đĩa cân","Chờ số ổn định rồi mới đọc kết quả","Ghi kết quả kèm đơn vị đo vào phiếu"]},
          {"id":"d8","type":"tool","model":"thermometer","title":"Giáo cụ ảo: Nhiệt kế","task":"Trượt tới 37 °C — nhiệt độ cơ thể người bình thường. Quan sát số đo đổi sang °F và K.","params":{"target":37}}]},
        {"key":"van_dung","title":"Vận dụng STEM","minutes":8,"blocks":[
          {"id":"d9","type":"quiz","q":"Thước có GHĐ 20 cm và ĐCNN 1 mm. Kết quả nào được ghi ĐÚNG quy cách?","options":["12,5 cm","12,53 cm","12 cm 5","125"],"answer":0,"explain":"ĐCNN 1 mm = 0,1 cm nên kết quả có 1 chữ số thập phân theo cm và phải kèm đơn vị."},
          {"id":"d10","type":"text","text":"**Bài tập về nhà.** Đo và ghi lại 3 số liệu ở nhà, mỗi số liệu kèm dụng cụ đã dùng và đơn vị: 1. Chiều dài bàn học của em  2. Khối lượng cặp sách khi đã xếp đủ sách  3. Nhiệt độ nước máy vào buổi sáng. Ghi giá trị ước lượng trước khi đo để so sánh."}]}]}$j$::jsonb
     where org_id = sch and title like 'Đo lường trong phòng thí nghiệm%' and lesson = '{}'::jsonb;

    update lesson_plans set program = coalesce(program, 'CT3'), lesson = $j${
      "goals":["Tìm được mối liên hệ giữa chiều dài dây và chu kì con lắc","Thiết kế con lắc đếm đúng 1 giây","Trình bày sản phẩm và tự đánh giá theo rubric"],
      "tags":["Có mô phỏng 2D","Có game hoá"],
      "phases":[
        {"key":"kham_pha","title":"Khám phá","minutes":10,"blocks":[
          {"id":"p1","type":"heading","text":"Đồng hồ quả lắc đếm giờ thế nào?"},
          {"id":"p2","type":"text","text":"Đồng hồ quả lắc cổ chạy đúng nhờ **con lắc dao động đều**. Thử thách hôm nay: chế tạo con lắc có chu kì đúng **1 giây** từ dây và đai ốc."},
          {"id":"p3","type":"sim","model":"pendulum","title":"Mô phỏng: Con lắc đơn","task":"Đổi chiều dài dây, thả con lắc và bấm giờ 10 dao động.","params":{"L":0.5}}]},
        {"key":"y_tuong","title":"Ý tưởng","minutes":10,"blocks":[
          {"id":"p4","type":"quiz","q":"Muốn con lắc dao động CHẬM hơn, ta nên làm gì?","options":["Tăng chiều dài dây","Giảm chiều dài dây","Tăng khối lượng quả nặng","Thả từ góc nhỏ hơn"],"answer":0,"explain":"Chu kì T = 2π√(L/g) chỉ phụ thuộc chiều dài dây L (khi góc nhỏ), không phụ thuộc khối lượng."},
          {"id":"p5","type":"game","game":"wheel","title":"Vòng quay chọn nhóm nêu ý tưởng","names":["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6"],"questions":["Nhóm em dự đoán dây dài bao nhiêu thì chu kì 1 giây?"]}]},
        {"key":"thiet_ke","title":"Thiết kế","minutes":15,"blocks":[
          {"id":"p6","type":"text","text":"- Dùng mô phỏng tìm chiều dài dây cho chu kì ≈ 1 s (gợi ý: khoảng 25 cm).\n- Vẽ phác thảo: giá treo, dây, quả nặng, thước đo góc thả.\n- Lập bảng ghi 3 lần đo thời gian 10 dao động."}]},
        {"key":"lam_san_pham","title":"Làm sản phẩm","minutes":45,"blocks":[
          {"id":"p7","type":"group","title":"Chế tạo và hiệu chỉnh con lắc 1 giây","size":4,"minutes":35,"goal":"Con lắc có 10 dao động trong 10 ± 0,3 giây.","steps":["Lắp giá treo và buộc dây theo chiều dài dự kiến","Thả từ góc nhỏ, đo thời gian 10 dao động 3 lần","Điều chỉnh chiều dài, đo lại đến khi đạt yêu cầu"],"roles":[{"role":"Trưởng nhóm","task":"Điều phối và bấm giờ"},{"role":"Kỹ thuật","task":"Lắp, chỉnh chiều dài dây"},{"role":"Thư ký","task":"Ghi bảng số liệu"}]},
          {"id":"p8","type":"game","game":"timer","title":"Đồng hồ thử thách","seconds":600,"task":"10 phút cuối: hoàn thiện và đo lần chốt."}]},
        {"key":"trinh_bay","title":"Trình bày","minutes":10,"blocks":[
          {"id":"p9","type":"rubric","title":"Rubric sản phẩm con lắc","criteria":[
            {"name":"Độ chính xác chu kì","weight":40,"levels":["Sai > 1 s","Sai 0,5–1 s","Sai 0,3–0,5 s","Sai ≤ 0,3 s"]},
            {"name":"Bảng số liệu","weight":30,"levels":["Không có","Thiếu lần đo","Đủ 3 lần đo","Đủ, có tính trung bình"]},
            {"name":"Trình bày","weight":30,"levels":["Chưa rõ","Đọc lại số liệu","Giải thích được","Liên hệ đồng hồ thật"]}]}]}]}$j$::jsonb
     where org_id = sch and title like 'Thử thách con lắc%' and lesson = '{}'::jsonb;
    perform set_config('app.lesson_engine', '', true);
  end if;

  -- ===== 5. Nội dung từng buổi học của chương trình STEM (KDI) =====
  -- Mỗi buổi (hoặc bài học không chia buổi) chưa có nội dung nhận một bài giảng theo tiến trình của CT: tình huống, kiến thức, mô phỏng / giáo cụ ảo
  -- phù hợp chủ đề, hoạt động nhóm, câu hỏi củng cố và rubric. KDI sửa tiếp ở Chương trình giáo dục → Soạn nội dung buổi.
  alter table edu_program_units disable trigger user;
  for u in
    select s.id, s.title, s.objectives, s.content, s.periods, tp.title as topic, p.ct_code, p.title as prog, p.main_subject
      from edu_program_units s
      join edu_program_units tp on tp.unit_type = 'topic'
       and tp.id = case when s.unit_type = 'session' then (select x.parent_id from edu_program_units x where x.id = s.parent_id) else s.parent_id end
      join edu_programs p on p.id = s.program_id
     where (s.unit_type = 'session' or (s.unit_type = 'lesson' and not exists (select 1 from edu_program_units c where c.parent_id = s.id)))
       and p.kind = 'stem' and p.status = 'published' and s.lesson = '{}'::jsonb
       and p.org_id = public.platform_org_id()
  loop
    ct := coalesce(u.ct_code, 'CT1');
    topic := regexp_replace(u.topic, '^Chủ đề \d+\.\s*', '');
    obj := coalesce(nullif(btrim(u.objectives), ''), 'Học sinh vận dụng kiến thức của chủ đề "' || topic || '" để giải quyết một vấn đề thực tế.');
    sim := case
      when topic ~* 'mạch điện|pin|điện' then jsonb_build_object('type', 'sim', 'model', 'circuit_series', 'title', 'Mô phỏng: Mạch điện', 'task', 'Thay đổi hiệu điện thế, ngắt công tắc và quan sát độ sáng bóng đèn.')
      when topic ~* 'đo lường|đo chiều|cân' then jsonb_build_object('type', 'tool', 'model', 'ruler', 'title', 'Giáo cụ ảo: Thước đo', 'task', 'Kéo thanh đo đến đúng số đo yêu cầu.', 'params', jsonb_build_object('target', 12.5))
      when topic ~* 'nhiệt|mặt trời|thời tiết|quan trắc|nhà kính' then jsonb_build_object('type', 'tool', 'model', 'thermometer', 'title', 'Giáo cụ ảo: Nhiệt kế', 'task', 'Đọc nhiệt độ và đổi sang °F, K.', 'params', jsonb_build_object('target', 37))
      when topic ~* 'cầu|chịu lực|cánh tay|ném' then jsonb_build_object('type', 'sim', 'model', 'lever', 'title', 'Mô phỏng: Đòn bẩy cân bằng', 'task', 'Tìm vị trí đặt vật để đòn bẩy cân bằng.')
      when topic ~* 'con lắc|dao động' then jsonb_build_object('type', 'sim', 'model', 'pendulum', 'title', 'Mô phỏng: Con lắc đơn', 'task', 'Đổi chiều dài dây, đo chu kì.')
      else null end;
    flow := case ct
      when 'CT2' then '[["van_de","Xác định vấn đề",8],["kien_thuc_nen","Nghiên cứu kiến thức nền",10],["giai_phap","Đề xuất giải pháp",7],["che_tao","Chế tạo & thử nghiệm",15],["chia_se","Chia sẻ & đánh giá",5]]'
      when 'CT3' then '[["kham_pha","Khám phá",7],["y_tuong","Ý tưởng",8],["thiet_ke","Thiết kế",8],["lam_san_pham","Làm sản phẩm",15],["trinh_bay","Trình bày",7]]'
      when 'CT4' then '[["khoi_dong","Khởi động",5],["ly_thuyet","Lý thuyết",8],["lap_rap","Lắp ráp & Lập trình",17],["test_debug","Test & Debug",10],["danh_gia","Đánh giá",5]]'
      when 'CT5' then '[["cau_hoi","Đặt câu hỏi nghiên cứu",7],["gia_thuyet","Giả thuyết & thiết kế",8],["thi_nghiem","Thí nghiệm",15],["phan_tich","Phân tích dữ liệu",8],["bao_cao","Báo cáo",7]]'
      else '[["khoi_dong","Khởi động",5],["kien_thuc","Kiến thức mới",13],["luyen_tap","Luyện tập",18],["van_dung","Vận dụng STEM",9]]' end::jsonb;
    ph := '[]'::jsonb; k := 0;
    for i in 0 .. jsonb_array_length(flow) - 1 loop
      k := k + 1;
      blocks := case
        when i = 0 then jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'Giáo viên đưa ra một tình huống gần gũi liên quan đến "' || u.title || '" và hỏi cả lớp: "Em nhìn thấy gì? Em đoán vì sao lại như vậy?"' || chr(10) || 'Ghi nhanh các ý kiến của học sinh lên bảng, chưa kết luận đúng – sai.'),
          jsonb_build_object('type', 'game', 'game', 'wheel', 'title', 'Vòng quay chọn bạn chia sẻ dự đoán', 'names', '["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6"]'::jsonb, 'questions', jsonb_build_array('Theo em, "' || topic || '" có ứng dụng gì trong đời sống?')))
        when i = 1 then jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', obj || coalesce(chr(10) || nullif(btrim(u.content), ''), '')))
          || case when sim is null then '[]'::jsonb else jsonb_build_array(sim) end
        when i = jsonb_array_length(flow) - 1 then jsonb_build_array(
          jsonb_build_object('type', 'quiz', 'q', 'Điều quan trọng nhất em rút ra sau buổi "' || u.title || '" là gì?',
            'options', jsonb_build_array('Kiến thức của chủ đề ' || topic, 'Cách làm việc nhóm hiệu quả', 'Cả hai ý trên', 'Không có gì mới'), 'answer', 2,
            'explain', 'Bài học STEM giúp em vừa nắm kiến thức vừa rèn kĩ năng hợp tác, giải quyết vấn đề.'),
          jsonb_build_object('type', 'rubric', 'title', 'Rubric đánh giá buổi học', 'criteria', '[
            {"name":"Hiểu kiến thức","weight":30,"levels":["Chưa nêu được","Nêu được một phần","Nêu đúng","Giải thích và vận dụng"]},
            {"name":"Sản phẩm / kết quả","weight":40,"levels":["Chưa hoàn thành","Hoàn thành một phần","Hoàn thành đúng yêu cầu","Sáng tạo, vượt yêu cầu"]},
            {"name":"Hợp tác nhóm","weight":30,"levels":["Ít tham gia","Tham gia","Tích cực","Dẫn dắt nhóm"]}]'::jsonb))
        when i = 2 then jsonb_build_array(
          jsonb_build_object('type', 'group', 'title', u.title, 'size', 4, 'minutes', (flow->i->>2)::int, 'goal', obj,
            'steps', jsonb_build_array('Nhận nhiệm vụ và phiếu học tập', 'Thảo luận, phân công vai trò', 'Thực hiện và ghi kết quả', 'Chuẩn bị chia sẻ trước lớp'),
            'roles', '[{"role":"Trưởng nhóm","task":"Điều phối, giữ thời gian"},{"role":"Thư ký","task":"Ghi kết quả vào phiếu"},{"role":"Báo cáo viên","task":"Trình bày trước lớp"}]'::jsonb))
        else jsonb_build_array(
          jsonb_build_object('type', 'order', 'title', 'Sắp xếp các bước thực hiện', 'prompt', 'Kéo các bước về đúng thứ tự nhóm em đã làm.',
            'steps', '["Xác định yêu cầu","Lên phương án","Thực hiện","Kiểm tra và cải tiến"]'::jsonb))
        end;
      -- gắn id cho từng khối
      select coalesce(jsonb_agg(b || jsonb_build_object('id', substr(md5(u.id::text || i || o), 1, 8)) order by o), '[]') into blocks
        from jsonb_array_elements(blocks) with ordinality x(b, o);
      ph := ph || jsonb_build_array(jsonb_build_object('key', flow->i->>0, 'title', flow->i->>1, 'minutes', (flow->i->>2)::int, 'blocks', blocks));
    end loop;
    update edu_program_units set lesson = jsonb_build_object('phases', ph, 'goals', jsonb_build_array(obj)) where id = u.id;
  end loop;
  alter table edu_program_units enable trigger user;
end $$;


notify pgrst, 'reload schema';
