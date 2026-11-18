/**
 * Classes and roster: create/update/close/delete and members on a date.
 * Assignment lifecycle hooks (endForClassClose, dropForClasses, syncExamPrep) stay on
 * createAssignments; examPeriods.forgetClass is called on delete.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireClass, assignments, examPeriods (forgetClass).
 * Callers run commands inside the service transaction.
 */
LMS.createClasses = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var assignments = ctx.assignments;

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

  /** 반 구성원 on the date (today when blank). */
  function getClassRoster(classId, date) {
    ctx.requireClass(classId);
    return assignments.members(classId, date);
  }

  function getClass(classId) {
    var cls = ctx.requireClass(classId);
    var roster = getClassRoster(classId);
    return Object.assign({}, cls, { students: roster, student_count: roster.length });
  }

  function newUnitId_() {
    return ctx.nextIds(LMS.PREFIX.unit, 1)[0];
  }

  function createClass(data) {
    var input = LMS.validateClassInput(data, false);
    delete input.schedule_from_legacy;
    if (input.curriculum) input.curriculum = LMS.normalizeCurriculum(input.curriculum, newUnitId_);
    var id = ctx.nextIds('CLS', 1)[0];
    var ts = ctx.now();
    var row = Object.assign({}, input, {
      class_id: id,
      textbook_history: LMS.initialTextbookHistory(input.textbook, data.textbook_started_on),
      created_at: ts,
      updated_at: ts
    });
    var rows = table('Classes');
    rows.push(row);
    saveTable('Classes', rows);
    return row;
  }

  function updateClass(data) {
    var input = LMS.validateClassInput(data, true);
    var rows = table('Classes');
    var row = LMS.findById(rows, 'class_id', input.class_id);
    if (!row) throw new Error('반 정보를 찾을 수 없습니다.');
    if (input.curriculum) input.curriculum = LMS.normalizeCurriculum(input.curriculum, newUnitId_);
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
    var closing = input.status === '종료' && LMS.toStr(row.status) !== '종료';
    var prevTextbook = LMS.toStr(row.textbook);
    var prevHistory = row.textbook_history;
    var sentTextbook = Object.prototype.hasOwnProperty.call(data, 'textbook') && data.textbook !== undefined;
    Object.keys(input).forEach(function (k) {
      if (k === 'class_id') return;
      row[k] = input[k];
    });
    if (sentTextbook) {
      var applied = LMS.applyTextbookChange(prevTextbook, prevHistory, input.textbook, data.textbook_started_on);
      row.textbook = applied.textbook;
      row.textbook_history = applied.textbook_history;
    } else {
      row.textbook = prevTextbook;
      row.textbook_history = prevHistory;
    }
    row.updated_at = ctx.now();
    saveTable('Classes', rows);
    if (closing && LMS.toStr(row.class_type) !== '시험대비') assignments.endForClassClose(row.class_id);
    return row;
  }

  function closeClass(classId) {
    var cls = ctx.requireClass(classId);
    return updateClass(Object.assign({}, cls, { status: '종료' }));
  }

  /** Delete a class made by mistake (no lessons or homework checks), with its assignments and plans. */
  function deleteClass(classId) {
    var cls = ctx.requireClass(classId);
    var cid = LMS.toStr(cls.class_id);
    var mine = function (r) { return LMS.toStr(r.class_id) === cid; };
    var notMine = function (r) { return !mine(r); };
    var items = table('HomeworkItems');
    var itemIds = items.filter(mine).map(function (r) { return LMS.toStr(r.item_id); });
    var checks = table('HomeworkChecks');
    var used = table('Lessons').some(mine) ||
      checks.some(function (c) { return itemIds.indexOf(LMS.toStr(c.item_id)) !== -1; });
    if (used) throw new Error('수업 기록이 있는 반은 삭제할 수 없습니다. ‘정보 수정 > 상태: 종료’를 쓰세요.');
    var rels = table('StudentClasses');
    var source = rels.some(function (r) {
      return LMS.toStr(r.status) === '임시' && LMS.toStr(r.source_class_id) === cid && !mine(r);
    });
    if (source) throw new Error('시험대비 편성의 원래 반으로 쓰이는 반은 삭제할 수 없습니다. 시험대비 기간에서 먼저 배정을 바꿔 주세요.');
    var changes = rels.filter(function (r) { return mine(r) && LMS.toStr(r.status) !== '임시'; }).map(function (r) {
      return { student_id: r.student_id, start: LMS.toStr(r.start_date), end: LMS.toStr(r.end_date) };
    });
    assignments.dropForClasses([cid]);
    saveTable('Classes', table('Classes').filter(notMine));
    saveTable('ClassSessions', table('ClassSessions').filter(notMine));
    saveTable('ClassSessionNotices', table('ClassSessionNotices').filter(notMine));
    saveTable('HomeworkItems', items.filter(notMine));
    saveTable('HomeworkChecks', checks.filter(function (c) { return itemIds.indexOf(LMS.toStr(c.item_id)) === -1; }));
    saveTable('ClassPlans', table('ClassPlans').filter(notMine));
    saveTable('PlanDrafts', table('PlanDrafts').filter(notMine));
    saveTable('MakeupSessions', table('MakeupSessions').filter(notMine));
    var ts = ctx.now();
    var taskRows = table('Tasks');
    taskRows.forEach(function (t) {
      if (!mine(t)) return;
      t.class_id = '';
      t.updated_at = ts;
    });
    saveTable('Tasks', taskRows);
    ctx.examPeriods.forgetClass(cls);
    if (LMS.toStr(cls.class_type) !== '시험대비') assignments.syncExamPrep(changes);
    return true;
  }

  return {
    getClasses: getClasses,
    getClass: getClass,
    createClass: createClass,
    updateClass: updateClass,
    closeClass: closeClass,
    deleteClass: deleteClass,
    getClassRoster: getClassRoster
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
