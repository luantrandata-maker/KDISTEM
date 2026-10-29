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
-- 068: tạm cất danh sách "tạm tắt duyệt" để kiểm thử quy trình duyệt như bình thường; trả lại ở cuối
drop table if exists t_bypass;
create temp table t_bypass as select * from approval_bypass where to_regclass('public.approval_bypass') is not null;
delete from approval_bypass;

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
    if to_regclass('public.package_devices') is not null then delete from package_devices where name like 'ISO %'; end if;
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
  if to_regclass('public.student_groups') is not null then delete from student_groups where name like 'ISO%'; end if;
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
  if to_regclass('public.lesson_templates') is not null then
    delete from notifications where ref_id in (select id from approval_requests where ref_table = 'lesson_plans' and title like 'ISO %');
    delete from approval_requests where ref_table = 'lesson_plans' and title like 'ISO %';
    delete from approval_workflows where name like 'ISO %' and kind = 'lesson_plan';
    delete from lesson_plans where title like 'ISO %';
    delete from lesson_templates where name like 'ISO %';
  end if;
  if to_regclass('public.material_norms') is not null then
    perform set_config('app.norm_status', 'on', true);
    delete from notifications where ref_id in (select id from material_norms where title like 'ISO %');
    delete from material_norms where title like 'ISO %';
    delete from material_catalog where name like 'ISO %';
    perform set_config('app.norm_status', '', true);
  end if;
  if to_regclass('public.dist_plans') is not null then delete from dist_plans where title like 'ISO %';
    if to_regclass('public.dist_nodes') is not null then delete from dist_nodes where name like 'ISO con%'; delete from dist_nodes where name like 'ISO%'; delete from dist_cls_levels where name like 'ISO%'; end if;
    delete from dist_tiers where code like 'iso%'; end if;
  if to_regclass('public.training_session_codes') is not null then
    delete from notifications where kind in ('training_product', 'training_result') and ref_id in (select id from training_plans where name like 'ISO %');
    delete from notifications where kind = 'training_cert' and ref_id in (select c.id from certificates c join training_plans p on p.id = c.plan_id where p.name like 'ISO %');
    delete from notifications where kind = 'training_remind' and ref_id in (select s.id from training_sessions s join training_plans p on p.id = s.plan_id where p.name like 'ISO %');
  end if;
  if to_regclass('public.assessment_rounds') is not null then
    delete from notifications where kind = 'assessment_round' and ref_id in (select id from assessment_rounds where name like 'ISO %');
    delete from assessment_rounds where name like 'ISO %';
  end if;
  if to_regclass('public.training_plan_orgs') is not null then
    delete from training_plan_orgs where plan_id in (select id from training_plans where name like 'ISO %');
    delete from training_plans where name like 'ISO %';
  end if;
  if to_regclass('public.training_programs') is not null then delete from training_programs where title like 'ISO %'; end if;
  if to_regclass('public.curriculum_lessons') is not null then delete from curriculum_books where title like 'ISO %'; end if;
  if to_regclass('public.edu_programs') is not null then
    delete from notifications where ref_id in (select id from approval_requests where ref_table in ('edu_programs', 'curriculum_books') and title like 'ISO %');
    delete from approval_requests where ref_table in ('edu_programs', 'curriculum_books') and title like 'ISO %';
    update edu_programs set status = 'archived' where title like 'ISO %' and status in ('pending', 'published');
    delete from edu_programs where title like 'ISO %';
    delete from storage.objects where bucket_id = 'learning-files' and name like '%/iso-%';
  end if;
  if to_regclass('public.subjects') is not null then
    delete from subjects where name like 'ISO %';
    delete from stem_tracks where name like 'ISO %';
  end if;
  if to_regclass('public.edu_levels') is not null then
    delete from edu_levels where code like 'iso%';
    update edu_levels set grade_from = 6, grade_to = 9, name = 'THCS' where code = 'thcs';
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
    (v_org, v_live, v_me, null), (v_org, v_past, v_me, null), (v_org, v_live, v_other, null)
  on conflict do nothing;   -- từ 085 ghi danh tự thêm GV vào buổi chưa kết thúc
  insert into training_lessons (org_id, plan_id, title, status) values
    (v_org, v_plan, 'ISO bài tập huấn xuất bản', 'published'), (v_org, v_plan, 'ISO bài tập huấn nháp', 'draft');
end $$;
select pg_temp.chk('gv_both', 'Lịch tập huấn của tôi: 2 buổi', 'select count(*) from my_training_sessions() where title like ''ISO buổi%''', '2');
select pg_temp.chk('gv_both', 'Tự điểm danh buổi đang diễn ra', 'select training_check_in((select id from training_sessions where title = ''ISO buổi đang diễn ra''))', 'ok');
select pg_temp.chk('gv_both', 'Không tự điểm danh buổi đã qua', 'select training_check_in((select id from training_sessions where title = ''ISO buổi đã qua''))', 'ERR*');
select pg_temp.chk('gv_both', 'Ghi thẳng bảng: không đánh có mặt buổi đã qua',
  'update training_attendance set present = true where teacher_id = my_teacher_id() and session_id = (select id from training_sessions where title = ''ISO buổi đã qua'')', 'rows:0');
select pg_temp.chk('gv_both', 'Ghi thẳng bảng: không tự đánh vắng',
  'update training_attendance set present = false where teacher_id = my_teacher_id() and session_id = (select id from training_sessions where title = ''ISO buổi đang diễn ra'')', 'rows:0');
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
select pg_temp.chk('kdi', 'Danh mục phân hệ bán = 5 phân hệ (112: Chương trình & học liệu đứng đầu)', 'select string_agg(key, '','' order by sort) from service_modules', 'ph2,ph1,ph3,ph4,ph5');
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
select pg_temp.chk('admin_ph', 'Đề luyện: trường khác không xem lượt làm', $q$select count(*) from exam_attempts where org_id <> my_org_id()$q$, '0');

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

-- ===== Phân phối chương trình theo tiết + tiến độ (057) =====
do $$
declare v_org uuid := pg_temp.oid_('THCS-PH'); v_class uuid; v_grade int; v_per uuid; v_book uuid;
  v_gv uuid := (select id from teachers where email = 'gv_both@iso-test.local' and org_id = pg_temp.oid_('THCS-PH'));
begin
  update profiles set org_id = v_org where email in ('gv_both@iso-test.local', 'admin_ph@iso-test.local');
  select id, grade into v_class, v_grade from classes where org_id = v_org order by name limit 1;
  insert into teaching_assignments (org_id, teacher_id, class_id, subject) values (v_org, v_gv, v_class, 'ISO tự học') on conflict do nothing;
  insert into period_configs (org_id, name, starts_at, ends_at, session) values (v_org, 'ISO Tiết PPCT', '00:00', '23:59', 'morning') returning id into v_per;
  insert into curriculum_books (org_id, grade, subject, title, periods_per_week, status)
    values (v_org, v_grade, 'ISO Toán PPCT', 'ISO PPCT lớp thử', 2, 'published') returning id into v_book;
  insert into curriculum_lessons (book_id, seq, title) select v_book, k, 'ISO tiết ' || k from generate_series(1, 10) k;
  insert into teaching_sessions (org_id, class_id, teacher_id, period_id, session_date, subject, kind)
    select v_org, v_class, v_gv, v_per, public.vn_today() - d, 'ISO Toán PPCT', 'regular' from generate_series(1, 4) d;
