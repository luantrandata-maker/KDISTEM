-- 168: Gói STEM bỏ từng chủ đề (loại chương trình chỉ có chủ đề: CT1, CT4).
-- Khi sửa gói, KDI tick khối như cũ rồi bấm "Chọn chủ đề" để bỏ các chủ đề không đưa vào gói (mặc định chọn hết).
-- Chủ đề bị bỏ ghi vào program_package_topic_skips; package_topic_list (162) không trả các chủ đề này nên
-- danh sách chủ đề của trường (school_package_topic_list), PPCT chuẩn và Bản phân phối theo gói cũng không có.
-- Đọc: mọi người đã đăng nhập. Sửa: quản trị nền tảng KDI. Cần chạy sau 167.

create table if not exists program_package_topic_skips (
  package_id uuid not null references program_packages(id) on delete cascade,
  topic_id uuid not null references program_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, topic_id)
);
create index if not exists program_package_topic_skips_topic on program_package_topic_skips (topic_id);
comment on table program_package_topic_skips is 'Chủ đề có trong khung chương trình nhưng gói không đưa vào (168)';

alter table program_package_topic_skips enable row level security;
drop policy if exists program_package_topic_skips_read on program_package_topic_skips;
create policy program_package_topic_skips_read on program_package_topic_skips for select to authenticated using (true);
drop policy if exists program_package_topic_skips_write on program_package_topic_skips;
create policy program_package_topic_skips_write on program_package_topic_skips for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Chủ đề của gói theo vị trí học phần (162), bỏ các chủ đề gói không đưa vào
create or replace function public.package_topic_list(p_package uuid)
returns table (track_code text, grade int, slot int, module_id uuid, module_name text, topic_id uuid, topic_seq int, topic_title text, periods int)
language sql stable security definer set search_path = public as $$
  with it as (
    select i.track_code, i.grade, i.slot, i.module_id,
           row_number() over (partition by i.track_code, i.grade, i.module_id order by i.slot) k
      from program_package_items i where i.package_id = p_package
  )
  select it.track_code, it.grade, it.slot, it.module_id, m.name, t.id, t.seq, t.title, t.periods
    from it join program_modules m on m.id = it.module_id
    join program_topics t on t.module_id = it.module_id and t.grade = it.grade and t.active
   where (t.part is null or t.part = it.k
      or not exists (select 1 from program_topics t2 where t2.module_id = it.module_id and t2.grade = it.grade and t2.active and t2.part is not null))
     and not exists (select 1 from program_package_topic_skips s where s.package_id = p_package and s.topic_id = t.id)
   order by it.track_code, it.grade, it.slot, t.seq
$$;
revoke all on function public.package_topic_list(uuid) from public, anon;
grant execute on function public.package_topic_list(uuid) to authenticated;
