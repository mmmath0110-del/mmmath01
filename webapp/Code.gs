/**
 * 더블엠수학학원 · 선생님 출결관리 대시보드 — 백엔드 (Google Apps Script)
 *
 * 권한: 관리자(admin)는 전원의 기록·아이디 관리. 선생님(teacher)은 본인 기록만 받고 본인 것만 쓴다.
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
 *           출근·퇴근 시각은 출근/퇴근 버튼(서버 시각)으로만 찍힌다. 선생님은 시각을 고칠 수 없고,
 *           관리자가 고치면 fixedBy 에 "아이디 시각" 이 남는다
 *  sessions 로그인 토큰
 *
 * 학원관리시스템(Academy.gs)을 같은 프로젝트에 넣으면 그 시트·액션도 여기서 함께 처리한다.
 *
 * 서버 자동 업데이트: 앱의 [서버 업데이트] 버튼 → selfUpdate 액션 → GitHub main 의 webapp/ 파일을 받아
 * 이 프로젝트에 넣고 새 버전을 만들어 웹 앱 배포를 그 버전으로 바꾼다. (한 번만) 준비할 것:
 *  1. https://script.google.com/home/usersettings 에서 "Google Apps Script API" 켜기
 *  2. 프로젝트 설정 → "appsscript.json 매니페스트 파일을 편집기에 표시" → webapp/appsscript.json 내용으로 교체 (oauthScopes 포함)
 *  3. 편집기에서 setup 을 실행해 새 권한 허용
 * 서버 코드를 고칠 때는 SERVER_VERSION 을 올린다. 앱은 이 번호로 구버전 여부를 판단한다.
 */

var SERVER_VERSION = 6;
var UPDATE_SOURCE = 'https://raw.githubusercontent.com/mmmath0110-del/mmmath01/main/webapp/';
var UPDATE_FILES = [
  { name: 'Code', file: 'Code.gs', type: 'SERVER_JS' },
  { name: 'Academy', file: 'Academy.gs', type: 'SERVER_JS' },
  { name: 'appsscript', file: 'appsscript.json', type: 'JSON' },
];

var SHEETS = {
  members:  ['id', 'name', 'role', 'color', 'active', 'salt', 'pwHash', 'createdAt'],
  logs:     ['id', 'date', 'memberId', 'checkIn', 'checkOut', 'work', 'note', 'updatedBy', 'updatedAt', 'fixedBy'],
  sessions: ['token', 'memberId', 'expiresAt'],
};
// 시트가 날짜·시각으로 바꿔 놓아도 문자열로 되돌린다 (Academy.gs 의 컬럼 포함)
var DATE_COLS = { date: 'yyyy-MM-dd', birth: 'yyyy-MM-dd', enrolledAt: 'yyyy-MM-dd', leftAt: 'yyyy-MM-dd', startDate: 'yyyy-MM-dd', endDate: 'yyyy-MM-dd', nextDate: 'yyyy-MM-dd' };
var TIME_COLS = { checkIn: 'HH:mm', checkOut: 'HH:mm', start: 'HH:mm', end: 'HH:mm', time: 'HH:mm' };
var SHEET_ID = '1TNHAyqMIj43wRvaFtAp8eu4KOIPItcWzYy3ZFtxusMs'; // 데이터 시트. 시트에 묶인 스크립트면 비워도 된다
var TZ = 'Asia/Seoul';
var SESSION_HOURS = 24 * 14;   // 로그인 유지 2주
var DEFAULT_ADMIN = { id: 'mmmath01', name: '원장', pw: '0000' };

