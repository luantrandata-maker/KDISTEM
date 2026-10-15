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
begin
  delete from students where student_code like 'ISO-%' or org_id = any(v_orgs);
  if to_regclass('public.package_orders') is not null then
    delete from package_orders where org_id = any(v_orgs);
    delete from approval_workflows where org_id = any(v_orgs);
  end if;
  delete from education_plans where org_id = any(v_orgs) or teacher_id in (select id from teachers where email like '%@iso-test.local');
  delete from teachers where email like '%@iso-test.local' or org_id = any(v_orgs);
  delete from invitations where email like '%@iso-test.local' or org_id = any(v_orgs);
  delete from memberships where org_id = any(v_orgs);
  delete from roles where key like 'custom_iso_%';
  delete from organizations where code in ('ISO-TRUONG', 'ISO-SCH', 'ISO-NEW');
  delete from organizations where code = 'ISO-SO';
  delete from organizations where code = 'ISO-TINH';
  delete from auth.users where email like '%@iso-test.local';
  if to_regclass('public.audit_log') is not null then
    delete from audit_log where id > coalesce((select audit_start from t_meta), 0)
      and (summary ~ '(Thử [a-z_]+|iso-test\.local|thử ISO|ISO-[A-Z]+|thử \(thử\)|Tổ trưởng \(thử\))' or (actor is null and summary like '%tài khoản đã xoá%'));
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

-- ===== Dọn dẹp + kết quả =====
select pg_temp.cleanup();
select case when bool_and(ok) then 'PASS' else 'FAIL' end || ' ' || count(*) filter (where ok) || '/' || count(*) as "Tổng"
  from t_result;
select id, case when ok then 'PASS' else 'FAIL' end as kq, who, name, expect, got from t_result order by ok, id;
