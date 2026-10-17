-- 041: Chấm bài theo tiêu chí (rubric) — đánh giá sản phẩm/dự án STEM theo mức độ, gắn với bài tập.
--   • rubrics: kho tiêu chí — mẫu hệ thống (org_id null, do KDI quản lý) và mẫu của trường (giáo viên tạo, cả trường dùng).
--     criteria = [{ name, desc, points, levels: [mô tả Mức 1, Mức 2, Mức 3, Mức 4] }]  (Mức 4 cao nhất)
--   • assignments.rubric: bản chụp tiêu chí lúc giao bài (sửa mẫu sau đó không làm đổi bài đã giao/đã chấm).
--   • submissions.rubric_scores: mức đạt từng tiêu chí [1..4]. Điểm tính trên CSDL:
--       điểm = Σ(điểm tiêu chí × mức/4) / Σ điểm tiêu chí × thang điểm của bài, làm tròn 0,25.
--     Học sinh không tự đặt mức (guard_submission giữ nguyên như với điểm).
--   • rubric_class_summary(bài): mức trung bình và phân bố theo tiêu chí — cho GV nhận xét lớp, báo cáo đánh giá.

create table if not exists rubrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,      -- null = mẫu hệ thống
  title text not null,
  description text,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 1 and 12),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rubrics_system_title on rubrics (title) where org_id is null;
alter table rubrics enable row level security;
drop policy if exists rubrics_read on rubrics;
create policy rubrics_read on rubrics for select to authenticated using (
  org_id is null or (select public.is_platform_admin()) or (org_id = (select public.my_org_id()) and (select public.is_staff())));
drop policy if exists rubrics_insert on rubrics;
create policy rubrics_insert on rubrics for insert to authenticated with check (
  (org_id = (select public.my_org_id()) and (select public.is_staff())) or (org_id is null and (select public.is_platform_admin())));
drop policy if exists rubrics_update on rubrics;
create policy rubrics_update on rubrics for update to authenticated
  using ((org_id = (select public.my_org_id()) and (created_by = auth.uid() or (select public.is_admin()))) or (org_id is null and (select public.is_platform_admin())))
  with check ((org_id = (select public.my_org_id()) and (select public.is_staff())) or (org_id is null and (select public.is_platform_admin())));
drop policy if exists rubrics_delete on rubrics;
create policy rubrics_delete on rubrics for delete to authenticated
  using ((org_id = (select public.my_org_id()) and (created_by = auth.uid() or (select public.is_admin()))) or (org_id is null and (select public.is_platform_admin())));
drop trigger if exists rubrics_touch on rubrics;
create trigger rubrics_touch before update on rubrics for each row execute function public.touch_updated_at();

-- Kiểm tra cấu trúc tiêu chí
create or replace function public.rubric_valid(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 12
     and not exists (select 1 from jsonb_array_elements(p) c
                      where coalesce(btrim(c->>'name'), '') = ''
                         or jsonb_typeof(c->'points') <> 'number' or (c->>'points')::numeric <= 0
                         or jsonb_typeof(c->'levels') <> 'array' or jsonb_array_length(c->'levels') <> 4)
$$;
alter table rubrics drop constraint if exists rubrics_criteria_valid;
alter table rubrics add constraint rubrics_criteria_valid check (public.rubric_valid(criteria));

alter table assignments add column if not exists rubric jsonb;
alter table assignments drop constraint if exists assignments_rubric_valid;
alter table assignments add constraint assignments_rubric_valid check (rubric is null or public.rubric_valid(rubric->'criteria'));
alter table submissions add column if not exists rubric_scores jsonb;

-- Điểm từ mức đạt: null nếu chưa chấm đủ tiêu chí
create or replace function public.rubric_score(p_rubric jsonb, p_levels jsonb, p_max numeric) returns numeric
language plpgsql immutable as $$
declare n int := jsonb_array_length(p_rubric->'criteria'); tot numeric := 0; got numeric := 0; i int; lv int;
begin
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) <> n then return null; end if;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(p_levels->i) <> 'number' then return null; end if;
    lv := (p_levels->>i)::int;
    if lv not between 1 and 4 then raise exception 'Mức đạt phải từ 1 đến 4' using errcode = '22023'; end if;
    tot := tot + (p_rubric->'criteria'->i->>'points')::numeric;
    got := got + (p_rubric->'criteria'->i->>'points')::numeric * lv / 4;
  end loop;
  return round(round(got / tot * p_max * 4) / 4, 2);
