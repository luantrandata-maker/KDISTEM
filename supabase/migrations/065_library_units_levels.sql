-- 065. Bài học trong kho học liệu + danh mục cấp học & khối (Phân hệ 2)
--  • library_items.kind = 'unit' (Bài học): gói một bài học để phát hành — mục tiêu, số tiết và các thành phần đã có trong kho:
--    content = { objectives, periods, plan_ids (giáo án: học liệu loại 'lesson_plan'), lesson_ids (bài giảng),
--                norm_ids (định mức vật tư, material_norms), material_ids (học liệu khác) }.
--    Trường "Dùng bài học" → tạo bản riêng mọi bài giảng được gắn (như chương trình trong kho, 023).
--    Mục loại 'program' cũ vẫn xem / sửa / dùng được; trang Phát hành học liệu không tạo mới loại này nữa
--    (chương trình soạn ở Chương trình giáo dục, 058).
--  • edu_levels: danh mục cấp học và khối áp dụng (khối từ – đến). KDI sửa ở Chương trình giáo dục → Cấp học & khối.
--    edu_programs.level và subjects.levels kiểm theo danh mục (thay CHECK cố định tiểu học / THCS / THPT).
-- Cần chạy sau 064.

-- ===== 1. Bài học trong kho =====
alter table library_items drop constraint if exists library_items_kind_check;
alter table library_items add constraint library_items_kind_check check (kind in ('program', 'unit', 'lesson', 'material'));

-- Thành phần của bài học là mã mục trong kho / định mức: chỉ giữ mã hợp lệ (uuid), bỏ trùng
create or replace function public.library_unit_ids(v jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
    select distinct on (x) x, o from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) with ordinality e(x, o)
     where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' order by x, o) d
$$;

create or replace function public.library_items_unit_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kind = 'unit' then
    new.content := jsonb_build_object(
      'objectives', nullif(btrim(coalesce(new.content->>'objectives', '')), ''),
      'periods', case when coalesce(new.content->>'periods', '') ~ '^\d{1,3}$' then (new.content->>'periods')::int else null end,
      'plan_ids', public.library_unit_ids(new.content->'plan_ids'),
      'lesson_ids', public.library_unit_ids(new.content->'lesson_ids'),
      'norm_ids', public.library_unit_ids(new.content->'norm_ids'),
      'material_ids', public.library_unit_ids(new.content->'material_ids'));
  end if;
  return new;
end $$;
drop trigger if exists library_items_unit_guard on library_items;
create trigger library_items_unit_guard before insert or update on library_items for each row execute function public.library_items_unit_guard();

-- Dùng một mục kho: bài học dùng như chương trình — tạo bản riêng các bài giảng được gắn mà đơn vị nhìn thấy
create or replace function public.library_adopt(p_item uuid, p_template boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i library_items; v_org uuid := public.my_org_id(); v_teacher uuid := public.my_teacher_id();
  v_slides jsonb; v_plan uuid; v_ids uuid[] := '{}'; v_lesson uuid; v_tpl boolean;
begin
  if v_org is null or (select type from organizations where id = v_org) <> 'school' then
    raise exception 'Chỉ trường học dùng được học liệu vào bài giảng' using errcode = '42501';
  end if;
  if not public.library_visible(p_item) then raise exception 'Không tìm thấy học liệu' using errcode = '42501'; end if;
  select * into i from library_items where id = p_item;
  if i.status <> 'published' and i.owner_org_id <> v_org then raise exception 'Học liệu chưa phát hành' using errcode = '42501'; end if;
  v_tpl := coalesce(p_template, false) or v_teacher is null;
  if v_tpl and not public.is_admin() then raise exception 'Chỉ quản trị trường tạo bài giảng mẫu của trường' using errcode = '42501'; end if;

  if i.kind in ('program', 'unit') then
    for v_lesson in
      select distinct x::uuid from (
        select l.value #>> '{}' as x
          from jsonb_array_elements(case when i.kind = 'program' then coalesce(i.content->'units', '[]') else '[]'::jsonb end) u,
               jsonb_array_elements(coalesce(u->'lesson_ids', '[]')) l
        union all
        select l #>> '{}' from jsonb_array_elements(case when i.kind = 'unit' then coalesce(i.content->'lesson_ids', '[]') else '[]'::jsonb end) l
      ) s
    loop
      if public.library_visible(v_lesson) and exists (select 1 from library_items where id = v_lesson and kind = 'lesson') then
        v_ids := v_ids || ((public.library_adopt(v_lesson, v_tpl))->>'lesson_plan_id')::uuid;
      end if;
    end loop;
    insert into library_copies (item_id, org_id, adopted_version, lesson_plan_id) values (i.id, v_org, i.version, v_ids[1]);
    return jsonb_build_object('kind', i.kind, 'lesson_plan_ids', to_jsonb(v_ids), 'count', coalesce(array_length(v_ids, 1), 0));
  end if;

  if i.kind = 'lesson' then
    v_slides := coalesce(i.content->'slides', '[]'::jsonb);
  else
    v_slides := jsonb_build_array(
      jsonb_build_object('id', 's1', 'kind', 'title', 'title', i.title, 'body', coalesce(i.summary, '')),
      case when i.content->>'type' in ('video', 'image')
        then jsonb_build_object('id', 's2', 'kind', 'media', 'title', i.title, 'url', coalesce(i.content->>'url', ''))
        else jsonb_build_object('id', 's2', 'kind', 'content', 'title', 'Tài liệu tham khảo', 'body', coalesce(i.content->>'url', '')) end);
  end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, is_template, status, summary, slides, library_item_id, library_version)
    values (v_org, case when v_tpl then null else v_teacher end, case when v_tpl then 'Mẫu: ' || i.title else i.title end,
            i.subject, i.grades, i.program, v_tpl, 'draft', i.summary, v_slides, i.id, i.version)
    returning id into v_plan;
  insert into library_copies (item_id, org_id, adopted_version, lesson_plan_id) values (i.id, v_org, i.version, v_plan);
  return jsonb_build_object('kind', i.kind, 'lesson_plan_id', v_plan);
