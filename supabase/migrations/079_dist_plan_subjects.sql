-- 079. Bản phân phối theo môn (Phân hệ 2, theo video demo được duyệt)
--  • dist_plan_items.subjects: các môn của chương trình trong bản, theo thứ tự dạy (kéo thả ở bước "Xếp lịch").
--    Mỗi phần tử {name, on, mode, week, ppw}: on = có dạy môn này trong bản (bỏ tick ở bước 1 là bỏ môn);
--    mode 'program' (bắt đầu cùng chương trình) · 'after' (nối tiếp môn trước) · 'week' (tuần cụ thể); ppw = nhịp riêng.
--  • dist_plan_items.split: "Chỉnh riêng từng môn". Tắt thì các môn nối tiếp nhau theo nhịp của chương trình.
--  • dist_plan_rows.weeks: tuần của từng tiết trong bài (bài 2 tiết có thể rơi vào 2 tuần khi nhịp 1, hoặc tiết đầu
--    lấp nốt tuần đang dở). Gán cho trường dùng đúng các tuần này; bản cũ chưa có thì trải theo nhịp như trước.
-- Cần chạy sau 078.

alter table dist_plan_items add column if not exists split boolean not null default false;
alter table dist_plan_items add column if not exists subjects jsonb not null default '[]'::jsonb;
alter table dist_plan_items drop constraint if exists dist_plan_items_subjects_check;
alter table dist_plan_items add constraint dist_plan_items_subjects_check
  check (jsonb_typeof(subjects) = 'array' and jsonb_array_length(subjects) <= 60);

alter table dist_plan_rows add column if not exists weeks int[];
alter table dist_plan_rows drop constraint if exists dist_plan_rows_weeks_check;
alter table dist_plan_rows add constraint dist_plan_rows_weeks_check
  check (weeks is null or (cardinality(weeks) <= 50 and 1 <= all(weeks) and 60 >= all(weeks)));

-- Lỗi chặn phát hành: thêm tiết rơi ra ngoài khung học kỳ
create or replace function public.dist_plan_errors(p_plan uuid, p_grade int, p_weeks int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when not exists (select 1 from dist_plan_items where plan_id = p_plan) then 'chưa chọn chương trình' end,
    (select 'chương trình "' || p.title || '" chưa phát hành' from dist_plan_items i join edu_programs p on p.id = i.program_id
      where i.plan_id = p_plan and p.status <> 'published' limit 1),
    (select 'chương trình "' || p.title || '" không dạy khối ' || p_grade from dist_plan_items i join edu_programs p on p.id = i.program_id
      where i.plan_id = p_plan and not (p_grade between p.grade_from and p.grade_to) limit 1),
    case when not exists (select 1 from dist_plan_rows where plan_id = p_plan and not skipped and periods > 0) then 'chưa có bài nào được xếp' end,
    (select 'bài "' || u.title || '" chưa có tuần' from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
      where r.plan_id = p_plan and not r.skipped and r.periods > 0 and r.week is null order by r.seq limit 1),
    (select 'bài "' || u.title || '" xếp ở tuần ' || greatest(r.week, (select max(w) from unnest(r.weeks) w)) || ', ngoài khung ' || p_weeks || ' tuần'
       from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
      where r.plan_id = p_plan and not r.skipped and r.periods > 0
        and (r.week > p_weeks or exists (select 1 from unnest(r.weeks) w where w > p_weeks)) order by r.seq limit 1))
$$;

