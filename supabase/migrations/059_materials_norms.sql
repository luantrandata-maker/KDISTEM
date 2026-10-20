-- 059. Học liệu theo chương trình & định mức vật tư (Phân hệ 2 — đợt 2)
--  • library_items: gắn chương trình / chủ đề / bài (058), loại học liệu mở rộng (giáo án, phiếu học tập, hình ảnh, video,
--    tài liệu hướng dẫn), tải tệp lên kho riêng tư 'learning-files', quyền sử dụng (chỉ xem / dùng / được chỉnh sửa),
--    lịch sử phiên bản phát hành (library_item_versions) và khôi phục bản cũ.
--  • material_catalog: danh mục vật tư tiêu hao, công cụ, thiết bị — KDI / Sở / Phòng / trường; dùng chung cho cấp dưới.
--    supplies.catalog_id: vật tư trong kho của trường ứng với mục danh mục (để so định mức với tồn kho).
--  • material_norms (+ material_norm_items): định mức vật tư theo sản phẩm, nhóm hoặc học sinh, gắn chương trình / bài /
--    học liệu; phiên bản, ban hành, thay thế; sao chép về trường để điều chỉnh.
--  • material_norm_proposals: trường / giáo viên đề xuất điều chỉnh định mức, đơn vị ban hành chấp nhận (tạo phiên bản mới) hoặc từ chối.
--  • material_norm_estimate(): dự trù vật tư cho lớp / số học sinh, so với tồn kho của trường.
-- Cần chạy sau 058.

-- ===== 0. Quyền ghi học liệu / định mức của một đơn vị =====
create or replace function public.library_can_write(p_org uuid, p_action text default 'edit') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((p_org = public.my_org_id() and public.is_staff()
                   and (public.is_admin() or public.is_authority() or public.has_role(array['provider']) or public.has_perm('library', p_action)))
      or (p_org = public.platform_org_id() and public.is_platform_admin()), false)
$$;
revoke all on function public.library_can_write(uuid, text) from public, anon;
grant execute on function public.library_can_write(uuid, text) to authenticated;

-- ===== 1. Học liệu theo chương trình, tệp, quyền sử dụng, phiên bản =====
alter table library_items
  add column if not exists program_id uuid references edu_programs(id) on delete set null,
  add column if not exists unit_id uuid references edu_program_units(id) on delete set null,
  add column if not exists usage_rights text not null default 'adapt',
  add column if not exists usage_note text;
alter table library_items drop constraint if exists library_items_usage_rights_check;
alter table library_items add constraint library_items_usage_rights_check check (usage_rights in ('view', 'use', 'adapt'));
create index if not exists library_items_program on library_items (program_id) where program_id is not null;

-- Loại học liệu (content.type): video, document, link, image, worksheet (phiếu học tập), lesson_plan (giáo án), guide (tài liệu hướng dẫn).
-- Nội dung: content.url (đường dẫn) hoặc content.path (tệp trong kho, thư mục đầu là id đơn vị phát hành) + file_name, size, mime.
create or replace function public.library_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'material' and coalesce(new.content->>'type', 'link') not in ('video', 'document', 'link', 'image', 'worksheet', 'lesson_plan', 'guide') then
    raise exception 'Loại học liệu không hợp lệ' using errcode = '22023';
  end if;
  if new.content ? 'path' and new.content->>'path' is not null
     and public.learning_file_org(new.content->>'path') is distinct from new.owner_org_id then
    raise exception 'Tệp học liệu phải thuộc thư mục của đơn vị phát hành' using errcode = '22023';
  end if;
  if new.unit_id is not null and not exists (select 1 from edu_program_units u where u.id = new.unit_id and u.program_id = new.program_id) then
    raise exception 'Bài / chủ đề không thuộc chương trình đã chọn' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists library_items_guard on library_items;
create trigger library_items_guard before insert or update on library_items for each row execute function public.library_items_guard();

create table if not exists library_item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references library_items(id) on delete cascade,
  version int not null,
  title text not null,
  summary text,
  content jsonb not null default '{}'::jsonb,
  usage_rights text,
  change_note text,
  published_by uuid references profiles(id) on delete set null default auth.uid(),
  published_at timestamptz not null default now(),
  unique (item_id, version)
);
alter table library_item_versions enable row level security;
drop policy if exists library_versions_read on library_item_versions;
create policy library_versions_read on library_item_versions for select to authenticated using (public.library_visible(item_id));
grant select on library_item_versions to authenticated;

