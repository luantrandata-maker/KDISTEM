-- 078. Phân phối chương trình — Bản phân phối (Phân hệ 2, đợt 5)
--  • dist_tiers: danh mục mức độ (Cơ bản / Tiêu chuẩn / Nâng cao…), KDI sửa ở Chương trình giáo dục › Danh mục.
--  • dist_plans: bản phân phối = mẫu ghép nhiều chương trình đã phát hành lên trục tuần, nằm ở một nhánh
--    Cấp học › Khối › Mức độ. Mã tự sinh PB-001, PB-002… theo đơn vị.
--    dist_plan_items: các chương trình trong bản + cách xếp (bắt đầu đầu HK I / đầu HK II / tuần cụ thể / sau chương trình khác, nhịp tiết/tuần).
--    dist_plan_rows: lịch từng bài (tuần, số tiết, ghi chú, đặt tay, bỏ bài) — trình soạn tính, lưu lại để gán.
--  • Phát hành bị chặn khi còn lỗi: chưa có bài, bài chưa có tuần / ngoài khung học kỳ, chương trình chưa phát hành
--    hoặc không dạy khối của bản. Bản đã phát hành khoá nội dung (chuyển về nháp để sửa); PPCT đã gán không bị ảnh hưởng.
--  • dist_plan_copy(): nhân bản. dist_plan_assign(): gán bản đã phát hành cho trường → mỗi chương trình một PPCT nháp
--    của trường (curriculum_books.dist_plan_id), tiết theo tuần của bản, gắn lớp nếu chọn; gán chương trình cho trường.
-- Cần chạy sau 077.

-- ===== 1. Mức độ =====
create table if not exists dist_tiers (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,19}$'),
  name text not null check (length(btrim(name)) between 1 and 60),
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into dist_tiers (code, name, sort) values ('co_ban', 'Cơ bản', 1), ('tieu_chuan', 'Tiêu chuẩn', 2), ('nang_cao', 'Nâng cao', 3)
on conflict (code) do nothing;

create or replace function public.dist_tiers_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.code <> old.code then raise exception 'Không đổi mã mức độ sau khi tạo' using errcode = '22023'; end if;
  new.name := btrim(new.name); new.updated_at := now();
  return new;
end $$;
drop trigger if exists dist_tiers_guard on dist_tiers;
create trigger dist_tiers_guard before insert or update on dist_tiers for each row execute function public.dist_tiers_guard();

alter table dist_tiers enable row level security;
drop policy if exists dist_tiers_read on dist_tiers;
create policy dist_tiers_read on dist_tiers for select to authenticated using (true);
drop policy if exists dist_tiers_write on dist_tiers;
create policy dist_tiers_write on dist_tiers for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on dist_tiers to authenticated;

-- ===== 2. Bản phân phối =====
create table if not exists dist_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade default public.my_org_id(),
  code text,
  title text not null check (length(btrim(title)) between 1 and 200),
  level text not null references edu_levels(code),
  grade int not null check (grade between 1 and 12),
  tier text references dist_tiers(code),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  hk1_weeks int not null default 18 check (hk1_weeks between 1 and 30),
  hk2_weeks int not null default 17 check (hk2_weeks between 0 and 30),
  note text check (note is null or length(note) <= 2000),
  source_id uuid references dist_plans(id) on delete set null,
  published_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create index if not exists dist_plans_branch on dist_plans (level, grade, tier);

create table if not exists dist_plan_items (
  plan_id uuid not null references dist_plans(id) on delete cascade,
  program_id uuid not null references edu_programs(id) on delete restrict,
  seq int not null default 1 check (seq between 1 and 99),
  start_mode text not null default 'hk1' check (start_mode in ('hk1', 'hk2', 'week', 'after')),
  start_week int check (start_week between 1 and 60),
  after_program uuid references edu_programs(id) on delete set null,
  ppw numeric(4,1) not null default 1 check (ppw > 0 and ppw <= 40),
  primary key (plan_id, program_id)
);

create table if not exists dist_plan_rows (
  plan_id uuid not null references dist_plans(id) on delete cascade,
  program_id uuid not null references edu_programs(id) on delete cascade,
  unit_id uuid not null references edu_program_units(id) on delete cascade,
  seq int not null check (seq between 1 and 9999),
  week int check (week between 1 and 60),
  periods int not null default 1 check (periods between 0 and 50),
  note text check (note is null or length(note) <= 500),
  manual boolean not null default false,       -- tuần sửa tay
  skipped boolean not null default false,      -- bỏ bài khỏi bản
  primary key (plan_id, unit_id)
);
create index if not exists dist_plan_rows_order on dist_plan_rows (plan_id, seq);

