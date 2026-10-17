-- 020. Dữ liệu mẫu tỉnh thứ hai (Bắc Ninh) để trình diễn và kiểm thử cách ly dữ liệu giữa hai tỉnh,
-- cùng đơn vị cung cấp KDI Education. Cây sau khi chạy:
--   Bộ GD&ĐT ─┬─ Tỉnh Hưng Yên ── Sở GD&ĐT Hưng Yên ── (các trường Hưng Yên)
--             └─ Tỉnh Bắc Ninh ── Sở GD&ĐT Bắc Ninh ─┬─ Phòng GD&ĐT TP Bắc Ninh ── Trường THCS Kinh Bắc
--                                                   └─ Trường THPT Hàn Thuyên
--   KDI Education (đơn vị cung cấp, nằm ngoài cây quản lý nhà nước)
-- Kiểm thử: supabase/tests/isolation_test.sql. Cần chạy sau 019. Chạy lại nhiều lần không sinh trùng.

do $$
declare v_bo uuid; v_tinh uuid; v_so uuid; v_phong uuid; v_kb uuid; v_ht uuid; v_year uuid; v_c uuid; v_t uuid; i int; k int;
  sch uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  if exists (select 1 from organizations where code = 'SO-BN') then return; end if;
  select id into v_bo from organizations where code = 'BO-GDDT';
  if v_bo is null then
    insert into organizations (type, code, name) values ('ministry', 'BO-GDDT', 'Bộ Giáo dục và Đào tạo') returning id into v_bo;
  end if;
  insert into organizations (type, parent_id, code, name) values ('province', v_bo, 'TINH-BN', 'Tỉnh Bắc Ninh') returning id into v_tinh;
  insert into organizations (type, parent_id, code, name) values ('department', v_tinh, 'SO-BN', 'Sở GD&ĐT Bắc Ninh') returning id into v_so;
  insert into organizations (type, parent_id, code, name) values ('district', v_so, 'PGD-TPBN', 'Phòng GD&ĐT TP Bắc Ninh') returning id into v_phong;
  insert into organizations (type, parent_id, code, name, level, ward, activated_at)
    values ('school', v_phong, 'THCS-KB', 'Trường THCS Kinh Bắc', 'thcs', 'Phường Kinh Bắc', now()) returning id into v_kb;
  insert into organizations (type, parent_id, code, name, level, ward)
    values ('school', v_so, 'THPT-HT', 'Trường THPT Hàn Thuyên', 'thpt', 'Phường Vũ Ninh') returning id into v_ht;
  insert into organizations (type, code, name) values ('provider', 'KDI', 'KDI Education') on conflict (code) do nothing;

  foreach sch in array array[v_kb, v_ht] loop
    insert into academic_years (org_id, name, term, starts_on, ends_on, is_current)
      values (sch, '2025-2026', 'HK1', '2025-09-05', '2026-01-15', true) returning id into v_year;
    for i in 1..4 loop
      insert into teachers (org_id, full_name, subject, status)
        values (sch, (array['Đỗ Văn Hải','Ngô Thị Thu','Lê Quang Vinh','Trịnh Thu Hà'])[i] || case when sch = v_ht then ' (HT)' else '' end,
                (array['Toán','Vật lý','Tin học','Công nghệ'])[i], 'active') returning id into v_t;
      insert into classes (org_id, year_id, name, grade, homeroom_teacher_id)
        values (sch, v_year, 'Lớp ' || case when sch = v_kb then (5 + i)::text else (9 + i)::text end || 'A',
                case when sch = v_kb then 5 + i else 9 + i end, v_t) returning id into v_c;
      insert into teaching_assignments (org_id, year_id, teacher_id, class_id, subject)
        values (sch, v_year, v_t, v_c, (array['Toán','Vật lý','Tin học','Công nghệ'])[i]);
      for k in 1..6 loop
        insert into students (org_id, class_id, student_code, full_name)
          values (sch, v_c, (case when sch = v_kb then 'KB' else 'HT' end) || i || lpad(k::text, 2, '0'),
                  (array['Nguyễn','Trần','Lê','Phạm','Hoàng','Vũ'])[k] || ' ' || (array['Minh','Gia','Bảo','Khánh'])[i] || ' ' ||
                  (array['An','Bình','Châu','Dũng','Giang','Hiếu'])[k]);
      end loop;
    end loop;
    insert into stem_rooms (org_id, name, code, capacity, status, tier)
      values (sch, 'Phòng STEM 1', 'STEM-01', 40, 'active', 'basic');
    insert into lesson_plans (org_id, title, subject, program, status)
      values (sch, 'Thiết kế hệ thống tưới cây tự động', 'Công nghệ', 'CT3', 'published');
  end loop;
end $$;

notify pgrst, 'reload schema';