end $$;

-- 013 + mức theo tiêu chí: học sinh không tự đặt; giáo viên đặt mức → CSDL tính điểm
create or replace function public.guard_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare a assignments;
begin
  if public.is_student() then
    if tg_op = 'INSERT' then
      new.status := 'submitted'; new.score := null; new.feedback := null; new.graded_at := null; new.graded_by := null;
      new.submitted_at := now(); new.rubric_scores := null;
    else
      new.assignment_id := old.assignment_id; new.student_id := old.student_id; new.group_id := old.group_id;
      new.status := 'submitted'; new.score := old.score; new.feedback := old.feedback;
      new.graded_at := old.graded_at; new.graded_by := old.graded_by; new.submitted_at := now(); new.rubric_scores := old.rubric_scores;
    end if;
  else
    if new.rubric_scores is not null and (tg_op = 'INSERT' or new.rubric_scores is distinct from old.rubric_scores) then
      select * into a from assignments where id = new.assignment_id;
      if a.rubric is null then raise exception 'Bài tập này không chấm theo tiêu chí' using errcode = '22023'; end if;
      new.score := coalesce(public.rubric_score(a.rubric, new.rubric_scores, a.max_score), new.score);
    end if;
    if tg_op = 'UPDATE' and new.score is distinct from old.score and new.score is not null then
      new.status := 'graded'; new.graded_at := now(); new.graded_by := coalesce(public.my_teacher_id(), new.graded_by);
    end if;
  end if;
  return new;
end $$;

-- Tổng hợp theo tiêu chí cho một bài (GV dạy lớp, quản trị trường, Sở/Phòng cấp trên)
create or replace function public.rubric_class_summary(p_assignment uuid)
returns table (idx int, name text, points numeric, graded int, avg_level numeric, l1 int, l2 int, l3 int, l4 int)
language plpgsql stable security definer set search_path = public as $$
declare a assignments;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or a.rubric is null then return; end if;
  if not (public.teaches_class(a.class_id) or (a.org_id = public.my_org_id() and public.is_admin())
          or (public.is_authority() and a.org_id in (select public.my_org_tree())) or public.is_platform_admin()) then
    raise exception 'Không có quyền' using errcode = '42501';
  end if;
  return query
    select c.i::int - 1, c.v->>'name', (c.v->>'points')::numeric,
           count(s.lv)::int, round(avg(s.lv), 2),
           count(*) filter (where s.lv = 1)::int, count(*) filter (where s.lv = 2)::int,
           count(*) filter (where s.lv = 3)::int, count(*) filter (where s.lv = 4)::int
      from jsonb_array_elements(a.rubric->'criteria') with ordinality c(v, i)
      left join lateral (select (x.rubric_scores->>(c.i::int - 1))::int as lv from submissions x
                          where x.assignment_id = a.id and jsonb_typeof(x.rubric_scores) = 'array'
                            and jsonb_typeof(x.rubric_scores->(c.i::int - 1)) = 'number') s on true
     group by c.i, c.v order by c.i;
end $$;
revoke all on function public.rubric_class_summary(uuid) from public, anon;
grant execute on function public.rubric_class_summary(uuid) to authenticated;

