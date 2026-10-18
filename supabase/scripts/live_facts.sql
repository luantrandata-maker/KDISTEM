-- Truy vấn dữ kiện trên CSDL thật, chạy trong giao dịch CHỈ ĐỌC (job schema-diff, đầu ra facts.txt).
-- Sửa file này khi cần tra cứu thêm; mọi lệnh ghi đều bị CSDL từ chối.
select '## role_permissions: cột org_id';
select coalesce(string_agg(column_name || ' ' || data_type, ', '), '(không có)') from information_schema.columns
 where table_schema = 'public' and table_name = 'role_permissions' and column_name = 'org_id';
select '## role_permissions: chỉ mục';
select indexname || ': ' || indexdef from pg_indexes where schemaname = 'public' and tablename = 'role_permissions' order by 1;
select '## role_permissions: số dòng theo org_id (null = mặc định)';
select coalesce(string_agg(x, E'\n'), '(cột org_id không tồn tại)') from (
  select format('%s: %s dòng', coalesce(o, '(null)'), n) as x from (
    select (to_jsonb(rp) ->> 'org_id') as o, count(*) as n from role_permissions rp group by 1 order by 1) s) t;
select '## role_permissions: dòng có org_id (chi tiết, tối đa 50)';
select coalesce(string_agg(x, E'\n'), '(không có)') from (
  select format('%s %s.%s view:%s detail:%s create:%s edit:%s delete:%s', to_jsonb(rp) ->> 'org_id', r.key, rp.module,
                rp.can_view, rp.can_detail, rp.can_create, rp.can_edit, rp.can_delete) as x
    from role_permissions rp join roles r on r.id = rp.role_id
   where to_jsonb(rp) ->> 'org_id' is not null order by 1 limit 50) t;
select '## role_permissions: (role_id, module) trùng nhau';
select count(*) from (select role_id, module from role_permissions group by 1, 2 having count(*) > 1) d;
select '## quyền borrow / edu_plans';
select coalesce(string_agg(format('%s %s org:%s', r.key, rp.module, coalesce(r.org_id::text, 'hệ thống')), E'\n'), '(không có)')
  from role_permissions rp join roles r on r.id = rp.role_id where rp.module in ('borrow', 'edu_plans');
select '## org_role_permissions có borrow / edu_plans';
select count(*) from org_role_permissions where module in ('borrow', 'edu_plans');
select '## roles: vai trò hệ thống có org_id (roles_admin_write cho sửa)';
select count(*) from roles where is_system and org_id is not null;
select '## Lịch chạy nền (pg_cron)';
select case when to_regclass('cron.job') is null then '(không có pg_cron)'
  else coalesce((xpath('/row/v/text()', query_to_xml(
    'select string_agg(jobname || '' | '' || schedule || '' | '' || command, chr(10)) as v from cron.job', false, true, '')))[1]::text, '(chưa có lịch)') end;
select '## Lần chạy gần nhất (system_job_runs, 5 lần)';
select case when to_regclass('public.system_job_runs') is null then '(chưa có bảng)'
  else coalesce((xpath('/row/v/text()', query_to_xml(
    'select string_agg(x, chr(10)) as v from (select format(''%s %s ok=%s %s'', job, to_char(started_at at time zone ''Asia/Ho_Chi_Minh'', ''YYYY-MM-DD HH24:MI''), ok, result::text) as x from system_job_runs order by id desc limit 5) t', false, true, '')))[1]::text, '(chưa chạy lần nào)') end;
select '## pg_cron: trạng thái lịch';
select case when to_regclass('cron.job') is null then '(không có pg_cron)'
  else coalesce((xpath('/row/v/text()', query_to_xml(
    'select string_agg(jobid || '' | '' || jobname || '' | active='' || active || '' | db='' || database || '' | user='' || username, chr(10)) as v from cron.job', false, true, '')))[1]::text, '(chưa có lịch)') end;
select '## pg_cron: 5 lần chạy gần nhất (cron.job_run_details)';
select case when to_regclass('cron.job_run_details') is null then '(không có bảng)'
  else coalesce((xpath('/row/v/text()', query_to_xml(
    'select string_agg(x, chr(10)) as v from (select format(''%s %s %s %s'', jobid, to_char(start_time at time zone ''Asia/Ho_Chi_Minh'', ''YYYY-MM-DD HH24:MI''), status, left(coalesce(return_message, ''''), 300)) as x from cron.job_run_details order by start_time desc nulls last limit 5) t', false, true, '')))[1]::text, '(chưa chạy lần nào)') end;
