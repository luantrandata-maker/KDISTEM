-- 099. Quản trị hệ thống thao tác được mọi chức năng của Phân hệ 1 (Đào tạo & đánh giá năng lực nhà giáo), phương án B (26/10):
--  ở từng mục menu Quản trị, chọn đơn vị (trường / Sở / Phòng) rồi thao tác như người quản lý của đơn vị đó.
--  • training_can_write: Quản trị hệ thống ghi được tập huấn của mọi đơn vị (trước đây chỉ của KDI). Kéo theo: kế hoạch, chương trình
--    trong kế hoạch, gán trường, duyệt danh sách, lịch, điểm danh, giảng viên, đợt đánh giá, kết quả, chứng chỉ của mọi đơn vị.
--  • Bảng dùng policy chung theo quyền của trường (bài giảng tập huấn, ghi danh, điểm danh, chứng chỉ cũ): thêm policy cho Quản trị.
--  • Đánh giá năng lực GV (bản của trường), gửi danh sách GV, xét đăng ký của GV: Quản trị làm thay trường được.
--  Dữ liệu ngoài Phân hệ 1 (học sinh, lớp…) vẫn giữ như cũ: Quản trị chỉ xem.
-- Cần chạy sau 098.

create or replace function public.training_can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((p_org = public.my_org_id() and public.is_staff() and (public.has_perm('training', 'edit') or public.is_authority()))
      or (p_org is not null and public.is_platform_admin()), false)
$$;

do $$ declare t text; begin
  foreach t in array array['training_plans', 'training_sessions', 'training_lessons', 'training_enrollments', 'training_attendance', 'certificates'] loop
    execute format('drop policy if exists %I on %I', t || '_platform_write', t);
    execute format('create policy %I on %I for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin())', t || '_platform_write', t);
  end loop;
end $$;

-- Đánh giá năng lực GV: bản của trường (manager) do Hiệu trưởng / QTV trường hoặc Quản trị hệ thống; Quản trị mở lại bản tự đánh giá được
drop policy if exists teacher_assessments_platform on teacher_assessments;
create policy teacher_assessments_platform on teacher_assessments for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin() and exists (select 1 from teachers t where t.id = teacher_id and t.org_id = teacher_assessments.org_id));

-- Gửi danh sách GV và xét đăng ký: thêm Quản trị hệ thống
do $$
declare d text;
begin
  d := pg_get_functiondef('public.training_plan_submit(uuid,uuid)'::regprocedure);
  if position('is_platform_admin' in d) = 0 then
    d := replace(d, 'if not (v_org in (select public.my_org_tree()) and public.is_staff()', 'if not public.is_platform_admin() and not (v_org in (select public.my_org_tree()) and public.is_staff()');
    if position('is_platform_admin' in d) = 0 then raise exception '099: không sửa được training_plan_submit'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('public.training_registration_review(uuid,uuid,boolean,text)'::regprocedure);
  if position('is_platform_admin' in d) = 0 then
    d := replace(d, 'if not (public.training_plan_can_manage(p_plan)', 'if not (public.is_platform_admin() or public.training_plan_can_manage(p_plan)');
    if position('is_platform_admin' in d) = 0 then raise exception '099: không sửa được training_registration_review'; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
