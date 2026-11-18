(function () {
  'use strict';

  var STORAGE_KEY = 'wordTest.settings.v1';
  var COVER_COLORS = ['#1f7a5a', '#2b6cb0', '#c0392b', '#8e44ad', '#d68910', '#16a085', '#7f5539', '#34495e'];
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var state = {
    books: [],
    bookId: null,        // 선택한 교재
    book: null,          // {title, days:[{day, words}]}
    selected: new Set(), // 선택된 day 값
    lastClicked: null,   // Shift+클릭 기준 인덱스
    questions: null,
    questionKey: '',
    want: { m: 0, s: 0, all: true }, // 사용자가 원한 문항 수 (all: 뜻 100% 기본값)
    titleEdited: false      // 시험 제목을 직접 고쳤는지
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
        mode: s.mode, hint: s.hint,
        title: state.titleEdited ? s.title : ''
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
  // [1,2,3,5] -> "1-3, 5"
  function rangeText(nums) {
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < sorted.length) {
      var j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      out.push(j > i ? sorted[i] + '-' + sorted[j] : String(sorted[i]));
      i = j + 1;
    }
    return out.join(', ');
  }
  function dayLabel(d) { return 'Day ' + (d < 10 ? '0' + d : d); }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }

  // ---------- 데이터 도우미 ----------
  function selectedDaysSorted() {
    if (!state.book) return [];
    return state.book.days.map(function (d) { return d.day; })
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

  function radioValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function readSettings() {
    return {
      meaning: toInt($('meaningCount').value),
      spelling: toInt($('spellingCount').value),
      mode: radioValue('mode') || 'random',
      columns: 3, // 시험지는 항상 3단
      fontSize: 14, // 글자 크기는 '보통'으로 고정
      hint: $('hint').checked,
      title: $('title').value.trim(),
      date: $('date').value
    };
  }
  function autoTitle() {
    if (!state.book) return '';
    var days = selectedDaysSorted();
    // 예: "수능2000 Day 1-2", 부록이 섞이면 "어원편 Day 1-2, 부록1" (books.json의 short가 있으면 약칭 사용)
    var nums = days.filter(function (d) { return !unitInfo(d).label; });
    var labels = days.filter(function (d) { return unitInfo(d).label; }).map(function (d) { return unitInfo(d).label; });
    var parts = [];
    if (nums.length) parts.push('Day ' + rangeText(nums));
    if (labels.length) parts.push(labels.join(', '));
    return (state.book.short || state.book.title) + (parts.length ? ' ' + parts.join(', ') : '');
  }
  // 단원 정보: 일반 Day는 {}, 부록 등은 {label:'부록1', name:'혼동어휘 1'}
  function unitInfo(day) {
    return (state.dayInfo && state.dayInfo[day]) || {};
  }
  function unitHeading(day) {
    var u = unitInfo(day);
    return u.name || u.label || 'Day ' + day;
  }

  // ---------- 교재 ----------
  function coverHTML(b, idx) {
    if (b.cover) {
      // 이미지를 못 불러오면 그 아래의 제목 글자가 보인다
      return '<div class="cover img"><span class="fallback">' + esc(b.title) + '</span>' +
        '<img src="' + esc(b.cover) + '" alt="" onerror="this.style.display=\'none\'">' +
        '<span class="check-mark">✓</span></div>';
    }
    var color = b.color || COVER_COLORS[idx % COVER_COLORS.length];
    return '<div class="cover gen" style="background:' + esc(color) + '">' +
      '<div class="c-top">VOCA</div>' +
      '<div class="c-main">' + esc(b.title) + '</div>' +
      '<div class="c-foot"></div><span class="check-mark">✓</span></div>';
  }
  function renderBooks() {
    var list = $('bookList');
    if (!state.books.length) {
      list.innerHTML = '<p class="muted">등록된 교재가 없습니다. data/books.json을 확인하세요.</p>';
      return;
    }
    list.innerHTML = '';
    state.books.forEach(function (b, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'book-card' + (b.id === state.bookId ? ' active' : '');
      btn.innerHTML = coverHTML(b, idx) + '<span class="b-title">' + esc(b.title) + '</span>' +
        (b.scope ? '<span class="b-scope' + (b.scope.indexOf('파생어') >= 0 ? ' deriv' : '') + '">' + esc(b.scope) + '</span>' : '');
      btn.addEventListener('click', function () { if (b.id !== state.bookId) loadBook(b.id, null); });
      list.appendChild(btn);
    });
  }
  function loadBook(id, restoreDays) {
    var info = state.books.find(function (b) { return b.id === id; });
    if (!info) return Promise.resolve(false);
    qsa('.book-card').forEach(function (el, i) { el.classList.toggle('active', state.books[i].id === id); });
    if (info.sheet && prog.url && !prog.bookCache[id]) {
      $('emptyMsg').textContent = '단어장을 불러오는 중…';
      $('emptyMsg').hidden = false;
      $('previewArea').hidden = true;
    }
    return getBookData(id).then(function (data) {
      var changed = state.bookId !== id;
      state.bookId = id;
      state.book = { title: data.title || info.title, short: info.short || '', days: (data.days || []).slice() };
      state.book.days.sort(function (a, b) { return a.day - b.day; });
      state.dayInfo = {};
      state.book.days.forEach(function (d) {
        if (d.label || d.name) state.dayInfo[d.day] = { label: d.label || '', name: d.name || '' };
      });
      state.selected = new Set();
      if (restoreDays) {
        var valid = new Set(state.book.days.map(function (d) { return d.day; }));
        restoreDays.forEach(function (d) { if (valid.has(d)) state.selected.add(d); });
      } else if (changed) {
        state.titleEdited = false;
      }
      state.lastClicked = null;
      state.questionKey = '';
      $('work').hidden = false;
      renderDays();
      update();
      return true;
    }).catch(function (err) {
      state.pendingBook = { id: id, days: restoreDays };
      if (view !== 'prog') {
        $('emptyMsg').textContent = bookErrorText(err);
        $('emptyMsg').hidden = false;
        $('previewArea').hidden = true;
      }
      return false;
    });
  }

  // ---------- Day ----------
  function renderDays() {
    var grid = $('dayGrid');
    grid.innerHTML = '';
    state.book.days.forEach(function (d, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-btn' + (state.selected.has(d.day) ? ' on' : '');
      btn.title = unitHeading(d.day) + ' (' + d.words.length + '단어)';
      btn.innerHTML = esc(d.label || d.day) + '<small>' + d.words.length + '</small>';
      if (d.label) btn.classList.add('extra');
      btn.addEventListener('click', function (e) { onDayClick(idx, e.shiftKey); });
      grid.appendChild(btn);
    });
    $('dayCountText').textContent = state.selected.size + '/' + state.book.days.length;
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

  // ---------- 문항 수 ----------
  // 화면 값은 선택한 단어 수에 맞춰 줄여서 보여 주고, Day를 더 고르면 원래 원한 값(state.want)으로 돌아간다.
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
      if (state.want.all) { mv = total; sv = 0; } // 기본값: 선택한 단어 전부 뜻 쓰기
      else if (total > 0 && mv + sv > total) {
        mv = Math.min(mv, total);
        sv = Math.max(0, Math.min(sv, total - mv));
        warn = '선택한 단어가 ' + total + '개라서 문항 수를 줄였습니다 (원래 설정: 뜻 ' +
          state.want.m + ' / 스펠링 ' + state.want.s + ').';
      }
    }
    if (String(mv) !== m.value) m.value = mv;
    if (String(sv) !== s.value) s.value = sv;
    $('countWarn').textContent = warn;
    $('countWarn').hidden = !warn;
  }
  function stepperAction(targetId, act) {
    var total = wordPool().length;
    var el = $(targetId);
    var other = toInt($(targetId === 'meaningCount' ? 'spellingCount' : 'meaningCount').value);
    var v = toInt(el.value);
    if (act === 'dec') v = Math.max(0, v - 1);
    else if (act === 'inc') v = v + 1;
    else if (act === 'max') v = Math.max(0, total - other);
    el.value = v;
    update(targetId);
  }
  function quick(kind) {
    var total = wordPool().length;
    var n = toInt($('meaningCount').value) + toInt($('spellingCount').value);
    if (n === 0 || n > total) n = total;
    var m = kind === 'meaning' ? n : kind === 'spelling' ? 0 : Math.ceil(n / 2);
    state.want = { m: m, s: n - m, all: kind === 'meaning' && n === total };
    update();
  }

  // ---------- 문항 만들기 ----------
  function buildQuestions(s, force) {
    var key = [state.bookId, selectedDaysSorted().join(','), s.meaning, s.spelling, s.mode].join('|');
    if (!force && key === state.questionKey && state.questions) return state.questions;
    var qs = makeQuestions(wordPool(), s.meaning, s.spelling, s.mode);
    state.questions = qs;
    state.questionKey = key;
    return qs;
  }

  // pool: [{en, ko, day}] → 번호가 붙은 문항 목록
  function makeQuestions(pool, nMeaning, nSpelling, mode) {
    pool = shuffle(pool);
    // 섞은 목록의 앞쪽은 뜻 쓰기, 그다음은 스펠링 쓰기 → 같은 단어가 두 유형에 중복되지 않음
    var meaning = pool.slice(0, nMeaning).map(function (w) { return { type: 'meaning', w: w }; });
    var spelling = pool.slice(nMeaning, nMeaning + nSpelling).map(function (w) { return { type: 'spelling', w: w }; });
    var qs = shuffle(meaning.concat(spelling)); // Day 구분 없이 무작위
    if (mode === 'byday') {
      // Day별로 무작위: Day 순서대로 묶고, 같은 Day 안에서는 섞인 순서 유지
      qs = qs.map(function (q, i) { return { q: q, i: i }; })
        .sort(function (a, b) { return (a.q.w.day - b.q.w.day) || (a.i - b.i); })
        .map(function (x) { return x.q; });
    }
    qs.forEach(function (q, i) { q.no = i + 1; });
    return qs;
  }

  // 교재 데이터에서 days(Set)에 해당하는 단어 목록 (영어 단어 기준 중복 제거)
  function poolFrom(bookData, daySet) {
    var seen = new Set(), pool = [];
    bookData.days.forEach(function (d) {
      if (!daySet.has(d.day)) return;
      d.words.forEach(function (w) {
        var en = String(w[0] || '').trim(), ko = String(w[1] || '').trim();
        if (!en || seen.has(en.toLowerCase())) return;
        seen.add(en.toLowerCase());
        pool.push({ en: en, ko: ko, day: d.day });
      });
    });
    return pool;
  }

  // ---------- 페이지 나누기 ----------
  // 항목을 단 순서대로(세로 우선) 채우고 넘치면 다음 단/페이지로
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

    var grouped = false;
    elements.forEach(function (el, idx) {
      // 묶음 소제목(Day): 단 아래쪽에 소제목과 문항 2~3개만 덩그러니 남지 않도록,
      // 소제목 + 첫 3문항이 안 들어가면 다음 단에서 시작 (공간 낭비를 줄이려고 묶음 전체는 따지지 않음)
      var n = Number(el.getAttribute('data-group') || 0);
      if (n) {
        grouped = true;
        var c = cur.cols[ci];
        if (c.children.length > 0) {
          var group = elements.slice(idx, idx + 1 + Math.min(n, 3));
          group.forEach(function (g) { c.appendChild(g); });
          var over = overflows(c);
          group.forEach(function (g) { c.removeChild(g); });
          if (over) nextCol();
        }
      }
      for (;;) {
        var col = cur.cols[ci];
        col.appendChild(el);
        if (!overflows(col) || col.children.length === 1) break;
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
    if (!grouped) balanceLastPage(pages[pages.length - 1]); // 묶음 배치는 단 맞추기를 하지 않음
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
      var prev = items[i - 1];
      if (ci < cols.length - 1 && cols[ci].children.length > 0 &&
          acc + heights[i] / 2 > target && !(prev && prev.classList.contains('keep-next'))) {
        ci++;
      }
      cols[ci].appendChild(el);
      acc += heights[i];
    });
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
  // gap: 문항 사이 간격(em). 만들어진 페이지 수를 돌려준다
  // opt: { into: 그릴 곳(기본 #testPages), name: 이름 칸에 미리 적을 이름, heading: Day 소제목 함수 }
  function renderTest(qs, s, title, gap, opt) {
    opt = opt || {};
    var heading = opt.heading || unitHeading;
    var container = opt.into || $('testPages');
    container.innerHTML = '';
    var total = qs.length;
    var dateText = formatDate(s.date);

    function makePage(idx) {
      var page = document.createElement('div');
      page.className = 'page test';
      page.style.fontSize = s.fontSize + 'px';
      page.style.setProperty('--qgap', gap + 'em');
      var head = document.createElement('div');
      if (idx === 0) {
        head.className = 'sheet-head';
        head.innerHTML =
          '<div class="sheet-top">' +
            '<img class="sheet-logo" src="img/logo.png" alt="강서해밀">' +
            '<h2 class="sheet-title">' + esc(title) + '</h2>' +
            '<span></span>' +
          '</div>' +
          '<div class="sheet-info">' +
            '<div><span class="lbl">날짜</span><span>' + esc(dateText) + '</span></div>' +
            '<div><span class="lbl">이름</span><span class="fill name">' + esc(opt.name || '') + '</span></div>' +
            '<div class="score"><span class="lbl">점수</span><span>/ ' + total + '</span></div>' +
          '</div>';
      } else {
        head.className = 'sheet-head cont';
        head.innerHTML = '<span>' + esc(title) + '</span><span>이름: ' + (opt.name ? esc(opt.name) : '______________') + '</span>';
      }
      page.appendChild(head);
      var body = document.createElement('div');
      body.className = 'page-body';
      page.appendChild(body);
      return { page: page, cols: makeCols(body, s.columns) };
    }

    var els = [];
    function qEl(q) {
      var d = document.createElement('div');
      d.className = q.type === 'spelling' ? 'q sp' : 'q';
      var prompt = q.type === 'meaning'
        ? '<span class="qp en">' + esc(q.w.en) + '</span>'
        : '<span class="qp">' + esc(q.w.ko) + '</span>';
      var hint = q.type === 'spelling' && s.hint
        ? '<span class="hint">' + esc(q.w.en.charAt(0)) + '</span>' : '';
      // 번호 | (문제 + 빈칸) — 줄이 넘어가도 번호 오른쪽에 들여쓰기된 채로 이어진다
      d.innerHTML = '<span class="qn">' + q.no + '.</span><span class="qc">' + prompt + '<span class="qb">' + hint + '</span></span>';
      els.push(d);
    }

    // Day별로 무작위일 때만 "Day 1" 같은 소제목을 넣는다
    var lastDay = null;
    qs.forEach(function (q) {
      if (s.mode === 'byday' && q.w.day !== lastDay) {
        var h = document.createElement('div');
        h.className = 'sec-head keep-next' + (lastDay !== null ? ' later' : '');
        h.textContent = heading(q.w.day);
        h.setAttribute('data-group', qs.filter(function (x) { return x.w.day === q.w.day; }).length);
        els.push(h);
        lastDay = q.w.day;
      }
      qEl(q);
    });

    return paginate(container, makePage, els).length;
  }

  function renderAnswers(qs, s, title, opt) {
    opt = opt || {};
    var heading = opt.heading || unitHeading;
    var container = opt.into || $('answerPages');
    container.innerHTML = '';
    var dateText = formatDate(s.date);
    var sub = (opt.name ? opt.name + ' · ' : '') + title + (dateText ? ' · ' + dateText : '');

    function makePage(idx) {
      var page = document.createElement('div');
      page.className = 'page answer';
      var head = document.createElement('div');
      head.className = 'ans-head';
      head.innerHTML = '<span class="t">정답' + (idx > 0 ? ' (계속)' : '') + '</span>' +
        '<span class="s">' + esc(sub) + '</span>';
      page.appendChild(head);
      var body = document.createElement('div');
      body.className = 'page-body';
      page.appendChild(body);
      return { page: page, cols: makeCols(body, 3) };
    }

    var els = [];
    var bothTypes = qs.some(function (q) { return q.type === 'meaning'; }) && qs.some(function (q) { return q.type === 'spelling'; });
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
      var tag = bothTypes ? '<span class="ty">' + (q.type === 'meaning' ? '뜻' : '철자') + '</span>' : '';
      d.innerHTML = '<span class="an">' + q.no + '.</span><span>' + tag + body + '</span>';
      els.push(d);
    }

    // Day별로 출제했으면 답지에 Day 구분을 넣어 채점하기 쉽게
    var lastDay = null;
    qs.forEach(function (q) {
      if (s.mode === 'byday' && q.w.day !== lastDay) { secHead(heading(q.w.day)); lastDay = q.w.day; }
      aEl(q);
    });

    paginate(container, makePage, els);
  }

  // 답지: 한 장에 다 들어가는 가장 큰 글자 크기로 (15px → 11px).
  //  11px로도 한 장을 넘으면 두 장에 맞춰 다시 가장 큰 크기로 (세 장, 네 장 … 마찬가지)
  var ANS_SIZES = [15, 14.5, 14, 13.5, 13, 12.5, 12, 11.5, 11];
  function renderAnswersFit(qs, s, title, opt) {
    var box = (opt && opt.into) || $('answerPages');
    var cur = -1;
    var pagesAt = function (i) {
      cur = i;
      box.style.setProperty('--afs', ANS_SIZES[i] + 'px');
      renderAnswers(qs, s, title, opt);
      return box.querySelectorAll('.page').length;
    };
    var last = ANS_SIZES.length - 1;
    var limit = Math.max(1, pagesAt(last)); // 가장 작은 크기일 때 장수 = 목표 장수
    // 그 장수 안에 들어가는 가장 큰 크기 (이진 탐색)
    var lo = 0, hi = last - 1, best = last;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (pagesAt(mid) <= limit) { best = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (cur !== best) pagesAt(best);
  }

  // 미리보기를 칸 너비에 맞게 축소
  function fitPreview() {
    var area = $('previewArea'), scaler = $('scaler'), sizer = $('sizer');
    var avail = area.clientWidth;
    if (!avail) return;
    var w = scaler.offsetWidth, h = scaler.offsetHeight;
    var scale = Math.min(1, avail / w);
    scaler.style.transform = 'scale(' + scale + ')';
    sizer.style.width = (w * scale) + 'px';
    sizer.style.height = (h * scale) + 'px';
  }

  // ---------- 전체 갱신 ----------
  var renderTimer = null;
  function update(changedId, force) {
    if (!state.book) return;
    clampCounts(changedId);
    var s = readSettings();
    var pool = wordPool();
    $('totalWords').textContent = pool.length;
    $('sumCount').textContent = s.meaning + s.spelling;
    // 직접 고치지 않았으면 제목 칸을 자동 제목으로 계속 채운다
    if (!state.titleEdited) $('title').value = autoTitle();
    $('title').placeholder = autoTitle();
    $('titleReset').hidden = !state.titleEdited;
    save();
    if (view === 'prog') return; // 진도표 화면에서는 미리보기를 건드리지 않음

    var msg = state.selected.size === 0 ? '왼쪽에서 시험에 낼 Day를 선택하세요.'
      : s.meaning + s.spelling === 0 ? '뜻 쓰기 또는 스펠링 쓰기 문항 수를 정하세요.' : '';
    $('emptyMsg').textContent = msg;
    $('emptyMsg').hidden = !msg;
    $('previewArea').hidden = !!msg;
    qsa('.toolbar button').forEach(function (b) { b.disabled = !!msg; });
    if (!msg) renderSoon(force);
  }
  function renderSoon(force) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { render(force); }, 60);
  }
  function render(force) {
    if (view === 'prog') return;
    var s = readSettings();
    if (!state.book || s.meaning + s.spelling === 0 || state.selected.size === 0) return;
    var qs = buildQuestions(s, force);
    var title = s.title || autoTitle();
    $('scaler').style.transform = 'none';
    $('testPages').innerHTML = '';
    $('answerPages').innerHTML = '';
    renderTestFit(qs, s, title, { into: $('testPages') });
    renderAnswersFit(qs, s, title, { into: $('answerPages') });
    fitPreview();
  }

  // 가장 좁은 간격으로 만들 때의 페이지 수를 넘지 않는 범위에서, 가장 넓은 간격을 고른다
  // (예: 80문항이면 1장에 들어가는 가장 넓은 간격)
  function renderTestFit(qs, s, title, opt) {
    var gaps = [1.5, 1.35, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7];
    var minPages = renderTest(qs, s, title, gaps[gaps.length - 1], opt);
    for (var i = 0; i < gaps.length - 1; i++) {
      if (renderTest(qs, s, title, gaps[i], opt) <= minPages) return;
    }
    renderTest(qs, s, title, gaps[gaps.length - 1], opt);
  }

  // ---------- 인쇄 ----------
  // 양면 인쇄: 시험지와 답지가 각각 새 장(앞면)에서 시작하도록, 쪽 수가 홀수인 묶음 뒤에 빈 쪽을 넣는다
  //  - 묶음 = 시험지 만들기: 시험지 / 답지, 진도표: 학생별 시험지 / 학생별 답지
  //  - 시험지 뒷면에 답지가 인쇄되지 않고, 다음 학생도 새 장에서 시작
  //  - 진도표에서 답지를 맨 뒤에 모을 때와 "답지만" 인쇄할 때는 빈 쪽 없이 이어서 (선생님용)
  //  - 인쇄되는 마지막 쪽 뒤에는 넣지 않음
  function duplexOn() { return $('genDuplex').checked; }
  function addDuplexPads(kind) {
    qsa('.page.pad-page').forEach(function (p) { p.remove(); });
    if (!duplexOn() || kind === 'answer') return; // 답지만 인쇄(선생님용)는 빈 쪽 없이 이어서
    var shows = function (pg) { return kind === 'both' || pg.classList.contains(kind); };
    var groups;
    if (view === 'prog') {
      var ansEach = (radioValue('progAns') || 'each') === 'each';
      groups = qsa('#scaler .student-set').filter(function (w) {
        return w.getAttribute('data-kind') === 'test' || ansEach;
      });
    } else {
      groups = [$('testPages'), $('answerPages')];
    }
    var all = qsa('#scaler .page').filter(shows);
    var lastPrinted = all[all.length - 1];
    groups.forEach(function (g) {
      var pages = Array.prototype.slice.call(g.querySelectorAll('.page')).filter(shows);
      if (!pages.length || pages.length % 2 === 0) return;
      var last = pages[pages.length - 1];
      if (last === lastPrinted) return;
      var pad = document.createElement('div');
      pad.className = 'page pad-page ' + (last.classList.contains('answer') ? 'answer' : 'test');
      last.parentNode.insertBefore(pad, last.nextSibling);
    });
  }

  function doPrint(kind) {
    document.body.classList.remove('print-test', 'print-answer', 'print-both');
    document.body.classList.add('print-' + kind);
    addDuplexPads(kind);
    // 인쇄될 마지막 페이지 뒤에는 빈 페이지가 생기지 않도록 표시
    qsa('.page.last-printed').forEach(function (p) { p.classList.remove('last-printed'); });
    var pages = qsa('#scaler .page').filter(function (p) {
      return kind === 'both' || (kind === 'test' ? p.classList.contains('test') : p.classList.contains('answer'));
    });
    if (pages.length) pages[pages.length - 1].classList.add('last-printed');
    window.print();
  }

  // =====================================================================
  // 진도표 (구글 시트 연결)
  // =====================================================================
  // 학원 진도표 Apps Script 주소 (학원 안에서만 쓰는 사이트라 코드에 고정)
  var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwV7Rh5ZPlqlChsNh7p897UNv7dJRSu0bABc1AfKPd9silYCJDRSo90AtN1RvEGyL_-fA/exec';
  var VIEW_KEY = 'wordTest.view';
  var prog = {
    url: '',
    data: null,          // { sheet, units:['1-2',...], rows:[{r, book, name, note, cells}] }
    selected: new Set(), // 체크한 학생의 행 번호(r)
    bookCache: {},       // 교재 id → 교재 데이터
    qcache: {},          // 학생별 문항 (다시 섞기 전까지 유지)
    busy: false
  };
  var view = 'gen';

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }

  // 교재 단어 데이터 (한 번 받으면 이 페이지에서는 다시 받지 않음)
  //  - books.json에 sheet(구글 시트의 단어장 탭 이름)가 있으면 Apps Script에서 받는다 (단어는 공개 저장소에 없음)
  //  - 없으면 file(JSON)에서 받는다
  var bookLoading = {};
  function getBookData(id) {
    if (prog.bookCache[id]) return Promise.resolve(prog.bookCache[id]);
    if (bookLoading[id]) return bookLoading[id];
    var info = state.books.find(function (b) { return b.id === id; });
    var p;
    if (info.sheet) {
      if (!prog.url) return Promise.reject(new Error('NO_SHEET'));
      p = fetch(prog.url + (prog.url.indexOf('?') >= 0 ? '&' : '?') + 'action=book&tab=' + encodeURIComponent(info.sheet))
        .then(function (r) { if (!r.ok) throw new Error('시트 응답 오류 (' + r.status + ')'); return r.json(); })
        .then(function (j) {
          if (!j || j.ok === false) throw new Error((j && j.error) || '단어장을 읽지 못했습니다.');
          return { title: info.title, days: j.days };
        });
    } else {
      p = fetchJSON(info.file);
    }
    bookLoading[id] = p.then(function (d) {
      d.days.sort(function (a, b) { return a.day - b.day; });
      prog.bookCache[id] = d;
      delete bookLoading[id];
      return d;
    }, function (err) { delete bookLoading[id]; throw err; });
    return bookLoading[id];
  }
  function bookErrorText(err) {
    return err.message === 'NO_SHEET'
      ? '단어장은 구글 시트에 있습니다. 위쪽 "진도표" 탭에서 구글 시트를 먼저 연결하세요.'
      : '교재 단어를 불러오지 못했습니다: ' + err.message;
  }

  // 시트의 '교재' 칸 → books.json의 교재 (약칭·이름·id, 띄어쓰기·괄호 무시)
  function keyOf(s) { return String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase(); }
  function matchBook(text) {
    var k = keyOf(text);
    if (!k) return null;
    var exact = state.books.find(function (b) { return [b.short, b.title, b.id].some(function (x) { return keyOf(x) === k; }); });
    if (exact) return exact;
    return state.books.find(function (b) {
      return [b.short, b.title].some(function (x) { var kx = keyOf(x); return kx && (k.indexOf(kx) >= 0 || kx.indexOf(k) >= 0); });
    }) || null;
  }
  function parseUnit(label) {
    var m = /^(\d+)(?:-(\d+))?$/.exec(label);
    if (!m) return null;
    var a = +m[1], b = m[2] ? +m[2] : a;
    return { a: Math.min(a, b), b: Math.max(a, b), label: label };
  }
  function bookMaxDay(info) { return info && info.maxDay || 0; }

  // 학생별 "이번에 볼 칸 수"(Day 단위 시트면 Day 수). 이 PC 브라우저에 기억한다
  var COUNT_KEY = 'wordTest.dayCount';
  function countMap() { try { return JSON.parse(lsGet(COUNT_KEY) || '{}'); } catch (e) { return {}; } }
  function defaultCount() { return +($('progDefault') && $('progDefault').value) || 2; }
  function getCount(row) { var m = countMap(); return +m[keyOf(row.book) + '|' + row.name] || defaultCount(); }
  function setCount(row, n) { var m = countMap(); m[keyOf(row.book) + '|' + row.name] = n; lsSet(COUNT_KEY, JSON.stringify(m)); }

  // 여러 칸을 하나의 범위로: [{a,b,label}] → {a, b, label:'7-9', units:['7','8','9']}
  function joinUnits(list) {
    var a = list[0].a, b = list[list.length - 1].b;
    return { a: a, b: b, label: a === b ? String(a) : a + '-' + b, units: list.map(function (u) { return u.label; }) };
  }

  // 칸 하나에 적힌 통과 날짜들 ("11/18, 2/3" → ['11/18', '2/3'])
  //  '재11/18' 은 재시험 표시라 통과 날짜로 세지 않음
  function partsOf(row, u) {
    return String(row.cells[u.label] || '').split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function passesOf(row, u) {
    return partsOf(row, u).filter(function (s) { return s.charAt(0) !== '재'; });
  }
  // 다음 범위에 재시험 표시가 있으면 그 날짜 ('11/18'), 없으면 ''
  function retestOf(row, st) {
    if (!st.next) return '';
    var d = '';
    st.next.units.forEach(function (label) {
      partsOf(row, { label: label }).forEach(function (s) { if (s.charAt(0) === '재') d = s.slice(1); });
    });
    return d;
  }

  // 학생 한 줄의 상태
  //  회독(round): 모든 Day 칸의 날짜 개수 중 가장 작은 값 + 1 (1회독을 다 마치면 2회독 Day 1부터)
  //  다음 범위: 이번 회독에서 아직 통과하지 않은 첫 칸부터 '칸 수'만큼 (이어진 칸만)
  //  최근: 마지막으로 같은 날짜에 통과한 칸들
  function studentInfo(row) {
    var book = matchBook(row.book);
    var units = prog.data.units.map(parseUnit).filter(Boolean).sort(function (x, y) { return x.a - y.a; });
    var max = book ? bookMaxDay(book) : 0;
    var inRange = units.filter(function (u) { return !max || u.a <= max; });
    var cnt = function (u) { return passesOf(row, u).length; };
    var round = inRange.length ? Math.min.apply(null, inRange.map(cnt)) + 1 : 1;
    var count = getCount(row);
    var done = inRange.filter(function (u) { return cnt(u) >= round; }).length;

    var next = null, i = inRange.findIndex(function (u) { return cnt(u) < round; });
    if (i >= 0) {
      var pick = [inRange[i]];
      for (var k = i + 1; k < inRange.length && pick.length < count; k++) {
        if (cnt(inRange[k]) >= round || inRange[k].a !== pick[pick.length - 1].b + 1) break;
        pick.push(inRange[k]);
      }
      next = joinUnits(pick);
    }

    // 이번 회독에 통과한 칸이 있으면 그중 마지막 묶음, 없으면(새 회독 시작 직후) 지난 회독의 마지막 묶음
    var last = null, li = -1, nth = round - 1;
    for (var x = inRange.length - 1; x >= 0; x--) { if (cnt(inRange[x]) >= round) { li = x; break; } }
    if (li < 0 && round > 1) { li = inRange.length - 1; nth = round - 2; }
    if (li >= 0) {
      var dateAt = function (u) { return passesOf(row, u)[nth]; };
      var date = dateAt(inRange[li]), grp = [inRange[li]];
      for (var y = li - 1; y >= 0 && cnt(inRange[y]) === nth + 1 && dateAt(inRange[y]) === date && inRange[y].b === grp[0].a - 1; y--) grp.unshift(inRange[y]);
      last = { range: joinUnits(grp), date: date, round: nth + 1 };
    }
    return { book: book, next: next, last: last, done: done, total: inRange.length, count: count, round: round };
  }

  function api(method, body) {
    if (!prog.url) return Promise.reject(new Error('구글 시트 주소가 없습니다.'));
    var opt = method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }
      : { method: 'GET' };
    return fetch(prog.url + (method === 'GET' ? (prog.url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now() : ''), opt)
      .then(function (r) {
        if (!r.ok) throw new Error('시트 응답 오류 (' + r.status + ')');
        return r.json();
      })
      .then(function (j) {
        if (!j || j.ok === false) throw new Error((j && j.error) || '시트 응답을 읽지 못했습니다.');
        return j;
      });
  }

  function setStatus(text, kind) {
    var el = $('sheetStatus');
    el.textContent = text;
    el.className = 'tiny status ' + (kind || '');
  }

  // 관리 키: 이 PC 브라우저에만 저장 (학생 추가·수정·삭제용)
  function saveAdminKey() {
    prog.adminKey = $('adminKey').value.trim();
    lsSet('wordTest.adminKey', prog.adminKey);
    renderProgList();
    setStatus(prog.adminKey ? '관리 키를 저장했습니다.' : '관리 키를 지웠습니다.', 'ok');
  }


  function loadSheet() {
    if (!prog.url) { renderProgList(); return Promise.resolve(); }
    setStatus('불러오는 중…');
    $('progRefresh').disabled = true;
    return api('GET').then(function (j) {
      prog.data = j;
      prog.version = j.version || 1;
      // 시트에서 사라진 학생은 선택 해제
      var rs = new Set(j.rows.map(function (x) { return x.r; }));
      prog.selected.forEach(function (r) { if (!rs.has(r)) prog.selected.delete(r); });
      if (prog.version < 3) {
        setStatus('Apps Script를 새 버전으로 업데이트해야 통과를 기록할 수 있습니다 (예전 버전은 회독 날짜를 덮어씀). README의 "진도표(구글 시트) 연결" 2번을 다시 해 주세요.', 'err');
      } else {
        setStatus('연결됨 · ' + j.sheet + ' · 학생 ' + j.rows.length + '명', 'ok');
      }
      $('sheetBox').classList.add('connected');
      renderProgList();
      renderBatchSoon();
    }).catch(function (err) {
      setStatus('불러오지 못했습니다: ' + err.message, 'err');
      $('sheetBox').classList.remove('connected');
    }).then(function () { $('progRefresh').disabled = false; });
  }

  // 시트에 있는 학년 목록 (중1 → 고3 순서, 그 밖의 값은 뒤에)
  var GRADE_ORDER = ['초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
  function gradeList() {
    var set = [];
    prog.data.rows.forEach(function (r) { if (r.grade && set.indexOf(r.grade) < 0) set.push(r.grade); });
    return set.sort(function (a, b) {
      var ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }
  function setGrade(g) {
    prog.grade = g;
    lsSet('wordTest.grade', g);
    // 다른 학년으로 바꾸면, 보이지 않는 학생의 선택은 풀어서 엉뚱하게 같이 인쇄되지 않게
    prog.data.rows.forEach(function (r) { if (g && r.grade !== g) prog.selected.delete(r.r); });
    renderProgList(); renderBatchSoon();
  }

  function renderProgList() {
    var box = $('progTable');
    if (!prog.data) {
      box.innerHTML = '<p class="muted pad">구글 시트를 연결하면 학생 목록이 나타납니다.</p>';
      $('progCount').textContent = '';
      $('gradeChips').innerHTML = '';
      return;
    }
    // 학년 필터 (시트에 학년 칸이 있을 때만)
    var grades = gradeList();
    var gf = grades.indexOf(prog.grade) >= 0 ? prog.grade : '';
    $('gradeChips').innerHTML = grades.length ? ['', ].concat(grades).map(function (g) {
      var n = prog.data.rows.filter(function (r) { return !g || r.grade === g; }).length;
      return '<button type="button" class="chip' + (g === gf ? ' on' : '') + '" data-grade="' + esc(g) + '">' + esc(g || '전체') + ' <small>' + n + '</small></button>';
    }).join('') : '';
    var visible = prog.data.rows.filter(function (r) { return !gf || r.grade === gf; });

    // 학년·교재별로 묶기 (시트 순서 유지)
    var groups = [], byKey = {};
    visible.forEach(function (row) {
      var k = (row.grade || '') + '|' + (row.book || '(교재 없음)');
      if (!byKey[k]) { byKey[k] = { grade: row.grade || '', name: row.book || '(교재 없음)', rows: [] }; groups.push(byKey[k]); }
      byKey[k].rows.push(row);
    });
    // 학년 순서(중3 → 고1 → 고2 …)로, 같은 학년 안에서는 시트 순서대로
    var gidx = function (g) { var i = grades.indexOf(g); return i < 0 ? 99 : i; };
    groups = groups.map(function (g, i) { return { g: g, i: i }; })
      .sort(function (a, b) { return gidx(a.g.grade) - gidx(b.g.grade) || a.i - b.i; })
      .map(function (x) { return x.g; });
    var canWrite = prog.version >= 3;
    var canAdmin = prog.version >= 4 && !!prog.adminKey;
    $('stuAdd').hidden = !canAdmin;
    var html = '';
    groups.forEach(function (g, gi) {
      var info0 = studentInfo(g.rows[0]);
      var allOn = g.rows.every(function (r) { return prog.selected.has(r.r); });
      html += '<div class="pgroup">' +
        '<div class="pgroup-head"><label class="check"><input type="checkbox" data-group="' + gi + '"' + (allOn ? ' checked' : '') + '> ' +
        (g.grade ? '<span class="grade-tag">' + esc(g.grade) + '</span>' : '') +
        esc(info0.book ? (info0.book.short || info0.book.title) : g.name) + '</label>' +
        (info0.book ? '<span class="tiny">' + esc(info0.book.title) + ' · ' + g.rows.length + '명</span>'
                    : '<span class="warn">교재를 찾지 못했습니다: "' + esc(g.name) + '"</span>') +
        '</div><table class="ptable"><tbody>';
      g.rows.forEach(function (row) {
        var st = studentInfo(row);
        var on = prog.selected.has(row.r);
        var nextTxt = !st.book ? '-' : st.next ? 'Day ' + st.next.label : (st.total ? '완료' : '-');
        var lastTxt = st.last ? 'Day ' + st.last.range.label + ' · ' + st.last.date + (st.last.round < st.round ? ' (' + st.last.round + '회독)' : '') : '기록 없음';
        var cntOpts = '';
        for (var n = 1; n <= 5; n++) cntOpts += '<option value="' + n + '"' + (n === st.count ? ' selected' : '') + '>' + n + '</option>';
        html += '<tr class="' + (on ? 'on' : '') + '">' +
          '<td class="c-chk"><input type="checkbox" data-r="' + row.r + '"' + (on ? ' checked' : '') + (st.book && st.next ? '' : ' disabled') + '></td>' +
          '<td class="c-name">' + esc(row.name) + (st.round > 1 ? '<span class="round">' + st.round + '회독</span>' : '') + (retestOf(row, st) ? '<span class="retest" title="재시험 ' + esc(retestOf(row, st)) + '">재 ' + esc(retestOf(row, st)) + '</span>' : '') + (row.note ? '<span class="note" title="' + esc(row.note) + '">' + esc(row.note) + '</span>' : '') + '</td>' +
          '<td class="c-cnt"><select data-cnt="' + row.r + '" title="이번에 볼 Day 수"' + (st.book ? '' : ' disabled') + '>' + cntOpts + '</select><span class="lbl">개</span></td>' +
          '<td class="c-next"><span class="lbl">다음</span> <b>' + esc(nextTxt) + '</b></td>' +
          '<td class="c-last" title="' + esc(lastTxt) + '"><span class="lbl">최근</span> ' + esc(lastTxt) + '</td>' +
          '<td class="c-prog"><span class="bar"><i style="width:' + (st.total ? Math.round(st.done / st.total * 100) : 0) + '%"></i></span> ' + st.done + '/' + st.total + '</td>' +
          '<td class="c-act">' +
            '<button type="button" class="btn small pass" data-pass="' + row.r + '"' + (st.book && st.next && canWrite ? '' : ' disabled') + ' title="' + (st.next ? 'Day ' + esc(st.next.label) + ' 통과로 오늘 날짜 기록' : '') + '">통과 ✓</button>' +
            (prog.version >= 13 ? '<button type="button" class="btn small retest-btn' + (retestOf(row, st) ? ' on' : '') + '" data-retest="' + row.r + '"' + (st.book && st.next ? '' : ' disabled') + ' title="' + (retestOf(row, st) ? '재시험 표시 지우기' : '다음 범위를 재시험으로 표시 (진도표 칸에 재+날짜)') + '">재시험</button>' : '') +
            '<button type="button" class="btn small undo" data-undo="' + row.r + '"' + (st.last && canWrite ? '' : ' disabled') + ' title="마지막 통과 기록 지우기">↶</button>' +
            (canAdmin ? '<button type="button" class="btn small edit" data-edit="' + row.r + '" title="학생 정보 수정·삭제">✎</button>' : '') +
          '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    box.innerHTML = html;
    $('progCount').textContent = prog.selected.size ? '· ' + prog.selected.size + '명 선택' : '';

    // 이벤트
    qsa('#gradeChips [data-grade]').forEach(function (b) {
      b.addEventListener('click', function () { setGrade(b.getAttribute('data-grade')); });
    });
    qsa('#progTable input[data-r]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var r = +cb.getAttribute('data-r');
        if (cb.checked) prog.selected.add(r); else prog.selected.delete(r);
        renderProgList(); renderBatchSoon();
      });
    });
    qsa('#progTable input[data-group]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var g = groups[+cb.getAttribute('data-group')];
        g.rows.forEach(function (row) {
          var st = studentInfo(row);
          if (cb.checked && st.book && st.next) prog.selected.add(row.r); else prog.selected.delete(row.r);
        });
        renderProgList(); renderBatchSoon();
      });
    });
    qsa('#progTable select[data-cnt]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var row = prog.data.rows.find(function (x) { return x.r === +sel.getAttribute('data-cnt'); });
        setCount(row, +sel.value);
        renderProgList(); renderBatchSoon();
      });
    });
    qsa('#progTable [data-pass]').forEach(function (b) {
      b.addEventListener('click', function () { markPass(+b.getAttribute('data-pass'), false); });
    });
    qsa('#progTable [data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openStudent(prog.data.rows.find(function (x) { return x.r === +b.getAttribute('data-edit'); })); });
    });
    qsa('#progTable [data-retest]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (prog.busy) return;
        var row = prog.data.rows.find(function (x) { return x.r === +b.getAttribute('data-retest'); });
        var st = studentInfo(row);
        if (!st.next) return;
        if (retestOf(row, st)) {
          if (!confirm(row.name + ' — Day ' + st.next.label + ' 재시험 표시를 지울까요?')) return;
          recordRows([{ row: row, st: st, pass: false, clear: true }]);
        } else recordRows([{ row: row, st: st, pass: false }]);
      });
    });
    qsa('#progTable [data-undo]').forEach(function (b) {
      b.addEventListener('click', function () { markPass(+b.getAttribute('data-undo'), true); });
    });
  }

  // 통과: 다음 범위의 칸 전부에 오늘 날짜 / 되돌리기: 마지막에 같은 날짜로 통과한 칸들을 지움
  function markPass(r, undo) {
    if (prog.busy) return;
    var row = prog.data.rows.find(function (x) { return x.r === r; });
    var st = studentInfo(row);
    if (!undo && prog.version >= 12) { recordRows([{ row: row, st: st, pass: true }]); return; }
    var range = undo ? (st.last && st.last.range) : st.next;
    if (!range) return;
    if (undo && !confirm(row.name + ' — Day ' + range.label + ' 통과 기록(' + st.last.date + ')을 지울까요?')) return;
    prog.busy = true;
    setStatus((undo ? '기록 지우는 중… ' : '기록하는 중… ') + row.name + ' Day ' + range.label);
    var lastValue = '';
    // 칸마다 차례로 기록 (중간에 실패하면 거기서 멈추고 알림)
    range.units.reduce(function (p, label) {
      return p.then(function () {
        return api('POST', { action: 'set', r: r, name: row.name, unit: label, clear: !!undo }).then(function (j) {
          row.cells[label] = j.value;
          lastValue = j.date || '';
        });
      });
    }, Promise.resolve()).then(function () {
      setStatus((undo ? '지움: ' : '통과 기록: ') + row.name + ' Day ' + range.label + (undo ? '' : ' (' + lastValue + ')'), 'ok');
    }).catch(function (err) {
      setStatus('기록하지 못했습니다: ' + err.message + ' — 새로고침해서 확인하세요.', 'err');
    }).then(function () {
      prog.busy = false;
      renderProgList();
      renderBatchSoon();
    });
  }

  // 진도표 인쇄 (A4 가로): 지금 보이는 학년의 학생들, Day 30개씩 끊어서 표로
  function printSheet() {
    if (!prog.data || !prog.data.rows.length) { setStatus('인쇄할 학생이 없습니다.', 'err'); return; }
    var grades = gradeList();
    var gf = grades.indexOf(prog.grade) >= 0 ? prog.grade : '';
    var gidx = function (g) { var i = grades.indexOf(g); return i < 0 ? 99 : i; };
    var rows = prog.data.rows.filter(function (r) { return !gf || r.grade === gf; })
      .map(function (r, i) { return { r: r, i: i }; });
    // 학년 → 교재(시트에 처음 나온 순서) → 시트 순서
    var firstAt = {};
    rows.forEach(function (x) { var k = x.r.grade + '|' + x.r.book; if (!(k in firstAt)) firstAt[k] = x.i; });
    rows.sort(function (a, b) {
      return gidx(a.r.grade) - gidx(b.r.grade) || firstAt[a.r.grade + '|' + a.r.book] - firstAt[b.r.grade + '|' + b.r.book] || a.i - b.i;
    });
    rows = rows.map(function (x) { return x.r; });
    var units = prog.data.units.map(parseUnit).filter(Boolean).sort(function (x, y) { return x.a - y.a; });
    var infos = rows.map(studentInfo);
    // 실제로 쓰는 범위까지만 (교재 최대 Day 중 가장 큰 값)
    var maxAll = infos.reduce(function (m, st) { return Math.max(m, bookMaxDay(st.book) || 0); }, 0);
    if (maxAll) units = units.filter(function (u) { return u.a <= maxAll; });
    var chunks = [];
    for (var i = 0; i < units.length; i += 30) chunks.push(units.slice(i, i + 30));
    var today = formatDate(todayStr());
    var html = '';
    chunks.forEach(function (ch, ci) {
      html += '<section class="sp-page">' +
        '<div class="sp-head"><b>VOCA 진도표</b>' + (gf ? ' <span>' + esc(gf) + '</span>' : '') +
        ' <span>Day ' + ch[0].a + '–' + ch[ch.length - 1].b + '</span>' +
        '<em>' + esc(today) + ' · 초록 = 통과(날짜) · 진초록 = 2회독 이상 · 빨강 = 재시험</em></div>' +
        '<table class="sp-table"><colgroup><col class="sp-g"><col class="sp-b"><col class="sp-n">' +
        ch.map(function () { return '<col>'; }).join('') + '</colgroup><thead><tr><th>학년</th><th>교재</th><th>이름</th>' +
        ch.map(function (u) { return '<th' + (u.b % 5 ? '' : ' class="b5"') + '>' + esc(u.label) + '</th>'; }).join('') + '</tr></thead>';
      var k = 0;
      while (k < rows.length) {
        var e = k;
        while (e + 1 < rows.length && rows[e + 1].grade === rows[k].grade && rows[e + 1].book === rows[k].book) e++;
        html += '<tbody>';
        for (var j = k; j <= e; j++) {
          var row = rows[j], st = infos[j], max = bookMaxDay(st.book);
          html += '<tr>' + (j === k ? '<td rowspan="' + (e - k + 1) + '" class="sp-gc">' + esc(row.grade || '') + '</td>' +
            '<td rowspan="' + (e - k + 1) + '" class="sp-bc">' + esc(st.book ? (st.book.short || st.book.title) : row.book) + '</td>' : '') +
            '<td class="sp-nc">' + esc(row.name) + '</td>' +
            ch.map(function (u) {
              var b5 = u.b % 5 ? '' : ' b5';
              if (max && u.a > max) return '<td class="out' + b5 + '"></td>';
              var ps = passesOf(row, u), re = partsOf(row, u).filter(function (s) { return s.charAt(0) === '재'; });
              if (re.length) return '<td class="re' + b5 + '">' + esc(re[re.length - 1]) + '</td>';
              if (!ps.length) return b5 ? '<td class="b5"></td>' : '<td></td>';
              return '<td class="' + (ps.length > 1 ? 'p2' : 'p1') + b5 + '">' + esc(ps[ps.length - 1]) + (ps.length > 1 ? '<sup>' + ps.length + '</sup>' : '') + '</td>';
            }).join('') + '</tr>';
        }
        html += '</tbody>';
        k = e + 1;
      }
      html += '</table></section>';
    });
    var box = $('sheetPrint');
    box.innerHTML = html;
    document.body.classList.add('print-sheet');
    var done = function () { document.body.classList.remove('print-sheet'); box.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  function recordRows(list) {
    prog.busy = true;
    var done = 0, fail = null;
    setStatus('기록하는 중… 0/' + list.length);
    list.reduce(function (p, x) {
      return p.then(function () {
        if (fail) return;
        return api('POST', { action: 'record', r: x.row.r, name: x.row.name, units: x.st.next.units, range: x.st.next.label,
          pass: !!x.pass, clear: !!x.clear })
          .then(function (j) {
            Object.keys(j.values || {}).forEach(function (k) { x.row.cells[k] = j.values[k]; });
            prog.selected.delete(x.row.r);
            done++;
            setStatus('기록하는 중… ' + done + '/' + list.length);
          }, function (err) { fail = err; });
      });
    }, Promise.resolve()).then(function () {
      prog.busy = false;
      var msg = fail ? ['기록하다 멈췄습니다: ' + fail.message, 'err']
        : [(list[0].pass ? '통과 기록함: ' : list[0].clear ? '재시험 표시 지움: ' : '재시험 표시함: ') + list.map(function (x) { return x.row.name + ' Day ' + x.st.next.label; }).join(', '), 'ok'];
      // 시트를 다시 불러온 뒤 결과 문구를 보여 줌
      loadSheet().then(function () { setStatus(msg[0], msg[1]); });
    });
  }

  function progSettings() {
    return {
      type: radioValue('progType') || 'meaning',
      mode: radioValue('progMode') || 'random',
      ans: radioValue('progAns') || 'each',
      date: $('progDate').value,
      hint: false,
      fontSize: 14,
      columns: 3
    };
  }

  var batchTimer = null;
  function renderBatchSoon(force) {
    clearTimeout(batchTimer);
    batchTimer = setTimeout(function () { renderBatch(force); }, 80);
  }

  // 선택한 학생들의 시험지를 학생 순서대로 이어서 만든다
  function renderBatch(force) {
    if (view !== 'prog') return;
    var ps = progSettings();
    var rows = prog.data ? prog.data.rows.filter(function (x) { return prog.selected.has(x.r); }) : [];
    var jobs = rows.map(function (row) { return { row: row, st: studentInfo(row) }; })
      .filter(function (j) { return j.st.book && j.st.next; });
    var msg = !prog.data ? '구글 시트를 연결하고 학생을 체크하면 시험지가 여기에 나타납니다.'
      : !jobs.length ? '학생을 체크하면 각자 다음 범위의 시험지가 여기에 나타납니다.' : '';
    $('emptyMsg').textContent = msg;
    $('emptyMsg').hidden = !msg;
    $('previewArea').hidden = !!msg;
    qsa('.toolbar button').forEach(function (b) { b.disabled = !!msg; });
    if (msg) { $('testPages').innerHTML = ''; $('answerPages').innerHTML = ''; return; }

    Promise.all(jobs.map(function (j) { return getBookData(j.st.book.id); })).then(function (datas) {
      if (view !== 'prog') return;
      $('scaler').style.transform = 'none';
      var testBox = $('testPages'), ansBox = $('answerPages');
      testBox.innerHTML = ''; ansBox.innerHTML = '';
      jobs.forEach(function (j, i) {
        var data = datas[i], u = j.st.next;
        var days = new Set();
        data.days.forEach(function (d) { if (d.day >= u.a && d.day <= u.b) days.add(d.day); });
        var pool = poolFrom(data, days);
        var n = pool.length;
        var nm = ps.type === 'meaning' ? n : ps.type === 'spelling' ? 0 : Math.ceil(n / 2);
        var key = [j.row.r, j.row.name, j.st.book.id, j.st.round, u.label, ps.type, ps.mode].join('|');
        if (force || !prog.qcache[key]) prog.qcache[key] = makeQuestions(pool, nm, n - nm, ps.mode);
        var qs = prog.qcache[key];
        var title = (j.st.book.short || j.st.book.title) + ' Day ' + u.label + (j.st.round > 1 ? ' (' + j.st.round + '회독)' : '');
        var s = { date: ps.date, hint: false, fontSize: 14, columns: 3, mode: ps.mode };
        var heading = function (d) { return 'Day ' + d; };
        var tw = document.createElement('div'); tw.className = 'student-set';
        tw.setAttribute('data-student', i); tw.setAttribute('data-kind', 'test');
        testBox.appendChild(tw);
        renderTestFit(qs, s, title, { into: tw, name: j.row.name, heading: heading });
        var aw = document.createElement('div'); aw.className = 'student-set';
        aw.setAttribute('data-student', i); aw.setAttribute('data-kind', 'answer');
        (ps.ans === 'each' ? testBox : ansBox).appendChild(aw);
        renderAnswersFit(qs, s, title, { into: aw, name: j.row.name, heading: heading });
      });
      fitPreview();
    }).catch(function (err) {
      $('emptyMsg').textContent = bookErrorText(err);
      $('emptyMsg').hidden = false;
    });
  }

  // ---------- 진도표: 목록 / 시트(구글 시트 화면 그대로) ----------
  var pmode = 'list';
  // 학원 진도표 시트 (주소 변경에서 다른 시트를 넣으면 그쪽을 씀)
  var DEFAULT_SHEET_DOC = 'https://docs.google.com/spreadsheets/d/16lVrtnWMEm_ZWxBh4jsvx45KuEK4KlYu9Mim2xLMEPg/edit?usp=sharing';
  // 구글 시트 주소 → 화면 안에 넣을 편집 주소 (탭 위치 #gid는 유지)
  function sheetEmbedUrl(u) {
    var m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(u || '');
    if (!m) return '';
    var gid = /[#&?]gid=(\d+)/.exec(u);
    return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/edit?usp=sharing' + (gid ? '#gid=' + gid[1] : '');
  }
  function setPMode(m) {
    var was = pmode;
    pmode = m === 'sheet' ? 'sheet' : 'list';
    lsSet('wordTest.pmode', pmode);
    qsa('input[name="pmode"]').forEach(function (r) { r.checked = r.value === pmode; });
    var src = sheetEmbedUrl(prog.docUrl);
    $('sheetOpen').hidden = !src;
    if (src) $('sheetOpen').href = src;
    $('progGrid').hidden = pmode === 'sheet';
    document.body.classList.toggle('pmode-sheet', pmode === 'sheet'); // 시트 화면에서는 미리보기 숨기고 넓게
    setTimeout(fitPreview, 50);
    $('sheetFrameBox').hidden = pmode !== 'sheet';
    $('pmodeNote').textContent = pmode === 'sheet' ? '시트에서 고친 내용은 "목록"으로 돌아오면 반영됩니다.' : '';
    if (pmode === 'sheet') {
      if (!src) {
        $('sheetFrame').hidden = true;
        $('sheetFrameMsg').textContent = '"주소 변경"을 눌러 구글 시트 주소(https://docs.google.com/spreadsheets/d/…)를 넣어 주세요.';
        $('sheetFrameMsg').hidden = false;
      } else {
        $('sheetFrameMsg').hidden = true;
        $('sheetFrame').hidden = false;
        if ($('sheetFrame').getAttribute('src') !== src) $('sheetFrame').setAttribute('src', src);
      }
    } else if (was === 'sheet' && prog.url) {
      loadSheet(); // 시트에서 고친 내용 반영
    }
  }

  // ---------- 학생 관리 (관리 키 필요) ----------
  var editing = null; // 수정 중인 학생 줄 (추가면 null)
  function maxDaysMap() {
    var m = {};
    state.books.forEach(function (b) { if (b.maxDay) { m[b.short || b.title] = b.maxDay; m[b.title] = b.maxDay; } });
    return m;
  }
  function openStudent(row) {
    editing = row || null;
    var sel = $('stuBook');
    sel.innerHTML = state.books.map(function (b) {
      var v = b.short || b.title;
      return '<option value="' + esc(v) + '">' + esc(v) + ' — ' + esc(b.title) + '</option>';
    }).join('');
    $('stuDlgTitle').textContent = row ? '학생 정보 수정' : '학생 추가';
    var fg = prog.grade || (prog.data && prog.data.rows.length ? prog.data.rows[prog.data.rows.length - 1].grade : '');
    $('stuGrade').value = row ? row.grade : fg;
    var b = row ? matchBook(row.book) : null;
    sel.value = b ? (b.short || b.title) : (row ? row.book : sel.value);
    if (row && !b) sel.insertAdjacentHTML('afterbegin', '<option value="' + esc(row.book) + '" selected>' + esc(row.book) + '</option>');
    $('stuName').value = row ? row.name : '';
    $('stuNote').value = row ? row.note : '';
    $('stuDelete').hidden = !row;
    $('stuErr').hidden = true;
    $('stuDlg').showModal();
    $(row ? 'stuName' : 'stuName').focus();
  }
  function stuBusy(on, msg) {
    ['stuSave', 'stuDelete', 'stuCancel'].forEach(function (id) { $(id).disabled = on; });
    if (msg) { $('stuErr').textContent = msg; $('stuErr').hidden = false; }
  }
  function adminCall(body) {
    body.key = prog.adminKey;
    body.maxDays = maxDaysMap();
    // 진도표 '교재' 칸 색 (books.json의 sheetColor)
    body.bookColors = {};
    state.books.forEach(function (b) { if (b.sheetColor) { body.bookColors[b.short || b.title] = b.sheetColor; body.bookColors[b.title] = b.sheetColor; } });
    return api('POST', body);
  }
  function saveStudent() {
    var grade = $('stuGrade').value.trim(), book = $('stuBook').value, name = $('stuName').value.trim(), note = $('stuNote').value.trim();
    if (!name) { stuBusy(false, '이름을 적어 주세요.'); return; }
    stuBusy(true);
    var req = editing
      ? { action: 'updateStudent', r: editing.r, name: editing.name, set: { grade: grade, book: book, name: name, note: note } }
      : { action: 'addStudent', grade: grade, book: book, name: name, note: note };
    setStatus((editing ? '수정하는 중… ' : '추가하는 중… ') + name);
    adminCall(req).then(function () {
      $('stuDlg').close();
      setStatus((editing ? '수정함: ' : '추가함: ') + name, 'ok');
      loadSheet();
    }).catch(function (err) { stuBusy(false, err.message); }).then(function () { stuBusy(false); });
  }
  function deleteStudent() {
    if (!editing) return;
    if (!confirm(editing.name + ' 학생을 진도표에서 삭제할까요? 그 학생의 통과 기록도 함께 지워집니다.')) return;
    stuBusy(true);
    var name = editing.name;
    adminCall({ action: 'deleteStudent', r: editing.r, name: name }).then(function () {
      prog.selected.delete(editing.r);
      $('stuDlg').close();
      setStatus('삭제함: ' + name, 'ok');
      loadSheet();
    }).catch(function (err) { stuBusy(false, err.message); }).then(function () { stuBusy(false); });
  }

  function setView(v) {
    view = v === 'prog' ? 'prog' : 'gen';
    lsSet(VIEW_KEY, view);
    qsa('.tabs [data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    document.body.classList.toggle('view-prog', view === 'prog');
    $('progView').hidden = view !== 'prog';
    if (view === 'prog') {
      renderProgList();
      renderBatch();
    } else {
      $('testPages').innerHTML = ''; $('answerPages').innerHTML = '';
      if (!state.book && state.pendingBook && prog.url) {
        var pb = state.pendingBook; state.pendingBook = null;
        loadBook(pb.id, pb.days);
      } else if (state.book) update(); else {
        $('emptyMsg').textContent = '교재를 고르면 여기에 시험지 미리보기가 나타납니다.';
        $('emptyMsg').hidden = false;
        $('previewArea').hidden = true;
        qsa('.toolbar button').forEach(function (b) { b.disabled = true; });
      }
    }
  }

  function bindProgress() {
    qsa('.tabs [data-view]').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    $('adminKeySave').addEventListener('click', saveAdminKey);
    $('adminKey').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveAdminKey(); });
    $('progRefresh').addEventListener('click', loadSheet);
    $('printSheet').addEventListener('click', printSheet);
    $('progNone').addEventListener('click', function () { prog.selected.clear(); renderProgList(); renderBatchSoon(); });
    $('progShuffle').addEventListener('click', function () { renderBatchSoon(true); });
    qsa('input[name="progType"], input[name="progMode"], input[name="progAns"]').forEach(function (el) {
      el.addEventListener('change', function () { renderBatchSoon(); });
    });
    $('progDate').addEventListener('change', function () { renderBatchSoon(); });
    $('progDate').value = todayStr();
    // 양면 인쇄 스위치: 시험지 만들기 탭과 진도표 탭이 같은 설정을 쓴다
    var dup = lsGet('wordTest.duplex') !== 'off';
    ['genDuplex', 'progDuplex'].forEach(function (id) {
      $(id).checked = dup;
      $(id).addEventListener('change', function () {
        var on = $(id).checked;
        $('genDuplex').checked = on; $('progDuplex').checked = on;
        lsSet('wordTest.duplex', on ? 'on' : 'off');
      });
    });
    var dflt = lsGet('wordTest.dayDefault');
    if (dflt) $('progDefault').value = dflt;
    $('progDefault').addEventListener('change', function () {
      lsSet('wordTest.dayDefault', $('progDefault').value);
      renderProgList(); renderBatchSoon();
    });
    prog.url = SCRIPT_URL;
    prog.grade = lsGet('wordTest.grade');
    prog.adminKey = lsGet('wordTest.adminKey');
    $('adminKey').value = prog.adminKey;
    prog.docUrl = DEFAULT_SHEET_DOC;
    qsa('input[name="pmode"]').forEach(function (r) { r.addEventListener('change', function () { setPMode(r.value); }); });
    setPMode(lsGet('wordTest.pmode') || 'list');
    $('stuAdd').addEventListener('click', function () { openStudent(null); });
    $('stuForm').addEventListener('submit', function (e) { e.preventDefault(); saveStudent(); });
    $('stuCancel').addEventListener('click', function () { $('stuDlg').close(); });
    $('stuDelete').addEventListener('click', deleteStudent);
  }
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-test', 'print-answer', 'print-both');
    qsa('.page.pad-page').forEach(function (p) { p.remove(); });
  });

  // ---------- 초기화 ----------
  function applySaved(sv) {
    // 문항 수는 저장하지 않고 항상 '뜻 100%'로 시작
    $('meaningCount').value = 0;
    $('spellingCount').value = 0;
    if (sv.mode) { var r = document.querySelector('input[name="mode"][value="' + sv.mode + '"]'); if (r) r.checked = true; }
    $('hint').checked = !!sv.hint;
    if (sv.title) { $('title').value = sv.title; state.titleEdited = true; }
  }

  // ---------- 라이트/다크 모드 ----------
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function updateThemeBtn() {
    $('themeBtn').textContent = currentTheme() === 'dark' ? '☀️ 라이트 모드' : '🌙 다크 모드';
  }
  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('wordTest.theme', next); } catch (e) { /* 무시 */ }
    updateThemeBtn();
  }

  function bind() {
    $('themeBtn').addEventListener('click', toggleTheme);
    updateThemeBtn();
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
    qsa('.stepper').forEach(function (st) {
      var target = st.getAttribute('data-target');
      st.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () { stepperAction(target, b.getAttribute('data-act')); });
      });
    });
    qsa('[data-quick]').forEach(function (b) {
      b.addEventListener('click', function () { quick(b.getAttribute('data-quick')); });
    });
    ['hint', 'date'].forEach(function (id) {
      $(id).addEventListener('change', function () { update(); });
    });
    $('title').addEventListener('input', function () {
      // 칸을 비우면 다시 자동 제목으로
      state.titleEdited = $('title').value.trim() !== '' && $('title').value.trim() !== autoTitle();
      update();
    });
    $('titleReset').addEventListener('click', function () {
      state.titleEdited = false;
      update();
    });
    qsa('input[name="mode"]').forEach(function (el) {
      el.addEventListener('change', function () { update(); });
    });
    ['shuffleBtn', 'shuffleBtn2'].forEach(function (id) {
      $(id).addEventListener('click', function () { if (view === 'prog') renderBatchSoon(true); else update(null, true); });
    });
    qsa('[data-print]').forEach(function (b) {
      b.addEventListener('click', function () { doPrint(b.getAttribute('data-print')); });
    });
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(fitPreview, 100);
    });
  }

  function init() {
    var sv = loadSaved();
    qsa('.toolbar button').forEach(function (b) { b.disabled = true; }); // 교재를 고르기 전에는 비활성
    applySaved(sv);
    $('date').value = todayStr();
    bind();
    bindProgress();
    fetchJSON('data/books.json').then(function (books) {
      state.books = Array.isArray(books) ? books : [];
      renderBooks();
      setView(lsGet(VIEW_KEY) || 'gen');
      if (prog.url) loadSheet();
      var saved = sv.bookId && state.books.some(function (b) { return b.id === sv.bookId; }) ? sv.bookId : null;
      if (saved) return loadBook(saved, sv.days || []);
    }).catch(function (err) {
      $('bookList').innerHTML = '<p class="warn">교재 목록을 불러오지 못했습니다 (' + esc(err.message) + ').<br>' +
        '파일을 직접 열지 말고 웹 주소(또는 로컬 서버)로 접속하세요.</p>';
    });
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
