-- 158: Trường dùng nhiều gói, nâng cấp gói.
-- • Một trường dùng được nhiều gói trong một năm học, mỗi khối một gói (VD liên cấp: Gói 2 cho K1–K5, Gói 3 cho K6–K9).
--   Hai bản gán của một trường trong cùng năm học không được trùng khối trong cùng khoảng thời gian.
-- • Nâng cấp gói (school_package_upgrade): bản gán cũ kết thúc trước ngày áp dụng (ends_on), bản mới bắt đầu từ ngày đó
--   (starts_on, prev_id trỏ về bản cũ). Khối không nâng cấp được chép sang một bản tiếp nối giữ gói cũ và phần không áp dụng.
--   Bản đã kết thúc giữ lại làm lịch sử.

alter table school_packages drop constraint if exists school_packages_org_id_school_year_key;
alter table school_packages add column if not exists starts_on date;
alter table school_packages add column if not exists ends_on date;
alter table school_packages add column if not exists prev_id uuid references school_packages(id) on delete set null;
alter table school_packages drop constraint if exists school_packages_dates;
alter table school_packages add constraint school_packages_dates check (ends_on is null or starts_on is null or ends_on >= starts_on);
create index if not exists school_packages_org_year on school_packages (org_id, school_year);
comment on column school_packages.starts_on is 'Ngày bắt đầu áp dụng; để trống = từ đầu năm học';
comment on column school_packages.ends_on is 'Ngày cuối cùng áp dụng (đã nâng cấp / đổi gói); để trống = đang dùng';
comment on column school_packages.prev_id is 'Bản gán trước đó (gói cũ) khi bản này có từ nâng cấp';

create or replace function public.school_package_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'school_packages' then
    if not exists (select 1 from organizations o where o.id = new.org_id and o.type = 'school') then
      raise exception 'Chỉ gán gói cho trường' using errcode = '23514';
    end if;
    new.grades := coalesce((select array_agg(distinct g order by g) from unnest(new.grades) g), '{}');
    if cardinality(new.grades) = 0 then
      raise exception 'Chọn ít nhất một khối' using errcode = '23514';
    end if;
    -- Mỗi khối một gói: không trùng khối với bản gán khác của trường trong cùng năm học, cùng khoảng thời gian
    if exists (select 1 from school_packages o
                where o.org_id = new.org_id and o.school_year = new.school_year and o.id <> new.id
                  and o.grades && new.grades
                  and daterange(o.starts_on, o.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
      raise exception 'Khối đã có gói khác trong năm học này' using errcode = '23514';
    end if;
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

-- Nâng cấp: p_grades là các khối của bản gán p_sp chuyển sang gói p_package từ ngày p_from.
-- Trả về id bản gán mới.
create or replace function public.school_package_upgrade(p_sp uuid, p_package uuid, p_grades int[], p_from date, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o school_packages;
  up int[];
  rest int[];
  new_id uuid;
  rest_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Chỉ quản trị nền tảng KDI nâng cấp gói' using errcode = '42501';
  end if;
  select * into o from school_packages where id = p_sp for update;
  if not found then raise exception 'Không tìm thấy bản gán gói' using errcode = 'P0002'; end if;
  if o.ends_on is not null then raise exception 'Bản gán này đã kết thúc' using errcode = '23514'; end if;
  if p_package = o.package_id then raise exception 'Chọn gói khác gói đang dùng' using errcode = '23514'; end if;
  if p_from is null or (o.starts_on is not null and p_from <= o.starts_on) then
    raise exception 'Ngày áp dụng phải sau ngày bắt đầu của gói đang dùng' using errcode = '23514';
  end if;
  up := coalesce((select array_agg(distinct g order by g) from unnest(p_grades) g where g = any(o.grades)), '{}');
  if cardinality(up) = 0 then raise exception 'Chọn ít nhất một khối' using errcode = '23514'; end if;
  rest := coalesce((select array_agg(g order by g) from unnest(o.grades) g where g <> all(up)), '{}');

  update school_packages set ends_on = p_from - 1 where id = o.id;
  insert into school_packages (org_id, package_id, school_year, grades, full_package, note, starts_on, prev_id)
    values (o.org_id, p_package, o.school_year, up, true, coalesce(p_note, ''), p_from, o.id) returning id into new_id;
  if cardinality(rest) > 0 then
    insert into school_packages (org_id, package_id, school_year, grades, full_package, note, starts_on, prev_id)
      values (o.org_id, o.package_id, o.school_year, rest, o.full_package, o.note, p_from, o.id) returning id into rest_id;
    insert into school_package_skips (school_package_id, track_code, grade, slot, topic_id)
      select rest_id, s.track_code, s.grade, s.slot, s.topic_id from school_package_skips s
       where s.school_package_id = o.id and s.grade = any(rest);
  end if;
  return new_id;
end $$;
revoke all on function public.school_package_upgrade(uuid, uuid, int[], date, text) from public, anon;
grant execute on function public.school_package_upgrade(uuid, uuid, int[], date, text) to authenticated;

-- Danh sách trường và các bản gán gói của năm học (kể cả bản đã kết thúc, làm lịch sử): mỗi bản gán một dòng,
-- trường chưa có gói một dòng (sp_id trống).
drop function if exists public.school_package_schools(text);
create function public.school_package_schools(p_year text)
returns table (org_id uuid, name text, code text, level text, province_id uuid, province_name text,
               sp_id uuid, package_id uuid, grades int[], full_package boolean, note text, updated_at timestamptz,
               starts_on date, ends_on date, prev_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.code, o.level, pv.id, pv.name, sp.id, sp.package_id, sp.grades, sp.full_package, sp.note, sp.updated_at,
         sp.starts_on, sp.ends_on, sp.prev_id
    from organizations o
    left join organizations pv on pv.id = public.org_ancestor_of_type(o.id, 'province')
    left join school_packages sp on sp.org_id = o.id and sp.school_year = p_year
   where o.type = 'school'
     and (public.is_platform_admin() or (public.is_staff() and o.id in (select public.my_org_tree())))
   order by pv.name nulls last, o.name, o.id, sp.starts_on nulls first, sp.id
$$;
revoke all on function public.school_package_schools(text) from public, anon;
grant execute on function public.school_package_schools(text) to authenticated;

notify pgrst, 'reload schema';
