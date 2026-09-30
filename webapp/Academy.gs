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
 *  attChecks    미출결 확인 (학생 × 날짜 × 수업 1행 · 상태·확인자·알림·문자·도착 시각) · attCheckLog 상태 변경 이력 — 아래 "미출결 자동 확인" 참고
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
  exams:       ['id', 'date', 'classId', 'name', 'maxScore', 'memo', 'createdAt', 'classIds', 'questions', 'mode', 'objMax', 'essayMax'],   // mode: ''|q 문항별(기존) · parts 객관식/서술형 직접 입력 · total 전체 점수만   // questions: 문항별 단원·유형·배점 JSON [{n,unit,type,pts}]   // classIds: 등록 때 고른 반들(콤마) · classId 는 예전 단일 반(호환)
  scores:      ['id', 'examId', 'studentId', 'score', 'note', 'classId', 'updatedAt', 'wrong', 'parts', 'obj', 'essay'],   // obj·essay: mode=parts 에서 직접 입력한 객관식·서술형 점수   // wrong: 틀린 객관식 JSON [{n,kind}] kind=개념|계산|오독|시간|유형|'' · parts: 서술형 문항별 획득 점수 [{n,got}]
  reports:     ['id', 'studentId', 'weekStart', 'weekEnd', 'status', 'body', 'data', 'createdAt', 'createdBy', 'approvedBy', 'approvedAt', 'sentAt', 'sms', 'model'],   // 주간 리포트 (status draft|approved|sent)      // classId: 응시 당시 반 (없으면 시험일의 수강 반으로 계산) · score '' = 응시자 등록만 되고 미입력
  consults:    ['id', 'date', 'time', 'type', 'studentId', 'name', 'phone', 'school', 'grade', 'content', 'nextDate', 'memberId', 'createdAt', 'updatedAt'],
  messages:    ['id', 'sentAt', 'kind', 'count', 'recipients', 'body', 'method', 'result', 'sentBy', 'groupIds', 'delivery', 'deliveryAt'],   // groupIds: 솔라피 발송 묶음 번호 · delivery: 실제 도착 결과 요약 (도착 확인으로 채움)
  textbooks:   ['id', 'name', 'subject', 'grade', 'createdAt'],   // 교재 목록 (반의 교재를 고를 때 씀)
  extSchedules: ['id', 'studentId', 'name', 'day', 'start', 'end', 'memo', 'createdAt', 'updatedAt'],
  scheduleLinks: ['studentId', 'token', 'active', 'createdAt', 'expiresAt', 'submittedAt'],
  settings:    ['key', 'value'],
  changes:     ['id', 'at', 'memberId', 'memberName', 'type', 'studentId', 'classId', 'before', 'after', 'note'],
  makeups:     ['id', 'date', 'start', 'end', 'classId', 'teacherId', 'studentIds', 'title', 'reason', 'memo', 'status', 'notifiedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deleted', 'deletedAt', 'deletedBy', 'remindedAt'],   // deleted=TRUE 면 화면에서만 빠진다(소프트 삭제 · 시트에는 남는다) · remindedAt: 전날 리마인드 문자를 보낸 시각   // 보강 일정 (studentIds: 대상 학생 ID 콤마)   // 수강·반 변경 이력
};
var END_REASONS = ['반 변경', '퇴원', '수강 완료', '휴원', '중복 정리', '기타'];
var SETTING_KEYS = { travelBuffer: 1, prorate: 1, kioskPin: 1, kioskSms: 1, kioskMsgIn: 1, kioskMsgOut: 1, kioskStaffPin: 1, reportStyle: 1, reportRank: 1, reportDay: 1 };   // 이동 여유시간 기본값(분) · 수강료 일할 계산(on/off) · 출결 태블릿(PIN·문자 on/off·등원/하원 문구·선생님 근무번호 확인 on/off)
var CLASS_KINDS = ['정규', '선행'];
var A_DATE_COLS = { date: 1, birth: 1, enrolledAt: 1, leftAt: 1, startDate: 1, endDate: 1, nextDate: 1 };
var A_TIME_COLS = { start: 1, end: 1, time: 1 };
var STUDENT_STATUS = ['재원', '휴원', '퇴원', '대기'];
var ATT_STATUS = ['출석', '지각', '결석', '조퇴', '보강', '기타'];
var PAY_ITEMS = ['수강료', '교재비', '기타'];
var PAY_METHODS = ['현금', '카드', '계좌이체', '기타'];
var CONSULT_TYPES = ['신규상담', '학부모상담', '학생상담', '전화상담', '기타'];
var EXAM_MODES = ['q', 'parts', 'total'];   // 채점 방식 (빈 값은 'q' = 예전 시험)
var MAKEUP_REASONS = ['결석 보강', '휴원일 보강', '진도 보강', '시험 대비', '기타'];
var MAKEUP_STATUS = ['예정', '완료', '취소'];

var ACADEMY_ACTIONS = {
  /** 앱 시작 시 한 번: 기본 데이터 전부 */
  bootstrap: function (req, me) {
    var sc = scopeOf(me);   // 강사면 담당 반·담당 학생만 내려간다 (화면에서 감추는 것이 아니라 응답에서 뺀다)
    return {
      me: publicMember(me), members: listMembers(), scoped: !!sc,
      students: readRows('students').filter(function (r) { return canStudent(sc, r.id); }).map(studentOut),
      classes: readRows('classes').filter(function (r) { return canClass(sc, r.id); }).map(classOut),
      enrollments: enrollmentsOut(me),
      textbooks: readRows('textbooks').map(textbookOut),
      extSchedules: readRows('extSchedules').filter(function (r) { return canStudent(sc, r.studentId); }).map(extOut),
      scheduleLinks: readRows('scheduleLinks').filter(function (r) { return canStudent(sc, r.studentId); }).map(linkOut),
      makeups: makeupsIn(addDaysStr(todayStr(), -30), addDaysStr(todayStr(), 120), me),
      mkRequests: mkRequestsFor(me),   // 강사: 내 요청 · 원장: 대기 중 + 최근 30일 처리분
      settings: settingsOut(),
      smsAuto: smsReady(smsConfig()), smsProvider: SMS_PROVIDERS[smsConfig().provider] || '', aiReady: !!aiConfig().key,
    };
  },

  // ---------- 학생 외부 일정 · 일정 입력 링크 ----------
  /** 외부 일정·링크만 다시 읽는다 (학생이 링크로 새로 입력한 것을 반영) */
  listExtSchedules: function (req, me) {
    var sc = scopeOf(me);
    return { extSchedules: readRows('extSchedules').filter(function (r) { return canStudent(sc, r.studentId); }).map(extOut),
      scheduleLinks: readRows('scheduleLinks').filter(function (r) { return canStudent(sc, r.studentId); }).map(linkOut) };
  },
  /** 학생의 외부 일정을 통째로 바꾼다 (강사도 가능). items: [{name, day, start, end, memo}] */
  saveExtSchedules: function (req, me) {
    var s = findRow('students', String(req.studentId || '')); if (!s) fail('bad_request', '없는 학생입니다.');
    requireStudent(me, s.id);
    var items = replaceExtSchedules(s.id, req.items);
    var link = readRows('scheduleLinks').filter(function (r) { return r.studentId === s.id; })[0];
    if (link) { link.submittedAt = new Date().toISOString(); upsertRow('scheduleLinks', 'studentId', link); }
    return { items: items, link: link ? linkOut(link) : null };
  },
  /** 일정 입력 링크. 없으면 만들고, renew 면 기존 링크를 폐기하고 새로 발급한다 */
  scheduleLink: function (req, me) {
    var s = findRow('students', String(req.studentId || '')); if (!s) fail('bad_request', '없는 학생입니다.');
    requireStudent(me, s.id);
    var cur = readRows('scheduleLinks').filter(function (r) { return r.studentId === s.id; })[0];
    if (cur && cur.active && !req.renew && !linkExpired(cur)) return linkOut(cur);
    var row = { studentId: s.id, token: newToken(), active: true, createdAt: new Date().toISOString(), expiresAt: '', submittedAt: cur ? cur.submittedAt || '' : '' };
    upsertRow('scheduleLinks', 'studentId', row);
    return linkOut(row);
  },
  /** 링크 폐기 (새로 발급하기 전까지 학생이 접속할 수 없다) */
  revokeScheduleLink: function (req, me) {
    requireStudent(me, String(req.studentId || ''));
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
    return { name: s.name, items: extOf(s.id).map(pubExtOut), makeups: makeupsOfStudent(s.id, todayStr()).map(pubMakeupOut), submittedAt: link.submittedAt || '' };
  },
  /** [로그인 없음] 일정 입력 링크로 일정을 저장한다 (기존 일정을 통째로 바꾼다) */
  pubScheduleSave: function (req) {
    var link = linkByToken(req.link);
    var items = replaceExtSchedules(link.studentId, req.items);
    link.submittedAt = new Date().toISOString(); upsertRow('scheduleLinks', 'studentId', link);
    return { items: items.map(pubExtOut), makeups: makeupsOfStudent(link.studentId, todayStr()).map(pubMakeupOut), submittedAt: link.submittedAt };
  },

  // ---------- 보강 일정 ----------
  /** 기간 안의 보강 일정 (기본: 30일 전 ~ 120일 뒤) */
  listMakeups: function (req, me) {
    var from = isDate(str(req.from, 10)) ? str(req.from, 10) : addDaysStr(todayStr(), -30);
    var to = isDate(str(req.to, 10)) ? str(req.to, 10) : addDaysStr(todayStr(), 120);
    return makeupsIn(from, to, me);
  },
  /** 보강 일정 등록·수정 (강사도 가능). makeup: {id?, date, start, end, classId, teacherId, studentIds[], title, reason, memo, status} */
  saveMakeup: function (req, me) {
    var m = req.makeup || {};
    var existing = m.id ? findMakeup(m.id) : null;
    if (m.id && !existing) fail('bad_request', '없는 보강 일정입니다.');
    if (existing && isDeleted(existing)) fail('bad_request', '지운 보강 일정입니다. [지운 보강]에서 되살린 뒤 고치세요.');
    var date = str(m.date, 10); if (!isDate(date)) fail('bad_request', '보강 날짜를 확인하세요.');
    var start = str(m.start, 5), end = str(m.end, 5);
    if (start && !isTime(start)) fail('bad_request', '시작 시각이 잘못되었습니다.');
    if (end && !isTime(end)) fail('bad_request', '종료 시각이 잘못되었습니다.');
    if (start && end && end <= start) fail('bad_request', '종료 시각은 시작 시각보다 늦어야 합니다.');
    var classId = str(m.classId, 20); if (classId && !findRow('classes', classId)) fail('bad_request', '없는 반입니다.');
    var known = {}; readRows('students').forEach(function (x) { known[x.id] = 1; });
    var ids = (Array.isArray(m.studentIds) ? m.studentIds : String(m.studentIds || '').split(','))
      .map(function (x) { return String(x == null ? '' : x).trim(); })
      .filter(function (id, i, arr) { return id && known[id] && arr.indexOf(id) === i; });
    if (!ids.length) fail('bad_request', '보강 대상 학생을 한 명 이상 고르세요.');
    if (classId) requireClass(me, classId);
    ids.forEach(function (id) { requireStudent(me, id); });   // 담당하지 않는 학생은 보강 대상으로 넣을 수 없다
    var teacherId = m.teacherId && findMember(String(m.teacherId).toLowerCase()) ? String(m.teacherId).toLowerCase() : '';
    var now = new Date().toISOString();
    var row = {
      id: existing ? existing.id : newId('B'), date: date, start: start, end: end, classId: classId, teacherId: teacherId,
      studentIds: ids.join(','), title: str(m.title, 60),
      reason: MAKEUP_REASONS.indexOf(m.reason) >= 0 ? m.reason : MAKEUP_REASONS[0],
      memo: str(m.memo, 500), status: MAKEUP_STATUS.indexOf(m.status) >= 0 ? m.status : '예정',
      notifiedAt: existing ? existing.notifiedAt || '' : '', remindedAt: existing ? existing.remindedAt || '' : '',
      createdAt: existing ? existing.createdAt : now, createdBy: existing ? existing.createdBy || me.id : me.id,
      updatedAt: now, updatedBy: me.id, deleted: '', deletedAt: '', deletedBy: '',
    };
    upsertRow('makeups', 'id', row);
    if (req.requestId && me.role === 'admin') {   // [보강 → 요청] 에서 등록한 것이면 그 요청을 처리로 바꾸고 보강과 연결한다
      var rq = readRows('mkRequests').filter(function (x) { return x.id === String(req.requestId); })[0];
      if (rq) { rq.status = '처리'; rq.handledBy = me.id; rq.handledAt = now; rq.makeupId = row.id; upsertRow('mkRequests', 'id', rq); }
    }
    return makeupOut(row);
  },
  /** 보강 일정 삭제 (원장 또는 등록한 사람) */
  /**
   * 보강 삭제는 소프트 삭제: 시트 행은 그대로 두고 deleted=TRUE 로 표시해 화면(목록·달력·기록카드)에서만 뺀다.
   * 이미 진행한(완료) 보강 기록이 지워지지 않게 하기 위한 것이며, 원장은 [지운 보강]에서 되살릴 수 있다.
   */
  deleteMakeup: function (req, me) {
    var m = findMakeup(req.id); if (!m) return true;
    if (isDeleted(m)) return { ok: true, id: m.id, already: true };
    if (!canMakeup(scopeOf(me), m)) denyScope('보강');
    if (me.role !== 'admin' && m.createdBy !== me.id) fail('forbidden', '본인이 등록한 보강 일정만 지울 수 있습니다.');
    m.deleted = true; m.deletedAt = new Date().toISOString(); m.deletedBy = me.id; m.updatedAt = m.deletedAt; m.updatedBy = me.id;
    upsertRow('makeups', 'id', m);
    return { ok: true, id: m.id, status: m.status || '예정' };
  },
  /** 지운 보강 목록 (원장만). 되살릴 것을 고르기 위한 것 */
  deletedMakeups: function (req, me) {
    requireAdmin(me);
    return readRows('makeups').filter(isDeleted).map(function (r) { var o = makeupOut(r); o.deletedAt = r.deletedAt || ''; o.deletedBy = r.deletedBy || ''; return o; })
      .sort(function (a, b) { return String(b.deletedAt).localeCompare(String(a.deletedAt)); });
  },
  /** 지운 보강 되살리기 (원장만) */
  restoreMakeup: function (req, me) {
    requireAdmin(me);
    var m = findMakeup(req.id); if (!m) fail('bad_request', '없는 보강 일정입니다.');
    m.deleted = ''; m.deletedAt = ''; m.deletedBy = ''; m.updatedAt = new Date().toISOString(); m.updatedBy = me.id;
    upsertRow('makeups', 'id', m);
    return makeupOut(m);
  },
  /** 문자를 보낸 보강 일정에 보낸 시각을 남긴다. kind='remind' 면 전날 리마인드, 아니면 처음 안내 */
  makeupNotified: function (req, me) {
    var m = findMakeup(req.id); if (!m || isDeleted(m)) fail('bad_request', '없는 보강 일정입니다.');
    if (!canMakeup(scopeOf(me), m)) denyScope('보강');
    var now = new Date().toISOString();
    if (String(req.kind || '') === 'remind') m.remindedAt = now; else m.notifiedAt = now;
    m.updatedAt = now; m.updatedBy = me.id;
    upsertRow('makeups', 'id', m);
    return makeupOut(m);
  },
  /** 보강이 필요한 결석·조퇴 (기본: 최근 21일). 이미 보강이 잡혔으면 makeupId 가 채워진다 */
  makeupNeeds: function (req, me) {
    var from = isDate(str(req.from, 10)) ? str(req.from, 10) : addDaysStr(todayStr(), -21);
    var to = isDate(str(req.to, 10)) ? str(req.to, 10) : todayStr();
    var sc = scopeOf(me);
    var mks = readMakeups().filter(function (r) { return (r.status || '예정') !== '취소'; });
    return readRows('attendance').filter(function (r) { return r.date >= from && r.date <= to && (r.status === '결석' || r.status === '조퇴') && canClass(sc, r.classId) && canStudent(sc, r.studentId); })
      .map(function (r) {
        var hit = mks.filter(function (k) {
          return k.date >= r.date && String(k.studentIds || '').split(',').indexOf(r.studentId) >= 0 && (!k.classId || !r.classId || k.classId === r.classId);
        }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
        return { date: r.date, classId: r.classId || '', studentId: r.studentId, status: r.status, note: r.note || '', makeupId: hit ? hit.id : '', makeupDate: hit ? hit.date : '' };
      }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
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
    if (existing) requireStudent(me, existing.id);   // 담당 학생만 수정 (새 학생 등록은 강사도 가능)
    if (Array.isArray(req.classIds)) req.classIds.forEach(function (cid) { requireClass(me, String(cid)); });
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
    return { student: studentOut(row), enrollments: enrollmentsOut(me), sheet: sheetNote };
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
    requireStudent(me, id);
    var sc = scopeOf(me);
    var since = addDaysStr(todayStr(), -180);
    return {
      student: studentOut(s),
      enrollments: readEnr().filter(function (r) { return r.studentId === id && canClass(sc, r.classId); }).map(enrollOut),
      attendance: (function () { var vis = attVisible(sc); return readRows('attendance').filter(function (r) { return r.studentId === id && r.date >= since && vis(r); }).map(attOut); })(),
      payments: me.role === 'admin' ? readRows('payments').filter(function (r) { return r.studentId === id; }).map(payOut) : [],
      scores: studentScoresOut(id, me),
      consults: readRows('consults').filter(function (r) { return r.studentId === id; }).map(consultOut),
      extSchedules: extOf(id),
      makeups: makeupsOfStudent(id, addDaysStr(todayStr(), -400), me, true),   // 기록카드·학생 상세의 보강 이력 (취소한 것까지 그대로)
      link: (function () { var l = readRows('scheduleLinks').filter(function (r) { return r.studentId === id; })[0]; return l ? linkOut(l) : null; })(),
    };
  },

  // ---------- 반 ----------
  saveClass: function (req, me) {
    var c = req.cls || {};
    var existing = c.id ? findRow('classes', c.id) : null;
    if (c.id && !existing) fail('bad_request', '없는 반입니다.');
    if (existing) requireClass(me, existing.id);   // 담당 반만 수정 (새 반 개설은 강사도 가능)
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
    return { cls: classOut(row), enrollments: enrollmentsOut(me), sheet: sheetNote };
  },

  /** 수업 정보만 고친다 (교과·교재·진도·수업메모). 강사도 가능. 요일·시간·담임 등은 건드리지 않는다 */
  updateClassInfo: function (req, me) {
    var c = findRow('classes', String(req.id || '')); if (!c) fail('bad_request', '없는 반입니다.');
    requireClass(me, c.id);
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
    requireClass(me, classId);
    var start = str(req.startDate, 10) || todayStr(); if (!isDate(start)) fail('bad_request', '시작일이 잘못되었습니다.');
    if (activeEnrOf(studentId, classId).length) fail('already_enrolled', '이미 수강 중인 반입니다.');
    startEnrollment(studentId, classId, start, req.fee, me, '반 추가');
    return { enrollments: enrollmentsOut(me), sheet: rosterSyncStudent(studentId) };
  },
  /** 수강 종료: 종료일·사유. 기록은 남긴다 */
  unenroll: function (req, me) {
    var e = readEnr().filter(function (r) { return r.id === String(req.id || ''); })[0]; if (!e) fail('bad_request', '없는 수강 등록입니다.');
    requireClass(me, e.classId);
    var end = str(req.endDate, 10) || todayStr(); if (!isDate(end)) fail('bad_request', '종료일이 잘못되었습니다.');
    endEnrollment(e, end, str(req.reason, 20) || '기타', me);
    return { enrollments: enrollmentsOut(me), sheet: rosterSyncStudent(e.studentId) };
  },
  /** 여러 수강을 한 번에 종료 */
  endEnrollments: function (req, me) {
    var ids = (req.ids || []).map(String), end = str(req.endDate, 10) || todayStr(); if (!isDate(end)) fail('bad_request', '종료일이 잘못되었습니다.');
    var reason = str(req.reason, 20) || '기타', students = {};
    readEnr().forEach(function (e) { if (ids.indexOf(e.id) >= 0) requireClass(me, e.classId); });
    readEnr().forEach(function (e) { if (ids.indexOf(e.id) >= 0) { endEnrollment(e, end, reason, me); students[e.studentId] = true; } });
    var sheet = null; Object.keys(students).forEach(function (sid) { sheet = rosterSyncStudent(sid) || sheet; });
    return { enrollments: enrollmentsOut(me), sheet: sheet };
  },
  /** 삭제는 소프트 삭제 (deleted=TRUE). 관리자만. 기록은 시트에 남는다 */
  deleteEnrollment: function (req, me) {
    requireAdmin(me);
    var e = readEnr().filter(function (r) { return r.id === String(req.id || ''); })[0]; if (!e) return { enrollments: enrollmentsOut(me) };
    e.deleted = true; e.updatedAt = new Date().toISOString(); e.updatedBy = me.id; upsertRow('enrollments', 'id', e);
    logChange(me, 'enroll_delete', e.studentId, e.classId, e.startDate + '~' + (e.endDate || ''), '삭제(숨김)', '');
    return { enrollments: enrollmentsOut(me), sheet: rosterSyncStudent(e.studentId) };
  },
  /** 반 변경: 학생 한 명. fromIds(현재 수강 id들) → toClassId, 변경일 date */
  changeClass: function (req, me) {
    var studentId = String(req.studentId || ''), toClassId = String(req.toClassId || ''), date = str(req.date, 10) || todayStr();
    if (!findRow('students', studentId)) fail('bad_request', '없는 학생입니다.');
    if (!findRow('classes', toClassId)) fail('bad_request', '없는 반입니다.');
    requireStudent(me, studentId); requireClass(me, toClassId);
    readEnr().forEach(function (e) { if ((req.fromIds || []).map(String).indexOf(e.id) >= 0) requireClass(me, e.classId); });
    if (!isDate(date)) fail('bad_request', '변경일이 잘못되었습니다.');
    var r = changeClassOf(studentId, (req.fromIds || []).map(String), toClassId, date, me);
    r.enrollments = enrollmentsOut(me); r.sheet = rosterSyncStudent(studentId); return r;
  },
  /** 학생 일괄 이동: fromClassId 를 수강 중인 studentIds 를 toClassId 로 (각자 기존 수강 종료 + 새 수강) */
  moveStudents: function (req, me) {
    var from = String(req.fromClassId || ''), to = String(req.toClassId || ''), date = str(req.date, 10) || todayStr();
    if (!findRow('classes', to)) fail('bad_request', '없는 반입니다.'); if (!isDate(date)) fail('bad_request', '변경일이 잘못되었습니다.');
    if (from === to) fail('bad_request', '같은 반입니다.');
    requireClass(me, to); if (from) requireClass(me, from);
    var ids = (req.studentIds || []).map(String), moved = 0, skipped = [], sheet = null;
    ids.forEach(function (sid) { requireStudent(me, sid); });
    ids.forEach(function (sid) {
      var cur = activeEnrOf(sid, from).map(function (e) { return e.id; });
      var r = changeClassOf(sid, cur, to, date, me); if (r.created || r.ended) moved++; else skipped.push((findRow('students', sid) || {}).name || sid);
      sheet = rosterSyncStudent(sid) || sheet;
    });
    return { moved: moved, skipped: skipped, enrollments: enrollmentsOut(me), sheet: sheet };
  },
  /** 중복 정리: keepId 만 남기고 나머지는 "중복 정리" 사유로 종료 (삭제하지 않는다) */
  resolveDuplicate: function (req, me) {
    var keep = String(req.keepId || ''), ends = (req.endIds || []).map(String), t = todayStr(), sid = '';
    readEnr().forEach(function (e) { if (ends.indexOf(e.id) >= 0) requireClass(me, e.classId); });
    readEnr().forEach(function (e) { if (ends.indexOf(e.id) >= 0 && e.id !== keep) { sid = e.studentId; endEnrollment(e, addDaysStr(t, -1), '중복 정리', me); } });   // 어제로 종료 → 바로 "지난 이력"으로. 오늘 시작한 중복은 숨김
    return { enrollments: enrollmentsOut(me), sheet: sid ? rosterSyncStudent(sid) : null };
  },
  /** 변경 이력 (최근 순). studentId / classId / type / from·to(YYYY-MM-DD, 서울 날짜 기준) 로 거를 수 있다. 관리자 화면의 "변경 기록" 탭과 학생 상세가 같이 쓴다 */
  listChanges: function (req, me) {
    var sid = String(req.studentId || ''), cid = String(req.classId || ''), type = str(req.type, 30), from = normDate(String(req.from || '')), to = normDate(String(req.to || ''));
    var sc = scopeOf(me);
    if (sid) requireStudent(me, sid);
    if (cid) requireClass(me, cid);
    var rows = readRows('changes').filter(function (r) {
      if (sc && !(canStudent(sc, r.studentId) || canClass(sc, r.classId))) return false;   // 강사는 담당 학생·담당 반 이력만
      if (sid && r.studentId !== sid) return false; if (cid && r.classId !== cid) return false; if (type && r.type !== type) return false;
      if (from || to) { var d = r.at ? Utilities.formatDate(new Date(r.at), TZ, 'yyyy-MM-dd') : ''; if (from && d < from) return false; if (to && d > to) return false; }
      return true;
    });
    rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    var limit = Math.max(1, Math.min(2000, Number(req.limit) || 200));
    return rows.slice(0, limit).map(function (r) { return { id: r.id, at: r.at, memberId: r.memberId, memberName: r.memberName, type: r.type, studentId: r.studentId, classId: r.classId, before: r.before, after: r.after, note: r.note }; });
  },

  // ---------- 출결 ----------
  listAttendance: function (req, me) {
    var from = String(req.from || ''), to = String(req.to || '');
    if (!isDate(from) || !isDate(to)) fail('bad_request', '기간이 잘못되었습니다.');
    var classId = req.classId ? String(req.classId) : '';
    var studentId = req.studentId ? String(req.studentId) : '';
    if (req.makeupId) { var mk = findMakeup(req.makeupId); if (!mk || isDeleted(mk)) fail('bad_request', '없는 보강입니다.'); if (!canMakeup(scopeOf(me), mk)) denyScope('보강'); classId = mk.id; }   // 보강 출결은 classId 자리에 보강 id 로 저장된다
    else if (classId) requireClass(me, classId);
    if (studentId) requireStudent(me, studentId);
    var vis = attVisible(scopeOf(me));
    return readRows('attendance').filter(function (r) {
      return r.date >= from && r.date <= to && (!classId || r.classId === classId) && (!studentId || r.studentId === studentId) && vis(r);
    }).map(attOut);
  },

  /** 한 반의 하루 출결을 통째로 저장. status 가 빈 학생은 행을 지운다 */
  saveAttendance: function (req, me) {
    var date = String(req.date || ''), classId = String(req.classId || '');
    if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
    if (req.makeupId) {   // 보강 출결: 반 대신 보강 id 로 한 줄씩 (반 없이 잡은 보강도 체크할 수 있게)
      var mk = findMakeup(req.makeupId); if (!mk || isDeleted(mk)) fail('bad_request', '없는 보강입니다.');
      if (!canMakeup(scopeOf(me), mk)) denyScope('보강');
      classId = mk.id;
    } else {
      if (!findRow('classes', classId)) fail('bad_request', '없는 반입니다.');
      requireClass(me, classId);
    }
    var rows = Array.isArray(req.rows) ? req.rows : [];
    var existing = {};
    readRows('attendance').forEach(function (r) { if (r.date === date && r.classId === classId) existing[r.studentId] = r; });
    var ups = [], dels = {}, changed = [];
    rows.forEach(function (x) {
      var sid = String(x.studentId || ''); if (!sid) return;
      var status = ATT_STATUS.indexOf(x.status) >= 0 ? x.status : '';
      if (status && (!existing[sid] || existing[sid].status !== status)) changed.push({ studentId: sid, status: status });
      if (!status) { if (existing[sid]) dels[existing[sid].id] = true; return; }
      var row = existing[sid] || { id: newId('A'), date: date, classId: classId, studentId: sid };
      row.status = status; row.note = str(x.note, 200); row.updatedBy = me.id; row.updatedAt = new Date().toISOString();
      ups.push(row);
    });
    if (Object.keys(dels).length) deleteRows('attendance', function (r) { return dels[r.id]; });
    upsertMany('attendance', 'id', ups);
    if (date === todayStr() && changed.length) { try { attOnAttendance(date, classId, changed, me); } catch (e) {} }   // 미출결 확인 목록도 맞춘다
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
  listExams: function (req, me) {
    var ctx = examCtx(), byExam = {}; readRows('scores').forEach(function (r) { (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
    var sc = scopeOf(me), vis = visibleExamIds(sc);
    return readRows('exams').filter(function (e) { return !vis || vis[e.id]; }).map(function (e) {
      var o = examOut(e), st = examStats(o, byExam[e.id] || [], ctx);
      o.participants = st.participants; o.count = st.overall.n; o.avg = st.overall.avg; o.max = st.overall.max; o.min = st.overall.min;
      o.byClass = st.byClass.filter(function (c) { return canClass(sc, c.classId); }).map(function (c) { return { classId: c.classId, className: c.className, n: c.n, avg: c.avg }; });   // 강사는 담당 반 평균만
      if (sc) o.classIds = (o.classIds || []).filter(function (id) { return canClass(sc, id); });
      return o;
    });
  },
  /** 시험 상세: 시험 정보 + 학생별 점수(반·반 평균·전체 순위) + 전체/반별 통계 */
  examDetail: function (req, me) { requireExam(me, String(req.examId || '')); return examDetailOut(String(req.examId || ''), me); },

  /**
   * 시험 등록/수정. exam: { id?, name, date, maxScore, memo, classIds: [반 id…], participants: [{ studentId, classId }] }
   * 응시자(participants)는 점수 행으로 만들어 둔다(점수는 빈 값). 이미 있는 응시자는 그대로 두고 없는 학생만 추가한다 — 빼는 것은 removeScore 로만
   */
  saveExam: function (req, me) {
    var e = req.exam || {};
    var existing = e.id ? findRow('exams', e.id) : null;
    if (e.id && !existing) fail('bad_request', '없는 시험입니다.');
    if (existing) requireExam(me, existing.id);
    (Array.isArray(e.classIds) ? e.classIds : (e.classId ? [e.classId] : [])).forEach(function (cid) { requireClass(me, String(cid)); });
    (Array.isArray(e.participants) ? e.participants : []).forEach(function (x) { var sid = String((x && x.studentId) || x || ''); if (sid) requireStudent(me, sid); });
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
      questions: existing ? existing.questions || '' : '',
      mode: 'q', objMax: 0, essayMax: 0,
    };
    // 채점 방식: q 문항별(기본·예전 시험) · parts 객관식/서술형 점수 직접 입력 · total 전체 점수만
    var mode = EXAM_MODES.indexOf(String(e.mode || '')) >= 0 ? String(e.mode) : (existing && EXAM_MODES.indexOf(String(existing.mode || '')) >= 0 ? String(existing.mode) : 'q');
    row.mode = mode;
    if (mode === 'parts') {
      var om = Math.max(0, Math.round(num(e.objMax) * 10) / 10), em = Math.max(0, Math.round(num(e.essayMax) * 10) / 10);
      if (om + em <= 0) fail('bad_request', '객관식 총점과 서술형 총점을 넣으세요. (합이 0보다 커야 합니다)');
      row.objMax = om; row.essayMax = em; row.maxScore = Math.round((om + em) * 10) / 10;
    } else if (mode === 'total') {
      row.maxScore = Math.max(1, Math.round(num(e.maxScore) || 100));
    }
    if (mode === 'q' && Array.isArray(e.questions)) {   // 문항 설정: 번호·구분·단원·유형·배점. 배점을 넣었으면 만점은 배점 합
      var qs = parseQuestions(e.questions).filter(function (q) { return q.n > 0; }); if (qs.length > 200) fail('bad_request', '문항은 200개까지입니다.');
      var sum = qs.reduce(function (a, q) { return a + q.pts; }, 0); if (sum > 0) row.maxScore = Math.round(sum * 10) / 10;
      row.questions = qs.length ? JSON.stringify(qs) : '';
    }
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
  examScores: function (req, me) {
    requireExam(me, String(req.examId || ''));
    var d = examDetailOut(String(req.examId || ''), me);
    return d.rows.map(function (r) { return { studentId: r.studentId, score: r.score, note: r.note, classId: r.classId }; });
  },

  /**
   * 점수 저장. scores: [{ studentId, score, note, classId? }]. 빈 점수는 "미입력"으로 남기고 응시자는 지우지 않는다.
   * 목록에 없는 학생은 응시자로 추가된다. 응시자에서 빼는 것은 removeScore 로만 한다
   */
  saveScores: function (req, me) {
    var examId = String(req.examId || '');
    var exam = findRow('exams', examId); if (!exam) fail('bad_request', '없는 시험입니다.');
    requireExam(me, examId);
    (Array.isArray(req.scores) ? req.scores : []).forEach(function (x) { if (x && x.studentId) requireStudent(me, String(x.studentId)); });
    var max = num(exam.maxScore) || 100, now = new Date().toISOString(), examO = examOut(exam), exq = examQs(examO), pmax = examPartMax(examO);
    var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
    var existing = {}; readRows('scores').forEach(function (r) { if (r.examId === examId) existing[r.studentId] = r; });
    var ups = [];
    (Array.isArray(req.scores) ? req.scores : []).forEach(function (x) {
      var sid = String(x.studentId || ''); if (!sid) return;
      var row = existing[sid] || { id: newId('R'), examId: examId, studentId: sid, classId: '' };
      var wrong = x.wrong !== undefined ? parseWrong(x.wrong) : parseWrong(row.wrong), wrongJson = wrong.length ? JSON.stringify(wrong) : '';
      var parts = x.parts !== undefined ? parseParts(x.parts) : parseParts(row.parts), partsJson = parts.length ? JSON.stringify(parts) : '';
      var blank = x.score === '' || x.score == null, v = blank ? '' : num(x.score);
      if (blank && (x.wrong !== undefined || x.parts !== undefined) && exq.length) { var c = computeScore(examO, wrong, parts); if (c.total != null) v = c.total; }   // 틀린 문항·서술형 점수만 넣으면 총점은 자동
      var objV = row.obj == null ? '' : row.obj, essayV = row.essay == null ? '' : row.essay;
      if (examO.mode === 'parts' && (x.obj !== undefined || x.essay !== undefined)) {   // 객관식·서술형 점수를 직접 입력 → 총점은 두 값의 합
        objV = x.obj === '' || x.obj == null ? '' : num(x.obj);
        essayV = x.essay === '' || x.essay == null ? '' : num(x.essay);
        if (objV !== '' && (isNaN(objV) || objV < 0 || objV > pmax.obj)) fail('bad_request', '객관식 점수는 0~' + pmax.obj + ' 사이여야 합니다.');
        if (essayV !== '' && (isNaN(essayV) || essayV < 0 || essayV > pmax.essay)) fail('bad_request', '서술형 점수는 0~' + pmax.essay + ' 사이여야 합니다.');
        v = (objV === '' && essayV === '') ? '' : Math.round(((objV || 0) + (essayV || 0)) * 10) / 10;
      }
      if (v !== '' && (isNaN(v) || v < 0 || v > max)) fail('bad_request', '점수는 0~' + max + ' 사이여야 합니다.');
      var cid = x.classId && classes[String(x.classId)] ? String(x.classId) : row.classId || '';
      var note = str(x.note, 200);
      if (existing[sid] && String(existing[sid].score) === String(v) && (existing[sid].note || '') === note && (existing[sid].classId || '') === cid && (existing[sid].wrong || '') === wrongJson && (existing[sid].parts || '') === partsJson
        && String(existing[sid].obj == null ? '' : existing[sid].obj) === String(objV) && String(existing[sid].essay == null ? '' : existing[sid].essay) === String(essayV)) return;   // 바뀐 것만 쓴다
      row.score = v; row.note = note; row.classId = cid; row.wrong = wrongJson; row.parts = partsJson; row.obj = objV; row.essay = essayV; row.updatedAt = now; ups.push(row);
    });
    if (ups.length) upsertMany('scores', 'id', ups);
    return examDetailOut(examId, me);
  },

  /** 응시자에서 뺀다 (점수 행 삭제). 화면에서 확인창을 거친 뒤에만 부른다 */
  removeScore: function (req, me) {
    var examId = String(req.examId || ''), sid = String(req.studentId || '');
    if (!findRow('exams', examId)) fail('bad_request', '없는 시험입니다.');
    requireExam(me, examId); requireStudent(me, sid);
    deleteRows('scores', function (r) { return r.examId === examId && r.studentId === sid; });
    return examDetailOut(examId, me);
  },

  // ---------- 상담 ----------
  listConsults: function (req, me) {
    var from = String(req.from || '0000-00-00'), to = String(req.to || '9999-99-99'), sc = scopeOf(me);
    return readRows('consults').filter(function (r) {
      if (sc && !(canStudent(sc, r.studentId) || r.memberId === sc.memberId)) return false;   // 강사는 담당 학생 상담 + 본인이 쓴 상담만
      return (r.date >= from && r.date <= to) || (r.nextDate && r.nextDate >= from && r.nextDate <= to);
    }).map(consultOut);
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
    if (studentId) requireStudent(me, studentId);
    if (existing && !canStudent(scopeOf(me), existing.studentId) && scopeOf(me) && existing.memberId !== me.id) denyScope('상담');
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
      sentBy: me.id, groupIds: (result.ids || []).join(','),
    };
    appendRow('messages', row);
    return { method: row.method, result: row.result, ok: result.ok, fail: result.fail, log: msgOut(row) };
  },

  listMessages: function (req, me) {
    var mine = scopeOf(me);   // 강사는 본인이 보낸 문자 기록만 (다른 반 학생 이름·번호가 담겨 있다)
    var rows = readRows('messages').filter(function (r) { return !mine || r.sentBy === me.id; }).map(msgOut);
    rows.sort(function (a, b) { return a.sentAt < b.sentAt ? 1 : -1; });
    return rows.slice(0, Math.min(200, num(req.limit) || 100));
  },
};

// ---------- 문자 발송 (알리고 · 솔라피) ----------
function sendViaProvider(cfg, list) { return cfg.provider === 'solapi' ? sendViaSolapi(cfg, list) : sendViaAligo(cfg, list); }
/** 알리고: 같은 내용끼리 묶어 receiver 를 콤마로 최대 100명씩. 응답 result_code 1 이면 성공 */
function sendViaAligo(cfg, list) {
  var ok = 0, failN = 0, detail = '', groups = {}, ids = [];
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
        if (String(out.result_code) === '1') { ok += num(out.success_cnt) || chunk.length; failN += num(out.error_cnt) || 0; if (out.msg_id) ids.push(String(out.msg_id)); }
        else { failN += chunk.length; detail = String(out.message || out.result_code || res.getResponseCode()); }
      } catch (e) { failN += chunk.length; detail = String(e.message || e); }
    }
  });
  return { ok: ok, fail: failN, detail: detail, ids: ids };   // ids: 알리고 msg_id (발송 조회용)
}
/** 솔라피(쿨SMS) HMAC-SHA256 인증 헤더 */
function solapiAuth(cfg) {
  var date = new Date().toISOString(), salt = Utilities.getUuid().replace(/-/g, '');
  var sig = Utilities.computeHmacSha256Signature(date + salt, cfg.secret).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  return 'HMAC-SHA256 apiKey=' + cfg.key + ', date=' + date + ', salt=' + salt + ', signature=' + sig;
}
/** 솔라피: 한 요청에 여러 건(각자 내용). 응답 groupInfo.count 와 failedMessageList 로 성공/실패를 센다 */
function sendViaSolapi(cfg, list) {
  var ok = 0, failN = 0, detail = '', ids = [];
  for (var i = 0; i < list.length; i += 500) {
    var chunk = list.slice(i, i + 500);
    try {
      var msgs = chunk.map(function (r) { var lms = smsBytes(r.body) > 90; return { to: r.phone, from: cfg.sender, text: r.body, type: lms ? 'LMS' : 'SMS', subject: lms ? cfg.title : undefined }; });
      var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', {
        method: 'post', muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: solapiAuth(cfg) }, payload: JSON.stringify({ messages: msgs }),
      });
      var code = res.getResponseCode(), out = JSON.parse(res.getContentText() || '{}');
      if (code >= 200 && code < 300) { if (out.groupInfo && out.groupInfo._id) ids.push(String(out.groupInfo._id)); var failed = (out.failedMessageList || []).length; failN += failed; ok += chunk.length - failed; if (failed && out.failedMessageList[0]) detail = String(out.failedMessageList[0].errorMessage || out.failedMessageList[0].statusMessage || ''); }
      else { failN += chunk.length; detail = String(out.errorMessage || out.errorCode || code); }
    } catch (e) { failN += chunk.length; detail = String(e.message || e); }
  }
  return { ok: ok, fail: failN, detail: detail, ids: ids };   // ids: 솔라피 groupId
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
  appendRow('messages', { id: newId('M'), sentAt: new Date().toISOString(), kind: '테스트', count: 1, recipients: '테스트:' + phone, body: body, method: cfg.provider, result: '성공 ' + r.ok + ' / 실패 ' + r.fail + (r.detail ? ' · ' + r.detail : ''), groupIds: (r.ids || []).join(','), sentBy: me.id });
  return { ok: r.ok, fail: r.fail, detail: r.detail, provider: SMS_PROVIDERS[cfg.provider] };
};
ACADEMY_ACTIONS.smsRemain = function (req, me) { requireAdmin(me); return smsRemainOf(smsConfig()); };
/**
 * 문자 서비스에 등록된 발신번호 목록(관리자). 대표번호를 바꾼 뒤 그 번호가 실제로 등록됐는지,
 * 지금 앱이 쓰는 발신번호가 그 목록에 있는지 확인할 때 쓴다. (솔라피만 조회 가능)
 */
