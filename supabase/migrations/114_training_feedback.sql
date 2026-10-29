-- 114. Phiếu đánh giá sau khoá tập huấn: mức hài lòng của giáo viên và đánh giá giảng viên.
--  • Giáo viên có tên trong kế hoạch đã phát hành chấm 1–5 cho 6 tiêu chí của khoá (nội dung, phương pháp, tổ chức, tài liệu,
--    khả năng áp dụng, hài lòng chung) và 3 tiêu chí cho từng giảng viên của kế hoạch (chuyên môn, truyền đạt, tương tác), kèm góp ý.
--    Phiếu mở khi khoá đã kết thúc (ngày kết thúc ≤ hôm nay) hoặc giáo viên đã có kết quả Đạt / Chưa đạt. Gửi lại thì ghi đè.
--  • Giáo viên chỉ đọc phiếu của mình; ghi qua hàm. Tổng hợp không kèm tên người đánh giá.
--  • Tổng hợp theo kế hoạch × trường: phạm vi xem giống training_monitor. Điểm giảng viên: đơn vị quản lý danh sách giảng viên.
-- Cần chạy sau 113.

create table if not exists training_feedback (
  plan_id uuid not null references training_plans(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  content int not null check (content between 1 and 5),
  method int not null check (method between 1 and 5),
  organize int not null check (organize between 1 and 5),
  materials int not null check (materials between 1 and 5),
  applicable int not null check (applicable between 1 and 5),
  overall int not null check (overall between 1 and 5),
  comment text check (comment is null or length(comment) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, teacher_id)
);
create table if not exists training_trainer_feedback (
  plan_id uuid not null references training_plans(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  expertise int not null check (expertise between 1 and 5),
  delivery int not null check (delivery between 1 and 5),
  interaction int not null check (interaction between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (plan_id, teacher_id, trainer_id)
);
create index if not exists training_trainer_feedback_trainer on training_trainer_feedback (trainer_id);

alter table training_feedback enable row level security;
alter table training_trainer_feedback enable row level security;
drop policy if exists training_feedback_own on training_feedback;
create policy training_feedback_own on training_feedback for select to authenticated using (teacher_id = public.my_teacher_id());
drop policy if exists training_trainer_feedback_own on training_trainer_feedback;
create policy training_trainer_feedback_own on training_trainer_feedback for select to authenticated using (teacher_id = public.my_teacher_id());
revoke all on training_feedback, training_trainer_feedback from anon, authenticated;
grant select on training_feedback, training_trainer_feedback to authenticated;

-- Giảng viên của kế hoạch: gộp từ chương trình trong kế hoạch và các buổi tập huấn
create or replace function public.training_plan_trainers(p_plan uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select unnest(trainer_ids) x from training_plan_items where plan_id = p_plan
    union select unnest(trainer_ids) from training_sessions where plan_id = p_plan) t
$$;
revoke all on function public.training_plan_trainers(uuid) from public, anon, authenticated;

create or replace function public.training_feedback_is_open(p_plan uuid, p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from training_plans p where p.id = p_plan and p.ends_on is not null and p.ends_on <= current_date)
      or exists (select 1 from training_results r where r.plan_id = p_plan and r.teacher_id = p_teacher and r.result in ('pass', 'fail'))
$$;
revoke all on function public.training_feedback_is_open(uuid, uuid) from public, anon, authenticated;

-- Điểm 1–5 trong phiếu
create or replace function public.training_feedback_score(j jsonb, k text) returns int
language plpgsql immutable set search_path = public as $$
begin
  if coalesce(jsonb_typeof(j -> k), '') <> 'number' or (j ->> k)::numeric not in (1, 2, 3, 4, 5) then
    raise exception 'Mỗi tiêu chí chấm từ 1 đến 5 điểm' using errcode = '22023';
  end if;
  return (j ->> k)::int;
end $$;
revoke all on function public.training_feedback_score(jsonb, text) from public, anon, authenticated;

-- Phiếu của giáo viên: đã mở chưa, phiếu đã gửi, danh sách giảng viên kèm điểm đã chấm
create or replace function public.training_feedback_form(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan);
begin
  return jsonb_build_object(
    'open', public.training_feedback_is_open(p_plan, v_teacher),
    'mine', (select to_jsonb(f) - 'teacher_id' - 'org_id' - 'plan_id' from training_feedback f where f.plan_id = p_plan and f.teacher_id = v_teacher),
    'trainers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.full_name, 'title', t.title, 'workplace', t.workplace,
        'mine', (select jsonb_build_object('expertise', g.expertise, 'delivery', g.delivery, 'interaction', g.interaction, 'comment', g.comment)
                   from training_trainer_feedback g where g.plan_id = p_plan and g.teacher_id = v_teacher and g.trainer_id = t.id))
        order by t.full_name)
      from trainers t where t.id = any(public.training_plan_trainers(p_plan))), '[]'::jsonb));
