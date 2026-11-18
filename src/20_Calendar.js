/**
 * Calendar events for a date range: regular class sessions plus makeup sessions.
 * Makeup row CRUD stays in `12_Makeup.js`; this module only composes display events.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, examPeriods_(), makeupTitle(row, cls, student).
 * Callers run commands inside the service transaction.
 */
LMS.createCalendar = function (ctx) {
  var table = ctx.table;

  function getCalendar(start, end) {
    if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end)) {
      throw new Error('날짜 형식이 올바르지 않습니다.');
    }
    if (start > end) throw new Error('시작일이 종료일보다 뒤입니다.');
    var classes = table('Classes');
    var students = table('Students');
    var regular = LMS.buildRegularClassEvents(classes, start, end, ctx.examPeriods_());
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
        title: ctx.makeupTitle(row, cls, student),
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

  return {
    getCalendar: getCalendar
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
