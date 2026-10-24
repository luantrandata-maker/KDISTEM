-- 088. Phân hệ 1 — Đánh giá năng lực nhà giáo + Giám sát tập huấn (đợt 6)
--  • assessment_rounds: đợt đánh giá năng lực do KDI / Sở / Phòng / trường mở (năm học, thời hạn, mức yêu cầu).
--    Theo dõi tiến độ tự đánh giá / trường đánh giá theo từng trường, nhắc GV chưa nộp.
--  • Mức năng lực hiệu lực của GV = mức trường đánh giá (đã lưu), nếu chưa có thì mức tự đánh giá (đã nộp);
--    chứng chỉ tập huấn đã cấp nâng mức lên tối thiểu mức đích của chương trình (năng lực đích của chương trình).
--  • Khoảng thiếu hụt: GV dưới mức yêu cầu ở năng lực nào → gợi ý chương trình tập huấn có năng lực đó;
--    trường chọn GV cho kế hoạch được gợi ý sẵn GV đang thiếu năng lực mà kế hoạch bồi dưỡng.
--  • Minh chứng tự động bổ sung: khoá đạt, chứng chỉ đã cấp, điểm bài kiểm tra trung bình.
--  • Giám sát: mỗi kế hoạch × trường: chỉ tiêu, đã chọn GV, chuyên cần, học trực tuyến, đạt, chứng chỉ, cảnh báo;
--    hiệu quả: mức năng lực trước / sau tập huấn.
-- Cần chạy sau 087.

-- ===== 1. Đợt đánh giá =====
create table if not exists assessment_rounds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade default public.my_org_id(),
  name text not null check (length(btrim(name)) between 1 and 200),
  school_year text not null check (school_year ~ '^\d{4}-\d{4}$'),
  opens_on date not null default current_date,
  due_on date not null,
  target_level int not null default 2 check (target_level between 1 and 4),
  note text check (note is null or length(note) <= 2000),
  status text not null default 'open' check (status in ('open', 'closed')),
  reminded_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (due_on >= opens_on)
);
create index if not exists assessment_rounds_org on assessment_rounds (org_id, school_year);

