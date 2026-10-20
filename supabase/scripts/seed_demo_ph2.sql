-- Dữ liệu mẫu đầy đủ cho Phân hệ 2 (Chương trình giáo dục, Học liệu & định mức, Phân phối chương trình,
-- Soạn bài giảng & kho hoạt động, Theo dõi CT1–CT5, E-learning & luyện thi) trên CSDL demo.
-- Dùng cho CSDL đã có dữ liệu mẫu cũ (THCS Phố Hiến, Sở GD&ĐT Hưng Yên, 21 trường) nhưng các migration 057–061 chạy qua CI
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
  if kdi is null or exists (select 1 from edu_programs where org_id = kdi and code = 'STEM-CT1') then return; end if;

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

select set_config('app.seed_demo', '', false);
notify pgrst, 'reload schema';