end $$;
revoke all on function public.training_feedback_form(uuid) from public, anon;
grant execute on function public.training_feedback_form(uuid) to authenticated;

-- Gửi phiếu. p_scores: {content, method, organize, materials, applicable, overall};
-- p_trainers: [{id, expertise, delivery, interaction, comment}] — chỉ giảng viên của kế hoạch.
create or replace function public.training_feedback_submit(p_plan uuid, p_scores jsonb, p_comment text default null, p_trainers jsonb default '[]')
returns void language plpgsql security definer set search_path = public as $$
declare v_teacher uuid := public.training_learner(p_plan); v_org uuid; v_tr uuid[]; e jsonb; v_id uuid;
begin
  if not public.training_feedback_is_open(p_plan, v_teacher) then
    raise exception 'Phiếu đánh giá mở khi khoá tập huấn kết thúc' using errcode = '22023';
  end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then raise exception 'Phiếu đánh giá không hợp lệ' using errcode = '22023'; end if;
  if length(coalesce(p_comment, '')) > 2000 then raise exception 'Góp ý tối đa 2000 ký tự' using errcode = '22023'; end if;
  select org_id into v_org from teachers where id = v_teacher;
  insert into training_feedback (plan_id, teacher_id, org_id, content, method, organize, materials, applicable, overall, comment)
  values (p_plan, v_teacher, v_org,
    public.training_feedback_score(p_scores, 'content'), public.training_feedback_score(p_scores, 'method'),
    public.training_feedback_score(p_scores, 'organize'), public.training_feedback_score(p_scores, 'materials'),
    public.training_feedback_score(p_scores, 'applicable'), public.training_feedback_score(p_scores, 'overall'),
    nullif(btrim(p_comment), ''))
  on conflict (plan_id, teacher_id) do update set content = excluded.content, method = excluded.method, organize = excluded.organize,
    materials = excluded.materials, applicable = excluded.applicable, overall = excluded.overall, comment = excluded.comment,
    org_id = excluded.org_id, updated_at = now();

  if p_trainers is null or jsonb_typeof(p_trainers) <> 'array' or jsonb_array_length(p_trainers) > 40 then
    raise exception 'Đánh giá giảng viên không hợp lệ' using errcode = '22023';
  end if;
  v_tr := public.training_plan_trainers(p_plan);
  for e in select * from jsonb_array_elements(p_trainers) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'id', '') !~ '^[0-9a-f-]{36}$' or not ((e ->> 'id')::uuid = any(v_tr)) then
      raise exception 'Giảng viên không thuộc kế hoạch tập huấn này' using errcode = '22023';
    end if;
    if length(coalesce(e ->> 'comment', '')) > 1000 then raise exception 'Góp ý cho giảng viên tối đa 1000 ký tự' using errcode = '22023'; end if;
    v_id := (e ->> 'id')::uuid;
    insert into training_trainer_feedback (plan_id, teacher_id, trainer_id, org_id, expertise, delivery, interaction, comment)
    values (p_plan, v_teacher, v_id, v_org, public.training_feedback_score(e, 'expertise'), public.training_feedback_score(e, 'delivery'),
      public.training_feedback_score(e, 'interaction'), nullif(btrim(e ->> 'comment'), ''))
    on conflict (plan_id, teacher_id, trainer_id) do update set expertise = excluded.expertise, delivery = excluded.delivery,
      interaction = excluded.interaction, comment = excluded.comment, org_id = excluded.org_id, updated_at = now();
  end loop;
