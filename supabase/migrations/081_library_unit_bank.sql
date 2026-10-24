-- 081. Bài học: thẻ 05 Kho hoạt động (Phân hệ 2 · Học liệu, 24/10)
--  Bộ học liệu thành 5 thẻ: 01 Thông tin · 02 Nội dung · 03 Link tài liệu · 04 Định mức vật tư · 05 Kho hoạt động.
--    kit.bank  05 Kho hoạt động: hoạt động tương tác dùng trong bài (tên, loại, dùng ở hoạt động nào, ghi chú,
--              activity_id khi đã có trong bảng activities; chốt thẻ thì dòng chưa có tự tạo bản nháp trong kho)
--  checked nhận thêm 'bank'; sửa kit.bank khi thẻ đã chốt thì thẻ về "Cần kiểm tra"; phát hành cần chốt đủ 5 thẻ.
-- Cần chạy sau 080.

create or replace function public.library_unit_checked(v jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(k order by array_position(array['info', 'content', 'links', 'norms', 'bank'], k)), '[]'::jsonb)
    from (select distinct k from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) k
           where k in ('info', 'content', 'links', 'norms', 'bank')) d
$$;

create or replace function public.library_items_unit_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_checked jsonb; v_kit jsonb; o_kit jsonb;
begin
  if new.kind = 'unit' then
    v_checked := public.library_unit_checked(new.content->'checked');
    -- Lưu không kèm kit (form cũ) thì giữ kit đang có
    v_kit := case when jsonb_typeof(new.content->'kit') = 'object' then new.content->'kit'
                  when tg_op = 'UPDATE' and not (new.content ? 'kit') and jsonb_typeof(old.content->'kit') = 'object' then old.content->'kit'
                  else '{}'::jsonb end;
    if octet_length(v_kit::text) > 600000 then
      raise exception 'Nội dung bộ học liệu quá lớn (tối đa khoảng 600 KB chữ)' using errcode = '22023';
    end if;
    new.content := jsonb_build_object(
      'objectives', nullif(btrim(coalesce(new.content->>'objectives', '')), ''),
      'periods', case when coalesce(new.content->>'periods', '') ~ '^\d{1,3}$' then (new.content->>'periods')::int else null end,
      'plan_ids', public.library_unit_ids(new.content->'plan_ids'),
      'lesson_ids', public.library_unit_ids(new.content->'lesson_ids'),
      'norm_ids', public.library_unit_ids(new.content->'norm_ids'),
      'material_ids', public.library_unit_ids(new.content->'material_ids'),
      'kit', v_kit);
    -- Thẻ đã chốt bị sửa → về "Cần kiểm tra" (trừ khi lần lưu này cũng đổi trạng thái chốt)
    if tg_op = 'UPDATE' and old.kind = 'unit' and v_checked = public.library_unit_checked(old.content->'checked') then
      o_kit := case when jsonb_typeof(old.content->'kit') = 'object' then old.content->'kit' else '{}'::jsonb end;
      if (new.title, new.subject, new.grades, new.program_id, new.unit_id, new.content->>'objectives', new.content->>'periods', v_kit->'info')
         is distinct from (old.title, old.subject, old.grades, old.program_id, old.unit_id, nullif(btrim(coalesce(old.content->>'objectives', '')), ''), old.content->>'periods', o_kit->'info') then
        v_checked := v_checked - 'info';
      end if;
      if (new.content->'plan_ids', new.content->'lesson_ids', v_kit->'sessions')
         is distinct from (public.library_unit_ids(old.content->'plan_ids'), public.library_unit_ids(old.content->'lesson_ids'), o_kit->'sessions') then
        v_checked := v_checked - 'content';
      end if;
      if (new.content->'material_ids', v_kit->'docs') is distinct from (public.library_unit_ids(old.content->'material_ids'), o_kit->'docs') then
        v_checked := v_checked - 'links';
      end if;
      if (new.content->'norm_ids', v_kit->'mats') is distinct from (public.library_unit_ids(old.content->'norm_ids'), o_kit->'mats') then
        v_checked := v_checked - 'norms';
      end if;
      if v_kit->'bank' is distinct from o_kit->'bank' then
        v_checked := v_checked - 'bank';
      end if;
    end if;
    new.content := new.content || jsonb_build_object('checked', v_checked);
    if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published' or new.version is distinct from old.version)
       and jsonb_array_length(v_checked) < 5 then
      raise exception 'Bài học cần chốt đủ 5 thẻ (thông tin, nội dung, link tài liệu, định mức vật tư, kho hoạt động) trước khi phát hành' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
