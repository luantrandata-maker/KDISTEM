-- 061. E-learning & luyện thi — đợt 4 (Phân hệ 2)
--  • Giao đề luyện / khoá học theo lớp, NHÓM học sinh (student_groups, 013) hoặc TỪNG HỌC SINH; khoá học có hạn hoàn thành.
--  • Bài học tự học thêm loại: tệp trong kho 'learning-files' và học liệu từ Kho học liệu (059).
--  • Phân tích: câu hỏi khó (tỉ lệ đúng thấp), nội dung cần ôn tập theo chủ đề / mức độ, chủ đề em cần ôn (học sinh),
--    tiến độ khoá học từng học sinh, lịch sử làm bài.
-- Cần chạy sau 060.

-- ===== 1. Đối tượng giao: lớp / nhóm / học sinh =====
alter table practice_exams add column if not exists group_ids uuid[], add column if not exists student_ids uuid[];
alter table courses add column if not exists group_ids uuid[], add column if not exists student_ids uuid[],
  add column if not exists due_at timestamptz;

-- Nội dung dành cho học sinh hiện tại: không chọn lớp / nhóm / học sinh = cả trường; có chọn thì học sinh thuộc một trong số đó
create or replace function public.content_for_me(p_org uuid, p_shared boolean, p_class_ids uuid[], p_group_ids uuid[], p_student_ids uuid[])
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_student() and public.my_student_id() is not null and (
    (p_org = public.my_org_id() and (
        (coalesce(cardinality(p_class_ids), 0) + coalesce(cardinality(p_group_ids), 0) + coalesce(cardinality(p_student_ids), 0)) = 0
        or public.my_class_id() = any(p_class_ids)
        or public.my_student_id() = any(p_student_ids)
        or exists (select 1 from student_group_members m where m.student_id = public.my_student_id() and m.group_id = any(p_group_ids))))
    or (p_shared and p_org in (select public.my_ancestor_orgs())))