-- Phát hành: chấp nhận học liệu có tệp (path) thay cho đường dẫn; lưu ảnh chụp phiên bản
create or replace function public.library_publish(p_item uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare i library_items; u record; v int;
begin
  select * into i from library_items where id = p_item for update;
  if i.id is null or i.owner_org_id is distinct from public.my_org_id() or not public.library_can_manage() then
    raise exception 'Bạn không phát hành được mục này' using errcode = '42501';
  end if;
  if i.kind = 'lesson' and jsonb_array_length(coalesce(i.content->'slides', '[]')) = 0 then raise exception 'Bài giảng chưa có slide nào'; end if;
  if i.kind = 'material' and coalesce(trim(i.content->>'url'), '') = '' and coalesce(trim(i.content->>'path'), '') = '' then
    raise exception 'Học liệu chưa có tệp hoặc đường dẫn';
  end if;
  update library_items set status = 'published', version = version + 1, published_at = now(), change_note = nullif(trim(p_note), '')
   where id = i.id returning version into v;
  insert into library_item_versions (item_id, version, title, summary, content, usage_rights, change_note)
    values (i.id, v, i.title, i.summary, i.content, i.usage_rights, nullif(trim(p_note), ''))
  on conflict (item_id, version) do nothing;
  if v > 1 then
    for u in select distinct c.adopted_by, c.org_id from library_copies c where c.item_id = i.id and c.adopted_by is not null loop
      perform public.notify_user(u.adopted_by, u.org_id, 'library', 'Học liệu có bản cập nhật: ' || i.title,
        'Phiên bản ' || v || coalesce(' — ' || nullif(trim(p_note), ''), '') || '. Bản của bạn không bị thay đổi.',
        'Thư viện STEM', null, i.id, true);
    end loop;
  end if;
  return v;
end $$;
grant execute on function public.library_publish(uuid, text) to authenticated;

-- Khôi phục nội dung một phiên bản cũ vào bản đang soạn (cần phát hành lại để thành phiên bản mới)
create or replace function public.library_restore_version(p_item uuid, p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare s library_item_versions;
begin
  if not exists (select 1 from library_items where id = p_item and owner_org_id = public.my_org_id()) or not public.library_can_manage() then
    raise exception 'Bạn không sửa được mục này' using errcode = '42501';
  end if;
  select * into s from library_item_versions where item_id = p_item and version = p_version;
  if s.id is null then raise exception 'Không có phiên bản này' using errcode = '22023'; end if;
  update library_items set title = s.title, summary = s.summary, content = s.content, usage_rights = coalesce(s.usage_rights, usage_rights),
         status = case when status = 'published' then 'draft' else status end
   where id = p_item;
end $$;
revoke all on function public.library_restore_version(uuid, int) from public, anon;
grant execute on function public.library_restore_version(uuid, int) to authenticated;

-- Dùng học liệu: "chỉ xem" thì không tạo bản của trường
create or replace function public.library_adopt_rights() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select usage_rights from library_items where id = new.item_id) = 'view' then
    raise exception 'Học liệu này chỉ được xem, không sao chép vào bài giảng' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists library_copies_rights on library_copies;
create trigger library_copies_rights before insert on library_copies for each row execute function public.library_adopt_rights();

-- Tệp trong kho: học sinh chỉ đọc tệp học liệu đã phát hành tới trường mình (trước: mọi học liệu đã phát hành)
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
                where v.content->>'path' = p_name and public.library_visible(i.id)), false)
$$;

-- ===== 2. Danh mục vật tư, công cụ, thiết bị =====
create table if not exists material_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'supply' check (kind in ('supply', 'tool', 'equipment')),   -- vật tư tiêu hao / công cụ / thiết bị
  unit text not null default 'cái',
  spec text,                                   -- quy cách, thông số
  unit_price numeric(14,0) check (unit_price is null or unit_price >= 0),
  reusable boolean not null default false,     -- dùng lại được (công cụ, thiết bị) — không nhân theo số buổi
  scope text not null default 'children' check (scope in ('own', 'children')),
  active boolean not null default true,
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists material_catalog_code on material_catalog (org_id, lower(code)) where code is not null;
create index if not exists material_catalog_org on material_catalog (org_id, kind);
drop trigger if exists material_catalog_touch on material_catalog;
create trigger material_catalog_touch before update on material_catalog for each row execute function public.touch_updated_at();

alter table supplies add column if not exists catalog_id uuid references material_catalog(id) on delete set null;
create index if not exists supplies_catalog on supplies (catalog_id) where catalog_id is not null;

