// 구글 Apps Script 환경을 흉내 내어 apps-script/import.gs 의 runImport() 를 처음부터 끝까지 실행한다.
// SpreadsheetApp(가짜 학원 시트) · Utilities · UrlFetchApp(→ 로컬 DB 의 import_academy) 를 대신 만들어 넣는다.
// 필요: DATABASE_URL (마이그레이션이 적용된 테스트 DB)
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { makeFixture } from './make-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'));
const xlsx = path.join(dir, 'f.xlsx');
await makeFixture(xlsx);

// 가짜 시트: 날짜 셀은 Date 값 + 구글 화면식 글자 ('2026. 9. 10', '오후 6:00', '2026. 9. 10 오후 3:05:00')
const kor = (h, m) => `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsx);
const fakeSheets = [];
wb.eachSheet((ws) => {
  const vals = [], disp = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (r) => {
    const vr = [], dr = [];
    for (let i = 1; i <= width; i++) {
      let v = r.getCell(i).value;
      if (v instanceof Date) {
        const y = v.getUTCFullYear(), mo = v.getUTCMonth() + 1, d = v.getUTCDate(), h = v.getUTCHours(), mi = v.getUTCMinutes();
        dr.push(y < 1901 ? kor(h, mi) : (h || mi) ? `${y}. ${mo}. ${d} ${kor(h, mi)}:00` : `${y}. ${mo}. ${d}`);
        vr.push(new Date(0));   // 실제 값은 쓰지 않아야 한다 (화면 글자를 써야 함)
      } else { vr.push(v == null ? '' : v); dr.push(v == null ? '' : String(v)); }
    }
    vals.push(vr); disp.push(dr);
  });
  fakeSheets.push({ getName: () => ws.name, getDataRange: () => ({ getValues: () => vals, getDisplayValues: () => disp }) });
});

// 앞 테스트(run.mjs)가 같은 가짜 데이터를 넣어 두었으므로 지운다 (링크·기기 토큰은 전체 학원에서 유일해야 하므로)
execFileSync('psql', [process.env.DATABASE_URL, '-qc', "delete from public.academies where slug = 'fake-academy'"]);
let calls = 0;
const ctx = {
  console: { log: (s) => logs.push(s) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => fakeSheets }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),   // 구글처럼 부호 있는 바이트
  },
  UrlFetchApp: {
    fetch: (url, o) => {
      calls++;
      if (!url.endsWith('/rest/v1/rpc/import_academy')) throw new Error('잘못된 주소 ' + url);
      if (!o.headers.apikey) throw new Error('apikey 헤더 없음');
      const body = JSON.parse(o.payload), pf = path.join(dir, 'p.json'), sf = path.join(dir, 'q.sql');
      fs.writeFileSync(pf, JSON.stringify(body.payload));
      fs.writeFileSync(sf, `\\set p \`cat ${pf}\`\nselect public.import_academy(:'p'::jsonb, ${body.apply}, ${body.replace_existing});\n`);
      try {
        const outp = execFileSync('psql', [process.env.DATABASE_URL, '-tA', '-q', '-v', 'ON_ERROR_STOP=1', '-f', sf], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { getResponseCode: () => 200, getContentText: () => outp.trim() };
      } catch (e) {
        const err = String(e.stderr), msg = (err.match(/ERROR:\s+(.*)/) || [])[1] || err, det = (err.match(/DETAIL:\s+(.*)/) || [])[1] || null;
        return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ code: 'P0001', message: msg, details: det }) };
      }
    },
  },
};
const logs = [];
const code = fs.readFileSync(path.join(here, '..', 'apps-script', 'import.gs'), 'utf8');
vm.createContext(ctx);
vm.runInContext(code + '\nSUPABASE_SECRET_KEY = "sb_secret_test"; ACADEMY_SLUG = "gas-sim"; ACADEMY_NAME = "가짜학원(GAS)";', ctx);

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) fails++; };

// 키가 비어 있으면 아무것도 보내지 않고 멈춘다
vm.runInContext('var __k = SUPABASE_SECRET_KEY; SUPABASE_SECRET_KEY = "";', ctx);
let stopped = false; try { vm.runInContext('runImport()', ctx); } catch (e) { stopped = /비어 있습니다/.test(e.message); }
ok(stopped && calls === 0, 'Secret key 가 없으면 서버에 보내지 않고 멈춘다');
vm.runInContext('SUPABASE_SECRET_KEY = "sb_publishable_x";', ctx);
stopped = false; try { vm.runInContext('runImport()', ctx); } catch (e) { stopped = /Publishable/.test(e.message); }
ok(stopped && calls === 0, 'Publishable key 를 넣으면 알려 주고 멈춘다');
vm.runInContext('SUPABASE_SECRET_KEY = __k;', ctx);

// 한 번 실행 = 점검 + 저장
vm.runInContext('runImport()', ctx);
const text = logs.join('\n');
ok(calls === 2, `서버 호출 2번 (점검 → 저장) (${calls})`);
ok(/점검 통과/.test(text) && /저장 완료/.test(text), '점검 통과 후 저장 완료');
const q = (sql) => execFileSync('psql', [process.env.DATABASE_URL, '-tAc', sql], { encoding: 'utf8' }).trim();
ok(q(`select count(*) from public.students s join public.academies a on a.id = s.academy_id where a.slug = 'gas-sim'`) === '3', '학생 3명 저장');
ok(q(`select start_time::text from public.classes where legacy_id = 'C000000002' and academy_id = (select id from public.academies where slug = 'gas-sim')`) === '18:00:00', '"오후 6:00" 시각 셀 → 18:00');
ok(q(`select birth::text from public.students where legacy_id = 'S0000000002' and academy_id = (select id from public.academies where slug = 'gas-sim')`) === '2013-03-01', '"2013. 3. 1" 날짜 셀 → 2013-03-01');
const kh = q(`select kiosk_pin_hash from app.academy_secrets where academy_id = (select id from public.academies where slug = 'gas-sim')`);
const aid = q(`select id from public.academies where slug = 'gas-sim'`);
ok(kh === crypto.createHash('sha256').update(`${aid}:1234`).digest('hex'), '구글 방식 sha256(부호 있는 바이트)도 Node 와 같은 해시');

// 두 번째 실행은 거부 (이미 들어 있음) → 데이터 그대로
calls = 0; let refused = false;
try { vm.runInContext('runImport()', ctx); } catch (e) { refused = /이미 들어 있습니다/.test(e.message) && /아무것도 저장되지 않았습니다/.test(e.message); }
ok(refused && calls === 1, '두 번 실행하면 점검 단계에서 거부, 저장 안 함');
ok(q(`select count(*) from public.academies where slug = 'gas-sim'`) === '1', '학원은 여전히 1개');

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\nApps Script 모의 실행 실패 ${fails}건` : '\nApps Script 모의 실행 전부 통과');
process.exit(fails ? 1 : 0);
