-- 090. Chương trình tập huấn: chọn nhiều loại chương trình (CT1–CT5) và nhiều cấp học.
--  • Thêm ct_codes / levels (mảng). Cột đơn cũ ct_code / level giữ làm giá trị chính = phần tử đầu (để trống mảng = không chọn / mọi cấp học).
--  • Trigger đồng bộ hai chiều như 089; khoá mảng khi chương trình đã phát hành.
--  • Nhân bản chép cả hai mảng; tóm tắt loại chương trình của kế hoạch tập huấn lấy mọi loại.
-- Cần chạy sau 089.

alter table training_programs add column if not exists ct_codes text[] not null default '{}';
alter table training_programs add column if not exists levels text[] not null default '{}';

alter table training_programs disable trigger training_programs_guard;
update training_programs set ct_codes = array[ct_code] where ct_codes = '{}' and ct_code is not null;
update training_programs set levels = array[level] where levels = '{}' and level is not null;
alter table training_programs enable trigger training_programs_guard;

create or replace function public.training_programs_multi_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  new.ct_codes := public.text_array_clean(new.ct_codes);
  new.levels := public.text_array_clean(new.levels);
  if tg_op = 'INSERT' then
    if cardinality(new.ct_codes) > 0 then new.ct_code := new.ct_codes[1]; elsif new.ct_code is not null then new.ct_codes := array[new.ct_code]; end if;
    if cardinality(new.levels) > 0 then new.level := new.levels[1]; elsif new.level is not null then new.levels := array[new.level]; end if;
  else
    if old.status = 'published' and new.status = 'published' and (new.ct_codes, new.levels) is distinct from (old.ct_codes, old.levels) then
      raise exception 'Chương trình tập huấn đã phát hành: nhân bản để sửa' using errcode = '22023';
    end if;
    if new.ct_codes is distinct from old.ct_codes then new.ct_code := new.ct_codes[1];
    elsif new.ct_code is distinct from old.ct_code then
      new.ct_codes := case when new.ct_code is null then '{}' else array_prepend(new.ct_code, array_remove(array_remove(new.ct_codes, old.ct_code), new.ct_code)) end;
    end if;
    if new.levels is distinct from old.levels then new.level := new.levels[1];
    elsif new.level is distinct from old.level then
      new.levels := case when new.level is null then '{}' else array_prepend(new.level, array_remove(array_remove(new.levels, old.level), new.level)) end;
    end if;
  end if;
  select string_agg(c, ', ') into bad from unnest(new.ct_codes) c
   where not exists (select 1 from stem_tracks t where t.code = c) and (tg_op = 'INSERT' or not c = any(old.ct_codes));
  if bad is not null then raise exception 'Loại chương trình không có trong danh mục: %', bad using errcode = '22023'; end if;
  select string_agg(c, ', ') into bad from unnest(new.levels) c
   where not exists (select 1 from edu_levels l where l.code = c) and (tg_op = 'INSERT' or not c = any(old.levels));
  if bad is not null then raise exception 'Cấp học không có trong danh mục: %', bad using errcode = '22023'; end if;
  return new;
end $$;
-- Tên bắt đầu "training_programs_a" để chạy trước training_programs_guard
drop trigger if exists training_programs_a_multi_sync on training_programs;
create trigger training_programs_a_multi_sync before insert or update on training_programs for each row execute function public.training_programs_multi_sync();
revoke all on function public.training_programs_multi_sync() from public, anon, authenticated;

