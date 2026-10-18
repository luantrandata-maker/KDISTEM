-- 051: Dự án STEM của học sinh & Cuộc thi (KHKT của Bộ GD&ĐT, STEM / Robotics, tự cấu hình).
--   1. student_projects (+ project_members, project_logs): nhóm HS + GV hướng dẫn (và người hướng dẫn ngoài), lĩnh vực,
--      tóm tắt, tài liệu dạng đường link; nháp → gửi duyệt (engine phê duyệt 022, loại "project") → đã duyệt (đang thực hiện)
--      → hoàn thành. Nhật ký tiến độ / nhận xét. Phụ huynh xem dự án của con.
--   2. competitions: đơn vị nào cũng tổ chức được (trường / Phòng / Sở / KDI) — cấp cuộc thi theo đơn vị; mẫu KHKT
--      (lĩnh vực, hồ sơ, tiêu chí theo hướng dẫn của Bộ — đơn vị tổ chức chỉnh theo hướng dẫn năm hiện hành), STEM/Robotics,
--      hoặc tự cấu hình. Nhiều vòng, giới hạn số dự án mỗi trường, số HS mỗi dự án, cấp học, lệ phí (tuỳ chọn), chấm ẩn danh (tuỳ chọn).
--   3. competition_entries: trường nộp dự án đã duyệt; kiểm tra lĩnh vực, cấp học, số HS, hồ sơ bắt buộc, tóm tắt ≤ 250 từ (KHKT).
--   4. Ban giám khảo: cán bộ / GV có tài khoản (theo email) hoặc chuyên gia ngoài (tài khoản mã <mã đơn vị>.gk<n>, vai trò judge —
--      không là nhân sự, chỉ thấy bài được phân công). Phân công theo lĩnh vực, chấm theo tiêu chí, cảnh báo chênh điểm,
--      xếp hạng theo lĩnh vực, chọn vào vòng sau, trao giải. Lệ phí → tổng hợp doanh thu cho KDI.

-- ===== 0. Vai trò giám khảo =====
alter table roles drop constraint if exists roles_portal;
alter table roles add constraint roles_portal
  check (portal is null or portal in ('school_admin', 'teacher', 'student', 'department', 'platform', 'parent', 'judge'));
insert into roles (key, name, is_system, portal, description)
select 'judge', 'Giám khảo', true, 'judge', 'Chuyên gia chấm thi: chỉ xem và chấm các bài được phân công'
 where not exists (select 1 from roles where key = 'judge' and org_id is null);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                 where m.user_id = auth.uid() and m.org_id = public.my_org_id() and r.key not in ('student', 'parent', 'judge'))
$$;
create or replace function public.role_fits_org(p_role uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r, organizations o
     where r.id = p_role and o.id = p_org
       and case
             when r.org_id is not null then r.org_id = o.id
             when r.key = 'platform_admin' then o.is_platform
             when r.key = 'judge' then true
             when o.type = 'school' then r.key in ('principal','it_admin','teacher','office_staff','student','parent')
             else r.key = o.type
           end)
$$;

-- ===== 1. Dự án STEM =====
create table if not exists student_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(btrim(title)) >= 5),
  kind text not null default 'engineering' check (kind in ('science', 'engineering')),   -- KHKT: nghiên cứu khoa học / kỹ thuật
  field text,
  school_year text check (school_year is null or school_year ~ '^\d{4}-\d{4}$'),
  problem text,
  abstract text,
  mentor_teacher_id uuid references teachers(id) on delete set null,
  external_mentor text,
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),   -- [{label, url}]
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'completed')),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_projects_org on student_projects (org_id, created_at desc);
create table if not exists project_members (
  project_id uuid not null references student_projects(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  role text not null default 'member' check (role in ('leader', 'member')),
  primary key (project_id, student_id)
);
create index if not exists project_members_student on project_members (student_id);
create table if not exists project_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references student_projects(id) on delete cascade,
  author uuid references profiles(id) on delete set null default auth.uid(),
  author_name text,
  kind text not null default 'progress' check (kind in ('progress', 'feedback')),
  content text not null check (length(btrim(content)) > 0),
  link text,
  created_at timestamptz not null default now()
);
create index if not exists project_logs_project on project_logs (project_id, created_at);

create or replace function public.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members pm join students s on s.id = pm.student_id
                  where pm.project_id = p_project and s.profile_id = auth.uid())
$$;
create or replace function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from student_projects p where p.id = p_project and (
    (p.org_id = public.my_org_id() and public.is_staff())
    or public.is_project_member(p.id)
    or exists (select 1 from project_members pm where pm.project_id = p.id and public.is_guardian_of(pm.student_id))
    or (public.is_authority() and p.org_id in (select public.my_org_tree()))
    or public.is_platform_admin()))
$$;
-- Sửa nội dung: quản trị trường, GV hướng dẫn, thành viên (khi chưa hoàn thành)
create or replace function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from student_projects p where p.id = p_project and p.org_id = public.my_org_id() and (
    public.is_admin()
    or (p.mentor_teacher_id is not null and p.mentor_teacher_id = public.my_teacher_id())
    or (p.status <> 'completed' and public.is_project_member(p.id))))
$$;
grant execute on function public.is_project_member(uuid), public.can_view_project(uuid), public.can_edit_project(uuid) to authenticated;

create or replace function public.guard_student_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_engine boolean := coalesce(current_setting('app.approval_engine', true), 'off') = 'on';
begin
  new.updated_at := now();
  if new.mentor_teacher_id is not null and not exists (select 1 from teachers where id = new.mentor_teacher_id and org_id = new.org_id) then
    raise exception 'Giáo viên hướng dẫn không thuộc trường' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.links) l where coalesce(l->>'url', '') !~* '^https?://') then
    raise exception 'Đường link phải bắt đầu bằng http:// hoặc https://' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending') then raise exception 'Dự án mới phải ở trạng thái nháp hoặc gửi duyệt' using errcode = '22023'; end if;
    return new;
  end if;
  if v_engine or new.status is not distinct from old.status then return new; end if;
  if (old.status in ('draft', 'rejected') and new.status = 'pending')
     or (old.status = 'pending' and new.status in ('approved', 'rejected'))
     or (old.status = 'approved' and new.status = 'completed' and (public.is_admin() or old.mentor_teacher_id = public.my_teacher_id()))
     or (old.status = 'completed' and new.status = 'approved' and public.is_admin()) then
    return new;
  end if;
  raise exception 'Không chuyển được trạng thái dự án % → %', old.status, new.status using errcode = '22023';
