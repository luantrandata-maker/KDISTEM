-- 077. Bộ học liệu 4 thẻ của bài học (Phân hệ 2 · Học liệu)
--  • Bài học trong kho (library_items.kind = 'unit', 065) được xem là bộ 4 thẻ:
--      info    01 Thông tin        tên, môn, khối, chương trình / bài, mục tiêu, số tiết
--      content 02 Nội dung bài học giáo án, bài giảng
--      links   03 Link học liệu    học liệu khác (tài liệu, video, đường dẫn…)
--      norms   04 Định mức vật tư  định mức gắn với bài
--    content.checked = các thẻ đã chốt. Thẻ chưa chốt là "Cần kiểm tra".
--  • Sửa một thẻ đã chốt (mà không đổi trạng thái chốt trong cùng lần lưu) thì thẻ đó tự về "Cần kiểm tra".
--  • Phát hành bài học cần chốt đủ 4 thẻ.
-- Cần chạy sau 065.

create or replace function public.library_unit_checked(v jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(k order by array_position(array['info', 'content', 'links', 'norms'], k)), '[]'::jsonb)
    from (select distinct k from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) k
           where k in ('info', 'content', 'links', 'norms')) d
$$;

create or replace function public.library_items_unit_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_checked jsonb;
begin
  if new.kind = 'unit' then
    v_checked := public.library_unit_checked(new.content->'checked');
    new.content := jsonb_build_object(
      'objectives', nullif(btrim(coalesce(new.content->>'objectives', '')), ''),
      'periods', case when coalesce(new.content->>'periods', '') ~ '^\d{1,3}$' then (new.content->>'periods')::int else null end,
      'plan_ids', public.library_unit_ids(new.content->'plan_ids'),
      'lesson_ids', public.library_unit_ids(new.content->'lesson_ids'),
      'norm_ids', public.library_unit_ids(new.content->'norm_ids'),
      'material_ids', public.library_unit_ids(new.content->'material_ids'));
    -- Thẻ đã chốt bị sửa → về "Cần kiểm tra" (trừ khi lần lưu này cũng đổi trạng thái chốt: người soạn đã tự quyết)
    if tg_op = 'UPDATE' and old.kind = 'unit' and v_checked = public.library_unit_checked(old.content->'checked') then
      if (new.title, new.subject, new.grades, new.program_id, new.unit_id, new.content->>'objectives', new.content->>'periods')
         is distinct from (old.title, old.subject, old.grades, old.program_id, old.unit_id, nullif(btrim(coalesce(old.content->>'objectives', '')), ''), old.content->>'periods') then
        v_checked := v_checked - 'info';
      end if;
      if (new.content->'plan_ids', new.content->'lesson_ids') is distinct from (public.library_unit_ids(old.content->'plan_ids'), public.library_unit_ids(old.content->'lesson_ids')) then
        v_checked := v_checked - 'content';
      end if;
      if new.content->'material_ids' is distinct from public.library_unit_ids(old.content->'material_ids') then v_checked := v_checked - 'links'; end if;
      if new.content->'norm_ids' is distinct from public.library_unit_ids(old.content->'norm_ids') then v_checked := v_checked - 'norms'; end if;
    end if;
    new.content := new.content || jsonb_build_object('checked', v_checked);
    if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published' or new.version is distinct from old.version)
       and jsonb_array_length(v_checked) < 4 then
      raise exception 'Bài học cần chốt đủ 4 thẻ (thông tin, nội dung, link học liệu, định mức vật tư) trước khi phát hành' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists library_items_unit_guard on library_items;
create trigger library_items_unit_guard before insert or update on library_items for each row execute function public.library_items_unit_guard();
