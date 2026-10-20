-- 058: Chương trình giáo dục chuẩn (phiên bản, cấu trúc, yêu cầu cần đạt) + PPCT theo học kỳ / lớp / duyệt
--      + theo dõi thực hiện (nội dung chưa dạy, yêu cầu cần đạt, minh chứng, tổng hợp theo địa bàn).
--  • edu_programs: danh mục chương trình, mỗi lần sửa nội dung đã ban hành là một PHIÊN BẢN mới (cùng family_id).
--    Trạng thái: draft → pending (gửi duyệt, qua Hộp phê duyệt) → approved / rejected → published (ban hành)
--    → superseded (bị phiên bản mới thay thế) / archived (lưu trữ). Nội dung chỉ sửa được khi nháp / bị trả lại.
--  • edu_program_units: cấu trúc chủ đề → bài học → buổi học, theo khối và môn (môn tích hợp).
--  • edu_outcomes: yêu cầu cần đạt của từng chủ đề / bài, gắn năng lực (competencies, 042).
--  • edu_program_assignments: Sở / Phòng / KDI gán chương trình cho trường (và khối) — phạm vi triển khai.
--  • PPCT (057): thêm học kỳ, liên kết bài trong chương trình, gán PPCT cho lớp, gửi duyệt và công bố,
--    nhật ký điều chỉnh kèm lý do; tạo PPCT từ chương trình chuẩn.
--  • Minh chứng thực hiện (curriculum_evidence) + kho tệp learning-files (Supabase Storage).
--  • Theo dõi: trạng thái từng tiết của lớp, yêu cầu cần đạt đã đạt, tiết STEM chưa có minh chứng, độ phủ chương trình.

-- ===== 0. Quyền soạn chương trình / PPCT của một đơn vị =====
-- Trường: quyền chức năng 'curriculum'; Sở / Phòng / Tỉnh / Bộ: cán bộ quản lý của đơn vị; KDI: quản trị nền tảng.
create or replace function public.curriculum_can_write(p_org uuid, p_action text default 'edit') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((p_org = public.my_org_id() and public.is_staff() and (public.has_perm('curriculum', p_action) or public.is_authority()))
      or (p_org = public.platform_org_id() and public.is_platform_admin()), false)
$$;
revoke all on function public.curriculum_can_write(uuid, text) from public, anon;
grant execute on function public.curriculum_can_write(uuid, text) to authenticated;

-- ===== 1. Chương trình giáo dục =====
create table if not exists edu_programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  family_id uuid,                                  -- các phiên bản của cùng một chương trình
  version_no int not null default 1 check (version_no between 1 and 999),
  code text check (code is null or length(btrim(code)) between 1 and 40),
  title text not null,
  kind text not null default 'subject' check (kind in ('subject', 'stem', 'school')),  -- môn học · STEM · nhà trường
  ct_code text check (ct_code is null or ct_code in ('CT1', 'CT2', 'CT3', 'CT4', 'CT5')),
  level text not null default 'thcs' check (level in ('tieuhoc', 'thcs', 'thpt')),
  grade_from int not null check (grade_from between 1 and 12),
  grade_to int not null check (grade_to between 1 and 12),
  main_subject text not null,                      -- môn học chủ đạo
  integrated_subjects text[] not null default '{}',-- môn học tích hợp
  objectives text,                                 -- mục tiêu chương trình
  competency_keys text[] not null default '{}',    -- khung năng lực (competencies.key)
  rubric_ids uuid[] not null default '{}',         -- tiêu chí đánh giá (rubrics)
  total_periods int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'published', 'superseded', 'archived')),
  scope text not null default 'own' check (scope in ('own', 'children')),
  effective_from date,
  effective_to date,
  replaced_by uuid references edu_programs(id) on delete set null,
  source_id uuid references edu_programs(id) on delete set null,
  published_at timestamptz,
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_to >= grade_from),
  check (level <> 'tieuhoc' or grade_to <= 5),
  check (level <> 'thcs' or (grade_from >= 6 and grade_to <= 9)),
  check (level <> 'thpt' or grade_from >= 10)
);
create index if not exists edu_programs_org on edu_programs (org_id, status);
create index if not exists edu_programs_family on edu_programs (family_id, version_no);

create table if not exists edu_program_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  program_id uuid not null references edu_programs(id) on delete cascade,
  parent_id uuid references edu_program_units(id) on delete cascade,
  unit_type text not null default 'topic' check (unit_type in ('topic', 'lesson', 'session')),  -- chủ đề · bài học · buổi học
  seq int not null default 1 check (seq between 1 and 999),
  grade int check (grade between 1 and 12),
  subject text,                                    -- môn của chủ đề (chương trình tích hợp)
  title text not null,
  periods int not null default 0 check (periods between 0 and 200),
  objectives text,
  content text
);
create index if not exists edu_program_units_program on edu_program_units (program_id, parent_id, seq);

create table if not exists edu_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  program_id uuid not null references edu_programs(id) on delete cascade,
  unit_id uuid references edu_program_units(id) on delete cascade,
  seq int not null default 1,
  code text,
  content text not null,
  competency_key text references competencies(key) on delete set null
);
create index if not exists edu_outcomes_unit on edu_outcomes (program_id, unit_id, seq);

create table if not exists edu_program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references edu_programs(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,   -- đơn vị được gán (thường là trường)
  grades int[],                                                           -- null = mọi khối trong chương trình
  note text,
  assigned_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (program_id, org_id)
);

create table if not exists edu_program_log (
  id bigint generated always as identity primary key,
  program_id uuid not null references edu_programs(id) on delete cascade,
  from_status text, to_status text not null,
  note text,
  actor uuid references profiles(id) on delete set null default auth.uid(),
  at timestamptz not null default now()
);

-- Chuẩn hoá + khoá nội dung khi đã gửi duyệt / ban hành (chỉ đổi trạng thái, phạm vi, hiệu lực)
create or replace function public.edu_programs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('pending', 'published') then
      raise exception 'Không xoá chương trình đang chờ duyệt hoặc đang ban hành — hãy lưu trữ' using errcode = '22023';
    end if;
    return old;
  end if;
  new.title := btrim(new.title); new.main_subject := btrim(new.main_subject);
  if new.title = '' or new.main_subject = '' then raise exception 'Nhập tên chương trình và môn chủ đạo' using errcode = '22023'; end if;
  new.integrated_subjects := array(select distinct btrim(x) from unnest(new.integrated_subjects) x where btrim(x) <> '' and lower(btrim(x)) <> lower(new.main_subject));
  if exists (select 1 from unnest(new.competency_keys) k where not exists (select 1 from competencies c where c.key = k)) then
    raise exception 'Năng lực không có trong khung năng lực' using errcode = '22023';
  end if;
  if new.kind <> 'stem' then new.ct_code := null; end if;
  if tg_op = 'INSERT' then
    new.family_id := coalesce(new.family_id, new.id);
  else
    new.family_id := old.family_id; new.org_id := old.org_id; new.created_by := old.created_by;
    if old.status not in ('draft', 'rejected') and (
         new.title, new.code, new.kind, new.ct_code, new.level, new.grade_from, new.grade_to, new.main_subject,
         new.integrated_subjects, new.objectives, new.competency_keys, new.rubric_ids, new.version_no)
       is distinct from (
         old.title, old.code, old.kind, old.ct_code, old.level, old.grade_from, old.grade_to, old.main_subject,
         old.integrated_subjects, old.objectives, old.competency_keys, old.rubric_ids, old.version_no) then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa nội dung' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists edu_programs_guard on edu_programs;
create trigger edu_programs_guard before insert or update or delete on edu_programs for each row execute function public.edu_programs_guard();

-- Nhật ký đổi trạng thái (cả khi duyệt qua Hộp phê duyệt)
create or replace function public.edu_programs_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into edu_program_log (program_id, from_status, to_status, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, nullif(current_setting('app.status_note', true), ''));
  end if;
  return null;
end $$;
drop trigger if exists edu_programs_log on edu_programs;
create trigger edu_programs_log after insert or update of status on edu_programs for each row execute function public.edu_programs_log();

-- Nội dung chương trình chỉ sửa khi nháp / bị trả lại
create or replace function public.edu_program_editable(p_program uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status in ('draft', 'rejected') from edu_programs where id = p_program), false)
$$;

