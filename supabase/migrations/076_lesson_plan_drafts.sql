-- 076. Soạn bài giảng — bản nháp để sửa bài đã xuất bản (Phân hệ 2, đợt 2)
--  Trước: "Tạo phiên bản mới" đưa chính bài đã xuất bản về "đang soạn" → lớp đang trình chiếu / học sinh thấy nội dung
--  đang sửa dở, đồng nghiệp mất bài trong Kho bài giảng mẫu.
--  Nay: lesson_plan_draft() tạo một bản nháp riêng (lesson_plans.draft_of = bài gốc). Bài gốc vẫn xuất bản nguyên vẹn.
--  Xuất bản bản nháp (lesson_plan_publish) chép nội dung sang bài gốc, tăng phiên bản, lưu lịch sử, rồi bỏ bản nháp.
--  Bỏ bản nháp = xoá bản nháp. "Tạo phiên bản mới" trên bài đã xuất bản vẫn dùng được (= gỡ xuất bản để sửa thẳng).
-- Cần chạy sau 075.

alter table lesson_plans add column if not exists draft_of uuid references lesson_plans(id) on delete cascade;
create unique index if not exists lesson_plans_one_draft on lesson_plans (draft_of) where draft_of is not null;

-- Bản nháp chỉ tạo qua lesson_plan_draft(); không đổi bài gốc của bản nháp
create or replace function public.lesson_plans_draft_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.draft_of is distinct from old.draft_of then
    raise exception 'Không đổi bài gốc của bản nháp' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and new.draft_of is not null and coalesce(current_setting('app.lesson_engine', true), '') <> 'on' then
    raise exception 'Tạo bản nháp bằng nút "Tạo bản nháp để sửa"' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists lesson_plans_draft_guard on lesson_plans;
create trigger lesson_plans_draft_guard before insert or update of draft_of on lesson_plans for each row execute function public.lesson_plans_draft_guard();

-- Tạo (hoặc mở lại) bản nháp để sửa một bài đã xuất bản
create or replace function public.lesson_plan_draft(p_plan uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; v_new uuid;
begin
  select * into p from lesson_plans where id = p_plan for update;
  if p.id is null or not public.lesson_plan_can_edit(p) then raise exception 'Bạn không sửa được bài giảng này' using errcode = '42501'; end if;
  if p.status <> 'published' then raise exception 'Chỉ tạo bản nháp cho bài đã xuất bản' using errcode = '22023'; end if;
  if p.draft_of is not null then raise exception 'Đây đã là bản nháp' using errcode = '22023'; end if;
  select id into v_new from lesson_plans where draft_of = p.id;
  if v_new is not null then return v_new; end if;
  perform set_config('app.lesson_engine', 'on', true);
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, from_package, is_template, status, summary, slides, source_id,
                            library_item_id, library_version, template_id, doc, steps, program_id, unit_id, library_ids, rubric_ids, norm_id,
                            norm_adjust, periods, lesson, cover_url, version_no, draft_of)
  values (p.org_id, p.teacher_id, p.title, p.subject, p.grades, p.program, p.from_package, p.is_template, 'editing', p.summary, p.slides, p.source_id,
          p.library_item_id, p.library_version, p.template_id, p.doc, p.steps, p.program_id, p.unit_id, p.library_ids, p.rubric_ids, p.norm_id,
          p.norm_adjust, p.periods, p.lesson, p.cover_url, p.version_no, p.id)
  returning id into v_new;
  perform set_config('app.lesson_engine', '', true);
  return v_new;
end $$;
revoke all on function public.lesson_plan_draft(uuid) from public, anon;
grant execute on function public.lesson_plan_draft(uuid) to authenticated;

-- Xuất bản: thêm nhánh xuất bản bản nháp thay bài gốc
create or replace function public.lesson_plan_publish(p_plan uuid, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare p lesson_plans; o lesson_plans; v int;
begin
  select * into p from lesson_plans where id = p_plan for update;
  if p.id is null or not public.lesson_plan_can_edit(p) then raise exception 'Bạn không xuất bản được giáo án này' using errcode = '42501'; end if;
  if p.status not in ('draft', 'editing', 'approved', 'rejected') then raise exception 'Giáo án không ở trạng thái xuất bản được' using errcode = '22023'; end if;
  if p.status <> 'approved' and not p.is_template and not public.is_admin() and public.lesson_review_required(p.org_id) then
    raise exception 'Trường yêu cầu duyệt giáo án — gửi duyệt trước khi xuất bản' using errcode = '42501';
  end if;
  if jsonb_array_length(p.slides) = 0 and jsonb_array_length(p.steps) = 0 and p.doc = '{}'::jsonb and public.lesson_block_count(p.lesson) = 0 then
    raise exception 'Giáo án chưa có nội dung' using errcode = '22023';
  end if;
  -- 076: bản nháp để sửa → chép nội dung sang bài gốc (giữ id để lớp, học sinh đang dùng không bị đứt), rồi bỏ bản nháp
  if p.draft_of is not null then
    select * into o from lesson_plans where id = p.draft_of for update;
    if o.id is null then raise exception 'Không còn bài giảng gốc của bản nháp này' using errcode = '22023'; end if;
    v := o.version_no + 1;
    perform set_config('app.lesson_engine', 'on', true);
    update lesson_plans set title = p.title, subject = p.subject, grades = p.grades, program = p.program, summary = p.summary,
           slides = p.slides, template_id = p.template_id, doc = p.doc, steps = p.steps, program_id = p.program_id, unit_id = p.unit_id,
           library_ids = p.library_ids, rubric_ids = p.rubric_ids, norm_id = p.norm_id, norm_adjust = p.norm_adjust, periods = p.periods,
           lesson = p.lesson, cover_url = p.cover_url, status = 'published', version_no = v, published_at = now()
     where id = o.id;
    insert into lesson_plan_versions (plan_id, version_no, snapshot, note) values (o.id, v, public.lesson_plan_content(p), nullif(trim(p_note), ''));
    -- Góp ý dạy thử trên bản nháp chuyển sang bài gốc
    update lesson_plan_reviews set plan_id = o.id where plan_id = p.id;
    delete from lesson_plans where id = p.id;
    perform set_config('app.lesson_engine', '', true);
    return v;
  end if;
  v := p.version_no + 1;
  perform set_config('app.lesson_engine', 'on', true);
  update lesson_plans set status = 'published', version_no = v, published_at = now() where id = p.id;
  perform set_config('app.lesson_engine', '', true);
  insert into lesson_plan_versions (plan_id, version_no, snapshot, note) values (p.id, v, public.lesson_plan_content(p), nullif(trim(p_note), ''));
  return v;
end $$;

notify pgrst, 'reload schema';
