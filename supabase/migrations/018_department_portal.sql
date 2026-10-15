-- 018. Cổng Sở GD&ĐT: thuộc tính trường (xã/phường, kích hoạt), thống kê toàn Sở, tập huấn cấp Sở,
-- lịch sử xuất báo cáo, dữ liệu mẫu ~20 trường Hưng Yên.
-- Cần chạy sau 017.

-- ===== 1. Thuộc tính trường =====
alter table organizations add column if not exists ward text,               -- xã/phường (sau sáp nhập)
  add column if not exists address text,
  add column if not exists activated_at timestamptz;                         -- Sở đã kích hoạt hệ thống cho trường

create or replace function public.my_parent_org() returns uuid
language sql stable security definer set search_path = public as $$
  select parent_id from organizations where id = public.my_org_id()
$$;
grant execute on function public.my_parent_org() to authenticated;
-- Trường đọc được thông tin Sở chủ quản
create policy org_read_parent on organizations for select to authenticated using (id = public.my_parent_org());

-- ===== 2. Tập huấn cấp Sở: Sở tạo/sửa; trường thấy kế hoạch, lịch, bài giảng của Sở =====
do $$
declare t text;
begin
  foreach t in array array['training_plans','training_sessions','training_lessons','training_enrollments','training_attendance','certificates'] loop
    execute format('create policy %I on %I for all to authenticated using (public.has_role(array[''department'']) and org_id = public.my_org_id()) with check (public.has_role(array[''department'']) and org_id = public.my_org_id())', t||'_dept_write', t);
  end loop;
  foreach t in array array['training_plans','training_sessions','training_lessons'] loop
    execute format('create policy %I on %I for select to authenticated using (public.is_staff() and org_id = public.my_parent_org())', t||'_from_department', t);
  end loop;
end $$;
-- Giáo viên thấy ghi danh / điểm danh của chính mình ở khoá tập huấn của Sở
create policy training_enroll_self_read on training_enrollments for select to authenticated using (teacher_id = public.my_teacher_id());
create policy training_att_self_read on training_attendance for select to authenticated using (teacher_id = public.my_teacher_id());

-- Sở cập nhật thông tin / kích hoạt trường trực thuộc
create policy org_department_update on organizations for update to authenticated
  using (public.has_role(array['department']) and parent_id = public.my_org_id())
  with check (public.has_role(array['department']) and parent_id = public.my_org_id());

-- ===== 3. Lịch sử xuất báo cáo =====
create table report_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  template text not null,           -- TT38 | TT32 | CV3014 | TT26 | QUY
  title text not null,
  scope text not null,              -- 'Toàn tỉnh' hoặc tên xã/phường
  period text not null,             -- 'Q4/2026', 'HK I 2026-2027'…
  format text not null check (format in ('xlsx','pdf','doc')),
  rows int not null default 0,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table report_exports enable row level security;
create policy report_exports_read on report_exports for select to authenticated using (public.can_access_org(org_id) and public.is_staff());
create policy report_exports_insert on report_exports for insert to authenticated
  with check (org_id = public.my_org_id() and public.is_staff() and created_by = auth.uid());

