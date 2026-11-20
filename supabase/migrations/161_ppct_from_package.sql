-- 161: PPCT của trường lấy từ Gói STEM (khung chương trình mới), bước 1 của việc nối các phân hệ sang khung mới.
-- • school_package_topic_list(trường, năm học): danh sách chủ đề trường được học theo gói đang dùng (bản gán chưa kết thúc),
--   đúng quy tắc của trang Gói STEM / Trường dùng gói: học phần dùng ở nhiều vị trí trong cùng khối thì vị trí thứ k lấy chủ đề
--   phần k và chủ đề dùng chung (160); bỏ học phần / chủ đề trường không áp dụng (school_package_skips, khi không đủ gói).
-- • ppct_from_package(trường, năm học): tạo PPCT nháp cho mỗi loại chương trình × khối có chủ đề. Mỗi chủ đề trải thành
--   số tiết của chủ đề (tiết sau ghi "(tiếp)"), loại tiết "Chủ đề STEM", nhịp tiết/tuần tự tính để đủ trong 35 tuần.
--   PPCT đã tạo từ gói (cùng loại, khối, năm học) thì bỏ qua — chạy lại không tạo trùng. Trường sửa tiếp như PPCT thường.
-- • curriculum_books.track_code, school_package_id: PPCT thuộc loại chương trình nào, tạo từ bản gán gói nào.
--   curriculum_lessons.program_topic_id: tiết gắn chủ đề của khung mới (thay cho package_topic_id / unit_id của bảng cũ).
-- Cần chạy sau 160.

alter table curriculum_lessons add column if not exists program_topic_id uuid references program_topics(id) on delete set null;
create index if not exists curriculum_lessons_program_topic on curriculum_lessons (program_topic_id) where program_topic_id is not null;
comment on column curriculum_lessons.program_topic_id is 'Chủ đề của khung chương trình mới (161)';

alter table curriculum_books add column if not exists track_code text references stem_tracks(code);
alter table curriculum_books add column if not exists school_package_id uuid references school_packages(id) on delete set null;
create index if not exists curriculum_books_school_package on curriculum_books (school_package_id) where school_package_id is not null;
comment on column curriculum_books.track_code is 'Loại chương trình (CT1–CT4) của PPCT tạo từ Gói STEM';
comment on column curriculum_books.school_package_id is 'Bản gán gói của trường mà PPCT được tạo từ đó (161)';

-- ===== 1. Chủ đề trường được học theo gói =====
create or replace function public.school_package_topic_list(p_org uuid, p_year text)
returns table (school_package_id uuid, package_code text, track_code text, grade int, slot int, module_id uuid, module_name text,
               topic_id uuid, topic_seq int, topic_title text, periods int)
language sql stable security definer set search_path = public as $$
  with sp as (
    select s.* from school_packages s
     where s.org_id = p_org and s.school_year = p_year and s.ends_on is null
       and (public.is_platform_admin() or (public.is_staff() and s.org_id in (select public.my_org_tree())))
  ), it as (
    -- vị trí thứ k của cùng học phần trong một khối (đếm trước khi bỏ học phần trường không áp dụng)
    select sp.id spid, sp.full_package, i.package_id, i.track_code, i.grade, i.slot, i.module_id,
           row_number() over (partition by sp.id, i.track_code, i.grade, i.module_id order by i.slot) k
      from sp join program_package_items i on i.package_id = sp.package_id and i.grade = any(sp.grades)
  ), live as (
    select it.* from it
     where it.full_package or not exists (select 1 from school_package_skips x where x.school_package_id = it.spid
                                            and x.track_code = it.track_code and x.grade = it.grade and x.slot = it.slot)
  )
  select l.spid, p.code, l.track_code, l.grade, l.slot, l.module_id, m.name, t.id, t.seq, t.title, t.periods
    from live l
    join program_packages p on p.id = l.package_id
    join program_modules m on m.id = l.module_id
    join program_topics t on t.module_id = l.module_id and t.grade = l.grade and t.active
   where (t.part is null or t.part = l.k
          or not exists (select 1 from program_topics t2 where t2.module_id = l.module_id and t2.grade = l.grade and t2.active and t2.part is not null))
     and (l.full_package or not exists (select 1 from school_package_skips x where x.school_package_id = l.spid and x.topic_id = t.id))
   order by l.track_code, l.grade, l.slot, t.seq