create or replace function public.edu_units_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p edu_programs; par edu_program_units;
begin
  if tg_op = 'DELETE' then
    if not public.edu_program_editable(old.program_id) and exists (select 1 from edu_programs where id = old.program_id) then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa' using errcode = '22023';
    end if;
    return old;
  end if;
  select * into p from edu_programs where id = new.program_id;
  if p.id is null then raise exception 'Không tìm thấy chương trình' using errcode = '22023'; end if;
  if p.status not in ('draft', 'rejected') then
    raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa' using errcode = '22023';
  end if;
  new.org_id := p.org_id;
  new.title := btrim(new.title); new.subject := nullif(btrim(new.subject), '');
  if new.title = '' then raise exception 'Nhập tên chủ đề / bài học' using errcode = '22023'; end if;
  if new.grade is not null and (new.grade < p.grade_from or new.grade > p.grade_to) then
    raise exception 'Khối % nằm ngoài chương trình (khối %–%)', new.grade, p.grade_from, p.grade_to using errcode = '22023';
  end if;
  if new.parent_id is not null then
    select * into par from edu_program_units where id = new.parent_id;
    if par.id is not null then
      if par.program_id <> new.program_id then raise exception 'Chủ đề cha thuộc chương trình khác' using errcode = '22023'; end if;
      if not ((par.unit_type = 'topic' and new.unit_type = 'lesson') or (par.unit_type = 'lesson' and new.unit_type = 'session')) then
        raise exception 'Cấu trúc: chủ đề → bài học → buổi học' using errcode = '22023';
      end if;
    end if;
  elsif new.unit_type = 'session' then
    raise exception 'Buổi học phải thuộc một bài học' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists edu_units_guard on edu_program_units;
create trigger edu_units_guard before insert or update or delete on edu_program_units for each row execute function public.edu_units_guard();

-- Tổng số tiết = tổng tiết của các mục không có mục con
create or replace function public.edu_units_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.program_id, old.program_id);
begin
  update edu_programs p set total_periods = (
    select coalesce(sum(u.periods), 0) from edu_program_units u
     where u.program_id = v and not exists (select 1 from edu_program_units c where c.parent_id = u.id))
   where p.id = v and p.status in ('draft', 'rejected');
  return null;
end $$;
drop trigger if exists edu_units_total on edu_program_units;
create trigger edu_units_total after insert or update or delete on edu_program_units for each row execute function public.edu_units_total();

create or replace function public.edu_outcomes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p edu_programs;
begin
  if tg_op = 'DELETE' then
    if not public.edu_program_editable(old.program_id) and exists (select 1 from edu_programs where id = old.program_id) then
      raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa' using errcode = '22023';
    end if;
    return old;
  end if;
  select * into p from edu_programs where id = new.program_id;
  if p.id is null or p.status not in ('draft', 'rejected') then
    raise exception 'Chương trình đã gửi duyệt / ban hành: tạo phiên bản mới để sửa' using errcode = '22023';
  end if;
  new.org_id := p.org_id; new.content := btrim(new.content); new.code := nullif(btrim(new.code), '');
  if new.content = '' then raise exception 'Nhập nội dung yêu cầu cần đạt' using errcode = '22023'; end if;
  if new.unit_id is not null and not exists (select 1 from edu_program_units where id = new.unit_id and program_id = new.program_id) then
    raise exception 'Chủ đề / bài không thuộc chương trình' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists edu_outcomes_guard on edu_outcomes;
create trigger edu_outcomes_guard before insert or update or delete on edu_outcomes for each row execute function public.edu_outcomes_guard();

-- Đọc: chương trình của đơn vị (và cấp dưới); bản đã ban hành của KDI / cấp trên dùng chung; bản được gán cho đơn vị mình
create or replace function public.edu_program_assigned_to_me(p_program uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from edu_program_assignments a where a.program_id = p_program and a.org_id in (select public.my_scope_orgs()))
$$;
create or replace function public.edu_program_org(p_program uuid) returns uuid
language sql stable security definer set search_path = public as $$ select org_id from edu_programs where id = p_program $$;
revoke all on function public.edu_program_assigned_to_me(uuid), public.edu_program_org(uuid), public.edu_program_editable(uuid) from public, anon;
grant execute on function public.edu_program_assigned_to_me(uuid), public.edu_program_org(uuid), public.edu_program_editable(uuid) to authenticated;

alter table edu_programs enable row level security;
alter table edu_program_units enable row level security;
alter table edu_outcomes enable row level security;
alter table edu_program_assignments enable row level security;
alter table edu_program_log enable row level security;

drop policy if exists edu_programs_read on edu_programs;
create policy edu_programs_read on edu_programs for select to authenticated using (
  (select public.is_staff()) and (
    org_id in (select public.my_org_tree())
    or (status in ('published', 'superseded') and (
          (scope = 'children' and (org_id = (select public.platform_org_id()) or org_id in (select public.my_ancestor_orgs())))
          or public.edu_program_assigned_to_me(id)))));
drop policy if exists edu_programs_insert on edu_programs;
create policy edu_programs_insert on edu_programs for insert to authenticated
  with check (public.curriculum_can_write(org_id, 'create') and status = 'draft');
drop policy if exists edu_programs_update on edu_programs;
create policy edu_programs_update on edu_programs for update to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
drop policy if exists edu_programs_delete on edu_programs;
create policy edu_programs_delete on edu_programs for delete to authenticated using (public.curriculum_can_write(org_id, 'delete'));

drop policy if exists edu_units_read on edu_program_units;
create policy edu_units_read on edu_program_units for select to authenticated using (exists (select 1 from edu_programs p where p.id = program_id));
drop policy if exists edu_units_write on edu_program_units;
create policy edu_units_write on edu_program_units for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
drop policy if exists edu_outcomes_read on edu_outcomes;
create policy edu_outcomes_read on edu_outcomes for select to authenticated using (exists (select 1 from edu_programs p where p.id = program_id));
drop policy if exists edu_outcomes_write on edu_outcomes;
create policy edu_outcomes_write on edu_outcomes for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));

-- Gán: đơn vị sở hữu chương trình gán cho đơn vị trực thuộc; đơn vị được gán (và cấp trên của nó) xem
drop policy if exists edu_assign_read on edu_program_assignments;
create policy edu_assign_read on edu_program_assignments for select to authenticated using (
  (select public.is_staff()) and (org_id in (select public.my_org_tree()) or public.edu_program_org(program_id) in (select public.my_org_tree())));
drop policy if exists edu_assign_insert on edu_program_assignments;
create policy edu_assign_insert on edu_program_assignments for insert to authenticated with check (
  public.curriculum_can_write(public.edu_program_org(program_id), 'edit')
  and (org_id in (select public.my_org_tree()) or (select public.is_platform_admin()))
  and org_id <> public.edu_program_org(program_id));
drop policy if exists edu_assign_update on edu_program_assignments;
create policy edu_assign_update on edu_program_assignments for update to authenticated
  using (public.curriculum_can_write(public.edu_program_org(program_id), 'edit'))
  with check (public.curriculum_can_write(public.edu_program_org(program_id), 'edit'));
drop policy if exists edu_assign_delete on edu_program_assignments;
create policy edu_assign_delete on edu_program_assignments for delete to authenticated
  using (public.curriculum_can_write(public.edu_program_org(program_id), 'edit'));

drop policy if exists edu_log_read on edu_program_log;
create policy edu_log_read on edu_program_log for select to authenticated using (exists (select 1 from edu_programs p where p.id = program_id));

grant select, insert, update, delete on edu_programs, edu_program_units, edu_outcomes, edu_program_assignments to authenticated;
grant select on edu_program_log to authenticated;

-- Nhân bản nội dung chương trình (dùng chung cho sao chép mẫu và tạo phiên bản mới). Quyền theo RLS của người gọi.
create or replace function public.edu_program_clone(p_src uuid, p_org uuid, p_family uuid, p_version int) returns uuid
language plpgsql set search_path = public as $$
declare s edu_programs; v_new uuid := gen_random_uuid(); v_map jsonb; t text;
begin
  select * into s from edu_programs where id = p_src;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  insert into edu_programs (id, org_id, family_id, version_no, code, title, kind, ct_code, level, grade_from, grade_to, main_subject,
                            integrated_subjects, objectives, competency_keys, rubric_ids, status, scope, source_id, note)
  values (v_new, p_org, coalesce(p_family, v_new), p_version, s.code, s.title, s.kind, s.ct_code, s.level, s.grade_from, s.grade_to,
          s.main_subject, s.integrated_subjects, s.objectives, s.competency_keys, s.rubric_ids, 'draft',
          case when p_org = s.org_id then s.scope else 'own' end, s.id, s.note);
  select coalesce(jsonb_object_agg(id::text, gen_random_uuid()), '{}'::jsonb) into v_map from edu_program_units where program_id = p_src;
  foreach t in array array['topic', 'lesson', 'session'] loop
    insert into edu_program_units (id, program_id, parent_id, unit_type, seq, grade, subject, title, periods, objectives, content)
    select (v_map->>u.id::text)::uuid, v_new, (v_map->>u.parent_id::text)::uuid, u.unit_type, u.seq, u.grade, u.subject, u.title,
           u.periods, u.objectives, u.content
      from edu_program_units u where u.program_id = p_src and u.unit_type = t;
  end loop;
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key)
  select v_new, (v_map->>o.unit_id::text)::uuid, o.seq, o.code, o.content, o.competency_key from edu_outcomes o where o.program_id = p_src;
  return v_new;
