-- 121. Làm thử đề (giống "Chơi thử" ở Kho hoạt động): người soạn đề rút một đề theo đúng cấu hình đang soạn, làm thử,
--      xem điểm, đáp án, lời giải và cơ cấu đề (mức độ, chủ đề) để điều chỉnh. Không ghi lượt làm, không tính điểm.
--  • exam_preview(p_org, p_spec) dùng cho mọi loại đề:
--      Phân hệ 1: bài test nội dung (chọn câu, rút ngẫu nhiên số câu mỗi lượt), đề cuối khoá, đề luyện (ma trận + câu chọn sẵn);
--      Phân hệ 2: đề luyện / đề kiểm tra môn học (cố định, ngẫu nhiên theo mức độ, ma trận).
--  • p_spec.kind:
--      'sample' — {qids, count}: rút ngẫu nhiên count câu trong qids (bài test nội dung)
--      'pick'   — {subject, grade, matrix, qids, shuffle}: như exam_pick (đề cuối khoá, đề luyện, đề cố định / ma trận)
--      'levels' — {subject, grade, count, levels, topics}: ngẫu nhiên theo mức độ (đề luyện Phân hệ 2 kiểu cũ)
--  • Trả về câu hỏi kèm đáp án và lời giải; chỉ cán bộ của đơn vị (như exam_bank_stats).
-- Cần chạy sau 120.

create or replace function public.exam_preview(p_org uuid, p_spec jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_kind text := coalesce(p_spec ->> 'kind', 'pick'); v_q uuid[] := '{}'; v_ids uuid[]; v_n int; k text; v_need int;
        v_subject text := nullif(btrim(p_spec ->> 'subject'), ''); v_grade int;
begin
  if not (public.is_platform_admin() or (public.is_staff() and public.can_access_org(p_org))) then
    raise exception 'Không có quyền làm thử đề của đơn vị này' using errcode = '42501';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or length(p_spec::text) > 50000 then
    raise exception 'Cấu hình đề không hợp lệ' using errcode = '22023';
  end if;
  v_grade := case when (p_spec ->> 'grade') ~ '^\d{1,2}$' then (p_spec ->> 'grade')::int end;
  v_ids := array(select x::uuid from jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'qids') = 'array' then p_spec -> 'qids' else '[]'::jsonb end) x
                  where x ~* '^[0-9a-f-]{36}$' limit 500);
  if v_kind = 'sample' then
    v_n := least(coalesce(case when (p_spec ->> 'count') ~ '^\d+$' then (p_spec ->> 'count')::int end, 200), 200);
    v_q := array(select q.id from question_bank q where q.id = any(v_ids) and q.status <> 'retired' order by random() limit v_n);
  elsif v_kind = 'levels' then
    v_n := least(coalesce(case when (p_spec ->> 'count') ~ '^\d+$' then (p_spec ->> 'count')::int end, 0), 200);
    for k, v_need in select key, value::int from jsonb_each_text(case when jsonb_typeof(p_spec -> 'levels') = 'object' then p_spec -> 'levels' else '{}'::jsonb end)
                      where value ~ '^\d{1,3}$' loop
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and q.level = k and public.bank_usable(q.org_id, q.shared, p_org)
          and (v_subject is null or q.subject = v_subject) and (v_grade is null or q.grade = v_grade)
          and (coalesce(jsonb_array_length(case when jsonb_typeof(p_spec -> 'topics') = 'array' then p_spec -> 'topics' end), 0) = 0
               or q.topic in (select jsonb_array_elements_text(p_spec -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_need);
    end loop;
    if cardinality(v_q) < v_n then
      v_q := v_q || array(select q.id from question_bank q
        where q.status = 'ready' and public.bank_usable(q.org_id, q.shared, p_org)
          and (v_subject is null or q.subject = v_subject) and (v_grade is null or q.grade = v_grade)
          and (coalesce(jsonb_array_length(case when jsonb_typeof(p_spec -> 'topics') = 'array' then p_spec -> 'topics' end), 0) = 0
               or q.topic in (select jsonb_array_elements_text(p_spec -> 'topics')))
          and not q.id = any(v_q)
        order by random() limit v_n - cardinality(v_q));
    end if;
    v_q := v_q[1:v_n];
  else
    if not public.exam_matrix_ok(p_spec -> 'matrix') then raise exception 'Ma trận đề không hợp lệ' using errcode = '22023'; end if;
    v_q := public.exam_pick(p_org, v_subject, v_grade, p_spec -> 'matrix', v_ids, coalesce((p_spec ->> 'shuffle')::boolean, false));
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'stem', q.stem, 'options', q.options, 'kind', q.kind, 'answer', q.answer,
                                                       'explain', q.explain, 'topic', q.topic, 'level', q.level, 'subject', q.subject, 'grade', q.grade) order by o.n)
                     from unnest(v_q) with ordinality o(qid, n) join question_bank q on q.id = o.qid
                    where public.bank_usable(q.org_id, q.shared, p_org) or public.is_platform_admin() or public.can_access_org(q.org_id)), '[]'::jsonb);
end $$;
revoke all on function public.exam_preview(uuid, jsonb) from public, anon;
grant execute on function public.exam_preview(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
