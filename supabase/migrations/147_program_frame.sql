-- 147. Khung chương trình mới (Phân hệ 1 · Chương trình & học liệu, nhóm việc A — 18/11/2026)
--  Cấu trúc: Gói STEM → Loại chương trình (4 loại) → Học phần → Chủ đề (gắn một khối) → 6 nội dung (làm ở bước sau).
--  • stem_tracks (loại chương trình): còn 4 loại CT1–CT4 theo file "Hiểu Đề án STEM 2026" của bộ phận chương trình
--      CT1 Bài học STEM · CT2 Trải nghiệm STEM cơ bản · CT3 Trải nghiệm STEM nâng cao · CT4 Nghiên cứu khoa học, kĩ thuật.
--    CT5 cũ bỏ hẳn: dữ liệu đang ghi CT5 chuyển sang CT4 (Nghiên cứu khoa học, cùng nội dung với CT5 cũ) rồi xoá CT5.
--    Thêm thông tin của loại (hình thức, hoạt động giáo dục, người dạy, đối tượng HS, thời lượng, lưu ý / căn cứ) và
--    các THIẾT LẬP KDI tự bật / tắt cho từng loại, không cố định theo tên loại:
--      school_pick_topics   trường được bật / tắt từng chủ đề (dự kiến: CT1)
--      school_arrange_ppct  trường (hoặc Sở / Phòng) được tự xếp tuần trong phân phối chương trình
--      schedule_mode        cách dạy & xếp lịch: 'subject' dạy trong tiết môn học · 'timetable' xếp TKB riêng · 'register' HS đăng ký tự nguyện
--    Không trường nào được đổi thứ tự chủ đề, học phần (quy tắc chung, không phải thiết lập).
--  • program_modules (học phần): thuộc một loại, dùng chung cho mọi khối và mọi gói (VD: Sáng chế, Lập trình cơ bản; CT1 và CT4
--    dùng học phần CHUNG). Danh mục ban đầu lấy từ file của bộ phận chương trình; KDI sửa trên giao diện.
--  • program_topics (chủ đề / dự án): thuộc một học phần, gắn MỘT khối, có thứ tự, số tiết, mục tiêu, môn chủ trì, môn phối hợp,
--    bài SGK liên quan (cho chương trình dạy trong tiết môn học). Phiên bản và 6 nội dung của chủ đề làm ở các bước sau.
--  • material_groups (nhóm vật tư): Nhóm 1, 2, 3 — KDI đặt tên, thêm, bớt. Là nhóm VẬT TƯ, không phải nhóm học sinh.
--  Đọc: mọi người đã đăng nhập (giới hạn theo Gói STEM của trường làm ở bước gán gói). Sửa: quản trị nền tảng KDI.
-- Cần chạy sau 146.

-- ===== 1. Loại chương trình: thông tin + thiết lập =====
alter table stem_tracks
  add column if not exists form text not null default '',
  add column if not exists edu_activity text not null default '',
  add column if not exists teachers text not null default '',
  add column if not exists audience text not null default '',
  add column if not exists duration text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists school_pick_topics boolean not null default false,
  add column if not exists school_arrange_ppct boolean not null default true,
  add column if not exists schedule_mode text not null default 'timetable';
alter table stem_tracks drop constraint if exists stem_tracks_edu_activity_check;
alter table stem_tracks add constraint stem_tracks_edu_activity_check check (edu_activity in ('', 'chinh_khoa', 'tang_cuong', 'theo_nhu_cau'));
alter table stem_tracks drop constraint if exists stem_tracks_schedule_mode_check;
alter table stem_tracks add constraint stem_tracks_schedule_mode_check check (schedule_mode in ('subject', 'timetable', 'register'));