// ---------- 진입점 ----------
function doGet(e) {
  return json({ ok: true, app: '더블엠 선생님 출결관리 · 학원관리 API', version: SERVER_VERSION, academy: typeof ACADEMY_ACTIONS !== 'undefined', time: new Date().toISOString(), today: todayStr() });
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
    var handler = ACTIONS[action] || (typeof ACADEMY_ACTIONS !== 'undefined' ? ACADEMY_ACTIONS[action] : null);
    if (!handler) return json({ ok: false, error: 'bad_action', message: '알 수 없는 요청: ' + action });
    return json({ ok: true, data: handler(req, me), today: todayStr(), version: SERVER_VERSION });
  } catch (err) {
    return json({ ok: false, error: err.name === 'AppError' ? err.code : 'server_error', message: String(err.message || err), version: SERVER_VERSION });
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
    return { token: token, me: publicMember(m), members: membersFor(m) };
  },
  logout: function (req) { deleteRows('sessions', function (r) { return r.token === req.token; }); return true; },
  me: function (req, me) { return { me: publicMember(me), members: membersFor(me) }; },

  /** 기간(from~to, yyyy-MM-dd 포함) 안의 근무일지. 관리자는 전원, 선생님은 본인 것만 */
  listLogs: function (req, me) {
    var from = String(req.from || ''), to = String(req.to || '');
    if (!isDate(from) || !isDate(to)) fail('bad_request', '기간이 잘못되었습니다.');
    var rows = readRows('logs').filter(function (r) { return r.date >= from && r.date <= to; });
    if (me.role !== 'admin') rows = rows.filter(function (r) { return r.memberId === me.id; });
    return rows.map(logOut);
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

  /**
   * 일지 저장. 관리자는 아무 선생님·날짜의 시각·내용을 고칠 수 있다.
   * 선생님은 본인 일지의 업무내용·비고만 쓸 수 있고, 출근·퇴근 시각은 버튼으로 찍힌 값이 그대로 유지된다.
   * 같은 날짜·선생님 행이 있으면 그 행을 고친다
   */
  saveLog: function (req, me) {
    var l = req.log || {};
    var memberId = String(l.memberId || me.id).toLowerCase();
    if (me.role !== 'admin' && memberId !== me.id) fail('forbidden', '본인 일지만 쓸 수 있습니다.');
    if (!findMember(memberId)) fail('bad_request', '없는 아이디입니다.');
    var date = String(l.date || '');
    if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    var row = (l.id ? readRows('logs').filter(function (r) { return r.id === l.id; })[0] : null) || findLog(date, memberId) || newLog(date, memberId);
    if (me.role !== 'admin' && row.memberId !== me.id) fail('forbidden', '본인 일지만 고칠 수 있습니다.');
    if (me.role === 'admin') {
      var cin = String(l.checkIn || ''), cout = String(l.checkOut || '');
      if (cin && !isTime(cin)) fail('bad_request', '출근 시각이 잘못되었습니다.');
      if (cout && !isTime(cout)) fail('bad_request', '퇴근 시각이 잘못되었습니다.');
      if (cin && cout && cout <= cin) fail('bad_request', '퇴근 시각이 출근 시각보다 늦어야 합니다.');
      if (cin !== (row.checkIn || '') || cout !== (row.checkOut || '') || date !== row.date || memberId !== row.memberId) {
        row.fixedBy = me.id + ' ' + Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm');
      }
      row.checkIn = cin; row.checkOut = cout; row.date = date; row.memberId = memberId;
    }
    // 선생님: 시각·날짜·대상은 건드리지 않는다 (보내와도 무시)
    row.work = String(l.work || '').slice(0, 3000);
    row.note = String(l.note || '').slice(0, 500);
    row.updatedBy = me.id; row.updatedAt = new Date().toISOString();
    upsertRow('logs', 'id', row);
    return logOut(row);
  },

  deleteLog: function (req, me) {
    if (me.role !== 'admin') fail('forbidden', '일지 삭제는 관리자만 할 수 있습니다.');
    var old = readRows('logs').filter(function (r) { return r.id === req.id; })[0];
    if (!old) return true;
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

  /**
   * 서버 자동 업데이트 (관리자). GitHub main 의 webapp/ 파일로 이 프로젝트를 갱신하고 새 버전으로 배포한다.
   * req.deploymentId: 앱이 쓰는 웹 앱 URL 의 배포 ID (/macros/s/<ID>/exec). 없으면 웹 앱 배포가 하나뿐일 때 그것을 쓴다
   */
  selfUpdate: function (req, me) {
    if (me.role !== 'admin') fail('forbidden', '관리자만 서버를 업데이트할 수 있습니다.');
    var scriptId = ScriptApp.getScriptId();
    var ours = UPDATE_FILES.map(function (f) {
      var r = UrlFetchApp.fetch(UPDATE_SOURCE + f.file + '?t=' + Date.now(), { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) fail('update_failed', 'GitHub 에서 ' + f.file + ' 을 받지 못했습니다 (' + r.getResponseCode() + ').');
      return { name: f.name, type: f.type, source: r.getContentText() };
    });
    var newVer = Number((ours[0].source.match(/var SERVER_VERSION = (\d+)/) || [])[1] || 0);
    if (!newVer) fail('update_failed', '받아온 Code.gs 에서 버전을 읽지 못했습니다.');
    if (newVer <= SERVER_VERSION && !req.force) return { updated: false, version: SERVER_VERSION, message: '이미 최신 버전입니다 (v' + SERVER_VERSION + ').' };
    // 프로젝트에 있는 다른 파일은 그대로 두고 우리 파일만 바꾼다
    var cur = gasApi('get', 'projects/' + scriptId + '/content');
    var keep = (cur.files || []).filter(function (f) { return !UPDATE_FILES.some(function (u) { return u.name === f.name; }); })
      .map(function (f) { return { name: f.name, type: f.type, source: f.source }; });
    gasApi('put', 'projects/' + scriptId + '/content', { files: keep.concat(ours) });
    var ver = gasApi('post', 'projects/' + scriptId + '/versions', { description: 'v' + newVer + ' 자동 업데이트 ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') });
    var deps = (gasApi('get', 'projects/' + scriptId + '/deployments?pageSize=50').deployments || []).filter(function (d) {
      return d.deploymentConfig && d.deploymentConfig.versionNumber && (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; });
    });
    var hint = String(req.deploymentId || '');
    var target = deps.filter(function (d) { return d.deploymentId === hint; })[0] || (deps.length === 1 ? deps[0] : null);
    if (!target) fail('update_failed', '코드는 올렸지만 웹 앱 배포를 찾지 못했습니다(' + deps.length + '개). [배포] → [배포 관리] 에서 버전 ' + ver.versionNumber + ' 로 직접 배포해 주세요.');
    gasApi('put', 'projects/' + scriptId + '/deployments/' + target.deploymentId, {
      deploymentConfig: { scriptId: scriptId, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: target.deploymentConfig.description || '웹 앱' },
    });
    return { updated: true, version: newVer, versionNumber: ver.versionNumber, deploymentId: target.deploymentId };
  },
};

