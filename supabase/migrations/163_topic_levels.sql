-- 163: Chủ đề theo mức tiết/tuần.
-- Cùng một học phần × khối, mỗi mức tiết/tuần (1 tiết/tuần, 2 tiết/tuần…) có danh sách chủ đề riêng: chủ đề nào có,
-- thứ tự, số tiết. VD Sáng chế K1, mức 1: Chong chóng giấy 1 tiết, Mắt kính 2 tiết, Tai động vật 1 tiết;
-- mức 2: Chong chóng giấy 2 tiết, Mắt kính 2 tiết, Tai động vật 2 tiết. Một chủ đề (tên, mục tiêu, sản phẩm…) dùng chung;
-- nội dung theo mức (giáo án, bài giảng, vật tư…) sẽ gắn vào (chủ đề, mức) ở bước sau.
-- • program_topic_levels: chủ đề × mức → thứ tự, số tiết. Mọi chủ đề hiện có thành bản mức 1 (giữ thứ tự, số tiết).
--   program_topics.seq / periods giữ làm bản mức 1 (đồng bộ hai chiều) để các màn cũ vẫn đúng.
-- • program_package_levels: gói × loại chương trình → các mức gói có (mặc định {1}).
-- • school_package_levels: trường chọn một mức trong các mức của gói, cho mỗi loại chương trình (mặc định mức nhỏ nhất).
--   KDI chọn khi gán gói; trường đổi được khi tạo PPCT (school_package_set_level), chỉ trong các mức của gói.
-- • package_topic_list / school_package_topic_list / PPCT chuẩn (ppct_std*) / ppct_from_package thêm mức.
-- Cần chạy sau 162.

-- ===== 1. Chủ đề theo mức =====
create table if not exists program_topic_levels (
  topic_id uuid not null references program_topics(id) on delete cascade,
  level smallint not null check (level between 1 and 9),
  seq int not null default 1 check (seq between 1 and 999),
  periods int not null default 1 check (periods between 0 and 200),
  primary key (topic_id, level)
);
comment on table program_topic_levels is 'Chủ đề có ở mức tiết/tuần nào, thứ tự và số tiết ở mức đó (163)';
insert into program_topic_levels (topic_id, level, seq, periods)
select id, 1, seq, periods from program_topics on conflict do nothing;

-- Đồng bộ mức 1 ↔ program_topics.seq / periods
create or replace function public.program_topic_levels_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_table_name = 'program_topics' then
    if tg_op = 'INSERT' then
      insert into program_topic_levels (topic_id, level, seq, periods) values (new.id, 1, new.seq, new.periods) on conflict do nothing;
    elsif (new.seq, new.periods) is distinct from (old.seq, old.periods) then
      update program_topic_levels set seq = new.seq, periods = new.periods where topic_id = new.id and level = 1;
    end if;
  elsif tg_op <> 'DELETE' and new.level = 1 then
    update program_topics set seq = new.seq, periods = new.periods where id = new.topic_id and (seq, periods) is distinct from (new.seq, new.periods);
  end if;
  return null;
end $$;
drop trigger if exists program_topics_levels_sync on program_topics;
create trigger program_topics_levels_sync after insert or update of seq, periods on program_topics for each row execute function public.program_topic_levels_sync();
drop trigger if exists program_topic_levels_sync on program_topic_levels;
create trigger program_topic_levels_sync after insert or update on program_topic_levels for each row execute function public.program_topic_levels_sync();

alter table program_topic_levels enable row level security;
drop policy if exists program_topic_levels_read on program_topic_levels;
create policy program_topic_levels_read on program_topic_levels for select to authenticated using (true);
drop policy if exists program_topic_levels_write on program_topic_levels;
create policy program_topic_levels_write on program_topic_levels for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on program_topic_levels to authenticated;

