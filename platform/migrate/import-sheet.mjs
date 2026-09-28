#!/usr/bin/env node
/**
 * 구글 시트(xlsx 로 내려받은 파일) → 새 DB 로 학원 1곳을 옮긴다.
 *
 *   원본 구글 시트는 절대 건드리지 않는다. 이 스크립트는 내려받은 xlsx 파일만 읽는다.
 *   (구글 시트 → [파일] → [다운로드] → [Microsoft Excel(.xlsx)] 로 받은 파일. 백업 사본에서 받는 것을 권장)
 *
 * 사용법
 *   node import-sheet.mjs --file 더블엠.xlsx --slug mmmath --name 더블엠수학학원
 *       → 미리보기. 파일만 읽고 몇 건이 옮겨지는지·문제 되는 값을 보고한다. DB 에 연결하지 않는다.
 *   DATABASE_URL=... node import-sheet.mjs --file ... --slug ... --name ... --check
 *       → DB 에 실제로 넣어 본 뒤 되돌린다(ROLLBACK). 제약조건·보안 트리거까지 통과하는지 확인용.
 *   DATABASE_URL=... node import-sheet.mjs --file ... --slug ... --name ... --apply
 *       → 실제로 저장한다. 한 트랜잭션이라 중간에 하나라도 실패하면 전부 취소된다.
 *   --replace  같은 slug 의 학원이 이미 있으면 지우고 다시 넣는다 (테스트 DB 에서 재이관할 때만)
 *   --report 파일.json  보고서를 파일로도 남긴다
 */
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import fs from 'node:fs';

// ---------- 인자 ----------
const args = parseArgs(process.argv.slice(2));
if (!args.file || !args.slug || !args.name) {
  console.error('사용법: node import-sheet.mjs --file <xlsx> --slug <주소이름> --name <학원명> [--check | --apply] [--replace] [--report out.json]');
  process.exit(2);
}
const MODE = args.apply ? 'apply' : args.check ? 'check' : 'preview';

// ---------- 값 변환 ----------
const pad = (n) => String(n).padStart(2, '0');
const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/** exceljs 셀 값 → 원시값 (서식 있는 글자·수식·링크 풀기) */
function plain(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return plain(v.text);
    if ('error' in v) return null;
  }
  return v;
}

/**
 * 구글 시트 → xlsx 는 날짜·시각을 "시트 시간대의 벽시계 값"으로 적는다.
 * exceljs 는 그 값을 UTC 로 읽으므로 getUTC* 로 꺼내면 한국 시각 그대로다.
 */
function toDate(v, w, where) {
  v = plain(v); if (isBlank(v)) return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^\d{4}-\d{2}-\d{2}T/);   // ISO 시각이 날짜 칸에 들어간 경우 → 한국 날짜로
  if (m) { const d = new Date(s); if (!isNaN(d)) return kstParts(d).date; }
  w.warn(where, `날짜로 읽을 수 없는 값 "${s}" → 비움`);
  return null;
}
function toTime(v, w, where) {
  v = plain(v); if (isBlank(v)) return null;
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v >= 0 && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
  const s = String(v).trim();
  const m = s.match(/(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})/i);
  if (m) {
    let h = +m[2];
    if (/오후|PM/i.test(m[1] || '') && h < 12) h += 12;
    if (/오전|AM/i.test(m[1] || '') && h === 12) h = 0;
    if (h < 24 && +m[3] < 60) return `${pad(h)}:${m[3]}`;
  }
  w.warn(where, `시각으로 읽을 수 없는 값 "${s}" → 비움`);
  return null;
}
function kstParts(d) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  return { date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
           time: `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())}` };
}
/** 타임스탬프. ISO 문자열이면 그대로, 날짜 셀이면 한국 시각으로 본다 */
function toTs(v, w, where) {
  v = plain(v); if (isBlank(v)) return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}+09:00`;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !isNaN(new Date(s))) return s;
  const m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*(?:(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let h = +(m[5] || 0);
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(h)}:${pad(m[6] || 0)}:${pad(m[7] || 0)}+09:00`;
  }
  w.warn(where, `시각으로 읽을 수 없는 값 "${s}" → 비움`);
  return null;
}
function toInt(v, w, where) {
  v = plain(v); if (isBlank(v)) return null;
  const n = Number(String(v).replace(/[,\s원]/g, ''));
  if (Number.isFinite(n)) return Math.round(n);
  w.warn(where, `숫자로 읽을 수 없는 값 "${v}" → 비움`); return null;
}
function toNum(v, w, where) {
  v = plain(v); if (isBlank(v)) return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  if (Number.isFinite(n)) return n;
  w.warn(where, `숫자로 읽을 수 없는 값 "${v}" → 비움`); return null;
}
function toBool(v) {
  v = plain(v);
  if (v === true || v === 1) return true;
  return /^(true|1|y|yes|o|on)$/i.test(String(v ?? '').trim());
}
function toText(v) {
  v = plain(v); if (isBlank(v)) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
/** jsonb 칸: 검사한 뒤 JSON 글자로 넘긴다 (JS 배열을 그대로 넘기면 pg 가 DB 배열로 바꿔 버린다) */
function toJson(v, w, where) {
  const s = toText(v); if (s == null) return null;
  try { return JSON.stringify(JSON.parse(s)); } catch { w.warn(where, `JSON 이 아닌 값 → 글자 그대로 보관`); return JSON.stringify({ raw: s }); }
}
/** 전화번호: 숫자만. 시트가 숫자로 바꿔 앞자리 0 이 빠졌으면(10XXXXXXXX) 되살린다 */
function toPhone(v, w, where) {
  const s = toText(v); if (s == null) return null;
  let d = s.replace(/\D/g, '');
  if (/^1[016789]\d{7,8}$/.test(d)) { d = '0' + d; w.info(where, '전화번호 앞자리 0 복원'); }
  if (!/^0\d{8,10}$/.test(d)) w.warn(where, `전화번호 형식이 이상함 "${s}" (그대로 보관)`);
  return d || null;
}
const list = (v) => (toText(v) || '').split(',').map((x) => x.trim()).filter(Boolean);
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

// ---------- 보고서 ----------
class Report {
  constructor() { this.tables = {}; this.warnings = []; this.infos = {}; this.skipped = []; }
  warn(where, msg) { this.warnings.push(`${where}: ${msg}`); }
  info(where, msg) { const k = `${where.split(' ')[0]}: ${msg}`; this.infos[k] = (this.infos[k] || 0) + 1; }
  count(table, n) { this.tables[table] = (this.tables[table] || 0) + n; }
}

// ---------- 시트 읽기 ----------
async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = {};
  wb.eachSheet((ws) => {
    const header = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = toText(c.value); });
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const o = {}; let any = false;
      header.forEach((h, i) => { if (!h) return; const v = r.getCell(i).value; o[h] = v; if (!isBlank(plain(v))) any = true; });
      if (any) { o.__row = n; rows.push(o); }
    });
    sheets[ws.name] = { header: header.filter(Boolean), rows };
  });
  return sheets;
}

