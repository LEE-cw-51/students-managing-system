'use strict';

/**
 * Domain → createService bag seams.
 *
 * createService picks renamed surfaces from deep modules; `lib/public-api.js` builds the browser
 * allowlist from the same maps so domain-owned names cannot drift.
 * HTTP `/api/[name]` still uses flat bag names (stable this pass; domain remapping deferred).
 *
 * Domain map (bag composition):
 * - assignments (`02_Assignments.js`) — renamed write/query aliases
 * - examPeriods (`09_ExamPeriods.js`) — renamed write aliases
 * - classDay (`10_ClassDay.js`) — already bag-keyed; spread as-is
 * - counseling (`11_Counseling.js`) — already bag-keyed; spread as-is
 * - makeup (`12_Makeup.js`) — pickDomain (drops makeupTitle helper)
 * - homework (`13_Homework.js`) — pickDomain (drops *_ helpers used by ClassDay/Views)
 * - lessons (`14_Lessons.js`) — already bag-keyed; pickDomain identity map
 * - reports (`15_Reports.js`) — already bag-keyed; pickDomain identity map (incl. getClassStats)
 * - tasks (`16_Tasks.js`) — already bag-keyed; pickDomain identity map
 * - students (`17_Students.js`) — already bag-keyed; pickDomain identity map
 * - classes (`18_Classes.js`) — already bag-keyed; pickDomain identity map
 * - classPlans (`19_ClassPlans.js`) — already bag-keyed; spread as-is
 * - calendar (`20_Calendar.js`) — already bag-keyed; spread as-is
 * - settings (`21_Settings.js`) — pickDomain (drops settings() helper used as a port)
 * - schema (`22_Schema.js`) — already bag-keyed; spread as-is
 * - shell (`23_Shell.js`) — already bag-keyed; spread as-is
 * - schoolExamWrites (`04_SchoolExams.js` createSchoolExamWrites) — already bag-keyed
 * - views (`05_Views.js`) — views.api only (studentBadges / homeworkStats_ stay off the bag)
 * - planner (`06_Plans.js`) — already bag-keyed; spread as-is
 * - agent (`07_Agent.js`) — already bag-keyed; spread as-is
 *
 * Remaining createService body is composition only (store helpers, require/nextIds,
 * transactional, module build, Object.assign bag).
 */

function pickDomain(src, map) {
  var out = {};
  Object.keys(map).forEach(function (publicName) {
    out[publicName] = src[map[publicName]];
  });
  return out;
}

/** assignments internal name → bag name (includes server-only aliases). */
var ASSIGNMENTS_BAG = {
  assignStudentToClass: 'assign',
  previewClassStartChange: 'previewStart',
  updateStudentClassStart: 'changeStart',
  closeStudentClass: 'close',
  moveStudent: 'move',
  moveStudents: 'moveMany',
  assignStudentsToClass: 'assignMany',
  closeStudentsInClass: 'closeMany',
  removeStudentClass: 'remove',
  addTempAssignment: 'addTemp',
  addTempAssignments: 'addTempMany',
  endTempAssignment: 'endTemp',
  removeTempAssignment: 'removeTemp'
};

/** examPeriods internal name → bag name. */
var EXAM_PERIODS_BAG = {
  saveExamPeriod: 'save',
  applyExamGroups: 'applyGroups',
  setPeriodSuspendedClasses: 'setSuspended',
  closeExamPeriod: 'close',
  deleteExamPeriod: 'remove'
};

/** makeup public bag names → module method (skips makeupTitle helper). */
var MAKEUP_BAG = {
  getMakeupSession: 'getMakeupSession',
  saveMakeupSession: 'saveMakeupSession',
  updateMakeupSession: 'updateMakeupSession',
  cancelMakeupSession: 'cancelMakeupSession'
};

/** homework bag names → module method (skips ClassDay/Views helpers). */
var HOMEWORK_BAG = {
  getSessionHomework: 'getSessionHomework',
  saveSessionHomework: 'saveSessionHomework',
  saveStudentHomeworkItems: 'saveStudentHomeworkItems',
  saveHomeworkChecks: 'saveHomeworkChecks',
  getWeeklyHomeworkDashboard: 'getWeeklyHomeworkDashboard'
};

