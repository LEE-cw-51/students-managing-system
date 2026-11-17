/**
 * Counseling notes (CounselingNotes): list/get/save/delete and the follow-up task that
 * moves with a note. Follow-up Tasks rows are written here when the note owns them;
 * manual task edits stay in the service task cluster. Terms follow GLOSSARY.md (할 일,
 * 상담 후속 할 일 보호). Server-only: reads tables, so it is not imported by the browser.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireStudent.
 * Callers run commands inside the service transaction.
 */
LMS.createCounseling = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function getCounselingNotes(studentId) {
    ctx.requireStudent(studentId);
    var tasks = table('Tasks');
    return table('CounselingNotes').filter(function (row) {
      return LMS.toStr(row.student_id) === LMS.toStr(studentId);
    }).map(function (row) {
      var task = row.follow_up_task_id ? LMS.findById(tasks, 'task_id', row.follow_up_task_id) : null;
      return Object.assign({}, row, { follow_up_status: task ? LMS.toStr(task.status) : '' });
    }).sort(function (a, b) {
      var d = LMS.toStr(b.counsel_date).localeCompare(LMS.toStr(a.counsel_date));
      if (d) return d;
      return LMS.toStr(b.updated_at).localeCompare(LMS.toStr(a.updated_at));
    });
  }

  /**
   * Keep the note's follow-up as a 할 일: create or move it while open, cancel it when the
   * follow-up is cleared. A finished task is left alone. Returns the task id ('' if none).
   */
  function syncFollowUpTask_(note) {
    var tasks = table('Tasks');
    var task = note.follow_up_task_id ? LMS.findById(tasks, 'task_id', note.follow_up_task_id) : null;
    var ts = ctx.now();
    if (!note.follow_up_date) {
      if (task && LMS.toStr(task.status) === '예정') {
        task.status = '취소';
        task.updated_at = ts;
        saveTable('Tasks', tasks);
      }
      return '';
    }
    var fields = {
      due_date: note.follow_up_date,
      kind: note.kind === '학부모' ? 'counsel_parent' : 'counsel_student',
      title: note.follow_up_title,
      memo: '상담일지 ' + note.counsel_date + (note.title ? ' · ' + note.title : ''),
      student_id: note.student_id,
      class_id: '',
      source: 'counseling'
    };
    if (task && LMS.toStr(task.status) === '완료') return task.task_id;
    if (task) {
      Object.keys(fields).forEach(function (k) { task[k] = fields[k]; });
      task.status = '예정';
      task.updated_at = ts;
    } else {
      task = Object.assign({
        task_id: ctx.nextIds(LMS.PREFIX.task, 1)[0],
        status: '예정',
        created_at: ts,
        updated_at: ts
      }, fields);
      tasks.push(task);
    }
    saveTable('Tasks', tasks);
    return task.task_id;
  }

  function saveCounselingNote(data) {
    var isUpdate = !LMS.isBlank(data && data.note_id);
    var input = LMS.validateCounselingNoteInput(data, isUpdate);
    ctx.requireStudent(input.student_id);
    var rows = table('CounselingNotes');
    var ts = ctx.now();
    var row;
    if (isUpdate) {
      row = LMS.findById(rows, 'note_id', input.note_id);
      if (!row) throw new Error('상담일지를 찾을 수 없습니다.');
      if (LMS.toStr(row.student_id) !== input.student_id) throw new Error('다른 학생의 상담일지는 수정할 수 없습니다.');
      row.kind = input.kind;
      row.counsel_date = input.counsel_date;
      row.title = input.title;
      row.content = input.content;
      row.updated_at = ts;
    } else {
      row = {
        note_id: ctx.nextIds('NTS', 1)[0],
        student_id: input.student_id,
        kind: input.kind,
        counsel_date: input.counsel_date,
        title: input.title,
        content: input.content,
        follow_up_task_id: '',
        created_at: ts,
        updated_at: ts
      };
      rows.push(row);
    }
    row.follow_up_date = input.follow_up_date;
    row.follow_up_title = input.follow_up_title;
    row.follow_up_task_id = syncFollowUpTask_(row);
    saveTable('CounselingNotes', table('CounselingNotes'));
    return row;
  }

  function deleteCounselingNote(noteId) {
    var rows = table('CounselingNotes');
    var prev = LMS.findById(rows, 'note_id', noteId);
    if (!prev) throw new Error('상담일지를 찾을 수 없습니다.');
    var next = rows.filter(function (row) {
      return LMS.toStr(row.note_id) !== LMS.toStr(noteId);
    });
    syncFollowUpTask_({ follow_up_date: '', follow_up_task_id: prev.follow_up_task_id });
    saveTable('CounselingNotes', next);
    return { note_id: prev.note_id, deleted: true };
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
    if (studentId) ctx.requireStudent(studentId);
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

  return {
    getCounselingNotes: getCounselingNotes,
    saveCounselingNote: saveCounselingNote,
    deleteCounselingNote: deleteCounselingNote,
    listCounselingNotes: listCounselingNotes
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
