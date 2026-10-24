-- 083. Phân hệ 1 — Chương trình tập huấn (đợt 1)
--  Mẫu khoá tập huấn chuẩn của KDI, dùng lại cho nhiều kế hoạch tập huấn (giống Chương trình giáo dục ở Phân hệ 2).
--  • training_programs: mã CTTH-xxx, tên, loại chương trình (CT1–CT5), cấp học, đối tượng, hình thức, mô tả,
--    năng lực đích (khung năng lực giáo viên 042) + mức cần đạt, điều kiện đạt (chuyên cần, điểm bài test, sản phẩm).
--    Nháp → Đã phát hành → Ngừng dùng; bản đã phát hành không sửa nội dung, nhân bản để sửa.
--  • training_program_units: 3 cấp Chương trình tập huấn → Môn → Nội dung tập huấn (số giờ, hình thức, có bài test).
--    Mỗi nội dung có 5 phần như bài học: Nội dung, Bài giảng, Link tài liệu, Định mức vật tư, Kho hoạt động (cột detail).
--  Chỉ quản trị nền tảng KDI soạn; mọi đơn vị xem bản đã phát hành.

create table if not exists training_programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade default public.my_org_id(),
  code text,
  title text not null check (length(btrim(title)) between 1 and 200),
  ct_code text,
  level text references edu_levels(code),
  audience text check (audience is null or length(audience) <= 200),
  mode text not null default 'hybrid' check (mode in ('online', 'offline', 'hybrid')),
  description text check (description is null or length(description) <= 4000),
  competencies text[] not null default '{}',
  target_level int not null default 3 check (target_level between 1 and 4),
  pass_attendance int not null default 80 check (pass_attendance between 0 and 100),
  pass_score numeric(4,1) check (pass_score is null or pass_score between 0 and 10),
  need_product boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version_no int not null default 1 check (version_no >= 1),
  source_id uuid references training_programs(id) on delete set null,
  published_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create table if not exists training_program_units (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references training_programs(id) on delete cascade,
  parent_id uuid references training_program_units(id) on delete cascade,
  kind text not null check (kind in ('subject', 'content')),
  seq int not null default 1 check (seq between 1 and 999),
  title text not null check (length(btrim(title)) between 1 and 200),
  hours numeric(5,1) not null default 0 check (hours between 0 and 500),
  mode text check (mode is null or mode in ('online', 'offline')),
  has_test boolean not null default false,
  note text check (note is null or length(note) <= 1000),
  -- Nội dung tập huấn có 5 phần như bài học: { body: {goal, text, reqs[]}, lectures[], docs[], mats[], acts[] }
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) < 200000)
);
create index if not exists training_program_units_prog on training_program_units (program_id, seq);

-- Mã CTTH-xxx, chuẩn hoá, kiểm tra khi phát hành, khoá bản đã phát hành
create or replace function public.training_programs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.title := btrim(new.title); new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Chương trình tập huấn mới phải là bản nháp' using errcode = '22023'; end if;
    if new.code is null or btrim(new.code) = '' then
      select 'CTTH-' || lpad((coalesce(max(substring(code from '^CTTH-(\d+)$')::int), 0) + 1)::text, 3, '0') into new.code
        from training_programs where org_id = new.org_id;
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id then raise exception 'Không đổi đơn vị của chương trình tập huấn' using errcode = '22023'; end if;
  if old.status = 'published' and new.status = 'published'
     and (new.code, new.title, new.ct_code, new.level, new.audience, new.mode, new.description, new.competencies, new.target_level,
          new.pass_attendance, new.pass_score, new.need_product)
         is distinct from (old.code, old.title, old.ct_code, old.level, old.audience, old.mode, old.description, old.competencies, old.target_level,
          old.pass_attendance, old.pass_score, old.need_product) then
    raise exception 'Chương trình tập huấn đã phát hành: nhân bản để sửa' using errcode = '22023';
  end if;
  if new.status = 'published' and old.status <> 'published' then
    if not exists (select 1 from training_program_units where program_id = new.id and kind = 'content') then
      raise exception 'Chưa phát hành được: chương trình chưa có nội dung tập huấn nào' using errcode = '22023';
    end if;
    if new.pass_score is not null and not exists (select 1 from training_program_units where program_id = new.id and has_test) then
      raise exception 'Chưa phát hành được: có điều kiện điểm bài test nhưng chưa nội dung nào có bài test' using errcode = '22023';
    end if;
    new.published_at := now();
  end if;
  return new;
end $$;
drop trigger if exists training_programs_guard on training_programs;
create trigger training_programs_guard before insert or update on training_programs for each row execute function public.training_programs_guard();

-- Môn / nội dung chỉ sửa khi chương trình còn nháp; nội dung phải thuộc một môn của cùng chương trình
create or replace function public.training_units_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prog uuid := coalesce(new.program_id, old.program_id); v_st text;
begin
  select status into v_st from training_programs where id = v_prog;
  if v_st is not null and v_st <> 'draft' then
    raise exception 'Chương trình tập huấn đã phát hành: nhân bản để sửa' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.title := btrim(new.title);
  if new.kind = 'content' and not exists (select 1 from training_program_units p where p.id = new.parent_id and p.program_id = new.program_id and p.kind = 'subject') then
    raise exception 'Nội dung tập huấn phải nằm trong một môn của chương trình' using errcode = '22023';
  end if;
  if new.kind = 'subject' then new.parent_id := null; new.has_test := false; end if;
  return new;
end $$;
drop trigger if exists training_units_guard on training_program_units;
create trigger training_units_guard before insert or update or delete on training_program_units for each row execute function public.training_units_guard();

-- Nhân bản thành bản nháp mới (version + 1)
create or replace function public.training_program_copy(p_program uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_new uuid; v_src training_programs; m record; v_mod uuid;
begin
  select * into v_src from training_programs where id = p_program;
  if v_src.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  insert into training_programs (org_id, title, ct_code, level, audience, mode, description, competencies, target_level,
    pass_attendance, pass_score, need_product, version_no, source_id)
  values (public.my_org_id(), v_src.title, v_src.ct_code, v_src.level, v_src.audience, v_src.mode, v_src.description, v_src.competencies,
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
revoke all on function public.training_program_copy(uuid) from public, anon;
grant execute on function public.training_program_copy(uuid) to authenticated;

alter table training_programs enable row level security;
alter table training_program_units enable row level security;
drop policy if exists training_programs_read on training_programs;
create policy training_programs_read on training_programs for select to authenticated
  using (status = 'published' or org_id = public.my_org_id() or public.is_platform_admin());
drop policy if exists training_programs_write on training_programs;
create policy training_programs_write on training_programs for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists training_units_read on training_program_units;
create policy training_units_read on training_program_units for select to authenticated
  using (exists (select 1 from training_programs p where p.id = program_id));
drop policy if exists training_units_write on training_program_units;
create policy training_units_write on training_program_units for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on training_programs, training_program_units to authenticated;