end $$;
drop trigger if exists student_projects_status_guard on student_projects;
create trigger student_projects_status_guard before insert or update on student_projects for each row execute function public.guard_student_project();

create or replace function public.guard_project_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from students s join student_projects p on p.org_id = s.org_id where s.id = new.student_id and p.id = new.project_id) then
    raise exception 'Học sinh không thuộc trường của dự án' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists project_members_guard on project_members;
create trigger project_members_guard before insert or update on project_members for each row execute function public.guard_project_member();

alter table student_projects enable row level security;
alter table project_members enable row level security;
alter table project_logs enable row level security;
drop policy if exists student_projects_read on student_projects;
create policy student_projects_read on student_projects for select to authenticated using (public.can_view_project(id));
drop policy if exists student_projects_insert on student_projects;
create policy student_projects_insert on student_projects for insert to authenticated
  with check (org_id = public.my_org_id() and (public.is_admin() or public.my_teacher_id() is not null or public.my_student_id() is not null));
drop policy if exists student_projects_update on student_projects;
create policy student_projects_update on student_projects for update to authenticated
  using (public.can_edit_project(id)) with check (org_id = public.my_org_id());
drop policy if exists student_projects_delete on student_projects;
create policy student_projects_delete on student_projects for delete to authenticated
  using (public.can_edit_project(id) and status in ('draft', 'rejected'));
drop policy if exists project_members_read on project_members;
create policy project_members_read on project_members for select to authenticated using (public.can_view_project(project_id));
drop policy if exists project_members_write on project_members;
create policy project_members_write on project_members for all to authenticated
  using (public.can_edit_project(project_id) and exists (select 1 from student_projects p where p.id = project_id and p.status in ('draft', 'rejected', 'approved')))
  with check (public.can_edit_project(project_id));
drop policy if exists project_logs_read on project_logs;
create policy project_logs_read on project_logs for select to authenticated using (public.can_view_project(project_id));
drop policy if exists project_logs_insert on project_logs;
create policy project_logs_insert on project_logs for insert to authenticated
  with check (author = auth.uid() and (public.can_edit_project(project_id)
              or exists (select 1 from student_projects p where p.id = project_id and p.org_id = public.my_org_id() and public.is_staff())));
grant select, insert, update, delete on student_projects, project_members to authenticated;
grant select, insert on project_logs to authenticated;

-- Người tạo là HS → tự thêm làm trưởng nhóm
create or replace function public.project_add_creator() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_s uuid := public.my_student_id();
begin
  if v_s is not null then insert into project_members (project_id, student_id, role) values (new.id, v_s, 'leader') on conflict do nothing; end if;
  return null;
end $$;
drop trigger if exists student_projects_creator on student_projects;
create trigger student_projects_creator after insert on student_projects for each row execute function public.project_add_creator();

-- Nối vào engine phê duyệt (022, 045)
create or replace function public.approval_source_opened() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_title text; v_sum text; v_by uuid;
begin
  if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then return null; end if;
  if tg_table_name = 'stem_registrations' then
    v_kind := 'stem_registration'; v_title := new.topic;
    v_sum := public.teacher_name(new.teacher_id) || ' · ' || coalesce((select name from classes where id = new.class_id), '') || ' · ' || public.vn_date(new.on_date);
    v_by := public.teacher_profile(new.teacher_id);
  elsif tg_table_name = 'borrow_requests' then
    v_kind := 'borrow_request'; v_title := new.title;
    v_sum := coalesce(public.teacher_name(new.teacher_id), '') || ' · ' || public.vn_date(new.on_date);
    v_by := coalesce(public.teacher_profile(new.teacher_id), auth.uid());
  elsif tg_table_name = 'package_orders' then
    v_kind := 'package_purchase'; v_title := new.name;
    v_sum := concat_ws(' · ', 'Số lượng ' || new.quantity, nullif(new.programs, ''), 'Khối ' || nullif(new.grades, ''),
                       case when new.budget is not null then replace(to_char(new.budget, 'FM999,999,999,999'), ',', '.') || ' đ' end);
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'education_plans' then
    v_kind := 'edu_plan';
    v_title := public.teacher_name(new.teacher_id) || ' · ' || new.subject || ' · Khối ' || new.grade;
    v_sum := new.stem_periods || ' tiết STEM';
    v_by := auth.uid();
  elsif tg_table_name = 'supply_requests' then
    v_kind := 'supply_purchase'; v_title := new.title;
    select concat_ws(' · ', count(*) || ' mặt hàng',
                     case when sum(qty * est_price) > 0 then 'dự kiến ' || replace(to_char(sum(qty * est_price), 'FM999,999,999,999'), ',', '.') || ' đ' end,
                     case when new.needed_by is not null then 'cần trước ' || public.vn_date(new.needed_by) end)
      into v_sum from supply_request_lines where request_id = new.id;
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'stock_transfers' then
    v_kind := 'stock_transfer'; v_title := new.title;
    select (select name from organizations where id = new.org_id) || ' → ' || (select name from organizations where id = new.to_org)
           || ' · ' || count(*) || ' dòng' into v_sum from stock_transfer_items where transfer_id = new.id;
    v_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'student_projects' then
    v_kind := 'project'; v_title := new.title;
    v_sum := concat_ws(' · ', nullif(new.field, ''), (select string_agg(s.full_name, ', ' order by s.full_name) from project_members pm join students s on s.id = pm.student_id where pm.project_id = new.id),
                       'GVHD ' || public.teacher_name(new.mentor_teacher_id));
    v_by := coalesce(new.created_by, auth.uid());
  end if;
  perform public.approval_open(new.org_id, v_kind, tg_table_name, new.id, v_title, v_sum, v_by);
  return null;
