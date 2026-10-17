-- 035: Sinh buổi dạy tự động cho mọi trường, ngày nghỉ áp ngay cho trường trực thuộc.
-- Trước: buổi dạy chỉ được sinh khi có người mở màn Buổi dạy của trường (generate_teaching_sessions theo
-- đơn vị đang làm việc). Trường không ai mở → không có tiết → dashboard Sở, Hiệu quả phòng STEM và sức khoẻ
-- trường (Cơ sở triển khai) thiếu số liệu; ngày nghỉ do Sở khai báo chỉ bỏ tiết đã sinh khi trường mở lại tuần đó.
--   1. sync_teaching_sessions(trường, từ, đến): phần lõi của generate_teaching_sessions, không phụ thuộc người đăng nhập.
--      generate_teaching_sessions giữ nguyên kiểm tra quyền và gọi lại hàm này → giao diện không đổi.
--   2. generate_upcoming_sessions(số ngày): sinh/đồng bộ tiết cho mọi trường đang hoạt động có phân hệ TKB,
--      từ hôm nay đến N ngày tới (mặc định 28); ghi kết quả vào system_job_runs.
--   3. Trigger trên school_holidays: thêm/sửa/xoá ngày nghỉ ở bất kỳ cấp nào → đồng bộ ngay các trường thuộc cấp đó
--      trong khoảng ngày nghỉ (từ hôm nay, tối đa 63 ngày).
--   4. Lịch pg_cron 02:15 hằng đêm (giờ Việt Nam) nếu CSDL có pg_cron (Supabase có; Postgres trong CI thì không → bỏ qua).

