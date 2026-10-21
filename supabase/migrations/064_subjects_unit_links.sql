-- 064. Danh mục môn học, liên kết học phần – môn học, bài học – học liệu (Phân hệ 2)
--  Khung khái niệm: Chương trình (edu_programs) → Học phần (edu_program_units 'topic', trước gọi là "chủ đề")
--  → Bài học (edu_program_units 'lesson' / 'session') → Bài giảng (lesson_plans, gắn unit_id); Học liệu = library_items 'material'.
--  • subjects (MonHoc): danh mục môn học / lĩnh vực kiến thức. KDI, Sở, Phòng, trường đều có danh mục riêng;
--    scope = 'children' thì đơn vị trực thuộc dùng chung (như material_catalog). Danh mục hệ thống của KDI có cả trên production.
--  • edu_unit_subjects (HocPhan_MonHoc): một học phần gắn một hay nhiều môn học (nhiều–nhiều).
--  • edu_unit_materials (BaiHoc_HocLieu): một bài học / buổi học dùng nhiều học liệu, một học liệu dùng ở nhiều bài.
--  • Cả hai bảng liên kết là nội dung của chương trình: chỉ sửa khi chương trình nháp / bị trả lại, chép theo khi
--    sao chép hoặc tạo phiên bản mới (edu_program_clone). Clone nay chép cả nội dung buổi học (edu_program_units.lesson, 063).
--  • Cột chữ cũ (edu_programs.main_subject, integrated_subjects, edu_program_units.subject, library_items.unit_id) giữ nguyên.
--  • Loại chương trình (stem_tracks, 062): bỏ giới hạn cứng CT1–CT5, KDI thêm / ngừng dùng / xoá loại mới.
--    Các cột lưu mã loại (edu_programs.ct_code, lesson_plans.program, library_items.program, activities.program,
--    class_topics.program, class_programs.program, stem_teacher_programs.program) đổi từ CHECK cố định sang khoá ngoại
--    tới stem_tracks(code): loại đang được dùng thì không xoá được. Mã loại không đổi sau khi tạo.
-- Cần chạy sau 063.

-- ===== 0. Loại chương trình: thêm được, không cố định CT1–CT5 =====
alter table stem_tracks drop constraint if exists stem_tracks_code_check;
alter table stem_tracks add constraint stem_tracks_code_check check (code ~ '^[A-Z][A-Z0-9_-]{1,11}$');
alter table stem_tracks add column if not exists sort int not null default 0,
  add column if not exists active boolean not null default true;
update stem_tracks set sort = substr(code, 3)::int where code ~ '^CT[1-5]$' and sort = 0;

create or replace function public.stem_tracks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.code <> old.code then
    raise exception 'Không đổi mã loại chương trình sau khi tạo' using errcode = '22023';
  end if;
  new.code := upper(btrim(new.code));
  new.name := btrim(new.name); new.title := btrim(new.title); new.description := btrim(coalesce(new.description, ''));
  new.subjects := array(select x from (select distinct on (lower(btrim(s))) btrim(s) x, o from unnest(new.subjects) with ordinality u(s, o)
                                        where btrim(s) <> '' order by lower(btrim(s)), o) d order by o);
  new.levels := array(select l from unnest(array['mamnon', 'tieuhoc', 'thcs', 'thpt', 'thpt_nghe']) l where l = any(new.levels));
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop policy if exists stem_tracks_insert on stem_tracks;
create policy stem_tracks_insert on stem_tracks for insert to authenticated with check (public.is_platform_admin());
drop policy if exists stem_tracks_delete on stem_tracks;
create policy stem_tracks_delete on stem_tracks for delete to authenticated using (public.is_platform_admin());
grant insert, delete on stem_tracks to authenticated;

