-- 089. Chương trình giáo dục: một chương trình thuộc nhiều nhóm chương trình, nhiều cấp học, nhiều môn chủ đạo.
--  • Thêm ct_codes / levels / main_subjects (mảng). Cột đơn cũ (ct_code / level / main_subject) giữ nguyên làm giá trị
--    chính = phần tử đầu của mảng, để các màn hình khác (phân phối chương trình, thư viện, học liệu…) chạy như cũ.
--  • Trigger đồng bộ hai chiều: sửa mảng → cột đơn = phần tử đầu; sửa cột đơn (đường cũ) → thay giá trị chính cũ ở đầu mảng.
--  • Nhân bản / phiên bản mới chép cả ba mảng.
-- Cần chạy sau 088.

alter table edu_programs add column if not exists ct_codes text[] not null default '{}';
alter table edu_programs add column if not exists levels text[] not null default '{}';
alter table edu_programs add column if not exists main_subjects text[] not null default '{}';

-- Điền dữ liệu cũ (tắt tạm trigger khoá nội dung chương trình đã phát hành)
alter table edu_programs disable trigger edu_programs_guard;
update edu_programs set ct_codes = case when ct_code is null then '{}' else array[ct_code] end where ct_codes = '{}' and ct_code is not null;
update edu_programs set levels = array[level] where levels = '{}';
update edu_programs set main_subjects = array[main_subject] where main_subjects = '{}';
alter table edu_programs enable trigger edu_programs_guard;

-- Bỏ phần tử rỗng / trùng, giữ thứ tự
create or replace function public.text_array_clean(a text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x order by i), '{}') from (
    select btrim(v) x, min(o) i from unnest(a) with ordinality u(v, o) where v is not null and btrim(v) <> '' group by btrim(v)) t
$$;

-- security definer: kiểm tra danh mục nhóm / cấp học không phụ thuộc quyền đọc của người sửa
create or replace function public.edu_programs_multi_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  new.ct_codes := public.text_array_clean(new.ct_codes);
  new.levels := public.text_array_clean(new.levels);
  new.main_subjects := public.text_array_clean(new.main_subjects);
  if tg_op = 'INSERT' then
    if cardinality(new.ct_codes) > 0 then new.ct_code := new.ct_codes[1]; elsif new.ct_code is not null then new.ct_codes := array[new.ct_code]; end if;
    if cardinality(new.levels) > 0 then new.level := new.levels[1]; else new.levels := array[new.level]; end if;
    if cardinality(new.main_subjects) > 0 then new.main_subject := new.main_subjects[1]; elsif new.main_subject is not null then new.main_subjects := array[new.main_subject]; end if;
  else
    if old.status not in ('draft', 'rejected') and (new.ct_codes, new.levels, new.main_subjects) is distinct from (old.ct_codes, old.levels, old.main_subjects) then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa nội dung' using errcode = '22023';
    end if;
    if new.ct_codes is distinct from old.ct_codes then new.ct_code := new.ct_codes[1];
    elsif new.ct_code is distinct from old.ct_code then
      new.ct_codes := case when new.ct_code is null then '{}' else array_prepend(new.ct_code, array_remove(array_remove(new.ct_codes, old.ct_code), new.ct_code)) end;
    end if;
    if new.levels is distinct from old.levels then
      if cardinality(new.levels) = 0 then raise exception 'Chọn ít nhất một cấp học' using errcode = '22023'; end if;
      new.level := new.levels[1];
    elsif new.level is distinct from old.level then new.levels := array_prepend(new.level, array_remove(array_remove(new.levels, old.level), new.level));
    end if;
    if new.main_subjects is distinct from old.main_subjects then
      if cardinality(new.main_subjects) = 0 then raise exception 'Chọn ít nhất một môn chủ đạo' using errcode = '22023'; end if;
      new.main_subject := new.main_subjects[1];
    elsif new.main_subject is distinct from old.main_subject then new.main_subjects := array_prepend(new.main_subject, array_remove(array_remove(new.main_subjects, old.main_subject), new.main_subject));
    end if;
  end if;
  -- Chỉ kiểm tra mã mới thêm (mã cũ đã kiểm tra khi thêm)
  select string_agg(c, ', ') into bad from unnest(new.ct_codes) c
   where not exists (select 1 from stem_tracks t where t.code = c) and (tg_op = 'INSERT' or not c = any(old.ct_codes));
  if bad is not null then raise exception 'Nhóm chương trình không có trong danh mục: %', bad using errcode = '22023'; end if;
  select string_agg(c, ', ') into bad from unnest(new.levels) c
   where not exists (select 1 from edu_levels l where l.code = c) and (tg_op = 'INSERT' or not c = any(old.levels));
  if bad is not null then raise exception 'Cấp học không có trong danh mục: %', bad using errcode = '22023'; end if;
  -- Môn tích hợp không trùng môn chủ đạo
  new.integrated_subjects := array(select s from unnest(new.integrated_subjects) s where not (s = any(new.main_subjects)));
  return new;
