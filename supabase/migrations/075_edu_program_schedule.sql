-- 075. Chương trình giáo dục — Phân hệ 2, đợt 1 (theo file "Luồng, tính năng và cách thiết kế")
--  • edu_programs.periods_per_week (số tiết / tuần) và deploy_term (thời gian triển khai: hk1 · hk2 · year).
--    PPCT tạo từ chương trình lấy sẵn số tiết / tuần; sinh PPCT xếp bài vào HK I / HK II theo thời gian triển khai.
--  • Mọi chương trình thuộc một nhóm chương trình (ct_code → stem_tracks), không chỉ chương trình STEM.
--    Bản cũ chưa có nhóm vẫn xem / sửa được; phải chọn nhóm trước khi gửi duyệt hoặc phát hành.
--  • Thêm 2 nhóm: KDI-SC và DX (Đề xuất).
--  • Gửi duyệt / phát hành cần nhóm chương trình (vẫn cần có chủ đề / bài học như trước).
-- Cần chạy sau 074.

-- ===== 1. Cột mới =====
alter table edu_programs add column if not exists periods_per_week numeric(4,1),
  add column if not exists deploy_term text not null default 'year';
alter table edu_programs drop constraint if exists edu_programs_ppw_check;
alter table edu_programs add constraint edu_programs_ppw_check check (periods_per_week is null or (periods_per_week > 0 and periods_per_week <= 40));
alter table edu_programs drop constraint if exists edu_programs_deploy_term_check;
alter table edu_programs add constraint edu_programs_deploy_term_check check (deploy_term in ('hk1', 'hk2', 'year'));

-- ===== 2. Nhóm chương trình mới =====
insert into stem_tracks (code, name, title, description, subjects, levels, sort) values
  ('KDI-SC', 'KDI-SC', 'Chương trình KDI-SC', '', '{}', '{mamnon,tieuhoc,thcs,thpt,thpt_nghe}', 6),
  ('DX', 'Đề xuất', 'Chương trình đề xuất', 'Chương trình đề xuất, chưa xếp vào nhóm CT1–CT5.', '{}', '{mamnon,tieuhoc,thcs,thpt,thpt_nghe}', 7)
on conflict (code) do nothing;

-- ===== 3. Kiểm tra khi lưu: nhóm chương trình, khoá cột mới khi đã gửi duyệt / ban hành =====
create or replace function public.edu_programs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('pending', 'published') then
      raise exception 'Không xoá chương trình đang chờ duyệt hoặc đang ban hành — hãy lưu trữ' using errcode = '22023';
    end if;
    return old;
  end if;
  new.title := btrim(new.title); new.main_subject := btrim(new.main_subject);
  if new.title = '' or new.main_subject = '' then raise exception 'Nhập tên chương trình và môn chủ đạo' using errcode = '22023'; end if;
  new.integrated_subjects := array(select distinct btrim(x) from unnest(new.integrated_subjects) x where btrim(x) <> '' and lower(btrim(x)) <> lower(new.main_subject));
  if exists (select 1 from unnest(new.competency_keys) k where not exists (select 1 from competencies c where c.key = k)) then
    raise exception 'Năng lực không có trong khung năng lực' using errcode = '22023';
  end if;
  -- 075: mọi chương trình thuộc một nhóm chương trình (loại CT); bản cũ chưa có nhóm được giữ nguyên tới khi sửa
  if new.ct_code is null and ((tg_op = 'INSERT' and new.source_id is null) or (tg_op = 'UPDATE' and old.ct_code is not null)) then
    raise exception 'Chọn nhóm chương trình' using errcode = '22023';
  end if;
  if new.deploy_term is null or new.deploy_term not in ('hk1', 'hk2', 'year') then new.deploy_term := 'year'; end if;
  if tg_op = 'INSERT' then
    new.family_id := coalesce(new.family_id, new.id);
  else
    new.family_id := old.family_id; new.org_id := old.org_id; new.created_by := old.created_by;
    if old.status not in ('draft', 'rejected') and (
         new.title, new.code, new.kind, new.ct_code, new.level, new.grade_from, new.grade_to, new.main_subject,
         new.integrated_subjects, new.objectives, new.competency_keys, new.rubric_ids, new.version_no, new.periods_per_week, new.deploy_term)
       is distinct from (
         old.title, old.code, old.kind, old.ct_code, old.level, old.grade_from, old.grade_to, old.main_subject,
         old.integrated_subjects, old.objectives, old.competency_keys, old.rubric_ids, old.version_no, old.periods_per_week, old.deploy_term) then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa nội dung' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ===== 4. Gửi duyệt / phát hành: cần nhóm chương trình =====
