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
    return fetchJSON(info.file).then(function (data) {
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
      alert('교재 파일을 불러오지 못했습니다: ' + err.message);
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
    renderAnswers(qs, s, title, { into: $('answerPages') });
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
  function doPrint(kind) {
    document.body.classList.remove('print-test', 'print-answer', 'print-both');
    document.body.classList.add('print-' + kind);
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
  var SHEET_KEY = 'wordTest.sheetUrl';
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

  function getBookData(id) {
    if (prog.bookCache[id]) return Promise.resolve(prog.bookCache[id]);
    var info = state.books.find(function (b) { return b.id === id; });
    return fetchJSON(info.file).then(function (d) {
      d.days.sort(function (a, b) { return a.day - b.day; });
      prog.bookCache[id] = d;
      return d;
    });
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

  // 학생 한 줄의 상태: 교재, 교재 범위 안의 회차, 다음 범위, 마지막 통과
  function studentInfo(row) {
    var book = matchBook(row.book);
    var units = prog.data.units.map(parseUnit).filter(Boolean);
    var max = book ? bookMaxDay(book) : 0;
    var inRange = units.filter(function (u) { return !max || u.a <= max; });
    var next = null, last = null, done = 0;
    inRange.forEach(function (u) {
      var v = row.cells[u.label];
      if (v) { last = { unit: u, date: v }; done++; }
      else if (!next) next = u;
    });
    return { book: book, next: next, last: last, done: done, total: inRange.length };
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

  function connectSheet() {
    var url = $('sheetUrl').value.trim();
    if (!/^https?:\/\//.test(url)) { setStatus('주소를 확인하세요 (https://script.google.com/... 로 시작).', 'err'); return; }
    prog.url = url;
    lsSet(SHEET_KEY, url);
    loadSheet();
  }

  function loadSheet() {
    if (!prog.url) { renderProgList(); return; }
    setStatus('불러오는 중…');
    $('progRefresh').disabled = true;
    api('GET').then(function (j) {
      prog.data = j;
      // 시트에서 사라진 학생은 선택 해제
      var rs = new Set(j.rows.map(function (x) { return x.r; }));
      prog.selected.forEach(function (r) { if (!rs.has(r)) prog.selected.delete(r); });
      setStatus('연결됨 · ' + j.sheet + ' · 학생 ' + j.rows.length + '명', 'ok');
      $('sheetBox').classList.add('connected');
      renderProgList();
      renderBatchSoon();
    }).catch(function (err) {
      setStatus('불러오지 못했습니다: ' + err.message, 'err');
      $('sheetBox').classList.remove('connected');
    }).then(function () { $('progRefresh').disabled = false; });
  }

  function renderProgList() {
    var box = $('progTable');
    if (!prog.data) {
      box.innerHTML = '<p class="muted pad">구글 시트를 연결하면 학생 목록이 나타납니다.</p>';
      $('progCount').textContent = '';
      return;
    }
    // 교재별로 묶기 (시트 순서 유지)
    var groups = [], byKey = {};
    prog.data.rows.forEach(function (row) {
      var k = row.book || '(교재 없음)';
      if (!byKey[k]) { byKey[k] = { name: k, rows: [] }; groups.push(byKey[k]); }
      byKey[k].rows.push(row);
    });
    var html = '';
    groups.forEach(function (g, gi) {
      var info0 = studentInfo(g.rows[0]);
      var allOn = g.rows.every(function (r) { return prog.selected.has(r.r); });
      html += '<div class="pgroup">' +
        '<div class="pgroup-head"><label class="check"><input type="checkbox" data-group="' + gi + '"' + (allOn ? ' checked' : '') + '> ' +
        esc(info0.book ? (info0.book.short || info0.book.title) : g.name) + '</label>' +
        (info0.book ? '<span class="tiny">' + esc(info0.book.title) + ' · ' + g.rows.length + '명</span>'
                    : '<span class="warn">교재를 찾지 못했습니다: "' + esc(g.name) + '"</span>') +
        '</div><table class="ptable"><tbody>';
      g.rows.forEach(function (row) {
        var st = studentInfo(row);
        var on = prog.selected.has(row.r);
        var nextTxt = !st.book ? '-' : st.next ? 'Day ' + st.next.label : (st.total ? '완료' : '-');
        var lastTxt = st.last ? 'Day ' + st.last.unit.label + ' · ' + st.last.date : '기록 없음';
        html += '<tr class="' + (on ? 'on' : '') + '">' +
          '<td class="c-chk"><input type="checkbox" data-r="' + row.r + '"' + (on ? ' checked' : '') + (st.book && st.next ? '' : ' disabled') + '></td>' +
          '<td class="c-name">' + esc(row.name) + (row.note ? '<span class="note" title="' + esc(row.note) + '">' + esc(row.note) + '</span>' : '') + '</td>' +
          '<td class="c-next"><span class="lbl">다음</span> <b>' + esc(nextTxt) + '</b></td>' +
          '<td class="c-last"><span class="lbl">최근</span> ' + esc(lastTxt) + '</td>' +
          '<td class="c-prog"><span class="bar"><i style="width:' + (st.total ? Math.round(st.done / st.total * 100) : 0) + '%"></i></span> ' + st.done + '/' + st.total + '</td>' +
          '<td class="c-act">' +
            '<button type="button" class="btn small pass" data-pass="' + row.r + '"' + (st.book && st.next ? '' : ' disabled') + ' title="' + (st.next ? 'Day ' + esc(st.next.label) + ' 통과로 오늘 날짜 기록' : '') + '">통과 ✓</button>' +
            '<button type="button" class="btn small undo" data-undo="' + row.r + '"' + (st.last ? '' : ' disabled') + ' title="마지막 통과 기록 지우기">↶</button>' +
          '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    box.innerHTML = html;
    $('progCount').textContent = prog.selected.size ? '· ' + prog.selected.size + '명 선택' : '';

    // 이벤트
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
    qsa('#progTable [data-pass]').forEach(function (b) {
      b.addEventListener('click', function () { markPass(+b.getAttribute('data-pass'), false); });
    });
    qsa('#progTable [data-undo]').forEach(function (b) {
      b.addEventListener('click', function () { markPass(+b.getAttribute('data-undo'), true); });
    });
  }

  function markPass(r, undo) {
    if (prog.busy) return;
    var row = prog.data.rows.find(function (x) { return x.r === r; });
    var st = studentInfo(row);
    var unit = undo ? (st.last && st.last.unit) : st.next;
    if (!unit) return;
    if (undo && !confirm(row.name + ' — Day ' + unit.label + ' 통과 기록(' + st.last.date + ')을 지울까요?')) return;
    prog.busy = true;
    setStatus((undo ? '기록 지우는 중… ' : '기록하는 중… ') + row.name + ' Day ' + unit.label);
    api('POST', { action: 'set', r: r, name: row.name, unit: unit.label, clear: !!undo }).then(function (j) {
      row.cells[unit.label] = undo ? '' : j.value;
      setStatus((undo ? '지움: ' : '통과 기록: ') + row.name + ' Day ' + unit.label + (undo ? '' : ' (' + j.value + ')'), 'ok');
      renderProgList();
      renderBatchSoon();
    }).catch(function (err) {
      setStatus('기록하지 못했습니다: ' + err.message, 'err');
    }).then(function () { prog.busy = false; });
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
        var key = [j.row.r, j.row.name, j.st.book.id, u.label, ps.type, ps.mode].join('|');
        if (force || !prog.qcache[key]) prog.qcache[key] = makeQuestions(pool, nm, n - nm, ps.mode);
        var qs = prog.qcache[key];
        var title = (j.st.book.short || j.st.book.title) + ' Day ' + u.label;
        var s = { date: ps.date, hint: false, fontSize: 14, columns: 3, mode: ps.mode };
        var heading = function (d) { return 'Day ' + d; };
        var tw = document.createElement('div'); tw.className = 'student-set';
        testBox.appendChild(tw);
        renderTestFit(qs, s, title, { into: tw, name: j.row.name, heading: heading });
        var aw = document.createElement('div'); aw.className = 'student-set';
        (ps.ans === 'each' ? testBox : ansBox).appendChild(aw);
        renderAnswers(qs, s, title, { into: aw, name: j.row.name, heading: heading });
      });
      fitPreview();
    }).catch(function (err) {
      $('emptyMsg').textContent = '교재 데이터를 불러오지 못했습니다: ' + err.message;
      $('emptyMsg').hidden = false;
    });
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
      if (state.book) update(); else {
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
    $('sheetConnect').addEventListener('click', connectSheet);
    $('sheetUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') connectSheet(); });
    $('sheetEdit').addEventListener('click', function () { $('sheetBox').classList.remove('connected'); $('sheetUrl').focus(); });
    $('progRefresh').addEventListener('click', loadSheet);
    $('progNone').addEventListener('click', function () { prog.selected.clear(); renderProgList(); renderBatchSoon(); });
    $('progShuffle').addEventListener('click', function () { renderBatchSoon(true); });
    qsa('input[name="progType"], input[name="progMode"], input[name="progAns"]').forEach(function (el) {
      el.addEventListener('change', function () { renderBatchSoon(); });
    });
    $('progDate').addEventListener('change', function () { renderBatchSoon(); });
    $('progDate').value = todayStr();
    prog.url = lsGet(SHEET_KEY);
    $('sheetUrl').value = prog.url;
  }
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-test', 'print-answer', 'print-both');
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