end $$;


create or replace function public.approval_cancel(p_request uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_requests;
begin
  select * into r from approval_requests where id = p_request for update;
  if r.requested_by is distinct from auth.uid() or r.status <> 'pending' then raise exception 'Không rút được hồ sơ này' using errcode = '42501'; end if;
  insert into approval_actions (request_id, step_no, actor, decision, note) values (r.id, r.current_step, auth.uid(), 'cancel', p_note);
  update approval_requests set status = 'cancelled', decided_at = now() where id = r.id;
  perform set_config('app.approval_engine', 'on', true);
  execute format('update %I set status = $1 where id = $2', r.ref_table)
    using case when r.ref_table in ('package_orders', 'education_plans', 'supply_requests', 'stock_transfers', 'student_projects') then 'draft' else 'rejected' end, r.ref_id;
  perform set_config('app.approval_engine', 'off', true);
end $$;
do $$
begin
  drop trigger if exists student_projects_approval_open on student_projects;
  create trigger student_projects_approval_open after insert or update of status on student_projects for each row execute function public.approval_source_opened();
  drop trigger if exists student_projects_approval_guard on student_projects;
  create trigger student_projects_approval_guard before update of status on student_projects for each row execute function public.approval_source_guard();
  drop trigger if exists student_projects_approval_deleted on student_projects;
  create trigger student_projects_approval_deleted after delete on student_projects for each row execute function public.approval_source_deleted();
end $$;

-- ===== 2. Cuộc thi =====
create table if not exists competitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,         -- đơn vị tổ chức (cấp cuộc thi)
  title text not null check (length(btrim(title)) >= 5),
  template text not null default 'custom' check (template in ('khkt', 'stem', 'custom')),
  description text,
  fields text[] not null default '{}',
  grades text[] not null default '{}',                                         -- cấp học được dự thi (mamnon/tieuhoc/thcs/thpt); rỗng = mọi cấp
  max_members int not null default 2 check (max_members between 1 and 10),
  max_per_school int check (max_per_school is null or max_per_school > 0),
  required_docs jsonb not null default '[]'::jsonb check (jsonb_typeof(required_docs) = 'array'),   -- [{key, label, required}]
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),             -- [{key, label, max}]
  abstract_words int check (abstract_words is null or abstract_words > 0),
  anonymous boolean not null default false,
  fee numeric(14,0) check (fee is null or fee >= 0),
  rounds text[] not null default '{Vòng chung kết}' check (cardinality(rounds) between 1 and 5),
  current_round int not null default 1,
  submit_from timestamptz,
  submit_until timestamptz,
  status text not null default 'draft' check (status in ('draft', 'open', 'judging', 'finished', 'cancelled')),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_round between 1 and cardinality(rounds))
);
create index if not exists competitions_org on competitions (org_id, created_at desc);

create table if not exists competition_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  project_id uuid not null references student_projects(id) on delete cascade,
  school_id uuid not null references organizations(id) on delete cascade,
  field text,
  code text not null,                                                           -- mã bài (dùng khi chấm ẩn danh)
  docs jsonb not null default '{}'::jsonb check (jsonb_typeof(docs) = 'object'),  -- { key: url }
  abstract text,
  round int not null default 1,
  status text not null default 'submitted' check (status in ('submitted', 'withdrawn', 'eliminated', 'awarded')),
  fee_status text not null default 'none' check (fee_status in ('none', 'unpaid', 'paid', 'waived')),
  score numeric(6,2),
  rank int,
  award text,
  submitted_by uuid references profiles(id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  unique (competition_id, project_id),
  unique (competition_id, code)
);
create index if not exists competition_entries_comp on competition_entries (competition_id, round, field);
create index if not exists competition_entries_school on competition_entries (school_id);

create table if not exists competition_judges (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,         -- = đơn vị tổ chức (để cấp tài khoản mã)
  full_name text not null,
  email text,
  profile_id uuid references profiles(id) on delete set null,
  fields text[] not null default '{}',                                          -- rỗng = mọi lĩnh vực
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists competition_judges_profile on competition_judges (competition_id, profile_id) where profile_id is not null;
create table if not exists judge_assignments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references competition_entries(id) on delete cascade,
  judge_id uuid not null references competition_judges(id) on delete cascade,
  round int not null,
  scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
  total numeric(6,2),
  comment text,
  submitted_at timestamptz,
  unique (entry_id, judge_id, round)
);
create index if not exists judge_assignments_judge on judge_assignments (judge_id, round);
alter table invitations add column if not exists judge_id uuid references competition_judges(id) on delete set null;

