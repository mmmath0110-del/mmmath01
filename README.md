# mmmath01

## 문제풀이 근무표

문제풀이 선생님들이 요일별 근무시간과 업무를 직접 등록하는 공유 대시보드입니다.

- 게시 주소: `claude.ai/code/artifact/a92fa528-51cb-4243-8b57-7f1a7bbd542f`
- 소스: `src/tutor-schedule.html` (단일 HTML, Claude Artifact 로 게시)
- 데이터: Artifact `db` 의 `members` (아이디), `shifts` (근무) 컬렉션
- 아이디·PIN 은 원장(관리자)이 앱 안의 **아이디 관리**에서 부여합니다. PIN 은 SHA-256 해시로만 저장됩니다.
- 권한: 로그인한 모든 사용자가 근무를 등록·수정 (본인 것만), 관리자는 전체 수정 + 아이디 관리
- 주간표 / 시트 두 가지 보기, 지난주 복사, CSV 내려받기 지원

