/**
 * Class assignments (StudentClasses): who is in a class, which classes a student attends, and every
 * change to those rows (regular assignments, exam-prep placements, resume dates of exam periods).
 * Terms follow GLOSSARY.md (다니는 반, 시작 예정 반, 열린 정규 배정, 반 구성원, 수업 기록 대상, 미배정).
 * Server-only: reads tables, so it is not imported by the browser.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: { table(name) → rows, saveTable(name, rows), today() → 'YYYY-MM-DD', now() → timestamp,
 * nextIds(prefix, count) }. Every query reads the tables again, so results follow saveTable and
 * in-place row edits within the same service instance. A blank date means today. Unknown ids give
 * empty query results; commands throw. Commands do not lock: callers hold the store lock.
 */
LMS.createAssignments = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

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

  /** Whether an assignment (regular or temporary) puts the student in the class on the date. */
  function inClassOn(studentId, classId, date) {
    var d = dateOr(date);
    return relsOfStudent(studentId).some(function (r) { return same(r.class_id, classId) && LMS.relActiveOn(r, d); });
  }

  /** Every assignment row of the student, latest start first. */
  function history(studentId) {
    return relsOfStudent(studentId).sort(function (a, b) { return byStart(b, a); });
  }

  /** Temporary placements in any of the (exam-prep) classes. */
  function tempPlacements(classIds) {
    var ids = (classIds || []).map(LMS.toStr);
    return table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.status) === '임시' && ids.indexOf(LMS.toStr(r.class_id)) !== -1;
    });
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

  // ----- Changes -----

  function now() {
    return ctx.now();
  }

  function saveRels() {
    saveTable('StudentClasses', table('StudentClasses'));
  }

  function requireStudent(studentId) {
    var row = LMS.findById(table('Students'), 'student_id', studentId);
    if (!row) throw new Error('학생 정보를 찾을 수 없습니다.');
    return row;
  }

  function requireClass(classId) {
    var row = LMS.findById(table('Classes'), 'class_id', classId);
    if (!row) throw new Error('반 정보를 찾을 수 없습니다.');
    return row;
  }

  function requirePeriod(periodId) {
    var row = LMS.findById(table('ExamPeriods'), 'exam_period_id', periodId);
    if (!row) throw new Error('시험대비 기간을 찾을 수 없습니다.');
    return row;
  }

  /** First lesson date of the student in the class on or after `from` ('' when none). */
  function lessonOnOrAfter(studentId, classId, from) {
    return table('Lessons').filter(function (l) {
      return same(l.student_id, studentId) && same(l.class_id, classId) && LMS.toStr(l.lesson_date) >= from;
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort()[0] || '';
  }

  /** Last lesson date of the student in the class ('' when none). */
  function lastLessonIn(studentId, classId) {
    return table('Lessons').filter(function (l) {
      return same(l.student_id, studentId) && same(l.class_id, classId);
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort().pop() || '';
  }

  /**
   * End a current assignment because the student left or the class closed: the last day is
   * yesterday, or the last lesson recorded in that class when it is later. Changes the row in place.
   */
  function endForClosing(rel, lastDay) {
    var end = lastDay || LMS.addDays(ctx.today(), -1);
    var last = lastLessonIn(rel.student_id, rel.class_id);
    if (last > end) end = last;
    if (end < LMS.toStr(rel.start_date)) end = LMS.toStr(rel.start_date);
    rel.end_date = end;
    rel.status = '종료';
    rel.updated_at = now();
  }

  /** Another assignment of the student in the same class whose period overlaps [start, end] (null when none). */
  function sameClassOverlap(studentId, classId, start, end, ignoreId) {
    return table('StudentClasses').filter(function (r) {
      if (same(r.id, ignoreId) || LMS.toStr(r.status) === '임시') return false;
      if (!same(r.student_id, studentId) || !same(r.class_id, classId)) return false;
      if (dead(r)) return false;
      return LMS.rangesOverlap(r.start_date, r.end_date, start, end);
    })[0] || null;
  }

  function examClassIds(periodId) {
    return table('Classes').filter(function (c) {
      return same(c.exam_period_id, periodId) && LMS.toStr(c.class_type) === '시험대비';
    }).map(function (c) { return LMS.toStr(c.class_id); });
  }

  /**
   * Batch start, individual return: each suspended class stays off until its first moved
   * student is back, then meets with whoever has returned (students still away are left
   * off its roster by members). Last suspended day = earliest end among its moved students'
   * temporary assignments. No moved students → period end.
   */
  function recomputeResume(periodId) {
    var periods = table('ExamPeriods');
    var period = LMS.findById(periods, 'exam_period_id', periodId);
    if (!period) return;
    var temp = tempPlacements(examClassIds(periodId));
    var map = {};
    LMS.suspendedClassIds(period).forEach(function (classId) {
      var last = '';
      temp.forEach(function (r) {
        var sources = regularClassIdsDuring(r.student_id, period.start_date, period.end_date);
        if (sources.indexOf(classId) === -1 && LMS.toStr(r.source_class_id) !== classId) return;
        var end = LMS.toStr(r.end_date) || period.end_date;
        if (!last || end < last) last = end;
      });
      map[classId] = last && last < period.end_date ? last : period.end_date;
    });
    period.class_resume_dates = map;
    period.updated_at = now();
    saveTable('ExamPeriods', periods);
  }

  function periodOfClass(classId) {
    var cls = LMS.findById(table('Classes'), 'class_id', classId);
    return cls && cls.exam_period_id ? LMS.toStr(cls.exam_period_id) : '';
  }

  /**
   * After regular assignments change ([{ student_id, start, end }] = the ranges they covered): placements
   * whose source class the student no longer attends in that range point at one they do (as in
   * migrateToV4_; kept when there is none), and resume dates of overlapping periods are recomputed.
   */
  function syncExamPrep(changes) {
    var rels = table('StudentClasses');
    var touched = {};
    var changed = false;
    var ts = now();
    changes.forEach(function (c) {
      rels.forEach(function (r) {
        if (LMS.toStr(r.status) !== '임시' || !same(r.student_id, c.student_id)) return;
        var sources = regularClassIdsDuring(r.student_id, r.start_date, r.end_date);
        if (!sources.length || sources.indexOf(LMS.toStr(r.source_class_id)) !== -1) return;
        r.source_class_id = sources[0];
        r.updated_at = ts;
        changed = true;
        var pid = periodOfClass(r.class_id);
        if (pid) touched[pid] = true;
      });
      table('ExamPeriods').forEach(function (p) {
        if (LMS.rangesOverlap(p.start_date, p.end_date, c.start, c.end)) touched[LMS.toStr(p.exam_period_id)] = true;
      });
    });
    if (changed) saveRels();
    Object.keys(touched).forEach(recomputeResume);
  }

  /**
   * The student stopped attending `sourceClassId` after `lastDay` (every class on withdrawal, with a
   * blank source). Their placements away from it that run past lastDay: point at another regular class
   * attended then (not on withdrawal), else end on lastDay, or are deleted when they start later.
   * Lessons recorded in the exam class keep a placement up to the last of them.
   */
  function endTempAfter(studentId, sourceClassId, lastDay, withdrawal) {
    var rels = table('StudentClasses');
    var drop = [];
    var touched = {};
    var changed = false;
    var ts = now();
    rels.slice().forEach(function (r) {
      if (LMS.toStr(r.status) !== '임시' || !same(r.student_id, studentId)) return;
      if (sourceClassId && !same(r.source_class_id, sourceClassId)) return;
      var start = LMS.toStr(r.start_date);
      var end = LMS.toStr(r.end_date);
      if (end && end <= lastDay) return;
      var from = start > lastDay ? start : LMS.addDays(lastDay, 1);
      var sources = withdrawal ? [] : regularClassIdsDuring(studentId, from, end);
      if (sources.indexOf(LMS.toStr(r.source_class_id)) !== -1) return;
      if (sources.length) {
        if (start < from) {
          rels.push(Object.assign({}, r, {
            id: ctx.nextIds('REL', 1)[0], start_date: from, source_class_id: sources[0], created_at: ts
          }));
          r.end_date = lastDay;
        } else {
          r.source_class_id = sources[0];
        }
      } else {
        var lastLesson = table('Lessons').filter(function (l) {
          return same(l.student_id, studentId) && same(l.class_id, r.class_id) && LMS.inRange(l.lesson_date, start, end);
        }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort().pop() || '';
        if (start > lastDay && !lastLesson) drop.push(r);
        else r.end_date = lastLesson > lastDay ? lastLesson : lastDay;
      }
      r.updated_at = ts;
      changed = true;
      var pid = periodOfClass(r.class_id);
      if (pid) touched[pid] = true;
    });
    if (!changed) return;
    saveTable('StudentClasses', rels.filter(function (r) { return drop.indexOf(r) === -1; }));
    Object.keys(touched).forEach(recomputeResume);
  }

  /**
   * New regular assignment. skipSync: the caller syncs exam-prep placements itself, or the
   * student is new and has none.
   */
  function assign(data, skipSync) {
    var studentId = LMS.toStr(data.student_id);
    var classId = LMS.toStr(data.class_id);
    var student = requireStudent(studentId);
    var cls = requireClass(classId);
    if (LMS.toStr(student.status) === '퇴원') throw new Error('퇴원한 학생은 반에 배정할 수 없습니다.');
    if (LMS.toStr(cls.status) !== '운영') throw new Error('종료된 반에는 배정할 수 없습니다.');
    if (LMS.toStr(cls.class_type) === '시험대비') throw new Error('시험대비 반은 시험 화면에서 편성해 주세요.');
    var start = LMS.toStr(data.start_date) || ctx.today();
    if (!LMS.isIsoDate(start)) throw new Error('반 시작일 형식이 올바르지 않습니다.');
    var rels = table('StudentClasses');
    var exists = rels.some(function (r) {
      return same(r.student_id, studentId) && same(r.class_id, classId) && LMS.toStr(r.status) === '현재';
    });
    if (exists) throw new Error('이미 해당 반에 소속되어 있습니다.');
    var clash = sameClassOverlap(studentId, classId, start, '', '');
    if (clash) throw new Error('이 반의 이전 배정(' + clash.start_date + ' ~ ' + clash.end_date + ')과 기간이 겹칩니다. 시작일을 ' + LMS.addDays(clash.end_date, 1) + ' 이후로 잡아 주세요.');
    var ts = now();
    var row = {
      id: ctx.nextIds('REL', 1)[0],
      student_id: studentId,
      class_id: classId,
      start_date: start,
      end_date: '',
      status: '현재',
      created_at: ts,
      updated_at: ts
    };
    rels.push(row);
    saveTable('StudentClasses', rels);
    if (!skipSync) syncExamPrep([{ student_id: row.student_id, start: row.start_date, end: '' }]);
    return row;
  }

  /** Why the regular assignment cannot start on `start`, or '' when it can. */
  function startProblem(rel, start) {
    if (!rel || LMS.toStr(rel.status) === '임시') return '시험대비 임시 배정은 시험 화면에서 바꿔 주세요.';
    if (!LMS.isIsoDate(start)) return '시작일 형식이 올바르지 않습니다.';
    var end = LMS.toStr(rel.end_date);
    if (end && start > end) return '시작일은 이 배정의 마지막 수업일(' + end + ')보다 늦을 수 없습니다.';
    var first = table('Lessons').filter(function (l) {
      var d = LMS.toStr(l.lesson_date);
      return same(l.student_id, rel.student_id) && same(l.class_id, rel.class_id) &&
        d >= LMS.toStr(rel.start_date) && (!end || d <= end);
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort()[0];
    if (first && start > first) return '이 반 수업 기록이 ' + first + '부터 있어 시작일을 그 뒤로 옮길 수 없습니다.';
    var clash = sameClassOverlap(rel.student_id, rel.class_id, start, end, rel.id);
    if (clash) return '이 반의 다른 배정(' + clash.start_date + ' ~ ' + (clash.end_date || '현재') + ')과 기간이 겹칩니다.';
    // A move ends the old class the day before the new one starts; pulling the start earlier would overlap it.
    var dayBefore = LMS.addDays(LMS.toStr(rel.start_date), -1);
    var prev = table('StudentClasses').filter(function (r) {
      return same(r.student_id, rel.student_id) && LMS.toStr(r.status) === '종료' &&
        !same(r.class_id, rel.class_id) && LMS.toStr(r.end_date) === dayBefore;
    })[0];
    if (prev && start <= dayBefore) {
      var pc = LMS.findById(table('Classes'), 'class_id', prev.class_id);
      return '반 이동으로 시작한 배정입니다. 이전 반(' + (pc ? pc.class_name : prev.class_id) + ')의 마지막 수업일(' + dayBefore + ') 다음 날보다 앞당길 수 없습니다.';
    }
    return '';
  }

  /** Recorded class days in the newly covered range on which the student has no lesson. */
  function startMissingDates(rel, start) {
    var from = LMS.toStr(start);
    var to = LMS.addDays(LMS.toStr(rel.start_date), -1);
    if (!from || from > to) return [];
    var cid = LMS.toStr(rel.class_id);
    var dates = {};
    table('ClassSessions').concat(table('Lessons')).forEach(function (r) {
      if (LMS.toStr(r.class_id) === cid && LMS.inRange(r.lesson_date, from, to)) dates[LMS.toStr(r.lesson_date)] = true;
    });
    table('Lessons').forEach(function (l) {
      if (LMS.toStr(l.class_id) === cid && same(l.student_id, rel.student_id)) delete dates[LMS.toStr(l.lesson_date)];
    });
    return Object.keys(dates).sort();
  }

  function applyStart(rel, start) {
    var from = start < LMS.toStr(rel.start_date) ? start : LMS.toStr(rel.start_date);
    rel.start_date = start;
    rel.updated_at = now();
    saveRels();
    // Resume dates of exam-prep periods are computed from regular assignment ranges.
    table('ExamPeriods').forEach(function (p) {
      if (LMS.rangesOverlap(p.start_date, p.end_date, from, rel.end_date)) recomputeResume(p.exam_period_id);
    });
    return rel;
  }

  /** Check a start-date change before saving: the blocking reason, and class days that would show this student unrecorded. */
  function previewStart(data) {
    data = data || {};
    var rel = LMS.findById(table('StudentClasses'), 'id', data.id);
    if (!rel) throw new Error('반 배정 정보를 찾을 수 없습니다.');
    var start = LMS.toStr(data.start_date);
    var problem = startProblem(rel, start);
    var missing = problem ? [] : startMissingDates(rel, start);
    return { id: rel.id, start_date: start, problem: problem, missing_dates: missing, missing_count: missing.length };
  }

  /** Change when a regular assignment starts (e.g. a student entered with today's date for an earlier class). */
  function changeStart(data) {
    data = data || {};
    var rel = LMS.findById(table('StudentClasses'), 'id', data.id);
    if (!rel) throw new Error('반 배정 정보를 찾을 수 없습니다.');
    var start = LMS.toStr(data.start_date);
    var problem = startProblem(rel, start);
    if (problem) throw new Error(problem);
    return applyStart(rel, start);
  }

  /**
   * The enrollment date moved from `prev` to `next`: the first regular assignment follows when it
   * started on `prev`. null when there is none to follow, else { synced, problem }.
   */
  function followEnrollment(studentId, prev, next) {
    var first = firstRegular(studentId);
    if (!first || LMS.toStr(first.start_date) !== prev) return null;
    var problem = startProblem(first, next);
    if (problem) return { synced: false, problem: problem };
    applyStart(first, next);
    return { synced: true, problem: '' };
  }

  /**
   * The one assignment a move or removal acts on: by relation id, by class, or the only regular
   * class. A student in two classes must say which one, so moving never ends both.
   */
  function pickRel(studentId, relId, classId) {
    var rels = openRegular(studentId);
    if (relId) {
      var byId = LMS.findById(table('StudentClasses'), 'id', relId);
      if (!byId || !same(byId.student_id, studentId)) throw new Error('반 배정 정보를 찾을 수 없습니다.');
      if (LMS.toStr(byId.status) === '임시') throw new Error('시험대비 임시 배정은 시험 화면에서 바꿔 주세요.');
      if (LMS.toStr(byId.status) !== '현재') throw new Error('이미 끝난 반 배정입니다.');
      return byId;
    }
    if (classId) {
      var byClass = rels.filter(function (r) { return same(r.class_id, classId); })[0];
      if (!byClass) throw new Error('현재 반 배정 정보를 찾을 수 없습니다.');
      return byClass;
    }
    if (!rels.length) throw new Error('지금 다니는 반이 없습니다. 반 배정을 써 주세요.');
    if (rels.length > 1) throw new Error('두 반 이상 다니는 학생입니다. 어느 반에서 옮길지 골라 주세요.');
    return rels[0];
  }

  /** Why moving this assignment to the class on the date is not allowed, or '' when it is. */
  function moveProblem(rel, toClassId, start) {
    if (!LMS.isIsoDate(start)) return '이동일 형식이 올바르지 않습니다.';
    if (same(rel.class_id, toClassId)) return '지금 다니는 반과 같은 반입니다.';
    var cls = LMS.findById(table('Classes'), 'class_id', toClassId);
    if (!cls) return '옮겨 갈 반을 찾을 수 없습니다.';
    if (LMS.toStr(cls.status) !== '운영') return '종료된 반으로는 옮길 수 없습니다.';
    if (LMS.toStr(cls.class_type) === '시험대비') return '시험대비 반은 시험 화면에서 편성해 주세요.';
    var already = openRegular(rel.student_id).some(function (r) { return same(r.class_id, toClassId); });
    if (already) return '이미 ' + cls.class_name + '에 다니고 있습니다.';
    if (start <= LMS.toStr(rel.start_date)) {
      return '이동일은 지금 반 시작일(' + rel.start_date + ') 다음 날부터 고를 수 있습니다. 잘못 넣은 배정이면 배정 삭제 후 다시 배정해 주세요.';
    }
    var later = lessonOnOrAfter(rel.student_id, rel.class_id, start);
    if (later) return '이동일 이후(' + later + ') 지금 반에 수업 기록이 있습니다. 이동일을 그 뒤로 잡아 주세요.';
    return '';
  }

  /**
   * Exam-prep placements name the regular class the student is away from. From `start` on, the
   * days are away from `toClassId` instead (a placement spanning `start` is split).
   */
  function moveTempSource(studentId, fromClassId, toClassId, start) {
    var rels = table('StudentClasses');
    var touched = {};
    var ts = now();
    rels.slice().forEach(function (r) {
      if (LMS.toStr(r.status) !== '임시' || !same(r.student_id, studentId)) return;
      if (LMS.toStr(r.source_class_id) !== fromClassId || LMS.toStr(r.end_date) < start) return;
      if (LMS.toStr(r.start_date) >= start) {
        r.source_class_id = toClassId;
      } else {
        rels.push(Object.assign({}, r, {
          id: ctx.nextIds('REL', 1)[0], start_date: start, source_class_id: toClassId, created_at: ts
        }));
        r.end_date = LMS.addDays(start, -1);
      }
      r.updated_at = ts;
      var pid = periodOfClass(r.class_id);
      if (pid) touched[pid] = true;
    });
    if (!Object.keys(touched).length) return;
    saveTable('StudentClasses', rels);
    Object.keys(touched).forEach(recomputeResume);
  }

  function applyMove(rel, toClassId, start) {
    rel.end_date = LMS.addDays(start, -1);
    rel.status = '종료';
    rel.updated_at = now();
    saveRels();
    var created = assign({ student_id: rel.student_id, class_id: toClassId, start_date: start }, true);
    moveTempSource(rel.student_id, LMS.toStr(rel.class_id), LMS.toStr(toClassId), start);
    syncExamPrep([{ student_id: rel.student_id, start: LMS.toStr(rel.start_date), end: '' }]);
    return created;
  }

  /** Move one student: from_rel_id / from_class_id picks the class they leave (required with two). */
  function move(data) {
    data = data || {};
    var studentId = LMS.toStr(data.student_id);
    var newClassId = LMS.toStr(data.class_id);
    requireStudent(studentId);
    requireClass(newClassId);
    var start = LMS.toStr(data.start_date) || ctx.today();
    var rel = pickRel(studentId, LMS.toStr(data.from_rel_id || data.current_rel_id), LMS.toStr(data.from_class_id));
    var problem = moveProblem(rel, newClassId, start);
    if (problem) throw new Error(problem);
    return applyMove(rel, newClassId, start);
  }

  /**
   * Move several students of one class together. Every student is checked first; if any cannot
   * move, nothing changes and the reasons come back per student.
   */
  function moveMany(data) {
    data = data || {};
    var fromId = LMS.toStr(data.from_class_id);
    var toId = LMS.toStr(data.to_class_id);
    requireClass(fromId);
    requireClass(toId);
    var start = LMS.toStr(data.date) || ctx.today();
    var ids = LMS.uniqueIds(data.student_ids);
    if (!ids.length) throw new Error('옮길 학생을 골라 주세요.');
    var students = table('Students');
    var plan = [];
    var problems = [];
    ids.forEach(function (sid) {
      var st = LMS.findById(students, 'student_id', sid);
      var name = st ? st.name : sid;
      var rel = openRegular(sid).filter(function (r) { return LMS.toStr(r.class_id) === fromId; })[0];
      var problem = rel ? moveProblem(rel, toId, start) : '이 반의 정규 배정이 아닙니다.';
      if (problem) problems.push(name + ': ' + problem);
      else plan.push(rel);
    });
    if (problems.length) throw new Error('옮기지 않았습니다.\n' + problems.join('\n'));
    var moved = plan.map(function (rel) { return applyMove(rel, toId, start); });
    return { moved_count: moved.length };
  }

  /** Take a student out of a class: the assignment ends on end_date (today when blank). */
  function close(data) {
    data = data || {};
    var rels = table('StudentClasses');
    var row = data.id ? LMS.findById(rels, 'id', data.id) : null;
    if (!row && data.student_id && data.class_id) {
      row = openRegular(data.student_id).filter(function (r) { return same(r.class_id, data.class_id); })[0];
    }
    if (!row || LMS.toStr(row.status) !== '현재') throw new Error('현재 반 배정 정보를 찾을 수 없습니다.');
    var end = LMS.toStr(data.end_date) || ctx.today();
    if (!LMS.isIsoDate(end)) throw new Error('반 종료일 형식이 올바르지 않습니다.');
    if (end < LMS.toStr(row.start_date)) throw new Error('마지막 수업일이 반 시작일(' + row.start_date + ')보다 빠릅니다. 잘못 넣은 배정이면 배정 삭제를 써 주세요.');
    var later = lessonOnOrAfter(row.student_id, row.class_id, LMS.addDays(end, 1));
    if (later) throw new Error('마지막 수업일 뒤(' + later + ')에 이 반 수업 기록이 있습니다. 날짜를 그 뒤로 잡아 주세요.');
    row.end_date = end;
    row.status = '종료';
    row.updated_at = now();
    saveTable('StudentClasses', rels);
    endTempAfter(row.student_id, LMS.toStr(row.class_id), end, false);
    syncExamPrep([{ student_id: row.student_id, start: LMS.toStr(row.start_date), end: '' }]);
    return row;
  }

  /** Whether a regular assignment left no trace (no lessons or homework checks) and can be deleted. */
  function removable(rel) {
    if (!rel || LMS.toStr(rel.status) === '임시') return false;
    var sid = LMS.toStr(rel.student_id);
    var cid = LMS.toStr(rel.class_id);
    var hasLesson = table('Lessons').some(function (l) {
      return LMS.toStr(l.student_id) === sid && LMS.toStr(l.class_id) === cid;
    });
    if (hasLesson) return false;
    var items = {};
    table('HomeworkItems').forEach(function (it) { if (LMS.toStr(it.class_id) === cid) items[LMS.toStr(it.item_id)] = true; });
    return !table('HomeworkChecks').some(function (c) { return LMS.toStr(c.student_id) === sid && items[LMS.toStr(c.item_id)]; });
  }

  /** Delete an assignment made by mistake. Only when the student has no records in that class. */
  function remove(data) {
    var rels = table('StudentClasses');
    var row = LMS.findById(rels, 'id', data && data.id);
    if (!row) throw new Error('반 배정 정보를 찾을 수 없습니다.');
    if (LMS.toStr(row.status) === '임시') throw new Error('시험대비 임시 배정은 시험 화면에서 바꿔 주세요.');
    if (!removable(row)) throw new Error('이 반에 수업 기록이나 숙제 체크가 있어 삭제할 수 없습니다. ‘반에서 빼기’를 써 주세요.');
    saveTable('StudentClasses', rels.filter(function (r) { return r !== row; }));
    endTempAfter(row.student_id, LMS.toStr(row.class_id), LMS.addDays(LMS.toStr(row.start_date), -1), false);
    syncExamPrep([{ student_id: row.student_id, start: LMS.toStr(row.start_date), end: LMS.toStr(row.end_date) }]);
    return { deleted: true, id: row.id };
  }

  /**
   * The student withdrew: every open regular assignment ends (see endForClosing), and so does every
   * exam-prep placement running past the latest of those ends (yesterday when none was open).
   */
  function endForWithdrawal(studentId) {
    var lastDay = LMS.addDays(ctx.today(), -1);
    var ended = openRegular(studentId).map(function (r) {
      var change = { student_id: r.student_id, start: LMS.toStr(r.start_date), end: '' };
      endForClosing(r);
      if (r.end_date > lastDay) lastDay = r.end_date;
      return change;
    });
    saveRels();
    endTempAfter(studentId, '', lastDay, true);
    syncExamPrep(ended);
  }

  /** The regular class closed: its open assignments end (see endForClosing), with placements away from it. */
  function endForClassClose(classId) {
    var closed = table('StudentClasses').filter(function (r) {
      return same(r.class_id, classId) && LMS.toStr(r.status) === '현재';
    });
    var ended = closed.map(function (r) {
      var change = { student_id: r.student_id, start: LMS.toStr(r.start_date), end: '' };
      endForClosing(r);
      return change;
    });
    saveRels();
    closed.forEach(function (r) { endTempAfter(r.student_id, LMS.toStr(classId), r.end_date, false); });
    syncExamPrep(ended);
  }

  /** Throws when the student already has an exam-prep placement overlapping [start, end]. */
  function assertNoTempOverlap(studentId, start, end, ignoreRelId) {
    var clash = table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.status) === '임시' && same(r.student_id, studentId) &&
        !same(r.id, ignoreRelId) && LMS.rangesOverlap(r.start_date, r.end_date, start, end);
    })[0];
    if (clash) {
      var s = LMS.findById(table('Students'), 'student_id', studentId);
      throw new Error((s ? s.name : studentId) + ' 학생은 그 기간에 이미 다른 시험대비 반에 배정되어 있습니다.');
    }
  }

  /** Placements in a new exam-prep class: [{ student_id, source_class_id, start_date, end_date }], already checked. */
  function placeTemp(classId, students) {
    var rels = table('StudentClasses');
    var ids = ctx.nextIds('REL', students.length);
    var ts = now();
    students.forEach(function (st, i) {
      rels.push({
        id: ids[i], student_id: st.student_id, class_id: classId,
        start_date: st.start_date, end_date: st.end_date, status: '임시',
        assignment_type: '임시', source_class_id: st.source_class_id, created_at: ts, updated_at: ts
      });
    });
    saveTable('StudentClasses', rels);
  }

  function addTemp(data) {
    var cls = requireClass(data.class_id);
    if (LMS.toStr(cls.class_type) !== '시험대비') throw new Error('시험대비 반이 아닙니다.');
    var period = requirePeriod(cls.exam_period_id);
    var sid = LMS.toStr(data.student_id);
    requireStudent(sid);
    var start = LMS.toStr(data.start_date) || period.start_date;
    var end = LMS.toStr(data.end_date) || period.end_date;
    if (start < period.start_date || end > period.end_date || end < start) throw new Error('날짜는 시험대비 기간 안이어야 합니다.');
    assertNoTempOverlap(sid, start, end);
    var rels = table('StudentClasses');
    var ts = now();
    var row = {
      id: ctx.nextIds('REL', 1)[0], student_id: sid, class_id: cls.class_id, start_date: start, end_date: end,
      status: '임시', assignment_type: '임시',
      source_class_id: LMS.toStr(data.source_class_id) || regularClassIdsDuring(sid, start, end)[0] || '',
      created_at: ts, updated_at: ts
    };
    rels.push(row);
    saveTable('StudentClasses', rels);
    recomputeResume(period.exam_period_id);
    return row;
  }

  function tempRel(relId) {
    var rels = table('StudentClasses');
    var rel = LMS.findById(rels, 'id', relId);
    if (!rel || LMS.toStr(rel.status) !== '임시') throw new Error('시험대비 배정을 찾을 수 없습니다.');
    var cls = requireClass(rel.class_id);
    return { rels: rels, rel: rel, cls: cls, period: requirePeriod(cls.exam_period_id) };
  }

  /** Early return: the temporary assignment ends on `date` (last day in the exam class). */
  function endTemp(relId, date) {
    var t = tempRel(relId);
    var d = LMS.toStr(date);
    if (!LMS.isIsoDate(d)) throw new Error('마지막 수업일을 입력해 주세요.');
    if (d < LMS.toStr(t.rel.start_date)) throw new Error('마지막 수업일이 시작일보다 빠릅니다. 배정을 빼려면 ‘제외’를 쓰세요.');
    if (d > t.period.end_date) throw new Error('마지막 수업일은 시험대비 기간 안이어야 합니다.');
    t.rel.end_date = d;
    t.rel.updated_at = now();
    saveTable('StudentClasses', t.rels);
    recomputeResume(t.period.exam_period_id);
    return t.rel;
  }

  function removeTemp(relId) {
    var t = tempRel(relId);
    var hasLessons = table('Lessons').some(function (l) {
      return same(l.class_id, t.rel.class_id) && same(l.student_id, t.rel.student_id);
    });
    if (hasLessons) throw new Error('이미 이 반 수업 기록이 있어 뺄 수 없습니다. ‘조기 복귀’로 마지막 수업일을 정하세요.');
    saveTable('StudentClasses', t.rels.filter(function (r) { return r !== t.rel; }));
    recomputeResume(t.period.exam_period_id);
    return true;
  }

  /** Keep the period's placements inside its (new) dates, then recompute its resume dates. */
  function clampTempToPeriod(period) {
    var rels = table('StudentClasses');
    var ids = examClassIds(period.exam_period_id);
    var changed = false;
    rels.forEach(function (r) {
      if (LMS.toStr(r.status) !== '임시' || ids.indexOf(LMS.toStr(r.class_id)) === -1) return;
      if (!r.start_date || r.start_date < period.start_date) { r.start_date = period.start_date; changed = true; }
      if (!r.end_date || r.end_date > period.end_date) { r.end_date = period.end_date; changed = true; }
      if (r.end_date < r.start_date) { r.end_date = r.start_date; changed = true; }
    });
    if (changed) saveTable('StudentClasses', rels);
    recomputeResume(period.exam_period_id);
  }

  /** Delete every assignment row in the classes (an exam period being deleted). */
  function dropForClasses(classIds) {
    saveTable('StudentClasses', table('StudentClasses').filter(function (r) {
      return classIds.indexOf(LMS.toStr(r.class_id)) === -1;
    }));
  }

  return {
    members: members,
    recordTargets: recordTargets,
    awayFrom: awayFrom,
    membersDuring: membersDuring,
    attending: attending,
    inClassOn: inClassOn,
    history: history,
    tempPlacements: tempPlacements,
    upcoming: upcoming,
    isUnassigned: isUnassigned,
    openRegular: openRegular,
    firstRegular: firstRegular,
    regularClassIdsDuring: regularClassIdsDuring,
    classPlacements: classPlacements,
    removable: removable,
    assign: assign,
    previewStart: previewStart,
    changeStart: changeStart,
    followEnrollment: followEnrollment,
    move: move,
    moveMany: moveMany,
    close: close,
    remove: remove,
    endForWithdrawal: endForWithdrawal,
    endForClassClose: endForClassClose,
    assertNoTempOverlap: assertNoTempOverlap,
    placeTemp: placeTemp,
    addTemp: addTemp,
    endTemp: endTemp,
    removeTemp: removeTemp,
    clampTempToPeriod: clampTempToPeriod,
    dropForClasses: dropForClasses,
    recomputeResume: recomputeResume,
    // Row-level helpers kept for migrateToV4_.
    endForClosing: endForClosing,
    lastLessonIn: lastLessonIn
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
