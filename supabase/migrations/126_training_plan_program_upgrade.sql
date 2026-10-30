-- 126. Kế hoạch tập huấn và phiên bản chương trình
--  Phát hành phiên bản mới của chương trình tập huấn thì kế hoạch đang dùng phiên bản cũ vẫn chạy bình thường
--  (phiên bản cũ thành "Đã thay thế"). Khi cần, đơn vị lập kế hoạch tự chuyển sang phiên bản mới:
--  • training_plan_item_upgrade(p_plan, p_program): đổi chương trình trong kế hoạch sang phiên bản phát hành mới nhất
--    cùng họ. Nội dung được nối sang phiên bản mới theo tên (không khớp tên thì theo thứ tự): nội dung đã chọn,
--    buổi đã xếp, nội dung GV đăng ký / được miễn. Nội dung không còn trong phiên bản mới thì bỏ khỏi lựa chọn,
--    buổi của nội dung đó giữ nguyên nhưng không gắn nội dung.
--    Không chuyển khi GV đã học / làm bài / được chốt điểm danh nội dung của phiên bản cũ trong kế hoạch.
--  • Tệp tài liệu của phiên bản đã thay thế vẫn mở được (kế hoạch cũ vẫn dùng).
-- Cần chạy sau 098, 106, 118.

