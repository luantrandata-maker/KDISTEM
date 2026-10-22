-- 072. Kế hoạch dạy học — đợt 2: Lịch dự kiến theo tuần / tháng
--  • curriculum_calendar(): lịch tuần học của một năm học. Tuần 1 là tuần khai giảng (khai giảng thứ Bảy / Chủ nhật thì
--    tính từ thứ Hai kế tiếp). Tuần mà cả 5 ngày thứ Hai – thứ Sáu đều là ngày nghỉ (của trường hoặc cấp trên) không
--    tính số tuần. Học kỳ II bắt đầu từ ngày bắt đầu HK II trong danh mục năm học (không có: sau ngày kết thúc HK I);
--    không có ngày kết thúc HK II thì học kỳ II đủ 17 tuần học.
--  • curriculum_term_weeks() đếm số tuần học thật của từng học kỳ theo lịch trên (không có lịch: 18 / 17).
--  • curriculum_week_of(): tuần học của một ngày → tiến độ "kế hoạch đến tuần này" tính theo tuần học, bỏ tuần nghỉ.
--  • Đổi tuần của tiết mà không ghi học kỳ: học kỳ tính theo số tuần HK I thật của năm học (thay mốc cố định 18).
--  • curriculum_reschedule(): xếp lại tuần cho các tiết chưa dạy theo số tiết / tuần, bắt đầu từ tuần hiện tại;
--    tiết đã dạy giữ nguyên. PPCT đang dùng: ghi một dòng nhật ký "Xếp lại lịch" kèm lý do.
-- Cần chạy sau 071.

-- ===== 1. Lịch tuần học =====
create or replace function public.curriculum_calendar(p_org uuid, p_year text)
returns table (cal int, week int, term int, starts_on date, ends_on date, off_days int, holiday text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_s1 date; v_e1 date; v_s2 date; v_e2 date; v_start date; v_hk2 date; r record; n int := 0; n2 int := 0; v_term int;
begin
  select min(a.starts_on) filter (where a.term !~* '(ii|2)\s*$'), max(a.ends_on) filter (where a.term !~* '(ii|2)\s*$'),
         min(a.starts_on) filter (where a.term ~* '(ii|2)\s*$'), max(a.ends_on) filter (where a.term ~* '(ii|2)\s*$')
    into v_s1, v_e1, v_s2, v_e2
    from academic_years a where a.org_id = p_org and a.name = p_year;
  v_s1 := coalesce(v_s1, v_s2);
  if v_s1 is null then return; end if;
  v_start := case when extract(isodow from v_s1) <= 5 then v_s1 - (extract(isodow from v_s1)::int - 1)
                  else v_s1 + (8 - extract(isodow from v_s1)::int) end;
  v_hk2 := coalesce(v_s2, v_e1 + 1);
  for r in
    with recursive up as (
      select o.id, o.parent_id, 0 as d from organizations o where o.id = p_org
      union all select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
    ), hol as (
      select h.name, h.starts_on as s, h.ends_on as e from school_holidays h join up on up.id = h.org_id
       where h.ends_on >= v_start and h.starts_on <= v_start + 60 * 7
    ), wk as (
      select g::date as d, row_number() over (order by g)::int as c from generate_series(v_start, v_start + 59 * 7, interval '7 day') g
    )
    select wk.c, wk.d,
           (select count(*) from generate_series(wk.d, wk.d + 4, interval '1 day') x
             where exists (select 1 from hol where x::date between hol.s and hol.e))::int as off,
           (select string_agg(distinct hol.name, ', ') from hol where hol.s <= wk.d + 6 and hol.e >= wk.d) as names
      from wk order by wk.c
  loop
    exit when v_e2 is not null and r.d > v_e2;
    exit when v_e2 is null and n2 >= 17;
    exit when v_hk2 is null and n >= 35;
    v_term := case when v_hk2 is not null then (case when r.d + 2 >= v_hk2 then 2 else 1 end)
                   else (case when n >= 18 then 2 else 1 end) end;
    cal := r.c; term := v_term; starts_on := r.d; ends_on := r.d + 6; off_days := r.off; holiday := r.names;
    if r.off >= 5 then
      week := null;
    else
      n := n + 1; week := n;
      if v_term = 2 then n2 := n2 + 1; end if;
    end if;
    return next;
  end loop;
end $$;
revoke all on function public.curriculum_calendar(uuid, text) from public, anon;
grant execute on function public.curriculum_calendar(uuid, text) to authenticated;

-- Số tuần học thật của từng học kỳ
create or replace function public.curriculum_term_weeks(p_org uuid, p_year text) returns table (hk1 int, hk2 int)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.curriculum_calendar(p_org, p_year))
  select coalesce(nullif((select count(week) from c where c.term = 1), 0)::int, 18),
         coalesce(nullif((select count(week) from c where c.term = 2), 0)::int, 17)
