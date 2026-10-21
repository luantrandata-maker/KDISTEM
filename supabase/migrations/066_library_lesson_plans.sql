-- 066. Giáo án soạn trong kho học liệu (Phân hệ 2)
--  • Giáo án là học liệu loại 'lesson_plan' (kind = 'material'), nay soạn được như giáo án (060):
--    content = { type: 'lesson_plan', template_id, doc: { mục: nội dung }, steps: [{ id, phase, title, goal, teacher, student, product, minutes }],
--               periods, (tệp / đường dẫn đính kèm nếu có) }.
--  • Trigger làm gọn nội dung giáo án; trường "Dùng" giáo án → giáo án của trường có đủ mục, các bước và mẫu giáo án.
-- Cần chạy sau 065.

-- Nội dung theo mục: chỉ giữ cặp tên mục (≤ 80 ký tự) → chữ (≤ 20000 ký tự), tối đa 40 mục
create or replace function public.library_plan_doc(v jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, left(x, 20000)), '{}'::jsonb) from (
    select btrim(key) as k, value #>> '{}' as x from jsonb_each(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end)
     where jsonb_typeof(value) = 'string' and length(btrim(key)) between 1 and 80 limit 40) d
$$;

-- Các bước: chỉ giữ bước có tên, các trường chữ đã biết, thời lượng 0–300 phút, tối đa 60 bước
create or replace function public.library_plan_steps(v jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(nullif(left(s->>'id', 20), ''), 's' || o),
      'phase', nullif(left(btrim(coalesce(s->>'phase', '')), 40), ''),
      'title', left(btrim(s->>'title'), 300),
      'goal', nullif(left(btrim(coalesce(s->>'goal', '')), 2000), ''),
      'teacher', nullif(left(btrim(coalesce(s->>'teacher', '')), 5000), ''),
      'student', nullif(left(btrim(coalesce(s->>'student', '')), 5000), ''),
      'product', nullif(left(btrim(coalesce(s->>'product', '')), 2000), ''),
      'minutes', case when jsonb_typeof(s->'minutes') = 'number' and (s->>'minutes')::numeric between 0 and 300 then (s->>'minutes')::numeric end
    )) order by o), '[]'::jsonb)
  from (select s, o from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) with ordinality e(s, o)
         where jsonb_typeof(s) = 'object' and coalesce(btrim(s->>'title'), '') <> '' order by o limit 60) d
$$;

