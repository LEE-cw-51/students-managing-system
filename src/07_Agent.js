/**
 * AI assistant chat: conversations, messages and change proposals.
 *
 * The assistant only reads through view functions. Every change it wants is stored as a
 * proposal (AgentProposals) and runs only when the teacher approves it, through the same
 * service functions the screens use. After running, each change is read back and checked.
 * Conversation rows are notes for context; the business tables stay the source of truth.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

LMS.AGENT_PROPOSAL_STATUS = ['pending', 'applied', 'rejected', 'failed'];
LMS.AGENT_HISTORY_LIMIT = 20;
// Conversations untouched this long are removed (with their messages) when a new turn is saved.
LMS.AGENT_CONVERSATION_KEEP_DAYS = 90;

function agentStudentName_(table, studentId) {
  var s = LMS.findById(table('Students'), 'student_id', studentId);
  return s ? LMS.toStr(s.name) : LMS.toStr(studentId);
}

function agentClassName_(table, classId) {
  var c = LMS.findById(table('Classes'), 'class_id', classId);
  return c ? LMS.toStr(c.class_name) : LMS.toStr(classId);
}

/**
 * Changes the assistant may propose. Each action:
 * - preview(svc, args): validates without writing; returns { args, target, before, after, text }
 * - run(svc, args): performs the change through a service function
 * - verify(svc, args, ran): reads the stored data back; returns { ok, after }
 * svc is { table, api }. Errors carry a Korean message meant for the teacher (and the model).
 */
