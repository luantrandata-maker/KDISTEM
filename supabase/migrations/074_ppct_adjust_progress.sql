-- 074. Kế hoạch dạy học — đợt 4: Điều chỉnh có lý do + Kế hoạch so với thực hiện
--  • Lý do điều chỉnh theo danh mục (reason_code): holiday (nghỉ đột xuất), equipment (thiếu thiết bị / vật tư),
--    reteach (học sinh chưa đạt, dạy lại), directive (theo chỉ đạo cấp trên), other (khác) — kèm ghi chú.
--  • Điều chỉnh hàng loạt: curriculum_shift() dời các tiết từ tiết X lùi / tiến N tuần; curriculum_swap() đổi chỗ hai bài
--    chưa dạy; curriculum_insert_after() chèn tiết dạy bù / bổ sung sau một tiết.
--  • Phiên bản: curriculum_book_versions lưu toàn bộ tiết của PPCT khi công bố và sau mỗi lần điều chỉnh hàng loạt
--    PPCT đang dùng (hoặc khi người soạn bấm "Lưu phiên bản") → so sánh trước / sau.
--  • PPCT đang dùng bị bớt tiết / xoá tiết → báo cho Hiệu trưởng.
--  • curriculum_weekly(): số tiết kế hoạch và số tiết đã dạy theo từng tuần học (lớp / khối / trường / Sở).
--  • Cảnh báo lớp chậm: curriculum_alert_settings (ngưỡng, mặc định 3 tiết); curriculum_lag_scan() chạy hằng đêm
--    (pg_cron) hoặc khi trường bấm "Gửi cảnh báo ngay" → báo giáo viên dạy lớp và Hiệu trưởng (mỗi lớp × môn tối đa
--    một lần / 7 ngày).
-- Cần chạy sau 073.

-- ===== 1. Lý do theo danh mục =====
alter table curriculum_changes add column if not exists reason_code text;
alter table curriculum_changes drop constraint if exists curriculum_changes_reason_code_check;
alter table curriculum_changes add constraint curriculum_changes_reason_code_check
  check (reason_code is null or reason_code in ('holiday', 'equipment', 'reteach', 'directive', 'other'));
alter table curriculum_changes drop constraint if exists curriculum_changes_action_check;
alter table curriculum_changes add constraint curriculum_changes_action_check
  check (action in ('insert', 'update', 'delete', 'import', 'reschedule', 'shift', 'swap', 'makeup', 'version'));
alter table curriculum_lessons add column if not exists change_reason_code text;
alter table curriculum_lessons drop constraint if exists curriculum_lessons_change_reason_code_check;
alter table curriculum_lessons add constraint curriculum_lessons_change_reason_code_check
  check (change_reason_code is null or change_reason_code in ('holiday', 'equipment', 'reteach', 'directive', 'other'));

create or replace function public.curriculum_lessons_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; r curriculum_lessons := coalesce(new, old);
begin
  if coalesce(current_setting('app.ppct_import', true), '') = 'on' then return null; end if;
  select status into v_status from curriculum_books where id = r.book_id;
  if v_status is distinct from 'published' then return null; end if;
  if tg_op = 'UPDATE' and (new.seq, new.week, new.term, new.title, new.kind, new.unit_id, new.package_topic_id)
       is not distinct from (old.seq, old.week, old.term, old.title, old.kind, old.unit_id, old.package_topic_id) then return null; end if;
  insert into curriculum_changes (org_id, book_id, lesson_id, seq, action, reason, reason_code, before, after)
  values (r.org_id, r.book_id, r.id, r.seq, lower(tg_op), nullif(btrim(r.change_reason), ''), r.change_reason_code,
          case when tg_op <> 'INSERT' then jsonb_build_object('seq', old.seq, 'week', old.week, 'term', old.term, 'title', old.title, 'kind', old.kind) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('seq', new.seq, 'week', new.week, 'term', new.term, 'title', new.title, 'kind', new.kind) end);
  if tg_op = 'DELETE' then
    perform public.curriculum_notify_cut(r.book_id, 'Xoá tiết ' || old.seq || ': ' || old.title);
  end if;
  return null;
end $$;

