-- 028: Dữ liệu mẫu buổi dạy & điểm danh (chỉ chạy trên CSDL demo có trường THCS-PH và chưa có buổi dạy nào).
-- Sinh tiết từ TKB của mọi trường cho 2 tuần gần nhất (đến hôm qua), ~93% đã dạy, ~2% huỷ, còn lại chưa điểm danh;
-- điểm danh học sinh có mặt ~94%, muộn ~3%, vắng ~2%, có phép ~1%. Ngẫu nhiên nhưng cố định (theo mã băm).
do $$
declare v_from date := public.vn_today() - 14; v_to date := public.vn_today() - 1;
begin
  if not exists (select 1 from organizations where code = 'THCS-PH') or exists (select 1 from teaching_sessions) then return; end if;

  insert into teaching_sessions (org_id, year_id, timetable_entry_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind)
  select distinct on (e.class_id, d.day, e.period_id)
         e.org_id, d.year_id, e.id, e.class_id, e.teacher_id, e.period_id, e.room_id, d.day, e.subject, e.kind
  from (select g::date as day, y.id as year_id, y.org_id
          from generate_series(v_from, v_to, interval '1 day') g
          join academic_years y on g::date between y.starts_on and y.ends_on
         where extract(isodow from g) between 1 and 6) d
  join timetable_entries e on e.org_id = d.org_id and e.weekday = extract(isodow from d.day)::int + 1
   and (e.year_id is null or e.year_id = d.year_id)
  order by e.class_id, d.day, e.period_id, (e.year_id is null), e.id
  on conflict do nothing;

  update teaching_sessions set
    status = case when abs(hashtext(id::text)) % 100 < 2 then 'cancelled'
                  when abs(hashtext(id::text)) % 100 < 95 then 'taught' else 'scheduled' end,
    cancel_reason = case when abs(hashtext(id::text)) % 100 < 2 then 'Hoạt động chung toàn trường' end,
    marked_at = case when abs(hashtext(id::text)) % 100 between 2 and 94
                     then (session_date + time '11:30') at time zone 'Asia/Ho_Chi_Minh' end;

  -- Điểm danh từng học sinh: tắt trigger đếm khi chèn hàng loạt, đếm lại một lần ở cuối
  alter table lesson_attendance disable trigger lesson_attendance_count;
  insert into lesson_attendance (session_id, student_id, org_id, status, marked_at)
  select s.id, st.id, s.org_id,
         case when h < 94 then 'present' when h < 97 then 'late' when h < 99 then 'absent' else 'excused' end,
         s.marked_at
  from teaching_sessions s
  join students st on st.class_id = s.class_id and st.status = 'studying'
  cross join lateral (select abs(hashtext(s.id::text || st.id::text)) % 100 as h) x
  where s.status = 'taught';
  alter table lesson_attendance enable trigger lesson_attendance_count;

  update teaching_sessions s set present_count = c.p, absent_count = c.a, late_count = c.l, excused_count = c.e
  from (select session_id, count(*) filter (where status = 'present') p, count(*) filter (where status = 'absent') a,
               count(*) filter (where status = 'late') l, count(*) filter (where status = 'excused') e
          from lesson_attendance group by session_id) c
  where s.id = c.session_id;
end $$;
