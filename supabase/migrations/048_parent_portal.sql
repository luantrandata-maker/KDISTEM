-- 048: Cổng Phụ huynh.
--   1. Vai trò "parent" (cổng parent). Phụ huynh KHÔNG là nhân sự: is_staff() loại trừ cả student và parent,
--      nên mọi chính sách đọc theo nhân sự không mở cho phụ huynh. Phụ huynh chỉ đọc dữ liệu con mình qua các hàm parent_*.
--   2. guardians: phụ huynh / người giám hộ của từng học sinh (họ tên, quan hệ, SĐT, email, nhận cảnh báo).
--      Một người có nhiều con trong trường = nhiều dòng cùng SĐT → một tài khoản thấy tất cả các con.
--   3. Tài khoản phụ huynh đăng nhập bằng mã (037): tên đăng nhập <mã trường>.ph<SĐT>; account_prepare / account_reset_target
--      nhận kind 'parent'. Khi tạo tài khoản, apply_invitations gắn tài khoản cho mọi dòng phụ huynh cùng SĐT ở trường.
--   4. parent_children(), parent_child(student): lịch học tuần, chuyên cần, bài tập & điểm, năng lực, GVCN, đồng ý dữ liệu.
--      parent_consent(): phụ huynh tự xác nhận / rút đồng ý trực tuyến (039).
--   5. Báo vắng: điểm danh "vắng" → thông báo cho phụ huynh có tài khoản và bật nhận cảnh báo (gộp theo ngày).
--   6. Khảo sát (043) thêm đối tượng "phụ huynh".

-- ===== 1. Vai trò =====
alter table roles drop constraint if exists roles_portal;
alter table roles add constraint roles_portal
  check (portal is null or portal in ('school_admin', 'teacher', 'student', 'department', 'platform', 'parent'));
insert into roles (key, name, is_system, portal, description)
select 'parent', 'Phụ huynh', true, 'parent', 'Cha mẹ / người giám hộ: xem lịch học, chuyên cần, bài tập, năng lực của con'
 where not exists (select 1 from roles where key = 'parent' and org_id is null);

-- Vai trò phụ huynh gán được ở trường (019/021)
create or replace function public.role_fits_org(p_role uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r, organizations o
     where r.id = p_role and o.id = p_org
       and case
             when r.org_id is not null then r.org_id = o.id
             when r.key = 'platform_admin' then o.is_platform
             when o.type = 'school' then r.key in ('principal','it_admin','teacher','office_staff','student','parent')
             else r.key = o.type
           end)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                 where m.user_id = auth.uid() and m.org_id = public.my_org_id() and r.key not in ('student', 'parent'))
$$;

-- ===== 2. Phụ huynh =====
create table if not exists guardians (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) >= 2),
  relation text not null default 'guardian' check (relation in ('father', 'mother', 'guardian', 'other')),
  phone text,
  phone_norm text generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored,
  email text,
  profile_id uuid references profiles(id) on delete set null,
  receive_alerts boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  check (phone is null or regexp_replace(phone, '[^0-9]', '', 'g') ~ '^[0-9]{9,12}$')
);
create index if not exists guardians_student on guardians (student_id);
create index if not exists guardians_profile on guardians (profile_id) where profile_id is not null;
create index if not exists guardians_phone on guardians (org_id, phone_norm) where phone_norm is not null;
create unique index if not exists guardians_student_phone on guardians (student_id, phone_norm) where phone_norm is not null;

create or replace function public.guard_guardian() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select org_id into new.org_id from students where id = new.student_id;
  if new.org_id is null then raise exception 'Không có học sinh này' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id
     and coalesce(current_setting('app.login_admin', true), '') <> 'on' and auth.uid() is not null then
    new.profile_id := old.profile_id;          -- tài khoản chỉ gắn qua lời mời / tạo tài khoản mã
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and coalesce(current_setting('app.login_admin', true), '') <> 'on' then
    new.profile_id := null;
  end if;
  return new;
end $$;
drop trigger if exists guardians_guard on guardians;
create trigger guardians_guard before insert or update on guardians for each row execute function public.guard_guardian();

alter table guardians enable row level security;
drop policy if exists guardians_read on guardians;
create policy guardians_read on guardians for select to authenticated
  using ((org_id = public.my_org_id() and public.is_staff() and (public.has_perm('students', 'view')
              or exists (select 1 from students s where s.id = student_id and s.class_id is not null and public.teaches_class(s.class_id))))
         or profile_id = auth.uid());