end $$;
select pg_temp.chk('admin_ph', 'PPCT: tổng số tiết của môn tự cập nhật theo số tiết đã soạn', $q$select total_periods::text from curriculum_books where title = 'ISO PPCT lớp thử'$q$, '10');
select pg_temp.chk('admin_ph', 'PPCT: trường đọc tiết PPCT của mình', $q$select count(*) from curriculum_lessons where org_id = my_org_id()$q$, '>0');
select pg_temp.chk('gv_both', 'PPCT: giáo viên đọc PPCT của trường', $q$select count(*) from curriculum_lessons where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử')$q$, '10');
select pg_temp.chk('gv_both', 'PPCT: giáo viên không sửa PPCT', $q$update curriculum_lessons set title = 'ISO sửa' where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử')$q$, 'rows:0');
select pg_temp.chk('gv_both', 'PPCT: giáo viên không thêm môn', $q$insert into curriculum_books (org_id, grade, subject, title) values (my_org_id(), 6, 'Toán', 'ISO GV thêm')$q$, 'ERR');
select pg_temp.chk('admin_kb', 'PPCT: trường tỉnh khác không đọc PPCT', format($q$select count(*) from curriculum_lessons where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '0');
select pg_temp.chk('admin_kb', 'PPCT: trường tỉnh khác không thêm tiết vào PPCT trường A',
  $q$insert into curriculum_lessons (book_id, seq, title) select id, 99, 'ISO chen' from curriculum_books where title = 'ISO PPCT lớp thử'$q$, 'rows:0');
select pg_temp.chk('so_hy', 'PPCT: Sở đọc PPCT trường trực thuộc', format($q$select count(*) from curriculum_lessons where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '>0');
select pg_temp.chk('hs_kb', 'PPCT: học sinh không đọc PPCT', $q$select count(*) from curriculum_lessons$q$, '0');
-- Mẫu: KDI ban hành, Sở ban hành cho trường trực thuộc, bản nháp không lộ ra
select pg_temp.probe('kdi@iso-test.local', $q$insert into curriculum_books (org_id, grade, subject, title, status, scope) values (platform_org_id(), 7, 'Tin học', 'ISO mẫu KDI', 'published', 'children')$q$, true);
select pg_temp.chk('kdi', 'PPCT mẫu: KDI soạn tiết cho mẫu của mình',
  $q$insert into curriculum_lessons (book_id, seq, title) select id, k, 'ISO mẫu tiết ' || k from curriculum_books, generate_series(1, 3) k where title = 'ISO mẫu KDI'$q$, 'rows:3');
select pg_temp.probe('kdi@iso-test.local', $q$insert into curriculum_lessons (book_id, seq, title) select id, k, 'ISO mẫu tiết ' || k from curriculum_books, generate_series(1, 3) k where title = 'ISO mẫu KDI'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into curriculum_books (org_id, grade, subject, title, status, scope) values (platform_org_id(), 7, 'Tin học', 'ISO mẫu KDI nháp', 'draft', 'children')$q$, true);
select pg_temp.chk('admin_ph', 'PPCT mẫu: trường thấy mẫu KDI đã ban hành', $q$select count(*) from curriculum_books where title = 'ISO mẫu KDI'$q$, '1');
select pg_temp.chk('admin_ph', 'PPCT mẫu: trường đọc tiết của mẫu KDI', $q$select count(*) from curriculum_lessons where book_id = (select id from curriculum_books where title = 'ISO mẫu KDI' and org_id = platform_org_id())$q$, '3');
select pg_temp.chk('admin_ph', 'PPCT mẫu: trường không thấy mẫu nháp', $q$select count(*) from curriculum_books where title = 'ISO mẫu KDI nháp'$q$, '0');
select pg_temp.chk('admin_ph', 'PPCT mẫu: trường không sửa mẫu KDI', $q$update curriculum_books set title = 'ISO sửa mẫu' where title = 'ISO mẫu KDI'$q$, 'rows:0');
select pg_temp.chk('admin_ph', 'PPCT mẫu: trường không thêm tiết vào mẫu KDI',
  $q$insert into curriculum_lessons (book_id, seq, title) select id, 50, 'ISO chen mẫu' from curriculum_books where title = 'ISO mẫu KDI'$q$, 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_copy((select id from curriculum_books where title = 'ISO mẫu KDI' and org_id = platform_org_id()), '2026-2027')::text$q$, true);
select pg_temp.chk('admin_ph', 'PPCT mẫu: sao chép mẫu về trường (đủ tiết, thuộc trường, ghi nguồn)',
  $q$select count(*) || ':' || bool_and(l.org_id = my_org_id() and b.org_id = my_org_id() and b.scope = 'own' and b.year_name = '2026-2027') from curriculum_lessons l join curriculum_books b on b.id = l.book_id
     where b.source_id = (select id from curriculum_books where title = 'ISO mẫu KDI' and org_id = platform_org_id())$q$, '3:true');
select pg_temp.chk('gv_both', 'PPCT mẫu: giáo viên không sao chép mẫu', $q$select curriculum_copy((select id from curriculum_books where title = 'ISO mẫu KDI' and org_id = platform_org_id()))::text$q$, 'ERR');
select pg_temp.probe('so_hy@iso-test.local', $q$insert into curriculum_books (org_id, grade, subject, title, status, scope) values (my_org_id(), 8, 'Công nghệ', 'ISO mẫu Sở HY', 'published', 'children')$q$, true);
select pg_temp.chk('admin_ph', 'PPCT mẫu: trường thấy mẫu của Sở cấp trên', $q$select count(*) from curriculum_books where title = 'ISO mẫu Sở HY'$q$, '1');
select pg_temp.chk('admin_kb', 'PPCT mẫu: trường tỉnh khác không thấy mẫu của Sở HY', $q$select count(*) from curriculum_books where title = 'ISO mẫu Sở HY'$q$, '0');
select pg_temp.chk('so_bn', 'PPCT mẫu: Sở khác không sửa mẫu của Sở HY', $q$update curriculum_books set title = 'ISO đổi' where title = 'ISO mẫu Sở HY'$q$, 'rows:0');
-- Tiết dạy ↔ tiết PPCT
select pg_temp.probe('gv_both@iso-test.local', $q$select mark_teaching_session(id, '[]'::jsonb)::text from teaching_sessions where subject = 'ISO Toán PPCT' and session_date = vn_today() - 4$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select mark_teaching_session(id, '[]'::jsonb)::text from teaching_sessions where subject = 'ISO Toán PPCT' and session_date = vn_today() - 3$q$, true);
select pg_temp.chk('gv_both', 'PPCT: điểm danh tự gán tiết PPCT kế tiếp (1, 2)',
  $q$select string_agg(l.seq::text, ',' order by s.session_date) from teaching_sessions s join curriculum_lessons l on l.id = s.curriculum_lesson_id where s.subject = 'ISO Toán PPCT'$q$, '1,2');
select pg_temp.chk('gv_both', 'PPCT: GV đổi tiết PPCT của tiết mình dạy (sang tiết 5)',
  $q$select set_session_lesson((select id from teaching_sessions where subject = 'ISO Toán PPCT' and session_date = vn_today() - 3), (select l.id from curriculum_lessons l join curriculum_books b on b.id = l.book_id where b.title = 'ISO PPCT lớp thử' and l.seq = 5))::text$q$, '');
select pg_temp.probe('gv_both@iso-test.local', $q$select set_session_lesson((select id from teaching_sessions where subject = 'ISO Toán PPCT' and session_date = vn_today() - 3), (select l.id from curriculum_lessons l join curriculum_books b on b.id = l.book_id where b.title = 'ISO PPCT lớp thử' and l.seq = 5))::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select mark_teaching_session(id, '[]'::jsonb)::text from teaching_sessions where subject = 'ISO Toán PPCT' and session_date = vn_today() - 2$q$, true);
select pg_temp.chk('gv_both', 'PPCT: sau khi chọn tiết 5, tiết dạy kế tiếp tự gán tiết 6',
  $q$select l.seq::text from teaching_sessions s join curriculum_lessons l on l.id = s.curriculum_lesson_id where s.subject = 'ISO Toán PPCT' and s.session_date = vn_today() - 2$q$, '6');
select pg_temp.chk('gv_both', 'PPCT: không gắn tiết PPCT của khối khác',
  $q$select set_session_lesson((select id from teaching_sessions where subject = 'ISO Toán PPCT' and session_date = vn_today() - 2), (select l.id from curriculum_lessons l join curriculum_books b on b.id = l.book_id where b.grade <> (select c.grade from classes c join teaching_sessions s on s.class_id = c.id where s.subject = 'ISO Toán PPCT' limit 1) and b.org_id = my_org_id() limit 1))::text$q$, 'ERR*');
select pg_temp.chk('mixed', 'PPCT: người không dạy tiết không đổi được tiết PPCT',
  $q$select set_session_lesson((select id from teaching_sessions where subject = 'ISO Toán PPCT' limit 1), null)::text$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Tiến độ PPCT: lớp thử đã dạy tới tiết 6, 3 tiết',
  $q$select reached || ':' || taught || ':' || total from curriculum_progress() where book_title = 'ISO PPCT lớp thử'$q$, '6:3:10');
select pg_temp.chk('gv_both', 'Tiến độ PPCT: giáo viên xem tiến độ của trường', $q$select count(*) from curriculum_progress()$q$, '>0');
select pg_temp.chk('so_hy', 'Tiến độ PPCT: Sở xem tiến độ trường trực thuộc', format($q$select count(*) from curriculum_progress() where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '>0');
select pg_temp.chk('so_bn', 'Tiến độ PPCT: Sở tỉnh khác không xem tiến độ trường A', format($q$select count(*) from curriculum_progress() where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '0');
select pg_temp.chk('hs_kb', 'Tiến độ PPCT: học sinh không xem tiến độ', $q$select count(*) from curriculum_progress()$q$, '0');
select pg_temp.chk('admin_ph', 'Dữ liệu mẫu: trường demo có PPCT theo tiết và tiết đã dạy được gắn PPCT',
  $q$select (count(*) > 0)::text from teaching_sessions where org_id = my_org_id() and curriculum_lesson_id is not null$q$, 'true');

-- ===== Chương trình giáo dục, PPCT theo học kỳ / lớp / duyệt, theo dõi thực hiện (058) =====
-- Chương trình: KDI soạn và ban hành, trường / Sở đọc, trường tỉnh khác không thấy chương trình riêng của Sở
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject, scope) values (platform_org_id(), 'ISO CT KDI', 'CT1', 'thcs', 6, 9, 'Tin học', 'children')$q$, true);
select pg_temp.chk('kdi', 'CTGD: KDI thêm chủ đề vào chương trình nháp',
  $q$insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) select id, 'topic', 1, 6, 'ISO chủ đề 1', 3 from edu_programs where title = 'ISO CT KDI'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) select id, 'topic', 1, 6, 'ISO chủ đề 1', 3 from edu_programs where title = 'ISO CT KDI'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) select p.id, u.id, 'lesson', k, 'ISO bài ' || k, 2 from edu_programs p join edu_program_units u on u.program_id = p.id, generate_series(1, 2) k where p.title = 'ISO CT KDI'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) select p.id, u.id, 1, 'ISO1', 'ISO yêu cầu cần đạt', 'tin_hoc' from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic' where p.title = 'ISO CT KDI'$q$, true);
-- Môn học, học phần – môn học, bài học – học liệu (064)
select pg_temp.chk('admin_ph', 'Môn học: trường thấy danh mục môn hệ thống của KDI', $q$select (count(*) >= 10)::text from subjects where org_id = platform_org_id()$q$, 'true');
select pg_temp.chk('hs_kb', 'Môn học: học sinh không đọc danh mục môn', $q$select count(*) from subjects$q$, '0');
select pg_temp.chk('admin_ph', 'Môn học: trường thêm môn riêng', $q$insert into subjects (org_id, name, scope) values (my_org_id(), 'ISO môn trường A', 'own')$q$, 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into subjects (org_id, name, scope) values (my_org_id(), 'ISO môn trường A', 'own')$q$, true);
select pg_temp.chk('admin_ph', 'Môn học: trùng tên trong cùng đơn vị bị chặn', $q$insert into subjects (org_id, name) values (my_org_id(), 'iso MÔN trường a')$q$, 'ERR*');
select pg_temp.chk('admin_kb', 'Môn học: trường tỉnh khác không thấy môn riêng của trường A', $q$select count(*) from subjects where name = 'ISO môn trường A'$q$, '0');
select pg_temp.chk('gv_both', 'Môn học: giáo viên không thêm môn', $q$insert into subjects (org_id, name) values (my_org_id(), 'ISO môn GV')$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Môn học: trường không sửa được môn của KDI', $q$update subjects set description = 'ISO' where org_id = platform_org_id()$q$, 'rows:0');
select pg_temp.chk('kdi', 'HP–Môn: KDI gắn môn chính cho học phần',
  $q$insert into edu_unit_subjects (unit_id, subject_id, is_main) select u.id, s.id, true from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic', subjects s where p.title = 'ISO CT KDI' and s.org_id = p.org_id and s.name = 'Tin học'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_unit_subjects (unit_id, subject_id, is_main) select u.id, s.id, true from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic', subjects s where p.title = 'ISO CT KDI' and s.org_id = p.org_id and s.name = 'Tin học'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_unit_subjects (unit_id, subject_id, is_main) select u.id, s.id, true from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic', subjects s where p.title = 'ISO CT KDI' and s.org_id = p.org_id and s.name = 'Công nghệ'$q$, true);
select pg_temp.chk('kdi', 'HP–Môn: mỗi học phần chỉ một môn chính',
  $q$select string_agg(s.name || ':' || x.is_main, ',' order by s.name) from edu_unit_subjects x join subjects s on s.id = x.subject_id join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI'$q$, 'Công nghệ:true,Tin học:false');
select pg_temp.chk('kdi', 'HP–Môn: không gắn môn vào bài học (chỉ học phần)',
  $q$insert into edu_unit_subjects (unit_id, subject_id) select u.id, s.id from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'lesson', subjects s where p.title = 'ISO CT KDI' and s.org_id = p.org_id and s.name = 'Toán' limit 1$q$, 'ERR*');
select pg_temp.chk('kdi', 'HP–Môn: không gắn môn riêng của trường khác',
  $q$insert into edu_unit_subjects (unit_id, subject_id) select u.id, s.id from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic', subjects s where p.title = 'ISO CT KDI' and s.name = 'ISO môn trường A'$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, content, scope, status) values (my_org_id(), 'material', 'ISO học liệu KDI', '{"type": "link", "url": "https://example.com"}', 'public', 'published')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, content, scope, status) values (my_org_id(), 'lesson', 'ISO bài giảng KDI', '{"slides": []}', 'public', 'published')$q$, true);
select pg_temp.chk('kdi', 'BH–HL: KDI gắn học liệu cho bài học',
  $q$insert into edu_unit_materials (unit_id, item_id, note) select u.id, i.id, 'ISO dùng ở phần khởi động' from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'lesson' and u.title = 'ISO bài 1', library_items i where p.title = 'ISO CT KDI' and i.title = 'ISO học liệu KDI'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_unit_materials (unit_id, item_id, note) select u.id, i.id, 'ISO dùng ở phần khởi động' from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'lesson' and u.title = 'ISO bài 1', library_items i where p.title = 'ISO CT KDI' and i.title = 'ISO học liệu KDI'$q$, true);
select pg_temp.chk('kdi', 'BH–HL: không gắn học liệu vào học phần',
  $q$insert into edu_unit_materials (unit_id, item_id) select u.id, i.id from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic', library_items i where p.title = 'ISO CT KDI' and i.title = 'ISO học liệu KDI'$q$, 'ERR*');
select pg_temp.chk('kdi', 'BH–HL: chỉ gắn học liệu, không gắn bài giảng / chương trình của kho',
  $q$insert into edu_unit_materials (unit_id, item_id) select u.id, i.id from edu_programs p join edu_program_units u on u.program_id = p.id and u.title = 'ISO bài 2', library_items i where p.title = 'ISO CT KDI' and i.title = 'ISO bài giảng KDI'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'BH–HL: trường không gắn học liệu vào chương trình của KDI',
  $q$insert into edu_unit_materials (unit_id, item_id) select u.id, i.id from edu_program_units u, library_items i where u.title = 'ISO bài 2' and i.title = 'ISO học liệu KDI'$q$, 'rows:0');
-- Loại chương trình: KDI thêm loại mới; mã loại đang dùng không xoá, không đổi
select pg_temp.chk('kdi', 'Loại CT: KDI thêm loại chương trình mới', $q$insert into stem_tracks (code, name, title, sort) values ('ISO6', 'ISO loại mới', 'ISO loại chương trình mới', 6)$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into stem_tracks (code, name, title, sort) values ('ISO6', 'ISO loại mới', 'ISO loại chương trình mới', 6)$q$, true);
select pg_temp.chk('admin_ph', 'Loại CT: trường không thêm loại chương trình', $q$insert into stem_tracks (code, name, title) values ('ISO7', 'ISO loại trường', 'ISO loại trường')$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Loại CT: trường thấy loại mới', $q$select count(*) from stem_tracks where code = 'ISO6'$q$, '1');
select pg_temp.chk('kdi', 'Loại CT: chương trình dùng được loại mới', $q$update edu_programs set kind = 'stem', ct_code = 'ISO6' where title = 'ISO CT KDI'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$update edu_programs set kind = 'stem', ct_code = 'ISO6' where title = 'ISO CT KDI'$q$, true);
select pg_temp.chk('kdi', 'Loại CT: mã loại không có trong danh mục bị chặn', $q$update edu_programs set ct_code = 'ZZ9' where title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('kdi', 'Loại CT: không xoá loại đang được chương trình dùng', $q$delete from stem_tracks where code = 'ISO6'$q$, 'ERR*');
select pg_temp.chk('kdi', 'Loại CT: không đổi mã loại', $q$update stem_tracks set code = 'ISO8' where code = 'ISO6'$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$update edu_programs set kind = 'subject', ct_code = 'CT1' where title = 'ISO CT KDI'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$delete from stem_tracks where code = 'ISO6'$q$, true);
select pg_temp.chk('kdi', 'Loại CT: xoá loại không còn dùng', $q$select count(*) from stem_tracks where code = 'ISO6'$q$, '0');
select pg_temp.chk('kdi', 'CTGD: tổng tiết = tổng tiết các bài (mục lá)', $q$select total_periods::text from edu_programs where title = 'ISO CT KDI'$q$, '4');
select pg_temp.chk('kdi', 'CTGD: buổi học không đứng trực tiếp dưới chủ đề',
  $q$insert into edu_program_units (program_id, parent_id, unit_type, title) select p.id, u.id, 'session', 'ISO buổi sai' from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic' where p.title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('kdi', 'CTGD: khối ngoài phạm vi chương trình bị chặn',
  $q$insert into edu_program_units (program_id, unit_type, grade, title) select id, 'topic', 11, 'ISO khối 11' from edu_programs where title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'CTGD: trường không thấy chương trình nháp của KDI', $q$select count(*) from edu_programs where title = 'ISO CT KDI'$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI'), 'published', 'ISO ban hành')$q$, true);
select pg_temp.chk('admin_ph', 'CTGD: trường thấy chương trình KDI đã ban hành và đọc cấu trúc, YCCĐ',
  $q$select (select count(*) from edu_program_units u join edu_programs p on p.id = u.program_id where p.title = 'ISO CT KDI') || ':' || (select count(*) from edu_outcomes o join edu_programs p on p.id = o.program_id where p.title = 'ISO CT KDI')$q$, '3:1');
select pg_temp.chk('admin_ph', 'HP–Môn, BH–HL: trường đọc liên kết của chương trình KDI đã ban hành',
  $q$select (select count(*) from edu_unit_subjects x join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI') || ':' || (select count(*) from edu_unit_materials x join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI')$q$, '2:1');
select pg_temp.chk('kdi', 'BH–HL: đã ban hành thì không bỏ học liệu', $q$delete from edu_unit_materials where note = 'ISO dùng ở phần khởi động'$q$, 'ERR*');
select pg_temp.chk('kdi', 'HP–Môn: đã ban hành thì không đổi môn chính', $q$update edu_unit_subjects x set is_main = not is_main from edu_programs p where p.id = x.program_id and p.title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('hs_kb', 'HP–Môn, BH–HL: học sinh không đọc liên kết', $q$select (select count(*) from edu_unit_subjects) + (select count(*) from edu_unit_materials)$q$, '0');
select pg_temp.chk('admin_kb', 'CTGD: trường tỉnh khác cũng thấy chương trình KDI dùng chung', $q$select count(*) from edu_programs where title = 'ISO CT KDI'$q$, '1');
select pg_temp.chk('hs_kb', 'CTGD: học sinh không đọc chương trình', $q$select count(*) from edu_programs$q$, '0');
select pg_temp.chk('kdi', 'CTGD: đã ban hành thì không sửa nội dung', $q$update edu_programs set title = 'ISO CT KDI sửa' where title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('kdi', 'CTGD: đã ban hành thì không thêm bài', $q$insert into edu_program_units (program_id, unit_type, title) select id, 'topic', 'ISO thêm' from edu_programs where title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('kdi', 'CTGD: không xoá chương trình đang ban hành', $q$delete from edu_programs where title = 'ISO CT KDI'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'CTGD: trường không sửa chương trình KDI', $q$update edu_programs set scope = 'own' where title = 'ISO CT KDI'$q$, 'rows:0');
select pg_temp.chk('gv_both', 'CTGD: giáo viên không thêm chương trình',
  $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject) values (my_org_id(), 'ISO CT GV', 'CT1', 'thcs', 6, 6, 'Toán')$q$, 'ERR');
-- Phiên bản mới: bản nháp v2, ban hành thì v1 bị thay thế
select pg_temp.probe('kdi@iso-test.local', $q$select edu_program_new_version((select id from edu_programs where title = 'ISO CT KDI'))::text$q$, true);
select pg_temp.chk('kdi', 'CTGD: phiên bản mới là bản nháp số 2, chép đủ cấu trúc và YCCĐ',
  $q$select p.version_no || ':' || p.status || ':' || (select count(*) from edu_program_units where program_id = p.id) || ':' || (select count(*) from edu_outcomes where program_id = p.id)
     from edu_programs p where title = 'ISO CT KDI' and version_no = 2$q$, '2:draft:3:1');
select pg_temp.chk('kdi', 'CTGD: phiên bản mới chép liên kết môn học và học liệu',
  $q$select (select count(*) from edu_unit_subjects x join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI' and p.version_no = 2) || ':' || (select count(*) from edu_unit_materials x join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI' and p.version_no = 2)$q$, '2:1');
select pg_temp.chk('kdi', 'CTGD: không tạo hai phiên bản nháp cùng lúc', $q$select edu_program_new_version((select id from edu_programs where title = 'ISO CT KDI' and version_no = 1))::text$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$update edu_programs set title = 'ISO CT KDI' , note = 'ISO v2' where title = 'ISO CT KDI' and version_no = 2$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI' and version_no = 2), 'published')$q$, true);
select pg_temp.chk('kdi', 'CTGD: ban hành v2 → v1 bị thay thế (superseded, trỏ sang v2)',
  $q$select string_agg(p.version_no || p.status || (p.replaced_by is not null), ',' order by p.version_no) from edu_programs p where title = 'ISO CT KDI'$q$, '1supersededtrue,2publishedfalse');
select pg_temp.chk('kdi', 'CTGD: nhật ký trạng thái ghi lại thay thế', $q$select count(*) from edu_program_log g join edu_programs p on p.id = g.program_id where p.title = 'ISO CT KDI' and g.to_status = 'superseded'$q$, '1');
-- Trường sao chép chương trình về, soạn, gửi duyệt qua Hộp phê duyệt rồi ban hành
select pg_temp.probe('admin_ph@iso-test.local', $q$select edu_program_copy((select id from edu_programs where title = 'ISO CT KDI' and version_no = 2))::text$q$, true);
select pg_temp.chk('admin_ph', 'CTGD: sao chép chương trình KDI về trường (nháp, đủ cấu trúc)',
  $q$select p.status || ':' || (select count(*) from edu_program_units where program_id = p.id) from edu_programs p where p.title = 'ISO CT KDI' and p.org_id = my_org_id()$q$, 'draft:3');
select pg_temp.chk('admin_ph', 'CTGD: bản sao của trường giữ liên kết môn học và học liệu KDI',
  $q$select (select count(*) from edu_unit_subjects x join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI' and p.org_id = my_org_id()) || ':' || (select count(*) from edu_unit_materials x join edu_programs p on p.id = x.program_id where p.title = 'ISO CT KDI' and p.org_id = my_org_id())$q$, '2:1');
select pg_temp.chk('admin_kb', 'CTGD: trường khác không thấy bản sao của trường A', $q$select count(*) from edu_programs where title = 'ISO CT KDI' and org_id <> platform_org_id()$q$, '0');
select pg_temp.chk('gv_both', 'CTGD: giáo viên đọc chương trình của trường', $q$select count(*) from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()$q$, '1');
select pg_temp.chk('gv_both', 'CTGD: giáo viên không gửi duyệt / ban hành', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()), 'pending')$q$, 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()), 'pending', 'ISO gửi')$q$, true);
select pg_temp.chk('admin_ph', 'CTGD: gửi duyệt tạo hồ sơ trong Hộp phê duyệt',
  $q$select count(*) from approval_requests where kind = 'edu_program' and ref_id = (select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()) and status = 'pending'$q$, '1');
select pg_temp.chk('admin_ph', 'CTGD: chờ duyệt thì không ban hành thẳng', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()), 'published')$q$, 'ERR*');
select pg_temp.probe('admin_ph@iso-test.local', $q$select approval_decide_ref('edu_programs', (select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()), 'approve', 'ISO đồng ý')::text$q$, true);
select pg_temp.chk('admin_ph', 'CTGD: duyệt trong Hộp phê duyệt → đã duyệt', $q$select status from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()$q$, 'approved');
select pg_temp.chk('admin_ph', 'CTGD: ban hành bản đã duyệt', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()), 'published')$q$, 'published');
select pg_temp.probe('admin_ph@iso-test.local', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT KDI' and org_id = my_org_id()), 'published')$q$, true);
-- Gán chương trình cho trường: Sở gán chương trình của Sở; Sở tỉnh khác / trường không gán được
select pg_temp.probe('so_hy@iso-test.local', $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject) values (my_org_id(), 'ISO CT Sở HY', 'CT2', 'thcs', 7, 8, 'Công nghệ')$q$, true);
select pg_temp.probe('so_hy@iso-test.local', $q$insert into edu_program_units (program_id, unit_type, grade, title, periods) select id, 'topic', 7, 'ISO chủ đề Sở', 2 from edu_programs where title = 'ISO CT Sở HY'$q$, true);
select pg_temp.chk('so_hy', 'CTGD: không tự đặt "đã duyệt" khi chưa gửi duyệt', $q$update edu_programs set status = 'approved' where title = 'ISO CT Sở HY'$q$, 'ERR');
select pg_temp.probe('so_hy@iso-test.local', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT Sở HY'), 'published')$q$, true);
select pg_temp.chk('admin_ph', 'CTGD: chương trình riêng (không dùng chung) của Sở chưa gán thì trường không thấy', $q$select count(*) from edu_programs where title = 'ISO CT Sở HY'$q$, '0');
select pg_temp.chk('so_hy', 'CTGD: Sở gán chương trình cho trường trực thuộc',
  format($q$insert into edu_program_assignments (program_id, org_id, grades) select id, %L, '{7}' from edu_programs where title = 'ISO CT Sở HY'$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.probe('so_hy@iso-test.local', format($q$insert into edu_program_assignments (program_id, org_id, grades) select id, %L, '{7}' from edu_programs where title = 'ISO CT Sở HY'$q$, pg_temp.oid_('THCS-PH')), true);
select pg_temp.chk('admin_ph', 'CTGD: trường được gán thấy chương trình và bản gán', $q$select count(*) || ':' || (select count(*) from edu_program_assignments a join edu_programs p on p.id = a.program_id where p.title = 'ISO CT Sở HY') from edu_programs where title = 'ISO CT Sở HY'$q$, '1:1');
select pg_temp.chk('admin_kb', 'CTGD: trường tỉnh khác không thấy chương trình gán cho trường A', $q$select count(*) from edu_programs where title = 'ISO CT Sở HY'$q$, '0');
select pg_temp.chk('so_bn', 'CTGD: Sở khác không gán chương trình của Sở HY',
  format($q$insert into edu_program_assignments (program_id, org_id) values (%L, %L)$q$, (select id from edu_programs where title = 'ISO CT Sở HY'), pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('admin_ph', 'CTGD: trường không tự gán chương trình của Sở',
  format($q$insert into edu_program_assignments (program_id, org_id) select id, %L from edu_programs where title = 'ISO CT Sở HY'$q$, pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('so_hy', 'CTGD: Sở gán chương trình chuẩn đang ban hành của KDI cho trường trực thuộc',
  format($q$insert into edu_program_assignments (program_id, org_id, grades) select id, %L, '{6}' from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and status = 'published'$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.chk('so_hy', 'CTGD: Sở không gán chương trình KDI cho trường tỉnh khác',
  format($q$insert into edu_program_assignments (program_id, org_id) select id, %L from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and status = 'published'$q$, pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('admin_ph', 'CTGD: trường không tự gán chương trình KDI',
  format($q$insert into edu_program_assignments (program_id, org_id) select id, %L from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and status = 'published'$q$, pg_temp.oid_('THCS-PH')), 'ERR');
select pg_temp.probe('so_hy@iso-test.local', format($q$insert into edu_program_assignments (program_id, org_id, grades) select id, %L, '{6}' from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and status = 'published'$q$, pg_temp.oid_('THCS-PH')), true);
select pg_temp.chk('so_bn', 'CTGD: Sở khác không xoá bản gán của Sở HY',
  $q$delete from edu_program_assignments a using edu_programs p where p.id = a.program_id and p.title = 'ISO CT KDI'$q$, 'rows:0');
select pg_temp.chk('so_hy', 'CTGD: Sở xoá bản gán chương trình KDI do mình gán',
  $q$delete from edu_program_assignments a using edu_programs p where p.id = a.program_id and p.title = 'ISO CT KDI' and a.assigner_org = my_org_id()$q$, 'rows:1');
select pg_temp.chk('so_hy', 'CTGD: độ phủ chương trình — trường A được gán', format($q$select assigned::text from edu_program_coverage((select id from edu_programs where title = 'ISO CT Sở HY')) where org_id = %L$q$, pg_temp.oid_('THCS-PH')), 'true');
select pg_temp.chk('so_bn', 'CTGD: Sở khác không xem độ phủ trường A', format($q$select count(*) from edu_program_coverage((select id from edu_programs where title = 'ISO CT KDI' and version_no = 2 and org_id = platform_org_id())) where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '0');
-- PPCT từ chương trình chuẩn, học kỳ, gán lớp, nhật ký điều chỉnh, duyệt
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_from_program((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), 6, null, null, 1)::text$q$, true);
select pg_temp.chk('admin_ph', 'PPCT: tạo từ chương trình — mỗi bài thành số tiết của bài, có liên kết bài',
  $q$select count(*) || ':' || count(l.unit_id) || ':' || min(b.status) || ':' || min(l.week) || '-' || max(l.week) from curriculum_lessons l join curriculum_books b on b.id = l.book_id
     where b.title = 'ISO CT KDI — khối 6' and b.org_id = my_org_id()$q$, '4:4:draft:1-4');
select pg_temp.chk('gv_both', 'PPCT: giáo viên không tạo PPCT từ chương trình',
  $q$select curriculum_from_program((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), 6)::text$q$, 'ERR');
select pg_temp.chk('admin_ph', 'PPCT: học kỳ tự tính theo tuần (tuần 20 → HK II), đổi tuần thì tính lại',
  $q$with u as (update curriculum_lessons set week = 20 where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') and seq = 10 returning term) select term::text from u$q$, '2');
select pg_temp.probe('admin_ph@iso-test.local', $q$update curriculum_lessons set title = 'ISO tiết 9 sửa', change_reason = 'ISO lí do' where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') and seq = 9$q$, true);
select pg_temp.chk('admin_ph', 'PPCT: nhật ký điều chỉnh có lý do và nội dung trước / sau',
  $q$select reason || ':' || (before->>'title') || '→' || (after->>'title') from curriculum_changes where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') and action = 'update'$q$, 'ISO lí do:ISO tiết 9→ISO tiết 9 sửa');
select pg_temp.chk('admin_kb', 'PPCT: trường khác không đọc nhật ký điều chỉnh', $q$select count(*) from curriculum_changes where reason like 'ISO%'$q$, '0');
select pg_temp.chk('gv_both', 'PPCT: giáo viên không nhập lại cả môn', $q$select curriculum_replace_lessons((select id from curriculum_books where title = 'ISO PPCT lớp thử'), '[{"seq":1,"title":"ISO x"}]', 'ISO')::text$q$, 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into curriculum_books (org_id, grade, subject, title, status) values (my_org_id(), 7, 'ISO Môn duyệt', 'ISO PPCT duyệt', 'draft')$q$, true);
select pg_temp.chk('admin_ph', 'PPCT: gửi duyệt PPCT', $q$update curriculum_books set status = 'pending' where title = 'ISO PPCT duyệt'$q$, 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$update curriculum_books set status = 'pending' where title = 'ISO PPCT duyệt'$q$, true);
select pg_temp.chk('admin_ph', 'PPCT: gửi duyệt tạo hồ sơ trong Hộp phê duyệt', $q$select count(*) from approval_requests where kind = 'curriculum_plan' and title = 'ISO PPCT duyệt' and status = 'pending'$q$, '1');
select pg_temp.chk('admin_ph', 'PPCT: gán PPCT cho một lớp', $q$insert into curriculum_book_classes (book_id, class_id) select b.id, c.id from curriculum_books b join classes c on c.org_id = b.org_id and c.grade = b.grade where b.title = 'ISO PPCT lớp thử' order by c.name limit 1$q$, 'rows:1');
select pg_temp.chk('admin_ph', 'PPCT: không gán PPCT cho lớp khác khối', $q$insert into curriculum_book_classes (book_id, class_id) select b.id, c.id from curriculum_books b join classes c on c.org_id = b.org_id and c.grade <> b.grade where b.title = 'ISO PPCT lớp thử' limit 1$q$, 'ERR*');
select pg_temp.chk('gv_both', 'PPCT: giáo viên không gán lớp', $q$insert into curriculum_book_classes (book_id, class_id) select b.id, c.id from curriculum_books b join classes c on c.org_id = b.org_id and c.grade = b.grade where b.title = 'ISO PPCT lớp thử' limit 1$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Theo dõi: tiết bị bỏ qua giữa các tiết đã dạy',
  $q$select string_agg(seq::text, ',' order by seq) from curriculum_lesson_status((select s.class_id from teaching_sessions s where s.subject = 'ISO Toán PPCT' limit 1)) where book_title = 'ISO PPCT lớp thử' and state = 'skipped'$q$, '2,3,4');
select pg_temp.chk('admin_ph', 'Theo dõi: tiến độ có số nội dung chưa hoàn thành', $q$select (missed >= 3)::text from curriculum_progress() where book_title = 'ISO PPCT lớp thử'$q$, 'true');
select pg_temp.chk('admin_ph', 'Theo dõi: không lấy cả danh sách tiết khi không chọn lớp', $q$select count(*) from curriculum_lesson_status()$q$, '0');
select pg_temp.chk('admin_kb', 'Theo dõi: trường khác không xem tiết của lớp trường A',
  $q$select count(*) from curriculum_lesson_status((select s.class_id from teaching_sessions s where s.subject = 'ISO Toán PPCT' limit 1))$q$, '0');
select pg_temp.chk('so_hy', 'Theo dõi: Sở xem nội dung chưa hoàn thành của trường trực thuộc', format($q$select count(*) from curriculum_lesson_status(null, %L, true)$q$, pg_temp.oid_('THCS-PH')), '>0');
select pg_temp.chk('so_bn', 'Theo dõi: Sở khác không xem', format($q$select count(*) from curriculum_lesson_status(null, %L, true)$q$, pg_temp.oid_('THCS-PH')), '0');
select pg_temp.chk('admin_ph', 'Theo dõi: yêu cầu cần đạt theo lớp (dữ liệu mẫu Tin học 6)', $q$select count(*) from curriculum_outcome_status(null, my_org_id()) where subject = 'Tin học'$q$, '>0');
select pg_temp.chk('gv_both', 'Minh chứng: giáo viên dạy lớp ghi minh chứng cho tiết',
  $q$insert into curriculum_evidence (class_id, lesson_id, kind, url, note) select s.class_id, s.curriculum_lesson_id, 'link', 'https://example.com/iso', 'ISO minh chứng' from teaching_sessions s where s.subject = 'ISO Toán PPCT' and s.curriculum_lesson_id is not null limit 1$q$, 'rows:1');
select pg_temp.chk('admin_kb', 'Minh chứng: trường khác không ghi minh chứng cho lớp trường A',
  format($q$insert into curriculum_evidence (class_id, lesson_id, kind, note) values (%L, %L, 'note', 'ISO chen')$q$,
    (select s.class_id from teaching_sessions s where s.subject = 'ISO Toán PPCT' and s.curriculum_lesson_id is not null limit 1),
    (select s.curriculum_lesson_id from teaching_sessions s where s.subject = 'ISO Toán PPCT' and s.curriculum_lesson_id is not null limit 1)), 'ERR');
select pg_temp.chk('hs_kb', 'Minh chứng: học sinh không đọc', $q$select count(*) from curriculum_evidence$q$, '0');
select pg_temp.chk('admin_ph', 'Minh chứng: tệp phải nằm trong thư mục của trường',
  format($q$insert into curriculum_evidence (class_id, lesson_id, kind, path) select s.class_id, s.curriculum_lesson_id, 'file', %L from teaching_sessions s where s.subject = 'ISO Toán PPCT' and s.curriculum_lesson_id is not null limit 1$q$, pg_temp.oid_('THCS-KB') || '/iso-x.jpg'), 'ERR*');
select pg_temp.chk('gv_both', 'Kho tệp: nhân sự tải tệp vào thư mục trường mình',
  format($q$insert into storage.objects (bucket_id, name) values ('learning-files', %L)$q$, pg_temp.oid_('THCS-PH') || '/iso-a.pdf'), 'rows:1');
select pg_temp.probe('gv_both@iso-test.local', format($q$insert into storage.objects (bucket_id, name) values ('learning-files', %L)$q$, pg_temp.oid_('THCS-PH') || '/iso-a.pdf'), true);
select pg_temp.chk('admin_kb', 'Kho tệp: không tải vào thư mục trường khác',
  format($q$insert into storage.objects (bucket_id, name) values ('learning-files', %L)$q$, pg_temp.oid_('THCS-PH') || '/iso-b.pdf'), 'ERR');
select pg_temp.chk('admin_kb', 'Kho tệp: trường khác không đọc tệp của trường A', $q$select count(*) from storage.objects where name like '%/iso-a.pdf'$q$, '0');
select pg_temp.chk('so_hy', 'Kho tệp: Sở đọc tệp của trường trực thuộc', $q$select count(*) from storage.objects where name like '%/iso-a.pdf'$q$, '1');
do $$ begin perform pg_temp.mk('hs_ppct', 'THCS-PH', 'student'); update profiles set org_id = pg_temp.oid_('THCS-PH') where email = 'hs_ppct@iso-test.local'; end $$;
select pg_temp.chk('hs_ppct', 'Kho tệp: học sinh đọc tệp của trường mình', $q$select count(*) from storage.objects where name like '%/iso-a.pdf'$q$, '1');
select pg_temp.chk('hs_ppct', 'Kho tệp: học sinh không tải tệp lên', format($q$insert into storage.objects (bucket_id, name) values ('learning-files', %L)$q$, pg_temp.oid_('THCS-PH') || '/iso-c.pdf'), 'ERR');
select pg_temp.chk('so_hy', 'Kho tệp: cấp trên không xoá tệp của trường', $q$delete from storage.objects where name like '%/iso-a.pdf'$q$, 'rows:0');


-- ===== 059: học liệu theo chương trình, danh mục vật tư, định mức, đề xuất điều chỉnh =====
-- Danh mục vật tư
select pg_temp.probe('kdi@iso-test.local', $q$insert into material_catalog (org_id, name, kind, unit, reusable) values (platform_org_id(), 'ISO Kit KDI', 'equipment', 'bộ', true)$q$, true);
select pg_temp.chk('admin_ph', 'Danh mục VT: trường thấy danh mục dùng chung của KDI', $q$select count(*) from material_catalog where name = 'ISO Kit KDI'$q$, '1');
select pg_temp.chk('admin_ph', 'Danh mục VT: trường không sửa danh mục của KDI', $q$update material_catalog set unit = 'cái' where name = 'ISO Kit KDI'$q$, 'rows:0');
select pg_temp.chk('gv_both', 'Danh mục VT: giáo viên không thêm danh mục của trường', $q$insert into material_catalog (org_id, name) values (my_org_id(), 'ISO VT GV')$q$, 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into material_catalog (org_id, name, unit) values (my_org_id(), 'ISO VT trường', 'cái')$q$, true);
select pg_temp.chk('admin_kb', 'Danh mục VT: trường khác không thấy danh mục của trường A', $q$select count(*) from material_catalog where name = 'ISO VT trường'$q$, '0');
select pg_temp.chk('so_hy', 'Danh mục VT: Sở thấy danh mục của trường trực thuộc', $q$select count(*) from material_catalog where name = 'ISO VT trường'$q$, '1');
select pg_temp.probe('so_hy@iso-test.local', $q$insert into material_catalog (org_id, name, unit, scope) values (my_org_id(), 'ISO VT Sở', 'cuộn', 'children')$q$, true);
select pg_temp.chk('admin_ph', 'Danh mục VT: trường thấy danh mục Sở cấp trên', $q$select count(*) from material_catalog where name = 'ISO VT Sở'$q$, '1');
select pg_temp.chk('admin_kb', 'Danh mục VT: trường tỉnh khác không thấy danh mục Sở HY', $q$select count(*) from material_catalog where name = 'ISO VT Sở'$q$, '0');
select pg_temp.chk('so_bn', 'Danh mục VT: Sở khác không thêm vào danh mục Sở HY', format($q$insert into material_catalog (org_id, name) values (%L, 'ISO VT lạ')$q$, pg_temp.oid_('SO-HY')), 'ERR');
-- Định mức
select pg_temp.probe('so_hy@iso-test.local', $q$insert into material_norms (org_id, title, basis, group_size, sessions) values (my_org_id(), 'ISO ĐM Sở', 'group', 4, 1)$q$, true);
select pg_temp.probe('so_hy@iso-test.local', $q$insert into material_norm_items (norm_id, catalog_id, name, qty) select n.id, c.id, 'x', 2 from material_norms n, material_catalog c where n.title = 'ISO ĐM Sở' and c.name = 'ISO VT Sở'$q$, true);
select pg_temp.chk('so_hy', 'Định mức: dòng vật tư lấy tên, đơn vị từ danh mục', $q$select name || '|' || unit from material_norm_items i join material_norms n on n.id = i.norm_id where n.title = 'ISO ĐM Sở'$q$, 'ISO VT Sở|cuộn');
select pg_temp.chk('admin_ph', 'Định mức: trường không thấy bản nháp của Sở', $q$select count(*) from material_norms where title = 'ISO ĐM Sở'$q$, '0');
select pg_temp.chk('so_hy', 'Định mức: không tự đổi trạng thái (phải qua Ban hành)', $q$update material_norms set status = 'published' where title = 'ISO ĐM Sở'$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Định mức: trường không ban hành định mức của Sở', $q$select material_norm_set_status((select id from material_norms where title = 'ISO ĐM Sở' limit 1), 'published')$q$, 'ERR');
select pg_temp.probe('so_hy@iso-test.local', $q$select material_norm_set_status((select id from material_norms where title = 'ISO ĐM Sở'), 'published')$q$, true);
select pg_temp.chk('admin_ph', 'Định mức: trường thấy định mức Sở đã ban hành', $q$select count(*) from material_norms where title = 'ISO ĐM Sở'$q$, '1');
select pg_temp.chk('admin_kb', 'Định mức: trường tỉnh khác không thấy định mức Sở HY', $q$select count(*) from material_norms where title = 'ISO ĐM Sở'$q$, '0');
select pg_temp.chk('so_hy', 'Định mức: đã ban hành thì không sửa dòng vật tư', $q$update material_norm_items i set qty = 5 from material_norms n where n.id = i.norm_id and n.title = 'ISO ĐM Sở'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Định mức: trường không sửa định mức của Sở', $q$update material_norms set note = 'x' where title = 'ISO ĐM Sở'$q$, 'rows:0');
select pg_temp.chk('admin_ph', 'Định mức: trường không xoá dòng định mức của Sở', $q$delete from material_norm_items i using material_norms n where n.id = i.norm_id and n.title = 'ISO ĐM Sở'$q$, 'rows:0');
select pg_temp.chk('admin_kb', 'Định mức: trường tỉnh khác không sao chép định mức Sở HY',
  format($q$select material_norm_copy(%L)::text$q$, (select id from material_norms where title = 'ISO ĐM Sở')), 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$select material_norm_copy((select id from material_norms where title = 'ISO ĐM Sở' and org_id <> my_org_id()))::text$q$, true);
select pg_temp.chk('admin_ph', 'Định mức: sao chép về trường thành bản nháp riêng, đủ dòng',
  $q$select n.status || ':' || n.scope || ':' || (select count(*) from material_norm_items i where i.norm_id = n.id) from material_norms n where n.title = 'ISO ĐM Sở' and n.org_id = my_org_id()$q$, 'draft:own:1');
select pg_temp.chk('so_hy', 'Định mức: Sở thấy bản sao của trường trực thuộc', $q$select count(*) from material_norms where title = 'ISO ĐM Sở'$q$, '2');
select pg_temp.chk('admin_ph', 'Dự trù: 30 HS, nhóm 4 → 8 nhóm × 2 = 16',
  $q$select need::int from material_norm_estimate((select id from material_norms where title = 'ISO ĐM Sở' and org_id <> my_org_id()), null, 30)$q$, '16');
select pg_temp.chk('admin_kb', 'Dự trù: trường tỉnh khác không dự trù theo định mức Sở HY',
  format($q$select count(*) from material_norm_estimate(%L, null, 30)$q$, (select id from material_norms where title = 'ISO ĐM Sở' and org_id = pg_temp.oid_('SO-HY'))), 'ERR');
select pg_temp.chk('admin_ph', 'Dự trù: không dự trù cho lớp của trường khác',
  format($q$select count(*) from material_norm_estimate((select id from material_norms where title = 'ISO ĐM Sở' and org_id <> my_org_id()), %L)$q$,
         (select id from classes where org_id = pg_temp.oid_('THCS-KB') limit 1)), 'ERR');
-- Đề xuất điều chỉnh
select pg_temp.chk('admin_kb', 'Đề xuất ĐM: trường tỉnh khác không đề xuất cho định mức Sở HY',
  format($q$insert into material_norm_proposals (norm_id, reason, items) values (%L, 'ISO', '[{"name":"x","qty":1}]')$q$, (select id from material_norms where title = 'ISO ĐM Sở' and org_id = pg_temp.oid_('SO-HY'))), 'ERR');
select pg_temp.chk('gv_both', 'Đề xuất ĐM: giáo viên đề xuất điều chỉnh định mức đã ban hành',
  $q$insert into material_norm_proposals (norm_id, reason, items) select n.id, 'ISO thiếu', jsonb_build_array(jsonb_build_object('item_id', i.id, 'name', i.name, 'qty', 3)) from material_norms n join material_norm_items i on i.norm_id = n.id where n.title = 'ISO ĐM Sở' and n.status = 'published'$q$, 'rows:1');
select pg_temp.probe('gv_both@iso-test.local', $q$insert into material_norm_proposals (norm_id, reason, items) select n.id, 'ISO thiếu', jsonb_build_array(jsonb_build_object('item_id', i.id, 'name', i.name, 'qty', 3)) from material_norms n join material_norm_items i on i.norm_id = n.id where n.title = 'ISO ĐM Sở' and n.status = 'published'$q$, true);
select pg_temp.chk('so_hy', 'Đề xuất ĐM: Sở thấy đề xuất cho định mức của mình', $q$select count(*) from material_norm_proposals where reason = 'ISO thiếu'$q$, '1');
select pg_temp.chk('so_bn', 'Đề xuất ĐM: Sở khác không thấy đề xuất', $q$select count(*) from material_norm_proposals where reason = 'ISO thiếu'$q$, '0');
select pg_temp.chk('admin_kb', 'Đề xuất ĐM: trường khác không thấy đề xuất', $q$select count(*) from material_norm_proposals where reason = 'ISO thiếu'$q$, '0');
select pg_temp.chk('gv_both', 'Đề xuất ĐM: người đề xuất không tự chấp nhận', $q$update material_norm_proposals set status = 'accepted' where reason = 'ISO thiếu'$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Đề xuất ĐM: trường không quyết định đề xuất cho định mức của Sở',
  format($q$select material_norm_decide(%L, true)::text$q$, (select id from material_norm_proposals where reason = 'ISO thiếu')), 'ERR');
select pg_temp.probe('so_hy@iso-test.local', $q$select material_norm_decide((select id from material_norm_proposals where reason = 'ISO thiếu'), true, 'Đồng ý')::text$q$, true);
select pg_temp.chk('so_hy', 'Đề xuất ĐM: chấp nhận → phiên bản nháp mới đã áp số lượng',
  $q$select n.version_no || ':' || n.status || ':' || i.qty::int from material_norms n join material_norm_items i on i.norm_id = n.id where n.title = 'ISO ĐM Sở' and n.org_id = my_org_id() and n.status = 'draft'$q$, '2:draft:3');
select pg_temp.chk('gv_both', 'Đề xuất ĐM: người đề xuất thấy kết quả', $q$select status from material_norm_proposals where reason = 'ISO thiếu'$q$, 'accepted');
select pg_temp.chk('so_hy', 'Định mức: không tạo thêm phiên bản khi đang có bản nháp',
  $q$select material_norm_new_version((select id from material_norms where title = 'ISO ĐM Sở' and org_id = my_org_id() and status = 'published'))::text$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Định mức: trường vẫn chỉ thấy bản đang ban hành (không thấy nháp v2 của Sở)', $q$select count(*) from material_norms where title = 'ISO ĐM Sở' and org_id <> my_org_id()$q$, '1');
-- Học liệu theo chương trình, quyền sử dụng, phiên bản
select pg_temp.chk('so_hy', 'Học liệu: bài không thuộc chương trình đã chọn bị chặn',
  $q$insert into library_items (owner_org_id, kind, title, content, program_id, unit_id) select my_org_id(), 'material', 'ISO HL sai bài', '{"type":"worksheet","url":"https://x"}',
     (select id from edu_programs where title like 'STEM CT2%' limit 1), (select id from edu_program_units where program_id = (select id from edu_programs where title like 'Tin học THCS%' and status = 'published' limit 1) limit 1)$q$, 'ERR*');
select pg_temp.chk('so_hy', 'Học liệu: tệp phải nằm trong thư mục của đơn vị phát hành',
  format($q$insert into library_items (owner_org_id, kind, title, content) values (my_org_id(), 'material', 'ISO HL tệp lạ', jsonb_build_object('type', 'document', 'path', %L))$q$, pg_temp.oid_('SO-BN') || '/hoc-lieu/iso-x.pdf'), 'ERR*');
select pg_temp.probe('so_hy@iso-test.local', format($q$insert into library_items (owner_org_id, kind, title, content, scope, usage_rights) values (my_org_id(), 'material', 'ISO HL Sở', jsonb_build_object('type', 'worksheet', 'path', %L, 'file_name', 'iso-hl.pdf'), 'children', 'view')$q$, pg_temp.oid_('SO-HY') || '/hoc-lieu/iso-hl.pdf'), true);
select pg_temp.probe('so_hy@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO HL Sở'), 'bản 1')::text$q$, true);
select pg_temp.probe('so_hy@iso-test.local', $q$update library_items set title = 'ISO HL Sở 2' where title = 'ISO HL Sở'$q$, true);
select pg_temp.probe('so_hy@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO HL Sở 2'), 'bản 2')::text$q$, true);
select pg_temp.chk('admin_ph', 'Học liệu: trường xem được lịch sử phiên bản học liệu của Sở', $q$select count(*) from library_item_versions v join library_items i on i.id = v.item_id where i.title = 'ISO HL Sở 2'$q$, '2');
select pg_temp.chk('admin_kb', 'Học liệu: trường tỉnh khác không xem phiên bản', $q$select count(*) from library_item_versions where title like 'ISO HL Sở%'$q$, '0');
select pg_temp.chk('admin_ph', 'Học liệu: "chỉ xem" thì không dùng vào bài giảng', $q$select library_adopt((select id from library_items where title = 'ISO HL Sở 2'), true)::text$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Học liệu: trường không khôi phục phiên bản học liệu của Sở', $q$select library_restore_version((select id from library_items where title = 'ISO HL Sở 2'), 1)::text$q$, 'ERR');
select pg_temp.probe('so_hy@iso-test.local', $q$select library_restore_version((select id from library_items where title = 'ISO HL Sở 2'), 1)::text$q$, true);
select pg_temp.chk('so_hy', 'Học liệu: khôi phục bản 1 → về bản nháp có nội dung bản 1', $q$select title || ':' || status from library_items where title like 'ISO HL Sở%'$q$, 'ISO HL Sở:draft');
select pg_temp.probe('so_hy@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO HL Sở'), 'bản 3')::text$q$, true);
do $$ begin
  if to_regclass('storage.objects') is not null then
    insert into storage.objects (bucket_id, name, owner) values ('learning-files', pg_temp.oid_('SO-HY') || '/hoc-lieu/iso-hl.pdf', null);
  end if;
end $$;
select pg_temp.chk('hs_ppct', 'Kho tệp: học sinh trường trực thuộc đọc tệp học liệu Sở đã phát hành', $q$select count(*) from storage.objects where name like '%/hoc-lieu/iso-hl.pdf'$q$, '1');
select pg_temp.chk('hs_kb', 'Kho tệp: học sinh tỉnh khác không đọc tệp học liệu Sở HY', $q$select count(*) from storage.objects where name like '%/hoc-lieu/iso-hl.pdf'$q$, '0');
select pg_temp.chk('admin_kb', 'Kho tệp: trường tỉnh khác không đọc tệp học liệu Sở HY', $q$select count(*) from storage.objects where name like '%/hoc-lieu/iso-hl.pdf'$q$, '0');


-- ===== 060: mẫu giáo án, soạn giáo án theo bước, duyệt, phiên bản, nhân bản, dạy thử, đề xuất định mức =====
-- Dữ liệu mẫu đã bật duyệt giáo án ở THCS-PH; các kiểm thử dưới đây bắt đầu từ trường chưa có quy trình
delete from approval_workflows where kind = 'lesson_plan' and name = 'Duyệt giáo án trước khi xuất bản';
do $$ declare v uuid := pg_temp.mk('gv_ph2', 'THCS-PH', 'teacher');
begin
  update profiles set org_id = pg_temp.oid_('THCS-PH') where id = v;
  insert into teachers (org_id, full_name, email, profile_id) values (pg_temp.oid_('THCS-PH'), 'GV thử C', 'gv_ph2@iso-test.local', v);
end $$;
-- Mẫu giáo án
select pg_temp.chk('admin_ph', 'Mẫu GA: trường thấy mẫu hệ thống của KDI', $q$select (count(*) >= 3)::text from lesson_templates where org_id = platform_org_id()$q$, 'true');
select pg_temp.chk('gv_both', 'Mẫu GA: giáo viên không tạo mẫu của trường', $q$insert into lesson_templates (org_id, name, phases) values (my_org_id(), 'ISO mẫu GV', '[{"key":"a","title":"A"}]')$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Mẫu GA: mẫu trống bị chặn', $q$insert into lesson_templates (org_id, name) values (my_org_id(), 'ISO mẫu trống')$q$, 'ERR*');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into lesson_templates (org_id, name, sections, phases) values (my_org_id(), 'ISO mẫu trường', '[{"key":"mt","title":"Mục tiêu"}]', '[{"key":"a","title":"Khởi động"},{"key":"b","title":"Luyện tập"}]')$q$, true);
select pg_temp.chk('gv_both', 'Mẫu GA: giáo viên trong trường dùng được mẫu của trường', $q$select count(*) from lesson_templates where name = 'ISO mẫu trường'$q$, '1');
select pg_temp.chk('admin_kb', 'Mẫu GA: trường khác không thấy mẫu của trường A', $q$select count(*) from lesson_templates where name = 'ISO mẫu trường'$q$, '0');
-- Soạn và xuất bản (trường chưa có quy trình duyệt giáo án)
select pg_temp.chk('gv_both', 'Giáo án: không tạo thẳng bản đã xuất bản',
  $q$insert into lesson_plans (org_id, teacher_id, title, status) values (my_org_id(), my_teacher_id(), 'ISO GA xb', 'published')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Giáo án: bước hoạt động phải có tên',
  $q$insert into lesson_plans (org_id, teacher_id, title, steps) values (my_org_id(), my_teacher_id(), 'ISO GA lỗi', '[{"id":"x","title":""}]')$q$, 'ERR*');
select pg_temp.probe('gv_both@iso-test.local', $q$insert into lesson_plans (org_id, teacher_id, title, subject, template_id, doc, steps) select my_org_id(), my_teacher_id(), 'ISO GA', 'Công nghệ', t.id, '{"muc_tieu":"Biết lắp mạch"}', '[{"id":"s1","phase":"engage","title":"Khởi động","minutes":5},{"id":"s2","phase":"explore","title":"Thí nghiệm","minutes":20}]' from lesson_templates t where t.name like 'Bài học STEM%' limit 1$q$, true);
select pg_temp.chk('gv_both', 'Giáo án: không tự đặt "đã xuất bản" (phải qua nút Xuất bản)', $q$update lesson_plans set status = 'published' where title = 'ISO GA'$q$, 'ERR');
select pg_temp.chk('gv_ph2', 'Giáo án: GV khác không xuất bản giáo án của đồng nghiệp', $q$select lesson_plan_publish((select id from lesson_plans where title = 'ISO GA' limit 1))::text$q$, 'ERR');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_publish((select id from lesson_plans where title = 'ISO GA'), 'Bản đầu')::text$q$, true);
select pg_temp.chk('gv_both', 'Giáo án: xuất bản → phiên bản 1, lưu lịch sử',
  $q$select p.status || ':' || p.version_no || ':' || (select count(*) from lesson_plan_versions v where v.plan_id = p.id) from lesson_plans p where p.title = 'ISO GA'$q$, 'published:1:1');
select pg_temp.chk('gv_both', 'Giáo án: đã xuất bản thì không sửa nội dung', $q$update lesson_plans set title = 'ISO GA sửa' where title = 'ISO GA'$q$, 'ERR*');
select pg_temp.chk('gv_ph2', 'Giáo án: đồng nghiệp trong trường thấy giáo án đã xuất bản', $q$select count(*) from lesson_plans where title = 'ISO GA'$q$, '1');
select pg_temp.chk('gv_ph2', 'Giáo án: đồng nghiệp không sửa giáo án của người khác', $q$update lesson_plans set summary = 'x' where title = 'ISO GA'$q$, 'rows:0');
select pg_temp.chk('admin_kb', 'Giáo án: trường khác không thấy', $q$select count(*) from lesson_plans where title = 'ISO GA'$q$, '0');
select pg_temp.chk('so_hy', 'Giáo án: Sở xem giáo án đã xuất bản của trường trực thuộc', $q$select count(*) from lesson_plans where title = 'ISO GA'$q$, '1');
select pg_temp.chk('so_bn', 'Giáo án: Sở tỉnh khác không xem', $q$select count(*) from lesson_plans where title = 'ISO GA'$q$, '0');
select pg_temp.chk('admin_kb', 'Giáo án: trường khác không nhân bản', format($q$select lesson_plan_clone(%L)::text$q$, (select id from lesson_plans where title = 'ISO GA')), 'ERR');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select lesson_plan_clone((select id from lesson_plans where title = 'ISO GA'), 'ISO GA C')::text$q$, true);
select pg_temp.chk('gv_ph2', 'Giáo án: nhân bản thành bản nháp của mình, giữ các bước',
  $q$select status || ':' || (teacher_id = my_teacher_id())::text || ':' || jsonb_array_length(steps) from lesson_plans where title = 'ISO GA C'$q$, 'draft:true:2');
-- 076: bản nháp để sửa bài đã xuất bản (bài gốc vẫn xuất bản tới khi xuất bản thay)
select pg_temp.chk('gv_ph2', 'Bản nháp: GV khác không tạo bản nháp bài của đồng nghiệp', $q$select lesson_plan_draft((select id from lesson_plans where title = 'ISO GA'))::text$q$, 'ERR');
select pg_temp.chk('gv_both', 'Bản nháp: không tự chèn bản nháp (phải qua nút)',
  $q$insert into lesson_plans (org_id, teacher_id, title, draft_of) select my_org_id(), my_teacher_id(), 'ISO GA nháp tay', id from lesson_plans where title = 'ISO GA'$q$, 'ERR*');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_draft((select id from lesson_plans where title = 'ISO GA'))::text$q$, true);
select pg_temp.chk('gv_both', 'Bản nháp: bài gốc vẫn xuất bản, bản nháp đang soạn; bấm lại không tạo bản thứ hai',
  $q$select (select status from lesson_plans where title = 'ISO GA' and draft_of is null) || ':' || (select status from lesson_plans where title = 'ISO GA' and draft_of is not null)
     || ':' || (lesson_plan_draft((select id from lesson_plans where title = 'ISO GA' and draft_of is null)) = (select id from lesson_plans where title = 'ISO GA' and draft_of is not null))::text$q$, 'published:editing:true');
select pg_temp.chk('gv_ph2', 'Bản nháp: đồng nghiệp chỉ thấy bản đã xuất bản', $q$select count(*) from lesson_plans where title = 'ISO GA'$q$, '1');
select pg_temp.probe('gv_both@iso-test.local', $q$update lesson_plans set summary = 'ISO sửa nháp' where title = 'ISO GA' and draft_of is not null$q$, true);
select pg_temp.chk('gv_both', 'Bản nháp: sửa bản nháp không đổi bài gốc', $q$select coalesce(summary, '-') from lesson_plans where title = 'ISO GA' and draft_of is null$q$, '-');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_publish((select id from lesson_plans where title = 'ISO GA' and draft_of is not null), 'Sửa sau dạy thử')::text$q$, true);
select pg_temp.chk('gv_both', 'Bản nháp: xuất bản thay bản cũ → bài gốc giữ id, lên phiên bản 2, có nội dung mới; bản nháp được bỏ',
  $q$select p.status || ':' || p.version_no || ':' || p.summary || ':' || (select count(*) from lesson_plan_versions v where v.plan_id = p.id)
     || ':' || (select count(*) from lesson_plans x where x.draft_of = p.id) from lesson_plans p where p.title = 'ISO GA'$q$, 'published:2:ISO sửa nháp:2:0');
-- Phiên bản mới, khôi phục
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_new_version((select id from lesson_plans where title = 'ISO GA'))::text$q$, true);
select pg_temp.chk('gv_both', 'Giáo án: tạo phiên bản mới → sửa được', $q$update lesson_plans set title = 'ISO GA v2' where title = 'ISO GA'$q$, 'rows:1');
select pg_temp.probe('gv_both@iso-test.local', $q$update lesson_plans set title = 'ISO GA v2' where title = 'ISO GA'$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_publish((select id from lesson_plans where title = 'ISO GA v2'))::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_new_version((select id from lesson_plans where title = 'ISO GA v2'))::text$q$, true);
select pg_temp.chk('gv_ph2', 'Giáo án: người khác không khôi phục phiên bản', $q$select lesson_plan_restore((select id from lesson_plans where title = 'ISO GA v2'), 1)::text$q$, 'ERR');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_restore((select id from lesson_plans where title = 'ISO GA v2'), 1)::text$q$, true);
select pg_temp.chk('gv_both', 'Giáo án: khôi phục bản 1 vào bản đang soạn', $q$select title || ':' || status || ':' || version_no from lesson_plans where title like 'ISO GA' or title = 'ISO GA v2'$q$, 'ISO GA:editing:3');
-- Trường bật quy trình duyệt giáo án
do $$ begin insert into approval_workflows (org_id, kind, name) values (pg_temp.oid_('THCS-PH'), 'lesson_plan', 'ISO duyệt giáo án'); end $$;
select pg_temp.chk('gv_ph2', 'Duyệt GA: trường bật duyệt → giáo viên không tự xuất bản', $q$select lesson_plan_publish((select id from lesson_plans where title = 'ISO GA C'))::text$q$, 'ERR');
select pg_temp.chk('gv_ph2', 'Duyệt GA: gửi duyệt', $q$update lesson_plans set status = 'pending' where title = 'ISO GA C'$q$, 'rows:1');
select pg_temp.probe('gv_ph2@iso-test.local', $q$update lesson_plans set status = 'pending' where title = 'ISO GA C'$q$, true);
select pg_temp.chk('admin_ph', 'Duyệt GA: hồ sơ vào Hộp phê duyệt của trường', $q$select count(*) from approval_requests where ref_table = 'lesson_plans' and title = 'ISO GA C' and status = 'pending'$q$, '1');
select pg_temp.chk('gv_ph2', 'Duyệt GA: đang chờ duyệt thì không sửa', $q$update lesson_plans set summary = 'sửa' where title = 'ISO GA C'$q$, 'ERR*');
select pg_temp.chk('gv_ph2', 'Duyệt GA: giáo viên không tự duyệt', $q$update lesson_plans set status = 'approved' where title = 'ISO GA C'$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Duyệt GA: trường khác không đọc giáo án chờ duyệt', $q$select count(*) from lesson_plans where title = 'ISO GA C'$q$, '0');
select pg_temp.chk('gv_both', 'Duyệt GA: đồng nghiệp không đọc bản nháp chờ duyệt', $q$select count(*) from lesson_plans where title = 'ISO GA C'$q$, '0');
select pg_temp.probe('admin_ph@iso-test.local', $q$select approval_decide_ref('lesson_plans', (select id from lesson_plans where title = 'ISO GA C'), 'approve', 'Đạt yêu cầu')::text$q$, true);
select pg_temp.chk('gv_ph2', 'Duyệt GA: được duyệt, ý kiến người duyệt lưu vào giáo án', $q$select status || ':' || coalesce(review_note, '') from lesson_plans where title = 'ISO GA C'$q$, 'approved:Đạt yêu cầu');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select lesson_plan_publish((select id from lesson_plans where title = 'ISO GA C'))::text$q$, true);
select pg_temp.chk('gv_ph2', 'Duyệt GA: bản đã duyệt thì giáo viên xuất bản được', $q$select status || ':' || version_no from lesson_plans where title = 'ISO GA C'$q$, 'published:1');
-- Rút lại hồ sơ
select pg_temp.probe('gv_both@iso-test.local', $q$update lesson_plans set status = 'pending' where title = 'ISO GA'$q$, true);
select pg_temp.chk('gv_ph2', 'Duyệt GA: người khác không rút hồ sơ', $q$select lesson_plan_withdraw((select id from lesson_plans where title = 'ISO GA C'))::text$q$, 'ERR');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_withdraw((select id from lesson_plans where title = 'ISO GA'))::text$q$, true);
select pg_temp.chk('gv_both', 'Duyệt GA: rút lại → về nháp, hồ sơ huỷ',
  $q$select p.status || ':' || (select string_agg(r.status, ',' order by r.created_at) from approval_requests r where r.ref_id = p.id) from lesson_plans p where p.title = 'ISO GA'$q$, 'draft:cancelled');
-- Dạy thử, góp ý
select pg_temp.chk('gv_both', 'Dạy thử: ghi nhận dạy thử trên lớp của trường',
  format($q$insert into lesson_plan_reviews (plan_id, kind, class_id, rating, note) select id, 'trial', %L, 4, 'ISO dạy thử' from lesson_plans where title = 'ISO GA C'$q$, (select id from classes where org_id = pg_temp.oid_('THCS-PH') limit 1)), 'rows:1');
select pg_temp.chk('gv_both', 'Dạy thử: lớp của trường khác bị chặn',
  format($q$insert into lesson_plan_reviews (plan_id, kind, class_id, note) select id, 'trial', %L, 'ISO' from lesson_plans where title = 'ISO GA C'$q$, (select id from classes where org_id = pg_temp.oid_('THCS-KB') limit 1)), 'ERR*');
select pg_temp.chk('admin_kb', 'Góp ý: trường khác không góp ý giáo án trường A',
  format($q$insert into lesson_plan_reviews (plan_id, note) values (%L, 'ISO')$q$, (select id from lesson_plans where title = 'ISO GA C')), 'ERR');
-- Đề xuất điều chỉnh định mức từ giáo án
select pg_temp.probe('gv_both@iso-test.local', $q$insert into lesson_plans (org_id, teacher_id, title, norm_id, norm_adjust) select my_org_id(), my_teacher_id(), 'ISO GA ĐM', n.id, jsonb_build_array(jsonb_build_object('item_id', i.id, 'qty', 5, 'note', 'thêm')) from material_norms n join material_norm_items i on i.norm_id = n.id where n.title = 'ISO ĐM Sở' and n.status = 'published' and n.org_id <> my_org_id()$q$, true);
select pg_temp.chk('gv_ph2', 'Đề xuất ĐM từ GA: chỉ người soạn gửi được', $q$select lesson_plan_propose_norm((select id from lesson_plans where title = 'ISO GA ĐM'), 'x')::text$q$, 'ERR');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_propose_norm((select id from lesson_plans where title = 'ISO GA ĐM'), 'ISO lớp đông')::text$q$, true);
select pg_temp.chk('so_hy', 'Đề xuất ĐM từ GA: Sở nhận đề xuất kèm số lượng mới', $q$select (items->0->>'qty') || ':' || (lesson_plan_id is not null)::text from material_norm_proposals where reason = 'ISO lớp đông'$q$, '5:true');


-- ===== 061: giao theo nhóm / học sinh, phân tích câu hỏi khó, nội dung cần ôn, tiến độ khoá học =====
do $$ declare v_st uuid; v_cls uuid; g uuid;
begin
  select id, class_id into v_st, v_cls from students where student_code = 'ISO-001';
  insert into student_groups (org_id, class_id, name) values (pg_temp.oid_('THCS-KB'), v_cls, 'ISO nhóm có HS') returning id into g;
  insert into student_group_members (org_id, group_id, student_id) values (pg_temp.oid_('THCS-KB'), g, v_st);
  insert into student_groups (org_id, class_id, name) values (pg_temp.oid_('THCS-KB'), v_cls, 'ISO nhóm khác');
end $$;
select pg_temp.probe('admin_kb@iso-test.local', format($q$insert into practice_exams (org_id, title, subject, grade, mode, criteria, status, group_ids)
  values (my_org_id(), 'ISO đề nhóm', 'ISO Toán', 6, 'random', '{"count": 1}', 'published', array[%L]::uuid[]),
         (my_org_id(), 'ISO đề nhóm khác', 'ISO Toán', 6, 'random', '{"count": 1}', 'published', array[%L]::uuid[])$q$,
  (select id from student_groups where name = 'ISO nhóm có HS'), (select id from student_groups where name = 'ISO nhóm khác')), true);
select pg_temp.probe('admin_kb@iso-test.local', $q$insert into practice_exams (org_id, title, subject, grade, mode, criteria, status, student_ids)
  values (my_org_id(), 'ISO đề cá nhân', 'ISO Toán', 6, 'random', '{"count": 1}', 'published', array[(select id from students where student_code = 'ISO-001')])$q$, true);
select pg_temp.chk('hs_kb', 'Giao bài: học sinh thấy đề giao cho nhóm của em và cho riêng em, không thấy đề của nhóm khác',
  $q$select string_agg(title, ',' order by title) from practice_exams where title in ('ISO đề nhóm', 'ISO đề nhóm khác', 'ISO đề cá nhân')$q$, 'ISO đề cá nhân,ISO đề nhóm');
select pg_temp.chk('hs_kb', 'Giao bài: không làm được đề của nhóm khác', $q$select exam_start((select id from practice_exams where title = 'ISO đề nhóm khác' limit 1))::text$q$, 'ERR');
select pg_temp.chk('hs_kb', 'Giao bài: làm được đề giao cho nhóm của em', $q$select (exam_start((select id from practice_exams where title = 'ISO đề nhóm')) ? 'attempt')::text$q$, 'true');
select pg_temp.chk('admin_kb', 'Giao bài: nhóm của trường khác bị chặn',
  format($q$insert into practice_exams (org_id, title, mode, criteria, group_ids) values (my_org_id(), 'ISO đề lạ', 'random', '{"count":1}', array[%L]::uuid[])$q$,
         (select id from student_groups where org_id = pg_temp.oid_('THCS-PH') limit 1)), 'ERR*');
select pg_temp.chk('admin_kb', 'Giao bài: học sinh của trường khác bị chặn',
  format($q$insert into practice_exams (org_id, title, mode, criteria, student_ids) values (my_org_id(), 'ISO đề lạ', 'random', '{"count":1}', array[%L]::uuid[])$q$,
         (select id from students where org_id = pg_temp.oid_('THCS-PH') limit 1)), 'ERR*');
select pg_temp.chk('admin_kb', 'Danh sách làm bài: học sinh được giao', $q$select count(*) from exam_roster((select id from practice_exams where title = 'ISO đề nhóm'))$q$, '1');
select pg_temp.chk('admin_ph', 'Danh sách làm bài: trường khác không xem', format($q$select count(*) from exam_roster(%L)$q$, (select id from practice_exams where title = 'ISO đề nhóm')), 'ERR');
-- Khoá học giao cho nhóm, có hạn
select pg_temp.probe('admin_kb@iso-test.local', format($q$insert into courses (org_id, title, status, group_ids, due_at) values (my_org_id(), 'ISO khoá nhóm', 'published', array[%L]::uuid[], now() - interval '1 day')$q$, (select id from student_groups where name = 'ISO nhóm có HS')), true);
select pg_temp.probe('admin_kb@iso-test.local', $q$insert into course_lessons (course_id, position, title, kind, body) select id, 1, 'Bài đọc', 'reading', 'Nội dung' from courses where title = 'ISO khoá nhóm'$q$, true);
select pg_temp.chk('hs_kb', 'Khoá học: học sinh trong nhóm thấy khoá học', $q$select count(*) from courses where title = 'ISO khoá nhóm'$q$, '1');
select pg_temp.chk('admin_kb', 'Khoá học: tiến độ — học sinh được giao, quá hạn chưa xong',
  $q$select count(*) || ':' || bool_and(overdue)::text from course_progress_summary((select id from courses where title = 'ISO khoá nhóm'))$q$, '1:true');
select pg_temp.chk('admin_ph', 'Khoá học: trường khác không xem tiến độ', format($q$select count(*) from course_progress_summary(%L)$q$, (select id from courses where title = 'ISO khoá nhóm')), 'ERR');
select pg_temp.chk('admin_kb', 'Khoá học: tạo khoá học và đọc lại ngay (insert … returning)',
  $q$with x as (insert into courses (org_id, title, status) values (my_org_id(), 'ISO khoá đọc lại', 'draft') returning id) select count(*) from x$q$, '1');
select pg_temp.probe('admin_kb@iso-test.local', $q$insert into course_lessons (course_id, position, title, kind, exam_id) select c.id, 2, 'Kiểm tra cuối', 'exam', e.id from courses c, practice_exams e where c.title = 'ISO khoá nhóm' and e.title = 'ISO đề nhóm khác'$q$, true);
select pg_temp.chk('hs_kb', 'Khoá học: học sinh thấy đề nằm trong khoá học được giao', $q$select count(*) from practice_exams where title = 'ISO đề nhóm khác'$q$, '1');
select pg_temp.chk('hs_kb', 'Khoá học: học sinh làm được đề trong khoá học', $q$select (exam_start((select id from practice_exams where title = 'ISO đề nhóm khác')) ? 'attempt')::text$q$, 'true');
select pg_temp.chk('admin_kb', 'Khoá học: bài học dạng tệp phải thuộc thư mục của trường',
  format($q$insert into course_lessons (course_id, title, kind, path) select id, 'Tệp lạ', 'file', %L from courses where title = 'ISO khoá nhóm'$q$, pg_temp.oid_('THCS-PH') || '/x/iso-a.pdf'), 'ERR*');
-- Phân tích
select pg_temp.chk('admin_kb', 'Phân tích: câu hỏi của đề trường mình', $q$select count(*) from elearning_hard_questions((select id from practice_exams where title = 'ISO Đề luyện Toán 6'), null, null, null, null, 1)$q$, '3');
select pg_temp.chk('admin_ph', 'Phân tích: trường khác không thấy', format($q$select count(*) from elearning_hard_questions(%L, null, null, null, null, 1)$q$, (select id from practice_exams where title = 'ISO Đề luyện Toán 6')), '0');
select pg_temp.chk('so_bn', 'Phân tích: Sở thấy kết quả trường trực thuộc', format($q$select count(*) from elearning_topic_stats(%L)$q$, (select id from practice_exams where title = 'ISO Đề luyện Toán 6')), '>0');
select pg_temp.chk('so_hy', 'Phân tích: Sở tỉnh khác không thấy', format($q$select count(*) from elearning_topic_stats(%L)$q$, (select id from practice_exams where title = 'ISO Đề luyện Toán 6')), '0');
select pg_temp.chk('hs_kb', 'Phân tích: học sinh không xem phân tích của trường', $q$select count(*) from elearning_hard_questions()$q$, '0');
select pg_temp.chk('hs_kb', 'Ôn tập: học sinh xem chủ đề em cần ôn', $q$select count(*) from elearning_my_review()$q$, '>0');
select pg_temp.chk('admin_ph', 'Ôn tập: trường khác không xem của học sinh trường B', format($q$select count(*) from elearning_my_review(%L)$q$, (select id from students where student_code = 'ISO-001')), '0');

-- ===== 062: danh mục chương trình STEM CT1–CT5 =====
select pg_temp.chk('admin_ph', 'Danh mục nhóm chương trình: trường đọc được (CT1–CT5, KDI-SC, Đề xuất)', $q$select count(*) from stem_tracks$q$, '7');
select pg_temp.chk('hs_kb', 'Danh mục nhóm chương trình: học sinh đọc được', $q$select count(*) from stem_tracks$q$, '7');
select pg_temp.chk('kdi', 'Danh mục CT1–CT5: quản trị nền tảng sửa được',
  $q$with x as (update stem_tracks set description = description where code = 'CT1' returning 1) select count(*) from x$q$, '1');
select pg_temp.chk('so_hy', 'Danh mục CT1–CT5: Sở không sửa được', $q$with x as (update stem_tracks set name = 'ISO' where code = 'CT1' returning 1) select count(*) from x$q$, '0');
select pg_temp.chk('admin_ph', 'Danh mục CT1–CT5: trường không sửa được', $q$with x as (update stem_tracks set name = 'ISO' where code = 'CT1' returning 1) select count(*) from x$q$, '0');
select pg_temp.chk('kdi', 'Danh mục loại CT: mã sai định dạng bị chặn', $q$insert into stem_tracks (code, name, title) values ('ct 6', 'ISO', 'ISO')$q$, 'ERR*');
select pg_temp.chk('so_hy', 'Danh mục loại CT: Sở không xoá được', $q$with x as (delete from stem_tracks where code = 'CT5' returning 1) select count(*) from x$q$, '0');
select pg_temp.chk('kdi', 'Danh mục loại CT: không xoá loại đang được dùng', $q$with x as (delete from stem_tracks where code = 'CT5' returning 1) select count(*) from x$q$, 'ERR*');

-- ===== 063: bài giảng tương tác dạng khối, hoạt động trò chơi / mô phỏng, thiết bị trong gói STEM =====
select pg_temp.chk('gv_both', 'Bài giảng tương tác: lưu giáo án dạng khối',
  $q$insert into lesson_plans (org_id, teacher_id, title, lesson) values (my_org_id(), my_teacher_id(), 'ISO BG',
     '{"phases":[{"key":"a","title":"Khởi động","blocks":[{"id":"b1","type":"heading","text":"Xin chào"},{"id":"b2","type":"sim","model":"pendulum"}]}]}')$q$, 'rows:1');
select pg_temp.probe('gv_both@iso-test.local', $q$insert into lesson_plans (org_id, teacher_id, title, lesson) values (my_org_id(), my_teacher_id(), 'ISO BG',
     '{"phases":[{"key":"a","title":"Khởi động","blocks":[{"id":"b1","type":"heading","text":"Xin chào"},{"id":"b2","type":"sim","model":"pendulum"}]}]}')$q$, true);
select pg_temp.chk('gv_both', 'Bài giảng tương tác: khối không hợp lệ bị chặn',
  $q$insert into lesson_plans (org_id, teacher_id, title, lesson) values (my_org_id(), my_teacher_id(), 'ISO BG lỗi', '{"phases":[{"key":"a","title":"A","blocks":[{"id":"x","type":"script"}]}]}')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Bài giảng tương tác: giai đoạn phải là danh sách',
  $q$insert into lesson_plans (org_id, teacher_id, title, lesson) values (my_org_id(), my_teacher_id(), 'ISO BG lỗi', '{"phases":"x"}')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Bài giảng tương tác: tối đa 12 giai đoạn',
  $q$insert into lesson_plans (org_id, teacher_id, title, lesson) select my_org_id(), my_teacher_id(), 'ISO BG lỗi',
     jsonb_build_object('phases', jsonb_agg(jsonb_build_object('key', i, 'title', 'x', 'blocks', '[]'::jsonb))) from generate_series(1, 13) i$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Bài giảng tương tác: phiên bản lưu cả bài giảng',
  $q$select lesson_block_count(lesson_plan_content(p)->'lesson')::text from lesson_plans p where title = 'ISO BG'$q$, '2');
select pg_temp.probe('gv_both@iso-test.local', $q$select lesson_plan_clone((select id from lesson_plans where title = 'ISO BG'), 'ISO BG sao')::text$q$, true);
select pg_temp.chk('gv_both', 'Bài giảng tương tác: nhân bản giữ nguyên các khối', $q$select lesson_block_count(lesson)::text from lesson_plans where title = 'ISO BG sao'$q$, '2');
select pg_temp.chk('gv_ph2', 'Bài giảng tương tác: đồng nghiệp không đọc bản nháp', $q$select count(*) from lesson_plans where title = 'ISO BG'$q$, '0');
select pg_temp.chk('admin_kb', 'Bài giảng tương tác: trường khác không đọc', $q$select count(*) from lesson_plans where title like 'ISO BG%'$q$, '0');
-- Hoạt động mới
select pg_temp.chk('gv_both', 'Hoạt động đường đua: xuất bản khi đủ câu hỏi',
  $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'race', 'ISO hoạt động đua', 'published',
     '{"items":[{"q":"1+1?","options":["1","2"],"answer":1},{"q":"2+2?","options":["4","5"],"answer":0}],"seconds":20}')$q$, 'rows:1');
select pg_temp.probe('gv_both@iso-test.local', $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'race', 'ISO hoạt động đua', 'published',
     '{"items":[{"q":"1+1?","options":["1","2"],"answer":1},{"q":"2+2?","options":["4","5"],"answer":0}],"seconds":20}')$q$, true);
select pg_temp.chk('gv_both', 'Hoạt động đường đua: đáp án ngoài phương án bị chặn',
  $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'race', 'ISO hoạt động đua lỗi', 'published',
     '{"items":[{"q":"1+1?","options":["1","2"],"answer":3}]}')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Hoạt động đường đua: chấm như trắc nghiệm',
  $q$select activity_grade('race', content, '[1,1]')->>'correct' from activities where title = 'ISO hoạt động đua'$q$, '1');
select pg_temp.chk('gv_both', 'Hoạt động vòng quay: cần ít nhất 2 tên',
  $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'wheel', 'ISO hoạt động quay', 'published', '{"names":["An"]}')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Hoạt động chia đội: xuất bản được',
  $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'teams', 'ISO hoạt động đội', 'published', '{"names":["An","Bình","Chi","Dũng"],"teams":2}')$q$, 'rows:1');
select pg_temp.chk('gv_both', 'Hoạt động mô phỏng: mô hình không có trong danh mục bị chặn',
  $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'sim', 'ISO hoạt động mô phỏng', 'published', '{"model":"rocket"}')$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Hoạt động mô phỏng: con lắc xuất bản được',
  $q$insert into activities (org_id, teacher_id, kind, title, status, content) values (my_org_id(), my_teacher_id(), 'sim', 'ISO hoạt động con lắc', 'published', '{"model":"pendulum","task":"Đo chu kì"}')$q$, 'rows:1');
select pg_temp.chk('admin_kb', 'Hoạt động mới: trường khác không đọc', $q$select count(*) from activities where title in ('ISO hoạt động đua', 'ISO hoạt động con lắc')$q$, '0');
-- Thiết bị trong gói STEM
select pg_temp.chk('admin_ph', 'Thiết bị gói: trường thêm thiết bị vào gói của mình',
  $q$insert into package_devices (org_id, package_id, supplier, name, qty, unit_price, serials)
     select my_org_id(), delivered_package_id, 'ISO NCC', 'ISO Bộ Arduino', 12, 850000, '{" SN-1 ",SN-2}' from package_orders where name = 'Đơn thử ISO'$q$, 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into package_devices (org_id, package_id, supplier, name, qty, unit_price, serials)
     select my_org_id(), delivered_package_id, 'ISO NCC', 'ISO Bộ Arduino', 12, 850000, '{" SN-1 ",SN-2}' from package_orders where name = 'Đơn thử ISO'$q$, true);
select pg_temp.chk('admin_ph', 'Thiết bị gói: số thiết bị của gói tự cập nhật, số seri được làm gọn',
  $q$select (p.devices = (select sum(qty) from package_devices x where x.package_id = p.id))::text || ':' || d.serials[1] from package_devices d join stem_packages p on p.id = d.package_id where d.name = 'ISO Bộ Arduino'$q$, 'true:SN-1');
select pg_temp.chk('so_hy', 'Thiết bị gói: Sở xem thiết bị của trường trực thuộc', $q$select count(*) from package_devices where name = 'ISO Bộ Arduino'$q$, '1');
select pg_temp.chk('admin_kb', 'Thiết bị gói: trường khác không xem', $q$select count(*) from package_devices where name = 'ISO Bộ Arduino'$q$, '0');
select pg_temp.chk('hs_kb', 'Thiết bị gói: học sinh không xem', $q$select count(*) from package_devices$q$, '0');
select pg_temp.chk('admin_kb', 'Thiết bị gói: không thêm vào gói của trường khác',
  format($q$insert into package_devices (org_id, package_id, name) values (my_org_id(), %L, 'ISO lạ')$q$, (select delivered_package_id from package_orders where name = 'Đơn thử ISO')), 'ERR*');
select pg_temp.chk('admin_kb', 'Thiết bị gói: không sửa thiết bị của trường khác', $q$update package_devices set qty = 1 where name = 'ISO Bộ Arduino'$q$, 'rows:0');
select pg_temp.chk('gv_both', 'Thiết bị gói: giáo viên không thêm thiết bị',
  $q$insert into package_devices (org_id, package_id, name) select my_org_id(), delivered_package_id, 'ISO GV' from package_orders where name = 'Đơn thử ISO'$q$, 'ERR*');

-- ===== 065: bài học trong kho học liệu, danh mục cấp học & khối =====
select pg_temp.probe('so_hy@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, status, content) values (my_org_id(), 'lesson', 'ISO BG cho bài học', 'published',
  jsonb_build_object('slides', jsonb_build_array(jsonb_build_object('id','x','kind','title','title','ISO'))))$q$, true);
select pg_temp.chk('so_hy', 'Bài học trong kho: Sở tạo được',
  $q$insert into library_items (owner_org_id, kind, title, content) values (my_org_id(), 'unit', 'ISO bài học kho', jsonb_build_object('objectives', ' Hiểu mạch ', 'periods', '2', 'lesson_ids', jsonb_build_array((select id from library_items where title = 'ISO BG cho bài học')::text, 'rác')))$q$, 'rows:1');
select pg_temp.probe('so_hy@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, content) values (my_org_id(), 'unit', 'ISO bài học kho',
  jsonb_build_object('objectives', ' Hiểu mạch ', 'periods', '2', 'norm_ids', '"x"', 'checked', jsonb_build_array('info', 'content', 'links', 'norms', 'bank'), 'lesson_ids', jsonb_build_array((select id from library_items where title = 'ISO BG cho bài học')::text, 'rác', (select id from library_items where title = 'ISO BG cho bài học')::text)))$q$, true);
select pg_temp.chk('so_hy', 'Bài học trong kho: thành phần được làm gọn (bỏ mã lạ, bỏ trùng)',
  $q$select jsonb_array_length(content->'lesson_ids') || '/' || jsonb_array_length(content->'norm_ids') || '/' || (content->>'periods') || '/' || (content->>'objectives') from library_items where title = 'ISO bài học kho'$q$, '1/0/2/Hiểu mạch');
select pg_temp.chk('so_hy', 'Kho học liệu: loại mục lạ bị chặn', $q$insert into library_items (owner_org_id, kind, title) values (my_org_id(), 'khac', 'ISO lạ')$q$, 'ERR*');
select pg_temp.probe('so_hy@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO bài học kho'))::text$q$, true);
select pg_temp.chk('admin_ph', 'Bài học trong kho: trường trực thuộc thấy', $q$select count(*) from library_items where title = 'ISO bài học kho' and kind = 'unit'$q$, '1');
select pg_temp.chk('admin_kb', 'Bài học trong kho: trường tỉnh khác không thấy', $q$select count(*) from library_items where title = 'ISO bài học kho'$q$, '0');
select pg_temp.chk('admin_ph', 'Dùng bài học → tạo bài giảng mẫu từ bài giảng được gắn',
  $q$select (library_adopt((select id from library_items where title = 'ISO bài học kho'), true)->>'count')$q$, '1');
select pg_temp.probe('admin_ph@iso-test.local', $q$select library_adopt((select id from library_items where title = 'ISO bài học kho'), true)::text$q$, true);
select pg_temp.chk('admin_ph', 'Dùng bài học: có bài giảng mẫu của trường',
  $q$select count(*) from lesson_plans where is_template and org_id = my_org_id() and library_item_id = (select id from library_items where title = 'ISO BG cho bài học')$q$, '1');
-- 077: bộ học liệu 4 thẻ của bài học
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: tạo bài học đã phát hành mà chưa chốt đủ thẻ bị chặn',
  $q$insert into library_items (owner_org_id, kind, title, status, content) values (my_org_id(), 'unit', 'ISO bộ thiếu', 'published', jsonb_build_object('checked', jsonb_build_array('info', 'content', 'links')))$q$, 'ERR 22023');
select pg_temp.probe('so_hy@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, content) values (my_org_id(), 'unit', 'ISO bộ 4 thẻ',
  jsonb_build_object('objectives', 'A', 'checked', jsonb_build_array('norms', 'info', 'rác', 'info', 'content')))$q$, true);
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: chỉ giữ thẻ hợp lệ, không trùng, theo thứ tự', $q$select content->>'checked' from library_items where title = 'ISO bộ 4 thẻ'$q$, '["info", "content", "norms"]');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: chưa chốt đủ 4 thẻ thì không phát hành', $q$select library_publish((select id from library_items where title = 'ISO bộ 4 thẻ'))::text$q$, 'ERR 22023');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: sửa mục tiêu → thẻ Thông tin về "Cần kiểm tra"',
  $q$with u as (update library_items set content = content || '{"objectives": "B"}' where title = 'ISO bộ 4 thẻ' returning content->>'checked' c) select c from u$q$, '["content", "norms"]');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: sửa và đổi chốt cùng lúc thì giữ theo người soạn',
  $q$with u as (update library_items set content = content || '{"objectives": "B", "checked": ["info", "content", "links", "norms", "bank"]}' where title = 'ISO bộ 4 thẻ' returning content->'checked' c) select jsonb_array_length(c)::text from u$q$, '5');
