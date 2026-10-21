-- 069. Trường thử nghiệm cho KDI
--  • Quản trị KDI bấm "Thử như giáo viên" → tạo (một lần) "Sở GD&ĐT thử nghiệm (KDI)" và "Trường thử nghiệm KDI",
--    có năm học, tiết học, 1 phòng STEM, 3 lớp (khối 6–8) với học sinh mẫu.
--  • Người bấm được gán làm Hiệu trưởng + Giáo viên của trường thử nghiệm (có hồ sơ giáo viên, dạy Công nghệ 3 lớp),
--    rồi đổi qua lại KDI ↔ trường thử nghiệm ở thanh trên cùng. Nhiều người KDI cùng bấm thì dùng chung một trường.
--  • Trường thử nghiệm không có hợp đồng → dùng được mọi phân hệ. Không đụng dữ liệu trường thật.
-- Cần chạy sau 068.

create or replace function public.platform_sandbox_school() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_dep uuid; v_sch uuid; v_yr uuid; v_teacher uuid; v_cls uuid; g int;
  v_name text; v_email text;
begin
  if v_uid is null or not public.is_platform_admin() then
    raise exception 'Chỉ quản trị KDI tạo được trường thử nghiệm' using errcode = '42501';
  end if;
  select full_name, email into v_name, v_email from profiles where id = v_uid;

  -- Đơn vị (tạo một lần)
  select id into v_dep from organizations where code = 'KDI-SANDBOX-SO';
  if v_dep is null then
    insert into organizations (type, code, name) values ('department', 'KDI-SANDBOX-SO', 'Sở GD&ĐT thử nghiệm (KDI)') returning id into v_dep;
  end if;
  select id into v_sch from organizations where code = 'KDI-SANDBOX';
  if v_sch is null then
    insert into organizations (type, parent_id, code, name, level) values ('school', v_dep, 'KDI-SANDBOX', 'Trường thử nghiệm KDI', 'thcs') returning id into v_sch;
    insert into academic_years (org_id, name, term, starts_on, ends_on, is_current)
      values (v_sch, '2026-2027', 'HK I', '2026-09-05', '2027-01-15', true) returning id into v_yr;
    insert into period_configs (org_id, name, starts_at, ends_at, session) values
      (v_sch, 'Tiết 1', '07:00', '07:45', 'morning'), (v_sch, 'Tiết 2', '07:50', '08:35', 'morning'), (v_sch, 'Tiết 3', '08:40', '09:25', 'morning'),
      (v_sch, 'Tiết 4', '09:30', '10:15', 'morning'), (v_sch, 'Tiết 5', '10:20', '11:05', 'morning');
    insert into stem_rooms (org_id, name, capacity, status, code) values (v_sch, 'Phòng STEM thử nghiệm', 40, 'active', 'KDI-SANDBOX-R1');
    foreach g in array array[6, 7, 8] loop
      insert into classes (org_id, year_id, name, grade) values (v_sch, v_yr, 'Lớp ' || g || 'A', g) returning id into v_cls;
      insert into students (org_id, class_id, student_code, full_name)
        select v_sch, v_cls, 'TN-' || g || 'A' || lpad(n::text, 2, '0'), 'Học sinh thử ' || g || 'A-' || n from generate_series(1, 10) n;
    end loop;
  end if;
  select id into v_yr from academic_years where org_id = v_sch and is_current order by starts_on desc nulls last limit 1;

  -- Người bấm: Hiệu trưởng + Giáo viên, có hồ sơ giáo viên dạy Công nghệ các lớp
  insert into memberships (user_id, org_id, role_id, created_by)
    select v_uid, v_sch, r.id, v_uid from roles r where r.org_id is null and r.key in ('principal', 'teacher')
  on conflict do nothing;
  select id into v_teacher from teachers where org_id = v_sch and profile_id = v_uid;
  if v_teacher is null then
    insert into teachers (org_id, profile_id, full_name, email, subject)
      values (v_sch, v_uid, coalesce(nullif(trim(v_name), ''), 'Giáo viên thử nghiệm'), v_email, 'Công nghệ') returning id into v_teacher;
  end if;
  insert into teaching_assignments (org_id, year_id, teacher_id, class_id, subject)
    select v_sch, v_yr, v_teacher, c.id, 'Công nghệ' from classes c
     where c.org_id = v_sch
       and not exists (select 1 from teaching_assignments t where t.teacher_id = v_teacher and t.class_id = c.id and t.subject = 'Công nghệ');
  return v_sch;
end $$;
revoke all on function public.platform_sandbox_school() from public, anon;
grant execute on function public.platform_sandbox_school() to authenticated;
