# platform/ — 판매용 새 서버 (개발 중)

지금 운영 중인 대시보드(`webapp/`, `docs/`)와 **무관한** 새 서버 작업 폴더입니다.
여기서 무엇을 바꿔도 현재 대시보드·구글 시트에는 영향이 없습니다. 설계는 [ARCHITECTURE.md](ARCHITECTURE.md) 참고.

```
platform/
  ARCHITECTURE.md                     설계서
  supabase/migrations/0001_platform.sql      학원·요금제·직원·비밀값·감사 기록·문자 발송함
  supabase/migrations/0002_academy_data.sql  학원 데이터 (옛 시트 탭 → 표)
  supabase/migrations/0003_security.sql      학원 간 차단(RLS)·권한·연결 금지
  supabase/tests/                     로컬 테스트용 (Supabase 에는 올리지 않음)
  migrate/import-sheet.mjs            구글 시트(xlsx) → 새 DB 이관 스크립트
  scripts/test-db.sh                  전체 자동 테스트
```

## 테스트 (로컬 PostgreSQL 16)

```bash
cd platform/migrate && npm install && cd ..
PGURL=postgres://postgres@localhost:5432 scripts/test-db.sh
```

빈 테스트 DB 를 만들어 마이그레이션 → 보안 테스트(29개) → 이관 테스트(35개)를 돌리고 DB 를 지웁니다.

## 이관 (더블엠 → 새 DB)

원본 시트는 건드리지 않습니다. **백업 사본**에서 [파일 → 다운로드 → Microsoft Excel(.xlsx)] 로 받은 파일만 읽습니다.
받은 파일에는 학생·학부모 개인정보가 들어 있으니 저장소에 올리지 마세요 (`.gitignore` 로 막아 둠).

```bash
cd platform/migrate
node import-sheet.mjs --file 더블엠.xlsx --slug mmmath --name 더블엠수학학원            # 미리보기 (DB 연결 안 함)
DATABASE_URL=... node import-sheet.mjs --file 더블엠.xlsx --slug mmmath --name 더블엠수학학원 --check   # 넣어 보고 되돌림
DATABASE_URL=... node import-sheet.mjs --file 더블엠.xlsx --slug mmmath --name 더블엠수학학원 --apply   # 실제 저장
```

- 한 트랜잭션이라 하나라도 실패하면 전부 취소되고, 저장 후 파일 행 수와 DB 행 수를 대조합니다.
- 문자·AI API 키와 웹푸시 키는 구글 스크립트 속성에 있어 시트에 없습니다. 전환 때 직접 입력합니다.
