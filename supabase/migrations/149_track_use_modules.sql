-- 149: Loại chương trình có chia học phần hay không. Tắt (CT1 Bài học STEM, CT4 NCKH): giao diện chỉ hiện chủ đề theo khối,
-- không hiện tầng học phần (dữ liệu vẫn nằm trong một học phần ẩn "CHUNG" để gói STEM, PPCT dùng chung một cách).
alter table stem_tracks add column if not exists use_modules boolean not null default true;
comment on column stem_tracks.use_modules is 'true: chương trình chia theo học phần; false: chỉ có chủ đề theo khối (học phần ẩn CHUNG)';
update stem_tracks set use_modules = false where code in ('CT1', 'CT4');
notify pgrst, 'reload schema';
