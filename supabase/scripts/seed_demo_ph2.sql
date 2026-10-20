-- Dữ liệu mẫu đầy đủ cho Phân hệ 2 (Chương trình giáo dục, Học liệu & định mức, Phân phối chương trình,
-- Soạn bài giảng & kho hoạt động, Theo dõi CT1–CT5, E-learning & luyện thi,
-- bài giảng tương tác, thiết bị trong gói STEM) trên CSDL demo.
-- Dùng cho CSDL đã có dữ liệu mẫu cũ (THCS Phố Hiến, Sở GD&ĐT Hưng Yên, 21 trường) nhưng các migration 057–063 chạy qua CI
-- không bật cờ app.seed_demo nên chưa có dữ liệu mẫu của các phần này.
-- Cách dùng: Supabase → SQL Editor → dán toàn bộ tệp → Run. Chạy lại không tạo trùng: mỗi khối tự bỏ qua nếu dữ liệu đã có
-- (kể cả khi đã chạy tệp seed_demo_058_061.sql trước đó).
-- KHÔNG chạy trên CSDL production của khách hàng thật.
select set_config('app.seed_demo', 'on', false);

-- ######## 057 PPCT theo tiết của THCS Phố Hiến và mẫu PPCT của KDI ########
-- ===== 6. Dữ liệu mẫu =====
do $$
declare
  kdi uuid; sch uuid; v_book uuid; b record; c record; s record; i int; n int; v_start date; v_off int; v_topics uuid[];
  tin6 text[] := array[
    'Bài 1. Thông tin và dữ liệu', 'Bài 1. Thông tin và dữ liệu (tiếp)', 'Bài 2. Xử lí thông tin', 'Bài 2. Xử lí thông tin (tiếp)',
    'Bài 3. Thông tin trong máy tính', 'Bài 3. Thông tin trong máy tính (tiếp)', 'Bài 4. Mạng máy tính', 'Bài 4. Mạng máy tính (tiếp)',
    'Bài 5. Internet', 'Ôn tập giữa học kì I', 'Kiểm tra giữa học kì I', 'Bài 6. Mạng thông tin toàn cầu',
    'Bài 6. Mạng thông tin toàn cầu (tiếp)', 'Bài 7. Tìm kiếm thông tin trên Internet', 'Bài 7. Tìm kiếm thông tin trên Internet (tiếp)',
    'Bài 8. Thư điện tử', 'Ôn tập học kì I', 'Kiểm tra cuối học kì I', 'Bài 9. An toàn thông tin trên Internet',
    'Bài 9. An toàn thông tin trên Internet (tiếp)', 'Bài 10. Sơ đồ tư duy', 'Bài 11. Định dạng văn bản', 'Bài 11. Định dạng văn bản (tiếp)',
    'Bài 12. Trình bày thông tin ở dạng bảng', 'Ôn tập giữa học kì II', 'Kiểm tra giữa học kì II', 'Bài 13. Thực hành: Tìm kiếm và thay thế',
    'Bài 14. Thực hành tổng hợp: Hoàn thiện sổ lưu niệm', 'Bài 15. Thuật toán', 'Bài 15. Thuật toán (tiếp)', 'Bài 16. Các cấu trúc điều khiển',
    'Bài 17. Chương trình máy tính', 'Dự án STEM: Trò chơi tương tác với Scratch', 'Ôn tập học kì II', 'Kiểm tra cuối học kì II'];
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  select id into kdi from organizations where is_platform limit 1;
  select id into sch from organizations where code = 'THCS-PH';

  -- Mẫu PPCT của KDI cho Tin học 6 (tham khảo, trường chỉnh theo kế hoạch của tổ chuyên môn)
  if kdi is not null and not exists (select 1 from curriculum_books where org_id = kdi) then
    insert into curriculum_books (org_id, grade, subject, title, total_periods, year_name, periods_per_week, status, scope, note)
    values (kdi, 6, 'Tin học', 'Tin học 6 — mẫu KDI (Kết nối tri thức)', 35, null, 1, 'published', 'children',
            'PPCT tham khảo 35 tiết, 1 tiết/tuần. Trường sao chép rồi điều chỉnh theo kế hoạch giáo dục của tổ chuyên môn.')
    returning id into v_book;
    insert into curriculum_lessons (org_id, book_id, seq, week, title, kind)
    select kdi, v_book, k, k, t,
           case when t like 'Kiểm tra%' then 'test' when t like 'Ôn tập%' then 'review' when t like 'Dự án STEM%' then 'stem'
                when t like '%Thực hành%' then 'practice' else 'lesson' end
      from unnest(tin6) with ordinality as x(t, k);
  end if;

  if sch is null or exists (select 1 from curriculum_lessons where org_id = sch) then return; end if;
  select array_agg(id order by seq) into v_topics from package_topics where org_id = sch;
  update curriculum_books set year_name = (select name from academic_years where org_id = sch and is_current limit 1),
         periods_per_week = round(coalesce(total_periods, 35) / 35.0, 1)
   where org_id = sch;
  for b in select * from curriculum_books where org_id = sch loop
    n := coalesce(b.total_periods, 35);
    insert into curriculum_lessons (org_id, book_id, seq, week, title, kind, package_topic_id)
    select sch, b.id, k, ceil(k / b.periods_per_week)::int,
      case
        when k = (n * 9 / 35) then 'Kiểm tra giữa học kì I'
        when k = (n * 9 / 35) - 1 then 'Ôn tập giữa học kì I'
        when k = (n * 18 / 35) then 'Kiểm tra cuối học kì I'
        when k = (n * 18 / 35) - 1 then 'Ôn tập học kì I'
        when k = (n * 27 / 35) then 'Kiểm tra giữa học kì II'
        when k = n then 'Kiểm tra cuối học kì II'
        when k = n - 1 then 'Ôn tập học kì II'
        when b.subject in ('Công nghệ', 'Khoa học tự nhiên') and k % 12 = 6 then 'Chủ đề STEM: dự án thực hành'
        else b.subject || ' ' || b.grade || ' — Bài ' || ((k + 1) / 2) || (case when k % 2 = 0 then ' (tiếp)' else '' end)
      end,
      case
        when k in (n * 9 / 35, n * 18 / 35, n * 27 / 35, n) then 'test'
        when k in (n * 9 / 35 - 1, n * 18 / 35 - 1, n - 1) then 'review'
        when b.subject in ('Công nghệ', 'Khoa học tự nhiên') and k % 12 = 6 then 'stem'
        else 'lesson'
      end,
      case when b.subject in ('Công nghệ', 'Khoa học tự nhiên') and k % 12 = 6 and v_topics is not null
            and k not in (n * 9 / 35, n * 9 / 35 - 1, n * 18 / 35, n * 18 / 35 - 1, n * 27 / 35, n, n - 1)
           then v_topics[1 + (k / 12 + b.grade) % array_length(v_topics, 1)] end
    from generate_series(1, n) k;
    -- Tin học 6: dùng nội dung theo mẫu KDI
    if b.grade = 6 and b.subject = 'Tin học' then
      update curriculum_lessons l set title = x.t,
             kind = case when x.t like 'Kiểm tra%' then 'test' when x.t like 'Ôn tập%' then 'review' when x.t like 'Dự án STEM%' then 'stem'
                         when x.t like '%Thực hành%' then 'practice' else 'lesson' end
        from unnest(tin6) with ordinality as x(t, k) where l.book_id = b.id and l.seq = x.k;
      update curriculum_books set source_id = v_book where id = b.id and v_book is not null;
    end if;
  end loop;

  -- Gắn tiết PPCT cho các tiết đã dạy trong dữ liệu mẫu: bắt đầu từ đúng tiến độ, một vài lớp chậm 2–4 tiết
  select min(starts_on) into v_start from academic_years where org_id = sch
    and name = (select name from academic_years where org_id = sch and is_current limit 1);
  for c in select distinct ts.class_id, ts.subject, public.session_book(sch, ts.class_id, ts.subject) as book, cl.name, bk.periods_per_week
             from teaching_sessions ts join classes cl on cl.id = ts.class_id
             left join curriculum_books bk on bk.id = public.session_book(sch, ts.class_id, ts.subject)
            where ts.org_id = sch and ts.status = 'taught' loop
    continue when c.book is null;
    -- Tiết cuối đã dạy ≈ kế hoạch đến tuần này: bắt đầu từ (kế hoạch − số tiết đã dạy)
    select floor(greatest(1, least(52, (public.vn_today() - coalesce(v_start, public.vn_today())) / 7 + 1)) * c.periods_per_week)::int - count(*)
      into v_off from teaching_sessions where class_id = c.class_id and subject = c.subject and status = 'taught';
    v_off := greatest(0, v_off - (abs(hashtext(c.name || c.subject)) % 5));
    i := 0;
    for s in select id from teaching_sessions where class_id = c.class_id and subject = c.subject and status = 'taught'
              order by session_date, (select p.starts_at from period_configs p where p.id = period_id) loop
      i := i + 1;
      update teaching_sessions set curriculum_lesson_id = (select id from curriculum_lessons where book_id = c.book and seq = v_off + i)
       where id = s.id;
    end loop;
  end loop;
end $$;

-- ######## 058 chương trình giáo dục, gán trường, theo dõi CT1–CT5 ########
-- ===== 7. Dữ liệu mẫu =====
do $$
declare
  kdi uuid; so uuid; sch uuid; v1 uuid; v2 uuid; v_stem uuid; v_so_prog uuid; t uuid; l uuid; b record; c record; k int;
  topics jsonb := '[
    {"t":"Chủ đề A. Máy tính và cộng đồng","o":["Nhận biết được sự khác nhau giữa thông tin và dữ liệu","Nêu được ví dụ minh hoạ tầm quan trọng của thông tin"],
     "l":[["Bài 1. Thông tin và dữ liệu",2],["Bài 2. Xử lí thông tin",2],["Bài 3. Thông tin trong máy tính",2]]},
    {"t":"Chủ đề B. Mạng máy tính và Internet","o":["Nêu được khái niệm và lợi ích của mạng máy tính","Nêu được các đặc điểm và lợi ích chính của Internet"],
     "l":[["Bài 4. Mạng máy tính",2],["Bài 5. Internet",1]]},
    {"t":"Chủ đề C. Tổ chức lưu trữ, tìm kiếm và trao đổi thông tin","o":["Sử dụng được máy tìm kiếm để tìm thông tin theo từ khoá","Biết sử dụng thư điện tử để trao đổi thông tin"],
     "l":[["Bài 6. Mạng thông tin toàn cầu",2],["Bài 7. Tìm kiếm thông tin trên Internet",2],["Bài 8. Thư điện tử",1]]},
    {"t":"Chủ đề D. Đạo đức, pháp luật và văn hoá trong môi trường số","o":["Biết cách bảo vệ thông tin cá nhân và an toàn khi sử dụng Internet"],
     "l":[["Bài 9. An toàn thông tin trên Internet",2]]},
    {"t":"Chủ đề E. Ứng dụng tin học","o":["Tạo được sơ đồ tư duy đơn giản","Định dạng được văn bản, trình bày thông tin ở dạng bảng"],
     "l":[["Bài 10. Sơ đồ tư duy",1],["Bài 11. Định dạng văn bản",2],["Bài 12. Trình bày thông tin ở dạng bảng",1],["Bài 13. Thực hành: Tìm kiếm và thay thế",1],["Bài 14. Thực hành tổng hợp: Hoàn thiện sổ lưu niệm",1]]},
    {"t":"Chủ đề F. Giải quyết vấn đề với sự trợ giúp của máy tính","o":["Mô tả được thuật toán đơn giản có các cấu trúc tuần tự, rẽ nhánh, lặp","Tạo được sản phẩm số tương tác bằng Scratch"],
     "l":[["Bài 15. Thuật toán",2],["Bài 16. Các cấu trúc điều khiển",1],["Bài 17. Chương trình máy tính",1],["Dự án STEM: Trò chơi tương tác với Scratch",1]]}
  ]';
  x jsonb; y jsonb; i int; j int;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if; -- dữ liệu mẫu: chỉ chạy khi bật cờ app.seed_demo
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  select id into sch from organizations where code = 'THCS-PH';
  if kdi is null or exists (select 1 from edu_programs where org_id = kdi) then return; end if;

  -- KDI: Tin học THCS (CTGDPT 2018) — phiên bản 1 (đã bị thay thế) và phiên bản 2 đang ban hành, dùng chung cho mọi trường
  insert into edu_programs (org_id, code, title, kind, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope, note)
  values (kdi, 'TIN-THCS-2018', 'Tin học THCS (CT GDPT 2018)', 'subject', 'thcs', 6, 9, 'Tin học', '{Toán}',
          'Hình thành và phát triển năng lực tin học: sử dụng và quản lí phương tiện CNTT; ứng xử phù hợp trong môi trường số; giải quyết vấn đề với sự hỗ trợ của CNTT; ứng dụng CNTT trong học và tự học; hợp tác trong môi trường số.',
          '{tin_hoc,gqvd,tu_chu}', 'children', 'Khung chương trình tham khảo của KDI theo CT GDPT 2018 (Kết nối tri thức).')
  returning id into v1;
  i := 0;
  for x in select * from jsonb_array_elements(topics) loop
    i := i + 1;
    insert into edu_program_units (program_id, unit_type, seq, grade, title) values (v1, 'topic', i, 6, x->>'t') returning id into t;
    j := 0;
    for y in select * from jsonb_array_elements(x->'l') loop
      j := j + 1;
      insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values (v1, t, 'lesson', j, y->>0, (y->>1)::int);
    end loop;
    j := 0;
    for y in select * from jsonb_array_elements(x->'o') loop
      j := j + 1;
      insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key)
      values (v1, t, j, 'YC' || i || '.' || j, y #>> '{}', case when i = 6 then 'gqvd' else 'tin_hoc' end);
    end loop;
  end loop;
  update edu_programs set status = 'published', published_at = now() - interval '400 days', effective_from = public.vn_today() - 400 where id = v1;
  v2 := public.edu_program_clone(v1, kdi, (select family_id from edu_programs where id = v1), 2);
  update edu_programs set note = 'Phiên bản 2: bổ sung yêu cầu cần đạt về dự án STEM; chỉnh số tiết chủ đề F.' where id = v2;
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key)
  select v2, u.id, 3, 'YC6.3', 'Trình bày và chia sẻ được sản phẩm số với bạn bè', 'giao_tiep'
    from edu_program_units u where u.program_id = v2 and u.title like 'Chủ đề F%';
  update edu_programs set status = 'published', published_at = now() - interval '30 days', effective_from = public.vn_today() - 30 where id = v2;
  update edu_programs set status = 'superseded', replaced_by = v2, effective_to = public.vn_today() - 30 where id = v1;

  -- KDI: chương trình STEM CT2 (tích hợp Công nghệ, Tin học, Toán)
  insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
  values (kdi, 'STEM-CT2', 'STEM CT2 — Robot và lập trình', 'stem', 'CT2', 'thcs', 6, 9, 'Công nghệ', '{Tin học,Toán,Khoa học tự nhiên}',
          'Học sinh thiết kế, lắp ráp và lập trình robot giải quyết vấn đề thực tiễn; phát triển tư duy kĩ thuật và hợp tác.',
          '{cong_nghe,tin_hoc,gqvd,giao_tiep}', 'children')
  returning id into v_stem;
  insert into edu_program_units (program_id, unit_type, seq, grade, subject, title, periods) values (v_stem, 'topic', 1, 8, 'Công nghệ', 'Chủ đề 1. Robot dò line', 0) returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values (v_stem, t, 'lesson', 1, 'Cảm biến hồng ngoại và nguyên lí dò line', 0) returning id into l;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values
    (v_stem, l, 'session', 1, 'Buổi 1: Tìm hiểu cảm biến', 1), (v_stem, l, 'session', 2, 'Buổi 2: Lắp ráp robot', 2), (v_stem, l, 'session', 3, 'Buổi 3: Lập trình và thi đấu', 2);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_stem, t, 1, 'R1', 'Giải thích được nguyên lí hoạt động của cảm biến hồng ngoại', 'khoa_hoc'),
    (v_stem, t, 2, 'R2', 'Lắp ráp và lập trình được robot đi theo vạch', 'cong_nghe');
  insert into edu_program_units (program_id, unit_type, seq, grade, subject, title, periods) values (v_stem, 'topic', 2, 9, 'Tin học', 'Chủ đề 2. Nhà thông minh IoT', 4) returning id into t;
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_stem, t, 1, 'I1', 'Kết nối cảm biến và điều khiển thiết bị qua mạng', 'tin_hoc');
  update edu_programs set status = 'published', published_at = now() - interval '60 days', effective_from = public.vn_today() - 60 where id = v_stem;

  -- Sở Hưng Yên: gán Tin học THCS và STEM CT2 cho trường THCS Phố Hiến; chương trình STEM riêng của Sở đang soạn (nháp)
  if so is not null then
    if sch is not null then
      insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org) values
        (v2, sch, '{6,7,8,9}', 'Áp dụng năm học hiện tại', so), (v_stem, sch, '{8,9}', 'Thí điểm STEM CT2 khối 8, 9', so);
    end if;
    insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
    values (so, 'HY-STEM-NN', 'Giáo dục STEM nông nghiệp thông minh', 'stem', 'CT3', 'thcs', 7, 8, 'Công nghệ', '{Khoa học tự nhiên,Tin học}',
            'Vận dụng kiến thức liên môn để thiết kế mô hình tưới cây tự động phù hợp địa phương.', '{khoa_hoc,cong_nghe}', 'children')
    returning id into v_so_prog;
    insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) values (v_so_prog, 'topic', 1, 7, 'Chủ đề 1. Đất trồng và nhu cầu nước của cây', 2) returning id into t;
    insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values (v_so_prog, t, 1, 'N1', 'Đo và đánh giá được độ ẩm đất', 'khoa_hoc');
    insert into edu_program_units (program_id, unit_type, seq, grade, title, periods) values (v_so_prog, 'topic', 2, 8, 'Chủ đề 2. Hệ thống tưới tự động', 3);
  end if;

  if sch is null then return; end if;
  -- Trường: PPCT Tin học 6 (sao từ mẫu KDI) gắn với chương trình Tin học THCS phiên bản 2; liên kết từng tiết với bài
  perform set_config('app.ppct_import', 'on', true);
  for b in select * from curriculum_books where org_id = sch and grade = 6 and subject = 'Tin học' loop
    update curriculum_books set program_id = v2 where id = b.id;
    update curriculum_lessons cl set unit_id = u.id
      from edu_program_units u
     where cl.book_id = b.id and u.program_id = v2 and u.unit_type = 'lesson'
       and regexp_replace(cl.title, ' \(tiếp\)$', '') = u.title;
  end loop;
  -- PPCT Công nghệ khối 8: theo chương trình STEM CT2 (tiết chủ đề STEM gắn với các buổi)
  for b in select * from curriculum_books where org_id = sch and grade = 8 and subject = 'Công nghệ' loop
    update curriculum_books set program_id = v_stem where id = b.id;
    k := 0;
    for l in select u.id from edu_program_units u where u.program_id = v_stem and u.unit_type = 'session' order by u.seq loop
      k := k + 1;
      update curriculum_lessons set unit_id = l where id = (select id from curriculum_lessons where book_id = b.id and kind = 'stem' order by seq offset k - 1 limit 1);
    end loop;
  end loop;
  -- Hai lớp bỏ qua một tiết (để có "nội dung chưa hoàn thành"); một số tiết STEM đã dạy có minh chứng
  for c in select distinct on (ts.class_id) ts.class_id, ts.curriculum_lesson_id, l.book_id, l.seq
             from teaching_sessions ts join curriculum_lessons l on l.id = ts.curriculum_lesson_id
            where ts.org_id = sch and ts.status = 'taught'
            order by ts.class_id, l.seq desc limit 2 loop
    update teaching_sessions ts set curriculum_lesson_id = (select id from curriculum_lessons where book_id = c.book_id and seq = l2.seq + 1)
      from curriculum_lessons l2
     where l2.id = ts.curriculum_lesson_id and ts.class_id = c.class_id and l2.book_id = c.book_id and l2.seq >= c.seq - 1
       and exists (select 1 from curriculum_lessons where book_id = c.book_id and seq = l2.seq + 1);
  end loop;
  insert into curriculum_evidence (class_id, lesson_id, session_id, kind, url, note)
  select ts.class_id, ts.curriculum_lesson_id, ts.id, 'link', 'https://drive.google.com/drive/folders/minh-chung-stem',
         'Ảnh sản phẩm nhóm và phiếu đánh giá'
    from teaching_sessions ts join curriculum_lessons l on l.id = ts.curriculum_lesson_id
   where ts.org_id = sch and ts.status = 'taught' and l.kind in ('stem', 'practice')
     and abs(hashtext(ts.id::text)) % 2 = 0;
  perform set_config('app.ppct_import', 'off', true);
