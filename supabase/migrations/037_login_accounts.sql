-- 037: Tài khoản đăng nhập bằng mã (không cần email) cho học sinh và giáo viên — tạo hàng loạt, in phiếu, đặt lại mật khẩu.
--   • Tên đăng nhập: <mã trường>.<mã HS>  (vd thcsph.hs0012)   ·   giáo viên: <mã trường>.gv<số>  (vd thcsph.gv7)
--     Chỉ gồm a–z, 0–9 và dấu chấm; mã trường lấy từ organizations.code (bỏ ký tự khác chữ/số).
--   • Supabase Auth cần email: tài khoản dùng email nội bộ <tên đăng nhập>@<login_domain> — không có hộp thư thật, không gửi thư.
--     login_domain đặt ở security_settings (Quản trị nền tảng); đổi trước khi tạo tài khoản đầu tiên.
--   • Tạo tài khoản và đặt mật khẩu cần quyền quản trị Auth → chạy trong hàm máy chủ supabase/functions/school-accounts.
--     Hàm máy chủ gọi account_prepare / account_reset_target bằng JWT của người bấm: quyền và phạm vi kiểm tra ở đây.
--   • Tạo tài khoản dùng lại cơ chế lời mời (014/019): account_prepare ghi lời mời (vai trò + hồ sơ HS/GV); khi hàm máy chủ
--     tạo tài khoản đã xác nhận email, apply_invitations tự gán trường, vai trò và liên kết hồ sơ; nhật ký qua audit_invitations.

alter table security_settings add column if not exists login_domain text not null default 'tk.kdi.edu.vn';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'security_settings_login_domain_check') then
    alter table security_settings add constraint security_settings_login_domain_check
      check (login_domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$');
  end if;
end $$;

alter table profiles add column if not exists login text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_login_format') then
    alter table profiles add constraint profiles_login_format check (login is null or login ~ '^[a-z0-9]+(\.[a-z0-9]+)+$');
  end if;
end $$;
create unique index if not exists profiles_login_key on profiles (login) where login is not null;

-- Tên đăng nhập chỉ do hàm máy chủ (service_role) đặt; người dùng/quản trị không tự sửa qua API.
create or replace function public.guard_profile_login() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.login is distinct from old.login
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon') then
    raise exception 'Không sửa được tên đăng nhập' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_login on profiles;
create trigger profiles_guard_login before update of login on profiles for each row execute function public.guard_profile_login();

-- Trang đăng nhập (chưa đăng nhập) cần biết miền để đổi tên đăng nhập → email nội bộ
create or replace function public.login_domain() returns text
language sql stable security definer set search_path = public as $$
  select login_domain from security_settings where id = 1
$$;
revoke all on function public.login_domain() from public;
grant execute on function public.login_domain() to anon, authenticated;

-- Mã trường dùng trong tên đăng nhập
create or replace function public.login_school_code(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(regexp_replace(lower(coalesce(code, '')), '[^a-z0-9]+', '', 'g'), '') from organizations where id = p_org
$$;
revoke all on function public.login_school_code(uuid) from public, anon;
grant execute on function public.login_school_code(uuid) to authenticated;

-- Chuẩn bị tạo tài khoản cho danh sách HS/GV của trường đang làm việc.
--   status: new (đã ghi lời mời, hàm máy chủ sẽ tạo tài khoản) | has_account | missing_code | login_taken | not_found
create or replace function public.account_prepare(p_kind text, p_ids uuid[])
returns table (person_id uuid, full_name text, class_name text, login text, email text, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.my_org_id(); v_code text; v_dom text := public.login_domain(); v_role uuid;
  v_next int; r record; v_login text; v_email text;
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

-- Đặt lại mật khẩu: chỉ tài khoản mã (có login) của HS/GV thuộc trường đang làm việc. Trả về id tài khoản; ghi nhật ký.
create or replace function public.account_reset_target(p_kind text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_pid uuid; v_name text; v_login text;
begin
  if not (public.is_admin() or public.has_perm('accounts', 'edit')) then
    raise exception 'Không có quyền đặt lại mật khẩu' using errcode = '42501';
  end if;
  if p_kind = 'student' then select s.profile_id, s.full_name into v_pid, v_name from students s where s.id = p_id and s.org_id = v_org;
  elsif p_kind = 'teacher' then select t.profile_id, t.full_name into v_pid, v_name from teachers t where t.id = p_id and t.org_id = v_org;
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

-- Hàm máy chủ (service_role): tài khoản Auth đã có với email này chưa, đã xác nhận chưa (email nội bộ bị ai đó đăng ký trước)
create or replace function public.account_auth_user(p_email text) returns table (id uuid, confirmed boolean, linked boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.email_confirmed_at is not null,
         exists (select 1 from memberships m where m.user_id = u.id)
    from auth.users u where lower(u.email) = lower(p_email)
$$;
revoke all on function public.account_auth_user(text) from public, anon, authenticated;
grant execute on function public.account_auth_user(text) to service_role;