-- Nhân bản chép cả loại chương trình và cấp học
create or replace function public.training_program_copy(p_program uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_new uuid; v_src training_programs; m record; v_mod uuid;
begin
  select * into v_src from training_programs where id = p_program;
  if v_src.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  insert into training_programs (org_id, title, ct_code, level, ct_codes, levels, audience, mode, description, competencies, target_level,
    pass_attendance, pass_score, need_product, version_no, source_id)
  values (public.my_org_id(), v_src.title, v_src.ct_code, v_src.level, v_src.ct_codes, v_src.levels, v_src.audience, v_src.mode, v_src.description, v_src.competencies,
    v_src.target_level, v_src.pass_attendance, v_src.pass_score, v_src.need_product,
    (select coalesce(max(version_no), 0) + 1 from training_programs where id = p_program or source_id = p_program), p_program)
  returning id into v_new;
  for m in select * from training_program_units where program_id = p_program and kind = 'subject' order by seq loop
    insert into training_program_units (program_id, kind, seq, title, hours, mode, note)
      values (v_new, 'subject', m.seq, m.title, m.hours, m.mode, m.note) returning id into v_mod;
    insert into training_program_units (program_id, parent_id, kind, seq, title, hours, mode, has_test, note, detail)
      select v_new, v_mod, 'content', u.seq, u.title, u.hours, u.mode, u.has_test, u.note, u.detail
        from training_program_units u where u.parent_id = m.id;
  end loop;
  return v_new;
end $$;

-- Kế hoạch tập huấn: tóm tắt mọi loại chương trình của các chương trình trong kế hoạch
create or replace function public.training_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from training_plan_orgs where plan_id = old.id) then
      raise exception 'Kế hoạch đã gán cho trường: bỏ gán hết trường hoặc chuyển sang Ngừng dùng' using errcode = '22023';
    end if;
    return old;
  end if;
  new.name := btrim(new.name); new.updated_at := now();
  new.year_name := nullif(btrim(new.year_name), ''); new.note := nullif(btrim(new.note), '');
  if tg_op = 'INSERT' then
    if new.plan_code is null or btrim(new.plan_code) = '' then
      select 'KHTH-' || lpad((coalesce(max(substring(plan_code from '^KHTH-(\d+)$')::int), 0) + 1)::text, 3, '0') into new.plan_code
        from training_plans where org_id = new.org_id;
    end if;
    if new.pub_status = 'published' then new.published_at := now(); end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.plan_code is distinct from old.plan_code then
    raise exception 'Không đổi đơn vị hoặc mã của kế hoạch tập huấn' using errcode = '22023';
  end if;
  if old.pub_status <> 'draft' and new.pub_status <> 'draft'
     and (new.name, new.year_name, new.term, new.mode, new.provider, new.starts_on, new.ends_on, new.budget)
         is distinct from (old.name, old.year_name, old.term, old.mode, old.provider, old.starts_on, old.ends_on, old.budget) then
    raise exception 'Kế hoạch đã phát hành: chuyển về nháp để sửa' using errcode = '22023';
  end if;
  if new.pub_status = 'draft' and old.pub_status <> 'draft' and exists (select 1 from training_plan_orgs where plan_id = new.id) then
    raise exception 'Kế hoạch đã gán cho trường nên không chuyển về nháp được' using errcode = '22023';
  end if;
  if new.pub_status = 'published' and old.pub_status = 'draft' then
    v_err := public.training_plan_errors(new.id);
    if v_err is not null then raise exception 'Chưa phát hành được: %', v_err using errcode = '22023'; end if;
    -- Tóm tắt cho các trang cũ: loại chương trình (CT1–CT5) và tổng số giờ
    select string_agg(distinct c, ',' order by c) into new.program
      from training_plan_items i join training_programs t on t.id = i.program_id
      cross join lateral unnest(coalesce(nullif(t.ct_codes, '{}'), array[t.ct_code])) c
     where i.plan_id = new.id and c is not null;
    new.code := new.program;
    select round(coalesce(sum(u.hours), 0))::int into new.hours
      from training_plan_items i join training_program_units u on u.program_id = i.program_id and u.kind = 'content' where i.plan_id = new.id;
    new.published_at := now();
  end if;
  return new;
end $$;
drop trigger if exists training_plans_guard on training_plans;
create trigger training_plans_guard before insert or update or delete on training_plans for each row execute function public.training_plans_guard();