-- Người quản lý cuộc thi: quản trị / cán bộ đơn vị tổ chức, hoặc KDI
create or replace function public.can_manage_competition(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (p_org = public.my_org_id() and (public.is_admin() or public.is_authority()))
$$;
-- Trường có được dự thi không: trong cây của đơn vị tổ chức (KDI tổ chức → mọi trường)
create or replace function public.competition_open_to(p_comp uuid, p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from competitions c join organizations o on o.id = c.org_id join organizations s on s.id = p_school
                  where c.id = p_comp and s.type = 'school'
                    and (o.is_platform or public.org_in_tree(p_school, c.org_id))
                    and (cardinality(c.grades) = 0 or s.level = any(c.grades)))
$$;
create or replace function public.my_judge_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select j.id from competition_judges j where j.profile_id = auth.uid()
$$;
grant execute on function public.can_manage_competition(uuid), public.competition_open_to(uuid, uuid), public.my_judge_ids() to authenticated;
-- Kiểm tra chéo bảng cho RLS (security definer, tránh đệ quy chính sách)
create or replace function public.comp_manageable(p_comp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from competitions c where c.id = p_comp and public.can_manage_competition(c.org_id))
$$;
create or replace function public.entry_manageable(p_entry uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from competition_entries e join competitions c on c.id = e.competition_id where e.id = p_entry and public.can_manage_competition(c.org_id))
$$;
create or replace function public.comp_visible_extra(p_comp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from competition_judges j where j.competition_id = p_comp and j.profile_id = auth.uid())
      or exists (select 1 from competition_entries e where e.competition_id = p_comp and public.can_view_project(e.project_id))
$$;
grant execute on function public.comp_manageable(uuid), public.entry_manageable(uuid), public.comp_visible_extra(uuid) to authenticated;

create or replace function public.guard_competition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if exists (select 1 from jsonb_array_elements(new.criteria) c where coalesce(c->>'key', '') = '' or coalesce((c->>'max')::numeric, 0) <= 0) then
    raise exception 'Tiêu chí chấm cần mã và điểm tối đa > 0' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status in ('finished', 'cancelled') and new.status = old.status and new.criteria is distinct from old.criteria then
    raise exception 'Cuộc thi đã kết thúc' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.criteria is distinct from old.criteria and exists (select 1 from judge_assignments a join competition_entries e on e.id = a.entry_id
       where e.competition_id = new.id and a.submitted_at is not null) then
    raise exception 'Đã có giám khảo chấm — không đổi được tiêu chí' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists competitions_guard on competitions;
create trigger competitions_guard before insert or update on competitions for each row execute function public.guard_competition();

alter table competitions enable row level security;
alter table competition_entries enable row level security;
alter table competition_judges enable row level security;
alter table judge_assignments enable row level security;
drop policy if exists competitions_read on competitions;
create policy competitions_read on competitions for select to authenticated using (
  (select public.can_manage_competition(org_id))
  or (status <> 'draft' and ((public.is_staff() and public.my_org_id() is not null and public.competition_open_to(id, public.my_org_id()))
       or (public.is_authority() and org_id in (select public.my_org_tree()))
       or public.comp_visible_extra(id))));
drop policy if exists competitions_write on competitions;
create policy competitions_write on competitions for all to authenticated
  using ((select public.can_manage_competition(org_id))) with check ((select public.can_manage_competition(org_id)));
drop policy if exists competition_entries_read on competition_entries;
create policy competition_entries_read on competition_entries for select to authenticated using (
  public.comp_manageable(competition_id)
  or (school_id = public.my_org_id() and public.is_staff())
  or public.can_view_project(project_id));
drop policy if exists competition_entries_manage on competition_entries;
create policy competition_entries_manage on competition_entries for update to authenticated
  using (public.comp_manageable(competition_id)) with check (public.comp_manageable(competition_id));
drop policy if exists competition_judges_read on competition_judges;
create policy competition_judges_read on competition_judges for select to authenticated using (
  profile_id = auth.uid() or public.comp_manageable(competition_id));
drop policy if exists competition_judges_write on competition_judges;
create policy competition_judges_write on competition_judges for all to authenticated
  using (public.comp_manageable(competition_id))
  with check (public.comp_manageable(competition_id) and org_id = (select c.org_id from competitions c where c.id = competition_id));
drop policy if exists judge_assignments_read on judge_assignments;
create policy judge_assignments_read on judge_assignments for select to authenticated using (public.entry_manageable(entry_id));
drop policy if exists judge_assignments_write on judge_assignments;
create policy judge_assignments_write on judge_assignments for insert to authenticated with check (public.entry_manageable(entry_id));
drop policy if exists judge_assignments_delete on judge_assignments;
create policy judge_assignments_delete on judge_assignments for delete to authenticated using (submitted_at is null and public.entry_manageable(entry_id));
grant select, insert, update, delete on competitions, competition_judges to authenticated;
grant select, update on competition_entries to authenticated;
grant select, insert, delete on judge_assignments to authenticated;

-- Nộp bài: quản trị trường (hoặc GV hướng dẫn) nộp dự án đã duyệt của trường
create or replace function public.competition_submit(p_comp uuid, p_project uuid, p_field text, p_docs jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c competitions; p student_projects; n int; v_id uuid; v_code text; d jsonb; w int;
begin
  select * into c from competitions where id = p_comp for update;
  select * into p from student_projects where id = p_project;
  if c.id is null or p.id is null then raise exception 'Không tìm thấy cuộc thi / dự án' using errcode = 'P0002'; end if;
  if p.org_id <> public.my_org_id() or not (public.is_admin() or p.mentor_teacher_id = public.my_teacher_id()) then
    raise exception 'Chỉ quản trị trường hoặc GV hướng dẫn nộp được dự án của trường' using errcode = '42501';
  end if;
  if c.status <> 'open' or (c.submit_from is not null and now() < c.submit_from) or (c.submit_until is not null and now() > c.submit_until) then
    raise exception 'Cuộc thi không trong thời gian nhận bài' using errcode = '22023';
  end if;
  if not public.competition_open_to(c.id, p.org_id) then raise exception 'Trường không thuộc phạm vi / cấp học của cuộc thi' using errcode = '42501'; end if;
  if p.status not in ('approved', 'completed') then raise exception 'Dự án phải được trường duyệt trước khi dự thi' using errcode = '22023'; end if;
  if cardinality(c.fields) > 0 and not (p_field = any(c.fields)) then raise exception 'Lĩnh vực không có trong cuộc thi' using errcode = '22023'; end if;
  select count(*) into n from project_members where project_id = p.id;
  if n = 0 or n > c.max_members then raise exception 'Dự án dự thi cần từ 1 đến % học sinh', c.max_members using errcode = '22023'; end if;
  if c.max_per_school is not null and (select count(*) from competition_entries where competition_id = c.id and school_id = p.org_id and status <> 'withdrawn' and project_id <> p.id) >= c.max_per_school then
    raise exception 'Trường đã nộp đủ % dự án', c.max_per_school using errcode = '22023';
  end if;
  for d in select * from jsonb_array_elements(c.required_docs) loop
    if coalesce((d->>'required')::boolean, true) and coalesce(p_docs->>(d->>'key'), '') !~* '^https?://' then
      raise exception 'Thiếu hồ sơ: %', d->>'label' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from jsonb_each_text(coalesce(p_docs, '{}')) x where x.value <> '' and x.value !~* '^https?://') then
    raise exception 'Hồ sơ phải là đường link http(s)' using errcode = '22023';
  end if;
  if c.abstract_words is not null then
    w := coalesce(array_length(regexp_split_to_array(btrim(coalesce(p.abstract, '')), '\s+'), 1), 0);
    if btrim(coalesce(p.abstract, '')) = '' then raise exception 'Dự án chưa có tóm tắt' using errcode = '22023'; end if;
    if w > c.abstract_words then raise exception 'Tóm tắt % từ, vượt giới hạn % từ', w, c.abstract_words using errcode = '22023'; end if;
  end if;
  select id into v_id from competition_entries where competition_id = c.id and project_id = p.id;
  if v_id is not null then
    update competition_entries set field = p_field, docs = coalesce(p_docs, '{}'), abstract = p.abstract, status = 'submitted', submitted_at = now(), submitted_by = auth.uid() where id = v_id;
    return v_id;
  end if;
  v_code := upper(left(coalesce(nullif(regexp_replace(p_field, '[^[:alpha:]]', '', 'g'), ''), 'DA'), 2)) || '-' ||
            lpad(((select count(*) from competition_entries where competition_id = c.id) + 1)::text, 3, '0');
  insert into competition_entries (competition_id, project_id, school_id, field, code, docs, abstract, fee_status)
    values (c.id, p.id, p.org_id, p_field, v_code, coalesce(p_docs, '{}'), p.abstract, case when coalesce(c.fee, 0) > 0 then 'unpaid' else 'none' end)
    returning id into v_id;
  return v_id;
end $$;
create or replace function public.competition_withdraw(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update competition_entries e set status = 'withdrawn'
   where e.id = p_entry and e.school_id = public.my_org_id() and public.is_staff() and e.status = 'submitted'
     and exists (select 1 from competitions c where c.id = e.competition_id and c.status = 'open');
  if not found then raise exception 'Không rút được bài này' using errcode = '42501'; end if;
end $$;

-- Thêm giám khảo: có tài khoản (theo email) → gắn ngay; chưa có → cấp tài khoản mã (hàm máy chủ, kind 'judge')
create or replace function public.competition_add_judge(p_comp uuid, p_name text, p_email text default null, p_fields text[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare c competitions; v_pid uuid; v_id uuid;
begin
  select * into c from competitions where id = p_comp;
  if c.id is null or not public.can_manage_competition(c.org_id) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Cần họ tên giám khảo' using errcode = '22023'; end if;
  if nullif(btrim(p_email), '') is not null then select id into v_pid from profiles where lower(email) = lower(btrim(p_email)) limit 1; end if;
  if v_pid is not null and exists (select 1 from competition_judges where competition_id = c.id and profile_id = v_pid) then
    raise exception 'Người này đã là giám khảo' using errcode = '23505';
  end if;
  insert into competition_judges (competition_id, org_id, full_name, email, profile_id, fields)
    values (c.id, c.org_id, btrim(p_name), nullif(lower(btrim(p_email)), ''), v_pid, coalesce(p_fields, '{}')) returning id into v_id;
  if v_pid is not null then
    perform public.notify_user(v_pid, c.org_id, 'status', 'Bạn được mời làm giám khảo', c.title, 'Chấm thi', null, c.id);
  end if;
  return v_id;
end $$;

-- Phân công: mỗi bài vòng hiện tại cho p_per giám khảo cùng lĩnh vực, chia đều (không phân lại bài đã đủ)
create or replace function public.competition_auto_assign(p_comp uuid, p_per int default 2) returns int
language plpgsql security definer set search_path = public as $$
declare c competitions; e record; j record; n int := 0; have int;
begin
  select * into c from competitions where id = p_comp;
  if c.id is null or not public.can_manage_competition(c.org_id) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  for e in select * from competition_entries where competition_id = c.id and round = c.current_round and status = 'submitted' order by field, code loop
    select count(*) into have from judge_assignments where entry_id = e.id and round = c.current_round;
    for j in select cj.id from competition_judges cj
              where cj.competition_id = c.id and (cardinality(cj.fields) = 0 or e.field = any(cj.fields))
                and not exists (select 1 from judge_assignments a where a.entry_id = e.id and a.judge_id = cj.id and a.round = c.current_round)
              order by (select count(*) from judge_assignments a where a.judge_id = cj.id and a.round = c.current_round), cj.created_at
              limit greatest(p_per - have, 0) loop
      insert into judge_assignments (entry_id, judge_id, round) values (e.id, j.id, c.current_round); n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- Bài của tôi (giám khảo): ẩn danh nếu cuộc thi chọn chấm ẩn danh
create or replace function public.my_judging()
returns table (assignment_id uuid, competition_id uuid, competition text, round_name text, anonymous boolean, criteria jsonb, entry_code text, field text,
               title text, school text, members text, abstract text, docs jsonb, doc_labels jsonb, links jsonb, scores jsonb, total numeric, comment text, submitted_at timestamptz, open boolean)
language sql stable security definer set search_path = public as $$
  select a.id, c.id, c.title, c.rounds[a.round], c.anonymous, c.criteria, e.code, e.field, p.title,
         case when c.anonymous then null else o.name end,
         case when c.anonymous then null else (select string_agg(s.full_name, ', ' order by s.full_name) from project_members pm join students s on s.id = pm.student_id where pm.project_id = p.id) end,
         coalesce(e.abstract, p.abstract), e.docs, c.required_docs, case when c.anonymous then '[]'::jsonb else p.links end, a.scores, a.total, a.comment, a.submitted_at,
         c.status = 'judging' and a.round = c.current_round and e.status = 'submitted'
    from judge_assignments a join competition_judges j on j.id = a.judge_id join competition_entries e on e.id = a.entry_id
    join competitions c on c.id = e.competition_id join student_projects p on p.id = e.project_id join organizations o on o.id = e.school_id
   where j.profile_id = auth.uid()
   order by c.created_at desc, e.field, e.code
$$;

create or replace function public.judge_score(p_assignment uuid, p_scores jsonb, p_comment text default null, p_submit boolean default true) returns numeric
language plpgsql security definer set search_path = public as $$
declare a judge_assignments; c competitions; e competition_entries; k jsonb; v numeric; tot numeric := 0;
begin
  select * into a from judge_assignments where id = p_assignment for update;
  if a.id is null or not exists (select 1 from competition_judges j where j.id = a.judge_id and j.profile_id = auth.uid()) then
    raise exception 'Không phải bài được phân công cho bạn' using errcode = '42501';
  end if;
  select * into e from competition_entries where id = a.entry_id;
  select * into c from competitions where id = e.competition_id;
  if c.status <> 'judging' or a.round <> c.current_round or e.status <> 'submitted' then raise exception 'Vòng chấm đã đóng' using errcode = '22023'; end if;
  for k in select * from jsonb_array_elements(c.criteria) loop
    v := (p_scores->>(k->>'key'))::numeric;
    if v is null then
      if p_submit then raise exception 'Chưa chấm tiêu chí: %', k->>'label' using errcode = '22023'; end if;
      continue;
    end if;
    if v < 0 or v > (k->>'max')::numeric then raise exception 'Điểm "%" phải từ 0 đến %', k->>'label', k->>'max' using errcode = '22023'; end if;
    tot := tot + v;
  end loop;
  update judge_assignments set scores = coalesce(p_scores, '{}'), comment = nullif(btrim(p_comment), ''),
         total = case when p_submit then tot end, submitted_at = case when p_submit then now() end
   where id = a.id;
  return tot;
end $$;

-- Tổng hợp vòng: điểm TB các giám khảo đã chấm, chênh lệch, hạng theo lĩnh vực
create or replace function public.competition_results(p_comp uuid)
returns table (entry_id uuid, code text, field text, title text, school text, members text, status text, round int, judges int, scored int,
               avg_total numeric, spread numeric, rank_in_field int, award text, fee_status text, docs jsonb, project_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare c competitions;
begin
  select * into c from competitions where id = p_comp;
  if c.id is null or not public.can_manage_competition(c.org_id) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return query
  with s as (
    select e.id, count(a.id)::int as judges, count(a.submitted_at)::int as scored,
           round(avg(a.total) filter (where a.submitted_at is not null), 2) as avg_total,
           max(a.total) filter (where a.submitted_at is not null) - min(a.total) filter (where a.submitted_at is not null) as spread
      from competition_entries e left join judge_assignments a on a.entry_id = e.id and a.round = c.current_round
     where e.competition_id = c.id group by e.id)
  select e.id, e.code, e.field, p.title, o.name,
         (select string_agg(st.full_name, ', ' order by st.full_name) from project_members pm join students st on st.id = pm.student_id where pm.project_id = p.id),
         e.status, e.round, s.judges, s.scored, s.avg_total, s.spread,
         case when s.avg_total is null or e.round <> c.current_round or e.status = 'withdrawn' then null
              else (rank() over (partition by e.field, (e.round = c.current_round and e.status <> 'withdrawn' and s.avg_total is not null) order by s.avg_total desc))::int end,
         e.award, e.fee_status, e.docs, p.id
    from competition_entries e join s on s.id = e.id join student_projects p on p.id = e.project_id join organizations o on o.id = e.school_id
   where e.competition_id = c.id
   order by e.field, s.avg_total desc nulls last, e.code;
end $$;

-- Chuyển vòng: bài được chọn vào vòng sau; bài còn lại của vòng hiện tại → bị loại
create or replace function public.competition_advance(p_comp uuid, p_entries uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare c competitions; n int;
begin
  select * into c from competitions where id = p_comp for update;
  if c.id is null or not public.can_manage_competition(c.org_id) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if c.current_round >= cardinality(c.rounds) then raise exception 'Đang ở vòng cuối — hãy trao giải' using errcode = '22023'; end if;
  update competition_entries set score = (select round(avg(total), 2) from judge_assignments a where a.entry_id = competition_entries.id and a.round = c.current_round and a.submitted_at is not null)
   where competition_id = c.id and round = c.current_round and status = 'submitted';
  update competition_entries set round = c.current_round + 1 where competition_id = c.id and round = c.current_round and status = 'submitted' and id = any(p_entries);
  get diagnostics n = row_count;
  update competition_entries set status = 'eliminated' where competition_id = c.id and round = c.current_round and status = 'submitted';
  update competitions set current_round = current_round + 1, status = 'judging' where id = c.id;
  return n;
end $$;

-- Trao giải & kết thúc: p_awards {entry_id: "Giải Nhất"}; ghi điểm, hạng; thông báo GV hướng dẫn / HS
create or replace function public.competition_finish(p_comp uuid, p_awards jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c competitions; r record; n int := 0; u uuid;
begin
  select * into c from competitions where id = p_comp for update;
  if c.id is null or not public.can_manage_competition(c.org_id) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  for r in select * from public.competition_results(c.id) x where x.round = c.current_round and x.status = 'submitted' loop
    update competition_entries set score = r.avg_total, rank = r.rank_in_field,
           award = nullif(btrim(p_awards->>r.entry_id::text), ''), status = case when nullif(btrim(p_awards->>r.entry_id::text), '') is not null then 'awarded' else 'submitted' end
     where id = r.entry_id;
    if nullif(btrim(p_awards->>r.entry_id::text), '') is not null then
      n := n + 1;
      for u in select s.profile_id from project_members pm join students s on s.id = pm.student_id where pm.project_id = r.project_id and s.profile_id is not null
               union select t.profile_id from student_projects p join teachers t on t.id = p.mentor_teacher_id where p.id = r.project_id and t.profile_id is not null loop
        perform public.notify_user(u, (select org_id from student_projects where id = r.project_id), 'status', 'Dự án đạt ' || (p_awards->>r.entry_id::text), c.title || ' — ' || r.title, 'Dự án STEM', null, r.project_id);
      end loop;
    end if;
  end loop;
  update competitions set status = 'finished' where id = c.id;
  return n;
end $$;

-- Lệ phí theo cuộc thi (KDI: nối vào Nghiệm thu & doanh thu)
create or replace function public.competition_fees(p_year int default null)
returns table (competition_id uuid, title text, organizer text, fee numeric, entries int, paid int, unpaid int, waived int, collected numeric, outstanding numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, o.name, c.fee,
         count(e.id) filter (where e.status <> 'withdrawn')::int,
         count(e.id) filter (where e.fee_status = 'paid')::int, count(e.id) filter (where e.fee_status = 'unpaid' and e.status <> 'withdrawn')::int,
         count(e.id) filter (where e.fee_status = 'waived')::int,
         c.fee * count(e.id) filter (where e.fee_status = 'paid'), c.fee * count(e.id) filter (where e.fee_status = 'unpaid' and e.status <> 'withdrawn')
    from competitions c join organizations o on o.id = c.org_id left join competition_entries e on e.competition_id = c.id
   where coalesce(c.fee, 0) > 0 and (public.is_platform_admin() or public.can_manage_competition(c.org_id))
     and (p_year is null or extract(year from c.created_at) = p_year)
   group by c.id, o.name order by c.created_at desc
$$;

revoke all on function public.competition_submit(uuid, uuid, text, jsonb), public.competition_withdraw(uuid), public.competition_add_judge(uuid, text, text, text[]),
  public.competition_auto_assign(uuid, int), public.my_judging(), public.judge_score(uuid, jsonb, text, boolean), public.competition_results(uuid),
  public.competition_advance(uuid, uuid[]), public.competition_finish(uuid, jsonb), public.competition_fees(int) from public, anon;
grant execute on function public.competition_submit(uuid, uuid, text, jsonb), public.competition_withdraw(uuid), public.competition_add_judge(uuid, text, text, text[]),
  public.competition_auto_assign(uuid, int), public.my_judging(), public.judge_score(uuid, jsonb, text, boolean), public.competition_results(uuid),
  public.competition_advance(uuid, uuid[]), public.competition_finish(uuid, jsonb), public.competition_fees(int) to authenticated;

-- ===== 3. Tài khoản giám khảo (mã <mã đơn vị>.gk<n>), dùng lại cơ chế 037/048 =====
create or replace function public.account_prepare(p_kind text, p_ids uuid[])
returns table (person_id uuid, full_name text, class_name text, login text, email text, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.my_org_id(); v_code text; v_dom text := public.login_domain(); v_role uuid;
  v_next int; r record; v_login text; v_email text; v_pid uuid; v_seen text[] := '{}';
  v_need_consent boolean := coalesce((select require_student_consent from security_settings where id = 1), false);
begin
  if p_kind not in ('student', 'teacher', 'parent', 'judge') then raise exception 'Loại tài khoản không hợp lệ' using errcode = '22023'; end if;
  if not (public.is_admin() or public.has_perm('accounts', 'create')
          or (p_kind = 'judge' and (public.is_authority() or public.is_platform_admin()))) then
    raise exception 'Không có quyền tạo tài khoản' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Tối đa 500 người mỗi lần' using errcode = '22023'; end if;
  v_code := public.login_school_code(v_org);
  if v_code is null then
    raise exception 'Trường chưa có mã đơn vị — liên hệ KDI đặt mã trước khi tạo tài khoản' using errcode = '22023';
  end if;
  select id into v_role from roles where key = p_kind and is_system and org_id is null order by id limit 1;
  select coalesce(max(n), 0) + 1 into v_next from (
    select substring(p.login from '^' || v_code || '\.' || case when p_kind = 'judge' then 'gk' else 'gv' end || '(\d+)$')::int as n from profiles p
     where p.login like v_code || case when p_kind = 'judge' then '.gk%' else '.gv%' end
    union all
    select substring(i.email from '^' || v_code || '\.' || case when p_kind = 'judge' then 'gk' else 'gv' end || '(\d+)@')::int from invitations i
     where i.org_id = v_org and i.status = 'pending' and i.email like v_code || case when p_kind = 'judge' then '.gk%' else '.gv%' end) x;

  for r in
    select s.id, s.full_name, c.name as cls, s.profile_id, s.student_code as code, null::text as inv_email
      from unnest(p_ids) u(id) join students s on s.id = u.id and s.org_id = v_org left join classes c on c.id = s.class_id
     where p_kind = 'student'
    union all
    select t.id, t.full_name, null, t.profile_id, null,
           (select i.email from invitations i where i.teacher_id = t.id and i.status = 'pending' and i.email like v_code || '.gv%@%'
             order by i.created_at desc limit 1)
      from unnest(p_ids) u(id) join teachers t on t.id = u.id and t.org_id = v_org
     where p_kind = 'teacher'
    union all
    select g.id, g.full_name, c.name, g.profile_id, g.phone_norm, null
      from unnest(p_ids) u(id) join guardians g on g.id = u.id and g.org_id = v_org
      join students s on s.id = g.student_id left join classes c on c.id = s.class_id
     where p_kind = 'parent'
    union all
    select j.id, j.full_name, (select title from competitions where id = j.competition_id), j.profile_id, null,
           (select i.email from invitations i where i.judge_id = j.id and i.status = 'pending' order by i.created_at desc limit 1)
      from unnest(p_ids) u(id) join competition_judges j on j.id = u.id and j.org_id = v_org
     where p_kind = 'judge'
  loop
    person_id := r.id; full_name := r.full_name; class_name := r.cls; login := null; email := null;
    if r.profile_id is not null then
      select p.login into login from profiles p where p.id = r.profile_id;
      status := 'has_account'; return next; continue;
    end if;
    if p_kind = 'student' then
      v_login := nullif(regexp_replace(lower(coalesce(r.code, '')), '[^a-z0-9]+', '', 'g'), '');
      if v_login is null then status := 'missing_code'; return next; continue; end if;
      if v_need_consent and not exists (select 1 from student_consents sc where sc.student_id = r.id and sc.withdrawn_on is null) then
        status := 'no_consent'; return next; continue;
      end if;
      v_login := v_code || '.' || v_login;
    elsif p_kind = 'parent' then
      if r.code is null then status := 'missing_phone'; return next; continue; end if;
      -- phụ huynh cùng SĐT đã có tài khoản (con khác) → gắn luôn
      select g.profile_id into v_pid from guardians g where g.org_id = v_org and g.phone_norm = r.code and g.profile_id is not null limit 1;
      if v_pid is not null then
        perform set_config('app.login_admin', 'on', true);
        update guardians set profile_id = v_pid where id = r.id;
        perform set_config('app.login_admin', '', true);
        select p.login into login from profiles p where p.id = v_pid;
        status := 'has_account'; return next; continue;
      end if;
      if r.code = any(v_seen) then status := 'same_phone'; return next; continue; end if;
      v_seen := v_seen || r.code;
      v_login := v_code || '.ph' || r.code;
    elsif r.inv_email is not null then
      v_login := split_part(r.inv_email, '@', 1);
    else
      v_login := v_code || case when p_kind = 'judge' then '.gk' else '.gv' end || v_next; v_next := v_next + 1;
    end if;
    v_email := v_login || '@' || v_dom;
    login := v_login;
    if exists (select 1 from profiles p where p.login = v_login) then status := 'login_taken'; return next; continue; end if;
    update invitations i set status = 'cancelled', note = 'Thay bằng lời mời tài khoản mã'
     where i.org_id = v_org and lower(i.email) = v_email and i.status = 'pending';
    insert into invitations (org_id, email, full_name, role_id, teacher_id, student_id, guardian_id, judge_id, invited_by)
      values (v_org, v_email, r.full_name, v_role,
              case when p_kind = 'teacher' then r.id end, case when p_kind = 'student' then r.id end,
              case when p_kind = 'parent' then r.id end, case when p_kind = 'judge' then r.id end, auth.uid());
    email := v_email; status := 'new'; return next;
  end loop;
  for r in select u.id from unnest(p_ids) u(id)
            where not exists (select 1 from students s where s.id = u.id and s.org_id = v_org and p_kind = 'student')
              and not exists (select 1 from teachers t where t.id = u.id and t.org_id = v_org and p_kind = 'teacher')
              and not exists (select 1 from guardians g where g.id = u.id and g.org_id = v_org and p_kind = 'parent')
              and not exists (select 1 from competition_judges j where j.id = u.id and j.org_id = v_org and p_kind = 'judge') loop
    person_id := r.id; full_name := null; class_name := null; login := null; email := null; status := 'not_found'; return next;
  end loop;
end $$;
revoke all on function public.account_prepare(text, uuid[]) from public, anon;
grant execute on function public.account_prepare(text, uuid[]) to authenticated;

create or replace function public.account_reset_target(p_kind text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_pid uuid; v_name text; v_login text;
begin
  if not (public.is_admin() or public.has_perm('accounts', 'edit') or (p_kind = 'judge' and (public.is_authority() or public.is_platform_admin()))) then
    raise exception 'Không có quyền đặt lại mật khẩu' using errcode = '42501';
  end if;
  if p_kind = 'student' then select s.profile_id, s.full_name into v_pid, v_name from students s where s.id = p_id and s.org_id = v_org;
  elsif p_kind = 'teacher' then select t.profile_id, t.full_name into v_pid, v_name from teachers t where t.id = p_id and t.org_id = v_org;
  elsif p_kind = 'parent' then select g.profile_id, g.full_name into v_pid, v_name from guardians g where g.id = p_id and g.org_id = v_org;
  elsif p_kind = 'judge' then select j.profile_id, j.full_name into v_pid, v_name from competition_judges j where j.id = p_id and j.org_id = v_org;
  else raise exception 'Loại tài khoản không hợp lệ' using errcode = '22023'; end if;
  if v_pid is null then raise exception 'Người này chưa có tài khoản ở trường' using errcode = 'P0002'; end if;
  select login into v_login from profiles where id = v_pid;
  if v_login is null then
    raise exception 'Tài khoản dùng email thật — người dùng tự đặt lại bằng "Quên mật khẩu"' using errcode = '22023';
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), v_org, 'profiles', v_pid::text, 'update', 'Đặt lại mật khẩu tài khoản ' || v_login || ' (' || v_name || ')',
            jsonb_build_object('login', v_login, 'kind', p_kind));
  return v_pid;
end $$;
revoke all on function public.account_reset_target(text, uuid) from public, anon;
grant execute on function public.account_reset_target(text, uuid) to authenticated;

create or replace function public.apply_invitations(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_email text; v_confirmed timestamptz; inv invitations; n int := 0; v_phone text;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = p_user;
  if v_email is null or v_confirmed is null then return 0; end if;
  for inv in select * from invitations where lower(email) = lower(v_email) and status = 'pending' order by created_at loop
    insert into memberships (user_id, org_id, role_id, created_by)
      values (p_user, inv.org_id, inv.role_id, inv.invited_by) on conflict do nothing;
    update profiles set full_name = coalesce(nullif(trim(inv.full_name), ''), full_name)
     where id = p_user and (org_id = inv.org_id or full_name is null or full_name = split_part(v_email, '@', 1));
    if inv.teacher_id is not null then
      update teachers set profile_id = p_user where id = inv.teacher_id and (profile_id is null or profile_id = p_user);
    end if;
    if inv.student_id is not null then
      update students set profile_id = p_user where id = inv.student_id and (profile_id is null or profile_id = p_user);
    end if;
    if inv.guardian_id is not null then
      -- mọi dòng phụ huynh cùng SĐT ở trường (anh chị em) dùng chung tài khoản
      select phone_norm into v_phone from guardians where id = inv.guardian_id;
      perform set_config('app.login_admin', 'on', true);
      update guardians set profile_id = p_user
       where org_id = inv.org_id and profile_id is null and (id = inv.guardian_id or (v_phone is not null and phone_norm = v_phone));
      perform set_config('app.login_admin', '', true);
    end if;
    if inv.judge_id is not null then
      update competition_judges set profile_id = p_user where id = inv.judge_id and profile_id is null;
    end if;
    update invitations set status = 'accepted', accepted_at = now(), accepted_user = p_user, note = null where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.apply_invitations(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
