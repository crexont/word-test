/**
 * 영어 단어 시험지 생성기 ↔ 구글 시트 진도표 연결용 Apps Script
 *
 * 시트 형식 (머리글 한 줄 또는 두 줄 모두 가능)
 *   학년 | 교재 | 이름 | 1 | 2 | 3 | ... | 비고      (학년 칸은 없어도 됩니다)
 *   - '학년'·'교재' 칸은 병합해도 됩니다 (위 칸의 값을 이어서 씁니다).
 *   - Day 칸(1, 2, 3 ... 또는 1-2, 3-4 ...)에 통과 날짜를 적습니다. 빈칸 = 아직 통과 전.
 *   - 회독: 같은 칸에 날짜를 쉼표로 이어 적습니다 (예: 11/18, 2/3 → 2회 통과).
 *   - 머리글이 두 줄이면(위: '이름', 아래: '1-2' ...) 자동으로 합쳐 읽습니다.
 *
 * 설치: README의 "진도표(구글 시트) 연결" 순서를 따르세요.
 * 관리 기능(학생 추가·수정·삭제): 편집기 위쪽 함수 목록에서 setupAdminKey 를 골라 ▶실행 →
 *   실행 로그에 나온 관리 키를 사이트 진도표 탭의 "관리 키"에 넣습니다.
 */

// 진도표가 있는 시트(탭) 이름. 비워 두면 첫 번째 시트를 씁니다.
var SHEET_NAME = '';

// 사이트가 이 값을 보고 기능을 맞춥니다 (3: 회독 — 날짜를 이어서 적기, 4: 관리 기능, 5: 단어장 탭, 6: 관리 기능 안정화, 7: 서식 유지, 8: 교재 색을 사이트에서 지정, 9: 시트 보기 좋게)
var VERSION = 11;

// 진도표 '교재' 칸 색 (교재 약칭 기준, 띄어쓰기 무시). 여기 없는 교재는 원래 칠해 둔 색을 유지합니다.
var BOOK_COLORS = {
  '수능2000': '#f4b183',   // 연주황
  '어원편고등': '#e46c0a', // 짙은 주황
  '보카클리어': '#f4a6a6', // 연한 빨강
  '수능필수': '#c6e0b4'    // 연초록
};

var UNIT_RE = /^\d+\s*[-~]\s*\d+$|^\d+$/;

function doGet(e) {
  return run_(function () {
    var p = (e && e.parameter) || {};
    if (p.action === 'book') return book_(p.tab);
    return list_();
  });
}

function doPost(e) {
  return run_(function () {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action === 'set') return set_(req);
    if (req.action === 'list') return list_();
    if (Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, req.action)) {
      checkKey_(req.key);
      useColors_(req);
      return ADMIN_ACTIONS[req.action](req);
    }
    throw new Error('알 수 없는 요청입니다.');
  });
}

function run_(fn) {
  var out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  if (!sh) throw new Error('시트를 찾지 못했습니다: ' + SHEET_NAME);
  return sh;
}

function norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, '').replace(/~/g, '-'); }

// 머리글 해석: { headerRow(0-base), firstDataRow, iBook, iName, iNote, units:[{col,label}] }
function layout_(values) {
  var h = -1;
  for (var i = 0; i < Math.min(values.length, 15); i++) {
    if (values[i].some(function (v) { return norm_(v) === '이름'; })) { h = i; break; }
  }
  if (h < 0) throw new Error("머리글에서 '이름' 칸을 찾지 못했습니다.");
  var top = values[h].map(norm_);
  var below = values[h + 1] ? values[h + 1].map(norm_) : [];
  var belowUnits = below.filter(function (v) { return UNIT_RE.test(v); }).length;
  var twoRows = belowUnits >= 2;
  var labels = top.map(function (v, c) { return twoRows && UNIT_RE.test(below[c]) ? below[c] : v; });
  var units = [];
  labels.forEach(function (v, c) { if (UNIT_RE.test(v)) units.push({ col: c, label: v }); });
  return {
    headerRow: h,
    firstDataRow: h + (twoRows ? 2 : 1),
    iGrade: labels.indexOf('학년'),
    iBook: labels.indexOf('교재'),
    iName: labels.indexOf('이름'),
    iNote: labels.indexOf('비고'),
    units: units
  };
}

