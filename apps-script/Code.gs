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

// 사이트가 이 값을 보고 기능을 맞춥니다 (3: 회독 — 날짜를 이어서 적기, 4: 관리 기능)
var VERSION = 4;

var UNIT_RE = /^\d+\s*[-~]\s*\d+$|^\d+$/;

function doGet(e) {
  return run_(function () { return list_(); });
}

function doPost(e) {
  return run_(function () {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action === 'set') return set_(req);
    if (req.action === 'list') return list_();
    if (Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, req.action)) {
      checkKey_(req.key);
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

var ADMIN_ACTIONS = {
  // { grade, book, name, note, cells?: {'1':'11/18', ...}, maxDays?: {'수능2000': 50, ...} }
  addStudent: function (req) { return withLock_(function () { return addStudent_(req); }); },
  // { r, name(확인용), set: {grade?, book?, name?, note?}, maxDays? }
  updateStudent: function (req) {
    return withLock_(function () {
      var sh = sheet_(), cur = readRows_(sh);
      var row = findRow_(cur, req);
      var s = req.set || {};
      var g = s.grade != null ? String(s.grade).trim() : row.grade;
      var b = s.book != null ? String(s.book).trim() : row.book;
      if (g === row.grade && b === row.book) {
        // 같은 묶음 안: 그 줄의 이름·비고만 고친다
        if (s.name != null) sh.getRange(row.r, cur.L.iName + 1).setValue(String(s.name).trim());
        if (s.note != null && cur.L.iNote >= 0) sh.getRange(row.r, cur.L.iNote + 1).setValue(String(s.note));
        tidy_(sh, req.maxDays);
        return { ok: true };
      }
      // 다른 학년·교재로: 진도 날짜를 가지고 그 묶음으로 옮긴다
      deleteRowSafe_(sh, row.r);
      return addStudent_({ grade: g, book: b, name: s.name != null ? s.name : row.name, note: s.note != null ? s.note : row.note, cells: row.cells, maxDays: req.maxDays });
    });
  },
  // { r, name(확인용) }
  deleteStudent: function (req) {
    return withLock_(function () {
      var sh = sheet_(), cur = readRows_(sh);
      var row = findRow_(cur, req);
      deleteRowSafe_(sh, row.r);
      tidy_(sh, req.maxDays);
      return { ok: true };
    });
  },
  // { r, name(확인용), unit, value } — 날짜 칸을 원하는 값으로 (빈 값이면 지움)
  setCell: function (req) {
    return withLock_(function () {
      var sh = sheet_(), cur = readRows_(sh);
      var row = findRow_(cur, req);
      var u = cur.L.units.filter(function (x) { return x.label === norm_(req.unit); })[0];
      if (!u) throw new Error('Day 칸을 찾지 못했습니다: ' + req.unit);
      var cell = sh.getRange(row.r, u.col + 1);
      if (String(req.value || '').trim()) cell.setNumberFormat('@').setValue(String(req.value).trim()); else cell.clearContent();
      return { ok: true };
    });
  },
  // { maxDays? } — 병합·회색 칸 다시 정리
  tidy: function (req) { return withLock_(function () { tidy_(sheet_(), req.maxDays); return { ok: true }; }); }
};

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// 병합된 학년·교재 칸의 첫 줄을 지워도 값이 사라지지 않게, 지우기 전에 병합을 풀고 값을 채워 둔다
function deleteRowSafe_(sh, r) {
  var cur = readRows_(sh), L = cur.L, rows = cur.rows;
  var first = L.firstDataRow + 1, last = rows.length ? rows[rows.length - 1].r : first;
  [L.iGrade, L.iBook].forEach(function (col) {
    if (col < 0) return;
    var rng = sh.getRange(first, col + 1, last - first + 1, 1);
    rng.breakApart();
    var vals = [], keep = '';
    for (var i = first; i <= last; i++) {
      var v = String((cur.values[i - 1] || [])[col] || '').trim();
      if (v) keep = v;
      vals.push([keep]);
    }
    rng.setValues(vals);
  });
  sh.deleteRow(r);
}

// 학년·교재를 위에서 이어 받아 줄 목록으로
function readRows_(sh) {
  var values = sh.getDataRange().getDisplayValues();
  var L = layout_(values);
  var out = [], grade = '', book = '';
  for (var i = L.firstDataRow; i < values.length; i++) {
    var v = values[i];
    if (L.iGrade >= 0 && String(v[L.iGrade]).trim()) grade = String(v[L.iGrade]).trim();
    if (L.iBook >= 0 && String(v[L.iBook]).trim()) book = String(v[L.iBook]).trim();
    var name = String(v[L.iName] || '').trim();
    if (!name) continue;
    var cells = {};
    L.units.forEach(function (u) { cells[u.label] = String(v[u.col] || '').trim(); });
    out.push({ r: i + 1, grade: grade, book: book, name: name, note: L.iNote >= 0 ? String(v[L.iNote] || '') : '', cells: cells });
  }
  return { L: L, values: values, rows: out };
}

function findRow_(cur, req) {
  var row = cur.rows.filter(function (x) { return x.r === Number(req.r); })[0];
  if (!row || row.name !== String(req.name || '').trim()) throw new Error('시트가 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
  return row;
}

var GRADE_ORDER_ = ['초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
function gradeIdx_(g) { var i = GRADE_ORDER_.indexOf(g); return i < 0 ? 99 : i; }

function addStudent_(req) {
  var sh = sheet_(), cur = readRows_(sh), L = cur.L;
  var grade = String(req.grade || '').trim(), book = String(req.book || '').trim(), name = String(req.name || '').trim();
  if (!name) throw new Error('이름이 비어 있습니다.');
  if (!book) throw new Error('교재가 비어 있습니다.');
  if (L.iGrade < 0 && grade) throw new Error("시트에 '학년' 칸이 없습니다.");
  var rows = cur.rows, at;
  // 1) 같은 학년·교재 묶음의 맨 아래 2) 같은 학년의 맨 아래 3) 학년 순서상 들어갈 자리 4) 맨 끝
  var same = rows.filter(function (x) { return x.grade === grade && x.book === book; });
  var sameGrade = rows.filter(function (x) { return x.grade === grade; });
  if (same.length) at = { after: same[same.length - 1].r };
  else if (sameGrade.length) at = { after: sameGrade[sameGrade.length - 1].r };
  else {
    var later = rows.filter(function (x) { return gradeIdx_(x.grade) > gradeIdx_(grade); })[0];
    at = later ? { before: later.r } : { after: rows.length ? rows[rows.length - 1].r : L.firstDataRow };
  }
  var r;
  if (at.after) { sh.insertRowAfter(at.after); r = at.after + 1; } else { sh.insertRowBefore(at.before); r = at.before; }
  var W = sh.getLastColumn();
  var line = [];
  for (var c = 0; c < W; c++) line.push('');
  if (L.iGrade >= 0) line[L.iGrade] = grade;
  if (L.iBook >= 0) line[L.iBook] = book;
  line[L.iName] = name;
  if (L.iNote >= 0) line[L.iNote] = String(req.note || '');
  var cells = req.cells || {};
  L.units.forEach(function (u) { line[u.col] = cells[u.label] || ''; });
  var rng = sh.getRange(r, 1, 1, W);
  rng.breakApart();
  rng.setValues([line]);
  tidy_(sh, req.maxDays);
  return { ok: true, r: r };
}

// 학년·교재 칸을 같은 값끼리 다시 병합하고, Day 칸은 텍스트 형식 + 교재 범위 밖은 회색으로
function tidy_(sh, maxDays) {
  var cur = readRows_(sh), L = cur.L, rows = cur.rows;
  if (!rows.length) return;
  var first = L.firstDataRow + 1, last = rows[rows.length - 1].r, n = last - first + 1;
  var grades = [], books = [], g = '', b = '';
  for (var i = first; i <= last; i++) {
    var v = cur.values[i - 1] || [];
    if (L.iGrade >= 0 && String(v[L.iGrade] || '').trim()) g = String(v[L.iGrade]).trim();
    if (L.iBook >= 0 && String(v[L.iBook] || '').trim()) b = String(v[L.iBook]).trim();
    grades.push(g); books.push(b);
  }
  function mergeRuns(col, keyAt, shown) {
    var rng = sh.getRange(first, col + 1, n, 1);
    rng.breakApart();
    rng.setValues(shown.map(function (x) { return [x]; }));
    var s = 0;
    for (var k = 1; k <= n; k++) {
      if (k === n || keyAt(k) !== keyAt(s)) {
        if (k - s > 1 && shown[s]) sh.getRange(first + s, col + 1, k - s, 1).merge();
        s = k;
      }
    }
    rng.setVerticalAlignment('middle').setHorizontalAlignment('center');
  }
  if (L.iGrade >= 0) mergeRuns(L.iGrade, function (k) { return grades[k]; }, grades);
  if (L.iBook >= 0) mergeRuns(L.iBook, function (k) { return grades[k] + '|' + books[k]; }, books);

  if (L.units.length) {
    var c0 = L.units[0].col, c1 = L.units[L.units.length - 1].col;
    var block = sh.getRange(first, c0 + 1, n, c1 - c0 + 1);
    block.setNumberFormat('@');
    if (maxDays) {
      var key = function (s) { return String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase(); };
      var mk = {};
      Object.keys(maxDays).forEach(function (k) { mk[key(k)] = Number(maxDays[k]); });
      var unitAt = {};
      L.units.forEach(function (u) { unitAt[u.col] = Number(String(u.label).split('-')[0]); });
      var bg = [];
      for (var x = 0; x < n; x++) {
        var max = mk[key(books[x])] || 0, line = [];
        for (var c = c0; c <= c1; c++) line.push(max && unitAt[c] > max ? '#d9d9d9' : null);
        bg.push(line);
      }
      block.setBackgrounds(bg);
    }
  }
}