create or replace function public.edu_program_set_status(p_program uuid, p_status text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s edu_programs; v_old uuid;
begin
  select * into s from edu_programs where id = p_program for update;
  if s.id is null or not public.curriculum_can_write(s.org_id, 'edit') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  if p_status = 'pending' then
    if s.status not in ('draft', 'rejected') then raise exception 'Chỉ gửi duyệt bản nháp' using errcode = '22023'; end if;
    if not exists (select 1 from edu_program_units where program_id = s.id) then raise exception 'Chương trình chưa có chủ đề / bài học' using errcode = '22023'; end if;
        if s.ct_code is null then raise exception 'Chọn nhóm chương trình trước khi gửi duyệt hoặc phát hành' using errcode = '22023'; end if;
  elsif p_status = 'published' then
    if s.status not in ('draft', 'approved') then raise exception 'Chỉ ban hành bản nháp hoặc bản đã duyệt' using errcode = '22023'; end if;
    -- Trường: phải qua duyệt (trừ khi người ban hành là Ban giám hiệu / quản trị trường)
    if s.status = 'draft' and (select type from organizations where id = s.org_id) = 'school' and not public.is_admin() then
      raise exception 'Gửi duyệt trước khi ban hành' using errcode = '42501';
    end if;
    if not exists (select 1 from edu_program_units where program_id = s.id) then raise exception 'Chương trình chưa có chủ đề / bài học' using errcode = '22023'; end if;
        if s.ct_code is null then raise exception 'Chọn nhóm chương trình trước khi gửi duyệt hoặc phát hành' using errcode = '22023'; end if;
    for v_old in select id from edu_programs where family_id = s.family_id and id <> s.id and status = 'published' loop
      perform set_config('app.status_note', 'Thay thế bởi phiên bản ' || s.version_no, true);
      update edu_programs set status = 'superseded', replaced_by = s.id, effective_to = coalesce(effective_to, public.vn_today()) where id = v_old;
    end loop;
    perform set_config('app.status_note', coalesce(p_note, ''), true);
    update edu_programs set status = 'published', published_at = now(), effective_from = coalesce(effective_from, public.vn_today()) where id = s.id;
    return 'published';
  elsif p_status = 'archived' then
    if s.status = 'pending' then raise exception 'Rút hồ sơ duyệt trước khi lưu trữ' using errcode = '22023'; end if;
  elsif p_status = 'draft' then
    if s.status not in ('rejected', 'approved', 'archived') then raise exception 'Không mở lại được bản này' using errcode = '22023'; end if;
    if s.status = 'archived' and exists (select 1 from edu_programs where family_id = s.family_id and id <> s.id and status in ('draft', 'pending', 'approved', 'rejected')) then
      raise exception 'Chương trình đã có một phiên bản đang soạn' using errcode = '22023';
    end if;
  else
    raise exception 'Trạng thái không hợp lệ' using errcode = '22023';
  end if;
  update edu_programs set status = p_status where id = s.id;
  return p_status;
end $$;

-- ===== 5. Phiên bản mới / sao chép giữ số tiết / tuần và thời gian triển khai =====
create or replace function public.edu_program_clone(p_src uuid, p_org uuid, p_family uuid, p_version int) returns uuid
language plpgsql set search_path = public as $$
declare s edu_programs; v_new uuid := gen_random_uuid(); v_map jsonb; t text;
begin
  select * into s from edu_programs where id = p_src;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  insert into edu_programs (id, org_id, family_id, version_no, code, title, kind, ct_code, level, grade_from, grade_to, main_subject,
                            integrated_subjects, objectives, competency_keys, rubric_ids, status, scope, source_id, note, periods_per_week, deploy_term)
  values (v_new, p_org, coalesce(p_family, v_new), p_version, s.code, s.title, s.kind, s.ct_code, s.level, s.grade_from, s.grade_to,
          s.main_subject, s.integrated_subjects, s.objectives, s.competency_keys, s.rubric_ids, 'draft',
          case when p_org = s.org_id then s.scope else 'own' end, s.id, s.note, s.periods_per_week, s.deploy_term);
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

-- ===== 6. PPCT: số tiết / tuần mặc định từ chương trình =====
create or replace function public.curriculum_books_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.title := btrim(new.title); new.subject := btrim(new.subject);
  if new.title = '' or new.subject = '' then raise exception 'Nhập tên và môn học' using errcode = '22023'; end if;
  new.year_name := nullif(btrim(new.year_name), '');
  if exists (select 1 from organizations o where o.id = new.org_id and o.type = 'school') then
    if new.year_name is null then
      select a.name into new.year_name from academic_years a where a.org_id = new.org_id and a.is_current limit 1;
    elsif (tg_op = 'INSERT' or new.year_name is distinct from old.year_name or new.org_id is distinct from old.org_id)
      and exists (select 1 from academic_years a where a.org_id = new.org_id)
      and not exists (select 1 from academic_years a where a.org_id = new.org_id and a.name = new.year_name) then
      raise exception 'Năm học "%" chưa có trong danh mục năm học của trường', new.year_name using errcode = '22023';
    end if;
  end if;
  -- 075: PPCT tạo từ chương trình lấy số tiết / tuần của chương trình khi chưa nhập
  if tg_op = 'INSERT' and new.periods_per_week is null and new.program_id is not null then
    select p.periods_per_week into new.periods_per_week from edu_programs p where p.id = new.program_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ===== 7. Sinh PPCT: chương trình chỉ HK I / chỉ HK II xếp hết bài vào học kỳ đó =====
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
    select u.id, u.title, u.periods, array[u.seq, 0, 0] as path, u.grade, u.subject, 1 as depth
      from edu_program_units u where u.program_id = p.id and u.parent_id is null
    union all
    select u.id, u.title, u.periods, t.path[1:t.depth] || u.seq || array_fill(0, array[2 - t.depth]),
           coalesce(u.grade, t.grade), coalesce(u.subject, t.subject), t.depth + 1
      from edu_program_units u join t on u.parent_id = t.id where t.depth < 3
  ), leaf as (
    select t.*, row_number() over (order by t.path) as ord from t
     where not exists (select 1 from edu_program_units c where c.parent_id = t.id)
       and (t.grade is null or t.grade = b.grade)
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

notify pgrst, 'reload schema';
