-- ============================================================
-- 학원관리 플랫폼 DB 설치 (자동 생성 파일 · 직접 고치지 말 것 · scripts/build-setup.sh)
-- Supabase → SQL Editor → New query 에 전체를 붙여넣고 Run.
-- 한 번에 전부 설치되거나, 오류가 나면 아무것도 설치되지 않는다.
-- ============================================================
begin;
-- 한글 깨짐 검사: 파일을 잘못된 인코딩으로 열어 복사하면 아래 '한글' 이 깨져 설치를 멈춘다 (U&'\D55C\AE00' = 한글)
do $$ begin
  if '한글' <> U&'\D55C\AE00' then
    raise exception 'STOP: Korean text is broken (encoding). Copy the file again from the GitHub link in Chrome.';
  end if;
end $$;
do $$ begin
  if to_regclass('public.academies') is not null then
    raise exception '이미 설치된 DB 입니다. 다시 실행하지 않아도 됩니다.';
  end if;
end $$;

-- >>>>> supabase/migrations/0001_platform.sql
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

-- >>>>> supabase/migrations/0002_academy_data.sql
-- =====================================================================
-- 0002 학원 데이터. 옛 구글 시트 탭 1개 = 테이블 1개 (이름은 snake_case)
-- 공통: id uuid · academy_id (학원) · legacy_id (옛 시트의 id, 이관·대조용. 학원 안에서 유일)
-- 날짜는 date, 시각은 time, 금액은 int(원), JSON 으로 쓰던 칸은 jsonb, 콤마 목록은 배열로 바꾼다.
-- =====================================================================

-- 학생 (students)
create table public.students (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  legacy_id    text,
  name         text not null,
  status       text not null default '재원',         -- 재원 · 휴원 · 퇴원 · 대기
  school       text,
  grade        text,
  birth        date,
  phone        text,
  parent_phone text,
  parent_name  text,
  enrolled_at  date,
  left_at      date,
  memo         text,
  ext_id       text,                                -- 학생관리부의 학생ID (예: S0113)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create index students_academy_status on public.students(academy_id, status);
create index students_parent_phone on public.students(academy_id, right(parent_phone, 4));   -- 태블릿 뒷자리 검색

-- 반 (classes)
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  name        text not null,
  subject     text,
  teacher_id  uuid references public.staff(id) on delete set null,
  days        text,                                  -- '월,목'
  start_time  time,
  end_time    time,
  room        text,
  fee         int,
  status      text not null default '운영',
  memo        text,
  schedule    text,                                  -- 요일별 시간이 다를 때 '월 15:30-17:00, 목 ...'
  textbook    text,
  progress    text,
  lesson_note text,
  kind        text,                                  -- 정규 · 선행 · 특강 ...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create index classes_teacher on public.classes(academy_id, teacher_id);

-- 수강 등록 (enrollments)
create table public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  student_id  uuid not null references public.students(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  start_date  date,
  end_date    date,
  fee         int,
  end_reason  text,
  deleted     boolean not null default false,        -- 소프트 삭제
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff(id) on delete set null,
  unique (academy_id, legacy_id)
);
create index enrollments_student on public.enrollments(academy_id, student_id);
create index enrollments_class on public.enrollments(academy_id, class_id);

-- 출결 (attendance): 날짜 × 반 × 학생 = 1행
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date not null,
  class_id    uuid references public.classes(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  status      text not null,
  note        text,
  updated_by  text,                                  -- 옛 기록은 아이디 문자열
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id),
  unique (academy_id, date, class_id, student_id)
);
create index attendance_date on public.attendance(academy_id, date);

-- 등·하원 (checkins, 태블릿)
create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date not null,
  time        time not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  kind        text not null,                         -- 등원 · 하원
  class_id    uuid references public.classes(id) on delete set null,
  device      text,
  sms         text,                                  -- 학부모 알림 결과
  created_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create index checkins_date on public.checkins(academy_id, date);

-- 수납 (payments)
create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  month       text,                                  -- 청구월 'YYYY-MM'
  item        text,
  amount      int not null,
  method      text,
  class_id    uuid references public.classes(id) on delete set null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create index payments_student on public.payments(academy_id, student_id);