ACADEMY_ACTIONS.smsSenders = function (req, me) {
  requireAdmin(me);
  var cfg = smsConfig();
  var cur = phoneStr(cfg.sender);
  if (!cfg.key) fail('bad_request', '문자 API가 아직 설정되지 않았습니다. 먼저 저장하세요.');
  if (cfg.provider !== 'solapi') {
    return { provider: cfg.provider, providerName: SMS_PROVIDERS[cfg.provider] || '', supported: false, current: cur, registered: null, numbers: [],
      note: '알리고는 발신번호 목록 조회 API가 없습니다. 알리고 홈페이지에서 발신번호를 확인한 뒤 위 칸에 같은 번호를 넣으세요.' };
  }
  var res = UrlFetchApp.fetch('https://api.solapi.com/senderid/v1/numbers?limit=100', { method: 'get', muteHttpExceptions: true, headers: { Authorization: solapiAuth(cfg) } });
  var code = res.getResponseCode(), out = {};
  try { out = JSON.parse(res.getContentText() || '{}'); } catch (e) { out = {}; }
  if (code >= 300) fail('bad_request', '솔라피 응답: ' + (out.errorMessage || out.errorCode || code));
  var raw = Array.isArray(out) ? out : (out.numberList || out.list || out.data || out.senderIds || []);
  var numbers = raw.map(function (n) {
    return {
      phone: phoneStr(n.phoneNumber || n.number || n.sender || n.senderId || ''),
      status: str(n.status || n.state || '', 20),
      memo: str(n.memo || n.comment || n.name || '', 60),
      at: String(n.dateCreated || n.createdAt || n.dateUpdated || '').slice(0, 10),
    };
  }).filter(function (n) { return n.phone; });
  return { provider: 'solapi', providerName: SMS_PROVIDERS.solapi, supported: true, current: cur,
    registered: numbers.some(function (n) { return n.phone === cur; }), numbers: numbers };
};

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
function makeupOut(r) {
  return {
    id: r.id, date: r.date, start: r.start || '', end: r.end || '', classId: r.classId || '', teacherId: r.teacherId || '',
    studentIds: String(r.studentIds || '').split(',').filter(function (x) { return x; }),
    title: r.title || '', reason: r.reason || '', memo: r.memo || '', status: r.status || '예정',
    notifiedAt: r.notifiedAt || '', remindedAt: r.remindedAt || '', createdAt: r.createdAt || '', createdBy: r.createdBy || '', updatedAt: r.updatedAt || '',
    people: mkPeople(r),   // 보강 학생의 이름·학교·학년만 (다른 반 학생이 섞인 보강도 담당 선생님이 출결을 체크할 수 있게 · 연락처는 주지 않는다)
  };
}
var MK_PEOPLE = null;
function mkPeople(r) {
  var want = {}; String(r.studentIds || '').split(',').forEach(function (x) { if (x) want[x] = 1; });
  if (!Object.keys(want).length) return [];
  if (!MK_PEOPLE || MK_PEOPLE.rc !== ROW_CACHE) { var byId0 = {}; readRows('students').forEach(function (s) { byId0[s.id] = { id: s.id, name: s.name, school: s.school || '', grade: s.grade || '' }; }); MK_PEOPLE = { rc: ROW_CACHE, byId: byId0 }; }   // 요청마다 한 번만 만든다
  var byId = MK_PEOPLE.byId;
  return Object.keys(want).map(function (id) { return byId[id]; }).filter(Boolean);
}
/** 소프트 삭제된 것을 뺀 보강 (모든 조회는 이 함수를 쓴다) */
function readMakeups() { return readRows('makeups').filter(function (r) { return !isDeleted(r); }); }
/** 삭제 표시까지 포함해 한 건 찾기 (되살리기·수정 검사용) */
function findMakeup(id) { return findRow('makeups', String(id || '')); }
function makeupSort(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || '') < (b.start || '') ? -1 : (a.start || '') > (b.start || '') ? 1 : 0; }
function makeupsIn(from, to, me) {
  var sc = scopeOf(me);
  return readMakeups().filter(function (r) { return r.date >= from && r.date <= to && canMakeup(sc, r); }).map(makeupOut).sort(makeupSort);
}
/**
 * 강사가 볼 수 있는 보강: 담당 반의 보강 · 내가 담당으로 잡힌 보강 · 지금 내 반에서 배우는 학생이 들어간 보강.
 * (예전에는 지난 이력의 학생까지 쳐서, 옛날에 잠깐 가르친 학생이 낀 다른 선생님 보강이 내 목록에 떴다)
 */
