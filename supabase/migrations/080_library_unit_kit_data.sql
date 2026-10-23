-- 080. Bài học soạn theo video demo (Phân hệ 2 · Học liệu, 23/10)
--  Bộ học liệu 4 thẻ giữ nội dung có cấu trúc trong content.kit (trước đây trigger 077 bỏ mọi khoá lạ):
--    kit.info      01 Thông tin bài học: môn trong chương trình, mô tả, môn chủ đạo / tích hợp kèm yêu cầu,
--                  yêu cầu cần đạt, được soạn / review / hiệu chỉnh (ngày, người)
--    kit.sessions  02 Nội dung bài học: buổi → hoạt động (phút, nội dung chung) → bước (các ý)
--    kit.docs      03 Link học liệu: tên, loại, đường dẫn / tệp, mục kho đã tạo khi chốt
--    kit.mats      04 Định mức vật tư: nguyên vật liệu cho 1 sản phẩm, công cụ thiết bị cho 1 nhóm
--    kit.issues    điểm cần kiểm tra ghi nhận khi tách giáo án; kit.source: tệp đã đọc
--  Lưu không kèm content.kit (form bài học cũ ở Danh mục học liệu) thì giữ nguyên kit đang có.
--  Sửa phần của một thẻ đã chốt (mà không đổi trạng thái chốt trong cùng lần lưu) thì thẻ đó tự về "Cần kiểm tra".
-- Cần chạy sau 077.

create or replace function public.library_items_unit_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_checked jsonb; v_kit jsonb; o_kit jsonb;
begin
  if new.kind = 'unit' then
    v_checked := public.library_unit_checked(new.content->'checked');
    -- Lưu không kèm kit (form cũ ở Danh mục học liệu) thì giữ kit đang có
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
    -- Thẻ đã chốt bị sửa → về "Cần kiểm tra" (trừ khi lần lưu này cũng đổi trạng thái chốt: người soạn đã tự quyết)
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
    end if;
    new.content := new.content || jsonb_build_object('checked', v_checked);
    if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published' or new.version is distinct from old.version)
       and jsonb_array_length(v_checked) < 4 then
      raise exception 'Bài học cần chốt đủ 4 thẻ (thông tin, nội dung, link học liệu, định mức vật tư) trước khi phát hành' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
