/**
 * 더블엠수학학원 · 문제풀이 근무일지 — 백엔드 (Google Apps Script)
 *
 * 설치 (한 번만):
 *  1. 데이터 시트 ID 를 SHEET_ID 에 넣는다 (독립 스크립트). 시트의 [확장 프로그램]→[Apps Script] 로 만들었다면 비워도 된다
 *  2. 이 파일 내용을 Code.gs 에 붙여넣고 저장
 *  3. 위쪽 함수 선택에서 `setup` 을 고르고 ▶ 실행 (권한 허용). 시트와 관리자 아이디가 만들어진다
 *  4. [배포] → [새 배포] → 유형 "웹 앱", 실행 계정 "나", 액세스 "모든 사용자" → 배포
 *  5. 나온 웹 앱 URL 을 docs/config.js 의 MM_API_URL 에 넣는다
 *
 * 코드를 고친 뒤에는 [배포] → [배포 관리] → 연필 → 버전 "새 버전" → 배포 를 해야 반영된다. 주소는 그대로다.
 *
 * 시트 구성
 *  members  아이디 (비밀번호는 솔트+SHA-256 해시)
 *  logs     근무일지. 선생님 1명 × 날짜 1일 = 1행. 출근·퇴근 시각, 업무내용, 비고
 *  sessions 로그인 토큰
 */

var SHEETS = {
  members:  ['id', 'name', 'role', 'color', 'active', 'salt', 'pwHash', 'createdAt'],
  logs:     ['id', 'date', 'memberId', 'checkIn', 'checkOut', 'work', 'note', 'updatedBy', 'updatedAt'],
  sessions: ['token', 'memberId', 'expiresAt'],
};
var DATE_COLS = { date: 'yyyy-MM-dd' };            // 시트가 날짜로 바꿔 놓아도 문자열로 되돌린다
var TIME_COLS = { checkIn: 'HH:mm', checkOut: 'HH:mm' };
var SHEET_ID = '1TNHAyqMIj43wRvaFtAp8eu4KOIPItcWzYy3ZFtxusMs'; // 데이터 시트. 시트에 묶인 스크립트면 비워도 된다
var TZ = 'Asia/Seoul';
var SESSION_HOURS = 24 * 14;   // 로그인 유지 2주
var DEFAULT_ADMIN = { id: 'mmmath01', name: '원장', pw: '0000' };

