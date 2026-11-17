(function () {
  'use strict';

  var STORAGE_KEY = 'wordTest.settings.v1';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    books: [],
    bookId: null,
    book: null,          // {title, days:[{day, words}]}
    selected: new Set(), // 선택된 day 값
    lastClicked: null,   // Shift+클릭 기준 인덱스
    questions: null,     // 마지막으로 만든 문항
    questionKey: '',     // 문항을 다시 섞어야 하는지 판단하는 키
    want: { m: 10, s: 10 } // 사용자가 원한 문항 수
  };

  // ---------- 저장/불러오기 ----------
  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function save() {
    try {
      var s = readSettings();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bookId: state.bookId,
        days: Array.from(state.selected),
        meaning: state.want.m, spelling: state.want.s,
        mode: s.mode, columns: s.columns, fontSize: s.fontSize, hint: s.hint,
        academy: s.academy, title: s.title
      }));
    } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 무시 */ }
  }

  // ---------- 유틸 ----------
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function formatDate(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) return '';
    return m[1] + '년 ' + Number(m[2]) + '월 ' + Number(m[3]) + '일';
  }
  function toInt(v) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }
  // [1,2,3,5] -> "1~3, 5"
  function rangeText(nums) {
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < sorted.length) {
      var j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      out.push(j > i ? sorted[i] + '~' + sorted[j] : String(sorted[i]));
      i = j + 1;
    }
    return out.join(', ');
  }
  function dayLabel(d) { return 'Day ' + d; }

  // ---------- 데이터 ----------
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }

  function selectedDaysSorted() {
    if (!state.book) return [];
    return state.book.days
      .map(function (d) { return d.day; })
      .filter(function (d) { return state.selected.has(d); });
  }

  // 선택한 Day의 단어(영어 단어 기준 중복 제거)
  function wordPool() {
    if (!state.book) return [];
    var seen = new Set(), pool = [];
    state.book.days.forEach(function (d) {
      if (!state.selected.has(d.day)) return;
      d.words.forEach(function (w) {
        var en = String(w[0] || '').trim(), ko = String(w[1] || '').trim();
        if (!en) return;
        var key = en.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        pool.push({ en: en, ko: ko, day: d.day });
      });
    });
    return pool;
  }

  // ---------- 설정 읽기 ----------
  function radioValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function readSettings() {
    return {
      meaning: toInt($('meaningCount').value),
      spelling: toInt($('spellingCount').value),
      mode: radioValue('mode') || 'split',
      columns: Number(radioValue('columns') || 2),
      fontSize: Number($('fontSize').value) || 14,
      hint: $('hint').checked,
      academy: $('academy').value.trim(),
      title: $('title').value.trim(),
      date: $('date').value
    };
  }
  function autoTitle() {
    if (!state.book) return '';
    var days = selectedDaysSorted();
    return state.book.title + (days.length ? ' Day ' + rangeText(days) : '') + ' 단어 시험';
  }

  // ---------- 교재 목록 ----------
  function renderBooks() {
    var list = $('bookList');
    if (!state.books.length) {
      list.innerHTML = '<p class="muted">등록된 교재가 없습니다. data/books.json을 확인하세요.</p>';
      return;
    }
    list.innerHTML = '';
    state.books.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'book-card' + (b.id === state.bookId ? ' active' : '');
      btn.textContent = b.title;
      btn.addEventListener('click', function () { selectBook(b.id, null); });
      list.appendChild(btn);
    });
  }

  function selectBook(id, restoreDays) {
    var info = state.books.find(function (b) { return b.id === id; });
    if (!info) return Promise.resolve();
    var changed = state.bookId !== id;
    state.bookId = id;
    renderBooks();
    return fetchJSON(info.file).then(function (data) {
      if (state.bookId !== id) return;
      state.book = { title: data.title || info.title, days: (data.days || []).slice() };
      state.book.days.sort(function (a, b) { return a.day - b.day; });
      state.selected = new Set();
      if (restoreDays) {
        var valid = new Set(state.book.days.map(function (d) { return d.day; }));
        restoreDays.forEach(function (d) { if (valid.has(d)) state.selected.add(d); });
      }
      if (changed && !restoreDays) $('title').value = '';
      state.lastClicked = null;
      state.questionKey = '';
      $('daySection').hidden = false;
      $('settingSection').hidden = false;
      renderDays();
      update();
    }).catch(function (err) {
      alert('교재 파일을 불러오지 못했습니다: ' + err.message);
    });
  }

  // ---------- Day 선택 ----------
  function renderDays() {
    var grid = $('dayGrid');
    grid.innerHTML = '';
    state.book.days.forEach(function (d, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-btn' + (state.selected.has(d.day) ? ' on' : '');
      btn.innerHTML = esc(dayLabel(d.day)) + '<small>' + d.words.length + '단어</small>';
      btn.addEventListener('click', function (e) { onDayClick(idx, e.shiftKey); });
      grid.appendChild(btn);
    });
  }
  function onDayClick(idx, shift) {
    var days = state.book.days;
    var day = days[idx].day;
    if (shift && state.lastClicked !== null) {
      var from = Math.min(state.lastClicked, idx), to = Math.max(state.lastClicked, idx);
      var turnOn = !state.selected.has(day);
      for (var i = from; i <= to; i++) {
        if (turnOn) state.selected.add(days[i].day); else state.selected.delete(days[i].day);
      }
    } else {
      if (state.selected.has(day)) state.selected.delete(day); else state.selected.add(day);
    }
    state.lastClicked = idx;
    renderDays();
    update();
  }

  // ---------- 문항 수 제한 ----------
  // state.want: 사용자가 원한 문항 수. 화면 값은 선택한 단어 수에 맞춰 줄여서 보여 주고,
  // Day를 더 고르면 원래 원한 값으로 돌아간다.
  function clampCounts(changedId) {
    var total = wordPool().length;
    var m = $('meaningCount'), s = $('spellingCount');
    var mv = toInt(m.value), sv = toInt(s.value);
    var warn = '';
    if (changedId === 'meaningCount' || changedId === 'spellingCount') {
      if (total > 0 && mv + sv > total) {
        if (changedId === 'spellingCount') sv = Math.max(0, total - mv);
        else mv = Math.max(0, total - sv);
        warn = '두 유형의 합계는 선택한 단어 수(' + total + '개)를 넘을 수 없습니다.';
      }
      state.want = { m: mv, s: sv };
    } else {
      mv = state.want.m; sv = state.want.s;
      if (total > 0 && mv + sv > total) {
        mv = Math.min(mv, total);
        sv = Math.max(0, Math.min(sv, total - mv));
        warn = '선택한 단어가 ' + total + '개라서 문항 수를 줄였습니다 (원래 설정: 뜻 ' +
          state.want.m + ' / 스펠링 ' + state.want.s + ').';
      }
    }
    if (String(mv) !== m.value) m.value = mv;
    if (String(sv) !== s.value) s.value = sv;
    if (total > 0) { m.max = total; s.max = total; } else { m.removeAttribute('max'); s.removeAttribute('max'); }
    $('countWarn').textContent = warn;
    $('countWarn').hidden = !warn;
  }

  function quick(kind) {
    var total = wordPool().length;
    var n = toInt($('meaningCount').value) + toInt($('spellingCount').value);
    if (n === 0 || n > total) n = total;
    var m = kind === 'meaning' ? n : kind === 'spelling' ? 0 : Math.ceil(n / 2);
    state.want = { m: m, s: n - m };
    update();
  }

  // ---------- 문항 만들기 ----------
  function buildQuestions(s, force) {
    var key = [state.bookId, selectedDaysSorted().join(','), s.meaning, s.spelling, s.mode].join('|');
    if (!force && key === state.questionKey && state.questions) return state.questions;
    var pool = shuffle(wordPool());
    // 앞쪽은 뜻 쓰기, 그다음은 스펠링 쓰기 → 같은 단어가 두 유형에 중복되지 않음
    var meaning = pool.slice(0, s.meaning).map(function (w) { return { type: 'meaning', w: w }; });
    var spelling = pool.slice(s.meaning, s.meaning + s.spelling).map(function (w) { return { type: 'spelling', w: w }; });
    var qs = s.mode === 'mix' ? shuffle(meaning.concat(spelling)) : meaning.concat(spelling);
    qs.forEach(function (q, i) { q.no = i + 1; });
    state.questions = qs;
    state.questionKey = key;
    return qs;
  }

  // ---------- 페이지 나누기 ----------
  // makePage(pageIndex) → {page, cols:[col...]}; 항목을 단 순서대로(세로 우선) 채우고 넘치면 다음 단/페이지로
  function paginate(container, makePage, elements) {
    var pages = [];
    var cur = makePage(0); pages.push(cur); container.appendChild(cur.page);
    var ci = 0;
    function nextCol() {
      ci++;
      if (ci >= cur.cols.length) {
        cur = makePage(pages.length); pages.push(cur); container.appendChild(cur.page);
        ci = 0;
      }
    }
    function overflows(col) { return col.scrollHeight > col.clientHeight + 1; }

    elements.forEach(function (el) {
      var placed = false;
      while (!placed) {
        var col = cur.cols[ci];
        col.appendChild(el);
        if (!overflows(col) || col.children.length === 1) { placed = true; break; }
        col.removeChild(el);
        // 단 끝에 남은 소제목은 다음 단으로 함께 이동
        var carry = null;
        var last = col.lastElementChild;
        if (last && last.classList.contains('keep-next') && col.children.length > 1) {
          carry = last; col.removeChild(last);
        }
        nextCol();
        if (carry) cur.cols[ci].appendChild(carry);
      }
    });
    balanceLastPage(pages[pages.length - 1]);
    return pages;
  }

  // 마지막 페이지는 단 높이를 비슷하게 맞춰 한쪽 단만 길어지지 않게 한다
  function balanceLastPage(p) {
    var cols = p.cols;
    if (cols.length < 2) return;
    var items = [];
    cols.forEach(function (c) { Array.prototype.forEach.call(c.children, function (el) { items.push(el); }); });
    if (items.length < 2) return;
    var heights = items.map(function (el) { return el.offsetHeight; });
    var total = heights.reduce(function (a, b) { return a + b; }, 0);
    var backup = cols.map(function (c) { return Array.prototype.slice.call(c.children); });

    cols.forEach(function (c) { c.innerHTML = ''; });
    var ci = 0, acc = 0;
    items.forEach(function (el, i) {
      var target = total * (ci + 1) / cols.length;
      // 이 항목을 넣으면 목표를 더 많이 넘을 때 다음 단으로 (소제목 바로 다음에서는 끊지 않음)
      var prev = items[i - 1];
      if (ci < cols.length - 1 && cols[ci].children.length > 0 &&
          acc + heights[i] / 2 > target && !(prev && prev.classList.contains('keep-next'))) {
        ci++;
      }
      cols[ci].appendChild(el);
      acc += heights[i];
    });
    // 소제목이 단 맨 끝에 남았으면 다음 단으로
    for (var k = 0; k < cols.length - 1; k++) {
      var last = cols[k].lastElementChild;
      if (last && last.classList.contains('keep-next')) cols[k + 1].insertBefore(last, cols[k + 1].firstChild);
    }
    var bad = cols.some(function (c) { return c.scrollHeight > c.clientHeight + 1; });
    if (bad) {
      cols.forEach(function (c, i) { c.innerHTML = ''; backup[i].forEach(function (el) { c.appendChild(el); }); });
    }
  }

  function makeCols(body, n) {
    body.style.gridTemplateColumns = 'repeat(' + n + ', minmax(0, 1fr))';
    var cols = [];
    for (var i = 0; i < n; i++) {
      var c = document.createElement('div');
      c.className = 'col';
      body.appendChild(c);
      cols.push(c);
    }
    return cols;
  }

  function finishFooters(pages, label) {
    pages.forEach(function (p, i) {
      p.page.querySelector('.page-foot').textContent =
        (label ? label + ' · ' : '') + (i + 1) + ' / ' + pages.length;
    });
  }

  function renderTest(qs, s, title) {
    var container = $('testPages');
    container.innerHTML = '';
    var total = qs.length;
    var dateText = formatDate(s.date);

    function makePage(idx) {
      var page = document.createElement('div');
      page.className = 'page test';
      page.style.fontSize = s.fontSize + 'px';
      var head = document.createElement('div');
      if (idx === 0) {
        head.className = 'sheet-head';
        head.innerHTML =
          (s.academy ? '<div class="sheet-academy">' + esc(s.academy) + '</div>' : '') +
          '<h2 class="sheet-title">' + esc(title) + '</h2>' +
          '<div class="sheet-info">' +
            '<div><span class="lbl">날짜</span><span>' + esc(dateText) + '</span></div>' +
            '<div><span class="lbl">이름</span><span class="fill"></span></div>' +
            '<div class="score"><span class="lbl">점수</span><span>/ ' + total + '</span></div>' +
          '</div>';
      } else {
        head.className = 'sheet-head cont';
        head.innerHTML = '<span>' + esc(title) + '</span><span>이름: ______________</span>';
      }
      page.appendChild(head);
      var body = document.createElement('div');
      body.className = 'page-body';
      page.appendChild(body);
      var foot = document.createElement('div');
      foot.className = 'page-foot';
      page.appendChild(foot);
      return { page: page, cols: makeCols(body, s.columns) };
    }

    var els = [];
    function secHead(text, desc, later) {
      var h = document.createElement('div');
      h.className = 'sec-head keep-next' + (later ? ' later' : '');
      h.innerHTML = esc(text) + (desc ? '<span class="desc">' + esc(desc) + '</span>' : '');
      els.push(h);
    }
    function qEl(q) {
      var d = document.createElement('div');
      d.className = 'q';
      var prompt = q.type === 'meaning'
        ? '<span class="qp en">' + esc(q.w.en) + '</span>'
        : '<span class="qp">' + esc(q.w.ko) + '</span>';
      var hint = q.type === 'spelling' && s.hint
        ? '<span class="hint">' + esc(q.w.en.charAt(0)) + '</span>' : '';
      d.innerHTML = '<span class="qn">' + q.no + '.</span>' + prompt + '<span class="qb">' + hint + '</span>';
      els.push(d);
    }

    if (s.mode === 'split') {
      var hasM = qs.some(function (q) { return q.type === 'meaning'; });
      var hasS = qs.some(function (q) { return q.type === 'spelling'; });
      if (hasM) {
        secHead('Ⅰ. 뜻 쓰기', '다음 영어 단어의 뜻을 우리말로 쓰시오.');
        qs.forEach(function (q) { if (q.type === 'meaning') qEl(q); });
      }
      if (hasS) {
        secHead((hasM ? 'Ⅱ' : 'Ⅰ') + '. 스펠링 쓰기', '다음 뜻에 맞는 영어 단어를 쓰시오.', hasM);
        qs.forEach(function (q) { if (q.type === 'spelling') qEl(q); });
      }
    } else {
      var both = qs.some(function (q) { return q.type === 'meaning'; }) && qs.some(function (q) { return q.type === 'spelling'; });
      secHead('다음 물음에 답하시오.',
        both ? '영어 단어는 우리말 뜻을, 우리말은 영어 단어를 쓰시오.' :
        qs.length && qs[0].type === 'meaning' ? '영어 단어의 뜻을 우리말로 쓰시오.' : '뜻에 맞는 영어 단어를 쓰시오.');
      qs.forEach(qEl);
    }

    var pages = paginate(container, makePage, els);
    finishFooters(pages, '');
  }

  function renderAnswers(qs, s, title) {
    var container = $('answerPages');
    container.innerHTML = '';
    var dateText = formatDate(s.date);
    var nCols = 3;

    function makePage(idx) {
      var page = document.createElement('div');
      page.className = 'page answer';
      var head = document.createElement('div');
      head.className = 'ans-head';
      head.innerHTML = '<span class="t">정답' + (idx > 0 ? ' (계속)' : '') + '</span>' +
        '<span class="s">' + esc(title) + (dateText ? ' · ' + esc(dateText) : '') + '</span>';
      page.appendChild(head);
      var body = document.createElement('div');
      body.className = 'page-body';
      page.appendChild(body);
      var foot = document.createElement('div');
      foot.className = 'page-foot';
      page.appendChild(foot);
      return { page: page, cols: makeCols(body, nCols) };
    }

    var els = [];
    function secHead(text) {
      var h = document.createElement('div');
      h.className = 'a-sec keep-next';
      h.textContent = text;
      els.push(h);
    }
    function aEl(q) {
      var d = document.createElement('div');
      d.className = 'a';
      var body = q.type === 'meaning'
        ? esc(q.w.en) + ' — <span class="aw">' + esc(q.w.ko) + '</span>'
        : '<span class="aw">' + esc(q.w.en) + '</span> — ' + esc(q.w.ko);
      var tag = s.mode === 'mix' ? '<span class="ty">' + (q.type === 'meaning' ? '뜻' : '철자') + '</span>' : '';
      d.innerHTML = '<span class="an">' + q.no + '.</span><span>' + tag + body + '</span>';
      els.push(d);
    }

    if (s.mode === 'split') {
      var m = qs.filter(function (q) { return q.type === 'meaning'; });
      var sp = qs.filter(function (q) { return q.type === 'spelling'; });
      if (m.length) { secHead('Ⅰ. 뜻 쓰기'); m.forEach(aEl); }
      if (sp.length) { secHead((m.length ? 'Ⅱ' : 'Ⅰ') + '. 스펠링 쓰기'); sp.forEach(aEl); }
    } else {
      qs.forEach(aEl);
    }

    var pages = paginate(container, makePage, els);
    finishFooters(pages, '답지');
  }

  // ---------- 전체 갱신 ----------
  var renderTimer = null;
  function update(changedId, force) {
    if (!state.book) return;
    clampCounts(changedId);
    var s = readSettings();
    var total = wordPool().length;
    $('totalWords').textContent = total;
    $('sumCount').textContent = s.meaning + s.spelling;
    $('title').placeholder = autoTitle() || '비우면 자동으로 만들어집니다';
    save();

    var ready = state.selected.size > 0 && s.meaning + s.spelling > 0;
    $('actionSection').hidden = !ready;
    $('emptyMsg').hidden = ready;
    if (!ready) {
      $('emptyMsg').querySelector('p').textContent = state.selected.size === 0
        ? '시험에 낼 Day를 하나 이상 선택하세요.'
        : '뜻 쓰기 또는 스펠링 쓰기 문항 수를 입력하세요.';
      $('testPages').innerHTML = '';
      $('answerPages').innerHTML = '';
      return;
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { render(force); }, 60);
  }

  function render(force) {
    var s = readSettings();
    var qs = buildQuestions(s, force);
    var title = s.title || autoTitle();
    renderTest(qs, s, title);
    renderAnswers(qs, s, title);
  }

  // ---------- 인쇄 ----------
  function doPrint(kind) {
    document.body.classList.remove('print-test', 'print-answer', 'print-both');
    document.body.classList.add('print-' + kind);
    window.print();
  }
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-test', 'print-answer', 'print-both');
  });

  // ---------- 초기화 ----------
  function applySaved(sv) {
    if (sv.meaning != null) state.want.m = toInt(sv.meaning);
    if (sv.spelling != null) state.want.s = toInt(sv.spelling);
    $('meaningCount').value = state.want.m;
    $('spellingCount').value = state.want.s;
    if (sv.mode) { var r = document.querySelector('input[name="mode"][value="' + sv.mode + '"]'); if (r) r.checked = true; }
    if (sv.columns) { var c = document.querySelector('input[name="columns"][value="' + sv.columns + '"]'); if (c) c.checked = true; }
    if (sv.fontSize) $('fontSize').value = String(sv.fontSize);
    if (!$('fontSize').value) $('fontSize').value = '14';
    $('hint').checked = !!sv.hint;
    if (sv.academy) $('academy').value = sv.academy;
    if (sv.title) $('title').value = sv.title;
  }

  function bind() {
    $('selectAll').addEventListener('click', function () {
      state.book.days.forEach(function (d) { state.selected.add(d.day); });
      renderDays(); update();
    });
    $('selectNone').addEventListener('click', function () {
      state.selected.clear(); state.lastClicked = null;
      renderDays(); update();
    });
    ['meaningCount', 'spellingCount'].forEach(function (id) {
      $(id).addEventListener('input', function () { update(id); });
    });
    ['fontSize', 'hint', 'date'].forEach(function (id) {
      $(id).addEventListener('change', function () { update(); });
    });
    ['academy', 'title'].forEach(function (id) {
      $(id).addEventListener('input', function () { update(); });
    });
    document.querySelectorAll('input[name="mode"], input[name="columns"]').forEach(function (el) {
      el.addEventListener('change', function () { update(); });
    });
    document.querySelectorAll('[data-quick]').forEach(function (b) {
      b.addEventListener('click', function () { quick(b.getAttribute('data-quick')); });
    });
    $('shuffleBtn').addEventListener('click', function () { update(null, true); });
    document.querySelectorAll('[data-print]').forEach(function (b) {
      b.addEventListener('click', function () { doPrint(b.getAttribute('data-print')); });
    });
  }

  function init() {
    var sv = loadSaved();
    applySaved(sv);
    $('date').value = todayStr();
    bind();
    fetchJSON('data/books.json').then(function (books) {
      state.books = Array.isArray(books) ? books : [];
      renderBooks();
      var startId = sv.bookId && state.books.some(function (b) { return b.id === sv.bookId; }) ? sv.bookId : null;
      if (startId) return selectBook(startId, sv.days || []);
    }).catch(function (err) {
      $('bookList').innerHTML = '<p class="warn">교재 목록을 불러오지 못했습니다 (' + esc(err.message) + ').<br>' +
        '파일을 직접 열지 말고 웹 주소(또는 로컬 서버)로 접속하세요.</p>';
    });
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