function list_() {
  var sh = sheet_();
  var values = sh.getDataRange().getDisplayValues();
  var L = layout_(values);
  var rows = [], book = '', grade = '';
  for (var r = L.firstDataRow; r < values.length; r++) {
    var row = values[r];
    if (L.iGrade >= 0 && String(row[L.iGrade]).trim()) grade = String(row[L.iGrade]).trim();
    if (L.iBook >= 0 && String(row[L.iBook]).trim()) book = String(row[L.iBook]).trim();
    var name = String(row[L.iName] || '').trim();
    if (!name) continue;
    var cells = {};
    L.units.forEach(function (u) { cells[u.label] = String(row[u.col] || '').trim(); });
    rows.push({ r: r + 1, grade: grade, book: book, name: name, note: L.iNote >= 0 ? String(row[L.iNote] || '').trim() : '', cells: cells });
  }
  return { ok: true, version: VERSION, sheet: sh.getName(), units: L.units.map(function (u) { return u.label; }), rows: rows };
}

// req: { r: 행 번호(1-base), name: 학생 이름(확인용), unit: '7', clear: true면 마지막 날짜 하나 지우기 }
// 통과: 칸에 오늘 날짜를 쉼표로 이어 적는다 (회독 기록 유지)
function set_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_();
    var values = sh.getDataRange().getDisplayValues();
    var L = layout_(values);
    var r = Number(req.r);
    if (!(r > L.firstDataRow) || r > values.length) throw new Error('행 번호가 올바르지 않습니다.');
    if (String(values[r - 1][L.iName]).trim() !== String(req.name || '').trim()) {
      throw new Error('시트가 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
    }
    var u = L.units.filter(function (x) { return x.label === norm_(req.unit); })[0];
    if (!u) throw new Error('범위 열을 찾지 못했습니다: ' + req.unit);
    var cell = sh.getRange(r, u.col + 1);
    var parts = String(values[r - 1][u.col] || '').split(/[,\n]/).map(function (s) { return s.trim(); }).filter(String);
    var date = '';
    if (req.clear) {
      parts.pop();
    } else {
      date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d');
      parts.push(date);
    }
    var value = parts.join(', ');
    if (value) cell.setNumberFormat('@').setValue(value); else cell.clearContent();
    return { ok: true, value: value, date: date };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// 관리 기능 (관리 키가 맞을 때만)
//  방식: 학생 표를 읽어 목록으로 만든 뒤 → 목록에서 추가·수정·삭제 → 데이터 영역의 병합을 모두 풀고
//        표 전체를 다시 쓴 다음 같은 학년·교재끼리 다시 병합한다.
//        (줄 끼워 넣기 + 일부 병합 풀기는 구글 시트에서 "병합된 셀의 일부" 오류가 나므로 쓰지 않음)
// =====================================================================

// 처음 한 번 실행: 관리 키를 만들어 스크립트 속성에 저장하고 실행 로그에 보여 줍니다.
// 키를 바꾸고 싶으면 다시 실행하면 됩니다 (예전 키는 더 이상 쓸 수 없음).
function setupAdminKey() {
  var key = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', key);
  Logger.log('관리 키: ' + key);
  return key;
}

function checkKey_(key) {
  var saved = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!saved) throw new Error('관리 키가 아직 없습니다. Apps Script에서 setupAdminKey 를 한 번 실행하세요.');
  if (String(key || '') !== saved) throw new Error('관리 키가 맞지 않습니다.');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

var GRADE_ORDER_ = ['초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
function gradeIdx_(g) { var i = GRADE_ORDER_.indexOf(g); return i < 0 ? 99 : i; }

// 학생 표 읽기: 학년·교재는 병합 위 칸에서 이어 받고, 이름 없는 줄은 버린다
function table_(sh) {
  var values = sh.getDataRange().getDisplayValues();
  var L = layout_(values);
  var W = sh.getLastColumn();
  var rows = [], g = '', b = '';
  for (var i = L.firstDataRow; i < values.length; i++) {
    var v = values[i].slice();
    while (v.length < W) v.push('');
    if (L.iGrade >= 0 && String(v[L.iGrade]).trim()) g = String(v[L.iGrade]).trim();
    if (L.iBook >= 0 && String(v[L.iBook]).trim()) b = String(v[L.iBook]).trim();
    var name = String(v[L.iName] || '').trim();
    if (!name) continue;
    if (L.iGrade >= 0) v[L.iGrade] = g;
    if (L.iBook >= 0) v[L.iBook] = b;
    v[L.iName] = name;
    rows.push({ r: i + 1, grade: L.iGrade >= 0 ? g : '', book: b, name: name, v: v });
  }
  return { L: L, first: L.firstDataRow + 1, W: W, rows: rows };
}

function findIdx_(T, req) {
  for (var i = 0; i < T.rows.length; i++) {
    if (T.rows[i].r === Number(req.r) && T.rows[i].name === String(req.name || '').trim()) return i;
  }
  throw new Error('시트가 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
}

// 새 학생이 들어갈 자리: 같은 학년·교재 묶음 끝 → 같은 학년 끝 → 학년 순서상 자리 → 맨 끝
function placeIdx_(rows, grade, book) {
  var i, lastSame = -1, lastGrade = -1;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].grade === grade && rows[i].book === book) lastSame = i;
    if (rows[i].grade === grade) lastGrade = i;
  }
  if (lastSame >= 0) return lastSame + 1;
  if (lastGrade >= 0) return lastGrade + 1;
  for (i = 0; i < rows.length; i++) if (gradeIdx_(rows[i].grade) > gradeIdx_(grade)) return i;
  return rows.length;
}

