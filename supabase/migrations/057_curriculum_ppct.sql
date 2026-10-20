-- 057: Phân phối chương trình (PPCT) theo từng tiết + theo dõi tiến độ dạy.
--  • curriculum_books (từ 006) thêm năm học, số tiết/tuần, trạng thái, phạm vi: KDI / Sở / Phòng ban hành "mẫu" (scope = 'children')
--    cho đơn vị trực thuộc; trường sao chép mẫu về rồi điều chỉnh (curriculum_copy).
--  • curriculum_lessons: từng tiết của PPCT — số tiết, tuần, tên bài, loại tiết, gắn chủ đề STEM của gói (package_topics).
--  • teaching_sessions.curriculum_lesson_id: tiết dạy thực tế ứng với tiết nào trong PPCT. Khi điểm danh mà chưa chọn,
--    hệ thống tự gán tiết kế tiếp (session_auto_lesson); giáo viên đổi được (set_session_lesson).
--  • curriculum_progress(): mỗi lớp × môn — kế hoạch đến tuần hiện tại, đã dạy tới tiết nào, chênh lệch.

-- ===== 1. Sách / môn trong PPCT =====
alter table curriculum_books
  add column if not exists year_name text,
  add column if not exists periods_per_week numeric(4,1),
  add column if not exists status text not null default 'published',
  add column if not exists scope text not null default 'own',
  add column if not exists source_id uuid references curriculum_books(id) on delete set null,
  add column if not exists note text,
  add column if not exists updated_at timestamptz not null default now();
alter table curriculum_books drop constraint if exists curriculum_books_status_check;
alter table curriculum_books add constraint curriculum_books_status_check check (status in ('draft', 'published'));
alter table curriculum_books drop constraint if exists curriculum_books_scope_check;
alter table curriculum_books add constraint curriculum_books_scope_check check (scope in ('own', 'children'));
alter table curriculum_books drop constraint if exists curriculum_books_grade_check;
alter table curriculum_books add constraint curriculum_books_grade_check check (grade between 1 and 12);
alter table curriculum_books drop constraint if exists curriculum_books_ppw_check;
alter table curriculum_books add constraint curriculum_books_ppw_check check (periods_per_week is null or periods_per_week > 0);
create index if not exists curriculum_books_org_grade on curriculum_books (org_id, grade);

create or replace function public.curriculum_books_touch() returns trigger
language plpgsql as $$
begin
  new.title := btrim(new.title); new.subject := btrim(new.subject);
  if new.title = '' or new.subject = '' then raise exception 'Nhập tên và môn học' using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists curriculum_books_touch on curriculum_books;
create trigger curriculum_books_touch before insert or update on curriculum_books for each row execute function public.curriculum_books_touch();

-- Mẫu do KDI (đơn vị nền tảng) hoặc cấp trên ban hành: nhân sự đơn vị trực thuộc xem được khi đã ban hành
drop policy if exists curriculum_books_template_read on curriculum_books;
create policy curriculum_books_template_read on curriculum_books for select to authenticated
  using (scope = 'children' and status = 'published' and (select public.is_staff())
         and (org_id = (select public.platform_org_id()) or org_id in (select public.my_ancestor_orgs())));
-- KDI soạn mẫu của mình; Sở / Phòng / Tỉnh soạn PPCT của chính đơn vị
drop policy if exists curriculum_books_platform on curriculum_books;
create policy curriculum_books_platform on curriculum_books for all to authenticated
  using ((select public.is_platform_admin()) and org_id = (select public.platform_org_id()))
  with check ((select public.is_platform_admin()) and org_id = (select public.platform_org_id()));
drop policy if exists curriculum_books_authority on curriculum_books;
create policy curriculum_books_authority on curriculum_books for all to authenticated
  using (org_id = (select public.my_org_id()) and (select public.is_authority()))
  with check (org_id = (select public.my_org_id()) and (select public.is_authority()));
grant select, insert, update, delete on curriculum_books to authenticated;

