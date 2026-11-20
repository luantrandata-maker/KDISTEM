-- 165: Nội dung chủ đề (164) thêm:
-- • exam_id: bài kiểm tra gắn đề có sẵn (practice_exams) thay cho tải file.
-- • content: phần tách được từ giáo án Word / bài giảng PowerPoint (các hoạt động dạy học, danh sách slide, vật tư dùng lại…).
-- • Vật tư tính theo 1 sản phẩm (per = 'product'), như cách giáo án KDI ghi định mức.
-- Cần chạy sau 164.

alter table program_topic_items add column if not exists exam_id uuid references practice_exams(id) on delete set null;
alter table program_topic_items add column if not exists content jsonb;
alter table program_topic_items drop constraint if exists program_topic_items_per_check;
alter table program_topic_items add constraint program_topic_items_per_check check (per is null or per in ('student', 'group', 'class', 'product'));
comment on column program_topic_items.exam_id is 'Bài kiểm tra: đề có sẵn trong E-learning & luyện thi (165)';
comment on column program_topic_items.content is 'Phần tách từ giáo án / bài giảng: {steps, sections, slides, reusable…} (165)';

create or replace function public.program_topic_items_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.title := btrim(new.title); new.detail := btrim(coalesce(new.detail, ''));
  new.url := nullif(btrim(coalesce(new.url, '')), ''); new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  if new.kind <> 'material' then new.material_group_id := null; new.qty := null; new.unit := null; new.per := null; end if;
  if new.kind <> 'test' then new.exam_id := null; end if;
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

notify pgrst, 'reload schema';
