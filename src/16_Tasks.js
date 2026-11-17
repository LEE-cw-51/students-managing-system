/**
 * Tasks and day agenda: manual tasks CRUD, teaching-task list, learning alerts.
 * Counseling follow-up task rows are created/updated from 11_Counseling.js; this module
 * only edits/deletes manual tasks and lists agenda rows.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireStudent, requireClass,
 * assignments, examPeriods_, makeupTitle(row, cls, student), today().
 * Callers run commands inside the service transaction.
 */
LMS.createTasks = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var assignments = ctx.assignments;

  function rosterStudentIds(classId, date) {
    return assignments.recordTargets(classId, date).students.map(function (s) { return s.student_id; });
  }

  function getTodayTeachingTasks(date) {
    date = date || ctx.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var periods = ctx.examPeriods_();
    var classes = table('Classes').filter(function (c) {
      return LMS.classMeetsOnDate(c, date, periods);
    });
    var dayLessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.lesson_date) === date;
    });
    var students = table('Students');
    var regularClasses = classes.map(function (cls) {
      var rosterIds = rosterStudentIds(cls.class_id, date);
      var slot = LMS.classTimeOn(cls, date) || {};
      var recorded = {};
      dayLessons.forEach(function (l) {
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
        title: ctx.makeupTitle(row, cls, student),
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

  function getLearningAlerts(limit) {
    limit = limit || 8;
    var end = ctx.today();
    var start = LMS.addDays(end, -60);
    var alerts = [];
    table('Students').forEach(function (student) {
      if (LMS.toStr(student.status) !== '재원') return;
      var studentLessons = table('Lessons').filter(function (row) {
        return LMS.toStr(row.student_id) === LMS.toStr(student.student_id) &&
          LMS.inRange(row.lesson_date, start, end);
      });
      var signals = LMS.detectLearningSignals(studentLessons);
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

  /** The tasks due on a date (cancelled ones left out). */
  function getDayAgenda(date) {
    date = date || ctx.today();
    if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var items = [];
    var students = table('Students');
    var classes = table('Classes');

    table('Tasks').forEach(function (row) {
      if (LMS.toStr(row.due_date) !== date) return;
      if (LMS.toStr(row.status) === '취소') return;
      items.push(LMS.taskItem(row, students, classes, date));
    });

    return {
      date: date,
      items: sortAgendaItems(items)
    };
  }

  function saveTask(data) {
    var isUpdate = !LMS.isBlank(data && data.task_id);
    var input = LMS.validateTaskInput(data, isUpdate);
    if (input.student_id) ctx.requireStudent(input.student_id);
    if (input.class_id) ctx.requireClass(input.class_id);
    var rows = table('Tasks');
    var ts = ctx.now();
    if (isUpdate) {
      var prev = LMS.findById(rows, 'task_id', input.task_id);
      if (!prev) throw new Error('할 일을 찾을 수 없습니다.');
      LMS.assertTaskEditable(prev);
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
      task_id: ctx.nextIds(LMS.PREFIX.task, 1)[0],
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
  }

  function updateTaskStatus(taskId, status) {
    var rows = table('Tasks');
    var prev = LMS.findById(rows, 'task_id', taskId);
    if (!prev) throw new Error('할 일을 찾을 수 없습니다.');
    var nextStatus = LMS.assertEnum(status, LMS.TASK_STATUS, '할 일 상태');
    prev.status = nextStatus;
    prev.updated_at = ctx.now();
    saveTable('Tasks', rows);
    return prev;
  }

  /** Only tasks made by hand can be removed; counseling follow-ups move with their note. */
  function deleteTask(taskId) {
    var rows = table('Tasks');
    var prev = LMS.findById(rows, 'task_id', taskId);
    if (!prev) throw new Error('할 일을 찾을 수 없습니다.');
    LMS.assertTaskEditable(prev);
    saveTable('Tasks', rows.filter(function (row) {
      return LMS.toStr(row.task_id) !== LMS.toStr(prev.task_id);
    }));
    return { task_id: prev.task_id, deleted: true };
  }

  /** Open (예정) tasks per due date in [start, end]: { 'YYYY-MM-DD': n }. */
  function getTaskCounts(start, end) {
    start = LMS.toStr(start);
    end = LMS.toStr(end);
    if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var counts = {};
    table('Tasks').forEach(function (row) {
      if (LMS.toStr(row.status) !== '예정') return;
      var due = LMS.toStr(row.due_date);
      if (!LMS.inRange(due, start, end)) return;
      counts[due] = (counts[due] || 0) + 1;
    });
    return counts;
  }

  return {
    getTodayTeachingTasks: getTodayTeachingTasks,
    getLearningAlerts: getLearningAlerts,
    getDayAgenda: getDayAgenda,
    saveTask: saveTask,
    updateTaskStatus: updateTaskStatus,
    deleteTask: deleteTask,
    getTaskCounts: getTaskCounts
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