create or replace function public.training_plan_item_upgrade(p_plan uuid, p_program uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k training_plans; o training_programs; n training_programs; it training_plan_items;
        v_map jsonb; v_units uuid[]; v_ses int; v_lost int;
begin
  select * into k from training_plans where id = p_plan;
  if k.id is null or not public.training_plan_can_manage(p_plan) then
    raise exception 'Bạn không sửa được kế hoạch này' using errcode = '42501';
  end if;
  if k.pub_status = 'archived' or k.closed_at is not null then
    raise exception 'Kế hoạch đã kết thúc: không đổi phiên bản chương trình' using errcode = '22023';
  end if;
  select * into it from training_plan_items where plan_id = p_plan and program_id = p_program for update;
  if it.plan_id is null then raise exception 'Chương trình không có trong kế hoạch' using errcode = '22023'; end if;
  select * into o from training_programs where id = p_program;
  select * into n from training_programs where family_id = o.family_id and status = 'published' and version_no > o.version_no
   order by version_no desc limit 1;
  if n.id is null then raise exception 'Chưa có phiên bản mới hơn đã phát hành' using errcode = '22023'; end if;
  if exists (select 1 from training_plan_items where plan_id = p_plan and program_id = n.id) then
    raise exception 'Kế hoạch đã có phiên bản mới của chương trình này' using errcode = '22023';
  end if;
  if exists (select 1 from training_progress pr join training_program_units u on u.id = pr.unit_id where pr.plan_id = p_plan and u.program_id = o.id)
     or exists (select 1 from training_test_attempts a join training_program_units u on u.id = a.unit_id where a.plan_id = p_plan and u.program_id = o.id)
     or exists (select 1 from training_sessions s join training_program_units u on u.id = s.unit_id where s.plan_id = p_plan and u.program_id = o.id and s.closed_at is not null) then
    raise exception 'Giáo viên đã học hoặc đã chốt điểm danh nội dung của phiên bản đang dùng: giữ phiên bản này, hoặc lập kế hoạch mới cho phiên bản mới' using errcode = '22023';
  end if;

  -- Nối nội dung cũ → mới: môn theo tên rồi theo thứ tự; nội dung trong môn đã nối theo tên rồi theo thứ tự
  with os as (select id, seq, lower(btrim(title)) t from training_program_units where program_id = o.id and kind = 'subject'),
       ns as (select id, seq, lower(btrim(title)) t from training_program_units where program_id = n.id and kind = 'subject'),
       sm as (select os.id oid, coalesce((select ns.id from ns where ns.t = os.t order by ns.seq limit 1),
                                         (select ns.id from ns where ns.seq = os.seq and not exists (select 1 from os o2 where o2.t = ns.t) limit 1)) nid from os),
       oc as (select u.id, u.parent_id, u.seq, lower(btrim(u.title)) t from training_program_units u where u.program_id = o.id and u.kind = 'content'),
       nc as (select u.id, u.parent_id, u.seq, lower(btrim(u.title)) t from training_program_units u where u.program_id = n.id and u.kind = 'content'),
       cm as (select oc.id oid, coalesce(
                (select nc.id from nc where nc.parent_id = sm.nid and nc.t = oc.t order by nc.seq limit 1),
                (select nc.id from nc where nc.parent_id = sm.nid and nc.seq = oc.seq
                   and not exists (select 1 from oc o2 where o2.parent_id = oc.parent_id and o2.t = nc.t) limit 1)) nid
                from oc join sm on sm.oid = oc.parent_id)
  select coalesce(jsonb_object_agg(oid::text, nid::text) filter (where nid is not null), '{}') into v_map from cm;

  if it.units is not null then
    v_units := array(select (v_map ->> x::text)::uuid from unnest(it.units) x where v_map ? x::text);
    v_lost := cardinality(it.units) - cardinality(v_units);
    if cardinality(v_units) = 0 then v_units := null; end if;   -- không nội dung nào còn: dùng toàn bộ phiên bản mới
  else
    v_lost := (select count(*) from training_program_units u where u.program_id = o.id and u.kind = 'content' and not (v_map ? u.id::text));
  end if;

  -- Kế hoạch đã phát hành vẫn đổi được phiên bản (bỏ qua chặn sửa của kế hoạch, như khi đổi tên giảng viên)
  perform set_config('app.training_trainer_sync', 'on', true);
  update training_plan_items set program_id = n.id, units = v_units where plan_id = p_plan and program_id = o.id;
  perform set_config('app.training_trainer_sync', '', true);

  update training_sessions s set unit_id = (v_map ->> s.unit_id::text)::uuid
   where s.plan_id = p_plan and s.unit_id in (select id from training_program_units where program_id = o.id);
  get diagnostics v_ses = row_count;

  update training_enrollments e set
         units = case when e.units is null then null else nullif(array(select (v_map ->> x::text)::uuid from unnest(e.units) x where v_map ? x::text
                       union select x from unnest(e.units) x where x not in (select id from training_program_units where program_id = o.id)), '{}') end,
         exempt_units = array(select (v_map ->> x::text)::uuid from unnest(e.exempt_units) x where v_map ? x::text
                       union select x from unnest(e.exempt_units) x where x not in (select id from training_program_units where program_id = o.id))
   where e.plan_id = p_plan
     and (e.units && array(select id from training_program_units where program_id = o.id)
          or e.exempt_units && array(select id from training_program_units where program_id = o.id));
  update training_registrations r set
         units = case when r.units is null then null else nullif(array(select (v_map ->> x::text)::uuid from unnest(r.units) x where v_map ? x::text
                       union select x from unnest(r.units) x where x not in (select id from training_program_units where program_id = o.id)), '{}') end,
         exempt_units = array(select (v_map ->> x::text)::uuid from unnest(r.exempt_units) x where v_map ? x::text
                       union select x from unnest(r.exempt_units) x where x not in (select id from training_program_units where program_id = o.id))
   where r.plan_id = p_plan
     and (r.units && array(select id from training_program_units where program_id = o.id)
          or r.exempt_units && array(select id from training_program_units where program_id = o.id));

  return jsonb_build_object('program', n.id, 'version', n.version_no, 'sessions', v_ses, 'dropped', v_lost);
end $$;
revoke all on function public.training_plan_item_upgrade(uuid, uuid) from public, anon;
grant execute on function public.training_plan_item_upgrade(uuid, uuid) to authenticated;

-- Tệp tài liệu: cả phiên bản đã thay thế (kế hoạch cũ vẫn dùng)
do $$ declare d text;
begin
  d := pg_get_functiondef('public.learning_file_readable(text)'::regprocedure);
  if position($s$p.status = 'published' and u.detail->'docs'$s$ in d) > 0 then
    d := replace(d, $s$p.status = 'published' and u.detail->'docs'$s$, $s$p.status in ('published', 'superseded') and u.detail->'docs'$s$);
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