// ---------- 변환 (시트 → 테이블 행) ----------
function transform(sheets, rep) {
  const academyId = crypto.randomUUID();
  const out = {};          // table → rows[]
  const ids = {};          // sheet → Map(legacyId → uuid)
  const push = (t, row) => { (out[t] ||= []).push(row); };
  const rowsOf = (name) => (sheets[name]?.rows || []);
  const where = (sheet, r, col) => `${sheet} ${r.__row}행${col ? ' ' + col : ''}`;
  const w = rep;

  // legacy id → 새 uuid 를 먼저 모두 정해 둔다 (서로 참조하므로)
  const idSheets = ['students', 'classes', 'enrollments', 'exams', 'makeups', 'attChecks', 'payments', 'members'];
  for (const s of idSheets) {
    ids[s] = new Map();
    for (const r of rowsOf(s)) {
      const k = toText(r.id); if (!k) continue;
      if (ids[s].has(k)) { w.warn(where(s, r), `id "${k}" 중복 → 뒤의 행은 건너뜀`); r.__dup = true; continue; }
      ids[s].set(k, crypto.randomUUID());
    }
  }
  const ref = (sheet, v, r, col, fromSheet) => {
    const k = toText(v); if (!k) return null;
    const u = ids[sheet].get(k);
    if (!u) w.warn(where(fromSheet, r, col), `"${k}" 를 ${sheet} 에서 찾을 수 없음 → 비움`);
    return u || null;
  };
  // 직원 아이디 → staff uuid (옛 시스템은 teacherId·memberId 에 로그인 아이디를 적었다)
  const staffRef = (v, r, col, fromSheet) => {
    const k = toText(v); if (!k) return null;
    const u = ids.members.get(k.toLowerCase()) || ids.members.get(k);
    if (!u) w.warn(where(fromSheet, r, col), `직원 아이디 "${k}" 없음 → 비움`);
    return u || null;
  };
  const each = (sheet, fn) => {
    for (const r of rowsOf(sheet)) {
      if (r.__dup) continue;
      const row = fn(r);
      if (row) push(row.__table, { academy_id: academyId, ...row, __table: undefined });
    }
  };
  const base = (sheet, r, table) => ({ __table: table, id: ids[sheet]?.get(toText(r.id)) || crypto.randomUUID(), legacy_id: toText(r.id) });
  const need = (val, sheet, r, what) => { if (val == null) { w.warn(where(sheet, r), `${what} 없음 → 행 건너뜀`); rep.skipped.push(where(sheet, r)); return false; } return true; };
  const D = (s, r, c) => toDate(r[c], w, where(s, r, c));
  const T = (s, r, c) => toTime(r[c], w, where(s, r, c));
  const TS = (s, r, c) => toTs(r[c], w, where(s, r, c));
  const I = (s, r, c) => toInt(r[c], w, where(s, r, c));
  const N = (s, r, c) => toNum(r[c], w, where(s, r, c));
  const J = (s, r, c) => toJson(r[c], w, where(s, r, c));
  const P = (s, r, c) => toPhone(r[c], w, where(s, r, c));
  const X = (r, c) => toText(r[c]);
  const now = new Date().toISOString();

  // 학원
  push('academies', { id: academyId, slug: args.slug, name: args.name, status: 'active', plan_id: 'pro', test_mode: true });

  // 직원 (members): 아이디는 소문자로 맞춘다. 옛 비밀번호 해시는 app.staff_legacy_credentials 로
  for (const r of rowsOf('members')) {
    if (r.__dup) continue;
    const login = X(r, 'id'); if (!login) continue;
    const id = ids.members.get(login);
    ids.members.set(login.toLowerCase(), id);
    push('staff', { id, academy_id: academyId, legacy_id: login, login_id: login.toLowerCase(), name: X(r, 'name') || login,
      role: X(r, 'role') === 'admin' ? 'admin' : 'teacher', color: X(r, 'color'), active: r.active == null ? true : toBool(r.active),
      phone: P('members', r, 'phone'), created_at: TS('members', r, 'createdAt') || now });
    push('app.staff_legacy_credentials', { staff_id: id, salt: X(r, 'salt'), pw_hash: X(r, 'pwHash'), pin_salt: X(r, 'pinSalt'), pin_hash: X(r, 'pinHash') });
  }

  each('students', (r) => {
    const s = 'students';
    return { ...base(s, r, 'students'), name: X(r, 'name') || '(이름 없음)', status: X(r, 'status') || '재원', school: X(r, 'school'),
      grade: X(r, 'grade'), birth: D(s, r, 'birth'), phone: P(s, r, 'phone'), parent_phone: P(s, r, 'parentPhone'),
      parent_name: X(r, 'parentName'), enrolled_at: D(s, r, 'enrolledAt'), left_at: D(s, r, 'leftAt'), memo: X(r, 'memo'),
      ext_id: X(r, 'extId'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('classes', (r) => {
    const s = 'classes';
    return { ...base(s, r, 'classes'), name: X(r, 'name') || '(반 이름 없음)', subject: X(r, 'subject'),
      teacher_id: staffRef(r.teacherId, r, 'teacherId', s), days: X(r, 'days'), start_time: T(s, r, 'start'), end_time: T(s, r, 'end'),
      room: X(r, 'room'), fee: I(s, r, 'fee'), status: X(r, 'status') || '운영', memo: X(r, 'memo'),
      created_at: TS(s, r, 'createdAt') || now, schedule: X(r, 'schedule'), textbook: X(r, 'textbook'), progress: X(r, 'progress'),
      lesson_note: X(r, 'lessonNote'), kind: X(r, 'kind') };
  });
  each('textbooks', (r) => ({ ...base('textbooks', r, 'textbooks'), name: X(r, 'name') || '(교재)', subject: X(r, 'subject'),
    grade: X(r, 'grade'), created_at: TS('textbooks', r, 'createdAt') || now }));
  each('enrollments', (r) => {
    const s = 'enrollments', st = ref('students', r.studentId, r, 'studentId', s), c = ref('classes', r.classId, r, 'classId', s);
    if (!need(st, s, r, '학생') || !need(c, s, r, '반')) return null;
    return { ...base(s, r, s), student_id: st, class_id: c, start_date: D(s, r, 'startDate'), end_date: D(s, r, 'endDate'),
      fee: I(s, r, 'fee'), created_at: TS(s, r, 'createdAt') || now, end_reason: X(r, 'endReason'), deleted: toBool(r.deleted),
      updated_at: TS(s, r, 'updatedAt') || now, updated_by: staffRef(r.updatedBy, r, 'updatedBy', s) };
  });
  each('attendance', (r) => {
    const s = 'attendance', st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜')) return null;
    return { ...base(s, r, s), date, class_id: ref('classes', r.classId, r, 'classId', s), student_id: st,
      status: X(r, 'status') || '', note: X(r, 'note'), updated_by: X(r, 'updatedBy'), updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('checkins', (r) => {
    const s = 'checkins', st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date'), time = T(s, r, 'time');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜') || !need(time, s, r, '시각')) return null;
    return { ...base(s, r, s), date, time, student_id: st, kind: X(r, 'kind') || '', class_id: ref('classes', r.classId, r, 'classId', s),
      device: X(r, 'device'), sms: X(r, 'sms'), created_at: TS(s, r, 'createdAt') || now };
  });
  each('payments', (r) => {
    const s = 'payments', st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date'), amount = I(s, r, 'amount');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜') || !need(amount, s, r, '금액')) return null;
    return { ...base(s, r, s), date, student_id: st, month: X(r, 'month'), item: X(r, 'item'), amount, method: X(r, 'method'),
      class_id: ref('classes', r.classId, r, 'classId', s), note: X(r, 'note'), created_by: X(r, 'createdBy'),
      created_at: TS(s, r, 'createdAt') || now };
  });
  each('exams', (r) => {
    const s = 'exams';
    const cls = [...new Set([...list(r.classIds), ...list(r.classId)])].map((c) => ref('classes', c, r, 'classIds', s)).filter(Boolean);
    return { ...base(s, r, s), date: D(s, r, 'date'), class_ids: cls, name: X(r, 'name') || '(시험)', max_score: N(s, r, 'maxScore'),
      memo: X(r, 'memo'), questions: J(s, r, 'questions'), mode: X(r, 'mode'), obj_max: N(s, r, 'objMax'), essay_max: N(s, r, 'essayMax'),
      created_at: TS(s, r, 'createdAt') || now };
  });
  const seenScore = new Set();
  each('scores', (r) => {
    const s = 'scores', ex = ref('exams', r.examId, r, 'examId', s), st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(ex, s, r, '시험') || !need(st, s, r, '학생')) return null;
    if (seenScore.has(ex + st)) { w.warn(where(s, r), '같은 시험·학생 점수가 두 번 → 뒤의 행 건너뜀'); return null; }
    seenScore.add(ex + st);
    return { ...base(s, r, s), exam_id: ex, student_id: st, score: N(s, r, 'score'), note: X(r, 'note'),
      class_id: ref('classes', r.classId, r, 'classId', s), updated_at: TS(s, r, 'updatedAt') || now, wrong: J(s, r, 'wrong'),
      parts: J(s, r, 'parts'), obj: N(s, r, 'obj'), essay: N(s, r, 'essay') };
  });
  each('reports', (r) => {
    const s = 'reports', st = ref('students', r.studentId, r, 'studentId', s), ws = D(s, r, 'weekStart'), we = D(s, r, 'weekEnd');
    if (!need(st, s, r, '학생') || !need(ws, s, r, '주 시작일') || !need(we, s, r, '주 종료일')) return null;
    return { ...base(s, r, s), student_id: st, week_start: ws, week_end: we, status: X(r, 'status') || 'draft', body: X(r, 'body'),
      data: J(s, r, 'data'), created_at: TS(s, r, 'createdAt') || now, created_by: X(r, 'createdBy'), approved_by: X(r, 'approvedBy'),
      approved_at: TS(s, r, 'approvedAt'), sent_at: TS(s, r, 'sentAt'), sms: X(r, 'sms'), model: X(r, 'model') };
  });
  each('consults', (r) => {
    const s = 'consults', date = D(s, r, 'date');
    if (!need(date, s, r, '날짜')) return null;
    return { ...base(s, r, s), date, time: T(s, r, 'time'), type: X(r, 'type'), student_id: ref('students', r.studentId, r, 'studentId', s),
      name: X(r, 'name'), phone: P(s, r, 'phone'), school: X(r, 'school'), grade: X(r, 'grade'), content: X(r, 'content'),
      next_date: D(s, r, 'nextDate'), member_id: staffRef(r.memberId, r, 'memberId', s), created_at: TS(s, r, 'createdAt') || now,
      updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('messages', (r) => {
    const s = 'messages', at = TS(s, r, 'sentAt');
    if (!need(at, s, r, '발송 시각')) return null;
    return { ...base(s, r, s), sent_at: at, kind: X(r, 'kind'), count: I(s, r, 'count'), recipients: X(r, 'recipients'),
      body: X(r, 'body'), method: X(r, 'method'), result: X(r, 'result'), sent_by: X(r, 'sentBy') };
  });
  each('extSchedules', (r) => {
    const s = 'extSchedules', st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(st, s, r, '학생')) return null;
    return { ...base(s, r, 'ext_schedules'), student_id: st, name: X(r, 'name'), day: X(r, 'day'), start_time: T(s, r, 'start'),
      end_time: T(s, r, 'end'), memo: X(r, 'memo'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  const seenLink = new Set();
  for (const r of rowsOf('scheduleLinks')) {
    const s = 'scheduleLinks', st = ref('students', r.studentId, r, 'studentId', s), tok = X(r, 'token');
    if (!st || !tok) { w.warn(where(s, r), '학생 또는 토큰 없음 → 건너뜀'); continue; }
    if (seenLink.has(st)) { w.warn(where(s, r), '같은 학생 링크 두 번 → 뒤의 행 건너뜀'); continue; }
    seenLink.add(st);
    // 원문 토큰은 저장하지 않는다. 이미 보낸 링크는 새 서버가 sha256(토큰)으로 찾는다
    push('schedule_links', { academy_id: academyId, student_id: st, token_hash: sha256(tok), active: r.active == null ? true : toBool(r.active),
      created_at: TS(s, r, 'createdAt') || now, expires_at: TS(s, r, 'expiresAt'), submitted_at: TS(s, r, 'submittedAt') });
  }
  each('changes', (r) => {
    const s = 'changes', at = TS(s, r, 'at');
    if (!need(at, s, r, '시각')) return null;
    return { ...base(s, r, s), at, member_id: X(r, 'memberId'), member_name: X(r, 'memberName'), type: X(r, 'type'),
      student_id: ref('students', r.studentId, r, 'studentId', s), class_id: ref('classes', r.classId, r, 'classId', s),
      before: X(r, 'before'), after: X(r, 'after'), note: X(r, 'note') };
  });
  each('makeups', (r) => {
    const s = 'makeups', date = D(s, r, 'date');
    if (!need(date, s, r, '날짜')) return null;
    return { ...base(s, r, s), date, start_time: T(s, r, 'start'), end_time: T(s, r, 'end'),
      class_id: ref('classes', r.classId, r, 'classId', s), teacher_id: staffRef(r.teacherId, r, 'teacherId', s),
      student_ids: list(r.studentIds).map((x) => ref('students', x, r, 'studentIds', s)).filter(Boolean),
      title: X(r, 'title'), reason: X(r, 'reason'), memo: X(r, 'memo'), status: X(r, 'status'), notified_at: TS(s, r, 'notifiedAt'),
      created_at: TS(s, r, 'createdAt') || now, created_by: X(r, 'createdBy'), updated_at: TS(s, r, 'updatedAt') || now,
      updated_by: X(r, 'updatedBy'), deleted: toBool(r.deleted), deleted_at: TS(s, r, 'deletedAt'), deleted_by: X(r, 'deletedBy'),
      reminded_at: TS(s, r, 'remindedAt') };
  });
  each('mkRequests', (r) => {
    const s = 'mkRequests';
    return { ...base(s, r, 'mk_requests'), created_at: TS(s, r, 'createdAt') || now, teacher_id: staffRef(r.teacherId, r, 'teacherId', s),
      names: X(r, 'names'), date: D(s, r, 'date'), start_time: T(s, r, 'start'), end_time: T(s, r, 'end'), title: X(r, 'title'),
      note: X(r, 'note'), status: X(r, 'status') || '대기', handled_by: X(r, 'handledBy'), handled_at: TS(s, r, 'handledAt'),
      makeup_id: ref('makeups', r.makeupId, r, 'makeupId', s), reply: X(r, 'reply') };
  });
  each('events', (r) => {
    const s = 'events', date = D(s, r, 'date');
    if (!need(date, s, r, '날짜')) return null;
    return { ...base(s, r, s), date, end_date: D(s, r, 'endDate'), type: X(r, 'type'), title: X(r, 'title'), target: X(r, 'target'),
      note: X(r, 'note'), school: X(r, 'school'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('tests', (r) => ({ ...base('tests', r, 'tests'), date: D('tests', r, 'date'), title: X(r, 'title'), type: X(r, 'type'),
    target: X(r, 'target'), teacher: X(r, 'teacher'), scope: X(r, 'scope'), note: X(r, 'note'), done: toBool(r.done),
    created_at: TS('tests', r, 'createdAt') || now, updated_at: TS('tests', r, 'updatedAt') || now }));
  each('supplies', (r) => ({ ...base('supplies', r, 'supplies'), name: X(r, 'name') || '(품목)', category: X(r, 'category'),
    qty: N('supplies', r, 'qty'), min_qty: N('supplies', r, 'minQty'), unit: X(r, 'unit'), last_in: D('supplies', r, 'lastIn'),
    vendor: X(r, 'vendor'), note: X(r, 'note'), updated_at: TS('supplies', r, 'updatedAt') || now }));
  each('issues', (r) => ({ ...base('issues', r, 'issues'), category: X(r, 'category'), target: X(r, 'target'), detail: X(r, 'detail'),
    action: X(r, 'action'), priority: X(r, 'priority'), done: toBool(r.done), created_at: TS('issues', r, 'createdAt') || now,
    updated_at: TS('issues', r, 'updatedAt') || now }));
  const PROFILE = { attitude: 'attitude', homework: 'homework', style: 'style', strength: 'strength', weakness: 'weakness', mental: 'mental',
    peer: 'peer', parent: 'parent', traitMemo: 'trait_memo', policy: 'policy', roadmap: 'roadmap', nextStep: 'next_step', risk: 'risk',
    riskWhy: 'risk_why', watch: 'watch', track: 'track', admType: 'adm_type', univ1: 'univ1', major1: 'major1', univ2: 'univ2',
    major2: 'major2', targetInner: 'target_inner', curInner: 'cur_inner', targetMock: 'target_mock', curMock: 'cur_mock', careerMemo: 'career_memo' };
  const seenProfile = new Set();
  for (const r of rowsOf('profiles')) {
    const s = 'profiles', st = ref('students', r.studentId, r, 'studentId', s);
    if (!st || seenProfile.has(st)) { if (st) w.warn(where(s, r), '같은 학생 기록카드 두 번 → 뒤의 행 건너뜀'); continue; }
    seenProfile.add(st);
    const row = { academy_id: academyId, student_id: st, updated_at: TS(s, r, 'updatedAt') || now };
    for (const [k, col] of Object.entries(PROFILE)) row[col] = X(r, k);
    push('student_profiles', row);
  }
  const GB = ['kind', 'year', 'term', 'exam', 'subject', 'score', 'avg', 'rank', 'total', 'level', 'weak', 'note', 'org', 'round', 'raw',
    'std', 'pct', 'type', 'scope', 'max', 'submit'];
  each('gradebook', (r) => {
    const s = 'gradebook', st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(st, s, r, '학생')) return null;
    const row = { ...base(s, r, s), student_id: st, date: D(s, r, 'date'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
    for (const k of GB) row[k] = X(r, k);
    return row;
  });
  each('bills', (r) => {
    const s = 'bills', st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(st, s, r, '학생')) return null;
    return { ...base(s, r, s), student_id: st, kind: X(r, 'kind'), course: X(r, 'course'), term: X(r, 'term'), teacher: X(r, 'teacher'),
      billed: I(s, r, 'billed') ?? 0, discount: I(s, r, 'discount') ?? 0, paid: I(s, r, 'paid') ?? 0, status: X(r, 'status'),
      method: X(r, 'method'), paid_at: D(s, r, 'paidAt'), handler: X(r, 'handler'), note: X(r, 'note'),
      payment_id: ref('payments', r.paymentId, r, 'paymentId', s), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  const checkStudent = new Map();
  each('attChecks', (r) => {
    const s = 'attChecks', st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜')) return null;
    const b = base(s, r, 'att_checks'); checkStudent.set(b.id, st);
    return { ...b, date, student_id: st, student_name: X(r, 'studentName'), class_id: ref('classes', r.classId, r, 'classId', s),
      class_name: X(r, 'className'), makeup_id: ref('makeups', r.makeupId, r, 'makeupId', s), teacher_id: staffRef(r.teacherId, r, 'teacherId', s),
      due: T(s, r, 'due'), status: X(r, 'status') || '확인필요', reason: X(r, 'reason'), detected_at: TS(s, r, 'detectedAt'),
      alert_to: X(r, 'alertTo'), alert1_at: TS(s, r, 'alert1At'), alert2_at: TS(s, r, 'alert2At'), checked_by: X(r, 'checkedBy'),
      checked_by_name: X(r, 'checkedByName'), checked_at: TS(s, r, 'checkedAt'), check_method: X(r, 'checkMethod'), first_by: X(r, 'firstBy'),
      sms_at: TS(s, r, 'smsAt'), sms_student: X(r, 'smsStudent'), sms_parent: X(r, 'smsParent'), sms_ids: X(r, 'smsIds'),
      arrived_at: X(r, 'arrivedAt'), late_min: I(s, r, 'lateMin'), version: I(s, r, 'version') ?? 1, updated_at: TS(s, r, 'updatedAt') || now,
      note: X(r, 'note'), seen_by: X(r, 'seenBy') };
  });
  each('attCheckLog', (r) => {
    const s = 'attCheckLog', ck = ref('attChecks', r.checkId, r, 'checkId', s), at = TS(s, r, 'at');
    if (!need(at, s, r, '시각')) return null;
    return { ...base(s, r, 'att_check_log'), date: D(s, r, 'date'), check_id: ck, student_id: ck ? checkStudent.get(ck) : null, at,
      by: X(r, 'by'), by_name: X(r, 'byName'), from_status: X(r, 'from'), to_status: X(r, 'to'), note: X(r, 'note') };
  });
  const seenLog = new Set();
  each('logs', (r) => {
    const s = 'logs', sf = staffRef(r.memberId, r, 'memberId', s), date = D(s, r, 'date');
    if (!need(sf, s, r, '직원') || !need(date, s, r, '날짜')) return null;
    if (seenLog.has(sf + date)) { w.warn(where(s, r), '같은 직원·날짜 근무일지 두 번 → 뒤의 행 건너뜀'); return null; }
    seenLog.add(sf + date);
    return { ...base(s, r, 'work_logs'), date, staff_id: sf, check_in: T(s, r, 'checkIn'), check_out: T(s, r, 'checkOut'),
      work: X(r, 'work'), note: X(r, 'note'), updated_by: X(r, 'updatedBy'), updated_at: TS(s, r, 'updatedAt') || now, fixed_by: X(r, 'fixedBy') };
  });
  each('shifts', (r) => ({ ...base('shifts', r, 'shifts'), week: X(r, 'week'), day: X(r, 'day'),
    staff_id: staffRef(r.memberId, r, 'memberId', 'shifts'), start_time: T('shifts', r, 'start'), end_time: T('shifts', r, 'end'),
    tasks: X(r, 'tasks'), note: X(r, 'note'), updated_by: X(r, 'updatedBy'), updated_at: TS('shifts', r, 'updatedAt') || now }));
  const seenEndpoint = new Set();
  each('pushSubs', (r) => {
    const s = 'pushSubs', sf = staffRef(r.memberId, r, 'memberId', s), ep = X(r, 'endpoint');
    if (!need(sf, s, r, '직원') || !need(ep, s, r, 'endpoint') || seenEndpoint.has(ep)) return null;
    seenEndpoint.add(ep);
    return { ...base(s, r, 'push_subs'), staff_id: sf, endpoint: ep, p256dh: X(r, 'p256dh') || '', auth: X(r, 'auth') || '', ua: X(r, 'ua'),
      created_at: TS(s, r, 'createdAt') || now, last_ok: TS(s, r, 'lastOk'), fails: I(s, r, 'fails') ?? 0 };
  });
  each('blogPosts', (r) => {
    const s = 'blogPosts';
    const row = { ...base(s, r, 'blog_posts'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now,
      status: X(r, 'status'), url: X(r, 'url'), published_at: TS(s, r, 'publishedAt'), created_by: X(r, 'createdBy') };
    for (const k of ['keyword', 'type', 'title', 'titles', 'body', 'meta', 'tags', 'alt', 'todo', 'sources']) row[k] = X(r, k);
    return row;
  });

  // 설정 (settings: key/value) → 일반 설정 · 비밀값 · 상태값 · 태블릿으로 나눈다
  const settings = {}, secrets = { academy_id: academyId, extra: {} };
  const GENERAL = new Set(['travelBuffer', 'prorate', 'kioskSms', 'kioskMsgIn', 'kioskMsgOut', 'kioskStaffPin', 'reportStyle', 'reportRank', 'reportDay']);
  for (const r of rowsOf('settings')) {
    const key = X(r, 'key'); if (!key) continue;
    const raw = X(r, 'value');
    if (key === 'kioskPin') {
      if (raw) secrets.kiosk_pin_hash = sha256(`${academyId}:${raw}`);   // 평문 PIN 을 해시로 바꿔 보관
    } else if (key === 'kioskDevices') {
      let devs = []; try { devs = JSON.parse(raw || '[]') || []; } catch { w.warn('settings kioskDevices', 'JSON 아님 → 태블릿 재등록 필요'); }
      const seenTok = new Set();
      for (const d of devs) {
        if (!d || !d.token || seenTok.has(d.token)) continue;
        seenTok.add(d.token);
        push('kiosk_devices', { academy_id: academyId, name: String(d.name || '태블릿'), token_hash: sha256(d.token),
          created_at: toTs(d.createdAt, w, 'settings kioskDevices') || now, last_seen: toTs(d.lastUsed, w, 'settings kioskDevices') });
      }
    } else if (key === 'rosterSync' || key === 'rosterExport') {
      push('academy_kv', { academy_id: academyId, key, value: toJson(raw, w, `settings ${key}`) });
    } else if (GENERAL.has(key)) {
      settings[key] = raw;
    } else {
      // adminMeta·blogProfile 등 JSON 설정은 풀어서, 아니면 글자 그대로
      let v = raw; try { v = JSON.parse(raw); } catch { /* 글자 그대로 */ }
      settings[key] = v;
      if (!['adminMeta', 'blogProfile'].includes(key)) w.info('settings', `알 수 없는 설정 키 "${key}" → 일반 설정에 보관`);
    }
  }
  push('academy_settings', { academy_id: academyId, brand: { displayName: args.name }, settings });
  push('app.academy_secrets', secrets);

  // 옮기지 않는 시트
  for (const name of Object.keys(sheets)) {
    if (name === 'sessions') rep.info('sessions', '로그인 세션은 옮기지 않음 (전환 후 한 번 다시 로그인)');
    else if (!KNOWN_SHEETS.has(name)) rep.warn(name, `알 수 없는 시트 (행 ${sheets[name].rows.length}개) → 옮기지 않음. 확인 필요`);
  }
  for (const [t, rows] of Object.entries(out)) rep.count(t, rows.length);
  return { academyId, out };
}
const KNOWN_SHEETS = new Set(['members', 'logs', 'sessions', 'shifts', 'students', 'classes', 'enrollments', 'attendance', 'checkins', 'payments',
  'exams', 'scores', 'reports', 'consults', 'messages', 'textbooks', 'extSchedules', 'scheduleLinks', 'settings', 'changes', 'makeups',
  'mkRequests', 'events', 'tests', 'supplies', 'issues', 'profiles', 'gradebook', 'bills', 'attChecks', 'attCheckLog', 'pushSubs', 'blogPosts', '시트1']);

// ---------- DB 저장 ----------
// 참조 순서대로 넣는다
const ORDER = ['academies', 'academy_settings', 'app.academy_secrets', 'staff', 'app.staff_legacy_credentials', 'students', 'classes',
  'textbooks', 'enrollments', 'attendance', 'checkins', 'payments', 'exams', 'scores', 'reports', 'consults', 'messages', 'ext_schedules',
  'schedule_links', 'academy_kv', 'changes', 'makeups', 'mk_requests', 'events', 'tests', 'supplies', 'issues', 'student_profiles',
  'gradebook', 'bills', 'att_checks', 'att_check_log', 'work_logs', 'shifts', 'push_subs', 'kiosk_devices', 'blog_posts'];

async function load(out, commit) {
  const { default: pg } = await import('pg');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 이 없습니다 (--check / --apply 에 필요)');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    const exist = await client.query('select id from public.academies where slug = $1', [args.slug]);
    if (exist.rowCount) {
      if (!args.replace) throw new Error(`slug "${args.slug}" 학원이 이미 있습니다. 다시 넣으려면 --replace (테스트 DB 에서만)`);
      await client.query('delete from public.academies where slug = $1', [args.slug]);
      console.log(`기존 "${args.slug}" 학원 데이터를 지웠습니다 (--replace)`);
    }
    for (const t of ORDER) {
      const rows = out[t]; if (!rows?.length) continue;
      const cols = Object.keys(rows[0]).filter((c) => c !== '__table');
      const tbl = t.includes('.') ? t : `public.${t}`;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200), vals = [], ph = [];
        chunk.forEach((r, j) => {
          ph.push('(' + cols.map((c, k) => `$${j * cols.length + k + 1}`).join(',') + ')');
          cols.forEach((c) => { const v = r[c]; vals.push(v != null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v ?? null); });
        });
        try {
          await client.query(`insert into ${tbl} (${cols.map((c) => `"${c}"`).join(',')}) values ${ph.join(',')}`, vals);
        } catch (e) {
          throw new Error(`${t} 저장 실패: ${e.message}`);
        }
      }
    }
    // 대조: 넣은 건수와 DB 건수가 같아야 한다
    const counts = {};
    for (const t of ORDER) {
      if (!out[t]?.length) continue;
      const tbl = t.includes('.') ? t : `public.${t}`;
      const q = t === 'academies' ? `select count(*) from ${tbl} where id = $1`
        : t.startsWith('app.staff_legacy') ? `select count(*) from ${tbl} c join public.staff s on s.id = c.staff_id where s.academy_id = $1`
        : `select count(*) from ${tbl} where academy_id = $1`;
      counts[t] = Number((await client.query(q, [out.academies[0].id])).rows[0].count);
    }
    const mismatch = Object.entries(counts).filter(([t, n]) => n !== out[t].length);
    if (mismatch.length) throw new Error('건수 불일치: ' + mismatch.map(([t, n]) => `${t} DB ${n} / 파일 ${out[t].length}`).join(', '));
    await client.query(commit ? 'commit' : 'rollback');
    return counts;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

// ---------- 실행 ----------
const rep = new Report();
const sheets = await readWorkbook(args.file);
const { out } = transform(sheets, rep);

console.log(`\n=== 이관 ${MODE === 'preview' ? '미리보기 (DB 연결 안 함)' : MODE === 'check' ? '점검 (넣어 보고 되돌림)' : '실행'} : ${args.name} (${args.slug}) ===`);
console.log('\n[시트 → 행 수]');
for (const [name, s] of Object.entries(sheets)) console.log(`  ${name.padEnd(14)} ${String(s.rows.length).padStart(5)}행`);
console.log('\n[새 DB 에 들어갈 행 수]');
for (const t of ORDER) if (rep.tables[t]) console.log(`  ${t.padEnd(30)} ${String(rep.tables[t]).padStart(5)}`);
if (Object.keys(rep.infos).length) {
  console.log('\n[참고]');
  for (const [k, n] of Object.entries(rep.infos)) console.log(`  ${k}${n > 1 ? ` (${n}건)` : ''}`);
}
console.log(`\n[확인 필요 ${rep.warnings.length}건]${rep.warnings.length ? '' : ' 없음'}`);
rep.warnings.slice(0, 200).forEach((m) => console.log('  - ' + m));
if (rep.warnings.length > 200) console.log(`  … 외 ${rep.warnings.length - 200}건 (--report 로 전체 저장)`);
if (rep.skipped.length) console.log(`\n건너뛴 행 ${rep.skipped.length}개`);
console.log('\n[DB 로 옮기지 않는 것 — 전환 때 원장님이 직접 입력]');
console.log('  문자 API 키·발신번호, Claude API 키 (구글 스크립트 속성에 있어 시트에 없음)');
console.log('  웹푸시 VAPID 키 (스크립트 속성) — 옮기지 않으면 알림을 한 번 다시 허용해야 함');

if (args.report) fs.writeFileSync(args.report, JSON.stringify(rep, null, 2));

if (MODE !== 'preview') {
  try {
    const counts = await load(out, MODE === 'apply');
    console.log(`\n${MODE === 'apply' ? '저장 완료' : '점검 통과 (되돌림, 저장 안 함)'} — 건수 대조 일치 (${Object.keys(counts).length}개 표)`);
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