end $$;
revoke all on function public.edu_program_clone(uuid, uuid, uuid, int) from public, anon, authenticated;

-- Sao chép chương trình của KDI / cấp trên về đơn vị mình (bản nháp, phiên bản 1)
create or replace function public.edu_program_copy(p_program uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from edu_programs p where p.id = p_program and p.status in ('published', 'superseded')
                 and (p.org_id = public.platform_org_id() or p.org_id in (select public.my_ancestor_orgs()) or public.edu_program_assigned_to_me(p.id)))
     or not public.curriculum_can_write(public.my_org_id(), 'create') then
    raise exception 'Không sao chép được chương trình này' using errcode = '42501';
  end if;
  return public.edu_program_clone(p_program, public.my_org_id(), null, 1);
end $$;

-- Phiên bản mới của chương trình của chính đơn vị (bản nháp, số phiên bản kế tiếp trong cùng họ)
create or replace function public.edu_program_new_version(p_program uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s edu_programs; v int;
begin
  select * into s from edu_programs where id = p_program;
  if s.id is null or not public.curriculum_can_write(s.org_id, 'create') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if exists (select 1 from edu_programs where family_id = s.family_id and status in ('draft', 'pending', 'approved', 'rejected')) then
    raise exception 'Chương trình đã có một phiên bản đang soạn / chờ duyệt' using errcode = '22023';
  end if;
  select max(version_no) + 1 into v from edu_programs where family_id = s.family_id;
  return public.edu_program_clone(p_program, s.org_id, s.family_id, v);
end $$;
revoke all on function public.edu_program_copy(uuid), public.edu_program_new_version(uuid) from public, anon;
grant execute on function public.edu_program_copy(uuid), public.edu_program_new_version(uuid) to authenticated;

-- Đổi trạng thái: gửi duyệt, ban hành (thay thế phiên bản đang ban hành), lưu trữ, mở lại bản nháp.
-- Duyệt / trả lại đi qua Hộp phê duyệt (approval_decide_ref('edu_programs', id, ...)).
create or replace function public.edu_program_set_status(p_program uuid, p_status text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s edu_programs; v_old uuid;
begin
  select * into s from edu_programs where id = p_program for update;
  if s.id is null or not public.curriculum_can_write(s.org_id, 'edit') then raise exception 'Không có quyền' using errcode = '42501'; end if;
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  if p_status = 'pending' then
    if s.status not in ('draft', 'rejected') then raise exception 'Chỉ gửi duyệt bản nháp' using errcode = '22023'; end if;
    if not exists (select 1 from edu_program_units where program_id = s.id) then raise exception 'Chương trình chưa có chủ đề / bài học' using errcode = '22023'; end if;
  elsif p_status = 'published' then
    if s.status not in ('draft', 'approved') then raise exception 'Chỉ ban hành bản nháp hoặc bản đã duyệt' using errcode = '22023'; end if;
    -- Trường: phải qua duyệt (trừ khi người ban hành là Ban giám hiệu / quản trị trường)
    if s.status = 'draft' and (select type from organizations where id = s.org_id) = 'school' and not public.is_admin() then
      raise exception 'Gửi duyệt trước khi ban hành' using errcode = '42501';
    end if;
    if not exists (select 1 from edu_program_units where program_id = s.id) then raise exception 'Chương trình chưa có chủ đề / bài học' using errcode = '22023'; end if;
    for v_old in select id from edu_programs where family_id = s.family_id and id <> s.id and status = 'published' loop
      perform set_config('app.status_note', 'Thay thế bởi phiên bản ' || s.version_no, true);
      update edu_programs set status = 'superseded', replaced_by = s.id, effective_to = coalesce(effective_to, public.vn_today()) where id = v_old;
    end loop;
    perform set_config('app.status_note', coalesce(p_note, ''), true);
    update edu_programs set status = 'published', published_at = now(), effective_from = coalesce(effective_from, public.vn_today()) where id = s.id;
    return 'published';
  elsif p_status = 'archived' then
    if s.status = 'pending' then raise exception 'Rút hồ sơ duyệt trước khi lưu trữ' using errcode = '22023'; end if;
  elsif p_status = 'draft' then
    if s.status not in ('rejected', 'approved', 'archived') then raise exception 'Không mở lại được bản này' using errcode = '22023'; end if;
    if s.status = 'archived' and exists (select 1 from edu_programs where family_id = s.family_id and id <> s.id and status in ('draft', 'pending', 'approved', 'rejected')) then
      raise exception 'Chương trình đã có một phiên bản đang soạn' using errcode = '22023';
    end if;
  else
    raise exception 'Trạng thái không hợp lệ' using errcode = '22023';
  end if;
  update edu_programs set status = p_status where id = s.id;
  return p_status;
end $$;
revoke all on function public.edu_program_set_status(uuid, text, text) from public, anon;
grant execute on function public.edu_program_set_status(uuid, text, text) to authenticated;

-- ===== 2. PPCT: học kỳ, liên kết chương trình, gán lớp, duyệt, nhật ký điều chỉnh =====
alter table curriculum_books add column if not exists program_id uuid references edu_programs(id) on delete set null;
alter table curriculum_books drop constraint if exists curriculum_books_status_check;
alter table curriculum_books add constraint curriculum_books_status_check check (status in ('draft', 'pending', 'approved', 'rejected', 'published'));

alter table curriculum_lessons
  add column if not exists term smallint check (term in (1, 2)),
  add column if not exists unit_id uuid references edu_program_units(id) on delete set null,
  add column if not exists change_reason text;
create index if not exists curriculum_lessons_unit on curriculum_lessons (unit_id) where unit_id is not null;

-- Học kỳ: ghi rõ, hoặc tự tính từ tuần (tuần 1–18: học kỳ I). Đổi tuần mà không đổi học kỳ → tính lại.
create or replace function public.curriculum_lessons_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from curriculum_books where id = new.book_id;
  if new.org_id is null then raise exception 'Không tìm thấy môn trong PPCT' using errcode = '22023'; end if;
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'Nhập tên bài / nội dung tiết %', new.seq using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.week is distinct from old.week and new.term is not distinct from old.term then new.term := null; end if;
  if new.term is null and new.week is not null then new.term := case when new.week <= 18 then 1 else 2 end; end if;
  return new;
end $$;
update curriculum_lessons set term = case when week <= 18 then 1 else 2 end where term is null and week is not null;

-- PPCT áp dụng cho một số lớp (không chọn lớp nào = mọi lớp cùng khối)
create table if not exists curriculum_book_classes (
  book_id uuid not null references curriculum_books(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  primary key (book_id, class_id)
);
create or replace function public.curriculum_book_classes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select b.org_id into new.org_id from curriculum_books b join classes c on c.id = new.class_id and c.org_id = b.org_id and c.grade = b.grade
   where b.id = new.book_id;
  if new.org_id is null then raise exception 'Lớp không cùng trường hoặc cùng khối với PPCT' using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists curriculum_book_classes_guard on curriculum_book_classes;
create trigger curriculum_book_classes_guard before insert or update on curriculum_book_classes for each row execute function public.curriculum_book_classes_guard();
alter table curriculum_book_classes enable row level security;
drop policy if exists cbc_read on curriculum_book_classes;
create policy cbc_read on curriculum_book_classes for select to authenticated using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
drop policy if exists cbc_write on curriculum_book_classes;
create policy cbc_write on curriculum_book_classes for all to authenticated
  using (public.curriculum_can_write(org_id, 'edit')) with check (public.curriculum_can_write(org_id, 'edit'));
grant select, insert, update, delete on curriculum_book_classes to authenticated;

-- Nhật ký điều chỉnh PPCT đang dùng (đã công bố): sửa / xoá tiết, nhập lại cả môn — kèm lý do
create table if not exists curriculum_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  book_id uuid not null references curriculum_books(id) on delete cascade,
  lesson_id uuid,
  seq int,
  action text not null check (action in ('insert', 'update', 'delete', 'import')),
  reason text,
  before jsonb, after jsonb,
  changed_by uuid references profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists curriculum_changes_book on curriculum_changes (book_id, changed_at desc);
alter table curriculum_changes enable row level security;
drop policy if exists curriculum_changes_read on curriculum_changes;
create policy curriculum_changes_read on curriculum_changes for select to authenticated using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
grant select on curriculum_changes to authenticated;

create or replace function public.curriculum_lessons_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; r curriculum_lessons := coalesce(new, old);
begin
  if coalesce(current_setting('app.ppct_import', true), '') = 'on' then return null; end if;
  select status into v_status from curriculum_books where id = r.book_id;
  if v_status is distinct from 'published' then return null; end if;
  if tg_op = 'UPDATE' and (new.seq, new.week, new.term, new.title, new.kind, new.unit_id, new.package_topic_id)
       is not distinct from (old.seq, old.week, old.term, old.title, old.kind, old.unit_id, old.package_topic_id) then return null; end if;
  insert into curriculum_changes (org_id, book_id, lesson_id, seq, action, reason, before, after)
  values (r.org_id, r.book_id, r.id, r.seq, lower(tg_op), case when tg_op <> 'DELETE' then nullif(btrim(new.change_reason), '') end,
          case when tg_op <> 'INSERT' then jsonb_build_object('seq', old.seq, 'week', old.week, 'term', old.term, 'title', old.title, 'kind', old.kind) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('seq', new.seq, 'week', new.week, 'term', new.term, 'title', new.title, 'kind', new.kind) end);
  return null;
end $$;
drop trigger if exists curriculum_lessons_log on curriculum_lessons;
create trigger curriculum_lessons_log after insert or update or delete on curriculum_lessons for each row execute function public.curriculum_lessons_log();

-- Thay toàn bộ tiết của một môn (nhập Excel) trong một lần, ghi một dòng nhật ký với lý do
create or replace function public.curriculum_replace_lessons(p_book uuid, p_rows jsonb, p_reason text default null) returns int
language plpgsql set search_path = public as $$
declare b curriculum_books; n int;
begin
  select * into b from curriculum_books where id = p_book;
  if b.id is null then raise exception 'Không tìm thấy PPCT' using errcode = '42501'; end if;
  perform set_config('app.ppct_import', 'on', true);
  delete from curriculum_lessons where book_id = p_book;
  insert into curriculum_lessons (book_id, seq, week, term, title, kind, package_topic_id, unit_id, note)
  select p_book, (r->>'seq')::int, nullif(r->>'week', '')::int, nullif(r->>'term', '')::smallint, r->>'title', coalesce(nullif(r->>'kind', ''), 'lesson'),
         nullif(r->>'package_topic_id', '')::uuid, nullif(r->>'unit_id', '')::uuid, nullif(r->>'note', '')
    from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  perform set_config('app.ppct_import', 'off', true);
  if b.status = 'published' then
    insert into curriculum_changes (org_id, book_id, action, reason, after) values (b.org_id, b.id, 'import', nullif(btrim(p_reason), ''), jsonb_build_object('count', n));
  end if;
  return n;
end $$;
revoke all on function public.curriculum_replace_lessons(uuid, jsonb, text) from public, anon;
grant execute on function public.curriculum_replace_lessons(uuid, jsonb, text) to authenticated;

-- Sao chép mẫu: thêm học kỳ, liên kết bài trong chương trình
create or replace function public.curriculum_copy(p_book uuid, p_year text default null) returns uuid
language plpgsql set search_path = public as $$
declare src curriculum_books; v_new uuid;
begin
  select * into src from curriculum_books where id = p_book;
  if not found then raise exception 'Không tìm thấy PPCT mẫu' using errcode = '42501'; end if;
  insert into curriculum_books (org_id, grade, subject, title, total_periods, year_name, periods_per_week, status, scope, source_id, note, program_id)
  values (public.my_org_id(), src.grade, src.subject, src.title, src.total_periods, coalesce(nullif(btrim(p_year), ''), src.year_name),
          src.periods_per_week, 'published', 'own', src.id, src.note, src.program_id)
  returning id into v_new;
  perform set_config('app.ppct_import', 'on', true);
  insert into curriculum_lessons (org_id, book_id, seq, week, term, title, kind, note, unit_id)
  select public.my_org_id(), v_new, l.seq, l.week, l.term, l.title, l.kind, l.note, l.unit_id from curriculum_lessons l where l.book_id = src.id;
  perform set_config('app.ppct_import', 'off', true);
  return v_new;
end $$;

-- Tạo PPCT (bản nháp) từ chương trình chuẩn: mỗi bài / buổi (mục lá) của khối thành số tiết tương ứng
create or replace function public.curriculum_from_program(p_program uuid, p_grade int, p_subject text default null,
  p_year text default null, p_ppw numeric default null) returns uuid
language plpgsql set search_path = public as $$
declare p edu_programs; v_book uuid; n int;
begin
  select * into p from edu_programs where id = p_program;
  if not found then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  if p_grade < p.grade_from or p_grade > p.grade_to then raise exception 'Khối % không thuộc chương trình', p_grade using errcode = '22023'; end if;
  insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, program_id, note)
  values (public.my_org_id(), p_grade, coalesce(nullif(btrim(p_subject), ''), p.main_subject),
          p.title || ' — khối ' || p_grade, nullif(btrim(p_year), ''), p_ppw, 'draft', 'own', p.id,
          'Tạo từ chương trình "' || p.title || '" (phiên bản ' || p.version_no || ')')
  returning id into v_book;
  with recursive t as (
    select u.id, u.parent_id, u.title, u.periods, array[u.seq, 0, 0] as path, u.grade, u.subject, 1 as depth
      from edu_program_units u where u.program_id = p.id and u.parent_id is null
    union all
    select u.id, u.parent_id, u.title, u.periods, t.path[1:t.depth] || u.seq || array_fill(0, array[2 - t.depth]),
           coalesce(u.grade, t.grade), coalesce(u.subject, t.subject), t.depth + 1
      from edu_program_units u join t on u.parent_id = t.id where t.depth < 3
  ), leaf as (
    select t.* from t where not exists (select 1 from edu_program_units c where c.parent_id = t.id)
      and (t.grade is null or t.grade = p_grade)
      and (p_subject is null or t.subject is null or lower(t.subject) = lower(btrim(p_subject)))
  ), lrows as (
    select l.id as unit_id, l.title, k, row_number() over (order by l.path, k) as seq
      from leaf l cross join lateral generate_series(1, greatest(l.periods, 1)) k
  )
  insert into curriculum_lessons (book_id, seq, week, title, kind, unit_id)
  select v_book, r.seq, case when p_ppw > 0 then ceil(r.seq / p_ppw)::int end,
         r.title || case when r.k > 1 then ' (tiếp)' else '' end,
         case when r.title ilike 'Kiểm tra%' then 'test' when r.title ilike 'Ôn tập%' then 'review'
              when p.kind = 'stem' or r.title ilike '%STEM%' then 'stem' when r.title ilike '%thực hành%' then 'practice' else 'lesson' end,
         r.unit_id
    from lrows r where r.seq <= 400;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Chương trình chưa có bài học cho khối %', p_grade using errcode = '22023'; end if;
  return v_book;
end $$;
revoke all on function public.curriculum_from_program(uuid, int, text, text, numeric) from public, anon;
grant execute on function public.curriculum_from_program(uuid, int, text, text, numeric) to authenticated;

-- PPCT đang dùng cho lớp × môn: ưu tiên PPCT gán riêng cho lớp, rồi PPCT chung của khối
create or replace function public.session_book(p_org uuid, p_class uuid, p_subject text) returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from curriculum_books b join classes c on c.id = p_class
   where b.org_id = p_org and b.grade = c.grade and b.status = 'published'
     and lower(btrim(b.subject)) = lower(btrim(p_subject))
     and (b.year_name is null or b.year_name = (select a.name from academic_years a where a.org_id = p_org and a.is_current limit 1))
     and exists (select 1 from curriculum_lessons l where l.book_id = b.id)
     and (not exists (select 1 from curriculum_book_classes x where x.book_id = b.id)
          or exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = p_class))
   order by exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = p_class) desc,
            b.year_name nulls last, b.updated_at desc
   limit 1