/** Apps Script API 호출 (이 프로젝트 자신의 코드·배포를 고칠 때) */
function gasApi(method, path, body) {
  var res = UrlFetchApp.fetch('https://script.googleapis.com/v1/' + path, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
  });
  var code = res.getResponseCode(), txt = res.getContentText();
  if (code === 401 || code === 403) fail('update_auth', 'Apps Script API 를 쓸 권한이 없습니다. (1) https://script.google.com/home/usersettings 에서 "Google Apps Script API" 를 켜고 (2) appsscript.json 에 oauthScopes 가 들어 있는지 확인한 뒤 (3) 편집기에서 setup 을 한 번 실행해 권한을 허용하세요. (HTTP ' + code + ')');
  if (code >= 300) fail('update_failed', 'Apps Script API 오류 (HTTP ' + code + '): ' + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : {};
}

// ---------- 설치 ----------
function setup() {
  Object.keys(SHEETS).forEach(function (name) { sheet(name); });
  if (typeof ACADEMY_SHEETS !== 'undefined') Object.keys(ACADEMY_SHEETS).forEach(function (name) { sheet(name); });
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
/** 화면에 내려줄 아이디 목록: 관리자는 전원, 선생님은 본인만 (다른 선생님 이름도 보이지 않게) */
function membersFor(me) { return me.role === 'admin' ? listMembers() : [publicMember(me)]; }
function findMember(id) { return readRows('members').filter(function (r) { return r.id === id; })[0] || null; }
function findLog(date, memberId) { return readRows('logs').filter(function (r) { return r.date === date && r.memberId === memberId; })[0] || null; }
function newLog(date, memberId) { return { id: 'L' + Utilities.getUuid().slice(0, 8), date: date, memberId: memberId, checkIn: '', checkOut: '', work: '', note: '', fixedBy: '' }; }
function logOut(r) {
  return { id: r.id, date: r.date, memberId: r.memberId, checkIn: r.checkIn || '', checkOut: r.checkOut || '', work: r.work || '', note: r.note || '', updatedBy: r.updatedBy || '', updatedAt: r.updatedAt || '', fixedBy: r.fixedBy || '' };
}
function sessionUser(token) {
  if (!token) return null;
  var s = readRows('sessions').filter(function (r) { return r.token === token; })[0];
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  var m = findMember(s.memberId);
  return m && m.active !== false ? m : null;
}
function pruneSessions() { var now = new Date(); deleteRows('sessions', function (r) { return new Date(r.expiresAt) < now; }); }

var HEADER_OK = {};
/** 시트의 컬럼 목록 (근무일지 + 학원관리) */
function colsOf(name) {
  var c = SHEETS[name] || (typeof ACADEMY_SHEETS !== 'undefined' ? ACADEMY_SHEETS[name] : null);
  if (!c) throw new Error('알 수 없는 시트: ' + name);
  return c;
}
function spreadsheet() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet(name) {
  var ss = spreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), colsOf(name).length).setNumberFormat('@'); // 문자 그대로 저장 (날짜·시각 자동변환 방지)
    sh.appendRow(colsOf(name)); sh.setFrozenRows(1);
  } else if (!HEADER_OK[name]) {
    var cols = colsOf(name), head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
    if (cols.some(function (c, i) { return head[i] !== c; })) sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    HEADER_OK[name] = true;
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
  var sh = sheet(name), cols = colsOf(name);
  var last = sh.getLastRow(); if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (v, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = cellToString(c, v[j]); });
    return o;
  }).filter(function (o) { return o[cols[0]] !== ''; });
}
function rowValues(name, obj) { return colsOf(name).map(function (c) { return obj[c] === undefined ? '' : obj[c]; }); }
function appendRow(name, obj) {
  var sh = sheet(name), r = sh.getLastRow() + 1, n = colsOf(name).length;
  var range = sh.getRange(r, 1, 1, n);
  range.setNumberFormat('@').setValues([rowValues(name, obj)]);
}
function upsertRow(name, key, obj) {
  var rows = readRows(name), hit = rows.filter(function (r) { return r[key] === obj[key]; })[0];
  if (hit) sheet(name).getRange(hit._row, 1, 1, colsOf(name).length).setNumberFormat('@').setValues([rowValues(name, obj)]);
  else appendRow(name, obj);
}
function deleteRows(name, pred) {
  var sh = sheet(name), rows = readRows(name).filter(pred);
  rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { sh.deleteRow(r._row); });
}
