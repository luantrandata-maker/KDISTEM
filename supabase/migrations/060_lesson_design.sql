-- 060. Soạn bài giảng & kho hoạt động (Phân hệ 2 — đợt 3)
--  • lesson_templates: mẫu giáo án linh hoạt (các mục của giáo án + các pha hoạt động) — mẫu hệ thống của KDI
--    (5512, STEM 5E, dự án STEM), mẫu riêng của Sở / Phòng / trường; mẫu của cấp trên dùng chung cho cấp dưới.
--  • lesson_plans: thêm nội dung giáo án theo mẫu (doc), hoạt động dạy học theo bước (steps — mỗi bước gắn hoạt động
--    tương tác, học liệu, phiếu học tập, rubric), gắn chương trình / bài (058), học liệu, rubric, định mức vật tư (059)
--    kèm số lượng điều chỉnh đề xuất; vòng đời nháp → chờ duyệt → đã duyệt / trả lại → xuất bản → lưu trữ;
--    phiên bản (lesson_plan_versions) và khôi phục; nhân bản.
--  • Gửi duyệt qua Hộp phê duyệt (loại 'lesson_plan'). Trường có quy trình duyệt giáo án đang bật thì giáo viên phải
--    được duyệt mới xuất bản; không có quy trình thì giáo viên tự xuất bản như trước.
--  • lesson_plan_reviews: dạy thử trên lớp và góp ý (tổ trưởng / BGH / đồng nghiệp), có điểm đánh giá 1–5.
--  • material_norm_proposals.lesson_plan_id: đề xuất điều chỉnh định mức phát sinh từ giáo án.
-- Cần chạy sau 059.

-- ===== 1. Mẫu giáo án =====
-- sections: [{ "key": "muc_tieu", "title": "Mục tiêu", "hint": "...", "required": true }]  — các mục văn bản của giáo án
-- phases:   [{ "key": "khoi_dong", "title": "Khởi động", "hint": "..." }]                   — các pha của tiến trình dạy học
create table if not exists lesson_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  phases jsonb not null default '[]'::jsonb check (jsonb_typeof(phases) = 'array'),
  scope text not null default 'children' check (scope in ('own', 'children')),
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_templates_org on lesson_templates (org_id);
drop trigger if exists lesson_templates_touch on lesson_templates;
create trigger lesson_templates_touch before update on lesson_templates for each row execute function public.touch_updated_at();

create or replace function public.lesson_templates_guard() returns trigger
language plpgsql as $$
begin
  if jsonb_array_length(new.sections) + jsonb_array_length(new.phases) = 0 then
    raise exception 'Mẫu giáo án cần ít nhất một mục hoặc một pha hoạt động' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(new.sections || new.phases) e
              where coalesce(trim(e->>'key'), '') = '' or coalesce(trim(e->>'title'), '') = '') then
    raise exception 'Mỗi mục / pha cần mã và tên' using errcode = '22023';
  end if;
  if (select count(distinct e->>'key') from jsonb_array_elements(new.sections) e) < jsonb_array_length(new.sections)
     or (select count(distinct e->>'key') from jsonb_array_elements(new.phases) e) < jsonb_array_length(new.phases) then
    raise exception 'Mã mục / pha bị trùng' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists lesson_templates_guard on lesson_templates;
create trigger lesson_templates_guard before insert or update on lesson_templates for each row execute function public.lesson_templates_guard();

alter table lesson_templates enable row level security;
drop policy if exists lesson_templates_read on lesson_templates;
create policy lesson_templates_read on lesson_templates for select to authenticated using (public.material_shared_visible(org_id, scope));
drop policy if exists lesson_templates_insert on lesson_templates;
create policy lesson_templates_insert on lesson_templates for insert to authenticated with check (public.library_can_write(org_id, 'create'));
drop policy if exists lesson_templates_update on lesson_templates;
create policy lesson_templates_update on lesson_templates for update to authenticated
  using (public.library_can_write(org_id, 'edit')) with check (public.library_can_write(org_id, 'edit'));
drop policy if exists lesson_templates_delete on lesson_templates;
create policy lesson_templates_delete on lesson_templates for delete to authenticated using (public.library_can_write(org_id, 'delete'));
grant select, insert, update, delete on lesson_templates to authenticated;
create or replace function public.owner_name(lesson_templates) returns text
language sql stable security definer set search_path = public as $$ select name from organizations where id = $1.org_id $$;
grant execute on function public.owner_name(lesson_templates) to authenticated;

