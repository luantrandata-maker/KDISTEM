-- 119. Góp ý sau kiểm tra (29/10):
--  • Khoá học e-learning: chọn nhiều môn, nhiều khối (courses.subjects, courses.grades). Cột cũ subject / grade giữ giá trị đầu tiên
--    để các màn và bộ lọc cũ chạy như trước.
--  • Chương trình giáo dục: đơn vị xây dựng (edu_programs.builder), phiên bản mới / bản sao giữ nguyên.
--  • Mời đăng ký tập huấn: training_invite_status(p_plan) cho biết đã gửi tới bao nhiêu GV, bao nhiêu người đã xem thông báo,
--    bao nhiêu người đã đăng ký / có tên, theo từng trường.
-- Cần chạy sau 118.

-- ===== 1. Khoá học: nhiều môn, nhiều khối =====
alter table courses add column if not exists subjects text[] not null default '{}';
alter table courses add column if not exists grades int[] not null default '{}';
alter table courses drop constraint if exists courses_grades_check;
alter table courses add constraint courses_grades_check check (cardinality(grades) <= 12 and grades <@ array[1,2,3,4,5,6,7,8,9,10,11,12]);
alter table courses drop constraint if exists courses_subjects_check;
alter table courses add constraint courses_subjects_check check (cardinality(subjects) <= 20);
update courses set subjects = array[btrim(subject)] where cardinality(subjects) = 0 and nullif(btrim(subject), '') is not null;
update courses set grades = array[grade] where cardinality(grades) = 0 and grade between 1 and 12;

-- Đồng bộ: mảng mới là nguồn chính; ai chỉ ghi cột cũ (màn cũ, API) thì mảng theo cột cũ
create or replace function public.courses_multi_sync() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.subjects is not distinct from old.subjects and new.subject is distinct from old.subject then
    new.subjects := case when nullif(btrim(new.subject), '') is null then '{}' else array[btrim(new.subject)] end;
  elsif tg_op = 'INSERT' and cardinality(new.subjects) = 0 and nullif(btrim(new.subject), '') is not null then
    new.subjects := array[btrim(new.subject)];
  end if;
  if tg_op = 'UPDATE' and new.grades is not distinct from old.grades and new.grade is distinct from old.grade then
    new.grades := case when new.grade is null then '{}' else array[new.grade] end;
  elsif tg_op = 'INSERT' and cardinality(new.grades) = 0 and new.grade is not null then
    new.grades := array[new.grade];
  end if;
  -- Môn: bỏ trống, bỏ trùng (giữ thứ tự chọn); khối: tăng dần
  new.subjects := coalesce(array(select s from (select btrim(x) s, min(o) o from unnest(new.subjects) with ordinality u(x, o)
                                                where btrim(x) <> '' group by btrim(x)) q order by o), '{}');
  new.grades := coalesce(array(select distinct g from unnest(new.grades) g order by g), '{}');
  new.subject := new.subjects[1];
  new.grade := new.grades[1];
  return new;
end $$;
revoke all on function public.courses_multi_sync() from public, anon, authenticated;
drop trigger if exists courses_multi_sync on courses;
create trigger courses_multi_sync before insert or update on courses for each row execute function public.courses_multi_sync();

-- ===== 2. Chương trình giáo dục: đơn vị xây dựng =====
alter table edu_programs add column if not exists builder text;
alter table edu_programs drop constraint if exists edu_programs_builder_check;
alter table edu_programs add constraint edu_programs_builder_check check (builder is null or length(builder) <= 200);

create or replace function public.edu_programs_builder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.builder := nullif(btrim(regexp_replace(coalesce(new.builder, ''), '\s+', ' ', 'g')), '');
  if tg_op = 'INSERT' and new.builder is null and new.source_id is not null then
    select builder into new.builder from edu_programs where id = new.source_id;
  end if;
  return new;
end $$;
revoke all on function public.edu_programs_builder() from public, anon, authenticated;
drop trigger if exists edu_programs_builder on edu_programs;
create trigger edu_programs_builder before insert or update on edu_programs for each row execute function public.edu_programs_builder();

-- Hiệu lực đến không trước hiệu lực từ
alter table edu_programs drop constraint if exists edu_programs_effective_check;
alter table edu_programs add constraint edu_programs_effective_check check (effective_to is null or effective_from is null or effective_to >= effective_from) not valid;

-- ===== 3. Tình trạng lời mời đăng ký tập huấn =====
-- Mỗi GV một dòng thông báo mời (gộp theo kế hoạch); "đã xem" = đã mở thông báo. Đơn vị lập kế hoạch thấy mọi trường được gán,
-- trường thấy trường mình.
drop function if exists public.training_invite_status(uuid);
create or replace function public.training_invite_status(p_plan uuid)
returns table (org_id uuid, org_name text, invited_at timestamptz, teachers int, no_account int, sent int, seen int, registered int, last_sent timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_mgr boolean;
begin
  v_mgr := public.is_platform_admin() or public.training_plan_can_manage(p_plan);
  -- Ngoài đơn vị lập kế hoạch: cán bộ trường / Sở có quyền tập huấn (giáo viên không xem)
  if not v_mgr and not (public.is_staff() and (public.is_admin() or public.is_authority()
                        or public.has_perm('training', 'edit') or public.has_perm('training', 'create'))) then return; end if;
  return query
  with o as (
    select po.org_id, po.invited_at from training_plan_orgs po
     where po.plan_id = p_plan and (v_mgr or po.org_id in (select public.my_org_tree()))),
  t as (
    select te.id, te.org_id, te.profile_id from teachers te join o on o.org_id = te.org_id
     where coalesce(te.status, 'active') = 'active'),
  n as (
    select distinct on (x.user_id) x.user_id, x.read_at, x.created_at from notifications x
     where x.kind = 'training_invite' and x.ref_id = p_plan and x.user_id in (select t.profile_id from t where t.profile_id is not null)
     order by x.user_id, x.created_at desc)
  select o.org_id, og.name, o.invited_at,
         (select count(*)::int from t where t.org_id = o.org_id),
         (select count(*)::int from t where t.org_id = o.org_id and t.profile_id is null),
         (select count(*)::int from t join n on n.user_id = t.profile_id where t.org_id = o.org_id),
         (select count(*)::int from t join n on n.user_id = t.profile_id where t.org_id = o.org_id and n.read_at is not null),
         (select count(*)::int from t where t.org_id = o.org_id and (
             exists (select 1 from training_enrollments e where e.plan_id = p_plan and e.teacher_id = t.id)
             or exists (select 1 from training_registrations r where r.plan_id = p_plan and r.teacher_id = t.id and r.status in ('pending', 'waitlist', 'accepted')))),
         (select max(n.created_at) from t join n on n.user_id = t.profile_id where t.org_id = o.org_id)
    from o join organizations og on og.id = o.org_id
   order by og.name;
end $$;
revoke all on function public.training_invite_status(uuid) from public, anon;
grant execute on function public.training_invite_status(uuid) to authenticated;

notify pgrst, 'reload schema';
