-- 142: Mức cần đạt riêng cho từng năng lực đích của chương trình đào tạo.
-- competency_levels = {mã năng lực: mức 1–4}; năng lực không có trong đó dùng target_level (mức chung, giữ cho dữ liệu cũ).
-- Giao diện ghi đủ mức cho mọi năng lực và target_level = mức cao nhất.

alter table public.training_programs add column if not exists competency_levels jsonb not null default '{}'::jsonb;
alter table public.training_programs drop constraint if exists training_programs_competency_levels_obj;
alter table public.training_programs add constraint training_programs_competency_levels_obj check (jsonb_typeof(competency_levels) = 'object');

-- Chuẩn hoá (chỉ giữ năng lực đích, mức 1–4), khoá khi đã gửi duyệt / phát hành, phiên bản mới chép mức từ bản gốc
create or replace function public.training_programs_levels_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.source_id is not null and new.competency_levels = '{}'::jsonb then
    select competency_levels into new.competency_levels from training_programs where id = new.source_id;
    new.competency_levels := coalesce(new.competency_levels, '{}'::jsonb);
  end if;
  new.competency_levels := coalesce((select jsonb_object_agg(k.key, (k.value #>> '{}')::int)
      from jsonb_each(new.competency_levels) k
     where k.key = any(coalesce(new.competencies, '{}')) and jsonb_typeof(k.value) = 'number'
       and (k.value #>> '{}')::numeric in (1, 2, 3, 4)), '{}'::jsonb);
  if tg_op = 'UPDATE' and old.status not in ('draft', 'rejected') and new.competency_levels is distinct from old.competency_levels then
    raise exception 'Chương trình tập huấn đã gửi duyệt / phát hành: tạo phiên bản mới để sửa' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists training_programs_levels_guard on public.training_programs;
create trigger training_programs_levels_guard before insert or update on public.training_programs
  for each row execute function public.training_programs_levels_guard();

-- Các hàm dùng mức đích: lấy mức của đúng năng lực
create or replace function public.teacher_training_levels(p_teacher uuid)
returns table (competency text, level int, program text, cert_code text, issued_on date)
language sql stable security definer set search_path = public as $$
  select k.comp, coalesce((g.competency_levels ->> k.comp)::int, g.target_level), g.title, c.code, c.issued_on
    from certificates c
    join training_plan_items i on i.plan_id = c.plan_id
    join training_programs g on g.id = i.program_id
    cross join lateral unnest(g.competencies) k(comp)
   where c.teacher_id = p_teacher and c.status = 'issued' and (c.expires_on is null or c.expires_on >= current_date)
     and public.can_view_teacher(p_teacher)
   order by 1, 2 desc
$$;

create or replace function public.teacher_effective_level(p_teacher uuid, p_comp text, p_year text) returns int
language sql stable security definer set search_path = public as $$
  select nullif(greatest(coalesce(public.teacher_assessed_level(p_teacher, p_comp, p_year), 0),
    coalesce((select max(coalesce((g.competency_levels ->> p_comp)::int, g.target_level)) from certificates c join training_plan_items i on i.plan_id = c.plan_id
               join training_programs g on g.id = i.program_id
              where c.teacher_id = p_teacher and c.status = 'issued' and (c.expires_on is null or c.expires_on >= current_date)
                and p_comp = any(g.competencies)), 0)), 0)
$$;

create or replace function public.competency_gaps(p_year text, p_target int default 2)
returns table (teacher_id uuid, teacher_name text, org_id uuid, org_name text, competency text, competency_name text, level int, suggest jsonb)
language sql stable security definer set search_path = public as $$
  with t as (select t.id, t.full_name, t.org_id from teachers t
              where coalesce(t.status, 'active') = 'active'
                and (public.is_platform_admin() or ((public.is_authority() or public.has_perm('training', 'view')) and t.org_id in (select public.my_org_tree())))),
  lv as (select t.*, c.key, c.name cname, c.sort, public.teacher_effective_level(t.id, c.key, p_year) l
           from t cross join competencies c where c.audience = 'teacher')
  select lv.id, lv.full_name, lv.org_id, o.name, lv.key, lv.cname, lv.l,
         (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'title', g.title, 'target_level', coalesce((g.competency_levels ->> lv.key)::int, g.target_level)) order by g.code), '[]'::jsonb)
            from training_programs g where g.status = 'published' and lv.key = any(g.competencies) and coalesce((g.competency_levels ->> lv.key)::int, g.target_level) > coalesce(lv.l, 0))
    from lv left join organizations o on o.id = lv.org_id
   where lv.l is not null and lv.l < p_target
   order by o.name, lv.full_name, lv.sort
$$;

create or replace function public.program_readiness(p_year text default null)
returns table (org_id uuid, org_name text, org_level text, ct_code text, ct_name text, classes int, grades int[], edu_programs text[],
               teachers jsonb, assigned int, qualified int, suggest jsonb)
language sql stable security definer set search_path = public as $$
  with sch as (
    select o.id, o.name, o.level from organizations o
     where o.type = 'school'
       and (public.is_platform_admin() or ((public.is_authority() or public.is_admin() or public.has_perm('training', 'edit')) and o.id in (select public.my_org_tree())))),
  cls as (   -- lớp học theo chương trình
    select cp.org_id, cp.program ct, count(*)::int n, array_agg(distinct c.grade order by c.grade) grades
      from class_programs cp join sch on sch.id = cp.org_id join classes c on c.id = cp.class_id
      left join academic_years ay on ay.id = c.year_id
     where p_year is null or c.year_id is null or ay.name = p_year
     group by cp.org_id, cp.program),
  edu as (   -- chương trình giáo dục STEM đã ban hành được gán cho trường
    select a.org_id, k.ct, array_agg(distinct p.title order by p.title) titles
      from edu_program_assignments a join sch on sch.id = a.org_id join edu_programs p on p.id = a.program_id
      cross join lateral unnest(p.ct_codes) k(ct)
     where p.status = 'published'
     group by a.org_id, k.ct),
  asg as (   -- GV được phân công dạy theo chương trình
    select sp.org_id, sp.program ct, t.id tid, t.full_name
      from stem_teacher_programs sp join sch on sch.id = sp.org_id join teachers t on t.id = sp.teacher_id
     where coalesce(t.status, 'active') = 'active'),
  pairs as (select org_id, ct from cls union select org_id, ct from edu union select org_id, ct from asg),
  tq as (    -- từng GV: chứng chỉ cùng loại, năng lực
    select a.org_id, a.ct, a.tid, a.full_name,
           (select c.code from certificates c join training_plan_items i on i.plan_id = c.plan_id join training_programs g on g.id = i.program_id
             where c.teacher_id = a.tid and c.status = 'issued' and (c.expires_on is null or c.expires_on >= current_date) and a.ct = any(g.ct_codes)
             order by c.issued_on desc nulls last limit 1) cert,
           best.title best_title, best.miss
      from asg a join sch on sch.id = a.org_id
      left join lateral (
        select x.title, x.miss from (
          select g.title, g.code, array(select cm.name from unnest(g.competencies) k(comp) join competencies cm on cm.key = k.comp
                                         where public.teacher_level_for(a.tid, k.comp, p_year) < coalesce((g.competency_levels ->> k.comp)::int, g.target_level) order by cm.sort) miss
            from training_programs g
           where g.status = 'published' and a.ct = any(g.ct_codes) and cardinality(g.competencies) > 0
             and (cardinality(g.levels) = 0 or sch.level is null or sch.level = any(g.levels))) x
         order by cardinality(x.miss), x.code limit 1) best on true)
  select s.id, s.name, s.level, pr.ct, st.name, coalesce(cl.n, 0), coalesce(cl.grades, '{}'), coalesce(e.titles, '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('id', q.tid, 'name', q.full_name, 'cert', q.cert,
                     'comp', q.best_title is not null and cardinality(q.miss) = 0, 'program', q.best_title, 'missing', to_jsonb(q.miss),
                     'ok', q.cert is not null or (q.best_title is not null and cardinality(q.miss) = 0)) order by q.full_name)
                     from tq q where q.org_id = pr.org_id and q.ct = pr.ct), '[]'::jsonb),
         (select count(*)::int from tq q where q.org_id = pr.org_id and q.ct = pr.ct),
         (select count(*)::int from tq q where q.org_id = pr.org_id and q.ct = pr.ct and (q.cert is not null or (q.best_title is not null and cardinality(q.miss) = 0))),
         (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'title', g.title, 'levels', g.levels) order by g.code), '[]'::jsonb)
            from training_programs g where g.status = 'published' and pr.ct = any(g.ct_codes) and (cardinality(g.levels) = 0 or s.level is null or s.level = any(g.levels)))
    from pairs pr join sch s on s.id = pr.org_id
    left join stem_tracks st on st.code = pr.ct
    left join cls cl on cl.org_id = pr.org_id and cl.ct = pr.ct
    left join edu e on e.org_id = pr.org_id and e.ct = pr.ct
   order by s.name, pr.ct
