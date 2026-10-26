-- 097. Tập huấn đợt A (kế hoạch phần 1 của anh Luân, 26/10):
--  • Chương trình tập huấn thêm: mục tiêu, điều kiện tham gia, yêu cầu đầu ra (chữ), chương trình tiên quyết (prereq_families:
--    họ phiên bản, phiên bản nào của chương trình đó cũng tính). Khoá như các trường khác khi đã gửi duyệt / phát hành.
--    Kiểm tra tiên quyết khi giáo viên đăng ký làm ở đợt B.
--  • Kế hoạch chọn toàn bộ hoặc một phần nội dung của từng chương trình: training_plan_items.units (null = toàn bộ).
--    Xếp lịch, học trực tuyến, điều kiện hoàn thành, kết quả, giám sát đều đi qua training_plan_units → chỉ tính nội dung đã chọn.
--  • Gán kế hoạch cho trường → thông báo cho người phụ trách tập huấn của trường.
-- Cần chạy sau 096.

alter table training_programs add column if not exists objectives text check (objectives is null or length(objectives) <= 4000);
alter table training_programs add column if not exists entry_conditions text check (entry_conditions is null or length(entry_conditions) <= 2000);
alter table training_programs add column if not exists outcomes text check (outcomes is null or length(outcomes) <= 4000);
alter table training_programs add column if not exists prereq_families uuid[] not null default '{}';
alter table training_programs drop constraint if exists training_programs_prereq_check;
alter table training_programs add constraint training_programs_prereq_check check (cardinality(prereq_families) <= 20);

alter table training_plan_items add column if not exists units uuid[];
alter table training_plan_items drop constraint if exists training_plan_items_units_check;
alter table training_plan_items add constraint training_plan_items_units_check check (units is null or cardinality(units) between 1 and 500);

-- ===== Chương trình =====
create or replace function public.training_programs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.title := btrim(new.title); new.updated_at := now();
  new.code := nullif(btrim(new.code), '');
  new.objectives := nullif(btrim(new.objectives), ''); new.entry_conditions := nullif(btrim(new.entry_conditions), '');
  new.outcomes := nullif(btrim(new.outcomes), '');
  new.prereq_families := coalesce(array(select distinct x from unnest(coalesce(new.prereq_families, '{}')) x where x is not null order by x), '{}');
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Chương trình tập huấn mới phải là bản nháp' using errcode = '22023'; end if;
    new.family_id := coalesce(new.family_id, new.id);
    if new.code is null then
      select 'CTTH-' || lpad((coalesce(max(substring(code from '^CTTH-(\d+)$')::int), 0) + 1)::text, 3, '0') into new.code
        from training_programs where org_id = new.org_id;
    end if;
  else
    if new.org_id <> old.org_id then raise exception 'Không đổi đơn vị của chương trình tập huấn' using errcode = '22023'; end if;
    new.family_id := old.family_id;
    if old.status not in ('draft', 'rejected')
       and (new.code, new.title, new.ct_code, new.level, new.ct_codes, new.levels, new.audience, new.mode, new.description, new.competencies,
            new.target_level, new.pass_attendance, new.pass_score, new.need_product, new.version_no,
            new.objectives, new.entry_conditions, new.outcomes, new.prereq_families)
           is distinct from (old.code, old.title, old.ct_code, old.level, old.ct_codes, old.levels, old.audience, old.mode, old.description, old.competencies,
            old.target_level, old.pass_attendance, old.pass_score, old.need_product, old.version_no,
            old.objectives, old.entry_conditions, old.outcomes, old.prereq_families) then
      raise exception 'Chương trình tập huấn đã gửi duyệt / phát hành: tạo phiên bản mới để sửa' using errcode = '22023';
    end if;
  end if;
  if new.family_id = any(new.prereq_families) then
    raise exception 'Chương trình không thể là tiên quyết của chính nó' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.prereq_families) x where not exists (select 1 from training_programs t where t.family_id = x)) then
    raise exception 'Chương trình tiên quyết không tồn tại' using errcode = '22023';
  end if;
  if exists (select 1 from training_programs t where t.org_id = new.org_id and t.code = new.code and t.family_id <> new.family_id) then
    raise exception 'Mã % đã dùng cho chương trình tập huấn khác', new.code using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and new.status = 'published' and old.status <> 'published' then
    if not exists (select 1 from training_program_units where program_id = new.id and kind = 'content') then
      raise exception 'Chưa phát hành được: chương trình chưa có nội dung tập huấn nào' using errcode = '22023';
    end if;
    if new.pass_score is not null and not exists (select 1 from training_program_units where program_id = new.id and has_test) then
      raise exception 'Chưa phát hành được: có điều kiện điểm bài test nhưng chưa nội dung nào có bài test' using errcode = '22023';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;

