/**
 * Daily and monthly reports: generate, save, bulk, status lists, and class monthly stats.
 * Owns MonthlyReports writes and report text assembly from lessons/homework/counseling ports.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireStudent, requireClass, settings,
 * lessons (getLesson, getLessons, getClassSessionNotice, getStudentLessons),
 * homework (priorLessonDate_, getSessionHomework, effectiveHomeworkItems_),
 * counseling (getCounselingNotes),
 * assignments (recordTargets), today() — for getClassStats roster.
 * Callers run commands inside the service transaction.
 */
LMS.createReports = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var lessons = ctx.lessons;
  var homework = ctx.homework;
  var counseling = ctx.counseling;

  function checkedHomeworkGrades_(lesson) {
    var cls = LMS.findById(table('Classes'), 'class_id', lesson.class_id);
    if (!cls) return [];
    var assigned = homework.priorLessonDate_(cls, lesson.lesson_date);
    if (!assigned) return [];
    var session = homework.getSessionHomework(assigned, lesson.class_id);
    var items = homework.effectiveHomeworkItems_(session.items || [], assigned, lesson.class_id, lesson.student_id);
    return items.map(function (it) {
      var hit = (session.checks || []).filter(function (c) {
        return LMS.toStr(c.item_id) === LMS.toStr(it.item_id) &&
          LMS.toStr(c.student_id) === LMS.toStr(lesson.student_id);
      })[0];
      return { title: LMS.toStr(it.title), grade: hit ? LMS.homeworkGrade(hit.status) : '' };
    }).filter(function (row) { return row.grade && row.title; });
  }

  function generateDailyReport(lessonId) {
    var lesson = lessons.getLesson(lessonId);
    var student = ctx.requireStudent(lesson.student_id);
    var classAvg = LMS.computeDailyClassTestAverage(lessons.getLessons(lesson.lesson_date, lesson.class_id), lesson);
    var notice = lessons.getClassSessionNotice(lesson.lesson_date, lesson.class_id);
    var text = LMS.buildDailyReport(lesson, student, ctx.settings(), classAvg, notice, checkedHomeworkGrades_(lesson));
    return { lesson: lesson, student: student, text: text, class_test_average: classAvg };
  }

  function generateDailyReports(date, classId) {
    var dayLessons = lessons.getLessons(date, classId);
    var set = ctx.settings();
    var students = table('Students');
    var notice = lessons.getClassSessionNotice(date, classId);
    var reports = dayLessons.map(function (lesson) {
      var student = LMS.findById(students, 'student_id', lesson.student_id) || { name: '학생' };
      return {
        lesson_id: lesson.lesson_id,
        student_id: lesson.student_id,
        student_name: student.name,
        text: LMS.buildDailyReport(lesson, student, set, LMS.computeDailyClassTestAverage(dayLessons, lesson), notice, checkedHomeworkGrades_(lesson))
      };
    }).sort(function (a, b) {
      return LMS.toStr(a.student_name).localeCompare(LMS.toStr(b.student_name), 'ko');
    });
    return {
      class_test_average: LMS.computeDailyClassTestAverage(dayLessons, {}),
      reports: reports
    };
  }

  function getMonthlyStats(studentId, year, month) {
    ctx.requireStudent(studentId);
    return LMS.computeMonthlyStats(table('Lessons'), studentId, year, month);
  }

  function slimLessonForReport_(row) {
    return {
      lesson_date: row.lesson_date,
      attendance: row.attendance,
      test_status: row.test_status,
      test_score: row.test_score,
      test_max_score: row.test_max_score,
      test_difficulty: row.test_difficulty,
      assignment_completion: row.assignment_completion,
      concentration: row.concentration,
      progress: row.progress,
      homework: row.homework,
      special_note: row.special_note,
      test_scope: row.test_scope
    };
  }

  function getMonthlyReportContext(studentId, year, month) {
    var student = ctx.requireStudent(studentId);
    var y = Number(year);
    var m = Number(month);
    if (!y || !m || m < 1 || m > 12) {
      throw new Error('연도와 월을 올바르게 입력해 주세요.');
    }
    var range = LMS.monthRange(y, m);
    var monthLessons = lessons.getStudentLessons(studentId, range.start, range.end).map(slimLessonForReport_);
    var stats = LMS.computeMonthlyStats(table('Lessons'), studentId, y, m);
    var set = ctx.settings();
    var baseText = LMS.buildMonthlyReport(stats, student, set);
    var monthNotes = counseling.getCounselingNotes(studentId).filter(function (note) {
      return LMS.inRange(note.counsel_date, range.start, range.end);
    }).map(function (note) {
      return {
        counsel_date: note.counsel_date,
        kind: note.kind,
        content: note.content
      };
    });
    var existing = table('MonthlyReports').filter(function (r) {
      return LMS.toStr(r.student_id) === LMS.toStr(studentId) &&
        Number(r.year) === y &&
        Number(r.month) === m;
    })[0] || null;
    return {
      student: {
        student_id: student.student_id,
        name: student.name,
        grade: student.grade,
        school: student.school,
        status: student.status,
        memo: student.memo
      },
      year: y,
      month: m,
      period: range,
      stats: stats,
      settings: {
        academy_name: set.academy_name,
        teacher_name: set.teacher_name,
        contact: set.contact,
        report_greeting: set.report_greeting,
        report_closing: set.report_closing
      },
      lessons: monthLessons,
      counseling_notes: monthNotes,
      learning_signals: LMS.detectLearningSignals(monthLessons),
      base_text: baseText,
      existing_report: existing
    };
  }

  function generateMonthlyReport(studentId, year, month) {
    var student = ctx.requireStudent(studentId);
    var stats = LMS.computeMonthlyStats(table('Lessons'), studentId, year, month);
    var text = LMS.buildMonthlyReport(stats, student, ctx.settings());
    var existing = table('MonthlyReports').filter(function (r) {
      return LMS.toStr(r.student_id) === LMS.toStr(studentId) &&
        Number(r.year) === Number(year) &&
        Number(r.month) === Number(month);
    })[0] || null;
    return {
      student: student,
      stats: stats,
      text: existing && existing.report_text ? existing.report_text : text,
      generated_text: text,
      existing: existing
    };
  }

  function saveMonthlyReport(data) {
    var studentId = LMS.toStr(data.student_id);
    ctx.requireStudent(studentId);
    var year = Number(data.year);
    var month = Number(data.month);
    if (!year || !month || month < 1 || month > 12) {
      throw new Error('연도와 월을 올바르게 입력해 주세요.');
    }
    var status = LMS.toStr(data.status) || '임시';
    LMS.assertEnum(status, LMS.REPORT_STATUS, '보고서 상태');
    var text = LMS.toStr(data.report_text);
    if (!text) throw new Error('보고서 내용을 입력해 주세요.');
    var rows = table('MonthlyReports');
    var existing = rows.filter(function (r) {
      return LMS.toStr(r.student_id) === studentId &&
        Number(r.year) === year &&
        Number(r.month) === month;
    })[0];
    var ts = ctx.now();
    if (existing) {
      LMS.assertMonthlyReportWritable(existing, text);
      existing.report_text = text;
      existing.status = status;
      existing.updated_at = ts;
      saveTable('MonthlyReports', rows);
      return existing;
    }
    var row = {
      monthly_report_id: ctx.nextIds('MTH', 1)[0],
      student_id: studentId,
      year: year,
      month: month,
      report_text: text,
      generated_at: ts,
      updated_at: ts,
      status: status
    };
    rows.push(row);
    saveTable('MonthlyReports', rows);
    return row;
  }

  /**
   * Basic-template monthly reports for many students. Confirmed (확정) reports are never
   * touched; existing drafts are replaced only with options.overwrite.
   */
  function generateMonthlyReportsBulk(studentIds, year, month, options) {
    options = options || {};
    var y = Number(year);
    var m = Number(month);
    if (!y || !m || m < 1 || m > 12) throw new Error('연도와 월을 올바르게 입력해 주세요.');
    return (studentIds || []).map(function (sid) {
      try {
        var gen = generateMonthlyReport(sid, y, m);
        var existing = gen.existing;
        if (LMS.isMonthlyReportConfirmed(existing)) return { student_id: sid, result: 'skipped', reason: '확정됨' };
        if (existing && !options.overwrite) return { student_id: sid, result: 'skipped', reason: '이미 있음' };
        if (!gen.stats.total_lessons) return { student_id: sid, result: 'skipped', reason: '이 달 수업 기록 없음' };
        var row = saveMonthlyReport({ student_id: sid, year: y, month: m, report_text: gen.generated_text, status: '임시' });
        return { student_id: sid, result: 'created', monthly_report_id: row.monthly_report_id };
      } catch (e) {
        return { student_id: sid, result: 'failed', reason: e.message };
      }
    });
  }

  function listMonthlyReportStatuses(year, month) {
    var y = Number(year);
    var m = Number(month);
    if (!y || !m || m < 1 || m > 12) {
      throw new Error('연도와 월을 올바르게 입력해 주세요.');
    }
    var reports = table('MonthlyReports').filter(function (r) {
      return Number(r.year) === y && Number(r.month) === m;
    });
    var byStudent = {};
    reports.forEach(function (r) {
      byStudent[LMS.toStr(r.student_id)] = r;
    });
    var items = table('Students').filter(function (s) {
      return LMS.toStr(s.status) === '재원';
    }).map(function (s) {
      var report = byStudent[LMS.toStr(s.student_id)];
      var status = 'none';
      if (report && LMS.toStr(report.status)) status = LMS.toStr(report.status);
      return {
        student_id: s.student_id,
        student_name: s.name,
        grade: s.grade,
        status: status,
        monthly_report_id: report ? report.monthly_report_id : '',
        updated_at: report ? report.updated_at : ''
      };
    }).sort(function (a, b) {
      return LMS.toStr(a.student_name).localeCompare(LMS.toStr(b.student_name), 'ko');
    });
    return {
      year: y,
      month: m,
      items: items
    };
  }

  /** Class-wide monthly attendance/test rollup for the stats tab. */
  function getClassStats(classId, year, month) {
    ctx.requireClass(classId);
    var range = LMS.monthRange(year, month);
    var monthLessons = table('Lessons').filter(function (row) {
      return LMS.toStr(row.class_id) === LMS.toStr(classId) &&
        LMS.inRange(row.lesson_date, range.start, range.end);
    });
    // Everyone recorded in the month plus today's roster (temporary classes have no '현재' rows).
    var allStudents = table('Students');
    var roster = ctx.assignments.recordTargets(classId, ctx.today()).students;
    monthLessons.forEach(function (l) {
      if (roster.some(function (s) { return s.student_id === l.student_id; })) return;
      var st = LMS.findById(allStudents, 'student_id', l.student_id);
      if (st) roster.push(st);
    });
    roster.sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); });
    var students = roster.map(function (s) {
      var stats = LMS.computeMonthlyStats(monthLessons, s.student_id, year, month);
      return {
        student_id: s.student_id,
        name: s.name,
        stats: stats
      };
    });
    var scores = [];
    var present = 0;
    var absent = 0;
    students.forEach(function (s) {
      present += s.stats.present_count;
      absent += s.stats.absent_count;
      if (s.stats.test_average !== null) scores.push(s.stats.test_average);
    });
    var classAvg = null;
    if (scores.length) {
      var sum = 0;
      scores.forEach(function (n) { sum += n; });
      classAvg = sum / scores.length;
    }
    return {
      class_id: classId,
      year: Number(year),
      month: Number(month),
      student_count: students.length,
      present_count: present,
      absent_count: absent,
      test_average: classAvg,
      test_average_display: LMS.formatAverageDisplay(classAvg),
      students: students
    };
  }

  return {
    generateDailyReport: generateDailyReport,
    generateDailyReports: generateDailyReports,
    getMonthlyStats: getMonthlyStats,
    getMonthlyReportContext: getMonthlyReportContext,
    generateMonthlyReport: generateMonthlyReport,
    saveMonthlyReport: saveMonthlyReport,
    generateMonthlyReportsBulk: generateMonthlyReportsBulk,
    listMonthlyReportStatuses: listMonthlyReportStatuses,
    getClassStats: getClassStats
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
