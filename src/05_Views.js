/**
 * Read models for the class and student workspaces (React screens).
 * Built on the service internals passed in by LMS.createService.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

LMS.createViews = function (ctx) {
  var table = ctx.table;
  var store = ctx.store;

  function pct(done, total) {
    return total ? Math.round((done / total) * 100) : null;
  }

  function classRow(classId) {
    var cls = ctx.requireClass(classId);
    var schedule = LMS.classSchedule(cls);
    return Object.assign({}, cls, {
      schedule: schedule,
      schedule_label: LMS.scheduleLabel(schedule),
      class_type: LMS.toStr(cls.class_type) || '정규'
    });
  }

  function classLessons(classId, start, end) {
    return table('Lessons').filter(function (row) {
      return LMS.toStr(row.class_id) === LMS.toStr(classId) && LMS.inRange(row.lesson_date, start, end);
    });
  }

  function homeworkByDate(classId, start, end) {
    var items = table('HomeworkItems').filter(function (row) {
      return LMS.toStr(row.class_id) === LMS.toStr(classId) && LMS.inRange(row.lesson_date, start, end);
    });
    var checks = table('HomeworkChecks');
    var checkByKey = {};
    checks.forEach(function (c) { checkByKey[LMS.toStr(c.item_id) + '|' + LMS.toStr(c.student_id)] = c; });
    var byDate = {};
    items.forEach(function (it) {
      var d = LMS.toStr(it.lesson_date);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(it);
    });
    Object.keys(byDate).forEach(function (d) {
      byDate[d].sort(function (a, b) { return Number(a.sort_order || 0) - Number(b.sort_order || 0); });
    });
    return { byDate: byDate, checkByKey: checkByKey };
  }

  function nextMeeting(cls, fromDate) {
    var periods = ctx.examPeriods();
    var cur = fromDate;
    for (var i = 0; i < 60; i++) {
      if (LMS.classMeetsOnDate(cls, cur, periods)) {
        return { date: cur, time: LMS.classTimeOn(cls, cur) };
      }
      cur = LMS.addDays(cur, 1);
    }
    return null;
  }

  function examContext(cls, date) {
    var periods = ctx.examPeriods();
    if (LMS.toStr(cls.class_type) === '시험대비') {
      return { kind: 'exam_class', period: LMS.findById(periods, 'exam_period_id', cls.exam_period_id) };
    }
    var active = LMS.classSuspensionOn(cls, date, periods);
    if (active) return { kind: 'suspended', period: active };
    var upcoming = periods.filter(function (p) {
      return LMS.examPeriodActive(p) && LMS.toStr(p.start_date) > date &&
        LMS.suspendedClassIds(p).indexOf(LMS.toStr(cls.class_id)) !== -1;
    }).sort(function (a, b) { return LMS.toStr(a.start_date).localeCompare(LMS.toStr(b.start_date)); })[0];
    return upcoming ? { kind: 'upcoming', period: upcoming } : null;
  }

  /** Class list with today's roster size and next meeting. */
  function getClassList(filter) {
    filter = filter || {};
    var today = store.today();
    var type = LMS.toStr(filter.class_type);
    return table('Classes').filter(function (c) {
      if (type && (LMS.toStr(c.class_type) || '정규') !== type) return false;
      if (filter.status && LMS.toStr(c.status) !== filter.status) return false;
      return true;
    }).map(function (c) {
      var schedule = LMS.classSchedule(c);
      var roster = ctx.rosterOn(c.class_id, today);
      return {
        class_id: c.class_id,
        class_name: c.class_name,
        grade: c.grade,
        teacher: c.teacher,
        textbook: c.textbook,
        current_progress: c.current_progress,
        status: c.status,
        class_type: LMS.toStr(c.class_type) || '정규',
        exam_period_id: LMS.toStr(c.exam_period_id),
        schedule: schedule,
        schedule_label: LMS.scheduleLabel(schedule),
        student_count: roster.length,
        next: LMS.toStr(c.status) === '운영' ? nextMeeting(c, today) : null,
        exam: examContext(c, today)
      };
    }).sort(function (a, b) {
      if (a.status !== b.status) return a.status === '운영' ? -1 : 1;
      return LMS.toStr(a.class_name).localeCompare(LMS.toStr(b.class_name), 'ko');
    });
  }

  function sessionSummary(classId, date, roster) {
    var session = ctx.getClassSession(date, classId);
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.class_id) === LMS.toStr(classId) && LMS.toStr(l.lesson_date) === date;
    });
    var absent = lessons.filter(function (l) { return LMS.toStr(l.attendance) === '결석'; }).length;
    return {
      date: date,
      progress: session.progress,
      content: session.content,
      test_title: session.test_title,
      test_max_score: session.test_max_score,
      test_difficulty: session.test_difficulty,
      class_notice: session.class_notice,
      recorded_count: lessons.length,
      present_count: lessons.length - absent,
      absent_count: absent,
      roster_count: roster.length
    };
  }

  /** Header + overview tab data. */
  function getClassOverview(classId) {
    var cls = classRow(classId);
    var today = store.today();
    var roster = ctx.rosterOn(classId, today);
    var monthStart = today.slice(0, 8) + '01';
    var lessons = classLessons(classId, monthStart, today);
    var absent = lessons.filter(function (l) { return LMS.toStr(l.attendance) === '결석'; }).length;
    var collected = LMS.collectRawScoresForStats(lessons);
    var scores = LMS.computeScoreStats(collected.comparable ? collected.scores : []);

    var hw = homeworkByDate(classId, monthStart, today);
    var done = 0;
    var total = 0;
    Object.keys(hw.byDate).forEach(function (d) {
      hw.byDate[d].forEach(function (it) {
        roster.forEach(function (s) {
          var c = hw.checkByKey[LMS.toStr(it.item_id) + '|' + LMS.toStr(s.student_id)];
          if (!c) return;
          total += 1;
          if (LMS.toStr(c.status) === '완료') done += 1;
        });
      });
    });

    var sessionDates = {};
    table('ClassSessions').forEach(function (r) {
      if (LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.toStr(r.lesson_date) <= today) sessionDates[r.lesson_date] = true;
    });
    classLessons(classId, '', today).forEach(function (l) { sessionDates[l.lesson_date] = true; });
    var recent = Object.keys(sessionDates).sort().reverse().slice(0, 3).map(function (d) {
      return sessionSummary(classId, d, roster);
    });

    var week = LMS.weekRange(today);
    return {
      class: cls,
      today: today,
      roster: roster.map(function (s) {
        return { student_id: s.student_id, name: s.name, grade: s.grade, school: s.school, status: s.status };
      }),
      next: LMS.toStr(cls.status) === '운영' ? nextMeeting(cls, today) : null,
      exam: examContext(cls, today),
      month: {
        lesson_count: Object.keys(lessons.reduce(function (m, l) { m[l.lesson_date] = 1; return m; }, {})).length,
        attendance_rate: pct(lessons.length - absent, lessons.length),
        homework_rate: pct(done, total),
        test_average: scores.average,
        test_average_display: collected.comparable ? scores.average_display : '-'
      },
      recent: recent,
      plans: {
        week: ctx.getClassPlan(classId, '주간', week.start),
        month: ctx.getClassPlan(classId, '월간', today.slice(0, 7))
      }
    };
  }

  /** Meeting dates (scheduled or recorded) with session data and the matching daily plan. */
  function getClassProgressLog(classId, range) {
    var cls = classRow(classId);
    range = range || {};
    var today = store.today();
    var end = LMS.toStr(range.end) || today;
    var start = LMS.toStr(range.start) || LMS.addDays(end, -90);
    var dates = {};
    // Scheduled-but-unrecorded dates only count from when the class existed (or its first record).
    var floor = LMS.toStr(cls.created_at).slice(0, 10);
    classLessons(classId, '', end).forEach(function (l) {
      if (!floor || LMS.toStr(l.lesson_date) < floor) floor = LMS.toStr(l.lesson_date);
    });
    LMS.classMeetingDatesFor(cls, floor && floor > start ? floor : start, end, ctx.examPeriods()).forEach(function (d) { dates[d] = 'scheduled'; });
    table('ClassSessions').forEach(function (r) {
      if (LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.inRange(r.lesson_date, start, end)) dates[r.lesson_date] = 'recorded';
    });
    classLessons(classId, start, end).forEach(function (l) { dates[l.lesson_date] = 'recorded'; });
    var plans = ctx.getClassPlans({ class_id: classId, period_type: '일간', start: start, end: end });
    var planByDate = {};
    plans.forEach(function (p) { planByDate[p.period_key] = p; });
    return {
      class: cls,
      start: start,
      end: end,
      rows: Object.keys(dates).sort().reverse().map(function (d) {
        var roster = ctx.rosterOn(classId, d);
        var summary = sessionSummary(classId, d, roster);
        var plan = planByDate[d];
        return Object.assign(summary, {
          weekday: LMS.weekdayName(d),
          time: LMS.classTimeOn(cls, d),
          has_record: summary.recorded_count > 0 || !!(summary.progress || summary.content || summary.test_title),
          plan: plan ? { plan_id: plan.plan_id, title: plan.title, content: plan.content, objectives: plan.objectives } : null
        });
      })
    };
  }

  /** Homework items per lesson date x student completion. */
  function getClassHomeworkLog(classId, range) {
    classRow(classId);
    range = range || {};
    var today = store.today();
    var end = LMS.toStr(range.end) || today;
    var start = LMS.toStr(range.start) || LMS.addDays(end, -42);
    var hw = homeworkByDate(classId, start, end);
    var students = {};
    ctx.rosterOn(classId, end).forEach(function (s) { students[s.student_id] = s; });
    var allStudents = table('Students');
    var rows = Object.keys(hw.byDate).sort().reverse().map(function (d) {
      var items = hw.byDate[d];
      var roster = ctx.rosterOn(classId, d);
      roster.forEach(function (s) { if (!students[s.student_id]) students[s.student_id] = s; });
      var cells = {};
      var done = 0;
      var total = 0;
      roster.forEach(function (s) {
        var cell = { done: 0, total: items.length, checked: 0, missing: [] };
        items.forEach(function (it) {
          var c = hw.checkByKey[LMS.toStr(it.item_id) + '|' + LMS.toStr(s.student_id)];
          if (c) cell.checked += 1;
          if (c && LMS.toStr(c.status) === '완료') cell.done += 1;
          else if (c) cell.missing.push(it.title);
        });
        cells[s.student_id] = cell;
        if (cell.checked) {
          done += cell.done;
          total += cell.total;
        }
      });
      return {
        date: d,
        weekday: LMS.weekdayName(d),
        items: items.map(function (it) { return { item_id: it.item_id, title: it.title }; }),
        cells: cells,
        checked: total > 0,
        rate: pct(done, total)
      };
    });
    return {
      start: start,
      end: end,
      students: Object.keys(students).map(function (id) {
        var s = students[id] || LMS.findById(allStudents, 'student_id', id);
        return { student_id: id, name: s ? s.name : id };
      }).sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); }),
      rows: rows
    };
  }

  function testRowsFor(classId, date) {
    return table('Lessons').filter(function (l) {
      return LMS.toStr(l.class_id) === LMS.toStr(classId) && LMS.toStr(l.lesson_date) === date;
    });
  }

  /** One row per lesson date where a test was given. */
  function getClassTests(classId, range) {
    classRow(classId);
    range = range || {};
    var today = store.today();
    var end = LMS.toStr(range.end) || today;
    var start = LMS.toStr(range.start) || LMS.addDays(end, -180);
    var dates = {};
    classLessons(classId, start, end).forEach(function (l) {
      if (LMS.toStr(l.test_status) === '실시') dates[l.lesson_date] = true;
    });
    return {
      start: start,
      end: end,
      rows: Object.keys(dates).sort().reverse().map(function (d) {
        var session = ctx.getClassSession(d, classId);
        var lessons = testRowsFor(classId, d);
        var taken = lessons.filter(function (l) { return LMS.toStr(l.test_status) === '실시'; });
        var scores = taken.map(function (l) { return LMS.toNum(l.test_score); }).filter(function (n) { return n !== null; });
        var stats = LMS.computeScoreStats(scores);
        return {
          date: d,
          weekday: LMS.weekdayName(d),
          title: session.test_title,
          max_score: session.test_max_score || LMS.modeValue(taken.map(function (l) { return LMS.toStr(l.test_max_score); })),
          difficulty: session.test_difficulty,
          taken_count: taken.length,
          not_taken_count: lessons.length - taken.length,
          average: stats.average,
          high: stats.high,
          low: stats.low
        };
      })
    };
  }

  function getClassTestDetail(classId, date) {
    classRow(classId);
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var session = ctx.getClassSession(date, classId);
    var students = table('Students');
    var lessons = testRowsFor(classId, date);
    var rows = lessons.map(function (l) {
      var s = LMS.findById(students, 'student_id', l.student_id);
      return {
        student_id: l.student_id,
        name: s ? s.name : l.student_id,
        attendance: l.attendance,
        test_status: l.test_status,
        score: LMS.toStr(l.test_status) === '실시' ? LMS.toNum(l.test_score) : null,
        max_score: LMS.toNum(l.test_max_score)
      };
    }).sort(function (a, b) {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      return (b.score || 0) - (a.score || 0) || LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko');
    });
    var scores = rows.map(function (r) { return r.score; }).filter(function (n) { return n !== null; });
    return {
      date: date,
      session: session,
      stats: LMS.computeScoreStats(scores),
      rows: rows
    };
  }

  /** Month-by-month attendance / homework / test averages for the stats tab. */
  function getClassTrend(classId, months) {
    classRow(classId);
    months = Math.min(Math.max(Number(months) || 6, 1), 12);
    var today = store.today();
    var y = Number(today.slice(0, 4));
    var m = Number(today.slice(5, 7));
    var out = [];
    for (var i = months - 1; i >= 0; i--) {
      var mm = m - i;
      var yy = y;
      while (mm < 1) { mm += 12; yy -= 1; }
      var range = LMS.monthRange(yy, mm);
      var lessons = classLessons(classId, range.start, range.end);
      var absent = lessons.filter(function (l) { return LMS.toStr(l.attendance) === '결석'; }).length;
      var collected = LMS.collectRawScoresForStats(lessons);
      var scores = LMS.computeScoreStats(collected.comparable ? collected.scores : []);
      var hw = homeworkByDate(classId, range.start, range.end);
      var done = 0;
      var total = 0;
      Object.keys(hw.byDate).forEach(function (d) {
        hw.byDate[d].forEach(function (it) {
          Object.keys(hw.checkByKey).forEach(function (key) {
            if (key.indexOf(LMS.toStr(it.item_id) + '|') !== 0) return;
            total += 1;
            if (LMS.toStr(hw.checkByKey[key].status) === '완료') done += 1;
          });
        });
      });
      var assignTotal = 0;
      var assignA = 0;
      lessons.forEach(function (l) {
        var code = LMS.assignmentCode(l.assignment_completion);
        if (!code) return;
        assignTotal += 1;
        if (code === 'A') assignA += 1;
      });
      out.push({
        year: yy,
        month: mm,
        label: mm + '월',
        lesson_days: Object.keys(lessons.reduce(function (acc, l) { acc[l.lesson_date] = 1; return acc; }, {})).length,
        attendance_rate: pct(lessons.length - absent, lessons.length),
        homework_rate: pct(done, total),
        assignment_a_rate: pct(assignA, assignTotal),
        test_average: scores.average,
        test_comparable: collected.comparable
      });
    }
    return { months: out };
  }

  /** Roster with relation rows for the students tab (current and past). */
  function getClassMembers(classId) {
    classRow(classId);
    var today = store.today();
    var students = table('Students');
    var classes = table('Classes');
    var rels = table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.class_id) === LMS.toStr(classId);
    });
    var rows = rels.map(function (r) {
      var s = LMS.findById(students, 'student_id', r.student_id) || {};
      var source = r.source_class_id ? LMS.findById(classes, 'class_id', r.source_class_id) : null;
      return {
        rel_id: r.id,
        student_id: r.student_id,
        name: s.name || r.student_id,
        grade: s.grade || '',
        school: s.school || '',
        student_status: s.status || '',
        parent_phone: s.parent_phone || '',
        start_date: r.start_date,
        end_date: r.end_date,
        rel_status: r.status,
        assignment_type: LMS.toStr(r.assignment_type) || '정규',
        source_class_name: source ? source.class_name : '',
        active: LMS.relActiveOn(r, today) && LMS.toStr(s.status) !== '퇴원'
      };
    });
    // Students of this class temporarily moved elsewhere today.
    var away = table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.source_class_id) === LMS.toStr(classId) && LMS.toStr(r.status) === '임시' && LMS.relActiveOn(r, today);
    }).map(function (r) {
      var cls = LMS.findById(classes, 'class_id', r.class_id);
      return { student_id: r.student_id, class_id: r.class_id, class_name: cls ? cls.class_name : '', end_date: r.end_date };
    });
    var awayById = {};
    away.forEach(function (a) { awayById[a.student_id] = a; });
    rows.forEach(function (r) { r.away = awayById[r.student_id] || null; });
    var sorter = function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); };
    return {
      current: rows.filter(function (r) { return r.active; }).sort(sorter),
      past: rows.filter(function (r) { return !r.active; }).sort(function (a, b) {
        return LMS.toStr(b.end_date || b.start_date).localeCompare(LMS.toStr(a.end_date || a.start_date));
      })
    };
  }

  return {
    getClassList: getClassList,
    getClassOverview: getClassOverview,
    getClassProgressLog: getClassProgressLog,
    getClassHomeworkLog: getClassHomeworkLog,
    getClassTests: getClassTests,
    getClassTestDetail: getClassTestDetail,
    getClassTrend: getClassTrend,
    getClassMembers: getClassMembers
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