select pg_temp.probe('so_hy@iso-test.local', $q$update library_items set content = content || '{"checked": ["info", "content", "links", "norms", "bank"]}' where title = 'ISO bộ 4 thẻ'$q$, true);
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: chốt đủ 5 thẻ thì phát hành được', $q$select library_publish((select id from library_items where title = 'ISO bộ 4 thẻ'))::text$q$, '1');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: thêm học liệu vào bài → thẻ Link tài liệu về "Cần kiểm tra"',
  $q$with u as (update library_items set content = content || jsonb_build_object('material_ids', jsonb_build_array(gen_random_uuid())) where title = 'ISO bộ 4 thẻ' returning content->>'checked' c) select c from u$q$, '["info", "content", "norms", "bank"]');
-- 080: nội dung 4 thẻ có cấu trúc (content.kit) được giữ lại; sửa phần của thẻ đã chốt thì thẻ đó về "Cần kiểm tra"
select pg_temp.probe('so_hy@iso-test.local', $q$update library_items set content = content || '{"kit": {"info": {"description": "A"}, "sessions": [], "docs": [], "mats": {"product": [], "group": []}}}' where title = 'ISO bộ 4 thẻ'$q$, true);
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: thêm nội dung cho cả 4 thẻ đã chốt → cả 4 về "Cần kiểm tra"', $q$select content->>'checked' from library_items where title = 'ISO bộ 4 thẻ'$q$, '["bank"]');
select pg_temp.probe('so_hy@iso-test.local', $q$update library_items set content = content || '{"checked": ["info", "content", "links", "norms", "bank"]}' where title = 'ISO bộ 4 thẻ'$q$, true);
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: content.kit được giữ lại', $q$select content->'kit'->'info'->>'description' from library_items where title = 'ISO bộ 4 thẻ'$q$, 'A');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: lưu không kèm kit (form cũ) thì giữ kit đang có', $q$with u as (update library_items set content = content - 'kit' where title = 'ISO bộ 4 thẻ' returning content->'kit'->'info'->>'description' c) select c from u$q$, 'A');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: khoá lạ ngoài kit vẫn bị bỏ', $q$with u as (update library_items set content = content || '{"rác": 1}' where title = 'ISO bộ 4 thẻ' returning content ? 'rác' c) select c::text from u$q$, 'false');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: sửa buổi học (kit.sessions) → thẻ Nội dung về "Cần kiểm tra"',
  $q$with u as (update library_items set content = jsonb_set(content, '{kit,sessions}', '[{"note": "", "acts": []}]') where title = 'ISO bộ 4 thẻ' returning content->>'checked' c) select c from u$q$, '["info", "links", "norms", "bank"]');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: sửa vật tư (kit.mats) → thẻ Định mức về "Cần kiểm tra"',
  $q$with u as (update library_items set content = jsonb_set(content, '{kit,mats,product}', '[{"name": "Giấy"}]') where title = 'ISO bộ 4 thẻ' returning content->>'checked' c) select c from u$q$, '["info", "content", "links", "bank"]');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: sửa vật tư và bỏ chốt cùng lúc thì giữ đúng lựa chọn của người soạn',
  $q$with u as (update library_items set content = jsonb_set(content, '{kit,mats,product}', '[{"name": "Giấy"}]') || '{"checked": ["info", "content", "norms"]}' where title = 'ISO bộ 4 thẻ' returning content->>'checked' c) select c from u$q$, '["info", "content", "norms"]');
select pg_temp.chk('so_hy', 'Bộ 4 thẻ: kit quá lớn bị chặn',
  $q$update library_items set content = content || jsonb_build_object('kit', jsonb_build_object('issues', jsonb_build_array(repeat('x', 700000)))) where title = 'ISO bộ 4 thẻ'$q$, 'ERR 22023');
-- 081: thẻ 05 Kho hoạt động
select pg_temp.probe('so_hy@iso-test.local', $q$update library_items set content = content || '{"checked": ["info", "content", "links", "norms", "bank"]}' where title = 'ISO bộ 4 thẻ'$q$, true);
select pg_temp.chk('so_hy', 'Bộ 5 thẻ: sửa kho hoạt động (kit.bank) → thẻ 05 về "Cần kiểm tra"',
  $q$with u as (update library_items set content = jsonb_set(content, '{kit,bank}', '[{"title": "Đố vui", "kind": "quiz"}]') where title = 'ISO bộ 4 thẻ' returning content->>'checked' c) select c from u$q$, '["info", "content", "links", "norms"]');
select pg_temp.chk('so_hy', 'Bộ 5 thẻ: kit.bank được giữ lại',
  $q$with u as (update library_items set content = jsonb_set(content, '{kit,bank}', '[{"title": "Đố vui", "kind": "quiz"}]') where title = 'ISO bộ 4 thẻ' returning content->'kit'->'bank'->0->>'title' c) select c from u$q$, 'Đố vui');
select pg_temp.probe('so_hy@iso-test.local', $q$update library_items set content = content || '{"checked": ["info", "content", "links", "norms"]}' where title = 'ISO bộ 4 thẻ'$q$, true);
select pg_temp.chk('so_hy', 'Bộ 5 thẻ: chưa chốt thẻ 05 thì không phát hành bản cập nhật', $q$select library_publish((select id from library_items where title = 'ISO bộ 4 thẻ'))::text$q$, 'ERR 22023');
select pg_temp.chk('so_hy', 'Bộ 5 thẻ: tên thẻ lạ vẫn bị bỏ', $q$select public.library_unit_checked('["bank", "rác", "info"]')::text$q$, '["info", "bank"]');
-- Cấp học & khối
select pg_temp.chk('hs_kb', 'Cấp học: mọi người đọc được danh mục', $q$select count(*) from edu_levels where code in ('tieuhoc', 'thcs', 'thpt')$q$, '3');
select pg_temp.chk('so_hy', 'Cấp học: Sở không thêm được', $q$insert into edu_levels (code, name, grade_from, grade_to) values ('iso_mn', 'ISO', 1, 2)$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Cấp học: trường không sửa được', $q$update edu_levels set name = 'ISO' where code = 'thcs'$q$, 'rows:0');
select pg_temp.chk('kdi', 'Cấp học: KDI thêm được', $q$insert into edu_levels (code, name, grade_from, grade_to, sort) values ('iso_lien', 'ISO liên cấp', 6, 12, 9)$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_levels (code, name, grade_from, grade_to, sort) values ('iso_lien', 'ISO liên cấp', 6, 12, 9)$q$, true);
select pg_temp.chk('kdi', 'Cấp học: khối đến nhỏ hơn khối từ bị chặn', $q$insert into edu_levels (code, name, grade_from, grade_to) values ('iso_sai', 'ISO', 9, 6)$q$, 'ERR*');
select pg_temp.chk('kdi', 'Cấp học: không đổi mã', $q$update edu_levels set code = 'iso_moi' where code = 'iso_lien'$q$, 'ERR*');
select pg_temp.chk('kdi', 'Chương trình: dùng cấp học mới với khối liên cấp',
  $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject) values (platform_org_id(), 'ISO CT liên cấp', 'CT1', 'iso_lien', 8, 11, 'Tin học')$q$, 'rows:1');
select pg_temp.chk('kdi', 'Chương trình: khối ngoài cấp học bị chặn',
  $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject) values (platform_org_id(), 'ISO CT sai khối', 'CT1', 'thcs', 8, 10, 'Tin học')$q$, 'ERR*');
select pg_temp.chk('kdi', 'Chương trình: cấp học không có trong danh mục bị chặn',
  $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject) values (platform_org_id(), 'ISO CT lạ', 'CT1', 'mamnon', 1, 1, 'Tin học')$q$, 'ERR*');
select pg_temp.chk('kdi', 'Cấp học: không thu hẹp khối làm chương trình đang có nằm ngoài', $q$update edu_levels set grade_to = 8 where code = 'thcs'$q$, 'ERR*');
select pg_temp.chk('kdi', 'Cấp học: đổi tên được', $q$update edu_levels set name = 'Trung học cơ sở' where code = 'thcs'$q$, 'rows:1');
select pg_temp.chk('kdi', 'Môn học: cấp học lạ bị bỏ khi lưu',
  $q$with x as (insert into subjects (org_id, name, levels) values (platform_org_id(), 'ISO môn cấp', '{thcs,mamnon,iso_lien}') returning levels) select array_to_string(levels, ',') from x$q$, 'thcs,iso_lien');

-- ===== 066: giáo án soạn trong kho học liệu =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, status, scope, content) values (my_org_id(), 'material', 'ISO giáo án kho', 'draft', 'public',
  jsonb_build_object('type', 'lesson_plan', 'periods', '2', 'template_id', 'rác', 'doc', jsonb_build_object('Mục tiêu', 'Hiểu mạch', 'x', 5),
    'steps', jsonb_build_array(jsonb_build_object('id', 'a', 'phase', 'khoi_dong', 'title', 'Khởi động', 'minutes', 5, 'teacher', 'Đặt câu hỏi', 'bad', 1),
                               jsonb_build_object('title', '  '), jsonb_build_object('title', 'Thực hành', 'minutes', 999))))$q$, true);
select pg_temp.chk('kdi', 'Giáo án trong kho: nội dung được làm gọn (mục, bước, số tiết, mẫu)',
  $q$select (content->'doc')::text || '|' || jsonb_array_length(content->'steps') || '|' || (content->>'periods') || '|' || coalesce(content->>'template_id', 'null') || '|' || coalesce(content->'steps'->1->>'minutes', '-') || '|' || ((content->'steps'->0) ? 'bad')::text
     from library_items where title = 'ISO giáo án kho'$q$, '{"Mục tiêu": "Hiểu mạch"}|2|2|null|-|false');
select pg_temp.chk('kdi', 'Giáo án trong kho: phát hành được khi chưa có tệp', $q$select library_publish((select id from library_items where title = 'ISO giáo án kho'))::text$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO giáo án kho'))::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select library_adopt((select id from library_items where title = 'ISO giáo án kho'))::text$q$, true);
select pg_temp.chk('gv_both', 'Dùng giáo án trong kho → giáo án của GV có đủ mục, các bước, số tiết',
  $q$select (doc->>'Mục tiêu') || '|' || jsonb_array_length(steps) || '|' || periods from lesson_plans where teacher_id = my_teacher_id() and library_item_id = (select id from library_items where title = 'ISO giáo án kho')$q$, 'Hiểu mạch|2|2');

-- ===== 067: bài giảng đính kèm tệp / đường dẫn =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, status, scope, content) values (my_org_id(), 'lesson', 'ISO bài giảng link', 'draft', 'public',
  jsonb_build_object('slides', '[]'::jsonb, 'url', 'https://example.com/bai-giang'))$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, status, scope, content) values (my_org_id(), 'lesson', 'ISO bài giảng trống', 'draft', 'public',
  jsonb_build_object('slides', '[]'::jsonb))$q$, true);
select pg_temp.chk('kdi', 'Bài giảng chỉ có đường dẫn: phát hành được', $q$select library_publish((select id from library_items where title = 'ISO bài giảng link'))::text$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO bài giảng link'))::text$q$, true);
select pg_temp.chk('kdi', 'Bài giảng không slide, không tệp: không phát hành được', $q$select library_publish((select id from library_items where title = 'ISO bài giảng trống'))::text$q$, 'ERR*');
select pg_temp.probe('gv_both@iso-test.local', $q$select library_adopt((select id from library_items where title = 'ISO bài giảng link'))::text$q$, true);
select pg_temp.chk('gv_both', 'Dùng bài giảng có đường dẫn → slide tham khảo chứa đường dẫn',
  $q$select jsonb_array_length(slides) || '|' || (slides->-1->>'body') from lesson_plans where teacher_id = my_teacher_id() and library_item_id = (select id from library_items where title = 'ISO bài giảng link')$q$, '2|https://example.com/bai-giang');

-- ===== 068: tạm tắt duyệt nhóm Chương trình & học liệu =====
insert into approval_bypass (kind, note) values ('curriculum_plan', 'ISO'), ('lesson_plan', 'ISO');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into curriculum_books (org_id, grade, subject, title, status) values (my_org_id(), 7, 'ISO Môn tự duyệt', 'ISO PPCT tự duyệt', 'draft')$q$, true);
select pg_temp.probe('admin_ph@iso-test.local', $q$update curriculum_books set status = 'pending' where title = 'ISO PPCT tự duyệt'$q$, true);
select pg_temp.chk('admin_ph', 'Tạm tắt duyệt: gửi duyệt PPCT → đã duyệt ngay', $q$select status from curriculum_books where title = 'ISO PPCT tự duyệt'$q$, 'approved');
select pg_temp.chk('admin_ph', 'Tạm tắt duyệt: hồ sơ ghi "Tự duyệt", không còn chờ',
  $q$select r.status || '|' || a.note from approval_requests r join approval_actions a on a.request_id = r.id where r.title = 'ISO PPCT tự duyệt'$q$, 'approved|Tự duyệt (đang tạm tắt duyệt)');
select pg_temp.probe('gv_ph2@iso-test.local', $q$insert into lesson_plans (org_id, teacher_id, title, steps) values (my_org_id(), my_teacher_id(), 'ISO GA tự duyệt', '[{"id":"s1","title":"Khởi động"}]')$q$, true);
select pg_temp.probe('gv_ph2@iso-test.local', $q$update lesson_plans set status = 'pending' where title = 'ISO GA tự duyệt'$q$, true);
select pg_temp.chk('gv_ph2', 'Tạm tắt duyệt: gửi duyệt giáo án → đã duyệt, xuất bản được',
  $q$select status || '|' || lesson_plan_publish(id) from lesson_plans where title = 'ISO GA tự duyệt'$q$, 'approved|1');
select pg_temp.chk('admin_ph', 'Tạm tắt duyệt: giáo án không bắt buộc duyệt', $q$select lesson_review_required(my_org_id())::text$q$, 'false');
select pg_temp.chk('admin_ph', 'Tạm tắt duyệt: người dùng không đọc / sửa được danh sách', $q$delete from approval_bypass$q$, 'ERR*');
delete from approval_bypass;
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into curriculum_books (org_id, grade, subject, title, status) values (my_org_id(), 7, 'ISO Môn bật lại', 'ISO PPCT bật lại', 'draft')$q$, true);
select pg_temp.probe('admin_ph@iso-test.local', $q$update curriculum_books set status = 'pending' where title = 'ISO PPCT bật lại'$q$, true);
select pg_temp.chk('admin_ph', 'Bật lại duyệt: gửi duyệt PPCT → chờ duyệt', $q$select status from curriculum_books where title = 'ISO PPCT bật lại'$q$, 'pending');

-- ===== 070: bài giảng tương tác trong kho học liệu =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, status, scope, program, content) values (my_org_id(), 'lesson', 'ISO bài giảng tương tác', 'draft', 'public', 'CT1',
  '{"mode":"interactive","lesson":{"phases":[{"key":"k","title":"Khởi động","minutes":5,"blocks":[{"id":"b1","type":"text","text":"Xin chào"},{"id":"b2","type":"quiz","items":[]}]}]}}'::jsonb)$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into library_items (owner_org_id, kind, title, status, scope, content) values (my_org_id(), 'lesson', 'ISO bài giảng tương tác trống', 'draft', 'public',
  '{"mode":"interactive","lesson":{"phases":[{"key":"k","title":"Khởi động","minutes":5,"blocks":[]}]}}'::jsonb)$q$, true);
