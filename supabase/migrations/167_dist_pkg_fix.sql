-- 167: Sửa 166: Supabase chặn DELETE không có WHERE (pg_safeupdate), nên dist_pkg_program báo "DELETE requires a WHERE clause"
-- khi bấm "+ Thêm từ Gói STEM". Xoá bảng tạm bằng "where true". Cần chạy sau 166.

create or replace function public.dist_pkg_program(p_package uuid, p_track text, p_grade int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pk program_packages; tr stem_tracks; v_id uuid; v_level text; v_org uuid; v_changed boolean;
begin
  if not public.is_staff() then raise exception 'Bạn không dùng được Gói STEM' using errcode = '42501'; end if;
  select * into pk from program_packages where id = p_package;
  select * into tr from stem_tracks where code = p_track;
  if pk.id is null or tr.code is null then raise exception 'Không tìm thấy gói / loại chương trình' using errcode = '22023'; end if;
  create temp table if not exists pg_temp.dist_pkg_t (slot int, topic_id uuid, seq int, title text, periods int, module_name text) on commit drop;
  delete from pg_temp.dist_pkg_t where true;
  insert into pg_temp.dist_pkg_t
  select x.slot, x.topic_id, row_number() over (order by x.slot, x.topic_seq)::int, x.topic_title, x.periods, x.module_name
    from public.package_topic_list(p_package) x where x.track_code = p_track and x.grade = p_grade;
  if not exists (select 1 from pg_temp.dist_pkg_t) then
    raise exception 'Gói % không có chủ đề % ở khối %', pk.code, p_track, p_grade using errcode = '22023';
  end if;

  select id into v_id from edu_programs where package_id = p_package and package_track = p_track and grade_from = p_grade;
  if v_id is null then
    select l.code into v_level from edu_levels l where p_grade between l.grade_from and l.grade_to order by l.sort limit 1;
    v_org := public.platform_org_id();
    insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, status, scope, note, package_id, package_track)
    values (v_org, left(pk.code || '-' || tr.code || '-K' || p_grade, 40),
            left(coalesce(nullif(tr.label, ''), tr.code) || ' ' || tr.name || ' · Gói ' || pk.code || ' · Khối ' || p_grade, 200),
            'stem', tr.code, v_level, p_grade, p_grade, tr.name, 'draft', 'children', 'Tạo tự động từ Gói STEM ' || pk.code, p_package, p_track)
    returning id into v_id;
    v_changed := true;
  else
    v_changed := exists (select 1 from pg_temp.dist_pkg_t t where not exists (select 1 from edu_program_units u where u.program_id = v_id
                   and u.program_topic_id = t.topic_id and u.package_slot = t.slot and u.seq = t.seq and u.title = t.title and u.periods = t.periods))
              or exists (select 1 from edu_program_units u where u.program_id = v_id
                   and not exists (select 1 from pg_temp.dist_pkg_t t where t.topic_id = u.program_topic_id and t.slot = u.package_slot));
    if v_changed then update edu_programs set status = 'draft' where id = v_id; end if;
  end if;

  if v_changed then
    -- chủ đề bị bỏ khỏi gói: xoá nếu chưa nằm trong bản phân phối đã phát hành
    delete from edu_program_units u where u.program_id = v_id
       and not exists (select 1 from pg_temp.dist_pkg_t t where t.topic_id = u.program_topic_id and t.slot = u.package_slot)
       and not exists (select 1 from dist_plan_rows r join dist_plans d on d.id = r.plan_id where r.unit_id = u.id and d.status <> 'draft');
    update edu_program_units u set seq = t.seq, title = t.title, periods = t.periods, content = 'Học phần: ' || t.module_name
      from pg_temp.dist_pkg_t t where u.program_id = v_id and u.program_topic_id = t.topic_id and u.package_slot = t.slot;
    insert into edu_program_units (program_id, unit_type, seq, grade, title, periods, content, program_topic_id, package_slot)
    select v_id, 'topic', t.seq, p_grade, t.title, t.periods, 'Học phần: ' || t.module_name, t.topic_id, t.slot
      from pg_temp.dist_pkg_t t
     where not exists (select 1 from edu_program_units u where u.program_id = v_id and u.program_topic_id = t.topic_id and u.package_slot = t.slot);
    update edu_programs set status = 'published', published_at = coalesce(published_at, now()),
           total_periods = (select coalesce(sum(periods), 0) from edu_program_units where program_id = v_id)
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.dist_pkg_program(uuid, text, int) from public, anon;
grant execute on function public.dist_pkg_program(uuid, text, int) to authenticated;

notify pgrst, 'reload schema';