-- ===== 2. Mức của gói, mức trường chọn =====
create table if not exists program_package_levels (
  package_id uuid not null references program_packages(id) on delete cascade,
  track_code text not null references stem_tracks(code),
  levels smallint[] not null default '{1}' check (cardinality(levels) between 1 and 9 and levels <@ array[1,2,3,4,5,6,7,8,9]::smallint[]),
  primary key (package_id, track_code)
);
comment on table program_package_levels is 'Các mức tiết/tuần của gói cho một loại chương trình; không có dòng = chỉ mức 1 (163)';

create table if not exists school_package_levels (
  school_package_id uuid not null references school_packages(id) on delete cascade,
  track_code text not null references stem_tracks(code),
  level smallint not null check (level between 1 and 9),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (school_package_id, track_code)
);
comment on table school_package_levels is 'Mức tiết/tuần trường chọn trong các mức của gói; không có dòng = mức nhỏ nhất của gói (163)';

-- Mức của gói cho một loại chương trình
create or replace function public.package_levels(p_package uuid, p_track text) returns smallint[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array(select distinct x from unnest(l.levels) x order by x) from program_package_levels l
                    where l.package_id = p_package and l.track_code = p_track), '{1}'::smallint[])
$$;
revoke all on function public.package_levels(uuid, text) from public, anon;
grant execute on function public.package_levels(uuid, text) to authenticated;

create or replace function public.package_levels_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'program_package_levels' then
    new.levels := array(select distinct x from unnest(new.levels) x order by x);
  else
    if new.level <> all(public.package_levels((select package_id from school_packages where id = new.school_package_id), new.track_code)) then
      raise exception 'Mức % tiết/tuần không có trong gói', new.level using errcode = '23514';
    end if;
    new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;
drop trigger if exists program_package_levels_touch on program_package_levels;
create trigger program_package_levels_touch before insert or update on program_package_levels for each row execute function public.package_levels_touch();
drop trigger if exists school_package_levels_touch on school_package_levels;
create trigger school_package_levels_touch before insert or update on school_package_levels for each row execute function public.package_levels_touch();

alter table program_package_levels enable row level security;
drop policy if exists program_package_levels_read on program_package_levels;
create policy program_package_levels_read on program_package_levels for select to authenticated using (true);
drop policy if exists program_package_levels_write on program_package_levels;
create policy program_package_levels_write on program_package_levels for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on program_package_levels to authenticated;

alter table school_package_levels enable row level security;
drop policy if exists school_package_levels_read on school_package_levels;
create policy school_package_levels_read on school_package_levels for select to authenticated
  using (exists (select 1 from school_packages sp where sp.id = school_package_id));
drop policy if exists school_package_levels_write on school_package_levels;
create policy school_package_levels_write on school_package_levels for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on school_package_levels to authenticated;

