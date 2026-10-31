// Service functions the browser calls through /api/[name] (directly or inside apiBatch).
// Anything else on the service object stays server-only.
export const PUBLIC_API = new Set([
  'addTempAssignments', 'applyExamGroups', 'applyPlanDraft', 'assignStudentToClass',
  'assignStudentsToClass', 'cancelClassDate', 'closeExamPeriod', 'closeStudentClass', 'closeStudentsInClass',
  'createClass', 'createStudent',
  'deleteClass', 'deleteClassPlan', 'deleteCounselingNote', 'deleteExamPeriod', 'deleteSchoolExam',
  'discardPlanDraft', 'endTempAssignment', 'generateDailyReport', 'generateDailyReports',
  'generateMonthlyReport', 'generateMonthlyReportsBulk', 'getCalendar', 'getClassHomeworkLog',
  'getClassList', 'getClassMembers', 'getClassOverview', 'getClassProgressLog', 'getClassSession',
  'getClassStats', 'getClassTestDetail', 'getClassTests', 'getClassTrend', 'getCounselingNotes',
  'getDailyReportBoard', 'getDailyReportClasses', 'getAgentConversation', 'getExamPeriodDetail', 'getExamPeriods', 'getMakeupSession',
  'getMonthlyReportBoard', 'getPlanBoard', 'getSchoolExams', 'getSchoolOptions',
  'getShellBootstrap', 'getStudent', 'getStudentAttendanceMonth', 'getStudentGrades',
  'getStudentHomework', 'getStudentLessons', 'getStudentList', 'getStudentOverview',
  'getStudentReports', 'listAgentConversations', 'rejectAgentProposal', 'getTodayBoard', 'getTodayClassSession', 'listCounselingNotes',
  'moveStudent', 'moveStudents', 'previewClassStartChange', 'previewGradePromotion',
  'promoteGrades', 'proposeExamGroups', 'removeStudentClass', 'removeTempAssignment',
  'restoreClassDate', 'saveClassPlan', 'saveClassSession', 'saveCounselingNote',
  'saveExamPeriod', 'saveHomeworkChecks', 'saveMakeupSession', 'saveMonthlyReport',
  'saveSchoolExam', 'saveSchoolExamsBatch', 'saveSettings', 'saveTodaySession',
  'setPeriodSuspendedClasses', 'setStudentsStatus', 'updateClass', 'updateLessonAttendance', 'updateMakeupSession', 'updatePlanDraftItem',
  'updateStudent', 'updateStudentClassStart', 'updateTaskStatus'
]);
