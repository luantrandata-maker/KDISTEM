-- 062. Danh mục chương trình STEM CT1–CT5 (Phân hệ 2)
--  • Mỗi mã CT1–CT5 có tên, tên đầy đủ, mô tả, các môn học trong chương trình, cấp học áp dụng.
--  • Quản trị nền tảng (KDI) sửa được; mọi người dùng đã đăng nhập đọc được (thẻ CT1–CT5 ở Sở, chọn CT khi soạn chương trình…).
--  • Mã CT1–CT5 giữ cố định vì nhiều bảng đang dùng (edu_programs.ct_code, học liệu, lịch phòng…).
-- Cần chạy sau 061.

create table if not exists stem_tracks (
  code text primary key check (code in ('CT1', 'CT2', 'CT3', 'CT4', 'CT5')),
  name text not null check (length(btrim(name)) between 1 and 80),            -- tên ngắn: "Tích hợp nội môn"
  title text not null check (length(btrim(title)) between 1 and 160),         -- tên đầy đủ: "STEM Tích hợp nội môn"
  description text not null default '',
  subjects text[] not null default '{}',                                      -- các môn học trong chương trình
  levels text[] not null default '{}' check (levels <@ array['mamnon', 'tieuhoc', 'thcs', 'thpt', 'thpt_nghe']),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function public.stem_tracks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name); new.title := btrim(new.title); new.description := btrim(coalesce(new.description, ''));
  new.subjects := array(select x from (select distinct on (lower(btrim(s))) btrim(s) x, o from unnest(new.subjects) with ordinality u(s, o)
                                        where btrim(s) <> '' order by lower(btrim(s)), o) d order by o);
  new.levels := array(select l from unnest(array['mamnon', 'tieuhoc', 'thcs', 'thpt', 'thpt_nghe']) l where l = any(new.levels));
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists stem_tracks_guard on stem_tracks;
create trigger stem_tracks_guard before insert or update on stem_tracks for each row execute function public.stem_tracks_guard();

alter table stem_tracks enable row level security;
drop policy if exists stem_tracks_read on stem_tracks;
create policy stem_tracks_read on stem_tracks for select to authenticated using (true);
drop policy if exists stem_tracks_update on stem_tracks;
create policy stem_tracks_update on stem_tracks for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
grant select, update on stem_tracks to authenticated;

-- Nội dung ban đầu (danh mục, không phải dữ liệu mẫu)
insert into stem_tracks (code, name, title, description, subjects, levels) values
  ('CT1', 'Tích hợp nội môn', 'STEM Tích hợp nội môn', 'Giảng dạy từng môn theo hướng thực tiễn, ứng dụng sáng tạo.',
   '{Toán STEM,Lý STEM,Hóa STEM,Sinh STEM,Khoa học TN STEM,Tin học STEM}', '{mamnon,tieuhoc,thcs,thpt,thpt_nghe}'),
  ('CT2', 'Liên môn', 'STEM Liên môn', 'Vận dụng kiến thức liên môn để giải quyết vấn đề thực tiễn.',
   '{Toán STEM,Lý STEM,Hóa STEM,Sinh STEM,Công nghệ STEM}', '{thcs,thpt}'),
  ('CT3', 'Đổi mới sáng tạo', 'STEM Đổi mới sáng tạo', 'Hoạt động sáng tạo, làm sản phẩm cụ thể.',
   '{CLB Sáng tạo,Ngoại khóa STEM,Làm sản phẩm}', '{tieuhoc,thcs,thpt}'),
  ('CT4', 'Robotic / AI', 'STEM Robotic · AI · Trải nghiệm', 'STEM định hướng đổi mới sáng tạo: Robotic, AI, Trải nghiệm.',
   '{Robotic,AI & Lập trình,IoT}', '{thcs,thpt,thpt_nghe}'),
  ('CT5', 'Nghiên cứu khoa học', 'STEM Nghiên cứu khoa học', 'Tập trung nghiên cứu khoa học độc lập.',
   '{NCKH,Dự án Nghiên cứu}', '{thcs,thpt}')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
