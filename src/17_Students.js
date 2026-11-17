/**
 * Students: list/get/create/update, archive, grade promotion, bulk status.
 * Assignment lifecycle hooks (assignFirst, endForWithdrawal, followEnrollment) stay on
 * createAssignments; this module only calls them.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireStudent, assignments, today().
 * Callers run commands inside the service transaction.
 */
LMS.createStudents = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var assignments = ctx.assignments;

  function enrichStudent(student) {
    var classes = table('Classes');
    var history = assignments.history(student.student_id).map(function (rel) {
      var cls = LMS.findById(classes, 'class_id', rel.class_id);
      return {
        id: rel.id,
        class_id: rel.class_id,
        class_name: cls ? cls.class_name : rel.class_id,
        start_date: rel.start_date,
        end_date: rel.end_date,
        status: rel.status,
        assignment_type: LMS.toStr(rel.assignment_type) || '정규'
      };
    });
    var attendingIds = {};
    assignments.attending(student.student_id).forEach(function (r) { attendingIds[LMS.toStr(r.id)] = true; });
    var current = history.filter(function (h) { return attendingIds[LMS.toStr(h.id)]; });
    return Object.assign({}, student, {
      current_classes: current,
      class_history: history
    });
  }

  function getStudents(filter) {
    filter = filter || {};
    var students = table('Students');
    var q = LMS.toStr(filter.query).toLowerCase();
    return students.filter(function (s) {
      if (filter.status && LMS.toStr(s.status) !== filter.status) return false;
      if (filter.grade && LMS.toStr(s.grade) !== filter.grade) return false;
      if (filter.classId) {
        var ok = assignments.attending(s.student_id).some(function (r) {
          return LMS.toStr(r.class_id) === LMS.toStr(filter.classId);
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
    return enrichStudent(ctx.requireStudent(studentId));
  }

  function createStudent(data) {
    var input = LMS.validateStudentInput(data, false);
    var id = ctx.nextIds('STU', 1)[0];
    var ts = ctx.now();
    var row = {
      student_id: id,
      name: input.name,
      grade: input.grade,
      school: input.school,
      student_phone: input.student_phone,
      parent_phone: input.parent_phone,
      enrollment_date: input.enrollment_date || ctx.today(),
      status: input.status,
      memo: input.memo,
      created_at: ts,
      updated_at: ts
    };
    var rows = table('Students');
    rows.push(row);
    saveTable('Students', rows);
    if (data && data.class_id) {
      assignments.assignFirst({
        student_id: id,
        class_id: data.class_id,
        start_date: row.enrollment_date
      });
    }
    return enrichStudent(row);
  }

  function updateStudent(data) {
    var input = LMS.validateStudentInput(data, true);
    var rows = table('Students');
    var row = LMS.findById(rows, 'student_id', input.student_id);
    if (!row) throw new Error('학생 정보를 찾을 수 없습니다.');
    var withdrawing = input.status === '퇴원' && LMS.toStr(row.status) !== '퇴원';
    var prevEnrollment = LMS.toStr(row.enrollment_date);
    row.name = input.name;
    row.grade = input.grade;
    row.school = input.school;
    row.student_phone = input.student_phone;
    row.parent_phone = input.parent_phone;
    row.enrollment_date = input.enrollment_date || row.enrollment_date;
    row.status = input.status;
    row.memo = input.memo;
    row.updated_at = ctx.now();
    saveTable('Students', rows);
    if (withdrawing) assignments.endForWithdrawal(row.student_id);
    var startSync = null;
    if (data && data.sync_class_start && prevEnrollment && LMS.toStr(row.enrollment_date) !== prevEnrollment) {
      startSync = assignments.followEnrollment(row.student_id, prevEnrollment, LMS.toStr(row.enrollment_date));
    }
    return Object.assign(enrichStudent(row), { class_start_sync: startSync });
  }

  function archiveStudent(studentId) {
    return updateStudent(Object.assign({}, ctx.requireStudent(studentId), { status: '퇴원' }));
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
      var list = groups[from] || [];
      items.push({
        from_grade: from,
        to_grade: to,
        count: list.length,
        students: list
      });
    });
    var skipped = (groups['고3'] || []).concat(groups['기타'] || []);
    var total = items.reduce(function (n, item) { return n + item.count; }, 0);
    return { total: total, items: items, skipped: skipped };
  }

  function promoteGrades() {
    var preview = previewGradePromotion();
    var rows = table('Students');
    var ts = ctx.now();
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
  }

  function getStudentClasses(studentId) {
    ctx.requireStudent(studentId);
    return enrichStudent(ctx.requireStudent(studentId)).class_history;
  }

  /** Change the status of several students; 퇴원 ends their assignments as updateStudent does. */
  function setStudentsStatus(data) {
    data = data || {};
    var status = LMS.assertEnum(data.status, LMS.STUDENT_STATUS, '학생 상태');
    var ids = LMS.uniqueIds(data.student_ids);
    if (!ids.length) throw new Error('상태를 바꿀 학생을 골라 주세요.');
    var done = assignments.forEachStudent(ids, '바꾸지 않았습니다.', function (sid) {
      return updateStudent(Object.assign({}, ctx.requireStudent(sid), { status: status }));
    });
    return { count: done.length };
  }

  return {
    getStudents: getStudents,
    getStudent: getStudent,
    createStudent: createStudent,
    updateStudent: updateStudent,
    archiveStudent: archiveStudent,
    previewGradePromotion: previewGradePromotion,
    promoteGrades: promoteGrades,
    getStudentClasses: getStudentClasses,
    setStudentsStatus: setStudentsStatus
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
