/**
 * 더블엠수학학원 · 학원관리시스템 — 백엔드 (Google Apps Script)
 *
 * Code.gs 와 같은 Apps Script 프로젝트에 파일을 하나 더 만들어(파일명 Academy.gs) 이 내용을 붙여넣는다.
 * 로그인·세션·아이디(members)는 Code.gs 의 것을 그대로 쓴다. 필요한 시트는 처음 쓸 때 자동으로 만들어진다.
 *
 * 시트 구성
 *  students     학생 명부 (재원/휴원/퇴원/대기)
 *  classes      반 (담당 강사, 요일·시간, 월 수강료)
 *  enrollments  수강 등록 (학생 × 반, 시작일·종료일)
 *  attendance   출결 (날짜 × 반 × 학생 = 1행)
 *  payments     수납 (납부 1건 = 1행, 청구월 기준으로 미납 계산)
 *  exams        시험, scores 점수
 *  consults     상담 기록 (재원생 / 신규 문의)
 *  messages     문자 발송 기록
 *  extSchedules 학생 외부 일정 (다른 학원·고정 일정, 요일 1개 = 1행) — 학생·학부모가 링크로 직접 입력
 *  scheduleLinks 학생별 일정 입력 링크 토큰 (학생 1명 = 1행, 재발급하면 토큰이 바뀐다)
 *  settings     관리자 설정 (이동 여유시간 기본값 등)
 *
 * 권한: admin(원장) 전체. teacher(강사)는 학생·출결·성적·상담·문자만. 수납·삭제·아이디 관리는 원장만.
 *
 * 문자 자동 발송(선택): 알리고(aligo.in) 계정이 있으면 아래 SMS 에 값을 넣는다. 비워 두면
 * 앱이 문자 내용을 만들어 휴대폰 문자앱으로 넘기고, 발송 기록만 남긴다.
 */

/**
 * 문자 API. 설정은 코드가 아니라 스크립트 속성(PropertiesService)에 둔다 — 이 저장소는 공개되어 있고 서버가 GitHub 에서 코드를 받아 오므로
 * 키를 코드에 적으면 누구나 볼 수 있다. 관리자가 문자 화면의 [문자 API 설정]에서 넣는다. 아래 SMS 상수는 비상용 기본값(비워 둠).
 *   provider: '' (문자앱으로 전달) | 'aligo' (알리고 smartsms.aligo.in: key·user_id·sender) | 'solapi' (솔라피/쿨SMS solapi.com: API key·API secret·sender)
 */
var SMS = { provider: '', aligo: { key: '', userId: '', sender: '' } };
var SMS_PROVIDERS = { '': '문자앱으로 전달', aligo: '알리고', solapi: '솔라피(쿨SMS)' };
function smsConfig() {
  var p = {}; try { p = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) {}
  var provider = p.SMS_PROVIDER != null ? String(p.SMS_PROVIDER) : SMS.provider;
  return { provider: SMS_PROVIDERS[provider] != null ? provider : '', key: String(p.SMS_KEY || SMS.aligo.key || ''), secret: String(p.SMS_SECRET || ''), userId: String(p.SMS_USER || SMS.aligo.userId || ''), sender: String(p.SMS_SENDER || SMS.aligo.sender || '').replace(/\D/g, ''), title: String(p.SMS_TITLE || '더블엠수학학원') };
}
/** 자동 발송이 가능한 설정인지 */
function smsReady(c) { return c.provider === 'aligo' ? !!(c.key && c.userId && c.sender) : c.provider === 'solapi' ? !!(c.key && c.secret && c.sender) : false; }
/** 화면에 주는 설정 (키·시크릿은 끝 4자리만) */
function smsConfigOut(c) { var tail = function (v) { return v ? '····' + v.slice(-4) : ''; }; return { provider: c.provider, providerName: SMS_PROVIDERS[c.provider] || '', userId: c.userId, sender: c.sender, title: c.title, keySet: !!c.key, keyTail: tail(c.key), secretSet: !!c.secret, secretTail: tail(c.secret), ready: smsReady(c) }; }

/**
 * 드라이브의 "학생관리부" 스프레드시트. 학생 탭의 [학생관리부 가져오기] 가 이 파일의 "전체명단" 탭을 읽는다.
 * 그 탭의 1행이 제목줄이어야 하며, 다음 제목을 인식한다 (순서 무관):
 *   학생ID 성명 부서 학년 담임T 정규반 요일 선행반 학교 학생연락처 학부모연락처 재원상태 진도 비고
 */
var ROSTER_SHEET_ID = '1h1XwG9B7mL6TOAbrjZE2nly0zELKRGnqGR1iqAiPXyg';
var ROSTER_TABS = ['전체명단', '학생관리부'];   // 이 이름의 탭을 먼저 찾는다 (앞에 있는 것 우선). 없으면 성명·학생ID 제목이 있는 탭

var ACADEMY_SHEETS = {
  students:    ['id', 'name', 'status', 'school', 'grade', 'birth', 'phone', 'parentPhone', 'parentName', 'enrolledAt', 'leftAt', 'memo', 'createdAt', 'updatedAt', 'extId'],
  classes:     ['id', 'name', 'subject', 'teacherId', 'days', 'start', 'end', 'room', 'fee', 'status', 'memo', 'createdAt', 'schedule', 'textbook', 'progress', 'lessonNote', 'kind'],
  enrollments: ['id', 'studentId', 'classId', 'startDate', 'endDate', 'fee', 'createdAt', 'endReason', 'deleted', 'updatedAt', 'updatedBy'],   // deleted=TRUE 면 숨김(소프트 삭제)
  attendance:  ['id', 'date', 'classId', 'studentId', 'status', 'note', 'updatedBy', 'updatedAt'],
  checkins:    ['id', 'date', 'time', 'studentId', 'kind', 'classId', 'device', 'sms', 'createdAt'],   // 태블릿 등·하원 (kind 등원|하원, sms: 학부모 알림 결과)
  payments:    ['id', 'date', 'studentId', 'month', 'item', 'amount', 'method', 'classId', 'note', 'createdBy', 'createdAt'],
  exams:       ['id', 'date', 'classId', 'name', 'maxScore', 'memo', 'createdAt', 'classIds'],   // classIds: 등록 때 고른 반들(콤마) · classId 는 예전 단일 반(호환)
  scores:      ['id', 'examId', 'studentId', 'score', 'note', 'classId', 'updatedAt'],      // classId: 응시 당시 반 (없으면 시험일의 수강 반으로 계산) · score '' = 응시자 등록만 되고 미입력
  consults:    ['id', 'date', 'time', 'type', 'studentId', 'name', 'phone', 'school', 'grade', 'content', 'nextDate', 'memberId', 'createdAt', 'updatedAt'],
  messages:    ['id', 'sentAt', 'kind', 'count', 'recipients', 'body', 'method', 'result', 'sentBy'],
  textbooks:   ['id', 'name', 'subject', 'grade', 'createdAt'],   // 교재 목록 (반의 교재를 고를 때 씀)
  extSchedules: ['id', 'studentId', 'name', 'day', 'start', 'end', 'memo', 'createdAt', 'updatedAt'],
  scheduleLinks: ['studentId', 'token', 'active', 'createdAt', 'expiresAt', 'submittedAt'],
  settings:    ['key', 'value'],
  changes:     ['id', 'at', 'memberId', 'memberName', 'type', 'studentId', 'classId', 'before', 'after', 'note'],   // 수강·반 변경 이력
};
var END_REASONS = ['반 변경', '퇴원', '수강 완료', '휴원', '중복 정리', '기타'];
var SETTING_KEYS = { travelBuffer: 1, prorate: 1, kioskPin: 1, kioskSms: 1, kioskMsgIn: 1, kioskMsgOut: 1 };   // 이동 여유시간 기본값(분) · 수강료 일할 계산(on/off) · 출결 태블릿(PIN·문자 on/off·등원/하원 문구)
var CLASS_KINDS = ['정규', '선행'];
var A_DATE_COLS = { date: 1, birth: 1, enrolledAt: 1, leftAt: 1, startDate: 1, endDate: 1, nextDate: 1 };
var A_TIME_COLS = { start: 1, end: 1, time: 1 };
var STUDENT_STATUS = ['재원', '휴원', '퇴원', '대기'];
var ATT_STATUS = ['출석', '지각', '결석', '조퇴', '보강', '기타'];
var PAY_ITEMS = ['수강료', '교재비', '기타'];
var PAY_METHODS = ['현금', '카드', '계좌이체', '기타'];
var CONSULT_TYPES = ['신규상담', '학부모상담', '학생상담', '전화상담', '기타'];

