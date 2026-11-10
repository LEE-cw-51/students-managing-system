/**
 * AI write actions: tasks (할 일) and counseling notes. Definition shape: src/08_AgentActions.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../00_Core.js');
}

(function () {
  var DATE = LMS.AGENT_PARAM.date;
  var TASK_ID = { type: 'string', description: '할 일 ID (예: TSK-0003). get_today_board 또는 get_student_profile에서 찾습니다.' };
  var NOTE_ID = { type: 'string', description: '상담일지 ID (예: NTS-0004). get_counseling_notes 또는 get_student_profile에서 찾습니다.' };
  var TASK_KIND = { type: 'string', enum: LMS.TASK_KIND, description: '종류: counsel_parent(학부모 상담), counsel_student(학생 상담), homework_check(숙제 확인), admin(행정), other(기타)' };

  var TASK_PARAMS = {
    due_date: DATE('예정일'),
    kind: TASK_KIND,
    title: { type: 'string', description: '할 일 제목' },
    memo: { type: 'string', description: '메모' },
    student_id: { type: 'string', description: '관련 학생 ID (빈 문자열이면 연결 해제)' },
    class_id: { type: 'string', description: '관련 반 ID (빈 문자열이면 연결 해제)' },
    status: { type: 'string', enum: LMS.TASK_STATUS, description: '예정, 완료, 취소' }
  };
  var TASK_FIELDS = Object.keys(TASK_PARAMS);
  var TASK_LABELS = { due_date: '예정일', kind: '종류', title: '제목', memo: '메모', student_id: '학생', class_id: '반', status: '상태' };
  var NOTE_PARAMS = {
    kind: { type: 'string', enum: LMS.COUNSEL_KIND, description: '상담 대상: 학생 또는 학부모' },
    counsel_date: DATE('상담일'),
    title: { type: 'string', description: '짧은 제목' },
    content: { type: 'string', description: '상담 내용 (전체를 새 내용으로 바꿈)' },
    follow_up_date: DATE('후속 조치 날짜 (빈 문자열이면 후속 조치 없음)'),
    follow_up_title: { type: 'string', description: '후속 조치 내용' }
  };
  var NOTE_FIELDS = Object.keys(NOTE_PARAMS);
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

  var actions = {
    create_counseling: {
      label: '상담 기록',
      progress: '상담 기록 준비 중',
      description: '학생 상담 기록을 추가합니다. 후속 조치 날짜를 넣으면 그날 할 일이 함께 생깁니다.',
      surfaces: ['assistant', 'mcp'],
      destructive: false,
      parameters: {
        type: 'object',
        properties: {
          student_id: LMS.AGENT_PARAM.studentId,
          kind: { type: 'string', enum: LMS.COUNSEL_KIND, description: '상담 대상: 학생 또는 학부모' },
          counsel_date: DATE('상담일'),
          title: { type: 'string', description: '짧은 제목' },
          content: { type: 'string', description: '상담 내용 (강사가 말한 내용을 그대로 정리)' },
          follow_up_date: DATE('후속 조치 날짜 (선택)'),
          follow_up_title: { type: 'string', description: '후속 조치 내용 (선택)' }
        },
        required: ['student_id', 'kind', 'counsel_date', 'content']
      },
      preview: function (svc, args) {
        args = args || {};
        var input = LMS.validateCounselingNoteInput({
          student_id: args.student_id,
          kind: LMS.toStr(args.kind) || '학생',
          counsel_date: args.counsel_date,
          title: args.title,
          content: args.content,
          follow_up_date: args.follow_up_date,
          follow_up_title: args.follow_up_title
        }, false);
        if (!LMS.findById(svc.table('Students'), 'student_id', input.student_id)) throw new Error('학생 정보를 찾을 수 없습니다.');
        var name = LMS.agentStudentName(svc.table, input.student_id);
        delete input.note_id;
        var follow = input.follow_up_date ? ' (후속: ' + input.follow_up_date + ' ' + input.follow_up_title + ')' : '';
        return {
          args: input,
          target: { student_id: input.student_id, student_name: name, date: input.counsel_date },
          before: '',
          after: input.content,
          text: name + ' · ' + input.counsel_date + ' ' + input.kind + ' 상담 기록 추가' + (input.title ? ' 「' + input.title + '」' : '') + follow
        };
      },
      run: function (svc, args) {
        return svc.api.saveCounselingNote(args);
      },
      verify: function (svc, args, ran) {
        var id = ran && ran.note_id;
        var row = id ? LMS.findById(svc.table('CounselingNotes'), 'note_id', id) : null;
        return { ok: Boolean(row) && LMS.toStr(row.content) === LMS.toStr(args.content), after: id || '' };
      }
    },

    update_task_status: {
      label: '할 일 상태',
      progress: '할 일 변경 준비 중',
      description: '할 일의 상태를 바꿉니다(완료 처리 등). task_id는 get_student_profile 또는 get_today_board에서 찾습니다.',
      surfaces: ['assistant', 'mcp'],
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '할 일 ID (예: TSK-0003)' },
          status: { type: 'string', enum: LMS.TASK_STATUS, description: '예정, 완료, 취소' }
        },
        required: ['task_id', 'status']
      },
      preview: function (svc, args) {
        var taskId = LMS.toStr(args && args.task_id);
        var status = LMS.assertEnum(LMS.toStr(args && args.status), LMS.TASK_STATUS, '할 일 상태');
        var task = LMS.findById(svc.table('Tasks'), 'task_id', taskId);
        if (!task) throw new Error('할 일(' + (taskId || '없음') + ')을 찾을 수 없습니다.');
        var who = task.student_id ? LMS.agentStudentName(svc.table, task.student_id) + ' · ' : '';
        return {
          args: { task_id: taskId, status: status },
          target: { student_id: LMS.toStr(task.student_id), student_name: who ? LMS.agentStudentName(svc.table, task.student_id) : '', date: LMS.toStr(task.due_date) },
          before: LMS.toStr(task.status),
          after: status,
          text: who + '할 일 「' + LMS.toStr(task.title) + '」: ' + LMS.toStr(task.status) + ' → ' + status
        };
      },
      run: function (svc, args) {
        return svc.api.updateTaskStatus(args.task_id, args.status);
      },
      verify: function (svc, args) {
        var task = LMS.findById(svc.table('Tasks'), 'task_id', args.task_id);
        var after = task ? LMS.toStr(task.status) : '';
        return { ok: after === args.status, after: after };
      }
    },

    create_task: {
      label: '할 일 추가',
      progress: '할 일 추가 준비 중',
      description: '할 일을 새로 추가합니다. 학생이나 반과 묶을 수 있습니다.',
      destructive: false,
      parameters: {
        type: 'object',
        properties: {
          due_date: DATE('예정일'),
          kind: TASK_KIND,
          title: { type: 'string', description: '할 일 제목' },
          memo: { type: 'string', description: '메모 (선택)' },
          student_id: Object.assign({}, LMS.AGENT_PARAM.studentId, { description: '관련 학생 ID (선택). search_students로 찾습니다.' }),
          class_id: Object.assign({}, LMS.AGENT_PARAM.classId, { description: '관련 반 ID (선택, list_classes로 찾음)' }),
          status: { type: 'string', enum: LMS.TASK_STATUS, description: '상태 (기본 예정)' }
        },
        required: ['due_date', 'kind', 'title']
      },
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
      progress: '할 일 수정 준비 중',
      description: '직접 만든 할 일의 날짜·제목·메모·종류·학생·반·상태를 고칩니다. 넣지 않은 항목은 그대로 두고, 빈 문자열은 그 항목을 비웁니다. 상담일지에서 생긴 후속 할 일은 update_counseling으로 고칩니다. 상태만 바꿀 때는 update_task_status를 씁니다.',
      parameters: { type: 'object', properties: Object.assign({ task_id: TASK_ID }, TASK_PARAMS), required: ['task_id'] },
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
      progress: '할 일 삭제 준비 중',
      description: '직접 만든 할 일을 지웁니다. 상담일지의 후속 할 일은 지울 수 없고 상담일지에서 후속 날짜를 비워야 합니다. 지우기 전에 어떤 할 일인지 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { task_id: TASK_ID }, required: ['task_id'] },
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
      progress: '상담 기록 수정 준비 중',
      description: '상담 기록을 고칩니다. 넣지 않은 항목은 그대로 둡니다. 후속 날짜를 넣으면 후속 할 일이 생기거나 옮겨지고, 빈 문자열로 비우면 예정인 후속 할 일이 취소됩니다.',
      parameters: { type: 'object', properties: Object.assign({ note_id: NOTE_ID }, NOTE_PARAMS), required: ['note_id'] },
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
      progress: '상담 기록 삭제 준비 중',
      description: '상담 기록을 지웁니다. 예정인 후속 할 일도 취소됩니다. 지우기 전에 어떤 기록인지 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { note_id: NOTE_ID }, required: ['note_id'] },
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
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = actions;
  }
})();
