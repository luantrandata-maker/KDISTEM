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

-- ##SEED##

notify pgrst, 'reload schema';
