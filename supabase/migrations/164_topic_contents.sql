-- 164: 6 nội dung của chủ đề (khung chương trình mới): Kế hoạch giảng dạy, Bài giảng, Phiếu học tập, Bài kiểm tra, Vật tư,
-- Kho học liệu. Mỗi nội dung là một danh sách mục; mục có tên, mô tả, đường link hoặc tệp tải lên (kho learning-files).
-- Mục vật tư có thêm nhóm vật tư (material_groups, 147), số lượng, đơn vị, tính theo (học sinh / nhóm / lớp).
-- Gắn với giáo án, học liệu, đề sẵn có trong hệ thống làm ở bước sau (ref_table, ref_id để dành).
-- Đọc: mọi người đã đăng nhập (tệp: nhân sự). Sửa: quản trị nền tảng KDI. Cần chạy sau 162.

create table if not exists program_topic_items (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references program_topics(id) on delete cascade,
  kind text not null check (kind in ('plan', 'lecture', 'worksheet', 'test', 'material', 'resource')),
  seq int not null default 1 check (seq between 1 and 999),
  title text not null check (length(btrim(title)) between 1 and 200),
  detail text not null default '' check (length(detail) <= 4000),
  url text check (url is null or url ~* '^https?://'),
  file_path text,
  file_name text,
  ref_table text,
  ref_id uuid,
  material_group_id uuid references material_groups(id) on delete set null,
  qty numeric(8,2) check (qty is null or qty >= 0),
  unit text,
  per text check (per is null or per in ('student', 'group', 'class')),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists program_topic_items_topic on program_topic_items (topic_id, kind, seq);
comment on table program_topic_items is '6 nội dung của chủ đề: plan kế hoạch giảng dạy, lecture bài giảng, worksheet phiếu học tập, test bài kiểm tra, material vật tư, resource kho học liệu (164)';

create or replace function public.program_topic_items_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.title := btrim(new.title); new.detail := btrim(coalesce(new.detail, ''));
  new.url := nullif(btrim(coalesce(new.url, '')), ''); new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  if new.kind <> 'material' then new.material_group_id := null; new.qty := null; new.unit := null; new.per := null; end if;
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists program_topic_items_touch on program_topic_items;
create trigger program_topic_items_touch before insert or update on program_topic_items for each row execute function public.program_topic_items_touch();

alter table program_topic_items enable row level security;
drop policy if exists program_topic_items_read on program_topic_items;
create policy program_topic_items_read on program_topic_items for select to authenticated using (true);
drop policy if exists program_topic_items_write on program_topic_items;
create policy program_topic_items_write on program_topic_items for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on program_topic_items to authenticated;

-- Tệp của mục nội dung chủ đề: nhân sự mọi đơn vị mở được
create or replace function public.learning_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (public.is_staff() and public.learning_file_org(p_name) in (select public.my_org_tree()))
    or (public.is_student() and public.learning_file_org(p_name) = public.my_org_id())
    or exists (select 1 from library_items i where i.kind = 'material' and i.status = 'published' and i.content->>'path' = p_name
                and (public.library_visible(i.id)
                     or (public.is_student() and (i.scope = 'public'
                          or (i.scope = 'children' and i.owner_org_id in (select public.my_ancestor_orgs()))
                          or (i.scope = 'selected' and exists (select 1 from library_targets t where t.item_id = i.id and t.org_id in (select public.my_scope_orgs())))))))
    or exists (select 1 from library_item_versions v join library_items i on i.id = v.item_id
                where v.content->>'path' = p_name and public.library_visible(i.id))
    or exists (select 1 from course_lessons l where l.path = p_name and public.course_visible(l.course_id))
    or exists (select 1 from course_lessons l join library_items i on i.id = l.library_item_id
                where i.content->>'path' = p_name and i.status = 'published' and public.course_visible(l.course_id))
    -- 106: tài liệu tập huấn (nội dung của chương trình tập huấn đã phát hành), chỉ nhân sự (giáo viên, cán bộ)
    or (public.is_staff() and exists (select 1 from training_program_units u join training_programs p on p.id = u.program_id
                where p.status = 'published' and u.detail->'docs' @> jsonb_build_array(jsonb_build_object('file', p_name))))
    -- 164: tệp nội dung chủ đề của khung chương trình KDI, nhân sự mọi đơn vị xem được
    or (public.is_staff() and exists (select 1 from program_topic_items x where x.file_path = p_name)), false)
$$;

notify pgrst, 'reload schema';