// ---------- 진입점 ----------
function doGet(e) {
  return json({ ok: true, app: '더블엠 문제풀이 근무일지 API', version: 2, time: new Date().toISOString(), today: todayStr() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    var action = String(req.action || '');
    var me = null;
    if (action !== 'login') {
      me = sessionUser(req.token);
      if (!me) return json({ ok: false, error: 'unauthorized', message: '로그인이 필요합니다.' });
    }
    var handler = ACTIONS[action];
    if (!handler) return json({ ok: false, error: 'bad_action', message: '알 수 없는 요청: ' + action });
    return json({ ok: true, data: handler(req, me), today: todayStr() });
  } catch (err) {
    return json({ ok: false, error: err.name === 'AppError' ? err.code : 'server_error', message: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

var ACTIONS = {
  login: function (req) {
    var id = String(req.id || '').trim().toLowerCase();
    var pw = String(req.pw || '');
    var m = findMember(id);
    if (!m || m.active === false || !pw || hash(m.salt, pw) !== m.pwHash) fail('bad_login', '아이디 또는 비밀번호가 맞지 않습니다.');
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    var exp = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    appendRow('sessions', { token: token, memberId: m.id, expiresAt: exp });
    pruneSessions();
    return { token: token, me: publicMember(m), members: listMembers() };
  },
  logout: function (req) { deleteRows('sessions', function (r) { return r.token === req.token; }); return true; },
  me: function (req, me) { return { me: publicMember(me), members: listMembers() }; },

  /** 기간(from~to, yyyy-MM-dd 포함) 안의 근무일지 */
  listLogs: function (req) {
    var from = String(req.from || ''), to = String(req.to || '');
    if (!isDate(from) || !isDate(to)) fail('bad_request', '기간이 잘못되었습니다.');
    return readRows('logs').filter(function (r) { return r.date >= from && r.date <= to; }).map(logOut);
  },

  /** 출근/퇴근 버튼. 서버 시각(한국시간)으로 오늘 행에 찍는다 */
  clock: function (req, me) {
    var type = req.type === 'out' ? 'out' : 'in';
    var date = todayStr(), now = nowHM();
    var row = findLog(date, me.id) || newLog(date, me.id);
    if (type === 'in') {
      if (row.checkIn) fail('bad_request', '이미 출근 처리되어 있습니다 (' + row.checkIn + ').');
      row.checkIn = now;
    } else {
      if (!row.checkIn) fail('bad_request', '출근 처리가 먼저 필요합니다.');
      if (row.checkOut) fail('bad_request', '이미 퇴근 처리되어 있습니다 (' + row.checkOut + ').');
      row.checkOut = now;
    }
    row.updatedBy = me.id; row.updatedAt = new Date().toISOString();
    upsertRow('logs', 'id', row);
    return logOut(row);
  },

  /** 일지 저장. 관리자는 아무 선생님·날짜, 선생님은 본인 것만. 같은 날짜·선생님 행이 있으면 그 행을 고친다 */
  saveLog: function (req, me) {
    var l = req.log || {};
    var memberId = String(l.memberId || me.id).toLowerCase();
    if (me.role !== 'admin' && memberId !== me.id) fail('forbidden', '본인 일지만 쓸 수 있습니다.');
    if (!findMember(memberId)) fail('bad_request', '없는 아이디입니다.');
    var date = String(l.date || '');
    if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    var cin = String(l.checkIn || ''), cout = String(l.checkOut || '');
    if (cin && !isTime(cin)) fail('bad_request', '출근 시각이 잘못되었습니다.');
    if (cout && !isTime(cout)) fail('bad_request', '퇴근 시각이 잘못되었습니다.');
    if (cin && cout && cout <= cin) fail('bad_request', '퇴근 시각이 출근 시각보다 늦어야 합니다.');
    var row = (l.id ? readRows('logs').filter(function (r) { return r.id === l.id; })[0] : null) || findLog(date, memberId) || newLog(date, memberId);
    if (me.role !== 'admin' && row.memberId !== me.id) fail('forbidden', '본인 일지만 고칠 수 있습니다.');
    row.date = date; row.memberId = memberId; row.checkIn = cin; row.checkOut = cout;
    row.work = String(l.work || '').slice(0, 3000);
    row.note = String(l.note || '').slice(0, 500);
    row.updatedBy = me.id; row.updatedAt = new Date().toISOString();
    upsertRow('logs', 'id', row);
    return logOut(row);
  },

  deleteLog: function (req, me) {
    var old = readRows('logs').filter(function (r) { return r.id === req.id; })[0];
    if (!old) return true;
    if (me.role !== 'admin' && old.memberId !== me.id) fail('forbidden', '본인 일지만 지울 수 있습니다.');
    deleteRows('logs', function (r) { return r.id === req.id; });
    return true;
  },

  saveMember: function (req, me) {
    if (me.role !== 'admin') fail('forbidden', '관리자만 아이디를 관리할 수 있습니다.');
    var m = req.member || {};
    var id = String(m.id || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,20}$/.test(id)) fail('bad_request', '아이디는 영문·숫자 2~20자입니다.');
    var existing = findMember(id);
    if (!existing && !m.pw) fail('bad_request', '새 아이디에는 비밀번호가 필요합니다.');
    if (m.pw && String(m.pw).length < 4) fail('bad_request', '비밀번호는 4자 이상입니다.');
    var role = m.role === 'admin' ? 'admin' : 'teacher';
    if (id === me.id && role !== 'admin') fail('bad_request', '자기 자신의 관리자 권한은 뺄 수 없습니다.');
    var active = m.active === false ? false : true;
    if (id === me.id && !active) fail('bad_request', '자기 자신은 비활성화할 수 없습니다.');
    var row = {
      id: id, name: String(m.name || existing && existing.name || id).slice(0, 40), role: role,
      color: /^#[0-9A-Fa-f]{6}$/.test(m.color || '') ? m.color : (existing ? existing.color : '#2A4BB8'),
      active: active,
      salt: existing ? existing.salt : Utilities.getUuid(),
      pwHash: existing ? existing.pwHash : '',
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    if (m.pw) { row.salt = Utilities.getUuid(); row.pwHash = hash(row.salt, String(m.pw)); }
    upsertRow('members', 'id', row);
    if (!active) deleteRows('sessions', function (r) { return r.memberId === id; });
    return listMembers();
  },
};

// ---------- 설치 ----------
function setup() {
  Object.keys(SHEETS).forEach(function (name) { sheet(name); });
  if (!findMember(DEFAULT_ADMIN.id)) {
    var salt = Utilities.getUuid();
    appendRow('members', { id: DEFAULT_ADMIN.id, name: DEFAULT_ADMIN.name, role: 'admin', color: '#2A4BB8', active: true, salt: salt, pwHash: hash(salt, DEFAULT_ADMIN.pw), createdAt: new Date().toISOString() });
  }
  Logger.log('설치 완료. 관리자 ' + DEFAULT_ADMIN.id + ' / ' + DEFAULT_ADMIN.pw);
}

// ---------- 도우미 ----------
function fail(code, message) { var e = new Error(message); e.name = 'AppError'; e.code = code; throw e; }
function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function hash(salt, pw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isTime(s) { return /^\d{2}:\d{2}$/.test(s); }
function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowHM() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function publicMember(m) { return { id: m.id, name: m.name, role: m.role, color: m.color, active: m.active !== false }; }
function listMembers() { return readRows('members').map(publicMember); }
function findMember(id) { return readRows('members').filter(function (r) { return r.id === id; })[0] || null; }
function findLog(date, memberId) { return readRows('logs').filter(function (r) { return r.date === date && r.memberId === memberId; })[0] || null; }
function newLog(date, memberId) { return { id: 'L' + Utilities.getUuid().slice(0, 8), date: date, memberId: memberId, checkIn: '', checkOut: '', work: '', note: '' }; }
function logOut(r) {
  return { id: r.id, date: r.date, memberId: r.memberId, checkIn: r.checkIn || '', checkOut: r.checkOut || '', work: r.work || '', note: r.note || '', updatedBy: r.updatedBy || '', updatedAt: r.updatedAt || '' };
}
function sessionUser(token) {
  if (!token) return null;
  var s = readRows('sessions').filter(function (r) { return r.token === token; })[0];
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  var m = findMember(s.memberId);
  return m && m.active !== false ? m : null;
}
function pruneSessions() { var now = new Date(); deleteRows('sessions', function (r) { return new Date(r.expiresAt) < now; }); }

function spreadsheet() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet(name) {
  var ss = spreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat('@'); // 문자 그대로 저장 (날짜·시각 자동변환 방지)
    sh.appendRow(SHEETS[name]); sh.setFrozenRows(1);
  }
  return sh;
}
function cellToString(col, x) {
  if (x instanceof Date) {
    var tz = spreadsheet().getSpreadsheetTimeZone();
    if (DATE_COLS[col]) return Utilities.formatDate(x, tz, DATE_COLS[col]);
    if (TIME_COLS[col]) return Utilities.formatDate(x, tz, TIME_COLS[col]);
    return x.toISOString();
  }
  if (col === 'active') return x !== false && x !== 'FALSE' && x !== 'false';
  if (x === '' || x === null || x === undefined) return '';
  if (typeof x === 'number' && TIME_COLS[col]) { // 시각이 0~1 사이 숫자로 들어온 경우
    var mins = Math.round(x * 24 * 60); return ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + (mins % 60)).slice(-2);
  }
  return typeof x === 'number' ? x : String(x);
}
function readRows(name) {
  var sh = sheet(name), cols = SHEETS[name];
  var last = sh.getLastRow(); if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (v, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = cellToString(c, v[j]); });
    return o;
  }).filter(function (o) { return o[cols[0]] !== ''; });
}
function rowValues(name, obj) { return SHEETS[name].map(function (c) { return obj[c] === undefined ? '' : obj[c]; }); }
function appendRow(name, obj) {
  var sh = sheet(name), r = sh.getLastRow() + 1, n = SHEETS[name].length;
  var range = sh.getRange(r, 1, 1, n);
  range.setNumberFormat('@').setValues([rowValues(name, obj)]);
}
function upsertRow(name, key, obj) {
  var rows = readRows(name), hit = rows.filter(function (r) { return r[key] === obj[key]; })[0];
  if (hit) sheet(name).getRange(hit._row, 1, 1, SHEETS[name].length).setNumberFormat('@').setValues([rowValues(name, obj)]);
  else appendRow(name, obj);
}
function deleteRows(name, pred) {
  var sh = sheet(name), rows = readRows(name).filter(pred);
  rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { sh.deleteRow(r._row); });
}