$$;
revoke all on function public.session_book(uuid, uuid, text) from public, anon, authenticated;

-- ===== 3. Phê duyệt PPCT và chương trình qua Hộp phê duyệt (022) =====
alter table approval_workflows drop constraint if exists approval_workflows_kind_check;
alter table approval_workflows add constraint approval_workflows_kind_check
  check (kind in ('stem_registration', 'borrow_request', 'package_purchase', 'edu_plan', 'project', 'supply_purchase', 'stock_transfer',
                  'curriculum_plan', 'edu_program'));
create or replace function public.approval_kind_module(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'stem_registrations' when 'borrow_request' then 'stem_rooms'
    when 'package_purchase' then 'packages' when 'edu_plan' then 'edu_plan' when 'project' then 'projects'
    when 'supply_purchase' then 'equipment' when 'stock_transfer' then 'equipment'
    when 'curriculum_plan' then 'curriculum' when 'edu_program' then 'curriculum' end
$$;
create or replace function public.approval_kind_label(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stem_registration' then 'Đăng ký dạy STEM' when 'borrow_request' then 'Phiếu mượn thiết bị'
    when 'package_purchase' then 'Đề xuất mua gói STEM' when 'edu_plan' then 'Kế hoạch giáo dục' when 'project' then 'Dự án STEM'
    when 'supply_purchase' then 'Đề xuất mua vật tư' when 'stock_transfer' then 'Phiếu vận chuyển'
    when 'curriculum_plan' then 'Phân phối chương trình' when 'edu_program' then 'Chương trình giáo dục' end
$$;

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
  elsif tg_table_name = 'curriculum_books' then
    v_kind := 'curriculum_plan'; v_title := new.title;
    select concat_ws(' · ', 'Khối ' || new.grade, new.subject, count(*) || ' tiết', new.year_name) into v_sum from curriculum_lessons where book_id = new.id;
    v_by := auth.uid();
  elsif tg_table_name = 'edu_programs' then
    v_kind := 'edu_program'; v_title := new.title || ' (phiên bản ' || new.version_no || ')';
    v_sum := concat_ws(' · ', new.main_subject, 'Khối ' || new.grade_from || case when new.grade_to > new.grade_from then '–' || new.grade_to else '' end,
                       new.total_periods || ' tiết', new.ct_code);
    v_by := auth.uid();
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
    using case when r.ref_table in ('package_orders', 'education_plans', 'supply_requests', 'stock_transfers', 'student_projects',
                                    'curriculum_books', 'edu_programs') then 'draft' else 'rejected' end, r.ref_id;
  perform set_config('app.approval_engine', 'off', true);
end $$;

do $$
declare t text;
begin
  foreach t in array array['curriculum_books', 'edu_programs'] loop
    execute format('drop trigger if exists %I on %I', t || '_approval_open', t);
    execute format('create trigger %I after insert or update of status on %I for each row execute function public.approval_source_opened()', t || '_approval_open', t);
    execute format('drop trigger if exists %I on %I', t || '_approval_guard', t);
    execute format('create trigger %I before update of status on %I for each row execute function public.approval_source_guard()', t || '_approval_guard', t);
    execute format('drop trigger if exists %I on %I', t || '_approval_deleted', t);
    execute format('create trigger %I after delete on %I for each row execute function public.approval_source_deleted()', t || '_approval_deleted', t);
  end loop;
end $$;

-- ===== 4. Kho tệp học liệu / minh chứng (Supabase Storage, bucket riêng tư) =====
-- Đường dẫn tệp: <id đơn vị>/<…>. Nhân sự đơn vị tải lên thư mục của đơn vị mình; nhân sự đơn vị và cấp trên đọc;
-- học sinh đọc tệp của trường mình; tệp của học liệu đã phát hành đọc được theo phạm vi phát hành (023).
create or replace function public.learning_file_org(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;
create or replace function public.learning_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (public.is_staff() and public.learning_file_org(p_name) in (select public.my_org_tree()))
    or (public.is_student() and public.learning_file_org(p_name) = public.my_org_id())
    or exists (select 1 from library_items i where i.kind = 'material' and i.status = 'published' and i.content->>'path' = p_name
                and (public.library_visible(i.id) or public.is_student())), false)
$$;
create or replace function public.learning_file_writable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_staff() and public.learning_file_org(p_name) = public.my_org_id(), false)
$$;
revoke all on function public.learning_file_readable(text), public.learning_file_writable(text) from public, anon;
grant execute on function public.learning_file_org(text), public.learning_file_readable(text), public.learning_file_writable(text) to authenticated;

do $st$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'Bỏ qua kho tệp: không có schema storage'; return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit) values ('learning-files', 'learning-files', false, 52428800)
  on conflict (id) do nothing;
  begin
    execute $p$drop policy if exists learning_files_read on storage.objects$p$;
    execute $p$create policy learning_files_read on storage.objects for select to authenticated
      using (bucket_id = 'learning-files' and public.learning_file_readable(name))$p$;
    execute $p$drop policy if exists learning_files_insert on storage.objects$p$;
    execute $p$create policy learning_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'learning-files' and public.learning_file_writable(name))$p$;
    execute $p$drop policy if exists learning_files_update on storage.objects$p$;
    execute $p$create policy learning_files_update on storage.objects for update to authenticated
      using (bucket_id = 'learning-files' and public.learning_file_writable(name) and (owner = auth.uid() or public.is_admin() or public.is_authority()))
      with check (bucket_id = 'learning-files' and public.learning_file_writable(name))$p$;
    execute $p$drop policy if exists learning_files_delete on storage.objects$p$;
    execute $p$create policy learning_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'learning-files' and public.learning_file_writable(name) and (owner = auth.uid() or public.is_admin() or public.is_authority()))$p$;
  exception when insufficient_privilege then
    raise warning 'Không tạo được chính sách cho storage.objects — tạo lại bằng SQL Editor với quyền chủ bảng';
  end;