// 교재 칸 색: 사이트가 보낸 색(books.json의 sheetColor) → 이 파일의 BOOK_COLORS → 없음
var EXTRA_COLORS_ = null;
function bookColor_(book) {
  var k = String(book || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '');
  return (EXTRA_COLORS_ && EXTRA_COLORS_[k]) || BOOK_COLORS[k] || null;
}
function useColors_(req) {
  EXTRA_COLORS_ = {};
  var m = (req && req.bookColors) || {};
  Object.keys(m).forEach(function (name) { EXTRA_COLORS_[String(name).replace(/\(.*?\)/g, '').replace(/\s+/g, '')] = m[name]; });
}

function setRow_(T, row, grade, book) {
  var L = T.L;
  row.grade = L.iGrade >= 0 ? grade : '';
  row.book = book;
  if (L.iGrade >= 0) row.v[L.iGrade] = row.grade;
  if (L.iBook >= 0) row.v[L.iBook] = book;
}

// 표 전체 다시 쓰기 + 병합 + Day 칸 텍스트 형식 + 교재 범위 밖 회색
function writeTable_(sh, T, maxDays) {
  var L = T.L, n = T.rows.length, W = T.W;
  var span = Math.max(sh.getMaxRows() - T.first + 1, n);
  if (sh.getMaxRows() < T.first + n - 1) sh.insertRowsAfter(sh.getMaxRows(), T.first + n - 1 - sh.getMaxRows());
  // 머리글 아래 데이터 영역 전체를 한 번에 정리 (병합을 모두 포함하므로 "일부 병합" 오류가 나지 않음)
  var area = sh.getRange(T.first, 1, span, W);

  // 다시 쓰기 전에 학년·교재 칸 색을 묶음별로 기억 (색이 줄 위치가 아니라 묶음을 따라가도록)
  var colors = { grade: {}, book: {} };
  function remember(col, kind, keyOf) {
    if (col < 0) return;
    var top = T.rows.reduce(function (m, x) { return x.r ? Math.max(m, x.r) : m; }, T.first);
    var len = top - T.first + 1;
    var bgs = sh.getRange(T.first, col + 1, len, 1).getBackgrounds();
    var fcs = sh.getRange(T.first, col + 1, len, 1).getFontColors();
    T.rows.slice().sort(function (a, b) { return (a.r || 1e9) - (b.r || 1e9); }).forEach(function (x) {
      if (!x.r) return;
      var k = keyOf(x);
      if (!colors[kind][k]) colors[kind][k] = { bg: bgs[x.r - T.first][0], fc: fcs[x.r - T.first][0] };
    });
  }
  remember(L.iGrade, 'grade', function (x) { return x.grade; });
  remember(L.iBook, 'book', function (x) { return x.grade + '|' + x.book; });

  area.breakApart();
  area.clearContent();
  if (L.units.length) {
    var c0 = L.units[0].col, nc = L.units[L.units.length - 1].col - c0 + 1;
    sh.getRange(T.first, c0 + 1, span, nc).setBackground(null).setNumberFormat('@');
  }
  // 표 아래로 남는 줄은 서식도 지움 (학생이 줄었을 때)
  if (span > n) {
    sh.getRange(T.first + n, 1, span - n, W)
      .setBorder(false, false, false, false, false, false)
      .setBackground(null).setFontWeight('normal').setFontColor(null);
  }
  if (!n) { styleSheet_(sh, T); return; }
  var table = sh.getRange(T.first, 1, n, W);
  table.setValues(T.rows.map(function (x) { return x.v; }));
  // 학생 수와 상관없이 같은 모양: 테두리, 이름 굵게·가운데, Day 칸 가운데·작은 글씨
  table.setBorder(true, true, true, true, true, true, '#bfbfbf', SpreadsheetApp.BorderStyle.SOLID).setVerticalAlignment('middle');
  sh.getRange(T.first, L.iName + 1, n, 1).setFontWeight('bold').setHorizontalAlignment('center');
  if (L.units.length) sh.getRange(T.first, L.units[0].col + 1, n, L.units[L.units.length - 1].col - L.units[0].col + 1).setHorizontalAlignment('center').setFontSize(9);
  function paint(col, kind, keyAt) {
    if (col < 0) return;
    var bg = [], fc = [];
    for (var k = 0; k < n; k++) {
      var cc = colors[kind][keyAt(k)] || {};
      var fixed = kind === 'book' ? bookColor_(T.rows[k].book) : null;
      bg.push([fixed || (cc.bg && cc.bg !== '#ffffff' ? cc.bg : null)]);
      fc.push([fixed ? '#000000' : (cc.fc || null)]);
    }
    sh.getRange(T.first, col + 1, n, 1).setBackgrounds(bg).setFontColors(fc).setFontWeight('bold');
  }
  paint(L.iGrade, 'grade', function (k) { return T.rows[k].grade; });
  paint(L.iBook, 'book', function (k) { return T.rows[k].grade + '|' + T.rows[k].book; });

  function mergeRuns(col, keyAt) {
    var s = 0;
    for (var k = 1; k <= n; k++) {
      if (k === n || keyAt(k) !== keyAt(s)) {
        if (k - s > 1 && String(T.rows[s].v[col]).trim()) sh.getRange(T.first + s, col + 1, k - s, 1).merge();
        s = k;
      }
    }
    sh.getRange(T.first, col + 1, n, 1).setVerticalAlignment('middle').setHorizontalAlignment('center');
  }
  if (L.iGrade >= 0) mergeRuns(L.iGrade, function (k) { return T.rows[k].grade; });
  if (L.iBook >= 0) mergeRuns(L.iBook, function (k) { return T.rows[k].grade + '|' + T.rows[k].book; });

  if (maxDays && L.units.length) {
    var key = function (s) { return String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase(); };
    var mk = {};
    Object.keys(maxDays).forEach(function (k) { mk[key(k)] = Number(maxDays[k]); });
    var c0b = L.units[0].col, c1 = L.units[L.units.length - 1].col;
    var unitAt = {};
    L.units.forEach(function (u) { unitAt[u.col] = Number(String(u.label).split('-')[0]); });
    var bg = T.rows.map(function (row) {
      var max = mk[key(row.book)] || 0, line = [];
      for (var c = c0b; c <= c1; c++) line.push(max && unitAt[c] > max ? '#d9d9d9' : null);
      return line;
    });
    sh.getRange(T.first, c0b + 1, n, c1 - c0b + 1).setBackgrounds(bg);
  }
  styleSheet_(sh, T);
}