create or replace function public.stem_tracks_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.code <> old.code then
    raise exception 'Không đổi mã loại chương trình sau khi tạo' using errcode = '22023';
  end if;
  new.code := upper(btrim(new.code));
  new.name := btrim(new.name); new.title := btrim(new.title); new.description := btrim(coalesce(new.description, ''));
  new.form := btrim(coalesce(new.form, '')); new.teachers := btrim(coalesce(new.teachers, ''));
  new.audience := btrim(coalesce(new.audience, '')); new.duration := btrim(coalesce(new.duration, ''));
  new.notes := btrim(coalesce(new.notes, '')); new.edu_activity := coalesce(new.edu_activity, '');
  new.subjects := array(select x from (select distinct on (lower(btrim(s))) btrim(s) x, o from unnest(new.subjects) with ordinality u(s, o)
                                        where btrim(s) <> '' order by lower(btrim(s)), o) d order by o);
  new.levels := array(select l from unnest(array['mamnon', 'tieuhoc', 'thcs', 'thpt', 'thpt_nghe']) l where l = any(new.levels));
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- 4 loại theo file của bộ phận chương trình (sheet Overview)
insert into stem_tracks (code, name, title, description, subjects, levels, sort, active) values
  ('CT1', 'Bài học STEM', 'Bài học STEM', '', '{}', '{tieuhoc,thcs,thpt}', 1, true),
  ('CT2', 'Trải nghiệm STEM cơ bản', 'Trải nghiệm STEM cơ bản', '', '{}', '{tieuhoc,thcs,thpt}', 2, true),
  ('CT3', 'Trải nghiệm STEM nâng cao', 'Trải nghiệm STEM nâng cao', '', '{}', '{tieuhoc,thcs,thpt}', 3, true),
  ('CT4', 'Nghiên cứu khoa học, kĩ thuật', 'Nghiên cứu khoa học, kĩ thuật', '', '{}', '{tieuhoc,thcs,thpt}', 4, true)
on conflict (code) do nothing;

update stem_tracks set name = 'Bài học STEM', title = 'Bài học STEM', sort = 1, active = true,
  form = 'Bài học STEM', edu_activity = 'chinh_khoa', teachers = 'Giáo viên môn học', audience = 'Tất cả học sinh',
  duration = 'Trong thời lượng môn học; THPT được dùng tiết chuyên đề học tập. Không tăng tổng số tiết (TT86 Đ7 k1d).',
  description = 'Dạy bài học của một môn hoặc nhiều môn theo phương thức STEM, xuất phát từ yêu cầu cần đạt của môn và SGK. Bài học STEM liên môn ghi rõ môn chủ trì, môn phối hợp và minh chứng đánh giá (TT86 Đ7 k1e).',
  notes = E'Thiết bị: danh mục TBDH tối thiểu và vật liệu dễ tìm, an toàn (TT86 Đ7 k1đ), tương ứng Mức 1 (TT86 Đ13 k3a).\nĐánh giá theo quy định đánh giá môn học hiện hành, không có điểm STEM riêng (TT86 Đ11).\nMôn trọng tâm: KHTN, Công nghệ, Tin học, Toán; có thể mở rộng STEAM (TT86 Đ6).\nCăn cứ: TT86 Đ3, Đ7 k1.',
  subjects = '{Toán,Tự nhiên và Xã hội,Khoa học,Khoa học tự nhiên,Vật lí,Hóa học,Sinh học}', levels = '{tieuhoc,thcs,thpt}',
  school_pick_topics = true, school_arrange_ppct = true, schedule_mode = 'subject'
 where code = 'CT1';