drop policy if exists guardians_write on guardians;
create policy guardians_insert on guardians for insert to authenticated with check (org_id = public.my_org_id() and public.has_perm('students', 'create'));
drop policy if exists guardians_update on guardians;
create policy guardians_update on guardians for update to authenticated
  using (org_id = public.my_org_id() and public.has_perm('students', 'edit')) with check (org_id = public.my_org_id() and public.has_perm('students', 'edit'));
drop policy if exists guardians_delete on guardians;
create policy guardians_delete on guardians for delete to authenticated using (org_id = public.my_org_id() and public.has_perm('students', 'delete'));
grant select, insert, update, delete on guardians to authenticated;

-- Xoá dữ liệu cá nhân HS (039) → xoá luôn thông tin phụ huynh
create or replace function public.erase_guardians() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'erased' and old.status is distinct from 'erased' then
    delete from invitations where guardian_id in (select id from guardians where student_id = new.id);
    delete from guardians where student_id = new.id;
  end if;
  return null;
end $$;

-- ===== 3. Tài khoản phụ huynh =====
alter table invitations add column if not exists guardian_id uuid references guardians(id) on delete set null;
drop trigger if exists students_erase_guardians on students;
create trigger students_erase_guardians after update of status on students for each row execute function public.erase_guardians();

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
    update invitations set status = 'accepted', accepted_at = now(), accepted_user = p_user, note = null where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.apply_invitations(uuid) from public, anon, authenticated;