-- Cột lưu mã loại: CHECK cố định → khoá ngoại (dữ liệu cũ hợp lệ vì CHECK cũ chỉ cho CT1–CT5)
alter table edu_programs drop constraint if exists edu_programs_ct_code_check;
alter table lesson_plans drop constraint if exists lesson_plans_program_check;
alter table library_items drop constraint if exists library_items_program_check;
alter table activities drop constraint if exists activities_program_check;
alter table class_topics drop constraint if exists class_topics_program_check;
alter table class_programs drop constraint if exists class_programs_program_check;
alter table stem_teacher_programs drop constraint if exists stem_teacher_programs_program_check;
alter table edu_programs drop constraint if exists edu_programs_ct_code_fkey;
alter table edu_programs add constraint edu_programs_ct_code_fkey foreign key (ct_code) references stem_tracks(code);
alter table lesson_plans drop constraint if exists lesson_plans_program_fkey;
alter table lesson_plans add constraint lesson_plans_program_fkey foreign key (program) references stem_tracks(code);
alter table library_items drop constraint if exists library_items_program_fkey;
alter table library_items add constraint library_items_program_fkey foreign key (program) references stem_tracks(code);
alter table activities drop constraint if exists activities_program_fkey;
alter table activities add constraint activities_program_fkey foreign key (program) references stem_tracks(code);
alter table class_topics drop constraint if exists class_topics_program_fkey;
alter table class_topics add constraint class_topics_program_fkey foreign key (program) references stem_tracks(code);
alter table class_programs drop constraint if exists class_programs_program_fkey;
alter table class_programs add constraint class_programs_program_fkey foreign key (program) references stem_tracks(code);
alter table stem_teacher_programs drop constraint if exists stem_teacher_programs_program_fkey;
alter table stem_teacher_programs add constraint stem_teacher_programs_program_fkey foreign key (program) references stem_tracks(code);

-- ===== 1. Danh mục môn học =====
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text check (code is null or length(btrim(code)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 120),
  domain text,                                   -- lĩnh vực kiến thức: Khoa học tự nhiên, Công nghệ – Kĩ thuật, Toán học…
  description text,
  levels text[] not null default '{}' check (levels <@ array['tieuhoc', 'thcs', 'thpt']),
  ct_codes text[] not null default '{}',         -- loại chương trình dùng môn này (stem_tracks.code); mã lạ bị bỏ
  scope text not null default 'children' check (scope in ('own', 'children')),
  active boolean not null default true,
  sort int not null default 0,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subjects_name on subjects (org_id, lower(name));
create unique index if not exists subjects_code on subjects (org_id, lower(code)) where code is not null;

create or replace function public.subjects_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name); new.code := nullif(btrim(new.code), ''); new.domain := nullif(btrim(new.domain), '');
  new.description := nullif(btrim(new.description), '');
  new.levels := array(select l from unnest(array['tieuhoc', 'thcs', 'thpt']) l where l = any(new.levels));
  new.ct_codes := array(select t.code from stem_tracks t where t.code = any(new.ct_codes) order by t.sort, t.code);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists subjects_guard on subjects;
create trigger subjects_guard before insert or update on subjects for each row execute function public.subjects_guard();

alter table subjects enable row level security;
drop policy if exists subjects_read on subjects;
create policy subjects_read on subjects for select to authenticated using (public.material_shared_visible(org_id, scope));
drop policy if exists subjects_insert on subjects;
create policy subjects_insert on subjects for insert to authenticated with check (public.curriculum_can_write(org_id, 'create'));
drop policy if exists subjects_update on subjects;
create policy subjects_update on subjects for update to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
drop policy if exists subjects_delete on subjects;
create policy subjects_delete on subjects for delete to authenticated using (public.curriculum_can_write(org_id, 'delete'));
grant select, insert, update, delete on subjects to authenticated;
create or replace function public.owner_name(subjects) returns text
language sql stable security definer set search_path = public as $$ select name from organizations where id = $1.org_id $$;
grant execute on function public.owner_name(subjects) to authenticated;

