-- 128: Cấp học Mầm non. Khối mầm non lưu bằng số âm (không dùng 0 để tránh nhầm với "không có khối"):
--   -4 Nhà trẻ · -3 Mầm (3–4 tuổi) · -2 Chồi (4–5 tuổi) · -1 Lá (5–6 tuổi). Khối phổ thông giữ 1–12.
-- Nới mọi ràng buộc khối "1–12" thành "-4–12": tự tìm các CHECK trên cột grade / grade_from / grade_to / grades.

do $$ declare c record; v text; begin
  for c in
    select n.nspname, t.relname, k.conname, pg_get_constraintdef(k.oid) def
    from pg_constraint k join pg_class t on t.oid = k.conrelid join pg_namespace n on n.oid = t.relnamespace
    where k.contype = 'c' and n.nspname = 'public'
      and pg_get_constraintdef(k.oid) ~ '\m(grade|grade_from|grade_to|grades)\M'
      and (pg_get_constraintdef(k.oid) ~ '\m(grade|grade_from|grade_to) >= 1\)' or pg_get_constraintdef(k.oid) ~ 'ARRAY\[1, 2, 3')
  loop
    v := regexp_replace(c.def, '\m(grade|grade_from|grade_to) >= 1\)', '\1 >= -4)', 'g');
    v := replace(v, 'ARRAY[1, 2, 3', 'ARRAY[-4, -3, -2, -1, 1, 2, 3');
    v := replace(v, 'cardinality(grades) <= 12', 'cardinality(grades) <= 16');
    if v <> c.def then
      execute format('alter table %I.%I drop constraint %I', c.nspname, c.relname, c.conname);
      execute format('alter table %I.%I add constraint %I %s', c.nspname, c.relname, c.conname, v);
    end if;
  end loop;
end $$;

-- Hàm kiểm tra khối của chương trình (091) và đọc khối trong ma trận đề (123)
do $$ declare d text; begin
  d := pg_get_functiondef('public.edu_programs_grades_sync()'::regprocedure);
  d := replace(replace(d, 'g < 1 or g > 12', 'g < -4 or g > 12 or g = 0'), 'Khối phải từ 1 đến 12', 'Khối không hợp lệ (mầm non -4…-1, phổ thông 1–12)');
  execute d;
  d := pg_get_functiondef('public.exam_spec_grades(jsonb)'::regprocedure);
  d := replace(replace(d, '''^\d{1,2}$'' and x::int between 1 and 12', '''^-?\d{1,2}$'' and x::int between -4 and 12 and x::int <> 0'), '(p ->> ''grade'') ~ ''^\d{1,2}$''', '(p ->> ''grade'') ~ ''^-?\d{1,2}$''');
  execute d;
end $$;

-- Danh mục cấp học: thêm Mầm non (đứng đầu)
insert into edu_levels (code, name, grade_from, grade_to, sort, updated_by)
values ('mamnon', 'Mầm non', -4, -1, 0, null)
on conflict (code) do nothing;
