// 실제 운영 시트와 같은 탭·제목줄·값 형식으로 만든 가짜 학원 파일 (개인정보 없음).
// 일부러 넣은 문제: 앞자리 0 이 빠진 전화번호, 날짜 셀·한국어 날짜 글자, 중복 id, 없는 학생을 가리키는 행, 평문 PIN.
import ExcelJS from 'exceljs';

export async function makeFixture(file) {
  const wb = new ExcelJS.Workbook();
  const add = (name, header, rows) => { const ws = wb.addWorksheet(name); ws.addRow(header); rows.forEach((r) => ws.addRow(r)); };
  const d = (y, m, day, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, day, h, mi));   // 구글 시트 → xlsx 의 날짜 셀과 같은 모양

  add('시트1', [], []);
  add('members', ['id', 'name', 'role', 'color', 'active', 'salt', 'pwHash', 'createdAt', 'pinSalt', 'pinHash', 'phone'], [
    ['admin01', '원장', 'admin', '#2A4BB8', true, 'salt1', 'hash1', '2026-09-09T05:00:00.000Z', '', '', 1031680000],
    ['teach01', '김선생', 'teacher', '#aa0000', true, 'salt2', 'hash2', '2026-09-09T05:00:00.000Z', '', '', '010-2222-3333'],
    ['teach02', '이선생', 'teacher', '#00aa00', 'FALSE', 'salt3', 'hash3', '2026-09-09T05:00:00.000Z', '', '', ''],
  ]);
  add('students', ['id', 'name', 'status', 'school', 'grade', 'birth', 'phone', 'parentPhone', 'parentName', 'enrolledAt', 'leftAt', 'memo', 'createdAt', 'updatedAt', 'extId'], [
    ['S0000000001', '가학생', '재원', '가나초', '초3', '', '', 1099990001, '', '2026-09-10', '', '메모', '2026-09-10T01:00:00.000Z', '2026-09-10T01:00:00.000Z', 'S0001'],
    ['S0000000002', '나학생', '재원', '다라중', '중1', d(2013, 3, 1), '010-1234-0002', '010-9999-0002', '나부모', d(2026, 9, 10), '', '', '2026-09-10T01:00:00.000Z', '', 'S0002'],
    ['S0000000003', '다학생', '퇴원', '다라중', '중2', '', '', '01099990003', '', '2026. 9. 1', '2026. 9. 20', '', '2026-09-10T01:00:00.000Z', '', 'S0003'],
    ['S0000000003', '중복학생', '재원', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  add('classes', ['id', 'name', 'subject', 'teacherId', 'days', 'start', 'end', 'room', 'fee', 'status', 'memo', 'createdAt', 'schedule', 'textbook', 'progress', 'lessonNote', 'kind'], [
    ['C000000001', '초3 개념월목', '수학', 'teach01', '월,목', '15:30', '17:00', 'Class 2', 200000, '운영', '', '2026-09-10T01:00:00.000Z', '월 15:30-17:00', '디딤돌', '', '', '정규'],
    ['C000000002', '중1 심화화금', '수학', 'ADMIN01', '화,금', d(1899, 12, 30, 18, 0), d(1899, 12, 30, 20, 0), '', '250,000', '운영', '', '2026-09-10T01:00:00.000Z', '', '', '', '', '정규'],
  ]);
  add('enrollments', ['id', 'studentId', 'classId', 'startDate', 'endDate', 'fee', 'createdAt', 'endReason', 'deleted', 'updatedAt', 'updatedBy'], [
    ['E000000001', 'S0000000001', 'C000000001', '2026-09-10', '', '', '2026-09-10T01:00:00.000Z', '', false, '', ''],
    ['E000000002', 'S0000000002', 'C000000002', '2026-09-10', '', '', '2026-09-10T01:00:00.000Z', '', 'false', '', 'admin01'],
    ['E000000003', 'S0000000003', 'C000000001', '2026-09-01', '2026-09-20', '', '2026-09-10T01:00:00.000Z', '퇴원', 'FALSE', '', ''],
    ['E000000004', 'S_없는학생', 'C000000001', '2026-09-01', '', '', '', '', '', '', ''],
  ]);
  add('attendance', ['id', 'date', 'classId', 'studentId', 'status', 'note', 'updatedBy', 'updatedAt'], [
    ['A000000001', '2026-09-11', 'C000000001', 'S0000000001', '출석', '', 'teach01', '2026-09-11T07:00:00.000Z'],
    ['A000000002', d(2026, 9, 11), 'C000000002', 'S0000000002', '결석', '', 'admin01', '2026-09-11T09:00:00.000Z'],
  ]);
  add('checkins', ['id', 'date', 'time', 'studentId', 'kind', 'classId', 'device', 'sms', 'createdAt'], [
    ['Q000000001', '2026-09-15', '22:34', 'S0000000001', '등원', '', '데스크 태블릿', '문자 끔', '2026-09-15T13:34:00.000Z'],
    ['Q000000002', '2026-09-15', '오후 3:05', 'S0000000002', '하원', 'C000000002', '데스크 태블릿', '보냄', '2026-09-15T06:05:00.000Z'],
  ]);
  add('payments', ['id', 'date', 'studentId', 'month', 'item', 'amount', 'method', 'classId', 'note', 'createdBy', 'createdAt'], [
    ['P000000001', '2026-09-14', 'S0000000002', '2026-09', '수강료', '250,000', '카드', 'C000000002', '', 'admin01', '2026-09-14T01:00:00.000Z'],
  ]);
  add('exams', ['id', 'date', 'classId', 'name', 'maxScore', 'memo', 'createdAt', 'classIds', 'questions', 'mode', 'objMax', 'essayMax'], [
    ['X000000001', '2026-09-13', '', '2학기 중간 대비', 100, '', '2026-09-13T01:00:00.000Z', 'C000000001,C000000002', '[{"n":1,"unit":"수와 연산","type":"객관식","pts":4}]', 'q', '', ''],
  ]);
  add('scores', ['id', 'examId', 'studentId', 'score', 'note', 'classId', 'updatedAt', 'wrong', 'parts', 'obj', 'essay'], [
    ['R000000001', 'X000000001', 'S0000000001', 88, '', 'C000000001', '2026-09-13T05:00:00.000Z', '[{"n":1,"kind":"계산"}]', '', '', ''],
    ['R000000002', 'X000000001', 'S0000000002', '', '미입력', 'C000000002', '2026-09-13T05:00:00.000Z', '', '', '', ''],
  ]);
  add('reports', ['id', 'studentId', 'weekStart', 'weekEnd', 'status', 'body', 'data', 'createdAt', 'createdBy', 'approvedBy', 'approvedAt', 'sentAt', 'sms', 'model'], [
    ['W000000001', 'S0000000001', '2026-09-06', '2026-09-12', 'draft', '', '{"exams":[]}', '2026-09-13T01:00:00.000Z', 'admin01', '', '', '', '', ''],
  ]);
  add('consults', ['id', 'date', 'time', 'type', 'studentId', 'name', 'phone', 'school', 'grade', 'content', 'nextDate', 'memberId', 'createdAt', 'updatedAt'], [
    ['K000000001', '2026-09-15', '', '학부모상담', 'S0000000001', '', '', '', '', '상담 내용', '2026-09-20', 'admin01', '2026-09-15T01:00:00.000Z', ''],
    ['K000000002', '2026-09-16', '19:00', '신규문의', '', '문의학부모', '010-5555-6666', '가나초', '초4', '문의', '', 'teach01', '2026-09-16T01:00:00.000Z', ''],
  ]);
  add('messages', ['id', 'sentAt', 'kind', 'count', 'recipients', 'body', 'method', 'result', 'sentBy'], [
    ['M000000001', '2026-09-15T08:00:00.000Z', '직접입력', 1, '가학생:01099990001', '안내', 'manual', '문자앱으로 전달', 'admin01'],
  ]);
  add('textbooks', ['id', 'name', 'subject', 'grade', 'createdAt'], [['B000000001', '개념 쎈', '', '', '2026-09-10T01:00:00.000Z']]);
  add('extSchedules', ['id', 'studentId', 'name', 'day', 'start', 'end', 'memo', 'createdAt', 'updatedAt'], [
    ['X100000001', 'S0000000001', '영어학원', '화', '14:00', '16:00', '', '2026-09-10T01:00:00.000Z', ''],
  ]);
  add('scheduleLinks', ['studentId', 'token', 'active', 'createdAt', 'expiresAt', 'submittedAt'], [
    ['S0000000001', 'tok_abcdef1234567890', true, '2026-09-10T01:00:00.000Z', '', '2026-09-11T01:00:00.000Z'],
  ]);
  add('settings', ['key', 'value'], [
    ['rosterSync', '{"ok":true,"at":"2026-09-11"}'],
    ['kioskPin', '1234'],
    ['kioskDevices', '[{"name":"데스크 태블릿","token":"devtok_1","createdAt":"2026-09-12T01:00:00.000Z","lastUsed":"2026-09-15T13:34:00.000Z"}]'],
    ['kioskStaffPin', 'off'],
    ['travelBuffer', '20'],
    ['adminMeta', '{"academy":"가짜학원","term":"2026학년도 2학기"}'],
  ]);
  add('changes', ['id', 'at', 'memberId', 'memberName', 'type', 'studentId', 'classId', 'before', 'after', 'note'], [
    ['H000000001', '2026-09-12T01:00:00.000Z', 'admin01', '원장', 'class_rename', '', 'C000000002', '중1 심화', '중1 심화화금', ''],
  ]);
  add('makeups', ['id', 'date', 'start', 'end', 'classId', 'teacherId', 'studentIds', 'title', 'reason', 'memo', 'status', 'notifiedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deleted', 'deletedAt', 'deletedBy', 'remindedAt'], [
    ['B600000001', '2026-09-16', '16:00', '18:00', '', 'teach01', 'S0000000001,S0000000002', '개념노트', '시험 대비', '', '예정', '2026-09-15T01:00:00.000Z', '2026-09-15T01:00:00.000Z', 'admin01', '2026-09-15T01:00:00.000Z', 'admin01', '', '', '', ''],
  ]);
  add('mkRequests', ['id', 'createdAt', 'teacherId', 'names', 'date', 'start', 'end', 'title', 'note', 'status', 'handledBy', 'handledAt', 'makeupId', 'reply'], [
    ['Y000000001', '2026-09-14T01:00:00.000Z', 'teach01', '가학생, 나학생', '2026-09-16', '16:00', '18:00', '보강', '', '처리', 'admin01', '2026-09-15T01:00:00.000Z', 'B600000001', ''],
  ]);
  add('events', ['id', 'date', 'type', 'title', 'target', 'note', 'createdAt', 'updatedAt', 'endDate', 'school'], [
    ['V0001', '2026-01-01', '휴원', '신정', '', '', '2026-09-10T01:00:00.000Z', '', '', ''],
    ['V0002', '2026-10-05', '시험', '중간고사', '', '', '2026-09-10T01:00:00.000Z', '', '2026-10-08', '다라중'],
  ]);
  add('tests', ['id', 'date', 'title', 'type', 'target', 'teacher', 'scope', 'note', 'done', 'createdAt', 'updatedAt'], []);
  add('supplies', ['id', 'name', 'category', 'qty', 'minQty', 'unit', 'lastIn', 'vendor', 'note', 'updatedAt'], [
    ['K0001', 'A4용지', '사무용품', '', 2, '박스', '', '', '', '2026-09-10T01:00:00.000Z'],
  ]);
  add('issues', ['id', 'category', 'target', 'detail', 'action', 'priority', 'done', 'createdAt', 'updatedAt'], [
    ['I01', '진학 학교 미입력', '중3', '상세', '조치', '높음', 'true', '2026-09-10T01:00:00.000Z', ''],
  ]);
  add('profiles', ['studentId', 'attitude', 'homework', 'style', 'strength', 'weakness', 'mental', 'peer', 'parent', 'traitMemo', 'policy', 'roadmap', 'nextStep', 'risk', 'riskWhy', 'watch', 'track', 'admType', 'univ1', 'major1', 'univ2', 'major2', 'targetInner', 'curInner', 'targetMock', 'curMock', 'careerMemo', 'updatedAt'], [
    ['S0000000002', '적극적', '성실', '계산형', '', '', '', '좋음', '', '', '', '', '', '낮음', '', '', '이과', '수시', '가대', '', '나대', '', '1', '1.6', '100점', '96~100점', '', '2026-09-12T01:00:00.000Z'],
  ]);
  add('gradebook', ['id', 'studentId', 'kind', 'date', 'year', 'term', 'exam', 'subject', 'score', 'avg', 'rank', 'total', 'level', 'weak', 'note', 'org', 'round', 'raw', 'std', 'pct', 'type', 'scope', 'max', 'submit', 'createdAt', 'updatedAt'], [
    ['E0001', 'S0000000002', '내신', '', 2026, '1학기', '중간', '수학', 92, 60, 5, 230, 1, '', '실수 1개', '', '', '', '', '', '', '', '', '', '2026-09-12T01:00:00.000Z', ''],
  ]);
  add('bills', ['id', 'studentId', 'kind', 'course', 'term', 'teacher', 'billed', 'discount', 'paid', 'status', 'method', 'paidAt', 'handler', 'note', 'paymentId', 'createdAt', 'updatedAt'], [
    ['P0001', 'S0000000002', '특강', '공통수학I', '2026 여름', '김선생', 400000, 0, 250000, '부분납', '카드', '2026-09-14', '', '', 'P000000001', '2026-09-12T01:00:00.000Z', ''],
  ]);
  add('attChecks', ['id', 'date', 'studentId', 'studentName', 'classId', 'className', 'makeupId', 'teacherId', 'due', 'status', 'reason', 'detectedAt', 'alertTo', 'alert1At', 'alert2At', 'checkedBy', 'checkedByName', 'checkedAt', 'checkMethod', 'firstBy', 'smsAt', 'smsStudent', 'smsParent', 'smsIds', 'arrivedAt', 'lateMin', 'version', 'updatedAt', 'note', 'seenBy'], [
    ['W20260927_S0000000001_CC000000001', '2026-09-27', 'S0000000001', '가학생', 'C000000001', '초3 개념월목', '', 'teach01', '16:00', '결석', '정규', '2026-09-27T07:05:00.000Z', 'teach01', '2026-09-27T07:05:00.000Z', '', 'admin01', '원장', '2026-09-27T07:07:00.000Z', '원장', '원장 16:07', '', '', '', '', '', '', 2, '2026-09-27T07:07:00.000Z', '', ''],
  ]);
  add('attCheckLog', ['id', 'date', 'checkId', 'at', 'by', 'byName', 'from', 'to', 'note'], [
    ['H100000001', '2026-09-27', 'W20260927_S0000000001_CC000000001', '2026-09-27T07:05:00.000Z', 'SYSTEM', '자동', '', '확인필요', '자동 감지'],
    ['H100000002', '2026-09-27', 'W20260927_S0000000001_CC000000001', '2026-09-27T07:07:00.000Z', 'admin01', '원장', '확인필요', '결석', ''],
  ]);
  add('pushSubs', ['id', 'memberId', 'endpoint', 'p256dh', 'auth', 'ua', 'createdAt', 'lastOk', 'fails'], [
    ['U000000001', 'admin01', 'https://fcm.googleapis.com/fcm/send/fake', 'pkey', 'akey', 'Chrome', '2026-09-28T05:14:45.076Z', '2026-09-28T08:10:04.419Z', 0],
  ]);
  add('logs', ['id', 'date', 'memberId', 'checkIn', 'checkOut', 'work', 'note', 'updatedBy', 'updatedAt', 'fixedBy'], [
    ['L000000001', '2026-09-09', 'admin01', '03:33', '22:35', 'Test', 'test', 'admin01', '2026-09-09T13:35:00.000Z', ''],
    ['L000000002', '2026-09-10', 'teach01', '14:00', '', '', '', 'teach01', '2026-09-10T05:00:00.000Z', ''],
  ]);
  add('sessions', ['token', 'memberId', 'expiresAt'], [['tok', 'teach01', '2026-10-10T00:00:00.000Z']]);
  add('shifts', ['id', 'week', 'day', 'memberId', 'start', 'end', 'tasks', 'note', 'updatedBy', 'updatedAt'], []);
  await wb.xlsx.writeFile(file);
}