select pg_temp.chk('kdi', 'Bài giảng tương tác chưa có khối: không phát hành được', $q$select library_publish((select id from library_items where title = 'ISO bài giảng tương tác trống'))::text$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$select library_publish((select id from library_items where title = 'ISO bài giảng tương tác'))::text$q$, true);
select pg_temp.chk('kdi', 'Bài giảng tương tác có khối: đã phát hành', $q$select status from library_items where title = 'ISO bài giảng tương tác'$q$, 'published');
select pg_temp.probe('gv_both@iso-test.local', $q$select library_adopt((select id from library_items where title = 'ISO bài giảng tương tác'))::text$q$, true);
select pg_temp.chk('gv_both', 'Dùng bài giảng tương tác → giáo án có đủ khối nội dung',
  $q$select lesson_block_count(lesson) || '|' || program from lesson_plans where teacher_id = my_teacher_id() and library_item_id = (select id from library_items where title = 'ISO bài giảng tương tác')$q$, '2|CT1');

-- ===== 071: kế hoạch năm, phân bổ tiết, chuyển năm học =====
select pg_temp.chk('admin_ph', 'Kế hoạch năm: PPCT của trường không ghi năm học → năm học hiện tại',
  $q$with i as (insert into curriculum_books (org_id, grade, subject, title, status) values (my_org_id(), 8, 'ISO Môn năm học', 'ISO PPCT năm học', 'draft') returning year_name) select year_name from i$q$, '2026-2027');
select pg_temp.chk('admin_ph', 'Kế hoạch năm: năm học không có trong danh mục của trường → lỗi',
  $q$insert into curriculum_books (org_id, grade, subject, title, year_name) values (my_org_id(), 8, 'ISO Môn năm lạ', 'ISO PPCT năm lạ', '1999-2000')$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Kế hoạch năm: số tuần HK I theo ngày của năm học, HK II mặc định 17',
  $q$select hk1 || '|' || hk2 from curriculum_term_weeks(my_org_id(), '2026-2027')$q$, '19|17');
select pg_temp.probe('kdi@iso-test.local', $q$select curriculum_from_program((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), 6, null, null, 1)::text$q$, true);
select pg_temp.chk('kdi', 'Phân bổ tiết: KDI tạo mẫu PPCT từ chương trình (cho đơn vị trực thuộc, không năm học)',
  $q$select b.scope || ':' || coalesce(b.year_name, '-') || ':' || count(l.id) from curriculum_books b join curriculum_lessons l on l.book_id = b.id
     where b.title = 'ISO CT KDI — khối 6' and b.org_id = platform_org_id() group by b.id$q$, 'children:-:4');
select pg_temp.chk('gv_both', 'Phân bổ tiết: giáo viên không sinh lại PPCT',
  $q$select curriculum_generate((select id from curriculum_books where title = 'ISO CT KDI — khối 6' and org_id = my_org_id()))::text$q$, 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_generate(b.id,
    (select jsonb_agg(jsonb_build_object('unit_id', u.id, 'periods', case when u.title = 'ISO bài 1' then 3 else 1 end, 'term', case when u.title = 'ISO bài 1' then 1 else 2 end))
       from edu_program_units u where u.program_id = b.program_id and u.unit_type = 'lesson'), true, true, 'ISO phân bổ')::text
  from curriculum_books b where b.title = 'ISO CT KDI — khối 6' and b.org_id = my_org_id()$q$, true);
select pg_temp.chk('admin_ph', 'Phân bổ tiết: HK I 3 tiết + ôn tập + kiểm tra, HK II bắt đầu tuần 20',
  $q$select count(*) || ':' || count(*) filter (where l.term = 1) || ':' || count(*) filter (where l.term = 2) || ':' || min(l.week) filter (where l.term = 2)
       || ':' || jsonb_array_length(b.allocation)
     from curriculum_lessons l join curriculum_books b on b.id = l.book_id where b.title = 'ISO CT KDI — khối 6' and b.org_id = my_org_id() group by b.id$q$, '8:5:3:20:2');
select pg_temp.chk('admin_ph', 'Kế hoạch năm: đếm số tiết HK I / HK II của PPCT',
  $q$select hk1 || '|' || hk2 from curriculum_term_counts(array[(select id from curriculum_books where title = 'ISO CT KDI — khối 6' and org_id = my_org_id())])$q$, '5|3');
insert into academic_years (org_id, name, term, starts_on, ends_on, is_current) values (pg_temp.oid_('THCS-PH'), 'ISO 2027-2028', 'HK I', '2027-09-05', '2028-01-15', false);
select pg_temp.chk('admin_ph', 'Chuyển năm học: sao chép PPCT sang năm mới', $q$select (curriculum_rollover('2026-2027', 'ISO 2027-2028') > 0)::text$q$, 'true');
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_rollover('2026-2027', 'ISO 2027-2028')$q$, true);
select pg_temp.chk('admin_ph', 'Chuyển năm học: bản nháp, đủ tiết, giữ phân bổ, chạy lại không trùng',
  $q$select count(distinct b.id) || ':' || min(b.status) || ':' || count(l.id) || ':' || jsonb_array_length(min(b.allocation::text)::jsonb)
     from curriculum_books b join curriculum_lessons l on l.book_id = b.id where b.title = 'ISO CT KDI — khối 6' and b.year_name = 'ISO 2027-2028'$q$, '1:draft:8:2');
select pg_temp.chk('gv_both', 'Chuyển năm học: giáo viên không chuyển được', $q$select curriculum_rollover('2026-2027', 'ISO 2027-2028')::text$q$, 'ERR');
delete from curriculum_books where year_name = 'ISO 2027-2028';
delete from academic_years where name = 'ISO 2027-2028';

-- ===== 072: lịch dự kiến theo tuần học, xếp lại lịch =====
select pg_temp.chk('admin_ph', 'Lịch: khai giảng thứ Bảy → tuần 1 từ thứ Hai kế tiếp; HK I 19 tuần học, HK II 17 tuần',
  $q$select min(starts_on) || '|' || count(week) filter (where term = 1) || '|' || count(week) filter (where term = 2) from curriculum_calendar(my_org_id(), '2026-2027')$q$, '2026-09-07|19|17');
insert into school_holidays (org_id, name, starts_on, ends_on) values (pg_temp.oid_('THCS-PH'), 'ISO nghỉ cả tuần', '2026-11-16', '2026-11-20');
select pg_temp.chk('admin_ph', 'Lịch: tuần nghỉ cả 5 ngày không tính số tuần, ngày trong tuần nghỉ thuộc tuần học liền trước',
  $q$select (select coalesce(week::text, 'nghỉ') || ':' || (holiday like '%ISO nghỉ cả tuần%') from curriculum_calendar(my_org_id(), '2026-2027') where starts_on = '2026-11-16')
     || '|' || (select hk1 from curriculum_term_weeks(my_org_id(), '2026-2027')) || '|' || curriculum_week_of(my_org_id(), '2026-2027', '2026-11-18')
     || '|' || curriculum_week_of(my_org_id(), '2026-2027', '2026-11-25')$q$, 'nghỉ:true|18|10|11');
delete from school_holidays where name = 'ISO nghỉ cả tuần';
select pg_temp.probe('kdi@iso-test.local', $q$update curriculum_lessons set week = 10 where book_id = (select id from curriculum_books where title = 'ISO CT KDI — khối 6' and org_id = platform_org_id()) and seq = 1$q$, true);
select pg_temp.chk('gv_both', 'Xếp lại lịch: giáo viên không xếp được',
  $q$select curriculum_reschedule((select id from curriculum_books where title = 'ISO CT KDI — khối 6' and org_id = platform_org_id()))::text$q$, 'ERR');
select pg_temp.probe('kdi@iso-test.local', $q$select curriculum_reschedule((select id from curriculum_books where title = 'ISO CT KDI — khối 6' and org_id = platform_org_id()))$q$, true);
select pg_temp.chk('kdi', 'Xếp lại lịch: mẫu không năm học xếp từ tuần 1, mỗi tuần đủ số tiết / tuần',
  $q$select min(week) || '-' || max(week) || '|' || count(distinct week) from curriculum_lessons where book_id = (select id from curriculum_books where title = 'ISO CT KDI — khối 6' and org_id = platform_org_id())$q$, '1-4|4');

