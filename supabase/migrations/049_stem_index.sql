-- 049: S5b — Chỉ số STEM (STEM Index) & Bộ chỉ số.
--   stem_index_configs: bộ chỉ số của Sở / Phòng / Tỉnh / KDI — bật/tắt từng chỉ số, trọng số, mức mục tiêu,
--   ngưỡng xếp mức (Mức 3 Tiên tiến / Mức 2 Đạt / Mức 1 Cần hỗ trợ). Trường và đơn vị trực thuộc dùng bộ của
--   cấp trên gần nhất; chưa đơn vị nào đặt → bộ mặc định của KDI (đơn vị nền tảng) hoặc mặc định trong ứng dụng.
--   Điểm từng trường tính trên trình duyệt từ dept_school_stats (018) theo đúng phạm vi người xem.
--   stem_index_config(): bộ chỉ số hiệu lực của đơn vị đang làm việc.

create table if not exists stem_index_configs (
  org_id uuid primary key references organizations(id) on delete cascade,
  name text not null default 'Bộ chỉ số STEM',
  indicators jsonb not null default '{}'::jsonb check (jsonb_typeof(indicators) = 'object'),   -- { key: { on, weight, target } }
  level3 numeric(5,2) not null default 70 check (level3 between 1 and 100),
  level2 numeric(5,2) not null default 50 check (level2 between 0 and 100),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  check (level2 < level3)
);

create or replace function public.guard_stem_index_config() returns trigger
language plpgsql set search_path = public as $$
declare k text; v jsonb;
begin
  for k, v in select * from jsonb_each(new.indicators) loop
    if k !~ '^[a-z_]{2,30}$' or jsonb_typeof(v) <> 'object'
       or (v ? 'weight' and (jsonb_typeof(v->'weight') <> 'number' or (v->>'weight')::numeric not between 0 and 100))
       or (v ? 'target' and v->'target' <> 'null'::jsonb and (jsonb_typeof(v->'target') <> 'number' or (v->>'target')::numeric <= 0)) then
      raise exception 'Chỉ số "%" không hợp lệ', k using errcode = '23514';
    end if;
  end loop;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists stem_index_configs_guard on stem_index_configs;
create trigger stem_index_configs_guard before insert or update on stem_index_configs for each row execute function public.guard_stem_index_config();

alter table stem_index_configs enable row level security;
drop policy if exists stem_index_configs_read on stem_index_configs;
create policy stem_index_configs_read on stem_index_configs for select to authenticated
  using ((select public.is_platform_admin()) or (public.is_staff() and (org_id in (select public.my_org_tree()) or org_id in (select public.my_ancestor_orgs())))
         or org_id = (select id from organizations where is_platform));
drop policy if exists stem_index_configs_write on stem_index_configs;
create policy stem_index_configs_write on stem_index_configs for all to authenticated
  using ((select public.is_platform_admin()) or (org_id = public.my_org_id() and public.is_authority()))
  with check ((select public.is_platform_admin()) or (org_id = public.my_org_id() and public.is_authority()));
grant select, insert, update, delete on stem_index_configs to authenticated;

-- Bộ chỉ số hiệu lực: đơn vị đang làm việc → cấp trên gần nhất → KDI
create or replace function public.stem_index_config() returns jsonb
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, 0 as d from organizations where id = public.my_org_id()
    union all
    select o.id, o.parent_id, up.d + 1 from organizations o join up on o.id = up.parent_id where up.d < 10
  )
  select to_jsonb(c) || jsonb_build_object('source', o.name, 'own', c.org_id = public.my_org_id())
    from stem_index_configs c join organizations o on o.id = c.org_id
   where auth.uid() is not null and (c.org_id in (select id from up) or o.is_platform)
   order by case when o.is_platform and c.org_id not in (select id from up) then 99 else (select d from up where up.id = c.org_id) end
   limit 1
$$;
grant execute on function public.stem_index_config() to authenticated;

notify pgrst, 'reload schema';
