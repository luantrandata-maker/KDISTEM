-- 124. Chương trình tập huấn gắn chương trình giáo dục; giáo viên đáp ứng chương trình giáo dục nào; lịch sử tập huấn.
--  • training_program_edu: chương trình tập huấn (theo họ phiên bản) ↔ chương trình giáo dục (theo họ phiên bản), KDI gắn.
--    Gắn theo họ nên phiên bản mới của cả hai bên vẫn giữ liên kết.
--  • Giáo viên ĐÁP ỨNG một chương trình giáo dục khi đã Đạt (kết quả Đạt hoặc chứng chỉ đã cấp còn hiệu lực) một kế hoạch tập huấn
--    có chương trình tập huấn gắn với chương trình giáo dục đó (chỉ cần một khoá).
--  • teacher_edu_programs(p_teacher): chương trình giáo dục GV đáp ứng, qua khoá nào, ngày nào, kèm năng lực đích đạt được.
--  • edu_program_readiness(): mỗi trường × chương trình giáo dục (được gán cho trường, hoặc đã có GV đáp ứng): số GV đáp ứng,
--    danh sách GV, chương trình tập huấn gợi ý. Phạm vi xem như program_readiness (115).
--  • teacher_training_history(p_teacher) (soạn sẵn từ trước, nay đánh số 124): lịch sử tập huấn đầy đủ.
--  • teacher_training_history(p_teacher): mỗi kế hoạch GV có tên (ghi danh) → đợt, số giờ, chuyên cần, kết quả, điểm, xếp loại,
--    chứng chỉ, các chương trình (năng lực đích, mức đích). Người xem: chính GV, quản trị trường của GV, Sở / Phòng quản lý, KDI.
--  • Tiến bộ theo năm học: giao diện ghép lịch sử này với teacher_assessments (RLS sẵn có) → mức tự đánh giá / trường đánh giá /
--    mức đạt qua tập huấn theo từng năng lực, cộng số khoá và giờ bồi dưỡng mỗi năm.
-- Cần chạy sau 122 (không phụ thuộc 123).

create or replace function public.teacher_training_history(p_teacher uuid)
returns table (plan_id uuid, plan_code text, plan_name text, plan_org text, year_name text, term text, starts_on date, ends_on date,
               hours int, closed boolean, programs jsonb, sessions int, present int, excused int, att_pct numeric,
               result text, total_score numeric, grade text, cert_code text, cert_issued_on date, cert_status text, cert_valid boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.plan_code, p.name, o.name, p.year_name, p.term, p.starts_on, p.ends_on, p.hours, p.closed_at is not null,
         (select coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'title', g.title, 'competencies', to_jsonb(coalesce(g.competencies, '{}')),
                    'target_level', g.target_level) order by i.seq, g.code), '[]'::jsonb)
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
revoke all on function public.teacher_training_history(uuid) from public, anon;
grant execute on function public.teacher_training_history(uuid) to authenticated;

