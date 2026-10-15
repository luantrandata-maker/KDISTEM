-- 023. Kho chương trình, bài giảng, học liệu dùng chung (Bước 3)
--  • library_items: Bộ/Tỉnh/Sở/Phòng, đơn vị cung cấp (KDI Education) hoặc trường phát hành
--      - program  : chương trình / chủ đề, gồm các chủ đề con (units) liên kết tới bài giảng trong kho
--      - lesson   : bài giảng (cùng định dạng slide với trình soạn bài giảng của giáo viên)
--      - material : học liệu (video, tài liệu, đường dẫn)
--  • Phạm vi: children = mọi đơn vị trực thuộc; selected = đơn vị chọn (library_targets, gồm cả cấp dưới);
--    public = toàn hệ thống (chỉ đơn vị cung cấp / quản trị nền tảng).
--  • Trường/giáo viên "Dùng" một mục → tạo BẢN CỦA MÌNH (lesson_plans) để chỉnh sửa; không ghi đè khi kho cập nhật.
--    library_copies ghi lại ai đã dùng phiên bản nào → báo "có bản cập nhật" khi đơn vị phát hành ra bản mới.
-- Cần chạy sau 022.

-- ===== 1. Bảng =====
create table if not exists library_items (
  id uuid primary key default gen_random_uuid(),
  owner_org_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('program', 'lesson', 'material')),
  title text not null,
  summary text,
  subject text,
  grades text,
  program text check (program is null or program in ('CT1','CT2','CT3','CT4','CT5')),
  tags text[] not null default '{}',
  -- lesson: {slides:[...]} · material: {type: video|document|link|image, url} · program: {units:[{title, periods, objectives, lesson_ids:[]}]}
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  scope text not null default 'children' check (scope in ('children', 'selected', 'public')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version int not null default 0,            -- số lần phát hành
  published_at timestamptz,
  change_note text,                          -- ghi chú của lần phát hành gần nhất
  source_lesson_id uuid references lesson_plans(id) on delete set null,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_items_owner_idx on library_items (owner_org_id, status);
create index if not exists library_items_pub_idx on library_items (status, scope, kind);

create table if not exists library_targets (
  item_id uuid not null references library_items(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  primary key (item_id, org_id)
);
create table if not exists library_copies (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references library_items(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  adopted_by uuid references profiles(id) on delete set null default auth.uid(),
  adopted_version int not null,
  lesson_plan_id uuid references lesson_plans(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists library_copies_item_idx on library_copies (item_id);
create index if not exists library_copies_org_idx on library_copies (org_id, item_id);

alter table lesson_plans add column if not exists library_item_id uuid references library_items(id) on delete set null,
  add column if not exists library_version int;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists library_items_touch on library_items;
create trigger library_items_touch before update on library_items for each row execute function public.touch_updated_at();

-- ===== 2. Hàm =====
-- Đơn vị đang làm việc và mọi cấp trên của nó
create or replace function public.my_scope_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select public.my_org_id() where public.my_org_id() is not null
  union all
  select public.my_ancestor_orgs()
$$;

-- Được phát hành học liệu: quản trị trường, cán bộ quản lý, đơn vị cung cấp, quản trị nền tảng
create or replace function public.library_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_authority() or public.has_role(array['provider']) or public.is_platform_admin()
$$;

create or replace function public.library_item_owner(p_item uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select owner_org_id from library_items where id = p_item
$$;

-- Người dùng hiện tại có thấy mục này không (khớp chính sách đọc)
create or replace function public.library_visible(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from library_items i
     where i.id = p_item and public.is_staff()
       and (i.owner_org_id in (select public.my_org_tree())
            or (i.status = 'published' and (
                  i.scope = 'public'
                  or (i.scope = 'children' and i.owner_org_id in (select public.my_ancestor_orgs()))
                  or (i.scope = 'selected' and exists (select 1 from library_targets t
                        where t.item_id = i.id and t.org_id in (select public.my_scope_orgs())))))))
$$;

grant execute on function public.my_scope_orgs(), public.library_can_manage(), public.library_visible(uuid) to authenticated;

-- Cột tính toán cho API: tên / loại đơn vị phát hành (trường không đọc được hồ sơ của KDI hay Sở tỉnh khác,
-- nhưng cần hiện "nguồn" của học liệu mình thấy). select('*, owner_name, owner_type')
create or replace function public.owner_name(library_items) returns text
language sql stable security definer set search_path = public as $$ select name from organizations where id = $1.owner_org_id $$;
create or replace function public.owner_type(library_items) returns text
language sql stable security definer set search_path = public as $$ select type from organizations where id = $1.owner_org_id $$;
grant execute on function public.owner_name(library_items), public.owner_type(library_items) to authenticated;
revoke execute on function public.library_item_owner(uuid) from public, anon;
grant execute on function public.library_item_owner(uuid) to authenticated;

-- ===== 3. RLS =====
alter table library_items enable row level security;
alter table library_targets enable row level security;
alter table library_copies enable row level security;

create policy library_items_read on library_items for select to authenticated using (
  (select public.is_staff()) and (
    owner_org_id in (select public.my_org_tree())
    or (status = 'published' and (
          scope = 'public'
          or (scope = 'children' and owner_org_id in (select public.my_ancestor_orgs()))
          or (scope = 'selected' and exists (select 1 from library_targets t
                where t.item_id = library_items.id and t.org_id in (select public.my_scope_orgs())))))));
create policy library_items_insert on library_items for insert to authenticated with check (
  owner_org_id = (select public.my_org_id()) and (select public.library_can_manage())
  and (scope <> 'public' or (select public.is_platform_admin())
       or (select type from organizations where id = (select public.my_org_id())) = 'provider'));
create policy library_items_update on library_items for update to authenticated
  using (owner_org_id = (select public.my_org_id()) and (select public.library_can_manage()))
  with check (owner_org_id = (select public.my_org_id()) and (select public.library_can_manage())
    and (scope <> 'public' or (select public.is_platform_admin())
         or (select type from organizations where id = (select public.my_org_id())) = 'provider'));
create policy library_items_delete on library_items for delete to authenticated
  using (owner_org_id = (select public.my_org_id()) and (select public.library_can_manage()));

-- Đơn vị nhận: chủ mục thấy/chỉnh; đơn vị được chọn thấy dòng của mình
create policy library_targets_read on library_targets for select to authenticated using (
  public.library_item_owner(item_id) in (select public.my_org_tree()) or org_id in (select public.my_scope_orgs()));
create policy library_targets_write on library_targets for insert to authenticated with check (
  public.library_item_owner(item_id) = (select public.my_org_id()) and (select public.library_can_manage())
  and org_id in (select public.my_org_tree()) and org_id <> (select public.my_org_id()));
create policy library_targets_delete on library_targets for delete to authenticated using (
  public.library_item_owner(item_id) = (select public.my_org_id()) and (select public.library_can_manage()));

-- Lượt dùng: đơn vị dùng thấy của mình (và cấp trên thấy của cấp dưới); ghi chỉ qua library_adopt()
create policy library_copies_read on library_copies for select to authenticated using (
  (select public.is_staff()) and org_id in (select public.my_org_tree()));

grant select, insert, update, delete on library_items to authenticated;
grant select, insert, delete on library_targets to authenticated;
grant select on library_copies to authenticated;

-- ===== 4. Dùng một mục kho → bản của trường / giáo viên =====
-- p_template = true: quản trị trường tạo "bài giảng mẫu" của trường (mọi GV thấy); false: bản nháp của chính giáo viên
create or replace function public.library_adopt(p_item uuid, p_template boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i library_items; v_org uuid := public.my_org_id(); v_teacher uuid := public.my_teacher_id();
  v_slides jsonb; v_plan uuid; v_first uuid; v_ids uuid[] := '{}'; v_lesson uuid; v_tpl boolean;
begin
  if v_org is null or (select type from organizations where id = v_org) <> 'school' then
    raise exception 'Chỉ trường học dùng được học liệu vào bài giảng' using errcode = '42501';
  end if;
  if not public.library_visible(p_item) then raise exception 'Không tìm thấy học liệu' using errcode = '42501'; end if;
  select * into i from library_items where id = p_item;
  if i.status <> 'published' and i.owner_org_id <> v_org then raise exception 'Học liệu chưa phát hành' using errcode = '42501'; end if;
  v_tpl := coalesce(p_template, false) or v_teacher is null;
  if v_tpl and not public.is_admin() then raise exception 'Chỉ quản trị trường tạo bài giảng mẫu của trường' using errcode = '42501'; end if;

  if i.kind = 'program' then
    -- Dùng cả chương trình: lấy mọi bài giảng được liên kết (mà đơn vị này thấy)
    for v_lesson in
      select distinct (l.value #>> '{}')::uuid
        from jsonb_array_elements(coalesce(i.content->'units', '[]')) u, jsonb_array_elements(coalesce(u->'lesson_ids', '[]')) l
    loop
      if public.library_visible(v_lesson) then
        v_ids := v_ids || ((public.library_adopt(v_lesson, v_tpl))->>'lesson_plan_id')::uuid;
      end if;
    end loop;
    insert into library_copies (item_id, org_id, adopted_version, lesson_plan_id) values (i.id, v_org, i.version, v_ids[1]);
    return jsonb_build_object('kind', 'program', 'lesson_plan_ids', to_jsonb(v_ids), 'count', coalesce(array_length(v_ids, 1), 0));
  end if;

  if i.kind = 'lesson' then
    v_slides := coalesce(i.content->'slides', '[]'::jsonb);
  else
    v_slides := jsonb_build_array(
      jsonb_build_object('id', 's1', 'kind', 'title', 'title', i.title, 'body', coalesce(i.summary, '')),
      case when i.content->>'type' in ('video', 'image')
        then jsonb_build_object('id', 's2', 'kind', 'media', 'title', i.title, 'url', coalesce(i.content->>'url', ''))
        else jsonb_build_object('id', 's2', 'kind', 'content', 'title', 'Tài liệu tham khảo', 'body', coalesce(i.content->>'url', '')) end);
  end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, is_template, status, summary, slides, library_item_id, library_version)
    values (v_org, case when v_tpl then null else v_teacher end, case when v_tpl then 'Mẫu: ' || i.title else i.title end,
            i.subject, i.grades, i.program, v_tpl, 'draft', i.summary, v_slides, i.id, i.version)
    returning id into v_plan;
  insert into library_copies (item_id, org_id, adopted_version, lesson_plan_id) values (i.id, v_org, i.version, v_plan);
  return jsonb_build_object('kind', i.kind, 'lesson_plan_id', v_plan);
end $$;
grant execute on function public.library_adopt(uuid, boolean) to authenticated;

-- ===== 5. Phát hành (tăng phiên bản, báo các trường đã dùng) =====
create or replace function public.library_publish(p_item uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare i library_items; u record; v int;
begin
  select * into i from library_items where id = p_item for update;
  if i.id is null or i.owner_org_id is distinct from public.my_org_id() or not public.library_can_manage() then
    raise exception 'Bạn không phát hành được mục này' using errcode = '42501';
  end if;
  if i.kind = 'lesson' and jsonb_array_length(coalesce(i.content->'slides', '[]')) = 0 then raise exception 'Bài giảng chưa có slide nào'; end if;
  if i.kind = 'material' and coalesce(trim(i.content->>'url'), '') = '' then raise exception 'Học liệu chưa có đường dẫn'; end if;
  update library_items set status = 'published', version = version + 1, published_at = now(), change_note = nullif(trim(p_note), '')
   where id = i.id returning version into v;
  -- Báo người đã dùng bản cũ (một thông báo cho mỗi người, theo đơn vị)
  if v > 1 then
    for u in select distinct c.adopted_by, c.org_id from library_copies c where c.item_id = i.id and c.adopted_by is not null loop
      perform public.notify_user(u.adopted_by, u.org_id, 'library', 'Học liệu có bản cập nhật: ' || i.title,
        'Phiên bản ' || v || coalesce(' — ' || nullif(trim(p_note), ''), '') || '. Bản của bạn không bị thay đổi.',
        'Thư viện STEM', null, i.id, true);
    end loop;
  end if;
  return v;
end $$;
create or replace function public.library_unpublish(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update library_items set status = 'archived'
   where id = p_item and owner_org_id = public.my_org_id() and public.library_can_manage();
  if not found then raise exception 'Bạn không thu hồi được mục này' using errcode = '42501'; end if;
end $$;
grant execute on function public.library_publish(uuid, text), public.library_unpublish(uuid) to authenticated;

-- Thống kê lượt dùng cho đơn vị phát hành (đếm cả trường ngoài phạm vi đọc của mình, chỉ trả về con số)
create or replace function public.library_stats()
returns table(item_id uuid, schools int, copies int, outdated int)
language sql stable security definer set search_path = public as $$
  select c.item_id, count(distinct c.org_id)::int, count(*)::int,
         count(*) filter (where c.adopted_version < i.version)::int
    from library_copies c join library_items i on i.id = c.item_id
   where i.owner_org_id in (select public.my_org_tree()) and public.is_staff()
   group by c.item_id
$$;
grant execute on function public.library_stats() to authenticated;

-- Quyền chức năng (mặc định: GV, NV xem; quản trị đầy đủ)
insert into role_permissions (role_id, module, can_view, can_detail, can_create, can_edit, can_delete)
select r.id, 'library', true, true, r.key in ('principal', 'it_admin'), r.key in ('principal', 'it_admin'), r.key in ('principal', 'it_admin')
  from roles r where r.org_id is null and r.key in ('principal', 'it_admin', 'teacher', 'office_staff')
on conflict do nothing;

-- ===== 6. Dữ liệu mẫu: Sở GD&ĐT Hưng Yên và KDI Education phát hành =====
do $$
declare v_so uuid; v_kdi uuid; l1 uuid; l2 uuid; l3 uuid;
begin
  select id into v_so from organizations where code = 'SO-HY';
  select id into v_kdi from organizations where is_platform limit 1;
  if v_so is null or exists (select 1 from library_items where owner_org_id = v_so) then return; end if;

  insert into library_items (owner_org_id, kind, title, summary, subject, grades, program, tags, content, scope, status, version, published_at, created_by)
  values (v_so, 'lesson', 'Robot dò line: cảm biến hồng ngoại', 'Học sinh lắp và lập trình robot đi theo vạch đen; tìm hiểu cảm biến hồng ngoại.',
          'Tin học', '8,9', 'CT4', '{robot,cảm biến}',
          jsonb_build_object('slides', jsonb_build_array(
            jsonb_build_object('id','a1','kind','title','title','Robot dò line','body','Chủ đề STEM — Sở GD&ĐT Hưng Yên'),
            jsonb_build_object('id','a2','kind','content','title','Cảm biến hồng ngoại hoạt động thế nào?','body','Vạch đen hấp thụ ánh sáng, nền trắng phản xạ.\nRobot đọc tín hiệu hai mắt cảm biến để rẽ trái/phải.'),
            jsonb_build_object('id','a3','kind','question','title','Khi mắt trái thấy vạch đen, robot nên?','options',jsonb_build_array('Rẽ trái','Rẽ phải','Dừng lại'),'answer',0),
            jsonb_build_object('id','a4','kind','task','title','Lắp robot và chạy thử trên sa bàn','body','Mỗi nhóm 4 học sinh, ghi lại số lần robot đi lệch vạch.','minutes',20))),
          'children', 'published', 1, now() - interval '20 days', null) returning id into l1;
  insert into library_items (owner_org_id, kind, title, summary, subject, grades, program, tags, content, scope, status, version, published_at, created_by)
  values (v_so, 'lesson', 'Hệ thống tưới cây tự động', 'Thiết kế mạch tưới cây theo độ ẩm đất, đo đạc và báo cáo kết quả.',
          'Công nghệ', '7,8', 'CT3', '{IoT,môi trường}',
          jsonb_build_object('slides', jsonb_build_array(
            jsonb_build_object('id','b1','kind','title','title','Hệ thống tưới cây tự động','body','Dự án STEM liên môn Công nghệ – Sinh học'),
            jsonb_build_object('id','b2','kind','content','title','Nhiệm vụ','body','Cây cần bao nhiêu nước? Đo độ ẩm đất trước và sau khi tưới.'),
            jsonb_build_object('id','b3','kind','task','title','Lắp mạch cảm biến độ ẩm + máy bơm','minutes',25))),
          'children', 'published', 2, now() - interval '5 days', null) returning id into l2;
  insert into library_items (owner_org_id, kind, title, summary, subject, grades, content, scope, status, version, published_at, change_note)
  values (v_so, 'material', 'Quy định an toàn trong phòng STEM', 'Nội quy, quy trình sử dụng thiết bị điện, dụng cụ cắt và hoá chất.',
          null, '6,7,8,9', jsonb_build_object('type', 'link', 'url', 'https://moet.gov.vn'), 'children', 'published', 1, now() - interval '30 days', null);
  insert into library_items (owner_org_id, kind, title, summary, subject, grades, program, content, scope, status, version, published_at)
  values (v_so, 'program', 'Chương trình STEM khối 8 — Sở GD&ĐT Hưng Yên', 'Khung chủ đề STEM khuyến nghị cho khối 8 năm học 2026–2027.',
          null, '8', 'CT3',
          jsonb_build_object('units', jsonb_build_array(
            jsonb_build_object('title', 'Chủ đề 1: Nông nghiệp thông minh', 'periods', 4, 'objectives', 'Đo độ ẩm, điều khiển bơm theo cảm biến', 'lesson_ids', jsonb_build_array(l2)),
            jsonb_build_object('title', 'Chủ đề 2: Robot tự hành', 'periods', 6, 'objectives', 'Cảm biến hồng ngoại, thuật toán dò line', 'lesson_ids', jsonb_build_array(l1)),
            jsonb_build_object('title', 'Chủ đề 3: Ngày hội sản phẩm STEM', 'periods', 2, 'objectives', 'Trình bày, phản biện sản phẩm', 'lesson_ids', '[]'::jsonb))),
          'children', 'published', 1, now() - interval '3 days');

  if v_kdi is not null then
    insert into library_items (owner_org_id, kind, title, summary, subject, grades, program, tags, content, scope, status, version, published_at)
    values (v_kdi, 'lesson', 'Scratch: trò chơi hứng táo', 'Bài mở đầu lập trình kéo thả: sự kiện, biến điểm số, va chạm.',
            'Tin học', '6,7', 'CT2', '{scratch,lập trình}',
            jsonb_build_object('slides', jsonb_build_array(
              jsonb_build_object('id','c1','kind','title','title','Trò chơi hứng táo','body','Bài giảng mẫu của KDI Education'),
              jsonb_build_object('id','c2','kind','content','title','Ý tưởng trò chơi','body','Táo rơi từ trên xuống, giỏ di chuyển bằng phím mũi tên.\nMỗi quả hứng được +1 điểm.'),
              jsonb_build_object('id','c3','kind','task','title','Lập trình giỏ di chuyển và đếm điểm','minutes',25))),
            'public', 'published', 1, now() - interval '10 days') returning id into l3;
    insert into library_items (owner_org_id, kind, title, summary, grades, content, scope, status, version, published_at)
    values (v_kdi, 'material', 'Hướng dẫn sử dụng bộ kit IoT KDI', 'Sơ đồ chân, cách nạp chương trình và xử lý lỗi thường gặp.',
            '7,8,9', jsonb_build_object('type', 'link', 'url', 'https://scratch.mit.edu'), 'public', 'published', 1, now() - interval '12 days');
  end if;
end $$;

notify pgrst, 'reload schema';