end $$;
-- Tên bắt đầu "edu_programs_a" để chạy trước edu_programs_guard (trigger cùng loại chạy theo thứ tự tên)
drop trigger if exists edu_programs_a_multi_sync on edu_programs;
create trigger edu_programs_a_multi_sync before insert or update on edu_programs for each row execute function public.edu_programs_multi_sync();

revoke all on function public.edu_programs_multi_sync() from public, anon, authenticated;

-- Khối phải nằm trong phạm vi các cấp học đã chọn (từ khối nhỏ nhất tới khối lớn nhất của các cấp)
create or replace function public.edu_programs_level_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare lo int; hi int; names text;
begin
  select min(l.grade_from), max(l.grade_to), string_agg(l.name, ', ' order by l.grade_from) into lo, hi, names
    from edu_levels l where l.code = any(coalesce(nullif(new.levels, '{}'), array[new.level]));
  if lo is null then raise exception 'Cấp học không có trong danh mục' using errcode = '22023'; end if;
  if (tg_op = 'INSERT' or new.levels is distinct from old.levels or new.level is distinct from old.level
      or new.grade_from is distinct from old.grade_from or new.grade_to is distinct from old.grade_to)
     and (new.grade_from < lo or new.grade_to > hi) then
    raise exception 'Khối %–% nằm ngoài cấp học % (khối %–%)', new.grade_from, new.grade_to, names, lo, hi using errcode = '22023';
  end if;
  return new;
end $$;

create index if not exists edu_programs_levels on edu_programs using gin (levels);

-- Nhân bản / phiên bản mới chép cả nhóm, cấp học, môn chủ đạo
create or replace function public.edu_program_clone(p_src uuid, p_org uuid, p_family uuid, p_version int) returns uuid
language plpgsql set search_path = public as $$
declare s edu_programs; v_new uuid := gen_random_uuid(); v_map jsonb; t text;
begin
  select * into s from edu_programs where id = p_src;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  insert into edu_programs (id, org_id, family_id, version_no, code, title, kind, ct_code, level, grade_from, grade_to, main_subject,
                            integrated_subjects, objectives, competency_keys, rubric_ids, status, scope, source_id, note, periods_per_week, deploy_term,
                            ct_codes, levels, main_subjects)
  values (v_new, p_org, coalesce(p_family, v_new), p_version, s.code, s.title, s.kind, s.ct_code, s.level, s.grade_from, s.grade_to,
          s.main_subject, s.integrated_subjects, s.objectives, s.competency_keys, s.rubric_ids, 'draft',
          case when p_org = s.org_id then s.scope else 'own' end, s.id, s.note, s.periods_per_week, s.deploy_term,
          s.ct_codes, s.levels, s.main_subjects);
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
