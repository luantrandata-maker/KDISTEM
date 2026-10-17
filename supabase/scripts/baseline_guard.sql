-- Dùng trong CI (job migrate) trước khi chạy supabase db push. In ra 'ok' hoặc 'block'.
-- ok    : CSDL trống (chạy từ 001 là đúng), hoặc lịch sử migration đã có bản ghi 001 (đã baseline).
-- block : CSDL đã có bảng nghiệp vụ nhưng lịch sử không có 001 → db push sẽ chạy lại toàn bộ từ 001.
-- query_to_xml chỉ chạy khi bảng lịch sử tồn tại, nên không lỗi trên CSDL chưa có bảng này.
select case
  when to_regclass('public.organizations') is null then 'ok'
  when to_regclass('supabase_migrations.schema_migrations') is null then 'block'
  when (xpath('/row/n/text()', query_to_xml(
          'select count(*) as n from supabase_migrations.schema_migrations where version = ''001''',
          false, true, '')))[1]::text = '1' then 'ok'
  else 'block'
end;
