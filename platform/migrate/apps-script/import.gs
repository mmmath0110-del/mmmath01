/**
 * @OnlyCurrentDoc
 * ================================================================
 *  학원 데이터 한 번에 옮기기 (구글 시트 → 새 서버)
 * ================================================================
 *  이 코드는 "이 시트 파일(백업 사본)"만 읽는다. 원본 시트·지금 쓰는 대시보드는 건드리지 않는다.
 *  (@OnlyCurrentDoc: 구글이 이 파일 외의 다른 시트에는 접근 권한 자체를 주지 않는다)
 *
 *  사용법
 *   1. 아래 SUPABASE_SECRET_KEY 에 Supabase Secret key(sb_secret_...)를 붙여넣고 저장(Ctrl+S)
 *   2. 위쪽 함수 선택에서 runImport 를 고르고 ▶ 실행 → 처음 한 번 권한 허용
 *   3. 아래 "실행 로그"에 결과가 나온다. 점검을 통과하면 자동으로 저장까지 한다
 *   4. 다 끝나면 SUPABASE_SECRET_KEY 를 다시 '' 로 지우고 저장 (키를 남겨 두지 않기)
 * ================================================================
 */
var SUPABASE_URL = 'https://waiqdnnknfvkhqheumtt.supabase.co';
var SUPABASE_SECRET_KEY = '';            // ← 여기에 sb_secret_... 붙여넣기 (따옴표 안에)
var ACADEMY_SLUG = 'mmmath';             // 새 서버에서 이 학원의 주소 이름
var ACADEMY_NAME = '더블엠수학학원';
var REPLACE_EXISTING = false;            // 이미 옮긴 학원을 지우고 다시 옮길 때만 true (테스트 서버에서만)

/** ▶ 이 함수를 실행하세요 */
function runImport() {
  if (!SUPABASE_SECRET_KEY) throw new Error('SUPABASE_SECRET_KEY 가 비어 있습니다. Supabase → Project Settings → API Keys → Secret key 를 붙여넣고 저장하세요.');
  if (SUPABASE_SECRET_KEY.indexOf('sb_publishable_') === 0) throw new Error('Publishable key 를 넣으셨어요. Secret key(sb_secret_...)가 필요합니다.');

  var sheets = readSheets_();
  var res = hakwonTransform(sheets, { slug: ACADEMY_SLUG, name: ACADEMY_NAME }, { uuid: uuid_, sha256: sha256_ });
  log_(hakwonReportText(sheets, res.report, '이관 : ' + ACADEMY_NAME + ' (' + ACADEMY_SLUG + ')'));

  log_('\n1단계 점검: 새 서버에 넣어 보고 되돌리는 중…');
  var checked = callImport_(res.out, false);
  log_('  점검 통과 — ' + summary_(checked));

  log_('2단계 저장 중…');
  var saved = callImport_(res.out, true);
  log_('  저장 완료 — ' + summary_(saved));
  log_('\n끝났습니다. 이제 SUPABASE_SECRET_KEY 를 \'\' 로 지우고 저장하세요.');
}

/** 이 파일의 모든 탭을 { 탭이름: { rows: [ {제목: 값} ] } } 로 읽는다 */
function readSheets_() {
  var sheets = {};
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
    var range = sh.getDataRange(), vals = range.getValues(), disp = range.getDisplayValues();
    var rows = [];
    if (vals.length > 1) {
      var header = disp[0].map(function (h) { return String(h).trim(); });
      for (var i = 1; i < vals.length; i++) {
        var o = { __row: i + 1 }, any = false;
        for (var j = 0; j < header.length; j++) {
          if (!header[j]) continue;
          var v = vals[i][j];
          // 날짜·시각 셀은 화면에 보이는 글자로 넘긴다 (시각만 있는 셀을 Date 로 다루면 1899년 시간대 때문에 몇 분씩 어긋난다)
          if (Object.prototype.toString.call(v) === '[object Date]') v = disp[i][j];
          if (v === '') v = null;
          o[header[j]] = v;
          if (v != null && String(v).trim() !== '') any = true;
        }
        if (any) rows.push(o);
      }
    }
    sheets[sh.getName()] = { rows: rows };
  });
  return sheets;
}

/** 새 서버의 import_academy 함수 호출. 점검(apply=false)은 DB 가 CHECK_OK 오류로 되돌린다 */
function callImport_(payload, apply) {
  var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/import_academy', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_SECRET_KEY },
    payload: JSON.stringify({ payload: payload, apply: apply, replace_existing: REPLACE_EXISTING }),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode(), text = resp.getContentText(), body = {};
  try { body = JSON.parse(text); } catch (e) { /* 글자 그대로 */ }
  if (code >= 200 && code < 300) return body;
  if (!apply && body && body.message === 'CHECK_OK') return JSON.parse(body.details);
  var hint = code === 401 || code === 403 ? ' (키가 틀렸거나 Secret key 가 아닙니다)'
    : code === 404 ? ' (새 서버에 import_academy 함수가 없습니다. 0004_import.sql 을 먼저 실행하세요)' : '';
  throw new Error((apply ? '저장' : '점검') + ' 실패 HTTP ' + code + hint + ': ' + ((body && body.message) || text).slice(0, 500)
    + '\n아무것도 저장되지 않았습니다.');
}