$$;

create or replace function public.teacher_training_history(p_teacher uuid)
returns table (plan_id uuid, plan_code text, plan_name text, plan_org text, year_name text, term text, starts_on date, ends_on date,
               hours int, closed boolean, programs jsonb, sessions int, present int, excused int, att_pct numeric,
               result text, total_score numeric, grade text, cert_code text, cert_issued_on date, cert_status text, cert_valid boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.plan_code, p.name, o.name, p.year_name, p.term, p.starts_on, p.ends_on, p.hours, p.closed_at is not null,
         (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'title', g.title, 'competencies', to_jsonb(coalesce(g.competencies, '{}')),
                    'target_level', g.target_level, 'competency_levels', g.competency_levels) order by i.seq, g.code), '[]'::jsonb)
            from training_plan_items i join training_programs g on g.id = i.program_id where i.plan_id = p.id),
         a.s, a.p, a.ex,
         case when a.s - a.ex > 0 then round(a.p * 100.0 / (a.s - a.ex), 1) end,
         coalesce(r.result, 'pending'), r.total_score, r.grade,
         c.code, c.issued_on, c.status,
         c.status = 'issued' and (c.expires_on is null or c.expires_on >= current_date)
    from training_enrollments e
    join training_plans p on p.id = e.plan_id
    left join organizations o on o.id = p.org_id
    left join training_results r on r.plan_id = e.plan_id and r.teacher_id = e.teacher_id
    left join lateral (select c.* from certificates c where c.plan_id = e.plan_id and c.teacher_id = e.teacher_id
                        order by (c.status = 'issued') desc, c.issued_on desc nulls last limit 1) c on true
    cross join lateral (select count(*)::int s, count(*) filter (where t.present)::int p,
                               count(*) filter (where t.present is not true and t.excuse_status = 'approved')::int ex
                          from training_attendance t join training_sessions ss on ss.id = t.session_id
                         where ss.plan_id = e.plan_id and t.teacher_id = e.teacher_id
                           and (ss.closed_at is not null or ss.starts_at <= now())) a
   where e.teacher_id = p_teacher and p.pub_status <> 'draft' and public.can_view_teacher(p_teacher)
   order by p.starts_on desc nulls last, p.year_name desc nulls last, p.name
