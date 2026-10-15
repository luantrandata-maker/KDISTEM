-- Dữ liệu mẫu cho các màn hình mới của Trường – Quản trị. Chỉ chạy khi chưa có phòng nào có mã.
do $$
declare
  sch uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid; fl uuid; pkg uuid; tid uuid; tp record;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from stem_rooms where org_id = sch and code is not null) then return; end if;
  select id into pkg from stem_packages where org_id = sch and code = 'GOI-001';
  select floor_id into fl from stem_rooms where org_id = sch and name = 'Phòng STEM 1';

  -- Phòng STEM
  update stem_rooms set code='P-STEM-01', area_m2=72, tier='advanced', programs='CT1,CT2,CT3' where org_id=sch and name='Phòng STEM 1';
  update stem_rooms set code='P-STEM-03', area_m2=60, tier='advanced', programs='CT1,CT4' where org_id=sch and name='Phòng Robotics';
  update stem_rooms set code='P-STEM-04', area_m2=54, tier='basic', programs='CT5' where org_id=sch and name='Phòng IoT & AI';
  insert into stem_rooms (org_id, floor_id, name, capacity, status, code, area_m2, tier, programs)
    values (sch, fl, 'Phòng STEM 2', 35, 'active', 'P-STEM-02', 66, 'basic', 'CT2,CT3');
  select id into r1 from stem_rooms where org_id=sch and name='Phòng STEM 1';
  select id into r2 from stem_rooms where org_id=sch and name='Phòng Robotics';
  select id into r3 from stem_rooms where org_id=sch and name='Phòng IoT & AI';
  select id into r4 from stem_rooms where org_id=sch and name='Phòng STEM 2';

  -- Thiết bị
  update equipment_units set package_id = pkg where org_id = sch;
  for tp in select * from (values
    ('Robot Lego SPIKE Prime','ROBOT-SPIKE','LEGO Education','Robot',8),
    ('Kính hiển vi điện tử HS','MICROSCOPE','KDI Education','Khoa học',10),
    ('Máy in 3D EDU','3DP-EDU','KDI Education','Chế tạo',4),
    ('Bộ kính thực tế ảo Meta Quest','VR-QUEST','Meta','VR',6),
    ('Bộ dụng cụ khoa học cơ bản','SCIENCE-BASIC','KDI Education','Khoa học',12)) as v(name, sku, brand, cat, n)
  loop
    insert into equipment_types (org_id, sku, name, brand, category) values (sch, tp.sku, tp.name, tp.brand, tp.cat) returning id into tid;
    insert into equipment_units (org_id, type_id, room_id, serial, status, warranty_until, source, package_id)
    select sch, tid, (array[r1,r2,r3,r4,null::uuid])[1 + (g % 5)], tp.sku || '-' || lpad(g::text, 4, '0'),
      case when g % 5 = 4 then 'in_stock' when g % 7 = 0 then 'broken' when g % 5 = 0 then 'maintenance' when g % 3 = 0 then 'in_use' else 'available' end,
      date '2027-01-10', case when tp.sku = '3DP-EDU' then 'purchase' else 'package' end,
      case when tp.sku = '3DP-EDU' then null else pkg end
    from generate_series(1, tp.n) g;
  end loop;

  insert into equipment_events (org_id, unit_id, kind, title, note, created_at)
  select sch, u.id, 'intake', 'Nhập kho / khai báo', 'Nhập kho từ ' || case when u.source = 'package' then 'gói STEM.' else 'mua sắm của trường.' end, timestamptz '2025-09-12 15:00+07'
  from equipment_units u where u.org_id = sch;
  insert into equipment_events (org_id, unit_id, kind, title, note, created_at)
  select sch, u.id, 'allocate', 'Phân bổ phòng', 'Tồn kho → ' || r.name, timestamptz '2025-09-15 16:30+07'
  from equipment_units u join stem_rooms r on r.id = u.room_id where u.org_id = sch;

  -- Mượn – trả
  insert into borrow_requests (org_id, teacher_id, room_id, period_id, title, items, on_date, mode, status)
  select sch, t.id, r1, p.id, v.title, v.items, v.d::date, v.mode, v.status
  from (values
    ('Phạm Anh Tuấn','Mượn máy chiếu cho buổi họp chuyên môn','Máy chiếu x1','2026-10-15',null,'take_to_class','pending'),
    ('Trần Văn Hùng','Thử thách xe dò line (tranh chấp thiết bị cùng tiết)','Robot lập trình Mbot x6','2026-10-15','Tiết 1','in_room','pending'),
    ('Lê Minh Trang','Chuẩn bị giàn trưng bày ngày hội STEM','Bộ mạch Arduino Starter x4','2026-10-15',null,'take_to_class','pending'),
    ('Đặng Tuấn Anh','Vườn rau thông minh — Lắp cảm biến','Kit cảm biến IoT + Gateway x3','2026-10-16','Tiết 2','in_room','pending'),
    ('Bùi Thu Hà','Mượn máy tính bảng cho tiết kiểm tra online','Máy tính bảng x10','2026-10-16','Tiết 3','take_to_class','pending'),
    ('Nguyễn Thị Lan','Quan sát tế bào bằng kính hiển vi','Kính hiển vi điện tử HS x8','2026-10-12','Tiết 2','in_room','lent'),
    ('Vũ Thanh Hương','Thí nghiệm khoa học cơ bản','Bộ dụng cụ khoa học cơ bản x6','2026-10-08','Tiết 4','in_room','returned')
  ) as v(tname, title, items, d, pname, mode, status)
  join teachers t on t.org_id = sch and t.full_name = v.tname
  left join period_configs p on p.org_id = sch and p.name = v.pname;

  -- Bảo hành
  update warranty_tickets set provider = 'KDI Education', provider_status = 'accepted', technician = 'Trần Văn Kỳ' where org_id = sch and code = 'WT-2026-0001';
  update warranty_tickets set provider = 'KDI Education', provider_status = 'accepted' where org_id = sch and code in ('WT-2026-0002','WT-2026-0004');
  update warranty_tickets set provider = 'KDI Education' where org_id = sch and code = 'WT-2026-0003';
  insert into warranty_tickets (org_id, code, unit_id, description, status, created_at, provider, provider_status, technician)
  select sch, v.code, u.id, v.descr, v.status, v.created::timestamptz, 'KDI Education', v.pst, v.tech
  from (values
    ('WT-2026-0005','3DP-EDU-0001','Đầu phun nhựa bị tắc, không đùn nhựa ra được. Đã thử vệ sinh nhưng không cải thiện','draft','2026-10-06','pending',null),
    ('WT-2026-0006','VR-QUEST-0001','Màn hình hiển thị sọc xanh, độ sáng giảm bất thường khi đeo','draft','2026-10-07','pending',null),
    ('WT-2026-0007','SCIENCE-BASIC-0002','Bình đo thể tích 250ml bị nứt miệng, không sử dụng được','new','2026-10-12','pending',null),
    ('WT-2026-0008','MICROSCOPE-0002','Thấu kính vật 40x bị mờ, cần thay linh kiện','waiting_parts','2026-10-02','accepted','Phạm Văn Viên'),
    ('WT-2026-0009','ROBOT-SPIKE-0002','Động cơ cổng B không phản hồi, hub báo lỗi kết nối','processing','2026-10-05','accepted','Trần Văn Kỳ'),
    ('WT-2026-0010','VR-QUEST-0003','Tay cầm trái mất kết nối, thay pin vẫn lỗi','rejected','2026-09-24','accepted','Lê Thị Thuật'),
    ('WT-2026-0011','3DP-EDU-0002','Bàn in lệch, cần cân chỉnh lại','closed','2026-09-14','accepted','Nguyễn Minh Trí'),
    ('WT-2026-0012','ROBOT-SPIKE-0004','Pin không sạc được, đèn báo không sáng','accepted','2026-10-10','accepted',null)
  ) as v(code, serial, descr, status, created, pst, tech)
  join equipment_units u on u.org_id = sch and u.serial = v.serial;

  -- Đăng ký dạy STEM: bổ sung thông tin chương trình, bài học, thiết bị mượn
  update stem_registrations s set program = 'CT1', lesson = 'Mạch điện điều khiển — An toàn điện trong lớp học · Buổi 2: Lắp mạch, đo và ghi số liệu', equipment_note = null
    from teachers t where s.teacher_id = t.id and t.full_name = 'Trần Văn Hùng' and s.org_id = sch;
  update stem_registrations s set program = 'CT2', lesson = 'Nhà thông minh mini — Cảm biến và điều khiển · Buổi 1: Thiết kế mô hình và phân công nhóm'
    from teachers t where s.teacher_id = t.id and t.full_name = 'Lê Minh Trang' and s.org_id = sch;
  update stem_registrations s set program = 'CT4', lesson = 'Robot tránh vật cản · Buổi 3: Lập trình cảm biến siêu âm'
    from teachers t where s.teacher_id = t.id and t.full_name = 'Phạm Anh Tuấn' and s.org_id = sch;
  update stem_registrations s set program = 'CT1', lesson = 'Rút gọn biểu thức chứa căn — Máy tính hỗ trợ kiểm chứng · Buổi 1'
    from teachers t where s.teacher_id = t.id and t.full_name = 'Đặng Tuấn Anh' and s.org_id = sch;
  insert into stem_registrations (org_id, teacher_id, class_id, room_id, period_id, on_date, topic, status, program, lesson, equipment_note)
  select sch, t.id, c.id, r.id, p.id, v.d::date, v.topic, v.status, v.program, v.lesson, v.eq
  from (values
    ('Phạm Anh Tuấn','Lớp 7A','Phòng STEM 2','Tiết 3','2026-10-16','Đại lượng tỉ lệ nghịch — Dự án khảo sát STEM','pending','CT2','Đại lượng tỉ lệ nghịch — Khảo sát mật độ giao thông cổng trường · Buổi 1','Máy tính bảng x6'),
    ('Phạm Anh Tuấn','Lớp 9A','Phòng Robotics','Tiết 1','2026-10-17','CLB STEM: Mô hình cầu chịu lực','pending','CT4','CLB Toán ứng dụng — Cầu chịu lực bằng que kem · Buổi 1: Nguyên lý kết cấu và bản vẽ',null),
    ('Lê Minh Trang','Lớp 8A','Phòng IoT & AI','Tiết 4','2026-10-19','Vườn rau thông minh — Lắp cảm biến','pending','CT3','Vườn rau thông minh · Buổi 2','Kit cảm biến IoT + Gateway x3'),
    ('Trần Văn Hùng','Lớp 7A','Phòng STEM 1','Tiết 5','2026-10-20','Lập trình Scratch — Trò chơi tương tác','approved','CT2',null,null),
    ('Bùi Thu Hà','Lớp 6A','Phòng STEM 2','Tiết 2','2026-10-21','Thí nghiệm khoa học cơ bản','approved','CT3',null,null),
    ('Nguyễn Thị Lan','Lớp 6A','Phòng STEM 2','Tiết 4','2026-10-22','Quan sát tế bào bằng kính hiển vi','rejected','CT3',null,null)
  ) as v(tname, cname, rname, pname, d, topic, status, program, lesson, eq)
  join teachers t on t.org_id = sch and t.full_name = v.tname
  join classes c on c.org_id = sch and c.name = v.cname
  join stem_rooms r on r.org_id = sch and r.name = v.rname
  join period_configs p on p.org_id = sch and p.name = v.pname;

  -- Kế hoạch giáo dục, chương trình lớp, trạng thái học sinh
  insert into education_plans (org_id, teacher_id, subject, grade, stem_periods)
  select sch, t.id, v.subject, v.grade, v.n
  from (values ('Trần Văn Hùng','Tin học',7,2),('Phạm Anh Tuấn','Toán',7,1),('Phạm Anh Tuấn','Toán',8,1),('Phạm Anh Tuấn','Toán',9,3),('Lê Minh Trang','Công nghệ',8,2),('Đặng Tuấn Anh','Toán',7,2)) as v(tname, subject, grade, n)
  join teachers t on t.org_id = sch and t.full_name = v.tname;
  insert into class_programs (org_id, class_id, program)
  select sch, c.id, v.program from (values ('Lớp 6A','CT1'),('Lớp 6A','CT3'),('Lớp 7A','CT5'),('Lớp 7A','CT2'),('Lớp 8A','CT4'),('Lớp 8A','CT1'),('Lớp 9A','CT3'),('Lớp 9A','CT4')) as v(cname, program)
  join classes c on c.org_id = sch and c.name = v.cname;
  update students set status = 'transferred' where org_id = sch and student_code in ('HS6A002','HS7A003');

  -- Nội dung gói STEM
  with ins as (
    insert into package_topics (org_id, package_id, seq, program, title, minutes)
    select sch, pkg, v.seq, v.program, v.title, v.minutes from (values
      (1,'CT1','Căn bậc hai trong đo đạc — Sai số và làm tròn',135),
      (2,'CT1','Rút gọn biểu thức chứa căn — Máy tính hỗ trợ kiểm chứng',90),
      (3,'CT1,CT2','Hàm số bậc nhất — Mô hình dự báo chi phí căng-tin',135),
      (4,'CT2','Hệ phương trình — Bài toán tối ưu khẩu phần dinh dưỡng',180),
      (5,'CT2','Hình trụ — Hình nón: Thiết kế và in 3D vật dụng lớp học',180),
      (6,'CT4','CLB Toán ứng dụng — Cầu chịu lực bằng que kem',90),
      (7,'CT3','Mô hình nhà thông minh — Cảm biến và điều khiển',135),
      (8,'CT5','Nghiên cứu chất lượng không khí quanh trường',135)
    ) as v(seq, program, title, minutes) returning id, seq)
  insert into package_topic_sessions (org_id, topic_id, seq, title, minutes)
  select sch, ins.id, s.n, s.title, s.minutes from ins join (values
    (1,1,'Buổi 1: Ước lượng căn bậc hai & sai số phép đo',45),(1,2,'Buổi 2: Đo đạc thực địa sân trường theo nhóm',45),(1,3,'Buổi 3: Báo cáo số liệu và nhận xét sai số',45),
    (2,1,'Buổi 1: Thử nghiệm & so sánh kết quả rút gọn',45),(2,2,'Buổi 2: Dựng bảng tính kiểm chứng tự động',45),
    (3,1,'Buổi 1: Thu thập dữ liệu và vẽ đồ thị',45),(3,2,'Buổi 2: Xây dựng hàm dự báo, kiểm tra độ lệch',45),(3,3,'Buổi 3: Trình bày mô hình trước lớp',45),
    (4,1,'Buổi 1: Đặt ẩn và lập hệ điều kiện thực tế',60),(4,2,'Buổi 2: Giải hệ & phân tích phương án',60),(4,3,'Buổi 3: Thiết kế thực đơn nhóm và phản biện',60),
    (5,1,'Buổi 1: Tính toán kích thước & lập bản thiết kế',60),(5,2,'Buổi 2: Dựng mô hình 3D trên Tinkercad',60),(5,3,'Buổi 3: In thử, đo đạc và hiệu chỉnh',60),
    (6,1,'Buổi 1: Nguyên lý kết cấu và bản vẽ',45),(6,2,'Buổi 2: Chế tạo, thử tải và cải tiến',45),
    (7,1,'Buổi 1: Thiết kế mô hình và phân công nhóm',45),(7,2,'Buổi 2: Lắp ráp cảm biến',45),(7,3,'Buổi 3: Lập trình và trình diễn',45),
    (8,1,'Buổi 1: Thiết kế phương án đo',45),(8,2,'Buổi 2: Thu thập số liệu thực địa',45),(8,3,'Buổi 3: Phân tích và báo cáo',45)
  ) as s(tseq, n, title, minutes) on s.tseq = ins.seq;

  -- Tập huấn: làm lại theo lộ trình khóa học
  delete from training_lessons where org_id = sch;
  delete from training_plans where org_id = sch;
  insert into training_plans (org_id, code, year_no, module_no, name, program, provider, mode, status, hours) values (sch,'CT1',1,1,'STEM Tích hợp nội môn — Nền tảng','CT1','KDI Education STEM','online','ongoing',8) returning id into p1;
  insert into training_plans (org_id, code, year_no, module_no, name, program, provider, mode, status, hours) values (sch,'CT2',1,2,'Workshop Thiết kế Chủ đề Liên môn','CT2','EBD','online','ongoing',6) returning id into p2;
  insert into training_plans (org_id, code, year_no, module_no, name, program, provider, mode, status, hours) values (sch,'CT4',2,1,'Robotics cơ bản dành cho Giáo viên','CT4','Nexta','online','ongoing',12) returning id into p3;
  insert into training_plans (org_id, code, year_no, module_no, name, program, provider, mode, status, hours) values (sch,'CT5',3,1,'Ứng dụng AI trong giảng dạy STEM','CT5','KDI Education STEM','online','ongoing',10) returning id into p4;
  insert into training_plans (org_id, code, year_no, module_no, name, program, provider, mode, status, hours) values (sch,'CT4',1,3,'Tập huấn vận hành Phòng STEM (trực tiếp)','CT4','KDI Education STEM','offline','ongoing',12) returning id into p5;
  insert into training_plans (org_id, code, year_no, module_no, name, program, provider, mode, status, hours) values (sch,'CT4',2,2,'Lập trình Robotics — Hybrid (online + thực hành)','CT4','Nexta','hybrid','ongoing',16) returning id into p6;

  insert into training_sessions (org_id, plan_id, title, starts_at, ends_at, mode, location) values
    (sch,p1,'Buổi 1: Định hướng giáo dục STEM năm học 2025-2026','2026-08-30 08:00+07','2026-08-30 11:30+07','offline','Nhà cung cấp STEM'),
    (sch,p5,'Buổi 5: Tổng kết & trao chứng nhận STEM cơ bản','2026-09-14 14:00+07','2026-09-14 17:00+07','offline','Nhà cung cấp STEM'),
    (sch,p3,'Buổi 1: Tổng quan Robotics giáo dục & bộ KIT','2026-10-04 08:00+07','2026-10-04 11:30+07','online',null),
    (sch,p3,'Buổi 2: Lắp ráp và lập trình robot cơ bản','2026-10-11 08:00+07','2026-10-11 11:30+07','online',null),
    (sch,p3,'Buổi 3: Cảm biến và điều khiển tự động','2026-10-14 08:00+07','2026-10-14 11:00+07','online',null),
    (sch,p6,'Buổi 1: Scratch nâng cao — khởi động & sự kiện','2026-10-18 14:00+07','2026-10-18 16:30+07','online',null),
    (sch,p6,'Buổi 2: Scratch nâng cao — Trò chơi tương tác','2026-10-25 14:00+07','2026-10-25 16:30+07','online',null);

  insert into training_enrollments (org_id, plan_id, teacher_id, completed)
  select sch, v.plan, t.id, v.done from (values
    (p1,'Phạm Anh Tuấn',true),(p1,'Lê Minh Trang',false),
    (p5,'Bùi Thu Hà',true),(p5,'Trần Văn Hùng',true),(p5,'Lê Minh Trang',true)) as v(plan, tname, done)
  join teachers t on t.org_id = sch and t.full_name = v.tname;

  insert into training_attendance (org_id, session_id, teacher_id, present)
  select sch, s.id, t.id,
    case when s.ends_at < timestamptz '2026-10-14 08:00+07' then (t.rn <= (case when s.title like 'Buổi 5%' then 7 else 6 end))
         when s.starts_at <= timestamptz '2026-10-14 09:00+07' and s.starts_at >= timestamptz '2026-10-14 00:00+07' then (t.rn <= 5)
         else null end
  from training_sessions s
  cross join (select id, row_number() over (order by full_name) as rn from teachers where org_id = sch) t
  where s.org_id = sch;

  insert into certificates (org_id, teacher_id, plan_id, code, issued_on)
  select sch, e.teacher_id, e.plan_id, 'CC-2026-' || lpad(row_number() over (order by e.plan_id, e.teacher_id)::text, 3, '0'), date '2026-09-14'
  from training_enrollments e where e.org_id = sch and e.completed;

  insert into training_lessons (org_id, plan_id, title, grades, subject, author, status, created_on, blocks, materials, videos, docs) values
    (sch,p3,'Lập trình Scratch nâng cao','Khối 6, Khối 7, Khối 8','Tin học','Nguyễn Quang Dũng','published','2026-10-08',6,5,2,3),
    (sch,p3,'IoT cho trường học','Khối 8, Khối 9','Công nghệ, Tin học','Nguyễn Quang Dũng','published','2026-10-08',5,3,1,2),
    (sch,p3,'Robotics cơ bản với mBot','Khối 6, Khối 7','Công nghệ','Lê Hồng Phúc','published','2026-10-02',6,4,2,2),
    (sch,p1,'Thiết kế 3D với Tinkercad','Khối 7, Khối 8, Khối 9','Công nghệ','Lê Hồng Phúc','draft','2026-10-12',4,3,1,2),
    (sch,p1,'Toán ứng dụng trong STEM','Khối 9','Toán','Đỗ Thu Trang','draft','2026-10-02',3,2,0,2),
    (sch,p5,'Thí nghiệm Khoa học tự nhiên với cảm biến số','Khối 6, Khối 7, Khối 8','Khoa học tự nhiên','Lê Hồng Phúc','published','2026-10-12',6,4,2,2),
    (sch,p5,'Python cho câu lạc bộ STEM','Khối 8, Khối 9','Tin học','Đỗ Thu Trang','published','2026-10-02',8,6,3,3),
    (sch,p2,'Năng lượng tái tạo — mô hình tuabin gió mini','Khối 8','Khoa học tự nhiên, Công nghệ','Đỗ Thu Trang','inactive','2026-09-19',4,3,1,2);
end $$;
