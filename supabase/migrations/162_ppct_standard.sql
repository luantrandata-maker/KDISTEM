-- 162: PPCT chuẩn của KDI theo Gói STEM × loại chương trình × khối.
-- • ppct_std: số tuần dạy của PPCT chuẩn (VD 32 tuần thay vì 35 để ôn thi, nghỉ Tết…).
-- • ppct_std_topics: chủ đề học từ "tuần dạy thứ" mấy đến tuần dạy thứ mấy. Tuần dạy thứ n chưa gắn ngày tháng:
--   khi tạo PPCT cho trường, tuần dạy thứ n là tuần học thứ n trong lịch của trường (curriculum_calendar, 095),
--   tuần nghỉ cả tuần của trường đã bị bỏ qua khi đánh số nên mỗi trường nghỉ / thi khác nhau vẫn dùng chung một PPCT chuẩn.
-- • package_topic_list(gói): chủ đề của gói theo vị trí học phần (quy tắc HP1 / HP2 của 160), dùng chung cho
--   school_package_topic_list (161, viết lại thêm cột package_id) và PPCT chuẩn.
-- • ppct_std_fill(): KDI bấm "Tự chia" — chia các chủ đề theo số tiết, đều trên số tuần dạy, rồi chỉnh tay.
-- • ppct_from_package() (161) lấy tuần theo PPCT chuẩn; khối chưa có PPCT chuẩn thì tự chia đều theo số tuần dạy (mặc định 35).
-- Đọc: mọi người đã đăng nhập. Sửa: quản trị nền tảng KDI. Cần chạy sau 161.

create table if not exists ppct_std (
  package_id uuid not null references program_packages(id) on delete cascade,
  track_code text not null references stem_tracks(code),
  grade int not null check (grade between -4 and 12 and grade <> 0),
  weeks int not null default 35 check (weeks between 1 and 52),
  note text not null default '',
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (package_id, track_code, grade)
);
comment on table ppct_std is 'PPCT chuẩn của KDI: số tuần dạy của một loại chương trình trong một khối của gói (162)';

create table if not exists ppct_std_topics (
  package_id uuid not null,
  track_code text not null,
  grade int not null,
  slot int not null check (slot between 1 and 9),
  topic_id uuid not null references program_topics(id) on delete cascade,
  week_from int not null check (week_from between 1 and 52),
  week_to int not null check (week_to between 1 and 52),
  check (week_to >= week_from),
  primary key (package_id, track_code, grade, slot, topic_id),
  foreign key (package_id, track_code, grade) references ppct_std(package_id, track_code, grade) on delete cascade
);
comment on table ppct_std_topics is 'Chủ đề trong PPCT chuẩn: học từ tuần dạy thứ week_from đến week_to (162)';

create or replace function public.ppct_std_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'ppct_std' then
    new.note := btrim(coalesce(new.note, '')); new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    if new.week_to > (select s.weeks from ppct_std s where s.package_id = new.package_id and s.track_code = new.track_code and s.grade = new.grade) then
      raise exception 'Tuần dạy % vượt số tuần dạy của PPCT chuẩn', new.week_to using errcode = '23514';
    end if;
    update ppct_std set updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
     where package_id = new.package_id and track_code = new.track_code and grade = new.grade;
  end if;
  return new;
end $$;
drop trigger if exists ppct_std_touch on ppct_std;
create trigger ppct_std_touch before insert or update on ppct_std for each row execute function public.ppct_std_touch();
drop trigger if exists ppct_std_topics_touch on ppct_std_topics;
create trigger ppct_std_topics_touch before insert or update on ppct_std_topics for each row execute function public.ppct_std_touch();

alter table ppct_std enable row level security;
alter table ppct_std_topics enable row level security;
drop policy if exists ppct_std_read on ppct_std;
create policy ppct_std_read on ppct_std for select to authenticated using (true);
drop policy if exists ppct_std_write on ppct_std;
create policy ppct_std_write on ppct_std for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists ppct_std_topics_read on ppct_std_topics;
create policy ppct_std_topics_read on ppct_std_topics for select to authenticated using (true);
drop policy if exists ppct_std_topics_write on ppct_std_topics;
create policy ppct_std_topics_write on ppct_std_topics for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on ppct_std, ppct_std_topics to authenticated;

