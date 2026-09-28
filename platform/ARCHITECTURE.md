# 학원관리 플랫폼 설계서 (v0.1 · 2026-09-28)

지금의 더블엠 학원관리(구글 Apps Script + 구글 시트)를 **여러 학원이 함께 쓰는 판매용 서버**로 옮기기 위한 설계다.
처음부터 판매 이후 구조로 만들고, 더블엠은 이 시스템의 **1호 학원**으로 입주한다. 이전은 한 번만 한다.

> 이 폴더(`platform/`)는 지금 운영 중인 대시보드와 **완전히 분리**돼 있다.
> `webapp/`·`docs/`·`src/` 와 운영 구글 시트는 전환일까지 건드리지 않는다. 이 브랜치는 전환일 전까지 main 에 합치지 않는다
> (main 에 합치면 GitHub Pages 화면과 [서버 업데이트] 버튼이 바로 바뀐다).

---

## 1. 구성

```
[학원 A 원장·선생님]  a.브랜드.kr ─┐
[학원 B 원장·선생님]  b.브랜드.kr ─┼─ 화면 (Vercel Pro)
[등·하원 태블릿 · 학부모 링크]   ─┘        │
                                          ▼
                    Supabase Pro · 서울 리전 (ap-northeast-2)
        ┌──────────────────┬─────────────────────┬──────────────────┐
        │ Postgres DB 1개  │ 서버 함수            │ 예약 작업 (pg_cron)│
        │ 모든 표에         │ 문자·AI·결제·태블릿   │ 1분마다 미출결 확인 │
        │ academy_id + RLS │ 학부모 링크·첫 로그인  │ 보강 전날 리마인드  │
        └──────────────────┴─────────────────────┴──────────────────┘
                                          │
                        솔라피(학원별 발신번호) · Claude API · PG사
```

| 항목 | 선택 | 이유 |
|---|---|---|
| DB·로그인·백업 | Supabase Pro (서울) | 서버 관리 불필요, RLS 로 학원 분리, 자동 백업 + 시점 복구(PITR) |
| 화면 | Vercel Pro | 학원별 주소, 자동 HTTPS, 저장소를 비공개로 돌릴 수 있음 |
| 운영 비용 | 약 월 $160 (PITR 포함) | 개발 중에는 Supabase 무료 + Vercel 없이 진행 |
| 예상 수용량 | Small 사양으로 30~50곳 | 부하 테스트로 확정 예정. 초과 시 DB 사양만 올림 |

## 2. 학원 분리 (가장 중요)

- 모든 학원 데이터 표에 `academy_id` 가 있고, **DB 가 직접** 막는다(RLS). 화면이나 서버 코드에 실수가 있어도 다른 학원 행은 조회·수정되지 않는다.
- 한 행이 다른 학원의 학생·반·직원을 가리키도록 저장하는 것도 트리거(`app.guard_academy`)가 거부한다. `academy_id` 는 바꿀 수 없다.
- 본사 운영자도 학원 데이터를 일괄 조회하지 않는다. 고객지원은 학원 동의 + 감사 기록이 남는 대리 접속 서버 함수로만 한다.
- 검증: `supabase/tests/10_security_test.sql` (29개 시나리오 — 다른 학원 원장, 담당 외 선생님, 읽기 전용, 비로그인, 비밀값 접근 등).

## 3. 권한

옛 서버의 `scopeOf` 규칙을 DB 규칙으로 그대로 옮겼다.

| 대상 | 원장 | 선생님 |
|---|---|---|
| 학생 | 전체 | 담당 반에 수강 기록이 있었던 학생 (지난 이력 포함). 추가·삭제 불가 |
| 반 | 전체 | 담당 반만. 진도·수업 메모 수정 가능 |
| 출결·점수·리포트·외부 일정 | 전체 | 담당 학생만 |
| 상담 | 전체 | 내가 쓴 상담 + 담당 학생 상담 |
| 수납·개별 청구·원장실(달력·테스트·시재·점검·기록카드·성적부) | 전체 | 불가 |
| 직원 목록 | 추가·수정 | 조회만 |
| 문자 발송 | 발송함 조회 | 내가 보낸 것만 조회. 발송은 서버 함수로만 |
| 삭제 | 가능 | 불가 (자기 푸시 구독·외부 일정 제외) |

학원 상태가 `read_only`·`suspended`·`cancelled` 이면 전원 읽기만 된다(체험 종료·미납).

## 4. 계정

