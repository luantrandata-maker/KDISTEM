-- 071. Kế hoạch dạy học — đợt 1: Kế hoạch năm + Phân bổ tiết
--  • PPCT của trường luôn thuộc một năm học của trường: để trống thì lấy năm học hiện tại; ghi năm học không có trong
--    danh mục năm học của trường thì báo lỗi. Mẫu của KDI / Sở không cần năm học.
--  • curriculum_term_weeks(): số tuần học kỳ I / II theo ngày bắt đầu – kết thúc trong danh mục năm học (mặc định 18 / 17).
--  • curriculum_books.allocation: bảng phân bổ tiết theo bài trong chương trình [{unit_id, periods, term}].
--  • curriculum_generate(): sinh lại toàn bộ tiết của PPCT từ chương trình + bảng phân bổ: học kỳ I trước, học kỳ II sau,
--    tuần tính theo số tiết / tuần, thêm tiết ôn tập / kiểm tra cuối mỗi học kỳ nếu chọn.
--  • curriculum_from_program(): KDI, Sở cũng tạo được mẫu PPCT từ chương trình (phạm vi "cho đơn vị trực thuộc").
--  • curriculum_term_counts(): số tiết HK I / HK II của từng PPCT (bảng kế hoạch năm).
--  • curriculum_rollover(): chuyển PPCT của một năm học sang năm học mới (bản nháp).
-- Cần chạy sau 070.

-- ===== 1. PPCT của trường thuộc một năm học =====
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
  new.updated_at := now();
  return new;
end $$;

-- PPCT cũ của trường chưa ghi năm học → năm học hiện tại
update curriculum_books b set year_name = a.name
  from organizations o, academic_years a
 where o.id = b.org_id and o.type = 'school' and b.year_name is null and a.org_id = b.org_id and a.is_current;

-- ===== 2. Số tuần mỗi học kỳ =====
create or replace function public.curriculum_term_weeks(p_org uuid, p_year text) returns table (hk1 int, hk2 int)
language sql stable security definer set search_path = public as $$
  with t as (
    select case when a.term ~* '(ii|2)\s*$' then 2 else 1 end as k,
           least(26, ceil((a.ends_on - a.starts_on + 1) / 7.0))::int as weeks
      from academic_years a
     where a.org_id = p_org and a.name = p_year and a.starts_on is not null and a.ends_on > a.starts_on
  )
  select coalesce((select max(weeks) from t where k = 1), 18), coalesce((select max(weeks) from t where k = 2), 17)
$$;
revoke all on function public.curriculum_term_weeks(uuid, text) from public, anon;
grant execute on function public.curriculum_term_weeks(uuid, text) to authenticated;

-- ===== 3. Bảng phân bổ tiết + sinh PPCT =====
alter table curriculum_books add column if not exists allocation jsonb;

