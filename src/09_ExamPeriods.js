/**
 * 시험대비 기간 (ExamPeriods rows): which classes are the period's exam-prep classes, which regular
 * classes it suspends, and when each suspended class resumes. Every write to ExamPeriods rows goes
 * through here; placements (StudentClasses) are written only by the assignment module, which this
 * module calls. Terms follow GLOSSARY.md (시험대비 반, 휴강 반, 마지막 휴강일, 복귀일).
 * Server-only: reads tables, so it is not imported by the browser.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
  require('./04_SchoolExams.js');
}

/**
 * ctx: { table(name) → rows, saveTable(name, rows), today() → 'YYYY-MM-DD', now() → timestamp,
 * nextIds(prefix, count), assignments (02_Assignments.js), requireStudent(id) → row or throws }.
 * Queries read the tables again on every call. Commands throw a Korean message; callers run them
 * inside the service transaction. check.<command> answers whether a command would go through,
 * with the message it would throw ('' when it would).
 */
LMS.createExamPeriods = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var assignments = ctx.assignments;

  var NO_PERIOD = '시험대비 기간을 찾을 수 없습니다.';
  var HAS_LESSONS = '수업 기록이 있는 시험대비 기간은 삭제할 수 없습니다. ‘기간 마감’을 쓰세요.';

  function same(a, b) {
    return LMS.toStr(a) === LMS.toStr(b);
  }

  function isExamClass(cls) {
    return LMS.toStr(cls.class_type) === '시험대비';
  }

  function find(periodId) {
    return LMS.findById(table('ExamPeriods'), 'exam_period_id', periodId);
  }

  function requirePeriod(periodId) {
    var row = find(periodId);
    if (!row) throw new Error(NO_PERIOD);
    return row;
  }

  /** 시험대비 반: the exam-prep classes made for the period (closed ones included). */
  function classes(periodId) {
    return table('Classes').filter(function (c) {
      return same(c.exam_period_id, periodId) && isExamClass(c);
    });
  }

  function classIds(periodId) {
    return classes(periodId).map(function (c) { return LMS.toStr(c.class_id); });
  }

  /** '예정' · '진행 중' · '끝남' (dates passed, not closed) · '마감' · '취소'. */
  function state(period, today) {
    var st = LMS.toStr(period.status);
    if (st === '종료') return '마감';
    if (st === '취소') return '취소';
    var d = LMS.toStr(today) || ctx.today();
    if (d < period.start_date) return '예정';
    if (d > period.end_date) return '끝남';
    return '진행 중';
  }

  // ----- 휴강 반 and 복귀일 -----

  /** 마지막 휴강일 of a suspended class: the stored day its first moved student is back, else the period end. */
  function lastSuspendedDay(period, classId) {
    return LMS.classResumeDate(period, LMS.toStr(classId)) || LMS.toStr(period.end_date);
  }

  /** 복귀일: the first day the suspended class meets again (the day after its last suspended day). */
  function resumeDate(period, classId) {
    return LMS.addDays(lastSuspendedDay(period, classId), 1);
  }

  /**
   * Placements of the period that take a student away from the suspended class: placed from it, or
   * attending it as a regular class at some point in the period.
   */
  function awayFromClass(period, classId, placements) {
    return placements.filter(function (r) {
      var sources = assignments.regularClassIdsDuring(r.student_id, period.start_date, period.end_date);
      return sources.indexOf(LMS.toStr(classId)) !== -1 || same(r.source_class_id, classId);
    });
  }

  function placementBackOn(period, rel) {
    return LMS.addDays(LMS.toStr(rel.end_date) || period.end_date, 1);
  }

  /**
   * Batch start, individual return: who comes back to the suspended class on which day,
   * [{ date, student_ids }] by date (one entry per placement, so a split placement counts twice).
   */
  function returns(period, classId) {
    var byDay = {};
    var placements = assignments.tempPlacements(classIds(period.exam_period_id));
    awayFromClass(period, classId, placements).forEach(function (r) {
      var back = placementBackOn(period, r);
      (byDay[back] = byDay[back] || []).push(LMS.toStr(r.student_id));
    });
    return Object.keys(byDay).sort().map(function (d) { return { date: d, student_ids: byDay[d] }; });
  }

  /**
   * Store each suspended class's last suspended day: it stays off until its first moved student
   * is back, then meets with whoever has returned. No moved students → period end.
   */
  function recomputeResume(periodId) {
    var periods = table('ExamPeriods');
    var period = LMS.findById(periods, 'exam_period_id', periodId);
    if (!period) return;
    var placements = assignments.tempPlacements(classIds(period.exam_period_id));
    var map = {};
    LMS.suspendedClassIds(period).forEach(function (classId) {
      var last = '';
      awayFromClass(period, classId, placements).forEach(function (r) {
        var end = LMS.toStr(r.end_date) || period.end_date;
        if (!last || end < last) last = end;
      });
      map[classId] = last && last < period.end_date ? last : period.end_date;
    });
    period.class_resume_dates = map;
    period.updated_at = ctx.now();
    saveTable('ExamPeriods', periods);
  }

  /**
   * How a class stands against exam periods on the date: { kind: 'exam_class', period } for an
   * exam-prep class, { kind: 'suspended', period, resume_date } while suspended, { kind: 'upcoming',
   * period, resume_date } for the next period that will suspend it, else null.
   */
  function classContext(cls, date) {
    var periods = table('ExamPeriods');
    if (isExamClass(cls)) {
      return { kind: 'exam_class', period: LMS.findById(periods, 'exam_period_id', cls.exam_period_id) };
    }
    var id = LMS.toStr(cls.class_id);
    var active = LMS.classSuspensionOn(cls, date, periods);
    if (active) return { kind: 'suspended', period: active, resume_date: resumeDate(active, id) };
    var next = periods.filter(function (p) {
      return LMS.examPeriodActive(p) && LMS.toStr(p.start_date) > date && LMS.suspendedClassIds(p).indexOf(id) !== -1;
    }).sort(function (a, b) { return LMS.toStr(a.start_date).localeCompare(LMS.toStr(b.start_date)); })[0];
    if (!next) return null;
    return { kind: 'upcoming', period: next, resume_date: resumeDate(next, id) };
  }

  /** Operating regular classes that would meet on the date but are suspended: [{ class_id, class_name, period_title, resume_date }]. */
  function suspendedOn(date) {
    var periods = table('ExamPeriods');
    var out = [];
    table('Classes').forEach(function (c) {
      if (LMS.toStr(c.status) !== '운영' || isExamClass(c) || !LMS.classTimeOn(c, date)) return;
      var p = LMS.classSuspensionOn(c, date, periods);
      if (!p) return;
      out.push({ class_id: c.class_id, class_name: c.class_name, period_title: p.title, resume_date: resumeDate(p, c.class_id) });
    });
    return out;
  }

  /**
   * Last day of the school exam matching the period (year, semester, type when set) for one school
   * and grade, overlapping the period; the earliest such exam. '' when none. Students go back after it.
   */
  function schoolExamLastDay(period, schoolKey) {
    var hit = table('SchoolExams').filter(function (x) {
      if (LMS.toStr(x.school_key) !== schoolKey || !x.exam_date) return false;
      if (period.exam_year && LMS.toStr(x.school_year) !== LMS.toStr(period.exam_year)) return false;
      if (period.exam_semester && LMS.toStr(x.semester) !== LMS.toStr(period.exam_semester)) return false;
      if (period.exam_type && LMS.toStr(x.exam_type) !== LMS.toStr(period.exam_type)) return false;
      var end = LMS.schoolExams.lastDay(x);
      return (!period.end_date || x.exam_date <= period.end_date) && (!period.start_date || end >= period.start_date);
    }).sort(function (a, b) { return LMS.toStr(a.exam_date).localeCompare(LMS.toStr(b.exam_date)); })[0];
    return hit ? LMS.schoolExams.lastDay(hit) : '';
  }

  // ----- Commands -----

  function save(data) {
    var input = LMS.validateExamPeriodInput(data);
    var rows = table('ExamPeriods');
    var ts = ctx.now();
    var row;
    if (input.exam_period_id) {
      row = requirePeriod(input.exam_period_id);
      Object.keys(input).forEach(function (k) { if (k !== 'exam_period_id') row[k] = input[k]; });
      row.updated_at = ts;
      saveTable('ExamPeriods', rows);
      assignments.clampTempToPeriod(row, classIds(row.exam_period_id));
      recomputeResume(row.exam_period_id);
    } else {
      row = Object.assign({}, input, {
        exam_period_id: ctx.nextIds('EXP', 1)[0],
        suspended_class_ids: [],
        class_resume_dates: {},
        status: '준비',
        created_at: ts,
        updated_at: ts
      });
      rows.push(row);
      saveTable('ExamPeriods', rows);
    }
    return find(row.exam_period_id);
  }

  /** Checked placements of each group (with students), in input order. */
  function preparePlacements(period, groups) {
    var seen = {};
    return groups.map(function (g) {
      var name = LMS.toStr(g.class_name);
      if (!name) throw new Error('시험대비 반 이름을 입력해 주세요.');
      var gStart = LMS.toStr(g.start_date) || period.start_date;
      var gEnd = LMS.toStr(g.end_date) || period.end_date;
      var students = g.students.map(function (st) {
        var sid = LMS.toStr(st.student_id);
        var stu = ctx.requireStudent(sid);
        if (LMS.toStr(stu.status) !== '재원') throw new Error(stu.name + ' 학생은 재원생이 아니라 편성할 수 없습니다.');
        if (seen[sid]) throw new Error('같은 학생이 두 반에 들어 있습니다.');
        seen[sid] = true;
        var start = LMS.toStr(st.start_date) || gStart;
        var end = LMS.toStr(st.end_date) || gEnd;
        if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end) || end < start) throw new Error(name + ': 날짜를 확인해 주세요.');
        if (start < period.start_date || end > period.end_date) throw new Error(name + ': 날짜는 시험대비 기간 안이어야 합니다.');
        assignments.assertNoTempOverlap(sid, start, end);
        return {
          student_id: sid,
          source_class_id: LMS.toStr(st.source_class_id) || assignments.regularClassIdsDuring(sid, start, end)[0] || '',
          start_date: start,
          end_date: end
        };
      });
      return { name: name, group: g, students: students };
    });
  }

  /** Validated row for a new exam-prep class of the period (not saved yet). */
  function newExamClass(period, pg) {
    var schedule = LMS.normalizeSchedule(pg.group.schedule);
    if (!schedule.length) throw new Error(pg.name + ': 수업 요일과 시간을 입력해 주세요.');
    schedule.forEach(function (sl) {
      if (!sl.start || !sl.end) throw new Error(pg.name + ': ' + sl.day + '요일 시간을 입력해 주세요.');
    });
    var grade = LMS.toStr(pg.group.target_grade);
    var input = LMS.validateClassInput({
      class_name: pg.name,
      grade: grade,
      teacher: LMS.toStr(pg.group.teacher),
      school_year: LMS.toStr(period.exam_year) || period.start_date.slice(0, 4),
      semester: LMS.toStr(period.exam_semester),
      schedule: schedule,
      class_type: '시험대비',
      exam_period_id: period.exam_period_id,
      target_school: LMS.toStr(pg.group.target_school),
      target_grade: grade,
      status: '운영'
    }, false);
    delete input.schedule_from_legacy;
    return input;
  }

  /**
   * Create exam-prep classes and their placements in one go. A group with class_id adds its students
   * to that class of the period; any other group makes a new class, whose name must be unused in the
   * period. suspended_class_ids, when given, replaces the suspended classes.
   * plan: { groups: [{ class_id?, class_name, schedule, target_school, target_grade, teacher, start_date, end_date,
   *          students: [{ student_id, source_class_id, start_date?, end_date? }] }], suspended_class_ids: [] }
   */
  function applyGroups(periodId, plan) {
    var period = requirePeriod(periodId);
    plan = plan || {};
    var groups = (plan.groups || []).filter(function (g) { return (g.students || []).length; });
    if (!groups.length && !Array.isArray(plan.suspended_class_ids)) throw new Error('편성할 학생이 없습니다.');
    var existing = classes(period.exam_period_id);
    var taken = {};
    existing.forEach(function (c) { taken[LMS.examClassNameKey(c.class_name)] = true; });
    // Check every group before anything is saved.
    var targets = preparePlacements(period, groups).map(function (pg) {
      var classId = LMS.toStr(pg.group.class_id);
      if (classId) {
        var cls = LMS.findById(existing, 'class_id', classId);
        if (!cls) throw new Error(pg.name + ': 이 시험대비 기간의 반이 아닙니다.');
        return { cls: cls, students: pg.students };
      }
      var key = LMS.examClassNameKey(pg.name);
      if (taken[key]) throw new Error('‘' + key + '’ 이름의 시험대비 반이 이미 있습니다. 반 이름을 다르게 해 주세요.');
      taken[key] = true;
      return { input: newExamClass(period, pg), students: pg.students };
    });
    var created = targets.map(function (t) {
      var cls = t.cls;
      if (!cls) {
        var ts = ctx.now();
        cls = Object.assign({}, t.input, { class_id: ctx.nextIds('CLS', 1)[0], created_at: ts, updated_at: ts });
        var rows = table('Classes');
        rows.push(cls);
        saveTable('Classes', rows);
      }
      assignments.placeTemp(cls.class_id, t.students);
      return cls;
    });
    var periods = table('ExamPeriods');
    var row = LMS.findById(periods, 'exam_period_id', periodId);
    if (Array.isArray(plan.suspended_class_ids)) {
      row.suspended_class_ids = LMS.uniqueIds(plan.suspended_class_ids.map(LMS.toStr));
    }
    if (LMS.toStr(row.status) === '준비') row.status = '진행';
    saveTable('ExamPeriods', periods);
    recomputeResume(periodId);
    return { classes: created, period: find(periodId) };
  }

  /** Replace the period's suspended regular classes (an empty list lifts them all). */
  function setSuspended(periodId, classIdList) {
    var periods = table('ExamPeriods');
    var row = requirePeriod(periodId);
    row.suspended_class_ids = LMS.uniqueIds((classIdList || []).map(LMS.toStr));
    saveTable('ExamPeriods', periods);
    recomputeResume(periodId);
    return find(periodId);
  }

  /** Close the period and every exam-prep class of it. */
  function close(periodId) {
    var periods = table('ExamPeriods');
    var row = requirePeriod(periodId);
    row.status = '종료';
    row.updated_at = ctx.now();
    saveTable('ExamPeriods', periods);
    var ids = classIds(periodId);
    var rows = table('Classes');
    rows.forEach(function (c) { if (ids.indexOf(LMS.toStr(c.class_id)) !== -1) c.status = '종료'; });
    saveTable('Classes', rows);
    return row;
  }

  function removeProblem(periodId) {
    if (!find(periodId)) return NO_PERIOD;
    var ids = classIds(periodId);
    var used = table('Lessons').some(function (l) { return ids.indexOf(LMS.toStr(l.class_id)) !== -1; });
    return used ? HAS_LESSONS : '';
  }

  /** Delete a period that has no lessons yet, with its exam-prep classes, placements, plans and homework. */
  function remove(periodId) {
    var problem = removeProblem(periodId);
    if (problem) throw new Error(problem);
    var ids = classIds(periodId);
    var keep = function (r) { return ids.indexOf(LMS.toStr(r.class_id)) === -1; };
    assignments.dropForClasses(ids);
    saveTable('Classes', table('Classes').filter(keep));
    saveTable('ClassSessions', table('ClassSessions').filter(keep));
    var items = table('HomeworkItems');
    var dropItems = items.filter(function (r) { return !keep(r); }).map(function (r) { return LMS.toStr(r.item_id); });
    saveTable('HomeworkItems', items.filter(keep));
    saveTable('HomeworkChecks', table('HomeworkChecks').filter(function (c) { return dropItems.indexOf(LMS.toStr(c.item_id)) === -1; }));
    saveTable('ClassPlans', table('ClassPlans').filter(keep));
    saveTable('PlanDrafts', table('PlanDrafts').filter(keep));
    saveTable('ExamPeriods', table('ExamPeriods').filter(function (r) { return !same(r.exam_period_id, periodId); }));
    return true;
  }

  /**
   * A class row was deleted: an exam-prep class's period recomputes its resume dates; a regular
   * class stops being suspended (and loses its resume date) in every period.
   */
  function forgetClass(cls) {
    if (isExamClass(cls)) {
      if (cls.exam_period_id) recomputeResume(cls.exam_period_id);
      return;
    }
    var cid = LMS.toStr(cls.class_id);
    var periods = table('ExamPeriods');
    var ts = ctx.now();
    var touched = false;
    periods.forEach(function (p) {
      var ids = LMS.suspendedClassIds(p);
      var resume = p.class_resume_dates;
      if (typeof resume === 'string') {
        try { resume = JSON.parse(resume); } catch (e) { resume = null; }
      }
      var inResume = !!(resume && Object.prototype.hasOwnProperty.call(resume, cid));
      if (ids.indexOf(cid) === -1 && !inResume) return;
      p.suspended_class_ids = ids.filter(function (id) { return id !== cid; });
      if (inResume) {
        resume = Object.assign({}, resume);
        delete resume[cid];
        p.class_resume_dates = resume;
      }
      p.updated_at = ts;
      touched = true;
    });
    if (touched) saveTable('ExamPeriods', periods);
  }

  var check = {
    remove: removeProblem
  };

  return {
    check: check,
    find: find,
    requirePeriod: requirePeriod,
    classes: classes,
    classIds: classIds,
    state: state,
    lastSuspendedDay: lastSuspendedDay,
    resumeDate: resumeDate,
    returns: returns,
    classContext: classContext,
    suspendedOn: suspendedOn,
    schoolExamLastDay: schoolExamLastDay,
    save: save,
    applyGroups: applyGroups,
    setSuspended: setSuspended,
    close: close,
    remove: remove,
    recomputeResume: recomputeResume,
    forgetClass: forgetClass
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