// 보기 좋게 (화면·인쇄): 제목·머리글, 고정, 너비·높이, 묶음 구분선, 5일 구분선, 통과 칸 색
function styleSheet_(sh, T) {
  var L = T.L, W = T.W, n = T.rows.length, first = T.first, head = first - 1; // head: 마지막 머리글 줄(1-base)
  var BS = SpreadsheetApp.BorderStyle;

  // 제목·안내 (머리글 위 두 줄). 학년·교재·이름 열을 고정하려면 제목이 그 경계를 넘는 병합이면 안 되므로 병합을 풀고 왼쪽에 둔다
  if (head >= 3) {
    var top = sh.getRange(1, 1, 2, W);
    var title = String(sh.getRange(1, 1).getDisplayValue() || '').trim() || 'VOCA 진도표';
    top.breakApart().clearContent();
    // 넘친 글자는 고정선·옆 칸에서 잘리므로, 칸을 합쳐 자리를 만든다 (고정선을 넘지 않게 양쪽 따로)
    sh.getRange(1, 1, 1, L.iName + 1).merge();
    sh.getRange(1, 1).setValue(title).setFontSize(13).setFontWeight('bold').setHorizontalAlignment('left').setVerticalAlignment('middle');
    if (L.units.length) {
      var span = Math.min(14, W - L.units[0].col);
      sh.getRange(1, L.units[0].col + 1, 1, span).merge();
      sh.getRange(1, L.units[0].col + 1).setValue('초록 = 통과 · 진초록 = 2회독 이상 · 회색 = 교재 범위 밖')
        .setFontSize(9).setFontColor('#666666').setFontWeight('normal').setHorizontalAlignment('left').setVerticalAlignment('middle');
    }
    sh.setRowHeight(1, 34);
    sh.setRowHeight(2, 6);
  }

  // 머리글
  sh.getRange(head, 1, 1, W).setBackground('#1f3864').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontSize(10);
  sh.setRowHeight(head, 26);

  // 고정: 머리글 줄까지, 학년·교재·이름 열까지
  sh.setFrozenRows(head);
  sh.setFrozenColumns(L.iName + 1);

  // 너비
  if (L.iGrade >= 0) sh.setColumnWidth(L.iGrade + 1, 48);
  if (L.iBook >= 0) sh.setColumnWidth(L.iBook + 1, 100);
  sh.setColumnWidth(L.iName + 1, 78);
  if (L.units.length) sh.setColumnWidths(L.units[0].col + 1, L.units.length, 40);
  if (L.iNote >= 0) sh.setColumnWidth(L.iNote + 1, 150);
  if (!n) return;

  // 줄 높이, 이름 글씨
  sh.setRowHeights(first, n, 22);
  sh.getRange(first, L.iName + 1, n, 1).setFontSize(11);

  // 교재 묶음이 바뀌는 곳에 진한 가로선
  for (var k = 0; k < n; k++) {
    var last = k === n - 1 || T.rows[k + 1].grade !== T.rows[k].grade || T.rows[k + 1].book !== T.rows[k].book;
    if (last) sh.getRange(first + k, 1, 1, W).setBorder(null, null, true, null, null, null, '#595959', BS.SOLID_MEDIUM);
  }
  // 이름 열 오른쪽, Day 5·10·15 … 오른쪽에 진한 세로선 (머리글 포함)
  sh.getRange(head, L.iName + 1, n + 1, 1).setBorder(null, null, null, true, null, null, '#595959', BS.SOLID_MEDIUM);
  L.units.forEach(function (u) {
    var b = Number(String(u.label).split('-').pop());
    if (b % 5 === 0) sh.getRange(head, u.col + 1, n + 1, 1).setBorder(null, null, null, true, null, null, '#8c8c8c', BS.SOLID_MEDIUM);
  });

  // 통과한 칸 색 (조건부 서식이라 시트에 직접 적어도 자동으로 칠해짐)
  if (L.units.length) {
    var block = sh.getRange(first, L.units[0].col + 1, n, L.units[L.units.length - 1].col - L.units[0].col + 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextContains(',').setBackground('#93c47d').setRanges([block]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground('#d9ead3').setRanges([block]).build()
    ];
    sh.setConditionalFormatRules(rules);
  }
}

var ADMIN_ACTIONS = {
  // { grade, book, name, note }
  addStudent: function (req) {
    return withLock_(function () {
      var sh = sheet_(), T = table_(sh), L = T.L;
      var grade = String(req.grade || '').trim(), book = String(req.book || '').trim(), name = String(req.name || '').trim();
      if (!name) throw new Error('이름이 비어 있습니다.');
      if (!book) throw new Error('교재가 비어 있습니다.');
      if (L.iGrade < 0 && grade) throw new Error("시트에 '학년' 칸이 없습니다.");
      var v = [];
      for (var c = 0; c < T.W; c++) v.push('');
      v[L.iName] = name;
      if (L.iNote >= 0) v[L.iNote] = String(req.note || '');
      var row = { name: name, v: v };
      setRow_(T, row, grade, book);
      T.rows.splice(placeIdx_(T.rows, row.grade, book), 0, row);
      writeTable_(sh, T, req.maxDays);
      return { ok: true };
    });
  },
  // { r, name(확인용), set: {grade?, book?, name?, note?} }
  updateStudent: function (req) {
    return withLock_(function () {
      var sh = sheet_(), T = table_(sh), L = T.L;
      var i = findIdx_(T, req), row = T.rows[i], s = req.set || {};
      if (s.name != null && String(s.name).trim()) { row.name = String(s.name).trim(); row.v[L.iName] = row.name; }
      if (s.note != null && L.iNote >= 0) row.v[L.iNote] = String(s.note);
      var g = s.grade != null ? String(s.grade).trim() : row.grade;
      var b = s.book != null && String(s.book).trim() ? String(s.book).trim() : row.book;
      if (g !== row.grade || b !== row.book) {
        // 다른 학년·교재로: 통과 기록(같은 줄의 Day 칸)을 그대로 가지고 그 묶음으로 옮긴다
        T.rows.splice(i, 1);
        setRow_(T, row, g, b);
        T.rows.splice(placeIdx_(T.rows, row.grade, b), 0, row);
      }
      writeTable_(sh, T, req.maxDays);
      return { ok: true };
    });
  },
  // { r, name(확인용) }
  deleteStudent: function (req) {
    return withLock_(function () {
      var sh = sheet_(), T = table_(sh);
      T.rows.splice(findIdx_(T, req), 1);
      writeTable_(sh, T, req.maxDays);
      return { ok: true };
    });
  },
  // { r, name(확인용), unit, value } — 날짜 칸을 원하는 값으로 (빈 값이면 지움)
  setCell: function (req) {
    return withLock_(function () {
      var sh = sheet_(), T = table_(sh);
      var row = T.rows[findIdx_(T, req)];
      var u = T.L.units.filter(function (x) { return x.label === norm_(req.unit); })[0];
      if (!u) throw new Error('Day 칸을 찾지 못했습니다: ' + req.unit);
      var cell = sh.getRange(row.r, u.col + 1);
      if (String(req.value || '').trim()) cell.setNumberFormat('@').setValue(String(req.value).trim()); else cell.clearContent();
      return { ok: true };
    });
  },
  // { maxDays? } — 표 다시 정리 (이름 없는 줄 제거, 병합·회색 칸 다시 맞춤)
  tidy: function (req) {
    return withLock_(function () { var sh = sheet_(); writeTable_(sh, table_(sh), req.maxDays); return { ok: true }; });
  }
};

// =====================================================================
// 단어장 탭 (교재마다 탭 하나: Day | 영어 | 뜻 | 단원 이름)
//  - Day 칸이 숫자가 아니면(예: 부록1) 부록 단원으로 보고, 숫자 Day 뒤에 차례로 붙입니다.
//  - '단원 이름'은 부록처럼 이름이 있는 단원에만 적으면 됩니다.
// =====================================================================

function book_(tab) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(String(tab || ''));
  if (!sh) throw new Error('단어장 탭을 찾지 못했습니다: ' + tab);
  var v = sh.getDataRange().getDisplayValues();
  var head = (v[0] || []).map(function (x) { return norm_(x).toLowerCase(); });
  var iD = head.indexOf('day'), iE = head.indexOf('영어'), iK = head.indexOf('뜻'), iN = head.indexOf('단원이름');
  if (iD < 0 || iE < 0 || iK < 0) throw new Error("단어장 탭 첫 줄은 'Day | 영어 | 뜻' 이어야 합니다: " + tab);
  var units = [], byKey = {};
  for (var r = 1; r < v.length; r++) {
    var d = String(v[r][iD] || '').trim(), en = String(v[r][iE] || '').trim(), ko = String(v[r][iK] || '').trim();
    if (!d || !en) continue;
    if (!byKey[d]) { byKey[d] = { key: d, name: '', words: [] }; units.push(byKey[d]); }
    if (iN >= 0 && !byKey[d].name && String(v[r][iN] || '').trim()) byKey[d].name = String(v[r][iN]).trim();
    byKey[d].words.push([en, ko]);
  }
  var maxNum = 0;
  units.forEach(function (u) { if (/^\d+$/.test(u.key)) maxNum = Math.max(maxNum, Number(u.key)); });
  var extra = 0, days = [];
  units.forEach(function (u) {
    if (/^\d+$/.test(u.key)) days.push({ day: Number(u.key), words: u.words });
    else { extra++; var o = { day: maxNum + extra, label: u.key, words: u.words }; if (u.name) o.name = u.name; days.push(o); }
  });
  days.sort(function (a, b) { return a.day - b.day; });
  return { ok: true, tab: sh.getName(), days: days };
}