-- account_prepare (037, 039 đồng ý bắt buộc) + phụ huynh: p_ids là id dòng guardians; tên đăng nhập <mã trường>.ph<SĐT>
create or replace function public.account_prepare(p_kind text, p_ids uuid[])
returns table (person_id uuid, full_name text, class_name text, login text, email text, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.my_org_id(); v_code text; v_dom text := public.login_domain(); v_role uuid;
  v_next int; r record; v_login text; v_email text; v_pid uuid; v_seen text[] := '{}';
  v_need_consent boolean := coalesce((select require_student_consent from security_settings where id = 1), false);
begin
  if p_kind not in ('student', 'teacher', 'parent') then raise exception 'Loại tài khoản không hợp lệ' using errcode = '22023'; end if;
  if not (public.is_admin() or public.has_perm('accounts', 'create')) then
    raise exception 'Không có quyền tạo tài khoản' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Tối đa 500 người mỗi lần' using errcode = '22023'; end if;
  v_code := public.login_school_code(v_org);
  if v_code is null then
    raise exception 'Trường chưa có mã đơn vị — liên hệ KDI đặt mã trước khi tạo tài khoản' using errcode = '22023';
  end if;
  select id into v_role from roles where key = p_kind and is_system and org_id is null order by id limit 1;
  select coalesce(max(n), 0) + 1 into v_next from (
    select substring(p.login from '^' || v_code || '\.gv(\d+)$')::int as n from profiles p where p.login like v_code || '.gv%'
    union all
    select substring(i.email from '^' || v_code || '\.gv(\d+)@')::int from invitations i
     where i.org_id = v_org and i.status = 'pending' and i.email like v_code || '.gv%') x;

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
      v_login := v_code || '.gv' || v_next; v_next := v_next + 1;
    end if;
    v_email := v_login || '@' || v_dom;
    login := v_login;
    if exists (select 1 from profiles p where p.login = v_login) then status := 'login_taken'; return next; continue; end if;
    update invitations i set status = 'cancelled', note = 'Thay bằng lời mời tài khoản mã'
     where i.org_id = v_org and lower(i.email) = v_email and i.status = 'pending';
    insert into invitations (org_id, email, full_name, role_id, teacher_id, student_id, guardian_id, invited_by)
      values (v_org, v_email, r.full_name, v_role,
              case when p_kind = 'teacher' then r.id end, case when p_kind = 'student' then r.id end,
              case when p_kind = 'parent' then r.id end, auth.uid());
    email := v_email; status := 'new'; return next;
  end loop;
  for r in select u.id from unnest(p_ids) u(id)
            where not exists (select 1 from students s where s.id = u.id and s.org_id = v_org and p_kind = 'student')
              and not exists (select 1 from teachers t where t.id = u.id and t.org_id = v_org and p_kind = 'teacher')
              and not exists (select 1 from guardians g where g.id = u.id and g.org_id = v_org and p_kind = 'parent') loop
    person_id := r.id; full_name := null; class_name := null; login := null; email := null; status := 'not_found'; return next;
  end loop;
end $$;
revoke all on function public.account_prepare(text, uuid[]) from public, anon;
grant execute on function public.account_prepare(text, uuid[]) to authenticated;

create or replace function public.account_reset_target(p_kind text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_pid uuid; v_name text; v_login text;
begin
  if not (public.is_admin() or public.has_perm('accounts', 'edit')) then
    raise exception 'Không có quyền đặt lại mật khẩu' using errcode = '42501';
  end if;
  if p_kind = 'student' then select s.profile_id, s.full_name into v_pid, v_name from students s where s.id = p_id and s.org_id = v_org;
  elsif p_kind = 'teacher' then select t.profile_id, t.full_name into v_pid, v_name from teachers t where t.id = p_id and t.org_id = v_org;
  elsif p_kind = 'parent' then select g.profile_id, g.full_name into v_pid, v_name from guardians g where g.id = p_id and g.org_id = v_org;
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

-- ===== 4. Quyền xem của phụ huynh =====
create or replace function public.is_guardian_of(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from guardians g where g.student_id = p_student and g.profile_id = auth.uid())
$$;
create or replace function public.is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from guardians g where g.profile_id = auth.uid() and g.org_id = public.my_org_id())
$$;
grant execute on function public.is_guardian_of(uuid), public.is_parent() to authenticated;

-- Năng lực (042) và các hàm dùng can_view_student mở cho phụ huynh của chính học sinh đó
create or replace function public.can_view_student(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students s where s.id = p_student and (
    s.id = public.my_student_id()
    or (s.class_id is not null and public.teaches_class(s.class_id))
    or (s.org_id = public.my_org_id() and public.is_staff() and public.has_perm('students', 'view'))
    or (public.is_authority() and s.org_id in (select public.my_org_tree()))
    or public.is_platform_admin()
    or public.is_guardian_of(s.id)))
$$;

create or replace function public.parent_children()
returns table (student_id uuid, full_name text, student_code text, class_id uuid, class_name text, school text, relation text, receive_alerts boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.full_name, s.student_code, s.class_id, c.name, o.name, g.relation, g.receive_alerts
    from guardians g join students s on s.id = g.student_id join organizations o on o.id = s.org_id
    left join classes c on c.id = s.class_id
   where g.profile_id = auth.uid() and coalesce(s.status, 'studying') <> 'erased'
   order by s.full_name
$$;
grant execute on function public.parent_children() to authenticated;

-- Tổng hợp cho một con: lịch 7 ngày tới, chuyên cần 30 ngày, bài tập 60 ngày, GVCN, đồng ý dữ liệu
create or replace function public.parent_child(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s students; v jsonb;
begin
  if not public.is_guardian_of(p_student) then raise exception 'Không phải phụ huynh của học sinh này' using errcode = '42501'; end if;
  select * into s from students where id = p_student;
  select jsonb_build_object(
    'student', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'code', s.student_code,
                                  'class', (select name from classes where id = s.class_id), 'school', (select name from organizations where id = s.org_id)),
    'homeroom', (select jsonb_build_object('name', t.full_name, 'email', t.email) from classes c join teachers t on t.id = c.homeroom_teacher_id where c.id = s.class_id),
    'schedule', (select coalesce(jsonb_agg(jsonb_build_object('date', ts.session_date, 'period', pc.name, 'start', pc.starts_at, 'subject', ts.subject, 'kind', ts.kind,
                   'room', r.name, 'teacher', t.full_name, 'status', ts.status) order by ts.session_date, pc.starts_at), '[]'::jsonb)
                   from teaching_sessions ts join period_configs pc on pc.id = ts.period_id left join stem_rooms r on r.id = ts.room_id
                   left join teachers t on t.id = ts.teacher_id
                  where ts.class_id = s.class_id and ts.session_date between current_date and current_date + 6),
    'attendance', (select jsonb_build_object(
                     'present', count(*) filter (where la.status = 'present'), 'absent', count(*) filter (where la.status = 'absent'),
                     'late', count(*) filter (where la.status = 'late'), 'excused', count(*) filter (where la.status = 'excused'),
                     'recent', coalesce(jsonb_agg(jsonb_build_object('date', ts.session_date, 'subject', ts.subject, 'status', la.status, 'note', la.note)
                                        order by ts.session_date desc) filter (where la.status <> 'present'), '[]'::jsonb))
                     from lesson_attendance la join teaching_sessions ts on ts.id = la.session_id
                    where la.student_id = s.id and ts.session_date >= current_date - 30),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'subject', a.subject, 'kind', a.kind, 'due_at', a.due_at, 'max_score', a.max_score,
                      'status', coalesce(sb.status, case when a.due_at < now() then 'missing' else 'todo' end), 'score', sb.score, 'feedback', sb.feedback,
                      'submitted_at', sb.submitted_at) order by coalesce(a.due_at, a.opens_at) desc), '[]'::jsonb)
                      from assignments a
                      left join lateral (select x.* from submissions x where x.assignment_id = a.id and (x.student_id = s.id
                                 or x.group_id in (select gm.group_id from student_group_members gm where gm.student_id = s.id)) limit 1) sb on true
                     where a.class_id = s.class_id and a.status <> 'draft' and a.opens_at >= now() - interval '60 days'),
    'consent', (select jsonb_build_object('guardian', c.guardian_name, 'method', c.method, 'on', c.consented_on, 'scope', c.scope)
                  from student_consents c where c.student_id = s.id and c.withdrawn_on is null limit 1)
  ) into v;
  return v;
