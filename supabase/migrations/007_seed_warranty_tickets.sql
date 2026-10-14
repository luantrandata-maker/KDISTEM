-- Ticket bảo hành mẫu (chỉ chạy khi chưa có ticket nào)
do $$
declare sch uuid;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from warranty_tickets where org_id = sch) then return; end if;
  insert into warranty_tickets (org_id, code, unit_id, description, status, created_at)
  select sch, v.code, u.id, v.descr, v.status, v.created::timestamptz
  from (values
    ('WT-2026-0001','MBOT-0003','Bánh xe trái không quay sau khi pin đầy, cổng Bluetooth không kết nối được','processing','2026-10-09'),
    ('WT-2026-0002','ARD-0002','Mạch Arduino UNO R3 không nhận nguồn từ USB, đèn LED nguồn không sáng','accepted','2026-10-11'),
    ('WT-2026-0003','IOT-0001','Cảm biến nhiệt độ trả về giá trị sai lệch khoảng 15°C so với thực tế','new','2026-10-13'),
    ('WT-2026-0004','MBOT-0002','Cảm biến siêu âm báo khoảng cách không ổn định, đã thay pin vẫn lỗi','resolved','2026-09-28')
  ) as v(code, serial, descr, status, created)
  join equipment_units u on u.serial = v.serial and u.org_id = sch;
end $$;
