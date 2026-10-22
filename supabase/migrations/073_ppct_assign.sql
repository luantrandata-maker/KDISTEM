-- 073. Kế hoạch dạy học — đợt 3: Gán tập trung chương trình cho trường, khối, lớp
--  • edu_program_assign_bulk(): KDI / Sở gán một chương trình cho nhiều trường cùng lúc (kèm khối) và tùy chọn tạo sẵn
--    PPCT nháp cho từng khối của trường: lấy mẫu PPCT đã ban hành của đơn vị gán (hoặc của KDI) cho chương trình và
--    khối đó; chưa có mẫu thì sinh từ chương trình. Khối + môn đã có PPCT trong năm học hiện tại của trường thì bỏ qua.
--  • curriculum_class_coverage(): mỗi lớp × môn của trường đang theo PPCT nào (chọn riêng cho lớp hay PPCT chung của khối).
--  • curriculum_set_class_book(): đổi PPCT của một lớp cho một môn (hoặc trả về PPCT chung của khối).
-- Cần chạy sau 072.

-- ===== 1. Tạo sẵn PPCT nháp cho trường được gán =====
create or replace function public.curriculum_seed_school_books(p_program uuid, p_org uuid, p_grades int[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare p edu_programs; g int; v_year text; t curriculum_books; v_book uuid; n int := 0;
begin
  select * into p from edu_programs where id = p_program;
  if p.id is null then raise exception 'Không tìm thấy chương trình' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = p_org and type = 'school') then return 0; end if;
  if not exists (select 1 from edu_program_assignments a where a.program_id = p_program and a.org_id = p_org
                   and (a.assigner_org = public.my_org_id() or public.curriculum_can_write(public.edu_program_org(p_program), 'edit')))
     or not (p_org in (select public.my_org_tree()) or public.is_platform_admin()) then
    raise exception 'Chỉ đơn vị đã gán chương trình mới tạo được PPCT cho trường' using errcode = '42501';
  end if;
  select a.name into v_year from academic_years a where a.org_id = p_org and a.is_current limit 1;
  for g in select x from generate_series(p.grade_from, p.grade_to) x where p_grades is null or x = any(p_grades) loop
    continue when exists (select 1 from curriculum_books b where b.org_id = p_org and b.grade = g and lower(b.subject) = lower(p.main_subject)
                                                          and b.year_name is not distinct from v_year);
    select b.* into t from curriculum_books b
     where b.program_id = p.id and b.grade = g and b.scope = 'children' and b.status = 'published'
       and b.org_id in (public.my_org_id(), public.platform_org_id())
     order by (b.org_id = public.my_org_id()) desc, b.updated_at desc limit 1;
    insert into curriculum_books (org_id, grade, subject, title, year_name, periods_per_week, status, scope, source_id, program_id, allocation, note)
    values (p_org, g, coalesce(t.subject, p.main_subject), coalesce(t.title, p.title || ' — khối ' || g), v_year, t.periods_per_week, 'draft', 'own',
            t.id, p.id, t.allocation, 'Tạo sẵn khi được gán chương trình "' || p.title || '"')
    returning id into v_book;
    if t.id is not null then
      perform set_config('app.ppct_import', 'on', true);
      insert into curriculum_lessons (book_id, seq, week, term, title, kind, unit_id, note)
      select v_book, l.seq, l.week, l.term, l.title, l.kind, l.unit_id, l.note from curriculum_lessons l where l.book_id = t.id;
      perform set_config('app.ppct_import', 'off', true);
    else
      begin
        perform public.curriculum_generate(v_book);
      exception when sqlstate '22023' then
        delete from curriculum_books where id = v_book; v_book := null;
      end;
    end if;
    if v_book is not null then n := n + 1; end if;
    t := null;
  end loop;
  return n;
end $$;
revoke all on function public.curriculum_seed_school_books(uuid, uuid, int[]) from public, anon;
grant execute on function public.curriculum_seed_school_books(uuid, uuid, int[]) to authenticated;

-- ===== 2. Gán chương trình cho nhiều trường (quyền gán theo RLS của người gọi) =====
create or replace function public.edu_program_assign_bulk(p_program uuid, p_orgs uuid[], p_grades int[] default null,
  p_make_books boolean default true, p_note text default null) returns jsonb
language plpgsql set search_path = public as $$
declare v_org uuid; a int := 0; b int := 0; v_grades int[];
begin
  v_grades := case when coalesce(array_length(p_grades, 1), 0) = 0 then null else (select array_agg(distinct x order by x) from unnest(p_grades) x) end;
  foreach v_org in array coalesce(p_orgs, '{}') loop
    insert into edu_program_assignments (program_id, org_id, grades, note)
    values (p_program, v_org, v_grades, nullif(btrim(p_note), ''))
    on conflict (program_id, org_id) do update set grades = excluded.grades, note = coalesce(excluded.note, edu_program_assignments.note);
    a := a + 1;
    if p_make_books then b := b + public.curriculum_seed_school_books(p_program, v_org, v_grades); end if;
  end loop;
  return jsonb_build_object('assigned', a, 'books', b);
end $$;
revoke all on function public.edu_program_assign_bulk(uuid, uuid[], int[], boolean, text) from public, anon;
grant execute on function public.edu_program_assign_bulk(uuid, uuid[], int[], boolean, text) to authenticated;

-- ===== 3. Lớp × môn đang theo PPCT nào =====
create or replace function public.curriculum_class_coverage(p_org uuid default null)
returns table (class_id uuid, class_name text, grade int, subject text, book_id uuid, book_title text, explicit boolean)
language sql stable security definer set search_path = public as $$
  select cb.class_id, cb.class_name, cb.grade, b.subject, b.id, b.title,
         exists (select 1 from curriculum_book_classes x where x.book_id = b.id and x.class_id = cb.class_id)
    from public.curriculum_class_books(coalesce(p_org, public.my_org_id()), null) cb
    join curriculum_books b on b.id = cb.book_id
$$;
revoke all on function public.curriculum_class_coverage(uuid) from public, anon;
grant execute on function public.curriculum_class_coverage(uuid) to authenticated;

-- ===== 4. Đổi PPCT của một lớp cho một môn (quyền theo RLS: sửa PPCT của trường) =====
create or replace function public.curriculum_set_class_book(p_class uuid, p_subject text, p_book uuid default null) returns void
language plpgsql set search_path = public as $$
begin
  if p_book is not null and not exists (select 1 from curriculum_books b join classes c on c.id = p_class
                                         where b.id = p_book and b.org_id = c.org_id and b.grade = c.grade and lower(b.subject) = lower(btrim(p_subject))) then
    raise exception 'PPCT không cùng trường, khối hoặc môn với lớp' using errcode = '22023';
  end if;
  delete from curriculum_book_classes x using curriculum_books b
   where b.id = x.book_id and x.class_id = p_class and lower(b.subject) = lower(btrim(p_subject)) and x.book_id is distinct from p_book;
  if p_book is not null then
    insert into curriculum_book_classes (book_id, class_id) values (p_book, p_class) on conflict do nothing;
    if not found and not exists (select 1 from curriculum_book_classes where book_id = p_book and class_id = p_class) then
      raise exception 'Bạn không có quyền đổi PPCT của lớp' using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function public.curriculum_set_class_book(uuid, text, uuid) from public, anon;
grant execute on function public.curriculum_set_class_book(uuid, text, uuid) to authenticated;