create or replace function public.material_shared_visible(p_org uuid, p_scope text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (p_org in (select public.my_org_tree())
    or (p_scope = 'children' and (p_org = public.platform_org_id() or p_org in (select public.my_ancestor_orgs()))))
$$;
revoke all on function public.material_shared_visible(uuid, text) from public, anon;
grant execute on function public.material_shared_visible(uuid, text) to authenticated;

alter table material_catalog enable row level security;
drop policy if exists material_catalog_read on material_catalog;
create policy material_catalog_read on material_catalog for select to authenticated using (public.material_shared_visible(org_id, scope));
drop policy if exists material_catalog_insert on material_catalog;
create policy material_catalog_insert on material_catalog for insert to authenticated with check (public.library_can_write(org_id, 'create'));
drop policy if exists material_catalog_update on material_catalog;
create policy material_catalog_update on material_catalog for update to authenticated
  using (public.library_can_write(org_id, 'edit')) with check (public.library_can_write(org_id, 'edit'));
drop policy if exists material_catalog_delete on material_catalog;
create policy material_catalog_delete on material_catalog for delete to authenticated using (public.library_can_write(org_id, 'delete'));
grant select, insert, update, delete on material_catalog to authenticated;

-- ===== 3. Định mức vật tư =====
create table if not exists material_norms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  family_id uuid not null,
  version_no int not null default 1 check (version_no >= 1),
  title text not null check (length(trim(title)) > 0),
  basis text not null default 'group' check (basis in ('product', 'group', 'student')),   -- định mức cho 1 sản phẩm / 1 nhóm / 1 học sinh
  group_size int not null default 4 check (group_size between 1 and 20),                   -- số học sinh mỗi nhóm (dự trù theo nhóm)
  sessions int not null default 1 check (sessions between 1 and 50),                       -- số buổi thực hành dùng định mức
  program_id uuid references edu_programs(id) on delete set null,
  unit_id uuid references edu_program_units(id) on delete set null,
  library_item_id uuid references library_items(id) on delete set null,
  subject text,
  grade smallint check (grade is null or grade between 1 and 12),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded', 'archived')),
  scope text not null default 'children' check (scope in ('own', 'children')),
  source_id uuid references material_norms(id) on delete set null,     -- sao chép / phiên bản từ
  replaced_by uuid references material_norms(id) on delete set null,
  published_at timestamptz,
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists material_norms_org on material_norms (org_id, status);
create index if not exists material_norms_family on material_norms (family_id);
create index if not exists material_norms_program on material_norms (program_id) where program_id is not null;
drop trigger if exists material_norms_touch on material_norms;
create trigger material_norms_touch before update on material_norms for each row execute function public.touch_updated_at();

create table if not exists material_norm_items (
  id uuid primary key default gen_random_uuid(),
  norm_id uuid not null references material_norms(id) on delete cascade,
  seq int not null default 0,
  catalog_id uuid references material_catalog(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  unit text not null default 'cái',
  kind text not null default 'supply' check (kind in ('supply', 'tool', 'equipment')),
  qty numeric(12,2) not null check (qty > 0),
  reusable boolean not null default false,
  note text
);
create index if not exists material_norm_items_norm on material_norm_items (norm_id, seq);

create or replace function public.material_norms_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.family_id := coalesce(new.family_id, new.id);
    if new.status <> 'draft' then raise exception 'Định mức mới phải là bản nháp' using errcode = '22023'; end if;
    new.published_at := null; new.replaced_by := null;
  else
    new.org_id := old.org_id; new.family_id := old.family_id; new.version_no := old.version_no; new.created_by := old.created_by;
    if new.status is distinct from old.status and coalesce(current_setting('app.norm_status', true), '') <> 'on' then
      raise exception 'Đổi trạng thái định mức bằng nút Ban hành / Lưu trữ' using errcode = '42501';
    end if;
    if old.status <> 'draft' and coalesce(current_setting('app.norm_status', true), '') <> 'on'
       and (new.title, new.basis, new.group_size, new.sessions, new.program_id, new.unit_id, new.library_item_id, new.subject, new.grade)
           is distinct from (old.title, old.basis, old.group_size, old.sessions, old.program_id, old.unit_id, old.library_item_id, old.subject, old.grade) then
      raise exception 'Định mức đã ban hành — tạo phiên bản mới để sửa' using errcode = '22023';
    end if;
  end if;
  if new.unit_id is not null and not exists (select 1 from edu_program_units u where u.id = new.unit_id and u.program_id = new.program_id) then
    raise exception 'Bài / chủ đề không thuộc chương trình đã chọn' using errcode = '22023';
  end if;
  if (select type from organizations where id = new.org_id) = 'school' then new.scope := 'own'; end if;
  return new;
end $$;
drop trigger if exists material_norms_guard on material_norms;
create trigger material_norms_guard before insert or update on material_norms for each row execute function public.material_norms_guard();
create or replace function public.material_norms_block_delete() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' and coalesce(current_setting('app.norm_status', true), '') <> 'on' then
    raise exception 'Định mức đang ban hành — lưu trữ trước khi xoá' using errcode = '22023';
  end if;
  return old;
end $$;
drop trigger if exists material_norms_block_delete on material_norms;
create trigger material_norms_block_delete before delete on material_norms for each row execute function public.material_norms_block_delete();

create or replace function public.material_norm_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_norm uuid := coalesce(new.norm_id, old.norm_id); c material_catalog;
begin
  if coalesce(current_setting('app.norm_status', true), '') <> 'on'
     and (select status from material_norms where id = v_norm) <> 'draft' then
    raise exception 'Định mức đã ban hành — tạo phiên bản mới để sửa' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.norm_id <> old.norm_id then raise exception 'Không chuyển dòng sang định mức khác' using errcode = '22023'; end if;
  if tg_op <> 'DELETE' and new.catalog_id is not null then
    select * into c from material_catalog where id = new.catalog_id;
    if c.id is null then raise exception 'Không tìm thấy vật tư trong danh mục' using errcode = '22023'; end if;
    if tg_op = 'INSERT' or new.catalog_id is distinct from old.catalog_id then
      new.name := c.name; new.unit := c.unit; new.kind := c.kind; new.reusable := c.reusable;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists material_norm_items_guard on material_norm_items;
create trigger material_norm_items_guard before insert or update or delete on material_norm_items for each row execute function public.material_norm_items_guard();

create or replace function public.material_norm_org(p_norm uuid) returns uuid
language sql stable security definer set search_path = public as $$ select org_id from material_norms where id = p_norm $$;
create or replace function public.material_norm_visible(p_norm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from material_norms n where n.id = p_norm and public.is_staff()
                  and (n.org_id in (select public.my_org_tree())
                       or (n.status in ('published', 'superseded') and public.material_shared_visible(n.org_id, n.scope))))
$$;
revoke all on function public.material_norm_org(uuid), public.material_norm_visible(uuid) from public, anon;
grant execute on function public.material_norm_org(uuid), public.material_norm_visible(uuid) to authenticated;

alter table material_norms enable row level security;
alter table material_norm_items enable row level security;
drop policy if exists material_norms_read on material_norms;
create policy material_norms_read on material_norms for select to authenticated using (
  (select public.is_staff()) and (org_id in (select public.my_org_tree())
    or (status in ('published', 'superseded') and public.material_shared_visible(org_id, scope))));
drop policy if exists material_norms_insert on material_norms;
create policy material_norms_insert on material_norms for insert to authenticated with check (public.library_can_write(org_id, 'create'));
drop policy if exists material_norms_update on material_norms;
create policy material_norms_update on material_norms for update to authenticated
  using (public.library_can_write(org_id, 'edit')) with check (public.library_can_write(org_id, 'edit'));
drop policy if exists material_norms_delete on material_norms;
create policy material_norms_delete on material_norms for delete to authenticated using (public.library_can_write(org_id, 'delete'));

drop policy if exists material_norm_items_read on material_norm_items;
create policy material_norm_items_read on material_norm_items for select to authenticated using (exists (select 1 from material_norms n where n.id = norm_id));
drop policy if exists material_norm_items_write on material_norm_items;
create policy material_norm_items_write on material_norm_items for all to authenticated
  using (public.library_can_write(public.material_norm_org(norm_id), 'edit'))
  with check (public.library_can_write(public.material_norm_org(norm_id), 'edit'));
grant select, insert, update, delete on material_norms, material_norm_items to authenticated;

-- Nhân bản định mức (sao chép về đơn vị / phiên bản mới). Nội bộ.
create or replace function public.material_norm_clone(p_src uuid, p_org uuid, p_family uuid, p_version int) returns uuid
language plpgsql security definer set search_path = public as $$
declare s material_norms; v_new uuid := gen_random_uuid();
begin
  select * into s from material_norms where id = p_src;
  insert into material_norms (id, org_id, family_id, version_no, title, basis, group_size, sessions, program_id, unit_id, library_item_id,
                              subject, grade, status, scope, source_id, note)
  values (v_new, p_org, coalesce(p_family, v_new), p_version, s.title, s.basis, s.group_size, s.sessions, s.program_id, s.unit_id,
          s.library_item_id, s.subject, s.grade, 'draft', case when p_org = s.org_id then s.scope else 'own' end, s.id, s.note);
  insert into material_norm_items (norm_id, seq, catalog_id, name, unit, kind, qty, reusable, note)
  select v_new, i.seq, i.catalog_id, i.name, i.unit, i.kind, i.qty, i.reusable, i.note from material_norm_items i where i.norm_id = p_src;
  return v_new;
end $$;
revoke all on function public.material_norm_clone(uuid, uuid, uuid, int) from public, anon, authenticated;

create or replace function public.material_norm_copy(p_norm uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.material_norm_visible(p_norm) or not public.library_can_write(public.my_org_id(), 'create')
     or public.material_norm_org(p_norm) = public.my_org_id() then
    raise exception 'Không sao chép được định mức này' using errcode = '42501';
  end if;
  return public.material_norm_clone(p_norm, public.my_org_id(), null, 1);
end $$;

create or replace function public.material_norm_new_version(p_norm uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s material_norms; v int;
begin
  select * into s from material_norms where id = p_norm;
  if s.id is null or not public.library_can_write(s.org_id, 'create') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if exists (select 1 from material_norms where family_id = s.family_id and status = 'draft') then
    raise exception 'Định mức đã có một phiên bản đang soạn' using errcode = '22023';
  end if;
  select max(version_no) + 1 into v from material_norms where family_id = s.family_id;
  return public.material_norm_clone(p_norm, s.org_id, s.family_id, v);
end $$;

-- Ban hành (thay thế bản đang ban hành cùng họ) / lưu trữ / mở lại bản lưu trữ
create or replace function public.material_norm_set_status(p_norm uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare s material_norms;
begin
  select * into s from material_norms where id = p_norm for update;
  if s.id is null or not public.library_can_write(s.org_id, 'edit') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  perform set_config('app.norm_status', 'on', true);
  if p_status = 'published' then
    if s.status <> 'draft' then raise exception 'Chỉ ban hành bản nháp' using errcode = '22023'; end if;
    if not exists (select 1 from material_norm_items where norm_id = s.id) then raise exception 'Định mức chưa có vật tư nào' using errcode = '22023'; end if;
    update material_norms set status = 'superseded', replaced_by = s.id where family_id = s.family_id and id <> s.id and status = 'published';
    update material_norms set status = 'published', published_at = now() where id = s.id;
  elsif p_status = 'archived' then
    update material_norms set status = 'archived' where id = s.id;
  elsif p_status = 'draft' then
    if s.status <> 'archived' or exists (select 1 from material_norms where family_id = s.family_id and id <> s.id and status = 'draft') then
      raise exception 'Không mở lại được bản này' using errcode = '22023';
    end if;
    update material_norms set status = 'draft', published_at = null where id = s.id;
  else
    raise exception 'Trạng thái không hợp lệ' using errcode = '22023';
  end if;
  perform set_config('app.norm_status', '', true);
  return p_status;
end $$;
revoke all on function public.material_norm_copy(uuid), public.material_norm_new_version(uuid), public.material_norm_set_status(uuid, text) from public, anon;
grant execute on function public.material_norm_copy(uuid), public.material_norm_new_version(uuid), public.material_norm_set_status(uuid, text) to authenticated;

-- ===== 4. Đề xuất điều chỉnh định mức =====
-- items: [{ "item_id": uuid | null, "catalog_id": uuid | null, "name": text, "unit": text, "qty": number (0 = bỏ), "note": text }]
create table if not exists material_norm_proposals (
  id uuid primary key default gen_random_uuid(),
  norm_id uuid not null references material_norms(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade default public.my_org_id(),   -- đơn vị đề xuất
  proposed_by uuid references profiles(id) on delete set null default auth.uid(),
  reason text not null check (length(trim(reason)) > 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  response text,
  new_norm_id uuid references material_norms(id) on delete set null,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists material_norm_proposals_norm on material_norm_proposals (norm_id, status);

create or replace function public.material_norm_proposals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.org_id := public.my_org_id(); new.proposed_by := auth.uid(); end if;
    new.status := 'pending';
    new.response := null; new.decided_by := null; new.decided_at := null; new.new_norm_id := null;
    if jsonb_array_length(new.items) = 0 then raise exception 'Đề xuất chưa có dòng điều chỉnh nào' using errcode = '22023'; end if;
  elsif coalesce(current_setting('app.norm_status', true), '') <> 'on'
        -- khoá ngoài tự đặt null khi xoá giáo án / định mức liên quan
        and not ((to_jsonb(new) - 'lesson_plan_id' - 'new_norm_id') = (to_jsonb(old) - 'lesson_plan_id' - 'new_norm_id')
                 and (to_jsonb(new)->>'lesson_plan_id' is null or to_jsonb(new)->>'lesson_plan_id' = to_jsonb(old)->>'lesson_plan_id')
                 and (new.new_norm_id is null or new.new_norm_id = old.new_norm_id)) then
    -- người đề xuất chỉ rút lại được đề xuất đang chờ
    if old.status <> 'pending' or new.status not in ('pending', 'withdrawn') or old.proposed_by is distinct from auth.uid()
       or (new.norm_id, new.org_id, new.proposed_by, new.response, new.decided_by, new.decided_at, new.new_norm_id)
          is distinct from (old.norm_id, old.org_id, old.proposed_by, old.response, old.decided_by, old.decided_at, old.new_norm_id) then
      raise exception 'Không sửa được đề xuất này' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists material_norm_proposals_guard on material_norm_proposals;
create trigger material_norm_proposals_guard before insert or update on material_norm_proposals for each row execute function public.material_norm_proposals_guard();

alter table material_norm_proposals enable row level security;
drop policy if exists material_norm_proposals_read on material_norm_proposals;
create policy material_norm_proposals_read on material_norm_proposals for select to authenticated using (
  (select public.is_staff()) and (org_id in (select public.my_org_tree()) or public.material_norm_org(norm_id) in (select public.my_org_tree())));
drop policy if exists material_norm_proposals_insert on material_norm_proposals;
create policy material_norm_proposals_insert on material_norm_proposals for insert to authenticated with check (
  (select public.is_staff()) and public.material_norm_visible(norm_id)
  and exists (select 1 from material_norms n where n.id = norm_id and n.status = 'published'));
drop policy if exists material_norm_proposals_update on material_norm_proposals;
create policy material_norm_proposals_update on material_norm_proposals for update to authenticated
  using (proposed_by = auth.uid()) with check (proposed_by = auth.uid());
grant select, insert, update on material_norm_proposals to authenticated;

-- Đơn vị ban hành quyết định. Chấp nhận (p_apply) → tạo phiên bản nháp mới đã áp các dòng đề xuất.
create or replace function public.material_norm_decide(p_proposal uuid, p_accept boolean, p_response text default null, p_apply boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pr material_norm_proposals; v_new uuid; x jsonb; v_src uuid; v_item uuid; v_seq int;
begin
  select * into pr from material_norm_proposals where id = p_proposal for update;
  if pr.id is null or not public.library_can_write(public.material_norm_org(pr.norm_id), 'edit') then
    raise exception 'Không có quyền' using errcode = '42501';
  end if;
  if pr.status <> 'pending' then raise exception 'Đề xuất đã được xử lý' using errcode = '22023'; end if;
  if p_accept and p_apply then
    v_new := (select id from material_norms where family_id = (select family_id from material_norms where id = pr.norm_id) and status = 'draft' limit 1);
    if v_new is null then v_new := public.material_norm_new_version(pr.norm_id); end if;
    for x in select * from jsonb_array_elements(pr.items) loop
      -- dòng tương ứng trong bản mới: cùng vật tư danh mục hoặc cùng tên
      v_src := nullif(x->>'item_id', '')::uuid;
      select i.id into v_item from material_norm_items i
       where i.norm_id = v_new and (
         (v_src is not null and exists (select 1 from material_norm_items o where o.id = v_src
                                         and ((o.catalog_id is not null and o.catalog_id = i.catalog_id) or lower(o.name) = lower(i.name))))
         or (nullif(x->>'catalog_id', '') is not null and i.catalog_id = (x->>'catalog_id')::uuid)
         or (v_src is null and nullif(x->>'catalog_id', '') is null and lower(i.name) = lower(trim(x->>'name'))))
       limit 1;
      if coalesce((x->>'qty')::numeric, 0) <= 0 then
        if v_item is not null then delete from material_norm_items where id = v_item; end if;
      elsif v_item is not null then
        update material_norm_items set qty = (x->>'qty')::numeric, note = coalesce(nullif(x->>'note', ''), note) where id = v_item;
      else
        select coalesce(max(seq), 0) + 1 into v_seq from material_norm_items where norm_id = v_new;
        insert into material_norm_items (norm_id, seq, catalog_id, name, unit, qty, note)
        values (v_new, v_seq, nullif(x->>'catalog_id', '')::uuid, coalesce(nullif(trim(x->>'name'), ''), 'Vật tư'),
                coalesce(nullif(x->>'unit', ''), 'cái'), (x->>'qty')::numeric, nullif(x->>'note', ''));
      end if;
    end loop;
    update material_norms set note = concat_ws(E'\n', note, 'Điều chỉnh theo đề xuất: ' || pr.reason) where id = v_new;
  end if;
  perform set_config('app.norm_status', 'on', true);
  update material_norm_proposals set status = case when p_accept then 'accepted' else 'rejected' end,
         response = nullif(trim(p_response), ''), decided_by = auth.uid(), decided_at = now(), new_norm_id = v_new
   where id = pr.id;
  perform set_config('app.norm_status', '', true);
  if pr.proposed_by is not null then
    perform public.notify_user(pr.proposed_by, pr.org_id, 'library',
      case when p_accept then 'Đề xuất điều chỉnh định mức được chấp nhận' else 'Đề xuất điều chỉnh định mức bị từ chối' end,
      coalesce(nullif(trim(p_response), ''), (select title from material_norms where id = pr.norm_id)), 'Định mức vật tư', null, pr.norm_id, true);
  end if;
  return v_new;
end $$;
revoke all on function public.material_norm_decide(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.material_norm_decide(uuid, boolean, text, boolean) to authenticated;

-- ===== 5. Dự trù vật tư theo định mức =====
-- Số học sinh lấy từ lớp (nếu có) hoặc p_students; số nhóm = trần(học sinh / số HS mỗi nhóm) nếu không nhập;
-- số sản phẩm mặc định = số nhóm. Vật tư tiêu hao nhân thêm số buổi; công cụ / thiết bị dùng lại thì không.
-- Tồn kho: vật tư của trường (supplies) gắn cùng mục danh mục, trùng mã (sku = mã danh mục) hoặc trùng tên.
create or replace function public.material_norm_estimate(p_norm uuid, p_class uuid default null, p_students int default null,
                                                         p_groups int default null, p_products int default null, p_sessions int default null)
returns table (item_id uuid, name text, unit text, kind text, reusable boolean, per_qty numeric, multiplier int, need numeric,
               stock numeric, shortage numeric, unit_price numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare n material_norms; v_students int; v_groups int; v_products int; v_sessions int; v_org uuid := public.my_org_id();
begin
  if not public.material_norm_visible(p_norm) then raise exception 'Không tìm thấy định mức' using errcode = '42501'; end if;
  select * into n from material_norms where id = p_norm;
  if p_class is not null then
    if not exists (select 1 from classes c where c.id = p_class and c.org_id in (select public.my_org_tree())) then
      raise exception 'Không tìm thấy lớp' using errcode = '42501';
    end if;
    select count(*)::int into v_students from students s where s.class_id = p_class;
    v_org := (select org_id from classes where id = p_class);
  end if;
  v_students := greatest(coalesce(p_students, v_students, 0), 0);
  v_groups := greatest(coalesce(p_groups, ceil(v_students::numeric / n.group_size)::int), 0);
  v_products := greatest(coalesce(p_products, v_groups), 0);
  v_sessions := greatest(coalesce(p_sessions, n.sessions), 1);
  return query
  with m as (
    select i.*, (case n.basis when 'student' then v_students when 'group' then v_groups else v_products end)
                 * (case when i.reusable then 1 else v_sessions end) as mul
      from material_norm_items i where i.norm_id = p_norm
  )
  select m.id, m.name, m.unit, m.kind, m.reusable, m.qty, m.mul::int, m.qty * m.mul,
         (select sum(s.qty) from supplies s where s.org_id = v_org
            and ((m.catalog_id is not null and (s.catalog_id = m.catalog_id or (s.catalog_id is null and lower(s.sku) = lower(c.code)))) or lower(trim(s.name)) = lower(trim(m.name)))),
         greatest(m.qty * m.mul - coalesce((select sum(s.qty) from supplies s where s.org_id = v_org
            and ((m.catalog_id is not null and (s.catalog_id = m.catalog_id or (s.catalog_id is null and lower(s.sku) = lower(c.code)))) or lower(trim(s.name)) = lower(trim(m.name)))), 0), 0),
         c.unit_price, c.unit_price * m.qty * m.mul
    from m left join material_catalog c on c.id = m.catalog_id
   order by m.seq, m.name;
end $$;
revoke all on function public.material_norm_estimate(uuid, uuid, int, int, int, int) from public, anon;
grant execute on function public.material_norm_estimate(uuid, uuid, int, int, int, int) to authenticated;

-- Tên đơn vị ban hành cho API (trường không đọc được hồ sơ KDI / Sở tỉnh khác): select('*, owner_name')
create or replace function public.owner_name(material_catalog) returns text
language sql stable security definer set search_path = public as $$ select name from organizations where id = $1.org_id $$;
create or replace function public.owner_name(material_norms) returns text
language sql stable security definer set search_path = public as $$ select name from organizations where id = $1.org_id $$;
grant execute on function public.owner_name(material_catalog), public.owner_name(material_norms) to authenticated;

-- ===== 6. Dữ liệu mẫu =====
do $$
declare
  kdi uuid; so uuid; sch uuid; v_tin uuid; v_stem uuid; u uuid; n uuid; it uuid;
  c_kit uuid; c_pin uuid; c_bang uuid; c_day uuid; c_keo uuid; c_sensor uuid; c_bom uuid; c_ong uuid; c_dat uuid; c_kim uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  select id into sch from organizations where code = 'THCS-PH';
  if kdi is null or exists (select 1 from material_catalog where org_id = kdi) then return; end if;

  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'KIT-ROBOT', 'Bộ kit robot dò line KDI', 'equipment', 'bộ', 'Khung nhôm, 2 động cơ DC, cảm biến hồng ngoại 2 mắt, mạch điều khiển', 1250000, true) returning id into c_kit;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'PIN-AA', 'Pin AA', 'supply', 'viên', '1,5 V', 6000, false) returning id into c_pin;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'BANG-DEN', 'Băng dính đen kẻ sa bàn', 'supply', 'cuộn', 'Rộng 18 mm', 12000, false) returning id into c_bang;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'DAY-DIEN', 'Dây điện đơn 0,5 mm', 'supply', 'm', null, 3000, false) returning id into c_day;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'KEO-NEN', 'Keo nến', 'supply', 'thanh', 'Phi 11 mm', 2500, false) returning id into c_keo;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'CB-DOAM', 'Cảm biến độ ẩm đất', 'tool', 'cái', 'Đầu ra analog, 3,3–5 V', 35000, true) returning id into c_sensor;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'BOM-MINI', 'Máy bơm mini 5 V', 'tool', 'cái', null, 45000, true) returning id into c_bom;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'ONG-NUOC', 'Ống dẫn nước silicon', 'supply', 'm', 'Phi 6 mm', 8000, false) returning id into c_ong;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'SUNG-KEO', 'Súng bắn keo', 'tool', 'cái', '20 W', 65000, true) returning id into c_kim;
  if so is not null then
    insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
      (so, 'HY-DAT', 'Đất trồng hữu cơ', 'supply', 'kg', 'Bao 5 kg', 15000, false) returning id into c_dat;
  end if;
  -- Vật tư trong kho của trường ứng với danh mục
  if sch is not null then
    update supplies set catalog_id = c_pin where org_id = sch and sku = 'PIN-AA';
    update supplies set catalog_id = c_day where org_id = sch and sku = 'DAY-DIEN';
    update supplies set catalog_id = c_keo where org_id = sch and sku = 'KEO-NEN';
  end if;

  select id into v_stem from edu_programs where org_id = kdi and title like 'STEM CT2%' and status = 'published' limit 1;
  select id into v_tin from edu_programs where org_id = kdi and title like 'Tin học THCS%' and status = 'published' limit 1;

  -- Định mức KDI: robot dò line (theo nhóm 4 HS, 3 buổi), có 2 phiên bản
  select id into u from edu_program_units where program_id = v_stem and unit_type = 'lesson' order by seq limit 1;
  insert into material_norms (org_id, title, basis, group_size, sessions, program_id, unit_id, subject, grade, scope, note)
    values (kdi, 'Robot dò line — lắp ráp và thi đấu', 'group', 4, 3, v_stem, u, 'Công nghệ', 8, 'children', 'Định mức chuẩn KDI cho 1 nhóm 4 học sinh')
    returning id into n;
  insert into material_norm_items (norm_id, seq, catalog_id, name, qty, note) values
    (n, 1, c_kit, 'x', 1, null), (n, 2, c_pin, 'x', 4, 'Thay sau mỗi buổi'), (n, 3, c_bang, 'x', 1, 'Kẻ sa bàn chung'), (n, 4, c_keo, 'x', 2, null);
  perform set_config('app.norm_status', 'on', true);
  update material_norms set status = 'published', published_at = now() - interval '40 days' where id = n;
  perform set_config('app.norm_status', '', true);
  it := public.material_norm_clone(n, kdi, (select family_id from material_norms where id = n), 2);
  update material_norm_items set qty = 6 where norm_id = it and catalog_id = c_pin;
  insert into material_norm_items (norm_id, seq, catalog_id, name, qty) values (it, 5, c_kim, 'x', 1);
  perform set_config('app.norm_status', 'on', true);
  update material_norms set status = 'superseded', replaced_by = it where id = n;
  update material_norms set status = 'published', published_at = now() - interval '10 days', note = 'Bổ sung pin cho 3 buổi và súng bắn keo' where id = it;
  perform set_config('app.norm_status', '', true);
  n := it;

  -- Định mức Sở HY: hệ thống tưới cây tự động (theo sản phẩm), gắn bài giảng trong kho
  if so is not null then
    insert into material_norms (org_id, title, basis, group_size, sessions, library_item_id, subject, grade, scope)
      values (so, 'Hệ thống tưới cây tự động', 'product', 4, 2,
              (select id from library_items where owner_org_id = so and title = 'Hệ thống tưới cây tự động' limit 1), 'Công nghệ', 7, 'children')
      returning id into it;
    insert into material_norm_items (norm_id, seq, catalog_id, name, qty) values
      (it, 1, c_sensor, 'x', 1), (it, 2, c_bom, 'x', 1), (it, 3, c_ong, 'x', 1.5), (it, 4, c_day, 'x', 2), (it, 5, c_dat, 'x', 2);
    perform set_config('app.norm_status', 'on', true);
    update material_norms set status = 'published', published_at = now() - interval '15 days' where id = it;
    perform set_config('app.norm_status', '', true);
  end if;

  -- Trường đề xuất tăng pin cho robot
  if sch is not null then
    insert into material_norm_proposals (norm_id, org_id, reason, items)
      values (n, sch, 'Robot chạy 3 buổi liên tục, 6 viên pin/nhóm không đủ khi thi đấu',
              jsonb_build_array(jsonb_build_object('catalog_id', c_pin, 'name', 'Pin AA', 'unit', 'viên', 'qty', 8, 'note', 'Thêm 2 viên dự phòng')));
  end if;

  -- Học liệu theo chương trình: phiếu học tập, giáo án, video gắn bài của chương trình Tin học
  if v_tin is not null then
    select id into u from edu_program_units where program_id = v_tin and unit_type = 'lesson' order by seq limit 1;
    insert into library_items (owner_org_id, kind, title, summary, subject, grades, program_id, unit_id, content, scope, status, version, published_at, usage_rights)
    values (kdi, 'material', 'Phiếu học tập: Thông tin và dữ liệu', 'Phiếu nhóm phân loại ví dụ thông tin / dữ liệu, 10 phút.',
            'Tin học', '6', v_tin, u, jsonb_build_object('type', 'worksheet', 'url', 'https://kdi.edu.vn/hoc-lieu/phieu-thong-tin-du-lieu'),
            'public', 'published', 1, now() - interval '8 days', 'adapt'),
           (kdi, 'material', 'Giáo án mẫu: Thông tin và dữ liệu', 'Giáo án 2 tiết theo Công văn 5512, kèm phiếu học tập.',
            'Tin học', '6', v_tin, u, jsonb_build_object('type', 'lesson_plan', 'url', 'https://kdi.edu.vn/hoc-lieu/giao-an-bai-1'),
            'public', 'published', 2, now() - interval '2 days', 'adapt'),
           (kdi, 'material', 'Video: Máy tính xử lí thông tin như thế nào?', 'Video 4 phút dùng ở phần khởi động.',
            'Tin học', '6', v_tin, u, jsonb_build_object('type', 'video', 'url', 'https://www.youtube.com/watch?v=Z5JC9Ve1sfI'),
            'public', 'published', 1, now() - interval '8 days', 'view');
    insert into library_item_versions (item_id, version, title, summary, content, usage_rights, change_note, published_by, published_at)
    select i.id, g, i.title, i.summary, i.content, i.usage_rights, case when g = 2 then 'Bổ sung phần vận dụng' end, null, i.published_at - (i.version - g) * interval '20 days'
      from library_items i cross join generate_series(1, 2) g where i.owner_org_id = kdi and i.unit_id = u and g <= i.version;
  end if;
end $$;

notify pgrst, 'reload schema';