-- Mẫu hệ thống (danh mục, có cả trên CSDL production): thuộc đơn vị cung cấp KDI Education
do $$
declare kdi uuid;
begin
  select id into kdi from organizations where is_platform limit 1;
  if kdi is null or exists (select 1 from lesson_templates where org_id = kdi) then return; end if;
  insert into lesson_templates (org_id, name, description, sections, phases, created_by) values
  (kdi, 'Kế hoạch bài dạy theo Công văn 5512', 'Mẫu kế hoạch bài dạy (Phụ lục IV, Công văn 5512/BGDĐT-GDTrH): mục tiêu, thiết bị, tiến trình 4 hoạt động.',
   '[{"key":"muc_tieu_kien_thuc","title":"Mục tiêu — Kiến thức","required":true},
     {"key":"muc_tieu_nang_luc","title":"Mục tiêu — Năng lực","required":true},
     {"key":"muc_tieu_pham_chat","title":"Mục tiêu — Phẩm chất","required":true},
     {"key":"thiet_bi","title":"Thiết bị dạy học và học liệu","required":true}]',
   '[{"key":"mo_dau","title":"Hoạt động 1: Mở đầu","hint":"Xác định vấn đề / nhiệm vụ học tập"},
     {"key":"hinh_thanh","title":"Hoạt động 2: Hình thành kiến thức mới"},
     {"key":"luyen_tap","title":"Hoạt động 3: Luyện tập"},
     {"key":"van_dung","title":"Hoạt động 4: Vận dụng"}]', null),
  (kdi, 'Bài học STEM theo quy trình 5E', 'Gắn kết – Khám phá – Giải thích – Củng cố – Đánh giá; phù hợp chủ đề STEM 1–4 tiết.',
   '[{"key":"muc_tieu","title":"Mục tiêu","required":true},
     {"key":"van_de","title":"Vấn đề thực tiễn / tình huống"},
     {"key":"thiet_bi","title":"Thiết bị, vật tư","required":true},
     {"key":"an_toan","title":"Lưu ý an toàn"}]',
   '[{"key":"engage","title":"Gắn kết (Engage)"},{"key":"explore","title":"Khám phá (Explore)"},
     {"key":"explain","title":"Giải thích (Explain)"},{"key":"elaborate","title":"Củng cố, mở rộng (Elaborate)"},
     {"key":"evaluate","title":"Đánh giá (Evaluate)"}]', null),
  (kdi, 'Dự án STEM (quy trình kĩ thuật)', 'Theo Công văn 3089/BGDĐT-GDTrH: xác định vấn đề → nghiên cứu kiến thức nền → đề xuất, lựa chọn giải pháp → chế tạo, thử nghiệm → chia sẻ, điều chỉnh.',
   '[{"key":"muc_tieu","title":"Mục tiêu","required":true},
     {"key":"san_pham","title":"Sản phẩm và tiêu chí sản phẩm","required":true},
     {"key":"thiet_bi","title":"Thiết bị, vật tư","required":true},
     {"key":"phan_cong","title":"Tổ chức nhóm, phân công"}]',
   '[{"key":"xac_dinh","title":"Xác định vấn đề"},{"key":"kien_thuc","title":"Nghiên cứu kiến thức nền"},
     {"key":"giai_phap","title":"Đề xuất và lựa chọn giải pháp"},{"key":"che_tao","title":"Chế tạo mẫu, thử nghiệm, đánh giá"},
     {"key":"chia_se","title":"Chia sẻ, thảo luận, điều chỉnh"}]', null);
end $$;

-- ===== 2. Giáo án: nội dung theo mẫu, các bước, đính kèm, vòng đời, phiên bản =====
-- steps: [{ "id": "a1", "phase": "khoi_dong", "title": "...", "goal": "...", "teacher": "...", "student": "...", "product": "...",
--           "minutes": 10, "activity_id": uuid, "library_ids": [uuid], "rubric_id": uuid, "note": "..." }]
alter table lesson_plans
  add column if not exists template_id uuid references lesson_templates(id) on delete set null,
  add column if not exists doc jsonb not null default '{}'::jsonb,
  add column if not exists steps jsonb not null default '[]'::jsonb,
  add column if not exists program_id uuid references edu_programs(id) on delete set null,
  add column if not exists unit_id uuid references edu_program_units(id) on delete set null,
  add column if not exists library_ids uuid[] not null default '{}',
  add column if not exists rubric_ids uuid[] not null default '{}',
  add column if not exists norm_id uuid references material_norms(id) on delete set null,
  add column if not exists norm_adjust jsonb not null default '[]'::jsonb,   -- [{ "item_id": uuid, "qty": number, "note": text }]
  add column if not exists periods smallint check (periods is null or periods between 1 and 20),
  add column if not exists version_no int not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists review_note text;
alter table lesson_plans drop constraint if exists lesson_plans_doc_check;
alter table lesson_plans add constraint lesson_plans_doc_check check (jsonb_typeof(doc) = 'object');
alter table lesson_plans drop constraint if exists lesson_plans_steps_check;
alter table lesson_plans add constraint lesson_plans_steps_check check (jsonb_typeof(steps) = 'array');
alter table lesson_plans drop constraint if exists lesson_plans_norm_adjust_check;
alter table lesson_plans add constraint lesson_plans_norm_adjust_check check (jsonb_typeof(norm_adjust) = 'array');
alter table lesson_plans drop constraint if exists lesson_plans_status_check;
alter table lesson_plans add constraint lesson_plans_status_check
  check (status in ('draft', 'editing', 'pending', 'approved', 'rejected', 'published', 'archived'));
update lesson_plans set version_no = 1, published_at = coalesce(published_at, updated_at) where status = 'published' and version_no = 0;
create index if not exists lesson_plans_program on lesson_plans (program_id) where program_id is not null;