end $st$;

-- ===== 5. Minh chứng thực hiện tiết PPCT =====
create table if not exists curriculum_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  lesson_id uuid not null references curriculum_lessons(id) on delete cascade,
  session_id uuid references teaching_sessions(id) on delete set null,
  kind text not null default 'photo' check (kind in ('photo', 'file', 'link', 'note', 'product')),
  url text check (url is null or url ~* '^https?://'),
  path text,                                     -- tệp trong bucket learning-files
  file_name text,
  note text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (url is not null or path is not null or nullif(btrim(note), '') is not null)
);
create index if not exists curriculum_evidence_class on curriculum_evidence (class_id, lesson_id);

create or replace function public.curriculum_evidence_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select c.org_id into new.org_id from classes c join curriculum_lessons l on l.id = new.lesson_id and l.org_id = c.org_id where c.id = new.class_id;
  if new.org_id is null then raise exception 'Tiết PPCT không thuộc trường của lớp' using errcode = '22023'; end if;
  if new.path is not null and public.learning_file_org(new.path) is distinct from new.org_id then
    raise exception 'Tệp minh chứng phải thuộc thư mục của trường' using errcode = '22023';
  end if;
  if new.session_id is not null and not exists (select 1 from teaching_sessions s where s.id = new.session_id and s.class_id = new.class_id) then
    raise exception 'Tiết dạy không thuộc lớp này' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists curriculum_evidence_guard on curriculum_evidence;
create trigger curriculum_evidence_guard before insert or update on curriculum_evidence for each row execute function public.curriculum_evidence_guard();

alter table curriculum_evidence enable row level security;
drop policy if exists curriculum_evidence_read on curriculum_evidence;
create policy curriculum_evidence_read on curriculum_evidence for select to authenticated
  using ((select public.is_staff()) and org_id in (select public.my_org_tree()));
drop policy if exists curriculum_evidence_insert on curriculum_evidence;
create policy curriculum_evidence_insert on curriculum_evidence for insert to authenticated with check (
  org_id = (select public.my_org_id()) and (public.teaches_class(class_id) or (select public.is_admin()) or (select public.has_perm('timetable', 'edit'))));
drop policy if exists curriculum_evidence_update on curriculum_evidence;
create policy curriculum_evidence_update on curriculum_evidence for update to authenticated
  using (org_id = (select public.my_org_id()) and (created_by = auth.uid() or (select public.is_admin())))
  with check (org_id = (select public.my_org_id()));
drop policy if exists curriculum_evidence_delete on curriculum_evidence;
create policy curriculum_evidence_delete on curriculum_evidence for delete to authenticated
  using (org_id = (select public.my_org_id()) and (created_by = auth.uid() or (select public.is_admin())));
grant select, insert, update, delete on curriculum_evidence to authenticated;

