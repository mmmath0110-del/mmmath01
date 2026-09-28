-- 보안 규칙 자동 테스트. 로컬 DB 에 마이그레이션을 올린 뒤 실행한다 (platform/scripts/test-db.sh).
-- 하나라도 실패하면 오류로 멈춘다. 모든 변경은 마지막에 되돌린다.
\set ON_ERROR_STOP 1
begin;

-- ---------- 준비: 학원 A(더블엠 역할) · 학원 B(다른 학원) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'adminA'),
  ('00000000-0000-0000-0000-00000000a002', 'teacherA1'),
  ('00000000-0000-0000-0000-00000000a003', 'teacherA2'),
  ('00000000-0000-0000-0000-00000000b001', 'adminB');
insert into public.academies (id, slug, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'academy-a', '학원A', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'academy-b', '학원B', 'active');
insert into public.staff (id, academy_id, user_id, login_id, name, role) values
  ('5a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a001', 'adminA', '원장A', 'admin'),
  ('5a000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a002', 't1', '선생님1', 'teacher'),
  ('5a000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a003', 't2', '선생님2', 'teacher'),
  ('5b000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b001', 'adminB', '원장B', 'admin');
insert into public.classes (id, academy_id, name, teacher_id) values
  ('c1000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', '반1(선생님1)', '5a000000-0000-0000-0000-000000000002'),
  ('c2000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', '반2(선생님2)', '5a000000-0000-0000-0000-000000000003'),
  ('cb000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'B반', '5b000000-0000-0000-0000-000000000001');
insert into public.students (id, academy_id, name, parent_phone) values
  ('51000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', '학생1', '01011112222'),
  ('52000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', '학생2', '01033334444'),
  ('5b000000-0000-0000-0000-00000000005b', 'bbbbbbbb-0000-0000-0000-000000000000', 'B학생', '01055556666');
insert into public.enrollments (academy_id, student_id, class_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000000'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '52000000-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '5b000000-0000-0000-0000-00000000005b', 'cb000000-0000-0000-0000-000000000000');
insert into public.payments (academy_id, date, student_id, amount) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '2026-09-01', '51000000-0000-0000-0000-000000000000', 200000);
insert into app.academy_secrets (academy_id, sms_key) values ('aaaaaaaa-0000-0000-0000-000000000000', 'SECRET');

-- 결과를 담을 표 (역할이 바뀌어도 쓸 수 있게)
create temp table results (n serial, name text, ok boolean);
grant all on results to authenticated, anon;
grant usage on sequence results_n_seq to authenticated, anon;