create table if not exists lesson_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references lesson_plans(id) on delete cascade,
  version_no int not null,
  snapshot jsonb not null,           -- title, summary, slides, doc, steps, đính kèm, định mức
  note text,
  published_by uuid references profiles(id) on delete set null default auth.uid(),
  published_at timestamptz not null default now(),
  unique (plan_id, version_no)
);

-- Nội dung có thay đổi giữa hai bản ghi?
create or replace function public.lesson_plan_content(p lesson_plans) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', p.title, 'subject', p.subject, 'grades', p.grades, 'program', p.program, 'summary', p.summary,
    'slides', p.slides, 'template_id', p.template_id, 'doc', p.doc, 'steps', p.steps, 'program_id', p.program_id, 'unit_id', p.unit_id,
    'library_ids', to_jsonb(p.library_ids), 'rubric_ids', to_jsonb(p.rubric_ids), 'norm_id', p.norm_id, 'norm_adjust', p.norm_adjust, 'periods', p.periods)
$$;

-- Trường có quy trình duyệt giáo án đang bật (của trường hoặc cấp trên áp cho trường trực thuộc)?
create or replace function public.lesson_review_required(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.approval_effective_workflow(p_org, 'lesson_plan') is not null
$$;
revoke all on function public.lesson_review_required(uuid) from public, anon;
grant execute on function public.lesson_review_required(uuid) to authenticated;

create or replace function public.lesson_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_engine boolean := coalesce(current_setting('app.lesson_engine', true), '') = 'on' or auth.uid() is null;
begin
  -- Kiểm tra liên kết
  if new.unit_id is not null and not exists (select 1 from edu_program_units u where u.id = new.unit_id and u.program_id = new.program_id) then
    raise exception 'Bài / chủ đề không thuộc chương trình đã chọn' using errcode = '22023';
  end if;
  if jsonb_array_length(new.steps) > 60 then raise exception 'Giáo án tối đa 60 bước hoạt động' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(new.steps) s where coalesce(trim(s->>'title'), '') = '') then
    raise exception 'Mỗi bước hoạt động cần tên' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(new.steps) s
              where s ? 'minutes' and jsonb_typeof(s->'minutes') = 'number' and ((s->>'minutes')::numeric < 0 or (s->>'minutes')::numeric > 300)) then
    raise exception 'Thời lượng mỗi bước 0–300 phút' using errcode = '22023';
  end if;
  if v_engine then return new; end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'editing') then raise exception 'Giáo án mới phải là bản nháp' using errcode = '22023'; end if;
    new.version_no := 0; new.published_at := null; new.review_note := null;
    return new;
  end if;

  new.version_no := old.version_no; new.published_at := old.published_at;
  if new.review_note is distinct from old.review_note then new.review_note := old.review_note; end if;
  if public.lesson_plan_content(new) is distinct from public.lesson_plan_content(old) then
    if old.status = 'pending' then raise exception 'Giáo án đang chờ duyệt — rút lại để sửa' using errcode = '22023'; end if;
    if old.status in ('approved', 'published') then raise exception 'Giáo án đã duyệt / xuất bản — tạo phiên bản mới để sửa' using errcode = '22023'; end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'published' then raise exception 'Xuất bản giáo án bằng nút Xuất bản' using errcode = '42501'; end if;
    if new.status in ('draft', 'editing') and old.status not in ('draft', 'editing', 'rejected', 'archived') then
      raise exception 'Dùng nút Tạo phiên bản mới / Rút lại' using errcode = '42501';
    end if;
    if new.status = 'pending' and old.status not in ('draft', 'editing', 'rejected') then
      raise exception 'Chỉ gửi duyệt bản nháp' using errcode = '22023';
    end if;
    if new.status = 'pending' and new.is_template then raise exception 'Bài giảng mẫu của trường không cần gửi duyệt' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists lesson_plans_guard on lesson_plans;
create trigger lesson_plans_guard before insert or update on lesson_plans for each row execute function public.lesson_plans_guard();

-- Người duyệt (tổ trưởng, BGH theo quy trình) đọc được giáo án đang chờ duyệt / đã xử lý
create or replace function public.lesson_plan_reviewer(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from approval_requests r where r.ref_table = 'lesson_plans' and r.ref_id = p_plan
                  and (public.approval_can_act(r.id) or exists (select 1 from approval_actions a where a.request_id = r.id and a.actor = auth.uid())))
$$;
revoke all on function public.lesson_plan_reviewer(uuid) from public, anon;
grant execute on function public.lesson_plan_reviewer(uuid) to authenticated;
drop policy if exists lesson_plans_reviewer_read on lesson_plans;
create policy lesson_plans_reviewer_read on lesson_plans for select to authenticated using (
  (select public.is_staff()) and public.lesson_plan_reviewer(id));
-- Cấp trên (Sở / Phòng) xem giáo án đã xuất bản của trường trực thuộc
drop policy if exists lesson_plans_authority_read on lesson_plans;
create policy lesson_plans_authority_read on lesson_plans for select to authenticated using (
  status = 'published' and (select public.is_authority()) and org_id in (select public.my_org_tree()));