/** lessons + class sessions bag names → module method. */
var LESSONS_BAG = {
  getLessons: 'getLessons',
  getStudentLessons: 'getStudentLessons',
  getLesson: 'getLesson',
  saveLesson: 'saveLesson',
  saveLessonsBatch: 'saveLessonsBatch',
  updateLesson: 'updateLesson',
  updateLessonAttendance: 'updateLessonAttendance',
  getClassSessionNotice: 'getClassSessionNotice',
  saveClassSessionNotice: 'saveClassSessionNotice',
  getClassSession: 'getClassSession',
  saveClassSession: 'saveClassSession'
};

/** reports bag names → module method. */
var REPORTS_BAG = {
  generateDailyReport: 'generateDailyReport',
  generateDailyReports: 'generateDailyReports',
  getMonthlyStats: 'getMonthlyStats',
  getMonthlyReportContext: 'getMonthlyReportContext',
  generateMonthlyReport: 'generateMonthlyReport',
  saveMonthlyReport: 'saveMonthlyReport',
  generateMonthlyReportsBulk: 'generateMonthlyReportsBulk',
  listMonthlyReportStatuses: 'listMonthlyReportStatuses',
  getClassStats: 'getClassStats'
};

/** tasks / agenda bag names → module method. */
var TASKS_BAG = {
  getTodayTeachingTasks: 'getTodayTeachingTasks',
  getLearningAlerts: 'getLearningAlerts',
  getDayAgenda: 'getDayAgenda',
  saveTask: 'saveTask',
  updateTaskStatus: 'updateTaskStatus',
  deleteTask: 'deleteTask',
  getTaskCounts: 'getTaskCounts'
};

/** students bag names → module method. */
var STUDENTS_BAG = {
  getStudents: 'getStudents',
  getStudent: 'getStudent',
  createStudent: 'createStudent',
  updateStudent: 'updateStudent',
  archiveStudent: 'archiveStudent',
  previewGradePromotion: 'previewGradePromotion',
  promoteGrades: 'promoteGrades',
  getStudentClasses: 'getStudentClasses',
  setStudentsStatus: 'setStudentsStatus'
};

/** classes + roster bag names → module method. */
var CLASSES_BAG = {
  getClasses: 'getClasses',
  getClass: 'getClass',
  createClass: 'createClass',
  updateClass: 'updateClass',
  closeClass: 'closeClass',
  deleteClass: 'deleteClass',
  getClassRoster: 'getClassRoster'
};

/** settings bag names → module method (skips settings() port helper). */
var SETTINGS_BAG = {
  getSettings: 'getSettings',
  saveSettings: 'saveSettings',
  saveSetting: 'saveSetting'
};

/**
 * Browser/MCP HTTP allowlist names owned by each domain.
 * Must stay a subset of what createService actually puts on the bag.
 * `addTempAssignment` is on the bag (agent/tests) but not browser-public.
 */
var ASSIGNMENTS_PUBLIC = Object.keys(ASSIGNMENTS_BAG).filter(function (k) {
  return k !== 'addTempAssignment';
});

var EXAM_PERIODS_PUBLIC = Object.keys(EXAM_PERIODS_BAG);

var CLASS_DAY_PUBLIC = [
  'getTodayClassSession',
  'saveTodaySession'
];

var VIEWS_PUBLIC = [
  'getClassHomeworkLog',
  'getClassList',
  'getClassMembers',
  'getClassOverview',
  'getClassProgressLog',
  'getClassTestDetail',
  'getClassTests',
  'getClassTrend',
  'getDailyReportBoard',
  'getDailyReportClasses',
  'getExamPeriodDetail',
  'getExamPeriods',
  'getMonthlyReportBoard',
  'getSchoolExams',
  'getSchoolOptions',
  'getStudentAttendanceMonth',
  'getStudentGrades',
  'getStudentHomework',
  'getStudentList',
  'getStudentOverview',
  'getStudentReports',
  'getTodayBoard',
  'proposeExamGroups'
];

var PLANNER_PUBLIC = [
  'applyPlanDraft',
  'cancelClassDate',
  'discardPlanDraft',
  'getPlanBoard',
  'restoreClassDate',
  'updatePlanDraftItem'
];

var AGENT_PUBLIC = [
  'findAgentTurn',
  'getAgentConversation',
  'listAgentConversations',
  'listMcpConnections',
  'listPendingProposals',
  'revokeMcpConnection'
];

var COUNSELING_PUBLIC = [
  'deleteCounselingNote',
  'getCounselingNotes',
  'listCounselingNotes',
  'saveCounselingNote'
];

var MAKEUP_PUBLIC = [
  'getMakeupSession',
  'saveMakeupSession',
  'updateMakeupSession'
];