-- ===== 2. Từng tiết trong PPCT =====
create table if not exists curriculum_lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  book_id uuid not null references curriculum_books(id) on delete cascade,
  seq int not null check (seq between 1 and 400),
  week int check (week between 1 and 52),
  title text not null,
  kind text not null default 'lesson' check (kind in ('lesson', 'stem', 'practice', 'review', 'test')),
  package_topic_id uuid references package_topics(id) on delete set null,
  note text,
  unique (book_id, seq)
);
create index if not exists curriculum_lessons_topic on curriculum_lessons (package_topic_id) where package_topic_id is not null;

-- Tiết luôn thuộc đơn vị của sách; tổng số tiết của sách = số tiết đã soạn
create or replace function public.curriculum_lessons_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from curriculum_books where id = new.book_id;
  if new.org_id is null then raise exception 'Không tìm thấy môn trong PPCT' using errcode = '22023'; end if;
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'Nhập tên bài / nội dung tiết %', new.seq using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists curriculum_lessons_guard on curriculum_lessons;
create trigger curriculum_lessons_guard before insert or update on curriculum_lessons for each row execute function public.curriculum_lessons_guard();

create or replace function public.curriculum_lessons_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  for b in select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.book_id end, case when tg_op <> 'DELETE' then new.book_id end]) x where x is not null loop
    update curriculum_books set total_periods = (select count(*) from curriculum_lessons where book_id = b)
     where id = b and exists (select 1 from curriculum_lessons where book_id = b);
  end loop;
  return null;
end $$;
drop trigger if exists curriculum_lessons_count on curriculum_lessons;
create trigger curriculum_lessons_count after insert or update of book_id or delete on curriculum_lessons for each row execute function public.curriculum_lessons_count();

alter table curriculum_lessons enable row level security;
-- Đọc được tiết khi đọc được sách (sách của đơn vị trong phạm vi, hoặc mẫu cấp trên / KDI đã ban hành)
drop policy if exists curriculum_lessons_read on curriculum_lessons;
create policy curriculum_lessons_read on curriculum_lessons for select to authenticated
  using (exists (select 1 from curriculum_books b where b.id = book_id));
drop policy if exists curriculum_lessons_insert on curriculum_lessons;
create policy curriculum_lessons_insert on curriculum_lessons for insert to authenticated
  with check (org_id in (select public.my_org_tree()) and (select public.has_perm('curriculum', 'create')));
drop policy if exists curriculum_lessons_update on curriculum_lessons;
create policy curriculum_lessons_update on curriculum_lessons for update to authenticated
  using (org_id in (select public.my_org_tree()) and (select public.has_perm('curriculum', 'edit')))
  with check (org_id in (select public.my_org_tree()) and (select public.has_perm('curriculum', 'edit')));
drop policy if exists curriculum_lessons_delete on curriculum_lessons;
create policy curriculum_lessons_delete on curriculum_lessons for delete to authenticated
  using (org_id in (select public.my_org_tree()) and (select public.has_perm('curriculum', 'delete')));
drop policy if exists curriculum_lessons_platform on curriculum_lessons;
create policy curriculum_lessons_platform on curriculum_lessons for all to authenticated
  using ((select public.is_platform_admin()) and org_id = (select public.platform_org_id()))
  with check ((select public.is_platform_admin()) and org_id = (select public.platform_org_id()));
drop policy if exists curriculum_lessons_authority on curriculum_lessons;
create policy curriculum_lessons_authority on curriculum_lessons for all to authenticated
  using (org_id = (select public.my_org_id()) and (select public.is_authority()))
  with check (org_id = (select public.my_org_id()) and (select public.is_authority()));
grant select, insert, update, delete on curriculum_lessons to authenticated;

