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
      delete input.schedule_from_legacy;
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

  function examPeriods_() {
    return table('ExamPeriods');
  }

  /** Students whose (regular or temporary) assignment covers the date, excluding 퇴원. */
  function rosterOn(classId, date) {
    var seen = {};
    var students = table('Students');
    return table('StudentClasses').filter(function (r) {
      return LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.relActiveOn(r, date);
    }).map(function (r) {
      return LMS.findById(students, 'student_id', r.student_id);
    }).filter(function (s) {
      if (!s || LMS.toStr(s.status) === '퇴원' || seen[s.student_id]) return false;
      seen[s.student_id] = true;
      return true;
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

  /** Copy class-level fields onto every student lesson of that date/class (legacy readers use them). */
  function writeSessionToLessons_(session, prevMax) {
    var lessons = table('Lessons');
    var key = LMS.sessionKey(session.lesson_date, session.class_id);
    var changed = false;
    lessons.forEach(function (row) {
      if (LMS.sessionKey(row.lesson_date, row.class_id) !== key) return;
      var next = {
        progress: LMS.toStr(session.progress),
        test_difficulty: LMS.toStr(session.test_difficulty)
      };
      // Max score follows the session unless a student row carries its own different value.
      if (!LMS.isBlank(session.test_max_score) &&
          (LMS.isBlank(row.test_max_score) ||
           (prevMax !== undefined && LMS.toStr(row.test_max_score) === LMS.toStr(prevMax)))) {
        next.test_max_score = session.test_max_score;
      }
      Object.keys(next).forEach(function (k) {
        if (LMS.toStr(row[k]) !== LMS.toStr(next[k])) {
          row[k] = next[k];
          changed = true;
        }
      });
    });
    if (changed) saveTable('Lessons', lessons);
  }

  function syncClassProgress_(session) {
    var progress = LMS.toStr(session.progress);
    if (!progress) return;
    var classId = LMS.toStr(session.class_id);
    var latest = table('ClassSessions').filter(function (r) {
      return LMS.toStr(r.class_id) === classId && LMS.toStr(r.progress);
    }).map(function (r) { return LMS.toStr(r.lesson_date); }).sort().pop();
    if (latest && latest > LMS.toStr(session.lesson_date)) return;
    var classes = table('Classes');
    var cls = LMS.findById(classes, 'class_id', classId);
    if (!cls || LMS.toStr(cls.current_progress) === progress) return;
    cls.current_progress = progress;
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
      var row = upsertClassSession_(input);
      removeLegacyNotice_(input.lesson_date, input.class_id);
      writeSessionToLessons_(row, prevMax);
      syncClassProgress_(row);
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
   * Legacy forms send progress / test meta on each student row. When they do, that
   * becomes the class session; otherwise the stored session is copied back onto the rows.
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
        fields.lesson_date = g.date;
        fields.class_id = g.classId;
        session = upsertClassSession_(fields);
        syncClassProgress_(session);
      }
      if (session) writeSessionToLessons_(session);
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
    var lessons = getLessons(date, classId);
    var text = '';
    for (var i = 0; i < lessons.length; i++) {
      if (LMS.toStr(lessons[i].homework)) {
        text = LMS.toStr(lessons[i].homework);
        break;
      }
    }
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
      return getSessionHomework(date, classId);
    });
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
        var assigned = LMS.previousMeetingDateFor(cls, checkDate, periods);
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
    var students = rosterOn(classId, date).filter(function (s) {
      return LMS.toStr(s.status) === '재원';
    });
    var lessons = getLessons(date, classId);
    var byStudent = {};
    lessons.forEach(function (l) { byStudent[l.student_id] = l; });
    var priorDate = LMS.previousMeetingDateFor(cls, date, examPeriods_());
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
    return {
      class: cls,
      date: date,
      time: LMS.classTimeOn(cls, date),
      session: getClassSession(date, classId),
      class_notice: getClassSessionNotice(date, classId),
      daily_plan: getClassPlan(classId, '일간', date),
      prior_homework: priorHomework ? {
        assigned_date: priorDate,
        items: priorHomework.items,
        from_legacy: priorHomework.from_legacy,
        checks_by_student: priorChecksByStudent
      } : null,
      today_homework: {
        lesson_date: date,
        items: todayHomework.items,
        from_legacy: todayHomework.from_legacy
      },
      students: students.map(function (s) {
        return Object.assign({}, s, { lesson: byStudent[s.student_id] || null });
      }),
      recorded_count: lessons.length,
      total_count: students.length
    };
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

  /** Bring stored tables up to LMS.SCHEMA_VERSION. Returns true when anything ran. */
  function ensureSchema() {
    var version = schemaVersion_();
    if (version >= LMS.SCHEMA_VERSION) return false;
    return withLock(function () {
      if (schemaVersion_() < 2) migrateToV2_();
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
    ensureSchema: ensureSchema
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
