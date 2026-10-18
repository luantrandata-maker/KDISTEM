-- 054: Trợ lý AI dùng được nhiều nhà cung cấp — Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini).
-- KDI chọn nhà cung cấp chính + mô hình, và một nhà cung cấp dự phòng (dùng khi nhà cung cấp chính hết hạn mức / lỗi).
-- Khoá API là secret của Supabase: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY (không nằm trong CSDL).

alter table ai_settings drop constraint if exists ai_settings_model_check;
alter table ai_settings add column if not exists provider text not null default 'anthropic';
alter table ai_settings add column if not exists fallback_provider text;
alter table ai_settings add column if not exists fallback_model text;
-- Đơn giá tham khảo để ước tính chi phí: {"<mô hình>": [USD vào, USD ra] / 1 triệu token}
alter table ai_settings add column if not exists prices jsonb not null default '{"claude-sonnet-5-5":[2,10],"claude-haiku-5-5":[0.1,0.5],"claude-opus-5-5":[4,20]}'::jsonb;

alter table ai_settings drop constraint if exists ai_settings_provider_check;
alter table ai_settings add constraint ai_settings_provider_check check (provider in ('anthropic','openai','gemini'));
alter table ai_settings drop constraint if exists ai_settings_fallback_check;
alter table ai_settings add constraint ai_settings_fallback_check check (
  (fallback_provider is null and fallback_model is null)
  or (fallback_provider in ('anthropic','openai','gemini') and fallback_model is not null and fallback_model ~ '^[A-Za-z0-9._:/-]{1,100}$'));
alter table ai_settings drop constraint if exists ai_settings_model_format;
alter table ai_settings add constraint ai_settings_model_format check (model ~ '^[A-Za-z0-9._:/-]{1,100}$');
alter table ai_settings drop constraint if exists ai_settings_prices_check;
alter table ai_settings add constraint ai_settings_prices_check check (jsonb_typeof(prices) = 'object');

alter table ai_usage add column if not exists provider text;
update ai_usage set provider = 'anthropic' where provider is null and model like 'claude-%';

-- Trạng thái trợ lý: thêm nhà cung cấp đang dùng (giao diện hiện tên)
create or replace function public.ai_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s ai_settings; l ai_org_limits; v_org uuid := public.my_org_id(); v_quota int; v_used_org int; v_used_me int; v_allowed boolean;
begin
  select * into s from ai_settings where id = 1;
  select * into l from ai_org_limits where org_id = v_org;
  v_quota := coalesce(l.monthly_quota, s.org_monthly_quota);
  select count(*) into v_used_org from ai_usage where org_id = v_org and ok and created_at >= date_trunc('month', now());
  select count(*) into v_used_me from ai_usage where user_id = auth.uid() and ok and created_at >= date_trunc('day', now());
  v_allowed := public.is_platform_admin() or public.my_portals() && s.portals;
  return jsonb_build_object(
    'enabled', s.enabled and coalesce(l.enabled, true), 'allowed', v_allowed, 'model', s.model, 'provider', s.provider,
    'fallback_provider', s.fallback_provider, 'fallback_model', s.fallback_model,
    'org_quota', v_quota, 'org_used', v_used_org, 'user_quota', s.user_daily_quota, 'user_used', v_used_me,
    'reason', case when not s.enabled then 'Trợ lý AI chưa được KDI bật.'
                   when not coalesce(l.enabled, true) then 'Trợ lý AI đang tắt cho đơn vị của bạn.'
                   when not v_allowed then 'Vai trò của bạn không dùng trợ lý AI.'
                   when v_used_org >= v_quota then 'Đơn vị đã dùng hết lượt của tháng này.'
                   when v_used_me >= s.user_daily_quota then 'Bạn đã dùng hết lượt hôm nay.'
              end);
end $$;
