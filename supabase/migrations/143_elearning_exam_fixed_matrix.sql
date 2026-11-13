-- 143. Đề luyện e-learning: câu cố định + ma trận rút ngẫu nhiên trong cùng một đề
--  • Trước đây: đề "ma trận" (mode = 'random', criteria.matrix) bỏ qua question_ids khi học sinh bắt đầu làm.
--  • Nay: exam_start lấy câu cố định (question_ids) trước, rồi rút thêm theo ma trận, giống đề luyện của đào tạo nhà giáo.
do $$
declare d text; d0 text;
begin
  d := pg_get_functiondef('public.exam_start(uuid)'::regprocedure); d0 := d;
  d := replace(d, 'public.exam_pick_multi(e.org_id, e.subjects, e.grades, e.criteria -> ''matrix'', null, false)',
                  'public.exam_pick_multi(e.org_id, e.subjects, e.grades, e.criteria -> ''matrix'', e.question_ids, false)');
  if d = d0 and position('e.criteria -> ''matrix'', e.question_ids' in d) = 0 then
    raise exception '143: không sửa được exam_start';
  end if;
  if d <> d0 then execute d; end if;
end $$;