-- ===== 2. Phiên bản PPCT =====
create table if not exists curriculum_book_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  book_id uuid not null references curriculum_books(id) on delete cascade,
  version_no int not null,
  action text not null,
  reason_code text,
  reason text,
  lessons jsonb not null,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (book_id, version_no)
);
alter table curriculum_book_versions enable row level security;
drop policy if exists curriculum_versions_read on curriculum_book_versions;
create policy curriculum_versions_read on curriculum_book_versions for select to authenticated
  using (exists (select 1 from curriculum_books b where b.id = book_id));
grant select on curriculum_book_versions to authenticated;

-- Lưu một phiên bản (dùng nội bộ: không kiểm tra quyền)
create or replace function public.curriculum_snapshot_raw(p_book uuid, p_action text, p_reason_code text default null, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare b curriculum_books; v int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then return null; end if;
  select coalesce(max(version_no), 0) + 1 into v from curriculum_book_versions where book_id = b.id;
  insert into curriculum_book_versions (org_id, book_id, version_no, action, reason_code, reason, lessons)
  values (b.org_id, b.id, v, coalesce(p_action, 'version'),
          case when p_reason_code in ('holiday', 'equipment', 'reteach', 'directive', 'other') then p_reason_code end,
          nullif(btrim(p_reason), ''),
          coalesce((select jsonb_agg(jsonb_build_object('seq', l.seq, 'week', l.week, 'term', l.term, 'title', l.title, 'kind', l.kind) order by l.seq)
                      from curriculum_lessons l where l.book_id = b.id), '[]'::jsonb));
  return v;
end $$;
revoke all on function public.curriculum_snapshot_raw(uuid, text, text, text) from public, anon, authenticated;

-- Người soạn bấm "Lưu phiên bản"
create or replace function public.curriculum_snapshot(p_book uuid, p_reason_code text default null, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare b curriculum_books; v int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null or not public.curriculum_can_write(b.org_id, 'edit') then
    raise exception 'Bạn không có quyền lưu phiên bản PPCT này' using errcode = '42501';
  end if;
  v := public.curriculum_snapshot_raw(b.id, 'version', p_reason_code, p_reason);
  if b.status = 'published' then
    insert into curriculum_changes (org_id, book_id, action, reason, reason_code, after)
    values (b.org_id, b.id, 'version', coalesce(nullif(btrim(p_reason), ''), 'Lưu phiên bản v' || v),
            case when p_reason_code in ('holiday', 'equipment', 'reteach', 'directive', 'other') then p_reason_code end, jsonb_build_object('version', v));
  end if;
  return v;
end $$;
revoke all on function public.curriculum_snapshot(uuid, text, text) from public, anon;
grant execute on function public.curriculum_snapshot(uuid, text, text) to authenticated;

-- Công bố PPCT → phiên bản "Công bố"
create or replace function public.curriculum_books_publish_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.curriculum_snapshot_raw(new.id, 'publish');
  end if;
  return null;
end $$;
drop trigger if exists curriculum_books_publish_version on curriculum_books;
create trigger curriculum_books_publish_version after update of status on curriculum_books
  for each row execute function public.curriculum_books_publish_version();

-- ===== 3. PPCT đang dùng bị bớt tiết → báo Hiệu trưởng =====
create or replace function public.curriculum_notify_cut(p_book uuid, p_what text) returns void
language plpgsql security definer set search_path = public as $$
declare b curriculum_books;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null or b.status <> 'published' then return; end if;
  if exists (select 1 from notifications n where n.ref_id = b.id and n.kind = 'curriculum_cut' and n.created_at > now() - interval '10 minutes') then return; end if;
  insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
  select distinct b.org_id, m.user_id, 'curriculum_cut', left('PPCT đang dùng bị bớt nội dung: ' || b.title, 200),
         left(coalesce(p_what, '') || coalesce(' — người sửa: ' || (select full_name from profiles where id = auth.uid()), ''), 1000),
         'Phân phối chương trình', 'school_admin', b.id
    from memberships m join roles r on r.id = m.role_id
   where m.org_id = b.org_id and r.key = 'principal' and m.user_id is distinct from auth.uid();
end $$;
revoke all on function public.curriculum_notify_cut(uuid, text) from public, anon, authenticated;

-- ===== 4. Các hàm điều chỉnh có lý do =====
-- Bỏ các phiên bản cũ (thêm tham số mã lý do) để PostgREST không nhầm giữa hai hàm cùng tên
drop function if exists public.curriculum_replace_lessons(uuid, jsonb, text);
drop function if exists public.curriculum_generate(uuid, jsonb, boolean, boolean, text);
drop function if exists public.curriculum_reschedule(uuid, text);

create or replace function public.curriculum_change_done(b curriculum_books, p_action text, p_code text, p_reason text, p_after jsonb, p_old_count int default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_now int;
begin
  if b.status <> 'published' then return; end if;
  if not public.curriculum_can_write(b.org_id, 'edit') then raise exception 'Bạn không có quyền sửa PPCT này' using errcode = '42501'; end if;
  insert into curriculum_changes (org_id, book_id, action, reason, reason_code, after)
  values (b.org_id, b.id, p_action, nullif(btrim(p_reason), ''),
          case when p_code in ('holiday', 'equipment', 'reteach', 'directive', 'other') then p_code end, p_after);
  perform public.curriculum_snapshot_raw(b.id, p_action, p_code, p_reason);
  if p_old_count is not null then
    select count(*) into v_now from curriculum_lessons where book_id = b.id;
    if v_now < p_old_count then perform public.curriculum_notify_cut(b.id, 'Còn ' || v_now || ' / ' || p_old_count || ' tiết'); end if;
  end if;
end $$;
revoke all on function public.curriculum_change_done(curriculum_books, text, text, text, jsonb, int) from public, anon;
grant execute on function public.curriculum_change_done(curriculum_books, text, text, text, jsonb, int) to authenticated;

create or replace function public.curriculum_replace_lessons(p_book uuid, p_rows jsonb, p_reason text default null, p_reason_code text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; n int; v_old int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  select count(*) into v_old from curriculum_lessons where book_id = p_book;
  perform set_config('app.ppct_import', 'on', true);
  delete from curriculum_lessons where book_id = p_book;
  insert into curriculum_lessons (book_id, seq, week, term, title, kind, package_topic_id, unit_id, note)
  select p_book, (r->>'seq')::int, nullif(r->>'week', '')::int, nullif(r->>'term', '')::smallint, r->>'title', coalesce(nullif(r->>'kind', ''), 'lesson'),
         nullif(r->>'package_topic_id', '')::uuid, nullif(r->>'unit_id', '')::uuid, nullif(r->>'note', '')
    from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  perform set_config('app.ppct_import', 'off', true);
  perform public.curriculum_change_done(b, 'import', p_reason_code, p_reason, jsonb_build_object('count', n), v_old);
  return n;
end $$;
revoke all on function public.curriculum_replace_lessons(uuid, jsonb, text, text) from public, anon;
grant execute on function public.curriculum_replace_lessons(uuid, jsonb, text, text) to authenticated;

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
           coalesce(c.term, case when v_cap is not null then (case when c.before < v_cap then 1 else 2 end)
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

create or replace function public.curriculum_reschedule(p_book uuid, p_reason text default null, p_reason_code text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; v_hk1 int; v_cur int; n int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  if not public.curriculum_can_write(b.org_id, 'edit') then raise exception 'Bạn không có quyền sửa PPCT này' using errcode = '42501'; end if;
  if coalesce(b.periods_per_week, 0) <= 0 then raise exception 'Nhập số tiết / tuần của PPCT trước khi xếp lịch' using errcode = '22023'; end if;
  select w.hk1 into v_hk1 from public.curriculum_term_weeks(b.org_id, b.year_name) w;
  v_cur := case when b.year_name is not null then public.curriculum_week_of(b.org_id, b.year_name, public.vn_today()) end;
  perform set_config('app.ppct_import', 'on', true);
  with l as (
    select l.id, coalesce(l.term, case when l.week > v_hk1 then 2 else 1 end) as term, l.seq
      from curriculum_lessons l
     where l.book_id = b.id
       and not exists (select 1 from teaching_sessions ts where ts.curriculum_lesson_id = l.id and ts.status = 'taught')
  ), w as (
    select l.id, l.term,
           least(52, greatest(case when l.term = 2 then v_hk1 + 1 else 1 end, coalesce(v_cur, 1))
                     + ceil(row_number() over (partition by l.term order by l.seq) / b.periods_per_week)::int - 1) as week
      from l
  )
  update curriculum_lessons x set week = w.week, term = w.term
    from w where x.id = w.id and (x.week is distinct from w.week or x.term is distinct from w.term);
  get diagnostics n = row_count;
  perform set_config('app.ppct_import', 'off', true);
  if n > 0 then
    perform public.curriculum_change_done(b, 'reschedule', p_reason_code, coalesce(nullif(btrim(p_reason), ''), 'Xếp lại lịch'),
                                          jsonb_build_object('count', n, 'from_week', v_cur));
  end if;
  return n;
end $$;
revoke all on function public.curriculum_reschedule(uuid, text, text) from public, anon;
grant execute on function public.curriculum_reschedule(uuid, text, text) to authenticated;

-- Dời các tiết từ tiết p_from_seq lùi (p_weeks > 0) hoặc tiến (p_weeks < 0) N tuần
create or replace function public.curriculum_shift(p_book uuid, p_from_seq int, p_weeks int, p_reason_code text default null, p_reason text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; n int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  if not public.curriculum_can_write(b.org_id, 'edit') then raise exception 'Bạn không có quyền sửa PPCT này' using errcode = '42501'; end if;
  if coalesce(p_weeks, 0) = 0 or abs(p_weeks) > 20 then raise exception 'Số tuần dời từ 1 đến 20 (lùi) hoặc -1 đến -20 (tiến)' using errcode = '22023'; end if;
  perform set_config('app.ppct_import', 'on', true);
  update curriculum_lessons set week = least(52, greatest(1, week + p_weeks))
   where book_id = b.id and seq >= coalesce(p_from_seq, 1) and week is not null;
  get diagnostics n = row_count;
  perform set_config('app.ppct_import', 'off', true);
  if n > 0 then
    perform public.curriculum_change_done(b, 'shift', p_reason_code,
      coalesce(nullif(btrim(p_reason), ''), case when p_weeks > 0 then 'Lùi ' else 'Tiến ' end || abs(p_weeks) || ' tuần từ tiết ' || coalesce(p_from_seq, 1)),
      jsonb_build_object('from_seq', p_from_seq, 'weeks', p_weeks, 'count', n));
  end if;
  return n;
end $$;
revoke all on function public.curriculum_shift(uuid, int, int, text, text) from public, anon;
grant execute on function public.curriculum_shift(uuid, int, int, text, text) to authenticated;

-- Đổi chỗ nội dung hai tiết (giữ số tiết và tuần); không đổi tiết đã dạy
create or replace function public.curriculum_swap(p_book uuid, p_a int, p_b int, p_reason_code text default null, p_reason text default null) returns void
language plpgsql set search_path = public as $$
declare b curriculum_books; v_a curriculum_lessons; v_b curriculum_lessons;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  if not public.curriculum_can_write(b.org_id, 'edit') then raise exception 'Bạn không có quyền sửa PPCT này' using errcode = '42501'; end if;
  select * into v_a from curriculum_lessons where book_id = b.id and seq = p_a;
  select * into v_b from curriculum_lessons where book_id = b.id and seq = p_b;
  if v_a.id is null or v_b.id is null or p_a = p_b then raise exception 'Chọn hai tiết khác nhau có trong PPCT' using errcode = '22023'; end if;
  if exists (select 1 from teaching_sessions ts where ts.curriculum_lesson_id in (v_a.id, v_b.id) and ts.status = 'taught') then
    raise exception 'Không đổi chỗ được tiết đã dạy' using errcode = '22023';
  end if;
  perform set_config('app.ppct_import', 'on', true);
  update curriculum_lessons set title = v_b.title, kind = v_b.kind, unit_id = v_b.unit_id, package_topic_id = v_b.package_topic_id, note = v_b.note where id = v_a.id;
  update curriculum_lessons set title = v_a.title, kind = v_a.kind, unit_id = v_a.unit_id, package_topic_id = v_a.package_topic_id, note = v_a.note where id = v_b.id;
  perform set_config('app.ppct_import', 'off', true);
  perform public.curriculum_change_done(b, 'swap', p_reason_code,
    coalesce(nullif(btrim(p_reason), ''), 'Đổi chỗ tiết ' || p_a || ' và tiết ' || p_b),
    jsonb_build_object('a', p_a, 'b', p_b, 'a_title', v_a.title, 'b_title', v_b.title));
end $$;
revoke all on function public.curriculum_swap(uuid, int, int, text, text) from public, anon;
grant execute on function public.curriculum_swap(uuid, int, int, text, text) to authenticated;

-- Chèn một tiết (dạy bù / bổ sung) ngay sau tiết p_after_seq; các tiết sau lùi số thứ tự
create or replace function public.curriculum_insert_after(p_book uuid, p_after_seq int, p_title text, p_kind text default 'lesson',
  p_week int default null, p_reason_code text default null, p_reason text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; r record; v_week int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  if not public.curriculum_can_write(b.org_id, 'edit') then raise exception 'Bạn không có quyền sửa PPCT này' using errcode = '42501'; end if;
  if nullif(btrim(p_title), '') is null then raise exception 'Nhập tên tiết' using errcode = '22023'; end if;
  if (select max(seq) from curriculum_lessons where book_id = b.id) >= 400 then raise exception 'PPCT đã đủ 400 tiết' using errcode = '22023'; end if;
  perform set_config('app.ppct_import', 'on', true);
  for r in select id from curriculum_lessons where book_id = b.id and seq > coalesce(p_after_seq, 0) order by seq desc loop
    update curriculum_lessons set seq = seq + 1 where id = r.id;
  end loop;
  v_week := coalesce(p_week, (select week from curriculum_lessons where book_id = b.id and seq = p_after_seq));
  insert into curriculum_lessons (book_id, seq, week, title, kind)
  values (b.id, coalesce(p_after_seq, 0) + 1, v_week, btrim(p_title),
          case when p_kind in ('lesson', 'stem', 'practice', 'review', 'test') then p_kind else 'lesson' end);
  perform set_config('app.ppct_import', 'off', true);
  perform public.curriculum_change_done(b, 'makeup', p_reason_code,
    coalesce(nullif(btrim(p_reason), ''), 'Chèn tiết sau tiết ' || coalesce(p_after_seq, 0) || ': ' || btrim(p_title)),
    jsonb_build_object('after_seq', p_after_seq, 'title', btrim(p_title), 'week', v_week));
  return coalesce(p_after_seq, 0) + 1;
end $$;
revoke all on function public.curriculum_insert_after(uuid, int, text, text, int, text, text) from public, anon;
grant execute on function public.curriculum_insert_after(uuid, int, text, text, int, text, text) to authenticated;

-- ===== 5. Kế hoạch so với thực hiện theo tuần học =====
create or replace function public.curriculum_weekly(p_org uuid default null, p_class uuid default null, p_grade int default null)
returns table (week int, month text, term int, planned int, taught int)
language sql stable security definer set search_path = public as $$
  with r as materialized (
    select x.org_id, x.plan_week, x.taught_on from public.curriculum_lesson_rows(p_org, p_class) x where p_grade is null or x.grade = p_grade
  ), yr as (
    select o.org_id, (select a.name from academic_years a where a.org_id = o.org_id and a.is_current limit 1) as name
      from (select distinct r.org_id from r) o
  ), cal as materialized (
    select yr.org_id, c.week, c.term, c.starts_on from yr cross join lateral public.curriculum_calendar(yr.org_id, yr.name) c where c.week is not null
  ), t as (
    select (select max(c.week) from cal c where c.org_id = r.org_id and c.starts_on <= r.taught_on) as w from r where r.taught_on is not null
  ), wk as (
    select generate_series(1, least(52, greatest(coalesce((select max(plan_week) from r), 0), coalesce((select max(cal.week) from cal), 0)))) as w
  )
  select wk.w,
         (select to_char(min(c.starts_on) + 2, 'YYYY-MM') from cal c where c.week = wk.w),
         (select min(c.term) from cal c where c.week = wk.w),
         (select count(*) from r where r.plan_week = wk.w)::int,
         (select count(*) from t where t.w = wk.w)::int
    from wk order by 1
$$;
revoke all on function public.curriculum_weekly(uuid, uuid, int) from public, anon;
grant execute on function public.curriculum_weekly(uuid, uuid, int) to authenticated;

-- ===== 6. Cảnh báo lớp chậm =====
create table if not exists curriculum_alert_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  lag_threshold int not null default 3 check (lag_threshold between 1 and 50),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table curriculum_alert_settings enable row level security;
drop policy if exists curriculum_alert_read on curriculum_alert_settings;
create policy curriculum_alert_read on curriculum_alert_settings for select to authenticated using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
drop policy if exists curriculum_alert_write on curriculum_alert_settings;
create policy curriculum_alert_write on curriculum_alert_settings for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
grant select, insert, update, delete on curriculum_alert_settings to authenticated;

-- Quét một trường (hoặc mọi trường khi p_school null — chạy hằng đêm): lớp × môn chậm ≥ ngưỡng → báo giáo viên + Hiệu trưởng
create or replace function public.curriculum_lag_scan(p_school uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare s record; c record; v_year text; v_week int; v_thr int; n int := 0;
begin
  for s in select o.id, o.name from organizations o
            where o.type = 'school' and (p_school is null or o.id = p_school)
              and coalesce((select enabled from curriculum_alert_settings x where x.org_id = o.id), true) loop
    select a.name into v_year from academic_years a where a.org_id = s.id and a.is_current limit 1;
    continue when v_year is null;
    v_week := public.curriculum_week_of(s.id, v_year, public.vn_today());
    continue when v_week is null;
    v_thr := coalesce((select lag_threshold from curriculum_alert_settings x where x.org_id = s.id), 3);
    for c in
      with cls as (
        select cl.id, cl.name, cl.grade from classes cl
         where cl.org_id = s.id and (cl.year_id is null or cl.year_id in (select a.id from academic_years a where a.org_id = s.id and a.name = v_year))
      ), pick as (
        select distinct on (cls.id, lower(btrim(b.subject))) cls.id as class_id, cls.name as class_name, b.id as book_id, b.subject, b.title, b.periods_per_week
          from cls join curriculum_books b on b.org_id = s.id and b.grade = cls.grade and b.status = 'published'
         where (b.year_name is null or b.year_name = v_year)
           and (not exists (select 1 from curriculum_book_classes x where x.book_id = b.id)
                or exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = cls.id))
         order by cls.id, lower(btrim(b.subject)), exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = cls.id) desc,
                  b.year_name nulls last, b.updated_at desc
      )
      select p.*,
             (select count(*) from curriculum_lessons l where l.book_id = p.book_id
                and coalesce(l.week, ceil(l.seq / p.periods_per_week)::int) < v_week)::int as planned,
             coalesce((select max(l.seq) from teaching_sessions ts join curriculum_lessons l on l.id = ts.curriculum_lesson_id
                        where ts.class_id = p.class_id and ts.status = 'taught' and l.book_id = p.book_id), 0) as reached
        from pick p
    loop
      continue when c.planned - c.reached < v_thr;
      continue when exists (select 1 from notifications x where x.kind = 'curriculum_lag' and x.ref_id = c.class_id
                              and x.title like '%' || c.subject || '%' and x.created_at > now() - interval '7 days');
      insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
      select distinct on (u.user_id) s.id, u.user_id, 'curriculum_lag',
             left('Lớp ' || c.class_name || ' chậm ' || (c.planned - c.reached) || ' tiết môn ' || c.subject, 200),
             left('Theo PPCT "' || c.title || '", đến hết tuần ' || (v_week - 1) || ' cần dạy xong tiết ' || c.planned || ', lớp mới dạy đến tiết ' || c.reached
                  || '. Xem Lịch dự kiến hoặc dùng "Xếp lại lịch" / "Dời tiết" nếu cần điều chỉnh.', 1000),
             'Phân phối chương trình', u.portal, c.class_id
        from (
          select t.profile_id as user_id, 'teacher' as portal from teaching_assignments ta join teachers t on t.id = ta.teacher_id
           where ta.class_id = c.class_id and lower(btrim(ta.subject)) = lower(btrim(c.subject)) and t.profile_id is not null
          union all
          select m.user_id, 'school_admin' from memberships m join roles r on r.id = m.role_id where m.org_id = s.id and r.key = 'principal'
        ) u;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.curriculum_lag_scan(uuid) from public, anon, authenticated;

-- Trường bấm "Gửi cảnh báo ngay"
create or replace function public.curriculum_lag_alerts() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.curriculum_can_write(public.my_org_id(), 'edit')
     or not exists (select 1 from organizations where id = public.my_org_id() and type = 'school') then
    raise exception 'Chỉ người soạn PPCT của trường gửi được cảnh báo' using errcode = '42501';
  end if;
  return public.curriculum_lag_scan(public.my_org_id());
end $$;
revoke all on function public.curriculum_lag_alerts() from public, anon;
grant execute on function public.curriculum_lag_alerts() to authenticated;

-- Quét hằng đêm 01:30 giờ Việt Nam (18:30 UTC)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('curriculum-lag-scan', '30 18 * * *', 'select public.curriculum_lag_scan()');
    exception when others then
      raise notice 'pg_cron: không đặt được lịch curriculum-lag-scan (%). Gọi curriculum_lag_scan() từ bộ lập lịch khác.', sqlerrm;
    end;
  else
    raise notice 'Không có pg_cron: bỏ qua đặt lịch curriculum-lag-scan';
  end if;
end $$;
