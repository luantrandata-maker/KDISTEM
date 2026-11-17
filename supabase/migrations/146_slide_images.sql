-- 146: Kho ảnh cho slide bài giảng (bucket công khai "slide-images").
-- Ảnh slide cần đường dẫn cố định để hiện được khi trình chiếu, khi trường khác nhận bài
-- và ở màn học sinh, nên không dùng liên kết có hạn của "learning-files".
-- Đường dẫn: <id đơn vị>/<mã ngẫu nhiên>.<đuôi>. Ai có đường dẫn đều xem được ảnh;
-- chỉ cán bộ của đơn vị đó được tải lên / thay / xoá (dùng lại learning_file_writable của 058).
do $st$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'Bỏ qua kho ảnh slide: không có schema storage'; return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('slide-images', 'slide-images', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  begin
    execute $p$drop policy if exists slide_images_insert on storage.objects$p$;
    execute $p$create policy slide_images_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'slide-images' and public.learning_file_writable(name))$p$;
    execute $p$drop policy if exists slide_images_update on storage.objects$p$;
    execute $p$create policy slide_images_update on storage.objects for update to authenticated
      using (bucket_id = 'slide-images' and public.learning_file_writable(name))
      with check (bucket_id = 'slide-images' and public.learning_file_writable(name))$p$;
    execute $p$drop policy if exists slide_images_delete on storage.objects$p$;
    execute $p$create policy slide_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'slide-images' and public.learning_file_writable(name) and (owner = auth.uid() or public.is_admin() or public.is_authority()))$p$;
  exception when insufficient_privilege then
    raise warning 'Không tạo được chính sách cho storage.objects — tạo lại bằng SQL Editor với quyền chủ bảng';
  end;
end $st$;