-- ===== 3. Sao chép mẫu về đơn vị đang làm việc (quyền theo RLS của người gọi) =====
create or replace function public.curriculum_copy(p_book uuid, p_year text default null) returns uuid
language plpgsql set search_path = public as $$
declare src curriculum_books; v_new uuid;
begin
  select * into src from curriculum_books where id = p_book;
  if not found then raise exception 'Không tìm thấy PPCT mẫu' using errcode = '42501'; end if;
  insert into curriculum_books (org_id, grade, subject, title, total_periods, year_name, periods_per_week, status, scope, source_id, note)
  values (public.my_org_id(), src.grade, src.subject, src.title, src.total_periods, coalesce(nullif(btrim(p_year), ''), src.year_name),
          src.periods_per_week, 'published', 'own', src.id, src.note)
  returning id into v_new;
  insert into curriculum_lessons (org_id, book_id, seq, week, title, kind, note)
  select public.my_org_id(), v_new, l.seq, l.week, l.title, l.kind, l.note from curriculum_lessons l where l.book_id = src.id;
  return v_new;
end $$;
revoke all on function public.curriculum_copy(uuid, text) from public;
grant execute on function public.curriculum_copy(uuid, text) to authenticated;

-- ===== 4. Tiết dạy thực tế ↔ tiết PPCT =====
alter table teaching_sessions add column if not exists curriculum_lesson_id uuid references curriculum_lessons(id) on delete set null;
create index if not exists teaching_sessions_lesson on teaching_sessions (curriculum_lesson_id) where curriculum_lesson_id is not null;

-- PPCT đang dùng cho lớp × môn: sách đã ban hành của trường, cùng khối, cùng môn, năm học hiện tại (hoặc không ghi năm)
create or replace function public.session_book(p_org uuid, p_class uuid, p_subject text) returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from curriculum_books b join classes c on c.id = p_class
   where b.org_id = p_org and b.grade = c.grade and b.status = 'published'
     and lower(btrim(b.subject)) = lower(btrim(p_subject))
     and (b.year_name is null or b.year_name = (select a.name from academic_years a where a.org_id = p_org and a.is_current limit 1))
     and exists (select 1 from curriculum_lessons l where l.book_id = b.id)
   order by b.year_name nulls last, b.updated_at desc
   limit 1
$$;
revoke all on function public.session_book(uuid, uuid, text) from public;

-- Điểm danh xong mà chưa chọn tiết PPCT → gán tiết kế tiếp sau tiết xa nhất lớp đã dạy
create or replace function public.session_auto_lesson() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_book uuid; v_max int;
begin
  if new.status <> 'taught' or new.curriculum_lesson_id is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'taught' then return new; end if;
  v_book := public.session_book(new.org_id, new.class_id, new.subject);
  if v_book is null then return new; end if;
  select max(l.seq) into v_max from teaching_sessions s join curriculum_lessons l on l.id = s.curriculum_lesson_id
   where s.class_id = new.class_id and l.book_id = v_book and s.status = 'taught' and s.id <> new.id;
  select id into new.curriculum_lesson_id from curriculum_lessons
   where book_id = v_book and seq > coalesce(v_max, 0) order by seq limit 1;
  return new;
end $$;
drop trigger if exists teaching_sessions_auto_lesson on teaching_sessions;
create trigger teaching_sessions_auto_lesson before insert or update of status on teaching_sessions
  for each row execute function public.session_auto_lesson();

