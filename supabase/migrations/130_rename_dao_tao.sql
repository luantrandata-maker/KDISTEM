-- 130. Đổi chữ "tập huấn" thành "đào tạo" ở những chỗ hệ thống tự sinh ra (04/11).
-- Không đổi tên bảng, cột, hàm (training_*), mã CTTH-/KHTH-, và dữ liệu người dùng tự gõ
-- (tên chương trình, kế hoạch, bài giảng, khung năng lực...).

-- 1. Lời nhắn lỗi và nội dung thông báo trong các hàm: viết lại hàm, chỉ thay chữ.
do $$
declare f record; d text;
begin
  for f in
    select p.oid from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and p.prosrc ~ '[Tt]ập huấn'
      and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')
  loop
    d := pg_get_functiondef(f.oid);
    execute replace(replace(d, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo');
  end loop;
end $$;

-- 2. Mẫu chứng chỉ: chữ mặc định và các mẫu đang còn chữ cũ
alter table certificate_templates alter column body
  set default 'Đã hoàn thành chương trình đào tạo {chuong_trinh} ({so_gio} giờ) thuộc {ke_hoach}.';
update certificate_templates
   set title = replace(replace(title, 'tập huấn', 'đào tạo'), 'TẬP HUẤN', 'ĐÀO TẠO'),
       body = replace(replace(body, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo')
 where title ~* 'tập huấn|TẬP HUẤN' or body ~ '[Tt]ập huấn';

-- 3. Tên, mô tả hệ thống: phân hệ bán được, vai trò mặc định, gói dịch vụ
update service_modules
   set name = replace(replace(name, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo'),
       description = replace(replace(description, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo')
 where name ~ '[Tt]ập huấn' or description ~ '[Tt]ập huấn';
update roles
   set description = replace(replace(description, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo')
 where org_id is null and description ~ '[Tt]ập huấn';
update service_plans
   set description = replace(replace(description, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo')
 where description ~ '[Tt]ập huấn';

-- 4. Thông báo đã gửi: chữ và mục cần mở (giao diện cũng tự đổi tên mục cũ)
update notifications
   set title = replace(replace(title, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo'),
       body = replace(replace(body, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo'),
       page = replace(replace(page, 'tập huấn', 'đào tạo'), 'Tập huấn', 'Đào tạo')
 where title ~ '[Tt]ập huấn' or body ~ '[Tt]ập huấn' or page ~ '[Tt]ập huấn';
