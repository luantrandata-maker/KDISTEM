-- 148: Gói STEM theo khung chương trình mới.
-- Gói STEM (Gói 1T–4T…) gồm cả 4 loại chương trình; với mỗi loại, mỗi khối, gói chọn học phần nào học ở vị trí nào
-- (Học phần 1, Học phần 2…). Các gói hiện giống nhau, chỉ khác học phần của CT2 (Trải nghiệm STEM cơ bản) theo 4 phương án
-- trong file của bộ phận chương trình. Bán gói, đơn đặt gói nối vào sau. Chỉ KDI sửa; mọi người xem.
-- Kèm: số tiết dự kiến của học phần (mỗi khối) và chủ đề mẫu của Bài học STEM (10 chủ đề / khối, tên tạm để KDI sửa).

alter table program_modules add column if not exists periods int check (periods is null or periods between 0 and 200);
comment on column program_modules.periods is 'Số tiết dự kiến của học phần trong một khối (VD 16 tiết/học phần); trống = theo tổng số tiết các chủ đề';

create table if not exists program_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists program_packages_code on program_packages (upper(code));

-- Học phần của gói: gói × loại chương trình × khối × vị trí (1 = Học phần 1 …)
create table if not exists program_package_items (
  package_id uuid not null references program_packages(id) on delete cascade,
  track_code text not null references stem_tracks(code),
  grade int not null check (grade between -4 and 12 and grade <> 0),
  slot int not null default 1 check (slot between 1 and 9),
  module_id uuid not null references program_modules(id) on delete restrict,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (package_id, track_code, grade, slot)
);
create index if not exists program_package_items_module on program_package_items (module_id);

create or replace function public.program_package_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'program_packages' then
    new.code := btrim(new.code); new.name := btrim(new.name); new.description := btrim(coalesce(new.description, ''));
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    if not exists (select 1 from program_modules m where m.id = new.module_id and m.track_code = new.track_code) then
      raise exception 'Học phần không thuộc loại chương trình %', new.track_code using errcode = '23514';
    end if;
    new.note := btrim(coalesce(new.note, ''));
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists program_packages_touch on program_packages;
create trigger program_packages_touch before insert or update on program_packages for each row execute function public.program_package_touch();
drop trigger if exists program_package_items_touch on program_package_items;
create trigger program_package_items_touch before insert or update on program_package_items for each row execute function public.program_package_touch();

do $$
declare t text;
begin
  foreach t in array array['program_packages', 'program_package_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin())', t || '_write', t);
  end loop;
end $$;

-- ===== Dữ liệu ban đầu theo file "Hiểu đúng STEM 2026" (chỉ thêm khi bảng còn trống) =====
update program_modules set periods = case when name = 'AI cốt lõi' then 12 else 16 end
 where track_code in ('CT2', 'CT3') and periods is null;

insert into program_packages (code, name, description, sort)
select x.code, x.name, x.descr, x.sort from (values
  ('1T', 'Gói 1T', 'Trải nghiệm STEM cơ bản theo phương án 1: Sáng chế cả năm học.', 1),
  ('2T', 'Gói 2T', 'Trải nghiệm STEM cơ bản theo phương án 2: HP1 Sáng chế; HP2 lắp ráp, lập trình, tự động hóa, thiết kế cơ bản.', 2),
  ('3T', 'Gói 3T', 'Trải nghiệm STEM cơ bản theo phương án 3: HP1 Sáng chế (hoặc kết hợp lắp ráp, lập trình); HP2 AI cốt lõi 12 tiết.', 3),
  ('4T', 'Gói 4T', 'Trải nghiệm STEM cơ bản theo phương án 4: HP1 lắp ráp, lập trình, thiết kế; HP2 Chuyển đổi số cơ bản.', 4)
) x(code, name, descr, sort)
 where not exists (select 1 from program_packages);

do $$
declare
  -- Khối 1 → 12: [học phần 1, học phần 2]
  ct3 text[][] := array[
    ['Lập trình không máy tính với robot', 'Làm quen với lập trình'], ['Làm quen với lập trình', 'Ứng dụng AI trong thực tiễn'],
    ['Lập trình robot', 'Thiết kế với AI'], ['Lập trình robot', 'Thiết kế với AI'], ['Thiết kế 3D', 'Lập trình AI cơ bản'],
    ['Lập trình robot', 'Lập trình ứng dụng AI'], ['Lập trình tự động hóa & IoT', 'Ứng dụng AI trong thực tiễn'],
    ['Thiết kế 3D', 'Thiết kế với AI'], ['Thiết kế 3D', 'Lập trình AI cho thiết bị'], ['Phát triển ứng dụng di động', 'Ứng dụng AI trong thực tiễn'],
    ['Lập trình ứng dụng AI', 'Lập trình AIoT'], ['Lập trình AI cho thiết bị', 'Phát triển ứng dụng với AI']];
  -- CT2, học phần 2 của phương án 2 và học phần 1 của phương án 4 (theo khối)
  pa2 text[] := array['Lắp ráp với Strawbees', 'Lắp ráp với Strawbees', 'Thiết kế với Canva', 'Lập trình cơ bản', 'Lập trình cơ bản',
    'Lập trình cơ bản', 'Lập trình cơ bản', 'Lập trình tự động hóa', 'Lập trình tự động hóa', 'Lập trình Python', 'Thiết kế với Canva',
    'Lập trình tự động hóa & IoT'];
  p record; g int;
  mod_id uuid;
begin
  if exists (select 1 from program_package_items) then return; end if;
  for p in select id, code from program_packages where code in ('1T', '2T', '3T', '4T') loop
    for g in 1 .. 12 loop
      -- CT1, CT4: học phần CHUNG
      insert into program_package_items (package_id, track_code, grade, slot, module_id)
      select p.id, m.track_code, g, 1, m.id from program_modules m where m.track_code in ('CT1', 'CT4') and m.name = 'CHUNG';
      -- CT3: lộ trình chuẩn, giống nhau ở mọi gói
      insert into program_package_items (package_id, track_code, grade, slot, module_id)
      select p.id, 'CT3', g, s.slot, m.id from (values (1, ct3[g][1]), (2, ct3[g][2])) s(slot, name)
        join program_modules m on m.track_code = 'CT3' and m.name = s.name;
      -- CT2: theo phương án của gói
      insert into program_package_items (package_id, track_code, grade, slot, module_id)
      select p.id, 'CT2', g, s.slot, m.id from (values
          (1, case p.code when '4T' then pa2[g] else 'Sáng chế' end),
          (2, case p.code when '1T' then 'Sáng chế' when '2T' then pa2[g] when '3T' then 'AI cốt lõi' else 'Chuyển đổi số cơ bản' end)) s(slot, name)
        join program_modules m on m.track_code = 'CT2' and m.name = s.name;
    end loop;
  end loop;

  -- Bài học STEM: 10 chủ đề mẫu mỗi khối (tên tạm, KDI đổi khi có bài)
  select id into mod_id from program_modules where track_code = 'CT1' and name = 'CHUNG';
  if mod_id is not null and not exists (select 1 from program_topics where module_id = mod_id) then
    insert into program_topics (module_id, grade, seq, title, periods)
    select mod_id, g2, n, 'Chủ đề STEM ' || n, 1 from generate_series(1, 12) g2, generate_series(1, 10) n;
  end if;
end $$;

notify pgrst, 'reload schema';