$$;

create or replace function public.teacher_edu_met(p_teachers uuid[])
returns table (teacher_id uuid, edu_family uuid, plan_id uuid, plan_name text, program_id uuid, program_title text,
               competencies text[], target_level int, met_on date, cert_code text)
language sql stable security definer set search_path = public as $$
  with passed as (   -- khoá đào tạo GV đã Đạt
    select e.teacher_id, p.id plan_id, p.name plan_name, g.id program_id, g.title, g.family_id, coalesce(g.competencies, '{}') comps, g.target_level, g.competency_levels clv,
           coalesce(c.issued_on, r.decided_at::date, p.ends_on) met_on, c.code
      from training_enrollments e
      join training_plans p on p.id = e.plan_id
      left join training_results r on r.plan_id = e.plan_id and r.teacher_id = e.teacher_id
      left join lateral (select c.code, c.issued_on from certificates c
                          where c.plan_id = e.plan_id and c.teacher_id = e.teacher_id and c.status = 'issued'
                            and (c.expires_on is null or c.expires_on >= current_date)
                          order by c.issued_on desc nulls last limit 1) c on true
      join training_plan_items i on i.plan_id = e.plan_id
      join training_programs g on g.id = i.program_id
     where e.teacher_id = any(p_teachers) and (r.result = 'pass' or c.code is not null)),
  mgr as (           -- lần trường đánh giá gần nhất
    select distinct on (x.teacher_id) x.teacher_id, x.levels, coalesce(x.submitted_at, x.updated_at)::date d
      from teacher_assessments x
     where x.teacher_id = any(p_teachers) and x.kind = 'manager' and x.status = 'submitted'
     order by x.teacher_id, x.school_year desc),
  lv as (            -- mức hiệu lực theo từng năng lực
    select z.teacher_id, z.comp, max(z.l) l from (
      select m.teacher_id, k.key comp, (m.levels ->> k.key)::numeric l
        from mgr m cross join lateral jsonb_each(m.levels) k where jsonb_typeof(k.value) = 'number'
      union all
      select pa.teacher_id, k.comp, coalesce((pa.clv ->> k.comp)::int, pa.target_level) from passed pa cross join lateral unnest(pa.comps) k(comp) where pa.target_level is not null) z
     group by z.teacher_id, z.comp),
  fam as (select distinct r.edu_family from edu_program_teacher_reqs r)
  select pa.teacher_id, l.edu_family, pa.plan_id, pa.plan_name, pa.program_id, pa.title, pa.comps, pa.target_level, pa.met_on, pa.code
    from passed pa join training_program_edu l on l.training_family = pa.family_id
  union all
  select t.id, f.edu_family, null::uuid, 'theo khung năng lực', null::uuid, 'Đạt yêu cầu năng lực',
         '{}'::text[], null::int,
         greatest((select m.d from mgr m where m.teacher_id = t.id), (select max(pa.met_on) from passed pa where pa.teacher_id = t.id)), null::text
    from unnest(p_teachers) t(id) cross join fam f
   where not exists (select 1 from edu_program_teacher_reqs r
                      where r.edu_family = f.edu_family
                        and coalesce((select v.l from lv v where v.teacher_id = t.id and v.comp = r.competency), 0) < r.min_level)