-- ===== 6. Theo dõi thực hiện =====
-- Lớp × PPCT đang dùng trong phạm vi người xem (trường, Phòng, Sở, KDI), kèm tuần hiện tại của năm học và địa bàn
create or replace function public.curriculum_class_books(p_org uuid default null, p_class uuid default null)
returns table (org_id uuid, school text, area text, class_id uuid, class_name text, grade int, book_id uuid, week int)
language sql stable security definer set search_path = public as $$
  with sch as (
    select o.id, o.name, (select p.name from organizations p where p.id = o.parent_id) as area from organizations o
     where o.type = 'school' and o.id in (select public.my_org_tree()) and public.is_staff()
       and (p_org is null or o.id = p_org)
  ), yr as (
    select a.org_id, a.name, min(a.starts_on) as start from academic_years a
     where a.org_id in (select id from sch)
       and a.name = (select a2.name from academic_years a2 where a2.org_id = a.org_id and a2.is_current limit 1)
     group by a.org_id, a.name
  ), cls as (
    select c.id, c.org_id, c.name, c.grade from classes c
     where c.org_id in (select id from sch) and (p_class is null or c.id = p_class)
       and (c.year_id is null or c.year_id in (select a.id from academic_years a join yr on yr.org_id = a.org_id and yr.name = a.name))
  ), pick as (
    select distinct on (c.id, lower(btrim(b.subject))) c.id as class_id, b.id as book_id
      from cls c join curriculum_books b on b.org_id = c.org_id and b.grade = c.grade and b.status = 'published'
      left join yr on yr.org_id = c.org_id
     where (b.year_name is null or b.year_name = yr.name)
       and (not exists (select 1 from curriculum_book_classes x where x.book_id = b.id)
            or exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = c.id))
     order by c.id, lower(btrim(b.subject)), exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = c.id) desc,
              b.year_name nulls last, b.updated_at desc
  )
  select c.org_id, s.name, s.area, c.id, c.name, c.grade, p.book_id,
         case when yr.start is null then null else greatest(1, least(52, (public.vn_today() - yr.start) / 7 + 1)) end
    from pick p join cls c on c.id = p.class_id join sch s on s.id = c.org_id left join yr on yr.org_id = c.org_id
$$;
revoke all on function public.curriculum_class_books(uuid, uuid) from public, anon, authenticated;

-- Trạng thái từng tiết của lớp: done (đã dạy) · before (trước khi bắt đầu ghi nhận) · skipped (bỏ qua, các tiết sau đã dạy)
-- · late (quá tuần kế hoạch, chưa dạy) · due (tuần này) · upcoming (chưa đến). Tiết STEM / thực hành cần minh chứng.
create or replace function public.curriculum_lesson_rows(p_org uuid, p_class uuid)
returns table (org_id uuid, school text, area text, class_id uuid, class_name text, grade int, subject text, book_id uuid, book_title text,
               program_id uuid, lesson_id uuid, seq int, week int, term int, title text, kind text, unit_id uuid, plan_week int, cur_week int,
               state text, taught_on date, teacher text, evidence int, needs_evidence boolean)
language sql stable security definer set search_path = public as $$
  with cb as (select * from public.curriculum_class_books(p_org, p_class)),
  ls as (
    select cb.*, b.subject, b.title as book_title, b.program_id, l.id as lesson_id, l.seq, l.week as l_week, l.term, l.title, l.kind, l.unit_id,
           coalesce(l.week, ceil(l.seq / b.periods_per_week)::int) as plan_week
      from cb join curriculum_books b on b.id = cb.book_id join curriculum_lessons l on l.book_id = b.id
  ), d as (
    select distinct on (ts.class_id, ts.curriculum_lesson_id) ts.class_id, ts.curriculum_lesson_id, ts.session_date, t.full_name
      from teaching_sessions ts left join teachers t on t.id = ts.teacher_id
     where ts.class_id in (select cb.class_id from cb) and ts.status = 'taught' and ts.curriculum_lesson_id is not null
     order by ts.class_id, ts.curriculum_lesson_id, ts.session_date
  ), ev as (
    select e.class_id, e.lesson_id, count(*)::int as n from curriculum_evidence e
     where e.class_id in (select cb.class_id from cb) group by 1, 2
  ), x as (
    select ls.*, d.session_date, d.full_name, coalesce(ev.n, 0) as ev_n,
           min(ls.seq) filter (where d.curriculum_lesson_id is not null) over w as first_seq,
           max(ls.seq) filter (where d.curriculum_lesson_id is not null) over w as reached
      from ls left join d on d.class_id = ls.class_id and d.curriculum_lesson_id = ls.lesson_id
      left join ev on ev.class_id = ls.class_id and ev.lesson_id = ls.lesson_id
    window w as (partition by ls.class_id, ls.book_id)
  )
  select x.org_id, x.school, x.area, x.class_id, x.class_name, x.grade, x.subject, x.book_id, x.book_title, x.program_id,
         x.lesson_id, x.seq, x.l_week, x.term::int, x.title, x.kind, x.unit_id, x.plan_week, x.week,
         case when x.session_date is not null then 'done'
              when x.first_seq is not null and x.seq < x.first_seq then 'before'
              when x.reached is not null and x.seq < x.reached then 'skipped'
              when x.plan_week < x.week then 'late'
              when x.plan_week = x.week then 'due'
              else 'upcoming' end,
         x.session_date, x.full_name, x.ev_n, x.kind in ('stem', 'practice')
    from x
$$;
revoke all on function public.curriculum_lesson_rows(uuid, uuid) from public, anon, authenticated;

-- Danh sách tiết của một lớp, hoặc (p_only_missed) nội dung chưa hoàn thành của một trường / phạm vi
create or replace function public.curriculum_lesson_status(p_class uuid default null, p_org uuid default null, p_only_missed boolean default false)
returns table (org_id uuid, school text, area text, class_id uuid, class_name text, grade int, subject text, book_id uuid, book_title text,
               program_id uuid, lesson_id uuid, seq int, week int, term int, title text, kind text, unit_id uuid, plan_week int, cur_week int,
               state text, taught_on date, teacher text, evidence int, needs_evidence boolean)
language sql stable security definer set search_path = public as $$
  select r.* from public.curriculum_lesson_rows(p_org, p_class) r
   where (p_class is not null or p_only_missed)
     and (not p_only_missed or r.state in ('skipped', 'late') or (r.state = 'done' and r.needs_evidence and r.evidence = 0))
   order by r.school, r.grade, r.class_name, r.subject, r.seq
$$;
revoke all on function public.curriculum_lesson_status(uuid, uuid, boolean) from public, anon;
grant execute on function public.curriculum_lesson_status(uuid, uuid, boolean) to authenticated;

-- Yêu cầu cần đạt theo lớp: đạt khi mọi tiết PPCT gắn với chủ đề / bài (và mục con) đã dạy
create or replace function public.curriculum_outcome_status(p_class uuid default null, p_org uuid default null)
returns table (org_id uuid, school text, area text, class_id uuid, class_name text, book_id uuid, subject text, outcome_id uuid, code text,
               content text, competency_key text, unit_title text, lessons int, done int, state text)
language sql stable security definer set search_path = public as $$
  with r as (select * from public.curriculum_lesson_rows(p_org, p_class) where p_class is not null or p_org is not null),
  units as (   -- mỗi mục và mọi tổ tiên của nó (để tiết gắn với buổi / bài tính cho chủ đề cha)
    with recursive up as (
      select u.id, u.id as anc from edu_program_units u where u.program_id in (select distinct r.program_id from r where r.program_id is not null)
      union all
      select up.id, p.parent_id from up join edu_program_units p on p.id = up.anc where p.parent_id is not null
    ) select * from up
  ), cov as (
    select r.class_id, r.book_id, units.anc as unit_id, count(*)::int as lessons,
           count(*) filter (where r.state in ('done', 'before'))::int as done
      from r join units on units.id = r.unit_id group by 1, 2, 3
  ), cls as (select distinct r.org_id, r.school, r.area, r.class_id, r.class_name, r.book_id, r.subject, r.program_id from r)
  select c.org_id, c.school, c.area, c.class_id, c.class_name, c.book_id, c.subject, o.id, o.code, o.content, o.competency_key, u.title,
         coalesce(cov.lessons, 0), coalesce(cov.done, 0),
         case when coalesce(cov.lessons, 0) = 0 then 'unplanned' when cov.done >= cov.lessons then 'done' when cov.done > 0 then 'partial' else 'todo' end
    from cls c join edu_outcomes o on o.program_id = c.program_id
    left join edu_program_units u on u.id = o.unit_id
    left join cov on cov.class_id = c.class_id and cov.book_id = c.book_id and cov.unit_id = o.unit_id
   order by c.school, c.class_name, c.subject, u.seq nulls first, o.seq
$$;
revoke all on function public.curriculum_outcome_status(uuid, uuid) from public, anon;
grant execute on function public.curriculum_outcome_status(uuid, uuid) to authenticated;

