-- 125. Phiên bản của bản phân phối và lịch sử áp dụng theo năm học
--  • dist_plans.family_id + version_no: các phiên bản của cùng một bản phân phối (cùng mã PB-xxx).
--    "Tạo phiên bản mới" từ bản đã phát hành: bản nháp vN+1, cùng mã. Phát hành vN+1 thì bản đang phát hành
--    trước đó chuyển sang "Đã thay thế" (superseded): không gán mới được, PPCT đã gán cho trường giữ nguyên.
--  • "Nhân bản" vẫn tạo một bản phân phối khác (mã mới, phiên bản 1).
--  • dist_plan_history(p_family): mỗi lần gán của mọi phiên bản: năm học, trường, phiên bản, PPCT, số tiết.
-- Cần chạy sau 078, 079, 082.

alter table dist_plans add column if not exists family_id uuid;
alter table dist_plans add column if not exists version_no int not null default 1;
update dist_plans set family_id = id where family_id is null;
alter table dist_plans alter column family_id set not null;
alter table dist_plans drop constraint if exists dist_plans_version_no_check;
alter table dist_plans add constraint dist_plans_version_no_check check (version_no between 1 and 999);
create index if not exists dist_plans_family on dist_plans (family_id, version_no);

-- Cùng mã cho mọi phiên bản: mã + phiên bản là duy nhất trong đơn vị
alter table dist_plans drop constraint if exists dist_plans_org_id_code_key;
alter table dist_plans drop constraint if exists dist_plans_org_code_version_key;
alter table dist_plans add constraint dist_plans_org_code_version_key unique (org_id, code, version_no);
alter table dist_plans drop constraint if exists dist_plans_family_version_key;
alter table dist_plans add constraint dist_plans_family_version_key unique (family_id, version_no);

alter table dist_plans drop constraint if exists dist_plans_status_check;
alter table dist_plans add constraint dist_plans_status_check check (status in ('draft', 'published', 'superseded', 'archived'));

alter table curriculum_books add column if not exists dist_assigned_at timestamptz;

-- Bản mới: tự là một họ phiên bản; phiên bản không đổi sau khi tạo
create or replace function public.dist_plans_family() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.family_id := coalesce(new.family_id, new.id);
    if new.family_id <> new.id and not exists (select 1 from dist_plans d where d.id = new.family_id and d.org_id = new.org_id) then
      raise exception 'Phiên bản mới phải cùng đơn vị với bản gốc' using errcode = '22023';
    end if;
  elsif (new.family_id, new.version_no) is distinct from (old.family_id, old.version_no) then
    raise exception 'Không đổi phiên bản của bản phân phối' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists dist_plans_family on dist_plans;
create trigger dist_plans_family before insert or update on dist_plans for each row execute function public.dist_plans_family();

-- Phát hành một phiên bản → phiên bản đang phát hành khác cùng họ chuyển sang "Đã thay thế"
create or replace function public.dist_plans_supersede() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    update dist_plans set status = 'superseded'
     where family_id = new.family_id and id <> new.id and status = 'published';
  end if;
  return null;
end $$;
drop trigger if exists dist_plans_supersede on dist_plans;
create trigger dist_plans_supersede after update of status on dist_plans for each row execute function public.dist_plans_supersede();

-- Tạo phiên bản mới (nháp) từ một phiên bản bất kỳ của bản: chép chương trình, môn và lịch bài
create or replace function public.dist_plan_new_version(p_plan uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s dist_plans; v_new uuid; v_no int;
begin
  select * into s from dist_plans where id = p_plan;
  if s.id is null or not public.dist_plan_visible(p_plan) then raise exception 'Không tìm thấy bản phân phối' using errcode = '42501'; end if;
  if not public.curriculum_can_write(s.org_id, 'edit') then
    raise exception 'Chỉ đơn vị soạn bản mới tạo được phiên bản mới; hãy dùng Nhân bản' using errcode = '42501';
  end if;
  if exists (select 1 from dist_plans where family_id = s.family_id and status = 'draft') then
    raise exception 'Bản này đang có một phiên bản nháp; hãy soạn tiếp bản nháp đó' using errcode = '22023';
  end if;
  select max(version_no) + 1 into v_no from dist_plans where family_id = s.family_id;
  insert into dist_plans (org_id, code, title, level, grade, tier, node_id, hk1_weeks, hk2_weeks, note, source_id, family_id, version_no)
  values (s.org_id, s.code, s.title, s.level, s.grade, s.tier, s.node_id, s.hk1_weeks, s.hk2_weeks, s.note, s.id, s.family_id, v_no)
  returning id into v_new;
  insert into dist_plan_items (plan_id, program_id, seq, start_mode, start_week, after_program, ppw, split, subjects)
  select v_new, program_id, seq, start_mode, start_week, after_program, ppw, split, subjects from dist_plan_items where plan_id = s.id;
  insert into dist_plan_rows (plan_id, program_id, unit_id, seq, week, periods, note, manual, skipped, weeks)
  select v_new, program_id, unit_id, seq, week, periods, note, manual, skipped, weeks from dist_plan_rows where plan_id = s.id;
  return v_new;
end $$;
revoke all on function public.dist_plan_new_version(uuid) from public, anon;
grant execute on function public.dist_plan_new_version(uuid) to authenticated;

-- Ghi thời điểm gán vào PPCT tạo từ bản phân phối (để xem lịch sử áp dụng)
create or replace function public.curriculum_books_dist_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.dist_plan_id is not null and new.dist_assigned_at is null then new.dist_assigned_at := now(); end if;
  return new;
end $$;
drop trigger if exists curriculum_books_dist_stamp on curriculum_books;
create trigger curriculum_books_dist_stamp before insert on curriculum_books for each row execute function public.curriculum_books_dist_stamp();
update curriculum_books set dist_assigned_at = updated_at where dist_plan_id is not null and dist_assigned_at is null;

-- Lịch sử áp dụng: mọi lần gán của các phiên bản bản phân phối mà người dùng thấy được.
-- p_family null = mọi bản; p_year null = mọi năm học. Chỉ trả trường người dùng được xem.
create or replace function public.dist_plan_history(p_family uuid default null, p_year text default null)
returns table (book_id uuid, year_name text, org_id uuid, school text, plan_id uuid, family_id uuid, code text, version_no int,
               plan_title text, book_title text, book_status text, lessons int, assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.year_name, b.org_id, o.name, d.id, d.family_id, d.code, d.version_no, d.title, b.title, b.status,
         (select count(*)::int from curriculum_lessons l where l.book_id = b.id), coalesce(b.dist_assigned_at, b.updated_at)
    from curriculum_books b
    join dist_plans d on d.id = b.dist_plan_id
    join organizations o on o.id = b.org_id
   where (p_family is null or d.family_id = p_family)
     and (p_year is null or b.year_name = p_year)
     and (public.can_access_org(b.org_id) or public.can_access_org(d.org_id) or public.is_platform_admin())
   order by b.year_name desc nulls last, o.name, d.code, d.version_no
$$;
revoke all on function public.dist_plan_history(uuid, text) from public, anon;
grant execute on function public.dist_plan_history(uuid, text) to authenticated;
