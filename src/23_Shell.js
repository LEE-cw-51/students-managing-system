/**
 * App shell bootstrap and lookup lists: settings/today/search index and class/student picks.
 * Search index uses assignments.attending / openRegular for "어느 반" labels.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, today(), settings(), assignments, getClasses(filter), getStudents(filter).
 * Callers run commands inside the service transaction.
 */
LMS.createShell = function (ctx) {
  var table = ctx.table;
  var assignments = ctx.assignments;

  /** Light payload for the app shell: settings, today, and the global search index. */
  function getShellBootstrap() {
    var classes = table('Classes');
    var today = ctx.today();
    return {
      settings: ctx.settings(),
      grades: LMS.GRADE_OPTIONS,
      today: today,
      search: {
        students: table('Students').map(function (s) {
          var classNames = assignments.attending(s.student_id, today).map(function (r) {
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
            // 열린 정규 배정 (booked ones too), for "어느 반에서 옮길지" in the assign dialog.
            class_ids: assignments.openRegular(s.student_id).map(function (r) { return LMS.toStr(r.class_id); })
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
      classes: ctx.getClasses({}),
      students: ctx.getStudents({})
    };
  }

  return {
    getShellBootstrap: getShellBootstrap,
    getLookups: getLookups
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
