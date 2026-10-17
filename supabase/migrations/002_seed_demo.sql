-- Dữ liệu mẫu cho giai đoạn demo. Chỉ chạy khi chưa có tổ chức nào.
do $$
declare
  dept uuid; sch uuid; yr uuid; b_a uuid; b_b uuid; fl1 uuid; fl2 uuid;
  r1 uuid; r2 uuid; r3 uuid; t_mbot uuid; t_ard uuid; t_iot uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  if exists (select 1 from organizations) then return; end if;

  insert into organizations (type, code, name) values ('department','SO-HY','Sở GD&ĐT Hưng Yên') returning id into dept;
  insert into organizations (type, parent_id, code, name, level) values ('school', dept, 'THCS-PH', 'Trường THCS Phố Hiến', 'thcs') returning id into sch;
  insert into organizations (type, parent_id, code, name, level) values
    ('school', dept, 'THPT-CHY', 'Trường THPT Chuyên Hưng Yên', 'thpt'),
    ('school', dept, 'TH-MH', 'Trường Tiểu học Mỹ Hào', 'tieuhoc');

  insert into academic_years (org_id, name, term, starts_on, ends_on, is_current)
  values (sch, '2026-2027', 'HK I', '2026-09-05', '2027-01-15', true) returning id into yr;

  insert into period_configs (org_id, name, starts_at, ends_at, session) values
    (sch,'Tiết 1','07:00','07:45','morning'), (sch,'Tiết 2','07:50','08:35','morning'),
    (sch,'Tiết 3','08:40','09:25','morning'), (sch,'Tiết 4','09:30','10:15','morning'),
    (sch,'Tiết 5','10:20','11:05','morning'), (sch,'Tiết 6','13:30','14:15','afternoon'),
    (sch,'Tiết 7','14:20','15:05','afternoon'), (sch,'Tiết 8','15:10','15:55','afternoon');

  insert into buildings (org_id, name, note) values (sch,'Nhà A','Dãy nhà chính, phía Đông') returning id into b_a;
  insert into buildings (org_id, name, note) values (sch,'Khu STEM mới','Xây dựng 2024, chuyên phòng STEM') returning id into b_b;
  insert into floors (building_id, name) values (b_a,'Tầng 1'), (b_a,'Tầng 2');
  insert into floors (building_id, name) values (b_b,'Tầng 1 — Phòng Robotics') returning id into fl1;
  insert into floors (building_id, name) values (b_b,'Tầng 2 — Phòng AI & IoT') returning id into fl2;

  insert into stem_rooms (org_id, floor_id, name, capacity, status) values (sch, fl1, 'Phòng STEM 1', 40, 'active') returning id into r1;
  insert into stem_rooms (org_id, floor_id, name, capacity, status) values (sch, fl1, 'Phòng Robotics', 30, 'active') returning id into r2;
  insert into stem_rooms (org_id, floor_id, name, capacity, status) values (sch, fl2, 'Phòng IoT & AI', 28, 'maintenance') returning id into r3;

  insert into teachers (org_id, full_name, email, subject, grade) values
    (sch,'Phạm Anh Tuấn','tuan.pa@phohien.example.vn','Toán',9),
    (sch,'Nguyễn Thị Lan','lan.nt@phohien.example.vn','Khoa học tự nhiên',6),
    (sch,'Trần Văn Hùng','hung.tv@phohien.example.vn','Tin học',7),
    (sch,'Lê Minh Trang','trang.lm@phohien.example.vn','Công nghệ',8),
    (sch,'Vũ Thanh Hương','huong.vt@phohien.example.vn','Khoa học tự nhiên',6),
    (sch,'Đặng Tuấn Anh','anh.dt@phohien.example.vn','Toán',7),
    (sch,'Bùi Thu Hà','ha.bt@phohien.example.vn','Công nghệ',6);

  insert into classes (org_id, year_id, name, grade) values
    (sch, yr,'Lớp 6A',6), (sch, yr,'Lớp 7A',7), (sch, yr,'Lớp 8A',8), (sch, yr,'Lớp 9A',9);

  insert into teaching_assignments (org_id, year_id, teacher_id, class_id, subject)
  select sch, yr, t.id, c.id, t.subject from teachers t join classes c on c.grade = t.grade where t.org_id = sch;

  insert into equipment_types (org_id, sku, name, brand, category) values (sch,'ROBOT-MBOT-01','Robot lập trình Mbot','Makeblock','Robot') returning id into t_mbot;
  insert into equipment_types (org_id, sku, name, brand, category) values (sch,'ARD-STARTER','Bộ mạch Arduino Starter','Arduino','Vi điều khiển') returning id into t_ard;
  insert into equipment_types (org_id, sku, name, brand, category) values (sch,'IOT-GW','Kit cảm biến IoT + Gateway','KDI Education','IoT') returning id into t_iot;

  insert into equipment_units (org_id, type_id, room_id, serial, status, warranty_until) values
    (sch,t_mbot,r1,'MBOT-0001','available','2028-08-31'), (sch,t_mbot,r1,'MBOT-0002','in_use','2028-08-31'),
    (sch,t_mbot,r2,'MBOT-0003','broken','2028-08-31'),
    (sch,t_ard,r2,'ARD-0001','available','2027-08-31'), (sch,t_ard,r2,'ARD-0002','maintenance','2027-08-31'),
    (sch,t_iot,r3,'IOT-0001','available','2027-08-31'), (sch,t_iot,null,'IOT-0002','in_stock','2027-08-31');
end $$;
