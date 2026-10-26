-- 101. Kế hoạch tập huấn — khung phân loại giống Phân phối chương trình (Phân hệ 1)
--  • training_cls_levels: các cấp của khung (mặc định Cấp học › Cấp độ). KDI đổi tên, bật/tắt, đổi thứ tự,
--    thêm cấp mới (vd. Đối tượng, Giai đoạn), xoá cấp chưa có mục. Cấp học luôn bật, không xoá.
--  • training_nodes: các mục trong cây (THCS, Cơ bản…). Mục cấp học tự nhận edu_levels theo tên để gợi ý
--    chương trình tập huấn cùng cấp học khi lập kế hoạch.
--  • training_plans.node_id: kế hoạch gắn vào một mục ở cấp cuối; kế hoạch cũ chưa có mục hiện ở "Chưa phân loại".
-- Lịch tập huấn vẫn lưu ở training_sessions (mỗi nội dung một buổi: ngày, giờ, địa điểm, hình thức, giảng viên).

create table if not exists training_cls_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 40),
  kind text not null check (kind in ('level', 'tier', 'custom')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists training_cls_levels_kind on training_cls_levels (kind) where kind <> 'custom';

create table if not exists training_nodes (
  id uuid primary key default gen_random_uuid(),
  cls_level_id uuid not null references training_cls_levels(id) on delete restrict,
  parent_id uuid references training_nodes(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort int not null default 0,
  edu_level text references edu_levels(code),
  created_at timestamptz not null default now()
);
create index if not exists training_nodes_parent on training_nodes (parent_id);
create index if not exists training_nodes_level on training_nodes (cls_level_id);

alter table training_plans add column if not exists node_id uuid references training_nodes(id) on delete restrict;
create index if not exists training_plans_node on training_plans (node_id);

create or replace function public.training_cls_levels_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'level' then raise exception 'Không xoá được cấp % (kế hoạch tập huấn cần cấp này)', old.name using errcode = '22023'; end if;
    return old;
  end if;
  new.name := btrim(new.name);
  if new.kind = 'level' and not new.active then
    raise exception 'Không tắt được cấp % (kế hoạch tập huấn cần cấp này)', new.name using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind then raise exception 'Không đổi loại cấp' using errcode = '22023'; end if;
    if new.sort <> old.sort and exists (select 1 from training_nodes where cls_level_id = old.id) then
      raise exception 'Cấp % đã có mục trong cây nên không đổi thứ tự được', old.name using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists training_cls_levels_guard on training_cls_levels;
create trigger training_cls_levels_guard before insert or update or delete on training_cls_levels for each row execute function public.training_cls_levels_guard();

create or replace function public.training_nodes_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_kind text;
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and (new.parent_id is distinct from old.parent_id or new.cls_level_id <> old.cls_level_id) then
    raise exception 'Không chuyển mục sang nhánh hoặc cấp khác' using errcode = '22023';
  end if;
  select kind into v_kind from training_cls_levels where id = new.cls_level_id;
  if v_kind = 'level' and new.edu_level is null then
    select code into new.edu_level from edu_levels where lower(btrim(name)) = lower(new.name) order by sort limit 1;
  end if;
  return new;
end $$;
drop trigger if exists training_nodes_guard on training_nodes;
create trigger training_nodes_guard before insert or update on training_nodes for each row execute function public.training_nodes_guard();

alter table training_cls_levels enable row level security;
alter table training_nodes enable row level security;
drop policy if exists training_cls_levels_read on training_cls_levels;
create policy training_cls_levels_read on training_cls_levels for select to authenticated using (true);
drop policy if exists training_cls_levels_write on training_cls_levels;
create policy training_cls_levels_write on training_cls_levels for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists training_nodes_read on training_nodes;
create policy training_nodes_read on training_nodes for select to authenticated using (true);
drop policy if exists training_nodes_write on training_nodes;
create policy training_nodes_write on training_nodes for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on training_cls_levels, training_nodes to authenticated;

-- Mặc định: Cấp học › Cấp độ; mỗi cấp học có Cơ bản, Nâng cao
do $$
declare v_lv uuid; v_tier uuid; l record; v_n uuid;
begin
  if exists (select 1 from training_cls_levels) then return; end if;
  insert into training_cls_levels (name, kind, sort) values ('Cấp học', 'level', 10) returning id into v_lv;
  insert into training_cls_levels (name, kind, sort) values ('Cấp độ', 'tier', 20) returning id into v_tier;
  for l in select code, name, sort from edu_levels order by sort loop
    insert into training_nodes (cls_level_id, name, sort, edu_level) values (v_lv, l.name, l.sort, l.code) returning id into v_n;
    insert into training_nodes (cls_level_id, parent_id, name, sort) values (v_tier, v_n, 'Cơ bản', 1), (v_tier, v_n, 'Nâng cao', 2);
  end loop;
end $$;

-- Xếp lịch ngay khi soạn kế hoạch (bước "Xếp lịch"), không cần phát hành trước
do $$ declare d text;
begin
  d := pg_get_functiondef('public.training_sessions_guard()'::regprocedure);
  if position('phát hành trước khi xếp lịch' in d) > 0 then
    d := replace(d, $r$  if (tg_op = 'INSERT' or new.plan_id <> old.plan_id) and v_pub = 'draft' then
    raise exception 'Kế hoạch còn nháp: phát hành trước khi xếp lịch' using errcode = '22023';
  end if;
$r$, '');
    if position('phát hành trước khi xếp lịch' in d) > 0 then raise exception '101: không sửa được training_sessions_guard'; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
