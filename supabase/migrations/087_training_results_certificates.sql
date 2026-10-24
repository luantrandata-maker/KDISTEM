-- 087. Phân hệ 1 — Đánh giá kết quả tập huấn + Chứng chỉ (đợt 5)
--  • training_results: mỗi GV một dòng mỗi kế hoạch. Hệ thống tự tính chuyên cần (điểm danh), bài kiểm tra (điểm cao nhất
--    từng nội dung), tiến độ học, sản phẩm; gợi ý Đạt / Chưa đạt theo điều kiện của chương trình. Đơn vị lập kế hoạch
--    chấm điểm sản phẩm, nhận xét, kết luận (Chưa đạt phải ghi lý do; Đạt khi chưa đủ điều kiện cũng phải ghi lý do),
--    cho thi lại (thêm lượt làm bài kiểm tra).
--  • Chứng chỉ: GV được kết luận Đạt → tự tạo chứng chỉ "chờ duyệt"; đơn vị lập kế hoạch duyệt cấp (sinh mã CCTH-năm-số),
--    thu hồi (có lý do), cấp lại. Mỗi chứng chỉ có mã tra cứu công khai (QR). Kết quả đổi sang Chưa đạt thì chứng chỉ
--    chờ duyệt bị xoá, chứng chỉ đã cấp bị thu hồi.
--  • certificate_templates: mẫu chứng chỉ (tiêu đề, nội dung có chỗ điền, đơn vị cấp, người ký, logo, thời hạn);
--    KDI soạn; chương trình tập huấn chọn mẫu (cert_template_id), không chọn thì dùng mẫu mặc định.
--  • Chỉ ghi qua RPC; bỏ quyền ghi thẳng bảng certificates.
-- Cần chạy sau 086.

-- ===== 1. Bảng =====
create table if not exists certificate_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade default public.my_org_id(),
  name text not null check (length(btrim(name)) between 1 and 200),
  title text not null default 'CHỨNG CHỈ' check (length(title) <= 120),
  body text not null default 'Đã hoàn thành chương trình tập huấn {chuong_trinh} ({so_gio} giờ) thuộc {ke_hoach}.' check (length(body) <= 2000),
  issuer_name text check (issuer_name is null or length(issuer_name) <= 200),
  signer_name text check (signer_name is null or length(signer_name) <= 120),
  signer_title text check (signer_title is null or length(signer_title) <= 120),
  logo_url text check (logo_url is null or length(logo_url) <= 1000),
  valid_months int check (valid_months is null or valid_months between 1 and 240),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists certificate_templates_default on certificate_templates (is_default) where is_default;
insert into certificate_templates (org_id, name, issuer_name, signer_title, is_default)
select o.id, 'Mẫu chuẩn KDI', 'KDI Education', 'Giám đốc', true from organizations o where o.id = public.platform_org_id()
  and not exists (select 1 from certificate_templates where is_default);

alter table training_programs add column if not exists cert_template_id uuid references certificate_templates(id) on delete set null;