-- ===== 1. Chủ đề của gói theo vị trí học phần =====
create or replace function public.package_topic_list(p_package uuid)
returns table (track_code text, grade int, slot int, module_id uuid, module_name text, topic_id uuid, topic_seq int, topic_title text, periods int)
language sql stable security definer set search_path = public as $$
  with it as (
    select i.track_code, i.grade, i.slot, i.module_id,
           row_number() over (partition by i.track_code, i.grade, i.module_id order by i.slot) k
      from program_package_items i where i.package_id = p_package
  )
  select it.track_code, it.grade, it.slot, it.module_id, m.name, t.id, t.seq, t.title, t.periods
    from it join program_modules m on m.id = it.module_id
    join program_topics t on t.module_id = it.module_id and t.grade = it.grade and t.active
   where t.part is null or t.part = it.k
      or not exists (select 1 from program_topics t2 where t2.module_id = it.module_id and t2.grade = it.grade and t2.active and t2.part is not null)
   order by it.track_code, it.grade, it.slot, t.seq
$$;
revoke all on function public.package_topic_list(uuid) from public, anon;
grant execute on function public.package_topic_list(uuid) to authenticated;

-- Viết lại 161 trên package_topic_list, thêm package_id
drop function if exists public.school_package_topic_list(uuid, text);
create function public.school_package_topic_list(p_org uuid, p_year text)
returns table (school_package_id uuid, package_id uuid, package_code text, track_code text, grade int, slot int, module_id uuid, module_name text,
               topic_id uuid, topic_seq int, topic_title text, periods int)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.package_id, p.code, x.track_code, x.grade, x.slot, x.module_id, x.module_name, x.topic_id, x.topic_seq, x.topic_title, x.periods
    from school_packages sp
    join program_packages p on p.id = sp.package_id
    cross join lateral public.package_topic_list(sp.package_id) x
   where sp.org_id = p_org and sp.school_year = p_year and sp.ends_on is null and x.grade = any(sp.grades)
     and (public.is_platform_admin() or (public.is_staff() and sp.org_id in (select public.my_org_tree())))
     and (sp.full_package or not exists (select 1 from school_package_skips s where s.school_package_id = sp.id
            and ((s.track_code = x.track_code and s.grade = x.grade and s.slot = x.slot) or s.topic_id = x.topic_id)))
   order by x.track_code, x.grade, x.slot, x.topic_seq
$$;
revoke all on function public.school_package_topic_list(uuid, text) from public, anon;
grant execute on function public.school_package_topic_list(uuid, text) to authenticated;

