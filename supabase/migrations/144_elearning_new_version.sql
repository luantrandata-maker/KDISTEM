-- 144: E-learning đã công bố muốn sửa thì "phát hành bản mới"
--  • practice_exams.replaces_id / courses.replaces_id: bản nháp mới thay cho bản nào.
--  • Khi bản nháp có replaces_id được công bố: bản cũ tự đóng (đề luyện → closed) / lưu trữ (khoá học → archived).
--    Kết quả làm bài và tiến độ học của bản cũ giữ nguyên ở bản cũ.

alter table practice_exams add column if not exists replaces_id uuid references practice_exams(id) on delete set null;
alter table courses add column if not exists replaces_id uuid references courses(id) on delete set null;
create index if not exists practice_exams_replaces on practice_exams (replaces_id) where replaces_id is not null;
create index if not exists courses_replaces on courses (replaces_id) where replaces_id is not null;

create or replace function public.elearning_retire_replaced() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' and new.replaces_id is not null then
    if tg_table_name = 'practice_exams' then
      update practice_exams set status = 'closed' where id = new.replaces_id and status = 'published';
    else
      update courses set status = 'archived' where id = new.replaces_id and status = 'published';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists practice_exams_retire_replaced on practice_exams;
create trigger practice_exams_retire_replaced after update of status on practice_exams
  for each row execute function public.elearning_retire_replaced();
drop trigger if exists courses_retire_replaced on courses;
create trigger courses_retire_replaced after update of status on courses
  for each row execute function public.elearning_retire_replaced();
