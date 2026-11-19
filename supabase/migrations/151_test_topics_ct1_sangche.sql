-- 151: Dữ liệu test (19/11/2026) để xem trên hệ thống.
-- CT1 Bài học STEM, Khối 3: 16 chủ đề, mỗi chủ đề 2 tiết, tổng 32 tiết, thay 10 chủ đề mẫu "Chủ đề STEM n" của Khối 3.
-- CT2 học phần Sáng chế, Khối 6: Tink-G6.1 (6 chủ đề) rồi Tink-G6.2 (5 chủ đề); mỗi buổi 2 tiết, chủ đề học 2 buổi thì 4 tiết; tổng 32 tiết.
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
    (3, 'Đèn học sáng tạo (BH)', 2, 'Công nghệ', array['Mĩ thuật']),
    (4, 'Quạt điện mini (G3)', 2, 'Công nghệ', array['Mĩ thuật']),
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
    (16, 'Hệ Mặt Trời (BH)', 2, 'Tự nhiên và Xã hội', array['Mĩ thuật'])
    ) as v(seq, title, periods, main_subject, subjects);
  end if;
  if sc is not null then
    delete from program_topics where module_id = sc and grade = 6;
    insert into program_topics (module_id, grade, seq, code, title, periods)
    select sc, 6, v.seq, v.code, v.title, v.periods from (values
    (1, 'Tink-G6.1-01', 'Thử thách trứng rơi', 2),
    (2, 'Tink-G6.1-02', 'Thử thách bàn giấy chịu lực', 2),
    (3, 'Tink-G6.1-03', 'Mechanical Hand', 2),
    (4, 'Tink-G6.1-04', 'Xe đàn hồi', 4),
    (5, 'Tink-G6.1-05', 'Máy bắn đá', 2),
    (6, 'Tink-G6.1-06', 'Game center', 4),
    (7, 'Tink-G6.2-01', 'Crazy robot', 2),
    (8, 'Tink-G6.2-02', 'Nhà an ninh', 4),
    (9, 'Tink-G6.2-03', 'Looks like - Works like Prototype', 2),
    (10, 'Tink-G6.2-04', 'Đèn xoay', 4),
    (11, 'Tink-G6.2-05', 'Sáng tạo vật dụng gia đình', 4)
    ) as v(seq, code, title, periods);
  end if;
end $$;