-- Giáo viên dạy tiết (trong 30 ngày) hoặc quản trị trường chọn / đổi tiết PPCT của một tiết dạy
create or replace function public.set_session_lesson(p_session uuid, p_lesson uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v teaching_sessions; v_admin boolean; v_ok boolean;
begin
  select * into v from teaching_sessions where id = p_session;
  if not found or not public.can_access_org(v.org_id) then raise exception 'Không tìm thấy tiết dạy' using errcode = '42501'; end if;
  v_admin := v.org_id = public.my_org_id() and public.has_perm('timetable', 'edit');
  if not v_admin and (v.teacher_id is null or v.teacher_id is distinct from public.my_teacher_id()) then
    raise exception 'Chỉ giáo viên dạy tiết này hoặc quản trị trường được chọn tiết PPCT' using errcode = '42501';
  end if;
  if not v_admin and v.session_date < public.vn_today() - 30 then
    raise exception 'Quá 30 ngày, nhờ quản trị trường sửa' using errcode = '22023';
  end if;
  if p_lesson is not null then
    select exists (select 1 from curriculum_lessons l join curriculum_books b on b.id = l.book_id join classes c on c.id = v.class_id
                    where l.id = p_lesson and b.org_id = v.org_id and b.grade = c.grade) into v_ok;
    if not v_ok then raise exception 'Tiết PPCT không thuộc khối của lớp này' using errcode = '22023'; end if;
  end if;
  update teaching_sessions set curriculum_lesson_id = p_lesson where id = p_session;
end $$;
revoke all on function public.set_session_lesson(uuid, uuid) from public;
grant execute on function public.set_session_lesson(uuid, uuid) to authenticated;

-- ===== 5. Tiến độ dạy theo PPCT =====
-- Mỗi lớp × môn có PPCT: tuần hiện tại (tính từ ngày bắt đầu năm học), số tiết kế hoạch đến hết tuần này,
-- tiết xa nhất đã dạy, số tiết đã dạy, chênh lệch (dương = chậm). Tuần của tiết = cột week, hoặc tính từ số tiết/tuần.
create or replace function public.curriculum_progress(p_org uuid default null)
returns table (org_id uuid, school text, class_id uuid, class_name text, grade int, subject text, book_id uuid, book_title text,
               total int, week int, planned int, reached int, taught int, last_title text, last_date date, gap int)
language sql stable security definer set search_path = public as $$
  with sch as (
    select o.id, o.name from organizations o
     where o.type = 'school' and o.id in (select public.my_org_tree()) and public.is_staff()
       and (p_org is null or o.id = p_org)
  ), yr as (
    select a.org_id, a.name, min(a.starts_on) as start from academic_years a
     where a.org_id in (select id from sch)
       and a.name = (select a2.name from academic_years a2 where a2.org_id = a.org_id and a2.is_current limit 1)
     group by a.org_id, a.name
  ), cls as (
    select c.id, c.org_id, c.name, c.grade from classes c
     where c.org_id in (select id from sch)
       and (c.year_id is null or c.year_id in (select a.id from academic_years a join yr on yr.org_id = a.org_id and yr.name = a.name))
  ), pick as (
    select distinct on (c.id, lower(btrim(b.subject))) c.id as class_id, b.*
      from cls c join curriculum_books b on b.org_id = c.org_id and b.grade = c.grade and b.status = 'published'
      left join yr on yr.org_id = c.org_id
     where b.year_name is null or b.year_name = yr.name
     order by c.id, lower(btrim(b.subject)), b.year_name nulls last, b.updated_at desc
  )
  select c.org_id, s.name, c.id, c.name, c.grade, p.subject, p.id, p.title,
    t.total::int, w.week, coalesce(t.planned, 0)::int, coalesce(r.reached, 0)::int, coalesce(r.taught, 0)::int,
    r.last_title, r.last_date, (coalesce(t.planned, 0) - coalesce(r.reached, 0))::int
  from pick p
  join cls c on c.id = p.class_id
  join sch s on s.id = c.org_id
  left join yr on yr.org_id = c.org_id
  cross join lateral (select case when yr.start is null then null
                                  else greatest(1, least(52, (public.vn_today() - yr.start) / 7 + 1)) end as week) w
  cross join lateral (
    select count(*) as total,
           count(*) filter (where coalesce(l.week, ceil(l.seq / p.periods_per_week)::int) <= w.week) as planned
      from curriculum_lessons l where l.book_id = p.id
  ) t
  cross join lateral (
    select max(l.seq) as reached, count(ts.id) as taught,
           (array_agg(l.title order by ts.session_date desc, l.seq desc) filter (where l.id is not null))[1] as last_title,
           max(ts.session_date) filter (where l.id is not null) as last_date
      from teaching_sessions ts left join curriculum_lessons l on l.id = ts.curriculum_lesson_id and l.book_id = p.id
     where ts.class_id = c.id and ts.status = 'taught' and lower(btrim(ts.subject)) = lower(btrim(p.subject))
  ) r
  order by s.name, c.grade, c.name, p.subject
$$;
revoke all on function public.curriculum_progress(uuid) from public;
grant execute on function public.curriculum_progress(uuid) to authenticated;

-- ===== 6. Dữ liệu mẫu =====
do $$
declare
  kdi uuid; sch uuid; v_book uuid; b record; c record; s record; i int; n int; v_start date; v_off int; v_topics uuid[];
  tin6 text[] := array[
    'Bài 1. Thông tin và dữ liệu', 'Bài 1. Thông tin và dữ liệu (tiếp)', 'Bài 2. Xử lí thông tin', 'Bài 2. Xử lí thông tin (tiếp)',
    'Bài 3. Thông tin trong máy tính', 'Bài 3. Thông tin trong máy tính (tiếp)', 'Bài 4. Mạng máy tính', 'Bài 4. Mạng máy tính (tiếp)',
    'Bài 5. Internet', 'Ôn tập giữa học kì I', 'Kiểm tra giữa học kì I', 'Bài 6. Mạng thông tin toàn cầu',
    'Bài 6. Mạng thông tin toàn cầu (tiếp)', 'Bài 7. Tìm kiếm thông tin trên Internet', 'Bài 7. Tìm kiếm thông tin trên Internet (tiếp)',
    'Bài 8. Thư điện tử', 'Ôn tập học kì I', 'Kiểm tra cuối học kì I', 'Bài 9. An toàn thông tin trên Internet',
    'Bài 9. An toàn thông tin trên Internet (tiếp)', 'Bài 10. Sơ đồ tư duy', 'Bài 11. Định dạng văn bản', 'Bài 11. Định dạng văn bản (tiếp)',
    'Bài 12. Trình bày thông tin ở dạng bảng', 'Ôn tập giữa học kì II', 'Kiểm tra giữa học kì II', 'Bài 13. Thực hành: Tìm kiếm và thay thế',
    'Bài 14. Thực hành tổng hợp: Hoàn thiện sổ lưu niệm', 'Bài 15. Thuật toán', 'Bài 15. Thuật toán (tiếp)', 'Bài 16. Các cấu trúc điều khiển',
    'Bài 17. Chương trình máy tính', 'Dự án STEM: Trò chơi tương tác với Scratch', 'Ôn tập học kì II', 'Kiểm tra cuối học kì II'];
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  select id into kdi from organizations where is_platform limit 1;
  select id into sch from organizations where code = 'THCS-PH';

  -- Mẫu PPCT của KDI cho Tin học 6 (tham khảo, trường chỉnh theo kế hoạch của tổ chuyên môn)
  if kdi is not null and not exists (select 1 from curriculum_books where org_id = kdi) then
    insert into curriculum_books (org_id, grade, subject, title, total_periods, year_name, periods_per_week, status, scope, note)
    values (kdi, 6, 'Tin học', 'Tin học 6 — mẫu KDI (Kết nối tri thức)', 35, null, 1, 'published', 'children',
            'PPCT tham khảo 35 tiết, 1 tiết/tuần. Trường sao chép rồi điều chỉnh theo kế hoạch giáo dục của tổ chuyên môn.')
    returning id into v_book;
    insert into curriculum_lessons (org_id, book_id, seq, week, title, kind)
    select kdi, v_book, k, k, t,
           case when t like 'Kiểm tra%' then 'test' when t like 'Ôn tập%' then 'review' when t like 'Dự án STEM%' then 'stem'
                when t like '%Thực hành%' then 'practice' else 'lesson' end
      from unnest(tin6) with ordinality as x(t, k);
  end if;

  if sch is null or exists (select 1 from curriculum_lessons where org_id = sch) then return; end if;
  select array_agg(id order by seq) into v_topics from package_topics where org_id = sch;
  update curriculum_books set year_name = (select name from academic_years where org_id = sch and is_current limit 1),
         periods_per_week = round(coalesce(total_periods, 35) / 35.0, 1)
   where org_id = sch;
  for b in select * from curriculum_books where org_id = sch loop
    n := coalesce(b.total_periods, 35);
    insert into curriculum_lessons (org_id, book_id, seq, week, title, kind, package_topic_id)
    select sch, b.id, k, ceil(k / b.periods_per_week)::int,
      case
        when k = (n * 9 / 35) then 'Kiểm tra giữa học kì I'
        when k = (n * 9 / 35) - 1 then 'Ôn tập giữa học kì I'
        when k = (n * 18 / 35) then 'Kiểm tra cuối học kì I'
        when k = (n * 18 / 35) - 1 then 'Ôn tập học kì I'
        when k = (n * 27 / 35) then 'Kiểm tra giữa học kì II'
        when k = n then 'Kiểm tra cuối học kì II'
        when k = n - 1 then 'Ôn tập học kì II'
        when b.subject in ('Công nghệ', 'Khoa học tự nhiên') and k % 12 = 6 then 'Chủ đề STEM: dự án thực hành'
        else b.subject || ' ' || b.grade || ' — Bài ' || ((k + 1) / 2) || (case when k % 2 = 0 then ' (tiếp)' else '' end)
      end,
      case
        when k in (n * 9 / 35, n * 18 / 35, n * 27 / 35, n) then 'test'
        when k in (n * 9 / 35 - 1, n * 18 / 35 - 1, n - 1) then 'review'
        when b.subject in ('Công nghệ', 'Khoa học tự nhiên') and k % 12 = 6 then 'stem'
        else 'lesson'
      end,
      case when b.subject in ('Công nghệ', 'Khoa học tự nhiên') and k % 12 = 6 and v_topics is not null
           then v_topics[1 + (k / 12 + b.grade) % array_length(v_topics, 1)] end
    from generate_series(1, n) k;
    -- Tin học 6: dùng nội dung theo mẫu KDI
    if b.grade = 6 and b.subject = 'Tin học' then
      update curriculum_lessons l set title = x.t,
             kind = case when x.t like 'Kiểm tra%' then 'test' when x.t like 'Ôn tập%' then 'review' when x.t like 'Dự án STEM%' then 'stem'
                         when x.t like '%Thực hành%' then 'practice' else 'lesson' end
        from unnest(tin6) with ordinality as x(t, k) where l.book_id = b.id and l.seq = x.k;
      update curriculum_books set source_id = v_book where id = b.id and v_book is not null;
    end if;
  end loop;

  -- Gắn tiết PPCT cho các tiết đã dạy trong dữ liệu mẫu: bắt đầu từ đúng tiến độ, một vài lớp chậm 2–4 tiết
  select min(starts_on) into v_start from academic_years where org_id = sch
    and name = (select name from academic_years where org_id = sch and is_current limit 1);
  for c in select distinct ts.class_id, ts.subject, public.session_book(sch, ts.class_id, ts.subject) as book, cl.name, bk.periods_per_week
             from teaching_sessions ts join classes cl on cl.id = ts.class_id
             left join curriculum_books bk on bk.id = public.session_book(sch, ts.class_id, ts.subject)
            where ts.org_id = sch and ts.status = 'taught' loop
    continue when c.book is null;
    -- Tiết cuối đã dạy ≈ kế hoạch đến tuần này: bắt đầu từ (kế hoạch − số tiết đã dạy)
    select floor(greatest(1, least(52, (public.vn_today() - coalesce(v_start, public.vn_today())) / 7 + 1)) * c.periods_per_week)::int - count(*)
      into v_off from teaching_sessions where class_id = c.class_id and subject = c.subject and status = 'taught';
    v_off := greatest(0, v_off - (abs(hashtext(c.name || c.subject)) % 5));
    i := 0;
    for s in select id from teaching_sessions where class_id = c.class_id and subject = c.subject and status = 'taught'
              order by session_date, (select p.starts_at from period_configs p where p.id = period_id) loop
      i := i + 1;
      update teaching_sessions set curriculum_lesson_id = (select id from curriculum_lessons where book_id = c.book and seq = v_off + i)
       where id = s.id;
    end loop;
  end loop;
end $$;
