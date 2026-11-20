-- 166: Bản phân phối (078) lấy chương trình từ Gói STEM.
-- Mỗi gói × loại CT × khối có một "chương trình theo gói" do hệ thống tạo (edu_programs của đơn vị nền tảng, đã ban hành):
-- mỗi chủ đề của gói (đúng quy tắc HP1 / HP2, 162) là một mục, kèm số tiết. Nhờ vậy màn Phân phối xếp tuần, nhịp tiết/tuần,
-- kéo thả, phát hành và gán cho trường như chương trình thường; PPCT tạo ra có tiết gắn chủ đề (program_topic_id) để mở học liệu.
-- • dist_pkg_options(khối): các gói × loại CT có chủ đề ở khối đó (số chủ đề, số tiết, chương trình theo gói đã có chưa).
-- • dist_pkg_program(gói, loại CT, khối): tạo hoặc cập nhật chương trình theo gói, trả id. Chủ đề đã đổi thì cập nhật tên / số tiết,
--   thêm chủ đề mới; chủ đề bị bỏ khỏi gói thì xoá khỏi chương trình nếu chưa nằm trong bản phân phối đã phát hành.
-- • curriculum_lessons: tiết có unit_id thuộc chương trình theo gói tự gắn program_topic_id.
-- Cần chạy sau 165.

alter table edu_programs add column if not exists package_id uuid references program_packages(id) on delete set null;
alter table edu_programs add column if not exists package_track text references stem_tracks(code);
create unique index if not exists edu_programs_package on edu_programs (package_id, package_track, grade_from) where package_id is not null;
comment on column edu_programs.package_id is 'Chương trình theo Gói STEM do hệ thống tạo (166)';
alter table edu_program_units add column if not exists program_topic_id uuid references program_topics(id) on delete set null;
alter table edu_program_units add column if not exists package_slot int;
create index if not exists edu_program_units_topic on edu_program_units (program_topic_id) where program_topic_id is not null;