update stem_tracks set name = 'Trải nghiệm STEM cơ bản', title = 'Trải nghiệm STEM cơ bản', sort = 2, active = true,
  form = 'Trải nghiệm STEM', edu_activity = 'tang_cuong', teachers = 'Giáo viên của trường; có thể huy động chuyên gia (TT85 Đ6 k3)',
  audience = 'Tất cả học sinh (bảo đảm mọi HS được tiếp cận, TT85 Đ3 k2)',
  duration = 'Buổi 2 của chương trình 2 buổi/ngày, ngoài thời lượng chính khóa; 1 tiết/tuần, 32 tiết/khối/năm học, 2 học phần.',
  description = 'Chủ đề, dự án trải nghiệm STEM tiếp nối, mở rộng bài học STEM ở mức vận dụng: thiết kế, chế tạo, lập trình, thử nghiệm (TT86 Đ7 k2b).',
  notes = E'Không thu tiền HS; không dạy trước, dạy lại, ôn luyện (TT85 Đ3 k2, Đ14 k1a). Không phát sinh môn mới, không tăng YCCĐ (TT85 Đ6 k1).\nThiết bị: Mức 2, bổ sung từ danh mục khung (TT86 Đ13 k3b).\nHọc phần học theo thứ tự gợi ý.',
  levels = '{tieuhoc,thcs,thpt}', school_pick_topics = false, school_arrange_ppct = true, schedule_mode = 'timetable'
 where code = 'CT2';
update stem_tracks set name = 'Trải nghiệm STEM nâng cao', title = 'Trải nghiệm STEM nâng cao', sort = 3, active = true,
  form = 'Trải nghiệm STEM', edu_activity = 'theo_nhu_cau', teachers = 'GV Tin học, Công nghệ và GV có khả năng; đối tác, chuyên gia (thẩm định theo TT85 Đ10)',
  audience = 'Học sinh đăng ký tự nguyện',
  duration = 'Ngoài thời gian chính khóa và tăng cường, không xen kẽ tiết chính khóa và tăng cường (TT85 Đ7 k3); 1 tiết/tuần, 32 tiết/khối/năm học, 2 học phần.',
  description = 'Giáo dục STEM về lập trình, robot, AI, IoT và giáo dục STEM ngoài nhà trường (TT86 Đ8).',
  notes = E'Mức độ do nhà trường quyết định (TT86 Đ6); GD STEM ngoài nhà trường cần thỏa thuận với đối tác, cha mẹ HS đồng ý, phương án an toàn (TT86 Đ8; TT85 Đ13 k3).\nTiến trình theo cấp: TH lập trình trực quan; THCS lập trình điều khiển; THPT lập trình nhúng, IoT, KHDL, AI (TT86 Đ4).\nChuyên sâu thu tự nguyện theo mức UBND tỉnh, chỉ tổ chức khi đã đủ chính khóa và tăng cường (TT85 Đ7 k2b, k3a; Đ14 k1b).\nThiết bị: Mức 2–3 (TT86 Đ13 k3).',
  levels = '{tieuhoc,thcs,thpt}', school_pick_topics = false, school_arrange_ppct = true, schedule_mode = 'register'
 where code = 'CT3';
update stem_tracks set name = 'Nghiên cứu khoa học, kĩ thuật', title = 'Nghiên cứu khoa học, kĩ thuật', sort = 4, active = true,
  form = 'Nghiên cứu khoa học, kĩ thuật', edu_activity = 'theo_nhu_cau',
  teachers = 'GV trường có khả năng; nhà khoa học, chuyên gia (không cần là người của trường, TT86 Đ12)',
  audience = 'HS có năng khiếu, hứng thú, đăng ký tự nguyện; CLB. Tiểu học chỉ ở mức làm quen (TT86 Đ7 k3a).',
  duration = 'Ngoài thời gian chính khóa và tăng cường.',
  description = 'Đề tài, dự án nghiên cứu khoa học của cá nhân hoặc nhóm, có giáo viên / nhà khoa học hướng dẫn.',
  notes = E'HS được phát hiện qua bài học STEM và trải nghiệm STEM (TT86 Đ7 k3a).\nCLB, ngày hội STEM, hội thi cấp trường; hội thi và số giải không phải tiêu chí bắt buộc (TT86 Đ7 k3).\nKết quả để ghi nhận, động viên, không thay thế kết quả môn học (TT86 Đ11).\nThiết bị: Mức 3 (TT86 Đ13 k3c).',
  subjects = '{}', levels = '{tieuhoc,thcs,thpt}', school_pick_topics = false, school_arrange_ppct = true, schedule_mode = 'subject'
 where code = 'CT4';

