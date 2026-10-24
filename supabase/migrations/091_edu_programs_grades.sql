-- 091. Chương trình giáo dục: chọn khối theo danh sách (tick từng khối) thay cho "Từ khối – Đến khối".
--  • Thêm edu_programs.grades int[] (khối áp dụng, tăng dần, không trùng). grade_from / grade_to giữ nguyên
--    làm khối nhỏ nhất / lớn nhất để các màn hình và hàm cũ chạy như trước.
--  • Trigger đồng bộ hai chiều: sửa grades → grade_from/grade_to = min/max; sửa grade_from/grade_to (đường cũ)
--    → grades = mọi khối trong khoảng. Khoá khi chương trình đã gửi duyệt / ban hành.
--  • Khối của học phần / bài, PPCT tạo từ chương trình, kế hoạch phân phối và tạo PPCT khi gán trường
--    chỉ nhận khối có trong danh sách.
-- Cần chạy sau 090.

alter table edu_programs add column if not exists grades int[] not null default '{}';

alter table edu_programs disable trigger edu_programs_guard;
update edu_programs set grades = array(select generate_series(grade_from, grade_to)) where grades = '{}';
alter table edu_programs enable trigger edu_programs_guard;

create or replace function public.edu_programs_grades_sync() returns trigger
language plpgsql set search_path = public as $$
begin
  new.grades := coalesce((select array_agg(distinct g order by g) from unnest(new.grades) g where g is not null), '{}');
  if exists (select 1 from unnest(new.grades) g where g < 1 or g > 12) then
    raise exception 'Khối phải từ 1 đến 12' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if cardinality(new.grades) > 0 then new.grade_from := new.grades[1]; new.grade_to := new.grades[cardinality(new.grades)];
    else new.grades := array(select generate_series(new.grade_from, new.grade_to)); end if;
  else
    if old.status not in ('draft', 'rejected') and new.grades is distinct from old.grades then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa nội dung' using errcode = '22023';
    end if;
    if new.grades is distinct from old.grades then
      if cardinality(new.grades) = 0 then raise exception 'Chọn ít nhất một khối' using errcode = '22023'; end if;
      new.grade_from := new.grades[1]; new.grade_to := new.grades[cardinality(new.grades)];
      if exists (select 1 from edu_program_units u where u.program_id = new.id and u.grade is not null and not (u.grade = any(new.grades))) then
        raise exception 'Còn học phần / bài học thuộc khối %: đổi khối của chúng trước khi bỏ khối này',
          (select string_agg(distinct u.grade::text, ', ') from edu_program_units u where u.program_id = new.id and u.grade is not null and not (u.grade = any(new.grades)))
          using errcode = '22023';
      end if;
    elsif (new.grade_from, new.grade_to) is distinct from (old.grade_from, old.grade_to) then
      new.grades := array(select generate_series(new.grade_from, new.grade_to));
    end if;
  end if;
  return new;
end $$;
-- Tên "edu_programs_a_grades…" để chạy trước edu_programs_guard và edu_programs_level_guard
drop trigger if exists edu_programs_a_grades_sync on edu_programs;
create trigger edu_programs_a_grades_sync before insert or update on edu_programs for each row execute function public.edu_programs_grades_sync();
revoke all on function public.edu_programs_grades_sync() from public, anon, authenticated;

-- Khối của học phần / bài phải có trong danh sách khối của chương trình
create or replace function public.edu_units_grade_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v int[];
begin
  if new.grade is null then return new; end if;
  select grades into v from edu_programs where id = new.program_id;
  if v is not null and cardinality(v) > 0 and not (new.grade = any(v)) then
    raise exception 'Khối % không thuộc chương trình (khối %)', new.grade, array_to_string(v, ', ') using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists edu_units_grade_guard on edu_program_units;
create trigger edu_units_grade_guard before insert or update of grade, program_id on edu_program_units for each row execute function public.edu_units_grade_guard();
revoke all on function public.edu_units_grade_guard() from public, anon, authenticated;

-- PPCT tạo từ chương trình: khối phải có trong danh sách
create or replace function public.curriculum_from_program(p_program uuid, p_grade int, p_subject text default null,
  p_year text default null, p_ppw numeric default null) returns uuid
language plpgsql set search_path = public as $$
declare p edu_programs; v_book uuid; v_org uuid := public.my_org_id(); v_school boolean;
begin
  select * into p from edu_programs where id = p_program;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  if not (p_grade = any(p.grades)) then raise exception 'Khối % không thuộc chương trình', p_grade using errcode = '22023'; end if;
  v_school := exists (select 1 from organizations where id = v_org and type = 'school');
  insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, program_id, note)
  values (v_org, p_grade, coalesce(nullif(btrim(p_subject), ''), p.main_subject),
          p.title || ' — khối ' || p_grade, case when v_school then nullif(btrim(p_year), '') end, p_ppw, 'draft',
          case when v_school then 'own' else 'children' end, p.id,
          'Tạo từ chương trình "' || p.title || '" (phiên bản ' || p.version_no || ')')
  returning id into v_book;
  perform public.curriculum_generate(v_book);
  return v_book;
end $$;
revoke all on function public.curriculum_from_program(uuid, int, text, text, numeric) from public, anon;
grant execute on function public.curriculum_from_program(uuid, int, text, text, numeric) to authenticated;

