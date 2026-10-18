-- 042: Đánh giá năng lực (S4).
--   1. competencies: khung năng lực — học sinh (năng lực chung + năng lực đặc thù STEM theo CT GDPT 2018) và giáo viên STEM
--      (5 năng lực, 4 mức Chưa đạt / Đạt / Khá / Tốt như chuẩn nghề nghiệp GV — TT 20/2018). Danh mục hệ thống.
--   2. Năng lực học sinh lấy từ bằng chứng có sẵn: mỗi tiêu chí rubric (041) gắn một năng lực (criterion.competency);
--      mức đạt ở các bài đã chấm → hồ sơ năng lực của HS (student_competencies) và của lớp (class_competencies).
--   3. Giáo viên tự đánh giá + quản trị trường đánh giá theo năm học (teacher_assessments), kèm minh chứng tự động
--      (teacher_evidence: tập huấn, chứng chỉ, tiết STEM đã dạy, giáo án, bài có rubric).

-- ===== 1. Khung năng lực =====
create table if not exists competencies (
  key text primary key check (key ~ '^[a-z_]+$'),
  audience text not null check (audience in ('student', 'teacher')),
  grp text not null,
  name text not null,
  description text,
  levels jsonb not null check (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) = 4),
  sort int not null default 0
);
alter table competencies enable row level security;
drop policy if exists competencies_read on competencies;
create policy competencies_read on competencies for select to authenticated using (true);
drop policy if exists competencies_platform on competencies;
create policy competencies_platform on competencies for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

