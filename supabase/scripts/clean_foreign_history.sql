-- Dọn lịch sử migration do công cụ khác ghi (version 14 chữ số, vd 20261014083903 từ Supabase MCP / dashboard)
-- để Supabase CLI dùng được bảng lịch sử. CHỈ đụng bảng lịch sử, không chạy lại hay huỷ migration nào.
-- Sao lưu trước sang supabase_migrations.schema_migrations_backup_20261017; chạy lại nhiều lần vẫn an toàn.
begin;
create table if not exists supabase_migrations.schema_migrations_backup_20261017 as
  table supabase_migrations.schema_migrations;
delete from supabase_migrations.schema_migrations where version ~ '^[0-9]{14}$';
commit;
-- Kết quả: các bản ghi đã sao lưu (đã xoá khỏi lịch sử) và số bản ghi còn lại trong lịch sử
select b.version, b.name,
       (select count(*) from supabase_migrations.schema_migrations) as con_lai_trong_lich_su
from supabase_migrations.schema_migrations_backup_20261017 b
order by b.version;