-- Mã PB-xxx, chuẩn hoá, kiểm tra khi phát hành, khoá bản đã phát hành
create or replace function public.dist_plans_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_err text;
begin
  new.title := btrim(new.title); new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Bản phân phối mới phải là bản nháp' using errcode = '22023'; end if;
    if new.code is null or btrim(new.code) = '' then
      select 'PB-' || lpad((coalesce(max(substring(code from '^PB-(\d+)$')::int), 0) + 1)::text, 3, '0') into new.code
        from dist_plans where org_id = new.org_id;
    end if;
  else
    if new.org_id <> old.org_id then raise exception 'Không đổi đơn vị của bản phân phối' using errcode = '22023'; end if;
    if old.status = 'published' and new.status = 'published'
       and (new.title, new.level, new.grade, new.tier, new.hk1_weeks, new.hk2_weeks, new.code)
           is distinct from (old.title, old.level, old.grade, old.tier, old.hk1_weeks, old.hk2_weeks, old.code) then
      raise exception 'Bản phân phối đã phát hành: chuyển về nháp hoặc nhân bản để sửa' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from edu_levels l where l.code = new.level and new.grade between l.grade_from and l.grade_to) then
    raise exception 'Khối % không thuộc cấp học đã chọn', new.grade using errcode = '22023';
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    v_err := public.dist_plan_errors(new.id, new.grade, new.hk1_weeks + new.hk2_weeks);
    if v_err is not null then raise exception 'Chưa phát hành được: %', v_err using errcode = '22023'; end if;
    new.published_at := now();
  end if;
  return new;
end $$;

-- Lỗi chặn phát hành (null = không lỗi)
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
    (select 'bài "' || u.title || '" xếp ở tuần ' || r.week || ', ngoài khung ' || p_weeks || ' tuần' from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
      where r.plan_id = p_plan and not r.skipped and r.week > p_weeks order by r.seq limit 1))
$$;
revoke all on function public.dist_plan_errors(uuid, int, int) from public, anon;
grant execute on function public.dist_plan_errors(uuid, int, int) to authenticated;

drop trigger if exists dist_plans_guard on dist_plans;
create trigger dist_plans_guard before insert or update on dist_plans for each row execute function public.dist_plans_guard();

-- Chương trình / lịch bài chỉ sửa khi bản còn nháp; bài phải thuộc chương trình có trong bản
create or replace function public.dist_plan_parts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_status text;
begin
  select status into v_status from dist_plans where id = (to_jsonb(r)->>'plan_id')::uuid;
  if v_status is null then return coalesce(new, old); end if;      -- xoá theo dây chuyền
  if v_status <> 'draft' then raise exception 'Bản phân phối đã phát hành: chuyển về nháp hoặc nhân bản để sửa' using errcode = '22023'; end if;
  if tg_op <> 'DELETE' and tg_table_name = 'dist_plan_rows' then
    if not exists (select 1 from dist_plan_items i where i.plan_id = new.plan_id and i.program_id = new.program_id) then
      raise exception 'Bài thuộc chương trình chưa có trong bản phân phối' using errcode = '22023';
    end if;
    if not exists (select 1 from edu_program_units u where u.id = new.unit_id and u.program_id = new.program_id) then
      raise exception 'Bài không thuộc chương trình' using errcode = '22023';
    end if;
    new.note := nullif(btrim(new.note), '');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists dist_plan_items_guard on dist_plan_items;
create trigger dist_plan_items_guard before insert or update or delete on dist_plan_items for each row execute function public.dist_plan_parts_guard();
drop trigger if exists dist_plan_rows_guard on dist_plan_rows;
create trigger dist_plan_rows_guard before insert or update or delete on dist_plan_rows for each row execute function public.dist_plan_parts_guard();

-- Bỏ chương trình khỏi bản → bỏ luôn lịch bài của chương trình đó
create or replace function public.dist_plan_items_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from dist_plan_rows where plan_id = old.plan_id and program_id = old.program_id;
  return null;
end $$;
drop trigger if exists dist_plan_items_cleanup on dist_plan_items;
create trigger dist_plan_items_cleanup after delete on dist_plan_items for each row execute function public.dist_plan_items_cleanup();

