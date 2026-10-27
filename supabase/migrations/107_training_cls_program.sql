-- 107. Khung phân loại kế hoạch tập huấn: mặc định chỉ một cấp "Chương trình" (thay Môn học › Cấp độ của 103).
--  • Cấp gốc (kind 'subject') đổi tên "Môn học" thành "Chương trình". Cấp vẫn luôn bật, không xoá.
--  • Cấp "Cấp độ" (kind 'tier') tắt đi. KDI bật lại được trong "Cấu hình cấp". Khi cấp này tắt, thêm chương trình
--    không tự sinh Cơ bản / Nâng cao (trigger 103 chỉ chạy khi cấp độ đang bật).
--  • Kế hoạch đang gắn vào mục Cơ bản / Nâng cao chuyển lên mục cha (chương trình) để vẫn nằm đúng chỗ trong cây.
-- Cần chạy sau 103.

do $$
declare v_tier uuid;
begin
  update training_cls_levels set name = 'Chương trình' where kind = 'subject' and name = 'Môn học';
  select id into v_tier from training_cls_levels where kind = 'tier' and active;
  if v_tier is null then return; end if;
  update training_plans k set node_id = n.parent_id
    from training_nodes n where n.id = k.node_id and n.cls_level_id = v_tier and n.parent_id is not null;
  update training_cls_levels set active = false where id = v_tier;
end $$;

notify pgrst, 'reload schema';
