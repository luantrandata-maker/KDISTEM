-- 139: Một buổi đào tạo có nhiều nội dung, điểm danh theo buổi (09/11/2026).
--  • training_sessions.unit_ids: các nội dung đào tạo của buổi (theo thứ tự). unit_id giữ là nội dung đầu tiên để các
--    chức năng cũ (bài kiểm tra mở theo buổi…) chạy như trước. Ghi unit_id mà không ghi unit_ids (code cũ) vẫn đúng.
--  • training_sessions.unit_times: giờ học từng nội dung trong buổi {unit_id: [bắt đầu, kết thúc]} (màn Xếp lịch dùng).
--  • Điểm danh vẫn theo buổi (một mã, một lần điểm danh), giờ một buổi gồm nhiều nội dung.
--  • Danh sách điểm danh: nhà giáo có tên trong buổi khi học ít nhất một nội dung của buổi (hoặc buổi không gắn nội dung).
--    Đổi nội dung của buổi thì cập nhật danh sách các buổi chưa diễn ra.
--  • Các hàm tìm buổi theo nội dung (xếp lịch tự động, trùng lịch khi ghi danh, khoá học của nhà giáo, đổi phiên bản
--    chương trình) tìm trong cả unit_ids.
-- Cần chạy sau 138.

alter table training_sessions add column if not exists unit_ids uuid[] not null default '{}';
alter table training_sessions add column if not exists unit_times jsonb;
update training_sessions set unit_ids = array[unit_id] where unit_id is not null and cardinality(unit_ids) = 0;
do $$ begin
  alter table training_sessions add constraint training_sessions_unit_ids_check check (cardinality(unit_ids) <= 40);
exception when duplicate_object then null; end $$;
create index if not exists training_sessions_unit_ids on training_sessions using gin (unit_ids);

-- Có nội dung nào của buổi nằm trong phần nhà giáo học không (buổi không gắn nội dung: luôn có)
create or replace function public.training_units_in(p_units uuid[], p_exempt uuid[], p_ids uuid[]) returns boolean
language sql immutable as $$
  select coalesce(cardinality(p_ids), 0) = 0 or exists (select 1 from unnest(p_ids) x where public.training_unit_in(p_units, p_exempt, x))
$$;
grant execute on function public.training_units_in(uuid[], uuid[], uuid[]) to authenticated;

-- Đồng bộ unit_id ↔ unit_ids và kiểm tra nội dung thuộc kế hoạch. Tên trigger bắt đầu bằng "a_" để chạy trước guard.
create or replace function public.training_sessions_units() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.unit_ids is not distinct from old.unit_ids and new.unit_id is distinct from old.unit_id then
    -- Code cũ chỉ ghi unit_id: thay nội dung đầu tiên
    new.unit_ids := case when new.unit_id is null then coalesce(new.unit_ids[2:], '{}')
                         when old.unit_id is null then array_prepend(new.unit_id, new.unit_ids)
                         else array_replace(new.unit_ids, old.unit_id, new.unit_id) end;
  elsif tg_op = 'INSERT' and coalesce(cardinality(new.unit_ids), 0) = 0 and new.unit_id is not null then
    new.unit_ids := array[new.unit_id];
  end if;
  -- Bỏ trùng, giữ thứ tự
  new.unit_ids := coalesce(array(select x from unnest(new.unit_ids) with ordinality t(x, k) where x is not null
                                  group by x order by min(k)), '{}');
  new.unit_id := new.unit_ids[1];
  if current_setting('app.training_trainer_sync', true) = 'on' then return new; end if;
  if (tg_op = 'INSERT' or new.unit_ids is distinct from old.unit_ids or new.plan_id <> old.plan_id)
     and exists (select 1 from unnest(new.unit_ids) x
                  where not exists (select 1 from training_program_units u join training_plan_items i on i.program_id = u.program_id
                                     where u.id = x and u.kind = 'content' and i.plan_id = new.plan_id and (i.units is null or u.id = any(i.units)))) then
    raise exception 'Nội dung tập huấn không thuộc chương trình của kế hoạch (hoặc không được chọn trong kế hoạch)' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists training_sessions_a_units on training_sessions;
create trigger training_sessions_a_units before insert or update on training_sessions
  for each row execute function public.training_sessions_units();

-- Danh sách điểm danh khi thêm buổi / khi nhà giáo ghi danh: theo mọi nội dung của buổi
create or replace function public.training_sessions_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into training_session_codes (session_id, code) values (new.id, lpad((floor(random() * 1000000))::int::text, 6, '0'))
  on conflict do nothing;
  insert into training_attendance (org_id, session_id, teacher_id, present)
  select new.org_id, new.id, e.teacher_id, null from training_enrollments e
   where e.plan_id = new.plan_id and public.training_units_in(e.units, e.exempt_units, new.unit_ids)
  on conflict do nothing;
  return null;
end $$;