var ACADEMY_ACTIONS = {
  /** 앱 시작 시 한 번: 기본 데이터 전부 */
  bootstrap: function (req, me) {
    return {
      me: publicMember(me), members: listMembers(),
      students: readRows('students').map(studentOut),
      classes: readRows('classes').map(classOut),
      enrollments: enrollmentsOut(),
      textbooks: readRows('textbooks').map(textbookOut),
      extSchedules: readRows('extSchedules').map(extOut),
      scheduleLinks: readRows('scheduleLinks').map(linkOut),
      settings: settingsOut(),
      smsAuto: smsReady(smsConfig()), smsProvider: SMS_PROVIDERS[smsConfig().provider] || '',
    };
  },

  // ---------- 학생 외부 일정 · 일정 입력 링크 ----------
  /** 외부 일정·링크만 다시 읽는다 (학생이 링크로 새로 입력한 것을 반영) */
  listExtSchedules: function () { return { extSchedules: readRows('extSchedules').map(extOut), scheduleLinks: readRows('scheduleLinks').map(linkOut) }; },
  /** 학생의 외부 일정을 통째로 바꾼다 (강사도 가능). items: [{name, day, start, end, memo}] */
  saveExtSchedules: function (req, me) {
    var s = findRow('students', String(req.studentId || '')); if (!s) fail('bad_request', '없는 학생입니다.');
    var items = replaceExtSchedules(s.id, req.items);
    var link = readRows('scheduleLinks').filter(function (r) { return r.studentId === s.id; })[0];
    if (link) { link.submittedAt = new Date().toISOString(); upsertRow('scheduleLinks', 'studentId', link); }
    return { items: items, link: link ? linkOut(link) : null };
  },
  /** 일정 입력 링크. 없으면 만들고, renew 면 기존 링크를 폐기하고 새로 발급한다 */
  scheduleLink: function (req, me) {
    var s = findRow('students', String(req.studentId || '')); if (!s) fail('bad_request', '없는 학생입니다.');
    var cur = readRows('scheduleLinks').filter(function (r) { return r.studentId === s.id; })[0];
    if (cur && cur.active && !req.renew && !linkExpired(cur)) return linkOut(cur);
    var row = { studentId: s.id, token: newToken(), active: true, createdAt: new Date().toISOString(), expiresAt: '', submittedAt: cur ? cur.submittedAt || '' : '' };
    upsertRow('scheduleLinks', 'studentId', row);
    return linkOut(row);
  },
  /** 링크 폐기 (새로 발급하기 전까지 학생이 접속할 수 없다) */
  revokeScheduleLink: function (req, me) {
    var cur = readRows('scheduleLinks').filter(function (r) { return r.studentId === String(req.studentId || ''); })[0];
    if (!cur) return null;
    cur.active = false; upsertRow('scheduleLinks', 'studentId', cur);
    return linkOut(cur);
  },
  /** 관리자 설정 저장 (travelBuffer: 이동 여유시간 기본값(분) · prorate: 수강료 일할 계산 on/off) */
  saveSetting: function (req, me) {
    requireAdmin(me);
    var key = str(req.key, 40); if (!SETTING_KEYS[key]) fail('bad_request', '알 수 없는 설정: ' + key);
    var value = key === 'prorate' ? (req.value === true || req.value === 'on' || req.value === 'true' ? 'on' : 'off') : str(req.value, 200);
    upsertRow('settings', 'key', { key: key, value: value });
    return settingsOut();
  },
  /** [로그인 없음] 일정 입력 링크로 학생 이름과 현재 일정을 본다. 이름 외의 정보는 주지 않는다 */
  pubSchedule: function (req) {
    var link = linkByToken(req.link);
    var s = findRow('students', link.studentId); if (!s) fail('bad_link', '유효하지 않은 링크입니다. 학원에 새 링크를 요청해 주세요.');
    return { name: s.name, items: extOf(s.id).map(pubExtOut), submittedAt: link.submittedAt || '' };
  },
  /** [로그인 없음] 일정 입력 링크로 일정을 저장한다 (기존 일정을 통째로 바꾼다) */
  pubScheduleSave: function (req) {
    var link = linkByToken(req.link);
    var items = replaceExtSchedules(link.studentId, req.items);
    link.submittedAt = new Date().toISOString(); upsertRow('scheduleLinks', 'studentId', link);
    return { items: items.map(pubExtOut), submittedAt: link.submittedAt };
  },

  // ---------- 교재 목록 ----------
  listTextbooks: function () { return readRows('textbooks').map(textbookOut); },
  /** 교재 추가(같은 이름이 있으면 그것을 돌려준다). 강사도 가능 */
  saveTextbook: function (req, me) {
    var name = str(req.name, 100); if (!name) fail('bad_request', '교재 이름을 입력하세요.');
    var rows = readRows('textbooks'), hit = rows.filter(function (r) { return r.name === name; })[0];
    if (!hit) { hit = { id: newId('B'), name: name, subject: str(req.subject, 40), grade: str(req.grade, 10), createdAt: new Date().toISOString() }; appendRow('textbooks', hit); }
    return readRows('textbooks').map(textbookOut);
  },
  deleteTextbook: function (req, me) {
    requireAdmin(me);
    deleteRows('textbooks', function (r) { return r.id === String(req.id || ''); });
    return readRows('textbooks').map(textbookOut);
  },

  // ---------- 학생 ----------
  saveStudent: function (req, me) {
    var s = req.student || {};
    var existing = s.id ? findRow('students', s.id) : null;
    if (s.id && !existing) fail('bad_request', '없는 학생입니다.');
    var name = str(s.name, 40); if (!name) fail('bad_request', '이름을 입력하세요.');
    var status = STUDENT_STATUS.indexOf(s.status) >= 0 ? s.status : '재원';
    ['birth', 'enrolledAt', 'leftAt'].forEach(function (k) { if (s[k] && !isDate(String(s[k]))) fail('bad_request', '날짜 형식이 잘못되었습니다: ' + k); });
    var row = {
      id: existing ? existing.id : newId('S'), name: name, status: status,
      school: str(s.school, 40), grade: str(s.grade, 10), birth: str(s.birth, 10),
      phone: phoneStr(s.phone), parentPhone: phoneStr(s.parentPhone), parentName: str(s.parentName, 30),
      enrolledAt: str(s.enrolledAt, 10) || (existing ? existing.enrolledAt : todayStr()),
      leftAt: status === '퇴원' ? (str(s.leftAt, 10) || (existing && existing.leftAt) || todayStr()) : str(s.leftAt, 10),
      memo: str(s.memo, 2000), extId: existing ? (existing.extId || '') : str(s.extId, 20),
      createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    upsertRow('students', 'id', row);
    if (Array.isArray(req.classIds)) syncEnrollments(row.id, req.classIds.map(String), status, me);
    else if (status === '퇴원' || status === '휴원') syncEnrollments(row.id, [], status, me);
    // 재원상태가 바뀌면 학생관리부 시트에도 써 둔다 (안 그러면 다음 가져오기 때 시트 값으로 되돌아간다)
    var sheetNote = (existing && existing.status !== status && row.extId) ? rosterSetStatus(row.extId, status) : null;
    if (row.extId && (Array.isArray(req.classIds) || status === '퇴원' || status === '휴원')) sheetNote = rosterSyncStudent(row.id) || sheetNote;   // 반 칸도 시트에 맞춘다
    return { student: studentOut(row), enrollments: enrollmentsOut(), sheet: sheetNote };
  },

  deleteStudent: function (req, me) {
    requireAdmin(me);
    var id = String(req.id || '');
    if (!findRow('students', id)) return true;
    if (readRows('payments').some(function (p) { return p.studentId === id; })) fail('bad_request', '수납 내역이 있는 학생은 삭제할 수 없습니다. 퇴원 처리해 주세요.');
    var s0 = findRow('students', id);
    ['enrollments', 'attendance', 'scores', 'consults', 'extSchedules', 'scheduleLinks'].forEach(function (n) { deleteRows(n, function (r) { return r.studentId === id; }); });
    deleteRows('students', function (r) { return r.id === id; });
    if (s0 && s0.extId) rosterSetStatus(s0.extId, '삭제');   // 시트 행은 남기되 "삭제" 로 표시 → 가져오기가 건너뛴다
    return true;
  },

  /** 학생 한 명의 전체 기록 (상세 화면) */
  studentDetail: function (req, me) {
    var id = String(req.id || '');
    var s = findRow('students', id); if (!s) fail('bad_request', '없는 학생입니다.');
    var since = addDaysStr(todayStr(), -180);
    return {
      student: studentOut(s),
      enrollments: readEnr().filter(function (r) { return r.studentId === id; }).map(enrollOut),
      attendance: readRows('attendance').filter(function (r) { return r.studentId === id && r.date >= since; }).map(attOut),
      payments: me.role === 'admin' ? readRows('payments').filter(function (r) { return r.studentId === id; }).map(payOut) : [],
      scores: studentScoresOut(id),
      consults: readRows('consults').filter(function (r) { return r.studentId === id; }).map(consultOut),
      extSchedules: extOf(id),
      link: (function () { var l = readRows('scheduleLinks').filter(function (r) { return r.studentId === id; })[0]; return l ? linkOut(l) : null; })(),
    };
  },

  // ---------- 반 ----------
  saveClass: function (req, me) {
    var c = req.cls || {};
    var existing = c.id ? findRow('classes', c.id) : null;
    if (c.id && !existing) fail('bad_request', '없는 반입니다.');
    var name = str(c.name, 40); if (!name) fail('bad_request', '반 이름을 입력하세요.');
    if (c.start && !isTime(String(c.start))) fail('bad_request', '시작 시각이 잘못되었습니다.');
    if (c.end && !isTime(String(c.end))) fail('bad_request', '종료 시각이 잘못되었습니다.');
    // 요일별 시간(slots: [{day,start,end}])이 오면 그것을 기준으로 days/start/end 를 맞춘다. 없으면 예전 방식(days + 공통 start/end)
    var slots = null;
    if (Array.isArray(c.slots)) {
      slots = [];
      c.slots.forEach(function (x) {
        var d = str(x.day, 1); if ('월화수목금토일'.indexOf(d) < 0 || slots.some(function (y) { return y.day === d; })) return;
        var st = str(x.start, 5), en = str(x.end, 5);
        if (st && !isTime(st)) fail('bad_request', d + '요일 시작 시각이 잘못되었습니다.');
        if (en && !isTime(en)) fail('bad_request', d + '요일 종료 시각이 잘못되었습니다.');
        if (st && en && en <= st) fail('bad_request', d + '요일 종료 시각이 시작 시각보다 늦어야 합니다.');
        slots.push({ day: d, start: st, end: en });
      });
      slots.sort(function (a, b) { return '월화수목금토일'.indexOf(a.day) - '월화수목금토일'.indexOf(b.day); });
    }
    var days = slots ? slots.map(function (x) { return x.day; }) : String(c.days || '').split(',').map(function (d) { return d.trim(); }).filter(function (d) { return '월화수목금토일'.indexOf(d) >= 0; });
    days = '월화수목금토일'.split('').filter(function (d) { return days.indexOf(d) >= 0; });
    var first = slots ? (slots.filter(function (x) { return x.start; })[0] || {}) : { start: str(c.start, 5), end: str(c.end, 5) };
    var row = {
      id: existing ? existing.id : newId('C'), name: name, subject: str(c.subject, 20),
      teacherId: c.teacherId && findMember(String(c.teacherId).toLowerCase()) ? String(c.teacherId).toLowerCase() : '',
      days: days.join(','), start: first.start || '', end: first.end || '', room: str(c.room, 20),
      fee: Math.max(0, Math.round(num(c.fee))), status: c.status === '종료' ? '종료' : '운영', memo: str(c.memo, 1000),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      schedule: slots ? slots.map(function (x) { return x.day + ' ' + x.start + '-' + x.end; }).join('|') : days.map(function (d) { return d + ' ' + str(c.start, 5) + '-' + str(c.end, 5); }).join('|'),
      // 수업 정보(교재·진도·수업메모)는 보내온 값이 있으면 쓰고, 없으면 기존 값을 지킨다
      textbook: c.textbook !== undefined ? str(c.textbook, 100) : (existing ? existing.textbook || '' : ''),
      progress: c.progress !== undefined ? str(c.progress, 500) : (existing ? existing.progress || '' : ''),
      lessonNote: c.lessonNote !== undefined ? str(c.lessonNote, 1000) : (existing ? existing.lessonNote || '' : ''),
      kind: CLASS_KINDS.indexOf(c.kind) >= 0 ? c.kind : (existing ? existing.kind || '' : ''),
    };
    upsertRow('classes', 'id', row);
    // 반 이름이 바뀌면 이름만 바뀐다 (반 id·수강 기록은 그대로). 이력을 남기고 학생관리부 시트의 반 이름도 맞춘다
    var sheetNote = null;
    if (existing && existing.name !== row.name) { logChange(me, 'class_rename', '', row.id, existing.name, row.name, ''); sheetNote = rosterRenameClass(existing.name, row.name, row.id); }
    // 반을 만들면서 학생을 바로 수강 등록 (공통 가능시간 → [이 시간으로 반 개설]). 이미 수강 중이면 건너뛴다
    if (Array.isArray(c.enrollStudentIds) && c.enrollStudentIds.length && row.status !== '종료') {
      var start0 = str(c.enrollStart, 10) && isDate(str(c.enrollStart, 10)) ? str(c.enrollStart, 10) : todayStr();
      c.enrollStudentIds.map(String).forEach(function (sid) { if (findRow('students', sid) && startEnrollment(sid, row.id, start0, '', me, '반 개설')) rosterSyncStudent(sid); });
    }
    if (row.status === '종료') {
      var today = todayStr();
      var open = readEnr().filter(function (r) { return r.classId === row.id && isActiveEnr(r, today); });
      open.forEach(function (r) { r.endDate = today; });
      upsertMany('enrollments', 'id', open);
    }
    return { cls: classOut(row), enrollments: enrollmentsOut(), sheet: sheetNote };
  },

  /** 수업 정보만 고친다 (교과·교재·진도·수업메모). 강사도 가능. 요일·시간·담임 등은 건드리지 않는다 */
  updateClassInfo: function (req, me) {
    var c = findRow('classes', String(req.id || '')); if (!c) fail('bad_request', '없는 반입니다.');
    if (req.subject !== undefined) c.subject = str(req.subject, 40);
    if (req.kind !== undefined) c.kind = CLASS_KINDS.indexOf(req.kind) >= 0 ? req.kind : '';
    if (req.textbook !== undefined) c.textbook = str(req.textbook, 100);
    if (req.progress !== undefined) c.progress = str(req.progress, 500);
    if (req.lessonNote !== undefined) c.lessonNote = str(req.lessonNote, 1000);
    upsertRow('classes', 'id', c);
    return classOut(c);
  },

  deleteClass: function (req, me) {
    requireAdmin(me);
    var id = String(req.id || '');
    var c0 = findRow('classes', id); if (!c0) return true;
    if (readRows('payments').some(function (r) { return r.classId === id; })) fail('bad_request', '수납 기록이 있는 반은 삭제할 수 없습니다. 상태를 "종료"로 바꿔 주세요.');
    var att = readRows('attendance').filter(function (r) { return r.classId === id; }).length, exams = readRows('exams').filter(function (r) { return r.classId === id; });
    if ((att || exams.length) && !req.force) { var e = new Error('출결 ' + att + '건 · 시험 ' + exams.length + '건 기록이 있는 반입니다.'); e.name = 'AppError'; e.code = 'has_records'; e.att = att; e.exams = exams.length; throw e; }
    if (att) deleteRows('attendance', function (r) { return r.classId === id; });
    if (exams.length) { var eid = {}; exams.forEach(function (x) { eid[x.id] = true; }); deleteRows('scores', function (r) { return !!eid[r.examId]; }); deleteRows('exams', function (r) { return r.classId === id; }); }
    deleteRows('enrollments', function (r) { return r.classId === id; });
    deleteRows('classes', function (r) { return r.id === id; });
    return { ok: true, sheet: rosterRemoveClass(c0.name) };   // 시트의 정규반·선행반 칸에서도 이 반을 뺀다 (안 그러면 다음 가져오기 때 다시 생긴다)
  },

  /** 반 추가. 같은 반을 이미 수강 중이면 만들지 않고 알린다 */
  enroll: function (req, me) {
    var studentId = String(req.studentId || ''), classId = String(req.classId || '');
    if (!findRow('students', studentId)) fail('bad_request', '없는 학생입니다.');
    if (!findRow('classes', classId)) fail('bad_request', '없는 반입니다.');
    var start = str(req.startDate, 10) || todayStr(); if (!isDate(start)) fail('bad_request', '시작일이 잘못되었습니다.');
    if (activeEnrOf(studentId, classId).length) fail('already_enrolled', '이미 수강 중인 반입니다.');
    startEnrollment(studentId, classId, start, req.fee, me, '반 추가');
    return { enrollments: enrollmentsOut(), sheet: rosterSyncStudent(studentId) };
  },
  /** 수강 종료: 종료일·사유. 기록은 남긴다 */
  unenroll: function (req, me) {
    var e = readEnr().filter(function (r) { return r.id === String(req.id || ''); })[0]; if (!e) fail('bad_request', '없는 수강 등록입니다.');
    var end = str(req.endDate, 10) || todayStr(); if (!isDate(end)) fail('bad_request', '종료일이 잘못되었습니다.');
    endEnrollment(e, end, str(req.reason, 20) || '기타', me);
    return { enrollments: enrollmentsOut(), sheet: rosterSyncStudent(e.studentId) };
  },
  /** 여러 수강을 한 번에 종료 */
  endEnrollments: function (req, me) {
    var ids = (req.ids || []).map(String), end = str(req.endDate, 10) || todayStr(); if (!isDate(end)) fail('bad_request', '종료일이 잘못되었습니다.');
    var reason = str(req.reason, 20) || '기타', students = {};
    readEnr().forEach(function (e) { if (ids.indexOf(e.id) >= 0) { endEnrollment(e, end, reason, me); students[e.studentId] = true; } });
    var sheet = null; Object.keys(students).forEach(function (sid) { sheet = rosterSyncStudent(sid) || sheet; });
    return { enrollments: enrollmentsOut(), sheet: sheet };
  },
  /** 삭제는 소프트 삭제 (deleted=TRUE). 관리자만. 기록은 시트에 남는다 */
  deleteEnrollment: function (req, me) {
    requireAdmin(me);
    var e = readEnr().filter(function (r) { return r.id === String(req.id || ''); })[0]; if (!e) return { enrollments: enrollmentsOut() };
    e.deleted = true; e.updatedAt = new Date().toISOString(); e.updatedBy = me.id; upsertRow('enrollments', 'id', e);
    logChange(me, 'enroll_delete', e.studentId, e.classId, e.startDate + '~' + (e.endDate || ''), '삭제(숨김)', '');
    return { enrollments: enrollmentsOut(), sheet: rosterSyncStudent(e.studentId) };
  },
  /** 반 변경: 학생 한 명. fromIds(현재 수강 id들) → toClassId, 변경일 date */
  changeClass: function (req, me) {
    var studentId = String(req.studentId || ''), toClassId = String(req.toClassId || ''), date = str(req.date, 10) || todayStr();
    if (!findRow('students', studentId)) fail('bad_request', '없는 학생입니다.');
    if (!findRow('classes', toClassId)) fail('bad_request', '없는 반입니다.');
    if (!isDate(date)) fail('bad_request', '변경일이 잘못되었습니다.');
    var r = changeClassOf(studentId, (req.fromIds || []).map(String), toClassId, date, me);
    r.enrollments = enrollmentsOut(); r.sheet = rosterSyncStudent(studentId); return r;
  },
  /** 학생 일괄 이동: fromClassId 를 수강 중인 studentIds 를 toClassId 로 (각자 기존 수강 종료 + 새 수강) */
  moveStudents: function (req, me) {
    var from = String(req.fromClassId || ''), to = String(req.toClassId || ''), date = str(req.date, 10) || todayStr();
    if (!findRow('classes', to)) fail('bad_request', '없는 반입니다.'); if (!isDate(date)) fail('bad_request', '변경일이 잘못되었습니다.');
    if (from === to) fail('bad_request', '같은 반입니다.');
    var ids = (req.studentIds || []).map(String), moved = 0, skipped = [], sheet = null;
    ids.forEach(function (sid) {
      var cur = activeEnrOf(sid, from).map(function (e) { return e.id; });
      var r = changeClassOf(sid, cur, to, date, me); if (r.created || r.ended) moved++; else skipped.push((findRow('students', sid) || {}).name || sid);
      sheet = rosterSyncStudent(sid) || sheet;
    });
    return { moved: moved, skipped: skipped, enrollments: enrollmentsOut(), sheet: sheet };
  },
  /** 중복 정리: keepId 만 남기고 나머지는 "중복 정리" 사유로 종료 (삭제하지 않는다) */
  resolveDuplicate: function (req, me) {
    var keep = String(req.keepId || ''), ends = (req.endIds || []).map(String), t = todayStr(), sid = '';
    readEnr().forEach(function (e) { if (ends.indexOf(e.id) >= 0 && e.id !== keep) { sid = e.studentId; endEnrollment(e, addDaysStr(t, -1), '중복 정리', me); } });   // 어제로 종료 → 바로 "지난 이력"으로. 오늘 시작한 중복은 숨김
    return { enrollments: enrollmentsOut(), sheet: sid ? rosterSyncStudent(sid) : null };
  },
  /** 변경 이력 (최근 순). studentId / classId / type / from·to(YYYY-MM-DD, 서울 날짜 기준) 로 거를 수 있다. 관리자 화면의 "변경 기록" 탭과 학생 상세가 같이 쓴다 */
  listChanges: function (req) {
    var sid = String(req.studentId || ''), cid = String(req.classId || ''), type = str(req.type, 30), from = normDate(String(req.from || '')), to = normDate(String(req.to || ''));
    var rows = readRows('changes').filter(function (r) {
      if (sid && r.studentId !== sid) return false; if (cid && r.classId !== cid) return false; if (type && r.type !== type) return false;
      if (from || to) { var d = r.at ? Utilities.formatDate(new Date(r.at), TZ, 'yyyy-MM-dd') : ''; if (from && d < from) return false; if (to && d > to) return false; }
      return true;
    });
    rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    var limit = Math.max(1, Math.min(2000, Number(req.limit) || 200));
    return rows.slice(0, limit).map(function (r) { return { id: r.id, at: r.at, memberId: r.memberId, memberName: r.memberName, type: r.type, studentId: r.studentId, classId: r.classId, before: r.before, after: r.after, note: r.note }; });
  },

  // ---------- 출결 ----------
  listAttendance: function (req) {
    var from = String(req.from || ''), to = String(req.to || '');
    if (!isDate(from) || !isDate(to)) fail('bad_request', '기간이 잘못되었습니다.');
    var classId = req.classId ? String(req.classId) : '';
    var studentId = req.studentId ? String(req.studentId) : '';
    return readRows('attendance').filter(function (r) {
      return r.date >= from && r.date <= to && (!classId || r.classId === classId) && (!studentId || r.studentId === studentId);
    }).map(attOut);
  },

  /** 한 반의 하루 출결을 통째로 저장. status 가 빈 학생은 행을 지운다 */
  saveAttendance: function (req, me) {
    var date = String(req.date || ''), classId = String(req.classId || '');
    if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    if (!findRow('classes', classId)) fail('bad_request', '없는 반입니다.');
    var rows = Array.isArray(req.rows) ? req.rows : [];
    var existing = {};
    readRows('attendance').forEach(function (r) { if (r.date === date && r.classId === classId) existing[r.studentId] = r; });
    var ups = [], dels = {};
    rows.forEach(function (x) {
      var sid = String(x.studentId || ''); if (!sid) return;
      var status = ATT_STATUS.indexOf(x.status) >= 0 ? x.status : '';
      if (!status) { if (existing[sid]) dels[existing[sid].id] = true; return; }
      var row = existing[sid] || { id: newId('A'), date: date, classId: classId, studentId: sid };
      row.status = status; row.note = str(x.note, 200); row.updatedBy = me.id; row.updatedAt = new Date().toISOString();
      ups.push(row);
    });
    if (Object.keys(dels).length) deleteRows('attendance', function (r) { return dels[r.id]; });
    upsertMany('attendance', 'id', ups);
    return readRows('attendance').filter(function (r) { return r.date === date && r.classId === classId; }).map(attOut);
  },

  // ---------- 수납 (원장만) ----------
  /** 청구월(month) 이 해당 달이거나, 납부일이 해당 달인 수납 */
  listPayments: function (req, me) {
    requireAdmin(me);
    var month = String(req.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) fail('bad_request', '월이 잘못되었습니다.');
    return readRows('payments').filter(function (r) { return r.month === month || String(r.date).slice(0, 7) === month; }).map(payOut);
  },

  savePayment: function (req, me) {
    requireAdmin(me);
    var p = req.payment || {};
    var existing = p.id ? findRow('payments', p.id) : null;
    if (p.id && !existing) fail('bad_request', '없는 수납 내역입니다.');
    var date = str(p.date, 10); if (!isDate(date)) fail('bad_request', '납부일이 잘못되었습니다.');
    var studentId = String(p.studentId || ''); if (!findRow('students', studentId)) fail('bad_request', '학생을 선택하세요.');
    var month = str(p.month, 7); if (!/^\d{4}-\d{2}$/.test(month)) fail('bad_request', '청구월이 잘못되었습니다.');
    var amount = Math.round(num(p.amount)); if (!amount) fail('bad_request', '금액을 입력하세요.');
    var row = {
      id: existing ? existing.id : newId('P'), date: date, studentId: studentId, month: month,
      item: PAY_ITEMS.indexOf(p.item) >= 0 ? p.item : '수강료', amount: amount,
      method: PAY_METHODS.indexOf(p.method) >= 0 ? p.method : '현금',
      classId: p.classId && findRow('classes', String(p.classId)) ? String(p.classId) : '', note: str(p.note, 300),
      createdBy: existing ? existing.createdBy : me.id, createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    upsertRow('payments', 'id', row);
    return payOut(row);
  },

  deletePayment: function (req, me) {
    requireAdmin(me);
    deleteRows('payments', function (r) { return r.id === String(req.id || ''); });
    return true;
  },

  // ---------- 성적 ----------
  /** 시험 목록 + 통계(응시자·입력·전체 평균·최고·최저·반별 평균). 통계는 저장하지 않고 점수 행에서 매번 계산한다 */
  listExams: function () {
    var ctx = examCtx(), byExam = {}; readRows('scores').forEach(function (r) { (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
    return readRows('exams').map(function (e) {
      var o = examOut(e), st = examStats(o, byExam[e.id] || [], ctx);
      o.participants = st.participants; o.count = st.overall.n; o.avg = st.overall.avg; o.max = st.overall.max; o.min = st.overall.min;
      o.byClass = st.byClass.map(function (c) { return { classId: c.classId, className: c.className, n: c.n, avg: c.avg }; });
      return o;
    });
  },
  /** 시험 상세: 시험 정보 + 학생별 점수(반·반 평균·전체 순위) + 전체/반별 통계 */
  examDetail: function (req) { return examDetailOut(String(req.examId || '')); },

  /**
   * 시험 등록/수정. exam: { id?, name, date, maxScore, memo, classIds: [반 id…], participants: [{ studentId, classId }] }
   * 응시자(participants)는 점수 행으로 만들어 둔다(점수는 빈 값). 이미 있는 응시자는 그대로 두고 없는 학생만 추가한다 — 빼는 것은 removeScore 로만
   */
  saveExam: function (req, me) {
    var e = req.exam || {};
    var existing = e.id ? findRow('exams', e.id) : null;
    if (e.id && !existing) fail('bad_request', '없는 시험입니다.');
    var name = str(e.name, 60); if (!name) fail('bad_request', '시험 이름을 입력하세요.');
    var date = str(e.date, 10); if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
    var classIds = (Array.isArray(e.classIds) ? e.classIds : (e.classId ? [e.classId] : [])).map(String).filter(function (id, i, a) { return classes[id] && a.indexOf(id) === i; });
    var row = {
      id: existing ? existing.id : newId('X'), date: date,
      classId: classIds.length === 1 ? classIds[0] : (existing && classIds.length === 0 ? (existing.classId || '') : ''),   // 반이 하나면 예전 열도 채워 둔다(호환)
      classIds: classIds.join(','),
      name: name, maxScore: Math.max(1, Math.round(num(e.maxScore) || 100)), memo: str(e.memo, 500),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    upsertRow('exams', 'id', row);
    var added = 0, parts = Array.isArray(e.participants) ? e.participants : [];
    if (parts.length) {
      var students = {}; readRows('students').forEach(function (x) { students[x.id] = x; });
      var have = {}; readRows('scores').forEach(function (r) { if (r.examId === row.id) have[r.studentId] = r; });
      var ups = [], now = new Date().toISOString();
      parts.forEach(function (x) {
        var sid = String((x && x.studentId) || x || ''), cid = x && x.classId && classes[String(x.classId)] ? String(x.classId) : '';
        if (!sid || !students[sid]) return;
        if (have[sid]) { if (cid && have[sid].classId !== cid) { have[sid].classId = cid; have[sid].updatedAt = now; ups.push(have[sid]); } return; }
        var r = { id: newId('R'), examId: row.id, studentId: sid, score: '', note: '', classId: cid, updatedAt: now }; have[sid] = r; ups.push(r); added++;
      });
      if (ups.length) upsertMany('scores', 'id', ups);
    }
    var out = examOut(row); out.added = added; return out;
  },

  deleteExam: function (req, me) {
    requireAdmin(me);
    var id = String(req.id || '');
    deleteRows('scores', function (r) { return r.examId === id; });
    deleteRows('exams', function (r) { return r.id === id; });
    return true;
  },

  /** 점수 행 (응시자 목록 포함, 점수 없는 학생은 score null) */
  examScores: function (req) {
    var d = examDetailOut(String(req.examId || ''));
    return d.rows.map(function (r) { return { studentId: r.studentId, score: r.score, note: r.note, classId: r.classId }; });
  },

  /**
   * 점수 저장. scores: [{ studentId, score, note, classId? }]. 빈 점수는 "미입력"으로 남기고 응시자는 지우지 않는다.
   * 목록에 없는 학생은 응시자로 추가된다. 응시자에서 빼는 것은 removeScore 로만 한다
   */
  saveScores: function (req, me) {
    var examId = String(req.examId || '');
    var exam = findRow('exams', examId); if (!exam) fail('bad_request', '없는 시험입니다.');
    var max = num(exam.maxScore) || 100, now = new Date().toISOString();
    var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
    var existing = {}; readRows('scores').forEach(function (r) { if (r.examId === examId) existing[r.studentId] = r; });
    var ups = [];
    (Array.isArray(req.scores) ? req.scores : []).forEach(function (x) {
      var sid = String(x.studentId || ''); if (!sid) return;
      var blank = x.score === '' || x.score == null, v = blank ? '' : num(x.score);
      if (!blank && (isNaN(v) || v < 0 || v > max)) fail('bad_request', '점수는 0~' + max + ' 사이여야 합니다.');
      var row = existing[sid] || { id: newId('R'), examId: examId, studentId: sid, classId: '' };
      var cid = x.classId && classes[String(x.classId)] ? String(x.classId) : row.classId || '';
      var note = str(x.note, 200);
      if (existing[sid] && String(existing[sid].score) === String(v) && (existing[sid].note || '') === note && (existing[sid].classId || '') === cid) return;   // 바뀐 것만 쓴다
      row.score = v; row.note = note; row.classId = cid; row.updatedAt = now; ups.push(row);
    });
    if (ups.length) upsertMany('scores', 'id', ups);
    return examDetailOut(examId);
  },

  /** 응시자에서 뺀다 (점수 행 삭제). 화면에서 확인창을 거친 뒤에만 부른다 */
  removeScore: function (req, me) {
    var examId = String(req.examId || ''), sid = String(req.studentId || '');
    if (!findRow('exams', examId)) fail('bad_request', '없는 시험입니다.');
    deleteRows('scores', function (r) { return r.examId === examId && r.studentId === sid; });
    return examDetailOut(examId);
  },

  // ---------- 상담 ----------
  listConsults: function (req) {
    var from = String(req.from || '0000-00-00'), to = String(req.to || '9999-99-99');
    return readRows('consults').filter(function (r) { return (r.date >= from && r.date <= to) || (r.nextDate && r.nextDate >= from && r.nextDate <= to); }).map(consultOut);
  },

  saveConsult: function (req, me) {
    var c = req.consult || {};
    var existing = c.id ? findRow('consults', c.id) : null;
    if (c.id && !existing) fail('bad_request', '없는 상담 기록입니다.');
    var date = str(c.date, 10); if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    if (c.time && !isTime(String(c.time))) fail('bad_request', '시각이 잘못되었습니다.');
    if (c.nextDate && !isDate(String(c.nextDate))) fail('bad_request', '다음 상담일이 잘못되었습니다.');
    var studentId = c.studentId ? String(c.studentId) : '';
    if (studentId && !findRow('students', studentId)) fail('bad_request', '없는 학생입니다.');
    var name = str(c.name, 40);
    if (!studentId && !name) fail('bad_request', '학생을 고르거나 이름을 입력하세요.');
    var row = {
      id: existing ? existing.id : newId('K'), date: date, time: str(c.time, 5),
      type: CONSULT_TYPES.indexOf(c.type) >= 0 ? c.type : (studentId ? '학부모상담' : '신규상담'),
      studentId: studentId, name: studentId ? '' : name, phone: studentId ? '' : phoneStr(c.phone),
      school: studentId ? '' : str(c.school, 40), grade: studentId ? '' : str(c.grade, 10),
      content: str(c.content, 3000), nextDate: str(c.nextDate, 10),
      memberId: c.memberId && findMember(String(c.memberId).toLowerCase()) ? String(c.memberId).toLowerCase() : me.id,
      createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    upsertRow('consults', 'id', row);
    return consultOut(row);
  },

  deleteConsult: function (req, me) {
    var c = findRow('consults', String(req.id || '')); if (!c) return true;
    if (me.role !== 'admin' && c.memberId !== me.id) fail('forbidden', '본인이 쓴 상담 기록만 지울 수 있습니다.');
    deleteRows('consults', function (r) { return r.id === c.id; });
    return true;
  },

  // ---------- 학생관리부 가져오기 ----------
  /**
   * 드라이브의 학생관리부 시트를 읽어 반·학생·수강을 만들거나 갱신한다 (원장만).
   * - 반: 정규반·선행반 이름으로 찾고 없으면 만든다. 요일은 "월목" → 월,목, 선행반은 "(수)" 에서 읽는다
   * - 학생: 학생ID(extId) 로 찾고, 없으면 이름+학년으로 찾고, 그래도 없으면 새로 만든다
   *   앱에서 고친 연락처·메모는 지우지 않는다 (시트에 값이 있고 앱이 비어 있을 때만 채운다)
   * - 수강: 그 학생의 현재 수강반을 시트의 정규반+선행반으로 맞춘다
   */
  importRoster: function (req, me) {
    requireAdmin(me);
    var sheetId = str(req.sheetId, 100) || ROSTER_SHEET_ID;
    var ss; try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { fail('bad_request', '학생관리부 시트를 열 수 없습니다. 시트 ID 와 공유 권한을 확인하세요. (' + e.message + ')'); }
    var sh = pickRosterSheet(ss), tab = sh.getName(), values = sh.getDataRange().getValues();
    if (values.length < 2) fail('bad_request', '학생관리부 시트("' + tab + '" 탭)가 비어 있습니다.');
    var head = values[0].map(function (h) { return String(h).replace(/\s/g, ''); });
    var col = {}; head.forEach(function (h, i) { col[h] = i; });
    var need = ['성명']; need.forEach(function (k) { if (col[k] == null) fail('bad_request', '시트 1행에 "' + k + '" 제목이 없습니다.'); });
    // 등록일 열이 없으면 1행 마지막 제목 다음 칸(보통 P1)에 제목만 만들어 둔다. 데이터 칸은 건드리지 않는다
    var addedCols = [];
    if (col['등록일'] == null) {
      var at = head.length; while (at > 0 && !head[at - 1]) at--;   // 빈 제목 칸은 건너뛰고 실제 마지막 제목 뒤에
      sh.getRange(1, at + 1).setValue('등록일'); col['등록일'] = at; head[at] = '등록일'; addedCols.push('등록일 (' + colLetter(at + 1) + '열)');
    }
    var rosterTz = sheetTz(ss);
    var get = function (row, k) {
      if (col[k] == null) return ''; var v = row[col[k]]; if (v == null) return '';
      if (isDateObj(v)) return k === '등록일' ? Utilities.formatDate(v, rosterTz, 'yyyy-MM-dd') : (v.getMonth() + 1) + '-' + v.getDate();   // "3-2" 처럼 적은 진도가 날짜로 바뀐 경우 되돌린다
      return String(v).trim();
    };
    var dateCell = function (row, k) { return normDate(get(row, k)); };
    var today = todayStr();
    var members = readRows('members');
    var teacherIdOf = function (label) {   // "성경자T" → 이름이 "성경자" 인 아이디, "원장T" → 관리자
      var nm = label.replace(/T$/, '').trim(); if (!nm) return '';
      var hit = members.filter(function (m) { return m.name === nm || m.name === nm + 'T' || m.name.replace(/\s|T$/g, '') === nm; })[0];
      if (!hit && /원장/.test(nm)) hit = members.filter(function (m) { return m.role === 'admin' && /원장/.test(m.name); })[0] || members.filter(function (m) { return m.role === 'admin'; })[0];
      if (!hit && nm.length === 1) {   // "김T" 처럼 성만 있으면, 그 성을 가진 강사가 한 명일 때만 연결
        var cand = members.filter(function (m) { return m.active !== false && m.name.charAt(0) === nm; });
        if (cand.length === 1) hit = cand[0];
      }
      return hit ? hit.id : '';
    };
    var daysOf = function (s) { return '월화수목금토일'.split('').filter(function (d) { return s.indexOf(d) >= 0; }).join(','); };
    var gradeOf = function (dept, g) { var n = String(g).replace(/[^\d]/g, ''); var p = /초/.test(dept) ? '초' : /중/.test(dept) ? '중' : /고/.test(dept) ? '고' : ''; return p && n ? p + n : (GRADE_OK(g) ? g : ''); };
    function GRADE_OK(g) { return /^(초[1-6]|중[1-3]|고[1-3])$/.test(g); }

    // 반
    var classes = readRows('classes'), classByName = {}, classByCore = {};
    /** 반 이름 정규화: 공백 여러 개·괄호/하이픈 주변 공백 차이를 없앤다 ("중1 심화월목  1-1 ( 원T )" = "중1 심화월목 1-1 (원T)") */
    var normName = normClassName;
    /** 정규반 뼈대: 끝의 진도 토큰(3-2)과 담임 태그((성T))를 뺀 것. "초3 개념월목 3-2 (성T)" → core "초3 개념월목", tag "성T". 진도 토큰이 없거나 정규반 꼴이 아니면 null */
    var coreOf = function (n) {
      var nn = normName(n), tag = (nn.match(/\(([^)]*)\)$/) || ['', ''])[1].replace(/\s/g, ''), base = nn.replace(/\s*\([^)]*\)$/, '');
      var core = base.replace(/\s*\d+\s*-\s*\d+$/, '').trim();
      return core !== base && /^[초중고]\d/.test(core) ? core + '|' + tag : null;
    };
    var syncLog = { existing: classes.length, renamed: [], loose: 0, enrollDup: 0, merged: [], ambiguous: [] };
    // 이미 생긴 중복 반 정리: 뼈대+담임이 같은 운영 중 반이 둘 이상이면, 시간이 없고 출결·시험·수납 기록도 없는(자동 생성만 된) 쪽을
    // 원래 반에 합친다 (수강생은 원래 반으로 옮기고, 그 반 행은 지운다). 둘 다 쓰이고 있으면 합치지 않고 알린다
    (function mergeDuplicateClasses() {
      var groups = {};
      classes.forEach(function (c) { if (c.status === '종료') return; var k = coreOf(c.name); if (k) (groups[k] || (groups[k] = [])).push(c); });
      var usedIn = {};
      ['attendance', 'exams', 'payments'].forEach(function (n) { readRows(n).forEach(function (r) { if (r.classId) usedIn[r.classId] = true; }); });
      var enrAll = readEnr(), openCount = {};
      var todayM = todayStr(); enrAll.forEach(function (e) { if (isActiveEnr(e, todayM)) openCount[e.classId] = (openCount[e.classId] || 0) + 1; });
      var hasTime = function (c) { return !!(c.schedule || c.start); };
      var moves = [], dropIds = {}, dropClassIds = {};
      Object.keys(groups).forEach(function (k) {
        var g = groups[k]; if (g.length < 2) return;
        var keepers = g.filter(function (c) { return hasTime(c) || usedIn[c.id]; });
        if (keepers.length > 1) { syncLog.ambiguous.push(g.map(function (c) { return c.name; }).join(' / ')); return; }
        var keep = keepers[0] || g.slice().sort(function (a, b) { return (openCount[b.id] || 0) - (openCount[a.id] || 0) || String(a.createdAt).localeCompare(String(b.createdAt)); })[0];
        g.forEach(function (d) {
          if (d.id === keep.id) return;
          var have = {}; enrAll.forEach(function (e) { if (e.classId === keep.id && !e.endDate) have[e.studentId] = true; });
          enrAll.forEach(function (e) { if (e.classId !== d.id) return; if (isActiveEnr(e, todayM) && !have[e.studentId]) { e.classId = keep.id; have[e.studentId] = true; moves.push(e); } else dropIds[e.id] = true; });
          dropClassIds[d.id] = true; syncLog.merged.push(d.name + ' → ' + keep.name);
        });
      });
      if (moves.length) upsertMany('enrollments', 'id', moves);
      if (Object.keys(dropIds).length) deleteRows('enrollments', function (r) { return !!dropIds[r.id]; });
      if (Object.keys(dropClassIds).length) { deleteRows('classes', function (r) { return !!dropClassIds[r.id]; }); classes = classes.filter(function (c) { return !dropClassIds[c.id]; }); }
    })();
    var classById = {};
    classes.forEach(function (c) { classById[c.id] = c; classByName[normName(c.name)] = c; var k = coreOf(c.name); if (k) (classByCore[k] || (classByCore[k] = [])).push(c); });
    var newClasses = [], classWarn = [], fixedClasses = {}, fillDept = {};
    /** 시트의 반 이름으로 기존 반을 찾는다: ① 정규화한 이름이 같은 반 ② 뼈대+담임 태그가 같은 정규반(요일이 같은 것 우선) ③ 그래도 없으면 새로 만든다 */
    var ensureClass = function (name, days, teacherLabel, kind) {
      name = str(name, 40); if (!name || /^(미확인|확인필요|-)$/.test(name)) return null;
      var tid = teacherIdOf(teacherLabel), nn = normName(name), ex = classByName[nn];
      if (ex) { if (ex.name !== name) syncLog.loose++; }
      else {
        var k = coreOf(name), cands = (k && classByCore[k]) || [];
        ex = cands.filter(function (c) { return c.status !== '종료' && days && c.days === days; })[0] || cands.filter(function (c) { return c.status !== '종료'; })[0] || cands[0] || null;
        if (ex) { syncLog.loose++; syncLog.renamed.push(ex.name + ' → ' + name); ex.name = name; fixedClasses[ex.id] = ex; classByName[nn] = ex; }
      }
      if (ex) {   // 있는 반: 담임·요일이 비어 있고 이제 알 수 있으면 채운다. 시간·수강생·직접 고친 내용은 그대로
        if (!ex.teacherId && tid) { ex.teacherId = tid; fixedClasses[ex.id] = ex; }
        if (!ex.days && days) { ex.days = days; fixedClasses[ex.id] = ex; }
        return ex;
      }
      if (teacherLabel && !tid && classWarn.indexOf('담임 ' + teacherLabel + ' 아이디 없음 → 아이디 관리에서 만든 뒤 다시 가져오면 연결됩니다') < 0) classWarn.push('담임 ' + teacherLabel + ' 아이디 없음 → 아이디 관리에서 만든 뒤 다시 가져오면 연결됩니다');
      var row = { id: newId('C'), name: name, subject: '수학', teacherId: tid, days: days, start: '', end: '', room: '', fee: 0, status: '운영',
        memo: [kind, teacherLabel && !tid ? '담임 ' + teacherLabel : ''].filter(Boolean).join(' · '), createdAt: new Date().toISOString(), kind: kind === '선행반' ? '선행' : '정규' };
      classByName[nn] = row; var nk = coreOf(name); if (nk) (classByCore[nk] || (classByCore[nk] = [])).push(row);
      newClasses.push(row); return row;
    };
    // 학생
    var students = readRows('students'), byExt = {}, byNameGrade = {};
    students.forEach(function (s) { if (s.extId) byExt[s.extId] = s; byNameGrade[s.name + '|' + (s.grade || '')] = s; });
    var added = 0, updated = 0, plan = [], warn = classWarn;
    for (var i = 1; i < values.length; i++) {
      var r = values[i], name = str(get(r, '성명'), 40); if (!name) continue;
      if (/삭제/.test(get(r, '재원상태'))) continue;   // 앱에서 삭제한 학생 (시트 행은 남겨 두고 표시만)
      var ext = str(get(r, '학생ID'), 20), deptRaw = get(r, '부서'), dept = deptRaw;
      if (!dept) {   // 부서가 비어 있으면 반 이름(초3…/중1…/고2…) → 앱에 있는 학생의 학년 순으로 판단해 시트에도 채워 넣는다
        var cn = get(r, '정규반') + ' ' + get(r, '선행반');
        dept = /(^|\s)초/.test(cn) ? '초등부' : /(^|\s)중/.test(cn) ? '중등부' : /(^|\s)고/.test(cn) ? '고등부' : '';
        if (!dept && ext && byExt[ext]) dept = deptOfGrade(byExt[ext].grade);
        if (!dept && GRADE_OK(get(r, '학년'))) dept = deptOfGrade(get(r, '학년'));
        if (dept && col['부서'] != null) fillDept[i] = dept;
      }
      var grade = gradeOf(dept, get(r, '학년'));
      var school = get(r, '학교'); if (/확인|미상|^-$/.test(school)) school = '';
      var statusRaw = get(r, '재원상태'), status = STUDENT_STATUS.indexOf(statusRaw) >= 0 ? statusRaw : (/퇴/.test(statusRaw) ? '퇴원' : /휴/.test(statusRaw) ? '휴원' : /대기/.test(statusRaw) ? '대기' : '재원');
      var teacher = get(r, '담임T'), days = daysOf(get(r, '요일'));
      // 정규반·선행반은 " / " 로 여러 개를 적을 수 있다 (내보내기가 그렇게 쓴다)
      // 반ID 열(내보내기가 써 둔 것)이 있으면 id 로 먼저 찾는다. 이름은 표시용이라 이름이 달라도 같은 반이다
      var regIds = get(r, '정규반ID').split(' / '), aheadIds = get(r, '선행반ID').split(' / ');
      var regulars = get(r, '정규반').split(' / ').map(function (x, i) { var byId = regIds[i] && classById[regIds[i].trim()]; return byId || ensureClass(x, days, teacher, '정규반'); });
      var aheads = get(r, '선행반').split(' / ').map(function (ahead, i) {
        var byId = aheadIds[i] && classById[aheadIds[i].trim()]; if (byId) return byId;
        var aheadDays = daysOf((ahead.match(/\(([^)]*)\)\s*$/) || ['', ''])[1]);
        var aheadTeacher = (ahead.match(/([가-힣]+T)\s*\(/) || ['', ''])[1];
        return ensureClass(ahead, aheadDays, aheadTeacher, '선행반');
      });
      var progress = get(r, '진도'), note = get(r, '비고'), enrolled = dateCell(r, '등록일');   // 등록일 열이 있으면 그대로 쓴다 (매월 수강료 청구 기준)
      var autoMemo = [progress && !/미확인/.test(progress) ? '진도 ' + progress : '', !school && get(r, '학교') ? '학교 확인 필요' : '', note].filter(Boolean).join(' · ');
      var s = (ext && byExt[ext]) || byNameGrade[name + '|' + grade] || null;
      if (s) {
        s.name = name; if (grade) s.grade = grade; if (school) s.school = school; s.status = status;
        if (!s.phone) s.phone = phoneStr(get(r, '학생연락처')); if (!s.parentPhone) s.parentPhone = phoneStr(get(r, '학부모연락처'));
        if (!s.memo) s.memo = autoMemo.slice(0, 2000); if (ext && !s.extId) s.extId = ext;
        if (status === '퇴원' && !s.leftAt) s.leftAt = today;
        if (enrolled) s.enrolledAt = enrolled;
        s.updatedAt = new Date().toISOString(); updated++;
      } else {
        s = { id: newId('S'), name: name, status: status, school: school, grade: grade, birth: '', phone: phoneStr(get(r, '학생연락처')), parentPhone: phoneStr(get(r, '학부모연락처')), parentName: '',
          enrolledAt: enrolled, leftAt: status === '퇴원' ? today : '', memo: autoMemo.slice(0, 2000), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), extId: ext };
        if (ext) byExt[ext] = s; byNameGrade[name + '|' + grade] = s; added++;
      }
      plan.push({ s: s, classIds: regulars.concat(aheads).filter(Boolean).map(function (c) { return c.id; }), status: status });
    }
    // 비어 있던 부서 칸을 시트에 채운다 (그 열만, 나머지 칸은 원래 값 그대로 다시 씀)
    var filledDept = Object.keys(fillDept).length;
    if (filledDept) {
      var dc = col['부서'], colVals = [];
      for (var vi = 1; vi < values.length; vi++) colVals.push([fillDept[vi] != null ? fillDept[vi] : (values[vi][dc] == null ? '' : values[vi][dc])]);
      sh.getRange(2, dc + 1, colVals.length, 1).setValues(colVals);
    }
    if (newClasses.length) appendRows('classes', newClasses);
    upsertMany('classes', 'id', Object.keys(fixedClasses).map(function (k) { return fixedClasses[k]; }));
    upsertMany('students', 'id', plan.map(function (p) { return p.s; }));
    // 수강 동기화 (시트를 한 번만 읽어서 처리)
    var enrs = readEnr(), openBy = {}, drop = {};
    enrs.forEach(function (e) {
      if (!isActiveEnr(e, today)) return;
      var arr = openBy[e.studentId] || (openBy[e.studentId] = []);
      if (arr.some(function (x) { return x.classId === e.classId; })) { drop[e.id] = true; syncLog.enrollDup++; } else arr.push(e);   // 같은 학생이 같은 반에 두 번 → 하나만
    });
    var ended = [], adds = [], yday = addDaysStr(today, -1);
    plan.forEach(function (p) {
      var want = (p.status === '재원' || p.status === '대기') ? p.classIds : [];
      var open = openBy[p.s.id] || [], have = {};
      // 시트에서 빠진 반: 어제로 종료 (오늘 시작한 수강은 기록 없이 삭제) → 옛 반이 오늘 하루 더 보이지 않는다
      open.forEach(function (e) { if (want.indexOf(e.classId) < 0) { if (e.startDate >= today) drop[e.id] = true; else { e.endDate = yday; e.endReason = '반 변경'; e.updatedAt = new Date().toISOString(); e.updatedBy = me.id; ended.push(e); } } else have[e.classId] = true; });
      want.forEach(function (cid) { if (!have[cid]) { have[cid] = true; adds.push({ id: newId('E'), studentId: p.s.id, classId: cid, startDate: today, endDate: '', fee: '', createdAt: new Date().toISOString(), endReason: '', deleted: false, updatedAt: new Date().toISOString(), updatedBy: me.id }); } });
    });
    upsertMany('enrollments', 'id', ended); appendRows('enrollments', adds);
    if (Object.keys(drop).length) deleteRows('enrollments', function (r) { return !!drop[r.id]; });
    var validation = rosterApplyValidation(sh, col, values, classes.concat(newClasses));   // 시트 정규반·선행반 칸에 반 이름 드롭다운
    return { rows: plan.length, validation: validation, studentsAdded: added, studentsUpdated: updated, classesAdded: newClasses.length, enrollmentsAdded: adds.length, enrollmentsEnded: ended.length, warnings: warn.slice(0, 30), addedCols: addedCols, tab: tab, header: head.filter(Boolean), filledDept: filledDept,
      classSync: { existing: syncLog.existing, updated: Object.keys(fixedClasses).length, added: newClasses.length, newNames: newClasses.map(function (c) { return c.name; }), renamed: syncLog.renamed, loose: syncLog.loose, enrollDup: syncLog.enrollDup, merged: syncLog.merged, ambiguous: syncLog.ambiguous } };
  },

  /**
   * 앱의 학생·반·수강을 드라이브의 학생관리부 시트에 써 넣는다. 앱이 원본이 된다.
   * 로그인한 누구나(강사 포함) 누를 수 있다. 서버가 원장 계정 권한으로 쓰므로 강사에게 시트를 공유할 필요가 없다
   * - 시트의 첫 탭을 통째로 다시 쓴다. 제목줄에 없는 열은 뒤에 추가한다
   * - 앱이 관리하지 않는 열(진도, 확인 등)은 학생ID 가 같은 기존 행의 값을 그대로 옮긴다
   * - 학생ID 가 없는 학생에게는 S0001 식으로 번호를 새로 매겨 앱에도 저장한다
   * - 앱에서 삭제된 학생은 시트에서도 빠진다
   */
  exportRoster: function (req, me) {
    var sheetId = me.role === 'admin' && str(req.sheetId, 100) ? str(req.sheetId, 100) : ROSTER_SHEET_ID;
    var ss; try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { fail('bad_request', '학생관리부 시트를 열 수 없습니다. (' + e.message + ')'); }
    var sh = pickRosterSheet(ss), tab = sh.getName();
    var values = sh.getLastRow() >= 1 ? sh.getDataRange().getValues() : [];
    var STD = ['학생ID', '성명', '부서', '학년', '담임T', '정규반', '요일', '진도', '선행반', '학교', '학생연락처', '학부모연락처', '재원상태', '확인', '비고'];
    var head = values.length ? values[0].map(function (h) { return String(h).replace(/\s/g, ''); }) : STD.slice();
    if (!head.some(function (h) { return h === '성명'; })) head = STD.slice();
    STD.forEach(function (c) { if (head.indexOf(c) < 0) head.push(c); });
    var col = {}; head.forEach(function (h, i) { if (h && col[h] == null) col[h] = i; });
    // 기존 행 (학생ID 기준) — 앱이 모르는 열을 보존하기 위해
    var oldById = {}, maxNum = 0;
    for (var i = 1; i < values.length; i++) {
      var id = String(values[i][col['학생ID']] == null ? '' : values[i][col['학생ID']]).trim();
      if (id) oldById[id] = values[i];
      var n = Number((id.match(/(\d+)$/) || [])[1]); if (n > maxNum) maxNum = n;
    }
    var students = readRows('students'), classes = {}, members = {};
    readRows('classes').forEach(function (c) { classes[c.id] = c; });
    readRows('members').forEach(function (m) { members[m.id] = m; });
    students.forEach(function (s) { var n = Number(((s.extId || '').match(/(\d+)$/) || [])[1]); if (n > maxNum) maxNum = n; });
    var assigned = [];
    students.forEach(function (s) { if (!s.extId) { maxNum++; s.extId = 'S' + ('000' + maxNum).slice(-4); assigned.push(s); } });
    if (assigned.length) upsertMany('students', 'id', assigned);
    var openEnr = {};
    var today1 = todayStr(); readEnr().forEach(function (e) { if (isActiveEnr(e, today1) && classes[e.classId]) (openEnr[e.studentId] || (openEnr[e.studentId] = [])).push(classes[e.classId]); });
    var isAhead = function (c) { return classKind(c) === '선행'; };
    var teacherLabel = function (c) { var m = c && c.teacherId && members[c.teacherId]; if (!m) return ''; return /T$/.test(m.name) ? m.name : m.name + 'T'; };
    var deptOf = function (g) { return /^초/.test(g) ? '초등부' : /^중/.test(g) ? '중등부' : /^고/.test(g) ? '고등부' : ''; };
    var order = { 초등부: 1, 중등부: 2, 고등부: 3, '': 9 }, statusOrder = { 재원: 1, 대기: 2, 휴원: 3, 퇴원: 4 };
    students.sort(function (a, b) {
      return (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9) || order[deptOf(a.grade)] - order[deptOf(b.grade)]
        || (Number((a.grade || '').replace(/\D/g, '')) || 0) - (Number((b.grade || '').replace(/\D/g, '')) || 0) || a.name.localeCompare(b.name, 'ko');
    });
    ['등록일', '정규반ID', '선행반ID'].forEach(function (k) { if (col[k] == null) { col[k] = head.length; head.push(k); } });
    var rosterTz = sheetTz(ss);
    var cellText = function (v, h) { if (!isDateObj(v)) return v; return h === '등록일' ? Utilities.formatDate(v, rosterTz, 'yyyy-MM-dd') : (v.getMonth() + 1) + '-' + v.getDate(); };
    var rows = students.map(function (s) {
      var old = oldById[s.extId] || [], row = head.map(function (h, i) { return old[i] == null ? '' : cellText(old[i], h); });
      var cls = (openEnr[s.id] || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      var regs = cls.filter(function (c) { return !isAhead(c); }), aheads = cls.filter(isAhead);
      var put = function (k, v) { if (col[k] != null) row[col[k]] = v; };
      put('학생ID', s.extId); put('성명', s.name); put('부서', deptOf(s.grade)); put('학년', (s.grade || '').replace(/\D/g, ''));
      var cf = rosterClassFields(regs, aheads, members);
      Object.keys(cf).forEach(function (k) { put(k, cf[k]); });
      // 사람이 시트에 직접 적은 값 보호: 앱에 값이 있을 때만 덮어쓰고, 앱이 비어 있으면 시트 값을 그대로 둔다
      var putKeep = function (k, v) { if (col[k] != null && v) row[col[k]] = v; };
      putKeep('학교', s.school); putKeep('학생연락처', fmtPhone(s.phone)); putKeep('학부모연락처', fmtPhone(s.parentPhone));
      put('재원상태', s.status || '재원'); putKeep('비고', s.memo);
      if (s.enrolledAt) put('등록일', s.enrolledAt); else row[col['등록일']] = normDate(String(row[col['등록일']] == null ? '' : row[col['등록일']]));   // 앱에 없으면 시트에 적힌 등록일을 그대로 둔다
      return row;
    });
    var width = head.length;
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(width, sh.getLastColumn())).clearContent();
    sh.getRange(1, 1, 1, width).setValues([head]);
    if (rows.length) sh.getRange(2, 1, rows.length, width).setNumberFormat('@').setValues(rows);
    var validation = rosterApplyValidation(sh, col, [head].concat(rows), Object.keys(classes).map(function (k) { return classes[k]; }));
    return { rows: rows.length, assignedIds: assigned.length, validation: validation, url: 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit', at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), tab: tab };
  },

  // ---------- 문자 ----------
  /**
   * recipients: [{ name, phone, body? }]  개별 body 가 없으면 공통 body 를 쓴다.
   * SMS.provider 가 설정되어 있으면 서버에서 바로 보내고, 아니면 기록만 남긴다(앱이 문자앱으로 넘김).
   */
  sendMessages: function (req, me) {
    var list = (Array.isArray(req.recipients) ? req.recipients : []).map(function (r) {
      return { name: str(r.name, 40), phone: phoneStr(r.phone), body: str(r.body, 2000) || str(req.body, 2000) };
    }).filter(function (r) { return /^\d{9,12}$/.test(r.phone) && r.body; });
    if (!list.length) fail('bad_request', '보낼 번호가 없습니다.');
    if (list.length > 300) fail('bad_request', '한 번에 300명까지 보낼 수 있습니다.');
    var cfg = smsConfig(), auto = smsReady(cfg);
    var result = auto ? sendViaProvider(cfg, list) : { ok: list.length, fail: 0, detail: '문자앱으로 전달' };
    var row = {
      id: newId('M'), sentAt: new Date().toISOString(), kind: str(req.kind, 20) || '직접입력', count: list.length,
      recipients: list.map(function (r) { return r.name + ':' + r.phone; }).join(';').slice(0, 20000),
      body: str(req.body, 2000) || list[0].body, method: auto ? cfg.provider : 'manual',
      // 수동(문자앱)은 브라우저가 문자앱을 연 것까지만 알 수 있으므로 "발송 성공"이라 적지 않는다. 실제 발송은 휴대폰 문자앱에서 사람이 [보내기]를 눌러야 끝난다
      result: auto ? ('성공 ' + result.ok + ' / 실패 ' + result.fail + (result.detail ? ' · ' + result.detail : '')) : '문자앱으로 전달 (발송 여부 확인 불가)',
      sentBy: me.id,
    };
    appendRow('messages', row);
    return { method: row.method, result: row.result, ok: result.ok, fail: result.fail, log: msgOut(row) };
  },

  listMessages: function (req) {
    var rows = readRows('messages').map(msgOut);
    rows.sort(function (a, b) { return a.sentAt < b.sentAt ? 1 : -1; });
    return rows.slice(0, Math.min(200, num(req.limit) || 100));
  },
};

// ---------- 문자 발송 (알리고 · 솔라피) ----------
function sendViaProvider(cfg, list) { return cfg.provider === 'solapi' ? sendViaSolapi(cfg, list) : sendViaAligo(cfg, list); }
/** 알리고: 같은 내용끼리 묶어 receiver 를 콤마로 최대 100명씩. 응답 result_code 1 이면 성공 */
function sendViaAligo(cfg, list) {
  var ok = 0, failN = 0, detail = '', groups = {};
  list.forEach(function (r) { (groups[r.body] || (groups[r.body] = [])).push(r.phone); });
  Object.keys(groups).forEach(function (body) {
    var phones = groups[body];
    for (var i = 0; i < phones.length; i += 100) {
      var chunk = phones.slice(i, i + 100);
      try {
        var res = UrlFetchApp.fetch('https://apis.aligo.in/send/', {
          method: 'post', muteHttpExceptions: true,
          payload: { key: cfg.key, user_id: cfg.userId, sender: cfg.sender, receiver: chunk.join(','), msg: body, msg_type: smsBytes(body) > 90 ? 'LMS' : 'SMS', title: cfg.title },
        });
        var out = JSON.parse(res.getContentText() || '{}');
        if (String(out.result_code) === '1') { ok += num(out.success_cnt) || chunk.length; failN += num(out.error_cnt) || 0; }
        else { failN += chunk.length; detail = String(out.message || out.result_code || res.getResponseCode()); }
      } catch (e) { failN += chunk.length; detail = String(e.message || e); }
    }
  });
  return { ok: ok, fail: failN, detail: detail };
}
/** 솔라피(쿨SMS) HMAC-SHA256 인증 헤더 */
function solapiAuth(cfg) {
  var date = new Date().toISOString(), salt = Utilities.getUuid().replace(/-/g, '');
  var sig = Utilities.computeHmacSha256Signature(date + salt, cfg.secret).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  return 'HMAC-SHA256 apiKey=' + cfg.key + ', date=' + date + ', salt=' + salt + ', signature=' + sig;
}
/** 솔라피: 한 요청에 여러 건(각자 내용). 응답 groupInfo.count 와 failedMessageList 로 성공/실패를 센다 */
function sendViaSolapi(cfg, list) {
  var ok = 0, failN = 0, detail = '';
  for (var i = 0; i < list.length; i += 500) {
    var chunk = list.slice(i, i + 500);
    try {
      var msgs = chunk.map(function (r) { var lms = smsBytes(r.body) > 90; return { to: r.phone, from: cfg.sender, text: r.body, type: lms ? 'LMS' : 'SMS', subject: lms ? cfg.title : undefined }; });
      var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', {
        method: 'post', muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: solapiAuth(cfg) }, payload: JSON.stringify({ messages: msgs }),
      });
      var code = res.getResponseCode(), out = JSON.parse(res.getContentText() || '{}');
      if (code >= 200 && code < 300) { var failed = (out.failedMessageList || []).length; failN += failed; ok += chunk.length - failed; if (failed && out.failedMessageList[0]) detail = String(out.failedMessageList[0].errorMessage || out.failedMessageList[0].statusMessage || ''); }
      else { failN += chunk.length; detail = String(out.errorMessage || out.errorCode || code); }
    } catch (e) { failN += chunk.length; detail = String(e.message || e); }
  }
  return { ok: ok, fail: failN, detail: detail };
}
/** 잔여 건수/잔액 조회 */
function smsRemainOf(cfg) {
  if (!smsReady(cfg)) fail('bad_request', '문자 API가 아직 설정되지 않았습니다.');
  var res, out;
  if (cfg.provider === 'aligo') {
    res = UrlFetchApp.fetch('https://apis.aligo.in/remain/', { method: 'post', muteHttpExceptions: true, payload: { key: cfg.key, user_id: cfg.userId } });
    out = JSON.parse(res.getContentText() || '{}');
    if (String(out.result_code) !== '1') fail('bad_request', '알리고 응답: ' + (out.message || out.result_code || res.getResponseCode()));
    return { provider: 'aligo', text: 'SMS ' + num(out.SMS_CNT) + '건 · LMS ' + num(out.LMS_CNT) + '건 · MMS ' + num(out.MMS_CNT) + '건 남음', sms: num(out.SMS_CNT), lms: num(out.LMS_CNT) };
  }
  res = UrlFetchApp.fetch('https://api.solapi.com/cash/v1/balance', { method: 'get', muteHttpExceptions: true, headers: { Authorization: solapiAuth(cfg) } });
  out = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) fail('bad_request', '솔라피 응답: ' + (out.errorMessage || out.errorCode || res.getResponseCode()));
  return { provider: 'solapi', text: '잔액 ' + Math.round(num(out.balance)).toLocaleString() + '원 · 포인트 ' + Math.round(num(out.point)).toLocaleString(), balance: num(out.balance), point: num(out.point) };
}
ACADEMY_ACTIONS.getSmsConfig = function (req, me) { requireAdmin(me); return smsConfigOut(smsConfig()); };
/** 문자 API 설정 저장(관리자). key/secret 을 비워 보내면 기존 값을 유지한다. 코드가 아니라 스크립트 속성에 저장 */
ACADEMY_ACTIONS.saveSmsConfig = function (req, me) {
  requireAdmin(me);
  var cur = smsConfig(), provider = str(req.provider, 10); if (SMS_PROVIDERS[provider] == null) fail('bad_request', '알 수 없는 문자 서비스입니다.');
  var key = str(req.key, 200) || cur.key, secret = str(req.secret, 200) || cur.secret, userId = str(req.userId, 60), sender = str(req.sender, 20).replace(/\D/g, ''), title = str(req.title, 40) || '더블엠수학학원';
  if (provider === 'aligo' && (!key || !userId || !sender)) fail('bad_request', '알리고는 API key·아이디·발신번호가 모두 필요합니다.');
  if (provider === 'solapi' && (!key || !secret || !sender)) fail('bad_request', '솔라피는 API key·API secret·발신번호가 모두 필요합니다.');
  if (sender && !/^\d{8,12}$/.test(sender)) fail('bad_request', '발신번호는 숫자만 8~12자리여야 합니다. (문자 서비스에 사전 등록된 번호)');
  PropertiesService.getScriptProperties().setProperties({ SMS_PROVIDER: provider, SMS_KEY: key, SMS_SECRET: secret, SMS_USER: userId, SMS_SENDER: sender, SMS_TITLE: title }, false);
  if (typeof logChange === 'function') logChange(me, 'sms_config', '', '', cur.provider, provider, '문자 API 설정 변경');
  return smsConfigOut(smsConfig());
};
/** 테스트 문자(관리자): 지정한 번호 하나로 보내고 결과를 바로 돌려준다. 기록에는 종류 "테스트"로 남긴다 */
ACADEMY_ACTIONS.testSms = function (req, me) {
  requireAdmin(me);
  var cfg = smsConfig(); if (!smsReady(cfg)) fail('bad_request', '문자 API가 아직 설정되지 않았습니다. 먼저 저장하세요.');
  var phone = phoneStr(req.phone); if (!/^\d{9,12}$/.test(phone)) fail('bad_request', '받는 번호를 확인하세요.');
  var body = str(req.body, 200) || '[' + cfg.title + '] 문자 API 연결 테스트입니다. ' + Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm');
  var r = sendViaProvider(cfg, [{ name: '테스트', phone: phone, body: body }]);
  appendRow('messages', { id: newId('M'), sentAt: new Date().toISOString(), kind: '테스트', count: 1, recipients: '테스트:' + phone, body: body, method: cfg.provider, result: '성공 ' + r.ok + ' / 실패 ' + r.fail + (r.detail ? ' · ' + r.detail : ''), sentBy: me.id });
  return { ok: r.ok, fail: r.fail, detail: r.detail, provider: SMS_PROVIDERS[cfg.provider] };
};
ACADEMY_ACTIONS.smsRemain = function (req, me) { requireAdmin(me); return smsRemainOf(smsConfig()); };
function smsBytes(s) { var n = 0; for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 127 ? 2 : 1; return n; }

// ---------- 수강 동기화 ----------
/** 학생의 현재 수강반 집합을 classIds 로 맞춘다. 빠진 반은 오늘 날짜로 종료, 새 반은 오늘 시작 */
function syncEnrollments(studentId, classIds, status, me) {
  var today = todayStr(), yday = addDaysStr(today, -1);
  var open = readEnr().filter(function (r) { return r.studentId === studentId && isActiveEnr(r, today); });
  var want = (status === '재원' || status === '대기') ? classIds : [];
  var reason = status === '퇴원' ? '퇴원' : status === '휴원' ? '휴원' : '반 변경';
  open.forEach(function (r) { if (want.indexOf(r.classId) < 0) endEnrollment(r, yday, reason, me); });
  var have = {}; open.forEach(function (r) { if (want.indexOf(r.classId) >= 0) have[r.classId] = true; });
  want.forEach(function (cid) { if (!have[cid] && findRow('classes', cid)) startEnrollment(studentId, cid, today, '', me, '학생 수정'); });
}

// ---------- 출력 형식 ----------
function studentOut(r) {
  return { id: r.id, name: r.name, status: r.status || '재원', school: r.school || '', grade: r.grade || '', birth: r.birth || '',
    phone: r.phone || '', parentPhone: r.parentPhone || '', parentName: r.parentName || '', enrolledAt: r.enrolledAt || '', leftAt: r.leftAt || '',
    memo: r.memo || '', createdAt: r.createdAt || '', updatedAt: r.updatedAt || '', extId: r.extId || '' };
}
function classOut(r) {
  return { id: r.id, name: r.name, subject: r.subject || '', teacherId: r.teacherId || '', days: r.days || '', start: r.start || '', end: r.end || '',
    room: r.room || '', fee: num(r.fee), status: r.status || '운영', memo: r.memo || '', slots: parseSchedule(r),
    textbook: r.textbook || '', progress: r.progress || '', lessonNote: r.lessonNote || '', kind: classKind(r) };
}
/** 반 종류: kind 열이 비어 있으면(예전 반) 이름·메모의 "선행" 으로 판단 */
function classKind(r) { if (CLASS_KINDS.indexOf(r.kind) >= 0) return r.kind; return /선행/.test(r.name || '') || /선행반/.test(r.memo || '') ? '선행' : '정규'; }
/** "월 17:00-19:00|토 10:00-12:00" → [{day,start,end}]. schedule 이 없으면 days + 공통 start/end 로 만든다 */
function parseSchedule(r) {
  var out = [];
  String(r.schedule || '').split('|').forEach(function (p) {
    var m = p.trim().match(/^([월화수목금토일])\s*(\d{2}:\d{2})?-?(\d{2}:\d{2})?$/);
    if (m && !out.some(function (x) { return x.day === m[1]; })) out.push({ day: m[1], start: m[2] || '', end: m[3] || '' });
  });
  if (!out.length) String(r.days || '').split(',').forEach(function (d) { d = d.trim(); if ('월화수목금토일'.indexOf(d) >= 0) out.push({ day: d, start: r.start || '', end: r.end || '' }); });
  return out;
}
function textbookOut(r) { return { id: r.id, name: r.name, subject: r.subject || '', grade: r.grade || '' }; }
function extOut(r) { return { id: r.id, studentId: r.studentId, name: r.name, day: r.day, start: r.start, end: r.end, memo: r.memo || '', updatedAt: r.updatedAt || '' }; }
function pubExtOut(x) { return { name: x.name, day: x.day, start: x.start, end: x.end, memo: x.memo }; }
function extOf(studentId) { return readRows('extSchedules').filter(function (r) { return r.studentId === studentId; }).map(extOut); }
function linkOut(l) { return { studentId: l.studentId, token: l.active ? l.token : '', active: !!l.active, createdAt: l.createdAt || '', expiresAt: l.expiresAt || '', submittedAt: l.submittedAt || '' }; }
function linkExpired(l) { return !!l.expiresAt && l.expiresAt < new Date().toISOString(); }
/** 링크 토큰: 무작위 40자리 16진수 (학생ID 를 URL 에 드러내지 않는다) */
function newToken() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40); }
function linkByToken(t) {
  t = String(t || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(t)) fail('bad_link', '유효하지 않은 링크입니다. 학원에 새 링크를 요청해 주세요.');
  var l = readRows('scheduleLinks').filter(function (r) { return r.token === t && r.active; })[0];
  if (!l || linkExpired(l)) fail('bad_link', '유효하지 않은 링크입니다. 학원에 새 링크를 요청해 주세요.');
  return l;
}
var STATUS_KEYS = { rosterSync: 1, rosterExport: 1, kioskDevices: 1 };   // 학생관리부 가져오기/내보내기 최근 상태 (JSON)
function settingsOut() {
  var o = { travelBuffer: 30, prorate: false, rosterSync: null, rosterExport: null };
  readRows('settings').forEach(function (r) { if (SETTING_KEYS[r.key]) o[r.key] = r.value; else if (STATUS_KEYS[r.key]) { try { o[r.key] = JSON.parse(r.value); } catch (e) { o[r.key] = null; } } });
  o.travelBuffer = Math.max(0, Math.min(180, Math.round(num(o.travelBuffer))));
  o.prorate = o.prorate === true || o.prorate === 'on' || o.prorate === 'true';   // 반 변경일 기준 일할 계산 (수납 화면에서 켜고 끔)
  o.kioskPinSet = !!o.kioskPin; delete o.kioskPin; delete o.kioskDevices;   // PIN·기기 토큰은 bootstrap 에 싣지 않는다 (kioskSettings 로만)
  return o;
}
function saveStatus(key, obj) { try { upsertRow('settings', 'key', { key: key, value: JSON.stringify(obj) }); } catch (e) {} }
/** 학생관리부 파일에서 읽을 탭: ROSTER_TABS 이름의 탭 → 1행에 성명·학생ID 제목이 있는 첫 탭 → 첫 탭 */
function pickRosterSheet(ss) {
  var sheets = ss.getSheets();
  for (var k = 0; k < ROSTER_TABS.length; k++) for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().replace(/\s/g, '') === ROSTER_TABS[k]) return sheets[i];
  for (var j = 0; j < sheets.length; j++) {
    var last = sheets[j].getLastColumn(); if (!last) continue;
    var head = sheets[j].getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h).replace(/\s/g, ''); });
    if (head.indexOf('성명') >= 0 && head.indexOf('학생ID') >= 0) return sheets[j];
  }
  return sheets[0];
}
// 가져오기/내보내기 결과를 settings 에 남겨 모든 사용자 화면에 "최근 동기화" 로 보여준다. 실패도 기록한 뒤 그대로 알린다
var importRosterCore = ACADEMY_ACTIONS.importRoster, exportRosterCore = ACADEMY_ACTIONS.exportRoster;
ACADEMY_ACTIONS.importRoster = function (req, me) {
  var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), t0 = Date.now();
  try { var r = importRosterCore(req, me); r.ms = Date.now() - t0; saveStatus('rosterSync', { ok: true, at: at, by: me.name, tab: r.tab, rows: r.rows, header: r.header, classSync: r.classSync, ms: r.ms }); r.at = at; return r; }
  catch (e) { if (e.name === 'AppError' && e.code === 'forbidden') throw e; saveStatus('rosterSync', { ok: false, at: at, by: me.name, error: String(e.message || e) }); throw e; }
};
ACADEMY_ACTIONS.exportRoster = function (req, me) {
  var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  try { var r = exportRosterCore(req, me); saveStatus('rosterExport', { ok: true, at: at, by: me.name, tab: r.tab, rows: r.rows }); return r; }
  catch (e) { saveStatus('rosterExport', { ok: false, at: at, by: me.name, error: String(e.message || e) }); throw e; }
};
/** 학생의 외부 일정을 items 로 통째로 바꾼다. 같은 이름·요일이 이미 있으면 id 를 이어받는다 */
function replaceExtSchedules(studentId, items) {
  if (!Array.isArray(items)) fail('bad_request', '일정 목록이 없습니다.');
  if (items.length > 60) fail('bad_request', '일정은 60개까지 넣을 수 있습니다.');
  var now = new Date().toISOString(), old = {};
  readRows('extSchedules').forEach(function (r) { if (r.studentId === studentId) old[r.name + '|' + r.day] = r; });
  var rows = [], seen = {};
  items.forEach(function (x) {
    x = x || {};
    var name = str(x.name, 40); if (!name) fail('bad_request', '일정 이름(학원명)을 적어 주세요.');
    var day = str(x.day, 1); if ('월화수목금토일'.indexOf(day) < 0) fail('bad_request', name + ': 요일을 골라 주세요.');
    var st = str(x.start, 5), en = str(x.end, 5);
    if (!isTime(st) || !isTime(en)) fail('bad_request', name + ' ' + day + '요일: 시작·종료 시각을 넣어 주세요.');
    if (en <= st) fail('bad_request', name + ' ' + day + '요일: 종료 시각이 시작 시각보다 늦어야 합니다.');
    var key = name + '|' + day + '|' + st; if (seen[key]) return; seen[key] = 1;
    var prev = old[name + '|' + day];
    rows.push({ id: prev && !seen['id:' + prev.id] ? prev.id : newId('X'), studentId: studentId, name: name, day: day, start: st, end: en, memo: str(x.memo, 200), createdAt: prev ? prev.createdAt : now, updatedAt: now });
    if (prev) seen['id:' + prev.id] = 1;
  });
  deleteRows('extSchedules', function (r) { return r.studentId === studentId; });
  appendRows('extSchedules', rows);
  return rows.map(extOut);
}
function isActiveEnr(e, today) { return !e.endDate || e.endDate >= (today || todayStr()); }
function isDeleted(r) { return r.deleted === true || r.deleted === 'TRUE' || r.deleted === 'true'; }
/** 소프트 삭제된 것을 뺀 수강 기록 (모든 조회는 이 함수를 쓴다) */
function readEnr() { return readRows('enrollments').filter(function (r) { return !isDeleted(r); }); }
function enrollOut(r) { return { id: r.id, studentId: r.studentId, classId: r.classId, startDate: r.startDate || '', endDate: r.endDate || '', fee: r.fee === '' ? null : num(r.fee), endReason: r.endReason || '', status: !r.endDate || r.endDate >= todayStr() ? 'active' : 'ended' }; }
function enrollmentsOut() { return readEnr().map(enrollOut); }
/** 변경 이력 (누가 언제 무엇을) */
function logChange(me, type, studentId, classId, before, after, note) {
  try { appendRow('changes', { id: newId('H'), at: new Date().toISOString(), memberId: me ? me.id : '', memberName: me ? me.name : '', type: type, studentId: studentId || '', classId: classId || '', before: str(before, 300), after: str(after, 300), note: str(note, 300) }); } catch (e) {}
}
/** 학생의 현재 수강 중 기록. 같은 반이 둘 이상이면 중복 (자동으로 지우지 않고 화면에서 알린다) */
function activeEnrOf(studentId, classId) { var t = todayStr(); return readEnr().filter(function (r) { return r.studentId === studentId && (!classId || r.classId === classId) && (!r.endDate || r.endDate >= t); }); }
/** 수강 종료: 날짜·사유. 기록은 남긴다 */
function endEnrollment(e, endDate, reason, me) {
  var r = END_REASONS.indexOf(reason) >= 0 ? reason : (reason ? str(reason, 20) : '기타'), before = e.endDate || '';
  if (endDate < e.startDate) {   // 시작한 날보다 앞서 끝나는 경우(당일 반 변경 등): 실제로 다닌 날이 없으므로 숨김 처리(소프트 삭제). 시트 행은 남는다
    e.deleted = true; e.endDate = e.startDate; e.endReason = r + ' (당일 취소)'; e.updatedAt = new Date().toISOString(); e.updatedBy = me ? me.id : '';
    upsertRow('enrollments', 'id', e);
    logChange(me, 'enroll_delete', e.studentId, e.classId, '시작 ' + e.startDate, '당일 취소 (' + r + ')', '');
    return;
  }
  e.endDate = endDate; e.endReason = r; e.updatedAt = new Date().toISOString(); e.updatedBy = me ? me.id : '';
  upsertRow('enrollments', 'id', e);
  logChange(me, 'enroll_end', e.studentId, e.classId, before ? '종료 ' + before : '수강 중', '종료 ' + endDate + ' (' + e.endReason + ')', '');
}
/** 수강 시작: 같은 반을 이미 수강 중이면 만들지 않는다 (중복 방지). 만든 행 또는 null */
function startEnrollment(studentId, classId, startDate, fee, me, note) {
  if (activeEnrOf(studentId, classId).length) return null;
  var row = { id: newId('E'), studentId: studentId, classId: classId, startDate: startDate, endDate: '', fee: fee == null || fee === '' ? '' : Math.max(0, Math.round(num(fee))), createdAt: new Date().toISOString(), endReason: '', deleted: false, updatedAt: new Date().toISOString(), updatedBy: me ? me.id : '' };
  appendRow('enrollments', row);
  logChange(me, 'enroll_start', studentId, classId, '', '시작 ' + startDate, note || '');
  return row;
}
/** 반 변경: 기존 수강(들)은 변경일 전날 종료, 새 반은 변경일 시작. 새 반을 이미 수강 중이면 종료만 한다 */
function changeClassOf(studentId, fromIds, toClassId, date, me) {
  var t = todayStr(), yday = addDaysStr(date, -1), fromNames = [], ended = 0;
  var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
  readEnr().forEach(function (e) {
    if (e.studentId !== studentId || fromIds.indexOf(e.id) < 0) return;
    if (e.endDate && e.endDate < t) return;   // 이미 끝난 것
    if (e.classId === toClassId) return;      // 같은 반으로의 변경은 건드리지 않는다
    fromNames.push((classes[e.classId] || {}).name || e.classId); endEnrollment(e, yday, '반 변경', me); ended++;
  });
  var created = startEnrollment(studentId, toClassId, date, '', me, '반 변경');
  var toName = (classes[toClassId] || {}).name || toClassId;
  logChange(me, 'class_change', studentId, toClassId, fromNames.join(', ') || '(없음)', toName, created ? '변경일 ' + date : '이미 수강 중인 반이라 종료만 처리');
  return { ended: ended, created: !!created, from: fromNames, to: toName };
}
function attOut(r) { return { id: r.id, date: r.date, classId: r.classId, studentId: r.studentId, status: r.status, note: r.note || '', updatedBy: r.updatedBy || '', updatedAt: r.updatedAt || '' }; }
function payOut(r) { return { id: r.id, date: r.date, studentId: r.studentId, month: r.month, item: r.item || '수강료', amount: num(r.amount), method: r.method || '', classId: r.classId || '', note: r.note || '', createdBy: r.createdBy || '' }; }
function examOut(r) {
  var ids = String(r.classIds == null ? '' : r.classIds).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (!ids.length && r.classId) ids = [String(r.classId)];
  return { id: r.id, date: r.date, classId: r.classId || '', classIds: ids, name: r.name, maxScore: num(r.maxScore) || 100, memo: r.memo || '' };
}
var classOutExam = examOut;
/** 성적 계산에 쓰는 반·수강 색인 (한 요청 안에서 한 번만 읽는다) */
function examCtx() {
  var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
  var enrByStudent = {}; readEnr().forEach(function (e) { (enrByStudent[e.studentId] || (enrByStudent[e.studentId] = [])).push(e); });
  return { classes: classes, enrByStudent: enrByStudent };
}
/** 점수 행의 "응시 당시 반": 행에 적힌 반 → 시험의 단일 반(예전 자료) → 시험일에 수강 중이던 반(정규 우선, 이름순) → 지금 수강 중인 반 */
function scoreClassOf(r, exam, ctx) {
  if (r.classId && ctx.classes[r.classId]) return String(r.classId);
  if (exam.classId && ctx.classes[exam.classId]) return String(exam.classId);
  var enr = ctx.enrByStudent[r.studentId] || [], t = todayStr();
  var pick = function (list) {
    var cs = list.map(function (e) { return ctx.classes[e.classId]; }).filter(Boolean);
    cs.sort(function (a, b) { var ka = classKind(a) === '선행' ? 1 : 0, kb = classKind(b) === '선행' ? 1 : 0; return ka - kb || String(a.name).localeCompare(String(b.name), 'ko'); });
    return cs.length ? cs[0].id : '';
  };
  return pick(enr.filter(function (e) { return e.startDate <= exam.date && (!e.endDate || e.endDate >= exam.date); })) || pick(enr.filter(function (e) { return isActiveEnr(e, t); }));
}
/**
 * 시험 하나의 통계. 점수 행에서 매번 계산하므로 점수를 고치면 평균·순위가 바로 바뀐다.
 * 순위는 동점자 공동 순위 (1 + 나보다 높은 점수의 사람 수: 95점 2명이면 둘 다 1위, 다음은 3위)
 */
