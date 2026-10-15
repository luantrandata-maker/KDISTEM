-- Đường dẫn phòng họp cho buổi tập huấn online
alter table training_sessions add column if not exists meeting_url text;