-- ===== 2. KDI tự chia PPCT chuẩn theo số tuần dạy =====
-- Chủ đề nối tiếp nhau theo vị trí học phần rồi thứ tự chủ đề; mỗi chủ đề chiếm số tuần theo tỉ lệ số tiết.
create or replace function public.ppct_std_fill(p_package uuid, p_track text, p_grade int, p_weeks int default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_weeks int; v_total int; n int;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng KDI soạn PPCT chuẩn' using errcode = '42501'; end if;
  v_weeks := coalesce(p_weeks, (select weeks from ppct_std where package_id = p_package and track_code = p_track and grade = p_grade), 35);
  insert into ppct_std (package_id, track_code, grade, weeks) values (p_package, p_track, p_grade, v_weeks)
  on conflict (package_id, track_code, grade) do update set weeks = excluded.weeks;
  delete from ppct_std_topics where package_id = p_package and track_code = p_track and grade = p_grade;
  select coalesce(sum(x.periods), 0) into v_total from public.package_topic_list(p_package) x where x.track_code = p_track and x.grade = p_grade;
  insert into ppct_std_topics (package_id, track_code, grade, slot, topic_id, week_from, week_to)
  select p_package, p_track, p_grade, slot, topic_id, wf, greatest(wf, least(v_weeks, wt))
    from (select x.slot, x.topic_id,
                 least(v_weeks, floor((c - x.periods) * v_weeks::numeric / greatest(v_total, 1))::int + 1) wf,
                 ceil(c * v_weeks::numeric / greatest(v_total, 1))::int wt
            from (select x.*, sum(x.periods) over (order by x.slot, x.topic_seq rows unbounded preceding) c
                    from public.package_topic_list(p_package) x where x.track_code = p_track and x.grade = p_grade) x) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ppct_std_fill(uuid, text, int, int) from public, anon;
grant execute on function public.ppct_std_fill(uuid, text, int, int) to authenticated;

-- ===== 3. Tạo PPCT trường: tuần theo PPCT chuẩn =====
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

  for g in select x.school_package_id spid, x.package_id, x.package_code, x.track_code, x.grade, sum(x.periods)::int total,
                  coalesce(nullif(tr.label, ''), tr.code) tlabel, tr.name tname
             from public.school_package_topic_list(p_org, v_year) x join stem_tracks tr on tr.code = x.track_code
            where x.periods > 0
            group by x.school_package_id, x.package_id, x.package_code, x.track_code, x.grade, tr.label, tr.code, tr.name, tr.sort
            order by x.grade, tr.sort loop
    if exists (select 1 from curriculum_books b where b.org_id = p_org and b.year_name = v_year and b.track_code = g.track_code
                 and b.grade = g.grade and b.school_package_id is not null) then
      ns := ns + 1; continue;
    end if;
    if g.total > 400 then raise exception '% Khối % có % tiết, quá 400 tiết của một PPCT', g.tlabel, g.grade, g.total using errcode = '22023'; end if;
    select s.weeks into v_weeks from ppct_std s where s.package_id = g.package_id and s.track_code = g.track_code and s.grade = g.grade;
    v_std := v_weeks is not null; v_weeks := coalesce(v_weeks, 35);
    v_ppw := greatest(1, ceil(g.total::numeric / v_weeks * 2) / 2);
    insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, track_code, school_package_id, note)
    values (p_org, g.grade, g.tname, left(g.tlabel || ' ' || g.tname || ' — Khối ' || g.grade, 200), v_year, v_ppw, 'draft', 'own',
            g.track_code, g.spid, 'Tạo từ Gói STEM ' || g.package_code || case when v_std then ' theo PPCT chuẩn ' || v_weeks || ' tuần dạy' else ' (chưa có PPCT chuẩn, tự chia ' || v_weeks || ' tuần)' end)
    returning id into v_book;
    perform set_config('app.ppct_import', 'on', true);
    -- Tiết thứ k của chủ đề: trải đều trong khoảng tuần dạy của chủ đề (PPCT chuẩn), không có thì chia đều cả khối
    insert into curriculum_lessons (book_id, seq, week, title, kind, program_topic_id)
    select v_book, rn, least(52, coalesce(wk, floor((rn - 1) * v_weeks::numeric / g.total)::int + 1)), title, 'stem', topic_id
      from (select row_number() over (order by coalesce(st.week_from, 0), x.slot, x.topic_seq, k)::int rn, x.topic_id,
                   x.topic_title || case when k > 1 then ' (tiếp)' else '' end title,
                   st.week_from + floor((k - 1) * (st.week_to - st.week_from + 1)::numeric / x.periods)::int wk
              from public.school_package_topic_list(p_org, v_year) x cross join lateral generate_series(1, x.periods) k
              left join ppct_std_topics st on st.package_id = x.package_id and st.track_code = x.track_code and st.grade = x.grade
                                          and st.slot = x.slot and st.topic_id = x.topic_id
             where x.track_code = g.track_code and x.grade = g.grade and x.school_package_id = g.spid) r;
    get diagnostics n = row_count;
    perform set_config('app.ppct_import', 'off', true);
    nb := nb + 1; nl := nl + n; if v_std then nstd := nstd + 1; end if;
  end loop;
  return jsonb_build_object('books', nb, 'lessons', nl, 'skipped', ns, 'standard', nstd, 'year', v_year);
end $$;
revoke all on function public.ppct_from_package(uuid, text) from public, anon;
grant execute on function public.ppct_from_package(uuid, text) to authenticated;

notify pgrst, 'reload schema';