-- Nhân bản: chép cả môn và tuần từng tiết
create or replace function public.dist_plan_copy(p_plan uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s dist_plans; v_new uuid;
begin
  select * into s from dist_plans where id = p_plan;
  if s.id is null or not public.dist_plan_visible(p_plan) then raise exception 'Không tìm thấy bản phân phối' using errcode = '42501'; end if;
  if not public.curriculum_can_write(public.my_org_id(), 'edit') then raise exception 'Bạn không soạn được bản phân phối' using errcode = '42501'; end if;
  insert into dist_plans (org_id, title, level, grade, tier, hk1_weeks, hk2_weeks, note, source_id)
  values (public.my_org_id(), left(s.title || ' (bản sao)', 200), s.level, s.grade, s.tier, s.hk1_weeks, s.hk2_weeks, s.note, s.id)
  returning id into v_new;
  insert into dist_plan_items (plan_id, program_id, seq, start_mode, start_week, after_program, ppw, split, subjects)
  select v_new, program_id, seq, start_mode, start_week, after_program, ppw, split, subjects from dist_plan_items where plan_id = s.id;
  insert into dist_plan_rows (plan_id, program_id, unit_id, seq, week, periods, note, manual, skipped, weeks)
  select v_new, program_id, unit_id, seq, week, periods, note, manual, skipped, weeks from dist_plan_rows where plan_id = s.id;
  return v_new;
end $$;

-- Gán cho trường: tiết thứ k của bài lấy tuần weeks[k] nếu bản đã lưu, không thì trải theo nhịp như 078
create or replace function public.dist_plan_assign(p_plan uuid, p_orgs uuid[], p_year text default null, p_classes uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare d dist_plans; v_org uuid; it record; v_year text; v_book uuid; nb int := 0; ns int := 0; v_cls uuid[];
begin
  select * into d from dist_plans where id = p_plan;
  if d.id is null or not public.dist_plan_visible(p_plan) then raise exception 'Không tìm thấy bản phân phối' using errcode = '42501'; end if;
  if d.status <> 'published' then raise exception 'Chỉ gán được bản phân phối đã phát hành' using errcode = '22023'; end if;
  if not (public.curriculum_can_write(public.my_org_id(), 'edit') or public.is_platform_admin()) then
    raise exception 'Bạn không gán được bản phân phối' using errcode = '42501';
  end if;
  foreach v_org in array coalesce(p_orgs, '{}') loop
    if not exists (select 1 from organizations o where o.id = v_org and o.type = 'school') then
      raise exception 'Chỉ gán bản phân phối cho trường' using errcode = '22023';
    end if;
    if not (v_org in (select public.my_org_tree()) or public.is_platform_admin()) then
      raise exception 'Trường không thuộc phạm vi quản lý' using errcode = '42501';
    end if;
    v_year := coalesce(nullif(btrim(p_year), ''), (select a.name from academic_years a where a.org_id = v_org and a.is_current limit 1));
    select array_agg(c.id) into v_cls from classes c where c.id = any(coalesce(p_classes, '{}')) and c.org_id = v_org and c.grade = d.grade;
    for it in select i.*, p.title as ptitle, p.main_subject, p.kind as pkind from dist_plan_items i join edu_programs p on p.id = i.program_id
               where i.plan_id = d.id order by i.seq loop
      if exists (select 1 from curriculum_books b where b.org_id = v_org and b.dist_plan_id = d.id and b.program_id = it.program_id
                   and b.year_name is not distinct from v_year) then
        ns := ns + 1; continue;
      end if;
      insert into edu_program_assignments (program_id, org_id, grades, note)
      values (it.program_id, v_org, array[d.grade], 'Gán theo bản phân phối ' || d.code)
      on conflict (program_id, org_id) do update
        set grades = case when edu_program_assignments.grades is null then null
                          else (select array_agg(distinct x order by x) from unnest(edu_program_assignments.grades || d.grade) x) end;
      insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, program_id, dist_plan_id, note)
      values (v_org, d.grade, it.main_subject, left(it.ptitle || ' — ' || d.code, 200), v_year, it.ppw, 'draft', 'own', it.program_id, d.id,
              'Tạo từ bản phân phối ' || d.code || ' "' || d.title || '"')
      returning id into v_book;
      perform set_config('app.ppct_import', 'on', true);
      insert into curriculum_lessons (book_id, seq, week, title, kind, unit_id, note)
      select v_book, row_number() over (order by x.wk, x.seq, x.k), x.wk, x.title, x.kind, x.unit_id, x.note
        from (select r.seq, k, r.unit_id,
                     least(60, coalesce(r.weeks[k], r.week + floor((k - 1) / it.ppw)::int)) as wk,
                     u.title || case when k > 1 then ' (tiếp)' else '' end as title,
                     case when u.title ilike 'Kiểm tra%' then 'test' when u.title ilike 'Ôn tập%' then 'review'
                          when it.pkind = 'stem' then 'stem' else 'lesson' end as kind,
                     case when k = 1 then r.note end as note
                from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
                cross join lateral generate_series(1, r.periods) k
               where r.plan_id = d.id and r.program_id = it.program_id and not r.skipped and r.periods > 0) x;
      perform set_config('app.ppct_import', 'off', true);
      if v_cls is not null then
        insert into curriculum_book_classes (book_id, class_id, org_id) select v_book, x, v_org from unnest(v_cls) x on conflict do nothing;
      end if;
      nb := nb + 1;
    end loop;
  end loop;
  return jsonb_build_object('books', nb, 'skipped', ns);
end $$;
revoke all on function public.dist_plan_assign(uuid, uuid[], text, uuid[]) from public, anon;
grant execute on function public.dist_plan_assign(uuid, uuid[], text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
