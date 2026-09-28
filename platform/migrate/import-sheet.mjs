#!/usr/bin/env node
/**
 * xlsx 로 내려받은 구글 시트 → 새 DB 로 학원 1곳을 옮긴다 (개발·테스트용).
 * 실제 이관은 구글 Apps Script(apps-script/이관.gs)로 한다. 둘 다 같은 규칙(transform.cjs)과
 * 같은 DB 함수(public.import_academy)를 쓰므로, 여기서 통과한 것은 Apps Script 에서도 같게 동작한다.
 *
 *   node import-sheet.mjs --file x.xlsx --slug mmmath --name 더블엠수학학원            미리보기 (DB 연결 안 함)
 *   DATABASE_URL=... node import-sheet.mjs --file ... --slug ... --name ... --check    넣어 보고 되돌림
 *   DATABASE_URL=... node import-sheet.mjs --file ... --slug ... --name ... --apply    저장
 *   --replace  같은 slug 학원이 있으면 지우고 다시 (테스트 DB 에서만) · --report out.json  보고서 저장
 */
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hakwonTransform, hakwonReportText } = require('./transform.cjs');

const args = parseArgs(process.argv.slice(2));
if (!args.file || !args.slug || !args.name) {
  console.error('사용법: node import-sheet.mjs --file <xlsx> --slug <주소이름> --name <학원명> [--check | --apply] [--replace] [--report out.json]');
  process.exit(2);
}
const MODE = args.apply ? 'apply' : args.check ? 'check' : 'preview';
const pad = (n) => String(n).padStart(2, '0');

/**
 * exceljs 셀 값 → transform 이 받는 글자·숫자·true/false.
 * 구글 시트 → xlsx 의 날짜·시각은 "시트 시간대의 벽시계 값"이라 exceljs 가 UTC 로 읽는다 → getUTC* 로 꺼내면 한국 시각 그대로.
 */
function cell(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const date = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    const time = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    if (v.getUTCFullYear() < 1901) return time;                                               // 시각만 있는 셀 (1899-12-30 기준)
    if (!v.getUTCHours() && !v.getUTCMinutes() && !v.getUTCSeconds()) return date;            // 날짜만
    return `${date} ${time}:${pad(v.getUTCSeconds())}`;                                       // 날짜+시각 (한국 시각)
  }
  if (typeof v === 'object') {
    if ('result' in v) return cell(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return cell(v.text);
    if ('error' in v) return null;
  }
  return v;
}

async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = {};
  wb.eachSheet((ws) => {
    const header = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { const h = cell(c.value); header[i] = h == null ? null : String(h).trim(); });
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const o = { __row: n }; let any = false;
      header.forEach((h, i) => { if (!h) return; const v = cell(r.getCell(i).value); o[h] = v; if (v != null && String(v).trim() !== '') any = true; });
      if (any) rows.push(o);
    });
    sheets[ws.name] = { rows };
  });
  return sheets;
}

async function callImport(payload, apply) {
  const { default: pg } = await import('pg');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 이 없습니다 (--check / --apply 에 필요)');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query('select public.import_academy($1::jsonb, $2, $3) as counts', [JSON.stringify(payload), apply, !!args.replace]);
    return r.rows[0].counts;
  } catch (e) {
    if (!apply && e.message === 'CHECK_OK') return JSON.parse(e.detail);   // 점검 통과 (DB 가 되돌림)
    throw e;
  } finally {
    await client.end();
  }
}

const sheets = await readWorkbook(args.file);
const { out, report } = hakwonTransform(sheets, { slug: args.slug, name: args.name }, {
  uuid: () => crypto.randomUUID(),
  sha256: (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'),
});
const title = `이관 ${MODE === 'preview' ? '미리보기 (DB 연결 안 함)' : MODE === 'check' ? '점검 (넣어 보고 되돌림)' : '실행'} : ${args.name} (${args.slug})`;
console.log(hakwonReportText(sheets, report, title));
if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));

if (MODE !== 'preview') {
  try {
    const counts = await callImport(out, MODE === 'apply');
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`\n${MODE === 'apply' ? '저장 완료' : '점검 통과 (되돌림, 저장 안 함)'} — 표 ${Object.keys(counts).length}개 · ${n}행, 건수 대조 일치`);
  } catch (e) {
    console.error(`\n실패: ${e.message}\n아무것도 저장되지 않았습니다.`);
    process.exit(1);
  }
}

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2), nx = a[i + 1];
    if (nx != null && !nx.startsWith('--')) { o[k] = nx; i++; } else o[k] = true;
  }
  return o;
}