// 관리: { tab, rows: [[Day, 영어, 뜻, 단원 이름], ...] } — 탭을 새로 만들거나 내용을 통째로 바꿉니다.
ADMIN_ACTIONS.importBook = function (req) {
  return withLock_(function () {
    var tab = String(req.tab || '').trim();
    if (!/^단어_/.test(tab)) throw new Error("단어장 탭 이름은 '단어_'로 시작해야 합니다.");
    var rows = req.rows || [];
    if (!rows.length) throw new Error('올릴 단어가 없습니다.');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab, ss.getSheets().length);
    sh.clear();
    // =, +, -, @ 로 시작하는 글자는 수식으로 읽히지 않게 앞에 ' 를 붙인다 (화면에는 안 보임)
    var safe = function (x) { x = String(x == null ? '' : x); return /^[=+\-@]/.test(x) ? "'" + x : x; };
    var data = [['Day', '영어', '뜻', '단원 이름']].concat(rows.map(function (r) { return [safe(r[0]), safe(r[1]), safe(r[2]), safe(r[3] || '')]; }));
    var rng = sh.getRange(1, 1, data.length, 4);
    rng.setNumberFormat('@');
    rng.setValues(data);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#e8eef9');
    sh.setColumnWidth(1, 60); sh.setColumnWidth(2, 170); sh.setColumnWidth(3, 420); sh.setColumnWidth(4, 260);
    return { ok: true, tab: tab, rows: rows.length };
  });
};
