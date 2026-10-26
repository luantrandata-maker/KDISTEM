-- 098. Tập huấn đợt B (kế hoạch phần 1 của anh Luân, 26/10):
--  • Danh sách giảng viên (trainers) của đơn vị lập kế hoạch: họ tên, học hàm / học vị, đơn vị công tác, chuyên môn, liên hệ.
--    Chương trình trong kế hoạch và buổi tập huấn chọn NHIỀU giảng viên từ danh sách (trainer_ids). Cột trainer (chữ) cũ
--    giữ làm tên hiển thị, tự ghép từ danh sách đã chọn. Tên giảng viên đã nhập trước đây được đưa vào danh sách.
--  • Giáo viên tự đăng ký: kế hoạch bật "cho giáo viên tự đăng ký" kèm hạn đăng ký. GV của trường được gán chọn nội dung muốn học,
--    hệ thống kiểm tra: còn hạn, trường chưa gửi danh sách, chương trình tiên quyết đã đạt, còn chỉ tiêu của trường;
--    nội dung đã đạt ở kế hoạch trước được đề xuất miễn; trùng lịch (buổi tập huấn khác, tiết dạy) là cảnh báo cho trường cân nhắc.
--    Trường nhận hoặc từ chối (kèm lý do) → GV có tên trong danh sách → trường gửi duyệt như cũ → đơn vị lập kế hoạch duyệt.
--    GV nhận thông báo khi trường nhận / từ chối và khi danh sách được duyệt.
--  • Ghi danh lưu nội dung GV học (units, null = toàn bộ) và nội dung được miễn (exempt_units). Điểm danh, khoá học, tiến độ,
--    điều kiện hoàn thành, giám sát chỉ tính nội dung của GV đó (training_teacher_units).
-- Cần chạy sau 097.

-- ===== 1. Danh sách giảng viên =====
create table if not exists trainers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.my_org_id() references organizations(id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 120),
  title text check (title is null or length(title) <= 40),
  workplace text check (workplace is null or length(workplace) <= 200),
  expertise text check (expertise is null or length(expertise) <= 300),
  email text check (email is null or length(email) <= 200),
  phone text check (phone is null or length(phone) <= 30),
  note text check (note is null or length(note) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists trainers_name on trainers (org_id, lower(full_name), lower(coalesce(workplace, '')));

alter table training_plan_items add column if not exists trainer_ids uuid[] not null default '{}';
alter table training_sessions add column if not exists trainer_ids uuid[] not null default '{}';
alter table training_plan_items drop constraint if exists training_plan_items_trainers_check;
alter table training_plan_items add constraint training_plan_items_trainers_check check (cardinality(trainer_ids) <= 20);
alter table training_sessions drop constraint if exists training_sessions_trainers_check;
alter table training_sessions add constraint training_sessions_trainers_check check (cardinality(trainer_ids) <= 20);

create or replace function public.trainers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from training_plan_items where old.id = any(trainer_ids))
       or exists (select 1 from training_sessions where old.id = any(trainer_ids)) then
      raise exception 'Giảng viên đã được phân công: chuyển sang "Ngừng mời" thay vì xoá' using errcode = '22023';
    end if;
    return old;
  end if;
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.title := nullif(btrim(new.title), ''); new.workplace := nullif(btrim(new.workplace), '');
  new.expertise := nullif(btrim(new.expertise), ''); new.email := nullif(btrim(new.email), '');
  new.phone := nullif(btrim(new.phone), ''); new.note := nullif(btrim(new.note), '');
  new.updated_at := now();
  if new.full_name = '' then raise exception 'Nhập họ tên giảng viên' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then raise exception 'Không đổi đơn vị của giảng viên' using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists trainers_guard on trainers;
create trigger trainers_guard before insert or update or delete on trainers for each row execute function public.trainers_guard();