end $$;
grant execute on function public.library_adopt(uuid, boolean) to authenticated;

-- ===== 2. Cấp học & khối =====
create table if not exists edu_levels (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,19}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  grade_from int not null check (grade_from between 1 and 12),
  grade_to int not null check (grade_to between 1 and 12),
  sort int not null default 0,
  active boolean not null default true,
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  check (grade_to >= grade_from)
);

create or replace function public.edu_levels_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.code <> old.code then raise exception 'Không đổi mã cấp học sau khi tạo' using errcode = '22023'; end if;
  new.name := btrim(new.name); new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  -- Thu hẹp khối không được làm chương trình đang có nằm ngoài cấp học
  if tg_op = 'UPDATE' and exists (select 1 from edu_programs p where p.level = new.code and (p.grade_from < new.grade_from or p.grade_to > new.grade_to)) then
    raise exception 'Có chương trình của cấp học này dùng khối ngoài khoảng %–%', new.grade_from, new.grade_to using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists edu_levels_guard on edu_levels;
create trigger edu_levels_guard before insert or update on edu_levels for each row execute function public.edu_levels_guard();

alter table edu_levels enable row level security;
drop policy if exists edu_levels_read on edu_levels;
create policy edu_levels_read on edu_levels for select to authenticated using (true);
drop policy if exists edu_levels_write on edu_levels;
create policy edu_levels_write on edu_levels for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on edu_levels to authenticated;

-- Danh mục ban đầu (không phải dữ liệu mẫu)
insert into edu_levels (code, name, grade_from, grade_to, sort, updated_by) values
  ('tieuhoc', 'Tiểu học', 1, 5, 1, null), ('thcs', 'THCS', 6, 9, 2, null), ('thpt', 'THPT', 10, 12, 3, null)
on conflict (code) do nothing;

-- Chương trình: cấp học theo danh mục, khối nằm trong khoảng của cấp học
alter table edu_programs drop constraint if exists edu_programs_level_check;
alter table edu_programs drop constraint if exists edu_programs_check1;
alter table edu_programs drop constraint if exists edu_programs_check2;
alter table edu_programs drop constraint if exists edu_programs_check3;
-- Phòng khi tên ràng buộc trên CSDL khác: bỏ mọi CHECK còn nhắc tới cấp học
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'edu_programs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\mlevel\M' loop
    execute format('alter table edu_programs drop constraint %I', c.conname);
  end loop;
end $$;
alter table edu_programs drop constraint if exists edu_programs_level_fkey;
alter table edu_programs add constraint edu_programs_level_fkey foreign key (level) references edu_levels(code);

create or replace function public.edu_programs_level_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare l edu_levels;
begin
  select * into l from edu_levels where code = new.level;
  if l.code is null then raise exception 'Cấp học không có trong danh mục' using errcode = '22023'; end if;
  if (tg_op = 'INSERT' or new.level is distinct from old.level or new.grade_from is distinct from old.grade_from or new.grade_to is distinct from old.grade_to)
     and (new.grade_from < l.grade_from or new.grade_to > l.grade_to) then
    raise exception 'Khối %–% nằm ngoài cấp học % (khối %–%)', new.grade_from, new.grade_to, l.name, l.grade_from, l.grade_to using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists edu_programs_level_guard on edu_programs;
create trigger edu_programs_level_guard before insert or update on edu_programs for each row execute function public.edu_programs_level_guard();

-- Môn học: cấp học áp dụng theo danh mục (mã lạ bị bỏ)
alter table subjects drop constraint if exists subjects_levels_check;
create or replace function public.subjects_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name); new.code := nullif(btrim(new.code), ''); new.domain := nullif(btrim(new.domain), '');
  new.description := nullif(btrim(new.description), '');
  new.levels := array(select l.code from edu_levels l where l.code = any(new.levels) order by l.sort, l.code);
  new.ct_codes := array(select t.code from stem_tracks t where t.code = any(new.ct_codes) order by t.sort, t.code);
  new.updated_at := now();
  return new;
end $$;

notify pgrst, 'reload schema';