-- Quyền: đơn vị soạn (và cấp trên) đọc; bản đã phát hành mọi nhân sự đọc được (Sở / Phòng dùng bản của KDI để gán)
create or replace function public.dist_plan_visible(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dist_plans d where d.id = p_plan
                   and (public.can_access_org(d.org_id) or (d.status = 'published' and public.is_staff())))
$$;
create or replace function public.dist_plan_writable(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dist_plans d where d.id = p_plan and public.curriculum_can_write(d.org_id, 'edit'))
$$;
revoke all on function public.dist_plan_visible(uuid) from public, anon;
revoke all on function public.dist_plan_writable(uuid) from public, anon;
grant execute on function public.dist_plan_visible(uuid) to authenticated;
grant execute on function public.dist_plan_writable(uuid) to authenticated;

alter table dist_plans enable row level security;
alter table dist_plan_items enable row level security;
alter table dist_plan_rows enable row level security;
drop policy if exists dist_plans_read on dist_plans;
create policy dist_plans_read on dist_plans for select to authenticated
  using (public.can_access_org(org_id) or (status = 'published' and public.is_staff()));
drop policy if exists dist_plans_write on dist_plans;
create policy dist_plans_write on dist_plans for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
drop policy if exists dist_plan_items_read on dist_plan_items;
create policy dist_plan_items_read on dist_plan_items for select to authenticated using (public.dist_plan_visible(plan_id));
drop policy if exists dist_plan_items_write on dist_plan_items;
create policy dist_plan_items_write on dist_plan_items for all to authenticated using (public.dist_plan_writable(plan_id)) with check (public.dist_plan_writable(plan_id));
drop policy if exists dist_plan_rows_read on dist_plan_rows;
create policy dist_plan_rows_read on dist_plan_rows for select to authenticated using (public.dist_plan_visible(plan_id));
drop policy if exists dist_plan_rows_write on dist_plan_rows;
create policy dist_plan_rows_write on dist_plan_rows for all to authenticated using (public.dist_plan_writable(plan_id)) with check (public.dist_plan_writable(plan_id));
grant select, insert, update, delete on dist_plans, dist_plan_items, dist_plan_rows to authenticated;

-- ===== 3. Nhân bản =====
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
  insert into dist_plan_items (plan_id, program_id, seq, start_mode, start_week, after_program, ppw)
  select v_new, program_id, seq, start_mode, start_week, after_program, ppw from dist_plan_items where plan_id = s.id;
  insert into dist_plan_rows (plan_id, program_id, unit_id, seq, week, periods, note, manual, skipped)
  select v_new, program_id, unit_id, seq, week, periods, note, manual, skipped from dist_plan_rows where plan_id = s.id;
  return v_new;
end $$;
revoke all on function public.dist_plan_copy(uuid) from public, anon;
grant execute on function public.dist_plan_copy(uuid) to authenticated;

-- ===== 4. Gán cho trường → PPCT theo trường =====
alter table curriculum_books add column if not exists dist_plan_id uuid references dist_plans(id) on delete set null;
create index if not exists curriculum_books_dist_plan on curriculum_books (dist_plan_id) where dist_plan_id is not null;

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
    -- Lớp được chọn của trường này, đúng khối của bản
    select array_agg(c.id) into v_cls from classes c where c.id = any(coalesce(p_classes, '{}')) and c.org_id = v_org and c.grade = d.grade;
    for it in select i.*, p.title as ptitle, p.main_subject, p.kind as pkind from dist_plan_items i join edu_programs p on p.id = i.program_id
               where i.plan_id = d.id order by i.seq loop
      -- Đã gán bản này cho trường trong năm học → bỏ qua (chạy lại không tạo trùng)
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
      -- Bài nhiều tiết: các tiết sau trải tiếp theo nhịp tiết/tuần của chương trình (tuần của bài = tuần tiết đầu)
      select v_book, row_number() over (order by r.week, r.seq, k), least(60, r.week + floor((k - 1) / it.ppw)::int),
             u.title || case when k > 1 then ' (tiếp)' else '' end,
             case when u.title ilike 'Kiểm tra%' then 'test' when u.title ilike 'Ôn tập%' then 'review'
                  when it.pkind = 'stem' then 'stem' else 'lesson' end,
             r.unit_id, case when k = 1 then r.note end
        from dist_plan_rows r join edu_program_units u on u.id = r.unit_id
        cross join lateral generate_series(1, r.periods) k
       where r.plan_id = d.id and r.program_id = it.program_id and not r.skipped and r.periods > 0;
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