- 사람 계정은 Supabase Auth 하나, 학원 소속은 `staff` 표 (한 사람이 두 학원에서 일하면 행 2개).
- 로그인은 **학원 주소 + 아이디 + 비밀번호** (지금과 같은 습관).
- 옛 비밀번호(솔트+SHA-256)는 `app.staff_legacy_credentials` 에 옮겨 두고, 첫 로그인 때 서버 함수가 옛 방식으로 확인 → Supabase Auth 계정 생성(bcrypt) → 옛 해시 삭제. **선생님들은 비밀번호를 바꾸지 않아도 된다.**
- 옛 로그인 세션은 옮기지 않는다 (전환 후 한 번 다시 로그인).

## 5. 비밀값 보관

| 값 | 옛 시스템 | 새 시스템 |
|---|---|---|
| 문자·AI API 키 | 스크립트 속성 | `app.academy_secrets` (화면에서 조회 불가, 서버 함수만). 전환 때 원장이 다시 입력 |
| 태블릿 관리자 PIN | **시트에 평문** | 해시로만 저장 |
| 태블릿 기기 토큰 | 시트에 평문 | 해시로만 저장 (기존 태블릿은 재등록 없이 동작) |
| 학부모 일정 링크 토큰 | 시트에 평문 | 해시로만 저장 (이미 보낸 링크도 계속 열림) |
| 로그인 토큰 | 시트에 평문 | Supabase Auth 가 관리 |
| 비밀번호 | SHA-256 1회 | bcrypt (Supabase Auth) |

## 6. 문자

- 모든 문자는 `sms_outbox` 에 먼저 쌓이고 서버 함수가 보낸다.
- `idempotency_key` 가 같으면 두 번 들어가지 않는다 → 병행 운영·재시도 때도 **학부모에게 같은 문자가 두 번 가지 않는다**.
- 새 학원은 `test_mode = true` 로 시작한다(실제 발송 안 함). 더블엠도 전환일 전까지 테스트 모드.
- 발송 방식: 학원이 자기 솔라피 계정을 연결(A)으로 시작. 본사 대행(B)으로 바꿀 수 있게 발송 건수·비용을 `usage_monthly` 에 기록한다.

## 7. 표 목록 (옛 시트 → 새 표)

| 옛 시트 | 새 표 | 비고 |
|---|---|---|
| members | staff (+ app.staff_legacy_credentials) | 아이디는 소문자로 통일 |
| students · classes · enrollments · attendance · checkins · payments | 같은 이름 | |
| exams · scores · reports · consults · messages · textbooks · changes · makeups · events · tests · supplies · issues · gradebook · bills | 같은 이름 | |
| extSchedules · scheduleLinks · mkRequests · attChecks · attCheckLog · pushSubs · blogPosts | ext_schedules · schedule_links · mk_requests · att_checks · att_check_log · push_subs · blog_posts | |
| profiles | student_profiles | |
| logs · shifts | work_logs · shifts | |
| settings | academy_settings.settings · academy_kv · app.academy_secrets · kiosk_devices | 비밀값은 분리·해시 |
| sessions · 시트1 | 옮기지 않음 | |
| (새로) | academies · plans · platform_admins · audit_log · usage_monthly · invoices · sms_outbox | 판매용 |

모든 이관 행은 `legacy_id` 에 옛 id 를 남겨 원본과 대조할 수 있다.

## 8. 진행 단계

1. **[완료]** 설계 · DB 구조 · 보안 규칙 · 이관 스크립트 · 자동 테스트 (이 문서)
2. Supabase 테스트 프로젝트(`hakwon-dev`)에 구조 올리기 → 백업 사본 xlsx 로 이관 점검(`--check`)
3. 서버 함수: 첫 로그인(옛 비밀번호 확인), 태블릿, 학부모 링크, 문자 발송, 미출결 예약 작업
4. 화면: 기존 화면을 새 API 로 연결 (한꺼번에 받던 데이터를 기간·페이지 단위로)
5. 더블엠 병행 운영 (테스트 모드) → 전환일: 최종 이관 → 문자 켜기 → 옛 주소 자동 이동
6. 본사 콘솔 · 학원 생성·링크 발급 · 설정 마법사 · 부하 테스트 → 베타 판매

## 9. 아직 정할 것

- 브랜드명·도메인 (전환 전까지. 푸시 알림·설치 앱이 주소에 묶이므로 나중에 바꾸기 어렵다)
- 전화번호 암호화 방식: 지금은 RLS + 감사 기록으로 보호. 칼럼 암호화는 태블릿 뒷자리 검색과 함께 3단계에서 확정
- 요금제 금액 (`plans.monthly_price` 는 0 으로 비워 둠)
- 웹푸시 VAPID 키 이전 여부 (옮기면 알림 재허용 불필요)