-- Đổi tên giảng viên → cập nhật tên hiển thị ở kế hoạch và buổi tập huấn
create or replace function public.trainer_names(p_ids uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select left(string_agg(coalesce(t.title || ' ', '') || t.full_name, ', ' order by x.k), 200)
    from unnest(p_ids) with ordinality x(id, k) join trainers t on t.id = x.id
$$;
revoke all on function public.trainer_names(uuid[]) from public, anon;
grant execute on function public.trainer_names(uuid[]) to authenticated;

create or replace function public.trainers_rename() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.full_name, new.title) is distinct from (old.full_name, old.title) then
    perform set_config('app.training_trainer_sync', 'on', true);
    update training_plan_items set trainer = public.trainer_names(trainer_ids) where new.id = any(trainer_ids);
    update training_sessions set trainer = public.trainer_names(trainer_ids) where new.id = any(trainer_ids);
    perform set_config('app.training_trainer_sync', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists trainers_rename on trainers;
create trigger trainers_rename after update on trainers for each row execute function public.trainers_rename();

alter table trainers enable row level security;
drop policy if exists trainers_read on trainers;
create policy trainers_read on trainers for select to authenticated
  using (public.training_can_write(org_id) or (public.is_staff() and (org_id in (select public.my_org_tree()) or org_id in (select public.my_ancestor_orgs()))));
drop policy if exists trainers_write on trainers;
create policy trainers_write on trainers for all to authenticated
  using (public.training_can_write(org_id)) with check (public.training_can_write(org_id));
grant select, insert, update, delete on trainers to authenticated;

-- Giảng viên chọn phải thuộc danh sách của đơn vị lập kế hoạch
create or replace function public.training_trainers_check(p_ids uuid[], p_org uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  v := array(select x.id from unnest(coalesce(p_ids, '{}')) with ordinality x(id, k) where x.id is not null
              group by x.id order by min(x.k));
  if exists (select 1 from unnest(v) x where not exists (select 1 from trainers t where t.id = x and t.org_id = p_org)) then
    raise exception 'Giảng viên không có trong danh sách giảng viên của đơn vị' using errcode = '22023';
  end if;
  return v;
end $$;
revoke all on function public.training_trainers_check(uuid[], uuid) from public, anon, authenticated;

create or replace function public.training_plan_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_st text; v_org uuid;
begin
  select pub_status, org_id into v_st, v_org from training_plans where id = r.plan_id;
  if v_st is null then return coalesce(new, old); end if;      -- xoá theo dây chuyền
  if current_setting('app.training_trainer_sync', true) = 'on' then return new; end if;   -- đổi tên giảng viên
  if v_st <> 'draft' then raise exception 'Kế hoạch đã phát hành: chuyển về nháp để sửa' using errcode = '22023'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if (tg_op = 'INSERT' or new.program_id <> old.program_id)
     and not exists (select 1 from training_programs t where t.id = new.program_id and t.status = 'published') then
    raise exception 'Chỉ chọn chương trình tập huấn đã phát hành' using errcode = '22023';
  end if;
  new.note := nullif(btrim(new.note), '');
  -- Giảng viên: chọn từ danh sách thì tên hiển thị tự ghép; chưa chọn ai thì giữ tên nhập tay cũ (nếu có)
  new.trainer_ids := public.training_trainers_check(new.trainer_ids, v_org);
  new.trainer := case when cardinality(new.trainer_ids) > 0 then public.trainer_names(new.trainer_ids) else nullif(btrim(new.trainer), '') end;
  -- Nội dung chọn: null = toàn bộ chương trình. Bỏ trùng, giữ thứ tự chương trình; chọn đủ mọi nội dung thì lưu null.
  if new.units is not null then
    if exists (select 1 from unnest(new.units) x where not exists (select 1 from training_program_units u
                 where u.id = x and u.program_id = new.program_id and u.kind = 'content')) then
      raise exception 'Nội dung chọn không thuộc chương trình tập huấn' using errcode = '22023';
    end if;
    new.units := array(select u.id from training_program_units u join training_program_units sj on sj.id = u.parent_id
                        where u.id = any(new.units) order by sj.seq, u.seq);
    if cardinality(new.units) = 0 then raise exception 'Chọn ít nhất một nội dung tập huấn' using errcode = '22023'; end if;
    if not exists (select 1 from training_program_units u where u.program_id = new.program_id and u.kind = 'content' and not (u.id = any(new.units))) then
      new.units := null;
    end if;
  end if;
  return new;
end $$;

create or replace function public.training_sessions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pub text; v_org uuid;
begin
  if current_setting('app.training_trainer_sync', true) = 'on' then return new; end if;
  new.title := btrim(new.title); new.note := nullif(btrim(new.note), '');
  new.location := nullif(btrim(new.location), ''); new.meeting_url := nullif(btrim(new.meeting_url), '');
  if new.ends_at <= new.starts_at then raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '22023'; end if;
  select pub_status, org_id into v_pub, v_org from training_plans where id = new.plan_id;
  if (tg_op = 'INSERT' or new.plan_id <> old.plan_id) and v_pub = 'draft' then
    raise exception 'Kế hoạch còn nháp: phát hành trước khi xếp lịch' using errcode = '22023';
  end if;
  if new.unit_id is not null and (tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id or new.plan_id <> old.plan_id)
     and not exists (select 1 from training_program_units u join training_plan_items i on i.program_id = u.program_id
                      where u.id = new.unit_id and u.kind = 'content' and i.plan_id = new.plan_id and (i.units is null or u.id = any(i.units))) then
    raise exception 'Nội dung tập huấn không thuộc chương trình của kế hoạch (hoặc không được chọn trong kế hoạch)' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.trainer_ids is distinct from old.trainer_ids or new.trainer is distinct from old.trainer then
    new.trainer_ids := public.training_trainers_check(new.trainer_ids, coalesce(v_org, new.org_id));
    new.trainer := case when cardinality(new.trainer_ids) > 0 then public.trainer_names(new.trainer_ids) else nullif(btrim(new.trainer), '') end;
  end if;
  return new;
end $$;

-- Xếp lịch tự động: buổi nhận giảng viên của chương trình
do $$ declare d text;
begin
  d := pg_get_functiondef('public.training_plan_schedule(uuid,date,time,numeric,boolean)'::regprocedure);
  if position('trainer_ids' in d) = 0 then
    d := replace(d, 'u.mode, i.trainer', 'u.mode, i.trainer, i.trainer_ids');
    d := replace(d, 'mode, trainer)', 'mode, trainer, trainer_ids)');
    d := replace(d, 'v_mode, r.trainer)', 'v_mode, r.trainer, r.trainer_ids)');
    if position('r.trainer_ids' in d) = 0 or position('i.trainer_ids' in d) = 0 then raise exception '098: không sửa được training_plan_schedule'; end if;
    execute d;
  end if;
end $$;

-- Tên giảng viên nhập trước đây → danh sách giảng viên của đơn vị (tách theo dấu phẩy, chấm phẩy)
insert into trainers (org_id, full_name)
select distinct x.org_id, x.n from (
  select p.org_id, btrim(regexp_replace(n, '\s+', ' ', 'g')) n
    from training_plan_items i join training_plans p on p.id = i.plan_id, regexp_split_to_table(i.trainer, '[,;]') n
   where i.trainer is not null and cardinality(i.trainer_ids) = 0
  union
  select coalesce(p.org_id, s.org_id), btrim(regexp_replace(n, '\s+', ' ', 'g'))
    from training_sessions s left join training_plans p on p.id = s.plan_id, regexp_split_to_table(s.trainer, '[,;]') n
   where s.trainer is not null and cardinality(s.trainer_ids) = 0) x
where x.n <> '' and length(x.n) <= 120
on conflict do nothing;

alter table training_plan_items disable trigger training_plan_items_guard;
update training_plan_items i set trainer_ids = array(
    select t.id from regexp_split_to_table(i.trainer, '[,;]') with ordinality n(v, k)
      join trainers t on t.org_id = p.org_id and t.workplace is null and lower(t.full_name) = lower(btrim(regexp_replace(n.v, '\s+', ' ', 'g')))
     order by n.k)
  from training_plans p where p.id = i.plan_id and i.trainer is not null and cardinality(i.trainer_ids) = 0;
alter table training_plan_items enable trigger training_plan_items_guard;
alter table training_sessions disable trigger training_sessions_guard;
update training_sessions s set trainer_ids = array(
    select t.id from regexp_split_to_table(s.trainer, '[,;]') with ordinality n(v, k)
      join trainers t on t.org_id = coalesce((select p.org_id from training_plans p where p.id = s.plan_id), s.org_id)
       and t.workplace is null and lower(t.full_name) = lower(btrim(regexp_replace(n.v, '\s+', ' ', 'g')))
     order by n.k)
 where s.trainer is not null and cardinality(s.trainer_ids) = 0;
alter table training_sessions enable trigger training_sessions_guard;

-- ===== 2. Giáo viên tự đăng ký =====
alter table training_plans add column if not exists self_register boolean not null default false;
alter table training_plans add column if not exists register_until date;

alter table training_enrollments add column if not exists units uuid[];
alter table training_enrollments add column if not exists exempt_units uuid[] not null default '{}';
alter table training_enrollments add column if not exists source text not null default 'school';
alter table training_enrollments drop constraint if exists training_enrollments_v6_check;
alter table training_enrollments add constraint training_enrollments_v6_check check (
  source in ('school', 'self') and (units is null or cardinality(units) between 1 and 500) and cardinality(exempt_units) <= 500);

create table if not exists training_registrations (
  plan_id uuid not null references training_plans(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  units uuid[] check (units is null or cardinality(units) between 1 and 500),
  exempt_units uuid[] not null default '{}' check (cardinality(exempt_units) <= 500),
  note text check (note is null or length(note) <= 500),
  warnings text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null,
  primary key (plan_id, teacher_id)
);
create index if not exists training_registrations_org on training_registrations (org_id, status);

alter table training_registrations enable row level security;
drop policy if exists training_registrations_read on training_registrations;
create policy training_registrations_read on training_registrations for select to authenticated
  using (teacher_id = public.my_teacher_id() or public.training_plan_can_manage(plan_id) or (public.is_staff() and public.can_access_org(org_id)));
revoke insert, update, delete on training_registrations from authenticated;
grant select on training_registrations to authenticated;

-- Nội dung có tính cho GV không: unit null (buổi chung) luôn tính
create or replace function public.training_unit_in(p_units uuid[], p_exempt uuid[], p_unit uuid) returns boolean
language sql immutable as $$
  select p_unit is null or ((p_units is null or p_unit = any(p_units)) and not (p_unit = any(coalesce(p_exempt, '{}'))))
$$;
grant execute on function public.training_unit_in(uuid[], uuid[], uuid) to authenticated;

-- Nội dung GV học trong kế hoạch: nội dung của kế hoạch, lọc theo nội dung GV chọn, bỏ nội dung được miễn
create or replace function public.training_teacher_units(p_plan uuid, p_teacher uuid)
returns table (unit_id uuid, ord int, subject text, title text, hours numeric, mode text, has_test boolean, detail jsonb, program_id uuid)
language sql stable security definer set search_path = public as $$
  select x.unit_id, (row_number() over (order by x.ord))::int, x.subject, x.title, x.hours, x.mode, x.has_test, x.detail, x.program_id
    from public.training_plan_units(p_plan) x
    left join training_enrollments e on e.plan_id = p_plan and e.teacher_id = p_teacher
   where public.training_unit_in(e.units, e.exempt_units, x.unit_id)
   order by x.ord
$$;

-- Nội dung của kế hoạch mà GV đã đạt ở kế hoạch khác: cùng nội dung, hoặc cùng tên nội dung ở phiên bản khác của chương trình
create or replace function public.training_passed_units(p_plan uuid, p_teacher uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with done as (
    select pr.unit_id from training_progress pr
     where pr.teacher_id = p_teacher and pr.plan_id <> p_plan and pr.completed_at is not null
    union
    select x.unit_id from training_results r cross join lateral public.training_teacher_units(r.plan_id, r.teacher_id) x
     where r.teacher_id = p_teacher and r.plan_id <> p_plan and r.result = 'pass'
  ), d as (
    select u.id, lower(btrim(u.title)) t, g.family_id from done join training_program_units u on u.id = done.unit_id
      join training_programs g on g.id = u.program_id
  )
  select x.unit_id from public.training_plan_units(p_plan) x join training_programs g on g.id = x.program_id
   where exists (select 1 from d where d.id = x.unit_id or (d.family_id = g.family_id and d.t = lower(btrim(x.title))))
$$;

-- Chương trình tiên quyết GV chưa đạt (đạt một phiên bản bất kỳ của chương trình đó là được)
create or replace function public.training_prereq_missing(p_plan uuid, p_teacher uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct (select t.title from training_programs t where t.family_id = f order by t.version_no desc nulls last limit 1)
    from training_plan_items i join training_programs g on g.id = i.program_id cross join unnest(g.prereq_families) f
   where i.plan_id = p_plan
     and not exists (select 1 from training_results r join training_plan_items i2 on i2.plan_id = r.plan_id
                       join training_programs g2 on g2.id = i2.program_id
                      where r.teacher_id = p_teacher and r.result = 'pass' and g2.family_id = f)
$$;

-- Trùng lịch của GV với các buổi (đã xếp) của nội dung định học: buổi tập huấn khác, tiết dạy trên thời khoá biểu
create or replace function public.training_register_conflicts(p_plan uuid, p_teacher uuid, p_units uuid[], p_exempt uuid[]) returns setof text
language sql stable security definer set search_path = public as $$
  with mine as (
    select s.id, s.title, s.starts_at, s.ends_at,
           to_char(s.starts_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') at_
      from training_sessions s
     where s.plan_id = p_plan and s.ends_at > now() and public.training_unit_in(p_units, p_exempt, s.unit_id))
  select * from (
    select distinct 'Buổi "' || m.title || '" (' || m.at_ || ') trùng buổi tập huấn "' || s2.title || '"'
      from mine m
      join training_attendance a2 on a2.teacher_id = p_teacher and coalesce(a2.excuse_status, '') <> 'approved'
      join training_sessions s2 on s2.id = a2.session_id and s2.plan_id is distinct from p_plan
       and s2.starts_at < m.ends_at and s2.ends_at > m.starts_at
    union
    select distinct 'Buổi "' || m.title || '" (' || m.at_ || ') trùng tiết dạy ' || te.subject || coalesce(' lớp ' || c.name, '')
      from mine m
      join timetable_entries te on te.teacher_id = p_teacher
       and te.weekday = extract(isodow from m.starts_at at time zone 'Asia/Ho_Chi_Minh')::int + 1
       and (te.year_id is null or te.year_id in (select y.id from academic_years y where y.is_current))
      join period_configs pc on pc.id = te.period_id
       and (m.starts_at at time zone 'Asia/Ho_Chi_Minh')::time < pc.ends_at
       and (m.ends_at at time zone 'Asia/Ho_Chi_Minh')::time > pc.starts_at
      left join classes c on c.id = te.class_id) z
  limit 20
$$;

-- Kiểm tra đăng ký của GV: trả về { errors, warnings, units (đã chuẩn hoá), exempt }
create or replace function public.training_register_check(p_plan uuid, p_units uuid[] default null, p_exempt uuid[] default '{}', p_teacher uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_t uuid := coalesce(p_teacher, public.my_teacher_id()); t teachers; p training_plans; o training_plan_orgs;
        e text[] := '{}'; w text[] := '{}'; v_units uuid[]; v_ex uuid[]; v_all uuid[]; v_used int; v_miss text;
begin
  if v_t is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  if p_teacher is not null and p_teacher is distinct from public.my_teacher_id()
     and not public.training_plan_can_manage(p_plan) and not public.training_teacher_in_my_tree(p_teacher) then
    raise exception 'Bạn không xem được đăng ký của giáo viên này' using errcode = '42501';
  end if;
  select * into t from teachers where id = v_t;
  select * into p from training_plans where id = p_plan;
  if p.id is null or p.pub_status <> 'published' or not p.self_register then
    return jsonb_build_object('errors', jsonb_build_array('Kế hoạch không mở cho giáo viên tự đăng ký'), 'warnings', '[]'::jsonb);
  end if;
  if p.register_until is not null and p.register_until < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    e := e || ('Đã hết hạn đăng ký (' || to_char(p.register_until, 'DD/MM/YYYY') || ')');
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = t.org_id;
  if o.plan_id is null then e := e || 'Kế hoạch chưa giao cho trường của bạn'::text;
  elsif o.status in ('submitted', 'approved') then e := e || 'Trường đã gửi danh sách giáo viên, không nhận thêm đăng ký'::text;
  end if;
  if exists (select 1 from training_enrollments where plan_id = p_plan and teacher_id = v_t) then
    e := e || 'Bạn đã có tên trong kế hoạch này'::text;
  end if;
  -- Nội dung
  v_all := array(select x.unit_id from public.training_plan_units(p_plan) x order by x.ord);
  if p_units is not null and exists (select 1 from unnest(p_units) x where not (x = any(v_all))) then
    e := e || 'Nội dung chọn không thuộc kế hoạch'::text;
  end if;
  v_units := case when p_units is null then null else array(select x from unnest(v_all) with ordinality a(x, k) where x = any(p_units) order by k) end;
  v_ex := array(select x from unnest(v_all) with ordinality a(x, k) where x = any(coalesce(p_exempt, '{}'))
                  and public.training_unit_in(v_units, null, x) order by k);
  if exists (select 1 from unnest(v_ex) x where x not in (select public.training_passed_units(p_plan, v_t))) then
    e := e || 'Chỉ đề nghị miễn nội dung đã đạt ở kế hoạch trước'::text;
  end if;
  if not exists (select 1 from unnest(v_all) x where public.training_unit_in(v_units, v_ex, x)) then
    e := e || 'Chọn ít nhất một nội dung để học'::text;
  end if;
  if v_units is not null and cardinality(v_units) = cardinality(v_all) then v_units := null; end if;
  -- Tiên quyết
  select string_agg('"' || m || '"', ', ') into v_miss from public.training_prereq_missing(p_plan, v_t) m;
  if v_miss is not null then e := e || ('Chưa đạt chương trình tiên quyết: ' || v_miss); end if;
  -- Chỉ tiêu của trường: GV đã có tên + đăng ký đang chờ (trừ chính mình)
  if o.quota is not null then
    select (select count(*) from training_enrollments en join teachers x on x.id = en.teacher_id where en.plan_id = p_plan and x.org_id = t.org_id)
         + (select count(*) from training_registrations r where r.plan_id = p_plan and r.org_id = t.org_id and r.status = 'pending' and r.teacher_id <> v_t)
      into v_used;
    if v_used >= o.quota then e := e || ('Trường đã đủ chỉ tiêu ' || o.quota || ' giáo viên'); end if;
  end if;
  -- Cảnh báo trùng lịch
  w := array(select public.training_register_conflicts(p_plan, v_t, v_units, v_ex));
  return jsonb_build_object('errors', to_jsonb(e), 'warnings', to_jsonb(w), 'units', to_jsonb(v_units), 'exempt', to_jsonb(v_ex));
end $$;

-- Kế hoạch GV đăng ký được (trường được gán, đang mở đăng ký) và kế hoạch GV đã đăng ký / có tên
create or replace function public.training_open_plans()
returns table (plan_id uuid, plan_code text, name text, org_name text, year_name text, starts_on date, ends_on date, mode text, provider text,
               register_until date, programs text, hours numeric, quota int, taken int, list_status text,
               reg_status text, reg_reason text, reg_units uuid[], reg_exempt uuid[], reg_warnings text[], reg_at timestamptz, enrolled boolean)
language sql stable security definer set search_path = public as $$
  with me as (select t.id, t.org_id from teachers t where t.id = public.my_teacher_id())
  select p.id, p.plan_code, p.name, og.name, p.year_name, p.starts_on, p.ends_on, p.mode, p.provider, p.register_until,
         (select string_agg(g.title, ' · ' order by i.seq) from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p.id),
         (select sum(x.hours) from public.training_plan_units(p.id) x),
         o.quota,
         ((select count(*) from training_enrollments en join teachers x on x.id = en.teacher_id where en.plan_id = p.id and x.org_id = me.org_id)
          + (select count(*) from training_registrations r where r.plan_id = p.id and r.org_id = me.org_id and r.status = 'pending'))::int,
         o.status, r.status, r.reason, r.units, r.exempt_units, r.warnings, r.created_at,
         exists (select 1 from training_enrollments en where en.plan_id = p.id and en.teacher_id = me.id)
    from me
    join training_plan_orgs o on o.org_id = me.org_id
    join training_plans p on p.id = o.plan_id and p.pub_status = 'published'
    left join organizations og on og.id = p.org_id
    left join training_registrations r on r.plan_id = p.id and r.teacher_id = me.id
   where p.self_register or r.plan_id is not null
   order by (p.register_until is null or p.register_until >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) desc, p.starts_on nulls last, p.name
$$;

-- Nội dung của kế hoạch để GV chọn: thêm cờ đã đạt (đề xuất miễn) và giảng viên
create or replace function public.training_register_units(p_plan uuid)
returns table (unit_id uuid, ord int, program_title text, subject text, title text, hours numeric, mode text, passed boolean, trainer text)
language sql stable security definer set search_path = public as $$
  select x.unit_id, x.ord, g.title, x.subject, x.title, x.hours, x.mode,
         x.unit_id in (select public.training_passed_units(p_plan, public.my_teacher_id())), i.trainer
    from public.training_plan_units(p_plan) x
    join training_programs g on g.id = x.program_id
    join training_plan_items i on i.plan_id = p_plan and i.program_id = x.program_id
   where public.training_plan_can_manage(p_plan) or public.training_plan_assigned_to_me(p_plan)
      or exists (select 1 from training_plan_orgs o join teachers t on t.org_id = o.org_id
                  where o.plan_id = p_plan and t.id = public.my_teacher_id())
   order by x.ord
$$;

-- GV gửi (hoặc sửa) đăng ký
create or replace function public.training_register(p_plan uuid, p_units uuid[] default null, p_exempt uuid[] default '{}', p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_t uuid := public.my_teacher_id(); t teachers; c jsonb; p training_plans; r training_registrations;
begin
  if v_t is null then raise exception 'Tài khoản chưa liên kết hồ sơ giáo viên' using errcode = '42501'; end if;
  select * into t from teachers where id = v_t;
  select * into r from training_registrations where plan_id = p_plan and teacher_id = v_t for update;
  if r.status = 'accepted' then raise exception 'Trường đã nhận đăng ký của bạn' using errcode = '22023'; end if;
  c := public.training_register_check(p_plan, p_units, p_exempt);
  if jsonb_array_length(c -> 'errors') > 0 then
    raise exception '%', (select string_agg(x, '; ') from jsonb_array_elements_text(c -> 'errors') x) using errcode = '22023';
  end if;
  insert into training_registrations (plan_id, teacher_id, org_id, units, exempt_units, note, warnings, status, reason, created_at, decided_at, decided_by)
  values (p_plan, v_t, t.org_id,
          case when jsonb_typeof(c -> 'units') = 'array' then array(select jsonb_array_elements_text(c -> 'units')::uuid) end,
          array(select jsonb_array_elements_text(c -> 'exempt')::uuid),
          left(nullif(btrim(p_note), ''), 500), array(select jsonb_array_elements_text(c -> 'warnings')), 'pending', null, now(), null, null)
  on conflict (plan_id, teacher_id) do update set units = excluded.units, exempt_units = excluded.exempt_units, note = excluded.note,
    warnings = excluded.warnings, status = 'pending', reason = null, created_at = now(), decided_at = null, decided_by = null;
  if r.plan_id is null or r.status <> 'pending' then
    select * into p from training_plans where id = p_plan;
    perform public.notify_staff(t.org_id, 'training', 'training_registration',
      left('Giáo viên đăng ký tập huấn: ' || coalesce(p.plan_code || ' · ', '') || p.name, 200),
      left(t.full_name || ' đăng ký tham gia. Mở kế hoạch ở mục Kế hoạch tập huấn để nhận hoặc từ chối.', 1000),
      'Kế hoạch tập huấn', p_plan);
  end if;
end $$;

create or replace function public.training_register_cancel(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update training_registrations set status = 'cancelled', decided_at = now()
   where plan_id = p_plan and teacher_id = public.my_teacher_id() and status = 'pending';
  if not found then raise exception 'Không có đăng ký đang chờ để huỷ' using errcode = '22023'; end if;
end $$;

-- Trường (hoặc đơn vị lập kế hoạch) nhận / từ chối đăng ký. Nhận → GV có tên trong danh sách của trường.
create or replace function public.training_registration_review(p_plan uuid, p_teacher uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r training_registrations; o training_plan_orgs; v_n int;
begin
  select * into r from training_registrations where plan_id = p_plan and teacher_id = p_teacher for update;
  if r.plan_id is null then raise exception 'Không tìm thấy đăng ký' using errcode = '22023'; end if;
  if not (public.training_plan_can_manage(p_plan)
          or (r.org_id in (select public.my_org_tree()) and public.is_staff() and (public.has_perm('training', 'edit') or public.has_perm('training', 'create')))) then
    raise exception 'Bạn không xử lý được đăng ký này' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'Đăng ký đã được xử lý' using errcode = '22023'; end if;
  if not p_accept then
    if nullif(btrim(p_reason), '') is null then raise exception 'Nhập lý do từ chối' using errcode = '22023'; end if;
    update training_registrations set status = 'rejected', reason = left(btrim(p_reason), 500), decided_at = now(), decided_by = auth.uid()
     where plan_id = p_plan and teacher_id = p_teacher;
    return;
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = r.org_id;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if o.status in ('submitted', 'approved') and not public.training_plan_can_manage(p_plan) then
    raise exception 'Danh sách giáo viên đã gửi duyệt: chờ đơn vị lập kế hoạch trả lại để sửa' using errcode = '22023';
  end if;
  select count(*) into v_n from training_enrollments e join teachers t on t.id = e.teacher_id where e.plan_id = p_plan and t.org_id = r.org_id;
  if o.quota is not null and v_n >= o.quota then
    raise exception 'Trường đã đủ chỉ tiêu % giáo viên', o.quota using errcode = '22023';
  end if;
  -- Ghi danh (guard ghi danh chép nội dung từ đăng ký và chuyển đăng ký sang "đã nhận")
  insert into training_enrollments (org_id, plan_id, teacher_id) values (r.org_id, p_plan, p_teacher) on conflict do nothing;
  update training_registrations set status = 'accepted', reason = nullif(btrim(p_reason), ''), decided_at = now(), decided_by = auth.uid()
   where plan_id = p_plan and teacher_id = p_teacher;
end $$;

-- Thông báo cho GV khi trường nhận / từ chối
create or replace function public.notify_training_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare t teachers; p training_plans;
begin
  if new.status = old.status or new.status not in ('accepted', 'rejected') then return null; end if;
  select * into t from teachers where id = new.teacher_id;
  select * into p from training_plans where id = new.plan_id;
  if t.profile_id is null then return null; end if;
  perform public.notify_user(t.profile_id, t.org_id, 'training_registration',
    left(case when new.status = 'accepted' then 'Trường đã nhận đăng ký tập huấn: ' else 'Đăng ký tập huấn không được nhận: ' end || p.name, 200),
    left(case when new.status = 'accepted' then 'Bạn đã có tên trong danh sách của trường. Danh sách sẽ được gửi lên đơn vị tổ chức duyệt.'
              else 'Lý do: ' || coalesce(new.reason, '—') end, 1000),
    'Đăng ký tập huấn', 'teacher', new.plan_id);
  return null;
end $$;
revoke all on function public.notify_training_registration() from public, anon, authenticated;
drop trigger if exists notify_training_registration on training_registrations;
create trigger notify_training_registration after update on training_registrations for each row execute function public.notify_training_registration();

-- Ghi danh: nội dung GV học (kiểm tra, chuẩn hoá); GV có đăng ký đang chờ thì lấy nội dung từ đăng ký
create or replace function public.training_enrollments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old); v_st text; v_all uuid[]; g training_registrations;
begin
  if tg_op = 'INSERT' then
    select * into g from training_registrations where plan_id = new.plan_id and teacher_id = new.teacher_id and status = 'pending';
    if g.plan_id is not null then
      new.units := coalesce(new.units, g.units); new.exempt_units := case when cardinality(new.exempt_units) > 0 then new.exempt_units else g.exempt_units end;
      new.source := 'self';
      update training_registrations set status = 'accepted', decided_at = now(), decided_by = auth.uid()
       where plan_id = new.plan_id and teacher_id = new.teacher_id;
    end if;
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.units is distinct from old.units or new.exempt_units is distinct from old.exempt_units) then
    v_all := array(select x.unit_id from public.training_plan_units(new.plan_id) x order by x.ord);
    if exists (select 1 from unnest(coalesce(new.units, '{}') || new.exempt_units) x where not (x = any(v_all))) then
      raise exception 'Nội dung không thuộc kế hoạch tập huấn' using errcode = '22023';
    end if;
    if new.units is not null then
      new.units := array(select x from unnest(v_all) with ordinality a(x, k) where x = any(new.units) order by k);
      if cardinality(new.units) = cardinality(v_all) then new.units := null; end if;
    end if;
    new.exempt_units := array(select x from unnest(v_all) with ordinality a(x, k) where x = any(new.exempt_units) order by k);
  end if;
  if tg_op = 'UPDATE' and new.teacher_id = old.teacher_id and new.plan_id = old.plan_id then return new; end if;
  select o.status into v_st from training_plan_orgs o join teachers t on t.org_id = o.org_id
   where o.plan_id = r.plan_id and t.id = r.teacher_id;
  if v_st is null then return coalesce(new, old); end if;      -- kế hoạch cũ / kế hoạch riêng của trường
  if v_st in ('submitted', 'approved') and not public.training_plan_can_manage(r.plan_id)
     and current_setting('app.training_unassign', true) is distinct from 'on' then
    raise exception 'Danh sách giáo viên đã gửi duyệt: chờ đơn vị lập kế hoạch trả lại để sửa' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;

-- Bỏ GV khỏi danh sách → đăng ký đã nhận chuyển thành không được nhận
create or replace function public.training_enrollments_unreg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update training_registrations set status = 'rejected', reason = 'Đã bị bỏ khỏi danh sách tham gia', decided_at = now(), decided_by = auth.uid()
   where plan_id = old.plan_id and teacher_id = old.teacher_id and status = 'accepted';
  return null;
end $$;
drop trigger if exists training_enrollments_unreg on training_enrollments;
create trigger training_enrollments_unreg after delete on training_enrollments for each row execute function public.training_enrollments_unreg();

-- Danh sách điểm danh chỉ gồm buổi của nội dung GV học
create or replace function public.training_sessions_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into training_session_codes (session_id, code) values (new.id, lpad((floor(random() * 1000000))::int::text, 6, '0'))
  on conflict do nothing;
  insert into training_attendance (org_id, session_id, teacher_id, present)
  select new.org_id, new.id, e.teacher_id, null from training_enrollments e
   where e.plan_id = new.plan_id and public.training_unit_in(e.units, e.exempt_units, new.unit_id)
  on conflict do nothing;
  return null;
end $$;

create or replace function public.training_enrollments_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from training_attendance a using training_sessions s
     where s.id = a.session_id and s.plan_id = old.plan_id and a.teacher_id = old.teacher_id
       and s.starts_at > now() and a.present is null and a.excuse_status is null
       and (tg_op = 'DELETE' or not public.training_unit_in(new.units, new.exempt_units, s.unit_id));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into training_attendance (org_id, session_id, teacher_id, present)
    select s.org_id, s.id, new.teacher_id, null from training_sessions s
     where s.plan_id = new.plan_id and s.ends_at > now() and s.closed_at is null
       and public.training_unit_in(new.units, new.exempt_units, s.unit_id)
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists training_enrollments_roster on training_enrollments;
create trigger training_enrollments_roster after insert or delete or update of units, exempt_units on training_enrollments
  for each row execute function public.training_enrollments_roster();

-- Gửi danh sách: còn đăng ký chờ xử lý thì chưa gửi được
create or replace function public.training_plan_submit(p_plan uuid, p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare o training_plan_orgs; v_org uuid := coalesce(p_org, public.my_org_id()); v_n int;
begin
  if not (v_org in (select public.my_org_tree()) and public.is_staff() and (public.has_perm('training', 'edit') or public.has_perm('training', 'create'))) then
    raise exception 'Bạn không gửi được danh sách của trường này' using errcode = '42501';
  end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = v_org for update;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if o.status not in ('assigned', 'returned') then raise exception 'Danh sách đã gửi rồi' using errcode = '22023'; end if;
  select count(*) into v_n from training_registrations where plan_id = p_plan and org_id = v_org and status = 'pending';
  if v_n > 0 then raise exception 'Còn % đăng ký của giáo viên chưa xử lý: nhận hoặc từ chối trước khi gửi', v_n using errcode = '22023'; end if;
  select count(*) into v_n from training_enrollments e join teachers t on t.id = e.teacher_id where e.plan_id = p_plan and t.org_id = v_org;
  if v_n = 0 then raise exception 'Chưa chọn giáo viên nào' using errcode = '22023'; end if;
  if o.quota is not null and v_n > o.quota then
    raise exception 'Đã chọn % giáo viên, vượt chỉ tiêu % của trường', v_n, o.quota using errcode = '22023';
  end if;
  update training_plan_orgs set status = 'submitted', submitted_at = now() where plan_id = p_plan and org_id = v_org;
end $$;

-- Duyệt danh sách → báo cho từng GV có tên
create or replace function public.training_plan_review(p_plan uuid, p_org uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o training_plan_orgs; p training_plans;
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không duyệt được kế hoạch này' using errcode = '42501'; end if;
  select * into o from training_plan_orgs where plan_id = p_plan and org_id = p_org for update;
  if o.plan_id is null then raise exception 'Kế hoạch chưa gán cho trường' using errcode = '22023'; end if;
  if p_approve and o.status <> 'submitted' then raise exception 'Trường chưa gửi danh sách' using errcode = '22023'; end if;
  if not p_approve and o.status not in ('submitted', 'approved') then raise exception 'Danh sách chưa gửi nên không trả lại được' using errcode = '22023'; end if;
  if not p_approve and nullif(btrim(p_note), '') is null then raise exception 'Nhập lý do trả lại' using errcode = '22023'; end if;
  update training_plan_orgs set status = case when p_approve then 'approved' else 'returned' end,
         note = left(nullif(btrim(p_note), ''), 1000), decided_at = now(), decided_by = auth.uid()
   where plan_id = p_plan and org_id = p_org;
  if p_approve then
    select * into p from training_plans where id = p_plan;
    perform public.notify_user(t.profile_id, t.org_id, 'training_approved', left('Được duyệt tham gia tập huấn: ' || p.name, 200),
      left('Danh sách của trường đã được duyệt' || coalesce(', bắt đầu ' || to_char(p.starts_on, 'DD/MM/YYYY'), '') || '. Xem lịch ở mục Lịch tập huấn.', 1000),
      'Lịch tập huấn', 'teacher', p_plan)
      from training_enrollments e join teachers t on t.id = e.teacher_id
     where e.plan_id = p_plan and t.org_id = p_org and t.profile_id is not null;
  end if;
end $$;

-- Bỏ gán trường: bỏ luôn đăng ký của GV trường đó
create or replace function public.training_plan_unassign(p_plan uuid, p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.training_plan_can_manage(p_plan) then raise exception 'Bạn không sửa được kế hoạch này' using errcode = '42501'; end if;
  perform set_config('app.training_unassign', 'on', true);
  delete from training_enrollments e using teachers t where e.plan_id = p_plan and t.id = e.teacher_id and t.org_id = p_org;
  perform set_config('app.training_unassign', 'off', true);
  delete from training_registrations where plan_id = p_plan and org_id = p_org;
  delete from training_plan_orgs where plan_id = p_plan and org_id = p_org;
end $$;

-- ===== 3. Khoá học, điều kiện hoàn thành, tiến độ, giám sát: chỉ tính nội dung của GV =====
do $$
declare r record; d text;
begin
  for r in select * from (values
    ('public.training_result_metrics(uuid,uuid)', 'public.training_plan_units(p_plan) x', 'public.training_teacher_units(p_plan, p_teacher) x'),
    ('public.training_course(uuid)', 'from public.training_plan_units(p_plan) x', 'from public.training_teacher_units(p_plan, v_teacher) x'),
    ('public.training_my_courses()', 'public.training_plan_units(p.id)', 'public.training_teacher_units(p.id, e.teacher_id)'),
    ('public.training_unit_unlocked(uuid,uuid,uuid)', 'public.training_plan_units(p_plan)', 'public.training_teacher_units(p_plan, p_teacher)'),
    ('public.training_monitor(text)', 'public.training_plan_units(po.pid) x', 'public.training_teacher_units(po.pid, e.teacher_id) x'),
    ('public.training_plan_progress(uuid)', '(select count(*) from us)', '(select count(*) from public.training_teacher_units(p_plan, e.teacher_id))'),
    ('public.training_plan_progress(uuid)', 'from us where', 'from public.training_teacher_units(p_plan, e.teacher_id) us where'),
    ('public.training_plan_progress(uuid)', 'from us join', 'from public.training_teacher_units(p_plan, e.teacher_id) us join')
  ) v(f, a, b) loop
    d := pg_get_functiondef(r.f::regprocedure);
    if position(r.a in d) > 0 then execute replace(d, r.a, r.b);
    elsif position(r.b in d) = 0 then raise exception '098: không tìm thấy "%" trong %', r.a, r.f;
    end if;
  end loop;
end $$;

-- ===== 4. Quyền gọi hàm =====
do $$ declare f text; begin
  foreach f in array array['training_teacher_units(uuid, uuid)', 'training_passed_units(uuid, uuid)', 'training_prereq_missing(uuid, uuid)',
    'training_register_conflicts(uuid, uuid, uuid[], uuid[])', 'training_register_check(uuid, uuid[], uuid[], uuid)', 'training_open_plans()',
    'training_register_units(uuid)', 'training_register(uuid, uuid[], uuid[], text)', 'training_register_cancel(uuid)',
    'training_registration_review(uuid, uuid, boolean, text)', 'training_plan_submit(uuid, uuid)', 'training_plan_review(uuid, uuid, boolean, text)',
    'training_plan_unassign(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.training_teacher_units(uuid, uuid) from authenticated;
revoke all on function public.training_passed_units(uuid, uuid) from authenticated;
revoke all on function public.training_prereq_missing(uuid, uuid) from authenticated;
revoke all on function public.training_register_conflicts(uuid, uuid, uuid[], uuid[]) from authenticated;
revoke all on function public.trainers_guard() from public, anon, authenticated;
revoke all on function public.trainers_rename() from public, anon, authenticated;
revoke all on function public.training_enrollments_unreg() from public, anon, authenticated;

notify pgrst, 'reload schema';