var HOMEWORK_PUBLIC = [
  'saveHomeworkChecks'
];

var LESSONS_PUBLIC = [
  'getStudentLessons',
  'updateLessonAttendance'
];

var REPORTS_PUBLIC = [
  'generateDailyReport',
  'generateDailyReports',
  'generateMonthlyReport',
  'generateMonthlyReportsBulk',
  'getClassStats',
  'saveMonthlyReport'
];

var TASKS_PUBLIC = [
  'deleteTask',
  'saveTask',
  'updateTaskStatus'
];

var STUDENTS_PUBLIC = [
  'createStudent',
  'getStudent',
  'previewGradePromotion',
  'promoteGrades',
  'setStudentsStatus',
  'updateStudent'
];

var CLASSES_PUBLIC = [
  'createClass',
  'deleteClass',
  'updateClass'
];

var SCHOOL_EXAMS_PUBLIC = [
  'deleteSchoolExam',
  'saveSchoolExam',
  'saveSchoolExamsBatch'
];

var CLASS_PLANS_PUBLIC = [
  'deleteClassPlan',
  'saveClassPlan'
];

var SETTINGS_PUBLIC = [
  'saveSettings'
];

var SHELL_PUBLIC = [
  'getShellBootstrap'
];

/** createService-owned methods that the browser may call (none left after domain extract). */
var CORE_PUBLIC = [];

function publicApiNames() {
  return CORE_PUBLIC
    .concat(ASSIGNMENTS_PUBLIC)
    .concat(EXAM_PERIODS_PUBLIC)
    .concat(CLASS_DAY_PUBLIC)
    .concat(COUNSELING_PUBLIC)
    .concat(MAKEUP_PUBLIC)
    .concat(HOMEWORK_PUBLIC)
    .concat(LESSONS_PUBLIC)
    .concat(REPORTS_PUBLIC)
    .concat(TASKS_PUBLIC)
    .concat(STUDENTS_PUBLIC)
    .concat(CLASSES_PUBLIC)
    .concat(SCHOOL_EXAMS_PUBLIC)
    .concat(CLASS_PLANS_PUBLIC)
    .concat(SETTINGS_PUBLIC)
    .concat(SHELL_PUBLIC)
    .concat(VIEWS_PUBLIC)
    .concat(PLANNER_PUBLIC)
    .concat(AGENT_PUBLIC);
}

module.exports = {
  pickDomain: pickDomain,
  ASSIGNMENTS_BAG: ASSIGNMENTS_BAG,
  EXAM_PERIODS_BAG: EXAM_PERIODS_BAG,
  MAKEUP_BAG: MAKEUP_BAG,
  HOMEWORK_BAG: HOMEWORK_BAG,
  LESSONS_BAG: LESSONS_BAG,
  REPORTS_BAG: REPORTS_BAG,
  TASKS_BAG: TASKS_BAG,
  STUDENTS_BAG: STUDENTS_BAG,
  CLASSES_BAG: CLASSES_BAG,
  SETTINGS_BAG: SETTINGS_BAG,
  ASSIGNMENTS_PUBLIC: ASSIGNMENTS_PUBLIC,
  EXAM_PERIODS_PUBLIC: EXAM_PERIODS_PUBLIC,
  CLASS_DAY_PUBLIC: CLASS_DAY_PUBLIC,
  COUNSELING_PUBLIC: COUNSELING_PUBLIC,
  MAKEUP_PUBLIC: MAKEUP_PUBLIC,
  HOMEWORK_PUBLIC: HOMEWORK_PUBLIC,
  LESSONS_PUBLIC: LESSONS_PUBLIC,
  REPORTS_PUBLIC: REPORTS_PUBLIC,
  TASKS_PUBLIC: TASKS_PUBLIC,
  STUDENTS_PUBLIC: STUDENTS_PUBLIC,
  CLASSES_PUBLIC: CLASSES_PUBLIC,
  SCHOOL_EXAMS_PUBLIC: SCHOOL_EXAMS_PUBLIC,
  CLASS_PLANS_PUBLIC: CLASS_PLANS_PUBLIC,
  SETTINGS_PUBLIC: SETTINGS_PUBLIC,
  SHELL_PUBLIC: SHELL_PUBLIC,
  VIEWS_PUBLIC: VIEWS_PUBLIC,
  PLANNER_PUBLIC: PLANNER_PUBLIC,
  AGENT_PUBLIC: AGENT_PUBLIC,
  CORE_PUBLIC: CORE_PUBLIC,
  publicApiNames: publicApiNames
};
