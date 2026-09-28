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
