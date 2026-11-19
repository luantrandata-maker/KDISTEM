-- 156: Trường dùng gói STEM nào.
-- Mỗi trường, mỗi năm học dùng một gói (program_packages), áp dụng cho một số khối.
-- Trường có thể không mua hết gói: ghi các phần không mua vào school_package_skips
--   • slot có giá trị: bỏ cả học phần ở vị trí đó (CT2, CT3: HP1, HP2…; CT1, CT4: slot 1 = cả loại ở khối đó)
--   • topic_id có giá trị: bỏ một chủ đề (CT1, CT4)
-- Chỉ KDI gán / sửa. Trường, Phòng, Sở xem được bản gán của trường thuộc mình.

create table if not exists school_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  package_id uuid not null references program_packages(id) on delete restrict,
  school_year text not null check (school_year ~ '^\d{4}-\d{4}$'),
  grades int[] not null default '{}' check (grades <@ array[-4,-3,-2,-1,1,2,3,4,5,6,7,8,9,10,11,12]),
  full_package boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (org_id, school_year)
);
create index if not exists school_packages_package on school_packages (package_id);
comment on table school_packages is 'Trường dùng gói STEM nào trong năm học, áp dụng cho khối nào; full_package = false thì xem school_package_skips';

create table if not exists school_package_skips (
  id uuid primary key default gen_random_uuid(),
  school_package_id uuid not null references school_packages(id) on delete cascade,
  track_code text not null references stem_tracks(code),
  grade int not null check (grade between -4 and 12 and grade <> 0),
  slot int check (slot between 1 and 9),
  topic_id uuid references program_topics(id) on delete cascade,
  check ((slot is null) <> (topic_id is null))
);
create unique index if not exists school_package_skips_slot on school_package_skips (school_package_id, track_code, grade, slot) where slot is not null;
create unique index if not exists school_package_skips_topic on school_package_skips (school_package_id, topic_id) where topic_id is not null;
comment on table school_package_skips is 'Phần có trong gói nhưng trường không mua: cả học phần (slot) hoặc một chủ đề (topic_id)';

create or replace function public.school_package_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'school_packages' then
    if not exists (select 1 from organizations o where o.id = new.org_id and o.type = 'school') then
      raise exception 'Chỉ gán gói cho trường' using errcode = '23514';
    end if;
    new.grades := coalesce((select array_agg(distinct g order by g) from unnest(new.grades) g), '{}');
    new.note := btrim(coalesce(new.note, ''));
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  elsif new.topic_id is not null then
    if not exists (select 1 from program_topics t join program_modules m on m.id = t.module_id
                    where t.id = new.topic_id and m.track_code = new.track_code and t.grade = new.grade) then
      raise exception 'Chủ đề không thuộc loại chương trình % khối %', new.track_code, new.grade using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists school_packages_touch on school_packages;
create trigger school_packages_touch before insert or update on school_packages for each row execute function public.school_package_touch();
drop trigger if exists school_package_skips_touch on school_package_skips;
create trigger school_package_skips_touch before insert or update on school_package_skips for each row execute function public.school_package_touch();

alter table school_packages enable row level security;
alter table school_package_skips enable row level security;
drop policy if exists school_packages_read on school_packages;
create policy school_packages_read on school_packages for select to authenticated
  using (public.is_platform_admin() or (public.is_staff() and org_id in (select public.my_org_tree())));
drop policy if exists school_packages_write on school_packages;
create policy school_packages_write on school_packages for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists school_package_skips_read on school_package_skips;
create policy school_package_skips_read on school_package_skips for select to authenticated
  using (exists (select 1 from school_packages sp where sp.id = school_package_id));
drop policy if exists school_package_skips_write on school_package_skips;
create policy school_package_skips_write on school_package_skips for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Danh sách trường (kèm tỉnh) và gói của năm học: KDI thấy mọi trường; Sở / Phòng / trường thấy trường thuộc mình.
create or replace function public.school_package_schools(p_year text)
returns table (org_id uuid, name text, code text, level text, province_id uuid, province_name text,
               sp_id uuid, package_id uuid, grades int[], full_package boolean, note text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.code, o.level, pv.id, pv.name, sp.id, sp.package_id, sp.grades, sp.full_package, sp.note, sp.updated_at
    from organizations o
    left join organizations pv on pv.id = public.org_ancestor_of_type(o.id, 'province')
    left join school_packages sp on sp.org_id = o.id and sp.school_year = p_year
   where o.type = 'school'
     and (public.is_platform_admin() or (public.is_staff() and o.id in (select public.my_org_tree())))
   order by pv.name nulls last, o.name
$$;
revoke all on function public.school_package_schools(text) from public, anon;
grant execute on function public.school_package_schools(text) to authenticated;

notify pgrst, 'reload schema';