-- ===== 1. Lựa chọn cho nút "+ Thêm từ Gói STEM" =====
create or replace function public.dist_pkg_options(p_grade int)
returns table (package_id uuid, package_code text, package_name text, track_code text, track_name text, topics int, periods int, program_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.code, p.name, x.track_code, tr.name, count(*)::int, sum(x.periods)::int,
         (select e.id from edu_programs e where e.package_id = p.id and e.package_track = x.track_code and e.grade_from = p_grade)
    from program_packages p cross join lateral public.package_topic_list(p.id) x join stem_tracks tr on tr.code = x.track_code
   where p.active and x.grade = p_grade and public.is_staff()
   group by p.id, p.code, p.name, p.sort, x.track_code, tr.name, tr.sort
   order by p.sort, p.code, tr.sort
$$;
revoke all on function public.dist_pkg_options(int) from public, anon;
grant execute on function public.dist_pkg_options(int) to authenticated;

-- ===== 2. Tạo / cập nhật chương trình theo gói =====
create or replace function public.dist_pkg_program(p_package uuid, p_track text, p_grade int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pk program_packages; tr stem_tracks; v_id uuid; v_level text; v_org uuid; v_changed boolean;
begin
  if not public.is_staff() then raise exception 'Bạn không dùng được Gói STEM' using errcode = '42501'; end if;
  select * into pk from program_packages where id = p_package;
  select * into tr from stem_tracks where code = p_track;
  if pk.id is null or tr.code is null then raise exception 'Không tìm thấy gói / loại chương trình' using errcode = '22023'; end if;
  create temp table if not exists pg_temp.dist_pkg_t (slot int, topic_id uuid, seq int, title text, periods int, module_name text) on commit drop;
  delete from pg_temp.dist_pkg_t;
  insert into pg_temp.dist_pkg_t
  select x.slot, x.topic_id, row_number() over (order by x.slot, x.topic_seq)::int, x.topic_title, x.periods, x.module_name
    from public.package_topic_list(p_package) x where x.track_code = p_track and x.grade = p_grade;
  if not exists (select 1 from pg_temp.dist_pkg_t) then
    raise exception 'Gói % không có chủ đề % ở khối %', pk.code, p_track, p_grade using errcode = '22023';
  end if;

  select id into v_id from edu_programs where package_id = p_package and package_track = p_track and grade_from = p_grade;
  if v_id is null then
    select l.code into v_level from edu_levels l where p_grade between l.grade_from and l.grade_to order by l.sort limit 1;
    v_org := public.platform_org_id();
    insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, status, scope, note, package_id, package_track)
    values (v_org, left(pk.code || '-' || tr.code || '-K' || p_grade, 40),
            left(coalesce(nullif(tr.label, ''), tr.code) || ' ' || tr.name || ' · Gói ' || pk.code || ' · Khối ' || p_grade, 200),
            'stem', tr.code, v_level, p_grade, p_grade, tr.name, 'draft', 'children', 'Tạo tự động từ Gói STEM ' || pk.code, p_package, p_track)
    returning id into v_id;
    v_changed := true;
  else
    v_changed := exists (select 1 from pg_temp.dist_pkg_t t where not exists (select 1 from edu_program_units u where u.program_id = v_id
                   and u.program_topic_id = t.topic_id and u.package_slot = t.slot and u.seq = t.seq and u.title = t.title and u.periods = t.periods))
              or exists (select 1 from edu_program_units u where u.program_id = v_id
                   and not exists (select 1 from pg_temp.dist_pkg_t t where t.topic_id = u.program_topic_id and t.slot = u.package_slot));
    if v_changed then update edu_programs set status = 'draft' where id = v_id; end if;
  end if;

  if v_changed then
    -- chủ đề bị bỏ khỏi gói: xoá nếu chưa nằm trong bản phân phối đã phát hành
    delete from edu_program_units u where u.program_id = v_id
       and not exists (select 1 from pg_temp.dist_pkg_t t where t.topic_id = u.program_topic_id and t.slot = u.package_slot)
       and not exists (select 1 from dist_plan_rows r join dist_plans d on d.id = r.plan_id where r.unit_id = u.id and d.status <> 'draft');
    update edu_program_units u set seq = t.seq, title = t.title, periods = t.periods, content = 'Học phần: ' || t.module_name
      from pg_temp.dist_pkg_t t where u.program_id = v_id and u.program_topic_id = t.topic_id and u.package_slot = t.slot;
    insert into edu_program_units (program_id, unit_type, seq, grade, title, periods, content, program_topic_id, package_slot)
    select v_id, 'topic', t.seq, p_grade, t.title, t.periods, 'Học phần: ' || t.module_name, t.topic_id, t.slot
      from pg_temp.dist_pkg_t t
     where not exists (select 1 from edu_program_units u where u.program_id = v_id and u.program_topic_id = t.topic_id and u.package_slot = t.slot);
    update edu_programs set status = 'published', published_at = coalesce(published_at, now()),
           total_periods = (select coalesce(sum(periods), 0) from edu_program_units where program_id = v_id)
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.dist_pkg_program(uuid, text, int) from public, anon;
grant execute on function public.dist_pkg_program(uuid, text, int) to authenticated;

-- ===== 3. Tiết PPCT tự gắn chủ đề của khung mới =====
create or replace function public.curriculum_lessons_topic() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.program_topic_id is null and new.unit_id is not null then
    select u.program_topic_id into new.program_topic_id from edu_program_units u where u.id = new.unit_id;
  end if;
  return new;
end $$;
drop trigger if exists curriculum_lessons_topic on curriculum_lessons;
create trigger curriculum_lessons_topic before insert or update of unit_id on curriculum_lessons for each row execute function public.curriculum_lessons_topic();

notify pgrst, 'reload schema';