end $$;
revoke all on function public.training_feedback_submit(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.training_feedback_submit(uuid, jsonb, text, jsonb) to authenticated;

-- Ai được xem tổng hợp phiếu của một trường trong một kế hoạch (giống training_monitor)
create or replace function public.training_feedback_can_view(p_plan uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or public.training_plan_can_manage(p_plan)
      or ((public.is_authority() or public.has_perm('training', 'view')) and p_org in (select public.my_org_tree()))
$$;
revoke all on function public.training_feedback_can_view(uuid, uuid) from public, anon, authenticated;

-- Tổng hợp mức hài lòng theo kế hoạch × trường được gán
create or replace function public.training_feedback_stats(p_year text default null)
returns table (plan_id uuid, org_id uuid, enrolled int, responses int, content numeric, method numeric, organize numeric,
               materials numeric, applicable numeric, overall numeric, comments int)
language sql stable security definer set search_path = public as $$
  select p.id, o.org_id,
         (select count(*)::int from training_enrollments en join teachers t on t.id = en.teacher_id where en.plan_id = p.id and t.org_id = o.org_id),
         count(f.teacher_id)::int, round(avg(f.content), 2), round(avg(f.method), 2), round(avg(f.organize), 2),
         round(avg(f.materials), 2), round(avg(f.applicable), 2), round(avg(f.overall), 2), count(f.comment)::int
    from training_plans p
    join training_plan_orgs o on o.plan_id = p.id
    left join training_feedback f on f.plan_id = p.id and f.org_id = o.org_id
   where p.pub_status <> 'draft' and (p_year is null or p.year_name = p_year)
     and public.training_feedback_can_view(p.id, o.org_id)
   group by p.id, o.org_id
$$;
revoke all on function public.training_feedback_stats(text) from public, anon;
grant execute on function public.training_feedback_stats(text) to authenticated;

-- Góp ý (không kèm tên người viết) của một kế hoạch, lọc theo trường nếu cần
create or replace function public.training_feedback_comments(p_plan uuid, p_org uuid default null)
returns table (org_name text, kind text, trainer_name text, score numeric, comment text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select og.name, 'course'::text, null::text, f.overall::numeric, f.comment, f.updated_at
      from training_feedback f join organizations og on og.id = f.org_id
     where f.plan_id = p_plan and f.comment is not null and (p_org is null or f.org_id = p_org)
       and public.training_feedback_can_view(p_plan, f.org_id)
    union all
    select og.name, 'trainer', concat_ws(' ', t.title, t.full_name), round((g.expertise + g.delivery + g.interaction) / 3.0, 1), g.comment, g.updated_at
      from training_trainer_feedback g join organizations og on og.id = g.org_id join trainers t on t.id = g.trainer_id
     where g.plan_id = p_plan and g.comment is not null and (p_org is null or g.org_id = p_org)
       and public.training_feedback_can_view(p_plan, g.org_id)) x
   order by 6 desc
   limit 300
$$;
revoke all on function public.training_feedback_comments(uuid, uuid) from public, anon;
grant execute on function public.training_feedback_comments(uuid, uuid) to authenticated;

-- Điểm từng giảng viên: chỉ đơn vị quản lý danh sách giảng viên (và quản trị nền tảng) xem
create or replace function public.trainer_feedback_stats(p_year text default null)
returns table (trainer_id uuid, responses int, plans int, expertise numeric, delivery numeric, interaction numeric, overall numeric)
language sql stable security definer set search_path = public as $$
  select g.trainer_id, count(*)::int, count(distinct g.plan_id)::int, round(avg(g.expertise), 2), round(avg(g.delivery), 2),
         round(avg(g.interaction), 2), round(avg((g.expertise + g.delivery + g.interaction) / 3.0), 2)
    from training_trainer_feedback g
    join trainers t on t.id = g.trainer_id
    join training_plans p on p.id = g.plan_id
   where (public.is_platform_admin() or public.training_can_write(t.org_id))
     and (p_year is null or p.year_name = p_year)
   group by g.trainer_id
$$;
revoke all on function public.trainer_feedback_stats(text) from public, anon;
grant execute on function public.trainer_feedback_stats(text) to authenticated;

notify pgrst, 'reload schema';
