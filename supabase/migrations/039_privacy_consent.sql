-- 039: Dữ liệu cá nhân tối thiểu cho pilot (Luật 91/2025/QH15, Nghị định 356/2025/NĐ-CP).
--   1. Điều khoản sử dụng & Chính sách quyền riêng tư có phiên bản (legal_documents). Quản trị nền tảng soạn và công bố;
--      người dùng phải chấp thuận bản mới nhất khi đăng nhập (legal_acceptances). Chưa công bố bản nào → không chặn ai.
--   2. Đồng ý của cha mẹ/người giám hộ cho từng học sinh (student_consents): người đồng ý, hình thức, ngày, phạm vi, rút lại.
--      Tuỳ chọn security_settings.require_student_consent: chưa có đồng ý thì không tạo được tài khoản HS (account_prepare → no_consent).
--      consent_summary(): số HS đã có đồng ý theo trường — cho trường, Sở/Phòng (trường trực thuộc), KDI.
--   3. Quyền của chủ thể dữ liệu: student_data_export (xuất toàn bộ dữ liệu của một HS), student_erase (xoá dữ liệu cá nhân,
--      giữ số liệu thống kê không định danh). Cả hai ghi nhật ký. Tài khoản đăng nhập của HS bị khoá; email/tên trong Auth
--      được hàm máy chủ school-accounts xoá (action 'erase').

-- ===== 1. Điều khoản & chính sách =====
create table if not exists legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'privacy')),
  version int not null,
  title text not null,
  body text not null,
  published_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (kind, version)
);
alter table legal_documents enable row level security;
drop policy if exists legal_documents_read on legal_documents;
create policy legal_documents_read on legal_documents for select to anon, authenticated
  using (published_at is not null or (select public.is_platform_admin()));
drop policy if exists legal_documents_platform on legal_documents;
create policy legal_documents_platform on legal_documents for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
-- Bản đã công bố không sửa nội dung (muốn đổi → tạo phiên bản mới)
create or replace function public.guard_legal_published() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.published_at is not null then raise exception 'Không xoá được bản đã công bố' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and old.published_at is not null
     and (new.body is distinct from old.body or new.title is distinct from old.title or new.version is distinct from old.version
          or new.kind is distinct from old.kind or new.published_at is distinct from old.published_at) then
    raise exception 'Bản đã công bố không sửa được — hãy tạo phiên bản mới' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists legal_documents_guard on legal_documents;
create trigger legal_documents_guard before update or delete on legal_documents for each row execute function public.guard_legal_published();

create table if not exists legal_acceptances (
  user_id uuid not null references profiles(id) on delete cascade,
  document_id uuid not null references legal_documents(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
alter table legal_acceptances enable row level security;
drop policy if exists legal_acceptances_own on legal_acceptances;
create policy legal_acceptances_own on legal_acceptances for select to authenticated
  using (user_id = auth.uid() or (select public.is_platform_admin()));

-- Bản mới nhất đã công bố của từng loại mà người dùng chưa chấp thuận
create or replace function public.legal_pending() returns table (id uuid, kind text, version int, title text, body text, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.kind, d.version, d.title, d.body, d.published_at
    from (select distinct on (kind) * from legal_documents where published_at is not null order by kind, version desc) d
   where auth.uid() is not null
     and not exists (select 1 from legal_acceptances a where a.user_id = auth.uid() and a.document_id = d.id)
   order by d.kind desc
$$;
create or replace function public.legal_accept(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập' using errcode = '42501'; end if;
  insert into legal_acceptances (user_id, document_id)
    select auth.uid(), d.id from legal_documents d where d.id = any(p_ids) and d.published_at is not null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.legal_pending(), public.legal_accept(uuid[]) from public, anon;
grant execute on function public.legal_pending(), public.legal_accept(uuid[]) to authenticated;

-- ===== 2. Đồng ý của cha mẹ / người giám hộ =====
alter table security_settings add column if not exists require_student_consent boolean not null default false;

create table if not exists student_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  guardian_name text not null,
  relation text,                         -- Cha / Mẹ / Người giám hộ …
  phone text,
  method text not null default 'paper' check (method in ('paper', 'online', 'other')),
  consented_on date not null default current_date,
  scope text[] not null default '{learning}',  -- learning: học tập trên hệ thống; photo: ảnh/sản phẩm có hình HS
  note text,
  withdrawn_on date,
  recorded_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_consents_student on student_consents (student_id);
create unique index if not exists student_consents_active on student_consents (student_id) where withdrawn_on is null;
alter table student_consents enable row level security;
-- Trường: quản lý theo quyền Học sinh; Sở/KDI xem tổng hợp qua consent_summary (không xem SĐT phụ huynh)
drop policy if exists student_consents_read on student_consents;
create policy student_consents_read on student_consents for select to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('students', 'view')));
drop policy if exists student_consents_insert on student_consents;
create policy student_consents_insert on student_consents for insert to authenticated
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('students', 'edit'))
              and exists (select 1 from students s where s.id = student_id and s.org_id = student_consents.org_id));
