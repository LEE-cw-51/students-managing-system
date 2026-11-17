/**
 * Lessons and class sessions: student lesson rows, ClassSessions, and legacy notices.
 * Owns Lessons / ClassSessions / ClassSessionNotices writes used by ClassDay and reports.
 * Copy between ClassSessions and Lessons stays in 03_Sessions.js; this module only calls it.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireClass, requireStudent, sessionSync.
 * Callers run commands inside the service transaction.
 */
LMS.createLessons = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var sessionSync = ctx.sessionSync;

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
    ctx.requireStudent(studentId);
    var all = table('Lessons');
    var rows = all.filter(function (row) {
      if (LMS.toStr(row.student_id) !== LMS.toStr(studentId)) return false;
      return LMS.inRange(row.lesson_date, startDate, endDate);
    });
    var cache = {};
    function classAvg(lesson) {
      var date = LMS.toStr(lesson.lesson_date);
      var classId = LMS.toStr(lesson.class_id);
      var key = date + '|' + classId + '|' + LMS.lessonTestPaper(lesson).key;
      if (!Object.prototype.hasOwnProperty.call(cache, key)) {
        cache[key] = LMS.computeDailyClassTestAverage(all.filter(function (row) {
          return LMS.toStr(row.lesson_date) === date &&
            LMS.toStr(row.class_id) === classId;
        }), lesson);
      }
      return cache[key];
    }
    return rows.map(function (row) {
      return Object.assign({}, row, {
        class_test_average: classAvg(row)
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
    var session = sessionSync.find(date, classId);
    if (session && LMS.toStr(session.class_notice)) return LMS.toStr(session.class_notice);
    var row = findClassSessionNoticeRow_(date, classId);
    return row ? LMS.toStr(row.class_notice) : '';
  }

  function saveClassSessionNotice(date, classId, text) {
    ctx.requireClass(classId);
    if (!LMS.isIsoDate(LMS.toStr(date))) {
      throw new Error('수업 날짜가 올바르지 않습니다.');
    }
    sessionSync.saveNotice(date, classId, text);
    removeLegacyNotice_(date, classId);
    var notice = LMS.toStr(text);
    return notice ? { lesson_date: LMS.toStr(date), class_id: LMS.toStr(classId), class_notice: notice } : null;
  }

  function removeLegacyNotice_(date, classId) {
    var rows = table('ClassSessionNotices');
    var key = LMS.sessionKey(date, classId);
    var next = rows.filter(function (r) {
      return LMS.sessionKey(r.lesson_date, r.class_id) !== key;
    });
    if (next.length !== rows.length) saveTable('ClassSessionNotices', next);
  }

  function getClassSession(date, classId) {
    ctx.requireClass(classId);
    if (!LMS.isIsoDate(LMS.toStr(date))) throw new Error('수업 날짜가 올바르지 않습니다.');
    var row = sessionSync.find(date, classId);
    var base = row ? Object.assign({}, row) : {
      session_id: '',
      lesson_date: LMS.toStr(date),
      class_id: LMS.toStr(classId),
      progress: '',
      content: '',
      test_title: '',
      test_max_score: '',
      test_difficulty: '',
      test_scope: '',
      class_notice: '',
      memo: ''
    };
    if (base.test_scope === undefined || base.test_scope === null) base.test_scope = '';
    if (!LMS.toStr(base.class_notice)) base.class_notice = getClassSessionNotice(date, classId);
    return base;
  }

  function saveClassSession(data) {
    var input = LMS.validateClassSessionInput(data);
    ctx.requireClass(input.class_id);
    var row = sessionSync.saveSession(input);
    removeLegacyNotice_(input.lesson_date, input.class_id);
    return Object.assign({}, row);
  }

  /**
   * Fills test max / difficulty into a lesson input before validation, given the stored row.
   * A tested row leaving its own paper takes both from the class record, so stale own-paper values
   * sent along never survive the switch; the input's values are kept only when the class has no max.
   */
  function applyTestPaper_(input, stored) {
    var ownStored = !!stored && LMS.toStr(stored.test_own) === 'Y';
    if (ownStored && input.test_own === undefined) {
      // An input silent about the paper keeps the student's own paper and its values.
      if (LMS.isBlank(input.test_max_score)) input.test_max_score = stored.test_max_score;
      if (LMS.isBlank(input.test_difficulty)) input.test_difficulty = stored.test_difficulty;
      return input;
    }
    if (LMS.toStr(input.test_status) !== '실시' || LMS.toStr(input.test_own).toUpperCase() === 'Y') return input;
    var session = sessionSync.find(input.lesson_date, input.class_id);
    if (!session || LMS.isBlank(session.test_max_score)) return input;
    if (ownStored) {
      input.test_max_score = session.test_max_score;
      input.test_difficulty = LMS.toStr(session.test_difficulty);
    } else if (LMS.isBlank(input.test_max_score)) {
      input.test_max_score = session.test_max_score;
    }
    return input;
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
    var storedByKey = {};
    table('Lessons').forEach(function (row) {
      storedByKey[LMS.lessonKey(row.lesson_date, row.student_id, row.class_id)] = row;
    });
    var prepared = list.map(function (item) {
      var input = Object.assign({}, item);
      return applyTestPaper_(input, storedByKey[LMS.lessonKey(input.lesson_date, input.student_id, input.class_id)]);
    });
    var validated = prepared.map(LMS.validateLessonInput);
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
    var newIds = insertCount ? ctx.nextIds('LES', insertCount) : [];
    var idPos = 0;
    var ts = ctx.now();
    var saved = [];
    validated.forEach(function (row, i) {
      var key = LMS.lessonKey(row.lesson_date, row.student_id, row.class_id);
      var existingIndex = index[key];
      if (existingIndex !== undefined) {
        var prev = lessons[existingIndex];
        var merged = Object.assign({}, prev, row, {
          lesson_id: prev.lesson_id,
          created_at: prev.created_at,
          updated_at: ts
        });
        // Fields left out of the input keep their stored text; the class record re-aligns them below.
        ['progress', 'homework', 'progress_own', 'test_own', 'test_title'].forEach(function (k) {
          if ((list[i] || {})[k] === undefined) merged[k] = prev[k];
        });
        if (!LMS.toStr(merged.progress)) merged.progress_own = '';
        if (LMS.toStr(merged.test_status) !== '실시' || LMS.toStr(merged.test_own) !== 'Y') {
          merged.test_own = '';
          merged.test_title = '';
        }
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
    // Paper-adjusted inputs, so a stale own-paper value never becomes the class record.
    sessionSync.afterLessonsSaved(prepared, saved);
    if (classNotice !== undefined && saved.length) {
      saveClassSessionNotice(saved[0].lesson_date, saved[0].class_id, classNotice);
    }
    return saved.map(function (row) {
      return LMS.findById(table('Lessons'), 'lesson_id', row.lesson_id) || row;
    });
  }

  function saveLesson(data) {
    return saveLessonsBatch([data])[0];
  }

  /** Change only attendance. Scores, homework, progress and notes stay as they are. */
  function updateLessonAttendance(data) {
    data = data || {};
    var id = LMS.toStr(data.lesson_id);
    if (!id) throw new Error('수업 기록을 찾을 수 없습니다.');
    var attendance = LMS.toStr(data.attendance);
    LMS.assertEnum(attendance, LMS.ATTENDANCE, '출석');
    var lessons = table('Lessons');
    var row = LMS.findById(lessons, 'lesson_id', id);
    if (!row) throw new Error('수업 기록을 찾을 수 없습니다.');
    if (LMS.toStr(row.attendance) !== attendance) {
      row.attendance = attendance;
      row.updated_at = ctx.now();
      saveTable('Lessons', lessons);
    }
    return row;
  }

  function updateLesson(data) {
    if (LMS.isBlank(data && data.lesson_id)) {
      return saveLesson(data);
    }
    var lessons = table('Lessons');
    var prev = LMS.findById(lessons, 'lesson_id', data.lesson_id);
    if (!prev) throw new Error('수업 기록을 찾을 수 없습니다.');
    var input = applyTestPaper_(Object.assign({}, prev, data, {
      lesson_id: prev.lesson_id
    }), prev);
    var merged = LMS.validateLessonInput(input);
    var raw = Object.assign({}, data);
    if (data.test_max_score !== undefined) raw.test_max_score = input.test_max_score;
    if (data.test_difficulty !== undefined) raw.test_difficulty = input.test_difficulty;
    prev = Object.assign(prev, merged, { updated_at: ctx.now(), lesson_id: prev.lesson_id, created_at: prev.created_at });
    saveTable('Lessons', lessons);
    // Progress / homework / difficulty are class values: an edit on one row edits the class record.
    sessionSync.afterLessonsSaved([raw], [prev]);
    return LMS.findById(table('Lessons'), 'lesson_id', prev.lesson_id) || prev;
  }

  return {
    getLessons: getLessons,
    getStudentLessons: getStudentLessons,
    getLesson: getLesson,
    getClassSessionNotice: getClassSessionNotice,
    saveClassSessionNotice: saveClassSessionNotice,
    getClassSession: getClassSession,
    saveClassSession: saveClassSession,
    saveLessonsBatch: saveLessonsBatch,
    saveLesson: saveLesson,
    updateLessonAttendance: updateLessonAttendance,
    updateLesson: updateLesson
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
