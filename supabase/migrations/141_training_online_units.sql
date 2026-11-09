-- 141: Cột "Học trực tuyến" chỉ đếm nội dung có phần học trực tuyến (09/11/2026).
--  Nội dung không có bài giảng, tài liệu, bài kiểm tra (chỉ học trực tiếp) vẫn tính là xong như trước, nhưng không
--  còn hiện "2/2" ở cột Học trực tuyến: training_result_metrics trả thêm online_units / online_done.
-- Cần chạy sau 140.
do $$
declare d text; f text := 'public.training_result_metrics(uuid,uuid)';
begin
  d := pg_get_functiondef(f::regprocedure);
  if position('online_units' in d) = 0 then
    d := replace(d, 'declare v_s int;', 'declare v_ou int; v_od int; v_s int;');
    d := replace(d, '), 2)
    into v_units, v_done, v_tests, v_tp, v_avg, v_tavg', '), 2),
         count(*) filter (where cardinality(public.training_unit_keys(x.detail)) > 0 or public.training_unit_test_on(x.unit_id)),
         count(*) filter (where (cardinality(public.training_unit_keys(x.detail)) > 0 or public.training_unit_test_on(x.unit_id))
                            and public.training_unit_done(p_plan, x.unit_id, p_teacher))
    into v_units, v_done, v_tests, v_tp, v_avg, v_tavg, v_ou, v_od');
    d := replace(d, '''units'', v_units, ''done'', v_done,', '''units'', v_units, ''done'', v_done, ''online_units'', v_ou, ''online_done'', v_od,');
    if position('v_ou, v_od' in d) = 0 or position('''online_units'', v_ou' in d) = 0 or position('declare v_ou' in d) = 0 then
      raise exception '141: không sửa được %', f;
    end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