create or replace function public.training_program_clone(p_src uuid, p_family uuid, p_version int, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new uuid := gen_random_uuid(); v_src training_programs; m record; v_mod uuid;
begin
  select * into v_src from training_programs where id = p_src;
  if v_src.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  insert into training_programs (id, org_id, family_id, code, title, ct_code, level, ct_codes, levels, audience, mode, description, competencies, target_level,
    pass_attendance, pass_score, need_product, cert_template_id, version_no, source_id, objectives, entry_conditions, outcomes, prereq_families)
  values (v_new, public.my_org_id(), coalesce(p_family, v_new), p_code, v_src.title, v_src.ct_code, v_src.level, v_src.ct_codes, v_src.levels, v_src.audience,
    v_src.mode, v_src.description, v_src.competencies, v_src.target_level, v_src.pass_attendance, v_src.pass_score, v_src.need_product,
    v_src.cert_template_id, p_version, p_src, v_src.objectives, v_src.entry_conditions, v_src.outcomes, v_src.prereq_families);
  for m in select * from training_program_units where program_id = p_src and kind = 'subject' order by seq loop
    insert into training_program_units (program_id, kind, seq, title, hours, mode, note)
      values (v_new, 'subject', m.seq, m.title, m.hours, m.mode, m.note) returning id into v_mod;
    insert into training_program_units (program_id, parent_id, kind, seq, title, hours, mode, has_test, note, detail)
      select v_new, v_mod, 'content', u.seq, u.title, u.hours, u.mode, u.has_test, u.note, u.detail
        from training_program_units u where u.parent_id = m.id;
  end loop;
  return v_new;
end $$;
revoke all on function public.training_program_clone(uuid, uuid, int, text) from public, anon, authenticated;

-- ===== Kế hoạch: nội dung chọn =====
create or replace function public.training_plan_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_st text;
begin
  select pub_status into v_st from training_plans where id = r.plan_id;
  if v_st is null then return coalesce(new, old); end if;      -- xoá theo dây chuyền
  if v_st <> 'draft' then raise exception 'Kế hoạch đã phát hành: chuyển về nháp để sửa' using errcode = '22023'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if (tg_op = 'INSERT' or new.program_id <> old.program_id)
     and not exists (select 1 from training_programs t where t.id = new.program_id and t.status = 'published') then
    raise exception 'Chỉ chọn chương trình tập huấn đã phát hành' using errcode = '22023';
  end if;
  new.trainer := nullif(btrim(new.trainer), ''); new.note := nullif(btrim(new.note), '');
  -- Nội dung chọn: null = toàn bộ chương trình. Bỏ trùng, giữ thứ tự chương trình; chọn đủ mọi nội dung thì lưu null.
  if new.units is not null then
    if exists (select 1 from unnest(new.units) x where not exists (select 1 from training_program_units u
                 where u.id = x and u.program_id = new.program_id and u.kind = 'content')) then
      raise exception 'Nội dung chọn không thuộc chương trình tập huấn' using errcode = '22023';
    end if;
    new.units := array(select u.id from training_program_units u join training_program_units sj on sj.id = u.parent_id
                        where u.id = any(new.units) order by sj.seq, u.seq);
    if cardinality(new.units) = 0 then raise exception 'Chọn ít nhất một nội dung tập huấn' using errcode = '22023'; end if;
    if not exists (select 1 from training_program_units u where u.program_id = new.program_id and u.kind = 'content' and not (u.id = any(new.units))) then
      new.units := null;
    end if;
  end if;
  return new;
end $$;

create or replace function public.training_plan_units(p_plan uuid)
returns table (unit_id uuid, ord int, subject text, title text, hours numeric, mode text, has_test boolean, detail jsonb, program_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id, (row_number() over (order by i.seq, sj.seq, u.seq))::int, sj.title, u.title, u.hours, u.mode, u.has_test, u.detail, u.program_id
    from training_plan_items i
    join training_program_units sj on sj.program_id = i.program_id and sj.kind = 'subject'
    join training_program_units u on u.parent_id = sj.id and u.kind = 'content'
   where i.plan_id = p_plan and (i.units is null or u.id = any(i.units))
   order by i.seq, sj.seq, u.seq
$$;

create or replace function public.training_sessions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pub text;
begin
  new.title := btrim(new.title); new.trainer := nullif(btrim(new.trainer), ''); new.note := nullif(btrim(new.note), '');
  new.location := nullif(btrim(new.location), ''); new.meeting_url := nullif(btrim(new.meeting_url), '');
  if new.ends_at <= new.starts_at then raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '22023'; end if;
  if tg_op = 'INSERT' or new.plan_id <> old.plan_id then
    select pub_status into v_pub from training_plans where id = new.plan_id;
    if v_pub = 'draft' then raise exception 'Kế hoạch còn nháp: phát hành trước khi xếp lịch' using errcode = '22023'; end if;
  end if;
  if new.unit_id is not null and (tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id or new.plan_id <> old.plan_id)
     and not exists (select 1 from training_program_units u join training_plan_items i on i.program_id = u.program_id
                      where u.id = new.unit_id and u.kind = 'content' and i.plan_id = new.plan_id and (i.units is null or u.id = any(i.units))) then
    raise exception 'Nội dung tập huấn không thuộc chương trình của kế hoạch (hoặc không được chọn trong kế hoạch)' using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function public.training_plan_schedule(p_plan uuid, p_start date, p_time time default '08:00',
  p_hours_per_day numeric default 4, p_skip_weekend boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare p training_plans; r record; d date := p_start; used numeric := 0; h numeric; n int := 0; v_mode text; v_start timestamptz;
begin
  select * into p from training_plans where id = p_plan;
  if p.id is null or not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không xếp lịch được kế hoạch này' using errcode = '42501'; end if;
  if p.pub_status <> 'published' then raise exception 'Chỉ xếp lịch cho kế hoạch đã phát hành' using errcode = '22023'; end if;
  if p_start is null or p_hours_per_day is null or p_hours_per_day <= 0 or p_hours_per_day > 12 then
    raise exception 'Ngày bắt đầu hoặc số giờ mỗi ngày không hợp lệ' using errcode = '22023';
  end if;
  for r in select u.id, u.title, u.hours, u.mode, i.trainer
             from training_plan_items i
             join training_program_units sj on sj.program_id = i.program_id and sj.kind = 'subject'
             join training_program_units u on u.parent_id = sj.id and u.kind = 'content'
            where i.plan_id = p_plan and (i.units is null or u.id = any(i.units))
              and not exists (select 1 from training_sessions s where s.plan_id = p_plan and s.unit_id = u.id)
            order by i.seq, sj.seq, u.seq loop
    h := least(greatest(coalesce(r.hours, 0), 0.5), 12);
    if used > 0 and used + h > p_hours_per_day then d := d + 1; used := 0; end if;
    while p_skip_weekend and extract(isodow from d) in (6, 7) loop d := d + 1; end loop;
    v_mode := coalesce(r.mode, case when p.mode in ('online', 'offline') then p.mode else 'offline' end);
    v_start := ((d + p_time)::timestamp + make_interval(mins => (used * 60)::int)) at time zone 'Asia/Ho_Chi_Minh';
    insert into training_sessions (org_id, plan_id, unit_id, title, starts_at, ends_at, mode, trainer)
    values (p.org_id, p_plan, r.id, r.title, v_start, v_start + make_interval(mins => (h * 60)::int), v_mode, r.trainer);
    used := used + h; n := n + 1;
  end loop;
  return n;
end $$;

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
      from training_plan_items i join training_program_units u on u.program_id = i.program_id and u.kind = 'content' where i.plan_id = new.id and (i.units is null or u.id = any(i.units));
    new.published_at := now();
  end if;
  return new;
end $$;

-- ===== Thông báo khi gán kế hoạch cho trường =====
create or replace function public.notify_training_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
declare p training_plans;
begin
  select * into p from training_plans where id = new.plan_id;
  if p.id is null then return new; end if;
  perform public.notify_staff(new.org_id, 'training', 'training_assigned',
    left('Kế hoạch tập huấn mới: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
    'Trường được gán kế hoạch tập huấn' || case when new.quota is not null then ', chỉ tiêu ' || new.quota || ' giáo viên' else '' end
      || coalesce(', từ ' || to_char(p.starts_on, 'DD/MM/YYYY'), '') || '. Chọn giáo viên tham gia rồi gửi danh sách.',
    'Kế hoạch tập huấn', new.plan_id);
  return new;
end $$;
revoke all on function public.notify_training_assigned() from public, anon, authenticated;
drop trigger if exists notify_training_assigned on training_plan_orgs;
create trigger notify_training_assigned after insert on training_plan_orgs for each row execute function public.notify_training_assigned();

notify pgrst, 'reload schema';