function summary_(counts) {
  var n = 0; Object.keys(counts).forEach(function (k) { n += counts[k]; });
  return '표 ' + Object.keys(counts).length + '개 · ' + n + '행 (보낸 건수와 DB 건수 일치)';
}
function uuid_() { return Utilities.getUuid(); }
function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function log_(s) { String(s).split('\n').forEach(function (line) { console.log(line); }); }

// ================================================================
// 아래는 이관 규칙 (platform/migrate/transform.cjs 와 같은 코드 · 자동 생성 · 직접 고치지 말 것)
// ================================================================
/**
 * 옛 구글 시트 → 새 DB 행으로 바꾸는 규칙 (이관의 유일한 기준).
 * 같은 파일을 두 곳에서 쓴다: Node 테스트·이관(import-sheet.mjs)과 구글 Apps Script(apps-script/이관.gs 로 합쳐짐).
 * 그래서 import·require·Node 전용 기능을 쓰지 않는다. uuid·sha256 은 deps 로 받는다.
 *
 * 입력 sheets: { 시트이름: { rows: [ { 제목: 값, __row: 행번호 } ] } }
 *   값은 글자·숫자·true/false·null 만. 날짜·시각 셀은 읽는 쪽이 화면에 보이는 글자로 넘긴다
 *   (예: '2026-09-10', '2026. 9. 10', '16:00', '오후 3:05', '2026-09-10T01:00:00.000Z').
 * 출력: { academyId, out: { 표이름: [행] }, report }
 *   jsonb 칸은 객체·배열 그대로, uuid[] 칸은 배열. DB 함수 public.import_academy 가 그대로 넣는다.
 */
var HAKWON_ORDER = ['academies', 'academy_settings', 'app.academy_secrets', 'staff', 'app.staff_legacy_credentials', 'students', 'classes',
  'textbooks', 'enrollments', 'attendance', 'checkins', 'payments', 'exams', 'scores', 'reports', 'consults', 'messages', 'ext_schedules',
  'schedule_links', 'academy_kv', 'changes', 'makeups', 'mk_requests', 'events', 'tests', 'supplies', 'issues', 'student_profiles',
  'gradebook', 'bills', 'att_checks', 'att_check_log', 'work_logs', 'shifts', 'push_subs', 'kiosk_devices', 'blog_posts'];

var HAKWON_KNOWN_SHEETS = ['members', 'logs', 'sessions', 'shifts', 'students', 'classes', 'enrollments', 'attendance', 'checkins', 'payments',
  'exams', 'scores', 'reports', 'consults', 'messages', 'textbooks', 'extSchedules', 'scheduleLinks', 'settings', 'changes', 'makeups',
  'mkRequests', 'events', 'tests', 'supplies', 'issues', 'profiles', 'gradebook', 'bills', 'attChecks', 'attCheckLog', 'pushSubs', 'blogPosts', '시트1'];

