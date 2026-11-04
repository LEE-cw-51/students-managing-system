/**
 * AI write actions: tasks (할 일) and counseling notes. Same shape as LMS.AGENT_WRITE_ACTIONS in
 * 07_Agent.js ({ label, preview, run, verify }); each name needs a tool in lib/mcp-tools/write-tasks.js.
 * create_counseling and update_task_status live in 07_Agent.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

(function () {
  var TASK_FIELDS = ['due_date', 'kind', 'title', 'memo', 'student_id', 'class_id', 'status'];
  var TASK_LABELS = { due_date: '예정일', kind: '종류', title: '제목', memo: '메모', student_id: '학생', class_id: '반', status: '상태' };
  var NOTE_FIELDS = ['kind', 'counsel_date', 'title', 'content', 'follow_up_date', 'follow_up_title'];
  var NOTE_LABELS = { kind: '상담 종류', counsel_date: '상담일', title: '제목', content: '내용', follow_up_date: '후속 날짜', follow_up_title: '후속 내용' };

  // Omitted (undefined/null) arguments keep the stored value; '' clears a field.
  function mergeArgs(row, args, keys) {
    var out = {};
    keys.forEach(function (k) {
      out[k] = args && args[k] !== undefined && args[k] !== null ? args[k] : row[k];
    });
    return out;
  }

  function changeList(before, after, keys, labels, show) {
    return keys.filter(function (k) {
      return LMS.toStr(before[k]) !== LMS.toStr(after[k]);
    }).map(function (k) {
      var b = show ? show(k, before[k]) : LMS.toStr(before[k]);
      var a = show ? show(k, after[k]) : LMS.toStr(after[k]);
      return labels[k] + ': ' + (b || '없음') + ' → ' + (a || '없음');
    });
  }

  function requireTask(svc, taskId) {
    var task = LMS.findById(svc.table('Tasks'), 'task_id', taskId);
    if (!task) throw new Error('할 일(' + (LMS.toStr(taskId) || '없음') + ')을 찾을 수 없습니다.');
    if (LMS.toStr(task.source) === 'counseling') throw new Error('상담일지의 후속 할 일입니다. 상담일지(update_counseling)에서 수정해 주세요.');
    return task;
  }

  function requireNote(svc, noteId) {
    var note = LMS.findById(svc.table('CounselingNotes'), 'note_id', noteId);
    if (!note) throw new Error('상담일지(' + (LMS.toStr(noteId) || '없음') + ')를 찾을 수 없습니다.');
    return note;
  }

  function checkTaskLinks(svc, input) {
    if (input.student_id && !LMS.findById(svc.table('Students'), 'student_id', input.student_id)) throw new Error('학생 정보를 찾을 수 없습니다.');
    if (input.class_id && !LMS.findById(svc.table('Classes'), 'class_id', input.class_id)) throw new Error('반 정보를 찾을 수 없습니다.');
  }

  function taskWho(svc, t) {
    var parts = [];
    if (t.student_id) parts.push(LMS.agentStudentName(svc.table, t.student_id));
    if (t.class_id) parts.push(LMS.agentClassName(svc.table, t.class_id));
    return parts.join(' · ');
  }

  function taskShow(svc) {
    return function (k, v) {
      if (!v) return '';
      if (k === 'student_id') return LMS.agentStudentName(svc.table, v);
      if (k === 'class_id') return LMS.agentClassName(svc.table, v);
      return LMS.toStr(v);
    };
  }

  function taskMatches(row, args) {
    return Boolean(row) && TASK_FIELDS.every(function (k) { return LMS.toStr(row[k]) === LMS.toStr(args[k]); });
  }

  LMS.registerAgentWriteActions({
    create_task: {
      label: '할 일 추가',
      preview: function (svc, args) {
        var input = LMS.validateTaskInput(Object.assign({}, args, { task_id: '' }), false);
        checkTaskLinks(svc, input);
        delete input.task_id;
        delete input.source;
        var who = taskWho(svc, input);
        return {
          args: input,
          target: { student_id: input.student_id, student_name: input.student_id ? LMS.agentStudentName(svc.table, input.student_id) : '', date: input.due_date },
          before: '',
          after: input.title,
          text: (who ? who + ' · ' : '') + input.due_date + ' 할 일 추가 「' + input.title + '」' + (input.status !== '예정' ? ' (' + input.status + ')' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.saveTask(args);
      },
      verify: function (svc, args, ran) {
        var row = ran && ran.task_id ? LMS.findById(svc.table('Tasks'), 'task_id', ran.task_id) : null;
        return { ok: taskMatches(row, args), after: row ? row.task_id : '' };
      }
    },

    update_task: {
      label: '할 일 수정',
      preview: function (svc, args) {
        var task = requireTask(svc, LMS.toStr(args && args.task_id));
        var merged = mergeArgs(task, args, TASK_FIELDS);
        merged.task_id = LMS.toStr(task.task_id);
        var input = LMS.validateTaskInput(merged, true);
        checkTaskLinks(svc, input);
        delete input.source;
        var changes = changeList(task, input, TASK_FIELDS, TASK_LABELS, taskShow(svc));
        if (!changes.length) throw new Error('바뀌는 내용이 없습니다.');
        var who = taskWho(svc, task);
        return {
          args: input,
          target: { student_id: input.student_id, student_name: input.student_id ? LMS.agentStudentName(svc.table, input.student_id) : '', date: input.due_date },
          before: LMS.toStr(task.title) + ' (' + LMS.toStr(task.status) + ')',
          after: input.title + ' (' + input.status + ')',
          text: (who ? who + ' · ' : '') + '할 일 「' + LMS.toStr(task.title) + '」 수정: ' + changes.join(', ')
        };
      },
      run: function (svc, args) {
        return svc.api.saveTask(args);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('Tasks'), 'task_id', args.task_id);
        return { ok: taskMatches(row, args), after: row ? LMS.toStr(row.title) + ' (' + LMS.toStr(row.status) + ')' : '' };
      }
    },

    delete_task: {
      label: '할 일 삭제',
      preview: function (svc, args) {
        var task = requireTask(svc, LMS.toStr(args && args.task_id));
        var who = taskWho(svc, task);
        return {
          args: { task_id: LMS.toStr(task.task_id) },
          target: { student_id: LMS.toStr(task.student_id), student_name: task.student_id ? LMS.agentStudentName(svc.table, task.student_id) : '', date: LMS.toStr(task.due_date) },
          before: LMS.toStr(task.title),
          after: '',
          text: '할 일 「' + LMS.toStr(task.title) + '」 삭제 (' + [LMS.toStr(task.due_date), LMS.toStr(task.status), who].filter(Boolean).join(' · ') + ')'
        };
      },
      run: function (svc, args) {
        return svc.api.deleteTask(args.task_id);
      },
      verify: function (svc, args) {
        var gone = !LMS.findById(svc.table('Tasks'), 'task_id', args.task_id);
        return { ok: gone, after: gone ? '삭제됨' : '남아 있음' };
      }
    },

    update_counseling: {
      label: '상담 기록 수정',
      preview: function (svc, args) {
        var note = requireNote(svc, LMS.toStr(args && args.note_id));
        var merged = mergeArgs(note, args, NOTE_FIELDS);
        merged.note_id = LMS.toStr(note.note_id);
        merged.student_id = LMS.toStr(note.student_id);
        var input = LMS.validateCounselingNoteInput(merged, true);
        if (!LMS.findById(svc.table('Students'), 'student_id', input.student_id)) throw new Error('학생 정보를 찾을 수 없습니다.');
        var changes = changeList(note, input, NOTE_FIELDS, NOTE_LABELS, function (k, v) {
          var s = LMS.toStr(v);
          return k === 'content' && s.length > 40 ? s.slice(0, 40) + '…' : s;
        });
        if (!changes.length) throw new Error('바뀌는 내용이 없습니다.');
        var name = LMS.agentStudentName(svc.table, input.student_id);
        var follow = '';
        if (LMS.toStr(note.follow_up_date) && !input.follow_up_date) follow = ' (예정인 후속 할 일은 취소됩니다)';
        else if (!LMS.toStr(note.follow_up_date) && input.follow_up_date) follow = ' (후속 할 일 ' + input.follow_up_date + ' 생성)';
        return {
          args: input,
          target: { student_id: input.student_id, student_name: name, date: input.counsel_date },
          before: LMS.toStr(note.content),
          after: input.content,
          text: name + ' · ' + LMS.toStr(note.counsel_date) + ' 상담 기록 수정: ' + changes.join(', ') + follow
        };
      },
      run: function (svc, args) {
        return svc.api.saveCounselingNote(args);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('CounselingNotes'), 'note_id', args.note_id);
        var ok = Boolean(row) && NOTE_FIELDS.every(function (k) { return LMS.toStr(row[k]) === LMS.toStr(args[k]); });
        return { ok: ok, after: row ? LMS.toStr(row.content) : '' };
      }
    },

    delete_counseling: {
      label: '상담 기록 삭제',
      preview: function (svc, args) {
        var note = requireNote(svc, LMS.toStr(args && args.note_id));
        var name = LMS.agentStudentName(svc.table, note.student_id);
        var task = note.follow_up_task_id ? LMS.findById(svc.table('Tasks'), 'task_id', note.follow_up_task_id) : null;
        var follow = task && LMS.toStr(task.status) === '예정' ? ', 후속 할 일 「' + LMS.toStr(task.title) + '」(' + LMS.toStr(task.due_date) + ') 취소' : '';
        return {
          args: { note_id: LMS.toStr(note.note_id) },
          target: { student_id: LMS.toStr(note.student_id), student_name: name, date: LMS.toStr(note.counsel_date) },
          before: LMS.toStr(note.content),
          after: '',
          text: name + ' · ' + LMS.toStr(note.counsel_date) + ' ' + LMS.toStr(note.kind) + ' 상담 기록' + (note.title ? ' 「' + LMS.toStr(note.title) + '」' : '') + ' 삭제' + follow
        };
      },
      run: function (svc, args) {
        return svc.api.deleteCounselingNote(args.note_id);
      },
      verify: function (svc, args) {
        var gone = !LMS.findById(svc.table('CounselingNotes'), 'note_id', args.note_id);
        return { ok: gone, after: gone ? '삭제됨' : '남아 있음' };
      }
    }
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
