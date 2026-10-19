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
  if to_regclass('public.rubrics') is not null then delete from rubrics where title like 'ISO %'; end if;
  if to_regclass('public.competitions') is not null then
    delete from invitations where judge_id in (select j.id from competition_judges j join competitions c on c.id = j.competition_id where c.title like 'ISO%');
    delete from competitions where title like 'ISO%';
    delete from approval_requests where ref_table = 'student_projects' and title like 'ISO%';
    delete from student_projects where title like 'ISO%';
  end if;
  if to_regclass('public.events') is not null then delete from notifications where title like 'Sự kiện mới: ISO%'; delete from events where title like 'ISO%'; end if;
  if to_regclass('public.question_bank') is not null then
    delete from notifications where kind = 'elearning' and (title like '%ISO%');
    delete from courses where title like 'ISO%';
    delete from practice_exams where title like 'ISO%';
    delete from question_bank where subject like 'ISO%';
  end if;
  if to_regclass('public.ai_usage') is not null then
    delete from ai_usage where user_id = any(v_users);
    delete from ai_org_limits where note = 'ISO';
    update ai_settings set enabled = false, user_daily_quota = 30 where id = 1;
    if exists (select 1 from information_schema.columns where table_name = 'ai_settings' and column_name = 'help_all_roles') then
      execute $x$update ai_settings set help_all_roles = true where id = 1$x$;
    end if;
    if exists (select 1 from information_schema.columns where table_name = 'ai_settings' and column_name = 'provider') then
      execute $x$update ai_settings set provider = 'anthropic', model = 'claude-sonnet-5-5', fallback_provider = null, fallback_model = null where id = 1$x$;
    end if;
  end if;
  if to_regclass('public.stem_index_configs') is not null then delete from stem_index_configs where name like 'ISO%'; end if;
  if to_regclass('public.guardians') is not null then
    delete from invitations where guardian_id in (select id from guardians where full_name like 'ISO%');
    delete from lesson_attendance where note = 'ISO vắng';
    delete from student_consents where note = 'Phụ huynh xác nhận trên hệ thống' and recorded_by = any(v_users);
    delete from guardians where full_name like 'ISO%';
  end if;
  if to_regclass('public.org_branding') is not null then delete from org_branding where display_name like 'ISO%' or 'stem.iso-test.vn' = any(domains); end if;
  if to_regclass('public.data_exports') is not null then delete from data_exports where note like 'ISO%'; end if;
  if to_regclass('public.stock_transfers') is not null then
    perform set_config('app.stock_engine', 'on', true);
    delete from approval_requests where ref_table in ('supply_requests', 'stock_transfers') and title like 'ISO %';
    delete from stock_transfers where title like 'ISO %';
    delete from supply_requests where title like 'ISO %';
    perform set_config('app.stock_engine', 'off', true);
  end if;
  if to_regclass('public.supplies') is not null then delete from stocktakes where name like 'ISO KK%'; delete from supplies where name like 'ISO %'; end if;
  if to_regclass('public.surveys') is not null then delete from surveys where title like 'ISO KS%'; end if;
  if to_regclass('public.teacher_assessments') is not null then
    delete from teacher_assessments where teacher_id in (select id from teachers where email like '%@iso-test.local');
  end if;
  if to_regclass('public.dept_targets') is not null then
    delete from dept_targets where note like 'ISO %';
    delete from dept_alert_actions where note like 'ISO %';
    delete from notifications where title like 'ISO nhắc%';
  end if;
  if to_regclass('public.legal_documents') is not null then
    delete from student_consents where guardian_name like 'ISO P%';
    delete from legal_acceptances where document_id in (select id from legal_documents where title like 'ISO %');
    alter table legal_documents disable trigger legal_documents_guard;
    delete from legal_documents where title like 'ISO %';
    alter table legal_documents enable trigger legal_documents_guard;
    update security_settings set require_student_consent = false where id = 1 and require_student_consent;
  end if;
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
      and (entity = 'role_permissions' or summary ~ '(ISO tự học|ISO nghỉ|thcsph\.iso|ISO-HS|ISO HS|ISO GV|Thử [a-z_]+|iso-test\.local|thử ISO|ISO-[A-Z]+|thử \(thử\)|Tổ trưởng \(thử\))' or (actor is null and summary like '%tài khoản đã xoá%'));
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

-- ===== 039: điều khoản, đồng ý của cha mẹ, xuất/xoá dữ liệu học sinh =====
insert into legal_documents (kind, version, title, body, published_at) values ('terms', 9001, 'ISO điều khoản', 'Nội dung thử', now());
insert into students (org_id, student_code, full_name) values (pg_temp.oid_('THCS-PH'), 'ISO-HS5', 'ISO HS cần đồng ý');
insert into student_consents (org_id, student_id, guardian_name, relation, phone)
  select org_id, id, 'ISO Phụ huynh', 'Mẹ', '0900000000' from students where full_name = 'ISO HS có TK mã';
select pg_temp.chk('admin_ph', 'Điều khoản: người dùng thấy bản cần chấp thuận', 'select count(*) from legal_pending() where title = ''ISO điều khoản''', '1');
select pg_temp.chk('admin_ph', 'Điều khoản: chấp thuận', 'select legal_accept(array(select id from legal_pending() where title = ''ISO điều khoản''))', '1');
select pg_temp.chk('admin_ph', 'Điều khoản: trường không soạn điều khoản',
  'insert into legal_documents (kind, version, title, body) values (''privacy'', 9002, ''ISO x'', ''x'')', 'ERR');
select pg_temp.chk('kdi', 'Điều khoản: KDI soạn bản nháp',
  'insert into legal_documents (kind, version, title, body) values (''privacy'', 9002, ''ISO chính sách'', ''x'')', 'rows:1');
select pg_temp.chk('kdi', 'Điều khoản: bản đã công bố không sửa được',
  'update legal_documents set body = ''sửa'' where title = ''ISO điều khoản''', 'ERR');
select pg_temp.chk('admin_ph', 'Đồng ý: trường xem đồng ý của HS mình', 'select count(*) from student_consents where guardian_name = ''ISO Phụ huynh''', '1');
select pg_temp.chk('admin_ph', 'Đồng ý: trường ghi nhận đồng ý',
  format('insert into student_consents (org_id, student_id, guardian_name) values (%s, %s, ''ISO PH2'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.sid('ISO HS chưa có TK')), 'rows:1');
select pg_temp.chk('admin_kb', 'Đồng ý: trường khác không ghi được',
  format('insert into student_consents (org_id, student_id, guardian_name) values (%s, %s, ''ISO PH2'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.sid('ISO HS chưa có TK')), 'ERR');
select pg_temp.chk('admin_kb', 'Đồng ý: không gắn HS trường khác vào đơn vị mình',
  format('insert into student_consents (org_id, student_id, guardian_name) values (%s, %s, ''ISO PH2'')', quote_literal(pg_temp.oid_('THCS-KB')), pg_temp.sid('ISO HS chưa có TK')), 'ERR');