-- ===== 1. Phần lõi =====
create or replace function public.sync_teaching_sessions(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ins int; v_upd int; v_del int; v_today date := public.vn_today(); v_skip int;
begin
  if p_org is null or (select type from organizations where id = p_org) is distinct from 'school' then
    raise exception 'Chỉ sinh buổi dạy cho trường học' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 63 ngày)' using errcode = '22023';
  end if;

  if to_regclass('pg_temp._ts_src') is null then      -- gọi nhiều lần trong một giao dịch (lịch nền) → tạo một lần
    create temp table _ts_src (entry_id uuid, class_id uuid, teacher_id uuid, period_id uuid, room_id uuid,
      day date, year_id uuid, subject text, kind text) on commit drop;
  end if;
  truncate _ts_src;
  insert into _ts_src
  select distinct on (e.class_id, d.day, e.period_id)
         e.id, e.class_id, e.teacher_id, e.period_id, e.room_id, d.day, d.year_id, e.subject, e.kind
  from (select g::date as day, y.id as year_id
          from generate_series(p_from, p_to, interval '1 day') g
          join academic_years y on y.org_id = p_org and g::date between y.starts_on and y.ends_on
         where extract(isodow from g) between 1 and 6
           and public.is_holiday(p_org, g::date) is null) d          -- ngày nghỉ của trường và mọi cấp trên
  join timetable_entries e on e.org_id = p_org
   and e.weekday = extract(isodow from d.day)::int + 1
   and (e.year_id is null or e.year_id = d.year_id)
  order by e.class_id, d.day, e.period_id, (e.year_id is null), e.id;   -- ưu tiên TKB riêng của học kỳ

  -- Tiết tương lai chưa điểm danh không còn trong nguồn (đổi TKB, rơi vào ngày nghỉ) → xoá
  delete from teaching_sessions s
   where s.org_id = p_org and s.session_date between greatest(p_from, v_today) and p_to
     and s.status = 'scheduled' and not s.is_makeup
     and not exists (select 1 from lesson_attendance a where a.session_id = s.id)
     and not exists (select 1 from _ts_src x where x.class_id = s.class_id and x.day = s.session_date and x.period_id = s.period_id);
  get diagnostics v_del = row_count;

  with up as (
    insert into teaching_sessions (org_id, year_id, timetable_entry_id, class_id, teacher_id, period_id, room_id, session_date, subject, kind)
    select p_org, year_id, entry_id, class_id, teacher_id, period_id, room_id, day, subject, kind from _ts_src
    on conflict (class_id, session_date, period_id) do update set
      year_id = excluded.year_id, timetable_entry_id = excluded.timetable_entry_id, teacher_id = excluded.teacher_id,
      room_id = excluded.room_id, subject = excluded.subject, kind = excluded.kind
    where teaching_sessions.status = 'scheduled' and not teaching_sessions.is_makeup and teaching_sessions.session_date >= v_today
      and (teaching_sessions.timetable_entry_id, teaching_sessions.teacher_id, teaching_sessions.room_id, teaching_sessions.subject, teaching_sessions.kind)
          is distinct from (excluded.timetable_entry_id, excluded.teacher_id, excluded.room_id, excluded.subject, excluded.kind)
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  select count(*) into v_skip from generate_series(p_from, p_to, interval '1 day') g
   where extract(isodow from g) between 1 and 6 and public.is_holiday(p_org, g::date) is not null;

  return jsonb_build_object('created', v_ins, 'updated', v_upd, 'removed', v_del, 'holidays', v_skip);
end $$;
revoke all on function public.sync_teaching_sessions(uuid, date, date) from public, anon, authenticated;

-- Giao diện (màn Buổi dạy, Ngày nghỉ): giữ nguyên chữ ký, kiểm tra quyền như trước rồi gọi phần lõi.
create or replace function public.generate_teaching_sessions(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_staff() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if (select type from organizations where id = v_org) is distinct from 'school' then
    raise exception 'Chỉ sinh buổi dạy cho trường học' using errcode = '22023';
  end if;
  if not public.org_has_module(v_org, 'timetable') then raise exception 'Đơn vị chưa dùng phân hệ Thời khoá biểu' using errcode = '42501'; end if;
  return public.sync_teaching_sessions(v_org, p_from, p_to);
end $$;
revoke all on function public.generate_teaching_sessions(date, date) from public;
grant execute on function public.generate_teaching_sessions(date, date) to authenticated;

-- ===== 2. Nhật ký việc chạy nền + sinh cho mọi trường =====
create table if not exists system_job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  result jsonb,
  error text
);
create index if not exists system_job_runs_job on system_job_runs (job, started_at desc);
alter table system_job_runs enable row level security;
drop policy if exists system_job_runs_read on system_job_runs;
create policy system_job_runs_read on system_job_runs for select to authenticated using ((select public.is_platform_admin()));

create or replace function public.generate_upcoming_sessions(p_days int default 28) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today date := public.vn_today(); v_to date; s record; r jsonb; v_run bigint;
  n_sch int := 0; n_err int := 0; c int := 0; u int := 0; d int := 0; v_errs jsonb := '[]';
begin
  if p_days is null or p_days < 1 or p_days > 62 then raise exception 'Số ngày phải từ 1 đến 62' using errcode = '22023'; end if;
  v_to := v_today + p_days;
  insert into system_job_runs (job) values ('generate_upcoming_sessions') returning id into v_run;
  for s in select o.id, o.code from organizations o
            where o.type = 'school' and o.status = 'active' and public.org_has_module(o.id, 'timetable')
            order by o.code loop
    begin
      r := public.sync_teaching_sessions(s.id, v_today, v_to);
      n_sch := n_sch + 1;
      c := c + (r->>'created')::int; u := u + (r->>'updated')::int; d := d + (r->>'removed')::int;
    exception when others then                       -- một trường lỗi không chặn các trường khác
      n_err := n_err + 1;
      v_errs := v_errs || jsonb_build_object('school', s.code, 'error', sqlerrm);
    end;
  end loop;
  r := jsonb_build_object('from', v_today, 'to', v_to, 'schools', n_sch, 'failed', n_err,
                          'created', c, 'updated', u, 'removed', d, 'errors', v_errs);
  update system_job_runs set finished_at = now(), ok = (n_err = 0), result = r where id = v_run;
  delete from system_job_runs where job = 'generate_upcoming_sessions' and started_at < now() - interval '90 days';
  return r;
end $$;
revoke all on function public.generate_upcoming_sessions(int) from public, anon, authenticated;

-- Quản trị nền tảng chạy tay (vd sau khi nhập TKB cho nhiều trường)
create or replace function public.platform_generate_upcoming_sessions(p_days int default 28) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng' using errcode = '42501'; end if;
  return public.generate_upcoming_sessions(p_days);
end $$;
revoke all on function public.platform_generate_upcoming_sessions(int) from public, anon;
grant execute on function public.platform_generate_upcoming_sessions(int) to authenticated;

-- ===== 3. Ngày nghỉ áp ngay cho mọi trường thuộc đơn vị khai báo =====
create or replace function public.holiday_resync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_today date := public.vn_today(); v_from date; v_to date; v_org uuid; s record;
begin
  -- Khoảng ngày bị ảnh hưởng: hợp của bản cũ và bản mới (sửa ngày nghỉ có thể dời khoảng)
  v_from := least(case when tg_op <> 'INSERT' then old.starts_on end, case when tg_op <> 'DELETE' then new.starts_on end);
  v_to   := greatest(case when tg_op <> 'INSERT' then old.ends_on end, case when tg_op <> 'DELETE' then new.ends_on end);
  v_org  := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  -- Chỉ trong 63 ngày tới (phạm vi tiết đã/sẽ được sinh); ngày nghỉ đã qua không đụng tiết cũ,
  -- ngày nghỉ xa hơn để lịch nền xử lý khi tới gần.
  v_from := greatest(v_from, v_today);
  v_to := least(v_to, v_today + 62);
  if v_to < v_from then return null; end if;
  for s in with recursive down as (
             select id, type, status from organizations where id = v_org
             union all select o.id, o.type, o.status from organizations o join down on o.parent_id = down.id)
           select id, code from down join organizations using (id)
            where down.type = 'school' and down.status = 'active' and public.org_has_module(id, 'timetable') loop
    begin
      perform public.sync_teaching_sessions(s.id, v_from, v_to);
    exception when others then                     -- lỗi của một trường không chặn việc lưu ngày nghỉ
      raise warning 'Ngày nghỉ: không đồng bộ được buổi dạy trường %: %', s.code, sqlerrm;
    end;
  end loop;
  return null;
end $$;
drop trigger if exists school_holidays_resync on school_holidays;
create trigger school_holidays_resync after insert or update or delete on school_holidays
  for each row execute function public.holiday_resync();

-- ===== 4. Lịch chạy hằng đêm (pg_cron) =====
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      -- 19:15 UTC = 02:15 giờ Việt Nam. Đặt lại theo tên nên chạy migration nhiều lần không sinh trùng.
      perform cron.schedule('generate-upcoming-sessions', '15 19 * * *', 'select public.generate_upcoming_sessions(28)');
      raise notice 'pg_cron: đã đặt lịch generate-upcoming-sessions 02:15 hằng đêm';
    exception when others then
      -- vd pg_cron cấu hình cho CSDL khác (cron.database_name): không chặn migration, kiểm tra lịch qua schema_diff → facts.txt
      raise notice 'pg_cron: không đặt được lịch (%). Đặt lịch bằng tay hoặc chạy generate_upcoming_sessions() từ bộ lập lịch khác.', sqlerrm;
    end;
  else
    raise notice 'Không có pg_cron: bỏ qua đặt lịch (gọi generate_upcoming_sessions() bằng tay hoặc từ bộ lập lịch khác)';
  end if;
end $$;