-- ===== 073: gán chương trình cho nhiều trường, tạo sẵn PPCT, lớp × môn =====
select pg_temp.chk('so_hy', 'Gán hàng loạt: Sở không gán cho trường ngoài địa bàn',
  format($q$select edu_program_assign_bulk((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), array[%L]::uuid[], '{6}', true)::text$q$, pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('so_bn', 'Gán hàng loạt: gán + tạo sẵn PPCT nháp từ chương trình cho khối được gán',
  format($q$select edu_program_assign_bulk((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), array[%L]::uuid[], '{6,7}', true)::text$q$, pg_temp.oid_('THCS-KB')), '{"books": 1, "assigned": 1}');
select pg_temp.probe('so_bn@iso-test.local', format($q$select edu_program_assign_bulk((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), array[%L]::uuid[], '{6}', true)::text$q$, pg_temp.oid_('THCS-KB')), true);
select pg_temp.chk('so_bn', 'Gán hàng loạt: PPCT tạo sẵn là nháp của trường, theo năm học hiện tại, đủ tiết; gán lại không tạo trùng',
  format($q$select count(distinct b.id) || ':' || min(b.status) || ':' || min(b.year_name) || ':' || count(l.id) || ':'
       || (select edu_program_assign_bulk((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), array[%L]::uuid[], '{6}', true)->>'books')
     from curriculum_books b join curriculum_lessons l on l.book_id = b.id where b.org_id = %L and b.title = 'ISO CT KDI — khối 6'$q$, pg_temp.oid_('THCS-KB'), pg_temp.oid_('THCS-KB')), '1:draft:2025-2026:4:0');
select pg_temp.chk('gv_both', 'Gán hàng loạt: giáo viên không tạo PPCT cho trường',
  format($q$select curriculum_seed_school_books((select id from edu_programs where title = 'ISO CT KDI' and org_id = platform_org_id() and version_no = 2), %L)::text$q$, pg_temp.oid_('THCS-KB')), 'ERR');
select pg_temp.chk('admin_ph', 'Lớp × môn: thấy lớp nào đang theo PPCT nào', $q$select (count(*) > 0)::text from curriculum_class_coverage() where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử')$q$, 'true');
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_set_class_book(c.class_id, 'ISO Toán PPCT', c.book_id) from curriculum_class_coverage() c where c.book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') order by c.class_name limit 1$q$, true);
select pg_temp.chk('admin_ph', 'Lớp × môn: chọn riêng PPCT cho lớp', $q$select bool_or(explicit)::text from curriculum_class_coverage() where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử')$q$, 'true');
select pg_temp.chk('admin_ph', 'Lớp × môn: PPCT khác khối / môn bị từ chối',
  $q$select curriculum_set_class_book(c.class_id, 'ISO Toán PPCT', (select id from curriculum_books where title = 'ISO PPCT tự duyệt')) from curriculum_class_coverage() c where c.book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') limit 1$q$, 'ERR*');
select pg_temp.chk('gv_both', 'Lớp × môn: giáo viên không đổi PPCT của lớp',
  $q$select curriculum_set_class_book(x.class_id, 'ISO Toán PPCT', x.book_id)::text from curriculum_book_classes x where x.book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') limit 1$q$, 'ERR*');

-- ===== 074: điều chỉnh có lý do, phiên bản, kế hoạch / thực hiện, cảnh báo lớp chậm =====
update curriculum_lessons set week = seq where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử');
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_shift((select id from curriculum_books where title = 'ISO PPCT lớp thử'), 8, 2, 'holiday', 'ISO nghỉ bão')$q$, true);
select pg_temp.chk('admin_ph', 'Điều chỉnh: dời tiết từ tiết 8 lùi 2 tuần, nhật ký có mã lý do, có phiên bản sau điều chỉnh',
  $q$select (select week from curriculum_lessons where book_id = b.id and seq = 10) || '|' ||
            (select action || ':' || reason_code || ':' || reason from curriculum_changes where book_id = b.id order by id desc limit 1) || '|' ||
            (select string_agg(action, ',' order by version_no) from curriculum_book_versions where book_id = b.id)
     from curriculum_books b where b.title = 'ISO PPCT lớp thử'$q$, '12|shift:holiday:ISO nghỉ bão|shift');
select pg_temp.chk('gv_both', 'Điều chỉnh: giáo viên không dời tiết', $q$select curriculum_shift((select id from curriculum_books where title = 'ISO PPCT lớp thử'), 1, 1)::text$q$, 'ERR');
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_swap((select id from curriculum_books where title = 'ISO PPCT lớp thử'), 9, 10, 'reteach')$q$, true);
select pg_temp.probe('admin_ph@iso-test.local', $q$select curriculum_insert_after((select id from curriculum_books where title = 'ISO PPCT lớp thử'), 5, 'ISO dạy bù', 'lesson', null, 'reteach')$q$, true);
select pg_temp.chk('admin_ph', 'Điều chỉnh: đổi chỗ 2 tiết, chèn tiết dạy bù sau tiết 5 (các tiết sau lùi số)',
  $q$select (select string_agg(seq || '=' || title, ',' order by seq) from curriculum_lessons where book_id = b.id and seq in (6, 10, 11)) || '|' || b.total_periods
     from curriculum_books b where b.title = 'ISO PPCT lớp thử'$q$, '6=ISO dạy bù,10=ISO tiết 10,11=ISO tiết 9 sửa|11');
select pg_temp.probe('admin_ph@iso-test.local', $q$update curriculum_lessons set change_reason = 'ISO bớt tiết', change_reason_code = 'directive' where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') and seq = 11$q$, true);
select pg_temp.probe('admin_ph@iso-test.local', $q$delete from curriculum_lessons where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') and seq = 11$q$, true);
select pg_temp.chk('admin_ph', 'Điều chỉnh: xoá tiết ghi nhật ký kèm mã lý do',
  $q$select action || ':' || reason_code from curriculum_changes where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử') and action = 'delete' order by id desc limit 1$q$, 'delete:directive');
select pg_temp.chk('admin_ph', 'Phiên bản: người soạn lưu phiên bản', $q$select (curriculum_snapshot((select id from curriculum_books where title = 'ISO PPCT lớp thử'), 'other', 'ISO lưu') > 1)::text$q$, 'true');
select pg_temp.chk('gv_both', 'Phiên bản: giáo viên không lưu phiên bản', $q$select curriculum_snapshot((select id from curriculum_books where title = 'ISO PPCT lớp thử'))::text$q$, 'ERR');
select pg_temp.chk('gv_both', 'Phiên bản: giáo viên xem được các phiên bản', $q$select (count(*) >= 3)::text from curriculum_book_versions where book_id = (select id from curriculum_books where title = 'ISO PPCT lớp thử')$q$, 'true');
select pg_temp.probe('admin_ph@iso-test.local', $q$update curriculum_books set status = 'published' where title = 'ISO PPCT tự duyệt'$q$, true);
select pg_temp.chk('admin_ph', 'Phiên bản: công bố PPCT tự lưu phiên bản "công bố"',
  $q$select string_agg(action, ',') from curriculum_book_versions where book_id = (select id from curriculum_books where title = 'ISO PPCT tự duyệt')$q$, 'publish');
select pg_temp.chk('admin_ph', 'Kế hoạch / thực hiện: số tiết kế hoạch theo tuần học của trường', $q$select (sum(planned) > 0 and count(*) > 0)::text from curriculum_weekly(my_org_id())$q$, 'true');
select pg_temp.chk('so_bn', 'Kế hoạch / thực hiện: Sở khác không thấy trường A', format($q$select coalesce(sum(planned), 0)::text from curriculum_weekly(%L)$q$, pg_temp.oid_('THCS-PH')), '0');
-- 108: lọc nhiều trường / khối / môn
select pg_temp.chk('admin_ph', 'TD 108: lọc theo trường cho cùng số tiết như curriculum_weekly', $q$select ((select sum(planned) from curriculum_weekly_f(array[my_org_id()])) = (select sum(planned) from curriculum_weekly(my_org_id())))::text$q$, 'true');
select pg_temp.chk('admin_ph', 'TD 108: lọc khối không có lớp thì không có tiết', $q$select coalesce(sum(planned), 0)::text from curriculum_weekly_f(array[my_org_id()], array[99])$q$, '0');
select pg_temp.chk('so_bn', 'TD 108: Sở khác lọc trường A vẫn không thấy', format($q$select coalesce(sum(planned), 0)::text from curriculum_weekly_f(array[%L::uuid])$q$, pg_temp.oid_('THCS-PH')), '0');
select pg_temp.chk('so_bn', 'TD 108: thống kê môn theo trường không lộ trường A', format($q$select count(*)::text from dept_subject_school_stats() where org_id = %L$q$, pg_temp.oid_('THCS-PH')), '0');
select pg_temp.chk('hs_kb', 'TD 108: học sinh không đọc thống kê môn theo trường', $q$select count(*)::text from dept_subject_school_stats()$q$, '0');
select pg_temp.chk('admin_ph', 'Cảnh báo: trường đặt ngưỡng lớp chậm', $q$insert into curriculum_alert_settings (org_id, lag_threshold) values (my_org_id(), 2)$q$, 'rows:1');
select pg_temp.chk('gv_both', 'Cảnh báo: giáo viên không đổi ngưỡng', $q$insert into curriculum_alert_settings (org_id, lag_threshold) values (my_org_id(), 2)$q$, 'ERR');
select pg_temp.chk('gv_both', 'Cảnh báo: giáo viên không gửi cảnh báo', $q$select curriculum_lag_alerts()::text$q$, 'ERR');
select pg_temp.chk('admin_ph', 'Cảnh báo: trường gửi cảnh báo lớp chậm ngay', $q$select (curriculum_lag_alerts() >= 0)::text$q$, 'true');
select pg_temp.chk('admin_ph', 'Cảnh báo: không gọi trực tiếp hàm quét toàn hệ thống', $q$select curriculum_lag_scan()::text$q$, 'ERR');
delete from notifications where kind in ('curriculum_lag', 'curriculum_cut');

-- ===== 069: trường thử nghiệm cho KDI =====
drop table if exists t_sandbox;
create temp table t_sandbox as select exists (select 1 from organizations where code = 'KDI-SANDBOX') as existed;
select pg_temp.chk('admin_ph', 'Trường thử nghiệm: quản trị trường không tạo được', $q$select platform_sandbox_school()::text$q$, 'ERR');
select pg_temp.probe('kdi@iso-test.local', $q$select platform_sandbox_school()::text$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select platform_sandbox_school()::text$q$, true);
select pg_temp.chk('kdi', 'Trường thử nghiệm: bấm lại không tạo trùng; được gán Hiệu trưởng + Giáo viên',
  $q$select (select count(*) from organizations where code like 'KDI-SANDBOX%') || '|' || (select string_agg(r.key, ',' order by r.key) from memberships m join roles r on r.id = m.role_id join organizations o on o.id = m.org_id where m.user_id = auth.uid() and o.code = 'KDI-SANDBOX')$q$, '2|principal,teacher');
select pg_temp.chk('kdi', 'Trường thử nghiệm: có hồ sơ giáo viên dạy 3 lớp, mỗi lớp 10 học sinh',
  $q$select count(distinct t.class_id) || '|' || (select count(*) from students st where st.org_id = o.id) from organizations o join teachers g on g.org_id = o.id and g.profile_id = auth.uid() join teaching_assignments t on t.teacher_id = g.id where o.code = 'KDI-SANDBOX' group by o.id$q$, '3|30');
select pg_temp.chk('kdi', 'Trường thử nghiệm: đổi sang trường được', $q$select (switch_org((select id from organizations where code = 'KDI-SANDBOX')) is not null)::text$q$, 'true');
do $$ begin
  if not (select existed from t_sandbox) then
    delete from teaching_assignments where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from students where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from classes where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from teachers where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from stem_rooms where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from period_configs where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from academic_years where org_id in (select id from organizations where code = 'KDI-SANDBOX');
    delete from memberships where org_id in (select id from organizations where code like 'KDI-SANDBOX%');
    delete from organizations where code = 'KDI-SANDBOX';
    delete from organizations where code = 'KDI-SANDBOX-SO';
  end if;
end $$;

-- ===== 075: nhóm chương trình bắt buộc, số tiết / tuần, thời gian triển khai =====
select pg_temp.chk('kdi', 'Chương trình: phải chọn nhóm chương trình khi tạo',
  $q$insert into edu_programs (org_id, title, level, grade_from, grade_to, main_subject) values (platform_org_id(), 'ISO CT không nhóm', 'thcs', 6, 6, 'Tin học')$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject, periods_per_week, deploy_term, scope)
  values (platform_org_id(), 'ISO CT HK2', 'DX', 'thcs', 6, 6, 'Tin học', 2, 'hk2', 'children')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) select id, 'topic', 1, 6, 'ISO chủ đề HK2', 3 from edu_programs where title = 'ISO CT HK2'$q$, true);
select pg_temp.chk('kdi', 'Chương trình: không bỏ nhóm chương trình đã chọn',
  $q$update edu_programs set ct_code = null where title = 'ISO CT HK2'$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$select curriculum_from_program((select id from edu_programs where title = 'ISO CT HK2'), 6)::text$q$, true);
select pg_temp.chk('kdi', 'PPCT từ chương trình: lấy số tiết / tuần của chương trình; chương trình HK II xếp hết bài vào HK II',
  $q$select b.periods_per_week::int || ':' || count(l.id) || ':' || min(l.term) || '-' || max(l.term) from curriculum_books b join curriculum_lessons l on l.book_id = b.id
     where b.title = 'ISO CT HK2 — khối 6' group by b.periods_per_week$q$, '2:3:2-2');

-- ===== 078: bản phân phối =====
select pg_temp.chk('admin_ph', 'Mức độ: mọi đơn vị đọc danh mục mức độ', $q$select count(*) from dist_tiers where code in ('co_ban', 'tieu_chuan', 'nang_cao')$q$, '3');
select pg_temp.chk('admin_ph', 'Mức độ: trường không thêm được', $q$insert into dist_tiers (code, name) values ('iso_truong', 'ISO')$q$, 'ERR');
select pg_temp.chk('kdi', 'Mức độ: KDI thêm được', $q$insert into dist_tiers (code, name, sort) values ('iso_muc', 'ISO mức', 9)$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject, scope) values (platform_org_id(), 'ISO CT PB', 'CT1', 'thcs', 6, 6, 'Tin học', 'children')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_program_units (program_id, unit_type, seq, title, periods) select id, 'topic', 1, 'ISO PB chủ đề', 4 from edu_programs where title = 'ISO CT PB'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) select p.id, u.id, 'lesson', k, 'ISO PB bài ' || k, 2 from edu_programs p join edu_program_units u on u.program_id = p.id and u.unit_type = 'topic', generate_series(1, 2) k where p.title = 'ISO CT PB'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select edu_program_set_status((select id from edu_programs where title = 'ISO CT PB'), 'published', 'ISO')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_plans (org_id, title, level, grade, tier) values (platform_org_id(), 'ISO bản phối', 'thcs', 6, 'co_ban')$q$, true);
select pg_temp.chk('kdi', 'Bản phối: mã tự sinh PB-xxx', $q$select (code ~ '^PB-\d{3}$')::text from dist_plans where title = 'ISO bản phối'$q$, 'true');
select pg_temp.chk('kdi', 'Bản phối: khối ngoài cấp học bị chặn', $q$insert into dist_plans (org_id, title, level, grade) values (platform_org_id(), 'ISO sai khối', 'tieuhoc', 9)$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Bản phối: chưa chọn chương trình thì không phát hành', $q$update dist_plans set status = 'published' where title = 'ISO bản phối'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_plan_items (plan_id, program_id, ppw) select (select id from dist_plans where title = 'ISO bản phối'), id, 2 from edu_programs where title = 'ISO CT PB'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_plan_rows (plan_id, program_id, unit_id, seq, periods) select (select id from dist_plans where title = 'ISO bản phối'), u.program_id, u.id, u.seq, 2 from edu_program_units u join edu_programs p on p.id = u.program_id where p.title = 'ISO CT PB' and u.unit_type = 'lesson'$q$, true);
select pg_temp.chk('kdi', 'Bản phối: bài chưa có tuần thì không phát hành', $q$update dist_plans set status = 'published' where title = 'ISO bản phối'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update dist_plan_rows set week = 50 where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, true);
select pg_temp.chk('kdi', 'Bản phối: bài ngoài khung học kỳ thì không phát hành', $q$update dist_plans set status = 'published' where title = 'ISO bản phối'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update dist_plan_rows set week = seq where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, true);
-- 079: tuần của từng tiết, môn trong chương trình
select pg_temp.probe('kdi@iso-test.local', $q$update dist_plan_rows set weeks = array[seq, 40] where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, true);
select pg_temp.chk('kdi', 'Bản phối: tiết rơi ngoài khung học kỳ thì không phát hành', $q$update dist_plans set status = 'published' where title = 'ISO bản phối'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update dist_plan_rows set weeks = array[seq, seq + 1] where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, true);
select pg_temp.chk('kdi', 'Bản phối: danh sách môn phải là mảng', $q$update dist_plan_items set subjects = '{"a": 1}' where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$update dist_plan_items set split = true, subjects = '[{"name": "Tin học", "on": true, "mode": "program", "ppw": 1}]' where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, true);
select pg_temp.chk('kdi', 'Bản phối: lưu môn và chỉnh riêng từng môn', $q$select split::text || jsonb_array_length(subjects) from dist_plan_items where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, 'true1');
select pg_temp.chk('kdi', 'Bản phối: bài của chương trình khác bị chặn',
  $q$insert into dist_plan_rows (plan_id, program_id, unit_id, seq, week) select (select id from dist_plans where title = 'ISO bản phối'), p.id, u.id, 9, 1 from edu_program_units u join edu_programs p on p.id = u.program_id where p.title = 'ISO CT KDI' and u.unit_type = 'lesson' limit 1$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Bản phối: trường không thấy bản nháp của KDI', $q$select count(*) from dist_plans where title = 'ISO bản phối'$q$, '0');
select pg_temp.chk('admin_ph', 'Bản phối: trường không sửa bản của KDI', $q$update dist_plans set title = 'ISO sửa' where title = 'ISO bản phối'$q$, 'rows:0');
select pg_temp.chk('kdi', 'Bản phối: đủ điều kiện thì phát hành được', $q$update dist_plans set status = 'published' where title = 'ISO bản phối'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$update dist_plans set status = 'published' where title = 'ISO bản phối'$q$, true);
select pg_temp.chk('kdi', 'Bản phối: đã phát hành thì khoá lịch bài', $q$update dist_plan_rows set week = 3 where plan_id = (select id from dist_plans where title = 'ISO bản phối')$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Bản phối: đã phát hành thì không đổi khối', $q$update dist_plans set grade = 7 where title = 'ISO bản phối'$q$, 'ERR 22023');
select pg_temp.chk('admin_ph', 'Bản phối: trường thấy bản đã phát hành và lịch bài', $q$select (select count(*) from dist_plans where title = 'ISO bản phối') || ':' || (select count(*) from dist_plan_rows where plan_id = (select id from dist_plans where title = 'ISO bản phối'))$q$, '1:2');
select pg_temp.chk('admin_kb', 'Gán bản phối: không gán cho trường ngoài phạm vi',
  format($q$select dist_plan_assign((select id from dist_plans where title = 'ISO bản phối'), array[%L::uuid])::text$q$, pg_temp.oid_('THCS-PH')), 'ERR 42501');
select pg_temp.chk('kdi', 'Gán bản phối: mỗi chương trình một PPCT cho trường', $q$select dist_plan_assign((select id from dist_plans where title = 'ISO bản phối'), array[(select id from organizations where code = 'THCS-PH')])::text$q$, '{"books": 1, "skipped": 0}');
select pg_temp.probe('kdi@iso-test.local', $q$select dist_plan_assign((select id from dist_plans where title = 'ISO bản phối'), array[(select id from organizations where code = 'THCS-PH')])::text$q$, true);
select pg_temp.chk('admin_ph', 'Gán bản phối: PPCT nháp của trường, đủ tiết, theo tuần của bản',
  $q$select b.status || ':' || count(l.*) || ':' || min(l.week) || '-' || max(l.week) from curriculum_books b join curriculum_lessons l on l.book_id = b.id where b.dist_plan_id = (select id from dist_plans where title = 'ISO bản phối') group by b.status$q$, 'draft:4:1-3');
select pg_temp.chk('kdi', 'Gán bản phối: gán lại không tạo trùng', $q$select dist_plan_assign((select id from dist_plans where title = 'ISO bản phối'), array[(select id from organizations where code = 'THCS-PH')])::text$q$, '{"books": 0, "skipped": 1}');
select pg_temp.chk('admin_ph', 'Gán bản phối: chương trình được gán cho trường', $q$select count(*) from edu_program_assignments a join edu_programs p on p.id = a.program_id where p.title = 'ISO CT PB' and a.org_id = my_org_id()$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$select dist_plan_copy((select id from dist_plans where title = 'ISO bản phối'))::text$q$, true);
select pg_temp.chk('kdi', 'Nhân bản: bản sao là nháp, đủ chương trình và lịch bài',
  $q$select d.status || ':' || (select count(*) from dist_plan_items i where i.plan_id = d.id) || ':' || (select count(*) from dist_plan_rows r where r.plan_id = d.id) from dist_plans d where d.title = 'ISO bản phối (bản sao)'$q$, 'draft:1:2');
select pg_temp.chk('kdi', 'Nhân bản: chép cả môn và tuần từng tiết',
  $q$select (select i.split::text || jsonb_array_length(i.subjects) from dist_plan_items i join dist_plans d on d.id = i.plan_id where d.title = 'ISO bản phối (bản sao)') || ':' || (select string_agg(array_to_string(r.weeks, ','), '|' order by r.seq) from dist_plan_rows r join dist_plans d on d.id = r.plan_id where d.title = 'ISO bản phối (bản sao)')$q$, 'true1:1,2|2,3');
-- ===== 082: cấp phân loại bản phân phối =====
select pg_temp.chk('admin_ph', 'Cấp phân loại: mặc định Cấp học › Khối lớp › Mức độ', $q$select string_agg(name, ' › ' order by sort) from dist_cls_levels$q$, 'Cấp học › Khối lớp › Mức độ');
select pg_temp.chk('kdi', 'Cấp phân loại: bản cũ đã gắn vào mục mức độ', $q$select n.name from dist_plans d join dist_nodes n on n.id = d.node_id where d.title = 'ISO bản phối'$q$, 'Cơ bản');
select pg_temp.chk('kdi', 'Cấp phân loại: bản sao tự gắn mục', $q$select (node_id is not null)::text from dist_plans where title = 'ISO bản phối (bản sao)'$q$, 'true');
select pg_temp.chk('admin_ph', 'Cấp phân loại: trường không thêm cấp', $q$insert into dist_cls_levels (name, kind, sort) values ('ISO cấp', 'custom', 15)$q$, 'ERR');
select pg_temp.chk('kdi', 'Cấp phân loại: KDI thêm cấp mới', $q$insert into dist_cls_levels (name, kind, sort) values ('ISO Giai đoạn', 'custom', 15)$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_cls_levels (name, kind, sort) values ('ISO Giai đoạn', 'custom', 15)$q$, true);
select pg_temp.chk('kdi', 'Cấp phân loại: không tắt được Khối lớp', $q$update dist_cls_levels set active = false where kind = 'grade'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Cấp phân loại: không xoá được Cấp học', $q$delete from dist_cls_levels where kind = 'level'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Cấp phân loại: cấp đã có mục thì không đổi thứ tự', $q$update dist_cls_levels set sort = 25 where kind = 'tier'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Cấp phân loại: cấp chưa có mục thì đổi thứ tự được', $q$update dist_cls_levels set sort = 35 where name = 'ISO Giai đoạn'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$update dist_cls_levels set sort = 35 where name = 'ISO Giai đoạn'$q$, true);
select pg_temp.chk('kdi', 'Cấp phân loại: thêm mục của cấp mới dưới Khối 6', $q$insert into dist_nodes (cls_level_id, parent_id, name) select (select id from dist_cls_levels where name = 'ISO Giai đoạn'), n.id, 'ISO con GĐ1' from dist_nodes n join dist_nodes p on p.id = n.parent_id where n.grade = 6 and p.edu_level = 'thcs'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_nodes (cls_level_id, parent_id, name) select (select id from dist_cls_levels where name = 'ISO Giai đoạn'), n.id, 'ISO con GĐ1' from dist_nodes n join dist_nodes p on p.id = n.parent_id where n.grade = 6 and p.edu_level = 'thcs'$q$, true);
select pg_temp.chk('kdi', 'Cấp phân loại: mục khối tự nhận số khối theo tên', $q$with x as (insert into dist_nodes (cls_level_id, name) select id, 'ISO Khối 7' from dist_cls_levels where kind = 'grade' returning grade) select grade::text from x$q$, '7');
select pg_temp.chk('kdi', 'Cấp phân loại: mục mức độ mới tự thêm vào danh mục mức độ', $q$with x as (insert into dist_nodes (cls_level_id, name) select id, 'ISO Tăng cường' from dist_cls_levels where kind = 'tier' returning tier) select (tier like 't\_%')::text from x$q$, 'true');
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_nodes (cls_level_id, name) select id, 'ISO Mầm non' from dist_cls_levels where kind = 'level'$q$, true);
select pg_temp.chk('kdi', 'Cấp phân loại: mục chưa nhận được cấp học vẫn thêm được', $q$select coalesce(edu_level, '-') from dist_nodes where name = 'ISO Mầm non'$q$, '-');
select pg_temp.chk('kdi', 'Cấp phân loại: bản không gắn được mục chưa thuộc cấp học', $q$insert into dist_plans (org_id, title, level, grade, node_id) values (platform_org_id(), 'ISO bản lỗi', 'tieuhoc', 1, (select id from dist_nodes where name = 'ISO Mầm non'))$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into dist_plans (org_id, title, level, grade, node_id) values (platform_org_id(), 'ISO bản GĐ', 'tieuhoc', 1, (select id from dist_nodes where name = 'ISO con GĐ1'))$q$, true);
select pg_temp.chk('kdi', 'Cấp phân loại: bản gắn mục lấy cấp học, khối theo mục cha', $q$select level || ':' || grade || ':' || coalesce(tier, '-') from dist_plans where title = 'ISO bản GĐ'$q$, 'thcs:6:-');
select pg_temp.chk('kdi', 'Cấp phân loại: mục đang có bản thì không xoá', $q$delete from dist_nodes where name = 'ISO con GĐ1'$q$, 'ERR*');
select pg_temp.chk('kdi', 'Cấp phân loại: cấp đang có mục thì không xoá', $q$delete from dist_cls_levels where name = 'ISO Giai đoạn'$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'Cấp phân loại: trường không sửa mục', $q$update dist_nodes set name = 'ISO đổi' where name = 'ISO con GĐ1'$q$, 'rows:0');

-- ===== 083: chương trình tập huấn =====
select pg_temp.chk('admin_ph', 'CT tập huấn: trường không soạn được', $q$insert into training_programs (org_id, title) values (platform_org_id(), 'ISO CTTH trường')$q$, 'ERR');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title, pass_score, competencies, target_level) values (platform_org_id(), 'ISO CTTH', 5, array['gv_thiet_ke'], 3)$q$, true);
select pg_temp.chk('kdi', 'CT tập huấn: tự cấp mã CTTH-xxx', $q$select (code ~ '^CTTH-\d{3}$')::text from training_programs where title = 'ISO CTTH'$q$, 'true');
select pg_temp.chk('admin_ph', 'CT tập huấn: trường không thấy bản nháp của KDI', $q$select count(*) from training_programs where title = 'ISO CTTH'$q$, '0');
select pg_temp.chk('kdi', 'CT tập huấn: chưa có bài thì không phát hành', $q$update training_programs set status = 'published' where title = 'ISO CTTH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title, hours) select id, 'subject', 1, 'ISO môn', 0 from training_programs where title = 'ISO CTTH'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours) select p.id, u.id, 'content', 1, 'ISO bài 1', 3 from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH'$q$, true);
select pg_temp.chk('kdi', 'CT tập huấn: nội dung phải thuộc một môn', $q$insert into training_program_units (program_id, kind, title) select id, 'content', 'ISO lạc' from training_programs where title = 'ISO CTTH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CT tập huấn: có điều kiện điểm mà chưa có bài test thì không phát hành', $q$update training_programs set status = 'published' where title = 'ISO CTTH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_program_units set has_test = true, detail = '{"docs":[{"title":"ISO tài liệu","url":"https://x"}]}' where title = 'ISO bài 1'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into question_bank (org_id, subject, kind, stem, options, answer) values (platform_org_id(), 'ISO TH', 'single', 'Bước đầu của 5E?', '["Khám phá","Gắn kết","Giải thích"]', '[1]'), (platform_org_id(), 'ISO TH', 'truefalse', 'STEM là tích hợp?', '["Đúng","Sai"]', '[0]')$q$, true);
select pg_temp.chk('kdi', 'CT tập huấn: có bài kiểm tra mà chưa chọn câu hỏi thì không phát hành', $q$update training_programs set status = 'published' where title = 'ISO CTTH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CT tập huấn: câu hỏi bài kiểm tra phải có trong ngân hàng', $q$update training_program_units set detail = detail || '{"test":{"qids":["00000000-0000-0000-0000-000000000000"]}}' where title = 'ISO bài 1'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CT tập huấn: số câu rút không vượt số câu đã chọn', $q$update training_program_units set detail = detail || jsonb_build_object('test', jsonb_build_object('qids', (select jsonb_agg(id) from question_bank where subject = 'ISO TH'), 'count', 5)) where title = 'ISO bài 1'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_program_units set detail = detail || jsonb_build_object('test', jsonb_build_object('qids', (select jsonb_agg(id) from question_bank where subject = 'ISO TH'), 'pass', 6)) where title = 'ISO bài 1'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH'$q$, true);
select pg_temp.chk('admin_ph', 'CT tập huấn: trường thấy bản đã phát hành', $q$select count(*) from training_programs where title = 'ISO CTTH'$q$, '1');
select pg_temp.chk('kdi', 'CT tập huấn: bản đã phát hành không sửa nội dung', $q$update training_programs set title = 'ISO đổi' where title = 'ISO CTTH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CT tập huấn: bản đã phát hành không thêm bài', $q$insert into training_program_units (program_id, parent_id, kind, title) select p.id, u.id, 'content', 'ISO bài 2' from training_programs p join training_program_units u on u.program_id = p.id and u.kind = 'subject' where p.title = 'ISO CTTH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_copy(id) from training_programs where title = 'ISO CTTH' and status = 'published'$q$, true);
select pg_temp.chk('kdi', 'CT tập huấn: nhân bản ra bản nháp v2 đủ môn và nội dung', $q$select p.status || ':' || p.version_no || ':' || (select count(*) from training_program_units u where u.program_id = p.id) from training_programs p where p.title = 'ISO CTTH' and p.source_id is not null$q$, 'draft:2:2');
select pg_temp.chk('kdi', 'CT tập huấn: bản sao giữ 5 phần của nội dung', $q$select u.detail->'docs'->0->>'title' from training_program_units u join training_programs p on p.id = u.program_id where p.source_id is not null and p.title = 'ISO CTTH' and u.kind = 'content'$q$, 'ISO tài liệu');

-- ===== 084: kế hoạch tập huấn =====
select pg_temp.chk('admin_ph', 'KH tập huấn: trường không lập kế hoạch cho KDI', $q$insert into training_plans (org_id, name, pub_status) values (platform_org_id(), 'ISO KH trường', 'draft')$q$, 'ERR');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, mode) values (platform_org_id(), 'ISO KH', 'draft', 'hybrid')$q$, true);
select pg_temp.chk('kdi', 'KH tập huấn: tự cấp mã KHTH-xxx', $q$select (plan_code ~ '^KHTH-\d{3}$')::text from training_plans where name = 'ISO KH'$q$, 'true');
select pg_temp.chk('so_hy', 'KH tập huấn: đơn vị khác không thấy bản nháp của KDI', $q$select count(*) from training_plans where name = 'ISO KH'$q$, '0');
select pg_temp.chk('kdi', 'KH tập huấn: chưa có năm học, chương trình thì không phát hành', $q$update training_plans set pub_status = 'published' where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'KH tập huấn: không chọn chương trình tập huấn nháp', $q$insert into training_plan_items (plan_id, program_id) select k.id, p.id from training_plans k, training_programs p where k.name = 'ISO KH' and p.title = 'ISO CTTH' and p.status = 'draft'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, quota) select k.id, p.id, 30 from training_plans k, training_programs p where k.name = 'ISO KH' and p.title = 'ISO CTTH' and p.status = 'published'$q$, true);
select pg_temp.chk('kdi', 'KH tập huấn: bản nháp chưa gán trường được', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-PH')]) from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set year_name = '2026-2027', term = 'summer' where name = 'ISO KH'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published' where name = 'ISO KH'$q$, true);
select pg_temp.chk('kdi', 'KH tập huấn: phát hành tự tính số giờ từ chương trình', $q$select pub_status || ':' || hours from training_plans where name = 'ISO KH'$q$, 'published:3');
select pg_temp.chk('kdi', 'KH tập huấn: đã phát hành không sửa nội dung', $q$update training_plans set name = 'ISO KH đổi' where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'KH tập huấn: đã phát hành không thêm chương trình', $q$delete from training_plan_items where plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'ERR 22023');
select pg_temp.chk('admin_ph', 'KH tập huấn: trường chưa được gán thì không thấy', $q$select count(*) from training_plans where name = 'ISO KH'$q$, '0');
select pg_temp.chk('admin_ph', 'KH tập huấn: trường không tự gán', $q$select training_plan_assign((select id from training_plans where name = 'ISO KH'), array[(select id from organizations where code = 'THCS-PH')])$q$, 'ERR 42501');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-PH'), (select id from organizations where code = 'THCS-KB')], 1) from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_ph', 'KH tập huấn: trường được gán thì thấy kế hoạch và chương trình', $q$select count(*) from training_plans k join training_plan_items i on i.plan_id = k.id where k.name = 'ISO KH'$q$, '1');
select pg_temp.chk('admin_ph', 'KH tập huấn: trường chỉ thấy dòng gán của mình', $q$select count(*) from training_plan_orgs o join training_plans k on k.id = o.plan_id where k.name = 'ISO KH'$q$, '1');
select pg_temp.chk('kdi', 'KH tập huấn: đã gán thì không về nháp', $q$update training_plans set pub_status = 'draft' where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'KH tập huấn: đã gán thì không xoá', $q$delete from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('admin_ph', 'KH tập huấn: chưa chọn GV thì không gửi duyệt', $q$select training_plan_submit(id)::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into training_enrollments (org_id, plan_id, teacher_id) select t.org_id, k.id, t.id from training_plans k, (select * from teachers where org_id = (select id from organizations where code = 'THCS-PH') and coalesce(email, '') not like '%iso-test%' order by full_name limit 2) t where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_ph', 'KH tập huấn: vượt chỉ tiêu của trường thì không gửi', $q$select training_plan_submit(id)::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('admin_ph@iso-test.local', $q$delete from training_enrollments where plan_id = (select id from training_plans where name = 'ISO KH') and teacher_id = (select teacher_id from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH' order by teacher_id limit 1)$q$, true);
select pg_temp.probe('admin_ph@iso-test.local', $q$select training_plan_submit(id)::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_ph', 'KH tập huấn: đã gửi duyệt thì trường không thêm GV', $q$insert into training_enrollments (org_id, plan_id, teacher_id) select t.org_id, k.id, t.id from training_plans k, teachers t where k.name = 'ISO KH' and t.org_id = (select id from organizations where code = 'THCS-PH') and t.id not in (select teacher_id from training_enrollments where plan_id = k.id) limit 1$q$, 'ERR 22023');
select pg_temp.chk('so_hy', 'KH tập huấn: Sở không duyệt kế hoạch của KDI', $q$select training_plan_review(id, (select id from organizations where code = 'THCS-PH'), true)::text from training_plans where name = 'ISO KH'$q$, 'ERR 42501');
select pg_temp.chk('kdi', 'KH tập huấn: trả lại phải có lý do', $q$select training_plan_review(id, (select id from organizations where code = 'THCS-PH'), false)::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'KH tập huấn: trường chưa gửi thì không duyệt', $q$select training_plan_review(id, (select id from organizations where code = 'THCS-KB'), true)::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_review(id, (select id from organizations where code = 'THCS-PH'), false, 'Bổ sung GV Toán')::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_ph', 'KH tập huấn: trường thấy bị trả lại kèm lý do', $q$select o.status || ':' || o.note from training_plan_orgs o join training_plans k on k.id = o.plan_id where k.name = 'ISO KH'$q$, 'returned:Bổ sung GV Toán');
select pg_temp.probe('admin_ph@iso-test.local', $q$select training_plan_submit(id)::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_review(id, (select id from organizations where code = 'THCS-PH'), true)::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_ph', 'KH tập huấn: danh sách đã duyệt', $q$select o.status from training_plan_orgs o join training_plans k on k.id = o.plan_id where k.name = 'ISO KH'$q$, 'approved');
select pg_temp.probe('so_hy@iso-test.local', $q$insert into training_plans (org_id, name, pub_status) values (my_org_id(), 'ISO KH Sở', 'published')$q$, true);
select pg_temp.chk('so_hy', 'KH tập huấn: Sở không gán trường ngoài phạm vi', format($q$select training_plan_assign(id, array[%s::uuid]) from training_plans where name = 'ISO KH Sở'$q$, quote_literal(pg_temp.oid_('THCS-KB'))), 'ERR 42501');
select pg_temp.chk('so_hy', 'KH tập huấn: Sở gán trường trực thuộc', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-PH')]) from training_plans where name = 'ISO KH Sở'$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_unassign(id, (select id from organizations where code = 'THCS-PH'))::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('kdi', 'KH tập huấn: bỏ gán thì bỏ luôn GV đã ghi danh', $q$select count(*) from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, '0');

-- ===== 085: lịch tập huấn & điểm danh =====
update profiles set org_id = pg_temp.oid_('THCS-KB') where email = 'gv_both@iso-test.local';
select pg_temp.chk('admin_kb', 'Lịch: trường không xếp lịch kế hoạch của KDI', $q$select training_plan_schedule((select id from training_plans where name = 'ISO KH'), '2030-01-07')$q$, 'ERR 42501');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_schedule(id, '2030-01-05', '08:00', 4, true)::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('kdi', 'Lịch: xếp tự động mỗi nội dung một buổi, bỏ qua thứ Bảy, Chủ nhật', $q$select count(*) || ':' || min(to_char(s.starts_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI')) || ':' || min(extract(epoch from s.ends_at - s.starts_at)::int / 3600) || ':' || min(s.mode) from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH' and s.unit_id is not null$q$, '1:2030-01-07 08:00:3:offline');
select pg_temp.chk('kdi', 'Lịch: xếp lại không tạo trùng nội dung đã có buổi', $q$select training_plan_schedule(id, '2030-01-07')::text from training_plans where name = 'ISO KH'$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status) values (platform_org_id(), 'ISO KH nháp', 'draft')$q$, true);
select pg_temp.chk('kdi', 'Lịch: kế hoạch nháp xếp buổi được ngay khi soạn (101)', $q$insert into training_sessions (org_id, plan_id, title, starts_at, ends_at) select org_id, id, 'ISO buổi', now(), now() + interval '1 hour' from training_plans where name = 'ISO KH nháp'$q$, 'rows:1');
select pg_temp.chk('kdi', 'Lịch: giờ kết thúc phải sau giờ bắt đầu', $q$update training_sessions set ends_at = starts_at where plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'ERR 22023');
select pg_temp.probe('admin_kb@iso-test.local', $q$insert into training_enrollments (org_id, plan_id, teacher_id) select t.org_id, k.id, t.id from training_plans k, teachers t where k.name = 'ISO KH' and t.full_name = 'GV thử B'$q$, true);
select pg_temp.chk('admin_kb', 'Lịch: trường được gán thấy buổi và điểm danh GV trường mình', $q$select count(*) from training_attendance a join training_sessions s on s.id = a.session_id where s.plan_id = (select id from training_plans where name = 'ISO KH')$q$, '1');
select pg_temp.chk('admin_ph', 'Lịch: trường không được gán thì không thấy buổi', $q$select count(*) from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, '0');
select pg_temp.chk('admin_kb', 'Lịch: trường không đọc được mã điểm danh', $q$select count(*) from training_session_codes c join training_sessions s on s.id = c.session_id where s.plan_id = (select id from training_plans where name = 'ISO KH')$q$, '0');
select pg_temp.chk('gv_both', 'Lịch: GV không đọc được mã điểm danh', $q$select count(*) from training_session_codes$q$, '0');
select pg_temp.chk('kdi', 'Lịch: đơn vị tổ chức đọc được mã', $q$select (c.code ~ '^\d{6}$')::text from training_session_codes c join training_sessions s on s.id = c.session_id join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, 'true');
select pg_temp.chk('kdi', 'Lịch: gửi nhắc lịch cho GV trong danh sách', $q$select training_session_remind(s.id)::text from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, '1');
select pg_temp.chk('gv_both', 'Điểm danh: chưa đến giờ thì không điểm danh', $q$select training_check_in(s.id) from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'Điểm danh: GV không tự ghi thẳng bảng', $q$update training_attendance set present = true where teacher_id = my_teacher_id()$q$, 'rows:0');
update training_sessions set starts_at = now() - interval '10 minutes', ends_at = now() + interval '1 hour' where plan_id = (select id from training_plans where name = 'ISO KH');
select pg_temp.chk('gv_both', 'Điểm danh: buổi trực tiếp phải có mã', $q$select training_check_in(s.id) from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'Điểm danh: sai mã thì không nhận', $q$select training_check_in_code('000000x')$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'Lịch: GV xin vắng phải có lý do', $q$select training_request_excuse(s.id, ' ')::text from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('gv_both@iso-test.local', format($q$select training_check_in_code(%L)$q$, (select c.code from training_session_codes c join training_sessions s on s.id = c.session_id join training_plans k on k.id = s.plan_id where k.name = 'ISO KH')), true);
select pg_temp.chk('admin_kb', 'Điểm danh: nhập đúng mã thì có mặt', $q$select a.present || ':' || a.method from training_attendance a join training_sessions s on s.id = a.session_id where s.plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'true:code');
select pg_temp.chk('gv_both', 'Điểm danh: đã có mặt thì không xin vắng', $q$select training_request_excuse(s.id, 'Ốm')::text from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('admin_kb', 'Điểm danh: trường không sửa điểm danh buổi của KDI', $q$select training_attendance_mark(s.id, a.teacher_id, false)::text from training_sessions s join training_attendance a on a.session_id = s.id where s.plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'ERR 42501');
select pg_temp.probe('kdi@iso-test.local', $q$select training_attendance_mark(s.id, a.teacher_id, false)::text from training_sessions s join training_attendance a on a.session_id = s.id join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select training_request_excuse(s.id, 'Ốm')::text from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_kb', 'Lịch: trường không duyệt xin vắng buổi của KDI', $q$select training_excuse_review(s.id, a.teacher_id, true)::text from training_sessions s join training_attendance a on a.session_id = s.id where s.plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'ERR 42501');
select pg_temp.probe('kdi@iso-test.local', $q$select training_excuse_review(s.id, a.teacher_id, true)::text from training_sessions s join training_attendance a on a.session_id = s.id join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('gv_both', 'Lịch: GV thấy xin vắng đã duyệt', $q$select present || ':' || excuse_status from my_training_sessions() where plan_name = 'ISO KH'$q$, 'false:approved');
select pg_temp.chk('kdi', 'Lịch: kiểm tra trùng lịch chạy được', $q$select count(*) from training_plan_conflicts((select id from training_plans where name = 'ISO KH'))$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$select training_session_close(s.id)::text from training_sessions s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('gv_both', 'Điểm danh: đã chốt thì không điểm danh nữa', format($q$select training_check_in_code(%L)$q$, (select c.code from training_session_codes c join training_sessions s on s.id = c.session_id join training_plans k on k.id = s.plan_id where k.name = 'ISO KH')), 'ERR 22023');

-- ===== 086: học trực tuyến, bài kiểm tra, sản phẩm =====
select pg_temp.chk('gv_both', 'Học: GV thấy khoá được ghi danh và số nội dung', $q$select units || ':' || done from training_my_courses() where name = 'ISO KH'$q$, '1:0');
select pg_temp.chk('admin_ph', 'Học: người không được ghi danh không mở khoá học', format($q$select training_course(%s::uuid)::text$q$, quote_literal((select id from training_plans where name = 'ISO KH'))), 'ERR');
select pg_temp.chk('gv_both', 'Học: khoá học ẩn danh sách câu hỏi', $q$select ((training_course(id) -> 'units' -> 0 -> 'detail') ? 'test')::text || ':' || ((training_course(id) -> 'units' -> 0 -> 'test') ? 'qids')::text || ':' || (training_course(id) #>> '{units,0,test,count}') from training_plans where name = 'ISO KH'$q$, 'false:false:2');
select pg_temp.chk('gv_both', 'Học: chưa mở tài liệu thì chưa làm bài kiểm tra', $q$select training_test_start(k.id, u.id)::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'Học: mục học không có trong nội dung bị từ chối', $q$select training_learn_mark(k.id, u.id, 'd9')::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'Học: GV không ghi thẳng bảng tiến độ', $q$insert into training_progress (plan_id, unit_id, teacher_id, completed_at) select k.id, u.id, my_teacher_id(), now() from training_plans k, training_program_units u where k.name = 'ISO KH' and u.title = 'ISO bài 1' limit 1$q$, 'ERR');
select pg_temp.chk('gv_both', 'Học: mở tài liệu nhưng chưa làm bài kiểm tra thì chưa hoàn thành', $q$select training_learn_mark(k.id, u.id, 'd0')::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published'$q$, 'false');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_learn_mark(k.id, u.id, 'd0')::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published'$q$, true);
select pg_temp.chk('gv_both', 'Bài kiểm tra: phát đề đủ số câu, không kèm đáp án', $q$select jsonb_array_length(x -> 'questions') || ':' || ((x -> 'questions' -> 0) ? 'answer')::text from (select training_test_start(k.id, u.id) x from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published') t$q$, '2:false');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_test_start(k.id, u.id)::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published'$q$, true);
select pg_temp.chk('gv_both', 'Bài kiểm tra: làm tiếp lượt đang mở, không tạo lượt mới', $q$select training_test_start(k.id, u.id)::text is not null and (select count(*) from training_test_attempts where teacher_id = my_teacher_id()) = 1 from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH' and u.title = 'ISO bài 1' and p.status = 'published'$q$, 'true');
select pg_temp.chk('admin_kb', 'Bài kiểm tra: người khác không nộp hộ', $q$select training_test_submit(id, '{}')::text from training_test_attempts$q$, 'ERR 42501');
select pg_temp.chk('gv_both', 'Bài kiểm tra: dưới điểm đạt thì chưa hoàn thành', $q$select (x ->> 'score') || ':' || (x ->> 'passed') || ':' || (x ->> 'done') from (select training_test_submit(id, '{}') x from training_test_attempts where teacher_id = my_teacher_id() and submitted_at is null) t$q$, '0.0:false:false');
select pg_temp.probe('gv_both@iso-test.local', format($q$select training_test_submit(id, %L::jsonb)::text from training_test_attempts where teacher_id = my_teacher_id() and submitted_at is null$q$, (select jsonb_object_agg(id, answer) from question_bank where subject = 'ISO TH')::text), true);
select pg_temp.chk('gv_both', 'Bài kiểm tra: đúng hết thì 10 điểm, hoàn thành nội dung', $q$select best_score || ':' || (completed_at is not null)::text from training_progress where teacher_id = my_teacher_id()$q$, '10.0:true');
select pg_temp.chk('gv_both', 'Bài kiểm tra: không nộp lại lượt đã nộp', $q$select training_test_submit(id, '{}')::text from training_test_attempts where teacher_id = my_teacher_id()$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'Học: khoá học tính đã xong', $q$select units || ':' || done from training_my_courses() where name = 'ISO KH'$q$, '1:1');
select pg_temp.chk('admin_kb', 'Tiến độ: trường xem tiến độ GV trường mình', $q$select done || '/' || units || ':' || tests_passed || ':' || avg_score from training_plan_progress((select id from training_plans where name = 'ISO KH'))$q$, '1/1:1:10.0');
select pg_temp.chk('admin_ph', 'Tiến độ: trường khác không thấy', $q$select count(*) from training_plan_progress((select id from training_plans where name = 'ISO KH'))$q$, '0');
select pg_temp.chk('admin_ph', 'Tiến độ: trường khác không đọc bảng tiến độ', $q$select count(*) from training_progress$q$, '0');
select pg_temp.chk('gv_both', 'Sản phẩm: link phải là http(s)', $q$select training_product_submit(id, 'ftp://x', null)::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_product_submit(id, 'https://sp.example/iso', 'ISO sản phẩm')::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('admin_kb', 'Sản phẩm: trường không chấm sản phẩm kế hoạch của KDI', $q$select training_product_review(id, (select teacher_id from training_products limit 1), true)::text from training_plans where name = 'ISO KH'$q$, 'ERR 42501');
select pg_temp.chk('kdi', 'Sản phẩm: trả lại phải có nhận xét', $q$select training_product_review(d.plan_id, d.teacher_id, false)::text from training_products d join training_plans k on k.id = d.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_product_review(d.plan_id, d.teacher_id, true, 'Tốt')::text from training_products d join training_plans k on k.id = d.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('gv_both', 'Sản phẩm: GV thấy đã nhận và nhận xét', $q$select (training_course(id) #>> '{product,status}') || ':' || (training_course(id) #>> '{product,feedback}') from training_plans where name = 'ISO KH'$q$, 'accepted:Tốt');
select pg_temp.chk('gv_both', 'Sản phẩm: đã nhận thì không nộp lại', $q$select training_product_submit(id, 'https://khac', null)::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title) values (platform_org_id(), 'ISO CTTH B')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title) select id, 'subject', 1, 'ISO môn B' from training_programs where title = 'ISO CTTH B'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours, detail) select p.id, u.id, 'content', 1, 'ISO bài B', 2, '{"lectures":[{"title":"ISO slide","url":"https://s"}]}' from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH B'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH B'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, year_name) values (platform_org_id(), 'ISO KH2', 'draft', '2026-2027')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, case when p.title = 'ISO CTTH' then 1 else 2 end from training_plans k, training_programs p where k.name = 'ISO KH2' and p.title in ('ISO CTTH', 'ISO CTTH B') and p.status = 'published'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published' where name = 'ISO KH2'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-KB')]) from training_plans where name = 'ISO KH2'$q$, true);
insert into training_enrollments (org_id, plan_id, teacher_id) select t.org_id, k.id, t.id from training_plans k, teachers t where k.name = 'ISO KH2' and t.full_name = 'GV thử B';
select pg_temp.chk('gv_both', 'Học: nội dung sau khoá khi nội dung trước chưa xong', $q$select string_agg((u ->> 'unlocked'), ',' order by (u ->> 'ord')::int) from training_plans k, jsonb_array_elements(training_course(k.id) -> 'units') u where k.name = 'ISO KH2'$q$, 'true,false');
select pg_temp.chk('gv_both', 'Học: không mở bài của nội dung đang khoá', $q$select training_learn_mark(k.id, u.id, 'l0')::text from training_plans k, training_program_units u where k.name = 'ISO KH2' and u.title = 'ISO bài B'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Lớp học ảo: gắn link bản ghi cho buổi', $q$with x as (update training_sessions s set recording_url = 'https://rec' from training_plans k where k.id = s.plan_id and k.name = 'ISO KH' returning 1) select count(*) from x$q$, '1');

-- ===== 087: đánh giá kết quả + chứng chỉ =====
select pg_temp.chk('admin_kb', 'Kết quả: trường xem gợi ý Đạt của GV trường mình', $q$select metrics ->> 'suggest' from training_plan_results((select id from training_plans where name = 'ISO KH'))$q$, 'pass');
select pg_temp.chk('admin_ph', 'Kết quả: trường khác không xem được', format($q$select count(*) from training_plan_results(%s::uuid)$q$, quote_literal((select id from training_plans where name = 'ISO KH'))), '0');
select pg_temp.chk('gv_both', 'Kết quả: GV chỉ thấy dòng của mình', $q$select count(*) from training_plan_results((select id from training_plans where name = 'ISO KH'))$q$, '1');
select pg_temp.chk('admin_kb', 'Kết quả: trường không kết luận kế hoạch của KDI', $q$select training_result_set(e.plan_id, e.teacher_id, 'pass')::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, 'ERR 42501');
select pg_temp.chk('kdi', 'Kết quả: Chưa đạt phải có lý do', $q$select training_result_set(e.plan_id, e.teacher_id, 'fail')::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Kết quả: chưa đủ điều kiện mà kết luận Đạt thì phải có lý do', $q$select training_result_set(e.plan_id, e.teacher_id, 'pass')::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH2'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Kết quả: điểm sản phẩm từ 0 đến 10', $q$select training_result_grade(e.plan_id, e.teacher_id, 11, null)::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_result_grade(e.plan_id, e.teacher_id, 8.5, 'Sản phẩm tốt')::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_results_confirm(id)::text from training_plans where name = 'ISO KH'$q$, true);
select pg_temp.chk('kdi', 'Kết quả: xác nhận Đạt theo gợi ý, tự tạo chứng chỉ chờ duyệt', $q$select r.result || ':' || r.product_score || ':' || c.status from training_results r join certificates c on c.plan_id = r.plan_id and c.teacher_id = r.teacher_id join training_plans k on k.id = r.plan_id where k.name = 'ISO KH'$q$, 'pass:8.5:pending');
select pg_temp.chk('gv_both', 'Chứng chỉ: chờ duyệt thì GV chưa thấy', $q$select count(*) from training_cert_list(true)$q$, '0');
select pg_temp.chk('gv_both', 'Chứng chỉ: GV không tự ghi bảng chứng chỉ', $q$insert into certificates (org_id, teacher_id, plan_id, code) select t.org_id, t.id, k.id, 'ISO-GIA' from teachers t, training_plans k where t.id = my_teacher_id() and k.name = 'ISO KH'$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Chứng chỉ: trường không sửa thẳng chứng chỉ', $q$update certificates set status = 'issued' where plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Chứng chỉ: trường không cấp chứng chỉ kế hoạch của KDI', $q$select training_cert_issue(array_agg(c.id))::text from certificates c where c.plan_id = (select id from training_plans where name = 'ISO KH')$q$, 'ERR 42501');
select pg_temp.probe('kdi@iso-test.local', $q$select training_cert_issue(array_agg(c.id))::text from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('gv_both', 'Chứng chỉ: duyệt cấp thì sinh mã CCTH, GV thấy chứng chỉ', $q$select (code ~ '^CCTH-\d{4}-\d{5}$')::text || ':' || status from training_cert_list(true)$q$, 'true:issued');
select pg_temp.chk('gv_both', 'Chứng chỉ: tra cứu bằng mã QR', format($q$select (training_cert_verify(%L) ->> 'teacher') || ':' || (training_cert_verify(%L) ->> 'status')$q$, (select c.verify_token from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH'), (select c.verify_token from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH')), 'GV thử B:issued');
select pg_temp.chk('gv_both', 'Chứng chỉ: mã tra cứu sai thì không ra gì', $q$select coalesce(training_cert_verify('00000000000000000000000000000000')::text, 'null')$q$, 'null');
select pg_temp.chk('kdi', 'Kết quả: đã Đạt thì không cho thi lại', $q$select training_result_retake(e.plan_id, e.teacher_id)::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'Chứng chỉ: thu hồi phải có lý do', $q$select training_cert_revoke(c.id, ' ')::text from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_result_set(e.plan_id, e.teacher_id, 'fail', 'Sản phẩm sao chép')::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('kdi', 'Chứng chỉ: kết luận đổi thành Chưa đạt thì thu hồi chứng chỉ', $q$select c.status from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH'$q$, 'revoked');
select pg_temp.chk('gv_both', 'Chứng chỉ: tra cứu thấy đã thu hồi', format($q$select training_cert_verify(%L) ->> 'status'$q$, (select c.verify_token from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH')), 'revoked');
select pg_temp.probe('kdi@iso-test.local', $q$select training_result_retake(e.plan_id, e.teacher_id, 2)::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('gv_both', 'Kết quả: thi lại thì về chờ kết luận, thêm lượt', $q$select result || ':' || extra_attempts from training_results r join training_plans k on k.id = r.plan_id where k.name = 'ISO KH'$q$, 'pending:2');
select pg_temp.probe('kdi@iso-test.local', $q$select training_result_set(e.plan_id, e.teacher_id, 'pass')::text from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH'$q$, true);
select pg_temp.chk('kdi', 'Chứng chỉ: Đạt lại thì có chứng chỉ chờ duyệt mới', $q$select string_agg(c.status, ',' order by c.status) from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH'$q$, 'pending,revoked');
select pg_temp.chk('gv_both', 'Học: khoá học trả về kết luận và chứng chỉ', $q$select (training_course(id) #>> '{result,result}') || ':' || (training_course(id) #>> '{cert,status}') from training_plans where name = 'ISO KH'$q$, 'pass:pending');

-- ===== 088: đợt đánh giá năng lực, khoảng thiếu hụt, giám sát =====
select pg_temp.chk('gv_both', 'Đợt ĐG: GV không mở đợt', $q$insert into assessment_rounds (name, school_year, due_on) values ('ISO đợt GV', '2026-2027', current_date + 7)$q$, 'ERR');
select pg_temp.chk('admin_kb', 'Đợt ĐG: hạn trước ngày mở bị từ chối', $q$insert into assessment_rounds (name, school_year, opens_on, due_on) values ('ISO đợt sai', '2026-2027', current_date, current_date - 1)$q$, 'ERR 23514');
select pg_temp.probe('admin_kb@iso-test.local', $q$insert into assessment_rounds (name, school_year, due_on) values ('ISO đợt KB', '2026-2027', current_date + 14)$q$, true);
select pg_temp.chk('admin_ph', 'Đợt ĐG: trường khác không thấy', $q$select count(*) from assessment_rounds where name = 'ISO đợt KB'$q$, '0');
select pg_temp.chk('so_bn', 'Đợt ĐG: Sở cấp trên thấy', $q$select count(*) from assessment_rounds where name = 'ISO đợt KB'$q$, '1');
select pg_temp.chk('admin_ph', 'Đợt ĐG: trường khác không sửa', $q$with x as (update assessment_rounds set name = 'ISO x' where name = 'ISO đợt KB' returning 1) select count(*) from x$q$, '0');
select pg_temp.chk('so_hy', 'Đợt ĐG: Sở khác không thấy', $q$select count(*) from assessment_rounds where name = 'ISO đợt KB'$q$, '0');
select pg_temp.chk('admin_kb', 'Đợt ĐG: tiến độ theo trường, chưa ai nộp', $q$select count(*) || ':' || sum(self_done) || ':' || bool_and(teachers > 0) from assessment_round_progress((select id from assessment_rounds where name = 'ISO đợt KB'))$q$, '1:0:true');
select pg_temp.chk('admin_ph', 'Đợt ĐG: trường khác không nhắc', format($q$select assessment_round_remind(%s::uuid)$q$, quote_literal((select id from assessment_rounds where name = 'ISO đợt KB'))), 'ERR 42501');
select pg_temp.probe('admin_kb@iso-test.local', $q$select assessment_round_remind(id) from assessment_rounds where name = 'ISO đợt KB'$q$, true);
select pg_temp.chk('gv_both', 'Đợt ĐG: GV chưa nộp nhận thông báo', $q$select count(*) from notifications where kind = 'assessment_round'$q$, '1');
select pg_temp.chk('admin_kb', 'Đợt ĐG: nhắc liên tục thì không gửi lại', $q$select assessment_round_remind(id) from assessment_rounds where name = 'ISO đợt KB'$q$, '0');
select pg_temp.probe('admin_kb@iso-test.local', $q$update assessment_rounds set status = 'closed' where name = 'ISO đợt KB'$q$, true);
select pg_temp.chk('admin_kb', 'Đợt ĐG: đợt đã đóng thì không nhắc', $q$select assessment_round_remind(id) from assessment_rounds where name = 'ISO đợt KB'$q$, 'ERR 22023');
insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels, status, comment)
  select org_id, id, '2025-2026', 'self', '{"gv_thiet_ke":1}', 'submitted', 'ISO năm trước' from teachers where full_name = 'GV thử B';
insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels, status, comment)
  select t.org_id, t.id, k.year_name, 'self', '{"gv_thiet_ke":1,"gv_to_chuc":3}', 'submitted', 'ISO năm nay' from teachers t, training_plans k where t.full_name = 'GV thử B' and k.name = 'ISO KH';
select pg_temp.chk('admin_kb', 'Thiếu hụt: GV dưới mức yêu cầu, gợi ý chương trình có năng lực đó', $q$select string_agg(g.competency || ':' || g.level || ':' || exists (select 1 from jsonb_array_elements(g.suggest) s where s ->> 'title' = 'ISO CTTH'), ',') from competency_gaps((select year_name from training_plans where name = 'ISO KH')) g where g.teacher_name = 'GV thử B'$q$, 'gv_thiet_ke:1:true');
select pg_temp.chk('admin_ph', 'Thiếu hụt: trường khác không thấy GV', $q$select count(*) from competency_gaps((select year_name from training_plans where name = 'ISO KH')) where teacher_name = 'GV thử B'$q$, '0');
select pg_temp.chk('admin_kb', 'Thiếu hụt: mức yêu cầu 4 thì thiếu cả năng lực mức 3', $q$select count(*) from competency_gaps((select year_name from training_plans where name = 'ISO KH'), 4) where teacher_name = 'GV thử B'$q$, '2');
select pg_temp.chk('kdi', 'Thiếu hụt: kế hoạch gợi ý GV thiếu năng lực được bồi dưỡng', $q$select array_to_string(h.competencies, ',') from training_plan_gap_hint((select id from training_plans where name = 'ISO KH')) h join teachers t on t.id = h.teacher_id where t.full_name = 'GV thử B'$q$, 'Thiết kế bài học STEM');
select pg_temp.chk('admin_kb', 'Giám sát: trường thấy dòng của trường mình', $q$select count(*) || ':' || min(enrolled) || ':' || min(passed) || ':' || min(certs) from training_monitor() where plan_name = 'ISO KH'$q$, '1:1:1:0');
select pg_temp.chk('kdi', 'Giám sát: đơn vị lập kế hoạch thấy trường được gán', $q$select string_agg(org_name, ',') from training_monitor() where plan_name = 'ISO KH'$q$, (select name from organizations where code = 'THCS-KB'));
select pg_temp.chk('admin_ph', 'Giám sát: trường không được gán thì không thấy', $q$select count(*) from training_monitor() where plan_name = 'ISO KH'$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$select training_cert_issue(array_agg(c.id))::text from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH' and c.status = 'pending'$q$, true);
select pg_temp.chk('admin_kb', 'Năng lực: chứng chỉ đã cấp cho mức đạt qua tập huấn', $q$select string_agg(competency || ':' || level, ',') from teacher_training_levels((select id from teachers where full_name = 'GV thử B'))$q$, 'gv_thiet_ke:3');
select pg_temp.chk('admin_ph', 'Năng lực: trường khác không xem mức qua tập huấn', $q$select count(*) from teacher_training_levels((select id from teachers where full_name = 'GV thử B'))$q$, '0');
select pg_temp.chk('admin_kb', 'Thiếu hụt: có chứng chỉ thì hết thiếu hụt năng lực đó', $q$select count(*) from competency_gaps((select year_name from training_plans where name = 'ISO KH')) where teacher_name = 'GV thử B'$q$, '0');
select pg_temp.chk('admin_kb', 'Minh chứng: đếm chứng chỉ đã cấp và điểm kiểm tra', $q$select (x ->> 'certificates') || ':' || (x ->> 'test_avg') from (select teacher_evidence((select id from teachers where full_name = 'GV thử B')) x) t$q$, '1:10.0');
select pg_temp.chk('admin_kb', 'Giám sát: đếm chứng chỉ đã cấp', $q$select certs from training_monitor() where plan_name = 'ISO KH'$q$, '1');
select pg_temp.chk('admin_kb', 'SL 113: trường xem từng GV của mình, kèm kết quả và chứng chỉ', $q$select string_agg(teacher_name || ':' || coalesce(result, '-') || ':' || cert || ':' || (metrics ? 'suggest'), ',') from training_monitor_teachers((select id from organizations where code = 'THCS-KB')) where plan_name = 'ISO KH'$q$, 'GV thử B:pass:true:true');
select pg_temp.chk('kdi', 'SL 113: đơn vị lập kế hoạch xem GV của trường được gán', $q$select count(*) from training_monitor_teachers((select id from organizations where code = 'THCS-KB')) where plan_name = 'ISO KH'$q$, '1');
select pg_temp.chk('admin_ph', 'SL 113: trường khác không xem GV của trường được gán', $q$select count(*) from training_monitor_teachers((select id from organizations where code = 'THCS-KB'))$q$, '0');
insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels, status, comment)
  select t.org_id, t.id, k.year_name, 'manager', '{"gv_thiet_ke":3}', 'submitted', 'ISO trường ĐG' from teachers t, training_plans k where t.full_name = 'GV thử B' and k.name = 'ISO KH';
select pg_temp.chk('admin_kb', 'Hiệu quả: mức năng lực trước / sau tập huấn', $q$select teachers || ':' || before_avg || ':' || after_avg from training_competency_effect() where competency = 'gv_thiet_ke'$q$, '1:1.00:3.00');
select pg_temp.chk('admin_ph', 'Hiệu quả: trường khác không tính GV trường này', $q$select count(*) from training_competency_effect()$q$, '0');

-- ===== 089: chương trình giáo dục nhiều nhóm / cấp học / môn chủ đạo =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_programs (org_id, title, ct_codes, levels, grade_from, grade_to, main_subjects, integrated_subjects, scope) values (platform_org_id(), 'ISO CT nhiều', array['CT1', 'CT2'], array['thcs', 'thpt'], 6, 12, array['Vật lý', 'Hoá học'], array['Hoá học', 'Sinh học'], 'children')$q$, true);
select pg_temp.chk('kdi', 'CTGD nhiều: giá trị chính là phần tử đầu, môn tích hợp bỏ môn chủ đạo', $q$select ct_code || ':' || level || ':' || main_subject || ':' || array_to_string(integrated_subjects, ',') from edu_programs where title = 'ISO CT nhiều'$q$, 'CT1:thcs:Vật lý:Sinh học');
select pg_temp.chk('kdi', 'CTGD nhiều: đổi danh sách môn chủ đạo thì đổi môn chính', $q$with x as (update edu_programs set main_subjects = array['Hoá học', 'Vật lý'] where title = 'ISO CT nhiều' returning main_subject) select main_subject from x$q$, 'Hoá học');
select pg_temp.chk('kdi', 'CTGD nhiều: sửa cấp học kiểu cũ thì thay cấp chính', $q$with x as (update edu_programs set level = 'tieuhoc', grade_from = 1, grade_to = 12 where title = 'ISO CT nhiều' returning levels) select array_to_string(levels, ',') from x$q$, 'tieuhoc,thpt');
select pg_temp.chk('kdi', 'CTGD nhiều: nhóm không có trong danh mục bị từ chối', $q$update edu_programs set ct_codes = array['CT1', 'KHONGCO'] where title = 'ISO CT nhiều'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTGD nhiều: phải còn ít nhất một cấp học', $q$update edu_programs set levels = '{}' where title = 'ISO CT nhiều'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTGD nhiều: bỏ hết nhóm chương trình bị từ chối', $q$update edu_programs set ct_codes = '{}' where title = 'ISO CT nhiều'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTGD nhiều: bản đã ban hành không đổi được danh sách môn', $q$update edu_programs set main_subjects = array['Toán'] where title = 'ISO CT KDI' and status not in ('draft', 'rejected')$q$, 'ERR 22023');

-- ===== 090: chương trình tập huấn nhiều loại chương trình / cấp học =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title, ct_codes, levels) values (platform_org_id(), 'ISO CTTH nhiều', array['CT1', 'CT2', 'CT1'], array['thcs', 'thpt'])$q$, true);
select pg_temp.chk('kdi', 'CTTH nhiều: giá trị chính là phần tử đầu, bỏ trùng', $q$select ct_code || ':' || level || ':' || array_to_string(ct_codes, ',') from training_programs where title = 'ISO CTTH nhiều'$q$, 'CT1:thcs:CT1,CT2');
select pg_temp.chk('kdi', 'CTTH nhiều: bỏ hết cấp học = mọi cấp học', $q$with x as (update training_programs set levels = '{}' where title = 'ISO CTTH nhiều' returning level) select coalesce(level, 'moi') from x$q$, 'moi');
select pg_temp.chk('kdi', 'CTTH nhiều: sửa loại kiểu cũ thì thay loại chính', $q$with x as (update training_programs set ct_code = 'CT3' where title = 'ISO CTTH nhiều' returning ct_codes) select array_to_string(ct_codes, ',') from x$q$, 'CT3,CT2');
select pg_temp.chk('kdi', 'CTTH nhiều: loại không có trong danh mục bị từ chối', $q$update training_programs set ct_codes = array['CT1', 'KHONGCO'] where title = 'ISO CTTH nhiều'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTTH nhiều: cấp học không có trong danh mục bị từ chối', $q$update training_programs set levels = array['khongco'] where title = 'ISO CTTH nhiều'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTTH nhiều: bản đã phát hành không đổi loại chương trình', $q$update training_programs set ct_codes = array['CT4'] where title = 'ISO CTTH' and status = 'published'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_copy(id) from training_programs where title = 'ISO CTTH nhiều'$q$, true);
select pg_temp.chk('kdi', 'CTTH nhiều: nhân bản chép cả loại chương trình', $q$select array_to_string(ct_codes, ',') from training_programs where title = 'ISO CTTH nhiều' and source_id is not null$q$, 'CT1,CT2');

-- ===== 091: chương trình giáo dục chọn khối theo danh sách =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_programs (org_id, title, ct_codes, levels, grades, grade_from, grade_to, main_subjects, scope) values (platform_org_id(), 'ISO CT khối', array['CT1'], array['thcs'], array[8, 6, 8], 6, 9, array['Vật lý'], 'children')$q$, true);
select pg_temp.chk('kdi', 'CTGD khối: danh sách khối sắp tăng, bỏ trùng; từ/đến = nhỏ nhất/lớn nhất', $q$select array_to_string(grades, ',') || ':' || grade_from || '-' || grade_to from edu_programs where title = 'ISO CT khối'$q$, '6,8:6-8');
select pg_temp.chk('kdi', 'CTGD khối: sửa từ/đến kiểu cũ thì điền đủ các khối', $q$with x as (update edu_programs set grade_from = 7, grade_to = 9 where title = 'ISO CT khối' returning grades) select array_to_string(grades, ',') from x$q$, '7,8,9');
select pg_temp.chk('kdi', 'CTGD khối: bỏ hết khối bị từ chối', $q$update edu_programs set grades = '{}' where title = 'ISO CT khối'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTGD khối: khối ngoài cấp học bị từ chối', $q$update edu_programs set grades = array[6, 10] where title = 'ISO CT khối'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTGD khối: học phần khối không có trong danh sách bị từ chối', $q$insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) select id, 'topic', 1, 7, 'ISO HP khối 7', 1 from edu_programs where title = 'ISO CT khối'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) select id, 'topic', 1, 8, 'ISO HP khối 8', 1 from edu_programs where title = 'ISO CT khối'$q$, true);
select pg_temp.chk('kdi', 'CTGD khối: không bỏ được khối đang có học phần', $q$update edu_programs set grades = array[6] where title = 'ISO CT khối'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTGD khối: PPCT từ chương trình chỉ nhận khối trong danh sách', $q$select curriculum_from_program(id, 7) from edu_programs where title = 'ISO CT khối'$q$, 'ERR 22023');
insert into t_result (who, name, expect, got, ok)
  select 'postgres', 'CTGD khối: nhân bản / phiên bản mới chép danh sách khối', '6,8', x, x is not distinct from '6,8'
    from (select array_to_string(c.grades, ',') x from edu_programs c
           where c.id = public.edu_program_clone((select id from edu_programs where title = 'ISO CT khối'), (select org_id from edu_programs where title = 'ISO CT khối'), null, 1)) t;
delete from edu_programs where title = 'ISO CT khối' and source_id is not null;
select pg_temp.chk('kdi', 'CTGD khối: bản đã ban hành không đổi được khối', $q$update edu_programs set grades = array[6] where title = 'ISO CT KDI' and status not in ('draft', 'rejected')$q$, 'ERR 22023');

-- ===== 092: học phần thuộc nhiều khối =====
select pg_temp.chk('kdi', 'HP nhiều khối: danh sách sắp tăng, khối chính là khối đầu', $q$with x as (update edu_program_units set grades = array[8, 6] where title = 'ISO HP khối 8' returning grade, grades) select grade || ':' || array_to_string(grades, ',') from x$q$, '6:6,8');
select pg_temp.chk('kdi', 'HP nhiều khối: khối ngoài chương trình bị từ chối', $q$update edu_program_units set grades = array[6, 7] where title = 'ISO HP khối 8'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'HP nhiều khối: sửa khối kiểu cũ thì thay danh sách', $q$with x as (update edu_program_units set grade = 6 where title = 'ISO HP khối 8' returning grades) select array_to_string(grades, ',') from x$q$, '6');
select pg_temp.probe('kdi@iso-test.local', $q$update edu_program_units set grades = array[6, 8] where title = 'ISO HP khối 8'$q$, true);
select pg_temp.chk('kdi', 'HP nhiều khối: không bỏ được khối chương trình mà học phần đang dùng', $q$update edu_programs set grades = array[8] where title = 'ISO CT khối'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select curriculum_from_program(id, 6) from edu_programs where title = 'ISO CT khối'$q$, true);
select pg_temp.chk('kdi', 'HP nhiều khối: PPCT khối 6 lấy học phần thuộc khối 6 và 8', $q$select count(*) from curriculum_lessons l join curriculum_books b on b.id = l.book_id where b.title = 'ISO CT khối — khối 6'$q$, '1');
insert into t_result (who, name, expect, got, ok)
  select 'postgres', 'HP nhiều khối: nhân bản chép danh sách khối của học phần', '6,8', x, x is not distinct from '6,8'
    from (select array_to_string(u.grades, ',') x from edu_program_units u
           where u.program_id = public.edu_program_clone((select id from edu_programs where title = 'ISO CT khối'), (select org_id from edu_programs where title = 'ISO CT khối'), null, 1)) t;
-- ===== 093: chương trình tập huấn có phiên bản & duyệt =====
select pg_temp.chk('kdi', 'CTTH phiên bản: bản nhân bản cùng họ, cùng mã', $q$select count(distinct family_id) || ':' || count(distinct code) from training_programs where title = 'ISO CTTH'$q$, '1:1');
select pg_temp.chk('kdi', 'CTTH phiên bản: đã có bản nháp thì không tạo phiên bản mới', $q$select training_program_new_version(id) from training_programs where title = 'ISO CTTH' and status = 'published'$q$, 'ERR 22023');
select pg_temp.chk('admin_ph', 'CTTH phiên bản: trường không đổi trạng thái', $q$select training_program_set_status(gen_random_uuid(), 'pending')$q$, 'ERR 42501');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_set_status(id, 'pending', 'ISO gửi') from training_programs where title = 'ISO CTTH' and status = 'draft'$q$, true);
select pg_temp.chk('kdi', 'CTTH phiên bản: đang chờ duyệt thì không sửa nội dung', $q$update training_program_units set title = 'ISO đổi' where program_id = (select id from training_programs where title = 'ISO CTTH' and status = 'pending')$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTTH phiên bản: trả lại phải có lý do', $q$select training_program_set_status(id, 'rejected') from training_programs where title = 'ISO CTTH' and status = 'pending'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_set_status(id, 'rejected', 'ISO thiếu nội dung') from training_programs where title = 'ISO CTTH' and status = 'pending'$q$, true);
select pg_temp.chk('kdi', 'CTTH phiên bản: nhật ký ghi lý do trả lại', $q$select l.note from training_program_log l join training_programs p on p.id = l.program_id where p.title = 'ISO CTTH' and l.to_status = 'rejected'$q$, 'ISO thiếu nội dung');
select pg_temp.chk('kdi', 'CTTH phiên bản: bị trả lại thì sửa được', $q$update training_programs set audience = 'ISO GV' where title = 'ISO CTTH' and status = 'rejected'$q$, 'rows:1');
select pg_temp.chk('kdi', 'CTTH phiên bản: chưa duyệt thì không chuyển sang đã duyệt', $q$select training_program_set_status(id, 'approved') from training_programs where title = 'ISO CTTH' and status = 'rejected'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_set_status(id, 'pending') from training_programs where title = 'ISO CTTH' and status = 'rejected'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_set_status(id, 'approved') from training_programs where title = 'ISO CTTH' and status = 'pending'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_set_status(id, 'published', 'ISO phát hành v2') from training_programs where title = 'ISO CTTH' and status = 'approved'$q$, true);
select pg_temp.chk('kdi', 'CTTH phiên bản: phát hành bản mới thì bản cũ thành đã thay thế', $q$select string_agg(version_no || ':' || status, ',' order by version_no) from training_programs where title = 'ISO CTTH'$q$, '1:superseded,2:published');
select pg_temp.chk('admin_ph', 'CTTH phiên bản: trường vẫn thấy bản đã thay thế (kế hoạch cũ dùng)', $q$select count(*) from training_programs where title = 'ISO CTTH'$q$, '2');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_new_version(id) from training_programs where title = 'ISO CTTH' and status = 'published'$q$, true);
select pg_temp.chk('kdi', 'CTTH phiên bản: tạo phiên bản mới v3 cùng mã', $q$select p.version_no || ':' || p.status || ':' || (p.code = o.code)::text from training_programs p, training_programs o where p.title = 'ISO CTTH' and p.version_no = 3 and o.title = 'ISO CTTH' and o.version_no = 1$q$, '3:draft:true');
select pg_temp.chk('kdi', 'CTTH phiên bản: mã đã dùng cho chương trình khác bị từ chối', $q$update training_programs set code = (select code from training_programs where title = 'ISO CTTH' limit 1) where title = 'ISO CTTH nhiều' and source_id is null$q$, 'ERR 23505');

-- ===== 094: kho hoạt động & bài giảng của KDI =====
do $$
declare v_kdi uuid := pg_temp.oid_('@platform');
begin
  if v_kdi is null or to_regprocedure('public.is_platform_org(uuid)') is null then return; end if;
  insert into activities (org_id, kind, title, content, is_template, status) values
    (v_kdi, 'flashcard', 'ISO KDI hoạt động xuất bản', '{"cards":[{"front":"a","back":"b"}]}', true, 'published'),
    (v_kdi, 'flashcard', 'ISO KDI hoạt động nháp', '{"cards":[{"front":"a","back":"b"}]}', true, 'draft');
  perform set_config('app.lesson_engine', 'on', true);
  insert into lesson_plans (org_id, title, is_template, status, steps, slides, doc) values
    (v_kdi, 'ISO KDI bài giảng xuất bản', true, 'published', '[]', '[{"kind":"title","title":"x"}]', '{}'),
    (v_kdi, 'ISO KDI bài giảng nháp', true, 'draft', '[]', '[]', '{}');
  perform set_config('app.lesson_engine', '', true);
end $$;
select pg_temp.chk('kdi', '094 KDI tạo hoạt động ở đơn vị KDI',
  format('insert into activities (org_id, kind, title, content, is_template) values (%s, ''flashcard'', ''ISO KDI mới'', ''{}'', true)', quote_literal(pg_temp.oid_('@platform'))), 'rows:1')
  where pg_temp.oid_('@platform') is not null;
-- 100: Quản trị hệ thống thao tác thay trường ở Phân hệ 2 (trước đây: KDI không tạo hoạt động ở trường)
select pg_temp.chk('kdi', '094/100 Quản trị tạo hoạt động thay trường',
  format('insert into activities (org_id, kind, title, content, is_template) values (%s, ''flashcard'', ''ISO KDI x'', ''{}'', true)', quote_literal(pg_temp.oid_('THCS-PH'))), 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('kdi', '094 KDI tạo bài giảng ở đơn vị KDI',
  format('insert into lesson_plans (org_id, title, is_template, status) values (%s, ''ISO KDI bài mới'', true, ''draft'')', quote_literal(pg_temp.oid_('@platform'))), 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('kdi', '094 KDI sửa bài giảng nháp của KDI', 'update lesson_plans set summary = ''x'' where title = ''ISO KDI bài giảng nháp''', 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('kdi', '094 KDI có quyền xuất bản bài của KDI (bài đã xuất bản → lỗi trạng thái, không phải quyền)',
  'select public.lesson_plan_publish((select id from lesson_plans where title = ''ISO KDI bài giảng xuất bản''))', 'ERR 22023')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('gv_both', '094 GV đọc hoạt động KDI đã xuất bản', 'select count(*) from activities where title = ''ISO KDI hoạt động xuất bản''', '1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('gv_both', '094 GV không đọc hoạt động KDI nháp', 'select count(*) from activities where title = ''ISO KDI hoạt động nháp''', '0')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_kb', '094 Trường B đọc bài giảng KDI đã xuất bản', 'select count(*) from lesson_plans where title = ''ISO KDI bài giảng xuất bản''', '1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_kb', '094 Trường không đọc bài giảng KDI nháp', 'select count(*) from lesson_plans where title = ''ISO KDI bài giảng nháp''', '0')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '094 Trường không sửa hoạt động KDI', 'update activities set title = ''x'' where title = ''ISO KDI hoạt động xuất bản''', 'rows:0')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('hs_kb', '094 Học sinh không đọc kho KDI', 'select count(*) from activities where title like ''ISO KDI%''', '0')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.probe('gv_both@iso-test.local', 'select public.lesson_plan_clone((select id from lesson_plans where title = ''ISO KDI bài giảng xuất bản''))', true)
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('gv_both', '094 GV nhân bản bài giảng KDI về trường mình',
  'select count(*) from lesson_plans where org_id = public.my_org_id() and source_id in (select id from lesson_plans where title = ''ISO KDI bài giảng xuất bản'' and public.is_platform_org(org_id))', '1')
  where pg_temp.oid_('@platform') is not null;
delete from lesson_plans where source_id in (select id from lesson_plans where title like 'ISO KDI%');
select pg_temp.chk('gv_both', '094 GV không nhân bản bài KDI nháp',
  'select public.lesson_plan_clone((select id from lesson_plans where title = ''ISO KDI bài giảng nháp''))', 'ERR')
  where pg_temp.oid_('@platform') is not null;
delete from lesson_plans where title like 'ISO KDI%';
delete from activities where title like 'ISO KDI%';

-- ===== 095: thiết lập chung — lịch & ngày nghỉ chuẩn chung, quy tắc vận hành =====
do $$
declare v_kdi uuid := pg_temp.oid_('@platform');
begin
  if v_kdi is null or to_regclass('public.holiday_skips') is null then return; end if;
  insert into academic_years (org_id, name, term, starts_on, ends_on, status, source) values
    (v_kdi, '2096-2097', 'HK I', '2096-09-05', '2097-01-15', 'official', 'ISO QĐ'),
    (v_kdi, '2096-2097', 'HK II', '2097-01-18', '2097-05-31', 'official', 'ISO QĐ');
  insert into school_holidays (org_id, name, starts_on, ends_on, kind, status, source) values
    (v_kdi, 'ISO STD nghỉ', '2096-11-20', '2096-11-20', 'state', 'expected', 'ISO nguồn');
  insert into school_holidays (org_id, name, starts_on, ends_on) values
    (pg_temp.oid_('THCS-PH'), 'ISO PH nghỉ', '2096-12-01', '2096-12-01');
end $$;
select pg_temp.chk('kdi', '095 KDI thêm năm học chuẩn chung',
  format('insert into academic_years (org_id, name, term, starts_on, ends_on) values (%L, ''2098-2099'', ''HK I'', ''2098-09-05'', ''2099-01-15'')', pg_temp.oid_('@platform')), 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Trường không thêm năm học chuẩn chung',
  format('insert into academic_years (org_id, name, term) values (%L, ''2098-2099'', ''HK I'')', pg_temp.oid_('@platform')), 'ERR')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Trường đọc năm học chuẩn chung', 'select count(*) from academic_years where name = ''2096-2097''', '2')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('gv_both', '095 GV đọc ngày nghỉ chuẩn chung', 'select count(*) from school_holidays where name = ''ISO STD nghỉ''', '1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Trường không sửa ngày nghỉ chuẩn chung', 'update school_holidays set name = ''x'' where name = ''ISO STD nghỉ''', 'rows:0')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('kdi', '095 KDI sửa ngày nghỉ chuẩn chung', 'update school_holidays set note = ''x'' where name = ''ISO STD nghỉ''', 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('kdi', '095 Loại ngày nghỉ sai bị chặn',
  format('insert into school_holidays (org_id, name, starts_on, ends_on, kind) values (%L, ''ISO x'', ''2096-10-01'', ''2096-10-01'', ''bad'')', pg_temp.oid_('@platform')), 'ERR*')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Ngày nghỉ chuẩn chung áp cho trường', 'select public.is_holiday(public.my_org_id(), ''2096-11-20'')', 'ISO STD nghỉ')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Lịch tuần: trường chưa có năm học riêng dùng chuẩn chung, có tuần nghỉ',
  'select count(*) from public.curriculum_calendar(public.my_org_id(), ''2096-2097'') where holiday like ''%ISO STD nghỉ%''', '1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Lịch tuần có ngày nghỉ riêng của trường',
  'select count(*) from public.curriculum_calendar(public.my_org_id(), ''2096-2097'') where holiday like ''%ISO PH nghỉ%''', '1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Trường bỏ ngày nghỉ chuẩn chung',
  'insert into holiday_skips (org_id, holiday_id) select public.my_org_id(), id from school_holidays where name = ''ISO STD nghỉ''', 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Không "bỏ" ngày nghỉ không phải chuẩn chung',
  'insert into holiday_skips (org_id, holiday_id) select public.my_org_id(), id from school_holidays where name = ''ISO PH nghỉ''', 'ERR')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('gv_ph2', '095 GV không bỏ ngày nghỉ chuẩn chung',
  'insert into holiday_skips (org_id, holiday_id) select public.my_org_id(), id from school_holidays where name = ''ISO STD nghỉ''', 'ERR')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.probe('admin_ph@iso-test.local',
  'insert into holiday_skips (org_id, holiday_id) select public.my_org_id(), id from school_holidays where name = ''ISO STD nghỉ''', true)
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Ngày chuẩn chung đã bỏ không còn là ngày nghỉ của trường', 'select public.is_holiday(public.my_org_id(), ''2096-11-20'')', 'null')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Danh sách ngày nghỉ hiệu lực đánh dấu ngày đã bỏ',
  'select string_agg(name || '':'' || std || '':'' || skipped, '','' order by name) from public.effective_holidays(public.my_org_id(), ''2096-08-01'', ''2097-07-31'') where name like ''ISO%''',
  'ISO PH nghỉ:false:false,ISO STD nghỉ:true:true')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_kb', '095 Trường khác vẫn nghỉ ngày chuẩn chung', 'select public.is_holiday(public.my_org_id(), ''2096-11-20'')', 'ISO STD nghỉ')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_kb', '095 Trường khác không thấy ngày đã bỏ của trường A', 'select count(*) from holiday_skips', '0')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_kb', '095 Không xem lịch ngày nghỉ của trường khác',
  format('select count(*) from public.effective_holidays(%L)', pg_temp.oid_('THCS-PH')), 'ERR')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Năm học tham chiếu có chuẩn chung', 'select count(*) from public.calendar_years(public.my_org_id()) where name = ''2096-2097'' and std', '1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Trường không xem danh sách lịch riêng các trường', 'select count(*) from public.school_calendars(''2096-2097'')', 'ERR')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('kdi', '095 KDI xem trường có lịch riêng', 'select string_agg(skipped::text || '':'' || own_holidays, '','') from public.school_calendars(''2096-2097'') where org_id = ' || quote_literal(pg_temp.oid_('THCS-PH')), '1:1')
  where pg_temp.oid_('@platform') is not null;
-- Quy tắc vận hành
select pg_temp.probe('kdi@iso-test.local',
  'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''rules'', ''{"attendance_edit_days": 3}'') on conflict (org_id, key) do update set value = excluded.value', true)
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Quy tắc mặc định của KDI áp cho trường', 'select public.org_rule(public.my_org_id(), ''attendance_edit_days'', 7)', '3')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '095 Trường không sửa quy tắc của KDI',
  format('insert into org_settings (org_id, key, value) values (%L, ''rules'', ''{}'')', pg_temp.oid_('@platform')), 'ERR')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('gv_ph2', '095 GV không đặt quy tắc của trường', 'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''rules'', ''{}'')', 'ERR');
select pg_temp.probe('admin_ph@iso-test.local',
  'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''rules'', ''{"attendance_edit_days": 5}'')', true);
select pg_temp.chk('admin_ph', '095 Quy tắc riêng của trường ghi đè', 'select public.org_rule(public.my_org_id(), ''attendance_edit_days'', 7)', '5');
select pg_temp.chk('admin_kb', '095 Trường khác không đọc quy tắc của trường A', format('select count(*) from org_settings where org_id = %L', pg_temp.oid_('THCS-PH')), '0');
delete from org_settings where org_id = pg_temp.oid_('THCS-PH') or org_id = pg_temp.oid_('@platform');
delete from holiday_skips where org_id = pg_temp.oid_('THCS-PH');
delete from school_holidays where name like 'ISO STD%' or name = 'ISO PH nghỉ';
delete from academic_years where name in ('2096-2097', '2098-2099');

-- ===== 096: thiết lập chung đợt 2 — menu, danh mục, trường tùy chỉnh, nút; nhắc nộp kế hoạch STEM =====
select pg_temp.chk('kdi', '096 KDI lưu menu mặc định', 'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''menu'', ''{"teacher":{"hidden":["Sự kiện"]}}'')', 'rows:1')
  where pg_temp.oid_('@platform') is not null;
select pg_temp.chk('admin_ph', '096 Trường lưu menu riêng', 'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''menu'', ''{"teacher":{"labels":{"Tổng quan":"Trang chủ"}}}'')', 'rows:1');
select pg_temp.chk('admin_ph', '096 Trường lưu trường tùy chỉnh', 'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''fields'', ''{"library":[{"key":"nguon","label":"Nguồn","type":"text"}]}'')', 'rows:1');
select pg_temp.chk('admin_ph', '096 Khoá thiết lập lạ bị chặn', 'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''xyz'', ''{}'')', 'ERR*');
select pg_temp.chk('gv_ph2', '096 GV không sửa menu của trường', 'insert into org_settings (org_id, key, value) values (public.my_org_id(), ''menu'', ''{}'')', 'ERR');
select pg_temp.chk('admin_kb', '096 Trường khác không sửa thiết lập của trường A',
  format('insert into org_settings (org_id, key, value) values (%L, ''buttons'', ''{}'')', pg_temp.oid_('THCS-PH')), 'ERR');
select pg_temp.chk('admin_ph', '096 Học liệu lưu giá trị trường tùy chỉnh',
  'update library_items set custom = ''{"nguon":"x"}'' where owner_org_id = public.my_org_id() and false', 'rows:0');
select pg_temp.chk('admin_ph', '096 Giá trị trường tùy chỉnh phải là object',
  'update edu_programs set custom = ''[1]'' where org_id = public.my_org_id()', 'ERR*');
do $$
declare v record;
begin
  if to_regprocedure('public.stem_plan_reminders()') is null then return; end if;
  select t.org_id, t.id as teacher_id, (select id from classes c where c.org_id = t.org_id limit 1) as class_id,
         (select id from period_configs p where p.org_id = t.org_id limit 1) as period_id into v
    from teachers t where t.full_name = 'GV thử A';
  if v.class_id is null or v.period_id is null then return; end if;
  insert into teaching_sessions (org_id, class_id, teacher_id, period_id, session_date, subject, kind)
    values (v.org_id, v.class_id, v.teacher_id, v.period_id, public.vn_today() + 3, 'ISO 096 STEM', 'stem')
    on conflict (class_id, session_date, period_id) do update set subject = 'ISO 096 STEM', kind = 'stem', status = 'scheduled', teacher_id = excluded.teacher_id;
  perform public.stem_plan_reminders();
  perform public.stem_plan_reminders();          -- lần 2 trong ngày: không nhắc lại
end $$;
select pg_temp.chk('gv_both', '096 GV được nhắc nộp kế hoạch tiết STEM sắp dạy (một lần / ngày)',
  'select count(*) from notifications where kind = ''stem_plan_remind'' and user_id = auth.uid()', '1');
select pg_temp.chk('admin_ph', '096 Trường không tự chạy nhắc toàn hệ thống', 'select public.platform_stem_plan_reminders()::text', 'ERR');
delete from notifications where kind = 'stem_plan_remind';
delete from teaching_sessions where subject = 'ISO 096 STEM';
delete from org_settings where org_id in (pg_temp.oid_('THCS-PH'), pg_temp.oid_('@platform'));

-- ===== 097: tập huấn đợt A — chương trình (mục tiêu, tiên quyết), kế hoạch chọn một phần nội dung, thông báo gán =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title, objectives, outcomes, entry_conditions) values (platform_org_id(), 'ISO CTTH A', '  GV thiết kế được bài STEM ', 'Nộp 1 KHBD', 'Dạy KHTN')$q$, true);
select pg_temp.chk('kdi', 'CTTH 097: lưu mục tiêu (cắt khoảng trắng), đầu ra, điều kiện tham gia', $q$select objectives || '|' || outcomes || '|' || entry_conditions from training_programs where title = 'ISO CTTH A'$q$, 'GV thiết kế được bài STEM|Nộp 1 KHBD|Dạy KHTN');
select pg_temp.chk('kdi', 'CTTH 097: không là tiên quyết của chính mình', $q$update training_programs set prereq_families = array[family_id] where title = 'ISO CTTH A'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'CTTH 097: tiên quyết phải là chương trình có thật', $q$update training_programs set prereq_families = array['00000000-0000-0000-0000-000000000000'::uuid] where title = 'ISO CTTH A'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set prereq_families = array[(select family_id from training_programs where title = 'ISO CTTH' limit 1)] where title = 'ISO CTTH A'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title) select id, 'subject', 1, 'ISO A môn' from training_programs where title = 'ISO CTTH A'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours) select p.id, u.id, 'content', g, 'ISO A nd' || g, g from training_programs p join training_program_units u on u.program_id = p.id and u.kind = 'subject', generate_series(1, 3) g where p.title = 'ISO CTTH A'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH A'$q$, true);
select pg_temp.chk('kdi', 'CTTH 097: đã phát hành không sửa mục tiêu, tiên quyết', $q$update training_programs set objectives = 'khác' where title = 'ISO CTTH A'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_copy(id) from training_programs where title = 'ISO CTTH A' and status = 'published'$q$, true);
select pg_temp.chk('kdi', 'CTTH 097: phiên bản mới giữ mục tiêu và tiên quyết', $q$select objectives || ':' || cardinality(prereq_families) from training_programs where title = 'ISO CTTH A' and version_no = 2$q$, 'GV thiết kế được bài STEM:1');

select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, mode, year_name) values (platform_org_id(), 'ISO KH A', 'draft', 'offline', '2026-2027')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id) select k.id, p.id from training_plans k, training_programs p where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published'$q$, true);
select pg_temp.chk('kdi', 'KH 097: nội dung chọn phải thuộc chương trình', $q$update training_plan_items set units = array[(select id from training_program_units where title = 'ISO bài 1' limit 1)] where plan_id = (select id from training_plans where name = 'ISO KH A')$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'KH 097: không chọn mảng rỗng', $q$update training_plan_items set units = '{}' where plan_id = (select id from training_plans where name = 'ISO KH A')$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$update training_plan_items set units = array(select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH A' and p.status = 'published' and u.kind = 'content') where plan_id = (select id from training_plans where name = 'ISO KH A')$q$, true);
select pg_temp.chk('kdi', 'KH 097: chọn đủ mọi nội dung thì lưu là toàn bộ (null)', $q$select (units is null)::text from training_plan_items where plan_id = (select id from training_plans where name = 'ISO KH A')$q$, 'true');
select pg_temp.probe('kdi@iso-test.local', $q$update training_plan_items set units = array(select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH A' and p.status = 'published' and u.title in ('ISO A nd3', 'ISO A nd1') order by u.seq desc) where plan_id = (select id from training_plans where name = 'ISO KH A')$q$, true);
select pg_temp.chk('kdi', 'KH 097: nội dung chọn xếp theo thứ tự chương trình', $q$select string_agg(u.title, ',' order by o) from training_plan_items i, unnest(i.units) with ordinality x(id, o) join training_program_units u on u.id = x.id where i.plan_id = (select id from training_plans where name = 'ISO KH A')$q$, 'ISO A nd1,ISO A nd3');
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published' where name = 'ISO KH A'$q$, true);
select pg_temp.chk('kdi', 'KH 097: số giờ chỉ tính nội dung chọn', $q$select hours::text from training_plans where name = 'ISO KH A'$q$, '4');
select pg_temp.chk('kdi', 'KH 097: nội dung của kế hoạch chỉ gồm nội dung chọn', $q$select string_agg(title, ',' order by ord) from training_plan_units((select id from training_plans where name = 'ISO KH A'))$q$, 'ISO A nd1,ISO A nd3');
select pg_temp.chk('kdi', 'KH 097: xếp lịch tự động chỉ xếp nội dung chọn', $q$select training_plan_schedule(id, '2030-03-04')::text from training_plans where name = 'ISO KH A'$q$, '2');
select pg_temp.chk('kdi', 'KH 097: không thêm buổi cho nội dung không chọn', $q$insert into training_sessions (org_id, plan_id, unit_id, title, starts_at, ends_at, mode) select k.org_id, k.id, u.id, 'x', '2030-03-10 08:00+07', '2030-03-10 10:00+07', 'offline' from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd2'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-PH')], 5) from training_plans where name = 'ISO KH A'$q$, true);
select pg_temp.chk('admin_ph', 'KH 097: trường được gán nhận thông báo', $q$select count(*) from notifications where kind = 'training_assigned' and user_id = auth.uid() and title like '%ISO KH A%' and body like '%chỉ tiêu 5%'$q$, '1');
select pg_temp.chk('admin_kb', 'KH 097: trường không được gán thì không nhận thông báo', $q$select count(*) from notifications where kind = 'training_assigned' and title like '%ISO KH A%'$q$, '0');

-- ===== 098: tập huấn đợt B — danh sách giảng viên (chọn nhiều), giáo viên tự đăng ký =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into trainers (org_id, full_name, title, workplace) values (platform_org_id(), ' ISO  GV   Một ', 'TS.', null), (platform_org_id(), 'ISO GV Hai', null, 'ĐH ISO')$q$, true);
select pg_temp.chk('kdi', 'GVTH 098: họ tên được chuẩn hoá khoảng trắng', $q$select full_name from trainers where full_name like 'ISO GV M%'$q$, 'ISO GV Một');
select pg_temp.chk('kdi', 'GVTH 098: trùng họ tên + đơn vị công tác bị chặn', $q$insert into trainers (org_id, full_name, workplace) values (platform_org_id(), 'iso gv hai', 'đh iso')$q$, 'ERR*');
select pg_temp.chk('admin_ph', 'GVTH 098: trường không thêm giảng viên cho KDI', $q$insert into trainers (org_id, full_name) values (platform_org_id(), 'ISO GV X')$q$, 'ERR');
select pg_temp.chk('gv_ph2', 'GVTH 098: giáo viên không đọc danh sách giảng viên', $q$select count(*) from trainers where full_name like 'ISO GV%'$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, mode, year_name) values (platform_org_id(), 'ISO KH B', 'draft', 'offline', '2026-2027')$q$, true);
select pg_temp.chk('kdi', 'GVTH 098: kế hoạch chọn nhiều giảng viên, tên hiển thị tự ghép theo thứ tự chọn',
  $q$with i as (insert into training_plan_items (plan_id, program_id, trainer_ids) select k.id, p.id, array[(select id from trainers where full_name = 'ISO GV Hai'), (select id from trainers where full_name = 'ISO GV Một'), (select id from trainers where full_name = 'ISO GV Hai')] from training_plans k, training_programs p where k.name = 'ISO KH B' and p.title = 'ISO CTTH A' and p.status = 'published' returning trainer || ':' || cardinality(trainer_ids)) select * from i$q$, 'ISO GV Hai, TS. ISO GV Một:2');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, trainer_ids) select k.id, p.id, array[(select id from trainers where full_name = 'ISO GV Hai'), (select id from trainers where full_name = 'ISO GV Một')] from training_plans k, training_programs p where k.name = 'ISO KH B' and p.title = 'ISO CTTH A' and p.status = 'published'$q$, true);
select pg_temp.chk('kdi', 'GVTH 098: giảng viên ngoài danh sách của đơn vị bị chặn', $q$update training_plan_items set trainer_ids = array[gen_random_uuid()] where plan_id = (select id from training_plans where name = 'ISO KH B')$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update trainers set title = 'PGS.TS.' where full_name = 'ISO GV Một'$q$, true);
select pg_temp.chk('kdi', 'GVTH 098: đổi học vị → tên hiển thị ở kế hoạch đổi theo', $q$select trainer from training_plan_items where plan_id = (select id from training_plans where name = 'ISO KH B')$q$, 'ISO GV Hai, PGS.TS. ISO GV Một');
select pg_temp.chk('kdi', 'GVTH 098: không xoá giảng viên đã phân công', $q$delete from trainers where full_name = 'ISO GV Một'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_schedule(id, '2030-03-04')::text from training_plans where name = 'ISO KH A'$q$, true);
select pg_temp.chk('kdi', 'GVTH 098: buổi tập huấn chọn giảng viên (kế hoạch đã phát hành vẫn sửa được)', $q$with s as (update training_sessions set trainer_ids = array[(select id from trainers where full_name = 'ISO GV Một')] where plan_id = (select id from training_plans where name = 'ISO KH A') and title = 'ISO A nd1' returning trainer) select string_agg(trainer, ',') from s$q$, 'PGS.TS. ISO GV Một');

-- Tự đăng ký vào ISO KH A (gán THCS-PH, chỉ tiêu 5; nội dung nd1, nd3; mỗi nội dung một buổi)
select pg_temp.chk('gv_ph2', 'ĐK 098: kế hoạch chưa mở thì không đăng ký', $q$select training_register_check(id) ->> 'errors' from training_plans where name = 'ISO KH A'$q$, '["Kế hoạch không mở cho giáo viên tự đăng ký"]');
select pg_temp.chk('kdi', 'ĐK 098: kế hoạch đã phát hành vẫn mở đăng ký được', $q$update training_plans set self_register = true, register_until = '2099-12-31' where name = 'ISO KH A'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set self_register = true, register_until = '2099-12-31' where name = 'ISO KH A'$q$, true);
select pg_temp.chk('gv_ph2', 'ĐK 098: thấy kế hoạch mở đăng ký của trường', $q$select name || ':' || coalesce(reg_status, '-') || ':' || enrolled from training_open_plans() where name = 'ISO KH A'$q$, 'ISO KH A:-:false');
select pg_temp.chk('gv_ph2', 'ĐK 098: chưa đạt chương trình tiên quyết thì bị chặn', $q$select training_register(id)::text from training_plans where name = 'ISO KH A'$q$, 'ERR 22023');
select pg_temp.chk('gv_ph2', 'ĐK 098: báo tên chương trình tiên quyết còn thiếu', $q$select string_agg(x, ';') from training_plans k, jsonb_array_elements_text(training_register_check(k.id) -> 'errors') x where k.name = 'ISO KH A'$q$, 'Chưa đạt chương trình tiên quyết: "ISO CTTH"');
insert into training_results (plan_id, teacher_id, result) select k.id, t.id, 'pass' from training_plans k, teachers t where k.name = 'ISO KH' and t.full_name = 'GV thử C';
select pg_temp.chk('gv_ph2', 'ĐK 098: đạt tiên quyết thì hết lỗi', $q$select training_register_check(id) ->> 'errors' from training_plans where name = 'ISO KH A'$q$, '[]');
select pg_temp.chk('gv_ph2', 'ĐK 098: không đề nghị miễn nội dung chưa đạt', $q$select training_register(k.id, null, array[u.id])::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd3'$q$, 'ERR 22023');
insert into training_progress (plan_id, unit_id, teacher_id, completed_at) select k.id, u.id, t.id, now() from training_plans k, teachers t, training_program_units u join training_programs p on p.id = u.program_id
  where k.name = 'ISO KH' and t.full_name = 'GV thử C' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd3';
select pg_temp.chk('gv_ph2', 'ĐK 098: nội dung đã đạt ở kế hoạch trước được đề xuất miễn', $q$select string_agg(title || ':' || passed, ',' order by ord) from training_register_units((select id from training_plans where name = 'ISO KH A'))$q$, 'ISO A nd1:false,ISO A nd3:true');
select pg_temp.chk('gv_ph2', 'ĐK 098: miễn hết nội dung thì không còn gì để học', $q$select training_register(k.id, array[u.id], array[u.id])::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd3'$q$, 'ERR 22023');
select pg_temp.chk('gv_ph2', 'ĐK 098: gửi đăng ký (miễn nd3)', $q$select training_register(k.id, null, array[u.id], 'Muốn học')::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd3'$q$, 'pending');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select training_register(k.id, null, array[u.id], 'Muốn học')::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd3'$q$, true);
select pg_temp.chk('admin_ph', 'ĐK 098: trường thấy đăng ký chờ xử lý và nhận thông báo', $q$select r.status || ':' || cardinality(r.exempt_units) || ':' || (r.units is null) || ':' || (select count(*) from notifications n where n.kind = 'training_registration' and n.user_id = auth.uid()) from training_registrations r where r.plan_id = (select id from training_plans where name = 'ISO KH A')$q$, 'pending:1:true:1');
select pg_temp.chk('admin_kb', 'ĐK 098: trường khác không thấy đăng ký', $q$select count(*) from training_registrations where plan_id = (select id from training_plans where name = 'ISO KH A')$q$, '0');
select pg_temp.chk('gv_ph2', 'ĐK 098: GV không tự ghi bảng đăng ký', $q$update training_registrations set status = 'accepted'$q$, 'ERR');
select pg_temp.chk('admin_ph', 'ĐK 098: còn đăng ký chờ thì chưa gửi danh sách', $q$select training_plan_submit(id, my_org_id())::text from training_plans where name = 'ISO KH A'$q$, 'ERR 22023');
select pg_temp.chk('admin_kb', 'ĐK 098: trường khác không xử lý đăng ký', format('select training_registration_review(%L, %s, true)::text', (select id from training_plans where name = 'ISO KH A'), pg_temp.tid('GV thử C')), 'ERR 42501');
select pg_temp.chk('admin_ph', 'ĐK 098: từ chối phải có lý do', $q$select training_registration_review(r.plan_id, r.teacher_id, false, ' ')::text from training_registrations r join training_plans k on k.id = r.plan_id where k.name = 'ISO KH A'$q$, 'ERR 22023');
select pg_temp.probe('admin_ph@iso-test.local', $q$select training_registration_review(r.plan_id, r.teacher_id, false, 'Trùng lịch dạy')::text from training_registrations r join training_plans k on k.id = r.plan_id where k.name = 'ISO KH A'$q$, true);
select pg_temp.chk('gv_ph2', 'ĐK 098: GV nhận thông báo bị từ chối kèm lý do', $q$select count(*) from notifications where kind = 'training_registration' and user_id = auth.uid() and title like 'Đăng ký tập huấn không được duyệt%' and body like '%Trùng lịch dạy%'$q$, '1');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select training_register(id)::text from training_plans where name = 'ISO KH A'$q$, true);
select pg_temp.chk('gv_ph2', 'ĐK 098: đăng ký lại sau khi bị từ chối, huỷ được khi đang chờ', $q$select training_register_cancel(id)::text from training_plans where name = 'ISO KH A'$q$, '');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select training_register_cancel(id)::text from training_plans where name = 'ISO KH A'$q$, true);
select pg_temp.chk('gv_ph2', 'ĐK 098: đã huỷ thì không huỷ lại', $q$select training_register_cancel(id)::text from training_plans where name = 'ISO KH A'$q$, 'ERR 22023');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select training_register(k.id, null, array[u.id])::text from training_plans k, training_program_units u join training_programs p on p.id = u.program_id where k.name = 'ISO KH A' and p.title = 'ISO CTTH A' and p.status = 'published' and u.title = 'ISO A nd3'$q$, true);
select pg_temp.probe('admin_ph@iso-test.local', $q$select training_registration_review(r.plan_id, r.teacher_id, true)::text from training_registrations r join training_plans k on k.id = r.plan_id where k.name = 'ISO KH A'$q$, true);
select pg_temp.chk('admin_ph', 'ĐK 098: nhận đăng ký → GV có tên, nguồn tự đăng ký, giữ nội dung miễn', $q$select e.source || ':' || cardinality(e.exempt_units) || ':' || r.status from training_enrollments e join training_registrations r using (plan_id, teacher_id) where e.plan_id = (select id from training_plans where name = 'ISO KH A')$q$, 'self:1:accepted');
select pg_temp.chk('gv_ph2', 'ĐK 098: điểm danh chỉ gồm buổi của nội dung phải học', $q$select string_agg(title, ',') from my_training_sessions() where plan_name = 'ISO KH A'$q$, 'ISO A nd1');
select pg_temp.chk('gv_ph2', 'ĐK 098: khoá học chỉ tính nội dung phải học', $q$select units::text from training_my_courses() where name = 'ISO KH A'$q$, '1');
select pg_temp.chk('gv_ph2', 'ĐK 098: GV nhận thông báo trường đã nhận', $q$select count(*) from notifications where kind = 'training_registration' and user_id = auth.uid() and title like 'Đăng ký tập huấn đã được duyệt%'$q$, '1');
select pg_temp.chk('gv_ph2', 'ĐK 098: đã có tên thì không đăng ký lại', $q$select training_register(id)::text from training_plans where name = 'ISO KH A'$q$, 'ERR 22023');
select pg_temp.probe('admin_ph@iso-test.local', $q$select training_plan_submit(id, my_org_id())::text from training_plans where name = 'ISO KH A'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_review(id, (select id from organizations where code = 'THCS-PH'), true)::text from training_plans where name = 'ISO KH A'$q$, true);
select pg_temp.chk('gv_ph2', 'ĐK 098: danh sách được duyệt → GV nhận thông báo', $q$select count(*) from notifications where kind = 'training_approved' and user_id = auth.uid() and title like '%ISO KH A%'$q$, '1');
select pg_temp.chk('gv_ph2', 'ĐK 098: trường đã gửi danh sách thì không nhận thêm đăng ký', $q$select (training_register_check(id) ->> 'errors') like '%đã gửi danh sách%' from training_plans where name = 'ISO KH A'$q$, 'true');

-- ===== 099: Quản trị hệ thống thao tác thay đơn vị ở Phân hệ 1 =====
select pg_temp.chk('kdi', 'QT 099: Quản trị ghi được tập huấn của Sở', format('select training_can_write(%L)::text', pg_temp.oid_('SO-HY')), 'true');
select pg_temp.chk('admin_ph', 'QT 099: trường không ghi tập huấn của Sở', format('select training_can_write(%L)::text', pg_temp.oid_('SO-HY')), 'false');
select pg_temp.chk('kdi', 'QT 099: Quản trị lập kế hoạch tập huấn cho Sở', format($q$insert into training_plans (org_id, name, pub_status, mode, year_name) values (%L, 'ISO KH Sở do QT lập', 'draft', 'online', '2026-2027')$q$, pg_temp.oid_('SO-HY')), 'rows:1');
select pg_temp.chk('kdi', 'QT 099: Quản trị thêm giảng viên cho Sở', format($q$insert into trainers (org_id, full_name) values (%L, 'ISO GV Sở')$q$, pg_temp.oid_('SO-HY')), 'rows:1');
select pg_temp.chk('kdi', 'QT 099: Quản trị tạo đợt đánh giá năng lực cho Sở', format($q$insert into assessment_rounds (org_id, name, school_year, opens_on, due_on) values (%L, 'ISO đợt QT', '2026-2027', '2026-11-01', '2026-11-30')$q$, pg_temp.oid_('SO-HY')), 'rows:1');
select pg_temp.chk('kdi', 'QT 099: Quản trị thêm bài giảng tập huấn cho trường', format($q$insert into training_lessons (org_id, title, status) values (%L, 'ISO bài QT', 'draft')$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.chk('kdi', 'QT 099: Quản trị đánh giá năng lực GV thay trường', format($q$insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels) values (%L, %s, '2026-2027', 'manager', '{}')$q$, pg_temp.oid_('THCS-PH'), pg_temp.tid('GV thử C')), 'rows:1');
select pg_temp.chk('kdi', 'QT 099: đánh giá phải đúng trường của GV', format($q$insert into teacher_assessments (org_id, teacher_id, school_year, kind, levels) values (%L, %s, '2026-2027', 'manager', '{}')$q$, pg_temp.oid_('THCS-KB'), pg_temp.tid('GV thử C')), 'ERR*');
select pg_temp.probe('kdi@iso-test.local', format($q$select training_plan_review(id, %L, false, 'QT trả lại để thử')::text from training_plans where name = 'ISO KH A'$q$, pg_temp.oid_('THCS-PH')), true);
select pg_temp.chk('kdi', 'QT 099: Quản trị gửi danh sách GV thay trường', format($q$select training_plan_submit(id, %L)::text from training_plans where name = 'ISO KH A'$q$, pg_temp.oid_('THCS-PH')), '');
select pg_temp.chk('kdi', 'QT 099: ngoài Phân hệ 1 vẫn chỉ xem (học sinh)', format('update students set full_name = ''x'' where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');

-- ===== 100: Quản trị hệ thống thao tác thay đơn vị ở Phân hệ 2 =====
select pg_temp.chk('kdi', 'QT 100: Quản trị ghi được chương trình của trường', format('select curriculum_can_write(%L)::text', pg_temp.oid_('THCS-PH')), 'true');
select pg_temp.chk('admin_ph', 'QT 100: trường không ghi chương trình của Sở', format('select curriculum_can_write(%L)::text', pg_temp.oid_('SO-HY')), 'false');
select pg_temp.chk('kdi', 'QT 100: Quản trị soạn chương trình cho Sở', format($q$insert into edu_programs (org_id, title, ct_code, level, grade_from, grade_to, main_subject) values (%L, 'ISO CT do QT soạn', 'CT1', 'thcs', 6, 6, 'Toán')$q$, pg_temp.oid_('SO-HY')), 'rows:1');
select pg_temp.chk('kdi', 'QT 100: Quản trị thêm môn PPCT cho trường', format($q$insert into curriculum_books (org_id, grade, subject, title) values (%L, 6, 'Toán', 'ISO PPCT do QT')$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.probe('kdi@iso-test.local', format($q$select curriculum_copy(id, null, %L) from curriculum_books where title = 'ISO mẫu KDI' and org_id = platform_org_id() limit 1$q$, pg_temp.oid_('THCS-PH')), true);
select pg_temp.chk('kdi', 'QT 100: Quản trị sao chép mẫu PPCT về trường', format($q$select (count(*) > 0)::text from curriculum_books b join curriculum_books t on t.id = b.source_id where t.org_id = platform_org_id() and b.title = 'ISO mẫu KDI' and b.org_id = %L$q$, pg_temp.oid_('THCS-PH')), 'true');
select pg_temp.chk('admin_ph', 'QT 100: trường không sao chép PPCT về trường khác', format($q$select curriculum_copy(id, null, %L)::text from curriculum_books where title = 'ISO mẫu KDI' limit 1$q$, pg_temp.oid_('THCS-KB')), 'ERR 42501');
select pg_temp.chk('admin_ph', 'QT 100: trường sao chép về chính mình như cũ', $q$select (curriculum_copy(id) is not null)::text from curriculum_books where title = 'ISO mẫu KDI' limit 1$q$, 'true');
select pg_temp.probe('kdi@iso-test.local', format($q$select edu_program_copy(id, %L) from edu_programs where title = 'ISO CT KDI' and status in ('published', 'superseded') order by version_no desc limit 1$q$, pg_temp.oid_('SO-HY')), true);
select pg_temp.chk('kdi', 'QT 100: Quản trị sao chép chương trình về Sở', format($q$select (count(*) > 0)::text from edu_programs where title like 'ISO CT KDI%%' and org_id = %L and status = 'draft'$q$, pg_temp.oid_('SO-HY')), 'true');
select pg_temp.chk('kdi', 'QT 100: Quản trị thêm học liệu cho trường', format($q$insert into library_items (owner_org_id, kind, title) values (%L, 'lesson', 'ISO học liệu do QT')$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.chk('so_bn', 'QT 100: Sở vẫn không phát hành thay đơn vị khác', format('insert into library_items (owner_org_id, kind, title) values (%s, ''lesson'', ''ISO giả 2'')', quote_literal(pg_temp.oid_('SO-HY'))), 'ERR');
select pg_temp.chk('kdi', 'QT 100: Quản trị soạn giáo án mẫu cho trường', format($q$insert into lesson_plans (org_id, title, is_template) values (%L, 'ISO GA mẫu QT', true)$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.chk('kdi', 'QT 100: Quản trị thêm định mức vật tư cho trường', format('select library_can_write(%L)::text', pg_temp.oid_('THCS-PH')), 'true');
select pg_temp.chk('kdi', 'QT 100: ngoài Phân hệ 2 vẫn chỉ xem (học sinh)', format('update students set full_name = ''x'' where org_id = %s', quote_literal(pg_temp.oid_('THCS-KB'))), 'rows:0');

-- 100: Quản trị duyệt thay trường; e-learning của trường
select pg_temp.probe('gv_ph2@iso-test.local', $q$select lesson_plan_clone((select id from lesson_plans where title = 'ISO GA C'), 'ISO GA QT duyệt')::text$q$, true);
select pg_temp.probe('gv_ph2@iso-test.local', $q$update lesson_plans set status = 'pending' where title = 'ISO GA QT duyệt'$q$, true);
select pg_temp.chk('kdi', 'QT 100: Quản trị được duyệt giáo án của trường', $q$select approval_can_act((select id from approval_requests where title = 'ISO GA QT duyệt' and status = 'pending'))::text$q$, 'true');
select pg_temp.probe('kdi@iso-test.local', $q$select approval_decide_ref('lesson_plans', (select id from lesson_plans where title = 'ISO GA QT duyệt'), 'approve', 'QT duyệt')::text$q$, true);
select pg_temp.chk('gv_ph2', 'QT 100: giáo án được Quản trị duyệt', $q$select status from lesson_plans where title = 'ISO GA QT duyệt'$q$, 'approved');
select pg_temp.chk('admin_kb', 'QT 100: trường khác vẫn không duyệt được', $q$select approval_can_act((select id from approval_requests where status = 'pending' and org_id = (select id from organizations where code = 'THCS-PH') limit 1))::text$q$, 'false');
select pg_temp.chk('kdi', 'QT 100: Quản trị thêm câu hỏi cho trường', format($q$insert into question_bank (org_id, subject, stem, options, answer) values (%L, 'Toán', 'ISO câu QT', '["a","b"]', '[0]')$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.chk('kdi', 'QT 100: Quản trị tạo đề luyện cho trường', format($q$insert into practice_exams (org_id, title, criteria) values (%L, 'ISO đề QT', '{"count": 5}')$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.chk('kdi', 'QT 100: Quản trị mở khoá học cho trường', format($q$insert into courses (org_id, title) values (%L, 'ISO khoá QT')$q$, pg_temp.oid_('THCS-PH')), 'rows:1');
select pg_temp.probe('admin_ph@iso-test.local', $q$insert into courses (org_id, title) values (my_org_id(), 'ISO khoá nháp trường')$q$, true);
select pg_temp.chk('kdi', 'QT 100: Quản trị thấy và sửa khoá học nháp của trường', $q$update courses set description = 'QT sửa' where title = 'ISO khoá nháp trường'$q$, 'rows:1');
select pg_temp.chk('admin_kb', 'QT 100: trường khác không thấy khoá học nháp', $q$select count(*) from courses where title = 'ISO khoá nháp trường'$q$, '0');

-- 101: khung phân loại kế hoạch tập huấn; xếp lịch khi kế hoạch còn nháp
select pg_temp.chk('kdi', 'TH 107: khung mặc định chỉ có cấp Chương trình', $q$select string_agg(name, '›' order by sort) from training_cls_levels where active$q$, 'Chương trình');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_nodes (cls_level_id, name, sort) select id, 'ISO Tin học', 1 from training_cls_levels where kind = 'subject'$q$, true);
select pg_temp.chk('kdi', 'TH 107: cấp độ đang tắt thì thêm chương trình không tự sinh Cơ bản, Nâng cao', $q$select count(*) from training_nodes c join training_nodes p on p.id = c.parent_id where p.name = 'ISO Tin học'$q$, '0');
select pg_temp.chk('so_hy', 'TH 101: Sở không sửa khung phân loại', $q$insert into training_cls_levels (name, kind, sort) values ('ISO cấp', 'custom', 30)$q$, 'ERR');
select pg_temp.chk('kdi', 'TH 101: KDI thêm cấp phân loại', $q$insert into training_cls_levels (name, kind, sort) values ('ISO cấp', 'custom', 30)$q$, 'rows:1');
select pg_temp.chk('kdi', 'TH 103: không xoá được cấp Chương trình', $q$delete from training_cls_levels where kind = 'subject'$q$, 'ERR*');
select pg_temp.chk('kdi', 'TH 101: kế hoạch gắn mục phân loại', $q$update training_plans set node_id = (select id from training_nodes where name = 'ISO Tin học') where name = 'ISO KH A'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, mode, year_name) values (platform_org_id(), 'ISO KH nháp lịch', 'draft', 'offline', '2026-2027')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id) select k.id, p.id from training_plans k, training_programs p where k.name = 'ISO KH nháp lịch' and p.title = 'ISO CTTH A' and p.status = 'published'$q$, true);
select pg_temp.chk('kdi', 'TH 101: xếp lịch khi kế hoạch còn nháp', $q$insert into training_sessions (org_id, plan_id, unit_id, title, starts_at, ends_at, mode, location)
  select k.org_id, k.id, u.id, u.title, '2030-06-03 08:00+07', '2030-06-03 10:00+07', 'offline', 'Hội trường' from training_plans k
  join training_plan_items i on i.plan_id = k.id join training_program_units u on u.program_id = i.program_id and u.kind = 'content' where k.name = 'ISO KH nháp lịch' limit 1$q$, 'rows:1');

-- ===== TH 102: bài giảng tập huấn 5 thẻ =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_lessons (org_id, title, status, program_id, content) select platform_org_id(), '  ISO BG 5 thẻ ', 'draft', (select id from training_programs where title = 'ISO CTTH B'),
  '{"checked":["info","content"],"kit":{"sessions":[{"acts":[{"title":"a"},{"title":"b"}]}],"docs":[{"type":"video"},{"type":"worksheet"},{"type":"link"}],"mats":{"product":[{"name":"x"}],"group":[]}}}'::jsonb$q$, true);
select pg_temp.chk('kdi', 'BG tập huấn: tự tính số hoạt động, video, tài liệu, vật tư từ 5 thẻ', $q$select concat_ws(',', blocks, videos, docs, materials) from training_lessons where title = 'ISO BG 5 thẻ'$q$, '2,1,2,1');
select pg_temp.chk('kdi', 'BG tập huấn: chưa chốt đủ 5 thẻ thì chưa phát hành được', $q$select training_lesson_publish(id) from training_lessons where title = 'ISO BG 5 thẻ'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_lessons set content = jsonb_set(content, '{checked}', '["info","content","links","norms","bank"]') where title = 'ISO BG 5 thẻ'$q$, true);
select pg_temp.chk('kdi', 'BG tập huấn: đủ 5 thẻ thì phát hành, lên phiên bản 1', $q$select training_lesson_publish(id) from training_lessons where title = 'ISO BG 5 thẻ'$q$, '1');
select pg_temp.chk('kdi', 'BG tập huấn: nội dung phải thuộc chương trình đã chọn', $q$update training_lessons set unit_id = (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH' and u.title = 'ISO bài 1' limit 1) where title = 'ISO BG 5 thẻ'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_lessons set program_id = null, unit_id = (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH' and u.title = 'ISO bài 1' limit 1) where title = 'ISO BG 5 thẻ'$q$, true);
select pg_temp.chk('kdi', 'BG tập huấn: chương trình tự lấy theo nội dung', $q$select p.title from training_lessons l join training_programs p on p.id = l.program_id where l.title = 'ISO BG 5 thẻ'$q$, 'ISO CTTH');
select pg_temp.chk('so_hy', 'BG tập huấn: Sở không phát hành bài của KDI', $q$select training_lesson_publish((select id from training_lessons where title = 'ISO BG 5 thẻ'))$q$, 'ERR*');

-- ===== TH 104: đơn vị lập kế hoạch thêm thẳng giáo viên, chọn duyệt luôn hoặc chờ duyệt =====
select pg_temp.chk('kdi', 'TH 104: kế hoạch nháp chưa thêm giáo viên được', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH nháp lịch'), array[(select id from teachers where org_id = pg_temp.oid_('THCS-KB') order by full_name limit 1)])$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, mode, year_name) values (platform_org_id(), 'ISO KH TT', 'draft', 'offline', '2026-2027')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id) select k.id, p.id from training_plans k, training_programs p where k.name = 'ISO KH TT' and p.title = 'ISO CTTH A' and p.status = 'published'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published' where name = 'ISO KH TT'$q$, true);
select pg_temp.chk('so_hy', 'TH 104: Sở không thêm giáo viên vào kế hoạch của KDI', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH TT'), array[(select id from teachers where org_id = pg_temp.oid_('THCS-KB') order by full_name limit 1)])$q$, 'ERR*');
select pg_temp.chk('kdi', 'TH 104: Quản trị thêm giáo viên của trường chưa gán, để chờ duyệt', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH TT'), array[(select id from teachers where org_id = pg_temp.oid_('THCS-KB') order by full_name limit 1)], false)$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH TT'), array[(select id from teachers where org_id = pg_temp.oid_('THCS-KB') order by full_name limit 1)], false)$q$, true);
select pg_temp.chk('kdi', 'TH 104: trường tự được gán, danh sách chờ duyệt, nguồn là đơn vị lập kế hoạch', $q$select o.status || ':' || (select string_agg(e.source, ',') from training_enrollments e where e.plan_id = o.plan_id) from training_plan_orgs o join training_plans k on k.id = o.plan_id where k.name = 'ISO KH TT' and o.org_id = pg_temp.oid_('THCS-KB')$q$, 'submitted:admin');
select pg_temp.chk('kdi', 'TH 104: thêm lại giáo viên đã có tên thì bỏ qua', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH TT'), array[(select id from teachers where org_id = pg_temp.oid_('THCS-KB') order by full_name limit 1)], false)$q$, '0');
select pg_temp.chk('kdi', 'TH 104: danh sách giáo viên để chọn có cờ đã có tên', $q$select count(*) filter (where enrolled) from training_plan_teacher_pool((select id from training_plans where name = 'ISO KH TT'), pg_temp.oid_('THCS-KB'))$q$, '1');
select pg_temp.chk('so_hy', 'TH 104: Sở không xem danh sách chọn của kế hoạch KDI', $q$select count(*) from training_plan_teacher_pool((select id from training_plans where name = 'ISO KH TT'), pg_temp.oid_('THCS-PH'))$q$, '0');
select pg_temp.chk('kdi', 'TH 104: thêm giáo viên và duyệt luôn', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH TT'), array(select id from teachers where org_id = pg_temp.oid_('THCS-PH') and email = 'gv_ph2@iso-test.local'), true)$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_add_teachers((select id from training_plans where name = 'ISO KH TT'), array(select id from teachers where org_id = pg_temp.oid_('THCS-PH') and email = 'gv_ph2@iso-test.local'), true)$q$, true);
select pg_temp.chk('kdi', 'TH 104: danh sách trường đó đã duyệt', $q$select o.status from training_plan_orgs o join training_plans k on k.id = o.plan_id where k.name = 'ISO KH TT' and o.org_id = pg_temp.oid_('THCS-PH')$q$, 'approved');
select pg_temp.chk('gv_ph2', 'TH 104: giáo viên được thêm thấy mình có tên', $q$select count(*) from training_enrollments e join training_plans k on k.id = e.plan_id where k.name = 'ISO KH TT'$q$, '1');
select pg_temp.chk('gv_ph2', 'TH 104: giáo viên không tự thêm mình bằng quyền lập kế hoạch', $q$select training_plan_add_me((select id from training_plans where name = 'ISO KH TT'))::text$q$, 'ERR*');
select pg_temp.chk('kdi', 'TH 104: Quản trị tự ghi danh, tạo hồ sơ giáo viên khi chưa có', $q$select (training_plan_add_me((select id from training_plans where name = 'ISO KH TT')) is not null)::text$q$, 'true');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_add_me((select id from training_plans where name = 'ISO KH TT'))$q$, true);
select pg_temp.chk('kdi', 'TH 104: Quản trị có tên trong kế hoạch, không gán thêm trường', $q$select (select count(*) from training_enrollments e where e.plan_id = k.id and e.teacher_id = my_teacher_id()) || ':' || (select count(*) from training_plan_orgs o where o.plan_id = k.id) from training_plans k where k.name = 'ISO KH TT'$q$, '1:2');
select pg_temp.chk('kdi', 'TH 104: tự ghi danh lần nữa không tạo thêm hồ sơ', $q$select training_plan_add_me((select id from training_plans where name = 'ISO KH TT')) = my_teacher_id() and (select count(*) from teachers where profile_id = auth.uid()) = 1$q$, 'true');

-- ===== TH 105: bài test qua link ngoài, nhập điểm bài test; Kho hoạt động tuỳ chọn =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title) values (platform_org_id(), 'ISO CTTH L')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title) select id, 'subject', 1, 'ISO môn L' from training_programs where title = 'ISO CTTH L'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours, has_test, detail) select p.id, u.id, 'content', 1, 'ISO L1', 2, true, '{"docs":[{"title":"ISO tài liệu L","url":"https://d"}]}' from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH L'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours, detail) select p.id, u.id, 'content', 2, 'ISO L2', 2, '{"lectures":[{"title":"ISO slide L","url":"https://s"}]}' from training_programs p join training_program_units u on u.program_id = p.id and u.kind = 'subject' where p.title = 'ISO CTTH L'$q$, true);
select pg_temp.chk('kdi', 'TH 105: link bài test phải là http(s)', $q$update training_program_units set detail = detail || '{"test":{"kind":"link","url":"ftp://x"}}' where title = 'ISO L1'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_program_units set detail = detail || '{"test":{"kind":"link"}}' where title = 'ISO L1'$q$, true);
select pg_temp.chk('kdi', 'TH 105: có bài test qua link mà chưa nhập link thì chưa phát hành', $q$update training_programs set status = 'published' where title = 'ISO CTTH L'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_program_units set detail = detail || '{"test":{"kind":"link","url":"https://forms.gle/iso","pass":6,"due":"2030-06-30"}}' where title = 'ISO L1'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH L'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, year_name) values (platform_org_id(), 'ISO KH L', 'draft', '2026-2027')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH L' and p.title = 'ISO CTTH L'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published' where name = 'ISO KH L'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-KB')]) from training_plans where name = 'ISO KH L'$q$, true);
insert into training_enrollments (org_id, plan_id, teacher_id) select t.org_id, k.id, t.id from training_plans k, teachers t where k.name = 'ISO KH L' and t.full_name = 'GV thử B';
select pg_temp.probe('gv_both@iso-test.local', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('THCS-KB'))), true);
select pg_temp.chk('gv_both', 'TH 105: khoá học có bài test qua link, kèm link và điểm đạt', $q$select (training_course(id) #>> '{units,0,test,kind}') || ':' || (training_course(id) #>> '{units,0,test,url}') || ':' || (training_course(id) #>> '{units,0,test,pass}') from training_plans where name = 'ISO KH L'$q$, 'link:https://forms.gle/iso:6');
select pg_temp.chk('gv_both', 'TH 105: bài test qua link không làm trong hệ thống', $q$select training_test_start((select id from training_plans where name = 'ISO KH L'), (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))::text$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'TH 105: chưa mở tài liệu thì chưa mở link bài test', $q$select training_test_link_open((select id from training_plans where name = 'ISO KH L'), (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))$q$, 'ERR 22023');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_learn_mark((select id from training_plans where name = 'ISO KH L'), (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'), 'd0')::text$q$, true);
select pg_temp.chk('gv_both', 'TH 105: mở link bài test, trả về link', $q$select training_test_link_open((select id from training_plans where name = 'ISO KH L'), (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))$q$, 'https://forms.gle/iso');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_test_link_open((select id from training_plans where name = 'ISO KH L'), (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))$q$, true);
select pg_temp.chk('gv_both', 'TH 105: đã mở link thì nội dung xong, mở nội dung sau', $q$select string_agg((u ->> 'done') || '/' || (u ->> 'unlocked'), ',' order by (u ->> 'ord')::int) from jsonb_array_elements(training_course((select id from training_plans where name = 'ISO KH L')) -> 'units') u$q$, 'true/true,false/true');
select pg_temp.chk('kdi', 'TH 105: chưa có điểm thì bài test chưa tính đạt', $q$select (metrics ->> 'tests') || ':' || (metrics ->> 'tests_passed') from training_plan_results((select id from training_plans where name = 'ISO KH L'))$q$, '1:0');
select pg_temp.chk('kdi', 'TH 105: điểm bài test từ 0 đến 10', $q$select training_test_scores_set((select id from training_plans where name = 'ISO KH L'), jsonb_build_array(jsonb_build_object('teacher_id', e.teacher_id, 'unit_id', (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'), 'score', 11)))::text from training_enrollments e where e.plan_id = (select id from training_plans where name = 'ISO KH L')$q$, 'ERR 22023');
select pg_temp.chk('admin_kb', 'TH 105: trường không nhập điểm kế hoạch của KDI', $q$select training_test_scores_set((select id from training_plans where name = 'ISO KH L'), jsonb_build_array(jsonb_build_object('teacher_id', t.id, 'unit_id', (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'), 'score', 8)))::text from teachers t where t.full_name = 'GV thử B'$q$, 'ERR 42501');
select pg_temp.chk('kdi', 'TH 105: không nhập điểm cho nội dung không có bài test', $q$select training_test_scores_set((select id from training_plans where name = 'ISO KH L'), jsonb_build_array(jsonb_build_object('teacher_id', e.teacher_id, 'unit_id', (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L2'), 'score', 8)))::text from training_enrollments e where e.plan_id = (select id from training_plans where name = 'ISO KH L')$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_test_scores_set((select id from training_plans where name = 'ISO KH L'), jsonb_build_array(jsonb_build_object('teacher_id', e.teacher_id, 'unit_id', (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'), 'score', 7.5)))::text from training_enrollments e where e.plan_id = (select id from training_plans where name = 'ISO KH L')$q$, true);
select pg_temp.chk('kdi', 'TH 105: nhập điểm xong thì bài test đạt', $q$select (metrics ->> 'tests_passed') || ':' || (metrics ->> 'avg_score') from training_plan_results((select id from training_plans where name = 'ISO KH L'))$q$, '1:7.5');
select pg_temp.chk('kdi', 'TH 105: bảng điểm bài test có điểm nhập tay và lúc mở link', $q$select concat_ws(':', jsonb_array_length(x -> 'units'), x #>> array['rows','0','scores',((select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))::text,'score'], x #>> array['rows','0','scores',((select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))::text,'manual'], (x #>> array['rows','0','scores',((select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'))::text,'opened']) is not null) from training_plan_test_scores((select id from training_plans where name = 'ISO KH L')) x$q$, '1:7.5:true:t');
select pg_temp.chk('gv_both', 'TH 105: giáo viên thấy điểm của mình', $q$select training_course((select id from training_plans where name = 'ISO KH L')) #>> '{units,0,best_score}'$q$, '7.5');
select pg_temp.chk('admin_ph', 'TH 105: trường khác không xem bảng điểm', $q$select jsonb_array_length(training_plan_test_scores((select id from training_plans where name = 'ISO KH L')) -> 'rows')::text$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$select training_test_scores_set((select id from training_plans where name = 'ISO KH L'), jsonb_build_array(jsonb_build_object('teacher_id', e.teacher_id, 'unit_id', (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1'), 'score', null)))::text from training_enrollments e where e.plan_id = (select id from training_plans where name = 'ISO KH L')$q$, true);
select pg_temp.chk('kdi', 'TH 105: để trống thì bỏ điểm nhập tay', $q$select coalesce((select best_score::text || score_manual::text from training_progress where plan_id = (select id from training_plans where name = 'ISO KH L') and unit_id = (select u.id from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH L' and u.title = 'ISO L1')), 'null')$q$, 'null');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_lessons (org_id, title, status, content) values (platform_org_id(), 'ISO BG 4 thẻ', 'draft', '{"checked":["info","content","links","norms"]}'::jsonb)$q$, true);
select pg_temp.chk('kdi', 'TH 105: bài giảng tập huấn phát hành khi đủ 4 thẻ, Kho hoạt động tuỳ chọn', $q$select training_lesson_publish(id) from training_lessons where title = 'ISO BG 4 thẻ'$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$update training_lessons set content = '{"checked":["info","content","links","bank"]}' where title = 'ISO BG 4 thẻ'$q$, true);
select pg_temp.chk('kdi', 'TH 105: thiếu thẻ bắt buộc thì chưa phát hành', $q$select training_lesson_publish(id) from training_lessons where title = 'ISO BG 4 thẻ'$q$, 'ERR 22023');

-- ===== TH 106: tệp tài liệu tập huấn mở được khi chương trình đã phát hành =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title) values (platform_org_id(), 'ISO CTTH F')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title) select id, 'subject', 1, 'ISO môn F' from training_programs where title = 'ISO CTTH F'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours, detail) select p.id, u.id, 'content', 1, 'ISO F1', 1, jsonb_build_object('docs', jsonb_build_array(jsonb_build_object('title', 'ISO tệp F', 'file', platform_org_id()::text || '/training/iso-f.pdf'))) from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH F'$q$, true);
select pg_temp.chk('gv_both', 'TH 106: chương trình còn nháp thì giáo viên trường khác chưa mở được tệp', $q$select learning_file_readable(platform_org_id()::text || '/training/iso-f.pdf')::text$q$, 'false');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH F'$q$, true);
select pg_temp.chk('gv_both', 'TH 106: chương trình đã phát hành thì giáo viên mở được tệp tài liệu', $q$select learning_file_readable(platform_org_id()::text || '/training/iso-f.pdf')::text$q$, 'true');
select pg_temp.chk('gv_both', 'TH 106: tệp không thuộc tài liệu tập huấn vẫn không mở được', $q$select learning_file_readable(platform_org_id()::text || '/training/khac.pdf')::text$q$, 'false');

-- ===== TD 109: đề cuối khoá theo ma trận, khung đánh giá, xếp loại; ma trận đề môn học =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into question_bank (org_id, subject, topic, level, kind, stem, options, answer) values
  (platform_org_id(), 'ISO TH9', 'Robot', 'nhan_biet', 'single', 'Cảm biến siêu âm đo gì?', '["Khoảng cách","Nhiệt độ"]', '[0]'),
  (platform_org_id(), 'ISO TH9', 'Robot', 'nhan_biet', 'truefalse', 'Servo quay được góc?', '["Đúng","Sai"]', '[0]'),
  (platform_org_id(), 'ISO TH9', 'Robot', 'van_dung', 'single', 'Robot né vật cản dùng?', '["Siêu âm","Ánh sáng"]', '[0]')$q$, true);
select pg_temp.chk('kdi', 'TD 109: số câu sẵn có theo chủ đề × mức độ', $q$select string_agg(topic || '/' || level || '=' || n, ',' order by level) from exam_bank_stats(platform_org_id(), 'ISO TH9')$q$, 'Robot/nhan_biet=2,Robot/van_dung=1');
select pg_temp.chk('admin_ph', 'TD 109: trường không xem ngân hàng của KDI', $q$select count(*) from exam_bank_stats(platform_org_id(), 'ISO TH9')$q$, 'ERR');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title) values (platform_org_id(), 'ISO CTTH E')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title) select id, 'subject', 1, 'ISO môn E' from training_programs where title = 'ISO CTTH E'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours) select p.id, u.id, 'content', 1, 'ISO E1', 2 from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH E'$q$, true);
select pg_temp.chk('kdi', 'TD 109: mức độ trong ma trận phải hợp lệ', $q$update training_programs set final_exam = '{"matrix":[{"level":"x","count":1}]}' where title = 'ISO CTTH E'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'TD 109: thang xếp loại không trùng điểm', $q$update training_programs set eval_frame = '{"weights":{"final":100},"grades":[{"label":"A","min":5},{"label":"B","min":5}]}' where title = 'ISO CTTH E'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'TD 109: khung cần ít nhất một trọng số', $q$update training_programs set eval_frame = '{"weights":{"final":0},"grades":[{"label":"Đạt","min":5}]}' where title = 'ISO CTTH E'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set
  final_exam = '{"subject":"ISO TH9","matrix":[{"topic":"Robot","level":"nhan_biet","count":2},{"level":"van_dung","count":1}],"attempts":2,"pass":5,"shuffle":true}',
  eval_frame = '{"weights":{"att":20,"tests":30,"final":50,"product":0},"req":{"final":5,"total":5},"grades":[{"label":"Giỏi","min":8},{"label":"Đạt","min":5}],"fail_label":"Không đạt"}'
  where title = 'ISO CTTH E'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH E'$q$, true);
select pg_temp.chk('kdi', 'TD 109: đã phát hành thì không sửa đề cuối khoá', $q$update training_programs set final_exam = null where title = 'ISO CTTH E'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_new_version((select id from training_programs where title = 'ISO CTTH E' and status = 'published'))::text$q$, true);
select pg_temp.chk('kdi', 'TD 109: phiên bản mới chép đề cuối khoá và khung đánh giá', $q$select (x.final_exam ->> 'subject') || ':' || (x.eval_frame ->> 'fail_label') from training_programs x where x.title = 'ISO CTTH E' and x.status = 'draft'$q$, 'ISO TH9:Không đạt');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, year_name) values (platform_org_id(), 'ISO KH E', 'draft', '2026-2027')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH E' and p.title = 'ISO CTTH E' and p.status = 'published'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published' where name = 'ISO KH E'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-KB')]) from training_plans where name = 'ISO KH E'$q$, true);
insert into training_enrollments (org_id, plan_id, teacher_id) select t.org_id, k.id, t.id from training_plans k, teachers t where k.name = 'ISO KH E' and t.full_name = 'GV thử B';
select pg_temp.probe('gv_both@iso-test.local', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('THCS-KB'))), true);
select pg_temp.chk('gv_both', 'TD 109: khoá học có đề cuối khoá 3 câu, học xong thì làm được', $q$select (x #>> '{finals,0,count}') || ':' || (x #>> '{finals,0,ready}') || ':' || (x #>> '{finals,0,attempts}') from training_course_finals((select id from training_plans where name = 'ISO KH E')) x$q$, '3:true:2');
select pg_temp.chk('kdi', 'TD 109: chưa làm đề thì tổng điểm 0, chưa đạt theo khung', $q$select (metrics ->> 'total') || ':' || (metrics ->> 'grade') || ':' || (metrics ->> 'suggest') from training_plan_results((select id from training_plans where name = 'ISO KH E'))$q$, '0.00:Không đạt:fail');
select pg_temp.chk('gv_both', 'TD 109: đề rút đủ 3 câu theo ma trận, không kèm đáp án', $q$select jsonb_array_length(x -> 'questions') || ':' || (x #> '{questions,0,answer}' is null) from training_final_start((select id from training_plans where name = 'ISO KH E'), (select id from training_programs where title = 'ISO CTTH E' and status = 'published')) x$q$, '3:true');
select pg_temp.chk('admin_ph', 'TD 109: người không có tên không làm đề cuối khoá', $q$select training_final_start((select id from training_plans where name = 'ISO KH E'), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'))::text$q$, 'ERR');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_final_start((select id from training_plans where name = 'ISO KH E'), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'))::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', format($q$select training_final_submit(%L::uuid, %L::jsonb)::text$q$, a.id, (select jsonb_object_agg(q.id, q.answer) from question_bank q where q.id = any(a.questions))), true)
  from training_final_attempts a join training_plans k on k.id = a.plan_id where k.name = 'ISO KH E' and a.submitted_at is null;
select pg_temp.chk('kdi', 'TD 109: làm đúng hết thì tổng 10, xếp loại Giỏi, gợi ý Đạt', $q$select (metrics ->> 'total') || ':' || (metrics ->> 'grade') || ':' || (metrics ->> 'suggest') from training_plan_results((select id from training_plans where name = 'ISO KH E'))$q$, '10.00:Giỏi:pass');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_final_start((select id from training_plans where name = 'ISO KH E'), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'))::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select training_final_submit((select a.id from training_final_attempts a join training_plans k on k.id = a.plan_id where k.name = 'ISO KH E' and a.submitted_at is null), '{}')::text$q$, true);
select pg_temp.chk('gv_both', 'TD 109: hết 2 lượt thì không làm thêm', $q$select training_final_start((select id from training_plans where name = 'ISO KH E'), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'))::text$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'TD 109: điểm đề cuối khoá là lượt cao nhất', $q$select x #>> '{finals,0,best}' from training_course_finals((select id from training_plans where name = 'ISO KH E')) x$q$, '10.0');
select pg_temp.probe('kdi@iso-test.local', $q$select training_result_set(t.id, e.teacher_id, 'pass', null)::text from training_plans t join training_enrollments e on e.plan_id = t.id where t.name = 'ISO KH E'$q$, true);
select pg_temp.chk('kdi', 'TD 109: kết luận lưu tổng điểm, xếp loại; chứng chỉ mang theo', $q$select r.grade || ':' || c.grade || ':' || c.total_score from training_results r join training_plans k on k.id = r.plan_id join certificates c on c.plan_id = r.plan_id and c.teacher_id = r.teacher_id where k.name = 'ISO KH E'$q$, 'Giỏi:Giỏi:10.00');
select pg_temp.chk('kdi', 'TD 109: dữ liệu in chứng chỉ có xếp loại', $q$select training_cert_view(c.id) ->> 'grade' from certificates c join training_plans k on k.id = c.plan_id where k.name = 'ISO KH E'$q$, 'Giỏi');
select pg_temp.chk('admin_ph', 'TD 109: trường khác không xem bảng điểm đề cuối khoá', $q$select count(*) from training_plan_final_scores((select id from training_plans where name = 'ISO KH E'))$q$, '0');
select pg_temp.chk('kdi', 'TD 109: kế hoạch không có khung dùng khung mặc định theo điều kiện cũ', $q$select (training_eval_frame(id) ->> 'default') || ':' || (training_eval_frame(id) #>> '{grades,0,label}') from training_plans where name = 'ISO KH L'$q$, 'true:Xuất sắc');
select pg_temp.chk('admin_kb', 'TD 109: đề môn học theo ma trận tự tính số câu', $q$with x as (insert into practice_exams (org_id, title, subject, mode, criteria) values (my_org_id(), 'ISO đề ma trận', 'ISO Toán', 'random', '{"matrix":[{"level":"thong_hieu","count":2},{"topic":"","count":1}]}') returning criteria) select criteria ->> 'count' from x$q$, '3');
select pg_temp.chk('admin_kb', 'TD 109: ma trận đề môn học sai mức độ bị từ chối', $q$insert into practice_exams (org_id, title, subject, mode, criteria) values (my_org_id(), 'ISO đề sai', 'ISO Toán', 'random', '{"matrix":[{"level":"kho","count":2}]}')$q$, 'ERR 22023');

-- ===== TD 110: đề luyện tập huấn, thống kê đề, câu hay sai =====
select pg_temp.chk('admin_ph', 'TD 110: trường không tạo đề luyện cho KDI', $q$insert into training_practice_exams (org_id, program_id, title, subject, matrix) values (platform_org_id(), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'), 'ISO luyện X', 'ISO TH9', '[{"level":"nhan_biet","count":1}]')$q$, 'ERR');
select pg_temp.chk('kdi', 'TD 110: đề luyện cần ít nhất 1 câu', $q$insert into training_practice_exams (org_id, program_id, title, subject) values (platform_org_id(), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'), 'ISO luyện 0', 'ISO TH9')$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_practice_exams (org_id, program_id, title, subject, matrix, attempts, pass) values (platform_org_id(), (select id from training_programs where title = 'ISO CTTH E' and status = 'published'), 'ISO luyện E', 'ISO TH9', '[{"topic":"Robot","level":"nhan_biet","count":2}]', 2, 5)$q$, true);
select pg_temp.chk('gv_both', 'TD 110: đề nháp giáo viên không thấy', $q$select jsonb_array_length(training_practice_mine())$q$, '0');
select pg_temp.probe('kdi@iso-test.local', $q$update training_practice_exams set status = 'published' where title = 'ISO luyện E'$q$, true);
select pg_temp.chk('gv_both', 'TD 110: đề đang mở hiện cho giáo viên có tên trong kế hoạch', $q$select (x -> 0 ->> 'title') || ':' || (x -> 0 ->> 'count') || ':' || (x -> 0 ->> 'used') from training_practice_mine() x$q$, 'ISO luyện E:2:0');
select pg_temp.chk('admin_ph', 'TD 110: người không có tên không làm đề luyện', $q$select training_practice_start((select id from training_practice_exams where title = 'ISO luyện E'))::text$q$, 'ERR');
select pg_temp.chk('gv_both', 'TD 110: phát đề đủ câu, không kèm đáp án', $q$select jsonb_array_length(x -> 'questions') || ':' || (x #> '{questions,0,answer}' is null) from training_practice_start((select id from training_practice_exams where title = 'ISO luyện E')) x$q$, '2:true');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_practice_start((select id from training_practice_exams where title = 'ISO luyện E'))::text$q$, true);
select pg_temp.chk('gv_both', 'TD 110: nộp sai hết thì 0 điểm, có đáp án để xem lại', $q$select (x ->> 'score') || ':' || jsonb_array_length(x -> 'review') || ':' || (x #>> '{review,0,ok}') from training_practice_submit((select a.id from training_practice_attempts a where a.exam_id = (select id from training_practice_exams where title = 'ISO luyện E') and a.submitted_at is null), '{}') x$q$, '0.0:2:false');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_practice_submit((select a.id from training_practice_attempts a where a.exam_id = (select id from training_practice_exams where title = 'ISO luyện E') and a.submitted_at is null), '{}')::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', $q$select training_practice_start((select id from training_practice_exams where title = 'ISO luyện E'))::text$q$, true);
select pg_temp.probe('gv_both@iso-test.local', format($q$select training_practice_submit(%L::uuid, %L::jsonb)::text$q$, a.id, (select jsonb_object_agg(q.id, q.answer) from question_bank q where q.id = any(a.questions))), true)
  from training_practice_attempts a join training_practice_exams x on x.id = a.exam_id where x.title = 'ISO luyện E' and a.submitted_at is null;
select pg_temp.chk('gv_both', 'TD 110: hết lượt thì không làm thêm', $q$select training_practice_start((select id from training_practice_exams where title = 'ISO luyện E'))::text$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'TD 110: điểm cao nhất của giáo viên', $q$select x -> 0 ->> 'best' from training_practice_mine() x$q$, '10.0');
select pg_temp.chk('kdi', 'TD 110: thống kê đề luyện: 2 lượt, 1 GV, đạt theo lượt cao nhất', $q$select attempts || ':' || teachers || ':' || avg_score || ':' || passed from training_exam_stats() where kind = 'practice' and ref = (select id from training_practice_exams where title = 'ISO luyện E')$q$, '2:1:5.00:1');
select pg_temp.chk('kdi', 'TD 110: thống kê có đề cuối khoá', $q$select attempts || ':' || best_avg from training_exam_stats() where kind = 'final' and ref = (select id from training_programs where title = 'ISO CTTH E' and status = 'published')$q$, '2:10.00');
select pg_temp.chk('kdi', 'TD 110: câu hay sai: mỗi câu gặp 2 lần, sai 1', $q$select string_agg(seen || '/' || wrong, ',') from training_exam_hard('practice', (select id from training_practice_exams where title = 'ISO luyện E'))$q$, '2/1,2/1');
select pg_temp.chk('admin_ph', 'TD 110: trường khác không thấy lượt làm của GV trường khác', $q$select count(*) from training_exam_stats() where kind = 'practice'$q$, '0');
select pg_temp.chk('gv_both', 'TD 110: giáo viên không ghi trực tiếp lượt làm', $q$update training_practice_attempts set score = 9$q$, 'rows:0');

-- ===== SL 111: số lượng tối đa của kế hoạch, danh sách chờ, thông báo =====
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, year_name, max_learners) values (platform_org_id(), 'ISO KH CAP', 'draft', '2026-2027', 1)$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH CAP' and p.title = 'ISO CTTH E' and p.status = 'published'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published', self_register = true, register_until = '2099-12-31' where name = 'ISO KH CAP'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_assign(id, array[(select id from organizations where code = 'THCS-PH'), (select id from organizations where code = 'THCS-KB')]) from training_plans where name = 'ISO KH CAP'$q$, true);
select pg_temp.chk('kdi', 'SL 111: số lượng tối đa phải từ 1', $q$update training_plans set max_learners = 0 where name = 'ISO KH CAP'$q$, 'ERR*');
select pg_temp.chk('gv_ph2', 'SL 111: còn chỗ thì đăng ký vào chờ trường xét', $q$select training_register(id) from training_plans where name = 'ISO KH CAP'$q$, 'pending');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select training_register(id) from training_plans where name = 'ISO KH CAP'$q$, true);
select pg_temp.chk('kdi', 'SL 111: đầy thì đơn vị lập kế hoạch nhận thông báo đã đủ', $q$select count(*) from notifications where kind = 'training_capacity' and user_id = auth.uid() and title like 'Kế hoạch tập huấn đã đủ số lượng%ISO KH CAP'$q$, '1');
select pg_temp.chk('gv_both', 'SL 111: kế hoạch đầy thì báo hết chỗ, không phải lỗi', $q$select (training_register_check(id) -> 'errors')::text || '|' || (training_register_check(id) -> 'full')::text from training_plans where name = 'ISO KH CAP'$q$, '[]|["Kế hoạch đã đủ số lượng 1 giáo viên"]');
select pg_temp.chk('gv_both', 'SL 111: hết chỗ thì không gửi đăng ký thường', $q$select training_register(id) from training_plans where name = 'ISO KH CAP'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'SL 111: hết chỗ thì gửi được đăng ký chờ', $q$select training_register(id, null, '{}', null, true) from training_plans where name = 'ISO KH CAP'$q$, 'waitlist');
select pg_temp.probe('gv_both@iso-test.local', $q$select training_register(id, null, '{}', null, true) from training_plans where name = 'ISO KH CAP'$q$, true);
select pg_temp.chk('gv_both', 'SL 111: GV thấy số chỗ của kế hoạch và thứ tự chờ', $q$select reg_status || ':' || plan_taken || '/' || max_learners || ':' || wait_pos from training_open_plans() where name = 'ISO KH CAP'$q$, 'waitlist:1/1:1');
select pg_temp.chk('kdi', 'SL 111: còn người chờ xét chiếm chỗ thì chưa nhận được người chờ', format('select training_registration_review((select id from training_plans where name = ''ISO KH CAP''), %L, true)::text', (select teacher_id from training_registrations where status = 'waitlist' and plan_id = (select id from training_plans where name = 'ISO KH CAP'))), 'ERR 22023');
select pg_temp.chk('kdi', 'SL 111: ghi danh thẳng cũng không vượt số lượng tối đa', format('insert into training_enrollments (org_id, plan_id, teacher_id) select org_id, (select id from training_plans where name = ''ISO KH CAP''), id from teachers where id = %L', (select teacher_id from training_registrations where status = 'waitlist' and plan_id = (select id from training_plans where name = 'ISO KH CAP'))), 'ERR 22023');
select pg_temp.probe('admin_ph@iso-test.local', format('select training_registration_review((select id from training_plans where name = ''ISO KH CAP''), %s, false, ''Thử'')::text', pg_temp.tid('GV thử C')), true);
select pg_temp.chk('kdi', 'SL 111: có chỗ trống mà còn người chờ thì được báo', $q$select count(*) from notifications where kind = 'training_capacity' and user_id = auth.uid() and title like 'Kế hoạch tập huấn có chỗ trống%ISO KH CAP'$q$, '1');
select pg_temp.chk('kdi', 'SL 111: nhận người trong danh sách chờ', format('select training_registration_review((select id from training_plans where name = ''ISO KH CAP''), %L, true)::text', (select teacher_id from training_registrations where status = 'waitlist' and plan_id = (select id from training_plans where name = 'ISO KH CAP'))), '');
select pg_temp.probe('kdi@iso-test.local', format('select training_registration_review((select id from training_plans where name = ''ISO KH CAP''), %L, true)::text', (select teacher_id from training_registrations where status = 'waitlist' and plan_id = (select id from training_plans where name = 'ISO KH CAP'))), true);
select pg_temp.chk('gv_both', 'SL 111: được nhận từ danh sách chờ → có tên, nhận thông báo', $q$select r.status || ':' || exists (select 1 from training_enrollments e where e.plan_id = r.plan_id and e.teacher_id = r.teacher_id) || ':' || (select count(*) from notifications n where n.user_id = auth.uid() and n.kind = 'training_registration' and n.title like 'Đăng ký tập huấn đã được duyệt%ISO KH CAP') from training_registrations r where r.plan_id = (select id from training_plans where name = 'ISO KH CAP')$q$, 'accepted:true:1');
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set max_learners = 2 where name = 'ISO KH CAP'$q$, true);
select pg_temp.chk('gv_ph2', 'SL 111: tăng số lượng thì đăng ký lại được', $q$select training_register(id) from training_plans where name = 'ISO KH CAP'$q$, 'pending');

-- ===== SL 114: phiếu đánh giá sau khoá tập huấn, đánh giá giảng viên =====
select pg_temp.probe('gv_both@iso-test.local', format('select public.switch_org(%s)', quote_literal(pg_temp.oid_('THCS-KB'))), true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_sessions set trainer_ids = array[(select id from trainers where full_name = 'ISO GV Một')] where plan_id = (select id from training_plans where name = 'ISO KH')$q$, true);
select pg_temp.chk('gv_both', 'SL 114: có kết quả thì phiếu mở, kèm giảng viên của kế hoạch', $q$select (x ->> 'open') || ':' || jsonb_array_length(x -> 'trainers') || ':' || coalesce(x ->> 'mine', '-') from (select training_feedback_form(id) x from training_plans where name = 'ISO KH') t$q$, 'true:1:-');
select pg_temp.chk('gv_ph2', 'SL 114: GV không có tên trong kế hoạch không mở được phiếu', format('select training_feedback_form(%L)::text', (select id from training_plans where name = 'ISO KH')), 'ERR');
select pg_temp.chk('gv_both', 'SL 114: điểm ngoài 1–5 bị từ chối', $q$select training_feedback_submit(id, '{"content":6,"method":5,"organize":4,"materials":3,"applicable":5,"overall":4}')::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'SL 114: thiếu tiêu chí bị từ chối', $q$select training_feedback_submit(id, '{"content":4}')::text from training_plans where name = 'ISO KH'$q$, 'ERR 22023');
select pg_temp.chk('gv_both', 'SL 114: không chấm giảng viên ngoài kế hoạch', format($q$select training_feedback_submit(id, '{"content":4,"method":5,"organize":4,"materials":3,"applicable":5,"overall":4}', null, jsonb_build_array(jsonb_build_object('id', %L::uuid, 'expertise', 5, 'delivery', 4, 'interaction', 4)))::text from training_plans where name = 'ISO KH'$q$, (select id from trainers where full_name = 'ISO GV Hai')), 'ERR 22023');
select pg_temp.chk('gv_both', 'SL 114: GV không ghi thẳng bảng phiếu', $q$insert into training_feedback (plan_id, teacher_id, org_id, content, method, organize, materials, applicable, overall) select id, my_teacher_id(), my_org_id(), 5, 5, 5, 5, 5, 5 from training_plans where name = 'ISO KH'$q$, 'ERR');
select pg_temp.chk('gv_both', 'SL 114: GV gửi phiếu khoá học và giảng viên', format($q$select training_feedback_submit(id, '{"content":4,"method":5,"organize":4,"materials":3,"applicable":5,"overall":4}', ' Nên thêm giờ thực hành ', jsonb_build_array(jsonb_build_object('id', %L::uuid, 'expertise', 5, 'delivery', 4, 'interaction', 4, 'comment', 'Dễ hiểu')))::text from training_plans where name = 'ISO KH'$q$, (select id from trainers where full_name = 'ISO GV Một')), '');
select pg_temp.probe('gv_both@iso-test.local', format($q$select training_feedback_submit(id, '{"content":4,"method":5,"organize":4,"materials":3,"applicable":5,"overall":4}', ' Nên thêm giờ thực hành ', jsonb_build_array(jsonb_build_object('id', %L::uuid, 'expertise', 5, 'delivery', 4, 'interaction', 4, 'comment', 'Dễ hiểu')))::text from training_plans where name = 'ISO KH'$q$, (select id from trainers where full_name = 'ISO GV Một')), true);
select pg_temp.chk('gv_both', 'SL 114: GV thấy lại phiếu đã gửi', $q$select (x #>> '{mine,overall}') || ':' || (x #>> '{mine,comment}') || ':' || (x #>> '{trainers,0,mine,expertise}') from (select training_feedback_form(id) x from training_plans where name = 'ISO KH') t$q$, '4:Nên thêm giờ thực hành:5');
select pg_temp.chk('admin_kb', 'SL 114: trường xem tổng hợp mức hài lòng của trường mình', $q$select s.enrolled || ':' || s.responses || ':' || s.overall || ':' || s.materials from training_feedback_stats() s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, '1:1:4.00:3.00');
select pg_temp.chk('admin_ph', 'SL 114: trường khác không xem tổng hợp', $q$select count(*) from training_feedback_stats() s join training_plans k on k.id = s.plan_id where k.name = 'ISO KH'$q$, '0');
select pg_temp.chk('kdi', 'SL 114: đơn vị lập kế hoạch xem góp ý, không kèm tên GV', $q$select string_agg(kind || ':' || comment, ',' order by kind) from training_feedback_comments((select id from training_plans where name = 'ISO KH'))$q$, 'course:Nên thêm giờ thực hành,trainer:Dễ hiểu');
select pg_temp.chk('admin_ph', 'SL 114: trường khác không xem góp ý', $q$select count(*) from training_feedback_comments((select id from training_plans where name = 'ISO KH'))$q$, '0');
select pg_temp.chk('kdi', 'SL 114: điểm giảng viên ở đơn vị quản lý giảng viên', $q$select s.responses || ':' || s.overall from trainer_feedback_stats() s join trainers t on t.id = s.trainer_id where t.full_name = 'ISO GV Một'$q$, '1:4.33');
select pg_temp.chk('admin_kb', 'SL 114: trường không xem điểm giảng viên của KDI', $q$select count(*) from trainer_feedback_stats()$q$, '0');
select pg_temp.chk('admin_kb', 'SL 114: không đọc thẳng bảng phiếu của GV', $q$select count(*) from training_feedback$q$, '0');

-- ===== SL 115: đáp ứng chương trình — GV được phân công có chứng chỉ hoặc đạt năng lực của chương trình cùng loại =====
insert into training_programs (org_id, title, ct_code, competencies, target_level) values (platform_org_id(), 'ISO CTTH RD', 'CT3', array['gv_thiet_ke'], 3);
insert into training_program_units (program_id, kind, seq, title, hours) select id, 'subject', 1, 'ISO RD môn', 0 from training_programs where title = 'ISO CTTH RD';
insert into training_program_units (program_id, parent_id, kind, seq, title, hours) select p.id, u.id, 'content', 1, 'ISO RD bài', 2 from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH RD';
update training_programs set status = 'published' where title = 'ISO CTTH RD';
insert into teachers (org_id, full_name) values (pg_temp.oid_('THCS-KB'), 'GV thử RD'), (pg_temp.oid_('THCS-KB'), 'GV thử RD2');
insert into stem_teacher_programs (org_id, teacher_id, program) select org_id, id, 'CT3' from teachers where full_name in ('GV thử B', 'GV thử RD', 'GV thử RD2') on conflict do nothing;
insert into classes (org_id, name, grade) values (pg_temp.oid_('THCS-KB'), 'ISO 6RD', 6);
insert into class_programs (org_id, class_id, program) select org_id, id, 'CT3' from classes where name = 'ISO 6RD';
insert into training_plans (org_id, name, pub_status, mode) values (platform_org_id(), 'ISO KH RD', 'draft', 'hybrid');
insert into training_plan_items (plan_id, program_id) select k.id, p.id from training_plans k, training_programs p where k.name = 'ISO KH RD' and p.title = 'ISO CTTH RD';
insert into certificates (org_id, teacher_id, plan_id, code, issued_on, status) select t.org_id, t.id, k.id, 'ISO-RD-1', current_date, 'issued' from teachers t, training_plans k where t.full_name = 'GV thử RD' and k.name = 'ISO KH RD';
select pg_temp.chk('admin_kb', 'SL 115: trường thấy số lớp, GV phân công, GV đạt chuẩn theo chương trình', format($q$select classes || ':' || assigned || ':' || qualified from program_readiness() where org_id = %L and ct_code = 'CT3'$q$, pg_temp.oid_('THCS-KB')), '1:3:2');
select pg_temp.chk('admin_kb', 'SL 115: đạt chuẩn nhờ chứng chỉ cùng loại hoặc năng lực đạt mức đích', format($q$select string_agg((x ->> 'name') || ':' || (x ->> 'ok') || ':' || coalesce(x ->> 'cert', '-') || ':' || jsonb_array_length(coalesce(x -> 'missing', '[]')), ',' order by x ->> 'name') from program_readiness() r, jsonb_array_elements(r.teachers) x where r.org_id = %L and r.ct_code = 'CT3'$q$, pg_temp.oid_('THCS-KB')), 'GV thử B:true:-:0,GV thử RD:true:ISO-RD-1:0,GV thử RD2:false:-:1');
select pg_temp.chk('admin_kb', 'SL 115: gợi ý chương trình tập huấn cùng loại', format($q$select (suggest @> '[{"title":"ISO CTTH RD"}]')::text from program_readiness() where org_id = %L and ct_code = 'CT3'$q$, pg_temp.oid_('THCS-KB')), 'true');
select pg_temp.chk('kdi', 'SL 115: quản trị nền tảng xem mọi trường', format($q$select count(*) from program_readiness() where org_id = %L and ct_code = 'CT3'$q$, pg_temp.oid_('THCS-KB')), '1');
select pg_temp.chk('admin_ph', 'SL 115: trường khác không xem', format($q$select count(*) from program_readiness() where org_id = %L$q$, pg_temp.oid_('THCS-KB')), '0');
select pg_temp.chk('gv_ph2', 'SL 115: giáo viên không xem bảng đáp ứng', $q$select count(*) from program_readiness()$q$, '0');

-- ===== SL 116: Kho hoạt động của Đào tạo tập huấn (activities.domain) =====
select pg_temp.chk('kdi', 'SL 116: hoạt động cũ thuộc kho dạy học', $q$select count(*) filter (where domain <> 'school') from activities$q$, '0');
select pg_temp.chk('kdi', 'SL 116: KDI tạo hoạt động trong kho tập huấn', $q$with x as (insert into activities (org_id, kind, title, is_template, status, domain) values (platform_org_id(), 'quiz', 'ISO HĐ tập huấn', true, 'draft', 'training') returning domain) select domain from x$q$, 'training');
select pg_temp.chk('kdi', 'SL 116: kho không hợp lệ bị từ chối', $q$insert into activities (org_id, kind, title, domain) values (platform_org_id(), 'quiz', 'ISO HĐ sai', 'other')$q$, 'ERR 23514');

-- ===== PV 117: phạm vi áp dụng của chương trình tập huấn; mời đăng ký, kế hoạch không cần duyệt =====
select pg_temp.chk('kdi', 'PV 117: GV đăng ký chờ duyệt → đơn vị tổ chức (cấp trên) nhận thông báo', $q$select count(*) from notifications where kind = 'training_registration' and user_id = auth.uid() and title like 'Giáo viên đăng ký tập huấn chờ duyệt%ISO KH CAP'$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_programs (org_id, title) values (platform_org_id(), 'ISO CTTH PV')$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, kind, seq, title, hours) select id, 'subject', 1, 'ISO PV môn', 0 from training_programs where title = 'ISO CTTH PV'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_program_units (program_id, parent_id, kind, seq, title, hours) select p.id, u.id, 'content', 1, 'ISO PV nd', 2 from training_programs p join training_program_units u on u.program_id = p.id where p.title = 'ISO CTTH PV'$q$, true);
select pg_temp.chk('kdi', 'PV 117: mặc định áp dụng mọi đơn vị', $q$select scope from training_programs where title = 'ISO CTTH PV'$q$, 'all');
select pg_temp.chk('kdi', 'PV 117: phạm vi chỉ nhận all / selected', $q$update training_programs set scope = 'x' where title = 'ISO CTTH PV'$q$, 'ERR*');
select pg_temp.chk('kdi', 'PV 117: hiệu lực đến không trước hiệu lực từ', $q$update training_programs set effective_from = '2026-10-01', effective_to = '2026-09-01' where title = 'ISO CTTH PV'$q$, 'ERR*');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set status = 'published' where title = 'ISO CTTH PV'$q$, true);
select pg_temp.chk('kdi', 'PV 117: đổi phạm vi được cả khi đã phát hành', $q$update training_programs set scope = 'selected' where title = 'ISO CTTH PV'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set scope = 'selected' where title = 'ISO CTTH PV'$q$, true);
select pg_temp.chk('admin_ph', 'PV 117: trường không chọn phạm vi chương trình', format('insert into training_program_targets (program_id, org_id) values (%L, %L)', (select id from training_programs where title = 'ISO CTTH PV'), pg_temp.oid_('THCS-PH')), 'ERR');
select pg_temp.chk('kdi', 'PV 117: không chọn chính đơn vị soạn', $q$insert into training_program_targets (program_id, org_id) select id, org_id from training_programs where title = 'ISO CTTH PV'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', format('insert into training_program_targets (program_id, org_id) select id, %L from training_programs where title = ''ISO CTTH PV''', pg_temp.oid_('THCS-PH')), true);
select pg_temp.chk('admin_ph', 'PV 117: trường trong phạm vi thấy chương trình', $q$select count(*) from training_programs where title = 'ISO CTTH PV'$q$, '1');
select pg_temp.chk('admin_kb', 'PV 117: trường ngoài phạm vi không thấy chương trình', $q$select count(*) from training_programs where title = 'ISO CTTH PV'$q$, '0');
select pg_temp.chk('admin_kb', 'PV 117: trường ngoài phạm vi không thấy nội dung', $q$select count(*) from training_program_units u join training_programs p on p.id = u.program_id where p.title = 'ISO CTTH PV'$q$, '0');
select pg_temp.chk('kdi', 'PV 117: áp dụng cho trường được chọn, không cho trường khác', format('select training_program_applies(id, %L) || '':'' || training_program_applies(id, %L) from training_programs where title = ''ISO CTTH PV''', pg_temp.oid_('THCS-PH'), pg_temp.oid_('THCS-KB')), 'true:false');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status, year_name) values (platform_org_id(), 'ISO KH PV', 'draft', '2026-2027')$q$, true);
select pg_temp.chk('kdi', 'PV 117: KDI (cấp trên của đơn vị được chọn) dùng chương trình trong kế hoạch', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH PV' and p.title = 'ISO CTTH PV'$q$, 'rows:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH PV' and p.title = 'ISO CTTH PV'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$update training_plans set pub_status = 'published', self_register = true, register_until = '2099-12-31', register_approval = false where name = 'ISO KH PV'$q$, true);
select pg_temp.chk('kdi', 'PV 117: màn gán trường biết trường ngoài phạm vi', format('select string_agg(x::text, '','') from training_plan_out_of_scope((select id from training_plans where name = ''ISO KH PV''), array[%L, %L]::uuid[]) x', pg_temp.oid_('THCS-PH'), pg_temp.oid_('THCS-KB')), pg_temp.oid_('THCS-KB')::text);
select pg_temp.chk('kdi', 'PV 117: không gán kế hoạch cho trường ngoài phạm vi', format('select training_plan_assign(id, array[%L]::uuid[])::text from training_plans where name = ''ISO KH PV''', pg_temp.oid_('THCS-KB')), 'ERR 22023');
select pg_temp.chk('kdi', 'PV 117: gán được trường trong phạm vi', format('select training_plan_assign(id, array[%L]::uuid[])::text from training_plans where name = ''ISO KH PV''', pg_temp.oid_('THCS-PH')), '1');
select pg_temp.probe('kdi@iso-test.local', format('select training_plan_assign(id, array[%L]::uuid[])::text from training_plans where name = ''ISO KH PV''', pg_temp.oid_('THCS-PH')), true);
select pg_temp.chk('kdi', 'PV 117: trường ngoài phạm vi không dùng được chương trình khi lập kế hoạch', format('select training_program_usable_by(id, %L)::text from training_programs where title = ''ISO CTTH PV''', pg_temp.oid_('THCS-KB')), 'false');
select pg_temp.probe('kdi@iso-test.local', $q$select training_program_new_version(id)::text from training_programs where title = 'ISO CTTH PV' and status = 'published'$q$, true);
select pg_temp.chk('kdi', 'PV 117: phiên bản mới chép phạm vi và đơn vị áp dụng', $q$select g.scope || ':' || (select count(*) from training_program_targets t where t.program_id = g.id) from training_programs g where g.title = 'ISO CTTH PV' and g.status = 'draft'$q$, 'selected:1');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plans (org_id, name, pub_status) values (platform_org_id(), 'ISO KH PV2', 'draft')$q$, true);
select pg_temp.chk('admin_kb', 'PV 117: trường không được gán thì không mời được', format('select training_register_invite(%L)::text', (select id from training_plans where name = 'ISO KH PV')), 'ERR*');
select pg_temp.chk('kdi', 'PV 117: đơn vị lập kế hoạch mời GV các trường được gán', $q$select training_register_invite(id) from training_plans where name = 'ISO KH PV'$q$, '>0');
select pg_temp.probe('kdi@iso-test.local', $q$select training_register_invite(id)::text from training_plans where name = 'ISO KH PV'$q$, true);
select pg_temp.chk('gv_ph2', 'PV 117: GV nhận thông báo mời đăng ký', $q$select count(*) from notifications where kind = 'training_invite' and user_id = auth.uid() and title like 'Mời đăng ký tập huấn%ISO KH PV'$q$, '1');
select pg_temp.chk('gv_ph2', 'PV 117: GV thấy kế hoạch không cần duyệt', $q$select register_approval::text from training_open_plans() where name = 'ISO KH PV'$q$, 'false');
select pg_temp.chk('gv_ph2', 'PV 117: không cần duyệt → đăng ký là có tên ngay', $q$select training_register(id) from training_plans where name = 'ISO KH PV'$q$, 'accepted');
select pg_temp.probe('gv_ph2@iso-test.local', $q$select training_register(id) from training_plans where name = 'ISO KH PV'$q$, true);
select pg_temp.chk('gv_ph2', 'PV 117: đăng ký đã nhận + có tên trong kế hoạch', $q$select r.status || ':' || e.source from training_registrations r join training_enrollments e on e.plan_id = r.plan_id and e.teacher_id = r.teacher_id where r.plan_id = (select id from training_plans where name = 'ISO KH PV')$q$, 'accepted:self');
select pg_temp.probe('kdi@iso-test.local', $q$select training_register_invite(id)::text from training_plans where name = 'ISO KH PV'$q$, true);
select pg_temp.chk('gv_ph2', 'PV 117: mời lại không gửi cho GV đã có tên', $q$select count::text from notifications where kind = 'training_invite' and user_id = auth.uid() and ref_id = (select id from training_plans where name = 'ISO KH PV')$q$, '1');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set effective_to = '2020-01-01' where title = 'ISO CTTH PV' and status = 'published'$q$, true);
select pg_temp.chk('kdi', 'PV 117: hết hiệu lực thì không chọn cho kế hoạch mới', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH PV2' and p.title = 'ISO CTTH PV' and p.status = 'published'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'PV 117: ghi lần mời gần nhất của trường', $q$select (invited_at is not null)::text from training_plan_orgs where plan_id = (select id from training_plans where name = 'ISO KH PV')$q$, 'true');


-- ===== KT 118: đơn vị xây dựng, trợ giảng, kết thúc kế hoạch, báo cáo =====
select pg_temp.chk('kdi', 'KT 118: lưu đơn vị xây dựng (gọn khoảng trắng)', $q$with u as (update training_programs set builder = '  Sở GD&ĐT   Hưng Yên ' where title = 'ISO CTTH PV' and status = 'draft' returning builder) select builder from u$q$, 'Sở GD&ĐT Hưng Yên');
select pg_temp.probe('kdi@iso-test.local', $q$update training_programs set builder = 'KDI Education' where title = 'ISO CTTH PV' and status = 'published'$q$, true);
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_plan_items (plan_id, program_id, seq) select k.id, p.id, 1 from training_plans k, training_programs p where k.name = 'ISO KH PV2' and p.title = 'ISO CTTH E' and p.status = 'published'$q$, true);
select pg_temp.chk('kdi', 'KT 118: chọn trợ giảng cho chương trình trong kế hoạch, tên tự ghép', $q$with u as (update training_plan_items i set assistant_ids = array[(select id from trainers where full_name = 'ISO GV Hai')] from training_plans k where k.id = i.plan_id and k.name = 'ISO KH PV2' returning i.assistant) select assistant from u$q$, 'ISO GV Hai');
select pg_temp.chk('kdi', 'KT 118: một người không vừa giảng viên vừa trợ giảng', $q$update training_plan_items i set trainer_ids = array[(select id from trainers where full_name = 'ISO GV Hai')], assistant_ids = array[(select id from trainers where full_name = 'ISO GV Hai')] from training_plans k where k.id = i.plan_id and k.name = 'ISO KH PV2'$q$, 'ERR 22023');
select pg_temp.chk('admin_ph', 'KT 118: trường không kết thúc kế hoạch của KDI', $q$select training_plan_close(id)::text from training_plans where name = 'ISO KH PV'$q$, 'ERR');
select pg_temp.probe('kdi@iso-test.local', $q$insert into training_sessions (org_id, plan_id, title, starts_at, ends_at) select org_id, id, 'ISO buổi sau', now() + interval '3 day', now() + interval '3 day 2 hour' from training_plans where name = 'ISO KH PV'$q$, true);
select pg_temp.chk('kdi', 'KT 118: kết thúc bị chặn khi còn buổi tương lai', $q$select training_plan_close(id)::text from training_plans where name = 'ISO KH PV'$q$, 'ERR 22023');
select pg_temp.probe('kdi@iso-test.local', $q$update training_sessions set starts_at = now() - interval '2 hour', ends_at = now() - interval '1 hour' where title = 'ISO buổi sau'$q$, true);
select pg_temp.chk('kdi', 'KT 118: kết thúc kế hoạch: chốt điểm danh, trả số liệu', $q$select (x ->> 'enrolled') || ':' || (x ->> 'pending') from training_plan_close((select id from training_plans where name = 'ISO KH PV'), 'Xong đợt') x$q$, '1:1');
select pg_temp.probe('kdi@iso-test.local', $q$select training_plan_close(id, 'Xong đợt')::text from training_plans where name = 'ISO KH PV'$q$, true);
select pg_temp.chk('kdi', 'KT 118: buổi được chốt, tự đăng ký tắt', $q$select (s.closed_at is not null) || ':' || k.self_register || ':' || (k.closed_at is not null) from training_sessions s join training_plans k on k.id = s.plan_id where s.title = 'ISO buổi sau'$q$, 'true:false:true');
select pg_temp.chk('gv_ph2', 'KT 118: GV có tên nhận thông báo kết thúc', $q$select count(*) from notifications where kind = 'training_closed' and user_id = auth.uid()$q$, '1');
select pg_temp.chk('kdi', 'KT 118: kế hoạch đã kết thúc không ghi danh thêm', format('insert into training_enrollments (org_id, plan_id, teacher_id) values (%L, (select id from training_plans where name = ''ISO KH PV''), %s)', pg_temp.oid_('THCS-PH'), pg_temp.tid('GV thử A')), 'ERR 22023');
select pg_temp.chk('kdi', 'KT 118: kết thúc lần hai báo lỗi', $q$select training_plan_close(id)::text from training_plans where name = 'ISO KH PV'$q$, 'ERR 22023');
select pg_temp.chk('kdi', 'KT 118: báo cáo có đợt, số giờ, trạng thái kết thúc', $q$select closed || ':' || enrolled || ':' || org_name from training_report() where plan_name = 'ISO KH PV'$q$, 'true:1:Trường THCS Phố Hiến');
select pg_temp.chk('admin_kb', 'KT 118: trường khác không thấy số liệu của trường khác trong báo cáo', $q$select count(*) from training_report() where plan_name = 'ISO KH PV'$q$, '0');
select pg_temp.chk('kdi', 'KT 118: mở lại kế hoạch đã kết thúc', $q$select training_plan_reopen(id)::text from training_plans where name = 'ISO KH PV'$q$, '');

-- ===== Dọn dẹp + kết quả =====
select pg_temp.cleanup();
select case when bool_and(ok) then 'PASS' else 'FAIL' end || ' ' || count(*) filter (where ok) || '/' || count(*) as "Tổng"
  from t_result;
insert into approval_bypass select * from t_bypass on conflict (kind) do nothing;
select id, case when ok then 'PASS' else 'FAIL' end as kq, who, name, expect, got from t_result order by ok, id;