$$;
revoke all on function public.content_for_me(uuid, boolean, uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.content_for_me(uuid, boolean, uuid[], uuid[], uuid[]) to authenticated;

-- Học sinh nhận nội dung (để gửi thông báo, tính tiến độ)
create or replace function public.content_audience(p_org uuid, p_class_ids uuid[], p_group_ids uuid[], p_student_ids uuid[])
returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id from students s
   where s.org_id = p_org and s.status = 'studying'
     and ((coalesce(cardinality(p_class_ids), 0) + coalesce(cardinality(p_group_ids), 0) + coalesce(cardinality(p_student_ids), 0)) = 0
          or s.class_id = any(p_class_ids) or s.id = any(p_student_ids)
          or exists (select 1 from student_group_members m where m.student_id = s.id and m.group_id = any(p_group_ids)))
$$;
revoke all on function public.content_audience(uuid, uuid[], uuid[], uuid[]) from public, anon, authenticated;

-- Nhóm / học sinh được chọn phải thuộc đơn vị của đề / khoá học
create or replace function public.guard_content_audience() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_ids is not null and cardinality(new.group_ids) > 0
     and exists (select 1 from unnest(new.group_ids) g where not exists (select 1 from student_groups x where x.id = g and x.org_id = new.org_id)) then
    raise exception 'Nhóm học sinh không thuộc trường' using errcode = '22023';
  end if;
  if new.student_ids is not null and cardinality(new.student_ids) > 0
     and exists (select 1 from unnest(new.student_ids) g where not exists (select 1 from students x where x.id = g and x.org_id = new.org_id)) then
    raise exception 'Học sinh không thuộc trường' using errcode = '22023';
  end if;
  if new.class_ids is not null and cardinality(new.class_ids) > 0
     and exists (select 1 from unnest(new.class_ids) g where not exists (select 1 from classes x where x.id = g and x.org_id = new.org_id)) then
    raise exception 'Lớp không thuộc trường' using errcode = '22023';
  end if;
  if coalesce(cardinality(new.group_ids), 0) + coalesce(cardinality(new.student_ids), 0) > 0 and new.shared then
    raise exception 'Nội dung dùng chung không giao theo nhóm / học sinh' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists practice_exams_audience on practice_exams;
create trigger practice_exams_audience before insert or update on practice_exams for each row execute function public.guard_content_audience();
drop trigger if exists courses_audience on courses;
create trigger courses_audience before insert or update on courses for each row execute function public.guard_content_audience();

-- Đề nằm trong một bài học của khoá học đã giao cho em: em làm được đề đó dù đề không giao trực tiếp cho em
create or replace function public.exam_in_my_course(p_exam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_student() and exists (select 1 from course_lessons l join courses c on c.id = l.course_id
    where l.kind = 'exam' and l.exam_id = p_exam and c.status = 'published'
      and public.content_for_me(c.org_id, c.shared, c.class_ids, c.group_ids, c.student_ids))
$$;
revoke all on function public.exam_in_my_course(uuid) from public, anon;
grant execute on function public.exam_in_my_course(uuid) to authenticated;

drop policy if exists practice_exams_read on practice_exams;
create policy practice_exams_read on practice_exams for select to authenticated using (
  (public.is_staff() and (public.can_access_org(org_id) or (shared and org_id in (select public.my_ancestor_orgs()))))
  or (status <> 'draft' and opens_at <= now()
      and (public.content_for_me(org_id, shared, class_ids, group_ids, student_ids) or public.exam_in_my_course(id))));

-- Điều kiện xem khoá học tính trên chính dòng: chính sách đọc dùng hàm này để insert ... returning thấy được dòng vừa thêm
create or replace function public.course_row_visible(c courses) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.is_staff() and (public.can_access_org(c.org_id) or (c.shared and c.org_id in (select public.my_ancestor_orgs()))))
    or (c.status = 'published' and public.content_for_me(c.org_id, c.shared, c.class_ids, c.group_ids, c.student_ids))
    or (c.status = 'published' and exists (select 1 from students s where public.is_guardian_of(s.id)
          and ((s.org_id = c.org_id and s.id in (select public.content_audience(c.org_id, c.class_ids, c.group_ids, c.student_ids)))
               or (c.shared and c.org_id in (with recursive up as (select parent_id as id from organizations where id = s.org_id
                    union all select o.parent_id from organizations o join up on o.id = up.id where o.parent_id is not null) select id from up)))))
$$;
create or replace function public.course_visible(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses c where c.id = p_course and public.course_row_visible(c))
$$;
revoke all on function public.course_row_visible(courses) from public, anon;
grant execute on function public.course_row_visible(courses) to authenticated;
drop policy if exists courses_read on courses;
create policy courses_read on courses for select to authenticated using (public.course_row_visible(courses));

-- exam_start: như 053, kiểm tra đối tượng giao gồm nhóm / học sinh
create or replace function public.exam_start(p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e practice_exams; a exam_attempts; v_st uuid := public.my_student_id(); v_org uuid := public.my_org_id(); v_q uuid[]; v_n int; k text; v_need int;
begin
  if not public.is_student() or v_st is null then raise exception 'Chỉ học sinh làm đề luyện' using errcode = '42501'; end if;
  select * into e from practice_exams where id = p_exam and status = 'published' and opens_at <= now()
     and (public.content_for_me(org_id, shared, class_ids, group_ids, student_ids) or public.exam_in_my_course(id));
  if not found then raise exception 'Không tìm thấy đề luyện dành cho em' using errcode = '42501'; end if;
  if e.closes_at is not null and now() > e.closes_at then raise exception 'Đề luyện đã đóng' using errcode = '22023'; end if;
  select * into a from exam_attempts where exam_id = e.id and student_id = v_st and status = 'in_progress' order by started_at desc limit 1;
  if found and (a.deadline is null or now() < a.deadline) then
    return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions', public.exam_paper(a), 'answers', a.answers, 'title', e.title);
  elsif found then
    perform public.exam_submit(a.id, a.answers);
  end if;
  if e.max_attempts > 0 and (select count(*) from exam_attempts where exam_id = e.id and student_id = v_st) >= e.max_attempts then
    raise exception 'Em đã hết lượt làm đề này' using errcode = '22023';
  end if;
  if e.mode = 'fixed' then
    select array_agg(q.id order by o.n) into v_q from unnest(e.question_ids) with ordinality o(qid, n) join question_bank q on q.id = o.qid where q.status <> 'retired';
  else
    v_n := (e.criteria ->> 'count')::int;
    v_q := '{}';
    for k, v_need in select key, value::int from jsonb_each_text(coalesce(e.criteria -> 'levels', '{}'::jsonb)) where value ~ '^\d+$' loop
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and q.level = k and public.bank_usable(q.org_id, q.shared, e.org_id)
          and (e.subject is null or q.subject = e.subject) and (e.grade is null or q.grade = e.grade)
          and (jsonb_array_length(coalesce(e.criteria -> 'topics', '[]')) = 0 or q.topic in (select jsonb_array_elements_text(e.criteria -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_need);
    end loop;
    if cardinality(v_q) < v_n then
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, e.org_id)
          and (e.subject is null or q.subject = e.subject) and (e.grade is null or q.grade = e.grade)
          and (jsonb_array_length(coalesce(e.criteria -> 'topics', '[]')) = 0 or q.topic in (select jsonb_array_elements_text(e.criteria -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_n - cardinality(v_q));
    end if;
    v_q := v_q[1:v_n];
  end if;
  if coalesce(cardinality(v_q), 0) = 0 then raise exception 'Đề chưa có câu hỏi phù hợp — báo thầy cô' using errcode = '22023'; end if;
  insert into exam_attempts (exam_id, student_id, org_id, questions, deadline)
    values (e.id, v_st, v_org, v_q, case when e.duration_min is not null then now() + make_interval(mins => e.duration_min) end)
    returning * into a;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions', public.exam_paper(a), 'answers', null, 'title', e.title);
end $$;

create or replace function public.notify_elearning() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid; v_page text := 'E-learning & luyện thi';
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and (select type from organizations where id = new.org_id) = 'school' then
    for v in select s.profile_id from students s
              where s.id in (select public.content_audience(new.org_id, new.class_ids, new.group_ids, new.student_ids)) and s.profile_id is not null loop
      perform public.notify_user(v, new.org_id, 'elearning',
        case tg_table_name when 'practice_exams' then 'Đề luyện mới: ' else 'Khoá học mới: ' end || new.title, coalesce(new.subject, ''), v_page, 'student', new.id);
    end loop;
  end if;
  return null;
end $$;

-- ===== 2. Bài học tự học: tệp và học liệu trong kho =====
alter table course_lessons add column if not exists path text, add column if not exists library_item_id uuid references library_items(id) on delete set null;
alter table course_lessons drop constraint if exists course_lessons_kind_check;
alter table course_lessons add constraint course_lessons_kind_check check (kind in ('video', 'reading', 'link', 'exam', 'file', 'library'));
alter table course_lessons drop constraint if exists course_lessons_file_check;
alter table course_lessons add constraint course_lessons_file_check check (kind <> 'file' or path is not null);
alter table course_lessons drop constraint if exists course_lessons_library_check;
alter table course_lessons add constraint course_lessons_library_check check (kind <> 'library' or library_item_id is not null);
create or replace function public.guard_course_lesson() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid := (select org_id from courses where id = new.course_id);
begin
  if new.path is not null and public.learning_file_org(new.path) is distinct from v_org then
    raise exception 'Tệp bài học phải thuộc thư mục của đơn vị tạo khoá học' using errcode = '22023';
  end if;
  if new.library_item_id is not null and auth.uid() is not null and not public.library_visible(new.library_item_id) then
    raise exception 'Không tìm thấy học liệu' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists course_lessons_guard on course_lessons;
create trigger course_lessons_guard before insert or update on course_lessons for each row execute function public.guard_course_lesson();

-- Học sinh mở tệp bài học của khoá học dành cho mình (kể cả khoá dùng chung của Sở / KDI)
create or replace function public.learning_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (public.is_staff() and public.learning_file_org(p_name) in (select public.my_org_tree()))
    or (public.is_student() and public.learning_file_org(p_name) = public.my_org_id())
    or exists (select 1 from library_items i where i.kind = 'material' and i.status = 'published' and i.content->>'path' = p_name
                and (public.library_visible(i.id)
                     or (public.is_student() and (i.scope = 'public'
                          or (i.scope = 'children' and i.owner_org_id in (select public.my_ancestor_orgs()))
                          or (i.scope = 'selected' and exists (select 1 from library_targets t where t.item_id = i.id and t.org_id in (select public.my_scope_orgs())))))))
    or exists (select 1 from library_item_versions v join library_items i on i.id = v.item_id
                where v.content->>'path' = p_name and public.library_visible(i.id))
    or exists (select 1 from course_lessons l where l.path = p_name and public.course_visible(l.course_id))
    or exists (select 1 from course_lessons l join library_items i on i.id = l.library_item_id
                where i.content->>'path' = p_name and i.status = 'published' and public.course_visible(l.course_id)), false)
$$;

-- Học liệu (đường dẫn / tệp) của bài học dạng "học liệu" cho học sinh: chỉ khi bài thuộc khoá học em xem được
create or replace function public.course_lesson_material(p_lesson uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', i.title, 'summary', i.summary, 'type', i.content->>'type', 'url', i.content->>'url',
                            'path', i.content->>'path', 'file_name', i.content->>'file_name')
    from course_lessons l join library_items i on i.id = l.library_item_id
   where l.id = p_lesson and public.course_visible(l.course_id) and i.status = 'published'
$$;
revoke all on function public.course_lesson_material(uuid) from public, anon;
grant execute on function public.course_lesson_material(uuid) to authenticated;

-- ===== 3. Phân tích kết quả =====
create or replace function public.answer_is_correct(p_given jsonb, p_answer jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(coalesce(p_given, '[]'::jsonb)) = 'array'
     and (select coalesce(array_agg(x::int order by x::int), '{}') from jsonb_array_elements_text(coalesce(p_given, '[]'::jsonb)) x where x ~ '^\d+$')
       = (select array_agg(x::int order by x::int) from jsonb_array_elements_text(p_answer) x)
$$;

-- Từng câu trả lời của các lượt đã nộp trong phạm vi người xem: nhân sự đơn vị (trường, Sở / Phòng thấy trường trực thuộc).
-- Lọc: đề, lớp, môn, khối, số ngày gần nhất. Nội bộ.
create or replace function public.elearning_answers(p_exam uuid, p_class uuid, p_subject text, p_grade int, p_days int)
returns table (attempt_id uuid, student_id uuid, class_id uuid, org_id uuid, question_id uuid, subject text, grade int, topic text,
               level text, stem text, correct boolean, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.student_id, s.class_id, t.org_id, q.id, q.subject, q.grade, coalesce(nullif(trim(q.topic), ''), 'Chưa phân chủ đề'),
         q.level, q.stem, public.answer_is_correct(t.answers -> q.id::text, q.answer), t.submitted_at
    from exam_attempts t join students s on s.id = t.student_id
         cross join lateral unnest(t.questions) qid join question_bank q on q.id = qid
   where t.status = 'submitted' and public.is_staff()
     and (t.org_id in (select public.my_org_tree()) or exists (select 1 from practice_exams e where e.id = t.exam_id and e.org_id in (select public.my_org_tree())))
     and (p_exam is null or t.exam_id = p_exam)
     and (p_class is null or s.class_id = p_class)
     and (p_subject is null or q.subject = p_subject)
     and (p_grade is null or q.grade = p_grade)
     and (p_days is null or t.submitted_at >= now() - make_interval(days => p_days))
$$;
revoke all on function public.elearning_answers(uuid, uuid, text, int, int) from public, anon, authenticated;

-- Câu hỏi khó: tỉ lệ đúng tăng dần (chỉ câu có ít nhất p_min lượt trả lời)
create or replace function public.elearning_hard_questions(p_exam uuid default null, p_class uuid default null, p_subject text default null,
                                                           p_grade int default null, p_days int default 180, p_min int default 3)
returns table (question_id uuid, stem text, subject text, grade int, topic text, level text, shown int, correct int, rate numeric,
               students int, wrong_option jsonb)
language sql stable security definer set search_path = public as $$
  select a.question_id, left(min(a.stem), 300), min(a.subject), min(a.grade), min(a.topic), min(a.level), count(*)::int,
         count(*) filter (where a.correct)::int, round(100.0 * count(*) filter (where a.correct) / count(*), 0),
         count(distinct a.student_id)::int,
         -- phương án sai được chọn nhiều nhất
         (select jsonb_build_object('index', x.v, 'label', q.options ->> x.v, 'times', x.n) from question_bank q,
            lateral (select v::int as v, count(*) as n from exam_attempts t2 cross join lateral jsonb_array_elements_text(coalesce(t2.answers -> q.id::text, '[]')) v
                      where t2.id in (select b.attempt_id from public.elearning_answers(p_exam, p_class, p_subject, p_grade, p_days) b where b.question_id = a.question_id)
                        and v ~ '^\d+$' and not (q.answer @> to_jsonb(v::int))
                      group by v::int order by count(*) desc limit 1) x
           where q.id = a.question_id)
    from public.elearning_answers(p_exam, p_class, p_subject, p_grade, p_days) a
   group by a.question_id
  having count(*) >= greatest(coalesce(p_min, 1), 1)
   order by 9, 7 desc
$$;

-- Nội dung cần ôn tập: theo môn / khối / chủ đề / mức độ, tỉ lệ đúng và số học sinh dưới 50%
create or replace function public.elearning_topic_stats(p_exam uuid default null, p_class uuid default null, p_subject text default null,
                                                        p_grade int default null, p_days int default 180)
returns table (subject text, grade int, topic text, level text, questions int, answers int, rate numeric, students int, weak_students int)
language sql stable security definer set search_path = public as $$
  with a as (select * from public.elearning_answers(p_exam, p_class, p_subject, p_grade, p_days)),
  per_student as (
    select a.subject, a.grade, a.topic, a.level, a.student_id, avg(case when a.correct then 1.0 else 0 end) as r
      from a group by 1, 2, 3, 4, 5)
  select a.subject, a.grade, a.topic, a.level, count(distinct a.question_id)::int, count(*)::int,
         round(100.0 * count(*) filter (where a.correct) / count(*), 0), count(distinct a.student_id)::int,
         (select count(*)::int from per_student p where p.subject = a.subject and p.grade is not distinct from a.grade
             and p.topic = a.topic and p.level = a.level and p.r < 0.5)
    from a group by a.subject, a.grade, a.topic, a.level
   order by 7, 6 desc
$$;

-- Học sinh: chủ đề em cần ôn (theo các lượt đã nộp của em, hoặc của con với phụ huynh / GV xem học sinh)
create or replace function public.elearning_my_review(p_student uuid default null)
returns table (subject text, grade int, topic text, answers int, rate numeric, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select q.subject, q.grade, coalesce(nullif(trim(q.topic), ''), 'Chưa phân chủ đề'), count(*)::int,
         round(100.0 * count(*) filter (where public.answer_is_correct(t.answers -> q.id::text, q.answer)) / count(*), 0), max(t.submitted_at)
    from exam_attempts t cross join lateral unnest(t.questions) qid join question_bank q on q.id = qid
   where t.status = 'submitted' and t.student_id = coalesce(p_student, public.my_student_id())
     and public.can_view_student(coalesce(p_student, public.my_student_id()))
   group by 1, 2, 3
   order by 5, 4 desc
$$;

-- Tiến độ khoá học: từng học sinh được giao — số bài đã học, điểm TB các đề trong khoá, quá hạn
create or replace function public.course_progress_summary(p_course uuid)
returns table (student_id uuid, full_name text, class_name text, done int, total int, last_done_at timestamptz, exam_avg numeric, overdue boolean)
language plpgsql stable security definer set search_path = public as $$
declare c courses;
begin
  select * into c from courses where id = p_course;
  if c.id is null or not (public.is_staff() and public.can_access_org(c.org_id)) then
    raise exception 'Không có quyền xem tiến độ khoá học này' using errcode = '42501';
  end if;
  return query
  select s.id, s.full_name, cl.name,
         (select count(*)::int from course_progress p join course_lessons l on l.id = p.lesson_id where l.course_id = c.id and p.student_id = s.id),
         (select count(*)::int from course_lessons l where l.course_id = c.id),
         (select max(p.done_at) from course_progress p join course_lessons l on l.id = p.lesson_id where l.course_id = c.id and p.student_id = s.id),
         (select round(avg(t.score), 1) from exam_attempts t where t.student_id = s.id and t.status = 'submitted'
             and t.exam_id in (select l.exam_id from course_lessons l where l.course_id = c.id and l.exam_id is not null)),
         c.due_at is not null and now() > c.due_at
           and (select count(*) from course_progress p join course_lessons l on l.id = p.lesson_id where l.course_id = c.id and p.student_id = s.id)
               < (select count(*) from course_lessons l where l.course_id = c.id)
    from students s left join classes cl on cl.id = s.class_id
   where s.id in (select public.content_audience(c.org_id, c.class_ids, c.group_ids, c.student_ids))
   order by cl.name nulls last, s.full_name;
end $$;

-- Kết quả đề luyện theo học sinh được giao: lượt làm, điểm cao nhất / gần nhất, chưa làm
create or replace function public.exam_roster(p_exam uuid)
returns table (student_id uuid, full_name text, class_name text, attempts int, best numeric, last_score numeric, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare e practice_exams;
begin
  select * into e from practice_exams where id = p_exam;
  if e.id is null or not (public.is_staff() and public.can_access_org(e.org_id)) or (select type from organizations where id = e.org_id) <> 'school' then
    raise exception 'Không có quyền xem danh sách làm bài của đề này' using errcode = '42501';
  end if;
  return query
  select s.id, s.full_name, cl.name, count(t.id)::int, max(t.score),
         (array_agg(t.score order by t.submitted_at desc nulls last))[1], max(t.submitted_at)
    from students s left join classes cl on cl.id = s.class_id
         left join exam_attempts t on t.student_id = s.id and t.exam_id = e.id and t.status = 'submitted'
   where s.id in (select public.content_audience(e.org_id, e.class_ids, e.group_ids, e.student_ids))
   group by s.id, s.full_name, cl.name
   order by cl.name nulls last, s.full_name;
end $$;

revoke all on function public.elearning_hard_questions(uuid, uuid, text, int, int, int), public.elearning_topic_stats(uuid, uuid, text, int, int),
  public.elearning_my_review(uuid), public.course_progress_summary(uuid), public.exam_roster(uuid), public.answer_is_correct(jsonb, jsonb) from public, anon;
grant execute on function public.elearning_hard_questions(uuid, uuid, text, int, int, int), public.elearning_topic_stats(uuid, uuid, text, int, int),
  public.elearning_my_review(uuid), public.course_progress_summary(uuid), public.exam_roster(uuid), public.answer_is_correct(jsonb, jsonb) to authenticated;

-- ===== 4. Dữ liệu mẫu: ngân hàng câu Tin học 6, đề luyện giao lớp 6A, khoá ôn tập giao Nhóm 1 lớp 9A, lượt làm bài =====
do $$
declare sch uuid; c6 uuid; c9 uuid; g1 uuid; ex uuid; co uuid; qs uuid[]; st record; i int := 0; ans jsonb; ok int; q record; l1 uuid; l2 uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from question_bank where org_id = sch and subject = 'Tin học' and grade = 6) then return; end if;
  select id into c6 from classes where org_id = sch and name like '%6A%' limit 1;
  select id into c9 from classes where org_id = sch and name like '%9A%' limit 1;
  select id into g1 from student_groups where class_id = c9 order by name limit 1;
  insert into question_bank (org_id, subject, grade, topic, level, kind, stem, options, answer, explain, status) values
    (sch, 'Tin học', 6, 'Thông tin và dữ liệu', 'nhan_biet', 'single', 'Dữ liệu được máy tính xử lí là gì?', '["Thông tin đã được mã hoá","Âm thanh","Hình ảnh trên giấy","Lời nói"]', '[0]', 'Máy tính xử lí dữ liệu là thông tin đã được mã hoá thành dãy bit.', 'ready'),
    (sch, 'Tin học', 6, 'Thông tin và dữ liệu', 'thong_hieu', 'single', 'Đơn vị nhỏ nhất dùng để đo dung lượng thông tin là?', '["Byte","Bit","KB","MB"]', '[1]', null, 'ready'),
    (sch, 'Tin học', 6, 'Thông tin và dữ liệu', 'van_dung', 'single', '1 KB bằng bao nhiêu byte?', '["1000","1024","100","2048"]', '[1]', '1 KB = 2^10 = 1024 byte.', 'ready'),
    (sch, 'Tin học', 6, 'Mạng máy tính và Internet', 'nhan_biet', 'single', 'Thiết bị nào dùng để kết nối các máy tính trong mạng?', '["Bộ chuyển mạch (switch)","Máy in","Loa","Bàn phím"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 6, 'Mạng máy tính và Internet', 'thong_hieu', 'truefalse', 'Internet là mạng kết nối các mạng máy tính trên khắp thế giới.', '["Đúng","Sai"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 6, 'Mạng máy tính và Internet', 'van_dung', 'multi', 'Những việc nào giúp sử dụng Internet an toàn?', '["Không chia sẻ mật khẩu","Mở mọi tệp đính kèm lạ","Dùng mật khẩu mạnh","Kết bạn với người lạ"]', '[0,2]', null, 'ready'),
    (sch, 'Tin học', 6, 'Thuật toán', 'thong_hieu', 'single', 'Cấu trúc "Nếu … thì …" là cấu trúc gì?', '["Tuần tự","Rẽ nhánh","Lặp","Hàm"]', '[1]', null, 'ready'),
    (sch, 'Tin học', 6, 'Thuật toán', 'van_dung', 'single', 'Lặp 5 lần "tiến 10 bước" thì nhân vật đi được bao nhiêu bước?', '["10","15","50","5"]', '[2]', null, 'ready');
  select array_agg(id order by created_at, stem) into qs from question_bank where org_id = sch and subject = 'Tin học' and grade = 6;
  insert into practice_exams (org_id, title, description, subject, grade, mode, question_ids, duration_min, max_attempts, class_ids, group_ids, opens_at, closes_at, status)
    values (sch, 'Luyện tập Tin học 6 — Chủ đề A, B, F', 'Đề cố định 8 câu, làm tối đa 2 lần.', 'Tin học', 6, 'fixed', qs, 15, 2,
            case when c6 is null then null else array[c6] end, null, now() - interval '14 days', now() + interval '14 days', 'published')
    returning id into ex;
  -- Lượt làm của học sinh lớp 6A: câu "1 KB" và câu chọn nhiều đáp án là câu khó
  for st in select id from students where class_id = c6 order by full_name loop
    i := i + 1;
    ans := '{}'::jsonb; ok := 0;
    for q in select b.id, b.answer, b.stem, b.kind from question_bank b where b.id = any(qs) loop
      if q.stem like '1 KB%' then
        ans := ans || jsonb_build_object(q.id::text, case when i % 4 = 0 then q.answer else '[0]'::jsonb end);
      elsif q.kind = 'multi' then
        ans := ans || jsonb_build_object(q.id::text, case when i % 3 = 0 then q.answer else '[0]'::jsonb end);
      elsif q.stem like 'Lặp 5 lần%' then
        ans := ans || jsonb_build_object(q.id::text, case when i % 2 = 0 then q.answer else '[0]'::jsonb end);
      else
        ans := ans || jsonb_build_object(q.id::text, case when i = 3 and q.stem like 'Đơn vị%' then '[0]'::jsonb else q.answer end);
      end if;
      if public.answer_is_correct(ans -> q.id::text, q.answer) then ok := ok + 1; end if;
    end loop;
    insert into exam_attempts (exam_id, student_id, org_id, questions, answers, started_at, submitted_at, deadline, status, correct, total, score)
      values (ex, st.id, sch, qs, ans, now() - make_interval(days => 10 - i, mins => 20), now() - make_interval(days => 10 - i, mins => 8),
              now() - make_interval(days => 10 - i, mins => 5), 'submitted', ok, cardinality(qs), round(10.0 * ok / cardinality(qs), 1));
  end loop;
  -- Khoá ôn tập giao cho Nhóm 1 lớp 9A
  if g1 is not null then
    insert into courses (org_id, title, description, subject, grade, group_ids, due_at, status)
      values (sch, 'Ôn tập lập trình Scratch — nhóm bồi dưỡng', 'Khoá tự học cho nhóm học sinh chuẩn bị thi STEM cấp trường.', 'Tin học', 9,
              array[g1], now() + interval '10 days', 'published')
      returning id into co;
    insert into course_lessons (course_id, position, title, kind, url, duration_min) values
      (co, 1, 'Video: biến và vòng lặp trong Scratch', 'video', 'https://www.youtube.com/watch?v=jXUZaf5D12A', 12) returning id into l1;
    insert into course_lessons (course_id, position, title, kind, body, duration_min) values
      (co, 2, 'Đọc: thuật toán sắp xếp đơn giản', 'reading', 'Sắp xếp nổi bọt: so sánh hai phần tử kề nhau và đổi chỗ nếu sai thứ tự; lặp lại đến khi không còn đổi chỗ.', 15) returning id into l2;
    insert into course_lessons (course_id, position, title, kind, exam_id) values (co, 3, 'Bài luyện tập cuối khoá', 'exam', ex);
    insert into course_progress (lesson_id, student_id, done_at)
      select l1, m.student_id, now() - interval '2 days' from student_group_members m where m.group_id = g1;
    insert into course_progress (lesson_id, student_id, done_at)
      select l2, m.student_id, now() - interval '1 day' from student_group_members m where m.group_id = g1 limit 1;
  end if;
end $$;

notify pgrst, 'reload schema';
