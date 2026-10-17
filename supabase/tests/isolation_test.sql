-- Kiểm thử cách ly dữ liệu giữa các tổ chức (sau migration 019–020).
set client_min_messages = warning;
-- Chạy được trong Supabase SQL Editor hoặc psql. Kết quả: bảng PASS/FAIL ở cuối.
--  • Tạo tạm các tài khoản *@iso-test.local, xoá sạch khi kết thúc (kể cả lần chạy trước bị dừng giữa chừng).
--  • Mỗi phép thử chạy dưới vai trò authenticated với JWT của người dùng thử, trong một giao dịch con
--    luôn bị huỷ — nên kể cả khi một lệnh ghi lọt qua RLS (lỗi bảo mật), dữ liệu thật vẫn không đổi.
-- Quy ước: A = Hưng Yên (Sở SO-HY, trường THCS-PH), B = Bắc Ninh (Sở SO-BN, Phòng PGD-TPBN, trường THCS-KB, THPT-HT).

drop table if exists t_result;
create temp table t_result (id serial, who text, name text, expect text, got text, ok boolean);
grant all on t_result to authenticated;
-- Mốc nhật ký (021) để xoá các dòng nhật ký do phép thử sinh ra
drop table if exists t_meta;
create temp table t_meta as select coalesce((select max(id) from audit_log), 0) as audit_start
  where to_regclass('public.audit_log') is not null;
grant usage on sequence t_result_id_seq to authenticated;

-- Danh sách id của các mã tổ chức, dạng 'id1','id2' (tra bằng quyền postgres, trước khi đổi vai trò)
create or replace function pg_temp.ids(p_codes text[]) returns text language sql as $$
  select coalesce(string_agg(quote_literal(id), ','), 'null') from organizations where code = any(p_codes)
$$;
create or replace function pg_temp.oid_(p_code text) returns uuid language sql as $$
  select id from organizations where case when p_code = '@platform' then is_platform else code = p_code end
$$;

-- Chạy p_sql như người dùng p_email. SELECT → cột đầu của dòng đầu; lệnh ghi → 'rows:N'; lỗi → 'ERR <sqlstate>'.
-- p_keep = false: huỷ mọi thay đổi của lệnh (mặc định).
create or replace function pg_temp.probe(p_email text, p_sql text, p_keep boolean default false) returns text
language plpgsql as $$
declare v_uid uuid; r text; n bigint; v_msg text; v_detail text;
begin
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then return 'ERR no-user ' || p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    if p_sql ~* '^\s*(select|with)' then execute p_sql into r; r := coalesce(r, 'null');
    else execute p_sql; get diagnostics n = row_count; r := 'rows:' || n; end if;
    if not p_keep then raise exception '__probe__' using detail = r; end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    r := case when v_msg = '__probe__' then v_detail else 'ERR ' || sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;

-- p_expect: 'ERR' (bị RLS chặn) | 'ERR*' (lỗi bất kỳ) | '0' | '>0' | 'rows:0' | 'rows:1' | 't' | 'f' | giá trị cụ thể
create or replace function pg_temp.chk(p_who text, p_name text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare r text := pg_temp.probe(p_who || '@iso-test.local', p_sql);
begin
  insert into t_result (who, name, expect, got, ok) values (p_who, p_name, p_expect, r,
    case p_expect when 'ERR' then r = 'ERR 42501'          -- bị chặn bởi quyền (RLS), không phải lỗi khác
                  when 'ERR*' then r like 'ERR%'           -- bị chặn bởi ràng buộc dữ liệu hoặc quyền
                  when '>0' then r ~ '^\d+$' and r::bigint > 0
                  else r = p_expect end);
end $$;

-- Tạo tài khoản thử + vai trò tại tổ chức
create or replace function pg_temp.mk(p_who text, p_org text, p_role text) returns uuid
language plpgsql as $$
declare v_uid uuid; v_email text := p_who || '@iso-test.local';
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), v_email, now()) returning id into v_uid;
    insert into profiles (id, full_name, email) values (v_uid, 'Thử ' || p_who, v_email)
      on conflict (id) do update set full_name = excluded.full_name;
  end if;
  insert into memberships (user_id, org_id, role_id, created_by)
    select v_uid, pg_temp.oid_(p_org), r.id, null from roles r where r.key = p_role and r.org_id is null
  on conflict do nothing;
  return v_uid;
end $$;

create or replace function pg_temp.cleanup() returns void language plpgsql as $$
declare v_orgs uuid[] := array(select id from organizations where code like 'ISO-%');
  v_users uuid[] := array(select id from profiles where email like '%@iso-test.local');
begin
  if to_regclass('public.broadcasts') is not null then
    delete from notifications where kind in ('broadcast', 'package_order') and title like '%thử ISO%';
    delete from broadcasts where title like '%thử ISO%';
    delete from stem_packages where id in (select delivered_package_id from package_orders where name like '%thử ISO%');
    delete from package_orders where name like '%thử ISO%';
    delete from rollout_checks where org_id = any(v_orgs);
  end if;
  if to_regclass('public.contracts') is not null then
    delete from notifications where ref_id in (select id from support_tickets where subject like 'ISO %');
    delete from support_tickets where subject like 'ISO %' or org_id = any(v_orgs);
    delete from contracts where code like 'ISO-%' or org_id = any(v_orgs);
    delete from service_plans where code like 'ISO-%';
    update security_settings set enforce_mfa_db = false where id = 1 and enforce_mfa_db;
    update profiles set locked_at = null, locked_reason = null, locked_by = null where id = any(v_users) and locked_at is not null;
  end if;
  if to_regclass('public.library_items') is not null then
    delete from lesson_plans where id in (select lesson_plan_id from library_copies where adopted_by = any(v_users));
    delete from library_copies where adopted_by = any(v_users);
    delete from library_items where title like 'ISO %' or owner_org_id = any(v_orgs);
  end if;
  if to_regclass('public.self_study_items') is not null then
    delete from notifications where kind = 'self_study' and title like '%ISO tự học%';
    delete from self_study_items where title like 'ISO tự học%';
    delete from activities where title like 'ISO hoạt động%';
    delete from school_holidays where name like 'ISO nghỉ%';
    delete from teaching_assignments where subject = 'ISO tự học';
  end if;
  if to_regclass('public.teaching_sessions') is not null then
    if to_regclass('public.resource_bookings') is not null then
      delete from stem_registrations where topic like 'ISO đăng ký%';
      delete from borrow_requests where title like 'ISO mượn%';
      delete from notifications where ref_id in (select ref_id from approval_requests where title like 'ISO đăng ký%' or title like 'ISO mượn%')
        or ref_id in (select id from approval_requests where title like 'ISO đăng ký%' or title like 'ISO mượn%');
      delete from approval_requests where title like 'ISO đăng ký%' or title like 'ISO mượn%';
      delete from equipment_units where type_id in (select id from equipment_types where name = 'ISO Kính');
      delete from equipment_types where name = 'ISO Kính';
    end if;
    delete from teaching_sessions where subject like 'ISO Toán%';
    delete from timetable_entries where subject like 'ISO Toán%';
    delete from stem_rooms where name like 'ISO phòng%';
    delete from period_configs where name like 'ISO Tiết%';
    delete from academic_years where name = 'ISO năm thử';
  end if;
  delete from training_lessons where title like 'ISO bài tập huấn%';
  delete from training_plans where name = 'ISO kế hoạch tập huấn';   -- buổi, ghi danh, điểm danh xoá theo (cascade)
  delete from students where student_code like 'ISO-%' or full_name like 'ISO HS%' or org_id = any(v_orgs);
  delete from invitations where email like 'thcsph.iso%' or full_name = 'ISO GV tài khoản mã';
  delete from auth.users where email like 'thcsph.iso%@%';
  if to_regclass('public.package_orders') is not null then
    delete from package_orders where org_id = any(v_orgs);
    delete from approval_workflows where org_id = any(v_orgs);
  end if;
  delete from education_plans where org_id = any(v_orgs) or teacher_id in (select id from teachers where email like '%@iso-test.local');
  delete from teachers where email like '%@iso-test.local' or org_id = any(v_orgs);
  delete from invitations where email like '%@iso-test.local' or org_id = any(v_orgs);
  delete from memberships where org_id = any(v_orgs);
  delete from roles where key like 'custom_iso_%';
  delete from organizations where code in ('ISO-TRUONG', 'ISO-SCH', 'ISO-NEW', 'ISO-IMP1', 'ISO-IMP2');
  delete from organizations where code = 'ISO-SO';
  delete from organizations where code = 'ISO-TINH';
  delete from auth.users where email like '%@iso-test.local';
  if to_regclass('public.audit_log') is not null then
    delete from audit_log where id > coalesce((select audit_start from t_meta), 0)
      and (entity = 'role_permissions' or summary ~ '(ISO tự học|ISO nghỉ|thcsph\.iso|ISO HS|ISO GV|Thử [a-z_]+|iso-test\.local|thử ISO|ISO-[A-Z]+|thử \(thử\)|Tổ trưởng \(thử\))' or (actor is null and summary like '%tài khoản đã xoá%'));
  end if;
end $$;

select pg_temp.cleanup();

-- ===== Chuẩn bị =====
do $$
declare v_gv uuid; v_hs uuid;
begin
  if pg_temp.oid_('SO-BN') is null then raise exception 'Chưa có dữ liệu tỉnh B — hãy chạy migration 020 trước'; end if;
  perform pg_temp.mk('bo', 'BO-GDDT', 'ministry');
  perform pg_temp.mk('so_hy', 'SO-HY', 'department');
  perform pg_temp.mk('so_bn', 'SO-BN', 'department');
  perform pg_temp.mk('tinh_bn', 'TINH-BN', 'province');
  perform pg_temp.mk('phong_bn', 'PGD-TPBN', 'district');
  perform pg_temp.mk('admin_ph', 'THCS-PH', 'principal');
  perform pg_temp.mk('admin_kb', 'THCS-KB', 'principal');
  -- Một giáo viên dạy ở cả hai tỉnh: tổ chức đang làm việc = trường A
  v_gv := pg_temp.mk('gv_both', 'THCS-PH', 'teacher');
  perform pg_temp.mk('gv_both', 'THCS-KB', 'teacher');
  update profiles set org_id = pg_temp.oid_('THCS-PH') where id = v_gv;
  insert into teachers (org_id, full_name, email, profile_id) values
    (pg_temp.oid_('THCS-PH'), 'GV thử A', 'gv_both@iso-test.local', v_gv),
    (pg_temp.oid_('THCS-KB'), 'GV thử B', 'gv_both@iso-test.local', v_gv);
  -- Hiệu trưởng ở A nhưng chỉ là giáo viên ở B: quyền quản trị không được mang sang B
  perform pg_temp.mk('mixed', 'THCS-PH', 'principal');
  perform pg_temp.mk('mixed', 'THCS-KB', 'teacher');
  update profiles set org_id = pg_temp.oid_('THCS-KB') where email = 'mixed@iso-test.local';
  -- Học sinh trường B
  v_hs := pg_temp.mk('hs_kb', 'THCS-KB', 'student');
  insert into students (org_id, class_id, student_code, full_name, profile_id)
    select org_id, id, 'ISO-001', 'HS thử B', v_hs from classes where org_id = pg_temp.oid_('THCS-KB') order by name limit 1;
  -- 021: quản trị nền tảng + một trường thử để kiểm tra tạm dừng
  if pg_temp.oid_('@platform') is not null then
    perform pg_temp.mk('kdi', '@platform', 'platform_admin');
    insert into organizations (type, parent_id, code, name, level) values ('school', pg_temp.oid_('SO-HY'), 'ISO-SCH', 'Trường thử ISO', 'thcs');
    perform pg_temp.mk('admin_iso', 'ISO-SCH', 'principal');
  end if;
  -- 022: cây thử riêng cho quy trình phê duyệt (không đụng quy trình thật của các Sở)
  if to_regclass('public.approval_requests') is not null then
    insert into organizations (type, parent_id, code, name) values ('province', pg_temp.oid_('BO-GDDT'), 'ISO-TINH', 'Tỉnh thử ISO');
    insert into organizations (type, parent_id, code, name) values ('department', pg_temp.oid_('ISO-TINH'), 'ISO-SO', 'Sở thử ISO');
    insert into organizations (type, parent_id, code, name, level) values ('school', pg_temp.oid_('ISO-SO'), 'ISO-TRUONG', 'Trường thử ISO 2', 'thcs');
    insert into roles (org_id, key, name, is_system, portal) values (pg_temp.oid_('ISO-TRUONG'), 'custom_iso_tt', 'Tổ trưởng (thử)', false, 'teacher');
    perform pg_temp.mk('iso_admin', 'ISO-TRUONG', 'principal');
    perform pg_temp.mk('iso_gv', 'ISO-TRUONG', 'teacher');
    insert into teachers (org_id, full_name, email, profile_id)
      select pg_temp.oid_('ISO-TRUONG'), 'GV thử ISO', 'iso_gv@iso-test.local', id from profiles where email = 'iso_gv@iso-test.local';
    perform pg_temp.mk('iso_tt', 'ISO-TRUONG', 'teacher');
    insert into memberships (user_id, org_id, role_id, created_by)
      select p.id, pg_temp.oid_('ISO-TRUONG'), r.id, null from profiles p, roles r
       where p.email = 'iso_tt@iso-test.local' and r.key = 'custom_iso_tt' and r.org_id = pg_temp.oid_('ISO-TRUONG');
    perform pg_temp.mk('iso_so', 'ISO-SO', 'department');
  end if;
end $$;

