/**
 * AI assistant chat: conversations, messages and change proposals.
 *
 * The assistant only reads through view functions. Every change it wants is stored as a
 * proposal (AgentProposals) and runs only when the teacher approves it, through the same
 * service functions the screens use. After running, each change is read back and checked.
 * The changes that can be proposed are the write actions of 08_AgentActions.js.
 * Conversation rows are notes for context; the business tables stay the source of truth.
 * Proposal state changes here are the store of lib/proposals.js; everything else goes through it.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

LMS.AGENT_PROPOSAL_STATUS = ['pending', 'applied', 'rejected', 'failed'];
LMS.AGENT_HISTORY_LIMIT = 20;
// Conversations untouched this long are removed (with their messages) when a new turn is saved.
LMS.AGENT_CONVERSATION_KEEP_DAYS = 90;
// The rate limit counts chat turns in this sliding window (AgentUsage rows, epoch ms).
LMS.AGENT_RATE_WINDOW_MS = 60 * 60 * 1000;
// AgentUsage.kind of Claude connector tool calls (chat turns leave kind empty).
LMS.AGENT_USAGE_MCP = 'mcp';
// AgentProposals.source: who put the proposal up (Claude connector or the in-app assistant chat).
LMS.AGENT_SOURCE_MCP = 'mcp';
LMS.AGENT_SOURCE_ASSISTANT = 'assistant';
// Connector turns start with this; rows saved before `source` existed are told apart by it.
LMS.MCP_MESSAGE_PREFIX = '[Claude 커넥터]';
// Applying or rejecting a proposal already settled some other way (applied, rejected, failed).
LMS.AGENT_PROPOSAL_SETTLED = 'AGENT_PROPOSAL_SETTLED';
// Error codes the API passes to the browser (lib/api-error.js maps them to HTTP statuses).
LMS.AGENT_CONVERSATION_NOT_FOUND = 'CONVERSATION_NOT_FOUND';

function conversationNotFound_() {
  var e = new Error('대화를 찾을 수 없습니다.');
  e.code = LMS.AGENT_CONVERSATION_NOT_FOUND;
  return e;
}

LMS.createAgent = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function svc() {
    return { table: table, api: ctx.service(), assignments: ctx.assignments, examPeriods: ctx.examPeriods };
  }

  function requireProposal(proposalId) {
    var row = LMS.findById(table('AgentProposals'), 'proposal_id', proposalId);
    if (!row) throw new Error('제안을 찾을 수 없습니다.');
    return row;
  }

  /**
   * The one "already handled" rule: true when a pending proposal may become `to`, false when
   * it already is `to` (nothing to do). Any other settled proposal throws AGENT_PROPOSAL_SETTLED.
   */
  function mustSettle(row, to) {
    if (row.status === to) return false;
    if (row.status === 'pending') return true;
    var e = new Error('이미 처리된 제안입니다.');
    e.code = LMS.AGENT_PROPOSAL_SETTLED;
    throw e;
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
    if (!conv) throw conversationNotFound_();
    var proposals = table('AgentProposals');
    return {
      conversation: conv,
      messages: conversationMessages(conversationId).map(function (m) {
        var p = m.proposal_id ? LMS.findById(proposals, 'proposal_id', m.proposal_id) : null;
        return Object.assign({}, m, { proposal: slimProposal(p) });
      })
    };
  }

  /** Where a turn the browser stopped waiting for was saved, or null if it never was. */
  function findAgentTurn(clientTurnId) {
    var id = LMS.toStr(clientTurnId);
    if (!id) return null;
    var hit = table('AgentMessages').filter(function (m) { return LMS.toStr(m.client_turn_id) === id; })[0];
    return hit ? { conversation_id: hit.conversation_id } : null;
  }

  /** Server-only: the last messages of a conversation as model history ({ role, content }). */
  function getAgentHistory(conversationId, limit) {
    if (!conversationId) return [];
    var conv = LMS.findById(table('AgentConversations'), 'conversation_id', conversationId);
    if (!conv) throw conversationNotFound_();
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
    return LMS.agentActions.preview(svc(), tool, args);
  }

  /**
   * Server-only: count one chat turn against `limit` turns per AGENT_RATE_WINDOW_MS. The count
   * lives in the database, so every serverless instance shares it. When the limit is used up
   * nothing is counted and { ok: false, retry_after_ms } comes back. On success `used_at`
   * identifies the slot for releaseAgentTurn.
   * kind: separate counter in the same table ('' chat turns, LMS.AGENT_USAGE_MCP connector calls).
   */
  function reserveAgentTurn(nowMs, limit, kind) {
    var k = LMS.toStr(kind);
    var cutoff = nowMs - LMS.AGENT_RATE_WINDOW_MS;
    var recent = table('AgentUsage').filter(function (u) { return Number(u.used_at) > cutoff; });
    var mine = recent.filter(function (u) { return LMS.toStr(u.kind) === k; });
    if (mine.length >= limit) {
      var oldest = Math.min.apply(null, mine.map(function (u) { return Number(u.used_at); }));
      return { ok: false, retry_after_ms: Math.max(0, oldest + LMS.AGENT_RATE_WINDOW_MS - nowMs) };
    }
    recent.push(k ? { used_at: nowMs, kind: k } : { used_at: nowMs });
    saveTable('AgentUsage', recent);
    return { ok: true, retry_after_ms: 0, used_at: nowMs };
  }

  /** Server-only: give back one slot taken by reserveAgentTurn when the turn was not saved. */
  function releaseAgentTurn(usedAt, kind) {
    var k = LMS.toStr(kind);
    var dropped = false;
    // Slots with the same time are interchangeable; drop just one.
    var rows = table('AgentUsage').filter(function (u) {
      if (dropped || Number(u.used_at) !== Number(usedAt) || LMS.toStr(u.kind) !== k) return true;
      dropped = true;
      return false;
    });
    if (dropped) saveTable('AgentUsage', rows);
    return dropped;
  }

  /**
   * Server-only: mark one OAuth code / refresh token id as used until `expMs` (epoch ms).
   * True when newly recorded, false when it was already used. Expired rows are dropped.
   */
  function consumeOAuthJti(jti, expMs, nowMs) {
    var id = LMS.toStr(jti);
    if (!id) return false;
    var rows = table('OAuthJti').filter(function (r) { return Number(r.exp_ms) > nowMs; });
    var used = rows.some(function (r) { return LMS.toStr(r.jti) === id; });
    if (!used) rows.push({ jti: id, exp_ms: Number(expMs) });
    saveTable('OAuthJti', rows);
    return !used;
  }

  function mcpTokenVersion_() {
    var v = ctx.service().getSettings().mcp_token_version;
    return LMS.toStr(v == null || v === '' ? '0' : v);
  }

  // Connections that still count: not past their refresh token's expiry, and made after the last "연결 끊기".
  function liveOAuthGrants_(nowMs) {
    var ver = mcpTokenVersion_();
    return table('OAuthGrants').filter(function (g) {
      return Number(g.exp_ms) > nowMs && LMS.toStr(g.ver) === ver;
    });
  }

  /**
   * Server-only: records one Claude connector connection (OAuthGrants row, one per approval on
   * the consent screen), or after a refresh moves its expiry on to `exp_ms` (epoch ms).
   * Expired rows and rows from before the last "연결 끊기" are dropped.
   */
  function saveOAuthGrant(grant, nowMs) {
    var id = LMS.toStr(grant && grant.grant_id);
    if (!id) throw new Error('커넥터 연결 ID가 필요합니다.');
    var rows = liveOAuthGrants_(nowMs);
    var row = LMS.findById(rows, 'grant_id', id);
    var ts = ctx.now();
    if (!row) {
      row = { grant_id: id, client_name: LMS.toStr(grant.client_name).slice(0, 100) || 'Claude', ver: mcpTokenVersion_(), created_at: ts };
      rows.push(row);
    }
    row.last_used_at = ts;
    row.exp_ms = Number(grant.exp_ms);
    saveTable('OAuthGrants', rows);
    return row;
  }

  /** Server-only: whether the connection a token belongs to is still connected. */
  function hasOAuthGrant(grantId, nowMs) {
    var id = LMS.toStr(grantId);
    return !!id && liveOAuthGrants_(nowMs).some(function (g) { return LMS.toStr(g.grant_id) === id; });
  }

  /** Claude connector connections for the settings screen, newest first. */
  function listMcpConnections() {
    return liveOAuthGrants_(Date.now())
      .map(function (g) {
        return { grant_id: g.grant_id, client_name: g.client_name, created_at: g.created_at, last_used_at: g.last_used_at };
      })
      .sort(function (a, b) { return LMS.toStr(b.created_at).localeCompare(LMS.toStr(a.created_at)); });
  }

  /** Cuts one connection: its access and refresh tokens stop working. False when it was not connected. */
  function revokeMcpConnection(grantId) {
    var id = LMS.toStr(grantId);
    var rows = table('OAuthGrants');
    var next = rows.filter(function (g) { return LMS.toStr(g.grant_id) !== id; });
    if (next.length === rows.length) return false;
    saveTable('OAuthGrants', next);
    return true;
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
   * pending proposal when the assistant asked for changes ([{ tool, args, preview? }]).
   * A call that carries its preview (made by previewAgentAction during the turn) is stored as
   * is: the data may have changed during the AI wait, and the turn must not be lost for it.
   * Approval checks every change again against the data at that time.
   * data.source: LMS.AGENT_SOURCE_MCP for connector turns; anything else is the assistant chat.
   */
  function saveAgentTurn(data) {
    data = data || {};
    var userText = LMS.toStr(data.message);
    if (!userText) throw new Error('메시지를 입력해 주세요.');
    var ts = ctx.now();
    pruneOldConversations_();
    var convs = table('AgentConversations');
    var conv = data.conversation_id ? LMS.findById(convs, 'conversation_id', data.conversation_id) : null;
    if (data.conversation_id && !conv) throw conversationNotFound_();
    if (!conv) {
      conv = { conversation_id: ctx.nextIds('AGC', 1)[0], title: userText.slice(0, 40), created_at: ts, updated_at: ts };
      convs.push(conv);
    }
    conv.updated_at = ts;
    saveTable('AgentConversations', convs);

    var proposal = null;
    var calls = (Array.isArray(data.calls) ? data.calls : []).map(function (c) {
      var preview = c.preview || previewAgentAction(c.tool, c.args);
      return { tool: c.tool, label: LMS.agentActions.get(c.tool).label, args: preview.args, target: preview.target, before: preview.before, after: preview.after, text: preview.text };
    });
    if (calls.length) {
      var proposals = table('AgentProposals');
      proposal = {
        proposal_id: ctx.nextIds('AGP', 1)[0],
        conversation_id: conv.conversation_id,
        summary: LMS.toStr(data.summary) || calls.map(function (c) { return c.text; }).join('\n'),
        calls: calls,
        source: data.source === LMS.AGENT_SOURCE_MCP ? LMS.AGENT_SOURCE_MCP : LMS.AGENT_SOURCE_ASSISTANT,
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
    var userMsg = {
      message_id: ids[0], conversation_id: conv.conversation_id, role: 'user', content: userText, proposal_id: '', created_at: ts,
      client_turn_id: LMS.toStr(data.client_turn_id)
    };
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
   * Server-only (lib/proposals.js records failures): run every change of a pending proposal,
   * then read each one back. Running twice does nothing the second time. Any error throws,
   * so the request's transaction undoes the changes already made.
   * selected: indexes into calls to run (absent: all). The others are recorded as skipped.
   */
  function applyAgentProposal(proposalId, selected) {
    var row = requireProposal(proposalId);
    if (!mustSettle(row, 'applied')) return slimProposal(row);
    var calls = row.calls || [];
    var chosen = null;
    if (Array.isArray(selected)) {
      chosen = {};
      selected.forEach(function (i) {
        if (Number(i) >= 0 && Number(i) < calls.length && Math.floor(Number(i)) === Number(i)) chosen[Number(i)] = true;
      });
      if (!Object.keys(chosen).length) {
        var none = new Error('반영할 항목을 하나 이상 선택해 주세요.');
        none.code = 'AGENT_NOTHING_SELECTED';
        throw none;
      }
    }
    var s = svc();
    var results = calls.map(function (c, i) {
      if (chosen && !chosen[i]) return { tool: c.tool, text: c.text, skipped: true };
      var check = LMS.agentActions.apply(s, c.tool, c.args);
      return { tool: c.tool, text: c.text, ok: check.ok, after: check.after };
    });
    var rows = table('AgentProposals');
    row = LMS.findById(rows, 'proposal_id', proposalId);
    row.status = 'applied';
    row.result = results;
    row.verification_status = results.every(function (r) { return r.skipped || r.ok; }) ? 'verified' : 'mismatch';
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

  function byCreatedAt(a, b) {
    var d = LMS.toStr(a.created_at).localeCompare(LMS.toStr(b.created_at));
    return d || LMS.toStr(a.proposal_id).localeCompare(LMS.toStr(b.proposal_id));
  }

  /** Where a proposal came from; rows without `source` count as connector-made by their title. */
  function proposalSource_(p, convs) {
    var s = LMS.toStr(p.source);
    if (s) return s;
    var conv = LMS.findById(convs, 'conversation_id', p.conversation_id);
    return conv && LMS.toStr(conv.title).indexOf(LMS.MCP_MESSAGE_PREFIX) === 0 ? LMS.AGENT_SOURCE_MCP : LMS.AGENT_SOURCE_ASSISTANT;
  }

  /**
   * Pending proposals, oldest first, with each call's label and text (no raw args).
   * source: only proposals from there (absent: all).
   */
  function listPendingProposals(source) {
    var convs = table('AgentConversations');
    var only = LMS.toStr(source);
    return table('AgentProposals').filter(function (p) {
      return p.status === 'pending' && (!only || proposalSource_(p, convs) === only);
    }).sort(byCreatedAt).map(function (p) {
      var conv = LMS.findById(convs, 'conversation_id', p.conversation_id);
      return {
        proposal_id: p.proposal_id,
        conversation_id: p.conversation_id,
        title: conv ? LMS.toStr(conv.title) : '',
        created_at: p.created_at,
        calls: (Array.isArray(p.calls) ? p.calls : []).map(function (c) {
          return { label: LMS.toStr(c.label), text: LMS.toStr(c.text) };
        })
      };
    });
  }

  /**
   * Server-only: the given proposal ids that exist, oldest first, with their status
   * ([{ proposal_id, status, created_at }]). Missing ids are left out.
   */
  function getAgentProposalOrder(ids) {
    var want = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) { want[LMS.toStr(id)] = true; });
    return table('AgentProposals').filter(function (p) {
      return want[LMS.toStr(p.proposal_id)];
    }).sort(byCreatedAt).map(function (p) {
      return { proposal_id: p.proposal_id, status: p.status, created_at: p.created_at };
    });
  }

  /**
   * Server-only: reject several proposals in one save. Never throws for one item: each comes
   * back as { proposal_id, proposal (slim, null when missing), error } in request order.
   * Already rejected stays as is; applied, failed or missing ids get an error.
   */
  function rejectAgentProposals(ids) {
    var rows = table('AgentProposals');
    var ts = ctx.now();
    var changed = false;
    var results = (Array.isArray(ids) ? ids : []).map(function (id) {
      var row = LMS.findById(rows, 'proposal_id', LMS.toStr(id));
      if (!row) return { proposal_id: LMS.toStr(id), proposal: null, error: '제안을 찾을 수 없습니다.' };
      var error = '';
      try {
        if (mustSettle(row, 'rejected')) {
          row.status = 'rejected';
          row.executed_at = ts;
          changed = true;
        }
      } catch (e) {
        if (e.code !== LMS.AGENT_PROPOSAL_SETTLED) throw e;
        error = e.message;
      }
      return { proposal_id: row.proposal_id, proposal: slimProposal(row), error: error };
    });
    if (changed) saveTable('AgentProposals', rows);
    return results;
  }

  return {
    listAgentConversations: listAgentConversations,
    getAgentConversation: getAgentConversation,
    findAgentTurn: findAgentTurn,
    getAgentHistory: getAgentHistory,
    getAgentContext: getAgentContext,
    previewAgentAction: previewAgentAction,
    reserveAgentTurn: reserveAgentTurn,
    releaseAgentTurn: releaseAgentTurn,
    consumeOAuthJti: consumeOAuthJti,
    saveOAuthGrant: saveOAuthGrant,
    hasOAuthGrant: hasOAuthGrant,
    listMcpConnections: listMcpConnections,
    revokeMcpConnection: revokeMcpConnection,
    saveAgentTurn: saveAgentTurn,
    applyAgentProposal: applyAgentProposal,
    markAgentProposalFailed: markAgentProposalFailed,
    listPendingProposals: listPendingProposals,
    getAgentProposalOrder: getAgentProposalOrder,
    rejectAgentProposals: rejectAgentProposals
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