-- Cây đơn vị bắt đầu từ một đơn vị bất kỳ
create or replace function public.org_subtree(p_org uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive t as (select id from organizations where id = p_org
    union all select o.id from organizations o join t on o.parent_id = t.id)
  select id from t
$$;

alter table assessment_rounds enable row level security;
drop policy if exists assessment_rounds_read on assessment_rounds;
create policy assessment_rounds_read on assessment_rounds for select to authenticated using (
  public.is_platform_admin() or org_id = public.my_org_id() or org_id in (select public.my_ancestor_orgs()) or org_id in (select public.my_org_tree()));
drop policy if exists assessment_rounds_write on assessment_rounds;
create policy assessment_rounds_write on assessment_rounds for all to authenticated
  using (public.training_can_write(org_id)) with check (public.training_can_write(org_id));
grant select, insert, update, delete on assessment_rounds to authenticated;

-- Tiến độ đợt đánh giá theo trường (chỉ GV thuộc cả phạm vi đợt và phạm vi người xem)
create or replace function public.assessment_round_progress(p_round uuid)
returns table (org_id uuid, org_name text, teachers int, self_done int, manager_done int)
language sql stable security definer set search_path = public as $$
  with r as (select * from assessment_rounds where id = p_round),
  t as (select t.id, t.org_id from teachers t, r
         where coalesce(t.status, 'active') = 'active' and t.org_id in (select public.org_subtree(r.org_id))
           and (public.is_platform_admin() or ((public.is_authority() or public.has_perm('training', 'view')) and t.org_id in (select public.my_org_tree()))))
  select o.id, o.name, count(t.id)::int,
         count(*) filter (where exists (select 1 from teacher_assessments a, r where a.teacher_id = t.id and a.school_year = r.school_year and a.kind = 'self' and a.status = 'submitted'))::int,
         count(*) filter (where exists (select 1 from teacher_assessments a, r where a.teacher_id = t.id and a.school_year = r.school_year and a.kind = 'manager' and a.status = 'submitted'))::int
    from t join organizations o on o.id = t.org_id
   group by o.id, o.name
   order by o.name
$$;

-- Nhắc GV chưa nộp tự đánh giá (mỗi 10 phút tối đa một lần)
create or replace function public.assessment_round_remind(p_round uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r assessment_rounds; n int;
begin
  select * into r from assessment_rounds where id = p_round;
  if r.id is null or not public.training_can_write(r.org_id) then raise exception 'Bạn không quản lý đợt đánh giá này' using errcode = '42501'; end if;
  if r.status <> 'open' then raise exception 'Đợt đánh giá đã đóng' using errcode = '22023'; end if;
  if r.reminded_at is not null and r.reminded_at > now() - interval '10 minutes' then return 0; end if;
  insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
  select t.org_id, t.profile_id, 'assessment_round', 'Tự đánh giá năng lực: ' || r.name,
         'Hạn nộp ' || to_char(r.due_on, 'DD/MM/YYYY') || '. Vào Hồ sơ năng lực để tự đánh giá.', 'Hồ sơ năng lực', 'teacher', r.id
    from teachers t
   where t.profile_id is not null and coalesce(t.status, 'active') = 'active' and t.org_id in (select public.org_subtree(r.org_id))
     and not exists (select 1 from teacher_assessments a where a.teacher_id = t.id and a.school_year = r.school_year and a.kind = 'self' and a.status = 'submitted');
  get diagnostics n = row_count;
  update assessment_rounds set reminded_at = now() where id = p_round;
  return n;
end $$;

-- ===== 2. Mức năng lực hiệu lực, mức qua tập huấn =====
-- Mức theo đánh giá trong năm học (trường đánh giá ưu tiên hơn tự đánh giá), chỉ bản đã nộp
create or replace function public.teacher_assessed_level(p_teacher uuid, p_comp text, p_year text) returns int
language sql stable security definer set search_path = public as $$
  select (a.levels ->> p_comp)::int from teacher_assessments a
   where a.teacher_id = p_teacher and a.school_year = p_year and a.status = 'submitted' and a.levels ? p_comp
   order by (a.kind = 'manager') desc limit 1
$$;

-- Năng lực đạt qua chứng chỉ tập huấn đã cấp (năng lực đích × mức đích của chương trình)
create or replace function public.teacher_training_levels(p_teacher uuid)
returns table (competency text, level int, program text, cert_code text, issued_on date)
language sql stable security definer set search_path = public as $$
  select k.comp, g.target_level, g.title, c.code, c.issued_on
    from certificates c
    join training_plan_items i on i.plan_id = c.plan_id
    join training_programs g on g.id = i.program_id
    cross join lateral unnest(g.competencies) k(comp)
   where c.teacher_id = p_teacher and c.status = 'issued' and (c.expires_on is null or c.expires_on >= current_date)
     and public.can_view_teacher(p_teacher)
   order by k.comp, g.target_level desc
$$;

create or replace function public.teacher_effective_level(p_teacher uuid, p_comp text, p_year text) returns int
language sql stable security definer set search_path = public as $$
  select nullif(greatest(coalesce(public.teacher_assessed_level(p_teacher, p_comp, p_year), 0),
    coalesce((select max(g.target_level) from certificates c join training_plan_items i on i.plan_id = c.plan_id
               join training_programs g on g.id = i.program_id
              where c.teacher_id = p_teacher and c.status = 'issued' and (c.expires_on is null or c.expires_on >= current_date)
                and p_comp = any(g.competencies)), 0)), 0)
$$;

-- ===== 3. Khoảng thiếu hụt → gợi ý chương trình =====
create or replace function public.competency_gaps(p_year text, p_target int default 2)
returns table (teacher_id uuid, teacher_name text, org_id uuid, org_name text, competency text, competency_name text, level int, suggest jsonb)
language sql stable security definer set search_path = public as $$
  with t as (select t.id, t.full_name, t.org_id from teachers t
              where coalesce(t.status, 'active') = 'active'
                and (public.is_platform_admin() or ((public.is_authority() or public.has_perm('training', 'view')) and t.org_id in (select public.my_org_tree())))),
  lv as (select t.*, c.key, c.name cname, c.sort, public.teacher_effective_level(t.id, c.key, p_year) l
           from t cross join competencies c where c.audience = 'teacher')
  select lv.id, lv.full_name, lv.org_id, o.name, lv.key, lv.cname, lv.l,
         (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'title', g.title, 'target_level', g.target_level) order by g.code), '[]'::jsonb)
            from training_programs g where g.status = 'published' and lv.key = any(g.competencies) and g.target_level > coalesce(lv.l, 0))
    from lv left join organizations o on o.id = lv.org_id
   where lv.l is not null and lv.l < p_target
   order by o.name, lv.full_name, lv.sort
$$;

