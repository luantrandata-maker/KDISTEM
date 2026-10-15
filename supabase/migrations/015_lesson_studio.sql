-- 015. Soạn bài giảng tương tác, trình chiếu trên lớp, mượn thiết bị của giáo viên.
-- Cần chạy sau 013.

-- ===== 1. Bài giảng tương tác =====
-- slides: mảng JSON, mỗi phần tử:
--   { "id": "s1", "kind": "title|content|question|task|media", "title": "...", "body": "...",
--     "options": ["A","B"], "answer": 0, "url": "https://...", "minutes": 5 }
create table lesson_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  teacher_id uuid references teachers(id) on delete set null,
  title text not null,
  subject text,
  grades text,                                   -- '6,7' …
  program text check (program in ('CT1','CT2','CT3','CT4','CT5')),
  from_package boolean not null default false,   -- thuộc nội dung Gói STEM
  is_template boolean not null default false,    -- bài giảng mẫu của trường
  status text not null default 'draft' check (status in ('draft','editing','published')),
  summary text,
  slides jsonb not null default '[]'::jsonb check (jsonb_typeof(slides) = 'array'),
  source_id uuid references lesson_plans(id) on delete set null,   -- tạo từ mẫu nào
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on lesson_plans (org_id, teacher_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger lesson_plans_touch before update on lesson_plans for each row execute function public.touch_updated_at();

alter table lesson_plans enable row level security;
-- Nhân sự: đọc bài đã xuất bản, bài mẫu và bài của mình; quản trị đọc tất cả trong trường
create policy lesson_plans_staff_read on lesson_plans for select to authenticated
  using (public.can_access_org(org_id) and public.is_staff()
         and (status = 'published' or is_template or teacher_id = public.my_teacher_id() or public.is_admin()));
create policy lesson_plans_owner_insert on lesson_plans for insert to authenticated
  with check (public.can_access_org(org_id)
    and ((teacher_id = public.my_teacher_id() and not is_template) or public.is_admin()));
create policy lesson_plans_owner_update on lesson_plans for update to authenticated
  using (public.can_access_org(org_id) and (teacher_id = public.my_teacher_id() or public.is_admin()))
  with check (public.can_access_org(org_id) and ((teacher_id = public.my_teacher_id() and not is_template) or public.is_admin()));
create policy lesson_plans_owner_delete on lesson_plans for delete to authenticated
  using (public.can_access_org(org_id) and (teacher_id = public.my_teacher_id() or public.is_admin()));

-- ===== 2. Phiên lớp gắn bài giảng, đồng bộ slide hiện tại =====
alter table class_sessions add column if not exists lesson_plan_id uuid references lesson_plans(id) on delete set null,
  add column if not exists current_slide int not null default 0;

-- Học sinh xem bài giảng đang được trình chiếu cho lớp mình
create policy lesson_plans_student_read on lesson_plans for select to authenticated
  using (public.is_student() and exists (select 1 from class_sessions s
         where s.lesson_plan_id = lesson_plans.id and s.class_id = public.my_class_id()));

drop function if exists public.start_class_session(uuid, text, uuid);
create or replace function public.start_class_session(p_class uuid, p_title text, p_lesson uuid default null, p_plan uuid default null)
returns class_sessions
language plpgsql security definer set search_path = public as $$
declare s class_sessions; v_pin text; v_org uuid; tries int := 0;
begin
  if not public.teaches_class(p_class) then raise exception 'Bạn không dạy lớp này'; end if;
  select org_id into v_org from classes where id = p_class;
  if p_plan is not null and not exists (select 1 from lesson_plans where id = p_plan and org_id = v_org) then
    raise exception 'Bài giảng không thuộc trường này';
  end if;
  update class_sessions set status = 'ended', ended_at = now() where class_id = p_class and status = 'live';
  loop
    v_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into class_sessions (org_id, teacher_id, class_id, lesson_id, lesson_plan_id, title, pin)
        values (v_org, public.my_teacher_id(), p_class, p_lesson, p_plan, coalesce(nullif(p_title,''), 'Tiết học STEM'), v_pin)
        returning * into s;
      return s;
    exception when unique_violation then
      tries := tries + 1; if tries > 20 then raise; end if;
    end;
  end loop;
end $$;
grant execute on function public.start_class_session(uuid, text, uuid, uuid) to authenticated;

-- Giáo viên chỉ được đổi slide hiện tại và kết thúc phiên (không đổi PIN, lớp)
create or replace function public.guard_class_session() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    new.pin := old.pin; new.class_id := old.class_id; new.org_id := old.org_id; new.teacher_id := old.teacher_id;
    new.started_at := old.started_at;
    if old.status = 'ended' then new.status := 'ended'; end if;
    if new.status = 'ended' and old.status = 'live' then new.ended_at := now(); end if;
  end if;
  return new;
end $$;
create trigger class_sessions_guard before update on class_sessions for each row execute function public.guard_class_session();

-- ===== 3. Mượn thiết bị: gắn lớp, danh sách thiết bị dạng cấu trúc =====
alter table borrow_requests add column if not exists class_id uuid references classes(id) on delete set null,
  add column if not exists item_list jsonb not null default '[]'::jsonb;   -- [{type_id, name, qty}]

-- ===== 4. Dữ liệu mẫu =====
do $$
declare sch uuid; tch uuid;
  s_intro jsonb;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from lesson_plans where org_id = sch) then return; end if;
  select id into tch from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn';

  -- Bài giảng mẫu của trường
  insert into lesson_plans (org_id, title, subject, grades, program, from_package, is_template, status, summary, slides) values
  (sch, 'Mẫu: Dự án STEM 5 bước (EDP)', 'STEM', '6,7,8,9', 'CT2', false, true, 'published',
   'Khung bài theo quy trình thiết kế kỹ thuật: Hỏi – Tưởng tượng – Lập kế hoạch – Chế tạo – Cải tiến.',
   '[{"id":"s1","kind":"title","title":"Tên dự án STEM","body":"Lớp … · Nhóm …"},
     {"id":"s2","kind":"content","title":"1. Đặt vấn đề","body":"Mô tả tình huống thực tế cần giải quyết.\nTiêu chí sản phẩm đạt yêu cầu."},
     {"id":"s3","kind":"question","title":"Khởi động","body":"Theo em, yếu tố nào quan trọng nhất khi thiết kế?","options":["Chi phí","Độ bền","Tính thẩm mỹ","An toàn"],"answer":3},
     {"id":"s4","kind":"task","title":"2. Lập kế hoạch theo nhóm","body":"Vẽ phác thảo, liệt kê vật liệu, phân công.","minutes":10},
     {"id":"s5","kind":"task","title":"3. Chế tạo & thử nghiệm","body":"Lắp ráp, đo kết quả, ghi vào phiếu.","minutes":20},
     {"id":"s6","kind":"content","title":"4. Báo cáo & cải tiến","body":"Mỗi nhóm trình bày 2 phút: kết quả, khó khăn, cải tiến."}]'::jsonb),
  (sch, 'Mẫu: Tiết thực hành với thiết bị', 'Công nghệ', '6,7,8,9', 'CT4', true, true, 'published',
   'Khung tiết thực hành: an toàn – hướng dẫn – thực hành – kiểm tra.',
   '[{"id":"s1","kind":"title","title":"Thực hành: …","body":"Thiết bị: …"},
     {"id":"s2","kind":"content","title":"Quy tắc an toàn","body":"Kiểm tra nguồn điện trước khi lắp.\nKhông chạm vào linh kiện đang nóng.\nTrả thiết bị đúng vị trí."},
     {"id":"s3","kind":"media","title":"Video hướng dẫn","body":"Xem trước khi thực hành","url":""},
     {"id":"s4","kind":"task","title":"Nhiệm vụ","body":"Lắp mạch theo sơ đồ và chụp ảnh kết quả.","minutes":25},
     {"id":"s5","kind":"question","title":"Kiểm tra nhanh","body":"Đèn LED cần mắc thêm linh kiện nào để không bị cháy?","options":["Tụ điện","Điện trở","Cuộn cảm","Công tắc"],"answer":1}]'::jsonb);

  if tch is null then return; end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, from_package, status, summary, slides, updated_at) values
  (sch, tch, 'Mạch điện thông minh – nối tiếp hay song song?', 'Công nghệ', '8', 'CT4', false, 'published', 'So sánh hai cách mắc mạch qua thí nghiệm.',
   '[{"id":"s1","kind":"title","title":"Mạch điện thông minh","body":"Nối tiếp hay song song?"},
     {"id":"s2","kind":"question","title":"Dự đoán","body":"Khi một bóng đèn hỏng trong mạch nối tiếp, các bóng còn lại sẽ…","options":["Vẫn sáng","Tắt hết","Sáng hơn","Mờ đi"],"answer":1},
     {"id":"s3","kind":"task","title":"Thí nghiệm","body":"Lắp 2 mạch và đo hiệu điện thế mỗi bóng.","minutes":15},
     {"id":"s4","kind":"content","title":"Kết luận","body":"Mạch song song dùng trong nhà vì các thiết bị hoạt động độc lập."}]'::jsonb, now() - interval '3 days'),
  (sch, tch, 'Đo lường trong phòng thí nghiệm – dùng giáo cụ ảo', 'Khoa học tự nhiên', '6', 'CT1', false, 'published', 'Làm quen dụng cụ đo và sai số.',
   '[{"id":"s1","kind":"title","title":"Đo lường trong phòng thí nghiệm","body":"KHTN 6"},
     {"id":"s2","kind":"content","title":"Dụng cụ đo","body":"Thước, cân điện tử, ống đong, nhiệt kế."},
     {"id":"s3","kind":"task","title":"Đo và ghi kết quả","body":"Mỗi nhóm đo 3 lần, tính trung bình.","minutes":15}]'::jsonb, now() - interval '6 days'),
  (sch, tch, 'Đòn bẩy và bài toán tối ưu lực – liên môn Toán · Vật lý', 'Vật lý', '8', 'CT2', true, 'editing', 'Tiết liên môn: mô men lực và tỉ lệ.',
   '[{"id":"s1","kind":"title","title":"Đòn bẩy","body":"Liên môn Toán · Vật lý"},
     {"id":"s2","kind":"content","title":"Điều kiện cân bằng","body":"F1 × d1 = F2 × d2"}]'::jsonb, now() - interval '5 hours'),
  (sch, tch, 'Hệ Mặt Trời và chuyển động của các hành tinh', 'Khoa học tự nhiên', '7', 'CT1', false, 'draft', null,
   '[{"id":"s1","kind":"title","title":"Hệ Mặt Trời","body":""}]'::jsonb, now() - interval '2 days'),
  (sch, tch, 'Thử thách con lắc – đo thời gian thật chính xác', 'STEM sáng tạo', '6', 'CT3', false, 'published', 'Chu kỳ con lắc phụ thuộc chiều dài dây.',
   '[{"id":"s1","kind":"title","title":"Thử thách con lắc","body":"Đo thời gian thật chính xác"},
     {"id":"s2","kind":"question","title":"Dự đoán","body":"Dây dài hơn thì con lắc dao động…","options":["Nhanh hơn","Chậm hơn","Không đổi"],"answer":1},
     {"id":"s3","kind":"task","title":"Đo 10 chu kỳ","body":"Thay đổi chiều dài dây 3 lần, ghi kết quả.","minutes":20}]'::jsonb, now() - interval '11 days'),
  (sch, tch, 'Nhà thông minh với Arduino – mô đun cảm biến', 'Tin học', '9', 'CT4', true, 'draft', null,
   '[{"id":"s1","kind":"title","title":"Nhà thông minh với Arduino","body":"Mô đun cảm biến"}]'::jsonb, now() - interval '19 hours');
end $$;