-- ===== Liên kết chương trình tập huấn ↔ chương trình giáo dục =====
create table if not exists training_program_edu (
  training_family uuid not null,
  edu_family uuid not null,
  created_at timestamptz not null default now(),
  primary key (training_family, edu_family)
);
create index if not exists training_program_edu_edu on training_program_edu (edu_family);
alter table training_program_edu enable row level security;
drop policy if exists training_program_edu_read on training_program_edu;
create policy training_program_edu_read on training_program_edu for select to authenticated using (true);
drop policy if exists training_program_edu_write on training_program_edu;
create policy training_program_edu_write on training_program_edu for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Đặt danh sách chương trình giáo dục của một chương trình tập huấn (nhận id phiên bản bất kỳ của mỗi bên)
create or replace function public.training_program_set_edu(p_program uuid, p_edu uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_fam uuid; n int;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng KDI gắn chương trình giáo dục cho chương trình tập huấn' using errcode = '42501'; end if;
  select family_id into v_fam from training_programs where id = p_program;
  if v_fam is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  if cardinality(coalesce(p_edu, '{}')) > 200 then raise exception 'Quá nhiều chương trình giáo dục' using errcode = '22023'; end if;
  delete from training_program_edu where training_family = v_fam;
  insert into training_program_edu (training_family, edu_family)
    select distinct v_fam, coalesce(e.family_id, e.id) from edu_programs e where e.id = any(coalesce(p_edu, '{}'))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.training_program_set_edu(uuid, uuid[]) from public, anon;
grant execute on function public.training_program_set_edu(uuid, uuid[]) to authenticated;

-- Phiên bản đại diện của một họ chương trình giáo dục: bản đang ban hành, chưa có thì bản mới nhất
create or replace function public.edu_family_head(p_family uuid) returns edu_programs
language sql stable security definer set search_path = public as $$
  select e.* from edu_programs e where coalesce(e.family_id, e.id) = p_family
   order by (e.status = 'published') desc, e.version_no desc limit 1
$$;
revoke all on function public.edu_family_head(uuid) from public, anon, authenticated;

-- Nội bộ: GV × chương trình giáo dục đáp ứng, qua kế hoạch / chương trình tập huấn nào
create or replace function public.teacher_edu_met(p_teachers uuid[])
returns table (teacher_id uuid, edu_family uuid, plan_id uuid, plan_name text, program_id uuid, program_title text,
               competencies text[], target_level int, met_on date, cert_code text)
language sql stable security definer set search_path = public as $$
  select e.teacher_id, l.edu_family, p.id, p.name, g.id, g.title, coalesce(g.competencies, '{}'), g.target_level,
         coalesce(c.issued_on, r.decided_at::date, p.ends_on), c.code
    from training_enrollments e
    join training_plans p on p.id = e.plan_id
    left join training_results r on r.plan_id = e.plan_id and r.teacher_id = e.teacher_id
    left join lateral (select c.code, c.issued_on from certificates c
                        where c.plan_id = e.plan_id and c.teacher_id = e.teacher_id and c.status = 'issued'
                          and (c.expires_on is null or c.expires_on >= current_date)
                        order by c.issued_on desc nulls last limit 1) c on true
    join training_plan_items i on i.plan_id = e.plan_id
    join training_programs g on g.id = i.program_id
    join training_program_edu l on l.training_family = g.family_id
   where e.teacher_id = any(p_teachers) and (r.result = 'pass' or c.code is not null)
$$;
revoke all on function public.teacher_edu_met(uuid[]) from public, anon, authenticated;

create or replace function public.teacher_edu_programs(p_teacher uuid)
returns table (edu_family uuid, edu_id uuid, code text, title text, kind text, ct_code text, level text, grade_from int, grade_to int,
               main_subject text, met_on date, via jsonb, competencies jsonb)
language sql stable security definer set search_path = public as $$
  select m.edu_family, h.id, h.code, h.title, h.kind, h.ct_code, h.level, h.grade_from, h.grade_to, h.main_subject, max(m.met_on),
         jsonb_agg(distinct jsonb_build_object('plan', m.plan_name, 'program', m.program_title, 'date', m.met_on, 'cert', m.cert_code)),
         (select coalesce(jsonb_object_agg(k, lv), '{}'::jsonb) from (
            select k, max(m2.target_level) lv from public.teacher_edu_met(array[p_teacher]) m2 cross join lateral unnest(m2.competencies) k
             where m2.edu_family = m.edu_family group by k) z)
    from public.teacher_edu_met(array[p_teacher]) m
    cross join lateral public.edu_family_head(m.edu_family) h
   where public.can_view_teacher(p_teacher) and h.id is not null
   group by m.edu_family, h.id, h.code, h.title, h.kind, h.ct_code, h.level, h.grade_from, h.grade_to, h.main_subject
   order by h.title
$$;
revoke all on function public.teacher_edu_programs(uuid) from public, anon;
grant execute on function public.teacher_edu_programs(uuid) to authenticated;

create or replace function public.edu_program_readiness()
returns table (org_id uuid, org_name text, org_level text, edu_family uuid, code text, title text, kind text, ct_code text,
               assigned boolean, teachers int, met int, met_list jsonb, suggest jsonb)
language sql stable security definer set search_path = public as $$
  with sch as (
    select o.id, o.name, o.level from organizations o
     where o.type = 'school'
       and (public.is_platform_admin() or ((public.is_authority() or public.is_admin() or public.has_perm('training', 'edit')) and o.id in (select public.my_org_tree())))),
  tch as (select t.id, t.full_name, t.org_id from teachers t join sch on sch.id = t.org_id where coalesce(t.status, 'active') = 'active'),
  met as (select * from public.teacher_edu_met(array(select id from tch))),
  asg as (select distinct a.org_id, coalesce(e.family_id, e.id) fam from edu_program_assignments a join sch on sch.id = a.org_id
           join edu_programs e on e.id = a.program_id where e.status in ('published', 'superseded')),
  pairs as (select org_id, fam from asg
            union select t.org_id, m.edu_family from met m join tch t on t.id = m.teacher_id)
  select s.id, s.name, s.level, pr.fam, h.code, h.title, h.kind, h.ct_code,
         exists (select 1 from asg a where a.org_id = pr.org_id and a.fam = pr.fam),
         (select count(*)::int from tch t where t.org_id = pr.org_id),
         (select count(distinct m.teacher_id)::int from met m join tch t on t.id = m.teacher_id where t.org_id = pr.org_id and m.edu_family = pr.fam),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'via', x.via, 'date', x.d) order by x.full_name) from (
            select t.id, t.full_name, string_agg(distinct m.program_title, '; ') via, max(m.met_on) d
              from met m join tch t on t.id = m.teacher_id where t.org_id = pr.org_id and m.edu_family = pr.fam group by t.id, t.full_name) x), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'title', g.title) order by g.code)
            from training_programs g join training_program_edu l on l.training_family = g.family_id
           where l.edu_family = pr.fam and g.status = 'published'), '[]'::jsonb)
    from pairs pr join sch s on s.id = pr.org_id
    cross join lateral public.edu_family_head(pr.fam) h
   where h.id is not null
   order by s.name, h.title
$$;
revoke all on function public.edu_program_readiness() from public, anon;
grant execute on function public.edu_program_readiness() to authenticated;

notify pgrst, 'reload schema';
