-- 152: Dữ liệu test CT1 (16 chủ đề ở 151) là của Khối 6, không phải Khối 3.
-- Chuyển sang Khối 6 (thay 10 chủ đề mẫu "Chủ đề STEM n" của Khối 6), trả lại 10 chủ đề mẫu cho Khối 3.
do $$
declare ct1 uuid;
begin
  select id into ct1 from program_modules where track_code = 'CT1' order by sort limit 1;
  if ct1 is null then return; end if;
  if (select count(*) from program_topics where module_id = ct1 and grade = 3 and title not like 'Chủ đề STEM %') = 16 then
    delete from program_topics where module_id = ct1 and grade = 6;
    update program_topics set grade = 6 where module_id = ct1 and grade = 3;
    insert into program_topics (module_id, grade, seq, title, periods)
    select ct1, 3, n, 'Chủ đề STEM ' || n, 1 from generate_series(1, 10) n;
  end if;
end $$;
