-- 115. Đáp ứng chương trình: trường dạy những chương trình STEM nào (CT1–CT5), giáo viên được phân công có đủ chuẩn không.
--  • Mỗi dòng: một trường × một loại chương trình mà trường đang dạy (lớp học theo chương trình, chương trình giáo dục STEM
--    đã ban hành được gán cho trường) hoặc đã phân công giáo viên.
--  • GV được phân công dạy (stem_teacher_programs) được tính là ĐẠT CHUẨN khi:
--      (1) có chứng chỉ tập huấn đã cấp, còn hạn, của một chương trình tập huấn cùng loại (ct_codes), hoặc
--      (2) đạt mọi năng lực đích (mức đích) của một chương trình tập huấn cùng loại đã phát hành, theo mức năng lực hiệu lực
--          (trường đánh giá / tự đánh giá đã nộp, chứng chỉ đã cấp) của năm học được chọn, chưa có thì lần đánh giá gần nhất.
--  • Kèm chương trình tập huấn gợi ý (cùng loại, cùng cấp học) để lập kế hoạch tập huấn cho GV chưa đạt chuẩn.
--  • Phạm vi xem: quản trị nền tảng; cấp quản lý, quản trị trường hoặc người có quyền sửa tập huấn, trong cây đơn vị của mình
--    (giáo viên không xem mức đạt chuẩn của đồng nghiệp).
-- Cần chạy sau 114.

-- Mức hiệu lực của một năng lực: năm học được chọn, chưa có thì năm gần nhất GV có đánh giá
create or replace function public.teacher_level_for(p_teacher uuid, p_comp text, p_year text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(public.teacher_effective_level(p_teacher, p_comp, coalesce(p_year, '')),
                  public.teacher_effective_level(p_teacher, p_comp, (select max(a.school_year) from teacher_assessments a
                                                                       where a.teacher_id = p_teacher and a.status = 'submitted')), 0)
$$;
revoke all on function public.teacher_level_for(uuid, text, text) from public, anon, authenticated;

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
                                         where public.teacher_level_for(a.tid, k.comp, p_year) < g.target_level order by cm.sort) miss
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
revoke all on function public.program_readiness(text) from public, anon;
grant execute on function public.program_readiness(text) to authenticated;

notify pgrst, 'reload schema';