create or replace function public.library_items_plan_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kind = 'material' and new.content->>'type' = 'lesson_plan' and (new.content ? 'doc' or new.content ? 'steps') then
    new.content := new.content
      || jsonb_build_object('doc', public.library_plan_doc(new.content->'doc'), 'steps', public.library_plan_steps(new.content->'steps'),
                            'template_id', case when coalesce(new.content->>'template_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then new.content->'template_id' else 'null'::jsonb end,
                            'periods', case when coalesce(new.content->>'periods', '') ~ '^\d{1,2}$' then to_jsonb((new.content->>'periods')::int) else 'null'::jsonb end);
  end if;
  return new;
end $$;
drop trigger if exists library_items_plan_guard on library_items;
create trigger library_items_plan_guard before insert or update on library_items for each row execute function public.library_items_plan_guard();

-- Phát hành (như 059): giáo án soạn trong kho không cần tệp / đường dẫn
create or replace function public.library_publish(p_item uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare i library_items; u record; v int;
begin
  select * into i from library_items where id = p_item for update;
  if i.id is null or i.owner_org_id is distinct from public.my_org_id() or not public.library_can_manage() then
    raise exception 'Bạn không phát hành được mục này' using errcode = '42501';
  end if;
  if i.kind = 'lesson' and jsonb_array_length(coalesce(i.content->'slides', '[]')) = 0 then raise exception 'Bài giảng chưa có slide nào'; end if;
  if i.kind = 'material' and coalesce(trim(i.content->>'url'), '') = '' and coalesce(trim(i.content->>'path'), '') = ''
     and not (i.content->>'type' = 'lesson_plan'
              and (jsonb_array_length(coalesce(i.content->'steps', '[]')) > 0 or exists (select 1 from jsonb_each_text(coalesce(i.content->'doc', '{}')) d where btrim(d.value) <> ''))) then
    raise exception 'Học liệu chưa có tệp hoặc đường dẫn (giáo án: soạn nội dung hoặc đính kèm tệp)';
  end if;
  update library_items set status = 'published', version = version + 1, published_at = now(), change_note = nullif(trim(p_note), '')
   where id = i.id returning version into v;
  insert into library_item_versions (item_id, version, title, summary, content, usage_rights, change_note)
    values (i.id, v, i.title, i.summary, i.content, i.usage_rights, nullif(trim(p_note), ''))
  on conflict (item_id, version) do nothing;
  if v > 1 then
    for u in select distinct c.adopted_by, c.org_id from library_copies c where c.item_id = i.id and c.adopted_by is not null loop
      perform public.notify_user(u.adopted_by, u.org_id, 'library', 'Học liệu có bản cập nhật: ' || i.title,
        'Phiên bản ' || v || coalesce(' — ' || nullif(trim(p_note), ''), '') || '. Bản của bạn không bị thay đổi.',
        'Thư viện STEM', null, i.id, true);
    end loop;
  end if;
  return v;
end $$;
grant execute on function public.library_publish(uuid, text) to authenticated;

-- Dùng một mục kho (như 065), thêm: giáo án soạn trong kho chép mục, các bước, mẫu và số tiết
create or replace function public.library_adopt(p_item uuid, p_template boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i library_items; v_org uuid := public.my_org_id(); v_teacher uuid := public.my_teacher_id();
  v_slides jsonb; v_plan uuid; v_doc jsonb := '{}'; v_steps jsonb := '[]'; v_tpl_id uuid; v_periods smallint; v_ids uuid[] := '{}'; v_lesson uuid; v_tpl boolean;
begin
  if v_org is null or (select type from organizations where id = v_org) <> 'school' then
    raise exception 'Chỉ trường học dùng được học liệu vào bài giảng' using errcode = '42501';
  end if;
  if not public.library_visible(p_item) then raise exception 'Không tìm thấy học liệu' using errcode = '42501'; end if;
  select * into i from library_items where id = p_item;
  if i.status <> 'published' and i.owner_org_id <> v_org then raise exception 'Học liệu chưa phát hành' using errcode = '42501'; end if;
  v_tpl := coalesce(p_template, false) or v_teacher is null;
  if v_tpl and not public.is_admin() then raise exception 'Chỉ quản trị trường tạo bài giảng mẫu của trường' using errcode = '42501'; end if;

  if i.kind in ('program', 'unit') then
    for v_lesson in
      select distinct x::uuid from (
        select l.value #>> '{}' as x
          from jsonb_array_elements(case when i.kind = 'program' then coalesce(i.content->'units', '[]') else '[]'::jsonb end) u,
               jsonb_array_elements(coalesce(u->'lesson_ids', '[]')) l
        union all
        select l #>> '{}' from jsonb_array_elements(case when i.kind = 'unit' then coalesce(i.content->'lesson_ids', '[]') else '[]'::jsonb end) l
      ) s
    loop
      if public.library_visible(v_lesson) and exists (select 1 from library_items where id = v_lesson and kind = 'lesson') then
        v_ids := v_ids || ((public.library_adopt(v_lesson, v_tpl))->>'lesson_plan_id')::uuid;
      end if;
    end loop;
    insert into library_copies (item_id, org_id, adopted_version, lesson_plan_id) values (i.id, v_org, i.version, v_ids[1]);
    return jsonb_build_object('kind', i.kind, 'lesson_plan_ids', to_jsonb(v_ids), 'count', coalesce(array_length(v_ids, 1), 0));
  end if;

  if i.kind = 'lesson' then
    v_slides := coalesce(i.content->'slides', '[]'::jsonb);
  else
    v_slides := jsonb_build_array(
      jsonb_build_object('id', 's1', 'kind', 'title', 'title', i.title, 'body', coalesce(i.summary, '')),
      case when i.content->>'type' in ('video', 'image')
        then jsonb_build_object('id', 's2', 'kind', 'media', 'title', i.title, 'url', coalesce(i.content->>'url', ''))
        else jsonb_build_object('id', 's2', 'kind', 'content', 'title', 'Tài liệu tham khảo', 'body', coalesce(i.content->>'url', '')) end);
  end if;
  -- Giáo án soạn trong kho (066): chép nội dung theo mục và tiến trình các bước sang giáo án của trường
  if i.kind = 'material' and i.content->>'type' = 'lesson_plan' then
    v_doc := public.library_plan_doc(i.content->'doc');
    v_steps := public.library_plan_steps(i.content->'steps');
    v_tpl_id := (select t.id from lesson_templates t where t.id::text = i.content->>'template_id');
    v_periods := case when coalesce(i.content->>'periods', '') ~ '^\d{1,2}$' and (i.content->>'periods')::int between 1 and 20 then (i.content->>'periods')::smallint end;
  end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, is_template, status, summary, slides, library_item_id, library_version,
                            template_id, doc, steps, periods)
    values (v_org, case when v_tpl then null else v_teacher end, case when v_tpl then 'Mẫu: ' || i.title else i.title end,
            i.subject, i.grades, i.program, v_tpl, 'draft', i.summary, v_slides, i.id, i.version, v_tpl_id, v_doc, v_steps, v_periods)
    returning id into v_plan;
  insert into library_copies (item_id, org_id, adopted_version, lesson_plan_id) values (i.id, v_org, i.version, v_plan);
  return jsonb_build_object('kind', i.kind, 'lesson_plan_id', v_plan);
end $$;
grant execute on function public.library_adopt(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
