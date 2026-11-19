-- 153: Dữ liệu test học phần Sáng chế (CT2): thêm Tink-G6.3 cho Khối 6 (sau G6.1, G6.2) và Khối 7 (Tink-G7.1, G7.2, G7.3).
-- Mỗi buổi 2 tiết; chủ đề học 2 buổi liền nhau thì 4 tiết. Mỗi bộ 16 tiết; Khối 6, Khối 7 mỗi khối 48 tiết.
do $$
declare sc uuid;
begin
  select id into sc from program_modules where track_code = 'CT2' and name = 'Sáng chế' limit 1;
  if sc is null then return; end if;
  delete from program_topics where module_id = sc and grade = 6 and code like 'Tink-G6.3-%';
  insert into program_topics (module_id, grade, seq, code, title, periods)
  select sc, 6, v.seq, v.code, v.title, v.periods from (values
    (12, 'Tink-G6.3-01', 'Trò chơi bi lắc', 4),
    (13, 'Tink-G6.3-02', 'Hộp khoá quay số', 4),
    (14, 'Tink-G6.3-03', 'Bàn cờ lục giác', 2),
    (15, 'Tink-G6.3-04', 'Hộp gấp gọn', 2),
    (16, 'Tink-G6.3-05', 'Vòng quay ngựa gỗ', 4)
  ) as v(seq, code, title, periods);
  delete from program_topics where module_id = sc and grade = 7;
  insert into program_topics (module_id, grade, seq, code, title, periods)
  select sc, 7, v.seq, v.code, v.title, v.periods from (values
    (1, 'Tink-G7.1-01', 'Rạp chiếu bóng', 4),
    (2, 'Tink-G7.1-02', 'CAM toy', 4),
    (3, 'Tink-G7.1-03', 'Trebuchet', 4),
    (4, 'Tink-G7.1-04', 'Cần cẩu điện', 4),
    (5, 'Tink-G7.2-01', 'Thiết bị báo động đất', 2),
    (6, 'Tink-G7.2-02', 'Máy hút bụi cầm tay', 4),
    (7, 'Tink-G7.2-03', 'Hộp quà bí mật', 2),
    (8, 'Tink-G7.2-04', 'Thang máy', 4),
    (9, 'Tink-G7.2-05', 'Sáng tạo khu vui chơi', 4),
    (10, 'Tink-G7.3-01', 'Sáng chế robot', 2),
    (11, 'Tink-G7.3-02', 'Hộp thức ăn cho Pet', 4),
    (12, 'Tink-G7.3-03', 'Xe đua vượt thử thách', 4),
    (13, 'Tink-G7.3-04', 'Máy vẽ tranh tỉ lệ', 2),
    (14, 'Tink-G7.3-05', 'Cỗ máy Rube Goldberg', 4)
  ) as v(seq, code, title, periods);
end $$;