$$;

-- Tuần học của một ngày (ngày rơi vào tuần nghỉ → tuần học liền trước; trước khai giảng → 1)
create or replace function public.curriculum_week_of(p_org uuid, p_year text, p_day date) returns int
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.curriculum_calendar(p_org, p_year))
              then greatest(1, coalesce((select max(c.week) from public.curriculum_calendar(p_org, p_year) c where c.starts_on <= p_day), 1)) end
$$;
revoke all on function public.curriculum_week_of(uuid, text, date) from public, anon;
grant execute on function public.curriculum_week_of(uuid, text, date) to authenticated;

-- ===== 2. Học kỳ của tiết tính theo số tuần HK I thật =====
create or replace function public.curriculum_lessons_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_year text; v_hk1 int;
begin
  select org_id, year_name into v_org, v_year from curriculum_books where id = new.book_id;
  if v_org is null then raise exception 'Không tìm thấy môn trong PPCT' using errcode = '22023'; end if;
  new.org_id := v_org;
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'Nhập tên bài / nội dung tiết %', new.seq using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.week is distinct from old.week and new.term is not distinct from old.term then new.term := null; end if;
  if new.term is null and new.week is not null then
    v_hk1 := 18;
    if v_year is not null then select w.hk1 into v_hk1 from public.curriculum_term_weeks(v_org, v_year) w; end if;
    new.term := case when new.week <= v_hk1 then 1 else 2 end;
  end if;
  return new;
end $$;

-- ===== 3. Tuần hiện tại của lớp theo tuần học =====
create or replace function public.curriculum_class_books(p_org uuid default null, p_class uuid default null)
returns table (org_id uuid, school text, area text, class_id uuid, class_name text, grade int, book_id uuid, week int)
language sql stable security definer set search_path = public as $$
  with sch as (
    select o.id, o.name, (select p.name from organizations p where p.id = o.parent_id) as area from organizations o
     where o.type = 'school' and o.id in (select public.my_org_tree()) and public.is_staff()
       and (p_org is null or o.id = p_org)
  ), yr as materialized (
    select a.org_id, a.name, min(a.starts_on) as start,
           least(52, public.curriculum_week_of(a.org_id, a.name, public.vn_today())) as cur_week
      from academic_years a
     where a.org_id in (select id from sch)
       and a.name = (select a2.name from academic_years a2 where a2.org_id = a.org_id and a2.is_current limit 1)
     group by a.org_id, a.name
  ), cls as (
    select c.id, c.org_id, c.name, c.grade from classes c
     where c.org_id in (select id from sch) and (p_class is null or c.id = p_class)
       and (c.year_id is null or c.year_id in (select a.id from academic_years a join yr on yr.org_id = a.org_id and yr.name = a.name))
  ), pick as (
    select distinct on (c.id, lower(btrim(b.subject))) c.id as class_id, b.id as book_id
      from cls c join curriculum_books b on b.org_id = c.org_id and b.grade = c.grade and b.status = 'published'
      left join yr on yr.org_id = c.org_id
     where (b.year_name is null or b.year_name = yr.name)
       and (not exists (select 1 from curriculum_book_classes x where x.book_id = b.id)
            or exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = c.id))
     order by c.id, lower(btrim(b.subject)), exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = c.id) desc,
              b.year_name nulls last, b.updated_at desc
  )
  select c.org_id, s.name, s.area, c.id, c.name, c.grade, p.book_id,
         case when yr.start is null then null else coalesce(yr.cur_week, greatest(1, least(52, (public.vn_today() - yr.start) / 7 + 1))) end
    from pick p join cls c on c.id = p.class_id join sch s on s.id = c.org_id left join yr on yr.org_id = c.org_id
$$;
revoke all on function public.curriculum_class_books(uuid, uuid) from public, anon, authenticated;

-- ===== 4. Xếp lại lịch =====
alter table curriculum_changes drop constraint if exists curriculum_changes_action_check;
alter table curriculum_changes add constraint curriculum_changes_action_check check (action in ('insert', 'update', 'delete', 'import', 'reschedule'));

-- Tiết chưa dạy của mỗi học kỳ xếp lại từ max(tuần đầu học kỳ, tuần hiện tại), mỗi tuần đủ số tiết / tuần.
create or replace function public.curriculum_reschedule(p_book uuid, p_reason text default null) returns int
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
  if b.status = 'published' and n > 0 then
    insert into curriculum_changes (org_id, book_id, action, reason, after)
    values (b.org_id, b.id, 'reschedule', coalesce(nullif(btrim(p_reason), ''), 'Xếp lại lịch'), jsonb_build_object('count', n, 'from_week', v_cur));
  end if;
  return n;
end $$;
revoke all on function public.curriculum_reschedule(uuid, text) from public, anon;
grant execute on function public.curriculum_reschedule(uuid, text) to authenticated;
