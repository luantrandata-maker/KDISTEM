-- 031: Dữ liệu mẫu cho 030 — chỉ chạy khi có trường demo THCS-PH và chưa có hoạt động nào.
-- 8 hoạt động mẫu của thầy Phạm Anh Tuấn (đủ 8 loại), 3 bài tự học cho Lớp 9A, tiến độ của một phần học sinh,
-- ngày nghỉ Tết Dương lịch của Sở Hưng Yên (áp dụng cho mọi trường trực thuộc).
do $$
declare sch uuid; so uuid; tch uuid; cls uuid; a_quiz uuid; a_order uuid; a_group uuid; a_ws uuid; lp uuid;
  i1 uuid; i2 uuid; i3 uuid; st record; n int := 0;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from activities where org_id = sch) then return; end if;
  select id into so from organizations where code = 'SO-HY';
  select id into tch from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn';
  select id into cls from classes where org_id = sch and name = 'Lớp 9A';

  insert into activities (org_id, teacher_id, kind, title, instructions, subject, grades, program, status, content) values
  (sch, tch, 'quiz', 'Khởi động: mạch điện cơ bản', 'Chọn một đáp án đúng cho mỗi câu.', 'Công nghệ', '8,9', 'CT4', 'published',
   '{"items":[{"q":"Dụng cụ nào dùng để đo cường độ dòng điện?","options":["Vôn kế","Ampe kế","Nhiệt kế","Lực kế"],"answer":1},
              {"q":"Đèn LED cần mắc nối tiếp với linh kiện nào để không bị cháy?","options":["Tụ điện","Điện trở","Cuộn cảm","Công tắc"],"answer":1},
              {"q":"Trong mạch nối tiếp, một bóng đèn hỏng thì các bóng còn lại…","options":["Vẫn sáng","Tắt hết","Sáng hơn","Mờ đi"],"answer":1}]}'),
  (sch, tch, 'truefalse', 'Đúng hay sai: an toàn phòng STEM', null, 'STEM', '6,7,8,9', 'CT2', 'published',
   '{"items":[{"q":"Được cắm điện khi tay còn ướt nếu làm nhanh.","answer":false},
              {"q":"Phải đeo kính bảo hộ khi dùng máy khoan mini.","answer":true},
              {"q":"Thiết bị hỏng để lại trên bàn cho nhóm sau sửa.","answer":false}]}'),
  (sch, tch, 'match', 'Ghép linh kiện với chức năng', 'Ghép mỗi linh kiện với chức năng của nó.', 'Công nghệ', '9', 'CT4', 'published',
   '{"pairs":[{"left":"Điện trở","right":"Hạn chế dòng điện"},{"left":"Tụ điện","right":"Tích và phóng điện"},
              {"left":"Cảm biến ánh sáng","right":"Đo độ sáng môi trường"},{"left":"Rơ-le","right":"Đóng ngắt mạch công suất lớn"}]}'),
  (sch, tch, 'order', 'Sắp xếp quy trình thiết kế kỹ thuật', 'Kéo các bước về đúng thứ tự.', 'STEM', '6,7,8,9', 'CT2', 'published',
   '{"steps":["Xác định vấn đề","Nghiên cứu kiến thức nền","Đề xuất giải pháp","Chế tạo mẫu thử","Thử nghiệm và đánh giá","Chia sẻ và cải tiến"]}'),
  (sch, tch, 'fill', 'Điền khuyết: định luật Ôm', null, 'Vật lý', '9', 'CT1', 'published',
   '{"text":"Cường độ dòng điện chạy qua dây dẫn tỉ lệ [thuận] với hiệu điện thế và tỉ lệ [nghịch] với [điện trở|điện trở của dây] của dây. Công thức: I = [U/R]."}'),
  (sch, tch, 'group', 'Phân loại vật dẫn điện – cách điện', 'Xếp mỗi vật liệu vào đúng nhóm.', 'Khoa học tự nhiên', '7,8', 'CT1', 'published',
   '{"groups":[{"name":"Dẫn điện","items":["Đồng","Nhôm","Than chì"]},{"name":"Cách điện","items":["Nhựa","Gỗ khô","Thuỷ tinh","Cao su"]}]}'),
  (sch, tch, 'flashcard', 'Thẻ ghi nhớ: cảm biến Arduino', null, 'Tin học', '9', 'CT4', 'published',
   '{"cards":[{"front":"HC-SR04","back":"Cảm biến siêu âm đo khoảng cách"},{"front":"DHT11","back":"Cảm biến nhiệt độ, độ ẩm"},
              {"front":"LDR","back":"Quang trở — đo ánh sáng"},{"front":"PIR","back":"Cảm biến chuyển động hồng ngoại"}]}'),
  (sch, tch, 'worksheet', 'Phiếu học tập: thí nghiệm con lắc', 'Làm theo nhóm, mỗi bạn nộp phiếu của mình.', 'STEM sáng tạo', '6', 'CT3', 'published',
   '{"intro":"Đo thời gian 10 dao động với 3 chiều dài dây khác nhau.","fields":[{"label":"Chiều dài dây 1 (cm) và thời gian (s)","type":"text"},
     {"label":"Chiều dài dây 2 (cm) và thời gian (s)","type":"text"},{"label":"Chiều dài dây 3 (cm) và thời gian (s)","type":"text"},
     {"label":"Em rút ra kết luận gì?","type":"long"}]}');

  -- Mẫu của trường (quản trị soạn, giáo viên lấy về dùng)
  insert into activities (org_id, kind, title, instructions, subject, grades, program, is_template, status, content) values
  (sch, 'quiz', 'Mẫu: Kiểm tra nhanh 5 phút', 'Thay câu hỏi bằng nội dung bài của bạn.', 'STEM', '6,7,8,9', null, true, 'published',
   '{"items":[{"q":"Câu hỏi 1","options":["Phương án A","Phương án B","Phương án C","Phương án D"],"answer":0}]}'),
  (sch, 'worksheet', 'Mẫu: Phiếu dự án STEM 5 bước', 'Phiếu theo quy trình EDP.', 'STEM', '6,7,8,9', 'CT2', true, 'published',
   '{"intro":"Nhóm em giải quyết vấn đề nào?","fields":[{"label":"1. Vấn đề cần giải quyết","type":"long"},{"label":"2. Tiêu chí sản phẩm","type":"long"},
     {"label":"3. Phương án đã chọn và lý do","type":"long"},{"label":"4. Kết quả thử nghiệm","type":"long"},{"label":"5. Cải tiến","type":"long"}]}');

  if cls is null or tch is null then return; end if;
  -- teaches_class cần phân công (đã có ở dữ liệu mẫu 013); ghi bằng quyền postgres nên không qua RLS
  select id into a_quiz from activities where org_id = sch and title = 'Khởi động: mạch điện cơ bản';
  select id into a_order from activities where org_id = sch and title = 'Sắp xếp quy trình thiết kế kỹ thuật';
  select id into a_group from activities where org_id = sch and title = 'Phân loại vật dẫn điện – cách điện';
  select id into lp from lesson_plans where org_id = sch and title = 'Mạch điện thông minh – nối tiếp hay song song?';

  insert into self_study_items (org_id, class_id, teacher_id, kind, activity_id, title, note, mode, for_date, opens_at, due_at, max_attempts)
    values (sch, cls, tch, 'activity', a_quiz, 'Khởi động: mạch điện cơ bản', 'Làm trước tiết Công nghệ để cô biết lớp đã nắm đến đâu.', 'before',
            public.vn_today() + 2, now() - interval '2 days', now() + interval '2 days', 2)
    returning id into i1;
  insert into self_study_items (org_id, class_id, teacher_id, kind, activity_id, title, mode, opens_at, max_attempts)
    values (sch, cls, tch, 'activity', a_group, 'Phân loại vật dẫn điện – cách điện', 'practice', now() - interval '5 days', 0)
    returning id into i2;
  if lp is not null then
    insert into self_study_items (org_id, class_id, teacher_id, kind, lesson_plan_id, title, note, mode, for_date, opens_at, due_at)
      values (sch, cls, tch, 'lesson', lp, 'Xem trước: Mạch điện thông minh', 'Đọc slide và trả lời câu dự đoán trước khi lên lớp.', 'before',
              public.vn_today() + 2, now() - interval '1 day', now() + interval '2 days')
      returning id into i3;
  end if;
  insert into self_study_items (org_id, class_id, teacher_id, kind, activity_id, title, mode, opens_at, status)
    values (sch, cls, tch, 'activity', a_order, 'Ôn tập: quy trình thiết kế kỹ thuật', 'practice', now(), 'draft');

  -- Tiến độ mẫu: khoảng 2/3 lớp đã làm bài khởi động, một nửa đã làm bài phân loại
  for st in select id from students where class_id = cls order by student_code loop
    n := n + 1;
    if n % 3 <> 0 then
      insert into self_study_progress (item_id, student_id, org_id, status, attempts, score, best_score, correct, total, answers, started_at, completed_at, submitted_at)
        values (i1, st.id, sch, 'done', 1, case when n % 4 = 0 then 6.7 else 10 end, case when n % 4 = 0 then 6.7 else 10 end,
                case when n % 4 = 0 then 2 else 3 end, 3, case when n % 4 = 0 then '[1,0,1]'::jsonb else '[1,1,1]'::jsonb end,
                now() - interval '1 day', now() - interval '1 day', now() - interval '1 day');
    end if;
    if n % 2 = 0 then
      insert into self_study_progress (item_id, student_id, org_id, status, attempts, score, best_score, correct, total, started_at, completed_at, submitted_at)
        values (i2, st.id, sch, 'done', 1 + n % 3, 8.6, 8.6, 6, 7, now() - interval '3 days', now() - interval '3 days', now() - interval '3 days');
    elsif n % 5 = 1 then
      insert into self_study_progress (item_id, student_id, org_id, status, started_at) values (i2, st.id, sch, 'started', now() - interval '2 days');
    end if;
  end loop;

  -- Ngày nghỉ: Sở áp dụng cho mọi trường; trường có một ngày nghỉ riêng
  if so is not null then
    insert into school_holidays (org_id, name, starts_on, ends_on, created_by) values
      (so, 'Tết Dương lịch', make_date(extract(year from public.vn_today())::int + 1, 1, 1), make_date(extract(year from public.vn_today())::int + 1, 1, 1), null);
  end if;
  insert into school_holidays (org_id, name, starts_on, ends_on, note, created_by) values
    (sch, 'Hội thao truyền thống của trường', make_date(extract(year from public.vn_today())::int, 11, 21), make_date(extract(year from public.vn_today())::int, 11, 21),
     'Toàn trường tham gia hội thao, không dạy theo TKB', null);
end $$;
