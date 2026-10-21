-- 068. TẠM TẮT DUYỆT cho nhóm "2. Chương trình & học liệu" (để thử tính năng)
--  • Bảng approval_bypass: mỗi dòng là một loại hồ sơ đang được TỰ DUYỆT — gửi duyệt xong là "Đã duyệt" ngay,
--    không vào Hộp phê duyệt, không báo người duyệt. Lịch sử duyệt ghi "Tự duyệt (đang tạm tắt duyệt)".
--  • Bật sẵn: Chương trình giáo dục (edu_program), Phân phối chương trình (curriculum_plan), Giáo án (lesson_plan).
--  • Giáo án: khi đang tự duyệt, giáo viên xuất bản thẳng (lesson_review_required = false).
--  • BẬT LẠI DUYỆT: chạy trong Supabase SQL Editor
--        delete from approval_bypass;                                  -- bật lại cho cả nhóm
--        delete from approval_bypass where kind = 'lesson_plan';       -- hoặc từng loại
--    Hồ sơ đã tự duyệt trước đó giữ nguyên "Đã duyệt"; hồ sơ gửi sau khi bật lại đi qua quy trình như cũ.
-- Cần chạy sau 067.

create table if not exists approval_bypass (
  kind text primary key check (kind in ('edu_program', 'curriculum_plan', 'lesson_plan')),
  note text,
  created_at timestamptz not null default now()
);
alter table approval_bypass enable row level security;  -- không có policy: chỉ đọc / sửa bằng SQL Editor và hàm hệ thống
revoke all on approval_bypass from anon, authenticated;

insert into approval_bypass (kind, note) values
  ('edu_program', 'Tạm tắt duyệt để thử tính năng'),
  ('curriculum_plan', 'Tạm tắt duyệt để thử tính năng'),
  ('lesson_plan', 'Tạm tắt duyệt để thử tính năng')
on conflict (kind) do nothing;

-- Duyệt ngay mọi bước của một hồ sơ đang chờ và đưa bản ghi gốc về "Đã duyệt"
create or replace function public.approval_autopass(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r approval_requests;
begin
  select * into r from approval_requests where id = p_request and status = 'pending' for update;
  if r.id is null then return; end if;
  insert into approval_actions (request_id, step_no, actor, decision, note)
    values (r.id, jsonb_array_length(r.steps), auth.uid(), 'approve', 'Tự duyệt (đang tạm tắt duyệt)');
  update approval_requests set status = 'approved', current_step = jsonb_array_length(r.steps), decided_at = now() where id = r.id;
  perform set_config('app.approval_engine', 'on', true);
  execute format('update %I set status = ''approved'' where id = $1 and status = ''pending''', r.ref_table) using r.ref_id;
  perform set_config('app.approval_engine', 'off', true);
end $$;
revoke execute on function public.approval_autopass(uuid) from public, anon, authenticated;

-- Tạo hồ sơ khi bản ghi chuyển sang "chờ duyệt" (như 022) + tự duyệt nếu loại hồ sơ đang tạm tắt duyệt
create or replace function public.approval_open(p_org uuid, p_kind text, p_table text, p_ref uuid, p_title text, p_summary text, p_by uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_wf uuid; v_id uuid;
begin
  update approval_requests set status = 'cancelled', decided_at = now() where ref_table = p_table and ref_id = p_ref and status = 'pending';
  v_wf := public.approval_effective_workflow(p_org, p_kind);
  insert into approval_requests (org_id, kind, ref_table, ref_id, title, summary, requested_by, workflow_id, steps)
    values (p_org, p_kind, p_table, p_ref, p_title, p_summary, p_by, v_wf, public.approval_build_steps(p_org, p_kind, v_wf))
    returning id into v_id;
  if exists (select 1 from approval_bypass where kind = p_kind) then
    perform public.approval_autopass(v_id);
  else
    perform public.approval_notify_step(v_id);
  end if;
  return v_id;
end $$;

-- Giáo án: đang tạm tắt duyệt → giáo viên xuất bản thẳng
create or replace function public.lesson_review_required(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.approval_effective_workflow(p_org, 'lesson_plan') is not null
     and not exists (select 1 from approval_bypass where kind = 'lesson_plan')
$$;

-- Hồ sơ đang chờ duyệt của các loại trên: duyệt luôn
do $$
declare v uuid;
begin
  for v in select r.id from approval_requests r join approval_bypass b on b.kind = r.kind where r.status = 'pending' loop
    perform public.approval_autopass(v);
  end loop;
end $$;
