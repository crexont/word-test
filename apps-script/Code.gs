/**
 * 영어 단어 시험지 생성기 ↔ 구글 시트 진도표 연결용 Apps Script
 *
 * 시트 형식 (머리글 한 줄 또는 두 줄 모두 가능)
 *   교재 | 이름 | 1-2 | 3-4 | 5-6 | ... | 비고
 *   - '교재' 칸은 병합해도 됩니다 (위 칸의 교재를 이어서 씁니다).
 *   - 범위 칸(1-2, 3-4 ...)에 통과 날짜를 적습니다. 빈칸 = 아직 통과 전.
 *   - 머리글이 두 줄이면(위: '이름', 아래: '1-2' ...) 자동으로 합쳐 읽습니다.
 *
 * 설치: README의 "진도표(구글 시트) 연결" 순서를 따르세요.
 */

// 진도표가 있는 시트(탭) 이름. 비워 두면 첫 번째 시트를 씁니다.
var SHEET_NAME = '';

var UNIT_RE = /^\d+\s*[-~]\s*\d+$|^\d+$/;

function doGet(e) {
  return run_(function () { return list_(); });
}

function doPost(e) {
  return run_(function () {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action === 'set') return set_(req);
    if (req.action === 'list') return list_();
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
  var rows = [], book = '';
  for (var r = L.firstDataRow; r < values.length; r++) {
    var row = values[r];
    if (L.iBook >= 0 && String(row[L.iBook]).trim()) book = String(row[L.iBook]).trim();
    var name = String(row[L.iName] || '').trim();
    if (!name) continue;
    var cells = {};
    L.units.forEach(function (u) { cells[u.label] = String(row[u.col] || '').trim(); });
    rows.push({ r: r + 1, book: book, name: name, note: L.iNote >= 0 ? String(row[L.iNote] || '').trim() : '', cells: cells });
  }
  return { ok: true, sheet: sh.getName(), units: L.units.map(function (u) { return u.label; }), rows: rows };
}

// req: { r: 행 번호(1-base), name: 학생 이름(확인용), unit: '7-8', clear: true면 지우기 }
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
    var value = '';
    if (req.clear) {
      cell.clearContent();
    } else {
      value = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d');
      cell.setNumberFormat('@').setValue(value);
    }
    return { ok: true, value: value };
  } finally {
    lock.releaseLock();
  }
}