end $$;
revoke all on function public.parent_child(uuid) from public, anon;
grant execute on function public.parent_child(uuid) to authenticated;

-- Phụ huynh tự xác nhận (hoặc rút) đồng ý xử lý dữ liệu cá nhân của con
create or replace function public.parent_consent(p_student uuid, p_agree boolean, p_scope text[] default '{learning}') returns void
language plpgsql security definer set search_path = public as $$
declare g guardians;
begin
  select * into g from guardians where student_id = p_student and profile_id = auth.uid() limit 1;
  if g.id is null then raise exception 'Không phải phụ huynh của học sinh này' using errcode = '42501'; end if;
  if p_agree then
    if exists (select 1 from unnest(coalesce(p_scope, '{}')) x where x not in ('learning', 'photo')) then raise exception 'Phạm vi không hợp lệ' using errcode = '22023'; end if;
    update student_consents set withdrawn_on = current_date, updated_at = now() where student_id = p_student and withdrawn_on is null;
    insert into student_consents (org_id, student_id, guardian_name, relation, phone, method, scope, note, recorded_by)
      values (g.org_id, p_student, g.full_name, case g.relation when 'father' then 'Cha' when 'mother' then 'Mẹ' else 'Người giám hộ' end,
              g.phone, 'online', case when 'learning' = any(p_scope) then p_scope else array['learning'] || p_scope end, 'Phụ huynh xác nhận trên hệ thống', auth.uid());
  else
    update student_consents set withdrawn_on = current_date, updated_at = now(), note = coalesce(note || ' · ', '') || 'Phụ huynh rút đồng ý trên hệ thống'
     where student_id = p_student and withdrawn_on is null;
  end if;
end $$;
revoke all on function public.parent_consent(uuid, boolean, text[]) from public, anon;
grant execute on function public.parent_consent(uuid, boolean, text[]) to authenticated;

-- Phụ huynh bật / tắt nhận cảnh báo vắng
create or replace function public.parent_set_alerts(p_on boolean) returns void
language sql security definer set search_path = public as $$
  update guardians set receive_alerts = p_on where profile_id = auth.uid()
$$;
grant execute on function public.parent_set_alerts(boolean) to authenticated;

-- ===== 5. Báo vắng cho phụ huynh =====
create or replace function public.notify_guardians_absence() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record; v_day date; v_subj text; v_name text;
begin
  if new.status not in ('absent', 'late') or (tg_op = 'UPDATE' and old.status = new.status) then return null; end if;
  select ts.session_date, ts.subject into v_day, v_subj from teaching_sessions ts where ts.id = new.session_id;
  if v_day < current_date - 1 then return null; end if;                 -- sửa điểm danh cũ: không báo lại
  select full_name into v_name from students where id = new.student_id;
  for g in select distinct profile_id from guardians where student_id = new.student_id and profile_id is not null and receive_alerts loop
    perform public.notify_user(g.profile_id, new.org_id, 'status',
      v_name || case new.status when 'absent' then ' vắng mặt' else ' đi muộn' end || ' ngày ' || to_char(v_day, 'DD/MM'),
      coalesce(v_subj, '') || coalesce(' — ' || nullif(new.note, ''), ''), 'Chuyên cần của con', 'parent', new.student_id, true);
  end loop;
  return null;
end $$;
drop trigger if exists lesson_attendance_notify_parent on lesson_attendance;
create trigger lesson_attendance_notify_parent after insert or update of status on lesson_attendance
  for each row execute function public.notify_guardians_absence();

-- ===== 6. Khảo sát cho phụ huynh =====
alter table surveys drop constraint if exists surveys_audience_check;
alter table surveys add constraint surveys_audience_check check (audience in ('teacher', 'student', 'staff', 'parent'));
create or replace function public.survey_for_me(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from surveys s where s.id = p_survey and s.status = 'open'
    and (s.opens_at is null or s.opens_at <= now()) and (s.closes_at is null or s.closes_at > now())
    and public.my_org_id() is not null and public.org_in_tree(public.my_org_id(), s.org_id)
    and case s.audience when 'student' then public.is_student()
                        when 'teacher' then public.my_teacher_id() is not null
                        when 'parent' then public.is_parent()
                        else public.is_staff() end)
$$;

notify pgrst, 'reload schema';