function examStats(exam, scoreRows, ctx) {
  var rows = scoreRows.map(function (r) {
    var v = r.score === '' || r.score == null ? null : num(r.score);
    return { id: r.id, studentId: r.studentId, score: v == null || isNaN(v) ? null : v, note: r.note || '', classId: scoreClassOf(r, exam, ctx) };
  });
  var scored = rows.filter(function (r) { return r.score != null; });
  var agg = function (list) {
    if (!list.length) return { n: 0, avg: null, max: null, min: null };
    var sum = 0, mx = -Infinity, mn = Infinity; list.forEach(function (r) { sum += r.score; if (r.score > mx) mx = r.score; if (r.score < mn) mn = r.score; });
    return { n: list.length, avg: Math.round(sum / list.length * 10) / 10, max: mx, min: mn };
  };
  var overall = agg(scored), groups = {}, order = [];
  rows.forEach(function (r) { if (!groups[r.classId]) { groups[r.classId] = []; order.push(r.classId); } if (r.score != null) groups[r.classId].push(r); });
  var className = function (cid) { return ctx.classes[cid] ? ctx.classes[cid].name : (cid ? '(삭제된 반)' : '반 없음'); };
  var byClass = order.map(function (cid) { var a = agg(groups[cid]); a.classId = cid; a.className = className(cid); a.participants = rows.filter(function (r) { return r.classId === cid; }).length; return a; });
  byClass.sort(function (a, b) { return (a.classId === '' ? 1 : 0) - (b.classId === '' ? 1 : 0) || a.className.localeCompare(b.className, 'ko'); });
  var classAvg = {}; byClass.forEach(function (c) { classAvg[c.classId] = c.avg; });
  rows.forEach(function (r) {
    r.className = className(r.classId); r.classAvg = classAvg[r.classId] == null ? null : classAvg[r.classId];
    r.rank = r.score == null ? null : 1 + scored.filter(function (o) { return o.score > r.score; }).length;
    r.tie = r.score != null && scored.filter(function (o) { return o.score === r.score; }).length > 1;
  });
  return { participants: rows.length, overall: overall, byClass: byClass, rows: rows };
}
function examDetailOut(examId) {
  var e = findRow('exams', examId); if (!e) fail('bad_request', '없는 시험입니다.');
  var exam = examOut(e), ctx = examCtx(), st = examStats(exam, readRows('scores').filter(function (r) { return r.examId === examId; }), ctx);
  var students = {}; readRows('students').forEach(function (x) { students[x.id] = x; });
  st.rows.forEach(function (r) { var s = students[r.studentId]; r.name = s ? s.name : '(삭제된 학생)'; r.grade = s ? s.grade || '' : ''; r.status = s ? s.status || '' : ''; });
  st.rows.sort(function (a, b) { return (a.score == null ? 1 : 0) - (b.score == null ? 1 : 0) || (b.score || 0) - (a.score || 0) || String(a.name).localeCompare(String(b.name), 'ko'); });
  return { exam: exam, participants: st.participants, overall: st.overall, byClass: st.byClass, rows: st.rows };
}
/** 학생 한 명의 시험별 성적: 내 점수 · 응시 당시 반 · 반 평균 · 전체 평균 · 전체 순위(동점 공동) · 응시자 수 */
function studentScoresOut(studentId) {
  var mine = readRows('scores').filter(function (r) { return r.studentId === studentId; }); if (!mine.length) return [];
  var exams = {}; readRows('exams').forEach(function (e) { exams[e.id] = examOut(e); });
  var byExam = {}; readRows('scores').forEach(function (r) { if (exams[r.examId]) (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
  var ctx = examCtx(), out = [];
  mine.forEach(function (r) {
    var e = exams[r.examId]; if (!e) return;
    var st = examStats(e, byExam[r.examId] || [], ctx), me = null; st.rows.forEach(function (x) { if (x.studentId === studentId) me = x; }); if (!me) return;
    var cs = null; st.byClass.forEach(function (c) { if (c.classId === me.classId) cs = c; });
    out.push({ examId: e.id, examName: e.name, date: e.date, maxScore: e.maxScore, score: me.score, note: me.note, classId: me.classId, className: me.className,
      classAvg: me.classAvg, classN: cs ? cs.n : 0, avg: st.overall.avg, total: st.overall.n, participants: st.participants, rank: me.rank, tie: me.tie });
  });
  out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return out;
}
function consultOut(r) {
  return { id: r.id, date: r.date, time: r.time || '', type: r.type || '', studentId: r.studentId || '', name: r.name || '', phone: r.phone || '',
    school: r.school || '', grade: r.grade || '', content: r.content || '', nextDate: r.nextDate || '', memberId: r.memberId || '', createdAt: r.createdAt || '', updatedAt: r.updatedAt || '' };
}
function msgOut(r) { return { id: r.id, sentAt: r.sentAt, kind: r.kind || '', count: num(r.count), recipients: r.recipients || '', body: r.body || '', method: r.method || '', result: r.result || '', sentBy: r.sentBy || '' }; }

// ---------- 도우미 ----------
function isDateObj(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
/** 반 이름 정규화: 공백 여러 개·괄호/하이픈 주변 공백 차이를 없앤다 */
function normClassName(n) { return String(n == null ? '' : n).replace(/\s+/g, ' ').replace(/\s*-\s*/g, ' - ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')').trim(); }
/** 학생관리부 시트에 앱의 변경을 되돌려 쓴다. 실패해도 앱 쪽 작업은 그대로 두고 사유만 돌려준다 */
function rosterWrite(fn) {
  try {
    var ss = SpreadsheetApp.openById(ROSTER_SHEET_ID), sh = pickRosterSheet(ss), values = sh.getDataRange().getValues();
    if (values.length < 2) return { error: '시트가 비어 있습니다' };
    var head = values[0].map(function (h) { return String(h).replace(/\s/g, ''); }), col = {}; head.forEach(function (h, i) { if (h && col[h] == null) col[h] = i; });
    return fn(sh, col, values) || null;
  } catch (e) { return { error: String(e.message || e) }; }
}
/**
 * 학생관리부 시트의 정규반·선행반·재원상태 열에 드롭다운(데이터 검증)을 건다. 오타로 새 반이 생기는 것을 시트 입력 단계에서 막기 위한 것.
 * 목록 = 앱의 반 이름(종류별) + 지금 시트에 적힌 값(" / " 로 여러 반을 적은 칸도 그대로 고를 수 있게). 목록에 없는 값은 막지 않고 경고(빨간 표시)만 한다.
 * 내보내기·가져오기·학생별 자동 반영 뒤에 호출한다. 실패해도 본 작업에는 영향 없음
 */
function rosterApplyValidation(sh, col, values, classes) {
  try {
    var last = Math.max(sh.getMaxRows(), values.length), n = last - 1; if (n < 1) return null;
    var open = classes.filter(function (c) { return c.status !== '종료'; }), uniq = function (v, i, a) { return v && a.indexOf(v) === i; };
    var sortKo = function (a, b) { return a.localeCompare(b, 'ko'); };
    var current = function (k) { var out = []; for (var i = 1; i < values.length; i++) { var v = values[i][col[k]]; if (v != null && String(v).trim()) out.push(String(v).trim()); } return out; };
    var lists = {
      '정규반': open.filter(function (c) { return classKind(c) !== '선행'; }).map(function (c) { return c.name; }).sort(sortKo),
      '선행반': open.filter(function (c) { return classKind(c) === '선행'; }).map(function (c) { return c.name; }).sort(sortKo),
      '재원상태': ['재원', '대기', '휴원', '퇴원', '삭제'],
    };
    var applied = 0;
    Object.keys(lists).forEach(function (k) {
      if (col[k] == null) return;
      var list = lists[k].concat(current(k)).filter(uniq).slice(0, 480); if (!list.length) return;
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true)
        .setHelpText(k === '재원상태' ? '재원·대기·휴원·퇴원 중 하나' : '앱에 있는 반 이름을 고르세요. 반이 여러 개면 " / " 로 이어 씁니다. 목록에 없는 이름은 가져오기 때 새 반이 됩니다').build();
      sh.getRange(2, col[k] + 1, n, 1).setDataValidation(rule); applied++;
    });
    return { columns: applied };
  } catch (e) { return { error: String(e.message || e) }; }
}
/** 학생ID 로 찾은 행의 재원상태 칸에 status 를 쓴다 */
function rosterSetStatus(extId, status) {
  if (!extId) return null;
  return rosterWrite(function (sh, col, values) {
    if (col['학생ID'] == null || col['재원상태'] == null) return { error: '학생ID/재원상태 열 없음' };
    for (var i = 1; i < values.length; i++) if (String(values[i][col['학생ID']] == null ? '' : values[i][col['학생ID']]).trim() === extId) { sh.getRange(i + 1, col['재원상태'] + 1).setValue(status); return { row: i + 1, status: status }; }
    return { error: '시트에 ' + extId + ' 행 없음' };
  });
}
/** 학생 한 명의 반 관련 시트 칸: 담임T·정규반·요일·선행반 + 반ID (내보내기와 학생별 자동 반영이 같이 쓴다) */
function rosterClassFields(regs, aheads, members) {
  var teacherLabel = function (c) { var m = c && c.teacherId && members[c.teacherId]; if (!m) return ''; return /T$/.test(m.name) ? m.name : m.name + 'T'; };
  var uniq = function (v, i, a) { return a.indexOf(v) === i; };
  return {
    '담임T': regs.map(teacherLabel).filter(Boolean).filter(uniq).join(' / '),
    '정규반': regs.map(function (c) { return c.name; }).join(' / '),
    '요일': regs.map(function (c) { return (c.days || '').replace(/,/g, ''); }).filter(Boolean).filter(uniq).join(' / '),
    '선행반': aheads.map(function (c) { return c.name; }).join(' / '),
    '정규반ID': regs.map(function (c) { return c.id; }).join(' / '),
    '선행반ID': aheads.map(function (c) { return c.id; }).join(' / '),
  };
}
/** 학생 한 명의 반 칸을 학생관리부 시트에 맞춘다 (앱에서 수강을 바꾸면 바로). 실패해도 앱 작업은 그대로 */
function rosterSyncStudent(studentId) {
  var s = findRow('students', studentId); if (!s || !s.extId) return null;
  var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
  var members = {}; readRows('members').forEach(function (m) { members[m.id] = m; });
  var t = todayStr(), cls = readEnr().filter(function (e) { return e.studentId === studentId && (!e.endDate || e.endDate >= t) && classes[e.classId]; }).map(function (e) { return classes[e.classId]; });
  cls.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  var regs = cls.filter(function (c) { return classKind(c) !== '선행'; }), aheads = cls.filter(function (c) { return classKind(c) === '선행'; });
  var fields = rosterClassFields(regs, aheads, members);
  return rosterWrite(function (sh, col, values) {
    if (col['학생ID'] == null) return { error: '학생ID 열 없음' };
    var head = values[0].map(function (h) { return String(h).replace(/\s/g, ''); }), width = head.length; while (width > 0 && !head[width - 1]) width--;
    ['정규반ID', '선행반ID'].forEach(function (k) { if (col[k] == null) { sh.getRange(1, width + 1).setValue(k); col[k] = width; width++; } });
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][col['학생ID']] == null ? '' : values[i][col['학생ID']]).trim() !== s.extId) continue;
      var n = 0; Object.keys(fields).forEach(function (k) { if (col[k] == null) return; var cur = values[i][col[k]] == null ? '' : String(values[i][col[k]]); if (cur !== fields[k]) { sh.getRange(i + 1, col[k] + 1).setValue(fields[k]); values[i][col[k]] = fields[k]; n++; } });
      if (n) rosterApplyValidation(sh, col, values, Object.keys(classes).map(function (k) { return classes[k]; }));   // 새 반 이름이 드롭다운에도 들어가도록
      return { row: i + 1, cells: n };
    }
    return { error: '시트에 ' + s.extId + ' 행 없음' };
  });
}
/** 반 이름이 바뀌면 시트의 정규반·선행반 칸에서도 이름을 바꾼다 (반ID 열이 있으면 그 자리를, 없으면 옛 이름을 찾아서) */
function rosterRenameClass(oldName, newName, classId) {
  var target = normClassName(oldName); if (!target || target === normClassName(newName)) return null;
  return rosterWrite(function (sh, col, values) {
    var changed = 0;
    [['정규반', '정규반ID'], ['선행반', '선행반ID']].forEach(function (pair) {
      var k = pair[0], kid = pair[1]; if (col[k] == null) return;
      var colVals = [], dirty = false;
      for (var i = 1; i < values.length; i++) {
        var v = values[i][col[k]] == null ? '' : String(values[i][col[k]]), ids = col[kid] != null ? String(values[i][col[kid]] == null ? '' : values[i][col[kid]]).split(' / ') : [];
        var parts = v.split(' / ').map(function (p, j) { return (ids[j] && ids[j].trim() === classId) || normClassName(p) === target ? newName : p; });
        var nv = parts.join(' / '); if (nv !== v) { dirty = true; changed++; } colVals.push([nv]);
      }
      if (dirty) sh.getRange(2, col[k] + 1, colVals.length, 1).setValues(colVals);
    });
    return { cells: changed };
  });
}
/** 정규반·선행반 칸에서 이 반 이름을 뺀다 (" / " 로 여러 개 적힌 칸도 처리) */
function rosterRemoveClass(name) {
  var target = normClassName(name); if (!target) return null;
  return rosterWrite(function (sh, col, values) {
    var changed = 0;
    ['정규반', '선행반'].forEach(function (k) {
      if (col[k] == null) return;
      var colVals = [], dirty = false;
      for (var i = 1; i < values.length; i++) {
        var v = values[i][col[k]] == null ? '' : String(values[i][col[k]]);
        var parts = v.split(' / '), kept = parts.filter(function (p) { return normClassName(p) !== target; });
        if (kept.length !== parts.length) { dirty = true; changed++; colVals.push([kept.join(' / ')]); } else colVals.push([v]);
      }
      if (dirty) sh.getRange(2, col[k] + 1, colVals.length, 1).setValues(colVals);
    });
    return { cells: changed };
  });
}
function deptOfGrade(g) { return /^초/.test(g || '') ? '초등부' : /^중/.test(g || '') ? '중등부' : /^고/.test(g || '') ? '고등부' : ''; }
function colLetter(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function sheetTz(ss) { try { return (ss && ss.getSpreadsheetTimeZone && ss.getSpreadsheetTimeZone()) || TZ; } catch (e) { return TZ; } }
/** "2026-09-09" "2026.9.9" "2026/09/09" "2026. 9. 9" → "2026-09-09". 아니면 '' */
function normDate(v) { var m = String(v == null ? '' : v).trim().match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/); return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : ''; }
function requireAdmin(me) { if (!me || me.role !== 'admin') fail('forbidden', '원장(관리자)만 할 수 있습니다.'); }
function str(v, max) { return v == null ? '' : String(v).trim().slice(0, max); }
function num(v) { if (typeof v === 'number') return v; var n = Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; }
function phoneStr(v) { return String(v == null ? '' : v).replace(/[^\d]/g, '').slice(0, 12); }
function fmtPhone(v) { var d = phoneStr(v); if (!d) return ''; return d.length === 11 ? d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : d.length === 10 ? d.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1-$2-$3') : d; }
function newId(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function findRow(name, id) { return readRows(name).filter(function (r) { return r.id === id; })[0] || null; }
function addDaysStr(ymd, n) { var p = ymd.split('-').map(Number); var d = new Date(p[0], p[1] - 1, p[2] + n); return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

/** 여러 행을 한 번에 추가 */
function appendRows(name, objs) {
  var k0 = colsOf(name)[0]; objs.forEach(function (o) { journal(name, k0, null, o[k0]); });
  if (!objs.length) return;
  invalidateRows(name);
  var sh = sheet(name), r = sh.getLastRow() + 1, n = colsOf(name).length;
  sh.getRange(r, 1, objs.length, n).setNumberFormat('@').setValues(objs.map(function (o) { return rowValues(name, o); }));
}
/** 여러 행을 한 번에 갱신(있으면 그 자리에, 없으면 뒤에 추가). 시트를 한 번만 읽는다 */
function upsertMany(name, key, objs) {
  if (!objs.length) return;
  var rows = readRows(name), idx = {};
  invalidateRows(name);
  rows.forEach(function (r, i) { idx[r[key]] = i; });
  var sh = sheet(name), n = colsOf(name).length, adds = [], hits = [];
  objs.forEach(function (o) { if (idx[o[key]] != null) { journal(name, key, rows[idx[o[key]]], o[key]); hits.push(o); } else adds.push(o); });
  var contiguous = rows.length && rows[rows.length - 1]._row === rows.length + 1;
  if (hits.length > 5 && contiguous) {   // 바뀐 행이 많으면 본문 전체를 한 번에 다시 쓴다 (한 줄씩 쓰면 수십 초가 걸린다)
    hits.forEach(function (o) { var r = rows[idx[o[key]]]; var c = {}; for (var k in o) c[k] = o[k]; c._row = r._row; rows[idx[o[key]]] = c; });
    sh.getRange(2, 1, rows.length, n).setNumberFormat('@').setValues(rows.map(function (r) { return rowValues(name, r); }));
  } else hits.forEach(function (o) { sh.getRange(rows[idx[o[key]]]._row, 1, 1, n).setNumberFormat('@').setValues([rowValues(name, o)]); });
  appendRows(name, adds);
}

// =====================================================================
// ---------- 원장실 (docs/admin.html) ----------
// 원장실 화면이 쓰는 시트와 액션. 학생·반·수강·상담·납부는 위의 학원관리 것을 그대로 쓰고,
// 원장실에만 있는 자료(달력·테스트 일정·시재·점검·기록카드·개별 청구)만 아래 시트에 둔다.
// 원장(관리자) 전용. 학생 ID 는 학원관리 students.id 를 쓴다 (옛 원장실 ID 는 students.extId 에 있다).
//
//  events     달력 일정 (시험·특강·상담·휴원·특이사항)
//  tests      테스트 일정 (이틀 앞으로 오면 원장실 대시보드에 경고)
//  supplies   시재 (소모품 재고, 최소 보유량 이하면 경고)
//  issues     데이터 정합성 점검 항목
//  profiles   기록카드 — 성향·방향성·진로 (학생 1명 = 1행)
//  gradebook  기록카드 — 내신(kind 내신)·모의고사(모의)·테스트/과제(과제) (1건 = 1행)
//  bills      개별 청구 (특강·교재비 같은 건별 청구). 납부액이 생기면 학원관리 payments 에도 한 줄 남긴다
//  settings   adminMeta (학기·수강료 기준표, JSON)
// =====================================================================
var PROFILE_FIELDS = ['attitude', 'homework', 'style', 'strength', 'weakness', 'mental', 'peer', 'parent', 'traitMemo',
  'policy', 'roadmap', 'nextStep', 'risk', 'riskWhy', 'watch',
  'track', 'admType', 'univ1', 'major1', 'univ2', 'major2', 'targetInner', 'curInner', 'targetMock', 'curMock', 'careerMemo'];
ACADEMY_SHEETS.events    = ['id', 'date', 'type', 'title', 'target', 'note', 'createdAt', 'updatedAt'];
ACADEMY_SHEETS.tests     = ['id', 'date', 'title', 'type', 'target', 'teacher', 'scope', 'note', 'done', 'createdAt', 'updatedAt'];
ACADEMY_SHEETS.supplies  = ['id', 'name', 'category', 'qty', 'minQty', 'unit', 'lastIn', 'vendor', 'note', 'updatedAt'];
ACADEMY_SHEETS.issues    = ['id', 'category', 'target', 'detail', 'action', 'priority', 'done', 'createdAt', 'updatedAt'];
ACADEMY_SHEETS.profiles  = ['studentId'].concat(PROFILE_FIELDS).concat(['updatedAt']);
ACADEMY_SHEETS.gradebook = ['id', 'studentId', 'kind', 'date', 'year', 'term', 'exam', 'subject', 'score', 'avg', 'rank', 'total', 'level', 'weak', 'note',
  'org', 'round', 'raw', 'std', 'pct', 'type', 'scope', 'max', 'submit', 'createdAt', 'updatedAt'];
ACADEMY_SHEETS.bills     = ['id', 'studentId', 'kind', 'course', 'term', 'teacher', 'billed', 'discount', 'paid', 'status', 'method', 'paidAt', 'handler', 'note', 'paymentId', 'createdAt', 'updatedAt'];

var ADMIN_SHEETS = { events: 'V', tests: 'T', supplies: 'K', issues: 'I', gradebook: 'G', bills: 'B' };   // id 로 관리하는 원장실 시트와 새 id 접두사
var ADMIN_NUM_COLS = { qty: 1, minQty: 1, billed: 1, discount: 1, paid: 1, score: 1, avg: 1, rank: 1, total: 1, level: 1, raw: 1, std: 1, pct: 1, max: 1, year: 1 };
var ADMIN_BOOL_COLS = { done: 1 };
var ADMIN_DATE_COLS = { date: 1, lastIn: 1, paidAt: 1 };
var ADMIN_STUDENT_SHEETS = { gradebook: 1, bills: 1, profiles: 1 };   // studentId 가 있어야 하는 시트
var ADMIN_META_KEY = 'adminMeta';
var BILL_KINDS = ['특강', '선행', '정규', '보충', '교재비', '기타'];
var BILL_STATUS = ['완납', '미납', '부분납', '청강', '환불', '면제', '확인필요'];
var GRADEBOOK_KINDS = ['내신', '모의', '과제'];

/** 원장실 시작: 학원관리 bootstrap 에 원장실 시트를 모두 얹어 한 번에 준다 (요청마다 1~3초가 걸리므로) */
ACADEMY_ACTIONS.adminBootstrap = function (req, me) {
  requireAdmin(me);
  var b = ACADEMY_ACTIONS.bootstrap(req, me);
  b.consults = readRows('consults').map(consultOut);
  b.payments = readRows('payments').map(payOut);
  ['events', 'tests', 'supplies', 'issues', 'gradebook', 'bills', 'profiles'].forEach(function (n) { b[n] = readRows(n).map(adminOut(n)); });
  b.meta = adminMeta();
  b.examResults = allExamResultsOut();   // 학원관리 성적(시험·점수)을 학생별로 — 기록카드에서 같이 보인다 (같은 시트, 따로 저장하지 않음)
  return b;
};
/** 모든 시험의 학생별 결과 (원장실 기록카드용). 시험마다 examStats 를 한 번씩 계산해 평면 목록으로 준다 */
function allExamResultsOut() {
  var exams = readRows('exams').map(examOut), byExam = {}; readRows('scores').forEach(function (r) { (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
  var ctx = examCtx(), out = [];
  exams.forEach(function (e) {
    var rows = byExam[e.id]; if (!rows || !rows.length) return;
    var st = examStats(e, rows, ctx), cn = {}; st.byClass.forEach(function (c) { cn[c.classId] = c.n; });
    st.rows.forEach(function (r) {
      out.push({ examId: e.id, examName: e.name, date: e.date, maxScore: e.maxScore, studentId: r.studentId, score: r.score, note: r.note, classId: r.classId, className: r.className,
        classAvg: r.classAvg, classN: cn[r.classId] || 0, avg: st.overall.avg, total: st.overall.n, participants: st.participants, rank: r.rank, tie: r.tie });
    });
  });
  out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return out;
}

/** 원장실 시트 한 행 저장 (없으면 추가). bills 는 납부액에 따라 학원관리 payments 에도 반영한다 */
ACADEMY_ACTIONS.adminSave = function (req, me) {
  requireAdmin(me);
  var name = String(req.sheet || '');
  if (!ADMIN_SHEETS[name] && name !== 'profiles') fail('bad_request', '알 수 없는 시트: ' + name);
  var row = cleanAdminRow(name, req.row || {}, me);
  if (name === 'profiles') { upsertRow('profiles', 'studentId', row); return adminOut('profiles')(row); }
  if (name === 'bills') syncBillPayment(row, me);
  upsertRow(name, 'id', row);
  return adminOut(name)(row);
};

ACADEMY_ACTIONS.adminDelete = function (req, me) {
  requireAdmin(me);
  var name = String(req.sheet || ''), id = String(req.id || '');
  if (!ADMIN_SHEETS[name]) fail('bad_request', '알 수 없는 시트: ' + name);
  if (name === 'bills') { var b = findRow('bills', id); if (b && b.paymentId) deleteRows('payments', function (r) { return r.id === b.paymentId; }); }
  deleteRows(name, function (r) { return r.id === id; });
  return true;
};

/** 학기·수강료 기준표 */
ACADEMY_ACTIONS.adminSaveMeta = function (req, me) {
  requireAdmin(me);
  var m = req.meta || {}, out = { academy: str(m.academy, 60), term: str(m.term, 40), sourceDate: str(m.sourceDate, 10), rates: [] };
  (Array.isArray(m.rates) ? m.rates : []).slice(0, 100).forEach(function (r) { out.rates.push({ course: str(r.course, 60), fee: Math.round(num(r.fee)), kind: str(r.kind, 10) }); });
  upsertRow('settings', 'key', { key: ADMIN_META_KEY, value: JSON.stringify(out) });
  return out;
};

/**
 * 옛 원장실(Claude 아티팩트)에서 내려받은 자료를 한 번에 넣는다 (원장만).
 * 학생은 옛 원장실 ID(S0113 …)로 오므로 students.extId 로 학원관리 학생을 찾아 바꾼다.
 * 같은 id 가 이미 있으면 덮어쓴다 → 여러 번 눌러도 중복되지 않는다.
 */
ACADEMY_ACTIONS.adminImport = function (req, me) {
  requireAdmin(me);
  var byExt = {}; readRows('students').forEach(function (s) { if (s.extId) byExt[s.extId] = s.id; if (!byExt[s.id]) byExt[s.id] = s.id; });
  var report = {}, skipped = [];
  var resolve = function (r) {   // studentId: 옛 ID → 학원관리 ID
    var sid = String(r.studentId || '');
    if (byExt[sid]) { r.studentId = byExt[sid]; return true; }
    skipped.push(sid || '(학생 없음)'); return false;
  };
  ['events', 'tests', 'supplies', 'issues', 'gradebook', 'profiles', 'bills'].forEach(function (name) {
    var list = Array.isArray(req[name]) ? req[name] : [];
    if (!list.length) return;
    var rows = [];
    list.forEach(function (r) {
      r = r || {};
      if (ADMIN_STUDENT_SHEETS[name] && !resolve(r)) return;
      try { rows.push(cleanAdminRow(name, r, me)); } catch (e) { skipped.push(name + ' ' + (r.id || r.studentId || '') + ': ' + (e.message || e)); }
    });
    if (name === 'bills') rows.forEach(function (b) { syncBillPayment(b, me); });
    upsertMany(name, name === 'profiles' ? 'studentId' : 'id', rows);
    report[name] = rows.length;
  });
  if (req.meta) report.meta = !!ACADEMY_ACTIONS.adminSaveMeta({ meta: req.meta }, me);
  report.skipped = skipped.slice(0, 50); report.skippedCount = skipped.length;
  return report;
};

/**
 * 옛 원장실 자료를 구글 시트(드라이브)에서 읽어 넣는다 (원장만). 휴대폰처럼 파일을 올리기 어려울 때 쓴다.
 * 첫 탭 A열에 내보내기 JSON 이 글자로 들어 있거나(여러 칸에 나눠도 됨), 탭 이름이 events·tests·supplies·issues·
 * gradebook·profiles·bills(첫 줄이 열 이름)·meta(key/value 두 열)이면 adminImport 와 똑같이 처리한다. 시트는 이 스크립트를 실행하는 계정(원장 구글 계정)이 열 수 있어야 한다.
 */
ACADEMY_ACTIONS.adminImportSheet = function (req, me) {
  requireAdmin(me);
  var raw = str(req.sheetId, 400), m = raw.match(/\/d\/([A-Za-z0-9_\-]{20,})/), sheetId = m ? m[1] : raw.replace(/[^A-Za-z0-9_\-]/g, '');
  if (!sheetId) fail('bad_request', '시트 주소(URL) 또는 ID 를 넣어 주세요.');
  var ss; try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { fail('bad_request', '시트를 열 수 없습니다. 원장 구글 계정이 볼 수 있는 시트인지 확인하세요. (' + e.message + ')'); }
  var cell = function (v) {
    if (isDateObj(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    return v == null ? '' : v;
  };
  var readTab = function (name) {
    var sh = ss.getSheetByName(name); if (!sh) return null;
    var values = sh.getDataRange().getValues(); if (values.length < 2) return [];
    var head = values[0].map(function (h) { return String(h == null ? '' : h).trim(); }), out = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i], o = {}, any = false;
      head.forEach(function (h, j) { if (!h) return; var v = cell(row[j]); o[h] = v; if (v !== '') any = true; });
      if (any) out.push(o);
    }
    return out;
  };
  var body = {}, found = [];
  // 방법 1: 첫 탭 A열에 원장실 내보내기 JSON 이 통째로(여러 칸에 나눠) 들어 있는 시트 — 파일을 못 올릴 때 글자로 옮겨 둔 것
  var first = ss.getSheets()[0], a1 = first ? String(first.getRange(1, 1).getValue() == null ? '' : first.getRange(1, 1).getValue()) : '';
  if (/^\s*\{/.test(a1)) {
    var txt = first.getRange(1, 1, first.getLastRow(), 1).getValues().map(function (r) { return r[0] == null ? '' : String(r[0]); }).join('');
    var parsed; try { parsed = JSON.parse(txt); } catch (e) { fail('bad_request', 'A열의 JSON 을 읽을 수 없습니다: ' + e.message); }
    if (!parsed || typeof parsed !== 'object') fail('bad_request', 'A열의 JSON 형식이 잘못되었습니다.');
    if (parsed._check != null) {   // 글자로 옮겨 적은 자료가 원본과 같은지 확인 (내보내기 때 넣은 검증값)
      var want = Number(parsed._check); delete parsed._check;
      var got = adminImportCheck(parsed);
      if (got !== want) fail('bad_request', '시트의 JSON 이 원본과 다릅니다 (검증값 ' + got + ' ≠ ' + want + '). 다시 옮겨 주세요.');
    }
    ['events', 'tests', 'supplies', 'issues', 'gradebook', 'profiles', 'bills'].forEach(function (name) { if (Array.isArray(parsed[name]) && parsed[name].length) { body[name] = parsed[name]; found.push(name); } });
    if (parsed.meta && typeof parsed.meta === 'object') { body.meta = parsed.meta; found.push('meta'); }
    if (!found.length) fail('bad_request', 'JSON 에 가져올 자료가 없습니다.');
    var rep = ACADEMY_ACTIONS.adminImport(body, me);
    rep.sheet = ss.getName(); rep.tabs = found;
    return rep;
  }
  // 방법 2: 탭 이름이 events·supplies… 인 시트 (첫 줄이 열 이름)
  ['events', 'tests', 'supplies', 'issues', 'gradebook', 'profiles', 'bills'].forEach(function (name) {
    var list = readTab(name); if (list) { body[name] = list; found.push(name); }
  });
  var metaRows = readTab('meta');
  if (metaRows) {
    var meta = {};
    metaRows.forEach(function (r) { var k = str(r.key, 40); if (!k) return; var v = r.value; if (k === 'rates') { try { v = JSON.parse(String(v || '[]')); } catch (e) { v = []; } } meta[k] = v; });
    if (Object.keys(meta).length) { body.meta = meta; found.push('meta'); }
  }
  if (!found.length) fail('bad_request', '가져올 탭(events·supplies·issues·gradebook·profiles·bills·meta)이 시트에 없습니다.');
  var report = ACADEMY_ACTIONS.adminImport(body, me);
  report.sheet = ss.getName(); report.tabs = found;
  return report;
};

// ---------- 원장실 도우미 ----------
/** 가져오기 JSON 의 검증값: 문자열은 글자코드×자리, 숫자는 ×100, 참/거짓은 3/5 를 더한 값 (mod 1e9+7). 내보내는 쪽과 같은 계산 */
function adminImportCheck(o) {
  var M = 1000000007, t = 0;
  var walk = function (v) {
    if (v == null) return;
    if (typeof v === 'boolean') { t = (t + (v ? 3 : 5)) % M; return; }
    if (typeof v === 'string') { for (var i = 0; i < v.length; i++) t = (t + v.charCodeAt(i) * (i + 1)) % M; return; }
    if (typeof v === 'number') { t = (t + Math.floor(v * 100 + 0.5) + 7) % M; return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.keys(v).sort().forEach(function (k) { walk(k); walk(v[k]); }); }
  };
  walk(o); return t;
}
function adminMeta() {
  var row = readRows('settings').filter(function (r) { return r.key === ADMIN_META_KEY; })[0];
  var o = null; if (row) { try { o = JSON.parse(row.value); } catch (e) { o = null; } }
  return o && typeof o === 'object' ? o : { academy: '더블엠수학학원', term: '', sourceDate: '', rates: [] };
}
/** 시트 행 → 화면용. 숫자 열은 숫자로(비어 있으면 ''), done 은 참/거짓으로 */
function adminOut(name) {
  var cols = colsOf(name);
  return function (r) {
    var o = {};
    cols.forEach(function (c) {
      var v = r[c];
      if (ADMIN_NUM_COLS[c]) o[c] = (v === '' || v == null) ? '' : num(v);
      else if (ADMIN_BOOL_COLS[c]) o[c] = v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
      else o[c] = v == null ? '' : v;
    });
    return o;
  };
}
/** 화면에서 온 행을 시트에 넣을 모양으로 다듬고 검사한다 */
function cleanAdminRow(name, r, me) {
  var cols = colsOf(name), now = new Date().toISOString(), row = {};
  var key = name === 'profiles' ? 'studentId' : 'id';
  var id = str(r[key], 40);
  if (name !== 'profiles' && !id) id = newId(ADMIN_SHEETS[name]);
  if (ADMIN_STUDENT_SHEETS[name]) { if (!findRow('students', String(r.studentId || ''))) fail('bad_request', '없는 학생입니다: ' + (r.studentId || '')); }
  var existing = name === 'profiles' ? readRows('profiles').filter(function (x) { return x.studentId === r.studentId; })[0] : findRow(name, id);
  cols.forEach(function (c) {
    var v = r[c];
    if (c === key) { row[c] = name === 'profiles' ? String(r.studentId) : id; return; }
    if (c === 'createdAt') { row[c] = existing && existing.createdAt ? existing.createdAt : (str(v, 30) || now); return; }
    if (c === 'updatedAt') { row[c] = now; return; }
    if (c === 'paymentId') { row[c] = existing ? (existing.paymentId || '') : ''; return; }
    if (ADMIN_NUM_COLS[c]) { row[c] = (v === '' || v == null) ? '' : Math.round(num(v) * 100) / 100; return; }
    if (ADMIN_BOOL_COLS[c]) { row[c] = v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; return; }
    if (ADMIN_DATE_COLS[c]) { var d = normDate(v); if (v && !d) fail('bad_request', c + ' 날짜 형식이 잘못되었습니다: ' + v); row[c] = d; return; }
    row[c] = str(v, c === 'note' || c === 'detail' || c === 'content' || /Memo$/.test(c) || c === 'policy' || c === 'watch' ? 3000 : 200);
  });
  if (name === 'events' && !row.date) fail('bad_request', '일정 날짜가 없습니다.');
  if (name === 'events' && !row.title) row.title = '(제목 없음)';
  if (name === 'gradebook' && GRADEBOOK_KINDS.indexOf(row.kind) < 0) fail('bad_request', '기록 종류(내신·모의·과제)가 잘못되었습니다.');
  if (name === 'bills') {
    if (BILL_KINDS.indexOf(row.kind) < 0) row.kind = '기타';
    if (BILL_STATUS.indexOf(row.status) < 0) row.status = '미납';
    row.billed = num(row.billed); row.discount = num(row.discount); row.paid = num(row.paid);
  }
  if (name === 'supplies' && !row.name) fail('bad_request', '품목명을 입력하세요.');
  if (name === 'tests' && !row.title) fail('bad_request', '테스트명을 입력하세요.');
  return row;
}
/**
 * 개별 청구의 납부액을 학원관리 payments 에 한 줄로 반영한다 (청구 1건 = 납부 1행, bills.paymentId 로 연결).
 * 항목: 선행·정규는 '수강료', 교재비는 '교재비', 특강·보충·기타는 '기타' — 학원관리의 월 수강료 미납 계산은
 * '수강료' 납부만 세므로, 월 수강료가 아닌 특강을 '기타' 로 두어 이중으로 잡히지 않게 한다.
 * 납부액이 0이면 연결된 납부 행을 지운다.
 */
function syncBillPayment(bill, me) {
  var paid = num(bill.paid), existing = bill.paymentId ? findRow('payments', bill.paymentId) : null;
  if (paid > 0) {
    var date = isDate(bill.paidAt || '') ? bill.paidAt : (existing && isDate(existing.date) ? existing.date : todayStr());
    var row = existing || { id: newId('P'), createdBy: me.id, createdAt: new Date().toISOString() };
    row.date = date; row.studentId = bill.studentId; row.month = date.slice(0, 7);
    row.item = bill.kind === '교재비' ? '교재비' : (bill.kind === '선행' || bill.kind === '정규') ? '수강료' : '기타';
    row.amount = Math.round(paid);
    row.method = PAY_METHODS.indexOf(bill.method) >= 0 ? bill.method : '기타';
    row.classId = existing ? existing.classId || '' : '';
    row.note = ('청구 ' + bill.kind + ' ' + (bill.course || '') + (bill.term ? ' · ' + bill.term : '') + ' [' + bill.id + ']').slice(0, 300);
    upsertRow('payments', 'id', row); bill.paymentId = row.id;
  } else if (existing) { deleteRows('payments', function (r) { return r.id === existing.id; }); bill.paymentId = ''; }
}

// =====================================================================
// ---------- 출결 태블릿 (docs/checkin.html) ----------
// 학원 태블릿에서 학생이 휴대폰(또는 학부모) 번호 뒷자리 4개를 누르면 등원/하원을 기록하고 학부모에게 문자를 보낸다.
// 태블릿은 로그인 대신 "기기 토큰"을 쓴다: 관리자가 정한 PIN 으로 한 번 등록(kioskRegister)하면 토큰이 나오고, 그 토큰으로만
// kioskLookup(뒷자리 → 학생 찾기)·kioskCheck(기록+문자)·kioskToday(오늘 현황)를 부를 수 있다. 토큰은 settings 의 kioskDevices(JSON)에 있고
// 관리자가 언제든 지울 수 있다. 등원 때 그날 수업이 있는 반이면 출석부에도 "출석"(수업 시작 10분 뒤면 "지각")으로 적는다.
// =====================================================================
var KIOSK_MSG_IN = '[더블엠수학학원] {이름} 학생이 {시각}에 등원했습니다.', KIOSK_MSG_OUT = '[더블엠수학학원] {이름} 학생이 {시각}에 하원했습니다.';
function kioskDevices() { var r = readRows('settings').filter(function (x) { return x.key === 'kioskDevices'; })[0]; try { return r ? JSON.parse(r.value) || [] : []; } catch (e) { return []; } }
function kioskDevice(req) {
  var t = String(req.device || ''); if (!t) fail('unauthorized', '태블릿이 등록되지 않았습니다. 관리자 PIN 으로 등록하세요.');
  var d = kioskDevices().filter(function (x) { return x.token === t; })[0]; if (!d) fail('unauthorized', '등록이 해제된 태블릿입니다. 관리자 PIN 으로 다시 등록하세요.');
  return d;
}
function kioskSetting(key, dflt) { var r = readRows('settings').filter(function (x) { return x.key === key; })[0]; return r && r.value !== '' ? r.value : dflt; }
function nowHM() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function todayDow() { return ['', '월', '화', '수', '목', '금', '토', '일'][Number(Utilities.formatDate(new Date(), TZ, 'u'))] || ''; }
/** 오늘 이 학생의 수업 반 (시간이 있으면 지금과 가장 가까운 것) */
function kioskClassToday(studentId, classes) {
  var t = todayStr(), dow = todayDow(), now = nowHM();
  var cands = [];
  readEnr().forEach(function (e) {
    if (e.studentId !== studentId || !isActiveEnr(e, t)) return; var c = classes[e.classId]; if (!c || c.status === '종료') return;
    var slot = parseSchedule(c).filter(function (x) { return x.day === dow; })[0]; if (!slot) return;
    cands.push({ c: c, start: slot.start || '', end: slot.end || '' });
  });
  cands.sort(function (a, b) { var da = a.start ? Math.abs(hm2min(a.start) - hm2min(now)) : 9999, db = b.start ? Math.abs(hm2min(b.start) - hm2min(now)) : 9999; return da - db; });
  return cands[0] || null;
}
function hm2min(t) { var p = String(t || '').split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
ACADEMY_ACTIONS.kioskSettings = function (req, me) {
  requireAdmin(me);
  return { pinSet: !!kioskSetting('kioskPin', ''), sms: kioskSetting('kioskSms', 'on') !== 'off', msgIn: kioskSetting('kioskMsgIn', KIOSK_MSG_IN), msgOut: kioskSetting('kioskMsgOut', KIOSK_MSG_OUT),
    devices: kioskDevices().map(function (d) { return { name: d.name, createdAt: d.createdAt, lastUsed: d.lastUsed || '', tokenTail: '····' + String(d.token).slice(-4) }; }), smsReady: smsReady(smsConfig()) };
};
ACADEMY_ACTIONS.saveKioskSettings = function (req, me) {
  requireAdmin(me);
  if (req.pin != null && String(req.pin) !== '') { var pin = String(req.pin).replace(/\D/g, ''); if (pin.length < 4 || pin.length > 8) fail('bad_request', 'PIN 은 숫자 4~8자리입니다.'); upsertRow('settings', 'key', { key: 'kioskPin', value: pin }); }
  if (req.sms != null) upsertRow('settings', 'key', { key: 'kioskSms', value: req.sms === false || req.sms === 'off' ? 'off' : 'on' });
  if (req.msgIn != null) upsertRow('settings', 'key', { key: 'kioskMsgIn', value: str(req.msgIn, 300) || KIOSK_MSG_IN });
  if (req.msgOut != null) upsertRow('settings', 'key', { key: 'kioskMsgOut', value: str(req.msgOut, 300) || KIOSK_MSG_OUT });
  if (req.revoke) { var keep = kioskDevices().filter(function (d) { return d.name !== String(req.revoke); }); upsertRow('settings', 'key', { key: 'kioskDevices', value: JSON.stringify(keep) }); }
  return ACADEMY_ACTIONS.kioskSettings(req, me);
};
/** [로그인 없음] 태블릿 등록: 관리자 PIN 이 맞으면 기기 토큰을 만든다. 틀리면 잠깐 늦춰 무작위 입력을 막는다 */
ACADEMY_ACTIONS.kioskRegister = function (req) {
  var pin = kioskSetting('kioskPin', ''); if (!pin) fail('bad_request', '관리자가 아직 출결 태블릿 PIN 을 정하지 않았습니다. (학원관리 → 출석부 → 출결 태블릿)');
  if (String(req.pin || '').replace(/\D/g, '') !== pin) { Utilities.sleep(1500); fail('bad_request', 'PIN 이 맞지 않습니다.'); }
  var name = str(req.name, 30) || '태블릿', list = kioskDevices().filter(function (d) { return d.name !== name; });
  var token = 'K' + Utilities.getUuid().replace(/-/g, '');
  list.push({ token: token, name: name, createdAt: new Date().toISOString() });
  upsertRow('settings', 'key', { key: 'kioskDevices', value: JSON.stringify(list) });
  return { device: token, name: name, academy: '더블엠수학학원' };
};
/** [로그인 없음·기기 토큰] 번호 뒷자리 4개로 재원생 찾기 (학생 번호·학부모 번호 모두). 이름·학년·오늘 등하원 상태만 준다 */
ACADEMY_ACTIONS.kioskLookup = function (req) {
  kioskDevice(req);
  var d = String(req.digits || '').replace(/\D/g, ''); if (d.length !== 4) fail('bad_request', '뒷자리 4개를 누르세요.');
  var t = todayStr(), today = {}; readRows('checkins').forEach(function (r) { if (r.date === t) today[r.studentId] = (today[r.studentId] || []).concat([r]); });
  var list = readRows('students').filter(function (s) { return s.status === '재원' && (phoneStr(s.phone).slice(-4) === d || phoneStr(s.parentPhone).slice(-4) === d); });
  return list.map(function (s) {
    var mine = (today[s.id] || []).sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); }), last = mine[mine.length - 1];
    return { id: s.id, name: s.name, grade: s.grade || '', school: s.school || '', hasParent: !!phoneStr(s.parentPhone), lastKind: last ? last.kind : '', lastTime: last ? last.time : '', next: last && last.kind === '등원' ? '하원' : '등원' };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
};
/** [로그인 없음·기기 토큰] 등원/하원 기록 + 출석부 반영 + 학부모 문자 */
ACADEMY_ACTIONS.kioskCheck = function (req) {
  var dev = kioskDevice(req), sid = String(req.studentId || ''), kind = req.kind === '하원' ? '하원' : '등원';
  var s = findRow('students', sid); if (!s || s.status !== '재원') fail('bad_request', '재원생이 아닙니다.');
  var t = todayStr(), hm = nowHM(), now = new Date().toISOString();
  var mine = readRows('checkins').filter(function (r) { return r.date === t && r.studentId === sid; }).sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  var last = mine[mine.length - 1];
  if (last && last.kind === kind && hm2min(hm) - hm2min(last.time) < 120) return { ok: true, dup: true, kind: kind, time: last.time, name: s.name, message: s.name + ' 학생은 ' + last.time + '에 이미 ' + kind + ' 처리되었습니다.' };
  // 출석부: 등원이면 오늘 수업 반에 출석/지각
  var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
  var cls = kioskClassToday(sid, classes), attNote = '';
  if (cls && kind === '등원') {
    var late = cls.start && hm2min(hm) > hm2min(cls.start) + 10, status = late ? '지각' : '출석';
    var ex = readRows('attendance').filter(function (r) { return r.date === t && r.classId === cls.c.id && r.studentId === sid; })[0];
    if (!ex || ex.status === '결석' || ex.status === '') { upsertRow('attendance', 'id', { id: ex ? ex.id : newId('A'), date: t, classId: cls.c.id, studentId: sid, status: status, note: '태블릿 등원 ' + hm, updatedBy: 'kiosk', updatedAt: now }); attNote = cls.c.name + ' ' + status; }
    else attNote = cls.c.name + ' ' + ex.status + ' (이미 입력됨)';
  }
  // 학부모 문자
  var smsNote = '', smsOn = kioskSetting('kioskSms', 'on') !== 'off', cfg = smsConfig();
  if (!smsOn) smsNote = '문자 끔';
  else if (!phoneStr(s.parentPhone)) smsNote = '학부모 번호 없음';
  else if (!smsReady(cfg)) smsNote = '문자 API 미설정';
  else {
    var tpl = kioskSetting(kind === '등원' ? 'kioskMsgIn' : 'kioskMsgOut', kind === '등원' ? KIOSK_MSG_IN : KIOSK_MSG_OUT);
    var body = tpl.replace(/\{이름\}/g, s.name).replace(/\{시각\}/g, hm).replace(/\{날짜\}/g, t.slice(5).replace('-', '/')).replace(/\{반\}/g, cls ? cls.c.name : '');
    var r = sendViaProvider(cfg, [{ name: s.name, phone: phoneStr(s.parentPhone), body: body }]);
    smsNote = r.ok ? '문자 발송' : '문자 실패' + (r.detail ? ' · ' + r.detail : '');
    appendRow('messages', { id: newId('M'), sentAt: now, kind: '등하원', count: 1, recipients: s.name + ':' + phoneStr(s.parentPhone), body: body, method: cfg.provider, result: '성공 ' + r.ok + ' / 실패 ' + r.fail + (r.detail ? ' · ' + r.detail : ''), sentBy: 'kiosk:' + dev.name });
  }
  appendRow('checkins', { id: newId('Q'), date: t, time: hm, studentId: sid, kind: kind, classId: cls ? cls.c.id : '', device: dev.name, sms: smsNote, createdAt: now });
  try { var list = kioskDevices(); list.forEach(function (d) { if (d.token === dev.token) d.lastUsed = now; }); upsertRow('settings', 'key', { key: 'kioskDevices', value: JSON.stringify(list) }); } catch (e) {}
  return { ok: true, kind: kind, time: hm, name: s.name, att: attNote, sms: smsNote, message: s.name + ' 학생 ' + kind + ' 완료 (' + hm + ')' + (smsNote === '문자 발송' ? ' · 학부모님께 알림을 보냈습니다' : '') };
};
/** [로그인 없음·기기 토큰] 오늘 등하원 현황 (태블릿 대기 화면용) */
ACADEMY_ACTIONS.kioskToday = function (req) {
  kioskDevice(req); var t = todayStr(), names = {}; readRows('students').forEach(function (s) { names[s.id] = s.name; });
  var rows = readRows('checkins').filter(function (r) { return r.date === t; }).map(function (r) { return { time: r.time, name: names[r.studentId] || '', kind: r.kind }; });
  rows.sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
  return { date: t, rows: rows.slice(0, 30), inCount: rows.filter(function (r) { return r.kind === '등원'; }).length, outCount: rows.filter(function (r) { return r.kind === '하원'; }).length };
};
/** 대시보드: 날짜별 등하원 기록 */
ACADEMY_ACTIONS.listCheckins = function (req) {
  var date = String(req.date || todayStr()); if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
  return readRows('checkins').filter(function (r) { return r.date === date; }).map(function (r) { return { id: r.id, date: r.date, time: r.time, studentId: r.studentId, kind: r.kind, classId: r.classId || '', device: r.device || '', sms: r.sms || '' }; })
    .sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
};