-- ===== 1. Sở A không đọc dữ liệu tỉnh B =====
select pg_temp.chk('so_hy', 'Sở A đọc HS trường A', format('select count(*) from students where org_id in (%s)', pg_temp.ids('{THCS-PH}')), '>0');
select pg_temp.chk('so_hy', 'Sở A không đọc HS tỉnh B', format('select count(*) from students where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Sở A không đọc GV tỉnh B', format('select count(*) from teachers where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Sở A không đọc lớp tỉnh B', format('select count(*) from classes where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Sở A không đọc phòng STEM tỉnh B', format('select count(*) from stem_rooms where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Sở A không đọc bài giảng tỉnh B', format('select count(*) from lesson_plans where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Sở A không thấy tổ chức tỉnh B', format('select count(*) from organizations where id in (%s)', pg_temp.ids('{TINH-BN,SO-BN,PGD-TPBN,THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Sở A không thấy tài khoản tỉnh B', format('select count(*) from profiles p where p.id in (select user_id from memberships) and p.email in (%s)', '''so_bn@iso-test.local'',''admin_kb@iso-test.local'',''hs_kb@iso-test.local'''), '0');
select pg_temp.chk('so_hy', 'Sở A không thấy vai trò ở tỉnh B', format('select count(*) from memberships where org_id in (%s)', pg_temp.ids('{SO-BN,THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Thống kê Sở A không chứa trường B', format('select count(*) from dept_school_stats() where school_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), '0');
select pg_temp.chk('so_hy', 'Thống kê Sở A có trường A', 'select count(*) from dept_school_stats()', '>0');
select pg_temp.chk('so_hy', 'Sở A không đọc tập huấn của Sở B', format('select count(*) from training_plans where org_id in (%s)', pg_temp.ids('{SO-BN}')), '0');

-- ===== 2. Sở A không ghi dữ liệu tỉnh B =====
select pg_temp.chk('so_hy', 'Sở A không sửa HS tỉnh B', format('update students set full_name = ''x'' where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), 'rows:0');
select pg_temp.chk('so_hy', 'Sở A không kích hoạt trường B', format('update organizations set activated_at = now() where id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), 'rows:0');
select pg_temp.chk('so_hy', 'Sở A không xoá lớp tỉnh B', format('delete from classes where org_id in (%s)', pg_temp.ids('{THCS-KB,THPT-HT}')), 'rows:0');
select pg_temp.chk('so_hy', 'Sở A không thêm GV vào trường B', format('insert into teachers (org_id, full_name) values (%s, ''x'')', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('so_hy', 'Sở A không tạo tập huấn dưới tên Sở B', format('insert into training_plans (org_id, name) values (%s, ''x'')', quote_literal(pg_temp.oid_('SO-BN'))), 'ERR');
select pg_temp.chk('so_hy', 'Sở A không chuyển trường B về Sở A', format('update organizations set parent_id = %s where id = %s', quote_literal(pg_temp.oid_('SO-HY')), quote_literal(pg_temp.oid_('THPT-HT'))), 'rows:0');
select pg_temp.chk('so_hy', 'Sở A không kéo trường A ra khỏi phạm vi', format('update organizations set parent_id = %s where id = %s', quote_literal(pg_temp.oid_('SO-BN')), quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');

-- ===== 3. Chiều ngược lại + các cấp trên/dưới =====
select pg_temp.chk('so_bn', 'Sở B không đọc HS tỉnh A', format('select count(*) from students where org_id in (%s)', pg_temp.ids('{THCS-PH,THPT-CHY}')), '0');
select pg_temp.chk('so_bn', 'Sở B thấy trường qua Phòng (2 cấp)', format('select count(*) from students where org_id in (%s)', pg_temp.ids('{THCS-KB}')), '>0');
select pg_temp.chk('so_bn', 'Thống kê Sở B = 2 trường B', 'select count(*) from dept_school_stats()', '2');
select pg_temp.chk('so_bn', 'Sở B kích hoạt trường của mình', format('update organizations set activated_at = now() where id = %s', quote_literal(pg_temp.oid_('THPT-HT'))), 'rows:1');
select pg_temp.chk('so_bn', 'Sở B không sửa dữ liệu chuyên môn của trường', format('update students set full_name = ''x'' where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');
select pg_temp.chk('tinh_bn', 'Tỉnh B thấy Sở, Phòng, trường B', format('select count(*) from organizations where id in (%s)', pg_temp.ids('{SO-BN,PGD-TPBN,THCS-KB,THPT-HT}')), '4');
select pg_temp.chk('tinh_bn', 'Tỉnh B không thấy Sở A', format('select count(*) from organizations where id in (%s)', pg_temp.ids('{SO-HY,THCS-PH}')), '0');
select pg_temp.chk('phong_bn', 'Phòng chỉ thấy trường trực thuộc', 'select count(*) from dept_school_stats()', '1');
select pg_temp.chk('phong_bn', 'Phòng không thấy trường cùng Sở nhưng khác Phòng', format('select count(*) from students where org_id = %s', quote_literal(pg_temp.oid_('THPT-HT'))), '0');
select pg_temp.chk('bo', 'Bộ thấy trường của cả hai tỉnh', format('select count(*) from organizations where id in (%s)', pg_temp.ids('{THCS-PH,THCS-KB,THPT-HT}')), '3');
select pg_temp.chk('bo', 'Bộ không sửa dữ liệu chuyên môn của trường', format('update teachers set full_name = ''x'' where org_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), 'rows:0');
select pg_temp.chk('admin_kb', 'Trường B thấy tên Sở, Tỉnh, Bộ', format('select count(*) from organizations where id in (%s)', pg_temp.ids('{PGD-TPBN,SO-BN,TINH-BN,BO-GDDT}')), '4');
select pg_temp.chk('admin_kb', 'Trường B không thấy Sở A', format('select count(*) from organizations where id = %s', quote_literal(pg_temp.oid_('SO-HY'))), '0');

-- ===== 4. Quản trị trường A không với tới trường B =====
select pg_temp.chk('admin_ph', 'QT trường A không đọc HS trường B', format('select count(*) from students where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '0');
select pg_temp.chk('admin_ph', 'QT trường A không thêm GV vào trường B', format('insert into teachers (org_id, full_name) values (%s, ''x'')', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('admin_ph', 'QT trường A không gán vai trò ở trường B',
  format('insert into memberships (user_id, org_id, role_id) select id, %s, (select id from roles where key=''teacher'' and org_id is null) from profiles where id = auth.uid()', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('admin_ph', 'QT trường A không gỡ vai trò ở trường B', format('delete from memberships where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');
select pg_temp.chk('admin_ph', 'QT trường A không mời người vào trường B',
  format('insert into invitations (org_id, email, role_id, invited_by) values (%s, ''x@iso-test.local'', (select id from roles where key=''teacher'' and org_id is null), auth.uid())', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('admin_ph', 'QT trường A không gán vai trò Sở trong trường',
  format('insert into memberships (user_id, org_id, role_id) select user_id, org_id, (select id from roles where key=''department'' and org_id is null) from memberships where org_id = %s limit 1', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR*');
select pg_temp.chk('admin_ph', 'Không tự chuyển sang trường không thuộc', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('admin_ph', 'Không sửa thẳng tổ chức đang làm việc', format('update profiles set org_id = %s where id = auth.uid()', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('admin_kb', 'QT trường B không đọc GV trường A', format('select count(*) from teachers where org_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), '0');
select pg_temp.chk('hs_kb', 'HS trường B không đọc HS trường A', format('select count(*) from students where org_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), '0');
select pg_temp.chk('hs_kb', 'HS trường B thấy hồ sơ của mình', 'select count(*) from students where profile_id = auth.uid()', '1');

-- ===== 5. Một người, nhiều tổ chức =====
select pg_temp.chk('mixed', 'Đang ở trường B (vai trò GV): không phải quản trị', 'select public.is_admin()::text', 'false');
select pg_temp.chk('mixed', 'Quyền quản trị trường A không mang sang B', format('insert into teachers (org_id, full_name) values (%s, ''x'')', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('mixed', 'Đang ở B: không đọc GV trường A', format('select count(*) from teachers where org_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), '0');
select pg_temp.chk('gv_both', 'Danh sách tổ chức của tôi = 2', 'select count(*) from my_orgs()', '2');
select pg_temp.chk('gv_both', 'Đang ở A: hồ sơ GV là của trường A', 'select (select org_id from teachers where id = my_teacher_id()) = my_org_id()', 'true');
select pg_temp.chk('gv_both', 'Đang ở A: không đọc lớp trường B', format('select count(*) from classes where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '0');
select pg_temp.probe('gv_both@iso-test.local', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('THCS-KB'))), true);
select pg_temp.chk('gv_both', 'Sau khi chuyển sang B: đọc được lớp trường B', format('select count(*) from classes where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '>0');
select pg_temp.chk('gv_both', 'Sau khi chuyển sang B: không còn đọc lớp trường A', format('select count(*) from classes where org_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), '0');
select pg_temp.chk('gv_both', 'Sau khi chuyển sang B: hồ sơ GV là của trường B', 'select (select org_id from teachers where id = my_teacher_id()) = my_org_id()', 'true');
select pg_temp.chk('gv_both', 'Không chuyển sang Sở khi không có vai trò ở Sở', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('SO-HY'))), 'ERR');

-- ===== 6. Quản trị nền tảng (021) =====
select pg_temp.chk('kdi', 'Nền tảng đọc HS của cả hai tỉnh', format('select count(distinct org_id) from students where org_id in (%s)', pg_temp.ids('{THCS-PH,THCS-KB}')), '2');
select pg_temp.chk('kdi', 'Nền tảng xem thống kê mọi trường', 'select (select count(*) from dept_school_stats()) = (select count(*) from organizations where type = ''school'')', 'true');
select pg_temp.chk('kdi', 'Nền tảng xem tổng quan hệ thống', 'select (platform_overview()->>''users'')::int > 0', 'true');
select pg_temp.chk('kdi', 'Nền tảng không sửa dữ liệu chuyên môn của trường', format('update students set full_name = ''x'' where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');
select pg_temp.chk('kdi', 'Nền tảng kích hoạt trường', format('update organizations set activated_at = now() where id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), 'rows:1');
select pg_temp.chk('kdi', 'Nền tảng tạo trường dưới Phòng', format('insert into organizations (type, parent_id, code, name) values (''school'', %s, ''ISO-NEW'', ''x'')', quote_literal(pg_temp.oid_('PGD-TPBN'))), 'rows:1');
select pg_temp.chk('kdi', 'Không đặt trường trực tiếp dưới Bộ', format('insert into organizations (type, parent_id, code, name) values (''school'', %s, ''ISO-BAD'', ''x'')', quote_literal(pg_temp.oid_('BO-GDDT'))), 'ERR*');
select pg_temp.chk('kdi', 'Không tạo vòng lặp trong cây', format('update organizations set parent_id = %s where id = %s', quote_literal(pg_temp.oid_('THCS-KB')), quote_literal(pg_temp.oid_('PGD-TPBN'))), 'ERR*');
select pg_temp.chk('kdi', 'Nền tảng gán vai trò ở trường bất kỳ',
  format('insert into memberships (user_id, org_id, role_id) select id, %s, (select id from roles where key=''teacher'' and org_id is null) from profiles where email = ''so_bn@iso-test.local''', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:1');
select pg_temp.chk('kdi', 'Không gán vai trò Quản trị nền tảng trong trường',
  format('insert into memberships (user_id, org_id, role_id) select id, %s, (select id from roles where key=''platform_admin'' and org_id is null) from profiles where email = ''admin_kb@iso-test.local''', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR*');
select pg_temp.chk('kdi', 'Nền tảng đọc nhật ký thay đổi', 'select count(*) from audit_log', '>0');
select pg_temp.chk('admin_ph', 'Trường không xem tổng quan nền tảng', 'select platform_overview()::text', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không tự cấp quyền nền tảng', 'select grant_platform_admin(''admin_ph@iso-test.local'')', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không sửa đơn vị khác', format('update organizations set name = ''x'' where id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');
select pg_temp.chk('admin_ph', 'Trường không thấy nhật ký trường B', format('select count(*) from audit_log where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '0');
select pg_temp.chk('admin_iso', 'Trường đang hoạt động: QT vào được', 'select public.is_admin()::text', 'true');
select pg_temp.probe('kdi@iso-test.local', format('update organizations set status = ''suspended'' where id = %s', quote_literal(pg_temp.oid_('ISO-SCH'))), true);
select pg_temp.chk('admin_iso', 'Trường bị tạm dừng: mất quyền', 'select coalesce(public.my_org_id()::text, ''null'')', 'null');
select pg_temp.chk('admin_iso', 'Trường bị tạm dừng: không đọc dữ liệu', format('select count(*) from organizations where id = %s', quote_literal(pg_temp.oid_('ISO-SCH'))), '0');
select pg_temp.chk('kdi', 'Không tạm dừng đơn vị chủ nền tảng', format('update organizations set status = ''suspended'' where id = %s', quote_literal(pg_temp.oid_('@platform'))), 'ERR*');

-- ===== 7. Quy trình phê duyệt (022) =====
-- Trường đặt quy trình 2 bước cho đề xuất mua gói: Tổ trưởng (vai trò tuỳ chỉnh) → Ban giám hiệu (người có quyền)
select pg_temp.chk('iso_gv', 'Giáo viên không đặt được quy trình', 'select approval_save_workflow(''package_purchase'', ''x'', false, ''[{"approver":"perm"}]'')::text', 'ERR');
select pg_temp.probe('iso_admin@iso-test.local', format($q$select approval_save_workflow('package_purchase', 'ISO 2 bước', false,
  jsonb_build_array(jsonb_build_object('name','Tổ trưởng','approver','role','role_id',(select id from roles where key='custom_iso_tt' and org_id=%s)),
                    jsonb_build_object('name','Ban giám hiệu','approver','perm')))::text$q$, quote_literal(pg_temp.oid_('ISO-TRUONG'))), true);
select pg_temp.chk('iso_admin', 'Không duyệt thẳng bản nháp', 'with x as (insert into package_orders (org_id, name) values (my_org_id(), ''ISO nháp'') returning id) update package_orders set status = ''approved'' where id in (select id from x)', 'ERR*');
select pg_temp.probe('iso_admin@iso-test.local', 'insert into package_orders (org_id, name, status) values (my_org_id(), ''ISO gói A'', ''pending'')', true);
select pg_temp.chk('iso_admin', 'Gửi duyệt tạo hồ sơ 2 bước', 'select (select jsonb_array_length(steps) from approval_requests where title = ''ISO gói A'' and status = ''pending'')', '2');
select pg_temp.chk('iso_gv', 'GV thường không có trong hộp duyệt', 'select count(*) from approval_inbox()', '0');
select pg_temp.chk('iso_gv', 'GV thường không duyệt được', 'select approval_decide((select id from approval_requests where title = ''ISO gói A''), ''approve'')::text', 'ERR');
select pg_temp.chk('iso_admin', 'Bước 1 chưa tới lượt Ban giám hiệu', 'select count(*) from approval_inbox()', '0');
select pg_temp.chk('iso_admin', 'BGH không duyệt vượt bước (đổi trạng thái trực tiếp)', 'update package_orders set status = ''approved'' where name = ''ISO gói A''', 'ERR');
select pg_temp.chk('iso_tt', 'Tổ trưởng thấy hồ sơ bước 1', 'select count(*) from approval_inbox()', '1');
select pg_temp.probe('iso_tt@iso-test.local', 'select approval_decide((select id from approval_requests where title = ''ISO gói A'' and status = ''pending''), ''approve'', ''Đồng ý'')::text', true);
select pg_temp.chk('iso_tt', 'Sau bước 1: hồ sơ rời hộp của tổ trưởng', 'select count(*) from approval_inbox()', '0');
select pg_temp.chk('iso_admin', 'Sau bước 1: bản ghi vẫn chờ duyệt', 'select status from package_orders where name = ''ISO gói A''', 'pending');
select pg_temp.chk('iso_admin', 'Sau bước 1: tới lượt Ban giám hiệu', 'select count(*) from approval_inbox()', '1');
select pg_temp.probe('iso_admin@iso-test.local', 'update package_orders set status = ''approved'' where name = ''ISO gói A''', true);
select pg_temp.chk('iso_admin', 'Đủ 2 bước: bản ghi Đã duyệt', 'select status from package_orders where name = ''ISO gói A''', 'approved');
select pg_temp.chk('iso_admin', 'Lịch sử ghi đủ 2 lần duyệt', 'select count(*) from approval_actions a join approval_requests r on r.id = a.request_id where r.title = ''ISO gói A'' and a.decision = ''approve''', '2');
select pg_temp.probe('iso_admin@iso-test.local', 'insert into package_orders (org_id, name, status) values (my_org_id(), ''ISO gói B'', ''pending'')', true);
select pg_temp.chk('iso_gv', 'Người khác không rút được hồ sơ', 'select approval_cancel((select id from approval_requests where title = ''ISO gói B''))::text', 'ERR');
select pg_temp.probe('iso_admin@iso-test.local', 'select approval_decide((select id from approval_requests where title = ''ISO gói B''), ''reject'', ''Chưa có ngân sách'')::text', true);
select pg_temp.chk('iso_admin', 'BGH từ chối được ở bất kỳ bước nào', 'select status from package_orders where name = ''ISO gói B''', 'rejected');
select pg_temp.chk('iso_admin', 'Không gọi trực tiếp hàm nội bộ tạo hồ sơ', 'select approval_open(my_org_id(), ''package_purchase'', ''package_orders'', gen_random_uuid(), ''x'', null, auth.uid())::text', 'ERR');
select pg_temp.probe('iso_admin@iso-test.local', 'insert into package_orders (org_id, name, status) values (my_org_id(), ''ISO gói C'', ''pending'')', true);
select pg_temp.probe('iso_admin@iso-test.local', 'select approval_cancel((select id from approval_requests where title = ''ISO gói C'' and status = ''pending''))::text', true);
select pg_temp.chk('iso_admin', 'Rút hồ sơ: đề xuất trở về nháp', 'select status from package_orders where name = ''ISO gói C''', 'draft');
-- Sở đặt quy trình cho trường trực thuộc: Hiệu trưởng → Sở; trường không có quy trình riêng cho kế hoạch giáo dục
select pg_temp.probe('iso_so@iso-test.local', $q$select approval_save_workflow('edu_plan', 'ISO Sở', true,
  jsonb_build_array(jsonb_build_object('name','Hiệu trưởng','approver','role','role_id',(select id from roles where key='principal' and org_id is null)),
                    jsonb_build_object('name','Sở duyệt','approver','role','role_id',(select id from roles where key='department' and org_id is null),'org_type','department')))::text$q$, true);
select pg_temp.chk('iso_admin', 'Trường dùng quy trình Sở đặt', 'select (select name from approval_workflows where id = approval_effective_workflow(my_org_id(), ''edu_plan''))', 'ISO Sở');
select pg_temp.probe('iso_admin@iso-test.local', format('insert into education_plans (org_id, teacher_id, subject, grade, stem_periods, status) values (my_org_id(), %s, ''Toán'', 8, 4, ''pending'')',
  quote_literal((select id from teachers where email = 'iso_gv@iso-test.local'))), true);
select pg_temp.chk('iso_admin', 'Kế hoạch: bước 1 Hiệu trưởng', 'select count(*) from approval_inbox()', '1');
select pg_temp.probe('iso_admin@iso-test.local', 'select approval_decide((select r.id from approval_inbox() r limit 1), ''approve'')::text', true);
select pg_temp.chk('so_hy', 'Sở tỉnh khác không thấy hồ sơ', format('select count(*) from approval_requests where org_id = %s', quote_literal(pg_temp.oid_('ISO-TRUONG'))), '0');
select pg_temp.chk('so_hy', 'Sở tỉnh khác không duyệt được', format('select approval_decide((select id from approval_requests where org_id = %s and status = ''pending'' limit 1), ''approve'')::text', quote_literal(pg_temp.oid_('ISO-TRUONG'))), 'ERR*');
select pg_temp.chk('iso_so', 'Bước 2: Sở chủ quản thấy hồ sơ', 'select count(*) from approval_inbox()', '1');
select pg_temp.probe('iso_so@iso-test.local', 'select approval_decide((select r.id from approval_inbox() r limit 1), ''approve'')::text', true);
select pg_temp.chk('iso_admin', 'Sở duyệt xong: kế hoạch Đã duyệt', 'select status from education_plans where org_id = my_org_id() and subject = ''Toán'' and grade = 8', 'approved');

-- ===== 8. Kho học liệu dùng chung (023) =====
select pg_temp.chk('admin_ph', 'Trường A thấy học liệu Sở A phát hành', format('select count(*) from library_items where owner_org_id = %s', quote_literal(pg_temp.oid_('SO-HY'))), '>0');
select pg_temp.chk('admin_kb', 'Trường B không thấy học liệu Sở A', format('select count(*) from library_items where owner_org_id = %s', quote_literal(pg_temp.oid_('SO-HY'))), '0');
select pg_temp.chk('admin_kb', 'Trường B thấy học liệu công khai của KDI', format('select count(*) from library_items where owner_org_id = %s', quote_literal(pg_temp.oid_('@platform'))), '>0');
select pg_temp.chk('hs_kb', 'Học sinh không đọc kho học liệu', 'select count(*) from library_items', '0');
select pg_temp.chk('so_bn', 'Sở không phát hành công khai toàn hệ thống', 'insert into library_items (owner_org_id, kind, title, scope) values (my_org_id(), ''lesson'', ''ISO công khai'', ''public'')', 'ERR');
select pg_temp.chk('so_bn', 'Sở không phát hành thay đơn vị khác', format('insert into library_items (owner_org_id, kind, title) values (%s, ''lesson'', ''ISO giả'')', quote_literal(pg_temp.oid_('SO-HY'))), 'ERR');
select pg_temp.probe('so_bn@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, scope, content) values (my_org_id(), 'lesson', 'ISO bài Phòng TP', 'selected',
  jsonb_build_object('slides', jsonb_build_array(jsonb_build_object('id','x','kind','title','title','ISO'))))$q$, true);
select pg_temp.chk('so_bn', 'Không chọn đơn vị nhận ngoài phạm vi', format('insert into library_targets (item_id, org_id) select id, %s from library_items where title = ''ISO bài Phòng TP''', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');
select pg_temp.probe('so_bn@iso-test.local', format('insert into library_targets (item_id, org_id) select id, %s from library_items where title = ''ISO bài Phòng TP''', quote_literal(pg_temp.oid_('PGD-TPBN'))), true);
select pg_temp.chk('admin_kb', 'Bản nháp chưa tới trường', 'select count(*) from library_items where title = ''ISO bài Phòng TP''', '0');
select pg_temp.chk('so_hy', 'Sở khác không phát hành mục của Sở B', 'select library_publish((select id from library_items where title = ''ISO bài Phòng TP''))::text', 'ERR*');
select pg_temp.probe('so_bn@iso-test.local', 'select library_publish((select id from library_items where title = ''ISO bài Phòng TP''))::text', true);
select pg_temp.chk('admin_kb', 'Phát hành cho Phòng: trường trực thuộc Phòng thấy', 'select count(*) from library_items where title = ''ISO bài Phòng TP''', '1');
select pg_temp.chk('admin_ph', 'Phát hành cho Phòng: tỉnh khác không thấy', 'select count(*) from library_items where title = ''ISO bài Phòng TP''', '0');
select pg_temp.chk('so_hy', 'Sở khác không sửa mục của Sở B', 'update library_items set title = ''x'' where title = ''ISO bài Phòng TP''', 'rows:0');
select pg_temp.chk('so_bn', 'Sở không "dùng" học liệu như trường', 'select library_adopt((select id from library_items where title = ''ISO bài Phòng TP''))::text', 'ERR');
select pg_temp.chk('mixed', 'Không có hồ sơ GV và không là QT: không dùng được', 'select library_adopt((select id from library_items where title = ''ISO bài Phòng TP''))::text', 'ERR');
select pg_temp.probe('gv_both@iso-test.local', 'select library_adopt((select id from library_items where title = ''ISO bài Phòng TP''))::text', true);
select pg_temp.chk('gv_both', 'GV dùng học liệu → có bản nháp của mình', 'select count(*) from lesson_plans where teacher_id = my_teacher_id() and library_item_id = (select id from library_items where title = ''ISO bài Phòng TP'')', '1');
select pg_temp.chk('admin_ph', 'Trường A không dùng được học liệu chỉ phát cho Phòng B', 'select library_adopt((select id from library_items where title = ''ISO bài Phòng TP''))::text', 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', format('select library_adopt((select id from library_items where owner_org_id = %s and kind = ''program'' limit 1), true)::text', quote_literal(pg_temp.oid_('SO-HY'))), true);
select pg_temp.chk('admin_ph', 'Dùng cả chương trình → bài giảng mẫu của trường', format('select count(*) from lesson_plans where is_template and org_id = my_org_id() and library_item_id in (select id from library_items where owner_org_id = %s and kind = ''lesson'') and id in (select lesson_plan_id from library_copies where adopted_by = auth.uid())', quote_literal(pg_temp.oid_('SO-HY'))), '>0');
select pg_temp.probe('so_bn@iso-test.local', 'select library_publish((select id from library_items where title = ''ISO bài Phòng TP''), ''Thêm câu hỏi'')::text', true);
select pg_temp.chk('gv_both', 'Bản mới: bản sao được báo cũ hơn', 'select count(*) from library_copies c join library_items i on i.id = c.item_id where c.adopted_by = auth.uid() and c.adopted_version < i.version', '1');
select pg_temp.chk('gv_both', 'Bản mới: có thông báo cập nhật', 'select count(*) from notifications where user_id = auth.uid() and kind = ''library''', '1');
select pg_temp.chk('so_bn', 'Đơn vị phát hành thấy số trường đã dùng', 'select schools from library_stats() where item_id = (select id from library_items where title = ''ISO bài Phòng TP'')', '1');

-- ===== 9. Gói dịch vụ & hợp đồng (024) =====
insert into service_plans (code, name, modules) values ('ISO-GOI', 'ISO gói thử', '{ph4}') on conflict (code) do nothing;
select pg_temp.chk('iso_admin', 'Chưa có hợp đồng: không giới hạn phân hệ', 'select my_entitlement()->>''state''', 'open');
select pg_temp.chk('iso_admin', 'Trường không tạo được gói dịch vụ', 'insert into service_plans (code, name) values (''ISO-X'', ''x'')', 'ERR');
select pg_temp.chk('iso_so', 'Sở không tự tạo hợp đồng', format('insert into contracts (code, org_id, plan_id, starts_on) values (''ISO-HD0'', my_org_id(), %s, current_date)', quote_literal((select id from service_plans where code = 'ISO-GOI'))), 'ERR');
select pg_temp.probe('kdi@iso-test.local', format('insert into contracts (code, org_id, plan_id, starts_on, status) values (''ISO-HD1'', %s, %s, current_date - 1, ''active'')',
  quote_literal(pg_temp.oid_('ISO-SO')), quote_literal((select id from service_plans where code = 'ISO-GOI'))), true);
select pg_temp.chk('iso_admin', 'Hợp đồng của Sở áp dụng cho trường trực thuộc', 'select my_entitlement()->>''state''', 'active');
select pg_temp.chk('iso_admin', 'Phân hệ ngoài gói: không tạo được phòng STEM', 'insert into stem_rooms (org_id, name) values (my_org_id(), ''ISO phòng'')', 'ERR');
select pg_temp.chk('iso_admin', 'Phân hệ trong gói vẫn dùng được', 'select org_has_module(my_org_id(), ''timetable'')::text', 'true');
select pg_temp.chk('iso_admin', 'Phần lõi luôn dùng được: tạo giáo viên', 'insert into teachers (org_id, full_name, email) values (my_org_id(), ''ISO GV lõi'', ''lo@iso-test.local'')', 'rows:1');
select pg_temp.chk('admin_ph', 'Đơn vị không có hợp đồng không bị ảnh hưởng', 'insert into stem_rooms (org_id, name) values (my_org_id(), ''ISO phòng'')', 'rows:1');
select pg_temp.chk('iso_so', 'Sở thấy hợp đồng của mình', 'select count(*) from contracts where code = ''ISO-HD1''', '1');
select pg_temp.chk('iso_gv', 'Giáo viên không xem hợp đồng', 'select count(*) from contracts where code = ''ISO-HD1''', '0');
select pg_temp.chk('admin_kb', 'Trường tỉnh khác không xem hợp đồng', 'select count(*) from contracts where code = ''ISO-HD1''', '0');
select pg_temp.probe('kdi@iso-test.local', 'update contracts set starts_on = current_date - 30, ends_on = current_date - 1 where code = ''ISO-HD1''', true);
select pg_temp.chk('iso_admin', 'Hợp đồng hết hạn: trạng thái hết hạn', 'select my_entitlement()->>''state''', 'expired');
select pg_temp.chk('iso_admin', 'Hết hạn: phân hệ trong gói cũng bị khoá', 'select org_has_module(my_org_id(), ''timetable'')::text', 'false');
select pg_temp.chk('iso_admin', 'Hết hạn: phần lõi vẫn dùng được', 'select org_has_module(my_org_id(), ''teachers'')::text', 'true');
select pg_temp.chk('kdi', 'Quản trị nền tảng xem quyền dùng mọi đơn vị', format('select state from platform_entitlements() where org_id = %s', quote_literal(pg_temp.oid_('ISO-TRUONG'))), 'expired');
select pg_temp.chk('admin_ph', 'Trường không xem quyền dùng toàn hệ thống', 'select count(*) from platform_entitlements()', 'ERR');

-- ===== 10. Bảo mật tài khoản (024) =====
select pg_temp.chk('admin_ph', 'Trường không gọi được hàm khoá tài khoản', format('select platform_lock_user(%s)::text', quote_literal((select id from profiles where email = 'gv_both@iso-test.local'))), 'ERR');
select pg_temp.chk('admin_ph', 'Không tự đổi trạng thái khoá', 'update profiles set locked_at = null, locked_reason = ''x'' where id = auth.uid()', 'ERR*');
select pg_temp.chk('kdi', 'Không tự khoá chính mình', 'select platform_lock_user(auth.uid())::text', 'ERR*');
select pg_temp.probe('kdi@iso-test.local', format('select platform_lock_user(%s, ''ISO thử khoá'')::text', quote_literal((select id from profiles where email = 'gv_both@iso-test.local'))), true);
select pg_temp.chk('gv_both', 'Tài khoản bị khoá: mất đơn vị làm việc', 'select (my_org_id() is null)::text', 'true');
select pg_temp.chk('gv_both', 'Tài khoản bị khoá: không đọc dữ liệu', 'select count(*) from teachers', '0');
select pg_temp.chk('kdi', 'Tổng quan bảo mật thấy tài khoản bị khoá', 'select jsonb_array_length(platform_security_overview()->''locked'')::text', '1');
select pg_temp.probe('kdi@iso-test.local', format('select platform_unlock_user(%s)::text', quote_literal((select id from profiles where email = 'gv_both@iso-test.local'))), true);
select pg_temp.chk('gv_both', 'Mở khoá: đọc lại được dữ liệu', 'select count(*) from teachers', '>0');
select pg_temp.chk('admin_ph', 'Trường không xem tổng quan bảo mật', 'select platform_security_overview()::text', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không đổi cài đặt bảo mật', 'update security_settings set enforce_mfa_db = true', 'rows:0');
update security_settings set enforce_mfa_db = true where id = 1;
select pg_temp.chk('kdi', 'Bắt buộc 2FA: phiên chưa xác thực 2 lớp mất quyền nền tảng', 'select is_platform_admin()::text', 'false');
select pg_temp.chk('kdi', 'Bắt buộc 2FA: phiên aal2 vẫn có quyền', 'select (set_config(''request.jwt.claims'', json_build_object(''sub'', auth.uid(), ''role'', ''authenticated'', ''aal'', ''aal2'')::text, true) is not null and is_platform_admin())::text', 'true');
update security_settings set enforce_mfa_db = false where id = 1;
select pg_temp.chk('kdi', 'Quản trị nền tảng thuộc nhóm bắt buộc 2FA', 'select mfa_required()::text', 'true');
select pg_temp.chk('admin_ph', 'Hiệu trưởng chưa bắt buộc 2FA (mặc định)', 'select mfa_required()::text', 'false');

-- ===== 11. Hỗ trợ khách hàng (024) =====
select pg_temp.probe('admin_kb@iso-test.local', 'insert into support_tickets (org_id, subject, priority) values (my_org_id(), ''ISO lỗi đăng nhập'', ''urgent'')', true);
select pg_temp.chk('admin_kb', 'Phiếu có mã HT- và hạn 4 giờ', 'select (code like ''HT-%'' and due_at <= created_at + interval ''4 hours 1 minute'')::text from support_tickets where subject = ''ISO lỗi đăng nhập''', 'true');
select pg_temp.chk('admin_kb', 'Không gửi phiếu thay đơn vị khác', format('insert into support_tickets (org_id, subject) values (%s, ''ISO giả'')', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');
select pg_temp.chk('admin_ph', 'Trường khác không thấy phiếu', 'select count(*) from support_tickets where subject = ''ISO lỗi đăng nhập''', '0');
select pg_temp.chk('so_bn', 'Sở chủ quản thấy phiếu của trường', 'select count(*) from support_tickets where subject = ''ISO lỗi đăng nhập''', '1');
select pg_temp.chk('hs_kb', 'Học sinh không thấy phiếu', 'select count(*) from support_tickets where subject = ''ISO lỗi đăng nhập''', '0');
select pg_temp.chk('kdi', 'KDI thấy phiếu', 'select count(*) from support_tickets where subject = ''ISO lỗi đăng nhập''', '1');
select pg_temp.chk('kdi', 'KDI nhận thông báo phiếu mới', 'select count(*) from notifications where user_id = auth.uid() and kind = ''support''', '>0');
select pg_temp.chk('admin_kb', 'Khách hàng không tự đổi mức ưu tiên', 'update support_tickets set priority = ''low'' where subject = ''ISO lỗi đăng nhập''', 'ERR');
select pg_temp.chk('admin_kb', 'Khách hàng không tự đánh dấu đã xử lý', 'update support_tickets set status = ''resolved'' where subject = ''ISO lỗi đăng nhập''', 'ERR');
select pg_temp.probe('kdi@iso-test.local', 'insert into support_messages (ticket_id, body, internal) select id, ''ISO ghi chú nội bộ'', true from support_tickets where subject = ''ISO lỗi đăng nhập''', true);
select pg_temp.probe('kdi@iso-test.local', 'insert into support_messages (ticket_id, body, internal) select id, ''ISO đã kiểm tra'', false from support_tickets where subject = ''ISO lỗi đăng nhập''', true);
select pg_temp.chk('admin_kb', 'Khách hàng không thấy ghi chú nội bộ', 'select count(*) from support_messages m join support_tickets t on t.id = m.ticket_id where t.subject = ''ISO lỗi đăng nhập''', '1');
select pg_temp.chk('admin_kb', 'KDI trả lời: phiếu chuyển sang đang xử lý', 'select status || (first_response_at is not null)::text from support_tickets where subject = ''ISO lỗi đăng nhập''', 'in_progresstrue');
select pg_temp.chk('admin_kb', 'Người gửi nhận thông báo KDI trả lời', 'select count(*) from notifications where user_id = auth.uid() and kind = ''support''', '1');
select pg_temp.chk('admin_kb', 'Khách hàng không viết ghi chú nội bộ', 'insert into support_messages (ticket_id, body, internal) select id, ''x'', true from support_tickets where subject = ''ISO lỗi đăng nhập''', 'ERR');
select pg_temp.chk('admin_kb', 'Khách hàng đóng được phiếu', 'update support_tickets set status = ''closed'' where subject = ''ISO lỗi đăng nhập''', 'rows:1');
select pg_temp.chk('kdi', 'KDI cập nhật được phiếu bảo hành', 'update warranty_tickets set status = ''processing'' where id = (select id from warranty_tickets limit 1)', 'rows:1');
select pg_temp.chk('admin_ph', 'Trường không sửa phiếu bảo hành trường khác', format('update warranty_tickets set status = ''processing'' where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');

-- ===== 12. Danh mục gói & đơn đặt gói (025) =====
select pg_temp.chk('kdi', 'Danh mục KDI có gói mẫu', 'select count(*) from package_catalog()', '>0');
select pg_temp.chk('admin_kb', 'Trường xem được danh mục để đặt', 'select count(*) from package_catalog()', '>0');
select pg_temp.chk('hs_kb', 'Học sinh không xem danh mục', 'select count(*) from package_catalog()', '0');
select pg_temp.chk('admin_kb', 'Gói danh mục không lẫn vào gói của trường', 'select count(*) from stem_packages where org_id = platform_org_id()', '0');
select pg_temp.chk('admin_ph', 'Trường không thêm gói vào danh mục KDI', 'insert into stem_packages (org_id, name, tier) values (platform_org_id(), ''x thử ISO'', ''basic'')', 'ERR');
select pg_temp.chk('admin_ph', 'Không gọi trực tiếp hàm sao chép gói', 'select copy_stem_package((select id from package_catalog() limit 1), my_org_id())::text', 'ERR');
select pg_temp.chk('admin_ph', 'Không chọn gói ngoài danh mục', 'insert into package_orders (org_id, name, catalog_package_id) select my_org_id(), ''x thử ISO'', id from stem_packages where org_id = my_org_id() limit 1', 'ERR*');
select pg_temp.probe('admin_ph@iso-test.local', 'insert into package_orders (org_id, name, status, catalog_package_id) values (my_org_id(), ''Đơn thử ISO'', ''pending'', (select id from package_catalog() where code = ''GOI-001''))', true);
select pg_temp.chk('admin_ph', 'Trường không tự đánh dấu đã giao', 'update package_orders set fulfillment = ''delivered'' where name = ''Đơn thử ISO''', 'ERR');
select pg_temp.chk('kdi', 'Không giao đơn chưa duyệt', 'select platform_fulfill_order((select id from package_orders where name = ''Đơn thử ISO''), ''delivered'')::text', 'ERR*');
-- Quy trình mẫu của Sở Hưng Yên: Hiệu trưởng → Sở
select pg_temp.probe('admin_ph@iso-test.local', 'update package_orders set status = ''approved'' where name = ''Đơn thử ISO''', true);
select pg_temp.probe('so_hy@iso-test.local', 'select approval_decide((select r.id from approval_inbox() r where r.title = ''Đơn thử ISO'' limit 1), ''approve'')::text', true);
select pg_temp.chk('admin_ph', 'Đơn đã duyệt theo quy trình', 'select status from package_orders where name = ''Đơn thử ISO''', 'approved');
select pg_temp.chk('admin_ph', 'Trường không gọi hàm xử lý đơn của KDI', 'select platform_fulfill_order((select id from package_orders where name = ''Đơn thử ISO''), ''delivered'')::text', 'ERR');
select pg_temp.probe('kdi@iso-test.local', 'select platform_fulfill_order((select id from package_orders where name = ''Đơn thử ISO''), ''delivered'', null, ''Giao kèm 10 bộ thiết bị'', 95000000)::text', true);
select pg_temp.chk('admin_ph', 'Đã giao: trường có gói mới kèm chủ đề', 'select count(*) from package_topics where package_id = (select delivered_package_id from package_orders where name = ''Đơn thử ISO'')', '>0');
select pg_temp.chk('admin_ph', 'Đã giao: có buổi học', 'select count(*) from package_topic_sessions s join package_topics t on t.id = s.topic_id where t.package_id = (select delivered_package_id from package_orders where name = ''Đơn thử ISO'')', '>0');
select pg_temp.chk('admin_ph', 'Người đặt nhận thông báo đã giao', 'select count(*) from notifications where user_id = auth.uid() and kind = ''package_order''', '1');
select pg_temp.chk('admin_kb', 'Trường khác không thấy gói đã giao', 'select count(*) from stem_packages where id = (select delivered_package_id from package_orders where name = ''Đơn thử ISO'')', '0');
select pg_temp.chk('kdi', 'Đã giao thì không đổi trạng thái', 'select platform_fulfill_order((select id from package_orders where name = ''Đơn thử ISO''), ''cancelled'')::text', 'ERR*');

-- ===== 13. Thông báo hàng loạt, triển khai, tích hợp (025) =====
select pg_temp.chk('admin_ph', 'Trường không gửi thông báo hàng loạt', 'select platform_broadcast(''x'')::text', 'ERR');
select pg_temp.chk('kdi', 'Xem trước số người nhận', format('select ((platform_broadcast_preview(array[%s]::uuid[], null, array[''principal''])->>''users'')::int > 0)::text', quote_literal(pg_temp.oid_('SO-BN'))), 'true');
select pg_temp.probe('kdi@iso-test.local', format('select platform_broadcast(''Thông báo thử ISO'', ''Nội dung'', null, array[%s]::uuid[], null, array[''principal''])::text', quote_literal(pg_temp.oid_('SO-BN'))), true);
select pg_temp.chk('admin_kb', 'Hiệu trưởng trường thuộc Sở nhận thông báo', 'select count(*) from notifications where user_id = auth.uid() and kind = ''broadcast'' and title = ''Thông báo thử ISO''', '1');
select pg_temp.chk('admin_ph', 'Trường tỉnh khác không nhận', 'select count(*) from notifications where user_id = auth.uid() and title = ''Thông báo thử ISO''', '0');
select pg_temp.chk('gv_both', 'Giáo viên không thuộc vai trò được chọn', 'select count(*) from notifications where user_id = auth.uid() and title = ''Thông báo thử ISO''', '0');
select pg_temp.chk('kdi', 'Thống kê số người nhận', 'select (recipients > 0)::text from platform_broadcasts() where title = ''Thông báo thử ISO''', 'true');
select pg_temp.chk('admin_ph', 'Trường không xem lịch sử thông báo', 'select count(*) from broadcasts', '0');
select pg_temp.chk('kdi', 'KDI đánh dấu bước triển khai', format('insert into rollout_checks (org_id, step) values (%s, ''kickoff'')', quote_literal(pg_temp.oid_('THCS-PH'))), 'rows:1');
select pg_temp.chk('admin_ph', 'Trường không tự đánh dấu bước triển khai', 'insert into rollout_checks (org_id, step) values (my_org_id(), ''acceptance'')', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không xem kết nối tích hợp', 'select count(*) from integrations', '0');
select pg_temp.chk('kdi', 'KDI cập nhật kết nối tích hợp', 'update integrations set status = ''error'', last_error = ''Hết hạn khoá'' where key = ''k12''', 'rows:1');

-- ===== 14. Giáo viên: lịch tập huấn, tự điểm danh, bài giảng tập huấn (026) =====
select pg_temp.probe('gv_both@iso-test.local', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('THCS-KB'))), true);
do $$
declare v_org uuid := pg_temp.oid_('THCS-KB'); v_plan uuid; v_live uuid; v_past uuid;
  v_me uuid := (select id from teachers where email = 'gv_both@iso-test.local' and org_id = pg_temp.oid_('THCS-KB'));
  v_other uuid := (select id from teachers where org_id = pg_temp.oid_('THCS-KB') and coalesce(email, '') not like '%@iso-test.local' order by id limit 1);
begin
  insert into training_plans (org_id, name, mode, status) values (v_org, 'ISO kế hoạch tập huấn', 'online', 'ongoing') returning id into v_plan;
  insert into training_sessions (org_id, plan_id, title, starts_at, ends_at, mode) values
    (v_org, v_plan, 'ISO buổi đang diễn ra', now() - interval '10 minutes', now() + interval '50 minutes', 'online') returning id into v_live;
  insert into training_sessions (org_id, plan_id, title, starts_at, ends_at, mode) values
    (v_org, v_plan, 'ISO buổi đã qua', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'online') returning id into v_past;
  insert into training_enrollments (org_id, plan_id, teacher_id, completed) values (v_org, v_plan, v_me, false);
  insert into training_attendance (org_id, session_id, teacher_id, present) values
    (v_org, v_live, v_me, null), (v_org, v_past, v_me, null), (v_org, v_live, v_other, null);
  insert into training_lessons (org_id, plan_id, title, status) values
    (v_org, v_plan, 'ISO bài tập huấn xuất bản', 'published'), (v_org, v_plan, 'ISO bài tập huấn nháp', 'draft');
end $$;
select pg_temp.chk('gv_both', 'Lịch tập huấn của tôi: 2 buổi', 'select count(*) from my_training_sessions() where title like ''ISO buổi%''', '2');
select pg_temp.chk('gv_both', 'Tự điểm danh buổi đang diễn ra', 'select training_check_in((select id from training_sessions where title = ''ISO buổi đang diễn ra''))', 'ok');
select pg_temp.chk('gv_both', 'Không tự điểm danh buổi đã qua', 'select training_check_in((select id from training_sessions where title = ''ISO buổi đã qua''))', 'ERR*');
select pg_temp.chk('gv_both', 'Ghi thẳng bảng: không đánh có mặt buổi đã qua',
  'update training_attendance set present = true where teacher_id = my_teacher_id() and session_id = (select id from training_sessions where title = ''ISO buổi đã qua'')', 'rows:0');
select pg_temp.chk('gv_both', 'Ghi thẳng bảng: không tự đánh vắng',
  'update training_attendance set present = false where teacher_id = my_teacher_id() and session_id = (select id from training_sessions where title = ''ISO buổi đang diễn ra'')', 'ERR');
select pg_temp.chk('gv_both', 'Không điểm danh hộ giáo viên khác',
  'update training_attendance set present = true where teacher_id <> my_teacher_id() and session_id = (select id from training_sessions where title = ''ISO buổi đang diễn ra'')', 'rows:0');
select pg_temp.chk('gv_both', 'Bài giảng tập huấn: chỉ bản đã xuất bản', 'select count(*) from my_training_lessons() where title like ''ISO bài tập huấn%''', '1');
select pg_temp.chk('admin_kb', 'Hiệu trưởng đánh vắng buổi đã qua',
  'update training_attendance set present = false where session_id = (select id from training_sessions where title = ''ISO buổi đã qua'')', 'rows:1');
select pg_temp.chk('admin_ph', 'Trường tỉnh khác không thấy buổi tập huấn', 'select count(*) from training_sessions where title like ''ISO buổi%''', '0');

-- ===== 15. Buổi dạy & điểm danh theo tiết (027) =====
-- Trường B: một học kỳ thử bao quanh hôm nay, một tiết cả ngày, TKB Thứ 2–7 cho lớp của HS thử B do GV thử B dạy.
do $$
declare v_org uuid := pg_temp.oid_('THCS-KB'); v_year uuid; v_per uuid;
  v_class uuid := (select class_id from students where student_code = 'ISO-001');
  v_other_class uuid := (select id from classes where org_id = pg_temp.oid_('THCS-KB') and id <> (select class_id from students where student_code = 'ISO-001') order by name limit 1);
  v_gv uuid := (select id from teachers where email = 'gv_both@iso-test.local' and org_id = pg_temp.oid_('THCS-KB'));
begin
  insert into academic_years (org_id, name, term, starts_on, ends_on, is_current)
    values (v_org, 'ISO năm thử', 'HK thử', public.vn_today() - 30, public.vn_today() + 30, false) returning id into v_year;
  insert into period_configs (org_id, name, starts_at, ends_at, session) values (v_org, 'ISO Tiết', '00:00', '23:59', 'morning') returning id into v_per;
  insert into timetable_entries (org_id, year_id, class_id, teacher_id, period_id, weekday, subject, kind)
    select v_org, v_year, v_class, v_gv, v_per, w, 'ISO Toán', 'stem' from generate_series(2, 7) w;
  -- Cùng GV, cùng tiết, lớp khác vào Thứ 2 → trùng lịch giáo viên.
  -- Từ 029 CSDL chặn tiết trùng mới; tắt tạm trigger để giả lập dữ liệu cũ đã trùng từ trước.
  if to_regprocedure('public.timetable_guard()') is not null then alter table timetable_entries disable trigger timetable_guard; end if;
  insert into timetable_entries (org_id, year_id, class_id, teacher_id, period_id, weekday, subject, kind)
    values (v_org, null, v_other_class, v_gv, v_per, 2, 'ISO Toán trùng', 'regular');   -- TKB dùng chung mọi học kỳ đè lên TKB riêng của học kỳ
  if to_regprocedure('public.timetable_guard()') is not null then alter table timetable_entries enable trigger timetable_guard; end if;
end $$;
select pg_temp.chk('gv_both', 'Sinh buổi dạy 7 ngày gần nhất từ TKB',
  'select ((generate_teaching_sessions(vn_today() - 6, vn_today())->>''created'')::int > 0)::text', 'true');
select pg_temp.probe('gv_both@iso-test.local', 'select generate_teaching_sessions(vn_today() - 6, vn_today())::text', true);
select pg_temp.chk('gv_both', 'Sinh lại: không tạo trùng (idempotent)', 'select generate_teaching_sessions(vn_today() - 6, vn_today())->>''created''', '0');
select pg_temp.chk('gv_both', 'Không sinh quá 63 ngày một lần', 'select generate_teaching_sessions(vn_today() - 100, vn_today())::text', 'ERR*');
do $$
declare v_s record;
begin
  select * into v_s from teaching_sessions where subject = 'ISO Toán' order by session_date desc limit 1;
  -- Một tiết 10 ngày trước và một tiết ngày kia (cùng lớp, cùng GV) để thử giới hạn thời gian
  insert into teaching_sessions (org_id, class_id, teacher_id, period_id, session_date, subject, kind)
    values (v_s.org_id, v_s.class_id, v_s.teacher_id, v_s.period_id, public.vn_today() - 10, 'ISO Toán cũ', 'stem'),
           (v_s.org_id, v_s.class_id, v_s.teacher_id, v_s.period_id, public.vn_today() + 2, 'ISO Toán sắp tới', 'stem');
end $$;
select pg_temp.probe('gv_both@iso-test.local',
  'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán'' and session_date <= vn_today() order by session_date desc limit 1), jsonb_build_array(jsonb_build_object(''student_id'', (select id from students where student_code = ''ISO-001''), ''status'', ''present'')))::text', true);
select pg_temp.chk('gv_both', 'GV điểm danh tiết của mình → đã dạy, có mặt 1',
  'select status || '':'' || present_count from teaching_sessions where subject = ''ISO Toán'' and session_date <= vn_today() order by session_date desc limit 1', 'taught:1');
select pg_temp.chk('gv_both', 'GV không điểm danh tiết quá 7 ngày',
  'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán cũ''), ''[]''::jsonb)::text', 'ERR*');
select pg_temp.chk('gv_both', 'GV không điểm danh tiết chưa diễn ra',
  'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán sắp tới''), ''[]''::jsonb)::text', 'ERR*');
select pg_temp.chk('gv_both', 'Không điểm danh học sinh lớp khác',
  'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán'' and session_date <= vn_today() order by session_date desc limit 1), jsonb_build_array(jsonb_build_object(''student_id'', (select id from students where class_id <> (select class_id from students where student_code = ''ISO-001'') and org_id = my_org_id() limit 1), ''status'', ''absent'')))::text', 'ERR*');
select pg_temp.chk('gv_both', 'GV không ghi thẳng bảng điểm danh',
  'insert into lesson_attendance (session_id, student_id, org_id, status) select s.id, (select id from students where student_code = ''ISO-001''), s.org_id, ''absent'' from teaching_sessions s where s.subject = ''ISO Toán cũ''', 'ERR');
select pg_temp.chk('gv_both', 'GV không tự huỷ tiết', 'update teaching_sessions set status = ''cancelled'' where subject = ''ISO Toán sắp tới''', 'rows:0');
select pg_temp.chk('admin_kb', 'Quản trị trường sửa điểm danh tiết cũ',
  'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán cũ''), jsonb_build_array(jsonb_build_object(''student_id'', (select id from students where student_code = ''ISO-001''), ''status'', ''excused'')))->>''excused''', '1');
select pg_temp.chk('admin_kb', 'Quản trị trường huỷ tiết', 'update teaching_sessions set status = ''cancelled'', cancel_reason = ''Nghỉ lễ'' where subject = ''ISO Toán sắp tới''', 'rows:1');
select pg_temp.chk('admin_ph', 'Trường khác không điểm danh tiết trường B',
  'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán cũ''), ''[]''::jsonb)::text', 'ERR');
select pg_temp.chk('admin_ph', 'Trường khác không đọc buổi dạy trường B', 'select count(*) from teaching_sessions where subject like ''ISO Toán%''', '0');
select pg_temp.chk('admin_ph', 'Trường khác không đọc view buổi dạy trường B', 'select count(*) from teaching_session_view where subject like ''ISO Toán%''', '0');
select pg_temp.chk('hs_kb', 'Học sinh thấy điểm danh của mình', 'select count(*) from lesson_attendance', '1');
select pg_temp.chk('hs_kb', 'Học sinh chỉ thấy tiết của lớp mình', 'select count(*) from teaching_sessions where class_id <> my_class_id()', '0');
select pg_temp.chk('hs_kb', 'Học sinh không gọi sinh buổi dạy', 'select generate_teaching_sessions(vn_today(), vn_today())::text', 'ERR');
select pg_temp.chk('so_bn', 'Sở B đọc buổi dạy trường trực thuộc', 'select count(*) from teaching_sessions where subject = ''ISO Toán''', '>0');
select pg_temp.chk('so_bn', 'Dashboard điểm danh Sở B có tiết đã dạy của trường B',
  format('select taught::text from attendance_summary(vn_today() - 6, vn_today()) where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '1');
select pg_temp.chk('so_hy', 'Dashboard điểm danh Sở A không có trường tỉnh B',
  format('select count(*) from attendance_summary(vn_today() - 6, vn_today()) where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '0');
select pg_temp.chk('so_bn', 'Sở không điểm danh thay trường', 'select mark_teaching_session((select id from teaching_sessions where subject = ''ISO Toán cũ''), ''[]''::jsonb)::text', 'ERR');
select pg_temp.chk('kdi', 'Nền tảng: dashboard điểm danh toàn hệ thống', 'select count(*) from attendance_summary(vn_today() - 6, vn_today())', '>0');
select pg_temp.chk('admin_kb', 'Phát hiện trùng lịch giáo viên', 'select count(*) from timetable_conflicts() where kind = ''teacher'' and classes like ''%,%''', '>0');
select pg_temp.chk('admin_ph', 'Không thấy trùng lịch của trường khác',
  format('select count(*) from timetable_conflicts() where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), '0');

-- ===== 16. Chống trùng lịch phòng, giáo viên, thiết bị (029) =====
-- Trường B: hai tiết ngắn (ISO Tiết 2, 3), hai phòng thử A/B, các lớp/GV có sẵn của trường B.
-- RA: đăng ký dạy STEM giữ phòng B (lớp c1, GV t2) ngày D tiết 2. RB: đăng ký trùng phòng đó, ghi ở chế độ "mềm" (giả lập dữ liệu cũ).
drop table if exists t_s3;
create temp table t_s3 (k text primary key, v uuid);
create or replace function pg_temp.s3(p_k text) returns uuid language sql as $$ select v from t_s3 where k = p_k $$;
create or replace function pg_temp.s3d() returns date language sql as $$ select public.vn_today() + 3 $$;
do $$
declare v_org uuid := pg_temp.oid_('THCS-KB'); v_class uuid := (select class_id from students where student_code = 'ISO-001');
  v_p2 uuid; v_p3 uuid; v_ra uuid; v_rb uuid; v_rma uuid; v_rmb uuid; v_c1 uuid; v_c3 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_type uuid;
  v_gv uuid := (select id from teachers where email = 'gv_both@iso-test.local' and org_id = pg_temp.oid_('THCS-KB'));
  d date := pg_temp.s3d();
begin
  insert into period_configs (org_id, name, starts_at, ends_at, session) values (v_org, 'ISO Tiết 2', '07:00', '07:45', 'morning') returning id into v_p2;
  insert into period_configs (org_id, name, starts_at, ends_at, session) values (v_org, 'ISO Tiết 3', '08:00', '08:45', 'morning') returning id into v_p3;
  insert into stem_rooms (org_id, name, status) values (v_org, 'ISO phòng A', 'active') returning id into v_rma;
  insert into stem_rooms (org_id, name, status) values (v_org, 'ISO phòng B', 'active') returning id into v_rmb;
  select id into v_c1 from classes where org_id = v_org and id <> v_class order by name limit 1;
  select id into v_c3 from classes where org_id = v_org and id not in (v_class, v_c1) order by name limit 1;
  select id into v_t2 from teachers where org_id = v_org and coalesce(email, '') not like '%@iso-test.local' order by full_name, id limit 1;
  select id into v_t3 from teachers where org_id = v_org and coalesce(email, '') not like '%@iso-test.local' order by full_name, id offset 1 limit 1;
  select id into v_t4 from teachers where org_id = v_org and coalesce(email, '') not like '%@iso-test.local' order by full_name, id offset 2 limit 1;
  -- TKB Thứ 3 của lớp HS thử dùng phòng A
  update timetable_entries set room_id = v_rma where subject = 'ISO Toán' and weekday = 3;
  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic)
    values (v_org, v_t2, v_c1, v_rmb, v_p2, d, 'ISO đăng ký A') returning id into v_ra;
  perform set_config('kdi.booking_soft', 'on', true);
  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic)
    values (v_org, v_t3, v_c3, v_rmb, v_p2, d, 'ISO đăng ký B') returning id into v_rb;
  perform set_config('kdi.booking_soft', 'off', true);
  insert into equipment_types (org_id, name) values (v_org, 'ISO Kính') returning id into v_type;
  insert into equipment_units (org_id, type_id, status) values (v_org, v_type, 'available'), (v_org, v_type, 'available'), (v_org, v_type, 'broken');
  insert into t_s3 values ('p2', v_p2), ('p3', v_p3), ('rma', v_rma), ('rmb', v_rmb), ('c1', v_c1), ('c3', v_c3),
    ('t2', v_t2), ('t3', v_t3), ('t4', v_t4), ('gv', v_gv), ('ra', v_ra), ('rb', v_rb), ('type', v_type), ('org', v_org);
end $$;

-- Thời khoá biểu
select pg_temp.chk('admin_kb', 'TKB: chặn tiết mới trùng phòng STEM',
  format('insert into timetable_entries (org_id, class_id, teacher_id, period_id, weekday, subject, kind, room_id) select my_org_id(), %L, %L, period_id, 3, ''ISO Toán phòng'', ''stem'', %L from timetable_entries where subject = ''ISO Toán'' and weekday = 3',
    pg_temp.s3('c3'), pg_temp.s3('t3'), pg_temp.s3('rma')), 'ERR 23P01');
select pg_temp.chk('admin_kb', 'TKB: phòng khác cùng tiết thì được',
  format('insert into timetable_entries (org_id, class_id, teacher_id, period_id, weekday, subject, kind, room_id) select my_org_id(), %L, %L, period_id, 3, ''ISO Toán phòng'', ''stem'', %L from timetable_entries where subject = ''ISO Toán'' and weekday = 3',
    pg_temp.s3('c3'), pg_temp.s3('t3'), pg_temp.s3('rmb')), 'rows:1');
select pg_temp.chk('admin_kb', 'TKB: chặn GV dạy hai lớp (TKB mọi học kỳ đè học kỳ riêng)',
  format('insert into timetable_entries (org_id, class_id, teacher_id, period_id, weekday, subject, kind) select my_org_id(), %L, %L, period_id, 4, ''ISO Toán GV'', ''regular'' from timetable_entries where subject = ''ISO Toán'' and weekday = 4',
    pg_temp.s3('c3'), pg_temp.s3('gv')), 'ERR 23P01');

-- Đăng ký dạy STEM & dạy bù
select pg_temp.chk('admin_kb', 'Đăng ký dạy STEM trùng phòng bị chặn',
  format('insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic) values (my_org_id(), %L, %L, %L, %L, %L, ''ISO đăng ký C'')',
    pg_temp.s3('t4'), pg_temp.s3('c3'), pg_temp.s3('rmb'), pg_temp.s3('p2'), pg_temp.s3d()), 'ERR 23P01');
select pg_temp.chk('admin_kb', 'Cùng phòng, tiết khác thì được',
  format('insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic) values (my_org_id(), %L, %L, %L, %L, %L, ''ISO đăng ký C'')',
    pg_temp.s3('t4'), pg_temp.s3('c3'), pg_temp.s3('rmb'), pg_temp.s3('p3'), pg_temp.s3d()), 'rows:1');
select pg_temp.chk('admin_kb', 'Cùng lớp dùng lại phòng của chính tiết mình: không tính trùng',
  format('insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic) values (my_org_id(), %L, %L, %L, %L, %L, ''ISO đăng ký C'')',
    pg_temp.s3('t4'), pg_temp.s3('c1'), pg_temp.s3('rmb'), pg_temp.s3('p2'), pg_temp.s3d()), 'rows:1');
select pg_temp.chk('admin_kb', 'GV không đăng ký dạy hai lớp cùng giờ',
  format('insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic) values (my_org_id(), %L, %L, %L, %L, %L, ''ISO đăng ký C'')',
    pg_temp.s3('t2'), pg_temp.s3('c3'), pg_temp.s3('rma'), pg_temp.s3('p2'), pg_temp.s3d()), 'ERR 23P01');
select pg_temp.chk('admin_kb', 'Tiết dạy bù trùng phòng bị chặn',
  format('insert into teaching_sessions (org_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind, is_makeup) values (my_org_id(), %L, %L, %L, %L, %L, ''ISO Toán bù'', ''stem'', true)',
    pg_temp.s3('c3'), pg_temp.s3('t4'), pg_temp.s3('p2'), pg_temp.s3('rmb'), pg_temp.s3d()), 'ERR 23P01');
select pg_temp.chk('admin_kb', 'Tiết dạy bù ở phòng trống thì được',
  format('insert into teaching_sessions (org_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind, is_makeup) values (my_org_id(), %L, %L, %L, %L, %L, ''ISO Toán bù'', ''stem'', true)',
    pg_temp.s3('c3'), pg_temp.s3('t4'), pg_temp.s3('p2'), pg_temp.s3('rma'), pg_temp.s3d()), 'rows:1');
select pg_temp.chk('admin_kb', 'Không ghi thẳng sổ giữ chỗ',
  format('insert into resource_bookings (org_id, room_id, holder_id, during, source, source_id) values (my_org_id(), %L, %L, period_slot(%L, null), ''teaching_session'', gen_random_uuid())',
    pg_temp.s3('rma'), pg_temp.s3('c3'), pg_temp.s3d() + 1), 'ERR');
select pg_temp.chk('admin_kb', 'Chỗ trùng có sẵn được ghi lại, không chặn',
  format('select count(*) from booking_conflicts where source_id = %L', pg_temp.s3('rb')), '1');

-- Phạm vi đọc
select pg_temp.chk('admin_ph', 'Trường khác không đọc sổ giữ chỗ trường B',
  format('select count(*) from resource_bookings where org_id = %L', pg_temp.s3('org')), '0');
select pg_temp.chk('admin_ph', 'Trường khác không đọc chỗ trùng trường B',
  format('select count(*) from booking_conflicts where org_id = %L', pg_temp.s3('org')), '0');
select pg_temp.chk('hs_kb', 'Học sinh không đọc sổ giữ chỗ', 'select count(*) from resource_bookings', '0');
select pg_temp.chk('hs_kb', 'Học sinh không xem tổng hợp phòng STEM', 'select count(*) from room_overview(vn_today(), vn_today() + 7)', 'ERR');
select pg_temp.chk('so_bn', 'Sở B: phòng STEM trường trực thuộc có lịch giữ',
  format('select booked::text from room_overview(vn_today(), vn_today() + 7) where room_id = %L', pg_temp.s3('rmb')), '1');
select pg_temp.chk('so_hy', 'Sở A không thấy phòng STEM trường tỉnh B',
  format('select count(*) from room_overview(vn_today(), vn_today() + 7) where org_id = %L', pg_temp.s3('org')), '0');
select pg_temp.chk('kdi', 'Nền tảng: phòng STEM toàn hệ thống', 'select count(*) from room_overview(vn_today() - 6, vn_today())', '>0');
select pg_temp.chk('kdi', 'Nền tảng: thiết bị theo trường', 'select count(*) from equipment_overview()', '>0');
select pg_temp.chk('so_hy', 'Sở A không thấy thiết bị trường tỉnh B',
  format('select count(*) from equipment_overview() where org_id = %L', pg_temp.s3('org')), '0');

-- Huỷ tiết đang giữ phòng → tiết đang chờ được xếp vào
delete from stem_registrations where id = pg_temp.s3('ra');
select pg_temp.chk('admin_kb', 'Huỷ lịch giữ phòng → lịch đang chờ được xếp vào',
  format('select count(*) from resource_bookings where source_id = %L', pg_temp.s3('rb')), '1');
select pg_temp.chk('admin_kb', 'Hết chỗ trùng sau khi xếp lại',
  format('select count(*) from booking_conflicts where source_id = %L', pg_temp.s3('rb')), '0');

-- Thiết bị: 2 dùng được (1 hỏng). Phiếu 1 mượn 2 đã duyệt → phiếu 2 cùng tiết không duyệt được; tiết khác thì được.
do $$
declare v_org uuid := pg_temp.s3('org'); v_type uuid := pg_temp.s3('type'); b1 uuid; b2 uuid; b3 uuid; r text;
  items jsonb; d date := pg_temp.s3d();
begin
  perform set_config('app.approval_engine', 'on', true);
  items := jsonb_build_array(jsonb_build_object('type_id', v_type, 'name', 'ISO Kính', 'qty', 2));
  insert into borrow_requests (org_id, teacher_id, class_id, title, on_date, period_id, mode, item_list)
    values (v_org, pg_temp.s3('t2'), pg_temp.s3('c1'), 'ISO mượn 1', d, pg_temp.s3('p2'), 'take_to_class', items) returning id into b1;
  begin update borrow_requests set status = 'approved' where id = b1; r := 'ok'; exception when others then r := 'ERR ' || sqlstate; end;
  insert into t_result (who, name, expect, got, ok) values ('(CSDL)', 'Duyệt phiếu mượn khi đủ thiết bị', 'ok', r, r = 'ok');
  items := jsonb_build_array(jsonb_build_object('type_id', v_type, 'name', 'ISO Kính', 'qty', 1));
  insert into borrow_requests (org_id, teacher_id, class_id, title, on_date, period_id, mode, item_list)
    values (v_org, pg_temp.s3('t3'), pg_temp.s3('c3'), 'ISO mượn 2', d, pg_temp.s3('p2'), 'take_to_class', items) returning id into b2;
  insert into t_result (who, name, expect, got, ok) values ('(CSDL)', 'GV vẫn gửi được phiếu khi thiếu (chờ duyệt)', 'pending',
    (select status from borrow_requests where id = b2), (select status from borrow_requests where id = b2) = 'pending');
  begin update borrow_requests set status = 'approved' where id = b2; r := 'ok'; exception when others then r := 'ERR ' || sqlstate; end;
  insert into t_result (who, name, expect, got, ok) values ('(CSDL)', 'Không duyệt phiếu mượn khi hết thiết bị trong khung giờ', 'ERR 23P01', r, r = 'ERR 23P01');
  insert into borrow_requests (org_id, teacher_id, class_id, title, on_date, period_id, mode, item_list)
    values (v_org, pg_temp.s3('t3'), pg_temp.s3('c3'), 'ISO mượn 3', d, pg_temp.s3('p3'), 'take_to_class', items) returning id into b3;
  begin update borrow_requests set status = 'approved' where id = b3; r := 'ok'; exception when others then r := 'ERR ' || sqlstate; end;
  insert into t_result (who, name, expect, got, ok) values ('(CSDL)', 'Tiết khác vẫn duyệt được', 'ok', r, r = 'ok');
  perform set_config('app.approval_engine', 'off', true);
end $$;
select pg_temp.chk('admin_kb', 'Còn trống theo khung giờ: dùng được 2, đã giữ 2, còn 0',
  format('select usable || '':'' || held || '':'' || free from equipment_availability(%L, %L) where type_id = %L', pg_temp.s3d(), pg_temp.s3('p2'), pg_temp.s3('type')), '2:2:0');
select pg_temp.chk('admin_ph', 'Trường khác không xem thiết bị còn trống của trường B',
  format('select count(*) from equipment_availability(%L, null) where type_id = %L', pg_temp.s3d(), pg_temp.s3('type')), '0');

-- ===== 17. Kho hoạt động, học trước & tự học, ngày nghỉ (030) =====
-- GV thử B dạy lớp của HS thử B (phân công), một hoạt động trắc nghiệm đã xuất bản.
do $$
declare v_org uuid := pg_temp.oid_('THCS-KB');
  v_gv uuid := (select id from teachers where email = 'gv_both@iso-test.local' and org_id = pg_temp.oid_('THCS-KB'));
begin
  insert into teaching_assignments (org_id, teacher_id, class_id, subject)
    values (v_org, v_gv, (select class_id from students where student_code = 'ISO-001'), 'ISO tự học');
  insert into activities (org_id, teacher_id, kind, title, status, content) values
    (v_org, v_gv, 'quiz', 'ISO hoạt động trắc nghiệm', 'published',
     '{"items":[{"q":"1+1?","options":["1","2"],"answer":1},{"q":"2+2?","options":["4","5"],"answer":0}]}'),
    (v_org, v_gv, 'quiz', 'ISO hoạt động nháp', 'draft', '{"items":[]}');
end $$;
select pg_temp.chk('gv_both', 'GV tạo hoạt động của mình',
  'insert into activities (org_id, teacher_id, kind, title, content) values (my_org_id(), my_teacher_id(), ''order'', ''ISO hoạt động sắp xếp'', ''{"steps":["a","b"]}'')', 'rows:1');
select pg_temp.chk('gv_both', 'Không xuất bản hoạt động thiếu nội dung',
  'update activities set status = ''published'' where title = ''ISO hoạt động nháp''', 'ERR*');
select pg_temp.chk('gv_both', 'GV không tạo hoạt động đứng tên GV khác',
  'insert into activities (org_id, teacher_id, kind, title) values (my_org_id(), (select id from teachers where org_id = my_org_id() and id <> my_teacher_id() limit 1), ''quiz'', ''ISO hoạt động giả'')', 'ERR');
select pg_temp.chk('admin_ph', 'Trường khác không đọc hoạt động trường B', 'select count(*) from activities where title like ''ISO hoạt động%''', '0');
select pg_temp.chk('hs_kb', 'Học sinh không đọc kho hoạt động (có đáp án)', 'select count(*) from activities', '0');
select pg_temp.probe('gv_both@iso-test.local',
  'insert into self_study_items (org_id, class_id, teacher_id, kind, activity_id, title, max_attempts) values (my_org_id(), (select class_id from students where student_code = ''ISO-001''), my_teacher_id(), ''activity'', (select id from activities where title = ''ISO hoạt động trắc nghiệm''), ''ISO tự học trắc nghiệm'', 1)', true);
select pg_temp.chk('gv_both', 'GV giao bài tự học cho lớp mình dạy', 'select count(*) from self_study_items where title = ''ISO tự học trắc nghiệm''', '1');
select pg_temp.chk('gv_both', 'Nội dung được chụp lại lúc giao',
  'select c.kind from self_study_content c join self_study_items i on i.id = c.item_id where i.title = ''ISO tự học trắc nghiệm''', 'quiz');
select pg_temp.chk('gv_both', 'Không giao bài cho lớp không dạy',
  'insert into self_study_items (org_id, class_id, teacher_id, kind, url, title) values (my_org_id(), (select id from classes where org_id = my_org_id() and not teaches_class(id) limit 1), my_teacher_id(), ''link'', ''https://kdi.edu.vn'', ''ISO tự học lớp khác'')', 'ERR');
select pg_temp.chk('gv_both', 'Không giao hoạt động chưa hoàn chỉnh',
  'insert into self_study_items (org_id, class_id, teacher_id, kind, activity_id, title) values (my_org_id(), (select class_id from students where student_code = ''ISO-001''), my_teacher_id(), ''activity'', (select id from activities where title = ''ISO hoạt động nháp''), ''ISO tự học nháp'')', 'ERR*');
select pg_temp.chk('admin_ph', 'Trường khác không giao bài vào lớp trường B',
  format('insert into self_study_items (org_id, class_id, kind, url, title) values (%L, (select class_id from students where student_code = ''ISO-001''), ''link'', ''https://kdi.edu.vn'', ''ISO tự học xâm nhập'')', pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('hs_kb', 'Học sinh thấy bài tự học của lớp', 'select count(*) from self_study_items where title = ''ISO tự học trắc nghiệm''', '1');
select pg_temp.chk('hs_kb', 'Học sinh không đọc bảng nội dung có đáp án', 'select count(*) from self_study_content', '0');
select pg_temp.chk('hs_kb', 'Đề mở cho học sinh không chứa đáp án',
  'select ((self_study_open((select id from self_study_items where title = ''ISO tự học trắc nghiệm''))->''content'')::text not like ''%answer%'')::text', 'true');
select pg_temp.chk('hs_kb', 'Chưa làm thì chưa xem đáp án',
  'select ((self_study_open((select id from self_study_items where title = ''ISO tự học trắc nghiệm''))->''solution'') = ''null''::jsonb)::text', 'true');
select pg_temp.chk('hs_kb', 'Học sinh không tự ghi tiến độ',
  'insert into self_study_progress (item_id, student_id, org_id, status, score) select id, my_student_id(), org_id, ''done'', 10 from self_study_items where title = ''ISO tự học trắc nghiệm''', 'ERR');
select pg_temp.probe('hs_kb@iso-test.local',
  'select self_study_submit((select id from self_study_items where title = ''ISO tự học trắc nghiệm''), ''[1,1]''::jsonb)::text', true);
select pg_temp.chk('hs_kb', 'CSDL chấm: đúng 1/2 → 5 điểm',
  'select score::text from self_study_progress where item_id = (select id from self_study_items where title = ''ISO tự học trắc nghiệm'')', '5.0');
select pg_temp.chk('hs_kb', 'Học sinh không sửa điểm của mình',
  'update self_study_progress set score = 10 where student_id = my_student_id()', 'rows:0');
select pg_temp.chk('hs_kb', 'Hết lượt làm thì không nộp lại được',
  'select self_study_submit((select id from self_study_items where title = ''ISO tự học trắc nghiệm''), ''[1,0]''::jsonb)::text', 'ERR*');
select pg_temp.chk('hs_kb', 'Hết lượt thì được xem đáp án',
  'select ((self_study_open((select id from self_study_items where title = ''ISO tự học trắc nghiệm''))->''solution'') <> ''null''::jsonb)::text', 'true');
select pg_temp.chk('admin_kb', 'Quản trị không làm bài thay học sinh',
  'select self_study_submit((select id from self_study_items where title = ''ISO tự học trắc nghiệm''), ''[1,0]''::jsonb)::text', 'ERR');
select pg_temp.chk('gv_both', 'GV nhận xét bài tự học',
  'update self_study_progress set teacher_comment = ''Tốt'', attempts = 99, answers = null where item_id = (select id from self_study_items where title = ''ISO tự học trắc nghiệm'')', 'rows:1');
select pg_temp.probe('gv_both@iso-test.local',
  'update self_study_progress set teacher_comment = ''Tốt'', attempts = 99, answers = null where item_id = (select id from self_study_items where title = ''ISO tự học trắc nghiệm'')', true);
select pg_temp.chk('gv_both', 'GV không sửa được câu trả lời, số lượt của HS',
  'select attempts || '':'' || (answers is not null) from self_study_progress where item_id = (select id from self_study_items where title = ''ISO tự học trắc nghiệm'')', '1:true');
select pg_temp.chk('gv_both', 'Thống kê bài: 1 HS đã làm',
  'select done::text from self_study_stats where item_id = (select id from self_study_items where title = ''ISO tự học trắc nghiệm'')', '1');
select pg_temp.chk('so_bn', 'Sở B đọc tiến độ tự học trường trực thuộc', 'select count(*) from self_study_progress where teacher_comment = ''Tốt''', '1');
select pg_temp.chk('so_hy', 'Sở A không đọc tiến độ tự học tỉnh B', 'select count(*) from self_study_progress where teacher_comment = ''Tốt''', '0');
select pg_temp.chk('admin_ph', 'Trường khác không đọc bài tự học trường B', 'select count(*) from self_study_items where title like ''ISO tự học%''', '0');

-- Ngày nghỉ: Sở B khai báo nghỉ 3 ngày tới → không sinh tiết trong 3 ngày đó, vẫn sinh các ngày sau
select pg_temp.probe('so_bn@iso-test.local',
  'insert into school_holidays (org_id, name, starts_on, ends_on) values (my_org_id(), ''ISO nghỉ của Sở'', vn_today() + 1, vn_today() + 3)', true);
select pg_temp.chk('so_hy', 'Sở A không khai báo ngày nghỉ cho Sở B',
  format('insert into school_holidays (org_id, name, starts_on, ends_on) values (%L, ''ISO nghỉ giả'', vn_today(), vn_today())', pg_temp.oid_('SO-BN')), 'ERR');
select pg_temp.chk('gv_both', 'Giáo viên không khai báo ngày nghỉ của trường',
  'insert into school_holidays (org_id, name, starts_on, ends_on) values (my_org_id(), ''ISO nghỉ GV'', vn_today(), vn_today())', 'ERR');
select pg_temp.chk('admin_kb', 'Quản trị trường khai báo ngày nghỉ riêng',
  'insert into school_holidays (org_id, name, starts_on, ends_on) values (my_org_id(), ''ISO nghỉ của trường'', vn_today() + 20, vn_today() + 20)', 'rows:1');
select pg_temp.chk('hs_kb', 'Học sinh thấy ngày nghỉ do Sở áp xuống', 'select count(*) from school_holidays where name = ''ISO nghỉ của Sở''', '1');
select pg_temp.chk('admin_ph', 'Trường tỉnh khác không thấy ngày nghỉ Sở B', 'select count(*) from school_holidays where name like ''ISO nghỉ%''', '0');
select pg_temp.probe('gv_both@iso-test.local', 'select generate_teaching_sessions(vn_today() + 1, vn_today() + 9)::text', true);
select pg_temp.chk('gv_both', 'Không sinh tiết vào ngày nghỉ của Sở',
  'select count(*) from teaching_sessions where subject = ''ISO Toán'' and session_date between vn_today() + 1 and vn_today() + 3', '0');
select pg_temp.chk('gv_both', 'Vẫn sinh tiết sau kỳ nghỉ',
  'select count(*) from teaching_sessions where subject = ''ISO Toán'' and session_date between vn_today() + 4 and vn_today() + 9', '>0');
select pg_temp.chk('gv_both', 'Nhận biết ngày nghỉ theo cấp trên', 'select is_holiday(my_org_id(), vn_today() + 2)', 'ISO nghỉ của Sở');

-- ===== 18. Cơ sở triển khai (032) =====
select pg_temp.chk('kdi', 'Nền tảng: sổ cơ sở triển khai có mọi trường', 'select count(*) from platform_school_registry()', '>0');
select pg_temp.chk('kdi', 'Sổ có trường thử, kèm giai đoạn', 'select (stage is not null)::text from platform_school_registry() where code = ''ISO-SCH''', 'true');
select pg_temp.chk('so_hy', 'Sở không xem sổ cơ sở triển khai', 'select count(*) from platform_school_registry()', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không xem sổ cơ sở triển khai', 'select count(*) from platform_school_registry()', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không xem xu hướng của trường', format('select count(*) from platform_school_trend(%L)', pg_temp.oid_('THCS-PH')), 'ERR');
select pg_temp.chk('kdi', 'Nền tảng: xu hướng 8 tuần', format('select count(*) from platform_school_trend(%L)', pg_temp.oid_('THCS-PH')), '8');
select pg_temp.chk('kdi', 'Danh sách nhân viên KDI', 'select count(*) from platform_staff()', '>0');
select pg_temp.probe('kdi@iso-test.local', format('select platform_update_school(%L, jsonb_build_object(''kdi_owner'', auth.uid(), ''go_live_on'', vn_today()))::text', pg_temp.oid_('ISO-SCH')), true);
select pg_temp.chk('kdi', 'Gán người phụ trách KDI và ngày vận hành (trường đang tạm dừng vẫn là Tạm dừng)', 'select (kdi_owner_name is not null and go_live_on = vn_today())::text || '':'' || stage from platform_school_registry() where code = ''ISO-SCH''', 'true:paused');
select pg_temp.chk('kdi', 'Người phụ trách phải là nhân viên KDI',
  format('select platform_update_school(%L, jsonb_build_object(''kdi_owner'', (select id from profiles where email = ''admin_ph@iso-test.local'')))::text', pg_temp.oid_('ISO-SCH')), 'ERR*');
select pg_temp.chk('so_hy', 'Sở không đổi người phụ trách / ngày vận hành',
  format('update organizations set go_live_on = vn_today() + 1 where id = %L', pg_temp.oid_('ISO-SCH')), 'ERR');
select pg_temp.chk('so_hy', 'Sở không gọi được hàm cập nhật của KDI', format('select platform_update_school(%L, ''{}''::jsonb)::text', pg_temp.oid_('ISO-SCH')), 'ERR');
select pg_temp.chk('kdi', 'Nhập trường từ Excel: dòng đúng được tạo, dòng sai bị bỏ qua',
  'select (platform_import_schools(''[{"line":2,"code":"ISO-IMP1","name":"Trường thử ISO nhập","level":"THCS","parent_code":"SO-BN"},{"line":3,"code":"ISO-IMP2","name":"Trường thử ISO lỗi","level":"abc","parent_code":"SO-BN"}]''::jsonb)->>''created'')', '1');
select pg_temp.chk('so_bn', 'Sở không nhập trường bằng hàm của KDI',
  'select platform_import_schools(''[{"code":"ISO-IMP2","name":"Trường thử ISO lỗi","parent_code":"SO-BN"}]''::jsonb)::text', 'ERR');

-- ===== 19. 5 phân hệ, mức sử dụng, quyền mặc định (033) =====
select pg_temp.chk('kdi', 'Danh mục phân hệ bán = 5 phân hệ', 'select string_agg(key, '','' order by sort) from service_modules', 'ph1,ph2,ph3,ph4,ph5');
select pg_temp.chk('iso_admin', 'Phê duyệt là phần lõi: dùng được cả khi hợp đồng hết hạn', 'select org_has_module(my_org_id(), ''approvals'')::text', 'true');
select pg_temp.chk('iso_admin', 'PH5 khoá theo gói khi hợp đồng hết hạn', 'select org_has_module(my_org_id(), ''governance'')::text', 'false');
select pg_temp.chk('admin_ph', 'Đơn vị chưa có hợp đồng dùng được PH5', 'select org_has_module(my_org_id(), ''governance'')::text', 'true');
select pg_temp.chk('kdi', 'Mức sử dụng: đủ 5 phân hệ', 'select count(*) from platform_module_usage()', '5');
select pg_temp.chk('kdi', 'Mức sử dụng PH4: có trường đang dùng', 'select schools_active::text from platform_module_usage() where key = ''ph4''', '>0');
select pg_temp.chk('kdi', 'Chi tiết PH4 theo trường', 'select count(*) from platform_module_usage_detail(''ph4'')', '>0');
select pg_temp.chk('so_hy', 'Sở không xem mức sử dụng toàn hệ thống', 'select count(*) from platform_module_usage()', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không xem chi tiết phân hệ', 'select count(*) from platform_module_usage_detail(''ph4'')', 'ERR');
select pg_temp.chk('kdi', 'KDI sửa quyền mặc định',
  'update role_permissions set can_delete = not can_delete where role_id = (select id from roles where key = ''teacher'' and org_id is null) and module = ''timetable''', 'rows:1');
select pg_temp.chk('admin_ph', 'Trường không sửa quyền mặc định',
  'update role_permissions set can_delete = not can_delete where role_id = (select id from roles where key = ''teacher'' and org_id is null) and module = ''timetable''', 'rows:0');
select pg_temp.chk('kdi', 'Quyền mặc định chỉ cho vai trò hệ thống',
  'insert into role_permissions (role_id, module, can_view) select id, ''timetable'', true from roles where key = ''custom_iso_tt''', 'ERR');
select pg_temp.probe('kdi@iso-test.local',
  'update role_permissions set can_delete = not can_delete where role_id = (select id from roles where key = ''teacher'' and org_id is null) and module = ''timetable''', true);
select pg_temp.chk('kdi', 'Sửa quyền mặc định được ghi nhật ký', 'select count(*) from audit_log where entity = ''role_permissions''', '>0');
select pg_temp.probe('kdi@iso-test.local',
  'update role_permissions set can_delete = not can_delete where role_id = (select id from roles where key = ''teacher'' and org_id is null) and module = ''timetable''', true);
select pg_temp.chk('admin_ph', 'Trường không xem số trường chỉnh riêng quyền', 'select count(*) from platform_permission_overrides()', 'ERR');

-- ===== 034: vai trò tuỳ chỉnh chỉ do quản trị của chính đơn vị sửa, không thành vai trò hệ thống =====
-- (CSDL thật từng có policy roles_admin_write cho quản trị sửa vai trò mọi đơn vị trong cây của mình — hiện chưa khai thác
--  được vì Hiệu trưởng/QTV chỉ có ở cấp trường, nhưng sẽ mở khi có đơn vị cha mang vai trò quản trị.)
select pg_temp.chk('iso_admin', 'Quản trị trường sửa vai trò tuỳ chỉnh của trường mình',
  'update roles set name = name where key = ''custom_iso_tt''', 'rows:1');
select pg_temp.chk('iso_admin', 'Không biến vai trò tuỳ chỉnh thành vai trò hệ thống',
  'update roles set is_system = true where key = ''custom_iso_tt''', 'ERR*');
select pg_temp.chk('iso_so', 'Sở không sửa vai trò tuỳ chỉnh của trường trực thuộc',
  'update roles set name = name where key = ''custom_iso_tt''', 'rows:0');
select pg_temp.chk('iso_so', 'Sở không xoá vai trò tuỳ chỉnh của trường trực thuộc',
  'delete from roles where key = ''custom_iso_tt''', 'rows:0');
select pg_temp.chk('admin_ph', 'Trường khác không sửa vai trò tuỳ chỉnh',
  'update roles set name = name where key = ''custom_iso_tt''', 'rows:0');
select pg_temp.chk('iso_admin', 'Quản trị trường không sửa vai trò hệ thống',
  'update roles set name = name where key = ''teacher'' and org_id is null', 'rows:0');
-- 034: quyền mặc định của vai trò Giáo viên (theo CSDL thật): xem thiết bị, tạo phiếu đăng ký dạy STEM, không sửa giáo viên.
-- Kiểm tra ma trận quyền mặc định (has_perm còn tuỳ hợp đồng của trường nên không dùng ở đây).
select pg_temp.chk('iso_gv', 'Quyền mặc định GV: xem thiết bị',
  'select (can_view and can_detail)::text from role_permissions rp join roles r on r.id = rp.role_id where r.key = ''teacher'' and r.org_id is null and rp.module = ''equipment''', 'true');
select pg_temp.chk('iso_gv', 'Quyền mặc định GV: tạo đăng ký dạy STEM',
  'select can_create::text from role_permissions rp join roles r on r.id = rp.role_id where r.key = ''teacher'' and r.org_id is null and rp.module = ''stem_registrations''', 'true');
select pg_temp.chk('iso_gv', 'Quyền mặc định GV: không sửa hồ sơ giáo viên',
  'select (can_edit or can_delete)::text from role_permissions rp join roles r on r.id = rp.role_id where r.key = ''teacher'' and r.org_id is null and rp.module = ''teachers''', 'false');
select pg_temp.chk('iso_gv', 'Không còn quyền của chức năng không tồn tại (borrow, edu_plans)',
  'select count(*) from role_permissions where module in (''borrow'', ''edu_plans'')', '0');

-- ===== 035: sinh buổi dạy tự động cho mọi trường, ngày nghỉ áp ngay cho trường trực thuộc =====
select pg_temp.chk('admin_ph', 'Trường không gọi được hàm sinh hàng loạt', 'select generate_upcoming_sessions(7)::text', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không gọi được hàm chạy tay của nền tảng', 'select platform_generate_upcoming_sessions(7)::text', 'ERR');
select pg_temp.chk('admin_ph', 'Trường không gọi thẳng phần lõi sinh buổi dạy',
  format('select sync_teaching_sessions(%s, vn_today(), vn_today() + 7)::text', quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR');
select pg_temp.chk('kdi', 'Nền tảng chạy tay sinh buổi dạy: không trường nào lỗi', 'select platform_generate_upcoming_sessions(7)->>''failed''', '0');
select pg_temp.chk('admin_ph', 'Trường không đọc nhật ký việc chạy nền', 'select count(*) from system_job_runs', '0');
-- Hành vi (chạy bằng quyền hệ thống, dọn lại ngay): sinh 28 ngày → Sở khai báo nghỉ một ngày → tiết chưa điểm danh
-- của trường trực thuộc bị bỏ, tiết đã điểm danh giữ, trường không thuộc Sở không bị ảnh hưởng; xoá ngày nghỉ → tiết trở lại.
do $$
declare v_d date; v_before int; v_after int; v_back int; v_att uuid; v_other int; v_other_after int; v_other_code text;
  v_kept int; v_n int;
begin
  perform public.generate_upcoming_sessions(28);
  select min(s.session_date) into v_d from teaching_sessions s
   where s.org_id = pg_temp.oid_('THCS-PH') and s.session_date >= public.vn_today() + 7
     and (select count(*) from teaching_sessions t where t.org_id = s.org_id and t.session_date = s.session_date) >= 2;
  select count(*) into v_before from teaching_sessions where org_id = pg_temp.oid_('THCS-PH') and session_date = v_d;
  select s.id into v_att from teaching_sessions s join students st on st.class_id = s.class_id
   where s.org_id = pg_temp.oid_('THCS-PH') and s.session_date = v_d order by s.id limit 1;
  insert into lesson_attendance (session_id, student_id, status)
    select v_att, st.id, 'present' from students st where st.class_id = (select class_id from teaching_sessions where id = v_att) limit 1;
  select count(*), min(o.code) into v_other, v_other_code from teaching_sessions s join organizations o on o.id = s.org_id
   where o.code = 'THCS-KB' and s.session_date = v_d;
  insert into school_holidays (org_id, name, starts_on, ends_on) values (pg_temp.oid_('SO-HY'), 'iso-test nghỉ Sở', v_d, v_d);
  select count(*) into v_after from teaching_sessions where org_id = pg_temp.oid_('THCS-PH') and session_date = v_d;
  select count(*) into v_kept from teaching_sessions where id = v_att;
  select count(*) into v_other_after from teaching_sessions s join organizations o on o.id = s.org_id
   where o.code = 'THCS-KB' and s.session_date = v_d;
  delete from school_holidays where name = 'iso-test nghỉ Sở';
  select count(*) into v_back from teaching_sessions where org_id = pg_temp.oid_('THCS-PH') and session_date = v_d;
  delete from lesson_attendance where session_id = v_att;
  insert into t_result (who, name, expect, got, ok) values
    ('system', 'Sinh hàng loạt: có tiết ngày thường tuần tới', '>=2', coalesce(v_before, 0)::text, coalesce(v_before, 0) >= 2),
    ('system', 'Sở nghỉ: trường trực thuộc chỉ còn tiết đã điểm danh', '1', v_after::text, v_after = 1),
    ('system', 'Sở nghỉ: tiết đã điểm danh được giữ', '1', v_kept::text, v_kept = 1),
    ('system', 'Sở nghỉ: trường tỉnh khác không đổi', v_other::text, v_other_after::text, v_other = v_other_after),
    ('system', 'Xoá ngày nghỉ của Sở: tiết trở lại', v_before::text, v_back::text, v_back = v_before);
  select count(*) into v_n from system_job_runs where job = 'generate_upcoming_sessions' and ok;
  insert into t_result (who, name, expect, got, ok) values ('system', 'Lịch nền ghi nhật ký', '>0', v_n::text, v_n > 0);
end $$;

-- ===== 036: vị trí trường trên bản đồ =====
select pg_temp.chk('so_hy', 'Sở thấy vị trí trường trực thuộc', 'select count(*) from organizations where code = ''THCS-PH'' and lat is not null', '1');
select pg_temp.chk('so_bn', 'Sở tỉnh khác không thấy trường (kể cả vị trí)', 'select count(*) from organizations where code = ''THCS-PH''', '0');
select pg_temp.chk('so_hy', 'Sở đặt vị trí trường trực thuộc',
  format('select set_school_location(%s, 20.66, 106.05)::text', quote_literal(pg_temp.oid_('THCS-PH'))), '');
select pg_temp.chk('so_bn', 'Sở tỉnh khác không đặt vị trí trường',
  format('select set_school_location(%s, 20.66, 106.05)::text', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');
select pg_temp.chk('admin_ph', 'Quản trị trường đặt vị trí trường mình',
  format('select set_school_location(%s, 20.66, 106.05)::text', quote_literal(pg_temp.oid_('THCS-PH'))), '');
select pg_temp.chk('admin_ph', 'Quản trị trường không đặt vị trí trường khác',
  format('select set_school_location(%s, 20.66, 106.05)::text', quote_literal(pg_temp.oid_('THPT-CHY'))), 'ERR');
select pg_temp.chk('gv_both', 'Giáo viên không đặt vị trí trường',
  format('select set_school_location(%s, 20.66, 106.05)::text', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');
select pg_temp.chk('so_hy', 'Toạ độ ngoài Việt Nam bị từ chối',
  format('select set_school_location(%s, 48.85, 2.35)::text', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR*');
-- Sở cấp trên sửa được thông tin trường trực thuộc (thiết kế 018/019); Sở tỉnh khác và trường thì không sửa thẳng được.
select pg_temp.chk('so_bn', 'Sở tỉnh khác không sửa thẳng vị trí trường',
  'update organizations set lat = 20.7, lng = 106.1 where code = ''THCS-PH''', 'rows:0');
select pg_temp.chk('admin_ph', 'Trường không sửa thẳng dòng đơn vị (chỉ qua hàm)',
  'update organizations set lat = 20.7, lng = 106.1 where code = ''THCS-PH''', 'rows:0');

-- ===== 037: tài khoản đăng nhập bằng mã =====
do $$ declare v1 uuid := pg_temp.mk('hs_iso', 'THCS-PH', 'student'); v2 uuid := pg_temp.mk('hs_iso_mail', 'THCS-PH', 'student');
begin
  update profiles set login = 'thcsph.isohs1' where id = v1;
  insert into students (org_id, student_code, full_name, profile_id) values
    (pg_temp.oid_('THCS-PH'), 'ISO-HS1', 'ISO HS có TK mã', v1),
    (pg_temp.oid_('THCS-PH'), 'ISO-HS4', 'ISO HS có TK email', v2),
    (pg_temp.oid_('THCS-PH'), 'ISO-HS2', 'ISO HS chưa có TK', null),
    (pg_temp.oid_('THCS-PH'), null, 'ISO HS thiếu mã', null),
    (pg_temp.oid_('THCS-KB'), 'ISO-HS3', 'ISO HS trường khác', null);
  insert into teachers (org_id, full_name, email) values (pg_temp.oid_('THCS-PH'), 'ISO GV tài khoản mã', 'gvma@iso-test.local');
end $$;
create or replace function pg_temp.sid(p_name text) returns text language sql as $$
  select quote_literal(coalesce((select id::text from students where full_name = p_name), (select id::text from teachers where full_name = p_name)))
$$;
create or replace function pg_temp.prep(p_kind text, p_name text) returns text language sql as $$
  select format('select concat_ws(%L, status, login) from account_prepare(%L, array[%s]::uuid[])', ':', p_kind, pg_temp.sid(p_name))
$$;
select pg_temp.chk('admin_ph', 'TK mã: miền đăng nhập', 'select login_domain()', 'tk.kdi.edu.vn');
select pg_temp.chk('admin_ph', 'TK mã: HS có mã → tạo mới', pg_temp.prep('student', 'ISO HS chưa có TK'), 'new:thcsph.isohs2');
select pg_temp.chk('admin_ph', 'TK mã: HS đã có tài khoản', pg_temp.prep('student', 'ISO HS có TK mã'), 'has_account:thcsph.isohs1');
select pg_temp.chk('admin_ph', 'TK mã: HS thiếu mã', pg_temp.prep('student', 'ISO HS thiếu mã'), 'missing_code');
select pg_temp.chk('admin_ph', 'TK mã: HS trường khác không tạo được', pg_temp.prep('student', 'ISO HS trường khác'), 'not_found');
select pg_temp.chk('admin_ph', 'TK mã: GV đánh số', pg_temp.prep('teacher', 'ISO GV tài khoản mã'), 'new:thcsph.gv1');
select pg_temp.chk('gv_both', 'TK mã: giáo viên không tạo tài khoản', pg_temp.prep('student', 'ISO HS chưa có TK'), 'ERR');
select pg_temp.chk('so_hy', 'TK mã: Sở không tạo tài khoản cho HS trường', pg_temp.prep('student', 'ISO HS chưa có TK'), 'ERR');
select pg_temp.chk('hs_kb', 'TK mã: học sinh không gọi được', pg_temp.prep('student', 'ISO HS chưa có TK'), 'ERR');
select pg_temp.chk('admin_ph', 'TK mã: đặt lại mật khẩu HS trường mình',
  format('select (account_reset_target(''student'', %s) is not null)::text', pg_temp.sid('ISO HS có TK mã')), 'true');
select pg_temp.chk('admin_kb', 'TK mã: trường khác không đặt lại mật khẩu',
  format('select (account_reset_target(''student'', %s) is not null)::text', pg_temp.sid('ISO HS có TK mã')), 'ERR*');
select pg_temp.chk('gv_both', 'TK mã: giáo viên không đặt lại mật khẩu',
  format('select (account_reset_target(''student'', %s) is not null)::text', pg_temp.sid('ISO HS có TK mã')), 'ERR');
select pg_temp.chk('admin_ph', 'TK mã: không đặt lại tài khoản email thật',
  format('select (account_reset_target(''student'', %s) is not null)::text', pg_temp.sid('ISO HS có TK email')), 'ERR*');
select pg_temp.chk('admin_ph', 'TK mã: không đặt lại khi chưa có tài khoản',
  format('select (account_reset_target(''student'', %s) is not null)::text', pg_temp.sid('ISO HS chưa có TK')), 'ERR*');
select pg_temp.chk('admin_ph', 'TK mã: quản trị không tự sửa tên đăng nhập',
  'update profiles set login = ''thcsph.doi'' where login = ''thcsph.isohs1''', 'ERR');
select pg_temp.chk('hs_iso', 'TK mã: học sinh không tự sửa tên đăng nhập',
  'update profiles set login = ''thcsph.doi'' where id = auth.uid()', 'rows:0');
select pg_temp.chk('kdi', 'TK mã: quản trị nền tảng cũng không sửa tên đăng nhập qua API',
  'update profiles set login = ''thcsph.doi'' where login = ''thcsph.isohs1''', 'ERR');
select pg_temp.chk('kdi', 'TK mã: hàm tra tài khoản Auth chỉ dành cho máy chủ',
  'select count(*) from account_auth_user(''x@y.z'')', 'ERR');
-- Luồng đầy đủ: account_prepare ghi lời mời → hàm máy chủ tạo tài khoản đã xác nhận → tự gán trường, vai trò HS, liên kết hồ sơ
do $$ declare v_r text; v_uid uuid; v_linked boolean; v_role boolean;
begin
  v_r := pg_temp.probe('admin_ph@iso-test.local', format('select status from account_prepare(%L, array[%s]::uuid[])', 'student', pg_temp.sid('ISO HS chưa có TK')), true);
  insert into auth.users (email, raw_user_meta_data) values ('thcsph.isohs2@tk.kdi.edu.vn', '{"full_name":"ISO HS chưa có TK"}') returning id into v_uid;
  select profile_id = v_uid into v_linked from students where full_name = 'ISO HS chưa có TK';
  select exists (select 1 from memberships m join roles r on r.id = m.role_id
                  where m.user_id = v_uid and m.org_id = pg_temp.oid_('THCS-PH') and r.key = 'student') into v_role;
  insert into t_result (who, name, expect, got, ok) values
    ('system', 'TK mã: lời mời được ghi', 'new', v_r, v_r = 'new'),
    ('system', 'TK mã: tạo tài khoản → liên kết hồ sơ HS', 'true', coalesce(v_linked, false)::text, coalesce(v_linked, false)),
    ('system', 'TK mã: tạo tài khoản → vai trò HS tại trường', 'true', v_role::text, v_role);
end $$;

-- ===== 038: nhập toạ độ trường từ Excel =====
create or replace function pg_temp.loc(p_rows text, p_key text) returns text language sql as $$
  select format('select (import_school_locations(%L::jsonb)) ->> %L', p_rows, p_key)
$$;
select pg_temp.chk('so_hy', 'Toạ độ: Sở nhập cho trường trực thuộc',
  pg_temp.loc('[{"code":"THCS-PH","lat":"20.66","lng":"106.05","line":2}]', 'updated'), '1');
select pg_temp.chk('so_hy', 'Toạ độ: ô "vĩ độ, kinh độ" dán từ bản đồ',
  pg_temp.loc('[{"code":"THCS-PH","coord":"20.6560, 106.0560","line":2}]', 'updated'), '1');
select pg_temp.chk('so_hy', 'Toạ độ: dấu phẩy thập phân',
  pg_temp.loc('[{"code":"THCS-PH","lat":"20,66","lng":"106,05","line":2}]', 'updated'), '1');
select pg_temp.chk('so_hy', 'Toạ độ: đảo cột (ngoài Việt Nam) bị từ chối',
  pg_temp.loc('[{"code":"THCS-PH","lat":"106.05","lng":"20.66","line":2}]', 'updated'), '0');
select pg_temp.chk('so_hy', 'Toạ độ: dòng trống được bỏ qua',
  pg_temp.loc('[{"code":"THCS-PH","line":2}]', 'blank'), '1');
select pg_temp.chk('so_bn', 'Toạ độ: Sở tỉnh khác không nhập được',
  pg_temp.loc('[{"code":"THCS-PH","lat":"20.66","lng":"106.05","line":2}]', 'updated'), '0');
select pg_temp.chk('admin_ph', 'Toạ độ: trường không dùng nhập hàng loạt',
  pg_temp.loc('[{"code":"THCS-PH","lat":"20.66","lng":"106.05","line":2}]', 'updated'), 'ERR');
select pg_temp.chk('kdi', 'Toạ độ: quản trị nền tảng nhập mọi trường',
  pg_temp.loc('[{"code":"THCS-KB","lat":"21.18","lng":"106.07","line":2},{"code":"THCS-PH","lat":"20.66","lng":"106.05","line":3}]', 'updated'), '2');

-- ===== Dọn dẹp + kết quả =====
select pg_temp.cleanup();
select case when bool_and(ok) then 'PASS' else 'FAIL' end || ' ' || count(*) filter (where ok) || '/' || count(*) as "Tổng"
  from t_result;
select id, case when ok then 'PASS' else 'FAIL' end as kq, who, name, expect, got from t_result order by ok, id;