end $$;

-- ######## 059 học liệu theo chương trình, danh mục vật tư, định mức ########
-- ===== 6. Dữ liệu mẫu =====
do $$
declare
  kdi uuid; so uuid; sch uuid; v_tin uuid; v_stem uuid; u uuid; n uuid; it uuid;
  c_kit uuid; c_pin uuid; c_bang uuid; c_day uuid; c_keo uuid; c_sensor uuid; c_bom uuid; c_ong uuid; c_dat uuid; c_kim uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  select id into sch from organizations where code = 'THCS-PH';
  if kdi is null or exists (select 1 from material_catalog where org_id = kdi) then return; end if;

  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'KIT-ROBOT', 'Bộ kit robot dò line KDI', 'equipment', 'bộ', 'Khung nhôm, 2 động cơ DC, cảm biến hồng ngoại 2 mắt, mạch điều khiển', 1250000, true) returning id into c_kit;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'PIN-AA', 'Pin AA', 'supply', 'viên', '1,5 V', 6000, false) returning id into c_pin;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'BANG-DEN', 'Băng dính đen kẻ sa bàn', 'supply', 'cuộn', 'Rộng 18 mm', 12000, false) returning id into c_bang;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'DAY-DIEN', 'Dây điện đơn 0,5 mm', 'supply', 'm', null, 3000, false) returning id into c_day;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'KEO-NEN', 'Keo nến', 'supply', 'thanh', 'Phi 11 mm', 2500, false) returning id into c_keo;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'CB-DOAM', 'Cảm biến độ ẩm đất', 'tool', 'cái', 'Đầu ra analog, 3,3–5 V', 35000, true) returning id into c_sensor;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'BOM-MINI', 'Máy bơm mini 5 V', 'tool', 'cái', null, 45000, true) returning id into c_bom;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'ONG-NUOC', 'Ống dẫn nước silicon', 'supply', 'm', 'Phi 6 mm', 8000, false) returning id into c_ong;
  insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
    (kdi, 'SUNG-KEO', 'Súng bắn keo', 'tool', 'cái', '20 W', 65000, true) returning id into c_kim;
  if so is not null then
    insert into material_catalog (org_id, code, name, kind, unit, spec, unit_price, reusable) values
      (so, 'HY-DAT', 'Đất trồng hữu cơ', 'supply', 'kg', 'Bao 5 kg', 15000, false) returning id into c_dat;
  end if;
  -- Vật tư trong kho của trường ứng với danh mục
  if sch is not null then
    update supplies set catalog_id = c_pin where org_id = sch and sku = 'PIN-AA';
    update supplies set catalog_id = c_day where org_id = sch and sku = 'DAY-DIEN';
    update supplies set catalog_id = c_keo where org_id = sch and sku = 'KEO-NEN';
  end if;

  select id into v_stem from edu_programs where org_id = kdi and title like 'STEM CT2%' and status = 'published' limit 1;
  select id into v_tin from edu_programs where org_id = kdi and title like 'Tin học THCS%' and status = 'published' limit 1;

  -- Định mức KDI: robot dò line (theo nhóm 4 HS, 3 buổi), có 2 phiên bản
  select id into u from edu_program_units where program_id = v_stem and unit_type = 'lesson' order by seq limit 1;
  insert into material_norms (org_id, title, basis, group_size, sessions, program_id, unit_id, subject, grade, scope, note)
    values (kdi, 'Robot dò line — lắp ráp và thi đấu', 'group', 4, 3, v_stem, u, 'Công nghệ', 8, 'children', 'Định mức chuẩn KDI cho 1 nhóm 4 học sinh')
    returning id into n;
  insert into material_norm_items (norm_id, seq, catalog_id, name, qty, note) values
    (n, 1, c_kit, 'x', 1, null), (n, 2, c_pin, 'x', 4, 'Thay sau mỗi buổi'), (n, 3, c_bang, 'x', 1, 'Kẻ sa bàn chung'), (n, 4, c_keo, 'x', 2, null);
  perform set_config('app.norm_status', 'on', true);
  update material_norms set status = 'published', published_at = now() - interval '40 days' where id = n;
  perform set_config('app.norm_status', '', true);
  it := public.material_norm_clone(n, kdi, (select family_id from material_norms where id = n), 2);
  update material_norm_items set qty = 6 where norm_id = it and catalog_id = c_pin;
  insert into material_norm_items (norm_id, seq, catalog_id, name, qty) values (it, 5, c_kim, 'x', 1);
  perform set_config('app.norm_status', 'on', true);
  update material_norms set status = 'superseded', replaced_by = it where id = n;
  update material_norms set status = 'published', published_at = now() - interval '10 days', note = 'Bổ sung pin cho 3 buổi và súng bắn keo' where id = it;
  perform set_config('app.norm_status', '', true);
  n := it;

  -- Định mức Sở HY: hệ thống tưới cây tự động (theo sản phẩm), gắn bài giảng trong kho
  if so is not null then
    insert into material_norms (org_id, title, basis, group_size, sessions, library_item_id, subject, grade, scope)
      values (so, 'Hệ thống tưới cây tự động', 'product', 4, 2,
              (select id from library_items where owner_org_id = so and title = 'Hệ thống tưới cây tự động' limit 1), 'Công nghệ', 7, 'children')
      returning id into it;
    insert into material_norm_items (norm_id, seq, catalog_id, name, qty) values
      (it, 1, c_sensor, 'x', 1), (it, 2, c_bom, 'x', 1), (it, 3, c_ong, 'x', 1.5), (it, 4, c_day, 'x', 2), (it, 5, c_dat, 'x', 2);
    perform set_config('app.norm_status', 'on', true);
    update material_norms set status = 'published', published_at = now() - interval '15 days' where id = it;
    perform set_config('app.norm_status', '', true);
  end if;

  -- Trường đề xuất tăng pin cho robot
  if sch is not null then
    insert into material_norm_proposals (norm_id, org_id, reason, items)
      values (n, sch, 'Robot chạy 3 buổi liên tục, 6 viên pin/nhóm không đủ khi thi đấu',
              jsonb_build_array(jsonb_build_object('catalog_id', c_pin, 'name', 'Pin AA', 'unit', 'viên', 'qty', 8, 'note', 'Thêm 2 viên dự phòng')));
  end if;

  -- Học liệu theo chương trình: phiếu học tập, giáo án, video gắn bài của chương trình Tin học
  if v_tin is not null then
    select id into u from edu_program_units where program_id = v_tin and unit_type = 'lesson' order by seq limit 1;
    insert into library_items (owner_org_id, kind, title, summary, subject, grades, program_id, unit_id, content, scope, status, version, published_at, usage_rights)
    values (kdi, 'material', 'Phiếu học tập: Thông tin và dữ liệu', 'Phiếu nhóm phân loại ví dụ thông tin / dữ liệu, 10 phút.',
            'Tin học', '6', v_tin, u, jsonb_build_object('type', 'worksheet', 'url', 'https://kdi.edu.vn/hoc-lieu/phieu-thong-tin-du-lieu'),
            'public', 'published', 1, now() - interval '8 days', 'adapt'),
           (kdi, 'material', 'Giáo án mẫu: Thông tin và dữ liệu', 'Giáo án 2 tiết theo Công văn 5512, kèm phiếu học tập.',
            'Tin học', '6', v_tin, u, jsonb_build_object('type', 'lesson_plan', 'url', 'https://kdi.edu.vn/hoc-lieu/giao-an-bai-1'),
            'public', 'published', 2, now() - interval '2 days', 'adapt'),
           (kdi, 'material', 'Video: Máy tính xử lí thông tin như thế nào?', 'Video 4 phút dùng ở phần khởi động.',
            'Tin học', '6', v_tin, u, jsonb_build_object('type', 'video', 'url', 'https://www.youtube.com/watch?v=Z5JC9Ve1sfI'),
            'public', 'published', 1, now() - interval '8 days', 'view');
    insert into library_item_versions (item_id, version, title, summary, content, usage_rights, change_note, published_by, published_at)
    select i.id, g, i.title, i.summary, i.content, i.usage_rights, case when g = 2 then 'Bổ sung phần vận dụng' end, null, i.published_at - (i.version - g) * interval '20 days'
      from library_items i cross join generate_series(1, 2) g where i.owner_org_id = kdi and i.unit_id = u and g <= i.version;
  end if;
end $$;

-- ######## 060 giáo án theo mẫu, quy trình duyệt giáo án ########
-- ===== 6. Dữ liệu mẫu: giáo án theo mẫu 5E gắn chương trình, học liệu, định mức; một giáo án chờ duyệt =====
do $$
declare sch uuid; kdi uuid; tch uuid; tpl uuid; tpl2 uuid; v_stem uuid; u uuid; n uuid; lp uuid; act uuid; rub uuid; c uuid; wf uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into sch from organizations where code = 'THCS-PH';
  select id into kdi from organizations where is_platform limit 1;
  if sch is null or kdi is null or exists (select 1 from lesson_plans where org_id = sch and template_id is not null) then return; end if;
  select t.id into tch from teachers t where t.org_id = sch and t.profile_id is not null order by t.full_name limit 1;
  if tch is null then select t.id into tch from teachers t where t.org_id = sch order by t.full_name limit 1; end if;
  select id into tpl from lesson_templates where org_id = kdi and name like 'Bài học STEM%';
  select id into tpl2 from lesson_templates where org_id = kdi and name like 'Kế hoạch bài dạy%';
  select id into v_stem from edu_programs where org_id = kdi and title like 'STEM CT2%' and status = 'published' limit 1;
  select id into u from edu_program_units where program_id = v_stem and unit_type = 'lesson' order by seq limit 1;
  select id into n from material_norms where org_id = kdi and title like 'Robot dò line%' and status = 'published' limit 1;
  select id into act from activities where org_id = sch and kind = 'quiz' order by created_at limit 1;
  select id into rub from rubrics where org_id is null order by title limit 1;
  select id into c from classes where org_id = sch and name like '%8A%' limit 1;

  insert into lesson_plans (org_id, teacher_id, title, subject, grades, program, status, summary, template_id, program_id, unit_id, norm_id, periods,
                            doc, steps, rubric_ids, slides, version_no, published_at, library_ids)
  values (sch, tch, 'Robot dò line — cảm biến hồng ngoại', 'Công nghệ', '8', 'CT2', 'published',
          'Học sinh tìm hiểu cảm biến hồng ngoại, lắp robot và lập trình đi theo vạch.', tpl, v_stem, u, n, 2,
          jsonb_build_object('muc_tieu', 'Giải thích được nguyên lí cảm biến hồng ngoại; lắp ráp và lập trình được robot đi theo vạch.',
                             'van_de', 'Xe tự hành trong nhà máy đi theo vạch kẻ trên sàn như thế nào?',
                             'thiet_bi', 'Mỗi nhóm 1 bộ kit robot, 6 pin AA, sa bàn kẻ vạch đen.',
                             'an_toan', 'Không chạm tay vào bánh xe khi robot đang chạy; tháo pin khi lắp mạch.'),
          jsonb_build_array(
            jsonb_build_object('id', 's1', 'phase', 'engage', 'title', 'Xem video xe tự hành trong nhà máy', 'minutes', 5,
                               'teacher', 'Chiếu video, đặt câu hỏi: xe "nhìn" vạch bằng gì?', 'student', 'Quan sát, nêu dự đoán.'),
            jsonb_build_object('id', 's2', 'phase', 'explore', 'title', 'Thí nghiệm cảm biến với nền đen / trắng', 'minutes', 15,
                               'teacher', 'Phát cảm biến, hướng dẫn đo.', 'student', 'Đo giá trị cảm biến trên 2 nền, ghi phiếu.', 'product', 'Bảng số liệu'),
            jsonb_build_object('id', 's3', 'phase', 'explain', 'title', 'Câu hỏi nhanh: nguyên lí phản xạ', 'minutes', 5, 'activity_id', act),
            jsonb_build_object('id', 's4', 'phase', 'elaborate', 'title', 'Lắp robot và lập trình dò line', 'minutes', 50,
                               'teacher', 'Hỗ trợ nhóm, kiểm tra an toàn.', 'student', 'Lắp ráp, nạp chương trình, chạy thử.', 'product', 'Robot chạy hết sa bàn'),
            jsonb_build_object('id', 's5', 'phase', 'evaluate', 'title', 'Thi chạy robot, đánh giá theo rubric', 'minutes', 15, 'rubric_id', rub)),
          case when rub is null then '{}'::uuid[] else array[rub] end,
          jsonb_build_array(jsonb_build_object('id', 'p1', 'kind', 'title', 'title', 'Robot dò line', 'body', 'Chủ đề STEM — Công nghệ 8')),
          1, now() - interval '6 days',
          coalesce((select array_agg(id) from library_items where title = 'Robot dò line: cảm biến hồng ngoại'), '{}'))
  returning id into lp;
  insert into lesson_plan_versions (plan_id, version_no, snapshot, note, published_by, published_at)
    select lp, 1, public.lesson_plan_content(p), 'Bản đầu', null, now() - interval '6 days' from lesson_plans p where p.id = lp;
  if c is not null then
    insert into lesson_plan_reviews (plan_id, org_id, kind, class_id, taught_on, rating, note)
      values (lp, sch, 'trial', c, public.vn_today() - 5, 4, 'Lớp 8A làm tốt; phần lắp robot cần thêm 10 phút, pin hết sau 2 buổi.');
  end if;

  -- Giáo án theo mẫu 5512 đang chờ duyệt (một giáo viên khác)
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, status, summary, template_id, periods, doc, steps)
  values (sch, tch, 'Thông tin và dữ liệu', 'Tin học', '6', 'draft', 'Bài 1 — Chủ đề A, Tin học 6.', tpl2, 2,
          jsonb_build_object('muc_tieu_kien_thuc', 'Phân biệt được thông tin và dữ liệu.', 'muc_tieu_nang_luc', 'Nêu được ví dụ về thông tin, dữ liệu.',
                             'muc_tieu_pham_chat', 'Trung thực, có trách nhiệm khi chia sẻ thông tin.', 'thiet_bi', 'Máy chiếu, phiếu học tập.'),
          jsonb_build_array(
            jsonb_build_object('id', 'a1', 'phase', 'mo_dau', 'title', 'Trò chơi "Ai nhanh hơn"', 'minutes', 5),
            jsonb_build_object('id', 'a2', 'phase', 'hinh_thanh', 'title', 'Thông tin và dữ liệu', 'minutes', 20),
            jsonb_build_object('id', 'a3', 'phase', 'luyen_tap', 'title', 'Phiếu học tập nhóm', 'minutes', 10),
            jsonb_build_object('id', 'a4', 'phase', 'van_dung', 'title', 'Tìm ví dụ ở gia đình', 'minutes', 5)))
  returning id into lp;
  -- Trường mẫu bật duyệt giáo án: Tổ trưởng/Hiệu trưởng duyệt (một bước, người có quyền duyệt thư viện)
  if not exists (select 1 from approval_workflows where org_id = sch and kind = 'lesson_plan') then
    insert into approval_workflows (org_id, kind, name, applies_to_children, updated_by)
      values (sch, 'lesson_plan', 'Duyệt giáo án trước khi xuất bản', false, null) returning id into wf;
    insert into approval_steps (workflow_id, step_no, name, approver, role_id, org_type)
      values (wf, 1, 'Hiệu trưởng duyệt giáo án', 'role', (select id from roles where key = 'principal' and org_id is null), null);
  end if;
  update lesson_plans set status = 'pending' where id = lp;