-- Tạo PPCT khi gán trường: chỉ các khối trong danh sách
create or replace function public.curriculum_seed_school_books(p_program uuid, p_org uuid, p_grades int[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare p edu_programs; g int; v_year text; t curriculum_books; v_book uuid; n int := 0;
begin
  select * into p from edu_programs where id = p_program;
  if p.id is null then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = p_org and type = 'school') then return 0; end if;
  if not exists (select 1 from edu_program_assignments a where a.program_id = p_program and a.org_id = p_org
                   and (a.assigner_org = public.my_org_id() or public.curriculum_can_write(public.edu_program_org(p_program), 'edit')))
     or not (p_org in (select public.my_org_tree()) or public.is_platform_admin()) then
    raise exception 'Chỉ đơn vị đã gán chương trình mới tạo được PPCT cho trường' using errcode = '42501';
  end if;
  select a.name into v_year from academic_years a where a.org_id = p_org and a.is_current limit 1;
  for g in select x from unnest(p.grades) x where p_grades is null or x = any(p_grades) loop
    continue when exists (select 1 from curriculum_books b where b.org_id = p_org and b.grade = g and lower(b.subject) = lower(p.main_subject)
                                                          and b.year_name is not distinct from v_year);
    select b.* into t from curriculum_books b
     where b.program_id = p.id and b.grade = g and b.scope = 'children' and b.status = 'published'
       and b.org_id in (public.my_org_id(), public.platform_org_id())
     order by (b.org_id = public.my_org_id()) desc, b.updated_at desc limit 1;
    insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, source_id, program_id, allocation, note)
    values (p_org, g, coalesce(t.subject, p.main_subject), coalesce(t.title, p.title || ' — khối ' || g), v_year, t.periods_per_week, 'draft', 'own',
            t.id, p.id, t.allocation, 'Tạo sẵn khi được gán chương trình "' || p.title || '"')
    returning id into v_book;
    if t.id is not null then
      perform set_config('app.ppct_import', 'on', true);
      insert into curriculum_lessons (book_id, seq, week, term, title, kind, unit_id, note)
      select v_book, l.seq, l.week, l.term, l.title, l.kind, l.unit_id, l.note from curriculum_lessons l where l.book_id = t.id;
      perform set_config('app.ppct_import', 'off', true);
    else
      begin
        perform public.curriculum_generate(v_book);
      exception when sqlstate '22023' then
        delete from curriculum_books where id = v_book; v_book := null;
      end;
    end if;
    if v_book is not null then n := n + 1; end if;
    t := null;
  end loop;
  return n;
end $$;
revoke all on function public.curriculum_seed_school_books(uuid, uuid, int[]) from public, anon;
grant execute on function public.curriculum_seed_school_books(uuid, uuid, int[]) to authenticated;

-- Kế hoạch phân phối: chương trình phải dạy đúng khối
create or replace function public.dist_plan_errors(p_plan uuid, p_grade int, p_weeks int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when not exists (select 1 from dist_plan_items where plan_id = p_plan) then 'chưa chọn chương trình' end,
    (select 'chương trình "' || p.title || '" chưa phát hành' from dist_plan_items i join edu_programs p on p.id = i.program_id
      where i.plan_id = p_plan and p.status <> 'published' limit 1),
    (select 'chương trình "' || p.title || '" không dạy khối ' || p_grade from dist_plan_items i join edu_programs p on p.id = i.program_id
      where i.plan_id = p_plan and not (p_grade = any(p.grades)) limit 1),
    case when not exists (select 1 from dist_plan_rows where plan_id = p_plan and not skipped and periods > 0) then 'chưa có bài nào được xếp' end,
    (select 'bài "' || u.title || '" chưa có tuần' from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
      where r.plan_id = p_plan and not r.skipped and r.periods > 0 and r.week is null order by r.seq limit 1),
    (select 'bài "' || u.title || '" xếp ở tuần ' || greatest(r.week, (select max(w) from unnest(r.weeks) w)) || ', ngoài khung ' || p_weeks || ' tuần'
       from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
      where r.plan_id = p_plan and not r.skipped and r.periods > 0
        and (r.week > p_weeks or exists (select 1 from unnest(r.weeks) w where w > p_weeks)) order by r.seq limit 1))
$$;

-- Nhân bản / phiên bản mới chép cả danh sách khối
create or replace function public.edu_program_clone(p_src uuid, p_org uuid, p_family uuid, p_version int) returns uuid
language plpgsql set search_path = public as $$
declare s edu_programs; v_new uuid := gen_random_uuid(); v_map jsonb; t text;
begin
  select * into s from edu_programs where id = p_src;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  insert into edu_programs (id, org_id, family_id, version_no, code, title, kind, ct_code, level, grade_from, grade_to, main_subject,
                            integrated_subjects, objectives, competency_keys, rubric_ids, status, scope, source_id, note, periods_per_week, deploy_term,
                            ct_codes, levels, main_subjects, grades)
  values (v_new, p_org, coalesce(p_family, v_new), p_version, s.code, s.title, s.kind, s.ct_code, s.level, s.grade_from, s.grade_to,
          s.main_subject, s.integrated_subjects, s.objectives, s.competency_keys, s.rubric_ids, 'draft',
          case when p_org = s.org_id then s.scope else 'own' end, s.id, s.note, s.periods_per_week, s.deploy_term,
          s.ct_codes, s.levels, s.main_subjects, s.grades);
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

notify pgrst, 'reload schema';