-- GV trong phạm vi đang thiếu năng lực mà kế hoạch bồi dưỡng (để trường chọn GV)
create or replace function public.training_plan_gap_hint(p_plan uuid, p_target int default 2)
returns table (teacher_id uuid, competencies text[])
language sql stable security definer set search_path = public as $$
  with pc as (select distinct k.comp from training_plan_items i join training_programs g on g.id = i.program_id
                cross join lateral unnest(g.competencies) k(comp) where i.plan_id = p_plan),
  y as (select coalesce((select year_name from training_plans where id = p_plan), '') yr)
  select t.id, array_agg(c.name order by c.sort)
    from teachers t cross join pc join competencies c on c.key = pc.comp, y
   where coalesce(t.status, 'active') = 'active'
     and (public.is_platform_admin() or ((public.is_authority() or public.has_perm('training', 'view')) and t.org_id in (select public.my_org_tree())))
     and coalesce(public.teacher_effective_level(t.id, pc.comp, y.yr),
                  public.teacher_effective_level(t.id, pc.comp, (select max(school_year) from teacher_assessments a where a.teacher_id = t.id)), 99) < p_target
   group by t.id
$$;

-- ===== 4. Minh chứng tự động (bổ sung dữ liệu tập huấn mới) =====
create or replace function public.teacher_evidence(p_teacher uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_teacher(p_teacher) then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return jsonb_build_object(
    'training_completed', (select count(*) from training_enrollments where teacher_id = p_teacher and completed)
                          + (select count(*) from training_results r where r.teacher_id = p_teacher and r.result = 'pass'
                               and not exists (select 1 from training_enrollments e where e.plan_id = r.plan_id and e.teacher_id = p_teacher and e.completed)),
    'training_enrolled', (select count(*) from training_enrollments where teacher_id = p_teacher),
    'training_present', (select count(*) from training_attendance where teacher_id = p_teacher and present),
    'certificates', (select count(*) from certificates where teacher_id = p_teacher and status = 'issued'),
    'test_avg', (select round(avg(best_score), 1) from training_progress where teacher_id = p_teacher and best_score is not null),
    'stem_taught_12m', (select count(*) from teaching_sessions where teacher_id = p_teacher and kind = 'stem' and status = 'taught'
                          and session_date >= current_date - 365),
    'stem_planned_12m', (select count(*) from teaching_sessions where teacher_id = p_teacher and kind = 'stem' and status <> 'cancelled'
                          and session_date between current_date - 365 and current_date),
    'lesson_plans', (select count(*) from lesson_plans where teacher_id = p_teacher),
    'rubric_assignments', (select count(*) from assignments where teacher_id = p_teacher and rubric is not null),
    'assignments', (select count(*) from assignments where teacher_id = p_teacher));
end $$;

-- ===== 5. Giám sát tập huấn =====
-- Mỗi dòng: một kế hoạch × một trường được gán. Đơn vị lập kế hoạch thấy mọi trường; cấp quản lý / trường thấy trường trong phạm vi.
create or replace function public.training_monitor(p_year text default null)
returns table (plan_id uuid, plan_code text, plan_name text, plan_org text, year_name text, starts_on date, ends_on date,
               org_id uuid, org_name text, quota int, org_status text, enrolled int, sessions int, sessions_closed int,
               att_pct numeric, low_att int, online_done int, passed int, failed int, not_ready int, certs int)
language sql stable security definer set search_path = public as $$
  with po as (
    select p.id pid, p.plan_code, p.name, po2.name porg, p.year_name, p.starts_on, p.ends_on, o.org_id, og.name oname, o.quota, o.status,
           (select max(g.pass_attendance) from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p.id) att_req
      from training_plans p
      join training_plan_orgs o on o.plan_id = p.id
      join organizations og on og.id = o.org_id
      left join organizations po2 on po2.id = p.org_id
     where p.pub_status <> 'draft' and (p_year is null or p.year_name = p_year)
       and (public.is_platform_admin() or public.training_plan_can_manage(p.id)
            or ((public.is_authority() or public.has_perm('training', 'view')) and o.org_id in (select public.my_org_tree())))
  ),
  e as (select po.pid, po.org_id, en.teacher_id from po join training_enrollments en on en.plan_id = po.pid
          join teachers t on t.id = en.teacher_id and t.org_id = po.org_id),
  a as (select e.pid, e.org_id, e.teacher_id,
               count(*) filter (where s.closed_at is not null) n,
               count(*) filter (where s.closed_at is not null and at.present) p,
               count(*) filter (where s.closed_at is not null and at.present is not true and at.excuse_status = 'approved') ex
          from e join training_sessions s on s.plan_id = e.pid
          join training_attendance at on at.session_id = s.id and at.teacher_id = e.teacher_id
         group by e.pid, e.org_id, e.teacher_id)
  select po.pid, po.plan_code, po.name, po.porg, po.year_name, po.starts_on, po.ends_on, po.org_id, po.oname, po.quota, po.status,
         (select count(*) from e where e.pid = po.pid and e.org_id = po.org_id)::int,
         (select count(*) from training_sessions s where s.plan_id = po.pid)::int,
         (select count(*) from training_sessions s where s.plan_id = po.pid and s.closed_at is not null)::int,
         (select round(sum(a.p) * 100.0 / nullif(sum(a.n - a.ex), 0), 1) from a where a.pid = po.pid and a.org_id = po.org_id),
         (select count(*) from a where a.pid = po.pid and a.org_id = po.org_id and a.n - a.ex > 0
             and a.p * 100.0 / (a.n - a.ex) < coalesce(po.att_req, 80))::int,
         (select count(*) from e where e.pid = po.pid and e.org_id = po.org_id
             and not exists (select 1 from public.training_plan_units(po.pid) x where not public.training_unit_done(po.pid, x.unit_id, e.teacher_id)))::int,
         (select count(*) from e join training_results r on r.plan_id = e.pid and r.teacher_id = e.teacher_id
           where e.pid = po.pid and e.org_id = po.org_id and r.result = 'pass')::int,
         (select count(*) from e join training_results r on r.plan_id = e.pid and r.teacher_id = e.teacher_id
           where e.pid = po.pid and e.org_id = po.org_id and r.result = 'fail')::int,
         -- Sắp hết hạn (14 ngày) mà chưa đủ điều kiện
         case when po.ends_on is not null and po.ends_on between current_date and current_date + 14 then
           (select count(*) from e where e.pid = po.pid and e.org_id = po.org_id
               and not exists (select 1 from training_results r where r.plan_id = e.pid and r.teacher_id = e.teacher_id and r.result = 'pass')
               and public.training_result_metrics(e.pid, e.teacher_id) ->> 'suggest' <> 'pass')::int else 0 end,
         (select count(*) from e join certificates c on c.plan_id = e.pid and c.teacher_id = e.teacher_id
           where e.pid = po.pid and e.org_id = po.org_id and c.status = 'issued')::int
    from po
   order by po.starts_on desc nulls last, po.plan_code, po.oname
$$;

-- Hiệu quả: mức năng lực trước / sau tập huấn của GV đã Đạt khoá có năng lực đích tương ứng
create or replace function public.training_competency_effect()
returns table (competency text, competency_name text, teachers int, before_avg numeric, after_avg numeric)
language sql stable security definer set search_path = public as $$
  with x as (
    select distinct r.teacher_id, k.comp, p.year_name
      from training_results r
      join training_plans p on p.id = r.plan_id
      join training_plan_items i on i.plan_id = p.id
      join training_programs g on g.id = i.program_id
      cross join lateral unnest(g.competencies) k(comp)
      join teachers t on t.id = r.teacher_id
     where r.result = 'pass' and p.year_name is not null
       and (public.is_platform_admin() or ((public.is_authority() or public.has_perm('training', 'view')) and t.org_id in (select public.my_org_tree())))),
  v as (select x.comp, x.teacher_id,
          (select (a.levels ->> x.comp)::int from teacher_assessments a where a.teacher_id = x.teacher_id and a.status = 'submitted'
              and a.school_year < x.year_name and a.levels ? x.comp order by a.school_year desc, (a.kind = 'manager') desc limit 1) b,
          (select (a.levels ->> x.comp)::int from teacher_assessments a where a.teacher_id = x.teacher_id and a.status = 'submitted'
              and a.school_year >= x.year_name and a.levels ? x.comp order by a.school_year desc, (a.kind = 'manager') desc limit 1) af
        from x)
  select c.key, c.name, count(distinct v.teacher_id)::int, round(avg(v.b), 2), round(avg(v.af), 2)
    from competencies c join v on v.comp = c.key
   where c.audience = 'teacher'
   group by c.key, c.name, c.sort
   order by c.sort
$$;

do $$ declare f text; begin
  foreach f in array array['org_subtree(uuid)', 'assessment_round_progress(uuid)', 'assessment_round_remind(uuid)',
    'teacher_assessed_level(uuid, text, text)', 'teacher_training_levels(uuid)', 'teacher_effective_level(uuid, text, text)',
    'competency_gaps(text, integer)', 'training_plan_gap_hint(uuid, integer)', 'training_monitor(text)', 'training_competency_effect()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  foreach f in array array['assessment_round_progress(uuid)', 'assessment_round_remind(uuid)', 'teacher_training_levels(uuid)',
    'competency_gaps(text, integer)', 'training_plan_gap_hint(uuid, integer)', 'training_monitor(text)', 'training_competency_effect()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
