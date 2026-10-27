-- 106. Tệp tài liệu tập huấn: tài liệu của nội dung chương trình tập huấn có thể là tệp tải lên (kho learning-files),
-- lưu trong training_program_units.detail->'docs' (khoá "file" = đường dẫn tệp). Giáo viên mọi đơn vị học khoá tập huấn
-- cần mở được tệp đó khi chương trình đã phát hành. Thêm điều kiện này vào learning_file_readable (giữ nguyên các điều kiện của 061).
-- Cần chạy sau 105.

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
                where i.content->>'path' = p_name and i.status = 'published' and public.course_visible(l.course_id))
    -- 106: tài liệu tập huấn (nội dung của chương trình tập huấn đã phát hành), chỉ nhân sự (giáo viên, cán bộ)
    or (public.is_staff() and exists (select 1 from training_program_units u join training_programs p on p.id = u.program_id
                where p.status = 'published' and u.detail->'docs' @> jsonb_build_array(jsonb_build_object('file', p_name)))), false)
$$;

notify pgrst, 'reload schema';