-- 로그인 흉내: 역할 + JWT sub
create function pg_temp.login(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
end $$;

-- 오류가 나야 통과하는 검사
create function pg_temp.must_fail(name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    insert into results(name, ok) values (name, false);
  exception when others then
    -- 권한 거부(42501)나 RLS 위반만 통과로 친다. 오타·문법 오류로 실패한 것은 실패로 기록한다
    insert into results(name, ok) values (name || ' [' || sqlstate || ' ' || left(sqlerrm, 60) || ']', sqlstate in ('42501'));
  end;
end $$;
-- 문장을 실행하고 바뀐 행 수를 돌려준다 (RLS 에 막히면 0)
create function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
-- 값이 기대와 같아야 통과
create function pg_temp.expect(name text, got bigint, want bigint) returns void language plpgsql as $$
begin
  insert into results(name, ok) values (name || ' (got ' || got || ', want ' || want || ')', got = want);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------- 학원B 원장 ----------
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000b001');
select pg_temp.expect('B원장: A학원 학생이 안 보인다', (select count(*) from students where academy_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0);
select pg_temp.expect('B원장: 자기 학원 학생만 보인다', (select count(*) from students), 1);
select pg_temp.expect('B원장: A학원 수납이 안 보인다', (select count(*) from payments), 0);
select pg_temp.expect('B원장: A학원 직원이 안 보인다', (select count(*) from staff), 1);
select pg_temp.expect('B원장: A학원 수정 시도 → 0행', pg_temp.affected($s$update students set name = 'x' where academy_id = 'aaaaaaaa-0000-0000-0000-000000000000'$s$), 0);
select pg_temp.must_fail('B원장: A학원에 학생 추가 불가',
  $s$insert into students (academy_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', '침투')$s$);
select pg_temp.must_fail('B원장: 자기 반에 A학원 학생 연결 불가',
  $s$insert into enrollments (academy_id, student_id, class_id) values ('bbbbbbbb-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000000', 'cb000000-0000-0000-0000-000000000000')$s$);
select pg_temp.must_fail('B원장: 자기 학생을 A학원으로 옮기기 불가',
  $s$update students set academy_id = 'aaaaaaaa-0000-0000-0000-000000000000' where id = '5b000000-0000-0000-0000-00000000005b'$s$);

-- ---------- 선생님1 (반1 담당) ----------
select pg_temp.login('00000000-0000-0000-0000-00000000a002');
select pg_temp.expect('선생님1: 담당 학생 1명만 보인다', (select count(*) from students), 1);
select pg_temp.expect('선생님1: 담당 반 1개만 보인다', (select count(*) from classes), 1);
select pg_temp.expect('선생님1: 수납이 안 보인다', (select count(*) from payments), 0);
select pg_temp.expect('선생님1: 같은 학원 직원 목록은 보인다', (select count(*) from staff), 3);
select pg_temp.must_fail('선생님1: 담당 아닌 학생 출결 입력 불가',
  $s$insert into attendance (academy_id, date, class_id, student_id, status) values ('aaaaaaaa-0000-0000-0000-000000000000', '2026-09-28', 'c2000000-0000-0000-0000-000000000000', '52000000-0000-0000-0000-000000000000', '출석')$s$);
insert into attendance (academy_id, date, class_id, student_id, status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '2026-09-28', 'c1000000-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000000', '출석');
select pg_temp.expect('선생님1: 담당 학생 출결 입력 가능', (select count(*) from attendance), 1);
select pg_temp.must_fail('선생님1: 학생 추가 불가(원장만)',
  $s$insert into students (academy_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', '신규')$s$);
select pg_temp.expect('선생님1: 학생 삭제 → 0행(원장만)', pg_temp.affected('delete from students'), 0);
select pg_temp.must_fail('선생님1: 문자 발송함 직접 쓰기 불가',
  $s$insert into sms_outbox (academy_id, idempotency_key, kind, to_phone, body) values ('aaaaaaaa-0000-0000-0000-000000000000', 'k', 'manual', '010', 'x')$s$);
select pg_temp.expect('선생님1: 자기를 원장으로 승격 → 0행', pg_temp.affected($s$update staff set role = 'admin' where login_id = 't1'$s$), 0);
select pg_temp.must_fail('선생님1: 비밀값 표 접근 불가', 'select * from app.academy_secrets');
select pg_temp.must_fail('선생님1: 옛 비밀번호 해시 표 접근 불가', 'select * from app.staff_legacy_credentials');
select pg_temp.must_fail('선생님1: 이관 함수 호출 불가', $s$select public.import_academy('{}'::jsonb, true, true)$s$);
select pg_temp.expect('선생님1: 원장실 기록카드 안 보임', (select count(*) from student_profiles), 0);

-- ---------- 선생님2: 선생님1이 쓴 출결이 안 보인다 ----------
select pg_temp.login('00000000-0000-0000-0000-00000000a003');
select pg_temp.expect('선생님2: 남의 반 출결 안 보임', (select count(*) from attendance), 0);

-- ---------- A원장: 전체 ----------
select pg_temp.login('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('A원장: 자기 학원 학생 전부', (select count(*) from students), 2);
select pg_temp.expect('A원장: 수납 보임', (select count(*) from payments), 1);
select pg_temp.expect('A원장: B학원 학생 안 보임', (select count(*) from students where academy_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0);
select pg_temp.expect('A원장: 학원 상태를 스스로 바꿀 수 없다 → 0행', pg_temp.affected($s$update academies set status = 'active'$s$), 0);

-- ---------- 체험 종료 → 읽기 전용 ----------
reset role;
update public.academies set status = 'read_only' where slug = 'academy-a';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('읽기 전용: 조회는 된다', (select count(*) from students), 2);
select pg_temp.must_fail('읽기 전용: 학생 추가 불가',
  $s$insert into students (academy_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', '신규')$s$);

-- ---------- 비로그인 ----------
reset role;
set local role anon;
select pg_temp.login('');
select pg_temp.must_fail('비로그인: 학생 표 접근 불가', 'select * from public.students');
select pg_temp.must_fail('비로그인: 이관 함수 호출 불가', $s$select public.import_academy('{}'::jsonb, true, true)$s$);

reset role;
\echo
\echo ===== 보안 테스트 결과 =====
select n, case when ok then 'PASS' else 'FAIL' end as result, name from results order by n;
do $$ declare f int; begin
  select count(*) into f from results where not ok;
  if f > 0 then raise exception '보안 테스트 실패 %건', f; end if;
  raise notice '보안 테스트 전부 통과 (%건)', (select count(*) from results);
end $$;
rollback;