end $$;

-- ######## 061 e-learning: ngân hàng câu hỏi, đề luyện, khoá học theo nhóm ########
-- ===== 4. Dữ liệu mẫu: ngân hàng câu Tin học 6, đề luyện giao lớp 6A, khoá ôn tập giao Nhóm 1 lớp 9A, lượt làm bài =====
do $$
declare sch uuid; c6 uuid; c9 uuid; g1 uuid; ex uuid; co uuid; qs uuid[]; st record; i int := 0; ans jsonb; ok int; q record; l1 uuid; l2 uuid;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from question_bank where org_id = sch and subject = 'Tin học' and grade = 6) then return; end if;
  select id into c6 from classes where org_id = sch and name like '%6A%' limit 1;
  select id into c9 from classes where org_id = sch and name like '%9A%' limit 1;
  select id into g1 from student_groups where class_id = c9 order by name limit 1;
  insert into question_bank (org_id, subject, grade, topic, level, kind, stem, options, answer, explain, status) values
    (sch, 'Tin học', 6, 'Thông tin và dữ liệu', 'nhan_biet', 'single', 'Dữ liệu được máy tính xử lí là gì?', '["Thông tin đã được mã hoá","Âm thanh","Hình ảnh trên giấy","Lời nói"]', '[0]', 'Máy tính xử lí dữ liệu là thông tin đã được mã hoá thành dãy bit.', 'ready'),
    (sch, 'Tin học', 6, 'Thông tin và dữ liệu', 'thong_hieu', 'single', 'Đơn vị nhỏ nhất dùng để đo dung lượng thông tin là?', '["Byte","Bit","KB","MB"]', '[1]', null, 'ready'),
    (sch, 'Tin học', 6, 'Thông tin và dữ liệu', 'van_dung', 'single', '1 KB bằng bao nhiêu byte?', '["1000","1024","100","2048"]', '[1]', '1 KB = 2^10 = 1024 byte.', 'ready'),
    (sch, 'Tin học', 6, 'Mạng máy tính và Internet', 'nhan_biet', 'single', 'Thiết bị nào dùng để kết nối các máy tính trong mạng?', '["Bộ chuyển mạch (switch)","Máy in","Loa","Bàn phím"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 6, 'Mạng máy tính và Internet', 'thong_hieu', 'truefalse', 'Internet là mạng kết nối các mạng máy tính trên khắp thế giới.', '["Đúng","Sai"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 6, 'Mạng máy tính và Internet', 'van_dung', 'multi', 'Những việc nào giúp sử dụng Internet an toàn?', '["Không chia sẻ mật khẩu","Mở mọi tệp đính kèm lạ","Dùng mật khẩu mạnh","Kết bạn với người lạ"]', '[0,2]', null, 'ready'),
    (sch, 'Tin học', 6, 'Thuật toán', 'thong_hieu', 'single', 'Cấu trúc "Nếu … thì …" là cấu trúc gì?', '["Tuần tự","Rẽ nhánh","Lặp","Hàm"]', '[1]', null, 'ready'),
    (sch, 'Tin học', 6, 'Thuật toán', 'van_dung', 'single', 'Lặp 5 lần "tiến 10 bước" thì nhân vật đi được bao nhiêu bước?', '["10","15","50","5"]', '[2]', null, 'ready');
  select array_agg(id order by created_at, stem) into qs from question_bank where org_id = sch and subject = 'Tin học' and grade = 6;
  insert into practice_exams (org_id, title, description, subject, grade, mode, question_ids, duration_min, max_attempts, class_ids, group_ids, opens_at, closes_at, status)
    values (sch, 'Luyện tập Tin học 6 — Chủ đề A, B, F', 'Đề cố định 8 câu, làm tối đa 2 lần.', 'Tin học', 6, 'fixed', qs, 15, 2,
            case when c6 is null then null else array[c6] end, null, now() - interval '14 days', now() + interval '14 days', 'published')
    returning id into ex;
  -- Lượt làm của học sinh lớp 6A: câu "1 KB" và câu chọn nhiều đáp án là câu khó
  for st in select id from students where class_id = c6 order by full_name loop
    i := i + 1;
    ans := '{}'::jsonb; ok := 0;
    for q in select b.id, b.answer, b.stem, b.kind from question_bank b where b.id = any(qs) loop
      if q.stem like '1 KB%' then
        ans := ans || jsonb_build_object(q.id::text, case when i % 4 = 0 then q.answer else '[0]'::jsonb end);
      elsif q.kind = 'multi' then
        ans := ans || jsonb_build_object(q.id::text, case when i % 3 = 0 then q.answer else '[0]'::jsonb end);
      elsif q.stem like 'Lặp 5 lần%' then
        ans := ans || jsonb_build_object(q.id::text, case when i % 2 = 0 then q.answer else '[0]'::jsonb end);
      else
        ans := ans || jsonb_build_object(q.id::text, case when i = 3 and q.stem like 'Đơn vị%' then '[0]'::jsonb else q.answer end);
      end if;
      if public.answer_is_correct(ans -> q.id::text, q.answer) then ok := ok + 1; end if;
    end loop;
    insert into exam_attempts (exam_id, student_id, org_id, questions, answers, started_at, submitted_at, deadline, status, correct, total, score)
      values (ex, st.id, sch, qs, ans, now() - make_interval(days => 10 - i, mins => 20), now() - make_interval(days => 10 - i, mins => 8),
              now() - make_interval(days => 10 - i, mins => 5), 'submitted', ok, cardinality(qs), round(10.0 * ok / cardinality(qs), 1));
  end loop;
  -- Khoá ôn tập giao cho Nhóm 1 lớp 9A
  if g1 is not null then
    insert into courses (org_id, title, description, subject, grade, group_ids, due_at, status)
      values (sch, 'Ôn tập lập trình Scratch — nhóm bồi dưỡng', 'Khoá tự học cho nhóm học sinh chuẩn bị thi STEM cấp trường.', 'Tin học', 9,
              array[g1], now() + interval '10 days', 'published')
      returning id into co;
    insert into course_lessons (course_id, position, title, kind, url, duration_min) values
      (co, 1, 'Video: biến và vòng lặp trong Scratch', 'video', 'https://www.youtube.com/watch?v=jXUZaf5D12A', 12) returning id into l1;
    insert into course_lessons (course_id, position, title, kind, body, duration_min) values
      (co, 2, 'Đọc: thuật toán sắp xếp đơn giản', 'reading', 'Sắp xếp nổi bọt: so sánh hai phần tử kề nhau và đổi chỗ nếu sai thứ tự; lặp lại đến khi không còn đổi chỗ.', 15) returning id into l2;
    insert into course_lessons (course_id, position, title, kind, exam_id) values (co, 3, 'Bài luyện tập cuối khoá', 'exam', ex);
    insert into course_progress (lesson_id, student_id, done_at)
      select l1, m.student_id, now() - interval '2 days' from student_group_members m where m.group_id = g1;
    insert into course_progress (lesson_id, student_id, done_at)
      select l2, m.student_id, now() - interval '1 day' from student_group_members m where m.group_id = g1 limit 1;
  end if;
end $$;

-- ===== Bổ sung A. Gắn PPCT của THCS Phố Hiến với chương trình, minh chứng tiết STEM =====
-- (khối dữ liệu mẫu 058 bỏ qua phần này nếu trường chưa có PPCT theo tiết lúc chạy)
do $$
declare kdi uuid; sch uuid; v2 uuid; v_stem uuid; b record; c record; l uuid; k int;
begin
  select id into kdi from organizations where is_platform limit 1;
  select id into sch from organizations where code = 'THCS-PH';
  select id into v2 from edu_programs where org_id = kdi and code = 'TIN-THCS-2018' and status = 'published' order by version_no desc limit 1;
  select id into v_stem from edu_programs where org_id = kdi and code = 'STEM-CT2' and status = 'published' limit 1;
  if sch is null or v2 is null or exists (select 1 from curriculum_evidence where org_id = sch) then return; end if;
  perform set_config('app.ppct_import', 'on', true);
  for b in select * from curriculum_books where org_id = sch and grade = 6 and subject = 'Tin học' loop
    update curriculum_books set program_id = v2 where id = b.id;
    update curriculum_lessons cl set unit_id = u.id
      from edu_program_units u
     where cl.book_id = b.id and cl.unit_id is null and u.program_id = v2 and u.unit_type = 'lesson'
       and regexp_replace(cl.title, ' \(tiếp\)$', '') = u.title;
  end loop;
  if v_stem is not null then
    for b in select * from curriculum_books where org_id = sch and grade = 8 and subject = 'Công nghệ' loop
      update curriculum_books set program_id = v_stem where id = b.id;
      k := 0;
      for l in select u.id from edu_program_units u where u.program_id = v_stem and u.unit_type = 'session' order by u.seq loop
        k := k + 1;
        update curriculum_lessons set unit_id = l where id = (select id from curriculum_lessons where book_id = b.id and kind = 'stem' order by seq offset k - 1 limit 1);
      end loop;
    end loop;
  end if;
  for c in select distinct on (ts.class_id) ts.class_id, ts.curriculum_lesson_id, l2.book_id, l2.seq
             from teaching_sessions ts join curriculum_lessons l2 on l2.id = ts.curriculum_lesson_id
            where ts.org_id = sch and ts.status = 'taught'
            order by ts.class_id, l2.seq desc limit 2 loop
    update teaching_sessions ts set curriculum_lesson_id = (select id from curriculum_lessons where book_id = c.book_id and seq = l2.seq + 1)
      from curriculum_lessons l2
     where l2.id = ts.curriculum_lesson_id and ts.class_id = c.class_id and l2.book_id = c.book_id and l2.seq >= c.seq - 1
       and exists (select 1 from curriculum_lessons where book_id = c.book_id and seq = l2.seq + 1);
  end loop;
  insert into curriculum_evidence (class_id, lesson_id, session_id, kind, url, note)
  select ts.class_id, ts.curriculum_lesson_id, ts.id, 'link', 'https://drive.google.com/drive/folders/minh-chung-stem', 'Ảnh sản phẩm nhóm và phiếu đánh giá'
    from teaching_sessions ts join curriculum_lessons l3 on l3.id = ts.curriculum_lesson_id
   where ts.org_id = sch and ts.status = 'taught' and l3.kind in ('stem', 'practice') and abs(hashtext(ts.id::text)) % 2 = 0;
  perform set_config('app.ppct_import', 'off', true);
end $$;

-- ===== Bổ sung B. Đủ 5 chương trình STEM CT1–CT5 và phạm vi triển khai trong tỉnh Hưng Yên =====
do $$
declare kdi uuid; so uuid; sch uuid; v2 uuid; v_ct1 uuid; v_ct2 uuid; v_ct4 uuid; v_ct5 uuid; t uuid; l uuid; s record;
begin
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  select id into sch from organizations where code = 'THCS-PH';
  if kdi is null or exists (select 1 from edu_programs where org_id = kdi and code in ('STEM-CT1', 'CT1-TH')) then return; end if;

  insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
  values (kdi, 'STEM-CT1', 'STEM CT1 — Khám phá khoa học quanh em', 'stem', 'CT1', 'tieuhoc', 4, 5, 'Khoa học', '{Toán,Công nghệ}',
          'Học sinh tiểu học quan sát, đặt câu hỏi và làm mô hình đơn giản để khám phá hiện tượng tự nhiên.', '{khoa_hoc,cong_nghe}', 'children')
  returning id into v_ct1;
  insert into edu_program_units (program_id, unit_type, seq, grade, title) values (v_ct1, 'topic', 1, 4, 'Chủ đề 1. Nam châm và la bàn') returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values
    (v_ct1, t, 'lesson', 1, 'Tìm hiểu lực hút của nam châm', 1), (v_ct1, t, 'lesson', 2, 'Làm la bàn từ kim khâu', 2);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_ct1, t, 1, 'K1', 'Nêu được nam châm hút các vật bằng sắt, thép', 'khoa_hoc'),
    (v_ct1, t, 2, 'K2', 'Làm được la bàn đơn giản và xác định hướng bắc', 'cong_nghe');
  insert into edu_program_units (program_id, unit_type, seq, grade, title) values (v_ct1, 'topic', 2, 5, 'Chủ đề 2. Mạch điện đơn giản') returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values (v_ct1, t, 'lesson', 1, 'Lắp mạch đèn pin', 2);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values (v_ct1, t, 1, 'K3', 'Lắp được mạch điện kín gồm pin, dây và bóng đèn', 'cong_nghe');
  update edu_programs set status = 'published', published_at = now() - interval '45 days', effective_from = public.vn_today() - 45 where id = v_ct1;

  insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
  values (kdi, 'STEM-CT4', 'STEM CT4 — Robot và trí tuệ nhân tạo', 'stem', 'CT4', 'thcs', 8, 9, 'Tin học', '{Công nghệ,Toán}',
          'Học sinh huấn luyện mô hình AI đơn giản và lập trình robot ra quyết định từ dữ liệu cảm biến.', '{tin_hoc,cong_nghe,gqvd}', 'children')
  returning id into v_ct4;
  insert into edu_program_units (program_id, unit_type, seq, grade, subject, title) values (v_ct4, 'topic', 1, 8, 'Tin học', 'Chủ đề 1. Nhận dạng hình ảnh với AI') returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values
    (v_ct4, t, 'lesson', 1, 'Huấn luyện mô hình nhận dạng hình ảnh', 1), (v_ct4, t, 'lesson', 2, 'Robot phân loại rác dùng AI', 2);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_ct4, t, 1, 'E1', 'Giải thích được cách máy học từ dữ liệu có nhãn', 'tin_hoc'),
    (v_ct4, t, 2, 'E2', 'Huấn luyện và đánh giá được mô hình nhận dạng đơn giản', 'gqvd');
  insert into edu_program_units (program_id, unit_type, seq, grade, subject, title) values (v_ct4, 'topic', 2, 9, 'Công nghệ', 'Chủ đề 2. Xe tự hành tránh vật cản') returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values (v_ct4, t, 'lesson', 1, 'Lập trình xe tránh vật cản bằng cảm biến siêu âm', 3);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values (v_ct4, t, 1, 'E3', 'Lập trình được xe tự dừng và rẽ khi gặp vật cản', 'cong_nghe');
  update edu_programs set status = 'published', published_at = now() - interval '20 days', effective_from = public.vn_today() - 20 where id = v_ct4;

  insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, scope)
  values (kdi, 'STEM-CT5', 'STEM CT5 — Nghiên cứu khoa học kĩ thuật', 'stem', 'CT5', 'thpt', 10, 11, 'Vật lí', '{Tin học,Toán,Hoá học}',
          'Học sinh THPT thực hiện dự án nghiên cứu khoa học kĩ thuật theo hướng dẫn cuộc thi KHKT của Bộ GD&ĐT.', '{khoa_hoc,gqvd,giao_tiep}', 'children')
  returning id into v_ct5;
  insert into edu_program_units (program_id, unit_type, seq, grade, title) values (v_ct5, 'topic', 1, 10, 'Chủ đề 1. Xác định vấn đề nghiên cứu') returning id into t;
  insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods) values
    (v_ct5, t, 'lesson', 1, 'Đặt câu hỏi và giả thuyết', 2), (v_ct5, t, 'lesson', 2, 'Viết đề cương nghiên cứu', 2);
  insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values
    (v_ct5, t, 1, 'S1', 'Xây dựng được câu hỏi nghiên cứu và giả thuyết khoa học', 'khoa_hoc'),
    (v_ct5, t, 2, 'S2', 'Trình bày được đề cương nghiên cứu theo mẫu', 'giao_tiep');
  update edu_programs set status = 'published', published_at = now() - interval '10 days', effective_from = public.vn_today() - 10 where id = v_ct5;

  if so is null then return; end if;
  select id into v2 from edu_programs where org_id = kdi and code = 'TIN-THCS-2018' and status = 'published' order by version_no desc limit 1;
  select id into v_ct2 from edu_programs where org_id = kdi and code = 'STEM-CT2' and status = 'published' limit 1;
  -- Tin học THCS gán cho cả Sở = mọi trường THCS trực thuộc; các chương trình STEM gán theo cấp học
  if v2 is not null then
    insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org) values (v2, so, '{6,7,8,9}', 'Áp dụng toàn tỉnh từ năm học hiện tại', so)
    on conflict (program_id, org_id) do nothing;
  end if;
  for s in with recursive t as (select id, code from organizations where id = so union all select o.id, o.code from organizations o join t on o.parent_id = t.id)
           select id, code from t where code is not null loop
    if s.code like 'THCS-%' and s.id <> sch and v_ct2 is not null and s.code in ('THCS-NTT', 'THCS-AT', 'THCS-LQD', 'THCS-TH') then
      insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org) values (v_ct2, s.id, '{8,9}', 'Mở rộng STEM CT2 năm học hiện tại', so)
      on conflict (program_id, org_id) do nothing;
    end if;
    if s.code in ('THCS-PH', 'THCS-CMT', 'THCS-DD') then
      insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org) values (v_ct4, s.id, '{8,9}', 'Thí điểm STEM CT4 (robot, AI)', so)
      on conflict (program_id, org_id) do nothing;
    end if;
    if s.code like 'TH-%' then
      insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org) values (v_ct1, s.id, '{4,5}', 'STEM CT1 cho tiểu học', so)
      on conflict (program_id, org_id) do nothing;
    end if;
    if s.code in ('THPT-CHY', 'THPT-VG', 'THPT-NH') then
      insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org) values (v_ct5, s.id, '{10,11}', 'Đội tuyển KHKT của trường', so)
      on conflict (program_id, org_id) do nothing;
    end if;
  end loop;
