-- 151: Dữ liệu test (19/11/2026) để xem trên hệ thống.
-- CT1 Bài học STEM, Khối 3: 16 chủ đề (35 tiết), thay 10 chủ đề mẫu "Chủ đề STEM n" của Khối 3.
-- CT2 học phần Sáng chế, Khối 6: 16 chủ đề theo tuần (Tink-G0.31 rồi Tink-G0.32), mỗi chủ đề 2 tiết, tổng 32 tiết.
-- Yêu cầu cần đạt, sản phẩm để trống, bổ sung khi có file đầy đủ.
do $$
declare ct1 uuid; sc uuid;
begin
  select id into ct1 from program_modules where track_code = 'CT1' order by sort limit 1;
  select id into sc from program_modules where track_code = 'CT2' and name = 'Sáng chế' limit 1;
  if ct1 is not null then
    delete from program_topics where module_id = ct1 and grade = 3;
    insert into program_topics (module_id, grade, seq, title, periods, main_subject, subjects)
    select ct1, 3, v.seq, v.title, v.periods, v.main_subject, v.subjects from (values
    (1, 'Thời gian biểu', 2, 'Hoạt động trải nghiệm', array['Mĩ thuật']),
    (2, 'Mô hình cứu hỏa mini (BH)', 2, 'Tự nhiên và Xã hội', array['Mĩ thuật']),
    (3, 'Đèn học sáng tạo (BH)', 3, 'Công nghệ', array['Mĩ thuật']),
    (4, 'Quạt điện mini (G3)', 3, 'Công nghệ', array['Mĩ thuật']),
    (5, 'Bảng nhân xoay (BH)', 2, 'Toán', array['Công nghệ']),
    (6, 'Chiếc cân thăng bằng', 2, 'Toán', array['Công nghệ']),
    (7, 'Sổ tay tình bạn', 2, 'Hoạt động trải nghiệm', array['Mĩ thuật']),
    (8, 'Sổ tay thực vật quanh em', 2, 'Tự nhiên và Xã hội', array['Mĩ thuật']),
    (9, 'Mô hình cơ quan tiêu hóa (BH)', 2, 'Tự nhiên và Xã hội', array['Mĩ thuật']),
    (10, 'Bộ đồ dùng học tập', 2, 'Công nghệ', array['Mĩ thuật']),
    (11, 'Mô hình não bộ (BH)', 2, 'Tự nhiên và Xã hội', array['Mĩ thuật']),
    (12, 'Trò chơi thời gian', 2, 'Toán', array['Mĩ thuật']),
    (13, 'Lịch để bàn (BH)', 2, 'Toán', array['Mĩ thuật']),
    (14, 'Sáng chế đồ chơi', 2, 'Công nghệ', array['Mĩ thuật']),
    (15, 'Các dạng địa hình trên Trái Đất', 2, 'Tự nhiên và Xã hội', array['Mĩ thuật']),
    (16, 'Hệ Mặt Trời (BH)', 3, 'Tự nhiên và Xã hội', array['Mĩ thuật'])
    ) as v(seq, title, periods, main_subject, subjects);
  end if;
  if sc is not null then
    delete from program_topics where module_id = sc and grade = 6;
    insert into program_topics (module_id, grade, seq, code, title, periods)
    select sc, 6, v.seq, v.code, v.title, 2 from (values
    (1, 'Tink-G0.31-01', 'Ống nghe truyền tin'),
    (2, 'Tink-G0.31-02', 'Chiếc nón thể thao'),
    (3, 'Tink-G0.31-03', 'Khung hình sắc màu'),
    (4, 'Tink-G0.31-04', 'Kỹ sư nhí'),
    (5, 'Tink-G0.31-05', 'Thủy thủ nhỏ'),
    (6, 'Tink-G0.31-06', 'Chú cá ngộ nghĩnh'),
    (7, 'Tink-G0.31-07', 'Khinh khí cầu mini'),
    (8, 'Tink-G0.31-08', 'Rube Goldberg machine mini'),
    (9, 'Tink-G0.32-01', 'Cây xương rồng'),
    (10, 'Tink-G0.32-02', 'Huy chương trưởng thành'),
    (11, 'Tink-G0.32-03', 'Bé học đèn giao thông'),
    (12, 'Tink-G0.32-04', 'Tấm thiệp yêu thương'),
    (13, 'Tink-G0.32-05', 'Gió hoa của em'),
    (14, 'Tink-G0.32-06', 'Robot vui nhộn'),
    (15, 'Tink-G0.32-07', 'Đèn pin cầm tay (MN)'),
    (16, 'Tink-G0.32-08', 'Đại dương kỳ thú')
    ) as v(seq, code, title);
  end if;
end $$;
