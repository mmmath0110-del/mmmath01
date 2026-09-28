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
