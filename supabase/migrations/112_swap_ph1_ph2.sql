-- 112. Đổi thứ tự hai phân hệ: 1 = Chương trình & học liệu, 2 = Đào tạo & đánh giá năng lực nhà giáo.
--  • Chỉ đổi tên hiển thị và thứ tự của gói (service_modules). Mã gói giữ nguyên (ph1 = đào tạo, ph2 = chương trình)
--    để không ảnh hưởng gói dịch vụ, hợp đồng và số liệu sử dụng đã có.
-- Cần chạy sau 111.
update service_modules set name = 'PH1. Chương trình & học liệu', sort = 1 where key = 'ph2';
update service_modules set name = 'PH2. Đào tạo & đánh giá năng lực nhà giáo', sort = 2 where key = 'ph1';