$$;

create or replace function public.teacher_edu_programs(p_teacher uuid)
returns table (edu_family uuid, edu_id uuid, code text, title text, kind text, ct_code text, level text, grade_from int, grade_to int,
               main_subject text, met_on date, via jsonb, competencies jsonb)
language sql stable security definer set search_path = public as $$
  select m.edu_family, h.id, h.code, h.title, h.kind, h.ct_code, h.level, h.grade_from, h.grade_to, h.main_subject, max(m.met_on),
         jsonb_agg(distinct jsonb_build_object('plan', m.plan_name, 'program', m.program_title, 'date', m.met_on, 'cert', m.cert_code)),
         (select coalesce(jsonb_object_agg(k, lv), '{}'::jsonb) from (
            select k, max(coalesce((select (g2.competency_levels ->> k)::int from training_programs g2 where g2.id = m2.program_id), m2.target_level)) lv from public.teacher_edu_met(array[p_teacher]) m2 cross join lateral unnest(m2.competencies) k
             where m2.edu_family = m.edu_family group by k) z)
    from public.teacher_edu_met(array[p_teacher]) m
    cross join lateral public.edu_family_head(m.edu_family) h
   where public.can_view_teacher(p_teacher) and h.id is not null
   group by m.edu_family, h.id, h.code, h.title, h.kind, h.ct_code, h.level, h.grade_from, h.grade_to, h.main_subject
   order by h.title
$$;
