/**
 * Store-agnostic business API. The Postgres store and the local file/memory store share this layer.
 * createService is composition only: store wiring, require helpers, nextIds, transactional, module build, bag.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
  require('./02_Assignments.js');
  require('./03_Sessions.js');
  require('./04_SchoolExams.js');
  require('./05_Views.js');
  require('./06_Plans.js');
  require('./07_Agent.js');
  require('./08_AgentActions.js');
  require('./09_ExamPeriods.js');
  require('./10_ClassDay.js');
  require('./11_Counseling.js');
  require('./12_Makeup.js');
  require('./13_Homework.js');
  require('./14_Lessons.js');
  require('./15_Reports.js');
  require('./16_Tasks.js');
  require('./17_Students.js');
  require('./18_Classes.js');
  require('./19_ClassPlans.js');
  require('./20_Calendar.js');
  require('./21_Settings.js');
  require('./22_Schema.js');
  require('./23_Shell.js');
  LMS.serviceDomains = require('./service-domains.js');
}

LMS.createService = function (store) {
  var memo = {};

  function now() {
    return store.now();
  }

  function dropCache() {
    memo = {};
  }

  /** Run fn as one unit: the store undoes its writes if fn throws, and the cache is dropped. */
  function inTransaction(fn) {
    try {
      return store.transaction ? store.transaction(fn, dropCache) : fn();
    } catch (e) {
      dropCache();
      throw e;
    }
  }

  function transactional(fns) {
    var out = {};
    Object.keys(fns).forEach(function (name) {
      var fn = fns[name];
      out[name] = typeof fn !== 'function' ? fn : function () {
        var self = this;
        var args = arguments;
        return inTransaction(function () { return fn.apply(self, args); });
      };
    });
    return out;
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

  function examPeriods_() {
    return table('ExamPeriods');
  }

  // Placement → resume-date port: Assignments notifies; ExamPeriods binds after both exist
  // so createService does not close over examPeriods before construction finishes.
  var placementResume = {
    recompute: null,
    notify: function (periodId) {
      if (placementResume.recompute) placementResume.recompute(periodId);
    }
  };

  var assignments = LMS.createAssignments({
    table: table,
    saveTable: saveTable,
    today: function () { return store.today(); },
    now: now,
    nextIds: nextIds,
    onPlacementChanged: function (periodId) { placementResume.notify(periodId); }
  });

  var examPeriods = LMS.createExamPeriods({
    table: table,
    saveTable: saveTable,
    today: function () { return store.today(); },
    now: now,
    nextIds: nextIds,
    assignments: assignments,
    requireStudent: requireStudent
  });
  placementResume.recompute = function (periodId) { examPeriods.recomputeResume(periodId); };

  var settingsMod = LMS.createSettings({
    table: table,
    saveTable: saveTable
  });

  var counseling = LMS.createCounseling({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireStudent: requireStudent
  });

  var makeup = LMS.createMakeup({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireStudent: requireStudent,
    requireClass: requireClass
  });

  var schoolExamWrites = LMS.createSchoolExamWrites({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds
  });

  // Lessons + homework are built just below; sessionSync only calls homework when copying titles.
  var homework = null;
  var sessionSync = LMS.createSessionSync({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    saveHomework: function (date, classId, titles) {
      homework.saveSessionHomework({ lesson_date: date, class_id: classId, titles: titles });
    }
  });

  var lessons = LMS.createLessons({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireClass: requireClass,
    requireStudent: requireStudent,
    sessionSync: sessionSync
  });

  homework = LMS.createHomework({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireClass: requireClass,
    requireStudent: requireStudent,
    sessionSync: sessionSync,
    getLessons: lessons.getLessons,
    examPeriods_: function () { return examPeriods_(); },
    assignments: assignments,
    today: function () { return store.today(); }
  });

  var reports = LMS.createReports({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireStudent: requireStudent,
    requireClass: requireClass,
    settings: settingsMod.settings,
    lessons: lessons,
    homework: homework,
    counseling: counseling,
    assignments: assignments,
    today: function () { return store.today(); }
  });

  var tasks = LMS.createTasks({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireStudent: requireStudent,
    requireClass: requireClass,
    assignments: assignments,
    examPeriods_: function () { return examPeriods_(); },
    makeupTitle: makeup.makeupTitle,
    today: function () { return store.today(); }
  });

  var students = LMS.createStudents({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireStudent: requireStudent,
    assignments: assignments,
    today: function () { return store.today(); }
  });

  var classes = LMS.createClasses({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireClass: requireClass,
    assignments: assignments,
    examPeriods: examPeriods
  });

  var classPlans = LMS.createClassPlans({
    table: table,
    saveTable: saveTable,
    now: now,
    nextIds: nextIds,
    requireClass: requireClass
  });

  var calendar = LMS.createCalendar({
    table: table,
    examPeriods_: examPeriods_,
    makeupTitle: makeup.makeupTitle
  });

  var schema = LMS.createSchema({
    table: table,
    saveTable: saveTable
  });

  var shell = LMS.createShell({
    table: table,
    today: function () { return store.today(); },
    settings: settingsMod.settings,
    assignments: assignments,
    getClasses: classes.getClasses,
    getStudents: students.getStudents
  });

  var views = LMS.createViews ? LMS.createViews({
    table: table,
    store: store,
    requireClass: requireClass,
    requireStudent: requireStudent,
    assignments: assignments,
    examPeriods: examPeriods_,
    periods: examPeriods,
    checkingLessonDate: homework.checkingLessonDate_,
    getClassSession: lessons.getClassSession,
    getClassPlan: classPlans.getClassPlan,
    getClassPlans: classPlans.getClassPlans,
    getTodayTeachingTasks: tasks.getTodayTeachingTasks,
    getDayAgenda: tasks.getDayAgenda,
    getTaskCounts: tasks.getTaskCounts,
    getWeeklyHomeworkDashboard: homework.getWeeklyHomeworkDashboard,
    relRemovable: assignments.removable,
    generateDailyReports: reports.generateDailyReports,
    // The planner is built just below; views call this only at request time.
    currentUnit: function (classId) { return planner.getCurrentUnit ? planner.getCurrentUnit(classId) : null; }
  }) : {};

  var planner = LMS.createPlanner ? LMS.createPlanner({
    table: table,
    saveTable: saveTable,
    store: store,
    now: now,
    nextIds: nextIds,
    requireClass: requireClass,
    assignments: assignments,
    examPeriods: examPeriods_,
    homeworkStats: views.homeworkStats_
  }) : {};

  var classDay = LMS.createClassDayRecording({
    table: table,
    requireClass: requireClass,
    requireStudent: requireStudent,
    assignments: assignments,
    examPeriods_: examPeriods_,
    sessionSync: sessionSync,
    getLessons: lessons.getLessons,
    getSessionHomework: homework.getSessionHomework,
    getClassSession: lessons.getClassSession,
    getClassSessionNotice: lessons.getClassSessionNotice,
    saveHomeworkChecks: homework.saveHomeworkChecks,
    saveSessionHomework: homework.saveSessionHomework,
    saveStudentHomeworkItems: homework.saveStudentHomeworkItems,
    saveClassSession: lessons.saveClassSession,
    saveLessonsBatch: lessons.saveLessonsBatch,
    homeworkReplaceOn_: homework.homeworkReplaceOn_,
    enrichHomeworkItem_: homework.enrichHomeworkItem_,
    priorLessonDate_: homework.priorLessonDate_,
    studentBadges: function (s) { return views.studentBadges(s); },
    getClassPlan: classPlans.getClassPlan,
    setDailyPlanDone: function (classId, date, status) {
      return planner.setDailyPlanDone ? planner.setDailyPlanDone(classId, date, status) : null;
    }
  });

  // Approved assistant changes run through the finished service object built just below.
  var agent = LMS.createAgent ? LMS.createAgent({
    table: table,
    saveTable: saveTable,
    now: now,
    today: function () { return store.today(); },
    nextIds: nextIds,
    assignments: assignments,
    examPeriods: examPeriods,
    service: function () { return service; }
  }) : {};

  // Domain seams: renamed assignments/examPeriods + bag-keyed modules.
  // Maps live in service-domains.js (shared with PUBLIC_API).
  var domains = LMS.serviceDomains;
  var service = transactional(Object.assign({},
  domains.pickDomain(assignments, domains.ASSIGNMENTS_BAG),
  domains.pickDomain(examPeriods, domains.EXAM_PERIODS_BAG),
  domains.pickDomain(makeup, domains.MAKEUP_BAG),
  domains.pickDomain(homework, domains.HOMEWORK_BAG),
  domains.pickDomain(lessons, domains.LESSONS_BAG),
  domains.pickDomain(reports, domains.REPORTS_BAG),
  domains.pickDomain(tasks, domains.TASKS_BAG),
  domains.pickDomain(students, domains.STUDENTS_BAG),
  domains.pickDomain(classes, domains.CLASSES_BAG),
  domains.pickDomain(settingsMod, domains.SETTINGS_BAG),
  classPlans,
  calendar,
  schema,
  shell,
  counseling,
  schoolExamWrites,
  classDay,
  views.api,
  planner,
  agent));
  return service;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