-- Danh mục hệ thống (có cả trên CSDL production): thuộc đơn vị cung cấp KDI Education.
-- Môn theo CT GDPT 2018 + các môn trong danh mục CT1–CT5 (stem_tracks.subjects, 062).
do $$
declare kdi uuid;
begin
  select id into kdi from organizations where is_platform limit 1;
  if kdi is null or exists (select 1 from subjects where org_id = kdi) then return; end if;
  insert into subjects (org_id, code, name, domain, levels, sort, created_by) values
    (kdi, 'TOAN', 'Toán', 'Toán học', '{tieuhoc,thcs,thpt}', 10, null),
    (kdi, 'KHTN', 'Khoa học tự nhiên', 'Khoa học tự nhiên', '{thcs}', 20, null),
    (kdi, 'KH', 'Khoa học', 'Khoa học tự nhiên', '{tieuhoc}', 21, null),
    (kdi, 'TNXH', 'Tự nhiên và Xã hội', 'Khoa học tự nhiên', '{tieuhoc}', 22, null),
    (kdi, 'LY', 'Vật lí', 'Khoa học tự nhiên', '{thpt}', 23, null),
    (kdi, 'HOA', 'Hoá học', 'Khoa học tự nhiên', '{thpt}', 24, null),
    (kdi, 'SINH', 'Sinh học', 'Khoa học tự nhiên', '{thpt}', 25, null),
    (kdi, 'TIN', 'Tin học', 'Công nghệ – Kĩ thuật', '{tieuhoc,thcs,thpt}', 30, null),
    (kdi, 'CN', 'Công nghệ', 'Công nghệ – Kĩ thuật', '{tieuhoc,thcs,thpt}', 31, null),
    (kdi, 'HDTN', 'Hoạt động trải nghiệm', 'Hoạt động giáo dục', '{tieuhoc,thcs,thpt}', 40, null),
    (kdi, 'MT', 'Mĩ thuật', 'Nghệ thuật', '{tieuhoc,thcs,thpt}', 41, null);
  -- Môn của CT1–CT5: tên nào chưa có thì thêm, đánh dấu các CT dùng môn đó
  insert into subjects (org_id, name, domain, levels, ct_codes, sort, created_by)
  select kdi, s.name, 'STEM', '{}', array_agg(distinct s.code order by s.code), 100, null
    from (select t.code, btrim(x) as name from stem_tracks t, unnest(t.subjects) x where btrim(x) <> '') s
   where not exists (select 1 from subjects e where e.org_id = kdi and lower(e.name) = lower(s.name))
   group by s.name;
end $$;

-- Môn học dùng được trong chương trình của đơn vị p_org: môn của chính đơn vị, hoặc môn dùng chung (scope children)
-- của KDI / đơn vị cấp trên. Không phụ thuộc người gọi (quản trị KDI thấy mọi môn nhưng không gắn môn riêng của trường).
create or replace function public.subject_usable(p_subject uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select parent_id as id from organizations where id = p_org
    union all
    select o.parent_id from organizations o join up on o.id = up.id where o.parent_id is not null
  )
  select exists (select 1 from subjects s where s.id = p_subject
    and (s.org_id = p_org or (s.scope = 'children' and (s.org_id = public.platform_org_id() or s.org_id in (select id from up where id is not null)))))
$$;
revoke all on function public.subject_usable(uuid, uuid) from public, anon;
grant execute on function public.subject_usable(uuid, uuid) to authenticated;