select pg_temp.chk('so_hy', 'Đồng ý: Sở không xem SĐT phụ huynh', 'select count(*) from student_consents where guardian_name = ''ISO Phụ huynh''', '0');
select pg_temp.chk('so_hy', 'Đồng ý: Sở xem tổng hợp trường trực thuộc',
  format('select consented >= 1 from consent_summary() where school_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), 'true');
select pg_temp.chk('so_bn', 'Đồng ý: Sở tỉnh khác không xem tổng hợp',
  format('select count(*) from consent_summary() where school_id = %s', quote_literal(pg_temp.oid_('THCS-PH'))), '0');
update security_settings set require_student_consent = true where id = 1;
select pg_temp.chk('admin_ph', 'Đồng ý bắt buộc: HS chưa có đồng ý không tạo được tài khoản', pg_temp.prep('student', 'ISO HS cần đồng ý'), 'no_consent');
update security_settings set require_student_consent = false where id = 1;
select pg_temp.chk('admin_ph', 'Xuất dữ liệu HS trường mình',
  format('select student_data_export(%s) -> ''hoc_sinh'' ->> ''full_name''', pg_temp.sid('ISO HS có TK mã')), 'ISO HS có TK mã');
select pg_temp.chk('admin_kb', 'Xuất dữ liệu: trường khác không xuất được',
  format('select student_data_export(%s)::text', pg_temp.sid('ISO HS có TK mã')), 'ERR*');
select pg_temp.chk('gv_both', 'Xuất dữ liệu: giáo viên không xuất được',
  format('select student_data_export(%s)::text', pg_temp.sid('ISO HS có TK mã')), 'ERR');
select pg_temp.chk('gv_both', 'Xoá dữ liệu: giáo viên không xoá được',
  format('select student_erase(%s, ''thử'')::text', pg_temp.sid('ISO HS có TK mã')), 'ERR');
select pg_temp.chk('admin_ph', 'Xoá dữ liệu: phải ghi lý do',
  format('select student_erase(%s, '''')::text', pg_temp.sid('ISO HS có TK mã')), 'ERR*');
do $$ declare v_id uuid := (select id from students where full_name = 'ISO HS có TK mã'); v_pid uuid := (select profile_id from students where full_name = 'ISO HS có TK mã');
  v_r text; v_name text; v_login text; v_locked boolean; v_mem int; v_cons int;
begin
  v_r := pg_temp.probe('admin_ph@iso-test.local', format('select (student_erase(%L, %L) = %L)::text', v_id, 'Phụ huynh yêu cầu (thử)', v_pid), true);
  select full_name into v_name from students where id = v_id;
  select login, locked_at is not null into v_login, v_locked from profiles where id = v_pid;
  select count(*) into v_mem from memberships where user_id = v_pid;
  select count(*) into v_cons from student_consents where student_id = v_id;
  insert into t_result (who, name, expect, got, ok) values
    ('system', 'Xoá dữ liệu: trả về tài khoản cần xoá trong Auth', 'true', v_r, v_r = 'true'),
    ('system', 'Xoá dữ liệu: tên HS được ẩn danh', 'Học sinh đã xoá dữ liệu', v_name, v_name = 'Học sinh đã xoá dữ liệu'),
    ('system', 'Xoá dữ liệu: tài khoản bị khoá, bỏ tên đăng nhập', 'locked', coalesce(v_login, 'null') || '/' || v_locked, v_login is null and v_locked),
    ('system', 'Xoá dữ liệu: bỏ vai trò tại trường, xoá đồng ý', '0/0', v_mem || '/' || v_cons, v_mem = 0 and v_cons = 0);
  delete from students where id = v_id;
end $$;

-- ===== 040: chỉ tiêu và cảnh báo của Sở =====
insert into dept_targets (org_id, school_year, metric, target, note) values (pg_temp.oid_('SO-HY'), '2026-2027', 'stem_coverage', 80, 'ISO chỉ tiêu');
select pg_temp.chk('so_hy', 'Chỉ tiêu: Sở giao chỉ tiêu',
  format('insert into dept_targets (org_id, school_year, metric, level, target) values (%s, ''2026-2027'', ''teacher_trained'', ''thcs'', 90)', quote_literal(pg_temp.oid_('SO-HY'))), 'rows:1');
select pg_temp.chk('so_hy', 'Chỉ tiêu: Sở không giao thay Sở khác',
  format('insert into dept_targets (org_id, school_year, metric, target) values (%s, ''2026-2027'', ''teacher_trained'', 90)', quote_literal(pg_temp.oid_('SO-BN'))), 'ERR');
select pg_temp.chk('admin_ph', 'Chỉ tiêu: trường xem chỉ tiêu Sở giao', 'select count(*) from dept_targets where note = ''ISO chỉ tiêu''', '1');
select pg_temp.chk('admin_kb', 'Chỉ tiêu: trường tỉnh khác không xem', 'select count(*) from dept_targets where note = ''ISO chỉ tiêu''', '0');
select pg_temp.chk('so_bn', 'Chỉ tiêu: Sở khác không xem', 'select count(*) from dept_targets where note = ''ISO chỉ tiêu''', '0');
select pg_temp.chk('admin_ph', 'Chỉ tiêu: trường không sửa chỉ tiêu', 'update dept_targets set target = 10 where note = ''ISO chỉ tiêu''', 'rows:0');
select pg_temp.chk('so_hy', 'Cảnh báo: Sở ghi nhận xử lý trường trực thuộc',
  format('insert into dept_alert_actions (org_id, school_id, rule, status, note) values (%s, %s, ''no_stem'', ''acknowledged'', ''ISO xử lý'')', quote_literal(pg_temp.oid_('SO-HY')), quote_literal(pg_temp.oid_('THCS-PH'))), 'rows:1');
select pg_temp.chk('so_bn', 'Cảnh báo: Sở tỉnh khác không ghi nhận',
  format('insert into dept_alert_actions (org_id, school_id, rule, status, note) values (%s, %s, ''no_stem'', ''acknowledged'', ''ISO xử lý'')', quote_literal(pg_temp.oid_('SO-BN')), quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');
select pg_temp.chk('so_hy', 'Cảnh báo: Sở gửi nhắc quản trị trường',
  format('select dept_notify_school(%s, ''ISO nhắc'', ''thử'') > 0', quote_literal(pg_temp.oid_('THCS-PH'))), 'true');
select pg_temp.chk('so_bn', 'Cảnh báo: Sở tỉnh khác không gửi nhắc',
  format('select dept_notify_school(%s, ''ISO nhắc'', ''thử'')', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR');
select pg_temp.chk('admin_ph', 'Cảnh báo: trường không gửi nhắc trường khác',
  format('select dept_notify_school(%s, ''ISO nhắc'', ''thử'')', quote_literal(pg_temp.oid_('THPT-CHY'))), 'ERR');

-- ===== 041: chấm theo tiêu chí (rubric) =====
insert into rubrics (org_id, title, criteria) values (pg_temp.oid_('THCS-PH'), 'ISO tiêu chí trường',
  '[{"name":"A","points":1,"levels":["1","2","3","4"]}]');
select pg_temp.chk('admin_ph', 'Rubric: thấy mẫu hệ thống', 'select count(*) >= 3 from rubrics where org_id is null', 'true');
select pg_temp.chk('admin_ph', 'Rubric: thấy mẫu của trường', 'select count(*) from rubrics where title = ''ISO tiêu chí trường''', '1');
select pg_temp.chk('admin_kb', 'Rubric: trường khác không thấy mẫu của trường', 'select count(*) from rubrics where title = ''ISO tiêu chí trường''', '0');
select pg_temp.chk('admin_ph', 'Rubric: trường không sửa mẫu hệ thống', 'update rubrics set title = title where org_id is null', 'rows:0');
select pg_temp.chk('admin_ph', 'Rubric: tiêu chí sai cấu trúc bị từ chối',
  format('insert into rubrics (org_id, title, criteria) values (%s, ''ISO sai'', ''[{"name":"A","points":1,"levels":["1"]}]'')', quote_literal(pg_temp.oid_('THCS-PH'))), 'ERR*');
select pg_temp.chk('admin_ph', 'Rubric: tính điểm theo mức', $q$select rubric_score('{"criteria":[{"name":"A","points":3,"levels":["","","",""]},{"name":"B","points":1,"levels":["","","",""]}]}', '[4,2]', 10)::text$q$, '8.75');
do $$ declare v_a uuid; v_s uuid; v_old_r jsonb; v_old jsonb; v_max numeric; v_hi numeric; v_lo numeric; v_st text; v_sum int; v_r text; v_r2 text;
begin
  select a.id, a.rubric, a.max_score into v_a, v_old_r, v_max from assignments a join organizations o on o.id = a.org_id
   where o.code = 'THCS-PH' and exists (select 1 from submissions s where s.assignment_id = a.id and s.student_id is not null) order by a.created_at limit 1;
  if v_a is null then return; end if;
  select id, to_jsonb(s) into v_s, v_old from submissions s where assignment_id = v_a and student_id is not null order by id limit 1;
  update assignments set rubric = jsonb_build_object('title', r.title, 'criteria', r.criteria) from rubrics r
   where assignments.id = v_a and r.org_id is null and r.title = 'Sản phẩm STEM (quy trình thiết kế kỹ thuật)';
  update submissions set rubric_scores = '[4,4,4,4,4]' where id = v_s;  select score, status into v_hi, v_st from submissions where id = v_s;
  update submissions set rubric_scores = '[1,1,1,1,1]' where id = v_s;  select score into v_lo from submissions where id = v_s;
  v_sum := pg_temp.probe('admin_ph@iso-test.local', format('select count(*) from rubric_class_summary(%L) where l1 = 1', v_a))::int;
  v_r := pg_temp.probe('so_hy@iso-test.local', format('select count(*) from rubric_class_summary(%L)', v_a));
  v_r2 := pg_temp.probe('so_bn@iso-test.local', format('select count(*) from rubric_class_summary(%L)', v_a));
  update assignments set rubric = v_old_r where id = v_a;
  update submissions set rubric_scores = null, score = (v_old->>'score')::numeric, status = v_old->>'status',
         graded_at = (v_old->>'graded_at')::timestamptz where id = v_s;
  insert into t_result (who, name, expect, got, ok) values
    ('system', 'Rubric: mức 4 mọi tiêu chí = điểm tối đa', v_max::text, v_hi::text, v_hi = v_max),
    ('system', 'Rubric: mức 1 mọi tiêu chí = 1/4 thang điểm', (v_max / 4)::text, v_lo::text, v_lo = round(v_max / 4 * 4) / 4),
    ('system', 'Rubric: chấm theo mức → trạng thái đã chấm', 'graded', v_st, v_st = 'graded'),
    ('system', 'Rubric: tổng hợp theo tiêu chí', '5', v_sum::text, v_sum = 5),
    ('so_hy', 'Rubric: Sở xem tổng hợp bài của trường trực thuộc', '5', v_r, v_r = '5'),
    ('so_bn', 'Rubric: Sở tỉnh khác không xem tổng hợp', 'ERR 42501', v_r2, v_r2 = 'ERR 42501');
end $$;

-- ===== 042: đánh giá năng lực =====
update profiles set org_id = pg_temp.oid_('THCS-PH') where email = 'gv_both@iso-test.local';   -- trước đó đã chuyển sang trường B
create or replace function pg_temp.tid(p_name text) returns text language sql as $$ select quote_literal(id) from teachers where full_name = p_name $$;
insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels, status, comment)
  select org_id, id, '2026-2027', 'self', '{"gv_thiet_ke":3,"gv_to_chuc":2}', 'submitted', 'ISO tự đánh giá' from teachers where full_name = 'GV thử A';
select pg_temp.chk('admin_ph', 'Năng lực: khung HS 7 / GV 5', 'select (select count(*) from competencies where audience = ''student'') || ''/'' || (select count(*) from competencies where audience = ''teacher'')', '7/5');
select pg_temp.chk('gv_both', 'Năng lực GV: tự đánh giá của mình',
  format('insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels) values (%s, %s, ''2025-2026'', ''self'', ''{"gv_thiet_ke":2}'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.tid('GV thử A')), 'rows:1');
select pg_temp.chk('gv_both', 'Năng lực GV: không tự đánh giá thay người khác',
  format('insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels) values (%s, %s, ''2025-2026'', ''self'', ''{}'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.tid('ISO GV tài khoản mã')), 'ERR');
select pg_temp.chk('gv_both', 'Năng lực GV: GV không ghi đánh giá của quản lý',
  format('insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels) values (%s, %s, ''2025-2026'', ''manager'', ''{}'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.tid('GV thử A')), 'ERR');
select pg_temp.chk('gv_both', 'Năng lực GV: bản đã nộp không tự sửa được',
  'update teacher_assessments set levels = ''{"gv_thiet_ke":4}'' where comment = ''ISO tự đánh giá''', 'ERR');
select pg_temp.chk('gv_both', 'Năng lực GV: mức ngoài 1–4 bị từ chối',
  format('insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels) values (%s, %s, ''2024-2025'', ''self'', ''{"gv_thiet_ke":5}'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.tid('GV thử A')), 'ERR*');
select pg_temp.chk('admin_ph', 'Năng lực GV: quản trị trường đánh giá GV',
  format('insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels, status) values (%s, %s, ''2026-2027'', ''manager'', ''{"gv_thiet_ke":3}'', ''submitted'')', quote_literal(pg_temp.oid_('THCS-PH')), pg_temp.tid('GV thử A')), 'rows:1');
select pg_temp.chk('admin_kb', 'Năng lực GV: trường khác không xem', 'select count(*) from teacher_assessments where comment = ''ISO tự đánh giá''', '0');
select pg_temp.chk('so_hy', 'Năng lực GV: Sở cấp trên xem', 'select count(*) from teacher_assessments where comment = ''ISO tự đánh giá''', '1');
select pg_temp.chk('gv_both', 'Năng lực GV: xem minh chứng của mình', format('select (teacher_evidence(%s) ? ''certificates'')::text', pg_temp.tid('GV thử A')), 'true');
select pg_temp.chk('admin_kb', 'Năng lực GV: trường khác không xem minh chứng', format('select teacher_evidence(%s)::text', pg_temp.tid('GV thử A')), 'ERR');
do $$ declare v_a uuid; v_s uuid; v_stu uuid; v_cls uuid; v_old_r jsonb; v_old jsonb; v_r1 text; v_r2 text; v_r3 text; v_r4 text; v_r5 text;
begin
  select a.id, a.rubric into v_a, v_old_r from assignments a join organizations o on o.id = a.org_id
   where o.code = 'THCS-PH' and exists (select 1 from submissions s where s.assignment_id = a.id and s.student_id is not null) order by a.created_at limit 1;
  if v_a is null then return; end if;
  select s.id, s.student_id, to_jsonb(s) into v_s, v_stu, v_old from submissions s where assignment_id = v_a and student_id is not null order by id limit 1;
  select class_id into v_cls from students where id = v_stu;
  update assignments set rubric = jsonb_build_object('title', r.title, 'criteria', r.criteria) from rubrics r
   where assignments.id = v_a and r.org_id is null and r.title = 'Sản phẩm STEM (quy trình thiết kế kỹ thuật)';
  update submissions set rubric_scores = '[4,3,3,2,4]' where id = v_s;
  v_r1 := pg_temp.probe('admin_ph@iso-test.local', format('select evidences || ''/'' || avg_level from student_competencies(%L) where competency = ''gqvd''', v_stu));
  v_r2 := pg_temp.probe('admin_kb@iso-test.local', format('select count(*) from student_competencies(%L)', v_stu));
  v_r3 := pg_temp.probe('so_hy@iso-test.local', format('select count(*) from student_competencies(%L) where evidences > 0', v_stu));
  v_r4 := pg_temp.probe('admin_ph@iso-test.local', format('select count(*) > 0 from class_competencies(%L) where student_id = %L', v_cls, v_stu));
  v_r5 := pg_temp.probe('so_bn@iso-test.local', format('select count(*) from class_competencies(%L)', v_cls));
  update assignments set rubric = v_old_r where id = v_a;
  update submissions set rubric_scores = null, score = (v_old->>'score')::numeric, status = v_old->>'status',
         graded_at = (v_old->>'graded_at')::timestamptz where id = v_s;
  insert into t_result (who, name, expect, got, ok) values
    ('admin_ph', 'Năng lực HS: 2 tiêu chí GQVĐ, mức TB 3', '2/3.00', v_r1, v_r1 = '2/3.00'),
    ('admin_kb', 'Năng lực HS: trường khác không xem', 'ERR 42501', v_r2, v_r2 = 'ERR 42501'),
    ('so_hy', 'Năng lực HS: Sở cấp trên xem (4 năng lực có bằng chứng)', '4', v_r3, v_r3 = '4'),
    ('admin_ph', 'Năng lực lớp: có HS vừa chấm', 'true', v_r4, v_r4 = 'true'),
    ('so_bn', 'Năng lực lớp: Sở tỉnh khác không xem', 'ERR 42501', v_r5, v_r5 = 'ERR 42501');
end $$;

-- ===== 043: khảo sát =====
insert into surveys (org_id, title, audience, status, anonymous, questions) values (pg_temp.oid_('SO-HY'), 'ISO KS giáo viên', 'teacher', 'open', false,
  '[{"id":"q1","type":"single","text":"Đã dạy STEM chưa?","options":["Rồi","Chưa"],"required":true},{"id":"q2","type":"scale","text":"Mức hài lòng"},{"id":"q3","type":"text","text":"Góp ý"}]');
select pg_temp.chk('gv_both', 'Khảo sát: GV trường trực thuộc thấy khảo sát của Sở', 'select count(*) from my_surveys() where title = ''ISO KS giáo viên''', '1');
select pg_temp.chk('hs_kb', 'Khảo sát: HS tỉnh khác không thấy', 'select count(*) from my_surveys() where title = ''ISO KS giáo viên''', '0');
select pg_temp.chk('admin_kb', 'Khảo sát: trường tỉnh khác không thấy', 'select count(*) from surveys where title = ''ISO KS giáo viên''', '0');
select pg_temp.chk('gv_both', 'Khảo sát: GV gửi câu trả lời',
  $q$select (survey_submit((select id from surveys where title = 'ISO KS giáo viên'), '{"q1":0,"q2":4,"q3":"Cần thêm thiết bị"}') is not null)::text$q$, 'true');
select pg_temp.chk('gv_both', 'Khảo sát: thiếu câu bắt buộc bị từ chối',
  $q$select survey_submit((select id from surveys where title = 'ISO KS giáo viên'), '{"q2":4}')::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Khảo sát: lựa chọn ngoài danh sách bị từ chối',
  $q$select survey_submit((select id from surveys where title = 'ISO KS giáo viên'), '{"q1":7}')::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Khảo sát: không ghi thẳng vào bảng câu trả lời',
  $q$insert into survey_responses (survey_id, respondent, answers) values ((select id from surveys where title = 'ISO KS giáo viên'), auth.uid(), '{}')$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Khảo sát: trường tạo khảo sát của mình',
  format('insert into surveys (org_id, title, audience) values (%s, ''ISO KS trường'', ''student'')', quote_literal(pg_temp.oid_('THCS-PH'))), 'rows:1');
select pg_temp.chk('admin_ph', 'Khảo sát: trường không tạo thay Sở',
  format('insert into surveys (org_id, title, audience) values (%s, ''ISO KS x'', ''student'')', quote_literal(pg_temp.oid_('SO-HY'))), 'ERR');
do $$ declare v_r text; v_n text; v_bn text; v_ph text; v_edit text; v_other text; v_id uuid := (select id from surveys where title = 'ISO KS giáo viên');
begin
  v_r := pg_temp.probe('gv_both@iso-test.local', $q$select survey_submit((select id from surveys where title = 'ISO KS giáo viên'), '{"q1":1,"q2":5,"q3":"Ý kiến thử"}')::text$q$, true);
  v_n := pg_temp.probe('so_hy@iso-test.local', $q$select (survey_results((select id from surveys where title = 'ISO KS giáo viên')) ->> 'responses') || '/' || (survey_results((select id from surveys where title = 'ISO KS giáo viên')) #>> '{questions,0,counts,1}')$q$);
  v_bn := pg_temp.probe('so_bn@iso-test.local', format('select survey_results(%L)::text', v_id));
  v_ph := pg_temp.probe('admin_ph@iso-test.local', format('select survey_results(%L)::text', v_id));
  v_edit := pg_temp.probe('so_hy@iso-test.local', $q$update surveys set questions = '[{"id":"q1","type":"text","text":"Đổi"}]' where title = 'ISO KS giáo viên'$q$);
  v_other := pg_temp.probe('admin_ph@iso-test.local', 'select count(*) from survey_responses');
  insert into t_result (who, name, expect, got, ok) values
    ('so_hy', 'Khảo sát: Sở xem kết quả tổng hợp (1 phiếu, chọn "Chưa")', '1/1', v_n, v_n = '1/1'),
    ('so_bn', 'Khảo sát: Sở tỉnh khác không xem kết quả', 'ERR 42501', v_bn, v_bn = 'ERR 42501'),
    ('admin_ph', 'Khảo sát: trường không xem kết quả khảo sát của Sở', 'ERR 42501', v_ph, v_ph = 'ERR 42501'),
    ('so_hy', 'Khảo sát: đã có người trả lời thì không sửa câu hỏi', 'ERR 22023', v_edit, v_edit = 'ERR 22023'),
    ('admin_ph', 'Khảo sát: không đọc câu trả lời của người khác', '0', v_other, v_other = '0');
end $$;

-- ===== 044: kho vật tư & kiểm kê =====
insert into supplies (org_id, name, unit, min_qty) values (pg_temp.oid_('THCS-PH'), 'ISO Pin AA', 'viên', 5);
insert into supply_moves (org_id, supply_id, kind, qty, reason) select org_id, id, 'in', 10, 'ISO nhập' from supplies where name = 'ISO Pin AA';
select pg_temp.chk('admin_ph', 'Kho: nhập 10 → tồn 10', 'select qty::text from supplies where name = ''ISO Pin AA''', '10.00');
select pg_temp.chk('admin_ph', 'Kho: xuất cấp phát',
  $q$insert into supply_moves (org_id, supply_id, kind, qty, reason) select org_id, id, 'out', 3, 'ISO cấp' from supplies where name = 'ISO Pin AA'$q$, 'rows:1');
select pg_temp.chk('admin_ph', 'Kho: không xuất quá tồn',
  $q$insert into supply_moves (org_id, supply_id, kind, qty, reason) select org_id, id, 'out', 100, 'ISO cấp' from supplies where name = 'ISO Pin AA'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Kho: sửa thẳng tồn kho bị bỏ qua',
  $q$with u as (update supplies set qty = 999 where name = 'ISO Pin AA' returning qty) select qty::text from u$q$, '10.00');
select pg_temp.chk('admin_ph', 'Kho: phiếu đã lập không sửa được', $q$update supply_moves set qty = 1 where reason = 'ISO nhập'$q$, 'rows:0');
select pg_temp.chk('gv_both', 'Kho: GV không lập phiếu',
  $q$insert into supply_moves (org_id, supply_id, kind, qty) select org_id, id, 'in', 1 from supplies where name = 'ISO Pin AA'$q$, 'ERR*');
select pg_temp.chk('admin_kb', 'Kho: trường khác không thấy', 'select count(*) from supplies where name = ''ISO Pin AA''', '0');
select pg_temp.chk('so_hy', 'Kho: Sở cấp trên xem được', 'select count(*) from supplies where name = ''ISO Pin AA''', '1');
select pg_temp.chk('admin_kb', 'Kho: không ghi phiếu vào vật tư trường khác',
  format('insert into supply_moves (org_id, supply_id, kind, qty) values (my_org_id(), %L, ''in'', 1)', (select id from supplies where name = 'ISO Pin AA')), 'ERR*');
select pg_temp.chk('gv_both', 'Kiểm kê: GV không mở đợt', 'select stocktake_start(''ISO KK'')::text', 'ERR');
do $$ declare v_room uuid; v_unit uuid; v_serial text; v_n int; v_st uuid; v_r text; v_a text; v_b text; v_c text; v_d text; v_e text; v_qty numeric;
begin
  select r.id into v_room from stem_rooms r join organizations o on o.id = r.org_id
   where o.code = 'THCS-PH' and (select count(*) from equipment_units u where u.room_id = r.id) >= 2 order by r.name limit 1;
  if v_room is null then return; end if;
  create temp table t_units on commit drop as select id, status, room_id from equipment_units where room_id = v_room;
  select count(*) into v_n from t_units;
  select u.id, u.serial into v_unit, v_serial from equipment_units u where u.room_id = v_room and u.serial is not null order by u.serial limit 1;
  v_r := pg_temp.probe('admin_ph@iso-test.local', format('select stocktake_start(%L, %L, false)::text', 'ISO KK phòng', v_room), true);
  select id into v_st from stocktakes where name = 'ISO KK phòng';
  v_a := pg_temp.probe('admin_ph@iso-test.local', format('select count(*) from stocktake_scan(%L, %L)', v_st, v_serial), true);
  v_b := pg_temp.probe('gv_both@iso-test.local', format('select count(*) from stocktake_scan(%L, %L)', v_st, v_serial));
  v_c := pg_temp.probe('admin_ph@iso-test.local', format('select stocktake_approve(%L)::text', v_st));
  perform pg_temp.probe('admin_ph@iso-test.local', format('update stocktakes set status = %L where id = %L', 'submitted', v_st), true);
  v_d := pg_temp.probe('admin_ph@iso-test.local', format('update stocktake_items set result = %L where stocktake_id = %L', 'ok', v_st));
  v_e := pg_temp.probe('admin_ph@iso-test.local', format('select (stocktake_approve(%L) ->> %L)', v_st, 'lost'), true);
  insert into t_result (who, name, expect, got, ok) values
    ('admin_ph', 'Kiểm kê: mở đợt theo phòng', 'uuid', v_r, v_r ~ '^[0-9a-f-]{36}$'),
    ('admin_ph', 'Kiểm kê: quét serial → đánh dấu có', '1', v_a, v_a = '1'),
    ('gv_both', 'Kiểm kê: GV không quét', 'ERR 42501', v_b, v_b = 'ERR 42501'),
    ('admin_ph', 'Kiểm kê: chưa nộp thì chưa duyệt được', 'ERR 22023', v_c, v_c = 'ERR 22023'),
    ('admin_ph', 'Kiểm kê: nộp rồi không sửa kết quả', 'ERR 42501', v_d, v_d = 'ERR 42501'),
    ('admin_ph', 'Kiểm kê: duyệt → thiết bị không thấy thành Thất lạc', (v_n - 1)::text, v_e, v_e = (v_n - 1)::text),
    ('system', 'Kiểm kê: thiết bị đã quét vẫn dùng được', 'không lost', (select status from equipment_units where id = v_unit), (select status from equipment_units where id = v_unit) <> 'lost');
  update equipment_units u set status = t.status, room_id = t.room_id from t_units t where u.id = t.id;
  delete from equipment_events where note = 'ISO KK phòng' or title like 'Kiểm kê:%' and note = 'ISO KK phòng';
  delete from stocktakes where id = v_st;
end $$;

-- ===== 045: đề xuất mua vật tư & vận chuyển =====
select pg_temp.chk('admin_ph', 'Đề xuất vật tư: lập nháp',
  $q$insert into supply_requests (org_id, title) values (my_org_id(), 'ISO ĐX vật tư')$q$, 'rows:1');
insert into supply_requests (org_id, title, created_by) values (pg_temp.oid_('THCS-PH'), 'ISO ĐX vật tư', (select id from profiles where email = 'admin_ph@iso-test.local'));
select pg_temp.chk('admin_ph', 'Đề xuất vật tư: thêm dòng vật tư có sẵn',
  $q$insert into supply_request_lines (request_id, org_id, supply_id, name, unit, qty) select r.id, r.org_id, s.id, s.name, s.unit, 4 from supply_requests r, supplies s where r.title = 'ISO ĐX vật tư' and s.name = 'ISO Pin AA'$q$, 'rows:1');
insert into supply_request_lines (request_id, org_id, supply_id, name, unit, qty, est_price)
  select r.id, r.org_id, s.id, s.name, s.unit, 4, 5000 from supply_requests r, supplies s where r.title = 'ISO ĐX vật tư' and s.name = 'ISO Pin AA';
insert into supply_request_lines (request_id, org_id, name, unit, qty) select id, org_id, 'ISO Keo nến', 'thanh', 20 from supply_requests where title = 'ISO ĐX vật tư';
select pg_temp.chk('admin_kb', 'Đề xuất vật tư: trường khác không thấy', 'select count(*) from supply_requests where title = ''ISO ĐX vật tư''', '0');
insert into supply_requests (org_id, title) values (pg_temp.oid_('THCS-KB'), 'ISO ĐX trường B');
select pg_temp.chk('admin_kb', 'Đề xuất vật tư: không gắn vật tư trường khác',
  format('insert into supply_request_lines (request_id, org_id, supply_id, name, qty) values (%L, my_org_id(), %L, ''x'', 1)',
    (select id from supply_requests where title = 'ISO ĐX trường B'), (select id from supplies where name = 'ISO Pin AA')), 'ERR*');
select pg_temp.chk('admin_ph', 'Đề xuất vật tư: chưa duyệt thì chưa nhận hàng',
  $q$select supply_request_receive(id)::text from supply_requests where title = 'ISO ĐX vật tư'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Đề xuất vật tư: không tự đổi sang Đã duyệt',
  $q$update supply_requests set status = 'approved' where title = 'ISO ĐX vật tư'$q$, 'ERR*');
do $$ declare v_rq uuid; a text; b text; c text; d text; e text; f text; g text;
begin
  select id into v_rq from supply_requests where title = 'ISO ĐX vật tư';
  a := pg_temp.probe('admin_ph@iso-test.local', format('update supply_requests set status = %L where id = %L', 'pending', v_rq), true);
  b := (select count(*)::text from approval_requests where ref_table = 'supply_requests' and ref_id = v_rq and status = 'pending' and kind = 'supply_purchase');
  c := pg_temp.probe('admin_ph@iso-test.local', format('update supply_request_lines set qty = 99 where request_id = %L', v_rq));
  d := pg_temp.probe('gv_both@iso-test.local', format('select approval_decide_ref(%L, %L, %L)::text', 'supply_requests', v_rq, 'approve'));
  e := pg_temp.probe('admin_ph@iso-test.local', format('select approval_decide_ref(%L, %L, %L) ->> %L', 'supply_requests', v_rq, 'approve', 'status'), true);
  f := pg_temp.probe('admin_ph@iso-test.local', format('select supply_request_receive(%L, %L::jsonb)::text', v_rq,
         (select jsonb_build_array(jsonb_build_object('id', id, 'qty', 3))::text from supply_request_lines where request_id = v_rq and name = 'ISO Pin AA')), true);
  g := pg_temp.probe('admin_ph@iso-test.local', format('select supply_request_receive(%L)::text', v_rq));
  insert into t_result (who, name, expect, got, ok) values
    ('admin_ph', 'Đề xuất vật tư: gửi duyệt', 'rows:1', a, a = 'rows:1'),
    ('system', 'Đề xuất vật tư: tạo hồ sơ phê duyệt', '1', b, b = '1'),
    ('admin_ph', 'Đề xuất vật tư: đã gửi thì không sửa dòng', 'ERR 22023', c, c = 'ERR 22023'),
    ('gv_both', 'Đề xuất vật tư: GV không duyệt', 'ERR 42501', d, d = 'ERR 42501'),
    ('admin_ph', 'Đề xuất vật tư: quản trị duyệt', 'approved', e, e = 'approved'),
    ('admin_ph', 'Đề xuất vật tư: nhận hàng → 2 phiếu nhập', '2', f, f = '2'),
    ('admin_ph', 'Đề xuất vật tư: không nhận hai lần', 'ERR 22023', g, g = 'ERR 22023'),
    ('system', 'Đề xuất vật tư: tồn tăng theo số thực nhận', '13.00', (select qty::text from supplies where name = 'ISO Pin AA'), (select qty from supplies where name = 'ISO Pin AA') = 13),
    ('system', 'Đề xuất vật tư: vật tư mới vào danh mục', '20.00', (select qty::text from supplies where name = 'ISO Keo nến' and org_id = pg_temp.oid_('THCS-PH')),
       (select qty from supplies where name = 'ISO Keo nến' and org_id = pg_temp.oid_('THCS-PH')) = 20);
end $$;

update organizations set status = 'active' where code = 'ISO-SCH';
select pg_temp.chk('admin_ph', 'Vận chuyển: không gửi sang trường tỉnh khác',
  format('insert into stock_transfers (org_id, to_org, title) values (my_org_id(), %L, ''ISO VC sai'')', pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('admin_ph', 'Vận chuyển: danh sách nơi nhận có trường cùng Sở, không có trường tỉnh khác',
  format('select (count(*) filter (where id = %L))::text || (count(*) filter (where id = %L))::text from stock_targets()', pg_temp.oid_('ISO-SCH'), pg_temp.oid_('THCS-KB')), '10');
do $$ declare v_tr uuid; v_unit uuid; v_type uuid; v_room uuid; v_st text; a text; b text; c text; d text; e text; f text; g text; h text; v_new_types uuid[];
begin
  if pg_temp.oid_('ISO-SCH') is null then return; end if;
  select u.id, u.type_id, u.room_id, u.status into v_unit, v_type, v_room, v_st from equipment_units u
   where u.org_id = pg_temp.oid_('THCS-PH') and u.status not in ('lost', 'in_transit') order by u.serial nulls last limit 1;
  update organizations set status = 'active' where id = pg_temp.oid_('ISO-SCH');
  insert into stock_transfers (org_id, to_org, title, created_by) values (pg_temp.oid_('THCS-PH'), pg_temp.oid_('ISO-SCH'), 'ISO VC', (select id from profiles where email = 'admin_ph@iso-test.local'))
    returning id into v_tr;
  a := pg_temp.probe('admin_ph@iso-test.local', format('insert into stock_transfer_items (transfer_id, org_id, supply_id, qty) select %L, org_id, id, 5 from supplies where name = %L and org_id = my_org_id()', v_tr, 'ISO Pin AA'), true);
  if v_unit is not null then
    perform pg_temp.probe('admin_ph@iso-test.local', format('insert into stock_transfer_items (transfer_id, org_id, unit_id) values (%L, my_org_id(), %L)', v_tr, v_unit), true);
  end if;
  b := pg_temp.probe('admin_iso@iso-test.local', format('select count(*) from stock_transfers where id = %L', v_tr));
  perform pg_temp.probe('admin_ph@iso-test.local', format('update stock_transfers set status = %L where id = %L', 'pending', v_tr), true);
  perform pg_temp.probe('admin_ph@iso-test.local', format('select approval_decide_ref(%L, %L, %L)::text', 'stock_transfers', v_tr, 'approve'), true);
  c := pg_temp.probe('admin_iso@iso-test.local', format('select stock_transfer_ship(%L)::text', v_tr));
  d := pg_temp.probe('admin_ph@iso-test.local', format('select stock_transfer_ship(%L)::text', v_tr), true);
  e := pg_temp.probe('admin_ph@iso-test.local', format('select stock_transfer_receive(%L)::text', v_tr));
  f := pg_temp.probe('admin_iso@iso-test.local', format('select stock_transfer_receive(%L, %L::jsonb) ->> %L', v_tr,
         (select jsonb_build_array(jsonb_build_object('id', id, 'qty', 4))::text from stock_transfer_items where transfer_id = v_tr and supply_id is not null), 'short'), true);
  g := pg_temp.probe('admin_kb@iso-test.local', format('select count(*) from stock_transfers where id = %L', v_tr));
  h := pg_temp.probe('admin_iso@iso-test.local', 'select qty::text from supplies where name = ''ISO Pin AA''');
  insert into t_result (who, name, expect, got, ok) values
    ('admin_ph', 'Vận chuyển: thêm dòng vật tư', 'rows:1', a, a = 'rows:1'),
    ('admin_iso', 'Vận chuyển: đơn vị nhận thấy phiếu', '1', b, b = '1'),
    ('admin_iso', 'Vận chuyển: đơn vị nhận không xuất hàng thay', 'ERR 42501', c, c = 'ERR 42501'),
    ('admin_ph', 'Vận chuyển: xuất hàng sau khi duyệt', case when v_unit is null then '1' else '2' end, d, d = case when v_unit is null then '1' else '2' end),
    ('system', 'Vận chuyển: xuất → trừ kho bên xuất', '8.00', (select qty::text from supplies where name = 'ISO Pin AA' and org_id = pg_temp.oid_('THCS-PH')),
       (select qty from supplies where name = 'ISO Pin AA' and org_id = pg_temp.oid_('THCS-PH')) = 8),
    ('admin_ph', 'Vận chuyển: bên xuất không tự xác nhận nhận', 'ERR 42501', e, e = 'ERR 42501'),
    ('admin_iso', 'Vận chuyển: bên nhận xác nhận, ghi thiếu 1 dòng', '1', f, f = '1'),
    ('admin_kb', 'Vận chuyển: trường tỉnh khác không thấy', '0', g, g = '0'),
    ('admin_iso', 'Vận chuyển: kho bên nhận cộng số thực nhận', '4.00', h, h = '4.00');
  if v_unit is not null then
    insert into t_result (who, name, expect, got, ok) values
      ('system', 'Vận chuyển: thiết bị sang đơn vị nhận, vào kho', 'in_stock@ISO-SCH',
       (select status || '@' || (select code from organizations where id = org_id) from equipment_units where id = v_unit),
       (select org_id = pg_temp.oid_('ISO-SCH') and status = 'in_stock' and (select org_id from equipment_types where id = type_id) = pg_temp.oid_('ISO-SCH') from equipment_units where id = v_unit));
    -- trả thiết bị về như cũ
    v_new_types := array(select type_id from equipment_units where id = v_unit);
    update equipment_units set org_id = pg_temp.oid_('THCS-PH'), type_id = v_type, room_id = v_room, status = v_st where id = v_unit;
    delete from equipment_events where unit_id = v_unit and note = 'ISO VC';
    delete from equipment_types t where t.id = any(v_new_types) and t.org_id = pg_temp.oid_('ISO-SCH') and not exists (select 1 from equipment_units u where u.type_id = t.id);
  end if;
end $$;

-- ===== 046: nghiệm thu & doanh thu, xuất dữ liệu =====
insert into service_plans (code, name, modules) values ('ISO-P46', 'Gói thử ISO 46', '{}') on conflict (code) do nothing;
insert into contracts (code, org_id, plan_id, starts_on, ends_on, value, status, created_by)
  select 'ISO-HD46', pg_temp.oid_('THCS-PH'), id, current_date - 200, current_date + 165, 100000000, 'draft', null from service_plans where code = 'ISO-P46';
do $$ declare a text; b text; v_c uuid := (select id from contracts where code = 'ISO-HD46'); v_kdi text := 'kdi@iso-test.local';
begin
  if pg_temp.oid_('@platform') is null then return; end if;
  update security_settings set enforce_mfa_db = false where id = 1;   -- phần 2FA đã kiểm ở trên
  a := pg_temp.probe(v_kdi, format($q$insert into contract_milestones (contract_id, seq, name, due_on, amount, status) values (%L, 1, 'Đợt 1', current_date - 30, 40000000, 'paid')$q$, v_c), true);
  b := pg_temp.probe(v_kdi, format($q$insert into contract_milestones (contract_id, seq, name, due_on, amount, status) values (%L, 2, 'Đợt 2', current_date - 5, 60000000, 'accepted')$q$, v_c), true);
  insert into t_result (who, name, expect, got, ok) values
    ('kdi', 'Nghiệm thu: KDI lập đợt đã thu', 'rows:1', a, a = 'rows:1'),
    ('kdi', 'Nghiệm thu: KDI lập đợt đã nghiệm thu', 'rows:1', b, b = 'rows:1'),
    ('system', 'Nghiệm thu: đã thu tự điền số tiền, ngày', '40000000', (select paid_amount::text || case when paid_on is null then ' (thiếu ngày)' else '' end from contract_milestones where contract_id = v_c and seq = 1),
       (select paid_amount = 40000000 and paid_on is not null and accepted_on is not null from contract_milestones where contract_id = v_c and seq = 1));
end $$;
select pg_temp.chk('kdi', 'Doanh thu: tổng hợp đã thu / còn phải thu / quá hạn',
  $q$select paid::text || '|' || outstanding::text || '|' || overdue::text from revenue_overview() where code = 'ISO-HD46'$q$, '40000000|60000000|1');
select pg_temp.chk('admin_ph', 'Nghiệm thu: khách hàng xem tiến độ hợp đồng của mình', $q$select count(*) from contract_milestones m join contracts c on c.id = m.contract_id where c.code = 'ISO-HD46'$q$, '2');
select pg_temp.chk('admin_ph', 'Nghiệm thu: khách hàng không tự sửa', $q$update contract_milestones set status = 'paid' where name = 'Đợt 2'$q$, 'rows:0');
select pg_temp.chk('admin_kb', 'Nghiệm thu: khách hàng khác không thấy', $q$select count(*) from contract_milestones m join contracts c on c.id = m.contract_id where c.code = 'ISO-HD46'$q$, '0');
select pg_temp.chk('gv_both', 'Nghiệm thu: giáo viên không thấy', $q$select count(*) from contract_milestones m join contracts c on c.id = m.contract_id where c.code = 'ISO-HD46'$q$, '0');
select pg_temp.chk('admin_ph', 'Doanh thu: trường không xem tổng hợp', 'select count(*) from revenue_overview()', 'ERR');
do $$ declare r text := pg_temp.probe('admin_ph@iso-test.local', $q$select (log_data_export(my_org_id(), 'xlsx', '{teachers}', 12, 'ISO xuất') is not null)::text$q$, true);
begin insert into t_result (who, name, expect, got, ok) values ('admin_ph', 'Xuất dữ liệu: quản trị trường ghi nhật ký', 'true', r, r = 'true'); end $$;
select pg_temp.chk('admin_ph', 'Xuất dữ liệu: không ghi cho trường khác',
  format('select log_data_export(%L, ''json'', ''{}'', 1, ''ISO x'')::text', pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('gv_both', 'Xuất dữ liệu: giáo viên không xuất', $q$select log_data_export(my_org_id(), 'json', '{}', 1, 'ISO x')::text$q$, 'ERR');
select pg_temp.chk('so_hy', 'Xuất dữ liệu: Sở xem nhật ký trường trực thuộc', $q$select count(*) from data_exports where note = 'ISO xuất'$q$, '1');
select pg_temp.chk('admin_kb', 'Xuất dữ liệu: trường khác không xem nhật ký', $q$select count(*) from data_exports where note = 'ISO xuất'$q$, '0');
select pg_temp.chk('admin_ph', 'Sao lưu: trường không xem tình trạng CSDL', 'select backup_overview()::text', 'ERR');

-- ===== 047: giao diện & thương hiệu =====
update security_settings set enforce_mfa_db = false where id = 1;
select pg_temp.chk('admin_ph', 'Thương hiệu: trường không tự tạo',
  $q$insert into org_branding (org_id, display_name) values (my_org_id(), 'ISO tự tạo')$q$, 'ERR*');
do $$ declare r text;
begin
  if pg_temp.oid_('@platform') is null then return; end if;
  r := pg_temp.probe('kdi@iso-test.local', format($q$insert into org_branding (org_id, display_name, primary_color, domains, applies_to_children) values (%L, 'ISO STEM Hưng Yên', '#0b5d3b', '{STEM.iso-test.vn}', true)$q$, pg_temp.oid_('SO-HY')), true);
  insert into t_result (who, name, expect, got, ok) values ('kdi', 'Thương hiệu: KDI đặt cho Sở (áp dụng trường trực thuộc)', 'rows:1', r, r = 'rows:1');
end $$;
select pg_temp.chk('admin_ph', 'Thương hiệu: trường trực thuộc nhận thương hiệu của Sở', $q$select my_branding() ->> 'display_name'$q$, 'ISO STEM Hưng Yên');
select pg_temp.chk('admin_kb', 'Thương hiệu: trường tỉnh khác không nhận', $q$select coalesce(my_branding() ->> 'display_name', 'mặc định')$q$, 'mặc định');
select pg_temp.chk('admin_kb', 'Thương hiệu: trường tỉnh khác không đọc bảng', $q$select count(*) from org_branding where display_name like 'ISO%'$q$, '0');
select pg_temp.chk('hs_kb', 'Thương hiệu: trang đăng nhập theo tên miền (chữ hoa/thường)', $q$select login_branding('stem.ISO-test.vn') ->> 'display_name'$q$, 'ISO STEM Hưng Yên');
select pg_temp.chk('so_hy', 'Thương hiệu: Sở chưa được bật tự sửa', $q$update org_branding set display_name = 'ISO Sở tự sửa' where display_name like 'ISO%'$q$, 'rows:0');
update org_branding set self_edit = true where display_name = 'ISO STEM Hưng Yên';
select pg_temp.chk('so_hy', 'Thương hiệu: Sở tự sửa khi được bật', $q$update org_branding set display_name = 'ISO Sở tự sửa', primary_color = '#123456' where display_name like 'ISO%'$q$, 'rows:1');
select pg_temp.chk('so_hy', 'Thương hiệu: Sở không tự đổi tên miền', $q$update org_branding set domains = '{khac.iso-test.vn}' where display_name like 'ISO%'$q$, 'ERR');
select pg_temp.chk('so_hy', 'Thương hiệu: màu sai định dạng bị từ chối', $q$update org_branding set primary_color = 'red' where display_name like 'ISO%'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Thương hiệu: trường trực thuộc không sửa thương hiệu Sở', $q$update org_branding set display_name = 'ISO trường sửa' where display_name like 'ISO%'$q$, 'rows:0');
select pg_temp.chk('kdi', 'Thương hiệu: tên miền không gắn cho hai đơn vị',
  format($q$insert into org_branding (org_id, display_name, domains) values (%L, 'ISO trùng', '{stem.iso-test.vn}')$q$, pg_temp.oid_('SO-BN')), 'ERR*');

-- ===== 048: cổng phụ huynh =====
do $$ declare v_par uuid; v_kid uuid; v_other uuid; v_third uuid;
begin
  v_par := pg_temp.mk('ph_ph', 'THCS-PH', 'parent');
  select id into v_kid from students where org_id = pg_temp.oid_('THCS-PH') and class_id is not null and coalesce(status, 'studying') <> 'erased' order by student_code limit 1;
  select id into v_other from students where org_id = pg_temp.oid_('THCS-PH') and id <> v_kid order by student_code limit 1;
  select id into v_third from students where org_id = pg_temp.oid_('THCS-PH') and id not in (v_kid, v_other) order by student_code limit 1;
  insert into guardians (student_id, full_name, relation, phone, profile_id) values (v_kid, 'ISO Mẹ A', 'mother', '0912 000 111', v_par);
  insert into guardians (student_id, full_name, relation, phone) values (v_other, 'ISO Bố B', 'father', '0912000222');
  insert into guardians (student_id, full_name, relation, phone) values (v_third, 'ISO Mẹ B', 'mother', '0912-000-222');   -- anh/chị/em: cùng SĐT
end $$;
select pg_temp.chk('ph_ph', 'Phụ huynh: không phải nhân sự', 'select is_staff()::text', 'false');
select pg_temp.chk('ph_ph', 'Phụ huynh: không đọc bảng học sinh', 'select count(*) from students', '0');
select pg_temp.chk('ph_ph', 'Phụ huynh: không đọc giáo viên', 'select count(*) from teachers', '0');
select pg_temp.chk('ph_ph', 'Phụ huynh: thấy đúng 1 con', 'select count(*) from parent_children()', '1');
select pg_temp.chk('ph_ph', 'Phụ huynh: xem tổng hợp của con',
  $q$select (parent_child((select student_id from parent_children() limit 1)) -> 'student' ->> 'id') = (select student_id::text from parent_children() limit 1)$q$, 'true');
select pg_temp.chk('ph_ph', 'Phụ huynh: không xem học sinh khác',
  format('select parent_child(%L)::text', (select student_id from guardians where full_name = 'ISO Bố B')), 'ERR');
select pg_temp.chk('ph_ph', 'Phụ huynh: chỉ thấy dòng phụ huynh của mình', $q$select count(*) from guardians$q$, '1');
select pg_temp.chk('ph_ph', 'Phụ huynh: xem năng lực của con', $q$select count(*) from student_competencies((select student_id from parent_children() limit 1))$q$, '>0');
select pg_temp.chk('ph_ph', 'Phụ huynh: không xem năng lực học sinh khác',
  format('select count(*) from student_competencies(%L)', (select student_id from guardians where full_name = 'ISO Bố B')), 'ERR');
select pg_temp.chk('ph_ph', 'Phụ huynh: không tự thêm con', format($q$insert into guardians (student_id, full_name) values (%L, 'ISO tự thêm')$q$, (select student_id from guardians where full_name = 'ISO Bố B')), 'ERR');
select pg_temp.chk('admin_ph', 'Phụ huynh: trường thêm phụ huynh cho HS của mình',
  format($q$insert into guardians (student_id, full_name, phone) values (%L, 'ISO Ông C', '0912000333')$q$, (select student_id from guardians where full_name = 'ISO Bố B')), 'rows:1');
select pg_temp.chk('admin_kb', 'Phụ huynh: trường khác không thêm cho HS trường này',
  format($q$insert into guardians (student_id, full_name) values (%L, 'ISO lạ')$q$, (select student_id from guardians where full_name = 'ISO Bố B')), 'ERR');
select pg_temp.chk('admin_kb', 'Phụ huynh: trường khác không xem', $q$select count(*) from guardians where full_name like 'ISO%'$q$, '0');
select pg_temp.chk('so_hy', 'Phụ huynh: Sở không xem SĐT phụ huynh', $q$select count(*) from guardians where full_name like 'ISO%'$q$, '0');
select pg_temp.chk('admin_ph', 'Phụ huynh: trường không tự gắn tài khoản',
  $q$with u as (update guardians set profile_id = auth.uid() where full_name = 'ISO Bố B' returning profile_id) select coalesce(profile_id::text, 'null') from u$q$, 'null');
select pg_temp.chk('admin_ph', 'Tài khoản phụ huynh: tên đăng nhập theo SĐT, cùng SĐT chỉ một tài khoản',
  $q$select string_agg(coalesce(login, '-') || ':' || status, ',' order by status) from account_prepare('parent', array(select id from guardians where full_name in ('ISO Bố B', 'ISO Mẹ B')))$q$,
  'thcsph.ph0912000222:new,-:same_phone');
do $$ declare r text;
begin
  r := pg_temp.probe('ph_ph@iso-test.local', $q$select parent_consent((select student_id from parent_children() limit 1), true, '{learning,photo}')::text$q$, true);
  insert into t_result (who, name, expect, got, ok) values ('system', 'Phụ huynh: đồng ý lưu dạng trực tuyến', 'online',
    (select string_agg(method, ',') from student_consents c join guardians g on g.student_id = c.student_id where g.full_name = 'ISO Mẹ A' and c.withdrawn_on is null),
    (select string_agg(method, ',') from student_consents c join guardians g on g.student_id = c.student_id where g.full_name = 'ISO Mẹ A' and c.withdrawn_on is null) = 'online');
end $$;
do $$ declare v_kid uuid := (select student_id from guardians where full_name = 'ISO Mẹ A'); v_ses uuid; n int;
begin
  select ts.id into v_ses from teaching_sessions ts join students s on s.class_id = ts.class_id
   where s.id = v_kid and ts.session_date = current_date and not exists (select 1 from lesson_attendance la where la.session_id = ts.id and la.student_id = v_kid) limit 1;
  if v_ses is null then
    select ts.id into v_ses from teaching_sessions ts join students s on s.class_id = ts.class_id where s.id = v_kid
      and not exists (select 1 from lesson_attendance la where la.session_id = ts.id and la.student_id = v_kid) order by abs(ts.session_date - current_date) limit 1;
    if v_ses is null then return; end if;
    update teaching_sessions set session_date = session_date where id = v_ses;  -- giữ nguyên
  end if;
  insert into lesson_attendance (session_id, student_id, org_id, status, note)
    select v_ses, v_kid, s.org_id, 'absent', 'ISO vắng' from students s where s.id = v_kid;
  select count(*) into n from notifications where user_id = (select id from profiles where email = 'ph_ph@iso-test.local') and page = 'Chuyên cần của con';
  insert into t_result (who, name, expect, got, ok) values ('system', 'Phụ huynh: nhận thông báo khi con vắng (buổi gần đây)',
    case when (select session_date from teaching_sessions where id = v_ses) >= current_date - 1 then '1' else '0' end, n::text,
    n = case when (select session_date from teaching_sessions where id = v_ses) >= current_date - 1 then 1 else 0 end);
end $$;
insert into surveys (org_id, title, audience, status, questions) values (pg_temp.oid_('THCS-PH'), 'ISO KS phụ huynh', 'parent', 'open', '[{"id":"q1","type":"scale","text":"Hài lòng?","required":true}]');
select pg_temp.chk('ph_ph', 'Khảo sát phụ huynh: phụ huynh thấy', $q$select count(*) from my_surveys() where title = 'ISO KS phụ huynh'$q$, '1');
select pg_temp.chk('gv_both', 'Khảo sát phụ huynh: giáo viên không thấy', $q$select count(*) from my_surveys() where title = 'ISO KS phụ huynh'$q$, '0');
select pg_temp.chk('ph_ph', 'Khảo sát phụ huynh: phụ huynh trả lời', $q$select (survey_submit((select id from surveys where title = 'ISO KS phụ huynh'), '{"q1":4}') is not null)::text$q$, 'true');

-- ===== 049: chỉ số STEM =====
select pg_temp.chk('so_hy', 'Bộ chỉ số: Sở đặt bộ chỉ số của mình',
  $q$insert into stem_index_configs (org_id, name, indicators, level3, level2) values (my_org_id(), 'ISO Bộ chỉ số HY', '{"nhan_luc":{"on":true,"weight":30}}', 75, 55)$q$, 'rows:1');
insert into stem_index_configs (org_id, name, indicators) select pg_temp.oid_('SO-HY'), 'ISO Bộ chỉ số HY', '{"nhan_luc":{"on":true,"weight":30}}' where not exists (select 1 from stem_index_configs where org_id = pg_temp.oid_('SO-HY'));
select pg_temp.chk('admin_ph', 'Bộ chỉ số: trường trực thuộc dùng bộ của Sở', $q$select stem_index_config() ->> 'name'$q$, 'ISO Bộ chỉ số HY');
select pg_temp.chk('admin_kb', 'Bộ chỉ số: trường tỉnh khác không dùng bộ của Sở HY', $q$select coalesce(stem_index_config() ->> 'name', 'mặc định') <> 'ISO Bộ chỉ số HY'$q$, 'true');
select pg_temp.chk('so_bn', 'Bộ chỉ số: Sở khác không đọc', $q$select count(*) from stem_index_configs where name like 'ISO%'$q$, '0');
select pg_temp.chk('admin_ph', 'Bộ chỉ số: trường không sửa bộ của Sở', $q$update stem_index_configs set level3 = 90 where name like 'ISO%'$q$, 'rows:0');
select pg_temp.chk('admin_ph', 'Bộ chỉ số: trường không tự đặt bộ chỉ số', $q$insert into stem_index_configs (org_id, name) values (my_org_id(), 'ISO trường')$q$, 'ERR');
select pg_temp.chk('so_hy', 'Bộ chỉ số: trọng số ngoài 0–100 bị từ chối', $q$update stem_index_configs set indicators = '{"nhan_luc":{"weight":500}}' where name like 'ISO%'$q$, 'ERR*');
select pg_temp.chk('so_hy', 'Bộ chỉ số: ngưỡng Mức 2 phải thấp hơn Mức 3', $q$update stem_index_configs set level2 = 80, level3 = 70 where name like 'ISO%'$q$, 'ERR*');

-- ===== 050: sự kiện =====
select pg_temp.chk('admin_ph', 'Sự kiện: trường tạo và công bố',
  $q$insert into events (org_id, title, kind, starts_at, audience, registration, capacity, status) values (my_org_id(), 'ISO Ngày hội STEM', 'festival', now() + interval '7 days', '{student,parent}', true, 50, 'published')$q$, 'rows:1');
insert into events (org_id, title, kind, starts_at, audience, registration, status)
  select pg_temp.oid_('THCS-PH'), 'ISO Ngày hội STEM', 'festival', now() + interval '7 days', '{student,parent}', true, 'published' where not exists (select 1 from events where title = 'ISO Ngày hội STEM');
insert into events (org_id, title, kind, starts_at, audience, include_children, status)
  values (pg_temp.oid_('SO-HY'), 'ISO Hội thảo GV STEM toàn tỉnh', 'workshop', now() + interval '10 days', '{teacher,staff}', true, 'published');
select pg_temp.chk('admin_ph', 'Sự kiện: trường không tạo thay Sở',
  format($q$insert into events (org_id, title, starts_at) values (%L, 'ISO thay Sở', now())$q$, pg_temp.oid_('SO-HY')), 'ERR');
select pg_temp.chk('admin_kb', 'Sự kiện: trường tỉnh khác không thấy', $q$select count(*) from events where title like 'ISO%'$q$, '0');
select pg_temp.chk('ph_ph', 'Sự kiện: phụ huynh thấy sự kiện của trường', $q$select count(*) from my_events() where title = 'ISO Ngày hội STEM'$q$, '1');
select pg_temp.chk('ph_ph', 'Sự kiện: phụ huynh nhận thông báo khi công bố', $q$select count(*) from notifications where title = 'Sự kiện mới: ISO Ngày hội STEM'$q$, '1');
select pg_temp.chk('gv_both', 'Sự kiện: GV không thấy sự kiện chỉ dành cho HS / phụ huynh', $q$select count(*) from my_events() where title = 'ISO Ngày hội STEM'$q$, '0');
select pg_temp.chk('gv_both', 'Sự kiện: GV trường trực thuộc thấy hội thảo của Sở', $q$select count(*) from my_events() where title = 'ISO Hội thảo GV STEM toàn tỉnh'$q$, '1');
select pg_temp.chk('ph_ph', 'Sự kiện: phụ huynh không thấy hội thảo GV', $q$select count(*) from my_events() where title = 'ISO Hội thảo GV STEM toàn tỉnh'$q$, '0');
select pg_temp.probe('ph_ph@iso-test.local', $q$select event_register((select id from events where title = 'ISO Ngày hội STEM'), (select student_id from parent_children() limit 1))::text$q$, true);
select pg_temp.chk('ph_ph', 'Sự kiện: phụ huynh đăng ký cho con (đăng ký lại không nhân đôi)',
  $q$select (event_register((select id from events where title = 'ISO Ngày hội STEM'), (select student_id from parent_children() limit 1)) is not null)::text || '|' || (select count(*) from event_registrations)$q$, 'true|1');
select pg_temp.chk('ph_ph', 'Sự kiện: không đăng ký cho học sinh khác',
  format($q$select event_register((select id from events where title = 'ISO Ngày hội STEM'), %L)::text$q$, (select student_id from guardians where full_name = 'ISO Bố B')), 'ERR');
select pg_temp.chk('admin_ph', 'Sự kiện: ban tổ chức xem danh sách đăng ký', $q$select count(*) from event_registrations r join events e on e.id = r.event_id where e.title = 'ISO Ngày hội STEM'$q$, '1');
select pg_temp.chk('admin_ph', 'Sự kiện: ban tổ chức điểm danh', $q$update event_registrations set status = 'attended' where event_id = (select id from events where title = 'ISO Ngày hội STEM')$q$, 'rows:1');
select pg_temp.chk('admin_kb', 'Sự kiện: trường khác không xem đăng ký', $q$select count(*) from event_registrations$q$, '0');
update events set reg_deadline = now() - interval '1 hour' where title = 'ISO Ngày hội STEM';
select pg_temp.chk('ph_ph', 'Sự kiện: hết hạn đăng ký', $q$select event_register((select id from events where title = 'ISO Ngày hội STEM'), (select student_id from parent_children() limit 1))::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Sự kiện: GV đăng ký hội thảo không cần đăng ký thì báo lỗi', $q$select event_register((select id from events where title = 'ISO Hội thảo GV STEM toàn tỉnh'))::text$q$, 'ERR*');

-- ===== 051: dự án STEM & cuộc thi =====
select pg_temp.chk('gv_both', 'Dự án: GV tạo dự án cho trường',
  $q$insert into student_projects (org_id, title, field, mentor_teacher_id, abstract) values (my_org_id(), 'ISO Dự án máy lọc nước', 'Rô bốt và máy thông minh', my_teacher_id(), 'Máy lọc nước dùng năng lượng mặt trời cho vùng lũ.')$q$, 'rows:1');
insert into student_projects (org_id, title, field, mentor_teacher_id, abstract)
  select pg_temp.oid_('THCS-PH'), 'ISO Dự án máy lọc nước', 'Rô bốt và máy thông minh', (select id from teachers where full_name = 'GV thử A'), 'Máy lọc nước dùng năng lượng mặt trời cho vùng lũ.'
   where not exists (select 1 from student_projects where title = 'ISO Dự án máy lọc nước');
select pg_temp.chk('admin_ph', 'Dự án: thêm thành viên là HS của trường',
  $q$insert into project_members (project_id, student_id, role) select p.id, g.student_id, 'leader' from student_projects p, guardians g where p.title = 'ISO Dự án máy lọc nước' and g.full_name = 'ISO Mẹ A'$q$, 'rows:1');
insert into project_members (project_id, student_id) select p.id, g.student_id from student_projects p, guardians g where p.title = 'ISO Dự án máy lọc nước' and g.full_name = 'ISO Mẹ A' on conflict do nothing;
insert into project_members (project_id, student_id) select p.id, g.student_id from student_projects p, guardians g where p.title = 'ISO Dự án máy lọc nước' and g.full_name = 'ISO Bố B' on conflict do nothing;
select pg_temp.chk('admin_kb', 'Dự án: không thêm HS trường khác',
  $q$insert into project_members (project_id, student_id) select p.id, s.id from student_projects p, students s where p.title = 'ISO Dự án máy lọc nước' and s.org_id = my_org_id() limit 1$q$, 'rows:0');
select pg_temp.chk('admin_kb', 'Dự án: trường tỉnh khác không thấy', $q$select count(*) from student_projects where title like 'ISO%'$q$, '0');
select pg_temp.chk('ph_ph', 'Dự án: phụ huynh thấy dự án của con', $q$select count(*) from student_projects where title = 'ISO Dự án máy lọc nước'$q$, '1');
select pg_temp.chk('ph_ph', 'Dự án: phụ huynh không sửa', $q$update student_projects set title = 'ISO sửa' where title = 'ISO Dự án máy lọc nước'$q$, 'rows:0');
select pg_temp.chk('so_hy', 'Dự án: Sở thấy dự án trường trực thuộc', $q$select count(*) from student_projects where title = 'ISO Dự án máy lọc nước'$q$, '1');
select pg_temp.probe('gv_both@iso-test.local', $q$update student_projects set status = 'pending' where title = 'ISO Dự án máy lọc nước'$q$, true);
do $$ declare r text;
begin
  insert into t_result (who, name, expect, got, ok) select 'system', 'Dự án: gửi duyệt tạo hồ sơ phê duyệt', '1', count(*)::text, count(*) = 1
    from approval_requests where ref_table = 'student_projects' and kind = 'project' and status = 'pending' and title = 'ISO Dự án máy lọc nước';
  r := pg_temp.probe('admin_ph@iso-test.local', $q$select approval_decide_ref('student_projects', (select id from student_projects where title = 'ISO Dự án máy lọc nước'), 'approve') ->> 'status'$q$, true);
  insert into t_result (who, name, expect, got, ok) values ('admin_ph', 'Dự án: Ban giám hiệu duyệt', 'approved', r, r = 'approved');
end $$;

select pg_temp.chk('so_hy', 'Cuộc thi: Sở tạo cuộc thi KHKT',
  $q$insert into competitions (org_id, title, template, fields, grades, max_members, required_docs, criteria, abstract_words, anonymous, fee, rounds, status)
     values (my_org_id(), 'ISO KHKT cấp tỉnh', 'khkt', '{"Rô bốt và máy thông minh","Hoá học"}', '{thcs,thpt}', 2,
             '[{"key":"report","label":"Báo cáo kết quả nghiên cứu","required":true}]', '[{"key":"st","label":"Sáng tạo","max":20},{"key":"tb","label":"Trình bày","max":80}]',
             250, true, 100000, '{"Vòng tỉnh"}', 'open')$q$, 'rows:1');
insert into competitions (org_id, title, template, fields, grades, max_members, required_docs, criteria, abstract_words, anonymous, fee, rounds, status)
  values (pg_temp.oid_('SO-HY'), 'ISO KHKT cấp tỉnh', 'khkt', '{"Rô bốt và máy thông minh","Hoá học"}', '{thcs,thpt}', 2,
          '[{"key":"report","label":"Báo cáo kết quả nghiên cứu","required":true}]', '[{"key":"st","label":"Sáng tạo","max":20},{"key":"tb","label":"Trình bày","max":80}]',
          250, true, 100000, '{"Vòng tỉnh"}', 'open');
select pg_temp.chk('admin_ph', 'Cuộc thi: trường trực thuộc thấy', $q$select count(*) from competitions where title = 'ISO KHKT cấp tỉnh'$q$, '1');
select pg_temp.chk('admin_kb', 'Cuộc thi: trường tỉnh khác không thấy', $q$select count(*) from competitions where title = 'ISO KHKT cấp tỉnh'$q$, '0');
select pg_temp.chk('admin_ph', 'Cuộc thi: trường không tạo cuộc thi cấp Sở', format($q$insert into competitions (org_id, title) values (%L, 'ISO thay Sở tổ chức')$q$, pg_temp.oid_('SO-HY')), 'ERR');
select pg_temp.chk('admin_ph', 'Cuộc thi: thiếu hồ sơ bắt buộc bị từ chối',
  $q$select competition_submit((select id from competitions where title = 'ISO KHKT cấp tỉnh'), (select id from student_projects where title = 'ISO Dự án máy lọc nước'), 'Rô bốt và máy thông minh', '{}')::text$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Cuộc thi: lĩnh vực không có trong cuộc thi bị từ chối',
  $q$select competition_submit((select id from competitions where title = 'ISO KHKT cấp tỉnh'), (select id from student_projects where title = 'ISO Dự án máy lọc nước'), 'Toán học', '{"report":"https://drive.google.com/x"}')::text$q$, 'ERR*');
select pg_temp.chk('admin_kb', 'Cuộc thi: trường khác không nộp dự án của trường này',
  $q$select competition_submit((select id from competitions where title = 'ISO KHKT cấp tỉnh'), (select id from student_projects where title = 'ISO Dự án máy lọc nước'), 'Hoá học', '{"report":"https://x.y"}')::text$q$, 'ERR*');
select pg_temp.probe('admin_ph@iso-test.local', $q$select competition_submit((select id from competitions where title = 'ISO KHKT cấp tỉnh'), (select id from student_projects where title = 'ISO Dự án máy lọc nước'), 'Rô bốt và máy thông minh', '{"report":"https://drive.google.com/bao-cao"}')::text$q$, true);
select pg_temp.chk('admin_ph', 'Cuộc thi: nộp bài hợp lệ (có mã bài, chờ lệ phí)', $q$select code || '|' || fee_status from competition_entries$q$, 'RÔ-001|unpaid');
select pg_temp.probe('so_hy@iso-test.local', $q$select competition_add_judge((select id from competitions where title = 'ISO KHKT cấp tỉnh'), 'GK thử ISO', 'gv_both@iso-test.local')::text$q$, true);
select pg_temp.probe('so_hy@iso-test.local', $q$select competition_add_judge((select id from competitions where title = 'ISO KHKT cấp tỉnh'), 'ISO GK ngoài', null, '{"Hoá học"}')::text$q$, true);
select pg_temp.chk('so_hy', 'Giám khảo ngoài: cấp tài khoản mã theo mã đơn vị',
  $q$select login || ':' || status from account_prepare('judge', array(select id from competition_judges where full_name = 'ISO GK ngoài'))$q$, 'sohy.gk1:new');
select pg_temp.chk('admin_ph', 'Giám khảo: trường không cấp tài khoản giám khảo của Sở',
  format('select string_agg(status, '','') from account_prepare(''judge'', array[%L::uuid])', (select id from competition_judges where full_name = 'ISO GK ngoài')), 'not_found');
update competitions set status = 'judging' where title = 'ISO KHKT cấp tỉnh';
select pg_temp.chk('so_hy', 'Phân công: chỉ giám khảo đúng lĩnh vực', $q$select competition_auto_assign((select id from competitions where title = 'ISO KHKT cấp tỉnh'), 2)::text$q$, '1');
select pg_temp.probe('so_hy@iso-test.local', $q$select competition_auto_assign((select id from competitions where title = 'ISO KHKT cấp tỉnh'), 2)::text$q$, true);
select pg_temp.chk('gv_both', 'Giám khảo: thấy bài được phân công, ẩn tên trường', $q$select count(*) || '|' || coalesce(max(school), 'ẩn') from my_judging()$q$, '1|ẩn');
select pg_temp.chk('gv_both', 'Giám khảo: không đọc thẳng bảng bài dự thi của trường khác', $q$select count(*) from judge_assignments$q$, '0');
select pg_temp.chk('admin_ph', 'Chấm: người không phải giám khảo không chấm được',
  $q$select judge_score((select id from judge_assignments limit 1), '{"st":10,"tb":50}')::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Chấm: điểm vượt mức tối đa bị từ chối', $q$select judge_score((select assignment_id from my_judging() limit 1), '{"st":25,"tb":50}')::text$q$, 'ERR*');
select pg_temp.probe('gv_both@iso-test.local', $q$select judge_score((select assignment_id from my_judging() limit 1), '{"st":18,"tb":70}', 'Ý tưởng tốt')::text$q$, true);
select pg_temp.chk('so_hy', 'Kết quả: điểm trung bình và hạng theo lĩnh vực', $q$select avg_total::text || '|' || rank_in_field from competition_results((select id from competitions where title = 'ISO KHKT cấp tỉnh'))$q$, '88.00|1');
select pg_temp.chk('admin_ph', 'Kết quả: trường không xem bảng tổng hợp chấm', $q$select count(*) from competition_results((select id from competitions where title = 'ISO KHKT cấp tỉnh'))$q$, 'ERR');
select pg_temp.chk('so_hy', 'Lệ phí: tổng hợp bài chưa nộp lệ phí', $q$select unpaid || '|' || outstanding from competition_fees() where title = 'ISO KHKT cấp tỉnh'$q$, '1|100000');
select pg_temp.chk('so_hy', 'Trao giải: ghi giải và kết thúc',
  $q$select competition_finish((select id from competitions where title = 'ISO KHKT cấp tỉnh'), jsonb_build_object((select id from competition_entries limit 1)::text, 'Giải Nhất'))::text$q$, '1');
select pg_temp.probe('so_hy@iso-test.local', $q$select competition_finish((select id from competitions where title = 'ISO KHKT cấp tỉnh'), jsonb_build_object((select id from competition_entries limit 1)::text, 'Giải Nhất'))::text$q$, true);
select pg_temp.chk('ph_ph', 'Trao giải: phụ huynh thấy giải của con', $q$select award from competition_entries e join student_projects p on p.id = e.project_id where p.title = 'ISO Dự án máy lọc nước'$q$, 'Giải Nhất');
select pg_temp.chk('gv_both', 'Chấm: vòng đã đóng thì không chấm lại', $q$select judge_score((select assignment_id from my_judging() limit 1), '{"st":20,"tb":80}')::text$q$, 'ERR*');

-- ===== 052: trợ lý AI =====
select pg_temp.chk('gv_both', 'AI: mặc định tắt', $q$select ai_status() ->> 'enabled'$q$, 'false');
select pg_temp.chk('gv_both', 'AI: chưa bật thì không gọi được', $q$select ai_begin('lesson')::text$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'AI: trường không tự bật trợ lý', $q$update ai_settings set enabled = true$q$, 'rows:0');
update ai_settings set enabled = true, user_daily_quota = 2 where id = 1;
select pg_temp.chk('gv_both', 'AI: GV dùng được khi KDI bật', $q$select ai_begin('lesson') ->> 'model'$q$, 'claude-sonnet-5-5');
select pg_temp.chk('hs_kb', 'AI: học sinh không dùng trợ lý', $q$select ai_begin('chat')::text$q$, 'ERR');
select pg_temp.chk('ph_ph', 'AI: phụ huynh không dùng trợ lý', $q$select ai_begin('chat')::text$q$, 'ERR');
select pg_temp.chk('hs_kb', 'Trợ giúp: học sinh hỏi đáp cách dùng hệ thống', $q$select ai_begin('help') ->> 'allowed'$q$, 'true');
update ai_settings set help_all_roles = false where id = 1;
select pg_temp.chk('hs_kb', 'Trợ giúp: KDI giới hạn trợ giúp AI theo vai trò', $q$select ai_begin('help')::text$q$, 'ERR');
update ai_settings set help_all_roles = true where id = 1;
select pg_temp.probe('hs_kb@iso-test.local', $q$select help_ticket('ISO Không vào được bài tập', 'Bấm Bài tập báo lỗi', 'technical', 'urgent')::text$q$, true);
select pg_temp.chk('hs_kb', 'Trợ giúp: học sinh gửi yêu cầu hỗ trợ, không tự đặt mức khẩn', $q$select code like 'HT-%' and priority = 'normal' from support_tickets where subject = 'ISO Không vào được bài tập'$q$, 'true');
select pg_temp.chk('hs_kb', 'Trợ giúp: người gửi trả lời phiếu của mình', $q$insert into support_messages (ticket_id, body) select id, 'Em gửi thêm ảnh' from support_tickets where subject = 'ISO Không vào được bài tập'$q$, 'rows:1');
select pg_temp.chk('hs_kb', 'Trợ giúp: người gửi không đổi mức ưu tiên', $q$update support_tickets set priority = 'urgent' where subject = 'ISO Không vào được bài tập'$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Trợ giúp: quản trị trường thấy phiếu của học sinh trường mình', $q$select count(*) from support_tickets where subject = 'ISO Không vào được bài tập'$q$, '1');
select pg_temp.chk('admin_ph', 'Trợ giúp: trường khác không thấy phiếu', $q$select count(*) from support_tickets where subject = 'ISO Không vào được bài tập'$q$, '0');
select pg_temp.chk('hs_kb', 'Trợ giúp: tiêu đề quá ngắn bị từ chối', $q$select help_ticket('a', '')::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'AI: tác vụ lạ bị từ chối', $q$select ai_begin('hack')::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'AI: không tự ghi nhật ký sử dụng', $q$insert into ai_usage (task) values ('chat')$q$, 'ERR');
insert into ai_usage (org_id, user_id, task, input_tokens, output_tokens)
  select pg_temp.oid_('THCS-PH'), id, 'lesson', 100, 200 from profiles, generate_series(1, 2) where email = 'gv_both@iso-test.local';
select pg_temp.chk('gv_both', 'AI: hết lượt trong ngày', $q$select ai_begin('lesson')::text$q$, 'ERR*');
select pg_temp.chk('gv_both', 'AI: GV xem nhật ký của mình', $q$select count(*) from ai_usage$q$, '2');
select pg_temp.chk('admin_ph', 'AI: quản trị trường xem nhật ký của trường', $q$select sum(output_tokens) from ai_usage$q$, '400');
select pg_temp.chk('admin_kb', 'AI: trường khác không xem nhật ký', $q$select count(*) from ai_usage$q$, '0');
select pg_temp.chk('admin_kb', 'AI: trường không tự đặt hạn mức', format($q$insert into ai_org_limits (org_id, monthly_quota) values (%L, 9999)$q$, pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('gv_both', 'AI: trả về nhà cung cấp mặc định', $q$select ai_status() ->> 'provider'$q$, 'anthropic');
select pg_temp.chk('admin_ph', 'AI: trường không đổi nhà cung cấp', $q$update ai_settings set provider = 'gemini'$q$, 'rows:0');
select pg_temp.chk('kdi', 'AI: KDI chuyển sang Gemini, dự phòng OpenAI', $q$update ai_settings set provider = 'gemini', model = 'gemini-flash', fallback_provider = 'openai', fallback_model = 'gpt-mini'$q$, 'rows:1');
select pg_temp.chk('kdi', 'AI: nhà cung cấp lạ bị từ chối', $q$update ai_settings set provider = 'abc'$q$, 'ERR*');
select pg_temp.chk('kdi', 'AI: dự phòng thiếu mô hình bị từ chối', $q$update ai_settings set fallback_provider = 'openai', fallback_model = null$q$, 'ERR*');
insert into ai_org_limits (org_id, enabled, note) values (pg_temp.oid_('THCS-KB'), false, 'ISO');
select pg_temp.chk('admin_kb', 'AI: KDI tắt trợ lý cho một trường', $q$select ai_status() ->> 'enabled'$q$, 'false');
select pg_temp.chk('admin_ph', 'AI: trường khác vẫn dùng', $q$select ai_status() ->> 'enabled'$q$, 'true');

-- ===== 053: e-learning & luyện thi =====
select pg_temp.probe('admin_kb@iso-test.local', $q$insert into question_bank (org_id, subject, grade, level, kind, stem, options, answer, explain) values
  (my_org_id(), 'ISO Toán', 6, 'nhan_biet', 'single', '1 + 1 = ?', '["1","2","3","4"]', '[1]', 'Cộng.'),
  (my_org_id(), 'ISO Toán', 6, 'thong_hieu', 'single', '2 x 3 = ?', '["5","6","7","8"]', '[1]', 'Nhân.'),
  (my_org_id(), 'ISO Toán', 6, 'van_dung', 'multi', 'Số chẵn?', '["2","3","4","5"]', '[2,0]', null)$q$, true);
select pg_temp.chk('admin_kb', 'Ngân hàng: trường soạn câu hỏi', $q$select count(*) from question_bank where subject = 'ISO Toán'$q$, '3');
select pg_temp.chk('admin_kb', 'Ngân hàng: đáp án ngoài lựa chọn bị từ chối', $q$insert into question_bank (org_id, subject, stem, options, answer) values (my_org_id(), 'ISO Toán', 'Sai?', '["a","b"]', '[5]')$q$, 'ERR*');
select pg_temp.chk('admin_kb', 'Ngân hàng: câu một đáp án không có hai đáp án', $q$insert into question_bank (org_id, subject, stem, options, answer) values (my_org_id(), 'ISO Toán', 'Hai?', '["a","b"]', '[0,1]')$q$, 'ERR*');
select pg_temp.chk('hs_kb', 'Ngân hàng: học sinh không đọc được (có đáp án)', $q$select count(*) from question_bank$q$, '0');
select pg_temp.chk('admin_ph', 'Ngân hàng: trường tỉnh khác không thấy', $q$select count(*) from question_bank where subject = 'ISO Toán'$q$, '0');
select pg_temp.chk('gv_both', 'Ngân hàng: GV không sửa câu của trường khác', $q$update question_bank set stem = 'sửa' where subject = 'ISO Toán'$q$, 'rows:0');
select pg_temp.probe('so_hy@iso-test.local', $q$insert into question_bank (org_id, subject, grade, stem, options, answer, shared) values (my_org_id(), 'ISO Lý', 9, 'Đơn vị điện trở?', '["Vôn","Ôm"]', '[1]', true)$q$, true);
select pg_temp.chk('admin_ph', 'Ngân hàng: trường thấy câu dùng chung của Sở', $q$select count(*) from question_bank where subject = 'ISO Lý'$q$, '1');
select pg_temp.chk('admin_ph', 'Ngân hàng: trường không sửa câu của Sở', $q$update question_bank set stem = 'sửa' where subject = 'ISO Lý'$q$, 'rows:0');
select pg_temp.chk('admin_kb', 'Ngân hàng: Sở tỉnh khác không chia sẻ sang', $q$select count(*) from question_bank where subject = 'ISO Lý'$q$, '0');
select pg_temp.chk('gv_both', 'Ngân hàng: GV soạn và sửa câu của mình',
  $q$with x as (insert into question_bank (org_id, subject, stem, options, answer) values (my_org_id(), 'ISO GV', 'Câu GV?', '["a","b"]', '[0]') returning id) select count(*) from x$q$, '1');

select pg_temp.probe('admin_kb@iso-test.local', $q$insert into practice_exams (org_id, title, subject, grade, mode, criteria, duration_min, max_attempts, status)
  values (my_org_id(), 'ISO Đề luyện Toán 6', 'ISO Toán', 6, 'random', '{"count": 3, "levels": {"nhan_biet": 1}}', 15, 1, 'published'),
         (my_org_id(), 'ISO Đề nháp', 'ISO Toán', 6, 'random', '{"count": 2}', 15, 0, 'draft')$q$, true);
select pg_temp.chk('admin_kb', 'Đề luyện: đề ngẫu nhiên phải có số câu', $q$insert into practice_exams (org_id, title, mode, criteria) values (my_org_id(), 'ISO lỗi', 'random', '{}')$q$, 'ERR*');
select pg_temp.chk('hs_kb', 'Đề luyện: học sinh thấy đề đã công bố, không thấy đề nháp', $q$select string_agg(title, ',') from practice_exams where title like 'ISO%'$q$, 'ISO Đề luyện Toán 6');
select pg_temp.chk('admin_ph', 'Đề luyện: trường khác không thấy', $q$select count(*) from practice_exams where title like 'ISO%'$q$, '0');
select pg_temp.chk('hs_kb', 'Đề luyện: phát đề không kèm đáp án',
  $q$select (exam_start((select id from practice_exams where title = 'ISO Đề luyện Toán 6')) -> 'questions' -> 0 ? 'answer')::text$q$, 'false');
select pg_temp.probe('hs_kb@iso-test.local', $q$select exam_start((select id from practice_exams where title = 'ISO Đề luyện Toán 6'))::text$q$, true);
select pg_temp.chk('hs_kb', 'Đề luyện: đủ số câu, có câu mức nhận biết',
  $q$select cardinality(questions) || '|' || (select count(*) from exam_attempts) from exam_attempts$q$, '3|1');
select pg_temp.chk('hs_kb', 'Đề luyện: làm tiếp lượt đang dở, không tạo lượt mới',
  $q$select (exam_start((select id from practice_exams where title = 'ISO Đề luyện Toán 6')) ->> 'attempt') = (select id::text from exam_attempts limit 1)$q$, 'true');
select pg_temp.chk('hs_kb', 'Đề luyện: học sinh không tự ghi lượt làm', $q$update exam_attempts set score = 10$q$, 'rows:0');
select pg_temp.chk('hs_kb', 'Đề luyện: nộp bài, CSDL chấm đúng',
  format($q$select exam_submit((select id from exam_attempts limit 1), %L::jsonb) ->> 'score'$q$,
    (select jsonb_object_agg(id, answer) from question_bank where subject = 'ISO Toán')), '10.0');
select pg_temp.probe('hs_kb@iso-test.local', format($q$select exam_submit((select id from exam_attempts limit 1), %L::jsonb)::text$q$,
    (select jsonb_object_agg(id, answer) from question_bank where subject = 'ISO Toán')), true);
select pg_temp.chk('hs_kb', 'Đề luyện: xem đáp án sau khi nộp', $q$select (exam_result((select id from exam_attempts limit 1)) -> 'questions' -> 0 ? 'answer')::text$q$, 'true');
select pg_temp.chk('hs_kb', 'Đề luyện: hết lượt (tối đa 1)', $q$select exam_start((select id from practice_exams where title = 'ISO Đề luyện Toán 6'))::text$q$, 'ERR*');
select pg_temp.chk('admin_kb', 'Đề luyện: trường xem thống kê', $q$select (exam_stats((select id from practice_exams where title = 'ISO Đề luyện Toán 6')) ->> 'avg')$q$, '10.00');
select pg_temp.chk('admin_ph', 'Đề luyện: trường khác không xem thống kê', $q$select exam_stats((select id from practice_exams where title = 'ISO Đề luyện Toán 6'))::text$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Đề luyện: trường khác không xem lượt làm', $q$select count(*) from exam_attempts$q$, '0');

select pg_temp.probe('admin_kb@iso-test.local', $q$insert into courses (org_id, title, subject, status) values (my_org_id(), 'ISO Khoá Toán 6', 'ISO Toán', 'published')$q$, true);
insert into course_lessons (course_id, position, title, kind, url) select id, 1, 'ISO Bài 1', 'video', 'https://example.org/v' from courses where title = 'ISO Khoá Toán 6';
select pg_temp.chk('hs_kb', 'Khoá học: học sinh thấy khoá đã công bố', $q$select count(*) from course_lessons where title = 'ISO Bài 1'$q$, '1');
select pg_temp.chk('hs_kb', 'Khoá học: học sinh đánh dấu đã học', $q$insert into course_progress (lesson_id, student_id) select id, my_student_id() from course_lessons where title = 'ISO Bài 1'$q$, 'rows:1');
select pg_temp.chk('hs_kb', 'Khoá học: học sinh không thêm bài', $q$insert into course_lessons (course_id, title, kind, body) select id, 'ISO hack', 'reading', 'x' from courses where title = 'ISO Khoá Toán 6'$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Khoá học: trường khác không thấy', $q$select count(*) from courses where title like 'ISO%'$q$, '0');

-- ===== 056: loại phòng (STEM / phòng học / kho), vật tư theo phòng =====
insert into stem_rooms (org_id, name, room_kind, status) values
  (pg_temp.oid_('THCS-PH'), 'ISO phòng kho', 'storage', 'active'),
  (pg_temp.oid_('THCS-PH'), 'ISO phòng STEM X', 'stem', 'active');
insert into supplies (org_id, name, unit) values (pg_temp.oid_('THCS-PH'), 'ISO Keo', 'thanh');
select pg_temp.chk('admin_ph', 'Phòng: quản trị trường thêm phòng học',
  $q$insert into stem_rooms (org_id, name, room_kind, capacity) values (my_org_id(), 'ISO phòng học 9Z', 'classroom', 40)$q$, 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into stem_rooms (org_id, name, room_kind) values (my_org_id(), 'ISO phòng học 9Z', 'classroom')$q$, true);
select pg_temp.chk('admin_ph', 'Phòng: loại phòng không hợp lệ bị chặn',
  $q$insert into stem_rooms (org_id, name, room_kind) values (my_org_id(), 'ISO phòng lạ', 'garage')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Phòng: giáo viên không thêm phòng', $q$insert into stem_rooms (org_id, name, room_kind) values (my_org_id(), 'ISO phòng GV', 'storage')$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Phòng: trường khác không thấy phòng học / kho', format($q$select count(*) from stem_rooms where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '0');
select pg_temp.chk('admin_kb', 'Phòng: trường khác không gắn tầng của trường A',
  format($q$insert into stem_rooms (org_id, name, floor_id) values (my_org_id(), 'ISO phòng tầng lạ', %L)$q$,
    (select f.id from floors f join buildings b on b.id = f.building_id where b.org_id = pg_temp.oid_('THCS-PH') limit 1)), 'ERR*');
select pg_temp.chk('admin_ph', 'TKB: không xếp phòng học vào TKB STEM',
  $q$update timetable_entries set room_id = (select id from stem_rooms where name = 'ISO phòng học 9Z') where id = (select id from timetable_entries where org_id = my_org_id() and room_id is not null limit 1)$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'TKB: không xếp kho vào TKB',
  $q$update timetable_entries set room_id = (select id from stem_rooms where name = 'ISO phòng kho') where id = (select id from timetable_entries where org_id = my_org_id() limit 1)$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Lớp: gắn phòng học cho lớp',
  $q$update classes set room_id = (select id from stem_rooms where name = 'ISO phòng học 9Z') where id = (select id from classes where org_id = my_org_id() order by name limit 1)$q$, 'rows:1');
select pg_temp.chk('admin_ph', 'Lớp: không gắn kho làm phòng học',
  $q$update classes set room_id = (select id from stem_rooms where name = 'ISO phòng kho') where id = (select id from classes where org_id = my_org_id() order by name limit 1)$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Phòng: không đổi phòng STEM đang có TKB sang kho',
  $q$update stem_rooms set room_kind = 'storage' where id = (select room_id from timetable_entries where org_id = my_org_id() and room_id is not null limit 1)$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Phòng: đổi phòng STEM chưa dùng sang phòng học', $q$update stem_rooms set room_kind = 'classroom' where name = 'ISO phòng STEM X'$q$, 'rows:1');
select pg_temp.chk('so_hy', 'Thống kê Sở: số phòng STEM không tính phòng học / kho',
  $q$select (rooms = (select count(*) from stem_rooms r where r.org_id = s.school_id and r.room_kind = 'stem'))::text from dept_school_stats() s where code = 'THCS-PH'$q$, 'true');
select pg_temp.chk('admin_ph', 'Lịch phòng toàn hệ thống: chỉ phòng STEM',
  $q$select count(*) from room_overview(current_date, current_date) o join stem_rooms r on r.id = o.room_id where r.room_kind <> 'stem'$q$, '0');
select pg_temp.chk('admin_ph', 'Dữ liệu mẫu: trường demo có kho và phòng học', $q$select count(distinct room_kind) from stem_rooms where room_kind <> 'stem'$q$, '2');
-- Vật tư theo phòng
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into supply_moves (org_id, supply_id, kind, qty, reason, room_id) select org_id, id, 'in', 10, 'ISO nhập kho', (select id from stem_rooms where name = 'ISO phòng kho') from supplies where name = 'ISO Keo'$q$, true);
select pg_temp.chk('admin_ph', 'Vật tư: nhập vào kho → tồn tại kho 10',
  $q$select qty::text from supply_stocks where room_id = (select id from stem_rooms where name = 'ISO phòng kho')$q$, '10.00');
select pg_temp.chk('admin_ph', 'Vật tư: chuyển 4 từ kho lên phòng STEM',
  $q$insert into supply_moves (org_id, supply_id, kind, qty, room_id, to_room_id) select org_id, id, 'move', 4, (select id from stem_rooms where name = 'ISO phòng kho'), (select id from stem_rooms where name = 'ISO phòng STEM X') from supplies where name = 'ISO Keo'$q$, 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into supply_moves (org_id, supply_id, kind, qty, room_id, to_room_id) select org_id, id, 'move', 4, (select id from stem_rooms where name = 'ISO phòng kho'), (select id from stem_rooms where name = 'ISO phòng STEM X') from supplies where name = 'ISO Keo'$q$, true);
select pg_temp.chk('admin_ph', 'Vật tư: sau chuyển — kho 6, phòng 4, tổng 10',
  $q$select string_agg(x, '|') from (select (select qty::text from supply_stocks k join stem_rooms r on r.id = k.room_id where r.name = 'ISO phòng kho') x
     union all select (select qty::text from supply_stocks k join stem_rooms r on r.id = k.room_id where r.name = 'ISO phòng STEM X')
     union all select qty::text from supplies where name = 'ISO Keo') t$q$, '6.00|4.00|10.00');
select pg_temp.chk('admin_ph', 'Vật tư: không chuyển quá số đang có ở phòng',
  $q$insert into supply_moves (org_id, supply_id, kind, qty, room_id, to_room_id) select org_id, id, 'move', 5, (select id from stem_rooms where name = 'ISO phòng STEM X'), null from supplies where name = 'ISO Keo'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Vật tư: không cấp phát quá số ở phòng (dù tổng đủ)',
  $q$insert into supply_moves (org_id, supply_id, kind, qty, room_id) select org_id, id, 'out', 5, (select id from stem_rooms where name = 'ISO phòng STEM X') from supplies where name = 'ISO Keo'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Vật tư: không ghi thẳng tồn theo phòng',
  $q$update supply_stocks set qty = 999 where supply_id = (select id from supplies where name = 'ISO Keo')$q$, 'rows:0');
select pg_temp.chk('admin_ph', 'Vật tư: không thêm thẳng tồn theo phòng',
  $q$insert into supply_stocks (org_id, supply_id, qty) select org_id, id, 5 from supplies where name = 'ISO Keo'$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Vật tư: trường khác không thấy tồn theo phòng', $q$select count(*) from supply_stocks where supply_id = (select id from supplies where name = 'ISO Keo')$q$, '0');
select pg_temp.chk('so_hy', 'Vật tư: Sở cấp trên xem tồn theo phòng', format($q$select count(*) from supply_stocks where supply_id = %L$q$, (select id from supplies where name = 'ISO Keo')), '2');
select pg_temp.chk('admin_kb', 'Vật tư: không chuyển vào phòng của trường khác',
  format($q$insert into supply_moves (org_id, supply_id, kind, qty, to_room_id) values (my_org_id(), (select id from supplies where org_id = my_org_id() limit 1), 'move', 1, %L)$q$,
    (select id from stem_rooms where name = 'ISO phòng STEM X')), 'ERR*');
select pg_temp.chk('admin_ph', 'Phòng: không xoá phòng còn vật tư', $q$delete from stem_rooms where name = 'ISO phòng STEM X'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Phòng: xoá được phòng trống', $q$delete from stem_rooms where name = 'ISO phòng học 9Z'$q$, 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into supply_moves (org_id, supply_id, kind, qty, reason) select org_id, id, 'out', 7, 'ISO xuất' from supplies where name = 'ISO Keo'$q$, true);
select pg_temp.chk('admin_ph', 'Vật tư: xuất không ghi phòng lấy kho trước rồi phòng — tổng các vị trí = tồn',
  $q$select (select string_agg(r.name || ':' || k.qty, ',' order by r.name) from supply_stocks k join stem_rooms r on r.id = k.room_id where k.supply_id = s.id)
     || '|' || s.qty from supplies s where s.name = 'ISO Keo'$q$, 'ISO phòng STEM X:3.00|3.00');

-- ===== Dọn dẹp + kết quả =====
select pg_temp.cleanup();
select case when bool_and(ok) then 'PASS' else 'FAIL' end || ' ' || count(*) filter (where ok) || '/' || count(*) as "Tổng"
  from t_result;
select id, case when ok then 'PASS' else 'FAIL' end as kq, who, name, expect, got from t_result order by ok, id;