-- ===== 4. Thống kê theo trường (một lần gọi cho mọi màn của Sở) =====
-- Chỉ trả về trường người gọi được phép xem (Sở: mọi trường trực thuộc; trường: chính mình).
create or replace function public.dept_school_stats()
returns table (
  school_id uuid, code text, name text, level text, ward text, activated boolean,
  teachers int, stem_teachers int, students int, classes int, stem_classes int, stem_students int,
  programs text[], rooms int, rooms_active int, stem_periods int, total_periods int, room_periods int,
  lesson_plans int, products int, trained int, training_done int, attendance_rate numeric,
  units int, units_broken int, units_maintenance int, units_available int,
  graded int, avg_score numeric, k12_synced boolean, has_year boolean, last_activity timestamptz, kpi int
)
language sql stable security definer set search_path = public as $$
  with s as (
    select o.* from organizations o
    where o.type = 'school' and public.is_staff() and public.can_access_org(o.id)
  ),
  cur as (select org_id, id from academic_years where is_current),
  base as (
    select s.id as school_id, s.code, s.name, s.level, s.ward, s.activated_at is not null as activated,
      (select count(*) from teachers t where t.org_id = s.id and t.status = 'active')::int as teachers,
      (select count(distinct teacher_id) from stem_teacher_programs x where x.org_id = s.id)::int as stem_teachers,
      (select count(*) from students x where x.org_id = s.id and coalesce(x.status,'studying') = 'studying')::int as students,
      (select count(*) from classes c where c.org_id = s.id)::int as classes,
      (select count(distinct class_id) from class_programs cp where cp.org_id = s.id)::int as stem_classes,
      (select count(*) from students x where x.org_id = s.id and coalesce(x.status,'studying') = 'studying' and x.class_id in (select class_id from class_programs cp where cp.org_id = s.id))::int as stem_students,
      coalesce((select array_agg(distinct program order by program) from class_programs cp where cp.org_id = s.id), '{}') as programs,
      (select count(*) from stem_rooms r where r.org_id = s.id)::int as rooms,
      (select count(*) from stem_rooms r where r.org_id = s.id and r.status = 'active')::int as rooms_active,
      (select count(*) from timetable_entries e where e.org_id = s.id and e.kind = 'stem'
         and (e.year_id is null or e.year_id in (select id from cur where cur.org_id = s.id)))::int as stem_periods,
      (select count(*) from timetable_entries e where e.org_id = s.id
         and (e.year_id is null or e.year_id in (select id from cur where cur.org_id = s.id)))::int as total_periods,
      (select count(*) from timetable_entries e where e.org_id = s.id and e.room_id is not null
         and (e.year_id is null or e.year_id in (select id from cur where cur.org_id = s.id)))::int as room_periods,
      (select count(*) from lesson_plans lp where lp.org_id = s.id and not lp.is_template and lp.status = 'published')::int as lesson_plans,
      (select count(*) from assignments a where a.org_id = s.id and a.kind = 'product')::int as products,
      (select count(distinct en.teacher_id) from training_enrollments en join teachers t on t.id = en.teacher_id where t.org_id = s.id)::int as trained,
      (select count(distinct en.teacher_id) from training_enrollments en join teachers t on t.id = en.teacher_id where t.org_id = s.id and en.completed)::int as training_done,
      (select round(100.0 * count(*) filter (where ta.present) / nullif(count(*) filter (where ta.present is not null), 0), 1)
         from training_attendance ta join teachers t on t.id = ta.teacher_id where t.org_id = s.id) as attendance_rate,
      (select count(*) from equipment_units u where u.org_id = s.id)::int as units,
      (select count(*) from equipment_units u where u.org_id = s.id and u.status = 'broken')::int as units_broken,
      (select count(*) from equipment_units u where u.org_id = s.id and u.status = 'maintenance')::int as units_maintenance,
      (select count(*) from equipment_units u where u.org_id = s.id and u.status = 'available')::int as units_available,
      (select count(*) from submissions x where x.org_id = s.id and x.status = 'graded')::int as graded,
      (select round(avg(x.score / nullif(a.max_score, 0) * 10), 2) from submissions x join assignments a on a.id = x.assignment_id
         where x.org_id = s.id and x.status = 'graded') as avg_score,
      exists (select 1 from teachers t where t.org_id = s.id and t.k12_synced_at is not null) as k12_synced,
      exists (select 1 from academic_years y where y.org_id = s.id) as has_year,
      greatest((select max(created_at) from stem_registrations x where x.org_id = s.id),
               (select max(submitted_at) from submissions x where x.org_id = s.id),
               (select max(started_at) from class_sessions x where x.org_id = s.id),
               (select max(updated_at) from lesson_plans x where x.org_id = s.id)) as last_activity
    from s
  )
  -- KPI tổng hợp 0–100: độ phủ CT (25) + phòng STEM (15) + tiết STEM/lớp (20) + tập huấn (20) + giáo án (10) + đồng bộ K12 (10)
  select b.*,
    round(
      25 * least(coalesce(array_length(b.programs, 1), 0), 5) / 5.0
    + 15 * least(b.rooms_active, 2) / 2.0
    + 20 * least(b.stem_periods::numeric / nullif(b.classes, 0), 2) / 2.0
    + 20 * coalesce(b.training_done::numeric / nullif(b.teachers, 0), 0)
    + 10 * least(b.lesson_plans::numeric / nullif(b.teachers, 0) * 2, 1)
    + 10 * (case when b.k12_synced then 1 else 0 end)
    )::int as kpi
  from base b
  order by b.name