-- Tiến độ (057) + nội dung chưa hoàn thành, tiết STEM chưa có minh chứng, yêu cầu cần đạt, địa bàn
drop function if exists public.curriculum_progress(uuid);
create function public.curriculum_progress(p_org uuid default null)
returns table (org_id uuid, school text, class_id uuid, class_name text, grade int, subject text, book_id uuid, book_title text,
               total int, week int, planned int, reached int, taught int, last_title text, last_date date, gap int,
               area text, missed int, no_evidence int, program_id uuid)
language sql stable security definer set search_path = public as $$
  with cb as (select * from public.curriculum_class_books(p_org, null)),
  st as (
    select r.class_id, r.book_id, count(*) filter (where r.state in ('skipped', 'late'))::int as missed,
           count(*) filter (where r.state = 'done' and r.needs_evidence and r.evidence = 0)::int as no_evidence
      from public.curriculum_lesson_rows(p_org, null) r group by 1, 2
  )
  select cb.org_id, cb.school, cb.class_id, cb.class_name, cb.grade, b.subject, b.id, b.title,
    t.total::int, cb.week, coalesce(t.planned, 0)::int, coalesce(r.reached, 0)::int, coalesce(r.taught, 0)::int,
    r.last_title, r.last_date, (coalesce(t.planned, 0) - coalesce(r.reached, 0))::int,
    cb.area, coalesce(st.missed, 0), coalesce(st.no_evidence, 0), b.program_id
  from cb join curriculum_books b on b.id = cb.book_id
  left join st on st.class_id = cb.class_id and st.book_id = cb.book_id
  cross join lateral (
    select count(*) as total,
           count(*) filter (where coalesce(l.week, ceil(l.seq / b.periods_per_week)::int) <= cb.week) as planned
      from curriculum_lessons l where l.book_id = b.id
  ) t
  cross join lateral (
    select max(l.seq) as reached, count(ts.id) as taught,
           (array_agg(l.title order by ts.session_date desc, l.seq desc) filter (where l.id is not null))[1] as last_title,
           max(ts.session_date) filter (where l.id is not null) as last_date
      from teaching_sessions ts left join curriculum_lessons l on l.id = ts.curriculum_lesson_id and l.book_id = b.id
     where ts.class_id = cb.class_id and ts.status = 'taught' and lower(btrim(ts.subject)) = lower(btrim(b.subject))
  ) r
  order by cb.school, cb.grade, cb.class_name, b.subject
$$;
revoke all on function public.curriculum_progress(uuid) from public, anon;
grant execute on function public.curriculum_progress(uuid) to authenticated;

-- Độ phủ một chương trình (mọi phiên bản): trường được gán, trường đã có PPCT theo chương trình, lớp, tiết, YCCĐ
create or replace function public.edu_program_coverage(p_program uuid)
returns table (org_id uuid, school text, area text, assigned boolean, grades int[], books int, classes int,
               lessons int, done int, missed int, outcomes int, outcomes_done int)
language sql stable security definer set search_path = public as $$
  with fam as (select p.id from edu_programs p where p.family_id = (select family_id from edu_programs where id = p_program)),
  sch as (
    select o.id, o.name, (select p.name from organizations p where p.id = o.parent_id) as area from organizations o
     where o.type = 'school' and o.id in (select public.my_org_tree()) and public.is_staff()
  ), asg as (
    select a.org_id, a.grades from edu_program_assignments a where a.program_id in (select id from fam)
  ), sch_asg as (   -- gán cho Phòng / Sở = mọi trường trực thuộc
    select s.id as school_id, a.grades from sch s join asg a on a.org_id = s.id or a.org_id in (
      with recursive up as (select o.parent_id as id from organizations o where o.id = s.id
                            union all select o.parent_id from organizations o join up on o.id = up.id where o.parent_id is not null)
      select id from up)
  ), bk as (
    select b.org_id, count(*)::int as n from curriculum_books b where b.program_id in (select id from fam) and b.org_id in (select id from sch) group by 1
  ), lrows as (
    select r.* from public.curriculum_lesson_rows(null, null) r where r.program_id in (select id from fam)
  ), oc as (
    select o.org_id, count(*)::int as n, count(*) filter (where o.state = 'done')::int as d
      from sch cross join lateral public.curriculum_outcome_status(null, sch.id) o
     where o.book_id in (select b.id from curriculum_books b where b.program_id in (select id from fam)) group by 1
  )
  select s.id, s.name, s.area, exists (select 1 from sch_asg x where x.school_id = s.id),
         (select x.grades from sch_asg x where x.school_id = s.id limit 1),
         coalesce(bk.n, 0), (select count(distinct r.class_id)::int from lrows r where r.org_id = s.id),
         (select count(*)::int from lrows r where r.org_id = s.id),
         (select count(*) filter (where r.state in ('done', 'before'))::int from lrows r where r.org_id = s.id),
         (select count(*) filter (where r.state in ('skipped', 'late'))::int from lrows r where r.org_id = s.id),
         coalesce(oc.n, 0), coalesce(oc.d, 0)
    from sch s left join bk on bk.org_id = s.id left join oc on oc.org_id = s.id
   where bk.n is not null or exists (select 1 from sch_asg x where x.school_id = s.id)
   order by s.area nulls last, s.name
$$;
revoke all on function public.edu_program_coverage(uuid) from public, anon;
grant execute on function public.edu_program_coverage(uuid) to authenticated;