function canMakeup(sc, r) {
  if (!sc) return true;
  if (r.classId && sc.classIds[r.classId]) return true;
  if (r.teacherId === sc.memberId) return true;
  return String(r.studentIds || '').split(',').some(function (id) { return id && sc.activeIds[id]; });
}
/** 한 학생의 보강 일정 (취소 제외, fromDate 부터) */
/** 한 학생의 보강. withCancelled 면 취소한 것까지 (기록 확인용) */
function makeupsOfStudent(studentId, fromDate, me, withCancelled) {
  var sc = scopeOf(me);
  return readMakeups().filter(function (r) {
    return String(r.studentIds || '').split(',').indexOf(studentId) >= 0 && (!fromDate || r.date >= fromDate)
      && (withCancelled || (r.status || '예정') !== '취소') && canMakeup(sc, r);
  }).map(makeupOut).sort(makeupSort);
}
/** 학생·학부모가 링크로 보는 보강 일정 (학생 ID 는 드러내지 않는다) */
function pubMakeupOut(m) {
  var c = m.classId ? findRow('classes', m.classId) : null, t = m.teacherId ? findMember(m.teacherId) : null;
  return { date: m.date, start: m.start, end: m.end, title: m.title || (c ? c.name : '') || '보강', reason: m.reason, memo: m.memo, teacher: t ? t.name : '', status: m.status };
}
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
  requireAdmin(me);   // 전체 학생을 학생관리부 시트에 덮어쓰는 작업이라 원장만 (v37 부터 · 이전에는 강사도 가능했다)
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
/** 수강 목록. 강사는 담당 반 + 담당 학생의 수강만 (me 를 안 주면 제한 없음 — 내부 계산용) */
function enrollmentsOut(me) {
  var sc = scopeOf(me);
  return readEnr().filter(function (r) { return !sc || (sc.classIds[r.classId] && sc.studentIds[r.studentId]); }).map(enrollOut);
}
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
  var mode = EXAM_MODES.indexOf(String(r.mode || '')) >= 0 ? String(r.mode) : 'q';   // 빈 값 = 예전 시험 = 문항별
  return { id: r.id, date: r.date, classId: r.classId || '', classIds: ids, name: r.name, maxScore: num(r.maxScore) || 100, memo: r.memo || '',
    questions: parseQuestions(r.questions), mode: mode, objMax: num(r.objMax), essayMax: num(r.essayMax) };
}
/** 문항 설정 JSON → [{n, unit, type, pts}] (배점이 없으면 만점을 문항 수로 나눠 쓴다) */
function parseQuestions(v) { try { var a = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []); return Array.isArray(a) ? a.map(function (q, i) { return { n: Number(q.n) || i + 1, unit: str(q.unit, 40), type: str(q.type, 30), pts: num(q.pts) || 0, part: q.part === '서술형' ? '서술형' : '객관식' }; }) : []; } catch (e) { return []; } }
/** 서술형 문항별 획득 점수 [{n, got}] */
function parseParts(v) { try { var a = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []); return Array.isArray(a) ? a.map(function (x) { return { n: Number(x.n) || 0, got: num(x.got) }; }).filter(function (x) { return x.n > 0; }) : []; } catch (e) { return []; } }
function parseWrong(v) { try { var a = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []); return Array.isArray(a) ? a.map(function (w) { return typeof w === 'number' ? { n: w, kind: '' } : { n: Number(w.n) || 0, kind: WRONG_KINDS.indexOf(w.kind) >= 0 ? w.kind : '' }; }).filter(function (w) { return w.n > 0; }) : []; } catch (e) { return []; } }
var WRONG_KINDS = ['개념', '계산', '오독', '시간', '유형'];
/** 문항 한 개의 배점 (배점을 안 넣은 시험은 만점/문항수로 고르게) */
function qPoints(exam, q) { var qs = exam.questions || []; if (!qs.length) return 0; return qs.some(function (x) { return x.pts > 0; }) ? num(q.pts) : exam.maxScore / qs.length; }
/** 구분별 만점 { obj, essay, total } — 객관식·서술형 비중이 여기서 나온다 */
function examPartMax(exam) {
  var r = function (v) { return Math.round(v * 10) / 10; };
  if (exam.mode === 'parts') return { obj: r(num(exam.objMax)), essay: r(num(exam.essayMax)), total: r(num(exam.objMax) + num(exam.essayMax)) };   // 직접 입력한 구분 배점
  if (exam.mode === 'total') return { obj: 0, essay: 0, total: 0 };   // 전체 점수만 — 구분이 없다
  var o = { obj: 0, essay: 0, total: 0 };
  (exam.questions || []).forEach(function (q) { var p = qPoints(exam, q); o.total += p; if (q.part === '서술형') o.essay += p; else o.obj += p; });
  return { obj: r(o.obj), essay: r(o.essay), total: r(o.total) };
}
/** 문항 설정을 실제로 쓰는 시험인가 (문항별 채점 방식일 때만) */
function examQs(exam) { return exam.mode === 'q' || !exam.mode ? (exam.questions || []) : []; }
/** 틀린 객관식 배점 합 */
function wrongPoints(exam, wrong) { var qs = exam.questions || []; if (!qs.length) return 0; var byN = {}; qs.forEach(function (q) { byN[q.n] = q; }); return wrong.reduce(function (a, w) { var q = byN[w.n]; return a + (q && q.part !== '서술형' ? qPoints(exam, q) : 0); }, 0); }
/**
 * 학생 한 명의 점수 계산: 객관식 = 객관식 만점 − 틀린 배점, 서술형 = 문항별 획득 점수 합 (안 적은 문항은 만점 처리하지 않고 0으로 두지 않도록
 * "입력한 문항만" 더하고, 서술형이 있는데 하나도 안 적었으면 서술형은 null 로 둔다). 총점 = 객관식 + 서술형
 */
