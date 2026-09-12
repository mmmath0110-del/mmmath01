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

var SMS = {
  provider: '',                 // '' (수동) 또는 'aligo'
  aligo: { key: '', userId: '', sender: '' },   // 알리고 API key, 아이디, 등록된 발신번호
};

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
  enrollments: ['id', 'studentId', 'classId', 'startDate', 'endDate', 'fee', 'createdAt'],
  attendance:  ['id', 'date', 'classId', 'studentId', 'status', 'note', 'updatedBy', 'updatedAt'],
  payments:    ['id', 'date', 'studentId', 'month', 'item', 'amount', 'method', 'classId', 'note', 'createdBy', 'createdAt'],
  exams:       ['id', 'date', 'classId', 'name', 'maxScore', 'memo', 'createdAt'],
  scores:      ['id', 'examId', 'studentId', 'score', 'note'],
  consults:    ['id', 'date', 'time', 'type', 'studentId', 'name', 'phone', 'school', 'grade', 'content', 'nextDate', 'memberId', 'createdAt', 'updatedAt'],
  messages:    ['id', 'sentAt', 'kind', 'count', 'recipients', 'body', 'method', 'result', 'sentBy'],
  textbooks:   ['id', 'name', 'subject', 'grade', 'createdAt'],   // 교재 목록 (반의 교재를 고를 때 씀)
  extSchedules: ['id', 'studentId', 'name', 'day', 'start', 'end', 'memo', 'createdAt', 'updatedAt'],
  scheduleLinks: ['studentId', 'token', 'active', 'createdAt', 'expiresAt', 'submittedAt'],
  settings:    ['key', 'value'],
};
var SETTING_KEYS = { travelBuffer: 1 };   // 이동 여유시간 기본값(분)
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
      enrollments: readRows('enrollments').map(enrollOut),
      textbooks: readRows('textbooks').map(textbookOut),
      extSchedules: readRows('extSchedules').map(extOut),
      scheduleLinks: readRows('scheduleLinks').map(linkOut),
      settings: settingsOut(),
      smsAuto: SMS.provider === 'aligo' && !!SMS.aligo.key,
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
  /** 관리자 설정 저장 (travelBuffer: 이동 여유시간 기본값, 분) */
  saveSetting: function (req, me) {
    requireAdmin(me);
    var key = str(req.key, 40); if (!SETTING_KEYS[key]) fail('bad_request', '알 수 없는 설정: ' + key);
    upsertRow('settings', 'key', { key: key, value: str(req.value, 200) });
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
    if (Array.isArray(req.classIds)) syncEnrollments(row.id, req.classIds.map(String), status);
    else if (status === '퇴원' || status === '휴원') syncEnrollments(row.id, [], status);
    // 재원상태가 바뀌면 학생관리부 시트에도 써 둔다 (안 그러면 다음 가져오기 때 시트 값으로 되돌아간다)
    var sheetNote = (existing && existing.status !== status && row.extId) ? rosterSetStatus(row.extId, status) : null;
    return { student: studentOut(row), enrollments: readRows('enrollments').map(enrollOut), sheet: sheetNote };
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
    var exams = {}; readRows('exams').forEach(function (e) { exams[e.id] = classOutExam(e); });
    var since = addDaysStr(todayStr(), -180);
    return {
      student: studentOut(s),
      enrollments: readRows('enrollments').filter(function (r) { return r.studentId === id; }).map(enrollOut),
      attendance: readRows('attendance').filter(function (r) { return r.studentId === id && r.date >= since; }).map(attOut),
      payments: me.role === 'admin' ? readRows('payments').filter(function (r) { return r.studentId === id; }).map(payOut) : [],
      scores: readRows('scores').filter(function (r) { return r.studentId === id && exams[r.examId]; }).map(function (r) {
        var e = exams[r.examId]; return { examId: r.examId, examName: e.name, date: e.date, classId: e.classId, maxScore: e.maxScore, score: num(r.score), note: r.note || '' };
      }),
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
    // 반을 만들면서 학생을 바로 수강 등록 (공통 가능시간 → [이 시간으로 반 개설])
    if (Array.isArray(c.enrollStudentIds) && c.enrollStudentIds.length && row.status !== '종료') {
      var today0 = todayStr(), have = {};
      readRows('enrollments').forEach(function (r) { if (r.classId === row.id && !r.endDate) have[r.studentId] = true; });
      var adds = [];
      c.enrollStudentIds.map(String).forEach(function (sid) {
        if (have[sid] || !findRow('students', sid)) return; have[sid] = true;
        adds.push({ id: newId('E'), studentId: sid, classId: row.id, startDate: str(c.enrollStart, 10) && isDate(str(c.enrollStart, 10)) ? str(c.enrollStart, 10) : today0, endDate: '', fee: '', createdAt: new Date().toISOString() });
      });
      appendRows('enrollments', adds);
    }
    if (row.status === '종료') {
      var today = todayStr();
      var open = readRows('enrollments').filter(function (r) { return r.classId === row.id && !r.endDate; });
      open.forEach(function (r) { r.endDate = today; });
      upsertMany('enrollments', 'id', open);
    }
    return { cls: classOut(row), enrollments: readRows('enrollments').map(enrollOut) };
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

  enroll: function (req, me) {
    var studentId = String(req.studentId || ''), classId = String(req.classId || '');
    if (!findRow('students', studentId)) fail('bad_request', '없는 학생입니다.');
    if (!findRow('classes', classId)) fail('bad_request', '없는 반입니다.');
    var start = str(req.startDate, 10) || todayStr(); if (!isDate(start)) fail('bad_request', '시작일이 잘못되었습니다.');
    var dup = readRows('enrollments').filter(function (r) { return r.studentId === studentId && r.classId === classId && !r.endDate; })[0];
    if (dup) return readRows('enrollments').map(enrollOut);
    appendRow('enrollments', { id: newId('E'), studentId: studentId, classId: classId, startDate: start, endDate: '', fee: req.fee === '' || req.fee == null ? '' : Math.max(0, Math.round(num(req.fee))), createdAt: new Date().toISOString() });
    return readRows('enrollments').map(enrollOut);
  },

  /** 수강 종료 (기록은 남긴다) */
  unenroll: function (req, me) {
    var e = findRow('enrollments', String(req.id || '')); if (!e) fail('bad_request', '없는 수강 등록입니다.');
    var end = str(req.endDate, 10) || todayStr(); if (!isDate(end)) fail('bad_request', '종료일이 잘못되었습니다.');
    e.endDate = end; upsertRow('enrollments', 'id', e);
    return readRows('enrollments').map(enrollOut);
  },

  deleteEnrollment: function (req, me) {
    requireAdmin(me);
    deleteRows('enrollments', function (r) { return r.id === String(req.id || ''); });
    return readRows('enrollments').map(enrollOut);
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
  listExams: function () {
    var stats = {};
    readRows('scores').forEach(function (s) {
      var v = num(s.score); if (s.score === '' || isNaN(v)) return;
      var st = stats[s.examId] || (stats[s.examId] = { n: 0, sum: 0, max: -Infinity, min: Infinity });
      st.n++; st.sum += v; if (v > st.max) st.max = v; if (v < st.min) st.min = v;
    });
    return readRows('exams').map(function (e) {
      var o = classOutExam(e), st = stats[e.id];
      o.count = st ? st.n : 0; o.avg = st ? Math.round(st.sum / st.n * 10) / 10 : null; o.max = st ? st.max : null; o.min = st ? st.min : null;
      return o;
    });
  },

  saveExam: function (req, me) {
    var e = req.exam || {};
    var existing = e.id ? findRow('exams', e.id) : null;
    if (e.id && !existing) fail('bad_request', '없는 시험입니다.');
    var name = str(e.name, 60); if (!name) fail('bad_request', '시험 이름을 입력하세요.');
    var date = str(e.date, 10); if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    var row = {
      id: existing ? existing.id : newId('X'), date: date, classId: e.classId && findRow('classes', String(e.classId)) ? String(e.classId) : '',
      name: name, maxScore: Math.max(1, Math.round(num(e.maxScore) || 100)), memo: str(e.memo, 500),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    upsertRow('exams', 'id', row);
    return classOutExam(row);
  },

  deleteExam: function (req, me) {
    requireAdmin(me);
    var id = String(req.id || '');
    deleteRows('scores', function (r) { return r.examId === id; });
    deleteRows('exams', function (r) { return r.id === id; });
    return true;
  },

  examScores: function (req) {
    var id = String(req.examId || '');
    return readRows('scores').filter(function (r) { return r.examId === id; }).map(function (r) { return { studentId: r.studentId, score: r.score === '' ? null : num(r.score), note: r.note || '' }; });
  },

  /** 시험 하나의 점수를 통째로 저장. score 가 빈 학생은 지운다 */
  saveScores: function (req, me) {
    var examId = String(req.examId || '');
    var exam = findRow('exams', examId); if (!exam) fail('bad_request', '없는 시험입니다.');
    var max = num(exam.maxScore) || 100;
    var existing = {}; readRows('scores').forEach(function (r) { if (r.examId === examId) existing[r.studentId] = r; });
    var ups = [], dels = {};
    (Array.isArray(req.scores) ? req.scores : []).forEach(function (x) {
      var sid = String(x.studentId || ''); if (!sid) return;
      var blank = x.score === '' || x.score == null;
      if (blank && !str(x.note, 1)) { if (existing[sid]) dels[existing[sid].id] = true; return; }
      var v = blank ? '' : num(x.score);
      if (!blank && (isNaN(v) || v < 0 || v > max)) fail('bad_request', '점수는 0~' + max + ' 사이여야 합니다.');
      var row = existing[sid] || { id: newId('R'), examId: examId, studentId: sid };
      row.score = v; row.note = str(x.note, 200); ups.push(row);
    });
    if (Object.keys(dels).length) deleteRows('scores', function (r) { return dels[r.id]; });
    upsertMany('scores', 'id', ups);
    return ACADEMY_ACTIONS.examScores({ examId: examId });
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
      var enrAll = readRows('enrollments'), openCount = {};
      enrAll.forEach(function (e) { if (!e.endDate) openCount[e.classId] = (openCount[e.classId] || 0) + 1; });
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
          enrAll.forEach(function (e) { if (e.classId !== d.id) return; if (!e.endDate && !have[e.studentId]) { e.classId = keep.id; have[e.studentId] = true; moves.push(e); } else dropIds[e.id] = true; });
          dropClassIds[d.id] = true; syncLog.merged.push(d.name + ' → ' + keep.name);
        });
      });
      if (moves.length) upsertMany('enrollments', 'id', moves);
      if (Object.keys(dropIds).length) deleteRows('enrollments', function (r) { return !!dropIds[r.id]; });
      if (Object.keys(dropClassIds).length) { deleteRows('classes', function (r) { return !!dropClassIds[r.id]; }); classes = classes.filter(function (c) { return !dropClassIds[c.id]; }); }
    })();
    classes.forEach(function (c) { classByName[normName(c.name)] = c; var k = coreOf(c.name); if (k) (classByCore[k] || (classByCore[k] = [])).push(c); });
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
      var regulars = get(r, '정규반').split(' / ').map(function (x) { return ensureClass(x, days, teacher, '정규반'); });
      var aheads = get(r, '선행반').split(' / ').map(function (ahead) {
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
    var enrs = readRows('enrollments'), openBy = {}, drop = {};
    enrs.forEach(function (e) {
      if (e.endDate) return;
      var arr = openBy[e.studentId] || (openBy[e.studentId] = []);
      if (arr.some(function (x) { return x.classId === e.classId; })) { drop[e.id] = true; syncLog.enrollDup++; } else arr.push(e);   // 같은 학생이 같은 반에 두 번 → 하나만
    });
    var ended = [], adds = [], yday = addDaysStr(today, -1);
    plan.forEach(function (p) {
      var want = (p.status === '재원' || p.status === '대기') ? p.classIds : [];
      var open = openBy[p.s.id] || [], have = {};
      // 시트에서 빠진 반: 어제로 종료 (오늘 시작한 수강은 기록 없이 삭제) → 옛 반이 오늘 하루 더 보이지 않는다
      open.forEach(function (e) { if (want.indexOf(e.classId) < 0) { if (e.startDate >= today) drop[e.id] = true; else { e.endDate = yday; ended.push(e); } } else have[e.classId] = true; });
      want.forEach(function (cid) { if (!have[cid]) adds.push({ id: newId('E'), studentId: p.s.id, classId: cid, startDate: today, endDate: '', fee: '', createdAt: new Date().toISOString() }); });
    });
    upsertMany('enrollments', 'id', ended); appendRows('enrollments', adds);
    if (Object.keys(drop).length) deleteRows('enrollments', function (r) { return !!drop[r.id]; });
    return { rows: plan.length, studentsAdded: added, studentsUpdated: updated, classesAdded: newClasses.length, enrollmentsAdded: adds.length, enrollmentsEnded: ended.length, warnings: warn.slice(0, 30), addedCols: addedCols, tab: tab, header: head.filter(Boolean), filledDept: filledDept,
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
    readRows('enrollments').forEach(function (e) { if (!e.endDate && classes[e.classId]) (openEnr[e.studentId] || (openEnr[e.studentId] = [])).push(classes[e.classId]); });
    var isAhead = function (c) { return classKind(c) === '선행'; };
    var teacherLabel = function (c) { var m = c && c.teacherId && members[c.teacherId]; if (!m) return ''; return /T$/.test(m.name) ? m.name : m.name + 'T'; };
    var deptOf = function (g) { return /^초/.test(g) ? '초등부' : /^중/.test(g) ? '중등부' : /^고/.test(g) ? '고등부' : ''; };
    var order = { 초등부: 1, 중등부: 2, 고등부: 3, '': 9 }, statusOrder = { 재원: 1, 대기: 2, 휴원: 3, 퇴원: 4 };
    students.sort(function (a, b) {
      return (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9) || order[deptOf(a.grade)] - order[deptOf(b.grade)]
        || (Number((a.grade || '').replace(/\D/g, '')) || 0) - (Number((b.grade || '').replace(/\D/g, '')) || 0) || a.name.localeCompare(b.name, 'ko');
    });
    if (col['등록일'] == null) { col['등록일'] = head.length; head.push('등록일'); }
    var rosterTz = sheetTz(ss);
    var cellText = function (v, h) { if (!isDateObj(v)) return v; return h === '등록일' ? Utilities.formatDate(v, rosterTz, 'yyyy-MM-dd') : (v.getMonth() + 1) + '-' + v.getDate(); };
    var rows = students.map(function (s) {
      var old = oldById[s.extId] || [], row = head.map(function (h, i) { return old[i] == null ? '' : cellText(old[i], h); });
      var cls = (openEnr[s.id] || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
      var regs = cls.filter(function (c) { return !isAhead(c); }), aheads = cls.filter(isAhead);
      var put = function (k, v) { if (col[k] != null) row[col[k]] = v; };
      put('학생ID', s.extId); put('성명', s.name); put('부서', deptOf(s.grade)); put('학년', (s.grade || '').replace(/\D/g, ''));
      put('담임T', regs.map(teacherLabel).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / '));
      put('정규반', regs.map(function (c) { return c.name; }).join(' / '));
      put('요일', regs.map(function (c) { return (c.days || '').replace(/,/g, ''); }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / '));
      put('선행반', aheads.map(function (c) { return c.name; }).join(' / '));
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
    return { rows: rows.length, assignedIds: assigned.length, url: 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit', at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), tab: tab };
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
    var auto = SMS.provider === 'aligo' && !!SMS.aligo.key;
    var result = auto ? sendViaAligo(list) : { ok: list.length, fail: 0, detail: '문자앱으로 전달' };
    var row = {
      id: newId('M'), sentAt: new Date().toISOString(), kind: str(req.kind, 20) || '직접입력', count: list.length,
      recipients: list.map(function (r) { return r.name + ':' + r.phone; }).join(';').slice(0, 20000),
      body: str(req.body, 2000) || list[0].body, method: auto ? 'aligo' : 'manual',
      result: auto ? ('성공 ' + result.ok + ' / 실패 ' + result.fail + (result.detail ? ' · ' + result.detail : '')) : '문자앱으로 전달 ' + list.length + '명',
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

// ---------- 문자 발송 (알리고) ----------
function sendViaAligo(list) {
  var ok = 0, failN = 0, detail = '';
  // 같은 내용끼리 묶어서 한 번에 보낸다 (알리고는 receiver 를 콤마로 여러 개 받는다)
  var groups = {};
  list.forEach(function (r) { (groups[r.body] || (groups[r.body] = [])).push(r.phone); });
  Object.keys(groups).forEach(function (body) {
    var phones = groups[body];
    for (var i = 0; i < phones.length; i += 100) {
      var chunk = phones.slice(i, i + 100);
      try {
        var res = UrlFetchApp.fetch('https://apis.aligo.in/send/', {
          method: 'post', muteHttpExceptions: true,
          payload: { key: SMS.aligo.key, user_id: SMS.aligo.userId, sender: SMS.aligo.sender, receiver: chunk.join(','), msg: body, msg_type: smsBytes(body) > 90 ? 'LMS' : 'SMS', title: '더블엠수학학원' },
        });
        var out = JSON.parse(res.getContentText() || '{}');
        if (String(out.result_code) === '1') { ok += num(out.success_cnt) || chunk.length; failN += num(out.error_cnt) || 0; }
        else { failN += chunk.length; detail = String(out.message || out.result_code || res.getResponseCode()); }
      } catch (e) { failN += chunk.length; detail = String(e.message || e); }
    }
  });
  return { ok: ok, fail: failN, detail: detail };
}
function smsBytes(s) { var n = 0; for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 127 ? 2 : 1; return n; }

// ---------- 수강 동기화 ----------
/** 학생의 현재 수강반 집합을 classIds 로 맞춘다. 빠진 반은 오늘 날짜로 종료, 새 반은 오늘 시작 */
function syncEnrollments(studentId, classIds, status) {
  var today = todayStr(), yday = addDaysStr(today, -1);
  var rows = readRows('enrollments').filter(function (r) { return r.studentId === studentId; });
  var open = rows.filter(function (r) { return !r.endDate; });
  var want = (status === '재원' || status === '대기') ? classIds : [];
  var changed = [], drop = {};
  open.forEach(function (r) { if (want.indexOf(r.classId) < 0) { if (r.startDate >= today) drop[r.id] = true; else { r.endDate = yday; changed.push(r); } } });
  upsertMany('enrollments', 'id', changed);
  if (Object.keys(drop).length) { deleteRows('enrollments', function (r) { return !!drop[r.id]; }); open = open.filter(function (r) { return !drop[r.id]; }); }
  var have = {}; open.forEach(function (r) { have[r.classId] = true; });
  var adds = want.filter(function (cid) { return !have[cid] && findRow('classes', cid); }).map(function (cid) {
    return { id: newId('E'), studentId: studentId, classId: cid, startDate: today, endDate: '', fee: '', createdAt: new Date().toISOString() };
  });
  if (adds.length) appendRows('enrollments', adds);
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
var STATUS_KEYS = { rosterSync: 1, rosterExport: 1 };   // 학생관리부 가져오기/내보내기 최근 상태 (JSON)
function settingsOut() {
  var o = { travelBuffer: 30, rosterSync: null, rosterExport: null };
  readRows('settings').forEach(function (r) { if (SETTING_KEYS[r.key]) o[r.key] = r.value; else if (STATUS_KEYS[r.key]) { try { o[r.key] = JSON.parse(r.value); } catch (e) { o[r.key] = null; } } });
  o.travelBuffer = Math.max(0, Math.min(180, Math.round(num(o.travelBuffer))));
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
function enrollOut(r) { return { id: r.id, studentId: r.studentId, classId: r.classId, startDate: r.startDate || '', endDate: r.endDate || '', fee: r.fee === '' ? null : num(r.fee) }; }
function attOut(r) { return { id: r.id, date: r.date, classId: r.classId, studentId: r.studentId, status: r.status, note: r.note || '', updatedBy: r.updatedBy || '', updatedAt: r.updatedAt || '' }; }
function payOut(r) { return { id: r.id, date: r.date, studentId: r.studentId, month: r.month, item: r.item || '수강료', amount: num(r.amount), method: r.method || '', classId: r.classId || '', note: r.note || '', createdBy: r.createdBy || '' }; }
function classOutExam(r) { return { id: r.id, date: r.date, classId: r.classId || '', name: r.name, maxScore: num(r.maxScore) || 100, memo: r.memo || '' }; }
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
/** 학생ID 로 찾은 행의 재원상태 칸에 status 를 쓴다 */
function rosterSetStatus(extId, status) {
  if (!extId) return null;
  return rosterWrite(function (sh, col, values) {
    if (col['학생ID'] == null || col['재원상태'] == null) return { error: '학생ID/재원상태 열 없음' };
    for (var i = 1; i < values.length; i++) if (String(values[i][col['학생ID']] == null ? '' : values[i][col['학생ID']]).trim() === extId) { sh.getRange(i + 1, col['재원상태'] + 1).setValue(status); return { row: i + 1, status: status }; }
    return { error: '시트에 ' + extId + ' 행 없음' };
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
  objs.forEach(function (o) { if (idx[o[key]] != null) hits.push(o); else adds.push(o); });
  var contiguous = rows.length && rows[rows.length - 1]._row === rows.length + 1;
  if (hits.length > 5 && contiguous) {   // 바뀐 행이 많으면 본문 전체를 한 번에 다시 쓴다 (한 줄씩 쓰면 수십 초가 걸린다)
    hits.forEach(function (o) { var r = rows[idx[o[key]]]; var c = {}; for (var k in o) c[k] = o[k]; c._row = r._row; rows[idx[o[key]]] = c; });
    sh.getRange(2, 1, rows.length, n).setNumberFormat('@').setValues(rows.map(function (r) { return rowValues(name, r); }));
  } else hits.forEach(function (o) { sh.getRange(rows[idx[o[key]]]._row, 1, 1, n).setNumberFormat('@').setValues([rowValues(name, o)]); });
  appendRows(name, adds);
}