-- ===== 2. Học phần – môn học =====
create table if not exists edu_unit_subjects (
  unit_id uuid not null references edu_program_units(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,   -- môn đang dùng thì không xoá, chuyển "ngừng dùng"
  program_id uuid not null references edu_programs(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  is_main boolean not null default false,                                -- môn chính của học phần
  seq int not null default 1 check (seq between 1 and 99),
  primary key (unit_id, subject_id)
);
create index if not exists edu_unit_subjects_program on edu_unit_subjects (program_id);
create index if not exists edu_unit_subjects_subject on edu_unit_subjects (subject_id);

-- ===== 3. Bài học – học liệu =====
create table if not exists edu_unit_materials (
  unit_id uuid not null references edu_program_units(id) on delete cascade,
  item_id uuid not null references library_items(id) on delete cascade,
  program_id uuid not null references edu_programs(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  seq int not null default 1 check (seq between 1 and 999),
  note text check (note is null or length(note) <= 500),                -- dùng ở phần nào của bài, cách dùng
  primary key (unit_id, item_id)
);
create index if not exists edu_unit_materials_program on edu_unit_materials (program_id);
create index if not exists edu_unit_materials_item on edu_unit_materials (item_id);

-- Chuẩn hoá + khoá theo trạng thái chương trình (như edu_outcomes)
create or replace function public.edu_unit_links_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare u edu_program_units; s subjects; i library_items;
begin
  if tg_op = 'DELETE' then
    -- Xoá theo dây chuyền (chương trình / mục / học liệu đã bị xoá) luôn được
    if not public.edu_program_editable(old.program_id) and exists (select 1 from edu_programs where id = old.program_id)
       and exists (select 1 from edu_program_units where id = old.unit_id)
       and (tg_table_name <> 'edu_unit_materials' or exists (select 1 from library_items where id = (to_jsonb(old)->>'item_id')::uuid)) then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa' using errcode = '22023';
    end if;
    return old;
  end if;
  select * into u from edu_program_units where id = new.unit_id;
  if u.id is null then raise exception 'Không tìm thấy học phần / bài học' using errcode = '22023'; end if;
  if not public.edu_program_editable(u.program_id) then
    raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa' using errcode = '22023';
  end if;
  new.program_id := u.program_id; new.org_id := u.org_id;
  if tg_table_name = 'edu_unit_subjects' then
    if u.unit_type <> 'topic' then raise exception 'Môn học chỉ gắn với học phần' using errcode = '22023'; end if;
    select * into s from subjects where id = (to_jsonb(new)->>'subject_id')::uuid;
    if s.id is null or not public.subject_usable(s.id, u.org_id) then
      raise exception 'Không tìm thấy môn học trong danh mục' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' and not s.active then raise exception 'Môn "%" đã ngừng dùng', s.name using errcode = '22023'; end if;
  else
    if u.unit_type not in ('lesson', 'session') then raise exception 'Học liệu gắn với bài học hoặc buổi học' using errcode = '22023'; end if;
    select * into i from library_items where id = (to_jsonb(new)->>'item_id')::uuid;
    if i.id is null or i.kind <> 'material' then raise exception 'Chỉ gắn học liệu (không gắn chương trình / bài giảng)' using errcode = '22023'; end if;
    if tg_op = 'INSERT' and not (i.owner_org_id = u.org_id or (i.status = 'published' and public.library_visible(i.id))) then
      raise exception 'Không tìm thấy học liệu' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists edu_unit_subjects_guard on edu_unit_subjects;
create trigger edu_unit_subjects_guard before insert or update or delete on edu_unit_subjects for each row execute function public.edu_unit_links_guard();
drop trigger if exists edu_unit_materials_guard on edu_unit_materials;
create trigger edu_unit_materials_guard before insert or update or delete on edu_unit_materials for each row execute function public.edu_unit_links_guard();

-- Đúng một môn chính mỗi học phần: đặt môn chính mới thì bỏ cờ ở các môn khác
create or replace function public.edu_unit_subjects_main() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_main then
    update edu_unit_subjects set is_main = false where unit_id = new.unit_id and subject_id <> new.subject_id and is_main;
  end if;
  return null;
end $$;
drop trigger if exists edu_unit_subjects_main on edu_unit_subjects;
create trigger edu_unit_subjects_main after insert or update of is_main on edu_unit_subjects for each row execute function public.edu_unit_subjects_main();

alter table edu_unit_subjects enable row level security;
alter table edu_unit_materials enable row level security;
drop policy if exists edu_unit_subjects_read on edu_unit_subjects;
create policy edu_unit_subjects_read on edu_unit_subjects for select to authenticated using (exists (select 1 from edu_programs p where p.id = program_id));
drop policy if exists edu_unit_subjects_write on edu_unit_subjects;
create policy edu_unit_subjects_write on edu_unit_subjects for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
drop policy if exists edu_unit_materials_read on edu_unit_materials;
create policy edu_unit_materials_read on edu_unit_materials for select to authenticated using (exists (select 1 from edu_programs p where p.id = program_id));
drop policy if exists edu_unit_materials_write on edu_unit_materials;
create policy edu_unit_materials_write on edu_unit_materials for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
grant select, insert, update, delete on edu_unit_subjects, edu_unit_materials to authenticated;

-- ===== 4. Sao chép / phiên bản mới chép cả liên kết và nội dung buổi học =====
create or replace function public.edu_program_clone(p_src uuid, p_org uuid, p_family uuid, p_version int) returns uuid
language plpgsql set search_path = public as $$
declare s edu_programs; v_new uuid := gen_random_uuid(); v_map jsonb; t text;
begin
  select * into s from edu_programs where id = p_src;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  insert into edu_programs (id, org_id, family_id, version_no, code, title, kind, ct_code, level, grade_from, grade_to, main_subject,
                            integrated_subjects, objectives, competency_keys, rubric_ids, status, scope, source_id, note)
  values (v_new, p_org, coalesce(p_family, v_new), p_version, s.code, s.title, s.kind, s.ct_code, s.level, s.grade_from, s.grade_to,
          s.main_subject, s.integrated_subjects, s.objectives, s.competency_keys, s.rubric_ids, 'draft',
          case when p_org = s.org_id then s.scope else 'own' end, s.id, s.note);
  select coalesce(jsonb_object_agg(id::text, gen_random_uuid()), '{}'::jsonb) into v_map from edu_program_units where program_id = p_src;
  foreach t in array array['topic', 'lesson', 'session'] loop
    insert into edu_program_units (id, program_id, parent_id, unit_type, seq, grade, subject, title, periods, objectives, content, lesson)
    select (v_map->>u.id::text)::uuid, v_new, (v_map->>u.parent_id::text)::uuid, u.unit_type, u.seq, u.grade, u.subject, u.title,
           u.periods, u.objectives, u.content, u.lesson
      from edu_program_units u where u.program_id = p_src and u.unit_type = t;
  end loop;
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key)
  select v_new, (v_map->>o.unit_id::text)::uuid, o.seq, o.code, o.content, o.competency_key from edu_outcomes o where o.program_id = p_src;
  -- Liên kết: chỉ chép môn / học liệu mà đơn vị nhận nhìn thấy (bỏ qua mục riêng của đơn vị khác)
  insert into edu_unit_subjects (unit_id, subject_id, program_id, org_id, is_main, seq)
  select (v_map->>x.unit_id::text)::uuid, x.subject_id, v_new, p_org, x.is_main, x.seq
    from edu_unit_subjects x
   where x.program_id = p_src and public.subject_usable(x.subject_id, p_org);
  insert into edu_unit_materials (unit_id, item_id, program_id, org_id, seq, note)
  select (v_map->>x.unit_id::text)::uuid, x.item_id, v_new, p_org, x.seq, x.note
    from edu_unit_materials x join library_items i on i.id = x.item_id
   where x.program_id = p_src and (i.owner_org_id = p_org or (i.status = 'published' and public.library_visible(i.id)));
  return v_new;
end $$;
revoke all on function public.edu_program_clone(uuid, uuid, uuid, int) from public, anon, authenticated;

-- ===== 5. Chuyển dữ liệu cũ =====
-- Học phần có cột chữ "subject" trùng tên môn trong danh mục KDI → tạo liên kết (môn chính).
-- Học liệu đã gắn một bài / buổi (library_items.unit_id, 059) → tạo liên kết bài học – học liệu.
alter table edu_unit_subjects disable trigger user;
alter table edu_unit_materials disable trigger user;
insert into edu_unit_subjects (unit_id, subject_id, program_id, org_id, is_main, seq)
select u.id, s.id, u.program_id, u.org_id, true, 1
  from edu_program_units u
  join subjects s on s.org_id = public.platform_org_id() and lower(s.name) = lower(btrim(u.subject))
 where u.unit_type = 'topic' and u.subject is not null
on conflict do nothing;
insert into edu_unit_materials (unit_id, item_id, program_id, org_id, seq)
select u.id, i.id, u.program_id, u.org_id, row_number() over (partition by u.id order by i.created_at)
  from library_items i join edu_program_units u on u.id = i.unit_id
 where i.kind = 'material' and u.unit_type in ('lesson', 'session')
on conflict do nothing;
alter table edu_unit_subjects enable trigger user;
alter table edu_unit_materials enable trigger user;

notify pgrst, 'reload schema';
