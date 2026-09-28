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
