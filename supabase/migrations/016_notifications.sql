-- 016. Thông báo trong ứng dụng (chuông trên thanh đầu trang).
-- Thông báo chỉ do trigger phía cơ sở dữ liệu tạo ra; người dùng chỉ đọc, đánh dấu đã đọc, xoá thông báo của mình.
-- Cần chạy sau 015.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,                 -- approval | status | submission | graded | assignment | invitation
  title text not null,
  body text,
  page text,                          -- mục menu cần mở khi bấm (vd 'Duyệt đăng ký dạy STEM')
  portal text,                        -- giao diện của mục đó: school_admin | teacher | student
  ref_id uuid,                        -- bản ghi liên quan (dùng để gộp thông báo)
  count int not null default 1,       -- số sự kiện đã gộp (vd 5 bài nộp mới)
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
create policy notifications_own_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on notifications for delete to authenticated using (user_id = auth.uid());

-- Người dùng chỉ đổi được read_at
create or replace function public.guard_notification() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.user_id := old.user_id; new.kind := old.kind; new.title := old.title; new.body := old.body;
    new.page := old.page; new.portal := old.portal; new.ref_id := old.ref_id; new.count := old.count;
    new.created_at := old.created_at; new.org_id := old.org_id;
  end if;
  return new;
end $$;
create trigger notifications_guard before update on notifications for each row execute function public.guard_notification();