insert into competencies (key, audience, grp, name, description, levels, sort) values
 ('tu_chu', 'student', 'Năng lực chung', 'Tự chủ và tự học', 'Tự lực, tự điều chỉnh, tự học và hoàn thiện bản thân trong hoạt động STEM.',
   '["Cần nhiều hỗ trợ","Thực hiện được khi có hướng dẫn","Chủ động thực hiện","Chủ động, tự điều chỉnh và hỗ trợ bạn"]', 10),
 ('giao_tiep', 'student', 'Năng lực chung', 'Giao tiếp và hợp tác', 'Trình bày, lắng nghe, phân công và phối hợp trong nhóm.',
   '["Ít tham gia","Tham gia khi được giao","Phối hợp tốt, trình bày rõ","Dẫn dắt nhóm, trình bày thuyết phục"]', 20),
 ('gqvd', 'student', 'Năng lực chung', 'Giải quyết vấn đề và sáng tạo', 'Phát hiện, làm rõ vấn đề; đề xuất, thử nghiệm và cải tiến giải pháp.',
   '["Chưa xác định được vấn đề","Giải quyết được khi có gợi ý","Tự đề xuất và thực hiện giải pháp","Giải pháp sáng tạo, có cải tiến"]', 30),
 ('khoa_hoc', 'student', 'Năng lực đặc thù', 'Khoa học tự nhiên', 'Nhận thức khoa học, tìm hiểu tự nhiên, vận dụng kiến thức vào thực tiễn.',
   '["Chưa vận dụng được","Vận dụng một phần","Vận dụng đúng","Vận dụng và giải thích được nguyên lý"]', 40),
 ('cong_nghe', 'student', 'Năng lực đặc thù', 'Công nghệ', 'Thiết kế kỹ thuật, sử dụng công cụ, chế tạo và đánh giá sản phẩm.',
   '["Chưa có thiết kế/sản phẩm","Sản phẩm chưa hoàn chỉnh","Sản phẩm hoàn chỉnh theo thiết kế","Sản phẩm tốt, có cải tiến kỹ thuật"]', 50),
 ('tin_hoc', 'student', 'Năng lực đặc thù', 'Tin học', 'Sử dụng công cụ số, lập trình, xử lý dữ liệu.',
   '["Chưa sử dụng được","Sử dụng khi có hướng dẫn","Sử dụng thành thạo","Vận dụng sáng tạo, hướng dẫn được bạn"]', 60),
 ('toan_hoc', 'student', 'Năng lực đặc thù', 'Toán học', 'Đo đạc, tính toán, mô hình hoá và xử lý số liệu.',
   '["Còn sai nhiều","Đúng một phần","Đúng, trình bày rõ","Đúng, mô hình hoá và lập luận chặt chẽ"]', 70),
 ('gv_thiet_ke', 'teacher', 'Giáo viên STEM', 'Thiết kế bài học STEM', 'Xây dựng chủ đề, mục tiêu, nhiệm vụ theo quy trình thiết kế kỹ thuật/khoa học.',
   '["Chưa tự thiết kế được bài học STEM","Thiết kế được bài học STEM theo mẫu","Tự thiết kế bài học STEM tích hợp liên môn","Thiết kế sáng tạo, hướng dẫn đồng nghiệp"]', 110),
 ('gv_to_chuc', 'teacher', 'Giáo viên STEM', 'Tổ chức dạy học STEM', 'Tổ chức hoạt động nhóm, hướng dẫn HS trải nghiệm, chế tạo, thử nghiệm.',
   '["Chưa tổ chức được tiết STEM","Tổ chức được tiết STEM có hỗ trợ","Tổ chức hiệu quả, HS chủ động","Tổ chức linh hoạt, là tiết mẫu cho trường"]', 120),
 ('gv_danh_gia', 'teacher', 'Giáo viên STEM', 'Kiểm tra, đánh giá theo năng lực', 'Dùng tiêu chí (rubric), quan sát, sản phẩm để đánh giá năng lực HS.',
   '["Chỉ chấm điểm kết quả","Có dùng tiêu chí đánh giá","Đánh giá theo tiêu chí, phản hồi cho HS","Xây dựng bộ tiêu chí, dùng kết quả để điều chỉnh dạy học"]', 130),
 ('gv_thiet_bi', 'teacher', 'Giáo viên STEM', 'Sử dụng phòng và thiết bị STEM', 'Khai thác phòng STEM, thiết bị, học liệu số an toàn và hiệu quả.',
   '["Chưa sử dụng phòng/thiết bị STEM","Sử dụng thiết bị cơ bản","Sử dụng thành thạo, đảm bảo an toàn","Khai thác sáng tạo, bảo quản và hướng dẫn đồng nghiệp"]', 140),
 ('gv_phat_trien', 'teacher', 'Giáo viên STEM', 'Phát triển chuyên môn STEM', 'Tham gia tập huấn, sinh hoạt chuyên môn, nghiên cứu, hướng dẫn HS dự án/cuộc thi.',
   '["Chưa tham gia tập huấn STEM","Hoàn thành tập huấn bắt buộc","Chủ động bồi dưỡng, chia sẻ chuyên môn","Báo cáo viên/hướng dẫn HS đạt giải, có sản phẩm nghiên cứu"]', 150)
on conflict (key) do nothing;

-- Gắn năng lực cho tiêu chí của 3 mẫu rubric hệ thống (041)
create or replace function pg_temp.tag(p_title text, p_keys text[]) returns void language plpgsql as $$
declare i int;
begin
  for i in 1 .. array_length(p_keys, 1) loop
    update rubrics set criteria = jsonb_set(criteria, array[(i - 1)::text, 'competency'], to_jsonb(p_keys[i]))
     where org_id is null and title = p_title and jsonb_array_length(criteria) >= i and not (criteria -> (i - 1) ? 'competency');
  end loop;
end $$;
select pg_temp.tag('Sản phẩm STEM (quy trình thiết kế kỹ thuật)', array['gqvd', 'khoa_hoc', 'cong_nghe', 'gqvd', 'giao_tiep']);
select pg_temp.tag('Báo cáo thực hành / thí nghiệm', array['khoa_hoc', 'khoa_hoc', 'toan_hoc', 'khoa_hoc']);
select pg_temp.tag('Thuyết trình dự án nhóm', array['khoa_hoc', 'giao_tiep', 'gqvd', 'giao_tiep']);

