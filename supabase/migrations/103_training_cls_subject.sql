-- 103. Khung phân loại kế hoạch tập huấn: mặc định Môn học › Cấp độ (thay Cấp học › Cấp độ của 101).
--  • Thêm loại cấp 'subject' (Môn học). Cấp Môn học luôn bật, không xoá; Cấp học (kind 'level') thành cấp tuỳ chọn, xoá được.
--  • Đổi cấp "Cấp học" mặc định thành "Môn học". Các mục cấp học dựng sẵn (Tiểu học, THCS, THPT và Cơ bản / Nâng cao bên dưới)
--    được bỏ; kế hoạch đang gắn vào đó chuyển về "Chưa phân loại" để chọn lại môn. Mục người dùng tự thêm (vd. Tin học) giữ nguyên.
--  • Thêm một môn học thì tự có sẵn các mục Cơ bản, Nâng cao ở cấp Cấp độ bên dưới.
-- Cần chạy sau 101.

alter table training_cls_levels drop constraint if exists training_cls_levels_kind_check;
alter table training_cls_levels add constraint training_cls_levels_kind_check check (kind in ('subject', 'level', 'tier', 'custom'));

create or replace function public.training_cls_levels_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'subject' then raise exception 'Không xoá được cấp % (kế hoạch tập huấn cần cấp này)', old.name using errcode = '22023'; end if;
    return old;
  end if;
  new.name := btrim(new.name);
  if new.kind = 'subject' and not new.active then
    raise exception 'Không tắt được cấp % (kế hoạch tập huấn cần cấp này)', new.name using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind then raise exception 'Không đổi loại cấp' using errcode = '22023'; end if;
    if new.sort <> old.sort and exists (select 1 from training_nodes where cls_level_id = old.id) then
      raise exception 'Cấp % đã có mục trong cây nên không đổi thứ tự được', old.name using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- Đổi cấp mặc định sang Môn học (bỏ qua guard trong lúc chuyển)
do $$
declare v_lv uuid; v_dead uuid[];
begin
  if exists (select 1 from training_cls_levels where kind = 'subject') then return; end if;
  select id into v_lv from training_cls_levels where kind = 'level';
  if v_lv is null then
    insert into training_cls_levels (name, kind, sort) values ('Môn học', 'subject', 10);
    return;
  end if;
  -- Mục cấp học dựng sẵn (có edu_level) và cây con của chúng
  with recursive t as (
    select id from training_nodes where cls_level_id = v_lv and edu_level is not null
    union all select n.id from training_nodes n join t on n.parent_id = t.id)
  select array_agg(id) into v_dead from t;
  if v_dead is not null then
    update training_plans set node_id = null where node_id = any(v_dead);
    alter table training_nodes disable trigger training_nodes_guard;
    -- xoá từ lá lên gốc
    while exists (select 1 from training_nodes where id = any(v_dead)) loop
      delete from training_nodes n where n.id = any(v_dead) and not exists (select 1 from training_nodes c where c.parent_id = n.id);
    end loop;
    alter table training_nodes enable trigger training_nodes_guard;
  end if;
  alter table training_cls_levels disable trigger training_cls_levels_guard;
  update training_cls_levels set kind = 'subject', name = case when name = 'Cấp học' then 'Môn học' else name end, active = true where id = v_lv;
  alter table training_cls_levels enable trigger training_cls_levels_guard;
end $$;

-- Thêm môn học thì có sẵn Cơ bản, Nâng cao ở cấp Cấp độ
create or replace function public.training_nodes_tiers() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_tier uuid;
begin
  select kind into v_kind from training_cls_levels where id = new.cls_level_id;
  if v_kind <> 'subject' then return null; end if;
  select id into v_tier from training_cls_levels where kind = 'tier' and active;
  if v_tier is null or not exists (select 1 from training_cls_levels l join training_cls_levels s on s.id = new.cls_level_id where l.id = v_tier and l.sort > s.sort) then return null; end if;
  if not exists (select 1 from training_nodes where parent_id = new.id) then
    insert into training_nodes (cls_level_id, parent_id, name, sort) values (v_tier, new.id, 'Cơ bản', 1), (v_tier, new.id, 'Nâng cao', 2);
  end if;
  return null;
end $$;
drop trigger if exists training_nodes_tiers on training_nodes;
create trigger training_nodes_tiers after insert on training_nodes for each row execute function public.training_nodes_tiers();

-- Môn học người dùng đã thêm trước đó (vd. Tin học) mà chưa có cấp độ: bổ sung Cơ bản, Nâng cao
do $$
declare v_tier uuid; n record;
begin
  select id into v_tier from training_cls_levels where kind = 'tier' and active;
  if v_tier is null then return; end if;
  for n in select x.id from training_nodes x join training_cls_levels l on l.id = x.cls_level_id
            where l.kind = 'subject' and not exists (select 1 from training_nodes c where c.parent_id = x.id) loop
    insert into training_nodes (cls_level_id, parent_id, name, sort) values (v_tier, n.id, 'Cơ bản', 1), (v_tier, n.id, 'Nâng cao', 2);
  end loop;
end $$;

notify pgrst, 'reload schema';