end $$;

-- ===== Bổ sung C. PPCT theo tiết cho các trường THCS khác của Hưng Yên (để Sở so sánh tiến độ giữa các trường) =====
do $$
declare kdi uuid; so uuid; sch uuid; v2 uuid; v_ct2 uuid; tpl uuid; s record; g int; subj text; bk uuid; c record; st record;
        v_start date; v_off int; i int; n int; lag int; yr text; l uuid; k int;
begin
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  select id into sch from organizations where code = 'THCS-PH';
  select id into v2 from edu_programs where org_id = kdi and code = 'TIN-THCS-2018' and status = 'published' order by version_no desc limit 1;
  select id into v_ct2 from edu_programs where org_id = kdi and code = 'STEM-CT2' and status = 'published' limit 1;
  select id into tpl from curriculum_books where org_id = kdi and grade = 6 and subject = 'Tin học' limit 1;
  if so is null or v2 is null then return; end if;
  if exists (select 1 from curriculum_books b join organizations o on o.id = b.org_id
              where o.code in ('THCS-NTT', 'THCS-AT', 'THCS-LQD', 'THCS-TH', 'THCS-CMT', 'THCS-DD', 'THCS-HC')) then return; end if;
  perform set_config('app.ppct_import', 'on', true);
  for s in with recursive t as (select id, code from organizations where id = so union all select o.id, o.code from organizations o join t on o.parent_id = t.id)
           select t.id, t.code from t where t.code in ('THCS-NTT', 'THCS-AT', 'THCS-LQD', 'THCS-TH', 'THCS-CMT', 'THCS-DD', 'THCS-HC') order by t.code loop
    select name, starts_on into yr, v_start from academic_years where org_id = s.id and is_current limit 1;
    -- mỗi trường chậm / nhanh khác nhau: số tiết chậm so với kế hoạch
    lag := case s.code when 'THCS-TH' then 4 when 'THCS-CMT' then 3 when 'THCS-HC' then 5 when 'THCS-DD' then 2 when 'THCS-AT' then 1 else 0 end;
    foreach subj in array array['Tin học', 'Công nghệ'] loop
      for g in 6..9 loop
        insert into curriculum_books (org_id, grade, subject, title, total_periods, year_name, periods_per_week, status, scope,
                                      program_id, note)
        values (s.id, g, subj, subj || ' ' || g, 35, yr, 1, 'published', 'own',
                case when subj = 'Tin học' and g = 6 then v2 when subj = 'Công nghệ' and g = 8 and exists (
                  select 1 from edu_program_assignments a where a.program_id = v_ct2 and a.org_id = s.id) then v_ct2 end,
                'PPCT mẫu do tổ chuyên môn xây dựng')
        returning id into bk;
        if subj = 'Tin học' and g = 6 and tpl is not null then
          insert into curriculum_lessons (book_id, seq, week, title, kind)
          select bk, seq, week, title, kind from curriculum_lessons where book_id = tpl;
          update curriculum_lessons cl set unit_id = u.id from edu_program_units u
           where cl.book_id = bk and u.program_id = v2 and u.unit_type = 'lesson' and regexp_replace(cl.title, ' \(tiếp\)$', '') = u.title;
        else
          insert into curriculum_lessons (book_id, seq, week, title, kind)
          select bk, k2, k2,
            case when k2 = 9 then 'Kiểm tra giữa học kì I' when k2 = 8 then 'Ôn tập giữa học kì I'
                 when k2 = 18 then 'Kiểm tra cuối học kì I' when k2 = 17 then 'Ôn tập học kì I'
                 when k2 = 27 then 'Kiểm tra giữa học kì II' when k2 = 35 then 'Kiểm tra cuối học kì II' when k2 = 34 then 'Ôn tập học kì II'
                 when k2 % 12 = 6 then 'Chủ đề STEM: dự án thực hành'
                 else subj || ' ' || g || ' — Bài ' || ((k2 + 1) / 2) || (case when k2 % 2 = 0 then ' (tiếp)' else '' end) end,
            case when k2 in (9, 18, 27, 35) then 'test' when k2 in (8, 17, 34) then 'review' when k2 % 12 = 6 then 'stem' else 'lesson' end
          from generate_series(1, 35) k2;
          if subj = 'Công nghệ' and g = 8 and v_ct2 is not null then
            k := 0;
            for l in select u.id from edu_program_units u where u.program_id = v_ct2 and u.unit_type = 'session' order by u.seq loop
              k := k + 1;
              update curriculum_lessons set unit_id = l where id = (select id from curriculum_lessons where book_id = bk and kind = 'stem' order by seq offset k - 1 limit 1);
            end loop;
          end if;
        end if;
        -- Gắn tiết đã dạy với tiết PPCT: tiết cuối = kế hoạch đến tuần này trừ độ chậm của trường (các tiết dạy sớm hơn để trống)
        for c in select cl.id as class_id from classes cl where cl.org_id = s.id and cl.grade = g loop
          select floor(greatest(1, least(52, (public.vn_today() - coalesce(v_start, public.vn_today())) / 7 + 1)))::int - lag
                 - (abs(hashtext(c.class_id::text || subj)) % 2) - count(*)
            into v_off from teaching_sessions where class_id = c.class_id and subject = subj and status = 'taught';
          i := 0;
          for st in select id from teaching_sessions where class_id = c.class_id and subject = subj and status = 'taught'
                     order by session_date, (select p.starts_at from period_configs p where p.id = period_id) loop
            i := i + 1;
            -- trường chậm vừa phải bỏ qua một tiết ở vài lớp (để có nội dung chưa hoàn thành)
            n := v_off + i - case when lag in (2, 3) and abs(hashtext(c.class_id::text || subj)) % 3 = 0 and v_off + i < 4 then 1 else 0 end;
            continue when n < 1;
            update teaching_sessions set curriculum_lesson_id = (select id from curriculum_lessons where book_id = bk and seq = n) where id = st.id;
          end loop;
        end loop;
      end loop;
    end loop;
    -- Minh chứng: trường có độ chậm thấp thì đủ minh chứng hơn
    insert into curriculum_evidence (class_id, lesson_id, session_id, kind, url, note)
    select ts.class_id, ts.curriculum_lesson_id, ts.id, 'link', 'https://drive.google.com/drive/folders/minh-chung-' || lower(s.code), 'Ảnh sản phẩm và phiếu học tập'
      from teaching_sessions ts join curriculum_lessons l2 on l2.id = ts.curriculum_lesson_id
     where ts.org_id = s.id and ts.status = 'taught' and l2.kind in ('stem', 'practice') and abs(hashtext(ts.id::text)) % 6 >= lag;
  end loop;
  perform set_config('app.ppct_import', 'off', true);
end $$;