-- ===== 2. Năng lực học sinh từ bằng chứng chấm theo tiêu chí =====
-- Mức đạt của HS theo từng tiêu chí có gắn năng lực, ở các bài đã chấm (cá nhân hoặc bài nhóm của nhóm HS thuộc về)
create or replace function public.competency_evidence(p_students uuid[])
returns table (student_id uuid, competency text, level int, assignment_id uuid, title text, graded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select st.id, c.v->>'competency', (x.rubric_scores->>(c.i::int - 1))::int, a.id, a.title, x.graded_at
    from unnest(p_students) st(id)
    join submissions x on x.student_id = st.id
                       or x.group_id in (select m.group_id from student_group_members m where m.student_id = st.id)
    join assignments a on a.id = x.assignment_id
    cross join lateral jsonb_array_elements(a.rubric->'criteria') with ordinality c(v, i)
   where a.rubric is not null and x.status = 'graded' and jsonb_typeof(x.rubric_scores) = 'array'
     and coalesce(c.v->>'competency', '') <> '' and jsonb_typeof(x.rubric_scores->(c.i::int - 1)) = 'number'
$$;
revoke all on function public.competency_evidence(uuid[]) from public, anon, authenticated;

-- Ai được xem năng lực của một HS: chính HS, GV dạy lớp, quản trị trường, cấp quản lý phía trên, KDI
create or replace function public.can_view_student(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students s where s.id = p_student and (
    s.id = public.my_student_id()
    or (s.class_id is not null and public.teaches_class(s.class_id))
    or (s.org_id = public.my_org_id() and public.is_staff() and public.has_perm('students', 'view'))
    or (public.is_authority() and s.org_id in (select public.my_org_tree()))
    or public.is_platform_admin()))
$$;

create or replace function public.student_competencies(p_student uuid)
returns table (competency text, name text, grp text, evidences int, avg_level numeric, last_level int, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_student(p_student) then raise exception 'Không có quyền xem học sinh này' using errcode = '42501'; end if;
  return query
    select c.key, c.name, c.grp, count(e.level)::int, round(avg(e.level), 2),
           (array_agg(e.level order by e.graded_at desc nulls last))[1], max(e.graded_at)
      from competencies c
      left join public.competency_evidence(array[p_student]) e on e.competency = c.key
     where c.audience = 'student'
     group by c.key, c.name, c.grp, c.sort order by c.sort;
end $$;

create or replace function public.student_competency_evidence(p_student uuid)
returns table (competency text, level int, assignment_id uuid, title text, graded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_student(p_student) then raise exception 'Không có quyền xem học sinh này' using errcode = '42501'; end if;
  return query select e.competency, e.level, e.assignment_id, e.title, e.graded_at
                 from public.competency_evidence(array[p_student]) e order by e.graded_at desc nulls last;
end $$;

create or replace function public.class_competencies(p_class uuid)
returns table (student_id uuid, full_name text, student_code text, competency text, evidences int, avg_level numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from classes where id = p_class;
  if v_org is null then return; end if;
  if not (public.teaches_class(p_class) or (v_org = public.my_org_id() and public.is_staff() and public.has_perm('students', 'view'))
          or (public.is_authority() and v_org in (select public.my_org_tree())) or public.is_platform_admin()) then
    raise exception 'Không có quyền xem lớp này' using errcode = '42501';
  end if;
  return query
    select s.id, s.full_name, s.student_code, e.competency, count(*)::int, round(avg(e.level), 2)
      from students s
      join public.competency_evidence(array(select id from students where class_id = p_class and coalesce(status, 'studying') = 'studying')) e
        on e.student_id = s.id
     group by s.id, s.full_name, s.student_code, e.competency;
end $$;
revoke all on function public.can_view_student(uuid), public.student_competencies(uuid), public.student_competency_evidence(uuid), public.class_competencies(uuid) from public, anon;
grant execute on function public.can_view_student(uuid), public.student_competencies(uuid), public.student_competency_evidence(uuid), public.class_competencies(uuid) to authenticated;

-- ===== 3. Đánh giá năng lực giáo viên =====
create table if not exists teacher_assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  school_year text not null check (school_year ~ '^\d{4}-\d{4}$'),
  kind text not null check (kind in ('self', 'manager')),
  levels jsonb not null default '{}'::jsonb check (jsonb_typeof(levels) = 'object'),   -- { gv_thiet_ke: 1..4, … }
  comment text,
  plan text,                                     -- kế hoạch bồi dưỡng (người đánh giá đề xuất)
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, school_year, kind)
);
alter table teacher_assessments enable row level security;
create or replace function public.can_view_teacher(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teachers t where t.id = p_teacher and (
    t.id = public.my_teacher_id()
    or (t.org_id = public.my_org_id() and public.is_admin())
    or (public.is_authority() and t.org_id in (select public.my_org_tree()))
    or public.is_platform_admin()))
$$;
revoke all on function public.can_view_teacher(uuid) from public, anon;
grant execute on function public.can_view_teacher(uuid) to authenticated;
drop policy if exists teacher_assessments_read on teacher_assessments;
create policy teacher_assessments_read on teacher_assessments for select to authenticated
  using ((select public.can_view_teacher(teacher_id)));
drop policy if exists teacher_assessments_write on teacher_assessments;
create policy teacher_assessments_write on teacher_assessments for all to authenticated
  using ((kind = 'self' and teacher_id = (select public.my_teacher_id()))
         or (kind = 'manager' and org_id = (select public.my_org_id()) and (select public.is_admin())))
  with check (exists (select 1 from teachers t where t.id = teacher_id and t.org_id = teacher_assessments.org_id)
              and ((kind = 'self' and teacher_id = (select public.my_teacher_id()))
                   or (kind = 'manager' and org_id = (select public.my_org_id()) and (select public.is_admin()))));
-- Mức chỉ nhận 1–4 cho năng lực GV có trong khung; nộp thì ghi thời điểm; đã nộp thì GV không sửa bản tự đánh giá
create or replace function public.guard_teacher_assessment() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from jsonb_each(new.levels) l
              where l.key not in (select key from competencies where audience = 'teacher')
                 or jsonb_typeof(l.value) <> 'number' or (l.value)::text::int not between 1 and 4) then
    raise exception 'Mức đánh giá không hợp lệ' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.kind = 'self' and not public.is_admin() then
    raise exception 'Bản tự đánh giá đã nộp — nhờ quản trị trường mở lại nếu cần sửa' using errcode = '42501';
  end if;
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'draft' then new.submitted_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists teacher_assessments_guard on teacher_assessments;
create trigger teacher_assessments_guard before insert or update on teacher_assessments for each row execute function public.guard_teacher_assessment();

-- Minh chứng tự động cho hồ sơ năng lực GV (12 tháng gần nhất cho số tiết)
create or replace function public.teacher_evidence(p_teacher uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_teacher(p_teacher) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return jsonb_build_object(
    'training_completed', (select count(*) from training_enrollments where teacher_id = p_teacher and completed),
    'training_enrolled', (select count(*) from training_enrollments where teacher_id = p_teacher),
    'training_present', (select count(*) from training_attendance where teacher_id = p_teacher and present),
    'certificates', (select count(*) from certificates where teacher_id = p_teacher),
    'stem_taught_12m', (select count(*) from teaching_sessions where teacher_id = p_teacher and kind = 'stem' and status = 'taught'
                          and session_date >= current_date - 365),
    'stem_planned_12m', (select count(*) from teaching_sessions where teacher_id = p_teacher and kind = 'stem' and status <> 'cancelled'
                          and session_date between current_date - 365 and current_date),
    'lesson_plans', (select count(*) from lesson_plans where teacher_id = p_teacher),
    'rubric_assignments', (select count(*) from assignments where teacher_id = p_teacher and rubric is not null),
    'assignments', (select count(*) from assignments where teacher_id = p_teacher));
end $$;
revoke all on function public.teacher_evidence(uuid) from public, anon;
grant execute on function public.teacher_evidence(uuid) to authenticated;
