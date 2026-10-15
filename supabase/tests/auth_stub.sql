-- Giả lập tối thiểu phần Supabase (vai trò anon/authenticated, auth.users, auth.uid()) để chạy migration trên Postgres thường.
do $r$ begin if not exists (select 1 from pg_roles where rolname=$q$anon$q$) then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $r$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default $j${}$j$::jsonb, email_confirmed_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $f$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
-- Bảng phiên và yếu tố 2FA (rút gọn) để kiểm thử 024
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now(), aal text default 'aal1', user_agent text, ip text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text default 'verified');
