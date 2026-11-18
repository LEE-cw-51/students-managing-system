/**
 * Class-day recording: load and save one class lesson date from the today screen.
 * Owns getTodayClassSession / saveTodaySession (and private recordStudents_). Copy between
 * ClassSessions and Lessons stays in 03_Sessions.js; this module only calls it.
 * Server-only: reads tables, so it is not imported by the browser.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, requireClass, requireStudent, assignments, examPeriods_, sessionSync,
 * lessons ports from createLessons (getLessons, getClassSession, getClassSessionNotice,
 * saveClassSession, saveLessonsBatch), homework ports from createHomework
 * (getSessionHomework, saveHomeworkChecks, saveSessionHomework, saveStudentHomeworkItems,
 * homeworkReplaceOn_, enrichHomeworkItem_, priorLessonDate_), studentBadges(student),
 * getClassPlan, setDailyPlanDone(classId, date, status).
 * Callers run commands inside the service transaction.
 */
LMS.createClassDayRecording = function (ctx) {
  var table = ctx.table;
  var assignments = ctx.assignments;
  var sessionSync = ctx.sessionSync;

  /** Students recorded for a class date: the roster plus anyone already recorded that day off it. */
  function recordStudents_(date, classId, lessons) {
    var targets = assignments.recordTargets(classId, date);
    var students = targets.students.slice();
    var allStudents = table('Students');
    lessons.forEach(function (l) {
      if (students.some(function (s) { return s.student_id === l.student_id; })) return;
      var extra = LMS.findById(allStudents, 'student_id', l.student_id);
      if (extra) students.push(Object.assign({}, extra, { off_roster: true }));
    });
    return { students: students, onLeave: targets.onLeave };
  }

  function getTodayClassSession(date, classId) {
    var cls = ctx.requireClass(classId);
    var periods = ctx.examPeriods_();
    var lessons = ctx.getLessons(date, classId);
    var targets = recordStudents_(date, classId, lessons);
    var students = targets.students;
    var onLeave = targets.onLeave.map(function (s) { return { student_id: s.student_id, name: s.name }; });
    var byStudent = {};
    lessons.forEach(function (l) {
      var testOwn = LMS.toStr(l.test_own) === 'Y';
      byStudent[l.student_id] = Object.assign({}, l, {
        progress_own: LMS.toStr(l.progress_own) === 'Y' ? 'Y' : '',
        test_own: testOwn ? 'Y' : '',
        test_title: testOwn ? LMS.toStr(l.test_title) : ''
      });
    });
    var prevMeeting = LMS.previousMeetingDateFor(cls, date, periods);
    var lastSession = table('ClassSessions').filter(function (r) {
      return LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.toStr(r.lesson_date) < date && LMS.toStr(r.progress);
    }).sort(function (a, b) { return LMS.toStr(b.lesson_date).localeCompare(LMS.toStr(a.lesson_date)); })[0];
    var priorDate = ctx.priorLessonDate_(cls, date);
    var priorHomework = priorDate ? ctx.getSessionHomework(priorDate, classId) : null;
    var todayHomework = ctx.getSessionHomework(date, classId);
    var priorChecksByStudent = {};
    var priorItemsByStudent = {};
    var priorReplaceByStudent = {};
    if (priorHomework) {
      students.forEach(function (s) {
        var replace = ctx.homeworkReplaceOn_(priorDate, classId, s.student_id);
        priorReplaceByStudent[s.student_id] = LMS.normalizeHomeworkReplaceClass(replace);
        // Personal-only list (same shape as today_homework); UI merges with class items when needed.
        priorItemsByStudent[s.student_id] = (priorHomework.items || []).filter(function (it) {
          return LMS.toStr(it.student_id) === LMS.toStr(s.student_id);
        }).map(ctx.enrichHomeworkItem_);
        var effective = LMS.homeworkItemsForStudent(priorHomework.items || [], s.student_id, replace);
        var map = {};
        effective.forEach(function (it) {
          if (!it.item_id) return;
          var hit = (priorHomework.checks || []).filter(function (c) {
            return LMS.toStr(c.item_id) === LMS.toStr(it.item_id) &&
              LMS.toStr(c.student_id) === LMS.toStr(s.student_id);
          })[0];
          map[it.item_id] = hit ? LMS.homeworkGrade(hit.status) : '';
        });
        priorChecksByStudent[s.student_id] = map;
      });
    }
    var todayPersonalByStudent = {};
    var todayReplaceByStudent = {};
    students.forEach(function (s) {
      var lesson = byStudent[s.student_id];
      todayReplaceByStudent[s.student_id] = lesson
        ? LMS.normalizeHomeworkReplaceClass(lesson.homework_replace_class)
        : '';
      todayPersonalByStudent[s.student_id] = (todayHomework.items || []).filter(function (it) {
        return LMS.toStr(it.student_id) === LMS.toStr(s.student_id);
      }).map(ctx.enrichHomeworkItem_);
    });
    var suspension = LMS.toStr(cls.class_type) === '시험대비' ? null : LMS.classSuspensionOn(cls, date, periods);
    var cancellation = LMS.classCancellationOn(cls, date);
    var dailyPlan = ctx.getClassPlan(classId, '일간', date);
    var curriculum = LMS.classCurriculum(cls);
    return {
      class: Object.assign({}, cls, { schedule: LMS.classSchedule(cls), schedule_label: LMS.scheduleLabel(LMS.classSchedule(cls)) }),
      date: date,
      time: LMS.classTimeOn(cls, date),
      meets: LMS.classMeetsOnDate(cls, date, periods),
      suspension: suspension ? { title: suspension.title, start_date: suspension.start_date, end_date: suspension.end_date } : null,
      cancellation: cancellation ? { date: cancellation.date, reason: LMS.toStr(cancellation.reason) } : null,
      prev_meeting: prevMeeting,
      next_meeting: LMS.nextMeetingDateFor(cls, LMS.addDays(date, 1), periods),
      last_progress: lastSession ? { date: lastSession.lesson_date, progress: lastSession.progress } : null,
      session: ctx.getClassSession(date, classId),
      class_notice: ctx.getClassSessionNotice(date, classId),
      daily_plan: dailyPlan ? Object.assign({}, dailyPlan, {
        unit_titles: LMS.unitTitles(curriculum, LMS.jsonList(dailyPlan.unit_ids)),
        done_status: LMS.toStr(dailyPlan.done_status)
      }) : null,
      prior_homework: priorHomework ? {
        assigned_date: priorDate,
        items: (priorHomework.class_items || priorHomework.items.filter(LMS.isClassHomeworkItem)),
        personal_items_by_student: priorItemsByStudent,
        replace_by_student: priorReplaceByStudent,
        from_legacy: priorHomework.from_legacy,
        has_checks: Object.keys(priorChecksByStudent).some(function (sid) {
          return Object.keys(priorChecksByStudent[sid]).some(function (itemId) {
            return !!priorChecksByStudent[sid][itemId];
          });
        }),
        checks_by_student: priorChecksByStudent
      } : null,
      today_homework: {
        lesson_date: date,
        items: (todayHomework.class_items || todayHomework.items.filter(LMS.isClassHomeworkItem)),
        personal_items_by_student: todayPersonalByStudent,
        replace_by_student: todayReplaceByStudent,
        from_legacy: todayHomework.from_legacy
      },
      students: students.map(function (s) {
        return Object.assign({}, s, {
          lesson: byStudent[s.student_id] || null,
          badges: ctx.studentBadges ? ctx.studentBadges(s) : []
        });
      }),
      on_leave: onLeave,
      recorded_count: lessons.length,
      total_count: students.length
    };
  }

  /**
   * Save one class lesson from the today screen in a single transaction:
   * prior homework checks → today's homework → class session → every student row.
   * Everything is validated before the first write.
   */
  function saveTodaySession(payload) {
    var p = payload || {};
    var date = LMS.toStr(p.lesson_date);
    var classId = LMS.toStr(p.class_id);
    if (!LMS.isIsoDate(date)) throw new Error('수업 날짜가 올바르지 않습니다.');
    ctx.requireClass(classId);
    var sessionInput = LMS.validateClassSessionInput(Object.assign({}, p.session || {}, { lesson_date: date, class_id: classId }));
    var students = Array.isArray(p.students) ? p.students : [];
    if (!students.length) throw new Error('저장할 학생이 없습니다.');
    var existingSession = sessionSync.find(date, classId);
    var maxScore = sessionInput.test_max_score !== undefined ? sessionInput.test_max_score
      : (existingSession ? existingSession.test_max_score : '');
    var difficulty = sessionInput.test_difficulty !== undefined ? sessionInput.test_difficulty
      : (existingSession ? existingSession.test_difficulty : '');
    var classProgress = LMS.toStr(sessionInput.progress !== undefined ? sessionInput.progress
      : (existingSession ? existingSession.progress : '')).trim();
    var classHwTitles = (Array.isArray(p.homework_items) ? p.homework_items : []).map(function (it) {
      return LMS.toStr(typeof it === 'string' ? it : it && it.title);
    }).filter(Boolean);
    var personalByStudent = {};
    students.forEach(function (s) {
      var sid = LMS.toStr(s.student_id);
      var titles = [];
      if (Array.isArray(s.personal_homework)) {
        s.personal_homework.forEach(function (it) {
          var t = LMS.toStr(typeof it === 'string' ? it : it && it.title);
          if (t) titles.push(t);
        });
      }
      personalByStudent[sid] = titles;
    });

    var buildRow = function (s, grade) {
      var absent = LMS.toStr(s.attendance) === '결석';
      var tested = !absent && LMS.toStr(s.test_status) === '실시';
      var ownPaper = tested && LMS.toStr(s.test_own) === 'Y';
      var sid = LMS.toStr(s.student_id);
      if (ownPaper && LMS.isBlank(s.test_max_score)) {
        var who = LMS.findById(table('Students'), 'student_id', sid);
        throw new Error((who ? who.name : sid) + ' 학생 시험지 만점을 입력해 주세요.');
      }
      if (tested && !ownPaper && LMS.isBlank(maxScore)) throw new Error('테스트 만점을 입력해 주세요.');
      var replace = LMS.normalizeHomeworkReplaceClass(s.homework_replace_class);
      var hwTitles = replace ? (personalByStudent[sid] || []) : classHwTitles.concat(personalByStudent[sid] || []);
      var ownText = LMS.toStr(s.progress).trim();
      // Own progress equal to the class progress would stop following later class edits.
      var own = LMS.toStr(s.progress_own) === 'Y' && ownText !== '' && ownText !== classProgress;
      var row = {
        lesson_date: date,
        class_id: classId,
        student_id: sid,
        attendance: absent ? '결석' : '출석',
        test_status: tested ? '실시' : '미실시',
        test_score: tested ? s.test_score : '',
        test_max_score: !tested ? '' : (ownPaper ? s.test_max_score : maxScore),
        test_difficulty: !tested ? '' : (ownPaper ? LMS.toStr(s.test_difficulty) : difficulty),
        test_own: ownPaper ? 'Y' : '',
        test_title: ownPaper ? LMS.toStr(s.test_title) : '',
        assignment_completion: LMS.toStr(s.assignment_completion) || grade || '',
        concentration: absent ? 'ABSENT' : LMS.toStr(s.concentration),
        homework: hwTitles.join('\n'),
        special_note: LMS.toStr(s.special_note),
        student_notice: LMS.toStr(s.student_notice),
        homework_replace_class: replace,
        progress_own: own ? 'Y' : ''
      };
      // Rows without their own progress send none, so the class progress is copied onto them.
      if (own) row.progress = LMS.toStr(s.progress);
      return row;
    };
    // Validate every row up front so a bad score never leaves a half-saved lesson.
    var allowed = recordStudents_(date, classId, ctx.getLessons(date, classId)).students;
    var requireAllowed = function (studentId) {
      var student = ctx.requireStudent(studentId);
      if (!allowed.some(function (a) { return LMS.toStr(a.student_id) === LMS.toStr(studentId); })) {
        throw new Error('이 반 명단에 없는 학생입니다: ' + student.name);
      }
    };
    students.forEach(function (s) {
      requireAllowed(s.student_id);
      LMS.validateLessonInput(buildRow(s, ''));
    });

    var grades = {};
    var prior = p.prior || {};
    var checks = Array.isArray(prior.checks) ? prior.checks : [];
    checks.forEach(function (c) { requireAllowed(c && c.student_id); });
    if (LMS.isIsoDate(LMS.toStr(prior.assigned_date)) && checks.length) {
      var checked = ctx.saveHomeworkChecks({ lesson_date: prior.assigned_date, class_id: classId, check_date: date, checks: checks });
      (checked.grades || []).forEach(function (g) { grades[g.student_id] = g.assignment_completion; });
    }
    if (Array.isArray(p.homework_items)) {
      ctx.saveSessionHomework({ lesson_date: date, class_id: classId, items: p.homework_items });
    }
    students.forEach(function (s) {
      if (!Array.isArray(s.personal_homework) && s.homework_replace_class === undefined) return;
      var hwPayload = {
        lesson_date: date,
        class_id: classId,
        student_id: s.student_id,
        homework_replace_class: s.homework_replace_class
      };
      if (Array.isArray(s.personal_homework)) hwPayload.items = s.personal_homework;
      ctx.saveStudentHomeworkItems(hwPayload);
    });
    ctx.saveClassSession(sessionInput);
    var saved = ctx.saveLessonsBatch(students.map(function (s) {
      return buildRow(s, grades[LMS.toStr(s.student_id)]);
    }));
    // Personal items / replace flags may have landed after the first homework sync.
    sessionSync.afterHomeworkChanged(date, classId);
    var plan = Object.prototype.hasOwnProperty.call(p, 'plan_done_status') && ctx.setDailyPlanDone
      ? ctx.setDailyPlanDone(classId, date, p.plan_done_status) : null;
    return { saved_count: saved.length, grades: grades, lessons: saved, daily_plan: plan };
  }

  return {
    getTodayClassSession: getTodayClassSession,
    saveTodaySession: saveTodaySession
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
