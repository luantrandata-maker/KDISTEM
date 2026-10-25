-- 093. Chương trình tập huấn: phiên bản & duyệt (giống chương trình giáo dục).
--  • Thêm family_id (các phiên bản của cùng một chương trình), note. Mã chương trình dùng chung cho mọi phiên bản.
--  • Trạng thái: Nháp → Chờ duyệt → Đã duyệt / Bị trả lại → Đã phát hành → Đã thay thế (khi phiên bản mới phát hành) / Ngừng dùng.
--    Quản trị nền tảng KDI vẫn phát hành thẳng được từ bản nháp như trước.
--  • Nội dung chỉ sửa khi Nháp / Bị trả lại. Nhật ký trạng thái training_program_log.
--  • training_program_set_status(): đổi trạng thái kèm ghi chú; training_program_new_version(): phiên bản mới (nháp) cùng họ.
--  Triển khai (gán cho đơn vị) vẫn qua Kế hoạch tập huấn; tab "Gán & triển khai" đọc kế hoạch dùng chương trình.
-- Cần chạy sau 092.

alter table training_programs add column if not exists family_id uuid;
alter table training_programs add column if not exists note text check (note is null or length(note) <= 1000);

alter table training_programs disable trigger training_programs_guard;
alter table training_programs disable trigger training_programs_a_multi_sync;
-- Họ phiên bản: theo chuỗi source_id về bản gốc
with recursive up as (
  select id, id as root, source_id from training_programs where source_id is null
  union all
  select t.id, up.root, t.source_id from training_programs t join up on t.source_id = up.id
)
update training_programs t set family_id = up.root from up where up.id = t.id and t.family_id is null;
update training_programs set family_id = id where family_id is null;
alter table training_programs enable trigger training_programs_a_multi_sync;
alter table training_programs enable trigger training_programs_guard;
alter table training_programs alter column family_id set not null;
create index if not exists training_programs_family on training_programs (family_id);

alter table training_programs drop constraint if exists training_programs_status_check;
alter table training_programs add constraint training_programs_status_check
  check (status in ('draft', 'pending', 'approved', 'rejected', 'published', 'superseded', 'archived'));
-- Mã dùng chung cho các phiên bản cùng họ: bỏ ràng buộc duy nhất theo bản ghi, kiểm tra trong trigger
alter table training_programs drop constraint if exists training_programs_org_id_code_key;
create index if not exists training_programs_org_code on training_programs (org_id, code);