create table if not exists training_results (
  plan_id uuid not null references training_plans(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  product_score numeric(4,1) check (product_score is null or product_score between 0 and 10),
  comment text check (comment is null or length(comment) <= 2000),
  result text not null default 'pending' check (result in ('pending', 'pass', 'fail')),
  reason text check (reason is null or length(reason) <= 1000),
  extra_attempts int not null default 0 check (extra_attempts between 0 and 20),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (plan_id, teacher_id)
);

alter table certificates
  add column if not exists status text not null default 'issued',
  add column if not exists template_id uuid references certificate_templates(id) on delete set null,
  add column if not exists verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists expires_on date,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text,
  add column if not exists issued_by uuid references profiles(id) on delete set null,
  add column if not exists hours numeric(6,1),
  add column if not exists program_titles text,
  add column if not exists created_at timestamptz not null default now();
do $$ begin
  alter table certificates add constraint certificates_v5_check check (
    status in ('pending', 'issued', 'revoked') and (revoked_reason is null or length(revoked_reason) <= 500));
exception when duplicate_object then null; end $$;
create unique index if not exists certificates_verify_token on certificates (verify_token);
create index if not exists certificates_plan_teacher on certificates (plan_id, teacher_id);

-- ===== 2. Quyền xem =====
-- Xem kết quả / chứng chỉ của một GV: KDI, cấp quản lý có quyền tập huấn trong phạm vi, hoặc chính GV
create or replace function public.training_can_view_teacher(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or p_teacher = public.my_teacher_id()
      or ((public.is_authority() or public.has_perm('training', 'view')) and public.training_teacher_in_my_tree(p_teacher))
$$;

alter table certificate_templates enable row level security;
alter table training_results enable row level security;
drop policy if exists certificate_templates_read on certificate_templates;
create policy certificate_templates_read on certificate_templates for select to authenticated using (true);
drop policy if exists certificate_templates_write on certificate_templates;
create policy certificate_templates_write on certificate_templates for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, insert, update, delete on certificate_templates to authenticated;

drop policy if exists training_results_read on training_results;
create policy training_results_read on training_results for select to authenticated
  using (public.training_plan_can_manage(plan_id) or public.training_can_view_teacher(teacher_id));
grant select on training_results to authenticated;

-- Chứng chỉ: chỉ đọc; ghi qua RPC
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'certificates' loop
    execute format('drop policy %I on certificates', p.policyname);
  end loop;
end $$;
create policy certificates_read on certificates for select to authenticated using (
  (public.can_access_org(org_id) and public.is_staff() and (public.is_authority() or public.has_perm('training', 'view') or public.is_platform_admin()))
  or teacher_id = public.my_teacher_id() or public.training_plan_can_manage(plan_id));
revoke insert, update, delete on certificates from authenticated;
grant select on certificates to authenticated;

-- ===== 3. Chỉ số kết quả của một GV =====
create or replace function public.training_result_metrics(p_plan uuid, p_teacher uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s int; v_p int; v_ex int; v_units int; v_done int; v_tests int; v_tp int; v_avg numeric; v_pst text; v_ps numeric;
        v_att_req int; v_score_req numeric; v_need boolean; v_att numeric; ok_att boolean; ok_tests boolean; ok_units boolean; ok_prod boolean;
begin
  select count(*), count(*) filter (where a.present), count(*) filter (where a.present is not true and a.excuse_status = 'approved')
    into v_s, v_p, v_ex
    from training_attendance a join training_sessions s on s.id = a.session_id where s.plan_id = p_plan and a.teacher_id = p_teacher;
  select count(*), count(*) filter (where public.training_unit_done(p_plan, x.unit_id, p_teacher)),
         count(*) filter (where public.training_unit_test_on(x.unit_id)),
         count(*) filter (where public.training_unit_test_on(x.unit_id) and pr.best_score >= public.training_unit_pass(x.unit_id)),
         round(avg(pr.best_score) filter (where public.training_unit_test_on(x.unit_id)), 1)
    into v_units, v_done, v_tests, v_tp, v_avg
    from public.training_plan_units(p_plan) x
    left join training_progress pr on pr.plan_id = p_plan and pr.unit_id = x.unit_id and pr.teacher_id = p_teacher;
  select max(g.pass_attendance), max(g.pass_score), coalesce(bool_or(g.need_product), false) into v_att_req, v_score_req, v_need
    from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan;
  select d.status into v_pst from training_products d where d.plan_id = p_plan and d.teacher_id = p_teacher;
  select r.product_score into v_ps from training_results r where r.plan_id = p_plan and r.teacher_id = p_teacher;
  -- Vắng có phép không tính vào mẫu số
  v_att := case when v_s - v_ex > 0 then round(v_p * 100.0 / (v_s - v_ex), 1) end;
  ok_att := v_att is null or v_att >= coalesce(v_att_req, 0);
  ok_tests := v_tp = v_tests;
  ok_units := v_done = v_units;
  ok_prod := not v_need or (v_pst = 'accepted' and (v_ps is null or v_ps >= 5));
  return jsonb_build_object('sessions', v_s, 'present', v_p, 'excused', v_ex, 'att_pct', v_att, 'att_req', coalesce(v_att_req, 0),
    'units', v_units, 'done', v_done, 'tests', v_tests, 'tests_passed', v_tp, 'avg_score', v_avg, 'score_req', v_score_req,
    'need_product', v_need, 'product_status', v_pst,
    'ok_att', ok_att, 'ok_tests', ok_tests, 'ok_units', ok_units, 'ok_product', ok_prod,
    'suggest', case when ok_att and ok_tests and ok_units and ok_prod then 'pass' else 'fail' end);
end $$;

-- Bảng kết quả của kế hoạch: đơn vị lập kế hoạch xem tất cả, trường / Sở xem GV trong phạm vi
create or replace function public.training_plan_results(p_plan uuid)
returns table (teacher_id uuid, teacher_name text, subject text, org_name text, metrics jsonb, result text, reason text,
               product_score numeric, comment text, extra_attempts int, decided_at timestamptz,
               product_url text, product_note text, cert_id uuid, cert_status text, cert_code text)
language sql stable security definer set search_path = public as $$
  select e.teacher_id, t.full_name, t.subject, o.name, public.training_result_metrics(p_plan, e.teacher_id),
         coalesce(r.result, 'pending'), r.reason, r.product_score, r.comment, coalesce(r.extra_attempts, 0), r.decided_at,
         d.url, d.note, c.id, c.status, c.code
    from training_enrollments e
    join teachers t on t.id = e.teacher_id
    left join organizations o on o.id = t.org_id
    left join training_results r on r.plan_id = p_plan and r.teacher_id = e.teacher_id
    left join training_products d on d.plan_id = p_plan and d.teacher_id = e.teacher_id
    left join lateral (select c.* from certificates c where c.plan_id = p_plan and c.teacher_id = e.teacher_id
                        order by (c.status = 'revoked'), c.created_at desc limit 1) c on true
   where e.plan_id = p_plan
     and (public.training_plan_can_manage(p_plan) or public.training_can_view_teacher(e.teacher_id))
   order by o.name, t.full_name
$$;

-- ===== 4. Kết luận, chấm sản phẩm, thi lại =====
create or replace function public.training_result_check(p_plan uuid, p_teacher uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không quản lý kế hoạch này' using errcode = '42501'; end if;
  if not exists (select 1 from training_enrollments where plan_id = p_plan and teacher_id = p_teacher) then
    raise exception 'Giáo viên không có tên trong kế hoạch' using errcode = '22023';
  end if;
end $$;

-- Đồng bộ chứng chỉ theo kết luận
create or replace function public.training_cert_sync(p_plan uuid, p_teacher uuid, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tpl uuid;
begin
  if p_result = 'pass' then
    if not exists (select 1 from certificates where plan_id = p_plan and teacher_id = p_teacher and status <> 'revoked') then
      select t.org_id into v_org from teachers t where t.id = p_teacher;
      select coalesce((select g.cert_template_id from training_plan_items i join training_programs g on g.id = i.program_id
                        where i.plan_id = p_plan and g.cert_template_id is not null order by i.seq limit 1),
                      (select id from certificate_templates where is_default limit 1)) into v_tpl;
      insert into certificates (org_id, teacher_id, plan_id, status, template_id, hours, program_titles)
      select v_org, p_teacher, p_plan, 'pending', v_tpl, p.hours,
             (select string_agg(g.title, ' · ' order by i.seq) from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan)
        from training_plans p where p.id = p_plan;
    end if;
  else
    delete from certificates where plan_id = p_plan and teacher_id = p_teacher and status = 'pending';
    update certificates set status = 'revoked', revoked_at = now(), revoked_reason = 'Kết quả tập huấn đổi thành chưa đạt'
     where plan_id = p_plan and teacher_id = p_teacher and status = 'issued';
  end if;
end $$;

create or replace function public.training_result_set(p_plan uuid, p_teacher uuid, p_result text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_m jsonb;
begin
  perform public.training_result_check(p_plan, p_teacher);
  if p_result not in ('pending', 'pass', 'fail') then raise exception 'Kết luận không hợp lệ' using errcode = '22023'; end if;
  p_reason := nullif(btrim(p_reason), '');
  v_m := public.training_result_metrics(p_plan, p_teacher);
  if p_result = 'fail' and p_reason is null then raise exception 'Chưa đạt thì ghi lý do' using errcode = '22023'; end if;
  if p_result = 'pass' and v_m ->> 'suggest' <> 'pass' and p_reason is null then
    raise exception 'Giáo viên chưa đủ điều kiện: ghi lý do nếu vẫn kết luận Đạt' using errcode = '22023';
  end if;
  insert into training_results (plan_id, teacher_id, result, reason, decided_by, decided_at)
  values (p_plan, p_teacher, p_result, p_reason, case when p_result <> 'pending' then auth.uid() end, case when p_result <> 'pending' then now() end)
  on conflict (plan_id, teacher_id) do update set result = excluded.result, reason = excluded.reason,
    decided_by = excluded.decided_by, decided_at = excluded.decided_at, updated_at = now();
  perform public.training_cert_sync(p_plan, p_teacher, p_result);
  if p_result <> 'pending' then
    insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
    select t.org_id, t.profile_id, 'training_result',
           case when p_result = 'pass' then 'Bạn đạt khoá tập huấn' else 'Kết quả tập huấn: chưa đạt' end,
           (select name from training_plans where id = p_plan) || coalesce(': ' || p_reason, ''),
           'Bài giảng tập huấn', 'teacher', p_plan
      from teachers t where t.id = p_teacher and t.profile_id is not null;
  end if;
end $$;

create or replace function public.training_result_grade(p_plan uuid, p_teacher uuid, p_score numeric, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.training_result_check(p_plan, p_teacher);
  if p_score is not null and (p_score < 0 or p_score > 10) then raise exception 'Điểm sản phẩm từ 0 đến 10' using errcode = '22023'; end if;
  insert into training_results (plan_id, teacher_id, product_score, comment) values (p_plan, p_teacher, p_score, nullif(btrim(p_comment), ''))
  on conflict (plan_id, teacher_id) do update set product_score = excluded.product_score, comment = excluded.comment, updated_at = now();
end $$;

-- Cho thi lại: thêm lượt làm bài kiểm tra, đưa kết luận về "chờ"
create or replace function public.training_result_retake(p_plan uuid, p_teacher uuid, p_extra int default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.training_result_check(p_plan, p_teacher);
  if p_extra is null or p_extra < 1 or p_extra > 5 then raise exception 'Số lượt thêm từ 1 đến 5' using errcode = '22023'; end if;
  if exists (select 1 from training_results where plan_id = p_plan and teacher_id = p_teacher and result = 'pass') then
    raise exception 'Giáo viên đã đạt, không cần thi lại' using errcode = '22023';
  end if;
  insert into training_results (plan_id, teacher_id, extra_attempts) values (p_plan, p_teacher, p_extra)
  on conflict (plan_id, teacher_id) do update set extra_attempts = least(training_results.extra_attempts + p_extra, 20),
    result = 'pending', decided_by = null, decided_at = null, updated_at = now();
  insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
  select t.org_id, t.profile_id, 'training_result', 'Bạn được học bù / thi lại',
         (select name from training_plans where id = p_plan) || ': thêm ' || p_extra || ' lượt làm bài kiểm tra', 'Bài giảng tập huấn', 'teacher', p_plan
    from teachers t where t.id = p_teacher and t.profile_id is not null;
end $$;

-- Xác nhận Đạt cho mọi GV đủ điều kiện mà chưa có kết luận
create or replace function public.training_results_confirm(p_plan uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không quản lý kế hoạch này' using errcode = '42501'; end if;
  for r in select e.teacher_id from training_enrollments e
            left join training_results x on x.plan_id = e.plan_id and x.teacher_id = e.teacher_id
           where e.plan_id = p_plan and coalesce(x.result, 'pending') = 'pending'
             and public.training_result_metrics(p_plan, e.teacher_id) ->> 'suggest' = 'pass' loop
    perform public.training_result_set(p_plan, r.teacher_id, 'pass', null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== 5. Chứng chỉ =====
create or replace function public.training_cert_issue(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare c certificates; n int := 0; v_code text; v_seq int; v_months int; v_y text := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY');
begin
  for c in select * from certificates where id = any(p_ids) loop
    if not public.training_plan_can_manage(c.plan_id) then raise exception 'Bạn không cấp được chứng chỉ của kế hoạch này' using errcode = '42501'; end if;
    if c.status = 'issued' then continue; end if;
    if not exists (select 1 from training_results where plan_id = c.plan_id and teacher_id = c.teacher_id and result = 'pass') then
      raise exception 'Chỉ cấp chứng chỉ cho giáo viên đã kết luận Đạt' using errcode = '22023';
    end if;
    if exists (select 1 from certificates x where x.plan_id = c.plan_id and x.teacher_id = c.teacher_id and x.status = 'issued' and x.id <> c.id) then
      raise exception 'Giáo viên đã có chứng chỉ của kế hoạch này' using errcode = '22023';
    end if;
    v_code := c.code;
    if v_code is null then
      select coalesce(max(substring(code from '^CCTH-' || v_y || '-(\d+)$')::int), 0) + 1 into v_seq from certificates where code like 'CCTH-' || v_y || '-%';
      v_code := 'CCTH-' || v_y || '-' || lpad(v_seq::text, 5, '0');
    end if;
    select valid_months into v_months from certificate_templates where id = c.template_id;
    update certificates set status = 'issued', code = v_code, issued_on = current_date, issued_by = auth.uid(),
           expires_on = case when v_months is not null then current_date + make_interval(months => v_months) end,
           revoked_at = null, revoked_reason = null
     where id = c.id;
    insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
    select t.org_id, t.profile_id, 'training_cert', 'Bạn được cấp chứng chỉ tập huấn', v_code || ' · ' || (select name from training_plans where id = c.plan_id),
           'Chứng chỉ tập huấn', 'teacher', c.id
      from teachers t where t.id = c.teacher_id and t.profile_id is not null;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.training_cert_revoke(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c certificates;
begin
  select * into c from certificates where id = p_id;
  if c.id is null or not public.training_plan_can_manage(c.plan_id) then raise exception 'Bạn không thu hồi được chứng chỉ này' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Thu hồi thì ghi lý do' using errcode = '22023'; end if;
  if c.status <> 'issued' then raise exception 'Chỉ thu hồi chứng chỉ đã cấp' using errcode = '22023'; end if;
  update certificates set status = 'revoked', revoked_at = now(), revoked_reason = btrim(p_reason) where id = p_id;
end $$;

-- Danh sách chứng chỉ trong phạm vi (quản lý) hoặc của chính GV (p_mine)
create or replace function public.training_cert_list(p_mine boolean default false)
returns table (id uuid, code text, status text, issued_on date, expires_on date, revoked_reason text, verify_token text,
               plan_id uuid, plan_code text, plan_name text, teacher_id uuid, teacher_name text, org_name text,
               program_titles text, hours numeric, can_manage boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.status, c.issued_on, c.expires_on, c.revoked_reason, c.verify_token,
         c.plan_id, p.plan_code, p.name, c.teacher_id, t.full_name, o.name, c.program_titles, c.hours,
         public.training_plan_can_manage(c.plan_id), c.created_at
    from certificates c
    join teachers t on t.id = c.teacher_id
    left join training_plans p on p.id = c.plan_id
    left join organizations o on o.id = t.org_id
   where case when p_mine then c.teacher_id = public.my_teacher_id() and c.status = 'issued'
              else public.training_plan_can_manage(c.plan_id) or public.training_can_view_teacher(c.teacher_id) end
   order by c.created_at desc
$$;

-- Dữ liệu in chứng chỉ (kèm mẫu)
create or replace function public.training_cert_view(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c certificates;
begin
  select * into c from certificates where id = p_id;
  if c.id is null or not (public.training_plan_can_manage(c.plan_id) or public.training_can_view_teacher(c.teacher_id)) then
    raise exception 'Không tìm thấy chứng chỉ' using errcode = '42501';
  end if;
  return public.training_cert_payload(c);
end $$;

create or replace function public.training_cert_payload(c certificates) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status, 'issued_on', c.issued_on, 'expires_on', c.expires_on,
    'revoked_reason', c.revoked_reason, 'token', c.verify_token, 'hours', c.hours, 'programs', c.program_titles,
    'teacher', t.full_name, 'school', o.name, 'plan', p.name, 'plan_code', p.plan_code, 'plan_org', po.name,
    'template', (select to_jsonb(x) - 'org_id' - 'created_at' - 'updated_at' from certificate_templates x where x.id = c.template_id))
  from teachers t
  left join organizations o on o.id = t.org_id
  left join training_plans p on p.id = c.plan_id
  left join organizations po on po.id = p.org_id
  where t.id = c.teacher_id
$$;

-- Tra cứu công khai bằng mã trên QR (không cần đăng nhập)
create or replace function public.training_cert_verify(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c certificates;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into c from certificates where verify_token = p_token and status <> 'pending';
  if c.id is null then return null; end if;
  return public.training_cert_payload(c) - 'id' - 'token';
end $$;

-- ===== 6. Học: tính thêm lượt thi lại; khoá học trả về kết quả và chứng chỉ =====
create or replace function public.training_test_start(p_plan uuid, p_unit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); u training_program_units; a training_test_attempts;
        v_n int; v_max int; v_min int; v_q uuid[];
begin
  select * into u from training_program_units where id = p_unit;
  if u.id is null or not exists (select 1 from public.training_plan_units(p_plan) x where x.unit_id = p_unit) then
    raise exception 'Nội dung không thuộc kế hoạch tập huấn này' using errcode = '22023';
  end if;
  if not public.training_unit_test_on(p_unit) then raise exception 'Nội dung này không có bài kiểm tra' using errcode = '22023'; end if;
  if not public.training_unit_unlocked(p_plan, p_unit, v_teacher) then
    raise exception 'Hoàn thành nội dung trước rồi mới làm bài kiểm tra này' using errcode = '22023';
  end if;
  if not (public.training_unit_keys(u.detail) <@ coalesce((select seen from training_progress where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher), '{}')) then
    raise exception 'Mở hết bài giảng và tài liệu trước khi làm bài kiểm tra' using errcode = '22023';
  end if;
  select * into a from training_test_attempts where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher
     and submitted_at is null and (deadline is null or deadline > now()) order by started_at desc limit 1;
  if a.id is null then
    v_max := coalesce((u.detail #>> '{test,attempts}')::int, 0);
    if v_max > 0 then v_max := v_max + coalesce((select extra_attempts from training_results where plan_id = p_plan and teacher_id = v_teacher), 0); end if;
    if v_max > 0 and (select count(*) from training_test_attempts where plan_id = p_plan and unit_id = p_unit and teacher_id = v_teacher
                        and submitted_at is not null) >= v_max then
      raise exception 'Bạn đã hết số lượt làm bài kiểm tra này' using errcode = '22023';
    end if;
    v_n := coalesce((u.detail #>> '{test,count}')::int, 200);
    v_min := (u.detail #>> '{test,minutes}')::int;
    select array_agg(q.id) into v_q from (
      select q.id from question_bank q join jsonb_array_elements_text(u.detail #> '{test,qids}') x on x::uuid = q.id
       where q.status <> 'retired' order by random() limit v_n) q;
    if v_q is null then raise exception 'Bài kiểm tra chưa có câu hỏi dùng được' using errcode = '22023'; end if;
    insert into training_test_attempts (plan_id, unit_id, teacher_id, questions, deadline)
    values (p_plan, p_unit, v_teacher, v_q, case when v_min is not null then now() + make_interval(mins => v_min) end)
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'deadline', a.deadline, 'questions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind) order by o.n), '[]'::jsonb)
       from unnest(a.questions) with ordinality o(qid, n) join question_bank q on q.id = o.qid));
end $$;


create or replace function public.training_course(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); p training_plans; v jsonb;
begin
  select * into p from training_plans where id = p_plan;
  select jsonb_build_object(
    'plan', jsonb_build_object('id', p.id, 'code', p.plan_code, 'name', p.name, 'starts_on', p.starts_on, 'ends_on', p.ends_on,
              'org_name', (select name from organizations where id = p.org_id)),
    'programs', (select coalesce(jsonb_agg(jsonb_build_object('title', g.title, 'code', g.code, 'pass_attendance', g.pass_attendance,
              'pass_score', g.pass_score, 'need_product', g.need_product) order by i.seq), '[]'::jsonb)
              from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p_plan),
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', x.unit_id, 'ord', x.ord, 'subject', x.subject, 'title', x.title, 'hours', x.hours, 'mode', x.mode,
              'detail', x.detail - 'test',
              'test', case when public.training_unit_test_on(x.unit_id) then jsonb_build_object(
                  'count', least(coalesce((x.detail #>> '{test,count}')::int, jsonb_array_length(x.detail #> '{test,qids}')), jsonb_array_length(x.detail #> '{test,qids}')),
                  'minutes', (x.detail #>> '{test,minutes}')::int, 'attempts', case when coalesce((x.detail #>> '{test,attempts}')::int, 0) > 0 then (x.detail #>> '{test,attempts}')::int
                    + coalesce((select r.extra_attempts from training_results r where r.plan_id = p_plan and r.teacher_id = v_teacher), 0) else 0 end,
                  'pass', public.training_unit_pass(x.unit_id),
                  'used', (select count(*) from training_test_attempts a where a.plan_id = p_plan and a.unit_id = x.unit_id and a.teacher_id = v_teacher and a.submitted_at is not null),
                  'open', (select a.id from training_test_attempts a where a.plan_id = p_plan and a.unit_id = x.unit_id and a.teacher_id = v_teacher
                              and a.submitted_at is null and (a.deadline is null or a.deadline > now()) order by a.started_at desc limit 1)) end,
              'seen', coalesce(pr.seen, '{}'), 'best_score', pr.best_score,
              'done', public.training_unit_done(p_plan, x.unit_id, v_teacher),
              'unlocked', public.training_unit_unlocked(p_plan, x.unit_id, v_teacher),
              'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                  'mode', s.mode, 'location', s.location, 'meeting_url', s.meeting_url, 'recording_url', s.recording_url,
                  'closed', s.closed_at is not null, 'present', a.present) order by s.starts_at), '[]'::jsonb)
                  from training_sessions s left join training_attendance a on a.session_id = s.id and a.teacher_id = v_teacher
                 where s.plan_id = p_plan and s.unit_id = x.unit_id)
            ) order by x.ord), '[]'::jsonb)
            from public.training_plan_units(p_plan) x
            left join training_progress pr on pr.plan_id = p_plan and pr.unit_id = x.unit_id and pr.teacher_id = v_teacher),
    'attendance', (select jsonb_build_object('present', count(*) filter (where a.present), 'total', count(*))
                     from training_attendance a join training_sessions s on s.id = a.session_id
                    where s.plan_id = p_plan and a.teacher_id = v_teacher),
    'result', (select jsonb_build_object('result', r.result, 'reason', r.reason, 'product_score', r.product_score, 'comment', r.comment)
                 from training_results r where r.plan_id = p_plan and r.teacher_id = v_teacher),
    'cert', (select jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status) from certificates c
              where c.plan_id = p_plan and c.teacher_id = v_teacher and c.status <> 'revoked' order by c.created_at desc limit 1),
    'product', (select to_jsonb(d) - 'reviewed_by' from training_products d where d.plan_id = p_plan and d.teacher_id = v_teacher)
  ) into v;
  return v;
end $$;


do $$ declare f text; begin
  foreach f in array array['training_can_view_teacher(uuid)', 'training_result_metrics(uuid, uuid)', 'training_plan_results(uuid)',
    'training_result_check(uuid, uuid)', 'training_cert_sync(uuid, uuid, text)', 'training_result_set(uuid, uuid, text, text)',
    'training_result_grade(uuid, uuid, numeric, text)', 'training_result_retake(uuid, uuid, integer)', 'training_results_confirm(uuid)',
    'training_cert_issue(uuid[])', 'training_cert_revoke(uuid, text)', 'training_cert_list(boolean)', 'training_cert_view(uuid)',
    'training_cert_payload(certificates)', 'training_cert_verify(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  foreach f in array array['training_plan_results(uuid)', 'training_result_set(uuid, uuid, text, text)', 'training_result_grade(uuid, uuid, numeric, text)',
    'training_result_retake(uuid, uuid, integer)', 'training_results_confirm(uuid)', 'training_cert_issue(uuid[])', 'training_cert_revoke(uuid, text)',
    'training_cert_list(boolean)', 'training_cert_view(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.training_cert_verify(text) to anon, authenticated;

notify pgrst, 'reload schema';
