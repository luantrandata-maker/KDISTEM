-- 102. Bài giảng tập huấn soạn như bài học: bộ 5 thẻ (Thông tin · Nội dung · Link tài liệu · Định mức vật tư · Kho hoạt động)
--  • training_lessons.content: cùng cấu trúc với library_items.content của bài học ({ kit, checked[], periods, objectives }).
--  • program_id / unit_id: gắn bài giảng vào chương trình tập huấn và một nội dung trong chương trình.
--  • version: tăng mỗi lần phát hành; updated_at: lần sửa gần nhất.
--  • Số khối nội dung, học liệu, video, tài liệu (cột cũ) tự tính từ 5 thẻ để các màn hình cũ vẫn đúng.
--  • Giáo viên thấy bài giảng đã phát hành của kế hoạch mình tham gia, kể cả bài gắn theo chương trình trong kế hoạch.

alter table training_lessons
  add column if not exists content jsonb not null default '{}'::jsonb,
  add column if not exists version int not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists program_id uuid references training_programs(id) on delete set null,
  add column if not exists unit_id uuid references training_program_units(id) on delete set null;
alter table training_lessons drop constraint if exists training_lessons_content_check;
alter table training_lessons add constraint training_lessons_content_check
  check (jsonb_typeof(content) = 'object' and pg_column_size(content) < 1000000);
create index if not exists training_lessons_program on training_lessons (program_id);

create or replace function public.training_lessons_kit() returns trigger
language plpgsql set search_path = public as $$
declare k jsonb := coalesce(new.content -> 'kit', '{}'::jsonb);
begin
  new.title := btrim(new.title);
  new.updated_at := now();
  -- Chỉ kiểm khi chọn lại nội dung (xoá chương trình thì program_id, unit_id cùng về null, không chặn)
  if new.unit_id is not null and (tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id) and new.program_id is null then
    select program_id into new.program_id from training_program_units where id = new.unit_id;
  end if;
  if new.unit_id is not null and (tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id or new.program_id is distinct from old.program_id)
     and new.program_id is not null and not exists (select 1 from training_program_units where id = new.unit_id and program_id = new.program_id) then
    raise exception 'Nội dung không thuộc chương trình tập huấn đã chọn' using errcode = '22023';
  end if;
  if jsonb_typeof(k) = 'object' and k <> '{}'::jsonb then
    new.blocks := coalesce((select sum(jsonb_array_length(coalesce(s -> 'acts', '[]'::jsonb)))
      from jsonb_array_elements(case when jsonb_typeof(k -> 'sessions') = 'array' then k -> 'sessions' else '[]'::jsonb end) s), 0);
    new.materials := coalesce(jsonb_array_length(case when jsonb_typeof(k #> '{mats,product}') = 'array' then k #> '{mats,product}' else '[]'::jsonb end), 0)
                   + coalesce(jsonb_array_length(case when jsonb_typeof(k #> '{mats,group}') = 'array' then k #> '{mats,group}' else '[]'::jsonb end), 0);
    new.videos := (select count(*) from jsonb_array_elements(case when jsonb_typeof(k -> 'docs') = 'array' then k -> 'docs' else '[]'::jsonb end) d where d ->> 'type' = 'video');
    new.docs := (select count(*) from jsonb_array_elements(case when jsonb_typeof(k -> 'docs') = 'array' then k -> 'docs' else '[]'::jsonb end) d where d ->> 'type' <> 'video');
  end if;
  return new;
end $$;
drop trigger if exists training_lessons_kit on training_lessons;
create trigger training_lessons_kit before insert or update on training_lessons for each row execute function public.training_lessons_kit();

-- Phát hành: đủ 5 thẻ đã chốt, tăng phiên bản
create or replace function public.training_lesson_publish(p_id uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare v int; n int;
begin
  select jsonb_array_length(coalesce(content -> 'checked', '[]'::jsonb)) into n from training_lessons where id = p_id;
  if n is null then raise exception 'Không tìm thấy bài giảng' using errcode = '22023'; end if;
  if n < 5 then raise exception 'Chốt đủ 5 thẻ trước khi phát hành (đang %/5)', n using errcode = '22023'; end if;
  update training_lessons set status = 'published', version = version + 1 where id = p_id returning version into v;
  if v is null then raise exception 'Bạn không có quyền phát hành bài giảng này' using errcode = '42501'; end if;
  return v;
end $$;
grant execute on function public.training_lesson_publish(uuid) to authenticated;

-- Giáo viên: thêm bài gắn theo chương trình trong kế hoạch mình tham gia
create or replace function public.my_training_lessons()
returns table (id uuid, title text, grades text, subject text, author text, created_on date,
               blocks int, materials int, videos int, docs int, plan_id uuid, plan_name text, program text)
language sql stable security definer set search_path = public as $$
  with my_plans as (
    select plan_id from training_enrollments where teacher_id = public.my_teacher_id()
    union
    select s.plan_id from training_attendance a join training_sessions s on s.id = a.session_id
      where a.teacher_id = public.my_teacher_id()
  ), hit as (
    select l.*, coalesce(l.plan_id, (select i.plan_id from training_plan_items i
      where i.program_id = l.program_id and i.plan_id in (select plan_id from my_plans) order by i.plan_id limit 1)) as via
    from training_lessons l
    where l.status = 'published'
      and (l.plan_id in (select plan_id from my_plans)
        or l.program_id in (select i.program_id from training_plan_items i where i.plan_id in (select plan_id from my_plans)))
  )
  select h.id, h.title, h.grades, h.subject, h.author, h.created_on::date,
         h.blocks, h.materials, h.videos, h.docs, h.via, p.name, p.program
  from hit h left join training_plans p on p.id = h.via
  order by h.created_on desc
$$;
grant execute on function public.my_training_lessons() to authenticated;

notify pgrst, 'reload schema';
