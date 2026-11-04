-- 133. Xoá năng lực trong khung năng lực (04/11).
--  • competency_usage(p_key): đếm nơi đang dùng mã năng lực (mọi đơn vị). Chỉ KDI gọi được.
--  • competency_delete(p_key): chỉ KDI; chặn xoá khi năng lực đã được dùng, vì kết quả cũ lưu theo mã.

create or replace function public.competency_usage(p_key text)
returns table (source text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Chỉ Quản trị hệ thống xem được' using errcode = '42501';
  end if;
  return query
    select u.source, u.n from (
      select 'Kết quả đánh giá giáo viên'::text source, count(*) n from teacher_assessments where levels ? p_key
      union all select 'Chương trình đào tạo', count(*) from training_programs where p_key = any(competencies)
      union all select 'Chương trình giáo dục', count(*) from edu_programs where p_key = any(competency_keys)
      union all select 'Yêu cầu cần đạt', count(*) from edu_outcomes where competency_key = p_key
      union all select 'Yêu cầu năng lực giáo viên', count(*) from edu_program_teacher_reqs where competency = p_key
      union all select 'Tiêu chí chấm (rubric)', count(*) from rubrics r
                 where exists (select 1 from jsonb_array_elements(r.criteria) c where c->>'competency' = p_key)
      union all select 'Bài tập có tiêu chí chấm', count(*) from assignments a
                 where a.rubric is not null and jsonb_typeof(a.rubric->'criteria') = 'array'
                   and exists (select 1 from jsonb_array_elements(a.rubric->'criteria') c where c->>'competency' = p_key)
    ) u where u.n > 0;
end $$;
revoke all on function public.competency_usage(text) from public, anon;
grant execute on function public.competency_usage(text) to authenticated;

create or replace function public.competency_delete(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_platform_admin() then
    raise exception 'Chỉ Quản trị hệ thống xoá được năng lực' using errcode = '42501';
  end if;
  if not exists (select 1 from competencies where key = p_key) then
    raise exception 'Không tìm thấy năng lực' using errcode = '22023';
  end if;
  select string_agg(u.source || ' (' || u.n || ')', ', ') into v from public.competency_usage(p_key) u;
  if v is not null then
    raise exception 'Năng lực đang được dùng ở: %. Không xoá được.', v using errcode = '23503';
  end if;
  delete from competencies where key = p_key;
end $$;
revoke all on function public.competency_delete(text) from public, anon;
grant execute on function public.competency_delete(text) to authenticated;

notify pgrst, 'reload schema';
