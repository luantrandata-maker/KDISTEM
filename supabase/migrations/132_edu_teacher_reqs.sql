-- 132. Yêu cầu năng lực giáo viên của chương trình giáo dục (04/11).
--  • edu_program_teacher_reqs: mỗi họ chương trình giáo dục ghi các năng lực (khung năng lực giáo viên) và mức tối thiểu người dạy cần có.
--    Gắn theo họ phiên bản nên phiên bản mới vẫn giữ yêu cầu.
--  • edu_program_set_teacher_reqs(p_program, p_reqs): đặt lại danh sách yêu cầu; người sửa được chương trình giáo dục (hoặc KDI) mới đặt được.
--  • Giáo viên ĐÁP ỨNG chương trình giáo dục khi có một trong hai:
--      (1) Đạt khoá đào tạo có chương trình đào tạo gắn với chương trình giáo dục đó (như 124), hoặc
--      (2) mức năng lực đạt đủ mọi mức tối thiểu ở trên. Mức mỗi năng lực lấy mức cao hơn giữa lần trường đánh giá gần nhất
--          (đã lưu) và mức đích của các khoá đào tạo đã Đạt, cộng dồn qua mọi đợt. Tự đánh giá không tính.
--    Việc gắn chương trình giáo dục vào chương trình đào tạo vẫn không bắt buộc.
-- Cần chạy sau 124.

create table if not exists edu_program_teacher_reqs (
  edu_family uuid not null,
  competency text not null references competencies(key) on update cascade on delete cascade,
  min_level int not null check (min_level between 1 and 4),
  created_at timestamptz not null default now(),
  primary key (edu_family, competency)
);
alter table edu_program_teacher_reqs enable row level security;
drop policy if exists edu_program_teacher_reqs_read on edu_program_teacher_reqs;
create policy edu_program_teacher_reqs_read on edu_program_teacher_reqs for select to authenticated using (true);
-- Ghi qua hàm bên dưới (không cho ghi thẳng)

create or replace function public.edu_program_set_teacher_reqs(p_program uuid, p_reqs jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_fam uuid; n int;
begin
  select org_id, coalesce(family_id, id) into v_org, v_fam from edu_programs where id = p_program;
  if not public.is_platform_admin() and (v_org is null or not public.curriculum_can_write(v_org, 'edit')) then
    raise exception 'Bạn không có quyền sửa chương trình giáo dục này' using errcode = '42501';
  end if;
  if v_fam is null then raise exception 'Không tìm thấy chương trình giáo dục' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_reqs, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_reqs, '[]'::jsonb)) > 50 then
    raise exception 'Danh sách yêu cầu không hợp lệ' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_reqs, '[]'::jsonb)) x
              where not exists (select 1 from competencies c where c.key = x->>'competency' and c.audience = 'teacher')
                 or coalesce((x->>'min_level')::int, 0) not between 1 and 4) then
    raise exception 'Chọn năng lực trong khung năng lực giáo viên và mức từ 1 đến 4' using errcode = '22023';
  end if;
  delete from edu_program_teacher_reqs where edu_family = v_fam;
  insert into edu_program_teacher_reqs (edu_family, competency, min_level)
    select v_fam, x->>'competency', max((x->>'min_level')::int)
      from jsonb_array_elements(coalesce(p_reqs, '[]'::jsonb)) x group by x->>'competency';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.edu_program_set_teacher_reqs(uuid, jsonb) from public, anon;
grant execute on function public.edu_program_set_teacher_reqs(uuid, jsonb) to authenticated;

-- Nội bộ: GV × chương trình giáo dục đáp ứng. Thêm đường (2): mức năng lực đạt đủ yêu cầu.
-- Mức của mỗi năng lực = mức cao hơn giữa lần trường đánh giá gần nhất (đã lưu) và mức đích của các khoá đào tạo đã Đạt
-- (kết quả Đạt hoặc chứng chỉ còn hiệu lực), cộng dồn qua mọi đợt. Tự đánh giá không tính.
create or replace function public.teacher_edu_met(p_teachers uuid[])
returns table (teacher_id uuid, edu_family uuid, plan_id uuid, plan_name text, program_id uuid, program_title text,
               competencies text[], target_level int, met_on date, cert_code text)
language sql stable security definer set search_path = public as $$
  with passed as (   -- khoá đào tạo GV đã Đạt
    select e.teacher_id, p.id plan_id, p.name plan_name, g.id program_id, g.title, g.family_id, coalesce(g.competencies, '{}') comps, g.target_level,
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
      select pa.teacher_id, k.comp, pa.target_level from passed pa cross join lateral unnest(pa.comps) k(comp) where pa.target_level is not null) z
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
revoke all on function public.teacher_edu_met(uuid[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