function hakwonTransform(sheets, opts, deps) {
  var uuid = deps.uuid, sha256 = deps.sha256, now = deps.now || new Date().toISOString();
  var report = { tables: {}, warnings: [], infos: {}, skipped: [] };
  function warn(where, msg) { report.warnings.push(where + ': ' + msg); }
  function info(where, msg) { var k = where.split(' ')[0] + ': ' + msg; report.infos[k] = (report.infos[k] || 0) + 1; }

  // ---------- 값 변환 ----------
  function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function blank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }
  function kst(d) {
    var k = new Date(d.getTime() + 9 * 3600e3);
    return { date: k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1) + '-' + pad(k.getUTCDate()),
             time: pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes()) + ':' + pad(k.getUTCSeconds()) };
  }
  var ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
  function toDate(v, where) {
    if (blank(v)) return null;
    var s = String(v).trim(), m;
    if (ISO_TZ.test(s)) { var d = new Date(s); if (!isNaN(d)) return kst(d).date; }   // 시간대가 붙은 시각 → 한국 날짜
    m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    warn(where, '날짜로 읽을 수 없는 값 "' + s + '" → 비움'); return null;
  }
  function toTime(v, where) {
    if (blank(v)) return null;
    if (typeof v === 'number' && v >= 0 && v < 1) { var mm = Math.round(v * 1440); return pad(Math.floor(mm / 60)) + ':' + pad(mm % 60); }
    var s = String(v).trim();
    var m = s.match(/(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})/i);
    if (m) {
      var h = +m[2];
      if (/오후|PM/i.test(m[1] || '') && h < 12) h += 12;
      if (/오전|AM/i.test(m[1] || '') && h === 12) h = 0;
      if (h < 24 && +m[3] < 60) return pad(h) + ':' + m[3];
    }
    warn(where, '시각으로 읽을 수 없는 값 "' + s + '" → 비움'); return null;
  }
  function toTs(v, where) {
    if (blank(v)) return null;
    var s = String(v).trim();
    if (ISO_TZ.test(s) && !isNaN(new Date(s))) return s;
    var m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*(?:(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      var h = +(m[5] || 0);
      if (m[4] === '오후' && h < 12) h += 12;
      if (m[4] === '오전' && h === 12) h = 0;
      return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + 'T' + pad(h) + ':' + pad(m[6] || 0) + ':' + pad(m[7] || 0) + '+09:00';
    }
    warn(where, '시각으로 읽을 수 없는 값 "' + s + '" → 비움'); return null;
  }
  function toInt(v, where) {
    if (blank(v)) return null;
    var n = Number(String(v).replace(/[,\s원]/g, ''));
    if (isFinite(n)) return Math.round(n);
    warn(where, '숫자로 읽을 수 없는 값 "' + v + '" → 비움'); return null;
  }
  function toNum(v, where) {
    if (blank(v)) return null;
    var n = Number(String(v).replace(/[,\s]/g, ''));
    if (isFinite(n)) return n;
    warn(where, '숫자로 읽을 수 없는 값 "' + v + '" → 비움'); return null;
  }
  function toBool(v) { return v === true || v === 1 || /^(true|1|y|yes|o|on)$/i.test(String(v == null ? '' : v).trim()); }
  function toText(v) { return blank(v) ? null : String(v).trim(); }
  function toJson(v, where) {
    var s = toText(v); if (s == null) return null;
    try { return JSON.parse(s); } catch (e) { warn(where, 'JSON 이 아닌 값 → 글자 그대로 보관'); return { raw: s }; }
  }
  // 전화번호: 숫자만. 시트가 숫자로 바꿔 앞자리 0 이 빠졌으면(10XXXXXXXX) 되살린다
  function toPhone(v, where) {
    var s = toText(v); if (s == null) return null;
    var d = s.replace(/\D/g, '');
    if (/^1[016789]\d{7,8}$/.test(d)) { d = '0' + d; info(where, '전화번호 앞자리 0 복원'); }
    if (!/^0\d{8,10}$/.test(d)) warn(where, '전화번호 형식이 이상함 "' + s + '" (그대로 보관)');
    return d || null;
  }
  function list(v) { return (toText(v) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function uniq(a) { var o = [], seen = {}; a.forEach(function (x) { if (!seen[x]) { seen[x] = 1; o.push(x); } }); return o; }

  // ---------- 준비 ----------
  var academyId = uuid();
  var out = {}, ids = {};
  function push(t, row) { (out[t] = out[t] || []).push(row); }
  function rowsOf(name) { return (sheets[name] && sheets[name].rows) || []; }
  function where(sheet, r, col) { return sheet + ' ' + r.__row + '행' + (col ? ' ' + col : ''); }

  // legacy id → 새 uuid 를 먼저 모두 정해 둔다 (서로 참조하므로)
  ['students', 'classes', 'enrollments', 'exams', 'makeups', 'attChecks', 'payments', 'members'].forEach(function (s) {
    ids[s] = {};
    rowsOf(s).forEach(function (r) {
      var k = toText(r.id); if (!k) return;
      if (ids[s][k]) { warn(where(s, r), 'id "' + k + '" 중복 → 뒤의 행은 건너뜀'); r.__dup = true; return; }
      ids[s][k] = uuid();
    });
  });
  function ref(sheet, v, r, col, from) {
    var k = toText(v); if (!k) return null;
    var u = ids[sheet][k];
    if (!u) warn(where(from, r, col), '"' + k + '" 를 ' + sheet + ' 에서 찾을 수 없음 → 비움');
    return u || null;
  }
  // 옛 시스템은 teacherId·memberId 에 로그인 아이디를 적었다 → staff uuid (대소문자 무시)
  var staffByLogin = {};
  function staffRef(v, r, col, from) {
    var k = toText(v); if (!k) return null;
    var u = staffByLogin[k.toLowerCase()];
    if (!u) warn(where(from, r, col), '직원 아이디 "' + k + '" 없음 → 비움');
    return u || null;
  }
  function need(val, sheet, r, what) {
    if (val == null) { warn(where(sheet, r), what + ' 없음 → 행 건너뜀'); report.skipped.push(where(sheet, r)); return false; }
    return true;
  }
  // 시트 한 장을 표 한 개로: fn 이 행 객체(또는 null)를 돌려준다
  function each(sheet, table, fn) {
    rowsOf(sheet).forEach(function (r) {
      if (r.__dup) return;
      var row = fn(r, sheet); if (!row) return;
      var o = { id: (ids[sheet] && ids[sheet][toText(r.id)]) || uuid(), academy_id: academyId, legacy_id: toText(r.id) };
      for (var k in row) o[k] = row[k];
      push(table, o);
    });
  }
  function D(s, r, c) { return toDate(r[c], where(s, r, c)); }
  function T(s, r, c) { return toTime(r[c], where(s, r, c)); }
  function TS(s, r, c) { return toTs(r[c], where(s, r, c)); }
  function I(s, r, c) { return toInt(r[c], where(s, r, c)); }
  function N(s, r, c) { return toNum(r[c], where(s, r, c)); }
  function J(s, r, c) { return toJson(r[c], where(s, r, c)); }
  function P(s, r, c) { return toPhone(r[c], where(s, r, c)); }
  function X(r, c) { return toText(r[c]); }
  function or0(v) { return v == null ? 0 : v; }

  // ---------- 학원 ----------
  push('academies', { id: academyId, slug: opts.slug, name: opts.name, status: 'active', plan_id: 'pro', test_mode: true });

  // ---------- 직원 (members) ----------
  rowsOf('members').forEach(function (r) {
    if (r.__dup) return;
    var login = X(r, 'id'); if (!login) return;
    var id = ids.members[login];
    staffByLogin[login.toLowerCase()] = id;
    push('staff', { id: id, academy_id: academyId, legacy_id: login, login_id: login.toLowerCase(), name: X(r, 'name') || login,
      role: X(r, 'role') === 'admin' ? 'admin' : 'teacher', color: X(r, 'color'), active: blank(r.active) ? true : toBool(r.active),
      phone: P('members', r, 'phone'), created_at: TS('members', r, 'createdAt') || now });
    // 옛 비밀번호 해시 → 첫 로그인 때 확인용 (화면에서 조회 불가한 app 스키마)
    push('app.staff_legacy_credentials', { staff_id: id, salt: X(r, 'salt'), pw_hash: X(r, 'pwHash'), pin_salt: X(r, 'pinSalt'), pin_hash: X(r, 'pinHash') });
  });

  each('students', 'students', function (r, s) {
    return { name: X(r, 'name') || '(이름 없음)', status: X(r, 'status') || '재원', school: X(r, 'school'), grade: X(r, 'grade'),
      birth: D(s, r, 'birth'), phone: P(s, r, 'phone'), parent_phone: P(s, r, 'parentPhone'), parent_name: X(r, 'parentName'),
      enrolled_at: D(s, r, 'enrolledAt'), left_at: D(s, r, 'leftAt'), memo: X(r, 'memo'), ext_id: X(r, 'extId'),
      created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('classes', 'classes', function (r, s) {
    return { name: X(r, 'name') || '(반 이름 없음)', subject: X(r, 'subject'), teacher_id: staffRef(r.teacherId, r, 'teacherId', s),
      days: X(r, 'days'), start_time: T(s, r, 'start'), end_time: T(s, r, 'end'), room: X(r, 'room'), fee: I(s, r, 'fee'),
      status: X(r, 'status') || '운영', memo: X(r, 'memo'), created_at: TS(s, r, 'createdAt') || now, schedule: X(r, 'schedule'),
      textbook: X(r, 'textbook'), progress: X(r, 'progress'), lesson_note: X(r, 'lessonNote'), kind: X(r, 'kind') };
  });
  each('textbooks', 'textbooks', function (r, s) {
    return { name: X(r, 'name') || '(교재)', subject: X(r, 'subject'), grade: X(r, 'grade'), created_at: TS(s, r, 'createdAt') || now };
  });
  each('enrollments', 'enrollments', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s), c = ref('classes', r.classId, r, 'classId', s);
    if (!need(st, s, r, '학생') || !need(c, s, r, '반')) return null;
    return { student_id: st, class_id: c, start_date: D(s, r, 'startDate'), end_date: D(s, r, 'endDate'), fee: I(s, r, 'fee'),
      created_at: TS(s, r, 'createdAt') || now, end_reason: X(r, 'endReason'), deleted: toBool(r.deleted),
      updated_at: TS(s, r, 'updatedAt') || now, updated_by: staffRef(r.updatedBy, r, 'updatedBy', s) };
  });
  var seenAtt = {};
  each('attendance', 'attendance', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date'), c = ref('classes', r.classId, r, 'classId', s);
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜')) return null;
    var k = date + st + c;
    if (seenAtt[k]) { warn(where(s, r), '같은 날짜·반·학생 출결이 두 번 → 뒤의 행 건너뜀'); return null; }
    seenAtt[k] = 1;
    return { date: date, class_id: c, student_id: st, status: X(r, 'status') || '', note: X(r, 'note'),
      updated_by: X(r, 'updatedBy'), updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('checkins', 'checkins', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date'), time = T(s, r, 'time');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜') || !need(time, s, r, '시각')) return null;
    return { date: date, time: time, student_id: st, kind: X(r, 'kind') || '', class_id: ref('classes', r.classId, r, 'classId', s),
      device: X(r, 'device'), sms: X(r, 'sms'), created_at: TS(s, r, 'createdAt') || now };
  });
  each('payments', 'payments', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date'), amount = I(s, r, 'amount');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜') || !need(amount, s, r, '금액')) return null;
    return { date: date, student_id: st, month: X(r, 'month'), item: X(r, 'item'), amount: amount, method: X(r, 'method'),
      class_id: ref('classes', r.classId, r, 'classId', s), note: X(r, 'note'), created_by: X(r, 'createdBy'),
      created_at: TS(s, r, 'createdAt') || now };
  });
  each('exams', 'exams', function (r, s) {
    var cls = uniq(list(r.classIds).concat(list(r.classId))).map(function (c) { return ref('classes', c, r, 'classIds', s); }).filter(Boolean);
    return { date: D(s, r, 'date'), class_ids: cls, name: X(r, 'name') || '(시험)', max_score: N(s, r, 'maxScore'), memo: X(r, 'memo'),
      questions: J(s, r, 'questions'), mode: X(r, 'mode'), obj_max: N(s, r, 'objMax'), essay_max: N(s, r, 'essayMax'),
      created_at: TS(s, r, 'createdAt') || now };
  });
  var seenScore = {};
  each('scores', 'scores', function (r, s) {
    var ex = ref('exams', r.examId, r, 'examId', s), st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(ex, s, r, '시험') || !need(st, s, r, '학생')) return null;
    if (seenScore[ex + st]) { warn(where(s, r), '같은 시험·학생 점수가 두 번 → 뒤의 행 건너뜀'); return null; }
    seenScore[ex + st] = 1;
    return { exam_id: ex, student_id: st, score: N(s, r, 'score'), note: X(r, 'note'), class_id: ref('classes', r.classId, r, 'classId', s),
      updated_at: TS(s, r, 'updatedAt') || now, wrong: J(s, r, 'wrong'), parts: J(s, r, 'parts'), obj: N(s, r, 'obj'), essay: N(s, r, 'essay') };
  });
  each('reports', 'reports', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s), ws = D(s, r, 'weekStart'), we = D(s, r, 'weekEnd');
    if (!need(st, s, r, '학생') || !need(ws, s, r, '주 시작일') || !need(we, s, r, '주 종료일')) return null;
    return { student_id: st, week_start: ws, week_end: we, status: X(r, 'status') || 'draft', body: X(r, 'body'), data: J(s, r, 'data'),
      created_at: TS(s, r, 'createdAt') || now, created_by: X(r, 'createdBy'), approved_by: X(r, 'approvedBy'),
      approved_at: TS(s, r, 'approvedAt'), sent_at: TS(s, r, 'sentAt'), sms: X(r, 'sms'), model: X(r, 'model') };
  });
  each('consults', 'consults', function (r, s) {
    var date = D(s, r, 'date');
    if (!need(date, s, r, '날짜')) return null;
    return { date: date, time: T(s, r, 'time'), type: X(r, 'type'), student_id: ref('students', r.studentId, r, 'studentId', s),
      name: X(r, 'name'), phone: P(s, r, 'phone'), school: X(r, 'school'), grade: X(r, 'grade'), content: X(r, 'content'),
      next_date: D(s, r, 'nextDate'), member_id: staffRef(r.memberId, r, 'memberId', s), created_at: TS(s, r, 'createdAt') || now,
      updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('messages', 'messages', function (r, s) {
    var at = TS(s, r, 'sentAt');
    if (!need(at, s, r, '발송 시각')) return null;
    return { sent_at: at, kind: X(r, 'kind'), count: I(s, r, 'count'), recipients: X(r, 'recipients'), body: X(r, 'body'),
      method: X(r, 'method'), result: X(r, 'result'), sent_by: X(r, 'sentBy') };
  });
  each('extSchedules', 'ext_schedules', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(st, s, r, '학생')) return null;
    return { student_id: st, name: X(r, 'name'), day: X(r, 'day'), start_time: T(s, r, 'start'), end_time: T(s, r, 'end'),
      memo: X(r, 'memo'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  var seenLink = {};
  rowsOf('scheduleLinks').forEach(function (r) {
    var s = 'scheduleLinks', st = ref('students', r.studentId, r, 'studentId', s), tok = X(r, 'token');
    if (!st || !tok) { warn(where(s, r), '학생 또는 토큰 없음 → 건너뜀'); return; }
    if (seenLink[st]) { warn(where(s, r), '같은 학생 링크 두 번 → 뒤의 행 건너뜀'); return; }
    seenLink[st] = 1;
    // 원문 토큰은 저장하지 않는다. 이미 보낸 링크는 새 서버가 sha256(토큰)으로 찾는다
    push('schedule_links', { id: uuid(), academy_id: academyId, student_id: st, token_hash: sha256(tok),
      active: blank(r.active) ? true : toBool(r.active), created_at: TS(s, r, 'createdAt') || now,
      expires_at: TS(s, r, 'expiresAt'), submitted_at: TS(s, r, 'submittedAt') });
  });
  each('changes', 'changes', function (r, s) {
    var at = TS(s, r, 'at');
    if (!need(at, s, r, '시각')) return null;
    return { at: at, member_id: X(r, 'memberId'), member_name: X(r, 'memberName'), type: X(r, 'type'),
      student_id: ref('students', r.studentId, r, 'studentId', s), class_id: ref('classes', r.classId, r, 'classId', s),
      before: X(r, 'before'), after: X(r, 'after'), note: X(r, 'note') };
  });
  each('makeups', 'makeups', function (r, s) {
    var date = D(s, r, 'date');
    if (!need(date, s, r, '날짜')) return null;
    return { date: date, start_time: T(s, r, 'start'), end_time: T(s, r, 'end'), class_id: ref('classes', r.classId, r, 'classId', s),
      teacher_id: staffRef(r.teacherId, r, 'teacherId', s),
      student_ids: uniq(list(r.studentIds)).map(function (x) { return ref('students', x, r, 'studentIds', s); }).filter(Boolean),
      title: X(r, 'title'), reason: X(r, 'reason'), memo: X(r, 'memo'), status: X(r, 'status'), notified_at: TS(s, r, 'notifiedAt'),
      created_at: TS(s, r, 'createdAt') || now, created_by: X(r, 'createdBy'), updated_at: TS(s, r, 'updatedAt') || now,
      updated_by: X(r, 'updatedBy'), deleted: toBool(r.deleted), deleted_at: TS(s, r, 'deletedAt'), deleted_by: X(r, 'deletedBy'),
      reminded_at: TS(s, r, 'remindedAt') };
  });
  each('mkRequests', 'mk_requests', function (r, s) {
    return { created_at: TS(s, r, 'createdAt') || now, teacher_id: staffRef(r.teacherId, r, 'teacherId', s), names: X(r, 'names'),
      date: D(s, r, 'date'), start_time: T(s, r, 'start'), end_time: T(s, r, 'end'), title: X(r, 'title'), note: X(r, 'note'),
      status: X(r, 'status') || '대기', handled_by: X(r, 'handledBy'), handled_at: TS(s, r, 'handledAt'),
      makeup_id: ref('makeups', r.makeupId, r, 'makeupId', s), reply: X(r, 'reply') };
  });
  each('events', 'events', function (r, s) {
    var date = D(s, r, 'date');
    if (!need(date, s, r, '날짜')) return null;
    return { date: date, end_date: D(s, r, 'endDate'), type: X(r, 'type'), title: X(r, 'title'), target: X(r, 'target'),
      note: X(r, 'note'), school: X(r, 'school'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('tests', 'tests', function (r, s) {
    return { date: D(s, r, 'date'), title: X(r, 'title'), type: X(r, 'type'), target: X(r, 'target'), teacher: X(r, 'teacher'),
      scope: X(r, 'scope'), note: X(r, 'note'), done: toBool(r.done), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('supplies', 'supplies', function (r, s) {
    return { name: X(r, 'name') || '(품목)', category: X(r, 'category'), qty: N(s, r, 'qty'), min_qty: N(s, r, 'minQty'), unit: X(r, 'unit'),
      last_in: D(s, r, 'lastIn'), vendor: X(r, 'vendor'), note: X(r, 'note'), updated_at: TS(s, r, 'updatedAt') || now };
  });
  each('issues', 'issues', function (r, s) {
    return { category: X(r, 'category'), target: X(r, 'target'), detail: X(r, 'detail'), action: X(r, 'action'), priority: X(r, 'priority'),
      done: toBool(r.done), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  var PROFILE = { attitude: 'attitude', homework: 'homework', style: 'style', strength: 'strength', weakness: 'weakness', mental: 'mental',
    peer: 'peer', parent: 'parent', traitMemo: 'trait_memo', policy: 'policy', roadmap: 'roadmap', nextStep: 'next_step', risk: 'risk',
    riskWhy: 'risk_why', watch: 'watch', track: 'track', admType: 'adm_type', univ1: 'univ1', major1: 'major1', univ2: 'univ2',
    major2: 'major2', targetInner: 'target_inner', curInner: 'cur_inner', targetMock: 'target_mock', curMock: 'cur_mock', careerMemo: 'career_memo' };
  var seenProfile = {};
  rowsOf('profiles').forEach(function (r) {
    var s = 'profiles', st = ref('students', r.studentId, r, 'studentId', s);
    if (!st) return;
    if (seenProfile[st]) { warn(where(s, r), '같은 학생 기록카드 두 번 → 뒤의 행 건너뜀'); return; }
    seenProfile[st] = 1;
    var row = { id: uuid(), academy_id: academyId, student_id: st, updated_at: TS(s, r, 'updatedAt') || now };
    for (var k in PROFILE) row[PROFILE[k]] = X(r, k);
    push('student_profiles', row);
  });
  var GB = ['kind', 'year', 'term', 'exam', 'subject', 'score', 'avg', 'rank', 'total', 'level', 'weak', 'note', 'org', 'round', 'raw',
    'std', 'pct', 'type', 'scope', 'max', 'submit'];
  each('gradebook', 'gradebook', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(st, s, r, '학생')) return null;
    var row = { student_id: st, date: D(s, r, 'date'), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
    GB.forEach(function (k) { row[k] = X(r, k); });
    return row;
  });
  each('bills', 'bills', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s);
    if (!need(st, s, r, '학생')) return null;
    return { student_id: st, kind: X(r, 'kind'), course: X(r, 'course'), term: X(r, 'term'), teacher: X(r, 'teacher'),
      billed: or0(I(s, r, 'billed')), discount: or0(I(s, r, 'discount')), paid: or0(I(s, r, 'paid')), status: X(r, 'status'),
      method: X(r, 'method'), paid_at: D(s, r, 'paidAt'), handler: X(r, 'handler'), note: X(r, 'note'),
      payment_id: ref('payments', r.paymentId, r, 'paymentId', s), created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now };
  });
  var checkStudent = {};
  each('attChecks', 'att_checks', function (r, s) {
    var st = ref('students', r.studentId, r, 'studentId', s), date = D(s, r, 'date');
    if (!need(st, s, r, '학생') || !need(date, s, r, '날짜')) return null;
    checkStudent[ids.attChecks[toText(r.id)]] = st;
    return { date: date, student_id: st, student_name: X(r, 'studentName'), class_id: ref('classes', r.classId, r, 'classId', s),
      class_name: X(r, 'className'), makeup_id: ref('makeups', r.makeupId, r, 'makeupId', s), teacher_id: staffRef(r.teacherId, r, 'teacherId', s),
      due: T(s, r, 'due'), status: X(r, 'status') || '확인필요', reason: X(r, 'reason'), detected_at: TS(s, r, 'detectedAt'),
      alert_to: X(r, 'alertTo'), alert1_at: TS(s, r, 'alert1At'), alert2_at: TS(s, r, 'alert2At'), checked_by: X(r, 'checkedBy'),
      checked_by_name: X(r, 'checkedByName'), checked_at: TS(s, r, 'checkedAt'), check_method: X(r, 'checkMethod'), first_by: X(r, 'firstBy'),
      sms_at: TS(s, r, 'smsAt'), sms_student: X(r, 'smsStudent'), sms_parent: X(r, 'smsParent'), sms_ids: X(r, 'smsIds'),
      arrived_at: X(r, 'arrivedAt'), late_min: I(s, r, 'lateMin'), version: I(s, r, 'version') || 1, updated_at: TS(s, r, 'updatedAt') || now,
      note: X(r, 'note'), seen_by: X(r, 'seenBy') };
  });
  each('attCheckLog', 'att_check_log', function (r, s) {
    var ck = ref('attChecks', r.checkId, r, 'checkId', s), at = TS(s, r, 'at');
    if (!need(at, s, r, '시각')) return null;
    return { date: D(s, r, 'date'), check_id: ck, student_id: ck ? (checkStudent[ck] || null) : null, at: at, by: X(r, 'by'),
      by_name: X(r, 'byName'), from_status: X(r, 'from'), to_status: X(r, 'to'), note: X(r, 'note') };
  });
  var seenLog = {};
  each('logs', 'work_logs', function (r, s) {
    var sf = staffRef(r.memberId, r, 'memberId', s), date = D(s, r, 'date');
    if (!need(sf, s, r, '직원') || !need(date, s, r, '날짜')) return null;
    if (seenLog[sf + date]) { warn(where(s, r), '같은 직원·날짜 근무일지 두 번 → 뒤의 행 건너뜀'); return null; }
    seenLog[sf + date] = 1;
    return { date: date, staff_id: sf, check_in: T(s, r, 'checkIn'), check_out: T(s, r, 'checkOut'), work: X(r, 'work'), note: X(r, 'note'),
      updated_by: X(r, 'updatedBy'), updated_at: TS(s, r, 'updatedAt') || now, fixed_by: X(r, 'fixedBy') };
  });
  each('shifts', 'shifts', function (r, s) {
    return { week: X(r, 'week'), day: X(r, 'day'), staff_id: staffRef(r.memberId, r, 'memberId', s), start_time: T(s, r, 'start'),
      end_time: T(s, r, 'end'), tasks: X(r, 'tasks'), note: X(r, 'note'), updated_by: X(r, 'updatedBy'), updated_at: TS(s, r, 'updatedAt') || now };
  });
  var seenEndpoint = {};
  each('pushSubs', 'push_subs', function (r, s) {
    var sf = staffRef(r.memberId, r, 'memberId', s), ep = X(r, 'endpoint');
    if (!need(sf, s, r, '직원') || !need(ep, s, r, 'endpoint') || seenEndpoint[ep]) return null;
    seenEndpoint[ep] = 1;
    return { staff_id: sf, endpoint: ep, p256dh: X(r, 'p256dh') || '', auth: X(r, 'auth') || '', ua: X(r, 'ua'),
      created_at: TS(s, r, 'createdAt') || now, last_ok: TS(s, r, 'lastOk'), fails: or0(I(s, r, 'fails')) };
  });
  each('blogPosts', 'blog_posts', function (r, s) {
    var row = { created_at: TS(s, r, 'createdAt') || now, updated_at: TS(s, r, 'updatedAt') || now, status: X(r, 'status'), url: X(r, 'url'),
      published_at: TS(s, r, 'publishedAt'), created_by: X(r, 'createdBy') };
    ['keyword', 'type', 'title', 'titles', 'body', 'meta', 'tags', 'alt', 'todo', 'sources'].forEach(function (k) { row[k] = X(r, k); });
    return row;
  });

  // ---------- 설정 (settings: key/value) → 일반 설정 · 비밀값 · 상태값 · 태블릿 ----------
  var settings = {}, secrets = { academy_id: academyId, kiosk_pin_hash: null, extra: {} };
  var GENERAL = { travelBuffer: 1, prorate: 1, kioskSms: 1, kioskMsgIn: 1, kioskMsgOut: 1, kioskStaffPin: 1, reportStyle: 1, reportRank: 1, reportDay: 1 };
  rowsOf('settings').forEach(function (r) {
    var key = X(r, 'key'); if (!key) return;
    var raw = X(r, 'value');
    if (key === 'kioskPin') {
      if (raw) secrets.kiosk_pin_hash = sha256(academyId + ':' + raw);   // 평문 PIN 을 해시로 바꿔 보관
    } else if (key === 'kioskDevices') {
      var devs = []; try { devs = JSON.parse(raw || '[]') || []; } catch (e) { warn('settings kioskDevices', 'JSON 아님 → 태블릿 재등록 필요'); }
      var seenTok = {};
      devs.forEach(function (d) {
        if (!d || !d.token || seenTok[d.token]) return;
        seenTok[d.token] = 1;
        push('kiosk_devices', { id: uuid(), academy_id: academyId, name: String(d.name || '태블릿'), token_hash: sha256(d.token),
          created_at: toTs(d.createdAt, 'settings kioskDevices') || now, last_seen: toTs(d.lastUsed, 'settings kioskDevices') });
      });
    } else if (key === 'rosterSync' || key === 'rosterExport') {
      push('academy_kv', { academy_id: academyId, key: key, value: toJson(raw, 'settings ' + key) });
    } else if (GENERAL[key]) {
      settings[key] = raw;
    } else {
      var v = raw; try { v = JSON.parse(raw); } catch (e) { /* 글자 그대로 */ }
      settings[key] = v;
      if (key !== 'adminMeta' && key !== 'blogProfile') info('settings', '알 수 없는 설정 키 "' + key + '" → 일반 설정에 보관');
    }
  });
  push('academy_settings', { academy_id: academyId, brand: { displayName: opts.name }, settings: settings });
  push('app.academy_secrets', secrets);

  // 옮기지 않는 시트
  Object.keys(sheets).forEach(function (name) {
    if (name === 'sessions') info('sessions', '로그인 세션은 옮기지 않음 (전환 후 한 번 다시 로그인)');
    else if (HAKWON_KNOWN_SHEETS.indexOf(name) < 0) warn(name, '알 수 없는 시트 (행 ' + sheets[name].rows.length + '개) → 옮기지 않음. 확인 필요');
  });
  Object.keys(out).forEach(function (t) { report.tables[t] = out[t].length; });
  return { academyId: academyId, out: out, report: report };
}

/** 보고서를 사람이 읽는 글로 */
function hakwonReportText(sheets, report, title) {
  var L = [];
  L.push('=== ' + title + ' ===', '', '[시트 → 행 수]');
  Object.keys(sheets).forEach(function (n) { L.push('  ' + n + ': ' + sheets[n].rows.length + '행'); });
  L.push('', '[새 DB 에 들어갈 행 수]');
  HAKWON_ORDER.forEach(function (t) { if (report.tables[t]) L.push('  ' + t + ': ' + report.tables[t]); });
  var infos = Object.keys(report.infos);
  if (infos.length) { L.push('', '[참고]'); infos.forEach(function (k) { L.push('  ' + k + (report.infos[k] > 1 ? ' (' + report.infos[k] + '건)' : '')); }); }
  L.push('', '[확인 필요 ' + report.warnings.length + '건]' + (report.warnings.length ? '' : ' 없음'));
  report.warnings.slice(0, 200).forEach(function (m) { L.push('  - ' + m); });
  if (report.warnings.length > 200) L.push('  … 외 ' + (report.warnings.length - 200) + '건');
  if (report.skipped.length) L.push('', '건너뛴 행 ' + report.skipped.length + '개');
  L.push('', '[옮기지 않는 것 — 전환 때 직접 입력]',
    '  문자 API 키·발신번호, Claude API 키 (구글 스크립트 속성에 있어 시트에 없음)',
    '  웹푸시 VAPID 키 (스크립트 속성) — 옮기지 않으면 알림을 한 번 다시 허용해야 함');
  return L.join('\n');
}

if (typeof module !== 'undefined') module.exports = { hakwonTransform: hakwonTransform, hakwonReportText: hakwonReportText, HAKWON_ORDER: HAKWON_ORDER };
