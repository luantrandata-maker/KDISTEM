-- 082. Phân phối chương trình — cấu hình cấp phân loại (Phân hệ 2)
--  • dist_cls_levels: các cấp của khung phân loại (mặc định Cấp học › Khối lớp › Mức độ). KDI đổi tên, bật/tắt,
--    đổi thứ tự, thêm cấp mới (vd. Giai đoạn), xoá cấp chưa có mục. Cấp học và Khối lớp luôn bật, không xoá
--    (bản phân phối cần biết cấp học và khối để chọn chương trình, gán lớp).
--  • dist_nodes: các mục trong cây (Tiểu học, Khối 1, Cơ bản…). Mục cấp học gắn edu_levels, mục khối gắn số khối,
--    mục mức độ gắn dist_tiers (tự nhận theo tên, chưa có thì thêm mức độ mới); mục của cấp tự thêm chỉ có tên.
--  • dist_plans.node_id: bản phân phối gắn vào một mục; cấp học / khối / mức độ của bản tự lấy theo các mục cha.
--    Bản chưa có node_id (bản cũ, bản sao) được gắn tự động theo cấp học / khối / mức độ.
-- Cần chạy sau 078, 079.

-- ===== 1. Cấp phân loại =====
create table if not exists dist_cls_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 40),
  kind text not null check (kind in ('level', 'grade', 'tier', 'custom')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists dist_cls_levels_kind on dist_cls_levels (kind) where kind <> 'custom';

-- ===== 2. Mục trong cây =====
create table if not exists dist_nodes (
  id uuid primary key default gen_random_uuid(),
  cls_level_id uuid not null references dist_cls_levels(id) on delete restrict,
  parent_id uuid references dist_nodes(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort int not null default 0,
  edu_level text references edu_levels(code),
  grade int check (grade between 1 and 12),
  tier text references dist_tiers(code),
  created_at timestamptz not null default now()
);
create index if not exists dist_nodes_parent on dist_nodes (parent_id);
create index if not exists dist_nodes_level on dist_nodes (cls_level_id);

create or replace function public.dist_cls_levels_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind in ('level', 'grade') then raise exception 'Không xoá được cấp % (bản phân phối cần cấp này)', old.name using errcode = '22023'; end if;
    return old;
  end if;
  new.name := btrim(new.name);
  if new.kind in ('level', 'grade') and not new.active then
    raise exception 'Không tắt được cấp % (bản phân phối cần cấp này)', new.name using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind then raise exception 'Không đổi loại cấp' using errcode = '22023'; end if;
    if new.sort <> old.sort and exists (select 1 from dist_nodes where cls_level_id = old.id) then
      raise exception 'Cấp % đã có mục trong cây nên không đổi thứ tự được', old.name using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists dist_cls_levels_guard on dist_cls_levels;
create trigger dist_cls_levels_guard before insert or update or delete on dist_cls_levels for each row execute function public.dist_cls_levels_guard();

create or replace function public.dist_nodes_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_kind text;
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and (new.parent_id is distinct from old.parent_id or new.cls_level_id <> old.cls_level_id) then
    raise exception 'Không chuyển mục sang nhánh hoặc cấp khác' using errcode = '22023';
  end if;
  select kind into v_kind from dist_cls_levels where id = new.cls_level_id;
  -- Thêm mục chỉ cần tên: cấp học / khối / mức độ tự nhận theo tên
  if v_kind = 'level' and new.edu_level is null then
    select code into new.edu_level from edu_levels where lower(btrim(name)) = lower(new.name) order by sort limit 1;
  elsif v_kind = 'grade' and new.grade is null then
    new.grade := nullif(substring(new.name from '([0-9]{1,2})'), '')::int;
    if new.grade not between 1 and 12 then new.grade := null; end if;
  elsif v_kind = 'tier' and new.tier is null then
    select code into new.tier from dist_tiers where lower(btrim(name)) = lower(new.name) order by sort limit 1;
    if new.tier is null then
      new.tier := 't_' || substr(md5(new.name || clock_timestamp()::text), 1, 10);
      insert into dist_tiers (code, name, sort) values (new.tier, new.name, coalesce((select max(sort) from dist_tiers), 0) + 1);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists dist_nodes_guard on dist_nodes;
create trigger dist_nodes_guard before insert or update on dist_nodes for each row execute function public.dist_nodes_guard();

-- Cấp học / khối / mức độ của một mục: lấy từ chính mục hoặc mục cha gần nhất
create or replace function public.dist_node_attrs(p_node uuid, out edu_level text, out grade int, out tier text)
language sql stable set search_path = public as $$
  with recursive up as (
    select n.id, n.parent_id, n.edu_level, n.grade, n.tier, 0 as d from dist_nodes n where n.id = p_node
    union all
    select n.id, n.parent_id, n.edu_level, n.grade, n.tier, up.d + 1 from dist_nodes n join up on n.id = up.parent_id
  )
  select (select u.edu_level from up u where u.edu_level is not null order by u.d limit 1),
         (select u.grade from up u where u.grade is not null order by u.d limit 1),
         (select u.tier from up u where u.tier is not null order by u.d limit 1)
$$;
grant execute on function public.dist_node_attrs(uuid) to authenticated;

alter table dist_cls_levels enable row level security;
alter table dist_nodes enable row level security;
drop policy if exists dist_cls_levels_read on dist_cls_levels;
create policy dist_cls_levels_read on dist_cls_levels for select to authenticated using (true);
drop policy if exists dist_cls_levels_write on dist_cls_levels;
create policy dist_cls_levels_write on dist_cls_levels for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists dist_nodes_read on dist_nodes;
create policy dist_nodes_read on dist_nodes for select to authenticated using (true);
drop policy if exists dist_nodes_write on dist_nodes;
create policy dist_nodes_write on dist_nodes for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on dist_cls_levels, dist_nodes to authenticated;

-- ===== 3. Dữ liệu ban đầu: 3 cấp và cây từ danh mục cấp học, khối, mức độ =====
insert into dist_cls_levels (name, kind, sort)
select v.name, v.kind, v.sort from (values ('Cấp học', 'level', 10), ('Khối lớp', 'grade', 20), ('Mức độ', 'tier', 30)) v(name, kind, sort)
where not exists (select 1 from dist_cls_levels);

do $$
declare v_l uuid; v_g uuid; v_t uuid;
begin
  if exists (select 1 from dist_nodes) then return; end if;
  select id into v_l from dist_cls_levels where kind = 'level';
  select id into v_g from dist_cls_levels where kind = 'grade';
  select id into v_t from dist_cls_levels where kind = 'tier';
  -- Cấp học đang dùng hoặc đã có bản phân phối
  insert into dist_nodes (cls_level_id, name, sort, edu_level)
  select v_l, l.name, l.sort, l.code from edu_levels l
  where l.active or exists (select 1 from dist_plans p where p.level = l.code);
  -- Khối của từng cấp học
  insert into dist_nodes (cls_level_id, parent_id, name, sort, grade)
  select v_g, n.id, 'Khối ' || g, g, g
  from dist_nodes n join edu_levels l on l.code = n.edu_level, generate_series(l.grade_from, l.grade_to) g
  where n.cls_level_id = v_l;
  -- Mức độ dưới từng khối
  insert into dist_nodes (cls_level_id, parent_id, name, sort, tier)
  select v_t, n.id, t.name, t.sort, t.code
  from dist_nodes n, dist_tiers t
  where n.cls_level_id = v_g and (t.active or exists (select 1 from dist_plans p where p.tier = t.code));
end $$;

-- ===== 4. Bản phân phối gắn vào mục =====
alter table dist_plans add column if not exists node_id uuid references dist_nodes(id) on delete restrict;
create index if not exists dist_plans_node on dist_plans (node_id);

-- Mục khớp cấp học / khối / mức độ (mức độ trống → mục khối)
create or replace function public.dist_node_for(p_level text, p_grade int, p_tier text) returns uuid
language sql stable set search_path = public as $$
  select n.id from dist_nodes n
  cross join lateral public.dist_node_attrs(n.id) a
  where a.edu_level = p_level and a.grade = p_grade
    and (case when p_tier is null then n.grade is not null else n.tier = p_tier end)
  order by n.created_at limit 1
$$;

create or replace function public.dist_plans_node() returns trigger
language plpgsql set search_path = public as $$
declare a record;
begin
  if new.node_id is null then
    new.node_id := public.dist_node_for(new.level, new.grade, new.tier);
    return new;
  end if;
  if tg_op = 'UPDATE' and new.node_id is not distinct from old.node_id then return new; end if;
  if tg_op = 'UPDATE' and old.node_id is not null and old.status = 'published' and new.status = 'published' then
    raise exception 'Bản phân phối đã phát hành: chuyển về nháp hoặc nhân bản để sửa' using errcode = '22023';
  end if;
  select * into a from public.dist_node_attrs(new.node_id);
  if a.edu_level is null or a.grade is null then
    raise exception 'Mục phân loại chưa thuộc cấp học và khối lớp nào' using errcode = '22023';
  end if;
  new.level := a.edu_level; new.grade := a.grade; new.tier := a.tier;
  return new;
end $$;
-- Tên trigger đứng trước dist_plans_guard để guard kiểm tra cấp học / khối đã lấy theo mục
drop trigger if exists dist_plans_anode on dist_plans;
create trigger dist_plans_anode before insert or update on dist_plans for each row execute function public.dist_plans_node();

update dist_plans set node_id = public.dist_node_for(level, grade, tier) where node_id is null;