$$;
revoke all on function public.school_package_topic_list(uuid, text) from public, anon;
grant execute on function public.school_package_topic_list(uuid, text) to authenticated;

-- ===== 2. Tạo PPCT nháp từ gói =====
create or replace function public.ppct_from_package(p_org uuid, p_year text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_year text; g record; v_book uuid; v_ppw numeric; nb int := 0; ns int := 0; nl int := 0; n int;
begin
  if not (public.is_platform_admin() or public.curriculum_can_write(p_org, 'edit')) then
    raise exception 'Bạn không tạo được PPCT cho trường này' using errcode = '42501';
  end if;
  if not exists (select 1 from organizations o where o.id = p_org and o.type = 'school') then
    raise exception 'Chỉ tạo PPCT từ gói cho trường' using errcode = '22023';
  end if;
  v_year := coalesce(nullif(btrim(p_year), ''), (select a.name from academic_years a where a.org_id = p_org and a.is_current limit 1));
  if v_year is null then raise exception 'Trường chưa có năm học hiện tại' using errcode = '22023'; end if;

  for g in select x.school_package_id spid, x.package_code, x.track_code, x.grade, sum(x.periods)::int total,
                  coalesce(nullif(tr.label, ''), tr.code) tlabel, tr.name tname
             from public.school_package_topic_list(p_org, v_year) x join stem_tracks tr on tr.code = x.track_code
            where x.periods > 0
            group by x.school_package_id, x.package_code, x.track_code, x.grade, tr.label, tr.code, tr.name, tr.sort
            order by x.grade, tr.sort loop
    if exists (select 1 from curriculum_books b where b.org_id = p_org and b.year_name = v_year and b.track_code = g.track_code
                 and b.grade = g.grade and b.school_package_id is not null) then
      ns := ns + 1; continue;
    end if;
    if g.total > 400 then raise exception '% Khối % có % tiết, quá 400 tiết của một PPCT', g.tlabel, g.grade, g.total using errcode = '22023'; end if;
    v_ppw := greatest(1, ceil(g.total / 35.0 * 2) / 2);   -- đủ trong 35 tuần, làm tròn lên 0,5 tiết
    insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, track_code, school_package_id, note)
    values (p_org, g.grade, g.tname, left(g.tlabel || ' ' || g.tname || ' — Khối ' || g.grade, 200), v_year, v_ppw, 'draft', 'own',
            g.track_code, g.spid, 'Tạo từ Gói STEM ' || g.package_code)
    returning id into v_book;
    perform set_config('app.ppct_import', 'on', true);
    insert into curriculum_lessons (book_id, seq, week, title, kind, program_topic_id)
    select v_book, rn, least(52, ceil(rn / v_ppw)::int), title, 'stem', topic_id
      from (select row_number() over (order by x.slot, x.topic_seq, k)::int rn, x.topic_id,
                   x.topic_title || case when k > 1 then ' (tiếp)' else '' end title
              from public.school_package_topic_list(p_org, v_year) x cross join lateral generate_series(1, x.periods) k
             where x.track_code = g.track_code and x.grade = g.grade and x.school_package_id = g.spid) r;
    get diagnostics n = row_count;
    perform set_config('app.ppct_import', 'off', true);
    nb := nb + 1; nl := nl + n;
  end loop;
  return jsonb_build_object('books', nb, 'lessons', nl, 'skipped', ns, 'year', v_year);
end $$;
revoke all on function public.ppct_from_package(uuid, text) from public, anon;
grant execute on function public.ppct_from_package(uuid, text) to authenticated;

notify pgrst, 'reload schema';