$$;
grant execute on function public.dept_school_stats() to authenticated;

-- Thống kê theo môn (tỉ lệ tiết STEM trên tổng tiết của môn) trong học kỳ hiện tại các trường
create or replace function public.dept_subject_stats()
returns table (subject text, total int, stem int, classes int, schools int, students int)
language sql stable security definer set search_path = public as $$
  select e.subject, count(*)::int, count(*) filter (where e.kind = 'stem')::int,
    count(distinct e.class_id) filter (where e.kind = 'stem')::int, count(distinct e.org_id) filter (where e.kind = 'stem')::int,
    (select count(*) from students st where st.class_id in (select class_id from timetable_entries x where x.subject = e.subject and x.kind = 'stem'
       and public.can_access_org(x.org_id)))::int
  from timetable_entries e
  where public.is_staff() and public.can_access_org(e.org_id)
    and (e.year_id is null or e.year_id in (select id from academic_years where is_current))
  group by e.subject
  order by 3 desc
$$;
grant execute on function public.dept_subject_stats() to authenticated;

-- ===== 5. Dữ liệu mẫu: các trường thuộc Sở GD&ĐT Hưng Yên =====
do $$
declare
  dept uuid; sch uuid; yr uuid; plan uuid; s record; g int; i int; j int; k int;
  n_teach int; n_cls int; room_ids uuid[]; cls_ids uuid[]; teach_ids uuid[]; per_ids uuid[]; sess uuid[];
  grades int[]; subjects text[]; stem_subjects text[]; ty uuid; ho text[] := array['Nguyễn','Trần','Lê','Phạm','Hoàng','Vũ','Đặng','Bùi','Đỗ','Ngô'];
  dem text[] := array['Thị','Văn','Minh','Thu','Quang','Ngọc','Đức','Thanh','Hải','Hồng'];
  ten text[] := array['Hà','Lan','Hùng','Trang','Hương','Tuấn','Bình','Dũng','Mai','Nam','Linh','Phúc','Hiếu','Yến','Long','Thảo','Khoa','Vy'];
