-- 160: Chủ đề chia theo phần của học phần.
-- Một học phần có thể xuất hiện nhiều lần trong cùng khối của một gói (VD Gói 1: Sáng chế ở cả HP1 và HP2).
-- part = 1/2: chủ đề thuộc lần thứ 1/2 học phần xuất hiện trong khối; để trống = dùng chung cho mọi lần.
-- Khối chưa chia phần (không chủ đề nào có part) thì mọi lần đều dùng toàn bộ chủ đề như trước.
alter table program_topics add column if not exists part smallint;
alter table program_topics drop constraint if exists program_topics_part;
alter table program_topics add constraint program_topics_part check (part is null or part in (1, 2));
comment on column program_topics.part is 'Phần của học phần: 1 = HP1, 2 = HP2, trống = dùng chung';

notify pgrst, 'reload schema';