-- ===== Bổ sung D. E-learning lớp 9A: ngân hàng Tin học 9, đề kiểm tra có lượt làm, khoá học đang mở và khoá quá hạn =====
do $$
declare sch uuid; c9 uuid; ex uuid; ex2 uuid; co uuid; co2 uuid; qs uuid[]; st record; i int := 0; ans jsonb; ok int; q record;
        l1 uuid; l2 uuid; l3 uuid; lib uuid; m1 uuid; m2 uuid;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from question_bank where org_id = sch and subject = 'Tin học' and grade = 9) then return; end if;
  select id into c9 from classes where org_id = sch and name like '%9A%' limit 1;
  if c9 is null then return; end if;
  insert into question_bank (org_id, subject, grade, topic, level, kind, stem, options, answer, explain, status) values
    (sch, 'Tin học', 9, 'Bảng tính điện tử', 'nhan_biet', 'single', 'Hàm nào tính tổng các ô từ A1 đến A5?', '["=SUM(A1:A5)","=AVERAGE(A1:A5)","=MAX(A1:A5)","=COUNT(A1:A5)"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 9, 'Bảng tính điện tử', 'thong_hieu', 'single', 'Ô B2 chứa =A2*2. Sao chép công thức xuống ô B3, công thức ở B3 là?', '["=A2*2","=A3*2","=B2*2","=A3*3"]', '[1]', 'Địa chỉ tương đối thay đổi theo hàng khi sao chép.', 'ready'),
    (sch, 'Tin học', 9, 'Bảng tính điện tử', 'van_dung', 'single', 'Để giữ cố định ô C1 khi sao chép công thức, ta viết?', '["C1","$C$1","C$1$","#C1"]', '[1]', 'Dùng địa chỉ tuyệt đối $C$1.', 'ready'),
    (sch, 'Tin học', 9, 'Bảng tính điện tử', 'van_dung', 'multi', 'Những hàm nào trả về một con số?', '["SUM","COUNT","IF","AVERAGE"]', '[0,1,3]', 'IF có thể trả về văn bản.', 'ready'),
    (sch, 'Tin học', 9, 'An toàn thông tin', 'nhan_biet', 'truefalse', 'Mật khẩu mạnh nên có chữ hoa, chữ thường, số và kí tự đặc biệt.', '["Đúng","Sai"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 9, 'An toàn thông tin', 'thong_hieu', 'single', 'Thư điện tử giả mạo ngân hàng yêu cầu nhập mật khẩu là hình thức?', '["Lừa đảo (phishing)","Sao lưu","Mã hoá","Tường lửa"]', '[0]', null, 'ready'),
    (sch, 'Tin học', 9, 'Giải quyết vấn đề', 'thong_hieu', 'single', 'Bước đầu tiên khi giải quyết một bài toán bằng máy tính là?', '["Viết chương trình","Xác định bài toán","Chạy thử","Sửa lỗi"]', '[1]', null, 'ready'),
    (sch, 'Tin học', 9, 'Giải quyết vấn đề', 'van_dung', 'single', 'Vòng lặp chạy với i từ 1 đến 10 bước nhảy 3 thì thực hiện mấy lần?', '["3","4","10","5"]', '[1]', 'i = 1, 4, 7, 10.', 'ready');
  select array_agg(id order by created_at, stem) into qs from question_bank where org_id = sch and subject = 'Tin học' and grade = 9;
  insert into practice_exams (org_id, title, description, subject, grade, mode, question_ids, duration_min, max_attempts, class_ids, opens_at, closes_at, status)
    values (sch, 'Kiểm tra 15 phút Tin học 9 — Bảng tính và an toàn thông tin', 'Đề cố định 8 câu, làm tối đa 3 lần, lấy điểm cao nhất.', 'Tin học', 9, 'fixed', qs, 15, 3,
            array[c9], now() - interval '7 days', now() + interval '7 days', 'published')
    returning id into ex;
  insert into practice_exams (org_id, title, description, subject, grade, mode, criteria, duration_min, max_attempts, class_ids, opens_at, status)
    values (sch, 'Luyện tập tự do Tin học 9', 'Mỗi lượt 6 câu ngẫu nhiên từ ngân hàng, làm không giới hạn.', 'Tin học', 9, 'random',
            '{"count": 6, "levels": {"nhan_biet": 2, "thong_hieu": 2, "van_dung": 2}}', 10, 0, array[c9], now() - interval '7 days', 'published')
    returning id into ex2;
  -- 6 học sinh 9A đã làm; câu địa chỉ tuyệt đối và câu nhiều đáp án là câu khó; hai em chưa làm
  for st in select id from students where class_id = c9 and coalesce(status, 'studying') = 'studying' order by full_name offset 2 loop
    i := i + 1;
    ans := '{}'::jsonb; ok := 0;
    for q in select b.id, b.answer, b.stem, b.kind from question_bank b where b.id = any(qs) loop
      if q.stem like 'Để giữ cố định%' then ans := ans || jsonb_build_object(q.id::text, case when i % 3 = 0 then q.answer else '[0]'::jsonb end);
      elsif q.kind = 'multi' then ans := ans || jsonb_build_object(q.id::text, case when i % 4 = 0 then q.answer else '[0,1]'::jsonb end);
      elsif q.stem like 'Vòng lặp%' then ans := ans || jsonb_build_object(q.id::text, case when i % 2 = 0 then q.answer else '[0]'::jsonb end);
      else ans := ans || jsonb_build_object(q.id::text, q.answer); end if;
      if public.answer_is_correct(ans -> q.id::text, q.answer) then ok := ok + 1; end if;
    end loop;
    insert into exam_attempts (exam_id, student_id, org_id, questions, answers, started_at, submitted_at, deadline, status, correct, total, score)
      values (ex, st.id, sch, qs, ans, now() - make_interval(days => 6 - least(i, 5), mins => 20), now() - make_interval(days => 6 - least(i, 5), mins => 9),
              now() - make_interval(days => 6 - least(i, 5), mins => 5), 'submitted', ok, cardinality(qs), round(10.0 * ok / cardinality(qs), 1));
  end loop;
  -- Khoá học giao cả lớp 9A, hạn 5 ngày nữa; gồm video, bài đọc, học liệu trong kho (nếu có) và bài kiểm tra
  insert into courses (org_id, title, description, subject, grade, class_ids, due_at, status)
    values (sch, 'Tự học: Bảng tính điện tử cơ bản', 'Khoá tự học trước giờ lên lớp: công thức, địa chỉ ô và hàm thông dụng.', 'Tin học', 9,
            array[c9], now() + interval '5 days', 'published')
    returning id into co;
  insert into course_lessons (course_id, position, title, kind, url, duration_min) values
    (co, 1, 'Video: nhập công thức và sao chép công thức', 'video', 'https://www.youtube.com/watch?v=Vl0H-qTclOg', 10) returning id into l1;
  insert into course_lessons (course_id, position, title, kind, body, duration_min) values
    (co, 2, 'Đọc: địa chỉ tương đối và tuyệt đối', 'reading', 'Địa chỉ tương đối (A1) thay đổi khi sao chép công thức. Địa chỉ tuyệt đối ($A$1) giữ nguyên. Địa chỉ hỗn hợp ($A1, A$1) chỉ cố định cột hoặc hàng.', 10) returning id into l2;
  select i2.id into lib from library_items i2 where i2.kind = 'material' and i2.status = 'published' order by i2.published_at desc nulls last limit 1;
  if lib is not null then
    insert into course_lessons (course_id, position, title, kind, library_item_id) values (co, 3, 'Học liệu: phiếu học tập trong kho dùng chung', 'library', lib);
  end if;
  insert into course_lessons (course_id, position, title, kind, exam_id) values (co, 4, 'Bài kiểm tra 15 phút', 'exam', ex) returning id into l3;
  insert into course_progress (lesson_id, student_id, done_at)
    select l1, s2.id, now() - interval '3 days' from students s2 where s2.class_id = c9 order by s2.full_name offset 1 limit 6;
  insert into course_progress (lesson_id, student_id, done_at)
    select l2, s2.id, now() - interval '2 days' from students s2 where s2.class_id = c9 order by s2.full_name offset 2 limit 4;
  -- Chuyên đề đã quá hạn, nhiều em chưa xong (để thấy cảnh báo quá hạn)
  insert into courses (org_id, title, description, subject, grade, class_ids, due_at, status)
    values (sch, 'Chuyên đề: An toàn trên không gian mạng', 'Nhận biết lừa đảo trực tuyến và bảo vệ tài khoản cá nhân.', 'Tin học', 9,
            array[c9], now() - interval '3 days', 'published')
    returning id into co2;
  insert into course_lessons (course_id, position, title, kind, url, duration_min) values
    (co2, 1, 'Video: nhận biết thư lừa đảo', 'video', 'https://www.youtube.com/watch?v=XBkzBrXlle0', 8) returning id into m1;
  insert into course_lessons (course_id, position, title, kind, body, duration_min) values
    (co2, 2, 'Đọc: 5 quy tắc đặt mật khẩu', 'reading', 'Dài ít nhất 12 kí tự; trộn chữ hoa, chữ thường, số, kí hiệu; không dùng lại; không chia sẻ; bật xác thực hai lớp.', 5) returning id into m2;
  insert into course_progress (lesson_id, student_id, done_at)
    select m1, s2.id, now() - interval '6 days' from students s2 where s2.class_id = c9 order by s2.full_name limit 5;
  insert into course_progress (lesson_id, student_id, done_at)
    select m2, s2.id, now() - interval '5 days' from students s2 where s2.class_id = c9 order by s2.full_name limit 2;
end $$;

-- ===== Bổ sung E. Giáo án ở các trạng thái khác: bị trả lại có ý kiến, đã xuất bản nhiều phiên bản =====
do $$
declare sch uuid; tch uuid; tch2 uuid; tpl uuid; lp uuid;
begin
  select id into sch from organizations where code = 'THCS-PH';
  if sch is null or exists (select 1 from lesson_plans where org_id = sch and title = 'Robot phân loại rác dùng AI — STEM CT4') then return; end if;
  select id into tpl from lesson_templates where name like 'Bài học STEM%' order by created_at limit 1;
  select id into tch from teachers where org_id = sch order by full_name limit 1;
  select id into tch2 from teachers where org_id = sch order by full_name offset 1 limit 1;
  if tch is null then return; end if;
  insert into lesson_plans (org_id, teacher_id, title, subject, grades, status, summary, template_id, periods, review_note, doc, steps)
  values (sch, tch, 'Robot phân loại rác dùng AI — STEM CT4', 'Tin học', '8', 'rejected', 'Chủ đề 1 của chương trình STEM CT4.', tpl, 2,
          'Bổ sung tiêu chí đánh giá sản phẩm theo rubric và dự trù vật tư cho 8 nhóm.',
          jsonb_build_object('muc_tieu', 'Giải thích được cách máy học từ dữ liệu; lập trình robot phân loại rác theo kết quả nhận dạng.'),
          jsonb_build_array(
            jsonb_build_object('id', 'p1', 'phase', 'engage', 'title', 'Máy tính nhận ra con mèo bằng cách nào?', 'minutes', 5),
            jsonb_build_object('id', 'p2', 'phase', 'explore', 'title', 'Huấn luyện mô hình với ảnh rác tái chế / không tái chế', 'minutes', 20),
            jsonb_build_object('id', 'p3', 'phase', 'elaborate', 'title', 'Lắp và lập trình robot phân loại', 'minutes', 40)));
  if tch2 is not null then
    insert into lesson_plans (org_id, teacher_id, title, subject, grades, status, summary, template_id, periods, version_no, published_at, doc, steps)
    values (sch, tch2, 'Bảng tính: địa chỉ tương đối và tuyệt đối', 'Tin học', '9', 'published', 'Bài dạy dùng cho khoá tự học lớp 9A.', tpl, 1, 2, now() - interval '2 days',
            jsonb_build_object('muc_tieu', 'Phân biệt và sử dụng đúng địa chỉ tương đối, tuyệt đối.'),
            jsonb_build_array(
              jsonb_build_object('id', 'b1', 'phase', 'engage', 'title', 'Sao chép công thức bị sai — vì sao?', 'minutes', 5),
              jsonb_build_object('id', 'b2', 'phase', 'explain', 'title', 'Địa chỉ $A$1', 'minutes', 15),
              jsonb_build_object('id', 'b3', 'phase', 'evaluate', 'title', 'Bài kiểm tra 15 phút trên e-learning', 'minutes', 15)))
    returning id into lp;
    insert into lesson_plan_versions (plan_id, version_no, snapshot, note, published_at)
    select lp, v.n, public.lesson_plan_content(p), v.note, v.at from lesson_plans p,
      (values (1, 'Bản đầu tiên', now() - interval '20 days'), (2, 'Thêm bài kiểm tra trên e-learning', now() - interval '2 days')) v(n, note, at)
     where p.id = lp;
  end if;
end $$;

-- ===== Bổ sung F. Bộ chương trình STEM CT1–CT5 chính thức của KDI (mỗi cấp học một chương trình) =====
-- Chương trình CT1/CT2/CT4/CT5 tạo ở phần B được chuyển thành chương trình chính thức tương ứng (giữ nguyên PPCT, minh chứng, phạm vi gán).
-- Mầm non chưa có trong chương trình giáo dục (khối 1–12) nên chưa tạo.
do $$
declare kdi uuid; so uuid; p jsonb; t jsonb; o jsonb; pid uuid; tid uuid; lid uuid; n int; k int; moved boolean; s record; rub uuid[];
  data jsonb := $j$[
  {"code":"CT1-TH","old":"STEM-CT1","remap":{"*":"Khoa học TN STEM"},"ct":"CT1","level":"tieuhoc","gf":1,"gt":5,"title":"STEM Tích hợp nội môn — Tiểu học","main":"Toán STEM","integ":["Khoa học TN STEM","Tin học STEM"],"comps":["toan_hoc","khoa_hoc","tin_hoc","gqvd"],
   "obj":"Giảng dạy từng môn theo hướng thực tiễn, ứng dụng sáng tạo. Học sinh tiểu học học Toán, Khoa học, Tin học qua hoạt động làm và trải nghiệm.",
   "topics":[{"g":3,"s":"Toán STEM","t":"Đo lường quanh em","l":"Làm thước đo và cân đơn giản","ss":["Buổi 1: Đo chiều dài đồ vật","Buổi 2: Làm cân thăng bằng"],"o":[["Sử dụng được đơn vị đo để đo đồ vật quen thuộc","toan_hoc"],["Làm được dụng cụ đo đơn giản từ vật liệu tái chế","cong_nghe"]]},
             {"g":5,"s":"Tin học STEM","t":"Lập trình Scratch kể chuyện khoa học","l":"Hoạt hình vòng đời của cây","ss":["Buổi 1: Thiết kế kịch bản","Buổi 2: Lập trình và trình bày"],"o":[["Tạo được chương trình Scratch có sự kiện và vòng lặp","tin_hoc"],["Trình bày được sản phẩm trước lớp","giao_tiep"]]}]},
  {"code":"CT1-THCS","ct":"CT1","level":"thcs","gf":6,"gt":9,"title":"STEM Tích hợp nội môn — THCS","main":"Khoa học TN STEM","integ":["Toán STEM","Tin học STEM"],"comps":["khoa_hoc","toan_hoc","tin_hoc","gqvd"],
   "obj":"Giảng dạy từng môn theo hướng thực tiễn, ứng dụng sáng tạo. Mỗi môn có chủ đề STEM gắn với nội dung chương trình GDPT 2018.",
   "topics":[{"g":7,"s":"Khoa học TN STEM","t":"Năng lượng mặt trời","l":"Bếp năng lượng mặt trời","ss":["Buổi 1: Tìm hiểu bức xạ nhiệt","Buổi 2: Chế tạo và đo nhiệt độ"],"o":[["Giải thích được sự hấp thụ và phản xạ nhiệt","khoa_hoc"],["Chế tạo được bếp và so sánh hiệu quả bằng số liệu đo","gqvd"]]},
             {"g":8,"s":"Toán STEM","t":"Thống kê trong đời sống","l":"Khảo sát và biểu diễn dữ liệu lớp học","ss":["Buổi 1: Thu thập dữ liệu","Buổi 2: Vẽ biểu đồ bằng bảng tính"],"o":[["Thu thập và phân loại được dữ liệu từ khảo sát","toan_hoc"],["Biểu diễn được dữ liệu bằng biểu đồ phù hợp","tin_hoc"]]}]},
  {"code":"CT1-THPT","ct":"CT1","level":"thpt","gf":10,"gt":12,"title":"STEM Tích hợp nội môn — THPT","main":"Toán STEM","integ":["Lý STEM","Hóa STEM","Sinh STEM","Tin học STEM"],"comps":["toan_hoc","khoa_hoc","tin_hoc","gqvd"],"note":"Áp dụng cho THPT và THPT Nghề.",
   "obj":"Giảng dạy từng môn theo hướng thực tiễn, ứng dụng sáng tạo. Học sinh vận dụng kiến thức Toán, Lý, Hóa, Sinh, Tin học vào sản phẩm cụ thể.",
   "topics":[{"g":10,"s":"Lý STEM","t":"Chuyển động ném xiên","l":"Máy bắn đá mini","ss":["Buổi 1: Mô hình hoá quỹ đạo","Buổi 2: Chế tạo và thử nghiệm"],"o":[["Vận dụng được công thức chuyển động ném xiên để dự đoán tầm xa","khoa_hoc"],["Đo và so sánh được kết quả thực nghiệm với lí thuyết","toan_hoc"]]},
             {"g":11,"s":"Hóa STEM","t":"Pin điện hoá","l":"Pin từ trái cây","ss":["Buổi 1: Nguyên lí pin điện hoá","Buổi 2: Đo hiệu điện thế và tối ưu"],"o":[["Giải thích được nguyên lí pin điện hoá","khoa_hoc"],["Thiết kế được pin cho hiệu điện thế mong muốn","gqvd"]]}]},
  {"code":"CT2-THCS","old":"STEM-CT2","remap":{"Công nghệ":"Công nghệ STEM","Tin học":"Công nghệ STEM"},"ct":"CT2","level":"thcs","gf":6,"gt":9,"title":"STEM Liên môn — THCS","main":"Công nghệ STEM","integ":["Toán STEM","Lý STEM","Hóa STEM","Sinh STEM"],"comps":["cong_nghe","khoa_hoc","toan_hoc","gqvd","giao_tiep"],
   "obj":"Vận dụng kiến thức liên môn để giải quyết vấn đề thực tiễn. Mỗi chủ đề kết hợp Toán, Lý, Hóa, Sinh với Công nghệ để làm ra sản phẩm.",
   "topics":[{"g":7,"s":"Sinh STEM","t":"Vườn rau thuỷ canh","l":"Hệ thống thuỷ canh tĩnh","ss":["Buổi 1: Dinh dưỡng của cây","Buổi 2: Lắp hệ thống và theo dõi"],"o":[["Giải thích được nhu cầu dinh dưỡng khoáng của cây","khoa_hoc"],["Lắp được hệ thống thuỷ canh và ghi nhật kí sinh trưởng","cong_nghe"]]},
             {"g":9,"s":"Toán STEM","t":"Thiết kế cầu chịu lực","l":"Cầu giấy chịu tải","ss":["Buổi 1: Kết cấu tam giác","Buổi 2: Chế tạo và thử tải"],"o":[["Vận dụng được tính chất hình học để thiết kế kết cấu","toan_hoc"],["Đánh giá được sản phẩm theo tỉ lệ tải trọng trên khối lượng","gqvd"]]}]},
  {"code":"CT2-THPT","ct":"CT2","level":"thpt","gf":10,"gt":12,"title":"STEM Liên môn — THPT","main":"Công nghệ STEM","integ":["Toán STEM","Lý STEM","Hóa STEM","Sinh STEM"],"comps":["cong_nghe","khoa_hoc","tin_hoc","gqvd"],
   "obj":"Vận dụng kiến thức liên môn để giải quyết vấn đề thực tiễn của địa phương.",
   "topics":[{"g":10,"s":"Hóa STEM","t":"Xử lí nước thải sinh hoạt","l":"Bộ lọc nước nhiều tầng","ss":["Buổi 1: Phân tích mẫu nước","Buổi 2: Chế tạo và kiểm tra bộ lọc"],"o":[["Xác định được một số chỉ tiêu chất lượng nước","khoa_hoc"],["Thiết kế được bộ lọc và đánh giá hiệu quả lọc","gqvd"]]},
             {"g":11,"s":"Công nghệ STEM","t":"Nhà kính thông minh","l":"Điều khiển nhiệt độ và độ ẩm","ss":["Buổi 1: Cảm biến và vi điều khiển","Buổi 2: Lắp đặt mô hình"],"o":[["Lựa chọn được cảm biến phù hợp với yêu cầu","cong_nghe"],["Lập trình được điều khiển tự động theo ngưỡng","tin_hoc"]]}]},
  {"code":"CT3-TH","ct":"CT3","level":"tieuhoc","gf":1,"gt":5,"title":"STEM Đổi mới sáng tạo — Tiểu học","main":"Làm sản phẩm","integ":["CLB Sáng tạo","Ngoại khóa STEM"],"comps":["gqvd","giao_tiep","cong_nghe"],
   "obj":"Hoạt động sáng tạo, làm sản phẩm cụ thể qua câu lạc bộ và ngoại khoá.",
   "topics":[{"g":3,"s":"CLB Sáng tạo","t":"Đồ chơi từ vật liệu tái chế","l":"Xe chạy bằng dây chun","ss":["Buổi 1: Ý tưởng và phác thảo","Buổi 2: Làm và thi chạy xe"],"o":[["Đề xuất được ý tưởng đồ chơi từ vật liệu sẵn có","gqvd"],["Làm được sản phẩm và giới thiệu với bạn","giao_tiep"]]},
             {"g":5,"s":"Ngoại khóa STEM","t":"Ngày hội STEM","l":"Gian trưng bày sản phẩm","ss":["Buổi 1: Chuẩn bị gian trưng bày","Buổi 2: Thuyết trình sản phẩm"],"o":[["Phối hợp được với nhóm để chuẩn bị trưng bày","giao_tiep"],["Thuyết trình được về sản phẩm của nhóm","giao_tiep"]]}]},
  {"code":"CT3-THCS","ct":"CT3","level":"thcs","gf":6,"gt":9,"title":"STEM Đổi mới sáng tạo — THCS","main":"Làm sản phẩm","integ":["CLB Sáng tạo","Ngoại khóa STEM"],"comps":["gqvd","giao_tiep","cong_nghe"],
   "obj":"Hoạt động sáng tạo, làm sản phẩm cụ thể theo quy trình tư duy thiết kế.",
   "topics":[{"g":7,"s":"CLB Sáng tạo","t":"Tư duy thiết kế","l":"Giải pháp cho lớp học xanh","ss":["Buổi 1: Thấu cảm và xác định vấn đề","Buổi 2: Tạo mẫu thử"],"o":[["Xác định được vấn đề từ nhu cầu người dùng","gqvd"],["Tạo được mẫu thử và cải tiến theo góp ý","gqvd"]]},
             {"g":8,"s":"Làm sản phẩm","t":"Sản phẩm dự thi sáng tạo","l":"Hoàn thiện sản phẩm dự thi","ss":["Buổi 1: Hoàn thiện sản phẩm","Buổi 2: Viết thuyết minh"],"o":[["Hoàn thiện được sản phẩm đáp ứng tiêu chí đề ra","cong_nghe"],["Viết được bản thuyết minh sản phẩm","giao_tiep"]]}]},
  {"code":"CT3-THPT","ct":"CT3","level":"thpt","gf":10,"gt":12,"title":"STEM Đổi mới sáng tạo — THPT","main":"Làm sản phẩm","integ":["CLB Sáng tạo","Ngoại khóa STEM"],"comps":["gqvd","giao_tiep","cong_nghe"],
   "obj":"Hoạt động sáng tạo, làm sản phẩm cụ thể, hướng tới khởi nghiệp.",
   "topics":[{"g":10,"s":"Ngoại khóa STEM","t":"Khởi nghiệp sáng tạo","l":"Mô hình kinh doanh cho sản phẩm STEM","ss":["Buổi 1: Phân tích thị trường","Buổi 2: Gọi vốn thử"],"o":[["Xây dựng được mô hình kinh doanh một trang","gqvd"],["Trình bày được ý tưởng trước hội đồng","giao_tiep"]]},
             {"g":11,"s":"Làm sản phẩm","t":"In 3D và chế tạo số","l":"Thiết kế vật dụng bằng phần mềm 3D","ss":["Buổi 1: Dựng mô hình 3D","Buổi 2: In và hoàn thiện"],"o":[["Dựng được mô hình 3D theo bản vẽ","cong_nghe"],["Đánh giá và cải tiến được sản phẩm in","gqvd"]]}]},
  {"code":"CT4-THCS","old":"STEM-CT4","remap":{"Tin học":"AI & Lập trình","Công nghệ":"Robotic"},"ct":"CT4","level":"thcs","gf":6,"gt":9,"title":"STEM Robotic · AI · Trải nghiệm — THCS","main":"Robotic","integ":["AI & Lập trình","IoT"],"comps":["tin_hoc","cong_nghe","gqvd"],
   "obj":"STEM định hướng đổi mới sáng tạo: Robotic, AI, Trải nghiệm.",
   "topics":[{"g":6,"s":"Robotic","t":"Làm quen robot giáo dục","l":"Robot di chuyển theo lệnh","ss":["Buổi 1: Lắp ráp cơ bản","Buổi 2: Lập trình kéo thả"],"o":[["Lắp ráp được robot theo hướng dẫn","cong_nghe"],["Lập trình được robot di chuyển theo hình","tin_hoc"]]},
             {"g":7,"s":"IoT","t":"Trạm quan trắc thời tiết","l":"Đo nhiệt độ, độ ẩm và gửi dữ liệu lên mạng","ss":["Buổi 1: Kết nối cảm biến","Buổi 2: Hiển thị dữ liệu trên điện thoại"],"o":[["Kết nối được cảm biến với bo mạch IoT","cong_nghe"],["Theo dõi được dữ liệu từ xa","tin_hoc"]]}]},
  {"code":"CT4-THPT","ct":"CT4","level":"thpt","gf":10,"gt":12,"title":"STEM Robotic · AI · Trải nghiệm — THPT","main":"Robotic","integ":["AI & Lập trình","IoT"],"comps":["tin_hoc","cong_nghe","gqvd"],"note":"Áp dụng cho THPT và THPT Nghề.",
   "obj":"STEM định hướng đổi mới sáng tạo: Robotic, AI, Trải nghiệm.",
   "topics":[{"g":10,"s":"AI & Lập trình","t":"Lập trình Python cho AI","l":"Phân loại dữ liệu với học máy","ss":["Buổi 1: Chuẩn bị dữ liệu","Buổi 2: Huấn luyện và đánh giá mô hình"],"o":[["Chuẩn bị được bộ dữ liệu có nhãn","tin_hoc"],["Đánh giá được độ chính xác của mô hình","gqvd"]]},
             {"g":11,"s":"Robotic","t":"Cánh tay robot","l":"Điều khiển cánh tay robot gắp vật","ss":["Buổi 1: Động học cơ bản","Buổi 2: Lập trình gắp và đặt vật"],"o":[["Mô tả được bậc tự do của cánh tay robot","cong_nghe"],["Lập trình được chuỗi thao tác gắp và đặt vật","tin_hoc"]]}]},
  {"code":"CT5-THCS","ct":"CT5","level":"thcs","gf":6,"gt":9,"title":"STEM Nghiên cứu khoa học — THCS","main":"NCKH","integ":["Dự án Nghiên cứu"],"comps":["khoa_hoc","gqvd","giao_tiep"],
   "obj":"Tập trung nghiên cứu khoa học độc lập: đặt câu hỏi, thiết kế thí nghiệm, báo cáo kết quả.",
   "topics":[{"g":8,"s":"NCKH","t":"Phương pháp nghiên cứu khoa học","l":"Từ quan sát đến câu hỏi nghiên cứu","ss":["Buổi 1: Quan sát và đặt câu hỏi","Buổi 2: Thiết kế thí nghiệm"],"o":[["Đặt được câu hỏi nghiên cứu từ hiện tượng quan sát","khoa_hoc"],["Thiết kế được thí nghiệm có biến kiểm soát","gqvd"]]},
             {"g":9,"s":"Dự án Nghiên cứu","t":"Dự án nghiên cứu nhỏ","l":"Thực hiện và báo cáo dự án","ss":["Buổi 1: Thu thập số liệu","Buổi 2: Viết báo cáo và poster"],"o":[["Xử lí được số liệu và rút ra kết luận","toan_hoc"],["Trình bày được kết quả bằng poster khoa học","giao_tiep"]]}]},
  {"code":"CT5-THPT","old":"STEM-CT5","remap":{"*":"NCKH"},"ct":"CT5","level":"thpt","gf":10,"gt":12,"title":"STEM Nghiên cứu khoa học — THPT","main":"NCKH","integ":["Dự án Nghiên cứu"],"comps":["khoa_hoc","gqvd","giao_tiep","toan_hoc"],
   "obj":"Tập trung nghiên cứu khoa học độc lập, hướng tới cuộc thi Khoa học kĩ thuật của Bộ GD&ĐT.",
   "topics":[{"g":11,"s":"Dự án Nghiên cứu","t":"Triển khai nghiên cứu","l":"Thu thập và phân tích dữ liệu","ss":["Buổi 1: Tiến hành thực nghiệm","Buổi 2: Phân tích thống kê"],"o":[["Tiến hành được thực nghiệm theo đề cương","khoa_hoc"],["Phân tích được dữ liệu bằng công cụ thống kê","toan_hoc"]]},
             {"g":12,"s":"Dự án Nghiên cứu","t":"Báo cáo và dự thi KHKT","l":"Hoàn thiện hồ sơ dự thi","ss":["Buổi 1: Viết báo cáo toàn văn","Buổi 2: Bảo vệ trước hội đồng"],"o":[["Viết được báo cáo theo mẫu cuộc thi KHKT","giao_tiep"],["Bảo vệ được kết quả trước hội đồng","giao_tiep"]]}]}
  ]$j$;
begin
  select id into kdi from organizations where is_platform limit 1;
  select id into so from organizations where code = 'SO-HY';
  if kdi is null then return; end if;
  select coalesce(array_agg(id order by title), '{}') into rub from rubrics where org_id is null;
  for p in select * from jsonb_array_elements(data) loop
    if exists (select 1 from edu_programs where org_id = kdi and code = p->>'code') then continue; end if;
    pid := null; moved := false;
    if p ? 'old' then
      select id into pid from edu_programs where org_id = kdi and code = p->>'old' and status = 'published' order by version_no desc limit 1;
    end if;
    if pid is not null then
      moved := true;
      update edu_programs set status = 'draft' where id = pid;
      update edu_programs set code = p->>'code', title = p->>'title', ct_code = p->>'ct', level = p->>'level', grade_from = (p->>'gf')::int, grade_to = (p->>'gt')::int,
             main_subject = p->>'main', integrated_subjects = array(select jsonb_array_elements_text(p->'integ')), objectives = p->>'obj',
             competency_keys = array(select jsonb_array_elements_text(p->'comps')), rubric_ids = rub, note = p->>'note'
       where id = pid;
      update edu_program_units set subject = coalesce(p->'remap'->>coalesce(subject, '*'), subject) where program_id = pid and parent_id is null;
    else
      insert into edu_programs (org_id, code, title, kind, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives, competency_keys, rubric_ids, scope, note)
      values (kdi, p->>'code', p->>'title', 'stem', p->>'ct', p->>'level', (p->>'gf')::int, (p->>'gt')::int, p->>'main',
              array(select jsonb_array_elements_text(p->'integ')), p->>'obj', array(select jsonb_array_elements_text(p->'comps')), rub, 'children', p->>'note')
      returning id into pid;
    end if;
    select coalesce(max(seq), 0) into n from edu_program_units where program_id = pid and parent_id is null;
    for t in select * from jsonb_array_elements(p->'topics') loop
      n := n + 1;
      insert into edu_program_units (program_id, unit_type, seq, grade, subject, title) values (pid, 'topic', n, (t->>'g')::int, t->>'s', 'Chủ đề ' || n || '. ' || (t->>'t')) returning id into tid;
      insert into edu_program_units (program_id, parent_id, unit_type, seq, title) values (pid, tid, 'lesson', 1, t->>'l') returning id into lid;
      insert into edu_program_units (program_id, parent_id, unit_type, seq, title, periods)
      select pid, lid, 'session', x.i, x.v, 1 from jsonb_array_elements_text(t->'ss') with ordinality x(v, i);
      k := 0;
      for o in select * from jsonb_array_elements(t->'o') loop
        k := k + 1;
        insert into edu_outcomes (program_id, unit_id, seq, code, content, competency_key) values (pid, tid, k, 'YC' || n || '.' || k, o->>0, o->>1);
      end loop;
    end loop;
    update edu_programs set status = 'published', published_at = coalesce(published_at, now() - interval '30 days'),
           effective_from = coalesce(effective_from, public.vn_today() - 30) where id = pid;
    -- chuyển đổi tại chỗ: bỏ 2 dòng nhật ký tạm (ban hành → nháp → ban hành)
    if moved then delete from edu_program_log where program_id = pid and at = now() and from_status is not null; end if;
  end loop;

  -- Phạm vi triển khai trong tỉnh Hưng Yên (bổ sung, không xoá phạm vi đã có)
  if so is null then return; end if;
  for s in with recursive r as (select id, code from organizations where id = so union all select o.id, o.code from organizations o join r on o.parent_id = r.id)
           select r.id, r.code, e.id as pid, e.code as pcode, e.grade_from, e.grade_to
             from r join edu_programs e on e.org_id = kdi and e.status = 'published' and (
                  (e.code = 'CT1-TH' and r.code like 'TH-%') or (e.code = 'CT1-THCS' and r.code like 'THCS-%') or (e.code = 'CT1-THPT' and r.code like 'THPT-%')
               or (e.code = 'CT2-THCS' and r.code in ('THCS-PH', 'THCS-NTT', 'THCS-AT', 'THCS-LQD', 'THCS-TH'))
               or (e.code = 'CT2-THPT' and r.code in ('THPT-PNL', 'THPT-TV'))
               or (e.code = 'CT3-TH' and r.code = 'TH-DTD') or (e.code = 'CT3-THCS' and r.code = 'THCS-HC') or (e.code = 'CT3-THPT' and r.code = 'THPT-TQP')
               or (e.code = 'CT4-THCS' and r.code in ('THCS-PH', 'THCS-CMT', 'THCS-DD')) or (e.code = 'CT4-THPT' and r.code in ('THPT-CHY', 'THPT-TV'))
               or (e.code = 'CT5-THCS' and r.code = 'THCS-LQD') or (e.code = 'CT5-THPT' and r.code in ('THPT-CHY', 'THPT-VG', 'THPT-NH')))
  loop
    insert into edu_program_assignments (program_id, org_id, grades, note, assigner_org)
    values (s.pid, s.id, array(select generate_series(s.grade_from, s.grade_to)), 'Triển khai ' || s.pcode || ' năm học hiện tại', so)
    on conflict (program_id, org_id) do nothing;
  end loop;
end $$;

-- ######## 063 bài giảng tương tác, hoạt động trò chơi / mô phỏng, thiết bị trong gói STEM, nội dung buổi học ########
-- Dữ liệu mẫu (chỉ khi bật app.seed_demo): thiết bị và chủ đề cho các gói mẫu, hoạt động tương tác mới,
-- bài giảng tương tác cho 3 bài mẫu của THCS Phố Hiến, nội dung từng buổi học của các chương trình STEM do KDI ban hành.
do $$
declare
  sch uuid; tuan uuid; pk record; t uuid; i int; u record; ct text; l jsonb; ph jsonb; flow jsonb; topic text; blocks jsonb; k int; sim jsonb; obj text;
begin
  if coalesce(current_setting('app.seed_demo', true), '') <> 'on' then return; end if;
  select id into sch from organizations where code = 'THCS-PH';
  select id into tuan from teachers where org_id = sch and full_name = 'Phạm Anh Tuấn' limit 1;

  -- ===== 1. Gói STEM: thiết bị trong hợp đồng =====
  for pk in select * from stem_packages p where not exists (select 1 from package_devices d where d.package_id = p.id) loop
    if pk.name like 'Gói STEM Cơ bản%' then
      insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, serials) values
        (pk.org_id, pk.id, 1, pk.provider, 'Laptop giáo viên Dell Inspiron 15', 'Intel Core i5-1335U / 8 GB RAM / 512 GB SSD / 15.6" FHD IPS / Win 11 Pro', 'chiếc', 1, 16490000, '{DL-INS-2025-001}'),
        (pk.org_id, pk.id, 2, pk.provider, 'Bộ kit lập trình Arduino Uno R3', 'Arduino Uno R3 + breadboard + LED + cảm biến nhiệt độ, ánh sáng, siêu âm (HC-SR04), còi buzzer, dây jumper', 'bộ', 30, 850000, '{}'),
        (pk.org_id, pk.id, 3, pk.provider, 'Máy tính bảng Samsung Galaxy Tab A9+', '11" TFT / Snapdragon 695 / 8 GB RAM / WiFi 6 / Android 13 / Bảo vệ mắt TÜV', 'chiếc', 30, 7490000, '{}'),
        (pk.org_id, pk.id, 4, pk.provider, 'Màn hình tương tác SMART Board MX275-V4', '75" 4K UHD / Multi-touch 20 điểm / iQ Built-in / Bút thông minh kèm theo', 'chiếc', 1, 48500000, '{SB-MX275-001}');
    elsif pk.name like 'Gói STEM Nâng cao%' then
      insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, serials) values
        (pk.org_id, pk.id, 1, pk.provider, 'Bộ cảm biến IoT Arduino MKR WiFi 1010', 'Arduino MKR WiFi 1010 + cảm biến nhiệt độ – độ ẩm DHT22 + cảm biến bụi PM2.5 + cảm biến CO2 MH-Z19B + module LCD 16×2', 'bộ', 30, 2850000, '{}'),
        (pk.org_id, pk.id, 2, pk.provider, 'Màn hình tương tác Promethean ActivePanel 65"', '65" 4K / Multi-touch 40 điểm / Android 11 / WiFi 6 / Bluetooth 5.0', 'chiếc', 2, 32000000, '{PA-65-2025-001,PA-65-2025-002}'),
        (pk.org_id, pk.id, 3, pk.provider, 'Máy tính bảng Lenovo Tab P11 Pro Gen 2', '11.2" OLED / Snapdragon 870 / 6 GB RAM / 128 GB / WiFi 6 / Android 12L', 'chiếc', 30, 8990000, '{}');
    elsif pk.name like 'Gói STEM THCS Toàn diện%' then
      insert into package_devices (org_id, package_id, seq, supplier, name, spec, unit, qty, unit_price, serials) values
        (pk.org_id, pk.id, 1, pk.provider, 'Robot lập trình mBot', 'mBot v1.1 Bluetooth, cảm biến dò line, siêu âm; lập trình mBlock (Scratch / Python)', 'bộ', 30, 2150000, '{}'),
        (pk.org_id, pk.id, 2, pk.provider, 'Robot Lego SPIKE Prime', 'Hub 6 cổng, 3 động cơ, cảm biến màu, khoảng cách, lực; 528 chi tiết', 'bộ', 10, 9800000, '{}'),
        (pk.org_id, pk.id, 3, pk.provider, 'Bộ mạch Arduino Starter', 'Arduino Uno R3, breadboard, 15 loại linh kiện và cảm biến cơ bản', 'bộ', 30, 850000, '{}'),
        (pk.org_id, pk.id, 4, pk.provider, 'Kit cảm biến IoT + Gateway', 'ESP32, DHT22, độ ẩm đất, ánh sáng, relay; gateway WiFi gửi dữ liệu lên ứng dụng', 'bộ', 15, 2850000, '{}'),
        (pk.org_id, pk.id, 5, pk.provider, 'Máy in 3D Creality Ender-3 V3', 'Khổ in 220×220×250 mm, đầu phun 0.4 mm, nhựa PLA', 'chiếc', 2, 8900000, '{CR-E3V3-001,CR-E3V3-002}'),
        (pk.org_id, pk.id, 6, pk.provider, 'Laptop giáo viên Dell Inspiron 15', 'Intel Core i5 / 8 GB RAM / 512 GB SSD / 15.6" FHD', 'chiếc', 2, 16490000, '{DL-INS-2025-011,DL-INS-2025-012}'),
        (pk.org_id, pk.id, 7, pk.provider, 'Màn hình tương tác SMART Board MX275-V4', '75" 4K UHD / Multi-touch 20 điểm', 'chiếc', 1, 48500000, '{SB-MX275-011}'),
        (pk.org_id, pk.id, 8, pk.provider, 'Máy bay không người lái EDU', 'Drone giáo dục lập trình được, camera 720p, khung bảo vệ cánh', 'chiếc', 10, 3200000, '{}'),
        (pk.org_id, pk.id, 9, pk.provider, 'Bộ thí nghiệm Hoá học cơ bản', 'Dụng cụ thuỷ tinh, đèn cồn, giá ống nghiệm, hoá chất an toàn cho THCS', 'bộ', 15, 1600000, '{}'),
        (pk.org_id, pk.id, 10, pk.provider, 'Bộ cảm biến đa năng STEM', 'Cảm biến nhiệt độ, pH, lực, chuyển động; kết nối máy tính bảng qua Bluetooth', 'bộ', 4, 6500000, '{}');
    end if;
  end loop;

  -- ===== 2. Gói STEM: nội dung chương trình cho gói chưa có chủ đề =====
  for pk in select * from stem_packages p where not exists (select 1 from package_topics x where x.package_id = p.id) and (p.name like 'Gói STEM Cơ bản%' or p.name like 'Gói STEM Nâng cao%') loop
    if pk.name like 'Gói STEM Cơ bản%' then
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 1, 'CT1', 'Lập trình khối Scratch cơ bản', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Làm quen giao diện Scratch 3.0', 45), (pk.org_id, t, 2, 'Chuyển động và hoạt hình nhân vật', 45), (pk.org_id, t, 3, 'Dự án mini: Trò chơi tránh vật cản', 90);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 2, 'CT2', 'Điện tử cơ bản với Arduino', 225) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Giới thiệu Arduino và mạch điện cơ bản', 45), (pk.org_id, t, 2, 'Điều khiển LED và nháy theo nhịp (Blink)', 45),
        (pk.org_id, t, 3, 'Cảm biến siêu âm HC-SR04 — Đo khoảng cách', 45), (pk.org_id, t, 4, 'Dự án: Đèn tự động theo cường độ ánh sáng', 90);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 3, 'CT3', 'Thiết kế 3D với Tinkercad', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Giới thiệu Tinkercad và tư duy thiết kế 3D', 45), (pk.org_id, t, 2, 'Tạo mô hình hộp đựng bút theo kích thước thật', 90), (pk.org_id, t, 3, 'In 3D và kiểm tra chất lượng sản phẩm', 45);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 4, 'CT1,CT2', 'Dự án STEM tích hợp — Nhà thông minh mini', 135) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Thiết kế mô hình và phân công nhóm', 45), (pk.org_id, t, 2, 'Lắp mạch cảm biến, hoàn thiện và trình bày', 90);
    else
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 1, 'CT4', 'Trạm quan trắc môi trường IoT', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Lắp trạm đo dữ liệu', 90), (pk.org_id, t, 2, 'Lập bảng tần số, vẽ biểu đồ', 45), (pk.org_id, t, 3, 'Báo cáo khuyến nghị thông gió lớp học', 45);
      insert into package_topics (org_id, package_id, seq, program, title, minutes) values (pk.org_id, pk.id, 2, 'CT5', 'Nghiên cứu chất lượng không khí lớp học', 180) returning id into t;
      insert into package_topic_sessions (org_id, topic_id, seq, title, minutes) values (pk.org_id, t, 1, 'Đặt câu hỏi và giả thuyết nghiên cứu', 45), (pk.org_id, t, 2, 'Đo CO2, bụi mịn theo giờ trong tuần', 90), (pk.org_id, t, 3, 'Phân tích số liệu và viết poster', 45);
    end if;
    update stem_packages p set topics = (select count(*) from package_topics y where y.package_id = p.id),
           sessions = (select count(*) from package_topic_sessions x join package_topics y on y.id = x.topic_id where y.package_id = p.id)
     where p.id = pk.id;
  end loop;

  -- ===== 3. Hoạt động tương tác mới của THCS Phố Hiến =====
  if sch is not null and not exists (select 1 from activities where org_id = sch and kind in ('race', 'wheel', 'sim')) then
    insert into activities (org_id, teacher_id, kind, title, instructions, subject, grades, program, content, status) values
      (sch, tuan, 'race', 'Đường đua tri thức — An toàn điện', 'Game đua trả lời nhanh 3 làn: học sinh thi cùng 2 đội máy, trả lời đúng thì xe tiến về đích.', 'Khoa học tự nhiên', '6,7,8,9', 'CT1',
       $j${"seconds":20,"items":[
         {"q":"Vật nào sau đây CÁCH ĐIỆN?","options":["Dây đồng","Nước muối","Găng tay cao su","Thanh nhôm"],"answer":2},
         {"q":"Khi tay ướt có được cắm, rút phích điện không?","options":["Được nếu nhanh tay","Không bao giờ","Được nếu điện yếu","Chỉ khi có người lớn"],"answer":1},
         {"q":"Thiết bị nào tự ngắt điện khi mạch bị quá tải?","options":["Aptomat","Bóng đèn","Quạt trần","Ổ cắm thường"],"answer":0},
         {"q":"Mưa bão ở Hưng Yên, thấy dây điện đứt rơi xuống đường em phải làm gì?","options":["Nhặt dây dẹp vào lề","Tránh xa và báo người lớn","Lấy que gỗ khều thử","Chụp ảnh đăng mạng"],"answer":1},
         {"q":"Đơn vị đo hiệu điện thế là gì?","options":["Ampe (A)","Vôn (V)","Oát (W)","Ôm (Ω)"],"answer":1},
         {"q":"Ổ cắm có nhiều thiết bị công suất lớn cùng lúc sẽ…","options":["Tiết kiệm điện","Dễ quá tải, cháy nổ","Không ảnh hưởng","Điện mạnh hơn"],"answer":1}]}$j$::jsonb, 'published'),
      (sch, tuan, 'race', 'Đường đua số — Phân số & tỉ lệ', 'Ôn phân số, tỉ lệ thức bằng đường đua; mỗi câu 20 giây.', 'Toán', '6,7', 'CT1',
       $j${"seconds":20,"items":[
         {"q":"3/4 của 20 là bao nhiêu?","options":["12","15","16","18"],"answer":1},
         {"q":"Phân số nào bằng 2/3?","options":["4/9","6/9","3/2","5/6"],"answer":1},
         {"q":"Tỉ lệ 1 : 100 000 trên bản đồ, 3 cm ứng với bao nhiêu km?","options":["0,3 km","3 km","30 km","300 km"],"answer":1},
         {"q":"0,25 viết dưới dạng phân số tối giản là","options":["25/100","1/4","2/5","1/25"],"answer":1}]}$j$::jsonb, 'published'),
      (sch, tuan, 'flashcard', 'Lật thẻ ghi nhớ — Linh kiện điện tử', 'Lật thẻ để ôn tên và công dụng linh kiện trước giờ lắp mạch.', 'Công nghệ', '8,9', 'CT4',
       $j${"cards":[{"front":"Điện trở","back":"Hạn chế dòng điện, bảo vệ LED"},{"front":"Tụ điện","back":"Tích và phóng điện, lọc nhiễu"},{"front":"Đi-ốt phát quang (LED)","back":"Phát sáng khi có dòng điện thuận chiều"},{"front":"Biến trở","back":"Thay đổi điện trở để chỉnh độ sáng, âm lượng"},{"front":"Cảm biến quang (LDR)","back":"Điện trở giảm khi ánh sáng mạnh"}]}$j$::jsonb, 'published'),
      (sch, tuan, 'flashcard', 'Lật thẻ ghi nhớ — Tế bào & cơ thể sống', 'Ôn khái niệm tế bào, mô, cơ quan.', 'Khoa học tự nhiên', '6,7', 'CT1',
       $j${"cards":[{"front":"Tế bào","back":"Đơn vị cấu trúc và chức năng của cơ thể sống"},{"front":"Màng tế bào","back":"Bao bọc, kiểm soát chất ra vào tế bào"},{"front":"Nhân tế bào","back":"Chứa vật chất di truyền, điều khiển hoạt động"},{"front":"Lục lạp","back":"Nơi quang hợp ở tế bào thực vật"}]}$j$::jsonb, 'published'),
      (sch, tuan, 'group', 'Nhiệm vụ phân loại — Dẫn điện hay cách điện?', 'Kéo từng vật liệu vào đúng nhóm.', 'Khoa học tự nhiên', '7,8', 'CT1',
       $j${"groups":[{"name":"Dẫn điện","items":["Đồng","Nhôm","Than chì","Nước muối"]},{"name":"Cách điện","items":["Nhựa","Sứ","Gỗ khô","Cao su"]}]}$j$::jsonb, 'published'),
      (sch, tuan, 'group', 'Nhiệm vụ phân loại — Rác tái chế xanh', 'Phân loại rác tại nguồn: tái chế, hữu cơ, còn lại.', 'Khoa học tự nhiên', '6,7', 'CT3',
       $j${"groups":[{"name":"Tái chế","items":["Chai nhựa","Lon nhôm","Giấy báo"]},{"name":"Hữu cơ","items":["Vỏ chuối","Lá cây","Bã chè"]},{"name":"Còn lại","items":["Túi ni lông bẩn","Khẩu trang","Pin cũ"]}]}$j$::jsonb, 'published'),
      (sch, tuan, 'match', 'Ghép cặp khái niệm — Máy cơ đơn giản', 'Ghép máy cơ với tác dụng của nó.', 'Vật lý', '8,9', 'CT2',
       $j${"pairs":[{"left":"Đòn bẩy","right":"Đổi điểm đặt, lợi về lực"},{"left":"Ròng rọc cố định","right":"Đổi hướng của lực kéo"},{"left":"Ròng rọc động","right":"Lợi hai lần về lực"},{"left":"Mặt phẳng nghiêng","right":"Đưa vật lên cao với lực nhỏ hơn"}]}$j$::jsonb, 'published'),
      (sch, tuan, 'wheel', 'Vòng quay may mắn — gọi tên học sinh', 'Quay để chọn ngẫu nhiên bạn lên bảng giải thích kết quả của nhóm.', 'STEM sáng tạo', '6,7,8,9', 'CT3',
       $j${"names":["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6"],"questions":["Vì sao nhóm em chọn vật liệu này?","Sản phẩm của nhóm cải tiến được điều gì?","Nếu làm lại, nhóm em sẽ thay đổi gì?"]}$j$::jsonb, 'published'),
      (sch, tuan, 'teams', 'Chia đội thi đấu STEM', 'Chia lớp thành các đội ngẫu nhiên trước khi thi.', 'STEM sáng tạo', '6,7,8,9', 'CT3',
       $j${"teams":4,"names":["An","Bình","Chi","Dũng","Giang","Hà","Khánh","Lan","Minh","Nam","Oanh","Phúc","Quân","Trang","Uyên","Vy"]}$j$::jsonb, 'published'),
      (sch, tuan, 'timer', 'Đồng hồ thử thách — đếm ngược', 'Đồng hồ lớn trên màn hình cho phần thi lắp ráp.', 'STEM sáng tạo', '6,7,8,9', 'CT4',
       $j${"seconds":300,"task":"Trong 5 phút, mỗi nhóm lắp xong mạch và bật được đèn LED."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng mạch điện nối tiếp', 'Học sinh kéo hiệu điện thế, tháo một bóng để thấy cả dãy cùng tắt.', 'Công nghệ', '7,8', 'CT4',
       $j${"model":"circuit_series","params":{"V":7.3,"R":5.8},"task":"Kéo thanh trượt hiệu điện thế và điện trở, bấm Ngắt công tắc để thấy cả hai bóng cùng tắt."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng mạch điện song song', 'So sánh độ sáng và dòng điện qua nguồn với mạch nối tiếp.', 'Công nghệ', '7,8', 'CT4',
       $j${"model":"circuit_parallel","params":{"V":6,"R":5.8},"task":"Cùng nguồn 6 V, hãy so sánh công suất mỗi bóng với mạch nối tiếp."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng con lắc đơn', 'Đổi chiều dài dây, bấm giờ 10 dao động.', 'Vật lý', '6,7,8,9', 'CT3',
       $j${"model":"pendulum","params":{"L":0.5},"task":"Đo thời gian 10 dao động với 3 chiều dài khác nhau, rút ra quy luật."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Mô phỏng đòn bẩy cân bằng', 'Đặt vật nặng hai bên điểm tựa để đòn bẩy nằm ngang.', 'Vật lý', '8,9', 'CT2',
       $j${"model":"lever","task":"Tìm 3 cách đặt vật để đòn bẩy cân bằng và ghi vào phiếu."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Giáo cụ ảo: Thước đo 20 cm', 'Kéo thanh đo đến đúng số đo yêu cầu.', 'Khoa học tự nhiên', '6', 'CT1',
       $j${"model":"ruler","params":{"target":12.5},"task":"Kéo mép phải thanh xanh sao cho chiều dài đúng 12,5 cm."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Giáo cụ ảo: Cân điện tử và TARE', 'Đặt quả cân cho đủ khối lượng, bấm TARE để hiểu ý nghĩa trừ bì.', 'Khoa học tự nhiên', '6', 'CT1',
       $j${"model":"scale","params":{"target":235},"task":"Đặt cốc lên cân, bấm TARE rồi thêm quả cân sao cho màn hình hiện đúng 235 g."}$j$::jsonb, 'published'),
      (sch, tuan, 'sim', 'Giáo cụ ảo: Nhiệt kế', 'Đọc nhiệt độ, đổi sang °F và K.', 'Khoa học tự nhiên', '6', 'CT1',
       $j${"model":"thermometer","params":{"target":37},"task":"Đưa nhiệt kế về nhiệt độ cơ thể người bình thường."}$j$::jsonb, 'published');
  end if;

  -- ===== 4. Bài giảng tương tác cho 3 bài mẫu của THCS Phố Hiến =====
  if sch is not null then
    perform set_config('app.lesson_engine', 'on', true);
    update lesson_plans set program = coalesce(program, 'CT4'), lesson = $j${
      "goals":["Phân biệt mạch nối tiếp và mạch song song qua mô phỏng","Giải thích vì sao tắt một bóng mà cả dãy đèn cùng tắt","Lắp và đo được mạch 1 nối tiếp + 1 song song, ghi số liệu vào phiếu"],
      "tags":["Có mô phỏng 2D","Có game hoá","Có đoạn code"],
      "phases":[
        {"key":"khoi_dong","title":"Khởi động","minutes":8,"blocks":[
          {"id":"m1","type":"heading","text":"Vì sao tắt 1 bóng mà cả dây đèn cùng tắt?"},
          {"id":"m2","type":"text","text":"Dịp Tết, nhà nào cũng treo **dây đèn nháy**. Có dây chỉ cần hỏng 1 bóng là tắt cả dây, có dây hỏng 1 bóng các bóng khác vẫn sáng.\nHôm nay chúng ta sẽ tìm ra nguyên nhân bằng một **mô phỏng mạch điện** ngay trên màn hình."},
          {"id":"m3","type":"sim","model":"circuit_series","title":"Mô phỏng: Mạch điện nối tiếp","task":"Kéo thanh trượt hiệu điện thế và điện trở, bấm Ngắt công tắc, rồi thử Tháo bóng 2.","params":{"V":7.3,"R":5.8}}]},
        {"key":"ly_thuyet","title":"Lý thuyết","minutes":12,"blocks":[
          {"id":"m4","type":"heading","text":"So sánh hai cách mắc bóng đèn"},
          {"id":"m5","type":"sim","model":"circuit_parallel","title":"Mô phỏng: Mạch điện song song","task":"Cùng nguồn 6 V, hãy so sánh công suất mỗi bóng với mạch nối tiếp.","params":{"V":6,"R":5.8}},
          {"id":"m6","type":"order","title":"Phân loại: đặc điểm của từng loại mạch","prompt":"Sắp xếp các bước kiểm tra một mạch đèn bị tắt theo đúng thứ tự.","steps":["Ngắt nguồn điện","Quan sát bóng nào hỏng","Thay bóng hỏng","Đóng nguồn và kiểm tra lại"]}]},
        {"key":"lap_rap","title":"Lắp ráp & Lập trình","minutes":40,"blocks":[
          {"id":"m7","type":"code","lang":"arduino_c","code":"const int PIN_A0 = A0;   // cảm biến dòng\nconst int NGUONG = 520;  // ngưỡng cảnh báo\n\nvoid loop() {\n  int doc = analogRead(PIN_A0);\n  if (doc > NGUONG) {\n    digitalWrite(LED_DO, HIGH);   // quá tải\n    tone(COI, 1200, 300);\n  } else {\n    digitalWrite(LED_DO, LOW);\n  }\n  delay(200);\n}"},
          {"id":"m8","type":"group","title":"Lắp và đo được 1 mạch nối tiếp + 1 mạch song song, ghi số liệu vào bảng","size":4,"minutes":25,"goal":"Lắp và đo được 1 mạch nối tiếp + 1 mạch song song, ghi số liệu vào bảng.","steps":["Nhận bộ kit, kiểm tra đủ linh kiện theo phiếu","Lắp mạch nối tiếp 2 bóng, đo U và I, ghi kết quả","Chuyển thành mạch song song, đo lại và so sánh","Nạp chương trình cảnh báo quá tải, thử nghiệm"],"roles":[{"role":"Trưởng nhóm","task":"Điều phối, giữ đúng thời gian"},{"role":"Kỹ thuật viên","task":"Lắp mạch theo sơ đồ"},{"role":"Thư ký","task":"Ghi số liệu đo vào phiếu"}]}]},
        {"key":"test_debug","title":"Test & Debug","minutes":20,"blocks":[
          {"id":"m9","type":"game","game":"timer","title":"Trò chơi: Đếm ngược sửa lỗi mạch","seconds":300,"task":"Mỗi nhóm nhận 1 mạch có lỗi cài sẵn — tìm và sửa trong 5 phút."}]},
        {"key":"danh_gia","title":"Đánh giá","minutes":10,"blocks":[
          {"id":"m10","type":"quiz","q":"Trong mạch nối tiếp gồm 2 bóng giống nhau mắc vào nguồn 6 V, hiệu điện thế trên mỗi bóng là bao nhiêu?","options":["3 V","6 V","12 V","1,5 V"],"answer":0,"explain":"Trong mạch nối tiếp, hiệu điện thế nguồn được chia đều cho các bóng giống nhau: 6 V ÷ 2 = 3 V."},
          {"id":"m11","type":"game","game":"wheel","title":"Vòng quay: Ai trả lời câu hỏi tổng kết?","note":"Quay để chọn ngẫu nhiên bạn lên bảng giải thích kết quả đo của nhóm mình.","names":["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6","Nhóm 7","Nhóm 8"],"questions":["Vì sao dây đèn Tết nhà em tắt cả khi hỏng 1 bóng?","Ở nhà em, các ổ cắm được mắc nối tiếp hay song song? Vì sao?"]},
          {"id":"m12","type":"rubric","title":"Rubric đánh giá","criteria":[
            {"name":"Lắp mạch đúng sơ đồ","weight":30,"levels":["Chưa lắp được","Lắp được, còn sai sót","Lắp đúng, gọn gàng","Lắp đúng và tối ưu dây"]},
            {"name":"Số liệu đo chính xác","weight":30,"levels":["Không có số liệu","Số liệu thiếu","Đủ và hợp lý","Chính xác, có nhận xét"]},
            {"name":"Giải thích nguyên lý","weight":25,"levels":["Chưa giải thích được","Giải thích sơ sài","Giải thích đúng","Liên hệ thực tế tốt"]},
            {"name":"Hợp tác nhóm","weight":15,"levels":["Không tham gia","Tham gia ít","Tích cực","Dẫn dắt nhóm"]}]}]}]}$j$::jsonb
     where org_id = sch and title like 'Mạch điện thông minh%' and lesson = '{}'::jsonb;

    update lesson_plans set program = coalesce(program, 'CT1'), lesson = $j${
      "goals":["Nêu được giới hạn đo (GHĐ) và độ chia nhỏ nhất (ĐCNN) của thước, cân điện tử, nhiệt kế","Đọc và ghi đúng số đo kèm đơn vị","Sắp xếp đúng thứ tự các bước của một quy trình đo lường"],
      "tags":["Có giáo cụ ảo","Có kéo-thả","Có bài tập","Không cần thiết bị"],
      "phases":[
        {"key":"khoi_dong","title":"Khởi động","minutes":7,"blocks":[
          {"id":"d1","type":"heading","text":"Ước lượng trước — đo sau"},
          {"id":"d2","type":"text","text":"Người làm khoa học luôn **ước lượng** trước khi đo. Nếu số đo lệch quá xa ước lượng, gần như chắc chắn ta đã đọc sai thang đo hoặc chọn sai dụng cụ. Hãy ước lượng chiều dài chiếc bút của em, sau đó **thử đo** bên dưới để kiểm tra."},
          {"id":"d3","type":"tool","model":"ruler","title":"Giáo cụ ảo: Thước đo 20 cm","task":"Kéo mép phải của thanh màu xanh sao cho chiều dài đúng 12,5 cm — sai số cho phép 0,3 cm.","params":{"target":12.5}}]},
        {"key":"kien_thuc","title":"Kiến thức mới","minutes":12,"blocks":[
          {"id":"d4","type":"heading","text":"Giới hạn đo (GHĐ) và độ chia nhỏ nhất (ĐCNN)"},
          {"id":"d5","type":"text","text":"- **GHĐ** là giá trị lớn nhất dụng cụ đo được. Vượt GHĐ — dụng cụ sai hoặc hỏng.\n- **ĐCNN** là khoảng cách giữa hai vạch chia liên tiếp. ĐCNN quyết định số chữ số được ghi trong kết quả.\n- Kết quả đo phải **luôn kèm đơn vị**: 12,5 cm — không viết \"12,5\"."},
          {"id":"d6","type":"tool","model":"scale","title":"Giáo cụ ảo: Cân điện tử và thao tác TARE","task":"Đặt các quả cân sao cho tổng khối lượng đúng 235 g. Thử bấm TARE để hiểu ý nghĩa \"trừ bì\".","params":{"target":235}}]},
        {"key":"luyen_tap","title":"Luyện tập","minutes":18,"blocks":[
          {"id":"d7","type":"order","title":"Sắp xếp quy trình đo khối lượng bằng cân điện tử","prompt":"Kéo 5 bước về đúng thứ tự thực hiện, rồi bấm \"Kiểm tra kết quả\".","steps":["Đặt cân trên mặt phẳng nằm ngang, chắc chắn","Bật cân, chờ màn hình hiện đúng số 0","Đặt vật cần cân vào giữa đĩa cân","Chờ số ổn định rồi mới đọc kết quả","Ghi kết quả kèm đơn vị đo vào phiếu"]},
          {"id":"d8","type":"tool","model":"thermometer","title":"Giáo cụ ảo: Nhiệt kế","task":"Trượt tới 37 °C — nhiệt độ cơ thể người bình thường. Quan sát số đo đổi sang °F và K.","params":{"target":37}}]},
        {"key":"van_dung","title":"Vận dụng STEM","minutes":8,"blocks":[
          {"id":"d9","type":"quiz","q":"Thước có GHĐ 20 cm và ĐCNN 1 mm. Kết quả nào được ghi ĐÚNG quy cách?","options":["12,5 cm","12,53 cm","12 cm 5","125"],"answer":0,"explain":"ĐCNN 1 mm = 0,1 cm nên kết quả có 1 chữ số thập phân theo cm và phải kèm đơn vị."},
          {"id":"d10","type":"text","text":"**Bài tập về nhà.** Đo và ghi lại 3 số liệu ở nhà, mỗi số liệu kèm dụng cụ đã dùng và đơn vị: 1. Chiều dài bàn học của em  2. Khối lượng cặp sách khi đã xếp đủ sách  3. Nhiệt độ nước máy vào buổi sáng. Ghi giá trị ước lượng trước khi đo để so sánh."}]}]}$j$::jsonb
     where org_id = sch and title like 'Đo lường trong phòng thí nghiệm%' and lesson = '{}'::jsonb;

    update lesson_plans set program = coalesce(program, 'CT3'), lesson = $j${
      "goals":["Tìm được mối liên hệ giữa chiều dài dây và chu kì con lắc","Thiết kế con lắc đếm đúng 1 giây","Trình bày sản phẩm và tự đánh giá theo rubric"],
      "tags":["Có mô phỏng 2D","Có game hoá"],
      "phases":[
        {"key":"kham_pha","title":"Khám phá","minutes":10,"blocks":[
          {"id":"p1","type":"heading","text":"Đồng hồ quả lắc đếm giờ thế nào?"},
          {"id":"p2","type":"text","text":"Đồng hồ quả lắc cổ chạy đúng nhờ **con lắc dao động đều**. Thử thách hôm nay: chế tạo con lắc có chu kì đúng **1 giây** từ dây và đai ốc."},
          {"id":"p3","type":"sim","model":"pendulum","title":"Mô phỏng: Con lắc đơn","task":"Đổi chiều dài dây, thả con lắc và bấm giờ 10 dao động.","params":{"L":0.5}}]},
        {"key":"y_tuong","title":"Ý tưởng","minutes":10,"blocks":[
          {"id":"p4","type":"quiz","q":"Muốn con lắc dao động CHẬM hơn, ta nên làm gì?","options":["Tăng chiều dài dây","Giảm chiều dài dây","Tăng khối lượng quả nặng","Thả từ góc nhỏ hơn"],"answer":0,"explain":"Chu kì T = 2π√(L/g) chỉ phụ thuộc chiều dài dây L (khi góc nhỏ), không phụ thuộc khối lượng."},
          {"id":"p5","type":"game","game":"wheel","title":"Vòng quay chọn nhóm nêu ý tưởng","names":["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6"],"questions":["Nhóm em dự đoán dây dài bao nhiêu thì chu kì 1 giây?"]}]},
        {"key":"thiet_ke","title":"Thiết kế","minutes":15,"blocks":[
          {"id":"p6","type":"text","text":"- Dùng mô phỏng tìm chiều dài dây cho chu kì ≈ 1 s (gợi ý: khoảng 25 cm).\n- Vẽ phác thảo: giá treo, dây, quả nặng, thước đo góc thả.\n- Lập bảng ghi 3 lần đo thời gian 10 dao động."}]},
        {"key":"lam_san_pham","title":"Làm sản phẩm","minutes":45,"blocks":[
          {"id":"p7","type":"group","title":"Chế tạo và hiệu chỉnh con lắc 1 giây","size":4,"minutes":35,"goal":"Con lắc có 10 dao động trong 10 ± 0,3 giây.","steps":["Lắp giá treo và buộc dây theo chiều dài dự kiến","Thả từ góc nhỏ, đo thời gian 10 dao động 3 lần","Điều chỉnh chiều dài, đo lại đến khi đạt yêu cầu"],"roles":[{"role":"Trưởng nhóm","task":"Điều phối và bấm giờ"},{"role":"Kỹ thuật","task":"Lắp, chỉnh chiều dài dây"},{"role":"Thư ký","task":"Ghi bảng số liệu"}]},
          {"id":"p8","type":"game","game":"timer","title":"Đồng hồ thử thách","seconds":600,"task":"10 phút cuối: hoàn thiện và đo lần chốt."}]},
        {"key":"trinh_bay","title":"Trình bày","minutes":10,"blocks":[
          {"id":"p9","type":"rubric","title":"Rubric sản phẩm con lắc","criteria":[
            {"name":"Độ chính xác chu kì","weight":40,"levels":["Sai > 1 s","Sai 0,5–1 s","Sai 0,3–0,5 s","Sai ≤ 0,3 s"]},
            {"name":"Bảng số liệu","weight":30,"levels":["Không có","Thiếu lần đo","Đủ 3 lần đo","Đủ, có tính trung bình"]},
            {"name":"Trình bày","weight":30,"levels":["Chưa rõ","Đọc lại số liệu","Giải thích được","Liên hệ đồng hồ thật"]}]}]}]}$j$::jsonb
     where org_id = sch and title like 'Thử thách con lắc%' and lesson = '{}'::jsonb;
    perform set_config('app.lesson_engine', '', true);
  end if;

  -- ===== 5. Nội dung từng buổi học của chương trình STEM (KDI) =====
  -- Mỗi buổi (hoặc bài học không chia buổi) chưa có nội dung nhận một bài giảng theo tiến trình của CT: tình huống, kiến thức, mô phỏng / giáo cụ ảo
  -- phù hợp chủ đề, hoạt động nhóm, câu hỏi củng cố và rubric. KDI sửa tiếp ở Chương trình giáo dục → Soạn nội dung buổi.
  alter table edu_program_units disable trigger user;
  for u in
    select s.id, s.title, s.objectives, s.content, s.periods, tp.title as topic, p.ct_code, p.title as prog, p.main_subject
      from edu_program_units s
      join edu_program_units tp on tp.unit_type = 'topic'
       and tp.id = case when s.unit_type = 'session' then (select x.parent_id from edu_program_units x where x.id = s.parent_id) else s.parent_id end
      join edu_programs p on p.id = s.program_id
     where (s.unit_type = 'session' or (s.unit_type = 'lesson' and not exists (select 1 from edu_program_units c where c.parent_id = s.id)))
       and p.kind = 'stem' and p.status = 'published' and s.lesson = '{}'::jsonb
       and p.org_id = public.platform_org_id()
  loop
    ct := coalesce(u.ct_code, 'CT1');
    topic := regexp_replace(u.topic, '^Chủ đề \d+\.\s*', '');
    obj := coalesce(nullif(btrim(u.objectives), ''), 'Học sinh vận dụng kiến thức của chủ đề "' || topic || '" để giải quyết một vấn đề thực tế.');
    sim := case
      when topic ~* 'mạch điện|pin|điện' then jsonb_build_object('type', 'sim', 'model', 'circuit_series', 'title', 'Mô phỏng: Mạch điện', 'task', 'Thay đổi hiệu điện thế, ngắt công tắc và quan sát độ sáng bóng đèn.')
      when topic ~* 'đo lường|đo chiều|cân' then jsonb_build_object('type', 'tool', 'model', 'ruler', 'title', 'Giáo cụ ảo: Thước đo', 'task', 'Kéo thanh đo đến đúng số đo yêu cầu.', 'params', jsonb_build_object('target', 12.5))
      when topic ~* 'nhiệt|mặt trời|thời tiết|quan trắc|nhà kính' then jsonb_build_object('type', 'tool', 'model', 'thermometer', 'title', 'Giáo cụ ảo: Nhiệt kế', 'task', 'Đọc nhiệt độ và đổi sang °F, K.', 'params', jsonb_build_object('target', 37))
      when topic ~* 'cầu|chịu lực|cánh tay|ném' then jsonb_build_object('type', 'sim', 'model', 'lever', 'title', 'Mô phỏng: Đòn bẩy cân bằng', 'task', 'Tìm vị trí đặt vật để đòn bẩy cân bằng.')
      when topic ~* 'con lắc|dao động' then jsonb_build_object('type', 'sim', 'model', 'pendulum', 'title', 'Mô phỏng: Con lắc đơn', 'task', 'Đổi chiều dài dây, đo chu kì.')
      else null end;
    flow := case ct
      when 'CT2' then '[["van_de","Xác định vấn đề",8],["kien_thuc_nen","Nghiên cứu kiến thức nền",10],["giai_phap","Đề xuất giải pháp",7],["che_tao","Chế tạo & thử nghiệm",15],["chia_se","Chia sẻ & đánh giá",5]]'
      when 'CT3' then '[["kham_pha","Khám phá",7],["y_tuong","Ý tưởng",8],["thiet_ke","Thiết kế",8],["lam_san_pham","Làm sản phẩm",15],["trinh_bay","Trình bày",7]]'
      when 'CT4' then '[["khoi_dong","Khởi động",5],["ly_thuyet","Lý thuyết",8],["lap_rap","Lắp ráp & Lập trình",17],["test_debug","Test & Debug",10],["danh_gia","Đánh giá",5]]'
      when 'CT5' then '[["cau_hoi","Đặt câu hỏi nghiên cứu",7],["gia_thuyet","Giả thuyết & thiết kế",8],["thi_nghiem","Thí nghiệm",15],["phan_tich","Phân tích dữ liệu",8],["bao_cao","Báo cáo",7]]'
      else '[["khoi_dong","Khởi động",5],["kien_thuc","Kiến thức mới",13],["luyen_tap","Luyện tập",18],["van_dung","Vận dụng STEM",9]]' end::jsonb;
    ph := '[]'::jsonb; k := 0;
    for i in 0 .. jsonb_array_length(flow) - 1 loop
      k := k + 1;
      blocks := case
        when i = 0 then jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', 'Giáo viên đưa ra một tình huống gần gũi liên quan đến "' || u.title || '" và hỏi cả lớp: "Em nhìn thấy gì? Em đoán vì sao lại như vậy?"' || chr(10) || 'Ghi nhanh các ý kiến của học sinh lên bảng, chưa kết luận đúng – sai.'),
          jsonb_build_object('type', 'game', 'game', 'wheel', 'title', 'Vòng quay chọn bạn chia sẻ dự đoán', 'names', '["Nhóm 1","Nhóm 2","Nhóm 3","Nhóm 4","Nhóm 5","Nhóm 6"]'::jsonb, 'questions', jsonb_build_array('Theo em, "' || topic || '" có ứng dụng gì trong đời sống?')))
        when i = 1 then jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', obj || coalesce(chr(10) || nullif(btrim(u.content), ''), '')))
          || case when sim is null then '[]'::jsonb else jsonb_build_array(sim) end
        when i = jsonb_array_length(flow) - 1 then jsonb_build_array(
          jsonb_build_object('type', 'quiz', 'q', 'Điều quan trọng nhất em rút ra sau buổi "' || u.title || '" là gì?',
            'options', jsonb_build_array('Kiến thức của chủ đề ' || topic, 'Cách làm việc nhóm hiệu quả', 'Cả hai ý trên', 'Không có gì mới'), 'answer', 2,
            'explain', 'Bài học STEM giúp em vừa nắm kiến thức vừa rèn kĩ năng hợp tác, giải quyết vấn đề.'),
          jsonb_build_object('type', 'rubric', 'title', 'Rubric đánh giá buổi học', 'criteria', '[
            {"name":"Hiểu kiến thức","weight":30,"levels":["Chưa nêu được","Nêu được một phần","Nêu đúng","Giải thích và vận dụng"]},
            {"name":"Sản phẩm / kết quả","weight":40,"levels":["Chưa hoàn thành","Hoàn thành một phần","Hoàn thành đúng yêu cầu","Sáng tạo, vượt yêu cầu"]},
            {"name":"Hợp tác nhóm","weight":30,"levels":["Ít tham gia","Tham gia","Tích cực","Dẫn dắt nhóm"]}]'::jsonb))
        when i = 2 then jsonb_build_array(
          jsonb_build_object('type', 'group', 'title', u.title, 'size', 4, 'minutes', (flow->i->>2)::int, 'goal', obj,
            'steps', jsonb_build_array('Nhận nhiệm vụ và phiếu học tập', 'Thảo luận, phân công vai trò', 'Thực hiện và ghi kết quả', 'Chuẩn bị chia sẻ trước lớp'),
            'roles', '[{"role":"Trưởng nhóm","task":"Điều phối, giữ thời gian"},{"role":"Thư ký","task":"Ghi kết quả vào phiếu"},{"role":"Báo cáo viên","task":"Trình bày trước lớp"}]'::jsonb))
        else jsonb_build_array(
          jsonb_build_object('type', 'order', 'title', 'Sắp xếp các bước thực hiện', 'prompt', 'Kéo các bước về đúng thứ tự nhóm em đã làm.',
            'steps', '["Xác định yêu cầu","Lên phương án","Thực hiện","Kiểm tra và cải tiến"]'::jsonb))
        end;
      -- gắn id cho từng khối
      select coalesce(jsonb_agg(b || jsonb_build_object('id', substr(md5(u.id::text || i || o), 1, 8)) order by o), '[]') into blocks
        from jsonb_array_elements(blocks) with ordinality x(b, o);
      ph := ph || jsonb_build_array(jsonb_build_object('key', flow->i->>0, 'title', flow->i->>1, 'minutes', (flow->i->>2)::int, 'blocks', blocks));
    end loop;
    update edu_program_units set lesson = jsonb_build_object('phases', ph, 'goals', jsonb_build_array(obj)) where id = u.id;
  end loop;
  alter table edu_program_units enable trigger user;
end $$;

select set_config('app.seed_demo', '', false);
notify pgrst, 'reload schema';