-- Sinh lại toàn bộ tiết của PPCT từ chương trình đã gắn. p_alloc: [{unit_id, periods, term}] — bài không có trong
-- bảng lấy số tiết của bài trong chương trình; bài không ghi học kỳ thì xếp nối tiếp: hết sức chứa học kỳ I
-- (số tuần × số tiết / tuần) thì sang học kỳ II; chưa có số tiết / tuần thì chia đôi tổng số tiết.
-- Quyền theo RLS của người gọi (sửa được PPCT mới sinh được).
create or replace function public.curriculum_generate(p_book uuid, p_alloc jsonb default null, p_review boolean default false,
  p_test boolean default false, p_reason text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; p edu_programs; v_alloc jsonb; v_hk1 int; v_cap numeric; n int;
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
  if b.status = 'published' then
    insert into curriculum_changes (org_id, book_id, action, reason, after)
    values (b.org_id, b.id, 'import', coalesce(nullif(btrim(p_reason), ''), 'Phân bổ lại tiết theo chương trình'), jsonb_build_object('count', n));
  end if;
  return n;
end $$;
revoke all on function public.curriculum_generate(uuid, jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.curriculum_generate(uuid, jsonb, boolean, boolean, text) to authenticated;

-- Tạo PPCT (bản nháp) từ chương trình: trường → PPCT của trường; KDI / Sở → mẫu cho đơn vị trực thuộc
create or replace function public.curriculum_from_program(p_program uuid, p_grade int, p_subject text default null,
  p_year text default null, p_ppw numeric default null) returns uuid
language plpgsql set search_path = public as $$
declare p edu_programs; v_book uuid; v_org uuid := public.my_org_id(); v_school boolean;
begin
  select * into p from edu_programs where id = p_program;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  if p_grade < p.grade_from or p_grade > p.grade_to then raise exception 'Khối % không thuộc chương trình', p_grade using errcode = '22023'; end if;
  v_school := exists (select 1 from organizations where id = v_org and type = 'school');
  insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, program_id, note)
  values (v_org, p_grade, coalesce(nullif(btrim(p_subject), ''), p.main_subject),
          p.title || ' — khối ' || p_grade, case when v_school then nullif(btrim(p_year), '') end, p_ppw, 'draft',
          case when v_school then 'own' else 'children' end, p.id,
          'Tạo từ chương trình "' || p.title || '" (phiên bản ' || p.version_no || ')')
  returning id into v_book;
  perform public.curriculum_generate(v_book);
  return v_book;
end $$;
revoke all on function public.curriculum_from_program(uuid, int, text, text, numeric) from public, anon;
grant execute on function public.curriculum_from_program(uuid, int, text, text, numeric) to authenticated;

-- ===== 4. Số tiết HK I / HK II của từng PPCT (quyền đọc theo RLS) =====
create or replace function public.curriculum_term_counts(p_books uuid[]) returns table (book_id uuid, hk1 int, hk2 int, other int)
language sql stable set search_path = public as $$
  select l.book_id, (count(*) filter (where l.term = 1))::int, (count(*) filter (where l.term = 2))::int, (count(*) filter (where l.term is null))::int
    from curriculum_lessons l where l.book_id = any(p_books) group by l.book_id
$$;
revoke all on function public.curriculum_term_counts(uuid[]) from public, anon;
grant execute on function public.curriculum_term_counts(uuid[]) to authenticated;

-- ===== 5. Chuyển PPCT sang năm học mới =====
-- Sao chép mọi PPCT của đơn vị ở năm học p_from sang p_to (bản nháp, giữ bảng phân bổ). Bỏ qua khối + môn đã có ở năm mới.
create or replace function public.curriculum_rollover(p_from text, p_to text) returns int
language plpgsql set search_path = public as $$
declare v_org uuid := public.my_org_id(); b curriculum_books; v_new uuid; n int := 0;
begin
  if nullif(btrim(p_from), '') is null or nullif(btrim(p_to), '') is null or btrim(p_from) = btrim(p_to) then
    raise exception 'Chọn năm học nguồn và năm học mới khác nhau' using errcode = '22023';
  end if;
  if not public.curriculum_can_write(v_org, 'create') then raise exception 'Bạn không có quyền soạn PPCT của đơn vị' using errcode = '42501'; end if;
  for b in select * from curriculum_books where org_id = v_org and year_name = btrim(p_from) order by grade, subject, title loop
    continue when exists (select 1 from curriculum_books x where x.org_id = v_org and x.year_name = btrim(p_to)
                                                         and x.grade = b.grade and lower(x.subject) = lower(b.subject));
    insert into curriculum_books (org_id, grade, subject, title, total_periods, year_name, periods_per_week, status, scope, note, program_id, allocation)
    values (v_org, b.grade, b.subject, b.title, b.total_periods, btrim(p_to), b.periods_per_week, 'draft', b.scope,
            concat_ws(' · ', nullif(b.note, ''), 'Chuyển từ năm học ' || b.year_name), b.program_id, b.allocation)
    returning id into v_new;
    perform set_config('app.ppct_import', 'on', true);
    insert into curriculum_lessons (book_id, seq, week, term, title, kind, package_topic_id, unit_id, note)
    select v_new, l.seq, l.week, l.term, l.title, l.kind, l.package_topic_id, l.unit_id, l.note from curriculum_lessons l where l.book_id = b.id;
    perform set_config('app.ppct_import', 'off', true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.curriculum_rollover(text, text) from public, anon;
grant execute on function public.curriculum_rollover(text, text) to authenticated;
