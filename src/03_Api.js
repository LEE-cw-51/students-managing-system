/**
 * google.script.run public API. Private helpers end with _.
 */
function wrap_(fn) {
  try {
    assertAllowed_();
    return { ok: true, data: fn(getService_()) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function assertAllowed_() {
  var email = '';
  var owner = '';
  try { email = (Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  try { owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e2) {}
  if (!email) email = owner;
  var allowed = '';
  try {
    var settings = getService_().getSettings();
    allowed = LMS.toStr(settings.allowed_emails);
  } catch (e3) {}
  if (!allowed) return;
  var list = allowed.split(/[,;\s]+/).map(function (s) { return s.toLowerCase(); }).filter(Boolean);
  if (list.indexOf(email) === -1 && email !== owner) {
    throw new Error('접근 권한이 없습니다.');
  }
}

function getBootstrap() { return wrap_(function (api) { return api.getBootstrap(); }); }
function getDashboard(date) { return wrap_(function (api) { return api.getDashboard(date); }); }

function getStudents(filter) { return wrap_(function (api) { return api.getStudents(filter || {}); }); }
function getStudent(studentId) { return wrap_(function (api) { return api.getStudent(studentId); }); }
function createStudent(data) { return wrap_(function (api) { return api.createStudent(data); }); }
function updateStudent(data) { return wrap_(function (api) { return api.updateStudent(data); }); }
function archiveStudent(studentId) { return wrap_(function (api) { return api.archiveStudent(studentId); }); }

function getClasses(filter) { return wrap_(function (api) { return api.getClasses(filter || {}); }); }
function getClass(classId) { return wrap_(function (api) { return api.getClass(classId); }); }
function createClass(data) { return wrap_(function (api) { return api.createClass(data); }); }
function updateClass(data) { return wrap_(function (api) { return api.updateClass(data); }); }
function closeClass(classId) { return wrap_(function (api) { return api.closeClass(classId); }); }

function getStudentClasses(studentId) { return wrap_(function (api) { return api.getStudentClasses(studentId); }); }
function getClassRoster(classId) { return wrap_(function (api) { return api.getClassRoster(classId); }); }
function assignStudentToClass(data) { return wrap_(function (api) { return api.assignStudentToClass(data); }); }
function closeStudentClass(data) { return wrap_(function (api) { return api.closeStudentClass(data); }); }
function moveStudent(data) { return wrap_(function (api) { return api.moveStudent(data); }); }

function getLessons(date, classId) { return wrap_(function (api) { return api.getLessons(date, classId); }); }
function getStudentLessons(studentId, startDate, endDate) {
  return wrap_(function (api) { return api.getStudentLessons(studentId, startDate, endDate); });
}
function getLesson(lessonId) { return wrap_(function (api) { return api.getLesson(lessonId); }); }
function saveLesson(data) { return wrap_(function (api) { return api.saveLesson(data); }); }
function saveLessonsBatch(items) { return wrap_(function (api) { return api.saveLessonsBatch(items); }); }
function updateLesson(data) { return wrap_(function (api) { return api.updateLesson(data); }); }
function getTodayClassSession(date, classId) {
  return wrap_(function (api) { return api.getTodayClassSession(date, classId); });
}

function generateDailyReport(lessonId) { return wrap_(function (api) { return api.generateDailyReport(lessonId); }); }
function generateDailyReports(date, classId) {
  return wrap_(function (api) { return api.generateDailyReports(date, classId); });
}
function getMonthlyStats(studentId, year, month) {
  return wrap_(function (api) { return api.getMonthlyStats(studentId, year, month); });
}
function generateMonthlyReport(studentId, year, month) {
  return wrap_(function (api) { return api.generateMonthlyReport(studentId, year, month); });
}
function saveMonthlyReport(data) { return wrap_(function (api) { return api.saveMonthlyReport(data); }); }

function getSettings() { return wrap_(function (api) { return api.getSettings(); }); }
function saveSettings(map) { return wrap_(function (api) { return api.saveSettings(map); }); }
function saveSetting(key, value) { return wrap_(function (api) { return api.saveSetting(key, value); }); }
function getClassStats(classId, year, month) {
  return wrap_(function (api) { return api.getClassStats(classId, year, month); });
}
