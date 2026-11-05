-- 134: Gán bản phân phối cho trường và áp dụng luôn.
-- dist_plan_assign thêm tham số p_publish (mặc định false, giữ nguyên cách cũ: tạo PPCT nháp).
-- p_publish = true: PPCT tạo ra được ban hành ngay (trạng thái "Đang dùng"); PPCT nháp đã có từ lần gán trước cũng được ban hành.
-- Trường gọi với p_publish = true bị chặn (PPCT của trường vẫn đi qua gửi duyệt).
-- Hàm chạy security definer nên Sở / Phòng áp dụng được cho trường trực thuộc (RLS không cho Sở sửa PPCT của trường).

drop function if exists public.dist_plan_assign(uuid, uuid[], text, uuid[]);

create or replace function public.dist_plan_assign(p_plan uuid, p_orgs uuid[], p_year text default null, p_classes uuid[] default null, p_publish boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare d dist_plans; v_org uuid; it record; v_year text; v_book uuid; nb int := 0; ns int := 0; np int := 0; v_cls uuid[];
begin
  select * into d from dist_plans where id = p_plan;
  if d.id is null or not public.dist_plan_visible(p_plan) then raise exception 'Không tìm thấy bản phân phối' using errcode = '42501'; end if;
  if d.status <> 'published' then raise exception 'Chỉ gán được bản phân phối đã phát hành' using errcode = '22023'; end if;
  if not (public.curriculum_can_write(public.my_org_id(), 'edit') or public.is_platform_admin()) then
    raise exception 'Bạn không gán được bản phân phối' using errcode = '42501';
  end if;
  -- 134: trường tự gán cho mình vẫn phải gửi duyệt PPCT như thường lệ; chỉ cấp trên / quản trị nền tảng áp dụng thẳng
  if p_publish and not public.is_platform_admin()
     and exists (select 1 from organizations o where o.id = public.my_org_id() and o.type = 'school') then
    raise exception 'Trường không áp dụng thẳng được, hãy gửi duyệt PPCT' using errcode = '42501';
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
        ns := ns + 1;
        -- 134: "Gán và áp dụng": PPCT nháp đã có từ lần gán trước cũng được ban hành
        if p_publish then
          update curriculum_books b set status = 'published'
           where b.org_id = v_org and b.dist_plan_id = d.id and b.program_id = it.program_id
             and b.year_name is not distinct from v_year and b.status = 'draft';
          if found then np := np + 1; end if;
        end if;
        continue;
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
      -- 134: ban hành sau khi đã có đủ tiết, để bản lưu phiên bản lúc ban hành có các tiết
      if p_publish then update curriculum_books set status = 'published' where id = v_book; np := np + 1; end if;
      nb := nb + 1;
    end loop;
  end loop;
  return jsonb_build_object('books', nb, 'skipped', ns, 'published', np);
end $$;
revoke all on function public.dist_plan_assign(uuid, uuid[], text, uuid[], boolean) from public, anon;
grant execute on function public.dist_plan_assign(uuid, uuid[], text, uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
