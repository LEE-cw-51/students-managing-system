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
  var dashboardLoadSeq = 0;

  var MENUS = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'today', label: '오늘의 수업' },
    { id: 'students', label: '학생관리' },
    { id: 'classes', label: '반관리' },
    { id: 'plans', label: '강의계획' },
    { id: 'counseling', label: '상담' },
    { id: 'daily', label: '일일보고서' },
    { id: 'monthly', label: '월간보고서' },
    { id: 'stats', label: '통계' },
    { id: 'settings', label: '설정' }
  ];

  var MENU_GROUPS = [
    { label: '오늘', items: ['dashboard', 'today'] },
    { label: '관리', items: ['students', 'classes', 'plans', 'counseling'] },
    { label: '보고서', items: ['daily', 'monthly', 'stats'] },
    { label: '설정', items: ['settings'] }
  ];

  var PLAN_PERIODS = ['일간', '주간', '월간'];

  var TASK_KIND_LABELS = {
    counsel_parent: '학부모 상담',
    counsel_student: '학생 상담',
    homework_check: '과제 확인',
    admin: '행정',
    other: '기타',
    incomplete_class: '수업 기록',
    makeup: '보강',
    learning_alert: '학습 점검'
  };

  var AGENDA_ACTION_LABELS = {
    open_today_session: '수업 열기',
    open_makeup: '보강 열기',
    open_student: '학생 보기',
    check_homework: '과제 확인',
    edit_task: '수정'
  };

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

  var fieldSeq = 0;

  function field(label, inner, opts) {
    opts = opts || {};
    fieldSeq += 1;
    var id = 'fld-' + fieldSeq;
    var labelId = id + '-label';
    var control = inner.match(/<(input|select|textarea)\b[^>]*>/);
    var tagged = inner;
    var linked = false;
    if (control) {
      var existingId = control[0].match(/\sid=(['"])([^'"]+)\1/);
      if (existingId) {
        id = existingId[2];
      } else {
        tagged = inner.replace(/<(input|select|textarea)\b/, '<$1 id="' + id + '"');
      }
      linked = true;
    }
    if (!linked) {
      tagged = inner.replace(/<(div|ul)\b/, '<$1 aria-labelledby="' + labelId + '"');
    }
    return '<div class="field' + (opts.wide ? ' field-wide' : '') + '"><label id="' + labelId + '"' +
      (linked ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' + tagged + '</div>';
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
    var route = parts[0] || 'dashboard';
    var params = { id: parts[1] || '' };
    if (route === 'today' || route === 'daily') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '')) {
        params.date = parts[1];
        params.classId = parts[2] || '';
      } else if (parts[1]) {
        params.classId = parts[1];
      }
    }
    if (route === 'plans') {
      params.classId = parts[1] || '';
      if (PLAN_PERIODS.indexOf(decodeURIComponent(parts[2] || '')) !== -1) {
        params.periodType = decodeURIComponent(parts[2]);
        params.periodKey = decodeURIComponent(parts[3] || '');
      }
    }
    return { route: route, params: params };
  }

  function goToPlans(classId, periodType, periodKey) {
    var path = 'plans';
    if (classId) path += '/' + classId;
    if (classId && periodType) path += '/' + encodeURIComponent(periodType);
    if (classId && periodType && periodKey) path += '/' + encodeURIComponent(periodKey);
    go(path);
  }

  function addDaysLocal(isoDate, delta) {
    var parts = String(isoDate || '').split('-');
    if (parts.length !== 3) return isoDate;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + Number(delta || 0));
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function weekStartLocal(isoDate) {
    var parts = String(isoDate || '').split('-');
    if (parts.length !== 3) return isoDate;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var day = d.getDay();
    var mondayOffset = day === 0 ? -6 : 1 - day;
    return addDaysLocal(isoDate, mondayOffset);
  }

  function shiftMonthLocal(yearMonth, delta) {
    var parts = String(yearMonth || '').split('-');
    if (parts.length < 2) return yearMonth;
    var y = Number(parts[0]);
    var m = Number(parts[1]) - 1 + Number(delta || 0);
    var d = new Date(y, m, 1);
    var mm = String(d.getMonth() + 1);
    if (mm.length < 2) mm = '0' + mm;
    return d.getFullYear() + '-' + mm;
  }

  function planAnchorForType(periodType, today) {
    if (periodType === '월간') return String(today || '').slice(0, 7);
    return today;
  }

  function go(path) {
    location.hash = '#/' + path.replace(/^#\/?/, '');
  }

  function goToToday(date, classId) {
    var path = 'today';
    if (date) path += '/' + date;
    if (classId) path += '/' + classId;
    go(path);
  }

  function goToDaily(date, classId) {
    var path = 'daily';
    if (date) path += '/' + date;
    if (classId) path += '/' + classId;
    go(path);
  }

  /** Prefer incomplete today class, else first today meeting class — not cache.classes[0]. */
  function pickClassFromDashboard(d) {
    if (!d) return '';
    var tasks = d.teaching_tasks || {};
    var regular = tasks.regular_classes || [];
    var incomplete = regular.filter(function (c) {
      return c.student_count > 0 && !c.complete;
    });
    if (incomplete.length) return incomplete[0].class_id || '';
    if (regular.length) return regular[0].class_id || '';
    var todayClasses = d.classes || [];
    if (todayClasses.length) return todayClasses[0].class_id || '';
    return '';
  }

  function loadDashboardForDate(date) {
    var cached = state.cache.dashboard;
    if (cached && cached.date === date) return Promise.resolve(cached);
    return api('getDashboard', [date]).then(function (d) {
      if (date === state.today) {
        state.cache.dashboard = d;
        persistBoot();
      }
      return d;
    });
  }

  function resolveTodayClassId(date, preferredClassId) {
    if (preferredClassId) return Promise.resolve(preferredClassId);
    return loadDashboardForDate(date).then(pickClassFromDashboard);
  }

  function makeupStripHtml(tasks, date) {
    var makeups = ((tasks && tasks.makeup_sessions) || []).filter(function (m) {
      return m.status !== '취소';
    });
    if (!makeups.length) return '';
    return '<div class="card" id="today-makeup-strip"><div class="toolbar"><h3 style="margin:0">보강</h3>' +
      '<span class="muted">' + esc(date) + ' · ' + makeups.length + '건</span></div><ul class="task-list">' +
      makeups.map(function (m) {
        var label = m.title || (m.kind === '반' ? m.class_name + ' 보강' : (m.student_name || '') + ' 보강');
        var meta = '보강 ' + esc(m.status) + (m.start_time ? ' · ' + esc(m.start_time) : '');
        var open = m.class_id
          ? '<button type="button" class="btn ghost makeup-open" data-date="' + esc(date) +
            '" data-class="' + esc(m.class_id) + '">수업 기록</button>'
          : (m.makeup_id
            ? '<button type="button" class="btn ghost makeup-edit" data-makeup="' + esc(m.makeup_id) + '">보강 보기</button>'
            : (m.student_id
              ? '<button type="button" class="btn ghost makeup-student" data-student="' + esc(m.student_id) + '">학생</button>'
              : ''));
        return '<li class="task-item makeup"><span class="task-title">' + esc(label) +
          '</span><span class="muted">' + meta + '</span>' + open + '</li>';
      }).join('') + '</ul></div>';
  }

  function bindMakeupStrip(scope) {
    if (!scope) return;
    scope.querySelectorAll('.makeup-open').forEach(function (btn) {
      btn.onclick = function () {
        goToToday(btn.getAttribute('data-date'), btn.getAttribute('data-class'));
      };
    });
    scope.querySelectorAll('.makeup-edit').forEach(function (btn) {
      btn.onclick = function () {
        api('getMakeupSession', [btn.getAttribute('data-makeup')])
          .then(showMakeupForm)
          .catch(function (err) { toast(err.message, true); });
      };
    });
    scope.querySelectorAll('.makeup-student').forEach(function (btn) {
      btn.onclick = function () {
        go('students/' + btn.getAttribute('data-student'));
      };
    });
  }

  function refreshMakeupStrip(root, date) {
    var host = root.querySelector('#today-makeup-host');
    if (!host) return Promise.resolve();
    return loadDashboardForDate(date).then(function (dash) {
      host.innerHTML = makeupStripHtml((dash && dash.teaching_tasks) || null, date);
      bindMakeupStrip(host);
    }).catch(function (e) {
      host.innerHTML = '';
      toast(e.message || String(e), true);
    });
  }

  function renderNav() {
    var byId = {};
    MENUS.forEach(function (m) { byId[m.id] = m; });
    document.getElementById('nav').innerHTML = MENU_GROUPS.map(function (group) {
      var links = group.items.map(function (id) {
        var m = byId[id];
        var active = state.route === m.id;
        return '<a href="#/' + m.id + '"' +
          (active ? ' class="active" aria-current="page"' : '') + '>' + esc(m.label) + '</a>';
      }).join('');
      return '<div class="nav-group"><div class="nav-label">' + esc(group.label) + '</div>' + links + '</div>';
    }).join('');
    var title = (MENUS.filter(function (m) { return m.id === state.route; })[0] || {}).label || '학습관리';
    document.getElementById('page-title').textContent = title;
    document.getElementById('brand-name').textContent = state.settings.academy_name || '학생 관리 시스템';
    document.getElementById('top-date').textContent = state.today || '';
  }

  function setDrawer(open) {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('nav-backdrop');
    var btn = document.getElementById('menu-btn');
    var mobile = window.matchMedia('(max-width: 980px)').matches;
    var next = !!open && mobile;
    sidebar.classList.toggle('open', next);
    if (backdrop) backdrop.hidden = !next;
    if (btn) btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    document.body.classList.toggle('drawer-open', next);
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

  function taskKindLabel(kind) {
    return TASK_KIND_LABELS[kind] || kind || '할 일';
  }

  function agendaActionLabel(action) {
    return AGENDA_ACTION_LABELS[action] || '열기';
  }

  function agendaMetaLine(item) {
    var bits = [];
    if (item.student_name) bits.push(item.student_name);
    if (item.class_name) bits.push(item.class_name);
    if (item.start_time) bits.push(item.start_time);
    if (item.incomplete_count != null && item.student_count != null && item.kind === 'incomplete_class') {
      bits.push('미기록 ' + item.incomplete_count + '/' + item.student_count);
    }
    if (item.homework_preview) bits.push(item.homework_preview);
    if (item.memo && item.kind === 'learning_alert') bits.push(item.memo);
    return bits.join(' · ');
  }

  function agendaItemsHtml(agenda) {
    var items = (agenda && agenda.items) || [];
    if (!items.length) {
      return '<div class="empty">이 날짜에 표시할 할 일이 없습니다.</div>';
    }
    var date = agenda.date || state.today;
    return '<ul class="task-list agenda-list">' + items.map(function (item) {
      var done = item.status === '완료';
      var meta = agendaMetaLine(item);
      var actions = '';
      if (item.source === 'manual') {
        if (!done) {
          actions += '<button type="button" class="btn ok agenda-complete" data-id="' + esc(item.id) + '">완료</button>';
        }
        actions += '<button type="button" class="btn ghost agenda-cancel" data-id="' + esc(item.id) + '">취소</button>';
      } else {
        actions += '<button type="button" class="btn agenda-action" data-action="' + esc(item.action || '') +
          '" data-date="' + esc(date) +
          '" data-class="' + esc(item.class_id || '') +
          '" data-student="' + esc(item.student_id || '') +
          '" data-makeup="' + esc(item.makeup_id || '') + '">' +
          esc(agendaActionLabel(item.action)) + '</button>';
      }
      return '<li class="task-item agenda-item' + (done ? ' is-done' : '') + '">' +
        '<div class="agenda-main">' +
          '<div class="agenda-title-row">' +
            '<span class="badge">' + esc(taskKindLabel(item.kind)) + '</span>' +
            (item.source === 'manual' ? '<span class="badge ok">수동</span>' : '') +
            (done ? '<span class="badge ok">완료</span>' : '') +
            '<span class="task-title">' + esc(item.title) + '</span>' +
          '</div>' +
          (meta ? '<div class="muted agenda-meta">' + esc(meta) + '</div>' : '') +
        '</div>' +
        '<div class="agenda-actions">' + actions + '</div></li>';
    }).join('') + '</ul>';
  }

  function learningAlertsSummaryHtml(alerts, agenda, viewDate) {
    var day = viewDate || (agenda && agenda.date) || state.today;
    if (day !== state.today) {
      return '<p class="muted" style="margin:0">학습 주의 신호는 오늘(' + esc(state.today) +
        ') 기준으로만 표시합니다. 선택한 날짜의 할 일에는 포함되지 않습니다.</p>';
    }
    alerts = alerts || [];
    var agendaAlerts = ((agenda && agenda.items) || []).filter(function (i) {
      return i.kind === 'learning_alert';
    }).length;
    if (!alerts.length) {
      return '<p class="muted" style="margin:0">학습 주의 신호가 없습니다. 관련 항목은 위 할 일에서 확인하세요.</p>';
    }
    var top = alerts.slice(0, 3).map(function (item) {
      return '<a class="link" href="#/students/' + esc(item.student_id) + '">' + esc(item.student_name) + '</a>';
    }).join(', ');
    return '<p style="margin:0 0 6px"><b>' + alerts.length + '</b>명의 학습 주의 신호' +
      (agendaAlerts ? ' · 할 일에 ' + agendaAlerts + '건 포함' : '') + '</p>' +
      '<p class="muted" style="margin:0">대표: ' + top +
      (alerts.length > 3 ? ' 외 ' + (alerts.length - 3) + '명' : '') +
      ' · 상세는 할 일의 「학습 점검」에서 열 수 있습니다.</p>';
  }

  function taskKindOptions(selected) {
    return [
      { value: 'counsel_parent', label: '학부모 상담' },
      { value: 'counsel_student', label: '학생 상담' },
      { value: 'homework_check', label: '과제 확인' },
      { value: 'admin', label: '행정' },
      { value: 'other', label: '기타' }
    ].map(function (o) {
      return { value: o.value, label: o.label };
    });
  }

  function agendaAddFormHtml(date) {
    return '<details class="agenda-add"><summary>할 일 추가</summary>' +
      '<div class="row" style="margin-top:10px">' +
        field('종류', select('task_kind', taskKindOptions(), 'other')) +
        field('기한', input('task_due', date || state.today, 'date')) +
        field('제목', input('task_title', '')) +
        field('학생', select('task_student', studentOptions(''), '')) +
        field('반', select('task_class', classOptions('', false), '')) +
        field('메모', '<textarea name="task_memo" rows="2"></textarea>', { wide: true }) +
        '<button type="button" class="btn" id="save-task">추가</button>' +
      '</div></details>';
  }

  function runAgendaAction(action, date, classId, studentId, makeupId) {
    if (action === 'open_today_session' || action === 'check_homework') {
      goToToday(date, classId || '');
      return;
    }
    if (action === 'open_makeup') {
      if (classId) {
        goToToday(date, classId);
        return;
      }
      if (makeupId) {
        api('getMakeupSession', [makeupId])
          .then(showMakeupForm)
          .catch(function (err) { toast(err.message, true); });
        return;
      }
      if (studentId) {
        go('students/' + studentId);
        return;
      }
      toast('보강에 연결된 반·학생이 없습니다.', true);
      return;
    }
    if (action === 'open_student' && studentId) {
      go('students/' + studentId);
      return;
    }
    if (action === 'edit_task') return;
    toast('처리할 수 없는 동작입니다.', true);
  }

  function bindAgendaCard(root, d) {
    var agendaDate = (d.agenda && d.agenda.date) || d.date || state.today;
    var goToday = document.getElementById('go-today');
    if (goToday) goToday.onclick = function () { goToToday(agendaDate); };
    var prev = document.getElementById('agenda-prev');
    var next = document.getElementById('agenda-next');
    var todayBtn = document.getElementById('agenda-today');
    if (prev) prev.onclick = function () { loadDashboardDate(addDaysIso(agendaDate, -1)); };
    if (next) next.onclick = function () { loadDashboardDate(addDaysIso(agendaDate, 1)); };
    if (todayBtn) todayBtn.onclick = function () { loadDashboardDate(state.today); };
    root.querySelectorAll('.agenda-action').forEach(function (btn) {
      btn.onclick = function () {
        runAgendaAction(
          btn.getAttribute('data-action'),
          btn.getAttribute('data-date'),
          btn.getAttribute('data-class'),
          btn.getAttribute('data-student'),
          btn.getAttribute('data-makeup')
        );
      };
    });
    root.querySelectorAll('.agenda-complete').forEach(function (btn) {
      btn.onclick = function () {
        api('updateTaskStatus', [btn.getAttribute('data-id'), '완료']).then(function () {
          toast('완료 처리했습니다.');
          state.cache.dashboard = null;
          loadDashboardDate(agendaDate);
        }).catch(function (e) { toast(e.message, true); });
      };
    });
    root.querySelectorAll('.agenda-cancel').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('이 할 일을 취소할까요?')) return;
        api('updateTaskStatus', [btn.getAttribute('data-id'), '취소']).then(function () {
          toast('취소했습니다.');
          state.cache.dashboard = null;
          loadDashboardDate(agendaDate);
        }).catch(function (e) { toast(e.message, true); });
      };
    });
    var saveTaskBtn = document.getElementById('save-task');
    if (saveTaskBtn) {
      saveTaskBtn.onclick = function () {
        var card = saveTaskBtn.closest('.card');
        var title = card.querySelector('[name=task_title]').value;
        if (!String(title || '').trim()) return toast('제목을 입력해 주세요.', true);
        var payload = {
          kind: card.querySelector('[name=task_kind]').value,
          due_date: card.querySelector('[name=task_due]').value || agendaDate,
          title: title,
          student_id: card.querySelector('[name=task_student]').value || '',
          class_id: card.querySelector('[name=task_class]').value || '',
          memo: card.querySelector('[name=task_memo]').value || '',
          status: '예정'
        };
        withBusy(saveTaskBtn, function () {
          return api('saveTask', [payload]).then(function () {
            toast('할 일을 추가했습니다.');
            state.cache.dashboard = null;
            loadDashboardDate(payload.due_date || agendaDate);
          });
        }).catch(function (e) { toast(e.message, true); });
      };
    }
  }

  function weeklyHomeworkHtml(weekly, onlyIncomplete) {
    weekly = weekly || { classes: [] };
    var classes = weekly.classes || [];
    if (onlyIncomplete) {
      classes = classes.map(function (cls) {
        return Object.assign({}, cls, {
          slots: (cls.slots || []).filter(function (s) {
            return s.completion && s.completion.item_count > 0 && s.completion.students_incomplete > 0;
          })
        });
      }).filter(function (cls) { return cls.slots.length; });
    }
    if (!classes.length) {
      return '<div class="empty">이번 주 확인할 숙제 슬롯이 없습니다.</div>';
    }
    return classes.map(function (cls) {
      var slots = (cls.slots || []).map(function (slot) {
        var c = slot.completion || {};
        var titles = (slot.items || []).map(function (it) { return it.title; }).filter(Boolean).join(' · ');
        var incomplete = c.item_count > 0 && c.students_incomplete > 0;
        return '<li class="task-item' + (incomplete ? ' warn-item' : '') + '">' +
          '<div class="agenda-main">' +
            '<div class="agenda-title-row"><strong>' + esc(slot.check_date) + ' 확인</strong>' +
              '<span class="muted"> · 배정 ' + esc(slot.assigned_date || '-') + '</span></div>' +
            '<div class="muted agenda-meta">' + esc(titles || '(숙제 없음)') + '</div>' +
            '<div class="muted agenda-meta">완료 칸 ' + (c.done || 0) + '/' + (c.total || 0) +
              ' · 미완료 학생 ' + (c.students_incomplete || 0) + '명</div>' +
          '</div>' +
          '<div class="agenda-actions">' +
            '<button type="button" class="btn ghost week-hw-open" data-date="' + esc(slot.check_date) +
              '" data-class="' + esc(cls.class_id) + '">수업 열기</button>' +
          '</div></li>';
      }).join('');
      return '<div class="card" style="margin-top:10px"><div class="toolbar"><h3 style="margin:0">' +
        esc(cls.class_name) + '</h3><span class="muted">' + esc(cls.weekday || '') +
        (cls.incomplete_slot_count ? ' · 미완료 ' + cls.incomplete_slot_count + '건' : '') +
        '</span></div><ul class="task-list">' + (slots || '<li class="muted">슬롯 없음</li>') + '</ul></div>';
    }).join('');
  }

  function paintDashboard(root, d) {
    var agenda = d.agenda || { date: d.date, items: [] };
    var agendaDate = agenda.date || d.date || state.today;
    var dateLabel = d.date_label || agendaDate;
    var weekly = d.weekly_homework || null;
    root.innerHTML =
      '<div class="card" id="weekly-hw-card">' +
        '<div class="toolbar">' +
          '<div><h3 style="margin:0">이번 주 필수 숙제</h3>' +
            '<p class="muted" style="margin:4px 0 0">' + esc((weekly && weekly.week_label) || '') + '</p></div>' +
          '<div class="row" style="margin:0;gap:6px;flex-wrap:wrap">' +
            '<button type="button" class="btn secondary" id="week-hw-prev">이전 주</button>' +
            '<button type="button" class="btn secondary" id="week-hw-today">이번 주</button>' +
            '<button type="button" class="btn secondary" id="week-hw-next">다음 주</button>' +
          '</div></div>' +
        '<label style="display:flex;align-items:center;gap:8px;margin:0 0 8px;cursor:pointer">' +
          '<input type="checkbox" id="week-hw-incomplete" style="width:auto;min-height:0"> 미완료만 보기</label>' +
        '<div id="weekly-hw-body">' + weeklyHomeworkHtml(weekly, false) + '</div></div>' +
      '<div class="grid stats" style="margin-top:14px">' +
        stat('수업 반', d.today_class_count) +
        stat('수업 학생', d.today_student_count) +
        stat('기록 완료', d.recorded_count) +
        stat('기록 미완료', d.incomplete_count) +
      '</div>' +
      '<div class="card" style="margin-top:14px">' +
        '<div class="toolbar">' +
          '<div><h3 style="margin:0">오늘 할 일</h3>' +
            '<p class="muted" style="margin:4px 0 0">' + esc(dateLabel) + '</p></div>' +
          '<div class="row" style="margin:0;gap:6px;flex-wrap:wrap">' +
            '<button type="button" class="btn secondary" id="agenda-prev">이전</button>' +
            '<button type="button" class="btn secondary" id="agenda-today">오늘</button>' +
            '<button type="button" class="btn secondary" id="agenda-next">다음</button>' +
            '<button type="button" class="btn" id="go-today">오늘의 수업 열기</button>' +
          '</div>' +
        '</div>' +
        agendaItemsHtml(agenda) +
        agendaAddFormHtml(agendaDate) +
      '</div>' +
      '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">학습 주의 신호</h3>' +
        learningAlertsSummaryHtml(d.learning_alerts, agenda, agendaDate) +
      '</div>' +
      '<div class="split" style="margin-top:14px">' +
        '<div class="card"><div class="toolbar"><h3 style="margin:0">오늘 수업 반</h3></div>' +
          ((d.classes || []).length ? '<table><thead><tr><th>반</th><th>요일</th><th>시간</th><th>담당</th></tr></thead><tbody>' +
            d.classes.map(function (c) {
              return '<tr><td>' + esc(c.class_name) + '</td><td>' + esc(c.weekday) + '</td><td>' +
                esc(c.start_time) + (c.end_time ? '–' + esc(c.end_time) : '') + '</td><td>' + esc(c.teacher) + '</td></tr>';
            }).join('') + '</tbody></table>' : '<div class="empty">배정된 운영 반이 없습니다.</div>') +
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
        '<div id="makeup-form"></div>' +
        '<p class="muted" id="cal-label"></p>' +
        '<div id="cal-body"><div class="empty">달력을 불러오는 중...</div></div>' +
      '</div>';
    bindAgendaCard(root, d);
    bindWeeklyHomework(root, d);
    bindCalendar();
  }

  function addDaysIsoLocal(isoDate, delta) {
    var parts = String(isoDate || '').split('-');
    if (parts.length !== 3) return isoDate;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + Number(delta || 0));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function bindWeeklyHomework(root, d) {
    var weekly = d.weekly_homework || null;
    var anchor = (weekly && weekly.anchor_date) || d.date || state.today;
    var body = document.getElementById('weekly-hw-body');
    var incompleteOnly = document.getElementById('week-hw-incomplete');
    function paintWeek(nextWeekly) {
      weekly = nextWeekly;
      if (body) body.innerHTML = weeklyHomeworkHtml(weekly, !!(incompleteOnly && incompleteOnly.checked));
      root.querySelectorAll('.week-hw-open').forEach(function (btn) {
        btn.onclick = function () {
          goToToday(btn.getAttribute('data-date'), btn.getAttribute('data-class'));
        };
      });
    }
    paintWeek(weekly);
    if (incompleteOnly) {
      incompleteOnly.onchange = function () { paintWeek(weekly); };
    }
    var prev = document.getElementById('week-hw-prev');
    var next = document.getElementById('week-hw-next');
    var todayBtn = document.getElementById('week-hw-today');
    function loadWeek(nextAnchor) {
      api('getWeeklyHomeworkDashboard', [nextAnchor]).then(function (res) {
        paintWeek(res);
        var label = root.querySelector('#weekly-hw-card .muted');
        if (label && res.week_label) label.textContent = res.week_label;
        anchor = res.anchor_date || nextAnchor;
      }).catch(function (e) { toast(e.message, true); });
    }
    if (prev) prev.onclick = function () { loadWeek(addDaysIsoLocal(anchor, -7)); };
    if (next) next.onclick = function () { loadWeek(addDaysIsoLocal(anchor, 7)); };
    if (todayBtn) todayBtn.onclick = function () { loadWeek(state.today); };
  }

  function loadDashboardDate(date) {
    state.agendaDate = date || state.today;
    var seq = ++dashboardLoadSeq;
    var root = document.getElementById('main');
    if (state.route !== 'dashboard' || !root) return;
    var cached = state.cache.dashboard;
    if (cached && cached.date === state.agendaDate) {
      paintDashboard(root, cached);
      return;
    }
    spinner(root);
    api('getDashboard', [state.agendaDate]).then(function (d) {
      if (seq !== dashboardLoadSeq) return;
      if (d.date !== state.agendaDate) return;
      if (d.date === state.today) {
        state.cache.dashboard = d;
        persistBoot();
      }
      paintDashboard(root, d);
    }).catch(function (e) {
      if (seq !== dashboardLoadSeq) return;
      fail(root)(e);
    });
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
    state.cal.req = (state.cal.req || 0) + 1;
    var req = state.cal.req;
    api('getCalendar', [range.start, range.end]).then(function (res) {
      if (!state.cal || req !== state.cal.req) return;
      paintCalendar(res.events || [], range);
    }).catch(function (e) {
      if (!state.cal || req !== state.cal.req) return;
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

  function selectedMakeupStudentIds(root) {
    return Array.prototype.map.call(root.querySelectorAll('[name=student_ids]:checked'), function (el) {
      return el.value;
    });
  }

  function makeupStudentListHtml(classId, selectedIds) {
    selectedIds = selectedIds || [];
    var selected = {};
    selectedIds.forEach(function (id) { selected[id] = true; });
    var list = (state.cache.students || []).filter(function (s) {
      if (!(s.status === '재원' || selected[s.student_id])) return false;
      if (!classId) return true;
      var inClass = (s.current_classes || []).some(function (c) {
        return String(c.class_id) === String(classId);
      });
      return inClass || selected[s.student_id];
    });
    if (!list.length) {
      return '<p class="muted" style="margin:0">선택할 학생이 없습니다. 반을 선택하거나 학생을 먼저 배정하세요.</p>';
    }
    return '<div class="multi-check-actions">' +
      '<button type="button" class="btn ghost" id="makeup-select-all">전체 선택</button>' +
      '<button type="button" class="btn ghost" id="makeup-select-none">선택 해제</button>' +
      '</div>' +
      '<div class="multi-check">' +
      list.map(function (s) {
        return '<label class="check-item"><input type="checkbox" name="student_ids" value="' +
          esc(s.student_id) + '"' + (selected[s.student_id] ? ' checked' : '') + '> ' +
          esc(s.name) + ' · ' + esc(s.grade) + '</label>';
      }).join('') +
      '</div>';
  }

  function bindMakeupStudentControls(box) {
    var allBtn = box.querySelector('#makeup-select-all');
    var noneBtn = box.querySelector('#makeup-select-none');
    if (allBtn) {
      allBtn.onclick = function () {
        box.querySelectorAll('[name=student_ids]').forEach(function (el) { el.checked = true; });
      };
    }
    if (noneBtn) {
      noneBtn.onclick = function () {
        box.querySelectorAll('[name=student_ids]').forEach(function (el) { el.checked = false; });
      };
    }
  }

  function refreshMakeupStudents(box) {
    var host = box.querySelector('#makeup-students');
    if (!host) return;
    var classId = box.querySelector('[name=class_id]').value;
    host.innerHTML = makeupStudentListHtml(classId, selectedMakeupStudentIds(box));
    bindMakeupStudentControls(box);
  }

  function showMakeupForm(row) {
    var box = document.getElementById('makeup-form');
    if (!box) return;
    loadLookups().then(function () {
      row = row || { makeup_date: state.today, kind: '반', status: '예정' };
      var selectedIds = row.student_id ? [row.student_id] : [];
      box.innerHTML = '<div class="card"><h3>' + (row.makeup_id ? '보강 수정' : '보강 추가') + '</h3><div class="row">' +
        field('종류', select('kind', ['반', '학생'], row.kind || '반')) +
        field('날짜', input('makeup_date', row.makeup_date || state.today, 'date')) +
        field('시작', input('start_time', row.start_time || '18:00', 'time')) +
        field('종료', input('end_time', row.end_time || '20:00', 'time')) +
        field('반', select('class_id', classOptions(row.class_id, true), row.class_id || '')) +
        '<div class="field field-wide" id="makeup-students-field"><label>학생 (여러 명 선택 가능)</label><div id="makeup-students">' +
          makeupStudentListHtml(row.class_id || '', selectedIds) +
        '</div></div>' +
        field('제목', input('title', row.title || '')) +
        field('상태', select('status', ['예정', '완료', '취소'], row.status || '예정')) +
        field('메모', '<textarea name="memo">' + esc(row.memo) + '</textarea>', { wide: true }) +
        '</div><div class="row"><button class="btn" id="save-makeup">저장</button>' +
        (row.makeup_id ? '<button class="btn danger" id="cancel-makeup">취소 처리</button>' : '') +
        '<button class="btn secondary" id="close-makeup">닫기</button></div></div>';
      function syncKind() {
        var k = box.querySelector('[name=kind]').value;
        var stuField = box.querySelector('#makeup-students-field');
        if (stuField) stuField.style.display = k === '학생' ? '' : 'none';
      }
      syncKind();
      bindMakeupStudentControls(box);
      box.querySelector('[name=kind]').onchange = syncKind;
      box.querySelector('[name=class_id]').onchange = function () { refreshMakeupStudents(box); };
      document.getElementById('save-makeup').onclick = function () {
        var form = this.closest('.card');
        var kind = form.querySelector('[name=kind]').value;
        var ids = kind === '학생' ? selectedMakeupStudentIds(form) : [];
        var data = {
          makeup_id: row.makeup_id,
          kind: kind,
          makeup_date: form.querySelector('[name=makeup_date]').value,
          start_time: form.querySelector('[name=start_time]').value,
          end_time: form.querySelector('[name=end_time]').value,
          class_id: form.querySelector('[name=class_id]').value,
          student_id: ids[0] || '',
          student_ids: ids,
          title: form.querySelector('[name=title]').value,
          status: form.querySelector('[name=status]').value,
          memo: form.querySelector('[name=memo]').value
        };
        api('saveMakeupSession', [data]).then(function (res) {
          var n = res && res.created_count ? res.created_count : 1;
          toast(n > 1 ? n + '건의 보강 일정을 저장했습니다.' : '보강 일정을 저장했습니다.');
          box.innerHTML = '';
          loadCalendar();
          if (data.status === '완료' && data.class_id) {
            goToToday(data.makeup_date, data.class_id);
          }
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
      if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderDashboard(root) {
    loadLookups().then(function () {
      loadDashboardDate(state.agendaDate || state.today);
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

  function rawScore(lesson) {
    if (!lesson || lesson.test_status !== '실시') return null;
    var s = Number(lesson.test_score);
    var m = Number(lesson.test_max_score);
    if (!isFinite(s) || !isFinite(m) || m <= 0) return null;
    return { score: s, max: m };
  }

  function formatAverage(v) {
    if (v === null || v === undefined || !isFinite(Number(v))) return '-';
    return (Math.round(Number(v) * 10) / 10).toFixed(1);
  }

  function summarizeLessons(rows) {
    var present = 0;
    var absent = 0;
    var entries = [];
    (rows || []).forEach(function (row) {
      if (row.attendance === '결석') absent += 1;
      else present += 1;
      var n = rawScore(row);
      if (n) entries.push(n);
    });
    var comparable = true;
    var scores = [];
    if (entries.length) {
      var max0 = entries[0].max;
      for (var i = 1; i < entries.length; i++) {
        if (entries[i].max !== max0) {
          comparable = false;
          break;
        }
      }
      if (comparable) scores = entries.map(function (e) { return e.score; });
    }
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
      test_count: entries.length,
      test_average_display: comparable ? formatAverage(avg) : '-',
      test_median_display: comparable ? formatAverage(median) : '-',
      test_high_display: comparable && scores.length ? formatAverage(Math.max.apply(null, scores)) : '-',
      test_low_display: comparable && scores.length ? formatAverage(Math.min.apply(null, scores)) : '-',
      comparable: comparable
    };
  }

  function svgLineChart(points, opts) {
    opts = opts || {};
    if (!points.length) {
      return '<div class="empty">' + esc(opts.empty || '표시할 데이터가 없습니다.') + '</div>';
    }
    var hasClass = points.some(function (p) { return p.y2 != null && isFinite(Number(p.y2)); });
    var yMax = Number(opts.yMax);
    if (!isFinite(yMax) || yMax <= 0) {
      var peak = 0;
      points.forEach(function (p) {
        if (isFinite(Number(p.y))) peak = Math.max(peak, Number(p.y));
        if (p.y2 != null && isFinite(Number(p.y2))) peak = Math.max(peak, Number(p.y2));
      });
      yMax = peak > 0 ? peak : 100;
    }
    var tickCount = 4;
    var ticks = [];
    for (var t = 0; t <= tickCount; t++) {
      ticks.push(Math.round((yMax * t) / tickCount * 10) / 10);
    }
    var w = Math.max(520, points.length * (hasClass ? 88 : 72));
    var h = hasClass ? 248 : 220;
    var padL = 40;
    var padR = 16;
    var padT = hasClass ? 28 : 22;
    var padB = 36;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    function xAt(i) {
      if (points.length === 1) return padL + innerW / 2;
      return padL + (i / (points.length - 1)) * innerW;
    }
    function yAt(v) {
      return padT + (1 - (Number(v) / yMax)) * innerH;
    }
    var grid = ticks.map(function (tick) {
      var y = yAt(tick);
      return '<line class="chart-grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" />' +
        '<text class="chart-axis" x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + tick + '</text>';
    }).join('');
    var d = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p.y).toFixed(1);
    }).join(' ');
    var classD = '';
    if (hasClass) {
      var started = false;
      points.forEach(function (p, i) {
        if (p.y2 == null || !isFinite(Number(p.y2))) {
          started = false;
          return;
        }
        classD += (started ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(p.y2).toFixed(1);
        started = true;
      });
    }
    var dots = points.map(function (p, i) {
      var html = '';
      if (hasClass && p.y2 != null && isFinite(Number(p.y2))) {
        html += '<circle class="chart-dot class-avg" cx="' + xAt(i).toFixed(1) + '" cy="' +
          yAt(p.y2).toFixed(1) + '" r="3.5" />' +
          '<text class="chart-value class-avg" x="' + xAt(i).toFixed(1) + '" y="' +
          (yAt(p.y2) + 16).toFixed(1) + '" text-anchor="middle">' + esc(p.label2) + '</text>';
      }
      html += '<circle class="chart-dot" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p.y).toFixed(1) + '" r="4" />' +
        '<text class="chart-value" x="' + xAt(i).toFixed(1) + '" y="' + (yAt(p.y) - 10).toFixed(1) + '" text-anchor="middle">' +
        esc(p.label) + '</text>' +
        '<text class="chart-axis" x="' + xAt(i).toFixed(1) + '" y="' + (h - 12) + '" text-anchor="middle">' +
        esc(p.xLabel) + '</text>';
      return html;
    }).join('');
    var classPath = classD
      ? '<path class="chart-line class-avg" d="' + classD + '" fill="none" />'
      : '';
    var legend = hasClass
      ? '<div class="chart-legend">' +
        '<span><i class="chart-legend-swatch"></i>학생 점수</span>' +
        '<span><i class="chart-legend-swatch class-avg"></i>그날 반 평균</span>' +
        '</div>'
      : '';
    return '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ' + w + ' ' + h +
      '" role="img" aria-label="' + esc(opts.title || '차트') + '">' +
      grid + classPath + '<path class="chart-line" d="' + d + '" fill="none" />' + dots + '</svg>' +
      legend + '</div>';
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
      var preferred = state.params.classId || '';
      return loadDashboardForDate(date).then(function (dash) {
        var classId = preferred || pickClassFromDashboard(dash);
        var resolvedTasks = (dash && dash.teaching_tasks) || null;
        root.innerHTML =
          '<div id="today-makeup-host">' + makeupStripHtml(resolvedTasks, date) + '</div>' +
          '<div class="card"><div class="row">' +
            field('날짜', input('lesson_date', date, 'date')) +
            field('반', select('class_id', classOptions(classId), classId)) +
          '</div></div>' +
          '<div id="today-body"></div>';
        bindMakeupStrip(document.getElementById('today-makeup-host'));
        root.querySelector('[name=lesson_date]').onchange = reload;
        root.querySelector('[name=class_id]').onchange = reload;
        function reload() {
          var nextDate = root.querySelector('[name=lesson_date]').value;
          var nextClass = root.querySelector('[name=class_id]').value;
          refreshMakeupStrip(root, nextDate);
          loadSession(nextDate, nextClass);
        }
        if (classId) loadSession(date, classId);
        else document.getElementById('today-body').innerHTML = '<div class="card empty">오늘 배정된 운영 반이 없습니다. 반관리에서 먼저 등록해 주세요.</div>';
      });
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

  function applyLessonSnapshot(body, snapshot) {
    if (!snapshot) return;
    var bulkProgress = document.getElementById('bulk-progress');
    if (bulkProgress && !bulkProgress.value) bulkProgress.value = snapshot.progress || '';
  }

  function homeworkSlotsHtml(items) {
    var rows = (items && items.length) ? items : [{ title: '', item_id: '' }];
    return '<div id="hw-slots">' + rows.map(function (it, idx) {
      return '<div class="row hw-slot" data-idx="' + idx + '" data-item-id="' + esc(it.item_id || '') + '" style="align-items:end">' +
        field('숙제 ' + (idx + 1), input('hw_title', it.title || '', 'text', 'placeholder="예: 워크북 12쪽"'), { wide: true }) +
        '<button type="button" class="btn ghost hw-remove" ' + (rows.length === 1 ? 'disabled' : '') + '>삭제</button></div>';
    }).join('') + '</div>' +
      '<button type="button" class="btn secondary" id="hw-add" style="margin-top:8px">숙제 칸 추가</button>';
  }

  function bindHomeworkSlots(scope) {
    var host = scope.querySelector('#hw-slots');
    if (!host) return;
    function reindex() {
      var slots = host.querySelectorAll('.hw-slot');
      slots.forEach(function (slot, idx) {
        slot.setAttribute('data-idx', String(idx));
        var label = slot.querySelector('label');
        if (label) label.textContent = '숙제 ' + (idx + 1);
        var rm = slot.querySelector('.hw-remove');
        if (rm) rm.disabled = slots.length === 1;
      });
    }
    var addBtn = scope.querySelector('#hw-add');
    if (addBtn) {
      addBtn.onclick = function () {
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="row hw-slot" data-item-id="" style="align-items:end">' +
          field('숙제', input('hw_title', '', 'text', 'placeholder="예: 워크북 12쪽"'), { wide: true }) +
          '<button type="button" class="btn ghost hw-remove">삭제</button></div>';
        host.appendChild(wrap.firstChild);
        reindex();
      };
    }
    host.onclick = function (e) {
      var btn = e.target.closest('.hw-remove');
      if (!btn || btn.disabled) return;
      var slot = btn.closest('.hw-slot');
      if (slot) slot.remove();
      reindex();
    };
  }

  function readHomeworkItems(scope) {
    return Array.prototype.map.call(scope.querySelectorAll('#hw-slots .hw-slot'), function (slot) {
      var titleEl = slot.querySelector('[name=hw_title]');
      var title = titleEl ? trimStr(titleEl.value) : '';
      if (!title) return null;
      return {
        title: title,
        item_id: slot.getAttribute('data-item-id') || ''
      };
    }).filter(Boolean);
  }

  function readHomeworkTitles(scope) {
    return readHomeworkItems(scope).map(function (it) { return it.title; });
  }

  function priorHomeworkCardHtml(prior, students) {
    if (!prior || !(prior.items || []).length) {
      return '<div class="card"><h3 style="margin-top:0">직전 숙제 확인</h3>' +
        '<p class="muted" style="margin:0">직전 수업에서 내준 숙제가 없습니다.</p></div>';
    }
    var items = prior.items;
    var head = '<tr><th>학생</th>' + items.map(function (it, i) {
      return '<th>' + esc(it.title || ('숙제 ' + (i + 1))) + '</th>';
    }).join('') + '<th>이행률</th></tr>';
    var body = (students || []).map(function (s) {
      var map = (prior.checks_by_student && prior.checks_by_student[s.student_id]) || {};
      var cells = items.map(function (it, idx) {
        var key = it.item_id || ('idx:' + idx);
        var checked = map[it.item_id] === '완료';
        return '<td style="text-align:center"><input type="checkbox" class="hw-check" data-student="' +
          esc(s.student_id) + '" data-item="' + esc(it.item_id || '') + '" data-index="' + idx + '"' +
          (checked ? ' checked' : '') + ' style="width:auto;min-height:0"></td>';
      }).join('');
      var grade = (s.lesson && s.lesson.assignment_completion) || '';
      return '<tr data-student="' + esc(s.student_id) + '"><td>' + esc(s.name) + '</td>' + cells +
        '<td class="hw-grade muted">' + esc(grade || '-') + '</td></tr>';
    }).join('');
    return '<div class="card" id="prior-hw-card"><div class="toolbar"><h3 style="margin:0">직전 숙제 확인</h3>' +
      '<span class="muted">배정일 ' + esc(prior.assigned_date || '') + (prior.from_legacy ? ' · 이전 텍스트에서 불러옴' : '') + '</span></div>' +
      '<div class="table-scroll"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="muted" style="margin:8px 0 0">체크 비율로 A/B/C가 자동 계산됩니다. 수업 기록 저장 시 함께 저장됩니다.</p></div>';
  }

  function loadSession(date, classId) {
    var body = document.getElementById('today-body');
    if (!classId) return;
    spinner(body);
    Promise.all([
      api('getTodayClassSession', [date, classId]),
      api('getLastLessonSnapshot', [classId, date])
    ]).then(function (pair) {
      var session = pair[0];
      var snapshot = pair[1];
      var incompleteCount = 0;
      var prior = session.prior_homework;
      var todayHw = session.today_homework || { items: [] };
      var cards = session.students.map(function (s) {
        var l = s.lesson || {};
        var tested = (l.test_status || '미실시') === '실시';
        var recorded = !!l.lesson_id;
        if (!recorded) incompleteCount += 1;
        var hasPerStudentText = !!trimStr(l.progress);
        var grade = l.assignment_completion || '';
        return '<article class="card student-card" data-student="' + esc(s.student_id) +
          '" data-recorded="' + (recorded ? '1' : '0') + '" data-grade="' + esc(grade) + '">' +
          '<div class="toolbar"><h3>' + esc(s.name) + ' <span class="muted">' + esc(s.grade) + '</span></h3>' +
          (recorded ? '<span class="badge ok">기록됨</span>' : '<span class="badge warn">미기록</span>') + '</div>' +
          '<div class="row">' + field('출석', chipGroup('attendance', ['출석', '결석'], l.attendance || '출석')) +
            field('테스트', chipGroup('test_status', ['미실시', '실시'], l.test_status || '미실시')) + '</div>' +
          '<div class="row score-row" style="' + (tested ? '' : 'display:none') + '">' +
            field('점수', input('test_score', l.test_score, 'number', 'min="0"')) +
            field('만점', input('test_max_score', l.test_max_score || 20, 'number', 'min="1"')) +
            field('난이도', chipGroup('test_difficulty', ['상', '중', '하'], l.test_difficulty || '중')) +
          '</div>' +
          '<div class="row">' +
            field('과제 이행률', '<div class="muted" data-grade-display>' + esc(grade || '체크 후 자동') + '</div>') +
            field('집중도', chipGroup('concentration', ['A', 'B', 'C', 'D', 'ABSENT'], l.concentration || 'A', ['A', 'B', 'C', 'D', '결석'])) +
          '</div>' +
          field('학생 피드백', '<textarea name="special_note">' + esc(l.special_note) + '</textarea>', { wide: true }) +
          '<details class="per-student-edit"' + (hasPerStudentText ? ' open' : '') + '>' +
            '<summary style="cursor:pointer;font-weight:600;color:var(--navy);padding:6px 0">개별 수정 (진도)</summary>' +
            '<div style="display:grid;gap:10px;margin-top:8px">' +
              field('학습 진도', '<textarea name="progress">' + esc(l.progress) + '</textarea>', { wide: true }) +
            '</div></details>' +
        '</article>';
      }).join('');

      var snapshotHint = snapshot && snapshot.lesson_date
        ? '<p class="muted">직전 수업: ' + esc(snapshot.lesson_date) + '</p>'
        : '<p class="muted">이전 수업 기록이 없습니다. 반 설정의 진도를 참고합니다.</p>';
      var filterBar = session.students.length
        ? '<div class="card" id="incomplete-filter-bar"><div class="toolbar">' +
          '<label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;font-weight:600;color:var(--ink)">' +
          '<input type="checkbox" id="filter-incomplete" style="width:auto;min-height:0"> 미기록만 보기</label>' +
          '<span class="muted">미기록 ' + incompleteCount + '명 / 전체 ' + session.students.length + '명</span></div></div>'
        : '';
      var dailyPlan = session.daily_plan;
      var planCard = '<div class="card" id="today-plan-card"><div class="toolbar"><h3 style="margin:0">오늘 강의 계획</h3>' +
        '<button type="button" class="btn ghost" id="open-daily-plan">' + (dailyPlan ? '계획 수정' : '계획 작성') + '</button></div>' +
        (dailyPlan
          ? (dailyPlan.title ? '<p style="margin:0 0 8px"><strong>' + esc(dailyPlan.title) + '</strong></p>' : '') +
            (dailyPlan.objectives ? '<p class="muted" style="margin:0 0 6px">목표</p><p class="curriculum">' + esc(dailyPlan.objectives) + '</p>' : '') +
            (dailyPlan.content ? '<p class="muted" style="margin:10px 0 6px">내용</p><p class="curriculum">' + esc(dailyPlan.content) + '</p>' : '') +
            (dailyPlan.homework ? '<p class="muted" style="margin:10px 0 6px">예정 숙제</p><p class="curriculum">' + esc(dailyPlan.homework) + '</p>' : '')
          : '<p class="muted" style="margin:0">아직 오늘 일간 계획이 없습니다. 수업 전에 간단히 적어 두면 편합니다.</p>') +
        '</div>';
      body.innerHTML =
        planCard +
        priorHomeworkCardHtml(prior, session.students) +
        '<div class="card"><h3 style="margin-top:0">오늘 내줄 숙제</h3>' +
          '<p class="muted">칸별로 입력합니다. 다음 수업에서 학생별 완료를 체크합니다.</p>' +
          homeworkSlotsHtml(todayHw.items) +
        '</div>' +
        '<div class="card"><h3 style="margin-top:0">전체 적용</h3><p class="muted">같은 반 공통 진도를 넣고 저장하세요. 학생별 진도는 「개별 수정」에서 바꿀 수 있습니다.</p>' +
          snapshotHint +
          field('학습 진도', '<textarea id="bulk-progress"></textarea>', { wide: true }) +
          field('공지사항', '<textarea id="bulk-notice" placeholder="반 전체 학부모 공지 (일일 보고서 5번 항목)"></textarea>', { wide: true }) +
          '<div class="row">' +
            field('난이도', chipGroup('bulk_difficulty', ['상', '중', '하'], '중')) +
          '</div>' +
          '<div class="row">' +
            '<button class="btn secondary" id="load-snapshot" type="button">직전 수업 진도 불러오기</button>' +
            '<button class="btn secondary" id="apply-bulk" type="button">전체 학생에게 적용</button>' +
          '</div></div>' +
        filterBar +
        '<div id="student-cards">' + (cards || '<div class="card empty">이 반에 재원 학생이 없습니다.</div>') + '</div>' +
        '<div id="post-save-actions" class="hidden" style="margin-top:12px"></div>' +
        '<div class="bottom-bar"><button class="btn" id="save-today" style="width:100%">수업 기록 저장</button></div>' +
        '<div class="save-desktop" style="margin-top:12px"><button class="btn" id="save-today-desktop">수업 기록 저장</button></div>';
      var openPlanBtn = document.getElementById('open-daily-plan');
      if (openPlanBtn) {
        openPlanBtn.onclick = function () {
          goToPlans(classId, '일간', date);
        };
      }

      bindChips(body);
      bindHomeworkSlots(body);
      var bulkProgress = document.getElementById('bulk-progress');
      var bulkNotice = document.getElementById('bulk-notice');
      if (bulkNotice) bulkNotice.value = session.class_notice || '';
      applyLessonSnapshot(body, snapshot);
      var filterIncomplete = document.getElementById('filter-incomplete');
      if (filterIncomplete) {
        filterIncomplete.onchange = function () {
          var onlyIncomplete = filterIncomplete.checked;
          body.querySelectorAll('.student-card').forEach(function (card) {
            var hide = onlyIncomplete && card.getAttribute('data-recorded') === '1';
            card.classList.toggle('hidden', hide);
          });
        };
      }
      var loadSnapshotBtn = document.getElementById('load-snapshot');
      if (loadSnapshotBtn) {
        loadSnapshotBtn.onclick = function () {
          if (bulkProgress) bulkProgress.value = snapshot.progress || '';
          toast('직전 수업 진도를 불러왔습니다.');
        };
      }
      var apply = document.getElementById('apply-bulk');
      if (apply) apply.onclick = function () {
        var p = document.getElementById('bulk-progress').value;
        var diff = selectedChip(body.querySelectorAll('.card')[body.querySelectorAll('.card').length - 1] || body, 'bulk_difficulty') || '중';
        var bulkCard = document.getElementById('bulk-progress').closest('.card');
        diff = selectedChip(bulkCard, 'bulk_difficulty') || '중';
        body.querySelectorAll('.student-card').forEach(function (card) {
          var progressEl = card.querySelector('[name=progress]');
          if (progressEl) progressEl.value = p;
          setChip(card, 'test_difficulty', diff);
        });
        toast('공통 내용을 적용했습니다.');
      };
      function showPostSaveHandoff() {
        var box = document.getElementById('post-save-actions');
        if (!box) return;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="card"><div class="toolbar"><div><h3 style="margin:0">다음 단계</h3>' +
          '<p class="muted" style="margin:6px 0 0">수업 기록을 저장했습니다. 같은 날짜·반으로 일일 보고서를 작성할 수 있습니다.</p></div>' +
          '<button type="button" class="btn ok" id="go-daily-after-save">일일 보고서 작성</button></div></div>';
        var goBtn = document.getElementById('go-daily-after-save');
        if (goBtn) goBtn.onclick = function () { goToDaily(date, classId); };
      }
      function collectPriorChecks() {
        var checks = [];
        body.querySelectorAll('#prior-hw-card .hw-check').forEach(function (el) {
          checks.push({
            student_id: el.getAttribute('data-student'),
            item_id: el.getAttribute('data-item') || '',
            index: Number(el.getAttribute('data-index')),
            status: el.checked ? '완료' : '미완료'
          });
        });
        return checks;
      }
      function save(btn) {
        var bulkP = bulkProgress ? bulkProgress.value : '';
        var hwItems = readHomeworkItems(body);
        var hwTitles = hwItems.map(function (it) { return it.title; });
        var lessonItems = [];
        body.querySelectorAll('.student-card').forEach(function (card) {
          var progressEl = card.querySelector('[name=progress]');
          var progress = progressEl ? progressEl.value : '';
          if (!trimStr(progress) && trimStr(bulkP)) progress = bulkP;
          if (progressEl) progressEl.value = progress;
          lessonItems.push({
            lesson_date: date,
            class_id: classId,
            student_id: card.getAttribute('data-student'),
            attendance: selectedChip(card, 'attendance') || '출석',
            test_status: selectedChip(card, 'test_status') || '미실시',
            test_score: card.querySelector('[name=test_score]').value,
            test_max_score: card.querySelector('[name=test_max_score]').value,
            test_difficulty: selectedChip(card, 'test_difficulty'),
            assignment_completion: card.getAttribute('data-grade') || '',
            concentration: selectedChip(card, 'concentration'),
            progress: progress,
            homework: hwTitles.join('\n'),
            special_note: card.querySelector('[name=special_note]').value
          });
        });
        if (!lessonItems.length) return toast('저장할 학생이 없습니다.', true);
        var noticeEl = document.getElementById('bulk-notice');
        var classNotice = noticeEl ? noticeEl.value : '';
        var priorChecks = collectPriorChecks();
        withBusy(btn, function () {
          var chain = Promise.resolve();
          if (prior && prior.assigned_date && priorChecks.length) {
            chain = chain.then(function () {
              return api('saveHomeworkChecks', [{
                lesson_date: prior.assigned_date,
                class_id: classId,
                check_date: date,
                checks: priorChecks
              }]);
            }).then(function (res) {
              (res.grades || []).forEach(function (g) {
                var card = body.querySelector('.student-card[data-student="' + g.student_id + '"]');
                if (!card) return;
                var disp = card.querySelector('[data-grade-display]');
                if (disp) disp.textContent = g.assignment_completion || '-';
                card.setAttribute('data-grade', g.assignment_completion || '');
                lessonItems.forEach(function (row) {
                  if (row.student_id === g.student_id) {
                    row.assignment_completion = g.assignment_completion || row.assignment_completion;
                  }
                });
              });
            });
          }
          return chain
            .then(function () {
              return api('saveSessionHomework', [{
                lesson_date: date,
                class_id: classId,
                items: hwItems
              }]);
            })
            .then(function (savedHw) {
              var slots = body.querySelectorAll('#hw-slots .hw-slot');
              (savedHw.items || []).forEach(function (it, idx) {
                if (slots[idx]) slots[idx].setAttribute('data-item-id', it.item_id || '');
              });
              return api('saveLessonsBatch', [{ items: lessonItems, class_notice: classNotice }]);
            })
            .then(function () {
              state.cache.dashboard = null;
              persistBoot();
              body.querySelectorAll('.student-card').forEach(function (card) {
                card.setAttribute('data-recorded', '1');
                var badge = card.querySelector('.badge');
                if (badge) {
                  badge.className = 'badge ok';
                  badge.textContent = '기록됨';
                }
              });
              if (filterIncomplete && filterIncomplete.checked) {
                filterIncomplete.dispatchEvent(new Event('change'));
              }
              toast('수업 기록과 숙제를 저장했습니다.');
              showPostSaveHandoff();
            });
        }).catch(function (e) { toast(e.message, true); });
      }
      var s1 = document.getElementById('save-today');
      var s2 = document.getElementById('save-today-desktop');
      if (s1) s1.onclick = function () { save(s1); };
      if (s2) s2.onclick = function () { save(s2); };
    }).catch(fail(body));
  }

  function trimStr(v) {
    return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
  }

  function learningContextHtml(ctx) {
    if (!ctx) return '';
    var summary = ctx.summary || {};
    var assignment = summary.assignment || {};
    var concentration = summary.concentration || {};
    var signals = ctx.signals || [];
    return '<div class="card" id="learning-context"><h3 style="margin-top:0">최근 4주 학습 맥락</h3>' +
      '<p class="muted">' + esc(ctx.period.start) + ' ~ ' + esc(ctx.period.end) + '</p>' +
      '<div class="grid stats">' +
        stat('수업', summary.lesson_count || 0) +
        stat('시험 평균', summary.test_average_display || '-') +
        stat('과제 A', assignment.A || 0) +
        stat('집중도 D/결석', (concentration.D || 0) + (concentration.ABSENT || 0)) +
      '</div>' +
      (signals.length
        ? '<div class="alert-tags" style="margin-top:10px">' + signals.map(function (sig) {
          return '<span class="badge warn">' + esc(sig.label) + '</span>';
        }).join('') + '</div>'
        : '<p class="muted">특별한 학습 주의 신호가 없습니다.</p>') +
      '</div>';
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
      field('메모', '<textarea name="memo">' + esc(s.memo) + '</textarea>', { wide: true }) +
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
    Promise.all([api('getStudent', [id]), api('getStudentLearningContext', [id]), loadLookups()]).then(function (pair) {
      var s = pair[0];
      var learningCtx = pair[1];
      state.cache.learningContext = learningCtx;
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
        learningContextHtml(learningCtx) +
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
    var chartMax = null;
    rows.forEach(function (l) {
      var r = rawScore(l);
      if (!r) return;
      if (chartMax === null) chartMax = r.max;
      else if (chartMax !== r.max) chartMax = false;
    });
    var tests = chartMax === false ? [] : rows.map(function (l) {
      var r = rawScore(l);
      if (!r) return null;
      var classAvg = l.class_test_average && l.class_test_average.comparable !== false &&
        l.class_test_average.test_count
        ? l.class_test_average.test_average
        : null;
      return {
        xLabel: shortDate(l.lesson_date),
        y: r.score,
        label: String(r.score),
        y2: classAvg,
        label2: classAvg == null ? '' : formatAverage(classAvg)
      };
    }).filter(Boolean);
    return '<div class="grid stats">' +
      stat('수업', stats.total_lessons) +
      stat('출석', stats.present_count) +
      stat('결석', stats.absent_count) +
      stat('테스트 평균', stats.test_average_display) +
    '</div>' +
    '<div class="grid chart-grid">' +
      '<div class="card"><h3 style="margin-top:0">테스트 점수 추이</h3>' +
        '<p class="muted">원점수 · 만점이 같은 실시 기록만 표시합니다. 주황은 학생 점수, 남색 점선은 그날 반 평균입니다.</p>' +
        svgLineChart(tests, {
          title: '테스트 점수 추이',
          yMax: chartMax || undefined,
          empty: chartMax === false ? '만점이 다른 테스트가 섞여 추이를 표시하지 않습니다.' : '실시된 테스트가 없습니다.'
        }) +
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

  function counselIssueChips(signals) {
    if (!signals || !signals.length) return '';
    return '<div class="field field-wide"><label>이번 달 학습 이슈 (선택)</label><div class="issue-chips">' +
      signals.map(function (sig) {
        return '<button type="button" class="chip issue-chip" data-label="' + esc(sig.label) + '">' +
          esc(sig.label) + '</button>';
      }).join('') + '</div></div>';
  }

  function showCounselForm(box, note) {
    var host = box.querySelector('.note-form');
    if (!host) return;
    var signals = (state.cache.learningContext && state.cache.learningContext.signals) || [];
    host.innerHTML = '<div class="row" style="margin-top:12px">' +
      field('상담일', input('counsel_date', note.counsel_date || state.today, 'date')) +
      field('제목', input('title', note.title || '')) +
      '</div>' +
      counselIssueChips(signals) +
      field('내용', '<textarea class="textarea-lg" name="content">' + esc(note.content) + '</textarea>', { wide: true }) +
      '<div class="row"><button class="btn save-note">저장</button>' +
      '<button class="btn secondary close-note">닫기</button></div>';
    host.querySelectorAll('.issue-chip').forEach(function (btn) {
      btn.onclick = function () {
        var textarea = host.querySelector('[name=content]');
        var label = btn.getAttribute('data-label');
        if (!textarea || !label) return;
        var line = '- ' + label;
        textarea.value = textarea.value ? (textarea.value + '\n' + line) : line;
        btn.classList.add('on');
      };
    });
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
      '<th>날짜</th><th>반</th><th>출석</th><th>테스트</th><th>난이도</th><th>과제 이행률</th><th>집중도</th><th>진도</th><th>과제 안내</th><th>학생 피드백</th>' +
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
      field('진도', '<textarea name="current_progress" placeholder="현재 진도">' + esc(c.current_progress) + '</textarea>', { wide: true }) +
      field('숙제', '<textarea name="class_homework" placeholder="반 공통 숙제">' + esc(c.class_homework) + '</textarea>', { wide: true }) +
      field('상태', select('status', ['운영', '종료'], c.status)) +
      field('메모', '<textarea name="memo">' + esc(c.memo) + '</textarea>', { wide: true }) +
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
        '<div><button class="btn secondary" id="open-plans">강의계획</button> <button class="btn secondary" id="edit-class">수정</button> <button class="btn danger" id="close-class">반 종료</button></div></div>' +
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
      document.getElementById('open-plans').onclick = function () {
        goToPlans(id, '주간', weekStartLocal(state.today));
      };
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
      var date = state.params.date || state.today;
      var classId = state.params.classId || '';
      var classPromise = classId
        ? Promise.resolve(classId)
        : resolveTodayClassId(date, '').then(function (picked) {
          return picked || ((state.cache.classes[0] || {}).class_id || '');
        });
      return classPromise.then(function (resolvedClassId) {
        classId = resolvedClassId;
        root.innerHTML = '<div class="card"><div class="row">' +
          field('날짜', input('date', date, 'date')) +
          field('반', select('class_id', classOptions(classId), classId)) +
          '<button class="btn" id="load-daily">보고서 생성</button></div></div>' +
          '<div id="daily-list"></div>';

        function paintEmpty(listDate, listClassId) {
          document.getElementById('daily-list').innerHTML =
            '<div class="card empty"><p style="margin:0 0 12px">해당 날짜의 수업 기록이 없습니다. 오늘의 수업에서 먼저 저장하세요.</p>' +
            '<button type="button" class="btn" id="daily-go-today">오늘의 수업으로 이동</button></div>';
          var jump = document.getElementById('daily-go-today');
          if (jump) jump.onclick = function () { goToToday(listDate, listClassId); };
        }

        function paintReports(res) {
          var rows = (res && res.reports) || [];
          var avg = res && res.class_test_average;
          var listDate = root.querySelector('[name=date]').value;
          var listClassId = root.querySelector('[name=class_id]').value;
          if (!rows.length) {
            paintEmpty(listDate, listClassId);
            return;
          }
          var summary = avg && avg.test_count
            ? '<div class="card"><div class="grid stats stats-4">' +
              stat('실시 테스트', avg.test_count) +
              stat('반 평균', avg.test_average_display) +
              stat('중간값', avg.test_median_display) +
              stat('최고/최저', avg.test_high_display + ' / ' + avg.test_low_display) +
              '</div><p class="muted" style="margin:10px 0 0">만점이 같은 실시 테스트의 원점수 통계입니다. 실시한 학생 보고서에 반 통계 한 줄이 포함됩니다.</p></div>'
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
        }

        function runGenerate(btn) {
          var listDate = root.querySelector('[name=date]').value;
          var cid = root.querySelector('[name=class_id]').value;
          if (!cid) return toast('반을 선택해 주세요.', true);
          var work = function () {
            return api('generateDailyReports', [listDate, cid]).then(paintReports);
          };
          if (btn) {
            withBusy(btn, work).catch(function (e) { toast(e.message, true); });
          } else {
            work().catch(function (e) { toast(e.message, true); });
          }
        }

        document.getElementById('load-daily').onclick = function () {
          runGenerate(document.getElementById('load-daily'));
        };

        if (state.params.date && state.params.classId) {
          runGenerate(null);
        }
      });
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

  function paintMonthlyReport(sid, y, m, res, opts) {
    opts = opts || {};
    var s = res.stats;
    var aiNote = opts.ai
      ? '<p class="muted" style="margin:0 0 8px">AI 분석 구간이 포함된 초안입니다. 저장 전 내용을 확인·수정해 주세요.</p>'
      : '';
    document.getElementById('monthly-body').innerHTML =
      '<div class="grid stats">' +
        stat('수업', s.total_lessons) + stat('출석', s.present_count) +
        stat('결석', s.absent_count) + stat('테스트 평균', s.test_average_display) +
        stat('중간값', s.test_median_display) +
        stat('최고', s.test_high_display) +
        stat('최저', s.test_low_display) +
      '</div>' +
      '<div class="card" style="margin-top:14px">' + aiNote +
      '<p>과제 A ' + s.assignment_A + ' · B ' + s.assignment_B + ' · C ' + s.assignment_C +
      ' / 집중도 A ' + s.concentration_A + ' B ' + s.concentration_B + ' C ' + s.concentration_C + ' D ' + s.concentration_D + '</p>' +
      '<p>진도: ' + esc(s.progress_summary || '-') + '</p>' +
      '<textarea id="monthly-text" class="preview">' + esc(res.text) + '</textarea>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn secondary" id="copy-m">복사</button>' +
      '<button class="btn secondary" id="pdf-m">PDF 저장</button>' +
      '<button class="btn" id="save-draft">임시 저장</button><button class="btn ok" id="save-final">확정</button></div></div>';
    document.getElementById('copy-m').onclick = function () { copyText(document.getElementById('monthly-text')); };
    document.getElementById('pdf-m').onclick = function () {
      var text = document.getElementById('monthly-text').value;
      if (!text.trim()) return toast('보고서 내용이 없습니다.', true);
      var btn = document.getElementById('pdf-m');
      btn.disabled = true;
      fetch('/api/monthly-report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: sid, year: Number(y), month: Number(m), report_text: text })
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) { throw new Error(j.error || 'PDF 생성 실패'); });
        }
        var dispo = r.headers.get('Content-Disposition') || '';
        var match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(dispo);
        var fname = match ? decodeURIComponent(match[1] || match[2]) : 'monthly-report.pdf';
        return r.blob().then(function (blob) { return { blob: blob, fname: fname }; });
      }).then(function (pair) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(pair.blob);
        a.download = pair.fname;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('PDF를 저장했습니다.');
      }).catch(function (e) { toast(e.message, true); })
        .finally(function () { btn.disabled = false; });
    };
    function save(status) {
      api('saveMonthlyReport', [{ student_id: sid, year: Number(y), month: Number(m), report_text: document.getElementById('monthly-text').value, status: status }])
        .then(function () {
          toast(status === '확정' ? '확정했습니다.' : '임시 저장했습니다.');
          var queue = document.getElementById('monthly-queue');
          if (queue) {
            var yearEl = document.querySelector('#main [name=year]');
            var monthEl = document.querySelector('#main [name=month]');
            if (yearEl && monthEl) {
              paintMonthlyQueue(document.getElementById('main'), yearEl.value, monthEl.value);
            }
          }
        })
        .catch(function (e) { toast(e.message, true); });
    }
    document.getElementById('save-draft').onclick = function () { save('임시'); };
    document.getElementById('save-final').onclick = function () { save('확정'); };
  }

  function monthlyStatusLabel(status) {
    if (status === '임시') return '임시';
    if (status === '확정') return '확정';
    return '없음';
  }

  function monthlyStatusBadge(status) {
    if (status === '확정') return '<span class="badge ok">확정</span>';
    if (status === '임시') return '<span class="badge warn">임시</span>';
    return '<span class="badge">없음</span>';
  }

  function paintMonthlyQueue(root, year, month) {
    var box = document.getElementById('monthly-queue');
    if (!box) return;
    box.innerHTML = '<div class="empty">현황을 불러오는 중...</div>';
    api('listMonthlyReportStatuses', [Number(year), Number(month)]).then(function (res) {
      var items = (res && res.items) || [];
      if (!items.length) {
        box.innerHTML = '<div class="empty">재원 학생이 없습니다.</div>';
        return;
      }
      box.innerHTML = '<table><thead><tr><th>학생</th><th>학년</th><th>상태</th><th></th></tr></thead><tbody>' +
        items.map(function (row) {
          var label = row.status === '없음' || row.status === 'none' || !row.status
            ? '없음'
            : monthlyStatusLabel(row.status);
          var badgeStatus = label === '없음' ? 'none' : row.status;
          var actionLabel = label === '없음' ? '생성' : '수정';
          return '<tr>' +
            '<td>' + esc(row.student_name) + '</td>' +
            '<td>' + esc(row.grade) + '</td>' +
            '<td>' + monthlyStatusBadge(badgeStatus === 'none' ? '' : badgeStatus) + '</td>' +
            '<td><button type="button" class="btn secondary monthly-queue-open" data-student="' +
              esc(row.student_id) + '">' + actionLabel + '</button></td></tr>';
        }).join('') + '</tbody></table>';
      box.querySelectorAll('.monthly-queue-open').forEach(function (btn) {
        btn.onclick = function () {
          var sid = btn.getAttribute('data-student');
          var sel = root.querySelector('[name=student_id]');
          if (sel) sel.value = sid;
          document.getElementById('gen-m').click();
        };
      });
    }).catch(function (e) {
      box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
  }

  function renderMonthly(root) {
    spinner(root);
    loadLookups().then(function () {
      var now = state.today.split('-');
      root.innerHTML = '<div class="card"><div class="row">' +
        field('학생', select('student_id', studentOptions(''), '')) +
        field('연도', input('year', now[0], 'number')) +
        field('월', input('month', String(Number(now[1])), 'number', 'min="1" max="12"')) +
        '<button class="btn secondary" id="gen-m">기본 보고서</button>' +
        '<button class="btn" id="gen-m-ai">AI 분석 포함</button>' +
        '<button class="btn ghost" id="refresh-monthly-queue">현황 새로고침</button></div>' +
        '<p class="muted" style="margin:10px 0 0">AI 분석은 서버에 설정된 API 키(OpenAI 호환)로 생성됩니다. PDF는 아래 미리보기에서 저장할 수 있습니다.</p></div>' +
        '<div class="card" style="margin-top:14px"><div class="toolbar"><h3 style="margin:0">월간 보고서 현황</h3>' +
          '<span class="muted" id="monthly-queue-label"></span></div>' +
          '<div id="monthly-queue"></div></div>' +
        '<div id="monthly-body"></div>';
      function params() {
        return {
          sid: root.querySelector('[name=student_id]').value,
          y: root.querySelector('[name=year]').value,
          m: root.querySelector('[name=month]').value
        };
      }
      function refreshQueue() {
        var p = params();
        var label = document.getElementById('monthly-queue-label');
        if (label) label.textContent = p.y + '년 ' + p.m + '월';
        paintMonthlyQueue(root, p.y, p.m);
      }
      document.getElementById('gen-m').onclick = function () {
        var p = params();
        if (!p.sid) return toast('학생을 선택해 주세요.', true);
        var btn = document.getElementById('gen-m');
        btn.disabled = true;
        api('generateMonthlyReport', [p.sid, Number(p.y), Number(p.m)]).then(function (res) {
          paintMonthlyReport(p.sid, p.y, p.m, res, { ai: false });
          refreshQueue();
        }).catch(function (e) { toast(e.message, true); })
          .finally(function () { btn.disabled = false; });
      };
      document.getElementById('gen-m-ai').onclick = function () {
        var p = params();
        if (!p.sid) return toast('학생을 선택해 주세요.', true);
        var btn = document.getElementById('gen-m-ai');
        btn.disabled = true;
        toast('AI 분석을 생성하는 중입니다…');
        fetch('/api/generateMonthlyReportAi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student_id: p.sid, year: Number(p.y), month: Number(p.m) })
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (!j.ok) throw new Error(j.error || 'AI 보고서 생성 실패');
          paintMonthlyReport(p.sid, p.y, p.m, j.data, { ai: true });
          refreshQueue();
        }).catch(function (e) { toast(e.message, true); })
          .finally(function () { btn.disabled = false; });
      };
      document.getElementById('refresh-monthly-queue').onclick = refreshQueue;
      root.querySelector('[name=year]').onchange = refreshQueue;
      root.querySelector('[name=month]').onchange = refreshQueue;
      refreshQueue();
    }).catch(fail(root));
  }

  function monthBounds(iso) {
    var parts = String(iso || state.today).split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var last = new Date(y, m, 0).getDate();
    return {
      start: y + '-' + pad2(m) + '-01',
      end: y + '-' + pad2(m) + '-' + pad2(last)
    };
  }

  function renderCounseling(root) {
    spinner(root);
    loadLookups().then(function () {
      var bounds = monthBounds(state.today);
      root.innerHTML =
        '<div class="card"><div class="row">' +
          field('시작', input('start', bounds.start, 'date')) +
          field('끝', input('end', bounds.end, 'date')) +
          field('종류', select('kind', [
            { value: '', label: '전체' },
            { value: '학생', label: '학생' },
            { value: '학부모', label: '학부모' }
          ], '')) +
          field('검색', input('query', '')) +
          '<button type="button" class="btn" id="load-counseling">조회</button>' +
        '</div></div>' +
        '<div id="counseling-list"></div>';
      function load() {
        var filter = {
          start: root.querySelector('[name=start]').value,
          end: root.querySelector('[name=end]').value,
          kind: root.querySelector('[name=kind]').value,
          query: root.querySelector('[name=query]').value
        };
        var list = document.getElementById('counseling-list');
        list.innerHTML = '<div class="card empty">불러오는 중...</div>';
        api('listCounselingNotes', [filter]).then(function (rows) {
          rows = rows || [];
          if (!rows.length) {
            list.innerHTML = '<div class="card empty">조건에 맞는 상담일지가 없습니다.</div>';
            return;
          }
          list.innerHTML = '<div class="card"><table><thead><tr><th>날짜</th><th>종류</th><th>학생</th><th>제목</th><th></th></tr></thead><tbody>' +
            rows.map(function (n) {
              return '<tr class="counsel-row" data-student="' + esc(n.student_id) + '" style="cursor:pointer">' +
                '<td>' + esc(n.counsel_date) + '</td>' +
                '<td>' + esc(n.kind) + '</td>' +
                '<td>' + esc(n.student_name) + ' <span class="muted">' + esc(n.grade) + '</span></td>' +
                '<td>' + esc(n.title || '상담') + '</td>' +
                '<td><button type="button" class="btn ghost counsel-open" data-student="' +
                  esc(n.student_id) + '">학생 상세</button></td></tr>';
            }).join('') + '</tbody></table></div>';
          list.querySelectorAll('.counsel-row, .counsel-open').forEach(function (el) {
            el.onclick = function (e) {
              e.preventDefault();
              var sid = el.getAttribute('data-student');
              if (sid) go('students/' + sid);
            };
          });
        }).catch(function (e) {
          list.innerHTML = '<div class="card empty">' + esc(e.message) + '</div>';
        });
      }
      document.getElementById('load-counseling').onclick = load;
      load();
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

  function planPreviewText(plan) {
    if (!plan) return '';
    var bits = [];
    if (plan.title) bits.push(plan.title);
    if (plan.objectives) bits.push(plan.objectives);
    if (plan.content) bits.push(plan.content);
    return bits.join('\n').trim();
  }

  function renderPlans(root) {
    spinner(root);
    loadLookups().then(function () {
      var classId = state.params.classId || ((state.cache.classes[0] || {}).class_id || '');
      var periodType = state.params.periodType || '일간';
      if (PLAN_PERIODS.indexOf(periodType) === -1) periodType = '일간';
      var periodKey = state.params.periodKey || planAnchorForType(periodType, state.today);
      if (periodType === '주간' && /^\d{4}-\d{2}-\d{2}$/.test(periodKey)) {
        periodKey = weekStartLocal(periodKey);
      }
      if (periodType === '월간' && /^\d{4}-\d{2}-\d{2}$/.test(periodKey)) {
        periodKey = periodKey.slice(0, 7);
      }

      function paint(plan, list) {
        plan = plan || {
          class_id: classId,
          period_type: periodType,
          period_key: periodKey,
          title: '',
          objectives: '',
          content: '',
          materials: '',
          homework: '',
          memo: ''
        };
        var periodLabel = plan.period_label || periodKey;
        var dateField = periodType === '월간'
          ? field('연월', input('period_key', periodKey, 'month'))
          : field(periodType === '주간' ? '기준일(해당 주)' : '날짜', input('period_key', periodKey, 'date'));
        root.innerHTML =
          '<div class="card"><div class="toolbar"><h3 style="margin:0">강의 계획</h3>' +
            '<span class="muted">반별로 일간·주간·월간 계획을 저장하고 수시로 수정합니다.</span></div>' +
            '<div class="row">' +
              field('반', select('class_id', classOptions(classId), classId)) +
              field('기간', '<div class="seg" id="plan-period-seg">' + PLAN_PERIODS.map(function (p) {
                return '<button type="button" class="chip' + (p === periodType ? ' on' : '') + '" data-value="' + esc(p) + '">' + esc(p) + '</button>';
              }).join('') + '</div>') +
              dateField +
            '</div>' +
            '<div class="cal-toolbar" style="margin-top:8px">' +
              '<button type="button" class="btn secondary" id="plan-prev">이전</button>' +
              '<button type="button" class="btn secondary" id="plan-today">오늘 기준</button>' +
              '<button type="button" class="btn secondary" id="plan-next">다음</button>' +
              '<h3 class="display" style="font-size:18px">' + esc(periodLabel) + '</h3>' +
            '</div></div>' +
          '<div class="card" id="plan-editor">' +
            '<div class="toolbar"><h3 style="margin:0">' + (plan.plan_id ? '계획 수정' : '새 계획') + '</h3>' +
              (plan.updated_at ? '<span class="muted">최근 수정 ' + esc(plan.updated_at) + '</span>' : '') +
            '</div>' +
            '<div class="row">' +
              field('제목', input('title', plan.title || '', 'text', 'placeholder="예: 이차방정식 도입"'), { wide: true }) +
              field('학습 목표', '<textarea name="objectives" class="textarea-lg" placeholder="이번 기간에 도달할 목표">' + esc(plan.objectives || '') + '</textarea>', { wide: true }) +
              field('수업 내용', '<textarea name="content" class="textarea-lg" placeholder="진도 · 활동 · 평가 계획">' + esc(plan.content || '') + '</textarea>', { wide: true }) +
              field('교재·자료', '<textarea name="materials" placeholder="교재 범위, 유인물, 준비물">' + esc(plan.materials || '') + '</textarea>', { wide: true }) +
              field('예정 숙제', '<textarea name="homework" placeholder="내줄 숙제">' + esc(plan.homework || '') + '</textarea>', { wide: true }) +
              field('메모', '<textarea name="memo" placeholder="강사 메모">' + esc(plan.memo || '') + '</textarea>', { wide: true }) +
            '</div>' +
            '<div class="toolbar">' +
              '<button type="button" class="btn" id="save-plan">저장</button>' +
              (plan.plan_id ? '<button type="button" class="btn danger" id="delete-plan">삭제</button>' : '') +
            '</div>' +
          '</div>' +
          '<div class="card"><div class="toolbar"><h3 style="margin:0">같은 반 · ' + esc(periodType) + ' 최근 계획</h3></div>' +
            (list && list.length
              ? '<ul class="task-list">' + list.map(function (row) {
                var preview = planPreviewText(row).slice(0, 80);
                return '<li class="task-item"><div class="agenda-main">' +
                  '<div class="agenda-title-row"><strong>' + esc(row.period_label || row.period_key) + '</strong>' +
                  (row.title ? ' · ' + esc(row.title) : '') + '</div>' +
                  (preview ? '<div class="muted agenda-meta">' + esc(preview) + (planPreviewText(row).length > 80 ? '…' : '') + '</div>' : '') +
                  '</div><div class="agenda-actions">' +
                  '<button type="button" class="btn ghost plan-open" data-key="' + esc(row.period_key) + '">열기</button>' +
                  '</div></li>';
              }).join('') + '</ul>'
              : '<div class="empty">아직 저장된 계획이 없습니다.</div>') +
          '</div>';

        function currentType() {
          var on = root.querySelector('#plan-period-seg .chip.on');
          return on ? on.getAttribute('data-value') : periodType;
        }

        function navigateTo(nextClass, nextType, nextKey) {
          goToPlans(nextClass, nextType, nextKey);
        }

        root.querySelector('[name=class_id]').onchange = function () {
          navigateTo(this.value, currentType(), root.querySelector('[name=period_key]').value);
        };
        root.querySelector('#plan-period-seg').onclick = function (e) {
          var btn = e.target.closest('.chip');
          if (!btn) return;
          var nextType = btn.getAttribute('data-value');
          var anchor = root.querySelector('[name=period_key]').value || state.today;
          if (nextType === '월간' && /^\d{4}-\d{2}-\d{2}$/.test(anchor)) anchor = anchor.slice(0, 7);
          if (nextType !== '월간' && /^\d{4}-\d{2}$/.test(anchor)) anchor = anchor + '-01';
          navigateTo(root.querySelector('[name=class_id]').value, nextType, planAnchorForType(nextType, anchor));
        };
        root.querySelector('[name=period_key]').onchange = function () {
          navigateTo(root.querySelector('[name=class_id]').value, currentType(), this.value);
        };
        document.getElementById('plan-prev').onclick = function () {
          var key = root.querySelector('[name=period_key]').value;
          var next = periodType === '월간' ? shiftMonthLocal(key, -1)
            : periodType === '주간' ? addDaysLocal(weekStartLocal(key), -7)
            : addDaysLocal(key, -1);
          navigateTo(classId, periodType, next);
        };
        document.getElementById('plan-next').onclick = function () {
          var key = root.querySelector('[name=period_key]').value;
          var next = periodType === '월간' ? shiftMonthLocal(key, 1)
            : periodType === '주간' ? addDaysLocal(weekStartLocal(key), 7)
            : addDaysLocal(key, 1);
          navigateTo(classId, periodType, next);
        };
        document.getElementById('plan-today').onclick = function () {
          navigateTo(classId, periodType, planAnchorForType(periodType, state.today));
        };
        root.querySelectorAll('.plan-open').forEach(function (btn) {
          btn.onclick = function () {
            navigateTo(classId, periodType, btn.getAttribute('data-key'));
          };
        });
        document.getElementById('save-plan').onclick = function () {
          var btn = this;
          var editor = document.getElementById('plan-editor');
          var payload = {
            plan_id: plan.plan_id || '',
            class_id: root.querySelector('[name=class_id]').value,
            period_type: currentType(),
            period_key: root.querySelector('[name=period_key]').value,
            title: editor.querySelector('[name=title]').value,
            objectives: editor.querySelector('[name=objectives]').value,
            content: editor.querySelector('[name=content]').value,
            materials: editor.querySelector('[name=materials]').value,
            homework: editor.querySelector('[name=homework]').value,
            memo: editor.querySelector('[name=memo]').value
          };
          if (!payload.class_id) return toast('반을 선택해 주세요.', true);
          withBusy(btn, function () {
            return api('saveClassPlan', [payload]).then(function (saved) {
              toast('강의 계획을 저장했습니다.');
              navigateTo(saved.class_id, saved.period_type, saved.period_key);
            });
          }).catch(function (e) { toast(e.message, true); });
        };
        var del = document.getElementById('delete-plan');
        if (del) {
          del.onclick = function () {
            if (!plan.plan_id) return;
            if (!confirm('이 강의 계획을 삭제할까요?')) return;
            api('deleteClassPlan', [plan.plan_id]).then(function () {
              toast('삭제했습니다.');
              navigateTo(classId, periodType, periodKey);
            }).catch(function (e) { toast(e.message, true); });
          };
        }
      }

      if (!classId) {
        root.innerHTML = '<div class="card empty">운영 중인 반이 없습니다. 반관리에서 먼저 등록해 주세요.</div>';
        return;
      }

      Promise.all([
        api('getClassPlan', [classId, periodType, periodKey]),
        api('getClassPlans', [{ class_id: classId, period_type: periodType }])
      ]).then(function (pair) {
        paint(pair[0], pair[1] || []);
      }).catch(fail(root));
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
      return field(k[1], area ? '<textarea name="' + k[0] + '">' + esc(s[k[0]]) + '</textarea>' : input(k[0], s[k[0]]), area ? { wide: true } : null);
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
    setDrawer(false);
    if (parsed.route === 'students' && parsed.params.id) return renderStudentDetail(root, parsed.params.id);
    if (parsed.route === 'classes' && parsed.params.id) return renderClassDetail(root, parsed.params.id);
    var map = {
      dashboard: renderDashboard,
      today: renderToday,
      students: renderStudents,
      classes: renderClasses,
      plans: renderPlans,
      counseling: renderCounseling,
      daily: renderDaily,
      monthly: renderMonthly,
      stats: renderStats,
      settings: renderSettings
    };
    (map[parsed.route] || renderDashboard)(root);
  }

  document.getElementById('menu-btn').onclick = function () {
    var open = document.getElementById('menu-btn').getAttribute('aria-expanded') === 'true';
    setDrawer(!open);
  };
  document.getElementById('nav-backdrop').onclick = function () { setDrawer(false); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setDrawer(false);
  });
  window.addEventListener('resize', function () {
    if (!window.matchMedia('(max-width: 980px)').matches) setDrawer(false);
  });
  document.getElementById('logout-btn').onclick = function () {
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).finally(function () {
      location.href = '/login';
    });
  };

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