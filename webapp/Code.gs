/**
 * 더블엠수학학원 · 문제풀이 근무표 — 백엔드 (Google Apps Script)
 *
 * 설치 (한 번만):
 *  1. 데이터 시트 ID 를 SHEET_ID 에 넣는다 (독립 스크립트). 시트의 [확장 프로그램]→[Apps Script] 로 만들었다면 비워도 된다
 *  2. 이 파일 내용을 Code.gs 에 붙여넣고 저장
 *  3. 위쪽 함수 선택에서 `setup` 을 고르고 ▶ 실행 (권한 허용). 시트와 관리자 아이디가 만들어진다
 *  4. [배포] → [새 배포] → 유형 "웹 앱", 실행 계정 "나", 액세스 "모든 사용자" → 배포
 *  5. 나온 웹 앱 URL 을 docs/config.js 의 MM_API_URL 에 넣는다
 *
 * 처음 관리자: 아이디 wonjang / 비밀번호 0000  (로그인 후 아이디 관리에서 꼭 바꾸세요)
 * 코드를 고친 뒤에는 [배포] → [배포 관리] → 연필 → 새 버전 으로 다시 배포해야 반영된다.
 */

var SHEETS = {
  members:  ['id', 'name', 'role', 'color', 'active', 'salt', 'pwHash', 'createdAt'],
  shifts:   ['id', 'week', 'day', 'memberId', 'start', 'end', 'tasks', 'note', 'updatedBy', 'updatedAt'],
  sessions: ['token', 'memberId', 'expiresAt'],
};
var SHEET_ID = '1TNHAyqMIj43wRvaFtAp8eu4KOIPItcWzYy3ZFtxusMs'; // 데이터 시트. 시트에 묶인 스크립트면 비워도 된다
var SESSION_HOURS = 24 * 14;   // 로그인 유지 2주
var DEFAULT_ADMIN = { id: 'wonjang', name: '원장', pw: '0000' };

// ---------- 진입점 ----------
function doGet(e) {
  return json({ ok: true, app: '더블엠 문제풀이 근무표 API', time: new Date().toISOString() });
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
    return json({ ok: true, data: handler(req, me) });
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

  listShifts: function (req) { return readRows('shifts').filter(function (r) { return r.week === req.week; }).map(shiftOut); },

  saveShift: function (req, me) {
    var s = req.shift || {};
    var memberId = String(s.memberId || me.id);
    if (me.role !== 'admin' && memberId !== me.id) fail('forbidden', '본인 근무만 등록할 수 있습니다.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.week))) fail('bad_request', '주 정보가 잘못되었습니다.');
    var day = Number(s.day);
    if (!(day >= 0 && day <= 6)) fail('bad_request', '요일이 잘못되었습니다.');
    if (!/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end) || s.end <= s.start) fail('bad_request', '시간이 잘못되었습니다.');
    var row = {
      id: s.id || ('s' + Utilities.getUuid().slice(0, 8)), week: s.week, day: day, memberId: memberId,
      start: s.start, end: s.end, tasks: JSON.stringify(Array.isArray(s.tasks) ? s.tasks.map(String).slice(0, 20) : []),
      note: String(s.note || '').slice(0, 500), updatedBy: me.id, updatedAt: new Date().toISOString(),
    };
    if (s.id) {
      var old = readRows('shifts').filter(function (r) { return r.id === s.id; })[0];
      if (!old) fail('not_found', '이미 삭제된 근무입니다.');
      if (me.role !== 'admin' && old.memberId !== me.id) fail('forbidden', '본인 근무만 수정할 수 있습니다.');
      upsertRow('shifts', 'id', row);
    } else appendRow('shifts', row);
    return shiftOut(row);
  },

  deleteShift: function (req, me) {
    var old = readRows('shifts').filter(function (r) { return r.id === req.id; })[0];
    if (!old) return true;
    if (me.role !== 'admin' && old.memberId !== me.id) fail('forbidden', '본인 근무만 삭제할 수 있습니다.');
    deleteRows('shifts', function (r) { return r.id === req.id; });
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
function publicMember(m) { return { id: m.id, name: m.name, role: m.role, color: m.color, active: m.active !== false }; }
function listMembers() { return readRows('members').map(publicMember); }
function findMember(id) { return readRows('members').filter(function (r) { return r.id === id; })[0] || null; }
function shiftOut(r) {
  var tasks = []; try { tasks = JSON.parse(r.tasks || '[]'); } catch (e) {}
  return { id: r.id, week: r.week, day: Number(r.day), memberId: r.memberId, start: r.start, end: r.end, tasks: tasks, note: r.note || '', updatedBy: r.updatedBy, updatedAt: r.updatedAt };
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
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(SHEETS[name]); sh.setFrozenRows(1); }
  return sh;
}
function readRows(name) {
  var sh = sheet(name), cols = SHEETS[name];
  var last = sh.getLastRow(); if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (v, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { var x = v[j]; o[c] = (x instanceof Date) ? x.toISOString() : (c === 'active' ? x !== false && x !== 'FALSE' && x !== 'false' : (x === '' ? '' : (typeof x === 'number' ? x : String(x)))); });
    return o;
  }).filter(function (o) { return o[cols[0]] !== ''; });
}
function rowValues(name, obj) { return SHEETS[name].map(function (c) { return obj[c] === undefined ? '' : obj[c]; }); }
function appendRow(name, obj) { sheet(name).appendRow(rowValues(name, obj)); }
function upsertRow(name, key, obj) {
  var rows = readRows(name), hit = rows.filter(function (r) { return r[key] === obj[key]; })[0];
  if (hit) sheet(name).getRange(hit._row, 1, 1, SHEETS[name].length).setValues([rowValues(name, obj)]);
  else appendRow(name, obj);
}
function deleteRows(name, pred) {
  var sh = sheet(name), rows = readRows(name).filter(pred);
  rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { sh.deleteRow(r._row); });
}