create table if not exists training_program_log (
  id bigint generated always as identity primary key,
  program_id uuid not null references training_programs(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  by_user uuid references profiles(id) on delete set null default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists training_program_log_prog on training_program_log (program_id, at desc);
alter table training_program_log enable row level security;
drop policy if exists training_program_log_read on training_program_log;
create policy training_program_log_read on training_program_log for select to authenticated
  using (exists (select 1 from training_programs p where p.id = program_id));
grant select on training_program_log to authenticated;

-- Mã, chuẩn hoá, khoá nội dung khi không còn là nháp, điều kiện phát hành, thay thế phiên bản cũ
create or replace function public.training_programs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.title := btrim(new.title); new.updated_at := now();
  new.code := nullif(btrim(new.code), '');
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Chương trình tập huấn mới phải là bản nháp' using errcode = '22023'; end if;
    new.family_id := coalesce(new.family_id, new.id);
    if new.code is null then
      select 'CTTH-' || lpad((coalesce(max(substring(code from '^CTTH-(\d+)$')::int), 0) + 1)::text, 3, '0') into new.code
        from training_programs where org_id = new.org_id;
    end if;
  else
    if new.org_id <> old.org_id then raise exception 'Không đổi đơn vị của chương trình tập huấn' using errcode = '22023'; end if;
    new.family_id := old.family_id;
    if old.status not in ('draft', 'rejected')
       and (new.code, new.title, new.ct_code, new.level, new.ct_codes, new.levels, new.audience, new.mode, new.description, new.competencies,
            new.target_level, new.pass_attendance, new.pass_score, new.need_product, new.version_no)
           is distinct from (old.code, old.title, old.ct_code, old.level, old.ct_codes, old.levels, old.audience, old.mode, old.description, old.competencies,
            old.target_level, old.pass_attendance, old.pass_score, old.need_product, old.version_no) then
      raise exception 'Chương trình tập huấn đã gửi duyệt / phát hành: tạo phiên bản mới để sửa' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from training_programs t where t.org_id = new.org_id and t.code = new.code and t.family_id <> new.family_id) then
    raise exception 'Mã % đã dùng cho chương trình tập huấn khác', new.code using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and new.status = 'published' and old.status <> 'published' then
    if not exists (select 1 from training_program_units where program_id = new.id and kind = 'content') then
      raise exception 'Chưa phát hành được: chương trình chưa có nội dung tập huấn nào' using errcode = '22023';
    end if;
    if new.pass_score is not null and not exists (select 1 from training_program_units where program_id = new.id and has_test) then
      raise exception 'Chưa phát hành được: có điều kiện điểm bài test nhưng chưa nội dung nào có bài test' using errcode = '22023';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;

-- Sau khi đổi trạng thái: ghi nhật ký; phát hành phiên bản mới thì phiên bản đang phát hành cũ thành "Đã thay thế"
create or replace function public.training_programs_status_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into training_program_log (program_id, from_status, to_status, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, nullif(current_setting('app.tp_status_note', true), ''));
  end if;
  if tg_op = 'UPDATE' and new.status = 'published' and old.status <> 'published' then
    update training_programs set status = 'superseded'
     where family_id = new.family_id and id <> new.id and status = 'published';
  end if;
  return null;
end $$;
drop trigger if exists training_programs_status_after on training_programs;
create trigger training_programs_status_after after insert or update of status on training_programs
  for each row execute function public.training_programs_status_after();
revoke all on function public.training_programs_status_after() from public, anon, authenticated;

-- Môn / nội dung chỉ sửa khi chương trình là nháp hoặc bị trả lại
create or replace function public.training_units_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prog uuid := coalesce(new.program_id, old.program_id); v_st text;
begin
  select status into v_st from training_programs where id = v_prog;
  if v_st is not null and v_st not in ('draft', 'rejected') then
    raise exception 'Chương trình tập huấn đã gửi duyệt / phát hành: tạo phiên bản mới để sửa' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.title := btrim(new.title);
  if new.kind = 'content' and not exists (select 1 from training_program_units p where p.id = new.parent_id and p.program_id = new.program_id and p.kind = 'subject') then
    raise exception 'Nội dung tập huấn phải nằm trong một môn của chương trình' using errcode = '22023';
  end if;
  if new.kind = 'subject' then new.parent_id := null; new.has_test := false; end if;
  return new;
end $$;

-- Đổi trạng thái theo quy trình (chỉ quản trị nền tảng KDI)
create or replace function public.training_program_set_status(p_program uuid, p_status text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s training_programs; ok boolean;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng KDI duyệt / phát hành chương trình tập huấn' using errcode = '42501'; end if;
  select * into s from training_programs where id = p_program for update;
  if s.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  ok := case p_status
    when 'pending'   then s.status in ('draft', 'rejected')
    when 'approved'  then s.status = 'pending'
    when 'rejected'  then s.status = 'pending'
    when 'published' then s.status in ('draft', 'approved', 'archived')
    when 'draft'     then s.status in ('approved', 'rejected')
    when 'archived'  then s.status in ('published', 'superseded', 'approved', 'rejected', 'draft')
    else false end;
  if not ok then raise exception 'Không chuyển được từ trạng thái hiện tại sang "%"', p_status using errcode = '22023'; end if;
  if p_status = 'pending' and not exists (select 1 from training_program_units where program_id = s.id and kind = 'content') then
    raise exception 'Chương trình chưa có nội dung tập huấn nào' using errcode = '22023';
  end if;
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'Nhập lý do trả lại' using errcode = '22023'; end if;
  perform set_config('app.tp_status_note', coalesce(p_note, ''), true);
  update training_programs set status = p_status where id = s.id;
  perform set_config('app.tp_status_note', '', true);
  return p_status;
end $$;
revoke all on function public.training_program_set_status(uuid, text, text) from public, anon;
grant execute on function public.training_program_set_status(uuid, text, text) to authenticated;

-- Chép nội dung một chương trình sang bản nháp mới
create or replace function public.training_program_clone(p_src uuid, p_family uuid, p_version int, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_new uuid := gen_random_uuid(); v_src training_programs; m record; v_mod uuid;
begin
  select * into v_src from training_programs where id = p_src;
  if v_src.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  insert into training_programs (id, org_id, family_id, code, title, ct_code, level, ct_codes, levels, audience, mode, description, competencies, target_level,
    pass_attendance, pass_score, need_product, cert_template_id, version_no, source_id)
  values (v_new, public.my_org_id(), coalesce(p_family, v_new), p_code, v_src.title, v_src.ct_code, v_src.level, v_src.ct_codes, v_src.levels, v_src.audience,
    v_src.mode, v_src.description, v_src.competencies, v_src.target_level, v_src.pass_attendance, v_src.pass_score, v_src.need_product,
    v_src.cert_template_id, p_version, p_src);
  for m in select * from training_program_units where program_id = p_src and kind = 'subject' order by seq loop
    insert into training_program_units (program_id, kind, seq, title, hours, mode, note)
      values (v_new, 'subject', m.seq, m.title, m.hours, m.mode, m.note) returning id into v_mod;
    insert into training_program_units (program_id, parent_id, kind, seq, title, hours, mode, has_test, note, detail)
      select v_new, v_mod, 'content', u.seq, u.title, u.hours, u.mode, u.has_test, u.note, u.detail
        from training_program_units u where u.parent_id = m.id;
  end loop;
  return v_new;
end $$;
revoke all on function public.training_program_clone(uuid, uuid, int, text) from public, anon, authenticated;

-- Nhân bản (đường cũ): bản nháp cùng họ, cùng mã, số phiên bản kế tiếp
create or replace function public.training_program_copy(p_program uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s training_programs;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng KDI soạn được chương trình tập huấn' using errcode = '42501'; end if;
  select * into s from training_programs where id = p_program;
  if s.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  return public.training_program_clone(p_program, s.family_id, (select max(version_no) + 1 from training_programs where family_id = s.family_id), s.code);
end $$;
revoke all on function public.training_program_copy(uuid) from public, anon;
grant execute on function public.training_program_copy(uuid) to authenticated;

-- Phiên bản mới: nháp cùng họ, cùng mã, số phiên bản kế tiếp; mỗi họ chỉ một phiên bản đang soạn / chờ duyệt
create or replace function public.training_program_new_version(p_program uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s training_programs; v int;
begin
  if not public.is_platform_admin() then raise exception 'Chỉ quản trị nền tảng KDI soạn được chương trình tập huấn' using errcode = '42501'; end if;
  select * into s from training_programs where id = p_program;
  if s.id is null then raise exception 'Không tìm thấy chương trình tập huấn' using errcode = '22023'; end if;
  if exists (select 1 from training_programs where family_id = s.family_id and status in ('draft', 'pending', 'approved', 'rejected')) then
    raise exception 'Chương trình đã có một phiên bản đang soạn / chờ duyệt' using errcode = '22023';
  end if;
  select max(version_no) + 1 into v from training_programs where family_id = s.family_id;
  return public.training_program_clone(p_program, s.family_id, v, s.code);
end $$;
revoke all on function public.training_program_new_version(uuid) from public, anon;
grant execute on function public.training_program_new_version(uuid) to authenticated;

-- Đơn vị xem được bản đã phát hành và bản đã thay thế (kế hoạch cũ vẫn dùng)
drop policy if exists training_programs_read on training_programs;
create policy training_programs_read on training_programs for select to authenticated
  using (status in ('published', 'superseded') or org_id = public.my_org_id() or public.is_platform_admin());

notify pgrst, 'reload schema';