LMS.AGENT_WRITE_ACTIONS = {
  update_attendance: {
    label: '출결 변경',
    preview: function (svc, args) {
      var lessonId = LMS.toStr(args && args.lesson_id);
      var attendance = LMS.assertEnum(LMS.toStr(args && args.attendance), LMS.ATTENDANCE, '출석');
      var row = LMS.findById(svc.table('Lessons'), 'lesson_id', lessonId);
      if (!row) throw new Error('수업 기록(' + (lessonId || '없음') + ')을 찾을 수 없습니다. 수업 기록이 있는 날만 출결을 바꿀 수 있습니다.');
      var name = agentStudentName_(svc.table, row.student_id);
      var before = LMS.toStr(row.attendance);
      return {
        args: { lesson_id: lessonId, attendance: attendance },
        target: { student_id: LMS.toStr(row.student_id), student_name: name, date: row.lesson_date, class_name: agentClassName_(svc.table, row.class_id) },
        before: before,
        after: attendance,
        text: name + ' · ' + row.lesson_date + ' ' + agentClassName_(svc.table, row.class_id) + ' 출결: ' + (before || '없음') + ' → ' + attendance
      };
    },
    run: function (svc, args) {
      return svc.api.updateLessonAttendance({ lesson_id: args.lesson_id, attendance: args.attendance });
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Lessons'), 'lesson_id', args.lesson_id);
      var after = row ? LMS.toStr(row.attendance) : '';
      return { ok: after === args.attendance, after: after };
    }
  },

  create_counseling: {
    label: '상담 기록',
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
      var name = agentStudentName_(svc.table, input.student_id);
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
    preview: function (svc, args) {
      var taskId = LMS.toStr(args && args.task_id);
      var status = LMS.assertEnum(LMS.toStr(args && args.status), LMS.TASK_STATUS, '할 일 상태');
      var task = LMS.findById(svc.table('Tasks'), 'task_id', taskId);
      if (!task) throw new Error('할 일(' + (taskId || '없음') + ')을 찾을 수 없습니다.');
      var who = task.student_id ? agentStudentName_(svc.table, task.student_id) + ' · ' : '';
      return {
        args: { task_id: taskId, status: status },
        target: { student_id: LMS.toStr(task.student_id), student_name: who ? agentStudentName_(svc.table, task.student_id) : '', date: LMS.toStr(task.due_date) },
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
  }
};

LMS.createAgent = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function svc() {
    return { table: table, api: ctx.service() };
  }

  function writeAction(tool) {
    var action = Object.prototype.hasOwnProperty.call(LMS.AGENT_WRITE_ACTIONS, tool) ? LMS.AGENT_WRITE_ACTIONS[tool] : null;
    if (!action) throw new Error('지원하지 않는 변경입니다: ' + tool);
    return action;
  }

  function requireProposal(proposalId) {
    var row = LMS.findById(table('AgentProposals'), 'proposal_id', proposalId);
    if (!row) throw new Error('제안을 찾을 수 없습니다.');
    return row;
  }

  function slimProposal(row) {
    if (!row) return null;
    return {
      proposal_id: row.proposal_id,
      conversation_id: row.conversation_id,
      summary: row.summary,
      calls: Array.isArray(row.calls) ? row.calls : [],
      status: row.status,
      result: row.result || null,
      verification_status: row.verification_status || '',
      created_at: row.created_at,
      executed_at: row.executed_at || ''
    };
  }

  function conversationMessages(conversationId) {
    return table('AgentMessages').filter(function (m) {
      return LMS.toStr(m.conversation_id) === LMS.toStr(conversationId);
    }).sort(function (a, b) {
      var d = LMS.toStr(a.created_at).localeCompare(LMS.toStr(b.created_at));
      return d || LMS.toStr(a.message_id).localeCompare(LMS.toStr(b.message_id));
    });
  }

  /** Recent conversations, newest first, with the last message as a preview line. */
  function listAgentConversations() {
    return table('AgentConversations').slice().sort(function (a, b) {
      return LMS.toStr(b.updated_at).localeCompare(LMS.toStr(a.updated_at));
    }).slice(0, 30).map(function (c) {
      var msgs = conversationMessages(c.conversation_id);
      var last = msgs.length ? msgs[msgs.length - 1] : null;
      return {
        conversation_id: c.conversation_id,
        title: c.title,
        updated_at: c.updated_at,
        last_message: last ? LMS.toStr(last.content).slice(0, 80) : ''
      };
    });
  }

  /** One conversation with its messages; assistant messages carry their proposal. */
  function getAgentConversation(conversationId) {
    var conv = LMS.findById(table('AgentConversations'), 'conversation_id', conversationId);
    if (!conv) throw new Error('대화를 찾을 수 없습니다.');
    var proposals = table('AgentProposals');
    return {
      conversation: conv,
      messages: conversationMessages(conversationId).map(function (m) {
        var p = m.proposal_id ? LMS.findById(proposals, 'proposal_id', m.proposal_id) : null;
        return Object.assign({}, m, { proposal: slimProposal(p) });
      })
    };
  }

  /** Server-only: the last messages of a conversation as model history ({ role, content }). */
  function getAgentHistory(conversationId, limit) {
    if (!conversationId) return [];
    var conv = LMS.findById(table('AgentConversations'), 'conversation_id', conversationId);
    if (!conv) throw new Error('대화를 찾을 수 없습니다.');
    var proposals = table('AgentProposals');
    return conversationMessages(conversationId).slice(-(limit || LMS.AGENT_HISTORY_LIMIT)).map(function (m) {
      var content = LMS.toStr(m.content);
      var p = m.proposal_id ? LMS.findById(proposals, 'proposal_id', m.proposal_id) : null;
      if (p) content += '\n[변경 제안 ' + p.proposal_id + ' 상태: ' + p.status + ']';
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: content };
    });
  }

  /** Server-only: today and today's classes, so the model can resolve "오늘", "중2A반". */
  function getAgentContext() {
    var today = ctx.today();
    var classes = [];
    try {
      classes = (ctx.service().getTodayBoard(today).classes || []).map(function (c) {
        return { class_id: c.class_id, class_name: c.class_name, start_time: c.start_time || '' };
      });
    } catch (e) {
      classes = [];
    }
    return { today: today, weekday: LMS.weekdayName(today), today_classes: classes };
  }

  /** Server-only: check one proposed change without writing. Throws when it cannot run. */
  function previewAgentAction(tool, args) {
    return writeAction(tool).preview(svc(), args || {});
  }

  /**
   * Every request loads every table, so old chat must not pile up. Drops conversations not
   * updated for AGENT_CONVERSATION_KEEP_DAYS and their messages. A conversation that still
   * has a pending proposal is kept; proposals themselves stay as the record of changes.
   */
  function pruneOldConversations_() {
    var cutoff = LMS.addDays(ctx.today(), -LMS.AGENT_CONVERSATION_KEEP_DAYS);
    var pendingConv = {};
    table('AgentProposals').forEach(function (p) {
      if (p.status === 'pending') pendingConv[LMS.toStr(p.conversation_id)] = true;
    });
    var convs = table('AgentConversations');
    var drop = {};
    convs.forEach(function (c) {
      var id = LMS.toStr(c.conversation_id);
      if (!pendingConv[id] && LMS.toStr(c.updated_at).slice(0, 10) < cutoff) drop[id] = true;
    });
    if (!Object.keys(drop).length) return 0;
    saveTable('AgentConversations', convs.filter(function (c) { return !drop[LMS.toStr(c.conversation_id)]; }));
    saveTable('AgentMessages', table('AgentMessages').filter(function (m) { return !drop[LMS.toStr(m.conversation_id)]; }));
    return Object.keys(drop).length;
  }

  /**
   * Server-only: store one chat turn. Creates the conversation on the first turn and a
   * pending proposal when the assistant asked for changes ([{ tool, args }]).
   */
  function saveAgentTurn(data) {
    data = data || {};
    var userText = LMS.toStr(data.message);
    if (!userText) throw new Error('메시지를 입력해 주세요.');
    var ts = ctx.now();
    pruneOldConversations_();
    var convs = table('AgentConversations');
    var conv = data.conversation_id ? LMS.findById(convs, 'conversation_id', data.conversation_id) : null;
    if (data.conversation_id && !conv) throw new Error('대화를 찾을 수 없습니다.');
    if (!conv) {
      conv = { conversation_id: ctx.nextIds('AGC', 1)[0], title: userText.slice(0, 40), created_at: ts, updated_at: ts };
      convs.push(conv);
    }
    conv.updated_at = ts;
    saveTable('AgentConversations', convs);

    var proposal = null;
    var calls = (Array.isArray(data.calls) ? data.calls : []).map(function (c) {
      var preview = previewAgentAction(c.tool, c.args);
      return { tool: c.tool, label: writeAction(c.tool).label, args: preview.args, target: preview.target, before: preview.before, after: preview.after, text: preview.text };
    });
    if (calls.length) {
      var proposals = table('AgentProposals');
      proposal = {
        proposal_id: ctx.nextIds('AGP', 1)[0],
        conversation_id: conv.conversation_id,
        summary: LMS.toStr(data.summary) || calls.map(function (c) { return c.text; }).join('\n'),
        calls: calls,
        status: 'pending',
        result: null,
        verification_status: '',
        created_at: ts,
        executed_at: ''
      };
      proposals.push(proposal);
      saveTable('AgentProposals', proposals);
    }

    var messages = table('AgentMessages');
    var ids = ctx.nextIds('AGM', 2);
    var userMsg = { message_id: ids[0], conversation_id: conv.conversation_id, role: 'user', content: userText, proposal_id: '', created_at: ts };
    var reply = {
      message_id: ids[1], conversation_id: conv.conversation_id, role: 'assistant',
      content: LMS.toStr(data.reply), proposal_id: proposal ? proposal.proposal_id : '', created_at: ts
    };
    messages.push(userMsg, reply);
    saveTable('AgentMessages', messages);
    return {
      conversation_id: conv.conversation_id,
      user_message: userMsg,
      message: Object.assign({}, reply, { proposal: slimProposal(proposal) })
    };
  }

  /**
   * Server-only (the apply route records failures): run every change of a pending proposal,
   * then read each one back. Running twice does nothing the second time. Any error throws,
   * so the request's transaction undoes the changes already made.
   */
  function applyAgentProposal(proposalId) {
    var row = requireProposal(proposalId);
    if (row.status === 'applied') return slimProposal(row);
    if (row.status !== 'pending') throw new Error('이미 처리된 제안입니다.');
    var s = svc();
    var results = (row.calls || []).map(function (c) {
      var action = writeAction(c.tool);
      // Re-check against the current data: something may have changed since the proposal.
      var preview = action.preview(s, c.args);
      var ran = action.run(s, preview.args);
      var check = action.verify(s, preview.args, ran);
      return { tool: c.tool, text: c.text, ok: check.ok, after: check.after };
    });
    var rows = table('AgentProposals');
    row = LMS.findById(rows, 'proposal_id', proposalId);
    row.status = 'applied';
    row.result = results;
    row.verification_status = results.every(function (r) { return r.ok; }) ? 'verified' : 'mismatch';
    row.executed_at = ctx.now();
    saveTable('AgentProposals', rows);
    return slimProposal(row);
  }

  /** Server-only: mark a pending proposal failed with the error shown to the teacher. */
  function markAgentProposalFailed(proposalId, message) {
    var rows = table('AgentProposals');
    var row = LMS.findById(rows, 'proposal_id', proposalId);
    if (!row || row.status !== 'pending') return slimProposal(row);
    row.status = 'failed';
    row.result = { error: LMS.toStr(message) };
    row.executed_at = ctx.now();
    saveTable('AgentProposals', rows);
    return slimProposal(row);
  }

  function rejectAgentProposal(proposalId) {
    var rows = table('AgentProposals');
    var row = requireProposal(proposalId);
    if (row.status === 'rejected') return slimProposal(row);
    if (row.status !== 'pending') throw new Error('이미 처리된 제안입니다.');
    row = LMS.findById(rows, 'proposal_id', proposalId);
    row.status = 'rejected';
    row.executed_at = ctx.now();
    saveTable('AgentProposals', rows);
    return slimProposal(row);
  }

  return {
    listAgentConversations: listAgentConversations,
    getAgentConversation: getAgentConversation,
    getAgentHistory: getAgentHistory,
    getAgentContext: getAgentContext,
    previewAgentAction: previewAgentAction,
    saveAgentTurn: saveAgentTurn,
    applyAgentProposal: applyAgentProposal,
    markAgentProposalFailed: markAgentProposalFailed,
    rejectAgentProposal: rejectAgentProposal
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
