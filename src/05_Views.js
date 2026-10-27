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
    if (active) {
      var last = LMS.classResumeDate(active, LMS.toStr(cls.class_id)) || active.end_date;
      return { kind: 'suspended', period: active, resume_date: LMS.addDays(last, 1) };
    }
    var upcoming = periods.filter(function (p) {
      return LMS.examPeriodActive(p) && LMS.toStr(p.start_date) > date &&
        LMS.suspendedClassIds(p).indexOf(LMS.toStr(cls.class_id)) !== -1;
    }).sort(function (a, b) { return LMS.toStr(a.start_date).localeCompare(LMS.toStr(b.start_date)); })[0];
    if (!upcoming) return null;
    var upLast = LMS.classResumeDate(upcoming, LMS.toStr(cls.class_id)) || upcoming.end_date;
    return { kind: 'upcoming', period: upcoming, resume_date: LMS.addDays(upLast, 1) };
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
      var roster = ctx.assignments.members(c.class_id, today);
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
    var roster = ctx.assignments.recordTargets(classId, today).students;
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
    var upcoming = LMS.toStr(cls.status) === '운영' ? nextMeeting(cls, today) : null;
    return {
      exams: upcomingExamsFor(roster, 60),
      class: cls,
      today: today,
      roster: roster.map(function (s) {
        return { student_id: s.student_id, name: s.name, grade: s.grade, school: s.school, status: s.status };
      }),
      next: upcoming,
      exam: examContext(cls, today),
      month: {
        lesson_count: Object.keys(lessons.reduce(function (m, l) { m[l.lesson_date] = 1; return m; }, {})).length,
        attendance_rate: pct(lessons.length - absent, lessons.length),
        homework_rate: pct(done, total),
        test_average: scores.average,
        test_average_display: collected.comparable ? scores.average_display : '-'
      },
      recent: recent,
      current_unit: ctx.currentUnit ? ctx.currentUnit(classId) : null,
      plans: {
        next_day: upcoming ? ctx.getClassPlan(classId, '일간', upcoming.date) : null,
        // Weeks are summaries of their day plans; an old hand-written week plan still wins.
        week: ctx.getClassPlan(classId, '주간', week.start) || weekSummary(classId, week),
        month: ctx.getClassPlan(classId, '월간', today.slice(0, 7))
      }
    };
  }

  function weekSummary(classId, week) {
    var days = ctx.getClassPlans({ class_id: classId, period_type: '일간', start: week.start, end: week.end })
      .sort(function (a, b) { return LMS.toStr(a.period_key).localeCompare(LMS.toStr(b.period_key)); });
    if (!days.length) return null;
    return { title: days.map(function (p) { return LMS.toStr(p.title || p.content); }).filter(Boolean).join(' → ') };
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
        var roster = ctx.assignments.recordTargets(classId, d).students;
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
    ctx.assignments.recordTargets(classId, end).students.forEach(function (s) { students[s.student_id] = s; });
    var allStudents = table('Students');
    var rows = Object.keys(hw.byDate).sort().reverse().map(function (d) {
      var items = hw.byDate[d];
      var roster = ctx.assignments.recordTargets(classId, d).students;
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
    var cls = classRow(classId);
    var today = store.today();
    var students = table('Students');
    var classes = table('Classes');
    var placements = ctx.assignments.classPlacements(classId, today);
    var row = function (r, active) {
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
        active: active,
        removable: ctx.relRemovable ? ctx.relRemovable(r) : false,
        other_classes: activeRels_(r.student_id, today).filter(function (o) {
          return LMS.toStr(o.class_id) !== LMS.toStr(classId);
        }).map(function (o) { return o.class_name; })
      };
    };
    // Students of this class temporarily moved elsewhere today stay listed, marked away.
    var awayById = {};
    ctx.assignments.awayFrom(classId, today).forEach(function (r) {
      var c = LMS.findById(classes, 'class_id', r.class_id);
      awayById[r.student_id] = { student_id: r.student_id, class_id: r.class_id, class_name: c ? c.class_name : '', end_date: r.end_date };
    });
    var build = function (rels, active) {
      return rels.map(function (r) {
        var out = row(r, active);
        out.away = awayById[r.student_id] || null;
        return out;
      });
    };
    var sorter = function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); };
    return {
      class_name: cls.class_name,
      current: build(placements.current, true).sort(sorter),
      // Booked to start later (e.g. a move dated next week): not attending yet, not past either.
      upcoming: build(placements.upcoming, false).sort(sorter),
      past: build(placements.past, false).sort(function (a, b) {
        return LMS.toStr(b.end_date || b.start_date).localeCompare(LMS.toStr(a.end_date || a.start_date));
      })
    };
  }

  // ----- School exams -----

  function activeStudents_() {
    return table('Students').filter(function (s) { return LMS.toStr(s.status) === '재원'; });
  }

  function currentClassNames_(studentId, today) {
    var classes = table('Classes');
    return ctx.assignments.attending(studentId, today).map(function (r) {
      var c = LMS.findById(classes, 'class_id', r.class_id);
      return c ? c.class_name : '';
    }).filter(Boolean);
  }

  function examLabel(row) {
    if (LMS.toStr(row.exam_type) === '기타') return LMS.toStr(row.title) || '기타 시험';
    return row.semester + '학기 ' + row.exam_type + '고사';
  }

  function decorateExam(row, today, students) {
    var matched = students.filter(function (s) {
      return LMS.schoolGroupKey(s.school, s.grade) === LMS.toStr(row.school_key);
    });
    return Object.assign({}, row, {
      label: examLabel(row),
      d_day: row.exam_date ? LMS.daysBetween(today, row.exam_date) : null,
      student_count: matched.length,
      students: matched.map(function (s) {
        return { student_id: s.student_id, name: s.name, classes: currentClassNames_(s.student_id, today) };
      }).sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); })
    });
  }

  /** School exams for a year/semester (optionally one type), with matched enrolled students. */
  function getSchoolExams(filter) {
    filter = filter || {};
    var today = store.today();
    var students = activeStudents_();
    return table('SchoolExams').filter(function (r) {
      if (filter.school_year && LMS.toStr(r.school_year) !== LMS.toStr(filter.school_year)) return false;
      if (filter.semester && LMS.toStr(r.semester) !== LMS.toStr(filter.semester)) return false;
      if (filter.exam_type && LMS.toStr(r.exam_type) !== LMS.toStr(filter.exam_type)) return false;
      return true;
    }).map(function (r) { return decorateExam(r, today, students); }).sort(function (a, b) {
      var g = LMS.GRADE_OPTIONS.indexOf(a.grade) - LMS.GRADE_OPTIONS.indexOf(b.grade);
      if (g) return g;
      return LMS.toStr(a.school).localeCompare(LMS.toStr(b.school), 'ko');
    });
  }

  /** Distinct schools of enrolled students (normalized), per grade, for pickers and bulk rows. */
  function getSchoolOptions() {
    var groups = {};
    var missing = [];
    activeStudents_().forEach(function (s) {
      var key = LMS.schoolGroupKey(s.school, s.grade);
      if (!key) {
        missing.push({ student_id: s.student_id, name: s.name, grade: s.grade });
        return;
      }
      if (!groups[key]) groups[key] = { school_key: key, grade: LMS.toStr(s.grade), spellings: {}, count: 0 };
      var spelling = LMS.toStr(s.school).trim();
      groups[key].spellings[spelling] = (groups[key].spellings[spelling] || 0) + 1;
      groups[key].count += 1;
    });
    var list = Object.keys(groups).map(function (k) {
      var g = groups[k];
      // Most common spelling, preferring the longer form ("○○중학교") on ties.
      var school = Object.keys(g.spellings).sort(function (a, b) {
        return g.spellings[b] - g.spellings[a] || b.length - a.length;
      })[0];
      return { school_key: k, school: school, grade: g.grade, student_count: g.count };
    }).sort(function (a, b) {
      var gd = LMS.GRADE_OPTIONS.indexOf(a.grade) - LMS.GRADE_OPTIONS.indexOf(b.grade);
      return gd || a.school.localeCompare(b.school, 'ko');
    });
    var schools = {};
    list.forEach(function (g) { schools[g.school] = true; });
    return { groups: list, schools: Object.keys(schools).sort(function (a, b) { return a.localeCompare(b, 'ko'); }), missing_school: missing };
  }

  /** Upcoming (today..+days) exams for the given students' schools, soonest first. */
  function upcomingExamsFor(studentRows, days) {
    var today = store.today();
    var until = LMS.addDays(today, days || 45);
    var keys = {};
    studentRows.forEach(function (s) {
      var k = LMS.schoolGroupKey(s.school, s.grade);
      if (k) keys[k] = true;
    });
    var students = studentRows;
    return table('SchoolExams').filter(function (r) {
      return keys[LMS.toStr(r.school_key)] && r.exam_date && LMS.inRange(r.exam_date, today, until);
    }).map(function (r) { return decorateExam(r, today, students); }).sort(function (a, b) {
      return LMS.toStr(a.exam_date).localeCompare(LMS.toStr(b.exam_date));
    });
  }

  // ----- Students -----

  function studentHomeworkDates_(studentId, start, end) {
    var items = table('HomeworkItems').filter(function (it) { return LMS.inRange(it.lesson_date, start, end); });
    var checks = {};
    table('HomeworkChecks').forEach(function (c) {
      if (LMS.toStr(c.student_id) === LMS.toStr(studentId)) checks[LMS.toStr(c.item_id)] = c;
    });
    var byDate = {};
    items.forEach(function (it) {
      var c = checks[LMS.toStr(it.item_id)];
      if (!c) return;
      var key = it.lesson_date + '|' + it.class_id;
      if (!byDate[key]) byDate[key] = { date: it.lesson_date, class_id: it.class_id, done: 0, total: 0 };
      byDate[key].total += 1;
      if (LMS.toStr(c.status) === '완료') byDate[key].done += 1;
    });
    return Object.keys(byDate).map(function (k) {
      var d = byDate[k];
      return { date: d.date, class_id: d.class_id, done: d.done, total: d.total, incomplete: d.done < d.total };
    });
  }

  function lastCounselDate_(studentId) {
    return table('CounselingNotes').filter(function (n) {
      return LMS.toStr(n.student_id) === LMS.toStr(studentId);
    }).map(function (n) { return LMS.toStr(n.counsel_date); }).sort().pop() || '';
  }

  function badgesFor(student, lessonsByStudent) {
    var today = store.today();
    var start = LMS.addDays(today, -60);
    var lessons = (lessonsByStudent ? lessonsByStudent[student.student_id] : null) || table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(student.student_id);
    });
    return LMS.studentBadges(lessons.filter(function (l) { return LMS.inRange(l.lesson_date, start, today); }), {
      today: today,
      homeworkDates: studentHomeworkDates_(student.student_id, start, today),
      lastCounselDate: lastCounselDate_(student.student_id),
      enrollmentDate: student.enrollment_date
    });
  }

  /** 다니는 반 on the date, shaped for the student screens. */
  function activeRels_(studentId, date) {
    var classes = table('Classes');
    return ctx.assignments.attending(studentId, date).map(function (r) {
      var c = LMS.findById(classes, 'class_id', r.class_id) || {};
      var src = r.source_class_id ? LMS.findById(classes, 'class_id', r.source_class_id) : null;
      return {
        rel_id: r.id,
        class_id: r.class_id,
        class_name: c.class_name || r.class_id,
        class_type: LMS.toStr(c.class_type) || '정규',
        schedule_label: LMS.scheduleLabel(LMS.classSchedule(c)),
        assignment_type: LMS.toStr(r.assignment_type) || '정규',
        source_class_name: src ? src.class_name : '',
        start_date: r.start_date,
        end_date: r.end_date,
        removable: ctx.relRemovable ? ctx.relRemovable(r) : false
      };
    });
  }

  /** 시작 예정 반 after `date` (booked, not yet attending). */
  function upcomingRels_(studentId, date) {
    var classes = table('Classes');
    return ctx.assignments.upcoming(studentId, date).map(function (r) {
      var c = LMS.findById(classes, 'class_id', r.class_id) || {};
      return {
        rel_id: r.id, class_id: r.class_id, class_name: c.class_name || r.class_id, start_date: r.start_date,
        removable: ctx.relRemovable ? ctx.relRemovable(r) : false
      };
    });
  }

  /** Start date of the student's first regular class assignment ('' when none). */
  function firstRegularStart_(studentId) {
    var first = ctx.assignments.firstRegular(studentId);
    return first ? LMS.toStr(first.start_date) : '';
  }

  /** Student list with today's classes, badges, last lesson and the next school exam. */
  function getStudentList(filter) {
    filter = filter || {};
    var today = store.today();
    var q = LMS.toStr(filter.query).toLowerCase().replace(/\s+/g, '');
    var lessonsByStudent = {};
    table('Lessons').forEach(function (l) {
      (lessonsByStudent[l.student_id] = lessonsByStudent[l.student_id] || []).push(l);
    });
    var exams = table('SchoolExams').filter(function (x) { return x.exam_date && x.exam_date >= today; });
    return table('Students').filter(function (s) {
      if (filter.status && LMS.toStr(s.status) !== filter.status) return false;
      if (filter.grade && LMS.toStr(s.grade) !== filter.grade) return false;
      if (q) {
        var hay = (LMS.toStr(s.name) + LMS.toStr(s.school) + LMS.toStr(s.parent_phone) + LMS.toStr(s.student_phone)).toLowerCase().replace(/\s+/g, '');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).map(function (s) {
      var rels = activeRels_(s.student_id, today);
      var upcoming = upcomingRels_(s.student_id, today);
      var lessons = lessonsByStudent[s.student_id] || [];
      var last = lessons.map(function (l) { return LMS.toStr(l.lesson_date); }).filter(function (d) { return d <= today; }).sort().pop() || '';
      var key = LMS.schoolGroupKey(s.school, s.grade);
      var exam = key ? exams.filter(function (x) { return LMS.toStr(x.school_key) === key; })
        .sort(function (a, b) { return LMS.toStr(a.exam_date).localeCompare(LMS.toStr(b.exam_date)); })[0] : null;
      return {
        student_id: s.student_id,
        name: s.name,
        grade: s.grade,
        school: s.school,
        status: s.status,
        parent_phone: s.parent_phone,
        classes: rels,
        upcoming: upcoming,
        unassigned: ctx.assignments.isUnassigned(s, today),
        last_lesson_date: last,
        badges: LMS.toStr(s.status) === '재원' ? badgesFor(s, lessonsByStudent) : [],
        next_exam: exam ? { date: exam.exam_date, d_day: LMS.daysBetween(today, exam.exam_date), label: examLabel(exam) } : null
      };
    }).filter(function (row) {
      if (!filter.class_id) return true;
      if (filter.class_id === '__none__') return row.unassigned;
      return row.classes.some(function (c) { return c.class_id === filter.class_id; });
    }).sort(function (a, b) {
      return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko');
    });
  }

  function monthStats_(studentId, start, end) {
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId) && LMS.inRange(l.lesson_date, start, end);
    });
    var absent = lessons.filter(function (l) { return LMS.toStr(l.attendance) === '결석'; }).length;
    var hw = studentHomeworkDates_(studentId, start, end);
    var done = 0;
    var total = 0;
    hw.forEach(function (h) { done += h.done; total += h.total; });
    var collected = LMS.collectRawScoresForStats(lessons);
    var scores = LMS.computeScoreStats(collected.comparable ? collected.scores : []);
    var assign = lessons.map(function (l) { return LMS.assignmentCode(l.assignment_completion); }).filter(Boolean);
    return {
      lesson_count: lessons.length,
      absent_count: absent,
      attendance_rate: pct(lessons.length - absent, lessons.length),
      homework_rate: pct(done, total),
      test_count: collected.test_count,
      test_average_display: collected.comparable ? scores.average_display : (collected.test_count ? '만점 다름' : '-'),
      assignment_a_rate: pct(assign.filter(function (a) { return a === 'A'; }).length, assign.length)
    };
  }

  function getStudentOverview(studentId) {
    var s = ctx.requireStudent(studentId);
    var today = store.today();
    var monthStart = today.slice(0, 8) + '01';
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId) && l.lesson_date <= today;
    }).sort(function (a, b) { return LMS.toStr(b.lesson_date).localeCompare(LMS.toStr(a.lesson_date)); });
    var classes = table('Classes');
    var notes = lessons.filter(function (l) { return LMS.toStr(l.special_note); }).slice(0, 5).map(function (l) {
      var c = LMS.findById(classes, 'class_id', l.class_id);
      return { date: l.lesson_date, class_name: c ? c.class_name : '', note: l.special_note };
    });
    var counseling = table('CounselingNotes').filter(function (n) {
      return LMS.toStr(n.student_id) === LMS.toStr(studentId);
    }).sort(function (a, b) { return LMS.toStr(b.counsel_date).localeCompare(LMS.toStr(a.counsel_date)); });
    var tasks = table('Tasks').filter(function (t) {
      return LMS.toStr(t.student_id) === LMS.toStr(studentId) && LMS.toStr(t.status) === '예정';
    }).sort(function (a, b) { return LMS.toStr(a.due_date).localeCompare(LMS.toStr(b.due_date)); });
    var rels = activeRels_(studentId, today);
    var next = null;
    rels.forEach(function (r) {
      var c = LMS.findById(classes, 'class_id', r.class_id);
      var n = c && LMS.toStr(c.status) === '운영' ? nextMeeting(c, today) : null;
      if (n && (!next || n.date < next.date || (n.date === next.date && LMS.toStr(n.time && n.time.start) < LMS.toStr(next.time && next.time.start)))) {
        next = Object.assign({ class_name: c.class_name }, n);
      }
    });
    return {
      student: Object.assign({}, s, { first_class_start: firstRegularStart_(s.student_id) }),
      today: today,
      classes: rels,
      upcoming_classes: upcomingRels_(studentId, today),
      unassigned: ctx.assignments.isUnassigned(s, today),
      next: next,
      month: monthStats_(studentId, monthStart, today),
      badges: LMS.toStr(s.status) === '재원' ? badgesFor(s) : [],
      exams: upcomingExamsFor([s], 90),
      recent_notes: notes,
      last_lesson_date: lessons.length ? lessons[0].lesson_date : '',
      counseling: counseling.slice(0, 2),
      last_counsel_date: counseling.length ? counseling[0].counsel_date : '',
      open_tasks: tasks
    };
  }

  /** One month of the student's scheduled days, records and makeups for the attendance calendar. */
  function getStudentAttendanceMonth(studentId, yearMonth) {
    ctx.requireStudent(studentId);
    if (!/^\d{4}-\d{2}$/.test(LMS.toStr(yearMonth))) throw new Error('월 형식이 올바르지 않습니다.');
    var range = LMS.monthRange(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)));
    var today = store.today();
    var classes = table('Classes');
    var periods = ctx.examPeriods();
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId) && LMS.inRange(l.lesson_date, range.start, range.end);
    });
    var makeups = table('MakeupSessions').filter(function (m) {
      if (LMS.toStr(m.status) === '취소' || !LMS.inRange(m.makeup_date, range.start, range.end)) return false;
      if (LMS.toStr(m.student_id) === LMS.toStr(studentId)) return true;
      return LMS.toStr(m.kind) === '반' && ctx.assignments.inClassOn(studentId, m.class_id, m.makeup_date);
    });
    var counts = { present: 0, absent: 0, makeup: 0, missing: 0, scheduled: 0 };
    var days = LMS.datesInRange(range.start, range.end).map(function (date) {
      var slots = [];
      ctx.assignments.attending(studentId, date).forEach(function (r) {
        var c = LMS.findById(classes, 'class_id', r.class_id);
        if (!c || !LMS.classMeetsOnDate(c, date, periods)) return;
        slots.push({ class_id: c.class_id, class_name: c.class_name, time: LMS.classTimeOn(c, date) });
      });
      var dayLessons = lessons.filter(function (l) { return l.lesson_date === date; });
      var entries = dayLessons.map(function (l) {
        var c = LMS.findById(classes, 'class_id', l.class_id);
        return {
          kind: LMS.toStr(l.attendance) === '결석' ? 'absent' : 'present',
          lesson_id: l.lesson_id,
          class_id: l.class_id,
          class_name: c ? c.class_name : '',
          special_note: l.special_note,
          test: LMS.toStr(l.test_status) === '실시' ? LMS.formatScoreDisplay(l.test_status, l.test_score, l.test_max_score) : '',
          assignment: LMS.assignmentCode(l.assignment_completion),
          concentration: l.concentration
        };
      });
      slots.forEach(function (slot) {
        if (dayLessons.some(function (l) { return LMS.toStr(l.class_id) === slot.class_id; })) return;
        entries.push({ kind: date > today ? 'scheduled' : 'missing', class_id: slot.class_id, class_name: slot.class_name, time: slot.time });
      });
      makeups.filter(function (m) { return m.makeup_date === date; }).forEach(function (m) {
        var c = LMS.findById(classes, 'class_id', m.class_id);
        entries.push({ kind: 'makeup', makeup_id: m.makeup_id, class_name: c ? c.class_name : '', title: m.title, time: { start: m.start_time, end: m.end_time }, status: m.status });
      });
      entries.forEach(function (e) {
        if (e.kind === 'present') counts.present += 1;
        else if (e.kind === 'absent') counts.absent += 1;
        else if (e.kind === 'makeup') counts.makeup += 1;
        else if (e.kind === 'missing') counts.missing += 1;
        else counts.scheduled += 1;
      });
      return { date: date, weekday: LMS.weekdayName(date), entries: entries };
    });
    return {
      month: yearMonth,
      today: today,
      days: days,
      counts: counts,
      attendance_rate: pct(counts.present, counts.present + counts.absent)
    };
  }

  /** Homework items given on each lesson date with this student's completion. */
  function getStudentHomework(studentId, range) {
    ctx.requireStudent(studentId);
    range = range || {};
    var today = store.today();
    var end = LMS.toStr(range.end) || today;
    var start = LMS.toStr(range.start) || LMS.addDays(end, -42);
    var classes = table('Classes');
    var checks = {};
    table('HomeworkChecks').forEach(function (c) {
      if (LMS.toStr(c.student_id) === LMS.toStr(studentId)) checks[LMS.toStr(c.item_id)] = c;
    });
    var groups = {};
    table('HomeworkItems').forEach(function (it) {
      if (!LMS.inRange(it.lesson_date, start, end)) return;
      var member = ctx.assignments.inClassOn(studentId, it.class_id, it.lesson_date);
      if (!member && !checks[LMS.toStr(it.item_id)]) return;
      var key = it.lesson_date + '|' + it.class_id;
      if (!groups[key]) {
        var c = LMS.findById(classes, 'class_id', it.class_id);
        groups[key] = {
          date: it.lesson_date,
          class_id: it.class_id,
          class_name: c ? c.class_name : '',
          check_date: c ? ctx.checkingLessonDate(c, it.lesson_date) : '',
          items: []
        };
      }
      var check = checks[LMS.toStr(it.item_id)];
      groups[key].items.push({
        item_id: LMS.toStr(it.item_id),
        title: it.title,
        sort_order: Number(it.sort_order || 0),
        status: check ? LMS.toStr(check.status) : '미확인'
      });
    });
    var rows = Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.items.sort(function (a, b) { return a.sort_order - b.sort_order; });
      return g;
    }).sort(function (a, b) { return LMS.toStr(b.date).localeCompare(LMS.toStr(a.date)); });
    var done = 0;
    var checked = 0;
    var missing = [];
    rows.forEach(function (r) {
      r.items.forEach(function (it) {
        if (it.status === '미확인') return;
        checked += 1;
        if (it.status === '완료') done += 1;
        else missing.push({ date: r.date, class_name: r.class_name, title: it.title });
      });
    });
    return { start: start, end: end, rows: rows, rate: pct(done, checked), checked: checked, missing: missing };
  }

  /** Tests the student took with the class average of the same day. */
  function getStudentGrades(studentId, range) {
    ctx.requireStudent(studentId);
    range = range || {};
    var today = store.today();
    var end = LMS.toStr(range.end) || today;
    var start = LMS.toStr(range.start) || LMS.addDays(end, -183);
    var all = table('Lessons');
    var classes = table('Classes');
    var rows = all.filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId) && LMS.inRange(l.lesson_date, start, end) &&
        LMS.toStr(l.test_status) === '실시';
    }).sort(function (a, b) { return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date)); }).map(function (l) {
      var same = all.filter(function (o) {
        return o.lesson_date === l.lesson_date && LMS.toStr(o.class_id) === LMS.toStr(l.class_id) && LMS.toStr(o.test_status) === '실시';
      });
      var classScores = same.map(function (o) { return LMS.toNum(o.test_score); }).filter(function (n) { return n !== null; });
      var session = ctx.getClassSession(l.lesson_date, l.class_id);
      var c = LMS.findById(classes, 'class_id', l.class_id);
      var score = LMS.toNum(l.test_score);
      var avg = LMS.averageOf(classScores);
      return {
        date: l.lesson_date,
        class_id: l.class_id,
        class_name: c ? c.class_name : '',
        title: session.test_title,
        difficulty: l.test_difficulty || session.test_difficulty,
        score: score,
        max_score: LMS.toNum(l.test_max_score),
        class_average: avg,
        rank: classScores.filter(function (n) { return n > score; }).length + 1,
        taken: classScores.length
      };
    });
    var collected = LMS.collectRawScoresForStats(rows.map(function (r) {
      return { test_status: '실시', test_score: r.score, test_max_score: r.max_score };
    }));
    var stats = LMS.computeScoreStats(collected.comparable ? collected.scores : []);
    return { start: start, end: end, rows: rows.reverse(), comparable: collected.comparable, stats: stats };
  }

  /** Monthly reports and recent lessons (for daily reports) of a student. */
  function getStudentReports(studentId) {
    ctx.requireStudent(studentId);
    var classes = table('Classes');
    var monthly = table('MonthlyReports').filter(function (r) {
      return LMS.toStr(r.student_id) === LMS.toStr(studentId);
    }).sort(function (a, b) {
      return (Number(b.year) * 100 + Number(b.month)) - (Number(a.year) * 100 + Number(a.month));
    });
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId);
    }).sort(function (a, b) { return LMS.toStr(b.lesson_date).localeCompare(LMS.toStr(a.lesson_date)); }).slice(0, 20)
      .map(function (l) {
        var c = LMS.findById(classes, 'class_id', l.class_id);
        return { lesson_id: l.lesson_id, date: l.lesson_date, class_name: c ? c.class_name : '', attendance: l.attendance };
      });
    return { monthly: monthly, lessons: lessons };
  }

  // ----- Today board -----

  var BOARD_HIDDEN_AGENDA = { incomplete_class: true, makeup: true, learning_alert: true, homework_check: true };

  /** Everything the today screen shows above the lesson editor, for one date. */
  function getTodayBoard(date) {
    var today = store.today();
    date = LMS.toStr(date) || today;
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var periods = ctx.examPeriods();
    var teaching = ctx.getTodayTeachingTasks(date);
    var suspended = table('Classes').filter(function (c) {
      return LMS.toStr(c.status) === '운영' && LMS.toStr(c.class_type) !== '시험대비' &&
        LMS.classTimeOn(c, date) && LMS.classSuspensionOn(c, date, periods);
    }).map(function (c) {
      var p = LMS.classSuspensionOn(c, date, periods);
      var last = LMS.classResumeDate(p, LMS.toStr(c.class_id)) || p.end_date;
      return { class_id: c.class_id, class_name: c.class_name, period_title: p.title, resume_date: LMS.addDays(last, 1) };
    });
    var cancelled = table('Classes').filter(function (c) {
      return LMS.toStr(c.status) === '운영' && LMS.classTimeOn(c, date) && LMS.classCancellationOn(c, date);
    }).map(function (c) {
      var time = LMS.classTimeOn(c, date);
      return {
        class_id: c.class_id, class_name: c.class_name, start_time: time.start, end_time: time.end,
        reason: LMS.toStr(LMS.classCancellationOn(c, date).reason)
      };
    });
    var agenda = ctx.getDayAgenda(date);
    var active = activeStudents_();
    var flagged = [];
    if (date === today) {
      active.forEach(function (s) {
        var b = badgesFor(s).filter(function (x) { return x.tone !== 'muted'; });
        if (b.length) flagged.push({ student_id: s.student_id, name: s.name, badges: b });
      });
    }
    var week = LMS.weekRange(date);
    var makeups = table('MakeupSessions').filter(function (m) {
      return LMS.toStr(m.status) !== '취소' && LMS.inRange(m.makeup_date, week.start, week.end);
    });
    var classes = table('Classes');
    var weekDays = LMS.datesInRange(week.start, week.end).map(function (d) {
      return {
        date: d,
        weekday: LMS.weekdayName(d),
        class_count: classes.filter(function (c) { return LMS.classMeetsOnDate(c, d, periods); }).length,
        makeup_count: makeups.filter(function (m) { return m.makeup_date === d; }).length
      };
    });
    var hw = ctx.getWeeklyHomeworkDashboard(date);
    return {
      date: date,
      today: today,
      classes: teaching.regular_classes.sort(function (a, b) {
        return LMS.toStr(a.start_time).localeCompare(LMS.toStr(b.start_time));
      }),
      suspended: suspended,
      cancelled: cancelled,
      makeups: teaching.makeup_sessions,
      tasks: (agenda.items || []).filter(function (i) { return !BOARD_HIDDEN_AGENDA[i.kind]; }),
      overdue_tasks: date !== today ? [] : table('Tasks').filter(function (t) {
        return LMS.toStr(t.status) === '예정' && LMS.toStr(t.due_date) < today;
      }).sort(function (a, b) { return LMS.toStr(a.due_date).localeCompare(LMS.toStr(b.due_date)); }).map(function (t) {
        var st = t.student_id ? LMS.findById(table('Students'), 'student_id', t.student_id) : null;
        return {
          id: t.task_id, task_id: t.task_id, source: 'manual', kind: t.kind, title: t.title, status: t.status,
          due_date: t.due_date, memo: t.memo, student_id: t.student_id, student_name: st ? st.name : ''
        };
      }),
      exams_soon: date === today ? upcomingExamsFor(active, 7) : [],
      unassigned_count: date === today ? active.filter(function (s) { return ctx.assignments.isUnassigned(s, today); }).length : 0,
      flagged: flagged.sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); }),
      week: weekDays,
      weekly_homework: {
        week_label: hw.week_label,
        classes: hw.classes.map(function (c) {
          return {
            class_id: c.class_id,
            class_name: c.class_name,
            incomplete_slot_count: c.incomplete_slot_count,
            slots: c.slots.map(function (sl) {
              return {
                check_date: sl.check_date,
                assigned_date: sl.assigned_date,
                item_count: sl.completion.item_count,
                students_incomplete: sl.completion.students_incomplete
              };
            })
          };
        })
      }
    };
  }

  // ----- Exam-prep periods -----

  function periodState(p, today) {
    var st = LMS.toStr(p.status);
    if (st === '종료' || st === '취소') return st === '종료' ? '마감' : '취소';
    if (today < p.start_date) return '예정';
    if (today > p.end_date) return '끝남';
    return '진행 중';
  }

  function periodClasses(periodId) {
    return table('Classes').filter(function (c) {
      return LMS.toStr(c.exam_period_id) === LMS.toStr(periodId) && LMS.toStr(c.class_type) === '시험대비';
    });
  }

  function getExamPeriods() {
    var today = store.today();
    return table('ExamPeriods').map(function (p) {
      var classes = periodClasses(p.exam_period_id);
      var students = {};
      ctx.assignments.tempPlacements(classes.map(function (c) { return c.class_id; })).forEach(function (r) {
        students[r.student_id] = true;
      });
      return Object.assign({}, p, {
        state: periodState(p, today),
        class_count: classes.length,
        student_count: Object.keys(students).length,
        suspended_count: LMS.suspendedClassIds(p).length
      });
    }).sort(function (a, b) { return LMS.toStr(b.start_date).localeCompare(LMS.toStr(a.start_date)); });
  }

  function examDateFor(period, schoolKey) {
    var hit = table('SchoolExams').filter(function (x) {
      if (LMS.toStr(x.school_key) !== schoolKey || !x.exam_date) return false;
      if (period.exam_year && LMS.toStr(x.school_year) !== LMS.toStr(period.exam_year)) return false;
      if (period.exam_semester && LMS.toStr(x.semester) !== LMS.toStr(period.exam_semester)) return false;
      if (period.exam_type && LMS.toStr(x.exam_type) !== LMS.toStr(period.exam_type)) return false;
      return LMS.inRange(x.exam_date, period.start_date, period.end_date);
    }).sort(function (a, b) { return LMS.toStr(a.exam_date).localeCompare(LMS.toStr(b.exam_date)); })[0];
    return hit ? hit.exam_date : '';
  }

  /** Suggested school+grade groups for a period (students already placed in it are skipped). */
  function proposeExamGroups(periodId) {
    var period = LMS.findById(table('ExamPeriods'), 'exam_period_id', periodId);
    if (!period) throw new Error('시험대비 기간을 찾을 수 없습니다.');
    var classes = table('Classes');
    var placed = {};
    var tempIds = periodClasses(periodId).map(function (c) { return c.class_id; });
    ctx.assignments.tempPlacements(tempIds).forEach(function (r) { placed[r.student_id] = true; });
    var groups = {};
    var unassigned = [];
    var sourceUse = {};
    activeStudents_().forEach(function (s) {
      if (placed[s.student_id]) return;
      var sources = ctx.assignments.regularClassIdsDuring(s.student_id, period.start_date, period.end_date);
      if (!sources.length) return;
      var src = LMS.findById(classes, 'class_id', sources[0]);
      var entry = { student_id: s.student_id, name: s.name, school: s.school, grade: s.grade, source_class_id: sources[0], source_class_name: src ? src.class_name : '' };
      var key = LMS.schoolGroupKey(s.school, s.grade);
      if (!key) {
        unassigned.push(entry);
        return;
      }
      if (!groups[key]) groups[key] = { key: key, grade: LMS.toStr(s.grade), spellings: {}, students: [] };
      groups[key].students.push(entry);
      var sp = LMS.toStr(s.school).trim();
      groups[key].spellings[sp] = (groups[key].spellings[sp] || 0) + 1;
      sources.forEach(function (id) { sourceUse[id] = true; });
    });
    var list = Object.keys(groups).map(function (k) {
      var g = groups[k];
      var school = Object.keys(g.spellings).sort(function (a, b) {
        return g.spellings[b] - g.spellings[a] || b.length - a.length;
      })[0];
      var srcCount = {};
      g.students.forEach(function (st) { srcCount[st.source_class_id] = (srcCount[st.source_class_id] || 0) + 1; });
      var mainSrc = LMS.findById(classes, 'class_id', Object.keys(srcCount).sort(function (a, b) { return srcCount[b] - srcCount[a]; })[0]);
      var examDate = examDateFor(period, k);
      return {
        key: k,
        target_school: school,
        target_grade: g.grade,
        class_name: school.replace(/학교$/, '') + ' ' + g.grade + ' 시험대비',
        schedule: mainSrc ? LMS.classSchedule(mainSrc) : [],
        teacher: mainSrc ? LMS.toStr(mainSrc.teacher) : '',
        start_date: period.start_date,
        end_date: examDate || period.end_date,
        exam_date: examDate,
        students: g.students.sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); })
      };
    }).sort(function (a, b) {
      var gd = LMS.GRADE_OPTIONS.indexOf(a.target_grade) - LMS.GRADE_OPTIONS.indexOf(b.target_grade);
      return gd || a.target_school.localeCompare(b.target_school, 'ko');
    });
    unassigned.forEach(function (u) { sourceUse[u.source_class_id] = true; });
    return {
      period: period,
      groups: list,
      unassigned: unassigned,
      regular_classes: classes.filter(function (c) {
        return LMS.toStr(c.status) === '운영' && LMS.toStr(c.class_type) !== '시험대비';
      }).map(function (c) {
        return { class_id: c.class_id, class_name: c.class_name, schedule_label: LMS.scheduleLabel(LMS.classSchedule(c)), suggested: !!sourceUse[c.class_id] };
      }),
      suspended_class_ids: LMS.suspendedClassIds(period)
    };
  }

  function getExamPeriodDetail(periodId) {
    var period = LMS.findById(table('ExamPeriods'), 'exam_period_id', periodId);
    if (!period) throw new Error('시험대비 기간을 찾을 수 없습니다.');
    var today = store.today();
    var students = table('Students');
    var classes = table('Classes');
    var lessons = table('Lessons');
    var temp = periodClasses(periodId).map(function (c) {
      var members = ctx.assignments.tempPlacements([c.class_id]).map(function (r) {
        var st = LMS.findById(students, 'student_id', r.student_id) || {};
        var src = LMS.findById(classes, 'class_id', r.source_class_id);
        return {
          rel_id: r.id, student_id: r.student_id, name: st.name || r.student_id, school: st.school || '',
          source_class_id: r.source_class_id, source_class_name: src ? src.class_name : '',
          start_date: r.start_date, end_date: r.end_date,
          state: today < r.start_date ? '예정' : today > r.end_date ? '복귀' : '수업 중',
          has_lessons: lessons.some(function (l) { return l.class_id === c.class_id && l.student_id === r.student_id; })
        };
      }).sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); });
      return {
        class_id: c.class_id, class_name: c.class_name, status: c.status, teacher: c.teacher,
        target_school: c.target_school, target_grade: c.target_grade,
        schedule: LMS.classSchedule(c), schedule_label: LMS.scheduleLabel(LMS.classSchedule(c)),
        lesson_days: Object.keys(lessons.filter(function (l) { return l.class_id === c.class_id; }).reduce(function (m, l) { m[l.lesson_date] = 1; return m; }, {})).length,
        students: members
      };
    });
    var placed = {};
    temp.forEach(function (c) { c.students.forEach(function (m) { placed[m.student_id] = true; }); });
    var suspended = LMS.suspendedClassIds(period).map(function (id) {
      var c = LMS.findById(classes, 'class_id', id) || { class_name: id };
      var last = LMS.classResumeDate(period, id) || period.end_date;
      var left = ctx.assignments.recordTargets(id, period.start_date).students.filter(function (s) {
        return !placed[s.student_id];
      }).map(function (s) { return { student_id: s.student_id, name: s.name }; });
      // Return schedule: who comes back to this class on which day.
      var byDay = {};
      temp.forEach(function (tc) {
        tc.students.forEach(function (m) {
          var sources = ctx.assignments.regularClassIdsDuring(m.student_id, period.start_date, period.end_date);
          if (sources.indexOf(id) === -1 && m.source_class_id !== id) return;
          var back = LMS.addDays(m.end_date || period.end_date, 1);
          (byDay[back] = byDay[back] || []).push(m.name);
        });
      });
      var returns = Object.keys(byDay).sort().map(function (d) {
        return { date: d, names: byDay[d].sort(function (a, b) { return a.localeCompare(b, 'ko'); }) };
      });
      return { class_id: id, class_name: c.class_name, last_suspended: last, resume_date: LMS.addDays(last, 1), returns: returns, unplaced: left };
    });
    return {
      period: Object.assign({}, period, { state: periodState(period, today) }),
      today: today,
      classes: temp,
      suspended: suspended,
      unplaced_count: suspended.reduce(function (n, s) { return n + s.unplaced.length; }, 0),
      has_lessons: temp.some(function (c) { return c.lesson_days > 0; })
    };
  }

  // ----- Reports -----

  /**
   * Monthly report status for a class (members during the month, plus anyone recorded in it)
   * or, without classId, every enrolled student.
   */
  function getMonthlyReportBoard(classId, year, month) {
    var y = Number(year);
    var m = Number(month);
    if (!y || !m) throw new Error('연도와 월을 올바르게 입력해 주세요.');
    var range = LMS.monthRange(y, m);
    var students = table('Students');
    var ids = {};
    if (classId) {
      ctx.requireClass(classId);
      ctx.assignments.membersDuring(classId, range.start, range.end).forEach(function (id) { ids[id] = true; });
      table('Lessons').forEach(function (l) {
        if (LMS.toStr(l.class_id) === LMS.toStr(classId) && LMS.inRange(l.lesson_date, range.start, range.end)) ids[l.student_id] = true;
      });
    } else {
      students.forEach(function (s) { if (LMS.toStr(s.status) === '재원') ids[s.student_id] = true; });
    }
    var reports = {};
    table('MonthlyReports').forEach(function (r) {
      if (Number(r.year) === y && Number(r.month) === m) reports[r.student_id] = r;
    });
    var lessonCount = {};
    table('Lessons').forEach(function (l) {
      if (ids[l.student_id] && LMS.inRange(l.lesson_date, range.start, range.end)) lessonCount[l.student_id] = (lessonCount[l.student_id] || 0) + 1;
    });
    var rows = Object.keys(ids).map(function (sid) {
      var s = LMS.findById(students, 'student_id', sid) || { name: sid };
      var r = reports[sid];
      return {
        student_id: sid,
        name: s.name,
        grade: s.grade,
        student_status: s.status,
        lesson_count: lessonCount[sid] || 0,
        status: r ? (LMS.toStr(r.status) || '임시') : '미작성',
        monthly_report_id: r ? r.monthly_report_id : '',
        updated_at: r ? r.updated_at : '',
        preview: r ? LMS.toStr(r.report_text).slice(0, 80) : ''
      };
    }).sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); });
    var count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
    return { year: y, month: m, class_id: classId || '', rows: rows, counts: { none: count('미작성'), draft: count('임시'), final: count('확정') } };
  }

  /** Daily reports of a class/date plus the roster students who have no record that day. */
  function getDailyReportBoard(date, classId) {
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var cls = ctx.requireClass(classId);
    var reports = ctx.generateDailyReports(date, classId);
    var recorded = {};
    reports.reports.forEach(function (r) { recorded[r.student_id] = true; });
    var missing = ctx.assignments.recordTargets(classId, date).students.filter(function (s) {
      return !recorded[s.student_id];
    }).map(function (s) { return { student_id: s.student_id, name: s.name }; });
    return {
      date: date,
      class: { class_id: cls.class_id, class_name: cls.class_name },
      meets: LMS.classMeetsOnDate(cls, date, ctx.examPeriods()),
      reports: reports.reports,
      class_test_average: reports.class_test_average,
      missing: missing
    };
  }

  function studentBadges(student) {
    return LMS.toStr(student.status) === '재원' ? badgesFor(student) : [];
  }

  return {
    getMonthlyReportBoard: getMonthlyReportBoard,
    getDailyReportBoard: getDailyReportBoard,
    getExamPeriods: getExamPeriods,
    getExamPeriodDetail: getExamPeriodDetail,
    proposeExamGroups: proposeExamGroups,
    getTodayBoard: getTodayBoard,
    studentBadges: studentBadges,
    getStudentList: getStudentList,
    getStudentOverview: getStudentOverview,
    getStudentAttendanceMonth: getStudentAttendanceMonth,
    getStudentHomework: getStudentHomework,
    getStudentGrades: getStudentGrades,
    getStudentReports: getStudentReports,
    getSchoolExams: getSchoolExams,
    getSchoolOptions: getSchoolOptions,
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