create index payments_month on public.payments(academy_id, month);

-- 시험 (exams) · 점수 (scores)
create table public.exams (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date,
  class_ids   uuid[] not null default '{}',          -- 옛 classIds(콤마) + classId(단일)
  name        text not null,
  max_score   numeric,
  memo        text,
  questions   jsonb,                                 -- [{n,unit,type,pts}]
  mode        text,                                  -- '' · q · parts · total
  obj_max     numeric,
  essay_max   numeric,
  created_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create table public.scores (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  exam_id     uuid not null references public.exams(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  score       numeric,                               -- null = 응시자 등록만 되고 미입력
  note        text,
  class_id    uuid references public.classes(id) on delete set null,
  wrong       jsonb,                                 -- [{n,kind}]
  parts       jsonb,                                 -- [{n,got}]
  obj         numeric,
  essay       numeric,
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id),
  unique (exam_id, student_id)
);
create index scores_student on public.scores(academy_id, student_id);

-- 주간 리포트 (reports)
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  student_id  uuid not null references public.students(id) on delete cascade,
  week_start  date not null,
  week_end    date not null,
  status      text not null default 'draft',         -- draft · approved · sent
  body        text,
  data        jsonb,
  created_at  timestamptz not null default now(),
  created_by  text,
  approved_by text,
  approved_at timestamptz,
  sent_at     timestamptz,
  sms         text,
  model       text,
  unique (academy_id, legacy_id)
);

-- 상담 (consults): 재원생 상담 + 신규 문의(student_id 없음)
create table public.consults (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date not null,
  time        time,
  type        text,
  student_id  uuid references public.students(id) on delete set null,
  name        text,
  phone       text,
  school      text,
  grade       text,
  content     text,
  next_date   date,
  member_id   uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);

-- 문자 발송 기록 (messages) — 옛 기록. 새 발송은 sms_outbox 로 한다
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  sent_at     timestamptz not null,
  kind        text,
  count       int,
  recipients  text,
  body        text,
  method      text,
  result      text,
  sent_by     text,
  unique (academy_id, legacy_id)
);
create index messages_sent_at on public.messages(academy_id, sent_at desc);

-- 교재 (textbooks)
create table public.textbooks (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  name        text not null,
  subject     text,
  grade       text,
  created_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);