drop policy if exists student_consents_update on student_consents;
create policy student_consents_update on student_consents for update to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('students', 'edit')))
  with check (org_id = (select public.my_org_id()) and (select public.has_perm('students', 'edit'))
              and exists (select 1 from students s where s.id = student_id and s.org_id = student_consents.org_id));
drop policy if exists student_consents_delete on student_consents;
create policy student_consents_delete on student_consents for delete to authenticated
  using (org_id = (select public.my_org_id()) and (select public.has_perm('students', 'delete')));
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists student_consents_touch on student_consents;
create trigger student_consents_touch before update on student_consents for each row execute function public.touch_updated_at();

-- Tổng hợp theo trường: HS đang học, đã có đồng ý còn hiệu lực
create or replace function public.consent_summary() returns table (school_id uuid, school_name text, students int, consented int)
language sql stable security definer set search_path = public as $$
  select o.id, o.name,
         (select count(*) from students s where s.org_id = o.id and coalesce(s.status, 'studying') = 'studying')::int,
         (select count(*) from students s where s.org_id = o.id and coalesce(s.status, 'studying') = 'studying'
            and exists (select 1 from student_consents c where c.student_id = s.id and c.withdrawn_on is null))::int
    from organizations o
   where o.type = 'school'
     and (public.is_platform_admin()
          or (public.is_authority() and o.id in (select public.my_org_tree()))
          or (o.id = public.my_org_id() and public.has_perm('students', 'view')))
   order by o.name
$$;
revoke all on function public.consent_summary() from public, anon;
grant execute on function public.consent_summary() to authenticated;

