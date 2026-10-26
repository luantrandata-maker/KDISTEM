-- 092. Học phần / bài học / buổi học thuộc nhiều khối.
--  • Thêm edu_program_units.grades int[] (rỗng = theo mục cha / mọi khối của chương trình). Cột grade giữ nguyên
--    = khối đầu tiên để các màn hình cũ chạy như trước.
--  • Trigger đồng bộ hai chiều: sửa grades → grade = khối đầu; sửa grade (đường cũ) → grades = [grade].
--  • Mọi khối của học phần phải thuộc chương trình; tạo PPCT theo khối lấy mục có khối đó (kế thừa từ mục cha).
--  • Nhân bản / phiên bản mới chép danh sách khối.
-- Cần chạy sau 091.

alter table edu_program_units add column if not exists grades int[] not null default '{}';

alter table edu_program_units disable trigger edu_units_guard;
update edu_program_units set grades = array[grade] where grade is not null and grades = '{}';
alter table edu_program_units enable trigger edu_units_guard;

create or replace function public.edu_units_grades_sync() returns trigger
language plpgsql set search_path = public as $$
begin
  new.grades := coalesce((select array_agg(distinct g order by g) from unnest(new.grades) g where g is not null), '{}');
  if tg_op = 'INSERT' then
    if cardinality(new.grades) > 0 then new.grade := new.grades[1];
    elsif new.grade is not null then new.grades := array[new.grade]; end if;
  elsif new.grades is distinct from old.grades then
    new.grade := new.grades[1];
  elsif new.grade is distinct from old.grade then
    new.grades := case when new.grade is null then '{}' else array[new.grade] end;
  end if;
  return new;
end $$;
-- Tên "edu_units_a_…" để chạy trước edu_units_grade_guard và edu_units_guard
drop trigger if exists edu_units_a_grades_sync on edu_program_units;
create trigger edu_units_a_grades_sync before insert or update on edu_program_units for each row execute function public.edu_units_grades_sync();
revoke all on function public.edu_units_grades_sync() from public, anon, authenticated;

-- Mọi khối của học phần / bài phải có trong danh sách khối của chương trình
create or replace function public.edu_units_grade_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v int[]; bad text;
begin
  if cardinality(new.grades) = 0 then return new; end if;
  select grades into v from edu_programs where id = new.program_id;
  if v is null or cardinality(v) = 0 then return new; end if;
  select string_agg(g::text, ', ') into bad from unnest(new.grades) g where not (g = any(v));
  if bad is not null then
    raise exception 'Khối % không thuộc chương trình (khối %)', bad, array_to_string(v, ', ') using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists edu_units_grade_guard on edu_program_units;
create trigger edu_units_grade_guard before insert or update of grade, grades, program_id on edu_program_units for each row execute function public.edu_units_grade_guard();

-- Bỏ khối khỏi chương trình: kiểm tra theo mọi khối của học phần
create or replace function public.edu_programs_grades_unit_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  if new.grades is distinct from old.grades then
    select string_agg(distinct g::text, ', ') into bad
      from edu_program_units u, unnest(u.grades) g where u.program_id = new.id and not (g = any(new.grades));
    if bad is not null then
      raise exception 'Còn học phần / bài học thuộc khối %: đổi khối của chúng trước khi bỏ khối này', bad using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists edu_programs_b_grades_unit_check on edu_programs;
create trigger edu_programs_b_grades_unit_check before update of grades on edu_programs for each row execute function public.edu_programs_grades_unit_check();
revoke all on function public.edu_programs_grades_unit_check() from public, anon, authenticated;

