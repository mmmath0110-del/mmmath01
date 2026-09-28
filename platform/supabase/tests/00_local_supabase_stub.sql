-- 로컬 PostgreSQL 에서 마이그레이션을 시험할 때만 쓴다. Supabase 에는 이미 있으므로 절대 올리지 않는다.
-- Supabase 의 auth 스키마·역할을 최소한으로 흉내 낸다.
-- 역할은 DB 클러스터 전체에 하나라 이미 있으면 건너뛴다
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
-- Supabase 의 auth.uid() 와 같은 방식: 요청 JWT 의 sub 클레임
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