-- 학생 외부 일정 (extSchedules) · 일정 입력 링크 (scheduleLinks)
create table public.ext_schedules (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  student_id  uuid not null references public.students(id) on delete cascade,
  name        text,
  day         text,
  start_time  time,
  end_time    time,
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
-- 링크 토큰은 원문 대신 SHA-256 해시만 저장한다. 이미 학부모에게 보낸 링크도 같은 해시로 찾으므로 계속 열린다
create table public.schedule_links (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  token_hash   text not null unique,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  submitted_at timestamptz,
  unique (academy_id, student_id)
);

-- 학원별 기타 상태값 (옛 settings 시트 중 비밀이 아닌 상태 JSON: rosterSync 등)
create table public.academy_kv (
  academy_id  uuid not null references public.academies(id) on delete cascade,
  key         text not null,
  value       jsonb,
  primary key (academy_id, key)
);

-- 수강·반 변경 이력 (changes)
create table public.changes (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  at          timestamptz not null,
  member_id   text,
  member_name text,
  type        text,
  student_id  uuid references public.students(id) on delete set null,
  class_id    uuid references public.classes(id) on delete set null,
  before      text,
  after       text,
  note        text,
  unique (academy_id, legacy_id)
);

-- 보강 일정 (makeups) · 보강 요청 (mkRequests)
create table public.makeups (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  legacy_id    text,
  date         date not null,
  start_time   time,
  end_time     time,
  class_id     uuid references public.classes(id) on delete set null,
  teacher_id   uuid references public.staff(id) on delete set null,
  student_ids  uuid[] not null default '{}',
  title        text,
  reason       text,
  memo         text,
  status       text,
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  deleted      boolean not null default false,
  deleted_at   timestamptz,
  deleted_by   text,
  reminded_at  timestamptz,
  unique (academy_id, legacy_id)
);
create index makeups_date on public.makeups(academy_id, date);
create table public.mk_requests (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  created_at  timestamptz not null default now(),
  teacher_id  uuid references public.staff(id) on delete set null,
  names       text,
  date        date,
  start_time  time,
  end_time    time,
  title       text,
  note        text,
  status      text not null default '대기',          -- 대기 · 처리 · 반려
  handled_by  text,
  handled_at  timestamptz,
  makeup_id   uuid references public.makeups(id) on delete set null,
  reply       text,
  unique (academy_id, legacy_id)
);

-- ---------- 원장실 (원장 전용) ----------
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date not null,
  end_date    date,
  type        text,
  title       text,
  target      text,
  note        text,
  school      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create index events_date on public.events(academy_id, date);
create table public.tests (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date,
  title       text,
  type        text,
  target      text,
  teacher     text,
  scope       text,
  note        text,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create table public.supplies (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  name        text not null,
  category    text,
  qty         numeric,
  min_qty     numeric,
  unit        text,
  last_in     date,
  vendor      text,
  note        text,
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
create table public.issues (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  category    text,
  target      text,
  detail      text,
  action      text,
  priority    text,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
-- 기록카드: 성향·방향성·진로 (학생 1명 = 1행)
create table public.student_profiles (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  attitude text, homework text, style text, strength text, weakness text, mental text, peer text, parent text, trait_memo text,
  policy text, roadmap text, next_step text, risk text, risk_why text, watch text,
  track text, adm_type text, univ1 text, major1 text, univ2 text, major2 text,
  target_inner text, cur_inner text, target_mock text, cur_mock text, career_memo text,
  updated_at   timestamptz not null default now(),
  unique (academy_id, student_id)
);
-- 기록카드: 내신·모의고사·과제 성적. 값 형식이 제각각('96~100점' 등)이라 옛 값을 그대로 text 로 보존한다
create table public.gradebook (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  student_id  uuid not null references public.students(id) on delete cascade,
  kind text, date date, year text, term text, exam text, subject text,
  score text, avg text, rank text, total text, level text, weak text, note text,
  org text, round text, raw text, std text, pct text, type text, scope text, max text, submit text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
-- 개별 청구 (특강·교재비)
create table public.bills (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  student_id  uuid not null references public.students(id) on delete cascade,
  kind        text,
  course      text,
  term        text,
  teacher     text,
  billed      int not null default 0,
  discount    int not null default 0,
  paid        int not null default 0,
  status      text,
  method      text,
  paid_at     date,
  handler     text,
  note        text,
  payment_id  uuid references public.payments(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);

-- ---------- 미출결 자동 확인 ----------
create table public.att_checks (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id) on delete cascade,
  legacy_id       text,
  date            date not null,
  student_id      uuid not null references public.students(id) on delete cascade,
  student_name    text,
  class_id        uuid references public.classes(id) on delete set null,
  class_name      text,
  makeup_id       uuid references public.makeups(id) on delete set null,
  teacher_id      uuid references public.staff(id) on delete set null,
  due             time,
  status          text not null,
  reason          text,
  detected_at     timestamptz,
  alert_to        text,
  alert1_at       timestamptz,
  alert2_at       timestamptz,
  checked_by      text,
  checked_by_name text,
  checked_at      timestamptz,
  check_method    text,
  first_by        text,
  sms_at          timestamptz,
  sms_student     text,
  sms_parent      text,
  sms_ids         text,
  arrived_at      text,
  late_min        int,
  version         int not null default 1,
  updated_at      timestamptz not null default now(),
  note            text,
  seen_by         text,
  unique (academy_id, legacy_id)
);
create index att_checks_date on public.att_checks(academy_id, date);
create table public.att_check_log (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date,
  check_id    uuid references public.att_checks(id) on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,   -- 권한 판단용 (check 에서 채움)
  at          timestamptz not null,
  by          text,
  by_name     text,
  from_status text,
  to_status   text,
  note        text,
  unique (academy_id, legacy_id)
);

-- ---------- 직원용 ----------
-- 선생님 근무일지 (옛 logs): 선생님 1명 × 날짜 1일 = 1행
create table public.work_logs (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  date        date not null,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  check_in    time,
  check_out   time,
  work        text,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  fixed_by    text,
  unique (academy_id, legacy_id),
  unique (academy_id, date, staff_id)
);
create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  week        text,
  day         text,
  staff_id    uuid references public.staff(id) on delete cascade,
  start_time  time,
  end_time    time,
  tasks       text,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (academy_id, legacy_id)
);
-- 기기별 웹푸시 구독
create table public.push_subs (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  legacy_id   text,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  created_at  timestamptz not null default now(),
  last_ok     timestamptz,
  fails       int not null default 0,
  unique (academy_id, legacy_id),
  unique (endpoint)
);
-- 등·하원 태블릿 (옛 settings.kioskDevices JSON). 기기 토큰은 해시만 저장
create table public.kiosk_devices (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  name        text not null,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
-- 블로그 원고
create table public.blog_posts (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  keyword text, type text, title text, titles text, body text, meta text, tags text, alt text, todo text, sources text,
  status       text,
  url          text,
  published_at timestamptz,
  created_by   text,
  unique (academy_id, legacy_id)
);

-- updated_at 자동 갱신
do $$
declare t text;
begin
  foreach t in array array['students','classes','enrollments','consults','ext_schedules','makeups','events','tests','supplies',
                           'issues','student_profiles','gradebook','bills','att_checks','work_logs','shifts','blog_posts']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- >>>>> supabase/migrations/0003_security.sql
-- =====================================================================
-- 0003 보안: 학원 간 차단(RLS) · 원장/선생님 권한 · 학원 간 연결 금지 · 기록 변경 금지
--
-- 규칙 요약
--  1. 로그인한 사람은 자기가 소속된(staff.active) 학원 데이터만 본다. 다른 학원 행은 존재하지 않는 것처럼 보인다.
--  2. 원장(admin)은 자기 학원 전체. 선생님(teacher)은 옛 서버 scopeOf 와 같다:
--     담당 반 + 그 반에 수강 기록이 있었던 학생(지난 이력 포함)만. 수납·청구·원장실·삭제는 원장만.
--  3. 학원 상태가 read_only · suspended · cancelled 면 읽기만 된다 (체험 종료·미납).
--  4. 한 행이 다른 학원의 학생·반·직원을 가리키도록 저장할 수 없다 (트리거가 거부).
--  5. 본사 운영자도 학원 데이터를 일괄 조회하지 않는다. 고객지원은 서버 함수의 대리 접속(감사 기록 남김)으로만 한다.
--  6. 문자 발송함·감사 기록·사용량·청구는 화면에서 쓸 수 없다. 서버 함수(service_role)만 쓴다.
-- =====================================================================

-- ---------- 권한 함수 (security definer: 함수 안에서는 RLS 를 거치지 않아 재귀가 생기지 않는다) ----------
create or replace function app.staff_id(a uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s
  where s.academy_id = a and s.user_id = (select auth.uid()) and s.active
$$;

create or replace function app.is_member(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.academy_id = a and s.user_id = (select auth.uid()) and s.active)
$$;

create or replace function app.is_admin(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.academy_id = a and s.user_id = (select auth.uid()) and s.active and s.role = 'admin')
$$;

create or replace function app.login_id(a uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.login_id from public.staff s where s.academy_id = a and s.user_id = (select auth.uid()) and s.active
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid()))
$$;

-- 학원이 쓰기 가능한 상태인지 (체험·정상·미납 유예 중)
create or replace function app.writable(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.academies x where x.id = a and x.status in ('trial', 'active', 'past_due'))
$$;

-- 선생님 담당 반인지 (원장은 항상 true)
create or replace function app.can_class(a uuid, c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin(a) or exists (
    select 1 from public.classes k
    where k.id = c and k.academy_id = a and k.teacher_id = app.staff_id(a))
$$;

-- 여러 반이 모두 담당 반인지 (시험 등록용)
create or replace function app.can_classes(a uuid, cs uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin(a) or (
    coalesce(cardinality(cs), 0) > 0 and not exists (
      select 1 from unnest(cs) c where not exists (
        select 1 from public.classes k where k.id = c and k.academy_id = a and k.teacher_id = app.staff_id(a))))
$$;

-- 담당 반에 수강 기록이 있었던 학생인지 (지운 수강 기록 제외 · 지난 이력 포함)
create or replace function app.can_student(a uuid, st uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin(a) or exists (
    select 1 from public.enrollments e
    join public.classes k on k.id = e.class_id
    where e.academy_id = a and e.student_id = st and not e.deleted
      and k.teacher_id = app.staff_id(a))
$$;

-- 볼 수 있는 시험인지 (담당 반이 들어간 시험 + 담당 학생이 응시한 시험)
create or replace function app.can_exam(a uuid, ex uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin(a)
    or exists (select 1 from public.exams x join public.classes k on k.id = any (x.class_ids)
               where x.id = ex and x.academy_id = a and k.teacher_id = app.staff_id(a))
    or exists (select 1 from public.scores s where s.exam_id = ex and s.academy_id = a and app.can_student(a, s.student_id))
$$;

grant execute on all functions in schema app to authenticated;

-- ---------- 학원 간 연결 금지 + academy_id 변경 금지 ----------
-- 인자: (칼럼, 참조 테이블) 쌍. 배열 칼럼(uuid[])도 원소 전부를 확인한다.
create or replace function app.guard_academy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := to_jsonb(new);
  i int; col text; tbl text; ok boolean; ids uuid[];
begin
  if tg_op = 'UPDATE' and new.academy_id is distinct from old.academy_id then
    raise exception '학원(academy_id)은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  for i in 0 .. tg_nargs / 2 - 1 loop
    col := tg_argv[i * 2]; tbl := tg_argv[i * 2 + 1];
    continue when v -> col is null or jsonb_typeof(v -> col) = 'null';
    if jsonb_typeof(v -> col) = 'array' then
      select array_agg(distinct x::uuid) into ids from jsonb_array_elements_text(v -> col) x;
      continue when ids is null;
      execute format('select count(*) = %s from public.%I where academy_id = $1 and id = any ($2)', cardinality(ids), tbl)
        into ok using new.academy_id, ids;
    else
      execute format('select exists (select 1 from public.%I where id = $1 and academy_id = $2)', tbl)
        into ok using (v ->> col)::uuid, new.academy_id;
    end if;
    if not ok then
      raise exception '다른 학원의 데이터는 연결할 수 없습니다 (%.%)', tg_table_name, col using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('staff',            array[]::text[]),
    ('academy_settings', array[]::text[]),
    ('students',         array[]::text[]),
    ('classes',          array['teacher_id','staff']),
    ('enrollments',      array['student_id','students','class_id','classes','updated_by','staff']),
    ('attendance',       array['student_id','students','class_id','classes']),
    ('checkins',         array['student_id','students','class_id','classes']),
    ('payments',         array['student_id','students','class_id','classes']),
    ('exams',            array['class_ids','classes']),
    ('scores',           array['exam_id','exams','student_id','students','class_id','classes']),
    ('reports',          array['student_id','students']),
    ('consults',         array['student_id','students','member_id','staff']),
    ('messages',         array[]::text[]),
    ('textbooks',        array[]::text[]),
    ('ext_schedules',    array['student_id','students']),
    ('schedule_links',   array['student_id','students']),
    ('academy_kv',       array[]::text[]),
    ('changes',          array['student_id','students','class_id','classes']),
    ('makeups',          array['class_id','classes','teacher_id','staff','student_ids','students']),
    ('mk_requests',      array['teacher_id','staff','makeup_id','makeups']),
    ('events',           array[]::text[]),
    ('tests',            array[]::text[]),
    ('supplies',         array[]::text[]),
    ('issues',           array[]::text[]),
    ('student_profiles', array['student_id','students']),
    ('gradebook',        array['student_id','students']),
    ('bills',            array['student_id','students','payment_id','payments']),
    ('att_checks',       array['student_id','students','class_id','classes','makeup_id','makeups','teacher_id','staff']),
    ('att_check_log',    array['check_id','att_checks','student_id','students']),
    ('work_logs',        array['staff_id','staff']),
    ('shifts',           array['staff_id','staff']),
    ('push_subs',        array['staff_id','staff']),
    ('kiosk_devices',    array[]::text[]),
    ('blog_posts',       array[]::text[]),
    ('sms_outbox',       array['created_by','staff']),
    ('usage_monthly',    array[]::text[]),
    ('invoices',         array[]::text[])
  ) as t(tbl, args)
  loop
    execute format('create trigger guard_academy before insert or update on public.%I for each row execute function app.guard_academy(%s)',
                   r.tbl, (select coalesce(string_agg(quote_literal(a), ', '), '') from unnest(r.args) a));
  end loop;
end $$;

-- ---------- RLS 정책 ----------
-- app.policies(테이블, 읽기, 추가, 수정, 삭제): 조건식은 해당 테이블의 칼럼으로 쓴다. 'false' 는 화면에서 불가.
-- 추가·수정·삭제에는 자동으로 "학원이 쓰기 가능한 상태" 조건이 붙는다.
create or replace procedure app.policies(tbl text, rd text, ins text, upd text, del text)
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('create policy %I on public.%I for select to authenticated using (app.is_member(academy_id) and (%s))', tbl || '_select', tbl, rd);
  if ins <> 'false' then
    execute format('create policy %I on public.%I for insert to authenticated with check (app.is_member(academy_id) and app.writable(academy_id) and (%s))', tbl || '_insert', tbl, ins);
  end if;
  if upd <> 'false' then
    execute format('create policy %I on public.%I for update to authenticated using (app.is_member(academy_id) and (%s)) with check (app.is_member(academy_id) and app.writable(academy_id) and (%s))', tbl || '_update', tbl, upd, upd);
  end if;
  if del <> 'false' then
    execute format('create policy %I on public.%I for delete to authenticated using (app.is_member(academy_id) and app.writable(academy_id) and (%s))', tbl || '_delete', tbl, del);
  end if;
end $$;

-- 약어: ADM = 원장, ME = 내 직원 id, STU(x) = 담당 학생, CLS(x) = 담당 반
call app.policies('students',
  'app.can_student(academy_id, id)',
  'app.is_admin(academy_id)',
  'app.can_student(academy_id, id)',
  'app.is_admin(academy_id)');
call app.policies('classes',
  'app.can_class(academy_id, id)',
  'app.is_admin(academy_id)',
  'app.can_class(academy_id, id)',                      -- 선생님은 담당 반의 진도·수업 메모를 고친다
  'app.is_admin(academy_id)');
call app.policies('enrollments',
  'app.can_class(academy_id, class_id)',
  'app.is_admin(academy_id)',
  'app.is_admin(academy_id)',
  'app.is_admin(academy_id)');
call app.policies('attendance',
  'app.can_student(academy_id, student_id)',
  'app.can_student(academy_id, student_id) and (class_id is null or app.can_class(academy_id, class_id))',
  'app.can_student(academy_id, student_id) and (class_id is null or app.can_class(academy_id, class_id))',
  'app.is_admin(academy_id)');
call app.policies('checkins',
  'app.can_student(academy_id, student_id)',
  'app.is_admin(academy_id)',                            -- 태블릿 등·하원은 서버 함수가 기록한다
  'app.is_admin(academy_id)',
  'app.is_admin(academy_id)');
call app.policies('payments',
  'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)');
call app.policies('exams',
  'app.can_exam(academy_id, id)',
  'app.can_classes(academy_id, class_ids)',
  'app.can_classes(academy_id, class_ids)',
  'app.is_admin(academy_id)');
call app.policies('scores',
  'app.can_student(academy_id, student_id)',
  'app.can_student(academy_id, student_id) and app.can_exam(academy_id, exam_id)',
  'app.can_student(academy_id, student_id) and app.can_exam(academy_id, exam_id)',
  'app.is_admin(academy_id)');
call app.policies('reports',
  'app.can_student(academy_id, student_id)',
  'app.can_student(academy_id, student_id)',
  'app.can_student(academy_id, student_id)',
  'app.is_admin(academy_id)');
call app.policies('consults',
  'app.is_admin(academy_id) or member_id = app.staff_id(academy_id) or (student_id is not null and app.can_student(academy_id, student_id))',
  'app.is_admin(academy_id) or (member_id = app.staff_id(academy_id) and (student_id is null or app.can_student(academy_id, student_id)))',
  'app.is_admin(academy_id) or member_id = app.staff_id(academy_id)',
  'app.is_admin(academy_id)');
call app.policies('messages',
  'app.is_admin(academy_id) or sent_by = app.login_id(academy_id)',
  'false', 'false', 'app.is_admin(academy_id)');          -- 새 문자는 sms_outbox → 서버 함수
call app.policies('textbooks', 'true', 'true', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)');
call app.policies('ext_schedules',
  'app.can_student(academy_id, student_id)', 'app.can_student(academy_id, student_id)',
  'app.can_student(academy_id, student_id)', 'app.can_student(academy_id, student_id)');
call app.policies('schedule_links',
  'app.can_student(academy_id, student_id)', 'app.can_student(academy_id, student_id)',
  'app.can_student(academy_id, student_id)', 'app.is_admin(academy_id)');
call app.policies('academy_kv',
  'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)');
call app.policies('changes',
  'app.is_admin(academy_id)', 'true', 'false', 'false');  -- 이력은 쓰기만
call app.policies('makeups',
  'app.is_admin(academy_id) or teacher_id = app.staff_id(academy_id) or (class_id is not null and app.can_class(academy_id, class_id))',
  'app.is_admin(academy_id)',
  'app.is_admin(academy_id) or teacher_id = app.staff_id(academy_id)',
  'app.is_admin(academy_id)');
call app.policies('mk_requests',
  'app.is_admin(academy_id) or teacher_id = app.staff_id(academy_id)',
  'app.is_admin(academy_id) or teacher_id = app.staff_id(academy_id)',
  'app.is_admin(academy_id)',
  'app.is_admin(academy_id)');
call app.policies('att_checks',
  'app.can_student(academy_id, student_id)',
  'app.is_admin(academy_id)',                            -- 자동 감지는 서버 함수가 만든다
  'app.can_student(academy_id, student_id)',
  'app.is_admin(academy_id)');
call app.policies('att_check_log',
  'app.can_student(academy_id, student_id)', 'app.can_student(academy_id, student_id)', 'false', 'false');
call app.policies('work_logs',
  'app.is_admin(academy_id) or staff_id = app.staff_id(academy_id)',
  'app.is_admin(academy_id) or staff_id = app.staff_id(academy_id)',
  'app.is_admin(academy_id) or staff_id = app.staff_id(academy_id)',   -- 출퇴근 시각 수정 제한은 서버 함수에서
  'app.is_admin(academy_id)');
call app.policies('shifts', 'true', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)');
call app.policies('push_subs',
  'staff_id = app.staff_id(academy_id)', 'staff_id = app.staff_id(academy_id)',
  'staff_id = app.staff_id(academy_id)', 'staff_id = app.staff_id(academy_id) or app.is_admin(academy_id)');

-- 원장 전용 (원장실 · 청구 · 태블릿 · 블로그)
do $$
declare t text;
begin
  foreach t in array array['events','tests','supplies','issues','student_profiles','gradebook','bills','kiosk_devices','blog_posts']
  loop
    call app.policies(t, 'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)');
  end loop;
end $$;

-- 서버 함수만 쓰는 표 (화면은 원장이 조회만)
call app.policies('sms_outbox',
  'app.is_admin(academy_id) or created_by = app.staff_id(academy_id)', 'false', 'false', 'false');
call app.policies('audit_log',    'app.is_admin(academy_id)', 'false', 'false', 'false');
call app.policies('usage_monthly','app.is_admin(academy_id)', 'false', 'false', 'false');
call app.policies('invoices',     'app.is_admin(academy_id)', 'false', 'false', 'false');

-- 직원 목록: 같은 학원 직원 이름은 보이고, 추가·수정·삭제는 원장만
call app.policies('staff', 'true', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)', 'app.is_admin(academy_id)');
-- 학원 설정: 직원은 읽고 원장만 고친다
call app.policies('academy_settings', 'true', 'false', 'app.is_admin(academy_id)', 'false');

-- 학원 자체 (id 가 곧 학원): 소속 학원만 보이고 화면에서는 고칠 수 없다 (상태·요금제는 본사 콘솔 서버 함수)
alter table public.academies enable row level security;
create policy academies_select on public.academies for select to authenticated
  using (app.is_member(id) or app.is_platform_admin());

alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated using (true);

alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = (select auth.uid()));

-- ---------- 권한 부여 ----------
-- 비로그인(anon)은 표에 직접 접근할 수 없다. 학부모 링크·태블릿은 서버 함수를 거친다.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- app 스키마의 표(비밀값·옛 비밀번호 해시)는 화면 역할에 절대 주지 않는다
revoke all on all tables in schema app from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all tables in schema app to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- >>>>> supabase/migrations/0004_import.sql
-- =====================================================================
-- 0004 학원 한 곳을 한 번에 넣는 함수 (옛 구글 시트 이관용)
--
-- public.import_academy(payload, apply, replace_existing)
--   payload : migrate/transform.cjs 가 만든 { 표이름: [행, ...] }
--   apply   : false 면 전부 넣어 본 뒤 CHECK_OK 오류로 되돌린다(점검). true 면 저장
--   replace_existing : 같은 slug 학원이 있으면 지우고 다시 넣는다 (테스트 DB 에서만)
-- 한 번의 호출 = 한 트랜잭션. 하나라도 실패하거나 건수가 안 맞으면 아무것도 남지 않는다.
-- 서버 관리자 키(service_role / Secret key)로만 부를 수 있다. 화면·비로그인 키로는 호출 불가.
-- =====================================================================
create or replace function public.import_academy(payload jsonb, apply boolean default false, replace_existing boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  -- 참조 순서 (transform.cjs 의 HAKWON_ORDER 와 같아야 한다)
  tables text[] := array['academies', 'academy_settings', 'app.academy_secrets', 'staff', 'app.staff_legacy_credentials', 'students',
    'classes', 'textbooks', 'enrollments', 'attendance', 'checkins', 'payments', 'exams', 'scores', 'reports', 'consults', 'messages',
    'ext_schedules', 'schedule_links', 'academy_kv', 'changes', 'makeups', 'mk_requests', 'events', 'tests', 'supplies', 'issues',
    'student_profiles', 'gradebook', 'bills', 'att_checks', 'att_check_log', 'work_logs', 'shifts', 'push_subs', 'kiosk_devices', 'blog_posts'];
  t text; tbl text; cols text; n bigint; want bigint;
  counts jsonb := '{}';
  v_slug text := payload -> 'academies' -> 0 ->> 'slug';
begin
  if v_slug is null then raise exception 'payload 에 학원(academies) 정보가 없습니다'; end if;
  if exists (select 1 from public.academies a where a.slug = v_slug) then
    if not replace_existing then
      raise exception '"%" 학원이 이미 들어 있습니다. 다시 넣으려면 replace_existing 을 켜세요 (테스트 DB 에서만)', v_slug;
    end if;
    delete from public.academies a where a.slug = v_slug;   -- 딸린 데이터는 on delete cascade 로 함께 지워진다
  end if;

  -- payload 에 모르는 표 이름이 있으면 멈춘다 (오타로 데이터가 조용히 빠지는 것 방지)
  select string_agg(k, ', ') into t from jsonb_object_keys(payload) k where k <> all (tables);
  if t is not null then raise exception '알 수 없는 표: %', t; end if;

  foreach t in array tables loop
    want := coalesce(jsonb_array_length(payload -> t), 0);
    continue when want = 0;
    tbl := case when position('.' in t) > 0
                then quote_ident(split_part(t, '.', 1)) || '.' || quote_ident(split_part(t, '.', 2))
                else 'public.' || quote_ident(t) end;
    select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(payload -> t -> 0) k;
    execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)', tbl, cols, cols, tbl)
      using payload -> t;
    get diagnostics n = row_count;
    if n <> want then raise exception '% 건수 불일치 (DB % / 보낸 것 %)', t, n, want; end if;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  if not apply then
    -- 점검: 전부 들어가는 것을 확인했으니 오류로 되돌린다
    raise exception using errcode = 'P0001', message = 'CHECK_OK', detail = counts::text;
  end if;
  return counts;
end $$;

revoke all on function public.import_academy(jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.import_academy(jsonb, boolean, boolean) to service_role;

commit;
select '설치 완료' as result,
  (select count(*) from information_schema.tables where table_schema in ('public','app')) as tables,
  (select count(*) from pg_policies where schemaname = 'public') as policies;