-- Mẫu hệ thống (danh mục, có ở mọi CSDL kể cả production)
insert into rubrics (org_id, title, description, criteria, created_by) values
(null, 'Sản phẩm STEM (quy trình thiết kế kỹ thuật)', 'Đánh giá sản phẩm/mô hình theo các bước của quy trình thiết kế kỹ thuật.', $j$[
 {"name":"Xác định vấn đề và yêu cầu","points":2,"levels":["Chưa nêu được vấn đề","Nêu được vấn đề nhưng chưa rõ yêu cầu","Nêu rõ vấn đề và phần lớn yêu cầu","Nêu rõ vấn đề, đủ yêu cầu và tiêu chí đo được"]},
 {"name":"Vận dụng kiến thức khoa học","points":3,"levels":["Chưa vận dụng kiến thức","Vận dụng rời rạc, còn sai","Vận dụng đúng phần lớn kiến thức","Vận dụng đúng, giải thích được nguyên lý"]},
 {"name":"Thiết kế và chế tạo","points":2,"levels":["Chưa có bản thiết kế","Có bản thiết kế sơ sài, sản phẩm chưa hoàn chỉnh","Bản thiết kế rõ, sản phẩm hoàn chỉnh","Bản thiết kế chi tiết, sản phẩm chắc chắn, thẩm mỹ"]},
 {"name":"Thử nghiệm và cải tiến","points":2,"levels":["Chưa thử nghiệm","Thử nghiệm nhưng chưa ghi nhận kết quả","Thử nghiệm, ghi nhận và cải tiến một lần","Thử nghiệm nhiều lần, cải tiến có căn cứ số liệu"]},
 {"name":"Trình bày và làm việc nhóm","points":1,"levels":["Chưa trình bày được","Trình bày còn lúng túng, ít thành viên tham gia","Trình bày rõ, các thành viên có phân công","Trình bày thuyết phục, phối hợp nhóm tốt"]}
]$j$::jsonb, null),
(null, 'Báo cáo thực hành / thí nghiệm', 'Phiếu học tập, báo cáo thí nghiệm, đo đạc.', $j$[
 {"name":"Mục tiêu và giả thuyết","points":2,"levels":["Không có","Có nhưng chưa phù hợp","Phù hợp","Phù hợp, nêu rõ biến số"]},
 {"name":"Tiến hành và an toàn","points":3,"levels":["Sai quy trình hoặc mất an toàn","Đúng một phần quy trình","Đúng quy trình, an toàn","Đúng quy trình, an toàn, thao tác thành thạo"]},
 {"name":"Số liệu và xử lý","points":3,"levels":["Thiếu số liệu","Có số liệu, xử lý còn sai","Số liệu đủ, xử lý đúng","Số liệu đủ, xử lý đúng, có bảng/biểu đồ rõ ràng"]},
 {"name":"Kết luận","points":2,"levels":["Không có kết luận","Kết luận chưa dựa trên số liệu","Kết luận đúng","Kết luận đúng, nêu được sai số và hướng cải tiến"]}
]$j$::jsonb, null),
(null, 'Thuyết trình dự án nhóm', 'Đánh giá phần trình bày, phản biện sản phẩm/dự án.', $j$[
 {"name":"Nội dung","points":4,"levels":["Thiếu nội dung chính","Đủ ý nhưng chưa chính xác","Đủ ý, chính xác","Đủ ý, chính xác, có điểm sáng tạo"]},
 {"name":"Hình thức trình bày","points":2,"levels":["Khó theo dõi","Còn rối","Rõ ràng, đúng giờ","Rõ ràng, hấp dẫn, dùng minh hoạ tốt"]},
 {"name":"Trả lời câu hỏi","points":2,"levels":["Không trả lời được","Trả lời được một phần","Trả lời đúng","Trả lời đúng, mở rộng vấn đề"]},
 {"name":"Phối hợp nhóm","points":2,"levels":["Một người làm","Phối hợp còn rời rạc","Có phân công rõ","Mọi thành viên cùng trình bày, hỗ trợ nhau"]}
]$j$::jsonb, null)
on conflict do nothing;