-- Trường (người soạn PPCT) hoặc KDI chọn mức cho một loại chương trình của bản gán gói
create or replace function public.school_package_set_level(p_sp uuid, p_track text, p_level int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from school_packages where id = p_sp and ends_on is null;
  if v_org is null then raise exception 'Không tìm thấy gói đang dùng của trường' using errcode = '22023'; end if;
  if not (public.is_platform_admin() or public.curriculum_can_write(v_org, 'edit')) then
    raise exception 'Bạn không đổi được mức tiết/tuần của trường này' using errcode = '42501';
  end if;
  insert into school_package_levels (school_package_id, track_code, level) values (p_sp, p_track, p_level)
  on conflict (school_package_id, track_code) do update set level = excluded.level;
end $$;
revoke all on function public.school_package_set_level(uuid, text, int) from public, anon;
grant execute on function public.school_package_set_level(uuid, text, int) to authenticated;

-- ===== 3. Chủ đề của gói theo mức =====
drop function if exists public.package_topic_list(uuid);
create function public.package_topic_list(p_package uuid)
returns table (track_code text, grade int, level smallint, slot int, module_id uuid, module_name text, topic_id uuid, topic_seq int, topic_title text, periods int)
language sql stable security definer set search_path = public as $$
  with it as (
    select i.track_code, i.grade, i.slot, i.module_id,
           row_number() over (partition by i.track_code, i.grade, i.module_id order by i.slot) k
      from program_package_items i where i.package_id = p_package
  )
  select it.track_code, it.grade, lv.l, it.slot, it.module_id, m.name, t.id, tl.seq, t.title, tl.periods
    from it join program_modules m on m.id = it.module_id
    cross join lateral unnest(public.package_levels(p_package, it.track_code)) lv(l)
    join program_topics t on t.module_id = it.module_id and t.grade = it.grade and t.active
    join program_topic_levels tl on tl.topic_id = t.id and tl.level = lv.l
   where t.part is null or t.part = it.k
      or not exists (select 1 from program_topics t2 where t2.module_id = it.module_id and t2.grade = it.grade and t2.active and t2.part is not null)
   order by it.track_code, it.grade, lv.l, it.slot, tl.seq
$$;
revoke all on function public.package_topic_list(uuid) from public, anon;
grant execute on function public.package_topic_list(uuid) to authenticated;

drop function if exists public.school_package_topic_list(uuid, text);
create function public.school_package_topic_list(p_org uuid, p_year text)
returns table (school_package_id uuid, package_id uuid, package_code text, track_code text, grade int, level smallint, slot int,
               module_id uuid, module_name text, topic_id uuid, topic_seq int, topic_title text, periods int)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.package_id, p.code, x.track_code, x.grade, x.level, x.slot, x.module_id, x.module_name, x.topic_id, x.topic_seq, x.topic_title, x.periods
    from school_packages sp
    join program_packages p on p.id = sp.package_id
    cross join lateral public.package_topic_list(sp.package_id) x
   where sp.org_id = p_org and sp.school_year = p_year and sp.ends_on is null and x.grade = any(sp.grades)
     and x.level = coalesce((select l.level from school_package_levels l where l.school_package_id = sp.id and l.track_code = x.track_code),
                            (public.package_levels(sp.package_id, x.track_code))[1])
     and (public.is_platform_admin() or (public.is_staff() and sp.org_id in (select public.my_org_tree())))
     and (sp.full_package or not exists (select 1 from school_package_skips s where s.school_package_id = sp.id
            and ((s.track_code = x.track_code and s.grade = x.grade and s.slot = x.slot) or s.topic_id = x.topic_id)))
   order by x.track_code, x.grade, x.slot, x.topic_seq
$$;
revoke all on function public.school_package_topic_list(uuid, text) from public, anon;
grant execute on function public.school_package_topic_list(uuid, text) to authenticated;

-- ===== 4. PPCT chuẩn theo mức =====
alter table ppct_std_topics drop constraint if exists ppct_std_topics_package_id_track_code_grade_fkey;
alter table ppct_std add column if not exists level smallint not null default 1 check (level between 1 and 9);
alter table ppct_std drop constraint if exists ppct_std_pkey;
alter table ppct_std add primary key (package_id, track_code, grade, level);
alter table ppct_std_topics add column if not exists level smallint not null default 1;
alter table ppct_std_topics drop constraint if exists ppct_std_topics_pkey;
alter table ppct_std_topics add primary key (package_id, track_code, grade, level, slot, topic_id);
alter table ppct_std_topics add constraint ppct_std_topics_std_fkey foreign key (package_id, track_code, grade, level)
  references ppct_std(package_id, track_code, grade, level) on delete cascade;

create or replace function public.ppct_std_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'ppct_std' then
    new.note := btrim(coalesce(new.note, '')); new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    if new.week_to > (select s.weeks from ppct_std s where s.package_id = new.package_id and s.track_code = new.track_code
                        and s.grade = new.grade and s.level = new.level) then
      raise exception 'Tuần dạy % vượt số tuần dạy của PPCT chuẩn', new.week_to using errcode = '23514';
    end if;
    update ppct_std set updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
     where package_id = new.package_id and track_code = new.track_code and grade = new.grade and level = new.level;
  end if;
  return new;
end $$;

drop function if exists public.ppct_std_fill(uuid, text, int, int);
create function public.ppct_std_fill(p_package uuid, p_track text, p_grade int, p_weeks int default null, p_level int default 1)
returns int
language plpgsql security definer set search_path = public as $$
declare v_weeks int; v_total int; n int;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng KDI soạn PPCT chuẩn' using errcode = '42501'; end if;
  v_weeks := coalesce(p_weeks, (select weeks from ppct_std where package_id = p_package and track_code = p_track and grade = p_grade and level = p_level), 35);
  insert into ppct_std (package_id, track_code, grade, level, weeks) values (p_package, p_track, p_grade, p_level, v_weeks)
  on conflict (package_id, track_code, grade, level) do update set weeks = excluded.weeks;
  delete from ppct_std_topics where package_id = p_package and track_code = p_track and grade = p_grade and level = p_level;
  select coalesce(sum(x.periods), 0) into v_total from public.package_topic_list(p_package) x
   where x.track_code = p_track and x.grade = p_grade and x.level = p_level;
  insert into ppct_std_topics (package_id, track_code, grade, level, slot, topic_id, week_from, week_to)
  select p_package, p_track, p_grade, p_level, slot, topic_id, wf, greatest(wf, least(v_weeks, wt))
    from (select x.slot, x.topic_id,
                 least(v_weeks, floor((c - x.periods) * v_weeks::numeric / greatest(v_total, 1))::int + 1) wf,
                 ceil(c * v_weeks::numeric / greatest(v_total, 1))::int wt
            from (select x.*, sum(x.periods) over (order by x.slot, x.topic_seq rows unbounded preceding) c
                    from public.package_topic_list(p_package) x where x.track_code = p_track and x.grade = p_grade and x.level = p_level) x) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ppct_std_fill(uuid, text, int, int, int) from public, anon;
grant execute on function public.ppct_std_fill(uuid, text, int, int, int) to authenticated;

-- ===== 5. Tạo PPCT trường theo mức trường chọn =====
alter table curriculum_books add column if not exists topic_level smallint check (topic_level between 1 and 9);
comment on column curriculum_books.topic_level is 'Mức tiết/tuần của PPCT tạo từ Gói STEM (163)';

create or replace function public.ppct_from_package(p_org uuid, p_year text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_year text; g record; v_book uuid; v_ppw numeric; v_weeks int; v_std boolean; nb int := 0; ns int := 0; nl int := 0; nstd int := 0; n int;
begin
  if not (public.is_platform_admin() or public.curriculum_can_write(p_org, 'edit')) then
    raise exception 'Bạn không tạo được PPCT cho trường này' using errcode = '42501';
  end if;
  if not exists (select 1 from organizations o where o.id = p_org and o.type = 'school') then
    raise exception 'Chỉ tạo PPCT từ gói cho trường' using errcode = '22023';
  end if;
  v_year := coalesce(nullif(btrim(p_year), ''), (select a.name from academic_years a where a.org_id = p_org and a.is_current limit 1));
  if v_year is null then raise exception 'Trường chưa có năm học hiện tại' using errcode = '22023'; end if;

  for g in select x.school_package_id spid, x.package_id, x.package_code, x.track_code, x.grade, x.level, sum(x.periods)::int total,
                  coalesce(nullif(tr.label, ''), tr.code) tlabel, tr.name tname
             from public.school_package_topic_list(p_org, v_year) x join stem_tracks tr on tr.code = x.track_code
            where x.periods > 0
            group by x.school_package_id, x.package_id, x.package_code, x.track_code, x.grade, x.level, tr.label, tr.code, tr.name, tr.sort
            order by x.grade, tr.sort loop
    if exists (select 1 from curriculum_books b where b.org_id = p_org and b.year_name = v_year and b.track_code = g.track_code
                 and b.grade = g.grade and b.school_package_id is not null) then
      ns := ns + 1; continue;
    end if;
    if g.total > 400 then raise exception '% Khối % có % tiết, quá 400 tiết của một PPCT', g.tlabel, g.grade, g.total using errcode = '22023'; end if;
    select s.weeks into v_weeks from ppct_std s where s.package_id = g.package_id and s.track_code = g.track_code and s.grade = g.grade and s.level = g.level;
    v_std := v_weeks is not null; v_weeks := coalesce(v_weeks, 35);
    v_ppw := greatest(1, ceil(g.total::numeric / v_weeks * 2) / 2);
    insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, track_code, school_package_id, topic_level, note)
    values (p_org, g.grade, g.tname, left(g.tlabel || ' ' || g.tname || ' — Khối ' || g.grade || ' · ' || g.level || ' tiết/tuần', 200), v_year, v_ppw, 'draft', 'own',
            g.track_code, g.spid, g.level,
            'Tạo từ Gói STEM ' || g.package_code || ', mức ' || g.level || ' tiết/tuần' || case when v_std then ', theo PPCT chuẩn ' || v_weeks || ' tuần dạy' else ' (chưa có PPCT chuẩn, tự chia ' || v_weeks || ' tuần)' end)
    returning id into v_book;
    perform set_config('app.ppct_import', 'on', true);
    insert into curriculum_lessons (book_id, seq, week, title, kind, program_topic_id)
    select v_book, rn, least(52, coalesce(wk, floor((rn - 1) * v_weeks::numeric / g.total)::int + 1)), title, 'stem', topic_id
      from (select row_number() over (order by coalesce(st.week_from, 0), x.slot, x.topic_seq, k)::int rn, x.topic_id,
                   x.topic_title || case when k > 1 then ' (tiếp)' else '' end title,
                   st.week_from + floor((k - 1) * (st.week_to - st.week_from + 1)::numeric / x.periods)::int wk
              from public.school_package_topic_list(p_org, v_year) x cross join lateral generate_series(1, x.periods) k
              left join ppct_std_topics st on st.package_id = x.package_id and st.track_code = x.track_code and st.grade = x.grade
                                          and st.level = x.level and st.slot = x.slot and st.topic_id = x.topic_id
             where x.track_code = g.track_code and x.grade = g.grade and x.school_package_id = g.spid) r;
    get diagnostics n = row_count;
    perform set_config('app.ppct_import', 'off', true);
    nb := nb + 1; nl := nl + n; if v_std then nstd := nstd + 1; end if;
  end loop;
  return jsonb_build_object('books', nb, 'lessons', nl, 'skipped', ns, 'standard', nstd, 'year', v_year);
end $$;
revoke all on function public.ppct_from_package(uuid, text) from public, anon;
grant execute on function public.ppct_from_package(uuid, text) to authenticated;

-- Mức trường đang dùng của mỗi loại chương trình (cho màn PPCT của trường chọn / đổi mức)
create or replace function public.school_package_track_levels(p_org uuid, p_year text)
returns table (school_package_id uuid, package_code text, track_code text, grades int[], levels smallint[], level smallint)
language sql stable security definer set search_path = public as $$
  select sp.id, p.code, tr.track_code, sp.grades, public.package_levels(sp.package_id, tr.track_code),
         coalesce((select l.level from school_package_levels l where l.school_package_id = sp.id and l.track_code = tr.track_code),
                  (public.package_levels(sp.package_id, tr.track_code))[1])
    from school_packages sp join program_packages p on p.id = sp.package_id
    cross join lateral (select distinct i.track_code from program_package_items i where i.package_id = sp.package_id and i.grade = any(sp.grades)) tr
   where sp.org_id = p_org and sp.school_year = p_year and sp.ends_on is null
     and (public.is_platform_admin() or (public.is_staff() and sp.org_id in (select public.my_org_tree())))
   order by tr.track_code, p.code
$$;
revoke all on function public.school_package_track_levels(uuid, text) from public, anon;
grant execute on function public.school_package_track_levels(uuid, text) to authenticated;

notify pgrst, 'reload schema';
