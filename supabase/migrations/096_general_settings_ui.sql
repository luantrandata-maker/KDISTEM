-- 096. Thiết lập chung đợt 2 (video 26/10): tên & menu, danh mục, trường tùy chỉnh, nút; quy tắc STEM / nhắc nộp kế hoạch
--  • org_settings thêm khoá: menu, catalogs, fields, buttons. KDI đặt mặc định cho toàn hệ thống, trường tự chỉnh phần của trường
--    (giao diện gộp: mục trường đặt đè lên mặc định KDI).
--  • library_items.custom, edu_programs.custom: giá trị các "trường tùy chỉnh" (jsonb, khoá = mã trường).
--  • stem_plan_reminders(): tiết STEM sắp dạy trong N ngày (quy tắc "plan_remind_days", mặc định 7) mà giáo viên chưa đăng ký
--    dạy STEM (kế hoạch bài dạy) → nhắc giáo viên, mỗi người tối đa một thông báo / ngày. Chạy hằng đêm (pg_cron) hoặc KDI chạy tay.
-- Cần chạy sau 095.

alter table org_settings drop constraint if exists org_settings_key_check;
alter table org_settings add constraint org_settings_key_check check (key in ('rules', 'periods', 'menu', 'catalogs', 'fields', 'buttons'));
alter table org_settings drop constraint if exists org_settings_value_check;
alter table org_settings add constraint org_settings_value_check check (jsonb_typeof(value) in ('object', 'array') and length(value::text) <= 100000);

alter table library_items add column if not exists custom jsonb not null default '{}'::jsonb;
alter table library_items drop constraint if exists library_items_custom_check;
alter table library_items add constraint library_items_custom_check check (jsonb_typeof(custom) = 'object' and length(custom::text) <= 20000);
alter table edu_programs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table edu_programs drop constraint if exists edu_programs_custom_check;
alter table edu_programs add constraint edu_programs_custom_check check (jsonb_typeof(custom) = 'object' and length(custom::text) <= 20000);

-- ===== Nhắc nộp kế hoạch dạy STEM =====
create or replace function public.stem_plan_reminders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today date := public.vn_today(); s record; n_sent int := 0;
begin
  for s in
    select ts.org_id, t.profile_id, count(*)::int as n, min(ts.session_date) as first_day
      from teaching_sessions ts join teachers t on t.id = ts.teacher_id
      join organizations o on o.id = ts.org_id and o.status = 'active'
     where ts.kind = 'stem' and ts.status = 'scheduled' and t.profile_id is not null
       and ts.session_date between v_today and v_today + greatest(0, least(60, public.org_rule(ts.org_id, 'plan_remind_days', 7)))
       and not exists (select 1 from stem_registrations r where r.teacher_id = ts.teacher_id and r.class_id = ts.class_id
                         and r.on_date = ts.session_date and r.status <> 'rejected')
     group by ts.org_id, t.profile_id
  loop
    continue when exists (select 1 from notifications x where x.user_id = s.profile_id and x.kind = 'stem_plan_remind'
                            and x.created_at > now() - interval '20 hours');
    insert into notifications (org_id, user_id, kind, title, body, page, portal)
    values (s.org_id, s.profile_id, 'stem_plan_remind', left('Còn ' || s.n || ' tiết STEM sắp dạy chưa nộp kế hoạch', 200),
            'Tiết gần nhất ngày ' || to_char(s.first_day, 'DD/MM/YYYY') || '. Đăng ký dạy STEM (chủ đề, phòng) để trường duyệt trước khi dạy.',
            'Đặt phòng STEM', 'teacher');
    n_sent := n_sent + 1;
  end loop;
  return jsonb_build_object('sent', n_sent);
end $$;
revoke all on function public.stem_plan_reminders() from public, anon, authenticated;

create or replace function public.platform_stem_plan_reminders() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return public.stem_plan_reminders();
end $$;
revoke all on function public.platform_stem_plan_reminders() from public, anon;
grant execute on function public.platform_stem_plan_reminders() to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('stem-plan-reminders', '0 23 * * *', 'select public.stem_plan_reminders()');   -- 06:00 giờ Việt Nam
    exception when others then raise notice 'pg_cron: không đặt được lịch stem-plan-reminders (%)', sqlerrm;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';