function computeScore(exam, wrong, parts) {
  var qs = examQs(exam); if (!qs.length) return { obj: null, essay: null, total: null };
  var mx = examPartMax(exam), byN = {}; qs.forEach(function (q) { byN[q.n] = q; });
  var obj = mx.obj > 0 ? Math.max(0, mx.obj - wrongPoints(exam, wrong)) : 0;
  var essay = null;
  if (mx.essay > 0) { var got = 0, any = false; parts.forEach(function (x) { var q = byN[x.n]; if (q && q.part === '서술형') { got += Math.max(0, Math.min(qPoints(exam, q), x.got)); any = true; } }); essay = any ? got : 0; }
  var r = function (v) { return v == null ? null : Math.round(v * 10) / 10; };
  return { obj: mx.obj > 0 ? r(obj) : null, essay: r(essay), total: r(obj + (essay || 0)) };
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
    var qs = examQs(exam), byN = {}; qs.forEach(function (q) { byN[q.n] = q; });
    var wrong = parseWrong(r.wrong).map(function (w) { var q = byN[w.n] || {}; return { n: w.n, kind: w.kind, unit: q.unit || '', type: q.type || '', part: q.part || '객관식' }; });
    var parts = parseParts(r.parts), c = computeScore(exam, wrong, parts);
    var score = v == null || isNaN(v) ? null : v;
    var objS, essayS;
    if (exam.mode === 'parts') {   // 객관식·서술형 점수를 직접 입력한 시험
      objS = r.obj === '' || r.obj == null ? null : num(r.obj);
      essayS = r.essay === '' || r.essay == null ? null : num(r.essay);
    } else { objS = score == null ? null : c.obj; essayS = score == null ? null : c.essay; }
    return { id: r.id, studentId: r.studentId, score: score, note: r.note || '', classId: scoreClassOf(r, exam, ctx), wrong: wrong, parts: parts,
      objScore: objS, essayScore: essayS };
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
  // 구분(객관식·서술형)별 만점과 평균
  var pm = examPartMax(exam), avgOf = function (key) { var v = scored.map(function (r) { return r[key]; }).filter(function (x) { return x != null; }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10 : null; };
  var byPart = pm.total > 0 ? [{ part: '객관식', max: pm.obj, avg: avgOf('objScore') }, { part: '서술형', max: pm.essay, avg: avgOf('essayScore') }].filter(function (x) { return x.max > 0; }) : [];
  byClass.sort(function (a, b) { return (a.classId === '' ? 1 : 0) - (b.classId === '' ? 1 : 0) || a.className.localeCompare(b.className, 'ko'); });
  var classAvg = {}; byClass.forEach(function (c) { classAvg[c.classId] = c.avg; });
  rows.forEach(function (r) {
    r.className = className(r.classId); r.classAvg = classAvg[r.classId] == null ? null : classAvg[r.classId];
    r.rank = r.score == null ? null : 1 + scored.filter(function (o) { return o.score > r.score; }).length;
    r.tie = r.score != null && scored.filter(function (o) { return o.score === r.score; }).length > 1;
  });
  // 문항별 오답 수·정답률 (점수가 있는 응시자 기준), 단원별 정답률
  var qstats = examQs(exam).map(function (q) {
    var pts = qPoints(exam, q);
    if (q.part === '서술형') {   // 서술형은 평균 득점률
      var got = [], sum = 0; scored.forEach(function (r) { var x = null; r.parts.forEach(function (p) { if (p.n === q.n) x = p; }); if (x) { got.push(x.got); sum += x.got; } });
      return { n: q.n, unit: q.unit, type: q.type, part: '서술형', pts: pts, wrong: 0, n_scored: got.length, avg: got.length ? Math.round(sum / got.length * 10) / 10 : null, rate: got.length && pts > 0 ? Math.round(sum / got.length / pts * 100) : null };
    }
    var w = scored.filter(function (r) { return r.wrong.some(function (x) { return x.n === q.n; }); }).length;
    return { n: q.n, unit: q.unit, type: q.type, part: '객관식', pts: pts, wrong: w, n_scored: scored.length, rate: scored.length ? Math.round((scored.length - w) / scored.length * 100) : null };
  });
  var ustats = {}; qstats.forEach(function (q) { var k = q.unit || '(단원 없음)'; var u = ustats[k] || (ustats[k] = { unit: k, questions: 0, wrong: 0, attempts: 0 }); u.questions++; u.wrong += q.wrong; u.attempts += q.n_scored; });
  var byUnit = Object.keys(ustats).map(function (k) { var u = ustats[k]; u.rate = u.attempts ? Math.round((u.attempts - u.wrong) / u.attempts * 100) : null; return u; }).sort(function (a, b) { return (a.rate == null ? 101 : a.rate) - (b.rate == null ? 101 : b.rate); });
  return { participants: rows.length, overall: overall, byClass: byClass, rows: rows, questionStats: qstats, byUnit: byUnit, byPart: byPart, partMax: pm };
}
/**
 * 시험 상세. 강사(me 가 강사)면 학생 줄과 반별 통계는 담당 범위만 내려간다.
 * 전체 평균·응시자 수 같은 집계값은 개인 정보가 아니라 그대로 둔다 (성적표·순위 계산이 기존과 같아야 하므로).
 */
function examDetailOut(examId, me) {
  var e = findRow('exams', examId); if (!e) fail('bad_request', '없는 시험입니다.');
  var exam = examOut(e), ctx = examCtx(), st = examStats(exam, readRows('scores').filter(function (r) { return r.examId === examId; }), ctx);
  var students = {}; readRows('students').forEach(function (x) { students[x.id] = x; });
  st.rows.forEach(function (r) { var s = students[r.studentId]; r.name = s ? s.name : '(삭제된 학생)'; r.grade = s ? s.grade || '' : ''; r.status = s ? s.status || '' : ''; });
  var sc = scopeOf(me);
  if (sc) { st.rows = st.rows.filter(function (r) { return canStudent(sc, r.studentId); }); st.byClass = st.byClass.filter(function (c) { return canClass(sc, c.classId); }); }
  st.rows.sort(function (a, b) { return (a.score == null ? 1 : 0) - (b.score == null ? 1 : 0) || (b.score || 0) - (a.score || 0) || String(a.name).localeCompare(String(b.name), 'ko'); });
  return { exam: exam, participants: st.participants, overall: st.overall, byClass: st.byClass, rows: st.rows, questionStats: st.questionStats, byUnit: st.byUnit, byPart: st.byPart, partMax: st.partMax };
}
/** 학생 한 명의 시험별 성적: 내 점수 · 응시 당시 반 · 반 평균 · 전체 평균 · 전체 순위(동점 공동) · 응시자 수 */
function studentScoresOut(studentId, me) {
  var mine = readRows('scores').filter(function (r) { return r.studentId === studentId; }); if (!mine.length) return [];
  var exams = {}; readRows('exams').forEach(function (e) { exams[e.id] = examOut(e); });
  var byExam = {}; readRows('scores').forEach(function (r) { if (exams[r.examId]) (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
  var ctx = examCtx(), out = [];
  mine.forEach(function (r) {
    var e = exams[r.examId]; if (!e) return;
    var st = examStats(e, byExam[r.examId] || [], ctx), me = null; st.rows.forEach(function (x) { if (x.studentId === studentId) me = x; }); if (!me) return;
    var cs = null; st.byClass.forEach(function (c) { if (c.classId === me.classId) cs = c; });
    out.push({ examId: e.id, examName: e.name, date: e.date, maxScore: e.maxScore, score: me.score, note: me.note, classId: me.classId, className: me.className,
      classAvg: me.classAvg, classN: cs ? cs.n : 0, avg: st.overall.avg, total: st.overall.n, participants: st.participants, rank: me.rank, tie: me.tie, wrong: me.wrong, questions: examQs(e).length, mode: e.mode, objScore: me.objScore, essayScore: me.essayScore, partMax: examPartMax(e) });
  });
  out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  return out;
}
function consultOut(r) {
  return { id: r.id, date: r.date, time: r.time || '', type: r.type || '', studentId: r.studentId || '', name: r.name || '', phone: r.phone || '',
    school: r.school || '', grade: r.grade || '', content: r.content || '', nextDate: r.nextDate || '', memberId: r.memberId || '', createdAt: r.createdAt || '', updatedAt: r.updatedAt || '' };
}
function msgOut(r) { return { id: r.id, sentAt: r.sentAt, kind: r.kind || '', count: num(r.count), recipients: r.recipients || '', body: r.body || '', method: r.method || '', result: r.result || '', sentBy: r.sentBy || '', delivery: r.delivery || '', deliveryAt: r.deliveryAt || '' }; }

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

// ---------- 강사 권한 범위 (관리자는 제한 없음) ----------
/**
 * 강사는 "자기 담당 반 + 그 반에 수강 기록이 있는 학생"만 보고 고칠 수 있다.
 * 화면에서 감추는 것이 아니라 서버가 응답에서 빼기 때문에, 다른 teacherId·classId·studentId 를 직접 넣어 불러도 나오지 않는다.
 * 관리자(role='admin')는 null 을 돌려줘 아무 제한도 걸지 않는다 (기존 동작 그대로).
 * studentIds 는 지난 수강 이력까지 포함한다 (내 반을 다녔던 학생의 출결·성적 이력을 계속 볼 수 있도록).
 */
function scopeOf(me) {
  if (!me || me.role === 'admin') return null;
  var classIds = {}, studentIds = {}, activeIds = {}, t = todayStr();
  readRows('classes').forEach(function (c) { if (c.teacherId === me.id) classIds[c.id] = 1; });
  readRows('enrollments').forEach(function (e) {
    if (!classIds[e.classId] || isDeleted(e)) return;   // 지운 수강 기록은 범위에 넣지 않는다
    studentIds[e.studentId] = 1;                            // 지난 이력 포함 (기록·출결·성적 조회용)
    if (!e.endDate || e.endDate >= t) activeIds[e.studentId] = 1;   // 지금 내 반에서 배우는 학생
  });
  return { memberId: me.id, classIds: classIds, studentIds: studentIds, activeIds: activeIds };
}
function canClass(sc, id) { return !sc || !!sc.classIds[String(id == null ? '' : id)]; }
/** 출결 행을 볼 수 있는지: 반 출결은 담당 반, 보강 출결(classId 자리에 보강 id)은 볼 수 있는 보강 */
function attVisible(sc) {
  if (!sc) return function () { return true; };
  var mk = null;
  return function (r) {
    if (canClass(sc, r.classId)) return true;
    if (!mk) { mk = {}; readMakeups().forEach(function (m) { if (canMakeup(sc, m)) mk[m.id] = 1; }); }
    return !!mk[r.classId];
  };
}
function canStudent(sc, id) { return !sc || !!sc.studentIds[String(id == null ? '' : id)]; }
function denyScope(what) { fail('forbidden', '담당하지 않는 ' + (what || '반·학생') + ' 정보입니다. 원장님께 문의하세요.'); }
function requireClass(me, id) { if (!canClass(scopeOf(me), id)) denyScope('반'); }
function requireStudent(me, id) { if (!canStudent(scopeOf(me), id)) denyScope('학생'); }
/** 강사가 볼 수 있는 시험 id 집합 (담당 반이 들어간 시험 + 담당 학생이 응시한 시험). 관리자는 null */
function visibleExamIds(sc) {
  if (!sc) return null;
  var ids = {};
  readRows('exams').forEach(function (e) {
    String(e.classIds || e.classId || '').split(',').forEach(function (c) { if (c && sc.classIds[c]) ids[e.id] = 1; });
  });
  readRows('scores').forEach(function (r) { if (sc.studentIds[r.studentId]) ids[r.examId] = 1; });
  return ids;
}
function requireExam(me, examId) { var sc = scopeOf(me); if (sc && !visibleExamIds(sc)[String(examId || '')]) denyScope('시험'); }
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
ACADEMY_SHEETS.mkRequests = ['id', 'createdAt', 'teacherId', 'names', 'date', 'start', 'end', 'title', 'note', 'status', 'handledBy', 'handledAt', 'makeupId', 'reply'];   // 강사 → 원장 보강 요청 (names: 학생 이름 자유 입력 — 다른 반 학생 ID 를 강사에게 내려주지 않는다) · status 대기|처리|반려
ACADEMY_SHEETS.events    = ['id', 'date', 'type', 'title', 'target', 'note', 'createdAt', 'updatedAt', 'endDate', 'school'];   // endDate: 여러 날 걸치는 일정(학교 시험기간 등)의 마지막 날 · school: 학교 이름 (시험기간을 학교별로 묶어 본다)
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
var ADMIN_DATE_COLS = { date: 1, lastIn: 1, paidAt: 1, endDate: 1 };
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
  b.makeups = makeupsIn(addDaysStr(todayStr(), -400), addDaysStr(todayStr(), 400), me);   // 달력에 보강 일정을 함께 그린다 (makeups 시트 하나만 보므로 중복 생성이 없다)
  b.meta = adminMeta();
  b.examResults = allExamResultsOut();   // 학원관리 성적(시험·점수)을 학생별로 — 기록카드에서 같이 보인다 (같은 시트, 따로 저장하지 않음)
  b.staffToday = staffTodayOut();         // 원장실 홈 "오늘 선생님 출근" (근무일지와 같은 logs 시트를 읽기만 한다)
  try {   // 원장실 홈 "지금 확인할 것": 오늘 미출결 (미출결 확인 기록을 읽기만 한다)
    var aw = { n: 0, stage2: 0, 미등원: 0, 지각출석: 0, names: [] };
    attRowsOf(todayStr()).forEach(function (r) { if (r.status === '확인필요') { aw.n++; if (r.alert2At) aw.stage2++; if (aw.names.length < 5) aw.names.push(r.studentName); } else if (aw[r.status] != null) aw[r.status]++; });
    b.attWatch = aw;
  } catch (e) { b.attWatch = null; }
  return b;
};
/**
 * 오늘 선생님 출퇴근 현황 (원장실 홈). logs 시트를 그대로 읽어 활동 중인 아이디마다 한 줄씩 준다.
 * 태블릿에서 찍었으면 device 에 태블릿 이름이 들어간다 (updatedBy = "kiosk:이름")
 */
function staffTodayOut() {
  var t = todayStr(), logs = {};
  readRowsSince('logs', t, 200).forEach(function (r) { if (r.date === t) logs[r.memberId] = r; });
  return readRows('members').filter(function (m) { return m.active !== false; }).map(function (m) {
    var l = logs[m.id] || {}, by = String(l.updatedBy || '');
    return { id: m.id, name: m.name, color: m.color || '', role: m.role || '',
      checkIn: l.checkIn || '', checkOut: l.checkOut || '', work: l.work || '',
      device: by.slice(0, 6) === 'kiosk:' ? by.slice(6) : '', fixed: !!l.fixedBy };
  }).sort(function (a, b) {
    var ra = a.checkIn ? (a.checkOut ? 1 : 0) : 2, rb = b.checkIn ? (b.checkOut ? 1 : 0) : 2;
    return ra - rb || String(a.checkIn || '99:99').localeCompare(String(b.checkIn || '99:99')) || String(a.name).localeCompare(String(b.name), 'ko');
  });
}
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
  if (name === 'events') {   // 기간 일정: 끝나는 날이 시작보다 빠르면 거절 (하루짜리는 endDate 를 비워 둔다)
    if (row.endDate && row.endDate < row.date) fail('bad_request', '끝나는 날이 시작하는 날보다 빠릅니다.');
    if (row.endDate === row.date) row.endDate = '';
  }
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
/** 기기의 '마지막 사용' 시각. 학생마다 설정 시트를 읽고 쓰면 한 건에 1초 넘게 걸리므로 10분에 한 번만 적는다 */
function kioskTouch(dev, now) {
  try {
    var c = CacheService.getScriptCache(), k = 'kioskTouch:' + dev.token; if (c.get(k)) return; c.put(k, '1', 600);
    var list = kioskDevices(); list.forEach(function (d) { if (d.token === dev.token) d.lastUsed = now; });
    upsertRow('settings', 'key', { key: 'kioskDevices', value: JSON.stringify(list) });
  } catch (e) {}
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
  readMakeups().forEach(function (m) {   // 오늘 보강도 후보 (가장 가까운 시각의 수업에 출석을 적는다 · 보강 출결은 보강 id 로)
    if (m.date !== t || (m.status || '예정') === '취소' || String(m.studentIds || '').split(',').indexOf(studentId) < 0) return;
    var c = m.classId ? classes[m.classId] : null;
    cands.push({ c: { id: m.id, name: '보강 ' + (m.title || (c ? c.name : '') || '') }, start: m.start || '', end: m.end || '', makeup: true });
  });
  cands.sort(function (a, b) { var da = a.start ? Math.abs(hm2min(a.start) - hm2min(now)) : 9999, db = b.start ? Math.abs(hm2min(b.start) - hm2min(now)) : 9999; return da - db; });
  return cands[0] || null;
}
function hm2min(t) { var p = String(t || '').split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
/* ---------- 보강 요청 (강사 → 원장) ----------
 * 강사는 담당 반 학생만 볼 수 있으므로 다른 반 학생 보강이 필요하면 이름·날짜·내용을 적어 원장에게 요청한다.
 * 원장은 학원관리 [보강 → 요청] 에서 그대로 보강을 등록하거나(요청이 "처리"로 바뀌고 보강과 연결) 반려한다. */
function mkRequestOut(r) {
  return { id: r.id, createdAt: r.createdAt || '', teacherId: r.teacherId || '', names: r.names || '', date: r.date || '', start: r.start || '', end: r.end || '',
    title: r.title || '', note: r.note || '', status: r.status || '대기', handledBy: r.handledBy || '', handledAt: r.handledAt || '', makeupId: r.makeupId || '', reply: r.reply || '' };
}
function mkRequestsFor(me) {
  var since = addDaysStr(todayStr(), me.role === 'admin' ? -30 : -90);
  return readRows('mkRequests').filter(function (r) {
    if (me.role !== 'admin' && r.teacherId !== me.id) return false;
    return (r.status || '대기') === '대기' || String(r.handledAt || r.createdAt || '').slice(0, 10) >= since;
  }).map(mkRequestOut).sort(function (a, b) {
    var pa = a.status === '대기' ? 0 : 1, pb = b.status === '대기' ? 0 : 1;
    return pa - pb || String(b.createdAt).localeCompare(String(a.createdAt));
  });
}
ACADEMY_ACTIONS.mkRequest = function (req, me) {
  var r = req.request || {};
  var names = str(r.names, 200).replace(/\s*[,\u3001\n]\s*/g, ', ').replace(/^, |, $/g, '').trim();
  if (!names) fail('bad_request', '학생 이름을 넣으세요.');
  var date = str(r.date, 10); if (date && !isDate(date)) fail('bad_request', '날짜 형식이 잘못되었습니다.');
  var start = str(r.start, 5), end = str(r.end, 5);
  if ((start && !isTime(start)) || (end && !isTime(end))) fail('bad_request', '시간 형식이 잘못되었습니다.');
  var row = { id: newId('W'), createdAt: new Date().toISOString(), teacherId: me.id, names: names, date: date, start: start, end: end,
    title: str(r.title, 60), note: str(r.note, 500), status: '대기', handledBy: '', handledAt: '', makeupId: '', reply: '' };
  upsertRow('mkRequests', 'id', row);
  return mkRequestOut(row);
};
ACADEMY_ACTIONS.listMkRequests = function (req, me) { return mkRequestsFor(me); };
/** 원장이 처리(보강과 연결) 또는 반려. 강사는 자기 요청을 취소(반려 상태로)할 수 있다 */
ACADEMY_ACTIONS.handleMkRequest = function (req, me) {
  var r = readRows('mkRequests').filter(function (x) { return x.id === String(req.id || ''); })[0];
  if (!r) fail('bad_request', '없는 요청입니다.');
  var status = String(req.status || '');
  if (me.role !== 'admin') {
    if (r.teacherId !== me.id) fail('forbidden', '다른 선생님의 요청입니다.');
    if (status !== '취소' || (r.status || '대기') !== '대기') fail('bad_request', '대기 중인 내 요청만 취소할 수 있습니다.');
  } else if (['처리', '반려'].indexOf(status) < 0) fail('bad_request', '처리 또는 반려만 할 수 있습니다.');
  r.status = status; r.handledBy = me.id; r.handledAt = new Date().toISOString();
  r.reply = str(req.reply, 300); if (req.makeupId) r.makeupId = String(req.makeupId);
  upsertRow('mkRequests', 'id', r);
  return mkRequestOut(r);
};
ACADEMY_ACTIONS.kioskSettings = function (req, me) {
  requireAdmin(me);
  return { pinSet: !!kioskSetting('kioskPin', ''), sms: kioskSetting('kioskSms', 'on') !== 'off', msgIn: kioskSetting('kioskMsgIn', KIOSK_MSG_IN), msgOut: kioskSetting('kioskMsgOut', KIOSK_MSG_OUT), staffPin: askStaffPin(),
    devices: kioskDevices().map(function (d) { return { name: d.name, createdAt: d.createdAt, lastUsed: d.lastUsed || '', tokenTail: '····' + String(d.token).slice(-4) }; }), smsReady: smsReady(smsConfig()) };
};
ACADEMY_ACTIONS.saveKioskSettings = function (req, me) {
  requireAdmin(me);
  if (req.pin != null && String(req.pin) !== '') { var pin = String(req.pin).replace(/\D/g, ''); if (pin.length < 4 || pin.length > 8) fail('bad_request', 'PIN 은 숫자 4~8자리입니다.'); upsertRow('settings', 'key', { key: 'kioskPin', value: pin }); }
  if (req.sms != null) upsertRow('settings', 'key', { key: 'kioskSms', value: req.sms === false || req.sms === 'off' ? 'off' : 'on' });
  if (req.staffPin != null) upsertRow('settings', 'key', { key: 'kioskStaffPin', value: req.staffPin === true || req.staffPin === 'on' ? 'on' : 'off' });   // 기본은 off (뒷자리 4개만으로 바로 찍음)
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
/** 태블릿에서 선생님 출퇴근 때 근무번호를 한 번 더 물을지 (기본 off — 학생과 똑같이 뒷자리 4개만 누르면 바로 찍힌다) */
function askStaffPin() { return kioskSetting('kioskStaffPin', 'off') === 'on'; }
/**
 * [로그인 없음·기기 토큰] 번호 뒷자리 4개로 찾기.
 * 학생(본인·학부모 번호)과 선생님(휴대폰 번호)을 한 번에 찾아 준다 — 태블릿에서는 번호만 누르면 된다.
 * who: 'student' | 'staff'. 선생님은 오늘 출근·퇴근 시각과 근무번호 필요 여부(pinSet)를 같이 준다
 */
ACADEMY_ACTIONS.kioskLookup = function (req) {
  kioskDevice(req);
  var d = String(req.digits || '').replace(/\D/g, ''); if (d.length !== 4) fail('bad_request', '뒷자리 4개를 누르세요.');
  var t = todayStr(), today = {}; readRowsSince('checkins', t, 600).forEach(function (r) { if (r.date === t) today[r.studentId] = (today[r.studentId] || []).concat([r]); });
  var out = readRows('students').filter(function (s) { return s.status === '재원' && (phoneStr(s.phone).slice(-4) === d || phoneStr(s.parentPhone).slice(-4) === d); })
    .map(function (s) {
      var mine = (today[s.id] || []).sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); }), last = mine[mine.length - 1];
      return { who: 'student', id: s.id, name: s.name, grade: s.grade || '', school: s.school || '', hasParent: !!phoneStr(s.parentPhone), lastKind: last ? last.kind : '', lastTime: last ? last.time : '', next: last && last.kind === '등원' ? '하원' : '등원' };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  var logs = {}, askPin = askStaffPin(); readRowsSince('logs', t, 200).forEach(function (r) { if (r.date === t) logs[r.memberId] = r; });
  readRows('members').filter(function (m) { return m.active !== false && phoneStr(m.phone).slice(-4) === d && phoneStr(m.phone); })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ko'); })
    .forEach(function (m) {
      var l = logs[m.id] || {};
      out.push({ who: 'staff', id: m.id, name: m.name, color: m.color || '', role: m.role, pinSet: askPin && !!m.pinHash,
        checkIn: l.checkIn || '', checkOut: l.checkOut || '', lastKind: l.checkOut ? '퇴근' : l.checkIn ? '출근' : '', lastTime: l.checkOut || l.checkIn || '',
        next: !l.checkIn ? '출근' : (l.checkOut ? '' : '퇴근') });
    });
  return out;
};
/** [로그인 없음·기기 토큰] 등원/하원 기록 + 출석부 반영 + 학부모 문자 */
ACADEMY_ACTIONS.kioskCheck = function (req) {
  var dev = kioskDevice(req), sid = String(req.studentId || ''), kind = req.kind === '하원' ? '하원' : '등원';
  var s = findRow('students', sid); if (!s || s.status !== '재원') fail('bad_request', '재원생이 아닙니다.');
  var t = todayStr(), hm = nowHM(), now = new Date().toISOString();
  var mine = readRowsSince('checkins', t, 600).filter(function (r) { return r.date === t && r.studentId === sid; }).sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  var last = mine[mine.length - 1];
  if (last && last.kind === kind && hm2min(hm) - hm2min(last.time) < 120) return { ok: true, dup: true, kind: kind, time: last.time, name: s.name, message: s.name + ' 학생은 ' + last.time + '에 이미 ' + kind + ' 처리되었습니다.' };
  // 출석부: 등원이면 오늘 수업 반에 출석/지각
  var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
  var cls = kioskClassToday(sid, classes), attNote = '';
  if (cls && kind === '등원') {
    var late = cls.start && hm2min(hm) > hm2min(cls.start) + 10, status = late ? '지각' : '출석';
    var ex = readRowsSince('attendance', t, 300).filter(function (r) { return r.date === t && r.classId === cls.c.id && r.studentId === sid; })[0];
    if (!ex || ex.status === '결석' || ex.status === '') { upsertRow('attendance', 'id', { id: ex ? ex.id : newId('A'), date: t, classId: cls.c.id, studentId: sid, status: status, note: '태블릿 등원 ' + hm, updatedBy: 'kiosk', updatedAt: now }); attNote = cls.c.name + ' ' + status; }
    else attNote = cls.c.name + ' ' + ex.status + ' (이미 입력됨)';
  }
  // 학부모 문자
  var smsNote = '', smsOn = kioskSetting('kioskSms', 'on') !== 'off', cfg = smsConfig();
  if (!smsOn) smsNote = '문자 끔';
  else if (!phoneStr(s.parentPhone)) smsNote = '학부모 번호 없음';
  else if (!smsReady(cfg)) smsNote = '문자 API 미설정';
  else smsNote = '문자 보내는 중';   // 실제 발송은 아래 afterLock 에서 (잠금을 푼 뒤) 한다
  var qid = newId('Q'), qrow = appendRow('checkins', { id: qid, date: t, time: hm, studentId: sid, kind: kind, classId: cls ? cls.c.id : '', device: dev.name, sms: smsNote, createdAt: now });
  if (kind === '등원') { try { attOnArrival(sid, t, hm, '태블릿'); } catch (e) {} }   // 미출결 확인 중이던 학생이면 도착(지각 몇 분)으로 바꾼다
  kioskTouch(dev, now);
  var out = { ok: true, kind: kind, time: hm, name: s.name, att: attNote, sms: smsNote, message: s.name + ' 학생 ' + kind + ' 완료 (' + hm + ')' };
  if (smsNote === '문자 보내는 중') {
    // 학부모 문자는 문자 서버 응답(1~3초)을 기다려야 해서, 다른 학생이 뒤에 줄 서지 않도록 스크립트 잠금을 푼 뒤에 보낸다.
    // 보낸 결과는 짧게 잠금을 다시 얻어 checkins 의 sms 칸과 messages 기록에 적는다
    var tpl = kioskSetting(kind === '등원' ? 'kioskMsgIn' : 'kioskMsgOut', kind === '등원' ? KIOSK_MSG_IN : KIOSK_MSG_OUT);
    var body = tpl.replace(/\{이름\}/g, s.name).replace(/\{시각\}/g, hm).replace(/\{날짜\}/g, t.slice(5).replace('-', '/')).replace(/\{반\}/g, cls ? cls.c.name : '');
    var phone = phoneStr(s.parentPhone), name = s.name, devName = dev.name;
    afterLock(function (data, lock) {
      var r; try { r = sendViaProvider(cfg, [{ name: name, phone: phone, body: body }]); } catch (e) { r = { ok: 0, fail: 1, detail: String(e.message || e) }; }
      var note = r.ok ? '문자 발송' : '문자 실패' + (r.detail ? ' · ' + r.detail : '');
      if (data) { data.sms = note; data.message = name + ' 학생 ' + kind + ' 완료 (' + hm + ')' + (note === '문자 발송' ? ' · 학부모님께 알림을 보냈습니다' : ''); }
      var got = false; try { got = lock.tryLock(15000); } catch (e) {}
      try {
        appendRow('messages', { id: newId('M'), sentAt: now, kind: '등하원', count: 1, recipients: name + ':' + phone, body: body, method: cfg.provider, result: '성공 ' + r.ok + ' / 실패 ' + r.fail + (r.detail ? ' · ' + r.detail : ''), groupIds: (r.ids || []).join(','), sentBy: 'kiosk:' + devName });
        var row = qrow; try { if (String(sheet('checkins').getRange(row, 1).getValue()) !== qid) row = (readRows('checkins').filter(function (x) { return x.id === qid; })[0] || {})._row; } catch (e) {}   // 그 사이 행이 밀렸으면 id 로 다시 찾는다
        setCell('checkins', row, 'sms', note);
      } finally { if (got) lock.releaseLock(); }
    });
  }
  return out;
};
/** [로그인 없음·기기 토큰] 선생님 목록 + 오늘 출퇴근 상태. 이름·색·상태만 주고 번호는 주지 않는다.
 * v41 부터 태블릿 화면은 번호 뒷자리(kioskLookup)만 쓰지만, 기기 점검·확인용으로 남겨 둔다 */
ACADEMY_ACTIONS.kioskStaff = function (req) {
  kioskDevice(req);
  var date = todayStr(), logs = {};
  readRows('logs').forEach(function (r) { if (r.date === date) logs[r.memberId] = r; });
  return readRows('members').filter(function (m) { return m.active !== false; }).map(function (m) {
    var l = logs[m.id] || {};
    return { id: m.id, name: m.name, color: m.color || '', role: m.role, pinSet: !!m.pinHash,
      checkIn: l.checkIn || '', checkOut: l.checkOut || '', next: !l.checkIn ? 'in' : (l.checkOut ? '' : 'out') };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ko'); });
};
/** [로그인 없음·기기 토큰] 선생님이 태블릿에서 근무번호를 눌러 출근·퇴근을 찍는다 (근무일지 logs 에 그대로 기록) */
ACADEMY_ACTIONS.kioskClock = function (req) {
  var dev = kioskDevice(req);
  var id = String(req.memberId || '').trim().toLowerCase(), pin = String(req.pin || '').replace(/\D/g, '');
  var m = findMember(id); if (!m || m.active === false) fail('bad_request', '없는 선생님입니다.');
  if (askStaffPin() && m.pinHash) {   // [출결 태블릿] 설정에서 근무번호 확인을 켰고, 그 선생님이 번호를 정해 둔 경우에만 한 번 더 확인한다
    if (!pin || hash(m.pinSalt, pin) !== m.pinHash) { Utilities.sleep(1200); fail('bad_pin', '근무번호가 맞지 않습니다.'); }
  }
  var type = req.kind === '퇴근' || req.type === 'out' ? 'out' : 'in';
  var row = clockCore(m.id, type, 'kiosk:' + dev.name);
  try { var list = kioskDevices(); list.forEach(function (d) { if (d.token === dev.token) d.lastUsed = new Date().toISOString(); }); upsertRow('settings', 'key', { key: 'kioskDevices', value: JSON.stringify(list) }); } catch (e) {}
  var kind = type === 'in' ? '출근' : '퇴근';
  return { ok: true, name: m.name, kind: kind, time: type === 'in' ? row.checkIn : row.checkOut,
    checkIn: row.checkIn || '', checkOut: row.checkOut || '', message: m.name + ' 선생님 ' + kind + ' 완료' };
};
/** [로그인 없음·기기 토큰] 오늘 등하원 현황 (태블릿 대기 화면용) */
ACADEMY_ACTIONS.kioskToday = function (req) {
  kioskDevice(req); attMaybeTick('tablet');   // 태블릿이 1분마다 부르므로 트리거가 없어도 미출결 확인이 돈다
  var t = todayStr(), names = {}; readRows('students').forEach(function (s) { names[s.id] = s.name; });
  var rows = readRowsSince('checkins', t, 600).filter(function (r) { return r.date === t; }).map(function (r) { return { time: r.time, name: names[r.studentId] || '', kind: r.kind, who: 'student' }; });
  var staffIn = 0, staffOut = 0, mem = {}; readRows('members').forEach(function (m) { mem[m.id] = m; });
  readRowsSince('logs', t, 200).forEach(function (r) {   // 선생님 출퇴근도 같은 목록에 (태블릿 오른쪽 현황)
    if (r.date !== t) return; var m = mem[r.memberId]; if (!m) return;
    if (r.checkIn) { rows.push({ time: r.checkIn, name: m.name, kind: '출근', who: 'staff' }); staffIn++; }
    if (r.checkOut) { rows.push({ time: r.checkOut, name: m.name, kind: '퇴근', who: 'staff' }); staffOut++; }
  });
  rows.sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
  return { date: t, rows: rows.slice(0, 30), staffIn: staffIn, staffOut: staffOut,
    inCount: rows.filter(function (r) { return r.kind === '등원'; }).length, outCount: rows.filter(function (r) { return r.kind === '하원'; }).length };
};
/** 대시보드: 날짜별 등하원 기록 */
ACADEMY_ACTIONS.listCheckins = function (req, me) {
  var date = String(req.date || todayStr()); if (!isDate(date)) fail('bad_request', '날짜가 잘못되었습니다.');
  var sc = scopeOf(me);
  return readRowsSince('checkins', date, 600).filter(function (r) { return r.date === date && canStudent(sc, r.studentId); }).map(function (r) { return { id: r.id, date: r.date, time: r.time, studentId: r.studentId, kind: r.kind, classId: r.classId || '', device: r.device || '', sms: r.sms || '' }; })
    .sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
};

// =====================================================================
// ---------- 주간 리포트 (AI 초안 → 선생님 승인 → 학부모 문자) ----------
// 선생님이 채점하며 체크한 틀린 문항(단원·오답 유형)과 출결·시험 결과를 한 주 단위로 모아 Claude 가 학부모용 문장을 쓴다.
// 초안은 reports 시트에 draft 로 저장되고, 선생님이 고쳐 승인(approved)한 것만 발송(sent)된다. AI 키는 문자 API 처럼 스크립트 속성에만 둔다.
// =====================================================================
var REPORT_STYLE_DEFAULT = '학부모께 보내는 주간 학습 안내입니다. 존댓말, 차분하고 구체적인 문체. 300~450자. 과장·추측 금지, 주어진 자료에 없는 내용은 쓰지 않습니다. 이모지·마크다운·제목 없이 문단만 씁니다.';
function aiConfig() {
  var p = {}; try { p = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) {}
  return { key: String(p.AI_KEY || ''), model: String(p.AI_MODEL || 'claude-opus-5'), style: kioskSetting('reportStyle', REPORT_STYLE_DEFAULT), rank: kioskSetting('reportRank', 'on') !== 'off', day: kioskSetting('reportDay', '토') };
}
function aiConfigOut(c) { return { keySet: !!c.key, keyTail: c.key ? '····' + c.key.slice(-4) : '', model: c.model, style: c.style, rank: c.rank, day: c.day, ready: !!c.key }; }
/** Claude Messages API 호출 (raw HTTP). 안전 분류기가 거절하면 폴백 모델이 이어서 답하도록 fallbacks 를 켠다 */
function callClaude(cfg, system, user, maxTokens) {
  if (!cfg.key) fail('bad_request', 'AI API 키가 설정되지 않았습니다. (리포트 → AI 설정)');
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-06-01' },
    payload: JSON.stringify({ model: cfg.model, max_tokens: maxTokens || 1500, fallbacks: [{ model: 'claude-opus-4-8' }], system: system, messages: [{ role: 'user', content: user }] }),
  });
  var code = res.getResponseCode(), out; try { out = JSON.parse(res.getContentText() || '{}'); } catch (e) { out = {}; }
  if (code < 200 || code >= 300) fail('bad_request', 'AI 응답 오류 (' + code + '): ' + ((out.error && out.error.message) || res.getContentText().slice(0, 200)));
  if (out.stop_reason === 'refusal') fail('bad_request', 'AI 가 이 요청을 거절했습니다. 내용을 확인하세요.');
  var text = (out.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
  if (!text) fail('bad_request', 'AI 응답이 비어 있습니다.');
  return { text: text, usage: out.usage || {}, model: out.model || cfg.model };
}
ACADEMY_ACTIONS.getAiConfig = function (req, me) { requireAdmin(me); return aiConfigOut(aiConfig()); };
ACADEMY_ACTIONS.saveAiConfig = function (req, me) {
  requireAdmin(me);
  var props = {}; if (str(req.key, 300)) props.AI_KEY = str(req.key, 300); if (str(req.model, 60)) props.AI_MODEL = str(req.model, 60);
  if (Object.keys(props).length) PropertiesService.getScriptProperties().setProperties(props, false);
  if (req.style != null) upsertRow('settings', 'key', { key: 'reportStyle', value: str(req.style, 1500) || REPORT_STYLE_DEFAULT });
  if (req.rank != null) upsertRow('settings', 'key', { key: 'reportRank', value: req.rank === false || req.rank === 'off' ? 'off' : 'on' });
  if (req.day != null) upsertRow('settings', 'key', { key: 'reportDay', value: str(req.day, 2) || '토' });
  if (typeof logChange === 'function') logChange(me, 'ai_config', '', '', '', '', 'AI 설정 변경');
  return aiConfigOut(aiConfig());
};
ACADEMY_ACTIONS.testAi = function (req, me) { requireAdmin(me); var r = callClaude(aiConfig(), '한 문장으로만 답하세요.', '학원관리 AI 연결 테스트입니다. "연결되었습니다"라고 한국어로 답하세요.', 100); return { text: r.text, model: r.model, usage: r.usage }; };
/** 주(週): weekEnd(YYYY-MM-DD, 보통 토요일)로 끝나는 7일 */
function weekOf(weekEnd) { var e = isDate(String(weekEnd || '')) ? String(weekEnd) : todayStr(); return { start: addDaysStr(e, -6), end: e }; }
/** 학생 한 명의 한 주 자료 (리포트 재료). 모두 실제 기록에서 계산 */
function weeklyDataOf(studentId, weekEnd) {
  var s = findRow('students', studentId); if (!s) fail('bad_request', '없는 학생입니다.');
  var w = weekOf(weekEnd), ctx = examCtx(), classes = ctx.classes;
  var enr = readEnr().filter(function (e) { return e.studentId === studentId && isActiveEnr(e, w.end); }).map(function (e) { return classes[e.classId]; }).filter(Boolean);
  var att = readRows('attendance').filter(function (r) { return r.studentId === studentId && r.date >= w.start && r.date <= w.end; });
  var attCount = {}; att.forEach(function (r) { attCount[r.status] = (attCount[r.status] || 0) + 1; });
  var ck = readRows('checkins').filter(function (r) { return r.studentId === studentId && r.date >= w.start && r.date <= w.end && r.kind === '등원' ; }).length;
  var exams = {}; readRows('exams').forEach(function (e) { exams[e.id] = examOut(e); });
  var byExam = {}; readRows('scores').forEach(function (r) { if (exams[r.examId]) (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
  var mine = function (from, to) {
    var out = [];
    Object.keys(byExam).forEach(function (xid) {
      var e = exams[xid]; if (e.date < from || e.date > to) return;
      var row = byExam[xid].filter(function (r) { return r.studentId === studentId; })[0]; if (!row) return;
      var st = examStats(e, byExam[xid], ctx), me = st.rows.filter(function (r) { return r.studentId === studentId; })[0];
      out.push({ examId: e.id, name: e.name, date: e.date, maxScore: e.maxScore, score: me.score, avg: st.overall.avg, classAvg: me.classAvg, className: me.className, rank: me.rank, tie: me.tie, total: st.overall.n, wrong: me.wrong, questions: e.questions.length,
        pct: me.score == null ? null : Math.round(me.score / e.maxScore * 100) });
    });
    out.sort(function (a, b) { return a.date.localeCompare(b.date); }); return out;
  };
  var thisWeek = mine(w.start, w.end);
  var units = {}, kinds = {}; thisWeek.forEach(function (x) { x.wrong.forEach(function (q) { var k = q.unit || '(단원 미지정)'; units[k] = (units[k] || 0) + 1; if (q.kind) kinds[q.kind] = (kinds[q.kind] || 0) + 1; }); });
  var trend = []; for (var i = 4; i >= 1; i--) { var e2 = addDaysStr(w.start, -7 * (i - 1) - 1), s2 = addDaysStr(e2, -6), ex = mine(s2, e2); var pcts = ex.map(function (x) { return x.pct; }).filter(function (v) { return v != null; }); trend.push({ weekStart: s2, weekEnd: e2, exams: ex.length, avgPct: pcts.length ? Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length) : null, wrong: ex.reduce(function (a, x) { return a + x.wrong.length; }, 0) }); }
  var recentUnits = {}; mine(addDaysStr(w.start, -28), w.end).forEach(function (x) { x.wrong.forEach(function (q) { var k = q.unit || '(단원 미지정)'; recentUnits[k] = (recentUnits[k] || 0) + 1; }); });
  var consults = readRows('consults').filter(function (r) { return r.studentId === studentId && r.date >= w.start && r.date <= w.end; }).map(function (r) { return { date: r.date, type: r.type, content: str(r.content, 300) }; });
  var prev = readRows('reports').filter(function (r) { return r.studentId === studentId && r.status !== 'draft' && r.weekEnd < w.end; }).sort(function (a, b) { return String(b.weekEnd).localeCompare(String(a.weekEnd)); })[0];
  return { student: { id: s.id, name: s.name, grade: s.grade || '', school: s.school || '', parentPhone: !!phoneStr(s.parentPhone) }, week: w, classes: enr.map(function (c) { return { name: c.name, teacher: (function () { var m = findRow('members', c.teacherId); return m ? m.name : ''; })() }; }),
    attendance: attCount, checkins: ck, exams: thisWeek, units: units, kinds: kinds, recentUnits: recentUnits, trend: trend, consults: consults, prevReport: prev ? str(prev.body, 600) : '' };
}
function reportOut(r) { var d = null; try { d = r.data ? JSON.parse(r.data) : null; } catch (e) {} return { id: r.id, studentId: r.studentId, weekStart: r.weekStart, weekEnd: r.weekEnd, status: r.status || 'draft', body: r.body || '', data: d, createdAt: r.createdAt || '', createdBy: r.createdBy || '', approvedBy: r.approvedBy || '', approvedAt: r.approvedAt || '', sentAt: r.sentAt || '', sms: r.sms || '', model: r.model || '' }; }
function reportPrompt(cfg, d) {
  var sys = '당신은 더블엠수학학원의 담당 선생님을 돕는 보조입니다. 아래 자료만 근거로 학부모께 보낼 주간 학습 안내문을 씁니다.\n' + cfg.style +
    '\n규칙: 학생 이름은 "' + d.student.name + ' 학생"으로 부릅니다. 첫 문장은 인사 없이 이번 주 핵심 한 줄. 시험이 있으면 점수·만점·반 평균' + (cfg.rank ? '·순위' : '') + '를 숫자로 적습니다(순위는 ' + (cfg.rank ? '자료에 있으면 적습니다' : '적지 않습니다') + '). 틀린 문항의 단원과 오답 유형을 근거로 보완할 점을 1~2개만 고릅니다: "개념" 오답은 반드시 언급하고 다음 수업에서 다룰 것을 씁니다, "계산" 실수는 여러 번 반복될 때만 언급합니다, "오독"은 문제 조건 읽기, "시간"은 시간 배분, "유형"은 풀이법 연습으로 표현합니다. 지난 4주 추세가 있으면 나아진 점을 한 문장 넣습니다. 마지막에 다음 주 계획 한 문장과 가정에서 도와주실 일 한 문장. 시험이 없는 주면 출결·수업 참여를 중심으로 짧게(200자 내외) 씁니다. 자료에 없는 사실·칭찬을 지어내지 않습니다. 결석·지각이 있으면 사실만 부드럽게 적습니다.';
  var user = 'JSON 자료:\n' + JSON.stringify(d) + '\n\n위 자료로 안내문 본문만 출력하세요.';
  return { system: sys, user: user };
}
/** 초안 만들기: 자료를 모아 AI 가 쓰고 reports 에 draft 로 저장 (이미 승인·발송된 주는 덮어쓰지 않음) */
ACADEMY_ACTIONS.reportDraft = function (req, me) {
  var sid = String(req.studentId || ''), w = weekOf(req.weekEnd);
  requireStudent(me, sid);
  var existing = readRows('reports').filter(function (r) { return r.studentId === sid && r.weekEnd === w.end; })[0];
  if (existing && existing.status !== 'draft' && !req.force) fail('bad_request', '이미 승인되거나 발송된 주입니다.');
  var d = weeklyDataOf(sid, w.end), cfg = aiConfig(), p = reportPrompt(cfg, d), r = callClaude(cfg, p.system, p.user, 1200);
  var row = { id: existing ? existing.id : newId('W'), studentId: sid, weekStart: w.start, weekEnd: w.end, status: 'draft', body: r.text.slice(0, 1800), data: JSON.stringify({ exams: d.exams.map(function (x) { return { name: x.name, score: x.score, max: x.maxScore, avg: x.avg, rank: x.rank, wrong: x.wrong.length }; }), units: d.units, kinds: d.kinds, attendance: d.attendance, checkins: d.checkins }).slice(0, 4000),
    createdAt: new Date().toISOString(), createdBy: me.id, approvedBy: '', approvedAt: '', sentAt: '', sms: '', model: r.model };
  upsertRow('reports', 'id', row); return reportOut(row);
};
/** AI 없이 빈 리포트를 만든다 (자료를 복사해 다른 곳에서 받은 문구를 붙여넣을 때). 이미 있으면 그것을 돌려준다 */
ACADEMY_ACTIONS.reportBlank = function (req, me) {
  var sid = String(req.studentId || ''), w = weekOf(req.weekEnd);
  if (!findRow('students', sid)) fail('bad_request', '없는 학생입니다.');
  requireStudent(me, sid);
  var existing = readRows('reports').filter(function (r) { return r.studentId === sid && r.weekEnd === w.end; })[0];
  if (existing) return reportOut(existing);
  var d = weeklyDataOf(sid, w.end);
  var row = { id: newId('W'), studentId: sid, weekStart: w.start, weekEnd: w.end, status: 'draft', body: '', data: JSON.stringify({ exams: d.exams.map(function (x) { return { name: x.name, score: x.score, max: x.maxScore, avg: x.avg, rank: x.rank, wrong: x.wrong.length }; }), units: d.units, kinds: d.kinds, attendance: d.attendance, checkins: d.checkins }).slice(0, 4000),
    createdAt: new Date().toISOString(), createdBy: me.id, approvedBy: '', approvedAt: '', sentAt: '', sms: '', model: '' };
  upsertRow('reports', 'id', row); return reportOut(row);
};
ACADEMY_ACTIONS.reportData = function (req, me) { requireStudent(me, String(req.studentId || '')); return weeklyDataOf(String(req.studentId || ''), req.weekEnd); };
ACADEMY_ACTIONS.listReports = function (req, me) { var w = weekOf(req.weekEnd), sc = scopeOf(me); return readRows('reports').filter(function (r) { return r.weekEnd === w.end && canStudent(sc, r.studentId); }).map(reportOut); };
/** 본문 수정·승인. status: draft | approved */
ACADEMY_ACTIONS.saveReport = function (req, me) {
  var r = findRow('reports', String(req.id || '')); if (!r) fail('bad_request', '없는 리포트입니다.');
  requireStudent(me, r.studentId);
  if (r.status === 'sent') fail('bad_request', '이미 발송된 리포트는 고칠 수 없습니다.');
  if (req.body != null) r.body = str(req.body, 1800);
  if (req.status === 'approved') { r.status = 'approved'; r.approvedBy = me.id; r.approvedAt = new Date().toISOString(); } else if (req.status === 'draft') { r.status = 'draft'; r.approvedBy = ''; r.approvedAt = ''; }
  upsertRow('reports', 'id', r); return reportOut(r);
};
/** 승인된 리포트를 학부모 연락처로 문자 발송 (문자 API 필요). 결과를 reports 와 messages 에 남긴다 */
ACADEMY_ACTIONS.sendReports = function (req, me) {
  var ids = Array.isArray(req.ids) ? req.ids.map(String) : [], cfg = smsConfig(); if (!smsReady(cfg)) fail('bad_request', '문자 API가 설정되지 않아 보낼 수 없습니다. (문자 → 문자 API 설정)');
  var students = {}; readRows('students').forEach(function (s) { students[s.id] = s; });
  var out = [], now = new Date().toISOString();
  ids.forEach(function (id) {
    var r = findRow('reports', id); if (!r || r.status !== 'approved') { out.push({ id: id, ok: false, error: '승인된 리포트가 아닙니다' }); return; }
    if (!canStudent(scopeOf(me), r.studentId)) { out.push({ id: id, ok: false, error: '담당 학생이 아닙니다' }); return; }
    var s = students[r.studentId], phone = s ? phoneStr(s.parentPhone) : ''; if (!phone) { out.push({ id: id, ok: false, error: '학부모 번호 없음' }); return; }
    var body = '[더블엠수학학원 주간 안내] ' + r.body;
    var res = sendViaProvider(cfg, [{ name: s.name, phone: phone, body: body }]);
    r.sms = res.ok ? '발송' : '실패' + (res.detail ? ' · ' + res.detail : ''); if (res.ok) { r.status = 'sent'; r.sentAt = now; }
    upsertRow('reports', 'id', r);
    appendRow('messages', { id: newId('M'), sentAt: now, kind: '주간리포트', count: 1, recipients: s.name + ':' + phone, body: body, method: cfg.provider, result: '성공 ' + res.ok + ' / 실패 ' + res.fail + (res.detail ? ' · ' + res.detail : ''), groupIds: (res.ids || []).join(','), sentBy: me.id });
    out.push({ id: id, ok: !!res.ok, error: res.ok ? '' : res.detail, report: reportOut(r) });
  });
  return out;
};

// =====================================================================
// ---------- 미출결 자동 확인 · 알림 ----------
// 수업(정규·보강) 시작 뒤 1차 시간(기본 5분)까지 등원 기록(태블릿 등원 · 출석부)이 없는 학생을 "출결 확인 필요"로 올리고
// 담당 선생님·데스크 등에게 내부 알림을 준다. 선생님이 [교실에 있음]·[아직 안 옴]·[지각 예정]·[결석] 중 하나로 확인한다.
// 2차 시간(기본 10분)에: 현장출석·지각 예정·결석 → 문자 없음 / 미등원(직원이 확인) → 학생·학부모 문자(설정에서 켠 경우만) /
// 아직 아무도 확인 안 함 → 결석이라고 단정하지 않고 데스크·원장에게 내부 재알림만.
//
// 새로 만든 것은 확인 기록 시트 2개뿐이다. 학생·반·수강·보강·출석부·태블릿 등원·문자 발송은 기존 것을 그대로 쓴다.
//  attChecks   학생 × 날짜 × 수업(정규 반 또는 보강) = 1행. id 가 이 조합으로 정해져 있어 같은 수업에 두 번 생기지 않는다
//  attCheckLog 상태가 바뀔 때마다 1행 (누가 · 언제 · 무엇에서 무엇으로)
// 상태: 확인필요 · 현장출석 · 미등원 · 지각예정 · 결석 · 알림제외 · 지각출석 · 정상출석 · 시간변경(오늘만 수업 시각이 바뀜)
//
// 실행: 서버가 스스로 돈다. ① (권장) Apps Script 편집기 → 트리거 → attendanceWatchTrigger · 시간 기반 · 1분마다 (한 번만 추가)
//       ② 트리거가 없어도 출결 태블릿(1분마다 현황 조회)·대시보드가 켜져 있으면 그 요청이 대신 1분에 한 번 돌린다.
// 같은 시각에 두 번 돌아도 스크립트 잠금 + 행마다 기록한 알림 시각·문자 시각 때문에 알림·문자가 두 번 나가지 않는다.
// =====================================================================
ACADEMY_SHEETS.attChecks = ['id', 'date', 'studentId', 'studentName', 'classId', 'className', 'makeupId', 'teacherId', 'due', 'status', 'reason', 'detectedAt', 'alertTo', 'alert1At', 'alert2At',
  'checkedBy', 'checkedByName', 'checkedAt', 'checkMethod', 'firstBy', 'smsAt', 'smsStudent', 'smsParent', 'smsIds', 'arrivedAt', 'lateMin', 'version', 'updatedAt', 'note', 'seenBy'];   // seenBy: 알림 받은 사람이 목록을 연 시각 "아이디@HH:mm,…" 
ACADEMY_SHEETS.attCheckLog = ['id', 'date', 'checkId', 'at', 'by', 'byName', 'from', 'to', 'note'];
var ATTW_STATUS = ['확인필요', '현장출석', '미등원', '지각예정', '결석', '알림제외', '지각출석', '정상출석', '시간변경'];
var ATTW_SET = { 현장출석: 1, 미등원: 1, 지각예정: 1, 결석: 1, 알림제외: 1, 시간변경: 1, 확인필요: 1 };   // 사람이 고를 수 있는 상태 (확인필요 = 되돌리기)
var ATTW_MSG_STUDENT = '[{학원}] {이름} 학생, {시각} 수업 등원이 아직 확인되지 않았어요. 오는 중이면 괜찮아요. 학원에 알려 주세요.';
var ATTW_MSG_PARENT = '[{학원}] {이름} 학생이 {시각} 수업에 아직 등원하지 않았습니다. 확인 부탁드립니다.';
var ATTW_APP_URL = 'https://mmmath0110-del.github.io/mmmath01/academy.html';
var ATTW_KEEP_PLAN = { smsDelivery: 1, pushKey: 1, pushSubscribe: 1, pushUnsubscribe: 1, pushTest: 1, attSeen: 1, attResendSms: 1, attTestFamily: 1, kioskCheck: 1, kioskClock: 1, clock: 1, saveLog: 1, attCheckAct: 1, attCheckBulk: 1, attWatchRun: 1, saveAttendance: 1, saveScores: 1, sendMessages: 1, saveReport: 1 };   // 오늘 수업 계획(캐시)을 바꾸지 않는 잦은 쓰기

function attCfgDefault() {
  return { on: true, min1: 5, min2: 10,
    n1: { teacher: true, desk: true, admin: false, extra: false },   // 1차(+5분) 알림 받는 사람
    n2: { teacher: true, desk: true, admin: true, extra: false },    // 2차(+10분, 아직 확인 안 됨) 재알림
    internalSms: false,                                               // 내부 알림을 직원 휴대폰 문자로도 (끄면 앱 안 알림만)
    famSms: false, famStudent: true, famParent: true,                  // 미등원 확인 시 학생·학부모 문자 (원장이 켜야 나간다)
    deskIds: [], extraIds: [], excludeStudents: [], excludeClasses: [], classOverrides: {},
    msgStudent: ATTW_MSG_STUDENT, msgParent: ATTW_MSG_PARENT, academy: '더블엠수학학원', appUrl: ATTW_APP_URL,
    repeatN: 3,                                                          // 최근 30일 미등원·지각이 이 횟수 이상이면 "반복" 표시 (0 = 표시 안 함)
    alimtalk: { on: false, pfId: '', tplStudent: '', tplParent: '' } };   // 카카오 알림톡 (솔라피 · 카카오 채널과 승인된 템플릿 필요). 실패하면 같은 내용 문자로 대체 발송
}
function attCfg() {
  var c = attCfgDefault(), raw = kioskSetting('attWatch', '');
  if (raw) { try { var o = JSON.parse(raw) || {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(c, k)) c[k] = o[k]; } catch (e) {} }
  return c;
}
function attCfgCached() {
  var cache = CacheService.getScriptCache(), raw = null; try { raw = cache.get('attCfg'); } catch (e) {}
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  var c = attCfg(); try { cache.put('attCfg', JSON.stringify(c), 600); } catch (e) {}
  return c;
}
/** 설정 검사: 2차는 1차보다 늦어야 하고, 사람·반·학생은 실제로 있는 것만 남긴다 */
function attCfgClean(o) {
  var c = attCfgDefault(); o = o || {};
  var toInt = function (v, d) { var n = Math.round(Number(v)); return isNaN(n) ? d : n; };
  c.on = o.on !== false;
  c.min1 = toInt(o.min1, 5); c.min2 = toInt(o.min2, 10);
  if (c.min1 < 1 || c.min1 > 60) fail('bad_request', '1차 확인 시간은 1~60분 사이로 정하세요.');
  if (c.min2 <= c.min1) fail('bad_request', '2차 확인 시간은 1차 확인 시간보다 늦어야 합니다.');
  if (c.min2 > 120) fail('bad_request', '2차 확인 시간은 120분까지 정할 수 있습니다.');
  var who = function (x, d) { x = x || {}; return { teacher: x.teacher == null ? d.teacher : !!x.teacher, desk: x.desk == null ? d.desk : !!x.desk, admin: x.admin == null ? d.admin : !!x.admin, extra: x.extra == null ? d.extra : !!x.extra }; };
  c.n1 = who(o.n1, c.n1); c.n2 = who(o.n2, c.n2);
  ['internalSms', 'famSms', 'famStudent', 'famParent'].forEach(function (k) { if (o[k] != null) c[k] = !!o[k]; });
  var mem = {}; readRows('members').forEach(function (m) { if (m.active !== false) mem[m.id] = 1; });
  var stu = {}; readRows('students').forEach(function (s) { stu[s.id] = 1; });
  var cls = {}; readRows('classes').forEach(function (x) { cls[x.id] = 1; });
  var ids = function (a, ok) { return (Array.isArray(a) ? a : []).map(String).filter(function (x, i, arr) { return ok[x] && arr.indexOf(x) === i; }); };
  c.deskIds = ids(o.deskIds, mem); c.extraIds = ids(o.extraIds, mem);
  c.excludeStudents = ids(o.excludeStudents, stu); c.excludeClasses = ids(o.excludeClasses, cls);
  var ov = o.classOverrides && typeof o.classOverrides === 'object' ? o.classOverrides : {};
  Object.keys(ov).forEach(function (id) { if (!cls[id]) return; var x = ov[id] || {}; c.classOverrides[id] = { n1: who(x.n1, c.n1), n2: who(x.n2, c.n2) }; });
  c.msgStudent = str(o.msgStudent, 300) || ATTW_MSG_STUDENT; c.msgParent = str(o.msgParent, 300) || ATTW_MSG_PARENT;
  c.academy = str(o.academy, 30) || '더블엠수학학원';
  c.appUrl = /^https:\/\/[^\s]+$/.test(String(o.appUrl || '')) ? str(o.appUrl, 200) : ATTW_APP_URL;
  c.repeatN = Math.max(0, Math.min(20, toInt(o.repeatN, 3)));
  var at = o.alimtalk || {};
  c.alimtalk = { on: !!at.on, pfId: str(at.pfId, 60), tplStudent: str(at.tplStudent, 60), tplParent: str(at.tplParent, 60) };
  if (c.alimtalk.on && (!c.alimtalk.pfId || (!c.alimtalk.tplStudent && !c.alimtalk.tplParent))) fail('bad_request', '알림톡을 쓰려면 카카오 채널 ID(pfId)와 템플릿 ID를 넣으세요.');
  return c;
}
function attDow(date) { var p = String(date).split('-').map(Number); return ['일', '월', '화', '수', '목', '금', '토'][new Date(p[0], p[1] - 1, p[2]).getDay()]; }
function attRowId(date, sid, classId, makeupId) { return 'W' + String(date).replace(/-/g, '') + '_' + sid + '_' + (makeupId ? 'M' + makeupId : 'C' + classId); }
/** 오늘 이 반이 쉬는지: 원장실 달력의 휴원 일정(대상이 비었거나 전체면 학원 전체, 반 이름이 들어 있으면 그 반) · 제목에 휴강/휴무/공휴일/수업 없음 */
function attClosures(date) {
  return readRows('events').filter(function (e) {
    return (e.type === '휴원' || /휴강|휴무|공휴일|수업\s*없음/.test(e.title || '')) && e.date && e.date <= date && (e.endDate || e.date) >= date;
  });
}
function attClosed(closures, c) {
  return closures.some(function (e) { var t = String(e.target || '').trim(); return !t || /^(전체|학원|전원|모두)/.test(t) || (c && c.name && (t.indexOf(c.name) >= 0 || String(c.name).indexOf(t) >= 0)); });
}
/**
 * 오늘의 수업 계획: 학생마다 확인할 수업과 기준 시각.
 * 우선순위: 당일 변경(시간변경 행) → 보강(같은 반의 오늘 보강이 정규를 대신) → 정규 시간표.
 * 빠지는 것: 재원이 아닌 학생 · 종료된 반 · 수강 시작 전/끝난 수강 · 지운 수강 · 휴원/휴강일의 정규 수업 · 취소·삭제된 보강 · 설정의 제외 학생/반
 */
function attPlanBuild(date) {
  var dow = attDow(date), cfg = attCfg();
  var students = {}; readRows('students').forEach(function (s) { if ((s.status || '재원') === '재원') students[s.id] = s; });
  var classes = {}; readRows('classes').forEach(function (c) { classes[c.id] = c; });
  var closures = attClosures(date), seen = {}, sessions = [];
  readEnr().forEach(function (e) {
    var s = students[e.studentId], c = classes[e.classId];
    if (!s || !c || c.status === '종료') return;
    if (e.startDate && e.startDate > date) return;
    if (e.endDate && e.endDate < date) return;
    var slot = parseSchedule(c).filter(function (x) { return x.day === dow; })[0];
    if (!slot || !isTime(slot.start) || attClosed(closures, c)) return;
    var k = s.id + '|' + c.id; if (seen[k]) return; seen[k] = 1;
    sessions.push({ sid: s.id, name: s.name, classId: c.id, className: c.name, makeupId: '', teacherId: c.teacherId || '', due: slot.start, kind: '정규' });
  });
  readMakeups().forEach(function (m) {
    if (m.date !== date || (m.status || '예정') === '취소' || !isTime(m.start)) return;
    var c = m.classId ? classes[m.classId] : null;
    String(m.studentIds || '').split(',').forEach(function (sid) {
      var s = students[sid]; if (!s) return;
      if (m.classId) sessions = sessions.filter(function (x) { return !(x.sid === sid && x.classId === m.classId && !x.makeupId); });   // 같은 반 정규 수업을 보강이 대신한다
      sessions.push({ sid: sid, name: s.name, classId: m.classId || '', className: m.title || (c ? c.name : '') || '보강', makeupId: m.id, teacherId: m.teacherId || (c ? c.teacherId : '') || '', due: m.start, kind: '보강' });
    });
  });
  var exS = {}, exC = {}; (cfg.excludeStudents || []).forEach(function (x) { exS[x] = 1; }); (cfg.excludeClasses || []).forEach(function (x) { exC[x] = 1; });
  sessions = sessions.filter(function (x) { return !exS[x.sid] && !(x.classId && exC[x.classId]); });
  var changed = {}; attRowsOf(date).forEach(function (r) { if (r.status === '시간변경' && isTime(r.due)) changed[r.id] = r.due; });   // 당일 변경이 가장 우선
  sessions.forEach(function (x) { x.id = attRowId(date, x.sid, x.classId, x.makeupId); if (changed[x.id]) { x.orig = x.due; x.due = changed[x.id]; } });
  sessions.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : String(a.className).localeCompare(String(b.className), 'ko') || String(a.name).localeCompare(String(b.name), 'ko'); });
  return { date: date, built: new Date().toISOString(), sessions: sessions };
}
/** 수업 계획은 30분 캐시. 학생·반·수강·보강·달력·설정이 바뀌면 doPost 가 attPlanDirty 로 지운다 */
function attPlan(date) {
  var key = 'attPlan:' + date, cache = CacheService.getScriptCache(), raw = null;
  try { raw = cache.get(key); } catch (e) {}
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  var p = attPlanBuild(date);
  try { cache.put(key, JSON.stringify(p), 1800); } catch (e) {}
  return p;
}
function attPlanDirty() { try { CacheService.getScriptCache().removeAll(['attPlan:' + todayStr(), 'attCfg']); } catch (e) {} }
function attRowsOf(date) { return readRowsSince('attChecks', date, 400).filter(function (r) { return r.date === date; }); }
function attCheckinsOf(date) {
  var m = {}; readRowsSince('checkins', date, 600).forEach(function (r) { if (r.date === date) (m[r.studentId] = m[r.studentId] || []).push(r); });
  for (var k in m) m[k].sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  return m;
}
/** 태블릿 기준 지금 학원 안에 있는지: 지금까지의 마지막 기록이 등원이면 있다 */
function attInNow(list, hm) { var last = null; (list || []).forEach(function (r) { if (String(r.time) <= hm) last = r; }); return last && last.kind === '등원' ? last : null; }
function attWin(cfg) { return Math.max(60, cfg.min2 + 30); }   // 이 시간(분)이 지난 수업은 새로 알리거나 문자를 보내지 않는다 (서버가 멈췄다 늦게 돌아도 엉뚱한 알림 방지)
function attRoleOf(me, cfg) { return me.role === 'admin' ? 'admin' : (cfg.deskIds || []).indexOf(me.id) >= 0 ? 'desk' : 'teacher'; }
/** 볼 수 있는 행: 원장·데스크 전체, 선생님은 자기 수업(담당 반 · 담당으로 잡힌 보강)만 */
function attCanSee(me, cfg, sc, r) {
  var role = attRoleOf(me, cfg); if (role !== 'teacher') return true;
  return r.teacherId === me.id || (!!r.classId && !!sc && !!sc.classIds[r.classId]);
}
function attRecipients(cfg, r, stage) {
  var ov = (cfg.classOverrides || {})[r.classId] || {}, n = (stage === 2 ? ov.n2 : ov.n1) || (stage === 2 ? cfg.n2 : cfg.n1), ids = {};
  var mem = {}; readRows('members').forEach(function (m) { if (m.active !== false) mem[m.id] = m; });
  if (n.teacher && mem[r.teacherId]) ids[r.teacherId] = 1;
  if (n.desk) (cfg.deskIds || []).forEach(function (x) { if (mem[x]) ids[x] = 1; });
  if (n.extra) (cfg.extraIds || []).forEach(function (x) { if (mem[x]) ids[x] = 1; });
  if (n.admin || !Object.keys(ids).length) Object.keys(mem).forEach(function (x) { if (mem[x].role === 'admin') ids[x] = 1; });   // 받을 사람이 아무도 없으면 원장에게 (알림이 사라지지 않게)
  return Object.keys(ids);
}
function attLogRow(r, me, from, to, note) { return { id: newId('H'), date: r.date, checkId: r.id, at: new Date().toISOString(), by: me ? me.id : 'SYSTEM', byName: me ? me.name : '자동', from: from || '', to: to || '', note: str(note, 200) }; }
function attLog(r, me, from, to, note) { appendRow('attCheckLog', attLogRow(r, me, from, to, note)); }
function attHM(iso) { try { return iso ? Utilities.formatDate(new Date(iso), TZ, 'HH:mm') : ''; } catch (e) { return ''; } }
function attStamp(tag) {
  var o = { at: new Date().toISOString(), date: todayStr(), hm: nowHM(), source: tag || '' };
  try { var c = CacheService.getScriptCache(); c.put('attTick', JSON.stringify(o), 21600); if (tag === 'trigger') c.put('attTrig', JSON.stringify(o), 21600); } catch (e) {}
}
function attLastTick() {
  var out = { tick: null, trigger: null };
  try { var c = CacheService.getScriptCache(), a = c.get('attTick'), b = c.get('attTrig'); out.tick = a ? JSON.parse(a) : null; out.trigger = b ? JSON.parse(b) : null; } catch (e) {}
  return out;
}
/** 시간 기반 트리거가 부르는 함수 (Apps Script 편집기 → 트리거 → 1분마다) */
function attendanceWatchTrigger() { ROW_CACHE = {}; JOURNAL = null; return attendanceWatchTick({ source: 'trigger' }); }
/** 태블릿·대시보드 요청에 얹혀 1분에 한 번만 돈다 (트리거가 이미 돌았으면 건너뛴다). 실패해도 원래 요청에는 영향 없음 */
function attMaybeTick(source) {
  try {
    var c = CacheService.getScriptCache(), last = Number(c.get('attTickAt') || 0);
    if (Date.now() - last < 50000) return null;
    c.put('attTickAt', String(Date.now()), 300);
    return attendanceWatchTick({ source: source });
  } catch (e) { return null; }
}
/** 한 번 확인. 할 일이 없는 시간에는 캐시만 보고 바로 끝난다. 잠금을 못 얻으면(다른 요청이 쓰는 중) 다음 분에 한다 */
function attendanceWatchTick(opts) {
  opts = opts || {};
  var cfg = attCfgCached(); try { CacheService.getScriptCache().put('attTickAt', String(Date.now()), 300); } catch (e) {}
  attStamp(opts.source);
  if (!cfg.on) return { skipped: 'off' };
  var date = todayStr(), nowM = hm2min(nowHM()), W = attWin(cfg);
  var live = attPlan(date).sessions.filter(function (s) { var d = hm2min(s.due); return nowM >= d + cfg.min1 && nowM <= d + W; });
  if (!live.length) return { live: 0 };
  var lock = null;
  if (!opts.locked) { lock = LockService.getScriptLock(); if (!lock.tryLock(opts.wait || (opts.source === 'trigger' ? 20000 : 1500))) return { skipped: 'busy' }; }   // 태블릿·화면 요청에 얹혀 돌 때는 오래 기다리지 않는다
  try { return attTickCore(cfg, date, live); } finally { if (lock) lock.releaseLock(); }
}
function attTickCore(cfg, date, live) {
  ['attChecks', 'checkins', 'attendance'].forEach(invalidateRows);   // 잠금을 얻은 뒤 시트를 새로 읽는다
  var hm = nowHM(), nowM = hm2min(hm), nowIso = new Date().toISOString(), W = attWin(cfg);
  var rows = {}; attRowsOf(date).forEach(function (r) { rows[r.id] = r; });
  var ins = attCheckinsOf(date), att = null;
  var attMap = function () { if (!att) { att = {}; readRows('attendance').forEach(function (r) { if (r.date === date) att[r.studentId + '|' + r.classId] = r; }); } return att; };
  var fresh = {}, ups = [], a1 = [], a2 = [], smsRows = [];
  live.forEach(function (s) {
    var r = rows[s.id];
    if (r && r.status !== '시간변경') return;                        // 이미 올라왔거나 미리 처리됨 (결석·지각 예정·알림 제외)
    if (attInNow(ins[s.sid], hm)) return;                             // 태블릿 등원
    var a = (s.makeupId && attMap()[s.sid + '|' + s.makeupId]) || (s.classId && attMap()[s.sid + '|' + s.classId]);
    if (a && a.status) return;                                         // 출석부에 이미 적혀 있음 (반 출석부 또는 보강 출석부 · 출석·지각·미리 적은 결석 등)
    var row = r || { id: s.id, date: date, studentId: s.sid, classId: s.classId, makeupId: s.makeupId, due: s.due, version: 0 };
    row.studentName = s.name; row.className = s.className; row.teacherId = s.teacherId; row.due = s.due;
    row.reason = s.kind + (s.orig ? ' · 시간변경 ' + s.orig + '→' + s.due : '');
    row.status = '확인필요'; row.detectedAt = nowIso; row.alert1At = nowIso; row.updatedAt = nowIso; row.version = num(row.version) + 1;
    rows[s.id] = row; fresh[s.id] = 1; ups.push(row);
  });
  Object.keys(rows).forEach(function (id) {
    var r = rows[id], d = hm2min(r.due);
    if (nowM < d + cfg.min2 || nowM > d + W) {                       // 아직 2차 전 (또는 너무 지남)
      if (fresh[id]) a1.push(r);
      return;
    }
    if (r.status === '확인필요' && !r.alert2At) {                     // 10분이 지났는데 아무도 확인 안 함 → 결석이라 하지 않고 내부 재알림만
      r.alert2At = nowIso; r.updatedAt = nowIso; if (!fresh[id]) { r.version = num(r.version) + 1; ups.push(r); }
      a2.push(r);
    } else if (r.status === '미등원' && !r.smsAt && cfg.famSms) smsRows.push(r);
  });
  // 받을 사람 기록 + 저장을 먼저 한다 (보내다 실패해도 다시 보내지 않게: 최대 한 번)
  a1.forEach(function (r) { r.alertTo = attRecipients(cfg, r, 1).join(','); });
  a2.forEach(function (r) { var to = String(r.alertTo || '').split(',').filter(String); (fresh[r.id] ? attRecipients(cfg, r, 1).concat(attRecipients(cfg, r, 2)) : attRecipients(cfg, r, 2)).forEach(function (x) { if (to.indexOf(x) < 0) to.push(x); }); r.alertTo = to.join(','); });
  if (ups.length) upsertMany('attChecks', 'id', ups);
  appendRows('attCheckLog', ups.map(function (r) { return attLogRow(r, null, fresh[r.id] ? '' : '확인필요', '확인필요', fresh[r.id] ? '자동 감지: ' + cfg.min1 + '분 지나도 등원 기록 없음' : cfg.min2 + '분 지나도 확인 안 됨 → 재알림'); }));
  var sent = { alert1: a1.length, alert2: a2.length, sms: 0 };
  if (cfg.internalSms && (a1.length || a2.length)) { try { attInternalSms(cfg, a1, 1); attInternalSms(cfg, a2, 2); } catch (e) {} }
  if (a1.length || a2.length) {   // 알림 받는 사람의 기기로 푸시 (기기에서 알림을 켠 사람만 · 화면이 꺼져 있어도 온다)
    var to = {}; a1.concat(a2).forEach(function (r) { String(r.alertTo || '').split(',').forEach(function (x) { if (x) to[x] = 1; }); });
    try { sent.push = pushSend(Object.keys(to)).sent; } catch (e) {}
  }
  smsRows.forEach(function (r) { if (attSendFamily(r.id, cfg, null).sent) sent.sms++; });
  return sent;
}
/** 내부 알림 문자 (설정에서 켠 경우만). 받을 사람마다 한 통으로 묶는다 */
function attInternalSms(cfg, list, stage) {
  if (!list.length) return;
  var sc = smsConfig(); if (!smsReady(sc)) return;
  var mem = {}; readRows('members').forEach(function (m) { mem[m.id] = m; });
  var per = {};
  list.forEach(function (r) { String(r.alertTo || '').split(',').forEach(function (id) { if (id && mem[id] && phoneStr(mem[id].phone)) (per[id] = per[id] || []).push(r); }); });
  Object.keys(per).forEach(function (id) {
    var rs = per[id], head = stage === 2 ? '[출결 확인 미완료] ' + cfg.min2 + '분이 지났는데 아직 확인되지 않았습니다.' : '[출결 확인 필요] 등원 기록이 없습니다. 교실에 있는지 확인해 주세요.';
    var names = rs.map(function (r) { return r.due + ' ' + (r.className || '') + ' ' + (r.studentName || ''); }).slice(0, 8).join(', ') + (rs.length > 8 ? ' 외 ' + (rs.length - 8) + '명' : '');
    var body = head + ' ' + names + ' ' + cfg.appUrl + '#miss';
    var res = sendViaProvider(sc, [{ name: mem[id].name, phone: phoneStr(mem[id].phone), body: body }]);
    appendRow('messages', { id: newId('M'), sentAt: new Date().toISOString(), kind: '출결 확인 알림(내부)', count: 1, recipients: mem[id].name + ':' + phoneStr(mem[id].phone), body: body, method: sc.provider, result: '성공 ' + res.ok + ' / 실패 ' + res.fail + (res.detail ? ' · ' + res.detail : ''), groupIds: (res.ids || []).join(','), sentBy: 'attWatch' });
  });
}
/**
 * 미등원 안내 문자 (학생·학부모 각각). 한 수업에 한 번만: 보내기 전에 smsAt 을 먼저 저장하고, 이미 있으면 보내지 않는다.
 * 보내기 직전에 행과 태블릿 등원을 다시 읽어, 그사이 도착했거나 상태가 바뀌었으면 보내지 않는다.
 */
function attSendFamily(id, cfg, me) {
  invalidateRows('attChecks'); invalidateRows('checkins');
  var r = attRowsOf(String(id).slice(1, 5) + '-' + String(id).slice(5, 7) + '-' + String(id).slice(7, 9)).filter(function (x) { return x.id === id; })[0];
  if (!r || r.status !== '미등원' || r.smsAt || !cfg.famSms || r.date !== todayStr()) return { sent: false };
  var hm = nowHM(), d = hm2min(r.due), nowM = hm2min(hm);
  if (nowM < d + cfg.min2 || nowM > d + attWin(cfg)) return { sent: false };
  var came = (attCheckinsOf(r.date)[r.studentId] || []).filter(function (c) { return c.kind === '등원' && hm2min(c.time) >= d - 30; })[0];
  if (came) { attArrive(r, came.time, '태블릿', null); upsertRow('attChecks', 'id', r); return { sent: false, arrived: true }; }
  var s = findRow('students', r.studentId) || {}, sc = smsConfig(), nowIso = new Date().toISOString();
  r.smsAt = nowIso; r.smsStudent = cfg.famStudent ? '보내는 중' : '끔'; r.smsParent = cfg.famParent ? '보내는 중' : '끔';
  r.version = num(r.version) + 1; r.updatedAt = nowIso;
  upsertRow('attChecks', 'id', r);                                     // 먼저 저장 → 이 뒤에 무슨 일이 나도 두 번 보내지 않는다
  var fill = function (t) { return String(t).replace(/\{학원\}/g, cfg.academy).replace(/\{이름\}/g, s.name || r.studentName || '').replace(/\{시각\}/g, r.due).replace(/\{반\}/g, r.className || ''); };
  var ids = [];
  r.smsStudent = attSendOne(cfg, sc, r, s, 'student', me, ids, fill);
  r.smsParent = attSendOne(cfg, sc, r, s, 'parent', me, ids, fill);
  r.smsIds = ids.join(','); r.updatedAt = new Date().toISOString();
  upsertRow('attChecks', 'id', r);
  attLog(r, me, '미등원', '미등원', '문자: 학생 ' + r.smsStudent + ' / 학부모 ' + r.smsParent);
  return { sent: /발송/.test(r.smsStudent + r.smsParent) };
}
/**
 * 학생·학부모 안내 한 통. 알림톡을 켰고(솔라피) 그 대상 템플릿이 있으면 알림톡, 아니면 문자.
 * 알림톡 템플릿 변수: #{이름} #{시각} #{반} #{학원} — 카카오에 등록한 템플릿 내용이 위 문구와 같아야 한다 (실패 시 솔라피가 같은 내용을 문자로 보낸다)
 */
function attDeliver(cfg, sc, phone, body, tplId, vars) {
  var at = cfg.alimtalk || {};
  if (at.on && sc.provider === 'solapi' && at.pfId && tplId) {
    var r = sendAlimtalkSolapi(sc, [{ phone: phone, body: body, pfId: at.pfId, templateId: tplId, variables: vars }]);
    r.channel = '알림톡'; return r;
  }
  var r2 = sendViaProvider(sc, [{ name: '', phone: phone, body: body }]); r2.channel = ''; return r2;
}
/** 솔라피 카카오 알림톡(ATA). disableSms=false 라 카카오 발송이 안 되면 text 로 문자 대체 발송된다 */
function sendAlimtalkSolapi(cfg, list) {
  var ok = 0, failN = 0, detail = '', ids = [];
  try {
    var msgs = list.map(function (r) { return { to: r.phone, from: cfg.sender, text: r.body, type: 'ATA', kakaoOptions: { pfId: r.pfId, templateId: r.templateId, variables: r.variables || {}, disableSms: false } }; });
    var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'post', muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: solapiAuth(cfg) }, payload: JSON.stringify({ messages: msgs }),
    });
    var code = res.getResponseCode(), out = JSON.parse(res.getContentText() || '{}');
    if (code >= 200 && code < 300) { if (out.groupInfo && out.groupInfo._id) ids.push(String(out.groupInfo._id)); var failed = (out.failedMessageList || []).length; failN += failed; ok += list.length - failed; if (failed && out.failedMessageList[0]) detail = String(out.failedMessageList[0].errorMessage || out.failedMessageList[0].statusMessage || ''); }
    else { failN += list.length; detail = String(out.errorMessage || out.errorCode || code); }
  } catch (e) { failN += list.length; detail = String(e.message || e); }
  return { ok: ok, fail: failN, detail: detail, ids: ids };
}
function attVars(cfg, name, r) { return { '#{이름}': name, '#{시각}': r.due, '#{반}': r.className || '', '#{학원}': cfg.academy }; }
/** 한 대상(student|parent)에게 보내고 결과 글자를 돌려준다. 발송 기록(messages)도 남긴다 */
function attSendOne(cfg, sc, r, s, who, me, ids, fill) {
  var on = who === 'student' ? cfg.famStudent : cfg.famParent, label = who === 'student' ? '학생' : '학부모';
  if (!on) return '끔';
  var phone = phoneStr(who === 'student' ? s.phone : s.parentPhone); if (!phone) return label + ' 번호 없음';
  if (!smsReady(sc)) return '문자 API 미설정';
  var body = fill(who === 'student' ? cfg.msgStudent : cfg.msgParent), at = cfg.alimtalk || {};
  var res = attDeliver(cfg, sc, phone, body, who === 'student' ? at.tplStudent : at.tplParent, attVars(cfg, s.name || r.studentName || '', r));
  (res.ids || []).forEach(function (x) { ids.push(x); });
  appendRow('messages', { id: newId('M'), sentAt: new Date().toISOString(), kind: '미등원 안내' + (res.channel ? '(' + res.channel + ')' : ''), count: 1, recipients: (s.name || '') + '(' + label + '):' + phone, body: body, method: sc.provider, result: '성공 ' + res.ok + ' / 실패 ' + res.fail + (res.detail ? ' · ' + res.detail : ''), groupIds: (res.ids || []).join(','), sentBy: me ? me.id : 'attWatch' });
  return res.ok ? (res.channel ? res.channel + ' ' : '') + '발송 ' + nowHM() : '실패' + (res.detail ? ' · ' + res.detail : '');
}
/** 도착 처리 (태블릿 등원 시각을 안다). 수업 시작 전 도착이면 정상출석, 지나서면 지각출석 + 지각 몇 분 */
function attArrive(r, time, method, me) {
  var from = r.status, late = Math.max(0, hm2min(time) - hm2min(r.due));
  r.status = late > 0 ? '지각출석' : '정상출석'; r.arrivedAt = time; r.lateMin = late;
  r.note = str((r.note ? r.note + ' · ' : '') + method + ' 등원 ' + time + (late ? ' (지각 ' + late + '분)' : ''), 300);
  r.version = num(r.version) + 1; r.updatedAt = new Date().toISOString();
  attSyncAttendance(r, me);
  attLog(r, me, from, r.status, method + ' 등원 ' + time + (late ? ' · 지각 ' + late + '분' : ''));
}
var ATTW_OPEN = { 확인필요: 1, 미등원: 1, 지각예정: 1, 결석: 1, 시간변경: 1 };   // 아직 도착 전으로 보는 상태
/** 태블릿 등원이 찍히면 (kioskCheck) 오늘 그 학생의 열린 확인 행을 도착으로 바꾼다 */
function attOnArrival(sid, date, time, method) {
  var t = hm2min(time), best = null;
  attRowsOf(date).forEach(function (r) {
    if (r.studentId !== sid || !ATTW_OPEN[r.status]) return;
    var d = hm2min(r.due); if (t < d - 30 || t > d + 180) return;   // 이 수업 무렵에 온 것만 (다른 시간 수업 행은 그대로)
    if (!best || d > hm2min(best.due)) best = r;
  });
  if (!best) return null;
  if (best.status === '시간변경' && t < hm2min(best.due)) return null;   // 바뀐 시각 전 도착은 평소처럼 (행은 그대로)
  attArrive(best, time, method, null);
  upsertRow('attChecks', 'id', best);
  return best;
}
/** 출석부에서 출결을 고치면 (saveAttendance) 확인 행도 맞춘다. 도착 시각은 모르므로 추정하지 않는다 */
function attOnAttendance(date, classId, changes, me) {
  var rows = attRowsOf(date); if (!rows.length) return;
  var ups = [];
  changes.forEach(function (c) {
    rows.forEach(function (r) {
      if (r.studentId !== c.studentId || (r.classId !== classId && r.makeupId !== classId)) return;   // 반 출석부 또는 보강 출석부
      var from = r.status, to = '';
      if (/^(출석|지각|보강)$/.test(c.status)) to = from === '확인필요' ? '현장출석' : (from === '미등원' || from === '지각예정' || from === '결석') ? '지각출석' : '';
      else if (c.status === '결석' && (from === '확인필요' || from === '미등원')) to = '결석';
      if (!to) return;
      r.status = to; r.checkedBy = me.id; r.checkedByName = me.name; r.checkedAt = new Date().toISOString(); r.checkMethod = '출석부';
      if (!r.firstBy) r.firstBy = me.name + ' ' + nowHM();
      if (to === '지각출석') r.note = str((r.note ? r.note + ' · ' : '') + '출석부 ' + c.status + ' (도착 시각 모름)', 300);
      r.version = num(r.version) + 1; r.updatedAt = r.checkedAt;
      ups.push(r); attLog(r, me, from, to, '출석부에서 ' + c.status + ' 입력');
    });
  });
  if (ups.length) upsertMany('attChecks', 'id', ups);
}
/** 확인 결과를 출석부에 반영. 선생님이 직접 적은 출석부 기록은 덮어쓰지 않는다 (이 기능이 적은 것·태블릿이 적은 것만 고친다) */
function attSyncAttendance(r, me) {
  var key = r.makeupId || r.classId; if (!key) return;   // 보강은 보강 출석부(보강 id)에 적는다
  var ex = readRows('attendance').filter(function (a) { return a.date === r.date && a.classId === key && a.studentId === r.studentId; })[0];
  var arrived = r.status === '지각출석' || r.status === '정상출석';
  var want = r.status === '현장출석' ? '출석' : r.status === '결석' ? '결석' : arrived ? (num(r.lateMin) > 10 ? '지각' : '출석') : '';   // 지각 기준은 태블릿과 같게 (수업 시작 10분 뒤부터)
  var mine = ex && ex.updatedBy === 'attWatch';   // 태블릿이 적은 것(이미 같은 기준)·선생님이 적은 것은 그대로
  var note = arrived ? (r.lateMin ? '지각 ' + r.lateMin + '분' : '정시') + (r.arrivedAt ? ' (등원 ' + r.arrivedAt + ')' : '') : '미출결 확인: ' + r.status + (me ? ' · ' + me.name : '');
  if (want && (!ex || mine)) upsertRow('attendance', 'id', { id: ex ? ex.id : newId('A'), date: r.date, classId: key, studentId: r.studentId, status: want, note: note, updatedBy: 'attWatch', updatedAt: new Date().toISOString() });
  else if (!want && ex && ex.updatedBy === 'attWatch') deleteRows('attendance', function (a) { return a.id === ex.id; });
}
function attOut(r, logs) {
  return { id: r.id, date: r.date, studentId: r.studentId, studentName: r.studentName || '', classId: r.classId || '', className: r.className || '', makeupId: r.makeupId || '', teacherId: r.teacherId || '',
    due: r.due, status: r.status, reason: r.reason || '', detectedAt: r.detectedAt || '', alertTo: String(r.alertTo || '').split(',').filter(String), alert1At: r.alert1At || '', alert2At: r.alert2At || '',
    checkedBy: r.checkedBy || '', checkedByName: r.checkedByName || '', checkedAt: r.checkedAt || '', checkMethod: r.checkMethod || '', firstBy: r.firstBy || '',
    smsAt: r.smsAt || '', smsStudent: r.smsStudent || '', smsParent: r.smsParent || '', arrivedAt: r.arrivedAt || '', lateMin: r.lateMin === '' || r.lateMin == null ? null : num(r.lateMin),
    version: num(r.version), updatedAt: r.updatedAt || '', note: r.note || '', logs: logs || [],
    seen: String(r.seenBy || '').split(',').filter(String).map(function (x) { var p = x.split('@'); return { id: p[0], hm: p[1] || '' }; }) };
}
/** 한 건 처리 (잠금 안에서). 오늘 수업 계획에 있는 수업이면 행이 아직 없어도 만든다 (1차 전 사전 처리 · 자동 확인이 안 돈 경우) */
function attActOne(req, me, cfg, sc, plan) {
  var date = todayStr(), hm = nowHM(), nowIso = new Date().toISOString(), st = String(req.status || '');
  if (!ATTW_SET[st]) fail('bad_request', '알 수 없는 상태: ' + st);
  var rows = {}; attRowsOf(date).forEach(function (r) { rows[r.id] = r; });
  var id = String(req.id || '') || attRowId(date, String(req.studentId || ''), String(req.classId || ''), String(req.makeupId || ''));
  var r = rows[id];
  if (!r) {
    var s = plan.sessions.filter(function (x) { return x.id === id; })[0];
    if (!s) fail('bad_request', '오늘 수업 일정에서 찾을 수 없습니다. 새로고침 후 다시 해 주세요.');
    r = { id: id, date: date, studentId: s.sid, studentName: s.name, classId: s.classId, className: s.className, makeupId: s.makeupId, teacherId: s.teacherId, due: s.due, status: '', reason: s.kind, version: 0 };
  }
  if (!attCanSee(me, cfg, sc, r)) denyScope('학생');
  if (r.date !== date) fail('bad_request', '지난 날짜의 확인 기록은 바꿀 수 없습니다.');
  var ver = req.ver == null || req.ver === '' ? null : Number(req.ver);
  if (ver != null && ver !== num(r.version) && !req.force && r.checkedBy && r.checkedBy !== me.id)   // 그사이 다른 사람이 먼저 처리함
    return { conflict: true, row: attOut(r), message: (r.checkedByName || '다른 사람') + ' 님이 ' + attHM(r.checkedAt) + '에 이미 "' + r.status + '"(으)로 확인했습니다.' };
  if (st === '시간변경') {
    var due = str(req.due, 5); if (!isTime(due)) fail('bad_request', '바뀐 수업 시각을 넣으세요. (예: 19:00)');
    if (r.status && r.status !== '시간변경' && r.status !== '확인필요') fail('bad_request', '이미 확인된 수업은 시각을 바꿀 수 없습니다.');
    r.reason = (r.reason || '').split(' · ')[0] + ' · 시간변경 ' + r.due + '→' + due; r.due = due;
  }
  if (st === '확인필요' && me.role !== 'admin' && attRoleOf(me, cfg) !== 'desk') fail('forbidden', '확인 필요로 되돌리기는 원장·데스크만 할 수 있습니다.');
  var from = r.status;
  if (from === st && st !== '시간변경') return { row: attOut(r), same: true };
  r.status = st; r.checkedBy = me.id; r.checkedByName = me.name; r.checkedAt = nowIso;
  r.checkMethod = { admin: '원장', desk: '데스크', teacher: '담당교사' }[attRoleOf(me, cfg)];
  if (!r.firstBy) r.firstBy = me.name + ' ' + hm;
  if (req.note) r.note = str((r.note ? r.note + ' · ' : '') + req.note, 300);
  r.version = num(r.version) + 1; r.updatedAt = nowIso;
  upsertRow('attChecks', 'id', r);
  if (st !== '시간변경') attSyncAttendance(r, me);
  attLog(r, me, from, st, req.note || (hm2min(hm) < hm2min(r.due) ? '수업 전 미리 처리' : ''));
  if (st === '시간변경') attPlanDirty();
  var out = { row: attOut(r) };
  if (st === '미등원' && cfg.famSms) { var res = attSendFamily(r.id, cfg, me); out.sms = res.sent; r = findRow('attChecks', r.id) || r; out.row = attOut(r); }
  return out;
}
function attLogsOf(date) {
  var m = {}; readRowsSince('attCheckLog', date, 600).forEach(function (l) { if (l.date === date) (m[l.checkId] = m[l.checkId] || []).push({ at: l.at, byName: l.byName, from: l.from, to: l.to, note: l.note }); });
  return m;
}
ACADEMY_ACTIONS.attCheckAct = function (req, me) {
  var cfg = attCfg(), sc = scopeOf(me), plan = attPlan(todayStr());
  return attActOne(req, me, cfg, sc, plan);
};
/** 여러 명 한 번에 (예: "지금 교실에 없는 학생만 고르기" → 고른 학생 미등원, 나머지 현장출석). 먼저 처리된 행은 건너뛴다 */
ACADEMY_ACTIONS.attCheckBulk = function (req, me) {
  var cfg = attCfg(), sc = scopeOf(me), plan = attPlan(todayStr()), items = Array.isArray(req.items) ? req.items.slice(0, 80) : [];
  var out = { done: [], conflicts: [] };
  items.forEach(function (it) {
    var res = attActOne({ id: it.id, studentId: it.studentId, classId: it.classId, makeupId: it.makeupId, status: it.status, ver: it.ver, note: req.note }, me, cfg, sc, plan);
    if (res.conflict) out.conflicts.push(res); else out.done.push(res.row);
  });
  return out;
};
/** 배지: 내가 봐야 하는 "출결 확인 필요" 수 (1분마다). 트리거가 없으면 이 요청이 대신 확인을 돌린다 */
ACADEMY_ACTIONS.attWatchBadge = function (req, me) {
  attMaybeTick('dashboard');
  var cfg = attCfgCached(), sc = scopeOf(me), date = todayStr(), n = 0, mine = 0, late2 = 0, lastAlert = '', names = [];
  attRowsOf(date).forEach(function (r) {
    if (r.status !== '확인필요' || !attCanSee(me, cfg, sc, r)) return;
    n++; if (r.alert2At) late2++;
    if (String(r.alertTo || '').split(',').indexOf(me.id) >= 0) { mine++; if (names.length < 5) names.push(r.due + ' ' + (r.studentName || '')); var t = r.alert2At || r.alert1At || ''; if (t > lastAlert) lastAlert = t; }
  });
  return { on: cfg.on, n: n, mine: mine, stage2: late2, lastAlert: lastAlert, names: names, role: attRoleOf(me, cfg) };
};
/** 미출결 화면: 오늘(또는 지난 날짜) 확인 목록 + 요약 + 곧 시작할 수업(사전 처리용) */
ACADEMY_ACTIONS.attWatchList = function (req, me) {
  attMaybeTick('dashboard');
  var cfg = attCfg(), sc = scopeOf(me), today = todayStr(), date = isDate(String(req.date || '')) ? String(req.date) : today, role = attRoleOf(me, cfg);
  var hm = nowHM(), nowM = hm2min(hm), logs = attLogsOf(date), rowsById = {};
  var rows = attRowsOf(date).filter(function (r) { return attCanSee(me, cfg, sc, r); });
  rows.forEach(function (r) { rowsById[r.id] = r; });
  var sum = { 정상출석: 0, 확인필요: 0, 현장출석: 0, 미등원: 0, 지각예정: 0, 결석: 0, 알림제외: 0, 지각출석: 0, 시간변경: 0 };
  var upcoming = [], unchecked = [];
  if (date === today) {
    var plan = attPlan(date), ins = attCheckinsOf(date), att = {};
    readRows('attendance').forEach(function (a) { if (a.date === date) att[a.studentId + '|' + a.classId] = a; });
    plan.sessions.forEach(function (s) {
      if (!attCanSee(me, cfg, sc, { teacherId: s.teacherId, classId: s.classId })) return;
      var r = rowsById[s.id], d = hm2min(s.due);
      if (r && r.status !== '시간변경') return;
      var a = (s.makeupId && att[s.sid + '|' + s.makeupId]) || (s.classId ? att[s.sid + '|' + s.classId] : null), came = attInNow(ins[s.sid], hm);
      if (nowM < d + cfg.min1) { upcoming.push({ id: s.id, studentId: s.sid, name: s.name, classId: s.classId, className: s.className, makeupId: s.makeupId, teacherId: s.teacherId, due: s.due, kind: s.kind, orig: s.orig || '', in: !!came || !!(a && /^(출석|지각|보강)$/.test(a.status)), pre: a && a.status === '결석' ? '결석' : '' }); return; }
      if ((a && /^(출석|지각|보강|조퇴)$/.test(a.status)) || came) sum.정상출석++;
      else if (a && a.status === '결석') sum.결석++;
      else if (a && a.status) sum.정상출석++;
      else if (nowM <= d + attWin(cfg)) unchecked.push({ id: s.id, studentId: s.sid, name: s.name, classId: s.classId, className: s.className, makeupId: s.makeupId, teacherId: s.teacherId, due: s.due, kind: s.kind });
    });
  }
  rows.forEach(function (r) { if (sum[r.status] != null) sum[r.status]++; });
  var repeat = {};   // 최근 30일(오늘 제외) 미등원·지각·미확인이 cfg.repeatN 번 이상인 학생 → 목록·미리 처리에 "반복" 표시
  if (cfg.repeatN > 0) {
    var cnt = {}, since30 = addDaysStr(today, -30);
    readRowsSince('attChecks', since30, 3000).forEach(function (r) {
      if (r.date < since30 || r.date >= today || !/^(미등원|지각출석|확인필요)$/.test(r.status)) return;
      var c = cnt[r.studentId] || (cnt[r.studentId] = { n: 0, 미등원: 0, 지각출석: 0, 미확인: 0 });
      c.n++; c[r.status === '확인필요' ? '미확인' : r.status]++;
    });
    Object.keys(cnt).forEach(function (k) { if (cnt[k].n >= cfg.repeatN) repeat[k] = cnt[k]; });
  }
  var out = { date: date, today: today, now: hm, role: role, on: cfg.on, min1: cfg.min1, min2: cfg.min2, famSms: cfg.famSms, internalSms: cfg.internalSms, repeat: repeat, repeatN: cfg.repeatN, alimtalk: !!(cfg.alimtalk && cfg.alimtalk.on),
    rows: rows.map(function (r) { return attOut(r, logs[r.id]); }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : String(a.className).localeCompare(String(b.className), 'ko') || String(a.studentName).localeCompare(String(b.studentName), 'ko'); }),
    summary: sum, upcoming: upcoming, unchecked: unchecked, runner: attLastTick(), smsReady: smsReady(smsConfig()) };
  if (me.role === 'admin') { out.cfg = cfg; out.pushDevices = {}; try { readRows('pushSubs').forEach(function (s) { out.pushDevices[s.memberId] = (out.pushDevices[s.memberId] || 0) + 1; }); } catch (e) {} }
  out.myDevices = 0; try { out.myDevices = readRows('pushSubs').filter(function (s) { return s.memberId === me.id; }).length; } catch (e) {}
  return out;
};
/** 최근 N일(기본 30) 통계. studentId 가 있으면 그 학생만 (학생 상세 출결 탭) */
ACADEMY_ACTIONS.attWatchStats = function (req, me) {
  var cfg = attCfgCached(), sc = scopeOf(me), days = Math.max(1, Math.min(180, Math.round(num(req.days) || 30))), since = addDaysStr(todayStr(), -days + 1), until = todayStr(), sid = String(req.studentId || '');
  var month = /^\d{4}-\d{2}$/.test(String(req.month || '')) ? String(req.month) : '';
  if (month) { since = month + '-01'; until = addDaysStr(addDaysStr(since, 32).slice(0, 7) + '-01', -1); }   // 월별 리포트: 그 달 1일~말일
  if (sid) requireStudent(me, sid);
  var per = {}, byClass = {}, total = { 확인건수: 0, 미등원: 0, 지각출석: 0, 결석: 0, 현장출석: 0, 미확인: 0, 알림제외: 0, 지각예정: 0, lateMin: 0, smsSent: 0 };
  readRowsSince('attChecks', since, 5000).forEach(function (r) {
    if (r.date < since || r.date > until || (sid && r.studentId !== sid)) return;
    if (!sid && !attCanSee(me, cfg, sc, r)) return;
    var p = per[r.studentId] || (per[r.studentId] = { studentId: r.studentId, name: r.studentName || '', 미등원: 0, 지각출석: 0, 결석: 0, 현장출석: 0, 미확인: 0, 알림제외: 0, 지각예정: 0, lateMin: 0, smsSent: 0, items: [] });
    if (r.status === '확인필요') p.미확인++; else if (p[r.status] != null) p[r.status]++;
    if (r.status === '지각출석') p.lateMin += num(r.lateMin);
    if (/발송/.test(String(r.smsStudent) + String(r.smsParent))) p.smsSent++;
    var key = r.status === '확인필요' ? '미확인' : r.status, cn = r.className || '(반 없음)';
    var bc = byClass[cn] || (byClass[cn] = { className: cn, teacherId: r.teacherId || '', 확인건수: 0, 미등원: 0, 지각출석: 0, 결석: 0, 현장출석: 0, 미확인: 0, 알림제외: 0, 지각예정: 0, lateMin: 0 });
    bc.확인건수++; total.확인건수++; if (bc[key] != null) bc[key]++; if (total[key] != null) total[key]++;
    if (r.status === '지각출석') { bc.lateMin += num(r.lateMin); total.lateMin += num(r.lateMin); }
    if (/발송/.test(String(r.smsStudent) + String(r.smsParent))) total.smsSent++;
    p.items.push({ date: r.date, due: r.due, className: r.className || '', status: r.status, lateMin: r.lateMin === '' ? null : num(r.lateMin), arrivedAt: r.arrivedAt || '', checkedByName: r.checkedByName || '', sms: r.smsAt ? (r.smsStudent + ' / ' + r.smsParent) : '' });
  });
  var list = Object.keys(per).map(function (k) { var p = per[k]; p.items.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }); p.items = p.items.slice(0, month ? 40 : 20); return p; })
    .sort(function (a, b) { return (b.미등원 + b.지각출석 + b.미확인) - (a.미등원 + a.지각출석 + a.미확인); });
  return { since: since, until: until, month: month, days: days, students: list, total: total,
    classes: Object.keys(byClass).map(function (k) { return byClass[k]; }).sort(function (a, b) { return (b.미등원 + b.지각출석 + b.미확인) - (a.미등원 + a.지각출석 + a.미확인) || String(a.className).localeCompare(String(b.className), 'ko'); }) };
};
/** 알림 받은 사람이 목록을 열어 봤음 (읽음 기록). 받은 사람 목록(alertTo)에 있는 사람만, 행마다 처음 한 번 */
ACADEMY_ACTIONS.attSeen = function (req, me) {
  var ids = Array.isArray(req.ids) ? req.ids.map(String).slice(0, 100) : [], want = {}, hm = nowHM(), ups = [];
  ids.forEach(function (x) { want[x] = 1; });
  attRowsOf(todayStr()).forEach(function (r) {
    if (!want[r.id] || String(r.alertTo || '').split(',').indexOf(me.id) < 0) return;
    var seen = String(r.seenBy || '').split(',').filter(String);
    if (seen.some(function (x) { return x.split('@')[0] === me.id; })) return;
    seen.push(me.id + '@' + hm); r.seenBy = seen.join(','); ups.push(r);
  });
  if (ups.length) upsertMany('attChecks', 'id', ups);   // version 은 올리지 않는다 (확인 버튼 충돌 검사와 무관)
  return { n: ups.length };
};
/** 실패한 미등원 안내를 사람이 눌러 다시 보낸다 (자동 재발송은 하지 않는다 — 중복 방지). 아직 "발송" 이 아닌 대상에게만 */
ACADEMY_ACTIONS.attResendSms = function (req, me) {
  var cfg = attCfg(), sc = scopeOf(me);
  var r = attRowsOf(todayStr()).filter(function (x) { return x.id === String(req.id || ''); })[0];
  if (!r) fail('bad_request', '오늘 확인 기록에서 찾을 수 없습니다.');
  if (!attCanSee(me, cfg, sc, r)) denyScope('학생');
  if (r.status !== '미등원') fail('bad_request', '지금 "미등원" 상태인 학생만 다시 보낼 수 있습니다. (이미 도착했거나 상태가 바뀜)');
  if (!r.smsAt) fail('bad_request', '아직 보낸 적이 없습니다. 2차 시간에 자동으로 나갑니다.');
  var smsCfg = smsConfig(); if (!smsReady(smsCfg)) fail('bad_request', '문자 API가 설정되지 않았습니다.');
  var s = findRow('students', r.studentId) || {}, ids = String(r.smsIds || '').split(',').filter(String), done = [];
  var fill = function (t) { return String(t).replace(/\{학원\}/g, cfg.academy).replace(/\{이름\}/g, s.name || r.studentName || '').replace(/\{시각\}/g, r.due).replace(/\{반\}/g, r.className || ''); };
  var want = req.who === 'student' ? ['student'] : req.who === 'parent' ? ['parent'] : ['student', 'parent'];
  want.forEach(function (w) {
    var col = w === 'student' ? 'smsStudent' : 'smsParent', prev = String(r[col] || '');
    if (/발송/.test(prev) || prev === '끔') return;   // 이미 간 대상 · 설정에서 끈 대상은 보내지 않는다
    var one = {}; for (var k in cfg) one[k] = cfg[k]; one.famStudent = w === 'student'; one.famParent = w === 'parent';
    r[col] = attSendOne(one, smsCfg, r, s, w, me, ids, fill) + ' (다시 보냄)'; done.push(w === 'student' ? '학생' : '학부모');
  });
  if (!done.length) fail('bad_request', '다시 보낼 대상이 없습니다. (이미 발송됨 또는 설정에서 끔)');
  r.smsIds = ids.join(','); r.version = num(r.version) + 1; r.updatedAt = new Date().toISOString();
  upsertRow('attChecks', 'id', r);
  attLog(r, me, '미등원', '미등원', '문자 다시 보냄(' + done.join('·') + '): 학생 ' + r.smsStudent + ' / 학부모 ' + r.smsParent);
  return { row: attOut(r) };
};
/** 원장: 지금 입력한 설정의 문구(알림톡이면 알림톡)로 테스트 한 통 */
ACADEMY_ACTIONS.attTestFamily = function (req, me) {
  requireAdmin(me);
  var cfg = req.cfg ? attCfgClean(req.cfg) : attCfg(), sc = smsConfig(); if (!smsReady(sc)) fail('bad_request', '문자 API가 설정되지 않았습니다. (문자 → 문자 API 설정)');
  var phone = phoneStr(req.phone); if (!/^\d{9,12}$/.test(phone)) fail('bad_request', '받는 번호를 확인하세요.');
  var who = req.who === 'student' ? 'student' : 'parent', r = { due: nowHM(), className: '테스트반' };
  var body = String(who === 'student' ? cfg.msgStudent : cfg.msgParent).replace(/\{학원\}/g, cfg.academy).replace(/\{이름\}/g, '홍길동').replace(/\{시각\}/g, r.due).replace(/\{반\}/g, '테스트반');
  var res = attDeliver(cfg, sc, phone, body, who === 'student' ? cfg.alimtalk.tplStudent : cfg.alimtalk.tplParent, attVars(cfg, '홍길동', r));
  appendRow('messages', { id: newId('M'), sentAt: new Date().toISOString(), kind: '테스트(미등원 안내' + (res.channel ? '·' + res.channel : '') + ')', count: 1, recipients: '테스트:' + phone, body: body, method: sc.provider, result: '성공 ' + res.ok + ' / 실패 ' + res.fail + (res.detail ? ' · ' + res.detail : ''), groupIds: (res.ids || []).join(','), sentBy: me.id });
  return { ok: res.ok, fail: res.fail, detail: res.detail, channel: res.channel || '문자', body: body };
};
ACADEMY_ACTIONS.attWatchSaveCfg = function (req, me) {
  requireAdmin(me);
  var c = attCfgClean(req.cfg || {});
  upsertRow('settings', 'key', { key: 'attWatch', value: JSON.stringify(c) });
  attPlanDirty();
  return c;
};
/** 원장: 지금 바로 한 번 확인 (트리거를 기다리지 않고) */
ACADEMY_ACTIONS.attWatchRun = function (req, me) {
  requireAdmin(me);
  try { CacheService.getScriptCache().remove('attCfg'); } catch (e) {}
  return attendanceWatchTick({ source: 'manual', locked: true }) || {};
};

