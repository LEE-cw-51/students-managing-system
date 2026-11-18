/**
 * Makeup sessions (MakeupSessions): create/update/cancel and calendar title helpers.
 * Calendar event composition (regular + makeup) lives in `20_Calendar.js`;
 * this module owns MakeupSessions rows. Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireStudent, requireClass.
 * Callers run commands inside the service transaction.
 */
LMS.createMakeup = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function makeupTitle(row, cls, student) {
    if (LMS.toStr(row.title)) return LMS.toStr(row.title);
    if (row.kind === '반') return (cls && cls.class_name ? cls.class_name + ' 보강' : '반 보강');
    return (student && student.name ? student.name + ' 보강' : '개인 보강');
  }

  function getMakeupSession(makeupId) {
    var row = LMS.findById(table('MakeupSessions'), 'makeup_id', makeupId);
    if (!row) throw new Error('보강 일정을 찾을 수 없습니다.');
    return row;
  }

  function makeupRecord(input, studentId, makeupId, ts, prev) {
    return {
      makeup_id: makeupId,
      makeup_date: input.makeup_date,
      start_time: input.start_time,
      end_time: input.end_time,
      kind: input.kind,
      class_id: input.class_id,
      student_id: studentId || '',
      title: input.title,
      memo: input.memo,
      status: input.status,
      created_at: prev && prev.created_at ? prev.created_at : ts,
      updated_at: ts
    };
  }

  function saveMakeupSession(data) {
    var isUpdate = !LMS.isBlank(data && data.makeup_id);
    var input = LMS.validateMakeupSessionInput(data, isUpdate);
    if (input.class_id) ctx.requireClass(input.class_id);
    input.student_ids.forEach(function (id) { ctx.requireStudent(id); });
    var rows = table('MakeupSessions');
    var ts = ctx.now();
    if (isUpdate) {
      var prev = LMS.findById(rows, 'makeup_id', input.makeup_id);
      if (!prev) throw new Error('보강 일정을 찾을 수 없습니다.');
      if (LMS.toStr(prev.student_id) !== input.student_id) throw new Error('다른 학생의 보강으로 바꿀 수 없습니다.');
      var updated = makeupRecord(input, input.student_id, prev.makeup_id, ts, prev);
      Object.keys(updated).forEach(function (k) {
        prev[k] = updated[k];
      });
      saveTable('MakeupSessions', rows);
      return prev;
    }
    if (input.kind === '학생' && input.student_ids.length > 1) {
      var ids = ctx.nextIds('MKP', input.student_ids.length);
      var created = input.student_ids.map(function (sid, i) {
        var row = makeupRecord(input, sid, ids[i], ts);
        rows.push(row);
        return row;
      });
      saveTable('MakeupSessions', rows);
      return { sessions: created, created_count: created.length };
    }
    var row = makeupRecord(input, input.student_id, ctx.nextIds('MKP', 1)[0], ts);
    rows.push(row);
    saveTable('MakeupSessions', rows);
    return row;
  }

  function updateMakeupSession(data) {
    if (LMS.isBlank(data && data.makeup_id)) {
      throw new Error('보강 일정을 찾을 수 없습니다.');
    }
    return saveMakeupSession(data);
  }

  function cancelMakeupSession(makeupId) {
    var row = getMakeupSession(makeupId);
    return saveMakeupSession(Object.assign({}, row, { status: '취소' }));
  }

  return {
    makeupTitle: makeupTitle,
    getMakeupSession: getMakeupSession,
    saveMakeupSession: saveMakeupSession,
    updateMakeupSession: updateMakeupSession,
    cancelMakeupSession: cancelMakeupSession
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
