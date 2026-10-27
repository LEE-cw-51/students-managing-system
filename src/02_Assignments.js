/**
 * Class assignments (StudentClasses) read side: who is in a class, and which classes a student
 * attends, answered in one place. Terms follow GLOSSARY.md (다니는 반, 시작 예정 반, 열린 정규 배정,
 * 반 구성원, 수업 기록 대상, 미배정). Server-only: reads tables, so it is not imported by the browser.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: { table(name) → rows, today() → 'YYYY-MM-DD' }. Every query reads the tables again, so
 * results follow saveTable and in-place row edits within the same service instance.
 * A blank date means today. Unknown ids give empty results; callers check existence.
 */
LMS.createAssignments = function (ctx) {
  var table = ctx.table;

  function dateOr(date) {
    return LMS.toStr(date) || ctx.today();
  }

  function same(a, b) {
    return LMS.toStr(a) === LMS.toStr(b);
  }

  function byName(a, b) {
    return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko');
  }

  function byStart(a, b) {
    return LMS.toStr(a.start_date).localeCompare(LMS.toStr(b.start_date));
  }

  /** A 종료 row without an end date never covered any day. */
  function dead(rel) {
    return LMS.toStr(rel.status) === '종료' && !LMS.toStr(rel.end_date);
  }

  /** Regular = not a temporary placement and not in an exam-prep class. */
  function isRegular(rel, classes) {
    if (LMS.toStr(rel.status) === '임시') return false;
    var c = LMS.findById(classes, 'class_id', rel.class_id);
    return !c || LMS.toStr(c.class_type) !== '시험대비';
  }

  function relsOfStudent(studentId) {
    return table('StudentClasses').filter(function (r) { return same(r.student_id, studentId); });
  }

  /** Temporary placements that take students out of this class on the date. */
  function awayFrom(classId, date) {
    var d = dateOr(date);
    return table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.status) === '임시' && same(r.source_class_id, classId) && LMS.relActiveOn(r, d);
    });
  }

  /**
   * 반 구성원: students whose (regular or temporary) assignment covers the date, minus those away
   * in an exam-prep class. 휴원 stays in; 퇴원 only on past dates of an assignment closed with an end date.
   */
  function members(classId, date) {
    var d = dateOr(date);
    var students = table('Students');
    var away = {};
    awayFrom(classId, d).forEach(function (r) { away[LMS.toStr(r.student_id)] = true; });
    var seen = {};
    return table('StudentClasses').filter(function (r) {
      if (!same(r.class_id, classId) || !LMS.relActiveOn(r, d)) return false;
      return LMS.toStr(r.status) === '임시' || !away[LMS.toStr(r.student_id)];
    }).map(function (r) {
      var s = LMS.findById(students, 'student_id', r.student_id);
      if (!s || seen[s.student_id]) return null;
      if (LMS.toStr(s.status) === '퇴원' && (LMS.toStr(r.status) !== '종료' || !LMS.toStr(r.end_date))) return null;
      seen[s.student_id] = true;
      return s;
    }).filter(Boolean).sort(byName);
  }

  /**
   * 수업 기록 대상: members minus 휴원, who come back separately as onLeave. 퇴원 students are
   * already limited by members to past dates they attended, so those dates keep them.
   */
  function recordTargets(classId, date) {
    var all = members(classId, date);
    var onLeave = function (s) { return LMS.toStr(s.status) === '휴원'; };
    return {
      students: all.filter(function (s) { return !onLeave(s); }),
      onLeave: all.filter(onLeave)
    };
  }

  /** Student ids with an assignment in the class at some point in [from, to]. */
  function membersDuring(classId, from, to) {
    var ids = {};
    table('StudentClasses').forEach(function (r) {
      if (!same(r.class_id, classId) || dead(r)) return;
      if (LMS.rangesOverlap(r.start_date, r.end_date, from, to)) ids[LMS.toStr(r.student_id)] = true;
    });
    return Object.keys(ids);
  }

  /** 다니는 반: assignment rows (regular or temporary) covering the date. */
  function attending(studentId, date) {
    var d = dateOr(date);
    return relsOfStudent(studentId).filter(function (r) { return LMS.relActiveOn(r, d); });
  }

  /** 시작 예정 반: open assignments that start after the date. */
  function upcoming(studentId, date) {
    var d = dateOr(date);
    return relsOfStudent(studentId).filter(function (r) {
      return LMS.toStr(r.status) === '현재' && LMS.toStr(r.start_date) > d;
    });
  }

  /** 미배정: a 재원 student with no class on the date and none booked. */
  function isUnassigned(student, date) {
    if (!student || LMS.toStr(student.status) !== '재원') return false;
    return !attending(student.student_id, date).length && !upcoming(student.student_id, date).length;
  }

  /** 열린 정규 배정: regular assignments not ended yet (booked ones included). Targets of move / close / start change. */
  function openRegular(studentId) {
    var classes = table('Classes');
    return relsOfStudent(studentId).filter(function (r) {
      return LMS.toStr(r.status) === '현재' && isRegular(r, classes);
    });
  }

  /** The student's earliest regular assignment (null when none). */
  function firstRegular(studentId) {
    var classes = table('Classes');
    return relsOfStudent(studentId).filter(function (r) {
      return !dead(r) && isRegular(r, classes);
    }).sort(byStart)[0] || null;
  }

  /** Regular class ids the student attends at some point within [from, to]. */
  function regularClassIdsDuring(studentId, from, to) {
    var classes = table('Classes');
    return relsOfStudent(studentId).filter(function (r) {
      if (dead(r) || LMS.toStr(r.status) === '임시') return false;
      var c = LMS.findById(classes, 'class_id', r.class_id);
      if (!c || LMS.toStr(c.class_type) === '시험대비') return false;
      return LMS.rangesOverlap(r.start_date, r.end_date, from, to);
    }).map(function (r) { return LMS.toStr(r.class_id); });
  }

  /**
   * Every assignment row of a class split for the class screen: current (covers the date, not 퇴원),
   * upcoming (booked to start later), past (the rest).
   */
  function classPlacements(classId, date) {
    var d = dateOr(date);
    var students = table('Students');
    var current = [];
    var booked = [];
    var past = [];
    table('StudentClasses').forEach(function (r) {
      if (!same(r.class_id, classId)) return;
      var s = LMS.findById(students, 'student_id', r.student_id);
      var withdrawn = !!s && LMS.toStr(s.status) === '퇴원';
      if (LMS.relActiveOn(r, d) && !withdrawn) current.push(r);
      else if (LMS.toStr(r.status) === '현재' && LMS.toStr(r.start_date) > d && !withdrawn) booked.push(r);
      else past.push(r);
    });
    return { current: current, upcoming: booked, past: past };
  }

  return {
    members: members,
    recordTargets: recordTargets,
    awayFrom: awayFrom,
    membersDuring: membersDuring,
    attending: attending,
    upcoming: upcoming,
    isUnassigned: isUnassigned,
    openRegular: openRegular,
    firstRegular: firstRegular,
    regularClassIdsDuring: regularClassIdsDuring,
    classPlacements: classPlacements
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
