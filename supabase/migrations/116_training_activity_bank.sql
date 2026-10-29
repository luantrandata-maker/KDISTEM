-- 116. Kho hoạt động của Đào tạo tập huấn: dùng chung bảng activities (trắc nghiệm, đúng / sai, nối cặp, sắp xếp, điền khuyết,
--  phân nhóm, thẻ ghi nhớ, phiếu học tập) như Kho hoạt động của Chương trình & học liệu, tách bằng cột domain.
--  • domain = 'school': hoạt động dạy học sinh (mặc định, mọi hoạt động cũ). domain = 'training': hoạt động dùng khi tập huấn giáo viên.
--  • Quyền đọc / ghi giữ nguyên chính sách của activities. Màn của trường và giáo viên chỉ lấy domain = 'school'.
-- Cần chạy sau 113.
alter table activities add column if not exists domain text not null default 'school';
do $$ begin
  alter table activities add constraint activities_domain_check check (domain in ('school', 'training'));
exception when duplicate_object then null; end $$;
create index if not exists activities_domain on activities (domain, updated_at desc);

notify pgrst, 'reload schema';
