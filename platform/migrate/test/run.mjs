// 이관 스크립트 테스트: 가짜 학원 파일을 만들어 미리보기 → 점검(되돌림) → 저장 → 값 검사 → 보안 규칙 확인.
// 필요: DATABASE_URL (마이그레이션이 적용된 빈 테스트 DB). platform/scripts/test-db.sh 가 준비해 준다.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import pg from 'pg';
import { makeFixture } from './make-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'import-sheet.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
const file = path.join(dir, 'fixture.xlsx');
await makeFixture(file);

let fails = 0;
const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };
const run = (...extra) => execFileSync('node', [script, '--file', file, '--slug', 'fake-academy', '--name', '가짜학원', ...extra], { encoding: 'utf8', env: process.env });

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (t) => Number((await one(`select count(*) from ${t}`)).count);

// 1. 미리보기: DB 연결 없이 보고만
const preview = run();
ok(/미리보기/.test(preview), '미리보기 실행');
ok(/id "S0000000003" 중복/.test(preview), '중복 id 를 잡아낸다');
ok(/"S_없는학생" 를 students 에서 찾을 수 없음/.test(preview), '없는 학생 참조를 잡아낸다');
ok(/전화번호 앞자리 0 복원/.test(preview), '빠진 전화번호 0 을 복원한다');
ok(await count('public.academies') === 0, '미리보기는 DB 에 쓰지 않는다');

// 2. 점검: 넣어 보고 되돌림
const check = run('--check');
ok(/점검 통과/.test(check), '점검 모드 통과');
ok(await count('public.academies') === 0, '점검 모드는 저장하지 않는다');

// 3. 저장
const apply = run('--apply');
ok(/저장 완료/.test(apply), '저장 완료');
const a = await one(`select * from public.academies where slug = 'fake-academy'`);
ok(!!a && a.test_mode === true, '새 학원은 문자 테스트 모드로 시작한다');
ok(await count('public.students') === 3, '학생 3명 (중복 1행 제외)');
ok(await count('public.enrollments') === 3, '수강 3건 (없는 학생 1행 제외)');
const s1 = await one(`select * from public.students where legacy_id = 'S0000000001'`);
ok(s1.parent_phone === '01099990001', `전화번호 0 복원 저장 (${s1.parent_phone})`);
const s2 = await one(`select birth::text, enrolled_at::text from public.students where legacy_id = 'S0000000002'`);
ok(s2.birth === '2013-03-01' && s2.enrolled_at === '2026-09-10', `날짜 셀 변환 (${s2.birth}, ${s2.enrolled_at})`);
const s3 = await one(`select enrolled_at::text, left_at::text from public.students where legacy_id = 'S0000000003'`);
ok(s3.enrolled_at === '2026-09-01' && s3.left_at === '2026-09-20', `한국어 날짜 글자 변환 (${s3.enrolled_at}, ${s3.left_at})`);
const c2 = await one(`select c.start_time::text, c.end_time::text, c.fee, s.login_id from public.classes c join public.staff s on s.id = c.teacher_id where c.legacy_id = 'C000000002'`);
ok(c2.start_time === '18:00:00' && c2.end_time === '20:00:00', `시각 셀 변환 (${c2.start_time})`);
ok(c2.fee === 250000, '금액 "250,000" → 250000');
ok(c2.login_id === 'admin01', '담당 강사 아이디 대소문자 무시하고 연결');
const ck = await one(`select time::text from public.checkins where legacy_id = 'Q000000002'`);
ok(ck.time === '15:05:00', `"오후 3:05" → 15:05 (${ck.time})`);
const ex = await one(`select cardinality(class_ids) n, questions->0->>'unit' unit from public.exams`);
ok(ex.n === 2 && ex.unit === '수와 연산', '시험의 여러 반·문항 JSON');
const sc = await one(`select score from public.scores where legacy_id = 'R000000002'`);
ok(sc.score === null, '미입력 점수는 null');
const mk = await one(`select cardinality(student_ids) n from public.makeups`);
ok(mk.n === 2, '보강 대상 학생 목록');
const log = await one(`select count(*) filter (where student_id is not null) n from public.att_check_log`);
ok(Number(log.n) === 2, '미출결 이력에 학생 연결');
const t2 = await one(`select active from public.staff where login_id = 'teach02'`);
ok(t2.active === false, '비활성 직원 유지');
ok(await count('app.staff_legacy_credentials') === 3, '옛 비밀번호 해시는 app 스키마로');
const sec = await one(`select kiosk_pin_hash from app.academy_secrets where academy_id = $1`, [a.id]);
ok(sec.kiosk_pin_hash && sec.kiosk_pin_hash !== '1234' && sec.kiosk_pin_hash.length === 64, '태블릿 PIN 은 해시로만 저장');
const kd = await one(`select token_hash from public.kiosk_devices`);
ok(kd.token_hash.length === 64 && !kd.token_hash.includes('devtok'), '태블릿 기기 토큰은 해시로만 저장');
const sl = await one(`select token_hash from public.schedule_links`);
ok(sl.token_hash !== 'tok_abcdef1234567890' && sl.token_hash.length === 64, '학부모 일정 링크 토큰은 해시로만 저장');
const st = await one(`select settings->>'travelBuffer' tb, settings->'adminMeta'->>'term' term from public.academy_settings`);
ok(st.tb === '20' && st.term === '2026학년도 2학기', '일반 설정·adminMeta 이관');
const everything = JSON.stringify((await db.query(`select * from public.academy_settings`)).rows) + JSON.stringify((await db.query(`select * from public.academy_kv`)).rows);
ok(!everything.includes('1234') && !everything.includes('devtok_1'), 'PIN·기기 토큰 원문이 설정에 남지 않는다');

// 4. 재실행 방지
let blocked = false;
try { run('--apply'); } catch { blocked = true; }
ok(blocked, '같은 학원을 두 번 넣으려 하면 거부');
ok(/--replace/.test(run('--apply', '--replace')), '--replace 로만 다시 넣기');
ok(await count('public.students') === 3, '다시 넣어도 학생 3명 (중복 없음)');

// 5. 이관된 데이터에도 보안 규칙이 적용되는지: 김선생(teach01)으로 로그인하면 담당 반 학생만
const u = await one(`insert into auth.users (email) values ('teach01@test') returning id`);
await db.query(`update public.staff set user_id = $1 where login_id = 'teach01'`, [u.id]);
await db.query('begin');
await db.query(`set local role authenticated`);
await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u.id]);
const seen = (await db.query(`select legacy_id from public.students order by legacy_id`)).rows.map((r) => r.legacy_id);
ok(JSON.stringify(seen) === JSON.stringify(['S0000000001', 'S0000000003']), `선생님은 담당 반 학생만 (${seen})`);
ok(Number((await one(`select count(*) from public.payments`)).count) === 0, '선생님은 수납 안 보임');
await db.query('rollback');

await db.end();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n이관 테스트 실패 ${fails}건` : '\n이관 테스트 전부 통과');
process.exit(fails ? 1 : 0);
