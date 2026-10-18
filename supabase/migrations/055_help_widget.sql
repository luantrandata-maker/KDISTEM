-- 055: Nút trợ giúp góc phải màn hình — hỏi đáp cách dùng hệ thống bằng AI (tác vụ 'help') và gửi yêu cầu hỗ trợ cho KDI.
--  • Tác vụ 'help' dùng chung cấu hình / hạn mức của Trợ lý AI; KDI chọn cho mọi vai trò hay chỉ các cổng của Trợ lý AI (help_all_roles).
--  • Mọi người dùng (kể cả học sinh, phụ huynh) gửi được yêu cầu hỗ trợ qua help_ticket(); người gửi xem và trả lời phiếu của mình.

alter table ai_settings add column if not exists help_all_roles boolean not null default true;

alter table ai_usage drop constraint if exists ai_usage_task_check;
alter table ai_usage add constraint ai_usage_task_check check (task in ('lesson','quiz','comment','document','chat','help'));

-- Trạng thái hỏi đáp trợ giúp cho người đang đăng nhập
create or replace function public.ai_help_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st jsonb := public.ai_status(); s ai_settings;
begin
  select * into s from ai_settings where id = 1;
  if s.help_all_roles and auth.uid() is not null then
    st := st || jsonb_build_object('allowed', true);
    if st ->> 'reason' = 'Vai trò của bạn không dùng trợ lý AI.' then st := st || jsonb_build_object('reason', null); end if;
  end if;
  return st;
end $$;

create or replace function public.ai_begin(p_task text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st jsonb;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập' using errcode = '42501'; end if;
  if p_task is null or p_task not in ('lesson','quiz','comment','document','chat','help') then raise exception 'Tác vụ không hợp lệ' using errcode = '22023'; end if;
  st := case when p_task = 'help' then public.ai_help_status() else public.ai_status() end;
  if st ->> 'reason' is not null then
    raise exception '%', st ->> 'reason' using errcode = case when (st ->> 'allowed')::boolean then 'P0001' else '42501' end;
  end if;
  return st || jsonb_build_object('org_id', public.my_org_id(), 'user_id', auth.uid());
end $$;
revoke all on function public.ai_help_status() from public, anon;
grant execute on function public.ai_help_status() to authenticated;

-- Người gửi phiếu luôn xem được phiếu của mình và trả lời (học sinh / phụ huynh không có quyền xem phiếu của cả trường)
drop policy if exists support_tickets_read_own on support_tickets;
create policy support_tickets_read_own on support_tickets for select to authenticated using (reported_by = auth.uid());
drop policy if exists support_tickets_update_own on support_tickets;
create policy support_tickets_update_own on support_tickets for update to authenticated using (reported_by = auth.uid()) with check (reported_by = auth.uid());

-- Gửi yêu cầu hỗ trợ từ nút trợ giúp: mọi người dùng đã đăng nhập, phiếu thuộc đơn vị đang làm việc
create or replace function public.help_ticket(p_subject text, p_description text, p_category text default 'technical', p_priority text default 'normal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); t support_tickets; v_recent int;
begin
  if auth.uid() is null or v_org is null then raise exception 'Chưa đăng nhập' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_subject, ''))) < 3 then raise exception 'Nhập tiêu đề yêu cầu' using errcode = '22023'; end if;
  if length(coalesce(p_description, '')) > 8000 then raise exception 'Nội dung quá dài' using errcode = '22023'; end if;
  if p_category not in ('technical','account','content','equipment','billing','other') then p_category := 'other'; end if;
  -- Học sinh / phụ huynh không đặt mức khẩn; chống gửi dồn dập
  if not public.is_staff() then p_priority := 'normal'; elsif p_priority not in ('low','normal','high','urgent') then p_priority := 'normal'; end if;
  select count(*) into v_recent from support_tickets where reported_by = auth.uid() and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'Bạn vừa gửi nhiều yêu cầu — vui lòng chờ KDI phản hồi' using errcode = '22023'; end if;
  insert into support_tickets (org_id, category, priority, subject, description)
    values (v_org, p_category, p_priority, left(btrim(p_subject), 200), nullif(btrim(p_description), ''))
    returning * into t;
  return jsonb_build_object('id', t.id, 'code', t.code, 'due_at', t.due_at);
end $$;
revoke all on function public.help_ticket(text, text, text, text) from public, anon;
grant execute on function public.help_ticket(text, text, text, text) to authenticated;