-- ===== 7. Dữ liệu mẫu =====
do $$
declare
  kdi uuid; so uuid; sch uuid; v1 uuid; v2 uuid; v_stem uuid; v_so_prog uuid; t uuid; l uuid; b record; c record; k int;
  topics jsonb := '[
    {"t":"Chủ đề A. Máy tính và cộng đồng","o":["Nhận biết được sự khác nhau giữa thông tin và dữ liệu","Nêu được ví dụ minh hoạ tầm quan trọng của thông tin"],
     "l":[["Bài 1. Thông tin và dữ liệu",2],["Bài 2. Xử lí thông tin",2],["Bài 3. Thông tin trong máy tính",2]]},
    {"t":"Chủ đề B. Mạng máy tính và Internet","o":["Nêu được khái niệm và lợi ích của mạng máy tính","Nêu được các đặc điểm và lợi ích chính của Internet"],
     "l":[["Bài 4. Mạng máy tính",2],["Bài 5. Internet",1]]},
    {"t":"Chủ đề C. Tổ chức lưu trữ, tìm kiếm và trao đổi thông tin","o":["Sử dụng được máy tìm kiếm để tìm thông tin theo từ khoá","Biết sử dụng thư điện tử để trao đổi thông tin"],
     "l":[["Bài 6. Mạng thông tin toàn cầu",2],["Bài 7. Tìm kiếm thông tin trên Internet",2],["Bài 8. Thư điện tử",1]]},
    {"t":"Chủ đề D. Đạo đức, pháp luật và văn hoá trong môi trường số","o":["Biết cách bảo vệ thông tin cá nhân và an toàn khi sử dụng Internet"],
     "l":[["Bài 9. An toàn thông tin trên Internet",2]]},
    {"t":"Chủ đề E. Ứng dụng tin học","o":["Tạo được sơ đồ tư duy đơn giản","Định dạng được văn bản, trình bày thông tin ở dạng bảng"],
     "l":[["Bài 10. Sơ đồ tư duy",1],["Bài 11. Định dạng văn bản",2],["Bài 12. Trình bày thông tin ở dạng bảng",1],["Bài 13. Thực hành: Tìm kiếm và thay thế",1],["Bài 14. Thực hành tổng hợp: Hoàn thiện sổ lưu niệm",1]]},
    {"t":"Chủ đề F. Giải quyết vấn đề với sự trợ giúp của máy tính","o":["Mô tả được thuật toán đơn giản có các cấu trúc tuần tự, rẽ nhánh, lặp","Tạo được sản phẩm số tương tác bằng Scratch"],
     "l":[["Bài 15. Thuật toán",2],["Bài 16. Các cấu trúc điều khiển",1],["Bài 17. Chương trình máy tính",1],["Dự án STEM: Trò chơi tương tác với Scratch",1]]}
  ]';
  x jsonb; y jsonb; i int; j int;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  select id into sch from organizations where code = 'THCS-PH';
  if kdi is null or exists (select 1 from edu_programs where org_id = kdi) then return; end if;

  -- KDI: Tin học THCS (CTGDPT 2018) — phiên bản 1 (đã bị thay thế) và phiên bản 2 đang ban hành, dùng chung cho mọi trường
  insert into edu_programs (org_id, code, title, kind, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope, note)
  values (kdi, 'TIN-THCS-2018', 'Tin học THCS (CT GDPT 2018)', 'subject', 'thcs', 6, 9, 'Tin học', '{Toán}',
          'Hình thành và phát triển năng lực tin học: sử dụng và quản lí phương tiện CNTT; ứng xử phù hợp trong môi trường số; giải quyết vấn đề với sự hỗ trợ của CNTT; ứng dụng CNTT trong học và tự học; hợp tác trong môi trường số.',
          '{tin_hoc,gqvd,tu_chu}', 'children', 'Khung chương trình tham khảo của KDI theo CT GDPT 2018 (Kết nối tri thức).')
  returning id into v1;
  i := 0;
  for x in select * from jsonb_array_elements(topics) loop
    i := i + 1;
    insert into edu_program_units (program_id, unit_type, seq, grade, title) values (v1, 'topic', i, 6, x->>'t') returning id into t;
    j := 0;
    for y in select * from jsonb_array_elements(x->'l') loop
      j := j + 1;
      insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values (v1, t, 'lesson', j, y->>0, (y->>1)::int);
    end loop;
    j := 0;
    for y in select * from jsonb_array_elements(x->'o') loop
      j := j + 1;
      insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key)
      values (v1, t, j, 'YC' || i || '.' || j, y #>> '{}', case when i = 6 then 'gqvd' else 'tin_hoc' end);
    end loop;
  end loop;
  update edu_programs set status = 'published', published_at = now() - interval '400 days', effective_from = public.vn_today() - 400 where id = v1;
  v2 := public.edu_program_clone(v1, kdi, (select family_id from edu_programs where id = v1), 2);
  update edu_programs set note = 'Phiên bản 2: bổ sung yêu cầu cần đạt về dự án STEM; chỉnh số tiết chủ đề F.' where id = v2;
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key)
  select v2, u.id, 3, 'YC6.3', 'Trình bày và chia sẻ được sản phẩm số với bạn bè', 'giao_tiep'
    from edu_program_units u where u.program_id = v2 and u.title like 'Chủ đề F%';
  update edu_programs set status = 'published', published_at = now() - interval '30 days', effective_from = public.vn_today() - 30 where id = v2;
  update edu_programs set status = 'superseded', replaced_by = v2, effective_to = public.vn_today() - 30 where id = v1;

  -- KDI: chương trình STEM CT2 (tích hợp Công nghệ, Tin học, Toán)
  insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
  values (kdi, 'STEM-CT2', 'STEM CT2 — Robot và lập trình', 'stem', 'CT2', 'thcs', 6, 9, 'Công nghệ', '{Tin học,Toán,Khoa học tự nhiên}',
          'Học sinh thiết kế, lắp ráp và lập trình robot giải quyết vấn đề thực tiễn; phát triển tư duy kĩ thuật và hợp tác.',
          '{cong_nghe,tin_hoc,gqvd,giao_tiep}', 'children')
  returning id into v_stem;
  insert into edu_program_units (program_id, unit_type, seq, grade, subject, title, periods) values (v_stem, 'topic', 1, 8, 'Công nghệ', 'Chủ đề 1. Robot dò line', 0) returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values (v_stem, t, 'lesson', 1, 'Cảm biến hồng ngoại và nguyên lí dò line', 0) returning id into l;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values
    (v_stem, l, 'session', 1, 'Buổi 1: Tìm hiểu cảm biến', 1), (v_stem, l, 'session', 2, 'Buổi 2: Lắp ráp robot', 2), (v_stem, l, 'session', 3, 'Buổi 3: Lập trình và thi đấu', 2);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_stem, t, 1, 'R1', 'Giải thích được nguyên lí hoạt động của cảm biến hồng ngoại', 'khoa_hoc'),
    (v_stem, t, 2, 'R2', 'Lắp ráp và lập trình được robot đi theo vạch', 'cong_nghe');
  insert into edu_program_units (program_id, unit_type, seq, grade, subject, title, periods) values (v_stem, 'topic', 2, 9, 'Tin học', 'Chủ đề 2. Nhà thông minh IoT', 4) returning id into t;
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_stem, t, 1, 'I1', 'Kết nối cảm biến và điều khiển thiết bị qua mạng', 'tin_hoc');
  update edu_programs set status = 'published', published_at = now() - interval '60 days', effective_from = public.vn_today() - 60 where id = v_stem;

  -- Sở Hưng Yên: gán Tin học THCS và STEM CT2 cho trường THCS Phố Hiến; chương trình STEM riêng của Sở đang soạn (nháp)
  if so is not null then
    if sch is not null then
      insert into edu_program_assignments (program_id, org_id, grades, note) values
        (v2, sch, '{6,7,8,9}', 'Áp dụng năm học hiện tại'), (v_stem, sch, '{8,9}', 'Thí điểm STEM CT2 khối 8, 9');
    end if;
    insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
    values (so, 'HY-STEM-NN', 'Giáo dục STEM nông nghiệp thông minh', 'stem', 'CT3', 'thcs', 7, 8, 'Công nghệ', '{Khoa học tự nhiên,Tin học}',
            'Vận dụng kiến thức liên môn để thiết kế mô hình tưới cây tự động phù hợp địa phương.', '{khoa_hoc,cong_nghe}', 'children')
    returning id into v_so_prog;
    insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) values (v_so_prog, 'topic', 1, 7, 'Chủ đề 1. Đất trồng và nhu cầu nước của cây', 2) returning id into t;
    insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values (v_so_prog, t, 1, 'N1', 'Đo và đánh giá được độ ẩm đất', 'khoa_hoc');
    insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) values (v_so_prog, 'topic', 2, 8, 'Chủ đề 2. Hệ thống tưới tự động', 3);
  end if;

  if sch is null then return; end if;
  -- Trường: PPCT Tin học 6 (sao từ mẫu KDI) gắn với chương trình Tin học THCS phiên bản 2; liên kết từng tiết với bài
  perform set_config('app.ppct_import', 'on', true);
  for b in select * from curriculum_books where org_id = sch and grade = 6 and subject = 'Tin học' loop
    update curriculum_books set program_id = v2 where id = b.id;
    update curriculum_lessons cl set unit_id = u.id
      from edu_program_units u
     where cl.book_id = b.id and u.program_id = v2 and u.unit_type = 'lesson'
       and regexp_replace(cl.title, ' \(tiếp\)$', '') = u.title;
  end loop;
  -- PPCT Công nghệ khối 8: theo chương trình STEM CT2 (tiết chủ đề STEM gắn với các buổi)
  for b in select * from curriculum_books where org_id = sch and grade = 8 and subject = 'Công nghệ' loop
    update curriculum_books set program_id = v_stem where id = b.id;
    k := 0;
    for l in select u.id from edu_program_units u where u.program_id = v_stem and u.unit_type = 'session' order by u.seq loop
      k := k + 1;
      update curriculum_lessons set unit_id = l where id = (select id from curriculum_lessons where book_id = b.id and kind = 'stem' order by seq offset k - 1 limit 1);
    end loop;
  end loop;
  -- Hai lớp bỏ qua một tiết (để có "nội dung chưa hoàn thành"); một số tiết STEM đã dạy có minh chứng
  for c in select distinct on (ts.class_id) ts.class_id, ts.curriculum_lesson_id, l.book_id, l.seq
             from teaching_sessions ts join curriculum_lessons l on l.id = ts.curriculum_lesson_id
            where ts.org_id = sch and ts.status = 'taught'
            order by ts.class_id, l.seq desc limit 2 loop
    update teaching_sessions ts set curriculum_lesson_id = (select id from curriculum_lessons where book_id = c.book_id and seq = l2.seq + 1)
      from curriculum_lessons l2
     where l2.id = ts.curriculum_lesson_id and ts.class_id = c.class_id and l2.book_id = c.book_id and l2.seq >= c.seq - 1
       and exists (select 1 from curriculum_lessons where book_id = c.book_id and seq = l2.seq + 1);
  end loop;
  insert into curriculum_evidence (class_id, lesson_id, session_id, kind, url, note)
  select ts.class_id, ts.curriculum_lesson_id, ts.id, 'link', 'https://drive.google.com/drive/folders/minh-chung-stem',
         'Ảnh sản phẩm nhóm và phiếu đánh giá'
    from teaching_sessions ts join curriculum_lessons l on l.id = ts.curriculum_lesson_id
   where ts.org_id = sch and ts.status = 'taught' and l.kind in ('stem', 'practice')
     and abs(hashtext(ts.id::text)) % 2 = 0;
  perform set_config('app.ppct_import', 'off', true);
end $$;
