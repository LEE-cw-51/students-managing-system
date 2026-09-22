/**
 * Store-agnostic business API. GAS and the local mock share this layer.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
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
        status: rel.status
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
      return enrichStudent(row);
    });
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

  function createClass(data) {
    return withLock(function () {
      var input = LMS.validateClassInput(data, false);
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
      Object.keys(input).forEach(function (k) {
        if (k === 'class_id') return;
        row[k] = input[k];
      });
      row.updated_at = now();
      saveTable('Classes', rows);
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

  function getClassRoster(classId) {
    requireClass(classId);
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
      requireStudent(studentId);
      requireClass(classId);
      var start = LMS.toStr(data.start_date) || store.today();
      if (!LMS.isIsoDate(start)) throw new Error('반 시작일 형식이 올바르지 않습니다.');
      var rels = table('StudentClasses');
      var exists = rels.some(function (r) {
        return LMS.toStr(r.student_id) === studentId &&
          LMS.toStr(r.class_id) === classId &&
          LMS.toStr(r.status) === '현재';
      });
      if (exists) throw new Error('이미 해당 반에 소속되어 있습니다.');
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
    return alreadyLocked ? run() : withLock(run);
  }

  function closeStudentClass(data) {
    return withLock(function () {
      var rels = table('StudentClasses');
      var row = null;
      if (data && data.id) {
        row = LMS.findById(rels, 'id', data.id);
      } else if (data && data.student_id && data.class_id) {
        row = rels.filter(function (r) {
          return LMS.toStr(r.student_id) === LMS.toStr(data.student_id) &&
            LMS.toStr(r.class_id) === LMS.toStr(data.class_id) &&
            LMS.toStr(r.status) === '현재';
        })[0];
      }
      if (!row) throw new Error('현재 반 배정 정보를 찾을 수 없습니다.');
      var end = LMS.toStr(data.end_date) || store.today();
      if (!LMS.isIsoDate(end)) throw new Error('반 종료일 형식이 올바르지 않습니다.');
      row.end_date = end;
      row.status = '종료';
      row.updated_at = now();
      saveTable('StudentClasses', rels);
      return row;
    });
  }

  function moveStudent(data) {
    return withLock(function () {
      var studentId = LMS.toStr(data.student_id);
      var newClassId = LMS.toStr(data.class_id);
      requireStudent(studentId);
      requireClass(newClassId);
      var start = LMS.toStr(data.start_date) || store.today();
      if (!LMS.isIsoDate(start)) throw new Error('반 시작일 형식이 올바르지 않습니다.');
      var rels = table('StudentClasses');
      var currentId = LMS.toStr(data.current_rel_id);
      rels.forEach(function (r) {
        var match = currentId
          ? LMS.toStr(r.id) === currentId
          : (LMS.toStr(r.student_id) === studentId && LMS.toStr(r.status) === '현재');
        if (match && LMS.toStr(r.status) === '현재') {
          r.end_date = LMS.addDays(start, -1);
          r.status = '종료';
          r.updated_at = now();
        }
      });
      saveTable('StudentClasses', rels);
      return assignStudentToClass({
        student_id: studentId,
        class_id: newClassId,
        start_date: start
      }, true);
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

  function saveLessonsBatch(items) {
    return withLock(function () {
      var list = Array.isArray(items) ? items : [items];
      var validated = list.map(LMS.validateLessonInput);
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
      return saved;
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
      return prev;
    });
  }

  function getTodayClassSession(date, classId) {
    var cls = requireClass(classId);
    var students = getClassRoster(classId).filter(function (s) {
      return LMS.toStr(s.status) === '재원';
    });
    var lessons = getLessons(date, classId);
    var byStudent = {};
    lessons.forEach(function (l) { byStudent[l.student_id] = l; });
    return {
      class: cls,
      date: date,
      students: students.map(function (s) {
        return Object.assign({}, s, { lesson: byStudent[s.student_id] || null });
      }),
      recorded_count: lessons.length,
      total_count: students.length
    };
  }

  function generateDailyReport(lessonId) {
    var lesson = getLesson(lessonId);
    var student = requireStudent(lesson.student_id);
    var classAvg = LMS.computeDailyClassTestAverage(getLessons(lesson.lesson_date, lesson.class_id));
    var text = LMS.buildDailyReport(lesson, student, settings(), classAvg);
    return { lesson: lesson, student: student, text: text, class_test_average: classAvg };
  }

  function generateDailyReports(date, classId) {
    var lessons = getLessons(date, classId);
    var set = settings();
    var students = table('Students');
    var classAvg = LMS.computeDailyClassTestAverage(lessons);
    var reports = lessons.map(function (lesson) {
      var student = LMS.findById(students, 'student_id', lesson.student_id) || { name: '학생' };
      return {
        lesson_id: lesson.lesson_id,
        student_id: lesson.student_id,
        student_name: student.name,
        text: LMS.buildDailyReport(lesson, student, set, classAvg)
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

  function getCounselingNotes(studentId) {
    requireStudent(studentId);
    return table('CounselingNotes').filter(function (row) {
      return LMS.toStr(row.student_id) === LMS.toStr(studentId);
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
      if (isUpdate) {
        var prev = LMS.findById(rows, 'note_id', input.note_id);
        if (!prev) throw new Error('상담일지를 찾을 수 없습니다.');
        prev.kind = input.kind;
        prev.counsel_date = input.counsel_date;
        prev.title = input.title;
        prev.content = input.content;
        prev.updated_at = ts;
        saveTable('CounselingNotes', rows);
        return prev;
      }
      var row = {
        note_id: nextIds('NTS', 1)[0],
        student_id: input.student_id,
        kind: input.kind,
        counsel_date: input.counsel_date,
        title: input.title,
        content: input.content,
        created_at: ts,
        updated_at: ts
      };
      rows.push(row);
      saveTable('CounselingNotes', rows);
      return row;
    });
  }

  function deleteCounselingNote(noteId) {
    return withLock(function () {
      var rows = table('CounselingNotes');
      var prev = LMS.findById(rows, 'note_id', noteId);
      if (!prev) throw new Error('상담일지를 찾을 수 없습니다.');
      var next = rows.filter(function (row) {
        return LMS.toStr(row.note_id) !== LMS.toStr(noteId);
      });
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
    var regular = LMS.buildRegularClassEvents(classes, start, end);
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

  function rosterStudentIds(classId) {
    var rels = table('StudentClasses');
    var students = table('Students');
    var ids = [];
    rels.forEach(function (r) {
      if (LMS.toStr(r.class_id) !== LMS.toStr(classId)) return;
      if (LMS.toStr(r.status) !== '현재') return;
      var s = LMS.findById(students, 'student_id', r.student_id);
      if (s && LMS.toStr(s.status) === '재원') ids.push(s.student_id);
    });
    return ids;
  }

  function getTodayTeachingTasks(date) {
    date = date || store.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var classes = table('Classes').filter(function (c) {
      return LMS.toStr(c.status) === '운영' && LMS.classMeetsOn(c.weekday, date);
    });
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.lesson_date) === date;
    });
    var students = table('Students');
    var regularClasses = classes.map(function (cls) {
      var rosterIds = rosterStudentIds(cls.class_id);
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
        start_time: cls.start_time,
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

  function getDashboard(date) {
    date = date || store.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var classes = table('Classes').filter(function (c) {
      return LMS.toStr(c.status) === '운영' && LMS.classMeetsOn(c.weekday, date);
    });
    var rels = table('StudentClasses');
    var students = table('Students');
    var studentIds = {};
    classes.forEach(function (cls) {
      rels.forEach(function (r) {
        if (LMS.toStr(r.class_id) !== LMS.toStr(cls.class_id)) return;
        if (LMS.toStr(r.status) !== '현재') return;
        var s = LMS.findById(students, 'student_id', r.student_id);
        if (s && LMS.toStr(s.status) === '재원') studentIds[s.student_id] = true;
      });
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
      learning_alerts: getLearningAlerts(8)
    };
  }

  function getClassStats(classId, year, month) {
    requireClass(classId);
    var range = LMS.monthRange(year, month);
    var roster = getClassRoster(classId);
    var lessons = table('Lessons').filter(function (row) {
      return LMS.toStr(row.class_id) === LMS.toStr(classId) &&
        LMS.inRange(row.lesson_date, range.start, range.end);
    });
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

  return {
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
    closeStudentClass: closeStudentClass,
    moveStudent: moveStudent,
    getLessons: getLessons,
    getStudentLessons: getStudentLessons,
    getLesson: getLesson,
    saveLesson: saveLesson,
    saveLessonsBatch: saveLessonsBatch,
    updateLesson: updateLesson,
    getTodayClassSession: getTodayClassSession,
    generateDailyReport: generateDailyReport,
    generateDailyReports: generateDailyReports,
    getMonthlyStats: getMonthlyStats,
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
    getLastLessonSnapshot: getLastLessonSnapshot,
    getStudentLearningContext: getStudentLearningContext,
    getLearningAlerts: getLearningAlerts,
    getClassStats: getClassStats,
    getLookups: getLookups,
    getBootstrap: getBootstrap
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
