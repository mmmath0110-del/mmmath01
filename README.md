# 더블엠수학학원 관리 프로그램

원장용 학원 관리 앱과, 자격증명으로 여는 암호화 열람판의 소스입니다.

## 배포된 것

| | 주소 | 성격 |
|---|---|---|
| 원장실 앱 | `claude.ai/code/artifact/958dc0f0-d541-478a-808c-96927ff822f8` | 실제 프로그램. 원장만 열람·수정 |
| 열람판 | `claude.ai/code/artifact/d6ec5bba-782d-4f50-b556-0c40a217624e` | 읽기 전용 스냅샷. 아이디·비밀번호로 해제 |

앱은 Claude Artifact 로 게시되어 있고, 데이터는 Artifact 의 `db` 에 있습니다.
**어느 컴퓨터에서든 claude.ai 에 로그인하면 같은 링크로 열립니다.** 이 저장소를 받지 않아도 앱은 씁니다.
이 저장소는 소스를 잃지 않고 이어서 개발하기 위한 것입니다.

## 파일

```
src/mm-admin.html         원장실 앱 전체 (단일 HTML, 외부 의존성 없음)
src/viewer_template.html  열람판 템플릿. __VAULT__ 자리에 암호문이 들어간다
tools/build_viewer.py     DB 스냅샷 + 계정 정보 -> 암호화된 열람판 생성
tools/accounts.example.json  계정 파일 서식
```

## 앱 데이터 구조

`db` 컬렉션 `academy` 아래 문서 9개. 각 문서는 배열을 감싼 객체입니다.

| 문서 | 내용 |
|---|---|
| `roster` | 학생 112명 |
| `staff` | 강사 8명 |
| `classes` | 반 28개 |
| `enrollments` | 수강등록 108건 |
| `payments` | 수납 |
| `calendar` | 일정 |
| `issues` | 정합성 점검 |
| `records` | 기록카드 (성적·성향·방향성) |
| `ops` | 시재 · 테스트 일정 · 문제풀이 출근 |

## 열람판 다시 만들기

1. 앱 DB 스냅샷을 `dbsnap/academy/*.json` 으로 내려받습니다
   (Claude Code 에서 Artifact `read_db`, `db_op: list`, `out_dir` 사용)
2. `tools/accounts.example.json` 을 `tools/accounts.json` 으로 복사해 비밀번호를 채웁니다
3. `python tools/build_viewer.py` → `vault.json` 과 `mm-viewer.html` 생성
   (`src/viewer_template.html` 의 `__VAULT__` 자리에 암호문을 넣어 준 결과물입니다)
4. `mm-viewer.html` 을 열람판 Artifact 로 게시

`tier` 가 `full` 인 계정은 전 자료를, `limited` 인 계정은 반 편성과 일정만 봅니다.
등급마다 다른 키로 암호화하므로 제한 계정은 전체본을 **복호화 자체가 불가능**합니다.

필요 패키지: `cryptography`

## 저장소에 넣지 않는 것

학생 실명·학교·연락처가 들어가는 데이터 파일과 비밀번호는 `.gitignore` 로 제외합니다.
데이터의 원본은 앱 DB이며, 필요할 때 다시 내려받습니다.

## 주의

- 데이터를 고치는 곳은 **원장실 앱 한 곳**입니다. 구글시트는 원본이 아니라 보관용입니다
- 열람판은 스냅샷이라 자동으로 갱신되지 않습니다. 다시 만들어 게시해야 합니다
- 한글 UI 에 라틴 전용 모노 서체(IBM Plex Mono 등)를 숫자 클래스로 붙이면 한글이 깨집니다.
  숫자 전용 클래스와 한글 혼용 클래스를 분리해 두었습니다
