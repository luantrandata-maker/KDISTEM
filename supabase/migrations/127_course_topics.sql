-- 127: Chủ đề trong khoá học e-learning — khoá học → chủ đề → bài học.
--  • course_topics: chủ đề của khoá (tên, thứ tự). Đọc / sửa theo quyền của khoá (course_visible / course_manageable).
--  • course_lessons.topic_id: bài thuộc chủ đề nào (null = chưa xếp chủ đề). Xoá chủ đề thì bài giữ lại, về "chưa xếp chủ đề".

create table if not exists course_topics (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  position   int not null default 0,
  title      text not null check (length(btrim(title)) between 1 and 200)
);
create index if not exists course_topics_course on course_topics (course_id, position);
alter table course_topics enable row level security;
drop policy if exists course_topics_read on course_topics;
create policy course_topics_read on course_topics for select to authenticated using (public.course_visible(course_id));
drop policy if exists course_topics_write on course_topics;
create policy course_topics_write on course_topics for all to authenticated using (public.course_manageable(course_id)) with check (public.course_manageable(course_id));

alter table course_lessons add column if not exists topic_id uuid references course_topics(id) on delete set null;
create index if not exists course_lessons_topic on course_lessons (topic_id);

-- Chủ đề phải thuộc cùng khoá học với bài (giữ các kiểm tra tệp / học liệu của 061)
create or replace function public.guard_course_lesson() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid := (select org_id from courses where id = new.course_id);
begin
  if new.path is not null and public.learning_file_org(new.path) is distinct from v_org then
    raise exception 'Tệp bài học phải thuộc thư mục của đơn vị tạo khoá học' using errcode = '22023';
  end if;
  if new.library_item_id is not null and auth.uid() is not null and not public.library_visible(new.library_item_id) then
    raise exception 'Không tìm thấy học liệu' using errcode = '22023';
  end if;
  if new.topic_id is not null and not exists (select 1 from course_topics t where t.id = new.topic_id and t.course_id = new.course_id) then
    raise exception 'Chủ đề không thuộc khoá học này' using errcode = '22023';
  end if;
  return new;
end $$;