create or replace function public.training_enrollments_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from training_attendance a using training_sessions s
     where s.id = a.session_id and s.plan_id = old.plan_id and a.teacher_id = old.teacher_id
       and s.starts_at > now() and a.present is null and a.excuse_status is null
       and (tg_op = 'DELETE' or not public.training_units_in(new.units, new.exempt_units, s.unit_ids));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into training_attendance (org_id, session_id, teacher_id, present)
    select s.org_id, s.id, new.teacher_id, null from training_sessions s
     where s.plan_id = new.plan_id and s.ends_at > now() and s.closed_at is null
       and public.training_units_in(new.units, new.exempt_units, s.unit_ids)
    on conflict do nothing;
  end if;
  return null;
end $$;

-- Đổi nội dung của buổi chưa diễn ra: thêm nhà giáo mới thuộc buổi, bỏ người không còn học nội dung nào của buổi
-- (chỉ dòng chưa điểm danh, chưa xin vắng)
create or replace function public.training_sessions_units_roster() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unit_ids is not distinct from old.unit_ids or new.closed_at is not null or new.ends_at <= now() then return null; end if;
  delete from training_attendance a using training_enrollments e
   where a.session_id = new.id and e.plan_id = new.plan_id and e.teacher_id = a.teacher_id
     and a.present is null and a.excuse_status is null and new.starts_at > now()
     and not public.training_units_in(e.units, e.exempt_units, new.unit_ids);
  insert into training_attendance (org_id, session_id, teacher_id, present)
  select new.org_id, new.id, e.teacher_id, null from training_enrollments e
   where e.plan_id = new.plan_id and public.training_units_in(e.units, e.exempt_units, new.unit_ids)
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists training_sessions_units_roster on training_sessions;
create trigger training_sessions_units_roster after update of unit_ids on training_sessions
  for each row execute function public.training_sessions_units_roster();

-- Các hàm tìm buổi theo nội dung: sửa tại chỗ bản đang chạy (giữ mọi thay đổi của các migration trước)
do $$
declare d text; f text;
begin
  -- Xếp lịch tự động: nội dung đã nằm trong một buổi (kể cả buổi nhiều nội dung) thì bỏ qua
  f := 'public.training_plan_schedule(uuid,date,time,numeric,boolean)';
  d := pg_get_functiondef(f::regprocedure);
  if position('= any(s.unit_ids)' in d) = 0 then
    d := replace(d, 's.plan_id = p_plan and s.unit_id = u.id', 's.plan_id = p_plan and u.id = any(s.unit_ids)');
    if position('= any(s.unit_ids)' in d) = 0 then raise exception '139: không sửa được %', f; end if;
    execute d;
  end if;

  -- Trùng lịch khi ghi danh
  f := 'public.training_register_conflicts(uuid,uuid,uuid[],uuid[])';
  d := pg_get_functiondef(f::regprocedure);
  if position('training_units_in' in d) = 0 then
    d := replace(d, 'public.training_unit_in(p_units, p_exempt, s.unit_id)', 'public.training_units_in(p_units, p_exempt, s.unit_ids)');
    if position('training_units_in' in d) = 0 then raise exception '139: không sửa được %', f; end if;
    execute d;
  end if;

  -- Khoá học của nhà giáo: buổi của từng nội dung
  f := 'public.training_course(uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('= any(s.unit_ids)' in d) = 0 then
    d := replace(d, 's.plan_id = p_plan and s.unit_id = x.unit_id', 's.plan_id = p_plan and x.unit_id = any(s.unit_ids)');
    if position('= any(s.unit_ids)' in d) = 0 then raise exception '139: không sửa được %', f; end if;
    execute d;
  end if;

  -- Đổi phiên bản chương trình: chặn khi buổi đã chốt có nội dung cũ; đổi mọi nội dung của buổi sang phiên bản mới
  -- (nội dung không còn ở phiên bản mới thì bỏ khỏi buổi, như trước)
  f := 'public.training_plan_item_upgrade(uuid,uuid)';
  d := pg_get_functiondef(f::regprocedure);
  if position('unit_ids' in d) = 0 then
    d := replace(d, 'training_sessions s join training_program_units u on u.id = s.unit_id where',
                    'training_sessions s join training_program_units u on u.id = any(s.unit_ids) where');
    d := replace(d, 'update training_sessions s set unit_id = (v_map ->> s.unit_id::text)::uuid
   where s.plan_id = p_plan and s.unit_id in (select id from training_program_units where program_id = o.id);',
      'update training_sessions s set
         unit_ids = array(select coalesce((v_map ->> su.uid::text)::uuid, su.uid) from unnest(s.unit_ids) with ordinality su(uid, pos)
                           where v_map ? su.uid::text or su.uid not in (select id from training_program_units where program_id = o.id) order by su.pos),
         unit_times = (select jsonb_object_agg(coalesce(v_map ->> ut.key, ut.key), ut.value) from jsonb_each(s.unit_times) ut)
   where s.plan_id = p_plan and s.unit_ids && array(select id from training_program_units where program_id = o.id);');
    if position('any(s.unit_ids)' in d) = 0 or position('unit_ids = array(select coalesce' in d) = 0 then raise exception '139: không sửa được %', f; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
