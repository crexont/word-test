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
      btn.innerHTML = coverHTML(b, idx) + '<span class="b-title">' + esc(b.title) + '</span>';
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
    var pool = shuffle(wordPool());
    // 섞은 목록의 앞쪽은 뜻 쓰기, 그다음은 스펠링 쓰기 → 같은 단어가 두 유형에 중복되지 않음
    var meaning = pool.slice(0, s.meaning).map(function (w) { return { type: 'meaning', w: w }; });
    var spelling = pool.slice(s.meaning, s.meaning + s.spelling).map(function (w) { return { type: 'spelling', w: w }; });
    var qs = shuffle(meaning.concat(spelling)); // Day 구분 없이 무작위
    if (s.mode === 'byday') {
      // Day별로 무작위: Day 순서대로 묶고, 같은 Day 안에서는 섞인 순서 유지
      var order = {};
      state.book.days.forEach(function (d, i) { order[d.day] = i; });
      qs = qs.map(function (q, i) { return { q: q, i: i }; })
        .sort(function (a, b) { return (order[a.q.w.day] - order[b.q.w.day]) || (a.i - b.i); })
        .map(function (x) { return x.q; });
    }
    qs.forEach(function (q, i) { q.no = i + 1; });
    state.questions = qs;
    state.questionKey = key;
    return qs;
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
          '<div class="sheet-top">' +
            '<img class="sheet-logo" src="img/logo.png" alt="강서해밀">' +
            '<h2 class="sheet-title">' + esc(title) + '</h2>' +
            '<span></span>' +
          '</div>' +
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
    function qEl(q) {
      var d = document.createElement('div');
      d.className = 'q';
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
        h.textContent = unitHeading(q.w.day);
        h.setAttribute('data-group', qs.filter(function (x) { return x.w.day === q.w.day; }).length);
        els.push(h);
        lastDay = q.w.day;
      }
      qEl(q);
    });

    finishFooters(paginate(container, makePage, els), '');
  }

  function renderAnswers(qs, s, title) {
    var container = $('answerPages');
    container.innerHTML = '';
    var dateText = formatDate(s.date);

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
      if (s.mode === 'byday' && q.w.day !== lastDay) { secHead(unitHeading(q.w.day)); lastDay = q.w.day; }
      aEl(q);
    });

    finishFooters(paginate(container, makePage, els), '답지');
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
    var s = readSettings();
    if (!state.book || s.meaning + s.spelling === 0 || state.selected.size === 0) return;
    var qs = buildQuestions(s, force);
    var title = s.title || autoTitle();
    $('scaler').style.transform = 'none';
    renderTest(qs, s, title);
    renderAnswers(qs, s, title);
    fitPreview();
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
      $(id).addEventListener('click', function () { update(null, true); });
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
    applySaved(sv);
    $('date').value = todayStr();
    bind();
    fetchJSON('data/books.json').then(function (books) {
      state.books = Array.isArray(books) ? books : [];
      renderBooks();
      var saved = sv.bookId && state.books.some(function (b) { return b.id === sv.bookId; }) ? sv.bookId : null;
      if (saved) return loadBook(saved, sv.days || []);
    }).catch(function (err) {
      $('bookList').innerHTML = '<p class="warn">교재 목록을 불러오지 못했습니다 (' + esc(err.message) + ').<br>' +
        '파일을 직접 열지 말고 웹 주소(또는 로컬 서버)로 접속하세요.</p>';
    });
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
