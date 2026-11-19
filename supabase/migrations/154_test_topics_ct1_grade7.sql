-- 154: Dữ liệu test CT1 Bài học STEM, Khối 7: 16 chủ đề (mã môn TinkBH, cấp độ G4), 35 tiết; thay 10 chủ đề mẫu của Khối 7.
-- Yêu cầu cần đạt, sản phẩm để trống, bổ sung khi có file đầy đủ.
do $$
declare ct1 uuid;
begin
  select id into ct1 from program_modules where track_code = 'CT1' order by sort limit 1;
  if ct1 is null then return; end if;
  delete from program_topics where module_id = ct1 and grade = 7;
  insert into program_topics (module_id, grade, seq, code, title, periods, main_subject, subjects)
  select ct1, 7, v.seq, v.code, v.title, v.periods, v.main_subject, v.subjects from (values
    (1, 'TinkBH-G4-01', 'Bình tưới nhỏ giọt tự động', 2, 'Khoa học', array['Công nghệ']),
    (2, 'TinkBH-G4-02', 'Vòng tuần hoàn của nước (BH)', 2, 'Khoa học', array['Mĩ thuật']),
    (3, 'TinkBH-G4-03', 'Windmill (BH)', 2, 'Khoa học', array['Mĩ thuật']),
    (4, 'TinkBH-G4-04', 'Rạp chiếu bóng mini (BH)', 3, 'Khoa học', array['Toán']),
    (5, 'TinkBH-G4-05', 'Tai nghe chống ồn (BH)', 2, 'Khoa học', array['Mĩ thuật']),
    (6, 'TinkBH-G4-06', 'Túi giữ nhiệt đa năng', 2, 'Khoa học', array['Toán']),
    (7, 'TinkBH-G4-07', 'Làm thiệp 3D', 2, 'Toán', array['Mĩ thuật']),
    (8, 'TinkBH-G4-08', 'Hộp tiết kiệm', 2, 'Hoạt động trải nghiệm', array['Mĩ thuật']),
    (9, 'TinkBH-G4-09', 'Chậu cây thân thiện với môi trường', 2, 'Khoa học', array['Mĩ thuật']),
    (10, 'TinkBH-G4-10', 'Thế giới nấm', 2, 'Khoa học', array['Mĩ thuật']),
    (11, 'TinkBH-G4-11', 'Trò chơi dinh dưỡng', 3, 'Khoa học', array['Mĩ thuật']),
    (12, 'TinkBH-G4-12', 'Thực đơn cân bằng, lành mạnh', 2, 'Khoa học', array['Mĩ thuật']),
    (13, 'TinkBH-G4-13', 'Đồ chơi con quay (BH)', 2, 'Công nghệ', array['Mĩ thuật']),
    (14, 'TinkBH-G4-14', 'Câu chuyện chuỗi thức ăn trong tự nhiên', 2, 'Khoa học', array['Mĩ thuật']),
    (15, 'TinkBH-G4-15', 'Đèn ông sao (BH)', 3, 'Công nghệ', array['Mĩ thuật']),
    (16, 'TinkBH-G4-16', 'Làm diều giấy', 2, 'Công nghệ', array['Toán'])
  ) as v(seq, code, title, periods, main_subject, subjects);
end $$;