-- account_prepare (037) + chặn tạo tài khoản HS chưa có đồng ý khi bật require_student_consent
create or replace function public.account_prepare(p_kind text, p_ids uuid[])
returns table (person_id uuid, full_name text, class_name text, login text, email text, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.my_org_id(); v_code text; v_dom text := public.login_domain(); v_role uuid;
  v_next int; r record; v_login text; v_email text;
  v_need_consent boolean := coalesce((select require_student_consent from security_settings where id = 1), false);
begin
  if p_kind not in ('student', 'teacher') then raise exception 'Loại tài khoản không hợp lệ' using errcode = '22023'; end if;
  if not (public.is_admin() or public.has_perm('accounts', 'create')) then
    raise exception 'Không có quyền tạo tài khoản' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Tối đa 500 người mỗi lần' using errcode = '22023'; end if;
  v_code := public.login_school_code(v_org);
  if v_code is null then
    raise exception 'Trường chưa có mã đơn vị — liên hệ KDI đặt mã trước khi tạo tài khoản' using errcode = '22023';
  end if;
  select id into v_role from roles where key = p_kind and is_system order by id limit 1;
  -- Số thứ tự giáo viên tiếp theo: lớn nhất trong tên đã cấp và lời mời đang chờ
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
    elsif r.inv_email is not null then
      v_login := split_part(r.inv_email, '@', 1);          -- GV đã có lời mời mã từ lần trước: giữ số cũ
    else
      v_login := v_code || '.gv' || v_next; v_next := v_next + 1;
    end if;
    v_email := v_login || '@' || v_dom;
    login := v_login;
    if exists (select 1 from profiles p where p.login = v_login) then status := 'login_taken'; return next; continue; end if;
    update invitations i set status = 'cancelled', note = 'Thay bằng lời mời tài khoản mã'
     where i.org_id = v_org and lower(i.email) = v_email and i.status = 'pending';
    insert into invitations (org_id, email, full_name, role_id, teacher_id, student_id, invited_by)
      values (v_org, v_email, r.full_name, v_role,
              case when p_kind = 'teacher' then r.id end, case when p_kind = 'student' then r.id end, auth.uid());
    email := v_email; status := 'new'; return next;
  end loop;
  -- Id không thuộc trường đang làm việc (hoặc không tồn tại)
  for r in select u.id from unnest(p_ids) u(id)
            where not exists (select 1 from students s where s.id = u.id and s.org_id = v_org and p_kind = 'student')
              and not exists (select 1 from teachers t where t.id = u.id and t.org_id = v_org and p_kind = 'teacher') loop
    person_id := r.id; full_name := null; class_name := null; login := null; email := null; status := 'not_found'; return next;
  end loop;
end $$;
revoke all on function public.account_prepare(text, uuid[]) from public, anon;
grant execute on function public.account_prepare(text, uuid[]) to authenticated;

-- ===== 3. Xuất / xoá dữ liệu của một học sinh =====
-- Hàm hệ thống được phép đổi tên đăng nhập và khoá tài khoản (xoá dữ liệu HS): đặt cờ app.login_admin trong giao dịch
create or replace function public.guard_profile_login() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.login is distinct from old.login
     and coalesce(current_setting('app.login_admin', true), '') <> 'on'
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon') then
    raise exception 'Không sửa được tên đăng nhập' using errcode = '42501';
  end if;
  return new;
end $$;

-- 024: khoá tài khoản chỉ quản trị nền tảng — nay thêm ngoại lệ cho hàm hệ thống (xoá dữ liệu HS) qua cờ app.login_admin
create or replace function public.guard_profile_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.locked_at, new.locked_reason, new.locked_by) is distinct from (old.locked_at, old.locked_reason, old.locked_by)
     and coalesce(current_setting('app.login_admin', true), '') <> 'on'
     and current_setting('role', true) = 'authenticated' and not public.is_platform_admin() then
    raise exception 'Không được đổi trạng thái khoá' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.student_data_export(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); s students; v jsonb;
