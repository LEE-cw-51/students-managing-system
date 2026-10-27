/**
 * Store-agnostic business API. The Postgres store and the local file/memory store share this layer.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
  require('./05_Views.js');
  require('./06_Plans.js');
}

LMS.createService = function (store) {
  var memo = {};

  function now() {
    return store.now();
  }

  function withLock(fn) {
    if (store.withLock) return store.withLock(fn);
    return fn();
  }

  function table(name) {
    if (!Object.prototype.hasOwnProperty.call(memo, name)) {
      memo[name] = store.readTable(name) || [];
    }
    return memo[name];
  }

  function saveTable(name, rows) {
    store.writeTable(name, rows);
    memo[name] = rows || [];
  }

  function settings() {
    return LMS.settingsFromRows(table('Settings'));
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

  function nextIds(prefix, count) {
    count = count || 1;
    var meta = table('_Meta');
    var row = LMS.findById(meta, 'prefix', prefix);
    if (!row) {
      row = { prefix: prefix, next_seq: 1 };
      meta.push(row);
    }
    var start = parseInt(row.next_seq, 10);
    if (!isFinite(start) || start < 1) start = 1;
    var ids = [];
    for (var i = 0; i < count; i++) {
      ids.push(LMS.formatId(prefix, start + i));
    }
    row.next_seq = start + count;
    saveTable('_Meta', meta);
    return ids;
  }

  function currentRelations(studentId) {
    return table('StudentClasses').filter(function (row) {
      return LMS.toStr(row.student_id) === LMS.toStr(studentId) &&
        LMS.toStr(row.status) === '현재';
    });
  }

  function enrichStudent(student) {
    var rels = table('StudentClasses').filter(function (row) {
      return LMS.toStr(row.student_id) === LMS.toStr(student.student_id);
    }).sort(function (a, b) {
      return LMS.toStr(b.start_date).localeCompare(LMS.toStr(a.start_date));
    });
    var classes = table('Classes');
    var history = rels.map(function (rel) {
      var cls = LMS.findById(classes, 'class_id', rel.class_id);
      return {
        id: rel.id,
        class_id: rel.class_id,
        class_name: cls ? cls.class_name : rel.class_id,
        start_date: rel.start_date,
        end_date: rel.end_date,
        status: rel.status,
        assignment_type: LMS.toStr(rel.assignment_type) || '정규'
      };
    });
    var current = history.filter(function (h) { return h.status === '현재'; });
    return Object.assign({}, student, {
      current_classes: current,
      class_history: history
    });
  }

  function getStudents(filter) {
    filter = filter || {};
    var students = table('Students');
    var rels = table('StudentClasses');
    var q = LMS.toStr(filter.query).toLowerCase();
    return students.filter(function (s) {
      if (filter.status && LMS.toStr(s.status) !== filter.status) return false;
      if (filter.grade && LMS.toStr(s.grade) !== filter.grade) return false;
      if (filter.classId) {
        var ok = rels.some(function (r) {
          return LMS.toStr(r.student_id) === LMS.toStr(s.student_id) &&
            LMS.toStr(r.class_id) === LMS.toStr(filter.classId) &&
            LMS.toStr(r.status) === '현재';
        });
        if (!ok) return false;
      }
      if (q && LMS.toStr(s.name).toLowerCase().indexOf(q) === -1 &&
          LMS.toStr(s.student_id).toLowerCase().indexOf(q) === -1 &&
          LMS.toStr(s.school).toLowerCase().indexOf(q) === -1) {
        return false;
      }
      return true;
    }).map(enrichStudent).sort(function (a, b) {
      return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko');
    });
  }

  function getStudent(studentId) {
    return enrichStudent(requireStudent(studentId));
  }

  function createStudent(data) {
    return withLock(function () {
      var input = LMS.validateStudentInput(data, false);
      var id = nextIds('STU', 1)[0];
      var ts = now();
      var row = {
        student_id: id,
        name: input.name,
        grade: input.grade,
        school: input.school,
        student_phone: input.student_phone,
        parent_phone: input.parent_phone,
        enrollment_date: input.enrollment_date || store.today(),
        status: input.status,
        memo: input.memo,
        created_at: ts,
        updated_at: ts
      };
      var rows = table('Students');
      rows.push(row);
      saveTable('Students', rows);
      if (data && data.class_id) {
        assignStudentToClass({
          student_id: id,
          class_id: data.class_id,
          start_date: row.enrollment_date
        }, true);
      }
      return enrichStudent(row);
    });
  }

  function updateStudent(data) {
    return withLock(function () {
      var input = LMS.validateStudentInput(data, true);
      var rows = table('Students');
      var row = LMS.findById(rows, 'student_id', input.student_id);
      if (!row) throw new Error('학생 정보를 찾을 수 없습니다.');
      var withdrawing = input.status === '퇴원' && LMS.toStr(row.status) !== '퇴원';
      var prevEnrollment = LMS.toStr(row.enrollment_date);
      row.name = input.name;
      row.grade = input.grade;
      row.school = input.school;
      row.student_phone = input.student_phone;
      row.parent_phone = input.parent_phone;
      row.enrollment_date = input.enrollment_date || row.enrollment_date;
      row.status = input.status;
      row.memo = input.memo;
      row.updated_at = now();
      saveTable('Students', rows);
      if (withdrawing) {
        var ended = regularRels_(row.student_id).map(function (r) {
          var change = { student_id: r.student_id, start: LMS.toStr(r.start_date), end: '' };
          endRelForClosing_(r);
          return change;
        });
        saveTable('StudentClasses', table('StudentClasses'));
        syncExamPrep_(ended);
      }
      var startSync = null;
      if (data && data.sync_class_start && prevEnrollment && LMS.toStr(row.enrollment_date) !== prevEnrollment) {
        // Only the first regular assignment, and only when it started on the old enrollment date.
        var first = firstRegularRel_(row.student_id);
        if (first && LMS.toStr(first.start_date) === prevEnrollment) {
          var problem = classStartProblem_(first, LMS.toStr(row.enrollment_date));
          if (problem) startSync = { synced: false, problem: problem };
          else {
            applyClassStart_(first, LMS.toStr(row.enrollment_date));
            startSync = { synced: true, problem: '' };
          }
        }
      }
      return Object.assign(enrichStudent(row), { class_start_sync: startSync });
    });
  }

  function firstRegularRel_(studentId) {
    var classes = table('Classes');
    return table('StudentClasses').filter(function (r) {
      if (LMS.toStr(r.student_id) !== LMS.toStr(studentId) || LMS.toStr(r.status) === '임시') return false;
      var c = LMS.findById(classes, 'class_id', r.class_id);
      return !c || LMS.toStr(c.class_type) !== '시험대비';
    }).sort(function (a, b) { return LMS.toStr(a.start_date).localeCompare(LMS.toStr(b.start_date)); })[0] || null;
  }

  function archiveStudent(studentId) {
    return updateStudent(Object.assign({}, requireStudent(studentId), { status: '퇴원' }));
  }

  function previewGradePromotion() {
    var groups = {};
    LMS.GRADE_OPTIONS.forEach(function (g) { groups[g] = []; });
    table('Students').forEach(function (s) {
      if (LMS.toStr(s.status) !== '재원') return;
      var g = LMS.toStr(s.grade) || '기타';
      if (!groups[g]) groups[g] = [];
      groups[g].push({
        student_id: s.student_id,
        name: s.name,
        grade: s.grade
      });
    });
    var items = [];
    LMS.GRADE_OPTIONS.forEach(function (from) {
      var to = LMS.nextGrade(from);
      if (!to) return;
      var students = groups[from] || [];
      items.push({
        from_grade: from,
        to_grade: to,
        count: students.length,
        students: students
      });
    });
    var skipped = (groups['고3'] || []).concat(groups['기타'] || []);
    var total = items.reduce(function (n, item) { return n + item.count; }, 0);
    return { total: total, items: items, skipped: skipped };
  }

  function promoteGrades() {
    return withLock(function () {
      var preview = previewGradePromotion();
      var rows = table('Students');
      var ts = now();
      var updated = [];
      preview.items.forEach(function (item) {
        item.students.forEach(function (s) {
          var row = LMS.findById(rows, 'student_id', s.student_id);
          if (!row || LMS.toStr(row.status) !== '재원') return;
          row.grade = item.to_grade;
          row.updated_at = ts;
          updated.push({
            student_id: row.student_id,
            name: row.name,
            from_grade: item.from_grade,
            to_grade: item.to_grade
          });
        });
      });
      saveTable('Students', rows);
      return { updated_count: updated.length, updated: updated, skipped: preview.skipped };
    });
  }

  function getClasses(filter) {
    filter = filter || {};
    return table('Classes').filter(function (c) {
      if (filter.status && LMS.toStr(c.status) !== filter.status) return false;
      if (filter.grade && LMS.toStr(c.grade) !== filter.grade) return false;
      return true;
    }).sort(function (a, b) {
      return LMS.toStr(a.class_name).localeCompare(LMS.toStr(b.class_name), 'ko');
    });
  }

  function getClass(classId) {
    var cls = requireClass(classId);
    var roster = getClassRoster(classId);
    return Object.assign({}, cls, { students: roster, student_count: roster.length });
  }

  function newUnitId_() {
    return nextIds(LMS.PREFIX.unit, 1)[0];
  }

  function createClass(data) {
    return withLock(function () {
      var input = LMS.validateClassInput(data, false);
      delete input.schedule_from_legacy;
      if (input.curriculum) input.curriculum = LMS.normalizeCurriculum(input.curriculum, newUnitId_);
      var id = nextIds('CLS', 1)[0];
      var ts = now();
      var row = Object.assign({}, input, {
        class_id: id,
        created_at: ts,
        updated_at: ts
      });
      var rows = table('Classes');
      rows.push(row);
      saveTable('Classes', rows);
      return row;
    });
  }

  function updateClass(data) {
    return withLock(function () {
      var input = LMS.validateClassInput(data, true);
      var rows = table('Classes');
      var row = LMS.findById(rows, 'class_id', input.class_id);
      if (!row) throw new Error('반 정보를 찾을 수 없습니다.');
      if (input.curriculum) input.curriculum = LMS.normalizeCurriculum(input.curriculum, newUnitId_);
      if (input.schedule_from_legacy) {
        // A legacy form re-sent the same weekday/time summary: keep per-day times.
        var prevSchedule = LMS.classSchedule(row);
        var prevSummary = LMS.scheduleSummary(prevSchedule);
        if (prevSummary.weekday === input.weekday &&
            prevSummary.start_time === input.start_time &&
            prevSummary.end_time === input.end_time) {
          input.schedule = prevSchedule;
        }
      }
      delete input.schedule_from_legacy;
      var closing = input.status === '종료' && LMS.toStr(row.status) !== '종료';
      Object.keys(input).forEach(function (k) {
        if (k === 'class_id') return;
        row[k] = input[k];
      });
      row.updated_at = now();
      saveTable('Classes', rows);
      if (closing && LMS.toStr(row.class_type) !== '시험대비') {
        var ended = table('StudentClasses').filter(function (r) {
          return LMS.toStr(r.class_id) === LMS.toStr(row.class_id) && LMS.toStr(r.status) === '현재';
        }).map(function (r) {
          var change = { student_id: r.student_id, start: LMS.toStr(r.start_date), end: '' };
          endRelForClosing_(r);
          return change;
        });
        saveTable('StudentClasses', table('StudentClasses'));
        syncExamPrep_(ended);
      }
      return row;
    });
  }

  function closeClass(classId) {
    var cls = requireClass(classId);
    return updateClass(Object.assign({}, cls, { status: '종료' }));
  }

  function getStudentClasses(studentId) {
    requireStudent(studentId);
    return enrichStudent(requireStudent(studentId)).class_history;
  }

  function examPeriods_() {
    return table('ExamPeriods');
  }

  /** Students whose (regular or temporary) assignment covers the date, excluding 퇴원. */
  function rosterOn(classId, date) {
    var seen = {};
    var students = table('Students');
    var rels = table('StudentClasses');
    // Students temporarily moved out of this class that day attend the exam class instead.
    var away = {};
    rels.forEach(function (r) {
      if (LMS.toStr(r.status) === '임시' && LMS.toStr(r.source_class_id) === LMS.toStr(classId) && LMS.relActiveOn(r, date)) {
        away[LMS.toStr(r.student_id)] = true;
      }
    });
    return rels.filter(function (r) {
      if (LMS.toStr(r.class_id) !== LMS.toStr(classId) || !LMS.relActiveOn(r, date)) return false;
      return LMS.toStr(r.status) === '임시' || !away[LMS.toStr(r.student_id)];
    }).filter(function (r) {
      var s = LMS.findById(students, 'student_id', r.student_id);
      if (!s || seen[s.student_id]) return false;
      // A withdrawn student still belongs to the past dates of a regular assignment closed with an end date.
      if (LMS.toStr(s.status) === '퇴원' && (LMS.toStr(r.status) !== '종료' || !LMS.toStr(r.end_date))) return false;
      seen[s.student_id] = true;
      return true;
    }).map(function (r) {
      return LMS.findById(students, 'student_id', r.student_id);
    }).sort(function (a, b) {
      return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko');
    });
  }

  function getClassRoster(classId, date) {
    requireClass(classId);
    if (date) return rosterOn(classId, date);
    var rels = table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.toStr(r.status) === '현재';
    });
    var students = table('Students');
    return rels.map(function (r) {
      return LMS.findById(students, 'student_id', r.student_id);
    }).filter(function (s) {
      return s && LMS.toStr(s.status) !== '퇴원';
    }).sort(function (a, b) {
      return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko');
    });
  }

  function assignStudentToClass(data, alreadyLocked) {
    var run = function () {
      var studentId = LMS.toStr(data.student_id);
      var classId = LMS.toStr(data.class_id);
      var student = requireStudent(studentId);
      var cls = requireClass(classId);
      if (LMS.toStr(student.status) === '퇴원') throw new Error('퇴원한 학생은 반에 배정할 수 없습니다.');
      if (LMS.toStr(cls.status) !== '운영') throw new Error('종료된 반에는 배정할 수 없습니다.');
      if (LMS.toStr(cls.class_type) === '시험대비') throw new Error('시험대비 반은 시험 화면에서 편성해 주세요.');
      var start = LMS.toStr(data.start_date) || store.today();
      if (!LMS.isIsoDate(start)) throw new Error('반 시작일 형식이 올바르지 않습니다.');
      var rels = table('StudentClasses');
      var exists = rels.some(function (r) {
        return LMS.toStr(r.student_id) === studentId &&
          LMS.toStr(r.class_id) === classId &&
          LMS.toStr(r.status) === '현재';
      });
      if (exists) throw new Error('이미 해당 반에 소속되어 있습니다.');
      var clash = sameClassOverlap_(studentId, classId, start, '', '');
      if (clash) throw new Error('이 반의 이전 배정(' + clash.start_date + ' ~ ' + clash.end_date + ')과 기간이 겹칩니다. 시작일을 ' + LMS.addDays(clash.end_date, 1) + ' 이후로 잡아 주세요.');
      var ts = now();
      var row = {
        id: nextIds('REL', 1)[0],
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
      return row;
    };
    if (alreadyLocked) return run();
    return withLock(function () {
      var row = run();
      syncExamPrep_([{ student_id: row.student_id, start: row.start_date, end: '' }]);
      return row;
    });
  }

  /** First lesson date of the student in the class on or after `from` ('' when none). */
  function lessonOnOrAfter_(studentId, classId, from) {
    return table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId) &&
        LMS.toStr(l.class_id) === LMS.toStr(classId) && LMS.toStr(l.lesson_date) >= from;
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort()[0] || '';
  }

  /** Last lesson date of the student in the class ('' when none). */
  function lastLessonIn_(studentId, classId) {
    return table('Lessons').filter(function (l) {
      return LMS.toStr(l.student_id) === LMS.toStr(studentId) && LMS.toStr(l.class_id) === LMS.toStr(classId);
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort().pop() || '';
  }

  /**
   * End a current assignment because the student left or the class closed: the last day is
   * yesterday, or the last lesson recorded in that class when it is later. Changes the row in place.
   */
  function endRelForClosing_(rel, lastDay) {
    var end = lastDay || LMS.addDays(store.today(), -1);
    var last = lastLessonIn_(rel.student_id, rel.class_id);
    if (last > end) end = last;
    if (end < LMS.toStr(rel.start_date)) end = LMS.toStr(rel.start_date);
    rel.end_date = end;
    rel.status = '종료';
    rel.updated_at = now();
  }

  /** Another assignment of the student in the same class whose period overlaps [start, end] (null when none). */
  function sameClassOverlap_(studentId, classId, start, end, ignoreId) {
    return table('StudentClasses').filter(function (r) {
      if (LMS.toStr(r.id) === LMS.toStr(ignoreId) || LMS.toStr(r.status) === '임시') return false;
      if (LMS.toStr(r.student_id) !== LMS.toStr(studentId) || LMS.toStr(r.class_id) !== LMS.toStr(classId)) return false;
      if (LMS.toStr(r.status) === '종료' && !r.end_date) return false;
      return LMS.rangesOverlap(r.start_date, r.end_date, start, end);
    })[0] || null;
  }

  /** Why the regular assignment cannot start on `start`, or '' when it can. */
  function classStartProblem_(rel, start) {
    if (!rel || LMS.toStr(rel.status) === '임시') return '시험대비 임시 배정은 시험 화면에서 바꿔 주세요.';
    if (!LMS.isIsoDate(start)) return '시작일 형식이 올바르지 않습니다.';
    var end = LMS.toStr(rel.end_date);
    if (end && start > end) return '시작일은 이 배정의 마지막 수업일(' + end + ')보다 늦을 수 없습니다.';
    var first = table('Lessons').filter(function (l) {
      var d = LMS.toStr(l.lesson_date);
      return LMS.toStr(l.student_id) === LMS.toStr(rel.student_id) && LMS.toStr(l.class_id) === LMS.toStr(rel.class_id) &&
        d >= LMS.toStr(rel.start_date) && (!end || d <= end);
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort()[0];
    if (first && start > first) return '이 반 수업 기록이 ' + first + '부터 있어 시작일을 그 뒤로 옮길 수 없습니다.';
    var clash = sameClassOverlap_(rel.student_id, rel.class_id, start, end, rel.id);
    if (clash) return '이 반의 다른 배정(' + clash.start_date + ' ~ ' + (clash.end_date || '현재') + ')과 기간이 겹칩니다.';
    // A move ends the old class the day before the new one starts; pulling the start earlier would overlap it.
    var dayBefore = LMS.addDays(LMS.toStr(rel.start_date), -1);
    var classes = table('Classes');
    var prev = table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.student_id) === LMS.toStr(rel.student_id) && LMS.toStr(r.status) === '종료' &&
        LMS.toStr(r.class_id) !== LMS.toStr(rel.class_id) && LMS.toStr(r.end_date) === dayBefore;
    })[0];
    if (prev && start <= dayBefore) {
      var pc = LMS.findById(classes, 'class_id', prev.class_id);
      return '반 이동으로 시작한 배정입니다. 이전 반(' + (pc ? pc.class_name : prev.class_id) + ')의 마지막 수업일(' + dayBefore + ') 다음 날보다 앞당길 수 없습니다.';
    }
    return '';
  }

  /** Recorded class days in the newly covered range on which the student has no lesson. */
  function classStartMissingDates_(rel, start) {
    var from = LMS.toStr(start);
    var to = LMS.addDays(LMS.toStr(rel.start_date), -1);
    if (!from || from > to) return [];
    var cid = LMS.toStr(rel.class_id);
    var dates = {};
    table('ClassSessions').concat(table('Lessons')).forEach(function (r) {
      if (LMS.toStr(r.class_id) === cid && LMS.inRange(r.lesson_date, from, to)) dates[LMS.toStr(r.lesson_date)] = true;
    });
    table('Lessons').forEach(function (l) {
      if (LMS.toStr(l.class_id) === cid && LMS.toStr(l.student_id) === LMS.toStr(rel.student_id)) delete dates[LMS.toStr(l.lesson_date)];
    });
    return Object.keys(dates).sort();
  }

  /** Check a start-date change before saving: the blocking reason, and class days that would show this student unrecorded. */
  function previewClassStartChange(data) {
    data = data || {};
    var rel = LMS.findById(table('StudentClasses'), 'id', data.id);
    if (!rel) throw new Error('반 배정 정보를 찾을 수 없습니다.');
    var start = LMS.toStr(data.start_date);
    var problem = classStartProblem_(rel, start);
    var missing = problem ? [] : classStartMissingDates_(rel, start);
    return { id: rel.id, start_date: start, problem: problem, missing_dates: missing, missing_count: missing.length };
  }

  function applyClassStart_(rel, start) {
    var from = start < LMS.toStr(rel.start_date) ? start : LMS.toStr(rel.start_date);
    rel.start_date = start;
    rel.updated_at = now();
    saveTable('StudentClasses', table('StudentClasses'));
    // Resume dates of exam-prep periods are computed from regular assignment ranges.
    examPeriods_().forEach(function (p) {
      if (LMS.rangesOverlap(p.start_date, p.end_date, from, rel.end_date)) recomputeResumeDates_(p.exam_period_id);
    });
    return rel;
  }

  /** Change when a regular assignment starts (e.g. a student entered with today's date for an earlier class). */
  function updateStudentClassStart(data) {
    return withLock(function () {
      data = data || {};
      var rel = LMS.findById(table('StudentClasses'), 'id', data.id);
      if (!rel) throw new Error('반 배정 정보를 찾을 수 없습니다.');
      var start = LMS.toStr(data.start_date);
      var problem = classStartProblem_(rel, start);
      if (problem) throw new Error(problem);
      return applyClassStart_(rel, start);
    });
  }

  /** Current regular assignments of a student (temporary exam placements are managed elsewhere). */
  function regularRels_(studentId) {
    return table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.student_id) === LMS.toStr(studentId) && LMS.toStr(r.status) === '현재';
    });
  }

  /**
   * The one assignment a move or removal acts on: by relation id, by class, or the only regular
   * class. A student in two classes must say which one, so moving never ends both.
   */
  function pickRel_(studentId, relId, classId) {
    var rels = regularRels_(studentId);
    if (relId) {
      var byId = LMS.findById(table('StudentClasses'), 'id', relId);
      if (!byId || LMS.toStr(byId.student_id) !== LMS.toStr(studentId)) throw new Error('반 배정 정보를 찾을 수 없습니다.');
      if (LMS.toStr(byId.status) === '임시') throw new Error('시험대비 임시 배정은 시험 화면에서 바꿔 주세요.');
      if (LMS.toStr(byId.status) !== '현재') throw new Error('이미 끝난 반 배정입니다.');
      return byId;
    }
    if (classId) {
      var byClass = rels.filter(function (r) { return LMS.toStr(r.class_id) === LMS.toStr(classId); })[0];
      if (!byClass) throw new Error('현재 반 배정 정보를 찾을 수 없습니다.');
      return byClass;
    }
    if (!rels.length) throw new Error('지금 다니는 반이 없습니다. 반 배정을 써 주세요.');
    if (rels.length > 1) throw new Error('두 반 이상 다니는 학생입니다. 어느 반에서 옮길지 골라 주세요.');
    return rels[0];
  }

  /** Why moving this assignment to the class on the date is not allowed, or '' when it is. */
  function moveProblem_(rel, toClassId, start) {
    if (!LMS.isIsoDate(start)) return '이동일 형식이 올바르지 않습니다.';
    if (LMS.toStr(rel.class_id) === LMS.toStr(toClassId)) return '지금 다니는 반과 같은 반입니다.';
    var cls = LMS.findById(table('Classes'), 'class_id', toClassId);
    if (!cls) return '옮겨 갈 반을 찾을 수 없습니다.';
    if (LMS.toStr(cls.status) !== '운영') return '종료된 반으로는 옮길 수 없습니다.';
    if (LMS.toStr(cls.class_type) === '시험대비') return '시험대비 반은 시험 화면에서 편성해 주세요.';
    var already = regularRels_(rel.student_id).some(function (r) { return LMS.toStr(r.class_id) === LMS.toStr(toClassId); });
    if (already) return '이미 ' + cls.class_name + '에 다니고 있습니다.';
    if (start <= LMS.toStr(rel.start_date)) {
      return '이동일은 지금 반 시작일(' + rel.start_date + ') 다음 날부터 고를 수 있습니다. 잘못 넣은 배정이면 배정 삭제 후 다시 배정해 주세요.';
    }
    var later = lessonOnOrAfter_(rel.student_id, rel.class_id, start);
    if (later) return '이동일 이후(' + later + ') 지금 반에 수업 기록이 있습니다. 이동일을 그 뒤로 잡아 주세요.';
    return '';
  }

  function applyMove_(rel, toClassId, start) {
    rel.end_date = LMS.addDays(start, -1);
    rel.status = '종료';
    rel.updated_at = now();
    saveTable('StudentClasses', table('StudentClasses'));
    var created = assignStudentToClass({ student_id: rel.student_id, class_id: toClassId, start_date: start }, true);
    moveTempSource_(rel.student_id, LMS.toStr(rel.class_id), LMS.toStr(toClassId), start);
    syncExamPrep_([{ student_id: rel.student_id, start: LMS.toStr(rel.start_date), end: '' }]);
    return created;
  }

  /**
   * Exam-prep placements name the regular class the student is away from. After a move on `start`,
   * the days from then on are away from the new class (a placement spanning the move is split).
   */
  function moveTempSource_(studentId, fromClassId, toClassId, start) {
    var rels = table('StudentClasses');
    var touched = {};
    var ts = now();
    rels.slice().forEach(function (r) {
      if (LMS.toStr(r.status) !== '임시' || LMS.toStr(r.student_id) !== LMS.toStr(studentId)) return;
      if (LMS.toStr(r.source_class_id) !== fromClassId || LMS.toStr(r.end_date) < start) return;
      if (LMS.toStr(r.start_date) >= start) {
        r.source_class_id = toClassId;
      } else {
        rels.push(Object.assign({}, r, {
          id: nextIds('REL', 1)[0], start_date: start, source_class_id: toClassId, created_at: ts
        }));
        r.end_date = LMS.addDays(start, -1);
      }
      r.updated_at = ts;
      var cls = LMS.findById(table('Classes'), 'class_id', r.class_id);
      if (cls && cls.exam_period_id) touched[LMS.toStr(cls.exam_period_id)] = true;
    });
    if (!Object.keys(touched).length) return;
    saveTable('StudentClasses', rels);
    Object.keys(touched).forEach(recomputeResumeDates_);
  }

  /**
   * After regular assignments change ([{ student_id, start, end }] = the ranges they covered): placements
   * whose source class the student no longer attends in that range point at one they do (as in
   * migrateToV4_; kept when there is none), and resume dates of overlapping periods are recomputed.
   */
  function syncExamPrep_(changes) {
    var rels = table('StudentClasses');
    var classes = table('Classes');
    var touched = {};
    var changed = false;
    var ts = now();
    changes.forEach(function (c) {
      rels.forEach(function (r) {
        if (LMS.toStr(r.status) !== '임시' || LMS.toStr(r.student_id) !== LMS.toStr(c.student_id)) return;
        var sources = regularClassIdsOf_(r.student_id, r.start_date, r.end_date);
        if (!sources.length || sources.indexOf(LMS.toStr(r.source_class_id)) !== -1) return;
        r.source_class_id = sources[0];
        r.updated_at = ts;
        changed = true;
        var cls = LMS.findById(classes, 'class_id', r.class_id);
        if (cls && cls.exam_period_id) touched[LMS.toStr(cls.exam_period_id)] = true;
      });
      examPeriods_().forEach(function (p) {
        if (LMS.rangesOverlap(p.start_date, p.end_date, c.start, c.end)) touched[LMS.toStr(p.exam_period_id)] = true;
      });
    });
    if (changed) saveTable('StudentClasses', rels);
    Object.keys(touched).forEach(recomputeResumeDates_);
  }

  function closeStudentClass(data) {
    return withLock(function () {
      data = data || {};
      var rels = table('StudentClasses');
      var row = data.id ? LMS.findById(rels, 'id', data.id) : null;
      if (!row && data.student_id && data.class_id) {
        row = regularRels_(data.student_id).filter(function (r) { return LMS.toStr(r.class_id) === LMS.toStr(data.class_id); })[0];
      }
      if (!row || LMS.toStr(row.status) !== '현재') throw new Error('현재 반 배정 정보를 찾을 수 없습니다.');
      var end = LMS.toStr(data.end_date) || store.today();
      if (!LMS.isIsoDate(end)) throw new Error('반 종료일 형식이 올바르지 않습니다.');
      if (end < LMS.toStr(row.start_date)) throw new Error('마지막 수업일이 반 시작일(' + row.start_date + ')보다 빠릅니다. 잘못 넣은 배정이면 배정 삭제를 써 주세요.');
      var later = lessonOnOrAfter_(row.student_id, row.class_id, LMS.addDays(end, 1));
      if (later) throw new Error('마지막 수업일 뒤(' + later + ')에 이 반 수업 기록이 있습니다. 날짜를 그 뒤로 잡아 주세요.');
      row.end_date = end;
      row.status = '종료';
      row.updated_at = now();
      saveTable('StudentClasses', rels);
      syncExamPrep_([{ student_id: row.student_id, start: LMS.toStr(row.start_date), end: '' }]);
      return row;
    });
  }

  /** Whether a regular assignment left no trace (no lessons or homework checks) and can be deleted. */
  function relRemovable_(rel) {
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
  function removeStudentClass(data) {
    return withLock(function () {
      var rels = table('StudentClasses');
      var row = LMS.findById(rels, 'id', data && data.id);
      if (!row) throw new Error('반 배정 정보를 찾을 수 없습니다.');
      if (LMS.toStr(row.status) === '임시') throw new Error('시험대비 임시 배정은 시험 화면에서 바꿔 주세요.');
      if (!relRemovable_(row)) throw new Error('이 반에 수업 기록이나 숙제 체크가 있어 삭제할 수 없습니다. ‘반에서 빼기’를 써 주세요.');
      saveTable('StudentClasses', rels.filter(function (r) { return r !== row; }));
      syncExamPrep_([{ student_id: row.student_id, start: LMS.toStr(row.start_date), end: LMS.toStr(row.end_date) }]);
      return { deleted: true, id: row.id };
    });
  }

  /** Move one student: from_rel_id / from_class_id picks the class they leave (required with two). */
  function moveStudent(data) {
    return withLock(function () {
      data = data || {};
      var studentId = LMS.toStr(data.student_id);
      var newClassId = LMS.toStr(data.class_id);
      requireStudent(studentId);
      requireClass(newClassId);
      var start = LMS.toStr(data.start_date) || store.today();
      var rel = pickRel_(studentId, LMS.toStr(data.from_rel_id || data.current_rel_id), LMS.toStr(data.from_class_id));
      var problem = moveProblem_(rel, newClassId, start);
      if (problem) throw new Error(problem);
      return applyMove_(rel, newClassId, start);
    });
  }

  /**
   * Move several students of one class together. Every student is checked first; if any cannot
   * move, nothing changes and the reasons come back per student.
   */
  function moveStudents(data) {
    return withLock(function () {
      data = data || {};
      var fromId = LMS.toStr(data.from_class_id);
      var toId = LMS.toStr(data.to_class_id);
      requireClass(fromId);
      requireClass(toId);
      var start = LMS.toStr(data.date) || store.today();
      var ids = LMS.uniqueIds(data.student_ids);
      if (!ids.length) throw new Error('옮길 학생을 골라 주세요.');
      var students = table('Students');
      var plan = [];
      var problems = [];
      ids.forEach(function (sid) {
        var st = LMS.findById(students, 'student_id', sid);
        var name = st ? st.name : sid;
        var rel = regularRels_(sid).filter(function (r) { return LMS.toStr(r.class_id) === fromId; })[0];
        var problem = rel ? moveProblem_(rel, toId, start) : '이 반의 정규 배정이 아닙니다.';
        if (problem) problems.push(name + ': ' + problem);
        else plan.push(rel);
      });
      if (problems.length) throw new Error('옮기지 않았습니다.\n' + problems.join('\n'));
      var moved = plan.map(function (rel) { return applyMove_(rel, toId, start); });
      return { moved_count: moved.length };
    });
  }

  function getLessons(date, classId) {
    if (!LMS.isIsoDate(date)) throw new Error('수업일 형식이 올바르지 않습니다.');
    return table('Lessons').filter(function (row) {
      if (LMS.toStr(row.lesson_date) !== LMS.toStr(date)) return false;
      if (classId && LMS.toStr(row.class_id) !== LMS.toStr(classId)) return false;
      return true;
    }).sort(function (a, b) {
      return LMS.toStr(a.student_id).localeCompare(LMS.toStr(b.student_id));
    });
  }

  function getStudentLessons(studentId, startDate, endDate) {
    requireStudent(studentId);
    var all = table('Lessons');
    var rows = all.filter(function (row) {
      if (LMS.toStr(row.student_id) !== LMS.toStr(studentId)) return false;
      return LMS.inRange(row.lesson_date, startDate, endDate);
    });
    var cache = {};
    function classAvg(date, classId) {
      var key = LMS.toStr(date) + '|' + LMS.toStr(classId);
      if (!Object.prototype.hasOwnProperty.call(cache, key)) {
        cache[key] = LMS.computeDailyClassTestAverage(all.filter(function (row) {
          return LMS.toStr(row.lesson_date) === LMS.toStr(date) &&
            LMS.toStr(row.class_id) === LMS.toStr(classId);
        }));
      }
      return cache[key];
    }
    return rows.map(function (row) {
      return Object.assign({}, row, {
        class_test_average: classAvg(row.lesson_date, row.class_id)
      });
    }).sort(function (a, b) {
      return LMS.toStr(b.lesson_date).localeCompare(LMS.toStr(a.lesson_date));
    });
  }

  function getLesson(lessonId) {
    var row = LMS.findById(table('Lessons'), 'lesson_id', lessonId);
    if (!row) throw new Error('수업 기록을 찾을 수 없습니다.');
    return row;
  }

  function findClassSessionNoticeRow_(date, classId) {
    var key = LMS.sessionKey(date, classId);
    var rows = table('ClassSessionNotices');
    for (var i = 0; i < rows.length; i++) {
      if (LMS.sessionKey(rows[i].lesson_date, rows[i].class_id) === key) {
        return rows[i];
      }
    }
    return null;
  }

  function getClassSessionNotice(date, classId) {
    var session = findClassSessionRow_(date, classId);
    if (session && LMS.toStr(session.class_notice)) return LMS.toStr(session.class_notice);
    var row = findClassSessionNoticeRow_(date, classId);
    return row ? LMS.toStr(row.class_notice) : '';
  }

  function saveClassSessionNotice(date, classId, text) {
    return withLock(function () {
      requireClass(classId);
      if (!LMS.isIsoDate(LMS.toStr(date))) {
        throw new Error('수업 날짜가 올바르지 않습니다.');
      }
      upsertClassSession_({ lesson_date: date, class_id: classId, class_notice: LMS.toStr(text) });
      removeLegacyNotice_(date, classId);
      var notice = LMS.toStr(text);
      return notice ? { lesson_date: LMS.toStr(date), class_id: LMS.toStr(classId), class_notice: notice } : null;
    });
  }

  function removeLegacyNotice_(date, classId) {
    var rows = table('ClassSessionNotices');
    var key = LMS.sessionKey(date, classId);
    var next = rows.filter(function (r) {
      return LMS.sessionKey(r.lesson_date, r.class_id) !== key;
    });
    if (next.length !== rows.length) saveTable('ClassSessionNotices', next);
  }

  // ----- Class sessions (one row per class per lesson date) -----

  function findClassSessionRow_(date, classId) {
    var key = LMS.sessionKey(date, classId);
    var rows = table('ClassSessions');
    for (var i = 0; i < rows.length; i++) {
      if (LMS.sessionKey(rows[i].lesson_date, rows[i].class_id) === key) return rows[i];
    }
    return null;
  }

  /** Merge the given session fields into the (date, class) row, creating it when missing. */
  function upsertClassSession_(fields) {
    var date = LMS.toStr(fields.lesson_date);
    var classId = LMS.toStr(fields.class_id);
    var rows = table('ClassSessions');
    var row = findClassSessionRow_(date, classId);
    var ts = now();
    if (!row) {
      row = {
        session_id: nextIds('SES', 1)[0],
        lesson_date: date,
        class_id: classId,
        progress: '',
        content: '',
        test_title: '',
        test_max_score: '',
        test_difficulty: '',
        class_notice: '',
        memo: '',
        created_at: ts,
        updated_at: ts
      };
      rows.push(row);
    }
    LMS.CLASS_SESSION_FIELDS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined) {
        row[key] = fields[key];
      }
    });
    row.updated_at = ts;
    saveTable('ClassSessions', rows);
    return row;
  }

  function homeworkItemsOn_(date, classId) {
    return table('HomeworkItems').filter(function (row) {
      return LMS.toStr(row.lesson_date) === LMS.toStr(date) && LMS.toStr(row.class_id) === LMS.toStr(classId);
    });
  }

  /** The class homework text of a date: its checklist items, else the text most student rows carry (legacy). */
  function classHomeworkText_(date, classId) {
    var items = listHomeworkItemRows_(date, classId);
    if (items.length) return LMS.joinHomeworkTitles(items);
    return LMS.modeValue(getLessons(date, classId).map(function (l) { return LMS.toStr(l.homework); }));
  }

  /**
   * Copy the class-level fields of a date (session progress / difficulty / max, homework text) onto
   * every student lesson of that date and class, so every reader of a lesson row sees the class values.
   * options.prevMax: the session max before this save; options.homework: text to use when the date has
   * no checklist; options.legacyHomework false: leave homework alone when there is no checklist;
   * options.testedOnly: difficulty only on tested rows; options.keepMax: never touch max.
   */
  function applySessionToLessons_(date, classId, options) {
    options = options || {};
    var session = findClassSessionRow_(date, classId);
    var homework = null;
    if (homeworkItemsOn_(date, classId).length) homework = classHomeworkText_(date, classId);
    else if (options.homework !== undefined) homework = LMS.toStr(options.homework);
    else if (options.legacyHomework !== false) homework = classHomeworkText_(date, classId);
    if (!session && homework === null) return;
    var lessons = table('Lessons');
    var key = LMS.sessionKey(date, classId);
    var prevMax = options.prevMax;
    var changed = false;
    lessons.forEach(function (row) {
      if (LMS.sessionKey(row.lesson_date, row.class_id) !== key) return;
      var next = {};
      if (session) {
        next.progress = LMS.toStr(session.progress);
        if (!options.testedOnly || LMS.toStr(row.test_status) === '실시') {
          next.test_difficulty = LMS.toStr(session.test_difficulty);
        }
        // Max score follows the session unless a student row carries its own different value.
        if (!options.keepMax && !LMS.isBlank(session.test_max_score) &&
            (LMS.isBlank(row.test_max_score) ||
             (prevMax !== undefined && LMS.toStr(row.test_max_score) === LMS.toStr(prevMax)))) {
          next.test_max_score = session.test_max_score;
        }
      }
      if (homework !== null) next.homework = homework;
      Object.keys(next).forEach(function (k) {
        if (LMS.toStr(row[k]) !== LMS.toStr(next[k])) {
          row[k] = next[k];
          changed = true;
        }
      });
    });
    if (changed) saveTable('Lessons', lessons);
  }

  /**
   * Keep Classes.current_progress on the latest recorded progress. prevProgress is the session's
   * progress before this save: clearing the progress the class shows falls back to the latest left.
   */
  function syncClassProgress_(session, prevProgress) {
    var progress = LMS.toStr(session.progress);
    var classId = LMS.toStr(session.class_id);
    var latest = table('ClassSessions').filter(function (r) {
      return LMS.toStr(r.class_id) === classId && LMS.toStr(r.progress);
    }).sort(function (a, b) {
      return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
    }).pop();
    var classes = table('Classes');
    var cls = LMS.findById(classes, 'class_id', classId);
    if (!cls) return;
    var next;
    if (progress) {
      if (latest && LMS.toStr(latest.lesson_date) > LMS.toStr(session.lesson_date)) return;
      next = progress;
    } else {
      if (!latest || !prevProgress || LMS.toStr(cls.current_progress) !== LMS.toStr(prevProgress)) return;
      next = LMS.toStr(latest.progress);
    }
    if (LMS.toStr(cls.current_progress) === next) return;
    cls.current_progress = next;
    cls.updated_at = now();
    saveTable('Classes', classes);
  }

  function getClassSession(date, classId) {
    requireClass(classId);
    if (!LMS.isIsoDate(LMS.toStr(date))) throw new Error('수업 날짜가 올바르지 않습니다.');
    var row = findClassSessionRow_(date, classId);
    var base = row ? Object.assign({}, row) : {
      session_id: '',
      lesson_date: LMS.toStr(date),
      class_id: LMS.toStr(classId),
      progress: '',
      content: '',
      test_title: '',
      test_max_score: '',
      test_difficulty: '',
      class_notice: '',
      memo: ''
    };
    if (!LMS.toStr(base.class_notice)) base.class_notice = getClassSessionNotice(date, classId);
    return base;
  }

  function saveClassSession(data) {
    return withLock(function () {
      var input = LMS.validateClassSessionInput(data);
      requireClass(input.class_id);
      var prev = findClassSessionRow_(input.lesson_date, input.class_id);
      var prevMax = prev ? prev.test_max_score : undefined;
      var prevProgress = prev ? LMS.toStr(prev.progress) : '';
      var row = upsertClassSession_(input);
      removeLegacyNotice_(input.lesson_date, input.class_id);
      applySessionToLessons_(row.lesson_date, row.class_id, { prevMax: prevMax });
      syncClassProgress_(row, prevProgress);
      return Object.assign({}, row);
    });
  }

  function saveLessonsBatch(payload) {
    var list;
    var classNotice;
    if (payload && !Array.isArray(payload) && Array.isArray(payload.items)) {
      list = payload.items;
      if (payload.class_notice !== undefined && payload.class_notice !== null) {
        classNotice = payload.class_notice;
      }
    } else if (Array.isArray(payload)) {
      list = payload;
    } else {
      list = [payload];
    }
    return withLock(function () {
      var validated = list.map(function (item) {
        var input = Object.assign({}, item);
        if (LMS.toStr(input.test_status) === '실시' && LMS.isBlank(input.test_max_score)) {
          var session = findClassSessionRow_(input.lesson_date, input.class_id);
          if (session && !LMS.isBlank(session.test_max_score)) input.test_max_score = session.test_max_score;
        }
        return LMS.validateLessonInput(input);
      });
      var students = table('Students');
      var classes = table('Classes');
      validated.forEach(function (row) {
        if (!LMS.findById(students, 'student_id', row.student_id)) {
          throw new Error('학생 정보를 찾을 수 없습니다.');
        }
        if (!LMS.findById(classes, 'class_id', row.class_id)) {
          throw new Error('반 정보를 찾을 수 없습니다.');
        }
      });
      var lessons = table('Lessons');
      var index = {};
      lessons.forEach(function (row, i) {
        index[LMS.lessonKey(row.lesson_date, row.student_id, row.class_id)] = i;
      });
      var insertCount = 0;
      validated.forEach(function (row) {
        var key = LMS.lessonKey(row.lesson_date, row.student_id, row.class_id);
        if (index[key] === undefined) insertCount += 1;
      });
      var newIds = insertCount ? nextIds('LES', insertCount) : [];
      var idPos = 0;
      var ts = now();
      var saved = [];
      validated.forEach(function (row) {
        var key = LMS.lessonKey(row.lesson_date, row.student_id, row.class_id);
        var existingIndex = index[key];
        if (existingIndex !== undefined) {
          var prev = lessons[existingIndex];
          var merged = Object.assign({}, prev, row, {
            lesson_id: prev.lesson_id,
            created_at: prev.created_at,
            updated_at: ts
          });
          lessons[existingIndex] = merged;
          saved.push(merged);
        } else {
          var created = Object.assign({}, row, {
            lesson_id: newIds[idPos++],
            created_at: ts,
            updated_at: ts
          });
          index[key] = lessons.length;
          lessons.push(created);
          saved.push(created);
        }
      });
      saveTable('Lessons', lessons);
      syncSessionsFromLessons_(list, saved);
      if (classNotice !== undefined && saved.length) {
        saveClassSessionNotice(saved[0].lesson_date, saved[0].class_id, classNotice);
      }
      return saved.map(function (row) {
        return LMS.findById(table('Lessons'), 'lesson_id', row.lesson_id) || row;
      });
    });
  }

  /**
   * Legacy forms send progress / homework / test meta on each student row. When they do, that
   * becomes the class record; otherwise the stored class record is copied back onto the rows.
   */
  function syncSessionsFromLessons_(rawList, saved) {
    var groups = {};
    saved.forEach(function (row, i) {
      var key = LMS.sessionKey(row.lesson_date, row.class_id);
      if (!groups[key]) groups[key] = { date: row.lesson_date, classId: row.class_id, raws: [] };
      groups[key].raws.push(rawList[i] || {});
    });
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var fields = {};
      var progress = LMS.modeValue(g.raws.map(function (r) { return LMS.toStr(r.progress); }));
      var difficulty = LMS.modeValue(g.raws.map(function (r) { return LMS.toStr(r.test_difficulty); }));
      var max = LMS.modeValue(g.raws.filter(function (r) {
        return LMS.toStr(r.test_status) === '실시';
      }).map(function (r) { return LMS.toStr(r.test_max_score); }));
      var session = findClassSessionRow_(g.date, g.classId);
      if (progress) fields.progress = progress;
      if (difficulty) fields.test_difficulty = difficulty;
      // A partial batch must not move the class max; it only seeds an empty one.
      if (max && !(session && !LMS.isBlank(session.test_max_score))) fields.test_max_score = LMS.toNum(max);
      if (Object.keys(fields).length) {
        var prevProgress = session ? LMS.toStr(session.progress) : '';
        fields.lesson_date = g.date;
        fields.class_id = g.classId;
        session = upsertClassSession_(fields);
        syncClassProgress_(session, prevProgress);
      }
      var homework = LMS.modeValue(g.raws.map(function (r) { return LMS.toStr(r.homework); }));
      var titles = LMS.splitHomeworkLines(homework);
      if (titles.length && homeworkItemsOn_(g.date, g.classId).length &&
          LMS.joinHomeworkTitles(titles.map(function (t) { return { title: t }; })) !== classHomeworkText_(g.date, g.classId)) {
        saveSessionHomework({ lesson_date: g.date, class_id: g.classId, titles: titles });
      }
      applySessionToLessons_(g.date, g.classId, homework ? { homework: homework } : {});
    });
  }

  function saveLesson(data) {
    return saveLessonsBatch([data])[0];
  }

  function updateLesson(data) {
    if (LMS.isBlank(data && data.lesson_id)) {
      return saveLesson(data);
    }
    return withLock(function () {
      var lessons = table('Lessons');
      var prev = LMS.findById(lessons, 'lesson_id', data.lesson_id);
      if (!prev) throw new Error('수업 기록을 찾을 수 없습니다.');
      var merged = LMS.validateLessonInput(Object.assign({}, prev, data, {
        lesson_id: prev.lesson_id
      }));
      prev = Object.assign(prev, merged, { updated_at: now(), lesson_id: prev.lesson_id, created_at: prev.created_at });
      saveTable('Lessons', lessons);
      // Progress / homework / difficulty are class values: an edit on one row edits the class record.
      syncSessionsFromLessons_([data], [prev]);
      return LMS.findById(table('Lessons'), 'lesson_id', prev.lesson_id) || prev;
    });
  }

  function listHomeworkItemRows_(date, classId) {
    return table('HomeworkItems').filter(function (row) {
      return LMS.toStr(row.lesson_date) === LMS.toStr(date) &&
        LMS.toStr(row.class_id) === LMS.toStr(classId);
    }).sort(function (a, b) {
      var so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so) return so;
      return LMS.toStr(a.item_id).localeCompare(LMS.toStr(b.item_id));
    });
  }

  function legacyHomeworkItems_(date, classId) {
    // The text most student rows carry, so one student's diverging row never becomes the class homework.
    var text = LMS.modeValue(getLessons(date, classId).map(function (l) { return LMS.toStr(l.homework); }));
    if (!text) {
      var cls = LMS.findById(table('Classes'), 'class_id', classId);
      if (cls) text = LMS.toStr(cls.class_homework);
    }
    return LMS.splitHomeworkLines(text).map(function (title, idx) {
      return {
        item_id: '',
        lesson_date: LMS.toStr(date),
        class_id: LMS.toStr(classId),
        title: title,
        sort_order: idx,
        legacy: true
      };
    });
  }

  function getSessionHomework(date, classId) {
    requireClass(classId);
    if (!LMS.isIsoDate(LMS.toStr(date))) {
      throw new Error('수업 날짜가 올바르지 않습니다.');
    }
    var items = listHomeworkItemRows_(date, classId);
    var fromLegacy = false;
    if (!items.length) {
      items = legacyHomeworkItems_(date, classId);
      fromLegacy = !!items.length;
    }
    var checks = table('HomeworkChecks');
    var checkByKey = {};
    checks.forEach(function (c) {
      checkByKey[LMS.toStr(c.item_id) + '|' + LMS.toStr(c.student_id)] = c;
    });
    var itemIds = items.map(function (it) { return it.item_id; }).filter(Boolean);
    var enrichedItems = items.map(function (it) {
      return {
        item_id: it.item_id,
        lesson_date: it.lesson_date,
        class_id: it.class_id,
        title: it.title,
        sort_order: it.sort_order,
        legacy: !!it.legacy
      };
    });
    return {
      lesson_date: LMS.toStr(date),
      class_id: LMS.toStr(classId),
      items: enrichedItems,
      from_legacy: fromLegacy,
      checks: checks.filter(function (c) {
        return itemIds.indexOf(LMS.toStr(c.item_id)) !== -1;
      })
    };
  }

  function syncLessonHomeworkText_(date, classId, titlesText) {
    var lessons = table('Lessons');
    var changed = false;
    var text = LMS.toStr(titlesText);
    lessons.forEach(function (row) {
      if (LMS.toStr(row.lesson_date) !== LMS.toStr(date)) return;
      if (LMS.toStr(row.class_id) !== LMS.toStr(classId)) return;
      if (LMS.toStr(row.homework) === text) return;
      row.homework = text;
      row.updated_at = now();
      changed = true;
    });
    if (changed) saveTable('Lessons', lessons);
  }

  function saveSessionHomework(data) {
    return withLock(function () {
      data = data || {};
      var date = LMS.toStr(data.lesson_date || data.date);
      var classId = LMS.toStr(data.class_id);
      requireClass(classId);
      if (!LMS.isIsoDate(date)) throw new Error('수업 날짜가 올바르지 않습니다.');
      var incoming = [];
      if (Array.isArray(data.items)) {
        data.items.forEach(function (it) {
          if (typeof it === 'string') {
            var s = LMS.toStr(it);
            if (s) incoming.push({ title: s, item_id: '' });
            return;
          }
          var t = LMS.toStr(it && it.title);
          if (!t) return;
          incoming.push({ title: t, item_id: LMS.toStr(it && it.item_id) });
        });
      } else if (Array.isArray(data.titles)) {
        data.titles.forEach(function (t) {
          var s = LMS.toStr(t);
          if (s) incoming.push({ title: s, item_id: '' });
        });
      }

      var rows = table('HomeworkItems');
      var others = rows.filter(function (row) {
        return !(LMS.toStr(row.lesson_date) === date && LMS.toStr(row.class_id) === classId);
      });
      var existing = rows.filter(function (row) {
        return LMS.toStr(row.lesson_date) === date && LMS.toStr(row.class_id) === classId;
      }).sort(function (a, b) {
        var so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
        if (so) return so;
        return LMS.toStr(a.item_id).localeCompare(LMS.toStr(b.item_id));
      });
      var byId = {};
      existing.forEach(function (row) { byId[LMS.toStr(row.item_id)] = row; });
      var unused = existing.slice();
      var planned = [];
      var createCount = 0;

      function takeUnused(pred) {
        for (var i = 0; i < unused.length; i++) {
          if (pred(unused[i], i)) {
            return unused.splice(i, 1)[0];
          }
        }
        return null;
      }

      incoming.forEach(function (inc) {
        var match = null;
        if (inc.item_id && byId[inc.item_id]) {
          match = takeUnused(function (row) {
            return LMS.toStr(row.item_id) === inc.item_id;
          });
        }
        if (!match) {
          match = takeUnused(function (row) {
            return LMS.toStr(row.title) === inc.title;
          });
        }
        if (!match && unused.length) {
          // Rename in place so checks stay attached when slots are edited.
          match = unused.shift();
        }
        if (match) {
          planned.push({
            item_id: match.item_id,
            title: inc.title,
            created_at: match.created_at,
            isNew: false
          });
        } else {
          createCount += 1;
          planned.push({
            item_id: '',
            title: inc.title,
            created_at: '',
            isNew: true
          });
        }
      });

      var oldItems = existing.slice();
      var oldChecks = table('HomeworkChecks').filter(function (c) { return !!byId[LMS.toStr(c.item_id)]; });
      var removedIds = unused.map(function (row) { return LMS.toStr(row.item_id); });
      if (removedIds.length) {
        var checks = table('HomeworkChecks').filter(function (c) {
          return removedIds.indexOf(LMS.toStr(c.item_id)) === -1;
        });
        saveTable('HomeworkChecks', checks);
      }

      var ts = now();
      var newIds = createCount ? nextIds('HWI', createCount) : [];
      var idPos = 0;
      var saved = planned.map(function (plan, idx) {
        var itemId = plan.isNew ? newIds[idPos++] : plan.item_id;
        return {
          item_id: itemId,
          lesson_date: date,
          class_id: classId,
          title: plan.title,
          sort_order: idx,
          created_at: plan.isNew ? ts : (plan.created_at || ts),
          updated_at: ts
        };
      });
      saveTable('HomeworkItems', others.concat(saved));
      syncLessonHomeworkText_(date, classId, LMS.joinHomeworkTitles(saved));
      regradeCheckedLesson_(date, classId, oldItems, oldChecks);
      return getSessionHomework(date, classId);
    });
  }

  /**
   * Date whose homework is checked at the lesson on `date`: the previous scheduled meeting, or a
   * later recorded day (a makeup, or a day of the class's old timetable) when there is one.
   */
  function priorLessonDate_(cls, date) {
    var best = LMS.previousMeetingDateFor(cls, date, examPeriods_());
    var floor = best || LMS.addDays(date, -90);
    var classId = LMS.toStr(cls.class_id);
    var consider = function (row) {
      var d = LMS.toStr(row.lesson_date);
      if (LMS.toStr(row.class_id) !== classId || d >= date || d <= floor || (best && d <= best)) return;
      best = d;
    };
    table('Lessons').forEach(consider);
    table('ClassSessions').forEach(consider);
    table('HomeworkItems').forEach(consider);
    return best;
  }

  /**
   * After the homework items of `date` change, the auto grades written on the lesson that checked
   * them follow the new items. A grade the teacher picked by hand (≠ the old auto grade) is kept.
   */
  function regradeCheckedLesson_(date, classId, oldItems, oldChecks) {
    if (!oldChecks.length) return;
    var cls = LMS.findById(table('Classes'), 'class_id', classId);
    if (!cls) return;
    var checkDate = table('Lessons').filter(function (l) {
      return LMS.toStr(l.class_id) === LMS.toStr(classId) && LMS.toStr(l.lesson_date) > LMS.toStr(date);
    }).map(function (l) { return LMS.toStr(l.lesson_date); }).sort()[0];
    if (!checkDate || priorLessonDate_(cls, checkDate) !== LMS.toStr(date)) return;
    var items = listHomeworkItemRows_(date, classId);
    var ids = {};
    items.forEach(function (it) { ids[LMS.toStr(it.item_id)] = true; });
    var checks = table('HomeworkChecks').filter(function (c) { return !!ids[LMS.toStr(c.item_id)]; });
    var lessons = table('Lessons');
    var changed = false;
    lessons.forEach(function (row) {
      if (LMS.toStr(row.class_id) !== LMS.toStr(classId) || LMS.toStr(row.lesson_date) !== checkDate) return;
      var before = homeworkCompletionForStudent_(oldItems, oldChecks, row.student_id).grade;
      if (!before || LMS.toStr(row.assignment_completion) !== before) return;
      var after = homeworkCompletionForStudent_(items, checks, row.student_id).grade;
      if (after === before) return;
      row.assignment_completion = after;
      row.updated_at = now();
      changed = true;
    });
    if (changed) saveTable('Lessons', lessons);
  }

  function homeworkCompletionForStudent_(items, checks, studentId) {
    var itemIds = (items || []).map(function (it) { return LMS.toStr(it.item_id); }).filter(Boolean);
    if (!itemIds.length) return { done: 0, total: 0, grade: '' };
    var done = 0;
    itemIds.forEach(function (itemId) {
      var hit = (checks || []).some(function (c) {
        return LMS.toStr(c.item_id) === itemId &&
          LMS.toStr(c.student_id) === LMS.toStr(studentId) &&
          LMS.toStr(c.status) === '완료';
      });
      if (hit) done += 1;
    });
    return {
      done: done,
      total: itemIds.length,
      grade: LMS.assignmentGradeFromChecks(done, itemIds.length)
    };
  }

  function saveHomeworkChecks(data) {
    return withLock(function () {
      data = data || {};
      var date = LMS.toStr(data.lesson_date || data.assigned_date || data.date);
      var classId = LMS.toStr(data.class_id);
      var checkDate = LMS.toStr(data.check_date) || store.today();
      requireClass(classId);
      if (!LMS.isIsoDate(date)) throw new Error('숙제 배정일 형식이 올바르지 않습니다.');
      if (checkDate && !LMS.isIsoDate(checkDate)) {
        throw new Error('확인일 형식이 올바르지 않습니다.');
      }
      var session = getSessionHomework(date, classId);
      var items = session.items;
      if (session.from_legacy && items.length) {
        session = saveSessionHomework({
          lesson_date: date,
          class_id: classId,
          items: items.map(function (it) { return { title: it.title }; })
        });
        items = session.items;
      }
      if (!items.length) throw new Error('확인할 숙제 항목이 없습니다.');
      var itemById = {};
      items.forEach(function (it) { itemById[LMS.toStr(it.item_id)] = it; });
      var incoming = Array.isArray(data.checks) ? data.checks : [];
      var rows = table('HomeworkChecks');
      var ts = now();
      var byKey = {};
      rows.forEach(function (row, idx) {
        byKey[LMS.toStr(row.item_id) + '|' + LMS.toStr(row.student_id)] = idx;
      });
      var studentIds = {};
      incoming.forEach(function (c) {
        var itemId = LMS.toStr(c.item_id);
        if (!itemId && c.index !== undefined && c.index !== null && items[Number(c.index)]) {
          itemId = LMS.toStr(items[Number(c.index)].item_id);
        }
        if (!itemId && c.title) {
          var byTitle = items.filter(function (it) {
            return LMS.toStr(it.title) === LMS.toStr(c.title);
          })[0];
          if (byTitle) itemId = LMS.toStr(byTitle.item_id);
        }
        var studentId = LMS.toStr(c.student_id);
        if (!itemById[itemId]) throw new Error('숙제 항목을 찾을 수 없습니다.');
        requireStudent(studentId);
        var status = LMS.toStr(c.status) || '미완료';
        LMS.assertEnum(status, LMS.HOMEWORK_CHECK_STATUS, '숙제 완료 여부');
        studentIds[studentId] = true;
        var key = itemId + '|' + studentId;
        if (Object.prototype.hasOwnProperty.call(byKey, key)) {
          var existing = rows[byKey[key]];
          existing.status = status;
          existing.updated_at = ts;
        } else {
          var created = {
            check_id: nextIds('HWC', 1)[0],
            item_id: itemId,
            student_id: studentId,
            status: status,
            created_at: ts,
            updated_at: ts
          };
          byKey[key] = rows.length;
          rows.push(created);
        }
      });
      saveTable('HomeworkChecks', rows);

      var checksForItems = rows.filter(function (c) {
        return !!itemById[LMS.toStr(c.item_id)];
      });
      var grades = [];
      var lessonUpserts = [];
      Object.keys(studentIds).forEach(function (studentId) {
        var comp = homeworkCompletionForStudent_(items, checksForItems, studentId);
        grades.push({
          student_id: studentId,
          done: comp.done,
          total: comp.total,
          assignment_completion: comp.grade
        });
        if (!comp.grade) return;
        lessonUpserts.push({
          lesson_date: checkDate,
          class_id: classId,
          student_id: studentId,
          attendance: '출석',
          test_status: '미실시',
          assignment_completion: comp.grade
        });
      });
      if (lessonUpserts.length) {
        var lessonRows = table('Lessons');
        var index = {};
        lessonRows.forEach(function (row, i) {
          index[LMS.lessonKey(row.lesson_date, row.student_id, row.class_id)] = i;
        });
        var insertCount = 0;
        lessonUpserts.forEach(function (row) {
          var key = LMS.lessonKey(row.lesson_date, row.student_id, row.class_id);
          if (index[key] === undefined) insertCount += 1;
        });
        var newIds = insertCount ? nextIds('LES', insertCount) : [];
        var idPos = 0;
        lessonUpserts.forEach(function (row) {
          var key = LMS.lessonKey(row.lesson_date, row.student_id, row.class_id);
          if (index[key] !== undefined) {
            var prev = lessonRows[index[key]];
            prev.assignment_completion = row.assignment_completion;
            prev.updated_at = ts;
          } else {
            lessonRows.push({
              lesson_id: newIds[idPos++],
              lesson_date: row.lesson_date,
              student_id: row.student_id,
              class_id: row.class_id,
              attendance: row.attendance,
              test_status: row.test_status,
              test_score: '',
              test_max_score: '',
              test_difficulty: '',
              assignment_completion: row.assignment_completion,
              concentration: '',
              progress: '',
              homework: '',
              special_note: '',
              created_at: ts,
              updated_at: ts
            });
          }
        });
        saveTable('Lessons', lessonRows);
        // Rows created here are lessons of the check date: give them that date's class record.
        applySessionToLessons_(checkDate, classId);
      }

      return {
        assigned_date: date,
        check_date: checkDate,
        class_id: classId,
        items: items,
        checks: checksForItems,
        grades: grades
      };
    });
  }

  function buildHomeworkSlot_(classId, className, checkDate, assignedDate, rosterIds) {
    var session = assignedDate ? getSessionHomework(assignedDate, classId) : { items: [], checks: [] };
    var items = session.items || [];
    var checks = session.checks || [];
    var itemCount = items.filter(function (it) { return it.item_id || it.title; }).length;
    var doneCells = 0;
    var totalCells = itemCount * (rosterIds || []).length;
    var studentsIncomplete = 0;
    (rosterIds || []).forEach(function (studentId) {
      var comp = homeworkCompletionForStudent_(items.filter(function (it) { return it.item_id; }), checks, studentId);
      if (!items.some(function (it) { return it.item_id; }) && itemCount) {
        // legacy titles without ids: treat as incomplete until materialized
        studentsIncomplete += 1;
        return;
      }
      doneCells += comp.done;
      if (comp.total && comp.done < comp.total) studentsIncomplete += 1;
      if (!comp.total && itemCount) studentsIncomplete += 1;
    });
    return {
      check_date: checkDate,
      assigned_date: assignedDate || '',
      items: items.map(function (it) {
        return { item_id: it.item_id, title: it.title, sort_order: it.sort_order };
      }),
      completion: {
        done: doneCells,
        total: totalCells,
        students_incomplete: studentsIncomplete,
        item_count: itemCount,
        student_count: (rosterIds || []).length
      }
    };
  }

  function getWeeklyHomeworkDashboard(anchorDate) {
    anchorDate = anchorDate || store.today();
    if (!LMS.isIsoDate(anchorDate)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var week = LMS.weekRange(anchorDate);
    var periods = examPeriods_();
    var classes = table('Classes').filter(function (c) {
      return LMS.toStr(c.status) === '운영';
    }).sort(function (a, b) {
      return LMS.toStr(a.class_name).localeCompare(LMS.toStr(b.class_name), 'ko');
    });
    var result = classes.map(function (cls) {
      var meetingDates = LMS.classMeetingDatesFor(cls, week.start, week.end, periods);
      var slots = meetingDates.map(function (checkDate) {
        var rosterIds = rosterOn(cls.class_id, checkDate).filter(function (s) {
          return LMS.toStr(s.status) === '재원';
        }).map(function (s) { return s.student_id; });
        var assigned = priorLessonDate_(cls, checkDate);
        return buildHomeworkSlot_(cls.class_id, cls.class_name, checkDate, assigned, rosterIds);
      });
      var incompleteSlots = slots.filter(function (s) {
        return s.completion.item_count > 0 && s.completion.students_incomplete > 0;
      }).length;
      return {
        class_id: cls.class_id,
        class_name: cls.class_name,
        weekday: cls.weekday,
        slots: slots,
        incomplete_slot_count: incompleteSlots
      };
    }).filter(function (row) {
      return row.slots.length > 0;
    });
    return {
      anchor_date: anchorDate,
      week_start: week.start,
      week_end: week.end,
      week_label: LMS.formatKoreanDate(week.start) + ' ~ ' + LMS.formatKoreanDate(week.end),
      classes: result
    };
  }

  function getTodayClassSession(date, classId) {
    var cls = requireClass(classId);
    var periods = examPeriods_();
    var roster = rosterOn(classId, date);
    var students = roster.filter(function (s) {
      return LMS.toStr(s.status) === '재원';
    });
    var onLeave = roster.filter(function (s) {
      return LMS.toStr(s.status) === '휴원';
    }).map(function (s) { return { student_id: s.student_id, name: s.name }; });
    var lessons = getLessons(date, classId);
    var byStudent = {};
    lessons.forEach(function (l) { byStudent[l.student_id] = l; });
    // Keep students who already have a record that day even if no longer on the roster.
    var allStudents = table('Students');
    lessons.forEach(function (l) {
      if (students.some(function (s) { return s.student_id === l.student_id; })) return;
      var extra = LMS.findById(allStudents, 'student_id', l.student_id);
      if (extra) students.push(Object.assign({}, extra, { off_roster: true }));
    });
    var prevMeeting = LMS.previousMeetingDateFor(cls, date, periods);
    var lastSession = table('ClassSessions').filter(function (r) {
      return LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.toStr(r.lesson_date) < date && LMS.toStr(r.progress);
    }).sort(function (a, b) { return LMS.toStr(b.lesson_date).localeCompare(LMS.toStr(a.lesson_date)); })[0];
    var priorDate = priorLessonDate_(cls, date);
    var priorHomework = priorDate ? getSessionHomework(priorDate, classId) : null;
    var todayHomework = getSessionHomework(date, classId);
    var priorChecksByStudent = {};
    if (priorHomework) {
      students.forEach(function (s) {
        var map = {};
        (priorHomework.items || []).forEach(function (it) {
          if (!it.item_id) return;
          var hit = (priorHomework.checks || []).filter(function (c) {
            return LMS.toStr(c.item_id) === LMS.toStr(it.item_id) &&
              LMS.toStr(c.student_id) === LMS.toStr(s.student_id);
          })[0];
          map[it.item_id] = hit ? hit.status : '미완료';
        });
        priorChecksByStudent[s.student_id] = map;
      });
    }
    var suspension = LMS.toStr(cls.class_type) === '시험대비' ? null : LMS.classSuspensionOn(cls, date, periods);
    var cancellation = LMS.classCancellationOn(cls, date);
    var dailyPlan = getClassPlan(classId, '일간', date);
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
      session: getClassSession(date, classId),
      class_notice: getClassSessionNotice(date, classId),
      daily_plan: dailyPlan ? Object.assign({}, dailyPlan, {
        unit_titles: LMS.unitTitles(curriculum, LMS.jsonList(dailyPlan.unit_ids)),
        done_status: LMS.toStr(dailyPlan.done_status)
      }) : null,
      prior_homework: priorHomework ? {
        assigned_date: priorDate,
        items: priorHomework.items,
        from_legacy: priorHomework.from_legacy,
        has_checks: (priorHomework.checks || []).length > 0,
        checks_by_student: priorChecksByStudent
      } : null,
      today_homework: {
        lesson_date: date,
        items: todayHomework.items,
        from_legacy: todayHomework.from_legacy
      },
      students: students.map(function (s) {
        return Object.assign({}, s, {
          lesson: byStudent[s.student_id] || null,
          badges: views.studentBadges ? views.studentBadges(s) : []
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
    return withLock(function () {
      var p = payload || {};
      var date = LMS.toStr(p.lesson_date);
      var classId = LMS.toStr(p.class_id);
      if (!LMS.isIsoDate(date)) throw new Error('수업 날짜가 올바르지 않습니다.');
      requireClass(classId);
      var sessionInput = LMS.validateClassSessionInput(Object.assign({}, p.session || {}, { lesson_date: date, class_id: classId }));
      var students = Array.isArray(p.students) ? p.students : [];
      if (!students.length) throw new Error('저장할 학생이 없습니다.');
      var existingSession = findClassSessionRow_(date, classId);
      var maxScore = sessionInput.test_max_score !== undefined ? sessionInput.test_max_score
        : (existingSession ? existingSession.test_max_score : '');
      var difficulty = sessionInput.test_difficulty !== undefined ? sessionInput.test_difficulty
        : (existingSession ? existingSession.test_difficulty : '');
      var hwTitles = (Array.isArray(p.homework_items) ? p.homework_items : []).map(function (it) {
        return LMS.toStr(typeof it === 'string' ? it : it && it.title);
      }).filter(Boolean);

      var buildRow = function (s, grade) {
        var absent = LMS.toStr(s.attendance) === '결석';
        var tested = !absent && LMS.toStr(s.test_status) === '실시';
        if (tested && LMS.isBlank(maxScore)) throw new Error('테스트 만점을 입력해 주세요.');
        return {
          lesson_date: date,
          class_id: classId,
          student_id: LMS.toStr(s.student_id),
          attendance: absent ? '결석' : '출석',
          test_status: tested ? '실시' : '미실시',
          test_score: tested ? s.test_score : '',
          test_max_score: tested ? maxScore : '',
          test_difficulty: tested ? difficulty : '',
          assignment_completion: LMS.toStr(s.assignment_completion) || grade || '',
          concentration: absent ? 'ABSENT' : LMS.toStr(s.concentration),
          homework: hwTitles.join('\n'),
          special_note: LMS.toStr(s.special_note)
        };
      };
      // Validate every row up front so a bad score never leaves a half-saved lesson.
      students.forEach(function (s) {
        requireStudent(s.student_id);
        LMS.validateLessonInput(buildRow(s, ''));
      });

      var grades = {};
      var prior = p.prior || {};
      var checks = Array.isArray(prior.checks) ? prior.checks : [];
      if (LMS.isIsoDate(LMS.toStr(prior.assigned_date)) && checks.length) {
        var checked = saveHomeworkChecks({ lesson_date: prior.assigned_date, class_id: classId, check_date: date, checks: checks });
        (checked.grades || []).forEach(function (g) { grades[g.student_id] = g.assignment_completion; });
      }
      if (Array.isArray(p.homework_items)) {
        saveSessionHomework({ lesson_date: date, class_id: classId, items: p.homework_items });
      }
      saveClassSession(sessionInput);
      var saved = saveLessonsBatch(students.map(function (s) {
        return buildRow(s, grades[LMS.toStr(s.student_id)]);
      }));
      var plan = Object.prototype.hasOwnProperty.call(p, 'plan_done_status') && planner.setDailyPlanDone
        ? planner.setDailyPlanDone(classId, date, p.plan_done_status) : null;
      return { saved_count: saved.length, grades: grades, lessons: saved, daily_plan: plan };
    });
  }

  function enrichClassPlan(row) {
    if (!row) return null;
    var cls = LMS.findById(table('Classes'), 'class_id', row.class_id);
    var range = LMS.planPeriodRange(row.period_type, row.period_key);
    return Object.assign({}, row, {
      class_name: cls ? cls.class_name : '',
      period_label: LMS.formatPlanPeriodLabel(row.period_type, row.period_key),
      period_start: range.start,
      period_end: range.end
    });
  }

  function findClassPlanRow_(classId, periodType, periodKey) {
    var key = LMS.normalizePlanPeriodKey(periodType, periodKey);
    var rows = table('ClassPlans');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (LMS.toStr(row.class_id) === LMS.toStr(classId) &&
          LMS.toStr(row.period_type) === LMS.toStr(periodType) &&
          LMS.toStr(row.period_key) === key) {
        return row;
      }
    }
    return null;
  }

  function getClassPlan(classId, periodType, periodKey) {
    requireClass(classId);
    LMS.assertEnum(periodType, LMS.PLAN_PERIOD, '계획 기간');
    return enrichClassPlan(findClassPlanRow_(classId, periodType, periodKey));
  }

  function getClassPlans(filter) {
    filter = filter || {};
    var classId = LMS.toStr(filter.class_id || filter.classId);
    var periodType = LMS.toStr(filter.period_type || filter.periodType);
    if (periodType) LMS.assertEnum(periodType, LMS.PLAN_PERIOD, '계획 기간');
    var start = LMS.toStr(filter.start);
    var end = LMS.toStr(filter.end);
    if (start && !LMS.isIsoDate(start)) throw new Error('시작일 형식이 올바르지 않습니다.');
    if (end && !LMS.isIsoDate(end)) throw new Error('종료일 형식이 올바르지 않습니다.');
    return table('ClassPlans').filter(function (row) {
      if (classId && LMS.toStr(row.class_id) !== classId) return false;
      if (periodType && LMS.toStr(row.period_type) !== periodType) return false;
      if (start || end) {
        var range = LMS.planPeriodRange(row.period_type, row.period_key);
        if (end && range.start > end) return false;
        if (start && range.end < start) return false;
      }
      return true;
    }).map(enrichClassPlan).sort(function (a, b) {
      var dk = LMS.toStr(b.period_key).localeCompare(LMS.toStr(a.period_key));
      if (dk) return dk;
      return LMS.toStr(a.period_type).localeCompare(LMS.toStr(b.period_type), 'ko');
    });
  }

  function saveClassPlan(data) {
    return withLock(function () {
      var isUpdate = !LMS.isBlank(data && data.plan_id);
      var input = LMS.validateClassPlanInput(data, isUpdate);
      requireClass(input.class_id);
      var rows = table('ClassPlans');
      var ts = now();
      var existing = null;
      var idx = -1;
      if (isUpdate) {
        for (var i = 0; i < rows.length; i++) {
          if (LMS.toStr(rows[i].plan_id) === input.plan_id) {
            existing = rows[i];
            idx = i;
            break;
          }
        }
        if (!existing) throw new Error('강의 계획을 찾을 수 없습니다.');
      } else {
        existing = findClassPlanRow_(input.class_id, input.period_type, input.period_key);
        if (existing) {
          idx = rows.indexOf(existing);
        }
      }
      if (existing && idx >= 0) {
        var conflict = findClassPlanRow_(input.class_id, input.period_type, input.period_key);
        if (conflict && LMS.toStr(conflict.plan_id) !== LMS.toStr(existing.plan_id)) {
          throw new Error('같은 반·기간의 계획이 이미 있습니다.');
        }
        var updated = Object.assign({}, existing, {
          class_id: input.class_id,
          period_type: input.period_type,
          period_key: input.period_key,
          title: input.title,
          objectives: input.objectives,
          content: input.content,
          materials: input.materials,
          homework: input.homework,
          memo: input.memo,
          unit_ids: input.unit_ids,
          // A hand edit makes the plan the teacher's own; later splits treat it as fixed.
          source: 'manual',
          done_status: Object.prototype.hasOwnProperty.call(data, 'done_status') ? input.done_status : LMS.toStr(existing.done_status),
          updated_at: ts
        });
        rows[idx] = updated;
        saveTable('ClassPlans', rows);
        return enrichClassPlan(updated);
      }
      var created = {
        plan_id: nextIds('PLN', 1)[0],
        class_id: input.class_id,
        period_type: input.period_type,
        period_key: input.period_key,
        title: input.title,
        objectives: input.objectives,
        content: input.content,
        materials: input.materials,
        homework: input.homework,
        memo: input.memo,
        unit_ids: input.unit_ids,
        source: 'manual',
        rationale: '',
        done_status: input.done_status,
        created_at: ts,
        updated_at: ts
      };
      rows.push(created);
      saveTable('ClassPlans', rows);
      return enrichClassPlan(created);
    });
  }

  function deleteClassPlan(planId) {
    return withLock(function () {
      var id = LMS.toStr(planId);
      if (!id) throw new Error('강의 계획을 찾을 수 없습니다.');
      var rows = table('ClassPlans');
      var next = rows.filter(function (row) {
        return LMS.toStr(row.plan_id) !== id;
      });
      if (next.length === rows.length) throw new Error('강의 계획을 찾을 수 없습니다.');
      saveTable('ClassPlans', next);
      return { deleted: true, plan_id: id };
    });
  }

  function generateDailyReport(lessonId) {
    var lesson = getLesson(lessonId);
    var student = requireStudent(lesson.student_id);
    var classAvg = LMS.computeDailyClassTestAverage(getLessons(lesson.lesson_date, lesson.class_id));
    var notice = getClassSessionNotice(lesson.lesson_date, lesson.class_id);
    var text = LMS.buildDailyReport(lesson, student, settings(), classAvg, notice);
    return { lesson: lesson, student: student, text: text, class_test_average: classAvg };
  }

  function generateDailyReports(date, classId) {
    var lessons = getLessons(date, classId);
    var set = settings();
    var students = table('Students');
    var classAvg = LMS.computeDailyClassTestAverage(lessons);
    var notice = getClassSessionNotice(date, classId);
    var reports = lessons.map(function (lesson) {
      var student = LMS.findById(students, 'student_id', lesson.student_id) || { name: '학생' };
      return {
        lesson_id: lesson.lesson_id,
        student_id: lesson.student_id,
        student_name: student.name,
        text: LMS.buildDailyReport(lesson, student, set, classAvg, notice)
      };
    }).sort(function (a, b) {
      return LMS.toStr(a.student_name).localeCompare(LMS.toStr(b.student_name), 'ko');
    });
    return {
      class_test_average: classAvg,
      reports: reports
    };
  }

  function getMonthlyStats(studentId, year, month) {
    requireStudent(studentId);
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
      special_note: row.special_note
    };
  }

  function getMonthlyReportContext(studentId, year, month) {
    var student = requireStudent(studentId);
    var y = Number(year);
    var m = Number(month);
    if (!y || !m || m < 1 || m > 12) {
      throw new Error('연도와 월을 올바르게 입력해 주세요.');
    }
    var range = LMS.monthRange(y, m);
    var lessons = getStudentLessons(studentId, range.start, range.end).map(slimLessonForReport_);
    var stats = LMS.computeMonthlyStats(table('Lessons'), studentId, y, m);
    var set = settings();
    var baseText = LMS.buildMonthlyReport(stats, student, set);
    var counseling = getCounselingNotes(studentId).filter(function (note) {
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
      lessons: lessons,
      counseling_notes: counseling,
      learning_signals: LMS.detectLearningSignals(lessons),
      base_text: baseText,
      existing_report: existing
    };
  }

  function generateMonthlyReport(studentId, year, month) {
    var student = requireStudent(studentId);
    var stats = LMS.computeMonthlyStats(table('Lessons'), studentId, year, month);
    var text = LMS.buildMonthlyReport(stats, student, settings());
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
    return withLock(function () {
      var studentId = LMS.toStr(data.student_id);
      requireStudent(studentId);
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
      var ts = now();
      if (existing) {
        existing.report_text = text;
        existing.status = status;
        existing.updated_at = ts;
        saveTable('MonthlyReports', rows);
        return existing;
      }
      var row = {
        monthly_report_id: nextIds('MTH', 1)[0],
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
    });
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
    return withLock(function () {
      return (studentIds || []).map(function (sid) {
        try {
          var gen = generateMonthlyReport(sid, y, m);
          var existing = gen.existing;
          if (existing && LMS.toStr(existing.status) === '확정') return { student_id: sid, result: 'skipped', reason: '확정됨' };
          if (existing && !options.overwrite) return { student_id: sid, result: 'skipped', reason: '이미 있음' };
          if (!gen.stats.total_lessons) return { student_id: sid, result: 'skipped', reason: '이 달 수업 기록 없음' };
          var row = saveMonthlyReport({ student_id: sid, year: y, month: m, report_text: gen.generated_text, status: '임시' });
          return { student_id: sid, result: 'created', monthly_report_id: row.monthly_report_id };
        } catch (e) {
          return { student_id: sid, result: 'failed', reason: e.message };
        }
      });
    });
  }

  function getCounselingNotes(studentId) {
    requireStudent(studentId);
    var tasks = table('Tasks');
    return table('CounselingNotes').filter(function (row) {
      return LMS.toStr(row.student_id) === LMS.toStr(studentId);
    }).map(function (row) {
      var task = row.follow_up_task_id ? LMS.findById(tasks, 'task_id', row.follow_up_task_id) : null;
      return Object.assign({}, row, { follow_up_status: task ? LMS.toStr(task.status) : '' });
    }).sort(function (a, b) {
      var d = LMS.toStr(b.counsel_date).localeCompare(LMS.toStr(a.counsel_date));
      if (d) return d;
      return LMS.toStr(b.updated_at).localeCompare(LMS.toStr(a.updated_at));
    });
  }

  function saveCounselingNote(data) {
    return withLock(function () {
      var isUpdate = !LMS.isBlank(data && data.note_id);
      var input = LMS.validateCounselingNoteInput(data, isUpdate);
      requireStudent(input.student_id);
      var rows = table('CounselingNotes');
      var ts = now();
      var row;
      if (isUpdate) {
        row = LMS.findById(rows, 'note_id', input.note_id);
        if (!row) throw new Error('상담일지를 찾을 수 없습니다.');
        row.kind = input.kind;
        row.counsel_date = input.counsel_date;
        row.title = input.title;
        row.content = input.content;
        row.updated_at = ts;
      } else {
        row = {
          note_id: nextIds('NTS', 1)[0],
          student_id: input.student_id,
          kind: input.kind,
          counsel_date: input.counsel_date,
          title: input.title,
          content: input.content,
          follow_up_task_id: '',
          created_at: ts,
          updated_at: ts
        };
        rows.push(row);
      }
      row.follow_up_date = input.follow_up_date;
      row.follow_up_title = input.follow_up_title;
      row.follow_up_task_id = syncFollowUpTask_(row);
      saveTable('CounselingNotes', table('CounselingNotes'));
      return row;
    });
  }

  /**
   * Keep the note's follow-up as a 할 일: create or move it while open, cancel it when the
   * follow-up is cleared. A finished task is left alone. Returns the task id ('' if none).
   */
  function syncFollowUpTask_(note) {
    var tasks = table('Tasks');
    var task = note.follow_up_task_id ? LMS.findById(tasks, 'task_id', note.follow_up_task_id) : null;
    var ts = now();
    if (!note.follow_up_date) {
      if (task && LMS.toStr(task.status) === '예정') {
        task.status = '취소';
        task.updated_at = ts;
        saveTable('Tasks', tasks);
      }
      return '';
    }
    var fields = {
      due_date: note.follow_up_date,
      kind: note.kind === '학부모' ? 'counsel_parent' : 'counsel_student',
      title: note.follow_up_title,
      memo: '상담일지 ' + note.counsel_date + (note.title ? ' · ' + note.title : ''),
      student_id: note.student_id,
      class_id: '',
      source: 'counseling'
    };
    if (task && LMS.toStr(task.status) === '완료') return task.task_id;
    if (task) {
      Object.keys(fields).forEach(function (k) { task[k] = fields[k]; });
      task.status = '예정';
      task.updated_at = ts;
    } else {
      task = Object.assign({ task_id: nextIds(LMS.PREFIX.task, 1)[0], status: '예정', created_at: ts, updated_at: ts }, fields);
      tasks.push(task);
    }
    saveTable('Tasks', tasks);
    return task.task_id;
  }

  function deleteCounselingNote(noteId) {
    return withLock(function () {
      var rows = table('CounselingNotes');
      var prev = LMS.findById(rows, 'note_id', noteId);
      if (!prev) throw new Error('상담일지를 찾을 수 없습니다.');
      var next = rows.filter(function (row) {
        return LMS.toStr(row.note_id) !== LMS.toStr(noteId);
      });
      syncFollowUpTask_({ follow_up_date: '', follow_up_task_id: prev.follow_up_task_id });
      saveTable('CounselingNotes', next);
      return { note_id: prev.note_id, deleted: true };
    });
  }

  function makeupTitle(row, cls, student) {
    if (LMS.toStr(row.title)) return LMS.toStr(row.title);
    if (row.kind === '반') return (cls && cls.class_name ? cls.class_name + ' 보강' : '반 보강');
    return (student && student.name ? student.name + ' 보강' : '개인 보강');
  }

  function getMakeupSession(makeupId) {
    var row = LMS.findById(table('MakeupSessions'), 'makeup_id', makeupId);
    if (!row) throw new Error('보강 일정을 찾을 수 없습니다.');
    return row;
  }

  function makeupRecord(input, studentId, makeupId, ts, prev) {
    return {
      makeup_id: makeupId,
      makeup_date: input.makeup_date,
      start_time: input.start_time,
      end_time: input.end_time,
      kind: input.kind,
      class_id: input.class_id,
      student_id: studentId || '',
      title: input.title,
      memo: input.memo,
      status: input.status,
      created_at: prev && prev.created_at ? prev.created_at : ts,
      updated_at: ts
    };
  }

  function saveMakeupSession(data) {
    return withLock(function () {
      var isUpdate = !LMS.isBlank(data && data.makeup_id);
      var input = LMS.validateMakeupSessionInput(data, isUpdate);
      if (input.class_id) requireClass(input.class_id);
      input.student_ids.forEach(function (id) { requireStudent(id); });
      var rows = table('MakeupSessions');
      var ts = now();
      if (isUpdate) {
        var prev = LMS.findById(rows, 'makeup_id', input.makeup_id);
        if (!prev) throw new Error('보강 일정을 찾을 수 없습니다.');
        var updated = makeupRecord(input, input.student_id, prev.makeup_id, ts, prev);
        Object.keys(updated).forEach(function (k) {
          prev[k] = updated[k];
        });
        saveTable('MakeupSessions', rows);
        return prev;
      }
      if (input.kind === '학생' && input.student_ids.length > 1) {
        var ids = nextIds('MKP', input.student_ids.length);
        var created = input.student_ids.map(function (sid, i) {
          var row = makeupRecord(input, sid, ids[i], ts);
          rows.push(row);
          return row;
        });
        saveTable('MakeupSessions', rows);
        return { sessions: created, created_count: created.length };
      }
      var row = makeupRecord(input, input.student_id, nextIds('MKP', 1)[0], ts);
      rows.push(row);
      saveTable('MakeupSessions', rows);
      return row;
    });
  }

  function updateMakeupSession(data) {
    if (LMS.isBlank(data && data.makeup_id)) {
      throw new Error('보강 일정을 찾을 수 없습니다.');
    }
    return saveMakeupSession(data);
  }

  function cancelMakeupSession(makeupId) {
    var row = getMakeupSession(makeupId);
    return saveMakeupSession(Object.assign({}, row, { status: '취소' }));
  }

  function getCalendar(start, end) {
    if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end)) {
      throw new Error('날짜 형식이 올바르지 않습니다.');
    }
    if (start > end) throw new Error('시작일이 종료일보다 뒤입니다.');
    var classes = table('Classes');
    var students = table('Students');
    var regular = LMS.buildRegularClassEvents(classes, start, end, examPeriods_());
    var makeups = table('MakeupSessions').filter(function (row) {
      if (LMS.toStr(row.status) === '취소') return false;
      return LMS.inRange(row.makeup_date, start, end);
    }).map(function (row) {
      var cls = LMS.findById(classes, 'class_id', row.class_id);
      var student = LMS.findById(students, 'student_id', row.student_id);
      return {
        event_type: row.kind === '반' ? '반보강' : '개인보강',
        date: row.makeup_date,
        start_time: row.start_time,
        end_time: row.end_time,
        class_id: row.class_id,
        class_name: cls ? cls.class_name : '',
        student_id: row.student_id,
        student_name: student ? student.name : '',
        title: makeupTitle(row, cls, student),
        makeup_id: row.makeup_id,
        kind: row.kind,
        status: row.status,
        memo: row.memo
      };
    });
    var events = regular.concat(makeups).sort(function (a, b) {
      var d = LMS.toStr(a.date).localeCompare(LMS.toStr(b.date));
      if (d) return d;
      return LMS.toStr(a.start_time).localeCompare(LMS.toStr(b.start_time));
    });
    return { start: start, end: end, events: events };
  }

  function getSettings() {
    return settings();
  }

  function saveSettings(map) {
    return withLock(function () {
      var current = settings();
      Object.keys(map || {}).forEach(function (k) {
        current[k] = map[k];
      });
      saveTable('Settings', LMS.settingsToRows(current));
      return current;
    });
  }

  function saveSetting(key, value) {
    var obj = {};
    obj[key] = value;
    return saveSettings(obj);
  }

  function rosterStudentIds(classId, date) {
    return rosterOn(classId, date).filter(function (s) {
      return LMS.toStr(s.status) === '재원';
    }).map(function (s) { return s.student_id; });
  }

  function getTodayTeachingTasks(date) {
    date = date || store.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var periods = examPeriods_();
    var classes = table('Classes').filter(function (c) {
      return LMS.classMeetsOnDate(c, date, periods);
    });
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.lesson_date) === date;
    });
    var students = table('Students');
    var regularClasses = classes.map(function (cls) {
      var rosterIds = rosterStudentIds(cls.class_id, date);
      var slot = LMS.classTimeOn(cls, date) || {};
      var recorded = {};
      lessons.forEach(function (l) {
        if (LMS.toStr(l.class_id) !== LMS.toStr(cls.class_id)) return;
        if (rosterIds.indexOf(l.student_id) !== -1) recorded[l.student_id] = true;
      });
      var recordedCount = Object.keys(recorded).length;
      return {
        type: 'regular',
        class_id: cls.class_id,
        class_name: cls.class_name,
        class_type: LMS.toStr(cls.class_type) || '정규',
        start_time: slot.start || '',
        end_time: slot.end || '',
        student_count: rosterIds.length,
        recorded_count: recordedCount,
        incomplete_count: Math.max(0, rosterIds.length - recordedCount),
        complete: rosterIds.length > 0 && recordedCount >= rosterIds.length
      };
    });
    var makeupSessions = table('MakeupSessions').filter(function (row) {
      return LMS.toStr(row.makeup_date) === date && LMS.toStr(row.status) !== '취소';
    }).map(function (row) {
      var cls = LMS.findById(table('Classes'), 'class_id', row.class_id);
      var student = LMS.findById(students, 'student_id', row.student_id);
      return {
        type: 'makeup',
        makeup_id: row.makeup_id,
        kind: row.kind,
        class_id: row.class_id,
        class_name: cls ? cls.class_name : '',
        student_id: row.student_id,
        student_name: student ? student.name : '',
        title: makeupTitle(row, cls, student),
        status: row.status,
        start_time: row.start_time
      };
    });
    return {
      date: date,
      regular_classes: regularClasses,
      makeup_sessions: makeupSessions
    };
  }

  function getLastLessonSnapshot(classId, beforeDate) {
    requireClass(classId);
    beforeDate = beforeDate || store.today();
    if (!LMS.isIsoDate(beforeDate)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var lessons = table('Lessons').filter(function (row) {
      return LMS.toStr(row.class_id) === LMS.toStr(classId) &&
        LMS.toStr(row.lesson_date) < LMS.toStr(beforeDate);
    });
    if (!lessons.length) {
      var cls = requireClass(classId);
      return {
        lesson_date: null,
        progress: LMS.toStr(cls.current_progress),
        homework: LMS.toStr(cls.class_homework),
        student_assignments: {}
      };
    }
    var byDate = {};
    lessons.forEach(function (row) {
      var d = LMS.toStr(row.lesson_date);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(row);
    });
    var latestDate = Object.keys(byDate).sort().pop();
    var dayLessons = byDate[latestDate];
    var sample = dayLessons[0];
    var studentAssignments = {};
    dayLessons.forEach(function (row) {
      if (row.student_id && row.assignment_completion) {
        studentAssignments[row.student_id] = row.assignment_completion;
      }
    });
    return {
      lesson_date: latestDate,
      progress: LMS.toStr(sample.progress),
      homework: LMS.toStr(sample.homework),
      student_assignments: studentAssignments
    };
  }

  function getStudentLearningContext(studentId) {
    var student = requireStudent(studentId);
    var end = store.today();
    var start = LMS.addDays(end, -28);
    var lessons = getStudentLessons(studentId, start, end);
    return {
      student_id: student.student_id,
      student_name: student.name,
      period: { start: start, end: end },
      summary: LMS.summarizeRecentLearning(lessons),
      signals: LMS.detectLearningSignals(lessons)
    };
  }

  function getLearningAlerts(limit) {
    limit = limit || 8;
    var end = store.today();
    var start = LMS.addDays(end, -60);
    var alerts = [];
    table('Students').forEach(function (student) {
      if (LMS.toStr(student.status) !== '재원') return;
      var lessons = table('Lessons').filter(function (row) {
        return LMS.toStr(row.student_id) === LMS.toStr(student.student_id) &&
          LMS.inRange(row.lesson_date, start, end);
      });
      var signals = LMS.detectLearningSignals(lessons);
      if (!signals.length) return;
      alerts.push({
        student_id: student.student_id,
        student_name: student.name,
        grade: student.grade,
        signals: signals
      });
    });
    alerts.sort(function (a, b) {
      return LMS.toStr(a.student_name).localeCompare(LMS.toStr(b.student_name), 'ko');
    });
    return alerts.slice(0, limit);
  }

  function agendaIncompleteRank(status) {
    return LMS.toStr(status) === '완료' ? 1 : 0;
  }

  function sortAgendaItems(items) {
    return (items || []).slice().sort(function (a, b) {
      var ra = agendaIncompleteRank(a.status);
      var rb = agendaIncompleteRank(b.status);
      if (ra !== rb) return ra - rb;
      var ka = LMS.toStr(a.kind).localeCompare(LMS.toStr(b.kind));
      if (ka) return ka;
      return LMS.toStr(a.title).localeCompare(LMS.toStr(b.title), 'ko');
    });
  }

  function getDayAgenda(date) {
    date = date || store.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var items = [];
    var teaching = getTodayTeachingTasks(date);
    var students = table('Students');
    var classes = table('Classes');

    (teaching.regular_classes || []).forEach(function (cls) {
      if (cls.complete) return;
      if (!cls.student_count) return;
      items.push({
        id: 'auto:class:' + cls.class_id,
        source: 'auto',
        kind: 'incomplete_class',
        title: (cls.class_name || '반') + ' 수업 기록',
        status: '예정',
        student_id: '',
        class_id: cls.class_id,
        class_name: cls.class_name || '',
        start_time: cls.start_time || '',
        incomplete_count: cls.incomplete_count || 0,
        student_count: cls.student_count || 0,
        recorded_count: cls.recorded_count || 0,
        action: 'open_today_session'
      });
    });

    (teaching.makeup_sessions || []).forEach(function (row) {
      items.push({
        id: 'auto:makeup:' + row.makeup_id,
        source: 'auto',
        kind: 'makeup',
        title: row.title || '보강',
        status: LMS.toStr(row.status) || '예정',
        student_id: row.student_id || '',
        student_name: row.student_name || '',
        class_id: row.class_id || '',
        class_name: row.class_name || '',
        makeup_id: row.makeup_id,
        start_time: row.start_time || '',
        action: 'open_makeup'
      });
    });

    if (date === store.today()) {
      getLearningAlerts(8).forEach(function (alert) {
        var labels = (alert.signals || []).map(function (s) { return s.label; }).filter(Boolean);
        items.push({
          id: 'auto:alert:' + alert.student_id,
          source: 'auto',
          kind: 'learning_alert',
          title: (alert.student_name || '학생') + ' 학습 점검',
          status: '예정',
          student_id: alert.student_id,
          student_name: alert.student_name || '',
          class_id: '',
          memo: labels.join(' · '),
          signals: alert.signals || [],
          action: 'open_student'
        });
      });
    }

    (teaching.regular_classes || []).forEach(function (cls) {
      var classRow = LMS.findById(classes, 'class_id', cls.class_id) || cls;
      var assignedDate = LMS.previousMeetingDateFor(classRow, date, examPeriods_());
      if (!assignedDate) return;
      var hw = getSessionHomework(assignedDate, cls.class_id);
      if (!(hw.items || []).length) return;
      var preview = LMS.toStr(hw.items[0].title);
      if (preview.length > 40) preview = preview.slice(0, 40) + '…';
      items.push({
        id: 'auto:hw:' + cls.class_id,
        source: 'auto',
        kind: 'homework_check',
        title: (cls.class_name || '반') + ' 과제 확인',
        status: '예정',
        student_id: '',
        class_id: cls.class_id,
        class_name: cls.class_name || '',
        homework_preview: preview,
        prior_lesson_date: assignedDate,
        item_count: hw.items.length,
        action: 'check_homework'
      });
    });

    table('Tasks').forEach(function (row) {
      if (LMS.toStr(row.due_date) !== date) return;
      if (LMS.toStr(row.status) === '취소') return;
      var student = LMS.findById(students, 'student_id', row.student_id);
      var cls = LMS.findById(classes, 'class_id', row.class_id);
      items.push({
        id: row.task_id,
        source: 'manual',
        kind: row.kind,
        title: row.title,
        status: row.status,
        student_id: row.student_id || '',
        student_name: student ? student.name : '',
        class_id: row.class_id || '',
        class_name: cls ? cls.class_name : '',
        memo: row.memo || '',
        task_id: row.task_id,
        action: 'edit_task'
      });
    });

    return {
      date: date,
      items: sortAgendaItems(items)
    };
  }

  function saveTask(data) {
    return withLock(function () {
      var isUpdate = !LMS.isBlank(data && data.task_id);
      var input = LMS.validateTaskInput(data, isUpdate);
      if (input.student_id) requireStudent(input.student_id);
      if (input.class_id) requireClass(input.class_id);
      var rows = table('Tasks');
      var ts = now();
      if (isUpdate) {
        var prev = LMS.findById(rows, 'task_id', input.task_id);
        if (!prev) throw new Error('할 일을 찾을 수 없습니다.');
        prev.due_date = input.due_date;
        prev.kind = input.kind;
        prev.title = input.title;
        prev.memo = input.memo;
        prev.student_id = input.student_id;
        prev.class_id = input.class_id;
        prev.status = input.status;
        prev.source = 'manual';
        prev.updated_at = ts;
        saveTable('Tasks', rows);
        return prev;
      }
      var row = {
        task_id: nextIds(LMS.PREFIX.task, 1)[0],
        due_date: input.due_date,
        kind: input.kind,
        title: input.title,
        memo: input.memo,
        student_id: input.student_id,
        class_id: input.class_id,
        status: input.status,
        source: 'manual',
        created_at: ts,
        updated_at: ts
      };
      rows.push(row);
      saveTable('Tasks', rows);
      return row;
    });
  }

  function updateTaskStatus(taskId, status) {
    return withLock(function () {
      var rows = table('Tasks');
      var prev = LMS.findById(rows, 'task_id', taskId);
      if (!prev) throw new Error('할 일을 찾을 수 없습니다.');
      var nextStatus = LMS.assertEnum(status, LMS.TASK_STATUS, '할 일 상태');
      prev.status = nextStatus;
      prev.updated_at = now();
      saveTable('Tasks', rows);
      return prev;
    });
  }

  function listCounselingNotes(filter) {
    filter = filter || {};
    var start = LMS.toStr(filter.start);
    var end = LMS.toStr(filter.end);
    var kind = LMS.toStr(filter.kind);
    var query = LMS.toStr(filter.query).toLowerCase();
    var studentId = LMS.toStr(filter.student_id);
    if (start && !LMS.isIsoDate(start)) throw new Error('시작일 형식이 올바르지 않습니다.');
    if (end && !LMS.isIsoDate(end)) throw new Error('종료일 형식이 올바르지 않습니다.');
    if (kind) LMS.assertEnum(kind, LMS.COUNSEL_KIND, '상담 종류');
    if (studentId) requireStudent(studentId);
    var students = table('Students');
    return table('CounselingNotes').filter(function (row) {
      if (studentId && LMS.toStr(row.student_id) !== studentId) return false;
      if (kind && LMS.toStr(row.kind) !== kind) return false;
      if (!LMS.inRange(row.counsel_date, start || '', end || '')) return false;
      if (query) {
        var student = LMS.findById(students, 'student_id', row.student_id);
        var hay = [
          row.title, row.content, row.kind,
          student ? student.name : '', student ? student.grade : ''
        ].join(' ').toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    }).map(function (row) {
      var student = LMS.findById(students, 'student_id', row.student_id);
      return Object.assign({}, row, {
        student_name: student ? student.name : '',
        grade: student ? student.grade : ''
      });
    }).sort(function (a, b) {
      var d = LMS.toStr(b.counsel_date).localeCompare(LMS.toStr(a.counsel_date));
      if (d) return d;
      return LMS.toStr(b.updated_at).localeCompare(LMS.toStr(a.updated_at));
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

  function getDashboard(date) {
    date = date || store.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var periods = examPeriods_();
    var classes = table('Classes').filter(function (c) {
      return LMS.classMeetsOnDate(c, date, periods);
    });
    var students = table('Students');
    var studentIds = {};
    classes.forEach(function (cls) {
      rosterStudentIds(cls.class_id, date).forEach(function (id) { studentIds[id] = true; });
    });
    var expected = Object.keys(studentIds);
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.lesson_date) === date;
    });
    var recordedIds = {};
    lessons.forEach(function (l) {
      if (studentIds[l.student_id]) recordedIds[l.student_id] = true;
    });
    var recordedCount = Object.keys(recordedIds).length;
    var allStudents = students;
    return {
      date: date,
      date_label: LMS.formatKoreanDate(date),
      today_class_count: classes.length,
      today_student_count: expected.length,
      recorded_count: recordedCount,
      incomplete_count: Math.max(0, expected.length - recordedCount),
      report_ready_count: recordedCount,
      enrolled_count: allStudents.filter(function (s) { return s.status === '재원'; }).length,
      paused_count: allStudents.filter(function (s) { return s.status === '휴원'; }).length,
      archived_count: allStudents.filter(function (s) { return s.status === '퇴원'; }).length,
      classes: classes,
      teaching_tasks: getTodayTeachingTasks(date),
      learning_alerts: getLearningAlerts(8),
      agenda: getDayAgenda(date),
      weekly_homework: getWeeklyHomeworkDashboard(date)
    };
  }

  function getClassStats(classId, year, month) {
    requireClass(classId);
    var range = LMS.monthRange(year, month);
    var lessons = table('Lessons').filter(function (row) {
      return LMS.toStr(row.class_id) === LMS.toStr(classId) &&
        LMS.inRange(row.lesson_date, range.start, range.end);
    });
    // Everyone recorded in the month plus today's roster (temporary classes have no '현재' rows).
    var allStudents = table('Students');
    var roster = rosterOn(classId, store.today());
    lessons.forEach(function (l) {
      if (roster.some(function (s) { return s.student_id === l.student_id; })) return;
      var st = LMS.findById(allStudents, 'student_id', l.student_id);
      if (st) roster.push(st);
    });
    roster.sort(function (a, b) { return LMS.toStr(a.name).localeCompare(LMS.toStr(b.name), 'ko'); });
    var students = roster.map(function (s) {
      var stats = LMS.computeMonthlyStats(lessons, s.student_id, year, month);
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

  // ----- Exam-prep periods and temporary classes -----

  function requirePeriod_(id) {
    var row = LMS.findById(table('ExamPeriods'), 'exam_period_id', id);
    if (!row) throw new Error('시험대비 기간을 찾을 수 없습니다.');
    return row;
  }

  function periodClassIds_(periodId) {
    return table('Classes').filter(function (c) {
      return LMS.toStr(c.exam_period_id) === LMS.toStr(periodId) && LMS.toStr(c.class_type) === '시험대비';
    }).map(function (c) { return LMS.toStr(c.class_id); });
  }

  function periodTempRels_(periodId) {
    var ids = periodClassIds_(periodId);
    return table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.status) === '임시' && ids.indexOf(LMS.toStr(r.class_id)) !== -1;
    });
  }

  /** Regular class ids a student attends at some point within [start, end]. */
  function regularClassIdsOf_(studentId, start, end) {
    var classes = table('Classes');
    return table('StudentClasses').filter(function (r) {
      if (LMS.toStr(r.student_id) !== LMS.toStr(studentId) || LMS.toStr(r.status) === '임시') return false;
      if (LMS.toStr(r.status) === '종료' && !r.end_date) return false;
      var c = LMS.findById(classes, 'class_id', r.class_id);
      if (!c || LMS.toStr(c.class_type) === '시험대비') return false;
      return LMS.rangesOverlap(r.start_date, r.end_date, start, end);
    }).map(function (r) { return LMS.toStr(r.class_id); });
  }

  /**
   * Batch start, individual return: each suspended class stays off until its first moved
   * student is back, then meets with whoever has returned (students still away are left
   * off its roster by rosterOn). Last suspended day = earliest end among its moved students'
   * temporary assignments. No moved students → period end.
   */
  function recomputeResumeDates_(periodId) {
    var periods = table('ExamPeriods');
    var period = LMS.findById(periods, 'exam_period_id', periodId);
    if (!period) return;
    var temp = periodTempRels_(periodId);
    var map = {};
    LMS.suspendedClassIds(period).forEach(function (classId) {
      var last = '';
      temp.forEach(function (r) {
        var sources = regularClassIdsOf_(r.student_id, period.start_date, period.end_date);
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

  function assertNoTempOverlap_(studentId, start, end, ignoreRelId) {
    var students = table('Students');
    var clash = table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.status) === '임시' && LMS.toStr(r.student_id) === LMS.toStr(studentId) &&
        LMS.toStr(r.id) !== LMS.toStr(ignoreRelId) && LMS.rangesOverlap(r.start_date, r.end_date, start, end);
    })[0];
    if (clash) {
      var s = LMS.findById(students, 'student_id', studentId);
      throw new Error((s ? s.name : studentId) + ' 학생은 그 기간에 이미 다른 시험대비 반에 배정되어 있습니다.');
    }
  }

  function saveExamPeriod(data) {
    return withLock(function () {
      var input = LMS.validateExamPeriodInput(data);
      var rows = table('ExamPeriods');
      var ts = now();
      var row;
      if (input.exam_period_id) {
        row = requirePeriod_(input.exam_period_id);
        Object.keys(input).forEach(function (k) { if (k !== 'exam_period_id') row[k] = input[k]; });
        row.updated_at = ts;
        saveTable('ExamPeriods', rows);
        // Keep temporary assignments inside the new dates.
        var rels = table('StudentClasses');
        var ids = periodClassIds_(row.exam_period_id);
        var changed = false;
        rels.forEach(function (r) {
          if (LMS.toStr(r.status) !== '임시' || ids.indexOf(LMS.toStr(r.class_id)) === -1) return;
          if (!r.start_date || r.start_date < row.start_date) { r.start_date = row.start_date; changed = true; }
          if (!r.end_date || r.end_date > row.end_date) { r.end_date = row.end_date; changed = true; }
          if (r.end_date < r.start_date) { r.end_date = r.start_date; changed = true; }
        });
        if (changed) saveTable('StudentClasses', rels);
        recomputeResumeDates_(row.exam_period_id);
      } else {
        row = Object.assign({}, input, {
          exam_period_id: nextIds('EXP', 1)[0],
          suspended_class_ids: [],
          class_resume_dates: {},
          status: '준비',
          created_at: ts,
          updated_at: ts
        });
        rows.push(row);
        saveTable('ExamPeriods', rows);
      }
      return LMS.findById(table('ExamPeriods'), 'exam_period_id', row.exam_period_id);
    });
  }

  /**
   * Create temporary classes and assignments in one go.
   * plan: { groups: [{ class_name, schedule, target_school, target_grade, teacher, start_date, end_date,
   *          students: [{ student_id, source_class_id, start_date?, end_date? }] }], suspended_class_ids: [] }
   */
  function applyExamGroups(periodId, plan) {
    return withLock(function () {
      var period = requirePeriod_(periodId);
      plan = plan || {};
      var groups = (plan.groups || []).filter(function (g) { return (g.students || []).length; });
      if (!groups.length && !Array.isArray(plan.suspended_class_ids)) throw new Error('편성할 학생이 없습니다.');
      var seen = {};
      var prepared = groups.map(function (g) {
        var name = LMS.toStr(g.class_name);
        if (!name) throw new Error('시험대비 반 이름을 입력해 주세요.');
        var schedule = LMS.normalizeSchedule(g.schedule);
        if (!schedule.length) throw new Error(name + ': 수업 요일과 시간을 입력해 주세요.');
        schedule.forEach(function (sl) {
          if (!sl.start || !sl.end) throw new Error(name + ': ' + sl.day + '요일 시간을 입력해 주세요.');
        });
        var gStart = LMS.toStr(g.start_date) || period.start_date;
        var gEnd = LMS.toStr(g.end_date) || period.end_date;
        var students = g.students.map(function (st) {
          var sid = LMS.toStr(st.student_id);
          requireStudent(sid);
          if (seen[sid]) throw new Error('같은 학생이 두 반에 들어 있습니다.');
          seen[sid] = true;
          var start = LMS.toStr(st.start_date) || gStart;
          var end = LMS.toStr(st.end_date) || gEnd;
          if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end) || end < start) throw new Error(name + ': 날짜를 확인해 주세요.');
          if (start < period.start_date || end > period.end_date) throw new Error(name + ': 날짜는 시험대비 기간 안이어야 합니다.');
          assertNoTempOverlap_(sid, start, end);
          return { student_id: sid, source_class_id: LMS.toStr(st.source_class_id) || regularClassIdsOf_(sid, start, end)[0] || '', start_date: start, end_date: end };
        });
        return { name: name, schedule: schedule, group: g, students: students };
      });

      var created = prepared.map(function (pg) {
        var input = LMS.validateClassInput({
          class_name: pg.name,
          grade: LMS.toStr(pg.group.target_grade),
          teacher: LMS.toStr(pg.group.teacher),
          school_year: LMS.toStr(period.exam_year) || period.start_date.slice(0, 4),
          semester: LMS.toStr(period.exam_semester),
          schedule: pg.schedule,
          class_type: '시험대비',
          exam_period_id: period.exam_period_id,
          target_school: LMS.toStr(pg.group.target_school),
          target_grade: LMS.toStr(pg.group.target_grade),
          status: '운영'
        }, false);
        delete input.schedule_from_legacy;
        var ts = now();
        var cls = Object.assign({}, input, { class_id: nextIds('CLS', 1)[0], created_at: ts, updated_at: ts });
        var classes = table('Classes');
        classes.push(cls);
        saveTable('Classes', classes);
        var rels = table('StudentClasses');
        var ids = nextIds('REL', pg.students.length);
        pg.students.forEach(function (st, i) {
          rels.push({
            id: ids[i], student_id: st.student_id, class_id: cls.class_id,
            start_date: st.start_date, end_date: st.end_date, status: '임시',
            assignment_type: '임시', source_class_id: st.source_class_id, created_at: ts, updated_at: ts
          });
        });
        saveTable('StudentClasses', rels);
        return cls;
      });

      var periods = table('ExamPeriods');
      var row = LMS.findById(periods, 'exam_period_id', periodId);
      if (Array.isArray(plan.suspended_class_ids)) {
        row.suspended_class_ids = LMS.uniqueIds(plan.suspended_class_ids.map(LMS.toStr));
      }
      if (LMS.toStr(row.status) === '준비') row.status = '진행';
      saveTable('ExamPeriods', periods);
      recomputeResumeDates_(periodId);
      return { classes: created, period: LMS.findById(table('ExamPeriods'), 'exam_period_id', periodId) };
    });
  }

  function tempRel_(relId) {
    var rels = table('StudentClasses');
    var rel = LMS.findById(rels, 'id', relId);
    if (!rel || LMS.toStr(rel.status) !== '임시') throw new Error('시험대비 배정을 찾을 수 없습니다.');
    var cls = requireClass(rel.class_id);
    return { rels: rels, rel: rel, cls: cls, period: requirePeriod_(cls.exam_period_id) };
  }

  function addTempAssignment(data) {
    return withLock(function () {
      var cls = requireClass(data.class_id);
      if (LMS.toStr(cls.class_type) !== '시험대비') throw new Error('시험대비 반이 아닙니다.');
      var period = requirePeriod_(cls.exam_period_id);
      var sid = LMS.toStr(data.student_id);
      requireStudent(sid);
      var start = LMS.toStr(data.start_date) || period.start_date;
      var end = LMS.toStr(data.end_date) || period.end_date;
      if (start < period.start_date || end > period.end_date || end < start) throw new Error('날짜는 시험대비 기간 안이어야 합니다.');
      assertNoTempOverlap_(sid, start, end);
      var rels = table('StudentClasses');
      var ts = now();
      var row = {
        id: nextIds('REL', 1)[0], student_id: sid, class_id: cls.class_id, start_date: start, end_date: end,
        status: '임시', assignment_type: '임시',
        source_class_id: LMS.toStr(data.source_class_id) || regularClassIdsOf_(sid, start, end)[0] || '',
        created_at: ts, updated_at: ts
      };
      rels.push(row);
      saveTable('StudentClasses', rels);
      recomputeResumeDates_(period.exam_period_id);
      return row;
    });
  }

  /** Early return: the temporary assignment ends on `date` (last day in the exam class). */
  function endTempAssignment(relId, date) {
    return withLock(function () {
      var t = tempRel_(relId);
      var d = LMS.toStr(date);
      if (!LMS.isIsoDate(d)) throw new Error('마지막 수업일을 입력해 주세요.');
      if (d < LMS.toStr(t.rel.start_date)) throw new Error('마지막 수업일이 시작일보다 빠릅니다. 배정을 빼려면 ‘제외’를 쓰세요.');
      if (d > t.period.end_date) throw new Error('마지막 수업일은 시험대비 기간 안이어야 합니다.');
      t.rel.end_date = d;
      t.rel.updated_at = now();
      saveTable('StudentClasses', t.rels);
      recomputeResumeDates_(t.period.exam_period_id);
      return t.rel;
    });
  }

  function removeTempAssignment(relId) {
    return withLock(function () {
      var t = tempRel_(relId);
      var hasLessons = table('Lessons').some(function (l) {
        return LMS.toStr(l.class_id) === LMS.toStr(t.rel.class_id) && LMS.toStr(l.student_id) === LMS.toStr(t.rel.student_id);
      });
      if (hasLessons) throw new Error('이미 이 반 수업 기록이 있어 뺄 수 없습니다. ‘조기 복귀’로 마지막 수업일을 정하세요.');
      saveTable('StudentClasses', t.rels.filter(function (r) { return r !== t.rel; }));
      recomputeResumeDates_(t.period.exam_period_id);
      return true;
    });
  }

  function setPeriodSuspendedClasses(periodId, classIds) {
    return withLock(function () {
      var periods = table('ExamPeriods');
      var row = requirePeriod_(periodId);
      row.suspended_class_ids = LMS.uniqueIds((classIds || []).map(LMS.toStr));
      saveTable('ExamPeriods', periods);
      recomputeResumeDates_(periodId);
      return LMS.findById(table('ExamPeriods'), 'exam_period_id', periodId);
    });
  }

  function closeExamPeriod(periodId) {
    return withLock(function () {
      var periods = table('ExamPeriods');
      var row = requirePeriod_(periodId);
      row.status = '종료';
      row.updated_at = now();
      saveTable('ExamPeriods', periods);
      var ids = periodClassIds_(periodId);
      var classes = table('Classes');
      classes.forEach(function (c) { if (ids.indexOf(LMS.toStr(c.class_id)) !== -1) c.status = '종료'; });
      saveTable('Classes', classes);
      return row;
    });
  }

  /** Delete a period that has no lessons yet, with its temporary classes and assignments. */
  function deleteExamPeriod(periodId) {
    return withLock(function () {
      requirePeriod_(periodId);
      var ids = periodClassIds_(periodId);
      var used = table('Lessons').some(function (l) { return ids.indexOf(LMS.toStr(l.class_id)) !== -1; });
      if (used) throw new Error('수업 기록이 있는 시험대비 기간은 삭제할 수 없습니다. ‘기간 마감’을 쓰세요.');
      var inIds = function (r) { return ids.indexOf(LMS.toStr(r.class_id)) === -1; };
      saveTable('StudentClasses', table('StudentClasses').filter(inIds));
      saveTable('Classes', table('Classes').filter(inIds));
      saveTable('ClassSessions', table('ClassSessions').filter(inIds));
      var items = table('HomeworkItems');
      var dropItems = items.filter(function (r) { return !inIds(r); }).map(function (r) { return LMS.toStr(r.item_id); });
      saveTable('HomeworkItems', items.filter(inIds));
      saveTable('HomeworkChecks', table('HomeworkChecks').filter(function (c) { return dropItems.indexOf(LMS.toStr(c.item_id)) === -1; }));
      saveTable('ClassPlans', table('ClassPlans').filter(inIds));
      saveTable('PlanDrafts', table('PlanDrafts').filter(inIds));
      saveTable('ExamPeriods', table('ExamPeriods').filter(function (r) { return LMS.toStr(r.exam_period_id) !== LMS.toStr(periodId); }));
      return true;
    });
  }

  // ----- School exam schedule (math only) -----

  function saveSchoolExam(data) {
    return withLock(function () {
      var input = LMS.validateSchoolExamInput(data);
      var rows = table('SchoolExams');
      var key = LMS.schoolExamKey(input);
      var ts = now();
      var row = input.school_exam_id ? LMS.findById(rows, 'school_exam_id', input.school_exam_id) : null;
      if (input.school_exam_id && !row) throw new Error('시험 일정을 찾을 수 없습니다.');
      var clash = rows.filter(function (r) {
        return LMS.schoolExamKey(r) === key && r !== row;
      })[0];
      if (row && clash) throw new Error('같은 학교·학년의 같은 시험이 이미 있습니다.');
      if (!row) row = clash || null;
      if (row) {
        Object.keys(input).forEach(function (k) {
          if (k !== 'school_exam_id') row[k] = input[k];
        });
        row.updated_at = ts;
      } else {
        row = Object.assign({}, input, {
          school_exam_id: nextIds('SCX', 1)[0],
          created_at: ts,
          updated_at: ts
        });
        rows.push(row);
      }
      saveTable('SchoolExams', rows);
      return row;
    });
  }

  function saveSchoolExamsBatch(list) {
    return withLock(function () {
      return (list || []).map(function (item) { return saveSchoolExam(item); });
    });
  }

  function deleteSchoolExam(id) {
    return withLock(function () {
      var rows = table('SchoolExams');
      var next = rows.filter(function (r) { return LMS.toStr(r.school_exam_id) !== LMS.toStr(id); });
      if (next.length === rows.length) throw new Error('시험 일정을 찾을 수 없습니다.');
      saveTable('SchoolExams', next);
      return true;
    });
  }

  // ----- Schema migrations (lms.kv JSON; idempotent, versioned in _Meta) -----

  function schemaVersion_() {
    var row = LMS.findById(table('_Meta'), 'prefix', LMS.SCHEMA_META_KEY);
    var v = row ? parseInt(row.next_seq, 10) : 1;
    return isFinite(v) ? v : 1;
  }

  function migrateToV2_() {
    var ts = now();
    var classes = table('Classes');
    classes.forEach(function (cls) {
      if (!Array.isArray(cls.schedule)) {
        var legacy = LMS.scheduleFromLegacy(cls.weekday, cls.start_time, cls.end_time);
        try {
          cls.schedule = LMS.normalizeSchedule(legacy);
        } catch (e) {
          cls.schedule = legacy;
        }
        var summary = LMS.scheduleSummary(cls.schedule);
        cls.start_time = summary.start_time || LMS.toStr(cls.start_time);
        cls.end_time = summary.end_time || LMS.toStr(cls.end_time);
      }
      if (!LMS.toStr(cls.class_type)) cls.class_type = '정규';
      ['exam_period_id', 'target_school', 'target_grade'].forEach(function (k) {
        if (cls[k] === undefined || cls[k] === null) cls[k] = '';
      });
    });
    saveTable('Classes', classes);

    var rels = table('StudentClasses');
    rels.forEach(function (r) {
      if (!LMS.toStr(r.assignment_type)) r.assignment_type = '정규';
      if (r.source_class_id === undefined || r.source_class_id === null) r.source_class_id = '';
    });
    saveTable('StudentClasses', rels);

    var makeups = table('MakeupSessions');
    makeups.forEach(function (m) {
      ['start_time', 'end_time'].forEach(function (k) {
        var t = LMS.normalizeTime(m[k]);
        if (t) m[k] = t;
      });
    });
    saveTable('MakeupSessions', makeups);

    var groups = {};
    table('Lessons').forEach(function (row) {
      var key = LMS.sessionKey(row.lesson_date, row.class_id);
      if (!groups[key]) groups[key] = { date: row.lesson_date, classId: row.class_id, rows: [] };
      groups[key].rows.push(row);
    });
    var notices = table('ClassSessionNotices');
    notices.forEach(function (n) {
      var key = LMS.sessionKey(n.lesson_date, n.class_id);
      if (!groups[key]) groups[key] = { date: n.lesson_date, classId: n.class_id, rows: [] };
      groups[key].notice = LMS.toStr(n.class_notice);
    });
    var sessions = table('ClassSessions');
    var existing = {};
    sessions.forEach(function (r) { existing[LMS.sessionKey(r.lesson_date, r.class_id)] = true; });
    var missing = Object.keys(groups).filter(function (k) { return !existing[k]; }).sort();
    var ids = missing.length ? nextIds('SES', missing.length) : [];
    missing.forEach(function (key, i) {
      var g = groups[key];
      var tested = g.rows.filter(function (r) { return LMS.toStr(r.test_status) === '실시'; });
      var max = LMS.modeValue(tested.map(function (r) { return LMS.toStr(r.test_max_score); }));
      sessions.push({
        session_id: ids[i],
        lesson_date: LMS.toStr(g.date),
        class_id: LMS.toStr(g.classId),
        progress: LMS.modeValue(g.rows.map(function (r) { return LMS.toStr(r.progress); })),
        content: '',
        test_title: '',
        test_max_score: max ? LMS.toNum(max) : '',
        test_difficulty: LMS.modeValue(tested.map(function (r) { return LMS.toStr(r.test_difficulty); })),
        class_notice: g.notice || '',
        memo: '',
        created_at: ts,
        updated_at: ts
      });
    });
    saveTable('ClassSessions', sessions);
  }

  /** v3: plans written before AI planning are the teacher's own. Safe to re-run. */
  function migrateToV3_() {
    var plans = table('ClassPlans');
    var changed = false;
    plans.forEach(function (p) {
      if (!LMS.toStr(p.source)) {
        p.source = 'manual';
        changed = true;
      }
      if (!Array.isArray(p.unit_ids)) {
        p.unit_ids = LMS.jsonList(p.unit_ids);
        changed = true;
      }
    });
    if (changed) saveTable('ClassPlans', plans);
  }

  /**
   * v4: re-align copies that drifted before saves kept them in sync. Safe to re-run.
   * - Student lessons take their date's class record (progress, difficulty on tested rows, checklist homework).
   * - Withdrawn students and closed classes no longer keep an open (현재) assignment.
   * - Exam-prep placements point at a regular class the student actually attended in that range.
   */
  function migrateToV4_() {
    var keys = {};
    table('ClassSessions').concat(table('HomeworkItems')).forEach(function (r) {
      keys[LMS.sessionKey(r.lesson_date, r.class_id)] = { date: LMS.toStr(r.lesson_date), classId: LMS.toStr(r.class_id) };
    });
    Object.keys(keys).sort().forEach(function (k) {
      applySessionToLessons_(keys[k].date, keys[k].classId, { legacyHomework: false, testedOnly: true, keepMax: true });
    });

    var students = table('Students');
    var classes = table('Classes');
    var rels = table('StudentClasses');
    var relsChanged = false;
    rels.forEach(function (r) {
      if (LMS.toStr(r.status) !== '현재') return;
      var st = LMS.findById(students, 'student_id', r.student_id);
      var cls = LMS.findById(classes, 'class_id', r.class_id);
      var gone = st && LMS.toStr(st.status) === '퇴원';
      var closed = cls && LMS.toStr(cls.status) === '종료' && LMS.toStr(cls.class_type) !== '시험대비';
      if (!gone && !closed) return;
      // Best guess for the last day: the last lesson there, else when the student / class row last changed.
      var changedOn = LMS.toStr((gone ? st : cls).updated_at).slice(0, 10);
      endRelForClosing_(r, lastLessonIn_(r.student_id, r.class_id) || (LMS.isIsoDate(changedOn) ? changedOn : LMS.toStr(r.start_date)));
      relsChanged = true;
    });
    var touched = {};
    rels.forEach(function (r) {
      if (LMS.toStr(r.status) !== '임시') return;
      var sources = regularClassIdsOf_(r.student_id, r.start_date, r.end_date);
      if (!sources.length || sources.indexOf(LMS.toStr(r.source_class_id)) !== -1) return;
      r.source_class_id = sources[0];
      r.updated_at = now();
      relsChanged = true;
      var cls = LMS.findById(classes, 'class_id', r.class_id);
      if (cls && cls.exam_period_id) touched[LMS.toStr(cls.exam_period_id)] = true;
    });
    if (relsChanged) saveTable('StudentClasses', rels);
    Object.keys(touched).forEach(recomputeResumeDates_);
  }

  /** Bring stored tables up to LMS.SCHEMA_VERSION. Returns true when anything ran. */
  function ensureSchema() {
    var version = schemaVersion_();
    if (version >= LMS.SCHEMA_VERSION) return false;
    return withLock(function () {
      if (schemaVersion_() < 2) migrateToV2_();
      if (schemaVersion_() < 3) migrateToV3_();
      if (schemaVersion_() < 4) migrateToV4_();
      var meta = table('_Meta');
      var row = LMS.findById(meta, 'prefix', LMS.SCHEMA_META_KEY);
      if (!row) {
        row = { prefix: LMS.SCHEMA_META_KEY, next_seq: LMS.SCHEMA_VERSION };
        meta.push(row);
      }
      row.next_seq = LMS.SCHEMA_VERSION;
      saveTable('_Meta', meta);
      return true;
    });
  }

  /** Light payload for the app shell: settings, today, and the global search index. */
  function getShellBootstrap() {
    var classes = table('Classes');
    var rels = table('StudentClasses');
    var today = store.today();
    return {
      settings: settings(),
      grades: LMS.GRADE_OPTIONS,
      today: today,
      search: {
        students: table('Students').map(function (s) {
          var mine = rels.filter(function (r) {
            return LMS.toStr(r.student_id) === LMS.toStr(s.student_id) && LMS.relActiveOn(r, today);
          });
          var classNames = mine.map(function (r) {
            var cls = LMS.findById(classes, 'class_id', r.class_id);
            return cls ? cls.class_name : '';
          }).filter(Boolean);
          var digits = function (v) { return LMS.toStr(v).replace(/\D/g, ''); };
          return {
            id: s.student_id,
            name: LMS.toStr(s.name),
            grade: LMS.toStr(s.grade),
            school: LMS.toStr(s.school),
            status: LMS.toStr(s.status),
            phones: [digits(s.student_phone).slice(-4), digits(s.parent_phone).slice(-4)].filter(Boolean),
            classes: classNames,
            // Regular classes only, for "어느 반에서 옮길지" in the assign dialog.
            class_ids: mine.filter(function (r) { return LMS.toStr(r.status) === '현재'; }).map(function (r) { return LMS.toStr(r.class_id); })
          };
        }),
        classes: classes.map(function (c) {
          return {
            id: c.class_id,
            name: LMS.toStr(c.class_name),
            grade: LMS.toStr(c.grade),
            status: LMS.toStr(c.status),
            class_type: LMS.toStr(c.class_type) || '정규',
            schedule_label: LMS.scheduleLabel(LMS.classSchedule(c))
          };
        })
      }
    };
  }

  function getLookups() {
    return {
      classes: getClasses({}),
      students: getStudents({})
    };
  }

  function getBootstrap() {
    var today = store.today();
    return {
      settings: settings(),
      grades: LMS.GRADE_OPTIONS,
      today: today,
      user_email: store.currentUserEmail ? store.currentUserEmail() : '',
      classes: getClasses({}),
      students: getStudents({}),
      dashboard: getDashboard(today)
    };
  }

  var views = LMS.createViews ? LMS.createViews({
    table: table,
    store: store,
    requireClass: requireClass,
    requireStudent: requireStudent,
    rosterOn: rosterOn,
    examPeriods: examPeriods_,
    getClassSession: getClassSession,
    getClassPlan: getClassPlan,
    getClassPlans: getClassPlans,
    getTodayTeachingTasks: getTodayTeachingTasks,
    getDayAgenda: getDayAgenda,
    getWeeklyHomeworkDashboard: getWeeklyHomeworkDashboard,
    regularClassIdsOf: regularClassIdsOf_,
    relRemovable: relRemovable_,
    generateDailyReports: generateDailyReports,
    // The planner is built just below; views call this only at request time.
    currentUnit: function (classId) { return planner.getCurrentUnit ? planner.getCurrentUnit(classId) : null; }
  }) : {};

  var planner = LMS.createPlanner ? LMS.createPlanner({
    table: table,
    saveTable: saveTable,
    store: store,
    now: now,
    withLock: withLock,
    nextIds: nextIds,
    requireClass: requireClass,
    rosterOn: rosterOn,
    examPeriods: examPeriods_,
    saveTask: saveTask
  }) : {};

  return Object.assign({
    getStudents: getStudents,
    getStudent: getStudent,
    createStudent: createStudent,
    updateStudent: updateStudent,
    archiveStudent: archiveStudent,
    previewGradePromotion: previewGradePromotion,
    promoteGrades: promoteGrades,
    getClasses: getClasses,
    getClass: getClass,
    createClass: createClass,
    updateClass: updateClass,
    closeClass: closeClass,
    getStudentClasses: getStudentClasses,
    getClassRoster: getClassRoster,
    assignStudentToClass: assignStudentToClass,
    previewClassStartChange: previewClassStartChange,
    updateStudentClassStart: updateStudentClassStart,
    closeStudentClass: closeStudentClass,
    moveStudent: moveStudent,
    moveStudents: moveStudents,
    removeStudentClass: removeStudentClass,
    getLessons: getLessons,
    getStudentLessons: getStudentLessons,
    getLesson: getLesson,
    saveLesson: saveLesson,
    saveLessonsBatch: saveLessonsBatch,
    updateLesson: updateLesson,
    getClassSessionNotice: getClassSessionNotice,
    saveClassSessionNotice: saveClassSessionNotice,
    getTodayClassSession: getTodayClassSession,
    generateDailyReport: generateDailyReport,
    generateDailyReports: generateDailyReports,
    getMonthlyStats: getMonthlyStats,
    getMonthlyReportContext: getMonthlyReportContext,
    generateMonthlyReport: generateMonthlyReport,
    saveMonthlyReport: saveMonthlyReport,
    getCounselingNotes: getCounselingNotes,
    saveCounselingNote: saveCounselingNote,
    deleteCounselingNote: deleteCounselingNote,
    getMakeupSession: getMakeupSession,
    saveMakeupSession: saveMakeupSession,
    updateMakeupSession: updateMakeupSession,
    cancelMakeupSession: cancelMakeupSession,
    getCalendar: getCalendar,
    getSettings: getSettings,
    saveSettings: saveSettings,
    saveSetting: saveSetting,
    getDashboard: getDashboard,
    getTodayTeachingTasks: getTodayTeachingTasks,
    getDayAgenda: getDayAgenda,
    saveTask: saveTask,
    updateTaskStatus: updateTaskStatus,
    getClassPlan: getClassPlan,
    getClassPlans: getClassPlans,
    saveClassPlan: saveClassPlan,
    deleteClassPlan: deleteClassPlan,
    getSessionHomework: getSessionHomework,
    saveSessionHomework: saveSessionHomework,
    saveHomeworkChecks: saveHomeworkChecks,
    getWeeklyHomeworkDashboard: getWeeklyHomeworkDashboard,
    listCounselingNotes: listCounselingNotes,
    listMonthlyReportStatuses: listMonthlyReportStatuses,
    getLastLessonSnapshot: getLastLessonSnapshot,
    getStudentLearningContext: getStudentLearningContext,
    getLearningAlerts: getLearningAlerts,
    getClassStats: getClassStats,
    getLookups: getLookups,
    getBootstrap: getBootstrap,
    getClassSession: getClassSession,
    saveClassSession: saveClassSession,
    ensureSchema: ensureSchema,
    getShellBootstrap: getShellBootstrap,
    saveTodaySession: saveTodaySession,
    generateMonthlyReportsBulk: generateMonthlyReportsBulk,
    saveExamPeriod: saveExamPeriod,
    applyExamGroups: applyExamGroups,
    addTempAssignment: addTempAssignment,
    endTempAssignment: endTempAssignment,
    removeTempAssignment: removeTempAssignment,
    setPeriodSuspendedClasses: setPeriodSuspendedClasses,
    closeExamPeriod: closeExamPeriod,
    deleteExamPeriod: deleteExamPeriod,
    saveSchoolExam: saveSchoolExam,
    saveSchoolExamsBatch: saveSchoolExamsBatch,
    deleteSchoolExam: deleteSchoolExam
  }, views, planner);
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