-- ===== Hàm dùng nội bộ =====
-- Quyền của một người dùng bất kỳ (cùng logic với has_perm, nhưng cho user khác)
create or replace function public.user_has_perm(p_user uuid, p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  with u as (select org_id from profiles where id = p_user),
  mine as (select r.id as role_id, r.key, r.org_id from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_user)
  select exists (select 1 from mine where org_id is null and key in ('principal','it_admin'))
      or exists (
        select 1 from mine m
        left join org_role_permissions o on o.role_id = m.role_id and o.module = p_module and o.org_id = (select org_id from u)
        left join role_permissions d on d.role_id = m.role_id and d.module = p_module
        where case p_action
          when 'view' then coalesce(o.can_view, d.can_view, false)
          when 'edit' then coalesce(o.can_edit, d.can_edit, false)
          when 'create' then coalesce(o.can_create, d.can_create, false)
          when 'delete' then coalesce(o.can_delete, d.can_delete, false)
          else false end)
$$;

-- Gửi (hoặc gộp vào thông báo chưa đọc cùng loại, cùng bản ghi) cho một người
create or replace function public.notify_user(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text,
  p_page text, p_portal text, p_ref uuid, p_merge boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;   -- không tự báo cho người thực hiện
  if p_merge and p_ref is not null then
    update notifications set count = count + 1, body = p_body, created_at = now()
     where user_id = p_user and kind = p_kind and ref_id = p_ref and read_at is null;
    if found then return; end if;
  end if;
  insert into notifications (org_id, user_id, kind, title, body, page, portal, ref_id)
    values (p_org, p_user, p_kind, p_title, p_body, p_page, p_portal, p_ref);
end $$;

-- Gửi cho những người trong trường có quyền sửa ở module (quản trị luôn nhận)
create or replace function public.notify_staff(p_org uuid, p_module text, p_kind text, p_title text, p_body text,
  p_page text, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select p.id from profiles p where p.org_id = p_org and public.user_has_perm(p.id, p_module, 'edit') loop
    perform public.notify_user(u, p_org, p_kind, p_title, p_body, p_page, 'school_admin', p_ref);
  end loop;
end $$;

revoke execute on function public.user_has_perm(uuid, text, text), public.notify_user(uuid, uuid, text, text, text, text, text, uuid, boolean),
  public.notify_staff(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.teacher_profile(p_teacher uuid) returns uuid
language sql stable security definer set search_path = public as $$ select profile_id from teachers where id = p_teacher $$;
create or replace function public.teacher_name(p_teacher uuid) returns text
language sql stable security definer set search_path = public as $$ select coalesce((select full_name from teachers where id = p_teacher), 'Giáo viên') $$;
create or replace function public.vn_date(d date) returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY') $$;

-- ===== Đăng ký dạy STEM =====
create or replace function public.notify_stem_registration() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_staff(new.org_id, 'stem_registrations', 'approval', 'Đăng ký dạy STEM chờ duyệt',
      public.teacher_name(new.teacher_id) || ' · ' || new.topic || ' · ' || public.vn_date(new.on_date), 'Duyệt đăng ký dạy STEM', new.id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected') then
    perform public.notify_user(public.teacher_profile(new.teacher_id), new.org_id, 'status',
      case new.status when 'approved' then 'Đăng ký dạy STEM đã được duyệt' else 'Đăng ký dạy STEM bị từ chối' end,
      new.topic || ' · ' || public.vn_date(new.on_date), 'Đặt phòng STEM', 'teacher', new.id);
  end if;
  return null;
end $$;
create trigger stem_registrations_notify after insert or update of status on stem_registrations
  for each row execute function public.notify_stem_registration();

-- ===== Phiếu mượn thiết bị / phòng =====
create or replace function public.notify_borrow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' and new.teacher_id is not null then
    perform public.notify_staff(new.org_id, 'stem_rooms', 'approval', 'Phiếu mượn chờ duyệt',
      public.teacher_name(new.teacher_id) || ' · ' || new.title || ' · ' || public.vn_date(new.on_date), 'Quản lý Phòng STEM', new.id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.notify_user(public.teacher_profile(new.teacher_id), new.org_id, 'status',
      'Phiếu mượn: ' || case new.status when 'approved' then 'đã được duyệt' when 'lent' then 'đã giao thiết bị'
        when 'returned' then 'đã trả' when 'rejected' then 'bị từ chối' else new.status end,
      new.title || ' · ' || public.vn_date(new.on_date), 'Đặt phòng STEM', 'teacher', new.id);
  end if;
  return null;
end $$;
create trigger borrow_requests_notify after insert or update of status on borrow_requests
  for each row execute function public.notify_borrow();

-- ===== Bảo hành =====
create or replace function public.warranty_label(s text) returns text language sql immutable as $$
  select case s when 'draft' then 'Nháp' when 'new' then 'Mới' when 'accepted' then 'Đã tiếp nhận' when 'waiting_parts' then 'Chờ linh kiện'
    when 'processing' then 'Đang xử lý' when 'resolved' then 'Đã xử lý' when 'rejected' then 'Từ chối' when 'closed' then 'Đã đóng'
    when 'pending' then 'Chờ nhà cung cấp' else s end
$$;
create or replace function public.notify_warranty() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_body text;
begin
  v_body := coalesce(new.code || ' · ', '') || coalesce(left(new.description, 120), '');
  if tg_op = 'INSERT' and new.status in ('new') then
    perform public.notify_staff(new.org_id, 'warranty', 'approval', 'Báo hỏng thiết bị mới', v_body, 'Bảo hành thiết bị', new.id);
  elsif tg_op = 'UPDATE' and (new.status is distinct from old.status or new.provider_status is distinct from old.provider_status) then
    v_title := 'Ticket bảo hành: ' || public.warranty_label(new.status)
      || case when new.provider_status is distinct from old.provider_status then ' · NCC: ' || public.warranty_label(new.provider_status) else '' end;
    perform public.notify_user(new.reported_by, new.org_id, 'status', v_title, v_body,
      case when public.user_has_perm(new.reported_by, 'warranty', 'view') then 'Bảo hành thiết bị' else 'Tổng quan' end,
      case when public.user_has_perm(new.reported_by, 'warranty', 'view') then 'school_admin' else 'teacher' end, new.id);
    perform public.notify_staff(new.org_id, 'warranty', 'status', v_title, v_body, 'Bảo hành thiết bị', new.id);
  end if;
  return null;
end $$;
create trigger warranty_tickets_notify after insert or update of status, provider_status on warranty_tickets
  for each row execute function public.notify_warranty();

-- ===== Bài nộp, chấm bài, bài tập mới =====
create or replace function public.notify_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare a assignments; v_who text; p uuid;
begin
  select * into a from assignments where id = new.assignment_id;
  if tg_op = 'INSERT' then
    perform public.notify_user(public.teacher_profile(a.teacher_id), new.org_id, 'submission', 'Bài nộp mới: ' || a.title,
      (select count(*) from submissions where assignment_id = a.id)::text || ' bài đã nộp',
      'Chấm bài', 'teacher', a.id, true);
  elsif new.status = 'graded' and old.status is distinct from 'graded' then
    for p in
      select s.profile_id from students s where s.id = new.student_id and s.profile_id is not null
      union
      select s.profile_id from student_group_members m join students s on s.id = m.student_id
       where m.group_id = new.group_id and s.profile_id is not null
    loop
      perform public.notify_user(p, new.org_id, 'graded', 'Bài đã được chấm: ' || a.title,
        'Điểm ' || new.score || '/' || a.max_score || coalesce(' · ' || left(new.feedback, 100), ''), 'Bài tập', 'student', new.id);
    end loop;
  end if;
  return null;
end $$;
create trigger submissions_notify after insert or update of status, score on submissions
  for each row execute function public.notify_submission();

create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    for p in select profile_id from students where class_id = new.class_id and profile_id is not null loop
      perform public.notify_user(p, new.org_id, 'assignment', 'Bài tập mới: ' || new.title,
        case when new.due_at is not null then 'Hạn nộp ' || to_char(new.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM') else 'Không giới hạn thời gian' end,
        'Bài tập', 'student', new.id);
    end loop;
  end if;
  return null;
end $$;
create trigger assignments_notify after insert or update of status on assignments
  for each row execute function public.notify_assignment();

-- ===== Lời mời được chấp nhận =====
create or replace function public.notify_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    perform public.notify_user(new.invited_by, new.org_id, 'invitation', 'Lời mời đã được chấp nhận',
      coalesce(new.full_name || ' · ', '') || new.email, 'Tài khoản', 'school_admin', new.id);
  end if;
  return null;
end $$;
create trigger invitations_notify after update of status on invitations
  for each row execute function public.notify_invitation();

-- ===== Việc đang chờ (đếm trực tiếp, theo quyền của người xem) =====
create or replace function public.my_pending_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'stem_registrations', case when public.has_perm('stem_registrations','edit')
      then (select count(*) from stem_registrations where org_id = public.my_org_id() and status = 'pending') else 0 end,
    'borrow_requests', case when public.has_perm('stem_rooms','edit')
      then (select count(*) from borrow_requests where org_id = public.my_org_id() and status = 'pending') else 0 end,
    'warranty_tickets', case when public.has_perm('warranty','edit')
      then (select count(*) from warranty_tickets where org_id = public.my_org_id() and status in ('new','accepted','waiting_parts','processing')) else 0 end,
    'to_grade', coalesce((select count(*) from submissions s join assignments a on a.id = s.assignment_id
      where a.teacher_id = public.my_teacher_id() and s.status <> 'graded'), 0),
    'unread', (select count(*) from notifications where user_id = auth.uid() and read_at is null)
  )
$$;
grant execute on function public.my_pending_counts() to authenticated;

-- ===== Năm học: mỗi trường chỉ một học kỳ hiện tại =====
create unique index if not exists academic_years_one_current on academic_years (org_id) where is_current;
create unique index if not exists academic_years_name_term on academic_years (org_id, name, term);

-- Đặt học kỳ hiện tại (bỏ cờ của học kỳ khác trong cùng trường)
create or replace function public.set_current_year(p_year uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from academic_years where id = p_year;
  if v_org is null or not public.can_access_org(v_org) or not public.has_perm('periods', 'edit') then
    raise exception 'Không có quyền đặt học kỳ hiện tại';
  end if;
  update academic_years set is_current = false where org_id = v_org and is_current and id <> p_year;
  update academic_years set is_current = true where id = p_year;
end $$;
grant execute on function public.set_current_year(uuid) to authenticated;

-- Thời khóa biểu theo học kỳ: trùng lịch chỉ tính trong cùng học kỳ (để sao chép TKB sang học kỳ mới)
alter table timetable_entries drop constraint if exists timetable_entries_class_id_weekday_period_id_key;
alter table timetable_entries drop constraint if exists timetable_entries_teacher_id_weekday_period_id_key;
create unique index if not exists timetable_entries_class_id_weekday_period_year
  on timetable_entries (class_id, weekday, period_id, coalesce(year_id, '00000000-0000-0000-0000-000000000000'::uuid));
create unique index if not exists timetable_entries_teacher_id_weekday_period_year
  on timetable_entries (teacher_id, weekday, period_id, coalesce(year_id, '00000000-0000-0000-0000-000000000000'::uuid));