alter table lesson_plan_versions enable row level security;
drop policy if exists lesson_plan_versions_read on lesson_plan_versions;
create policy lesson_plan_versions_read on lesson_plan_versions for select to authenticated using (exists (select 1 from lesson_plans p where p.id = plan_id));
grant select on lesson_plan_versions to authenticated;

-- Người sửa được giáo án (chủ giáo án; quản trị trường với giáo án / bài mẫu của trường)
create or replace function public.lesson_plan_can_edit(p lesson_plans) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_access_org(p.org_id) and ((p.teacher_id is not null and p.teacher_id = public.my_teacher_id()) or public.is_admin())
$$;
revoke all on function public.lesson_plan_can_edit(lesson_plans) from public, anon;

-- Xuất bản: lưu phiên bản. Trường có quy trình duyệt → giáo viên cần bản đã duyệt (quản trị trường xuất bản thẳng).
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
  if jsonb_array_length(p.slides) = 0 and jsonb_array_length(p.steps) = 0 and p.doc = '{}'::jsonb then
    raise exception 'Giáo án chưa có nội dung' using errcode = '22023';
  end if;
  v := p.version_no + 1;
  perform set_config('app.lesson_engine', 'on', true);
  update lesson_plans set status = 'published', version_no = v, published_at = now() where id = p.id;
  perform set_config('app.lesson_engine', '', true);
  insert into lesson_plan_versions (plan_id, version_no, snapshot, note) values (p.id, v, public.lesson_plan_content(p), nullif(trim(p_note), ''));
  return v;
end $$;

-- Tạo phiên bản mới: bản đã xuất bản / đã duyệt quay về "đang soạn" (bản đã xuất bản vẫn lưu ở lịch sử phiên bản)
create or replace function public.lesson_plan_new_version(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p lesson_plans;
begin
  select * into p from lesson_plans where id = p_plan for update;
  if p.id is null or not public.lesson_plan_can_edit(p) then raise exception 'Bạn không sửa được giáo án này' using errcode = '42501'; end if;
  if p.status not in ('published', 'approved', 'archived') then raise exception 'Giáo án đang là bản soạn' using errcode = '22023'; end if;
  perform set_config('app.lesson_engine', 'on', true);
  update lesson_plans set status = 'editing' where id = p.id;
  perform set_config('app.lesson_engine', '', true);
end $$;

-- Khôi phục nội dung một phiên bản đã xuất bản vào bản đang soạn
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
         norm_id = (s->>'norm_id')::uuid, norm_adjust = coalesce(s->'norm_adjust', '[]'), periods = (s->>'periods')::smallint
   where id = p.id;
end $$;

-- Nhân bản: bản nháp của giáo viên hiện tại (hoặc bài mẫu của trường khi quản trị trường nhân bản và không là giáo viên)
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
                            library_item_id, library_version, template_id, doc, steps, program_id, unit_id, library_ids, rubric_ids, norm_id, norm_adjust, periods)
  values (p.org_id, v_teacher, coalesce(nullif(trim(p_title), ''), regexp_replace(p.title, '^Mẫu:\s*', '') || case when p.teacher_id = v_teacher then ' (bản sao)' else '' end),
          p.subject, p.grades, p.program, p.from_package, v_teacher is null, 'draft', p.summary, p.slides, p.id,
          p.library_item_id, p.library_version, p.template_id, p.doc, p.steps, p.program_id, p.unit_id, p.library_ids, p.rubric_ids, p.norm_id, p.norm_adjust, p.periods)
  returning id into v_new;
  return v_new;
end $$;

-- Rút lại hồ sơ đang chờ duyệt (về nháp)
create or replace function public.lesson_plan_withdraw(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_req uuid;
begin
  select r.id into v_req from approval_requests r join lesson_plans p on p.id = r.ref_id
   where r.ref_table = 'lesson_plans' and r.ref_id = p_plan and r.status = 'pending' and public.lesson_plan_can_edit(p);
  if v_req is null then raise exception 'Không có hồ sơ chờ duyệt để rút' using errcode = '42501'; end if;
  if (select requested_by from approval_requests where id = v_req) = auth.uid() then
    perform public.approval_cancel(v_req, 'Rút lại để sửa');
  elsif public.is_admin() then
    -- quản trị trường rút hộ giáo viên
    insert into approval_actions (request_id, step_no, actor, decision, note)
      select id, current_step, auth.uid(), 'cancel', 'Rút lại' from approval_requests where id = v_req;
    update approval_requests set status = 'cancelled', decided_at = now() where id = v_req;
    perform set_config('app.approval_engine', 'on', true);
    update lesson_plans set status = 'draft' where id = p_plan;
    perform set_config('app.approval_engine', 'off', true);
  else
    raise exception 'Chỉ người gửi hoặc quản trị trường rút được hồ sơ' using errcode = '42501';
  end if;
end $$;
revoke all on function public.lesson_plan_publish(uuid, text), public.lesson_plan_new_version(uuid), public.lesson_plan_restore(uuid, int),
  public.lesson_plan_clone(uuid, text), public.lesson_plan_withdraw(uuid) from public, anon;
grant execute on function public.lesson_plan_publish(uuid, text), public.lesson_plan_new_version(uuid), public.lesson_plan_restore(uuid, int),
  public.lesson_plan_clone(uuid, text), public.lesson_plan_withdraw(uuid) to authenticated;

-- ===== 3. Phê duyệt giáo án qua Hộp phê duyệt =====
alter table approval_workflows drop constraint if exists approval_workflows_kind_check;
alter table approval_workflows add constraint approval_workflows_kind_check
  check (kind in ('stem_registration', 'borrow_request', 'package_purchase', 'edu_plan', 'project', 'supply_purchase', 'stock_transfer',
                  'curriculum_plan', 'edu_program', 'lesson_plan'));
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'approval_requests_kind_check') then
    alter table approval_requests drop constraint approval_requests_kind_check;
    alter table approval_requests add constraint approval_requests_kind_check
      check (kind in ('stem_registration', 'borrow_request', 'package_purchase', 'edu_plan', 'project', 'supply_purchase', 'stock_transfer',
                      'curriculum_plan', 'edu_program', 'lesson_plan'));
  end if;
