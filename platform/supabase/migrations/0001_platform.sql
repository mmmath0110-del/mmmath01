-- =====================================================================
-- 0001 플랫폼 공통: 학원(테넌트) · 요금제 · 직원 계정 · 비밀값 · 감사 기록 · 사용량 · 문자 발송함
-- 모든 학원 데이터는 academies.id 를 academy_id 로 달고, 0003 의 RLS 가 학원끼리 막는다.
-- =====================================================================
create extension if not exists pgcrypto;

-- 화면(API)에 노출되지 않는 내부 스키마. 비밀값·옛 비밀번호 해시·권한 함수가 여기 있다.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- 요금제 ----------
create table public.plans (
  id            text primary key,                  -- 'trial' · 'basic' · 'pro'
  name          text not null,
  max_students  int,                               -- null = 제한 없음
  features      jsonb not null default '{}',       -- {"aiReport":true,"sms":true,...}
  monthly_price int not null default 0,            -- 원
  created_at    timestamptz not null default now()
);

-- ---------- 학원 ----------
create table public.academies (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),   -- 주소 abc.브랜드.kr 의 abc
  name          text not null,
  status        text not null default 'trial'
                check (status in ('trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled')),
  plan_id       text references public.plans(id),
  trial_ends_at timestamptz,
  timezone      text not null default 'Asia/Seoul',
  test_mode     boolean not null default true,     -- true 면 문자·알림톡을 실제로 보내지 않고 기록만 남긴다
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger academies_touch before update on public.academies for each row execute function app.touch_updated_at();

-- 학원 화면 설정 (학원명·로고·알림 문구·출결 규칙 등). 코드가 아니라 여기서 학원마다 다르게 한다
create table public.academy_settings (
  academy_id uuid primary key references public.academies(id) on delete cascade,
  brand      jsonb not null default '{}',          -- {"displayName":"더블엠수학학원","logoUrl":...}
  settings   jsonb not null default '{}',          -- 옛 settings 시트의 일반 설정 (travelBuffer, prorate, report* ...)
  updated_at timestamptz not null default now()
);
create trigger academy_settings_touch before update on public.academy_settings for each row execute function app.touch_updated_at();

-- 학원별 비밀값. app 스키마라 화면에서 절대 조회되지 않고, 서버 함수(service_role)만 읽는다
create table app.academy_secrets (
  academy_id    uuid primary key references public.academies(id) on delete cascade,
  sms_provider  text not null default '' check (sms_provider in ('', 'aligo', 'solapi')),
  sms_key       text,
  sms_secret    text,
  sms_user      text,
  sms_sender    text,
  sms_title     text,
  ai_key        text,
  kiosk_pin_hash text,                           -- 태블릿 등록용 관리자 PIN (옛 시스템은 시트에 평문 저장 → 해시로 바꿔 옮긴다)
  extra         jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);

-- ---------- 본사(플랫폼 운영자) ----------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- 직원 (원장·선생님) = 사람 계정(auth.users) × 학원 소속 ----------
-- 한 사람이 두 학원에서 일하면 같은 user_id 로 두 행이 생긴다.
create table public.staff (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,   -- 아직 첫 로그인 전이면 null
  login_id   text not null,                                        -- 학원 안에서의 아이디 (예: mmmath01)
  name       text not null,
  role       text not null check (role in ('admin', 'teacher')),
  color      text,
  active     boolean not null default true,
  phone      text,
  legacy_id  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, login_id),
  unique (academy_id, user_id)
);
create index staff_user_idx on public.staff(user_id) where active;
create trigger staff_touch before update on public.staff for each row execute function app.touch_updated_at();

-- 옛 시스템 비밀번호(솔트+SHA-256)·근무번호 해시. 첫 로그인 때 서버 함수가 이 값으로 확인한 뒤
-- Supabase Auth 계정을 만들고 이 행을 지운다. 화면에서는 조회되지 않는다.
create table app.staff_legacy_credentials (
  staff_id  uuid primary key references public.staff(id) on delete cascade,
  salt      text,
  pw_hash   text,
  pin_salt  text,
  pin_hash  text
);

-- ---------- 감사 기록 (누가 무엇을 보고 바꿨는지). 쓰기만 되고 고치거나 지울 수 없다 ----------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  academy_id uuid references public.academies(id) on delete cascade,
  at         timestamptz not null default now(),
  actor_user uuid,
  actor_staff uuid,
  action     text not null,          -- 'view_student' · 'update' · 'export' · 'impersonate' ...
  entity     text,
  entity_id  text,
  detail     jsonb not null default '{}'
);
create index audit_log_academy_at on public.audit_log(academy_id, at desc);

-- ---------- 사용량 (월별) · 청구 ----------
create table public.usage_monthly (
  academy_id uuid not null references public.academies(id) on delete cascade,
  month      date not null,                        -- 해당 월 1일
  sms_count  int not null default 0,
  sms_cost   int not null default 0,               -- 원
  ai_count   int not null default 0,
  primary key (academy_id, month)
);

create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  amount       int not null,
  status       text not null default 'issued' check (status in ('issued', 'paid', 'overdue', 'void')),
  method       text,
  paid_at      timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);

-- ---------- 문자 발송함 ----------
-- 모든 문자는 여기에 먼저 쌓이고 발송 작업이 보낸다. idempotency_key 가 같으면 두 번째 행은 들어가지 않으므로
-- 서버가 두 번 돌아도(병행 운영·재시도) 학부모에게 같은 문자가 두 번 가지 않는다.
create table public.sms_outbox (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id) on delete cascade,
  idempotency_key text not null,                   -- 예: 'att:2026-09-28:<studentId>:<classId>:parent'
  kind            text not null,                   -- 'attendance' · 'makeup_remind' · 'manual' · 'report' ...
  to_phone        text not null,
  body            text not null,
  status          text not null default 'queued'
                  check (status in ('queued', 'sending', 'sent', 'failed', 'test_skipped')),
  provider_msg_id text,
  error           text,
  created_by      uuid references public.staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (academy_id, idempotency_key)
);
create index sms_outbox_queue on public.sms_outbox(status, created_at) where status in ('queued', 'sending');

insert into public.plans (id, name, max_students, features, monthly_price) values
  ('trial', '무료 체험', null, '{"aiReport":true,"sms":true}', 0),
  ('basic', '베이직',    null, '{"aiReport":false,"sms":true}', 0),
  ('pro',   '프로',      null, '{"aiReport":true,"sms":true}', 0);   -- 금액은 요금 정책 확정 후 입력
