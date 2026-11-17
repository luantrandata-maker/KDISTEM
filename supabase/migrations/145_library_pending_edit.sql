-- 145: Sửa bài giảng / học liệu đã phát hành không ghi đè bản đang phát hành
--  • library_items.pending: bản sửa chưa phát hành (thông tin, nội dung, nơi nhận) của mục đã phát hành.
--    "Lưu bản sửa" chỉ ghi vào cột này; trường "Dùng" / xem vẫn nhận nội dung đang phát hành.
--    "Phát hành bản mới" chép bản sửa vào mục, xoá pending rồi gọi library_publish như cũ.
alter table library_items add column if not exists pending jsonb;
comment on column library_items.pending is 'Bản sửa chưa phát hành của mục đã phát hành (145)';