-- Tạo PPCT: mục thuộc khối của PPCT (khối của mục, không có thì theo mục cha)
create or replace function public.curriculum_generate(p_book uuid, p_alloc jsonb default null, p_review boolean default false,
  p_test boolean default false, p_reason text default null, p_reason_code text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; p edu_programs; v_alloc jsonb; v_hk1 int; v_cap numeric; n int; v_old int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  if b.program_id is null then raise exception 'PPCT chưa gắn chương trình giáo dục' using errcode = '22023'; end if;
  select * into p from edu_programs where id = b.program_id;
  if p.id is null then raise exception 'Không đọc được chương trình của PPCT' using errcode = '42501'; end if;
  if p_alloc is not null and jsonb_typeof(p_alloc) <> 'array' then raise exception 'Bảng phân bổ không hợp lệ' using errcode = '22023'; end if;
  v_alloc := coalesce(p_alloc, b.allocation, '[]'::jsonb);
  update curriculum_books set allocation = coalesce(p_alloc, allocation) where id = b.id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Bạn không có quyền sửa PPCT này' using errcode = '42501'; end if;
  select count(*) into v_old from curriculum_lessons where book_id = b.id;

  select w.hk1 into v_hk1 from public.curriculum_term_weeks(b.org_id, b.year_name) w;
  v_cap := case when b.periods_per_week > 0 then v_hk1 * b.periods_per_week end;

  perform set_config('app.ppct_import', 'on', true);
  delete from curriculum_lessons where book_id = b.id;
  with recursive t as (
    select u.id, u.title, u.periods, array[u.seq, 0, 0] as path, nullif(u.grades, '{}'::int[]) as grade, u.subject, 1 as depth
      from edu_program_units u where u.program_id = p.id and u.parent_id is null
    union all
    select u.id, u.title, u.periods, t.path[1:t.depth] || u.seq || array_fill(0, array[2 - t.depth]),
           coalesce(nullif(u.grades, '{}'::int[]), t.grade), coalesce(u.subject, t.subject), t.depth + 1
      from edu_program_units u join t on u.parent_id = t.id where t.depth < 3
  ), leaf as (
    select t.*, row_number() over (order by t.path) as ord from t
     where not exists (select 1 from edu_program_units c where c.parent_id = t.id)
       and (t.grade is null or b.grade = any(t.grade))
       and (lower(b.subject) = lower(p.main_subject) or t.subject is null or lower(t.subject) = lower(b.subject))
  ), al as (
    select l.id, l.title, l.ord,
           greatest(0, least(200, coalesce(nullif(a.x->>'periods', '')::int, greatest(l.periods, 1)))) as n,
           case when a.x->>'term' in ('1', '2') then (a.x->>'term')::int end as term
      from leaf l
      left join lateral (select x from jsonb_array_elements(v_alloc) x where x->>'unit_id' = l.id::text limit 1) a on true
  ), cum as (
    select al.*, sum(al.n) over (order by al.ord) - al.n as before, sum(al.n) over () as total from al where al.n > 0
  ), tr as (
    select c.id, c.title, c.ord, c.n,
           coalesce(c.term, case p.deploy_term when 'hk1' then 1 when 'hk2' then 2 end, case when v_cap is not null then (case when c.before < v_cap then 1 else 2 end)
                                 else (case when c.before * 2 < c.total then 1 else 2 end) end) as term
      from cum c
  ), r as (
    select tr.term, 0 as tail, tr.ord, k, tr.id as unit_id,
           tr.title || case when k > 1 then ' (tiếp)' else '' end as title,
           case when tr.title ilike 'Kiểm tra%' then 'test' when tr.title ilike 'Ôn tập%' then 'review'
                when p.kind = 'stem' or tr.title ilike '%STEM%' then 'stem' when tr.title ilike '%thực hành%' then 'practice' else 'lesson' end as kind
      from tr cross join lateral generate_series(1, tr.n) k
    union all
    select d.term, 1, 0, e.k, null::uuid, e.prefix || case when d.term = 1 then 'I' else 'II' end, e.kind
      from (select distinct tr.term from tr) d
      cross join (values (1, 'Ôn tập cuối học kỳ ', 'review'), (2, 'Kiểm tra cuối học kỳ ', 'test')) e(k, prefix, kind)
     where (e.kind = 'review' and p_review) or (e.kind = 'test' and p_test)
  ), num as (
    select r.*, row_number() over (partition by r.term order by r.tail, r.ord, r.k) as i,
           row_number() over (order by r.term, r.tail, r.ord, r.k) as seq
      from r
  )
  insert into curriculum_lessons (book_id, seq, week, term, title, kind, unit_id)
  select b.id, num.seq,
         case when b.periods_per_week > 0 then least(52, case when num.term = 2 then v_hk1 else 0 end + ceil(num.i / b.periods_per_week)::int) end,
         num.term, num.title, num.kind, num.unit_id
    from num where num.seq <= 400;
  get diagnostics n = row_count;
  perform set_config('app.ppct_import', 'off', true);
  if n = 0 then raise exception 'Chương trình chưa có bài học cho khối %', b.grade using errcode = '22023'; end if;
  perform public.curriculum_change_done(b, 'import', p_reason_code, coalesce(nullif(btrim(p_reason), ''), 'Phân bổ lại tiết theo chương trình'),
                                        jsonb_build_object('count', n), v_old);
  return n;
end $$;
revoke all on function public.curriculum_generate(uuid, jsonb, boolean, boolean, text, text) from public, anon;
grant execute on function public.curriculum_generate(uuid, jsonb, boolean, boolean, text, text) to authenticated;

-- Nhân bản / phiên bản mới chép danh sách khối của học phần
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
    insert into edu_program_units (id, program_id, parent_id, unit_type, seq, grade, grades, subject, title, periods, objectives, content, lesson)
    select (v_map->>u.id::text)::uuid, v_new, (v_map->>u.parent_id::text)::uuid, u.unit_type, u.seq, u.grade, u.grades, u.subject, u.title,
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
