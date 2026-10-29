-- 119. Hồ sơ năng lực GV: lịch sử tập huấn đầy đủ và số liệu tiến bộ qua các năm.
--  • teacher_training_history(p_teacher): mỗi kế hoạch GV có tên (ghi danh) → đợt, số giờ, chuyên cần, kết quả, điểm, xếp loại,
--    chứng chỉ, các chương trình (năng lực đích, mức đích). Người xem: chính GV, quản trị trường của GV, Sở / Phòng quản lý, KDI.
--  • Tiến bộ theo năm học: giao diện ghép lịch sử này với teacher_assessments (RLS sẵn có) → mức tự đánh giá / trường đánh giá /
--    mức đạt qua tập huấn theo từng năng lực, cộng số khoá và giờ bồi dưỡng mỗi năm.
-- Cần chạy sau 118.

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

notify pgrst, 'reload schema';