// =====================================================================
// ---------- 웹 푸시 (VAPID · 외부 서비스 없이) ----------
// 기기(크롬·안드로이드·아이폰 홈 화면 앱)가 받은 푸시 구독 주소로 서버가 직접 "깨우기" 신호를 보낸다.
// 내용(학생 이름)은 보내지 않는다(암호화 불필요) — 신호를 받은 기기의 서비스 워커가 로그인 토큰으로 배지를 읽어 알림을 띄운다.
// 푸시 서비스(구글·애플)에 보내는 요청은 VAPID(ES256 서명)가 필요한데, Apps Script 는 타원곡선 서명·BigInt 를 지원하지 않아
// P-256 서명을 아래에 직접 구현했다 (16비트 조각 몽고메리 곱셈). 비밀키는 스크립트 속성 PUSH_VAPID_D 에만 있다 (코드·시트·화면에 없음).
// =====================================================================
var P256 = (function () {
  var W = 65536, N = 16;
  function hexTo(h) { h = ('0'.repeat(64) + h).slice(-64); var a = []; for (var i = 0; i < N; i++) a.push(parseInt(h.substr(64 - 4 * (i + 1), 4), 16)); return a; }
  function bytesTo(b) { var a = []; for (var i = 0; i < N; i++) a.push(((b[31 - 2 * i - 1] & 255) << 8) | (b[31 - 2 * i] & 255)); return a; }
  function toBytes(a) { var b = []; for (var i = N - 1; i >= 0; i--) { b.push((a[i] >> 8) & 255); b.push(a[i] & 255); } return b; }
  function cmp(a, b) { for (var i = N - 1; i >= 0; i--) { if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; } return 0; }
  function isZero(a) { for (var i = 0; i < N; i++) if (a[i]) return false; return true; }
  function subRaw(a, b) { var r = [], br = 0; for (var i = 0; i < N; i++) { var d = a[i] - b[i] - br; if (d < 0) { d += W; br = 1; } else br = 0; r.push(d); } return r; }
  function addRaw(a, b) { var r = [], c = 0; for (var i = 0; i < N; i++) { var s = a[i] + b[i] + c; r.push(s & 0xffff); c = s >>> 16; } return { r: r, c: c }; }
  var proto = {
    add: function (a, b) { var s = addRaw(a, b); return s.c || cmp(s.r, this.m) >= 0 ? subRaw(s.r, this.m) : s.r; },
    sub: function (a, b) { return cmp(a, b) >= 0 ? subRaw(a, b) : addRaw(subRaw(a, b), this.m).r; },
    mul: function (a, b) {   // 몽고메리 곱 a·b·R^-1 mod m (CIOS)
      var m = this.m, t = new Array(N + 2).fill(0), i, j, s, C, q;
      for (i = 0; i < N; i++) {
        C = 0; var bi = b[i];
        for (j = 0; j < N; j++) { s = t[j] + a[j] * bi + C; t[j] = s % W; C = Math.floor(s / W); }
        s = t[N] + C; t[N] = s % W; t[N + 1] = Math.floor(s / W);
        q = (t[0] * this.m0) % W;
        s = t[0] + q * m[0]; C = Math.floor(s / W);
        for (j = 1; j < N; j++) { s = t[j] + q * m[j] + C; t[j - 1] = s % W; C = Math.floor(s / W); }
        s = t[N] + C; t[N - 1] = s % W; C = Math.floor(s / W);
        t[N] = t[N + 1] + C; t[N + 1] = 0;
      }
      var r = t.slice(0, N);
      return t[N] || cmp(r, m) >= 0 ? subRaw(r, m) : r;
    },
    to: function (a) { return this.mul(a, this.r2); },
    from: function (a) { return this.mul(a, [1].concat(new Array(N - 1).fill(0))); },
    inv: function (a) {   // 페르마: a^(m-2) (몽고메리 형태 그대로)
      var e = subRaw(this.m, [2].concat(new Array(N - 1).fill(0))), r = this.one;
      for (var i = N - 1; i >= 0; i--) for (var bit = 15; bit >= 0; bit--) { r = this.mul(r, r); if ((e[i] >> bit) & 1) r = this.mul(r, a); }
      return r;
    },
  };
  // 법 m 의 몽고메리 문맥: m0 = -m^-1 mod 2^16 (뉴턴), r2 = R^2 mod m, one = R mod m
  function ctxP(hex) { var c = Object.create(proto); c.m = hexTo(hex); var inv = 1; for (var k = 0; k < 5; k++) inv = (inv * ((2 - ((c.m[0] * inv) % W) + W) % W)) % W; c.m0 = (W - inv) % W; var x = [1].concat(new Array(N - 1).fill(0)); for (var i = 0; i < 512; i++) x = c.add(x, x); c.r2 = x; c.one = c.mul([1].concat(new Array(N - 1).fill(0)), c.r2); return c; }
  var F = ctxP('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
  var Nn = ctxP('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  var G = { x: F.to(hexTo('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296')), y: F.to(hexTo('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')), z: F.one };
  function dbl(P) {
    if (!P || isZero(P.y)) return null;
    var delta = F.mul(P.z, P.z), gamma = F.mul(P.y, P.y), beta = F.mul(P.x, gamma);
    var t = F.mul(F.sub(P.x, delta), F.add(P.x, delta)), alpha = F.add(F.add(t, t), t);
    var b4 = F.add(F.add(beta, beta), F.add(beta, beta)), b8 = F.add(b4, b4);
    var x3 = F.sub(F.mul(alpha, alpha), b8);
    var yz = F.add(P.y, P.z), z3 = F.sub(F.sub(F.mul(yz, yz), gamma), delta);
    var g2 = F.mul(gamma, gamma), g8 = F.add(F.add(F.add(g2, g2), F.add(g2, g2)), F.add(F.add(g2, g2), F.add(g2, g2)));
    return { x: x3, y: F.sub(F.mul(alpha, F.sub(b4, x3)), g8), z: z3 };
  }
  function add(P, Q) {
    if (!P) return Q; if (!Q) return P;
    var z1z1 = F.mul(P.z, P.z), z2z2 = F.mul(Q.z, Q.z), u1 = F.mul(P.x, z2z2), u2 = F.mul(Q.x, z1z1);
    var s1 = F.mul(F.mul(P.y, Q.z), z2z2), s2 = F.mul(F.mul(Q.y, P.z), z1z1), h = F.sub(u2, u1), rr = F.sub(s2, s1);
    if (isZero(h)) return isZero(rr) ? dbl(P) : null;
    var h2 = F.add(h, h), i = F.mul(h2, h2), j = F.mul(h, i), r = F.add(rr, rr), v = F.mul(u1, i);
    var x3 = F.sub(F.sub(F.mul(r, r), j), F.add(v, v));
    var sj = F.mul(s1, j), y3 = F.sub(F.mul(r, F.sub(v, x3)), F.add(sj, sj));
    var zz = F.add(P.z, Q.z), z3 = F.mul(F.sub(F.sub(F.mul(zz, zz), z1z1), z2z2), h);
    return { x: x3, y: y3, z: z3 };
  }
  function mulPt(k, P) { var R = null; for (var i = N - 1; i >= 0; i--) for (var bit = 15; bit >= 0; bit--) { R = dbl(R); if ((k[i] >> bit) & 1) R = add(R, P); } return R; }
  function affine(P) { var zi = F.inv(P.z), zi2 = F.mul(zi, zi); return { x: F.from(F.mul(P.x, zi2)), y: F.from(F.mul(P.y, F.mul(zi2, zi))) }; }
  function modN(a) { return cmp(a, Nn.m) >= 0 ? subRaw(a, Nn.m) : a; }
  function sha(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return b & 255; }); }
  return {
    /** 새 비밀키(32바이트)와 공개키(65바이트, 04||x||y) */
    keygen: function () {
      var seed = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random();
      var d = modN(bytesTo(sha(Utilities.newBlob(seed).getBytes())));
      if (isZero(d)) return this.keygen();
      return { d: toBytes(d), pub: this.pub(toBytes(d)) };
    },
    pub: function (dBytes) { var Q = affine(mulPt(bytesTo(dBytes), G)); return [4].concat(toBytes(Q.x), toBytes(Q.y)); },
    /** ES256 서명 (r||s 64바이트). 논스 k = SHA256(d || z || i) mod n (비밀키에서 결정적으로 → 같은 k 재사용 없음) */
    sign: function (msgBytes, dBytes) {
      var z = modN(bytesTo(sha(msgBytes))), d = bytesTo(dBytes);
      for (var ctr = 0; ctr < 100; ctr++) {
        var k = modN(bytesTo(sha(dBytes.concat(toBytes(z), [ctr]))));
        if (isZero(k)) continue;
        var R = affine(mulPt(k, G)), r = modN(R.x); if (isZero(r)) continue;
        var km = Nn.to(k), s = Nn.from(Nn.mul(Nn.inv(km), Nn.add(Nn.to(z), Nn.mul(Nn.to(r), Nn.to(d)))));
        if (isZero(s)) continue;
        return toBytes(r).concat(toBytes(s));
      }
      throw new Error('sign failed');
    },
  };
})();
ACADEMY_SHEETS.pushSubs = ['id', 'memberId', 'endpoint', 'p256dh', 'auth', 'ua', 'createdAt', 'lastOk', 'fails'];   // 기기별 푸시 구독 (아이디 1명이 여러 기기)
var PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)(\/|$)/i;   // 브라우저 푸시 서비스 주소만 받는다
var PUSH_SUB = 'https://mmmath0110-del.github.io/mmmath01/';   // VAPID 연락처(sub) — 앱 주소
function b64url(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function hexOf(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function bytesOfHex(h) { var o = []; for (var i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }
/** VAPID 키 (처음 한 번 만들어 스크립트 속성에 둔다). 공개키만 밖으로 나간다 */
function vapidKeys(create) {
  var P = PropertiesService.getScriptProperties(), d = P.getProperty('PUSH_VAPID_D'), pub = P.getProperty('PUSH_VAPID_PUB');
  if ((!d || !pub) && create) { var k = P256.keygen(); d = hexOf(k.d); pub = b64url(k.pub); P.setProperties({ PUSH_VAPID_D: d, PUSH_VAPID_PUB: pub }); }
  return d && pub ? { d: d, pub: pub } : null;
}
/** 푸시 서비스(주소 origin)별 VAPID 토큰. 서명이 느리므로(수 초) 20시간짜리를 만들어 18시간 동안 다시 쓴다 */
function vapidJwt(aud, keys) {
  var P = PropertiesService.getScriptProperties(), all = {};
  try { all = JSON.parse(P.getProperty('PUSH_JWTS') || '{}') || {}; } catch (e) { all = {}; }
  var now = Math.floor(Date.now() / 1000), hit = all[aud];
  if (hit && hit.exp - now > 2 * 3600 && hit.k === keys.pub.slice(-8)) return hit.jwt;
  var enc = function (o) { return b64url(Utilities.newBlob(JSON.stringify(o)).getBytes()); };
  var input = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: aud, exp: now + 20 * 3600, sub: PUSH_SUB });
  var jwt = input + '.' + b64url(P256.sign(Utilities.newBlob(input).getBytes().map(function (b) { return b & 255; }), bytesOfHex(keys.d)));
  all[aud] = { jwt: jwt, exp: now + 20 * 3600, k: keys.pub.slice(-8) };
  Object.keys(all).forEach(function (k) { if (all[k].exp < now) delete all[k]; });
  P.setProperty('PUSH_JWTS', JSON.stringify(all));
  return jwt;
}
/**
 * 아이디들의 모든 기기로 "깨우기" 푸시를 보낸다 (내용 없음). 기기가 깨어나면 서비스 워커가 배지를 읽어 알림을 띄운다.
 * 푸시 서비스가 404·410 을 주면 그 구독은 끝난 것이므로 지운다. 결과 { sent, failed, removed }
 */
function pushSend(memberIds) {
  var want = {}; (memberIds || []).forEach(function (x) { if (x) want[x] = 1; });
  var subs = readRows('pushSubs').filter(function (s) { return want[s.memberId] && PUSH_HOSTS.test(s.endpoint); });
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };
  var keys = vapidKeys(false); if (!keys) return { sent: 0, failed: subs.length, removed: 0 };
  var reqs = subs.map(function (s) {
    var aud = s.endpoint.match(/^https:\/\/[^\/]+/)[0];
    return { url: s.endpoint, method: 'post', muteHttpExceptions: true, payload: '', headers: { Authorization: 'vapid t=' + vapidJwt(aud, keys) + ', k=' + keys.pub, TTL: '1800', Urgency: 'high' } };
  });
  var res = []; try { res = UrlFetchApp.fetchAll(reqs); } catch (e) { return { sent: 0, failed: subs.length, removed: 0, error: String(e.message || e) }; }
  var out = { sent: 0, failed: 0, removed: 0 }, gone = {}, ups = [], now = new Date().toISOString();
  res.forEach(function (r, i) {
    var code = r.getResponseCode(), s = subs[i];
    if (code >= 200 && code < 300) { out.sent++; s.lastOk = now; s.fails = 0; ups.push(s); }
    else if (code === 404 || code === 410) { out.removed++; gone[s.id] = 1; }
    else { out.failed++; s.fails = num(s.fails) + 1; ups.push(s); if (!out.detail) out.detail = code + ' ' + String(r.getContentText() || '').slice(0, 120); }
  });
  if (Object.keys(gone).length) deleteRows('pushSubs', function (s) { return gone[s.id]; });
  if (ups.length) upsertMany('pushSubs', 'id', ups.filter(function (s) { return !gone[s.id]; }));
  return out;
}
/** 공개키 (기기가 구독할 때 필요). 처음 부르면 키를 만든다 — 쓰기 요청이라 잠금 안에서 한 번만 만들어진다 */
ACADEMY_ACTIONS.pushKey = function (req, me) { return { key: vapidKeys(true).pub }; };
/** 이 기기의 푸시 구독 저장 (같은 주소면 갱신). 아이디마다 최대 10대 — 넘으면 오래된 것부터 뺀다 */
ACADEMY_ACTIONS.pushSubscribe = function (req, me) {
  var sub = req.sub || {}, ep = str(sub.endpoint, 1000), keys = sub.keys || {};
  if (!PUSH_HOSTS.test(ep)) fail('bad_request', '지원하지 않는 푸시 주소입니다.');
  var rows = readRows('pushSubs'), hit = rows.filter(function (r) { return r.endpoint === ep; })[0], now = new Date().toISOString();
  var row = hit || { id: newId('U'), createdAt: now, fails: 0 };
  row.memberId = me.id; row.endpoint = ep; row.p256dh = str(keys.p256dh, 200); row.auth = str(keys.auth, 100); row.ua = str(req.ua, 120); row.fails = 0;
  upsertRow('pushSubs', 'id', row);
  var mine = readRows('pushSubs').filter(function (r) { return r.memberId === me.id; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  if (mine.length > 10) { var drop = {}; mine.slice(10).forEach(function (r) { drop[r.id] = 1; }); deleteRows('pushSubs', function (r) { return drop[r.id]; }); }
  return { ok: true, devices: Math.min(mine.length, 10) };
};
ACADEMY_ACTIONS.pushUnsubscribe = function (req, me) {
  var ep = String(req.endpoint || '');
  deleteRows('pushSubs', function (r) { return r.endpoint === ep && (r.memberId === me.id || me.role === 'admin'); });
  return { ok: true };
};
/** 내 기기들로 테스트 푸시 */
ACADEMY_ACTIONS.pushTest = function (req, me) { var r = pushSend([me.id]); r.devices = readRows('pushSubs').filter(function (s) { return s.memberId === me.id; }).length; return r; };

// ---------- 블로그 원고 작성기 (docs/blog.html) ----------
/**
 * 블로그 소재용 학원 자료. 원장만. 개인을 알아볼 수 있는 정보(학생 이름·연락처·개별 점수·상담 내용)는 내려주지 않고
 * 반·일정·집계만 준다. 시험 결과는 응시 5명 이상인 시험·반만 (적은 인원의 평균은 개인 점수를 짐작할 수 있으므로).
 */
var BLOG_MIN_N = 5;
var BLOG_EVENT_TYPES = { '시험': 1, '특강': 1, '휴원': 1, '시험기간': 1 };   // 상담·특이사항은 학생 이름이 들어갈 수 있어 뺀다
ACADEMY_SHEETS.blogPosts = ['id', 'createdAt', 'updatedAt', 'keyword', 'type', 'title', 'titles', 'body', 'meta', 'tags', 'alt', 'todo', 'sources', 'status', 'url', 'publishedAt', 'createdBy'];
function blogYmd(v) { return isDateObj(v) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : normDate(v); }
function blogProfile() {
  var row = readRows('settings').filter(function (r) { return r.key === 'blogProfile'; })[0];
  var o = null; if (row) { try { o = JSON.parse(row.value); } catch (e) { o = null; } }
  return o && typeof o === 'object' ? o : { name: adminMeta().academy || '더블엠수학학원', area: '', intro: '', strengths: '', method: '', contact: '', notes: '' };
}
ACADEMY_ACTIONS.blogContext = function (req, me) {
  requireAdmin(me);
  var today = todayStr(), from = addDaysStr(today, -21), to = addDaysStr(today, 120);
  var students = readRows('students').filter(function (s) { return (s.status || '재원') === '재원'; });
  var byGrade = {}; students.forEach(function (s) { var g = s.grade || '학년 미상'; byGrade[g] = (byGrade[g] || 0) + 1; });
  var active = {}; students.forEach(function (s) { active[s.id] = 1; });
  var classSize = {}; readEnr().forEach(function (e) { if (isActiveEnr(e, today) && active[e.studentId]) classSize[e.classId] = (classSize[e.classId] || 0) + 1; });
  var classes = readRows('classes').filter(function (c) { return c.status !== '종료'; }).map(function (c) {
    var o = classOut(c);
    return { id: o.id, name: o.name, subject: o.subject, kind: o.kind, slots: o.slots.map(function (x) { return x.day + (x.start ? ' ' + x.start + (x.end ? '~' + x.end : '') : ''); }).join(', '),
      textbook: o.textbook, progress: o.progress, size: classSize[o.id] || 0 };
  });
  var classNames = {}; classes.forEach(function (c) { classNames[c.name] = 1; });
  var safeTarget = function (t) { t = String(t || '').trim(); return !t || classNames[t] || /전체|학년|부|반|[초중고]\s*\d/.test(t) ? t : ''; };
  var events = readRows('events').map(function (e) { return { date: blogYmd(e.date), endDate: blogYmd(e.endDate), type: e.type || '', title: e.title || '', school: e.school || '', target: safeTarget(e.target) }; })
    .filter(function (e) { return BLOG_EVENT_TYPES[e.type] && e.date && (e.endDate || e.date) >= from && e.date <= to; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var tests = readRows('tests').map(function (t) { return { date: blogYmd(t.date), title: t.title || '', type: t.type || '', target: safeTarget(t.target), scope: t.scope || '' }; })
    .filter(function (t) { return t.date && t.date >= from && t.date <= to; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var ctx = examCtx(), byExam = {}; readRows('scores').forEach(function (r) { (byExam[r.examId] || (byExam[r.examId] = [])).push(r); });
  var examFrom = addDaysStr(today, -120);
  var exams = readRows('exams').map(examOut).filter(function (e) { return blogYmd(e.date) >= examFrom; }).map(function (e) {
    var st = examStats(e, byExam[e.id] || [], ctx);
    if (st.overall.n < BLOG_MIN_N) return null;
    return { date: blogYmd(e.date), name: e.name, maxScore: e.maxScore, n: st.overall.n, avg: st.overall.avg,
      byClass: st.byClass.filter(function (c) { return c.n >= BLOG_MIN_N; }).map(function (c) { return { className: c.className, n: c.n, avg: c.avg }; }),
      weakUnits: st.byUnit.filter(function (u) { return u.rate != null && u.unit !== '(단원 없음)'; }).slice(0, 3).map(function (u) { return { unit: u.unit, rate: u.rate }; }) };
  }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 12);
  return { today: today, profile: blogProfile(), students: { total: students.length, byGrade: byGrade }, classes: classes, events: events, tests: tests, exams: exams,
    textbooks: readRows('textbooks').map(textbookOut).map(function (t) { return t.name; }) };
};
ACADEMY_ACTIONS.saveBlogProfile = function (req, me) {
  requireAdmin(me);
  var p = req.profile || {}, o = {};
  ['name', 'area', 'intro', 'strengths', 'method', 'contact', 'notes'].forEach(function (k) { o[k] = str(p[k], 2000); });
  upsertRow('settings', 'key', { key: 'blogProfile', value: JSON.stringify(o) });
  return o;
};
function blogPostOut(r) {
  var arr = function (v) { try { var a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  return { id: r.id, createdAt: r.createdAt || '', updatedAt: r.updatedAt || '', keyword: r.keyword || '', type: r.type || '', title: r.title || '', titles: arr(r.titles),
    body: r.body || '', meta: r.meta || '', tags: r.tags || '', alt: r.alt || '', todo: r.todo || '', sources: arr(r.sources),
    status: r.status || '초안', url: r.url || '', publishedAt: blogYmd(r.publishedAt) };
}
ACADEMY_ACTIONS.listBlogPosts = function (req, me) {
  requireAdmin(me);
  return readRows('blogPosts').map(blogPostOut).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 200);
};
ACADEMY_ACTIONS.saveBlogPost = function (req, me) {
  requireAdmin(me);
  var p = req.post || {}, now = new Date().toISOString();
  var id = str(p.id, 40) || newId('BP'), cur = findRow('blogPosts', id);
  var row = { id: id, createdAt: cur ? cur.createdAt : now, updatedAt: now, keyword: str(p.keyword, 100), type: str(p.type, 20), title: str(p.title, 200),
    titles: JSON.stringify((p.titles || []).slice(0, 5).map(function (t) { return str(t, 200); })), body: str(p.body, 40000), meta: str(p.meta, 500), tags: str(p.tags, 1000),
    alt: str(p.alt, 3000), todo: str(p.todo, 3000), sources: JSON.stringify((p.sources || []).slice(0, 10).map(function (s) { return { url: str(s.url, 500), title: str(s.title, 200) }; })),
    status: p.status === '발행' ? '발행' : '초안', url: str(p.url, 500), publishedAt: p.status === '발행' ? (normDate(p.publishedAt) || (cur && blogYmd(cur.publishedAt)) || todayStr()) : '',
    createdBy: cur ? cur.createdBy : me.id };
  upsertRow('blogPosts', 'id', row);
  return blogPostOut(row);
};
ACADEMY_ACTIONS.deleteBlogPost = function (req, me) {
  requireAdmin(me);
  var id = str(req.id, 40); deleteRows('blogPosts', function (r) { return r.id === id; });
  return { id: id };
};
ATTW_KEEP_PLAN.saveBlogProfile = 1; ATTW_KEEP_PLAN.saveBlogPost = 1; ATTW_KEEP_PLAN.deleteBlogPost = 1;

// =====================================================================
// ---------- 문자 도착 결과 (솔라피) ----------
// 발송 기록의 "성공" 은 문자 회사가 접수했다는 뜻이다. 그 뒤 통신사 단계(스팸 차단 · 수신 거부 · 없는 번호 · 전원 꺼짐 등)에서
// 실패하면 여기서 확인해야 보인다. 솔라피 메시지 목록 API(GET /messages/v4/list)로 받는 번호별 상태를 읽어
// messages.delivery 에 "도착 · 도착 실패 N · 사유" 로 요약해 둔다. statusCode 4000 = 수신 완료, 2000·3000 = 처리 중, 그 밖 = 실패
// 발송 묶음 번호(groupIds)가 없는 예전 기록은 받는 번호의 최근 메시지 중 보낸 시각이 가장 가까운 것으로 찾는다.
// =====================================================================
function solapiList(cfg, query) {
  var qs = Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
  var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/list?' + qs, { method: 'get', muteHttpExceptions: true, headers: { Authorization: solapiAuth(cfg) } });
  var code = res.getResponseCode(), out = {};
  try { out = JSON.parse(res.getContentText() || '{}'); } catch (e) { out = {}; }
  if (code >= 300) throw new Error('솔라피 조회 실패: ' + (out.errorMessage || out.errorCode || code));
  var ml = out.messageList || {};
  return (Array.isArray(ml) ? ml : Object.keys(ml).map(function (k) { return ml[k]; }));
}
function solapiState(m) {
  var code = String(m.statusCode || ''), st = String(m.status || '').toUpperCase();
  if (code === '4000') return { k: 'ok' };
  if (code === '2000' || code === '3000' || (!code && /PENDING|SENDING|PROCESSING/.test(st))) return { k: 'wait' };
  return { k: 'fail', reason: str(m.statusMessage || m.reason || ('오류 ' + code), 60) };
}
/** 한 기록의 도착 결과. { text, final, items:[{name, tail, k, reason}] } */
function deliveryOf(row, cfg) {
  var names = {}; String(row.recipients || '').split(';').forEach(function (x) { var p = x.split(':'); if (p[1]) names[phoneStr(p[1])] = p[0]; });
  var found = [], gids = String(row.groupIds || '').split(',').filter(String);
  if (gids.length) gids.slice(0, 5).forEach(function (g) { found = found.concat(solapiList(cfg, { groupId: g, limit: 500 })); });
  else {
    var t0 = Date.parse(row.sentAt);
    Object.keys(names).slice(0, 20).forEach(function (ph) {   // 예전 기록: 그 번호로 간 최근 메시지 중 보낸 시각이 가장 가까운 것 (10분 안)
      var best = null, bd = 1e15;
      solapiList(cfg, { to: ph, limit: 50 }).forEach(function (m) { var d = Math.abs(Date.parse(m.dateCreated || m.dateReceived || '') - t0); if (!isNaN(d) && d < bd) { bd = d; best = m; } });
      if (best && bd <= 10 * 60 * 1000) found.push(best);
    });
  }
  var items = found.map(function (m) { var s = solapiState(m), ph = phoneStr(m.to); return { name: names[ph] || '', tail: ph.slice(-4), k: s.k, reason: s.reason || '' }; });
  var ok = items.filter(function (x) { return x.k === 'ok'; }).length, wait = items.filter(function (x) { return x.k === 'wait'; }).length, bad = items.filter(function (x) { return x.k === 'fail'; });
  var text;
  if (!items.length) text = '조회 결과 없음';
  else if (items.length === 1) text = ok ? '도착' : wait ? '처리 중' : '도착 실패 · ' + bad[0].reason;
  else {
    var reasons = {}; bad.forEach(function (x) { reasons[x.reason] = (reasons[x.reason] || []).concat([x.name || x.tail]); });
    text = ['도착 ' + ok, wait ? '처리 중 ' + wait : '', bad.length ? '도착 실패 ' + bad.length + ' · ' + Object.keys(reasons).map(function (r) { return r + '(' + reasons[r].slice(0, 5).join(', ') + (reasons[r].length > 5 ? ' 외' : '') + ')'; }).join(' / ') : ''].filter(String).join(' · ');
  }
  return { text: str(text, 300), final: !wait && items.length > 0, items: items };
}
/** [도착 확인] 발송 기록 여러 건의 실제 도착 결과를 솔라피에서 읽어 기록에 남긴다. 강사는 자기가 보낸 것만 */
ACADEMY_ACTIONS.smsDelivery = function (req, me) {
  var cfg = smsConfig(); if (cfg.provider !== 'solapi' || !smsReady(cfg)) fail('bad_request', '도착 결과 조회는 솔라피 문자 서비스에서만 됩니다.');
  var want = {}; (Array.isArray(req.ids) ? req.ids : []).slice(0, 20).forEach(function (x) { want[String(x)] = 1; });
  var sc = scopeOf(me), out = {}, ups = [], now = new Date().toISOString();
  readRows('messages').forEach(function (r) {
    if (!want[r.id] || r.method !== 'solapi' || (sc && r.sentBy !== me.id)) return;
    try { var d = deliveryOf(r, cfg); r.delivery = d.text; r.deliveryAt = now; ups.push(r); out[r.id] = { delivery: d.text, final: d.final, deliveryAt: now, items: d.items }; }
    catch (e) { out[r.id] = { error: String(e.message || e) }; }
  });
  if (ups.length) upsertMany('messages', 'id', ups);
  return out;
};