begin
  if not (public.is_admin() or public.has_perm('students', 'edit')) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  select * into s from students where id = p_student and org_id = v_org;
  if s.id is null then raise exception 'Không có học sinh này ở trường' using errcode = 'P0002'; end if;
  v := jsonb_build_object(
    'xuat_luc', now(),
    'truong', (select name from organizations where id = v_org),
    'hoc_sinh', to_jsonb(s) - 'org_id',
    'lop', (select name from classes where id = s.class_id),
    'tai_khoan', (select jsonb_build_object('ten', p.full_name, 'email', p.email, 'ten_dang_nhap', p.login) from profiles p where p.id = s.profile_id),
    'dong_y_cha_me', (select coalesce(jsonb_agg(to_jsonb(c) - 'org_id' order by c.created_at), '[]') from student_consents c where c.student_id = s.id),
    'diem_danh', (select coalesce(jsonb_agg(jsonb_build_object('ngay', t.session_date, 'mon', t.subject, 'trang_thai', a.status, 'ghi_chu', a.note) order by t.session_date), '[]')
                    from lesson_attendance a join teaching_sessions t on t.id = a.session_id where a.student_id = s.id),
    'bai_nop', (select coalesce(jsonb_agg(jsonb_build_object('bai', g.title, 'nop_luc', x.submitted_at, 'noi_dung', x.content, 'tep', x.attachment_url, 'diem', x.score) order by x.submitted_at), '[]')
                  from submissions x join assignments g on g.id = x.assignment_id where x.student_id = s.id),
    'tu_hoc', (select coalesce(jsonb_agg(jsonb_build_object('bai', i.title, 'diem', p.score, 'diem_cao_nhat', p.best_score, 'so_lan', p.attempts, 'hoan_thanh', p.completed_at) order by p.started_at), '[]')
                 from self_study_progress p join self_study_items i on i.id = p.item_id where p.student_id = s.id),
    'tien_do_bai_hoc', (select coalesce(jsonb_agg(to_jsonb(l) - 'org_id'), '[]') from lesson_progress l where l.student_id = s.id),
    'tham_gia_tiet_truc_tuyen', (select count(*) from class_session_attendance c where c.student_id = s.id));
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), v_org, 'students', s.id::text, 'update', 'Xuất dữ liệu cá nhân học sinh ' || coalesce(s.student_code, s.id::text), null);
  return v;
end $$;

-- Xoá dữ liệu cá nhân: giữ dòng học sinh (ẩn danh) để số liệu điểm danh/thống kê của trường không lệch.
-- Trả về id tài khoản đăng nhập cần xoá thông tin trong Auth (null nếu không có, hoặc tài khoản còn thuộc đơn vị khác).
create or replace function public.student_erase(p_student uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); s students; v_pid uuid; v_other boolean;
begin
  if not public.is_admin() then raise exception 'Chỉ quản trị trường (Hiệu trưởng, QTV) được xoá dữ liệu học sinh' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Cần ghi lý do xoá' using errcode = '22023'; end if;
  select * into s from students where id = p_student and org_id = v_org;
  if s.id is null then raise exception 'Không có học sinh này ở trường' using errcode = 'P0002'; end if;
  if s.status = 'erased' then raise exception 'Dữ liệu học sinh này đã được xoá' using errcode = '22023'; end if;
  v_pid := s.profile_id;
  update submissions set content = null, attachment_url = null where student_id = s.id;
  update self_study_progress set answers = null where student_id = s.id;
  delete from student_consents where student_id = s.id;
  delete from student_group_members where student_id = s.id;
  delete from invitations where student_id = s.id;
  update students set full_name = 'Học sinh đã xoá dữ liệu', student_code = null, profile_id = null, status = 'erased' where id = s.id;
  if v_pid is not null then
    delete from memberships where user_id = v_pid and org_id = v_org;
    v_other := exists (select 1 from memberships where user_id = v_pid);
    if not v_other then
      perform set_config('app.login_admin', 'on', true);
      update profiles set full_name = 'Tài khoản đã xoá', email = null, phone = null, login = null, org_id = null,
             locked_at = now(), locked_reason = 'Đã xoá dữ liệu cá nhân' where id = v_pid;
      perform set_config('app.login_admin', '', true);
    end if;
  end if;
  insert into audit_log (actor, org_id, entity, entity_id, action, summary, detail)
    values (auth.uid(), v_org, 'students', s.id::text, 'delete', 'Xoá dữ liệu cá nhân học sinh ' || coalesce(s.student_code, s.id::text),
            jsonb_build_object('reason', p_reason, 'account', v_pid is not null));
  return case when v_pid is not null and not v_other then v_pid end;
end $$;
revoke all on function public.student_data_export(uuid), public.student_erase(uuid, text) from public, anon;
grant execute on function public.student_data_export(uuid), public.student_erase(uuid, text) to authenticated;
grant execute on function public.login_domain() to service_role;
