-- 094. Kho hoạt động & bài giảng của KDI (cổng Quản trị nền tảng)
--  • Quản trị nền tảng KDI tạo, sửa, xoá hoạt động tương tác và bài giảng (giáo án) trong đơn vị KDI.
--    Bài của KDI lưu là "mẫu" (is_template, không gắn giáo viên).
--  • Bài của KDI đã xuất bản: mọi nhân sự (giáo viên, quản trị trường, Sở) đọc được, dùng / nhân bản về đơn vị mình.
--  • lesson_plan_can_edit(), lesson_plan_clone() cho phép thêm hai trường hợp trên.
-- Cần chạy sau 093.

-- Đơn vị nền tảng (KDI)
create or replace function public.is_platform_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform from organizations where id = p_org), false)
$$;
revoke all on function public.is_platform_org(uuid) from public, anon;
grant execute on function public.is_platform_org(uuid) to authenticated;

-- ===== Hoạt động tương tác =====
drop policy if exists activities_platform_write on activities;
create policy activities_platform_write on activities for all to authenticated
  using (org_id = public.my_org_id() and public.is_platform_admin())
  with check (org_id = public.my_org_id() and public.is_platform_admin());
drop policy if exists activities_kdi_shared_read on activities;
create policy activities_kdi_shared_read on activities for select to authenticated
  using (status = 'published' and public.is_platform_org(org_id) and (select public.is_staff()));

-- ===== Bài giảng (giáo án) =====
drop policy if exists lesson_plans_platform_write on lesson_plans;
create policy lesson_plans_platform_write on lesson_plans for all to authenticated
  using (org_id = public.my_org_id() and public.is_platform_admin())
  with check (org_id = public.my_org_id() and public.is_platform_admin());
drop policy if exists lesson_plans_kdi_shared_read on lesson_plans;
create policy lesson_plans_kdi_shared_read on lesson_plans for select to authenticated
  using (status = 'published' and draft_of is null and public.is_platform_org(org_id) and (select public.is_staff()));

-- Người sửa được giáo án: chủ giáo án; quản trị trường; quản trị nền tảng với bài của KDI
create or replace function public.lesson_plan_can_edit(p lesson_plans) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.can_access_org(p.org_id) and ((p.teacher_id is not null and p.teacher_id = public.my_teacher_id()) or public.is_admin()))
      or (p.org_id = public.my_org_id() and public.is_platform_admin())
$$;
revoke all on function public.lesson_plan_can_edit(lesson_plans) from public, anon;

-- Nhân bản: thêm nguồn là bài giảng KDI đã xuất bản (bản sao thuộc đơn vị của người nhân bản)
create or replace function public.lesson_plan_clone(p_plan uuid, p_title text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; v_teacher uuid := public.my_teacher_id(); v_org uuid := public.my_org_id(); v_new uuid;
  v_kdi boolean; v_padmin boolean := public.is_platform_admin();
begin
  select * into p from lesson_plans where id = p_plan;
  v_kdi := p.id is not null and p.org_id <> v_org and public.is_platform_org(p.org_id) and p.status = 'published' and p.draft_of is null;
  if p.id is null or not public.is_staff() or (p.org_id <> v_org and not v_kdi)
     or not (v_kdi or p.status = 'published' or p.is_template or p.teacher_id = v_teacher or public.is_admin() or v_padmin) then
    raise exception 'Không nhân bản được giáo án này' using errcode = '42501';
  end if;
  if v_teacher is null and not public.is_admin() and not v_padmin then raise exception 'Chỉ giáo viên hoặc quản trị trường nhân bản giáo án' using errcode = '42501'; end if;
  if p.library_item_id is not null and (select usage_rights from library_items where id = p.library_item_id) = 'use' and p.teacher_id is distinct from v_teacher then
    raise exception 'Học liệu gốc chỉ được dùng nguyên bản, không nhân bản để chỉnh sửa' using errcode = '42501';
  end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, from_package, is_template, status, summary, slides, source_id,
                            library_item_id, library_version, template_id, doc, steps, program_id, unit_id, library_ids, rubric_ids, norm_id, norm_adjust, periods,
                            lesson, cover_url)
  values (v_org, v_teacher, coalesce(nullif(trim(p_title), ''), regexp_replace(p.title, '^Mẫu:\s*', '') || case when p.teacher_id = v_teacher and not v_kdi then ' (bản sao)' else '' end),
          p.subject, p.grades, p.program, p.from_package, v_teacher is null, 'draft', p.summary, p.slides, p.id,
          p.library_item_id, p.library_version, p.template_id, p.doc, p.steps, p.program_id, p.unit_id, p.library_ids, p.rubric_ids,
          case when v_kdi then null else p.norm_id end, p.norm_adjust, p.periods, p.lesson, p.cover_url)
  returning id into v_new;
  return v_new;
end $$;
revoke all on function public.lesson_plan_clone(uuid, text) from public, anon;
grant execute on function public.lesson_plan_clone(uuid, text) to authenticated;

notify pgrst, 'reload schema';