end $$;
create or replace function public.approval_kind_module(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'stem_registrations' when 'borrow_request' then 'stem_rooms'
    when 'package_purchase' then 'packages' when 'edu_plan' then 'edu_plan' when 'project' then 'projects'
    when 'supply_purchase' then 'equipment' when 'stock_transfer' then 'equipment'
    when 'curriculum_plan' then 'curriculum' when 'edu_program' then 'curriculum' when 'lesson_plan' then 'library' end
$$;
create or replace function public.approval_kind_label(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'Đăng ký dạy STEM' when 'borrow_request' then 'Phiếu mượn thiết bị'
    when 'package_purchase' then 'Đề xuất mua gói STEM' when 'edu_plan' then 'Kế hoạch giáo dục' when 'project' then 'Dự án STEM'
    when 'supply_purchase' then 'Đề xuất mua vật tư' when 'stock_transfer' then 'Phiếu vận chuyển'
    when 'curriculum_plan' then 'Phân phối chương trình' when 'edu_program' then 'Chương trình giáo dục' when 'lesson_plan' then 'Giáo án' end
$$;

create or replace function public.approval_source_opened() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_title text; v_sum text; v_by uuid;
begin
  if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then return null; end if;
  if tg_table_name = 'stem_registrations' then
    v_kind := 'stem_registration'; v_title := new.topic;
    v_sum := public.teacher_name(new.teacher_id) || ' · ' || coalesce((select name from classes where id = new.class_id), '') || ' · ' || public.vn_date(new.on_date);
    v_by := public.teacher_profile(new.teacher_id);
  elsif tg_table_name = 'borrow_requests' then
    v_kind := 'borrow_request'; v_title := new.title;
    v_sum := coalesce(public.teacher_name(new.teacher_id), '') || ' · ' || public.vn_date(new.on_date);
    v_by := coalesce(public.teacher_profile(new.teacher_id), auth.uid());
  elsif tg_table_name = 'package_orders' then
    v_kind := 'package_purchase'; v_title := new.name;
    v_sum := concat_ws(' · ', 'Số lượng ' || new.quantity, nullif(new.programs, ''), 'Khối ' || nullif(new.grades, ''),
                       case when new.budget is not null then replace(to_char(new.budget, 'FM999,999,999,999'), ',', '.') || ' đ' end);
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'education_plans' then
    v_kind := 'edu_plan';
    v_title := public.teacher_name(new.teacher_id) || ' · ' || new.subject || ' · Khối ' || new.grade;
    v_sum := new.stem_periods || ' tiết STEM';
    v_by := auth.uid();
  elsif tg_table_name = 'supply_requests' then
    v_kind := 'supply_purchase'; v_title := new.title;
    select concat_ws(' · ', count(*) || ' mặt hàng',
                     case when sum(qty * est_price) > 0 then 'dự kiến ' || replace(to_char(sum(qty * est_price), 'FM999,999,999,999'), ',', '.') || ' đ' end,
                     case when new.needed_by is not null then 'cần trước ' || public.vn_date(new.needed_by) end)
      into v_sum from supply_request_lines where request_id = new.id;
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'stock_transfers' then
    v_kind := 'stock_transfer'; v_title := new.title;
    select (select name from organizations where id = new.org_id) || ' → ' || (select name from organizations where id = new.to_org)
           || ' · ' || count(*) || ' dòng' into v_sum from stock_transfer_items where transfer_id = new.id;
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'student_projects' then
    v_kind := 'project'; v_title := new.title;
    v_sum := concat_ws(' · ', nullif(new.field, ''), (select string_agg(s.full_name, ', ' order by s.full_name) from project_members pm join students s on s.id = pm.student_id where pm.project_id = new.id),
                       'GVHD ' || public.teacher_name(new.mentor_teacher_id));
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'curriculum_books' then
    v_kind := 'curriculum_plan'; v_title := new.title;
    select concat_ws(' · ', 'Khối ' || new.grade, new.subject, count(*) || ' tiết', new.year_name) into v_sum from curriculum_lessons where book_id = new.id;
    v_by := auth.uid();
  elsif tg_table_name = 'edu_programs' then
    v_kind := 'edu_program'; v_title := new.title || ' (phiên bản ' || new.version_no || ')';
    v_sum := concat_ws(' · ', new.main_subject, 'Khối ' || new.grade_from || case when new.grade_to > new.grade_from then '–' || new.grade_to else '' end,
                       new.total_periods || ' tiết', new.ct_code);
    v_by := auth.uid();
  elsif tg_table_name = 'lesson_plans' then
    v_kind := 'lesson_plan'; v_title := new.title || case when new.version_no > 0 then ' (phiên bản ' || (new.version_no + 1) || ')' else '' end;
    v_sum := concat_ws(' · ', public.teacher_name(new.teacher_id), new.subject, 'Khối ' || nullif(new.grades, ''),
                       case when jsonb_array_length(new.steps) > 0 then jsonb_array_length(new.steps) || ' bước hoạt động' end);
    v_by := coalesce(public.teacher_profile(new.teacher_id), auth.uid());
  end if;
  perform public.approval_open(new.org_id, v_kind, tg_table_name, new.id, v_title, v_sum, v_by);
  return null;
end $$;

create or replace function public.approval_cancel(p_request uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_requests;
begin
  select * into r from approval_requests where id = p_request for update;
  if r.requested_by is distinct from auth.uid() or r.status <> 'pending' then raise exception 'Không rút được hồ sơ này' using errcode = '42501'; end if;
  insert into approval_actions (request_id, step_no, actor, decision, note) values (r.id, r.current_step, auth.uid(), 'cancel', p_note);
  update approval_requests set status = 'cancelled', decided_at = now() where id = r.id;
  perform set_config('app.approval_engine', 'on', true);
  execute format('update %I set status = $1 where id = $2', r.ref_table)
    using case when r.ref_table in ('package_orders', 'education_plans', 'supply_requests', 'stock_transfers', 'student_projects',
                                    'curriculum_books', 'edu_programs', 'lesson_plans') then 'draft' else 'rejected' end, r.ref_id;
  perform set_config('app.approval_engine', 'off', true);
end $$;

-- Hồ sơ duyệt đổi trạng thái giáo án qua app.approval_engine; guard giáo án cho qua khi động cơ duyệt đang chạy
create or replace function public.lesson_plans_engine_flag() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.approval_engine', true), 'off') = 'on' then
    perform set_config('app.lesson_engine', 'on', true);
  end if;
  return new;
end $$;
drop trigger if exists lesson_plans_aa_engine_flag on lesson_plans;
create trigger lesson_plans_aa_engine_flag before update of status on lesson_plans for each row execute function public.lesson_plans_engine_flag();
create or replace function public.lesson_plans_engine_reset() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.approval_engine', true), 'off') = 'on' then perform set_config('app.lesson_engine', '', true); end if;
  return null;
end $$;
drop trigger if exists lesson_plans_zz_engine_reset on lesson_plans;
create trigger lesson_plans_zz_engine_reset after update of status on lesson_plans for each row execute function public.lesson_plans_engine_reset();

do $$
begin
  drop trigger if exists lesson_plans_approval_open on lesson_plans;
  create trigger lesson_plans_approval_open after insert or update of status on lesson_plans for each row execute function public.approval_source_opened();
  drop trigger if exists lesson_plans_approval_guard on lesson_plans;
  create trigger lesson_plans_approval_guard before update of status on lesson_plans for each row execute function public.approval_source_guard();
  drop trigger if exists lesson_plans_approval_deleted on lesson_plans;
  create trigger lesson_plans_approval_deleted after delete on lesson_plans for each row execute function public.approval_source_deleted();
end $$;

-- Ghi nhận ý kiến của người duyệt vào giáo án (để giáo viên đọc khi bị trả lại)
create or replace function public.lesson_plans_review_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_plan uuid;
begin
  if new.note is null or new.decision not in ('approve', 'reject', 'comment') then return null; end if;
  select ref_id into v_plan from approval_requests where id = new.request_id and ref_table = 'lesson_plans';
  if v_plan is not null then
    perform set_config('app.lesson_engine', 'on', true);
    update lesson_plans set review_note = new.note where id = v_plan;
    perform set_config('app.lesson_engine', '', true);
  end if;
  return null;
end $$;
drop trigger if exists approval_actions_lesson_note on approval_actions;
create trigger approval_actions_lesson_note after insert on approval_actions for each row execute function public.lesson_plans_review_note();

-- ===== 4. Dạy thử và góp ý =====
create table if not exists lesson_plan_reviews (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references lesson_plans(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null default 'comment' check (kind in ('trial', 'comment')),   -- dạy thử trên lớp / góp ý
  class_id uuid references classes(id) on delete set null,
  taught_on date,
  rating smallint check (rating is null or rating between 1 and 5),
  note text not null check (length(trim(note)) > 0),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lesson_plan_reviews_plan on lesson_plan_reviews (plan_id, created_at);
create or replace function public.lesson_plan_reviews_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.org_id := (select org_id from lesson_plans where id = new.plan_id);
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  if new.class_id is not null and not exists (select 1 from classes where id = new.class_id and org_id = new.org_id) then
    raise exception 'Lớp không thuộc trường của giáo án' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists lesson_plan_reviews_guard on lesson_plan_reviews;
create trigger lesson_plan_reviews_guard before insert on lesson_plan_reviews for each row execute function public.lesson_plan_reviews_guard();
alter table lesson_plan_reviews enable row level security;
drop policy if exists lesson_plan_reviews_read on lesson_plan_reviews;
create policy lesson_plan_reviews_read on lesson_plan_reviews for select to authenticated using (
  (select public.is_staff()) and exists (select 1 from lesson_plans p where p.id = plan_id));
drop policy if exists lesson_plan_reviews_insert on lesson_plan_reviews;
create policy lesson_plan_reviews_insert on lesson_plan_reviews for insert to authenticated with check (
  (select public.is_staff()) and exists (select 1 from lesson_plans p where p.id = plan_id and p.org_id = (select public.my_org_id())));
drop policy if exists lesson_plan_reviews_delete on lesson_plan_reviews;
create policy lesson_plan_reviews_delete on lesson_plan_reviews for delete to authenticated using (created_by = auth.uid() or (select public.is_admin()));
grant select, insert, delete on lesson_plan_reviews to authenticated;

-- ===== 5. Đề xuất điều chỉnh định mức từ giáo án =====
alter table material_norm_proposals add column if not exists lesson_plan_id uuid references lesson_plans(id) on delete set null;
-- Gửi các dòng điều chỉnh (norm_adjust) của giáo án thành đề xuất tới đơn vị ban hành định mức
create or replace function public.lesson_plan_propose_norm(p_plan uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; v uuid; v_items jsonb;
begin
  select * into p from lesson_plans where id = p_plan;
  if p.id is null or not public.lesson_plan_can_edit(p) then raise exception 'Bạn không sửa được giáo án này' using errcode = '42501'; end if;
  if p.norm_id is null or not public.material_norm_visible(p.norm_id) then raise exception 'Giáo án chưa gắn định mức vật tư' using errcode = '22023'; end if;
  if (select status from material_norms where id = p.norm_id) <> 'published' then raise exception 'Định mức chưa ban hành' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'catalog_id', i.catalog_id, 'name', i.name, 'unit', i.unit,
                                               'qty', (a->>'qty')::numeric, 'note', a->>'note')), '[]')
    into v_items
    from jsonb_array_elements(p.norm_adjust) a join material_norm_items i on i.id = (a->>'item_id')::uuid and i.norm_id = p.norm_id
   where (a->>'qty')::numeric is distinct from i.qty;
  if jsonb_array_length(v_items) = 0 then raise exception 'Chưa có số lượng nào khác định mức' using errcode = '22023'; end if;
  insert into material_norm_proposals (norm_id, reason, items, lesson_plan_id)
    values (p.norm_id, coalesce(nullif(trim(p_reason), ''), 'Điều chỉnh theo giáo án: ' || p.title), v_items, p.id)
    returning id into v;
  return v;
end $$;
revoke all on function public.lesson_plan_propose_norm(uuid, text) from public, anon;
grant execute on function public.lesson_plan_propose_norm(uuid, text) to authenticated;

-- ===== 6. Dữ liệu mẫu: giáo án theo mẫu 5E gắn chương trình, học liệu, định mức; một giáo án chờ duyệt =====
do $$
declare sch uuid; kdi uuid; tch uuid; tpl uuid; tpl2 uuid; v_stem uuid; u uuid; n uuid; lp uuid; act uuid; rub uuid; c uuid; wf uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into sch from organizations where code = 'THCS-PH';
  select id into kdi from organizations where is_platform limit 1;
  if sch is null or kdi is null or exists (select 1 from lesson_plans where org_id = sch and template_id is not null) then return; end if;
  select t.id into tch from teachers t where t.org_id = sch and t.profile_id is not null order by t.full_name limit 1;
  if tch is null then select t.id into tch from teachers t where t.org_id = sch order by t.full_name limit 1; end if;
  select id into tpl from lesson_templates where org_id = kdi and name like 'Bài học STEM%';
  select id into tpl2 from lesson_templates where org_id = kdi and name like 'Kế hoạch bài dạy%';
  select id into v_stem from edu_programs where org_id = kdi and title like 'STEM CT2%' and status = 'published' limit 1;
  select id into u from edu_program_units where program_id = v_stem and unit_type = 'lesson' order by seq limit 1;
  select id into n from material_norms where org_id = kdi and title like 'Robot dò line%' and status = 'published' limit 1;
  select id into act from activities where org_id = sch and kind = 'quiz' order by created_at limit 1;
  select id into rub from rubrics where org_id is null order by title limit 1;
  select id into c from classes where org_id = sch and name like '%8A%' limit 1;

  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, status, summary, template_id, program_id, unit_id, norm_id, periods,
                            doc, steps, rubric_ids, slides, version_no, published_at, library_ids)
  values (sch, tch, 'Robot dò line — cảm biến hồng ngoại', 'Công nghệ', '8', 'CT2', 'published',
          'Học sinh tìm hiểu cảm biến hồng ngoại, lắp robot và lập trình đi theo vạch.', tpl, v_stem, u, n, 2,
          jsonb_build_object('muc_tieu', 'Giải thích được nguyên lí cảm biến hồng ngoại; lắp ráp và lập trình được robot đi theo vạch.',
                             'van_de', 'Xe tự hành trong nhà máy đi theo vạch kẻ trên sàn như thế nào?',
                             'thiet_bi', 'Mỗi nhóm 1 bộ kit robot, 6 pin AA, sa bàn kẻ vạch đen.',
                             'an_toan', 'Không chạm tay vào bánh xe khi robot đang chạy; tháo pin khi lắp mạch.'),
          jsonb_build_array(
            jsonb_build_object('id', 's1', 'phase', 'engage', 'title', 'Xem video xe tự hành trong nhà máy', 'minutes', 5,
                               'teacher', 'Chiếu video, đặt câu hỏi: xe "nhìn" vạch bằng gì?', 'student', 'Quan sát, nêu dự đoán.'),
            jsonb_build_object('id', 's2', 'phase', 'explore', 'title', 'Thí nghiệm cảm biến với nền đen / trắng', 'minutes', 15,
                               'teacher', 'Phát cảm biến, hướng dẫn đo.', 'student', 'Đo giá trị cảm biến trên 2 nền, ghi phiếu.', 'product', 'Bảng số liệu'),
            jsonb_build_object('id', 's3', 'phase', 'explain', 'title', 'Câu hỏi nhanh: nguyên lí phản xạ', 'minutes', 5, 'activity_id', act),
            jsonb_build_object('id', 's4', 'phase', 'elaborate', 'title', 'Lắp robot và lập trình dò line', 'minutes', 50,
                               'teacher', 'Hỗ trợ nhóm, kiểm tra an toàn.', 'student', 'Lắp ráp, nạp chương trình, chạy thử.', 'product', 'Robot chạy hết sa bàn'),
            jsonb_build_object('id', 's5', 'phase', 'evaluate', 'title', 'Thi chạy robot, đánh giá theo rubric', 'minutes', 15, 'rubric_id', rub)),
          case when rub is null then '{}'::uuid[] else array[rub] end,
          jsonb_build_array(jsonb_build_object('id', 'p1', 'kind', 'title', 'title', 'Robot dò line', 'body', 'Chủ đề STEM — Công nghệ 8')),
          1, now() - interval '6 days',
          coalesce((select array_agg(id) from library_items where title = 'Robot dò line: cảm biến hồng ngoại'), '{}'))
  returning id into lp;
  insert into lesson_plan_versions (plan_id, version_no, snapshot, note, published_by, published_at)
    select lp, 1, public.lesson_plan_content(p), 'Bản đầu', null, now() - interval '6 days' from lesson_plans p where p.id = lp;
  if c is not null then
    insert into lesson_plan_reviews (plan_id, org_id, kind, class_id, taught_on, rating, note)
      values (lp, sch, 'trial', c, public.vn_today() - 5, 4, 'Lớp 8A làm tốt; phần lắp robot cần thêm 10 phút, pin hết sau 2 buổi.');
  end if;

  -- Giáo án theo mẫu 5512 đang chờ duyệt (một giáo viên khác)
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, status, summary, template_id, periods, doc, steps)
  values (sch, tch, 'Thông tin và dữ liệu', 'Tin học', '6', 'draft', 'Bài 1 — Chủ đề A, Tin học 6.', tpl2, 2,
          jsonb_build_object('muc_tieu_kien_thuc', 'Phân biệt được thông tin và dữ liệu.', 'muc_tieu_nang_luc', 'Nêu được ví dụ về thông tin, dữ liệu.',
                             'muc_tieu_pham_chat', 'Trung thực, có trách nhiệm khi chia sẻ thông tin.', 'thiet_bi', 'Máy chiếu, phiếu học tập.'),
          jsonb_build_array(
            jsonb_build_object('id', 'a1', 'phase', 'mo_dau', 'title', 'Trò chơi "Ai nhanh hơn"', 'minutes', 5),
            jsonb_build_object('id', 'a2', 'phase', 'hinh_thanh', 'title', 'Thông tin và dữ liệu', 'minutes', 20),
            jsonb_build_object('id', 'a3', 'phase', 'luyen_tap', 'title', 'Phiếu học tập nhóm', 'minutes', 10),
            jsonb_build_object('id', 'a4', 'phase', 'van_dung', 'title', 'Tìm ví dụ ở gia đình', 'minutes', 5)))
  returning id into lp;
  -- Trường mẫu bật duyệt giáo án: Tổ trưởng/Hiệu trưởng duyệt (một bước, người có quyền duyệt thư viện)
  if not exists (select 1 from approval_workflows where org_id = sch and kind = 'lesson_plan') then
    insert into approval_workflows (org_id, kind, name, applies_to_children, updated_by)
      values (sch, 'lesson_plan', 'Duyệt giáo án trước khi xuất bản', false, null) returning id into wf;
    insert into approval_steps (workflow_id, step_no, name, approver, role_id, org_type)
      values (wf, 1, 'Hiệu trưởng duyệt giáo án', 'role', (select id from roles where key = 'principal' and org_id is null), null);
  end if;
  update lesson_plans set status = 'pending' where id = lp;
end $$;

notify pgrst, 'reload schema';