-- CT5 cũ (Nghiên cứu khoa học) bỏ hẳn: dữ liệu chuyển sang CT4 rồi xoá. Tạm tắt trigger kiểm tra của các bảng
-- (chương trình đã ban hành, giáo án đã xuất bản… không cho sửa) trong lúc đổi mã.
do $$
declare
  t text; c text;
  fk text[][] := array[['edu_programs', 'ct_code'], ['lesson_plans', 'program'], ['library_items', 'program'], ['activities', 'program'],
                       ['class_topics', 'program'], ['class_programs', 'program'], ['stem_teacher_programs', 'program']];
  i int;
begin
  if not exists (select 1 from stem_tracks where code = 'CT5') then return; end if;
  -- Bảng có khoá (lớp / GV, chương trình): đã có CT4 thì bỏ dòng CT5 trùng trước khi đổi mã
  if to_regclass('public.class_programs') is not null then
    delete from class_programs a where a.program = 'CT5' and exists (select 1 from class_programs b where b.class_id = a.class_id and b.program = 'CT4');
  end if;
  if to_regclass('public.stem_teacher_programs') is not null then
    delete from stem_teacher_programs a where a.program = 'CT5' and exists (select 1 from stem_teacher_programs b where b.teacher_id = a.teacher_id and b.program = 'CT4');
  end if;
  for i in 1 .. array_length(fk, 1) loop
    t := fk[i][1]; c := fk[i][2];
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set %I = ''CT4'' where %I = ''CT5''', t, c, c);
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  -- Cột mảng / cột chữ không có khoá ngoại
  alter table edu_programs disable trigger user;
  update edu_programs set ct_codes = public.text_array_clean(array_replace(ct_codes, 'CT5', 'CT4')) where 'CT5' = any(ct_codes);
  alter table edu_programs enable trigger user;
  if to_regclass('public.training_programs') is not null then
    alter table training_programs disable trigger user;
    update training_programs set ct_codes = public.text_array_clean(array_replace(ct_codes, 'CT5', 'CT4')),
           ct_code = case when ct_code = 'CT5' then 'CT4' else ct_code end
     where 'CT5' = any(ct_codes) or ct_code = 'CT5';
    alter table training_programs enable trigger user;
  end if;
  update subjects set ct_codes = public.text_array_clean(array_replace(ct_codes, 'CT5', 'CT4')) where 'CT5' = any(ct_codes);
  if to_regclass('public.stem_registrations') is not null then
    update stem_registrations set program = 'CT4' where program = 'CT5';
  end if;
  delete from stem_tracks where code = 'CT5';
end $$;

-- ===== 2. Nhóm vật tư =====
create table if not exists material_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists material_groups_name on material_groups (lower(btrim(name)));

-- ===== 3. Học phần =====
create table if not exists program_modules (
  id uuid primary key default gen_random_uuid(),
  track_code text not null references stem_tracks(code),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists program_modules_name on program_modules (track_code, lower(btrim(name)));
create index if not exists program_modules_track on program_modules (track_code, sort);

-- ===== 4. Chủ đề =====
create table if not exists program_topics (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references program_modules(id) on delete restrict,
  grade int not null check (grade between -4 and 12 and grade <> 0),
  seq int not null default 1 check (seq between 1 and 999),
  code text check (code is null or length(code) <= 40),
  title text not null check (length(btrim(title)) between 1 and 200),
  periods int not null default 1 check (periods between 0 and 200),
  objectives text not null default '',
  main_subject text,
  subjects text[] not null default '{}',          -- môn phối hợp
  textbook_ref text not null default '',          -- bài SGK liên quan / có thể thay (chương trình dạy trong tiết môn học)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists program_topics_module on program_topics (module_id, grade, seq);

-- Chuẩn hoá chữ, ghi người sửa
create or replace function public.program_frame_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'program_topics' then
    new.title := btrim(new.title); new.code := nullif(btrim(coalesce(new.code, '')), '');
    new.objectives := btrim(coalesce(new.objectives, '')); new.textbook_ref := btrim(coalesce(new.textbook_ref, ''));
    new.main_subject := nullif(btrim(coalesce(new.main_subject, '')), '');
    new.subjects := array(select x from (select distinct on (lower(btrim(s))) btrim(s) x, o from unnest(new.subjects) with ordinality u(s, o)
                                          where btrim(s) <> '' and lower(btrim(s)) is distinct from lower(new.main_subject)
                                          order by lower(btrim(s)), o) d order by o);
  else
    new.name := btrim(new.name); new.description := btrim(coalesce(new.description, ''));
  end if;
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists material_groups_touch on material_groups;
create trigger material_groups_touch before insert or update on material_groups for each row execute function public.program_frame_touch();
drop trigger if exists program_modules_touch on program_modules;
create trigger program_modules_touch before insert or update on program_modules for each row execute function public.program_frame_touch();
drop trigger if exists program_topics_touch on program_topics;
create trigger program_topics_touch before insert or update on program_topics for each row execute function public.program_frame_touch();

-- ===== 5. Quyền =====
do $$
declare t text;
begin
  foreach t in array array['material_groups', 'program_modules', 'program_topics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin())', t || '_write', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ===== 6. Danh mục ban đầu (từ file của bộ phận chương trình; chỉ thêm khi bảng còn trống) =====
insert into material_groups (name, sort)
select x.name, x.sort from (values ('Nhóm 1', 1), ('Nhóm 2', 2), ('Nhóm 3', 3)) x(name, sort)
 where not exists (select 1 from material_groups);

insert into program_modules (track_code, name, description, sort)
select x.track, x.name, x.descr, x.sort from (values
  ('CT1', 'CHUNG', 'Học phần chung của Bài học STEM: 10 chủ đề mỗi khối mỗi năm, bám sát chương trình môn Toán, TNXH, Khoa học, KHTN, Lý, Hóa, Sinh.', 1),
  ('CT2', 'Sáng chế', '', 1),
  ('CT2', 'Lắp ráp với Strawbees', '', 2),
  ('CT2', 'Thiết kế với Canva', '', 3),
  ('CT2', 'Lập trình cơ bản', '', 4),
  ('CT2', 'Lập trình tự động hóa', '', 5),
  ('CT2', 'Lập trình Python', '', 6),
  ('CT2', 'Lập trình tự động hóa & IoT', '', 7),
  ('CT2', 'AI cốt lõi', '12 tiết/khối/năm học.', 8),
  ('CT2', 'Chuyển đổi số cơ bản', '', 9),
  ('CT3', 'Lập trình không máy tính với robot', '', 1),
  ('CT3', 'Làm quen với lập trình', '', 2),
  ('CT3', 'Lập trình robot', '', 3),
  ('CT3', 'Thiết kế 3D', 'Trường tiểu học không đầu tư máy in 3D có thể thay bằng Lập trình robot.', 4),
  ('CT3', 'Thiết kế với AI', '', 5),
  ('CT3', 'Ứng dụng AI trong thực tiễn', '', 6),
  ('CT3', 'Lập trình AI cơ bản', '', 7),
  ('CT3', 'Lập trình ứng dụng AI', '', 8),
  ('CT3', 'Lập trình tự động hóa & IoT', '', 9),
  ('CT3', 'Lập trình AI cho thiết bị', '', 10),
  ('CT3', 'Phát triển ứng dụng di động', '', 11),
  ('CT3', 'Lập trình AIoT', '', 12),
  ('CT3', 'Phát triển ứng dụng với AI', '', 13),
  ('CT4', 'CHUNG', 'Học phần chung của Nghiên cứu khoa học, kĩ thuật.', 1)
) x(track, name, descr, sort)
 where not exists (select 1 from program_modules)
   and exists (select 1 from stem_tracks t where t.code = x.track);

notify pgrst, 'reload schema';
