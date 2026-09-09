# mmmath01

## 문제풀이 근무표

문제풀이 선생님들이 요일별 근무시간과 업무를 직접 등록하는 공유 대시보드입니다.
두 가지 배포본이 있고 화면은 같습니다.

| | 위치 | 누가 열 수 있나 |
|---|---|---|
| **웹 앱** (권장) | `docs/` → GitHub Pages, 데이터는 구글시트 | 링크를 아는 사람 누구나. 아이디·비밀번호로 열람 |
| Claude Artifact | `src/tutor-schedule.html` | claude.ai 에 로그인한 같은 조직 사용자만 |

### 웹 앱 설치 (한 번만)

1. **데이터 시트**: 이미 만들어져 있습니다 → [더블엠 문제풀이 근무표](https://docs.google.com/spreadsheets/d/1TNHAyqMIj43wRvaFtAp8eu4KOIPItcWzYy3ZFtxusMs/edit).
   `Code.gs` 의 `SHEET_ID` 에 이 시트 ID 가 들어 있습니다. 다른 시트를 쓰려면 그 값을 바꾸세요.
2. 그 시트에서 메뉴 [확장 프로그램] → [Apps Script] → `webapp/Code.gs` 내용을 붙여넣고 저장.
   함수 목록에서 `setup` 을 골라 ▶ 실행 (권한 허용).
   시트 `members` `shifts` `sessions` 와 관리자 아이디 `wonjang` / 비밀번호 `0000` 이 만들어집니다.
3. [배포] → [새 배포] → 유형 **웹 앱**, 실행 계정 **나**, 액세스 **모든 사용자** → 배포. 나온 URL(`https://script.google.com/macros/s/.../exec`) 복사
4. `docs/config.js` 의 `MM_API_URL` 에 그 URL 을 넣고 커밋
5. GitHub 저장소 [Settings] → [Pages] → Source: **Deploy from a branch**, Branch: `main` / **/docs** → 저장.
   잠시 후 `https://mmmath0110-del.github.io/mmmath01/` 이 열립니다. 이 주소를 선생님들께 공유하세요.
6. 관리자로 들어가 **아이디 관리**에서 비밀번호를 바꾸고 선생님 아이디를 만듭니다.

`Code.gs` 를 고친 뒤에는 [배포] → [배포 관리] → 연필 → **새 버전** 으로 다시 배포해야 반영됩니다.

- 비밀번호는 시트에 솔트 + SHA-256 해시로만 저장됩니다. 로그인 세션은 2주 유지됩니다.
- 권한 검사는 서버(Apps Script)에서 합니다. 선생님은 본인 근무만, 관리자는 전체 + 아이디 관리.
- 데이터는 구글시트에 그대로 보이므로 시트에서 바로 확인·백업할 수 있습니다. 시트를 직접 고치는 것보다 앱에서 고치는 편이 안전합니다.

### Artifact 판

- 게시 주소: `claude.ai/code/artifact/a92fa528-51cb-4243-8b57-7f1a7bbd542f`
- 소스: `src/tutor-schedule.html` (단일 HTML, Claude Artifact 로 게시)
- 데이터: Artifact `db` 의 `members` (아이디), `shifts` (근무) 컬렉션
- 아이디·PIN 은 원장(관리자)이 앱 안의 **아이디 관리**에서 부여합니다. PIN 은 SHA-256 해시로만 저장됩니다.
- 권한: 로그인한 모든 사용자가 근무를 등록·수정 (본인 것만), 관리자는 전체 수정 + 아이디 관리
- 주간표 / 시트 두 가지 보기, 지난주 복사, CSV 내려받기 지원

