-- 113. Giám sát tập huấn: danh sách từng giáo viên của một trường (chi tiết trường ở màn Giám sát).
--  • Mỗi dòng: một kế hoạch × một GV đã ghi danh của trường. Kèm chỉ số kết quả (chuyên cần, bài học, bài kiểm tra, sản phẩm,
--    gợi ý Đạt / chưa đạt), kết quả đã chốt và chứng chỉ đã cấp.
--  • Phạm vi xem giống training_monitor: quản trị nền tảng, đơn vị lập kế hoạch, cấp quản lý / trường trong cây đơn vị của mình.
-- Cần chạy sau 112.
create or replace function public.training_monitor_teachers(p_org uuid, p_year text default null)
returns table (plan_id uuid, plan_code text, plan_name text, teacher_id uuid, teacher_name text, metrics jsonb, result text, cert boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.plan_code, p.name, t.id, t.full_name, public.training_result_metrics(p.id, t.id),
         (select r.result from training_results r where r.plan_id = p.id and r.teacher_id = t.id),
         exists (select 1 from certificates c where c.plan_id = p.id and c.teacher_id = t.id and c.status = 'issued')
    from training_plans p
    join training_plan_orgs o on o.plan_id = p.id and o.org_id = p_org
    join training_enrollments en on en.plan_id = p.id
    join teachers t on t.id = en.teacher_id and t.org_id = p_org
   where p.pub_status <> 'draft' and (p_year is null or p.year_name = p_year)
     and (public.is_platform_admin() or public.training_plan_can_manage(p.id)
          or ((public.is_authority() or public.has_perm('training', 'view')) and p_org in (select public.my_org_tree())))
   order by p.starts_on desc nulls last, p.plan_code, t.full_name
$$;
revoke all on function public.training_monitor_teachers(uuid, text) from public, anon;
grant execute on function public.training_monitor_teachers(uuid, text) to authenticated;

notify pgrst, 'reload schema';
