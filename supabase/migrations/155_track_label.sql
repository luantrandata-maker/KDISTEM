-- 155: mã hiển thị của loại chương trình.
-- Mã gốc (CT1…CT4…) là khoá nối với chương trình, giáo án, học liệu, lớp, gói… nên giữ nguyên.
-- KDI đặt "mã hiển thị" ở Danh mục → Loại chương trình; để trống thì các màn dùng mã gốc.
alter table stem_tracks add column if not exists label text not null default '';

do $$ begin
  alter table stem_tracks add constraint stem_tracks_label_check check (label = '' or label ~ '^[^\s].{0,11}$');
exception when duplicate_object then null; end $$;

-- Hai loại không dùng chung một mã hiển thị (không phân biệt hoa thường)
create unique index if not exists stem_tracks_label_uq on stem_tracks (upper(label)) where label <> '';

create or replace function public.stem_tracks_label_trim() returns trigger
language plpgsql set search_path = public as $$
begin
  new.label := btrim(coalesce(new.label, ''));
  return new;
end $$;
drop trigger if exists stem_tracks_label_trim on stem_tracks;
create trigger stem_tracks_label_trim before insert or update on stem_tracks for each row execute function public.stem_tracks_label_trim();