begin
  select id into dept from organizations where code = 'SO-HY';
  if dept is null or exists (select 1 from organizations where code = 'THCS-NTT') then return; end if;
  perform setseed(0.42);

  update organizations set ward = 'Phố Hiến', activated_at = '2025-08-20' where code = 'THCS-PH';
  update organizations set ward = 'Phố Hiến' where code = 'THPT-CHY';
  update organizations set ward = 'Mỹ Hào' where code = 'TH-MH';

  insert into organizations (type, parent_id, code, name, level, ward) values
    ('school', dept, 'THCS-NTT', 'Trường THCS Nguyễn Thiện Thuật', 'thcs', 'Khoái Châu'),
    ('school', dept, 'TH-DTD', 'Trường Tiểu học Đoàn Thị Điểm', 'tieuhoc', 'Phố Hiến'),
    ('school', dept, 'THPT-TV', 'Trường THPT Trưng Vương', 'thpt', 'Văn Giang'),
    ('school', dept, 'THCS-TH', 'Trường THCS Tô Hiệu', 'thcs', 'Tiên Lữ'),
    ('school', dept, 'TH-LD', 'Trường Tiểu học Lạc Đạo', 'tieuhoc', 'Văn Lâm'),
    ('school', dept, 'THCS-HC', 'Trường THCS Hiệp Cường', 'thcs', 'Kim Động'),
    ('school', dept, 'THCS-LQD', 'Trường THCS Lê Quý Đôn', 'thcs', 'Phố Hiến'),
    ('school', dept, 'THPT-PNL', 'Trường THPT Phạm Ngũ Lão', 'thpt', 'Ân Thi'),
    ('school', dept, 'THCS-DD', 'Trường THCS Đại Đồng', 'thcs', 'Văn Lâm'),
    ('school', dept, 'THPT-TQP', 'Trường THPT Triệu Quang Phục', 'thpt', 'Yên Mỹ'),
    ('school', dept, 'TH-HTLO', 'Trường Tiểu học Hải Thượng Lãn Ông', 'tieuhoc', 'Yên Mỹ'),
    ('school', dept, 'THPT-NH', 'Trường THPT Nguyễn Huệ', 'thpt', 'Phố Hiến'),
    ('school', dept, 'TH-KCA', 'Trường Tiểu học Khoái Châu A', 'tieuhoc', 'Khoái Châu'),
    ('school', dept, 'THCS-AT', 'Trường THCS Ân Thi', 'thcs', 'Ân Thi'),
    ('school', dept, 'TH-LB', 'Trường Tiểu học Lương Bằng', 'tieuhoc', 'Kim Động'),
    ('school', dept, 'THPT-VG', 'Trường THPT Văn Giang', 'thpt', 'Văn Giang'),
    ('school', dept, 'THCS-CMT', 'Trường THCS Chu Mạnh Trinh', 'thcs', 'Văn Giang'),
    ('school', dept, 'MN-HS', 'Trường Mầm non Hoa Sen', 'mamnon', 'Mỹ Hào');

  -- Khoá tập huấn cấp Sở (3 buổi)
  insert into training_plans (org_id, name, program, provider, mode, status, hours, code, year_no, module_no)
    values (dept, 'Tập huấn giáo dục STEM 2026 – Module 1: Thiết kế bài học STEM', 'CT2', 'Sở GD&ĐT Hưng Yên', 'hybrid', 'ongoing', 12, 'TH-SO-2026-01', 2026, 1)
    returning id into plan;
  insert into training_sessions (org_id, plan_id, title, starts_at, ends_at, mode, location) values
    (dept, plan, 'Buổi 1: Quy trình thiết kế bài học STEM', now() - interval '30 days', now() - interval '30 days' + interval '3 hours', 'offline', 'Hội trường Sở GD&ĐT'),
    (dept, plan, 'Buổi 2: Đánh giá năng lực trong dạy học STEM', now() - interval '16 days', now() - interval '16 days' + interval '3 hours', 'online', 'Phòng họp trực tuyến'),
    (dept, plan, 'Buổi 3: Thực hành với thiết bị Robotics / IoT', now() + interval '5 days', now() + interval '5 days' + interval '3 hours', 'offline', 'Trường THPT Chuyên Hưng Yên');
  select array_agg(id order by starts_at) into sess from training_sessions where plan_id = plan;

  -- Mỗi trường: mức sẵn sàng r ∈ [0.25, 1] quyết định quy mô triển khai STEM
  for s in select o.*, 0.25 + 0.75 * random() as r from organizations o
           where o.parent_id = dept and o.type = 'school' and o.code <> 'THCS-PH' order by o.code loop
    sch := s.id;
    update organizations set activated_at = case when s.r > 0.35 then now() - (random() * 400 || ' days')::interval end where id = sch;
    grades := case s.level when 'tieuhoc' then array[1,2,3,4,5] when 'thcs' then array[6,7,8,9] when 'thpt' then array[10,11,12] else array[]::int[] end;
    subjects := case s.level when 'tieuhoc' then array['Toán','Tiếng Việt','Khoa học','Tin học','Công nghệ','Tiếng Anh']
                             when 'thcs' then array['Toán','Ngữ văn','Khoa học tự nhiên','Tin học','Công nghệ','Tiếng Anh']
                             else array['Toán','Ngữ văn','Vật lý','Hoá học','Sinh học','Tin học','Công nghệ','Tiếng Anh'] end;
    stem_subjects := case s.level when 'tieuhoc' then array['Khoa học','Tin học','Công nghệ','Toán']
                                  when 'thcs' then array['Khoa học tự nhiên','Công nghệ','Tin học','Toán']
                                  else array['Vật lý','Hoá học','Sinh học','Tin học','Công nghệ'] end;

    if not exists (select 1 from academic_years where org_id = sch) then
      insert into academic_years (org_id, name, term, starts_on, ends_on, is_current) values (sch, '2026-2027', 'HK I', '2026-09-05', '2027-01-15', true) returning id into yr;
    else select id into yr from academic_years where org_id = sch and is_current; end if;
    if not exists (select 1 from period_configs where org_id = sch) then
      insert into period_configs (org_id, name, starts_at, ends_at, session) values
        (sch,'Tiết 1','07:00','07:45','morning'), (sch,'Tiết 2','07:50','08:35','morning'), (sch,'Tiết 3','08:40','09:25','morning'),
        (sch,'Tiết 4','09:30','10:15','morning'), (sch,'Tiết 5','10:20','11:05','morning');
    end if;
    select array_agg(id order by starts_at) into per_ids from period_configs where org_id = sch;

    -- Giáo viên
    n_teach := case s.level when 'thpt' then 30 when 'thcs' then 22 when 'tieuhoc' then 18 else 10 end + floor(random() * 12)::int;
    insert into teachers (org_id, full_name, email, subject, grade, k12_synced_at)
    select sch, ho[1 + floor(random()*10)::int] || ' ' || dem[1 + floor(random()*10)::int] || ' ' || ten[1 + floor(random()*18)::int],
           lower(s.code) || '.gv' || n || '@hungyen.edu.vn', subjects[1 + (n % array_length(subjects,1))],
           case when array_length(grades,1) > 0 then grades[1 + (n % array_length(grades,1))] end,
           case when s.r > 0.5 then now() - interval '3 days' end
    from generate_series(1, n_teach) n;
    select array_agg(id) into teach_ids from teachers where org_id = sch;

    -- Phòng STEM
    room_ids := '{}';
    for i in 1..greatest(0, round(s.r * 4)::int - case when s.level = 'mamnon' then 3 else 0 end) loop
      insert into stem_rooms (org_id, name, capacity, status, code, tier)
        values (sch, case i when 1 then 'Phòng STEM 1' when 2 then 'Phòng STEM 2' when 3 then 'Phòng Robotics' else 'Phòng IoT & AI' end,
                36 + 4 * i, case when random() < 0.12 then 'maintenance' else 'active' end, s.code || '-R' || i, case when s.r > 0.7 then 'premium' else 'basic' end)
        returning id into ty;
      room_ids := room_ids || ty;
    end loop;

    -- Thiết bị (TT38)
    if array_length(room_ids, 1) > 0 then
      insert into equipment_types (org_id, sku, name, brand, category) values (sch, 'MBOT', 'Robot lập trình mBot', 'Makeblock', 'Robot') returning id into ty;
      insert into equipment_units (org_id, type_id, room_id, serial, status, warranty_until)
      select sch, ty, room_ids[1 + (n % array_length(room_ids,1))], s.code || '-MB-' || n,
             (array['available','available','available','in_use','maintenance','broken'])[1 + floor(random()*6)::int], '2028-08-31'
      from generate_series(1, 6 + floor(s.r * 18)::int) n;
      insert into equipment_types (org_id, sku, name, brand, category) values (sch, 'ARD', 'Bộ Arduino Starter', 'Arduino', 'Vi điều khiển') returning id into ty;
      insert into equipment_units (org_id, type_id, room_id, serial, status, warranty_until)
      select sch, ty, room_ids[1], s.code || '-AR-' || n,
             (array['available','available','in_use','available','broken'])[1 + floor(random()*5)::int], '2028-08-31'
      from generate_series(1, 4 + floor(s.r * 12)::int) n;
    end if;

    -- Lớp, học sinh, chương trình STEM, thời khóa biểu
    foreach g in array grades loop
      n_cls := case s.level when 'thpt' then 3 when 'thcs' then 3 else 2 end + floor(random() * 2)::int;
      for i in 1..n_cls loop
        insert into classes (org_id, year_id, name, grade) values (sch, yr, 'Lớp ' || g || chr(64 + i), g) returning id into ty;
        insert into students (org_id, class_id, student_code, full_name)
        select sch, ty, s.code || '-' || g || chr(64 + i) || lpad(n::text, 2, '0'),
               ho[1 + floor(random()*10)::int] || ' ' || dem[1 + floor(random()*10)::int] || ' ' || ten[1 + floor(random()*18)::int]
        from generate_series(1, 28 + floor(random() * 12)::int) n;
        -- chương trình STEM của lớp: trường sẵn sàng cao triển khai nhiều CT hơn
        insert into class_programs (org_id, class_id, program)
        select sch, ty, p from unnest(array['CT1','CT2','CT3','CT4','CT5']) with ordinality as x(p, o)
        where o = 1 and s.r > 0.3 or o = 2 and s.r > 0.5 and random() < 0.8 or o = 3 and s.r > 0.6 and random() < 0.6
           or o = 4 and s.r > 0.65 and array_length(room_ids,1) > 1 and random() < 0.7 or o = 5 and s.r > 0.8 and g >= 8 and random() < 0.6;
        -- TKB: 5 ngày × 5 tiết; một số tiết là STEM có phòng
        for j in 2..6 loop
          for k in 1..array_length(per_ids,1) loop
            insert into timetable_entries (org_id, year_id, class_id, teacher_id, period_id, weekday, subject, kind, room_id)
            values (sch, yr, ty, null, per_ids[k], j, subjects[1 + ((j * 7 + k + i) % array_length(subjects,1))], 'regular', null);
          end loop;
        end loop;
        if array_length(room_ids, 1) > 0 then
          update timetable_entries e set kind = 'stem', subject = stem_subjects[1 + (e.weekday % array_length(stem_subjects,1))],
                 room_id = room_ids[1 + ((e.weekday + i) % array_length(room_ids,1))]
          where e.class_id = ty and e.id in (select id from timetable_entries where class_id = ty order by random() limit round(s.r * 3.4)::int);
        end if;
        -- dự án / sản phẩm STEM đã giao
        insert into assignments (org_id, class_id, title, kind, subject, group_mode, status, due_at)
        select sch, ty, 'Dự án STEM ' || n || ' – khối ' || g, 'product', stem_subjects[1 + (n % array_length(stem_subjects,1))], true, 'closed', now() - (n * 20 || ' days')::interval
        from generate_series(1, floor(s.r * 3)::int) n;
      end loop;
    end loop;

    -- Giáo viên dạy STEM theo chương trình
    insert into stem_teacher_programs (org_id, teacher_id, program)
    select distinct sch, teach_ids[1 + floor(random() * array_length(teach_ids,1))::int], p
    from unnest(array['CT1','CT2','CT3','CT4','CT5']) p, generate_series(1, greatest(1, round(s.r * 4)::int))
    where exists (select 1 from class_programs cp where cp.org_id = sch and cp.program = p)
    on conflict do nothing;

    -- Giáo án GV tự soạn đã xuất bản
    insert into lesson_plans (org_id, teacher_id, title, subject, status, slides, created_at, updated_at)
    select sch, teach_ids[1 + floor(random() * array_length(teach_ids,1))::int], 'Giáo án STEM số ' || n, stem_subjects[1 + (n % array_length(stem_subjects,1))], 'published', '[]',
           now() - ((2 + random() * (60 - 55 * s.r)) || ' days')::interval, now() - ((1 + random() * (60 - 55 * s.r)) || ' days')::interval
    from generate_series(1, floor(s.r * s.r * n_teach * 0.9)::int) n;

    -- Ghi danh tập huấn Sở + điểm danh 2 buổi đã diễn ra
    insert into training_enrollments (org_id, plan_id, teacher_id, completed)
    select dept, plan, tid, random() < s.r * 0.95 from unnest(teach_ids) tid where random() < 0.35 + 0.6 * s.r;
    insert into training_attendance (org_id, session_id, teacher_id, present)
    select dept, x.sid, en.teacher_id, random() < 0.55 + 0.4 * s.r
    from training_enrollments en, unnest(sess[1:2]) as x(sid)
    where en.plan_id = plan and en.teacher_id = any(teach_ids);
  end loop;

  -- Trường Phố Hiến cũng tham gia khoá của Sở
  insert into training_enrollments (org_id, plan_id, teacher_id, completed)
  select dept, plan, t.id, random() < 0.8 from teachers t join organizations o on o.id = t.org_id where o.code = 'THCS-PH'
  on conflict do nothing;
  insert into training_attendance (org_id, session_id, teacher_id, present)
  select dept, x.sid, en.teacher_id, random() < 0.9
  from training_enrollments en join teachers t on t.id = en.teacher_id join organizations o on o.id = t.org_id, unnest(sess[1:2]) as x(sid)
  where en.plan_id = plan and o.code = 'THCS-PH'
  on conflict do nothing;
end $$;
