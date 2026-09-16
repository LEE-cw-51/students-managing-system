(function () {
  var state = {
    settings: {},
    grades: [],
    today: '',
    route: 'dashboard',
    params: {},
    cache: {},
    bootReady: false
  };

  var BOOT_CACHE_KEY = 'lms_boot_v1';

  var MENUS = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'today', label: '오늘의 수업' },
    { id: 'students', label: '학생관리' },
    { id: 'classes', label: '반관리' },
    { id: 'daily', label: '일일보고서' },
    { id: 'monthly', label: '월간보고서' },
    { id: 'stats', label: '통계' },
    { id: 'settings', label: '설정' }
  ];

  function api(name, args) {
    args = args || [];
    return fetch('/api/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ args: args })
    }).then(function (r) {
      if (r.status === 401) {
        location.href = '/login';
        throw new Error('로그인이 필요합니다.');
      }
      return r.json();
    }).then(unwrap);
  }

  function applyBoot(boot) {
    if (!boot) return;
    state.settings = boot.settings || {};
    state.grades = boot.grades || state.grades || [];
    state.today = boot.today || state.today;
    state.cache.classes = boot.classes || [];
    state.cache.students = boot.students || [];
    state.cache.dashboard = boot.dashboard || null;
    state.bootReady = true;
  }

  function persistBoot() {
    try {
      localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({
        settings: state.settings,
        grades: state.grades,
        today: state.today,
        classes: state.cache.classes || [],
        students: state.cache.students || [],
        dashboard: state.cache.dashboard || null
      }));
    } catch (e) {}
  }

  function readLocalBoot() {
    try {
      return JSON.parse(localStorage.getItem(BOOT_CACHE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function withBusy(btn, work) {
    if (!btn) return Promise.resolve().then(work);
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '처리 중...';
    return Promise.resolve().then(work).then(function (res) {
      btn.disabled = false;
      btn.textContent = label;
      return res;
    }, function (err) {
      btn.disabled = false;
      btn.textContent = label;
      throw err;
    });
  }

  function filterStudents(rows, filter) {
    filter = filter || {};
    var q = String(filter.query || '').toLowerCase();
    return (rows || []).filter(function (s) {
      if (filter.status && s.status !== filter.status) return false;
      if (filter.grade && s.grade !== filter.grade) return false;
      if (filter.classId) {
        var ok = (s.current_classes || []).some(function (c) {
          return c.class_id === filter.classId;
        });
        if (!ok) return false;
      }
      if (q && String(s.name || '').toLowerCase().indexOf(q) === -1 &&
          String(s.student_id || '').toLowerCase().indexOf(q) === -1 &&
          String(s.school || '').toLowerCase().indexOf(q) === -1) {
        return false;
      }
      return true;
    });
  }

  function refreshLookups() {
    return api('getLookups', []).then(function (res) {
      state.cache.classes = res.classes || [];
      state.cache.students = res.students || [];
      state.cache.dashboard = null;
      persistBoot();
      return res;
    });
  }

  function unwrap(res) {
    if (!res || res.ok === false) throw new Error((res && res.error) || '요청에 실패했습니다.');
    return res.data;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function val(v) { return v == null ? '' : String(v); }

  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.remove('hidden');
    setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  function spinner(root, msg) {
    root.innerHTML = '<div class="card empty">' + esc(msg || '불러오는 중...') + '</div>';
  }

  function field(label, inner) {
    return '<div class="field"><label>' + esc(label) + '</label>' + inner + '</div>';
  }

  function input(name, value, type, extra) {
    return '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' + (extra || '') + '>';
  }

  function select(name, options, current) {
    return '<select name="' + name + '">' + options.map(function (o) {
      var v = typeof o === 'string' ? o : o.value;
      var l = typeof o === 'string' ? o : o.label;
      return '<option value="' + esc(v) + '"' + (String(current) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }

  function parseHash() {
    var raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    return { route: parts[0] || 'dashboard', params: { id: parts[1] || '' } };
  }

  function go(path) {
    location.hash = '#/' + path.replace(/^#\/?/, '');
  }

  function renderNav() {
    document.getElementById('nav').innerHTML = MENUS.map(function (m) {
      return '<a href="#/' + m.id + '" class="' + (state.route === m.id ? 'active' : '') + '">' + m.label + '</a>';
    }).join('') + '<a href="/login" id="logout-link">로그아웃</a>';
    var title = (MENUS.filter(function (m) { return m.id === state.route; })[0] || {}).label || '학습관리';
    document.getElementById('page-title').textContent = title;
    document.getElementById('brand-name').textContent = state.settings.academy_name || '수학의 힘';
    document.getElementById('top-date').textContent = state.today || '';
  }

  function loadLookups(force) {
    if (!force && state.cache.classes && state.cache.students) {
      return Promise.resolve([state.cache.classes, state.cache.students]);
    }
    return refreshLookups().then(function (res) {
      return [res.classes, res.students];
    });
  }

  function classOptions(selected, includeAll) {
    var list = (state.cache.classes || []).filter(function (c) { return c.status === '운영' || c.class_id === selected; });
    var opts = includeAll ? [{ value: '', label: '전체 반' }] : [{ value: '', label: '반 선택' }];
    list.forEach(function (c) { opts.push({ value: c.class_id, label: c.class_name }); });
    return opts;
  }

  function studentOptions(selected) {
    var opts = [{ value: '', label: '학생 선택' }];
    (state.cache.students || []).filter(function (s) { return s.status === '재원' || s.student_id === selected; })
      .forEach(function (s) { opts.push({ value: s.student_id, label: s.name + ' · ' + s.grade }); });
    return opts;
  }

  function paintDashboard(root, d) {
    root.innerHTML =
      '<div class="grid stats">' +
        stat('오늘 수업 반', d.today_class_count) +
        stat('오늘 수업 학생', d.today_student_count) +
        stat('기록 완료', d.recorded_count) +
        stat('기록 미완료', d.incomplete_count) +
      '</div>' +
      '<div class="split">' +
        '<div class="card"><div class="toolbar"><h3 style="margin:0">오늘 수업 반</h3><button class="btn" id="go-today">오늘의 수업 열기</button></div>' +
          (d.classes.length ? '<table><thead><tr><th>반</th><th>요일</th><th>시간</th><th>담당</th></tr></thead><tbody>' +
            d.classes.map(function (c) {
              return '<tr><td>' + esc(c.class_name) + '</td><td>' + esc(c.weekday) + '</td><td>' +
                esc(c.start_time) + (c.end_time ? '–' + esc(c.end_time) : '') + '</td><td>' + esc(c.teacher) + '</td></tr>';
            }).join('') + '</tbody></table>' : '<div class="empty">오늘 배정된 운영 반이 없습니다.</div>') +
        '</div>' +
        '<div class="card"><h3>학생 현황</h3><p>재원 <b>' + d.enrolled_count + '</b></p><p>휴원 <b>' + d.paused_count + '</b></p><p>퇴원 <b>' + d.archived_count + '</b></p><p class="muted">보고서 생성 가능 ' + d.report_ready_count + '건</p></div>' +
      '</div>' +
      '<div class="card" style="margin-top:14px">' +
        '<div class="cal-toolbar">' +
          '<h3>수업 · 보강 달력</h3>' +
          '<button class="btn secondary" id="cal-prev">이전</button>' +
          '<button class="btn secondary" id="cal-today">오늘</button>' +
          '<button class="btn secondary" id="cal-next">다음</button>' +
          '<button class="btn" id="cal-week">주간</button>' +
          '<button class="btn" id="cal-month">월간</button>' +
          '<button class="btn ok" id="cal-add">보강 추가</button>' +
        '</div>' +
        '<div class="cal-legend">' +
          '<span><i class="cal-dot regular"></i>정규 수업</span>' +
          '<span><i class="cal-dot class-makeup"></i>반 보강</span>' +
          '<span><i class="cal-dot student-makeup"></i>개인 보강</span>' +
        '</div>' +
        '<p class="muted" id="cal-label"></p>' +
        '<div id="cal-body"><div class="empty">달력을 불러오는 중...</div></div>' +
      '</div>' +
      '<div id="makeup-form"></div>';
    document.getElementById('go-today').onclick = function () { go('today'); };
    bindCalendar();
  }

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? '0' + s : s;
  }

  function addDaysIso(iso, delta) {
    var parts = String(iso || '').split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function weekRangeIso(iso) {
    var parts = String(iso || '').split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var day = d.getDay();
    var mondayOffset = day === 0 ? -6 : 1 - day;
    var start = addDaysIso(iso, mondayOffset);
    return { start: start, end: addDaysIso(start, 6) };
  }

  function monthRangeIso(iso) {
    var parts = String(iso || '').split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var last = new Date(y, m, 0).getDate();
    return { start: y + '-' + pad2(m) + '-01', end: y + '-' + pad2(m) + '-' + pad2(last), year: y, month: m };
  }

  function calEventClass(ev) {
    if (ev.event_type === '반보강') return 'class-makeup';
    if (ev.event_type === '개인보강') return 'student-makeup';
    return 'regular';
  }

  function calEventLabel(ev) {
    var time = ev.start_time ? ev.start_time + (ev.end_time ? '–' + ev.end_time : '') : '';
    var title = ev.title || '';
    return (time ? time + ' ' : '') + title;
  }

  function bindCalendar() {
    if (!state.cal) state.cal = { view: 'month', cursor: state.today };
    if (!state.cal.cursor) state.cal.cursor = state.today;
    var weekBtn = document.getElementById('cal-week');
    var monthBtn = document.getElementById('cal-month');
    if (weekBtn) weekBtn.className = 'btn' + (state.cal.view === 'week' ? '' : ' secondary');
    if (monthBtn) monthBtn.className = 'btn' + (state.cal.view === 'month' ? '' : ' secondary');
    document.getElementById('cal-week').onclick = function () {
      state.cal.view = 'week';
      loadCalendar();
    };
    document.getElementById('cal-month').onclick = function () {
      state.cal.view = 'month';
      loadCalendar();
    };
    document.getElementById('cal-today').onclick = function () {
      state.cal.cursor = state.today;
      loadCalendar();
    };
    document.getElementById('cal-prev').onclick = function () {
      if (state.cal.view === 'week') state.cal.cursor = addDaysIso(weekRangeIso(state.cal.cursor).start, -7);
      else {
        var r = monthRangeIso(state.cal.cursor);
        state.cal.cursor = addDaysIso(r.start, -1);
      }
      loadCalendar();
    };
    document.getElementById('cal-next').onclick = function () {
      if (state.cal.view === 'week') state.cal.cursor = addDaysIso(weekRangeIso(state.cal.cursor).start, 7);
      else {
        var r = monthRangeIso(state.cal.cursor);
        state.cal.cursor = addDaysIso(r.end, 1);
      }
      loadCalendar();
    };
    document.getElementById('cal-add').onclick = function () {
      showMakeupForm({ makeup_date: state.cal.cursor || state.today, kind: '반', status: '예정' });
    };
    loadCalendar();
  }

  function calendarRange() {
    if (state.cal.view === 'week') return weekRangeIso(state.cal.cursor);
    return monthRangeIso(state.cal.cursor);
  }

  function loadCalendar() {
    var range = calendarRange();
    var label = document.getElementById('cal-label');
    if (label) {
      label.textContent = state.cal.view === 'week'
        ? range.start + ' ~ ' + range.end
        : range.year + '년 ' + range.month + '월';
    }
    var weekBtn = document.getElementById('cal-week');
    var monthBtn = document.getElementById('cal-month');
    if (weekBtn) weekBtn.className = 'btn' + (state.cal.view === 'week' ? '' : ' secondary');
    if (monthBtn) monthBtn.className = 'btn' + (state.cal.view === 'month' ? '' : ' secondary');
    api('getCalendar', [range.start, range.end]).then(function (res) {
      paintCalendar(res.events || [], range);
    }).catch(function (e) {
      var body = document.getElementById('cal-body');
      if (body) body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
  }

  function eventsByDate(events) {
    var map = {};
    (events || []).forEach(function (ev) {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }

  function eventButtons(list) {
    return (list || []).map(function (ev) {
      var extra = ev.makeup_id ? ' data-makeup="' + esc(ev.makeup_id) + '"' : '';
      return '<button type="button" class="cal-event ' + calEventClass(ev) + '"' + extra + '>' +
        esc(calEventLabel(ev)) + '</button>';
    }).join('');
  }

  function paintCalendar(events, range) {
    var body = document.getElementById('cal-body');
    if (!body) return;
    var grouped = eventsByDate(events);
    if (state.cal.view === 'week') {
      var days = [];
      var cur = range.start;
      while (cur <= range.end) {
        days.push(cur);
        cur = addDaysIso(cur, 1);
      }
      body.innerHTML = '<div class="cal-week">' + days.map(function (date) {
        var names = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
        var cls = date === state.today ? ' today' : '';
        return '<div class="cal-week-col' + cls + '" data-date="' + esc(date) + '"><h4>' +
          names[d.getDay()] + ' ' + esc(shortDate(date)) + '</h4>' +
          (grouped[date] ? eventButtons(grouped[date]) : '<p class="muted">일정 없음</p>') +
          '</div>';
      }).join('') + '</div>';
    } else {
      var start = range.start;
      var first = new Date(range.year, range.month - 1, 1);
      var startPad = first.getDay() === 0 ? 6 : first.getDay() - 1;
      var cells = [];
      var i;
      for (i = 0; i < startPad; i++) cells.push(addDaysIso(start, -(startPad - i)));
      var curDate = start;
      while (curDate <= range.end) {
        cells.push(curDate);
        curDate = addDaysIso(curDate, 1);
      }
      while (cells.length % 7) cells.push(addDaysIso(cells[cells.length - 1], 1));
      var heads = ['월', '화', '수', '목', '금', '토', '일'];
      body.innerHTML = '<div class="cal-month">' +
        heads.map(function (h) { return '<div class="cal-head">' + h + '</div>'; }).join('') +
        cells.map(function (date) {
          var inMonth = date >= range.start && date <= range.end;
          var cls = (inMonth ? '' : ' out') + (date === state.today ? ' today' : '');
          return '<div class="cal-day' + cls + '" data-date="' + esc(date) + '"><div class="cal-day-num">' +
            Number(date.slice(8, 10)) + '</div>' + eventButtons(grouped[date] || []) + '</div>';
        }).join('') +
        '</div>';
    }
    body.querySelectorAll('[data-date]').forEach(function (cell) {
      cell.onclick = function (e) {
        if (e.target.closest('.cal-event')) return;
        showMakeupForm({ makeup_date: cell.getAttribute('data-date'), kind: '반', status: '예정' });
      };
    });
    body.querySelectorAll('[data-makeup]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-makeup');
        api('getMakeupSession', [id]).then(showMakeupForm).catch(function (err) { toast(err.message, true); });
      };
    });
  }

  function showMakeupForm(row) {
    var box = document.getElementById('makeup-form');
    if (!box) return;
    loadLookups().then(function () {
      row = row || { makeup_date: state.today, kind: '반', status: '예정' };
      box.innerHTML = '<div class="card"><h3>' + (row.makeup_id ? '보강 수정' : '보강 추가') + '</h3><div class="row">' +
        field('종류', select('kind', ['반', '학생'], row.kind || '반')) +
        field('날짜', input('makeup_date', row.makeup_date || state.today, 'date')) +
        field('시작', input('start_time', row.start_time || '18:00', 'time')) +
        field('종료', input('end_time', row.end_time || '20:00', 'time')) +
        field('반', select('class_id', classOptions(row.class_id, true), row.class_id || '')) +
        field('학생', select('student_id', studentOptions(row.student_id), row.student_id || '')) +
        field('제목', input('title', row.title || '')) +
        field('상태', select('status', ['예정', '완료', '취소'], row.status || '예정')) +
        field('메모', '<textarea name="memo">' + esc(row.memo) + '</textarea>') +
        '</div><div class="row"><button class="btn" id="save-makeup">저장</button>' +
        (row.makeup_id ? '<button class="btn danger" id="cancel-makeup">취소 처리</button>' : '') +
        '<button class="btn secondary" id="close-makeup">닫기</button></div></div>';
      document.getElementById('save-makeup').onclick = function () {
        var form = this.closest('.card');
        var data = {
          makeup_id: row.makeup_id,
          kind: form.querySelector('[name=kind]').value,
          makeup_date: form.querySelector('[name=makeup_date]').value,
          start_time: form.querySelector('[name=start_time]').value,
          end_time: form.querySelector('[name=end_time]').value,
          class_id: form.querySelector('[name=class_id]').value,
          student_id: form.querySelector('[name=student_id]').value,
          title: form.querySelector('[name=title]').value,
          status: form.querySelector('[name=status]').value,
          memo: form.querySelector('[name=memo]').value
        };
        api('saveMakeupSession', [data]).then(function () {
          toast('보강 일정을 저장했습니다.');
          box.innerHTML = '';
          loadCalendar();
        }).catch(function (e) { toast(e.message, true); });
      };
      var cancelBtn = document.getElementById('cancel-makeup');
      if (cancelBtn) {
        cancelBtn.onclick = function () {
          if (!confirm('이 보강을 취소할까요?')) return;
          api('cancelMakeupSession', [row.makeup_id]).then(function () {
            toast('보강을 취소했습니다.');
            box.innerHTML = '';
            loadCalendar();
          }).catch(function (e) { toast(e.message, true); });
        };
      }
      document.getElementById('close-makeup').onclick = function () { box.innerHTML = ''; };
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderDashboard(root) {
    var cached = state.cache.dashboard;
    if (cached && cached.date === state.today) {
      paintDashboard(root, cached);
      return;
    }
    spinner(root);
    api('getDashboard', [state.today]).then(function (d) {
      state.cache.dashboard = d;
      persistBoot();
      paintDashboard(root, d);
    }).catch(fail(root));
  }

  function stat(label, n) {
    return '<div class="card stat"><h3>' + esc(label) + '</h3><b>' + esc(n) + '</b></div>';
  }

  function shortDate(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3) return iso || '';
    return Number(parts[1]) + '/' + Number(parts[2]);
  }

  function classNameById(classId) {
    var rows = state.cache.classes || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].class_id === classId) return rows[i].class_name;
    }
    return classId || '-';
  }

  function assignmentLabel(code) {
    var c = String(code || '').charAt(0).toUpperCase();
    if (c !== 'A' && c !== 'B' && c !== 'C') return '-';
    var range = (state.settings && state.settings['assignment_' + c]) || '';
    return range ? c + '(' + range + ')' : c;
  }

  function concentrationLabel(v) {
    if (!v) return '-';
    if (v === 'ABSENT' || v === '결석') return '결석';
    return String(v);
  }

  function formatScoreDisplay(lesson) {
    if (!lesson || lesson.test_status !== '실시') return '미실시';
    if (lesson.test_score == null || lesson.test_score === '' ||
        lesson.test_max_score == null || lesson.test_max_score === '') {
      return '미실시';
    }
    return lesson.test_score + ' / ' + lesson.test_max_score;
  }

  function normalizedScore(lesson) {
    if (!lesson || lesson.test_status !== '실시') return null;
    var s = Number(lesson.test_score);
    var m = Number(lesson.test_max_score);
    if (!isFinite(s) || !isFinite(m) || m <= 0) return null;
    return (s / m) * 100;
  }

  function formatAverage(v) {
    if (v === null || v === undefined || !isFinite(Number(v))) return '-';
    return (Math.round(Number(v) * 10) / 10).toFixed(1);
  }

  function summarizeLessons(rows) {
    var present = 0;
    var absent = 0;
    var scores = [];
    (rows || []).forEach(function (row) {
      if (row.attendance === '결석') absent += 1;
      else present += 1;
      var n = normalizedScore(row);
      if (n !== null) scores.push(n);
    });
    var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : null;
    var median = null;
    if (scores.length) {
      var sorted = scores.slice().sort(function (a, b) { return a - b; });
      var mid = Math.floor(sorted.length / 2);
      median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return {
      total_lessons: (rows || []).length,
      present_count: present,
      absent_count: absent,
      test_count: scores.length,
      test_average_display: formatAverage(avg),
      test_median_display: formatAverage(median),
      test_high_display: scores.length ? formatAverage(Math.max.apply(null, scores)) : '-',
      test_low_display: scores.length ? formatAverage(Math.min.apply(null, scores)) : '-'
    };
  }

  function svgLineChart(points, opts) {
    opts = opts || {};
    if (!points.length) {
      return '<div class="empty">' + esc(opts.empty || '표시할 데이터가 없습니다.') + '</div>';
    }
    var w = Math.max(520, points.length * 72);
    var h = 220;
    var padL = 40;
    var padR = 16;
    var padT = 22;
    var padB = 36;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    function xAt(i) {
      if (points.length === 1) return padL + innerW / 2;
      return padL + (i / (points.length - 1)) * innerW;
    }
    function yAt(v) {
      return padT + (1 - (Number(v) / 100)) * innerH;
    }
    var grid = [0, 25, 50, 75, 100].map(function (tick) {
      var y = yAt(tick);
      return '<line class="chart-grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" />' +
        '<text class="chart-axis" x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + tick + '</text>';
    }).join('');
    var d = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p.y).toFixed(1);
    }).join(' ');
    var dots = points.map(function (p, i) {
      return '<circle class="chart-dot" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p.y).toFixed(1) + '" r="4" />' +
        '<text class="chart-value" x="' + xAt(i).toFixed(1) + '" y="' + (yAt(p.y) - 10).toFixed(1) + '" text-anchor="middle">' +
        esc(p.label) + '</text>' +
        '<text class="chart-axis" x="' + xAt(i).toFixed(1) + '" y="' + (h - 12) + '" text-anchor="middle">' +
        esc(p.xLabel) + '</text>';
    }).join('');
    return '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ' + w + ' ' + h +
      '" role="img" aria-label="' + esc(opts.title || '차트') + '">' +
      grid + '<path class="chart-line" d="' + d + '" fill="none" />' + dots + '</svg></div>';
  }

  function gradeInfo(kind, value) {
    if (kind === 'assignment') {
      if (value === 'A' || value === 'B' || value === 'C') {
        return { rank: value === 'A' ? 3 : value === 'B' ? 2 : 1, max: 3, label: value };
      }
      return null;
    }
    var v = value === '결석' ? 'ABSENT' : value;
    if (v === 'A') return { rank: 4, max: 4, label: 'A' };
    if (v === 'B') return { rank: 3, max: 4, label: 'B' };
    if (v === 'C') return { rank: 2, max: 4, label: 'C' };
    if (v === 'D') return { rank: 1, max: 4, label: 'D' };
    if (v === 'ABSENT') return { rank: 0, max: 4, label: '결석', absent: true };
    return null;
  }

  function svgGradeChart(rows, kind, opts) {
    opts = opts || {};
    var points = [];
    (rows || []).forEach(function (row) {
      var raw = kind === 'assignment' ? row.assignment_completion : row.concentration;
      var g = gradeInfo(kind, raw);
      if (!g) return;
      points.push({ xLabel: shortDate(row.lesson_date), grade: g });
    });
    if (!points.length) {
      return '<div class="empty">' + esc(opts.empty || '표시할 데이터가 없습니다.') + '</div>';
    }
    var w = Math.max(520, points.length * 56);
    var h = 180;
    var padL = 16;
    var padR = 16;
    var padT = 24;
    var padB = 36;
    var innerH = h - padT - padB;
    var slot = (w - padL - padR) / points.length;
    var barW = Math.min(28, slot * 0.5);
    var bars = points.map(function (p, i) {
      var cx = padL + (i + 0.5) * slot;
      var height = p.grade.absent ? 12 : (p.grade.rank / p.grade.max) * innerH;
      var y = padT + innerH - height;
      var cls = p.grade.absent ? 'chart-bar absent' : 'chart-bar grade-' + p.grade.label;
      return '<rect class="' + cls + '" x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + height.toFixed(1) + '" rx="4" />' +
        '<text class="chart-value" x="' + cx.toFixed(1) + '" y="' + (y - 6).toFixed(1) +
        '" text-anchor="middle">' + esc(p.grade.label) + '</text>' +
        '<text class="chart-axis" x="' + cx.toFixed(1) + '" y="' + (h - 12) +
        '" text-anchor="middle">' + esc(p.xLabel) + '</text>';
    }).join('');
    return '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ' + w + ' ' + h +
      '" role="img" aria-label="' + esc(opts.title || '차트') + '">' + bars + '</svg></div>';
  }

  function renderToday(root) {
    spinner(root);
    loadLookups().then(function () {
      var date = state.params.date || state.today;
      var classId = state.params.classId || ((state.cache.classes[0] || {}).class_id || '');
      root.innerHTML =
        '<div class="card"><div class="row">' +
          field('날짜', input('lesson_date', date, 'date')) +
          field('반', select('class_id', classOptions(classId), classId)) +
        '</div></div>' +
        '<div id="today-body"></div>';
      root.querySelector('[name=lesson_date]').onchange = reload;
      root.querySelector('[name=class_id]').onchange = reload;
      function reload() {
        loadSession(root.querySelector('[name=lesson_date]').value, root.querySelector('[name=class_id]').value);
      }
      if (classId) loadSession(date, classId);
      else document.getElementById('today-body').innerHTML = '<div class="card empty">먼저 반을 등록해 주세요.</div>';
    }).catch(fail(root));
  }

  function chipGroup(name, values, current, labels) {
    return '<div class="seg" data-name="' + name + '">' + values.map(function (v, i) {
      var lab = labels ? labels[i] : v;
      return '<button type="button" class="chip' + (String(current) === String(v) ? ' on' : '') + '" data-value="' + esc(v) + '">' + esc(lab) + '</button>';
    }).join('') + '</div>';
  }

  function bindChips(scope) {
    scope.querySelectorAll('.seg').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip');
        if (!btn) return;
        seg.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
        btn.classList.add('on');
        var card = btn.closest('.student-card');
        if (seg.getAttribute('data-name') === 'test_status' && card) {
          card.querySelector('.score-row').style.display = btn.getAttribute('data-value') === '실시' ? '' : 'none';
        }
      });
    });
  }

  function selectedChip(card, name) {
    var on = card.querySelector('.seg[data-name="' + name + '"] .chip.on');
    return on ? on.getAttribute('data-value') : '';
  }

  function loadSession(date, classId) {
    var body = document.getElementById('today-body');
    if (!classId) return;
    spinner(body);
    api('getTodayClassSession', [date, classId]).then(function (session) {
      var cards = session.students.map(function (s) {
        var l = s.lesson || {};
        var tested = (l.test_status || '미실시') === '실시';
        return '<article class="card student-card" data-student="' + esc(s.student_id) + '">' +
          '<div class="toolbar"><h3>' + esc(s.name) + ' <span class="muted">' + esc(s.grade) + '</span></h3>' +
          (l.lesson_id ? '<span class="badge ok">기록됨</span>' : '<span class="badge warn">미기록</span>') + '</div>' +
          '<div class="row">' + field('출석', chipGroup('attendance', ['출석', '결석'], l.attendance || '출석')) +
            field('테스트', chipGroup('test_status', ['미실시', '실시'], l.test_status || '미실시')) + '</div>' +
          '<div class="row score-row" style="' + (tested ? '' : 'display:none') + '">' +
            field('점수', input('test_score', l.test_score, 'number', 'min="0"')) +
            field('만점', input('test_max_score', l.test_max_score || 20, 'number', 'min="1"')) +
            field('난이도', chipGroup('test_difficulty', ['상', '중', '하'], l.test_difficulty || '중')) +
          '</div>' +
          '<div class="row">' +
            field('과제 이행률', chipGroup('assignment_completion', ['A', 'B', 'C'], l.assignment_completion || 'A')) +
            field('집중도', chipGroup('concentration', ['A', 'B', 'C', 'D', 'ABSENT'], l.concentration || 'A', ['A', 'B', 'C', 'D', '결석'])) +
          '</div>' +
          field('학습 진도', '<textarea name="progress">' + esc(l.progress) + '</textarea>') +
          field('과제 안내', '<textarea name="homework">' + esc(l.homework) + '</textarea>') +
          field('특이사항', '<textarea name="special_note">' + esc(l.special_note) + '</textarea>') +
        '</article>';
      }).join('');

      body.innerHTML =
        '<div class="card"><h3 style="margin-top:0">전체 적용</h3><p class="muted">같은 반 공통 내용을 한 번에 넣은 뒤 학생별로 수정하세요.</p>' +
          '<div class="row">' +
            field('학습 진도', '<textarea id="bulk-progress"></textarea>') +
            field('과제 안내', '<textarea id="bulk-homework"></textarea>') +
          '</div>' +
          '<div class="row">' +
            field('난이도', chipGroup('bulk_difficulty', ['상', '중', '하'], '중')) +
            field('과제 이행률', chipGroup('bulk_assign', ['A', 'B', 'C'], 'A')) +
          '</div>' +
          '<button class="btn secondary" id="apply-bulk" type="button">전체 학생에게 적용</button></div>' +
        (cards || '<div class="card empty">이 반에 재원 학생이 없습니다.</div>') +
        '<div class="bottom-bar"><button class="btn" id="save-today" style="width:100%">수업 기록 저장</button></div>' +
        '<div class="save-desktop" style="margin-top:12px"><button class="btn" id="save-today-desktop">수업 기록 저장</button></div>';

      bindChips(body);
      var apply = document.getElementById('apply-bulk');
      if (apply) apply.onclick = function () {
        var p = document.getElementById('bulk-progress').value;
        var h = document.getElementById('bulk-homework').value;
        var diff = selectedChip(body.querySelector('.card'), 'bulk_difficulty') || '중';
        var asg = selectedChip(body.querySelector('.card'), 'bulk_assign') || 'A';
        body.querySelectorAll('.student-card').forEach(function (card) {
          card.querySelector('[name=progress]').value = p;
          card.querySelector('[name=homework]').value = h;
          setChip(card, 'test_difficulty', diff);
          setChip(card, 'assignment_completion', asg);
        });
        toast('공통 내용을 적용했습니다.');
      };
      function save(btn) {
        var items = [];
        body.querySelectorAll('.student-card').forEach(function (card) {
          items.push({
            lesson_date: date,
            class_id: classId,
            student_id: card.getAttribute('data-student'),
            attendance: selectedChip(card, 'attendance') || '출석',
            test_status: selectedChip(card, 'test_status') || '미실시',
            test_score: card.querySelector('[name=test_score]').value,
            test_max_score: card.querySelector('[name=test_max_score]').value,
            test_difficulty: selectedChip(card, 'test_difficulty'),
            assignment_completion: selectedChip(card, 'assignment_completion'),
            concentration: selectedChip(card, 'concentration'),
            progress: card.querySelector('[name=progress]').value,
            homework: card.querySelector('[name=homework]').value,
            special_note: card.querySelector('[name=special_note]').value
          });
        });
        if (!items.length) return toast('저장할 학생이 없습니다.', true);
        withBusy(btn, function () {
          return api('saveLessonsBatch', [items]).then(function () {
            state.cache.dashboard = null;
            persistBoot();
            body.querySelectorAll('.student-card .badge').forEach(function (badge) {
              badge.className = 'badge ok';
              badge.textContent = '기록됨';
            });
            toast('수업 기록을 저장했습니다.');
          });
        }).catch(function (e) { toast(e.message, true); });
      }
      var s1 = document.getElementById('save-today');
      var s2 = document.getElementById('save-today-desktop');
      if (s1) s1.onclick = function () { save(s1); };
      if (s2) s2.onclick = function () { save(s2); };
    }).catch(fail(body));
  }

  function setChip(scope, name, value) {
    var seg = scope.querySelector('.seg[data-name="' + name + '"]');
    if (!seg) return;
    seg.querySelectorAll('.chip').forEach(function (c) {
      c.classList.toggle('on', c.getAttribute('data-value') === value);
    });
  }

  function renderStudents(root) {
    function paint() {
      root.innerHTML =
        '<div class="card"><div class="row">' +
          field('검색', input('q', '', 'search', 'placeholder="이름·학교"')) +
          field('학년', select('grade', [{ value: '', label: '전체 학년' }].concat(state.grades), '')) +
          field('상태', select('status', [{ value: '', label: '전체 상태' }, '재원', '휴원', '퇴원'], '재원')) +
          field('반', select('classId', classOptions('', true), '')) +
          '<button class="btn" id="student-filter">조회</button><button class="btn secondary" id="student-new">학생 등록</button>' +
          '<button class="btn ghost" id="student-promote">학년 진급</button>' +
        '</div></div><div id="student-list"></div><div id="student-form"></div><div id="promote-box"></div>';
      function refresh() {
        var rows = filterStudents(state.cache.students, {
          query: root.querySelector('[name=q]').value,
          grade: root.querySelector('[name=grade]').value,
          status: root.querySelector('[name=status]').value,
          classId: root.querySelector('[name=classId]').value
        });
        document.getElementById('student-list').innerHTML = studentTable(rows);
      }
      document.getElementById('student-filter').onclick = refresh;
      document.getElementById('student-new').onclick = function () { showStudentForm(null); };
      document.getElementById('student-promote').onclick = function () { showGradePromotion(); };
      refresh();
    }
    if (state.cache.students && state.cache.classes) {
      paint();
      return;
    }
    spinner(root);
    loadLookups(true).then(paint).catch(fail(root));
  }

  function studentTable(rows) {
    if (!rows.length) return '<div class="card empty">학생이 없습니다.</div>';
    return '<div class="card"><table><thead><tr><th>이름</th><th>학년</th><th>학교</th><th>현재 반</th><th>상태</th><th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        var cls = (s.current_classes || []).map(function (c) { return c.class_name; }).join(', ') || '-';
        return '<tr><td><a class="link" href="#/students/' + esc(s.student_id) + '">' + esc(s.name) + '</a></td><td>' +
          esc(s.grade) + '</td><td>' + esc(s.school || '-') + '</td><td>' + esc(cls) + '</td><td>' + esc(s.status) +
          '</td><td><button class="btn ghost edit-stu" data-id="' +
          esc(s.student_id) + '">수정</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function showStudentForm(student) {
    var s = student || { status: '재원', enrollment_date: state.today };
    var box = document.getElementById('student-form') || document.getElementById('main');
    var html = '<div class="card"><h3>' + (s.student_id ? '학생 수정' : '학생 등록') + '</h3><div class="row">' +
      field('이름', input('name', s.name)) +
      field('학년', select('grade', state.grades, s.grade || '중2')) +
      field('학교', input('school', s.school, 'text', 'placeholder="학교명"')) +
      field('학생 연락처', input('student_phone', s.student_phone, 'tel', 'placeholder="010-0000-0000"')) +
      field('보호자 연락처', input('parent_phone', s.parent_phone)) +
      field('등록일', input('enrollment_date', s.enrollment_date, 'date')) +
      field('상태', select('status', ['재원', '휴원', '퇴원'], s.status)) +
      field('현재 반', select('class_id', classOptions(s.class_id, true), (s.current_classes && s.current_classes[0] || {}).class_id)) +
      field('메모', '<textarea name="memo">' + esc(s.memo) + '</textarea>') +
      '</div><button class="btn" id="save-stu">저장</button></div>';
    if (document.getElementById('student-form')) document.getElementById('student-form').innerHTML = html;
    else document.getElementById('main').insertAdjacentHTML('afterbegin', html);
    document.getElementById('save-stu').onclick = function () {
      var form = document.getElementById('save-stu').closest('.card');
      var data = {
        student_id: s.student_id,
        name: form.querySelector('[name=name]').value,
        grade: form.querySelector('[name=grade]').value,
        school: form.querySelector('[name=school]').value,
        student_phone: form.querySelector('[name=student_phone]').value,
        parent_phone: form.querySelector('[name=parent_phone]').value,
        enrollment_date: form.querySelector('[name=enrollment_date]').value,
        status: form.querySelector('[name=status]').value,
        memo: form.querySelector('[name=memo]').value,
        class_id: s.student_id ? undefined : form.querySelector('[name=class_id]').value
      };
      var p = s.student_id ? api('updateStudent', [data]) : api('createStudent', [data]);
      p.then(function () {
        toast('저장했습니다.');
        return refreshLookups().then(renderRoute);
      }).catch(function (e) { toast(e.message, true); });
    };
  }

  function showGradePromotion() {
    var box = document.getElementById('promote-box') || document.getElementById('main');
    api('previewGradePromotion', []).then(function (preview) {
      var rows = (preview.items || []).filter(function (item) { return item.count > 0; });
      var skipped = preview.skipped || [];
      var html = '<div class="card"><h3>학년 진급</h3>' +
        '<p class="muted">재원 학생을 한 학년씩 올립니다. 고3·기타는 대상에서 제외합니다.</p>';
      if (!preview.total) {
        html += '<div class="empty">진급할 재원 학생이 없습니다.</div></div>';
        box.innerHTML = html;
        return;
      }
      html += '<table><thead><tr><th>현재</th><th>진급 후</th><th>인원</th><th>학생</th></tr></thead><tbody>' +
        rows.map(function (item) {
          var names = item.students.map(function (s) { return s.name; }).join(', ');
          return '<tr><td>' + esc(item.from_grade) + '</td><td>' + esc(item.to_grade) + '</td><td>' +
            item.count + '</td><td>' + esc(names) + '</td></tr>';
        }).join('') + '</tbody></table>';
      if (skipped.length) {
        html += '<p class="muted" style="margin-top:10px">제외: ' +
          skipped.map(function (s) { return s.name + '(' + s.grade + ')'; }).join(', ') + '</p>';
      }
      html += '<div class="row" style="margin-top:12px"><button class="btn" id="confirm-promote">진급 적용</button>' +
        '<button class="btn secondary" id="close-promote">닫기</button></div></div>';
      box.innerHTML = html;
      document.getElementById('confirm-promote').onclick = function () {
        if (!confirm('재원 학생 ' + preview.total + '명의 학년을 진급할까요?')) return;
        api('promoteGrades', []).then(function (res) {
          toast((res.updated_count || 0) + '명 진급했습니다.');
          return refreshLookups().then(renderRoute);
        }).catch(function (e) { toast(e.message, true); });
      };
      document.getElementById('close-promote').onclick = function () { box.innerHTML = ''; };
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderStudentDetail(root, id) {
    spinner(root);
    Promise.all([api('getStudent', [id]), loadLookups()]).then(function (pair) {
      var s = pair[0];
      var current = (s.current_classes || []).map(function (c) { return c.class_name; }).join(', ') || '-';
      root.innerHTML =
        '<div class="card"><div class="toolbar"><h2 style="margin:0">' + esc(s.name) + '</h2><button class="btn secondary" id="edit-one">수정</button></div>' +
        '<p>' + esc(s.grade) + ' · ' + esc(s.school || '학교 미입력') + ' · ' + esc(s.status) + '</p>' +
        '<p>학생 연락처 ' + esc(s.student_phone || '-') + ' · 보호자 ' + esc(s.parent_phone || '-') + '</p>' +
        '<p>현재 반: <b>' + esc(current) + '</b></p>' +
        '<div class="row">' + field('반 변경', select('move_class', classOptions('', false), '')) +
          field('시작일', input('move_date', state.today, 'date')) +
          '<button class="btn" id="move-stu">반 변경</button></div>' +
        '<h3>반 이동 이력</h3>' + historyTable(s.class_history) +
        '</div>' +
        '<div class="card"><div class="toolbar"><h3 style="margin:0">수업 기록</h3></div><div class="row">' +
          field('기간', select('period', [{ value: 'week', label: '이번 주' }, { value: 'month', label: '이번 달' }, { value: '3m', label: '최근 3개월' }, { value: 'custom', label: '직접 선택' }], 'month')) +
          field('시작', input('start', '', 'date')) + field('끝', input('end', '', 'date')) +
          '<button class="btn secondary" id="load-lessons">조회</button></div></div>' +
        '<div id="lesson-hist"></div>' +
        '<div class="split" style="margin-top:14px">' +
          '<div class="card" id="note-student"></div>' +
          '<div class="card" id="note-parent"></div>' +
        '</div>';
      document.getElementById('edit-one').onclick = function () { showStudentForm(s); };
      document.getElementById('move-stu').onclick = function () {
        api('moveStudent', [{ student_id: s.student_id, class_id: root.querySelector('[name=move_class]').value, start_date: root.querySelector('[name=move_date]').value }])
          .then(function () {
            toast('반을 변경했습니다.');
            return refreshLookups().then(renderRoute);
          })
          .catch(function (e) { toast(e.message, true); });
      };
      document.getElementById('load-lessons').onclick = function () { loadHist(); };
      loadHist();
      loadCounseling(s.student_id);
      function loadHist() {
        var range = lessonRange(root);
        api('getStudentLessons', [s.student_id, range.start, range.end]).then(function (rows) {
          var ordered = (rows || []).slice().sort(function (a, b) {
            return String(a.lesson_date || '').localeCompare(String(b.lesson_date || ''));
          });
          document.getElementById('lesson-hist').innerHTML = studentLessonHistory(ordered);
        }).catch(function (e) { toast(e.message, true); });
      }
    }).catch(fail(root));
  }

  function studentLessonHistory(rows) {
    if (!rows.length) return '<div class="card empty">수업 기록이 없습니다.</div>';
    var stats = summarizeLessons(rows);
    var tests = rows.map(function (l) {
      var y = normalizedScore(l);
      if (y === null) return null;
      return { xLabel: shortDate(l.lesson_date), y: y, label: formatAverage(y) };
    }).filter(Boolean);
    return '<div class="grid stats">' +
      stat('수업', stats.total_lessons) +
      stat('출석', stats.present_count) +
      stat('결석', stats.absent_count) +
      stat('테스트 평균', stats.test_average_display) +
    '</div>' +
    '<div class="grid chart-grid">' +
      '<div class="card"><h3 style="margin-top:0">테스트 점수 추이</h3>' +
        '<p class="muted">100점 환산 · 실시한 날만 표시합니다.</p>' +
        svgLineChart(tests, { title: '테스트 점수 추이', empty: '실시된 테스트가 없습니다.' }) +
        (stats.test_count
          ? '<p class="muted">실시 ' + stats.test_count + '회 · 중간값 ' + stats.test_median_display +
            ' · 최고 ' + stats.test_high_display + ' · 최저 ' + stats.test_low_display + '</p>'
          : '') +
      '</div>' +
      '<div class="card"><h3 style="margin-top:0">과제 이행률 · 집중도</h3>' +
        '<p class="muted">과제 이행률</p>' +
        svgGradeChart(rows, 'assignment', { title: '과제 이행률', empty: '과제 이행률 기록이 없습니다.' }) +
        '<p class="muted">집중도</p>' +
        svgGradeChart(rows, 'concentration', { title: '집중도', empty: '집중도 기록이 없습니다.' }) +
      '</div>' +
    '</div>' +
    '<div class="card"><h3 style="margin-top:0">수업 기록 (시간 순)</h3>' + lessonTable(rows) + '</div>';
  }

  function loadCounseling(studentId) {
    api('getCounselingNotes', [studentId]).then(function (rows) {
      paintCounseling('학생', studentId, (rows || []).filter(function (n) { return n.kind === '학생'; }));
      paintCounseling('학부모', studentId, (rows || []).filter(function (n) { return n.kind === '학부모'; }));
    }).catch(function (e) { toast(e.message, true); });
  }

  function paintCounseling(kind, studentId, rows) {
    var id = kind === '학생' ? 'note-student' : 'note-parent';
    var box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = '<div class="toolbar"><h3 style="margin:0">' + (kind === '학생' ? '학생 상담일지' : '학부모 상담일지') +
      '</h3><button class="btn secondary add-note" data-kind="' + kind + '">작성</button></div>' +
      (rows.length ? '<div class="note-list">' + rows.map(function (n) {
        return '<div class="note-item"><h4>' + esc(n.title || '상담') + '</h4>' +
          '<p class="muted">' + esc(n.counsel_date) + '</p>' +
          '<p class="curriculum">' + esc(n.content) + '</p>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="btn ghost edit-note" data-id="' + esc(n.note_id) + '">수정</button>' +
          '<button class="btn danger del-note" data-id="' + esc(n.note_id) + '">삭제</button></div></div>';
      }).join('') + '</div>' : '<p class="muted">작성된 상담일지가 없습니다.</p>') +
      '<div class="note-form"></div>';
    box.querySelector('.add-note').onclick = function () {
      showCounselForm(box, { student_id: studentId, kind: kind, counsel_date: state.today });
    };
    box.querySelectorAll('.edit-note').forEach(function (btn) {
      btn.onclick = function () {
        var note = rows.filter(function (n) { return n.note_id === btn.getAttribute('data-id'); })[0];
        if (note) showCounselForm(box, note);
      };
    });
    box.querySelectorAll('.del-note').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('이 상담일지를 삭제할까요?')) return;
        api('deleteCounselingNote', [btn.getAttribute('data-id')]).then(function () {
          toast('삭제했습니다.');
          loadCounseling(studentId);
        }).catch(function (e) { toast(e.message, true); });
      };
    });
  }

  function showCounselForm(box, note) {
    var host = box.querySelector('.note-form');
    if (!host) return;
    host.innerHTML = '<div class="row" style="margin-top:12px">' +
      field('상담일', input('counsel_date', note.counsel_date || state.today, 'date')) +
      field('제목', input('title', note.title || '')) +
      field('내용', '<textarea name="content">' + esc(note.content) + '</textarea>') +
      '</div><div class="row"><button class="btn save-note">저장</button>' +
      '<button class="btn secondary close-note">닫기</button></div>';
    host.querySelector('.save-note').onclick = function () {
      api('saveCounselingNote', [{
        note_id: note.note_id,
        student_id: note.student_id,
        kind: note.kind,
        counsel_date: host.querySelector('[name=counsel_date]').value,
        title: host.querySelector('[name=title]').value,
        content: host.querySelector('[name=content]').value
      }]).then(function () {
        toast('상담일지를 저장했습니다.');
        loadCounseling(note.student_id);
      }).catch(function (e) { toast(e.message, true); });
    };
    host.querySelector('.close-note').onclick = function () { host.innerHTML = ''; };
  }

  function lessonRange(root) {
    var p = root.querySelector('[name=period]').value;
    var today = state.today;
    if (p === 'custom') return { start: root.querySelector('[name=start]').value, end: root.querySelector('[name=end]').value };
    var d = today.split('-');
    var date = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]));
    function iso(x) {
      var mm = String(x.getMonth() + 1); var dd = String(x.getDate());
      if (mm.length < 2) mm = '0' + mm; if (dd.length < 2) dd = '0' + dd;
      return x.getFullYear() + '-' + mm + '-' + dd;
    }
    if (p === 'week') { var a = new Date(date); a.setDate(a.getDate() - 6); return { start: iso(a), end: today }; }
    if (p === '3m') { var b = new Date(date); b.setMonth(b.getMonth() - 3); return { start: iso(b), end: today }; }
    return { start: d[0] + '-' + d[1] + '-01', end: today };
  }

  function historyTable(rows) {
    if (!rows || !rows.length) return '<p class="muted">반 이력이 없습니다.</p>';
    return '<table><thead><tr><th>반</th><th>시작</th><th>종료</th><th>상태</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.class_name) + '</td><td>' + esc(r.start_date) + '</td><td>' + esc(r.end_date || '-') + '</td><td>' + esc(r.status) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function lessonTable(rows) {
    if (!rows.length) return '<div class="empty">수업 기록이 없습니다.</div>';
    return '<div class="table-scroll"><table><thead><tr>' +
      '<th>날짜</th><th>반</th><th>출석</th><th>테스트</th><th>난이도</th><th>과제 이행률</th><th>집중도</th><th>진도</th><th>과제 안내</th><th>특이사항</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (l) {
        var diff = l.test_status === '실시' ? (l.test_difficulty || '-') : '-';
        return '<tr><td>' + esc(l.lesson_date) + '</td><td>' + esc(classNameById(l.class_id)) +
          '</td><td>' + esc(l.attendance || '-') + '</td><td>' + esc(formatScoreDisplay(l)) +
          '</td><td>' + esc(diff) + '</td><td>' + esc(assignmentLabel(l.assignment_completion)) +
          '</td><td>' + esc(concentrationLabel(l.concentration)) +
          '</td><td class="cell-pre">' + esc(l.progress) + '</td><td class="cell-pre">' + esc(l.homework) +
          '</td><td class="cell-pre">' + esc(l.special_note) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderClasses(root) {
    function paint(rows) {
      state.cache.classes = rows;
      root.innerHTML = '<div class="card toolbar"><h3 style="margin:0">반 목록</h3><button class="btn" id="new-class">반 등록</button></div>' +
        classTable(rows) + '<div id="class-form"></div>';
      document.getElementById('new-class').onclick = function () { showClassForm(null); };
    }
    if (state.cache.classes) {
      paint(state.cache.classes);
      return;
    }
    spinner(root);
    api('getClasses', [{}]).then(paint).catch(fail(root));
  }

  function classTable(rows) {
    if (!rows.length) return '<div class="card empty">반이 없습니다.</div>';
    return '<div class="card"><table><thead><tr><th>반</th><th>학년도/학기</th><th>학년</th><th>요일</th><th>시간</th><th>교재</th><th>담당</th><th>상태</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr><td><a class="link" href="#/classes/' + esc(c.class_id) + '">' + esc(c.class_name) + '</a></td><td>' +
          esc(c.school_year) + ' / ' + esc(c.semester) + '</td><td>' + esc(c.grade) + '</td><td>' + esc(c.weekday) +
          '</td><td>' + esc(c.start_time) + (c.end_time ? '–' + esc(c.end_time) : '') + '</td><td>' +
          esc(c.textbook || '-') + '</td><td>' + esc(c.teacher) +
          '</td><td>' + esc(c.status) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function showClassForm(c) {
    c = c || { status: '운영', school_year: '2026', semester: '2', weekday: '월/수', start_time: '18:00', end_time: '20:00' };
    document.getElementById('class-form').innerHTML = '<div class="card"><h3>' + (c.class_id ? '반 수정' : '반 등록') + '</h3><div class="row">' +
      field('반 이름', input('class_name', c.class_name)) +
      field('학년도', input('school_year', c.school_year)) +
      field('학기', select('semester', ['1', '2'], c.semester || '2')) +
      field('학년', select('grade', state.grades, c.grade || '중2')) +
      field('담당 강사', input('teacher', c.teacher || state.settings.teacher_name)) +
      field('요일', input('weekday', c.weekday, 'text', 'placeholder="월/수"')) +
      field('시작', input('start_time', c.start_time, 'time')) +
      field('종료', input('end_time', c.end_time, 'time')) +
      field('교재', input('textbook', c.textbook, 'text', 'placeholder="현재 교재"')) +
      field('진도', '<textarea name="current_progress" placeholder="현재 진도">' + esc(c.current_progress) + '</textarea>') +
      field('숙제', '<textarea name="class_homework" placeholder="반 공통 숙제">' + esc(c.class_homework) + '</textarea>') +
      field('상태', select('status', ['운영', '종료'], c.status)) +
      field('메모', '<textarea name="memo">' + esc(c.memo) + '</textarea>') +
      '</div><button class="btn" id="save-class">저장</button></div>';
    document.getElementById('save-class').onclick = function () {
      var form = this.closest('.card');
      var data = {
        class_id: c.class_id,
        class_name: form.querySelector('[name=class_name]').value,
        school_year: form.querySelector('[name=school_year]').value,
        semester: form.querySelector('[name=semester]').value,
        grade: form.querySelector('[name=grade]').value,
        teacher: form.querySelector('[name=teacher]').value,
        weekday: form.querySelector('[name=weekday]').value,
        start_time: form.querySelector('[name=start_time]').value,
        end_time: form.querySelector('[name=end_time]').value,
        textbook: form.querySelector('[name=textbook]').value,
        current_progress: form.querySelector('[name=current_progress]').value,
        class_homework: form.querySelector('[name=class_homework]').value,
        status: form.querySelector('[name=status]').value,
        memo: form.querySelector('[name=memo]').value
      };
      var p = c.class_id ? api('updateClass', [data]) : api('createClass', [data]);
      p.then(function () {
        toast('저장했습니다.');
        return refreshLookups().then(renderRoute);
      }).catch(function (e) { toast(e.message, true); });
    };
  }

  function renderClassDetail(root, id) {
    spinner(root);
    api('getClass', [id]).then(function (c) {
      root.innerHTML = '<div class="card"><div class="toolbar"><h2 style="margin:0">' + esc(c.class_name) + '</h2>' +
        '<div><button class="btn secondary" id="edit-class">수정</button> <button class="btn danger" id="close-class">반 종료</button></div></div>' +
        '<p>' + esc(c.grade) + ' · ' + esc(c.weekday) + ' · ' + esc(c.start_time) + '–' + esc(c.end_time) + ' · ' + esc(c.teacher) + '</p>' +
        '<div class="grid stats-2">' +
          '<div><h3>현재 교재</h3><p class="curriculum">' + esc(c.textbook || '-') + '</p></div>' +
          '<div><h3>현재 진도</h3><p class="curriculum">' + esc(c.current_progress || '-') + '</p></div>' +
        '</div>' +
        '<h3>반 숙제</h3><p class="curriculum">' + esc(c.class_homework || '-') + '</p>' +
        '<h3>현재 학생</h3>' + studentTable((c.students || []).map(function (s) { return Object.assign({ current_classes: [{ class_name: c.class_name }] }, s); })) +
        '<div class="row" style="margin-top:12px">' + field('학생 배정', '<select id="assign-stu"></select>') +
        field('시작일', input('assign_date', state.today, 'date')) +
        '<button class="btn" id="assign-btn">배정</button></div></div><div id="class-form"></div>';
      var inClass = {};
      (c.students || []).forEach(function (s) { inClass[s.student_id] = true; });
      var others = (state.cache.students || []).filter(function (s) {
        return s.status === '재원' && !inClass[s.student_id];
      });
      document.getElementById('assign-stu').innerHTML = '<option value="">학생 선택</option>' + others.map(function (s) {
        return '<option value="' + esc(s.student_id) + '">' + esc(s.name) + '</option>';
      }).join('');
      document.getElementById('assign-btn').onclick = function () {
        var sid = document.getElementById('assign-stu').value;
        if (!sid) return toast('학생을 선택해 주세요.', true);
        api('assignStudentToClass', [{ student_id: sid, class_id: id, start_date: root.querySelector('[name=assign_date]').value }])
          .then(function () {
            toast('배정했습니다.');
            return refreshLookups().then(renderRoute);
          })
          .catch(function (e) { toast(e.message, true); });
      };
      document.getElementById('edit-class').onclick = function () { showClassForm(c); };
      document.getElementById('close-class').onclick = function () {
        if (!confirm('이 반을 종료할까요? 과거 수업 기록은 유지됩니다.')) return;
        api('closeClass', [id]).then(function () {
          toast('반을 종료했습니다.');
          return refreshLookups().then(function () { go('classes'); });
        }).catch(function (e) { toast(e.message, true); });
      };
    }).catch(fail(root));
  }

  function renderDaily(root) {
    spinner(root);
    loadLookups().then(function () {
      var classId = (state.cache.classes[0] || {}).class_id || '';
      root.innerHTML = '<div class="card"><div class="row">' +
        field('날짜', input('date', state.today, 'date')) +
        field('반', select('class_id', classOptions(classId), classId)) +
        '<button class="btn" id="load-daily">보고서 생성</button></div></div>' +
        '<div id="daily-list"></div>';
      document.getElementById('load-daily').onclick = function () {
        var date = root.querySelector('[name=date]').value;
        var cid = root.querySelector('[name=class_id]').value;
        api('generateDailyReports', [date, cid]).then(function (res) {
          var rows = (res && res.reports) || [];
          var avg = res && res.class_test_average;
          if (!rows.length) {
            document.getElementById('daily-list').innerHTML = '<div class="card empty">해당 날짜의 수업 기록이 없습니다. 오늘의 수업에서 먼저 저장하세요.</div>';
            return;
          }
          var summary = avg && avg.test_count
            ? '<div class="card"><div class="grid stats stats-4">' +
              stat('실시 테스트', avg.test_count) +
              stat('반 평균', avg.test_average_display) +
              stat('중간값', avg.test_median_display) +
              stat('최고/최저', avg.test_high_display + ' / ' + avg.test_low_display) +
              '</div><p class="muted" style="margin:10px 0 0">실시한 테스트만 100점 환산합니다. 실시한 학생 보고서에 반 통계 한 줄이 포함됩니다.</p></div>'
            : '<div class="card"><p class="muted" style="margin:0">이날 실시된 테스트가 없어 반 통계는 표시하지 않습니다.</p></div>';
          document.getElementById('daily-list').innerHTML = summary + rows.map(function (r, i) {
            return '<div class="card report-card"><div class="toolbar"><h3 style="margin:0">' + esc(r.student_name) + '</h3>' +
              '<div><button class="btn secondary copy-btn" data-i="' + i + '">복사</button> <button class="btn ghost sel-btn" data-i="' + i + '">전체 선택</button></div></div>' +
              '<textarea class="preview" id="rep-' + i + '">' + esc(r.text) + '</textarea></div>';
          }).join('');
          document.querySelectorAll('.copy-btn').forEach(function (btn) {
            btn.onclick = function () { copyText(document.getElementById('rep-' + btn.getAttribute('data-i'))); };
          });
          document.querySelectorAll('.sel-btn').forEach(function (btn) {
            btn.onclick = function () {
              var ta = document.getElementById('rep-' + btn.getAttribute('data-i'));
              ta.focus(); ta.select();
              toast('텍스트를 선택했습니다. 복사하세요.');
            };
          });
        }).catch(function (e) { toast(e.message, true); });
      };
    }).catch(fail(root));
  }

  function copyText(ta) {
    var text = ta.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('복사했습니다.'); }).catch(fallback);
    } else fallback();
    function fallback() {
      ta.focus(); ta.select();
      try { document.execCommand('copy'); toast('복사했습니다.'); }
      catch (e) { toast('복사에 실패했습니다. 전체 선택 후 복사하세요.', true); }
    }
  }

  function renderMonthly(root) {
    spinner(root);
    loadLookups().then(function () {
      var now = state.today.split('-');
      root.innerHTML = '<div class="card"><div class="row">' +
        field('학생', select('student_id', studentOptions(''), '')) +
        field('연도', input('year', now[0], 'number')) +
        field('월', input('month', String(Number(now[1])), 'number', 'min="1" max="12"')) +
        '<button class="btn" id="gen-m">통계·보고서 생성</button></div></div><div id="monthly-body"></div>';
      document.getElementById('gen-m').onclick = function () {
        var sid = root.querySelector('[name=student_id]').value;
        var y = root.querySelector('[name=year]').value;
        var m = root.querySelector('[name=month]').value;
        if (!sid) return toast('학생을 선택해 주세요.', true);
        api('generateMonthlyReport', [sid, Number(y), Number(m)]).then(function (res) {
          var s = res.stats;
          document.getElementById('monthly-body').innerHTML =
            '<div class="grid stats">' +
              stat('수업', s.total_lessons) + stat('출석', s.present_count) +
              stat('결석', s.absent_count) + stat('테스트 평균', s.test_average_display) +
              stat('중간값', s.test_median_display) +
              stat('최고', s.test_high_display) +
              stat('최저', s.test_low_display) +
            '</div>' +
            '<div class="card" style="margin-top:14px"><p>과제 A ' + s.assignment_A + ' · B ' + s.assignment_B + ' · C ' + s.assignment_C +
            ' / 집중도 A ' + s.concentration_A + ' B ' + s.concentration_B + ' C ' + s.concentration_C + ' D ' + s.concentration_D + '</p>' +
            '<p>진도: ' + esc(s.progress_summary || '-') + '</p>' +
            '<textarea id="monthly-text" class="preview">' + esc(res.text) + '</textarea>' +
            '<div class="row" style="margin-top:10px"><button class="btn secondary" id="copy-m">복사</button>' +
            '<button class="btn" id="save-draft">임시 저장</button><button class="btn ok" id="save-final">확정</button></div></div>';
          document.getElementById('copy-m').onclick = function () { copyText(document.getElementById('monthly-text')); };
          function save(status) {
            api('saveMonthlyReport', [{ student_id: sid, year: Number(y), month: Number(m), report_text: document.getElementById('monthly-text').value, status: status }])
              .then(function () { toast(status === '확정' ? '확정했습니다.' : '임시 저장했습니다.'); })
              .catch(function (e) { toast(e.message, true); });
          }
          document.getElementById('save-draft').onclick = function () { save('임시'); };
          document.getElementById('save-final').onclick = function () { save('확정'); };
        }).catch(function (e) { toast(e.message, true); });
      };
    }).catch(fail(root));
  }

  function renderStats(root) {
    spinner(root);
    loadLookups().then(function () {
      var now = state.today.split('-');
      root.innerHTML = '<div class="card"><div class="row">' +
        field('보기', select('mode', [{ value: 'student', label: '학생별' }, { value: 'class', label: '반별' }], 'student')) +
        field('학생', select('student_id', studentOptions(''), '')) +
        field('반', select('class_id', classOptions('', false), (state.cache.classes[0] || {}).class_id || '')) +
        field('연도', input('year', now[0], 'number')) +
        field('월', input('month', String(Number(now[1])), 'number')) +
        '<button class="btn" id="run-stats">조회</button></div></div><div id="stats-body"></div>';
      document.getElementById('run-stats').onclick = run;
      function run() {
        var mode = root.querySelector('[name=mode]').value;
        var y = Number(root.querySelector('[name=year]').value);
        var m = Number(root.querySelector('[name=month]').value);
        if (mode === 'class') {
          var cid = root.querySelector('[name=class_id]').value;
          if (!cid) return toast('반을 선택해 주세요.', true);
          api('getClassStats', [cid, y, m]).then(function (res) {
            document.getElementById('stats-body').innerHTML = '<div class="card"><p>반 평균 ' + esc(res.test_average_display) +
              '점 · 출석 ' + res.present_count + ' · 결석 ' + res.absent_count + '</p>' +
              '<table><thead><tr><th>학생</th><th>수업</th><th>출석</th><th>결석</th><th>평균</th><th>과제A/B/C</th></tr></thead><tbody>' +
              res.students.map(function (s) {
                return '<tr><td>' + esc(s.name) + '</td><td>' + s.stats.total_lessons + '</td><td>' + s.stats.present_count +
                  '</td><td>' + s.stats.absent_count + '</td><td>' + esc(s.stats.test_average_display) + '</td><td>' +
                  s.stats.assignment_A + '/' + s.stats.assignment_B + '/' + s.stats.assignment_C + '</td></tr>';
              }).join('') + '</tbody></table></div>';
          }).catch(function (e) { toast(e.message, true); });
        } else {
          var sid = root.querySelector('[name=student_id]').value;
          if (!sid) return toast('학생을 선택해 주세요.', true);
          api('getMonthlyStats', [sid, y, m]).then(function (s) {
            document.getElementById('stats-body').innerHTML = '<div class="grid stats">' +
              stat('수업', s.total_lessons) + stat('출석', s.present_count) + stat('결석', s.absent_count) +
              stat('평균', s.test_average_display) +
              stat('중간값', s.test_median_display) +
              '</div>' +
              '<div class="card" style="margin-top:14px"><p>최고 ' + esc(s.test_high_display) + ' / 최저 ' + esc(s.test_low_display) +
              '</p><p>진도 ' + esc(s.progress_summary || '-') + '</p></div>';
          }).catch(function (e) { toast(e.message, true); });
        }
      }
    }).catch(fail(root));
  }

  function renderSettings(root) {
    var s = state.settings || {};
    var keys = [
      ['academy_name', '학원명'],
      ['teacher_name', '담당 강사명'],
      ['contact', '연락처'],
      ['report_greeting', '보고서 인사말'],
      ['report_closing', '보고서 맺음말'],
      ['assignment_A', '과제 A 기준'],
      ['assignment_B', '과제 B 기준'],
      ['assignment_C', '과제 C 기준'],
      ['allowed_emails', '허용 이메일(쉼표 구분)']
    ];
    root.innerHTML = '<div class="card">' + keys.map(function (k) {
      var area = k[0] === 'report_closing' || k[0] === 'allowed_emails';
      return field(k[1], area ? '<textarea name="' + k[0] + '">' + esc(s[k[0]]) + '</textarea>' : input(k[0], s[k[0]]));
    }).join('') + '<button class="btn" id="save-set">설정 저장</button></div>';
    document.getElementById('save-set').onclick = function () {
      var map = {};
      keys.forEach(function (k) { map[k[0]] = root.querySelector('[name="' + k[0] + '"]').value; });
      api('saveSettings', [map]).then(function (next) {
        state.settings = next;
        persistBoot();
        toast('설정을 저장했습니다.');
        renderNav();
      }).catch(function (e) { toast(e.message, true); });
    };
  }

  function fail(root) {
    return function (e) {
      root.innerHTML = '<div class="card empty">' + esc(e.message || e) + '</div>';
      toast(e.message || String(e), true);
    };
  }

  function renderRoute() {
    var parsed = parseHash();
    state.route = parsed.route;
    state.params = parsed.params;
    renderNav();
    var root = document.getElementById('main');
    document.getElementById('sidebar').classList.remove('open');
    if (parsed.route === 'students' && parsed.params.id) return renderStudentDetail(root, parsed.params.id);
    if (parsed.route === 'classes' && parsed.params.id) return renderClassDetail(root, parsed.params.id);
    var map = {
      dashboard: renderDashboard,
      today: renderToday,
      students: renderStudents,
      classes: renderClasses,
      daily: renderDaily,
      monthly: renderMonthly,
      stats: renderStats,
      settings: renderSettings
    };
    (map[parsed.route] || renderDashboard)(root);
  }

  document.getElementById('menu-btn').onclick = function () {
    document.getElementById('sidebar').classList.toggle('open');
  };
  document.getElementById('nav').addEventListener('click', function (e) {
    var a = e.target.closest('#logout-link');
    if (!a) return;
    e.preventDefault();
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).finally(function () {
      location.href = '/login';
    });
  });

  document.getElementById('main').addEventListener('click', function (e) {
    var btn = e.target.closest('.edit-stu');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var cached = (state.cache.students || []).filter(function (s) { return s.student_id === id; })[0];
    if (cached) {
      showStudentForm(cached);
      return;
    }
    api('getStudent', [id]).then(showStudentForm).catch(function (err) { toast(err.message, true); });
  });

  if (window.__LMS_BOOT__) {
    applyBoot(window.__LMS_BOOT__);
    persistBoot();
    renderNav();
    renderRoute();
  } else {
    var localBoot = readLocalBoot();
    if (localBoot && localBoot.today) {
      applyBoot(localBoot);
      renderNav();
      renderRoute();
    }
    api('getBootstrap', []).then(function (boot) {
      applyBoot(boot);
      persistBoot();
      renderNav();
      renderRoute();
    }).catch(function (e) {
      if (!state.bootReady) {
        document.getElementById('main').innerHTML = '<div class="card empty">' + esc(e.message) + '</div>';
      } else {
        toast(e.message || String(e), true);
      }
    });
  }

  window.addEventListener('hashchange', renderRoute);
})();